import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { accountingReconciliationAgent } from "@/lib/agents/accounting-reconciliation/agent";
import { loadPnlSnapshot, resolveAccountingQuery } from "@/lib/metrics/accounting/source";
import { runAccountingChecks } from "@/lib/metrics/accounting/checks";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dải "Cảnh báo dữ liệu" của AI đối soát: chạy các kiểm tra chất lượng dữ liệu (không gọi AI) cho đúng phạm vi
 * đang xem trên Dashboard, trả các vấn đề (warning / info). Phân quyền store / kênh như AI đối soát.
 */
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const params = new URL(request.url).searchParams;
    const startDate = params.get("start_date") || "";
    const endDate = params.get("end_date") || "";
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return Response.json({ error: "start_date/end_date phải có dạng YYYY-MM-DD" }, { status: 400 });
    }
    const storeIds = (params.get("store_ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const team = params.get("team") || undefined;

    const scope = await accountingReconciliationAgent.createScope(actor);
    const query = resolveAccountingQuery(scope, { storeIds, team, startDate, endDate });
    const snapshot = await loadPnlSnapshot(scope, query);
    const results = await runAccountingChecks(snapshot);
    return Response.json(
      {
        period: snapshot.period,
        latestDate: snapshot.latestDate,
        issues: results.filter((r) => r.status !== "ok"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "Không kiểm tra được dữ liệu.", 500);
  }
}
