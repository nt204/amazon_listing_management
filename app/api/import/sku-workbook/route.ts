import { createSkuInputSample, parseSkuWorkbook } from "@/lib/excel-automation";
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const workbook = await createSkuInputSample();
    return new Response(workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="sku-input-template.xlsx"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tạo file Excel mẫu.");
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request, 12_000_000);
    const formData = await request.formData();
    const workbook = formData.get("workbook");
    if (!(workbook instanceof File)) {
      throw new ApiError("Hãy chọn file Excel đầu vào.", 400);
    }
    if (workbook.size > 10_000_000) {
      throw new ApiError("File Excel vượt quá 10 MB.", 413);
    }
    const result = await parseSkuWorkbook(Buffer.from(await workbook.arrayBuffer()), workbook.name);
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Không thể đọc file Excel.");
  }
}
