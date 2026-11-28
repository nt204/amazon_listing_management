import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { requireFulfillStore } from "@/lib/fulfill/lot-access";
import { getLotFormOptions } from "@/lib/fulfill/lot-create";

/** Dữ liệu cho form tạo yêu cầu đi hàng: SKU Bảng Mã (kèm lần đặt gần nhất), Sup, Line ship, Type. */
export async function GET(req: Request) {
  try {
    // GET: trình duyệt không gửi Origin nên dùng quyền đọc; store phải thuộc team (requireFulfillStore)
    const actor = await authorizeFulfill(req, "read");
    const storeId = new URL(req.url).searchParams.get("storeId");
    if (!storeId) return NextResponse.json({ error: "Select a store." }, { status: 400 });
    await requireFulfillStore(actor, storeId);
    return NextResponse.json(await getLotFormOptions(storeId));
  } catch (error) {
    return routeErrorResponse(error, "Could not load SKU Master.");
  }
}
