// app/api/ppc/actions/count/route.ts
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getActionQueueCount, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeTarget = searchParams.get("storeName") || searchParams.get("storeId");
    const isAllStores = !storeTarget || storeTarget === "ALL";
    const storeId = isAllStores ? "ALL" : await resolveStoreId(storeTarget);
    const currentUser = actor.displayName || actor.userId;
    const userFilter = searchParams.get("allUsers") === "true" ? undefined : currentUser;

    const count = await getActionQueueCount(storeId, userFilter);
    return Response.json({ success: true, count, data: count });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi đếm Action Queue.", 500);
  }
}
