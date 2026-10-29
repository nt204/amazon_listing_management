import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { getCachedOrFetch } from "@/lib/redis";
import { getLatestAvailableAccountingDate } from "@/lib/accounting/accounting-db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";
import { listTargetRowsForRecommendations } from "./repository";
import { groupedRecommendationsRedisKey } from "./recommendation-cache";
import {
  getAccountingStoreForPpcStore,
  getGroupedRecommendations,
  getSkuEconomicsList,
} from "./sku-architecture-service";
import { SKU_CHAT_CVR_TARGET_PCT } from "./sku-ai-chat-skill";
import type { PpcRecommendation } from "./types";

/**
 * Nguồn dữ liệu riêng của AI chat theo SKU. Chỉ dùng thư viện lõi của web
 * (Lọc SKU, SKU Economics, đề xuất Auto Bid) để số khớp với màn hình.
 */

const SNAPSHOT_TTL_SECONDS = 10 * 60;
const RECOMMENDATION_CACHE_TTL_SECONDS = 10 * 60;
const RECOMMENDATION_WINDOW_DAYS = 30;
const ACCOUNTING_PERIOD_DAYS = 14;

export interface SkuChatScope {
  scope: DataScope;
  storeId: string;
  storeName: string;
  sku: string;
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round((numerator / denominator) * 100, 1) : null;
}

function ratio(numerator: number, denominator: number, digits = 2): number | null {
  return denominator > 0 ? round(numerator / denominator, digits) : null;
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return round(((current - previous) / Math.abs(previous)) * 100, 1);
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Phôi campaign (SP03/SB05/...) và match type đọc từ tên campaign theo quy ước đặt tên của team. */
function campaignFamily(name: string): string {
  return name.match(/\b(SP0\d|SB0\d|SD0\d)\b/i)?.[1]?.toUpperCase() || "KHÁC";
}

function campaignMatch(name: string): string {
  return name.match(/\b(Exact|Phrase|Broad|Auto)\b/i)?.[1]?.toUpperCase() || "KHÁC";
}

/** Số click tối thiểu để chấm CVR: số click cần để ra 1 đơn ở CVR mục tiêu (10% → 10 click). */
export const MIN_CLICKS_FOR_CVR = Math.round(100 / SKU_CHAT_CVR_TARGET_PCT);
/** Ngưỡng độ tin cậy: dưới 15 click là mẫu nhỏ; từ 30 click (3 lần số click cho 1 đơn) mới đủ chắc. */
const MEDIUM_CONFIDENCE_CLICKS = 15;
const HIGH_CONFIDENCE_CLICKS = 30;
const HIGH_CONFIDENCE_ORDERS = 3;
/** Search term "đốt tiền" để xem phủ định: từ 15 click, 0 đơn (không cắt mẫu quá nhỏ). */
export const MIN_CLICKS_FOR_NEGATIVE = MEDIUM_CONFIDENCE_CLICKS;

/** Tiêu chí chấm của SKU đang mở (Block A). */
export interface SkuRules {
  breakEvenAcosPct: number | null;
  maxBid: number | null;
  profitBeforeAds: number | null;
}

/**
 * Chấm theo tiêu chí của team, tách riêng "đạt" và "độ tin cậy" để AI không đánh đồng
 * "đạt" với "nên tăng bid":
 * - CVR ≥ 10% là đạt (chỉ chấm khi ≥ 10 click).
 * - ACOS < hòa vốn là đạt; có spend mà 0 sales thì ACOS không xác định (noSales), không chấm.
 * - contribution = đơn × lãi trước ads − spend (lãi sau ads ước tính).
 * - confidence: LOW (< 15 click), HIGH (≥ 30 click và ≥ 3 đơn hoặc 0 đơn), còn lại MEDIUM.
 */
export function judgeMetrics(
  m: { clicks: number; orders: number; spend: number; sales: number },
  rules: Pick<SkuRules, "breakEvenAcosPct" | "profitBeforeAds">,
) {
  const cvrPct = pct(m.orders, m.clicks);
  const noSales = m.spend > 0 && m.sales <= 0;
  const acosPct = noSales ? null : pct(m.spend, m.sales);
  const confidence = m.clicks < MEDIUM_CONFIDENCE_CLICKS
    ? "LOW"
    : m.clicks >= HIGH_CONFIDENCE_CLICKS && (m.orders >= HIGH_CONFIDENCE_ORDERS || m.orders === 0) ? "HIGH" : "MEDIUM";
  return {
    cvrPct,
    cvrOk: m.clicks >= MIN_CLICKS_FOR_CVR ? (cvrPct ?? 0) >= SKU_CHAT_CVR_TARGET_PCT : null,
    acosPct,
    acosOk: rules.breakEvenAcosPct && acosPct !== null ? acosPct < rules.breakEvenAcosPct : null,
    noSales: noSales || undefined,
    contribution: rules.profitBeforeAds != null ? round(m.orders * rules.profitBeforeAds - m.spend) : null,
    confidence,
  };
}

export async function resolveSkuChatScope(scope: DataScope, storeId: string, sku: string): Promise<SkuChatScope> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ id: string; name: string }>>`
    SELECT id, name FROM ppc_stores WHERE id::text = ${storeId} LIMIT 1
  `;
  if (!rows[0]) throw new Error("Không tìm thấy store của SKU.");
  return { scope, storeId: rows[0].id, storeName: rows[0].name, sku: sku.trim().toUpperCase() };
}

