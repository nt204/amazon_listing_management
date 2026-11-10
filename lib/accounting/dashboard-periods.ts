// Tính toán các khoảng thời gian cho Dashboard Accounting (thuần, không truy cập DB để test được).

export interface DashboardPeriods {
  /** Kỳ hiện tại sau khi kẹp theo ngày có dữ liệu mới nhất. Rỗng = toàn thời gian. */
  current: { startDate: string; endDate: string };
  /** Kỳ so sánh Like-for-Like; null khi xem toàn thời gian. */
  previous: { startDate: string; endDate: string } | null;
  /** Ngày bắt đầu chuỗi xu hướng theo tháng: 1/1 của năm (lùi thêm nếu kỳ bắt đầu sớm hơn). Rỗng = toàn thời gian. */
  trendStartDate: string;
}

/** yoy_week = cùng tuần năm trước: lùi 52 tuần (364 ngày) để thứ trong tuần khớp nhau. day = lùi 1 ngày (hôm qua). */
export type DashboardCompareMode = "prev" | "day" | "week" | "month" | "yoy" | "yoy_week" | "none";

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
 * - compare = "week" | "month" | "yoy": cùng ngày tuần/tháng/năm trước; "yoy_week": lùi 52 tuần; "none": không so sánh.
 * - Xu hướng tháng: từ tháng 1 của năm chứa ngày kết thúc (mở rộng nếu kỳ bắt đầu từ năm trước).
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
  } else if (compare === "day") {
    previous = { startDate: addDays(start, -1), endDate: addDays(end, -1) };
  } else if (compare === "week") {
    previous = { startDate: addDays(start, -7), endDate: addDays(end, -7) };
  } else if (compare === "yoy_week") {
    previous = { startDate: addDays(start, -364), endDate: addDays(end, -364) };
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

  const yearStart = `${end.slice(0, 4)}-01-01`;
  const rangeMonthStart = monthStartOffset(start, 0);
  const trendStartDate = rangeMonthStart < yearStart ? rangeMonthStart : yearStart;

  return { current: { startDate: start, endDate: end }, previous, trendStartDate };
}

/** Ngày cuối tháng của dateStr. */
function monthEnd(dateStr: string): string {
  const d = toUtc(dateStr);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/**
 * Kỳ so sánh của 1 ô tháng [start, end] = cùng đoạn lùi `months` tháng (1 = tháng trước, 12 = cùng tháng năm trước).
 * Tháng trọn vẹn → trọn tháng đích (28/2 → 31/1); tháng dở dang → cùng số ngày (1–25/10 → 1–25/9).
 */
export function previousMonthRange(start: string, end: string, months = 1): { startDate: string; endDate: string } {
  const startDate = shiftMonths(start, -months);
  const endDate = end === monthEnd(end) ? monthEnd(startDate) : shiftMonths(end, -months);
  return { startDate, endDate };
}

// ----------------- Đơn vị kỳ của Overview (quyết định kỳ so sánh + cách gom biểu đồ) -----------------

export type DashboardPeriodUnit = "day" | "week" | "month" | "year";
export type DashboardChartGranularity = "day" | "week" | "month";

/** Preset của bộ chọn ngày → đơn vị kỳ (không đoán theo số ngày: "This month" ngày 1–7 vẫn là tháng). */
const PRESET_UNITS: Record<string, DashboardPeriodUnit> = {
  today: "day",
  yesterday: "day",
  this_week: "week",
  last_week: "week",
  this_month: "month",
  last_month: "month",
  this_year: "year",
  ytd: "year",
  last_year: "year",
};

/**
 * Đơn vị kỳ của khoảng ngày: theo preset vừa bấm nếu có; khoảng tự chọn trên lịch thì đoán theo độ dài:
 * 1 ngày → ngày · ≤ 7 ngày → tuần · từ 1/1 và dài hơn 1 tháng → năm · còn lại → tháng.
 */
export function dashboardRangeUnit(startDate: string, endDate: string, presetId?: string | null): DashboardPeriodUnit {
  if (presetId && PRESET_UNITS[presetId]) return PRESET_UNITS[presetId];
  if (!startDate || !endDate) return "month";
  if (startDate === endDate) return "day";
  const span = inclusiveDayCount(startDate, endDate);
  if (span <= 7) return "week";
  if (startDate.endsWith("-01-01") && span > 31) return "year";
  return "month";
}

/**
 * Biểu đồ gom nhỏ hơn kỳ 1 bậc: ngày / tuần → từng ngày · tháng → từng tuần (CN → T7) · năm → từng tháng.
 * Khoảng tháng dài hơn 31 ngày (tự chọn) → theo tháng; năm mới được ≤ 31 ngày (This year đầu tháng 1) → theo tuần.
 */
export function dashboardChartGranularity(unit: DashboardPeriodUnit, startDate: string, endDate: string): DashboardChartGranularity {
  if (unit === "day" || unit === "week") return "day";
  if (!startDate || !endDate) return "month";
  return inclusiveDayCount(startDate, endDate) <= 31 ? "week" : "month";
}

/**
 * Kiểu so sánh gửi server: base "prev" = kỳ liền trước theo đơn vị (hôm qua / tuần trước / tháng trước / năm trước),
 * "yoy" = đúng ngày lịch năm trước (lùi 12 tháng, kể cả khi chọn tuần: 1–7/11 → 1–7/11 năm trước); null = không so sánh.
 */
export function dashboardCompareMode(unit: DashboardPeriodUnit, base: "prev" | "yoy" | null): DashboardCompareMode {
  if (!base) return "none";
  if (base === "yoy" || unit === "year") return "yoy";
  return unit === "day" ? "day" : unit === "week" ? "week" : "month";
}

/**
 * Khoảng ngày của preset bộ chọn ngày, neo theo anchor (ngày có dữ liệu mới nhất) — cùng quy tắc
 * PpcAmazonDatePicker (tuần Chủ nhật → Thứ 7). Dùng để tải sẵn các preset hay dùng. null = preset không hỗ trợ.
 */
export function dashboardPresetRange(presetId: string, anchor: string): { startDate: string; endDate: string } | null {
  const dow = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  const monthStart = `${anchor.slice(0, 8)}01`;
  const year = Number(anchor.slice(0, 4));
  switch (presetId) {
    case "today":
      return { startDate: anchor, endDate: anchor };
    case "yesterday":
      return { startDate: addDays(anchor, -1), endDate: addDays(anchor, -1) };
    case "this_week":
      return { startDate: addDays(anchor, -dow), endDate: anchor };
    case "last_week":
      return { startDate: addDays(anchor, -dow - 7), endDate: addDays(anchor, -dow - 1) };
    case "this_month":
      return { startDate: monthStart, endDate: anchor };
    case "last_month":
      return { startDate: shiftMonths(monthStart, -1), endDate: addDays(monthStart, -1) };
    case "this_year":
    case "ytd":
      return { startDate: `${year}-01-01`, endDate: anchor };
    case "last_year":
      return { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` };
    default:
      return null;
  }
}
