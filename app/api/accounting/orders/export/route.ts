import { NextRequest, NextResponse } from "next/server";
import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    const sql = await getDatabaseClient();
    const rows = await sql`
      SELECT
        date::text,
        amazon_order_id,
        merchant_order_id,
        purchase_date::text,
        last_updated_date::text,
        order_status,
        fulfillment_channel,
        sales_channel,
        order_channel,
        url,
        ship_service_level,
        product_name,
        sku,
        asin,
        item_status,
        quantity,
        currency,
        item_price::float,
        item_tax::float,
        shipping_price::float,
        shipping_tax::float,
        gift_wrap_price::float,
        gift_wrap_tax::float,
        item_promotion_discount::float,
        ship_promotion_discount::float,
        ship_city,
        ship_state,
        ship_postal_code,
        ship_country,
        promotion_ids,
        is_business_order,
        purchase_order_number,
        price_designation,
        customized_url,
        customized_page,
        signature_confirmation_recommended
      FROM accounting_orders
      WHERE store_id = ${storeId}
      ORDER BY purchase_date DESC NULLS LAST, id DESC
    `;

    const storeRes = await sql<{ name: string }[]>`
      SELECT name FROM stores WHERE id = ${storeId} LIMIT 1
    `;
    const storeName = storeRes[0]?.name || "Store";

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Amazon Listing Management";
    const sheet = workbook.addWorksheet("Đầu vào Order");

    const columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "amazon-order-id", key: "amazon_order_id", width: 22 },
      { header: "merchant-order-id", key: "merchant_order_id", width: 22 },
      { header: "purchase-date", key: "purchase_date", width: 25 },
      { header: "last-updated-date", key: "last_updated_date", width: 25 },
      { header: "order-status", key: "order_status", width: 14 },
      { header: "fulfillment-channel", key: "fulfillment_channel", width: 18 },
      { header: "sales-channel", key: "sales_channel", width: 16 },
      { header: "order-channel", key: "order_channel", width: 15 },
      { header: "url", key: "url", width: 15 },
      { header: "ship-service-level", key: "ship_service_level", width: 18 },
      { header: "product-name", key: "product_name", width: 35 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "asin", key: "asin", width: 16 },
      { header: "item-status", key: "item_status", width: 14 },
      { header: "quantity", key: "quantity", width: 12 },
      { header: "currency", key: "currency", width: 10 },
      { header: "item-price", key: "item_price", width: 14 },
      { header: "item-tax", key: "item_tax", width: 12 },
      { header: "shipping-price", key: "shipping_price", width: 14 },
      { header: "shipping-tax", key: "shipping_tax", width: 12 },
      { header: "gift-wrap-price", key: "gift_wrap_price", width: 14 },
      { header: "gift-wrap-tax", key: "gift_wrap_tax", width: 12 },
      { header: "item-promotion-discount", key: "item_promotion_discount", width: 18 },
      { header: "ship-promotion-discount", key: "ship_promotion_discount", width: 18 },
      { header: "ship-city", key: "ship_city", width: 16 },
      { header: "ship-state", key: "ship_state", width: 12 },
      { header: "ship-postal-code", key: "ship_postal_code", width: 16 },
      { header: "ship-country", key: "ship_country", width: 12 },
      { header: "promotion-ids", key: "promotion_ids", width: 18 },
      { header: "is-business-order", key: "is_business_order", width: 16 },
      { header: "purchase-order-number", key: "purchase_order_number", width: 18 },
      { header: "price-designation", key: "price_designation", width: 16 },
      { header: "customized-url", key: "customized_url", width: 16 },
      { header: "customized-page", key: "customized_page", width: 16 },
      { header: "signature-confirmation-recommended", key: "signature_confirmation_recommended", width: 22 },
    ];

    sheet.columns = columns;

    // Header styling
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFF9900" }, // Amazon Orange
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 26;

    for (const r of rows) {
      sheet.addRow({
        date: r.date || "",
        amazon_order_id: r.amazon_order_id,
        merchant_order_id: r.merchant_order_id || "",
        purchase_date: r.purchase_date || "",
        last_updated_date: r.last_updated_date || "",
        order_status: r.order_status || "",
        fulfillment_channel: r.fulfillment_channel || "",
        sales_channel: r.sales_channel || "",
        order_channel: r.order_channel || "",
        url: r.url || "",
        ship_service_level: r.ship_service_level || "",
        product_name: r.product_name || "",
        sku: r.sku,
        asin: r.asin || "",
        item_status: r.item_status || "",
        quantity: r.quantity ?? 1,
        currency: r.currency || "USD",
        item_price: r.item_price ?? "",
        item_tax: r.item_tax ?? "",
        shipping_price: r.shipping_price ?? "",
        shipping_tax: r.shipping_tax ?? "",
        gift_wrap_price: r.gift_wrap_price ?? "",
        gift_wrap_tax: r.gift_wrap_tax ?? "",
        item_promotion_discount: r.item_promotion_discount ?? "",
        ship_promotion_discount: r.ship_promotion_discount ?? "",
        ship_city: r.ship_city || "",
        ship_state: r.ship_state || "",
        ship_postal_code: r.ship_postal_code || "",
        ship_country: r.ship_country || "",
        promotion_ids: r.promotion_ids || "",
        is_business_order: r.is_business_order ? "True" : "False",
        purchase_order_number: r.purchase_order_number || "",
        price_designation: r.price_designation || "",
        customized_url: r.customized_url || "",
        customized_page: r.customized_page || "",
        signature_confirmation_recommended: r.signature_confirmation_recommended ? "True" : "False",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Dau_vao_Order_${storeName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("GET /api/accounting/orders/export error:", error);
    return NextResponse.json({ error: error.message || "Failed to export orders" }, { status: 500 });
  }
}
