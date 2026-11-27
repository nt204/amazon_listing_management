import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { listFulfillSkuMaster, syncFromAccountingSkuMaster, upsertFulfillSkuMasterItem } from "@/lib/fulfill/db";

export async function GET(req: Request) {
  try {
    await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") || undefined;
    const search = searchParams.get("search") || undefined;

    const items = await listFulfillSkuMaster({ storeId, search });
    return NextResponse.json({ items });
  } catch (error) {
    return routeErrorResponse(error, "Could not load SKU Master.");
  }
}

export async function POST(req: Request) {
  try {
    await authorizeFulfill(req, "write");
    const body = (await readJsonBody(req)) as any;

    if (body?.action === "sync") {
      const storeId = body?.store_id || undefined;
      const res = await syncFromAccountingSkuMaster(storeId);
      return NextResponse.json({ success: true, message: `Synced ${res.synced} ${res.synced === 1 ? "SKU" : "SKUs"} from Accounting.` });
    }

    if (!body?.store_id || !body?.sku) {
      return NextResponse.json({ error: "Store and SKU are required." }, { status: 400 });
    }

    const item = await upsertFulfillSkuMasterItem(body);
    return NextResponse.json({ item, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Could not save the SKU.");
  }
}
