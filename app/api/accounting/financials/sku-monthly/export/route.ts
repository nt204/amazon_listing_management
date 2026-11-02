import { NextRequest, NextResponse } from "next/server";
import { listSkuMonthly } from "@/lib/accounting/sku-monthly-db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId");

    if (!storeId) {
      return new NextResponse("Thiếu storeId", { status: 400 });
    }

    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : 2026;
    const monthParam = searchParams.get("month");
    const month = monthParam === "all" ? "all" : monthParam ? parseInt(monthParam, 10) : 9;

    const search = searchParams.get("search") || undefined;
    const productType = searchParams.get("productType") || undefined;
    const status = searchParams.get("status") || undefined;
    const skuType = (searchParams.get("skuType") as any) || "all";
    const sortField = searchParams.get("sortField") || "revenue";
    const sortDirection = (searchParams.get("sortDirection") as "asc" | "desc") || "desc";

    const result = await listSkuMonthly(storeId, {
      year,
      month,
      search,
      productType,
      status,
      skuType,
      sortField,
      sortDirection,
      page: 1,
      limit: 10000,
    });

    // CSV Headers matching Excel SKU-monthly (36 data columns without mockup)
    const headers = [
      "Product Type",
      "SKU",
      "ASIN",
      "Revenue",
      "Quantity",
      "Ads Fee",
      "Basecost",
      "Amazon Fee (chưa ghi nhận)",
      "Amazon fee (transperance report)",
      "Thuế",
      "Return",
      "Adjustment",
      "Lưu kho",
      "Placement Fee",
      "Long-Term Fee",
      "FBA Customer Return Fee",
      "Liquidations",
      "Basecost Return/Adjustment",
      "Removal",
      "Profit",
      "Available now",
      "TAcos (%)",
      "Acos (%)",
      "Margin (%)",
      "ROI (%)",
      "Profit/item",
      "Basecost/Item",
      "VAT/Tax Adjustment",
      "SL đã removal 2024",
      "AWD/Subscription/Amazon Fees/Disposal Fee",
      "Basecost Adjustment",
      "Revenue ads",
      "Tháng listing",
      "Tháng đánh giá",
      "Trạng thái",
      "FNSKU",
    ];

    const formatNum = (num: number | null | undefined, decimals = 2) => {
      if (num === null || num === undefined) return "";
      return Number(num).toFixed(decimals);
    };

    const formatPct = (num: number | null | undefined) => {
      if (num === null || num === undefined) return "";
      return (Number(num) * 100).toFixed(2) + "%";
    };

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows: string[] = [];

    // Row 1: Summary Row
    const s = result.summary;
    rows.push(
      [
        escapeCsv(`${s.active_sku_count}/${s.total_sku_count} active`),
        escapeCsv("TOTAL"),
        escapeCsv(""),
        escapeCsv(formatNum(s.total_revenue)),
        escapeCsv(s.total_quantity),
        escapeCsv(formatNum(s.total_ads_fee)),
        escapeCsv(formatNum(s.total_basecost)),
        escapeCsv(formatNum(s.total_amazon_fee_unrecognized)),
        escapeCsv(formatNum(s.total_amazon_fee_trans)),
        escapeCsv(formatNum(s.total_thue)),
        escapeCsv(formatNum(s.total_return_amount)),
        escapeCsv(formatNum(s.total_adjustment)),
        escapeCsv(formatNum(s.total_storage_fee, 3)),
        escapeCsv(formatNum(s.total_placement_fee)),
        escapeCsv(formatNum(s.total_long_term_fee)),
        escapeCsv(formatNum(s.total_fba_customer_return_fee)),
        escapeCsv(formatNum(s.total_liquidations)),
        escapeCsv(formatNum(s.total_basecost_return_adj)),
        escapeCsv(formatNum(s.total_removal)),
        escapeCsv(formatNum(s.net_profit)),
        escapeCsv(s.total_available_now),
        escapeCsv(formatPct(s.tacos)),
        escapeCsv(formatPct(s.acos)),
        escapeCsv(formatPct(s.margin)),
        escapeCsv(formatPct(s.roi)),
        escapeCsv(s.total_quantity > 0 ? formatNum(s.net_profit / s.total_quantity) : ""),
        escapeCsv(s.total_quantity > 0 ? formatNum(s.total_basecost / s.total_quantity) : ""),
        escapeCsv(formatNum(s.vat_tax_adjustment)),
        escapeCsv(result.items.reduce((sum, item) => sum + (item.removal_qty_2024 || 0), 0)),
        escapeCsv(formatNum(s.awd_subscription_fees)),
        escapeCsv(formatNum(s.basecost_adjustment)),
        escapeCsv(formatNum(s.total_revenue_ads)),
        escapeCsv(""),
        escapeCsv(""),
        escapeCsv(""),
        escapeCsv(""),
      ].join(",")
    );

    // Detail Rows
    for (const item of result.items) {
      rows.push(
        [
          escapeCsv(item.product_type),
          escapeCsv(item.sku),
          escapeCsv(item.asin),
          escapeCsv(formatNum(item.revenue)),
          escapeCsv(item.quantity),
          escapeCsv(formatNum(item.ads_fee)),
          escapeCsv(formatNum(item.basecost)),
          escapeCsv(formatNum(item.amazon_fee_unrecognized)),
          escapeCsv(formatNum(item.amazon_fee_trans)),
          escapeCsv(formatNum(item.thue)),
          escapeCsv(formatNum(item.return_amount)),
          escapeCsv(formatNum(item.adjustment)),
          escapeCsv(formatNum(item.storage_fee, 3)),
          escapeCsv(formatNum(item.placement_fee)),
          escapeCsv(formatNum(item.long_term_fee)),
          escapeCsv(formatNum(item.fba_customer_return_fee)),
          escapeCsv(formatNum(item.liquidations)),
          escapeCsv(formatNum(item.basecost_return_adjustment)),
          escapeCsv(formatNum(item.removal)),
          escapeCsv(formatNum(item.profit)),
          escapeCsv(item.available_now),
          escapeCsv(formatPct(item.tacos)),
          escapeCsv(formatPct(item.acos)),
          escapeCsv(formatPct(item.margin)),
          escapeCsv(formatPct(item.roi)),
          escapeCsv(formatNum(item.profit_per_item)),
          escapeCsv(formatNum(item.basecost_per_item)),
          escapeCsv(formatNum(item.vat_tax_adjustment)),
          escapeCsv(item.removal_qty_2024 || 0),
          escapeCsv(formatNum(item.awd_subscription_fees)),
          escapeCsv(formatNum(item.basecost_adjustment)),
          escapeCsv(formatNum(item.revenue_ads)),
          escapeCsv(item.listing_month),
          escapeCsv(item.review_month),
          escapeCsv(item.status),
          escapeCsv(item.fnsku),
        ].join(",")
      );
    }

    const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
    const monthStr = month === "all" ? "AllMonths" : `Thang_${month}`;
    const filename = `SKU_Monthly_${monthStr}_${year}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("[API SKU Monthly Export] Error:", err);
    return new NextResponse("Lỗi xuất file SKU Monthly", { status: 500 });
  }
}
