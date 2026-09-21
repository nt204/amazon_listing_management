// app/api/ppc/cost-master/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  exportCostMasterToExcel,
  getCostMastersWithStores,
  saveCostMasterNewVersion,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId") || searchParams.get("store") || undefined;

    if (searchParams.get("export") === "excel") {
      const { buffer, storeName } = await exportCostMasterToExcel(storeId);
      const dateStr = new Date().toISOString().split("T")[0];
      const safeStoreName = (storeName || "Store").replace(/[^a-zA-Z0-9_-]/g, "_");
      return new Response(buffer as any, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="Cost_Master_${safeStoreName}_${dateStr}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const { masters, stores, activeStoreId } = await getCostMastersWithStores(storeId);
    return Response.json({
      success: true,
      data: masters,
      stores,
      activeStoreId,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Phôi (Cost Master).", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json();

    if (body?.action === "clone") {
      const sourceStore = String(body.sourceStore || "HSOSTORE").trim();
      const targetStore = String(body.targetStore || "").trim();
      if (!targetStore) {
        throw new ApiError("Vui lòng chỉ định store đích để sao chép.", 400);
      }
      const { cloneCostMasters } = await import("@/lib/ppc/sku-architecture-service");
      const res = await cloneCostMasters(sourceStore, targetStore);
      return Response.json({
        success: true,
        message: `Đã sao chép thành công ${res.clonedCount} mục phôi từ ${sourceStore} sang ${targetStore}!`,
        data: res,
      });
    }

    if (!body?.productType) {
      throw new ApiError("Thiếu thông tin loại phôi (productType).", 400);
    }

    const saved = await saveCostMasterNewVersion({
      storeId: body.storeId || undefined,
      productType: String(body.productType).trim(),
      baseCost: Number(body.baseCost || 0),
      defaultAmazonFee: Number(body.defaultAmazonFee || 0),
      taxRate: Number(body.taxRate || 0.03),
      defaultPrice: Number(body.defaultPrice || 0),
      breakEvenAcos: Number(body.breakEvenAcos || 0),
      effectiveFrom: body.effectiveFrom,
      notes: body.notes,
    });

    return Response.json({ success: true, data: saved });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lưu phiên bản Phôi mới.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    authorize(request, "write");
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id")?.trim();
    const storeId = searchParams.get("storeId") || searchParams.get("store") || undefined;

    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = String(body?.id || "").trim();
    }

    if (!id) {
      throw new ApiError("Vui lòng cung cấp ID của phôi cần xóa.", 400);
    }

    const { deleteCostMaster } = await import("@/lib/ppc/sku-architecture-service");
    const success = await deleteCostMaster(id, storeId);

    if (!success) {
      throw new ApiError("Không tìm thấy dòng phôi để xóa.", 404);
    }

    return Response.json({
      success: true,
      message: "Đã xóa dòng phôi thành công.",
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa dòng phôi.", 500);
  }
}


