import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { setWeeklyPrepaid } from "@/lib/accounting/weekly-prepaid-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parse = (v: unknown, max: number, integer: boolean): number | null | "bad" => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max || (integer && !Number.isInteger(n))) return "bad";
  return integer ? n : Math.round(n * 100) / 100;
};

// Báo cáo tuần → Tồn kho: kế toán nhập SL / Giá trị trả trước cho SUP của 1 store trong 1 tuần.
// PUT { store_id, week_start: YYYY-MM-DD, units, value } — để trống cả hai thì xoá.
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (actor.role !== "admin" && actor.role !== "accountant") {
      return Response.json({ error: "Chỉ admin hoặc kế toán được nhập trả trước cho SUP." }, { status: 403 });
    }
    const body = (await readJsonBody(request, 2_000)) as { store_id?: string; week_start?: string; units?: unknown; value?: unknown };
    const storeId = body?.store_id?.trim();
    const weekStart = body?.week_start?.trim() || "";
    if (!storeId || !DATE_RE.test(weekStart)) {
      return Response.json({ error: "Cần store_id và week_start (YYYY-MM-DD)." }, { status: 400 });
    }
    const units = parse(body.units, 10_000_000, true);
    const value = parse(body.value, 1_000_000_000, false);
    if (units === "bad") return Response.json({ error: "SL trả trước phải là số nguyên ≥ 0." }, { status: 400 });
    if (value === "bad") return Response.json({ error: "Giá trị trả trước phải là số ≥ 0." }, { status: 400 });
    await requireStoreAccess(actor, storeId, "FBA", "write");

    await setWeeklyPrepaid(storeId, weekStart, units, value, actor.displayName || actor.userId);
    return Response.json({ success: true, units, value });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được trả trước cho SUP.", 500);
  }
}
