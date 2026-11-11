// app/api/ppc/manual-bid/route.ts
// Tab Manual Bid: toàn bộ target (mọi campaign) của 1 SKU trong kỳ báo cáo,
// hoặc (summary=1) số liệu từng SKU chỉ tính target đang active.
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { runTypeFromCampaign } from "@/lib/ppc/manual-bid";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";
import { targetSkuMatch } from "@/lib/ppc/target-grouping";

export const runtime = "nodejs";

const MAX_ROWS = 3000;

export async function GET(request: Request) {
  try {
    const scope = dataScope(await authorize(request, "read", "ppc"));
    const { searchParams } = new URL(request.url);
    const storeName = (searchParams.get("storeName") || "").trim();
    const sku = (searchParams.get("sku") || "").trim().toLowerCase();
    const days = Math.max(1, Math.min(365, Number(searchParams.get("days") || 30)));
    if (!storeName || storeName === "ALL") throw new ApiError("Chọn store trước.", 400);

    const sql = await getDatabaseClient();
    const storeRows = await sql<{ id: string; name: string; marketplace: string | null }[]>`
      SELECT id, name, marketplace FROM ppc_stores
      WHERE team_id = ${scope.teamId} AND lower(name) = lower(${storeName})
      LIMIT 1
    `;
    const store = storeRows[0];
    if (!store) throw new ApiError("Không tìm thấy store.", 404);

    const summary = searchParams.get("summary") === "1";
    if (!sku && !summary) throw new ApiError("Thiếu SKU.", 400);

    let snaps = await sql<Array<{ report_start_date: string; report_end_date: string }>>`
      SELECT a.report_start_date::text, a.report_end_date::text
      FROM ppc_active_snapshots a
      WHERE a.store_id = ${store.id} AND a.coverage_days = ${days}
    `;
    if (snaps.length === 0) {
      snaps = await sql<Array<{ report_start_date: string; report_end_date: string }>>`
        SELECT DISTINCT ON (p.ad_type) p.report_start_date::text, p.report_end_date::text
        FROM ppc_performance_facts p
        WHERE p.store_id = ${store.id}
          AND (p.report_end_date - p.report_start_date + 1) BETWEEN ${days - 3}::integer AND ${days + 3}::integer
        ORDER BY p.ad_type, p.snapshot_date DESC, p.report_end_date DESC
      `;
    }
    if (snaps.length === 0) {
      return Response.json({ success: true, sku: sku.toUpperCase(), reportRange: null, items: [] });
    }

    const snapFilter = snaps
      .map((s) => sql`(p.report_start_date = ${s.report_start_date} AND p.report_end_date = ${s.report_end_date})`)
      .reduce((acc, cur) => sql`${acc} OR ${cur}`);

    if (summary) {
      // Target thuộc SKU: cột SKU, nếu trống thì mã SKU ở đầu tên campaign (cùng quy ước tab Target).
      const active = sql`(
        lower(p.state) NOT IN ('paused', 'archived', 'disabled')
        AND lower(p.campaign_state) NOT IN ('paused', 'archived', 'disabled')
        AND lower(p.ad_group_state) NOT IN ('paused', 'archived', 'disabled')
      )`;
      const skuRows = await sql<Array<{
        sku: string;
        targets: number; clicks: string; spend: string; sales: string; orders: string;
        a_targets: number; a_clicks: string; a_spend: string; a_sales: string; a_orders: string;
      }>>`
        SELECT * FROM (
          SELECT
            upper(COALESCE(NULLIF(trim(p.sku), ''), substring(p.campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'))) AS sku,
            COUNT(*)::integer AS targets,
            SUM(p.clicks)::bigint AS clicks, SUM(p.spend)::numeric AS spend,
            SUM(p.sales)::numeric AS sales, SUM(p.orders)::bigint AS orders,
            (COUNT(*) FILTER (WHERE ${active}))::integer AS a_targets,
            COALESCE(SUM(p.clicks) FILTER (WHERE ${active}), 0)::bigint AS a_clicks,
            COALESCE(SUM(p.spend) FILTER (WHERE ${active}), 0)::numeric AS a_spend,
            COALESCE(SUM(p.sales) FILTER (WHERE ${active}), 0)::numeric AS a_sales,
            COALESCE(SUM(p.orders) FILTER (WHERE ${active}), 0)::bigint AS a_orders
          FROM ppc_performance_facts p
          WHERE p.store_id = ${store.id}
            AND p.grain = 'TARGET'
            AND NOT p.is_negative
            AND lower(p.state) <> 'archived'
            AND lower(p.campaign_state) <> 'archived'
            AND (${snapFilter})
          GROUP BY 1
        ) t
        WHERE t.sku IS NOT NULL
      `;
      const metrics = (targets: number, clicks: string, spend: string, sales: string, orders: string) => ({
        targets: Number(targets || 0),
        clicks: Number(clicks || 0),
        spend: Math.round(Number(spend || 0) * 100) / 100,
        sales: Math.round(Number(sales || 0) * 100) / 100,
        orders: Number(orders || 0),
      });
      return Response.json({
        success: true,
        items: skuRows.map((r) => ({
          sku: r.sku,
          all: metrics(r.targets, r.clicks, r.spend, r.sales, r.orders),
          active: metrics(r.a_targets, r.a_clicks, r.a_spend, r.a_sales, r.a_orders),
        })),
      });
    }

    const rows = await sql<Array<{
      ad_type: string;
      campaign_id: string;
      campaign_name: string;
      campaign_state: string;
      ad_group_id: string;
      ad_group_name: string;
      ad_group_state: string;
      target_id: string;
      target_expression: string;
      match_type: string;
      state: string;
      bid: string;
      impressions: string;
      clicks: string;
      spend: string;
      sales: string;
      orders: string;
      report_end_date: string;
    }>>`
      SELECT DISTINCT ON (p.ad_type, p.campaign_id, p.ad_group_id, p.target_id, lower(p.target_expression), p.match_type)
        p.ad_type, p.campaign_id, p.campaign_name, p.campaign_state, p.ad_group_id, p.ad_group_name, p.ad_group_state,
        p.target_id, p.target_expression, p.match_type, p.state, p.bid,
        p.impressions, p.clicks, p.spend, p.sales, p.orders, p.report_end_date::text
      FROM ppc_performance_facts p
      WHERE p.store_id = ${store.id}
        AND p.grain = 'TARGET'
        AND NOT p.is_negative
        AND lower(p.state) <> 'archived'
        AND lower(p.campaign_state) <> 'archived'
        AND (${snapFilter})
        AND (${targetSkuMatch(sql, [sku])})
      ORDER BY p.ad_type, p.campaign_id, p.ad_group_id, p.target_id, lower(p.target_expression), p.match_type,
        p.snapshot_date DESC
      LIMIT ${MAX_ROWS}
    `;

    const baseItems = rows.map((r) => {
      const clicks = Number(r.clicks || 0);
      const spend = Number(r.spend || 0);
      const sales = Number(r.sales || 0);
      const orders = Number(r.orders || 0);
      return {
        key: `${r.ad_type}|${r.campaign_id}|${r.ad_group_id}|${r.target_id}|${r.target_expression.toLowerCase()}|${r.match_type}`,
        storeId: store.id,
        adType: r.ad_type,
        runType: runTypeFromCampaign(r.campaign_name, r.ad_type),
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        campaignState: r.campaign_state.toLowerCase(),
        adGroupState: r.ad_group_state.toLowerCase(),
        adGroupId: r.ad_group_id,
        adGroupName: r.ad_group_name,
        targetId: r.target_id,
        keyword: r.target_expression,
        matchType: r.match_type,
        state: r.state.toLowerCase(),
        bid: Number(r.bid || 0),
        impressions: Number(r.impressions || 0),
        clicks,
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        orders,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
      };
    });

    // SV (Helium 10) + Organic / Sponsored rank theo keyword và ASIN của SKU, giống bảng target tab Auto Bid.
    let asin = (searchParams.get("asin") || "").trim().toUpperCase() || null;
    if (!asin) {
      const asinRows = await sql<{ asin: string }[]>`
        SELECT upper(trim(asin)) AS asin FROM ppc_performance_facts p
        WHERE p.store_id = ${store.id} AND p.grain = 'PRODUCT' AND trim(p.asin) <> ''
          AND lower(trim(p.sku)) = ${sku}
        ORDER BY p.snapshot_date DESC LIMIT 1
      `;
      asin = asinRows[0]?.asin || null;
    }
    let items = baseItems.map((it) => ({ ...it, searchVolume: null as number | null, organicRank: null as number | null, sponsoredRank: null as number | null }));
    try {
      const isKeyword = (m: string) => /exact|phrase|broad/i.test(m);
      const enriched = await attachSearchVolumes(sql, baseItems.map((it) => ({ ...it, asin })), {
        keywordOf: (it) => (isKeyword(it.matchType) ? it.keyword : null),
        coverageDaysOf: () => days,
        shareApplies: () => false,
        marketplace: store.marketplace || "US",
      });
      items = baseItems.map((it, i) => ({
        ...it,
        searchVolume: enriched[i].searchVolume,
        organicRank: enriched[i].organicRank,
        sponsoredRank: enriched[i].sponsoredRank,
      }));
    } catch (error) {
      console.warn("[manual-bid] attach search volume failed", error);
    }

    const ends = snaps.map((s) => s.report_end_date).sort();
    const starts = snaps.map((s) => s.report_start_date).sort();
    return Response.json({
      success: true,
      sku: sku.toUpperCase(),
      reportRange: { start: starts[0], end: ends[ends.length - 1] },
      truncated: rows.length >= MAX_ROWS,
      items,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tải target cho Manual Bid.", 500);
  }
}
