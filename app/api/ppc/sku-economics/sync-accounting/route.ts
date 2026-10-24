// app/api/ppc/sku-economics/sync-accounting/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { syncSkuEconomicsFromAccounting, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);

    const rawStore = body?.storeId || body?.storeName || searchParams.get("storeId");
    if (!rawStore || rawStore === "ALL") {
      throw new ApiError("Vui lòng chọn một Store cụ thể để đồng bộ Bảng mã.", 400);
    }

    const storeId = await resolveStoreId(rawStore);
    const result = await syncSkuEconomicsFromAccounting(storeId);

    return Response.json({
      success: true,
      message: `Đã đồng bộ thành công ${result.syncedCount} SKU từ Store ${result.accountingStoreName} (Accounting) sang ${result.storeName} (PPC).`,
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đồng bộ SKU từ Bảng mã Accounting.", 500);
  }
}
