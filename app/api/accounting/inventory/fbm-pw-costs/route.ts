import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { exportFbmPwCosts, listFbmPwCosts } from "@/lib/accounting/fbm-pw-db";

/** BASECOST THÁNG FBM: danh sách dòng ĐẦU VÀO FBM PW (format=xlsx để xuất Excel theo bộ lọc hiện tại). */
export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) return Response.json({ error: "store_id is required" }, { status: 400 });
    const filter = {
      search: searchParams.get("search") || undefined,
      month: searchParams.get("month") || undefined,
    };

    if (searchParams.get("format") === "xlsx") {
      const store = await getStoreById(storeId);
      const rows = await exportFbmPwCosts(storeId, filter);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("ĐẦU VÀO FBM PW");
      ws.columns = [
        { header: "Order ID", key: "order_id", width: 22 },
        { header: "PWOrderId", key: "pw_order_id", width: 14 },
        { header: "OrderName", key: "order_name", width: 34 },
        { header: "NetPrice", key: "net_price", width: 11 },
        { header: "Ngày đặt", key: "order_date", width: 12 },
        { header: "SKU", key: "skus", width: 26 },
        { header: "Số lượng", key: "quantity", width: 10 },
      ];
      ws.views = [{ state: "frozen", ySplit: 1 }];
      const header = ws.getRow(1);
      header.font = { bold: true };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF9900" } };
      ws.addRows(rows);
      ws.getColumn("net_price").numFmt = "#,##0.00";
      const buffer = await wb.xlsx.writeBuffer();
      const storeName = (store?.name || "STORE").replace(/\s+/g, "_");
      const suffix = filter.month ? `_${filter.month}` : "";
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${storeName}_BASECOST_THANG_FBM${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        },
      });
    }

    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 100));
    return Response.json(await listFbmPwCosts(storeId, { ...filter, page, limit }));
  } catch (error) {
    return routeErrorResponse(error, "Không tải được Basecost FBM.", 500);
  }
}
