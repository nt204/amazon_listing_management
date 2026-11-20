import type { DateRange } from "@/components/ppc/ppc-amazon-date-picker";

/** Ngày hôm nay theo giờ Amazon (PST/PDT), YYYY-MM-DD — không theo giờ máy (VN đi trước PST 14–15 tiếng). */
export function getAmazonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Ngày gần nhất đã đủ dữ liệu Amazon = hôm qua theo giờ PST (sáng VN ngày 20 thì PST mới ngày 19, chưa hết ngày). */
export function getAmazonLatestAvailableDate(now: Date = new Date()): string {
  const [y, m, d] = getAmazonToday(now).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Calculates the "This Month" date range:
 * - Start date: 1st of current month (YYYY-MM-01)
 * - End date: current date (or clamped to maxDate if provided and within current month)
 */
export function getThisMonthDateRange(maxDateStr?: string): DateRange {
  // Tháng / ngày theo giờ Amazon (PST)
  const today = getAmazonToday();
  const startDate = `${today.slice(0, 7)}-01`;
  let endDate = today;

  if (maxDateStr && endDate > maxDateStr) {
    endDate = maxDateStr;
  }
  // Edge-case safeguard (e.g. 1st day of month when maxDate is in previous month)
  if (startDate > endDate) {
    return { startDate: endDate, endDate };
  }
  return { startDate, endDate };
}

/**
 * Trả về khoảng ngày mặc định cho view tài chính: luôn là "This Month".
 * Khi người dùng chuyển tab hoặc ấn ra ấn về, luôn reset về This Month theo yêu cầu.
 */
export function getSavedStoreDateRange(
  ...args: [viewKey?: "sku_win" | "sku_test" | "fba_daily" | "fbm_daily" | "fbm_sku", storeId?: string, maxDateStr?: string]
): DateRange {
  const maxDateStr = args[2];
  // Dọn dẹp các key acc_range_* cũ trong localStorage (nếu có) để tránh tồn đọng khoảng ngày cũ
  if (typeof window !== "undefined") {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("acc_range_")) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }

  return getThisMonthDateRange(maxDateStr);
}

/**
 * Không lưu khoảng ngày vào localStorage để đảm bảo khi ấn ra ấn về luôn trở về "This Month".
 */
export function saveStoreDateRange(
  ...args: [viewKey?: "sku_win" | "sku_test" | "fba_daily" | "fbm_daily" | "fbm_sku", storeId?: string, range?: DateRange]
): void {
  void args;
  // No-op: Không lưu trữ khoảng ngày qua các phiên điều hướng
}