// ---------------- Kế toán ----------------

async function loadAccounting(ctx: SkuChatScope) {
  const accounting = await getAccountingStoreForPpcStore(ctx.storeId).catch(() => null);
  if (!accounting) return null;
  const storeId = accounting.accountingStoreId;
  // Ngày dữ liệu mới nhất của chính store này (đã có cả orders và ads).
  const endDate = await getLatestAvailableAccountingDate(storeId);
  const startDate = shiftDate(endDate, -(ACCOUNTING_PERIOD_DAYS - 1));
  const prevEnd = shiftDate(startDate, -1);
  const prevStart = shiftDate(prevEnd, -(ACCOUNTING_PERIOD_DAYS - 1));

  const period = async (from: string, to: string) => {
    const result = await listSkuWin(storeId, { status: "all", search: ctx.sku, startDate: from, endDate: to, limit: 1000 });
    const item = result.items.find((it) => it.sku.toUpperCase() === ctx.sku);
    if (!item) return null;
    return {
      item,
      metrics: {
        revenue: round(item.revenue),
        units: item.quantity,
        adsSpend: round(item.ads_fee),
        adsSales: round(item.revenue_ads),
        profit: round(item.profit),
        profitPerUnit: round(item.profit_per_item),
        marginPct: round(item.margin * 100, 1),
        tacosPct: round(item.tacos * 100, 1),
        acosPct: item.revenue_ads > 0 ? round((item.ads_fee / item.revenue_ads) * 100, 1) : null,
        returns: item.return_count,
        returnRatePct: round(item.return_rate * 100, 1),
      },
    };
  };

  const trendStart = shiftDate(endDate, -27);
  const sql = await getDatabaseClient();
  const [current, previous, weekly] = await Promise.all([
    period(startDate, endDate),
    period(prevStart, prevEnd),
    // Cùng điều kiện với Lọc SKU: units/revenue từ đơn FBA không hủy, ads theo portfolio chứa SKU.
    sql<Array<{ week: number; units: string; revenue: string; ads_spend: string; ads_sales: string }>>`
      WITH orders AS (
        SELECT ((${endDate}::date - date) / 7) AS week,
               SUM(COALESCE(quantity, 1)) AS units,
               SUM(COALESCE(item_price, 0) * CASE currency WHEN 'CAD' THEN 0.738 WHEN 'MXN' THEN 0.051 WHEN 'USD' THEN 1.0 ELSE 0 END) AS revenue
        FROM accounting_orders
        WHERE store_id = ${storeId} AND UPPER(sku) = ${ctx.sku}
          AND fulfillment_channel = 'Amazon'
          AND (currency IN ('USD', 'CAD', 'MXN') OR amazon_order_id LIKE 'S0%')
          AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
          AND date BETWEEN ${trendStart}::date AND ${endDate}::date
        GROUP BY 1
      ),
      ads AS (
        SELECT ((${endDate}::date - date) / 7) AS week, SUM(spend) AS ads_spend, SUM(sales) AS ads_sales
        FROM accounting_ads
        WHERE store_id = ${storeId}
          AND strpos(LOWER(portfolio), LOWER(${ctx.sku})) > 0
          AND date BETWEEN ${trendStart}::date AND ${endDate}::date
        GROUP BY 1
      )
      SELECT w.week,
             COALESCE(o.units, 0)::text AS units, COALESCE(o.revenue, 0)::text AS revenue,
             COALESCE(a.ads_spend, 0)::text AS ads_spend, COALESCE(a.ads_sales, 0)::text AS ads_sales
      FROM generate_series(0, 3) AS w(week)
      LEFT JOIN orders o ON o.week = w.week
      LEFT JOIN ads a ON a.week = w.week
      ORDER BY w.week DESC
    `,
  ]);

  const weekLabels = ["3 tuần trước", "2 tuần trước", "Tuần trước", "7 ngày gần nhất"];
  const item = current?.item;
  return {
    dataAsOf: endDate,
    period: { current: `${startDate} → ${endDate}`, previous: `${prevStart} → ${prevEnd}`, days: ACCOUNTING_PERIOD_DAYS },
    current: current?.metrics ?? null,
    previous: previous?.metrics ?? null,
    changePct: current && previous
      ? {
        revenue: changePct(current.metrics.revenue, previous.metrics.revenue),
        units: changePct(current.metrics.units, previous.metrics.units),
        adsSpend: changePct(current.metrics.adsSpend, previous.metrics.adsSpend),
        profit: changePct(current.metrics.profit, previous.metrics.profit),
      }
      : null,
    allTimeUnits: item?.all_time_quantity ?? null,
    // Chỉ tiêu do team đặt trong Lọc SKU (nếu có).
    targets: item && (item.revenue_target || item.unit_target || item.spend_target || item.profit_target)
      ? { revenue: item.revenue_target, units: item.unit_target, adsSpend: item.spend_target, profit: item.profit_target }
      : null,
    weeklyTrend: weekly.map((w, idx) => {
      const adsSpend = Number(w.ads_spend);
      const adsSales = Number(w.ads_sales);
      return {
        week: weekLabels[idx] || `Tuần ${idx + 1}`,
        units: Number(w.units),
        revenue: round(Number(w.revenue)),
        adsSpend: round(adsSpend),
        acosPct: pct(adsSpend, adsSales),
      };
    }),
  };
}

