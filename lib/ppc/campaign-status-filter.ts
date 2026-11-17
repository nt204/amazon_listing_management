import "server-only";

import type postgres from "postgres";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = postgres.Sql<any>;

/**
 * Lọc "chỉ campaign đang chạy" cho các tab Target / Search Term / SKU / Đối soát ST / Negative / Sale KW.
 * Giao diện mặc định gửi `campaignStatus=ACTIVE`, bật "Gồm paused" thì gửi `ALL`.
 * Không gửi tham số (bot Lark, script cũ…) → `ALL`, giữ nguyên hành vi cũ.
 */
export type PpcCampaignStatusFilter = "ACTIVE" | "ALL";

export function parseCampaignStatus(value: string | null | undefined): PpcCampaignStatusFilter {
  return (value || "").trim().toUpperCase() === "ACTIVE" ? "ACTIVE" : "ALL";
}

const activeCampaignsCache = new Map<string, { list: string[]; expiresAt: number }>();
const CACHE_MS = 10 * 60_000;

/**
 * Lấy danh sách tên campaign đang enabled từ snapshot mới nhất của store (cache 10 phút).
 * Tránh subquery phức tạp trên từng dòng facts khiến Postgres chọn nested loop 20-40s.
 */
export async function getActiveCampaignNames(
  sql: Db,
  storeId?: string | null,
): Promise<string[] | null> {
  const cacheKey = storeId || "ALL";
  const hit = activeCampaignsCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.list;

  const snapStoreFilter = storeId ? sql`WHERE store_id = ${storeId}::uuid` : sql``;
  const storeFilter = storeId ? sql`AND cs_act.store_id = ${storeId}::uuid` : sql``;

  const rows = await sql<{ campaign_name: string }[]>`
    SELECT DISTINCT cs_act.campaign_name
    FROM ppc_campaign_summary cs_act
    JOIN (
      SELECT DISTINCT ON (store_id) store_id, snapshot_id, coverage_days
      FROM ppc_active_snapshots
      ${snapStoreFilter}
      ORDER BY store_id, report_end_date DESC, coverage_days DESC
    ) snap_act ON snap_act.store_id = cs_act.store_id
      AND snap_act.snapshot_id = cs_act.snapshot_id
      AND snap_act.coverage_days = cs_act.coverage_days
    WHERE lower(COALESCE(cs_act.campaign_state, '')) = 'enabled'
      ${storeFilter}
  `;

  const list = rows.map((r) => r.campaign_name).filter(Boolean);
  activeCampaignsCache.set(cacheKey, { list, expiresAt: Date.now() + CACHE_MS });
  return list;
}

/**
 * Điều kiện SQL "campaign của dòng này đang enabled".
 * Nếu truyền `activeCampaignNames` (đã cache), dùng `ANY(...)` nhanh gấp 40-70 lần so với subquery.
 * Nếu không truyền, fallback sang subquery an toàn.
 */
export function ppcActiveCampaignWhere(
  sql: Db,
  status: PpcCampaignStatusFilter,
  cols: {
    storeIdCol: string;
    campaignCol: string;
    storeId?: string | null;
    activeCampaignNames?: string[] | null;
  },
): postgres.Fragment {
  if (status !== "ACTIVE") return sql`TRUE`;

  if (Array.isArray(cols.activeCampaignNames)) {
    if (cols.activeCampaignNames.length === 0) {
      return sql`1 = 0`;
    }
    return sql`${sql.unsafe(cols.campaignCol)} = ANY(${cols.activeCampaignNames}::text[])`;
  }

  // Fallback sang subquery nếu caller chưa truyền danh sách đã nạp sẵn
  const key = sql.unsafe(`(${cols.storeIdCol}::text || '|' || lower(trim(${cols.campaignCol})))`);
  const storeFilter = cols.storeId ? sql`AND cs_act.store_id = ${cols.storeId}::uuid` : sql``;
  const snapStoreFilter = cols.storeId ? sql`WHERE store_id = ${cols.storeId}::uuid` : sql``;
  return sql`${key} IN (
    SELECT cs_act.store_id::text || '|' || lower(trim(cs_act.campaign_name))
    FROM ppc_campaign_summary cs_act
    JOIN (
      SELECT DISTINCT ON (store_id) store_id, snapshot_id, coverage_days
      FROM ppc_active_snapshots
      ${snapStoreFilter}
      ORDER BY store_id, report_end_date DESC, coverage_days DESC
    ) snap_act ON snap_act.store_id = cs_act.store_id
      AND snap_act.snapshot_id = cs_act.snapshot_id
      AND snap_act.coverage_days = cs_act.coverage_days
    WHERE (cs_act.campaign_state = 'enabled' OR lower(COALESCE(cs_act.campaign_state, '')) = 'enabled')
      ${storeFilter}
  )`;
}

/** Phần thêm vào cache key. */
export function campaignStatusCacheSuffix(status: PpcCampaignStatusFilter): string {
  return status === "ACTIVE" ? ":st=active" : "";
}

