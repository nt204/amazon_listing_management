import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { deleteSupAccount, listSupAccessLog, updateSupAccount } from "@/lib/fulfill/sup-db";
import { requireSupManager, supAccountSchema } from "@/lib/fulfill/sup-manage";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  try {
    await requireSupManager(req, "read");
    const { id } = await params;
    return NextResponse.json({ log: await listSupAccessLog(id) });
  } catch (error) {
    return routeErrorResponse(error, "Could not load access history.");
  }
}

export async function PATCH(req: Request, { params }: Context) {
  try {
    await requireSupManager(req, "write");
    const { id } = await params;
    const input = supAccountSchema.parse(await readJsonBody(req, 20_000));
    return NextResponse.json({ account: await updateSupAccount(id, input) });
  } catch (error) {
    return routeErrorResponse(error, "Could not update the supplier account.");
  }
}

export async function DELETE(req: Request, { params }: Context) {
  try {
    await requireSupManager(req, "write");
    const { id } = await params;
    await deleteSupAccount(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "Could not delete the supplier account.");
  }
}
