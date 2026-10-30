import { z } from "zod";
import { ApiError, authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { assertStoreAccess, getAccountingAccess, hasFullAccountingAccess } from "@/lib/accounting/access";
import { deleteStore, getStoreById, updateStore } from "@/lib/accounting/accounting-db";

const updateStoreSchema = z.object({
  name: z.string().trim().min(1, "Store name is required").max(100).optional(),
  marketplace: z.string().trim().min(1, "Marketplace is required").max(50).optional(),
  team: z.string().trim().max(100).optional(),
  legal_entity_id: z.string().uuid("Invalid Legal Entity ID").optional().nullable(),
  legal_entity: z.string().trim().max(100).optional().nullable(),
  seller_id: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { id } = await params;
    assertStoreAccess(await getAccountingAccess(actor), id);
    const store = await getStoreById(id);
    if (!store) {
      return Response.json({ error: "Store not found." }, { status: 404 });
    }
    return Response.json({ store });
  } catch (error) {
    return routeErrorResponse(error, "Failed to fetch store.", 500);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { id } = await params;
    assertStoreAccess(await getAccountingAccess(actor), id, undefined, "write");
    const body = await readJsonBody(request, 10_000);
    const parsed = updateStoreSchema.parse(body);
    // Team quyết định phân quyền: chỉ Admin / Kế toán được đổi để không ai tự mở rộng quyền của mình
    if (parsed.team !== undefined && !hasFullAccountingAccess(actor)) {
      const current = await getStoreById(id);
      if (current && current.team !== parsed.team) throw new ApiError("Chỉ Admin hoặc Kế toán được đổi Team của store.", 403);
    }
    const updated = await updateStore(id, parsed);
    if (!updated) {
      return Response.json({ error: "Store not found." }, { status: 404 });
    }
    return Response.json({ store: updated });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update store.");
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const actor = await authorize(request, "write", "accounting");
    if (!hasFullAccountingAccess(actor)) throw new ApiError("Chỉ Admin hoặc Kế toán được xoá store.", 403);
    const { id } = await params;
    const success = await deleteStore(id);
    if (!success) {
      return Response.json({ error: "Store not found or could not be deleted." }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete store.");
  }
}
