import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type { AiReviewerPayload } from "./ai-reviewer";
import {
  buildReviewerInputs,
  historicalCandidateId,
  parseContext,
  record,
  selectSimilarCases,
  type HistoricalRow,
  type ShadowSourceRow,
} from "./ai-reviewer-service";

type JsonRecord = Record<string, unknown>;

// Offline replay dataset for the reviewer harness (P2).
// Every case is rebuilt only from information that existed at its data_as_of:
// the decision context snapshotted when the action was created, and evidence
// from outcomes that had matured before that moment. Cases whose as-of inputs
// cannot be trusted are excluded instead of being filled with current data.

export const REPLAY_DATASET_VERSION = "replay-v1";
// A context written this long after data_as_of may have been backfilled with newer data.
export const MAX_CONTEXT_WRITE_DELAY_MS = 2 * 24 * 60 * 60 * 1_000;

export type ReplaySplit = "train" | "dev" | "test";
export type OutcomeLabel = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export type ReplayExclusionReason =
  | "MISSING_CONTEXT"
  | "CONTEXT_WRITTEN_LATE"
  | "MISSING_CORE_METRICS"
  | "INVALID_DATA_AS_OF";

/** One eligible, mature 30D outcome. Each row is both a potential case and evidence for later cases. */
export interface ReplaySourceRow extends ShadowSourceRow {
  final_value: string | number;
  context_created_at: string | null;
  outcome_label: OutcomeLabel;
  reward_usd: string | number | null;
  maturity_date: string;
}

export interface ReplayCase {
  actionId: string;
  storeId: string;
  dataAsOf: string;
  split: ReplaySplit;
  payload: AiReviewerPayload;
  ruleCandidateId: string;
  // Candidate that was actually applied, or null when old→final cannot be mapped to a candidate.
  appliedCandidateId: string | null;
  outcome: { label: OutcomeLabel; rewardUsd: number | null };
  evidenceCutoffDate: string;
  evidenceActionIds: string[];
}

export interface ReplayDataset {
  version: string;
  builtAt: string;
  cases: ReplayCase[];
  excluded: { actionId: string; reason: ReplayExclusionReason }[];
  splitCounts: Record<ReplaySplit, number>;
}

function isoDate(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function exclusionReason(row: ReplaySourceRow, context: JsonRecord | null): ReplayExclusionReason | null {
  if (!context || !row.data_as_of) return "MISSING_CONTEXT";
  const asOf = Date.parse(row.data_as_of);
  if (!Number.isFinite(asOf)) return "INVALID_DATA_AS_OF";
  const writtenAt = row.context_created_at ? Date.parse(row.context_created_at) : NaN;
  if (!Number.isFinite(writtenAt) || writtenAt - asOf > MAX_CONTEXT_WRITE_DELAY_MS) return "CONTEXT_WRITTEN_LATE";
  const metrics = record(context.metrics);
  if (!Number.isFinite(Number(metrics.clicks)) || !Number.isFinite(Number(row.old_value))) return "MISSING_CORE_METRICS";
  return null;
}

/** Chronological split: oldest cases train, newest cases are held out for the release test. */
export function assignSplits<T extends { dataAsOf: string }>(
  items: T[],
  fractions: { train: number; dev: number } = { train: 0.6, dev: 0.2 },
): (T & { split: ReplaySplit })[] {
  const sorted = [...items].sort((a, b) => a.dataAsOf.localeCompare(b.dataAsOf));
  const trainEnd = Math.floor(sorted.length * fractions.train);
  const devEnd = Math.floor(sorted.length * (fractions.train + fractions.dev));
  return sorted.map((item, index) => ({
    ...item,
    split: index < trainEnd ? "train" : index < devEnd ? "dev" : "test",
  }));
}

export function buildReplayDataset(rows: ReplaySourceRow[], builtAt = new Date().toISOString()): ReplayDataset {
  const excluded: ReplayDataset["excluded"] = [];
  const unsplit: Omit<ReplayCase, "split">[] = [];

  for (const row of rows) {
    const context = row.context ? parseContext(row.context) : null;
    const reason = exclusionReason(row, context);
    if (reason || !context) {
      excluded.push({ actionId: row.action_id, reason: reason || "MISSING_CONTEXT" });
      continue;
    }

    const asOfDate = isoDate(row.data_as_of) as string;
    // Only outcomes that had already matured before this decision could have been known.
    const knownOutcomes = rows.filter((other) => (
      other.action_id !== row.action_id && other.maturity_date < asOfDate
    ));
    const similarCases = selectSimilarCases(row, context, knownOutcomes);
    const { payload } = buildReviewerInputs({ row, context, similarCases: similarCases as HistoricalRow[] });

    const rewardUsd = row.reward_usd === null ? null : Number(row.reward_usd);
    unsplit.push({
      actionId: row.action_id,
      storeId: row.store_id,
      dataAsOf: row.data_as_of,
      payload,
      ruleCandidateId: payload.rule_evaluation.rule_selected_candidate,
      appliedCandidateId: historicalCandidateId(row),
      outcome: { label: row.outcome_label, rewardUsd: Number.isFinite(rewardUsd) ? rewardUsd : null },
      evidenceCutoffDate: asOfDate,
      evidenceActionIds: similarCases.map((item) => item.action_id),
    });
  }

  const cases = assignSplits(unsplit);
  return {
    version: REPLAY_DATASET_VERSION,
    builtAt,
    cases,
    excluded,
    splitCounts: {
      train: cases.filter((item) => item.split === "train").length,
      dev: cases.filter((item) => item.split === "dev").length,
      test: cases.filter((item) => item.split === "test").length,
    },
  };
}

/** Read-only: loads every learning-eligible mature 30D outcome with its decision-time context. */
export async function loadReplaySourceRows(options: { storeId?: string | null } = {}): Promise<ReplaySourceRow[]> {
  const sql = await getDatabaseClient();
  const storeId = options.storeId || null;
  return sql<ReplaySourceRow[]>`
    SELECT action.id AS action_id, action.store_id, action.campaign_id, action.campaign_type,
           action.match_type, action.target_id, action.target_keyword, action.action_type,
           action.old_value, action.system_suggested_value, action.final_value,
           context.data_as_of::text AS data_as_of, context.created_at::text AS context_created_at,
           context.context, outcome.outcome_label, outcome.comparison->>'reward_usd' AS reward_usd,
           outcome.maturity_date::text AS maturity_date
    FROM ppc_action_outcomes outcome
    JOIN ppc_actions action ON action.id = outcome.action_id
    LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE outcome.window_days = 30
      AND outcome.status = 'MATURE'
      AND outcome.outcome_label IS NOT NULL
      AND outcome.maturity_date IS NOT NULL
      AND COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false)
      AND outcome.evidence_quality->>'applied_on_source' = 'BULK_EXPORT'
      AND COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false)
      AND (${storeId}::uuid IS NULL OR action.store_id = ${storeId}::uuid)
    ORDER BY context.data_as_of ASC NULLS LAST, action.id ASC
  `;
}
