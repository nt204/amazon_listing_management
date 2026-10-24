// app/api/ppc/search-terms/route.ts
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
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

      const skuFilter = sku !== "ALL"
        ? sql`AND lower(COALESCE(
            NULLIF(trim(p.sku), ''),
            NULLIF(trim(p.portfolio_name), ''),
            substring(p.campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
            'UNKNOWN_SKU'
          )) = lower(${sku})`
        : sql``;

      let performanceFilterClause = sql``;
      if (performanceFilter === "WITH_ORDERS") {
        performanceFilterClause = sql`AND g.orders > 0`;
      } else if (performanceFilter === "ZERO_ORDERS_BLEEDING") {
        performanceFilterClause = sql`AND g.orders = 0 AND g.clicks >= 9`;
      } else if (performanceFilter === "HIGH_ACOS") {
        performanceFilterClause = sql`AND g.orders > 0 AND g.sales > 0 AND (g.spend / g.sales) * 100 > 60`;
      }

      const groupedFilters = sql`
        ${search ? sql`AND (
          lower(g.customer_search_term) LIKE ${`%${search}%`}
          OR lower(g.sku) LIKE ${`%${search}%`}
          OR EXISTS (SELECT 1 FROM unnest(g.campaign_names) name WHERE lower(name) LIKE ${`%${search}%`})
          OR EXISTS (SELECT 1 FROM unnest(g.ad_group_names) name WHERE lower(name) LIKE ${`%${search}%`})
        )` : sql``}
        ${campaignName ? sql`AND EXISTS (
          SELECT 1 FROM unnest(g.campaign_names) name WHERE lower(name) = lower(${campaignName})
        )` : sql``}
        ${adGroupName ? sql`AND EXISTS (
          SELECT 1 FROM unnest(g.ad_group_names) name WHERE lower(name) = lower(${adGroupName})
        )` : sql``}
        ${matchType && matchType !== "ALL" ? sql`AND EXISTS (
          SELECT 1 FROM unnest(g.match_types) name WHERE lower(name) = lower(${matchType})
        )` : sql``}
        ${minClicks !== null ? sql`AND g.clicks >= ${minClicks}` : sql``}
        ${maxClicks !== null ? sql`AND g.clicks <= ${maxClicks}` : sql``}
        ${minOrders !== null ? sql`AND g.orders >= ${minOrders}` : sql``}
        ${maxOrders !== null ? sql`AND g.orders <= ${maxOrders}` : sql``}
        ${minAcos !== null ? sql`AND (CASE WHEN g.sales > 0 THEN (g.spend / g.sales) * 100 WHEN g.spend > 0 THEN 999 ELSE 0 END) >= ${minAcos}` : sql``}
        ${maxAcos !== null ? sql`AND (CASE WHEN g.sales > 0 THEN (g.spend / g.sales) * 100 WHEN g.spend > 0 THEN 999 ELSE 0 END) <= ${maxAcos}` : sql``}
        ${performanceFilterClause}
      `;

      const groupedCtes = sql`
        anchor AS (${anchorCte}),
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
        ),
        base AS (
          SELECT
            p.*,
            s.name AS store_name,
            upper(COALESCE(
              NULLIF(trim(p.sku), ''),
              NULLIF(trim(p.portfolio_name), ''),
              substring(p.campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
              'UNKNOWN_SKU'
            )) AS resolved_sku
          FROM ppc_search_terms p
          JOIN ppc_stores s ON s.id = p.store_id
          CROSS JOIN anchor a
          LEFT JOIN daily_counts dc ON dc.store_id = p.store_id AND dc.ad_type = p.ad_type
          LEFT JOIN latest_range lr ON lr.store_id = p.store_id AND lr.ad_type = p.ad_type
          WHERE s.team_id = ${scope.teamId}
            ${storeId ? sql`AND p.store_id = ${storeId}` : sql``}
            ${skuFilter}
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
        ),
        grouped AS (
          SELECT
            min(id::text) AS id,
            store_id,
            min(store_name) AS store_name,
            resolved_sku AS sku,
            min(trim(customer_search_term)) AS customer_search_term,
            COALESCE(array_agg(DISTINCT campaign_name ORDER BY campaign_name) FILTER (WHERE trim(campaign_name) <> ''), '{}'::text[]) AS campaign_names,
            COALESCE(array_agg(DISTINCT ad_group_name ORDER BY ad_group_name) FILTER (WHERE trim(ad_group_name) <> ''), '{}'::text[]) AS ad_group_names,
            COALESCE(array_agg(DISTINCT ad_type ORDER BY ad_type) FILTER (WHERE trim(ad_type) <> ''), '{}'::text[]) AS ad_types,
            COALESCE(array_agg(DISTINCT match_type ORDER BY match_type) FILTER (WHERE trim(match_type) <> ''), '{}'::text[]) AS match_types,
            SUM(impressions)::bigint AS impressions,
            SUM(clicks)::bigint AS clicks,
            SUM(spend)::numeric AS spend,
            SUM(sales)::numeric AS sales,
            SUM(orders)::bigint AS orders,
            MAX(report_date)::text AS report_date
          FROM base
          GROUP BY store_id, resolved_sku, lower(trim(customer_search_term))
        )
      `;

      // 1. Query Summary & Total Count trên TOÀN BỘ tập dữ liệu thỏa mãn bộ lọc
      const summaryRows = await sql<Array<{
        total_count: number;
        total_spend: string;
        total_sales: string;
        total_orders: number;
        total_clicks: number;
        total_impressions: string;
      }>>`
        WITH ${groupedCtes}
        SELECT
          COUNT(*)::integer AS total_count,
          COALESCE(SUM(g.spend), 0)::numeric AS total_spend,
          COALESCE(SUM(g.sales), 0)::numeric AS total_sales,
          COALESCE(SUM(g.orders), 0)::bigint AS total_orders,
          COALESCE(SUM(g.clicks), 0)::bigint AS total_clicks,
          COALESCE(SUM(g.impressions), 0)::bigint AS total_impressions
        FROM grouped g
        WHERE TRUE ${groupedFilters}
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
      let orderClause = sql`g.spend DESC, g.orders DESC`;
      if (sortBy === "sales") {
        orderClause = sortDir === "ASC" ? sql`g.sales ASC, g.spend ASC` : sql`g.sales DESC, g.spend DESC`;
      } else if (sortBy === "orders") {
        orderClause = sortDir === "ASC" ? sql`g.orders ASC, g.sales ASC` : sql`g.orders DESC, g.sales DESC`;
      } else if (sortBy === "clicks") {
        orderClause = sortDir === "ASC" ? sql`g.clicks ASC, g.spend ASC` : sql`g.clicks DESC, g.spend DESC`;
      } else if (sortBy === "impressions") {
        orderClause = sortDir === "ASC" ? sql`g.impressions ASC, g.clicks ASC` : sql`g.impressions DESC, g.clicks DESC`;
      } else if (sortBy === "cpc") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN g.clicks > 0 THEN g.spend / g.clicks ELSE 999 END) ASC`
          : sql`(CASE WHEN g.clicks > 0 THEN g.spend / g.clicks ELSE 0 END) DESC`;
      } else if (sortBy === "ctr") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN g.impressions > 0 THEN g.clicks::numeric / g.impressions ELSE 0 END) ASC`
          : sql`(CASE WHEN g.impressions > 0 THEN g.clicks::numeric / g.impressions ELSE 0 END) DESC`;
      } else if (sortBy === "cvr") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN g.clicks > 0 THEN g.orders::numeric / g.clicks ELSE 0 END) ASC`
          : sql`(CASE WHEN g.clicks > 0 THEN g.orders::numeric / g.clicks ELSE 0 END) DESC`;
      } else if (sortBy === "acos") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN g.sales > 0 THEN g.spend / g.sales ELSE 999 END) ASC`
          : sql`(CASE WHEN g.sales > 0 THEN g.spend / g.sales ELSE 0 END) DESC`;
      } else if (sortBy === "date") {
        orderClause = sortDir === "ASC" ? sql`g.report_date ASC, g.id ASC` : sql`g.report_date DESC, g.id DESC`;
      } else {
        orderClause = sortDir === "ASC" ? sql`g.spend ASC, g.orders ASC` : sql`g.spend DESC, g.orders DESC`;
      }

      // 3. Paginated Items
      const rows = await sql<Array<{
        id: string;
        store_id: string;
        store_name: string;
        sku: string;
        campaign_names: string[];
        ad_group_names: string[];
        customer_search_term: string;
        match_types: string[];
        ad_types: string[];
        impressions: number;
        clicks: number;
        spend: string;
        sales: string;
        orders: number;
        report_date: string;
      }>>`
        WITH ${groupedCtes}
        SELECT g.*
        FROM grouped g
        WHERE TRUE ${groupedFilters}
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
          sku: r.sku,
          portfolioName: r.sku,
          campaignName: r.campaign_names[0] || "",
          campaignNames: r.campaign_names,
          adGroupName: r.ad_group_names[0] || "",
          adGroupNames: r.ad_group_names,
          targetKeyword: "",
          customerSearchTerm: r.customer_search_term,
          matchType: (r.match_types[0] || "Unknown") as MatchType,
          matchTypes: r.match_types,
          adType: (r.ad_types[0] || "UNKNOWN") as PpcAdType,
          adTypes: r.ad_types,
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
