import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { listSheetLinks, syncAllSheetLinks } from "@/lib/accounting/inventory-sheet-sync";

// Lịch đồng bộ Google Sheet → Inventory mỗi sáng (mặc định 9:00 giờ Việt Nam).
// Tắt bằng INVENTORY_SHEET_SYNC_SCHEDULE=off; đổi giờ bằng INVENTORY_SHEET_SYNC_HOUR.
// Mỗi ngày chỉ chạy 1 lần kể cả khi nhiều server cùng chạy (khóa bằng bảng inventory_sheet_schedule_runs);
// server bật sau giờ hẹn vẫn chạy bù trong ngày.

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const CHECK_INTERVAL_MS = 60_000;

const globalForScheduler = globalThis as typeof globalThis & { inventorySheetScheduler?: NodeJS.Timeout };

function vietnamNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function runIfDue() {
  const hour = Number(process.env.INVENTORY_SHEET_SYNC_HOUR ?? 9);
  const now = vietnamNow();
  if (now.hour < hour) return;

  // Chưa có link nào thì chưa chốt lượt chạy của ngày, để link lưu sau đó vẫn được chạy trong ngày.
  if ((await listSheetLinks()).length === 0) return;

  const sql = await getDatabaseClient();
  const runKey = `daily:${now.date}`;
  const claimed = await sql<{ run_key: string }[]>`
    INSERT INTO inventory_sheet_schedule_runs (run_key) VALUES (${runKey})
    ON CONFLICT (run_key) DO NOTHING
    RETURNING run_key
  `;
  if (!claimed.length) return;

  console.log(`[InventorySheetSync] Bắt đầu đồng bộ Google Sheet theo lịch (${runKey})`);
  const summary = await syncAllSheetLinks("schedule", "schedule", { skipRecentMinutes: 15 });
  await sql`
    UPDATE inventory_sheet_schedule_runs
    SET finished_at = NOW(), summary = ${sql.json(summary as never)}
    WHERE run_key = ${runKey}
  `;
  const failed = summary.filter((item) => !item.ok).length;
  console.log(`[InventorySheetSync] Xong ${summary.length} link, lỗi ${failed}.`);
}

export function getInventorySheetSchedulerStatus() {
  return {
    enabled: process.env.INVENTORY_SHEET_SYNC_SCHEDULE !== "off",
    running: Boolean(globalForScheduler.inventorySheetScheduler),
    hour: Number(process.env.INVENTORY_SHEET_SYNC_HOUR ?? 9),
  };
}

/** Bật lịch (gọi khi server khởi động và khi có request tới API link, chạy 1 lần duy nhất mỗi tiến trình). */
export function startInventorySheetSyncScheduler() {
  if (process.env.INVENTORY_SHEET_SYNC_SCHEDULE === "off" || globalForScheduler.inventorySheetScheduler) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runIfDue()
      .catch((error) => console.error("[InventorySheetSync] Lỗi lịch đồng bộ:", error))
      .finally(() => {
        running = false;
      });
  };
  globalForScheduler.inventorySheetScheduler = setInterval(tick, CHECK_INTERVAL_MS);
  globalForScheduler.inventorySheetScheduler.unref?.();
  tick();
}
