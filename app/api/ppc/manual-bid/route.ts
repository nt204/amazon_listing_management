// app/api/ppc/manual-bid/route.ts
// Tab Manual Bid: toàn bộ target (mọi campaign) của 1 SKU trong kỳ báo cáo,
// hoặc (summary=1) số liệu từng SKU (tất cả / chỉ target active).
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { runTypeFromCampaign } from "@/lib/ppc/manual-bid";
import {
  getManualBidAttribution,
  resolveReportSnapshots,
  snapshotFilter,
  SKU_CODE_RE,
  targetFilter as manualBidTargetFilter,
} from "@/lib/ppc/manual-bid-attribution";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";
import { getAccountingStoreForPpcStore } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

// Trả đủ mọi target của SKU (BTC1006D ~10,5 nghìn); trần chỉ để chặn dữ liệu bất thường.
const MAX_ROWS = 50_000;
const SKU_CACHE_MAX = 12;
const globalForSkuCache = globalThis as typeof globalThis & {
  manualBidSkuPayloadCache?: WeakMap<object, Map<string, Promise<unknown>>>;
};
const skuPayloadCache = (globalForSkuCache.manualBidSkuPayloadCache ??= new WeakMap<object, Map<string, Promise<unknown>>>());

/**
 * SKU thuộc trang FBA hay FBM theo Bảng mã Accounting của store:
 * - FBM: có trong bảng mã FBM;
 * - FBA: có trong bảng mã FBA mà KHÔNG có trong bảng mã FBM (bảng FBA của vài store từng bị nạp lẫn SKU FBM);
 * - "": không có trong bảng mã nào.
 * hasFbm = store có bảng mã FBM (không có thì không cần chia trang).
 */
