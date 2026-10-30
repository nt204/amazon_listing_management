import { z } from "zod";
import { ApiError, authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { createStore, listStores } from "@/lib/accounting/accounting-db";
import { getAccountingAccess, hasFullAccountingAccess, withStoreAccess } from "@/lib/accounting/access";

const storeInputSchema = z.object({
  name: z.string().trim().min(1, "Store name is required").max(100),
  marketplace: z.string().trim().min(1, "Marketplace is required").max(50),
  team: z.string().trim().max(100).default("NCE"),
  legal_entity_id: z.string().uuid("Invalid Legal Entity ID").optional().nullable(),
  legal_entity: z.string().trim().max(100).optional().nullable(),
  seller_id: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const stores = await listStores();
    // Mục Import không giới hạn theo phân quyền team: lấy đủ danh sách store
    if (new URL(request.url).searchParams.get("scope") === "all") return Response.json({ stores });
    const access = await getAccountingAccess(actor, stores);
    return Response.json({ stores: withStoreAccess(access, stores), canManageAccess: access.canManage });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load stores.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (!hasFullAccountingAccess(actor)) throw new ApiError("Chỉ Admin hoặc Kế toán được tạo store.", 403);
    const body = await readJsonBody(request, 10_000);
    const parsed = storeInputSchema.parse(body);
    const store = await createStore(parsed);
    return Response.json({ store }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Failed to create store.");
  }
}
