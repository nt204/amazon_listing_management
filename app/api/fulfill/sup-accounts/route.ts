import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { canManageFulfill } from "@/lib/fulfill/access";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { fulfillStoreScope } from "@/lib/fulfill/lot-access";
import { requireSupManager, supAccountSchema } from "@/lib/fulfill/sup-manage";
import { createSupAccount, listSupAccounts, listSupSummaries } from "@/lib/fulfill/sup-db";

export async function GET(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "read");
    if (canManageFulfill(actor)) {
      const [accounts, sups] = await Promise.all([listSupAccounts(), listSupSummaries()]);
      return NextResponse.json({ accounts, sups, canManage: true });
    }
    // Team: chỉ xưởng có lô ở store team được phân; chỉ xem (nút View), không thấy email / lịch sử
    const sups = await listSupSummaries(await fulfillStoreScope(actor));
    const visible = new Set(sups.map((s) => s.sup.trim().toLowerCase()));
    const accounts = (await listSupAccounts())
      .filter((a) => a.is_active && a.sup_names.some((n) => visible.has(n.trim().toLowerCase())))
      .map((a) => ({ id: a.id, email: "", display_name: a.display_name, sup_names: a.sup_names, is_active: a.is_active, notes: null, created_at: a.created_at, last_seen_at: null }));
    return NextResponse.json({ accounts, sups, canManage: false });
  } catch (error) {
    return routeErrorResponse(error, "Could not load supplier accounts.");
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireSupManager(req, "write");
    const input = supAccountSchema.parse(await readJsonBody(req, 20_000));
    const account = await createSupAccount(input, actor.displayName || actor.email || actor.userId);
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Could not create the supplier account.");
  }
}
