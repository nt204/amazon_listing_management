import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { getExcelWeekNum, type FbaDailyItem, type FbaDailyStats } from "@/lib/accounting/fba-daily-db";
import type { ListSkuWinOptions, SkuWinItem, SkuWinStats } from "@/lib/accounting/sku-win-db";

// Tab FBM / FBM CỐ ĐỊNH của Financials: tái hiện workbook "FBM - <STORE> - KẾ TOÁN TỔNG HỢP".
// Nguồn: Orders (fulfillment_channel = 'Merchant') = 'Orders -FBM', BẢNG MÃ FBM (accounting_sku_master_fbm),
// ĐẦU VÀO FBM PW (accounting_fbm_pw_costs), ADS, RETURN. Chi phí trả về dạng số dương (workbook để âm).

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

/**
 * CTE dùng chung:
 *   fbm_master  — BẢNG MÃ FBM theo SKU (XLOOKUP/SUMIFS của Sheets không phân biệt hoa thường → khóa UPPER).
 *   fbm_lines   — từng dòng 'Basecost-Fee FBM':
 *     Revenue  I = (item-price + shipping-price) quy đổi USD (CAD 0.738, MXN 0.051, tiền khác = 0)
 *     Basecost K = dòng đầu tiên của Order ID: tổng NetPrice PW của đơn, nếu = 0 thì quantity × Total bảng mã;
 *                  các dòng sau của cùng đơn = 0 (COUNTIFS(B, U)=1)
 *     AMZ Fee  N = Revenue × % Referal;  Promotion J = item-promotion-discount (nguyên tệ)
 *   fbm_returns — RETURN: SKU = dòng order FBM đầu tiên của Order ID, Loại theo bảng mã FBM, giá trị = Total (USD).
 */
function fbmBaseCtes(sql: Sql, storeId: string) {
  return sql`
    fbm_master AS (
      SELECT DISTINCT ON (UPPER(TRIM(sku)))
        UPPER(TRIM(sku)) AS sku_key,
        COALESCE(referral_fee_pct, 0) AS referral_fee_pct,
        SUM(COALESCE(total_cost, 0)) OVER (PARTITION BY UPPER(TRIM(sku))) AS total_cost,
        UPPER(TRIM(COALESCE(loai, ''))) AS loai
      FROM accounting_sku_master_fbm
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND COALESCE(TRIM(sku), '') <> ''
      ORDER BY UPPER(TRIM(sku)), row_order NULLS LAST, created_at
    ),
    fbm_pw AS (
      SELECT order_id, SUM(COALESCE(net_price, 0)) AS pw_cost
      FROM accounting_fbm_pw_costs
      WHERE store_id = ${storeId} AND order_id IS NOT NULL
      GROUP BY order_id
    ),
    fbm_lines AS (
      SELECT
        o.date,
        UPPER(TRIM(COALESCE(o.sku, ''))) AS sku_key,
        COALESCE(o.quantity, 0) AS qty,
        CASE WHEN COALESCE(o.currency, '') <> '' THEN COALESCE(o.quantity, 0) ELSE 0 END AS qty_with_currency,
        (COALESCE(o.item_price, 0) + COALESCE(o.shipping_price, 0)) * (
          CASE o.currency WHEN 'USD' THEN 1.0 WHEN 'CAD' THEN 0.738 WHEN 'MXN' THEN 0.051 ELSE 0 END
        ) AS revenue,
        COALESCE(o.item_promotion_discount, 0) AS promotion,
        CASE
          WHEN ROW_NUMBER() OVER (
            PARTITION BY COALESCE(o.amazon_order_id, o.id::text) ORDER BY o.line_no NULLS LAST, o.ctid
          ) > 1 THEN 0
          WHEN COALESCE(pw.pw_cost, 0) = 0 THEN COALESCE(o.quantity, 0) * COALESCE(m.total_cost, 0)
          ELSE pw.pw_cost
        END AS basecost,
        COALESCE(m.referral_fee_pct, 0) AS referral_fee_pct
      FROM accounting_orders o
      LEFT JOIN fbm_master m ON m.sku_key = UPPER(TRIM(COALESCE(o.sku, '')))
      LEFT JOIN fbm_pw pw ON pw.order_id = o.amazon_order_id
      WHERE o.store_id = ${storeId}
        AND o.fulfillment_channel = 'Merchant'
    ),
    fbm_returns AS (
      SELECT r.date, fl.sku_key, m.loai, COALESCE(r.total, 0) AS total
      FROM accounting_returns r
      LEFT JOIN LATERAL (
        SELECT UPPER(TRIM(COALESCE(o.sku, ''))) AS sku_key
        FROM accounting_orders o
        WHERE o.store_id = r.store_id
          AND o.amazon_order_id = r.order_id
          AND o.fulfillment_channel = 'Merchant'
        ORDER BY o.line_no NULLS LAST, o.ctid
        LIMIT 1
      ) fl ON true
      LEFT JOIN fbm_master m ON m.sku_key = fl.sku_key
      WHERE r.store_id = ${storeId}
    )
  `;
}

