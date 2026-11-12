import "server-only";

import { getLatestAvailableAccountingDate, listStores } from "@/lib/accounting/accounting-db";
import {
  getDashboardSkuGroup,
  type DashboardAllowedChannels,
  type DashboardSkuGroupData,
  type DashboardTotals,
} from "@/lib/accounting/dashboard-db";
import { queryStockAt } from "@/lib/accounting/dashboard-stock";
import { getStoreMonthTargets } from "@/lib/accounting/kpi-month-targets";
import { getDatabaseClient } from "@/lib/db";
import {
  daysInMonthOf,
  previousWeekSegment,
  weekSegmentOf,
  type WeekSegment,
} from "@/lib/accounting/weekly-report-periods";

// BÁO CÁO TUẦN — dựng lại file "BÁO CÁO TUẦN TỔNG HỢP" (mỗi tab W.. là 1 tuần) từ dữ liệu trong hệ thống:
//   I.  KPI card: Revenue / Profit / Biên LN / TACoS của SKU WIN toàn công ty, so tuần trước + nhịp mục tiêu tháng.
//   II. Kinh doanh theo brand (SKU WIN): mỗi store × kênh 1 dòng (store chạy cả FBA và FBM thì tách "(FBA)" / "(FBM)").
//       Số SKU WIN = getDashboardSkuGroup("win"), cùng nguồn "Data Win" của sheet (FBA: Bảng mã trạng thái Phát triển;
//       FBM: toàn bộ FBM của store).
//   P/L theo người phụ trách: gom brand theo Team của store (FBA 1 → FBA TEAM 1…, kênh FBM → FBM).
//   III. Hiệu quả RD (SKU TEST): getDashboardSkuGroup("test") — chỉ FBA.
//   V.  Tồn kho: tồn FBA + AWD tại ngày cuối tuần (như Stores Performance), số tuần bán hết = tồn ÷ bán/tuần.
//   VI. Payment (USD): tiền về Amazon (Disbursements) trong tuần — chỉ admin / kế toán.
// Các mục lấy từ SỔ QUỸ, DS_MEDIA, trả trước SUP chưa có dữ liệu trong hệ thống nên không có ở đây.
// Công thức như sheet: % WoW = (này − trước) ÷ |trước|; TACoS = Ads ÷ Revenue; ROI = Profit ÷ Base Cost;
// nhịp mục tiêu = lũy kế từ đầu tháng ÷ (mục tiêu tháng × ngày cuối kỳ ÷ số ngày trong tháng).

export interface WeeklyMetrics {
  revenue: number;
  quantity: number;
  adsFee: number;
  profit: number;
  basecost: number;
}

export interface WeeklyBrandRow {
  key: string;
  storeId: string;
  storeName: string;
  channel: "FBA" | "FBM";
  label: string;
  team: string;
  current: WeeklyMetrics;
  previous: WeeklyMetrics;
  /** Lũy kế từ đầu tháng đến ngày cuối kỳ */
  mtd: WeeklyMetrics;
  /** Mục tiêu tháng (KPI kinh doanh, SKU WIN) — kênh FBM chưa có KPI → null */
  target: { revenue: number; profit: number } | null;
}

export interface WeeklyTestRow {
  storeId: string;
  label: string;
  current: WeeklyMetrics;
  previous: WeeklyMetrics;
}

export interface WeeklyStockRow {
  storeId: string;
  label: string;
  units: number;
  value: number;
  snapshotDate: string | null;
  /** SL bán FBA (Win + Test) trong kỳ */
  soldInPeriod: number;
}

export interface WeeklyReport {
  week: WeekSegment;
  previousWeek: WeekSegment;
  /** Ngày cuối có số liệu trong kỳ (kỳ đang chạy dừng ở ngày dữ liệu mới nhất) */
  dataThrough: string;
  /** Số ngày đã có số liệu của kỳ này / kỳ trước (để so theo ngày) */
  days: number;
  previousDays: number;
  /** Tỷ lệ nhịp tháng = ngày cuối kỳ ÷ số ngày trong tháng */
  monthPace: number;
  brands: WeeklyBrandRow[];
  tests: WeeklyTestRow[];
  stock: WeeklyStockRow[];
  /** null = người xem không có quyền xem tiền về */
  payout: { current: number; previous: number; byStore: { storeName: string; current: number; previous: number }[] } | null;
}

