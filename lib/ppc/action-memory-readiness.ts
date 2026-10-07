import "server-only";

import { getDatabaseClient } from "@/lib/db";

export const DEFERRED_PPC_EXTERNAL_EVENTS = [
  "PRICE_CHANGE",
  "COUPON_OR_DEAL",
  "STOCKOUT",
  "BUY_BOX_LOST",
  "BUDGET_CHANGE",
  "PLACEMENT_CHANGE",
] as const;

export interface ActionMemoryReadinessReport {
  storeId: string | null;
  actions: {
    exportedOrApplied: number;
    withBulkExportTimestamp: number;
    withContext: number;
    ruleDecisions: number;
    userEdits: number;
    aiDecisions: number;
  };
  outcomes: {
    total: number;
    observing: number;
    provisional: number;
    mature: number;
    interrupted: number;
    contaminated: number;
    insufficientData: number;
    eligibleForLearning: number;
    cleanForAgentMemory: number;
    legacyTimestamp: number;
    unreliableMargin: number;
  };
  labels: {
    positive: number;
    neutral: number;
    negative: number;
  };
  deferredExternalEvents: readonly string[];
}

interface CountRow {
  exported_or_applied: number;
  with_bulk_export_timestamp: number;
  with_context: number;
  rule_decisions: number;
  user_edits: number;
  ai_decisions: number;
}

interface OutcomeCountRow {
  total: number;
  observing: number;
  provisional: number;
  mature: number;
  interrupted: number;
  contaminated: number;
  insufficient_data: number;
  eligible_for_learning: number;
  clean_for_agent_memory: number;
  legacy_timestamp: number;
  unreliable_margin: number;
  positive: number;
  neutral: number;
  negative: number;
}

