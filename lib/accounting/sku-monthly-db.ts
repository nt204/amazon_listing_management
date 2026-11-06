import "server-only";

import { getDatabaseClient } from "@/lib/db";

export interface SkuMonthlyItem {
  id: string;
  store_id: string;
  year: number;
  month: number;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  fnsku: string | null;
  status: string | null;

  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee_unrecognized: number;
  amazon_fee_trans: number;
  amazon_fee_total: number;
  thue: number;
  return_amount: number;
  adjustment: number;
  storage_fee: number;
  placement_fee: number;
  long_term_fee: number;
  fba_customer_return_fee: number;
  liquidations: number;
  basecost_return_adjustment: number;
  removal: number;
  profit: number;

  available_now: number;
  tacos: number | null;
  acos: number | null;
  margin: number | null;
  roi: number | null;
  profit_per_item: number | null;
  basecost_per_item: number | null;
  vat_tax_adjustment: number;
  removal_qty_2024: number;
  awd_subscription_fees: number;
  basecost_adjustment: number;
  revenue_ads: number;
  listing_month: string | null;
  review_month: string | null;
  /** Chỉ SKU FBM-monthly */
  a_to_z_claim?: number;
  chargeback_refund?: number;
}

export interface SkuMonthlyStoreSummary {
  store_id: string;
  year: number;
  month: number;
  total_revenue: number;
  total_quantity: number;
  total_ads_fee: number;
  total_basecost: number;
  total_amazon_fee_unrecognized: number;
  total_amazon_fee_trans: number;
  total_amazon_fee: number;
  total_thue: number;
  total_return_amount: number;
  total_adjustment: number;
  total_storage_fee: number;
  total_placement_fee: number;
  total_long_term_fee: number;
  total_fba_customer_return_fee: number;
  total_liquidations: number;
  total_basecost_return_adj: number;
  total_removal: number;
  vat_tax_adjustment: number;
  awd_subscription_fees: number;
  basecost_adjustment: number;
  total_sku_profit: number;
  net_profit: number;
  total_available_now: number;
  total_revenue_ads: number;
  tacos: number | null;
  acos: number | null;
  margin: number | null;
  roi: number | null;
  active_sku_count: number;
  total_sku_count: number;
  /** Chỉ SKU FBM-monthly: cột A-to-z / Chargeback và phí chủ store (ô V2, đã gồm trong net_profit) */
  total_a_to_z_claim?: number;
  total_chargeback_refund?: number;
  owner_fee?: number;
  /** 'file' = kỳ nạp từ file TỔNG KẾT, null = tính từ file thô Amazon */
  data_source?: string | null;
}

export interface AvailableMonthOption {
  month: number;
  year: number;
  label: string;
  activeSkus: number;
  revenue: number;
  profit: number;
}

