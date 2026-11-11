// app/api/ppc/manual-bid/route.ts
// Tab Manual Bid: toàn bộ target (mọi campaign) của 1 SKU trong kỳ báo cáo,
// hoặc (summary=1) số liệu từng SKU (tất cả / chỉ target active).
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { runTypeFromCampaign } from "@/lib/ppc/manual-bid";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";

export const runtime = "nodejs";

const MAX_ROWS = 3000;
const SKU_CODE_RE = "([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)";

// 1 nhóm = các target cùng campaign / ad group / SKU dòng / tên campaign / trạng thái active, đã gán SKU.
// Store lớn (FASTPEACE ~1,1 triệu target/kỳ) chỉ còn ~57 nghìn nhóm → giữ được trong bộ nhớ.
type TargetGroup = {
  campaign_id: string;
  ad_group_id: string;
  ag_sku: string | null;
  cs_sku: string | null;
  sku_key: string | null;
  active: boolean;
  n: number;
  clicks: string;
  spend: string;
  sales: string;
  orders: string;
};

type Attribution = {
  groups: TargetGroup[];
  /** campaign|adGroup → SKU của product ad trong ad group (có thể nhiều SKU). */
  adGroupSkus: Map<string, string[]>;
  /** campaign → SKU dò theo tiền tố tên campaign. */
  campaignSku: Map<string, string>;
};

// Gán target → SKU phải quét toàn bộ target + product ad của store trong kỳ (FASTPEACE ~8s), nên tính 1 lần cho
// mỗi store + snapshot rồi dùng chung cho bảng SKU và từng lần bấm SKU. Khoá có snapshot_id/activated_at nên nạp
// báo cáo mới là tự tính lại → giữ lâu; fallback không có ppc_active_snapshots thì không có phiên bản nên giữ ngắn.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_VERSIONED_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 30;
const attributionCache = new Map<string, { at: number; versioned: boolean; promise: Promise<Attribution> }>();

