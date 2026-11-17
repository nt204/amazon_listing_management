import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimPpcIngestion, completePpcIngestion, failPpcIngestion, heartbeatPpcIngestion,
} from "../lib/ppc/ingestion-jobs";
import { syncPpcReportsFromR2 } from "../lib/ppc/service";

const workerId = process.env.PPC_INGESTION_WORKER_ID || `${os.hostname()}:${process.pid}`;
const pollMs = Math.max(1_000, Number(process.env.PPC_INGESTION_POLL_SECONDS || 5) * 1_000);
const recycleAfterJob = process.env.PPC_INGESTION_RECYCLE_AFTER_JOB !== "false";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dọn facts nặng (xoá dòng rác 0-metrics + thu gọn snapshot cũ + VACUUM bảng facts 22 GB) chỉ chạy 1 lần/đêm khi
 * worker rảnh, trong khung giờ VN [PPC_MAINTENANCE_START_HOUR, PPC_MAINTENANCE_END_HOUR) — mặc định 3h–5h (sau cron dọn dẹp 2h sáng của server).
 * Trước đây chạy ngay sau MỖI lần ingest (5h30–7h40 sáng VN): mỗi lần DELETE 2–4 phút + VACUUM 3–10 phút đọc lại
 * cả bảng, đẩy cache ra → cả web PPC lag buổi sáng (audit 2026-11-17).
 * Thiếu đĩa trước khi nạp thì assertDiskRoomForBulk (lib/ppc/service.ts) vẫn thu gọn ngay như cũ.
 * Worker recycle sau mỗi job → đánh dấu "đêm nay đã chạy" bằng file trong thư mục tạm.
 */
const maintenanceStartHour = Number(process.env.PPC_MAINTENANCE_START_HOUR || 3);
const maintenanceEndHour = Number(process.env.PPC_MAINTENANCE_END_HOUR || 5);

function vnNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

async function runNightlyFactsMaintenanceIfDue(): Promise<void> {
  const { date, hour } = vnNow();
  if (hour < maintenanceStartHour || hour >= maintenanceEndHour) return;
  const marker = path.join(os.tmpdir(), `ppc-facts-maintenance-${date}`);
  if (fs.existsSync(marker)) return;
  fs.writeFileSync(marker, new Date().toISOString());
  const started = Date.now();
  console.log(`[PPC Ingestion Worker] 🌙 Bảo trì facts ban đêm (${date} ${hour}h VN)...`);
  try {
    const { cleanupOldZeroMetricFacts, compactOldPpcSnapshots } = await import("../lib/ppc/file-manager");
    const factsCleanup = await cleanupOldZeroMetricFacts();
    if (factsCleanup.deletedFactsCount > 0) {
      console.log(`[PPC Ingestion Worker] 🧹 Đã dọn dẹp ${factsCleanup.deletedFactsCount} dòng rác ngày cũ trong ppc_performance_facts.`);
    }
    // Thu gọn snapshot cũ (chỉ giữ TARGET có action) để bảng facts không phình hết đĩa; tự VACUUM nếu có xoá
    const compacted = await compactOldPpcSnapshots();
    if (compacted.deletedFactsCount > 0) {
      console.log(`[PPC Ingestion Worker] 🧹 Đã thu gọn ${compacted.deletedFactsCount.toLocaleString()} dòng của snapshot cũ trong ppc_performance_facts.`);
    }
    console.log(`[PPC Ingestion Worker] 🌙 Bảo trì facts xong sau ${Math.round((Date.now() - started) / 1000)} s.`);
  } catch (error) {
    console.warn("[PPC Ingestion Worker] Bảo trì facts ban đêm lỗi:", error);
  }
}

