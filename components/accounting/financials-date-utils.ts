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
 * Retrieves the saved date range for a specific account (store) in a financials tab.
 * Falls back to "This Month" if no custom range has been saved yet for that account.
 */
export function getSavedStoreDateRange(
  viewKey: "sku_win" | "sku_test" | "fba_daily",
  storeId: string,
  maxDateStr?: string
): DateRange {
  if (typeof window !== "undefined" && storeId) {
    // 1. Tab-specific store range
    const tabSaved = localStorage.getItem(`acc_range_${viewKey}_${storeId}`);
    if (tabSaved) {
      try {
        const parsed = JSON.parse(tabSaved);
        if (parsed?.startDate && parsed?.endDate) {
          return parsed;
        }
      } catch {
        // ignore JSON parse error
      }
    }

    // 2. Shared store range
    const storeSaved = localStorage.getItem(`acc_range_store_${storeId}`);
    if (storeSaved) {
      try {
        const parsed = JSON.parse(storeSaved);
        if (parsed?.startDate && parsed?.endDate) {
          return parsed;
        }
      } catch {
        // ignore JSON parse error
      }
    }
  }

  // 3. Default fallback: This Month
  return getThisMonthDateRange(maxDateStr);
}

/**
 * Saves the selected date range for a specific account (store).
 */
export function saveStoreDateRange(
  viewKey: "sku_win" | "sku_test" | "fba_daily",
  storeId: string,
  range: DateRange
): void {
  if (typeof window !== "undefined" && storeId) {
    localStorage.setItem(`acc_range_${viewKey}_${storeId}`, JSON.stringify(range));
    localStorage.setItem(`acc_range_store_${storeId}`, JSON.stringify(range));
  }
}
