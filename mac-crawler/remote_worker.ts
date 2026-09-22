import os from "node:os";
import { acquireCrawlerLock, loadEnv, getStoreList, crawlStore, type StoreTarget } from "./crawler";
import {
  type JobCheckpoint,
  type ReportTaskState,
  loadJobCheckpoint,
  saveJobCheckpointAtomic,
  createDefaultTasksForStore,
} from "./checkpoint";

loadEnv();

const WEB_APP_URL = (process.env.WEB_APP_URL || "http://localhost:2411").replace(/\/+$/, "");
const AUTH_TOKEN = process.env.WEB_APP_AUTH_TOKEN || "";
const WORKER_ID = (process.env.WORKER_ID || os.hostname()).trim();

function configuredInt(name: string, fallback: number, min = 1, max = 20): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const POLL_INTERVAL_MS = configuredInt("WORKER_POLL_SECONDS", 10, 3, 300) * 1000;
const HEARTBEAT_INTERVAL_MS = configuredInt("WORKER_HEARTBEAT_SECONDS", 15, 5, 60) * 1000;
const REQUEST_TIMEOUT_MS = configuredInt("WORKER_REQUEST_TIMEOUT_SECONDS", 20, 5, 120) * 1000;

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("HTTP request timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function retryOperation<T>(label: string, attempts: number, operation: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if ((error as Error).message.includes("CRAWLER_ABORTED")) break;
      if (attempt >= attempts) break;
      const waitSeconds = Math.min(120, configuredInt("RETRY_BASE_DELAY_SECONDS", 5, 1, 300) * 2 ** (attempt - 1));
      console.warn(`[Worker Retry] ${label} lỗi lần ${attempt}/${attempts}: ${(error as Error).message}. Chờ ${waitSeconds}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} thất bại.`);
}

async function waitUntilRetry(tasks: ReportTaskState[], signal: AbortSignal): Promise<void> {
  const timestamps = tasks
    .map((task) => task.nextRetryAt ? Date.parse(task.nextRetryAt) : Number.NaN)
    .filter(Number.isFinite);
  if (!timestamps.length) return;
  const waitMs = Math.max(0, Math.min(...timestamps) - Date.now());
  if (!waitMs) return;
  console.log(`[Worker Retry] Đóng AdsPower và chờ checkpoint nextRetryAt thêm ${Math.ceil(waitMs / 1000)}s.`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error(`CRAWLER_ABORTED: ${String(signal.reason || "Job bị hủy")}`));
    }, { once: true });
  });
}

console.log("============================================================");
if (!AUTH_TOKEN) throw new Error("Thiếu WEB_APP_AUTH_TOKEN trong config.env.");
console.log("[MAC REMOTE WORKER] KHỞI ĐỘNG TIẾN TRÌNH LẮNG NGHE LỆNH TỪ SERVER");
console.log(`Worker ID: ${WORKER_ID}`);
console.log(`Server URL: ${WEB_APP_URL}`);
console.log(`Chu kỳ thăm dò: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`Chu kỳ Heartbeat: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
console.log("============================================================");

function getHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AUTH_TOKEN}`,
    Origin: WEB_APP_URL,
  };
}

async function sendHeartbeat(jobId: string, leaseToken: string): Promise<"ok" | "temporary" | "revoked"> {
  try {
    const response = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/crawler/job`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ jobId, leaseToken, isHeartbeatOnly: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body.revoked) {
        console.warn(`[Worker Heartbeat] ⚠️ Lease token đã bị server thu hồi cho job ${jobId}`);
        return "revoked";
      }
    }
    return response.ok ? "ok" : "temporary";
  } catch (err) {
    console.warn(`[Worker Heartbeat] Không thể gửi heartbeat (${(err as Error).message})`);
    return "temporary";
  }
}

async function updateJob(
  jobId: string,
  leaseToken: string,
  data: {
    status?: "RUNNING" | "COMPLETED" | "FAILED" | "RETRY_WAIT";
    stage?: string;
    progress_pct?: number;
    current_step?: string;
    error_message?: string;
    processed_files?: number;
    task_states?: ReportTaskState[];
  },
) {
  const response = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/crawler/job`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ jobId, leaseToken, ...data }),
  });
  if (!response.ok) {
    throw new Error(`Server từ chối cập nhật job (${response.status}): ${await response.text()}`);
  }
}

async function triggerServerSync(batchId: string, batchDate: string, storeNames: string[]): Promise<string> {
  return retryOperation("Đồng bộ R2 vào database", configuredInt("DB_SYNC_MAX_ATTEMPTS", 5, 1, 10), async () => {
    const res = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/sync-r2`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ batchId, batchDate, storeNames }),
    }, configuredInt("DB_SYNC_TIMEOUT_MINUTES", 10, 1, 30) * 60_000);
    const body = await res.text();
    if (!res.ok) throw new Error(`Server sync thất bại (${res.status}): ${body}`);
    const data = JSON.parse(body);
    if (data.success === false || data.result?.failed > 0) {
      throw new Error(data.message || `Server báo ${data.result?.failed || 0} file ingest lỗi.`);
    }
    return data.message || "Đã đồng bộ R2 thành công.";
  });
}