// ---------------- Đề xuất Auto Bid (cùng nguồn Block C) ----------------

/** Cùng key Redis với API /api/ppc/recommendations/grouped nên số khớp Block C và không tính lại. */
export async function loadSkuRecommendations(ctx: SkuChatScope): Promise<PpcRecommendation[]> {
  const result = await getCachedOrFetch(
    groupedRecommendationsRedisKey(ctx.scope.teamId, ctx.storeName, RECOMMENDATION_WINDOW_DAYS, false),
    RECOMMENDATION_CACHE_TTL_SECONDS,
    async () => {
      const targetRows = await listTargetRowsForRecommendations(
        ctx.scope,
        { storeName: ctx.storeName, days: RECOMMENDATION_WINDOW_DAYS, includePaused: false },
        { unbounded: true },
      );
      return getGroupedRecommendations(ctx.storeId, targetRows, RECOMMENDATION_WINDOW_DAYS);
    },
  );
  return (result?.allRecommendations || []).filter((r) => (r.sku || "").toUpperCase() === ctx.sku);
}

/** Hiệu quả theo campaign / phôi 30 ngày, gom từ target trong đề xuất, kèm số đề xuất của từng campaign. */
function buildCampaignBreakdown(recs: PpcRecommendation[], rules: SkuRules) {
  const byCampaign = new Map<string, {
    targets: number; clicks: number; orders: number; spend: number; sales: number;
    increase: number; decrease: number; pause: number; paused: boolean;
  }>();
  for (const rec of recs) {
    const name = rec.campaignName || "(không tên)";
    const agg = byCampaign.get(name) || {
      targets: 0, clicks: 0, orders: 0, spend: 0, sales: 0, increase: 0, decrease: 0, pause: 0, paused: false,
    };
    agg.targets += 1;
    agg.clicks += Number(rec.clicks || 0);
    agg.orders += Number(rec.orders || 0);
    agg.spend += Number(rec.spend || 0);
    agg.sales += Number(rec.sales || 0);
    if (rec.recType === "BID_INCREASE") agg.increase += 1;
    else if (rec.recType === "BID_DECREASE") agg.decrease += 1;
    else if (rec.recType === "PAUSE_TARGET") agg.pause += 1;
    if (rec.campaignState && rec.campaignState !== "enabled") agg.paused = true;
    byCampaign.set(name, agg);
  }

  const campaigns = [...byCampaign.entries()]
    .map(([name, agg]) => ({
      campaign: name,
      family: campaignFamily(name),
      match: campaignMatch(name),
      paused: agg.paused || undefined,
      targets: agg.targets,
      clicks: agg.clicks,
      orders: agg.orders,
      spend: round(agg.spend),
      sales: round(agg.sales),
      ...judgeMetrics(agg, rules),
      cpc: agg.clicks > 0 ? round(agg.spend / agg.clicks) : null,
      ruleRecs: { increase: agg.increase, decrease: agg.decrease, pause: agg.pause },
    }))
    .sort((a, b) => b.spend - a.spend);

  const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const byFamily = new Map<string, { spend: number; sales: number; orders: number; clicks: number; campaigns: number }>();
  for (const c of campaigns) {
    const agg = byFamily.get(c.family) || { spend: 0, sales: 0, orders: 0, clicks: 0, campaigns: 0 };
    agg.spend += c.spend;
    agg.sales += c.sales;
    agg.orders += c.orders;
    agg.clicks += c.clicks;
    agg.campaigns += 1;
    byFamily.set(c.family, agg);
  }

  const recCount = (type: PpcRecommendation["recType"]) => recs.filter((r) => r.recType === type).length;
  return {
    source: "Target 30 ngày trong đề xuất Auto Bid (Block C). Tổng có thể lệch Block B vì Block B lấy từ nguồn SKU Economics.",
    totals: {
      campaigns: campaigns.length,
      targets: recs.length,
      spend: round(totalSpend),
      sales: round(campaigns.reduce((sum, c) => sum + c.sales, 0)),
      orders: campaigns.reduce((sum, c) => sum + c.orders, 0),
      clicks: campaigns.reduce((sum, c) => sum + c.clicks, 0),
      ruleRecs: { increase: recCount("BID_INCREASE"), decrease: recCount("BID_DECREASE"), pause: recCount("PAUSE_TARGET") },
      targetsAboveMaxBid: rules.maxBid ? recs.filter((r) => Number(r.currentBid || 0) > rules.maxBid!).length : null,
    },
    byFamily: [...byFamily.entries()]
      .map(([family, agg]) => ({
        family,
        campaigns: agg.campaigns,
        spend: round(agg.spend),
        spendSharePct: pct(agg.spend, totalSpend),
        sales: round(agg.sales),
        orders: agg.orders,
        ...judgeMetrics(agg, rules),
      }))
      .sort((a, b) => b.spend - a.spend),
    // Top theo spend; phần còn lại gom thành 1 dòng để snapshot gọn.
    topCampaigns: campaigns.slice(0, 20),
    otherCampaigns: campaigns.length > 20
      ? {
        count: campaigns.length - 20,
        spend: round(campaigns.slice(20).reduce((sum, c) => sum + c.spend, 0)),
        orders: campaigns.slice(20).reduce((sum, c) => sum + c.orders, 0),
      }
      : null,
  };
}

