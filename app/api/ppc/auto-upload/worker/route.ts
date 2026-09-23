import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

export const runtime = "nodejs";

function leaseSeconds() {
  const parsed = Number.parseInt(process.env.PPC_BULK_UPLOAD_LEASE_SECONDS || "120", 10);
  return Number.isFinite(parsed) ? Math.min(600, Math.max(60, parsed)) : 120;
}

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "write");
    const workerId = new URL(request.url).searchParams.get("workerId")?.trim() || "mac-mini";
    const sql = await getDatabaseClient();
    const seconds = leaseSeconds();
    const token = crypto.randomUUID();

    await sql`
      UPDATE ppc_auto_upload_logs
      SET status = 'RETRY_WAIT', stage = 'RETRY_WAIT', lease_token = NULL,
          worker_id = NULL, updated_at = NOW(),
          error_message = 'Worker mất lease; chờ Mac mini tiếp tục'
      WHERE team_id = ${actor.teamId} AND status = 'RUNNING'
        AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()
    `;

    const rows = await sql`
      UPDATE ppc_auto_upload_logs AS job
      SET status = 'RUNNING', stage = 'CLAIMED', worker_id = ${workerId},
          lease_token = ${token}, heartbeat_at = NOW(),
          lease_expires_at = NOW() + ${seconds} * INTERVAL '1 second',
          attempt = attempt + 1, updated_at = NOW(), error_message = NULL
      FROM ppc_stores AS store
      WHERE job.id = (
        SELECT id FROM ppc_auto_upload_logs
        WHERE team_id = ${actor.teamId} AND status IN ('PENDING', 'RETRY_WAIT')
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      ) AND store.id = job.store_id
      RETURNING job.id, job.file_name, job.r2_key, job.sha256, job.status,
                job.stage, job.lease_token, job.attempt, store.name AS store_name
    `;

    return Response.json({ hasJob: rows.length > 0, job: rows[0] || null });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cấp job upload Bulk cho Mac mini.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request, 30_000);
    const body = await request.json().catch(() => ({}));
    const jobId = String(body?.jobId || "");
    const leaseToken = String(body?.leaseToken || "");
    if (!jobId || !leaseToken) throw new ApiError("Thiếu jobId hoặc leaseToken.", 400);

    const allowed = new Set(["RUNNING", "RETRY_WAIT", "SUCCESS", "FAILED"]);
    const status = body?.status == null ? null : String(body.status);
    if (status && !allowed.has(status)) throw new ApiError("Trạng thái upload Bulk không hợp lệ.", 400);
    const progress = body?.progress_pct == null ? null : Number(body.progress_pct);
    if (progress != null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
      throw new ApiError("Tiến độ phải từ 0 đến 100.", 400);
    }

    const terminal = status === "SUCCESS" || status === "FAILED";
    const sql = await getDatabaseClient();
    const seconds = leaseSeconds();
    const rows = await sql`
      UPDATE ppc_auto_upload_logs
      SET status = COALESCE(${status}, status),
          stage = COALESCE(${body?.stage == null ? null : String(body.stage)}, stage),
          progress_pct = COALESCE(${progress}, progress_pct),
          error_message = ${body?.error_message == null ? null : String(body.error_message)},
          amazon_upload_id = COALESCE(${body?.amazon_upload_id == null ? null : String(body.amazon_upload_id)}, amazon_upload_id),
          heartbeat_at = NOW(), updated_at = NOW(),
          lease_expires_at = CASE WHEN ${terminal} THEN NULL ELSE NOW() + ${seconds} * INTERVAL '1 second' END,
          completed_at = CASE WHEN ${terminal} THEN NOW() ELSE completed_at END,
          duration_ms = CASE WHEN ${terminal} THEN GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000)::integer) ELSE duration_ms END
      WHERE id = ${jobId} AND team_id = ${actor.teamId}
        AND status = 'RUNNING' AND lease_token = ${leaseToken}
      RETURNING id, status, stage
    `;
    if (!rows.length) throw new ApiError("Lease upload Bulk không còn hợp lệ.", 409);

    if (status === "SUCCESS") {
      await sql`
        UPDATE ppc_actions SET status = 'APPLIED', updated_at = NOW()
        WHERE id IN (
          SELECT jsonb_array_elements_text(action_ids)::uuid
          FROM ppc_auto_upload_logs WHERE id = ${jobId}
        )
      `;
    }
    return Response.json({ success: true, job: rows[0] });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật job upload Bulk.", 500);
  }
}
