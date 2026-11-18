// Tab "Plan" của KPI kinh doanh — dùng chung client / server.
// Kỳ I = T1–T6, Kỳ II = T7–T12 (như file "THEO DÕI KẾ HOẠCH CÁC STORE").

export const PLAN_KEYS = [
  "revenue",
  "quantity",
  "ads_fee",
  "basecost",
  "amazon_fee",
  "ads_tax",
  "tncn_tax",
  "ref_tax",
  "return_amount",
  "storage_fee",
  "profit",
] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PlanMetrics = Record<PlanKey, number>;

export type PlanHalf = 1 | 2;

/** Dòng của bảng — đúng thứ tự khối kỳ trong sheet (TACOS sau Amazon fee, ROI / MARGIN cuối). */
export const PLAN_ROWS: { key: PlanKey | "tacos" | "roi" | "margin"; label: string; kind: "usd" | "int" | "pct"; strong?: boolean }[] = [
  { key: "revenue", label: "Revenue", kind: "usd", strong: true },
  { key: "quantity", label: "Quantity", kind: "int" },
  { key: "ads_fee", label: "Ads Fee", kind: "usd" },
  { key: "basecost", label: "Basecost", kind: "usd" },
  { key: "amazon_fee", label: "Amazon fee", kind: "usd" },
  { key: "tacos", label: "TACOS", kind: "pct" },
  { key: "ads_tax", label: "Ads tax 10% Ads", kind: "usd" },
  { key: "tncn_tax", label: "TNCN tax 1% Rev", kind: "usd" },
  { key: "ref_tax", label: "10% Ref tax", kind: "usd" },
  { key: "return_amount", label: "Return (2%)", kind: "usd" },
  { key: "storage_fee", label: "Lưu kho", kind: "usd" },
  { key: "profit", label: "Profit", kind: "usd", strong: true },
  { key: "roi", label: "ROI", kind: "pct" },
  { key: "margin", label: "MARGIN", kind: "pct" },
];

export function halfOf(period: string): { year: number; half: PlanHalf } {
  const [y, m] = period.split("-").map(Number);
  return { year: y, half: m <= 6 ? 1 : 2 };
}

export function halfMonths(year: number, half: PlanHalf): string[] {
  const start = half === 1 ? 1 : 7;
  return Array.from({ length: 6 }, (_, i) => `${year}-${String(start + i).padStart(2, "0")}`);
}

export const halfLabel = (year: number, half: PlanHalf) => `Kỳ ${half === 1 ? "I" : "II"} - ${year}`;

export function emptyPlan(): PlanMetrics {
  return Object.fromEntries(PLAN_KEYS.map((k) => [k, 0])) as PlanMetrics;
}

export function sumPlans(list: (PlanMetrics | null | undefined)[]): PlanMetrics | null {
  const present = list.filter((x): x is PlanMetrics => !!x);
  if (!present.length) return null;
  const out = emptyPlan();
  for (const m of present) for (const k of PLAN_KEYS) out[k] += m[k] ?? 0;
  return out;
}

const div = (a: number, b: number) => (b ? a / b : null);

/** Giá trị 1 dòng của bảng (tỷ lệ tính lại từ số tiền: TACOS = Ads ÷ Rev, ROI = Profit ÷ Basecost, Margin = Profit ÷ Rev). */
export function planRowValue(m: PlanMetrics | null, key: (typeof PLAN_ROWS)[number]["key"]): number | null {
  if (!m) return null;
  if (key === "tacos") return div(m.ads_fee, m.revenue);
  if (key === "roi") return div(m.profit, m.basecost);
  if (key === "margin") return div(m.profit, m.revenue);
  return m[key];
}

export interface PlanMonth {
  period: string;
  plan: PlanMetrics | null;
  result: PlanMetrics | null;
  /** closed = số chốt sổ tháng; live = tính từ dữ liệu ngày (chưa chốt sổ); running = tháng đang chạy (tạm tính tới hôm nay);
   *  sheet = cột Result nạp từ sheet (hệ thống không có dữ liệu tháng đó) */
  resultSource: "closed" | "live" | "running" | "sheet" | null;
}

export interface StorePlanData {
  storeId: string;
  year: number;
  half: PlanHalf;
  months: PlanMonth[];
  source: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}
