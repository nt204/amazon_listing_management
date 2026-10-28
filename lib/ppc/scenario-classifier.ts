import type { PpcRecommendation } from "./types";
import type { CandidateBasis, ShadowDirection } from "./shadow-decision-engine";

export type PpcTargetScenario =
  | "ZERO_ORDER_BLEED"
  | "STARVED_TRAFFIC"
  | "HIGH_ACOS_TRIM"
  | "MARGINAL_ACOS"
  | "PROFITABLE_SCALE"
  | "OTHER";

export type RetrievalLevel = "LEVEL_A" | "LEVEL_B" | "LEVEL_C" | "INSUFFICIENT";
export type RetrievalSpecificity = "HIGH" | "MEDIUM" | "BROAD" | "NONE";

export interface TargetScenarioInfo {
  scenario: PpcTargetScenario;
  acosBeRatio: number | null;
  clicksAtAction: number;
  ordersAtAction: number;
  actualAcos: number | null;
  breakEvenAcos: number | null;
  matchedRuleId: string | null;
  triggerReason: string;
}

export interface HistoricalScenarioContext {
  scenarioAtAction: PpcTargetScenario;
  acosBeRatio: number | null;
  clicks: number;
  orders: number;
  cvr: number | null;
  avgCpc: number | null;
  productType: string;
  campaignType: string;
  matchType: string;
  direction: ShadowDirection;
  candidateId: string | null;
  outcomeLabel: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  rewardUsd: number | null;
  rawRow: unknown;
}

export interface HierarchicalRetrievalOutput {
  level: RetrievalLevel;
  specificity: RetrievalSpecificity;
  sampleCount: number;
  cases: HistoricalScenarioContext[];
}

/**
 * Derives the scenario at action time from recommendation or context snapshot.
 * Single source of truth: respects Rule Engine matched reason, BE ACoS ratio, and click threshold.
 */
// A zero-order target is "bleeding" only after this many clicks; below it the sample is too small
// to blame the target (STARVED_TRAFFIC). Same threshold the reviewer prompt uses.
export const ZERO_ORDER_BLEED_MIN_CLICKS = 7;

export function deriveTargetScenario(input: {
  clicks?: number | null;
  orders?: number | null;
  spend?: number | null;
  sales?: number | null;
  breakEvenAcos?: number | null;
  targetAcos?: number | null;
  reason?: string | null;
  ruleId?: string | null;
  recType?: string | null;
}): TargetScenarioInfo {
  const clicks = Math.max(0, Number(input.clicks || 0));
  const orders = Math.max(0, Number(input.orders || 0));
  const spend = Math.max(0, Number(input.spend || 0));
  const sales = Math.max(0, Number(input.sales || 0));
  // Không có BE ACoS thì không phân loại theo ACoS (không lấy số mặc định)
  const breakEvenAcos = Number(input.breakEvenAcos) > 0 ? Number(input.breakEvenAcos) : null;
  const targetAcos = Number(input.targetAcos) > 0
    ? Number(input.targetAcos)
    : breakEvenAcos !== null ? breakEvenAcos * 0.75 : null;
  const reason = String(input.reason || "");
  const ruleId = input.ruleId || null;

  // Extract rule ID from reason if present (e.g. "[SP03] SP03_BLEED_7_CLICKS: ...")
  const ruleIdMatch = reason.match(/\[([A-Z0-9]+)\]\s*([^:]+):/i);
  const detectedRuleId = ruleId || (ruleIdMatch ? ruleIdMatch[2].trim() : null);

  let scenario: PpcTargetScenario = "OTHER";
  let acosBeRatio: number | null = null;
  let actualAcos: number | null = null;

  if (sales > 0 && spend > 0) {
    actualAcos = (spend / sales) * 100;
    if (breakEvenAcos !== null) {
      acosBeRatio = Math.round((actualAcos / breakEvenAcos) * 100) / 100;
    }
  }

  // 1. Zero-order targets are classified by traffic, not by rule name: every no-order rule reason
  //    says "không có đơn", including low-traffic rules with 0 clicks.
  if (orders === 0) {
    scenario = clicks >= ZERO_ORDER_BLEED_MIN_CLICKS ? "ZERO_ORDER_BLEED" : "STARVED_TRAFFIC";
  } else if (detectedRuleId) {
    // 2. Converting targets: the Rule Engine's matched rule is the source of truth.
    if (/HIGH_ACOS|ABOVE_BE|OVER_BE/i.test(detectedRuleId)) {
      scenario = "HIGH_ACOS_TRIM";
    } else if (/MARGINAL|NEAR_BE/i.test(detectedRuleId)) {
      scenario = "MARGINAL_ACOS";
    } else if (/SCALE|PROFITABLE|LOW_ACOS/i.test(detectedRuleId)) {
      scenario = "PROFITABLE_SCALE";
    }
  }

  // 3. FALLBACK to metrics if Rule ID did not classify explicitly
  if (scenario === "OTHER") {
    if (actualAcos !== null && breakEvenAcos !== null && targetAcos !== null) {
      if (actualAcos > breakEvenAcos) {
        scenario = "HIGH_ACOS_TRIM";
      } else if (actualAcos > targetAcos) {
        scenario = "MARGINAL_ACOS";
      } else {
        scenario = "PROFITABLE_SCALE";
      }
    }
  }

  return {
    scenario,
    acosBeRatio,
    clicksAtAction: clicks,
    ordersAtAction: orders,
    actualAcos,
    breakEvenAcos,
    matchedRuleId: detectedRuleId,
    triggerReason: reason,
  };
}