export interface ListSkuMonthlyOptions {
  year?: number;
  month?: number | "all";
  search?: string;
  productType?: string;
  status?: string;
  skuType?: "all" | "active" | "win" | "loss";
  sortField?: string;
  sortDirection?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export async function listSkuMonthly(
  storeId: string,
  options: ListSkuMonthlyOptions = {}
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
  let monthOpt = options.month;
  if (monthOpt === undefined) {
    const [latest] = await sql<{ month: number }[]>`
      SELECT month FROM accounting_monthly_store_summary
      WHERE store_id = ${storeId} AND year = ${year}
      ORDER BY month DESC
      LIMIT 1
    `;
    monthOpt = latest ? latest.month : 10;
  }
  const isAllMonths = monthOpt === "all";
  const monthNum = typeof monthOpt === "number" ? monthOpt : 10;

  const search = options.search?.trim() || "";
  const productType = options.productType?.trim() || "";
  const status = options.status?.trim() || "";
  const skuType = options.skuType || "all";
  const sortField = options.sortField || "revenue";
  const sortDirection = options.sortDirection || "desc";
  const page = Math.max(1, options.page || 1);
  const limit = options.limit && options.limit > 0 ? options.limit : 50;

  // Parallel batch: fetch available months/summary, filter options, and items concurrently
  const summaryPromise = sql<Record<string, any>[]>`
    SELECT *
    FROM accounting_monthly_store_summary
    WHERE store_id = ${storeId} AND year = ${year}
    ORDER BY month DESC;
  `;

  const filterPromise = sql<{ product_type: string; status: string }[]>`
    SELECT DISTINCT product_type, status
    FROM accounting_sku_monthly
    WHERE store_id = ${storeId} AND year = ${year}
      ${isAllMonths ? sql`` : sql`AND month = ${monthNum}`}
  `;

  const itemsPromise = isAllMonths
    ? sql<Record<string, any>[]>`
      SELECT 
        sm.sku,
        MAX(COALESCE(sm.asin, m.asin)) as asin,
        MAX(COALESCE(sm.product_type, m.product_type)) as product_type,
        MAX(COALESCE(sm.mockup_url, m.mockup_url)) as mockup_url,
        MAX(COALESCE(sm.fnsku, m.fnsku)) as fnsku,
        MAX(COALESCE(sm.status, m.status)) as status,
        SUM(sm.revenue) as revenue,
        SUM(sm.quantity) as quantity,
        SUM(sm.ads_fee) as ads_fee,
        SUM(sm.basecost) as basecost,
        SUM(sm.amazon_fee_unrecognized) as amazon_fee_unrecognized,
        SUM(sm.amazon_fee_trans) as amazon_fee_trans,
        SUM(sm.thue) as thue,
        SUM(sm.return_amount) as return_amount,
        SUM(sm.adjustment) as adjustment,
        SUM(sm.storage_fee) as storage_fee,
        SUM(sm.placement_fee) as placement_fee,
        SUM(sm.long_term_fee) as long_term_fee,
        SUM(sm.fba_customer_return_fee) as fba_customer_return_fee,
        SUM(sm.liquidations) as liquidations,
        SUM(sm.basecost_return_adjustment) as basecost_return_adjustment,
        SUM(sm.removal) as removal,
        SUM(sm.profit) as profit,
        MAX(COALESCE(NULLIF(sm.available_now, 0), m.ton_kho, m.ending_warehouse_balance, 0)) as available_now,
        SUM(sm.revenue_ads) as revenue_ads,
        SUM(sm.vat_tax_adjustment) as vat_tax_adjustment,
        SUM(sm.removal_qty_2024) as removal_qty_2024,
        SUM(sm.awd_subscription_fees) as awd_subscription_fees,
        SUM(sm.basecost_adjustment) as basecost_adjustment,
        MAX(COALESCE(sm.listing_month, m.thang_listing)) as listing_month,
        MAX(COALESCE(sm.review_month, m.thang_danh_gia)) as review_month
      FROM accounting_sku_monthly sm
      LEFT JOIN accounting_sku_master m ON m.store_id = sm.store_id AND m.sku = sm.sku
      WHERE sm.store_id = ${storeId} AND sm.year = ${year}
      GROUP BY sm.sku
    `
    : sql<Record<string, any>[]>`
      SELECT 
        sm.id, sm.sku,
        COALESCE(sm.asin, m.asin) as asin,
        COALESCE(sm.product_type, m.product_type) as product_type,
        COALESCE(sm.mockup_url, m.mockup_url) as mockup_url,
        COALESCE(sm.fnsku, m.fnsku) as fnsku,
        COALESCE(sm.status, m.status) as status,
        sm.revenue, sm.quantity, sm.ads_fee, sm.basecost,
        sm.amazon_fee_unrecognized, sm.amazon_fee_trans,
        sm.thue, sm.return_amount, sm.adjustment,
        sm.storage_fee, sm.placement_fee, sm.long_term_fee,
        sm.fba_customer_return_fee, sm.liquidations,
        sm.basecost_return_adjustment, sm.removal, sm.profit,
        COALESCE(NULLIF(sm.available_now, 0), m.ton_kho, m.ending_warehouse_balance, 0) as available_now,
        sm.tacos, sm.acos, sm.margin, sm.roi,
        sm.profit_per_item, sm.basecost_per_item, sm.revenue_ads,
        sm.vat_tax_adjustment, sm.removal_qty_2024,
        sm.awd_subscription_fees, sm.basecost_adjustment,
        COALESCE(sm.listing_month, m.thang_listing) as listing_month,
        COALESCE(sm.review_month, m.thang_danh_gia) as review_month
      FROM accounting_sku_monthly sm
      LEFT JOIN accounting_sku_master m ON m.store_id = sm.store_id AND m.sku = sm.sku
      WHERE sm.store_id = ${storeId} AND sm.year = ${year} AND sm.month = ${monthNum}
    `;

  const [summaryRows, filterRows, rawItems] = await Promise.all([
    summaryPromise,
    filterPromise,
    itemsPromise,
  ]);

  const availableMonths: AvailableMonthOption[] = summaryRows.map((r) => ({
    month: Number(r.month),
    year: Number(r.year),
    label: `Tháng ${r.month}/${r.year}`,
    activeSkus: Number(r.active_sku_count || 0),
    revenue: Number(r.total_revenue || 0),
    profit: Number(r.net_profit || 0),
  }));

  const productTypes = Array.from(new Set(filterRows.map((r) => r.product_type).filter(Boolean)));
  const statuses = Array.from(new Set(filterRows.map((r) => r.status).filter(Boolean)));

  // 4. Map and compute unit ratios
  let items: SkuMonthlyItem[] = rawItems.map((r) => {
    const revenue = Number(r.revenue || 0);
    const quantity = Number(r.quantity || 0);
    const ads_fee = Number(r.ads_fee || 0);
    const basecost = Number(r.basecost || 0);
    const amazon_fee_unrecognized = Number(r.amazon_fee_unrecognized || 0);
    const amazon_fee_trans = Number(r.amazon_fee_trans || 0);
    const profit = Number(r.profit || 0);
    const revenue_ads = Number(r.revenue_ads || 0);

    const tacos = revenue > 0 ? ads_fee / revenue : null;
    const acos = revenue_ads > 0 ? ads_fee / revenue_ads : null;
    const margin = revenue > 0 ? profit / revenue : null;
    const cost = revenue - profit;
    const roi = cost !== 0 ? profit / cost : null;
    const profit_per_item = quantity > 0 ? profit / quantity : null;
    const basecost_per_item = quantity > 0 ? basecost / quantity : null;

    return {
      id: r.id || `${storeId}_${year}_${monthNum}_${r.sku}`,
      store_id: storeId,
      year,
      month: isAllMonths ? 0 : monthNum,
      sku: r.sku,
      asin: r.asin || null,
      product_type: r.product_type || null,
      mockup_url: r.mockup_url || null,
      fnsku: r.fnsku || null,
      status: r.status || null,
      revenue,
      quantity,
      ads_fee,
      basecost,
      amazon_fee_unrecognized,
      amazon_fee_trans,
      amazon_fee_total: amazon_fee_unrecognized + amazon_fee_trans,
      thue: Number(r.thue || 0),
      return_amount: Number(r.return_amount || 0),
      adjustment: Number(r.adjustment || 0),
      storage_fee: Number(r.storage_fee || 0),
      placement_fee: Number(r.placement_fee || 0),
      long_term_fee: Number(r.long_term_fee || 0),
      fba_customer_return_fee: Number(r.fba_customer_return_fee || 0),
      liquidations: Number(r.liquidations || 0),
      basecost_return_adjustment: Number(r.basecost_return_adjustment || 0),
      removal: Number(r.removal || 0),
      profit,
      available_now: Number(r.available_now || 0),
      tacos,
      acos,
      margin,
      roi,
      profit_per_item,
      basecost_per_item,
      vat_tax_adjustment: Number(r.vat_tax_adjustment || 0),
      removal_qty_2024: Number(r.removal_qty_2024 || 0),
      awd_subscription_fees: Number(r.awd_subscription_fees || 0),
      basecost_adjustment: Number(r.basecost_adjustment || 0),
      revenue_ads,
      listing_month: r.listing_month || null,
      review_month: r.review_month || null,
    };
  });

  // 5. Apply filtering
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(
      (i) =>
        i.sku.toLowerCase().includes(s) ||
        (i.asin && i.asin.toLowerCase().includes(s)) ||
        (i.product_type && i.product_type.toLowerCase().includes(s))
    );
  }

