import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { getStoreTestTarget, setStoreTestTarget } from "@/lib/accounting/kqkd-test-targets-db";

// KPI số mẫu test đi hàng của cả store trong tháng (bảng R&D Testing ở tab KPI kinh doanh)
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const month = searchParams.get("month") || "";
    if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "Cần store_id và month (YYYY-MM)." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA");
    return Response.json({ target: await getStoreTestTarget(storeId, month) });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được mục tiêu R&D Testing.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 2_000)) as { store_id?: string; month?: string; target?: number | null };
    const storeId = body?.store_id?.trim();
    const month = body?.month?.trim() || "";
    if (!storeId || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: "Cần store_id và month (YYYY-MM)." }, { status: 400 });
    }
    const target = body.target;
    if (target != null && (!Number.isInteger(target) || target < 0 || target > 100_000)) {
      return Response.json({ error: "Mục tiêu phải là số nguyên ≥ 0." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");

    await setStoreTestTarget(storeId, month, target ?? null, actor.displayName || actor.userId);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được mục tiêu R&D Testing.", 500);
  }
}
