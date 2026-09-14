import type {
  MatchType,
  PpcAlert,
  PpcCampaignPerformance,
  PpcMatchTypeBreakdown,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSkuPerformance,
  PpcSummaryMetrics,
} from "./types";

/**
 * Tính toán tổng hợp chỉ số KPI cho danh sách Search Terms
 */
export function calculatePpcSummary(
  rows: PpcSearchTermRow[],
  targetAcos = 30.0
): PpcSummaryMetrics {
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

    // Lãng phí: có clicks mà không có đơn hàng
    if (r.clicks > 0 && r.orders === 0) {
      wastedSpend += r.spend;
    }
  }

  const blendedAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
  const blendedRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const overallCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const overallCvr = totalClicks > 0 ? totalOrders / totalClicks : 0;

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
    overallCtr: Math.round(overallCtr * 10000) / 10000,
    overallCvr: Math.round(overallCvr * 10000) / 10000,
    wastedSpend: Math.round(wastedSpend * 100) / 100,
    activeAlertsCount: alerts.length,
    pendingRecsCount: recs.length,
  };
}

/**
 * Nhóm và tính toán số liệu theo từng SKU (Portfolio)
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
    }
  >();

  for (const r of rows) {
    const key = `${r.storeName || "Store"}_${r.portfolioName || "Default"}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        sku: r.portfolioName || "Unassigned",
        storeName: r.storeName || "Store",
        spend: r.spend,
        sales: r.sales,
        orders: r.orders,
        clicks: r.clicks,
      });
    } else {
      existing.spend += r.spend;
      existing.sales += r.sales;
      existing.orders += r.orders;
      existing.clicks += r.clicks;
    }
  }

  const totalStoreSpend = Array.from(map.values()).reduce((sum, i) => sum + i.spend, 0);
  const totalStoreSales = Array.from(map.values()).reduce((sum, i) => sum + i.sales, 0);
  const results: PpcSkuPerformance[] = [];

  for (const item of map.values()) {
    const acos = item.sales > 0 ? (item.spend / item.sales) * 100 : item.spend > 0 ? 999 : 0;
    const roas = item.spend > 0 ? item.sales / item.spend : 0;
    const cvr = item.clicks > 0 ? item.orders / item.clicks : 0;
    const revenueShare = totalStoreSales > 0 ? Math.round((item.sales / totalStoreSales) * 1000) / 10 : 0;
    const spendShare = totalStoreSpend > 0 ? Math.round((item.spend / totalStoreSpend) * 1000) / 10 : 0;

    let statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL" = "GOOD";
    if (acos <= 20 && item.orders > 0) statusBadge = "EXCELLENT";
    else if (acos <= targetAcos && item.orders > 0) statusBadge = "GOOD";
    else if (acos <= 60 && item.orders > 0) statusBadge = "WARNING";
    else statusBadge = "CRITICAL";

    // Phân loại danh mục SKU
    let skuCategory: "HERO" | "BLEEDING" | "POTENTIAL" | "NEUTRAL" = "NEUTRAL";
    if ((item.orders >= 3 && acos <= targetAcos) || (revenueShare >= 8 && acos <= targetAcos + 5)) {
      skuCategory = "HERO";
    } else if ((item.spend >= 25 && item.orders === 0) || (item.spend >= 40 && acos > targetAcos + 25)) {
      skuCategory = "BLEEDING";
    } else if (item.orders >= 1 && acos <= targetAcos) {
      skuCategory = "POTENTIAL";
    }

    results.push({
      sku: item.sku,
      storeName: item.storeName,
      spend: Math.round(item.spend * 100) / 100,
      sales: Math.round(item.sales * 100) / 100,
      orders: item.orders,
      clicks: item.clicks,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      cvr: Math.round(cvr * 1000) / 1000,
      statusBadge,
      skuCategory,
      revenueShare,
      spendShare,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
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
        message: `Từ khóa đã tốn $${r.spend.toFixed(2)} (${r.clicks} clicks) nhưng chưa mang lại đơn hàng nào. Nên phủ định ngay!`,
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
        message: `Chiến dịch tiêu $${r.spend.toFixed(2)} tạo $${r.sales.toFixed(2)} doanh số. ACOS cao hơn mục tiêu (${targetAcos}%). Cần hạ giá thầu!`,
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
 * Rule Engine: Đưa ra đề xuất tối ưu (Recommendations) với mức ưu tiên P0/P1/P2
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
    // P0: Đề xuất Phủ định từ khóa (Negative Exact) nếu click >= 9 và 0 orders (hoặc spend > $15)
    if (r.clicks >= 9 && r.orders === 0) {
      recs.push({
        id: `rec-neg-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        recType: "NEGATIVE_KEYWORD",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        priority: r.spend >= 20 || r.clicks >= 15 ? "P0" : "P1",
        reason: `Đã tốn $${r.spend.toFixed(2)} với ${r.clicks} clicks mà không có đơn. Phủ định ngay để cắt lỗ lãng phí.`,
        estimatedSavings: r.spend,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }

    // P1: Đề xuất Giảm Bid nếu có đơn nhưng ACOS > target + 15%
    if (r.orders >= 2 && r.acos > targetAcos + 15 && r.cpc > 0.4) {
      const optimalBid = Math.max(0.15, Math.round((targetAcos / r.acos) * r.cpc * 100) / 100);
      recs.push({
        id: `rec-bid-dec-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        recType: "BID_DECREASE",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        priority: "P1",
        currentBid: r.cpc,
        recommendedBid: optimalBid,
        reason: `ACOS đang là ${r.acos.toFixed(1)}% (vượt mục tiêu ${targetAcos}%). Giảm bid từ $${r.cpc.toFixed(2)} xuống $${optimalBid.toFixed(2)} để kéo ACOS về mức mong muốn.`,
        estimatedSavings: Math.round((r.cpc - optimalBid) * r.clicks * 100) / 100,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }

    // P1: Đề xuất Tăng Bid cho từ khóa siêu sinh lời (ACoS < target - 10%, CVR > 12%)
    if (r.orders >= 3 && r.acos <= Math.max(12, targetAcos - 10) && r.cvr >= 0.12) {
      const recommendedBid = Math.round(r.cpc * 1.2 * 100) / 100;
      recs.push({
        id: `rec-bid-inc-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        recType: "BID_INCREASE",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        priority: "P1",
        currentBid: r.cpc,
        recommendedBid,
        reason: `Hiệu suất tuyệt vời (ACoS ${r.acos.toFixed(1)}%, CVR ${(r.cvr * 100).toFixed(1)}%, ${r.orders} đơn). Tăng bid thêm 20% để chiếm trọn Top of Search và mở rộng doanh số!`,
        estimatedSavings: 0,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }

    // P2: Đề xuất Thu hoạch từ khóa (Keyword Harvesting): Auto/Broad có >= 2 orders, ACOS <= target
    if (
      (r.campaignName.toLowerCase().includes("auto") || r.matchType === "Broad" || r.matchType === "Auto") &&
      r.orders >= 2 &&
      r.acos <= targetAcos
    ) {
      recs.push({
        id: `rec-harvest-${rowKey(r)}`,
        storeId: r.storeId || "store-1",
        storeName: r.storeName || "Warmstorey",
        recType: "HARVEST_KEYWORD",
        targetType: "EXACT",
        keyword: r.customerSearchTerm,
        campaignName: r.campaignName,
        adGroupName: r.adGroupName,
        priority: "P2",
        reason: `Search Term hiệu quả từ chiến dịch ${r.matchType} có ${r.orders} đơn, ACOS cực tốt (${r.acos.toFixed(1)}%). Nên chuyển sang chiến dịch Manual Exact riêng để kiểm soát giá thầu tối ưu!`,
        estimatedSavings: 0,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      });
    }
  }

  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  return recs.sort((a, b) => (priorityRank[a.priority || "P1"] ?? 1) - (priorityRank[b.priority || "P1"] ?? 1));
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

/**
 * Bóc tách và nhóm số liệu theo Campaign
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
    const key = `${r.storeName || "Store"}_${r.campaignName || "Default"}`;
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
    const cvr = item.clicks > 0 ? item.orders / item.clicks : 0;
    const ctr = item.impressions > 0 ? item.clicks / item.impressions : 0;
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0;

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
      ctr: Math.round(ctr * 10000) / 10000,
      cvr: Math.round(cvr * 1000) / 1000,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      statusBadge,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}

/**
 * Bóc tách và nhóm số liệu theo Match Type (Exact, Phrase, Broad, Auto)
 */
export function groupPpcByMatchType(rows: PpcSearchTermRow[]): PpcMatchTypeBreakdown[] {
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

  const standardTypes: MatchType[] = ["Exact", "Phrase", "Broad", "Auto", "Targeting"];
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
    const cvr = data.clicks > 0 ? data.orders / data.clicks : 0;
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
      cvr: Math.round(cvr * 1000) / 1000,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
    });
  }

  return results.sort((a, b) => b.spend - a.spend);
}
