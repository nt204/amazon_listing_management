import type {
  MatchType,
  PpcAdTypeBreakdown,
  PpcAdGroupPerformance,
  PpcAlert,
  PpcCampaignPerformance,
  PpcDailyTrendPoint,
  PpcDataHealth,
  PpcExecutiveOverview,
  PpcKeywordMatchType,
  PpcKeywordMatchTypeBreakdown,
  PpcMatchTypeBreakdown,
  PpcMetricComparison,
  PpcPerformanceRow,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSearchTermSummary,
  PpcSkuPerformance,
  PpcSummaryMetrics,
  PpcTargetPerformance,
  PpcTargetType,
  PpcTargetTypeBreakdown,
} from "./types";

/**
 * Hàm trợ giúp so sánh 2 chu kỳ (Current Period vs Previous Period)
 * - changePct: Thay đổi tương đối (%)
 * - changePts: Điểm phần trăm chênh lệch tuyệt đối (dành cho ACOS, CVR, CTR)
 */
function makeMetricComparison(
  current: number,
  previous: number,
  options: { isRatio?: boolean; decimals?: number } = {}
): PpcMetricComparison {
  const decimals = options.decimals ?? 2;
  const currRounded = Number(current.toFixed(decimals));
  const prevRounded = Number(previous.toFixed(decimals));

  const changePct =
    prevRounded > 0
      ? Number((((currRounded - prevRounded) / prevRounded) * 100).toFixed(1))
      : undefined;

  const changePts = options.isRatio
    ? Number((currRounded - prevRounded).toFixed(decimals))
    : undefined;

  return {
    current: currRounded,
    previous: prevRounded,
    changePct,
    changePts,
  };
}

/**
 * Tính toán tổng quan KPI (Executive Overview) theo 4 hàng chuẩn Phase 1:
 * - Row 1: Core KPI (Spend, Sales, Orders, Impressions, Clicks, ACOS, ROAS, CVR)
 * - Row 2: Efficiency Metrics (CTR, CPC, CPA, AOV)
 * BẮT BUỘC tính từ Raw Totals; hỗ trợ so sánh chu kỳ trước (Previous Period Comparison).
 */
export function calculatePpcExecutiveOverview(
  currentRows: PpcSearchTermRow[],
  previousRows: PpcSearchTermRow[] = []
): PpcExecutiveOverview {
  // 1. Raw totals chu kỳ hiện tại
  let curSpend = 0;
  let curSales = 0;
  let curOrders = 0;
  let curClicks = 0;
  let curImpressions = 0;

  for (const r of currentRows) {
    curSpend += r.spend;
    curSales += r.sales;
    curOrders += r.orders;
    curClicks += r.clicks;
    curImpressions += r.impressions;
  }

  // 2. Derived ratios chu kỳ hiện tại (tính từ Raw Totals)
  const curAcos = curSales > 0 ? (curSpend / curSales) * 100 : curSpend > 0 ? 999 : 0;
  const curRoas = curSpend > 0 ? curSales / curSpend : 0;
  const curCvr = curClicks > 0 ? (curOrders / curClicks) * 100 : 0;
  const curCtr = curImpressions > 0 ? (curClicks / curImpressions) * 100 : 0;
  const curCpc = curClicks > 0 ? curSpend / curClicks : 0;
  const curCpa = curOrders > 0 ? curSpend / curOrders : 0;
  const curAov = curOrders > 0 ? curSales / curOrders : 0;

  // 3. Raw totals chu kỳ trước
  let prevSpend = 0;
  let prevSales = 0;
  let prevOrders = 0;
  let prevClicks = 0;
  let prevImpressions = 0;

  for (const r of previousRows) {
    prevSpend += r.spend;
    prevSales += r.sales;
    prevOrders += r.orders;
    prevClicks += r.clicks;
    prevImpressions += r.impressions;
  }

  // 4. Derived ratios chu kỳ trước (tính từ Raw Totals)
  const prevAcos = prevSales > 0 ? (prevSpend / prevSales) * 100 : prevSpend > 0 ? 999 : 0;
  const prevRoas = prevSpend > 0 ? prevSales / prevSpend : 0;
  const prevCvr = prevClicks > 0 ? (prevOrders / prevClicks) * 100 : 0;
  const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : 0;
  const prevCpc = prevClicks > 0 ? prevSpend / prevClicks : 0;
  const prevCpa = prevOrders > 0 ? prevSpend / prevOrders : 0;
  const prevAov = prevOrders > 0 ? prevSales / prevOrders : 0;

  return {
    // Row 1: Core KPI
    spend: makeMetricComparison(curSpend, prevSpend),
    sales: makeMetricComparison(curSales, prevSales),
    orders: makeMetricComparison(curOrders, prevOrders, { decimals: 0 }),
    impressions: makeMetricComparison(curImpressions, prevImpressions, { decimals: 0 }),
    clicks: makeMetricComparison(curClicks, prevClicks, { decimals: 0 }),
    acos: makeMetricComparison(curAcos, prevAcos, { isRatio: true, decimals: 1 }),
    roas: makeMetricComparison(curRoas, prevRoas, { decimals: 2 }),
    cvr: makeMetricComparison(curCvr, prevCvr, { isRatio: true, decimals: 2 }),

    // Row 2: Efficiency Metrics
    ctr: makeMetricComparison(curCtr, prevCtr, { isRatio: true, decimals: 2 }),
    cpc: makeMetricComparison(curCpc, prevCpc, { decimals: 2 }),
    cpa: makeMetricComparison(curCpa, prevCpa, { decimals: 2 }),
    aov: makeMetricComparison(curAov, prevAov, { decimals: 2 }),
  };
}

/**
 * Tính toán tổng hợp chỉ số KPI cho danh sách Search Terms
 * Wasted Spend được tính theo Principle 2 (Product Economics threshold: clicks >= 10 hoặc spend >= $15 mà orders = 0)
 */
