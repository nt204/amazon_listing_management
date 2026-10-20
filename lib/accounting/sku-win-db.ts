import "server-only";

import { getDatabaseClient } from "@/lib/db";

export interface SkuWinItem {
  id: string;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup: string | null;
  mockup_url: string | null;
  brand: string | null;
  status: string | null;
  niche: string | null;
  pic_mkt: string | null;
  amazon_fee_unit: number;
  referral_fee_pct: number;
  custom_price: number | null;
  
  // Computed Financials
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  profit: number;
  
  // Unit & Efficiency Metrics
  profit_per_item: number;
  basecost_per_item: number;
  tacos: number;
  acos: number;
  margin: number;
  roi: number;
  
  // Contextual Metrics
  revenue_ads: number;
  all_time_quantity: number;
  return_count: number;
  return_rate: number;
  shipped_qty: number;
  
  // Target Goals
  revenue_target: number | null;
  unit_target: number | null;
  spend_target: number | null;
  profit_target: number | null;
  
  // Comparison Period (Optional)
  compare_revenue?: number;
  compare_quantity?: number;
  compare_ads_fee?: number;
  compare_tacos?: number;
  compare_profit?: number;
  growth?: number | null;
}

export interface SkuWinStats {
  totalSkus: number;
  totalRevenue: number;
  totalQuantity: number;
  totalAdsFee: number;
  totalBasecost: number;
  totalAmazonFee: number;
  totalThue: number;
  totalPromotion: number;
  totalReturnCost: number;
  totalProfit: number;
  totalRevenueAds: number;
  avgMargin: number;
  avgTacos: number;
  avgRoi: number;
  winCount: number;
  lossCount: number;
}

export interface ListSkuWinOptions {
  page?: number;
  limit?: number;
  search?: string;
  productType?: string;
  status?: string;
  skuType?: "all" | "win" | "loss" | "ordered";
  startDate?: string;
  endDate?: string;
  compareStartDate?: string;
  compareEndDate?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
}

