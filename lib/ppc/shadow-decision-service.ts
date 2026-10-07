import "server-only";

import { getDatabaseClient } from "@/lib/db";
import {
  evaluateShadowDecision,
  type CandidateEvidence,
  type ShadowDirection,
} from "./shadow-decision-engine";

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

export async function runShadowDecisions(options: {
  storeId?: string | null;
  limit?: number;
  apply?: boolean;
} = {}) {
  const sql = await getDatabaseClient();
  const storeId = options.storeId || null;
  const limit = Math.max(1, Math.min(1_000, Math.floor(options.limit || 100)));
  const agentVersion = "shadow-deterministic-v1";
  const policyVersion = "bounded-candidates-v1";

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

  const decisions = rows.map((row) => {
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
    const result = evaluateShadowDecision({
      currentBid,
      averageCpc,
      ruleBid,
      ruleDirection: directionFor(row),
      maxBid: maxBid || null,
      evidence,
      minimumEvidence: 20,
    });
    const targetKey = [row.campaign_id, row.target_id || row.target_keyword].join(":");
    return { row, context, result, targetKey, similarCaseCount: similarCases.length };
  });

  if (options.apply && decisions.length > 0) {
    const inserts = decisions.map(({ row, context, result, targetKey, similarCaseCount }) => ({
      store_id: row.store_id,
      resulting_action_id: null,
      target_key: targetKey,
      agent_version: agentVersion,
      policy_version: policyVersion,
      prompt_version: null,
      data_as_of: row.data_as_of,
      input_snapshot: {
        source_action_id: row.action_id,
        source: "EXISTING_ACTION_CONTEXT",
        context,
      },
      evidence_snapshot: {
        historical_case_count: similarCaseCount,
        candidate_statistics: result.evidence,
        evidence_status: result.reasonCode,
        external_events_available: false,
      },
      agent_response: result,
      validation_result: {
        valid: true,
        shadow_only: true,
        creates_action: false,
        changes_bid: false,
      },
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
    examined: rows.length,
    logged: options.apply ? decisions.length : 0,
    ruleFallback: decisions.filter(({ result }) => result.status === "RULE_FALLBACK").length,
    readyForAgentReview: decisions.filter(({ result }) => result.status === "READY_FOR_AGENT_REVIEW").length,
    createsAction: false,
  };
}
