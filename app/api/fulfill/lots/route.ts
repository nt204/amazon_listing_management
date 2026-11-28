import { NextResponse } from "next/server";
import { ApiError, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { fulfillStoreScope, requireFulfillStore } from "@/lib/fulfill/lot-access";
import { createFulfillLot, createLotSchema } from "@/lib/fulfill/lot-create";
import { listFulfillLots } from "@/lib/fulfill/lots-db";

/** Danh sách đợt hàng lấy từ CHI TIẾT ĐI HÀNG (mỗi Tên lô = 1 đợt). */
export async function GET(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);
    const data = await listFulfillLots({
      storeIds: await fulfillStoreScope(actor),
      storeId: searchParams.get("storeId") || undefined,
      sup: searchParams.get("sup") || undefined,
      search: searchParams.get("search") || undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Could not load shipment lots.");
  }
}

/** Tạo yêu cầu đi hàng: ghi các dòng vào CHI TIẾT ĐI HÀNG (source = fulfill). */
export async function POST(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "write");
    const parsed = createLotSchema.safeParse(await readJsonBody(req, 2_000_000));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const [, row, field] = issue.path;
      const where = issue.path[0] === "lines" && typeof row === "number" ? `Row ${row + 1}${field ? ` (${String(field)})` : ""}: ` : "";
      throw new ApiError(`${where}${issue.message}`, 400);
    }
    const input = parsed.data;
    await requireFulfillStore(actor, input.store_id, "write");
    const result = await createFulfillLot(input, {
      userId: actor.userId,
      name: actor.displayName || actor.email || actor.userId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Could not create the shipment request.");
  }
}
