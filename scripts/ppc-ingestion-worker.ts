import os from "node:os";
import {
  claimPpcIngestion, completePpcIngestion, failPpcIngestion, heartbeatPpcIngestion,
} from "../lib/ppc/ingestion-jobs";
import { syncPpcReportsFromR2 } from "../lib/ppc/service";

const workerId = process.env.PPC_INGESTION_WORKER_ID || `${os.hostname()}:${process.pid}`;
const pollMs = Math.max(1_000, Number(process.env.PPC_INGESTION_POLL_SECONDS || 5) * 1_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      } catch (cleanupErr) {
        console.warn("[PPC Ingestion Worker] Không thể dọn dẹp batch cũ:", cleanupErr);
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
    }
  }
  console.log("[PPC Ingestion Worker] Stopped");
}

main().catch((error) => {
  console.error("[PPC Ingestion Worker] Fatal error:", error);
  process.exitCode = 1;
});
