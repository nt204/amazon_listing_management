import "server-only";

import { getDatabaseClient } from "@/lib/db";

export interface FbaDailyItem {
  id: string; // date string YYYY-MM-DD
  date: string;
  week: string; // e.g. "Tuần 1", "Tuần 2"
  month: string; // e.g. "THÁNG 1", "THÁNG 2"
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  profit: number;
  balance: number;
  roi: number;
  tacos: number;
  acos: number;
  margin: number;
  margin_pre_ads: number;
  profit_per_item: number;
  revenue_ads: number;
  quantity_ads: number;
  clicks: number;
}

export interface FbaDailyStats {
  totalDays: number;
  totalRevenue: number;
  totalQuantity: number;
  totalAdsFee: number;
  totalBasecost: number;
  totalAmazonFee: number;
  totalThue: number;
  totalPromotion: number;
  totalReturnCost: number;
  totalProfit: number;
  totalBalance: number;
  totalRevenueAds: number;
  totalClicks: number;
  avgRoi: number;
  avgTacos: number;
  avgAcos: number;
  avgMargin: number;
}

export interface ListFbaDailyOptions {
  startDate?: string;
  endDate?: string;
  search?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  page?: number;
  limit?: number;
}

function getExcelWeekNum(dateStr: string): number {
  try {
    const d = new Date(dateStr + "T00:00:00Z");
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor((d.getTime() - yearStart.getTime()) / 86400000) + 1;
    const dayOfWeek = yearStart.getUTCDay(); // 0 is Sunday
    return Math.floor((dayOfYear + dayOfWeek - 1) / 7) + 1;
  } catch {
    return 1;
  }
}

