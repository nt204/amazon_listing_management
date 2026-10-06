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
    const searchQuery = searchParams.get("search")?.trim().toLowerCase();
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
             COALESCE(action.approved_at, action.created_at) as action_timestamp,
             context.context as action_context
      FROM ppc_action_outcomes outcome
      JOIN ppc_actions action ON action.id = outcome.action_id
      LEFT JOIN ppc_action_contexts context ON context.action_id = action.id
      WHERE 1=1
        ${storeId !== "ALL" ? sql`AND action.store_id = ${storeId}` : sql``}
      ORDER BY action_timestamp DESC, outcome.window_days ASC
    `;

    // Group rows into 1 item per action containing d3, d7, d14, d30
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
          d3: null,
          d7: null,
          d14: null,
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

      if (r.window_days === 3) {
        act.d3 = windowDetail;
      } else if (r.window_days === 7) {
        act.d7 = windowDetail;
      } else if (r.window_days === 14) {
        act.d14 = windowDetail;
      } else if (r.window_days === 30) {
        act.d30 = windowDetail;
      }

      if (r.baseline && (!act.baseline || Object.keys(act.baseline).length === 0)) {
        act.baseline = r.baseline;
      }

      // Fallback from action_context if baseline is still empty
      if ((!act.baseline || Object.keys(act.baseline).length === 0) && r.action_context) {
        try {
          const ctx = typeof r.action_context === "string" ? JSON.parse(r.action_context) : r.action_context;
          const m = ctx?.baseline_windows?.["30"]?.metrics || ctx?.baseline_windows?.["7"]?.metrics || ctx?.metrics;
          if (m && (m.spend !== undefined || m.clicks !== undefined)) {
            act.baseline = {
              clicks: Number(m.clicks || 0),
              orders: Number(m.orders || 0),
              spend: Number(m.spend || 0),
              sales: Number(m.sales || 0),
              acos: m.sales > 0 ? (Number(m.spend || 0) / Number(m.sales)) * 100 : null,
              days: 30,
            };
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (r.evidence_quality?.eligible_for_learning === true) {
        act.eligible_for_learning = true;
      }
      if (r.evaluated_at && (!act.evaluated_at || r.evaluated_at > act.evaluated_at)) {
        act.evaluated_at = r.evaluated_at;
      }
    }

    const allGroupedActions = Array.from(actionMap.values());

    // Enrich any remaining missing baselines from ppc_performance_facts
    const missingTargetIds = allGroupedActions
      .filter((a) => (!a.baseline || Object.keys(a.baseline).length === 0) && a.target_id)
      .map((a) => a.target_id);

    if (missingTargetIds.length > 0) {
      try {
        const factBaselines = await sql<{
          target_id: string;
          clicks: string | number;
          spend: string | number;
          sales: string | number;
          orders: string | number;
        }[]>`
          SELECT DISTINCT ON (target_id)
            target_id, clicks, spend, sales, orders
          FROM ppc_performance_facts
          WHERE grain = 'TARGET'
            AND target_id = ANY(${missingTargetIds})
            AND (report_end_date - report_start_date) >= 25
          ORDER BY target_id, snapshot_date DESC;
        `;
        const factMap = new Map(factBaselines.map((f) => [f.target_id, f]));
        for (const act of allGroupedActions) {
          if ((!act.baseline || Object.keys(act.baseline).length === 0) && factMap.has(act.target_id)) {
            const f = factMap.get(act.target_id)!;
            const spend = Number(f.spend || 0);
            const sales = Number(f.sales || 0);
            act.baseline = {
              clicks: Number(f.clicks || 0),
              orders: Number(f.orders || 0),
              spend,
              sales,
              acos: sales > 0 ? (spend / sales) * 100 : null,
              days: 30,
            };
          }
        }
      } catch {
        // Ignore fallback errors
      }
    }

    // Aggregate summary over all actions
    let matureCount = 0;
    let observingCount = 0;
    let supersededCount = 0;
    let insufficientCount = 0;
    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let warning3dCount = 0;
    let eligibleCount = 0;
    let totalRewardUsd = 0;

    for (const act of allGroupedActions) {
      if (act.eligible_for_learning) eligibleCount++;

      // Check 3D early warning
      const d3Obs = act.d3?.observed;
      const bSpendDay = act.baseline?.spend ? Number(act.baseline.spend) / 30 : 0;
      if (d3Obs?.spend && bSpendDay > 0 && (Number(d3Obs.spend) / 3) > bSpendDay * 2.0) {
        warning3dCount++;
      }

      // Check primary outcome label (prefer D30, fallback to D14, then D7, then D3)
      const primary = act.d30 || act.d14 || act.d7 || act.d3;
      const isInterrupted =
        act.d30?.status === "INTERRUPTED" ||
        act.d14?.status === "INTERRUPTED" ||
        act.d7?.status === "INTERRUPTED" ||
        act.d30?.evidence_quality?.validity === "INTERRUPTED" ||
        act.d14?.evidence_quality?.validity === "INTERRUPTED" ||
        act.d7?.evidence_quality?.validity === "INTERRUPTED";

      const label = act.d30?.outcome_label || act.d14?.outcome_label || act.d7?.outcome_label || act.d3?.outcome_label;

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

      // Add reward (prioritizing D30 if evaluated, else D14, else D7)
      if (act.d30?.comparison?.reward_usd != null) {
        totalRewardUsd += Number(act.d30.comparison.reward_usd);
      } else if (act.d14?.comparison?.reward_usd != null) {
        totalRewardUsd += Number(act.d14.comparison.reward_usd);
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

    if (searchQuery) {
      filteredActions = filteredActions.filter((act) => {
        return (
          (act.target_keyword && act.target_keyword.toLowerCase().includes(searchQuery)) ||
          (act.sku && act.sku.toLowerCase().includes(searchQuery)) ||
          (act.campaign_name && act.campaign_name.toLowerCase().includes(searchQuery))
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
          uniqueTargets: new Set(allGroupedActions.map((a) => a.target_id)).size,
          mature: matureCount,
          observing: observingCount,
          superseded: supersededCount,
          interrupted: supersededCount,
          insufficientData: insufficientCount,
          positive: positiveCount,
          neutral: neutralCount,
          negative: negativeCount,
          warning3d: warning3dCount,
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
