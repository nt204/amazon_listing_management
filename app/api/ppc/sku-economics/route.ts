// app/api/ppc/sku-economics/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { z } from "zod";
import { getSkuEconomicsList, saveSkuProductTypeMappings, upsertSkuEconomics, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

const mappingSchema = z.object({
  storeId: z.string().trim().min(1).optional(),
  storeName: z.string().trim().min(1).optional(),
  mappings: z.array(z.object({
    sku: z.string().trim().min(1).max(256),
    productType: z.string().trim().min(1).max(160),
    asin: z.string().trim().max(32).optional(),
  }).strict()).min(1).max(200),
}).strict();

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));
    const days = Number(searchParams.get("days") || 30);

    const list = await getSkuEconomicsList(storeId, days);
    return Response.json({ success: true, data: list });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách SKU Economics.", 500);
  }
}

export async function POST(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json();
    const { searchParams } = new URL(request.url);

    if (Array.isArray(body?.mappings)) {
      const input = mappingSchema.parse(body);
      const mappingStoreId = await resolveStoreId(input.storeId || input.storeName || searchParams.get("storeId"));
      const updated = await saveSkuProductTypeMappings(mappingStoreId, input.mappings);
      return Response.json({ success: true, data: updated, updatedCount: updated.length });
    }

    const storeId = await resolveStoreId(body?.storeId || body?.storeName || searchParams.get("storeId"));

    if (!body?.sku) {
      throw new ApiError("Thiếu mã SKU cần cập nhật.", 400);
    }

    const updated = await upsertSkuEconomics(storeId, body.sku, {
      asin: body.asin,
      productType: body.productType,
      sellingPrice: body.sellingPrice !== undefined ? Number(body.sellingPrice) : undefined,
      baseCost: body.baseCost !== undefined ? Number(body.baseCost) : undefined,
      amazonFee: body.amazonFee !== undefined ? Number(body.amazonFee) : undefined,
      taxRate: body.taxRate !== undefined ? Number(body.taxRate) : undefined,
      cr: body.cr !== undefined ? Number(body.cr) : undefined,
      crSource: body.crSource,
      costSource: body.costSource,
    });

    return Response.json({ success: true, data: updated });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật SKU Economics.", 500);
  }
}
