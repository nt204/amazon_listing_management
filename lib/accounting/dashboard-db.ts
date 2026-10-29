import "server-only";

import { getLatestAvailableAccountingDate, listStores } from "@/lib/accounting/accounting-db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { getCachedOrFetch, invalidateCachePattern } from "@/lib/redis";
import { getDatabaseClient } from "@/lib/db";
import {
  addDays,
  inclusiveDayCount,
  monthlyCompareShift,
  resolveDashboardPeriods,
  shiftMonths,
  type DashboardCompareMode,
} from "@/lib/accounting/dashboard-periods";
import { listFbmDaily, listFbmSkuFixed } from "@/lib/accounting/fbm-financials-db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";
import { storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";
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

export interface TopProductItem {
  storeId: string;
  storeName: string;
  channel: "FBA" | "FBM";
  sku: string;
  asin: string | null;
  productName: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
  /** Profit như tab SKU WIN / LỌC SKU CỐ ĐỊNH FBM (chưa trừ phí dịch vụ cố định). */
  profit: number;
  margin: number;
  acos: number;
  tacos: number;
}

export interface DashboardTopProducts {
  period: { startDate: string; endDate: string };
  profit: TopProductItem[];
  revenue: TopProductItem[];
  loss: TopProductItem[];
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
// Key cache chứa phiên bản dữ liệu (migration 123) nên mọi lệnh ghi đều làm cache cũ hết hiệu lực -> giữ lâu được.
const DASHBOARD_CACHE_TTL_SECONDS = 3600;
// DB chưa chạy migration 123: không biết dữ liệu đổi lúc nào nên chỉ giữ ngắn như trước.
const DASHBOARD_CACHE_FALLBACK_TTL_SECONDS = 300;

interface DashboardCacheScope {
  prefix: string;
  ttl: number;
}

async function getDashboardCacheScope(): Promise<DashboardCacheScope> {
  try {
    const sql = await getDatabaseClient();
    const rows = await sql<{ last_value: string }[]>`SELECT last_value::text FROM accounting_dashboard_data_version`;
    return { prefix: `${DASHBOARD_CACHE_PREFIX}d${rows[0].last_value}:`, ttl: DASHBOARD_CACHE_TTL_SECONDS };
  } catch {
    return { prefix: DASHBOARD_CACHE_PREFIX, ttl: DASHBOARD_CACHE_FALLBACK_TTL_SECONDS };
  }
}

/** Xóa cache Dashboard (gọi sau khi nạp dữ liệu kế toán mới). */
export async function invalidateAccountingDashboardCache(): Promise<void> {
  await invalidateCachePattern(`${DASHBOARD_CACHE_PREFIX}*`);
}

type DashboardChannel = "Amazon" | "Merchant";

/**
 * Kênh tính cho 1 store theo cột Team của store:
 *   chọn team → team FBM chỉ lấy FBM, team FBA chỉ lấy FBA;
 *   không chọn team → cộng mọi kênh store đang chạy (team FBA… → FBA, team FBM → FBM).
 */
function storeChannels(storeTeam: string | null | undefined, selectedTeam?: string): DashboardChannel[] {
  if (selectedTeam) return /^fbm$/i.test(selectedTeam.trim()) ? ["Merchant"] : ["Amazon"];
  const channels: DashboardChannel[] = [];
  if (storeHasFbaTeam(storeTeam)) channels.push("Amazon");
  if (storeHasTeam(storeTeam, "FBM")) channels.push("Merchant");
  return channels.length ? channels : ["Amazon"];
}

// Cache theo từng store + khoảng ngày + channel để đổi lựa chọn store không phải tính lại các store khác.
// FBM dùng công thức tab FBM (listFbmDaily, khớp workbook "FBM - <STORE>"), FBA dùng listFbaDaily.
function loadStoreDaily(
  cache: DashboardCacheScope,
  storeId: string,
  startDate: string,
  endDate: string,
  channel: DashboardChannel,
): Promise<FbaDailyItem[]> {
  return getCachedOrFetch(
    `${cache.prefix}${storeId}:${startDate || "all"}:${endDate || "all"}:${channel === "Merchant" ? "fbm" : "Amazon"}`,
    cache.ttl,
    async () => {
      const options = {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        sortField: "date",
        sortDirection: "asc" as const,
        limit: 100_000,
      };
      const res = channel === "Merchant"
        ? await listFbmDaily(storeId, options)
        : await listFbaDaily(storeId, { ...options, channel });
      return res.items;
    },
  );
}

const inRange = (date: string, range: { startDate: string; endDate: string }) =>
  (!range.startDate || date >= range.startDate) && (!range.endDate || date <= range.endDate);

/**
 * Tổng hợp P&L cho Dashboard: FBA dùng đúng công thức listFbaDaily (khớp tab FBA và báo cáo Lark),
 * FBM dùng listFbmDaily (khớp tab FBM); kênh của từng store lấy theo cột Team (xem storeChannels),
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
  const [allStores, latestDate, cache] = await Promise.all([
    listStores(),
    getLatestAvailableAccountingDate(),
    getDashboardCacheScope(),
  ]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  // Chọn theo team: chỉ giữ các store thuộc team đó (vd FBA 2 = mọi store có "FBA 2" trong cột Team).
  const stores = allStores.filter(
    (s) => (!requested.size || requested.has(s.id)) && (!options.team || storeHasTeam(s.team, options.team)),
  );

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
      // Store chạy cả FBA và FBM: ghép dòng ngày của 2 kênh (các phép tổng hợp đều cộng theo dòng).
      items: (
        await Promise.all(
          storeChannels(store.team, options.team).map((channel) =>
            loadStoreDaily(cache, store.id, hasRange ? fetchStart : "", hasRange ? fetchEnd : "", channel),
          ),
        )
      ).flat(),
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

// ----------------- TOP SẢN PHẨM -----------------

const TOP_PRODUCTS_LIMIT = 5;

/** Số liệu 1 SKU của 1 store trong kỳ (chỉ giữ các trường Top cần để cache gọn). */
interface SkuPerformance {
  sku: string;
  asin: string | null;
  imageUrl: string | null;
  units: number;
  revenue: number;
  profit: number;
  adsFee: number;
  revenueAds: number;
}

// Dùng đúng công thức tab SKU WIN (FBA) / LỌC SKU CỐ ĐỊNH (FBM). Cache theo store + kênh + kỳ:
// đổi cụm store / team chỉ phải tính các store chưa có trong cache rồi xếp hạng lại trong bộ nhớ.
function loadStoreSkuPerformance(
  cache: DashboardCacheScope,
  storeId: string,
  startDate: string,
  endDate: string,
  channel: DashboardChannel,
): Promise<SkuPerformance[]> {
  return getCachedOrFetch(
    `${cache.prefix}sku2:${storeId}:${startDate}:${endDate}:${channel === "Merchant" ? "fbm" : "fba"}`,
    cache.ttl,
    async () => {
      const options = { status: "all", startDate, endDate, limit: 100_000 };
      const [res, nonFbaSkus] = await Promise.all([
        channel === "Merchant" ? listFbmSkuFixed(storeId, options) : listSkuWin(storeId, options),
        channel === "Merchant" ? Promise.resolve(new Set<string>()) : loadNonFbaSkus(storeId),
      ]);
      return res.items
        .filter((i) => !nonFbaSkus.has(i.sku))
        .filter((i) => i.quantity > 0 || i.revenue !== 0 || i.ads_fee > 0)
        .map((i) => ({
          sku: i.sku,
          asin: i.asin,
          imageUrl: i.mockup_url || i.mockup || null,
          units: i.quantity,
          revenue: i.revenue,
          profit: i.profit,
          adsFee: i.ads_fee,
          revenueAds: i.revenue_ads,
        }));
    },
  );
}

/**
 * SKU trong bảng mã FBA nhưng Loại khác FBA (vd bảng mã cũ lẫn dòng FBM): SKU WIN vẫn gán Ads theo portfolio cho
 * các SKU này nên chúng hiện thành "FBA" lỗ toàn tiền Ads — Top bỏ qua, FBM đã có ở kênh Merchant.
 */
async function loadNonFbaSkus(storeId: string): Promise<Set<string>> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ sku: string }[]>`
    SELECT DISTINCT sku FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
      AND UPPER(TRIM(COALESCE(loai, 'FBA'))) NOT IN ('FBA', '')
  `;
  return new Set(rows.map((r) => r.sku));
}

