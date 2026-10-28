import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";

// Crawler kế toán chạy trên máy Mac (AdsPower + Seller Central). Web chỉ tạo lệnh; máy Mac
// (mac-crawler/accounting_job_worker.ts) nhận lệnh, chạy đúng script của lịch tự động và báo tiến độ về.

export type AccountingCrawler = "accounting_daily" | "inventory_ledger" | "awd_ledger";
export type CrawlerJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export const ACCOUNTING_CRAWLERS: Record<
  AccountingCrawler,
  { label: string; description: string; schedule: string; dateHint: string; freshnessLabel: string }
> = {
  accounting_daily: {
    label: "Báo cáo kế toán hằng ngày",
    description: "File 01–08: Portfolios, All Orders (+14 ngày gần nhất), Returns, Service Fees, Campaigns, FBA Inventory, Shipments, DC Shipments.",
    schedule: "15:00 mỗi ngày",
    dateHint: "Ngày chốt sổ (trống = hôm qua, trước 15:00 là hôm kia)",
    freshnessLabel: "Đơn hàng mới nhất",
  },
  inventory_ledger: {
    label: "Inventory Ledger FBA (Tồn kho)",
    description: "Báo cáo Inventory Ledger dạng Summary theo Country → cột Tồn (FBA) trong Bảng Mã.",
    schedule: "04:00 thứ 2 hằng tuần + mùng 1 hằng tháng",
    dateHint: "Ngày chốt sổ (trống = thứ 7 tuần trước; mùng 1 = ngày cuối tháng trước)",
    freshnessLabel: "Snapshot mới nhất",
  },
  awd_ledger: {
    label: "AWD Inventory Ledger",
    description: "Báo cáo tồn kho kho AWD → cộng vào cột Tồn trong Bảng Mã.",
    schedule: "04:00 thứ 4 hằng tuần + mùng 1 hằng tháng",
    dateHint: "Ngày chốt sổ (trống = thứ 7 tuần trước; mùng 1 = ngày cuối tháng trước)",
    freshnessLabel: "Snapshot mới nhất",
  },
};

export function isAccountingCrawler(value: unknown): value is AccountingCrawler {
  return typeof value === "string" && value in ACCOUNTING_CRAWLERS;
}

export interface CrawlerJob {
  id: string;
  crawler: AccountingCrawler;
  store_name: string | null;
  target_date: string | null;
  status: CrawlerJobStatus;
  requested_by: string | null;
  worker_id: string | null;
  current_step: string | null;
  log_tail: string | null;
  exit_code: number | null;
  error_message: string | null;
  cancel_requested: boolean;
  created_at: string;
  claimed_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
}

export interface CrawlerWorker {
  worker_id: string;
  last_seen_at: string;
  online: boolean;
  stores: string[];
  /** hostname, node, scripts: { [crawler]: có file run_*.sh trên máy Mac hay không } */
  info: { hostname?: string; node?: string; scripts?: Partial<Record<AccountingCrawler, boolean>> };
}

/** Worker gửi heartbeat mỗi 15 giây; quá ngưỡng này coi như máy Mac mất kết nối. */
const STALE_HEARTBEAT = "3 minutes";
const ONLINE_WINDOW_SECONDS = 60;
const LOG_TAIL_LIMIT = 8_000;

const JOB_COLUMNS = `
  id, crawler, store_name, target_date::text, status, requested_by, worker_id, current_step, log_tail,
  exit_code, error_message, cancel_requested, created_at::text, claimed_at::text, heartbeat_at::text,
  completed_at::text
`;

type Sql = Awaited<ReturnType<typeof getDatabaseClient>>;

async function failStaleJobs(sql: Sql) {
  await sql`
    UPDATE accounting_crawler_jobs
    SET status = 'FAILED', completed_at = NOW(),
        error_message = 'Máy Mac mất kết nối khi đang chạy (không có heartbeat quá 3 phút).'
    WHERE status = 'RUNNING' AND COALESCE(heartbeat_at, claimed_at) < NOW() - ${STALE_HEARTBEAT}::interval
  `;
}