async function processJob(job: {
  id: string;
  store_name: string;
  batch_id?: string;
  lease_token?: string;
  task_states?: ReportTaskState[];
}) {
  const jobId = job.id;
  const leaseToken = job.lease_token || "";
  const targetStoreName = job.store_name;
  const batchId = job.batch_id || `${targetStoreName}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`\n============================================================`);
  console.log(`[Worker] NHẬN LỆNH CRAWL TỪ SERVER! Job ID: ${jobId}`);
  console.log(`Mục tiêu Store: [${targetStoreName}]`);
  console.log(`Batch ID: ${batchId}`);
  console.log(`Lease Token: ${leaseToken}`);
  console.log("============================================================");

  const abortController = new AbortController();
  const jobTimeoutMinutes = configuredInt("CRAWLER_JOB_TIMEOUT_MINUTES", 120, 15, 720);
  const jobDeadlineTimer = setTimeout(
    () => abortController.abort(`Job vượt quá timeout tổng ${jobTimeoutMinutes} phút`),
    jobTimeoutMinutes * 60_000,
  );

  // Heartbeat tuần tự, không chồng request. Revoked hoặc mất 3 nhịp thì dừng side effect.
  let isJobActive = true;
  let heartbeatFailures = 0;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  const heartbeatLoop = async () => {
    if (!isJobActive || abortController.signal.aborted) return;
    const result = await sendHeartbeat(jobId, leaseToken);
    if (result === "ok") heartbeatFailures = 0;
    else heartbeatFailures += 1;
    if (result === "revoked" || heartbeatFailures >= 3) {
      abortController.abort(result === "revoked" ? "Lease bị thu hồi hoặc job đã hủy" : "Mất kết nối server quá 3 heartbeat");
      return;
    }
    heartbeatTimer = setTimeout(() => void heartbeatLoop(), HEARTBEAT_INTERVAL_MS);
  };
  heartbeatTimer = setTimeout(() => void heartbeatLoop(), HEARTBEAT_INTERVAL_MS);

  let releaseLock: (() => void) | undefined;
  try {
    const allConfiguredStores = getStoreList();
    let storesToCrawl: StoreTarget[] = [];
    if (targetStoreName === "ALL") {
      storesToCrawl = allConfiguredStores;
    } else {
      const match = allConfiguredStores.find((s) => s.store_name.toLowerCase() === targetStoreName.toLowerCase());
      if (!match) {
        throw new Error(`Store "${targetStoreName}" chưa được map trong stores.json; từ chối fallback để tránh lẫn dữ liệu.`);
      }
      storesToCrawl = [match];
    }

    const now = new Date();
    const initialDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Khôi phục hoặc tạo Checkpoint cho Job này
    const loadedCheckpoint = loadJobCheckpoint(jobId);
    const checkpoint: JobCheckpoint = loadedCheckpoint || {
      jobId,
      batchId,
      storeName: targetStoreName,
      batchDate: initialDate,
      stage: "CRAWLING",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runAttempt: 0,
      lastError: null,
      tasks: job.task_states && job.task_states.length > 0
        ? job.task_states
        : storesToCrawl.flatMap((s) => createDefaultTasksForStore(s.store_name)),
    };
    if (loadedCheckpoint && Array.isArray(job.task_states)) {
      for (const serverTask of job.task_states) {
        const localTask = checkpoint.tasks.find((task) => task.id === serverTask.id);
        if (localTask?.status === "FAILED" && serverTask.status === "NOT_STARTED") {
          Object.assign(localTask, serverTask);
        }
      }
    }
    // reportDate bất biến kể cả resume qua nửa đêm.
    const todayStr = checkpoint.batchDate;

    if (loadedCheckpoint) {
      console.log(`[Worker] 🔄 Đã khôi phục checkpoint local của Job ${jobId} (chứa ${checkpoint.tasks.length} tasks).`);
    } else {
      saveJobCheckpointAtomic(checkpoint);
    }

    releaseLock = acquireCrawlerLock();
    await updateJob(jobId, leaseToken, {
      stage: "CRAWLING",
      progress_pct: 5,
      current_step: "Máy Mac đã khóa pipeline và bắt đầu xử lý theo checkpoint...",
      task_states: checkpoint.tasks,
    });

    let totalFilesCrawled = 0;

    for (let i = 0; i < storesToCrawl.length; i++) {
      const store = storesToCrawl[i];
      const basePct = Math.round((i / storesToCrawl.length) * 80) + 5;
      const stepPctRange = Math.round(80 / storesToCrawl.length);

      console.log(`[Worker] Đang xử lý store ${i + 1}/${storesToCrawl.length}: [${store.store_name}]`);

      const files = await retryOperation(
        `Crawl store ${store.store_name}`,
        configuredInt("CRAWLER_MAX_JOB_ATTEMPTS", 3, 1, 5),
        async (runAttempt) => {
          if (runAttempt > 1) await waitUntilRetry(checkpoint.tasks, abortController.signal);
          checkpoint.runAttempt = runAttempt;
          checkpoint.stage = "CRAWLING";
          checkpoint.lastError = null;
          saveJobCheckpointAtomic(checkpoint);
          if (runAttempt > 1) {
            await updateJob(jobId, leaseToken, {
              status: "RUNNING",
              stage: "CRAWLING",
              current_step: `[${store.store_name}] Đang resume vòng ${runAttempt}, giữ lại các file đã hoàn thành...`,
              task_states: checkpoint.tasks,
            }).catch(() => {});
          }
          return crawlStore(
            store,
            todayStr,
            async (stepDesc, percentWithinStore) => {
          const currentTotalPct = basePct + Math.round((percentWithinStore / 100) * stepPctRange);
          await updateJob(jobId, leaseToken, {
            progress_pct: Math.min(85, currentTotalPct),
            current_step: `[${store.store_name}] ${stepDesc}`,
          }).catch(() => {});
            },
            {
          jobId,
          batchId,
          checkpoint,
          onTaskUpdate: async (task: ReportTaskState) => {
            if (checkpoint) {
              const idx = checkpoint.tasks.findIndex((t) => t.id === task.id);
              if (idx !== -1) {
                checkpoint.tasks[idx] = task;
              } else {
                checkpoint.tasks.push(task);
              }
              saveJobCheckpointAtomic(checkpoint);
              await updateJob(jobId, leaseToken, {
                task_states: checkpoint.tasks,
              }).catch(() => {});
            }
          },
          signal: abortController.signal,
            },
          );
        },
      );

      totalFilesCrawled += files.length;
    }

    // Bước đồng bộ Server từ R2
    checkpoint.stage = "INGESTING";
    saveJobCheckpointAtomic(checkpoint);

    await updateJob(jobId, leaseToken, {
      stage: "INGESTING",
      progress_pct: 90,
      current_step: "Đã tải & đẩy R2 staging thành công! Đang kích hoạt Server nạp vào Database...",
      processed_files: totalFilesCrawled,
      task_states: checkpoint.tasks,
    });

    const syncMsg = await triggerServerSync(batchId, todayStr, storesToCrawl.map((store) => store.store_name));
    console.log(`[Worker] Kết quả đồng bộ Server: ${syncMsg}`);

    // Báo cáo hoàn tất
    checkpoint.stage = "COMPLETED";
    saveJobCheckpointAtomic(checkpoint);

    await updateJob(jobId, leaseToken, {
      status: "COMPLETED",
      stage: "COMPLETED",
      progress_pct: 100,
      current_step: `Hoàn tất xuất sắc! Đã tải ${totalFilesCrawled} file và đồng bộ vào DB.`,
      processed_files: totalFilesCrawled,
      task_states: checkpoint.tasks,
    });

    console.log(`\n[Worker] => JOB ${jobId} ĐÃ HOÀN TẤT THÀNH CÔNG!`);
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[Worker] => JOB ${jobId} THẤT BẠI: ${errorMsg}`);
    await updateJob(jobId, leaseToken, {
      status: "FAILED",
      stage: "FAILED",
      error_message: errorMsg,
      current_step: `Lỗi: ${errorMsg}`,
    }).catch((updateError) => console.error(`[Worker] Không thể báo lỗi về server: ${(updateError as Error).message}`));
  } finally {
    isJobActive = false;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    clearTimeout(jobDeadlineTimer);
    releaseLock?.();
  }
}

async function startLoop() {
  let isProcessing = false;
  let lastPollError = "";
  let lastPollErrorAt = 0;

  const reportPollError = (message: string) => {
    const now = Date.now();
    if (message !== lastPollError || now - lastPollErrorAt >= 60_000) {
      console.error(`[Worker Poll] ${message}`);
      lastPollError = message;
      lastPollErrorAt = now;
    }
  };

  const poll = async () => {
    if (isProcessing) return;

    try {
      const res = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/crawler/job?action=poll&workerId=${encodeURIComponent(WORKER_ID)}`, {
        headers: getHeaders(),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        reportPollError(`Server trả HTTP ${res.status}: ${body.slice(0, 500) || res.statusText}`);
        return;
      }

      const data = await res.json();
      if (lastPollError) {
        console.log("[Worker Poll] Kết nối server đã phục hồi.");
        lastPollError = "";
        lastPollErrorAt = 0;
      }
      if (data.hasJob && data.job) {
        isProcessing = true;
        try {
          await processJob(data.job);
        } finally {
          isProcessing = false;
        }
      }
    } catch (error) {
      reportPollError(`Không kết nối được server: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
  };
  void poll();
}

startLoop();
