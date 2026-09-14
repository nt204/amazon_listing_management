import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { ingestPpcExcelFile, PpcInputError } from "@/lib/ppc/service";

export const runtime = "nodejs";

const MAX_EXCEL_BYTES = 15_000_000;

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, MAX_EXCEL_BYTES + 1_000_000);
    const formData = await request.formData();
    const file = formData.get("file");
    const storeName = String(formData.get("storeName") || "").trim();

    if (!(file instanceof File)) {
      throw new ApiError("Vui lòng chọn file Excel (.xlsx) để tải lên.", 400);
    }
    if (!storeName || storeName.length > 80) {
      throw new ApiError("Tên store không hợp lệ.", 400);
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new ApiError("Chỉ hỗ trợ định dạng file Excel (.xlsx).", 400);
    }
    if (file.size === 0 || file.size > MAX_EXCEL_BYTES) {
      throw new ApiError("File Excel phải có dung lượng từ 1 byte đến 15 MB.", file.size > MAX_EXCEL_BYTES ? 413 : 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new ApiError("Nội dung file không phải workbook .xlsx hợp lệ.", 400);
    }

    const result = await ingestPpcExcelFile(scope, buffer, file.name, storeName);

    return Response.json({
      success: true,
      message: `Đã xử lý ${result.totalParsed} dòng: ${result.newInserted} dòng mới, ${result.updated} dòng cập nhật.`,
      result,
    });
  } catch (error) {
    if (error instanceof PpcInputError) {
      return routeErrorResponse(new ApiError(error.message, 400), "File PPC không hợp lệ.");
    }
    return routeErrorResponse(error, "Lỗi khi xử lý file Excel PPC.", 500);
  }
}
