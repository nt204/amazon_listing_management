export type MatchType = "Exact" | "Phrase" | "Broad" | "Auto" | "Targeting" | "Unknown";
export type PpcAdType = "SP" | "SB" | "SD" | "UNKNOWN";
export type PpcReportGranularity = "DAILY" | "RANGE";
export type PpcPerformanceGrain = "CAMPAIGN" | "AD_GROUP" | "TARGET" | "PRODUCT" | "PLACEMENT";
export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";
export type AlertType = "BLEEDING_KEYWORD" | "HIGH_ACOS" | "OUT_OF_BUDGET" | "LOW_CVR";
export type RecommendationType = "NEGATIVE_KEYWORD" | "BID_DECREASE" | "BID_INCREASE" | "HARVEST_KEYWORD";

export interface PpcStore {
  id: string;
  name: string;
  marketplace: string;
  targetAcos: number;
  dailyBudget: number;
  status: "ACTIVE" | "PAUSED";
}

export interface PpcSearchTermRow {
  id?: string;
  storeId?: string;
  storeName?: string;
  reportDate: string; // YYYY-MM-DD
  reportStartDate?: string; // coverage start, YYYY-MM-DD
  reportEndDate?: string; // coverage end, YYYY-MM-DD
  reportGranularity?: PpcReportGranularity;
  adType?: PpcAdType;
  portfolioName: string; // SKU or Portfolio
  campaignName: string;
  adGroupName: string;
  targetKeyword: string;
  customerSearchTerm: string;
  matchType: MatchType;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  cpc: number;
  ctr: number; // clicks / impressions
  cvr: number; // orders / clicks
  acos: number; // spend / sales * 100
  roas: number; // sales / spend
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
}

