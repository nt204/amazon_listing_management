// Thanh tiến độ KPI trên trang Overview (dùng chung server + giao diện, không import server-only).
// Chỉ so KPI khi kỳ đang chọn là 1 tuần hoặc 1 tháng:
//   - tuần (CN → T7, như bộ chọn ngày): mục tiêu = KPI tháng ÷ số ngày trong tháng × 7
//     (tuần nằm vắt 2 tháng thì mỗi ngày lấy theo KPI tháng của ngày đó);
//   - tháng: mục tiêu = KPI tháng.
// Đánh giá như sheet BÁO CÁO TUẦN: ≥ 100% đạt, ≥ 85% sát nhịp, còn lại dưới nhịp.

export type KpiWindowKind = "week" | "month";

export interface KpiWindow {
  kind: KpiWindowKind;
  /** Khung đầy đủ của tuần / tháng (kể cả khi đang xem tới hôm nay) */
  startDate: string;
  endDate: string;
}

export interface KpiProgressTotals {
  revenue: number;
  quantity: number;
  profit: number;
}

export type KpiProgressMetric = keyof KpiProgressTotals;

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const daysInMonth = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Kỳ đang chọn có phải 1 tuần / 1 tháng không → khung để tính mục tiêu; không phải thì null (không hiện thanh).
 * unit: đơn vị kỳ của trang Overview (dashboardRangeUnit).
 */
export function kpiWindowOf(startDate: string, endDate: string, unit: string): KpiWindow | null {
  if (!startDate || !endDate || endDate < startDate) return null;
  if (unit === "week") {
    const s = parse(startDate);
    const weekStart = new Date(s.getTime() - s.getUTCDay() * 86_400_000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
    if (endDate > toIso(weekEnd)) return null;
    return { kind: "week", startDate: toIso(weekStart), endDate: toIso(weekEnd) };
  }
  if (unit === "month") {
    if (!startDate.endsWith("-01") || startDate.slice(0, 7) !== endDate.slice(0, 7)) return null;
    const period = startDate.slice(0, 7);
    return { kind: "month", startDate, endDate: `${period}-${pad(daysInMonth(period))}` };
  }
  return null;
}

/** Tỷ trọng KPI từng tháng trong khung: { "2026-11": 7/30 } (tuần) hoặc { "2026-11": 1 } (tháng) */
export function kpiWindowWeights(window: KpiWindow): Map<string, number> {
  const out = new Map<string, number>();
  for (let d = parse(window.startDate); toIso(d) <= window.endDate; d = new Date(d.getTime() + 86_400_000)) {
    const period = toIso(d).slice(0, 7);
    out.set(period, (out.get(period) ?? 0) + 1 / daysInMonth(period));
  }
  return out;
}

/** Mức đánh giá như sheet BÁO CÁO TUẦN */
export function kpiTone(ratio: number | null): "good" | "near" | "bad" | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return ratio >= 1 ? "good" : ratio >= 0.85 ? "near" : "bad";
}

/** % đạt = thực tế ÷ mục tiêu; mục tiêu ≤ 0 (profit âm) thì so theo hiệu số để không đảo dấu */
export function kpiRatio(actual: number, target: number | null | undefined): number | null {
  if (target == null || !Number.isFinite(target) || target === 0) return null;
  if (target > 0) return actual / target;
  return 1 + (actual - target) / Math.abs(target);
}

export function addProgressTotals(a: KpiProgressTotals | null, b: KpiProgressTotals | null | undefined): KpiProgressTotals | null {
  if (!b) return a;
  if (!a) return { ...b };
  return { revenue: a.revenue + b.revenue, quantity: a.quantity + b.quantity, profit: a.profit + b.profit };
}
