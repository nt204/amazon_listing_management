import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import { listFbmSkuMonthly } from "@/lib/accounting/fbm-sku-monthly-db";

// Xuất CSV tab SKU FBM-monthly: dòng TOTAL rồi từng SKU, cột theo thứ tự sheet
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("storeId");
    if (!storeId) {
      return new Response("Thiếu storeId", { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBM");

    const year = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : 2026;
    const monthParam = searchParams.get("month");
    const month = monthParam === "all" ? "all" : monthParam ? parseInt(monthParam, 10) : undefined;
    const { items, summary: s } = await listFbmSkuMonthly(storeId, {
      year,
      month,
      search: searchParams.get("search") || undefined,
    });

    const num = (v: number | null | undefined) => (v == null ? "" : Number(v).toFixed(2));
    const pct = (v: number | null | undefined) => (v == null ? "" : `${(Number(v) * 100).toFixed(2)}%`);
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "Product Type", "SKU", "ASIN", "Revenue", "Quantity", "Ads Fee", "Basecost", "Amazon Fee (chưa ghi nhận)",
      "Amazon fee (transperance report)", "Thuế", "Return", "A-to-z Guarantee Claim", "Chargeback Refund", "Profit",
      "TAcos", "Acos", "Magin", "ROI", "Profit/item", "Basecost/Item", "Phí chủ store", "Revenue ads", "Trạng thái",
    ];
    const lines = [
      headers.map(cell).join(","),
      [
        `${s.active_sku_count}/${s.total_sku_count} active`, "TOTAL", "", num(s.total_revenue), s.total_quantity,
        num(s.total_ads_fee), num(s.total_basecost), num(s.total_amazon_fee_unrecognized), num(s.total_amazon_fee_trans),
        num(s.total_thue), num(s.total_return_amount), num(s.total_a_to_z_claim), num(s.total_chargeback_refund),
        num(s.net_profit), pct(s.tacos), pct(s.acos), pct(s.margin), pct(s.roi),
        s.total_quantity > 0 ? num(s.net_profit / s.total_quantity) : "",
        s.total_quantity > 0 ? num(s.total_basecost / s.total_quantity) : "",
        num(s.owner_fee), num(s.total_revenue_ads), "",
      ].map(cell).join(","),
      ...items.map((i) =>
        [
          i.product_type, i.sku, i.asin, num(i.revenue), i.quantity, num(i.ads_fee), num(i.basecost),
          num(i.amazon_fee_unrecognized), num(i.amazon_fee_trans), num(i.thue), num(i.return_amount),
          num(i.a_to_z_claim), num(i.chargeback_refund), num(i.profit), pct(i.tacos), pct(i.acos), pct(i.margin),
          pct(i.roi), num(i.profit_per_item), num(i.basecost_per_item), "", num(i.revenue_ads), i.status,
        ].map(cell).join(","),
      ),
    ];

    const filename = `SKU_FBM_Monthly_${month === "all" ? "AllMonths" : `Thang_${s.month}`}_${year}.csv`;
    return new Response("﻿" + lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi xuất file SKU FBM-monthly", 500);
  }
}
