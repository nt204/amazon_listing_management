import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getDatabaseClient, type DataScope } from "@/lib/db";
import {
  mockupRequestsOverlap,
  type GenerateMockupsInput,
} from "@/lib/mockup-request";

export type MockupJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export interface MockupJobProgress {
  message?: string;
  step?: number;
  phase?: string;
  updatedAt?: string;
  lastEventId?: number;
}

export interface MockupJob {
  id: string;
  teamId: string;
  actorId: string;
  cardId: string;
  request: GenerateMockupsInput;
  status: MockupJobStatus;
  progress: MockupJobProgress;
  result: Record<string, unknown> | null;
  error: string | null;
  attemptCount: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

interface MockupJobRow {
  id: string;
  team_id: string;
  actor_id: string;
  card_id: string;
  request_json: GenerateMockupsInput | string;
  status: MockupJobStatus;
  progress_json: MockupJobProgress | string | null;
  result_json: Record<string, unknown> | string | null;
  error_message: string | null;
  attempt_count: number;
  max_attempts: number;
  locked_by: string | null;
  lock_expires_at: Date | string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
}

export interface MockupJobEvent {
  id: number;
  event: Record<string, unknown>;
  createdAt: string;
}

function parseJson<T>(value: T | string | null, fallback: T): T {
  if (value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function iso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapJob(row: MockupJobRow): MockupJob {
  return {
    id: row.id,
    teamId: row.team_id,
    actorId: row.actor_id,
    cardId: row.card_id,
    request: parseJson(row.request_json, {} as GenerateMockupsInput),
    status: row.status,
    progress: parseJson(row.progress_json, {}),
    result: parseJson(row.result_json, null),
    error: row.error_message,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
    lockExpiresAt: iso(row.lock_expires_at),
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at)!,
  };
}

function maxQueuedJobsPerTeam() {
  const parsed = Number(process.env.MOCKUP_MAX_QUEUED_JOBS_PER_TEAM || 30);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(10, Math.round(parsed)))
    : 30;
}

function maxJobAttempts() {
  const parsed = Number(process.env.MOCKUP_JOB_MAX_ATTEMPTS || 3);
  return Number.isFinite(parsed)
    ? Math.min(5, Math.max(1, Math.round(parsed)))
    : 3;
}

export async function createMockupJob(
  scope: DataScope,
  request: GenerateMockupsInput,
): Promise<MockupJob> {
  const sql = await getDatabaseClient();
  const id = randomUUID();

  try {
    const rows = await sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${scope.teamId}))
      `;
      const counts = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM mockup_jobs
        WHERE team_id = ${scope.teamId}
          AND status IN ('queued', 'running', 'cancel_requested')
      `;
      if ((counts[0]?.count || 0) >= maxQueuedJobsPerTeam()) {
        throw Object.assign(
          new Error(
            "Team đang có quá nhiều tác vụ mockup chờ xử lý. Hãy đợi một số tác vụ hoàn tất rồi thử lại.",
          ),
          { status: 429 },
        );
      }

      const activeCardJobs = await transaction<MockupJobRow[]>`
        SELECT *
        FROM mockup_jobs
        WHERE team_id = ${scope.teamId}
          AND card_id = ${request.cardId}
          AND status IN ('queued', 'running', 'cancel_requested')
        ORDER BY created_at ASC
      `;
      const conflictingJob = activeCardJobs
        .map(mapJob)
        .find((job) => mockupRequestsOverlap(job.request, request));
      if (conflictingJob) {
        throw Object.assign(
          new Error(
            request.selectedSteps?.length === 1
              ? `Mockup ${request.selectedSteps[0]} của thẻ này đã có một tác vụ trong hàng đợi.`
              : "Một hoặc nhiều mockup đã chọn của thẻ này đang nằm trong hàng đợi.",
          ),
          { status: 409, jobId: conflictingJob.id },
        );
      }

