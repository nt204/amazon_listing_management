// app/api/ppc/targets/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { roundedPerformanceMetrics } from "@/lib/ppc/analytics";
import { getCachedOrFetch } from "@/lib/redis";
import type { MatchType, PpcAdType, PpcTargetPerformance } from "@/lib/ppc/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);

    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Math.max(1, Math.min(3650, Number(searchParams.get("days") || 30)));
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(200, Math.max(10, Number(searchParams.get("pageSize") || 50)));
    const search = searchParams.get("search")?.trim().toLowerCase() || "";
    const campaignId = searchParams.get("campaignId")?.trim() || "";
    const campaignName = searchParams.get("campaignName")?.trim() || "";
    const adGroupName = searchParams.get("adGroupName")?.trim() || "";
    const sortBy = searchParams.get("sortBy") || "spend";
    const sortDir = (searchParams.get("sortDir") || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const sql = await getDatabaseClient();

    const cacheKey = `ppc:query:targets-page:${scope.teamId}:${storeName}:${sku}:${days}:${page}:${pageSize}:${search}:${campaignId}:${campaignName}:${adGroupName}:${sortBy}:${sortDir}`;
    const result = await getCachedOrFetch(cacheKey, 60, async () => {
      // 1. Resolve Store ID if storeName is specified
      let storeId: string | null = null;
      if (storeName !== "ALL") {
        const storeRows = await sql<{ id: string }[]>`
          SELECT id FROM ppc_stores
          WHERE team_id = ${scope.teamId} AND lower(name) = lower(${storeName})
          LIMIT 1
        `;
        if (storeRows.length > 0) {
          storeId = storeRows[0].id;
        }
      }

      // 2. Lấy snapshot bounds nhanh qua ppc_active_snapshots (Index scan, 30x faster)
      let snaps = await sql<Array<{
        store_id: string;
        report_start_date: string;
        report_end_date: string;
      }>>`
        SELECT a.store_id, a.report_start_date::text, a.report_end_date::text
        FROM ppc_active_snapshots a
        JOIN ppc_stores s ON s.id = a.store_id
        WHERE s.team_id = ${scope.teamId}
          ${storeId ? sql`AND a.store_id = ${storeId}` : sql``}
          AND a.coverage_days = ${days}
      `;

      if (snaps.length === 0) {
        // Fallback
        snaps = await sql<Array<{
          store_id: string;
          report_start_date: string;
          report_end_date: string;
        }>>`
          SELECT DISTINCT ON (p2.store_id, p2.ad_type)
            p2.store_id, p2.report_start_date::text, p2.report_end_date::text
          FROM ppc_performance_facts p2
          JOIN ppc_stores s2 ON s2.id = p2.store_id
          WHERE s2.team_id = ${scope.teamId}
            ${storeId ? sql`AND p2.store_id = ${storeId}` : sql``}
            AND (p2.report_end_date - p2.report_start_date + 1) BETWEEN ${days - 3}::integer AND ${days + 3}::integer
          ORDER BY p2.store_id, p2.ad_type, p2.snapshot_date DESC, p2.report_end_date DESC
        `;
      }

      if (snaps.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
          summary: {
            count: 0,
            impressions: 0,
            clicks: 0,
            spend: 0,
            sales: 0,
            orders: 0,
            ctr: 0,
            cpc: 0,
            cvr: 0,
            acos: 0,
          },
        };
      }

    // 3. Build snapshot conditions (uses ppc_performance_scope_idx)
    const snapConditions = snaps.map(
      (s) => sql`(
        p.store_id = ${s.store_id}
        AND p.report_start_date = ${s.report_start_date}
        AND p.report_end_date = ${s.report_end_date}
      )`
    );
    const combinedSnaps = snapConditions.reduce((acc, curr) => sql`${acc} OR ${curr}`);

    // Dynamic search conditions
    const searchFilter = search
      ? sql`AND (
          lower(p.target_expression) LIKE ${`%${search}%`}
          OR lower(p.campaign_name) LIKE ${`%${search}%`}
          OR lower(p.ad_group_name) LIKE ${`%${search}%`}
        )`
      : sql``;

    const campaignFilter = campaignId
      ? sql`AND p.campaign_id = ${campaignId}`
      : (campaignName ? sql`AND lower(p.campaign_name) = lower(${campaignName})` : sql``);
    const adGroupFilter = adGroupName ? sql`AND lower(p.ad_group_name) = lower(${adGroupName})` : sql``;
    const skuFilter = sku !== "ALL" ? sql`AND lower(p.sku) = lower(${sku})` : sql``;

    // 4. Query Summary & Total Count trên TOÀN BỘ tập dữ liệu thỏa mãn bộ lọc
    const summaryRows = await sql<Array<{
      total_count: number;
      total_spend: string;
      total_sales: string;
      total_orders: number;
      total_clicks: number;
      total_impressions: string;
    }>>`
      SELECT
        COUNT(*)::integer AS total_count,
        COALESCE(SUM(p.spend), 0)::numeric AS total_spend,
        COALESCE(SUM(p.sales), 0)::numeric AS total_sales,
        COALESCE(SUM(p.orders), 0)::integer AS total_orders,
        COALESCE(SUM(p.clicks), 0)::integer AS total_clicks,
        COALESCE(SUM(p.impressions), 0)::bigint AS total_impressions
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${scope.teamId}
        AND p.grain = 'TARGET'
        AND NOT p.is_negative
        AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0)
        AND (${combinedSnaps})
        ${searchFilter}
        ${campaignFilter}
        ${adGroupFilter}
        ${skuFilter}
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
    const totalSpend = Math.round(Number(rawSummary.total_spend || 0) * 100) / 100;
    const totalSales = Math.round(Number(rawSummary.total_sales || 0) * 100) / 100;
    const totalOrders = Number(rawSummary.total_orders || 0);
    const totalClicks = Number(rawSummary.total_clicks || 0);
    const totalImpressions = Number(rawSummary.total_impressions || 0);
    const ctr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10_000) / 100 : 0;
    const cpc = totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0;
    const cvr = totalClicks > 0 ? Math.round((totalOrders / totalClicks) * 10_000) / 100 : 0;
    const acos = totalSales > 0 ? Math.round((totalSpend / totalSales) * 1000) / 10 : (totalSpend > 0 ? 999 : 0);

    const summary = {
      count: total,
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalSpend,
      sales: totalSales,
      orders: totalOrders,
      ctr,
      cpc,
      cvr,
      acos,
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;

    // 5. Query đúng 50 dòng theo thứ tự sắp xếp
    let orderClause = sql`p.spend DESC`;
    if (sortBy === "sales") {
      orderClause = sortDir === "ASC" ? sql`p.sales ASC, p.id` : sql`p.sales DESC, p.id`;
    } else if (sortBy === "orders") {
      orderClause = sortDir === "ASC" ? sql`p.orders ASC, p.id` : sql`p.orders DESC, p.id`;
    } else if (sortBy === "clicks") {
      orderClause = sortDir === "ASC" ? sql`p.clicks ASC, p.id` : sql`p.clicks DESC, p.id`;
    } else if (sortBy === "impressions") {
      orderClause = sortDir === "ASC" ? sql`p.impressions ASC, p.id` : sql`p.impressions DESC, p.id`;
    } else if (sortBy === "ctr") {
      orderClause = sortDir === "ASC"
        ? sql`(CASE WHEN p.impressions > 0 THEN p.clicks::numeric / p.impressions ELSE 0 END) ASC, p.id`
        : sql`(CASE WHEN p.impressions > 0 THEN p.clicks::numeric / p.impressions ELSE 0 END) DESC, p.id`;
    } else if (sortBy === "cvr") {
      orderClause = sortDir === "ASC"
        ? sql`(CASE WHEN p.clicks > 0 THEN p.orders::numeric / p.clicks ELSE 0 END) ASC, p.id`
        : sql`(CASE WHEN p.clicks > 0 THEN p.orders::numeric / p.clicks ELSE 0 END) DESC, p.id`;
    } else if (sortBy === "acos") {
      orderClause = sortDir === "ASC"
        ? sql`(CASE WHEN p.sales > 0 THEN p.spend / p.sales ELSE 999 END) ASC, p.id`
        : sql`(CASE WHEN p.sales > 0 THEN p.spend / p.sales ELSE 0 END) DESC, p.id`;
    } else if (sortBy === "cpc") {
      orderClause = sortDir === "ASC"
        ? sql`(CASE WHEN p.clicks > 0 THEN p.spend / p.clicks ELSE 0 END) ASC, p.id`
        : sql`(CASE WHEN p.clicks > 0 THEN p.spend / p.clicks ELSE 0 END) DESC, p.id`;
    } else {
      orderClause = sortDir === "ASC" ? sql`p.spend ASC, p.id` : sql`p.spend DESC, p.id`;
    }

    const rows = await sql<Array<{
      id: string;
      store_id: string;
      store_name: string;
      ad_type: string;
      campaign_id: string | null;
      campaign_name: string | null;
      ad_group_id: string | null;
      ad_group_name: string | null;
      target_id: string | null;
      target_expression: string | null;
      match_type: string | null;
      state: string | null;
      bid: string | null;
      impressions: number;
      clicks: number;
      spend: string;
      sales: string;
      orders: number;
    }>>`
      SELECT
        p.id, p.store_id, s.name AS store_name, p.ad_type,
        p.campaign_id, p.campaign_name, p.ad_group_id, p.ad_group_name,
        p.target_id, p.target_expression, p.match_type, p.state, p.bid,
        p.impressions, p.clicks, p.spend, p.sales, p.orders
      FROM ppc_performance_facts p
      JOIN ppc_stores s ON s.id = p.store_id
      WHERE s.team_id = ${scope.teamId}
        AND p.grain = 'TARGET'
        AND NOT p.is_negative
        AND (p.spend > 0 OR p.clicks > 0 OR p.impressions > 0)
        AND (${combinedSnaps})
        ${searchFilter}
        ${campaignFilter}
        ${adGroupFilter}
        ${skuFilter}
      ORDER BY ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const items: PpcTargetPerformance[] = rows.map((row) => {
      let matchType = row.match_type as MatchType;
      const campName = (row.campaign_name || "").toLowerCase();
      const targetExpr = (row.target_expression || "").toLowerCase().trim();

      const isAutoTarget =
        campName.includes("sp04") ||
        campName.includes("auto") ||
        ["close-match", "loose-match", "substitutes", "complements"].some((t) => targetExpr.includes(t)) ||
        targetExpr.includes("auto targeting");

      if (
        isAutoTarget &&
        (!matchType ||
          matchType.toLowerCase() === "unknown" ||
          matchType.toLowerCase() === "targeting" ||
          (matchType as string) === "-")
      ) {
        matchType = "Auto" as MatchType;
      }

      const metrics = roundedPerformanceMetrics({
        spend: Number(row.spend || 0),
        sales: Number(row.sales || 0),
        orders: Number(row.orders || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
      });

      return {
        storeId: row.store_id,
        campaignId: row.campaign_id || "",
        adGroupId: row.ad_group_id || "",
        campaignName: row.campaign_name || row.campaign_id || "Unnamed Campaign",
        adGroupName: row.ad_group_name || row.ad_group_id || "Default Ad Group",
        targetId: row.target_id || undefined,
        targetKeyword: row.target_expression || row.target_id || "Unnamed Target",
        matchType: matchType || "Unknown",
        storeName: row.store_name || "Store",
        adType: (row.ad_type || "SP") as PpcAdType,
        state: row.state || "enabled",
        currentBid: row.bid ? Number(row.bid) : undefined,
        statusBadge: metrics.acos <= 30 ? "EXCELLENT" : metrics.acos <= 45 ? "GOOD" : "WARNING",
        ...metrics,
      };
    });

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
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Targets phân trang.", 500);
  }
}
