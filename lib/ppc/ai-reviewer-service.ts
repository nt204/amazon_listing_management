import "server-only";

import { getDatabaseClient } from "@/lib/db";
import {
  buildShadowCandidates,
  type CandidateEvidence,
  type ShadowCandidate,
  type ShadowDirection,
} from "./shadow-decision-engine";
import {
  invokeAiReviewer,
  PPC_AI_REVIEWER_AGENT_VERSION,
  PPC_AI_REVIEWER_POLICY_VERSION,
  PPC_AI_REVIEWER_PROMPT_VERSION,
  type AiReviewerPayload,
  type AvailableCandidateView,
} from "./ai-reviewer";

type JsonRecord = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface ShadowSourceRow {
  action_id: string;
  store_id: string;
  campaign_id: string;
  campaign_type: string;
  match_type: string;
  target_id: string;
  target_keyword: string;
  action_type: string;
  old_value: string | number;
  system_suggested_value: string | number;
  data_as_of: string;
  context: JsonRecord | string;
}

interface HistoricalRow {
  campaign_type: string;
  match_type: string;
  old_value: string | number;
  final_value: string | number;
  outcome_label: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  reward_usd: string | number | null;
  context: JsonRecord | string | null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function parseContext(value: JsonRecord | string): JsonRecord {
  if (typeof value !== "string") return value;
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function directionFor(row: ShadowSourceRow): ShadowDirection {
  if (row.action_type === "PAUSE_TARGET") return "PAUSE";
  const oldValue = finite(row.old_value);
  const ruleValue = finite(row.system_suggested_value);
  if (ruleValue > oldValue) return "INCREASE";
  if (ruleValue < oldValue) return "DECREASE";
  return "HOLD";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function historicalCandidateId(row: HistoricalRow): string | null {
  const context = row.context ? parseContext(row.context) : {};
  const metrics = record(context.metrics);
  const oldBid = finite(row.old_value);
  const finalBid = finite(row.final_value);
  if (finalBid > oldBid && oldBid > 0) {
    const pct = ((finalBid / oldBid) - 1) * 100;
    const nearest = [5, 8].sort((a, b) => Math.abs(a - pct) - Math.abs(b - pct))[0];
    return Math.abs(nearest - pct) <= 2 ? `INCREASE_CURRENT_BID_PLUS_${nearest}` : null;
  }
  const avgCpc = finite(metrics.avg_cpc);
  if (finalBid < oldBid && avgCpc > 0) {
    const pct = ((finalBid / avgCpc) - 1) * 100;
    const nearest = [-8, -10, -15].sort((a, b) => Math.abs(a - pct) - Math.abs(b - pct))[0];
    return Math.abs(nearest - pct) <= 2 ? `DECREASE_AVG_CPC_MINUS_${Math.abs(nearest)}` : null;
  }
  return Math.abs(finalBid - oldBid) < 0.005 ? "HOLD" : null;
}

function summarizeEvidence(rows: HistoricalRow[]): CandidateEvidence[] {
  const grouped = new Map<string, HistoricalRow[]>();
  for (const row of rows) {
    const id = historicalCandidateId(row);
    if (!id) continue;
    grouped.set(id, [...(grouped.get(id) || []), row]);
  }
  return Array.from(grouped, ([candidateId, cases]) => ({
    candidateId,
    sampleCount: cases.length,
    winCount: cases.filter((item) => item.outcome_label === "POSITIVE").length,
    neutralCount: cases.filter((item) => item.outcome_label === "NEUTRAL").length,
    lossCount: cases.filter((item) => item.outcome_label === "NEGATIVE").length,
    medianRewardUsd: median(cases.map((item) => Number(item.reward_usd)).filter(Number.isFinite)),
  }));
}

export function buildAiReviewerPayload(params: {
  row: ShadowSourceRow;
  context: JsonRecord;
  candidates: ShadowCandidate[];
  evidence: CandidateEvidence[];
  effectiveMaxBid: number | null;
}): AiReviewerPayload {
  const { row, context, candidates, evidence, effectiveMaxBid } = params;
  const target = record(context.target);
  const metrics = record(context.metrics);
  const economics = record(context.economics);
  const decision = record(context.decision);
  const scenarioEvaluation = record(context.scenario_evaluation);

  const clicks = finite(metrics.clicks);
  const orders = finite(metrics.orders);
  const spend = finite(metrics.spend);
  const sales = finite(metrics.sales);
  const currentBid = finite(row.old_value);
  const avgCpc = finite(metrics.avg_cpc, currentBid);
  const ruleRecommendedBid = finite(row.system_suggested_value, currentBid);
  const ruleDir = directionFor(row);

  const ruleCandidate = candidates.find((c) => c.isRuleCandidate) || candidates[0];

  const reasonStr = String(decision.reason || "");
  const ruleIdMatch = reasonStr.match(/\[(.*?)\]\s*([^:]+):/);
  const matchedRuleId = ruleIdMatch ? ruleIdMatch[2].trim() : (ruleDir === "PAUSE" ? "PAUSE_RULE" : "UNKNOWN_RULE");

  const availableCandidates: AvailableCandidateView[] = candidates.map((c) => {
    const ev = evidence.find((e) => e.candidateId === c.id);
    return {
      id: c.id,
      direction: c.direction,
      basis: c.basis,
      adjustment_pct: c.adjustmentPct,
      bid: c.bid,
      is_rule_choice: c.isRuleCandidate,
      allowed: c.allowed,
      guardrail_reasons: c.guardrailReasons,
      sample_count: ev?.sampleCount || 0,
      win_count: ev?.winCount || 0,
      neutral_count: ev?.neutralCount || 0,
      loss_count: ev?.lossCount || 0,
      median_reward_usd: ev?.medianRewardUsd ?? null,
    };
  });
  const inferredSampleCount = availableCandidates.reduce(
    (highest, candidate) => Math.max(highest, candidate.sample_count),
    0,
  );

  return {
    target: {
      campaign_type: row.campaign_type,
      match_type: row.match_type,
      product_type: String(target.product_type || "GENERIC"),
      campaign_name: String(target.campaign_name || ""),
      keyword: String(row.target_keyword || target.target_keyword || ""),
    },
    current_state: {
      current_bid: currentBid,
      avg_cpc: avgCpc,
      effective_max_bid: effectiveMaxBid,
      clamped_at_max: effectiveMaxBid !== null && currentBid >= effectiveMaxBid,
    },
    performance: {
      clicks,
      orders,
      spend,
      sales,
      actual_acos: Number.isFinite(Number(metrics.acos)) ? Number(metrics.acos) : null,
      break_even_acos: Number.isFinite(Number(economics.break_even_acos)) ? Number(economics.break_even_acos) : null,
      selling_price: Number.isFinite(Number(economics.selling_price)) ? Number(economics.selling_price) : null,
      profit_before_ads: Number.isFinite(Number(economics.profit_before_ads)) ? Number(economics.profit_before_ads) : null,
    },
    rule_evaluation: {
      branch: orders > 0 ? "HAS_ORDER" : "NO_ORDER",
      matched_rule_id: matchedRuleId,
      rule_intent: reasonStr || `Rule proposed ${ruleDir} to $${ruleRecommendedBid}`,
      rule_selected_candidate: ruleCandidate.id,
      rule_recommended_bid: ruleRecommendedBid,
      rule_direction: ruleDir,
    },
    scenario_evaluation: {
      target_scenario: String(scenarioEvaluation.target_scenario || "OTHER"),
      acos_be_ratio: Number.isFinite(Number(scenarioEvaluation.acos_be_ratio))
        ? Number(scenarioEvaluation.acos_be_ratio)
        : null,
      retrieval_level: String(
        scenarioEvaluation.retrieval_level || (inferredSampleCount >= 20 ? "LEGACY_EVIDENCE" : "INSUFFICIENT"),
      ),
      retrieval_specificity: String(scenarioEvaluation.retrieval_specificity || "NONE"),
      sample_count: Number.isFinite(Number(scenarioEvaluation.sample_count))
        ? Number(scenarioEvaluation.sample_count)
        : inferredSampleCount,
      minimum_samples: 20,
    },
    available_candidates: availableCandidates,
    data_availability: {
      inventory: false,
      buy_box: false,
      price_events: false,
      coupon_events: false,
      budget_events: false,
      placement_events: false,
    },
  };
}

export async function runAiReviewerShadowDecisions(options: {
  storeId?: string | null;
  limit?: number;
  apply?: boolean;
  model?: string;
  skipLlmIfNoEvidence?: boolean;
} = {}) {
  const sql = await getDatabaseClient();
  const storeId = options.storeId || null;
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 5)));
  const agentVersion = PPC_AI_REVIEWER_AGENT_VERSION;
  const policyVersion = PPC_AI_REVIEWER_POLICY_VERSION;

