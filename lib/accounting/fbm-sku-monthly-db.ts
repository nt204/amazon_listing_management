import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type {
  AvailableMonthOption,
  ListSkuMonthlyOptions,
  SkuMonthlyItem,
  SkuMonthlyStoreSummary,
} from "@/lib/accounting/sku-monthly-db";

// Tab "SKU FBM-monthly" (file TỔNG KẾT CUỐI THÁNG): accounting_fbm_sku_monthly + accounting_fbm_monthly_store_summary
// (migration 135). Trả về cùng dạng với SKU Monthly FBA để dùng chung giao diện; các cột chỉ FBA có = 0.
// Tỷ lệ theo công thức tab FBM: TAcos = Ads/Revenue, Acos = Ads/Revenue ads, Magin = Profit/Revenue, ROI = Profit/Basecost.

type Row = Record<string, unknown>;

const n = (v: unknown) => Number(v || 0);
const str = (v: unknown) => (v == null || v === "" ? null : String(v));
const ratio = (a: number, b: number) => (b !== 0 ? a / b : null);

function toItem(r: Row, storeId: string, year: number, month: number): SkuMonthlyItem {
  const revenue = n(r.revenue);
  const quantity = n(r.quantity);
  const ads_fee = n(r.ads_fee);
  const basecost = n(r.basecost);
  const amazon_fee_unrecognized = n(r.amazon_fee_unrecognized);
  const amazon_fee_trans = n(r.amazon_fee_trans);
  const profit = n(r.profit);
  const revenue_ads = n(r.revenue_ads);
  return {
    id: str(r.id) || `${storeId}_${year}_${month}_${r.sku}`,
    store_id: storeId,
    year,
    month,
    sku: String(r.sku),
    asin: str(r.asin),
    product_type: str(r.product_type),
    mockup_url: str(r.mockup_url),
    fnsku: null,
    status: str(r.status),
    revenue,
    quantity,
    ads_fee,
    basecost,
    amazon_fee_unrecognized,
    amazon_fee_trans,
    amazon_fee_total: amazon_fee_unrecognized + amazon_fee_trans,
    thue: n(r.thue),
    return_amount: n(r.return_amount),
    adjustment: 0,
    storage_fee: 0,
    placement_fee: 0,
    long_term_fee: 0,
    fba_customer_return_fee: 0,
    liquidations: 0,
    basecost_return_adjustment: 0,
    removal: 0,
    profit,
    available_now: 0,
    tacos: revenue > 0 ? ads_fee / revenue : null,
    acos: revenue_ads > 0 ? ads_fee / revenue_ads : null,
    margin: revenue > 0 ? profit / revenue : null,
    roi: ratio(profit, basecost),
    profit_per_item: quantity > 0 ? profit / quantity : null,
    basecost_per_item: quantity > 0 ? basecost / quantity : null,
    vat_tax_adjustment: 0,
    removal_qty_2024: 0,
    awd_subscription_fees: 0,
    basecost_adjustment: 0,
    revenue_ads,
    listing_month: null,
    review_month: null,
    a_to_z_claim: n(r.a_to_z_claim),
    chargeback_refund: n(r.chargeback_refund),
  };
}

function summaryFromItems(
  items: SkuMonthlyItem[],
  storeId: string,
  year: number,
  month: number,
  ownerFee: number,
): SkuMonthlyStoreSummary {
  const sum = (pick: (i: SkuMonthlyItem) => number) => items.reduce((s, i) => s + pick(i), 0);
  const total_revenue = sum((i) => i.revenue);
  const total_ads_fee = sum((i) => i.ads_fee);
  const total_basecost = sum((i) => i.basecost);
  const total_amazon_fee_unrecognized = sum((i) => i.amazon_fee_unrecognized);
  const total_amazon_fee_trans = sum((i) => i.amazon_fee_trans);
  const total_sku_profit = sum((i) => i.profit);
  const total_revenue_ads = sum((i) => i.revenue_ads);
  const net_profit = total_sku_profit + ownerFee;
  return {
    store_id: storeId,
    year,
    month,
    total_revenue,
    total_quantity: sum((i) => i.quantity),
    total_ads_fee,
    total_basecost,
    total_amazon_fee_unrecognized,
    total_amazon_fee_trans,
    total_amazon_fee: total_amazon_fee_unrecognized + total_amazon_fee_trans,
    total_thue: sum((i) => i.thue),
    total_return_amount: sum((i) => i.return_amount),
    total_adjustment: 0,
    total_storage_fee: 0,
    total_placement_fee: 0,
    total_long_term_fee: 0,
    total_fba_customer_return_fee: 0,
    total_liquidations: 0,
    total_basecost_return_adj: 0,
    total_removal: 0,
    vat_tax_adjustment: 0,
    awd_subscription_fees: 0,
    basecost_adjustment: 0,
    total_sku_profit,
    net_profit,
    total_available_now: 0,
    total_revenue_ads,
    tacos: total_revenue > 0 ? total_ads_fee / total_revenue : null,
    acos: total_revenue_ads > 0 ? total_ads_fee / total_revenue_ads : null,
    margin: total_revenue > 0 ? net_profit / total_revenue : null,
    roi: ratio(net_profit, total_basecost),
    active_sku_count: items.filter((i) => i.revenue > 0 || i.quantity > 0 || i.ads_fee !== 0 || i.profit !== 0).length,
    total_sku_count: items.length,
    total_a_to_z_claim: sum((i) => i.a_to_z_claim || 0),
    total_chargeback_refund: sum((i) => i.chargeback_refund || 0),
    owner_fee: ownerFee,
  };
}

