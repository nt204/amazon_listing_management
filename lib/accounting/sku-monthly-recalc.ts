import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getDatabaseClient } from "@/lib/db";

// Tính lại SKU Monthly của 1 kỳ từ file thô Amazon trên R2 (accounting_sku_monthly_recalc_queue, migration 133).
// Base Cost tháng tự tính lại khi lô hàng / tồn kho đổi (base-cost-resync.ts), nhưng SKU Monthly chỉ được tính
// lúc crawler nạp đầu tháng → giá vốn mới không vào SKU Monthly. Worker Base Cost xếp các kỳ đã có SKU Monthly
// vào hàng đợi; accounting-import-worker lấy ra, tải file thô từ R2 và chạy scripts/ingest_monthly_from_raw.py.
// Tắt việc tự xếp hàng sau Base Cost bằng SKU_MONTHLY_AUTO_RECALC=off (nút "Tính lại" vẫn dùng hàng đợi).

const execFileAsync = promisify(execFile);
// Chờ dữ liệu lắng: Base Cost tính lại liên tiếp nhiều lần chỉ kéo theo 1 lần tính SKU Monthly
const SETTLE_SECONDS = 60;
const MAX_ATTEMPTS = 3;
const INGEST_TIMEOUT_MS = 15 * 60_000;
// Script đọc: phí lưu kho kỳ M nằm ở thư mục M-1 (crawler cũ), phí đơn thanh toán muộn ở 3 tháng sau,
// mã removal order của các tháng trước (để gắn phí Disposal vào SKU)
const LATER_MONTHS = 3;
const REMOVAL_HISTORY_MONTHS = 12;
const REQUIRED_REPORTS = ["02_AllOrders", "15_DateRangeTransactions"];

