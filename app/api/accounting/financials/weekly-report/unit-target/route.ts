import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { setWeeklyUnitTarget } from "@/lib/accounting/weekly-unit-target-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Báo cáo tuần → mục tiêu units tuần của 1 team. PUT { week_start, team, units } (units null / "" = xoá). Admin / kế toán.
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin hoặc kế toán được sửa mục tiêu tuần." }, { status: 403 });
    }
    const body = (await readJsonBody(request, 10_000)) as { week_start?: string; team?: unknown; units?: unknown };
    const weekStart = body?.week_start?.trim() || "";
    const team = typeof body?.team === "string" ? body.team.trim().slice(0, 100) : "";
    const raw = body?.units;
    const units = raw == null || raw === "" ? null : Number(raw);
    if (!DATE_RE.test(weekStart) || !team || (units != null && (!Number.isInteger(units) || units < 0 || units > 10_000_000))) {
      return Response.json({ error: "Cần week_start (YYYY-MM-DD), team và units (số nguyên ≥ 0)." }, { status: 400 });
    }
    await setWeeklyUnitTarget(weekStart, team, units, actor.displayName || actor.userId);
    return Response.json({ success: true, team, units });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được mục tiêu tuần.", 500);
  }
}
