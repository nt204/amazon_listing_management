// Số thật của từng campaign / target của 1 SKU trong snapshot đề xuất đang dùng (ppc_active_snapshots).
// Popup đề xuất trước đây cộng số từ các dòng đề xuất → target đang tiêu tiền nhưng không cần đổi bid
// bị ẩn, campaign hiện $0 dù vẫn chi tiền.
import type { getDatabaseClient } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

export interface SkuCampaignStat {
  campaignId: string;
  campaignName: string;
  campaignState: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

export interface SkuTargetStat {
  campaignId: string;
  campaignName: string;
  targetId: string;
  keyword: string;
  matchType: string;
  state: string;
  bid: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

const SKU_CAMPAIGN_MAP_TTL_SECONDS = 6 * 60 * 60;

const round2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

export async function loadSkuCampaignStats(
  sql: Sql,
  params: { teamId: string; storeName: string; days: number; sku: string },
): Promise<{ campaigns: SkuCampaignStat[]; targets: SkuTargetStat[] }> {
  const snaps = await sql<Array<{ store_id: string; snapshot_id: string; report_start_date: string; report_end_date: string }>>`
    SELECT a.store_id, a.snapshot_id, a.report_start_date::text, a.report_end_date::text
    FROM ppc_active_snapshots a
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE s.team_id = ${params.teamId}
      AND (${params.storeName === "ALL"} OR lower(s.name) = lower(${params.storeName}))
      AND a.coverage_days = ${params.days}
  `;
  const skuKey = params.sku.trim().toUpperCase();
  const pairs: Array<{ storeId: string; campaignId: string }> = [];
  for (const snap of snaps) {
    // SKU chỉ nằm ở dòng PRODUCT → map SKU → campaign của cả snapshot, cache theo snapshot (quét 1 lần)
    const map = await getCachedOrFetch(
      `ppc:sku-campaign-map:v1:${snap.store_id}:${snap.snapshot_id}:${snap.report_start_date}:${snap.report_end_date}`,
      SKU_CAMPAIGN_MAP_TTL_SECONDS,
      async () => {
        const rows = await sql<Array<{ sku: string; campaign_ids: string[] }>>`
          SELECT upper(trim(p.sku)) AS sku, array_agg(DISTINCT p.campaign_id) AS campaign_ids
          FROM ppc_performance_facts p
          WHERE p.store_id = ${snap.store_id}
            AND p.report_start_date = ${snap.report_start_date}::date
            AND p.report_end_date = ${snap.report_end_date}::date
            AND p.grain = 'PRODUCT'
            AND p.sku <> ''
            AND p.campaign_id <> ''
          GROUP BY 1
        `;
        return Object.fromEntries(rows.map((r) => [r.sku, r.campaign_ids])) as Record<string, string[]>;
      },
    );
    for (const campaignId of map[skuKey] || []) pairs.push({ storeId: snap.store_id, campaignId });
  }
  if (pairs.length === 0) return { campaigns: [], targets: [] };

  const rows = await sql<Array<{
    grain: string;
    campaign_id: string;
    campaign_name: string;
    campaign_state: string;
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
  }>>`
    WITH snap AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(snaps.map(({ store_id, report_start_date, report_end_date }) => ({ store_id, report_start_date, report_end_date })))}::text::jsonb)
        AS x(store_id uuid, report_start_date date, report_end_date date)
    ),
    camps AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(pairs)}::text::jsonb) AS x("storeId" uuid, "campaignId" text)
    )
    SELECT p.grain, p.campaign_id, p.campaign_name, p.campaign_state,
           p.target_id, p.target_expression, p.match_type, p.state, p.bid,
           p.impressions, p.clicks, p.spend, p.sales, p.orders
    FROM camps
    JOIN ppc_performance_facts p ON p.store_id = camps."storeId" AND p.campaign_id = camps."campaignId"
    JOIN snap ON snap.store_id = p.store_id
      AND snap.report_start_date = p.report_start_date
      AND snap.report_end_date = p.report_end_date
    WHERE p.grain IN ('CAMPAIGN', 'TARGET')
      AND p.is_negative = false
  `;

  const campaigns = new Map<string, SkuCampaignStat>();
  const targets = new Map<string, SkuTargetStat>();
  for (const r of rows) {
    if (r.grain === "CAMPAIGN") {
      const prev = campaigns.get(r.campaign_id);
      // Cùng khoảng ngày có thể có nhiều snapshot_date → giữ 1 dòng
      if (prev) continue;
      campaigns.set(r.campaign_id, {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        campaignState: (r.campaign_state || "").toLowerCase(),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend: round2(r.spend),
        sales: round2(r.sales),
        orders: Number(r.orders || 0),
      });
    } else {
      const key = `${r.campaign_id}::${r.target_id || `${r.target_expression}|${r.match_type}`}`;
      if (targets.has(key)) continue;
      targets.set(key, {
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        targetId: r.target_id,
        keyword: r.target_expression,
        matchType: r.match_type,
        state: (r.state || "").toLowerCase(),
        bid: round2(r.bid),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        spend: round2(r.spend),
        sales: round2(r.sales),
        orders: Number(r.orders || 0),
      });
    }
  }
  return { campaigns: [...campaigns.values()], targets: [...targets.values()] };
}
