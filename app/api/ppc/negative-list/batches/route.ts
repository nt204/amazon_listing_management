// Lô Negative List CHƯA sang Negative Hub:
//  - Lô "Xuất File" (ppc_negative_batches, dòng registry state 'exported'): chờ người dùng tick "Đã upload lên Amazon".
//  - Lô Auto Upload đang chạy (ppc_auto_upload_logs, dòng registry state 'pending'): worker tự chuyển 'enabled' khi xong.
// GET  ?storeName=                          → danh sách lô chờ của store
// POST { storeName, batchId, action }       → action = "confirm" (đã upload → sang Negative Hub) | "cancel" (huỷ lô)
import { ApiError, authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { invalidateCachePattern } from "@/lib/redis";
import { assertActorPpcStoreActionAccess } from "@/lib/ppc/store-user-access";

export const runtime = "nodejs";

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

async function resolveStore(sql: Sql, teamId: string, storeName: string) {
  if (!storeName || storeName === "ALL") throw new ApiError("Vui lòng chọn 1 Store cụ thể.", 400);
  const [row] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM ppc_stores
    WHERE LOWER(name) = LOWER(${storeName}) AND team_id = ${teamId}
    LIMIT 1
  `;
  if (!row) throw new ApiError(`Không tìm thấy Store "${storeName}".`, 404);
  return row;
}

export interface NegativePendingBatch {
  id: string;
  kind: "EXPORT" | "AUTO_UPLOAD";
  fileName: string;
  matchType: string;
  status: string;
  rowCount: number;
  keywordCount: number;
  campaignCount: number;
  keywords: string[];
  createdAt: string;
  createdBy: string | null;
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, (searchParams.get("storeName") || "").trim());

    // Đếm trực tiếp trên registry: 1 cặp có thể đã bị lô mới hơn / Auto Upload "lấy" mất
    const rows = await sql<Array<{
      id: string;
      kind: "EXPORT" | "AUTO_UPLOAD";
      file_name: string | null;
      match_type: string;
      status: string | null;
      row_count: number;
      keyword_count: number;
      campaign_count: number;
      keywords: string[];
      created_at: string;
      created_by: string | null;
    }>>`
      WITH grouped AS (
        SELECT r.source_job_id AS id, r.state,
               min(r.match_type) AS match_type,
               count(*)::int AS row_count,
               count(DISTINCT lower(r.keyword_text))::int AS keyword_count,
               count(DISTINCT r.campaign_name)::int AS campaign_count,
               (array_agg(DISTINCT lower(r.keyword_text)))[1:400] AS keywords,
               min(r.created_at) AS first_at
        FROM ppc_negative_registry r
        WHERE r.team_id = ${actor.teamId}
          AND r.store_id = ${store.id}
          AND r.source = 'NEGATIVE_LIST'
          AND r.state IN ('exported', 'pending')
          AND r.source_job_id IS NOT NULL
        GROUP BY r.source_job_id, r.state
      )
      SELECT g.id,
             CASE WHEN g.state = 'exported' THEN 'EXPORT' ELSE 'AUTO_UPLOAD' END AS kind,
             COALESCE(b.file_name, l.file_name) AS file_name,
             COALESCE(b.match_type, g.match_type) AS match_type,
             COALESCE(b.status, l.status) AS status,
             g.row_count, g.keyword_count, g.campaign_count, g.keywords,
             COALESCE(b.created_at, l.created_at, g.first_at) AS created_at,
             COALESCE(u.display_name, b.created_by, l.created_by) AS created_by
      FROM grouped g
      LEFT JOIN ppc_negative_batches b ON b.id = g.id AND g.state = 'exported'
      LEFT JOIN ppc_auto_upload_logs l ON l.id::text = g.id AND g.state = 'pending'
      LEFT JOIN app_users u ON u.team_id = ${actor.teamId} AND u.user_id = COALESCE(b.created_by, l.created_by)
      ORDER BY COALESCE(b.created_at, l.created_at, g.first_at) DESC
      LIMIT 100
    `;

    const batches: NegativePendingBatch[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      fileName: r.file_name || "",
      matchType: r.match_type,
      status: r.status || "",
      rowCount: Number(r.row_count),
      keywordCount: Number(r.keyword_count),
      campaignCount: Number(r.campaign_count),
      keywords: r.keywords || [],
      createdAt: r.created_at,
      createdBy: r.created_by,
    }));
    return Response.json({ success: true, batches });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được lô phủ định chờ xác nhận.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    const body = await request.json().catch(() => ({}));
    const batchId = String(body?.batchId || "").trim();
    const action = body?.action === "cancel" ? "cancel" : body?.action === "confirm" ? "confirm" : "";
    if (!batchId) throw new ApiError("Thiếu mã lô.", 400);
    if (!action) throw new ApiError("Thao tác không hợp lệ.", 400);

    const sql = await getDatabaseClient();
    const store = await resolveStore(sql, actor.teamId, String(body?.storeName || "").trim());
    await assertActorPpcStoreActionAccess(actor.teamId, actor.userId, store.id);

    const [batch] = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM ppc_negative_batches
      WHERE id = ${batchId} AND team_id = ${actor.teamId} AND store_id = ${store.id}
      LIMIT 1
    `;
    if (!batch) throw new ApiError("Không tìm thấy lô xuất file này (lô Auto Upload tự cập nhật khi Mac mini chạy xong).", 404);

    const affected = await sql.begin(async (tx) => {
      if (action === "confirm") {
        const updated = await tx`
          UPDATE ppc_negative_registry
          SET state = 'enabled', updated_at = NOW()
          WHERE team_id = ${actor.teamId} AND store_id = ${store.id}
            AND source_job_id = ${batchId} AND state = 'exported'
          RETURNING 1
        `;
        await tx`
          UPDATE ppc_negative_batches
          SET status = 'UPLOADED', confirmed_by = ${actor.userId}, confirmed_at = NOW()
          WHERE id = ${batchId}
        `;
        return updated.length;
      }
      const deleted = await tx`
        DELETE FROM ppc_negative_registry
        WHERE team_id = ${actor.teamId} AND store_id = ${store.id}
          AND source_job_id = ${batchId} AND state = 'exported'
        RETURNING 1
      `;
      await tx`
        UPDATE ppc_negative_batches
        SET status = 'CANCELLED', confirmed_by = ${actor.userId}, confirmed_at = NOW()
        WHERE id = ${batchId}
      `;
      return deleted.length;
    });

    await invalidateCachePattern(`ppc:query:st-opt:${actor.teamId}:*`).catch(() => {});
    return Response.json({
      success: true,
      affected,
      message:
        action === "confirm"
          ? `Đã chuyển ${affected.toLocaleString("en-US")} dòng phủ định sang Negative Hub.`
          : `Đã huỷ lô (${affected.toLocaleString("en-US")} dòng).`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật lô phủ định.", 500);
  }
}
