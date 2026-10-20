import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { listSkuWin } from "@/lib/accounting/sku-win-db";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    const store = await getStoreById(storeId);
    const storeName = store?.name || "STORE";

    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    const compareStartDate = searchParams.get("compare_start_date") || "";
    const compareEndDate = searchParams.get("compare_end_date") || "";
    const search = searchParams.get("search") || undefined;
    const productType = searchParams.get("product_type") || undefined;
    const status = searchParams.get("status") || undefined;
    const skuType = (searchParams.get("sku_type") as "all" | "win" | "loss" | "ordered") || "all";
    const sortField = searchParams.get("sort_field") || "profit";
    const sortDirection = (searchParams.get("sort_dir") as "asc" | "desc") || "desc";

    const result = await listSkuWin(storeId, {
      startDate,
      endDate,
      compareStartDate,
      compareEndDate,
      search,
      productType,
      status,
      skuType,
      sortField,
      sortDirection,
      page: 1,
      limit: 10000, // Export all matching items
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Amazon Listing Management";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("LỌC SKU WIN", {
      views: [{ state: "frozen", xSplit: 4, ySplit: 3 }],
    });

    // Row 1: Date Filter Header Controls
    const r1 = ws.getRow(1);
    r1.getCell(1).value = storeName;
    r1.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1E293B" } };
    r1.getCell(2).value = "Từ ngày";
    r1.getCell(2).font = { bold: true };
    r1.getCell(3).value = startDate || "Toàn thời gian";
    r1.getCell(4).value = "Đến ngày";
    r1.getCell(4).font = { bold: true };
    r1.getCell(5).value = endDate || "Hiện tại";

    if (compareStartDate && compareEndDate) {
      r1.getCell(30).value = "Từ ngày (so sánh)";
      r1.getCell(30).font = { bold: true };
      r1.getCell(31).value = compareStartDate;
      r1.getCell(32).value = "Đến ngày (so sánh)";
      r1.getCell(32).font = { bold: true };
      r1.getCell(33).value = compareEndDate;
    }

    // Row 2: Totals / SUM Row
    const r2 = ws.getRow(2);
    r2.getCell(4).value = "SUM =>";
    r2.getCell(4).font = { bold: true, color: { argb: "FF0F172A" } };
    r2.getCell(5).value = result.stats.totalRevenue;
    r2.getCell(5).numFmt = "$#,##0.00";
    r2.getCell(6).value = result.stats.totalQuantity;
    r2.getCell(6).numFmt = "#,##0";
    r2.getCell(7).value = result.stats.totalAdsFee;
    r2.getCell(7).numFmt = "$#,##0.00";
    r2.getCell(8).value = result.stats.totalBasecost;
    r2.getCell(8).numFmt = "$#,##0.00";
    r2.getCell(9).value = result.stats.totalAmazonFee;
    r2.getCell(9).numFmt = "$#,##0.00";
    r2.getCell(10).value = result.stats.totalThue;
    r2.getCell(10).numFmt = "$#,##0.00";
    r2.getCell(11).value = result.stats.totalPromotion;
    r2.getCell(11).numFmt = "$#,##0.00";
    r2.getCell(12).value = result.stats.totalReturnCost;
    r2.getCell(12).numFmt = "$#,##0.00";
    r2.getCell(13).value = result.stats.totalProfit;
    r2.getCell(13).numFmt = "$#,##0.00";
    r2.getCell(14).value = result.stats.totalQuantity > 0 ? result.stats.totalProfit / result.stats.totalQuantity : 0;
    r2.getCell(14).numFmt = "$#,##0.00";
    r2.getCell(15).value = result.stats.totalQuantity > 0 ? result.stats.totalBasecost / result.stats.totalQuantity : 0;
    r2.getCell(15).numFmt = "$#,##0.00";
    r2.getCell(16).value = result.stats.avgTacos;
    r2.getCell(16).numFmt = "0.00%";
    r2.getCell(17).value = result.stats.totalRevenueAds > 0 ? result.stats.totalAdsFee / result.stats.totalRevenueAds : 0;
    r2.getCell(17).numFmt = "0.00%";
    r2.getCell(18).value = result.stats.avgMargin;
    r2.getCell(18).numFmt = "0.00%";
    r2.getCell(19).value = result.stats.avgRoi;
    r2.getCell(19).numFmt = "0.00%";
    r2.getCell(24).value = result.stats.totalRevenueAds;
    r2.getCell(24).numFmt = "$#,##0.00";

    for (let c = 1; c <= 35; c++) {
      const cell = r2.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      cell.font = { bold: true };
    }

    // Row 3: Table Headers
    const headers = [
      "Product Type",
      "Image",
      "SKU",
      "ASIN",
      "Revenue",
      "Quantity",
      "Ads Fee",
      "Basecost",
      "Amazon Fee",
      "Thuế",
      "Promotion",
      "Return",
      "Profit",
      "Profit/item",
      "Basecost/item",
      "Tacos",
      "Acos",
      "MAGIN",
      "ROI",
      "Revenue mục tiêu",
      "Unit mục tiêu",
      "Spend mục tiêu",
      "Profit mục tiêu",
      "Revenue ads",
      "Lượng bán tổng",
      "Tỷ lệ Return",
      "Số hàng đã đi",
      "Brand",
      "Trạng thái",
      "Revenue (So sánh)",
      "Quantity (So sánh)",
      "Ads Fee (So sánh)",
      "Tacos (So sánh)",
      "Profit (So sánh)",
      "Tăng trưởng so với kỳ trước",
    ];

    const r3 = ws.getRow(3);
    headers.forEach((h, idx) => {
      const cell = r3.getCell(idx + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FF0F172A" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF9900" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "medium", color: { argb: "FFD97706" } },
        bottom: { style: "medium", color: { argb: "FFD97706" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
    r3.height = 28;

    // Data rows
    result.items.forEach((item, index) => {
      const row = ws.addRow([
        item.product_type || "",
        item.mockup_url || item.mockup || "",
        item.sku,
        item.asin || "",
        item.revenue,
        item.quantity,
        item.ads_fee,
        item.basecost,
        item.amazon_fee,
        item.thue,
        item.promotion,
        item.return_cost,
        item.profit,
        item.profit_per_item,
        item.basecost_per_item,
        item.tacos,
        item.acos,
        item.margin,
        item.roi,
        item.revenue_target != null ? item.revenue_target : "",
        item.unit_target != null ? item.unit_target : "",
        item.spend_target != null ? item.spend_target : "",
        item.profit_target != null ? item.profit_target : "",
        item.revenue_ads,
        item.all_time_quantity,
        item.return_rate,
        item.shipped_qty,
        item.brand || "",
        item.status || "",
        item.compare_revenue ?? "",
        item.compare_quantity ?? "",
        item.compare_ads_fee ?? "",
        item.compare_tacos ?? "",
        item.compare_profit ?? "",
        item.growth != null ? item.growth : "",
      ]);

      const isEven = index % 2 === 0;
      const bg = isEven ? "FFFFFFFF" : "FFF8FAFC";

      // Number formats
      row.getCell(5).numFmt = "$#,##0.00";
      row.getCell(6).numFmt = "#,##0";
      row.getCell(7).numFmt = "$#,##0.00";
      row.getCell(8).numFmt = "$#,##0.00";
      row.getCell(9).numFmt = "$#,##0.00";
      row.getCell(10).numFmt = "$#,##0.00";
      row.getCell(11).numFmt = "$#,##0.00";
      row.getCell(12).numFmt = "$#,##0.00";
      row.getCell(13).numFmt = "$#,##0.00";
      row.getCell(14).numFmt = "$#,##0.00";
      row.getCell(15).numFmt = "$#,##0.00";
      row.getCell(16).numFmt = "0.00%";
      row.getCell(17).numFmt = "0.00%";
      row.getCell(18).numFmt = "0.00%";
      row.getCell(19).numFmt = "0.00%";
      row.getCell(20).numFmt = "$#,##0.00";
      row.getCell(21).numFmt = "#,##0";
      row.getCell(22).numFmt = "$#,##0.00";
      row.getCell(23).numFmt = "$#,##0.00";
      row.getCell(24).numFmt = "$#,##0.00";
      row.getCell(25).numFmt = "#,##0";
      row.getCell(26).numFmt = "0.00%";
      row.getCell(27).numFmt = "#,##0";

      // Color coding for profit
      if (item.profit > 0) {
        row.getCell(13).font = { color: { argb: "FF16A34A" }, bold: true };
      } else if (item.profit < 0) {
        row.getCell(13).font = { color: { argb: "FFDC2626" }, bold: true };
      }

      for (let c = 1; c <= 35; c++) {
        const cell = row.getCell(c);
        if (!cell.fill || !("fgColor" in cell.fill)) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        }
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      }
    });

    // Column widths
    ws.columns = [
      { width: 18 }, // Product Type
      { width: 14 }, // Image
      { width: 22 }, // SKU
      { width: 16 }, // ASIN
      { width: 14 }, // Revenue
      { width: 10 }, // Quantity
      { width: 14 }, // Ads Fee
      { width: 14 }, // Basecost
      { width: 14 }, // Amazon Fee
      { width: 12 }, // Thuế
      { width: 12 }, // Promotion
      { width: 12 }, // Return
      { width: 15 }, // Profit
      { width: 13 }, // Profit/item
      { width: 13 }, // Basecost/item
      { width: 11 }, // Tacos
      { width: 11 }, // Acos
      { width: 11 }, // MAGIN
      { width: 11 }, // ROI
      { width: 15 }, // Rev target
      { width: 12 }, // Unit target
      { width: 14 }, // Spend target
      { width: 14 }, // Profit target
      { width: 14 }, // Revenue ads
      { width: 14 }, // Lượng bán tổng
      { width: 13 }, // Tỷ lệ Return
      { width: 13 }, // Số hàng đã đi
      { width: 14 }, // Brand
      { width: 13 }, // Status
      { width: 14 }, // Compare Rev
      { width: 12 }, // Compare Qty
      { width: 14 }, // Compare Ads Fee
      { width: 12 }, // Compare Tacos
      { width: 14 }, // Compare Profit
      { width: 16 }, // Growth
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `LOC_SKU_WIN_${storeName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to export SKU Win Excel.", 500);
  }
}
