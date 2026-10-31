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
  revenue_ads: number;
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
  const monthOpt = options.month !== undefined ? options.month : 9; // Default to latest complete month (Tháng 9)
  const isAllMonths = monthOpt === "all";
  const monthNum = typeof monthOpt === "number" ? monthOpt : 9;

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
        sku,
        MAX(asin) as asin,
        MAX(product_type) as product_type,
        MAX(mockup_url) as mockup_url,
        MAX(fnsku) as fnsku,
        MAX(status) as status,
        SUM(revenue) as revenue,
        SUM(quantity) as quantity,
        SUM(ads_fee) as ads_fee,
        SUM(basecost) as basecost,
        SUM(amazon_fee_unrecognized) as amazon_fee_unrecognized,
        SUM(amazon_fee_trans) as amazon_fee_trans,
        SUM(thue) as thue,
        SUM(return_amount) as return_amount,
        SUM(adjustment) as adjustment,
        SUM(storage_fee) as storage_fee,
        SUM(placement_fee) as placement_fee,
        SUM(long_term_fee) as long_term_fee,
        SUM(fba_customer_return_fee) as fba_customer_return_fee,
        SUM(liquidations) as liquidations,
        SUM(basecost_return_adjustment) as basecost_return_adjustment,
        SUM(removal) as removal,
        SUM(profit) as profit,
        MAX(available_now) as available_now,
        SUM(revenue_ads) as revenue_ads
      FROM accounting_sku_monthly
      WHERE store_id = ${storeId} AND year = ${year}
      GROUP BY sku
    `
    : sql<Record<string, any>[]>`
      SELECT 
        id, sku, asin, product_type, mockup_url, fnsku, status,
        revenue, quantity, ads_fee, basecost,
        amazon_fee_unrecognized, amazon_fee_trans,
        thue, return_amount, adjustment,
        storage_fee, placement_fee, long_term_fee,
        fba_customer_return_fee, liquidations,
        basecost_return_adjustment, removal, profit,
        available_now, tacos, acos, margin, roi,
        profit_per_item, basecost_per_item, revenue_ads
      FROM accounting_sku_monthly
      WHERE store_id = ${storeId} AND year = ${year} AND month = ${monthNum}
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
    const roi = basecost < 0 ? -profit / basecost : null;
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
      revenue_ads,
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
  const roi = total_basecost < 0 ? -net_profit / total_basecost : null;

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
    vat_tax_adjustment: 0,
    awd_subscription_fees: 0,
    basecost_adjustment: 0,
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
