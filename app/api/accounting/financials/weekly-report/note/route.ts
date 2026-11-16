import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { setWeeklyNote } from "@/lib/accounting/weekly-note-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Báo cáo tuần → thẻ "Đánh giá": admin / kế toán lưu nhận xét của 1 tuần. PUT { week_start, note } (rỗng = xoá).
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin hoặc kế toán được sửa đánh giá tuần." }, { status: 403 });
    }
    const body = (await readJsonBody(request, 60_000)) as { week_start?: string; note?: unknown };
    const weekStart = body?.week_start?.trim() || "";
    if (!DATE_RE.test(weekStart) || (body.note != null && typeof body.note !== "string")) {
      return Response.json({ error: "Cần week_start (YYYY-MM-DD) và note (chuỗi)." }, { status: 400 });
    }
    const text = String(body.note ?? "").slice(0, 20_000);
    const note = await setWeeklyNote(weekStart, text, actor.displayName || actor.userId);
    return Response.json({ success: true, note });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được đánh giá tuần.", 500);
  }
}
