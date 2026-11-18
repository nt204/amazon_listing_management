// Tra toàn bộ campaign đang quảng cáo 1 hoặc nhiều ASIN (dùng cho "Negative List").
// ASIN chỉ nằm ở dòng PRODUCT của facts → map ASIN → campaign_id của snapshot đang dùng, cache theo snapshot
// (quét 1 lần / snapshot), rồi lấy chi tiết campaign qua index (store_id, campaign_id, grain).
import type { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

export interface AsinCampaign {
  asin: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adType: string;
  campaignState: string;
  clicks: number;
  spend: number;
  orders: number;
}

const ASIN_CAMPAIGN_MAP_TTL_SECONDS = 6 * 60 * 60;
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export function normalizeAsins(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.map(String) : String(input || "").split(/[\s,;]+/);
  return [...new Set(raw.map((a) => a.trim().toUpperCase()).filter((a) => ASIN_PATTERN.test(a)))];
}

type AsinMap = Record<string, { c: string[]; s: string[] }>;
type Snap = { snapshot_id: string; report_start_date: string; report_end_date: string };

// Map ASIN → { c: campaign_id[], s: sku[] } của snapshot dài nhất, mới nhất (bao phủ nhiều campaign nhất)
async function loadAsinCampaignMap(sql: Sql, storeId: string): Promise<{ snap: Snap | null; map: AsinMap }> {
  const [snap] = await sql<Snap[]>`
    SELECT snapshot_id, report_start_date::text, report_end_date::text
    FROM ppc_active_snapshots
    WHERE store_id = ${storeId}
    ORDER BY coverage_days DESC, report_end_date DESC
    LIMIT 1
  `;
  if (!snap) return { snap: null, map: {} };
  const map = await getCachedOrFetch(
    `ppc:asin-campaign-map:v2:${storeId}:${snap.snapshot_id}:${snap.report_start_date}:${snap.report_end_date}`,
    ASIN_CAMPAIGN_MAP_TTL_SECONDS,
    async () => {
      const rows = await sql<Array<{ asin: string; campaign_ids: string[]; skus: string[] }>>`
        SELECT upper(trim(p.asin)) AS asin,
               array_agg(DISTINCT p.campaign_id) AS campaign_ids,
               array_remove(array_agg(DISTINCT NULLIF(upper(trim(p.sku)), '')), NULL) AS skus
        FROM ppc_performance_facts p
        WHERE p.store_id = ${storeId}
          AND p.report_start_date = ${snap.report_start_date}::date
          AND p.report_end_date = ${snap.report_end_date}::date
          AND p.grain = 'PRODUCT'
          AND p.asin <> ''
          AND p.campaign_id <> ''
        GROUP BY 1
      `;
      return Object.fromEntries(rows.map((r) => [r.asin, { c: r.campaign_ids, s: r.skus || [] }])) as AsinMap;
    },
  );
  return { snap, map };
}

export interface AsinSearchItem {
  asin: string;
  skus: string[];
  campaignCount: number;
  mockupUrl: string | null;
}

// Gợi ý ASIN/SKU có campaign trong store (khớp 1 phần ASIN hoặc SKU), kèm ảnh mockup từ Bảng mã
export async function searchAsins(
  sql: Sql,
  params: { storeId: string; storeName: string; query: string; limit?: number },
): Promise<AsinSearchItem[]> {
  const q = params.query.trim().toUpperCase();
  if (q.length < 2) return [];
  const { map } = await loadAsinCampaignMap(sql, params.storeId);
  const scored: Array<{ asin: string; skus: string[]; count: number; rank: number }> = [];
  for (const [asin, v] of Object.entries(map)) {
    let rank = -1;
    if (asin === q || v.s.includes(q)) rank = 0;
    else if (asin.startsWith(q) || v.s.some((x) => x.startsWith(q))) rank = 1;
    else if (asin.includes(q) || v.s.some((x) => x.includes(q))) rank = 2;
    if (rank >= 0) scored.push({ asin, skus: v.s, count: v.c.length, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || b.count - a.count || a.asin.localeCompare(b.asin));
  const top = scored.slice(0, params.limit ?? 20);
  if (top.length === 0) return [];

  // Ảnh mockup: accounting_sku_master (store kế toán cùng tên, HSOSTORE ↔ WARMSTOREY), thiếu thì lấy store khác
  const accStoreName = params.storeName.toUpperCase().trim() === "HSOSTORE" ? "WARMSTOREY" : params.storeName;
  const skus = [...new Set(top.flatMap((t) => t.skus))];
  const asins = top.map((t) => t.asin);
  const mockRows = await sql<Array<{ sku: string; asin: string; mockup_url: string | null; same_store: boolean }>>`
    SELECT upper(trim(m.sku)) AS sku, upper(trim(m.asin)) AS asin,
           COALESCE(NULLIF(m.mockup_url, ''), NULLIF(m.mockup, '')) AS mockup_url,
           COALESCE(upper(st.name) = upper(${accStoreName}), false) AS same_store
    FROM accounting_sku_master m
    LEFT JOIN stores st ON st.id = m.store_id
    WHERE m.deleted_at IS NULL
      AND (upper(trim(m.sku)) = ANY(${skus}) OR upper(trim(m.asin)) = ANY(${asins}))
      AND COALESCE(NULLIF(m.mockup_url, ''), NULLIF(m.mockup, '')) IS NOT NULL
    ORDER BY same_store DESC
  `;
  const bySku = new Map<string, string>();
  const byAsin = new Map<string, string>();
  for (const r of mockRows) {
    if (r.mockup_url && !bySku.has(r.sku)) bySku.set(r.sku, r.mockup_url);
    if (r.mockup_url && r.asin && !byAsin.has(r.asin)) byAsin.set(r.asin, r.mockup_url);
  }
  return top.map((t) => ({
    asin: t.asin,
    skus: t.skus,
    campaignCount: t.count,
    mockupUrl: t.skus.map((x) => bySku.get(x)).find(Boolean) || byAsin.get(t.asin) || null,
  }));
}

export async function loadAsinCampaigns(
  sql: Sql,
  params: { storeId: string; asins: string[] },
): Promise<{ campaigns: AsinCampaign[]; snapshot: { start: string; end: string } | null }> {
  if (params.asins.length === 0) return { campaigns: [], snapshot: null };

  const { snap, map } = await loadAsinCampaignMap(sql, params.storeId);
  if (!snap) return { campaigns: [], snapshot: null };

  const campaignAsin = new Map<string, string>();
  for (const asin of params.asins) {
    for (const id of map[asin]?.c || []) if (!campaignAsin.has(id)) campaignAsin.set(id, asin);
  }
  if (campaignAsin.size === 0) {
    return { campaigns: [], snapshot: { start: snap.report_start_date, end: snap.report_end_date } };
  }

  const rows = await sql<Array<{
    campaign_id: string;
    campaign_name: string;
    ad_group_id: string;
    ad_group_name: string;
    ad_type: string;
    campaign_state: string;
    clicks: string;
    spend: string;
    orders: string;
  }>>`
    SELECT p.campaign_id, p.campaign_name, p.ad_group_id, p.ad_group_name, p.ad_type, p.campaign_state,
           SUM(p.clicks) AS clicks, SUM(p.spend) AS spend, SUM(p.orders) AS orders
    FROM ppc_performance_facts p
    WHERE p.store_id = ${params.storeId}
      AND p.campaign_id = ANY(${[...campaignAsin.keys()]})
      AND p.grain = 'PRODUCT'
      AND p.report_start_date = ${snap.report_start_date}::date
      AND p.report_end_date = ${snap.report_end_date}::date
    GROUP BY 1, 2, 3, 4, 5, 6
  `;

  // 1 dòng / campaign (campaign nhiều ad group → giữ ad group đầu tiên; phủ định ở cấp campaign nên không cần)
  const campaigns = new Map<string, AsinCampaign>();
  for (const r of rows) {
    const prev = campaigns.get(r.campaign_id);
    if (prev) {
      prev.clicks += Number(r.clicks || 0);
      prev.spend = Math.round((prev.spend + Number(r.spend || 0)) * 100) / 100;
      prev.orders += Number(r.orders || 0);
      continue;
    }
    campaigns.set(r.campaign_id, {
      asin: campaignAsin.get(r.campaign_id) || "",
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      adGroupId: r.ad_group_id || "",
      adGroupName: r.ad_group_name || "",
      adType: r.ad_type || "SP",
      campaignState: (r.campaign_state || "enabled").toLowerCase(),
      clicks: Number(r.clicks || 0),
      spend: Math.round(Number(r.spend || 0) * 100) / 100,
      orders: Number(r.orders || 0),
    });
  }

  const list = [...campaigns.values()].sort(
    (a, b) => a.asin.localeCompare(b.asin) || b.spend - a.spend || a.campaignName.localeCompare(b.campaignName),
  );
  return { campaigns: list, snapshot: { start: snap.report_start_date, end: snap.report_end_date } };
}
