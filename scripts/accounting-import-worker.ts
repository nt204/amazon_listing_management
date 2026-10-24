import os from "node:os";
import {
  claimAccountingImport,
  executeAccountingImportJob,
} from "../lib/accounting/import-jobs";

const workerId = process.env.ACCOUNTING_IMPORT_WORKER_ID || `${os.hostname()}:${process.pid}`;
const pollMs = Math.max(1_000, Number(process.env.ACCOUNTING_IMPORT_POLL_SECONDS || 3) * 1_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await executeAccountingImportJob(job);
  }
  console.log("[Accounting Import Worker] Stopped");
}

main().catch((error) => {
  console.error("[Accounting Import Worker] Fatal error:", error);
  process.exitCode = 1;
});

