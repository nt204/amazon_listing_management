import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { getKqkd, setKqkdWinResult } from "@/lib/accounting/kqkd-db";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA");

    const yearParam = Number.parseInt(searchParams.get("year") || "", 10);
    const year = Number.isFinite(yearParam) && yearParam >= 2020 && yearParam <= 2100 ? yearParam : new Date().getFullYear();
    const refresh = searchParams.get("refresh") === "1";

    const result = await getKqkd(storeId, year, { refresh });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không tải được báo cáo KQKD.", 500);
  }
}

// Ô "Số SKU WIN KQ Thực tế" (Team điền) của một phôi trong một tháng đánh giá
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 5_000)) as {
      store_id?: string;
      eval_month?: string;
      product_type?: string;
      win_count?: number | null;
    };
    const storeId = body?.store_id?.trim();
    const evalMonth = body?.eval_month?.trim() || "";
    const productType = body?.product_type?.trim() || "";
    if (!storeId || !/^\d{4}-\d{2}$/.test(evalMonth) || !productType || productType.length > 200) {
      return Response.json({ error: "Cần store_id, eval_month (YYYY-MM) và product_type." }, { status: 400 });
    }
    const winCount = body.win_count;
    if (winCount != null && (!Number.isInteger(winCount) || winCount < 0 || winCount > 100_000)) {
      return Response.json({ error: "Số SKU WIN phải là số nguyên ≥ 0." }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");

    await setKqkdWinResult(storeId, evalMonth, productType, winCount ?? null, actor.displayName || actor.userId);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được số SKU WIN.", 500);
  }
}
