// app/api/ppc/actions/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  approveRecommendationsToActionQueue,
  getActionQueue,
  getActionQueueCount,
  removeActionFromQueue,
  removeActionsFromQueue,
  resolveStoreId,
  updateActionBid,
  updateActionsBids,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "ppc");
    const { searchParams } = new URL(request.url);
    const storeTarget = searchParams.get("storeName") || searchParams.get("storeId");
    const isAllStores = !storeTarget || storeTarget === "ALL";
    const storeId = isAllStores ? "ALL" : await resolveStoreId(storeTarget);
    const currentUser = actor.displayName || actor.userId;
    const userFilter = searchParams.get("allUsers") === "true" ? undefined : currentUser;

    if (searchParams.get("countOnly") === "true" || searchParams.get("count") === "1") {
      const count = await getActionQueueCount(storeId, userFilter);
      return Response.json({ success: true, count, data: count });
    }

    const queue = await getActionQueue(storeId, userFilter);
    return Response.json({ success: true, data: queue });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Action Queue.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      throw new ApiError("Không có đề xuất nào được gửi để duyệt.", 400);
    }

    const rawTarget =
      body?.storeId ||
      body?.storeName ||
      searchParams.get("storeId") ||
      searchParams.get("storeName");
    const fallbackStore =
      items[0]?.recommendation?.storeId || items[0]?.recommendation?.storeName;
    const storeTarget = rawTarget !== undefined && rawTarget !== null && rawTarget !== ""
      ? rawTarget
      : fallbackStore || "ALL";
    const storeId = (!storeTarget || storeTarget === "ALL")
      ? "ALL"
      : await resolveStoreId(storeTarget);

    const defaultApprovedBy = actor.displayName || actor.userId || "User";
    const res = await approveRecommendationsToActionQueue(storeId, items, defaultApprovedBy);
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
    await authorize(request, "write", "ppc");
    const { searchParams } = new URL(request.url);
    const storeTarget = searchParams.get("storeId") || searchParams.get("storeName");
    const isAllStores = !storeTarget || storeTarget === "ALL";
    const storeId = isAllStores ? "ALL" : await resolveStoreId(storeTarget);

    let bodyActionIds: string[] | undefined;
    let isAllFiltered = false;
    let excludedIds: string[] | undefined;
    let skuFilter: string | undefined;

    try {
      const body = await request.json();
      if (body?.mode === "ALL_FILTERED") {
        isAllFiltered = true;
        if (Array.isArray(body?.excludedIds)) {
          excludedIds = body.excludedIds.map((s: any) => String(s).trim()).filter(Boolean);
        }
        skuFilter = body?.filters?.sku || body?.sku;
      } else if (Array.isArray(body?.actionIds)) {
        bodyActionIds = body.actionIds;
      } else if (Array.isArray(body?.selectedIds)) {
        bodyActionIds = body.selectedIds;
      } else if (body?.actionId) {
        bodyActionIds = [body.actionId];
      }
    } catch { }

    if (isAllFiltered) {
      const count = await removeActionsFromQueue(storeId, [], {
        allFiltered: true,
        excludedActionIds: excludedIds,
        skuFilter: skuFilter && skuFilter !== "ALL" ? skuFilter : undefined,
      });
      return Response.json({
        success: true,
        count,
        message: `Đã xóa ${count} hành động phù hợp bộ lọc khỏi Action Queue.`,
      });
    }

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

export async function PATCH(request: Request) {
  try {
    await authorize(request, "write", "ppc");
    enforceRequestSize(request);

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const storeTarget =
      body?.storeId || body?.storeName || searchParams.get("storeId") || searchParams.get("storeName");
    const isAllStores = !storeTarget || storeTarget === "ALL";
    const storeId = isAllStores ? "ALL" : await resolveStoreId(storeTarget);

    // Support batch updates: { updates: [{ id, finalValue }] }
    if (Array.isArray(body?.updates) && body.updates.length > 0) {
      const res = await updateActionsBids(storeId, body.updates);
      return Response.json({
        success: true,
        message: `Đã cập nhật bid cho ${res.updatedCount} hành động.`,
        data: res,
      });
    }

    const actionId =
      body?.actionId || body?.id || searchParams.get("actionId") || searchParams.get("id");
    const finalValue = body?.finalValue ?? body?.bid ?? body?.newBid;

    if (!actionId || finalValue === undefined || finalValue === null) {
      throw new ApiError("Thiếu actionId hoặc giá trị bid mới (finalValue).", 400);
    }

    const res = await updateActionBid(storeId, String(actionId), Number(finalValue));
    return Response.json({
      success: true,
      message: `Đã cập nhật bid thành $${res.finalValue.toFixed(2)}.`,
      data: res,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật bid cho hành động.", 500);
  }
}

