import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { ingestPpcExcelFile, PpcInputError } from "@/lib/ppc/service";

export const runtime = "nodejs";

const MAX_REPORT_BYTES = 150_000_000;

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, MAX_REPORT_BYTES + 5_000_000);
    const formData = await request.formData();
    const file = formData.get("file");
    const storeName = String(formData.get("storeName") || "").trim();
    const reportDays = Number(formData.get("reportDays") || 30);
    const reportEndDate = String(formData.get("reportEndDate") || "").trim();

    if (!(file instanceof File)) {
      throw new ApiError("Vui lòng chọn báo cáo PPC (.xlsx hoặc .csv).", 400);
    }
    if (!storeName || storeName.length > 80) {
      throw new ApiError("Tên store không hợp lệ.", 400);
    }
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      throw new ApiError("Chỉ hỗ trợ báo cáo PPC .xlsx hoặc .csv.", 400);
    }
    if (!Number.isInteger(reportDays) || reportDays < 1 || reportDays > 3650) {
      throw new ApiError("Số ngày của báo cáo phải từ 1 đến 3650.", 400);
    }
    if (reportEndDate && !/^20\d{2}-[01]\d-[0-3]\d$/.test(reportEndDate)) {
      throw new ApiError("Ngày kết thúc báo cáo không hợp lệ.", 400);
    }
    if (file.size === 0 || file.size > MAX_REPORT_BYTES) {
      throw new ApiError("Báo cáo phải có dung lượng từ 1 byte đến 150 MB.", file.size > MAX_REPORT_BYTES ? 413 : 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (file.name.toLowerCase().endsWith(".xlsx") && (buffer[0] !== 0x50 || buffer[1] !== 0x4b)) {
      throw new ApiError("Nội dung file không phải workbook .xlsx hợp lệ.", 400);
    }

    const result = await ingestPpcExcelFile(scope, buffer, file.name, storeName, {
      days: reportDays,
      endDate: reportEndDate || undefined,
    });

    return Response.json({
      success: true,
      message: `Đã xử lý ${result.totalParsed} dòng: ${result.newInserted} dòng mới, ${result.updated} dòng cập nhật.`,
      result,
    });
  } catch (error) {
    console.error("[PPC Upload Route Error]", error);
    if (error instanceof PpcInputError) {
      return routeErrorResponse(new ApiError(error.message, 400), "File PPC không hợp lệ.");
    }
    return routeErrorResponse(error, "Lỗi khi xử lý file Excel PPC.", 500);
  }
}