  if (productType && productType !== "all") {
    items = items.filter((i) => i.product_type?.toLowerCase() === productType.toLowerCase());
  }

  if (status && status !== "all") {
    items = items.filter((i) => i.status?.toLowerCase() === status.toLowerCase());
  }

  if (skuType === "active") {
    items = items.filter((i) => i.revenue > 0 || i.quantity > 0 || i.ads_fee !== 0 || i.profit !== 0);
  } else if (skuType === "win") {
    items = items.filter((i) => i.profit > 0);
  } else if (skuType === "loss") {
    items = items.filter((i) => i.profit < 0);
  }

  // 6. Calculate store summary
  let summary: SkuMonthlyStoreSummary;
  if (!isAllMonths) {
    const storedSummary = summaryRows.find((r) => Number(r.month) === monthNum);
    if (storedSummary) {
      summary = {
        store_id: storeId,
        year,
        month: monthNum,
        total_revenue: Number(storedSummary.total_revenue || 0),
        total_quantity: Number(storedSummary.total_quantity || 0),
        total_ads_fee: Number(storedSummary.total_ads_fee || 0),
        total_basecost: Number(storedSummary.total_basecost || 0),
        total_amazon_fee_unrecognized: Number(storedSummary.total_amazon_fee_unrecognized || 0),
        total_amazon_fee_trans: Number(storedSummary.total_amazon_fee_trans || 0),
        total_amazon_fee:
          Number(storedSummary.total_amazon_fee_unrecognized || 0) +
          Number(storedSummary.total_amazon_fee_trans || 0),
        total_thue: Number(storedSummary.total_thue || 0),
        total_return_amount: Number(storedSummary.total_return_amount || 0),
        total_adjustment: Number(storedSummary.total_adjustment || 0),
        total_storage_fee: Number(storedSummary.total_storage_fee || 0),
        total_placement_fee: Number(storedSummary.total_placement_fee || 0),
        total_long_term_fee: Number(storedSummary.total_long_term_fee || 0),
        total_fba_customer_return_fee: Number(storedSummary.total_fba_customer_return_fee || 0),
        total_liquidations: Number(storedSummary.total_liquidations || 0),
        total_basecost_return_adj: Number(storedSummary.total_basecost_return_adj || 0),
        total_removal: Number(storedSummary.total_removal || 0),
        vat_tax_adjustment: Number(storedSummary.vat_tax_adjustment || 0),
        awd_subscription_fees: Number(storedSummary.awd_subscription_fees || 0),
        basecost_adjustment: Number(storedSummary.basecost_adjustment || 0),
        total_sku_profit: Number(storedSummary.total_sku_profit || 0),
        net_profit: Number(storedSummary.net_profit || 0),
        total_available_now: Number(storedSummary.total_available_now || 0),
        total_revenue_ads: Number(storedSummary.total_revenue_ads || 0),
        tacos: storedSummary.tacos !== null ? Number(storedSummary.tacos) : null,
        acos: storedSummary.acos !== null ? Number(storedSummary.acos) : null,
        margin: storedSummary.margin !== null ? Number(storedSummary.margin) : null,
        roi: storedSummary.roi !== null ? Number(storedSummary.roi) : null,
        active_sku_count: Number(storedSummary.active_sku_count || 0),
        total_sku_count: Number(storedSummary.total_sku_count || 0),
      };
    } else {
      summary = calculateSummaryFromItems(items, storeId, year, monthNum);
    }
  } else {
    // All months combined summary
    summary = calculateSummaryFromItems(items, storeId, year, 0);
  }

