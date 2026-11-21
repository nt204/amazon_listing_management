import "server-only";

// Nguồn số liệu cho danh mục chỉ số kế toán. Nguyên tắc: KHÔNG tự viết lại SQL tính P&L — gọi đúng các hàm
// Dashboard đang dùng (getAccountingDashboard có cache) để số agent nói khớp từng cent với số trên web.

import { getAccountingDashboard, type AccountingDashboardData } from "@/lib/accounting/dashboard-db";
import { summarizeDays, type DashboardTotals } from "@/lib/accounting/dashboard-totals";
import type { DashboardCompareMode } from "@/lib/accounting/dashboard-periods";
import { listSkuWin } from "@/lib/accounting/sku-win-db";
import { listFbmSkuFixed } from "@/lib/accounting/fbm-financials-db";
import { storeChannelsFor, type AccountingAccess, type AccountingChannel } from "@/lib/accounting/access";
import { storeHasTeam } from "@/lib/accounting/store-teams";
import type { Store } from "@/lib/accounting/types";
import type { AccountingMetricRow } from "@/lib/metrics/accounting/definitions";
import type { MetricSegment } from "@/lib/metrics/types";

/** Quyền của người hỏi — dựng 1 lần mỗi lượt chạy từ phân quyền kế toán (lib/accounting/access.ts). */
export interface AccountingAgentScope {
  access: AccountingAccess;
  canViewPayout: boolean;
  /** Store người hỏi được xem (đã lọc theo phân quyền). */
  stores: Store[];
}

/** Phạm vi của một câu hỏi: store / team / kỳ. */
export interface AccountingQuery {
  storeIds?: string[];
  storeNames?: string[];
  team?: string;
  startDate: string;
  endDate: string;
}

export interface ResolvedAccountingQuery {
  storeIds: string[];
  team: string;
  startDate: string;
  endDate: string;
}

const norm = (s: string) => s.trim().toUpperCase();

/** Đổi tên / id store người dùng nêu thành id, chặn store ngoài phân quyền. */
export function resolveAccountingQuery(scope: AccountingAgentScope, query: AccountingQuery): ResolvedAccountingQuery {
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const raw of [...(query.storeIds ?? []), ...(query.storeNames ?? [])]) {
    const q = norm(raw);
    if (!q) continue;
    const store =
      scope.stores.find((s) => s.id === raw.trim() || norm(s.name) === q) ??
      scope.stores.find((s) => norm(s.name).includes(q) || q.includes(norm(s.name)));
    if (store) ids.add(store.id);
    else unknown.push(raw);
  }
  if (unknown.length) {
    throw new Error(
      `Không tìm thấy hoặc không có quyền xem store: ${unknown.join(", ")}. Store được xem: ${scope.stores.map((s) => s.name).join(", ") || "(không có)"}.`,
    );
  }
  const team = query.team?.trim() || "";
  if (team && !scope.stores.some((s) => storeHasTeam(s.team, team))) {
    throw new Error(`Không có store nào thuộc team "${team}" trong phạm vi được xem.`);
  }
  return { storeIds: [...ids], team, startDate: query.startDate, endDate: query.endDate };
}

export interface PnlSnapshot {
  latestDate: string;
  period: { startDate: string; endDate: string };
  previousPeriod: { startDate: string; endDate: string } | null;
  dataLag: AccountingDashboardData["dataLag"];
  stores: { id: string; name: string }[];
  total: AccountingMetricRow;
  previousTotal: AccountingMetricRow | null;
  byStore: MetricSegment<AccountingMetricRow>[];
  previousByStore: MetricSegment<AccountingMetricRow>[];
  byChannel: MetricSegment<AccountingMetricRow>[];
  previousByChannel: MetricSegment<AccountingMetricRow>[];
  byDay: MetricSegment<AccountingMetricRow>[];
  /** Kênh tính cho từng store (theo Team + phân quyền), dùng khi cần tách SKU. */
  storeChannels: { storeId: string; storeName: string; channels: AccountingChannel[] }[];
}

const EMPTY_TOTALS: DashboardTotals = summarizeDays([]);

function addTotals(a: DashboardTotals, b: DashboardTotals): DashboardTotals {
  // Cộng các khoản rồi tính lại tỷ lệ bằng đúng hàm của Dashboard (không cộng tỷ lệ).
  return summarizeDays([
    { date: "a", ...pickDay(a) },
    { date: "b", ...pickDay(b) },
  ]);
}

function pickDay(t: DashboardTotals) {
  return {
    revenue: t.revenue,
    quantity: t.quantity,
    orders: t.orders,
    adsFee: t.adsFee,
    basecost: t.basecost,
    amazonFee: t.amazonFee,
    tax: t.tax,
    promotion: t.promotion,
    returnCost: t.returnCost,
    profit: t.profit,
    netProfit: t.netProfit,
    revenueAds: t.revenueAds,
    clicks: t.clicks,
  };
}

/**
 * Số liệu P&L của phạm vi, đúng như Dashboard tính (cùng hàm, cùng cache).
 * compare: "prev" / "yoy" như nút so sánh trên Dashboard; "none" nếu không cần kỳ trước.
 */
