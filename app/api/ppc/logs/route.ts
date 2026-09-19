import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listPpcSyncLogs, clearPpcSyncLogs } from "@/lib/ppc/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));
    const logs = await listPpcSyncLogs(scope, limit);

    const stats = {
      total: logs.length,
      success: logs.filter((l) => l.status === "SUCCESS").length,
      failed: logs.filter((l) => l.status === "FAILED").length,
      running: logs.filter((l) => l.status === "RUNNING").length,
      lastSyncTime: logs[0]?.time ?? null,
    };

    return Response.json({
      data: logs,
      stats,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải nhật ký PPC.");
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    await clearPpcSyncLogs(scope);
    return Response.json({
      success: true,
      message: "Đã làm sạch toàn bộ nhật ký đồng bộ & nạp file PPC.",
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể làm sạch nhật ký PPC.");
  }
}
