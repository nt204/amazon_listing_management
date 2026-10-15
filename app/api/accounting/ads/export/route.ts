import { NextRequest, NextResponse } from "next/server";
import { listAds } from "@/lib/accounting/ads-db";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id") || searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    const search = searchParams.get("search") || "";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const sku = searchParams.get("sku") || undefined;
    const mktPic = searchParams.get("mktPic") || undefined;

    // Fetch all matching rows up to 10000
    const data = await listAds(storeId, {
      page: 1,
      limit: 10000,
      search,
      startDate,
      endDate,
      sku,
      mktPic,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("ADS");

    worksheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Portfolio", key: "portfolio", width: 40 },
      { header: "Status", key: "status", width: 25 },
      { header: "Budget type", key: "budget_type", width: 16 },
      { header: "Budget(USD)", key: "budget", width: 15 },
      { header: "Budget start", key: "budget_start", width: 15 },
      { header: "Budget end", key: "budget_end", width: 15 },
      { header: "Campaign count", key: "campaign_count", width: 16 },
      { header: "Impressions", key: "impressions", width: 15 },
      { header: "Clicks", key: "clicks", width: 12 },
      { header: "CTR", key: "ctr", width: 12 },
      { header: "Spend(USD)", key: "spend", width: 15 },
      { header: "CPC(USD)", key: "cpc", width: 12 },
      { header: "Orders", key: "orders", width: 12 },
      { header: "Sales(USD)", key: "sales", width: 15 },
      { header: "ACOS", key: "acos", width: 12 },
      { header: "ROAS", key: "roas", width: 12 },
      { header: "NTB orders", key: "ntb_orders", width: 14 },
      { header: "% of orders NTB", key: "pct_orders_ntb", width: 16 },
      { header: "NTB sales(USD)", key: "ntb_sales", width: 16 },
      { header: "% of sales NTB", key: "pct_sales_ntb", width: 16 },
      { header: "Viewable impressions", key: "viewable_impressions", width: 20 },
      { header: "VCPM(USD)", key: "vcpm", width: 14 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Loại", key: "loai", width: 12 },
      { header: "MKT PIC", key: "mkt_pic", width: 15 },
      { header: "TUẦN", key: "tuan", width: 10 },
      { header: "THÁNG", key: "thang", width: 10 },
      { header: "Quý", key: "quy", width: 10 },
      { header: "Thuế 10%", key: "thue_10", width: 14 },
      { header: "Trạng thái", key: "trang_thai", width: 16 },
    ];

    // Format header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 24;

    for (const r of data.rows) {
      worksheet.addRow({
        date: r.date,
        portfolio: r.portfolio,
        status: r.status,
        budget_type: r.budget_type,
        budget: r.budget,
        budget_start: r.budget_start,
        budget_end: r.budget_end,
        campaign_count: r.campaign_count,
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        spend: r.spend,
        cpc: r.cpc,
        orders: r.orders,
        sales: r.sales,
        acos: r.acos,
        roas: r.roas,
        ntb_orders: r.ntb_orders,
        pct_orders_ntb: r.pct_orders_ntb,
        ntb_sales: r.ntb_sales,
        pct_sales_ntb: r.pct_sales_ntb,
        viewable_impressions: r.viewable_impressions,
        vcpm: r.vcpm,
        sku: r.sku,
        loai: r.loai,
        mkt_pic: r.mkt_pic,
        tuan: r.tuan,
        thang: r.thang,
        quy: r.quy,
        thue_10: r.thue_10,
        trang_thai: r.trang_thai,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `ADS_${storeId}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error("GET /api/accounting/ads/export error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to export ads" },
      { status: 500 }
    );
  }
}
