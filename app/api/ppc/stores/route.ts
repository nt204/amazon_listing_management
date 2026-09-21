// app/api/ppc/stores/route.ts
import { ApiError, authorize, dataScope, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  createPpcStore,
  deletePpcStore,
  findPpcStoreByName,
  listPpcStores,
  updatePpcStore,
} from "@/lib/ppc/repository";

export const runtime = "nodejs";

const VALID_MARKETPLACES = new Set([
  "US", "CA", "MX", "BR",
  "UK", "DE", "FR", "IT", "ES", "NL", "SE", "PL",
  "JP", "AU", "SG", "AE", "SA", "IN",
]);

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const stores = await listPpcStores(scope);
    return Response.json({ success: true, data: stores });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách store PPC.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, 100_000);

    const body = await request.json();
    const rawName = String(body?.name || "").trim();

    if (!rawName) {
      throw new ApiError("Vui lòng nhập tên store.", 400);
    }
    if (rawName.length > 80) {
      throw new ApiError("Tên store không được vượt quá 80 ký tự.", 400);
    }
    if (rawName.toUpperCase() === "ALL") {
      throw new ApiError("Tên 'ALL' là từ khóa hệ thống, vui lòng chọn tên khác.", 400);
    }
    // Chặn các ký tự nhạy cảm trong URL hoặc filename
    if (/[/\\?%*:|"<>#]/.test(rawName)) {
      throw new ApiError("Tên store chứa ký tự không hợp lệ (không chứa / \\ ? % * : | \" < > #).", 400);
    }

    // Kiểm tra trùng lặp tên store
    const existing = await findPpcStoreByName(scope, rawName);
    if (existing) {
      throw new ApiError(`Store "${rawName}" đã tồn tại trên hệ thống.`, 409);
    }

    const rawMarketplace = String(body?.marketplace || "US").trim().toUpperCase();
    const marketplace = VALID_MARKETPLACES.has(rawMarketplace) ? rawMarketplace : "US";

    let targetAcos = Number(body?.targetAcos ?? 30.0);
    if (isNaN(targetAcos) || targetAcos <= 0 || targetAcos > 200) {
      targetAcos = 30.0;
    }

    let dailyBudget = Number(body?.dailyBudget ?? 0.0);
    if (isNaN(dailyBudget) || dailyBudget < 0 || dailyBudget > 1_000_000) {
      dailyBudget = 0.0;
    }

    // Tạo Store mới
    const newStore = await createPpcStore(scope, {
      name: rawName,
      marketplace,
      targetAcos: Math.round(targetAcos * 100) / 100,
      dailyBudget: Math.round(dailyBudget * 100) / 100,
      status: "ACTIVE",
    });

    return Response.json({
      success: true,
      message: `Đã tạo store "${newStore.name}" (${newStore.marketplace}) thành công!`,
      data: newStore,
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo store mới.", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    enforceRequestSize(request, 100_000);

    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) {
      throw new ApiError("Thiếu ID store để cập nhật.", 400);
    }

    const rawName = body?.name !== undefined ? String(body.name).trim() : undefined;
    if (rawName !== undefined) {
      if (!rawName) throw new ApiError("Tên store không được để trống.", 400);
      if (rawName.toUpperCase() === "ALL") throw new ApiError("Tên 'ALL' là từ khóa hệ thống.", 400);
      if (/[/\\?%*:|"<>#]/.test(rawName)) {
        throw new ApiError("Tên store chứa ký tự không hợp lệ.", 400);
      }
    }

    const rawMarketplace = body?.marketplace !== undefined ? String(body.marketplace).trim().toUpperCase() : undefined;
    const marketplace = rawMarketplace && VALID_MARKETPLACES.has(rawMarketplace) ? rawMarketplace : undefined;

    const targetAcos = body?.targetAcos !== undefined ? Number(body.targetAcos) : undefined;
    const status = body?.status === "PAUSED" ? "PAUSED" : body?.status === "ACTIVE" ? "ACTIVE" : undefined;

    const updated = await updatePpcStore(scope, id, {
      name: rawName,
      marketplace,
      targetAcos,
      status,
    });

    return Response.json({
      success: true,
      message: `Đã cập nhật store "${updated.name}" thành công!`,
      data: updated,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật store.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id")?.trim();

    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = String(body?.id || "").trim();
    }

    if (!id) {
      throw new ApiError("Vui lòng chỉ định ID store cần xóa.", 400);
    }

    const result = await deletePpcStore(scope, id);
    return Response.json({
      success: true,
      message: `Đã xóa store "${result.deletedName}" và dữ liệu phôi liên quan.`,
      data: result,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa store.", 500);
  }
}

