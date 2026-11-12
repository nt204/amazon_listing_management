import type { DateRange } from "@/components/ppc/ppc-amazon-date-picker";

/**
 * Returns latest complete date for Amazon financials reporting (yesterday).
 */
export function getAmazonLatestAvailableDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Calculates the "This Month" date range:
 * - Start date: 1st of current month (YYYY-MM-01)
 * - End date: current date (or clamped to maxDate if provided and within current month)
 */
export function getThisMonthDateRange(maxDateStr?: string): DateRange {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const startDate = `${year}-${month}-01`;
  let endDate = `${year}-${month}-${pad(now.getDate())}`;

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
