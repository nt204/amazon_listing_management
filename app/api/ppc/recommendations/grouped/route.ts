// app/api/ppc/recommendations/grouped/route.ts
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcPerformance } from "@/lib/ppc/repository";
import { getGroupedRecommendations, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Number(searchParams.get("days") || 30);

    const storeId = await resolveStoreId(searchParams.get("storeId") || (storeName !== "ALL" ? storeName : null));

    // Fetch target performance rows
    const targetRows = await listPpcPerformance(
      scope,
      { storeName, sku, days },
      { grain: "TARGET", limit: 25000 },
    );

    const result = await getGroupedRecommendations(storeId, targetRows, days);

    return Response.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách đề xuất gom theo SKU.", 500);
  }
}
