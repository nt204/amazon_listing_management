import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { SUP_LOT_COLUMNS } from "@/lib/fulfill/lot-columns";
import { lotExcelResponse } from "@/lib/fulfill/lot-excel";
import { getSupLot, logSupAccess, requireSupAccount } from "@/lib/fulfill/sup-db";

export async function GET(req: Request) {
  try {
    const account = await requireSupAccount(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") ?? "";
    const lotName = searchParams.get("lot") ?? "";
    const data = storeId && lotName ? await getSupLot(account, storeId, lotName) : null;
    if (!data) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
    if (!account.preview) await logSupAccess(account.id, "export", lotName);
    return lotExcelResponse(data.lot, data.lines, SUP_LOT_COLUMNS);
  } catch (error) {
    return routeErrorResponse(error, "Could not export the lot.");
  }
}
