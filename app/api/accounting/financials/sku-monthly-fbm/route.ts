import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { listFbmSkuMonthly } from "@/lib/accounting/fbm-sku-monthly-db";
import { enqueueSkuMonthlyRecalc } from "@/lib/accounting/sku-monthly-recalc";

// Tab "SKU FBM-monthly" (file TỔNG KẾT CUỐI THÁNG) — cùng tham số với /api/accounting/financials/sku-monthly
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId");
    if (!storeId) {
      return Response.json({ error: "Thiếu storeId" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBM");

    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : 2026;
    const monthParam = searchParams.get("month");
    const month = monthParam === "all" ? "all" : monthParam ? parseInt(monthParam, 10) : undefined;

    const result = await listFbmSkuMonthly(storeId, {
      year,
      month,
      search: searchParams.get("search") || undefined,
      productType: searchParams.get("productType") || undefined,
      status: searchParams.get("status") || undefined,
      skuType: (searchParams.get("skuType") as "all" | "active" | "win" | "loss") || "all",
      sortField: searchParams.get("sortField") || "revenue",
      sortDirection: (searchParams.get("sortDirection") as "asc" | "desc") || "desc",
    });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Lỗi nạp dữ liệu SKU FBM-monthly", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { storeId, year, month } = await request.json();
    if (!storeId || !year || !month) {
      return Response.json({ error: "Thiếu storeId, year hoặc month" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBM", "write");
    const period = `${year}-${String(month).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return Response.json({ error: "Kỳ không hợp lệ" }, { status: 400 });
    }
    // accounting-import-worker tải file thô từ R2 rồi chạy ingest_monthly_from_raw.py --channel fbm
    await enqueueSkuMonthlyRecalc(storeId, [period], "sku-monthly-fbm-button", "fbm");
    return Response.json({
      success: true,
      message: `Đã xếp hàng tính lại SKU FBM-monthly kỳ ${period} từ file thô trên R2 — khoảng 1–3 phút nữa tải lại trang để xem số mới`,
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xếp hàng tính lại SKU FBM-monthly", 500);
  }
}