const EMPTY: WeeklyMetrics = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };

const metricsOf = (t: DashboardTotals | null | undefined): WeeklyMetrics =>
  t ? { revenue: t.revenue, quantity: t.quantity, adsFee: t.adsFee, profit: t.profit, basecost: t.basecost } : { ...EMPTY };

/** Tách dòng store theo kênh: key `${storeId}|FBA` → số liệu */
function byStoreChannel(data: DashboardSkuGroupData): Map<string, WeeklyMetrics> {
  const out = new Map<string, WeeklyMetrics>();
  for (const s of data.byStore) {
    if (s.byChannel?.length) for (const c of s.byChannel) out.set(`${s.storeId}|${c.channel}`, metricsOf(c.current));
    else if (s.channels[0]) out.set(`${s.storeId}|${s.channels[0]}`, metricsOf(s.current));
  }
  return out;
}

/** "FBA 2 / FBM" → "FBA TEAM 2" cho kênh FBA; kênh FBM → "FBM" */
function teamOf(storeTeam: string | null | undefined, channel: "FBA" | "FBM"): string {
  if (channel === "FBM") return "FBM";
  const m = (storeTeam || "").match(/FBA\s*(?:TEAM\s*)?(\d+)/i);
  return m ? `FBA TEAM ${m[1]}` : "FBA";
}

async function loadPayout(seg: WeekSegment, prev: WeekSegment, storeNames: string[]) {
  if (!storeNames.length) return { current: 0, previous: 0, byStore: [] };
  const sql = await getDatabaseClient();
  const rows = await sql<{ store_name: string; cur: number; prev: number }[]>`
    SELECT UPPER(store_name) AS store_name,
      COALESCE(SUM(payout_amount) FILTER (WHERE acknowledged_date BETWEEN ${seg.startDate}::date AND ${seg.endDate}::date), 0)::float AS cur,
      COALESCE(SUM(payout_amount) FILTER (WHERE acknowledged_date BETWEEN ${prev.startDate}::date AND ${prev.endDate}::date), 0)::float AS prev
    FROM accounting_payout_disbursements
    WHERE payout_status = 'Done'
      AND acknowledged_date BETWEEN ${prev.startDate}::date AND ${seg.endDate}::date
      AND UPPER(store_name) = ANY(${storeNames.map((n) => n.toUpperCase())})
    GROUP BY 1
    ORDER BY 1
  `;
  const byStore = rows.map((r) => ({ storeName: r.store_name, current: Number(r.cur) || 0, previous: Number(r.prev) || 0 }));
  return {
    current: byStore.reduce((s, r) => s + r.current, 0),
    previous: byStore.reduce((s, r) => s + r.previous, 0),
    byStore,
  };
}

