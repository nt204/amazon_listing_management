// Lên camp từ search term đã chọn (tách riêng khỏi Sale KW).
// File này dùng được cả client lẫn server: chỉ dựng cấu trúc campaign, không ghi file.
import { extractSkuFromText, isAsinProductTarget, normalizeSaleKwDate, sanitizeSaleKwUserName } from "./sku-extractor";

export type LaunchMatchType = "exact" | "phrase" | "broad";
export type LaunchRunType = "SP03" | "SP02" | "SP04" | "SD01";
export type LaunchBiddingStrategy = "Dynamic bids - down only" | "Dynamic bids - up and down" | "Fixed bid";

export const LAUNCH_MATCH_TYPES: Array<{ key: LaunchMatchType; label: string }> = [
  { key: "exact", label: "Exact" },
  { key: "phrase", label: "Phrase" },
  { key: "broad", label: "Broad" },
];

/** target: loại term dùng làm target; "none" = camp không cần target (Auto) */
export const LAUNCH_RUN_TYPES: Array<{
  value: LaunchRunType;
  label: string;
  nameLabel: string;
  adProduct: "SP" | "SD";
  target: "keyword" | "asin" | "none";
}> = [
  { value: "SP03", label: "SP03 Keyword", nameLabel: "SP03 KW", adProduct: "SP", target: "keyword" },
  { value: "SP02", label: "SP02 Product (ASIN)", nameLabel: "SP02 PAT", adProduct: "SP", target: "asin" },
  { value: "SP04", label: "SP04 Auto", nameLabel: "SP04 Auto", adProduct: "SP", target: "none" },
  { value: "SD01", label: "SD01 Display (ASIN)", nameLabel: "SD01", adProduct: "SD", target: "asin" },
];

export const LAUNCH_BIDDING_STRATEGIES: Array<{ value: LaunchBiddingStrategy; label: string }> = [
  { value: "Dynamic bids - down only", label: "Dynamic - down only" },
  { value: "Dynamic bids - up and down", label: "Dynamic - up and down" },
  { value: "Fixed bid", label: "Fixed bid" },
];

export interface LaunchTerm {
  term: string;
  sku: string;
  bid: number;
  clicks?: number;
  spend?: number;
}

export type LaunchFulfillment = "FBA" | "FBM";

/** Tùy chỉnh riêng cho 1 SKU; trường nào không có thì dùng cài đặt chung. */
export type LaunchSkuOverride = Partial<Pick<LaunchOptions, "matchTypes" | "dailyBudget" | "biddingStrategy" | "suffix" | "commonBid">>;

export interface LaunchOptions {
  runType: LaunchRunType;
  matchTypes: LaunchMatchType[];
  dailyBudget: number;
  biddingStrategy: LaunchBiddingStrategy;
  userName: string;
  dateStr: string;
  suffix: string;
  fulfillment?: LaunchFulfillment;
  skuOverrides?: Record<string, LaunchSkuOverride>;
  /** Bid chung: có thì dùng làm Ad Group Default Bid (bid từng target do client gửi) */
  commonBid?: number;
}

export interface LaunchAdGroup {
  name: string;
  defaultBid: number;
  skus: string[];
  keywords: Array<{ text: string; matchType: LaunchMatchType; bid: number }>;
  productTargets: Array<{ expression: string; bid: number }>;
}

export interface LaunchCampaign {
  name: string;
  sku: string;
  adProduct: "SP" | "SD";
  targetingType: "MANUAL" | "AUTO";
  dailyBudget: number;
  biddingStrategy: LaunchBiddingStrategy;
  adGroups: LaunchAdGroup[];
}

export interface LaunchPlan {
  campaigns: LaunchCampaign[];
}

const MATCH_LABEL: Record<LaunchMatchType, string> = { exact: "Exact", phrase: "Phrase", broad: "Broad" };

export function launchRunType(value: LaunchRunType) {
  return LAUNCH_RUN_TYPES.find((t) => t.value === value) || LAUNCH_RUN_TYPES[0];
}

// Target sản phẩm: ASIN, asin=, category=, asin-expanded= (từ tab Target)
function isProductTerm(term: string): boolean {
  return isAsinProductTarget(term) || /^asin-expanded=/i.test(term.trim());
}

// Target của camp Auto (close-match, substitutes...) không phải keyword hay ASIN
export function isAutoTargetExpression(term: string): boolean {
  return /^(close-match|loose-match|substitutes|complements|\*)$/i.test(term.trim());
}

/** Term có dùng làm target cho dạng chạy này không (Auto: term chỉ để lấy SKU) */
export function isTermUsableForRunType(term: string, runType: LaunchRunType): boolean {
  const target = launchRunType(runType).target;
  if (target === "none") return true;
  if (isAutoTargetExpression(term)) return false;
  return target === "asin" ? isProductTerm(term) : !isProductTerm(term);
}

