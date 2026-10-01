// app/api/ppc/bulk-export/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { exportBulkFromQueue, getBulkExportHistory, resolveStoreId } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
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
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const actionIds = Array.isArray(body?.actionIds) ? body.actionIds : undefined;
    const sql = await getDatabaseClient();

    let finalStoreId: string;
    if (actionIds && actionIds.length > 0) {
      const actionStoreRows = await sql<{ store_id: string; store_name: string }[]>`
        SELECT DISTINCT a.store_id, s.name as store_name
        FROM ppc_actions a
        JOIN ppc_stores s ON s.id = a.store_id
        WHERE a.id = ANY(${actionIds})
      `;
      if (actionStoreRows.length === 0) {
        throw new ApiError("Không tìm thấy hành động nào trong danh sách được chọn.", 400);
      }
      if (actionStoreRows.length > 1) {
        const names = actionStoreRows.map((r) => `"${r.store_name}"`).join(", ");
        throw new ApiError(
          `Các hành động được chọn thuộc nhiều Store khác nhau (${names}). Vui lòng lọc riêng từng Store trước khi xuất file Bulk.`,
          400
        );
      }
      finalStoreId = actionStoreRows[0].store_id;
    } else {
      const storeTarget = (body?.storeId || body?.storeName || searchParams.get("storeId") || searchParams.get("storeName") || "").trim();
      if (!storeTarget || storeTarget === "ALL") {
        throw new ApiError("Vui lòng chọn 1 Store cụ thể trước khi xuất file Bulk từ hàng đợi.", 400);
      }
      const storeRows = await sql<{ id: string }[]>`
        SELECT id FROM ppc_stores
        WHERE (id::text = ${storeTarget} OR lower(name) = lower(${storeTarget}))
          AND team_id = ${actor.teamId}
        LIMIT 1
      `;
      if (!storeRows.length) throw new ApiError(`Không tìm thấy Store "${storeTarget}".`, 404);
      finalStoreId = storeRows[0].id;
    }

    const result = await exportBulkFromQueue(finalStoreId, actionIds, actor.displayName || actor.userId);

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
