import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { listPpcStores } from "@/lib/ppc/repository";

export const runtime = "nodejs";

// GET: Polling job cho máy Mac HOẶC Lấy danh sách job cho giao diện Web
export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "list";
    const sql = await getDatabaseClient();

    if (action === "poll") {
      // Claim nguyên tử để hai worker không thể nhận cùng một job.
      const rows = await sql.begin(async (tx) => {
        await tx`
          UPDATE ppc_sync_jobs
          SET status = 'FAILED', error_message = 'Worker mất kết nối quá 45 phút',
              current_step = 'Job hết hạn do worker không heartbeat', completed_at = NOW(), updated_at = NOW()
          WHERE team_id = ${actor.teamId} AND status = 'RUNNING'
            AND updated_at < NOW() - INTERVAL '45 minutes'
        `;
        return tx`
          UPDATE ppc_sync_jobs
          SET status = 'RUNNING', claimed_at = NOW(), updated_at = NOW(),
              current_step = 'Máy Mac đã nhận lệnh, đang chuẩn bị...'
          WHERE id = (
            SELECT id FROM ppc_sync_jobs
            WHERE team_id = ${actor.teamId} AND status = 'PENDING'
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING id, team_id, store_name, status, progress_pct, current_step, created_at
        `;
      });

      return Response.json({
        hasJob: rows.length > 0,
        job: rows[0] || null,
      });
    }

    // Giao diện Web lấy trạng thái các job gần nhất
    const rows = await sql`
      SELECT id, team_id, store_name, status, progress_pct, current_step, total_files, processed_files, error_message, created_at, updated_at
      FROM ppc_sync_jobs
      WHERE team_id = ${actor.teamId}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return Response.json({
      jobs: rows,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy thông tin crawler job.", 500);
  }
}

// POST: Tạo job crawl mới từ giao diện Web
export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request, 20_000);
    const body = await request.json().catch(() => ({}));
    const storeName = String(body?.storeName || "ALL").trim();
    const stores = await listPpcStores(dataScope(actor));
    if (storeName !== "ALL" && !stores.some((store) => store.name.toLowerCase() === storeName.toLowerCase())) {
      throw new ApiError(`Store "${storeName}" không tồn tại trong hệ thống.`, 400);
    }
    const totalFiles = (storeName === "ALL" ? stores.length : 1) * 6;

    const sql = await getDatabaseClient();

    // Chỉ cho phép một job pending/running trên mỗi team.
    const runningCheck = await sql`
      SELECT id, store_name FROM ppc_sync_jobs
      WHERE team_id = ${actor.teamId} AND status IN ('PENDING', 'RUNNING')
      LIMIT 1
    `;

    if (runningCheck.length > 0) {
      return Response.json(
        {
          error: "Hiện đang có một tiến trình crawl đang chạy dở. Vui lòng chờ hoàn tất!",
          activeJob: runningCheck[0],
        },
        { status: 409 },
      );
    }

    // Tạo job mới với trạng thái PENDING
    let insertRes;
    try {
      insertRes = await sql`
        INSERT INTO ppc_sync_jobs (team_id, store_name, status, progress_pct, current_step, total_files, processed_files)
        VALUES (${actor.teamId}, ${storeName}, 'PENDING', 0, 'Đã gửi lệnh, đang chờ máy Mac tiếp nhận...', ${totalFiles}, 0)
        RETURNING *
      `;
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return Response.json({ error: "Đã có một tiến trình crawl đang chờ hoặc đang chạy." }, { status: 409 });
      }
      throw error;
    }

    return Response.json({
      success: true,
      message: `Đã tạo lệnh crawl cho [${storeName}]. Máy Mac sẽ tiếp nhận trong vài giây!`,
      job: insertRes[0],
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo crawler job.", 500);
  }
}

// PATCH: Máy Mac cập nhật tiến độ (progress, status, current_step)
export async function PATCH(request: Request) {
  try {
    const actor = authorize(request, "write");
    const body = await request.json();
    const { jobId, status, progress_pct, current_step, error_message, processed_files } = body;

    if (!jobId) {
      return Response.json({ error: "Thiếu jobId" }, { status: 400 });
    }
    if (status != null && !["RUNNING", "COMPLETED", "FAILED"].includes(status)) {
      throw new ApiError("Trạng thái crawler job không hợp lệ.", 400);
    }
    if (progress_pct != null && (!Number.isInteger(progress_pct) || progress_pct < 0 || progress_pct > 100)) {
      throw new ApiError("Tiến độ crawler phải từ 0 đến 100.", 400);
    }

    const sql = await getDatabaseClient();
    const rows = await sql`
      UPDATE ppc_sync_jobs
      SET status = COALESCE(${status ?? null}, status),
          progress_pct = COALESCE(${progress_pct ?? null}, progress_pct),
          current_step = COALESCE(${current_step ?? null}, current_step),
          error_message = COALESCE(${error_message ?? null}, error_message),
          processed_files = COALESCE(${processed_files ?? null}, processed_files),
          completed_at = CASE WHEN ${status ?? null} IN ('COMPLETED', 'FAILED') THEN NOW() ELSE completed_at END,
          updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${actor.teamId}
        AND (${status ?? null}::text IS DISTINCT FROM 'COMPLETED' OR ${processed_files ?? null}::integer = total_files)
      RETURNING *
    `;

    if (rows.length === 0) {
      return Response.json({ error: "Không tìm thấy job hoặc số file hoàn tất không khớp total_files." }, { status: 409 });
    }

    return Response.json({
      success: true,
      job: rows[0],
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật crawler job.", 500);
  }
}
