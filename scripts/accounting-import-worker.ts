import os from "node:os";
import {
  claimAccountingImport,
  completeAccountingImport,
  failAccountingImport,
  updateAccountingImportProgress,
} from "../lib/accounting/import-jobs";
import { importUnifiedAccountingExcel } from "../lib/accounting/excel-unified-importer";
import { notifyLarkEventBestEffort } from "../lib/lark-notifications";

const workerId = process.env.ACCOUNTING_IMPORT_WORKER_ID || `${os.hostname()}:${process.pid}`;
const pollMs = Math.max(1_000, Number(process.env.ACCOUNTING_IMPORT_POLL_SECONDS || 3) * 1_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stageLabels: Record<string, string> = {
  orders: "Đang nạp sheet Đầu vào Order",
  ads: "Đang nạp sheet ADS",
  returns: "Đang nạp sheet RETURN",
  serviceFees: "Đang nạp sheet Service Fees",
  skuMaster: "Đang nạp sheet Bảng mã",
  monthlyBasecost: "Đang nạp sheet Basecost tháng",
};

async function main() {
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  console.log(`[Accounting Import Worker] Started as ${workerId}`);

  while (!stopping) {
    let job;
    try {
      job = await claimAccountingImport(workerId);
    } catch (error) {
      console.error("[Accounting Import Worker] Claim failed:", error);
      await sleep(pollMs);
      continue;
    }
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    console.log(`[Accounting Import Worker] Processing ${job.id}: ${job.file_name}`);
    let progressStep = 0;
    let lastProgressWrite = 0;
    try {
      const result = await importUnifiedAccountingExcel(job.file_path, job.store_id, {
        removeAfterDone: true,
        chunkSize: 1000,
        onProgress: (sheetName) => {
          const now = Date.now();
          if (now - lastProgressWrite < 1500) return;
          lastProgressWrite = now;
          progressStep = Math.min(progressStep + 1, 8);
          void updateAccountingImportProgress(
            job.id,
            stageLabels[sheetName] || `Đang nạp ${sheetName}`,
            10 + progressStep * 10,
          ).catch((error) => console.error("[Accounting Import Worker] Progress update failed:", error));
        },
      });
      await completeAccountingImport(job.id, result);
      await notifyLarkEventBestEffort(
        { teamId: job.team_id, actorId: job.actor_id },
        "accounting",
        ["Import kế toán đã hoàn tất", `File: ${job.file_name}`, result.message],
      );
      console.log(`[Accounting Import Worker] Completed ${job.id}: ${result.totalProcessed} rows`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Accounting Import Worker] Failed ${job.id}:`, message);
      await failAccountingImport(job.id, message, job.file_path).catch((updateError) =>
        console.error("[Accounting Import Worker] Cannot persist failure:", updateError));
    }
  }
  console.log("[Accounting Import Worker] Stopped");
}

main().catch((error) => {
  console.error("[Accounting Import Worker] Fatal error:", error);
  process.exitCode = 1;
});

