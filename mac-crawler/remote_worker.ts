import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { acquireCrawlerLock, loadEnv, getStoreList, crawlStore, type StoreTarget } from "./crawler";
import {
  type JobCheckpoint,
  type ReportTaskState,
  loadJobCheckpoint,
  saveJobCheckpointAtomic,
  createDefaultTasksForStore,
} from "./checkpoint";
import { executeRemoteBulkUpload, type RemoteBulkUploadJob } from "./bulk_uploader";
import {
  isTelegramConfigured,
  notifyCrawlerStart,
  notifyStoreFailure,
  notifyCrawlerSummary,
  notifyBulkUploadResult,
} from "./telegram";
import { startTelegramListener, handleWatchdogError } from "./watchdog_agent";

loadEnv();
startTelegramListener();

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
console.log(`Telegram Bot: ${isTelegramConfigured() ? "Đã bật (Báo cáo tiến độ & sự cố qua Telegram)" : "Tắt (Chưa cấu hình TELEGRAM_BOT_TOKEN/CHAT_ID)"}`);
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

async function updateBulkUploadJob(
  job: RemoteBulkUploadJob,
  data: {
    status?: "RUNNING" | "RETRY_WAIT" | "SUCCESS" | "PARTIAL_SUCCESS" | "RESULT_TIMEOUT" | "FAILED";
    stage?: string;
    progress_pct?: number;
    error_message?: string;
    amazon_upload_id?: string;
    result_summary?: string;
  },
) {
  const response = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/auto-upload/worker`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify({ jobId: job.id, leaseToken: job.lease_token, ...data }),
  });
  if (!response.ok) throw new Error(`Server từ chối cập nhật Bulk job (${response.status}): ${await response.text()}`);
}

async function processBulkUploadJob(job: RemoteBulkUploadJob) {
  console.log(`\n[Bulk Upload] Nhận job ${job.id}: ${job.store_name}/${job.file_name}`);
  const store = getStoreList().find((item) => item.store_name.toLowerCase() === job.store_name.toLowerCase());
  if (!store) {
    const errorMsg = `Store ${job.store_name} chưa được map trong stores.json trên Mac mini.`;
    await updateBulkUploadJob(job, {
      status: "FAILED", stage: "FAILED", progress_pct: 100,
      error_message: errorMsg,
    });
    await notifyBulkUploadResult({
      storeName: job.store_name,
      fileName: job.file_name,
      status: "FAILED",
      error: errorMsg,
      jobId: job.id,
    });
    return;
  }

  const releaseLock = acquireCrawlerLock();
  let active = true;
  const heartbeat = setInterval(() => {
    if (active) void updateBulkUploadJob(job, { status: "RUNNING" }).catch((error) =>
      console.warn(`[Bulk Upload] Heartbeat lỗi: ${(error as Error).message}`));
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await updateBulkUploadJob(job, { stage: "DOWNLOADING", progress_pct: 15 });
    const result = await executeRemoteBulkUpload(job, store);
    await updateBulkUploadJob(job, {
      status: result.status,
      stage: result.status === "SUCCESS" ? "AMAZON_COMPLETED" : `AMAZON_${result.status}`,
      progress_pct: 100,
      amazon_upload_id: result.amazonUploadId || undefined,
      result_summary: result.summary,
    });
    if (result.status !== "SUCCESS") {
      const resultMessage = `Amazon trả kết quả ${result.status}: ${result.summary}`;
      console.error(`[Bulk Upload] ❌ ${resultMessage}`);
      await notifyBulkUploadResult({
        storeName: job.store_name,
        fileName: job.file_name,
        status: "FAILED",
        error: resultMessage,
        jobId: job.id,
      });
      return;
    }
    console.log(`[Bulk Upload] ✅ Amazon đã xử lý hoàn tất ${job.file_name} cho ${job.store_name}.`);
    await notifyBulkUploadResult({
      storeName: job.store_name,
      fileName: job.file_name,
      status: "SUCCESS",
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateBulkUploadJob(job, {
      status: "FAILED", stage: "FAILED", progress_pct: 100, error_message: message,
    }).catch((patchError) => console.error(`[Bulk Upload] Không báo lỗi được về server: ${(patchError as Error).message}`));
    console.error(`[Bulk Upload] ❌ ${message}`);
    await notifyBulkUploadResult({
      storeName: job.store_name,
      fileName: job.file_name,
      status: "FAILED",
      error: message,
      jobId: job.id,
    });
  } finally {
    active = false;
    clearInterval(heartbeat);
    releaseLock();
  }
}

async function triggerServerSync(
  crawlerJobId: string,
  crawlerLeaseToken: string,
  batchId: string,
  batchDate: string,
  storeNames: string[],
  taskStates: ReportTaskState[],
  processedFiles: number,
): Promise<{ id: string; status: string }> {
  const accepted = await retryOperation("Tạo hàng đợi đồng bộ R2", configuredInt("DB_SYNC_MAX_ATTEMPTS", 5, 1, 10), async () => {
    const res = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/sync-r2`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        crawlerJobId,
        crawlerLeaseToken,
        batchId,
        batchDate,
        storeNames,
        taskStates,
        processedFiles,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Server sync (${res.status}): ${body.slice(0, 200).replace(/\s+/g, " ")}`);
    }
    const data = JSON.parse(body);
    if (!data.job?.id) throw new Error("Server không trả ingestion jobId.");
    return data as {job:{id:string;status:string};message?:string};
  });
  return accepted.job;
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
  const jobStartTime = Date.now();
  let storesToCrawlNames: string[] = [];
  let summarySent = false;
  const successfulStoreNames: string[] = [];
  const storeFailures: string[] = [];
  let totalFilesCrawled = 0;

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
    if (result === "ok") {
      heartbeatFailures = 0;
    } else if (result === "revoked") {
      abortController.abort("Lease bị thu hồi hoặc job đã hủy trên server");
      return;
    } else {
      heartbeatFailures += 1;
      const maxFailures = configuredInt("WORKER_MAX_HEARTBEAT_FAILURES", 10, 3, 30);
      console.warn(`[Worker Heartbeat] Tạm mất kết nối server (${heartbeatFailures}/${maxFailures}). Vẫn tiếp tục xử lý...`);
      if (heartbeatFailures >= maxFailures) {
        abortController.abort(`Mất kết nối server quá ${maxFailures} nhịp heartbeat (~${Math.round((maxFailures * HEARTBEAT_INTERVAL_MS) / 60000)} phút)`);
        return;
      }
    }
    heartbeatTimer = setTimeout(() => void heartbeatLoop(), HEARTBEAT_INTERVAL_MS);
  };
  heartbeatTimer = setTimeout(() => void heartbeatLoop(), HEARTBEAT_INTERVAL_MS);

  let releaseLock: (() => void) | undefined;
  let activeCheckpoint: JobCheckpoint | undefined;
  try {
    const allConfiguredStores = getStoreList();
    let storesToCrawl: StoreTarget[] = [];
    if (targetStoreName === "ALL") {
      const requestedStores = new Set((job.task_states || []).map((task) => task.store.toLowerCase()));
      if (requestedStores.size) {
        const configuredByName = new Map(allConfiguredStores.map((store) => [store.store_name.toLowerCase(), store]));
        const missing = [...requestedStores].filter((name) => !configuredByName.has(name));
        if (missing.length) {
          throw new Error(`Job yêu cầu store chưa được map trong stores.json: ${missing.join(", ")}.`);
        }
        storesToCrawl = [...requestedStores].map((name) => configuredByName.get(name)!);
      } else {
        storesToCrawl = allConfiguredStores;
      }
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
    activeCheckpoint = checkpoint;
    if (loadedCheckpoint && Array.isArray(job.task_states)) {
      for (const serverTask of job.task_states) {
        const localTask = checkpoint.tasks.find((task) => task.id === serverTask.id);
        if (localTask?.status === "FAILED" && serverTask.status === "NOT_STARTED") {
          Object.assign(localTask, serverTask);
        }
      }
    }
    // Deduplicate tasks by task.id
    const uniqueTaskMap = new Map<string, ReportTaskState>();
    for (const t of checkpoint.tasks) {
      const existing = uniqueTaskMap.get(t.id);
      if (!existing || t.status === "UPLOADED" || existing.status !== "UPLOADED") {
        uniqueTaskMap.set(t.id, t);
      }
    }
    checkpoint.tasks = [...uniqueTaskMap.values()];

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

    storesToCrawlNames = storesToCrawl.map((s) => s.store_name);
    await notifyCrawlerStart({
      batchDate: todayStr,
      storeNames: storesToCrawlNames,
      workerId: WORKER_ID,
    });

    for (let i = 0; i < storesToCrawl.length; i++) {
      const store = storesToCrawl[i];
      const basePct = Math.round((i / storesToCrawl.length) * 80) + 5;
      const stepPctRange = Math.round(80 / storesToCrawl.length);

      console.log(`[Worker] Đang xử lý store ${i + 1}/${storesToCrawl.length}: [${store.store_name}]`);

      try {
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
        successfulStoreNames.push(store.store_name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        storeFailures.push(`[${store.store_name}] ${message}`);
        console.error(`[Worker] Store [${store.store_name}] hết retry, tiếp tục store kế tiếp: ${message}`);
        await notifyStoreFailure({
          storeName: store.store_name,
          error: message,
        });
        await handleWatchdogError({
          storeName: store.store_name,
          taskName: "crawlStore",
          error,
          logSnippet: message,
        }).catch((wErr) => console.warn(`[Watchdog] Lỗi xử lý sự cố: ${wErr.message}`));
        await updateJob(jobId, leaseToken, {
          status: "RUNNING",
          stage: "CRAWLING",
          current_step: `[${store.store_name}] thất bại sau giới hạn retry; đang tiếp tục store kế tiếp...`,
          task_states: checkpoint.tasks,
        }).catch(() => {});
      }
    }

    if (!successfulStoreNames.length) {
      throw new Error(`Không có store nào hoàn tất: ${storeFailures.join(" | ")}`);
    }
    if (storeFailures.length) {
      throw new Error(`Đã crawl xong ${successfulStoreNames.length}/${storesToCrawl.length} store và giữ checkpoint; cần resume các store lỗi trước khi commit DB: ${storeFailures.join(" | ")}`);
    }

    // Bàn giao nguyên tử cho server. API xác minh job + lease + batch + store,
    // enqueue ingestion và chuyển crawler job sang INGESTING trong cùng transaction.
    checkpoint.stage = "INGESTING";
    saveJobCheckpointAtomic(checkpoint);

    const ingestionJob = await triggerServerSync(
      jobId,
      leaseToken,
      batchId,
      todayStr,
      successfulStoreNames,
      checkpoint.tasks,
      totalFilesCrawled,
    );
    console.log(`[Worker] Đã bàn giao batch cho ingestion job ${ingestionJob.id} (${ingestionJob.status}); tiếp tục hàng đợi Mac.`);

    summarySent = true;
    await notifyCrawlerSummary({
      batchDate: todayStr,
      successStores: successfulStoreNames,
      failedStores: storeFailures.map((f) => f.split("] ")[0].replace("[", "")),
      totalFiles: totalFilesCrawled,
      elapsedMs: Date.now() - jobStartTime,
      workerId: WORKER_ID,
      ingestionPending: ingestionJob.status !== "COMPLETED",
    });

    console.log(`\n[Worker] => JOB ${jobId} ĐÃ UPLOAD R2 VÀ BÀN GIAO SERVER THÀNH CÔNG!`);
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[Worker] => JOB ${jobId} THẤT BẠI: ${errorMsg}`);
    await updateJob(jobId, leaseToken, {
      status: "FAILED",
      stage: "FAILED",
      error_message: errorMsg,
      current_step: `Lỗi: ${errorMsg}`,
    }).catch((updateError) => {
      const msg = updateError instanceof Error ? updateError.message : String(updateError);
      console.error(`[Worker] Không thể báo lỗi về server: ${msg}`);
    });

    if (!summarySent && storesToCrawlNames.length > 0) {
      summarySent = true;
      const failedNames = storesToCrawlNames.filter((name) => !successfulStoreNames.includes(name));
      await notifyCrawlerSummary({
        batchDate: activeCheckpoint?.batchDate || new Date().toISOString().slice(0, 10),
        successStores: successfulStoreNames,
        failedStores: failedNames.length > 0 ? failedNames : [targetStoreName],
        totalFiles: totalFilesCrawled,
        elapsedMs: Date.now() - jobStartTime,
        workerId: WORKER_ID,
      });
    }
  } finally {
    isJobActive = false;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    clearTimeout(jobDeadlineTimer);
    releaseLock?.();
  }
}

