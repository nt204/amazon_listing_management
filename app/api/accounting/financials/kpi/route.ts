import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { getKpi, setKpiNote, setKpiTarget, type KpiTargetPatch } from "@/lib/accounting/kpi-db";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function defaultPeriod() {
  // Mặc định tháng vừa kết thúc (đầu tháng team chốt KPI tháng trước + đặt mục tiêu tháng này)
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) return Response.json({ error: "store_id is required" }, { status: 400 });
    await requireStoreAccess(actor, storeId, "FBA");
    const periodParam = searchParams.get("period") || "";
    const period = PERIOD_RE.test(periodParam) ? periodParam : defaultPeriod();
    const result = await getKpi(storeId, period, { refresh: searchParams.get("refresh") === "1" });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không tải được KPI kinh doanh.", 500);
  }
}

function numOrNull(v: unknown, min: number, max: number): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < min || x > max) throw new Error("invalid");
  return x;
}
function textOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (s.length > 2000) throw new Error("invalid");
  return s || null;
}

// Ghi mục tiêu 1 SKU ({ store_id, period, sku, ...fields }) hoặc ô Đánh giá tổng quan ({ store_id, period, note })
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 20_000)) as Record<string, unknown>;
    const storeId = String(body?.store_id || "").trim();
    const period = String(body?.period || "").trim();
    if (!storeId || !PERIOD_RE.test(period)) {
      return Response.json({ error: "Cần store_id và period (YYYY-MM)." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");
    const who = actor.displayName || actor.userId;

    if ("note" in body) {
      const note = String(body.note ?? "");
      if (note.length > 20_000) return Response.json({ error: "Nội dung quá dài." }, { status: 400 });
      await setKpiNote(storeId, period, note, who);
      return Response.json({ success: true });
    }

    const sku = String(body.sku || "").trim();
    if (!sku || sku.length > 200) return Response.json({ error: "Thiếu SKU." }, { status: 400 });
    let patch: KpiTargetPatch;
    try {
      patch = {
        units: numOrNull(body.units, 0, 10_000_000),
        tacos: numOrNull(body.tacos, 0, 10),
        price: numOrNull(body.price, 0, 100_000),
        storage_fee: numOrNull(body.storage_fee, -1_000_000, 1_000_000),
        cause: textOrNull(body.cause),
        solution: textOrNull(body.solution),
        action: textOrNull(body.action),
        review: textOrNull(body.review),
        target_action: textOrNull(body.target_action),
      };
    } catch {
      return Response.json({ error: "Giá trị không hợp lệ." }, { status: 400 });
    }
    for (const k of Object.keys(patch) as (keyof KpiTargetPatch)[]) if (patch[k] === undefined) delete patch[k];
    const saved = await setKpiTarget(storeId, period, sku, patch, who);
    return Response.json({ success: true, target: saved });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được KPI.", 500);
  }
}
