import "server-only";

import { getDatabaseClient } from "@/lib/db";
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
  target_id: string;
  target_keyword: string;
  match_type: string;
  window_days: number;
  observation_start: string;
  observation_end: string;
  maturity_date: string | null;
  context: JsonRecord | string | null;
}

interface Metrics {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
  acos: number | null;
  roas: number | null;
  cvr: number | null;
  avgCpc: number | null;
}

interface RawMetricRow extends Record<string, unknown> {
  complete_days?: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  units: number;
}

export interface OutcomeEvaluationSummary {
  examined: number;
  observing: number;
  provisional: number;
  mature: number;
  contaminated: number;
  insufficientData: number;
}

function jsonRecord(value: JsonRecord | string | null | undefined): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value;
}

function nestedRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentageChange(before: number | null, after: number | null): number | null {
  if (before == null || after == null || before === 0) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateHasPassed(date: string, today: string): boolean {
  return date < today;
}

function metricsFromContext(context: JsonRecord): Metrics | null {
  const raw = nestedRecord(context.metrics);
  const clicks = numberOrNull(raw.clicks);
  const spend = numberOrNull(raw.spend);
  const sales = numberOrNull(raw.sales);
  const orders = numberOrNull(raw.orders);
  if (clicks == null || spend == null || sales == null || orders == null) return null;
  return {
    impressions: numberOrNull(raw.impressions) || 0,
    clicks,
    spend,
    sales,
    orders,
    units: numberOrNull(raw.units) || 0,
    acos: numberOrNull(raw.acos),
    roas: numberOrNull(raw.roas),
    cvr: numberOrNull(raw.cvr),
    avgCpc: numberOrNull(raw.avg_cpc),
  };
}

function metricPayload(metrics: Metrics, days: number): JsonObject {
  return {
    ...metrics,
    days,
    spend_per_day: metrics.spend / days,
    sales_per_day: metrics.sales / days,
    orders_per_day: metrics.orders / days,
    clicks_per_day: metrics.clicks / days,
  };
}

export function classifyOutcome(
  baseline: Metrics,
  baselineDays: number,
  observed: Metrics,
  observedDays: number,
  breakEvenAcos: number | null,
): "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null {
  if (breakEvenAcos == null || breakEvenAcos <= 0) return null;
  const before = (baseline.sales / baselineDays) * (breakEvenAcos / 100) - baseline.spend / baselineDays;
  const after = (observed.sales / observedDays) * (breakEvenAcos / 100) - observed.spend / observedDays;
  const delta = percentageChange(before, after);
  if (delta == null) return null;
  const orderDelta = percentageChange(baseline.orders / baselineDays, observed.orders / observedDays);
  if (delta > 5 && (orderDelta == null || orderDelta > -30)) return "POSITIVE";
  if (delta < -5 || (orderDelta != null && orderDelta < -30)) return "NEGATIVE";
  return "NEUTRAL";
}

async function readObservedMetrics(row: PendingOutcomeRow): Promise<{
  metrics: Metrics | null;
  source: string | null;
  completeDays: number;
}> {
  const sql = await getDatabaseClient();
  const daily = await sql<RawMetricRow[]>`
    WITH latest_daily AS (
      SELECT DISTINCT ON (report_start_date, identity_key)
        report_start_date, identity_key, impressions, clicks, spend, sales, orders, units
      FROM ppc_performance_facts
      WHERE store_id = ${row.store_id}
        AND grain = 'TARGET'
        AND report_granularity = 'DAILY'
        AND target_id = ${row.target_id}
        AND report_start_date = report_end_date
        AND report_start_date BETWEEN ${row.observation_start} AND ${row.observation_end}
      ORDER BY report_start_date, identity_key, snapshot_date DESC, updated_at DESC
    )
    SELECT COUNT(DISTINCT report_start_date)::int AS complete_days,
           COALESCE(SUM(impressions), 0)::float8 AS impressions,
           COALESCE(SUM(clicks), 0)::float8 AS clicks,
           COALESCE(SUM(spend), 0)::float8 AS spend,
           COALESCE(SUM(sales), 0)::float8 AS sales,
           COALESCE(SUM(orders), 0)::float8 AS orders,
           COALESCE(SUM(units), 0)::float8 AS units
    FROM latest_daily
  `;
  if (Number(daily[0]?.complete_days || 0) >= row.window_days) {
    return {
      metrics: calculateMetrics(daily[0]),
      source: "DAILY_TARGET",
      completeDays: Number(daily[0].complete_days),
    };
  }

  const exactRange = await sql<RawMetricRow[]>`
    SELECT impressions::float8, clicks::float8, spend::float8, sales::float8,
           orders::float8, units::float8
    FROM ppc_performance_facts
    WHERE store_id = ${row.store_id}
      AND grain = 'TARGET'
      AND report_granularity = 'RANGE'
      AND target_id = ${row.target_id}
      AND report_start_date = ${row.observation_start}
      AND report_end_date = ${row.observation_end}
    ORDER BY snapshot_date DESC, updated_at DESC
    LIMIT 1
  `;
  return exactRange[0]
    ? { metrics: calculateMetrics(exactRange[0]), source: "EXACT_RANGE_TARGET", completeDays: row.window_days }
    : { metrics: null, source: null, completeDays: Number(daily[0]?.complete_days || 0) };
}