export async function listFbaDaily(
  storeId: string,
  options: ListFbaDailyOptions = {}
): Promise<{ items: FbaDailyItem[]; total: number; stats: FbaDailyStats }> {
  const sql = await getDatabaseClient();

  const startDate = options.startDate?.trim() || "";
  const endDate = options.endDate?.trim() || "";
  const search = options.search?.trim() || "";
  const sortField = options.sortField || "date";
  const sortDirection = options.sortDirection || "desc";
  const page = Math.max(1, options.page || 1);
  const limit = options.limit && options.limit > 0 ? options.limit : 100;

  const hasDateFilter = Boolean(startDate && endDate);

  // Daily aggregation across orders (FBA), ads, and returns
  const rows = await sql<Record<string, unknown>[]>`
    WITH daily_orders AS (
      SELECT 
        o.date,
        COUNT(DISTINCT COALESCE(o.amazon_order_id, o.id::text)) as order_count,
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
        ) as total_basecost,
        SUM(
          CASE 
            WHEN COALESCE(o.item_price, 0) = 0 THEN 0
            ELSE COALESCE(sm.amazon_fee, 0) + (COALESCE(sm.referral_fee_pct, 0.15) * COALESCE(o.item_price, 0) * (
              CASE 
                WHEN o.currency = 'CAD' THEN 0.738 
                WHEN o.currency = 'MXN' THEN 0.056 
                ELSE 1.0 
              END
            ))
          END
        ) as total_amz_fee
      FROM accounting_orders o
      LEFT JOIN accounting_sku_master sm ON sm.store_id = o.store_id AND sm.sku = o.sku
      LEFT JOIN accounting_monthly_base_cost mbc 
        ON mbc.store_id = o.store_id 
        AND mbc.sku = o.sku 
        AND mbc.period = to_char(o.date, 'YYYY-MM')
      WHERE o.store_id = ${storeId}
        AND (o.fulfillment_channel = 'Amazon' OR o.fulfillment_channel IS NULL)
        AND (o.order_status != 'Cancelled' OR o.order_status IS NULL)
        AND o.item_price IS NOT NULL
        ${hasDateFilter ? sql`AND o.date >= ${startDate}::date AND o.date <= ${endDate}::date` : sql``}
      GROUP BY o.date
    ),
    daily_ads AS (
      SELECT 
        date,
        SUM(spend) as total_spend,
        SUM(sales) as total_ad_sales,
        SUM(orders) as total_ad_orders,
        SUM(clicks) as total_clicks
      FROM accounting_ads
      WHERE store_id = ${storeId}
        ${hasDateFilter ? sql`AND date >= ${startDate}::date AND date <= ${endDate}::date` : sql``}
      GROUP BY date
    ),
    daily_returns AS (
      SELECT 
        r.date,
        COUNT(*) as return_count,
        SUM(
          GREATEST(
            0, 
            ABS(COALESCE(r.total, 0)) - COALESCE(
              NULLIF(ABS(r.basecost), 0),
              (
                SELECT SUM(COALESCE(orig_mbc.basecost_thang, orig_sm.basecost_tb, 0) * COALESCE(orig_o.quantity, 1))
                FROM accounting_orders orig_o
                LEFT JOIN accounting_sku_master orig_sm ON orig_sm.store_id = orig_o.store_id AND orig_sm.sku = orig_o.sku
                LEFT JOIN accounting_monthly_base_cost orig_mbc ON orig_mbc.store_id = orig_o.store_id AND orig_mbc.sku = orig_o.sku AND orig_mbc.period = to_char(orig_o.date, 'YYYY-MM')
                WHERE orig_o.store_id = r.store_id AND orig_o.amazon_order_id = r.order_id
              ),
              mbc.basecost_thang, 
              sm.basecost_tb, 
              0
            )
          )
        ) as return_total
      FROM accounting_returns r
      LEFT JOIN accounting_sku_master sm ON sm.store_id = r.store_id AND sm.sku = r.sku
      LEFT JOIN accounting_monthly_base_cost mbc 
        ON mbc.store_id = r.store_id 
        AND mbc.sku = r.sku
        AND mbc.period = to_char(r.date, 'YYYY-MM')
      WHERE r.store_id = ${storeId}
        ${hasDateFilter ? sql`AND r.date >= ${startDate}::date AND r.date <= ${endDate}::date` : sql``}
      GROUP BY r.date
    ),
    all_dates AS (
      SELECT date FROM daily_orders
      UNION
      SELECT date FROM daily_ads
      UNION
      SELECT date FROM daily_returns
    )
    SELECT 
      d.date,
      to_char(d.date, 'YYYY-MM-DD') as date_str,
      COALESCE(o.total_rev, 0)::numeric as revenue,
      COALESCE(o.total_qty, 0)::numeric as quantity,
      COALESCE(a.total_spend, 0)::numeric as ads_fee,
      COALESCE(o.total_basecost, 0)::numeric as basecost,
      COALESCE(o.total_amz_fee, 0)::numeric as amazon_fee,
      COALESCE(o.total_promo, 0)::numeric as promotion,
      COALESCE(r.return_total, 0)::numeric as return_cost,
      COALESCE(a.total_ad_sales, 0)::numeric as revenue_ads,
      COALESCE(a.total_ad_orders, 0)::numeric as quantity_ads,
      COALESCE(a.total_clicks, 0)::numeric as clicks
    FROM all_dates d
    LEFT JOIN daily_orders o ON o.date = d.date
    LEFT JOIN daily_ads a ON a.date = d.date
    LEFT JOIN daily_returns r ON r.date = d.date
    ORDER BY d.date DESC
  `;

  // Compute metrics for each day
  const items: FbaDailyItem[] = rows.map((r) => {
    const dateStr = String(r.date_str || (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date)));
    const revenue = Number(r.revenue || 0);
    const quantity = Number(r.quantity || 0);
    const adsFee = Number(r.ads_fee || 0);
    const basecost = Number(r.basecost || 0);
    const amazonFee = Number(r.amazon_fee || 0);
    const promotion = Number(r.promotion || 0);
    const returnCost = Math.abs(Number(r.return_cost || 0));
    const revenueAds = Number(r.revenue_ads || 0);
    const quantityAds = Number(r.quantity_ads || 0);
    const clicks = Number(r.clicks || 0);

    // Thuế = 2.5% * revenue + 10% * adsFee
    const thue = (0.025 * revenue) + (0.10 * adsFee);

    // Profit = Revenue - Ads Fee - Basecost - Amazon Fee - Thuế - Promotion - Return
    const profit = revenue - adsFee - basecost - amazonFee - thue - promotion - returnCost;

    // Balance = Revenue - Amazon Fee - Ads Fee - Return Cost
    const balance = revenue - amazonFee - adsFee - returnCost;

    // Ratios
    const roi = basecost > 0 ? profit / basecost : 0;
    const tacos = revenue > 0 ? adsFee / revenue : 0;
    const acos = revenueAds > 0 ? adsFee / revenueAds : 0;
    const margin = revenue > 0 ? profit / revenue : 0;
    const marginPreAds = revenue > 0 ? (revenue - basecost - amazonFee) / revenue : 0;
    const profitPerItem = quantity > 0 ? profit / quantity : 0;

    const weekNum = getExcelWeekNum(dateStr);
    const dObj = new Date(dateStr + "T00:00:00Z");
    const monthStr = `THÁNG ${dObj.getUTCMonth() + 1}`;

    return {
      id: dateStr,
      date: dateStr,
      week: `Tuần ${weekNum}`,
      month: monthStr,
      revenue,
      quantity,
      ads_fee: adsFee,
      basecost,
      amazon_fee: amazonFee,
      thue,
      promotion,
      return_cost: returnCost,
      profit,
      balance,
      roi,
      tacos,
      acos,
      margin,
      margin_pre_ads: marginPreAds,
      profit_per_item: profitPerItem,
      revenue_ads: revenueAds,
      quantity_ads: quantityAds,
      clicks,
    };
  });

  // Filter by search if provided
  let filtered = items;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.date.includes(q) ||
        item.week.toLowerCase().includes(q) ||
        item.month.toLowerCase().includes(q)
    );
  }

  // Sort
  filtered.sort((a, b) => {
    let aVal: number | string = a[sortField as keyof FbaDailyItem] as number | string;
    let bVal: number | string = b[sortField as keyof FbaDailyItem] as number | string;

    if (aVal == null) aVal = "";
    if (bVal == null) bVal = "";

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDirection === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    const diff = (Number(aVal) || 0) - (Number(bVal) || 0);
    return sortDirection === "asc" ? diff : -diff;
  });

  // Calculate overall stats
  let totalRevenue = 0;
  let totalQuantity = 0;
  let totalAdsFee = 0;
  let totalBasecost = 0;
  let totalAmazonFee = 0;
  let totalThue = 0;
  let totalPromotion = 0;
  let totalReturnCost = 0;
  let totalProfit = 0;
  let totalBalance = 0;
  let totalRevenueAds = 0;
  let totalClicks = 0;

  for (const item of filtered) {
    totalRevenue += item.revenue;
    totalQuantity += item.quantity;
    totalAdsFee += item.ads_fee;
    totalBasecost += item.basecost;
    totalAmazonFee += item.amazon_fee;
    totalThue += item.thue;
    totalPromotion += item.promotion;
    totalReturnCost += item.return_cost;
    totalProfit += item.profit;
    totalBalance += item.balance;
    totalRevenueAds += item.revenue_ads;
    totalClicks += item.clicks;
  }

  const avgRoi = totalBasecost > 0 ? totalProfit / totalBasecost : 0;
  const avgTacos = totalRevenue > 0 ? totalAdsFee / totalRevenue : 0;
  const avgAcos = totalRevenueAds > 0 ? totalAdsFee / totalRevenueAds : 0;
  const avgMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;

  const stats: FbaDailyStats = {
    totalDays: filtered.length,
    totalRevenue,
    totalQuantity,
    totalAdsFee,
    totalBasecost,
    totalAmazonFee,
    totalThue,
    totalPromotion,
    totalReturnCost,
    totalProfit,
    totalBalance,
    totalRevenueAds,
    totalClicks,
    avgRoi,
    avgTacos,
    avgAcos,
    avgMargin,
  };

  // Pagination
  const total = filtered.length;
  const startIndex = (page - 1) * limit;
  const paginatedItems = filtered.slice(startIndex, startIndex + limit);

  return {
    items: paginatedItems,
    total,
    stats,
  };
}
