import "server-only";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { DataScope } from "@/lib/db";
import {
  adTypeBreakdownFromFacts,
  adGroupPerformanceFromFacts,
  calculatePerformanceSummary,
  calculatePpcDailyTrends,
  calculateSearchTermFallbackSummary,
  calculatePpcSearchTermSummary,
  campaignPerformanceFromFacts,
  generatePpcAlerts,
  generatePpcRecommendations,
  groupPpcByKeywordMatchType,
  groupPpcByMatchType,
  groupPpcByTargetType,
  performanceDataHealth,
  roundedPerformanceMetrics,
  skuPerformanceFromFacts,
  targetPerformanceFromFacts,
} from "./analytics";
import { generateMockSearchTerms, MOCK_STORES } from "./mock-data-generator";
import {
  inferPpcReportCoverage,
  parseBulkWorkbook,
  parseLargeBulkWorkbook,
  streamLargeBulkWorkbookFile,
  parseSearchTermCsv,
  parseSearchTermWorkbook,
} from "./parser";
import { invalidateGroupedRecommendationsCache } from "./recommendation-cache";
import {
  getPpcOverviewAggregates,
  getPpcSearchTermSummaryFromDb,
  listPpcDailyTrendsFromDb,
  listPpcPerformance,
  listPpcSearchTerms,
  listPpcStores,
  listPpcSyncLogs,
  recordPpcSyncLog,
  replacePpcDataWithMock,
  upsertPpcSearchTerms,
  upsertPpcPerformance,
  hasSuccessfulPpcSync,
  ingestPpcPerformanceStream,
} from "./repository";
import { getCommonTargetRecommendations } from "./sku-architecture-service";
import type {
  PpcAdType,
  PpcAdTypeBreakdown,
  PpcAlert,
  PpcDataHealth,
  PpcKeywordMatchType,
  PpcKeywordMatchTypeBreakdown,
  PpcPerformanceGrain,
  PpcPerformanceRow,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSkuPerformance,
  PpcSummaryMetrics,
  PpcTargetType,
  PpcTargetTypeBreakdown,
} from "./types";

const MAX_R2_FILE_BYTES = 150_000_000;
const DEFAULT_TARGET_ACOS = 30;

export class PpcInputError extends Error { }

function cleanStoreName(value: string): string {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw new PpcInputError("Tên store không được để trống.");
  if (name.length > 80) throw new PpcInputError("Tên store không được vượt quá 80 ký tự.");
  return name;
}

export function canonicalStoreName(value?: string | null): string {
  if (!value) return "HSOSTORE";
  const cleaned = cleanStoreName(value);
  const lower = cleaned.toLowerCase();
  if (
    lower === "warmstorey" ||
    lower === "dev03_warmstorey" ||
    lower === "hsostore" ||
    (lower.includes("warmstorey") && lower.includes("hsostore"))
  ) {
    return "HSOSTORE";
  }
  return cleaned;
}

function resolveStoreName(objectKey: string, knownStoreNames: string[]): string | null {
  const segments = objectKey.split("/").map((segment) => decodeURIComponent(segment).trim());
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const known = knownStoreNames.find((name) =>
    lowerSegments.some((segment) => segment === name.toLowerCase()) ||
    objectKey.toLowerCase().includes(name.toLowerCase()),
  );
  if (known) return known;

  const areaIndex = lowerSegments.findIndex((segment) => segment === "input" || segment === "output");
  if (areaIndex >= 0) {
    const afterArea = segments.slice(areaIndex + 1);
    const candidate = /^\d{8}$/.test(afterArea[0] || "") ? afterArea[1] : afterArea[0];
    if (candidate && !/\.(xlsx|csv)$/i.test(candidate)) {
      return cleanStoreName(candidate);
    }
  }
  return null;
}

function r2Version(input: { ETag?: string; Size?: number; LastModified?: Date }): string {
  return [input.ETag || "", input.Size || 0, input.LastModified?.toISOString() || ""].join(":");
}

export function reportAdType(reference: string): PpcAdType {
  if (/(?:^|[\s_\-/])SP(?:[\s_\-.]|$)/i.test(reference) || /sponsored products/i.test(reference)) return "SP";
  if (/(?:^|[\s_\-/])SB(?:[\s_\-.]|$)/i.test(reference) || /sponsored brands/i.test(reference)) return "SB";
  if (/(?:^|[\s_\-/])SD(?:[\s_\-.]|$)/i.test(reference) || /sponsored display/i.test(reference)) return "SD";
  return "UNKNOWN";
}

export async function parseBulkFile(
  buffer: Buffer,
  storeName: string,
  reference: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  const options = {
    ...inferPpcReportCoverage(reference, coverageOptions),
    adType: reportAdType(reference),
  };
  try {
    return await parseLargeBulkWorkbook(buffer, storeName, options);
  } catch (error) {
    console.warn("[Bulk Parser] Streaming parser error, falling back to ExcelJS:", error);
    return parseBulkWorkbook(buffer, storeName, options);
  }
}

