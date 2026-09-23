import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { ingestPpcFilePath, PpcInputError } from "@/lib/ppc/service";
import { MultipartUploadError, streamMultipartFileUpload } from "@/lib/multipart-file-upload";

export const runtime = "nodejs";

const MAX_REPORT_BYTES = 150_000_000;

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, MAX_REPORT_BYTES + 5_000_000);
    const upload = await streamMultipartFileUpload(request, {
      fieldName: "file",
      maxFileBytes: MAX_REPORT_BYTES,
    });
    const { file } = upload;
    const storeName = String(upload.fields.storeName || "").trim();
    const reportDays = Number(upload.fields.reportDays || 30);
    const reportEndDate = String(upload.fields.reportEndDate || "").trim();

    try {
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
    if (file.bytes === 0 || file.bytes > MAX_REPORT_BYTES) {
      throw new ApiError("Báo cáo phải có dung lượng từ 1 byte đến 150 MB.", file.bytes > MAX_REPORT_BYTES ? 413 : 400);
    }

    const result = await ingestPpcFilePath(scope, file.path, file.name, storeName, {
      days: reportDays,
      endDate: reportEndDate || undefined,
    });

    const { invalidateCachePattern } = await import("@/lib/redis");
    await invalidateCachePattern(`ppc:metrics:${scope.teamId}:*`).catch(() => {});

    return Response.json({
      success: true,
      message: `Đã xử lý ${result.totalParsed} dòng: ${result.newInserted} dòng mới, ${result.updated} dòng cập nhật.`,
      result,
    });
    } finally {
      await upload.cleanup();
    }
  } catch (error) {
    console.error("[PPC Upload Route Error]", error);
    if (error instanceof MultipartUploadError) {
      return routeErrorResponse(new ApiError(error.message, error.status), "File upload không hợp lệ.");
    }
    if (error instanceof PpcInputError) {
      return routeErrorResponse(new ApiError(error.message, 400), "File PPC không hợp lệ.");
    }
    return routeErrorResponse(error, "Lỗi khi xử lý file Excel PPC.", 500);
  }
}
