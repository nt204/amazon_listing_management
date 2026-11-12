// Kỳ của BÁO CÁO TUẦN (dùng chung server + giao diện, không import server-only).
// Như file "BÁO CÁO TUẦN TỔNG HỢP": tuần chạy CN → T7, đánh số như cột Tuần của tab FBA (WEEKNUM của Excel),
// tuần vắt qua 2 tháng thì cắt làm 2 kỳ theo tháng — vd W40 (27-30.9) và W40 (1-3.10) —
// để cột "lũy kế đến nay" luôn tính trong 1 tháng. "Tuần trước" = kỳ liền trước (có thể chỉ vài ngày).

export interface WeekSegment {
  startDate: string;
  endDate: string;
  week: number;
  /** "W46 (8-14.11)" */
  label: string;
  days: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const DAY = 86_400_000;

export function addDaysIso(date: string, n: number): string {
  return toIso(new Date(parse(date).getTime() + n * DAY));
}

/** Số ngày trong tháng của ngày / kỳ "YYYY-MM" */
export function daysInMonthOf(dateOrPeriod: string): number {
  const [y, m] = dateOrPeriod.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Số tuần như Excel WEEKNUM(date) (tuần bắt đầu CN) — khớp getExcelWeekNum của tab FBA */
export function excelWeekNum(date: string): number {
  const d = parse(date);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - yearStart) / DAY) + 1;
  return Math.floor((dayOfYear + new Date(yearStart).getUTCDay() - 1) / 7) + 1;
}

/** Kỳ báo cáo tuần chứa ngày `date` */
export function weekSegmentOf(date: string): WeekSegment {
  const d = parse(date);
  const sunday = toIso(new Date(d.getTime() - d.getUTCDay() * DAY));
  const saturday = addDaysIso(sunday, 6);
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = `${date.slice(0, 7)}-${pad(daysInMonthOf(date))}`;
  const startDate = sunday < monthStart ? monthStart : sunday;
  const endDate = saturday > monthEnd ? monthEnd : saturday;
  const s = parse(startDate);
  const e = parse(endDate);
  const days = Math.round((e.getTime() - s.getTime()) / DAY) + 1;
  const week = excelWeekNum(startDate);
  const range = startDate === endDate ? `${s.getUTCDate()}` : `${s.getUTCDate()}-${e.getUTCDate()}`;
  return { startDate, endDate, week, days, label: `W${week} (${range}.${e.getUTCMonth() + 1})` };
}

export function previousWeekSegment(seg: WeekSegment): WeekSegment {
  return weekSegmentOf(addDaysIso(seg.startDate, -1));
}

export function nextWeekSegment(seg: WeekSegment): WeekSegment {
  return weekSegmentOf(addDaysIso(seg.endDate, 1));
}

/** `count` kỳ gần nhất tính lùi từ kỳ chứa `latest` (mới nhất trước) */
export function recentWeekSegments(latest: string, count: number): WeekSegment[] {
  const out: WeekSegment[] = [];
  let seg = weekSegmentOf(latest);
  for (let i = 0; i < count; i++) {
    out.push(seg);
    seg = previousWeekSegment(seg);
  }
  return out;
}
