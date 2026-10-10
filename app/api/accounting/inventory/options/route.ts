import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { listInventoryFieldOptions } from "@/lib/accounting/inventory-db";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    return Response.json(await listInventoryFieldOptions(storeId));
  } catch (error) {
    return routeErrorResponse(error, "Failed to load inventory field options.", 500);
  }
}