async function main() {
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  console.log(`[PPC Ingestion Worker] Started as ${workerId}`);

  while (!stopping) {
    let job;
    try {
      job = await claimPpcIngestion(workerId);
    } catch (error) {
      console.error("[PPC Ingestion Worker] Claim failed:", error);
      await sleep(pollMs);
      continue;
    }
    if (!job) {
      await runNightlyFactsMaintenanceIfDue();
      await sleep(pollMs);
      continue;
    }

    const token = job.lease_token!;
    console.log(`[PPC Ingestion Worker] Processing ${job.batch_id}, attempt ${job.attempt_count}/${job.max_attempts}`);
    const heartbeat = setInterval(() => {
      void heartbeatPpcIngestion(job.id, token).catch((error) =>
        console.error(`[PPC Ingestion Worker] Heartbeat failed for ${job.id}:`, error));
    }, 30_000);

    try {
      const result = await syncPpcReportsFromR2(
        { teamId: job.team_id, actorId: job.actor_id },
        { batchId: job.batch_id, batchDate: job.batch_date, storeNames: job.store_names },
      );
      if (result.failed > 0) {
        throw new Error(`${result.failed} file ingest lỗi: ${JSON.stringify(result.failures)}`);
      }
      await completePpcIngestion(job.id, token, result);
      console.log(`[PPC Ingestion Worker] Completed ${job.batch_id}: ${result.filesProcessed} files`);

      // Tự động dọn dẹp các đợt cũ trùng ngày trên R2 nếu đợt mới đã nạp thành công
      try {
        const { cleanupDuplicateR2Batches } = await import("../lib/ppc/file-manager");
        const cleanup = await cleanupDuplicateR2Batches();
        if (cleanup.deletedBatches.length > 0) {
          console.log(`[PPC Ingestion Worker] 🧹 Đã tự động dọn dẹp ${cleanup.deletedBatches.length} batch cũ trùng ngày (${cleanup.deletedFilesCount} file, ${(cleanup.freedBytes / (1024 * 1024)).toFixed(1)} MB)`);
        }

        // Dọn facts nặng (dòng rác 0-metrics, thu gọn snapshot cũ + VACUUM) KHÔNG chạy ở đây nữa —
        // dời sang ban đêm (runNightlyFactsMaintenanceIfDue) để không làm lag web giờ làm việc.

        // Dọn các thư mục tạm /tmp/ppc-bulk-* bị bỏ lại bởi tiến trình crash (chỉ thư mục đã cũ)
        const { cleanupOrphanedPpcBulkTempDirs } = await import("../lib/ppc/parser");
        const removedTempDirs = await cleanupOrphanedPpcBulkTempDirs();
        if (removedTempDirs > 0) {
          console.log(`[PPC Ingestion Worker] 🧹 Đã xóa ${removedTempDirs} thư mục tạm ppc-bulk-* mồ côi.`);
        }
      } catch (cleanupErr) {
        console.warn("[PPC Ingestion Worker] Không thể dọn dẹp batch/facts cũ:", cleanupErr);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[PPC Ingestion Worker] Failed ${job.batch_id}:`, message);
      await failPpcIngestion(job.id, token, message).catch((updateError) =>
        console.error("[PPC Ingestion Worker] Cannot persist failure:", updateError));
    } finally {
      clearInterval(heartbeat);
      if (typeof global.gc === "function") {
        try {
          global.gc();
          const memMb = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
          console.log(`[PPC Ingestion Worker] Đã dọn dẹp RAM (Heap hiện tại: ${memMb} MB)`);
        } catch {
          // ignore
        }
      }
      // A large ingest can leave several GB of committed V8 pages attached to
      // this long-lived process even after GC. Recycle only after the current
      // job attempt has fully settled, never while parsing or inside a DB
      // transaction. PM2 then starts a clean worker for the next queued job.
      if (recycleAfterJob) {
        const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
        console.log(`[PPC Ingestion Worker] Job đã kết thúc; recycle process để trả RAM (RSS: ${rssMb} MB).`);
        await sleep(100);
        process.exit(0);
      }
    }
  }
  console.log("[PPC Ingestion Worker] Stopped");
}

main().catch((error) => {
  console.error("[PPC Ingestion Worker] Fatal error:", error);
  process.exitCode = 1;
});
