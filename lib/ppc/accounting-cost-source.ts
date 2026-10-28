import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type { CostField, CostFieldSource, CostSources, ProductCostMaster } from "./sku-architecture-types";

// Lấy chi phí của SKU bên Accounting để bù vào chỗ Cost Master (khai báo phôi) còn trống.
// Thứ tự cho từng trường: OVERRIDE của SKU → Cost Master khai báo → Accounting. Không có nguồn nào → SKU thiếu dữ liệu.

export interface AccountingSkuCost {
  productType: string | null;
  asin: string | null;
  /** Phí FBA ($/đơn vị) trong Bảng Mã, CHƯA gồm phí referral. */
  fbaFee: number | null;
  /** % referral dạng thập phân (0.15). */
  referralPct: number | null;
  baseCost: number | null;
  baseCostSource: "ACCOUNTING_MONTHLY" | "ACCOUNTING_SKU" | null;
  /** Giá bán thực tế trung bình / đơn vị trong 30 ngày đơn hàng gần nhất. */
  avgPrice: number | null;
}

/** Referral mặc định khi Bảng Mã có phí FBA nhưng chưa điền % referral. */
const DEFAULT_REFERRAL_PCT = 0.15;

const positive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function loadAccountingSkuCosts(accountingStoreId: string): Promise<Map<string, AccountingSkuCost>> {
  const sql = await getDatabaseClient();
  const [skus, monthly, prices] = await Promise.all([
    sql<{ k: string; product_type: string | null; loai: string | null; asin: string | null; amazon_fee: string | null; referral_fee_pct: string | null; basecost_tb: string | null }[]>`
      SELECT UPPER(TRIM(sku)) AS k, product_type, loai, asin, amazon_fee, referral_fee_pct, basecost_tb
      FROM accounting_sku_master
      WHERE store_id = ${accountingStoreId} AND deleted_at IS NULL
    `,
    // Basecost bình quân gia quyền của tháng gần nhất đã tính (không lấy tháng tương lai)
    sql<{ k: string; basecost_thang: string }[]>`
      SELECT DISTINCT ON (UPPER(TRIM(sku))) UPPER(TRIM(sku)) AS k, basecost_thang
      FROM accounting_monthly_base_cost
      WHERE store_id = ${accountingStoreId} AND deleted_at IS NULL AND basecost_thang > 0
        AND period <= to_char(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM')
      ORDER BY UPPER(TRIM(sku)), period DESC
    `,
    sql<{ k: string; avg_price: string }[]>`
      WITH last AS (SELECT MAX(date) AS d FROM accounting_orders WHERE store_id = ${accountingStoreId})
      SELECT UPPER(TRIM(o.sku)) AS k, SUM(o.item_price) / NULLIF(SUM(o.quantity), 0) AS avg_price
      FROM accounting_orders o, last
      WHERE o.store_id = ${accountingStoreId} AND o.date > last.d - 30
        AND o.item_price > 0 AND o.quantity > 0
        AND COALESCE(o.order_status, '') NOT ILIKE 'cancel%'
      GROUP BY 1
    `,
  ]);

  const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  const monthlyMap = new Map(monthly.map((r) => [r.k, round2(positive(r.basecost_thang))]));
  const priceMap = new Map(prices.map((r) => [r.k, positive(r.avg_price)]));
  const result = new Map<string, AccountingSkuCost>();
  for (const r of skus) {
    if (!r.k) continue;
    const monthlyCost = monthlyMap.get(r.k) ?? null;
    const skuCost = round2(positive(r.basecost_tb));
    result.set(r.k, {
      productType: r.product_type || r.loai || null,
      asin: r.asin?.trim() || null,
      fbaFee: positive(r.amazon_fee),
      referralPct: positive(r.referral_fee_pct),
      baseCost: monthlyCost ?? skuCost,
      baseCostSource: monthlyCost ? "ACCOUNTING_MONTHLY" : skuCost ? "ACCOUNTING_SKU" : null,
      avgPrice: priceMap.get(r.k) ? Math.round(priceMap.get(r.k)! * 100) / 100 : null,
    });
  }
  // SKU có đơn nhưng chưa có trong Bảng Mã vẫn dùng được giá bán
  for (const [k, avgPrice] of priceMap) {
    if (!result.has(k) && avgPrice) {
      result.set(k, { productType: null, asin: null, fbaFee: null, referralPct: null, baseCost: null, baseCostSource: null, avgPrice: Math.round(avgPrice * 100) / 100 });
    }
  }
  return result;
}

