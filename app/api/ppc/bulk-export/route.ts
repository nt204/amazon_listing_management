// app/api/ppc/bulk-export/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { exportBulkFromQueue, getBulkExportHistory, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const detailId = searchParams.get("id");
    const downloadId = searchParams.get("downloadId");

    // 1. Tải lại file .xlsx đã xuất trước đó
    if (downloadId) {
      const { reExportBulkFile } = await import("@/lib/ppc/sku-architecture-service");
      const { buffer, fileName } = await reExportBulkFile(downloadId);
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // 2. Lấy chi tiết các action của một đợt xuất file
    if (detailId) {
      const { getBulkExportDetails } = await import("@/lib/ppc/sku-architecture-service");
      const details = await getBulkExportDetails(detailId);
      return Response.json({ success: true, data: details });
    }

    // 3. Lấy danh sách lịch sử
    const rawStore = searchParams.get("storeId") || searchParams.get("storeName");
    let storeId: string | null = null;
    if (rawStore && rawStore !== "ALL") {
      storeId = await resolveStoreId(rawStore);
    }
    const history = await getBulkExportHistory(storeId);
    return Response.json({ success: true, data: history });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy thông tin xuất Bulk File.", 500);
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
