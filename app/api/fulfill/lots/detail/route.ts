import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { z } from "zod";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { requireFulfillStore } from "@/lib/fulfill/lot-access";
import { deleteUnshippedFulfillLot, getFulfillLot, updateUnshippedFulfillLot } from "@/lib/fulfill/lots-db";

const lotEditsSchema = z.array(z.object({
  id: z.string().uuid(),
  version: z.string().min(1).max(80),
  fields: z.record(z.string(), z.string().max(2000)).refine((fields) => Object.keys(fields).length > 0),
})).min(1).max(500).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);

// Người xem được lô (store thuộc team) là sửa được khi lô chưa đi hàng; xoá thêm điều kiện chưa thanh toán.
function detailResponse(data: NonNullable<Awaited<ReturnType<typeof getFulfillLot>>>) {
  const canModify = data.unshipped;
  return NextResponse.json({
    lot: data.lot,
    lines: data.lines,
    versions: canModify ? data.versions : {},
    canDelete: canModify && data.unpaid,
    canEdit: canModify,
    canEditLotIdentity: canModify && data.hasExplicitLotName,
  });
}

export async function GET(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");
    const lot = searchParams.get("lot");
    if (!storeId || !lot) return NextResponse.json({ error: "Select a store and lot." }, { status: 400 });
    await requireFulfillStore(actor, storeId);
    const data = await getFulfillLot(storeId, lot);
    if (!data) return NextResponse.json({ error: "Shipment lot not found." }, { status: 404 });
    return detailResponse(data);
  } catch (error) {
    return routeErrorResponse(error, "Could not load the shipment lot.");
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "write");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");
    const lot = searchParams.get("lot");
    if (!storeId || !lot) return NextResponse.json({ error: "Select a store and lot." }, { status: 400 });
    await requireFulfillStore(actor, storeId);
    const input = lotEditsSchema.safeParse(await readJsonBody(req, 2_000_000));
    if (!input.success) return NextResponse.json({ error: "Invalid lot changes." }, { status: 400 });
    await updateUnshippedFulfillLot(storeId, lot, input.data, actor.email || actor.displayName || actor.userId);
    const data = await getFulfillLot(storeId, lot);
    if (!data) return NextResponse.json({ error: "Shipment lot not found." }, { status: 404 });
    return detailResponse(data);
  } catch (error) {
    return routeErrorResponse(error, "Could not save shipment lot changes.");
  }
}

export async function DELETE(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "write");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");
    const lot = searchParams.get("lot");
    if (!storeId || !lot) return NextResponse.json({ error: "Select a store and lot." }, { status: 400 });
    await requireFulfillStore(actor, storeId);
    const deleted = await deleteUnshippedFulfillLot(storeId, lot, actor.email || actor.displayName || actor.userId);
    return NextResponse.json({ deleted });
  } catch (error) {
    return routeErrorResponse(error, "Could not delete the shipment lot.");
  }
}
