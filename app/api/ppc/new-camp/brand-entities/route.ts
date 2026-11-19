import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { listStoreBrandEntities, saveStoreBrandEntity } from "@/lib/ppc/new-camp-db";
import { BRAND_ENTITY_PATTERN } from "@/lib/ppc/new-camp-fields";

export const runtime = "nodejs";

/** GET: Brand Entity ID theo store (store trong Bảng mã + đã lưu). */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    return Response.json({ success: true, data: await listStoreBrandEntities() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được Brand Entity theo store.", 500);
  }
}

/** PUT { store, brandEntityId }: lưu Entity của store; brandEntityId rỗng = xoá. */
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request, 10_000);
    const body = await request.json().catch(() => ({}));
    const store = String(body?.store || "").trim();
    const entity = String(body?.brandEntityId || "").trim().toUpperCase();
    if (!store) throw new ApiError("Thiếu tên store.", 400);
    if (entity && !BRAND_ENTITY_PATTERN.test(entity)) throw new ApiError("Brand Entity ID phải dạng ENTITY + chữ/số (vd ENTITY3AT8FKLQW4N7D).", 400);
    await saveStoreBrandEntity(store, entity, actor.userId);
    return Response.json({ success: true, data: await listStoreBrandEntities() });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được Brand Entity.", 500);
  }
}
