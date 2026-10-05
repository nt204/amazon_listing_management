import "server-only";

import { getDatabaseClient } from "@/lib/db";
import {
  evaluateBidDecision,
  type EvaluationInput,
  type EvaluationResult,
  type MatchedControlSample,
} from "./bid-evaluator";
import {
  upsertActionOutcome,
  type ActionOutcomeInput,
  type JsonObject,
} from "./action-memory";

type JsonRecord = Record<string, unknown>;

interface PendingOutcomeRow {
  action_id: string;
  store_id: string;
  campaign_id: string;
  campaign_type: string;
  target_id: string;
  target_keyword: string;
  match_type: string;
  sku: string;
  old_value: string | number;
  system_suggested_value: string | number;
  final_value: string | number;
  action_status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  window_days: number;
  observation_start: string;
  observation_end: string;
  maturity_date: string | null;
  context: JsonRecord | string | null;
}

export interface OutcomeEvaluationSummary {
  examined: number;
  observing: number;
  provisional: number;
  mature: number;
  contaminated: number;
  interruptedCount?: number;
  supersededCount?: number;
  insufficientData: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  eligibleForLearningCount: number;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let skuProductTypeCache: { prefix: string; product_type: string }[] | null = null;
let productCostMasterCache: Map<string, number> | null = null;

async function loadMarginMappingCaches() {
  if (skuProductTypeCache && productCostMasterCache) return;

  const sql = await getDatabaseClient();
  const ruleRow = await sql<{ config_json: { prefix_rules?: { prefix: string; product_type: string }[] } }[]>`
    SELECT config_json FROM ppc_sku_mapping_rules WHERE rule_set_id = 'sku_to_product_type_mapping' LIMIT 1;
  `;
  skuProductTypeCache = ruleRow[0]?.config_json?.prefix_rules || [];

  const costRows = await sql<{ product_type: string; break_even_acos: string }[]>`
    SELECT product_type, break_even_acos FROM product_cost_master;
  `;
  productCostMasterCache = new Map();
  for (const c of costRows) {
    const val = Number(c.break_even_acos);
    if (Number.isFinite(val) && val > 0) {
      productCostMasterCache.set(c.product_type.toLowerCase().trim(), val / 100);
    }
  }
}

export async function resolveMarginForSku(sku: string): Promise<number> {
  await loadMarginMappingCaches();
  if (!sku) return 0.35;

  const upperSku = sku.trim().toUpperCase();
  let matchedProductType = "";
  if (skuProductTypeCache) {
    for (const rule of skuProductTypeCache) {
      if (upperSku.startsWith(rule.prefix.toUpperCase())) {
        matchedProductType = rule.product_type.toLowerCase().trim();
        break;
      }
    }
  }

  if (matchedProductType && productCostMasterCache?.has(matchedProductType)) {
    return productCostMasterCache.get(matchedProductType)!;
  }

  return 0.35; // Default fallback margin
}

/**
 * Seeds outcome tracking rows for actions in 'EXPORTED' or 'APPLIED' status that don't have outcome records.
 */
export async function seedPendingOutcomesFromActions(options: { limit?: number } = {}): Promise<number> {
  const sql = await getDatabaseClient();
  const limit = Math.max(1, Math.min(2_000, options.limit || 500));

  const actions = await sql<{
    id: string;
    campaign_type: string;
    applied_on: string;
  }[]>`
    SELECT action.id, action.campaign_type,
           COALESCE(action.approved_at::date, action.created_at::date, CURRENT_DATE)::text AS applied_on
    FROM ppc_actions action
    WHERE action.status IN ('EXPORTED', 'APPLIED')
      AND NOT EXISTS (
        SELECT 1 FROM ppc_action_outcomes outcome WHERE outcome.action_id = action.id
      )
    ORDER BY action.created_at DESC
    LIMIT ${limit}
  `;

  let seededCount = 0;
  for (const a of actions) {
    const appliedOn = a.applied_on;
    const attributionDays = (a.campaign_type || "").toUpperCase().startsWith("SB") ? 14 : 7;

    for (const windowDays of [7, 30]) {
      const obsStart = addDaysToIso(appliedOn, 1);
      const obsEnd = addDaysToIso(appliedOn, windowDays);
      const maturity = addDaysToIso(appliedOn, windowDays + attributionDays);

      await sql`
        INSERT INTO ppc_action_outcomes (
          action_id, window_days, observation_start, observation_end, maturity_date,
          status, evidence_quality
        ) VALUES (
          ${a.id}, ${windowDays}, ${obsStart}, ${obsEnd}, ${maturity},
          'OBSERVING', ${sql.json({ applied_on: appliedOn, scheduled_by: 'seedPendingOutcomes' })}
        )
        ON CONFLICT (action_id, window_days) DO NOTHING
      `;
      seededCount += 1;
    }
  }

  return seededCount;
}

/**
 * Reads baseline metrics (30 days before applied date) for a target.
 */
async function readBaselineFacts(
  storeId: string,
  targetId: string,
  appliedDate: string
) {
  if (!targetId) return null;
  const sql = await getDatabaseClient();

  const rows = await sql<{
    clicks: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    impressions: string | number;
  }[]>`
    SELECT clicks, spend, sales, orders, impressions
    FROM ppc_performance_facts
    WHERE store_id = ${storeId}
      AND grain = 'TARGET'
      AND target_id = ${targetId}
      AND (report_end_date - report_start_date) = 30
      AND report_end_date <= ${appliedDate}::date + 2
    ORDER BY report_end_date DESC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  const clicks = Number(r.clicks || 0);
  const spend = Number(r.spend || 0);
  const sales = Number(r.sales || 0);
  const orders = Number(r.orders || 0);
  const acos = sales > 0 ? (spend / sales) * 100 : null;

  return {
    clicks,
    spend,
    sales,
    orders,
    acos,
    days_with_data: 30,
    total_days: 30,
  };
}

/**
 * Reads after metrics for a given window length.
 */
async function readAfterFacts(
  storeId: string,
  targetId: string,
  windowDays: number,
  observationStart: string,
  observationEnd: string,
  today: string
) {
  if (!targetId) return null;
  // If the observation window has not completed yet, cannot compute full after metrics
  if (today < observationEnd) {
    return null;
  }
  const sql = await getDatabaseClient();

  const rows = await sql<{
    clicks: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    impressions: string | number;
  }[]>`
    SELECT clicks, spend, sales, orders, impressions
    FROM ppc_performance_facts
    WHERE store_id = ${storeId}
      AND grain = 'TARGET'
      AND target_id = ${targetId}
      AND (report_end_date - report_start_date) = ${windowDays}
      AND report_end_date >= ${observationEnd}::date - 2
      AND report_start_date <= ${observationStart}::date + 2
    ORDER BY report_end_date ASC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  const clicks = Number(r.clicks || 0);
  const spend = Number(r.spend || 0);
  const sales = Number(r.sales || 0);
  const orders = Number(r.orders || 0);
  const acos = sales > 0 ? (spend / sales) * 100 : null;

  return {
    clicks,
    spend,
    sales,
    orders,
    acos,
    days_with_data: windowDays,
    total_days: windowDays,
  };
}

const controlTargetPoolCache = new Map<string, string[]>();

async function getControlTargetIdsForStore(storeId: string): Promise<string[]> {
  if (controlTargetPoolCache.has(storeId)) {
    return controlTargetPoolCache.get(storeId)!;
  }
  const sql = await getDatabaseClient();
  const rows = await sql<{ target_id: string }[]>`
    SELECT DISTINCT target_id
    FROM ppc_performance_facts
    WHERE store_id = ${storeId}
      AND grain = 'TARGET'
      AND target_id <> ''
      AND target_id NOT IN (
        SELECT DISTINCT target_id FROM ppc_actions WHERE store_id = ${storeId}
      )
    LIMIT 10;
  `;
  const ids = rows.map((r) => r.target_id);
  controlTargetPoolCache.set(storeId, ids);
  return ids;
}

/**
 * Queries matched controls in the same store and ad_type using indexed lookups.
 */
async function queryMatchedControls(
  storeId: string,
  campaignType: string,
  targetId: string,
  windowDays: number,
  margin: number
): Promise<MatchedControlSample[]> {
  const sql = await getDatabaseClient();

  try {
    const candidateIds = (await getControlTargetIdsForStore(storeId)).filter((id) => id !== targetId);
    if (candidateIds.length === 0) return [];

    const matchedControls: MatchedControlSample[] = [];

    for (const ctrlTargetId of candidateIds.slice(0, 7)) {
      const ctrlFacts = await sql<{
        window_days: number;
        spend: string | number;
        sales: string | number;
      }[]>`
        SELECT (report_end_date - report_start_date)::int as window_days, spend, sales
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND target_id = ${ctrlTargetId}
          AND grain = 'TARGET'
        LIMIT 4;
      `;
      const c30 = ctrlFacts.find((f) => f.window_days === 30);
      const cW = ctrlFacts.find((f) => f.window_days === windowDays);
      if (c30 && cW) {
        const bSales = Number(c30.sales || 0);
        const bSpend = Number(c30.spend || 0);
        const aSales = Number(cW.sales || 0);
        const aSpend = Number(cW.spend || 0);
        const bContrib = bSales * margin - bSpend;
        const expOwn = (bContrib / 30) * windowDays;
        const actContrib = aSales * margin - aSpend;
        matchedControls.push({
          control_id: ctrlTargetId,
          actual_contribution_w: actContrib,
          expected_own_w: expOwn,
          shift_w: actContrib - expOwn,
        });
      }
    }

    return matchedControls;
  } catch {
    return [];
  }
}

/**
 * Main evaluation pipeline for pending action outcomes.
 * Integrates the deterministic bid-evaluator specification.
 */
export async function evaluatePendingActionOutcomes(options: {
  limit?: number;
  today?: string;
  autoSeed?: boolean;
} = {}): Promise<OutcomeEvaluationSummary> {
  const sql = await getDatabaseClient();
  const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit || 1_000)));
  const today = options.today || toIsoDate(new Date());

  if (options.autoSeed !== false) {
    await seedPendingOutcomesFromActions({ limit });
  }

  const rows = await sql<PendingOutcomeRow[]>`
    SELECT outcome.action_id, action.store_id, action.campaign_id, action.campaign_type,
           action.target_id, action.target_keyword, action.match_type, action.sku,
           action.old_value, action.system_suggested_value, action.final_value,
           action.status as action_status, action.approved_by,
           action.approved_at::text, action.created_at::text,
           outcome.window_days, outcome.observation_start::text, outcome.observation_end::text,
           outcome.maturity_date::text, context.context
    FROM ppc_action_outcomes outcome
    JOIN ppc_actions action ON action.id = outcome.action_id
    LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE outcome.status IN ('OBSERVING', 'PROVISIONAL', 'INSUFFICIENT_DATA')
    ORDER BY outcome.observation_end ASC, outcome.window_days ASC
    LIMIT ${limit}
  `;

  const summary: OutcomeEvaluationSummary = {
    examined: rows.length,
    observing: 0,
    provisional: 0,
    mature: 0,
    contaminated: 0,
    insufficientData: 0,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    eligibleForLearningCount: 0,
  };

  for (const row of rows) {
    const appliedDate = (row.approved_at || row.created_at).slice(0, 10);
    const margin = await resolveMarginForSku(row.sku);

    // Read metrics from facts
    const baselineFacts = await readBaselineFacts(row.store_id, row.target_id, appliedDate);
    const afterFacts = await readAfterFacts(
      row.store_id,
      row.target_id,
      row.window_days,
      row.observation_start,
      row.observation_end,
      today
    );

    // Matched controls
    const matchedControls = await queryMatchedControls(
      row.store_id,
      row.campaign_type || "SP",
      row.target_id,
      row.window_days,
      margin
    );

    // Query other actions on same target to detect interruption
    const otherActions = await sql<{
      id: string;
      target_id: string;
      applied_at: string;
      applied_bid: string | number;
    }[]>`
      SELECT id, target_id,
             COALESCE(approved_at::date, created_at::date, CURRENT_DATE)::text as applied_at,
             COALESCE(final_value, system_suggested_value, 0)::float8 as applied_bid
      FROM ppc_actions
      WHERE id <> ${row.action_id}
        AND target_id = ${row.target_id}
        AND status IN ('EXPORTED', 'APPLIED');
    `;

    // Prepare evaluation input
    const evalInput: EvaluationInput = {
      decision: {
        decision_id: row.action_id,
        target_id: row.target_id,
        applied_at: appliedDate,
        current_bid: Number(row.old_value || 0),
        applied_bid: Number(row.final_value || row.system_suggested_value || 0),
        pre_ads_contribution_margin_pct: margin,
        is_control: false,
        user_action: "APPLY_AI",
      },
      window: row.window_days,
      evaluation_date: today,
      matched_controls: matchedControls,
      other_bid_actions: otherActions.map((o) => ({
        action_id: o.id,
        target_id: o.target_id,
        applied_at: o.applied_at,
        applied_bid: Number(o.applied_bid || 0),
      })),
      baseline_metrics_summary: baselineFacts
        ? {
            clicks: baselineFacts.clicks,
            orders: baselineFacts.orders,
            ad_sales: baselineFacts.sales,
            ad_spend: baselineFacts.spend,
            acos: baselineFacts.acos,
            contribution: baselineFacts.sales * margin - baselineFacts.spend,
            days_with_data: 30,
            total_days: 30,
          }
        : undefined,
      after_metrics_summary: afterFacts
        ? {
            clicks: afterFacts.clicks,
            orders: afterFacts.orders,
            ad_sales: afterFacts.sales,
            ad_spend: afterFacts.spend,
            acos: afterFacts.acos,
            contribution: afterFacts.sales * margin - afterFacts.spend,
            days_with_data: row.window_days,
            total_days: row.window_days,
          }
        : undefined,
    };

    const evalResult: EvaluationResult = evaluateBidDecision(evalInput);

    // Map evaluator output to ppc_action_outcomes status & fields
    let dbStatus: ActionOutcomeInput["status"] = "OBSERVING";
    let dbLabel: ActionOutcomeInput["outcomeLabel"] = null;

    if (evalResult.status === "PENDING") {
      dbStatus = "OBSERVING";
      summary.observing += 1;
    } else if (evalResult.validity === "INTERRUPTED" || evalResult.validity === "SUPERSEDED") {
      dbStatus = "INTERRUPTED";
      dbLabel = "INTERRUPTED";
      summary.interruptedCount = (summary.interruptedCount || 0) + 1;
      summary.supersededCount = (summary.supersededCount || 0) + 1;
    } else if (evalResult.validity === "CONFOUNDED") {
      dbStatus = "CONTAMINATED";
      dbLabel = "CONFOUNDED";
      summary.contaminated += 1;
    } else if (evalResult.validity === "INCONCLUSIVE") {
      dbStatus = "INSUFFICIENT_DATA";
      dbLabel = "INCONCLUSIVE";
      summary.insufficientData += 1;
    } else if (evalResult.validity === "VALID") {
      if (evalResult.status === "PROVISIONAL") {
        dbStatus = "PROVISIONAL";
        summary.provisional += 1;
      } else {
        dbStatus = "MATURE";
        summary.mature += 1;
      }

      dbLabel = evalResult.label as "POSITIVE" | "NEUTRAL" | "NEGATIVE";
      if (dbLabel === "POSITIVE") summary.positiveCount += 1;
      else if (dbLabel === "NEUTRAL") summary.neutralCount += 1;
      else if (dbLabel === "NEGATIVE") summary.negativeCount += 1;

      if (evalResult.eligible_for_learning) {
        summary.eligibleForLearningCount += 1;
      }
    }

    const baselinePayload = evalResult.baseline_metrics
      ? {
          clicks: evalResult.baseline_metrics.clicks,
          orders: evalResult.baseline_metrics.orders,
          spend: evalResult.baseline_metrics.ad_spend,
          sales: evalResult.baseline_metrics.ad_sales,
          acos: evalResult.baseline_metrics.acos,
          contribution: evalResult.baseline_metrics.contribution,
          days: 30,
        }
      : {};

    const observedPayload = evalResult.after_metrics
      ? {
          clicks: evalResult.after_metrics.clicks,
          orders: evalResult.after_metrics.orders,
          spend: evalResult.after_metrics.ad_spend,
          sales: evalResult.after_metrics.ad_sales,
          acos: evalResult.after_metrics.acos,
          contribution: evalResult.after_metrics.contribution,
          days: row.window_days,
        }
      : {};

    const comparisonPayload = {
      reward_usd: evalResult.reward_usd,
      reward_norm: evalResult.reward_norm,
      t_threshold: evalResult.T,
      applied_delta_pct: evalResult.applied_delta_pct,
      actual_contribution: evalResult.actual_contribution,
      expected_contribution: evalResult.expected_baseline?.value ?? null,
      expected_source: evalResult.expected_baseline?.source ?? null,
      control_count: evalResult.expected_baseline?.control_count ?? 0,
      control_shift_w: evalResult.expected_baseline?.control_shift_w ?? 0,
    };

    const evidenceQualityPayload = {
      spec_label: evalResult.label,
      validity: evalResult.validity,
      baseline_quality: evalResult.baseline_quality,
      reason_codes: evalResult.reason_codes,
      confound_flags: evalResult.confound_flags,
      eligible_for_learning: evalResult.eligible_for_learning,
      end_clean_observation: evalResult.end_clean_observation ?? null,
      interrupted_by_action_id: evalResult.interrupted_by_action_id ?? null,
      superseded_by_action_id: evalResult.superseded_by_action_id || evalResult.interrupted_by_action_id || null,
      label_version: evalResult.label_version,
      evaluator_version: evalResult.evaluator_version,
    };

    await upsertActionOutcome({
      actionId: row.action_id,
      windowDays: row.window_days,
      observationStart: row.observation_start,
      observationEnd: row.observation_end,
      maturityDate: row.maturity_date,
      status: dbStatus,
      baseline: baselinePayload,
      observed: observedPayload,
      comparison: comparisonPayload,
      evidenceQuality: evidenceQualityPayload,
      outcomeLabel: dbLabel,
      evaluatorVersion: `outcome-v2-spec`,
      evaluatedAt: new Date().toISOString(),
    });
  }

  return summary;
}

export async function findHistoricalActionCases(input: {
  storeId: string;
  campaignType?: string;
  matchType?: string;
  actionType?: string;
  limit?: number;
}) {
  const sql = await getDatabaseClient();
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit || 20)));
  return sql<Record<string, unknown>[]>`
    SELECT action.id AS action_id, action.campaign_type, action.match_type,
           action.action_type, action.old_value, action.final_value,
           context.context, outcome.window_days, outcome.outcome_label,
           outcome.baseline, outcome.observed, outcome.comparison,
           outcome.evidence_quality, outcome.evaluated_at
    FROM ppc_action_outcomes outcome
    JOIN ppc_actions action ON action.id = outcome.action_id
    LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE action.store_id = ${input.storeId}
      AND outcome.status = 'MATURE'
      AND outcome.outcome_label IS NOT NULL
      ${input.campaignType ? sql`AND action.campaign_type = ${input.campaignType}` : sql``}
      ${input.matchType ? sql`AND action.match_type = ${input.matchType}` : sql``}
      ${input.actionType ? sql`AND action.action_type = ${input.actionType}` : sql``}
    ORDER BY outcome.evaluated_at DESC
    LIMIT ${limit}
  `;
}
