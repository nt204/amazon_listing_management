// Công thức tổng hợp P&L của Dashboard (thuần, dùng chung server + client).

export interface DashboardTotals {
  days: number;
  revenue: number;
  quantity: number;
  orders: number;
  adsFee: number;
  basecost: number;
  amazonFee: number;
  tax: number;
  promotion: number;
  returnCost: number;
  serviceCost: number;
  profit: number;
  netProfit: number;
  revenueAds: number;
  clicks: number;
  margin: number;
  netMargin: number;
  roi: number;
  tacos: number;
  acos: number;
}

/** Số liệu 1 ngày (đã cộng các store đang chọn). */
export interface DashboardDay {
  date: string; // YYYY-MM-DD
  revenue: number;
  quantity: number;
  orders: number;
  adsFee: number;
  basecost: number;
  amazonFee: number;
  tax: number;
  promotion: number;
  returnCost: number;
  profit: number;
  netProfit: number;
  revenueAds: number;
  clicks: number;
}

const SUM_KEYS = [
  "revenue",
  "quantity",
  "orders",
  "adsFee",
  "basecost",
  "amazonFee",
  "tax",
  "promotion",
  "returnCost",
  "profit",
  "netProfit",
  "revenueAds",
  "clicks",
] as const;

export function summarizeDays(days: DashboardDay[]): DashboardTotals {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<(typeof SUM_KEYS)[number], number>;
  const dates = new Set<string>();
  for (const d of days) {
    dates.add(d.date);
    for (const k of SUM_KEYS) t[k] += d[k] ?? 0;
  }
  return {
    ...t,
    days: dates.size,
    // net_profit = profit - chi phí dịch vụ phân bổ theo ngày (xem listFbaDaily)
    serviceCost: t.profit - t.netProfit,
    margin: t.revenue > 0 ? t.profit / t.revenue : 0,
    netMargin: t.revenue > 0 ? t.netProfit / t.revenue : 0,
    roi: t.basecost > 0 ? t.profit / t.basecost : 0,
    tacos: t.revenue > 0 ? t.adsFee / t.revenue : 0,
    acos: t.revenueAds > 0 ? t.adsFee / t.revenueAds : 0,
  };
}

/** Tổng hợp các ngày trong [startDate, endDate]. */
export function summarizeRange(days: DashboardDay[], startDate: string, endDate: string): DashboardTotals {
  return summarizeDays(days.filter((d) => d.date >= startDate && d.date <= endDate));
}
