import { getDatabaseClient } from "../lib/db";
import {
  evaluateBidDecision,
  type EvaluationInput,
  type EvaluationResult,
  type MatchedControlSample,
} from "../lib/ppc/bid-evaluator";
import { resolveMarginForSku } from "../lib/ppc/action-outcome-evaluator";

interface ActionRow {
  id: string;
  store_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  target_id: string;
  target_keyword: string;
  match_type: string;
  sku: string;
  old_value: string | number;
  system_suggested_value: string | number;
  final_value: string | number;
  rule_version: string;
  status: string;
  approved_by: string | null;
  applied_on: string;
}

interface TargetFactRow {
  report_start_date: string;
  report_end_date: string;
  window_days: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

function addDaysToIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function runBacktest() {
  console.log("================================================================================");
  console.log("       AMAZON PPC BID EVALUATION - HISTORICAL BACKTEST ENGINE (SPEC V1)         ");
  console.log("================================================================================\n");

  const sql = await getDatabaseClient();

  // Load exported / applied actions
  const actions = await sql<ActionRow[]>`
    SELECT id, store_id, campaign_id, campaign_name, campaign_type,
           target_id, target_keyword, match_type, sku,
           old_value, system_suggested_value, final_value,
           rule_version, status, approved_by,
           COALESCE(approved_at::date, created_at::date, CURRENT_DATE)::text AS applied_on
    FROM ppc_actions
    WHERE status IN ('EXPORTED', 'APPLIED')
      AND target_id IS NOT NULL AND target_id <> ''
    ORDER BY created_at DESC
  `;

  console.log(`Found ${actions.length} historical bid change actions to analyze.\n`);

  if (actions.length === 0) {
    console.log("No applied/exported actions found in database.");
    await sql.end();
    return;
  }

  // Pre-load a pool of control target IDs per store that were NOT changed in ppc_actions
  const storeIds = Array.from(new Set(actions.map((a) => a.store_id)));
  const controlPoolByStore = new Map<string, string[]>();

  for (const storeId of storeIds) {
    const controls = await sql<{ target_id: string }[]>`
      SELECT DISTINCT target_id
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND grain = 'TARGET'
        AND target_id <> ''
        AND target_id NOT IN (
          SELECT DISTINCT target_id FROM ppc_actions WHERE store_id = ${storeId}
        )
      LIMIT 15;
    `;
    controlPoolByStore.set(storeId, controls.map((c) => c.target_id));
  }

  const results: { action: ActionRow; window: number; evalResult: EvaluationResult }[] = [];

  const stats = {
    totalEvaluated: 0,
    valid: 0,
    inconclusive: 0,
    confounded: 0,
    pending: 0,
    labels: {
      POSITIVE: 0,
      NEUTRAL: 0,
      NEGATIVE: 0,
      INCONCLUSIVE: 0,
      CONFOUNDED: 0,
    },
    reasons: {} as Record<string, number>,
    totalRewardUsd: 0,
    positiveRewardUsd: 0,
    negativeRewardUsd: 0,
    eligibleForLearning: 0,
    highQualityBaseline: 0,
    lowQualityBaseline: 0,
    windowBreakdown: {
      7: { valid: 0, positive: 0, neutral: 0, negative: 0, reward: 0 },
      30: { valid: 0, positive: 0, neutral: 0, negative: 0, reward: 0 },
    },
  };

  const windowsToTest = [7, 30];
  let processedCount = 0;

  for (const action of actions) {
    processedCount += 1;
    if (processedCount % 50 === 0 || processedCount === actions.length) {
      process.stdout.write(`Analyzing actions: ${processedCount}/${actions.length} completed...\r`);
    }

    const margin = await resolveMarginForSku(action.sku);
    const appliedDate = action.applied_on;

    // Fast indexed query: fetch all performance facts for this target
    const targetFactsRaw = await sql<{
      report_start_date: string;
      report_end_date: string;
      window_days: number;
      clicks: string | number;
      spend: string | number;
      sales: string | number;
      orders: string | number;
    }[]>`
      SELECT report_start_date::text, report_end_date::text,
             (report_end_date - report_start_date)::int as window_days,
             clicks, spend, sales, orders
      FROM ppc_performance_facts
      WHERE store_id = ${action.store_id}
        AND target_id = ${action.target_id}
        AND grain = 'TARGET'
      ORDER BY report_end_date DESC;
    `;

    const targetFacts: TargetFactRow[] = targetFactsRaw.map((r) => ({
      report_start_date: r.report_start_date.slice(0, 10),
      report_end_date: r.report_end_date.slice(0, 10),
      window_days: r.window_days,
      clicks: Number(r.clicks || 0),
      spend: Number(r.spend || 0),
      sales: Number(r.sales || 0),
      orders: Number(r.orders || 0),
    }));

    // Baseline 30D: facts where window_days = 30 and report_end_date <= appliedDate + 2
    const baselineCandidate = targetFacts.find(
      (f) => f.window_days === 30 && f.report_end_date <= addDaysToIso(appliedDate, 2)
    ) || targetFacts.find((f) => f.window_days === 30);

    const baselineData = baselineCandidate
      ? {
          clicks: baselineCandidate.clicks,
          orders: baselineCandidate.orders,
          ad_spend: baselineCandidate.spend,
          ad_sales: baselineCandidate.sales,
          acos: baselineCandidate.sales > 0 ? (baselineCandidate.spend / baselineCandidate.sales) * 100 : null,
          contribution: baselineCandidate.sales * margin - baselineCandidate.spend,
          days_with_data: 30,
          total_days: 30,
        }
      : null;

    // Matched controls samples
    const storeControls = controlPoolByStore.get(action.store_id) || [];
    const matchedControls: MatchedControlSample[] = [];

    for (const ctrlTargetId of storeControls.slice(0, 7)) {
      const ctrlFacts = await sql<{
        window_days: number;
        spend: string | number;
        sales: string | number;
      }[]>`
        SELECT (report_end_date - report_start_date)::int as window_days, spend, sales
        FROM ppc_performance_facts
        WHERE store_id = ${action.store_id}
          AND target_id = ${ctrlTargetId}
          AND grain = 'TARGET'
        LIMIT 4;
      `;
      const c30 = ctrlFacts.find((f) => f.window_days === 30);
      const cW = ctrlFacts.find((f) => f.window_days === 7);
      if (c30 && cW) {
        const bSales = Number(c30.sales || 0);
        const bSpend = Number(c30.spend || 0);
        const aSales = Number(cW.sales || 0);
        const aSpend = Number(cW.spend || 0);
        const bContrib = bSales * margin - bSpend;
        const expOwn = (bContrib / 30) * 7;
        const actContrib = aSales * margin - aSpend;
        matchedControls.push({
          control_id: ctrlTargetId,
          actual_contribution_w: actContrib,
          expected_own_w: expOwn,
          shift_w: actContrib - expOwn,
        });
      }
    }

    for (const windowDays of windowsToTest) {
      stats.totalEvaluated += 1;

      // After W days fact
      const afterCandidate = targetFacts.find(
        (f) => f.window_days === windowDays && f.report_end_date >= appliedDate
      ) || targetFacts.find((f) => f.window_days === windowDays);

      const afterData = afterCandidate
        ? {
            clicks: afterCandidate.clicks,
            orders: afterCandidate.orders,
            ad_spend: afterCandidate.spend,
            ad_sales: afterCandidate.sales,
            acos: afterCandidate.sales > 0 ? (afterCandidate.spend / afterCandidate.sales) * 100 : null,
            contribution: afterCandidate.sales * margin - afterCandidate.spend,
            days_with_data: windowDays,
            total_days: windowDays,
          }
        : null;

      const simulatedEvalDate = addDaysToIso(appliedDate, windowDays + 20);

      const evalInput: EvaluationInput = {
        decision: {
          decision_id: action.id,
          target_id: action.target_id,
          applied_at: appliedDate,
          current_bid: Number(action.old_value || 0),
          applied_bid: Number(action.final_value || action.system_suggested_value || 0),
          pre_ads_contribution_margin_pct: margin,
          is_control: false,
          user_action: "APPLY_AI",
        },
        window: windowDays,
        evaluation_date: simulatedEvalDate,
        baseline_metrics_summary: baselineData || undefined,
        after_metrics_summary: afterData || undefined,
        matched_controls: matchedControls,
      };

      const res = evaluateBidDecision(evalInput);
      results.push({ action, window: windowDays, evalResult: res });

      if (res.validity === "VALID") {
        stats.valid += 1;
        const lbl = res.label as "POSITIVE" | "NEUTRAL" | "NEGATIVE";
        stats.labels[lbl] = (stats.labels[lbl] || 0) + 1;

        const wKey = windowDays === 7 ? 7 : 30;
        stats.windowBreakdown[wKey].valid += 1;
        if (lbl === "POSITIVE") stats.windowBreakdown[wKey].positive += 1;
        if (lbl === "NEUTRAL") stats.windowBreakdown[wKey].neutral += 1;
        if (lbl === "NEGATIVE") stats.windowBreakdown[wKey].negative += 1;

        if (res.reward_usd !== null) {
          stats.totalRewardUsd += res.reward_usd;
          stats.windowBreakdown[wKey].reward += res.reward_usd;
          if (res.reward_usd > 0) stats.positiveRewardUsd += res.reward_usd;
          else stats.negativeRewardUsd += res.reward_usd;
        }

        if (res.baseline_quality === "HIGH") stats.highQualityBaseline += 1;
        else stats.lowQualityBaseline += 1;

        if (res.eligible_for_learning) {
          stats.eligibleForLearning += 1;
        }
      } else if (res.validity === "CONFOUNDED") {
        stats.confounded += 1;
        stats.labels.CONFOUNDED += 1;
      } else if (res.validity === "INCONCLUSIVE") {
        stats.inconclusive += 1;
        stats.labels.INCONCLUSIVE += 1;
      } else if (res.status === "PENDING") {
        stats.pending += 1;
      }

      for (const reason of res.reason_codes) {
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
      }
    }
  }

  console.log(`\n\n================================================================================`);
  console.log("                             EXECUTIVE BACKTEST REPORT                          ");
  console.log("================================================================================\n");

  console.log(`▶ Total Decision Windows Analyzed: ${stats.totalEvaluated} (${actions.length} actions × 2 windows)`);
  console.log(`  ├─ VALID (Evaluated cleanly)       : ${stats.valid} (${((stats.valid / stats.totalEvaluated) * 100).toFixed(1)}%)`);
  console.log(`  ├─ INCONCLUSIVE (Low data/signal) : ${stats.inconclusive} (${((stats.inconclusive / stats.totalEvaluated) * 100).toFixed(1)}%)`);
  console.log(`  └─ CONFOUNDED (Interference)       : ${stats.confounded} (${((stats.confounded / stats.totalEvaluated) * 100).toFixed(1)}%)\n`);

  console.log("▶ VALID LABEL OUTCOMES:");
  const validTotal = stats.valid || 1;
  console.log(`  🟢 POSITIVE (Reward > +T)   : ${stats.labels.POSITIVE} (${((stats.labels.POSITIVE / validTotal) * 100).toFixed(1)}%)`);
  console.log(`  ⚪ NEUTRAL  (|Reward| <= T) : ${stats.labels.NEUTRAL} (${((stats.labels.NEUTRAL / validTotal) * 100).toFixed(1)}%)`);
  console.log(`  🔴 NEGATIVE (Reward < -T)   : ${stats.labels.NEGATIVE} (${((stats.labels.NEGATIVE / validTotal) * 100).toFixed(1)}%)`);

  const activeDecisions = stats.labels.POSITIVE + stats.labels.NEGATIVE;
  if (activeDecisions > 0) {
    const winRate = (stats.labels.POSITIVE / activeDecisions) * 100;
    console.log(`  ⭐ Net Win Rate (Positive / Decisive): ${winRate.toFixed(1)}%\n`);
  } else {
    console.log(`\n`);
  }

  console.log("▶ FINANCIAL REWARD IMPACT (USD Contribution):");
  console.log(`  ├─ Total Net Contribution Reward : ${stats.totalRewardUsd >= 0 ? "+" : ""}$${stats.totalRewardUsd.toFixed(2)}`);
  console.log(`  ├─ Total Value Created (Positive): +$${stats.positiveRewardUsd.toFixed(2)}`);
  console.log(`  └─ Total Value Lost (Negative)   : -$${Math.abs(stats.negativeRewardUsd).toFixed(2)}\n`);

  console.log("▶ WINDOW COMPARISON (D7 vs D30):");
  console.log(`  • D7  : ${stats.windowBreakdown[7].valid} Valid | 🟢 ${stats.windowBreakdown[7].positive} | ⚪ ${stats.windowBreakdown[7].neutral} | 🔴 ${stats.windowBreakdown[7].negative} | Net Reward: ${stats.windowBreakdown[7].reward >= 0 ? "+" : ""}$${stats.windowBreakdown[7].reward.toFixed(2)}`);
  console.log(`  • D30 : ${stats.windowBreakdown[30].valid} Valid | 🟢 ${stats.windowBreakdown[30].positive} | ⚪ ${stats.windowBreakdown[30].neutral} | 🔴 ${stats.windowBreakdown[30].negative} | Net Reward: ${stats.windowBreakdown[30].reward >= 0 ? "+" : ""}$${stats.windowBreakdown[30].reward.toFixed(2)}\n`);

  console.log("▶ AI LEARNING DATASET PURITY:");
  console.log(`  • Records Eligible for AI Learning (D30 + Valid + Non-Control): ${stats.eligibleForLearning}`);
  console.log(`  • High-Quality Baseline Controls (>= 10): ${stats.highQualityBaseline}`);
  console.log(`  • Low-Quality Baseline / Own 30D (< 10)  : ${stats.lowQualityBaseline}\n`);

  console.log("▶ TOP REASON CODES OCCURRENCES:");
  const sortedReasons = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedReasons.slice(0, 8)) {
    console.log(`  • ${code.padEnd(30)}: ${count}`);
  }