/** Ngày dữ liệu mới nhất theo store của từng crawler (đọc từ DB, gồm cả lần chạy theo lịch). */
async function getFreshness(sql: Sql): Promise<Record<AccountingCrawler, { store: string; latest: string | null }[]>> {
  const perStore = async (table: string, column: string) => {
    const [{ exists }] = await sql<{ exists: boolean }[]>`SELECT to_regclass(${table}) IS NOT NULL AS exists`;
    if (!exists) return [];
    return sql<{ store: string; latest: string | null }[]>`
      SELECT s.name AS store, MAX(t.${sql(column)})::text AS latest
      FROM stores s LEFT JOIN ${sql(table)} t ON t.store_id = s.id
      GROUP BY s.name ORDER BY s.name
    `;
  };
  const [daily, inventory, awd] = await Promise.all([
    perStore("accounting_orders", "date"),
    perStore("accounting_inventory_ledger", "snapshot_date"),
    perStore("accounting_awd_inventory_ledger", "snapshot_date"),
  ]);
  return { accounting_daily: daily, inventory_ledger: inventory, awd_ledger: awd };
}

export async function getCrawlerOverview() {
  const sql = await getDatabaseClient();
  await failStaleJobs(sql);
  const [jobs, workers, freshness, stores] = await Promise.all([
    sql<CrawlerJob[]>`SELECT ${sql.unsafe(JOB_COLUMNS)} FROM accounting_crawler_jobs ORDER BY created_at DESC LIMIT 30`,
    sql<CrawlerWorker[]>`
      SELECT worker_id, last_seen_at::text, stores, info,
             last_seen_at > NOW() - ${ONLINE_WINDOW_SECONDS} * INTERVAL '1 second' AS online
      FROM accounting_crawler_workers ORDER BY last_seen_at DESC
    `,
    getFreshness(sql),
    sql<{ name: string }[]>`SELECT name FROM stores ORDER BY name`,
  ]);
  const crawlers = (Object.keys(ACCOUNTING_CRAWLERS) as AccountingCrawler[]).map((key) => ({
    key,
    ...ACCOUNTING_CRAWLERS[key],
    activeJob: jobs.find((job) => job.crawler === key && (job.status === "PENDING" || job.status === "RUNNING")) ?? null,
    lastJob: jobs.find((job) => job.crawler === key && job.status !== "PENDING" && job.status !== "RUNNING") ?? null,
    freshness: freshness[key],
  }));
  // Store chạy được = store trong stores.json của máy Mac; chưa có worker thì lấy danh sách store trên web
  const workerStores = workers.find((worker) => worker.stores.length > 0)?.stores;
  return { crawlers, jobs, workers, stores: workerStores ?? stores.map((store) => store.name) };
}

export async function enqueueCrawlerJob(
  crawler: AccountingCrawler,
  options: { storeName?: string | null; targetDate?: string | null },
  requestedBy: string,
): Promise<CrawlerJob> {
  const sql = await getDatabaseClient();
  await failStaleJobs(sql);
  try {
    const [job] = await sql<CrawlerJob[]>`
      INSERT INTO accounting_crawler_jobs (crawler, store_name, target_date, requested_by, current_step)
      VALUES (${crawler}, ${options.storeName || null}, ${options.targetDate || null}, ${requestedBy},
              'Đang chờ máy Mac nhận lệnh...')
      RETURNING ${sql.unsafe(JOB_COLUMNS)}
    `;
    return job;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError(`${ACCOUNTING_CRAWLERS[crawler].label} đang có lệnh chờ hoặc đang chạy. Hủy lệnh đó trước khi chạy lại.`, 409);
    }
    throw error;
  }
}

export async function cancelCrawlerJob(jobId: string): Promise<CrawlerJob> {
  const sql = await getDatabaseClient();
  // Lệnh chưa được nhận thì hủy luôn; đang chạy thì báo máy Mac dừng tiến trình ở heartbeat kế tiếp
  const [job] = await sql<CrawlerJob[]>`
    UPDATE accounting_crawler_jobs
    SET status = CASE WHEN status = 'PENDING' THEN 'CANCELLED' ELSE status END,
        completed_at = CASE WHEN status = 'PENDING' THEN NOW() ELSE completed_at END,
        cancel_requested = TRUE,
        current_step = CASE WHEN status = 'PENDING' THEN 'Đã hủy trước khi máy Mac nhận lệnh.'
                            ELSE 'Đang yêu cầu máy Mac dừng crawler...' END
    WHERE id = ${jobId} AND status IN ('PENDING', 'RUNNING')
    RETURNING ${sql.unsafe(JOB_COLUMNS)}
  `;
  if (!job) throw new ApiError("Không tìm thấy lệnh đang chờ/chạy để hủy.", 404);
  return job;
}

