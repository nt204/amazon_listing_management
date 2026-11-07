import { NextRequest, NextResponse } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { listSkuMonthly } from "@/lib/accounting/sku-monthly-db";
import { enqueueSkuMonthlyRecalc } from "@/lib/accounting/sku-monthly-recalc";

export async function GET(req: NextRequest) {
  try {
    const actor = await authorize(req, "read", "accounting");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");

    if (!storeId) {
      return NextResponse.json({ error: "Thiếu storeId" }, { status: 400 });
    }
    // Phân quyền kế toán: SKU Monthly là kênh FBA của store
    await requireStoreAccess(actor, storeId, "FBA");

    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : 2026;
    const monthParam = searchParams.get("month");
    const month = monthParam === "all" ? "all" : monthParam ? parseInt(monthParam, 10) : 9;

    const search = searchParams.get("search") || undefined;
    const productType = searchParams.get("productType") || undefined;
    const status = searchParams.get("status") || undefined;
    const skuType = (searchParams.get("skuType") as any) || "all";
    const sortField = searchParams.get("sortField") || "revenue";
    const sortDirection = (searchParams.get("sortDirection") as "asc" | "desc") || "desc";
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 100;

    const result = await listSkuMonthly(storeId, {
      year,
      month,
      search,
      productType,
      status,
      skuType,
      sortField,
      sortDirection,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (err) {
    return routeErrorResponse(err, "Lỗi nạp dữ liệu SKU Monthly", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorize(req, "write", "accounting");
    const body = await req.json();
    const { storeId, year, month } = body;

    if (!storeId || !year || !month) {
      return NextResponse.json({ error: "Thiếu storeId, year hoặc month" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA", "write");

    const period = `${year}-${String(month).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: "Kỳ không hợp lệ" }, { status: 400 });
    }

    // Không chạy script trong web process: accounting-import-worker tải file thô từ R2 rồi tính lại
    await enqueueSkuMonthlyRecalc(storeId, [period], "sku-monthly-button");

    return NextResponse.json({
      success: true,
      message: `Đã xếp hàng tính lại kỳ ${period} từ file thô trên R2 — khoảng 1–3 phút nữa tải lại trang để xem số mới`,
    });
  } catch (err) {
    return routeErrorResponse(err, "Lỗi khi tính toán dữ liệu thô", 500);
  }
}