async function loadSkuChannels(ppcStoreId: string): Promise<{ get: (sku: string) => "FBA" | "FBM" | ""; hasFbm: boolean }> {
  const acc = await getAccountingStoreForPpcStore(ppcStoreId).catch(() => null);
  if (!acc) return { get: () => "", hasFbm: false };
  const sql = await getDatabaseClient();
  const [fba, fbm] = await Promise.all([
    sql<{ sku: string }[]>`
      SELECT DISTINCT upper(trim(sku)) AS sku FROM accounting_sku_master
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
    `,
    sql<{ sku: string }[]>`
      SELECT DISTINCT upper(trim(sku)) AS sku FROM accounting_sku_master_fbm
      WHERE store_id = ${acc.accountingStoreId} AND deleted_at IS NULL AND trim(sku) <> ''
    `,
  ]);
  const fbaSet = new Set(fba.map((r) => r.sku));
  const fbmSet = new Set(fbm.map((r) => r.sku));
  return {
    hasFbm: fbmSet.size > 0,
    get: (sku: string) => {
      const k = sku.trim().toUpperCase();
      if (fbmSet.has(k)) return "FBM";
      if (fbaSet.has(k)) return "FBA";
      return "";
    },
  };
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
    // active=1: chỉ target đang chạy (target + ad group + campaign đều không paused/archived/disabled) — mặc định của
    // màn target; SKU lớn phần lớn target nằm ở campaign đã tắt nên đọc ít hơn hẳn. Bấm "Tất cả" mới tải phần còn lại.
    const activeOnly = searchParams.get("active") === "1";
    if (!sku && !summary) throw new ApiError("Thiếu SKU.", 400);

    const snaps = await resolveReportSnapshots(sql, store.id, days);
    if (snaps.length === 0) {
      return Response.json({ success: true, sku: sku.toUpperCase(), reportRange: null, items: [] });
    }

    const snapFilter = snapshotFilter(sql, snaps);
    const targetFilter = manualBidTargetFilter(sql, store.id, snaps);
    const attribution = await getManualBidAttribution(sql, store.id, snaps);

    if (summary) {
      const agg = new Map<string, {
        sku: string;
        targets: number; impressions: number; clicks: number; spend: number; sales: number; orders: number;
        a_targets: number; a_impressions: number; a_clicks: number; a_spend: number; a_sales: number; a_orders: number;
      }>();
      for (const g of attribution.groups) {
        if (!g.sku_key) continue;
        let r = agg.get(g.sku_key);
        if (!r) {
          r = { sku: g.sku_key, targets: 0, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, a_targets: 0, a_impressions: 0, a_clicks: 0, a_spend: 0, a_sales: 0, a_orders: 0 };
          agg.set(g.sku_key, r);
        }
        const impressions = Number(g.impressions || 0);
        const n = Number(g.n || 0), clicks = Number(g.clicks || 0), spend = Number(g.spend || 0), sales = Number(g.sales || 0), orders = Number(g.orders || 0);
        r.targets += n; r.impressions += impressions; r.clicks += clicks; r.spend += spend; r.sales += sales; r.orders += orders;
        if (g.active) {
          r.a_targets += n; r.a_impressions += impressions; r.a_clicks += clicks; r.a_spend += spend; r.a_sales += sales; r.a_orders += orders;
        }
      }
      const skuRows = Array.from(agg.values());
      const channelOf = await loadSkuChannels(store.id);
      const metrics = (targets: number, impressions: number, clicks: number, spend: number, sales: number, orders: number) => ({
        targets: Number(targets || 0),
        impressions: Number(impressions || 0),
        clicks: Number(clicks || 0),
        spend: Math.round(Number(spend || 0) * 100) / 100,
        sales: Math.round(Number(sales || 0) * 100) / 100,
        orders: Number(orders || 0),
      });
      // Trang FBA / FBM / Khác: chỉ trả SKU của trang được hỏi (channel=...), kèm số SKU mỗi trang cho nút chuyển trang.
      // Store không có bảng mã FBM thì không chia trang, trả tất cả.
      const pageOf = (sku: string) => {
        const c = channelOf.get(sku);
        return c === "FBA" ? "FBA" : c === "FBM" ? "FBM" : "OTHER";
      };
      const counts = { FBA: { all: 0, active: 0 }, FBM: { all: 0, active: 0 }, OTHER: { all: 0, active: 0 } };
      for (const r of skuRows) {
        const c = counts[pageOf(r.sku)];
        if (r.targets > 0) c.all += 1;
        if (r.a_targets > 0) c.active += 1;
      }
      const wanted = (searchParams.get("channel") || "").toUpperCase();
      const pageRows = channelOf.hasFbm && (wanted === "FBA" || wanted === "FBM" || wanted === "OTHER")
        ? skuRows.filter((r) => pageOf(r.sku) === wanted)
        : skuRows;
      return Response.json({
        success: true,
        hasChannels: channelOf.hasFbm,
        counts,
        items: pageRows.map((r) => ({
          sku: r.sku,
          channel: channelOf.get(r.sku),
          all: metrics(r.targets, r.impressions, r.clicks, r.spend, r.sales, r.orders),
          active: metrics(r.a_targets, r.a_impressions, r.a_clicks, r.a_spend, r.a_sales, r.a_orders),
        })),
      });
    }

    // Kết quả từng SKU cache theo đúng bản gán SKU đang dùng (WeakMap → báo cáo mới thì tự bỏ), để bấm lại
    // SKU đã mở (quay lại, mở lại sau khi sửa bid) có ngay; SKU lớn đọc nguội từ đĩa mất 2–4s.
    const skuKey = `${sku.toUpperCase()}|${(searchParams.get("asin") || "").trim().toUpperCase()}|${days}|${activeOnly ? "active" : "all"}`;
    let perSku = skuPayloadCache.get(attribution);
    if (!perSku) {
      perSku = new Map();
      skuPayloadCache.set(attribution, perSku);
    }
    let payloadPromise = perSku.get(skuKey);
    if (payloadPromise) {
      perSku.delete(skuKey);
      perSku.set(skuKey, payloadPromise);
    } else {
      payloadPromise = (async () => {
        // Chỉ lấy target của đúng các cặp campaign + ad group có nhóm gán về SKU này (campaign_id để dùng index
        // campaign, cặp ad group để không trả về target của SKU khác cùng campaign), rồi gán lại từng dòng như trên.
        const skuUpper = sku.toUpperCase();
        const pairs = new Map<string, { campaignId: string; adGroupId: string }>();
        for (const g of attribution.groups) {
          if (g.sku_key?.toUpperCase() !== skuUpper || (activeOnly && !g.active)) continue;
          pairs.set(`${g.campaign_id}|${g.ad_group_id}`, { campaignId: g.campaign_id, adGroupId: g.ad_group_id });
        }
        const pairList = Array.from(pairs.values());
        const campaignIds = Array.from(new Set(pairList.map((x) => x.campaignId)));
        const pairCampaigns = pairList.map((x) => x.campaignId);
        const pairAdGroups = pairList.map((x) => x.adGroupId);
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
          snapshot_date: string;
          fallback_sku: string | null;
        }>>`
          SELECT p.ad_type, p.campaign_id, p.campaign_name, p.campaign_state, p.ad_group_id, p.ad_group_name, p.ad_group_state,
            p.target_id, p.target_expression, p.match_type, p.state, p.bid,
            p.impressions, p.clicks, p.spend, p.sales, p.orders, p.snapshot_date::text,
            COALESCE(NULLIF(upper(trim(p.sku)), ''), upper(substring(p.campaign_name from ${SKU_CODE_RE}))) AS fallback_sku
          FROM ppc_performance_facts p
          WHERE ${targetFilter}
            AND p.campaign_id = ANY(${campaignIds})
            AND (p.campaign_id, p.ad_group_id) IN (SELECT * FROM unnest(${pairCampaigns}::text[], ${pairAdGroups}::text[]))
            ${activeOnly ? sql`
              AND lower(p.state) NOT IN ('paused', 'archived', 'disabled')
              AND lower(p.campaign_state) NOT IN ('paused', 'archived', 'disabled')
              AND lower(p.ad_group_state) NOT IN ('paused', 'archived', 'disabled')
            ` : sql``}
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
        return {
          success: true,
          sku: sku.toUpperCase(),
          reportRange: { start: starts[0], end: ends[ends.length - 1] },
          truncated: rows.length >= MAX_ROWS,
          items,
        };
      })();
      const cacheMap = perSku;
      cacheMap.set(skuKey, payloadPromise);
      payloadPromise.catch(() => cacheMap.delete(skuKey));
      while (cacheMap.size > SKU_CACHE_MAX) cacheMap.delete(cacheMap.keys().next().value!);
    }
    return Response.json(await payloadPromise);
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tải target cho Manual Bid.", 500);
  }
}
