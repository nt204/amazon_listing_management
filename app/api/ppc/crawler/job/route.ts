import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { listPpcStores } from "@/lib/ppc/repository";
import crypto from "node:crypto";
import type postgres from "postgres";

export const runtime = "nodejs";

function crawlerLeaseSeconds(): number {
  const value = Number.parseInt(process.env.PPC_CRAWLER_LEASE_SECONDS || "90", 10);
  return Number.isFinite(value) ? Math.min(300, Math.max(45, value)) : 90;
}

function publicJob(row: Record<string, unknown>) {
  const safeRow = { ...row };
  delete safeRow.lease_token;
  const taskStates = Array.isArray(row.task_states)
    ? row.task_states.map((task) => {
        if (!task || typeof task !== "object") return task;
        const safeTask = { ...task as Record<string, unknown> };
        delete safeTask.localPath;
        return safeTask;
      })
    : row.task_states;
  return { ...safeRow, task_states: taskStates };
}

// GET: Polling job cho máy Mac HOẶC Lấy danh sách job cho giao diện Web
export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "list";
    const workerId = searchParams.get("workerId") || "mac-mini";
    const sql = await getDatabaseClient();

    if (action === "poll") {
      const leaseSeconds = crawlerLeaseSeconds();
      // 1. Quản lý Lease: Chuyển các job chạy dở bị mất heartbeat quá 90s sang RETRY_WAIT
      // Nếu mất tín hiệu quá 120 phút thì mới coi là FAILED.
      await sql`
        UPDATE ppc_sync_jobs
        SET status = 'RETRY_WAIT',
            stage = 'RETRY_WAIT',
            error_message = 'Worker mất lease quá 90 giây; sẵn sàng để worker khác tiếp nhận từ checkpoint',
            current_step = 'Tạm dừng do mất kết nối; sẵn sàng resume',
            updated_at = NOW()
        WHERE team_id = ${actor.teamId}
          AND status = 'RUNNING'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < NOW()
          AND updated_at >= NOW() - INTERVAL '120 minutes'
      `;

      await sql`
        UPDATE ppc_sync_jobs
        SET status = 'FAILED',
            stage = 'FAILED',
            error_message = 'Worker mất kết nối quá 120 phút',
            current_step = 'Job hết hạn do worker không hoạt động quá 2 tiếng',
            completed_at = NOW(),
            updated_at = NOW()
        WHERE team_id = ${actor.teamId}
          AND status IN ('RUNNING', 'RETRY_WAIT')
          AND updated_at < NOW() - INTERVAL '120 minutes'
      `;

      // 2. Claim job theo cơ chế Lease Token nguyên tử (FOR UPDATE SKIP LOCKED)
      const newLeaseToken = crypto.randomUUID();
      const claimedJobs = await sql.begin(async (tx) => {
        return tx`
          UPDATE ppc_sync_jobs
          SET status = 'RUNNING',
              stage = CASE WHEN stage = 'PENDING' THEN 'CLAIMED' ELSE stage END,
              worker_id = ${workerId},
              lease_token = ${newLeaseToken},
              heartbeat_at = NOW(),
              lease_expires_at = NOW() + ${leaseSeconds} * INTERVAL '1 second',
              claimed_at = COALESCE(claimed_at, NOW()),
              updated_at = NOW(),
              current_step = CASE
                WHEN stage = 'RETRY_WAIT' THEN 'Máy Mac đã kết nối lại và khôi phục job từ checkpoint...'
                ELSE 'Máy Mac đã nhận lệnh, chuẩn bị mở AdsPower...'
              END
          WHERE id = (
            SELECT id FROM ppc_sync_jobs
            WHERE team_id = ${actor.teamId}
              AND status IN ('PENDING', 'RETRY_WAIT')
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          RETURNING id, team_id, store_name, status, stage, batch_id, progress_pct, current_step,
                    total_files, processed_files, worker_id, lease_token, heartbeat_at, lease_expires_at,
                    task_states, created_at, updated_at
        `;
      });

      return Response.json({
        hasJob: claimedJobs.length > 0,
        job: claimedJobs[0] || null,
      });
    }

    // Giao diện Web lấy danh sách & trạng thái chi tiết các job gần nhất
    const rows = await sql`
      SELECT id, team_id, store_name, status, stage, batch_id, progress_pct, current_step,
             total_files, processed_files, error_message, worker_id, lease_token, heartbeat_at,
             lease_expires_at, task_states, created_at, updated_at, completed_at
      FROM ppc_sync_jobs
      WHERE team_id = ${actor.teamId}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return Response.json({
      jobs: rows.map((row) => publicJob(row as Record<string, unknown>)),
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy thông tin crawler job.", 500);
  }
}

// POST: Tạo job crawl mới HOẶC Điều khiển job (cancel, resume)
export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request, 30_000);
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const body = await request.json().catch(() => ({}));
    const sql = await getDatabaseClient();

    // 1. Hủy Job cụ thể hoặc hủy toàn bộ job dở dang / dọn dẹp lịch sử
    if (action === "cancel" || action === "reset" || action === "cancel_all" || action === "clear_history") {
      const jobId = body?.jobId;
      if (jobId && action === "cancel") {
        const rows = await sql`
          UPDATE ppc_sync_jobs
          SET status = 'CANCELLED',
              stage = 'CANCELLED',
              current_step = 'Người dùng đã bấm hủy job trên giao diện Web',
              lease_expires_at = NULL,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = ${jobId} AND team_id = ${actor.teamId} AND status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
          RETURNING *
        `;
        if (rows.length === 0) throw new ApiError("Không tìm thấy job hoặc job đã kết thúc.", 404);
        return Response.json({ success: true, message: "Đã hủy job thành công.", job: rows[0] });
      }

      if (action === "clear_history") {
        await sql`
          DELETE FROM ppc_sync_jobs
          WHERE team_id = ${actor.teamId} AND status IN ('CANCELLED', 'FAILED', 'COMPLETED')
        `;
        return Response.json({ success: true, message: "Đã dọn dẹp lịch sử lệnh thành công." });
      }

      // Hủy tất cả job dở dang
      await sql`
        UPDATE ppc_sync_jobs
        SET status = 'CANCELLED',
            stage = 'CANCELLED',
            current_step = 'Người dùng đã xóa toàn bộ job cũ để chạy mới từ đầu',
            lease_expires_at = NULL,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE team_id = ${actor.teamId} AND status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
      `;
      return Response.json({ success: true, message: "Đã xóa toàn bộ job cũ thành công." });
    }

    // 2. Resume / Retry Job
    if (action === "resume") {
      const jobId = body?.jobId;
      if (!jobId) throw new ApiError("Thiếu jobId để resume.", 400);

      const existing = await sql`
        SELECT task_states FROM ppc_sync_jobs
        WHERE id = ${jobId} AND team_id = ${actor.teamId} AND status IN ('FAILED', 'RETRY_WAIT', 'CANCELLED')
        LIMIT 1
      `;
      if (existing.length === 0) throw new ApiError("Không tìm thấy job để resume.", 404);
      const resetTasks = (Array.isArray(existing[0].task_states) ? existing[0].task_states : []).map((task: Record<string, unknown>) =>
        task.status === "FAILED"
          ? { ...task, status: "NOT_STARTED", attempt: 0, amazonRequestId: null, lastError: null, nextRetryAt: null }
          : task,
      );

      const rows = await sql`
        UPDATE ppc_sync_jobs
        SET status = 'RETRY_WAIT',
            stage = 'RETRY_WAIT',
            error_message = NULL,
            current_step = 'Đang chờ máy Mac tiếp tục từ checkpoint...',
            task_states = ${sql.json(resetTasks as unknown as postgres.JSONValue)},
            worker_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            completed_at = NULL,
            updated_at = NOW()
        WHERE id = ${jobId} AND team_id = ${actor.teamId} AND status IN ('FAILED', 'RETRY_WAIT', 'CANCELLED')
        RETURNING *
      `;
      if (rows.length === 0) throw new ApiError("Không tìm thấy job để resume.", 404);
      return Response.json({ success: true, message: "Đã đưa job vào hàng đợi resume.", job: rows[0] });
    }

    // 3. Tạo Job Crawl Mới
    const storeName = String(body?.storeName || "ALL").trim();
    const stores = await listPpcStores(dataScope(actor));
    if (storeName !== "ALL" && !stores.some((store) => store.name.toLowerCase() === storeName.toLowerCase())) {
      throw new ApiError(`Store "${storeName}" không tồn tại trong hệ thống.`, 400);
    }
    const requestedStoreNames: string[] = Array.isArray(body?.storeNames)
      ? [...new Set<string>(body.storeNames.map((value: unknown) => String(value).trim()).filter(Boolean))]
      : [];
    let targetStoreNames: string[];
    if (storeName === "ALL" && requestedStoreNames.length) {
      const knownByName = new Map(stores.map((store) => [store.name.toLowerCase(), store.name]));
      const invalid = requestedStoreNames.filter((name) => !knownByName.has(name.toLowerCase()));
      if (invalid.length) throw new ApiError(`Store không tồn tại trong hệ thống: ${invalid.join(", ")}.`, 400);
      targetStoreNames = requestedStoreNames.map((name) => knownByName.get(name.toLowerCase())!);
    } else {
      targetStoreNames = storeName === "ALL" ? stores.map((store) => store.name) : [storeName];
    }
    const totalFiles = targetStoreNames.length * 6;

    // Kiểm tra xem có job nào đang chạy không
    const runningCheck = await sql`
      SELECT id, store_name, status, stage FROM ppc_sync_jobs
      WHERE team_id = ${actor.teamId} AND status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
      LIMIT 1
    `;

    if (runningCheck.length > 0) {
      if (body?.forceNew) {
        await sql`
          UPDATE ppc_sync_jobs
          SET status = 'CANCELLED',
              stage = 'CANCELLED',
              current_step = 'Đã hủy job cũ để bắt đầu lượt mới',
              lease_expires_at = NULL,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE team_id = ${actor.teamId} AND status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
        `;
      } else {
        return Response.json(
          {
            error: "Hiện đang có một tiến trình crawl đang chạy dở. Bạn có thể theo dõi hoặc bấm Resume/Hủy.",
            activeJob: runningCheck[0],
          },
          { status: 409 },
        );
      }
    }

    // Khởi tạo batch_id và danh sách task_states ban đầu
    const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const batchId = `${storeName}_${todayCompact}_${randomSuffix}`;

    const defaultTaskTypes: Array<{ type: "BULK_SP" | "BULK_SB" | "ST_SP" | "ST_SB"; days: number }> = [
      { type: "BULK_SP", days: 30 },
      { type: "BULK_SB", days: 30 },
      { type: "BULK_SP", days: 7 },
      { type: "BULK_SB", days: 7 },
      { type: "ST_SP", days: 30 },
      { type: "ST_SB", days: 30 },
    ];

    const initialTasks = targetStoreNames.flatMap((sName) =>
      defaultTaskTypes.map((t) => ({
        id: `${sName}_${t.type}_${t.days}D`,
        store: sName,
        type: t.type,
        days: t.days,
        status: "NOT_STARTED",
        attempt: 0,
        amazonRequestId: null,
        reportName: null,
        localPath: null,
        sizeBytes: 0,
        sha256: null,
        r2Key: null,
        lastError: null,
        nextRetryAt: null,
      })),
    );

    let insertRes;
    try {
      insertRes = await sql`
        INSERT INTO ppc_sync_jobs (
          team_id, store_name, batch_id, status, stage, progress_pct,
          current_step, total_files, processed_files, task_states
        )
        VALUES (
          ${actor.teamId}, ${storeName}, ${batchId}, 'PENDING', 'PENDING', 0,
          'Đã gửi lệnh, đang chờ máy Mac tiếp nhận...', ${totalFiles}, 0,
          ${sql.json(initialTasks)}
        )
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
      message: `Đã tạo lệnh crawl cho [${storeName}]. Máy Mac sẽ tiếp nhận qua Lease Token!`,
      job: insertRes[0],
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo crawler job.", 500);
  }
}

