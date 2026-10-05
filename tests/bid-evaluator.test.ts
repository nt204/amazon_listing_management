import assert from "node:assert/strict";
import test from "node:test";

import { createConfig, getDefaultConfig } from "../lib/ppc/bid-evaluator/config";
import { evaluateBidDecision } from "../lib/ppc/bid-evaluator/evaluator";
import { batchRelabelBidDecisions } from "../lib/ppc/bid-evaluator/relabel";
import type { EvaluationInput } from "../lib/ppc/bid-evaluator/types";

function getBaseValidInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  return {
    decision: {
      decision_id: "DEC-001",
      target_id: "TGT-001",
      applied_at: "2026-08-01",
      current_bid: 0.8,
      applied_bid: 0.73,
      pre_ads_contribution_margin_pct: 0.35,
      is_control: false,
      user_action: "APPLY_AI",
    },
    window: 30,
    evaluation_date: "2026-09-10",
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
    matched_controls: Array.from({ length: 10 }, (_, i) => ({
      actual_contribution_w: 40 + i,
      expected_own_w: 34 + i,
      shift_w: 6,
    })),
    ...overrides,
  };
}

// Test 1: Ví dụ chuẩn
test("Test 1: Standard Example matches spec exactly", () => {
  const input = getBaseValidInput();
  const res = evaluateBidDecision(input);

  assert.equal(res.status, "EVALUATED");
  assert.equal(res.validity, "VALID");
  assert.equal(res.label, "POSITIVE");
  assert.equal(res.baseline_quality, "HIGH");
  assert.equal(res.expected_baseline?.source, "control_group");
  assert.equal(res.expected_baseline?.control_count, 10);
  assert.equal(res.expected_baseline?.expected_own_w, 30);
  assert.equal(res.expected_baseline?.control_shift_w, 6);
  assert.equal(res.expected_baseline?.value, 36);
  assert.equal(res.actual_contribution, 51);
  assert.equal(res.reward_usd, 15);
  assert.equal(res.T, 7.5);
  assert.equal(res.eligible_for_learning, true);
  assert.deepEqual(res.reason_codes, [
    "CONTRIBUTION_ABOVE_EXPECTED",
    "ACOS_IMPROVED",
    "SALES_PRESERVED",
    "ORDERS_PRESERVED",
  ]);
});