export async function loadPnlSnapshot(
  scope: AccountingAgentScope,
  query: ResolvedAccountingQuery,
  compare: DashboardCompareMode = "none",
): Promise<PnlSnapshot> {
  const data = await getAccountingDashboard({
    startDate: query.startDate,
    endDate: query.endDate,
    storeIds: query.storeIds,
    team: query.team,
    compare,
    allowedChannels: scope.access.full ? undefined : (id: string) => storeChannelsFor(scope.access, id),
    canViewPayout: scope.canViewPayout,
  });
  const withPayout = (t: DashboardTotals, payout: number | null | undefined): AccountingMetricRow =>
    payout == null ? t : { ...t, payout };

  const channelTotals = (pick: "current" | "previous") => {
    const acc = new Map<AccountingChannel, DashboardTotals>();
    for (const s of data.byStore) {
      const parts = s.byChannel?.length
        ? s.byChannel.map((c) => ({ channel: c.channel, totals: c[pick] }))
        : [{ channel: s.channels[0] ?? "FBA", totals: s[pick] }];
      for (const p of parts) {
        if (!p.totals) continue;
        acc.set(p.channel, addTotals(acc.get(p.channel) ?? EMPTY_TOTALS, p.totals));
      }
    }
    return [...acc].map(([channel, row]) => ({ key: channel, label: channel, row }));
  };

  const { current, previousPeriod } = { current: data.period, previousPeriod: data.previousPeriod };
  return {
    latestDate: data.latestDate,
    period: current,
    previousPeriod,
    dataLag: data.dataLag,
    stores: data.stores.map((s) => ({ id: s.id, name: s.name })),
    total: withPayout(data.current, data.payout?.current),
    previousTotal: data.previous ? withPayout(data.previous, data.payout?.previous) : null,
    byStore: data.byStore.map((s) => ({ key: s.storeId, label: s.storeName, row: s.current })),
    previousByStore: data.byStore
      .filter((s) => s.previous)
      .map((s) => ({ key: s.storeId, label: s.storeName, row: s.previous! })),
    byChannel: channelTotals("current"),
    previousByChannel: data.previous ? channelTotals("previous") : [],
    byDay: data.days
      .filter((d) => (!current.startDate || d.date >= current.startDate) && (!current.endDate || d.date <= current.endDate))
      .map((d) => ({ key: d.date, label: d.date, row: summarizeDays([d]) })),
    storeChannels: data.byStore.map((s) => ({ storeId: s.storeId, storeName: s.storeName, channels: s.channels })),
  };
}

function skuRow(i: {
  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  profit: number;
  revenue_ads: number;
}): AccountingMetricRow {
  return summarizeDays([
    {
      date: "sku",
      revenue: i.revenue,
      quantity: i.quantity,
      orders: 0,
      adsFee: i.ads_fee,
      basecost: i.basecost,
      amazonFee: i.amazon_fee,
      tax: i.thue,
      promotion: i.promotion,
      returnCost: i.return_cost,
      profit: i.profit,
      netProfit: i.profit,
      revenueAds: i.revenue_ads,
      clicks: 0,
    },
  ]);
}

/**
 * Số liệu theo SKU của phạm vi — dùng đúng công thức tab SKU WIN (FBA) / LỌC SKU CỐ ĐỊNH (FBM) như Top sản phẩm
 * của Dashboard. Tổng theo SKU có thể lệch nhẹ so với tổng P&L (Ads gán theo Portfolio, SKU không có trong
 * Bảng mã…): phần lệch được trả về ở `unallocated` của breakdown.
 */
export async function loadSkuSegments(
  snapshot: PnlSnapshot,
  options: { storeId?: string; channel?: AccountingChannel; startDate?: string; endDate?: string } = {},
): Promise<MetricSegment<AccountingMetricRow>[]> {
  const startDate = options.startDate ?? snapshot.period.startDate;
  const endDate = options.endDate ?? snapshot.period.endDate;
  const targets = snapshot.storeChannels
    .filter((s) => !options.storeId || s.storeId === options.storeId)
    .flatMap((s) => s.channels.filter((c) => !options.channel || c === options.channel).map((channel) => ({ ...s, channel })));
  const multiStore = new Set(targets.map((t) => t.storeId)).size > 1;
  const parts = await Promise.all(
    targets.map(async (t) => {
      const opts = { status: "all", startDate, endDate, limit: 100_000, includeAllTime: false };
      const res = t.channel === "FBM" ? await listFbmSkuFixed(t.storeId, opts) : await listSkuWin(t.storeId, opts);
      return res.items
        .filter((i) => i.quantity > 0 || i.revenue !== 0 || i.ads_fee > 0 || i.profit !== 0)
        .map((i) => ({
          key: `${t.storeId}|${t.channel}|${i.sku}`,
          label: `${i.sku}${i.product_type ? ` (${i.product_type})` : ""} · ${t.channel}${multiStore ? ` · ${t.storeName}` : ""}`,
          row: skuRow(i),
        }));
    }),
  );
  return parts.flat();
}
