export type MatchType = "Exact" | "Phrase" | "Broad" | "Auto" | "Targeting" | "Unknown";
export type PpcAdType = "SP" | "SB" | "SD" | "UNKNOWN";
export type PpcReportGranularity = "DAILY" | "RANGE";
export type PpcPerformanceGrain = "CAMPAIGN" | "AD_GROUP" | "TARGET" | "PRODUCT" | "PLACEMENT";
export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";
export type AlertType = "BLEEDING_KEYWORD" | "HIGH_ACOS" | "OUT_OF_BUDGET" | "LOW_CVR";
export type RecommendationType = "NEGATIVE_KEYWORD" | "BID_DECREASE" | "BID_INCREASE" | "HARVEST_KEYWORD" | "PAUSE_TARGET";

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
  portfolioName?: string;
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
  ctr: number;
  cvr: number;
  acos: number;
  roas: number;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
}

export interface PpcPerformanceRow {
  id?: string;
  storeId?: string;
  storeName?: string;
  snapshotDate: string; // YYYY-MM-DD
  reportStartDate: string; // YYYY-MM-DD
  reportEndDate: string; // YYYY-MM-DD
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
  cpc?: number;
  ctr?: number;
  cvr?: number;
  acos?: number;
  roas?: number;
}

export interface PpcAlert {
  id: string;
  storeId: string;
  storeName: string;
  adType?: PpcAdType;
  severity: AlertSeverity;
  alertType: AlertType;
  title?: string;
  sku?: string;
  searchTerm?: string;
  targetType?: "CAMPAIGN" | "KEYWORD" | "SEARCH_TERM" | "PRODUCT";
  entityName?: string;
  campaignName?: string;
  adGroupName?: string;
  metricName?: string;
  metricValue: number;
  thresholdValue: number;
  message: string;
  recommendedAction?: string;
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
  matchType?: MatchType;
  keyword: string;
  campaignName?: string;
  portfolioName?: string;
  adGroupName?: string;
  sku?: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  priority?: "P0" | "P1" | "P2";
  currentBid?: number;
  recommendedBid?: number;
  reason: string;
  estimatedSavings: number;
  status: "PENDING" | "APPLIED" | "DISMISSED";
  productType?: string;
  ruleProfile?: string;
  actionState?: "ENABLE" | "PAUSED";
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
  storeId?: string;
  campaignId?: string;
  adGroupId?: string;
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

export type PpcTargetType = "Keyword" | "Auto" | "Product Targeting" | "Other";
export type PpcKeywordMatchType = "Exact" | "Phrase" | "Broad" | "Unknown";

export interface PpcTargetTypeBreakdown {
  targetType: PpcTargetType;
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

export interface PpcKeywordMatchTypeBreakdown {
  matchType: PpcKeywordMatchType;
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
  targetTypeBreakdown?: PpcTargetTypeBreakdown[];
  keywordMatchTypeBreakdown?: PpcKeywordMatchTypeBreakdown[];
  matchTypeBreakdown: PpcMatchTypeBreakdown[];
  searchTerms: PpcSearchTermRow[];
  alerts: PpcAlert[];
  recommendations: PpcRecommendation[];
  lastSyncedAt?: string | null;
}