export async function getPpcAnalyticsData(
  scope: DataScope,
  filters: { storeName?: string; sku?: string; days?: number } = {},
  options: { grains?: PpcPerformanceGrain[]; includeRecommendations?: boolean; section?: string } = {},
) {
  const storeName = filters.storeName && filters.storeName !== "ALL"
    ? canonicalStoreName(filters.storeName)
    : "ALL";
  const sku = filters.sku || "ALL";
  const days = filters.days || 30;
  const section = options.section?.toLowerCase();
  const isDetailSection = section && section !== "overview";

  if (section === "overview") {
    const [stores, aggregates, dailyTrendsDb, searchTermData, syncLogs] = await Promise.all([
      listPpcStores(scope),
      getPpcOverviewAggregates(scope, { storeName, sku, days }),
      listPpcDailyTrendsFromDb(scope, { storeName, days }),
      getPpcSearchTermSummaryFromDb(scope, { storeName, sku, days }),
      listPpcSyncLogs(scope),
    ]);

    const currentStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
    const targetAcos = currentStore?.targetAcos ?? DEFAULT_TARGET_ACOS;
    const searchTermSummary = searchTermData.summary;
    const alerts: PpcAlert[] = generatePpcAlerts(searchTermData.alertRows, targetAcos);
    const dailyTrends = dailyTrendsDb;

    let totalSpend = 0;
    let totalSales = 0;
    let totalOrders = 0;
    let totalUnits = 0;
    let totalClicks = 0;
    let totalImpressions = 0;
    let campaignCount = 0;
    for (const row of aggregates.kpiRows) {
      totalSpend += Number(row.spend || 0);
      totalSales += Number(row.sales || 0);
      totalOrders += Number(row.orders || 0);
      totalUnits += Number(row.units || 0);
      totalClicks += Number(row.clicks || 0);
      totalImpressions += Number(row.impressions || 0);
      campaignCount += Number(row.campaign_count || 0);
    }
    totalSpend = Math.round(totalSpend * 100) / 100;
    totalSales = Math.round(totalSales * 100) / 100;
    const blendedAcos = totalSales > 0 ? Math.round((totalSpend / totalSales) * 1000) / 10 : (totalSpend > 0 ? 999 : 0);
    const blendedRoas = totalSpend > 0 ? Math.round((totalSales / totalSpend) * 100) / 100 : 0;
    const avgCpc = totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0;
    const overallCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const overallCvr = totalClicks > 0 ? totalOrders / totalClicks : 0;
    const cpa = totalOrders > 0 ? Math.round((totalSpend / totalOrders) * 100) / 100 : 0;
    const aov = totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : 0;

    const summary: PpcSummaryMetrics = {
      totalSpend,
      totalSales,
      totalOrders,
      totalUnits,
      totalClicks,
      totalImpressions,
      blendedAcos,
      blendedRoas,
      avgCpc,
      overallCtr,
      overallCvr,
      cpa,
      aov,
      wastedSpend: searchTermSummary.wastedSpend,
      activeAlertsCount: alerts.length,
      pendingRecsCount: 0,
    };

    const adTypeBreakdown: PpcAdTypeBreakdown[] = aggregates.kpiRows.map((row) => {
      const spend = Math.round(Number(row.spend || 0) * 100) / 100;
      const sales = Math.round(Number(row.sales || 0) * 100) / 100;
      const orders = Number(row.orders || 0);
      const clicks = Number(row.clicks || 0);
      const impressions = Number(row.impressions || 0);
      const acos = sales > 0 ? Math.round((spend / sales) * 1000) / 10 : (spend > 0 ? 999 : 0);
      const roas = spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0;
      return {
        adType: row.ad_type,
        spend,
        sales,
        orders,
        clicks,
        impressions,
        acos,
        roas,
      };
    }).sort((a, b) => b.spend - a.spend);

    const targetTypeMap = new Map<PpcTargetType, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>([
      ["Keyword", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
      ["Auto", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
      ["Product Targeting", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
    ]);
    const keywordMatchMap = new Map<PpcKeywordMatchType, { spend: number; sales: number; orders: number; clicks: number; impressions: number }>([
      ["Exact", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
      ["Phrase", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
      ["Broad", { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 }],
    ]);

    let targetTotalSpend = 0;
    let targetTotalSales = 0;
    for (const row of aggregates.targetBreakdown) {
      const sp = Number(row.spend || 0);
      const sa = Number(row.sales || 0);
      const ord = Number(row.orders || 0);
      const cl = Number(row.clicks || 0);
      const imp = Number(row.impressions || 0);

      const tt = targetTypeMap.get(row.target_type) || targetTypeMap.get("Keyword")!;
      tt.spend += sp;
      tt.sales += sa;
      tt.orders += ord;
      tt.clicks += cl;
      tt.impressions += imp;
      targetTotalSpend += sp;
      targetTotalSales += sa;

      if (row.target_type === "Keyword" && row.keyword_match_type !== "Unknown") {
        const km = keywordMatchMap.get(row.keyword_match_type);
        if (km) {
          km.spend += sp;
          km.sales += sa;
          km.orders += ord;
          km.clicks += cl;
          km.impressions += imp;
        }
      }
    }

    const targetTypeBreakdown: PpcTargetTypeBreakdown[] = Array.from(targetTypeMap.entries()).map(([targetType, data]) => {
      const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : (data.spend > 0 ? 999 : 0);
      const roas = data.spend > 0 ? data.sales / data.spend : 0;
      const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
      const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
      const spendShare = targetTotalSpend > 0 ? (data.spend / targetTotalSpend) * 100 : 0;
      const salesShare = targetTotalSales > 0 ? (data.sales / targetTotalSales) * 100 : 0;
      return {
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
      };
    }).sort((a, b) => b.spend - a.spend);

    const keywordTotalSpend = Array.from(keywordMatchMap.values()).reduce((sum, d) => sum + d.spend, 0);
    const keywordTotalSales = Array.from(keywordMatchMap.values()).reduce((sum, d) => sum + d.sales, 0);
    const keywordMatchTypeBreakdown: PpcKeywordMatchTypeBreakdown[] = Array.from(keywordMatchMap.entries()).map(([matchType, data]) => {
      const acos = data.sales > 0 ? (data.spend / data.sales) * 100 : (data.spend > 0 ? 999 : 0);
      const roas = data.spend > 0 ? data.sales / data.spend : 0;
      const cvr = data.clicks > 0 ? (data.orders / data.clicks) * 100 : 0;
      const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
      const spendShare = keywordTotalSpend > 0 ? (data.spend / keywordTotalSpend) * 100 : 0;
      const salesShare = keywordTotalSales > 0 ? (data.sales / keywordTotalSales) * 100 : 0;
      return {
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
      };
    }).sort((a, b) => b.spend - a.spend);

    const campaignPerformance = campaignPerformanceFromFacts(aggregates.topCampaigns, targetAcos).slice(0, 7);

    const skuPerformance: PpcSkuPerformance[] = aggregates.topSkus.map((row) => {
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
        campaignsCount: row.campaignsCount,
        statusBadge,
        skuCategory,
        revenueShare: totalSales > 0 ? Math.round((metrics.sales / totalSales) * 1000) / 10 : 0,
        spendShare: totalSpend > 0 ? Math.round((metrics.spend / totalSpend) * 1000) / 10 : 0,
      };
    });

    let dateRangeStart = aggregates.snapshotDates?.startDate || "";
    let dateRangeEnd = aggregates.snapshotDates?.endDate || "";
    if (!dateRangeStart || !dateRangeEnd) {
      dateRangeEnd = dailyTrends[dailyTrends.length - 1]?.date || new Date().toISOString().slice(0, 10);
      const startObj = new Date(dateRangeEnd);
      startObj.setDate(startObj.getDate() - (days - 1));
      dateRangeStart = startObj.toISOString().slice(0, 10);
    }

    const dataHealth: PpcDataHealth = {
      performanceSource: "BULK",
      searchTermSource: "SEARCH_TERM",
      performanceRows: campaignCount + aggregates.targetCount + aggregates.availableSkus.length,
      searchTermRows: searchTermData.summary.totalTerms,
      campaignRows: campaignCount,
      targetRows: aggregates.targetCount,
      productRows: aggregates.availableSkus.length,
      placementRows: 0,
      adTypes: aggregates.kpiRows.map((r) => r.ad_type),
      warnings: ["Chưa có placement grain; chưa thể đánh giá placement modifier."],
      strLoaded: true,
      bulkLoaded: true,
      dateRangeStart,
      dateRangeEnd,
      totalRecords: searchTermData.summary.totalTerms,
      granularity: "DAILY",
      spendCoveragePct: 100,
      clicksCoveragePct: 100,
      lastSyncTime: syncLogs[0]?.time ?? null,
    };

    return {
      stores,
      summary,
      skuPerformance,
      campaignPerformance,
      adGroups: [],
      targets: [],
      adTypeBreakdown,
      dataHealth,
      searchTermSummary,
      targetTypeBreakdown,
      keywordMatchTypeBreakdown,
      matchTypeBreakdown: [],
      dailyTrends,
      alerts,
      recommendations: [],
      searchTerms: searchTermData.topProfitableAndBleeding,
      availableSkus: aggregates.availableSkus,
      days,
      targetAcos,
      dateRangeStart,
      dateRangeEnd,
      lastSyncedAt: syncLogs[0]?.time ?? null,
      syncLogs,
      detailCounts: {
        campaigns: campaignCount,
        targets: aggregates.targetCount,
        searchTerms: searchTermData.summary.totalTerms,
        skus: aggregates.availableSkus.length,
      },
    };
  }

  // If a specific detail section is requested, only query the grains needed for that section
  let effectiveGrains = options.grains;
  if (!effectiveGrains) {
    if (section === "campaigns") effectiveGrains = ["CAMPAIGN"];
    else if (section === "ad_groups") effectiveGrains = ["AD_GROUP"];
    else if (section === "targets") effectiveGrains = ["TARGET"];
    else if (section === "skus") effectiveGrains = ["PRODUCT"];
    else if (section === "search_terms") effectiveGrains = [];
    else effectiveGrains = ["CAMPAIGN", "AD_GROUP", "TARGET", "PRODUCT", "PLACEMENT"];
  }

  const requestedGrains = new Set<PpcPerformanceGrain>(effectiveGrains);
  const performanceQuery = (grain: PpcPerformanceGrain, limit: number) => requestedGrains.has(grain)
    ? listPpcPerformance(scope, { storeName, sku, days }, { grain, limit })
    : Promise.resolve([] as PpcPerformanceRow[]);

  // Only query search terms if overview or search_terms section
  const shouldFetchSearchTerms = !isDetailSection || section === "search_terms";
  const shouldFetchSyncLogs = !isDetailSection;

  const [stores, storeRows, campaignRowsRaw, adGroupRows, targetRowsRaw, productRows, placementRows, syncLogs] = await Promise.all([
    listPpcStores(scope),
    shouldFetchSearchTerms ? listPpcSearchTerms(scope, { storeName, sku, days }) : Promise.resolve([] as PpcSearchTermRow[]),
    performanceQuery("CAMPAIGN", 15_000),
    performanceQuery("AD_GROUP", 10_000),
    performanceQuery("TARGET", 25_000),
    performanceQuery("PRODUCT", 10_000),
    performanceQuery("PLACEMENT", 5_000),
    shouldFetchSyncLogs ? listPpcSyncLogs(scope) : Promise.resolve([] as any[]),
  ]);
  const performanceRows = [
    ...campaignRowsRaw,
    ...adGroupRows,
    ...targetRowsRaw,
    ...productRows,
    ...placementRows,
  ];

  const rows = storeRows;

  const currentStore = stores.find((store) => store.name.toLowerCase() === storeName.toLowerCase());
  const targetAcos = currentStore?.targetAcos ?? DEFAULT_TARGET_ACOS;

  // Fast path for detail sections: skip computing overview alerts, breakdowns, and summaries
  if (isDetailSection) {
    const campaignPerformance = section === "campaigns" ? campaignPerformanceFromFacts(performanceRows, targetAcos) : [];
    const adGroups = section === "ad_groups" ? adGroupPerformanceFromFacts(performanceRows) : [];
    const targets = section === "targets" ? targetPerformanceFromFacts(performanceRows).slice(0, 20000) : [];
    const allSkuPerformance = section === "skus" ? skuPerformanceFromFacts(performanceRows, targetAcos) : [];
    const skuPerformance = section === "skus"
      ? (sku === "ALL" ? allSkuPerformance : allSkuPerformance.filter((row) => row.sku.toLowerCase() === sku.toLowerCase()))
      : [];

    return {
      stores,
      summary: null,
      skuPerformance,
      campaignPerformance,
      adGroups,
      targets,
      adTypeBreakdown: [],
      dataHealth: null,
      searchTermSummary: {
        totalSpend: 0,
        totalSales: 0,
        totalOrders: 0,
        totalClicks: 0,
        totalImpressions: 0,
        acos: 0,
        roas: 0,
        cpc: 0,
        ctr: 0,
        cvr: 0,
        wastedSpend: 0,
        bleedingSpend: 0,
        potentialSales: 0,
        zeroOrderTerms: 0,
        profitableTerms: 0,
      },
      targetTypeBreakdown: [],
      keywordMatchTypeBreakdown: [],
      matchTypeBreakdown: [],
      dailyTrends: [],
      alerts: [],
      recommendations: [],
      searchTerms: rows,
      availableSkus: Array.from(new Set(performanceRows.map((row) => row.sku).filter(Boolean))).sort(),
      days,
      targetAcos,
      dateRangeStart: new Date().toISOString().slice(0, 10),
      dateRangeEnd: new Date().toISOString().slice(0, 10),
      lastSyncedAt: null,
      syncLogs: [],
    };
  }
  const alerts: PpcAlert[] = generatePpcAlerts(rows, targetAcos);
  const normalizedTarget = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const targetState = performanceRows.filter((row) => row.grain === "TARGET");
  const targetKey = (adType: PpcAdType | undefined, value: string) => `${adType || "UNKNOWN"}\u0000${normalizedTarget(value)}`;
  const existingTargets = new Set(targetState.filter((row) => !row.isNegative).map((row) => targetKey(row.adType, row.targetExpression)));
  const existingNegatives = new Set(targetState.filter((row) => row.isNegative).map((row) => targetKey(row.adType, row.targetExpression)));
  const queryRecommendations = options.includeRecommendations === false ? [] : generatePpcRecommendations(rows, targetAcos).filter((recommendation) => {
    if (!recommendation.adType || recommendation.adType === "UNKNOWN") return false;
    const hasActiveDestination = targetState.some((target) =>
      target.adType === recommendation.adType &&
      (!recommendation.campaignId || target.campaignId === recommendation.campaignId) &&
      (!recommendation.adGroupId || target.adGroupId === recommendation.adGroupId) &&
      !/paused|archived/i.test(target.state || target.campaignState || target.adGroupState),
    );
    if (!hasActiveDestination) return false;
    const key = targetKey(recommendation.adType, recommendation.keyword);
    if (recommendation.recType === "HARVEST_KEYWORD") return !existingTargets.has(key);
    if (recommendation.recType === "NEGATIVE_KEYWORD") return !existingNegatives.has(key);
    return true;
  });
  const commonTargetRecs = options.includeRecommendations !== false && targetState.length > 0
    ? (await getCommonTargetRecommendations(
      targetState[0]?.storeId || stores[0]?.id || "",
      targetState,
      days,
    )).recommendations
    : [];

  const recommendations: PpcRecommendation[] = [
    ...commonTargetRecs,
    ...queryRecommendations,
  ];
  const searchTermSummary = calculatePpcSearchTermSummary(rows);
  const campaignRows = performanceRows.filter((row) => row.grain === "CAMPAIGN");
  const summary = campaignRows.length > 0
    ? calculatePerformanceSummary(campaignRows, {
      alerts: alerts.length,
      recommendations: recommendations.length,
      wastedSpend: searchTermSummary.wastedSpend,
    })
    : calculateSearchTermFallbackSummary(rows, {
      alerts: alerts.length,
      recommendations: recommendations.length,
      wastedSpend: searchTermSummary.wastedSpend,
    });
  const allSkuPerformance = skuPerformanceFromFacts(performanceRows, targetAcos);
  const skuPerformance = sku === "ALL"
    ? allSkuPerformance
    : allSkuPerformance.filter((row) => row.sku.toLowerCase() === sku.toLowerCase());
  const campaignPerformance = campaignPerformanceFromFacts(performanceRows, targetAcos);
  const adGroups = adGroupPerformanceFromFacts(performanceRows);
  const targets = targetPerformanceFromFacts(performanceRows).slice(0, 20000);
  const targetRows = performanceRows.filter((row) => row.grain === "TARGET" && !row.isNegative);
  const matchTypeBreakdown = targetRows.length ? groupPpcByMatchType(targetRows) : [];
  const targetTypeBreakdown = targetRows.length ? groupPpcByTargetType(targetRows) : [];
  const keywordMatchTypeBreakdown = targetRows.length ? groupPpcByKeywordMatchType(targetRows) : [];
  const adTypeBreakdown = adTypeBreakdownFromFacts(performanceRows);
  const dataHealth = performanceDataHealth(performanceRows, rows);
  const availableSkus = Array.from(new Set(performanceRows.map((row) => row.sku).filter(Boolean))).sort();
  const dailyTrends = calculatePpcDailyTrends(rows);
  const bulkSample = performanceRows.find((r) => r.reportStartDate && r.reportEndDate);
  let dateRangeStart: string;
  let dateRangeEnd: string;
  if (bulkSample && bulkSample.reportStartDate && bulkSample.reportEndDate) {
    dateRangeStart = bulkSample.reportStartDate;
    dateRangeEnd = bulkSample.reportEndDate;
  } else {
    let maxDate: string | null = null;
    if (dailyTrends.length > 0) {
      maxDate = dailyTrends[dailyTrends.length - 1].date;
    } else {
      for (const r of performanceRows) {
        const d = r.reportEndDate || r.snapshotDate;
        if (d && (!maxDate || d > maxDate)) maxDate = d;
      }
      for (const r of rows) {
        const d = r.reportEndDate || r.reportDate;
        if (d && (!maxDate || d > maxDate)) maxDate = d;
      }
    }
    dateRangeEnd = maxDate || new Date().toISOString().slice(0, 10);
    const startObj = new Date(dateRangeEnd);
    startObj.setDate(startObj.getDate() - (days - 1));
    dateRangeStart = startObj.toISOString().slice(0, 10);
  }

  return {
    stores,
    summary,
    skuPerformance,
    campaignPerformance,
    adGroups,
    targets,
    adTypeBreakdown,
    dataHealth,
    searchTermSummary,
    targetTypeBreakdown,
    keywordMatchTypeBreakdown,
    matchTypeBreakdown,
    dailyTrends,
    alerts,
    recommendations,
    searchTerms: rows,
    availableSkus,
    days,
    targetAcos,
    dateRangeStart,
    dateRangeEnd,
    lastSyncedAt: syncLogs[0]?.time ?? null,
    syncLogs,
  };
}

export async function ingestPpcExcelFile(
  scope: DataScope,
  fileBuffer: Buffer,
  fileName: string,
  storeName: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  const normalizedStore = canonicalStoreName(storeName);
  const adType = reportAdType(fileName);
  const isCsv = fileName.toLowerCase().endsWith(".csv");
  const prefersBulk = /bulk|campaign/i.test(fileName);
  const prefersSearchTerm = /search|term|str/i.test(fileName);

  try {
    // 1. If CSV or filename clearly indicates search term, try Search Term first
    if (isCsv || prefersSearchTerm) {
      try {
        const parsedRows = isCsv
          ? parseSearchTermCsv(fileBuffer, normalizedStore, adType)
          : await parseSearchTermWorkbook(fileBuffer, normalizedStore, adType);
        if (parsedRows.length) {
          const effectiveStore = parsedRows[0]?.storeName || normalizedStore;
          const saved = await upsertPpcSearchTerms(scope, effectiveStore, parsedRows, { replaceExisting: true });
          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `Search Term ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
          });
          return { reportType: "SEARCH_TERM", totalParsed: parsedRows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: effectiveStore };
        }
      } catch (err) {
        if (isCsv) throw err;
      }
    }

    // 2. Try Bulk
    if (!isCsv) {
      try {
        const rows = await parseBulkFile(fileBuffer, normalizedStore, fileName, coverageOptions);
        if (rows.length) {
          const detectedType = rows.find((r) => r.adType && r.adType !== "UNKNOWN")?.adType || adType;
          const effectiveAdType = detectedType !== "UNKNOWN" ? detectedType : "SP";
          const saved = await upsertPpcPerformance(scope, normalizedStore, rows, { replaceExisting: true });
          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `Bulk ${effectiveAdType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
          });
          return { reportType: "BULK", totalParsed: rows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: normalizedStore };
        }
      } catch (err) {
        if (prefersBulk) throw err;
      }
    }

    // 3. Fallback to Search Term for .xlsx if not already tried
    if (!isCsv && !prefersSearchTerm) {
      const parsedRows = await parseSearchTermWorkbook(fileBuffer, normalizedStore, adType);
      if (parsedRows.length) {
        const effectiveStore = parsedRows[0]?.storeName || normalizedStore;
        const detectedType = parsedRows.find((r) => r.adType && r.adType !== "UNKNOWN")?.adType || adType;
        const effectiveAdType = detectedType !== "UNKNOWN" ? detectedType : "SP";
        const saved = await upsertPpcSearchTerms(scope, effectiveStore, parsedRows, { replaceExisting: true });
        await recordPpcSyncLog(scope, {
          source: "MANUAL_UPLOAD",
          fileName,
          status: "SUCCESS",
          count: saved.inserted + saved.updated,
          message: `Search Term ${effectiveAdType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật, ${saved.deduplicated} dòng trùng.`,
        });
        return { reportType: "SEARCH_TERM", totalParsed: parsedRows.length, newInserted: saved.inserted, updated: saved.updated, deduplicated: saved.deduplicated, fileName, storeName: effectiveStore };
      }
    }

    throw new PpcInputError("File không chứa dữ liệu hợp lệ của Bulk Operations hoặc Search Term Report.");
  } catch (error) {
    console.error("[PPC Ingest Error]", error);
    if (error instanceof PpcInputError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PpcInputError(`Lỗi xử lý file PPC: ${detail}`);
  }
}

export async function ingestPpcFilePath(
  scope: DataScope,
  filePath: string,
  fileName: string,
  storeName: string,
  coverageOptions: { days?: number; endDate?: string } = {},
) {
  if (!fileName.toLowerCase().endsWith(".xlsx") || /search|term|str/i.test(fileName)) {
    const { readFile } = await import("node:fs/promises");
    return ingestPpcExcelFile(scope, await readFile(filePath), fileName, storeName, coverageOptions);
  }

  const normalizedStore = canonicalStoreName(storeName);
  const options = {
    ...inferPpcReportCoverage(fileName, coverageOptions),
    adType: reportAdType(fileName),
  };
  try {
    let detectedAdType: PpcAdType = options.adType || "UNKNOWN";
    const result = await ingestPpcPerformanceStream(
      scope,
      normalizedStore,
      async (pushBatch) => {
        return streamLargeBulkWorkbookFile(
          filePath,
          normalizedStore,
          options,
          async (rows) => {
            if (detectedAdType === "UNKNOWN" && rows.length > 0) {
              const found = rows.find((r) => r.adType && r.adType !== "UNKNOWN");
              if (found) detectedAdType = found.adType;
            }
            await pushBatch(rows);
          },
          2000,
        );
      },
      { replaceExisting: true },
    );

    if (!result.totalParsed) throw new PpcInputError("File không chứa dữ liệu Bulk Operations hợp lệ.");
    const effectiveAdType = detectedAdType !== "UNKNOWN" ? detectedAdType : (options.adType !== "UNKNOWN" ? options.adType : "SP");
    await recordPpcSyncLog(scope, {
      source: "MANUAL_UPLOAD",
      fileName,
      status: "SUCCESS",
      count: result.inserted,
      message: `Bulk ${effectiveAdType}: ${result.inserted} dòng nạp atomic qua staging (${result.deduplicated} dòng trùng).`,
    });
    invalidateGroupedRecommendationsCache(normalizedStore);
    return {
      reportType: "BULK",
      totalParsed: result.totalParsed,
      newInserted: result.inserted,
      updated: result.updated,
      deduplicated: result.deduplicated,
      fileName,
      storeName: normalizedStore,
    };
  } catch (error) {
    if (error instanceof PpcInputError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PpcInputError(`Lỗi xử lý file PPC: ${detail}`);
  }
}

export async function resetPpcToMockData(scope: DataScope) {
  const rows = generateMockSearchTerms();
  await replacePpcDataWithMock(scope, MOCK_STORES, rows);
  await recordPpcSyncLog(scope, {
    source: "MOCK_DATA",
    status: "SUCCESS",
    count: rows.length,
    message: "Dữ liệu mẫu được nạp lại theo yêu cầu quản trị.",
  });
}

export async function syncPpcReportsFromR2(scope: DataScope) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = `${(process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "")}/`;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Chưa cấu hình đầy đủ thông tin Cloudflare R2.");
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const objects: Array<{ Key?: string; ETag?: string; Size?: number; LastModified?: Date }> = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1_000,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const reportFiles = objects.filter((object) => /\.(xlsx|csv)$/i.test(object.Key || ""));
  const recognizedFiles = reportFiles.filter((object) => {
    const key = object.Key || "";
    return /search[\s_-]*term/i.test(key) || /(?:^|\/|[\s_-])bulk/i.test(key);
  });
  const searchTermFiles = recognizedFiles.filter((object) => /search[\s_-]*term/i.test(object.Key || ""));
  const bulkFiles = recognizedFiles.filter((object) => /(?:^|\/|[\s_-])bulk/i.test(object.Key || "") && !/search[\s_-]*term/i.test(object.Key || ""));
  const ignored = reportFiles.length - recognizedFiles.length;
  const knownStores = (await listPpcStores(scope)).map((store) => store.name);
  const grouped = new Map<string, typeof recognizedFiles>();
  for (const object of recognizedFiles) {
    const key = object.Key || "";
    const storeName = resolveStoreName(key, knownStores);
    if (!storeName) continue;
    const existing = grouped.get(storeName) || [];
    existing.push(object);
    grouped.set(storeName, existing);
  }

  let totalParsed = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let filesProcessed = 0;
  const failures: Array<{ fileName: string; error: string }> = [];

  for (const [storeName, storeFiles] of grouped.entries()) {
    const latestBatch = storeFiles.reduce((latest, object) => {
      const dates = (object.Key || "").split("/").filter((part) => /^\d{8}$/.test(part));
      const batch = dates.at(-1) || "00000000";
      return batch > latest ? batch : latest;
    }, "00000000");
    let candidates = storeFiles.filter((object) => (object.Key || "").split("/").includes(latestBatch));
    const inputCandidates = candidates.filter((object) => (object.Key || "").toLowerCase().includes("/input/"));
    if (inputCandidates.length) candidates = inputCandidates;

    const selectedFiles = candidates;
    const parsedSearchTerms: Array<{ object: (typeof selectedFiles)[number]; rows: PpcSearchTermRow[] }> = [];
    const parsedPerformance: Array<{ object: (typeof selectedFiles)[number]; rows: Awaited<ReturnType<typeof parseBulkWorkbook>> }> = [];

    for (const object of selectedFiles) {
      const fileName = object.Key || "";
      const version = r2Version(object);
      try {
        const alreadySynced = await hasSuccessfulPpcSync(scope, "CLOUDFLARE_R2", fileName, version);
        if (alreadySynced) {
          console.log(`[R2 Sync] Bỏ qua file đã đồng bộ thành công trước đó: ${fileName} (${version})`);
          filesProcessed++;
          continue;
        }

        if ((object.Size || 0) > MAX_R2_FILE_BYTES) {
          throw new Error(`File vượt quá giới hạn ${Math.round(MAX_R2_FILE_BYTES / 1_000_000)} MB.`);
        }
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileName }));
        if (!response.Body) throw new Error("R2 trả về file rỗng.");
        const buffer = Buffer.from(await response.Body.transformToByteArray());
        const adType = reportAdType(fileName);
        if (/search[\s_-]*term/i.test(fileName)) {
          const rows = fileName.toLowerCase().endsWith(".csv")
            ? parseSearchTermCsv(buffer, storeName, adType)
            : await parseSearchTermWorkbook(buffer, storeName, adType);
          if (!rows.length) throw new Error("Không có dữ liệu Search Term hợp lệ.");
          parsedSearchTerms.push({ object, rows });
        } else {
          if (fileName.toLowerCase().endsWith(".csv")) throw new Error("Bulk Operations cần định dạng .xlsx.");
          const rows = await parseBulkFile(buffer, storeName, fileName);
          if (!rows.length) throw new Error("Không có entity Bulk hợp lệ.");
          parsedPerformance.push({ object, rows });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lỗi không xác định";
        failures.push({ fileName, error: message });
        await recordPpcSyncLog(scope, {
          source: "CLOUDFLARE_R2",
          fileName,
          sourceVersion: r2Version(object),
          status: "FAILED",
          message: `Giữ nguyên snapshot cũ của ${storeName}: ${message}`,
        });
      }
    }

    if (parsedSearchTerms.length) {
      const mergedRows = parsedSearchTerms.flatMap((item) => item.rows);
      const saved = await upsertPpcSearchTerms(scope, storeName, mergedRows, { replaceExisting: true });
      totalParsed += mergedRows.length;
      totalNew += saved.inserted;
      totalUpdated += saved.updated;
    }
    if (parsedPerformance.length) {
      const mergedRows = parsedPerformance.flatMap((item) => item.rows);
      const saved = await upsertPpcPerformance(scope, storeName, mergedRows, { replaceExisting: true });
      totalParsed += mergedRows.length;
      totalNew += saved.inserted;
      totalUpdated += saved.updated;
    }
    const processed = [...parsedSearchTerms, ...parsedPerformance];
    filesProcessed += processed.length;
    for (const item of processed) {
      await recordPpcSyncLog(scope, {
        source: "CLOUDFLARE_R2",
        fileName: item.object.Key || "",
        sourceVersion: r2Version(item.object),
        status: "SUCCESS",
        count: item.rows.length,
        message: `Snapshot PPC ${latestBatch} của ${storeName}; ${item.rows.length} dòng nguồn.`,
      });
    }
  }

  return {
    filesFound: reportFiles.length,
    searchTermFiles: searchTermFiles.length,
    bulkFiles: bulkFiles.length,
    filesProcessed,
    ignored,
    skipped: ignored,
    failed: failures.length,
    failures: failures.slice(0, 20),
    totalParsed,
    totalNew,
    totalUpdated,
  };
}

export const AMAZON_BULKSHEET_SP_COLUMNS = [
  "Product",                                                    // 1 (A)
  "Entity",                                                     // 2 (B)
  "Operation",                                                  // 3 (C)
  "Campaign ID",                                                // 4 (D)
  "Ad Group ID",                                                // 5 (E)
  "Portfolio ID",                                               // 6 (F)
  "Ad ID",                                                      // 7 (G)
  "Keyword ID",                                                 // 8 (H)
  "Product Targeting ID",                                       // 9 (I)
  "Campaign Name",                                              // 10 (J)
  "Ad Group Name",                                              // 11 (K)
  "Campaign Name (Informational only)",                         // 12 (L)
  "Ad Group Name (Informational only)",                         // 13 (M)
  "Portfolio Name (Informational only)",                        // 14 (N)
  "Start Date",                                                 // 15 (O)
  "End Date",                                                   // 16 (P)
  "Targeting Type",                                             // 17 (Q)
  "State",                                                      // 18 (R)
  "Campaign State (Informational only)",                        // 19 (S)
  "Ad Group State (Informational only)",                        // 20 (T)
  "Daily Budget",                                               // 21 (U)
  "SKU",                                                        // 22 (V)
  "ASIN (Informational only)",                                  // 23 (W)
  "Eligibility Status (Informational only)",                    // 24 (X)
  "Reason for Ineligibility (Informational only)",              // 25 (Y)
  "Ad Group Default Bid",                                       // 26 (Z)
  "Ad Group Default Bid (Informational only)",                  // 27 (AA)
  "Bid",                                                        // 28 (AB)
  "Keyword Text",                                               // 29 (AC)
  "Native Language Keyword",                                    // 30 (AD)
  "Native Language Locale",                                     // 31 (AE)
  "Match Type",                                                 // 32 (AF)
  "Bidding Strategy",                                           // 33 (AG)
  "Placement",                                                  // 34 (AH)
  "Percentage",                                                 // 35 (AI)
  "Product Targeting Expression",                               // 36 (AJ)
  "Resolved Product Targeting Expression (Informational only)", // 37 (AK)
  "Audience ID",                                                // 38 (AL)
  "Shopper Cohort Percentage",                                  // 39 (AM)
  "Shopper Cohort Type",                                        // 40 (AN)
  "Segment Name (Informational only)",                          // 41 (AO)
  "Sites",                                                      // 42 (AP)
  "Off-Amazon ad serving",                                      // 43 (AQ)
  "Impressions",                                                // 44 (AR)
  "Clicks",                                                     // 45 (AS)
  "Click-through Rate",                                         // 46 (AT)
  "Spend",                                                      // 47 (AU)
  "Sales",                                                      // 48 (AV)
  "Orders",                                                     // 49 (AW)
  "Units",                                                      // 50 (AX)
  "Conversion Rate",                                            // 51 (AY)
  "ACOS",                                                       // 52 (AZ)
  "CPC",                                                        // 53 (BA)
  "ROAS",                                                       // 54 (BB)
];

/**
 * Xuất file Excel Bulksheet format chuẩn 100% từ chính file mẫu gốc Amazon
 * (AdvertisingBulksheetTemplate-seller.xlsx) để đảm bảo tương thích tuyệt đối
 * khi nạp lên Amazon Seller Central (Bulk Operations).
 */
export async function exportBulksheetUpdateExcel(recommendations: PpcRecommendation[]): Promise<Buffer> {
  const { spawn } = await import("node:child_process");
  const path = (await import("node:path")).default;
  const fs = (await import("node:fs")).default;

  const pythonScript = path.join(process.cwd(), "scripts", "export_amazon_bulksheet.py");
  const templatePath = path.join(process.cwd(), "templates", "ppc", "AdvertisingBulksheetTemplate-seller.xlsx");

  if (fs.existsSync(pythonScript) && fs.existsSync(templatePath)) {
    return new Promise((resolve, reject) => {
      const proc = spawn("python3", [pythonScript], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      proc.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));

      proc.on("close", (code) => {
        if (code !== 0) {
          const errText = Buffer.concat(errChunks).toString("utf-8");
          return reject(new Error(`Lỗi khi tạo Bulksheet từ mẫu Amazon: ${errText}`));
        }
        resolve(Buffer.concat(chunks));
      });

      proc.stdin.write(JSON.stringify(recommendations));
      proc.stdin.end();
    });
  }

  // Fallback: Tạo bằng ExcelJS nếu không tìm thấy template gốc
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Advertising";
  workbook.created = new Date();

  const portfolioSheet = workbook.addWorksheet("Portfolios");
  portfolioSheet.addRow(["Portfolio ID", "Portfolio Name", "Currency"]);

  const spSheet = workbook.addWorksheet("Sponsored Products Campaigns");
  const headerRow = spSheet.addRow(AMAZON_BULKSHEET_SP_COLUMNS);
  headerRow.font = { name: "Arial", size: 10, bold: true };

  for (const rec of recommendations) {
    let entity = "Keyword";
    let operation = "Update";
    let matchType = "";
    let state = "enabled";
    let bidVal: number | string = "";

    if (rec.recType === "NEGATIVE_KEYWORD") {
      entity = "Negative Keyword";
      operation = "Create";
      matchType = "Negative Exact";
      state = "enabled";
      bidVal = "";
    } else if (rec.recType === "BID_DECREASE" || rec.recType === "BID_INCREASE") {
      entity = "Keyword";
      operation = "Update";
      matchType = rec.matchType === "Exact" || rec.matchType === "Phrase" || rec.matchType === "Broad"
        ? rec.matchType
        : "";
      state = "enabled";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : "";
    } else if (rec.recType === "PAUSE_TARGET") {
      entity = "Keyword";
      operation = "Update";
      matchType = rec.matchType === "Exact" || rec.matchType === "Phrase" || rec.matchType === "Broad"
        ? rec.matchType
        : "";
      state = "paused";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : "";
    } else if (rec.recType === "HARVEST_KEYWORD") {
      entity = "Keyword";
      operation = "Create";
      matchType = "Exact";
      state = "enabled";
      bidVal = rec.recommendedBid ? Number(rec.recommendedBid.toFixed(2)) : 1.0;
    }

    const row = new Array(AMAZON_BULKSHEET_SP_COLUMNS.length).fill("");
    row[0] = "Sponsored Products";
    row[1] = entity;
    row[2] = operation;
    row[3] = rec.campaignId || "";
    row[4] = rec.adGroupId || "";
    row[7] = entity === "Keyword" ? (rec.keywordId || "") : "";
    row[9] = rec.campaignName || "";
    row[10] = rec.adGroupName || "";
    row[11] = rec.campaignName || "";
    row[12] = rec.adGroupName || "";
    row[17] = state;
    row[27] = bidVal;
    row[28] = rec.keyword;
    row[31] = matchType;

    spSheet.addRow(row);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