  // 7. Sort items
  items.sort((a, b) => {
    let aVal = (a as any)[sortField];
    let bVal = (b as any)[sortField];

    if (aVal === null || aVal === undefined) aVal = -Infinity;
    if (bVal === null || bVal === undefined) bVal = -Infinity;

    if (typeof aVal === "string") {
      return sortDirection === "asc"
        ? aVal.localeCompare(String(bVal))
        : String(bVal).localeCompare(aVal);
    }
    return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
  });

  const total = items.length;

  return {
    items,
    total,
    summary,
    productTypes,
    statuses,
    availableMonths,
  };
}

function calculateSummaryFromItems(
  items: SkuMonthlyItem[],
  storeId: string,
  year: number,
  month: number
): SkuMonthlyStoreSummary {
  let total_revenue = 0;
  let total_quantity = 0;
  let total_ads_fee = 0;
  let total_basecost = 0;
  let total_amazon_fee_unrecognized = 0;
  let total_amazon_fee_trans = 0;
  let total_thue = 0;
  let total_return_amount = 0;
  let total_adjustment = 0;
  let total_storage_fee = 0;
  let total_placement_fee = 0;
  let total_long_term_fee = 0;
  let total_fba_customer_return_fee = 0;
  let total_liquidations = 0;
  let total_basecost_return_adj = 0;
  let total_removal = 0;
  let total_sku_profit = 0;
  let total_available_now = 0;
  let total_revenue_ads = 0;
  let active_sku_count = 0;

  for (const i of items) {
    total_revenue += i.revenue;
    total_quantity += i.quantity;
    total_ads_fee += i.ads_fee;
    total_basecost += i.basecost;
    total_amazon_fee_unrecognized += i.amazon_fee_unrecognized;
    total_amazon_fee_trans += i.amazon_fee_trans;
    total_thue += i.thue;
    total_return_amount += i.return_amount;
    total_adjustment += i.adjustment;
    total_storage_fee += i.storage_fee;
    total_placement_fee += i.placement_fee;
    total_long_term_fee += i.long_term_fee;
    total_fba_customer_return_fee += i.fba_customer_return_fee;
    total_liquidations += i.liquidations;
    total_basecost_return_adj += i.basecost_return_adjustment;
    total_removal += i.removal;
    total_sku_profit += i.profit;
    total_available_now += i.available_now;
    total_revenue_ads += i.revenue_ads;

    if (i.revenue > 0 || i.quantity > 0 || i.ads_fee !== 0 || i.profit !== 0) {
      active_sku_count++;
    }
  }

  const net_profit = total_sku_profit;
  const tacos = total_revenue > 0 ? total_ads_fee / total_revenue : null;
  const acos = total_revenue_ads > 0 ? total_ads_fee / total_revenue_ads : null;
  const margin = total_revenue > 0 ? net_profit / total_revenue : null;
  const cost = total_revenue - net_profit;
  const roi = cost !== 0 ? net_profit / cost : null;

  return {
    store_id: storeId,
    year,
    month,
    total_revenue,
    total_quantity,
    total_ads_fee,
    total_basecost,
    total_amazon_fee_unrecognized,
    total_amazon_fee_trans,
    total_amazon_fee: total_amazon_fee_unrecognized + total_amazon_fee_trans,
    total_thue,
    total_return_amount,
    total_adjustment,
    total_storage_fee,
    total_placement_fee,
    total_long_term_fee,
    total_fba_customer_return_fee,
    total_liquidations,
    total_basecost_return_adj,
    total_removal,
    vat_tax_adjustment: items.reduce((s, i) => s + (i.vat_tax_adjustment || 0), 0),
    awd_subscription_fees: items.reduce((s, i) => s + (i.awd_subscription_fees || 0), 0),
    basecost_adjustment: items.reduce((s, i) => s + (i.basecost_adjustment || 0), 0),
    total_sku_profit,
    net_profit,
    total_available_now,
    total_revenue_ads,
    tacos,
    acos,
    margin,
    roi,
    active_sku_count,
    total_sku_count: items.length,
  };
}