// ---------------- Search term ----------------

/**
 * Search term report có thể trễ vài tuần so với hôm nay, nên cửa sổ ngày neo theo
 * ngày report mới nhất của SKU thay vì CURRENT_DATE.
 */
export async function latestSearchTermDate(ctx: SkuChatScope): Promise<string | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ latest: string | null }>>`
    SELECT MAX(report_end_date)::text AS latest
    FROM ppc_search_terms
    WHERE store_id = ${ctx.storeId} AND UPPER(sku) = ${ctx.sku} AND report_granularity = 'DAILY'
  `;
  return rows[0]?.latest ?? null;
}

async function loadSearchTermSummary(ctx: SkuChatScope, minClicks: number) {
  const latest = await latestSearchTermDate(ctx);
  if (!latest) return null;
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ terms: number; waste_terms: number; waste_spend: string; sale_terms: number; total_spend: string }>>`
    WITH terms AS (
      SELECT LOWER(TRIM(customer_search_term)) AS term,
             SUM(clicks) AS clicks, SUM(orders) AS orders, SUM(spend) AS spend
      FROM ppc_search_terms
      WHERE store_id = ${ctx.storeId} AND UPPER(sku) = ${ctx.sku}
        AND report_granularity = 'DAILY'
        AND report_end_date > ${latest}::date - 30
      GROUP BY 1
    )
    SELECT COUNT(*)::int AS terms,
           COUNT(*) FILTER (WHERE orders = 0 AND clicks >= ${minClicks})::int AS waste_terms,
           COALESCE(SUM(spend) FILTER (WHERE orders = 0 AND clicks >= ${minClicks}), 0)::text AS waste_spend,
           COUNT(*) FILTER (WHERE orders >= 2)::int AS sale_terms,
           COALESCE(SUM(spend), 0)::text AS total_spend
    FROM terms
  `;
  const row = rows[0];
  const staleDays = Math.round((Date.now() - new Date(`${latest}T00:00:00Z`).getTime()) / 86_400_000);
  return {
    dataAsOf: latest,
    staleDays,
    windowDays: 30,
    terms: row?.terms ?? 0,
    totalSpend: round(Number(row?.total_spend || 0)),
    wasteRule: `0 đơn và clicks ≥ ${minClicks}`,
    wasteTerms: row?.waste_terms ?? 0,
    wasteSpend: round(Number(row?.waste_spend || 0)),
    saleTermsAtLeast2Orders: row?.sale_terms ?? 0,
  };
}