  const rows = await sql<ShadowSourceRow[]>`
    SELECT action.id AS action_id, action.store_id, action.campaign_id, action.campaign_type,
           action.match_type, action.target_id, action.target_keyword, action.action_type, action.old_value,
           action.system_suggested_value, context.data_as_of::text, context.context
    FROM ppc_actions action
    JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE action.status IN ('APPROVED', 'QUEUED', 'EXPORTED', 'APPLIED')
      AND (${storeId}::uuid IS NULL OR action.store_id = ${storeId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM ppc_agent_decisions decision
        WHERE decision.agent_version = ${agentVersion}
          AND decision.input_snapshot->>'source_action_id' = action.id::text
      )
    ORDER BY action.created_at ASC
    LIMIT ${limit}
  `;

  const sourceStoreIds = Array.from(new Set(rows.map((row) => row.store_id)));
  const historicalRows = sourceStoreIds.length > 0
    ? await sql<(HistoricalRow & { store_id: string })[]>`
        SELECT action.store_id, action.campaign_type, action.match_type,
               action.old_value, action.final_value, outcome.outcome_label,
               outcome.comparison->>'reward_usd' AS reward_usd, context.context
        FROM ppc_action_outcomes outcome
        JOIN ppc_actions action ON action.id = outcome.action_id
        LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
        WHERE action.store_id = ANY(${sourceStoreIds})
          AND outcome.window_days = 30
          AND outcome.status = 'MATURE'
          AND COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false)
          AND outcome.evidence_quality->>'applied_on_source' = 'BULK_EXPORT'
          AND COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false)
      `
    : [];

