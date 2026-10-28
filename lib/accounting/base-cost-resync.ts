import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { syncMonthlyBaseCostFromInbound } from "@/lib/accounting/inventory-db";

// Tự tính lại Base Cost tháng khi lô hàng ở CHI TIẾT ĐI HÀNG thay đổi hoặc khi nạp báo cáo tồn FBA/AWD mới.
// Trigger DB (migration 117) ghi "store cần tính lại từ tháng nào" vào accounting_base_cost_resync_queue;
// worker này lấy từng store ra, tính lại từ tháng đó tới tháng hiện tại (cascade qua giá tồn đầu kỳ).
// Chờ SETTLE_SECONDS sau lần thay đổi cuối để nhập Excel / đồng bộ Sheet hàng loạt chỉ tính 1 lần.
// Tắt bằng BASE_COST_AUTO_RESYNC=off. Nhiều server cùng chạy vẫn an toàn (FOR UPDATE SKIP LOCKED).

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const CHECK_INTERVAL_MS = 15_000;
const SETTLE_SECONDS = 10;
const CHANGED_BY = "auto-resync";

// Mỗi lần module được nạp (dev hot reload) có id riêng: bộ hẹn giờ của bản code cũ được thay bằng bản mới.
const MODULE_ID = Symbol("base-cost-resync");
const globalForWorker = globalThis as typeof globalThis & {
  baseCostResyncWorker?: NodeJS.Timeout;
  baseCostResyncWorkerOwner?: symbol;
};

function currentVietnamPeriod() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
}

function nextPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  return m >= 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Lấy 1 store đã lắng (không còn thay đổi trong SETTLE_SECONDS) ra khỏi hàng đợi và tính lại. Trả false khi hàng đợi trống. */
async function processNext(): Promise<boolean> {
  const sql = await getDatabaseClient();
  const [job] = await sql<{ store_id: string; from_period: string }[]>`
    DELETE FROM accounting_base_cost_resync_queue
    WHERE store_id = (
      SELECT store_id FROM accounting_base_cost_resync_queue
      WHERE requested_at < NOW() - make_interval(secs => ${SETTLE_SECONDS})
      ORDER BY requested_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING store_id::text, from_period
  `;
  if (!job) return false;

  try {
    // Chỉ tính trong khoảng store đã dùng Base Cost: không tự tạo bảng cho các tháng/store chưa từng tính.
    const [range] = await sql<{ first: string | null; last: string | null }[]>`
      SELECT MIN(period) AS first, MAX(period) AS last
      FROM accounting_monthly_base_cost
      WHERE store_id = ${job.store_id} AND deleted_at IS NULL
    `;
    if (!range?.first || !range.last) return true;

    const current = currentVietnamPeriod();
    const start = job.from_period > range.first ? job.from_period : range.first;
    const end = range.last > current ? range.last : current;
    if (start > end) return true;

    const months: string[] = [];
    for (let p = start; p <= end; p = nextPeriod(p)) {
      const res = await syncMonthlyBaseCostFromInbound(job.store_id, p, CHANGED_BY);
      if (res.errors.length) {
        console.error(`[BaseCostResync] ${job.store_id} ${p}: ${res.errors.length} SKU lỗi`, res.errors.slice(0, 5));
      }
      months.push(p);
    }
    console.log(`[BaseCostResync] Store ${job.store_id}: đã tính lại ${months[0]} → ${months[months.length - 1]}`);
  } catch (error) {
    // Trả lại hàng đợi để lượt sau thử lại
    await sql`SELECT accounting_enqueue_base_cost_resync(${job.store_id}::uuid, ${job.from_period})`;
    throw error;
  }
  return true;
}

/** Bật worker (gọi khi server khởi động, chạy 1 lần duy nhất mỗi tiến trình). */
export function startBaseCostResyncWorker() {
  if (process.env.BASE_COST_AUTO_RESYNC === "off") return;
  if (globalForWorker.baseCostResyncWorker) {
    if (globalForWorker.baseCostResyncWorkerOwner === MODULE_ID) return;
    clearInterval(globalForWorker.baseCostResyncWorker);
  }
  globalForWorker.baseCostResyncWorkerOwner = MODULE_ID;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      while (await processNext()) {}
    } catch (error) {
      console.error("[BaseCostResync] Lỗi tính lại Base Cost:", error);
    } finally {
      running = false;
    }
  };
  globalForWorker.baseCostResyncWorker = setInterval(tick, CHECK_INTERVAL_MS);
  globalForWorker.baseCostResyncWorker.unref?.();
  void tick();
}
