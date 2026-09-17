// lib/ppc/sku-architecture-types.ts
import type { MatchType } from "./types";

export interface ProductCostMaster {
  id: string;
  productType: string;
  baseCost: number;
  defaultAmazonFee: number;
  taxRate: number; // e.g. 0.03 for 3%
  defaultPrice: number; // e.g. 25.00
  breakEvenAcos: number; // e.g. 46.0 for 46%
  version: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null;
  notes?: string | null;
  skuCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type CrSource = "ACTUAL_30D" | "CALCULATED" | "INHERITED" | "OVERRIDE" | "ASSUMED";
export type CostSource = "INHERITED" | "OVERRIDE";
export type PpcStatus = "Healthy" | "Review" | "Bleeding" | "Zero Clicks";
export const SKU_PREFIX_ERROR_PRODUCT_TYPE = "Lỗi Prefix";

export interface SkuEconomics {
  id: string;
  storeId: string;
  sku: string;
  asin: string;
  productType: string;
  sellingPrice: number;
  baseCost: number;
  amazonFee: number;
  taxRate: number;
  profitBeforeAds: number;
  breakEvenAcos: number; // percentage, e.g. 45.0
  cr: number; // conversion rate, e.g. 0.10 for 10%
  crSource: CrSource;
  maxBid: number;
  costSource: CostSource;
  ppcStatus?: PpcStatus;
  // Performance aggregations
  spend?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
  impressions?: number;
  acos?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleHasOrderTier {
  minAcos: number;
  maxAcos: number;
  action: "BID_INCREASE" | "BID_DECREASE" | "HOLD";
  pct: number; // e.g. 8 for +8%, -8 for -8%
  base: "CURRENT_BID" | "AVG_CPC" | "NONE";
  description: string;
}

export interface RuleNoOrderTier {
  minClicks: number;
  maxClicks: number;
  action: "BID_INCREASE" | "BID_DECREASE" | "HOLD" | "PAUSE_TARGET";
  pct: number;
  base: "CURRENT_BID" | "AVG_CPC" | "MIN_BID" | "NONE";
  description: string;
}

export interface RuleLimits {
  minBid: number;
  maxBid: number;
}

export interface PpcRuleDefinition {
  campaignType: "SB01" | "SB05" | "SP01" | "SP03" | "SP04";
  hasOrder: RuleHasOrderTier[];
  noOrder: RuleNoOrderTier[];
  limits: RuleLimits;
}

export interface PpcRuleVersion {
  id: string;
  campaignType: "SB01" | "SB05" | "SP01" | "SP03" | "SP04";
  version: string; // "v1.0"
  status: "PUBLISHED" | "DRAFT" | "SCHEDULED" | "ARCHIVED";
  ruleJson: PpcRuleDefinition;
  effectiveFrom: string;
  createdAt: string;
}

export type ActionType = "UPDATE_BID" | "PAUSE_TARGET" | "ENABLE_TARGET" | "UPDATE_BUDGET";
export type ActionStatus = "PENDING" | "APPROVED" | "QUEUED" | "EXPORTED" | "APPLIED" | "IGNORED" | "SUPERSEDED";

export interface PpcAction {
  id: string;
  storeId: string;
  recommendationId?: string | null;
  sku: string;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  adGroupId: string;
  adGroupName: string;
  targetId: string;
  targetKeyword: string;
  matchType: MatchType;
  entityType: "KEYWORD" | "CAMPAIGN" | "AD_GROUP" | "PRODUCT";
  actionType: ActionType;
  oldValue: number | null;
  systemSuggestedValue: number | null;
  finalValue: number | null;
  ruleVersion: string;
  matchedRuleId?: string | null;
  status: ActionStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkExportItem {
  id: string;
  bulkExportId: string;
  actionId?: string | null;
  amazonEntityType: string;
  amazonOperation: string;
  exportStatus: string;
  rowData: Record<string, unknown>;
  errorMessage?: string | null;
  createdAt: string;
}

export interface BulkExport {
  id: string;
  storeId: string;
  fileName: string;
  actionCount: number;
  summary: {
    updateBidCount: number;
    pauseCount: number;
    budgetCount: number;
    enableCount: number;
  };
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  createdAt: string;
  items?: BulkExportItem[];
}

export interface SkuRecommendationGroup {
  sku: string;
  asin: string;
  productType: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  breakEvenAcos: number;
  totalRecommendations: number;
  increaseCount: number;
  decreaseCount: number;
  pauseCount: number;
  budgetCount: number;
  economics: SkuEconomics;
}

/**
 * Công thức kinh tế:
 * Profit Before Ads = Price - Amazon Fee - Base Cost - (Price * Tax Rate)
 */
export function calculateProfitBeforeAds(
  price: number,
  amazonFee: number,
  baseCost: number,
  taxRate: number = 0.03,
): number {
  const tax = price * taxRate;
  const profit = price - amazonFee - baseCost - tax;
  return Math.round(profit * 100) / 100;
}

/**
 * Break-even ACoS = Profit Before Ads / Price
 */
export function calculateBreakEvenAcos(profitBeforeAds: number, price: number): number {
  if (price <= 0) return 0;
  const beAcos = (profitBeforeAds / price) * 100;
  return Math.round(beAcos * 10) / 10;
}

/**
 * Max Bid = CR * Profit Before Ads
 */
export function calculateMaxBid(cr: number, profitBeforeAds: number): number {
  if (profitBeforeAds <= 0) return 0.05;
  const effectiveCr = cr > 0 ? cr : 0.10;
  const maxBid = effectiveCr * profitBeforeAds;
  return Math.max(0.05, Math.round(maxBid * 100) / 100);
}

/**
 * Cấu hình quy tắc ánh xạ SKU sang Loại Sản Phẩm (Product Type)
 */
export const SKU_TO_PRODUCT_TYPE_RULE_SET = {
  schema_version: "1.0",
  rule_set_id: "sku_to_product_type_mapping",
  normalization: {
    trim_whitespace: true,
    uppercase: true,
  },
  taxonomy: {
    "Blanket Hoodie": "Oodie",
  } as Record<string, string>,
  exception_map: {
    "BHL180660A01": "Glass Ornament",
  } as Record<string, string>,
  prefix_rules: [
    { prefix: "CBH", product_type: "Oodie" },
    { prefix: "ODL", product_type: "Oodie" },
    { prefix: "OHN", product_type: "Oodie" },
    { prefix: "OC", product_type: "Oodie" },
    { prefix: "OD", product_type: "Oodie" },

    { prefix: "BDL", product_type: "Blanket" },
    { prefix: "BQL", product_type: "Blanket" },
    { prefix: "BKL", product_type: "Blanket" },
    { prefix: "BHL", product_type: "Blanket" },
    { prefix: "CB", product_type: "Blanket" },
    { prefix: "BD", product_type: "Blanket" },

    { prefix: "GFDL", product_type: "Garden Flag" },
    { prefix: "GFQL", product_type: "Garden Flag" },
    { prefix: "GF", product_type: "Garden Flag" },
    { prefix: "FL", product_type: "Garden Flag Banner" },

    { prefix: "MBDL", product_type: "Makeup Bag" },
    { prefix: "MB", product_type: "Makeup Bag" },

    { prefix: "GODL", product_type: "Glass Ornament" },
    { prefix: "GOQL", product_type: "Glass Ornament" },
    { prefix: "GOH", product_type: "Glass Ornament" },
    { prefix: "GOL", product_type: "Glass Ornament" },
    { prefix: "GO", product_type: "Glass Ornament" },

    { prefix: "POL", product_type: "Poster" },
    { prefix: "PLL", product_type: "Pillow" },
    { prefix: "PC", product_type: "Poncho" },
  ],
  matching_strategy: {
    priority: ["exception_map", "longest_prefix_match"],
    fallback: SKU_PREFIX_ERROR_PRODUCT_TYPE,
  },
};

// Sắp xếp prefix giảm dần theo độ dài để đảm bảo longest_prefix_match (vd: CBH trước CB, GFDL trước GF)
const SORTED_PREFIX_RULES = [...SKU_TO_PRODUCT_TYPE_RULE_SET.prefix_rules].sort(
  (a, b) => b.prefix.length - a.prefix.length
);

/**
 * Danh sách ký hiệu đầu SKU của một loại phôi, dùng chung cho logic và giao diện.
 */
export function getSkuPrefixesForProductType(productType: string): string[] {
  return SKU_TO_PRODUCT_TYPE_RULE_SET.prefix_rules
    .filter((rule) => {
      const normalizedType = SKU_TO_PRODUCT_TYPE_RULE_SET.taxonomy[rule.product_type] || rule.product_type;
      return normalizedType === productType;
    })
    .map((rule) => `${rule.prefix}*`);
}

/**
 * Phân loại loại Phôi tự động dựa trên mã SKU (theo matching_strategy)
 */
export function detectProductTypeFromSku(sku: string, campaignName?: string): string {
  let s = sku || "";
  if (SKU_TO_PRODUCT_TYPE_RULE_SET.normalization.trim_whitespace) s = s.trim();
  if (SKU_TO_PRODUCT_TYPE_RULE_SET.normalization.uppercase) s = s.toUpperCase();
  if (!s) return SKU_PREFIX_ERROR_PRODUCT_TYPE;

  // 1. Exception map
  if (SKU_TO_PRODUCT_TYPE_RULE_SET.exception_map[s]) {
    const raw = SKU_TO_PRODUCT_TYPE_RULE_SET.exception_map[s];
    return SKU_TO_PRODUCT_TYPE_RULE_SET.taxonomy[raw] || raw;
  }

  // 2. Longest prefix match
  for (const rule of SORTED_PREFIX_RULES) {
    if (s.startsWith(rule.prefix)) {
      const raw = rule.product_type;
      return SKU_TO_PRODUCT_TYPE_RULE_SET.taxonomy[raw] || raw;
    }
  }

  // Không đoán theo campaign: thiếu prefix phải được hiển thị rõ để sửa mapping.
  void campaignName;
  return SKU_PREFIX_ERROR_PRODUCT_TYPE;
}

/**
 * Nhận diện loại chiến dịch: SP01, SP03, SP04, SB01, SB05
 */
export function detectCampaignRuleType(campaignName?: string, adType?: string): "SB01" | "SB05" | "SP01" | "SP03" | "SP04" {
  const name = (campaignName || "").toUpperCase();
  if (/\bSP01\b/.test(name) || /SP01/.test(name)) return "SP01";
  if (/\bSP03\b/.test(name) || /SP03/.test(name)) return "SP03";
  if (/\bSP04\b/.test(name) || /SP04/.test(name)) return "SP04";
  if (/\bSB05\b/.test(name) || /SB05/.test(name) || /\bVIDEO\b/.test(name)) return "SB05";
  if (/\bSB01\b/.test(name) || /SB01/.test(name)) return "SB01";
  if (adType === "SB") return "SB01";
  return "SP03";
}