export type SearchTermFilter = "waste" | "converting" | "top_spend";

export async function querySearchTerms(
  ctx: SkuChatScope,
  options: { filter: SearchTermFilter; days: number; campaignContains?: string; minClicks: number; limit: number },
  rules: SkuRules,
) {
  const latest = await latestSearchTermDate(ctx);
  if (!latest) return { hasData: false, message: "SKU này chưa có search term report." };
  const sql = await getDatabaseClient();
  const { filter, days, minClicks, limit } = options;
  const campaign = options.campaignContains?.trim() || "";

  const rows = await sql<Array<{
    term: string; clicks: string; orders: string; spend: string; sales: string; campaigns: string; match_types: string;
  }>>`
    SELECT LOWER(TRIM(customer_search_term)) AS term,
           SUM(clicks)::text AS clicks, SUM(orders)::text AS orders,
           SUM(spend)::text AS spend, SUM(sales)::text AS sales,
           STRING_AGG(DISTINCT campaign_name, ' | ') AS campaigns,
           STRING_AGG(DISTINCT match_type, ',') AS match_types
    FROM ppc_search_terms
    WHERE store_id = ${ctx.storeId} AND UPPER(sku) = ${ctx.sku}
      AND report_granularity = 'DAILY'
      AND report_end_date > ${latest}::date - ${days}::int
      ${campaign ? sql`AND campaign_name ILIKE ${"%" + campaign + "%"}` : sql``}
    GROUP BY 1
    HAVING ${filter === "waste"
      ? sql`SUM(orders) = 0 AND SUM(clicks) >= ${minClicks}`
      : filter === "converting" ? sql`SUM(orders) > 0` : sql`SUM(spend) > 0`}
    ORDER BY ${filter === "converting" ? sql`SUM(orders) DESC, SUM(spend) ASC` : sql`SUM(spend) DESC`}
    LIMIT ${limit}
  `;
  return {
    dataAsOf: latest,
    windowDays: days,
    filter,
    minClicks: filter === "waste" ? minClicks : undefined,
    count: rows.length,
    terms: rows.map((r) => {
      const spend = Number(r.spend);
      const sales = Number(r.sales);
      const clicks = Number(r.clicks);
      const orders = Number(r.orders);
      return {
        term: r.term,
        clicks,
        orders,
        spend: round(spend),
        sales: round(sales),
        ...judgeMetrics({ clicks, orders, spend, sales }, rules),
        matchTypes: r.match_types,
        campaigns: r.campaigns.length > 240 ? `${r.campaigns.slice(0, 240)}…` : r.campaigns,
      };
    }),
  };
}

