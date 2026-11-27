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
    return routeErrorResponse(error, "Không thể tải SKU Master Fulfill.");
  }
}

export async function POST(req: Request) {
  try {
    await authorizeFulfill(req, "write");
    const body = (await readJsonBody(req)) as any;

    if (body?.action === "sync") {
      const storeId = body?.store_id || undefined;
      const res = await syncFromAccountingSkuMaster(storeId);
      return NextResponse.json({ success: true, message: `Đã đồng bộ ${res.synced} SKU từ Bảng Mã Kế Toán sang Fulfill!` });
    }

    if (!body?.store_id || !body?.sku) {
      return NextResponse.json({ error: "Store và SKU là bắt buộc." }, { status: 400 });
    }

    const item = await upsertFulfillSkuMasterItem(body);
    return NextResponse.json({ item, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lưu SKU Master Fulfill.");
  }
}