function getScheduleConfig() {
  let scheduleTime = "12:00";
  let isForce = false;
  try {
    const envPath = path.join(__dirname, "config.env");
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (key === "CRAWLER_SCHEDULE_TIME" && val) scheduleTime = val;
          if ((key === "CRAWLER_SCHEDULE_FORCE" || key === "FORCE_CRAWL") && (val === "true" || val === "1")) isForce = true;
        }
      }
    }
  } catch {}
  return { scheduleTime, isForce };
}

async function startLoop() {
  let isProcessing = false;
  let lastPollError = "";
  let lastPollErrorAt = 0;
  let lastScheduledKey = "";

  const checkDailySchedule = async () => {
    const { scheduleTime, isForce } = getScheduleConfig();
    const match = scheduleTime.match(/^([0-9]{1,2}):([0-9]{1,2})$/);
    if (!match) return;
    const targetHour = parseInt(match[1], 10);
    const targetMin = parseInt(match[2], 10);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentKey = `${todayStr}:${scheduleTime}`;

    if (now.getHours() === targetHour && now.getMinutes() >= targetMin && lastScheduledKey !== currentKey) {
      lastScheduledKey = currentKey;
      console.log(`\n============================================================`);
      console.log(`[Worker Scheduler] ⏰ ĐẾN GIỜ HẸN HÀNG NGÀY (${scheduleTime})! Tự động xếp job...`);
      if (isForce) console.log(`[Worker Scheduler] ⚡ Chế độ test FORCE=true kích hoạt.`);
      console.log(`============================================================`);
      try {
        const stores = getStoreList();
        for (const store of stores) {
          const enqueueKey = isForce
            ? `daily:${todayStr}:${scheduleTime.replace(":", "")}:${store.store_name.toLowerCase()}`
            : `daily:${todayStr}:${store.store_name.toLowerCase()}`;
          const body: Record<string, unknown> = {
            storeName: store.store_name,
            enqueueKey,
          };
          if (isForce) body.forceNew = true;

          const res = await fetchWithTimeout(`${WEB_APP_URL}/api/ppc/crawler/job`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify(body),
          });
          const resJson = await res.json().catch(() => ({}));
          if (resJson.duplicate) {
            console.log(`[Worker Scheduler] ↪ [${store.store_name}] job hôm nay đã tồn tại.`);
          } else {
            console.log(`[Worker Scheduler] ✅ [${store.store_name}] đã vào hàng đợi (jobId: ${resJson.job?.id || "mới"}).`);
          }
        }
      } catch (err) {
        console.error(`[Worker Scheduler] Lỗi xếp job: ${(err as Error).message}`);
      }
    }
  };

  const reportPollError = (message: string) => {
    const now = Date.now();
    if (message !== lastPollError || now - lastPollErrorAt >= 60_000) {
      console.error(`[Worker Poll] ${message}`);
      lastPollError = message;
      lastPollErrorAt = now;
    }
  };

  const poll = async () => {
    await checkDailySchedule().catch(() => {});
    if (isProcessing) return;

    try {
      // Bulk update is short and user-triggered, so it has priority over the daily report crawl.
      const bulkRes = await fetchWithTimeout(
        `${WEB_APP_URL}/api/ppc/auto-upload/worker?workerId=${encodeURIComponent(WORKER_ID)}`,
        { headers: getHeaders() },
      );
      if (!bulkRes.ok) {
        const body = await bulkRes.text().catch(() => "");
        reportPollError(`Bulk queue trả HTTP ${bulkRes.status}: ${body.slice(0, 500) || bulkRes.statusText}`);
        return;
      }
      const bulkData = await bulkRes.json();
      if (bulkData.hasJob && bulkData.job) {
        isProcessing = true;
        try {
          await processBulkUploadJob(bulkData.job as RemoteBulkUploadJob);
        } finally {
          isProcessing = false;
        }
        return;
      }

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
