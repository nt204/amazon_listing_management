import { NextResponse } from "next/server";
import { ApiError, authorize, dataScope, enforceRateLimit, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import type { PpcRecommendation } from "@/lib/ppc/types";
import {
  buildShadowCandidates,
  type CandidateEvidence,
  type ShadowDirection,
} from "@/lib/ppc/shadow-decision-engine";
import {
  buildAiReviewerPayload,
} from "@/lib/ppc/ai-reviewer-service";
import {
  invokeAiReviewer,
} from "@/lib/ppc/ai-reviewer";

import {
  deriveTargetScenario,
  performHierarchicalRetrieval,
  type HistoricalScenarioContext,
  type PpcTargetScenario,
} from "@/lib/ppc/scenario-classifier";

export const maxDuration = 60; // Allow sufficient time for gpt-5.6-terra

interface HistoricalRow {
  campaign_type: string;
  match_type: string;
  old_value: string | number;
  final_value: string | number;
  outcome_label: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  reward_usd: string | number | null;
  context: Record<string, unknown> | string | null;
}

function parseContext(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function historicalCandidateId(row: HistoricalRow): string | null {
  const context = parseContext(row.context);
  const metrics = (context.metrics || {}) as Record<string, unknown>;
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

function summarizeScenarioEvidence(cases: HistoricalScenarioContext[]): CandidateEvidence[] {
  const grouped = new Map<string, HistoricalScenarioContext[]>();
  for (const c of cases) {
    if (!c.candidateId) continue;
    grouped.set(c.candidateId, [...(grouped.get(c.candidateId) || []), c]);
  }
  return Array.from(grouped, ([candidateId, items]) => ({
    candidateId,
    sampleCount: items.length,
    winCount: items.filter((item) => item.outcomeLabel === "POSITIVE").length,
    neutralCount: items.filter((item) => item.outcomeLabel === "NEUTRAL").length,
    lossCount: items.filter((item) => item.outcomeLabel === "NEGATIVE").length,
    medianRewardUsd: median(items.map((item) => Number(item.rewardUsd)).filter(Number.isFinite)),
  }));
}

import { getSkuEconomicsList, getCostMasters } from "@/lib/ppc/sku-architecture-service";
import { extractSkuFromText } from "@/lib/ppc/sku-extractor";

function extractCampaignFamily(text: string | undefined, defaultType = "SP03"): string {
  const match = String(text || "").match(/\b(SP03|SB01|SB05|SP01)\b/i);
  if (match) return match[1].toUpperCase();
  return defaultType;
}

export async function POST(req: Request) {
  try {
    const actor = await authorize(req, "read", "ppc");
    const scope = dataScope(actor);
    await enforceRateLimit(actor, "ppc-ai-review", 10, 60);
    const body = await req.json();
    const rec: PpcRecommendation = body.recommendation;

    if (!rec || !rec.id) {
      return NextResponse.json({ error: "Missing recommendation in request body" }, { status: 400 });
    }

    const sql = await getDatabaseClient();
    const requestedStore = String(rec.storeId || rec.storeName || "").trim();
    if (!requestedStore) {
      throw new ApiError("Recommendation is missing its PPC store.", 400);
    }

    const accessibleStores = await sql<{ id: string; target_acos?: string | number }[]>`
      SELECT id, target_acos
      FROM ppc_stores
      WHERE team_id = ${scope.teamId}
        AND (id::text = ${requestedStore} OR lower(name) = lower(${requestedStore}))
      LIMIT 1
    `;
    const storeId = accessibleStores[0]?.id || null;
    const storeTargetAcos = Number(accessibleStores[0]?.target_acos) > 0 ? Number(accessibleStores[0]?.target_acos) : 30;
    if (!storeId) {
      throw new ApiError("PPC store not found or access denied.", 404);
    }
    const rawSku = (
      rec.sku ||
      extractSkuFromText(rec.campaignName) ||
      (rec.campaignName ? rec.campaignName.trim().split(/\s+/)[0] : "")
    ).trim();
    const sku = rawSku.toUpperCase();

    // 1. Fetch SKU Economics via unified service (cached in Redis) with Phôi fallback
    let economics: Record<string, unknown> = {};
    if (storeId) {
      try {
        const econList = await getSkuEconomicsList(storeId, 30);
        let matchedEcon = sku ? econList.find((e) => e.sku.toUpperCase() === sku) : undefined;
        if (!matchedEcon && sku) {
          matchedEcon = econList.find(
            (e) => sku.startsWith(e.sku.toUpperCase()) || e.sku.toUpperCase().startsWith(sku)
          );
        }

        if (matchedEcon) {
          economics = {
            break_even_acos: matchedEcon.breakEvenAcos,
            max_bid: matchedEcon.maxBid,
            profit_before_ads: matchedEcon.profitBeforeAds,
            selling_price: matchedEcon.sellingPrice,
            product_type: matchedEcon.productType,
          };
        } else {
          // Fallback to Cost Master of this specific Phôi
          const masters = await getCostMasters(storeId);
          const matchedMaster = (sku ? masters.find((m) =>
            m.skuPrefixes?.some((p) => p && sku.startsWith(p.toUpperCase()))
          ) : undefined) || masters.find((m) =>
            rec.productType && m.productType.toLowerCase() === String(rec.productType).toLowerCase()
          ) || masters[0];

          if (matchedMaster) {
            const profit = matchedMaster.defaultPrice - matchedMaster.defaultAmazonFee - matchedMaster.baseCost - (matchedMaster.defaultPrice * matchedMaster.taxRate);
            const maxBid = Math.round(0.10 * Math.max(0, profit) * 100) / 100;
            economics = {
              break_even_acos: matchedMaster.breakEvenAcos,
              max_bid: maxBid > 0 ? maxBid : 1.25,
              profit_before_ads: profit > 0 ? profit : null,
              selling_price: matchedMaster.defaultPrice,
              product_type: matchedMaster.productType,
            };
          }
        }
      } catch (err) {
        console.warn("[PPC AI Review] Could not load dynamic economics:", err);
      }
    }

    // 2. Fetch mature historical evidence
    let historicalRows: HistoricalRow[] = [];
    if (storeId) {
      historicalRows = await sql<HistoricalRow[]>`
        SELECT action.campaign_type, action.match_type,
               action.old_value, action.final_value, outcome.outcome_label,
               outcome.comparison->>'reward_usd' AS reward_usd, context.context
        FROM ppc_action_outcomes outcome
        JOIN ppc_actions action ON action.id = outcome.action_id
        JOIN ppc_stores store ON store.id = action.store_id
        LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
        WHERE action.store_id = ${storeId}::uuid
          AND store.team_id = ${scope.teamId}
          AND outcome.window_days = 30
          AND outcome.status = 'MATURE'
          AND COALESCE((outcome.evidence_quality->>'eligible_for_learning')::boolean, false)
          AND outcome.evidence_quality->>'applied_on_source' = 'BULK_EXPORT'
          AND COALESCE((outcome.evidence_quality->>'margin_reliable')::boolean, false)
        LIMIT 500
      `;
    }

    const campaignType = extractCampaignFamily(
      `${rec.ruleProfile || ""} ${rec.reason || ""} ${rec.campaignName || ""}`,
      (rec.adType || "SP").toUpperCase().startsWith("SB") ? "SB05" : "SP03",
    );
    const resolvedProductType = String(rec.productType || economics.product_type || "ORNAMENT");
    const productType = resolvedProductType.toLowerCase();

    // 2. Derive Target Scenario from Rule Engine intent and relative economics
    const targetScenario = deriveTargetScenario({
      clicks: rec.clicks,
      orders: rec.orders,
      spend: rec.spend,
      sales: rec.sales,
      breakEvenAcos: finite(economics.break_even_acos, 45.5),
      targetAcos: storeTargetAcos,
      reason: rec.reason,
      recType: rec.recType,
    });

    // 3. Direction and Candidate calculation
    const currentBid = finite(rec.currentBid);
    const observedCpc = rec.cpc && rec.cpc > 0
      ? rec.cpc
      : (rec.clicks && rec.clicks > 0 && rec.spend ? rec.spend / rec.clicks : undefined);
    const averageCpc = finite(observedCpc, currentBid);
    const ruleBid = finite(rec.recommendedBid, currentBid);

    let ruleDirection: ShadowDirection = "HOLD";
    if (rec.recType === "PAUSE_TARGET") {
      ruleDirection = "PAUSE";
    } else if (ruleBid > currentBid) {
      ruleDirection = "INCREASE";
    } else if (ruleBid < currentBid) {
      ruleDirection = "DECREASE";
    }

    // 4. Parse historical rows and compute scenarios at action time
    const parsedHistoricalCases: HistoricalScenarioContext[] = historicalRows.map((hist) => {
      const hContext = parseContext(hist.context);
      const hTarget = (hContext.target || {}) as Record<string, unknown>;
      const hMetrics = (hContext.metrics || {}) as Record<string, unknown>;
      const hEconomics = (hContext.economics || {}) as Record<string, unknown>;
      const hState = (hContext.state_at_action || {}) as Record<string, unknown>;

      const oldBid = finite(hist.old_value);
      const finalBid = finite(hist.final_value);
      let direction: ShadowDirection = "HOLD";
      if (finalBid > oldBid) direction = "INCREASE";
      else if (finalBid < oldBid) direction = "DECREASE";

      const candId = historicalCandidateId(hist);

      // Prioritize explicit scenario_at_action frozen in context snapshot
      let histScenario: PpcTargetScenario =
        (hState.scenario as PpcTargetScenario) ||
        (hContext.scenario_at_action as PpcTargetScenario);
      let histAcosBeRatio: number | null =
        typeof hState.acos_be_ratio === "number" ? hState.acos_be_ratio : null;

      if (!histScenario) {
        const derived = deriveTargetScenario({
          clicks: Number(hMetrics.clicks || 0),
          orders: Number(hMetrics.orders || 0),
          spend: Number(hMetrics.spend || 0),
          sales: Number(hMetrics.sales || 0),
          breakEvenAcos: Number(hEconomics.break_even_acos || 45.5),
          reason: String(
            hContext.decision && typeof hContext.decision === "object"
              ? (hContext.decision as Record<string, unknown>).reason || ""
              : "",
          ),
        });
        histScenario = derived.scenario;
        histAcosBeRatio = derived.acosBeRatio;
      }

      const histDecision = (hContext.decision || {}) as Record<string, unknown>;
      const histCampFamily = extractCampaignFamily(
        `${histDecision.rule_version || ""} ${histDecision.reason || ""} ${hTarget.campaign_name || ""}`,
        hist.campaign_type.toUpperCase().startsWith("SB") ? "SB05" : "SP03",
      );

      return {
        scenarioAtAction: histScenario,
        acosBeRatio: histAcosBeRatio,
        clicks: Number(hMetrics.clicks || 0),
        orders: Number(hMetrics.orders || 0),
        cvr: typeof hMetrics.cvr === "number" ? hMetrics.cvr : null,
        avgCpc: typeof hMetrics.avg_cpc === "number" ? hMetrics.avg_cpc : null,
        productType: String(hTarget.product_type || "").toLowerCase(),
        campaignType: histCampFamily,
        matchType: hist.match_type,
        direction,
        candidateId: candId,
        outcomeLabel: hist.outcome_label,
        rewardUsd: Number(hist.reward_usd) || null,
        rawRow: hist,
      };
    });

    // 5. Hierarchical Retrieval (LEVEL A -> B -> C)
    const retrieval = performHierarchicalRetrieval({
      targetScenario,
      campaignType,
      matchType: rec.matchType || "EXACT",
      productType,
      direction: ruleDirection,
      allHistoricalCases: parsedHistoricalCases,
      minSamplesPerLevel: 20,
    });

    // Candidate statistics computed specifically on the matching scenario cases
    const evidence = summarizeScenarioEvidence(retrieval.cases);

    const rawMaxBid = finite(economics.max_bid);
    const maxBid = rawMaxBid > 0 && campaignType.startsWith("SB") ? rawMaxBid * 0.8 : rawMaxBid;

    const candidates = buildShadowCandidates({
      currentBid,
      averageCpc,
      ruleBid,
      ruleDirection,
      maxBid: maxBid || null,
      evidence,
      minimumEvidence: 20,
    });

    // 6. Build Rich Payload
    const syntheticRow = {
      action_id: `rec-eval-${rec.id}`,
      store_id: rec.storeId || "",
      campaign_id: rec.campaignId || "",
      campaign_type: campaignType,
      match_type: rec.matchType || "EXACT",
      target_id: rec.keywordId || "",
      target_keyword: rec.keyword,
      action_type: rec.recType,
      old_value: currentBid,
      system_suggested_value: ruleBid,
      data_as_of: new Date().toISOString(),
      context: {},
    };

    const syntheticContext = {
      target: {
        campaign_name: rec.campaignName,
        product_type: resolvedProductType,
      },
      metrics: {
        clicks: rec.clicks || 0,
        orders: rec.orders || 0,
        spend: rec.spend || 0,
        sales: rec.sales || 0,
        avg_cpc: averageCpc,
        acos: rec.sales && rec.spend ? (rec.spend / rec.sales) * 100 : null,
      },
      economics: {
        break_even_acos: economics.break_even_acos || null,
        max_bid: maxBid || null,
        selling_price: economics.selling_price || null,
        profit_before_ads: economics.profit_before_ads || null,
      },
      decision: {
        reason: rec.reason,
      },
      scenario_evaluation: {
        target_scenario: targetScenario.scenario,
        acos_be_ratio: targetScenario.acosBeRatio,
        retrieval_level: retrieval.level,
        retrieval_specificity: retrieval.specificity,
        sample_count: retrieval.sampleCount,
      },
    };

    const payload = buildAiReviewerPayload({
      row: syntheticRow,
      context: syntheticContext,
      candidates,
      evidence,
      effectiveMaxBid: maxBid || null,
    });

    // Query multi-window performance (7d, 14d, 30d) for this target
    try {
      if (storeId) {
        const factRows = await sql`
          SELECT (report_end_date - report_start_date + 1) as window_days,
                 impressions, clicks, spend, sales, orders
          FROM ppc_performance_facts
          JOIN ppc_stores store ON store.id = ppc_performance_facts.store_id
          WHERE ppc_performance_facts.store_id = ${storeId}::uuid
            AND store.team_id = ${scope.teamId}
            AND grain = 'TARGET'
            AND (
              (${rec.keywordId || ""} != '' AND target_id = ${rec.keywordId || ""})
              OR (lower(trim(target_expression)) = lower(trim(${rec.keyword})))
            )
            ${rec.campaignId ? sql`AND campaign_id = ${rec.campaignId}` : sql``}
            ${rec.adGroupId ? sql`AND ad_group_id = ${rec.adGroupId}` : sql``}
            AND (report_end_date - report_start_date + 1) IN (3, 7, 14, 30)
          ORDER BY snapshot_date DESC, report_end_date DESC
          LIMIT 12
        `;
        const windowsData: NonNullable<typeof payload.performance.windows> = {};
        for (const f of factRows) {
          const wKey = String(f.window_days);
          if (!windowsData[wKey]) {
            const clicks = Number(f.clicks || 0);
            const spend = Number(f.spend || 0);
            const sales = Number(f.sales || 0);
            const orders = Number(f.orders || 0);
            windowsData[wKey] = {
              window_days: Number(f.window_days),
              clicks,
              orders,
              spend,
              sales,
              avg_cpc: clicks > 0 ? spend / clicks : null,
              acos: sales > 0 ? (spend / sales) * 100 : null,
              cvr: clicks > 0 ? (orders / clicks) * 100 : null,
            };
          }
        }
        if (Object.keys(windowsData).length > 0) {
          payload.performance.windows = windowsData;
        }
      }
    } catch {
      // Non-blocking best effort for multi-window telemetry
    }

    // 7. Invoke AI Reviewer (gpt-5.6-terra)
    const executionResult = await invokeAiReviewer(payload);

    return NextResponse.json({
      success: true,
      result: executionResult,
      scenario_info: targetScenario,
      retrieval_metadata: {
        level: retrieval.level,
        specificity: retrieval.specificity,
        sample_count: retrieval.sampleCount,
      },
    });
  } catch (error: unknown) {
    console.error("[PPC AI Review API] Failed:", error);
    return routeErrorResponse(error, "Internal error running AI Review", 500);
  }
}
