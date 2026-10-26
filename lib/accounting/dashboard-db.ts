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
import { storeHasTeam } from "@/lib/accounting/store-teams";
import { summarizeDays, type DashboardDay, type DashboardTotals } from "@/lib/accounting/dashboard-totals";

export type { DashboardDay, DashboardTotals };

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
  /** Ngày bắt đầu chuỗi theo tháng (1/1 của năm, hoặc sớm hơn nếu kỳ bắt đầu từ năm trước). */
  trendStartDate: string;
  /**
   * Số liệu từng ngày (cộng các store) của toàn bộ dữ liệu đã tải: kỳ hiện tại, kỳ so sánh và chuỗi theo tháng
   * (+ tháng trước đó khi so sánh), để client tóm tắt theo ngày / tuần / tháng.
   */
  days: DashboardDay[];
}

function toDay(it: FbaDailyItem): DashboardDay {
  return {
    date: it.date,
    revenue: it.revenue,
    quantity: it.quantity,
    orders: it.orders ?? 0,
    adsFee: it.ads_fee,
    basecost: it.basecost,
    amazonFee: it.amazon_fee,
    tax: it.thue,
    promotion: it.promotion,
    returnCost: it.return_cost,
    profit: it.profit,
    netProfit: it.net_profit,
    revenueAds: it.revenue_ads,
    clicks: it.clicks,
  };
}

const summarize = (items: FbaDailyItem[]): DashboardTotals => summarizeDays(items.map(toDay));

/** Cộng dồn các store theo ngày. */
function sumByDate(items: FbaDailyItem[]): DashboardDay[] {
  const map = new Map<string, DashboardDay>();
  for (const it of items) {
    const day = toDay(it);
    const existing = map.get(day.date);
    if (!existing) {
      map.set(day.date, day);
      continue;
    }
    for (const k of Object.keys(day) as (keyof DashboardDay)[]) {
      if (k !== "date") existing[k] += day[k];
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
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

// v2: FbaDailyItem có thêm trường orders
const DASHBOARD_CACHE_PREFIX = "acc:dashboard:v2:";
const DASHBOARD_CACHE_TTL_SECONDS = 300;

/** Xóa cache Dashboard (gọi sau khi nạp dữ liệu kế toán mới). */
export async function invalidateAccountingDashboardCache(): Promise<void> {
  await invalidateCachePattern(`${DASHBOARD_CACHE_PREFIX}*`);
}

// Cache theo từng store + khoảng ngày + channel để đổi lựa chọn store không phải tính lại các store khác.
function loadStoreDaily(
  storeId: string,
  startDate: string,
  endDate: string,
  channel?: "Amazon" | "Merchant" | "all",
): Promise<FbaDailyItem[]> {
  const channelKey = channel || "Amazon";
  return getCachedOrFetch(
    `${DASHBOARD_CACHE_PREFIX}${storeId}:${startDate || "all"}:${endDate || "all"}:${channelKey}`,
    DASHBOARD_CACHE_TTL_SECONDS,
    async () => {
      const res = await listFbaDaily(storeId, {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortField: "date",
        sortDirection: "asc",
        limit: 100_000,
        channel,
      });
      return res.items;
    },
  );
}

const inRange = (date: string, range: { startDate: string; endDate: string }) =>
  (!range.startDate || date >= range.startDate) && (!range.endDate || date <= range.endDate);

/**
 * Tổng hợp P&L FBA cho Dashboard: dùng đúng công thức listFbaDaily (khớp tab FBA và báo cáo Lark),
 * mỗi store chỉ 1 truy vấn bao trọn kỳ hiện tại + kỳ trước + các tháng từ đầu năm rồi cắt trong bộ nhớ.
 */
export async function getAccountingDashboard(options: {
  startDate?: string;
  endDate?: string;
  storeIds?: string[];
  compare?: DashboardCompareMode;
  /** Bỏ qua cache (nút Refresh). */
  fresh?: boolean;
  team?: string;
}): Promise<AccountingDashboardData> {
  if (options.fresh) await invalidateAccountingDashboardCache();
  const [allStores, latestDate] = await Promise.all([listStores(), getLatestAvailableAccountingDate()]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  // Chọn theo team: chỉ giữ các store thuộc team đó (vd FBA 2 = mọi store có "FBA 2" trong cột Team).
  const stores = allStores.filter(
    (s) => (!requested.size || requested.has(s.id)) && (!options.team || storeHasTeam(s.team, options.team)),
  );

  const channel: "Amazon" | "Merchant" | "all" = options.team?.toUpperCase().includes("FBM")
    ? "Merchant"
    : "Amazon";

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
      items: await loadStoreDaily(store.id, hasRange ? fetchStart : "", hasRange ? fetchEnd : "", channel),
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
    trendStartDate: periods.trendStartDate,
    days: sumByDate(allItems),
  };
}
