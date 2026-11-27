import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireSupManager, supAccountSchema } from "@/lib/fulfill/sup-manage";
import { createSupAccount, listSupAccounts, listSupSummaries } from "@/lib/fulfill/sup-db";

export async function GET(req: Request) {
  try {
    await requireSupManager(req, "read");
    const [accounts, sups] = await Promise.all([listSupAccounts(), listSupSummaries()]);
    return NextResponse.json({ accounts, sups });
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
