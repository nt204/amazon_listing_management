import "server-only";

import { getDashboardCacheScope, waitForDashboardBackgroundLoads } from "@/lib/accounting/dashboard-cache";
import { getAccountingDashboard, getDashboardTopProducts } from "@/lib/accounting/dashboard-db";
import {
  addDays,
  dashboardCompareMode,
  dashboardPresetRange,
  dashboardRangeUnit,
} from "@/lib/accounting/dashboard-periods";

// Tính sẵn cache Dashboard kế toán (chạy trong accounting-import-worker, KHÔNG chạy trong tiến trình web).
//
// Cache số liệu ngày / Top / tồn lưu theo store + kênh + tháng (hoặc kỳ) trong Redis — không phụ thuộc store / team
// đang chọn — nên tính sẵn các preset của bộ chọn ngày cho "tất cả store" là phủ cả khi lọc store, team hay theo quyền.
// Khi phiên bản dữ liệu đổi (crawler / nhập file / sửa ô), không có bộ này thì người mở Dashboard đầu tiên phải chờ
// tính lại 2–4 s mỗi preset. Tắt bằng ACCOUNTING_DASHBOARD_PREWARM=off.

/** Giống OVERVIEW_DATE_PRESETS (components/accounting/accounting-dashboard-view.tsx) — "all" không có khoảng cố định. */
const PRESETS = ["this_month", "today", "yesterday", "this_week", "last_week", "last_month", "this_year", "last_year"];
/** Kiểu so sánh người dùng có thể lưu: kỳ trước / cùng kỳ năm trước. */
const COMPARE_BASES = ["prev", "yoy"] as const;

const CHECK_INTERVAL_MS = 60_000;
/** Dữ liệu vẫn đang được ghi liên tục: tối đa ngần này mới tính sẵn một lần (không chờ yên hẳn). */
const MAX_DEFER_MS = 10 * 60_000;

/** Ngày neo của bộ chọn ngày phía client: "hôm qua" theo giờ Việt Nam (getAmazonLatestAvailableDate). */
function clientAnchorDate(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  return addDays(today, -1);
}

async function currentSignature(): Promise<string> {
  const scope = await getDashboardCacheScope();
  return `${scope.dataVersion ?? "-"}|${scope.historyVersion ?? "-"}|${scope.today}|${clientAnchorDate()}`;
}

/** Tính sẵn mọi preset (lần lượt từng lượt gọi để không dồn tải lên DB). */
export async function prewarmAccountingDashboard(): Promise<{ calls: number; ms: number }> {
  const anchor = clientAnchorDate();
  const started = Date.now();
  let calls = 0;
  for (const presetId of PRESETS) {
    const range = dashboardPresetRange(presetId, anchor);
    if (!range) continue;
    const unit = dashboardRangeUnit(range.startDate, range.endDate, presetId);
    const modes = new Set(COMPARE_BASES.map((base) => dashboardCompareMode(unit, base)));
    for (const compare of modes) {
      await getAccountingDashboard({ ...range, compare });
      await waitForDashboardBackgroundLoads();
      calls += 1;
    }
    await getDashboardTopProducts(range);
    await waitForDashboardBackgroundLoads();
    calls += 1;
  }
  return { calls, ms: Date.now() - started };
}

/**
 * Mỗi phút xem phiên bản dữ liệu: đổi và đã yên ≥ 1 phút (hoặc đã chờ quá MAX_DEFER_MS) → tính sẵn.
 * Trả hàm dừng.
 */
export function startAccountingDashboardPrewarm(): () => void {
  if (process.env.ACCOUNTING_DASHBOARD_PREWARM === "off") return () => {};
  let warmed = "";
  let lastSeen = "";
  let changedAt = 0;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sig = await currentSignature();
      if (sig === warmed) return;
      const now = Date.now();
      if (sig !== lastSeen) {
        // Lần đầu thấy phiên bản này: khởi động thì tính luôn, còn lại chờ 1 nhịp xem còn ghi tiếp không
        if (!changedAt) changedAt = now;
        const settled = !warmed;
        lastSeen = sig;
        if (!settled && now - changedAt < MAX_DEFER_MS) return;
      }
      const { calls, ms } = await prewarmAccountingDashboard();
      // Trong lúc tính, dữ liệu có thể lại đổi → chỉ đánh dấu phiên bản đã thấy lúc bắt đầu
      warmed = sig;
      changedAt = 0;
      console.log(`[DashboardPrewarm] Đã tính sẵn ${calls} lượt Dashboard trong ${ms}ms (${sig})`);
    } catch (error) {
      console.warn("[DashboardPrewarm] Lỗi tính sẵn:", error);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void tick(), 15_000);
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
