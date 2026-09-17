// app/api/ppc/cost-master/import/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { importCostMasterFromExcel } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request, 15_000_000);

    const formData = await request.formData();
    const file = formData.get("file") || formData.get("excel");

    if (!(file instanceof File)) {
      throw new ApiError("Vui lòng tải lên một file Excel (.xlsx hoặc .xls).", 400);
    }

    if (file.size > 10_000_000) {
      throw new ApiError("Kích thước file vượt quá giới hạn cho phép (10MB).", 413);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await importCostMasterFromExcel(buffer);

    return Response.json({
      success: true,
      message: `Đã import thành công ${result.importedCount} loại phôi vào Cost Master!`,
      importedCount: result.importedCount,
      items: result.items,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi import file Excel Cost Master.", 500);
  }
}