export function productTargetExpression(term: string): string {
  const t = term.trim();
  const lower = t.toLowerCase();
  if (/^(asin|asin-expanded|category)=/.test(lower)) return t;
  return `asin="${t.toUpperCase().replace(/["']/g, "")}"`;
}

/** "{SKU} {dạng chạy} [{Match}] {FBA|FBM} {user} {YYYYMMDD} [{đuôi}]" */
export function buildLaunchCampaignName(params: {
  sku: string;
  runType: LaunchRunType;
  matchType?: LaunchMatchType;
  userName: string;
  dateStr: string;
  suffix?: string;
  fulfillment?: LaunchFulfillment;
}): string {
  const sku = (extractSkuFromText(params.sku) || params.sku || "SKU").trim().toUpperCase();
  const parts = [sku, launchRunType(params.runType).nameLabel];
  if (params.matchType) parts.push(MATCH_LABEL[params.matchType]);
  parts.push(params.fulfillment === "FBM" ? "FBM" : "FBA", sanitizeSaleKwUserName(params.userName), normalizeSaleKwDate(params.dateStr));
  const suffix = (params.suffix || "").trim();
  if (suffix) parts.push(suffix);
  return parts.join(" ");
}

// Giống Sale KW: CPC trung bình có trọng số của SKU (tổng spend / tổng click); chưa có click thì lấy trung bình bid
function adGroupDefaultBid(terms: LaunchTerm[]): number {
  if (terms.length === 0) return 1;
  const clicks = terms.reduce((s, t) => s + (t.clicks || 0), 0);
  const spend = terms.reduce((s, t) => s + (t.spend || 0), 0);
  const value = clicks > 0 && spend > 0 ? spend / clicks : terms.reduce((s, t) => s + t.bid, 0) / terms.length;
  return Math.max(0.1, Math.round(value * 100) / 100);
}

/**
 * Dựng campaign theo SKU và dạng chạy:
 * - SP03: mỗi match type 1 camp, target là keyword.
 * - SP02 / SD01: 1 camp, target là ASIN.
 * - SP04: 1 camp Auto, không có target.
 */
export function buildLaunchPlan(terms: LaunchTerm[], options: LaunchOptions): LaunchPlan {
  const runType = launchRunType(options.runType);
  const bySku = new Map<string, LaunchTerm[]>();
  for (const t of terms) {
    const term = t.term.trim();
    const sku = t.sku.trim().toUpperCase();
    if (!term || !sku || !isTermUsableForRunType(term, runType.value)) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku)!.push({ ...t, term, sku });
  }

  const campaigns: LaunchCampaign[] = [];
  for (const [sku, skuTerms] of bySku) {
    const opts = { ...options, ...options.skuOverrides?.[sku] };
    const nameBase = { runType: runType.value, userName: opts.userName, dateStr: opts.dateStr, suffix: opts.suffix, fulfillment: opts.fulfillment };
    const makeCampaign = (sku: string, name: string, adGroup: Omit<LaunchAdGroup, "name" | "skus">): LaunchCampaign => ({
      name,
      sku,
      adProduct: runType.adProduct,
      targetingType: runType.target === "none" ? "AUTO" : "MANUAL",
      dailyBudget: opts.dailyBudget > 0 ? opts.dailyBudget : 5,
      biddingStrategy: opts.biddingStrategy,
      adGroups: [{ name, skus: [sku], ...adGroup }],
    });
    const defaultBid = opts.commonBid && opts.commonBid > 0 ? opts.commonBid : adGroupDefaultBid(skuTerms);
    if (runType.target === "keyword") {
      for (const m of opts.matchTypes) {
        campaigns.push(makeCampaign(sku, buildLaunchCampaignName({ sku, matchType: m, ...nameBase }), {
          defaultBid,
          keywords: skuTerms.map((t) => ({ text: t.term, matchType: m, bid: t.bid })),
          productTargets: [],
        }));
      }
    } else {
      campaigns.push(makeCampaign(sku, buildLaunchCampaignName({ sku, ...nameBase }), {
        defaultBid,
        keywords: [],
        productTargets: runType.target === "asin"
          ? skuTerms.map((t) => ({ expression: productTargetExpression(t.term), bid: t.bid }))
          : [],
      }));
    }
  }

  return { campaigns };
}

export function countLaunchTargets(plan: LaunchPlan): number {
  return plan.campaigns.reduce(
    (sum, c) => sum + c.adGroups.reduce((s, g) => s + g.keywords.length + g.productTargets.length, 0),
    0,
  );
}
