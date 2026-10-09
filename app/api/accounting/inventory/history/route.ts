import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  listInventoryHistory,
  restoreInventoryHistory,
  restoreSoftDeletedItem,
} from "@/lib/accounting/inventory-db";

const restoreSchema = z
  .object({
    store_id: z.string().uuid("Invalid Store ID"),
    history_id: z.string().uuid().optional(),
    entity_type: z.enum(["sku", "inbound"]).optional(),
    entity_id: z.string().uuid().optional(),
  })
  .refine(
    (data) => Boolean(data.history_id || (data.entity_type && data.entity_id)),
    {
      message: "Cần cung cấp history_id hoặc cả entity_type và entity_id",
    }
  );

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const entityId = searchParams.get("entity_id") || undefined;
    const entityTypeParam = searchParams.get("entity_type");
    const entityType =
      entityTypeParam === "sku" || entityTypeParam === "inbound"
        ? entityTypeParam
        : undefined;

    if (!storeId) {
      return Response.json(
        { error: "store_id là tham số bắt buộc." },
        { status: 400 }
      );
    }
    const history = await listInventoryHistory(storeId, entityType, entityId);
    return Response.json({ history });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải lịch sử thay đổi.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const input = restoreSchema.parse(await readJsonBody(request, 5_000));
    const actorName =
      actor.email || actor.displayName || actor.userId || "system";

    if (input.history_id) {
      const result = await restoreInventoryHistory(
        input.store_id,
        input.history_id,
        actorName
      );
      return Response.json({ success: true, ...result });
    }

    if (input.entity_type && input.entity_id) {
      const success = await restoreSoftDeletedItem(
        input.store_id,
        input.entity_type,
        input.entity_id,
        actorName
      );
      return Response.json({
        success,
        entityType: input.entity_type,
        entityId: input.entity_id,
      });
    }

    return Response.json({ error: "Tham số không hợp lệ." }, { status: 400 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể khôi phục phiên bản.");
  }
}
