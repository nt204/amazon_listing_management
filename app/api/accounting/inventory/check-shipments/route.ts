import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  deleteCheckShipmentItem,
  listCheckShipments,
  patchCheckShipmentField,
  restoreCheckShipmentItem,
  upsertCheckShipmentItem,
  syncCheckShipmentsToInbound,
} from "@/lib/accounting/inventory-db";

const checkShipmentInputSchema = z.object({
  id: z.string().uuid().optional(),
  store_id: z.string().uuid("Invalid Store ID"),
  ngay_update: z.string().trim().nullable().optional(),
  brand: z.string().trim().nullable().optional(),
  shipment_name: z.string().trim().nullable().optional(),
  shipment_id: z.string().trim().min(1, "Shipment ID is required"),
  created_date: z.string().trim().nullable().optional(),
  last_updated_date: z.string().trim().nullable().optional(),
  ship_to: z.string().trim().nullable().optional(),
  skus_count: z.coerce.number().int().min(0).default(1),
  units_expected: z.coerce.number().int().min(0).default(0),
  units_located: z.coerce.number().int().min(0).default(0),
  discrepancy: z.coerce.number().int().optional(),
  status: z.string().trim().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const shipmentId = searchParams.get("shipment_id") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await listCheckShipments(storeId, { search, status, shipmentId, page, limit });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Failed to load Check Shipments.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 50_000)) as any;

    if (body?.action === "sync" && body?.store_id) {
      const res = await syncCheckShipmentsToInbound(
        body.store_id,
        undefined,
        actor.email || actor.displayName || actor.userId,
      );
      return Response.json({ success: true, updated_count: res.updatedCount });
    }

    const parsed = checkShipmentInputSchema.parse(body);
    const item = await upsertCheckShipmentItem(
      parsed.store_id,
      parsed,
      actor.email || actor.displayName || actor.userId
    );
    return Response.json({ item });
  } catch (error) {
    return routeErrorResponse(error, "Failed to save Check Shipment.");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 10_000)) as {
      id?: string;
      store_id?: string;
      field?: string;
      value?: any;
    };
    if (!body?.id || !body?.store_id || !body?.field) {
      return Response.json({ error: "id, store_id, and field are required" }, { status: 400 });
    }
    const item = await patchCheckShipmentField(
      body.store_id,
      body.id,
      body.field,
      body.value,
      actor.email || actor.displayName || actor.userId
    );
    return Response.json({ item });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update Check Shipment field.");
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const storeId = searchParams.get("store_id");
    const action = searchParams.get("action");

    if (!id || !storeId) {
      return Response.json({ error: "id and store_id are required" }, { status: 400 });
    }

    if (action === "restore") {
      const success = await restoreCheckShipmentItem(
        id,
        storeId,
        actor.email || actor.displayName || actor.userId
      );
      return Response.json({ success });
    }

    const success = await deleteCheckShipmentItem(
      id,
      storeId,
      actor.email || actor.displayName || actor.userId
    );
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete/restore Check Shipment.");
  }
}
