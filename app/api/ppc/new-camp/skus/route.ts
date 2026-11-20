import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getStoreSbDefaults, listLaunchSkus, listNewCampSkus } from "@/lib/ppc/new-camp-db";

export const runtime = "nodejs";

/**
 * GET ?type=FBA|FBM — danh sách SKU kèm thông tin lên camp từ BẢNG MÃ.
 * &store=TÊN — kèm storeDefaults: Entity / Logo / Brand Name của store (dùng chung FBA và FBM).
 * &merge=1 — thêm SKU chỉ có ở bảng còn lại (FBA ↔ FBM), dùng cho panel Lên camp.
 */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const params = new URL(request.url).searchParams;
    const type = params.get("type")?.toUpperCase() === "FBA" ? "FBA" : "FBM";
    const store = (params.get("store") || "").trim();
    const merge = params.get("merge") === "1";
    const [skus, storeDefaults] = await Promise.all([merge ? listLaunchSkus(type) : listNewCampSkus(type), store ? getStoreSbDefaults(store) : null]);
    return Response.json({ success: true, data: skus, storeDefaults }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được danh sách SKU.", 500);
  }
}
