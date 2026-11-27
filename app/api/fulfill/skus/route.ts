import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { fulfillStoreScope } from "@/lib/fulfill/lot-access";
import { listFulfillSkus } from "@/lib/fulfill/sku-catalog";

/** Bảng Mã (chỉ đọc) cho tab SKU Master của Đi hàng — chỉ store team được phân. */
export async function GET(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);
    const data = await listFulfillSkus({
      storeIds: await fulfillStoreScope(actor),
      storeId: searchParams.get("storeId") || undefined,
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search") || undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Could not load the SKU master.");
  }
}