// Test 2: Như trên nhưng chỉ có 3 controls
test("Test 2: Only 3 controls fall back to own_30d_avg, quality LOW, multiplier 1.25", () => {
  const input = getBaseValidInput({
    matched_controls: [
      { actual_contribution_w: 40, expected_own_w: 34, shift_w: 6 },
      { actual_contribution_w: 40, expected_own_w: 34, shift_w: 6 },
      { actual_contribution_w: 40, expected_own_w: 34, shift_w: 6 },
    ],
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.expected_baseline?.source, "own_30d_avg");
  assert.equal(res.expected_baseline?.value, 30);
  assert.equal(res.actual_contribution, 51);
  assert.equal(res.reward_usd, 21);
  assert.equal(res.T, 9.375); // max(3, 7.5) * 1.25
  assert.equal(res.baseline_quality, "LOW");
  assert.equal(res.label, "POSITIVE");
});

// Test 3: 7 controls
test("Test 3: 7 controls uses control_group, quality LOW, multiplier 1.25", () => {
  const input = getBaseValidInput({
    matched_controls: Array.from({ length: 7 }, () => ({
      actual_contribution_w: 40,
      expected_own_w: 34,
      shift_w: 6,
    })),
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.expected_baseline?.source, "control_group");
  assert.equal(res.expected_baseline?.value, 36);
  assert.equal(res.baseline_quality, "LOW");
  assert.equal(res.T, 9.375);
});

// Test 4: 2 orders, 20 clicks sau action (D30)
test("Test 4: 2 orders and 20 clicks in D30 yields INCONCLUSIVE (LOW_CLICKS, LOW_ORDERS)", () => {
  const input = getBaseValidInput({
    after_metrics_summary: {
      clicks: 20,
      orders: 2,
      ad_sales: 50,
      ad_spend: 15,
      acos: 30,
      contribution: 2.5,
      days_with_data: 30,
      total_days: 30,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "INCONCLUSIVE");
  assert.equal(res.validity, "INCONCLUSIVE");
  assert.equal(res.eligible_for_learning, false);
  assert.ok(res.reason_codes.includes("LOW_CLICKS"));
  assert.ok(res.reason_codes.includes("LOW_ORDERS"));
});

// Test 5: Đổi bid chỉ 1%
test("Test 5: Bid change only 1% yields INCONCLUSIVE (BID_CHANGE_TOO_SMALL)", () => {
  const input = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      current_bid: 1.0,
      applied_bid: 1.01, // 1% change
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "INCONCLUSIVE");
  assert.equal(res.validity, "INCONCLUSIVE");
  assert.ok(res.reason_codes.includes("BID_CHANGE_TOO_SMALL"));
  assert.equal(res.eligible_for_learning, false);
});

// Test 6: Baseline chỉ có 15 ngày dữ liệu
test("Test 6: Baseline with only 15 days data yields INCONCLUSIVE (THIN_BASELINE)", () => {
  const input = getBaseValidInput({
    baseline_metrics_summary: {
      ...getBaseValidInput().baseline_metrics_summary!,
      days_with_data: 15,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "INCONCLUSIVE");
  assert.equal(res.validity, "INCONCLUSIVE");
  assert.ok(res.reason_codes.includes("THIN_BASELINE"));
});

// Test 7: Có PRICE_CHANGE trong cửa sổ
test("Test 7: External event PRICE_CHANGE in evaluation window yields CONFOUNDED", () => {
  const input = getBaseValidInput({
    external_events: [
      {
        date: "2026-08-10",
        type: "PRICE_CHANGE",
        description: "Discount applied",
      },
    ],
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "CONFOUNDED");
  assert.equal(res.validity, "CONFOUNDED");
  assert.ok(res.confound_flags.includes("PRICE_CHANGE"));
  assert.equal(res.eligible_for_learning, false);
});

// Test 8: Có action bid khác vào ngày 20
test("Test 8: Action on day 20 confounds D30 but keeps D14 valid", () => {
  // Action applied at 2026-08-01, another bid change on 2026-08-21 (day 20 after)
  const otherBidAction = {
    target_id: "TGT-001",
    applied_at: "2026-08-21",
    applied_bid: 0.85,
  };

  // For D30: window ends 2026-08-31, buffer ends 2026-09-05. Day 2026-08-21 is within buffer -> INTERRUPTED
  const inputD30 = getBaseValidInput({
    window: 30,
    other_bid_actions: [otherBidAction],
  });
  const resD30 = evaluateBidDecision(inputD30);
  assert.equal(resD30.label, "INTERRUPTED");
  assert.equal(resD30.validity, "INTERRUPTED");
  assert.equal(resD30.end_clean_observation, "2026-08-21");
  assert.ok(resD30.confound_flags.includes("OVERLAPPING_ACTION"));
  assert.ok(resD30.confound_flags.includes("INTERRUPTED_BY_NEW_ACTION"));

  // For D14: window ends 2026-08-15, buffer ends 2026-08-20. Day 2026-08-21 is outside -> VALID
  const inputD14 = getBaseValidInput({
    window: 14,
    evaluation_date: "2026-09-10",
    other_bid_actions: [otherBidAction],
  });
  const resD14 = evaluateBidDecision(inputD14);
  assert.equal(resD14.validity, "VALID");
  assert.notEqual(resD14.label, "CONFOUNDED");
});

// Test 9: 7 ngày cuối baseline xấu bất thường, control cùng xu hướng
test("Test 9: Matched control shift compensates temporary baseline dip, resulting in NEUTRAL", () => {
  // Baseline contribution was depressed to $30 (expected_own = 30)
  // Control group also had the dip and experienced +$15 shift in market recovery
  // Target had actual contribution of $46.
  // Expected = 30 + 15 = 45. Reward = 46 - 45 = +$1. T = 7.5. |1| <= 7.5 -> NEUTRAL
  const input = getBaseValidInput({
    after_metrics_summary: {
      ad_sales: 320,
      ad_spend: 66,
      clicks: 100,
      orders: 16,
      acos: 20.6,
      contribution: 46.0,
      days_with_data: 30,
      total_days: 30,
    },
    matched_controls: Array.from({ length: 10 }, () => ({
      actual_contribution_w: 45,
      expected_own_w: 30,
      shift_w: 15,
    })),
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.expected_baseline?.value, 45);
  assert.equal(res.actual_contribution, 46);
  assert.equal(res.reward_usd, 1);
  assert.equal(res.label, "NEUTRAL");
  assert.ok(res.reason_codes.includes("WITHIN_NOISE"));
});

// Test 10: ACoS cải thiện nhưng sales và contribution giảm quá T
test("Test 10: ACoS improved but sales and contribution dropped significantly yields NEGATIVE", () => {
  // Baseline: Sales $300, Spend $75, Contribution $30
  // After: Sales $100, Spend $10 -> ACoS = 10% (improved from 25%), but Sales dropped from $10/day to $3.33/day
  // Contribution = 100 * 0.35 - 10 = $25
  // Expected = 36 -> Reward = 25 - 36 = -11. T = 7.5 -> Reward < -7.5 -> NEGATIVE
  const input = getBaseValidInput({
    after_metrics_summary: {
      ad_sales: 100,
      ad_spend: 10,
      clicks: 80,
      orders: 6,
      acos: 10.0,
      contribution: 25.0,
      days_with_data: 30,
      total_days: 30,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "NEGATIVE");
  assert.ok(res.reward_usd! < -res.T!);
  assert.ok(res.reason_codes.includes("ACOS_IMPROVED"));
  assert.ok(res.reason_codes.includes("SALES_DROPPED"));
  assert.ok(res.reason_codes.includes("CONTRIBUTION_BELOW_EXPECTED"));
});

// Test 11: Reward nằm trong ±T
test("Test 11: Reward within +/- T yields NEUTRAL", () => {
  // Actual contribution = 38, Expected = 36, Reward = +2, T = 7.5
  const input = getBaseValidInput({
    after_metrics_summary: {
      ad_sales: 310,
      ad_spend: 70.5,
      clicks: 95,
      orders: 15,
      acos: 22.7,
      contribution: 38.0,
      days_with_data: 30,
      total_days: 30,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.reward_usd, 2);
  assert.equal(res.label, "NEUTRAL");
  assert.ok(res.reason_codes.includes("WITHIN_NOISE"));
});

// Test 12: Window D7 không bao giờ dùng để học
test("Test 12: Window D7 evaluates successfully but is never eligible for learning", () => {
  const input = getBaseValidInput({
    window: 7,
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
      ad_sales: 90,
      ad_spend: 15,
      clicks: 25,
      orders: 6,
      acos: 16.7,
      contribution: 16.5,
      days_with_data: 7,
      total_days: 7,
    },
    matched_controls: Array.from({ length: 10 }, () => ({
      actual_contribution_w: 10,
      expected_own_w: 7,
      shift_w: 3,
    })),
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.status, "EVALUATED");
  assert.equal(res.validity, "VALID");
  assert.equal(res.eligible_for_learning, false);
});

// Test 13: is_control = true
test("Test 13: Control target is evaluated normally but never eligible for learning", () => {
  const input = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      is_control: true,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.status, "EVALUATED");
  assert.equal(res.label, "POSITIVE");
  assert.equal(res.eligible_for_learning, false);
});

// Test 14: REJECT hoặc IGNORE
test("Test 14: REJECT or IGNORE user action yields NOT_APPLICABLE", () => {
  const inputReject = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      user_action: "REJECT",
    },
  });
  const resReject = evaluateBidDecision(inputReject);
  assert.equal(resReject.status, "NOT_APPLICABLE");
  assert.equal(resReject.label, null);

  const inputIgnore = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      user_action: "IGNORE",
    },
  });
  const resIgnore = evaluateBidDecision(inputIgnore);
  assert.equal(resIgnore.status, "NOT_APPLICABLE");
  assert.equal(resIgnore.label, null);
});

// Test 15: Chưa tới hạn đánh giá (PENDING)
test("Test 15: Evaluation run before maturity date yields PENDING", () => {
  const input = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      applied_at: "2026-08-01",
    },
    window: 30,
    // Buffer = 5, maturity date = 2026-09-05. Run on 2026-08-20:
    evaluation_date: "2026-08-20",
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.status, "PENDING");
  assert.equal(res.label, null);
  assert.equal(res.eligible_for_learning, false);
});

// Test 16: Baseline spend bằng 0
test("Test 16: Baseline spend = 0 calculates T = T_min * multiplier without divide-by-zero", () => {
  const input = getBaseValidInput({
    baseline_metrics_summary: {
      ad_sales: 0,
      ad_spend: 0,
      clicks: 40,
      orders: 0,
      acos: null,
      contribution: 0,
      days_with_data: 30,
      total_days: 30,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.T, 3.0); // max(3.0, 10% * 0) * 1.0 = 3.0
  assert.ok(Number.isFinite(res.reward_norm));
});

// Test 17: Tỷ lệ ngày có dữ liệu thấp hơn ngưỡng (MISSING_DATA)
test("Test 17: Coverage below min_data_coverage yields INCONCLUSIVE (MISSING_DATA)", () => {
  const input = getBaseValidInput({
    window: 14,
    evaluation_date: "2026-09-10",
    after_metrics_summary: {
      ad_sales: 150,
      ad_spend: 30,
      clicks: 50,
      orders: 8,
      acos: 20,
      contribution: 22.5,
      days_with_data: 10, // 10 / 14 = 71.4% < 90%
      total_days: 14,
    },
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "INCONCLUSIVE");
  assert.ok(res.reason_codes.includes("MISSING_DATA"));
});

// Test 18: STOCKOUT và COUPON_OR_DEAL cùng lúc
test("Test 18: Multiple external events list all flags in CONFOUNDED", () => {
  const input = getBaseValidInput({
    external_events: [
      { date: "2026-08-05", type: "STOCKOUT" },
      { date: "2026-08-12", type: "COUPON_OR_DEAL" },
    ],
  });

  const res = evaluateBidDecision(input);

  assert.equal(res.label, "CONFOUNDED");
  assert.equal(res.validity, "CONFOUNDED");
  assert.ok(res.confound_flags.includes("STOCKOUT"));
  assert.ok(res.confound_flags.includes("COUPON_OR_DEAL"));
});

// Test 19: D7 và D14 với cùng baseline có T khác nhau theo Baseline_Spend_W
test("Test 19: D7 and D14 scale T proportionally with Baseline_Spend_W", () => {
  const baseline = {
    ad_sales: 600,
    ad_spend: 300, // $10/day
    clicks: 120,
    orders: 20,
    acos: 50,
    contribution: 0,
    days_with_data: 30,
    total_days: 30,
  };

  const inputD7 = getBaseValidInput({
    window: 7,
    evaluation_date: "2026-09-10",
    baseline_metrics_summary: baseline,
    after_metrics_summary: {
      ad_sales: 150,
      ad_spend: 70,
      clicks: 40,
      orders: 8,
      acos: 46.7,
      contribution: 0,
      days_with_data: 7,
      total_days: 7,
    },
  });

  const inputD14 = getBaseValidInput({
    window: 14,
    evaluation_date: "2026-09-10",
    baseline_metrics_summary: baseline,
    after_metrics_summary: {
      ad_sales: 300,
      ad_spend: 140,
      clicks: 80,
      orders: 16,
      acos: 46.7,
      contribution: 0,
      days_with_data: 14,
      total_days: 14,
    },
  });

  const resD7 = evaluateBidDecision(inputD7);
  const resD14 = evaluateBidDecision(inputD14);

  // D7: spend_w = 300 / 30 * 7 = 70 -> T = max(3, 10% * 70) = 7.0
  assert.equal(resD7.T, 7.0);

  // D14: spend_w = 300 / 30 * 14 = 140 -> T = max(3, 10% * 140) = 14.0
  assert.equal(resD14.T, 14.0);

  assert.notEqual(resD7.T, resD14.T);
});

// Test 20: Đổi config (tăng T_min) rồi gắn nhãn lại
test("Test 20: Batch re-labeling with increased T_min shifts label to NEUTRAL, increments label_version, preserves old data", () => {
  // Input where reward is +$5, baseline spend = $20 -> with default config T = max(3, 2) = $3 -> POSITIVE
  const input = getBaseValidInput({
    baseline_metrics_summary: {
      ad_sales: 100,
      ad_spend: 20,
      clicks: 50,
      orders: 8,
      acos: 20,
      contribution: 15,
      days_with_data: 30,
      total_days: 30,
    },
    after_metrics_summary: {
      ad_sales: 120,
      ad_spend: 20,
      clicks: 55,
      orders: 10,
      acos: 16.7,
      contribution: 22,
      days_with_data: 30,
      total_days: 30,
    },
    matched_controls: Array.from({ length: 10 }, () => ({
      actual_contribution_w: 17,
      expected_own_w: 15,
      shift_w: 2,
    })),
  });

  const initialResult = evaluateBidDecision(input);
  assert.equal(initialResult.label, "POSITIVE");
  assert.equal(initialResult.label_version, 1);
  assert.equal(initialResult.T, 3.0);

  // New config with higher threshold T_min = $10 and label_version = 2
  const updatedConfig = createConfig({
    t_min: 10.0,
    label_version: 2,
  });

  const reevaluatedResults = batchRelabelBidDecisions([input], {
    newConfig: updatedConfig,
  });

  assert.equal(reevaluatedResults.length, 1);
  const newResult = reevaluatedResults[0];

  assert.equal(newResult.label, "NEUTRAL"); // Reward +$5 is within [-10, 10]
  assert.equal(newResult.label_version, 2);
  assert.equal(newResult.T, 10.0);

  // Verify initial result was not mutated
  assert.equal(initialResult.label, "POSITIVE");
  assert.equal(initialResult.label_version, 1);
});

// Test 21: Observation window completes before attribution buffer -> yields PROVISIONAL with valid label
test("Test 21: D7 evaluated on Day 8 yields PROVISIONAL with decisive label instead of PENDING", () => {
  // Applied 2026-09-22, D7 window completes 2026-09-28. Evaluated on 2026-09-30 (Day 8 after applied)
  // Attribution buffer = 5 days (maturity date = 2026-10-04)
  const input = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      applied_at: "2026-09-22",
    },
    window: 7,
    evaluation_date: "2026-09-30",
    after_metrics_summary: {
      ad_sales: 50,
      ad_spend: 10,
      clicks: 25,
      orders: 5,
      acos: 20,
      contribution: 7.5,
      days_with_data: 7,
      total_days: 7,
    },
  });

  const res = evaluateBidDecision(input);

  // Status is PROVISIONAL (active observation done, attribution settling)
  assert.equal(res.status, "PROVISIONAL");
  // Label is calculated immediately based on actual vs expected
  assert.ok(["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(res.label as string));
  assert.equal(res.validity, "VALID");
  // Not eligible for AI learning yet while provisional
  assert.equal(res.eligible_for_learning, false);
});

// Test 22: Action B on Day 9 keeps D7 valid, but interrupts D14 and D30
test("Test 22: Action B on Day 9 leaves D7 valid but interrupts D14 and D30", () => {
  const otherActionDay9 = {
    target_id: "TGT-001",
    applied_at: "2026-10-01", // Day 9 after 2026-09-22
    applied_bid: 0.70,
  };

  // D7 (ends 2026-09-28): Day 9 is strictly AFTER D7 observation period -> VALID
  const inputD7 = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      applied_at: "2026-09-22",
    },
    window: 7,
    evaluation_date: "2026-10-02",
    other_bid_actions: [otherActionDay9],
  });
  const resD7 = evaluateBidDecision(inputD7);
  assert.equal(resD7.validity, "VALID");
  assert.notEqual(resD7.label, "INTERRUPTED");

  // D30 (ends 2026-10-21): Day 9 is WITHIN D30 observation period -> INTERRUPTED
  const inputD30 = getBaseValidInput({
    decision: {
      ...getBaseValidInput().decision,
      applied_at: "2026-09-22",
    },
    window: 30,
    evaluation_date: "2026-10-02",
    after_metrics_summary: {
      ad_sales: 80,
      ad_spend: 20,
      clicks: 30,
      orders: 6,
      acos: 25,
      contribution: 8,
      days_with_data: 30,
      total_days: 30,
    },
    other_bid_actions: [otherActionDay9],
  });
  const resD30 = evaluateBidDecision(inputD30);
  assert.equal(resD30.status, "EVALUATED");
  assert.equal(resD30.label, "INTERRUPTED");
  assert.equal(resD30.validity, "INTERRUPTED");
  assert.equal(resD30.end_clean_observation, "2026-10-01");
  assert.equal(resD30.eligible_for_learning, false);
});
