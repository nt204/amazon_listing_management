import "server-only";

import fs from "node:fs";
import type postgres from "postgres";
import { getDatabaseClient, type DataScope } from "@/lib/db";
import { invalidateAccountingDashboardCache } from "@/lib/accounting/dashboard-db";

export type AccountingImportStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface AccountingImportJob {
  id: string;
  team_id: string;
  actor_id: string;
  store_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  status: AccountingImportStatus;
  stage: string;
  progress_pct: number;
  worker_id: string | null;
  result: unknown;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const PUBLIC_COLUMNS = `
  id, team_id, actor_id, store_id, file_name, file_size, status, stage,
  progress_pct, worker_id, result, error_message, created_at, started_at, completed_at
`;

export async function enqueueAccountingImport(
  scope: DataScope,
  input: { storeId: string; fileName: string; filePath: string; fileSize: number },
) {
  const sql = await getDatabaseClient();
  const jobs = await sql<AccountingImportJob[]>`
    INSERT INTO accounting_import_jobs(
      team_id, actor_id, store_id, file_name, file_path, file_size
    ) VALUES(
      ${scope.teamId}, ${scope.actorId}, ${input.storeId}, ${input.fileName},
      ${input.filePath}, ${input.fileSize}
    )
    RETURNING ${sql.unsafe(PUBLIC_COLUMNS)}
  `;
  return jobs[0];
}

export async function getAccountingImport(scope: DataScope, id: string) {
  const sql = await getDatabaseClient();
  const jobs = await sql<AccountingImportJob[]>`
    SELECT ${sql.unsafe(PUBLIC_COLUMNS)}
    FROM accounting_import_jobs
    WHERE id = ${id} AND team_id = ${scope.teamId}
    LIMIT 1
  `;
  return jobs[0] || null;
}

export async function claimAccountingImport(workerId: string) {
  const sql = await getDatabaseClient();
  // Nếu worker bị kill/restart giữa chừng, trả job cũ về hàng đợi để worker mới tiếp quản.
  await sql`
    UPDATE accounting_import_jobs
    SET status = 'QUEUED', stage = 'Worker đã khởi động lại, đang chờ xử lý tiếp',
        progress_pct = 0, worker_id = NULL, started_at = NULL, updated_at = NOW()
    WHERE status = 'RUNNING' AND updated_at < NOW() - INTERVAL '30 minutes'
  `;
  const jobs = await sql.begin((tx) => tx<AccountingImportJob[]>`
    UPDATE accounting_import_jobs
    SET status = 'RUNNING', stage = 'Đang chuẩn bị đọc file Excel', progress_pct = 5,
        worker_id = ${workerId}, started_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM accounting_import_jobs
      WHERE status = 'QUEUED'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  return jobs[0] || null;
}

export async function updateAccountingImportProgress(id: string, stage: string, progressPct: number) {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE accounting_import_jobs
    SET stage = ${stage}, progress_pct = ${Math.max(5, Math.min(95, Math.round(progressPct)))}, updated_at = NOW()
    WHERE id = ${id} AND status = 'RUNNING'
  `;
}

export async function completeAccountingImport(id: string, result: unknown) {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE accounting_import_jobs
    SET status = 'COMPLETED', stage = 'Đã nạp dữ liệu thành công', progress_pct = 100,
        result = ${sql.json(result as postgres.JSONValue)}, error_message = NULL,
        completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'RUNNING'
  `;
  await invalidateAccountingDashboardCache().catch(() => {});
}

export async function failAccountingImport(id: string, message: string, filePath?: string) {
  if (filePath) {
    await fs.promises.unlink(filePath).catch(() => undefined);
  }
  const sql = await getDatabaseClient();
  await sql`
    UPDATE accounting_import_jobs
    SET status = 'FAILED', stage = 'Nạp dữ liệu thất bại', error_message = ${message.slice(0, 4000)},
        completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND status = 'RUNNING'
  `;
}

const stageLabels: Record<string, string> = {
  orders: "Đang nạp sheet Đầu vào Order",
  ads: "Đang nạp sheet ADS",
  returns: "Đang nạp sheet RETURN",
  serviceFees: "Đang nạp sheet Service Fees",
  skuMaster: "Đang nạp sheet Bảng mã",
  inbound: "Đang nạp sheet Chi tiết đi hàng",
  checkShipment: "Đang nạp sheet Check Shipment Amazon",
  monthlyBasecost: "Đang nạp sheet Basecost tháng",
};

export async function executeAccountingImportJob(job: AccountingImportJob) {
  // Dynamic import to prevent circular dependency
  const { importUnifiedAccountingExcel } = await import("./excel-unified-importer");

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
        ).catch((err) => console.error("[Accounting Import] Progress update failed:", err));
      },
    });
    await completeAccountingImport(job.id, result);
    console.log(`[Accounting Import] Completed ${job.id}: ${result.totalProcessed} rows`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Accounting Import] Failed ${job.id}:`, message);
    await failAccountingImport(job.id, message, job.file_path).catch((updateError) =>
      console.error("[Accounting Import] Cannot persist failure:", updateError));
  }
}