      return transaction<MockupJobRow[]>`
        INSERT INTO mockup_jobs (
          id, team_id, actor_id, card_id, request_json, max_attempts
        ) VALUES (
          ${id}, ${scope.teamId}, ${scope.actorId}, ${request.cardId},
          ${transaction.json(request)}, ${maxJobAttempts()}
        )
        RETURNING *
      `;
    });
    const job = mapJob(rows[0]);
    await appendMockupJobEvent(job.id, {
      type: "progress",
      step: request.selectedSteps?.[0] || 2,
      name: "Hàng đợi tạo mockup",
      status: "processing",
      phase: "generation",
      message: "Đã xếp hàng. Tác vụ sẽ tiếp tục chạy kể cả khi đóng hoặc tải lại trang.",
    });
    return (await getMockupJob(scope, id)) || job;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      const existing = await findActiveMockupJob(scope, request.cardId);
      if (existing) {
        throw Object.assign(
          new Error("Thẻ này đã có một tác vụ mockup trong hàng đợi."),
          { status: 409, jobId: existing.id },
        );
      }
    }
    throw error;
  }
}

export async function findActiveMockupJob(
  scope: DataScope,
  cardId: string,
) {
  const sql = await getDatabaseClient();
  const rows = await sql<MockupJobRow[]>`
    SELECT * FROM mockup_jobs
    WHERE team_id = ${scope.teamId}
      AND card_id = ${cardId}
      AND status IN ('queued', 'running', 'cancel_requested')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function getMockupJob(scope: DataScope, id: string) {
  const sql = await getDatabaseClient();
  const rows = await sql<MockupJobRow[]>`
    SELECT * FROM mockup_jobs
    WHERE team_id = ${scope.teamId} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listMockupJobs(
  scope: DataScope,
  options: { activeOnly?: boolean; limit?: number } = {},
) {
  const sql = await getDatabaseClient();
  const limit = Math.min(100, Math.max(1, options.limit || 30));
  const rows = options.activeOnly
    ? await sql<MockupJobRow[]>`
        SELECT * FROM mockup_jobs
        WHERE team_id = ${scope.teamId}
          AND status IN ('queued', 'running', 'cancel_requested')
        ORDER BY priority DESC, created_at ASC
        LIMIT ${limit}
      `
    : await sql<MockupJobRow[]>`
        SELECT * FROM mockup_jobs
        WHERE team_id = ${scope.teamId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map(mapJob);
}

export async function appendMockupJobEvent(
  jobId: string,
  event: Record<string, unknown>,
) {
  const sql = await getDatabaseClient();
  return sql.begin(async (transaction) => {
    const inserted = await transaction<{ id: number; created_at: Date | string }[]>`
      INSERT INTO mockup_job_events (job_id, event_json)
      VALUES (${jobId}, ${transaction.json(event as unknown as postgres.JSONValue)})
      RETURNING id, created_at
    `;
    const eventId = inserted[0].id;
    const message = typeof event.message === "string" ? event.message : undefined;
    const step = typeof event.step === "number" ? event.step : undefined;
    const phase = typeof event.phase === "string" ? event.phase : undefined;
    const progress: MockupJobProgress = {
      message,
      step,
      phase,
      lastEventId: eventId,
      updatedAt: new Date().toISOString(),
    };
    await transaction`
      UPDATE mockup_jobs
      SET progress_json = ${transaction.json(progress as unknown as postgres.JSONValue)}, updated_at = NOW()
      WHERE id = ${jobId}
    `;
    return eventId;
  });
}

export async function listMockupJobEvents(
  scope: DataScope,
  jobId: string,
  afterId = 0,
  limit = 100,
): Promise<MockupJobEvent[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<{
    id: number;
    event_json: Record<string, unknown> | string;
    created_at: Date | string;
  }[]>`
    SELECT event.id, event.event_json, event.created_at
    FROM mockup_job_events event
    INNER JOIN mockup_jobs job ON job.id = event.job_id
    WHERE event.job_id = ${jobId}
      AND job.team_id = ${scope.teamId}
      AND event.id > ${Math.max(0, afterId)}
    ORDER BY event.id ASC
    LIMIT ${Math.min(500, Math.max(1, limit))}
  `;
  return rows.map((row) => ({
    id: row.id,
    event: parseJson(row.event_json, {}),
    createdAt: iso(row.created_at)!,
  }));
}

export async function claimNextMockupJob(
  workerId: string,
  leaseSeconds = 90,
): Promise<MockupJob | null> {
  const sql = await getDatabaseClient();
  const safeLeaseSeconds = Math.min(300, Math.max(30, leaseSeconds));
  const rows = await sql.begin(async (transaction) => {
    await transaction`
      UPDATE mockup_jobs
      SET status = 'cancelled', completed_at = NOW(), updated_at = NOW(),
          locked_by = NULL, lock_expires_at = NULL
      WHERE status = 'cancel_requested'
        AND (lock_expires_at IS NULL OR lock_expires_at < NOW())
    `;
    await transaction`
      UPDATE mockup_jobs
      SET status = 'failed', completed_at = NOW(), updated_at = NOW(),
          error_message = COALESCE(error_message, 'Tác vụ vượt quá số lần thử cho phép.'),
          locked_by = NULL, lock_expires_at = NULL
      WHERE status = 'running'
        AND lock_expires_at < NOW()
        AND attempt_count >= max_attempts
    `;
    return transaction<MockupJobRow[]>`
      WITH candidate AS (
        SELECT id
        FROM mockup_jobs
        WHERE (
          (status = 'queued' AND available_at <= NOW())
          OR (status = 'running' AND lock_expires_at < NOW())
        )
          AND attempt_count < max_attempts
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE mockup_jobs job
      SET status = 'running',
          attempt_count = job.attempt_count + 1,
          locked_by = ${workerId},
          lock_expires_at = NOW() + (${safeLeaseSeconds} * INTERVAL '1 second'),
          heartbeat_at = NOW(),
          started_at = COALESCE(job.started_at, NOW()),
          updated_at = NOW(),
          error_message = NULL
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING job.*
    `;
  });
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function heartbeatMockupJob(
  jobId: string,
  workerId: string,
  leaseSeconds = 90,
) {
  const sql = await getDatabaseClient();
  const safeLeaseSeconds = Math.min(300, Math.max(30, leaseSeconds));
  const rows = await sql<{ id: string }[]>`
    UPDATE mockup_jobs
    SET heartbeat_at = NOW(),
        lock_expires_at = NOW() + (${safeLeaseSeconds} * INTERVAL '1 second'),
        updated_at = NOW()
    WHERE id = ${jobId} AND locked_by = ${workerId} AND status = 'running'
    RETURNING id
  `;
  return rows.length > 0;
}

export async function isMockupJobCancellationRequested(
  jobId: string,
  workerId: string,
) {
  const sql = await getDatabaseClient();
  const rows = await sql<{ status: MockupJobStatus; locked_by: string | null }[]>`
    SELECT status, locked_by FROM mockup_jobs WHERE id = ${jobId} LIMIT 1
  `;
  return (
    !rows[0] ||
    rows[0].locked_by !== workerId ||
    rows[0].status === "cancel_requested" ||
    rows[0].status === "cancelled"
  );
}

export async function completeMockupJob(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
) {
  const sql = await getDatabaseClient();
  const attachments = Array.isArray(result.attachments) ? result.attachments : [];
  const partial = attachments.some(
    (attachment) =>
      typeof attachment === "object" &&
      attachment !== null &&
      "status" in attachment &&
      attachment.status === "failed",
  );
  const rows = await sql<MockupJobRow[]>`
    UPDATE mockup_jobs
    SET status = ${partial ? "partial" : "completed"},
        result_json = ${sql.json(result as unknown as postgres.JSONValue)},
        completed_at = NOW(), updated_at = NOW(),
        locked_by = NULL, lock_expires_at = NULL, heartbeat_at = NULL
    WHERE id = ${jobId} AND locked_by = ${workerId}
    RETURNING *
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function failOrRetryMockupJob(
  job: MockupJob,
  workerId: string,
  errorMessage: string,
  retryable: boolean,
) {
  const sql = await getDatabaseClient();
  const shouldRetry = retryable && job.attemptCount < job.maxAttempts;
  const retryDelaySeconds = Math.min(120, 15 * 2 ** Math.max(0, job.attemptCount - 1));
  const rows = await sql<MockupJobRow[]>`
    UPDATE mockup_jobs
    SET status = ${shouldRetry ? "queued" : "failed"},
        error_message = ${errorMessage.slice(0, 4_000)},
        available_at = ${
          shouldRetry
            ? sql`NOW() + (${retryDelaySeconds} * INTERVAL '1 second')`
            : sql`available_at`
        },
        completed_at = ${shouldRetry ? null : new Date()},
        updated_at = NOW(), locked_by = NULL, lock_expires_at = NULL,
        heartbeat_at = NULL
    WHERE id = ${job.id} AND locked_by = ${workerId}
    RETURNING *
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function markMockupJobCancelled(jobId: string, workerId: string) {
  const sql = await getDatabaseClient();
  const rows = await sql<MockupJobRow[]>`
    UPDATE mockup_jobs
    SET status = 'cancelled', completed_at = NOW(), updated_at = NOW(),
        locked_by = NULL, lock_expires_at = NULL, heartbeat_at = NULL
    WHERE id = ${jobId} AND locked_by = ${workerId}
    RETURNING *
  `;
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function requestMockupJobCancellation(
  scope: DataScope,
  jobId: string,
) {
  const sql = await getDatabaseClient();
  const rows = await sql<MockupJobRow[]>`
    UPDATE mockup_jobs
    SET status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE 'cancel_requested' END,
        completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE id = ${jobId}
      AND team_id = ${scope.teamId}
      AND status IN ('queued', 'running')
    RETURNING *
  `;
  if (!rows[0]) return getMockupJob(scope, jobId);
  const job = mapJob(rows[0]);
  await appendMockupJobEvent(jobId, {
    type: "progress",
    step: job.request.selectedSteps?.[0] || 2,
    name: "Hủy tác vụ",
    status: "processing",
    phase: "generation",
    message:
      job.status === "cancelled"
        ? "Đã hủy tác vụ trong hàng đợi."
        : "Đã yêu cầu dừng tác vụ. Các ảnh đã upload vẫn được giữ lại.",
  });
  return getMockupJob(scope, jobId);
}

export async function pruneOldMockupJobs() {
  const sql = await getDatabaseClient();
  const parsed = Number(process.env.MOCKUP_JOB_RETENTION_DAYS || 14);
  const retentionDays = Number.isFinite(parsed)
    ? Math.min(90, Math.max(7, Math.round(parsed)))
    : 14;
  const rows = await sql<{ id: string }[]>`
    DELETE FROM mockup_jobs
    WHERE status IN ('completed', 'partial', 'failed', 'cancelled')
      AND completed_at < NOW() - (${retentionDays} * INTERVAL '1 day')
    RETURNING id
  `;
  return rows.length;
}

export async function getMockupQueueMetrics() {
  const sql = await getDatabaseClient();
  const rows = await sql<{ status: MockupJobStatus; count: number }[]>`
    SELECT status, COUNT(*)::int AS count
    FROM mockup_jobs
    WHERE status IN ('queued', 'running', 'cancel_requested')
    GROUP BY status
  `;
  const metrics = { queued: 0, running: 0, cancelRequested: 0 };
  for (const row of rows) {
    if (row.status === "queued") metrics.queued = row.count;
    if (row.status === "running") metrics.running = row.count;
    if (row.status === "cancel_requested") metrics.cancelRequested = row.count;
  }
  return metrics;
}
