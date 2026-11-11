import "server-only";

import { getLatestAvailableAccountingDate, listStores } from "@/lib/accounting/accounting-db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import {
  DASHBOARD_CACHE_PREFIX,
  RECENT_DAYS,
  getDashboardCacheScope,
  invalidateAccountingDashboardCache,
  recentStamp,
  stampedParts,
  stampedValue,
  type DashboardCacheScope,
} from "@/lib/accounting/dashboard-cache";
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
import { skuStockValueJoins, skuStockValueSelect } from "@/lib/accounting/inventory-db";

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

export interface DashboardStoreChannelRow {
  channel: "FBA" | "FBM";
  current: DashboardTotals;
  previous: DashboardTotals | null;
  /** Giá trị tồn hiện tại (Bảng mã FBA, Tồn × Giá TB năm); FBM không có tồn → null. */
  stockValue?: number | null;
}

export interface DashboardStoreRow {
  storeId: string;
  storeName: string;
  marketplace: string;
  current: DashboardTotals;
  previous: DashboardTotals | null;
  /** Kênh store đang tính (theo Team / team đang lọc). */
  channels: ("FBA" | "FBM")[];
  /** Tách riêng từng kênh, chỉ có khi store chạy cả FBA và FBM. */
  byChannel?: DashboardStoreChannelRow[];
  /** Giá trị tồn hiện tại của kênh FBA (null khi store chỉ tính FBM). */
  stockValue?: number | null;
}

export interface TopProductItem {
  storeId: string;
  storeName: string;
  channel: "FBA" | "FBM";
  sku: string;
  asin: string | null;
  productName: string;
  /** Tên phôi (Product Type trong Bảng mã). */
  productType: string | null;
  imageUrl: string | null;
  units: number;
  revenue: number;
  /** Profit như tab SKU WIN / LỌC SKU CỐ ĐỊNH FBM (chưa trừ phí dịch vụ cố định). */
  profit: number;
  margin: number;
  acos: number;
  tacos: number;
}

export interface TopProductLists {
  profit: TopProductItem[];
  revenue: TopProductItem[];
  loss: TopProductItem[];
}

export interface DashboardTopProducts {
  period: { startDate: string; endDate: string };
  /** Kênh có trong bộ lọc store / team (chỉ 1 kênh thì giao diện chỉ hiện 1 bảng). */
  channels: ("FBA" | "FBM")[];
  FBA: TopProductLists;
  FBM: TopProductLists;
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

export { invalidateAccountingDashboardCache };

/** Dữ liệu kết thúc trước cửa sổ "gần đây" → dùng phiên bản dữ liệu cũ (crawler ghi dữ liệu mới không làm nguội). */
function rangeStamp(cache: DashboardCacheScope, endDate: string): string {
  return endDate && cache.historyVersion && endDate < addDays(cache.today, -RECENT_DAYS)
    ? `h${cache.historyVersion}`
    : recentStamp(cache);
}

const monthLastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

function monthsBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let [y, m] = startDate.slice(0, 7).split("-").map(Number);
  const [ey, em] = endDate.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

type DashboardChannel = "Amazon" | "Merchant";

/**
 * Kênh tính cho 1 store theo cột Team của store:
 *   chọn team → team FBM chỉ lấy FBM, team FBA chỉ lấy FBA;
 *   không chọn team → cộng mọi kênh store đang chạy (team FBA… → FBA, team FBM → FBM).
 */
function storeChannels(
  storeTeam: string | null | undefined,
  selectedTeam?: string,
  /** Kênh người dùng được phân quyền xem (undefined = toàn quyền). */
  allowed?: ("FBA" | "FBM")[],
): DashboardChannel[] {
  const channels: DashboardChannel[] = [];
  if (selectedTeam) channels.push(/^fbm$/i.test(selectedTeam.trim()) ? "Merchant" : "Amazon");
  else {
    if (storeHasFbaTeam(storeTeam)) channels.push("Amazon");
    if (storeHasTeam(storeTeam, "FBM")) channels.push("Merchant");
    if (!channels.length) channels.push("Amazon");
  }
  return allowed ? channels.filter((c) => allowed.includes(c === "Merchant" ? "FBM" : "FBA")) : channels;
}

/** Phân quyền kế toán: kênh được xem của từng store (không truyền = toàn quyền). */
export type DashboardAllowedChannels = (storeId: string) => ("FBA" | "FBM")[];

async function fetchStoreDaily(storeId: string, startDate: string, endDate: string, channel: DashboardChannel): Promise<FbaDailyItem[]> {
  const options = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    sortField: "date",
    sortDirection: "asc" as const,
    limit: 100_000,
  };
  const res = channel === "Merchant" ? await listFbmDaily(storeId, options) : await listFbaDaily(storeId, { ...options, channel });
  return res.items;
}

