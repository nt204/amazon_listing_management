// app/api/ppc/manual-bid/route.ts
// Tab Manual Bid: toàn bộ target (mọi campaign) của 1 SKU trong kỳ báo cáo,
// hoặc (summary=1) số liệu từng SKU (tất cả / chỉ target active).
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { runTypeFromCampaign } from "@/lib/ppc/manual-bid";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";

export const runtime = "nodejs";

const MAX_ROWS = 3000;
const INACTIVE_STATES = new Set(["paused", "archived", "disabled"]);

type AttributedTarget = {
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
  snapshot_date: string;
  sku_key: string;
};

// Gán target → SKU phải quét toàn bộ dòng PRODUCT của store trong kỳ (chậm khi đĩa đọc nguội), nên tính 1 lần
// cho mỗi store + snapshot rồi dùng chung cho bảng SKU và từng lần bấm SKU. Khoá có snapshot_id/activated_at
// nên nạp báo cáo mới là tự tính lại → giữ lâu (dùng chung mọi người xem); fallback không có ppc_active_snapshots
// thì không có phiên bản nên chỉ giữ ngắn.
const TARGET_CACHE_TTL_MS = 5 * 60_000;
const TARGET_CACHE_VERSIONED_TTL_MS = 6 * 60 * 60_000;
const TARGET_CACHE_MAX = 30;
const targetCache = new Map<string, { at: number; promise: Promise<AttributedTarget[]> }>();

function cachedTargets(key: string, versioned: boolean, load: () => Promise<AttributedTarget[]>) {
  const now = Date.now();
  const hit = targetCache.get(key);
  if (hit && now - hit.at < (versioned ? TARGET_CACHE_VERSIONED_TTL_MS : TARGET_CACHE_TTL_MS)) return hit.promise;
  const promise = load().then((rows) => Array.from(rows));
  promise.catch(() => { if (targetCache.get(key)?.promise === promise) targetCache.delete(key); });
  targetCache.delete(key);
  targetCache.set(key, { at: now, promise });
  while (targetCache.size > TARGET_CACHE_MAX) targetCache.delete(targetCache.keys().next().value!);
  return promise;
}

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

    let snaps = await sql<Array<{ report_start_date: string; report_end_date: string; version?: string }>>`
      SELECT a.report_start_date::text, a.report_end_date::text, a.snapshot_id || '@' || a.activated_at::text AS version
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

    // Target thuộc SKU nào (dùng chung cho bảng SKU và màn target để số khớp nhau):
    //   1. SKU của product ad trong cùng ad group (camp SP luôn có, đúng cả mã "lạ" như RESIN DOLL_GARDENING);
    //   2. tên campaign bắt đầu bằng 1 SKU đã biết của store (camp SB không có product ad), lấy mã dài nhất;
    //   3. cột SKU của dòng; 4. mã dạng chữ+số ở tên campaign.
    const attributedTargets = sql`
      ag AS (
        SELECT DISTINCT p.campaign_id, p.ad_group_id, upper(trim(p.sku)) AS sku
        FROM ppc_performance_facts p
        WHERE p.store_id = ${store.id}
          AND p.grain = 'PRODUCT'
          AND trim(p.sku) <> ''
          AND (${snapFilter})
      ),
      known AS (SELECT DISTINCT sku FROM ag),
      base AS (
        SELECT p.*
        FROM ppc_performance_facts p
        WHERE p.store_id = ${store.id}
          AND p.grain = 'TARGET'
          AND NOT p.is_negative
          AND lower(p.state) <> 'archived'
          AND lower(p.campaign_state) <> 'archived'
          AND (${snapFilter})
      ),
      -- Dò SKU theo tiền tố tên campaign 1 lần cho mỗi campaign (không lặp theo từng target).
      camp_sku AS (
        SELECT DISTINCT ON (c.campaign_id) c.campaign_id, k.sku
        FROM (SELECT DISTINCT campaign_id, upper(campaign_name) AS name FROM base) c
        JOIN known k ON left(c.name, length(k.sku)) = k.sku
        ORDER BY c.campaign_id, length(k.sku) DESC
      ),
      t AS (
        SELECT b.*,
          COALESCE(
            ag.sku,
            cs.sku,
            NULLIF(upper(trim(b.sku)), ''),
            upper(substring(b.campaign_name from '([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)'))
          ) AS sku_key
        FROM base b
        LEFT JOIN ag ON ag.campaign_id = b.campaign_id AND ag.ad_group_id = b.ad_group_id
        LEFT JOIN camp_sku cs ON cs.campaign_id = b.campaign_id
      )
    `;

    const cacheKey = `${store.id}|${snaps.map((x) => `${x.report_start_date}~${x.report_end_date}~${x.version || ""}`).sort().join(",")}`;
    const targetRows = await cachedTargets(cacheKey, snaps.every((x) => Boolean(x.version)), () => sql<AttributedTarget[]>`
      WITH ${attributedTargets}
      SELECT t.ad_type, t.campaign_id, t.campaign_name, t.campaign_state, t.ad_group_id, t.ad_group_name, t.ad_group_state,
        t.target_id, t.target_expression, t.match_type, t.state, t.bid,
        t.impressions, t.clicks, t.spend, t.sales, t.orders, t.report_end_date::text, t.snapshot_date::text, t.sku_key
      FROM t
      WHERE t.sku_key IS NOT NULL
    `);

    if (summary) {
      const isActive = (t: AttributedTarget) => [t.state, t.campaign_state, t.ad_group_state]
        .every((v) => v != null && !INACTIVE_STATES.has(v.toLowerCase()));
      const agg = new Map<string, {
        sku: string;
        targets: number; clicks: number; spend: number; sales: number; orders: number;
        a_targets: number; a_clicks: number; a_spend: number; a_sales: number; a_orders: number;
      }>();
      for (const t of targetRows) {
        let r = agg.get(t.sku_key);
        if (!r) {
          r = { sku: t.sku_key, targets: 0, clicks: 0, spend: 0, sales: 0, orders: 0, a_targets: 0, a_clicks: 0, a_spend: 0, a_sales: 0, a_orders: 0 };
          agg.set(t.sku_key, r);
        }
        const clicks = Number(t.clicks || 0), spend = Number(t.spend || 0), sales = Number(t.sales || 0), orders = Number(t.orders || 0);
        r.targets += 1; r.clicks += clicks; r.spend += spend; r.sales += sales; r.orders += orders;
        if (isActive(t)) {
          r.a_targets += 1; r.a_clicks += clicks; r.a_spend += spend; r.a_sales += sales; r.a_orders += orders;
        }
      }
      const skuRows = Array.from(agg.values());
      const metrics = (targets: number, clicks: number, spend: number, sales: number, orders: number) => ({
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

    // DISTINCT ON (ad_type, campaign, ad group, target, keyword, match type): giữ dòng snapshot mới nhất.
    const latest = new Map<string, AttributedTarget>();
    for (const t of targetRows) {
      if (t.sku_key.toLowerCase() !== sku) continue;
      const k = [t.ad_type, t.campaign_id, t.ad_group_id, t.target_id, t.target_expression.toLowerCase(), t.match_type].join("\u0000");
      const prev = latest.get(k);
      if (!prev || t.snapshot_date > prev.snapshot_date) latest.set(k, t);
    }
    const rows = Array.from(latest.values()).slice(0, MAX_ROWS);
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
          AND (${snapFilter})
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
