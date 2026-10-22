import ExcelJS from "exceljs";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getStoreById } from "@/lib/accounting/accounting-db";
import { listSkuTest } from "@/lib/accounting/sku-win-db";

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

    const result = await listSkuTest(storeId, {
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

    const ws = workbook.addWorksheet("LỌC SKU TEST", {
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
        item.compare_revenue != null ? item.compare_revenue : "",
        item.compare_quantity != null ? item.compare_quantity : "",
        item.compare_ads_fee != null ? item.compare_ads_fee : "",
        item.compare_tacos != null ? item.compare_tacos : "",
        item.compare_profit != null ? item.compare_profit : "",
        item.growth != null ? item.growth : "",
      ]);

      const isEven = index % 2 === 0;
      const rowFillColor = isEven ? "FFFFFFFF" : "FFF8FAFC";

      // Formats & Alignments
      row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
      row.getCell(2).alignment = { vertical: "middle", horizontal: "center" };
      row.getCell(3).alignment = { vertical: "middle", horizontal: "left" };
      row.getCell(3).font = { bold: true };
      row.getCell(4).alignment = { vertical: "middle", horizontal: "center" };

      // Financials
      row.getCell(5).numFmt = "$#,##0.00"; // Revenue
      row.getCell(6).numFmt = "#,##0"; // Quantity
      row.getCell(7).numFmt = "$#,##0.00"; // Ads Fee
      row.getCell(8).numFmt = "$#,##0.00"; // Basecost
      row.getCell(9).numFmt = "$#,##0.00"; // Amazon Fee
      row.getCell(10).numFmt = "$#,##0.00"; // Thuế
      row.getCell(11).numFmt = "$#,##0.00"; // Promotion
      row.getCell(12).numFmt = "$#,##0.00"; // Return
      row.getCell(13).numFmt = "$#,##0.00"; // Profit
      row.getCell(13).font = {
        bold: true,
        color: { argb: item.profit > 0 ? "FF15803D" : item.profit < 0 ? "FFDC2626" : "FF64748B" },
      };

      row.getCell(14).numFmt = "$#,##0.00"; // Profit/item
      row.getCell(15).numFmt = "$#,##0.00"; // Basecost/item
      row.getCell(16).numFmt = "0.00%"; // Tacos
      row.getCell(17).numFmt = "0.00%"; // Acos
      row.getCell(18).numFmt = "0.00%"; // Margin
      row.getCell(19).numFmt = "0.00%"; // ROI

      row.getCell(20).numFmt = "$#,##0.00"; // Rev target
      row.getCell(21).numFmt = "#,##0"; // Unit target
      row.getCell(22).numFmt = "$#,##0.00"; // Spend target
      row.getCell(23).numFmt = "$#,##0.00"; // Profit target

      row.getCell(24).numFmt = "$#,##0.00"; // Revenue ads
      row.getCell(25).numFmt = "#,##0"; // All time qty
      row.getCell(26).numFmt = "0.00%"; // Return rate
      row.getCell(27).numFmt = "#,##0"; // Shipped qty

      row.getCell(28).alignment = { vertical: "middle", horizontal: "center" };
      row.getCell(29).alignment = { vertical: "middle", horizontal: "center" };

      // Comparison cells
      if (item.compare_revenue != null) row.getCell(30).numFmt = "$#,##0.00";
      if (item.compare_quantity != null) row.getCell(31).numFmt = "#,##0";
      if (item.compare_ads_fee != null) row.getCell(32).numFmt = "$#,##0.00";
      if (item.compare_tacos != null) row.getCell(33).numFmt = "0.00%";
      if (item.compare_profit != null) {
        row.getCell(34).numFmt = "$#,##0.00";
        row.getCell(34).font = {
          bold: true,
          color: { argb: (item.compare_profit || 0) > 0 ? "FF15803D" : "FFDC2626" },
        };
      }
      if (item.growth != null) {
        row.getCell(35).numFmt = "+0.00%;-0.00%;0.00%";
        row.getCell(35).font = {
          bold: true,
          color: { argb: item.growth >= 0 ? "FF15803D" : "FFDC2626" },
        };
      }

      for (let c = 1; c <= 35; c++) {
        const cell = row.getCell(c);
        if (!cell.fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowFillColor } };
        }
        cell.border = {
          top: { style: "thin", color: { argb: "FFF1F5F9" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFF1F5F9" } },
          right: { style: "thin", color: { argb: "FFF1F5F9" } },
        };
      }
    });

    // Set Column Widths
    ws.columns = [
      { width: 18 }, // Product Type
      { width: 12 }, // Image
      { width: 22 }, // SKU
      { width: 16 }, // ASIN
      { width: 14 }, // Revenue
      { width: 10 }, // Quantity
      { width: 12 }, // Ads Fee
      { width: 12 }, // Basecost
      { width: 14 }, // Amazon Fee
      { width: 10 }, // Thuế
      { width: 12 }, // Promotion
      { width: 12 }, // Return
      { width: 14 }, // Profit
      { width: 12 }, // Profit/item
      { width: 14 }, // Basecost/item
      { width: 10 }, // Tacos
      { width: 10 }, // Acos
      { width: 10 }, // MAGIN
      { width: 10 }, // ROI
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
    const filename = `LOC_SKU_TEST_${storeName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to export SKU Test Excel.", 500);
  }
}