// ----------------- Phía máy Mac -----------------

/** Máy Mac hỏi lệnh: ghi nhận đang online, nhận lệnh cũ nhất nếu máy này chưa chạy lệnh nào. */
export async function pollCrawlerJob(workerId: string, stores: string[], info: Record<string, unknown>) {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO accounting_crawler_workers (worker_id, last_seen_at, stores, info)
    VALUES (${workerId}, NOW(), ${sql.json(stores)}, ${sql.json(info as never)})
    ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = NOW(), stores = EXCLUDED.stores, info = EXCLUDED.info
  `;
  await failStaleJobs(sql);
  return sql.begin(async (tx) => {
    // Mỗi lần chỉ chạy 1 crawler (cùng dùng profile AdsPower của các store)
    const [running] = await tx`SELECT id FROM accounting_crawler_jobs WHERE status = 'RUNNING' LIMIT 1`;
    if (running) return null;
    const [job] = await tx<CrawlerJob[]>`
      UPDATE accounting_crawler_jobs
      SET status = 'RUNNING', worker_id = ${workerId}, claimed_at = NOW(), heartbeat_at = NOW(),
          current_step = 'Máy Mac đã nhận lệnh, đang khởi động crawler...'
      WHERE id = (
        SELECT id FROM accounting_crawler_jobs WHERE status = 'PENDING'
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING ${tx.unsafe(JOB_COLUMNS)}
    `;
    return job ?? null;
  });
}

/** Tiến độ khi đang chạy; trả về cancelRequested để máy Mac dừng tiến trình. */
export async function heartbeatCrawlerJob(jobId: string, workerId: string, currentStep: string | null, logTail: string | null) {
  const sql = await getDatabaseClient();
  const [row] = await sql<{ cancel_requested: boolean }[]>`
    UPDATE accounting_crawler_jobs
    SET heartbeat_at = NOW(),
        current_step = CASE WHEN cancel_requested THEN current_step ELSE COALESCE(${currentStep}, current_step) END,
        log_tail = COALESCE(${logTail?.slice(-LOG_TAIL_LIMIT) ?? null}, log_tail)
    WHERE id = ${jobId} AND worker_id = ${workerId} AND status = 'RUNNING'
    RETURNING cancel_requested
  `;
  await sql`UPDATE accounting_crawler_workers SET last_seen_at = NOW() WHERE worker_id = ${workerId}`;
  // Lệnh đã bị đánh dấu thất bại / không còn của máy này → dừng luôn
  return { cancelRequested: row ? row.cancel_requested : true };
}

export async function finishCrawlerJob(
  jobId: string,
  workerId: string,
  result: { exitCode: number | null; logTail: string | null; error: string | null },
) {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE accounting_crawler_jobs
    SET status = CASE WHEN cancel_requested THEN 'CANCELLED'
                      WHEN ${result.exitCode} = 0 THEN 'COMPLETED' ELSE 'FAILED' END,
        exit_code = ${result.exitCode},
        error_message = CASE WHEN cancel_requested THEN 'Người dùng đã hủy trên web.' ELSE ${result.error} END,
        current_step = CASE WHEN cancel_requested THEN 'Đã dừng crawler theo yêu cầu.'
                            WHEN ${result.exitCode} = 0 THEN 'Hoàn tất.' ELSE 'Crawler kết thúc với lỗi.' END,
        log_tail = COALESCE(${result.logTail?.slice(-LOG_TAIL_LIMIT) ?? null}, log_tail),
        heartbeat_at = NOW(), completed_at = NOW()
    WHERE id = ${jobId} AND worker_id = ${workerId} AND status = 'RUNNING'
  `;
}