function cachedAttribution(key: string, versioned: boolean, load: () => Promise<Attribution>) {
  const now = Date.now();
  const hit = attributionCache.get(key);
  if (hit && now - hit.at < (hit.versioned ? CACHE_VERSIONED_TTL_MS : CACHE_TTL_MS)) return hit.promise;
  const promise = load();
  promise.catch(() => { if (attributionCache.get(key)?.promise === promise) attributionCache.delete(key); });
  attributionCache.delete(key);
  attributionCache.set(key, { at: now, versioned, promise });
  while (attributionCache.size > CACHE_MAX) attributionCache.delete(attributionCache.keys().next().value!);
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
    // Ad group có nhiều SKU product ad thì target tính cho từng SKU (như LEFT JOIN trước đây).
    const targetFilter = sql`
      p.store_id = ${store.id}
      AND p.grain = 'TARGET'
      AND NOT p.is_negative
      AND lower(p.state) <> 'archived'
      AND lower(p.campaign_state) <> 'archived'
      AND (${snapFilter})
    `;
    const cacheKey = `${store.id}|${snaps.map((x) => `${x.report_start_date}~${x.report_end_date}~${x.version || ""}`).sort().join(",")}`;
    const attribution = await cachedAttribution(cacheKey, snaps.every((x) => Boolean(x.version)), async () => {
      const groups = await sql<TargetGroup[]>`
        WITH
        ag AS (
          SELECT DISTINCT p.campaign_id, p.ad_group_id, upper(trim(p.sku)) AS sku
          FROM ppc_performance_facts p
          WHERE p.store_id = ${store.id}
            AND p.grain = 'PRODUCT'
            AND trim(p.sku) <> ''
            AND (${snapFilter})
        ),
        known AS (SELECT DISTINCT sku FROM ag),
        lens AS (SELECT DISTINCT length(sku) AS l FROM known),
        base AS MATERIALIZED (
          SELECT p.campaign_id, p.ad_group_id, p.campaign_name, upper(trim(p.sku)) AS row_sku,
            COALESCE(
              lower(p.state) NOT IN ('paused', 'archived', 'disabled')
              AND lower(p.campaign_state) NOT IN ('paused', 'archived', 'disabled')
              AND lower(p.ad_group_state) NOT IN ('paused', 'archived', 'disabled'),
              false
            ) AS active,
            p.clicks, p.spend, p.sales, p.orders
          FROM ppc_performance_facts p
          WHERE ${targetFilter}
        ),
        camp AS (SELECT DISTINCT campaign_id, upper(campaign_name) AS name FROM base),
        -- Tiền tố tên campaign = SKU đã biết: so bằng nhau theo từng độ dài SKU (hash join), không so chéo
        -- mọi campaign × mọi SKU (FASTPEACE 55k × 3,9k = 215 triệu phép so, ~66s).
        camp_sku AS (
          SELECT DISTINCT ON (c.campaign_id) c.campaign_id, k.sku
          FROM camp c
          CROSS JOIN lens
          JOIN known k ON k.sku = left(c.name, lens.l)
          ORDER BY c.campaign_id, length(k.sku) DESC
        ),
        g AS (
          SELECT campaign_id, ad_group_id, row_sku, campaign_name, active,
            COUNT(*)::integer AS n, SUM(clicks) AS clicks, SUM(spend) AS spend, SUM(sales) AS sales, SUM(orders) AS orders
          FROM base
          GROUP BY campaign_id, ad_group_id, row_sku, campaign_name, active
        )
        SELECT g.campaign_id, g.ad_group_id, ag.sku AS ag_sku, cs.sku AS cs_sku, g.active, g.n,
          g.clicks::bigint::text AS clicks, g.spend::numeric::text AS spend,
          g.sales::numeric::text AS sales, g.orders::bigint::text AS orders,
          COALESCE(ag.sku, cs.sku, NULLIF(g.row_sku, ''), upper(substring(g.campaign_name from ${SKU_CODE_RE}))) AS sku_key
        FROM g
        LEFT JOIN ag ON ag.campaign_id = g.campaign_id AND ag.ad_group_id = g.ad_group_id
        LEFT JOIN camp_sku cs ON cs.campaign_id = g.campaign_id
      `;
      const adGroupSkus = new Map<string, Set<string>>();
      const campaignSku = new Map<string, string>();
      for (const g of groups) {
        if (g.ag_sku) {
          const k = `${g.campaign_id}|${g.ad_group_id}`;
          const set = adGroupSkus.get(k) || new Set<string>();
          set.add(g.ag_sku);
          adGroupSkus.set(k, set);
        }
        if (g.cs_sku) campaignSku.set(g.campaign_id, g.cs_sku);
      }
      return {
        groups: Array.from(groups),
        adGroupSkus: new Map(Array.from(adGroupSkus, ([k, v]) => [k, Array.from(v)])),
        campaignSku,
      };
    });

    if (summary) {
      const agg = new Map<string, {
        sku: string;
        targets: number; clicks: number; spend: number; sales: number; orders: number;
        a_targets: number; a_clicks: number; a_spend: number; a_sales: number; a_orders: number;
      }>();
      for (const g of attribution.groups) {
        if (!g.sku_key) continue;
        let r = agg.get(g.sku_key);
        if (!r) {
          r = { sku: g.sku_key, targets: 0, clicks: 0, spend: 0, sales: 0, orders: 0, a_targets: 0, a_clicks: 0, a_spend: 0, a_sales: 0, a_orders: 0 };
          agg.set(g.sku_key, r);
        }
        const n = Number(g.n || 0), clicks = Number(g.clicks || 0), spend = Number(g.spend || 0), sales = Number(g.sales || 0), orders = Number(g.orders || 0);
        r.targets += n; r.clicks += clicks; r.spend += spend; r.sales += sales; r.orders += orders;
        if (g.active) {
          r.a_targets += n; r.a_clicks += clicks; r.a_spend += spend; r.a_sales += sales; r.a_orders += orders;
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

    // Chỉ đọc target của các campaign có nhóm gán về SKU này (index campaign), rồi gán lại từng dòng như trên.
    const skuUpper = sku.toUpperCase();
    const campaignIds = Array.from(new Set(
      attribution.groups.filter((g) => g.sku_key?.toUpperCase() === skuUpper).map((g) => g.campaign_id),
    ));
    const candidates = campaignIds.length === 0 ? [] : await sql<Array<{
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
      fallback_sku: string | null;
    }>>`
      SELECT p.ad_type, p.campaign_id, p.campaign_name, p.campaign_state, p.ad_group_id, p.ad_group_name, p.ad_group_state,
        p.target_id, p.target_expression, p.match_type, p.state, p.bid,
        p.impressions, p.clicks, p.spend, p.sales, p.orders, p.report_end_date::text, p.snapshot_date::text,
        COALESCE(NULLIF(upper(trim(p.sku)), ''), upper(substring(p.campaign_name from ${SKU_CODE_RE}))) AS fallback_sku
      FROM ppc_performance_facts p
      WHERE ${targetFilter}
        AND p.campaign_id = ANY(${campaignIds})
    `;

    // DISTINCT ON (ad_type, campaign, ad group, target, keyword, match type): giữ dòng snapshot mới nhất.
    const latest = new Map<string, (typeof candidates)[number]>();
    for (const t of candidates) {
      const agSkus = attribution.adGroupSkus.get(`${t.campaign_id}|${t.ad_group_id}`);
      const belongs = agSkus
        ? agSkus.includes(skuUpper)
        : (attribution.campaignSku.get(t.campaign_id) ?? t.fallback_sku) === skuUpper;
      if (!belongs) continue;
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
