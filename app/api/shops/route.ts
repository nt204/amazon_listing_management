import { z } from "zod";
import { ApiError, authorize, dataScope, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { deleteAmazonShop, listAmazonShops, saveAmazonShop } from "@/lib/db";

const shopSchema = z.object({
  name: z.string().trim().min(1, "Tên shop là bắt buộc.").max(80),
  seller_id: z.string().trim().max(80).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    return Response.json({ shops: await listAmazonShops(scope) });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách shop Amazon.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_templates"));
    const payload = shopSchema.parse(await readJsonBody(request, 20_000));
    const shop = await saveAmazonShop(scope, {
      name: payload.name,
      sellerId: payload.seller_id,
    });
    return Response.json({ shop }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lưu shop Amazon.");
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "manage_templates"));
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!z.uuid().safeParse(id).success) throw new ApiError("Shop Amazon không hợp lệ.", 400);
    const success = await deleteAmazonShop(scope, id);
    if (!success) {
      throw new ApiError("Chỉ có thể xóa shop chưa có template. Hãy chuyển hoặc xóa template trước.", 409);
    }
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa shop Amazon.");
  }
}
