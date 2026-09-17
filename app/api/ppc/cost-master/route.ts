// app/api/ppc/cost-master/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import { exportCostMasterToExcel, getCostMasters, saveCostMasterNewVersion } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);

    if (searchParams.get("export") === "excel") {
      const buffer = await exportCostMasterToExcel();
      const dateStr = new Date().toISOString().split("T")[0];
      return new Response(buffer as any, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="Cost_Master_Amazon_PPC_${dateStr}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const masters = await getCostMasters();
    return Response.json({ success: true, data: masters });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Phôi (Cost Master).", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request);

    const body = await request.json();
    if (!body?.productType) {
      throw new ApiError("Thiếu thông tin loại phôi (productType).", 400);
    }

    const saved = await saveCostMasterNewVersion({
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