  const results = [];

  for (const row of rows) {
    const context = parseContext(row.context);
    const metrics = record(context.metrics);
    const economics = record(context.economics);
    const currentBid = finite(row.old_value);
    const averageCpc = finite(metrics.avg_cpc, currentBid);
    const ruleBid = finite(row.system_suggested_value, currentBid);
    const target = record(context.target);
    const campaignType = row.campaign_type.toUpperCase();
    const productType = String(target.product_type || "").toLowerCase();

    const similarCases = historicalRows.filter((historical) => {
      if (historical.store_id !== row.store_id) return false;
      if (historical.campaign_type !== row.campaign_type || historical.match_type !== row.match_type) return false;
      if (!productType) return true;
      const historicalContext = historical.context ? parseContext(historical.context) : {};
      return String(record(historicalContext.target).product_type || "").toLowerCase() === productType;
    });

    const evidence = summarizeEvidence(similarCases);
    const rawMaxBid = finite(economics.max_bid);
    const maxBid = rawMaxBid > 0 && campaignType.startsWith("SB") ? rawMaxBid * 0.8 : rawMaxBid;

    const candidates = buildShadowCandidates({
      currentBid,
      averageCpc,
      ruleBid,
      ruleDirection: directionFor(row),
      maxBid: maxBid || null,
      evidence,
      minimumEvidence: 20,
    });

    const payload = buildAiReviewerPayload({
      row,
      context,
      candidates,
      evidence,
      effectiveMaxBid: maxBid || null,
    });

    // Check if we should short-circuit when zero evidence exists
    const hasAnyEvidence = evidence.some((e) => e.sampleCount > 0);
    let executionResult;

    if (options.skipLlmIfNoEvidence && !hasAnyEvidence) {
      const ruleCandidateId = payload.rule_evaluation.rule_selected_candidate;
      executionResult = {
        prompt_version: PPC_AI_REVIEWER_PROMPT_VERSION,
        model: options.model || process.env.PPC_AI_REVIEWER_MODEL || "gpt-5.6-terra",
        agent_version: agentVersion,
        policy_version: policyVersion,
        payload,
        raw_response: {
          decision: "INSUFFICIENT_EVIDENCE" as const,
          candidate_id: null,
          reason_codes: ["NO_MATURE_HISTORY_SHORT_CIRCUIT"],
          evidence_used: [],
          counter_evidence: [],
          need_more_data: true,
        },
        validation: {
          valid: true,
          status: "RULE_FALLBACK" as const,
          fallback_reason: "AI_DECISION_INSUFFICIENT_EVIDENCE",
          effective_candidate_id: ruleCandidateId,
          effective_bid: candidates.find((c) => c.id === ruleCandidateId)?.bid ?? currentBid,
          decision_source: "RULE_FALLBACK" as const,
          raw_ai_decision: null,
        },
        latency_ms: 0,
        executed_at: new Date().toISOString(),
      };
    } else {
      executionResult = await invokeAiReviewer(payload, {
        model: options.model,
      });
    }

    const targetKey = [row.campaign_id, row.target_id || row.target_keyword].join(":");
    results.push({
      row,
      context,
      targetKey,
      executionResult,
    });
  }