function shiftPeriod(period: string, delta: number) {
  const [y, m] = period.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Thư viện Python của script (requirements.txt) cài riêng vào .python-deps lúc deploy (scripts/deploy-server.sh)
function pythonEnv(): NodeJS.ProcessEnv {
  const depsDir = path.join(process.cwd(), ".python-deps");
  if (!fs.existsSync(depsDir)) return process.env;
  return { ...process.env, PYTHONPATH: [depsDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
}

export async function enqueueSkuMonthlyRecalc(storeId: string, periods: string[], requestedBy: string) {
  if (!periods.length) return;
  const sql = await getDatabaseClient();
  for (const period of periods) {
    await sql`
      INSERT INTO accounting_sku_monthly_recalc_queue (store_id, period, requested_at, requested_by)
      VALUES (${storeId}, ${period}, NOW(), ${requestedBy})
      ON CONFLICT (store_id, period) DO UPDATE
      SET requested_at = NOW(), requested_by = EXCLUDED.requested_by, attempts = 0, last_error = NULL
    `;
  }
}

/** Sau khi Base Cost các kỳ `periods` được tính lại: xếp hàng tính lại các kỳ đã có SKU Monthly. */
export async function enqueueSkuMonthlyRecalcAfterBaseCost(storeId: string, periods: string[]) {
  if (process.env.SKU_MONTHLY_AUTO_RECALC === "off" || !periods.length) return [];
  const sql = await getDatabaseClient();
  const rows = await sql<{ period: string }[]>`
    SELECT year::text || '-' || LPAD(month::text, 2, '0') AS period
    FROM accounting_monthly_store_summary
    WHERE store_id = ${storeId}
      AND year::text || '-' || LPAD(month::text, 2, '0') = ANY(${periods})
  `;
  const existing = rows.map((row) => row.period);
  await enqueueSkuMonthlyRecalc(storeId, existing, "base-cost-resync");
  return existing;
}

type RecalcJob = { store_id: string; period: string; attempts: number; store_name: string };

/** Lấy 1 kỳ đã lắng (Base Cost của store không còn trong hàng đợi) ra và tính lại. Trả false khi hàng đợi trống. */
export async function processNextSkuMonthlyRecalc(): Promise<boolean> {
  const sql = await getDatabaseClient();
  const [job] = await sql<RecalcJob[]>`
    WITH next AS (
      SELECT q.store_id, q.period
      FROM accounting_sku_monthly_recalc_queue q
      WHERE q.requested_at < NOW() - make_interval(secs => ${SETTLE_SECONDS})
        AND q.attempts < ${MAX_ATTEMPTS}
        AND NOT EXISTS (SELECT 1 FROM accounting_base_cost_resync_queue b WHERE b.store_id = q.store_id)
      ORDER BY q.requested_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM accounting_sku_monthly_recalc_queue q
    USING next, stores s
    WHERE q.store_id = next.store_id AND q.period = next.period AND s.id = q.store_id
    RETURNING q.store_id::text, q.period, q.attempts, s.name AS store_name
  `;
  if (!job) return false;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sku-monthly-raw-"));
  try {
    await recalcFromR2(job, workDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[SkuMonthlyRecalc] ${job.store_name} ${job.period} lỗi (lần ${job.attempts + 1}):`, message);
    // Trả lại hàng đợi để lượt sau thử lại; quá MAX_ATTEMPTS thì giữ dòng kèm lỗi để xem lại
    await sql`
      INSERT INTO accounting_sku_monthly_recalc_queue (store_id, period, requested_at, requested_by, attempts, last_error)
      VALUES (${job.store_id}, ${job.period}, NOW(), 'retry', ${job.attempts + 1}, ${message.slice(0, 2000)})
      ON CONFLICT (store_id, period) DO NOTHING
    `;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return true;
}

async function recalcFromR2(job: RecalcJob, workDir: string) {
  // Nạp động: module này cũng được web process dùng (xếp hàng sau Base Cost), không kéo cả bộ nạp file kế toán vào web
  const { downloadMonthlyRawFromR2 } = await import("@/lib/accounting/accounting-file-service");
  const files = await downloadMonthlyRawFromR2(job.store_name, job.period, workDir);
  const missing = REQUIRED_REPORTS.filter((prefix) => !files.some((name) => name.startsWith(prefix)));
  if (missing.length) {
    // Kỳ không có file thô (VD nạp từ sheet): không tính lại, tránh ghi đè số cũ bằng 0
    throw new Error(`R2 thiếu ${missing.join(", ")} của ${job.store_name} ${job.period}`);
  }
  await downloadMonthlyRawFromR2(job.store_name, shiftPeriod(job.period, -1), workDir);
  for (let i = 1; i <= LATER_MONTHS; i++) {
    await downloadMonthlyRawFromR2(job.store_name, shiftPeriod(job.period, i), workDir);
  }
  for (let i = 2; i <= REMOVAL_HISTORY_MONTHS; i++) {
    await downloadMonthlyRawFromR2(job.store_name, shiftPeriod(job.period, -i), workDir, (name) =>
      name.startsWith("11_RemovalOrderDetail"),
    );
  }

  const rawDir = path.join(workDir, job.period, job.store_name.toUpperCase().trim());
  const { stdout } = await execFileAsync(
    process.env.ACCOUNTING_PYTHON_BIN || "python3",
    [
      path.join(process.cwd(), "scripts", "ingest_monthly_from_raw.py"),
      "--store", job.store_id,
      "--month", job.period,
      "--dir", rawDir,
      "--force",
      "--no-refresh-prev",
    ],
    { timeout: INGEST_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, env: pythonEnv() },
  );
  if (!stdout.includes("Monthly ingestion completed successfully")) {
    throw new Error(`Script không báo hoàn tất: ${stdout.slice(-500)}`);
  }
  const netProfit = stdout.match(/Net Profit \(Store Total\)\s*:\s*\$\s*(-?[\d.]+)/)?.[1];
  console.log(`[SkuMonthlyRecalc] ${job.store_name} ${job.period}: đã tính lại từ R2 (Net Profit ${netProfit ?? "?"})`);
}
