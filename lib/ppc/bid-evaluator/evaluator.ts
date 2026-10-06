import { getDefaultConfig } from "./config";
import {
  addDays,
  aggregateDailyMetrics,
  calculateContribution,
  calculateMedian,
  diffDays,
  normalizeMargin,
  parseDateOnly,
} from "./metrics";
import type {
  AggregatedMetrics,
  ConfoundFlag,
  EvaluationInput,
  EvaluationLabel,
  EvaluationResult,
  EvaluationStatus,
  ExpectedBaseline,
  ReasonCode,
  ValidityStatus,
} from "./types";

/**
 * Pure evaluation function for Amazon PPC bid changes.
 * Evaluates D7 / D14 / D30 performance against matched control and baseline.
 * Deterministic and free of side effects.
 */
export function evaluateBidDecision(input: EvaluationInput): EvaluationResult {
  const config = input.config ? { ...input.config } : getDefaultConfig();
  const decision = input.decision;
  const window = Number(input.window);
  const evaluationVersion = input.evaluation_version ?? 1;
  const labelVersion = config.label_version;
  const evaluatorVersion = config.evaluator_version;
  const evaluatedAt = new Date().toISOString();

  const appliedDate = parseDateOnly(decision.applied_at);
  const evaluationDate = parseDateOnly(input.evaluation_date);
  const margin = normalizeMargin(decision.pre_ads_contribution_margin_pct);

  // Compute bid delta percent
  const appliedDeltaPct =
    decision.current_bid !== 0
      ? ((decision.applied_bid - decision.current_bid) / decision.current_bid) * 100
      : 0;

  // 1. NOT_APPLICABLE check: user_action is REJECT or IGNORE
  if (decision.user_action === "REJECT" || decision.user_action === "IGNORE") {
    return {
      decision_id: decision.decision_id,
      window,
      evaluation_version: evaluationVersion,
      label_version: labelVersion,
      evaluator_version: evaluatorVersion,
      status: "NOT_APPLICABLE",
      label: null,
      validity: null,
      confound_flags: [],
      reason_codes: [],
      expected_baseline: null,
      baseline_quality: null,
      actual_contribution: null,
      reward_usd: null,
      reward_norm: null,
      T: null,
      baseline_metrics: null,
      after_metrics: null,
      applied_delta_pct: appliedDeltaPct,
      eligible_for_learning: false,
      evaluated_at: evaluatedAt,
    };
  }

  // Prepare Baseline & After Metrics
  let baselineMetrics: AggregatedMetrics;
  if (input.baseline_metrics_summary) {
    baselineMetrics = { ...input.baseline_metrics_summary };
    if (baselineMetrics.contribution === undefined) {
      baselineMetrics.contribution = calculateContribution(
        baselineMetrics.ad_sales,
        baselineMetrics.ad_spend,
        margin
      );
    }
  } else if (input.daily_metrics && input.daily_metrics.length > 0) {
    const baselineStartDate = addDays(appliedDate, -30);
    const baselineEndDate = addDays(appliedDate, -1);
    const baselineDaily = input.daily_metrics.filter((m) => {
      const d = parseDateOnly(m.date);
      return d >= baselineStartDate && d <= baselineEndDate;
    });
    baselineMetrics = aggregateDailyMetrics(baselineDaily, margin, 30);
  } else {
    baselineMetrics = {
      clicks: 0,
      orders: 0,
      ad_sales: 0,
      ad_spend: 0,
      acos: null,
      contribution: 0,
      days_with_data: 0,
      total_days: 30,
    };
  }

  let afterMetrics: AggregatedMetrics | null = null;
  if (input.after_metrics_summary) {
    afterMetrics = { ...input.after_metrics_summary };
    if (afterMetrics.contribution === undefined) {
      afterMetrics.contribution = calculateContribution(
        afterMetrics.ad_sales,
        afterMetrics.ad_spend,
        margin
      );
    }
  } else if (input.daily_metrics && input.daily_metrics.length > 0) {
    const afterStartDate = appliedDate;
    const afterEndDate = addDays(appliedDate, window - 1);
    const afterDaily = input.daily_metrics.filter((m) => {
      const d = parseDateOnly(m.date);
      return d >= afterStartDate && d <= afterEndDate;
    });
    if (afterDaily.length > 0) {
      afterMetrics = aggregateDailyMetrics(afterDaily, margin, window);
    }
  }

  // Calculate Expected Baseline & Tolerance Threshold T
  const baselineContribution = Number(baselineMetrics.contribution || 0);
  const baselinePerDay = baselineContribution / 30;
  const expectedOwnW = baselinePerDay * window;

  const matchedControls = input.matched_controls || [];
  const controlCount = matchedControls.length;

  let expectedSource: "control_group" | "own_30d_avg";
  let baselineQuality: "HIGH" | "LOW";
  let qualityMultiplier: number;
  let controlShiftW = 0;

  if (controlCount >= config.n_control_high) {
    expectedSource = "control_group";
    baselineQuality = "HIGH";
    qualityMultiplier = 1.0;
    const shifts = matchedControls.map((c) =>
      c.shift_w !== undefined ? c.shift_w : c.actual_contribution_w - c.expected_own_w
    );
    controlShiftW = calculateMedian(shifts);
  } else if (controlCount >= config.n_control_min) {
    expectedSource = "control_group";
    baselineQuality = "LOW";
    qualityMultiplier = config.quality_multiplier_low;
    const shifts = matchedControls.map((c) =>
      c.shift_w !== undefined ? c.shift_w : c.actual_contribution_w - c.expected_own_w
    );
    controlShiftW = calculateMedian(shifts);
  } else {
    expectedSource = "own_30d_avg";
    baselineQuality = "LOW";
    qualityMultiplier = config.quality_multiplier_low;
    controlShiftW = 0;
  }

  const expected = expectedOwnW + controlShiftW;
  const expectedBaselineObj: ExpectedBaseline = {
    value: expected,
    expected_own_w: expectedOwnW,
    source: expectedSource,
    control_count: controlCount,
    control_shift_w: controlShiftW,
  };

  const hasAfterData = afterMetrics !== null;
  const actual = afterMetrics && afterMetrics.contribution !== undefined ? Number(afterMetrics.contribution) : null;
  const rewardUsd = actual !== null ? actual - expected : null;

  const baselineSpend = Number(baselineMetrics.ad_spend || 0);
  const baselineSpendW = (baselineSpend / 30) * window;
  const rewardNorm = rewardUsd !== null ? rewardUsd / Math.max(baselineSpendW, 10) : null;

  // Tolerance Threshold T formula:
  // T = max(T_min, t_spend_ratio * Spend_W, t_expected_ratio * |Expected|) * qualityMultiplier
  const tSpendRatio = config.t_spend_ratio ?? 0.10;
  const tExpectedRatio = config.t_expected_ratio ?? 0.10;
  const spendPart = tSpendRatio * baselineSpendW;
  const expectedPart = tExpectedRatio * Math.abs(expected);
  const T = Math.max(config.t_min, spendPart, expectedPart) * qualityMultiplier;

  // 2. Immediate Interruption check: If another action on the same target interrupted this window
  const windowEndDate = addDays(appliedDate, window - 1);
  const maturityDate = addDays(
    appliedDate,
    window + config.attribution_buffer_days
  );

  let isInterruptedByAction = false;
  let endCleanObservation: string | null = null;
  let interruptingActionId: string | null = null;

  if (input.other_bid_actions && input.other_bid_actions.length > 0) {
    for (const action of input.other_bid_actions) {
      if (action.target_id === decision.target_id) {
        const actionDate = parseDateOnly(action.applied_at);
        // An action B interrupts this window if action B occurred during its observation period
        if (actionDate > appliedDate && actionDate <= windowEndDate) {
          isInterruptedByAction = true;
          endCleanObservation = actionDate;
          interruptingActionId = action.action_id || null;
          break;
        }
      }
    }
  }

  if (isInterruptedByAction) {
    return {
      decision_id: decision.decision_id,
      window,
      evaluation_version: evaluationVersion,
      label_version: labelVersion,
      evaluator_version: evaluatorVersion,
      status: "EVALUATED",
      label: "INTERRUPTED",
      validity: "INTERRUPTED",
      confound_flags: ["INTERRUPTED_BY_NEW_ACTION", "OVERLAPPING_ACTION"],
      reason_codes: ["INTERRUPTED_BY_NEW_ACTION"],
      expected_baseline: expectedBaselineObj,
      baseline_quality: baselineQuality,
      actual_contribution: actual,
      reward_usd: rewardUsd,
      reward_norm: rewardNorm,
      T,
      baseline_metrics: baselineMetrics,
      after_metrics: afterMetrics,
      applied_delta_pct: appliedDeltaPct,
      eligible_for_learning: false,
      end_clean_observation: endCleanObservation,
      interrupted_by_action_id: interruptingActionId,
      superseded_by_action_id: interruptingActionId,
      evaluated_at: evaluatedAt,
    };
  }

  // 3. Window observation completion & Attribution maturity check
  // If the observation window has not ended yet, or after metrics are not available:
  if (diffDays(evaluationDate, windowEndDate) > 0 || !hasAfterData) {
    return {
      decision_id: decision.decision_id,
      window,
      evaluation_version: evaluationVersion,
      label_version: labelVersion,
      evaluator_version: evaluatorVersion,
      status: "PENDING",
      label: null,
      validity: null,
      confound_flags: [],
      reason_codes: [],
      expected_baseline: expectedBaselineObj,
      baseline_quality: baselineQuality,
      actual_contribution: actual,
      reward_usd: rewardUsd,
      reward_norm: rewardNorm,
      T,
      baseline_metrics: baselineMetrics,
      after_metrics: afterMetrics,
      applied_delta_pct: appliedDeltaPct,
      eligible_for_learning: false,
      evaluated_at: evaluatedAt,
    };
  }

  // Once observation window has completed, check attribution maturity:
  const isMature = diffDays(evaluationDate, maturityDate) <= 0;
  const evaluationStatus: EvaluationStatus = isMature ? "EVALUATED" : "PROVISIONAL";

  // 3. INCONCLUSIVE check (data sufficiency or signal too small)
  const inconclusiveReasons: ReasonCode[] = [];

  // 3.1 Bid delta too small
  if (Math.abs(appliedDeltaPct) < config.min_effective_bid_delta) {
    inconclusiveReasons.push("BID_CHANGE_TOO_SMALL");
  }

  if (!afterMetrics) {
    inconclusiveReasons.push("MISSING_DATA");
  } else {
    // 3.2 Low clicks AND low orders in after period
    const requiredClicks =
      config.min_clicks[window] ??
      (window === 3 ? 8 : window === 7 ? 15 : window === 14 ? 30 : 60);

    if (
      afterMetrics.clicks < requiredClicks &&
      afterMetrics.orders < config.min_orders_alt
    ) {
      inconclusiveReasons.push("LOW_CLICKS");
      inconclusiveReasons.push("LOW_ORDERS");
    }

    // 3.5 Missing data coverage in after window
    const afterDaysCount = afterMetrics.days_with_data ?? window;
    const afterCoverage = afterDaysCount / window;
    if (afterCoverage < config.min_data_coverage) {
      inconclusiveReasons.push("MISSING_DATA");
    }
  }

  // 3.3 Thin baseline clicks
  if (baselineMetrics.clicks < config.min_baseline_clicks) {
    inconclusiveReasons.push("THIN_BASELINE");
  }

  // 3.4 Thin baseline days
  const baselineDaysCount = baselineMetrics.days_with_data ?? 30;
  if (baselineDaysCount < config.min_baseline_days) {
    if (!inconclusiveReasons.includes("THIN_BASELINE")) {
      inconclusiveReasons.push("THIN_BASELINE");
    }
  }

  if (inconclusiveReasons.length > 0) {
    return {
      decision_id: decision.decision_id,
      window,
      evaluation_version: evaluationVersion,
      label_version: labelVersion,
      evaluator_version: evaluatorVersion,
      status: "EVALUATED",
      label: "INCONCLUSIVE",
      validity: "INCONCLUSIVE",
      confound_flags: [],
      reason_codes: inconclusiveReasons,
      expected_baseline: expectedBaselineObj,
      baseline_quality: baselineQuality,
      actual_contribution: actual,
      reward_usd: rewardUsd,
      reward_norm: rewardNorm,
      T,
      baseline_metrics: baselineMetrics,
      after_metrics: afterMetrics,
      applied_delta_pct: appliedDeltaPct,
      eligible_for_learning: false,
      evaluated_at: evaluatedAt,
    };
  }

  // 4. CONFOUNDED check (External events in evaluation window [appliedDate, windowEndDate])
  const confoundFlags: ConfoundFlag[] = [];

  if (input.external_events && input.external_events.length > 0) {
    for (const event of input.external_events) {
      const eventDate = parseDateOnly(event.date);
      if (eventDate >= appliedDate && eventDate <= windowEndDate) {
        if (!confoundFlags.includes(event.type)) {
          confoundFlags.push(event.type);
        }
      }
    }
  }

  if (confoundFlags.length > 0) {
    return {
      decision_id: decision.decision_id,
      window,
      evaluation_version: evaluationVersion,
      label_version: labelVersion,
      evaluator_version: evaluatorVersion,
      status: "EVALUATED",
      label: "CONFOUNDED",
      validity: "CONFOUNDED",
      confound_flags: confoundFlags,
      reason_codes: [...confoundFlags],
      expected_baseline: expectedBaselineObj,
      baseline_quality: baselineQuality,
      actual_contribution: actual,
      reward_usd: rewardUsd,
      reward_norm: rewardNorm,
      T,
      baseline_metrics: baselineMetrics,
      after_metrics: afterMetrics,
      applied_delta_pct: appliedDeltaPct,
      eligible_for_learning: false,
      evaluated_at: evaluatedAt,
    };
  }

  // 5. VALID evaluation
  const validAfterMetrics = afterMetrics!;
  const validRewardUsd = rewardUsd!;

  // Determine Label
  let label: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  if (validRewardUsd > T) {
    label = "POSITIVE";
  } else if (validRewardUsd < -T) {
    label = "NEGATIVE";
  } else {
    label = "NEUTRAL";
  }

  // Generate Reason Codes
  const reasonCodes: ReasonCode[] = [];

  // Profit reason code
  if (label === "POSITIVE") {
    reasonCodes.push("CONTRIBUTION_ABOVE_EXPECTED");
  } else if (label === "NEGATIVE") {
    reasonCodes.push("CONTRIBUTION_BELOW_EXPECTED");
  } else {
    reasonCodes.push("WITHIN_NOISE");
  }

  // ACoS reason code
  if (baselineMetrics.acos !== null && validAfterMetrics.acos !== null) {
    if (validAfterMetrics.acos < baselineMetrics.acos) {
      reasonCodes.push("ACOS_IMPROVED");
    } else if (validAfterMetrics.acos > baselineMetrics.acos) {
      reasonCodes.push("ACOS_WORSENED");
    }

    if (validAfterMetrics.acos > margin * 100) {
      reasonCodes.push("ACOS_ABOVE_BE");
    }
  }

  // Volume reason codes (Sales & Orders)
  const salesRateBaseline = baselineMetrics.ad_sales / 30;
  const salesRateAfter = validAfterMetrics.ad_sales / window;
  if (salesRateAfter >= salesRateBaseline * config.sales_preserved_ratio) {
    reasonCodes.push("SALES_PRESERVED");
  } else {
    reasonCodes.push("SALES_DROPPED");
  }

  const ordersRateBaseline = baselineMetrics.orders / 30;
  const ordersRateAfter = validAfterMetrics.orders / window;
  if (ordersRateAfter >= ordersRateBaseline * config.orders_preserved_ratio) {
    reasonCodes.push("ORDERS_PRESERVED");
  } else {
    reasonCodes.push("ORDERS_DROPPED");
  }

  // Eligible for learning check: only mature windows (fully settled attribution) qualify
  const eligibleForLearning =
    isMature &&
    ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(label) &&
    config.learning_windows.includes(window) &&
    !decision.is_control &&
    ["APPLY_AI", "APPLY_RULE", "EDIT"].includes(decision.user_action);

  const expectedBaseline: ExpectedBaseline = {
    value: expected,
    source: expectedSource,
    control_count: controlCount,
    control_shift_w: controlShiftW,
    expected_own_w: expectedOwnW,
  };

  return {
    decision_id: decision.decision_id,
    window,
    evaluation_version: evaluationVersion,
    label_version: labelVersion,
    evaluator_version: evaluatorVersion,
    status: evaluationStatus,
    label,
    validity: "VALID",
    confound_flags: [],
    reason_codes: reasonCodes,
    expected_baseline: expectedBaseline,
    baseline_quality: baselineQuality,
    actual_contribution: actual,
    reward_usd: rewardUsd,
    reward_norm: rewardNorm,
    T,
    baseline_metrics: baselineMetrics,
    after_metrics: afterMetrics,
    applied_delta_pct: appliedDeltaPct,
    eligible_for_learning: eligibleForLearning,
    evaluated_at: evaluatedAt,
  };
}