export function recView(r: PpcRecommendation, rules: SkuRules) {
  const metrics = {
    clicks: Number(r.clicks || 0),
    orders: Number(r.orders || 0),
    spend: round(Number(r.spend || 0)),
    sales: round(Number(r.sales || 0)),
  };
  const ruleNewBid = r.recType === "PAUSE_TARGET" ? null : r.recommendedBid ?? null;
  return {
    campaign: r.campaignName,
    keyword: r.keyword,
    matchType: r.matchType,
    ...metrics,
    ...judgeMetrics(metrics, rules),
    currentBid: r.currentBid ?? null,
    bidAboveMax: rules.maxBid && r.currentBid ? r.currentBid > rules.maxBid : undefined,
    ruleType: r.recType,
    ruleNewBid,
    ruleNewBidAboveMax: rules.maxBid && ruleNewBid ? ruleNewBid > rules.maxBid : undefined,
    ruleReason: r.reason,
  };
}

// ---------------- Tồn kho ----------------

async function loadInventory(ctx: SkuChatScope) {
  const accounting = await getAccountingStoreForPpcStore(ctx.storeId).catch(() => null);
  if (!accounting) return null;
  const sql = await getDatabaseClient();
  const [balance, inbound] = await Promise.all([
    sql<Array<{ sellable: string; in_transit: string; unsellable: string; snapshot_date: string | null }>>`
      SELECT COALESCE(SUM(sellable_balance), 0)::text AS sellable,
             COALESCE(SUM(in_transit_between_warehouses), 0)::text AS in_transit,
             COALESCE(SUM(unsellable_balance), 0)::text AS unsellable,
             MAX(snapshot_date)::text AS snapshot_date
      FROM accounting_inventory_balance
      WHERE store_id = ${accounting.accountingStoreId} AND UPPER(sku) = ${ctx.sku}
    `,
    sql<Array<{ pending_units: string; shipments: number; next_arrival: string | null }>>`
      SELECT COALESCE(SUM(quantity - COALESCE(amazon_received, 0)), 0)::text AS pending_units,
             COUNT(*)::int AS shipments,
             MIN(ngay_den)::text AS next_arrival
      FROM accounting_inbound_shipments
      WHERE store_id = ${accounting.accountingStoreId} AND UPPER(sku) = ${ctx.sku}
        AND (amazon_received IS NULL OR amazon_received < quantity)
    `,
  ]);
  const row = balance[0];
  if (!row?.snapshot_date && !inbound[0]?.shipments) return null;
  return {
    sellable: Number(row?.sellable || 0),
    inTransitBetweenWarehouses: Number(row?.in_transit || 0),
    unsellable: Number(row?.unsellable || 0),
    snapshotDate: row?.snapshot_date || null,
    inboundPendingUnits: Number(inbound[0]?.pending_units || 0),
    inboundShipments: inbound[0]?.shipments || 0,
    nextArrival: inbound[0]?.next_arrival || null,
  };
}

// ---------------- Lịch sử chỉnh bid ----------------

const OUTCOME_TEXT: Record<string, string> = {
  POSITIVE: "Tốt",
  NEUTRAL: "Trung tính",
  NEGATIVE: "Xấu",
  INCONCLUSIVE: "Không kết luận được",
  INTERRUPTED: "Bị chỉnh đè",
};

export async function loadBidHistory(ctx: SkuChatScope, options: { keyword?: string; limit?: number } = {}) {
  const sql = await getDatabaseClient();
  const keyword = options.keyword?.trim() || "";
  const rows = await sql<Array<{
    target_keyword: string; campaign_name: string; action_type: string;
    old_value: string | null; final_value: string | null; status: string; acted_on: string; outcome_label: string | null;
  }>>`
    SELECT a.target_keyword, a.campaign_name, a.action_type, a.old_value::text, a.final_value::text, a.status,
           COALESCE(a.approved_at, a.created_at)::date::text AS acted_on,
           (SELECT o.outcome_label FROM ppc_action_outcomes o
             WHERE o.action_id = a.id AND o.outcome_label IS NOT NULL
             ORDER BY (o.outcome_label IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')) DESC, o.window_days DESC
             LIMIT 1) AS outcome_label
    FROM ppc_actions a
    WHERE a.store_id = ${ctx.storeId} AND UPPER(a.sku) = ${ctx.sku}
      AND a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND a.status NOT IN ('SUPERSEDED')
      ${keyword ? sql`AND LOWER(TRIM(a.target_keyword)) = LOWER(TRIM(${keyword}))` : sql``}
    ORDER BY COALESCE(a.approved_at, a.created_at) DESC
    LIMIT ${Math.min(20, Math.max(1, options.limit || 10))}
  `;
  return rows.map((row) => ({
    actedOn: row.acted_on,
    keyword: row.target_keyword,
    campaign: row.campaign_name,
    action: row.action_type === "PAUSE_TARGET" ? "Tạm dừng" : "Chỉnh bid",
    oldBid: row.old_value !== null ? round(Number(row.old_value)) : null,
    newBid: row.action_type === "PAUSE_TARGET" || row.final_value === null ? null : round(Number(row.final_value)),
    status: row.status,
    result: row.outcome_label
      ? OUTCOME_TEXT[row.outcome_label] || row.outcome_label
      : row.status === "APPLIED" || row.status === "EXPORTED" ? "Đang theo dõi" : null,
  }));
}

