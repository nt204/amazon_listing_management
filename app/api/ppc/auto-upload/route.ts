// app/api/ppc/auto-upload/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import {
  cancelAutoUploadJob,
  executeAutoUploadZeroSpendActions,
  getAutoUploadDetails,
  getAutoUploadLogs,
  resolveStoreId,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      const details = await getAutoUploadDetails(id);
      return Response.json({ success: true, data: details });
    }

    const rawStore = searchParams.get("storeId") || searchParams.get("storeName");
    let storeId: string | null = null;
    if (rawStore && rawStore !== "ALL") {
      storeId = await resolveStoreId(rawStore);
    }
    const logs = await getAutoUploadLogs(storeId);
    return Response.json({ success: true, data: logs });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy thông tin Auto Upload AdsPower.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return Response.json({ success: false, message: "Thiếu ID tác vụ" }, { status: 400 });
    }
    const cancelled = await cancelAutoUploadJob(id);
    if (!cancelled) {
      return Response.json(
        { success: false, message: "Không thể hủy tác vụ (chỉ hủy được tác vụ đang ở trạng thái PENDING)." },
        { status: 400 }
      );
    }
    return Response.json({ success: true, message: "Đã hủy tác vụ thành công." });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi hủy tác vụ.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const storeTarget = (body?.storeId || body?.storeName || searchParams.get("storeId") || searchParams.get("storeName") || "").trim();
    const actionIds = Array.isArray(body?.actionIds) ? body.actionIds : undefined;
    const allowAllSkus = body?.allowAllSkus === true || (Array.isArray(actionIds) && actionIds.length > 0);
    const sql = await getDatabaseClient();

    let finalStoreId: string;

    if (actionIds && actionIds.length > 0) {
      // 1. Xác thực store thực tế của các actions trong DB
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
        const storeNames = actionStoreRows.map((r) => `"${r.store_name}"`).join(", ");
        throw new ApiError(
          `Cảnh báo an toàn: Các hành động được chọn thuộc nhiều Store khác nhau (${storeNames}). Để tránh nhầm lẫn tài khoản Amazon Ads, vui lòng lọc riêng từng Store trước khi Auto Upload.`,
          400
        );
      }

      const verifiedStore = actionStoreRows[0];

      // Nếu client có truyền storeTarget (và không phải ALL), đối chiếu kiểm tra bất đồng bộ
      if (storeTarget && storeTarget !== "ALL") {
        const targetStoreRows = await sql<{ id: string; name: string }[]>`
          SELECT id, name FROM ppc_stores
          WHERE (id::text = ${storeTarget} OR LOWER(name) = LOWER(${storeTarget}))
            AND team_id = ${actor.teamId}
          LIMIT 1
        `;
        if (targetStoreRows.length > 0 && targetStoreRows[0].id !== verifiedStore.store_id) {
          throw new ApiError(
            `Bất đồng bộ Store: Bạn đang chọn Store "${targetStoreRows[0].name}" nhưng các hành động cần upload lại thuộc Store "${verifiedStore.store_name}". Hệ thống đã chặn tác vụ để bảo vệ tài khoản Amazon Ads!`,
            400
          );
        }
      }

      finalStoreId = verifiedStore.store_id;
    } else {
      // Auto upload toàn bộ queue mà không chọn actionIds cụ thể: BẮT BUỘC phải chỉ định 1 store cụ thể
      if (!storeTarget || storeTarget === "ALL") {
        throw new ApiError(
          "Không thể Auto Upload khi đang chọn 'Tất cả Store'. Vui lòng chọn một Store cụ thể trên thanh công cụ để bảo đảm không upload nhầm tài khoản Amazon Ads.",
          400
        );
      }

      const storeRows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM ppc_stores
        WHERE (id::text = ${storeTarget} OR LOWER(name) = LOWER(${storeTarget}))
          AND team_id = ${actor.teamId}
        LIMIT 1
      `;

      if (!storeRows.length) {
        throw new ApiError(`Không tìm thấy Store "${storeTarget}" trong hệ thống.`, 404);
      }

      finalStoreId = storeRows[0].id;
    }

    const result = await executeAutoUploadZeroSpendActions(finalStoreId, actionIds, actor.teamId, {
      allowAllSkus,
      createdBy: actor.displayName || actor.userId,
    });

    return Response.json({
      success: true,
      data: result.log,
      fileName: result.fileName,
      fileBase64: result.fileBase64,
      message: result.message,
    }, { status: 202 });
  } catch (error: unknown) {
    return routeErrorResponse(error, error instanceof Error ? error.message : "Lỗi khi xếp hàng upload Bulk.", 500);
  }
}
