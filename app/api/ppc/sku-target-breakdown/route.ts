// app/api/ppc/sku-target-breakdown/route.ts
// Spend / đơn của 1 SKU tách theo campaign → target → search term trong một khoảng ngày.
// Nguồn: search term report theo ngày (ppc_search_terms, DAILY) — cùng số với cột biểu đồ trend SKU.
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 3000;

function isIsoDate(value: string) {
  return ISO_DATE_RE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "ALL").trim();
    const sku = (searchParams.get("sku") || "").trim();
    const startDate = (searchParams.get("startDate") || "").trim();
    const endDate = (searchParams.get("endDate") || "").trim();

    if (!sku || sku.length > 200) throw new ApiError("Thiếu SKU.", 400);
    if (storeName.length > 80) throw new ApiError("Store không hợp lệ.", 400);
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
      throw new ApiError("Khoảng ngày không hợp lệ (YYYY-MM-DD).", 400);
    }

    const sql = await getDatabaseClient();
    const rows = await sql<Array<{
      store_name: string;
      campaign_name: string;
      ad_group_name: string;
      target_keyword: string;
      match_type: string;
      customer_search_term: string;
      impressions: number;
      clicks: number;
      spend: string;
      sales: string;
      orders: number;
      days: number;
    }>>`
      SELECT
        s.name AS store_name,
        t.campaign_name,
        t.ad_group_name,
        t.target_keyword,
        t.match_type,
        t.customer_search_term,
        SUM(t.impressions)::integer AS impressions,
        SUM(t.clicks)::integer AS clicks,
        SUM(t.spend)::numeric AS spend,
        SUM(t.sales)::numeric AS sales,
        SUM(t.orders)::integer AS orders,
        COUNT(DISTINCT t.report_date)::integer AS days
      FROM ppc_search_terms t
      JOIN ppc_stores s ON s.id = t.store_id
      WHERE s.team_id = ${scope.teamId}
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
        AND t.report_granularity = 'DAILY'
        AND t.report_start_date = t.report_end_date
        AND t.report_date BETWEEN ${startDate}::date AND ${endDate}::date
        AND upper(trim(COALESCE(NULLIF(t.sku, ''), t.portfolio_name))) = upper(${sku})
      GROUP BY s.name, t.campaign_name, t.ad_group_name, t.target_keyword, t.match_type, t.customer_search_term
      HAVING SUM(t.spend) > 0 OR SUM(t.sales) > 0 OR SUM(t.orders) > 0 OR SUM(t.clicks) > 0
      ORDER BY SUM(t.spend) DESC, SUM(t.sales) DESC
      LIMIT ${MAX_ROWS}
    `;

    const coverage = await sql<Array<{ max_date: string | null }>>`
      SELECT MAX(t.report_date)::text AS max_date
      FROM ppc_search_terms t
      JOIN ppc_stores s ON s.id = t.store_id
      WHERE s.team_id = ${scope.teamId}
        AND (${storeName === "ALL"} OR lower(s.name) = lower(${storeName}))
        AND t.report_granularity = 'DAILY'
        AND t.report_date >= ${startDate}::date - 7
    `;

    return Response.json({
      sku,
      storeName,
      startDate,
      endDate,
      latestReportDate: coverage[0]?.max_date ?? null,
      truncated: rows.length >= MAX_ROWS,
      rows: rows.map((r) => ({
        storeName: r.store_name,
        campaignName: r.campaign_name,
        adGroupName: r.ad_group_name,
        targetKeyword: r.target_keyword,
        matchType: r.match_type,
        searchTerm: r.customer_search_term,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend: Math.round(Number(r.spend || 0) * 100) / 100,
        sales: Math.round(Number(r.sales || 0) * 100) / 100,
        orders: Number(r.orders || 0),
        days: Number(r.days || 0),
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được chi tiết target của SKU", 500);
  }
}
