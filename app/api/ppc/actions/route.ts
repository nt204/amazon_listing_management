// app/api/ppc/actions/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  approveRecommendationsToActionQueue,
  getActionQueue,
  removeActionFromQueue,
  removeActionsFromQueue,
  resolveStoreId,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));

    const queue = await getActionQueue(storeId);
    return Response.json({ success: true, data: queue });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Action Queue.", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(body?.storeId || searchParams.get("storeId"));

    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      throw new ApiError("Không có đề xuất nào được gửi để duyệt.", 400);
    }

    const res = await approveRecommendationsToActionQueue(storeId, items);
    return Response.json({
      success: true,
      message: `Đã duyệt ${res.addedCount} hành động vào Action Queue (${res.supersededCount} hành động cũ được thay thế).`,
      data: res,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi duyệt đề xuất vào Action Queue.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    authorize(request, "write");
    const { searchParams } = new URL(request.url);
    const storeId = await resolveStoreId(searchParams.get("storeId"));

    let bodyActionIds: string[] | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.actionIds)) bodyActionIds = body.actionIds;
      else if (body?.actionId) bodyActionIds = [body.actionId];
    } catch { }

    const queryActionId = searchParams.get("actionId") || searchParams.get("id");
    const queryActionIds = searchParams.get("actionIds")
      ? searchParams.get("actionIds")!.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const actionIds = bodyActionIds || queryActionIds || (queryActionId ? [queryActionId] : []);

    if (actionIds.length === 0) {
      throw new ApiError("Thiếu actionId hoặc actionIds cần xóa.", 400);
    }

    const count = await removeActionsFromQueue(storeId, actionIds);
    return Response.json({
      success: true,
      count,
      message: `Đã xóa ${count} hành động khỏi Action Queue.`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa hành động.", 500);
  }
}
