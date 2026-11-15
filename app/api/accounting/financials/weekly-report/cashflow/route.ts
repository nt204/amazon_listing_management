import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { CASHFLOW_FIELDS } from "@/lib/accounting/weekly-cashflow";
import { updateWeeklyCashflow } from "@/lib/accounting/weekly-cashflow-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Báo cáo tuần → Tài chính & dòng tiền: admin / kế toán nhập các khoản của 1 tuần.
// PUT { week_start: YYYY-MM-DD, values: { field: number | null } }
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin hoặc kế toán được nhập dòng tiền." }, { status: 403 });
    }
    const body = (await readJsonBody(request, 4_000)) as { week_start?: string; values?: Record<string, unknown> };
    const weekStart = body?.week_start?.trim() || "";
    if (!DATE_RE.test(weekStart) || !body.values || typeof body.values !== "object") {
      return Response.json({ error: "Cần week_start (YYYY-MM-DD) và values." }, { status: 400 });
    }
    const patch: Record<string, number | null> = {};
    for (const [k, raw] of Object.entries(body.values)) {
      if (!(CASHFLOW_FIELDS as readonly string[]).includes(k)) continue;
      if (raw == null || raw === "") {
        patch[k] = null;
        continue;
      }
      const v = Number(raw);
      // Số dư quỹ được âm (thâm quỹ); các khoản còn lại ≥ 0
      if (!Number.isFinite(v) || Math.abs(v) > 1e13 || (k !== "openingBalance" && v < 0)) {
        return Response.json({ error: "Giá trị không hợp lệ." }, { status: 400 });
      }
      patch[k] = Math.round(v * 100) / 100;
    }
    const values = await updateWeeklyCashflow(weekStart, patch, actor.displayName || actor.userId);
    return Response.json({ success: true, values });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được dòng tiền.", 500);
  }
}
