// lib/ppc/manual-bid-attribution.ts
// Gán target → SKU cho tab Manual Bid (bảng SKU và màn target dùng chung nên số khớp nhau):
//   1. SKU của product ad trong cùng ad group (camp SP luôn có, đúng cả mã "lạ" như RESIN DOLL_GARDENING);
//   2. tên campaign bắt đầu bằng 1 SKU đã biết của store (camp SB không có product ad), lấy mã dài nhất;
//   3. cột SKU của dòng; 4. mã dạng chữ+số ở tên campaign.
// Ad group có nhiều SKU product ad thì target tính cho từng SKU.
//
// Phải quét toàn bộ target + product ad của store trong kỳ (FASTPEACE ~1,1 triệu target, ~7s; đọc nguội lâu hơn),
// nên kết quả được cache trong bộ nhớ theo store + snapshot, và được tính sẵn ở nền (startManualBidPrewarm)
// lúc app khởi động và mỗi khi nạp báo cáo mới → người dùng mở tab không phải chờ.
import type { getDatabaseClient } from "@/lib/db";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

export const SKU_CODE_RE = "([A-Za-z]{2,5}[0-9]{4,8}[A-Za-z0-9]*)";

export type ReportSnapshot = { report_start_date: string; report_end_date: string; version?: string | null };

