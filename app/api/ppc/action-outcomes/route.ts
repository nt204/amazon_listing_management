import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { evaluatePendingActionOutcomes } from "@/lib/ppc/action-outcome-evaluator";
import { resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);

    const storeTarget = searchParams.get("storeName") || searchParams.get("storeId");
    const isAllStores = !storeTarget || storeTarget === "ALL";
    const storeId = isAllStores ? "ALL" : await resolveStoreId(storeTarget);

    const windowParam = searchParams.get("window");
    const windowDays = windowParam ? Number(windowParam) : null;
    const labelFilter = searchParams.get("label");
    const eligibleOnly = searchParams.get("eligibleForLearning") === "true";
    const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit") || 100)));
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));

    const sql = await getDatabaseClient();

    // Query all outcome rows joined with actions for the target store
    const rows = await sql<any[]>`
      SELECT outcome.id as outcome_id, outcome.action_id, outcome.window_days,
             outcome.observation_start::text, outcome.observation_end::text,
             outcome.maturity_date::text, outcome.status, outcome.outcome_label,
             outcome.baseline, outcome.observed, outcome.comparison,
             outcome.evidence_quality, outcome.evaluated_at,
             action.store_id, action.campaign_id, action.campaign_name, action.campaign_type,
             action.target_id, action.target_keyword, action.match_type, action.sku,
             action.old_value, action.system_suggested_value, action.final_value,
             action.status as action_status, action.approved_by,
             COALESCE(action.approved_at::date, action.created_at::date, CURRENT_DATE)::text as applied_on,
             COALESCE(action.approved_at, action.created_at) as action_timestamp
      FROM ppc_action_outcomes outcome
      JOIN ppc_actions action ON action.id = outcome.action_id
      WHERE 1=1
        ${storeId !== "ALL" ? sql`AND action.store_id = ${storeId}` : sql``}
      ORDER BY action_timestamp DESC, outcome.window_days ASC
    `;

    // Group rows into 1 item per action containing both d7 and d30
    const actionMap = new Map<string, any>();
    for (const r of rows) {
      if (!actionMap.has(r.action_id)) {
        const deltaPct = r.comparison?.applied_delta_pct ?? (
          r.old_value && r.final_value
            ? ((Number(r.final_value) - Number(r.old_value)) / Number(r.old_value)) * 100
            : 0
        );

        actionMap.set(r.action_id, {
          action_id: r.action_id,
          store_id: r.store_id,
          campaign_id: r.campaign_id,
          campaign_name: r.campaign_name,
          campaign_type: r.campaign_type,
          target_id: r.target_id,
          target_keyword: r.target_keyword,
          match_type: r.match_type,
          sku: r.sku,
          old_value: r.old_value,
          system_suggested_value: r.system_suggested_value,
          final_value: r.final_value,
          applied_delta_pct: deltaPct,
          action_status: r.action_status,
          approved_by: r.approved_by,
          applied_on: r.applied_on,
          baseline: r.baseline || {},
          d7: null,
          d30: null,
          eligible_for_learning: false,
          evaluated_at: r.evaluated_at,
        });
      }

      const act = actionMap.get(r.action_id);
      const windowDetail = {
        outcome_id: r.outcome_id,
        window_days: r.window_days,
        status: r.status,
        outcome_label: r.outcome_label,
        observation_start: r.observation_start,
        observation_end: r.observation_end,
        maturity_date: r.maturity_date,
        observed: r.observed || {},
        comparison: r.comparison || {},
        evidence_quality: r.evidence_quality || {},
        evaluated_at: r.evaluated_at,
      };

      if (r.window_days === 7) {
        act.d7 = windowDetail;
      } else if (r.window_days === 30) {
        act.d30 = windowDetail;
      }

      if (r.baseline && (!act.baseline || Object.keys(act.baseline).length === 0)) {
        act.baseline = r.baseline;
      }

      if (r.evidence_quality?.eligible_for_learning === true) {
        act.eligible_for_learning = true;
      }
      if (r.evaluated_at && (!act.evaluated_at || r.evaluated_at > act.evaluated_at)) {
        act.evaluated_at = r.evaluated_at;
      }
    }

    const allGroupedActions = Array.from(actionMap.values());

    // Aggregate summary over all actions
    let matureCount = 0;
    let observingCount = 0;
    let supersededCount = 0;
    let insufficientCount = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let eligibleCount = 0;
    let totalRewardUsd = 0;

    for (const act of allGroupedActions) {
      if (act.eligible_for_learning) eligibleCount++;

      // Check primary outcome label (prefer D30, fallback to D7)
      const primary = act.d30 || act.d7;
      const isInterrupted =
        act.d30?.status === "INTERRUPTED" ||
        act.d7?.status === "INTERRUPTED" ||
        act.d30?.evidence_quality?.validity === "INTERRUPTED" ||
        act.d7?.evidence_quality?.validity === "INTERRUPTED";

      const label = act.d30?.outcome_label || act.d7?.outcome_label;

      if (isInterrupted) {
        supersededCount++;
      }

      if (label === "POSITIVE") positiveCount++;
      else if (label === "NEUTRAL") neutralCount++;
      else if (label === "NEGATIVE") negativeCount++;
      else if (primary?.status === "INSUFFICIENT_DATA" || primary?.evidence_quality?.validity === "INCONCLUSIVE") {
        insufficientCount++;
      } else if (primary?.status === "OBSERVING" || primary?.status === "PENDING") {
        observingCount++;
      }

      if (primary?.status === "MATURE" || primary?.status === "FINALIZED") {
        matureCount++;
      }

      // Add reward (prioritizing D30 if evaluated, else D7 if evaluated)
      if (act.d30?.comparison?.reward_usd != null) {
        totalRewardUsd += Number(act.d30.comparison.reward_usd);
      } else if (act.d7?.comparison?.reward_usd != null) {
        totalRewardUsd += Number(act.d7.comparison.reward_usd);
      }
    }

    const totalDecisive = positiveCount + negativeCount;
    const winRate = totalDecisive > 0 ? (positiveCount / totalDecisive) * 100 : null;

    // Filter items based on query params
    let filteredActions = allGroupedActions;

    if (labelFilter && labelFilter !== "ALL") {
      filteredActions = filteredActions.filter((act) => {
        if (labelFilter === "SUPERSEDED" || labelFilter === "INTERRUPTED") {
          return (
            act.d30?.evidence_quality?.validity === "SUPERSEDED" ||
            act.d7?.evidence_quality?.validity === "SUPERSEDED" ||
            act.d30?.evidence_quality?.validity === "INTERRUPTED" ||
            act.d7?.evidence_quality?.validity === "INTERRUPTED"
          );
        }
        if (labelFilter === "OBSERVING") {
          return act.d30?.status === "OBSERVING" || act.d7?.status === "OBSERVING";
        }
        if (labelFilter === "INSUFFICIENT_DATA") {
          return (
            act.d30?.status === "INSUFFICIENT_DATA" || act.d7?.status === "INSUFFICIENT_DATA"
          );
        }
        return (
          act.d30?.outcome_label === labelFilter ||
          act.d7?.outcome_label === labelFilter ||
          act.d30?.status === labelFilter ||
          act.d7?.status === labelFilter
        );
      });
    }

    if (eligibleOnly) {
      filteredActions = filteredActions.filter((act) => act.eligible_for_learning === true);
    }

    // Apply pagination
    const paginatedItems = filteredActions.slice(offset, offset + limit);

    return Response.json({
      success: true,
      data: {
        items: paginatedItems,
        summary: {
          total: allGroupedActions.length,
          totalFiltered: filteredActions.length,
          mature: matureCount,
          observing: observingCount,
          superseded: supersededCount,
          interrupted: supersededCount,
          insufficientData: insufficientCount,
          positive: positiveCount,
          neutral: neutralCount,
          negative: negativeCount,
          eligibleForLearning: eligibleCount,
          totalRewardUsd: Number(totalRewardUsd.toFixed(2)),
          winRate,
        },
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Action Outcomes.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "evaluate"; // 'evaluate' | 'seed' | 'backtest'

    const summary = await evaluatePendingActionOutcomes({
      limit: 1000,
      autoSeed: true,
    });

    return Response.json({
      success: true,
      message: "Đã hoàn thành đánh giá các Action Outcomes.",
      data: summary,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi thực thi đánh giá Action Outcomes.", 500);
  }
}