async function loadBidOutcomeSummary(ctx: SkuChatScope) {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ direction: string; label: string; total: number }>>`
    SELECT CASE
             WHEN a.action_type = 'PAUSE_TARGET' THEN 'PAUSE'
             WHEN a.final_value::numeric > a.old_value::numeric THEN 'INCREASE'
             ELSE 'DECREASE'
           END AS direction,
           COALESCE((SELECT o.outcome_label FROM ppc_action_outcomes o
                      WHERE o.action_id = a.id AND o.outcome_label IS NOT NULL
                      ORDER BY o.window_days DESC LIMIT 1), 'PENDING') AS label,
           COUNT(*)::int AS total
    FROM ppc_actions a
    WHERE a.store_id = ${ctx.storeId} AND UPPER(a.sku) = ${ctx.sku}
      AND a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND a.status IN ('APPLIED', 'EXPORTED')
      AND COALESCE(a.approved_at, a.created_at) >= NOW() - INTERVAL '90 days'
    GROUP BY 1, 2
  `;
  const summary: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    summary[row.direction] ||= {};
    summary[row.direction][row.label] = row.total;
  }
  return summary;
}

// ---------------- Snapshot ----------------

/** Snapshot đầy đủ của SKU cho AI: số đã tính sẵn để AI không phải tự tính. Cache 10 phút. */
export async function buildSkuSnapshot(ctx: SkuChatScope) {
  return getCachedOrFetch(
    `ppc:sku-ai-chat:snapshot:${ctx.scope.teamId}:${ctx.storeId}:${ctx.sku}`,
    SNAPSHOT_TTL_SECONDS,
    async () => {
      const [accounting, economicsList, recs, inventory, bidOutcomes, recentBidHistory] = await Promise.all([
        loadAccounting(ctx).catch(() => null),
        getSkuEconomicsList(ctx.storeId, RECOMMENDATION_WINDOW_DAYS).catch(() => []),
        loadSkuRecommendations(ctx).catch(() => []),
        loadInventory(ctx).catch(() => null),
        loadBidOutcomeSummary(ctx).catch(() => ({})),
        loadBidHistory(ctx, { limit: 8 }).catch(() => []),
      ]);
      const economics = economicsList.find((e) => e.sku.toUpperCase() === ctx.sku);
      const cr = Number(economics?.cr || 0);
      const breakEven = economics?.breakEvenAcos ?? null;
      const maxBid = economics?.maxBid ?? null;
      const rules: SkuRules = { breakEvenAcosPct: breakEven, maxBid, profitBeforeAds: economics?.profitBeforeAds ?? null };
      // Nạp sẵn thứ AI hầu như luôn cần để câu nhận xét tổng quan không phải gọi tool (mỗi vòng tool ~10s).
      const [searchTerms, wasteTerms, convertingTerms] = await Promise.all([
        loadSearchTermSummary(ctx, MIN_CLICKS_FOR_NEGATIVE).catch(() => null),
        querySearchTerms(ctx, { filter: "waste", days: 30, minClicks: MIN_CLICKS_FOR_NEGATIVE, limit: 8 }, rules).catch(() => null),
        querySearchTerms(ctx, { filter: "converting", days: 30, minClicks: MIN_CLICKS_FOR_CVR, limit: 8 }, rules).catch(() => null),
      ]);
      const topBidRecommendations = [...recs]
        .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
        .slice(0, 12)
        .map((r) => recView(r, rules));

      // PPC 30 ngày = Block B (SKU Economics).
      const ppc = economics && (economics.spend || economics.sales || economics.clicks)
        ? {
          spend: round(Number(economics.spend || 0)),
          sales: round(Number(economics.sales || 0)),
          orders: Number(economics.orders || 0),
          clicks: Number(economics.clicks || 0),
          acosPct: Number(economics.sales || 0) > 0 ? round(Number(economics.acos || 0), 1) : null,
        }
        : null;
      const current = accounting?.current ?? null;
      const spendPerOrder = ppc && ppc.orders > 0 ? round(ppc.spend / ppc.orders) : null;
      const unitsPerDay = current ? current.units / ACCOUNTING_PERIOD_DAYS : 0;
      const derived = {
        acosBeRatio: ppc?.acosPct != null && economics?.breakEvenAcos ? ratio(ppc.acosPct, economics.breakEvenAcos) : null,
        spendPerOrder,
        profitPerOrderAfterAds: spendPerOrder !== null && economics ? round(economics.profitBeforeAds - spendPerOrder) : null,
        actualClicksPerOrder: ppc && ppc.orders > 0 ? round(ppc.clicks / ppc.orders, 1) : null,
        // Chấm tổng SKU theo 3 tiêu chí của team.
        verdict: ppc
          ? {
            ...judgeMetrics(ppc, rules),
            cvrTargetPct: SKU_CHAT_CVR_TARGET_PCT,
            breakEvenAcosPct: breakEven,
            maxBid,
          }
          : null,
        adsSalesShare: current ? ratio(current.adsSales, current.revenue) : null,
        unitsPerDay: round(unitsPerDay),
        daysOfCover: inventory && unitsPerDay > 0 ? Math.round(inventory.sellable / unitsPerDay) : null,
      };

      const dataNotes: string[] = [];
      if (!accounting?.current) dataNotes.push("Không có số kế toán của SKU trong 14 ngày gần nhất.");
      if (current && current.units === 0 && current.adsSales > 0) {
        dataNotes.push("Kế toán ghi 0 units nhưng ads vẫn có sales: có thể đơn hàng chưa import kịp.");
      }
      if (searchTerms && searchTerms.staleDays > 3) {
        dataNotes.push(`Search term report mới nhất ngày ${searchTerms.dataAsOf} (trễ ${searchTerms.staleDays} ngày); số search term là của 30 ngày tính tới ngày đó.`);
      }
      if (!searchTerms) dataNotes.push("Chưa có search term report cho SKU này.");

      return {
        generatedAt: new Date().toISOString(),
        store: ctx.storeName,
        sku: ctx.sku,
        asin: economics?.asin ?? null,
        productType: economics?.productType ?? null,
        status: economics?.skuStatus ?? null,
        niche: economics?.niche ?? null,
        pic: economics?.picMkt ?? null,
        unitEconomics: economics
          ? {
            price: economics.sellingPrice,
            baseCost: economics.baseCost,
            amazonFee: economics.amazonFee,
            taxRate: economics.taxRate,
            profitBeforeAds: economics.profitBeforeAds,
            breakEvenAcosPct: economics.breakEvenAcos,
            crPct: round(cr * 100, 1),
            crSource: economics.crSource,
            maxBid: economics.maxBid,
            // Max Bid = CR × lãi trước ads; nhập tay thì là MANUAL. CR giả định thì Max Bid chỉ là ước lượng.
            maxBidBasis: economics.maxBidOverride != null
              ? "MANUAL"
              : economics.crSource === "ASSUMED" ? "ASSUMED_CR" : "ACTUAL_CR",
          }
          : null,
        accounting,
        ppc30d: ppc,
        derived,
        campaigns: buildCampaignBreakdown(recs, rules),
        // Top 12 target theo spend kèm bid hiện tại, đề xuất rule và cờ đạt / không đạt.
        topBidRecommendations,
        searchTerms: searchTerms
          ? {
            ...searchTerms,
            topWaste: wasteTerms && "terms" in wasteTerms ? wasteTerms.terms : [],
            topConverting: convertingTerms && "terms" in convertingTerms ? convertingTerms.terms : [],
          }
          : null,
        bidOutcomes90d: bidOutcomes,
        recentBidHistory,
        inventory,
        dataNotes,
      };
    },
  );
}

export type SkuSnapshot = Awaited<ReturnType<typeof buildSkuSnapshot>>;