export async function getWeeklyReport(options: {
  /** Ngày bất kỳ trong tuần cần xem */
  date: string;
  allowedChannels?: DashboardAllowedChannels;
  canViewPayout?: boolean;
}): Promise<WeeklyReport> {
  const [allStores, latestDate] = await Promise.all([listStores(), getLatestAvailableAccountingDate()]);
  // Tuần chưa có số liệu → lùi về tuần có ngày dữ liệu mới nhất
  const week = weekSegmentOf(latestDate && options.date > latestDate ? latestDate : options.date);
  const previousWeek = previousWeekSegment(week);
  const dataThrough = latestDate && latestDate < week.endDate ? latestDate : week.endDate;
  const monthStart = `${week.startDate.slice(0, 7)}-01`;
  const base = { allowedChannels: options.allowedChannels };

  const [win, winPrev, winMtd, test, testPrev] = await Promise.all([
    getDashboardSkuGroup({ ...base, group: "win", startDate: week.startDate, endDate: week.endDate }),
    getDashboardSkuGroup({ ...base, group: "win", startDate: previousWeek.startDate, endDate: previousWeek.endDate }),
    getDashboardSkuGroup({ ...base, group: "win", startDate: monthStart, endDate: week.endDate }),
    getDashboardSkuGroup({ ...base, group: "test", startDate: week.startDate, endDate: week.endDate }),
    getDashboardSkuGroup({ ...base, group: "test", startDate: previousWeek.startDate, endDate: previousWeek.endDate }),
  ]);

  const storeById = new Map(allStores.map((s) => [s.id, s]));
  const winCur = byStoreChannel(win);
  const winPrv = byStoreChannel(winPrev);
  const winM = byStoreChannel(winMtd);
  const period = week.startDate.slice(0, 7);

  const brands: WeeklyBrandRow[] = await Promise.all(
    win.byStore.flatMap((s) => {
      const channels = s.byChannel?.length ? s.byChannel.map((c) => c.channel) : s.channels.slice(0, 1);
      const split = channels.length > 1;
      return channels.map(async (channel): Promise<WeeklyBrandRow> => {
        const key = `${s.storeId}|${channel}`;
        let target: WeeklyBrandRow["target"] = null;
        if (channel === "FBA") {
          try {
            const t = await getStoreMonthTargets(s.storeId, period);
            if (t.dev) target = { revenue: t.dev.revenue, profit: t.dev.profit };
          } catch {
            // Store chưa có KPI tháng → bỏ qua mục tiêu
          }
        }
        return {
          key,
          storeId: s.storeId,
          storeName: s.storeName,
          channel,
          label: split ? `${s.storeName} (${channel})` : s.storeName,
          team: teamOf(storeById.get(s.storeId)?.team, channel),
          current: winCur.get(key) ?? { ...EMPTY },
          previous: winPrv.get(key) ?? { ...EMPTY },
          mtd: winM.get(key) ?? { ...EMPTY },
          target,
        };
      });
    }),
  );
  // Như sheet: FBM trước, rồi các team FBA theo số team
  brands.sort((a, b) => a.team.localeCompare(b.team, "en", { numeric: true }) || a.label.localeCompare(b.label));
  brands.sort((a, b) => Number(b.team === "FBM") - Number(a.team === "FBM"));

  const testCur = byStoreChannel(test);
  const testPrv = byStoreChannel(testPrev);
  const fbaStores = win.byStore.filter((s) => (s.byChannel?.map((c) => c.channel) ?? s.channels).includes("FBA"));
  const tests: WeeklyTestRow[] = fbaStores.map((s) => ({
    storeId: s.storeId,
    label: s.storeName,
    current: testCur.get(`${s.storeId}|FBA`) ?? { ...EMPTY },
    previous: testPrv.get(`${s.storeId}|FBA`) ?? { ...EMPTY },
  }));

  const stockAt = await queryStockAt(
    fbaStores.map((s) => s.storeId),
    dataThrough,
  );
  const stock: WeeklyStockRow[] = fbaStores.map((s) => {
    const v = stockAt.get(s.storeId);
    return {
      storeId: s.storeId,
      label: s.storeName,
      units: v?.units ?? 0,
      value: v?.value ?? 0,
      snapshotDate: v?.snapshotDate ?? null,
      soldInPeriod: (winCur.get(`${s.storeId}|FBA`)?.quantity ?? 0) + (testCur.get(`${s.storeId}|FBA`)?.quantity ?? 0),
    };
  });

  const payout = options.canViewPayout
    ? await loadPayout(week, previousWeek, win.byStore.map((s) => s.storeName))
    : null;

  const dayCount = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1);
  const prevThrough = latestDate && latestDate < previousWeek.endDate ? latestDate : previousWeek.endDate;

  return {
    week,
    previousWeek,
    dataThrough,
    days: dayCount(week.startDate, dataThrough),
    previousDays: dayCount(previousWeek.startDate, prevThrough),
    monthPace: Number(dataThrough.slice(8, 10)) / daysInMonthOf(dataThrough),
    brands,
    tests,
    stock,
    payout,
  };
}
