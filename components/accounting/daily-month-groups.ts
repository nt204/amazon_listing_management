// Bố cục tab FBA / FBM theo ngày như file kế toán ("FBA - <STORE> - KẾ TOÁN TỔNG HỢP", tab FBA / FBM):
//   THÁNG n → [các ngày → Service Fees → Phí chủ store] → dòng tổng tháng (bỏ dòng TB/Quantity của sheet)
//   Phần trong [] là nhóm hàng của sheet: tháng đã qua thu gọn, chỉ còn tiêu đề + tổng + TB/Quantity.
// - Dòng "Service Fees" (chỉ FBA): FEE = tổng Service Fees của tháng − Cost of Advertising (Ads đã nằm ở cột Ads Fee).
// - Dòng "Phí chủ store" (FBA + FBM, từ tháng 9/2026): −(Revenue tháng × 0.5% nếu Revenue > $20,000, ngược lại 1.000.000đ ÷ 25.000).
// - Tổng tháng: Profit = Σ Profit ngày + FEE + Phí chủ store; Net Profit = Σ Net Profit ngày + FEE + Phí chủ store
//   (sheet: K tổng = SUM(K ngày..K phí) + L phí, L tổng = SUM(L ngày..L phí) + K phí).
// - Tổng tháng: cộng các cột tiền / SL, các tỷ lệ tính lại trên tổng (ROI = Profit ÷ Base Cost, TACoS = Ads ÷ Revenue,
//   ACoS = Ads ÷ Revenue ads, % Profit = Profit ÷ Revenue, % Profit trước ADS = (Revenue − Base Cost − AMZ Fee) ÷ Revenue).
// - TB/Quantity: từng cột tiền của dòng tổng ÷ Quantity tháng.
// Khối bên phải sheet: Tổng theo tuần (Revenue, SL, Profit, TB Revenue/sl, TB Profit/sl) và Profit từng tháng + Tăng trưởng.

export interface DailyLike {
  id: string;
  date: string;
  week: string;
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  profit: number;
  net_profit?: number;
  balance: number;
  revenue_ads: number;
  quantity_ads: number;
  clicks: number;
}

export interface MonthFee {
  month: string;
  total: number;
  storage: number;
  longTermStorage: number;
  inboundPlacement: number;
  advertising: number;
  other: number;
  fee: number;
}

/** Phí chủ store áp dụng từ tháng này (file kế toán thêm dòng "Phí chủ store" từ tháng 9/2026) */
export const OWNER_FEE_FROM = "2026-09";
const OWNER_FEE_RATE = 0.005;
const OWNER_FEE_THRESHOLD = 20_000;
/** Tối thiểu 1.000.000đ ÷ tỷ giá 25.000 (ô AE1 của sheet) */
const OWNER_FEE_MIN = 1_000_000 / 25_000;

/** Phí chủ store của tháng (số âm); null = tháng chưa áp dụng */
export function ownerFeeOf(month: string, revenue: number): number | null {
  if (month < OWNER_FEE_FROM) return null;
  return -(revenue > OWNER_FEE_THRESHOLD ? revenue * OWNER_FEE_RATE : OWNER_FEE_MIN);
}

export interface MonthAgg {
  month: string;
  days: number;
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  /** Profit cộng các ngày (chưa trừ Service Fees) */
  dayProfit: number;
  /** Dòng Service Fees của tháng (số âm); null = kênh không có (FBM) */
  fee: number | null;
  /** Dòng Phí chủ store (số âm); null = tháng chưa áp dụng */
  ownerFee: number | null;
  /** Profit của dòng tổng tháng = dayProfit + fee + ownerFee */
  profit: number;
  /** Net Profit tổng tháng = Σ Net Profit ngày + fee + ownerFee; null = kênh / store chưa có Net Profit */
  net_profit: number | null;
  balance: number;
  revenue_ads: number;
  quantity_ads: number;
  clicks: number;
}

export type DailyRow<T extends DailyLike> =
  | { kind: "month"; key: string; month: string }
  | { kind: "day"; key: string; item: T; index: number }
  | { kind: "fee"; key: string; month: string; label: string; amount: number; hint: string }
  | { kind: "total"; key: string; agg: MonthAgg }
  | { kind: "avg"; key: string; agg: MonthAgg };

