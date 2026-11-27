import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { listFulfillSuppliers, upsertFulfillSupplier } from "@/lib/fulfill/db";

export async function GET(req: Request) {
  try {
    await authorizeFulfill(req, "read");
    const suppliers = await listFulfillSuppliers();
    return NextResponse.json({ suppliers });
  } catch (error) {
    return routeErrorResponse(error, "Could not load suppliers.");
  }
}

export async function POST(req: Request) {
  try {
    await authorizeFulfill(req, "write");
    const body = (await readJsonBody(req)) as any;
    if (!body?.code || !body?.name) {
      return NextResponse.json({ error: "Supplier code and name are required." }, { status: 400 });
    }

    const supplier = await upsertFulfillSupplier(body);
    return NextResponse.json({ supplier, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Could not save the supplier.");
  }
}
