// app/api/ppc/search-terms/optimization/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";

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
    const clickThreshold = Math.max(1, Number(searchParams.get("clickThreshold") || 20));
    const clickOperator = searchParams.get("clickOperator") === ">=" ? ">=" : ">";
    const hideAlreadyNegated = searchParams.get("hideAlreadyNegated") !== "false";
    const sortBy = searchParams.get("sortBy") || "clicks";
    const sortDir = (searchParams.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const startDateParam = searchParams.get("startDate")?.trim() || "";
    const endDateParam = searchParams.get("endDate")?.trim() || "";
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) ? startDateParam : undefined;
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateParam) ? endDateParam : undefined;

    const sql = await getDatabaseClient();

    const cacheKey = `ppc:query:st-opt:${scope.teamId}:${request.url}`;
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

      const thresholdCondition = clickOperator === ">="
        ? sql`SUM(p.clicks) >= ${clickThreshold} AND SUM(p.orders) = 0`
        : sql`SUM(p.clicks) > ${clickThreshold} AND SUM(p.orders) = 0`;

      const searchFilter = search
        ? sql`AND (
            lower(c.customer_search_term) LIKE ${`%${search}%`}
            OR lower(c.campaign_name) LIKE ${`%${search}%`}
            OR lower(c.ad_group_name) LIKE ${`%${search}%`}
          )`
        : sql``;

      const skuFilter = sku !== "ALL"
        ? sql`AND (
            lower(p.portfolio_name) = lower(${sku})
            OR position(lower(${sku}) in lower(p.campaign_name)) > 0
          )`
        : sql``;

      const negatedFilter = hideAlreadyNegated
        ? sql`AND NOT c.is_already_negated`
        : sql``;

      const baseCte = sql`
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
        ),
        raw_filtered AS (
          SELECT
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
            p.impressions,
            p.clicks,
            p.spend,
            p.sales,
            p.orders
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
        grouped_candidates AS (
          SELECT
            p.campaign_name,
            p.customer_search_term,
            (MIN(p.store_id::text))::uuid AS store_id,
            MIN(p.store_name) AS store_name,
            MIN(p.campaign_id) AS campaign_id,
            MIN(p.ad_group_id) AS ad_group_id,
            MIN(p.ad_group_name) AS ad_group_name,
            MIN(p.keyword_id) AS keyword_id,
            MIN(p.target_keyword) AS target_keyword,
            MIN(p.match_type) AS match_type,
            MIN(p.ad_type) AS ad_type,
            SUM(p.impressions)::integer AS impressions,
            SUM(p.clicks)::integer AS clicks,
            SUM(p.spend)::numeric AS spend,
            SUM(p.sales)::numeric AS sales,
            SUM(p.orders)::integer AS orders
          FROM raw_filtered p
          GROUP BY p.campaign_name, p.customer_search_term
          HAVING ${thresholdCondition}
        ),
        candidates_with_checks AS (
          SELECT
            gc.*,
            (EXISTS (
              SELECT 1 FROM ppc_performance_facts pf
              WHERE pf.store_id = gc.store_id
                AND pf.grain = 'TARGET'
                AND pf.is_negative = true
                AND lower(trim(pf.target_expression)) = lower(trim(gc.customer_search_term))
              LIMIT 1
            )) AS is_already_negated
          FROM grouped_candidates gc
        )
      `;

      // 1. Query Summary & Total Count trên TOÀN BỘ tập dữ liệu thỏa mãn bộ lọc
      const summaryRows = await sql<Array<{
        total_count: number;
        total_wasted_spend: string;
        total_wasted_clicks: number;
        total_impressions: string;
      }>>`
        ${baseCte}
        SELECT
          COUNT(*)::integer AS total_count,
          COALESCE(SUM(c.spend), 0)::numeric AS total_wasted_spend,
          COALESCE(SUM(c.clicks), 0)::integer AS total_wasted_clicks,
          COALESCE(SUM(c.impressions), 0)::bigint AS total_impressions
        FROM candidates_with_checks c
        WHERE 1=1
          ${negatedFilter}
          ${searchFilter}
      `;

      const rawSummary = summaryRows[0] || {
        total_count: 0,
        total_wasted_spend: "0",
        total_wasted_clicks: 0,
        total_impressions: "0",
      };

      const total = Number(rawSummary.total_count || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      // 2. Dynamic Order By
      let orderClause = sql`c.clicks DESC, c.spend DESC`;
      if (sortBy === "spend") {
        orderClause = sortDir === "ASC" ? sql`c.spend ASC, c.clicks ASC` : sql`c.spend DESC, c.clicks DESC`;
      } else if (sortBy === "cpc") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN c.clicks > 0 THEN c.spend / c.clicks ELSE 999 END) ASC`
          : sql`(CASE WHEN c.clicks > 0 THEN c.spend / c.clicks ELSE 0 END) DESC`;
      } else if (sortBy === "customerSearchTerm") {
        orderClause = sortDir === "ASC" ? sql`c.customer_search_term ASC` : sql`c.customer_search_term DESC`;
      } else if (sortBy === "campaignName") {
        orderClause = sortDir === "ASC" ? sql`c.campaign_name ASC` : sql`c.campaign_name DESC`;
      } else {
        orderClause = sortDir === "ASC" ? sql`c.clicks ASC, c.spend ASC` : sql`c.clicks DESC, c.spend DESC`;
      }

      // 3. Paginated Items
      const rows = await sql<Array<{
        campaign_name: string;
        customer_search_term: string;
        store_id: string;
        store_name: string;
        campaign_id: string | null;
        ad_group_id: string | null;
        ad_group_name: string;
        keyword_id: string | null;
        target_keyword: string | null;
        match_type: string;
        ad_type: string;
        impressions: number;
        clicks: number;
        spend: string;
        sales: string;
        orders: number;
        is_already_negated: boolean;
      }>>`
        ${baseCte}
        SELECT c.*
        FROM candidates_with_checks c
        WHERE 1=1
          ${negatedFilter}
          ${searchFilter}
        ORDER BY ${orderClause}
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      const items = rows.map((r) => {
        const spend = Number(r.spend || 0);
        const clicks = Number(r.clicks || 0);
        const impressions = Number(r.impressions || 0);
        const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
        const key = `${r.campaign_name.toLowerCase()}|||${r.customer_search_term.toLowerCase()}`;

        return {
          key,
          customerSearchTerm: r.customer_search_term,
          campaignName: r.campaign_name,
          adGroupName: r.ad_group_name || r.campaign_name,
          campaignId: r.campaign_id,
          adGroupId: r.ad_group_id,
          keywordId: r.keyword_id,
          targetKeyword: r.target_keyword || "",
          matchType: r.match_type || "Unknown",
          adType: r.ad_type || "SP",
          storeId: r.store_id,
          storeName: r.store_name,
          impressions,
          clicks,
          spend: Math.round(spend * 100) / 100,
          sales: 0,
          orders: 0,
          cpc,
          isAlreadyNegated: Boolean(r.is_already_negated),
        };
      });

      const totalWastedSpend = Math.round(Number(rawSummary.total_wasted_spend || 0) * 100) / 100;
      const totalWastedClicks = Number(rawSummary.total_wasted_clicks || 0);
      const totalImpressions = Number(rawSummary.total_impressions || 0);

      const summary = {
        candidateCount: total,
        totalWastedSpend,
        totalWastedClicks,
        totalImpressions,
        avgCpc: totalWastedClicks > 0 ? Math.round((totalWastedSpend / totalWastedClicks) * 100) / 100 : 0,
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
    return routeErrorResponse(error, "Failed to load ST Optimization candidates");
  }
}