/** "2026-01" → "THÁNG 1/2026" */
export const monthLabel = (month: string) => `THÁNG ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

function aggregate(month: string, days: DailyLike[], fee: number | null): MonthAgg {
  const a: MonthAgg = {
    month,
    days: days.length,
    revenue: 0,
    quantity: 0,
    ads_fee: 0,
    basecost: 0,
    amazon_fee: 0,
    thue: 0,
    promotion: 0,
    return_cost: 0,
    dayProfit: 0,
    fee,
    ownerFee: null,
    profit: 0,
    net_profit: null,
    balance: 0,
    revenue_ads: 0,
    quantity_ads: 0,
    clicks: 0,
  };
  for (const d of days) {
    a.revenue += d.revenue || 0;
    a.quantity += d.quantity || 0;
    a.ads_fee += d.ads_fee || 0;
    a.basecost += d.basecost || 0;
    a.amazon_fee += d.amazon_fee || 0;
    a.thue += d.thue || 0;
    a.promotion += d.promotion || 0;
    a.return_cost += d.return_cost || 0;
    a.dayProfit += d.profit || 0;
    if (d.net_profit != null) a.net_profit = (a.net_profit ?? 0) + d.net_profit;
    a.balance += d.balance || 0;
    a.revenue_ads += d.revenue_ads || 0;
    a.quantity_ads += d.quantity_ads || 0;
    a.clicks += d.clicks || 0;
  }
  a.ownerFee = ownerFeeOf(month, a.revenue);
  const fees = (fee ?? 0) + (a.ownerFee ?? 0);
  a.profit = a.dayProfit + fees;
  if (a.net_profit != null) a.net_profit += fees;
  return a;
}

/** Tổng từng tháng (theo thứ tháng tăng dần). withFee = kênh FBA (có dòng Service Fees). */
export function monthAggregates(items: DailyLike[], fees: MonthFee[], withFee: boolean): MonthAgg[] {
  const feeBy = new Map(fees.map((f) => [f.month, f.fee]));
  const byMonth = new Map<string, DailyLike[]>();
  for (const it of items) {
    const m = it.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(it);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, days]) => aggregate(m, days, withFee ? feeBy.get(m) ?? 0 : null));
}

/**
 * Dòng hiển thị: giữ thứ tự ngày đang sắp xếp (tăng / giảm), chèn tiêu đề + dòng tổng của từng tháng.
 * Tháng thu gọn (isCollapsed) bỏ các ngày và dòng phí, chỉ còn tiêu đề + tổng + TB/Quantity như nhóm hàng đóng của sheet.
 */
export function buildMonthRows<T extends DailyLike>(
  items: T[],
  aggs: MonthAgg[],
  isCollapsed: (month: string) => boolean = () => false,
): DailyRow<T>[] {
  const aggBy = new Map(aggs.map((a) => [a.month, a]));
  const rows: DailyRow<T>[] = [];
  let current: string | null = null;
  const closeMonth = (m: string) => {
    const agg = aggBy.get(m);
    if (!agg) return;
    if (!isCollapsed(m)) {
      if (agg.fee != null)
        rows.push({
          kind: "fee",
          key: `fee-${m}`,
          month: m,
          label: "Service Fees",
          amount: agg.fee,
          hint: "Tổng Service Fees của tháng trừ Cost of Advertising (Ads đã nằm ở cột Ads Fee)",
        });
      if (agg.ownerFee != null)
        rows.push({
          kind: "fee",
          key: `owner-${m}`,
          month: m,
          label: "Phí chủ store",
          amount: agg.ownerFee,
          hint: "Revenue tháng × 0.5% nếu Revenue > $20,000, ngược lại 1.000.000đ ÷ 25.000 = $40",
        });
    }
    rows.push({ kind: "total", key: `total-${m}`, agg });
  };
  items.forEach((item, index) => {
    const m = item.date.slice(0, 7);
    if (m !== current) {
      if (current) closeMonth(current);
      current = m;
      rows.push({ kind: "month", key: `month-${m}`, month: m });
    }
    if (!isCollapsed(m)) rows.push({ kind: "day", key: item.id, item, index });
  });
  if (current) closeMonth(current);
  return rows;
}

export interface WeekSummary {
  key: string;
  week: string;
  startDate: string;
  endDate: string;
  revenue: number;
  quantity: number;
  profit: number;
}

/** Tổng theo tuần (WEEKNUM, CN → T7) — khối "Tuần / Tổng Revenue / Tổng SL / Tổng profit" của sheet */
export function weekSummaries(items: DailyLike[]): WeekSummary[] {
  const by = new Map<string, WeekSummary>();
  for (const it of items) {
    const key = `${it.date.slice(0, 4)}-${it.week}`;
    const w =
      by.get(key) ?? { key, week: it.week, startDate: it.date, endDate: it.date, revenue: 0, quantity: 0, profit: 0 };
    w.revenue += it.revenue || 0;
    w.quantity += it.quantity || 0;
    w.profit += it.profit || 0;
    if (it.date < w.startDate) w.startDate = it.date;
    if (it.date > w.endDate) w.endDate = it.date;
    by.set(key, w);
  }
  return [...by.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Tăng trưởng như sheet: (này − trước) ÷ |trước| */
export const growthOf = (cur: number, prev: number | null | undefined) =>
  prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev);