export interface PpcPerformanceRow {
  id?: string;
  storeId?: string;
  storeName?: string;
  snapshotDate: string;
  reportStartDate: string;
  reportEndDate: string;
  reportGranularity: PpcReportGranularity;
  adType: PpcAdType;
  grain: PpcPerformanceGrain;
  entityId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  targetId: string;
  targetExpression: string;
  matchType: MatchType;
  portfolioName: string;
  sku: string;
  asin: string;
  state: string;
  campaignState: string;
  adGroupState: string;
  targetingType: string;
  biddingStrategy: string;
  placement: string;
  dailyBudget: number;
  bid: number;
  placementAdjustment: number;
  isNegative: boolean;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

export interface PpcAlert {
  id: string;
  storeId: string;
  storeName: string;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  sku?: string;
  searchTerm?: string;
  metricValue: number;
  thresholdValue: number;
  status: "ACTIVE" | "RESOLVED" | "DISMISSED";
  createdAt: string;
}

export interface PpcRecommendation {
  id: string;
  storeId: string;
  storeName: string;
  adType?: PpcAdType;
  recType: RecommendationType;
  targetType: "EXACT" | "PHRASE" | "PRODUCT";
  keyword: string;
  campaignName?: string;
  adGroupName?: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  priority?: "P0" | "P1" | "P2";
  currentBid?: number;
  recommendedBid?: number;
  reason: string;
  estimatedSavings: number;
  status: "PENDING" | "APPLIED" | "DISMISSED";
  createdAt: string;
}

export interface PpcSummaryMetrics {
  totalSpend: number;
  totalSales: number;
  blendedAcos: number;
  blendedRoas: number;
  totalClicks: number;
  totalImpressions: number;
  totalOrders: number;
  totalUnits: number;
  avgCpc: number;
  overallCtr: number;
  overallCvr: number;
  cpa: number;
  aov: number;
  wastedSpend: number; // spend on clicks with 0 orders
  activeAlertsCount: number;
  pendingRecsCount: number;
}

export interface PpcSkuPerformance {
  sku: string;
  storeName: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  ctr: number;
  acos: number;
  roas: number;
  cvr: number;
  cpc: number;
  cpa: number;
  aov: number;
  campaignsCount: number;
  statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL" | "ZERO_CLICKS" | "INACTIVE";
  skuCategory: "HERO" | "BLEEDING" | "POTENTIAL" | "NEUTRAL" | "ZERO_CLICKS";
  revenueShare: number; // % of total store sales
  spendShare: number;   // % of total store spend
}

export interface PpcCampaignPerformance {
  campaignId?: string;
  campaignName: string;
  storeName: string;
  adType?: PpcAdType;
  targetingType: "Auto" | "Manual";
  state?: string;
  dailyBudget?: number;
  budgetUtilization?: number;
  biddingStrategy?: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
  cvr: number;
  acos: number;
  roas: number;
  cpa: number;
  aov: number;
  statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
}

export interface PpcAdGroupPerformance {
  campaignName: string;
  adGroupName: string;
  storeName: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
  cvr: number;
  acos: number;
  roas: number;
  cpa: number;
  aov: number;
}

export interface PpcTargetPerformance extends PpcAdGroupPerformance {
  targetId?: string;
  targetKeyword: string;
  matchType: MatchType;
  adType?: PpcAdType;
  state?: string;
  currentBid?: number;
}

export interface PpcDailyTrendPoint {
  date: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
  cvr: number;
  ctr: number;
  cpc: number;
}

export interface PpcMetricComparison {
  current: number;
  previous: number;
  changePct?: number;
  changePts?: number;
}

export interface PpcExecutiveOverview {
  spend: PpcMetricComparison;
  sales: PpcMetricComparison;
  orders: PpcMetricComparison;
  impressions: PpcMetricComparison;
  clicks: PpcMetricComparison;
  acos: PpcMetricComparison;
  roas: PpcMetricComparison;
  cvr: PpcMetricComparison;
  ctr: PpcMetricComparison;
  cpc: PpcMetricComparison;
  cpa: PpcMetricComparison;
  aov: PpcMetricComparison;
}

export interface PpcSearchTermSummary {
  totalTerms: number;
  termsWithOrders: number;
  termsWithoutOrders: number;
  candidateBleederTerms: number;
  observedSpend: number;
  observedSales: number;
  observedOrders: number;
  observedClicks: number;
  observedAcos: number;
  observedRoas: number;
  wastedSpend: number;
}

export interface PpcAdTypeBreakdown {
  adType: PpcAdType;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
}

export interface PpcDataHealth {
  performanceSource: "BULK" | "NONE";
  searchTermSource: "SEARCH_TERM" | "NONE";
  performanceRows: number;
  searchTermRows: number;
  campaignRows: number;
  targetRows: number;
  productRows: number;
  placementRows: number;
  adTypes: PpcAdType[];
  warnings: string[];
  strLoaded?: boolean;
  bulkLoaded?: boolean;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  totalRecords?: number;
  granularity?: PpcReportGranularity | "N/A";
  spendCoveragePct?: number;
  clicksCoveragePct?: number;
  lastSyncTime?: string | null;
}

export interface PpcMatchTypeBreakdown {
  matchType: MatchType;
  spend: number;
  spendShare: number;
  sales: number;
  salesShare: number;
  orders: number;
  clicks: number;
  impressions: number;
  cpc: number;
  cvr: number;
  acos: number;
  roas: number;
}

export interface PpcVelocityComparison {
  recentDays: number;
  baselineDays: number;
  recentDailySpend: number;
  baselineDailySpend: number;
  spendGrowthRate: number; // percentage change in daily spend
  recentAcos: number;
  baselineAcos: number;
  acosDelta: number; // percentage points difference
  trendStatus: "ACCELERATING_EFFICIENCY" | "OVERSPENDING_RISK" | "STABLE" | "COOLING_DOWN";
}

export interface PpcAnalyticsData {
  stores: PpcStore[];
  summary: PpcSummaryMetrics;
  velocity?: PpcVelocityComparison;
  skuPerformance: PpcSkuPerformance[];
  campaigns: PpcCampaignPerformance[];
  targets?: PpcTargetPerformance[];
  adTypeBreakdown?: PpcAdTypeBreakdown[];
  dataHealth?: PpcDataHealth;
  matchTypeBreakdown: PpcMatchTypeBreakdown[];
  searchTerms: PpcSearchTermRow[];
  alerts: PpcAlert[];
  recommendations: PpcRecommendation[];
  lastSyncedAt?: string | null;
}
