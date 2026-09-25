import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import {
  listManagedPpcFiles,
  deleteManagedPpcFile,
  organizeAllLocalBulkFiles,
  LOCAL_BULK_DIR,
} from "@/lib/ppc/file-manager";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const url = new URL(request.url);
    const storeFilter = url.searchParams.get("storeName")?.trim().toUpperCase();
    const dateFilter = url.searchParams.get("date")?.trim();
    const adTypeFilter = url.searchParams.get("adType")?.trim().toUpperCase();

    const data = await listManagedPpcFiles(scope);

    let files = data.files;
    if (storeFilter && storeFilter !== "ALL") {
      files = files.filter((f) => f.storeName.toUpperCase() === storeFilter);
    }
    if (dateFilter) {
      files = files.filter((f) => f.reportDate === dateFilter);
    }
    if (adTypeFilter && (adTypeFilter === "SP" || adTypeFilter === "SB")) {
      files = files.filter((f) => f.adType === adTypeFilter);
    }

    return Response.json({
      success: true,
      data: {
        ...data,
        files,
        localBulkDir: LOCAL_BULK_DIR,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách file báo cáo PPC.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const body = await request.json().catch(() => ({}));
    const action = body.action || "organize";

    if (action === "organize") {
      const result = organizeAllLocalBulkFiles();
      const data = await listManagedPpcFiles(scope);
      return Response.json({
        success: true,
        message: `Đã tổ chức lại thư mục báo cáo (${result.movedCount} file được phân loại).`,
        movedCount: result.movedCount,
        files: result.files,
        data,
      });
    }

    if (action === "cleanup_duplicate_batches") {
      const { cleanupDuplicateR2Batches } = await import("@/lib/ppc/file-manager");
      const result = await cleanupDuplicateR2Batches();
      const data = await listManagedPpcFiles(scope);
      return Response.json({
        success: true,
        message: result.deletedBatches.length > 0
          ? `Đã dọn dẹp ${result.deletedBatches.length} đợt cũ trùng ngày (${result.deletedFilesCount} file, ${(result.freedBytes / (1024 * 1024)).toFixed(1)} MB).`
          : "Không có đợt dữ liệu cũ trùng ngày nào cần dọn dẹp (tất cả các ngày đều đang chuẩn).",
        result,
        data,
      });
    }

    throw new ApiError(`Hành động '${action}' không được hỗ trợ.`, 400);
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xử lý thao tác file PPC.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const purgeDb = Boolean(body.purgeDb);

    if (items.length === 0) {
      throw new ApiError("Vui lòng chọn ít nhất một file để xóa.", 400);
    }

    const results = [];
    for (const item of items) {
      if (!item.fileName) continue;
      const res = await deleteManagedPpcFile(scope, {
        fileName: item.fileName,
        serverPath: item.serverPath,
        r2Key: item.r2Key,
        purgeDb,
      });
      results.push({ fileName: item.fileName, ...res });
    }

    return Response.json({
      success: true,
      deletedCount: results.length,
      results,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa file PPC.", 500);
  }
}

