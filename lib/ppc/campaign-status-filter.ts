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

/**
 * Điều kiện SQL "campaign của dòng này đang enabled". Trạng thái lấy từ snapshot mới nhất của store
 * (report_end_date lớn nhất, ưu tiên kỳ dài nhất để đủ campaign) — là trạng thái hiện tại, không phụ thuộc kỳ đang xem.
 * `storeIdCol` / `campaignCol` là tên cột cố định trong code (không lấy từ người dùng). status ALL → TRUE.
 */
export function ppcActiveCampaignWhere(
  sql: Db,
  status: PpcCampaignStatusFilter,
  cols: { storeIdCol: string; campaignCol: string; storeId?: string | null },
): postgres.Fragment {
  if (status !== "ACTIVE") return sql`TRUE`;
  // Một giá trị ghép "store_id|tên campaign" (không dùng IN theo cặp cột): Postgres luôn băm được danh sách campaign
  // đang chạy (hashed SubPlan). Dạng cặp cột khiến planner chọn nested loop ở truy vấn lọc store theo tên → quá 2 phút.
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
    WHERE lower(COALESCE(cs_act.campaign_state, '')) = 'enabled'
      ${storeFilter}
  )`;
}

/** Phần thêm vào cache key. */
export function campaignStatusCacheSuffix(status: PpcCampaignStatusFilter): string {
  return status === "ACTIVE" ? ":st=active" : "";
}
