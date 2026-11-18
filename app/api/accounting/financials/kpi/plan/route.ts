import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { canAccessStore, getAccountingAccess, requireStoreAccess } from "@/lib/accounting/access";
import { listStores } from "@/lib/accounting/accounting-db";
import { getPlanSheetUrl, getStorePlan, importPlansFromSheet, setStorePlanCell } from "@/lib/accounting/kpi-plan";
import { PLAN_KEYS, type PlanKey } from "@/lib/accounting/kpi-plan-calc";

export const runtime = "nodejs";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Tab "Plan" của KPI kinh doanh.
// GET ?store_id=&year=&half=1|2 → kế hoạch + Result từng tháng của kỳ
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const year = Number(searchParams.get("year"));
    const half = Number(searchParams.get("half"));
    if (!storeId || !Number.isInteger(year) || year < 2020 || year > 2100 || (half !== 1 && half !== 2)) {
      return Response.json({ error: "Cần store_id, year và half (1 | 2)." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA");
    const [plan, sheetUrl] = await Promise.all([getStorePlan(storeId, year, half), getPlanSheetUrl()]);
    return Response.json({ ...plan, sheetUrl });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được Plan.", 500);
  }
}

// PUT { store_id, period, key, value } — sửa tay 1 ô kế hoạch (value null = xoá)
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 2_000)) as Record<string, unknown>;
    const storeId = String(body?.store_id || "").trim();
    const period = String(body?.period || "").trim();
    const key = String(body?.key || "") as PlanKey;
    if (!storeId || !PERIOD_RE.test(period) || !PLAN_KEYS.includes(key)) {
      return Response.json({ error: "Cần store_id, period (YYYY-MM) và key hợp lệ." }, { status: 400 });
    }
    let value: number | null = null;
    if (body.value != null && body.value !== "") {
      value = Number(body.value);
      if (!Number.isFinite(value) || Math.abs(value) > 1e10) return Response.json({ error: "Giá trị không hợp lệ." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");
    await setStorePlanCell(storeId, period, key, value, actor.displayName || actor.userId);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được Plan.", 500);
  }
}

// POST { url } — nạp kế hoạch từ file "THEO DÕI KẾ HOẠCH CÁC STORE" (tab trùng tên store), chỉ các store được sửa FBA
export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 4_000)) as { url?: string };
    const url = body?.url?.trim();
    if (!url) return Response.json({ error: "Cần link Google Sheet." }, { status: 400 });
    const stores = await listStores();
    const access = await getAccountingAccess(actor, stores);
    const allowed = stores.filter((s) => canAccessStore(access, s.id, "FBA", "write"));
    if (!allowed.length) return Response.json({ error: "Bạn không có quyền sửa store nào." }, { status: 403 });
    const result = await importPlansFromSheet(url, allowed, actor.displayName || actor.userId);
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không nạp được Plan từ sheet.", 500);
  }
}
