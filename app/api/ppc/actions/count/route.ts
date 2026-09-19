// app/api/ppc/actions/count/route.ts
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getActionQueueCount, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));

    const count = await getActionQueueCount(storeId);
    return Response.json({ success: true, count, data: count });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đếm Action Queue.", 500);
  }
}