// PATCH: Máy Mac cập nhật Lease / Heartbeat / Tiến độ / Trạng thái 6 task
export async function PATCH(request: Request) {
  try {
    const actor = authorize(request, "write");
    const body = await request.json();
    const {
      jobId,
      leaseToken,
      isHeartbeatOnly,
      status,
      stage,
      progress_pct,
      current_step,
      error_message,
      processed_files,
      task_states,
    } = body;

    if (!jobId) {
      return Response.json({ error: "Thiếu jobId" }, { status: 400 });
    }

    const sql = await getDatabaseClient();

    // 1. Trường hợp Heartbeat độc lập định kỳ (15s): chỉ cập nhật heartbeat_at và gia hạn lease
    if (isHeartbeatOnly) {
      const leaseSeconds = crawlerLeaseSeconds();
      const hbRows = await sql`
        UPDATE ppc_sync_jobs
        SET heartbeat_at = NOW(),
            lease_expires_at = NOW() + ${leaseSeconds} * INTERVAL '1 second',
            updated_at = NOW()
        WHERE id = ${jobId} AND team_id = ${actor.teamId}
          AND status = 'RUNNING'
          AND (lease_token IS NULL OR lease_token = ${leaseToken ?? null})
        RETURNING id, status, stage
      `;

      if (hbRows.length === 0) {
        return Response.json(
          { success: false, revoked: true, error: "Lease token không khớp hoặc đã hết hạn." },
          { status: 409 },
        );
      }

      return Response.json({ success: true, renewedUntil: new Date(Date.now() + leaseSeconds * 1000).toISOString() });
    }

    // 2. Cập nhật tiến độ tổng thể và checkpoint 6 tasks
    if (status != null && !["RUNNING", "COMPLETED", "FAILED", "RETRY_WAIT", "CANCELLED"].includes(status)) {
      throw new ApiError("Trạng thái crawler job không hợp lệ.", 400);
    }
    if (progress_pct != null && (!Number.isInteger(progress_pct) || progress_pct < 0 || progress_pct > 100)) {
      throw new ApiError("Tiến độ crawler phải từ 0 đến 100.", 400);
    }
    if (status === "COMPLETED") {
      if (!Array.isArray(task_states) || task_states.length === 0 || task_states.some((task: { status?: string }) => task?.status !== "UPLOADED")) {
        throw new ApiError("Không thể hoàn tất job khi chưa đủ task UPLOADED.", 409);
      }
      if (!Number.isInteger(processed_files) || processed_files !== task_states.length) {
        throw new ApiError("Số file hoàn tất không khớp checkpoint task.", 409);
      }
    }

    const isFinished = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
    const leaseSeconds = crawlerLeaseSeconds();

    const rows = await sql`
      UPDATE ppc_sync_jobs
      SET status = COALESCE(${status ?? null}, status),
          stage = COALESCE(${stage ?? null}, stage),
          progress_pct = COALESCE(${progress_pct ?? null}, progress_pct),
          current_step = COALESCE(${current_step ?? null}, current_step),
          error_message = COALESCE(${error_message ?? null}, error_message),
          processed_files = COALESCE(${processed_files ?? null}, processed_files),
          task_states = CASE
            WHEN ${task_states != null} THEN ${sql.json(task_states)}
            ELSE task_states
          END,
          heartbeat_at = NOW(),
          lease_expires_at = CASE WHEN ${isFinished} THEN NULL ELSE NOW() + ${leaseSeconds} * INTERVAL '1 second' END,
          completed_at = CASE WHEN ${isFinished} THEN NOW() ELSE completed_at END,
          updated_at = NOW()
      WHERE id = ${jobId} AND team_id = ${actor.teamId}
        AND status = 'RUNNING'
        AND (lease_token IS NULL OR lease_token = ${leaseToken ?? null})
      RETURNING *
    `;

    if (rows.length === 0) {
      return Response.json(
        { error: "Không thể cập nhật: Lease token không khớp hoặc job đã bị thu hồi." },
        { status: 409 },
      );
    }

    return Response.json({
      success: true,
      job: rows[0],
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật crawler job.", 500);
  }
}
