import "server-only";

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  appendMockupJobEvent,
  claimNextMockupJob,
  completeMockupJob,
  failOrRetryMockupJob,
  heartbeatMockupJob,
  isMockupJobCancellationRequested,
  markMockupJobCancelled,
  pruneOldMockupJobs,
  type MockupJob,
} from "@/lib/mockup-jobs";

const globalForMockupWorker = globalThis as unknown as {
  mockupJobWorkerStarted?: boolean;
};

function configuredWorkerConcurrency() {
  const parsed = Number(process.env.MOCKUP_JOB_WORKER_CONCURRENCY || 5);
  return Number.isFinite(parsed)
    ? Math.min(10, Math.max(1, Math.round(parsed)))
    : 5;
}

function configuredBaseUrl() {
  return (
    process.env.MOCKUP_WORKER_BASE_URL ||
    `http://127.0.0.1:${process.env.PORT || 2411}`
  ).replace(/\/$/, "");
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function retryableGenerationError(message: string) {
  const normalized = message.toLowerCase();
  return ![
    "không đủ số dư",
    "insufficient balance",
    "billing",
    "credit",
    "api key",
    "authentication",
    "unauthorized",
    "invalid model",
    "không hỗ trợ model",
    "không tìm thấy ảnh thiết kế",
    "không hợp lệ",
  ].some((fragment) => normalized.includes(fragment));
}

function workerHeaders(job: MockupJob) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = (
    process.env.MOCKUP_WORKER_SECRET || process.env.LISTING_DESK_SESSION_SECRET || ""
  ).trim();
  if (secret.length >= 32) {
    headers["x-mockup-worker-secret"] = secret;
    headers["x-mockup-team-id"] = job.teamId;
    headers["x-mockup-actor-id"] = job.actorId;
  }
  return headers;
}

async function executeJobRequest(
  job: MockupJob,
  workerId: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${configuredBaseUrl()}/api/trello/generate-mockups`,
    {
      method: "POST",
      headers: workerHeaders(job),
      body: JSON.stringify({ ...job.request, stream: true }),
      signal,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || `Mockup engine trả HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error("Mockup engine không trả luồng tiến độ.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: Record<string, unknown> | null = null;
  let streamError: string | null = null;

  const handleEvent = async (event: Record<string, unknown>) => {
    if (event.type === "heartbeat") return;
    if (event.type === "complete") {
      if (event.data && typeof event.data === "object") {
        result = event.data as Record<string, unknown>;
      }
      return;
    }
    if (event.type === "error") {
      streamError =
        typeof event.error === "string"
          ? event.error
          : "Mockup engine báo lỗi không xác định.";
      return;
    }
    await appendMockupJobEvent(job.id, event);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      await handleEvent(JSON.parse(line) as Record<string, unknown>);
    }
    if (done) break;
  }
  if (buffered.trim()) {
    await handleEvent(JSON.parse(buffered) as Record<string, unknown>);
  }
  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("Mockup engine kết thúc nhưng không trả kết quả.");
  return result;
}

async function processJob(job: MockupJob, workerId: string) {
  const controller = new AbortController();
  let cancelled = false;
  const heartbeat = setInterval(() => {
    void heartbeatMockupJob(job.id, workerId).catch((error) => {
      console.warn(
        `[Mockup worker] Không thể gia hạn job ${job.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }, 20_000);
  heartbeat.unref?.();
  const cancellationCheck = setInterval(() => {
    void isMockupJobCancellationRequested(job.id, workerId)
      .then((requested) => {
        if (!requested || controller.signal.aborted) return;
        cancelled = true;
        controller.abort(new DOMException("Tác vụ đã được hủy.", "AbortError"));
      })
      .catch(() => undefined);
  }, 1_500);
  cancellationCheck.unref?.();

  try {
    await appendMockupJobEvent(job.id, {
      type: "progress",
      step: job.request.selectedSteps?.[0] || 2,
      name: "Worker tạo mockup",
      status: "processing",
      phase: "generation",
      message:
        job.attemptCount > 1
          ? `Đang tiếp tục tác vụ, lần thử ${job.attemptCount}/${job.maxAttempts}...`
          : "Đã đến lượt, worker đang chuẩn bị tạo ảnh...",
    });
    const result = await executeJobRequest(job, workerId, controller.signal);
    await completeMockupJob(job.id, workerId, result);
    await appendMockupJobEvent(job.id, { type: "complete", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cancelled || (error instanceof Error && error.name === "AbortError")) {
      await markMockupJobCancelled(job.id, workerId);
      await appendMockupJobEvent(job.id, {
        type: "error",
        error: "Tác vụ tạo mockup đã được hủy. Các ảnh đã upload vẫn được giữ lại.",
      });
      return;
    }

    const updated = await failOrRetryMockupJob(
      job,
      workerId,
      message,
      retryableGenerationError(message),
    );
    if (updated?.status === "queued") {
      await appendMockupJobEvent(job.id, {
        type: "progress",
        step: job.request.selectedSteps?.[0] || 2,
        name: "Thử lại tác vụ",
        status: "processing",
        phase: "generation",
        message: `Kết nối tạm thời gặp lỗi. Hệ thống sẽ tự thử lại (${updated.attemptCount}/${updated.maxAttempts}).`,
      });
    } else {
      await appendMockupJobEvent(job.id, {
        type: "error",
        error: message,
      });
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(cancellationCheck);
  }
}

async function workerLoop(workerId: string) {
  while (globalForMockupWorker.mockupJobWorkerStarted) {
    try {
      const job = await claimNextMockupJob(workerId);
      if (!job) {
        await wait(1_000);
        continue;
      }
      await processJob(job, workerId);
    } catch (error) {
      console.error(
        `[Mockup worker] Vòng lặp ${workerId} gặp lỗi:`,
        error instanceof Error ? error.message : String(error),
      );
      await wait(3_000);
    }
  }
}

export function startMockupJobWorker() {
  if (globalForMockupWorker.mockupJobWorkerStarted) return;
  if (process.env.MOCKUP_JOB_WORKER_ENABLED === "false") return;
  const workerSecret = (
    process.env.MOCKUP_WORKER_SECRET || process.env.LISTING_DESK_SESSION_SECRET || ""
  ).trim();
  if (
    process.env.LISTING_DESK_AUTH_MODE === "required" &&
    workerSecret.length < 32
  ) {
    console.error(
      "[Mockup worker] Auth đang bật nhưng worker secret ngắn hơn 32 ký tự.",
    );
    return;
  }

  globalForMockupWorker.mockupJobWorkerStarted = true;
  const instanceId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const concurrency = configuredWorkerConcurrency();
  console.info(`[Mockup worker] Khởi động ${concurrency} worker trên ${instanceId}.`);

  const startup = setTimeout(() => {
    for (let index = 0; index < concurrency; index += 1) {
      void workerLoop(`${instanceId}:${index + 1}`);
    }
    void pruneOldMockupJobs().catch(() => undefined);
  }, 1_500);
  startup.unref?.();
}
