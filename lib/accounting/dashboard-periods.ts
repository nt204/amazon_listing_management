// Tính toán các khoảng thời gian cho Dashboard Accounting (thuần, không truy cập DB để test được).

export interface DashboardPeriods {
  /** Kỳ hiện tại sau khi kẹp theo ngày có dữ liệu mới nhất. Rỗng = toàn thời gian. */
  current: { startDate: string; endDate: string };
  /** Kỳ so sánh Like-for-Like; null khi xem toàn thời gian. */
  previous: { startDate: string; endDate: string } | null;
  /** Ngày bắt đầu chuỗi xu hướng theo tháng (mùng 1). Rỗng = toàn thời gian. */
  trendStartDate: string;
}

export const DASHBOARD_TREND_MONTHS = 6;

export type DashboardCompareMode = "prev" | "week" | "month" | "yoy" | "none";

/** Số tháng lùi để so sánh xu hướng theo tháng (0 = không so sánh). */
export function monthlyCompareShift(compare: DashboardCompareMode): number {
  return compare === "yoy" ? 12 : compare === "month" ? 1 : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = toUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  return Math.round((toUtc(endDate).getTime() - toUtc(startDate).getTime()) / 86_400_000) + 1;
}

/** Lùi/tiến n tháng, kẹp ngày theo độ dài tháng đích (31/10 → 30/09). */
export function shiftMonths(dateStr: string, months: number): string {
  const d = toUtc(dateStr);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth))));
}

function monthStartOffset(dateStr: string, monthOffset: number): string {
  const d = toUtc(dateStr);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1)));
}

/**
 * - Kỳ hiện tại bị kẹp về ngày có dữ liệu mới nhất (latestDate).
 * - Kỳ trước: nếu kỳ hiện tại bắt đầu từ mùng 1 và nằm gọn trong 1 tháng → cùng kỳ tháng trước
 *   (1 → cùng ngày, kẹp theo số ngày của tháng trước). Ngược lại → cùng số ngày liền trước.
 * - compare = "week" | "month" | "yoy": cùng ngày tuần/tháng/năm trước; "none": không so sánh.
 * - Xu hướng tháng: 6 tháng gần nhất tính đến tháng của ngày kết thúc (mở rộng nếu kỳ dài hơn).
 */
export function resolveDashboardPeriods(
  startDate: string,
  endDate: string,
  latestDate: string,
  compare: DashboardCompareMode = "prev",
): DashboardPeriods {
  if (!startDate || !endDate) {
    return { current: { startDate: "", endDate: "" }, previous: null, trendStartDate: "" };
  }

  const end = latestDate && endDate > latestDate ? latestDate : endDate;
  const start = startDate > end ? end : startDate;

  let previous: { startDate: string; endDate: string } | null;
  const startD = toUtc(start);
  const endD = toUtc(end);
  const sameMonth =
    startD.getUTCFullYear() === endD.getUTCFullYear() && startD.getUTCMonth() === endD.getUTCMonth();

  if (compare === "none") {
    previous = null;
  } else if (compare === "yoy") {
    previous = { startDate: shiftMonths(start, -12), endDate: shiftMonths(end, -12) };
  } else if (compare === "month") {
    previous = { startDate: shiftMonths(start, -1), endDate: shiftMonths(end, -1) };
  } else if (compare === "week") {
    previous = { startDate: addDays(start, -7), endDate: addDays(end, -7) };
  } else if (startD.getUTCDate() === 1 && sameMonth) {
    const prevStart = monthStartOffset(start, -1);
    const prevStartD = toUtc(prevStart);
    const daysInPrevMonth = new Date(
      Date.UTC(prevStartD.getUTCFullYear(), prevStartD.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const prevEndDay = Math.min(endD.getUTCDate(), daysInPrevMonth);
    previous = { startDate: prevStart, endDate: `${prevStart.slice(0, 8)}${pad(prevEndDay)}` };
  } else {
    const span = inclusiveDayCount(start, end);
    previous = { startDate: addDays(start, -span), endDate: addDays(start, -1) };
  }

  const sixMonthStart = monthStartOffset(end, -(DASHBOARD_TREND_MONTHS - 1));
  const rangeMonthStart = monthStartOffset(start, 0);
  const trendStartDate = rangeMonthStart < sixMonthStart ? rangeMonthStart : sixMonthStart;

  return { current: { startDate: start, endDate: end }, previous, trendStartDate };
}