export async function listSkuWin(
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
  const sortField = options.sortField || "profit";
  const sortDirection = options.sortDirection || "desc";
  const page = Math.max(1, options.page || 1);
  const limit = options.limit && options.limit > 0 ? options.limit : 50;

  // 1. Fetch available Product Types and Statuses for filter dropdowns
  const [filterOptions] = await Promise.all([
    sql<{ product_type: string; status: string }[]>`
      SELECT DISTINCT product_type, status
      FROM accounting_sku_master
      WHERE store_id = ${storeId} AND deleted_at IS NULL
    `,
  ]);

  const productTypes = Array.from(new Set(filterOptions.map((r) => r.product_type).filter(Boolean))) as string[];
  const statuses = Array.from(new Set(filterOptions.map((r) => r.status).filter(Boolean))) as string[];

  // 2. Build and execute unified aggregation query in PostgreSQL
  // Date conditions for orders, ads, returns, shipments
  const hasDateFilter = Boolean(startDate && endDate);
  const hasCompareFilter = Boolean(compareStartDate && compareEndDate);

  // We query all active SKUs in the store joined with their orders, ads, returns, shipments, and basecost
  const rows = await sql<Record<string, unknown>[]>`
    WITH orders_filtered AS (
      SELECT 
        o.sku,
        COUNT(DISTINCT COALESCE(o.amazon_order_id, o.id::text)) as total_order_count,
        SUM(COALESCE(o.quantity, 1)) as total_qty,
        SUM(
          COALESCE(o.item_price, 0) * (
            CASE 
              WHEN o.currency = 'CAD' THEN 0.738 
              WHEN o.currency = 'MXN' THEN 0.056 
              ELSE 1.0 
            END
          )
        ) as total_rev,
        SUM(
          (COALESCE(o.item_promotion_discount, 0) + COALESCE(o.ship_promotion_discount, 0)) * (
            CASE 
              WHEN o.currency = 'CAD' THEN 0.738 
              WHEN o.currency = 'MXN' THEN 0.056 
              ELSE 1.0 
            END
          )
        ) as total_promo,
        SUM(
          COALESCE(o.quantity, 1) * COALESCE(mbc.basecost_thang, sm.basecost_tb, 0)
        ) as total_basecost
      FROM accounting_orders o
      LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
      LEFT JOIN accounting_monthly_base_cost mbc 
        ON mbc.store_id = o.store_id 
        AND mbc.sku = o.sku 
        AND mbc.period = to_char(o.date, 'YYYY-MM')
      WHERE o.store_id = ${storeId}
        AND (o.order_status != 'Cancelled' OR o.order_status IS NULL)
        AND o.item_price IS NOT NULL
        ${hasDateFilter ? sql`AND o.date >= ${startDate}::date AND o.date <= ${endDate}::date` : sql``}
      GROUP BY o.sku
    ),
    all_time_orders AS (
      SELECT sku, SUM(COALESCE(quantity, 1)) as all_time_qty
      FROM accounting_orders
      WHERE store_id = ${storeId}
        AND (order_status != 'Cancelled' OR order_status IS NULL)
      GROUP BY sku
    ),
    ads_filtered AS (
      SELECT 
        sku,
        SUM(spend) as total_spend,
        SUM(sales) as total_ad_sales
      FROM accounting_ads
      WHERE store_id = ${storeId}
        ${hasDateFilter ? sql`AND date >= ${startDate}::date AND date <= ${endDate}::date` : sql``}
      GROUP BY sku
    ),
    returns_filtered AS (
      SELECT 
        r.sku,
        COUNT(*) as return_count,
        SUM(
          GREATEST(
            0, 
            ABS(COALESCE(r.total, 0)) - COALESCE(NULLIF(ABS(r.basecost), 0), mbc.basecost_thang, sm.basecost_tb, 0)
          )
        ) as return_total
      FROM accounting_returns r
      LEFT JOIN accounting_sku_master sm ON sm.store_id = r.store_id AND sm.sku = r.sku
      LEFT JOIN LATERAL (
        SELECT fulfillment_channel 
        FROM accounting_orders o 
        WHERE o.store_id = r.store_id AND o.amazon_order_id = r.order_id 
        LIMIT 1
      ) ord ON true
      LEFT JOIN accounting_monthly_base_cost mbc 
        ON mbc.store_id = r.store_id 
        AND mbc.sku = r.sku
        AND mbc.period = to_char(r.date, 'YYYY-MM')
      WHERE r.store_id = ${storeId}
        ${hasDateFilter ? sql`AND r.date >= ${startDate}::date AND r.date <= ${endDate}::date` : sql``}
      GROUP BY r.sku
    ),
    inbound_filtered AS (
      SELECT 
        sku,
        SUM(COALESCE(quantity, 0)) as shipped_qty
      FROM accounting_inbound_shipments
      WHERE store_id = ${storeId}
      GROUP BY sku
    )
    ${hasCompareFilter ? sql`,
    orders_compare AS (
      SELECT 
        o.sku,
        COUNT(DISTINCT COALESCE(o.amazon_order_id, o.id::text)) as compare_order_count,
        SUM(COALESCE(o.quantity, 1)) as compare_qty,
        SUM(COALESCE(o.item_price, 0) * (CASE WHEN o.currency = 'CAD' THEN 0.738 WHEN o.currency = 'MXN' THEN 0.056 ELSE 1.0 END)) as compare_rev,
        SUM(COALESCE(o.quantity, 1) * COALESCE(mbc.basecost_thang, sm.basecost_tb, 0)) as compare_basecost,
        SUM(
          (COALESCE(o.item_promotion_discount, 0) + COALESCE(o.ship_promotion_discount, 0)) * (
            CASE 
              WHEN o.currency = 'CAD' THEN 0.738 
              WHEN o.currency = 'MXN' THEN 0.056 
              ELSE 1.0 
            END
          )
        ) as compare_promo
      FROM accounting_orders o
      LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
      LEFT JOIN accounting_monthly_base_cost mbc 
        ON mbc.store_id = o.store_id 
        AND mbc.sku = o.sku 
        AND mbc.period = to_char(o.date, 'YYYY-MM')
      WHERE o.store_id = ${storeId}
        AND (o.order_status != 'Cancelled' OR o.order_status IS NULL)
        AND o.date >= ${compareStartDate}::date 
        AND o.date <= ${compareEndDate}::date
      GROUP BY o.sku
    ),
    ads_compare AS (
      SELECT sku, SUM(spend) as compare_spend
      FROM accounting_ads
      WHERE store_id = ${storeId}
        AND date >= ${compareStartDate}::date AND date <= ${compareEndDate}::date
      GROUP BY sku
    )
    ` : sql``}
    SELECT 
      sm.id,
      sm.sku,
      sm.asin,
      sm.product_type,
      sm.mockup,
      sm.mockup_url,
      sm.brand,
      sm.status,
      sm.niche,
      sm.pic_mkt,
      COALESCE(sm.amazon_fee, 0)::numeric as amazon_fee_unit,
      COALESCE(sm.referral_fee_pct, 0.15)::numeric as referral_fee_pct,
      NULLIF(sm.custom_fields->>'price', '')::numeric as custom_price,
      NULLIF(sm.custom_fields->'targets'->>'revenue', '')::numeric as revenue_target,
      NULLIF(sm.custom_fields->'targets'->>'unit', '')::numeric as unit_target,
      NULLIF(sm.custom_fields->'targets'->>'spend', '')::numeric as spend_target,
      NULLIF(sm.custom_fields->'targets'->>'profit', '')::numeric as profit_target,
      COALESCE(o.total_rev, 0)::numeric as revenue,
      COALESCE(o.total_order_count, 0)::numeric as order_count,
      COALESCE(o.total_qty, 0)::numeric as quantity,
      COALESCE(a.total_spend, 0)::numeric as ads_fee,
      COALESCE(o.total_basecost, 0)::numeric as basecost,
      COALESCE(o.total_promo, 0)::numeric as promotion,
      COALESCE(r.return_total, 0)::numeric as return_cost,
      COALESCE(r.return_count, 0)::numeric as return_count,
      COALESCE(ato.all_time_qty, 0)::numeric as all_time_quantity,
      COALESCE(a.total_ad_sales, 0)::numeric as revenue_ads,
      COALESCE(ib.shipped_qty, 0)::numeric as shipped_qty
      ${hasCompareFilter ? sql`,
      COALESCE(oc.compare_rev, 0)::numeric as compare_revenue,
      COALESCE(oc.compare_order_count, 0)::numeric as compare_order_count,
      COALESCE(oc.compare_qty, 0)::numeric as compare_quantity,
      COALESCE(ac.compare_spend, 0)::numeric as compare_ads_fee,
      COALESCE(oc.compare_basecost, 0)::numeric as compare_basecost,
      COALESCE(oc.compare_promo, 0)::numeric as compare_promotion
      ` : sql``}
    FROM accounting_sku_master sm
    LEFT JOIN orders_filtered o ON o.sku = sm.sku
    LEFT JOIN all_time_orders ato ON ato.sku = sm.sku
    LEFT JOIN ads_filtered a ON a.sku = sm.sku
    LEFT JOIN returns_filtered r ON r.sku = sm.sku
    LEFT JOIN inbound_filtered ib ON ib.sku = sm.sku
    ${hasCompareFilter ? sql`
    LEFT JOIN orders_compare oc ON oc.sku = sm.sku
    LEFT JOIN ads_compare ac ON ac.sku = sm.sku
    ` : sql``}
    WHERE sm.store_id = ${storeId} AND sm.deleted_at IS NULL
    ${productType ? sql`AND sm.product_type = ${productType}` : sql``}
    ${status ? sql`AND sm.status = ${status}` : sql``}
    ${search ? sql`AND (sm.sku ILIKE ${'%' + search + '%'} OR sm.asin ILIKE ${'%' + search + '%'} OR sm.product_type ILIKE ${'%' + search + '%'} OR sm.niche ILIKE ${'%' + search + '%'} OR sm.pic_mkt ILIKE ${'%' + search + '%'})` : sql``}
  `;

  // 3. Process items in JavaScript with exact formulas
  const processedItems: SkuWinItem[] = rows.map((r) => {
    const revenue = Number(r.revenue || 0);
    const orderCount = Number(r.order_count || 0);
    const quantity = Number(r.quantity || 0);
    const adsFee = Number(r.ads_fee || 0);
    const basecost = Number(r.basecost || 0);
    const promotion = Number(r.promotion || 0);
    const returnCost = Math.abs(Number(r.return_cost || 0));
    const returnCount = Number(r.return_count || 0);
    const revenueAds = Number(r.revenue_ads || 0);
    const allTimeQuantity = Number(r.all_time_quantity || 0);
    const shippedQty = Number(r.shipped_qty || 0);

    const amazonFeeUnit = Number(r.amazon_fee_unit || 0);
    const referralFeePct = Number(r.referral_fee_pct || 0.15);
    const customPrice = r.custom_price != null ? Number(r.custom_price) : null;

    // Amazon Fee = referral fee on revenue + fixed AMZ fee per unique order.
    // The fixed fee is charged by amazon_order_id, not by item quantity.
    const amazonFee = (referralFeePct * revenue) + (orderCount * amazonFeeUnit);

    // Thuế = 15% x 10% x giá (giá này lấy ở orders) + 1% revenue + 10% spend ads
    // = 1.5% * revenue + 1% * revenue + 10% * spend ads
    // = 2.5% * revenue + 0.10 * adsFee
    const thue = (referralFeePct * 0.10 * revenue) + (0.01 * revenue) + (0.10 * adsFee);

    // Profit = Revenue - Ads Fee - Basecost - Amazon Fee - Thuế - Promotion - Return
    const profit = revenue - adsFee - basecost - amazonFee - thue - promotion - returnCost;

    // Ratios & Rates
    const profitPerItem = quantity > 0 ? profit / quantity : 0;
    const basecostPerItem = quantity > 0 ? basecost / quantity : 0;
    const tacos = revenue > 0 ? adsFee / revenue : 0;
    const acos = revenueAds > 0 ? adsFee / revenueAds : 0;
    const margin = revenue > 0 ? profit / revenue : 0;
    const roi = basecost > 0 ? profit / basecost : 0;
    const returnRate = quantity > 0 ? returnCount / quantity : 0;

    // Targets
    const revenueTarget = r.revenue_target != null ? Number(r.revenue_target) : null;
    const unitTarget = r.unit_target != null ? Number(r.unit_target) : null;
    const spendTarget = r.spend_target != null ? Number(r.spend_target) : null;
    const profitTarget = r.profit_target != null ? Number(r.profit_target) : null;

    // Comparison period processing if requested
    let compareRevenue: number | undefined;
    let compareQuantity: number | undefined;
    let compareAdsFee: number | undefined;
    let compareTacos: number | undefined;
    let compareProfit: number | undefined;
    let growth: number | null | undefined;

    if (hasCompareFilter) {
      compareRevenue = Number(r.compare_revenue || 0);
      const compareOrderCount = Number(r.compare_order_count || 0);
      compareQuantity = Number(r.compare_quantity || 0);
      compareAdsFee = Number(r.compare_ads_fee || 0);
      const compareBasecost = Number(r.compare_basecost || 0);
      const comparePromo = Number(r.compare_promotion || 0);
      const compareAmzFee = (referralFeePct * compareRevenue) + (compareOrderCount * amazonFeeUnit);
      const compareThue = (referralFeePct * 0.10 * compareRevenue) + (0.01 * compareRevenue) + (0.10 * compareAdsFee);
      compareProfit = compareRevenue - compareAdsFee - compareBasecost - compareAmzFee - compareThue - comparePromo;
      compareTacos = compareRevenue > 0 ? compareAdsFee / compareRevenue : 0;
      growth = compareProfit !== 0 ? (profit - compareProfit) / Math.abs(compareProfit) : null;
    }

    return {
      id: String(r.id || ""),
      sku: String(r.sku || ""),
      asin: r.asin ? String(r.asin) : null,
      product_type: r.product_type ? String(r.product_type) : null,
      mockup: r.mockup ? String(r.mockup) : null,
      mockup_url: r.mockup_url ? String(r.mockup_url) : null,
      brand: r.brand ? String(r.brand) : null,
      status: r.status ? String(r.status) : null,
      niche: r.niche ? String(r.niche) : null,
      pic_mkt: r.pic_mkt ? String(r.pic_mkt) : null,
      amazon_fee_unit: amazonFeeUnit,
      referral_fee_pct: referralFeePct,
      custom_price: customPrice,
      revenue,
      quantity,
      ads_fee: adsFee,
      basecost,
      amazon_fee: amazonFee,
      thue,
      promotion,
      return_cost: returnCost,
      profit,
      profit_per_item: profitPerItem,
      basecost_per_item: basecostPerItem,
      tacos,
      acos,
      margin,
      roi,
      revenue_ads: revenueAds,
      all_time_quantity: allTimeQuantity,
      return_count: returnCount,
      return_rate: returnRate,
      shipped_qty: shippedQty,
      revenue_target: revenueTarget,
      unit_target: unitTarget,
      spend_target: spendTarget,
      profit_target: profitTarget,
      compare_revenue: compareRevenue,
      compare_quantity: compareQuantity,
      compare_ads_fee: compareAdsFee,
      compare_tacos: compareTacos,
      compare_profit: compareProfit,
      growth,
    };
  });

  // 4. Quick Classification Filter (win, loss, ordered, all)
  let filteredItems = processedItems;
  if (skuType === "win") {
    filteredItems = filteredItems.filter((item) => item.profit > 0);
  } else if (skuType === "loss") {
    filteredItems = filteredItems.filter((item) => item.profit <= 0 && (item.revenue > 0 || item.ads_fee > 0));
  } else if (skuType === "ordered") {
    filteredItems = filteredItems.filter((item) => item.quantity > 0);
  }

  // 5. Calculate overall Stats for all filtered items
  let totalRevenue = 0;
  let totalQuantity = 0;
  let totalAdsFee = 0;
  let totalBasecost = 0;
  let totalAmazonFee = 0;
  let totalThue = 0;
  let totalPromotion = 0;
  let totalReturnCost = 0;
  let totalProfit = 0;
  let totalRevenueAds = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const item of filteredItems) {
    totalRevenue += item.revenue;
    totalQuantity += item.quantity;
    totalAdsFee += item.ads_fee;
    totalBasecost += item.basecost;
    totalAmazonFee += item.amazon_fee;
    totalThue += item.thue;
    totalPromotion += item.promotion;
    totalReturnCost += item.return_cost;
    totalProfit += item.profit;
    totalRevenueAds += item.revenue_ads;
    if (item.profit > 0) winCount++;
    else if (item.profit < 0 || item.revenue > 0 || item.ads_fee > 0) lossCount++;
  }

  const stats: SkuWinStats = {
    totalSkus: filteredItems.length,
    totalRevenue,
    totalQuantity,
    totalAdsFee,
    totalBasecost,
    totalAmazonFee,
    totalThue,
    totalPromotion,
    totalReturnCost,
    totalProfit,
    totalRevenueAds,
    avgMargin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
    avgTacos: totalRevenue > 0 ? totalAdsFee / totalRevenue : 0,
    avgRoi: totalBasecost > 0 ? totalProfit / totalBasecost : 0,
    winCount,
    lossCount,
  };

  // 6. Sort
  filteredItems.sort((a, b) => {
    const aVal = (a as unknown as Record<string, unknown>)[sortField] ?? "";
    const bVal = (b as unknown as Record<string, unknown>)[sortField] ?? "";

    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    }
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    return sortDirection === "desc"
      ? bStr.localeCompare(aStr, "vi")
      : aStr.localeCompare(bStr, "vi");
  });

  // 7. Paginate
  const total = filteredItems.length;
  const paginatedItems = filteredItems.slice((page - 1) * limit, page * limit);

  return {
    items: paginatedItems,
    total,
    stats,
    productTypes,
    statuses,
  };
}

export async function updateSkuWinCustomFields(
  storeId: string,
  skuId: string,
  updates: {
    price?: number | null;
    targets?: {
      revenue?: number | null;
      unit?: number | null;
      spend?: number | null;
      profit?: number | null;
    };
  }
) {
  const sql = await getDatabaseClient();

  const [existing] = await sql<{ custom_fields: Record<string, unknown> }[]>`
    SELECT custom_fields FROM accounting_sku_master
    WHERE id = ${skuId} AND store_id = ${storeId}
  `;

  if (!existing) {
    throw new Error("SKU not found in this store");
  }

  const customFields = { ...(existing.custom_fields || {}) };

  if (updates.price !== undefined) {
    if (updates.price === null || updates.price === 0) {
      delete customFields.price;
    } else {
      customFields.price = updates.price;
    }
  }

  if (updates.targets !== undefined) {
    customFields.targets = {
      ...(customFields.targets || {}),
      ...updates.targets,
    };
  }

  await sql`
    UPDATE accounting_sku_master
    SET custom_fields = ${JSON.stringify(customFields)}::jsonb, updated_at = NOW()
    WHERE id = ${skuId} AND store_id = ${storeId}
  `;

  return customFields;
}
