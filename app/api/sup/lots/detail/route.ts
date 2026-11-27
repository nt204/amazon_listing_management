import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { getSupLot, logSupAccess, requireSupAccount } from "@/lib/fulfill/sup-db";

export async function GET(req: Request) {
  try {
    const account = await requireSupAccount(req);
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") ?? "";
    const lotName = searchParams.get("lot") ?? "";
    const data = storeId && lotName ? await getSupLot(account, storeId, lotName) : null;
    if (!data) return NextResponse.json({ error: "Lot not found." }, { status: 404 });
    await logSupAccess(account.id, "view", lotName);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Could not load the lot.");
  }
}
