// app/api/ppc/targets/search-terms/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import type { PpcSearchTermRow } from "@/lib/ppc/types";
import { getCachedOrFetch } from "@/lib/redis";

export const runtime = "nodejs";

const TARGET_SEARCH_TERMS_CACHE_TTL_SEC = 600; // 10 phút cache

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);

    const storeName = searchParams.get("storeName") || "ALL";
    const targetId = searchParams.get("targetId")?.trim() || "";
    const targetKeyword = searchParams.get("targetKeyword")?.trim() || "";
    const campaignName = searchParams.get("campaignName")?.trim() || "";
    const adGroupName = searchParams.get("adGroupName")?.trim() || "";
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || 100)));
    const refresh = searchParams.get("refresh") === "1";

    if (!targetId && !targetKeyword) {
      throw new ApiError("Vui lòng cung cấp targetId hoặc targetKeyword.", 400);
    }

    const cacheKey = `ppc:target-search-terms:${scope.teamId}:${storeName}:${targetId || targetKeyword}:${campaignName}:${adGroupName}:${limit}`;

    const data = await getCachedOrFetch<PpcSearchTermRow[]>(
      cacheKey,
      TARGET_SEARCH_TERMS_CACHE_TTL_SEC,
      async () => {
        const sql = await getDatabaseClient();

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

    // Matching condition: Exact target/keyword ID or Target expression + Campaign
    const targetIdCondition = targetId
      ? sql`(t.keyword_id = ${targetId} AND t.keyword_id IS NOT NULL AND t.keyword_id != '')`
      : sql`FALSE`;

    const keywordTextCondition = targetKeyword
      ? sql`(
          lower(t.target_keyword) = lower(${targetKeyword})
          ${campaignName ? sql`AND lower(t.campaign_name) = lower(${campaignName})` : sql``}
          ${adGroupName ? sql`AND lower(t.ad_group_name) = lower(${adGroupName})` : sql``}
        )`
      : sql`FALSE`;

    const rows = await sql<Array<{
      id: string;
      store_id: string;
      store_name: string;
      report_date: string;
      campaign_id: string | null;
      campaign_name: string;
      ad_group_id: string | null;
      ad_group_name: string;
      keyword_id: string | null;
      target_keyword: string;
      customer_search_term: string;
      match_type: string;
      ad_type: string;
      impressions: number;
      clicks: number;
      spend: string;
      sales: string;
      orders: number;
      cpc: string;
      acos: string;
      roas: string;
    }>>`
      SELECT
        t.id, t.store_id, s.name AS store_name, t.report_date,
        t.campaign_id, t.campaign_name, t.ad_group_id, t.ad_group_name,
        t.keyword_id, t.target_keyword, t.customer_search_term,
        t.match_type, t.ad_type,
        t.impressions, t.clicks, t.spend, t.sales, t.orders,
        t.cpc, t.acos, t.roas
      FROM ppc_search_terms t
      JOIN ppc_stores s ON s.id = t.store_id
      WHERE s.team_id = ${scope.teamId}
        ${storeId ? sql`AND t.store_id = ${storeId}` : sql``}
        AND (${targetIdCondition} OR ${keywordTextCondition})
      ORDER BY t.spend DESC, t.orders DESC, t.clicks DESC
      LIMIT ${limit}
    `;

    return rows.map((r): PpcSearchTermRow => {
      const spend = Number(r.spend || 0);
      const sales = Number(r.sales || 0);
      const orders = Number(r.orders || 0);
      const clicks = Number(r.clicks || 0);
      const impressions = Number(r.impressions || 0);
      const acos = sales > 0 ? (spend / sales) * 100 : spend > 0 ? 999 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const roas = spend > 0 ? sales / spend : 0;

      return {
        id: r.id,
        storeId: r.store_id,
        storeName: r.store_name,
        reportDate: String(r.report_date || ""),
        campaignId: r.campaign_id || "",
        campaignName: r.campaign_name || "",
        adGroupId: r.ad_group_id || "",
        adGroupName: r.ad_group_name || "",
        keywordId: r.keyword_id || undefined,
        targetKeyword: r.target_keyword || "",
        customerSearchTerm: r.customer_search_term || "",
        matchType: (r.match_type || "EXACT") as any,
        adType: (r.ad_type || "SP") as any,
        impressions,
        clicks,
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        orders,
        units: orders,
        cpc: Math.round(cpc * 100) / 100,
        acos: Math.round(acos * 10) / 10,
        roas: Math.round(roas * 100) / 100,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : 0,
        cvr: clicks > 0 ? Math.round((orders / clicks) * 10_000) / 100 : 0,
      };
    });
  },
);

    return Response.json({
      success: true,
      data,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy Search Terms của Target.", 500);
  }
}
