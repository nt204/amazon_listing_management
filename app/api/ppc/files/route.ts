import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listManagedPpcFiles, deleteManagedPpcFile } from "@/lib/ppc/file-manager";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const data = await listManagedPpcFiles(scope);
    return Response.json({
      success: true,
      data,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách file báo cáo PPC.", 500);
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
