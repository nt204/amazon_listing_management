import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { requireFulfillStore } from "@/lib/fulfill/lot-access";
import { lotExcelResponse } from "@/lib/fulfill/lot-excel";
import { getFulfillLot } from "@/lib/fulfill/lots-db";

/** Xuất 1 đợt ra Excel đúng cột sheet gửi xưởng. */
export async function GET(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");
    const lotName = searchParams.get("lot");
    if (!storeId || !lotName) return NextResponse.json({ error: "Select a store and lot." }, { status: 400 });
    await requireFulfillStore(actor, storeId);
    const data = await getFulfillLot(storeId, lotName);
    if (!data) return NextResponse.json({ error: "Shipment lot not found." }, { status: 404 });
    return lotExcelResponse(data.lot, data.lines);
  } catch (error) {
    return routeErrorResponse(error, "Could not export the shipment lot to Excel.");
  }
}
