// app/api/ppc/search-terms/sale-keywords/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import {
  extractSkuFromText,
  isAsinProductTarget,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import { getCachedOrFetch } from "@/lib/redis";
import type { MatchType, PpcAdType } from "@/lib/ppc/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);

    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Math.max(1, Math.min(3650, Number(searchParams.get("days") || 30)));
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const fetchAll = searchParams.get("all") === "1";
    const pageSize = Math.min(5000, Math.max(10, Number(searchParams.get("pageSize") || 50)));
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const orderThreshold = Math.max(1, Number(searchParams.get("orderThreshold") || 2));
    const orderOperator = searchParams.get("orderOperator") === ">=" ? ">=" : ">";
    const hideLaunched = searchParams.get("hideLaunched") !== "false";
    const countOnly = searchParams.get("countOnly") === "1";

    const sortBy = searchParams.get("sortBy") || "orders";
    const sortDir = (searchParams.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const startDateParam = searchParams.get("startDate")?.trim() || "";
    const endDateParam = searchParams.get("endDate")?.trim() || "";
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateParam) ? startDateParam : undefined;
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateParam) ? endDateParam : undefined;

    const sql = await getDatabaseClient();

    const cacheKey = `ppc:query:sale-kw:${scope.teamId}:${request.url}`;
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

      const thresholdCondition = orderOperator === ">="
        ? sql`SUM(p.orders) >= ${orderThreshold}`
        : sql`SUM(p.orders) > ${orderThreshold}`;

      let useSummaryTable = false;
      if (!startDate && !endDate) {
        const checkSummary = await sql<{ cnt: string | number }[]>`
          SELECT count(*) as cnt
          FROM ppc_sale_kw_summary
          WHERE team_id = ${scope.teamId}
            ${storeId ? sql`AND store_id = ${storeId}` : sql``}
            AND days_window = ${days}
        `;
        if (Number(checkSummary[0]?.cnt || 0) > 0) {
          useSummaryTable = true;
        }
      }

      // Base CTE: Use pre-aggregated summary table if available (<10ms), otherwise fallback to raw search terms
      const baseCte = useSummaryTable
        ? sql`
        WITH grouped_candidates AS (
          SELECT
            s.store_id,
            st.name AS store_name,
            upper(s.sku) AS sku,
            s.customer_search_term,
            s.source_campaign_id,
            s.source_ad_group_id,
            s.source_ad_group_name,
            s.source_campaign_names,
            s.impressions,
            s.clicks,
            s.spend,
            s.sales,
            s.orders
          FROM ppc_sale_kw_summary s
          JOIN ppc_stores st ON st.id = s.store_id
          WHERE s.team_id = ${scope.teamId}
            ${storeId ? sql`AND s.store_id = ${storeId}` : sql``}
            AND s.days_window = ${days}
            ${sku !== "ALL" ? sql`AND upper(s.sku) = upper(${sku})` : sql``}
            AND ${orderOperator === ">=" ? sql`s.orders >= ${orderThreshold}` : sql`s.orders > ${orderThreshold}`}
        ),
        candidates_with_checks AS (
          SELECT
            gc.*,
            (EXISTS (
              SELECT 1 FROM ppc_sale_kw_registry sr
              WHERE sr.team_id = ${scope.teamId}
                AND sr.store_id = gc.store_id
                AND sr.state IN ('pending', 'enabled')
                AND lower(trim(sr.keyword_text)) = lower(trim(gc.customer_search_term))
                AND (
                  sr.sku IS NULL
                  OR lower(trim(sr.sku)) = lower(trim(gc.sku))
                  OR substring(sr.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)') = substring(gc.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)')
                )
              LIMIT 1
            )) AS is_already_launched
          FROM grouped_candidates gc
        )
      `
        : sql`
        WITH anchor AS (
          ${anchorCte}
        ),
        daily_counts AS (
          SELECT p0.store_id, p0.ad_type, COUNT(*) as cnt
          FROM ppc_search_terms p0
          CROSS JOIN anchor a
          WHERE p0.report_granularity = 'DAILY'
            AND (${!startDate} OR p0.report_date >= ${startDate || "1970-01-01"}::date)
            AND (${!endDate} OR p0.report_date <= ${endDate || "2099-12-31"}::date)
            AND (${Boolean(startDate || endDate)} OR (p0.report_date >= a.max_date - (${days} - 1)::integer AND p0.report_date <= a.max_date))
          GROUP BY p0.store_id, p0.ad_type
        ),
        latest_range AS (
          SELECT p0.store_id, p0.ad_type, MAX(p0.report_end_date) as max_end_date
          FROM ppc_search_terms p0
          CROSS JOIN anchor a
          WHERE p0.report_granularity = 'RANGE'
            AND (p0.report_end_date - p0.report_start_date + 1)
              BETWEEN ${days - 3}::integer AND ${days + 3}::integer
            AND p0.report_end_date <= a.max_date
          GROUP BY p0.store_id, p0.ad_type
        ),
        raw_filtered AS (
          SELECT
            p.store_id,
            s.name AS store_name,
            p.campaign_name,
            p.campaign_id,
            p.ad_group_name,
            p.ad_group_id,
            p.customer_search_term,
            p.match_type,
            p.ad_type,
            p.portfolio_name,
            COALESCE(
              ${sku !== "ALL" ? sku : sql`NULL`},
              substring(p.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
              substring(p.campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
              substring(p.portfolio_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'),
              NULLIF(trim(p.sku), ''),
              'UNKNOWN_SKU'
            ) AS resolved_sku,
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
            AND (
              ${sku === "ALL"}
              OR lower(COALESCE(p.sku, '')) = lower(${sku})
              OR lower(p.portfolio_name) = lower(${sku})
              OR position(lower(${sku}) in lower(p.campaign_name)) > 0
            )
            AND (
              lower(p.customer_search_term) NOT LIKE 'asin=%'
              AND lower(p.customer_search_term) NOT LIKE 'category=%'
              AND p.customer_search_term !~* '^b0[0-9a-z]{8}$'
              AND p.customer_search_term !~* '^[b][0-9a-z]{9}$'
            )
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
            (MIN(p.store_id::text))::uuid AS store_id,
            MIN(p.store_name) AS store_name,
            upper(p.resolved_sku) AS sku,
            p.customer_search_term,
            MIN(p.campaign_id) AS source_campaign_id,
            MIN(p.ad_group_id) AS source_ad_group_id,
            MIN(p.ad_group_name) AS source_ad_group_name,
            array_agg(DISTINCT p.campaign_name) AS source_campaign_names,
            SUM(p.impressions)::integer AS impressions,
            SUM(p.clicks)::integer AS clicks,
            SUM(p.spend)::numeric AS spend,
            SUM(p.sales)::numeric AS sales,
            SUM(p.orders)::integer AS orders
          FROM raw_filtered p
          GROUP BY upper(p.resolved_sku), p.customer_search_term
          HAVING ${thresholdCondition}
        ),
        candidates_with_checks AS (
          SELECT
            gc.*,
            (EXISTS (
              SELECT 1 FROM ppc_sale_kw_registry sr
              WHERE sr.team_id = ${scope.teamId}
                AND sr.store_id = gc.store_id
                AND sr.state IN ('pending', 'enabled')
                AND lower(trim(sr.keyword_text)) = lower(trim(gc.customer_search_term))
                AND (
                  sr.sku IS NULL
                  OR lower(trim(sr.sku)) = lower(trim(gc.sku))
                  OR substring(sr.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)') = substring(gc.sku from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)')
                )
              LIMIT 1
            )) AS is_already_launched
          FROM grouped_candidates gc
        )
      `;

      if (countOnly) {
        const countRows = await sql<Array<{
          total_candidates: number;
          unlaunched_candidates: number;
          launched_candidates: number;
        }>>`
        ${baseCte}
        SELECT
          COUNT(*)::integer AS total_candidates,
          COUNT(*) FILTER (WHERE NOT is_already_launched)::integer AS unlaunched_candidates,
          COUNT(*) FILTER (WHERE is_already_launched)::integer AS launched_candidates
        FROM candidates_with_checks;
      `;
        const res = countRows[0] || { total_candidates: 0, unlaunched_candidates: 0, launched_candidates: 0 };
        return {
          isCountOnly: true,
          total: Number(res.unlaunched_candidates || 0),
          totalCandidates: Number(res.total_candidates || 0),
          launchedCount: Number(res.launched_candidates || 0),
        };
      }

      const searchFilter = search
        ? sql`AND (
          lower(c.customer_search_term) LIKE ${`%${search}%`}
          OR lower(c.sku) LIKE ${`%${search}%`}
        )`
        : sql``;

      const launchedFilter = hideLaunched
        ? sql`AND NOT c.is_already_launched`
        : sql``;

      // Summary query
      const summaryRows = await sql<Array<{
        total_count: number;
        all_candidates_count: number;
        launched_count: number;
        total_orders: number;
        total_sales: string;
        total_spend: string;
        total_clicks: number;
      }>>`
      ${baseCte}
      SELECT
        COUNT(*) FILTER (WHERE 1=1 ${launchedFilter} ${searchFilter})::integer AS total_count,
        COUNT(*)::integer AS all_candidates_count,
        COUNT(*) FILTER (WHERE is_already_launched)::integer AS launched_count,
        COALESCE(SUM(orders) FILTER (WHERE 1=1 ${launchedFilter} ${searchFilter}), 0)::integer AS total_orders,
        COALESCE(SUM(sales) FILTER (WHERE 1=1 ${launchedFilter} ${searchFilter}), 0)::numeric AS total_sales,
        COALESCE(SUM(spend) FILTER (WHERE 1=1 ${launchedFilter} ${searchFilter}), 0)::numeric AS total_spend,
        COALESCE(SUM(clicks) FILTER (WHERE 1=1 ${launchedFilter} ${searchFilter}), 0)::integer AS total_clicks
      FROM candidates_with_checks c;
    `;

      const s = summaryRows[0] || {
        total_count: 0,
        all_candidates_count: 0,
        launched_count: 0,
        total_orders: 0,
        total_sales: "0",
        total_spend: "0",
        total_clicks: 0,
      };

      const total = Number(s.total_count || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      // Sorting
      let orderClause = sql`c.orders DESC, c.sales DESC`;
      if (sortBy === "sales") {
        orderClause = sortDir === "ASC" ? sql`c.sales ASC, c.customer_search_term` : sql`c.sales DESC, c.customer_search_term`;
      } else if (sortBy === "spend") {
        orderClause = sortDir === "ASC" ? sql`c.spend ASC, c.customer_search_term` : sql`c.spend DESC, c.customer_search_term`;
      } else if (sortBy === "clicks") {
        orderClause = sortDir === "ASC" ? sql`c.clicks ASC, c.customer_search_term` : sql`c.clicks DESC, c.customer_search_term`;
      } else if (sortBy === "cpc") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN c.clicks > 0 THEN c.spend / c.clicks ELSE 0 END) ASC`
          : sql`(CASE WHEN c.clicks > 0 THEN c.spend / c.clicks ELSE 0 END) DESC`;
      } else if (sortBy === "acos") {
        orderClause = sortDir === "ASC"
          ? sql`(CASE WHEN c.sales > 0 THEN c.spend / c.sales ELSE 999 END) ASC`
          : sql`(CASE WHEN c.sales > 0 THEN c.spend / c.sales ELSE 0 END) DESC`;
      } else if (sortBy === "customerSearchTerm") {
        orderClause = sortDir === "ASC" ? sql`c.customer_search_term ASC` : sql`c.customer_search_term DESC`;
      } else if (sortBy === "sku") {
        orderClause = sortDir === "ASC" ? sql`c.sku ASC, c.customer_search_term` : sql`c.sku DESC, c.customer_search_term`;
      } else {
        orderClause = sortDir === "ASC" ? sql`c.orders ASC, c.sales ASC` : sql`c.orders DESC, c.sales DESC`;
      }

      // Paginated Items
      const rows = await sql<Array<{
        store_id: string;
        store_name: string;
        sku: string;
        customer_search_term: string;
        source_campaign_id: string | null;
        source_ad_group_id: string | null;
        source_ad_group_name: string | null;
        source_campaign_names: string[];
        impressions: number;
        clicks: number;
        spend: string;
        sales: string;
        orders: number;
        is_already_launched: boolean;
      }>>`
      ${baseCte}
      SELECT c.*
      FROM candidates_with_checks c
      WHERE 1=1
        ${launchedFilter}
        ${searchFilter}
      ORDER BY ${orderClause}
      ${fetchAll ? sql`` : sql`LIMIT ${pageSize} OFFSET ${offset}`};
    `;

      const items = rows.map((r) => {
        const spend = Number(r.spend || 0);
        const sales = Number(r.sales || 0);
        const orders = Number(r.orders || 0);
        const clicks = Number(r.clicks || 0);
        const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
        const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : (spend > 0 ? 999 : 0);
        const groupKey = `${(r.sku || "").trim().toLowerCase()}|||${(r.customer_search_term || "").trim().toLowerCase()}`;

        return {
          key: groupKey,
          sku: r.sku,
          customerSearchTerm: r.customer_search_term,
          sourceCampaignNames: r.source_campaign_names || [],
          sourceCampaignId: r.source_campaign_id || undefined,
          sourceAdGroupId: r.source_ad_group_id || undefined,
          sourceAdGroupName: r.source_ad_group_name || undefined,
          impressions: Number(r.impressions || 0),
          clicks,
          spend: Math.round(spend * 100) / 100,
          sales: Math.round(sales * 100) / 100,
          orders,
          cpc,
          acos,
          bid: cpc > 0 ? Math.max(0.1, cpc) : 0.5,
          storeId: r.store_id,
          storeName: r.store_name,
          isAlreadyLaunched: Boolean(r.is_already_launched),
        };
      });

      const totalClicksNum = Number(s.total_clicks || 0);
      const totalSpendNum = Math.round(Number(s.total_spend || 0) * 100) / 100;
      const avgCpc = totalClicksNum > 0 ? Math.round((totalSpendNum / totalClicksNum) * 100) / 100 : 0;

      return {
        items,
        total,
        page,
        pageSize: fetchAll ? items.length : pageSize,
        totalPages,
        summary: {
          totalCount: total,
          allCandidatesCount: Number(s.all_candidates_count || 0),
          launchedCount: Number(s.launched_count || 0),
          totalOrders: Number(s.total_orders || 0),
          totalSales: Math.round(Number(s.total_sales || 0) * 100) / 100,
          totalSpend: totalSpendNum,
          totalClicks: totalClicksNum,
          avgCpc,
        },
      };
    });

    return Response.json({
      success: true,
      data: cachedData,
    }, {
      headers: {
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load Sale KW candidates");
  }
}
