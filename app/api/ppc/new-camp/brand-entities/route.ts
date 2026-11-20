import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { listStoreBrandEntities, saveStoreBrand } from "@/lib/ppc/new-camp-db";
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

/** PUT { store, brandEntityId?, brandLogoAssetId? }: lưu Entity / Logo của store; chuỗi rỗng = xoá. */
export async function PUT(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request, 10_000);
    const body = await request.json().catch(() => ({}));
    const store = String(body?.store || "").trim();
    const entity = typeof body?.brandEntityId === "string" ? body.brandEntityId.trim().toUpperCase() : undefined;
    const logo = typeof body?.brandLogoAssetId === "string" ? body.brandLogoAssetId.trim() : undefined;
    if (!store) throw new ApiError("Thiếu tên store.", 400);
    if (entity && !BRAND_ENTITY_PATTERN.test(entity)) throw new ApiError("Brand Entity ID phải dạng ENTITY + chữ/số (vd ENTITY3AT8FKLQW4N7D).", 400);
    if (logo && !/^amzn1\.assetlibrary\.asset1\.[a-z0-9]+(:version_v\d+)?$/i.test(logo)) throw new ApiError("Logo Asset ID phải dạng amzn1.assetlibrary.asset1…", 400);
    await saveStoreBrand(store, { brandEntityId: entity, brandLogoAssetId: logo }, actor.userId);
    return Response.json({ success: true, data: await listStoreBrandEntities() });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được Brand Entity.", 500);
  }
}