/**
 * Calculates numeric Euclidean/Manhattan distance between target and historical case
 * within the same scenario bucket.
 */
export function calculateNumericStateDistance(
  target: TargetScenarioInfo,
  historical: HistoricalScenarioContext,
): number {
  let dist = 0;

  // 1. ACOS/BE ratio difference (weight: 3.0)
  if (target.acosBeRatio !== null && historical.acosBeRatio !== null) {
    dist += Math.abs(target.acosBeRatio - historical.acosBeRatio) * 3.0;
  }

  // 2. Click log-scale volume distance (weight: 1.0)
  const targetClickLog = Math.log10(Math.max(1, target.clicksAtAction));
  const histClickLog = Math.log10(Math.max(1, historical.clicks));
  dist += Math.abs(targetClickLog - histClickLog) * 1.0;

  // 3. Orders scale difference (weight: 0.5)
  dist += Math.min(2.0, Math.abs(target.ordersAtAction - historical.orders) * 0.2);

  return dist;
}

/**
 * Hierarchical Retrieval (LEVEL A -> LEVEL B -> LEVEL C)
 * LEVEL A: Same Product Type + Same Campaign Type + Same Match Type + Same Scenario + Same Direction
 * LEVEL B: Same Product Type + Same Campaign Type + Same Scenario + Same Direction (broadens Match Type)
 * LEVEL C: Same Campaign Type + Same Scenario + Same Direction (broadens Product Type)
 */
export function performHierarchicalRetrieval(params: {
  targetScenario: TargetScenarioInfo;
  campaignType: string;
  matchType: string;
  productType: string;
  direction: ShadowDirection;
  allHistoricalCases: HistoricalScenarioContext[];
  minSamplesPerLevel?: number;
}): HierarchicalRetrievalOutput {
  const minSamples = params.minSamplesPerLevel || 20;
  const { targetScenario, campaignType, matchType, productType, direction, allHistoricalCases } = params;

  // Filter 0: Must match Same Direction and Same Scenario
  const basePool = allHistoricalCases.filter((c) => {
    return c.direction === direction && c.scenarioAtAction === targetScenario.scenario;
  });

  // Level A: Same Campaign Family + Same Match Type + Same Product Type
  const levelACases = basePool.filter((c) => {
    const matchCampaign = c.campaignType.toUpperCase() === campaignType.toUpperCase();
    const matchMatch = c.matchType.toLowerCase() === matchType.toLowerCase();
    const matchProduct = !productType || c.productType.toLowerCase() === productType.toLowerCase();
    return matchCampaign && matchMatch && matchProduct;
  });

  if (levelACases.length >= minSamples) {
    const sorted = [...levelACases].sort(
      (a, b) => calculateNumericStateDistance(targetScenario, a) - calculateNumericStateDistance(targetScenario, b),
    );
    return {
      level: "LEVEL_A",
      specificity: "HIGH",
      sampleCount: sorted.length,
      cases: sorted,
    };
  }

  // Level B: Same Campaign Family + Same Product Type (mở rộng Match Type)
  const levelBCases = basePool.filter((c) => {
    const matchCampaign = c.campaignType.toUpperCase() === campaignType.toUpperCase();
    const matchProduct = !productType || c.productType.toLowerCase() === productType.toLowerCase();
    return matchCampaign && matchProduct;
  });

  if (levelBCases.length >= minSamples) {
    const sorted = [...levelBCases].sort(
      (a, b) => calculateNumericStateDistance(targetScenario, a) - calculateNumericStateDistance(targetScenario, b),
    );
    return {
      level: "LEVEL_B",
      specificity: "MEDIUM",
      sampleCount: sorted.length,
      cases: sorted,
    };
  }

  // Level C: Same Campaign Family (mở rộng Product Type)
  const levelCCases = basePool.filter((c) => {
    return c.campaignType.toUpperCase() === campaignType.toUpperCase();
  });

  if (levelCCases.length > 0) {
    const sorted = [...levelCCases].sort(
      (a, b) => calculateNumericStateDistance(targetScenario, a) - calculateNumericStateDistance(targetScenario, b),
    );
    return {
      level: "LEVEL_C",
      specificity: levelCCases.length >= minSamples ? "BROAD" : "NONE",
      sampleCount: sorted.length,
      cases: sorted,
    };
  }

  return {
    level: "INSUFFICIENT",
    specificity: "NONE",
    sampleCount: 0,
    cases: [],
  };
}
