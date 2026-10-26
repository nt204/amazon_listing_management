import "server-only";

import { getLatestAvailableAccountingDate, listStores } from "@/lib/accounting/accounting-db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { getCachedOrFetch, invalidateCachePattern } from "@/lib/redis";
import {
  addDays,
  inclusiveDayCount,
  monthlyCompareShift,
  resolveDashboardPeriods,
  shiftMonths,
  type DashboardCompareMode,
} from "@/lib/accounting/dashboard-periods";

export interface DashboardTotals {
  days: number;
  revenue: number;
  quantity: number;
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

export interface DashboardSeriesPoint {
  key: string; // YYYY-MM-DD (ngày) hoặc YYYY-MM (tháng)
  revenue: number;
  profit: number;
  netProfit: number;
  adsFee: number;
  quantity: number;
  /** Điểm tương ứng của kỳ so sánh (ngày thứ i của kỳ trước / cùng tháng năm trước…). */
  compare?: DashboardSeriesPoint | null;
}

export interface DashboardStoreRow {
  storeId: string;
  storeName: string;
  marketplace: string;
  current: DashboardTotals;
  previous: DashboardTotals | null;
}

export interface AccountingDashboardData {
  latestDate: string;
  period: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string } | null;
  stores: { id: string; name: string; marketplace: string }[];
  current: DashboardTotals;
  previous: DashboardTotals | null;
  daily: DashboardSeriesPoint[];
  monthly: DashboardSeriesPoint[];
  /** Số tháng lùi của chuỗi so sánh theo tháng (0 = không có). */
  monthlyCompareShift: number;
  byStore: DashboardStoreRow[];
}

function summarize(items: FbaDailyItem[]): DashboardTotals {
  const t = {
    revenue: 0,
    quantity: 0,
    adsFee: 0,
    basecost: 0,
    amazonFee: 0,
    tax: 0,
    promotion: 0,
    returnCost: 0,
    profit: 0,
    netProfit: 0,
    revenueAds: 0,
    clicks: 0,
  };
  const days = new Set<string>();
  for (const it of items) {
    days.add(it.date);
    t.revenue += it.revenue;
    t.quantity += it.quantity;
    t.adsFee += it.ads_fee;
    t.basecost += it.basecost;
    t.amazonFee += it.amazon_fee;
    t.tax += it.thue;
    t.promotion += it.promotion;
    t.returnCost += it.return_cost;
    t.profit += it.profit;
    t.netProfit += it.net_profit;
    t.revenueAds += it.revenue_ads;
    t.clicks += it.clicks;
  }
  return {
    ...t,
    days: days.size,
    // net_profit = profit - chi phí dịch vụ phân bổ theo ngày (xem listFbaDaily)
    serviceCost: t.profit - t.netProfit,
    margin: t.revenue > 0 ? t.profit / t.revenue : 0,
    netMargin: t.revenue > 0 ? t.netProfit / t.revenue : 0,
    roi: t.basecost > 0 ? t.profit / t.basecost : 0,
    tacos: t.revenue > 0 ? t.adsFee / t.revenue : 0,
    acos: t.revenueAds > 0 ? t.adsFee / t.revenueAds : 0,
  };
}