export async function listFbmSkuMonthly(
  storeId: string,
  options: ListSkuMonthlyOptions = {},
): Promise<{
  items: SkuMonthlyItem[];
  total: number;
  summary: SkuMonthlyStoreSummary;
  productTypes: string[];
  statuses: string[];
  availableMonths: AvailableMonthOption[];
}> {
  const sql = await getDatabaseClient();
  const year = options.year || 2026;

  const summaryRows = await sql<Row[]>`
    SELECT * FROM accounting_fbm_monthly_store_summary
    WHERE store_id = ${storeId} AND year = ${year}
    ORDER BY month DESC
  `;
  const monthOpt = options.month ?? (summaryRows[0] ? Number(summaryRows[0].month) : 10);
  const isAllMonths = monthOpt === "all";
  const monthNum = typeof monthOpt === "number" ? monthOpt : 0;

  // Mockup lấy từ BẢNG MÃ FBM (dòng đầu của SKU)
  const rawItems = isAllMonths
    ? await sql<Row[]>`
        SELECT sm.sku,
          MAX(sm.asin) AS asin, MAX(sm.product_type) AS product_type, MAX(sm.status) AS status,
          MAX(m.mockup_url) AS mockup_url,
          SUM(sm.revenue) AS revenue, SUM(sm.quantity) AS quantity, SUM(sm.ads_fee) AS ads_fee,
          SUM(sm.basecost) AS basecost, SUM(sm.amazon_fee_unrecognized) AS amazon_fee_unrecognized,
          SUM(sm.amazon_fee_trans) AS amazon_fee_trans, SUM(sm.thue) AS thue,
          SUM(sm.return_amount) AS return_amount, SUM(sm.a_to_z_claim) AS a_to_z_claim,
          SUM(sm.chargeback_refund) AS chargeback_refund, SUM(sm.profit) AS profit,
          SUM(sm.revenue_ads) AS revenue_ads
        FROM accounting_fbm_sku_monthly sm
        LEFT JOIN LATERAL (
          SELECT mockup_url FROM accounting_sku_master_fbm f
          WHERE f.store_id = sm.store_id AND UPPER(TRIM(f.sku)) = UPPER(sm.sku) AND f.deleted_at IS NULL
          ORDER BY f.row_order NULLS LAST LIMIT 1
        ) m ON true
        WHERE sm.store_id = ${storeId} AND sm.year = ${year}
        GROUP BY sm.sku
      `
    : await sql<Row[]>`
        SELECT sm.*, m.mockup_url
        FROM accounting_fbm_sku_monthly sm
        LEFT JOIN LATERAL (
          SELECT mockup_url FROM accounting_sku_master_fbm f
          WHERE f.store_id = sm.store_id AND UPPER(TRIM(f.sku)) = UPPER(sm.sku) AND f.deleted_at IS NULL
          ORDER BY f.row_order NULLS LAST LIMIT 1
        ) m ON true
        WHERE sm.store_id = ${storeId} AND sm.year = ${year} AND sm.month = ${monthNum}
      `;

  const allItems = rawItems.map((r) => toItem(r, storeId, year, monthNum));
  const productTypes = Array.from(new Set(allItems.map((i) => i.product_type).filter(Boolean))) as string[];
  const statuses = Array.from(new Set(allItems.map((i) => i.status).filter(Boolean))) as string[];

  let items = allItems;
  const search = options.search?.trim().toLowerCase() || "";
  if (search) {
    items = items.filter(
      (i) =>
        i.sku.toLowerCase().includes(search) ||
        (i.asin && i.asin.toLowerCase().includes(search)) ||
        (i.product_type && i.product_type.toLowerCase().includes(search)),
    );
  }
  if (options.productType && options.productType !== "all") {
    items = items.filter((i) => i.product_type?.toLowerCase() === options.productType!.toLowerCase());
  }
  if (options.status && options.status !== "all") {
    items = items.filter((i) => i.status?.toLowerCase() === options.status!.toLowerCase());
  }
  if (options.skuType === "active") {
    items = items.filter((i) => i.revenue > 0 || i.quantity > 0 || i.ads_fee !== 0 || i.profit !== 0);
  } else if (options.skuType === "win") {
    items = items.filter((i) => i.profit > 0);
  } else if (options.skuType === "loss") {
    items = items.filter((i) => i.profit < 0);
  }

  // Tổng của kỳ lấy theo toàn bộ SKU (như ô dòng 2 của tab), không theo bộ lọc; YTD cộng phí chủ store các tháng
  const stored = isAllMonths ? null : summaryRows.find((r) => Number(r.month) === monthNum);
  const ownerFee = isAllMonths
    ? summaryRows.reduce((s, r) => s + n(r.owner_fee), 0)
    : n(stored?.owner_fee);
  const summary = summaryFromItems(allItems, storeId, year, isAllMonths ? 0 : monthNum, ownerFee);
  if (stored) summary.data_source = str(stored.data_source);

  const sortField = options.sortField || "revenue";
  const dir = options.sortDirection === "asc" ? 1 : -1;
  items.sort((a, b) => {
    const av = (a as unknown as Row)[sortField];
    const bv = (b as unknown as Row)[sortField];
    if (typeof av === "string" || typeof bv === "string") return dir * String(av ?? "").localeCompare(String(bv ?? ""));
    const an = av == null ? -Infinity : Number(av);
    const bn = bv == null ? -Infinity : Number(bv);
    return an === bn ? 0 : dir * (an < bn ? -1 : 1);
  });

  const availableMonths: AvailableMonthOption[] = summaryRows.map((r) => ({
    month: Number(r.month),
    year: Number(r.year),
    label: `Tháng ${r.month}/${r.year}`,
    activeSkus: Number(r.active_sku_count || 0),
    revenue: n(r.total_revenue),
    profit: n(r.net_profit),
  }));

  return { items, total: items.length, summary, productTypes, statuses, availableMonths };
}