function calculateMetrics(row: Record<string, unknown>): Metrics {
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const spend = Number(row.spend || 0);
  const sales = Number(row.sales || 0);
  const orders = Number(row.orders || 0);
  return {
    impressions,
    clicks,
    spend,
    sales,
    orders,
    units: Number(row.units || 0),
    acos: sales > 0 ? (spend / sales) * 100 : null,
    roas: spend > 0 ? sales / spend : null,
    cvr: clicks > 0 ? (orders / clicks) * 100 : null,
    avgCpc: clicks > 0 ? spend / clicks : null,
  };
}

async function hasOverlappingAction(row: PendingOutcomeRow): Promise<boolean> {
  const sql = await getDatabaseClient();
  const overlap = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM ppc_actions other
      JOIN ppc_action_events event
        ON event.action_id = other.id AND event.event_type = 'AMAZON_APPLIED'
      WHERE other.id <> ${row.action_id}
        AND other.store_id = ${row.store_id}
        AND other.campaign_id = ${row.campaign_id}
        AND (
          (${row.target_id} <> '' AND other.target_id = ${row.target_id}) OR
          (${row.target_id} = '' AND other.target_keyword = ${row.target_keyword} AND other.match_type = ${row.match_type})
        )
        AND event.created_at::date BETWEEN ${row.observation_start} AND ${row.observation_end}
    ) AS exists
  `;
  return Boolean(overlap[0]?.exists);
}

export async function evaluatePendingActionOutcomes(options: {
  limit?: number;
  today?: string;
} = {}): Promise<OutcomeEvaluationSummary> {
  const sql = await getDatabaseClient();
  const limit = Math.max(1, Math.min(2_000, Math.floor(options.limit || 500)));
  const today = options.today || toIsoDate(new Date());
  const rows = await sql<PendingOutcomeRow[]>`
    SELECT outcome.action_id, action.store_id, action.campaign_id, action.target_id,
           action.target_keyword, action.match_type, outcome.window_days,
           outcome.observation_start::text, outcome.observation_end::text,
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
  };

  for (const row of rows) {
    const base: Omit<ActionOutcomeInput, "status"> = {
      actionId: row.action_id,
      windowDays: row.window_days,
      observationStart: row.observation_start,
      observationEnd: row.observation_end,
      maturityDate: row.maturity_date,
      evaluatorVersion: "outcome-v1",
    };
    if (!dateHasPassed(row.observation_end, today)) {
      await upsertActionOutcome({ ...base, status: "OBSERVING" });
      summary.observing += 1;
      continue;
    }
    if (row.maturity_date && !dateHasPassed(row.maturity_date, today)) {
      await upsertActionOutcome({ ...base, status: "PROVISIONAL" });
      summary.provisional += 1;
      continue;
    }
    if (await hasOverlappingAction(row)) {
      await upsertActionOutcome({
        ...base,
        status: "CONTAMINATED",
        evidenceQuality: { reason: "OVERLAPPING_APPLIED_ACTION" },
        evaluatedAt: new Date().toISOString(),
      });
      summary.contaminated += 1;
      continue;
    }

    const context = jsonRecord(row.context);
    const baseline = metricsFromContext(context);
    const observedResult = await readObservedMetrics(row);
    const sourceReport = nestedRecord(context.source_report);
    const baselineDays = numberOrNull(sourceReport.days);
    if (!baseline || !baselineDays || baselineDays <= 0 || !observedResult.metrics) {
      await upsertActionOutcome({
        ...base,
        status: "INSUFFICIENT_DATA",
        baseline: baseline ? metricPayload(baseline, baselineDays || 1) : {},
        observed: observedResult.metrics ? metricPayload(observedResult.metrics, row.window_days) : {},
        evidenceQuality: {
          reason: !baseline ? "MISSING_BASELINE" : !baselineDays ? "UNKNOWN_BASELINE_WINDOW" : "MISSING_EXACT_OBSERVATION_WINDOW",
          complete_days: observedResult.completeDays,
          required_days: row.window_days,
          source: observedResult.source,
        },
        evaluatedAt: new Date().toISOString(),
      });
      summary.insufficientData += 1;
      continue;
    }

    const economics = nestedRecord(context.economics);
    const breakEvenAcos = numberOrNull(economics.break_even_acos);
    const observed = observedResult.metrics;
    const comparison = {
      spend_per_day_pct: percentageChange(baseline.spend / baselineDays, observed.spend / row.window_days),
      sales_per_day_pct: percentageChange(baseline.sales / baselineDays, observed.sales / row.window_days),
      orders_per_day_pct: percentageChange(baseline.orders / baselineDays, observed.orders / row.window_days),
      acos_pct: percentageChange(baseline.acos, observed.acos),
    };
    await upsertActionOutcome({
      ...base,
      status: "MATURE",
      baseline: metricPayload(baseline, baselineDays),
      observed: metricPayload(observed, row.window_days),
      comparison,
      evidenceQuality: {
        source: observedResult.source,
        complete_days: observedResult.completeDays,
        required_days: row.window_days,
        attribution_mature: true,
        overlapping_action: false,
        label_available: breakEvenAcos != null,
      },
      outcomeLabel: classifyOutcome(baseline, baselineDays, observed, row.window_days, breakEvenAcos),
      evaluatedAt: new Date().toISOString(),
    });
    summary.mature += 1;
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
    JOIN ppc_action_contexts context ON context.action_id = action.id
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