  console.log("\n================================================================================");
  console.log("                      SAMPLE INDIVIDUAL VALID CASES                             ");
  console.log("================================================================================\n");

  const validSamples = results.filter((r) => r.evalResult.validity === "VALID").slice(0, 3);
  for (const sample of validSamples) {
    const a = sample.action;
    const r = sample.evalResult;
    console.log(`Keyword: "${a.target_keyword}" (${a.match_type}) | SKU: ${a.sku} | Window: D${sample.window}`);
    console.log(`Bid Change: $${a.old_value} -> $${a.final_value} (${r.applied_delta_pct.toFixed(1)}%)`);
    console.log(`Baseline Contrib: $${r.baseline_metrics?.contribution.toFixed(2)} | Actual: $${r.actual_contribution?.toFixed(2)} | Expected: $${r.expected_baseline?.value.toFixed(2)} (${r.expected_baseline?.source})`);
    console.log(`Reward USD: ${r.reward_usd! >= 0 ? "+" : ""}$${r.reward_usd?.toFixed(2)} | Threshold T: $${r.T?.toFixed(2)} => Label: ${r.label}`);
    console.log(`Reasons: [${r.reason_codes.join(", ")}] | Eligible for Learning: ${r.eligible_for_learning}`);
    console.log("--------------------------------------------------------------------------------");
  }

  await sql.end();
}

runBacktest().catch((err) => {
  console.error("Backtest failed:", err);
  process.exit(1);
});
