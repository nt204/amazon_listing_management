import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { channelParam, requireStoreAccess } from "@/lib/accounting/access";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { listFbaDaily } from "@/lib/accounting/fba-daily-db";
import { listFbmDaily, type FbmDailyItem } from "@/lib/accounting/fbm-financials-db";

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, channelParam(searchParams.get("channel")));

    const store = await getStoreById(storeId);
    const storeName = store?.name || "STORE";

    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    const search = searchParams.get("search") || undefined;
    const sortField = searchParams.get("sort_field") || "date";
    const sortDirection = (searchParams.get("sort_dir") as "asc" | "desc") || "asc";

    const fbm = searchParams.get("channel") === "fbm";
    const channel = fbm ? "FBM" : "FBA";
    const result = await (fbm ? listFbmDaily : listFbaDaily)(storeId, {
      startDate,
      endDate,
      search,
      sortField,
      sortDirection,
      page: 1,
      limit: 10000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Amazon Listing Management";
    workbook.created = new Date();

    const ws = workbook.addWorksheet(channel, {
      views: [{ state: "frozen", xSplit: 3, ySplit: 2 }],
    });

    // Header title row 1
    const r1 = ws.getRow(1);
    r1.getCell(1).value = channel;
    r1.getCell(2).value = `BÁO CÁO DOANH THU - ${channel}`;
    r1.getCell(3).value = storeName;
    r1.font = { bold: true, size: 11 };

    // Column Headers row 2
    const headers = [
      "Tuần",
      "Date",
      "Revenue",
      "Quantity",
      "Ads Fee",
      "Base Cost",
      "AMZ Fee",
      "Thuế",
      "Promotion",
      "Refund",
      "Profit",
      "Net Profit",
      "Balance",
      "ROI",
      "TAcos",
      "Acos",
      "% Profit",
      "% Profit trước ADS",
      "Profit/item",
      "Revenue ads",
      "Quantity (Ads)",
      "Click",
      ...(fbm ? ["Organic sale", "AOV (Rev/Qt)", "Basecost/item", "Ads/Item"] : []),
    ];

    const r2 = ws.getRow(2);
    headers.forEach((h, idx) => {
      const cell = r2.getCell(idx + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF59E0B" }, // Amber header
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: idx < 2 ? "center" : "right",
      };
    });

    // Populate data
    result.items.forEach((item, index) => {
      const row = ws.getRow(index + 3);
      row.values = [
        item.week,
        item.date,
        item.revenue,
        item.quantity,
        item.ads_fee,
        item.basecost,
        item.amazon_fee,
        item.thue,
        item.promotion,
        item.return_cost,
        item.profit,
        // Sheet FBM để trống Net Profit (không có phí dịch vụ cố định)
        fbm ? null : item.net_profit,
        item.balance,
        item.roi,
        item.tacos,
        item.acos,
        item.margin,
        item.margin_pre_ads,
        item.profit_per_item,
        item.revenue_ads,
        item.quantity_ads,
        item.clicks,
        ...(fbm
          ? [(item as FbmDailyItem).organic_sales, (item as FbmDailyItem).aov, (item as FbmDailyItem).basecost_per_item, (item as FbmDailyItem).ads_per_item]
          : []),
      ];

      // Formats
      [3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 19, 20, ...(fbm ? [24, 25, 26] : [])].forEach((colIdx) => {
        row.getCell(colIdx).numFmt = "$#,##0.00";
      });
      [4, 21, 22, ...(fbm ? [23] : [])].forEach((colIdx) => {
        row.getCell(colIdx).numFmt = "#,##0";
      });
      [14, 15, 16, 17, 18].forEach((colIdx) => {
        row.getCell(colIdx).numFmt = "0.0%";
      });

      // Profit color
      const profitCell = row.getCell(11);
      profitCell.font = {
        bold: true,
        color: { argb: item.profit >= 0 ? "FF059669" : "FFDC2626" },
      };
    });

    // Auto-fit column widths
    ws.columns.forEach((col, idx) => {
      col.width = Math.max(12, (headers[idx]?.length || 10) + 4);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${channel}_Daily_${storeName}_${startDate || "All"}_${endDate || dateStr}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to export daily Excel.", 500);
  }
}
