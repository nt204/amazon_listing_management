// app/api/ppc/auto-upload/route.ts
import { authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
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
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      const details = await getAutoUploadDetails(id);
      return Response.json({ success: true, data: details });
    }

    const storeId = await resolveStoreId(searchParams.get("storeId"));
    const logs = await getAutoUploadLogs(storeId);
    return Response.json({ success: true, data: logs });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy thông tin Auto Upload AdsPower.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    authorize(request, "write");
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
    const actor = authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json().catch(() => ({}));
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(body?.storeId || searchParams.get("storeId"));
    const actionIds = Array.isArray(body?.actionIds) ? body.actionIds : undefined;
    const allowAllSkus = body?.allowAllSkus === true || (Array.isArray(actionIds) && actionIds.length > 0);

    const result = await executeAutoUploadZeroSpendActions(storeId, actionIds, actor.teamId, { allowAllSkus });

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
