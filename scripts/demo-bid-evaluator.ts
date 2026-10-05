import { evaluateBidDecision } from "../lib/ppc/bid-evaluator/evaluator";
import type { EvaluationInput } from "../lib/ppc/bid-evaluator/types";

// Standard Example (Ví dụ chuẩn - Mục 11 & Mục 12 trong Spec)
const standardExampleInput: EvaluationInput = {
  decision: {
    decision_id: "DEC-2026-001",
    target_id: "TGT-GLASS-ORNAMENT-01",
    applied_at: "2026-08-01",
    current_bid: 0.8,
    applied_bid: 0.73,
    pre_ads_contribution_margin_pct: 0.35, // 35%
    is_control: false,
    user_action: "APPLY_AI",
  },
  window: 30,
  evaluation_date: "2026-09-10", // Well past 30 days + 5 attribution buffer days
  evaluation_version: 1,
  baseline_metrics_summary: {
    ad_sales: 300,
    ad_spend: 75,
    clicks: 105,
    orders: 15,
    acos: 25.0,
    contribution: 30.0,
    days_with_data: 30,
    total_days: 30,
  },
  after_metrics_summary: {
    ad_sales: 340,
    ad_spend: 68,
    clicks: 100,
    orders: 17,
    acos: 20.0,
    contribution: 51.0,
    days_with_data: 30,
    total_days: 30,
  },
  // 10 matched controls with median shift of +$6
  matched_controls: [
    { actual_contribution_w: 42, expected_own_w: 38, shift_w: 4 },
    { actual_contribution_w: 45, expected_own_w: 40, shift_w: 5 },
    { actual_contribution_w: 50, expected_own_w: 45, shift_w: 5 },
    { actual_contribution_w: 52, expected_own_w: 46, shift_w: 6 },
    { actual_contribution_w: 48, expected_own_w: 42, shift_w: 6 },
    { actual_contribution_w: 60, expected_own_w: 54, shift_w: 6 },
    { actual_contribution_w: 55, expected_own_w: 48, shift_w: 7 },
    { actual_contribution_w: 58, expected_own_w: 50, shift_w: 8 },
    { actual_contribution_w: 62, expected_own_w: 53, shift_w: 9 },
    { actual_contribution_w: 70, expected_own_w: 60, shift_w: 10 },
  ],
};

const result = evaluateBidDecision(standardExampleInput);

console.log("=================================================");
console.log("AMAZON PPC BID EVALUATION RESULT (VÍ DỤ CHUẨN)");
console.log("=================================================");
console.log(JSON.stringify(result, null, 2));
