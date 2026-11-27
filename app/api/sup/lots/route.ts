import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { listSupLots, logSupAccess, requireSupAccount } from "@/lib/fulfill/sup-db";

// Trang xưởng: chỉ có GET. Dữ liệu đọc qua role chỉ đọc (lib/fulfill/sup-db.ts).
export async function GET(req: Request) {
  try {
    const account = await requireSupAccount(req);
    const lots = await listSupLots(account);
    if (!account.preview) await logSupAccess(account.id, "list");
    return NextResponse.json({ lots }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Could not load lots.");
  }
}