// 1 nhóm = các target cùng campaign / ad group / SKU dòng / tên campaign / trạng thái active, đã gán SKU.
// FASTPEACE ~1,1 triệu target/kỳ chỉ còn ~57 nghìn nhóm → giữ được trong bộ nhớ.
export type TargetGroup = {
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

export type Attribution = {
  groups: TargetGroup[];
  /** campaign|adGroup → SKU của product ad trong ad group (có thể nhiều SKU). */
  adGroupSkus: Map<string, string[]>;
  /** campaign → SKU dò theo tiền tố tên campaign. */
  campaignSku: Map<string, string>;
};

/** Ngày báo cáo hiển thị trên UI (7D/14D/30D/60D); tính sẵn cho những kỳ có snapshot active. */
const PREWARM_COVERAGE_DAYS = [7, 14, 30, 60];
const PREWARM_INTERVAL_MS = 5 * 60_000;
const PREWARM_START_DELAY_MS = 20_000;
// Khoá có snapshot_id + activated_at → dữ liệu dưới một khoá không đổi, không cần hết hạn (chỉ đẩy bớt khi đầy).
// Fallback không có ppc_active_snapshots thì không có phiên bản nên chỉ giữ ngắn.
const UNVERSIONED_TTL_MS = 5 * 60_000;
const CACHE_MAX = 40;

type CacheEntry = { at: number; versioned: boolean; promise: Promise<Attribution> };
// Đặt trên globalThis: instrumentation (tính sẵn) và route có thể là 2 bản module khác nhau trong Next.js.
const globalForManualBid = globalThis as typeof globalThis & {
  manualBidAttributionCache?: Map<string, CacheEntry>;
  manualBidPrewarmTimer?: NodeJS.Timeout;
};
const cache = (globalForManualBid.manualBidAttributionCache ??= new Map<string, CacheEntry>());

export function snapshotFilter(sql: Sql, snaps: ReportSnapshot[]) {
  return snaps
    .map((s) => sql`(p.report_start_date = ${s.report_start_date} AND p.report_end_date = ${s.report_end_date})`)
    .reduce((acc, cur) => sql`${acc} OR ${cur}`);
}

/** Điều kiện target dùng cho Manual Bid (bảng SKU và màn target phải dùng đúng điều kiện này). */
export function targetFilter(sql: Sql, storeId: string, snaps: ReportSnapshot[]) {
  return sql`
    p.store_id = ${storeId}
    AND p.grain = 'TARGET'
    AND NOT p.is_negative
    AND lower(p.state) <> 'archived'
    AND lower(p.campaign_state) <> 'archived'
    AND (${snapshotFilter(sql, snaps)})
  `;
}

export async function resolveReportSnapshots(sql: Sql, storeId: string, days: number): Promise<ReportSnapshot[]> {
  const active = await sql<ReportSnapshot[]>`
    SELECT a.report_start_date::text, a.report_end_date::text, a.snapshot_id || '@' || a.activated_at::text AS version
    FROM ppc_active_snapshots a
    WHERE a.store_id = ${storeId} AND a.coverage_days = ${days}
  `;
  if (active.length > 0) return Array.from(active);
  const fallback = await sql<ReportSnapshot[]>`
    SELECT DISTINCT ON (p.ad_type) p.report_start_date::text, p.report_end_date::text
    FROM ppc_performance_facts p
    WHERE p.store_id = ${storeId}
      AND (p.report_end_date - p.report_start_date + 1) BETWEEN ${days - 3}::integer AND ${days + 3}::integer
    ORDER BY p.ad_type, p.snapshot_date DESC, p.report_end_date DESC
  `;
  return Array.from(fallback);
}

async function computeAttribution(sql: Sql, storeId: string, snaps: ReportSnapshot[]): Promise<Attribution> {
  const snapFilter = snapshotFilter(sql, snaps);
  const groups = await sql<TargetGroup[]>`
    WITH
    ag AS (
      SELECT DISTINCT p.campaign_id, p.ad_group_id, upper(trim(p.sku)) AS sku
      FROM ppc_performance_facts p
      WHERE p.store_id = ${storeId}
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
      WHERE ${targetFilter(sql, storeId, snaps)}
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
}

export function getManualBidAttribution(sql: Sql, storeId: string, snaps: ReportSnapshot[]): Promise<Attribution> {
  const key = `${storeId}|${snaps.map((x) => `${x.report_start_date}~${x.report_end_date}~${x.version || ""}`).sort().join(",")}`;
  const versioned = snaps.every((x) => Boolean(x.version));
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && (hit.versioned || now - hit.at < UNVERSIONED_TTL_MS)) {
    cache.delete(key); // đưa lên cuối = mới dùng gần nhất
    cache.set(key, hit);
    return hit.promise;
  }
  const promise = computeAttribution(sql, storeId, snaps);
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
  cache.delete(key);
  cache.set(key, { at: now, versioned, promise });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return promise;
}

/**
 * Tính sẵn cache Manual Bid cho mọi store có snapshot active (kỳ 7/14/30/60 ngày) lúc app khởi động,
 * rồi cứ 5 phút kiểm tra lại: snapshot đổi (vừa nạp báo cáo) thì khoá đổi → tính lại; không đổi thì trúng cache, không tốn gì.
 * Chạy lần lượt từng store để không dồn tải lên DB. Tắt bằng PPC_MANUAL_BID_PREWARM=off.
 */
export function startManualBidPrewarm(getSql: () => Promise<Sql>) {
  if (process.env.PPC_MANUAL_BID_PREWARM === "off") return;
  if (globalForManualBid.manualBidPrewarmTimer) clearInterval(globalForManualBid.manualBidPrewarmTimer);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sql = await getSql();
      const rows = await sql<Array<{ store_id: string; coverage_days: number }>>`
        SELECT DISTINCT store_id, coverage_days FROM ppc_active_snapshots
        WHERE coverage_days IN ${sql(PREWARM_COVERAGE_DAYS)}
        ORDER BY coverage_days DESC, store_id
      `;
      for (const row of rows) {
        try {
          const snaps = await resolveReportSnapshots(sql, row.store_id, row.coverage_days);
          if (snaps.length > 0) await getManualBidAttribution(sql, row.store_id, snaps);
        } catch (error) {
          console.warn("[manual-bid] prewarm store failed", row.store_id, row.coverage_days, error);
        }
      }
    } catch (error) {
      console.warn("[manual-bid] prewarm failed", error);
    } finally {
      running = false;
    }
  };
  const start = setTimeout(() => void tick(), PREWARM_START_DELAY_MS);
  start.unref?.();
  globalForManualBid.manualBidPrewarmTimer = setInterval(() => void tick(), PREWARM_INTERVAL_MS);
  globalForManualBid.manualBidPrewarmTimer.unref?.();
}
