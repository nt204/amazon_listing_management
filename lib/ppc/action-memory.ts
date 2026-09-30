import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type { PpcRecommendation } from "./types";

export const PPC_ACTION_CONTEXT_SCHEMA_VERSION = "v1";

export type JsonValue = null | string | number | boolean | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue | undefined };

export interface ActionContextInput {
  actionId: string;
  recommendation: PpcRecommendation;
  finalValue: number;
  approvedBy: string;
}

export interface ActionOutcomeInput {
  actionId: string;
  windowDays: number;
  observationStart: string;
  observationEnd: string;
  maturityDate?: string | null;
  status: "OBSERVING" | "PROVISIONAL" | "MATURE" | "CONTAMINATED" | "INSUFFICIENT_DATA";
  baseline?: JsonObject;
  observed?: JsonObject;
  comparison?: JsonObject;
  evidenceQuality?: JsonObject;
  outcomeLabel?: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  evaluatorVersion?: string;
  evaluatedAt?: string | null;
}

interface SourceReportRow {
  store_id: string;
  target_id: string;
  report_start_date: string;
  report_end_date: string;
  report_granularity: string;
  days: number;
  snapshot_date: string;
}

interface EconomicsSnapshotRow {
  store_id: string;
  sku: string;
  selling_price: string | number;
  base_cost: string | number;
  amazon_fee: string | number;
  tax_rate: string | number;
  profit_before_ads: string | number;
  break_even_acos: string | number;
  cr: string | number;
  cr_source: string;
  max_bid: string | number;
  cost_source: string;
  updated_at: Date | string;
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratio(numerator: number | undefined, denominator: number | undefined, multiplier = 1) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Number(denominator) <= 0) {
    return null;
  }
  return (Number(numerator) / Number(denominator)) * multiplier;
}

