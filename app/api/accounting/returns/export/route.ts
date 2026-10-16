import { NextRequest, NextResponse } from "next/server";
import { listReturns } from "@/lib/accounting/returns-db";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id") || searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const search = searchParams.get("search") || "";

    const { items } = await listReturns(storeId, {
      page: 1,
      limit: 50000,
      search,
      startDate,
      endDate,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("RETURN");

    worksheet.columns = [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Loại", key: "loai", width: 10 },
      { header: "PIC", key: "pic", width: 14 },
      { header: "Basecost", key: "basecost", width: 14 },
      { header: "Date", key: "date", width: 14 },
      { header: "Transaction Status", key: "transaction_status", width: 18 },
      { header: "Transaction type", key: "transaction_type", width: 16 },
      { header: "Order ID", key: "order_id", width: 22 },
      { header: "Product Details", key: "product_details", width: 36 },
      { header: "Total product charges", key: "total_product_charges", width: 18 },
      { header: "Total promotional rebates", key: "total_promotional_rebates", width: 20 },
      { header: "Amazon fees", key: "amazon_fees", width: 14 },
      { header: "Other", key: "other", width: 14 },
      { header: "Total (USD)", key: "total", width: 14 },
      { header: "Return sau khi trừ basecost", key: "return_sau_basecost", width: 22 },
      { header: "TUẦN", key: "tuan", width: 10 },
      { header: "THÁNG", key: "thang", width: 10 },
      { header: "Quý", key: "quy", width: 10 },
      { header: "Trạng thái", key: "trang_thai", width: 16 },
    ];

    items.forEach((item) => {
      worksheet.addRow({
        sku: item.sku,
        loai: item.loai,
        pic: item.pic,
        basecost: item.basecost,
        date: item.date,
        transaction_status: item.transaction_status,
        transaction_type: item.transaction_type,
        order_id: item.order_id,
        product_details: item.product_details,
        total_product_charges: item.total_product_charges,
        total_promotional_rebates: item.total_promotional_rebates,
        amazon_fees: item.amazon_fees,
        other: item.other,
        total: item.total,
        return_sau_basecost: item.return_sau_basecost,
        tuan: item.tuan,
        thang: item.thang,
        quy: item.quy,
        trang_thai: item.trang_thai,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Return_${startDate || "all"}_${endDate || "all"}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error("GET /api/accounting/returns/export error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to export returns file" },
      { status: 500 }
    );
  }
}
