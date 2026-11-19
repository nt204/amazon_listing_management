import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { listNewCampSkus } from "@/lib/ppc/new-camp-db";

export const runtime = "nodejs";

/** GET ?type=FBA|FBM — danh sách SKU kèm thông tin lên camp từ BẢNG MÃ. */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const type = new URL(request.url).searchParams.get("type")?.toUpperCase() === "FBA" ? "FBA" : "FBM";
    const skus = await listNewCampSkus(type);
    return Response.json({ success: true, data: skus }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được danh sách SKU.", 500);
  }
}