/** Tên sản phẩm (product-name của đơn gần nhất trong kỳ) cho các SKU lọt Top. */
async function loadProductNames(items: TopProductItem[], startDate: string, endDate: string) {
  if (!items.length) return new Map<string, string>();
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_id: string; sku: string; product_name: string }[]>`
    SELECT DISTINCT ON (store_id, sku) store_id::text, sku, product_name
    FROM accounting_orders
    WHERE store_id IN ${sql([...new Set(items.map((i) => i.storeId))])}
      AND sku IN ${sql([...new Set(items.map((i) => i.sku))])}
      AND date >= ${startDate}::date AND date <= ${endDate}::date
      AND COALESCE(product_name, '') <> ''
    ORDER BY store_id, sku, date DESC
  `;
  return new Map(rows.map((r) => [`${r.store_id}|${r.sku}`, r.product_name]));
}

/**
 * Top sản phẩm của Dashboard (kỳ hiện tại): top Profit, top Revenue, top Loss (profit âm thấp nhất).
 * Cùng bộ lọc store / team và cùng quy tắc kênh theo Team với getAccountingDashboard.
 * Tách khỏi getAccountingDashboard để phần tổng quan hiện ngay, bảng Top tải sau.
 */
export async function getDashboardTopProducts(options: {
  startDate?: string;
  endDate?: string;
  storeIds?: string[];
  team?: string;
}): Promise<DashboardTopProducts> {
  const [allStores, latestDate, cache] = await Promise.all([
    listStores(),
    getLatestAvailableAccountingDate(),
    getDashboardCacheScope(),
  ]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  const stores = allStores.filter(
    (s) => (!requested.size || requested.has(s.id)) && (!options.team || storeHasTeam(s.team, options.team)),
  );
  const period = resolveDashboardPeriods(options.startDate ?? "", options.endDate ?? "", latestDate, "none").current;
  if (!period.startDate || !period.endDate || !stores.length) return { period, profit: [], revenue: [], loss: [] };

  const rows = (
    await Promise.all(
      stores.flatMap((store) =>
        storeChannels(store.team, options.team).map(async (channel) =>
          (await loadStoreSkuPerformance(cache, store.id, period.startDate, period.endDate, channel)).map(
            (r): TopProductItem => ({
              storeId: store.id,
              storeName: store.name,
              channel: channel === "Merchant" ? "FBM" : "FBA",
              sku: r.sku,
              asin: r.asin,
              productName: "",
              imageUrl: r.imageUrl,
              units: r.units,
              revenue: r.revenue,
              profit: r.profit,
              margin: r.revenue > 0 ? r.profit / r.revenue : 0,
              acos: r.revenueAds > 0 ? r.adsFee / r.revenueAds : 0,
              tacos: r.revenue > 0 ? r.adsFee / r.revenue : 0,
            }),
          ),
        ),
      ),
    )
  ).flat();

  const top = (filter: (i: TopProductItem) => boolean, compare: (a: TopProductItem, b: TopProductItem) => number) =>
    rows.filter(filter).sort(compare).slice(0, TOP_PRODUCTS_LIMIT);
  const lists = {
    profit: top((i) => i.profit > 0, (a, b) => b.profit - a.profit),
    revenue: top((i) => i.revenue > 0, (a, b) => b.revenue - a.revenue),
    loss: top((i) => i.profit < 0, (a, b) => a.profit - b.profit),
  };

  const names = await loadProductNames([...lists.profit, ...lists.revenue, ...lists.loss], period.startDate, period.endDate);
  const withName = (i: TopProductItem) => ({ ...i, productName: names.get(`${i.storeId}|${i.sku}`) || i.sku });
  return {
    period,
    profit: lists.profit.map(withName),
    revenue: lists.revenue.map(withName),
    loss: lists.loss.map(withName),
  };
}