/** Thuế Ads của store (stores.fbm_ads_tax_rate): mặc định 10%, store không chịu thuế Ads đặt 0. */
async function fbmAdsTaxRate(sql: Sql, storeId: string): Promise<number> {
  const [row] = await sql<{ rate: number | null }[]>`SELECT fbm_ads_tax_rate::float AS rate FROM stores WHERE id = ${storeId}`;
  return row?.rate ?? 0.1;
}

function dateRangeCondition(sql: Sql, column: string, startDate: string, endDate: string) {
  return startDate && endDate
    ? sql`AND ${sql(column)} >= ${startDate}::date AND ${sql(column)} <= ${endDate}::date`
    : sql``;
}

// ----------------- FBM THEO NGÀY (sheet "FBM") -----------------

export interface FbmDailyItem extends FbaDailyItem {
  organic_sales: number | null;
  aov: number;
  basecost_per_item: number;
  ads_per_item: number;
}

export interface FbmDailyStats extends FbaDailyStats {
  totalQuantityAds: number;
  avgMarginPreAds: number;
}

export interface ListFbmDailyOptions {
  startDate?: string;
  endDate?: string;
  search?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export async function listFbmDaily(
  storeId: string,
  options: ListFbmDailyOptions = {}
): Promise<{ items: FbmDailyItem[]; total: number; stats: FbmDailyStats; missingSkus: string[] }> {
  const sql = await getDatabaseClient();
  const startDate = options.startDate?.trim() || "";
  const endDate = options.endDate?.trim() || "";
  const search = options.search?.trim().toLowerCase() || "";
  const sortField = options.sortField || "date";
  const sortDirection = options.sortDirection || "desc";
  const page = Math.max(1, options.page || 1);
  const limit = options.limit && options.limit > 0 ? options.limit : 100;

  // Sheet FBM bỏ trống ngày >= TODAY(); ADS lọc Loại (XLOOKUP từ chữ cuối Portfolio vào BẢNG MÃ FBM) = "FBM".
  const [adsTaxRate, rows, orderSkus, masterSkus] = await Promise.all([
    fbmAdsTaxRate(sql, storeId),sql<Record<string, unknown>[]>`
    WITH ${fbmBaseCtes(sql, storeId)},
    daily_orders AS (
      SELECT date,
        SUM(revenue) AS revenue,
        SUM(qty_with_currency) AS quantity,
        SUM(basecost) AS basecost,
        SUM(revenue * referral_fee_pct) AS amazon_fee,
        SUM(promotion) AS promotion
      FROM fbm_lines
      WHERE date < CURRENT_DATE ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY date
    ),
    daily_ads AS (
      SELECT ad.date,
        SUM(COALESCE(ad.spend, 0)) AS spend,
        SUM(COALESCE(ad.sales, 0)) AS sales,
        SUM(COALESCE(ad.orders, 0)) AS orders,
        SUM(COALESCE(ad.clicks, 0)) AS clicks
      FROM accounting_ads ad
      JOIN fbm_master m ON m.sku_key = UPPER(substring(COALESCE(ad.portfolio, '') from '([^ ]*)$'))
      WHERE ad.store_id = ${storeId}
        AND m.loai = 'FBM'
        AND ad.date < CURRENT_DATE ${dateRangeCondition(sql, "ad.date", startDate, endDate)}
      GROUP BY ad.date
    ),
    daily_returns AS (
      SELECT date, SUM(total) AS total
      FROM fbm_returns
      WHERE loai = 'FBM' AND date < CURRENT_DATE ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY date
    ),
    all_dates AS (
      SELECT date FROM daily_orders UNION SELECT date FROM daily_ads UNION SELECT date FROM daily_returns
    )
    SELECT
      to_char(d.date, 'YYYY-MM-DD') AS date_str,
      COALESCE(o.revenue, 0)::float AS revenue,
      COALESCE(o.quantity, 0)::float AS quantity,
      COALESCE(o.basecost, 0)::float AS basecost,
      COALESCE(o.amazon_fee, 0)::float AS amazon_fee,
      COALESCE(o.promotion, 0)::float AS promotion,
      COALESCE(a.spend, 0)::float AS ads_fee,
      COALESCE(a.sales, 0)::float AS revenue_ads,
      COALESCE(a.orders, 0)::float AS quantity_ads,
      COALESCE(a.clicks, 0)::float AS clicks,
      (-COALESCE(r.total, 0))::float AS return_cost
    FROM all_dates d
    LEFT JOIN daily_orders o ON o.date = d.date
    LEFT JOIN daily_ads a ON a.date = d.date
    LEFT JOIN daily_returns r ON r.date = d.date
  `,
    // SKU có doanh thu FBM nhưng không có trong BẢNG MÃ FBM (workbook ra #N/A): AMZ Fee / Basecost dự phòng = 0.
    // So khớp bằng Set ở JS để không phụ thuộc ước lượng của planner (anti-join theo UPPER(TRIM) dễ thành nested loop).
    sql<{ sku_key: string; sku: string }[]>`
      SELECT UPPER(TRIM(sku)) AS sku_key, MIN(sku) AS sku
      FROM accounting_orders
      WHERE store_id = ${storeId}
        AND fulfillment_channel = 'Merchant'
        AND COALESCE(currency, '') <> ''
        AND COALESCE(TRIM(sku), '') <> ''
        AND date < CURRENT_DATE ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY 1
    `,
    sql<{ sku_key: string }[]>`
      SELECT DISTINCT UPPER(TRIM(sku)) AS sku_key
      FROM accounting_sku_master_fbm
      WHERE store_id = ${storeId} AND deleted_at IS NULL
    `,
  ]);

  const items: FbmDailyItem[] = rows.map((r) => {
    const date = String(r.date_str);
    const revenue = Number(r.revenue);
    const quantity = Number(r.quantity);
    const adsFee = Number(r.ads_fee);
    const basecost = Number(r.basecost);
    const amazonFee = Number(r.amazon_fee);
    const promotion = Number(r.promotion);
    const returnCost = Number(r.return_cost);
    const revenueAds = Number(r.revenue_ads);
    const quantityAds = Number(r.quantity_ads);
    // Thuế = thuế Ads (mặc định 10%) × Ads Fee + 10% AMZ Fee + 1% Revenue
    const thue = adsTaxRate * adsFee + 0.1 * amazonFee + 0.01 * revenue;
    const profit = revenue - adsFee - basecost - amazonFee - thue - promotion - returnCost;
    return {
      id: date,
      date,
      week: `T${getExcelWeekNum(date)}`,
      month: `THÁNG ${Number(date.slice(5, 7))}`,
      revenue,
      quantity,
      orders: 0,
      ads_fee: adsFee,
      basecost,
      amazon_fee: amazonFee,
      thue,
      promotion,
      return_cost: returnCost,
      profit,
      // Sheet FBM không có phí dịch vụ cố định (cột Net Profit để trống)
      net_profit: profit,
      balance: revenue - adsFee - amazonFee - returnCost,
      roi: basecost > 0 ? profit / basecost : 0,
      tacos: revenue > 0 ? adsFee / revenue : 0,
      acos: revenueAds > 0 ? adsFee / revenueAds : 0,
      margin: revenue > 0 ? profit / revenue : 0,
      // % Profit trước ADS = (C+F+G+H+J)/C: đã trừ Basecost, AMZ Fee, Thuế, Refund
      margin_pre_ads: revenue > 0 ? (revenue - basecost - amazonFee - thue - returnCost) / revenue : 0,
      profit_per_item: quantity > 0 ? profit / quantity : 0,
      revenue_ads: revenueAds,
      quantity_ads: quantityAds,
      clicks: Number(r.clicks),
      organic_sales: quantity > 0 ? quantity - quantityAds : null,
      aov: quantity > 0 ? revenue / quantity : 0,
      basecost_per_item: quantity > 0 ? basecost / quantity : 0,
      ads_per_item: quantity > 0 ? adsFee / quantity : 0,
    };
  });

  const filtered = search
    ? items.filter((i) => i.date.includes(search) || i.week.toLowerCase().includes(search) || i.month.toLowerCase().includes(search))
    : items;
  sortRows(filtered, sortField, sortDirection);

  const sum = (key: keyof FbmDailyItem) => filtered.reduce((acc, i) => acc + (Number(i[key]) || 0), 0);
  const totalRevenue = sum("revenue");
  const totalAdsFee = sum("ads_fee");
  const totalBasecost = sum("basecost");
  const totalAmazonFee = sum("amazon_fee");
  const totalThue = sum("thue");
  const totalReturnCost = sum("return_cost");
  const totalProfit = sum("profit");
  const totalRevenueAds = sum("revenue_ads");
  const stats: FbmDailyStats = {
    totalDays: filtered.length,
    totalRevenue,
    totalQuantity: sum("quantity"),
    totalAdsFee,
    totalBasecost,
    totalAmazonFee,
    totalThue,
    totalPromotion: sum("promotion"),
    totalReturnCost,
    totalProfit,
    totalNetProfit: sum("net_profit"),
    totalBalance: sum("balance"),
    totalRevenueAds,
    totalClicks: sum("clicks"),
    totalQuantityAds: sum("quantity_ads"),
    avgRoi: totalBasecost > 0 ? totalProfit / totalBasecost : 0,
    avgTacos: totalRevenue > 0 ? totalAdsFee / totalRevenue : 0,
    avgAcos: totalRevenueAds > 0 ? totalAdsFee / totalRevenueAds : 0,
    avgMargin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
    avgMarginPreAds:
      totalRevenue > 0 ? (totalRevenue - totalBasecost - totalAmazonFee - totalThue - totalReturnCost) / totalRevenue : 0,
  };

  return {
    items: filtered.slice((page - 1) * limit, page * limit),
    total: filtered.length,
    stats,
    missingSkus: (() => {
      const known = new Set(masterSkus.map((r) => r.sku_key));
      return orderSkus.filter((r) => !known.has(r.sku_key)).map((r) => r.sku).sort().slice(0, 200);
    })(),
  };
}

// ----------------- LỌC SKU CỐ ĐỊNH FBM (sheet "LỌC SKU CỐ ĐỊNH") -----------------

interface FbmSkuAggregate {
  revenue: number;
  quantity: number;
  basecost: number;
  amazon_fee: number;
  promotion: number;
  ads_fee: number;
  revenue_ads: number;
  return_total: number;
  return_count: number;
}

/**
 * Tổng theo SKU trong khoảng ngày (sheet không chặn TODAY()):
 *   Ads Fee / Revenue ads = SUMIFS(ADS, Portfolio chứa SKU) — không lọc Loại
 *   Return = SUMIFS(RETURN!O, RETURN!A = SKU) — không lọc Loại
 */
async function aggregateFbmSkus(sql: Sql, storeId: string, startDate: string, endDate: string) {
  const rows = await sql<({ sku_key: string } & FbmSkuAggregate)[]>`
    WITH ${fbmBaseCtes(sql, storeId)},
    sku_orders AS (
      SELECT sku_key,
        SUM(revenue) AS revenue,
        SUM(qty) AS quantity,
        SUM(basecost) AS basecost,
        SUM(revenue * referral_fee_pct) AS amazon_fee,
        SUM(promotion) AS promotion
      FROM fbm_lines
      WHERE TRUE ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY sku_key
    ),
    -- Gộp theo Portfolio trước rồi mới so khớp "chứa SKU" để tránh nhân chéo SKU × từng dòng ADS
    portfolio_ads AS (
      SELECT UPPER(COALESCE(portfolio, '')) AS portfolio,
        SUM(COALESCE(spend, 0)) AS spend,
        SUM(COALESCE(sales, 0)) AS sales
      FROM accounting_ads
      WHERE store_id = ${storeId} ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY 1
    ),
    sku_ads AS (
      SELECT m.sku_key, SUM(pa.spend) AS spend, SUM(pa.sales) AS sales
      FROM fbm_master m
      JOIN portfolio_ads pa ON strpos(pa.portfolio, m.sku_key) > 0
      GROUP BY m.sku_key
    ),
    sku_returns AS (
      SELECT sku_key, SUM(total) AS total, COUNT(*) AS cnt
      FROM fbm_returns
      WHERE sku_key IS NOT NULL ${dateRangeCondition(sql, "date", startDate, endDate)}
      GROUP BY sku_key
    ),
    keys AS (
      SELECT sku_key FROM sku_orders UNION SELECT sku_key FROM sku_ads UNION SELECT sku_key FROM sku_returns
    )
    SELECT k.sku_key,
      COALESCE(o.revenue, 0)::float AS revenue,
      COALESCE(o.quantity, 0)::float AS quantity,
      COALESCE(o.basecost, 0)::float AS basecost,
      COALESCE(o.amazon_fee, 0)::float AS amazon_fee,
      COALESCE(o.promotion, 0)::float AS promotion,
      COALESCE(a.spend, 0)::float AS ads_fee,
      COALESCE(a.sales, 0)::float AS revenue_ads,
      COALESCE(r.total, 0)::float AS return_total,
      COALESCE(r.cnt, 0)::int AS return_count
    FROM keys k
    LEFT JOIN sku_orders o ON o.sku_key = k.sku_key
    LEFT JOIN sku_ads a ON a.sku_key = k.sku_key
    LEFT JOIN sku_returns r ON r.sku_key = k.sku_key
  `;
  return new Map(rows.map((r) => [r.sku_key, r]));
}

const EMPTY_AGGREGATE: FbmSkuAggregate = {
  revenue: 0, quantity: 0, basecost: 0, amazon_fee: 0, promotion: 0,
  ads_fee: 0, revenue_ads: 0, return_total: 0, return_count: 0,
};

function skuProfit(a: FbmSkuAggregate, adsTaxRate: number) {
  const returnCost = -a.return_total;
  const thue = adsTaxRate * a.ads_fee + 0.1 * a.amazon_fee + 0.01 * a.revenue;
  const profit = a.revenue - a.ads_fee - a.basecost - a.amazon_fee - thue - a.promotion - returnCost;
  return { thue, returnCost, profit };
}

export async function listFbmSkuFixed(
  storeId: string,
  options: ListSkuWinOptions = {}
): Promise<{ items: SkuWinItem[]; total: number; stats: SkuWinStats; productTypes: string[]; statuses: string[] }> {
  const sql = await getDatabaseClient();
  const search = options.search?.trim() || "";
  const productType = options.productType?.trim() || "";
  const status = options.status?.trim() || "";
  const skuType = options.skuType || "all";
  const startDate = options.startDate?.trim() || "";
  const endDate = options.endDate?.trim() || "";
  const compareStartDate = options.compareStartDate?.trim() || "";
  const compareEndDate = options.compareEndDate?.trim() || "";
  const hasCompare = Boolean(compareStartDate && compareEndDate);
  const sortField = options.sortField || "profit";
  const sortDirection = options.sortDirection || "desc";
  const page = Math.max(1, options.page || 1);
  const limit = options.limit && options.limit > 0 ? options.limit : 50;

  const [adsTaxRate, masterRows, aggregates, compareAggregates, allTimeRows] = await Promise.all([
    fbmAdsTaxRate(sql, storeId),
    sql<Record<string, unknown>[]>`
      SELECT id, sku, asin, product_type, mockup, mockup_url, brand, status, niche, pic_mkt,
        COALESCE(amazon_fee, 0)::float AS amazon_fee_unit,
        COALESCE(referral_fee_pct, 0)::float AS referral_fee_pct,
        NULLIF(custom_fields->>'price', '')::float AS custom_price,
        NULLIF(custom_fields->'targets'->>'revenue', '')::float AS revenue_target,
        NULLIF(custom_fields->'targets'->>'unit', '')::float AS unit_target,
        NULLIF(custom_fields->'targets'->>'spend', '')::float AS spend_target,
        NULLIF(custom_fields->'targets'->>'profit', '')::float AS profit_target
      FROM accounting_sku_master_fbm
      WHERE store_id = ${storeId} AND deleted_at IS NULL AND COALESCE(TRIM(sku), '') <> ''
      ORDER BY row_order NULLS LAST, created_at
    `,
    aggregateFbmSkus(sql, storeId, startDate, endDate),
    hasCompare ? aggregateFbmSkus(sql, storeId, compareStartDate, compareEndDate) : Promise.resolve(null),
    // Lượng bán tổng = SUMIFS('Orders -FBM'!P, M = SKU): mọi dòng FBM, không lọc ngày / trạng thái
    sql<{ sku_key: string; qty: number }[]>`
      SELECT UPPER(TRIM(sku)) AS sku_key, SUM(COALESCE(quantity, 0))::float AS qty
      FROM accounting_orders
      WHERE store_id = ${storeId} AND fulfillment_channel = 'Merchant'
      GROUP BY 1
    `,
  ]);
  const allTimeQty = new Map(allTimeRows.map((r) => [r.sku_key, r.qty]));

  const productTypes = [...new Set(masterRows.map((r) => r.product_type).filter(Boolean))] as string[];
  const statuses = [...new Set(masterRows.map((r) => r.status).filter(Boolean))] as string[];

  const text = (v: unknown) => (v == null || v === "" ? null : String(v));
  const num = (v: unknown) => (v == null ? null : Number(v));
  const q = search.toLowerCase();
  const seen = new Set<string>();

  let items: SkuWinItem[] = masterRows
    .filter((r) => {
      const key = String(r.sku).trim().toUpperCase();
      if (seen.has(key)) return false; // trùng SKU khác hoa/thường: workbook XLOOKUP lấy dòng đầu
      seen.add(key);
      if (status && status.toLowerCase() !== "all" && String(r.status ?? "").toLowerCase() !== status.toLowerCase()) return false;
      if (productType && r.product_type !== productType) return false;
      if (q) {
        return [r.sku, r.asin, r.product_type, r.niche, r.pic_mkt].some((v) => v != null && String(v).toLowerCase().includes(q));
      }
      return true;
    })
    .map((r) => {
      const key = String(r.sku).trim().toUpperCase();
      const a = aggregates.get(key) ?? EMPTY_AGGREGATE;
      const { thue, returnCost, profit } = skuProfit(a, adsTaxRate);
      let compare: Partial<SkuWinItem> = {};
      if (compareAggregates) {
        const c = compareAggregates.get(key) ?? EMPTY_AGGREGATE;
        const compareProfit = skuProfit(c, adsTaxRate).profit;
        compare = {
          compare_revenue: c.revenue,
          compare_quantity: c.quantity,
          compare_ads_fee: c.ads_fee,
          compare_tacos: c.revenue > 0 ? c.ads_fee / c.revenue : 0,
          compare_profit: compareProfit,
          growth: compareProfit !== 0 ? (profit - compareProfit) / Math.abs(compareProfit) : null,
        };
      }
      return {
        id: String(r.id),
        sku: String(r.sku),
        asin: text(r.asin),
        product_type: text(r.product_type),
        mockup: text(r.mockup),
        mockup_url: text(r.mockup_url),
        brand: text(r.brand),
        status: text(r.status),
        niche: text(r.niche),
        pic_mkt: text(r.pic_mkt),
        amazon_fee_unit: Number(r.amazon_fee_unit),
        referral_fee_pct: Number(r.referral_fee_pct),
        custom_price: num(r.custom_price),
        revenue: a.revenue,
        quantity: a.quantity,
        ads_fee: a.ads_fee,
        basecost: a.basecost,
        amazon_fee: a.amazon_fee,
        thue,
        promotion: a.promotion,
        return_cost: returnCost,
        profit,
        profit_per_item: a.quantity > 0 ? profit / a.quantity : 0,
        basecost_per_item: a.quantity > 0 ? a.basecost / a.quantity : 0,
        tacos: a.revenue > 0 ? a.ads_fee / a.revenue : 0,
        acos: a.revenue_ads > 0 ? a.ads_fee / a.revenue_ads : 0,
        margin: a.revenue > 0 ? profit / a.revenue : 0,
        roi: a.basecost > 0 ? profit / a.basecost : 0,
        revenue_ads: a.revenue_ads,
        all_time_quantity: allTimeQty.get(key) ?? 0,
        return_count: a.return_count,
        return_rate: a.quantity > 0 ? a.return_count / a.quantity : 0,
        shipped_qty: 0,
        revenue_target: num(r.revenue_target),
        unit_target: num(r.unit_target),
        spend_target: num(r.spend_target),
        profit_target: num(r.profit_target),
        ...compare,
      };
    });

  if (skuType === "win") items = items.filter((i) => i.profit > 0);
  else if (skuType === "loss") items = items.filter((i) => i.profit <= 0 && (i.revenue > 0 || i.ads_fee > 0));
  else if (skuType === "ordered") items = items.filter((i) => i.quantity > 0);

  const sum = (key: keyof SkuWinItem) => items.reduce((acc, i) => acc + (Number(i[key]) || 0), 0);
  const totalRevenue = sum("revenue");
  const totalAdsFee = sum("ads_fee");
  const totalBasecost = sum("basecost");
  const totalProfit = sum("profit");
  const stats: SkuWinStats = {
    totalSkus: items.length,
    totalRevenue,
    totalQuantity: sum("quantity"),
    totalAdsFee,
    totalBasecost,
    totalAmazonFee: sum("amazon_fee"),
    totalThue: sum("thue"),
    totalPromotion: sum("promotion"),
    totalReturnCost: sum("return_cost"),
    totalProfit,
    totalRevenueAds: sum("revenue_ads"),
    avgMargin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
    avgTacos: totalRevenue > 0 ? totalAdsFee / totalRevenue : 0,
    avgRoi: totalBasecost > 0 ? totalProfit / totalBasecost : 0,
    winCount: items.filter((i) => i.profit > 0).length,
    lossCount: items.filter((i) => i.profit <= 0 && (i.profit < 0 || i.revenue > 0 || i.ads_fee > 0)).length,
  };

  sortRows(items, sortField, sortDirection);
  return {
    items: items.slice((page - 1) * limit, page * limit),
    total: items.length,
    stats,
    productTypes,
    statuses,
  };
}

export async function updateFbmSkuCustomFields(
  storeId: string,
  skuId: string,
  updates: { price?: number | null; targets?: Record<string, number | null | undefined> }
) {
  const sql = await getDatabaseClient();
  const [existing] = await sql<{ custom_fields: Record<string, unknown> | null }[]>`
    SELECT custom_fields FROM accounting_sku_master_fbm WHERE id = ${skuId} AND store_id = ${storeId}
  `;
  if (!existing) throw new Error("SKU not found in this store");

  const customFields: Record<string, unknown> = { ...(existing.custom_fields || {}) };
  if (updates.price !== undefined) {
    if (!updates.price) delete customFields.price;
    else customFields.price = updates.price;
  }
  if (updates.targets !== undefined) {
    customFields.targets = { ...((customFields.targets as object) || {}), ...updates.targets };
  }
  await sql`
    UPDATE accounting_sku_master_fbm
    SET custom_fields = ${JSON.stringify(customFields)}::jsonb, updated_at = NOW()
    WHERE id = ${skuId} AND store_id = ${storeId}
  `;
  return customFields;
}

function sortRows<T>(rows: T[], field: string, direction: "asc" | "desc") {
  rows.sort((a, b) => {
    const av = (a as Record<string, unknown>)[field] ?? "";
    const bv = (b as Record<string, unknown>)[field] ?? "";
    const diff = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).toLowerCase().localeCompare(String(bv).toLowerCase(), "vi");
    return direction === "asc" ? diff : -diff;
  });
}
