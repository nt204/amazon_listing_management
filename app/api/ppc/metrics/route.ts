import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getPpcAnalyticsData } from "@/lib/ppc/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const storeName = searchParams.get("storeName") || "ALL";
    const sku = searchParams.get("sku") || "ALL";
    const days = Number(searchParams.get("days") || 30);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new ApiError("Số ngày phải là số nguyên từ 1 đến 3650.", 400);
    }
    if (storeName.length > 80 || sku.length > 200) {
      throw new ApiError("Bộ lọc PPC không hợp lệ.", 400);
    }

    const data = await getPpcAnalyticsData(scope, {
      storeName,
      sku,
      days,
    });

    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi máy chủ khi tải số liệu PPC.", 500);
  }
}
