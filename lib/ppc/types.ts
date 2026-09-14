export type MatchType = "Exact" | "Phrase" | "Broad" | "Auto" | "Targeting";
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
  acos: number;
  roas: number;
  cvr: number;
  statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
  skuCategory: "HERO" | "BLEEDING" | "POTENTIAL" | "NEUTRAL";
  revenueShare: number; // % of total store sales
  spendShare: number;   // % of total store spend
}

export interface PpcCampaignPerformance {
  campaignName: string;
  storeName: string;
  targetingType: "Auto" | "Manual";
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
  statusBadge: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
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
  matchTypeBreakdown: PpcMatchTypeBreakdown[];
  searchTerms: PpcSearchTermRow[];
  alerts: PpcAlert[];
  recommendations: PpcRecommendation[];
  lastSyncedAt?: string | null;
}
