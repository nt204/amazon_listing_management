// app/api/ppc/search-terms/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";
import type { MatchType, PpcAdType } from "@/lib/ppc/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const started = performance.now();
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);

    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Math.max(1, Math.min(3650, Number(searchParams.get("days") || 30)));
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(200, Math.max(10, Number(searchParams.get("pageSize") || 50)));
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const campaignName = searchParams.get("campaignName")?.trim() || "";
    const adGroupName = searchParams.get("adGroupName")?.trim() || "";
    const sortBy = searchParams.get("sortBy") || "spend";
    const sortDir = (searchParams.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const minClicksParam = searchParams.get("minClicks")?.trim();
    const maxClicksParam = searchParams.get("maxClicks")?.trim();
    const minClicks = minClicksParam !== undefined && minClicksParam !== "" && !isNaN(Number(minClicksParam)) ? Number(minClicksParam) : null;
    const maxClicks = maxClicksParam !== undefined && maxClicksParam !== "" && !isNaN(Number(maxClicksParam)) ? Number(maxClicksParam) : null;

    const minOrdersParam = searchParams.get("minOrders")?.trim();
    const maxOrdersParam = searchParams.get("maxOrders")?.trim();
    const minOrders = minOrdersParam !== undefined && minOrdersParam !== "" && !isNaN(Number(minOrdersParam)) ? Number(minOrdersParam) : null;
    const maxOrders = maxOrdersParam !== undefined && maxOrdersParam !== "" && !isNaN(Number(maxOrdersParam)) ? Number(maxOrdersParam) : null;

    const minAcosParam = searchParams.get("minAcos")?.trim();
    const maxAcosParam = searchParams.get("maxAcos")?.trim();
    const minAcos = minAcosParam !== undefined && minAcosParam !== "" && !isNaN(Number(minAcosParam)) ? Number(minAcosParam) : null;
    const maxAcos = maxAcosParam !== undefined && maxAcosParam !== "" && !isNaN(Number(maxAcosParam)) ? Number(maxAcosParam) : null;

    const matchType = searchParams.get("matchType")?.trim() || "";
    const performanceFilter = searchParams.get("performanceFilter")?.trim() || "";

    const startDateParam = searchParams.get("startDate")?.trim() || "";
    const endDateParam = searchParams.get("endDate")?.trim() || "";
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) ? startDateParam : undefined;
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateParam) ? endDateParam : undefined;

    const sql = await getDatabaseClient();

    const cacheKey = `ppc:query:search-terms-page:${scope.teamId}:${request.url}`;
    const cachedData = await getCachedOrFetch(cacheKey, 60, async () => {
      let storeId: string | null = null;
      if (storeName !== "ALL") {
        const storeRows = await sql<{ id: string }[]>`
          SELECT id FROM ppc_stores
          WHERE team_id = ${scope.teamId} AND lower(name) = lower(${storeName})
          LIMIT 1
        `;
        if (storeRows.length > 0) storeId = storeRows[0].id;
      }

      const anchorCte = sql`
        SELECT COALESCE(MAX(p0.report_date), CURRENT_DATE - 1) AS max_date
        FROM ppc_search_terms p0
        JOIN ppc_stores s0 ON s0.id = p0.store_id
        WHERE s0.team_id = ${scope.teamId}
          ${storeId ? sql`AND p0.store_id = ${storeId}` : sql``}
      `;

      const searchFilter = search
        ? sql`AND (
            lower(p.customer_search_term) LIKE ${`%${search}%`}
            OR lower(p.campaign_name) LIKE ${`%${search}%`}
            OR lower(p.ad_group_name) LIKE ${`%${search}%`}
            OR lower(p.target_keyword) LIKE ${`%${search}%`}
          )`
        : sql``;

      const campaignFilter = campaignName
        ? sql`AND lower(p.campaign_name) = lower(${campaignName})`
        : sql``;

      const adGroupFilter = adGroupName
        ? sql`AND lower(p.ad_group_name) = lower(${adGroupName})`
        : sql``;

      const skuFilter = sku !== "ALL"
        ? sql`AND (
            lower(p.portfolio_name) = lower(${sku})
            OR position(lower(${sku}) in lower(p.campaign_name)) > 0
          )`
        : sql``;

      const clicksFilter = sql`
        ${minClicks !== null ? sql`AND p.clicks >= ${minClicks}` : sql``}
        ${maxClicks !== null ? sql`AND p.clicks <= ${maxClicks}` : sql``}
      `;

      const ordersFilter = sql`
        ${minOrders !== null ? sql`AND p.orders >= ${minOrders}` : sql``}
        ${maxOrders !== null ? sql`AND p.orders <= ${maxOrders}` : sql``}
      `;

      const acosFilter = sql`
        ${minAcos !== null ? sql`AND (CASE WHEN p.sales > 0 THEN (p.spend / p.sales) * 100 WHEN p.spend > 0 THEN 999 ELSE 0 END) >= ${minAcos}` : sql``}
        ${maxAcos !== null ? sql`AND (CASE WHEN p.sales > 0 THEN (p.spend / p.sales) * 100 WHEN p.spend > 0 THEN 999 ELSE 0 END) <= ${maxAcos}` : sql``}
      `;

      const matchTypeFilterClause = matchType && matchType !== "ALL"
        ? sql`AND lower(p.match_type) = lower(${matchType})`
        : sql``;

      let performanceFilterClause = sql``;
      if (performanceFilter === "WITH_ORDERS") {
        performanceFilterClause = sql`AND p.orders > 0`;
      } else if (performanceFilter === "ZERO_ORDERS_BLEEDING") {
        performanceFilterClause = sql`AND p.orders = 0 AND p.clicks >= 9`;
      } else if (performanceFilter === "HIGH_ACOS") {
        performanceFilterClause = sql`AND p.orders > 0 AND p.sales > 0 AND (p.spend / p.sales) * 100 > 60`;
      }

      // 1. Query Summary & Total Count trên TOÀN BỘ tập dữ liệu thỏa mãn bộ lọc
      const summaryRows = await sql<Array<{
        total_count: number;
        total_spend: string;
        total_sales: string;
        total_orders: number;
        total_clicks: number;
        total_impressions: string;
      }>>`
        WITH anchor AS (${anchorCte}),
        daily_counts AS (
          SELECT store_id, ad_type, COUNT(*) as cnt
          FROM ppc_search_terms
          WHERE report_granularity = 'DAILY'
          GROUP BY store_id, ad_type
        ),
        latest_range AS (
          SELECT store_id, ad_type, MAX(report_end_date) as max_end_date
          FROM ppc_search_terms
          WHERE report_granularity = 'RANGE'
          GROUP BY store_id, ad_type
        )
        SELECT
          COUNT(*)::integer AS total_count,
          COALESCE(SUM(p.spend), 0)::numeric AS total_spend,
          COALESCE(SUM(p.sales), 0)::numeric AS total_sales,
          COALESCE(SUM(p.orders), 0)::integer AS total_orders,
          COALESCE(SUM(p.clicks), 0)::integer AS total_clicks,
          COALESCE(SUM(p.impressions), 0)::bigint AS total_impressions
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        CROSS JOIN anchor a
        LEFT JOIN daily_counts dc ON dc.store_id = p.store_id AND dc.ad_type = p.ad_type
        LEFT JOIN latest_range lr ON lr.store_id = p.store_id AND lr.ad_type = p.ad_type
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          ${campaignFilter}
          ${adGroupFilter}
          ${clicksFilter}
          ${ordersFilter}
          ${acosFilter}
          ${matchTypeFilterClause}
          ${performanceFilterClause}
          AND (
            (
              p.report_granularity = 'DAILY'
              AND (${!startDate} OR p.report_date >= ${startDate || "1970-01-01"}::date)
              AND (${!endDate} OR p.report_date <= ${endDate || "2099-12-31"}::date)
              AND (${Boolean(startDate || endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
            )
            OR
            (
              p.report_granularity = 'RANGE'
              AND (dc.cnt IS NULL OR dc.cnt = 0)
              AND p.report_end_date = lr.max_end_date
            )
          )
      `;

      const rawSummary = summaryRows[0] || {
        total_count: 0,
        total_spend: "0",
        total_sales: "0",
        total_orders: 0,
        total_clicks: 0,
        total_impressions: "0",
      };

      const total = Number(rawSummary.total_count || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      // 2. Dynamic Order By
      let orderClause = sql`p.spend DESC, p.orders DESC`;
      if (sortBy === "sales") {
        orderClause = sortDir === "ASC" ? sql`p.sales ASC, p.spend ASC` : sql`p.sales DESC, p.spend DESC`;
      } else if (sortBy === "orders") {
        orderClause = sortDir === "ASC" ? sql`p.orders ASC, p.sales ASC` : sql`p.orders DESC, p.sales DESC`;
      } else if (sortBy === "clicks") {
        orderClause = sortDir === "ASC" ? sql`p.clicks ASC, p.spend ASC` : sql`p.clicks DESC, p.spend DESC`;
      } else if (sortBy === "impressions") {
        orderClause = sortDir === "ASC" ? sql`p.impressions ASC, p.clicks ASC` : sql`p.impressions DESC, p.clicks DESC`;
      } else if (sortBy === "cpc") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN p.clicks > 0 THEN p.spend / p.clicks ELSE 999 END) ASC`
          : sql`(CASE WHEN p.clicks > 0 THEN p.spend / p.clicks ELSE 0 END) DESC`;
      } else if (sortBy === "acos") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN p.sales > 0 THEN p.spend / p.sales ELSE 999 END) ASC`
          : sql`(CASE WHEN p.sales > 0 THEN p.spend / p.sales ELSE 0 END) DESC`;
      } else if (sortBy === "date") {
        orderClause = sortDir === "ASC" ? sql`p.report_date ASC, p.id ASC` : sql`p.report_date DESC, p.id DESC`;
      } else {
        orderClause = sortDir === "ASC" ? sql`p.spend ASC, p.orders ASC` : sql`p.spend DESC, p.orders DESC`;
      }

      // 3. Paginated Items
      const rows = await sql<Array<{
        id: string;
        store_id: string;
        store_name: string;
        campaign_id: string | null;
        campaign_name: string;
        ad_group_id: string | null;
        ad_group_name: string;
        keyword_id: string | null;
        target_keyword: string | null;
        customer_search_term: string;
        match_type: string;
        ad_type: string;
        impressions: number;
        clicks: number;
        spend: string;
        sales: string;
        orders: number;
        report_date: string;
      }>>`
        WITH anchor AS (${anchorCte}),
        daily_counts AS (
          SELECT store_id, ad_type, COUNT(*) as cnt
          FROM ppc_search_terms
          WHERE report_granularity = 'DAILY'
          GROUP BY store_id, ad_type
        ),
        latest_range AS (
          SELECT store_id, ad_type, MAX(report_end_date) as max_end_date
          FROM ppc_search_terms
          WHERE report_granularity = 'RANGE'
          GROUP BY store_id, ad_type
        )
        SELECT
          p.id,
          p.store_id,
          s.name AS store_name,
          p.campaign_id,
          p.campaign_name,
          p.ad_group_id,
          p.ad_group_name,
          p.keyword_id,
          p.target_keyword,
          p.customer_search_term,
          p.match_type,
          p.ad_type,
          p.impressions::integer AS impressions,
          p.clicks::integer AS clicks,
          p.spend::numeric AS spend,
          p.sales::numeric AS sales,
          p.orders::integer AS orders,
          p.report_date::text AS report_date
        FROM ppc_search_terms p
        JOIN ppc_stores s ON s.id = p.store_id
        CROSS JOIN anchor a
        LEFT JOIN daily_counts dc ON dc.store_id = p.store_id AND dc.ad_type = p.ad_type
        LEFT JOIN latest_range lr ON lr.store_id = p.store_id AND lr.ad_type = p.ad_type
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
          ${skuFilter}
          ${searchFilter}
          ${campaignFilter}
          ${adGroupFilter}
          ${clicksFilter}
          ${ordersFilter}
          ${acosFilter}
          ${matchTypeFilterClause}
          ${performanceFilterClause}
          AND (
            (
              p.report_granularity = 'DAILY'
              AND (${!startDate} OR p.report_date >= ${startDate || "1970-01-01"}::date)
              AND (${!endDate} OR p.report_date <= ${endDate || "2099-12-31"}::date)
              AND (${Boolean(startDate || endDate)} OR (p.report_date >= a.max_date - (${days} - 1)::integer AND p.report_date <= a.max_date))
            )
            OR
            (
              p.report_granularity = 'RANGE'
              AND (dc.cnt IS NULL OR dc.cnt = 0)
              AND p.report_end_date = lr.max_end_date
            )
          )
        ORDER BY ${orderClause}
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      const items = rows.map((r) => {
        const spend = Number(r.spend || 0);
        const sales = Number(r.sales || 0);
        const clicks = Number(r.clicks || 0);
        const orders = Number(r.orders || 0);
        const impressions = Number(r.impressions || 0);
        const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
        const ctr = impressions > 0 ? Math.round((clicks / impressions) * 1_000_000) / 1_000_000 : 0;
        const cvr = clicks > 0 ? Math.round((orders / clicks) * 1_000_000) / 1_000_000 : 0;
        const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : (spend > 0 ? 999 : 0);
        const roas = spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0;

        return {
          id: r.id,
          storeId: r.store_id,
          storeName: r.store_name,
          campaignId: r.campaign_id,
          campaignName: r.campaign_name,
          adGroupId: r.ad_group_id,
          adGroupName: r.ad_group_name,
          keywordId: r.keyword_id,
          targetKeyword: r.target_keyword,
          customerSearchTerm: r.customer_search_term,
          matchType: r.match_type as MatchType,
          adType: r.ad_type as PpcAdType,
          impressions,
          clicks,
          spend: Math.round(spend * 100) / 100,
          sales: Math.round(sales * 100) / 100,
          orders,
          cpc,
          ctr,
          cvr,
          acos,
          roas,
          reportDate: r.report_date,
        };
      });

      const totalSpend = Math.round(Number(rawSummary.total_spend || 0) * 100) / 100;
      const totalSales = Math.round(Number(rawSummary.total_sales || 0) * 100) / 100;
      const totalClicks = Number(rawSummary.total_clicks || 0);
      const totalOrders = Number(rawSummary.total_orders || 0);
      const totalImpressions = Number(rawSummary.total_impressions || 0);

      const summary = {
        totalTerms: total,
        totalSpend,
        totalSales,
        totalOrders,
        totalClicks,
        totalImpressions,
        cpc: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0,
        acos: totalSales > 0 ? Math.round((totalSpend / totalSales) * 1000) / 10 : (totalSpend > 0 ? 999 : 0),
        roas: totalSpend > 0 ? Math.round((totalSales / totalSpend) * 100) / 100 : 0,
      };

      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
        summary,
      };
    });

    return Response.json({
      success: true,
      data: cachedData,
      timingMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load Search Terms page");
  }
}