  if (options.apply && results.length > 0) {
    const inserts = results.map(({ row, context, targetKey, executionResult }) => ({
      store_id: row.store_id,
      resulting_action_id: null,
      target_key: targetKey,
      agent_version: agentVersion,
      policy_version: policyVersion,
      prompt_version: executionResult.prompt_version,
      data_as_of: row.data_as_of,
      input_snapshot: {
        source_action_id: row.action_id,
        source: "EXISTING_ACTION_CONTEXT",
        context,
        ai_payload: executionResult.payload,
      },
      evidence_snapshot: {
        candidate_statistics: executionResult.payload.available_candidates,
        data_availability: executionResult.payload.data_availability,
      },
      agent_response: {
        raw: executionResult.raw_response,
        model: executionResult.model,
        latency_ms: executionResult.latency_ms,
        executed_at: executionResult.executed_at,
      },
      validation_result: executionResult.validation,
    }));

    await sql.begin(async (tx) => {
      for (const insert of inserts) {
        await tx`
          INSERT INTO ppc_agent_decisions (
            store_id, resulting_action_id, target_key, agent_version, policy_version,
            prompt_version, data_as_of, input_snapshot, evidence_snapshot,
            agent_response, validation_result
          ) VALUES (
            ${insert.store_id}, ${insert.resulting_action_id}, ${insert.target_key},
            ${insert.agent_version}, ${insert.policy_version}, ${insert.prompt_version},
            ${insert.data_as_of}, ${tx.json(toJsonValue(insert.input_snapshot))},
            ${tx.json(toJsonValue(insert.evidence_snapshot))}, ${tx.json(toJsonValue(insert.agent_response))},
            ${tx.json(toJsonValue(insert.validation_result))}
          )
        `;
      }
    });
  }

  return {
    mode: options.apply ? "APPLY_SHADOW_LOG" : "DRY_RUN",
    agent_version: agentVersion,
    model: options.model || process.env.PPC_AI_REVIEWER_MODEL || "gpt-5.6-terra",
    examined: rows.length,
    logged: options.apply ? results.length : 0,
    acceptedShadow: results.filter(({ executionResult }) => executionResult.validation.status === "ACCEPTED_SHADOW").length,
    ruleFallback: results.filter(({ executionResult }) => executionResult.validation.status === "RULE_FALLBACK").length,
    invalidAiResponses: results.filter(({ executionResult }) => executionResult.validation.status === "AI_REVIEW_INVALID").length,
    createsAction: false,
    results: results.map(({ row, executionResult }) => ({
      actionId: row.action_id,
      campaignType: row.campaign_type,
      keyword: row.target_keyword,
      ruleCandidate: executionResult.payload.rule_evaluation.rule_selected_candidate,
      aiDecision: executionResult.raw_response?.decision || null,
      aiCandidate: executionResult.raw_response?.candidate_id || null,
      validationStatus: executionResult.validation.status,
      effectiveCandidate: executionResult.validation.effective_candidate_id,
      effectiveBid: executionResult.validation.effective_bid,
      latencyMs: executionResult.latency_ms,
    })),
  };
}
