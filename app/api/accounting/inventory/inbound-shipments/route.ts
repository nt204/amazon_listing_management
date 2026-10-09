import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  deleteInboundShipmentItem,
  listInboundShipments,
  upsertInboundShipmentItem,
} from "@/lib/accounting/inventory-db";

const inboundInputSchema = z.object({
  store_id: z.string().uuid("Invalid Store ID"),
  sku_id: z.string().uuid().nullable().optional(),
  sku: z.string().trim().min(1, "SKU is required"),
  brand: z.string().trim().nullable().optional(),
  sup: z.string().trim().nullable().optional(),
  ngay_request: z.string().trim().nullable().optional(),
  product_type: z.string().trim().nullable().optional(),
  mockup: z.string().trim().nullable().optional(),
  quantity: z.number().int().min(0).default(0),
  line_ship: z.string().trim().nullable().optional(),
  base_cost_per_unit: z.number().nullable().optional(),
  card: z.number().nullable().optional(),
  tag: z.number().nullable().optional(),
  shipping_fee: z.number().nullable().optional(),
  hop_tui: z.number().nullable().optional(),
  final_basecost: z.number().nullable().optional(),
  total_basecost: z.number().nullable().optional(),
  ngay_thanh_toan: z.string().trim().nullable().optional(),
  ten_lo_hang: z.string().trim().nullable().optional(),
  shipment_id: z.string().trim().nullable().optional(),
  ngay_di: z.string().trim().nullable().optional(),
  ngay_den: z.string().trim().nullable().optional(),
  amazon_received: z.number().int().nullable().optional(),
  tinh_trang_hang_den_kho: z.string().trim().nullable().optional(),
  status: z.string().trim().nullable().optional(),
  so_luong_amazon_nhan: z.number().int().nullable().optional(),
  discrepancy: z.number().int().nullable().optional(),
  note: z.string().trim().nullable().optional(),
  trang_thai: z.string().trim().nullable().optional(),
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
    const cursor = searchParams.get("cursor") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await listInboundShipments(storeId, { search, status, shipmentId, cursor, page, limit });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Failed to load Inbound Shipments.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const body = await readJsonBody(request, 50_000);
    const parsed = inboundInputSchema.parse(body);
    const item = await upsertInboundShipmentItem(parsed.store_id, parsed);
    return Response.json({ item });
  } catch (error) {
    return routeErrorResponse(error, "Failed to save Inbound Shipment.");
  }
}

export async function DELETE(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const storeId = searchParams.get("store_id");
    if (!id || !storeId) {
      return Response.json({ error: "id and store_id are required" }, { status: 400 });
    }
    const success = await deleteInboundShipmentItem(id, storeId);
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete Inbound Shipment.");
  }
}