function safeTimestamp(value: string | undefined): string {
  if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

export function buildActionDecisionContext(input: ActionContextInput): JsonObject {
  const rec = input.recommendation;
  const cpc = finiteOrNull(rec.cpc) ?? ratio(rec.spend, rec.clicks);

  return {
    target: {
      store_id: rec.storeId,
      store_name: rec.storeName,
      campaign_id: rec.campaignId || "",
      campaign_name: rec.campaignName || "",
      ad_group_id: rec.adGroupId || "",
      ad_group_name: rec.adGroupName || "",
      target_id: rec.keywordId || "",
      target_keyword: rec.keyword,
      ad_type: rec.adType || "UNKNOWN",
      target_type: rec.targetType,
      match_type: rec.matchType || "Exact",
      sku: rec.sku || "",
      product_type: rec.productType || "",
    },
    metrics: {
      clicks: finiteOrNull(rec.clicks),
      orders: finiteOrNull(rec.orders),
      spend: finiteOrNull(rec.spend),
      sales: finiteOrNull(rec.sales),
      avg_cpc: cpc,
      acos: ratio(rec.spend, rec.sales, 100),
      roas: ratio(rec.sales, rec.spend),
      cvr: ratio(rec.orders, rec.clicks, 100),
    },
    decision: {
      recommendation_id: rec.id,
      recommendation_type: rec.recType,
      priority: rec.priority || null,
      current_bid: finiteOrNull(rec.currentBid),
      rule_proposed_bid: finiteOrNull(rec.recommendedBid),
      approved_final_bid: finiteOrNull(input.finalValue),
      rule_version: rec.ruleProfile || "v1.0",
      reason: rec.reason,
      approved_by: input.approvedBy,
    },
    provenance: {
      recommendation_created_at: safeTimestamp(rec.createdAt),
      captured_at: new Date().toISOString(),
    },
  };
}

/**
 * Sidecar writes are deliberately best-effort so a storage-only enhancement
 * cannot block the established action queue.
 */
export async function saveActionContextsBestEffort(inputs: ActionContextInput[]): Promise<void> {
  if (inputs.length === 0) return;

  try {
    const sql = await getDatabaseClient();
    const targetIds = Array.from(new Set(
      inputs.map((input) => input.recommendation.keywordId || "").filter(Boolean),
    ));
    const skus = Array.from(new Set(
      inputs.map((input) => (input.recommendation.sku || "").trim().toUpperCase()).filter(Boolean),
    ));
    const sourceRows = targetIds.length > 0
      ? await sql<SourceReportRow[]>`
          SELECT DISTINCT ON (store_id, target_id)
            store_id, target_id, report_start_date::text, report_end_date::text,
            report_granularity,
            (report_end_date - report_start_date + 1)::int AS days,
            snapshot_date::text
          FROM ppc_performance_facts
          WHERE grain = 'TARGET' AND target_id = ANY(${targetIds})
          ORDER BY store_id, target_id, snapshot_date DESC, report_end_date DESC,
                   (report_end_date - report_start_date) DESC
        `
      : [];
    const economicsRows = skus.length > 0
      ? await sql<EconomicsSnapshotRow[]>`
          SELECT store_id, UPPER(TRIM(sku)) AS sku, selling_price, base_cost,
                 amazon_fee, tax_rate, profit_before_ads, break_even_acos,
                 cr, cr_source, max_bid, cost_source, updated_at
          FROM sku_economics
          WHERE UPPER(TRIM(sku)) = ANY(${skus})
        `
      : [];
    const sourceByTarget = new Map(
      sourceRows.map((row) => [`${row.store_id}\0${row.target_id}`, row] as const),
    );
    const economicsBySku = new Map(
      economicsRows.map((row) => [`${row.store_id}\0${row.sku}`, row] as const),
    );
    const rows = inputs.map((input) => ({
      input,
      source: sourceByTarget.get(
        `${input.recommendation.storeId}\0${input.recommendation.keywordId || ""}`,
      ),
      economics: economicsBySku.get(
        `${input.recommendation.storeId}\0${(input.recommendation.sku || "").trim().toUpperCase()}`,
      ),
    })).map(({ input, source, economics }) => {
      const context = buildActionDecisionContext(input);
      if (source) {
        context.source_report = {
          report_start_date: source.report_start_date,
          report_end_date: source.report_end_date,
          report_granularity: source.report_granularity,
          days: Number(source.days),
          snapshot_date: source.snapshot_date,
        };
      }
      if (economics) {
        context.economics = {
          selling_price: Number(economics.selling_price),
          base_cost: Number(economics.base_cost),
          amazon_fee: Number(economics.amazon_fee),
          tax_rate: Number(economics.tax_rate),
          profit_before_ads: Number(economics.profit_before_ads),
          break_even_acos: Number(economics.break_even_acos),
          conversion_rate: Number(economics.cr),
          conversion_rate_source: economics.cr_source,
          max_bid: Number(economics.max_bid),
          cost_source: economics.cost_source,
          data_as_of: economics.updated_at instanceof Date
            ? economics.updated_at.toISOString()
            : String(economics.updated_at || ""),
        };
      }
      return {
        action_id: input.actionId,
        schema_version: PPC_ACTION_CONTEXT_SCHEMA_VERSION,
        decision_source: "RULE_ENGINE",
        data_as_of: safeTimestamp(input.recommendation.createdAt),
        report_start_date: source?.report_start_date || null,
        report_end_date: source?.report_end_date || null,
        context: JSON.stringify(context),
      };
    });

    await sql`
      INSERT INTO ppc_action_contexts ${sql(
        rows,
        "action_id", "schema_version", "decision_source", "data_as_of",
        "report_start_date", "report_end_date", "context"
      )}
      ON CONFLICT (action_id) DO NOTHING
    `;
  } catch (error) {
    console.warn("[PPC action memory] Could not save decision context; action queue is unchanged.", error);
  }
}

export async function appendActionEvent(input: {
  actionId: string;
  eventType: string;
  actorType?: string;
  actorId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  eventData?: JsonObject;
}): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO ppc_action_events (
      action_id, event_type, actor_type, actor_id, from_status, to_status, event_data
    ) VALUES (
      ${input.actionId}, ${input.eventType}, ${input.actorType || "SYSTEM"},
      ${input.actorId || null}, ${input.fromStatus || null}, ${input.toStatus || null},
      ${sql.json(input.eventData || {})}
    )
  `;
}

export async function upsertActionOutcome(input: ActionOutcomeInput): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO ppc_action_outcomes (
      action_id, window_days, observation_start, observation_end, maturity_date,
      status, baseline, observed, comparison, evidence_quality, outcome_label,
      evaluator_version, evaluated_at
    ) VALUES (
      ${input.actionId}, ${input.windowDays}, ${input.observationStart}, ${input.observationEnd},
      ${input.maturityDate || null}, ${input.status}, ${sql.json(input.baseline || {})},
      ${sql.json(input.observed || {})}, ${sql.json(input.comparison || {})},
      ${sql.json(input.evidenceQuality || {})}, ${input.outcomeLabel || null},
      ${input.evaluatorVersion || "outcome-v1"}, ${input.evaluatedAt || null}
    )
    ON CONFLICT (action_id, window_days) DO UPDATE SET
      observation_start = EXCLUDED.observation_start,
      observation_end = EXCLUDED.observation_end,
      maturity_date = EXCLUDED.maturity_date,
      status = EXCLUDED.status,
      baseline = EXCLUDED.baseline,
      observed = EXCLUDED.observed,
      comparison = EXCLUDED.comparison,
      evidence_quality = EXCLUDED.evidence_quality,
      outcome_label = EXCLUDED.outcome_label,
      evaluator_version = EXCLUDED.evaluator_version,
      evaluated_at = EXCLUDED.evaluated_at,
      updated_at = NOW()
  `;
}