export function calculatePpcSummary(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0,
  options?: { minClicksThreshold?: number; maxSpendThreshold?: number }
): PpcSummaryMetrics {
  const minClicks = options?.minClicksThreshold ?? 10;
  const maxSpend = options?.maxSpendThreshold ?? (targetAcos * 0.5 > 15 ? targetAcos * 0.5 : 15.0);

  let totalSpend = 0;
  let totalSales = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalOrders = 0;
  let totalUnits = 0;
  let wastedSpend = 0;

  for (const r of rows) {
    totalSpend += r.spend;
    totalSales += r.sales;
    totalClicks += r.clicks;
    totalImpressions += r.impressions;
    totalOrders += r.orders;
    totalUnits += r.units;

    // Nguyên tắc 2: Không phạt các term mới chỉ 1-2 click thử nghiệm
    if (r.orders === 0 && (r.clicks >= minClicks || r.spend >= maxSpend)) {
      wastedSpend += r.spend;
    }
  }

  // Derived from Raw Totals
  const blendedAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : totalSpend > 0 ? 999 : 0;
  const blendedRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const overallCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 10000 : 0;
  const overallCvr = totalClicks > 0 ? Math.round((totalOrders / totalClicks) * 10000) / 10000 : 0;
  const cpa = totalOrders > 0 ? totalSpend / totalOrders : 0;
  const aov = totalOrders > 0 ? totalSales / totalOrders : 0;

  const alerts = generatePpcAlerts(rows, targetAcos);
  const recs = generatePpcRecommendations(rows, targetAcos);

  return {
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalSales: Math.round(totalSales * 100) / 100,
    blendedAcos: Math.round(blendedAcos * 10) / 10,
    blendedRoas: Math.round(blendedRoas * 100) / 100,
    totalClicks,
    totalImpressions,
    totalOrders,
    totalUnits,
    avgCpc: Math.round(avgCpc * 100) / 100,
    overallCtr,
    overallCvr,
    cpa: Math.round(cpa * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    wastedSpend: Math.round(wastedSpend * 100) / 100,
    activeAlertsCount: alerts.length,
    pendingRecsCount: recs.length,
  };
}

/**
 * Thống kê chuyên biệt cho màn Search Term Analysis (Mục 14 Đặc tả)
 */
export function calculatePpcSearchTermSummary(
  rows: PpcSearchTermRow[],
  options?: { minClicksThreshold?: number; maxSpendThreshold?: number }
): PpcSearchTermSummary {
  const minClicks = options?.minClicksThreshold ?? 10;
  const maxSpend = options?.maxSpendThreshold ?? 15.0;

  let termsWithOrders = 0;
  let termsWithoutOrders = 0;
  let candidateBleederTerms = 0;
  let observedSpend = 0;
  let observedSales = 0;
  let observedOrders = 0;
  let observedClicks = 0;
  let wastedSpend = 0;

  for (const r of rows) {
    observedSpend += r.spend;
    observedSales += r.sales;
    observedOrders += r.orders;
    observedClicks += r.clicks;

    if (r.orders > 0) {
      termsWithOrders += 1;
    } else {
      termsWithoutOrders += 1;
      if (r.clicks >= minClicks || r.spend >= maxSpend) {
        candidateBleederTerms += 1;
        wastedSpend += r.spend;
      }
    }
  }

  const observedAcos = observedSales > 0 ? (observedSpend / observedSales) * 100 : 0;
  const observedRoas = observedSpend > 0 ? observedSales / observedSpend : 0;

  return {
    totalTerms: rows.length,
    termsWithOrders,
    termsWithoutOrders,
    candidateBleederTerms,
    observedSpend: Math.round(observedSpend * 100) / 100,
    observedSales: Math.round(observedSales * 100) / 100,
    observedOrders,
    observedClicks,
    observedAcos: Math.round(observedAcos * 10) / 10,
    observedRoas: Math.round(observedRoas * 100) / 100,
    wastedSpend: Math.round(wastedSpend * 100) / 100,
  };
}

/**
 * Nguyên tắc 3: Mô hình chấm điểm ứng viên Harvest đa chiều
 * HARVEST_SCORE = Performance + Conversion Evidence + Volume + Relevance + Statistical Confidence
 */
export function calculateHarvestScore(
  row: PpcSearchTermRow,
  targetAcos = 30.0
): number {
  if (row.orders <= 0) return 0;

  // 1. Performance component (ACOS so với Target ACOS)
  const acosRatio = targetAcos > 0 ? (targetAcos - row.acos) / targetAcos : 0;
  const performanceScore = Math.max(0, Math.min(40, acosRatio * 30 + 10));

  // 2. Conversion Evidence (Số đơn hàng)
  const conversionScore = Math.min(30, row.orders * 8);

  // 3. Statistical Confidence & Volume (Dựa trên clicks & conversion rate)
  const cvr = row.clicks > 0 ? row.orders / row.clicks : 0;
  const confidenceScore = Math.min(20, row.clicks * 0.5 + cvr * 50);

  // 4. Relevance & Match context (Nếu là Auto/Broad kích hoạt term liên quan)
  const matchBonus = row.matchType === "Auto" ? 10 : row.matchType === "Broad" ? 8 : 5;

  const totalScore = Math.round(performanceScore + conversionScore + confidenceScore + matchBonus);
  return Math.min(100, Math.max(0, totalScore));
}

/**
 * Bóc tách và nhóm số liệu theo Campaign
 * Grain: 1 row = 1 Campaign
 */
export function groupPpcByCampaign(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0
): PpcCampaignPerformance[] {
  const map = new Map<
    string,
    {
      campaignName: string;
      storeName: string;
      targetingType: "Auto" | "Manual";
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
    }
  >();

  for (const r of rows) {
    const key = `${r.storeName || "Store"}__${r.campaignName || "Default"}`;
    const existing = map.get(key);
    const isAuto =
      r.matchType === "Auto" ||
      r.campaignName.toLowerCase().includes("auto") ||
      r.targetKeyword.toLowerCase().includes("close-match");

    if (!existing) {
      map.set(key, {
        campaignName: r.campaignName || "Unnamed Campaign",
        storeName: r.storeName || "Store",
        targetingType: isAuto ? "Auto" : "Manual",
        spend: r.spend,
        sales: r.sales,
        orders: r.orders,
        clicks: r.clicks,
        impressions: r.impressions,
      });
    } else {
      existing.spend += r.spend;
      existing.sales += r.sales;
      existing.orders += r.orders;
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
    }
  }

  const results: PpcCampaignPerformance[] = [];

  for (const item of map.values()) {
    const acos = item.sales > 0 ? (item.spend / item.sales) * 100 : item.spend > 0 ? 999 : 0;
    const roas = item.spend > 0 ? item.sales / item.spend : 0;
    const cvr = item.clicks > 0 ? (item.orders / item.clicks) * 100 : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpa = item.orders > 0 ? item.spend / item.orders : 0;
    const aov = item.orders > 0 ? item.sales / item.orders : 0;

    let statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL" = "GOOD";
    if (acos <= 20 && item.orders > 0) statusBadge = "EXCELLENT";
    else if (acos <= targetAcos && item.orders > 0) statusBadge = "GOOD";
    else if (acos <= 60 && item.orders > 0) statusBadge = "WARNING";
    else statusBadge = "CRITICAL";

    results.push({
      campaignName: item.campaignName,
      storeName: item.storeName,
      targetingType: item.targetingType,
      spend: Math.round(item.spend * 100) / 100,
      sales: Math.round(item.sales * 100) / 100,
      orders: item.orders,
      clicks: item.clicks,
      impressions: item.impressions,
      cpc: Math.round(cpc * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      aov: Math.round(aov * 100) / 100,
      statusBadge,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Bóc tách và nhóm số liệu theo Ad Group
 * Grain: 1 row = 1 Ad Group (trong Campaign)
 */
export function groupPpcByAdGroup(rows: PpcSearchTermRow[]): PpcAdGroupPerformance[] {
  const map = new Map<
    string,
    {
      campaignName: string;
      adGroupName: string;
      storeName: string;
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
    }
  >();

  for (const r of rows) {
    const key = `${r.campaignName || "Default"}\u0000${r.adGroupName || "Default"}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        campaignName: r.campaignName || "Unnamed Campaign",
        adGroupName: r.adGroupName || "Unnamed Ad Group",
        storeName: r.storeName || "Store",
        spend: r.spend,
        sales: r.sales,
        orders: r.orders,
        clicks: r.clicks,
        impressions: r.impressions,
      });
    } else {
      existing.spend += r.spend;
      existing.sales += r.sales;
      existing.orders += r.orders;
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
    }
  }

  const results: PpcAdGroupPerformance[] = [];

  for (const item of map.values()) {
    const acos = item.sales > 0 ? (item.spend / item.sales) * 100 : item.spend > 0 ? 999 : 0;
    const roas = item.spend > 0 ? item.sales / item.spend : 0;
    const cvr = item.clicks > 0 ? (item.orders / item.clicks) * 100 : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpa = item.orders > 0 ? item.spend / item.orders : 0;
    const aov = item.orders > 0 ? item.sales / item.orders : 0;

    results.push({
      campaignName: item.campaignName,
      adGroupName: item.adGroupName,
      storeName: item.storeName,
      spend: Math.round(item.spend * 100) / 100,
      sales: Math.round(item.sales * 100) / 100,
      orders: item.orders,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      aov: Math.round(aov * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Bóc tách và nhóm số liệu theo Target / Keyword (Mục 12 Đặc tả)
 * Grain: 1 row = 1 Target (Campaign + Ad Group + Target Keyword + Match Type)
 */
export function groupPpcByTarget(rows: PpcSearchTermRow[]): PpcTargetPerformance[] {
  const map = new Map<
    string,
    {
      campaignName: string;
      adGroupName: string;
      targetKeyword: string;
      matchType: MatchType;
      storeName: string;
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
    }
  >();

  for (const r of rows) {
    const key = [
      r.campaignName || "Default",
      r.adGroupName || "Default",
      r.targetKeyword || "Default",
      r.matchType || "Unknown",
    ].join("\u0000");

    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        campaignName: r.campaignName || "Unnamed Campaign",
        adGroupName: r.adGroupName || "Unnamed Ad Group",
        targetKeyword: r.targetKeyword || "Unnamed Target",
        matchType: r.matchType || "Unknown",
        storeName: r.storeName || "Store",
        spend: r.spend,
        sales: r.sales,
        orders: r.orders,
        clicks: r.clicks,
        impressions: r.impressions,
      });
    } else {
      existing.spend += r.spend;
      existing.sales += r.sales;
      existing.orders += r.orders;
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
    }
  }

  const results: PpcTargetPerformance[] = [];

  for (const item of map.values()) {
    const acos = item.sales > 0 ? (item.spend / item.sales) * 100 : item.spend > 0 ? 999 : 0;
    const roas = item.spend > 0 ? item.sales / item.spend : 0;
    const cvr = item.clicks > 0 ? (item.orders / item.clicks) * 100 : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpa = item.orders > 0 ? item.spend / item.orders : 0;
    const aov = item.orders > 0 ? item.sales / item.orders : 0;

    results.push({
      campaignName: item.campaignName,
      adGroupName: item.adGroupName,
      targetKeyword: item.targetKeyword,
      matchType: item.matchType,
      storeName: item.storeName,
      spend: Math.round(item.spend * 100) / 100,
      sales: Math.round(item.sales * 100) / 100,
      orders: item.orders,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      aov: Math.round(aov * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Nhóm và tính toán số liệu theo từng SKU / ASIN (Mục 15 Đặc tả)
 * Grain: 1 row = 1 Advertised SKU / ASIN
 */
export function groupPpcBySku(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0
): PpcSkuPerformance[] {
  const map = new Map<
    string,
    {
      sku: string;
      storeName: string;
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
      campaigns: Set<string>;
    }
  >();

  for (const r of rows) {
    const key = `${r.storeName || "Store"}__${r.portfolioName || "Default"}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sku: r.portfolioName || "Unassigned",
        storeName: r.storeName || "Store",
        spend: r.spend || 0,
        sales: r.sales || 0,
        orders: r.orders || 0,
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        campaigns: new Set(r.campaignName ? [r.campaignName] : []),
      });
    } else {
      existing.spend += r.spend || 0;
      existing.sales += r.sales || 0;
      existing.orders += r.orders || 0;
      existing.clicks += r.clicks || 0;
      existing.impressions += r.impressions || 0;
      if (r.campaignName) existing.campaigns.add(r.campaignName);
    }
  }

  const totalStoreSpend = Array.from(map.values()).reduce((sum, i) => sum + i.spend, 0);
  const totalStoreSales = Array.from(map.values()).reduce((sum, i) => sum + i.sales, 0);
  const results: PpcSkuPerformance[] = [];

  for (const item of map.values()) {
    const acos = item.sales > 0 ? (item.spend / item.sales) * 100 : item.spend > 0 ? 999 : 0;
    const roas = item.spend > 0 ? item.sales / item.spend : 0;
    const cvr = item.clicks > 0 ? (item.orders / item.clicks) * 100 : 0;
    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;
    const cpa = item.orders > 0 ? item.spend / item.orders : 0;
    const aov = item.orders > 0 ? item.sales / item.orders : 0;
    const revenueShare = totalStoreSales > 0 ? Math.round((item.sales / totalStoreSales) * 1000) / 10 : 0;
    const spendShare = totalStoreSpend > 0 ? Math.round((item.spend / totalStoreSpend) * 1000) / 10 : 0;

    let statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL" | "ZERO_CLICKS" | "INACTIVE" = "GOOD";
    if (item.clicks === 0) {
      statusBadge = item.impressions > 0 ? "ZERO_CLICKS" : "INACTIVE";
    } else if (acos <= 20 && item.orders > 0) {
      statusBadge = "EXCELLENT";
    } else if (acos <= targetAcos && item.orders > 0) {
      statusBadge = "GOOD";
    } else if (acos <= 60 && item.orders > 0) {
      statusBadge = "WARNING";
    } else {
      statusBadge = "CRITICAL";
    }

    let skuCategory: "HERO" | "BLEEDING" | "POTENTIAL" | "NEUTRAL" | "ZERO_CLICKS" = "NEUTRAL";
    if ((item.orders >= 3 && acos <= targetAcos) || (revenueShare >= 8 && acos <= targetAcos + 5)) {
      skuCategory = "HERO";
    } else if ((item.spend >= 25 && item.orders === 0) || (item.spend >= 40 && acos > targetAcos + 25)) {
      skuCategory = "BLEEDING";
    } else if (item.orders >= 1 && acos <= targetAcos) {
      skuCategory = "POTENTIAL";
    } else if (item.clicks === 0 && item.impressions > 0) {
      skuCategory = "ZERO_CLICKS";
    }

    results.push({
      sku: item.sku,
      storeName: item.storeName,
      spend: Math.round(item.spend * 100) / 100,
      sales: Math.round(item.sales * 100) / 100,
      orders: item.orders,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      cpa: Math.round(cpa * 100) / 100,
      aov: Math.round(aov * 100) / 100,
      campaignsCount: item.campaigns.size,
      statusBadge,
      skuCategory,
      revenueShare,
      spendShare,
    });
  }

  return results.sort((a, b) => {
    if (b.spend !== a.spend) return b.spend - a.spend;
    return b.impressions - a.impressions;
  });
}

/**
 * Tính toán biểu đồ xu hướng theo ngày (Row 3 — Performance Trend)
 */
export function calculatePpcDailyTrends(rows: PpcSearchTermRow[]): PpcDailyTrendPoint[] {
  const map = new Map<
    string,
    {
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
    }
  >();

  for (const r of rows) {
    const date = r.reportDate || "Unknown";
    const existing = map.get(date);
    if (!existing) {
      map.set(date, {
        spend: r.spend,
        sales: r.sales,
        orders: r.orders,
        clicks: r.clicks,
        impressions: r.impressions,
      });
    } else {
      existing.spend += r.spend;
      existing.sales += r.sales;
      existing.orders += r.orders;
      existing.clicks += r.clicks;
      existing.impressions += r.impressions;
    }
  }

  const results: PpcDailyTrendPoint[] = [];

  for (const [date, data] of map.entries()) {
    const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : data.spend > 0 ? 999 : 0;
    const roas = data.spend > 0 ? data.sales / data.spend : 0;
    const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
    const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;

    results.push({
      date,
      spend: Math.round(data.spend * 100) / 100,
      sales: Math.round(data.sales * 100) / 100,
      orders: data.orders,
      clicks: data.clicks,
      impressions: data.impressions,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      ctr: Math.round(ctr * 100) / 100,
      cpc: Math.round(cpc * 100) / 100,
    });
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Bóc tách và nhóm số liệu theo Match Type (Row 4 — Distribution)
 */
export function groupPpcByMatchType(rows: Array<Pick<
  PpcSearchTermRow,
  "matchType" | "spend" | "sales" | "orders" | "clicks" | "impressions"
>>): PpcMatchTypeBreakdown[] {
  const map = new Map<
    MatchType,
    {
      spend: number;
      sales: number;
      orders: number;
      clicks: number;
      impressions: number;
    }
  >();

  const standardTypes: MatchType[] = ["Exact", "Phrase", "Broad", "Auto", "Targeting", "Unknown"];
  for (const t of standardTypes) {
    map.set(t, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });
  }

  let totalSpend = 0;
  let totalSales = 0;

  for (const r of rows) {
    const t: MatchType = standardTypes.includes(r.matchType) ? r.matchType : "Targeting";
    const bucket = map.get(t)!;
    bucket.spend += r.spend;
    bucket.sales += r.sales;
    bucket.orders += r.orders;
    bucket.clicks += r.clicks;
    bucket.impressions += r.impressions;

    totalSpend += r.spend;
    totalSales += r.sales;
  }

  const results: PpcMatchTypeBreakdown[] = [];

  for (const [matchType, data] of map.entries()) {
    const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : data.spend > 0 ? 999 : 0;
    const roas = data.spend > 0 ? data.sales / data.spend : 0;
    const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
    const spendShare = totalSpend > 0 ? (data.spend / totalSpend) * 100 : 0;
    const salesShare = totalSales > 0 ? (data.sales / totalSales) * 100 : 0;

    results.push({
      matchType,
      spend: Math.round(data.spend * 100) / 100,
      spendShare: Math.round(spendShare * 10) / 10,
      sales: Math.round(data.sales * 100) / 100,
      salesShare: Math.round(salesShare * 10) / 10,
      orders: data.orders,
      clicks: data.clicks,
      impressions: data.impressions,
      cpc: Math.round(cpc * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Phân loại Target Type: Keyword, Auto, hoặc Product Targeting
 */
export function classifyPpcTargetType(row: {
  matchType?: string;
  targetExpression?: string;
  targetKeyword?: string;
  targetingType?: string;
}): PpcTargetType {
  const match = (row.matchType || "").toUpperCase();
  const expr = (row.targetExpression || "").toLowerCase();
  const kw = (row.targetKeyword || "").toLowerCase();

  // Auto targeting
  if (
    match === "AUTO" ||
    expr === "close-match" ||
    expr === "loose-match" ||
    expr === "substitutes" ||
    expr === "complements" ||
    expr.includes("auto targeting") ||
    kw.includes("close-match") ||
    kw.includes("loose-match") ||
    kw.includes("substitutes") ||
    kw.includes("complements")
  ) {
    return "Auto";
  }

  // Product targeting (PAT)
  if (
    match === "TARGETING" ||
    expr.startsWith("asin=") ||
    expr.startsWith("asin-expanded=") ||
    expr.startsWith("category=") ||
    expr.includes("asin") ||
    expr.includes("category") ||
    kw.startsWith("asin=") ||
    kw.startsWith("category=")
  ) {
    return "Product Targeting";
  }

  // Keyword targeting
  if (match === "EXACT" || match === "PHRASE" || match === "BROAD") {
    return "Keyword";
  }

  return "Keyword";
}

/**
 * Phân loại Keyword Match Type: Exact, Phrase, Broad
 */
export function classifyPpcKeywordMatchType(row: {
  matchType?: string;
  targetKeyword?: string;
}): PpcKeywordMatchType {
  const match = (row.matchType || "").toUpperCase();
  if (match.includes("EXACT")) return "Exact";
  if (match.includes("PHRASE")) return "Phrase";
  if (match.includes("BROAD")) return "Broad";
  return "Unknown";
}

/**
 * Nhóm số liệu theo Target Type (Keyword, Auto, Product Targeting)
 */
export function groupPpcByTargetType(
  rows: Array<Pick<PpcPerformanceRow, "matchType" | "targetExpression" | "targetingType" | "spend" | "sales" | "orders" | "clicks" | "impressions">>
): PpcTargetTypeBreakdown[] {
  const map = new Map<PpcTargetType, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  const types: PpcTargetType[] = ["Keyword", "Auto", "Product Targeting"];
  for (const t of types) {
    map.set(t, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });
  }

  let totalSpend = 0;
  let totalSales = 0;

  for (const r of rows) {
    const t = classifyPpcTargetType(r);
    const bucket = map.get(t) || map.get("Keyword")!;
    bucket.spend += r.spend;
    bucket.sales += r.sales;
    bucket.orders += r.orders;
    bucket.clicks += r.clicks;
    bucket.impressions += r.impressions;
    totalSpend += r.spend;
    totalSales += r.sales;
  }

  const results: PpcTargetTypeBreakdown[] = [];
  for (const [targetType, data] of map.entries()) {
    const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : data.spend > 0 ? 999 : 0;
    const roas = data.spend > 0 ? data.sales / data.spend : 0;
    const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
    const spendShare = totalSpend > 0 ? (data.spend / totalSpend) * 100 : 0;
    const salesShare = totalSales > 0 ? (data.sales / totalSales) * 100 : 0;

    results.push({
      targetType,
      spend: Math.round(data.spend * 100) / 100,
      spendShare: Math.round(spendShare * 10) / 10,
      sales: Math.round(data.sales * 100) / 100,
      salesShare: Math.round(salesShare * 10) / 10,
      orders: data.orders,
      clicks: data.clicks,
      impressions: data.impressions,
      cpc: Math.round(cpc * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Nhóm số liệu theo Keyword Match Type (Exact, Phrase, Broad) - Chỉ dành riêng cho Keyword Targeting
 */
export function groupPpcByKeywordMatchType(
  rows: Array<Pick<PpcPerformanceRow, "matchType" | "targetExpression" | "targetingType" | "spend" | "sales" | "orders" | "clicks" | "impressions">>
): PpcKeywordMatchTypeBreakdown[] {
  const map = new Map<PpcKeywordMatchType, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  const matchTypes: PpcKeywordMatchType[] = ["Exact", "Phrase", "Broad"];
  for (const m of matchTypes) {
    map.set(m, { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 });
  }

  let totalSpend = 0;
  let totalSales = 0;

  for (const r of rows) {
    if (classifyPpcTargetType(r) !== "Keyword") continue;

    const mt = classifyPpcKeywordMatchType(r);
    if (mt === "Unknown") continue;

    const bucket = map.get(mt);
    if (!bucket) continue;

    bucket.spend += r.spend;
    bucket.sales += r.sales;
    bucket.orders += r.orders;
    bucket.clicks += r.clicks;
    bucket.impressions += r.impressions;
    totalSpend += r.spend;
    totalSales += r.sales;
  }

  const results: PpcKeywordMatchTypeBreakdown[] = [];
  for (const [matchType, data] of map.entries()) {
    const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : data.spend > 0 ? 999 : 0;
    const roas = data.spend > 0 ? data.sales / data.spend : 0;
    const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
    const spendShare = totalSpend > 0 ? (data.spend / totalSpend) * 100 : 0;
    const salesShare = totalSales > 0 ? (data.sales / totalSales) * 100 : 0;

    results.push({
      matchType,
      spend: Math.round(data.spend * 100) / 100,
      spendShare: Math.round(spendShare * 10) / 10,
      sales: Math.round(data.sales * 100) / 100,
      salesShare: Math.round(salesShare * 10) / 10,
      orders: data.orders,
      clicks: data.clicks,
      impressions: data.impressions,
      cpc: Math.round(cpc * 100) / 100,
      cvr: Math.round(cvr * 100) / 100,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Kiểm tra chất lượng dữ liệu và độ phủ (Data Quality & Coverage - Mục 17 Đặc tả)
 */
export function calculatePpcDataHealth(
  rows: PpcSearchTermRow[],
  syncLogs: Array<{ time: string; status: string; count: number }> = [],
  bulkLoaded = false
): PpcDataHealth {
  if (rows.length === 0) {
    return {
      performanceSource: bulkLoaded ? "BULK" : "NONE",
      searchTermSource: "NONE",
      performanceRows: 0,
      searchTermRows: 0,
      campaignRows: 0,
      targetRows: 0,
      productRows: 0,
      placementRows: 0,
      adTypes: [],
      warnings: bulkLoaded ? [] : ["Chưa có Bulk performance cho kỳ đang chọn."],
      strLoaded: false,
      bulkLoaded,
      dateRangeStart: "N/A",
      dateRangeEnd: "N/A",
      totalRecords: 0,
      granularity: "N/A",
      spendCoveragePct: 0,
      clicksCoveragePct: 0,
      lastSyncTime: syncLogs[0]?.time ?? null,
    };
  }

  const dates = rows.map((r) => r.reportDate).filter(Boolean).sort();
  const dateRangeStart = dates[0] || "N/A";
  const dateRangeEnd = dates[dates.length - 1] || "N/A";
  const granularity = rows[0]?.reportGranularity || "DAILY";

  return {
    performanceSource: bulkLoaded ? "BULK" : "NONE",
    searchTermSource: "SEARCH_TERM",
    performanceRows: 0,
    searchTermRows: rows.length,
    campaignRows: 0,
    targetRows: 0,
    productRows: 0,
    placementRows: 0,
    adTypes: Array.from(new Set(rows.map((row) => row.adType || "UNKNOWN"))),
    warnings: bulkLoaded ? [] : ["Overview chưa có Bulk performance; Search Term không được dùng thay thế account total."],
    strLoaded: true,
    bulkLoaded,
    dateRangeStart,
    dateRangeEnd,
    totalRecords: rows.length,
    granularity,
    spendCoveragePct: 100,
    clicksCoveragePct: 100,
    lastSyncTime: syncLogs[0]?.time ?? null,
  };
}

function roundedPerformanceMetrics(row: {
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
}) {
  const acos = row.sales > 0 ? (row.spend / row.sales) * 100 : row.spend > 0 ? 999 : 0;
  return {
    spend: Math.round(row.spend * 100) / 100,
    sales: Math.round(row.sales * 100) / 100,
    orders: row.orders,
    clicks: row.clicks,
    impressions: row.impressions,
    cpc: row.clicks > 0 ? Math.round((row.spend / row.clicks) * 100) / 100 : 0,
    ctr: row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 10_000) / 100 : 0,
    cvr: row.clicks > 0 ? Math.round((row.orders / row.clicks) * 10_000) / 100 : 0,
    acos: Math.round(acos * 10) / 10,
    roas: row.spend > 0 ? Math.round((row.sales / row.spend) * 100) / 100 : 0,
    cpa: row.orders > 0 ? Math.round((row.spend / row.orders) * 100) / 100 : 0,
    aov: row.orders > 0 ? Math.round((row.sales / row.orders) * 100) / 100 : 0,
  };
}

export function calculatePerformanceSummary(
  campaignRows: PpcPerformanceRow[],
  counts: { alerts?: number; recommendations?: number; wastedSpend?: number } = {},
): PpcSummaryMetrics {
  const totals = campaignRows.reduce((sum, row) => ({
    spend: sum.spend + row.spend,
    sales: sum.sales + row.sales,
    orders: sum.orders + row.orders,
    units: sum.units + row.units,
    clicks: sum.clicks + row.clicks,
    impressions: sum.impressions + row.impressions,
  }), { spend: 0, sales: 0, orders: 0, units: 0, clicks: 0, impressions: 0 });
  const metrics = roundedPerformanceMetrics(totals);
  return {
    totalSpend: metrics.spend,
    totalSales: metrics.sales,
    totalOrders: metrics.orders,
    totalUnits: totals.units,
    totalClicks: metrics.clicks,
    totalImpressions: metrics.impressions,
    blendedAcos: metrics.acos,
    blendedRoas: metrics.roas,
    avgCpc: metrics.cpc,
    overallCtr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
    overallCvr: metrics.clicks > 0 ? metrics.orders / metrics.clicks : 0,
    cpa: metrics.cpa,
    aov: metrics.aov,
    wastedSpend: counts.wastedSpend || 0,
    activeAlertsCount: counts.alerts || 0,
    pendingRecsCount: counts.recommendations || 0,
  };
}

export function calculateSearchTermFallbackSummary(
  searchTerms: PpcSearchTermRow[],
  counts: { alerts?: number; recommendations?: number; wastedSpend?: number } = {},
): PpcSummaryMetrics {
  const totals = searchTerms.reduce((sum, row) => ({
    spend: sum.spend + row.spend,
    sales: sum.sales + row.sales,
    orders: sum.orders + row.orders,
    units: sum.units + (row.units || row.orders),
    clicks: sum.clicks + row.clicks,
    impressions: sum.impressions + row.impressions,
  }), { spend: 0, sales: 0, orders: 0, units: 0, clicks: 0, impressions: 0 });
  const metrics = roundedPerformanceMetrics(totals);
  return {
    totalSpend: metrics.spend,
    totalSales: metrics.sales,
    totalOrders: metrics.orders,
    totalUnits: totals.units,
    totalClicks: metrics.clicks,
    totalImpressions: metrics.impressions,
    blendedAcos: metrics.acos,
    blendedRoas: metrics.roas,
    avgCpc: metrics.cpc,
    overallCtr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : 0,
    overallCvr: metrics.clicks > 0 ? metrics.orders / metrics.clicks : 0,
    cpa: metrics.cpa,
    aov: metrics.aov,
    wastedSpend: counts.wastedSpend || 0,
    activeAlertsCount: counts.alerts || 0,
    pendingRecsCount: counts.recommendations || 0,
  };
}

export function campaignPerformanceFromFacts(
  rows: PpcPerformanceRow[],
  targetAcos = 30,
): PpcCampaignPerformance[] {
  return rows.filter((row) => row.grain === "CAMPAIGN").map((row) => {
    const metrics = roundedPerformanceMetrics(row);
    const targetingType: PpcCampaignPerformance["targetingType"] = row.targetingType.toLowerCase().includes("auto") ? "Auto" : "Manual";
    const statusBadge: PpcCampaignPerformance["statusBadge"] = metrics.orders === 0 || metrics.acos > targetAcos * 2
      ? "CRITICAL"
      : metrics.acos > targetAcos
        ? "WARNING"
        : metrics.acos <= targetAcos * 0.75
          ? "EXCELLENT"
          : "GOOD";
    const coveredDays = Math.max(1, Math.round((Date.parse(row.reportEndDate) - Date.parse(row.reportStartDate)) / 86_400_000) + 1);
    return {
      campaignId: row.campaignId,
      campaignName: row.campaignName || row.campaignId || "Unnamed Campaign",
      storeName: row.storeName || "Store",
      adType: row.adType,
      targetingType,
      state: row.state || row.campaignState,
      dailyBudget: row.dailyBudget,
      budgetUtilization: row.dailyBudget > 0 ? Math.round((row.spend / (row.dailyBudget * coveredDays)) * 1000) / 10 : 0,
      biddingStrategy: row.biddingStrategy,
      ...metrics,
      statusBadge,
    };
  }).sort((a, b) => b.spend - a.spend);
}

export function adGroupPerformanceFromFacts(rows: PpcPerformanceRow[]): PpcAdGroupPerformance[] {
  const adGroups = rows.filter((row) => row.grain === "AD_GROUP");
  if (adGroups.length > 0) {
    return adGroups.map((row) => ({
      campaignName: row.campaignName || row.campaignId || "Unnamed Campaign",
      adGroupName: row.adGroupName || row.adGroupId || "Unnamed Ad Group",
      storeName: row.storeName || "Store",
      ...roundedPerformanceMetrics(row),
    })).sort((a, b) => b.spend - a.spend);
  }
  const groups = new Map<string, { campaignName: string; adGroupName: string; storeName: string; spend: number; sales: number; orders: number; clicks: number; impressions: number }>();
  for (const row of rows.filter((r) => r.grain === "TARGET" && !r.isNegative)) {
    const key = [row.storeName, row.campaignName || row.campaignId, row.adGroupName || row.adGroupId].join("\u0000");
    const item = groups.get(key) || {
      campaignName: row.campaignName || row.campaignId || "Unnamed Campaign",
      adGroupName: row.adGroupName || row.adGroupId || "Default Ad Group",
      storeName: row.storeName || "Store",
      spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0,
    };
    item.spend += row.spend;
    item.sales += row.sales;
    item.orders += row.orders;
    item.clicks += row.clicks;
    item.impressions += row.impressions;
    groups.set(key, item);
  }
  return Array.from(groups.values()).map((item) => ({
    campaignName: item.campaignName,
    adGroupName: item.adGroupName,
    storeName: item.storeName,
    ...roundedPerformanceMetrics(item),
  })).sort((a, b) => b.spend - a.spend);
}

export function targetPerformanceFromFacts(rows: PpcPerformanceRow[]): PpcTargetPerformance[] {
  return rows.filter((row) => row.grain === "TARGET" && !row.isNegative).map((row) => ({
    storeId: row.storeId,
    campaignId: row.campaignId,
    adGroupId: row.adGroupId,
    campaignName: row.campaignName || row.campaignId,
    adGroupName: row.adGroupName || row.adGroupId,
    targetId: row.targetId,
    targetKeyword: row.targetExpression || row.targetId || "Unnamed Target",
    matchType: row.matchType,
    storeName: row.storeName || "Store",
    adType: row.adType,
    state: row.state,
    currentBid: row.bid,
    ...roundedPerformanceMetrics(row),
  })).sort((a, b) => b.spend - a.spend);
}

export function skuPerformanceFromFacts(
  rows: PpcPerformanceRow[],
  targetAcos = 30,
): PpcSkuPerformance[] {
  const products = rows.filter((row) => row.grain === "PRODUCT" && (row.sku || row.asin));
  const groups = new Map<string, { sku: string; storeName: string; spend: number; sales: number; orders: number; clicks: number; impressions: number; campaigns: Set<string> }>();
  for (const row of products) {
    const key = [row.storeName, row.sku || row.asin].join("\u0000");
    const item = groups.get(key) || { sku: row.sku || row.asin, storeName: row.storeName || "Store", spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, campaigns: new Set<string>() };
    item.spend += row.spend;
    item.sales += row.sales;
    item.orders += row.orders;
    item.clicks += row.clicks;
    item.impressions += row.impressions;
    if (row.campaignId) item.campaigns.add(row.campaignId);
    groups.set(key, item);
  }
  const all = Array.from(groups.values());
  const totalSpend = all.reduce((sum, row) => sum + row.spend, 0);
  const totalSales = all.reduce((sum, row) => sum + row.sales, 0);
  return all.map((row) => {
    const metrics = roundedPerformanceMetrics(row);
    const statusBadge: PpcSkuPerformance["statusBadge"] = metrics.clicks === 0 ? (metrics.impressions > 0 ? "ZERO_CLICKS" : "INACTIVE")
      : metrics.orders === 0 || metrics.acos > targetAcos * 2 ? "CRITICAL"
        : metrics.acos > targetAcos ? "WARNING" : metrics.acos <= targetAcos * 0.75 ? "EXCELLENT" : "GOOD";
    const skuCategory: PpcSkuPerformance["skuCategory"] = metrics.orders >= 3 && metrics.acos <= targetAcos ? "HERO"
      : metrics.orders === 0 && metrics.spend >= 15 ? "BLEEDING"
        : metrics.orders > 0 && metrics.acos <= targetAcos ? "POTENTIAL"
          : metrics.clicks === 0 && metrics.impressions > 0 ? "ZERO_CLICKS" : "NEUTRAL";
    return {
      sku: row.sku,
      storeName: row.storeName,
      ...metrics,
      campaignsCount: row.campaigns.size,
      statusBadge,
      skuCategory,
      revenueShare: totalSales > 0 ? Math.round((metrics.sales / totalSales) * 1000) / 10 : 0,
      spendShare: totalSpend > 0 ? Math.round((metrics.spend / totalSpend) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.spend - a.spend);
}

export function adTypeBreakdownFromFacts(rows: PpcPerformanceRow[]): PpcAdTypeBreakdown[] {
  const groups = new Map<PpcPerformanceRow["adType"], PpcPerformanceRow[]>();
  for (const row of rows.filter((item) => item.grain === "CAMPAIGN")) {
    groups.set(row.adType, [...(groups.get(row.adType) || []), row]);
  }
  return Array.from(groups.entries()).map(([adType, items]) => {
    const summary = calculatePerformanceSummary(items);
    return {
      adType,
      spend: summary.totalSpend,
      sales: summary.totalSales,
      orders: summary.totalOrders,
      clicks: summary.totalClicks,
      impressions: summary.totalImpressions,
      acos: summary.blendedAcos,
      roas: summary.blendedRoas,
    };
  }).sort((a, b) => b.spend - a.spend);
}

export function performanceDataHealth(
  performanceRows: PpcPerformanceRow[],
  searchTermRows: PpcSearchTermRow[],
): PpcDataHealth {
  const count = (grain: PpcPerformanceRow["grain"]) => performanceRows.filter((row) => row.grain === grain && !row.isNegative).length;
  const warnings: string[] = [];
  if (!performanceRows.length) warnings.push("Chưa có Bulk performance cho kỳ đang chọn.");
  if (performanceRows.length && !count("CAMPAIGN")) warnings.push("Bulk không có campaign grain; overview được khóa để tránh cộng sai entity level.");
  if (!count("TARGET")) warnings.push("Chưa có target grain; chưa thể phân tích hoặc đề xuất bid đáng tin cậy.");
  if (!count("PLACEMENT")) warnings.push("Chưa có placement grain; chưa thể đánh giá placement modifier.");
  if (!searchTermRows.length) warnings.push("Chưa có Search Term report; chưa thể harvest hoặc đề xuất negative.");
  return {
    performanceSource: performanceRows.length ? "BULK" : "NONE",
    searchTermSource: searchTermRows.length ? "SEARCH_TERM" : "NONE",
    performanceRows: performanceRows.length,
    searchTermRows: searchTermRows.length,
    campaignRows: count("CAMPAIGN"),
    targetRows: count("TARGET"),
    productRows: count("PRODUCT"),
    placementRows: count("PLACEMENT"),
    adTypes: Array.from(new Set([...performanceRows.map((row) => row.adType), ...searchTermRows.map((row) => row.adType || "UNKNOWN")])),
    warnings,
  };
}

/**
 * Rule Engine: Phát hiện cảnh báo tự động (Alerts)
 */
export function generatePpcAlerts(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0
): PpcAlert[] {
  const alerts: PpcAlert[] = [];
  const rowKey = (row: PpcSearchTermRow) =>
    [row.storeName, row.campaignName, row.adGroupName, row.customerSearchTerm, row.reportDate]
      .join("-")
      .replace(/\s+/g, "-");

  for (const r of rows) {
    // 1. Cảnh báo Bleeding Keyword: Clicks >= 9 mà Orders = 0
    if (r.clicks >= 9 && r.orders === 0 && r.spend > 5) {
      alerts.push({
        id: `alert-bleed-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Bozspacer",
        alertType: "BLEEDING_KEYWORD",
        severity: r.clicks >= 15 ? "CRITICAL" : "WARNING",
        title: `Cắn tiền không ra đơn: "${r.customerSearchTerm}"`,
        message: `Từ khóa đã tốn $${r.spend.toFixed(2)} (${r.clicks} clicks) nhưng chưa mang lại đơn hàng nào.`,
        sku: r.portfolioName,
        searchTerm: r.customerSearchTerm,
        metricValue: r.spend,
        thresholdValue: 0,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Cảnh báo ACOS quá cao: ACOS > 60% và Spend >= $15
    if (r.orders > 0 && r.acos > 60 && r.spend >= 15) {
      alerts.push({
        id: `alert-high-acos-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Bozspacer",
        alertType: "HIGH_ACOS",
        severity: r.acos > 80 ? "CRITICAL" : "WARNING",
        title: `ACOS vượt ngưỡng (${r.acos.toFixed(1)}%): "${r.customerSearchTerm}"`,
        message: `Chiến dịch tiêu $${r.spend.toFixed(2)} tạo $${r.sales.toFixed(2)} doanh số. ACOS cao hơn mục tiêu (${targetAcos}%).`,
        sku: r.portfolioName,
        searchTerm: r.customerSearchTerm,
        metricValue: r.acos,
        thresholdValue: targetAcos,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
      });
    }
  }

  const severityRank: Record<PpcAlert["severity"], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/**
 * Rule Engine: Đưa ra đề xuất tối ưu (Recommendations)
 */
export function generatePpcRecommendations(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0
): PpcRecommendation[] {
  const recs: PpcRecommendation[] = [];
  const rowKey = (row: PpcSearchTermRow) =>
    [row.storeName, row.campaignName, row.adGroupName, row.customerSearchTerm, row.reportDate]
      .join("-")
      .replace(/\s+/g, "-");

  for (const r of rows) {
    if (r.clicks >= 9 && r.orders === 0) {
      recs.push({
        id: `rec-neg-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        adType: r.adType,
        recType: "NEGATIVE_KEYWORD",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        sku: r.portfolioName || (r.campaignName ? r.campaignName.trim().split(/\s+/)[0] : ""),
        campaignId: r.campaignId,
        adGroupId: r.adGroupId,
        keywordId: r.keywordId,
        priority: r.spend >= 20 || r.clicks >= 15 ? "P0" : "P1",
        reason: `Đã tốn $${r.spend.toFixed(2)} với ${r.clicks} clicks mà không có đơn. Phủ định ngay để cắt lỗ lãng phí.`,
        estimatedSavings: r.spend,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }

    // Đánh giá Harvest Candidate theo HARVEST_SCORE
    const harvestScore = calculateHarvestScore(r, targetAcos);
    if (
      (r.campaignName.toLowerCase().includes("auto") || r.matchType === "Broad" || r.matchType === "Auto") &&
      r.orders >= 2 &&
      harvestScore >= 50
    ) {
      recs.push({
        id: `rec-harvest-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        adType: r.adType,
        recType: "HARVEST_KEYWORD",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        sku: r.portfolioName || (r.campaignName ? r.campaignName.trim().split(/\s+/)[0] : ""),
        campaignId: r.campaignId,
        adGroupId: r.adGroupId,
        keywordId: r.keywordId,
        priority: harvestScore >= 75 ? "P1" : "P2",
        reason: `Search Term hiệu quả cao (Harvest Score: ${harvestScore}/100) có ${r.orders} đơn, ACOS (${r.acos.toFixed(1)}%). Nên chuyển sang Manual Exact!`,
        estimatedSavings: 0,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }
  }

  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  return recs.sort((a, b) => (priorityRank[a.priority || "P1"] ?? 1) - (priorityRank[b.priority || "P1"] ?? 1));
}

/** Bid candidates use target-grain performance and the actual Bulk bid only. */
export function generateTargetBidRecommendations(
  rows: PpcPerformanceRow[],
  targetAcos = 30,
): PpcRecommendation[] {
  const recommendations: PpcRecommendation[] = [];
  for (const row of rows) {
    if (row.grain !== "TARGET" || row.isNegative || row.bid <= 0) continue;
    if (/paused|archived/i.test(row.state || row.campaignState || row.adGroupState)) continue;
    const enoughEvidence = row.clicks >= 10 && (row.orders >= 2 || (row.orders === 0 && row.spend >= 15));
    if (!enoughEvidence) continue;
    const actualAcos = row.sales > 0 ? (row.spend / row.sales) * 100 : 999;
    let factor = 1;
    let recType: PpcRecommendation["recType"] | null = null;
    let priority: PpcRecommendation["priority"] = "P1";
    if (row.orders === 0 || actualAcos > targetAcos * 1.2) {
      factor = Math.max(0.8, Math.min(0.95, targetAcos / actualAcos));
      recType = "BID_DECREASE";
      priority = row.orders === 0 || actualAcos > targetAcos * 2 ? "P0" : "P1";
    } else if (row.orders >= 3 && row.clicks >= 20 && actualAcos < targetAcos * 0.75) {
      factor = Math.min(1.15, Math.max(1.05, targetAcos / Math.max(actualAcos, 1)));
      recType = "BID_INCREASE";
    }
    if (!recType) continue;
    const recommendedBid = Math.max(0.02, Math.round(row.bid * factor * 100) / 100);
    if (recommendedBid === row.bid) continue;
    recommendations.push({
      id: `rec-bid-${row.storeId || row.storeName}-${row.adType}-${row.targetId || row.entityId}`,
      storeId: row.storeId || "store-1",
      storeName: row.storeName || "Store",
      adType: row.adType,
      recType,
      targetType: /asin|category|brand/i.test(row.targetExpression) ? "PRODUCT" : "EXACT",
      matchType: row.matchType,
      keyword: row.targetExpression || row.targetId,
      campaignName: row.campaignName,
      adGroupName: row.adGroupName,
      sku: row.sku || (row.campaignName ? row.campaignName.trim().split(/\s+/)[0] : ""),
      campaignId: row.campaignId,
      adGroupId: row.adGroupId,
      keywordId: row.targetId,
      priority,
      currentBid: row.bid,
      recommendedBid,
      reason: `${row.clicks} clicks, ${row.orders} orders, ACOS ${actualAcos > 500 ? "không có sales" : `${actualAcos.toFixed(1)}%`} so với target ${targetAcos.toFixed(1)}%. Giới hạn thay đổi mỗi lần ${(Math.abs(factor - 1) * 100).toFixed(0)}%.`,
      estimatedSavings: recType === "BID_DECREASE" ? Math.round(row.spend * (1 - factor) * 100) / 100 : 0,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });
  }
  return recommendations;
}

/**
 * Tính toán tốc độ đốt tiền và biến động hiệu quả đa chu kỳ (Velocity Run-rate)
 */
export function calculatePpcVelocity(
  recentRows: PpcSearchTermRow[],
  baselineRows: PpcSearchTermRow[],
  recentDays = 7,
  baselineDays = 30
) {
  const recentSpend = recentRows.reduce((sum, r) => sum + r.spend, 0);
  const recentSales = recentRows.reduce((sum, r) => sum + r.sales, 0);
  const baselineSpend = baselineRows.reduce((sum, r) => sum + r.spend, 0);
  const baselineSales = baselineRows.reduce((sum, r) => sum + r.sales, 0);

  const recentDailySpend = recentDays > 0 ? recentSpend / recentDays : 0;
  const baselineDailySpend = baselineDays > 0 ? baselineSpend / baselineDays : 0;

  const spendGrowthRate = baselineDailySpend > 0
    ? Math.round(((recentDailySpend - baselineDailySpend) / baselineDailySpend) * 1000) / 10
    : 0;

  const recentAcos = recentSales > 0 ? (recentSpend / recentSales) * 100 : 0;
  const baselineAcos = baselineSales > 0 ? (baselineSpend / baselineSales) * 100 : 0;
  const acosDelta = Math.round((recentAcos - baselineAcos) * 10) / 10;

  let trendStatus: "ACCELERATING_EFFICIENCY" | "OVERSPENDING_RISK" | "STABLE" | "COOLING_DOWN" = "STABLE";
  if (spendGrowthRate > 15 && acosDelta > 5) {
    trendStatus = "OVERSPENDING_RISK";
  } else if (spendGrowthRate >= 0 && acosDelta <= -3) {
    trendStatus = "ACCELERATING_EFFICIENCY";
  } else if (spendGrowthRate < -15) {
    trendStatus = "COOLING_DOWN";
  }

  return {
    recentDays,
    baselineDays,
    recentDailySpend: Math.round(recentDailySpend * 100) / 100,
    baselineDailySpend: Math.round(baselineDailySpend * 100) / 100,
    spendGrowthRate,
    recentAcos: Math.round(recentAcos * 10) / 10,
    baselineAcos: Math.round(baselineAcos * 10) / 10,
    acosDelta,
    trendStatus,
  };
}