function bucket(items: FbaDailyItem[], keyOf: (date: string) => string): DashboardSeriesPoint[] {
  const map = new Map<string, DashboardSeriesPoint>();
  for (const it of items) {
    const key = keyOf(it.date);
    const point = map.get(key) ?? { key, revenue: 0, profit: 0, netProfit: 0, adsFee: 0, quantity: 0 };
    point.revenue += it.revenue;
    point.profit += it.profit;
    point.netProfit += it.net_profit;
    point.adsFee += it.ads_fee;
    point.quantity += it.quantity;
    map.set(key, point);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const emptyPoint = (key: string): DashboardSeriesPoint => ({
  key,
  revenue: 0,
  profit: 0,
  netProfit: 0,
  adsFee: 0,
  quantity: 0,
});

const DASHBOARD_CACHE_PREFIX = "acc:dashboard:v1:";
const DASHBOARD_CACHE_TTL_SECONDS = 300;

/** Xóa cache Dashboard (gọi sau khi nạp dữ liệu kế toán mới). */
export async function invalidateAccountingDashboardCache(): Promise<void> {
  await invalidateCachePattern(`${DASHBOARD_CACHE_PREFIX}*`);
}

// Cache theo từng store + khoảng ngày để đổi lựa chọn store không phải tính lại các store khác.
function loadStoreDaily(storeId: string, startDate: string, endDate: string): Promise<FbaDailyItem[]> {
  return getCachedOrFetch(
    `${DASHBOARD_CACHE_PREFIX}${storeId}:${startDate || "all"}:${endDate || "all"}`,
    DASHBOARD_CACHE_TTL_SECONDS,
    async () => {
      const res = await listFbaDaily(storeId, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortField: "date",
        sortDirection: "asc",
        limit: 100_000,
      });
      return res.items;
    },
  );
}

const inRange = (date: string, range: { startDate: string; endDate: string }) =>
  (!range.startDate || date >= range.startDate) && (!range.endDate || date <= range.endDate);

/**
 * Tổng hợp P&L FBA cho Dashboard: dùng đúng công thức listFbaDaily (khớp tab FBA và báo cáo Lark),
 * mỗi store chỉ 1 truy vấn bao trọn kỳ hiện tại + kỳ trước + 6 tháng xu hướng rồi cắt trong bộ nhớ.
 */
export async function getAccountingDashboard(options: {
  startDate?: string;
  endDate?: string;
  storeIds?: string[];
  compare?: DashboardCompareMode;
  /** Bỏ qua cache (nút Refresh). */
  fresh?: boolean;
}): Promise<AccountingDashboardData> {
  if (options.fresh) await invalidateAccountingDashboardCache();
  const [allStores, latestDate] = await Promise.all([listStores(), getLatestAvailableAccountingDate()]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  const stores = requested.size ? allStores.filter((s) => requested.has(s.id)) : allStores;

  const periods = resolveDashboardPeriods(
    options.startDate ?? "",
    options.endDate ?? "",
    latestDate,
    options.compare,
  );
  const monthShift = periods.trendStartDate ? monthlyCompareShift(options.compare ?? "prev") : 0;
  const compareTrend = monthShift
    ? { startDate: shiftMonths(periods.trendStartDate, -monthShift), endDate: shiftMonths(periods.current.endDate, -monthShift) }
    : null;
  const fetchStart = [periods.previous?.startDate, periods.trendStartDate, periods.current.startDate, compareTrend?.startDate]
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const fetchEnd = periods.current.endDate;

  const hasRange = Boolean(fetchStart && fetchEnd);
  const perStore = await Promise.all(
    stores.map(async (store) => ({
      store,
      items: await loadStoreDaily(store.id, hasRange ? fetchStart : "", hasRange ? fetchEnd : ""),
    })),
  );

  const allItems = perStore.flatMap((s) => s.items);
  const currentItems = allItems.filter((it) => inRange(it.date, periods.current));
  const previousItems = periods.previous ? allItems.filter((it) => inRange(it.date, periods.previous!)) : [];
  const trendItems = allItems.filter((it) => !periods.trendStartDate || it.date >= periods.trendStartDate);

  // Ghép điểm kỳ so sánh: ngày thứ i của kỳ hiện tại ↔ ngày thứ i của kỳ trước.
  const previousByDate = new Map(bucket(previousItems, (d) => d).map((p) => [p.key, p]));
  const daily = bucket(currentItems, (d) => d).map((p) => {
    if (!periods.previous) return p;
    const cmpDate = addDays(periods.previous.startDate, inclusiveDayCount(periods.current.startDate, p.key) - 1);
    const compare = cmpDate <= periods.previous.endDate ? previousByDate.get(cmpDate) ?? emptyPoint(cmpDate) : null;
    return { ...p, compare };
  });

  // Theo tháng: so với cùng tháng năm trước / tháng liền trước (tháng cuối kẹp cùng số ngày).
  const compareMonths = compareTrend
    ? new Map(bucket(allItems.filter((it) => inRange(it.date, compareTrend)), (d) => d.slice(0, 7)).map((p) => [p.key, p]))
    : null;
  const monthly = bucket(trendItems, (d) => d.slice(0, 7)).map((p) => {
    if (!compareMonths) return p;
    const cmpKey = shiftMonths(`${p.key}-01`, -monthShift).slice(0, 7);
    return { ...p, compare: compareMonths.get(cmpKey) ?? emptyPoint(cmpKey) };
  });

  return {
    latestDate,
    period: periods.current,
    previousPeriod: periods.previous,
    stores: stores.map((s) => ({ id: s.id, name: s.name, marketplace: s.marketplace })),
    current: summarize(currentItems),
    previous: periods.previous ? summarize(previousItems) : null,
    daily,
    monthly,
    monthlyCompareShift: monthShift,
    byStore: perStore.map(({ store, items }) => ({
      storeId: store.id,
      storeName: store.name,
      marketplace: store.marketplace,
      current: summarize(items.filter((it) => inRange(it.date, periods.current))),
      previous: periods.previous ? summarize(items.filter((it) => inRange(it.date, periods.previous!))) : null,
    })),
  };
}
