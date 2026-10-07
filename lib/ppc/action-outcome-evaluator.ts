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
} from "./action-memory";
import type { UserAction } from "./bid-evaluator/types";

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
  applied_on: string;
  applied_on_source: string;
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

interface MarginResolution {
  margin: number;
  source: "ACTION_CONTEXT" | "SKU_ECONOMICS" | "STORE_COST_MASTER" | "LEGACY_FALLBACK";
  reliable: boolean;
}

function parseContext(value: JsonRecord | string | null | undefined): JsonRecord | null {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

function normalizePercentMargin(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return normalized > 0 && normalized < 1 ? normalized : null;
}

async function resolveMarginForAction(
  storeId: string | undefined,
  sku: string,
  actionContext?: JsonRecord | string | null,
): Promise<MarginResolution> {
  const context = parseContext(actionContext);
  const economics = context?.economics as JsonRecord | undefined;
  if (economics) {
    const price = Number(economics.selling_price);
    const profit = Number(economics.profit_before_ads);
    const snapshotMargin = price > 0 && Number.isFinite(profit) ? profit / price : null;
    const margin = normalizePercentMargin(snapshotMargin) ?? normalizePercentMargin(economics.break_even_acos);
    if (margin !== null) return { margin, source: "ACTION_CONTEXT", reliable: true };
  }

  const upperSku = sku.trim().toUpperCase();
  if (storeId && upperSku) {
    const sql = await getDatabaseClient();
    const skuRows = await sql<{ selling_price: string | number; profit_before_ads: string | number; break_even_acos: string | number }[]>`
      SELECT selling_price, profit_before_ads, break_even_acos
      FROM sku_economics
      WHERE store_id = ${storeId} AND UPPER(TRIM(sku)) = ${upperSku}
      LIMIT 1
    `;
    if (skuRows[0]) {
      const price = Number(skuRows[0].selling_price);
      const profit = Number(skuRows[0].profit_before_ads);
      const margin = normalizePercentMargin(price > 0 ? profit / price : null)
        ?? normalizePercentMargin(skuRows[0].break_even_acos);
      if (margin !== null) return { margin, source: "SKU_ECONOMICS", reliable: true };
    }

    const masterRows = await sql<{ break_even_acos: string | number }[]>`
      SELECT master.break_even_acos
      FROM ppc_sku_mapping_rules mapping
      CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(mapping.config_json->'prefix_rules', '[]'::jsonb))
        AS rule(prefix text, product_type text)
      JOIN product_cost_master master
        ON master.store_id = ${storeId}
       AND lower(trim(master.product_type)) = lower(trim(rule.product_type))
      WHERE mapping.rule_set_id = 'sku_to_product_type_mapping'
        AND ${upperSku} LIKE UPPER(rule.prefix) || '%'
      ORDER BY length(rule.prefix) DESC, master.version DESC
      LIMIT 1
    `;
    const masterMargin = normalizePercentMargin(masterRows[0]?.break_even_acos);
    if (masterMargin !== null) return { margin: masterMargin, source: "STORE_COST_MASTER", reliable: true };
  }

  return { margin: 0.35, source: "LEGACY_FALLBACK", reliable: false };
}

/** Backwards-compatible utility for audit scripts; production calls include storeId. */
export async function resolveMarginForSku(sku: string, storeId?: string): Promise<number> {
  return (await resolveMarginForAction(storeId, sku)).margin;
}

export function inferOutcomeUserAction(input: {
  systemSuggestedValue: string | number;
  finalValue: string | number;
  context?: JsonRecord | string | null;
}): UserAction {
  const context = parseContext(input.context);
  const decision = context?.decision as JsonRecord | undefined;
  const source = String(decision?.source || "").toUpperCase();
  if (source === "AI_AGENT" || source === "APPLY_AI") return "APPLY_AI";

  const suggested = Number(input.systemSuggestedValue);
  const finalValue = Number(input.finalValue);
  if (Number.isFinite(suggested) && Number.isFinite(finalValue) && Math.abs(finalValue - suggested) >= 0.005) {
    return "EDIT";
  }
  return "APPLY_RULE";
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
           COALESCE(
             (SELECT MIN(item.created_at)::date FROM bulk_export_items item WHERE item.action_id = action.id),
             action.approved_at::date,
             action.created_at::date,
             CURRENT_DATE
           )::text AS applied_on
    FROM ppc_actions action
    WHERE action.status IN ('EXPORTED', 'APPLIED')
      AND EXISTS (
        SELECT 1
        FROM (VALUES (3), (7), (14), (30)) as w(window_days)
        WHERE NOT EXISTS (
          SELECT 1 FROM ppc_action_outcomes outcome
          WHERE outcome.action_id = action.id AND outcome.window_days = w.window_days
        )
      )
    ORDER BY action.created_at DESC
    LIMIT ${limit}
  `;

  let seededCount = 0;
  for (const a of actions) {
    const appliedOn = a.applied_on;
    const attributionDays = (a.campaign_type || "").toUpperCase().startsWith("SB") ? 14 : 7;

    for (const windowDays of [3, 7, 14, 30]) {
      const obsStart = addDaysToIso(appliedOn, 1);
      // Amazon report dates are inclusive, so N days end at start + (N - 1).
      const obsEnd = addDaysToIso(obsStart, windowDays - 1);
      const maturity = addDaysToIso(obsEnd, attributionDays);

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
 * Looks up strictly from:
 * 1. Action context saved at recommendation time (contains exact 30d metrics before action)
 * 2. Fact table report strictly ending on or before appliedDate (report_end_date <= appliedDate)
 * Never reads reports after appliedDate for baseline.
 */
async function readBaselineFacts(
  storeId: string,
  targetId: string,
  appliedDate: string,
  actionContext?: JsonRecord | string | null,
  targetKeyword?: string
) {
  // 1. Try reading from action context if available
  if (actionContext) {
    try {
      const ctx = parseContext(actionContext);
      const baselineWindows = ctx?.baseline_windows as JsonRecord | undefined;
      const window30 = baselineWindows?.["30"] as JsonRecord | undefined;
      const window7 = baselineWindows?.["7"] as JsonRecord | undefined;
      const m = (window30?.metrics || window7?.metrics || ctx?.metrics) as JsonRecord | undefined;
      if (m && (m.spend !== undefined || m.clicks !== undefined)) {
        const clicks = Number(m.clicks || 0);
        const spend = Number(m.spend || 0);
        const sales = Number(m.sales || 0);
        const orders = Number(m.orders || 0);
        const impressions = Number(m.impressions || 0);
        const acos = sales > 0 ? (spend / sales) * 100 : null;
        return {
          clicks,
          spend,
          sales,
          orders,
          impressions,
          acos,
          days_with_data: 30,
          total_days: 30,
        };
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (!targetId && !targetKeyword) return null;
  const sql = await getDatabaseClient();

  // 2. Query exact 30d report in ppc_performance_facts ending strictly on or before appliedDate
  let rows = targetId
    ? await sql<{
        clicks: string | number;
        spend: string | number;
        sales: string | number;
        orders: string | number;
        impressions: string | number;
        days: number;
      }[]>`
        SELECT clicks, spend, sales, orders, impressions, (report_end_date - report_start_date + 1)::int as days
        FROM ppc_performance_facts
        WHERE store_id = ${storeId}
          AND grain = 'TARGET'
          AND target_id = ${targetId}
          AND (report_end_date - report_start_date + 1) >= 28
          AND report_end_date <= ${appliedDate}::date
        ORDER BY report_end_date DESC, snapshot_date DESC
        LIMIT 1
      `
    : [];

  // Fallback by target keyword / expression if targetId didn't match (still strictly <= appliedDate)
  if (rows.length === 0 && targetKeyword) {
    rows = await sql<{
      clicks: string | number;
      spend: string | number;
      sales: string | number;
      orders: string | number;
      impressions: string | number;
      days: number;
    }[]>`
      SELECT clicks, spend, sales, orders, impressions, (report_end_date - report_start_date + 1)::int as days
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND grain = 'TARGET'
        AND lower(trim(target_expression)) = lower(trim(${targetKeyword}))
        AND (report_end_date - report_start_date + 1) >= 28
        AND report_end_date <= ${appliedDate}::date
      ORDER BY report_end_date DESC, snapshot_date DESC
      LIMIT 1
    `;
  }

  if (rows.length === 0) return null;
  const r = rows[0];
  const clicks = Number(r.clicks || 0);
  const spend = Number(r.spend || 0);
  const sales = Number(r.sales || 0);
  const orders = Number(r.orders || 0);
  const impressions = Number(r.impressions || 0);
  const acos = sales > 0 ? (spend / sales) * 100 : null;

  return {
    clicks,
    spend,
    sales,
    orders,
    impressions,
    acos,
    days_with_data: 30,
    total_days: 30,
  };
}

/**
 * Reads after metrics for an exact inclusive [observationStart, observationEnd] range.
 * Never uses fallback or pro-rated metrics from arbitrary periods.
 * - 3D: exact 3D report
 * - 7D: exact 7D report
 * - 14D: exact 14D report OR sum of two adjacent non-overlapping 7D reports
 * - 30D: exact 30D report
 * If the observation window has not completed (today < observationEnd), returns null.
 */
async function readAfterFacts(
  storeId: string,
  targetId: string,
  windowDays: number,
  appliedDate: string,
  observationStart: string,
  observationEnd: string,
  today: string,
  targetKeyword?: string
) {
  if (!targetId && !targetKeyword) return null;
  // The post-change window starts the day after application and completes on
  // observationEnd (inclusive).
  if (today < observationEnd) {
    return null;
  }
  const sql = await getDatabaseClient();

  // 1. Match report for windowDays:
  // - Either exact observationStart -> observationEnd
  // - Or Amazon Ads standard report cycle: report_start_date is between appliedDate and observationStart,
  //   duration is exactly windowDays, and report_end_date <= today.
  const rows = await sql<{
    id?: string;
    clicks: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
    impressions: string | number;
    days: number;
    report_start_date: string;
    report_end_date: string;
  }[]>`
    SELECT id::text, clicks, spend, sales, orders, impressions, (report_end_date - report_start_date + 1)::int as days,
           report_start_date::text, report_end_date::text
    FROM ppc_performance_facts
    WHERE store_id = ${storeId}
      AND grain = 'TARGET'
      AND (target_id = ${targetId} OR (${targetKeyword ? sql`lower(trim(target_expression)) = lower(trim(${targetKeyword}))` : sql`false`}))
      AND (
        (report_start_date = ${observationStart}::date AND report_end_date = ${observationEnd}::date)
        OR
        (
          report_start_date > ${appliedDate}::date
          AND report_start_date <= ${observationStart}::date
          AND (report_end_date - report_start_date + 1) = ${windowDays}
          AND report_end_date <= ${today}::date
        )
      )
      AND (report_end_date - report_start_date + 1) = ${windowDays}
    ORDER BY report_end_date DESC, snapshot_date DESC
    LIMIT 1
  `;

  // 2. A 14-day result formed strictly by summing two adjacent, non-overlapping 7-day reports
  // Strictly verifies date provenance:
  // - first and second reports must be adjacent (second.start = first.end + 1)
  // - zero overlapping days (avoids rolling 7D crawler duplicate counting)
  // - combined span matches the 14-day post-action observation period
  if (rows.length === 0 && windowDays === 14) {
    const weeklyReports = await sql<{
      id: string;
      clicks: string | number;
      spend: string | number;
      sales: string | number;
      orders: string | number;
      impressions: string | number;
      report_start_date: string;
      report_end_date: string;
    }[]>`
      SELECT DISTINCT ON (report_start_date, report_end_date)
             id::text, clicks, spend, sales, orders, impressions,
             report_start_date::text, report_end_date::text
      FROM ppc_performance_facts
      WHERE store_id = ${storeId}
        AND grain = 'TARGET'
        AND (target_id = ${targetId} OR (${targetKeyword ? sql`lower(trim(target_expression)) = lower(trim(${targetKeyword}))` : sql`false`}))
        AND report_start_date > ${appliedDate}::date
        AND report_end_date <= ${today}::date
        AND (report_end_date - report_start_date + 1) = 7
      ORDER BY report_start_date, report_end_date, snapshot_date DESC;
    `;

    for (const first of weeklyReports) {
      const second = weeklyReports.find(
        (r) => r.report_start_date === addDaysToIso(first.report_end_date, 1)
      );
      if (second) {
        const totalClicks = Number(first.clicks || 0) + Number(second.clicks || 0);
        const totalSpend = Number(first.spend || 0) + Number(second.spend || 0);
        const totalSales = Number(first.sales || 0) + Number(second.sales || 0);
        const totalOrders = Number(first.orders || 0) + Number(second.orders || 0);
        return {
          clicks: totalClicks,
          spend: Number(totalSpend.toFixed(2)),
          sales: Number(totalSales.toFixed(2)),
          orders: totalOrders,
          acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : null,
          days_with_data: 14,
          total_days: 14,
          window_start: first.report_start_date,
          window_end: second.report_end_date,
          source_report_ids: [first.id, second.id].filter(Boolean),
          completeness: "FULL" as const,
          source_method: "SUM_ADJACENT_7D" as const,
        };
      }
    }
  }

  if (rows.length === 0) return null;
  const r = rows[0];
  const clicks = Number(r.clicks || 0);
  const spend = Number(r.spend || 0);
  const sales = Number(r.sales || 0);
  const orders = Number(r.orders || 0);
  const daysWithData = Number(r.days || windowDays);
  return {
    clicks,
    spend,
    sales,
    orders,
    acos: sales > 0 ? (spend / sales) * 100 : null,
    days_with_data: daysWithData,
    total_days: windowDays,
    window_start: r.report_start_date || observationStart,
    window_end: r.report_end_date || observationEnd,
    source_report_ids: r.id ? [String(r.id)] : [],
    completeness: (daysWithData >= windowDays ? "FULL" : "PARTIAL") as "FULL" | "PARTIAL",
    source_method: "EXACT_WINDOW_REPORT" as const,
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
        SELECT (report_end_date - report_start_date + 1)::int as window_days, spend, sales
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
  actionIds?: string[];
} = {}): Promise<OutcomeEvaluationSummary> {
  const sql = await getDatabaseClient();
  const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit || 1_000)));
  const today = options.today || toIsoDate(new Date());
  const actionIds = Array.from(new Set((options.actionIds || []).filter(Boolean)));

  if (options.autoSeed !== false) {
    await seedPendingOutcomesFromActions({ limit });
  }

  const rows = await sql<PendingOutcomeRow[]>`
    SELECT outcome.action_id, action.store_id, action.campaign_id, action.campaign_type,
           action.target_id, action.target_keyword, action.match_type, action.sku,
           action.old_value, action.system_suggested_value, action.final_value,
           action.status as action_status, action.approved_by,
           action.approved_at::text, action.created_at::text,
           COALESCE(
             (SELECT MIN(item.created_at)::date FROM bulk_export_items item WHERE item.action_id = action.id),
             action.approved_at::date,
             action.created_at::date,
             CURRENT_DATE
           )::text AS applied_on,
           CASE
             WHEN EXISTS (SELECT 1 FROM bulk_export_items item WHERE item.action_id = action.id) THEN 'BULK_EXPORT'
             WHEN action.approved_at IS NOT NULL THEN 'APPROVED_AT_LEGACY'
             ELSE 'CREATED_AT_LEGACY'
           END AS applied_on_source,
           outcome.window_days, outcome.observation_start::text, outcome.observation_end::text,
           outcome.maturity_date::text, context.context
    FROM ppc_action_outcomes outcome
    JOIN ppc_actions action ON action.id = outcome.action_id
    LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
    WHERE outcome.status IN ('OBSERVING', 'PROVISIONAL', 'INSUFFICIENT_DATA')
      ${actionIds.length > 0 ? sql`AND outcome.action_id = ANY(${actionIds})` : sql``}
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
    const appliedDate = row.applied_on.slice(0, 10);
    // Recalculate canonical inclusive ranges so legacy rows are normalized.
    const observationStart = addDaysToIso(appliedDate, 1);
    const observationEnd = addDaysToIso(observationStart, row.window_days - 1);
    const attributionDays = (row.campaign_type || "").toUpperCase().startsWith("SB") ? 14 : 7;
    const maturityDate = addDaysToIso(observationEnd, attributionDays);
    const marginResolution = await resolveMarginForAction(row.store_id, row.sku, row.context);
    const margin = marginResolution.margin;

    // Read metrics from facts with fallback to context / latest reports
    const baselineFacts = await readBaselineFacts(
      row.store_id,
      row.target_id,
      appliedDate,
      row.context,
      row.target_keyword
    );
    const afterFacts = await readAfterFacts(
      row.store_id,
      row.target_id,
      row.window_days,
      appliedDate,
      observationStart,
      observationEnd,
      today,
      row.target_keyword
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
             COALESCE(
               (SELECT MIN(item.created_at)::date FROM bulk_export_items item WHERE item.action_id = ppc_actions.id),
               approved_at::date,
               created_at::date,
               CURRENT_DATE
             )::text as applied_at,
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
        user_action: inferOutcomeUserAction({
          systemSuggestedValue: row.system_suggested_value,
          finalValue: row.final_value,
          context: row.context,
        }),
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

      const eligibleForLearning = evalResult.eligible_for_learning && marginResolution.reliable;
      if (eligibleForLearning) {
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
      : (baselineFacts
        ? {
          clicks: baselineFacts.clicks,
          orders: baselineFacts.orders,
          spend: baselineFacts.spend,
          sales: baselineFacts.sales,
          acos: baselineFacts.acos,
          contribution: baselineFacts.sales * margin - baselineFacts.spend,
          days: 30,
        }
        : {});

    const observedPayload = evalResult.after_metrics
      ? {
        clicks: evalResult.after_metrics.clicks,
        orders: evalResult.after_metrics.orders,
        spend: evalResult.after_metrics.ad_spend,
        sales: evalResult.after_metrics.ad_sales,
        acos: evalResult.after_metrics.acos,
        contribution: evalResult.after_metrics.contribution,
        days: row.window_days,
        window_start: afterFacts?.window_start ?? observationStart,
        window_end: afterFacts?.window_end ?? observationEnd,
        source_report_ids: afterFacts?.source_report_ids ?? [],
        completeness: afterFacts?.completeness ?? "FULL",
        source_method: afterFacts?.source_method ?? "SINGLE_REPORT",
      }
      : (afterFacts
        ? {
          clicks: afterFacts.clicks,
          orders: afterFacts.orders,
          spend: afterFacts.spend,
          sales: afterFacts.sales,
          acos: afterFacts.acos,
          contribution: afterFacts.sales * margin - afterFacts.spend,
          days: afterFacts.days_with_data || row.window_days,
          window_start: afterFacts.window_start,
          window_end: afterFacts.window_end,
          source_report_ids: afterFacts.source_report_ids,
          completeness: afterFacts.completeness,
          source_method: afterFacts.source_method,
        }
        : {});

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
      eligible_for_learning: evalResult.eligible_for_learning && marginResolution.reliable,
      end_clean_observation: evalResult.end_clean_observation ?? null,
      interrupted_by_action_id: evalResult.interrupted_by_action_id ?? null,
      superseded_by_action_id: evalResult.superseded_by_action_id || evalResult.interrupted_by_action_id || null,
      label_version: evalResult.label_version,
      evaluator_version: evalResult.evaluator_version,
      applied_on_source: row.applied_on_source,
      margin_source: marginResolution.source,
      margin_reliable: marginResolution.reliable,
      external_events_available: false,
      window_start: afterFacts?.window_start ?? observationStart,
      window_end: afterFacts?.window_end ?? observationEnd,
      source_report_ids: afterFacts?.source_report_ids ?? [],
      completeness: afterFacts?.completeness ?? (afterFacts ? "FULL" : "NONE"),
      source_method: afterFacts?.source_method ?? "NONE",
    };

    await upsertActionOutcome({
      actionId: row.action_id,
      windowDays: row.window_days,
      observationStart,
      observationEnd,
      maturityDate,
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
      AND COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false)
      AND outcome.evidence_quality->>'applied_on_source' = 'BULK_EXPORT'
      AND COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false)
      ${input.campaignType ? sql`AND action.campaign_type = ${input.campaignType}` : sql``}
      ${input.matchType ? sql`AND action.match_type = ${input.matchType}` : sql``}
      ${input.actionType ? sql`AND action.action_type = ${input.actionType}` : sql``}
    ORDER BY outcome.evaluated_at DESC
    LIMIT ${limit}
  `;
}