/**
 * Số liệu từng ngày của 1 store + kênh trong [startDate, endDate], cache theo từng THÁNG lịch:
 * đổi khoảng ngày (This month → Last week…) dùng lại các tháng đã có; tháng cũ không bị crawler làm nguội
 * (xem dashboard-cache.ts). Các tháng thiếu liền nhau tính bằng 1 truy vấn rồi tách theo tháng.
 * Số liệu 1 ngày không phụ thuộc khoảng truy vấn (FBM lấy đủ mọi dòng của đơn có dòng trong khoảng).
 * FBM dùng công thức tab FBM (listFbmDaily, khớp workbook "FBM - <STORE>"), FBA dùng listFbaDaily.
 */
async function loadStoreDaily(
  cache: DashboardCacheScope,
  storeId: string,
  startDate: string,
  endDate: string,
  channel: DashboardChannel,
): Promise<FbaDailyItem[]> {
  const ch = channel === "Merchant" ? "fbm" : "fba";
  if (!startDate || !endDate) {
    // Toàn thời gian: 1 key
    return stampedValue(cache, `${DASHBOARD_CACHE_PREFIX}all:${storeId}:${ch}`, recentStamp(cache), () =>
      fetchStoreDaily(storeId, "", "", channel),
    );
  }
  const months = monthsBetween(startDate, endDate);
  const parts = months.map((ym) => ({
    id: ym,
    key: `${DASHBOARD_CACHE_PREFIX}m:${storeId}:${ch}:${ym}`,
    stamp: rangeStamp(cache, monthLastDay(ym)),
  }));
  const byMonth = await stampedParts<FbaDailyItem[]>(
    cache,
    parts,
    async (ids) => {
      // Gom các tháng liền nhau thành 1 khoảng → 1 truy vấn
      const sorted = [...ids].sort();
      const spans: string[][] = [];
      for (const ym of sorted) {
        const last = spans[spans.length - 1];
        if (last && monthsBetween(last[last.length - 1], ym).length === 2) last.push(ym);
        else spans.push([ym]);
      }
      const out = new Map<string, FbaDailyItem[]>(sorted.map((ym) => [ym, []]));
      await Promise.all(
        spans.map(async (span) => {
          const items = await fetchStoreDaily(storeId, `${span[0]}-01`, monthLastDay(span[span.length - 1]), channel);
          for (const it of items) out.get(it.date.slice(0, 7))?.push(it);
        }),
      );
      return out;
    },
    `daily:${storeId}:${ch}`,
  );
  return months
    .flatMap((ym) => byMonth.get(ym) ?? [])
    .filter((it) => it.date >= startDate && it.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
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
  allowedChannels?: DashboardAllowedChannels;
}): Promise<AccountingDashboardData> {
  const [allStores, latestDate, cache] = await Promise.all([
    listStores(),
    getLatestAvailableAccountingDate(),
    getDashboardCacheScope(Boolean(options.fresh)),
  ]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  // Chọn theo team: chỉ giữ các store thuộc team đó (vd FBA 2 = mọi store có "FBA 2" trong cột Team).
  const stores = allStores.filter(
    (s) =>
      (!requested.size || requested.has(s.id)) &&
      (!options.team || storeHasTeam(s.team, options.team)) &&
      storeChannels(s.team, options.team, options.allowedChannels?.(s.id)).length > 0,
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
  // Giá trị tồn chạy song song với số liệu ngày (không chờ nhau)
  const stockPromise = loadStockValues(
    cache,
    stores.filter((s) => storeChannels(s.team, options.team, options.allowedChannels?.(s.id)).includes("Amazon")).map((s) => s.id),
  );
  const perStore = await Promise.all(
    stores.map(async (store) => {
      const channels = await Promise.all(
        storeChannels(store.team, options.team, options.allowedChannels?.(store.id)).map(async (channel) => ({
          channel: channel === "Merchant" ? ("FBM" as const) : ("FBA" as const),
          items: await loadStoreDaily(cache, store.id, hasRange ? fetchStart : "", hasRange ? fetchEnd : "", channel),
        })),
      );
      // Store chạy cả FBA và FBM: ghép dòng ngày của 2 kênh (các phép tổng hợp đều cộng theo dòng).
      return { store, channels, items: channels.flatMap((c) => c.items) };
    }),
  );
  const stockValues = await stockPromise;
  const periodTotals = (items: FbaDailyItem[]) => ({
    current: summarize(items.filter((it) => inRange(it.date, periods.current))),
    previous: periods.previous ? summarize(items.filter((it) => inRange(it.date, periods.previous!))) : null,
  });

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
    byStore: perStore.map(({ store, channels, items }) => ({
      storeId: store.id,
      storeName: store.name,
      marketplace: store.marketplace,
      ...periodTotals(items),
      channels: channels.map((c) => c.channel),
      byChannel: channels.length > 1
        ? channels.map((c) => ({ channel: c.channel, ...periodTotals(c.items), stockValue: c.channel === "FBA" ? stockValues.get(store.id) ?? 0 : null }))
        : undefined,
      stockValue: channels.some((c) => c.channel === "FBA") ? stockValues.get(store.id) ?? 0 : null,
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
  productType: string | null;
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
  // Khoảng đã qua hẳn (trước cửa sổ gần đây) dùng phiên bản dữ liệu cũ → không nguội mỗi lần crawler ghi
  return stampedValue(
    cache,
    `${DASHBOARD_CACHE_PREFIX}sku5:${storeId}:${startDate || "all"}:${endDate || "all"}:${channel === "Merchant" ? "fbm" : "fba"}`,
    rangeStamp(cache, endDate),
    async () => {
      const options = { status: "all", startDate, endDate, limit: 100_000, includeAllTime: false };
      const [res, nonFbaSkus] = await Promise.all([
        channel === "Merchant" ? listFbmSkuFixed(storeId, options) : listSkuWin(storeId, options),
        channel === "Merchant" ? Promise.resolve(new Set<string>()) : loadNonFbaSkus(storeId),
      ]);
      return res.items
        .filter((i) => !nonFbaSkus.has(i.sku))
        // Giữ cả SKU chỉ có hoàn hàng / phí trong kỳ (profit ≠ 0) — bỏ đi thì mất Refund, Profit cao hơn BÁO CÁO TUẦN
        .filter((i) => i.quantity > 0 || i.revenue !== 0 || i.ads_fee > 0 || i.profit !== 0)
        .map((i) => ({
          sku: i.sku,
          asin: i.asin,
          productType: i.product_type || null,
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
      ${startDate && endDate ? sql`AND date >= ${startDate}::date AND date <= ${endDate}::date` : sql``}
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
  allowedChannels?: DashboardAllowedChannels;
}): Promise<DashboardTopProducts> {
  const [allStores, latestDate, cache] = await Promise.all([
    listStores(),
    getLatestAvailableAccountingDate(),
    getDashboardCacheScope(),
  ]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  const stores = allStores.filter(
    (s) =>
      (!requested.size || requested.has(s.id)) &&
      (!options.team || storeHasTeam(s.team, options.team)) &&
      storeChannels(s.team, options.team, options.allowedChannels?.(s.id)).length > 0,
  );
  const period = resolveDashboardPeriods(options.startDate ?? "", options.endDate ?? "", latestDate, "none").current;
  const empty = (): TopProductLists => ({ profit: [], revenue: [], loss: [] });
  // Kỳ rỗng = "Toàn thời gian": SKU WIN / LỌC SKU CỐ ĐỊNH tính trên toàn bộ dữ liệu như phần tổng quan Dashboard.
  if (!stores.length) return { period, channels: [], FBA: empty(), FBM: empty() };

  const rows = (
    await Promise.all(
      stores.flatMap((store) =>
        storeChannels(store.team, options.team, options.allowedChannels?.(store.id)).map(async (channel) =>
          (await loadStoreSkuPerformance(cache, store.id, period.startDate, period.endDate, channel)).map(
            (r): TopProductItem => ({
              storeId: store.id,
              storeName: store.name,
              channel: channel === "Merchant" ? "FBM" : "FBA",
              sku: r.sku,
              asin: r.asin,
              productName: "",
              productType: r.productType,
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

  const channels = (["FBA", "FBM"] as const).filter((c) =>
    stores.some((store) => storeChannels(store.team, options.team, options.allowedChannels?.(store.id)).includes(c === "FBM" ? "Merchant" : "Amazon")),
  );
  const topLists = (channel: "FBA" | "FBM"): TopProductLists => {
    const channelRows = rows.filter((i) => i.channel === channel);
    const top = (filter: (i: TopProductItem) => boolean, compare: (a: TopProductItem, b: TopProductItem) => number) =>
      channelRows.filter(filter).sort(compare).slice(0, TOP_PRODUCTS_LIMIT);
    return {
      profit: top((i) => i.profit > 0, (a, b) => b.profit - a.profit),
      revenue: top((i) => i.revenue > 0, (a, b) => b.revenue - a.revenue),
      loss: top((i) => i.profit < 0, (a, b) => a.profit - b.profit),
    };
  };
  const byChannel = { FBA: topLists("FBA"), FBM: topLists("FBM") };

  const names = await loadProductNames(
    Object.values(byChannel).flatMap((l) => [...l.profit, ...l.revenue, ...l.loss]),
    period.startDate,
    period.endDate,
  );
  const withName = (i: TopProductItem) => ({ ...i, productName: names.get(`${i.storeId}|${i.sku}`) || i.sku });
  const named = (l: TopProductLists): TopProductLists => ({
    profit: l.profit.map(withName),
    revenue: l.revenue.map(withName),
    loss: l.loss.map(withName),
  });
  return { period, channels, FBA: named(byChannel.FBA), FBM: named(byChannel.FBM) };
}

// ----------------- STORES PERFORMANCE THEO NHÓM SKU (WIN / TEST) -----------------

/**
 * Nhóm SKU theo cột Trạng thái của Bảng mã FBA: Win = "Phát triển", Test = "Test".
 * FBM tính như BÁO CÁO TUẦN: Win = toàn bộ FBM của store (tab FBM của BÁO CÁO THÁNG), Test không có FBM.
 */
export type DashboardSkuGroup = "win" | "test";
const SKU_GROUP_STATUS: Record<DashboardSkuGroup, string> = { win: "phát triển", test: "test" };

export interface DashboardSkuGroupData {
  group: DashboardSkuGroup;
  period: { startDate: string; endDate: string };
  /** Cùng dạng byStore của getAccountingDashboard nhưng chỉ cộng các SKU thuộc nhóm (previous = null). */
  byStore: DashboardStoreRow[];
  current: DashboardTotals;
}

/**
 * SKU FBA của nhóm trong BẢNG MÃ (accounting_sku_master, Loại FBA), khoá `${storeId}|FBA`.
 * Mỗi SKU lấy dòng đầu trong bảng (như KPI kinh doanh) rồi mới xét trạng thái. FBM không lọc theo Bảng mã.
 */
async function loadGroupSkus(storeIds: string[], group: DashboardSkuGroup): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!storeIds.length) return out;
  const sql = await getDatabaseClient();
  const status = SKU_GROUP_STATUS[group];
  const fba = await sql<{ store_id: string; sku: string }[]>`
    SELECT store_id::text, sku FROM (
      SELECT DISTINCT ON (store_id, sku) store_id, sku, status
      FROM accounting_sku_master
      WHERE store_id::text IN ${sql(storeIds)} AND deleted_at IS NULL
        AND UPPER(TRIM(COALESCE(NULLIF(loai, ''), 'FBA'))) = 'FBA'
      ORDER BY store_id, sku, row_order NULLS LAST, updated_at DESC
    ) m
    WHERE LOWER(TRIM(COALESCE(status, ''))) = ${status}
  `;
  for (const r of fba) {
    const key = `${r.store_id}|FBA`;
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(r.sku);
  }
  return out;
}

/**
 * Giá trị tồn hiện tại theo store = tổng cột "Giá trị tồn" của BẢNG MÃ FBA (Tồn × Giá TB năm, như màn Bảng mã).
 * Truyền status để chỉ cộng SKU của nhóm (Win = "phát triển", Test = "test").
 */
// Chi Tiết Đi Hàng (accounting_inbound_shipments) không tăng phiên bản dữ liệu Dashboard → tính lại sau mỗi 5 phút.
const STOCK_CACHE_TTL_SECONDS = 300;

async function loadStockValues(cache: DashboardCacheScope, storeIds: string[], status?: string): Promise<Map<string, number>> {
  if (!storeIds.length) return new Map();
  // Cache theo từng store (đổi lựa chọn store không phải tính lại), mỗi store 1 số
  const values = await Promise.all(
    storeIds.map((id) =>
      // Chi Tiết Đi Hàng không có phiên bản dữ liệu → stamp thêm khung 5 phút
      stampedValue(
        cache,
        `${DASHBOARD_CACHE_PREFIX}stock:${id}:${status || "all"}`,
        `${recentStamp(cache)}:${Math.floor(Date.now() / (STOCK_CACHE_TTL_SECONDS * 1000))}`,
        async () => (await queryStockValues([id], status)).get(id) ?? 0,
      ),
    ),
  );
  return new Map(storeIds.map((id, i) => [id, Number(values[i]) || 0]));
}

async function queryStockValues(storeIds: string[], status?: string): Promise<Map<string, number>> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_id: string; value: number | null }[]>`
    SELECT store_id, SUM(gia_tri_ton)::float AS value FROM (
      SELECT asm.store_id::text AS store_id, ${skuStockValueSelect(sql)}
      FROM accounting_sku_master asm
      ${skuStockValueJoins(sql)}
      WHERE asm.store_id::text IN ${sql(storeIds)} AND asm.deleted_at IS NULL
        AND asm.ton_kho > 0
        ${status ? sql`AND LOWER(TRIM(COALESCE(asm.status, ''))) = ${status}` : sql``}
    ) x
    GROUP BY store_id
  `;
  return new Map(rows.map((r) => [r.store_id, Number(r.value) || 0]));
}

/** Tổng của các SKU (cùng công thức SKU WIN / LỌC SKU CỐ ĐỊNH như Top sản phẩm). */
function skuTotals(items: SkuPerformance[]): DashboardTotals {
  let revenue = 0, quantity = 0, adsFee = 0, profit = 0, revenueAds = 0;
  for (const i of items) {
    revenue += i.revenue;
    quantity += i.units;
    adsFee += i.adsFee;
    profit += i.profit;
    revenueAds += i.revenueAds;
  }
  return {
    days: 0,
    revenue,
    quantity,
    orders: 0,
    adsFee,
    basecost: 0,
    amazonFee: 0,
    tax: 0,
    promotion: 0,
    returnCost: 0,
    serviceCost: 0,
    profit,
    netProfit: profit,
    revenueAds,
    clicks: 0,
    margin: revenue > 0 ? profit / revenue : 0,
    netMargin: revenue > 0 ? profit / revenue : 0,
    roi: 0,
    tacos: revenue > 0 ? adsFee / revenue : 0,
    acos: revenueAds > 0 ? adsFee / revenueAds : 0,
  };
}

/**
 * Stores Performance chỉ tính SKU Win (Bảng mã trạng thái "Phát triển") hoặc SKU Test (trạng thái "Test"):
 * cộng số liệu từng SKU (SKU WIN cho FBA, LỌC SKU CỐ ĐỊNH cho FBM) của SKU thuộc nhóm, khớp Loại của Bảng mã với kênh.
 * Cùng bộ lọc store / team / phân quyền kênh với getAccountingDashboard.
 */
export async function getDashboardSkuGroup(options: {
  group: DashboardSkuGroup;
  startDate?: string;
  endDate?: string;
  storeIds?: string[];
  team?: string;
  allowedChannels?: DashboardAllowedChannels;
}): Promise<DashboardSkuGroupData> {
  const [allStores, latestDate, cache] = await Promise.all([
    listStores(),
    getLatestAvailableAccountingDate(),
    getDashboardCacheScope(),
  ]);
  const requested = new Set((options.storeIds ?? []).filter(Boolean));
  const stores = allStores.filter(
    (s) =>
      (!requested.size || requested.has(s.id)) &&
      (!options.team || storeHasTeam(s.team, options.team)) &&
      storeChannels(s.team, options.team, options.allowedChannels?.(s.id)).length > 0,
  );
  const period = resolveDashboardPeriods(options.startDate ?? "", options.endDate ?? "", latestDate, "none").current;
  const [groupSkus, stockValues] = await Promise.all([
    loadGroupSkus(stores.map((s) => s.id), options.group),
    loadStockValues(cache, stores.map((s) => s.id), SKU_GROUP_STATUS[options.group]),
  ]);

  const perStore = await Promise.all(
    stores.map(async (store) => {
      const channels = await Promise.all(
        storeChannels(store.team, options.team, options.allowedChannels?.(store.id)).map(async (channel) => {
          const label = channel === "Merchant" ? ("FBM" as const) : ("FBA" as const);
          // FBM: Win = toàn bộ FBM của store, Test = không có (như BÁO CÁO TUẦN)
          if (label === "FBM") {
            const items =
              options.group === "win" ? await loadStoreSkuPerformance(cache, store.id, period.startDate, period.endDate, channel) : [];
            return { channel: label, items };
          }
          const skus = groupSkus.get(`${store.id}|${label}`);
          const items = skus?.size
            ? (await loadStoreSkuPerformance(cache, store.id, period.startDate, period.endDate, channel)).filter((i) => skus.has(i.sku))
            : [];
          return { channel: label, items };
        }),
      );
      return { store, channels };
    }),
  );

  const byStore: DashboardStoreRow[] = perStore.map(({ store, channels }) => ({
    storeId: store.id,
    storeName: store.name,
    marketplace: store.marketplace,
    current: skuTotals(channels.flatMap((c) => c.items)),
    previous: null,
    channels: channels.map((c) => c.channel),
    byChannel:
      channels.length > 1
        ? channels.map((c) => ({
            channel: c.channel,
            current: skuTotals(c.items),
            previous: null,
            stockValue: c.channel === "FBA" ? stockValues.get(store.id) ?? 0 : null,
          }))
        : undefined,
    stockValue: channels.some((c) => c.channel === "FBA") ? stockValues.get(store.id) ?? 0 : null,
  }));
  return {
    group: options.group,
    period,
    byStore,
    current: skuTotals(perStore.flatMap((s) => s.channels.flatMap((c) => c.items))),
  };
}