export async function getActionMemoryReadinessReport(
  storeId?: string | null,
): Promise<ActionMemoryReadinessReport> {
  const sql = await getDatabaseClient();
  const storeFilter = storeId || null;

  const actionRows = await sql<CountRow[]>`
    SELECT
      COUNT(*)::int AS exported_or_applied,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM bulk_export_items item WHERE item.action_id = action.id
      ))::int AS with_bulk_export_timestamp,
      COUNT(*) FILTER (WHERE context.action_id IS NOT NULL)::int AS with_context,
      COUNT(*) FILTER (WHERE
        COALESCE(context.decision_source, '') NOT IN ('AI_AGENT', 'USER_EDIT')
        AND ABS(COALESCE(action.final_value, 0) - COALESCE(action.system_suggested_value, 0)) < 0.005
      )::int AS rule_decisions,
      COUNT(*) FILTER (WHERE
        context.decision_source = 'USER_EDIT'
        OR ABS(COALESCE(action.final_value, 0) - COALESCE(action.system_suggested_value, 0)) >= 0.005
      )::int AS user_edits,
      COUNT(*) FILTER (WHERE context.decision_source = 'AI_AGENT')::int AS ai_decisions
    FROM ppc_actions action
    LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE action.status IN ('EXPORTED', 'APPLIED')
      AND (${storeFilter}::uuid IS NULL OR action.store_id = ${storeFilter}::uuid)
  `;

  const outcomeRows = await sql<OutcomeCountRow[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE outcome.status = 'OBSERVING')::int AS observing,
      COUNT(*) FILTER (WHERE outcome.status = 'PROVISIONAL')::int AS provisional,
      COUNT(*) FILTER (WHERE outcome.status = 'MATURE')::int AS mature,
      COUNT(*) FILTER (WHERE outcome.status IN ('INTERRUPTED', 'SUPERSEDED'))::int AS interrupted,
      COUNT(*) FILTER (WHERE outcome.status = 'CONTAMINATED')::int AS contaminated,
      COUNT(*) FILTER (WHERE outcome.status = 'INSUFFICIENT_DATA')::int AS insufficient_data,
      COUNT(*) FILTER (WHERE COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false))::int
        AS eligible_for_learning,
      COUNT(*) FILTER (WHERE
        outcome.status = 'MATURE'
        AND COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false)
        AND outcome.evidence_quality->>'applied_on_source' = 'BULK_EXPORT'
        AND COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false)
      )::int AS clean_for_agent_memory,
      COUNT(*) FILTER (WHERE COALESCE(outcome.evidence_quality->>'applied_on_source', '') <> 'BULK_EXPORT')::int
        AS legacy_timestamp,
      COUNT(*) FILTER (WHERE NOT COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false))::int
        AS unreliable_margin,
      COUNT(*) FILTER (WHERE outcome.outcome_label = 'POSITIVE')::int AS positive,
      COUNT(*) FILTER (WHERE outcome.outcome_label = 'NEUTRAL')::int AS neutral,
      COUNT(*) FILTER (WHERE outcome.outcome_label = 'NEGATIVE')::int AS negative
    FROM ppc_action_outcomes outcome
    JOIN ppc_actions action ON action.id = outcome.action_id
    WHERE action.status IN ('EXPORTED', 'APPLIED')
      AND (${storeFilter}::uuid IS NULL OR action.store_id = ${storeFilter}::uuid)
  `;

  const actions = actionRows[0] || {} as CountRow;
  const outcomes = outcomeRows[0] || {} as OutcomeCountRow;
  return {
    storeId: storeFilter,
    actions: {
      exportedOrApplied: Number(actions.exported_or_applied || 0),
      withBulkExportTimestamp: Number(actions.with_bulk_export_timestamp || 0),
      withContext: Number(actions.with_context || 0),
      ruleDecisions: Number(actions.rule_decisions || 0),
      userEdits: Number(actions.user_edits || 0),
      aiDecisions: Number(actions.ai_decisions || 0),
    },
    outcomes: {
      total: Number(outcomes.total || 0),
      observing: Number(outcomes.observing || 0),
      provisional: Number(outcomes.provisional || 0),
      mature: Number(outcomes.mature || 0),
      interrupted: Number(outcomes.interrupted || 0),
      contaminated: Number(outcomes.contaminated || 0),
      insufficientData: Number(outcomes.insufficient_data || 0),
      eligibleForLearning: Number(outcomes.eligible_for_learning || 0),
      cleanForAgentMemory: Number(outcomes.clean_for_agent_memory || 0),
      legacyTimestamp: Number(outcomes.legacy_timestamp || 0),
      unreliableMargin: Number(outcomes.unreliable_margin || 0),
    },
    labels: {
      positive: Number(outcomes.positive || 0),
      neutral: Number(outcomes.neutral || 0),
      negative: Number(outcomes.negative || 0),
    },
    deferredExternalEvents: DEFERRED_PPC_EXTERNAL_EVENTS,
  };
}

export async function findOutcomeBackfillCandidates(options: {
  storeId?: string | null;
  limit?: number;
} = {}): Promise<string[]> {
  const sql = await getDatabaseClient();
  const storeFilter = options.storeId || null;
  const limit = Math.max(1, Math.min(2_000, Math.floor(options.limit || 100)));
  const rows = await sql<{ id: string }[]>`
    SELECT action.id
    FROM ppc_actions action
    WHERE action.status IN ('EXPORTED', 'APPLIED')
      AND action.target_id <> ''
      AND (${storeFilter}::uuid IS NULL OR action.store_id = ${storeFilter}::uuid)
      AND EXISTS (SELECT 1 FROM bulk_export_items item WHERE item.action_id = action.id)
      AND EXISTS (
        SELECT 1
        FROM ppc_action_outcomes outcome
        WHERE outcome.action_id = action.id
          AND (
            COALESCE(outcome.evidence_quality->>'applied_on_source', '') <> 'BULK_EXPORT'
            OR COALESCE(outcome.evidence_quality->>'margin_source', '') = ''
          )
      )
    ORDER BY (
      SELECT MIN(item.created_at) FROM bulk_export_items item WHERE item.action_id = action.id
    ) ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.id);
}

export async function requeueActionOutcomesForBackfill(actionIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(actionIds.filter(Boolean)));
  if (uniqueIds.length === 0) return 0;

  const sql = await getDatabaseClient();
  return sql.begin(async (tx) => {
    const updated = await tx<{ action_id: string }[]>`
      UPDATE ppc_action_outcomes outcome
      SET status = 'OBSERVING',
          baseline = '{}'::jsonb,
          observed = '{}'::jsonb,
          comparison = '{}'::jsonb,
          evidence_quality = jsonb_build_object(
            'requeued_by', 'ppc-action-memory-readiness',
            'requeued_at', NOW()
          ),
          outcome_label = NULL,
          evaluated_at = NULL,
          updated_at = NOW()
      WHERE outcome.action_id = ANY(${uniqueIds})
      RETURNING outcome.action_id
    `;

    await tx`
      INSERT INTO ppc_action_events (
        action_id, event_type, actor_type, event_data
      )
      SELECT id, 'OUTCOME_REQUEUED', 'SYSTEM', jsonb_build_object(
        'source', 'ppc-action-memory-readiness',
        'reason', 'recompute_with_bulk_export_timestamp_and_store_margin'
      )
      FROM ppc_actions
      WHERE id = ANY(${uniqueIds})
    `;

    return updated.length;
  });
}
