// app/api/ppc/bulk-export/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { exportBulkFromQueue, getBulkExportHistory, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));

    const history = await getBulkExportHistory(storeId);
    return Response.json({ success: true, data: history });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy lịch sử xuất Bulk File.", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(body?.storeId || searchParams.get("storeId"));
    const actionIds = Array.isArray(body?.actionIds) ? body.actionIds : undefined;

    const result = await exportBulkFromQueue(storeId, actionIds);

    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "X-Action-Count": String(result.actionCount),
        "X-Update-Bid-Count": String(result.summary.updateBid),
        "X-Pause-Count": String(result.summary.pause),
        "X-Budget-Count": String(result.summary.budget),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xuất Bulk File từ Action Queue.", 500);
  }
}