/**
 * Giá bán khi chưa có giá thực tế từ Ads:
 * Cost Master → giá đơn hàng Accounting (30 ngày). Không có nguồn nào → 0 (DEFAULT = thiếu), không lấy giá đã lưu
 * hay giá mặc định, để SKU bị đánh dấu thiếu dữ liệu (Max Bid 0) thay vì bid theo giá đoán.
 */
export function resolveFallbackPrice(
  declared: ProductCostMaster | null,
  acc: AccountingSkuCost | undefined,
): { price: number; source: CostFieldSource } {
  if (positive(declared?.defaultPrice)) return { price: declared!.defaultPrice, source: "COST_MASTER" };
  if (acc?.avgPrice) return { price: acc.avgPrice, source: "ACCOUNTING_ORDERS" };
  return { price: 0, source: "DEFAULT" };
}

/**
 * Basecost + phí Amazon cho SKU không OVERRIDE. declared = Cost Master khai báo cho đúng loại phôi
 * (null nếu chưa khai báo). Cả 2 nguồn đều trống → 0 (DEFAULT = thiếu), không lấy số mặc định.
 * Phí Amazon bên PPC là TỔNG phí: lấy từ Accounting thì = phí FBA + % referral × giá bán.
 */
export function resolveSkuCosts(input: {
  declared: ProductCostMaster | null;
  acc: AccountingSkuCost | undefined;
  sellingPrice: number;
}): { baseCost: number; baseCostSource: CostFieldSource; amazonFee: number; amazonFeeSource: CostFieldSource } {
  const { declared, acc, sellingPrice } = input;

  let baseCost = 0;
  let baseCostSource: CostFieldSource = "DEFAULT";
  if (positive(declared?.baseCost)) {
    baseCost = declared!.baseCost;
    baseCostSource = "COST_MASTER";
  } else if (acc?.baseCost && acc.baseCostSource) {
    baseCost = acc.baseCost;
    baseCostSource = acc.baseCostSource;
  }

  let amazonFee = 0;
  let amazonFeeSource: CostFieldSource = "DEFAULT";
  if (positive(declared?.defaultAmazonFee)) {
    amazonFee = declared!.defaultAmazonFee;
    amazonFeeSource = "COST_MASTER";
  } else if (acc?.fbaFee && sellingPrice > 0) {
    amazonFee = Math.round((acc.fbaFee + (acc.referralPct ?? DEFAULT_REFERRAL_PCT) * sellingPrice) * 100) / 100;
    amazonFeeSource = "ACCOUNTING_SKU";
  }

  return { baseCost, baseCostSource, amazonFee, amazonFeeSource };
}

/** Các ô Giá / Basecost / Phí không có nguồn nào. */
export function findMissingCostFields(sources: CostSources): CostField[] {
  return (["sellingPrice", "baseCost", "amazonFee"] as const).filter((field) => sources[field] === "DEFAULT");
}

/**
 * Lợi nhuận trước Ads + BE ACoS từ các con số đã chọn. Thiếu ô nào (DEFAULT) thì không tính: trả 0 kèm danh sách ô thiếu,
 * để SKU bị đánh dấu lỗi thay vì đoán bằng số mặc định.
 */
export function computeBreakEven(input: {
  sellingPrice: number;
  baseCost: number;
  amazonFee: number;
  taxRate: number;
  sources: CostSources;
}): { profitBeforeAds: number; breakEvenAcos: number; missing: CostField[] } {
  const { sellingPrice, baseCost, amazonFee, taxRate, sources } = input;
  const missing = findMissingCostFields(sources);
  if (missing.length > 0 || sellingPrice <= 0) return { profitBeforeAds: 0, breakEvenAcos: 0, missing };
  const profitBeforeAds = Math.round((sellingPrice - amazonFee - baseCost - sellingPrice * taxRate) * 100) / 100;
  return { profitBeforeAds, breakEvenAcos: Math.round((profitBeforeAds / sellingPrice) * 1000) / 10, missing };
}
