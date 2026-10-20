import "server-only";
import { Readable } from "node:stream";

import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export interface OrderItem {
  id: string;
  store_id: string;
  date: string | null;
  amazon_order_id: string;
  order_item_id: string | null;
  merchant_order_id: string | null;
  purchase_date: string | null;
  last_updated_date: string | null;
  order_status: string | null;
  fulfillment_channel: string | null;
  sales_channel: string | null;
  order_channel: string | null;
  url: string | null;
  ship_service_level: string | null;
  product_name: string | null;
  sku: string;
  asin: string | null;
  item_status: string | null;
  quantity: number;
  currency: string;
  item_price: number | null;
  item_tax: number | null;
  shipping_price: number | null;
  shipping_tax: number | null;
  gift_wrap_price: number | null;
  gift_wrap_tax: number | null;
  item_promotion_discount: number | null;
  ship_promotion_discount: number | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal_code: string | null;
  ship_country: string | null;
  promotion_ids: string | null;
  is_business_order: boolean;
  purchase_order_number: string | null;
  price_designation: string | null;
  customized_url: string | null;
  customized_page: string | null;
  signature_confirmation_recommended: boolean;
  custom_fields?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStats {
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  pendingCount: number;
  shippedCount: number;
  canceledCount: number;
}

export function convertToMarketplaceDate(
  val: unknown,
  timeZone = "America/Los_Angeles"
): string | null {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(val);
  }
  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "None" || s === "undefined") return null;

  // Excel serial number
  const num = parseFloat(s);
  if (!isNaN(num) && num > 20000 && num < 80000 && /^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    return isNaN(d.getTime())
      ? null
      : new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
  }

  // Pure YYYY-MM-DD
  const ymdOnly = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdOnly) {
    return `${ymdOnly[1]}-${ymdOnly[2].padStart(2, "0")}-${ymdOnly[3].padStart(2, "0")}`;
  }

  // DD/MM/YYYY
  const dmyOnly = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyOnly) {
    return `${dmyOnly[3]}-${dmyOnly[2].padStart(2, "0")}-${dmyOnly[1].padStart(2, "0")}`;
  }

  // Timestamp string (ISO or with timezone offset)
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }

  return null;
}

export function cleanOrderDate(val: unknown): string | null {
  return convertToMarketplaceDate(val, "America/Los_Angeles");
}

export function cleanOrderNumber(val: unknown): number | null {
  if (val == null) return null;
  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "None" || s === "undefined") return null;
  s = s.replace(/[^0-9.-]/g, "");
  const num = parseFloat(s);
  return isNaN(num) ? null : num;
}

export function cleanOrderBool(val: unknown): boolean {
  if (val == null) return false;
  const s = String(val).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

export async function listOrders(
  storeId: string,
  options: {
    page?: number;
    limit?: number;
    search?: string;
    dateSort?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
    filters?: Record<string, string>;
  } = {}
): Promise<{ orders: OrderItem[]; total: number; stats: OrderStats }> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(200, Math.max(1, options.limit || 50));
  const offset = (page - 1) * limit;
  const search = options.search?.trim() || "";
  const dateSort = options.dateSort || "desc";
  const startDate = options.startDate?.trim() || "";
  const endDate = options.endDate?.trim() || "";

  // Build filter conditions
  const conditions = [sql`store_id = ${storeId}`];

  if (startDate) {
    conditions.push(sql`date >= ${startDate}::date`);
  }
  if (endDate) {
    conditions.push(sql`date <= ${endDate}::date`);
  }

  if (search) {
    const s = `%${search}%`;
    conditions.push(
      sql`(amazon_order_id ILIKE ${s} OR sku ILIKE ${s} OR asin ILIKE ${s} OR product_name ILIKE ${s} OR ship_city ILIKE ${s} OR ship_state ILIKE ${s})`
    );
  }

  if (options.filters && Object.keys(options.filters).length > 0) {
    for (const [key, val] of Object.entries(options.filters)) {
      if (val && val.trim() !== "") {
        const safeColumns = [
          "date",
          "amazon_order_id",
          "order_item_id",
          "merchant_order_id",
          "order_status",
          "fulfillment_channel",
          "sales_channel",
          "order_channel",
          "ship_service_level",
          "sku",
          "asin",
          "item_status",
          "currency",
          "ship_city",
          "ship_state",
          "ship_postal_code",
          "ship_country",
          "is_business_order",
          "price_designation",
          "signature_confirmation_recommended",
        ];
        if (safeColumns.includes(key)) {
          conditions.push(sql`${sql(key)} = ${val.trim()}`);
        }
      }
    }
  }

  const whereClause = conditions.reduce((prev, curr) => sql`${prev} AND ${curr}`);

  // Fetch paginated rows
  const rows = await sql<OrderItem[]>`
    SELECT
      id,
      store_id,
      date::text,
      amazon_order_id,
      order_item_id,
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
      signature_confirmation_recommended,
      custom_fields,
      created_at::text,
      updated_at::text
    FROM accounting_orders
    WHERE ${whereClause}
    ORDER BY ${
      dateSort === "asc"
        ? sql`date ASC NULLS FIRST, purchase_date ASC NULLS FIRST, id ASC`
        : sql`date DESC NULLS LAST, purchase_date DESC NULLS LAST, id DESC`
    }
    LIMIT ${limit} OFFSET ${offset}
  `;

  // Total count
  const countRes = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM accounting_orders
    WHERE ${whereClause}
  `;
  const total = parseInt(countRes[0]?.count || "0", 10);

  // Overall store stats
  const statsRes = await sql<{
    total_orders: string;
    total_units: string;
    total_revenue: string;
    pending_count: string;
    shipped_count: string;
    canceled_count: string;
  }[]>`
    SELECT
      COUNT(DISTINCT amazon_order_id)::text as total_orders,
      COALESCE(SUM(quantity), 0)::text as total_units,
      COALESCE(SUM(item_price * quantity), 0)::text as total_revenue,
      COUNT(*) FILTER (WHERE LOWER(order_status) = 'pending')::text as pending_count,
      COUNT(*) FILTER (WHERE LOWER(order_status) = 'shipped')::text as shipped_count,
      COUNT(*) FILTER (WHERE LOWER(order_status) = 'canceled' OR LOWER(order_status) = 'cancelled')::text as canceled_count
    FROM accounting_orders
    WHERE store_id = ${storeId}
  `;

  const stats: OrderStats = {
    totalOrders: parseInt(statsRes[0]?.total_orders || "0", 10),
    totalUnits: parseInt(statsRes[0]?.total_units || "0", 10),
    totalRevenue: parseFloat(statsRes[0]?.total_revenue || "0"),
    pendingCount: parseInt(statsRes[0]?.pending_count || "0", 10),
    shippedCount: parseInt(statsRes[0]?.shipped_count || "0", 10),
    canceledCount: parseInt(statsRes[0]?.canceled_count || "0", 10),
  };

  return { orders: rows, total, stats };
}

export async function updateOrderCell(
  storeId: string,
  id: string,
  field: string,
  value: any
): Promise<boolean> {
  const sql = await getDatabaseClient();
  const allowedFields = [
    "date",
    "merchant_order_id",
    "order_status",
    "fulfillment_channel",
    "sales_channel",
    "ship_service_level",
    "product_name",
    "sku",
    "asin",
    "item_status",
    "quantity",
    "currency",
    "item_price",
    "item_tax",
    "shipping_price",
    "shipping_tax",
    "gift_wrap_price",
    "gift_wrap_tax",
    "item_promotion_discount",
    "ship_promotion_discount",
    "ship_city",
    "ship_state",
    "ship_postal_code",
    "ship_country",
    "promotion_ids",
    "is_business_order",
    "purchase_order_number",
    "price_designation",
  ];

  if (!allowedFields.includes(field)) {
    throw new Error(`Field '${field}' is not editable`);
  }

  let sanitizedValue = value;
  if (field === "date") sanitizedValue = cleanOrderDate(value);
  else if (["quantity", "item_price", "item_tax", "shipping_price", "shipping_tax", "gift_wrap_price", "gift_wrap_tax", "item_promotion_discount", "ship_promotion_discount"].includes(field)) {
    sanitizedValue = cleanOrderNumber(value);
  } else if (field === "is_business_order") {
    sanitizedValue = cleanOrderBool(value);
  } else if (typeof value === "string") {
    sanitizedValue = value.trim() || null;
  }

  await sql`
    UPDATE accounting_orders
    SET
      ${sql(field)} = ${sanitizedValue},
      updated_at = NOW()
    WHERE id = ${id} AND store_id = ${storeId}
  `;

  return true;
}

export async function deleteOrder(storeId: string, id: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  await sql`
    DELETE FROM accounting_orders
    WHERE id = ${id} AND store_id = ${storeId}
  `;
  return true;
}

/**
 * Standardize raw record from TSV, CSV, or Excel row to OrderItem insert object
 */
export function normalizeOrderRow(
  raw: Record<string, any>,
  storeId: string,
  fallbackDate?: string | null
): Partial<OrderItem> | null {
  const getVal = (...keys: string[]): any => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") return raw[k];
      const lower = k.toLowerCase().replace(/[-_\s]/g, "");
      for (const [rawK, rawV] of Object.entries(raw)) {
        if (rawK.toLowerCase().replace(/[-_\s]/g, "") === lower) {
          if (rawV !== undefined && rawV !== null && rawV !== "") return rawV;
        }
      }
    }
    return null;
  };

  const amazonOrderId = getVal("amazon-order-id", "amazon_order_id", "order-id", "order_id");
  const sku = getVal("sku", "SKU", "msku", "seller-sku");
  const rawOrderItemId = getVal("order-item-id", "order_item_id", "item-id", "orderitemid");

  if (!amazonOrderId || !sku) return null;

  const orderItemId = rawOrderItemId ? String(rawOrderItemId).trim() : "";

  const purchaseDateRaw = getVal("purchase-date", "purchase_date", "order-date");
  let dateVal = cleanOrderDate(getVal("Date", "date"));
  if (!dateVal && fallbackDate) {
    dateVal = cleanOrderDate(fallbackDate);
  }
  if (!dateVal && purchaseDateRaw) {
    dateVal = convertToMarketplaceDate(purchaseDateRaw, "America/Los_Angeles");
  }

  const parseIsoOrDate = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === "number" && !isNaN(val) && val > 20000 && val < 80000) {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (val instanceof Date) return val.toISOString();
    const str = String(val).trim();
    if (!str || str === "—" || str === "-" || str === "null") return null;
    const num = parseFloat(str);
    if (!isNaN(num) && num > 20000 && num < 80000 && /^\d+(\.\d+)?$/.test(str)) {
      const d = new Date(Math.round((num - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (str.includes("T")) return str;
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  return {
    store_id: storeId,
    date: dateVal,
    amazon_order_id: String(amazonOrderId).trim(),
    order_item_id: orderItemId,
    merchant_order_id: getVal("merchant-order-id", "merchant_order_id", "merchant-order-number")
      ? String(getVal("merchant-order-id", "merchant_order_id", "merchant-order-number")).trim()
      : null,
    purchase_date: parseIsoOrDate(purchaseDateRaw),
    last_updated_date: parseIsoOrDate(getVal("last-updated-date", "last_updated_date")),
    order_status: getVal("order-status", "order_status", "status") ? String(getVal("order-status", "order_status", "status")).trim() : null,
    fulfillment_channel: getVal("fulfillment-channel", "fulfillment_channel") ? String(getVal("fulfillment-channel", "fulfillment_channel")).trim() : null,
    sales_channel: getVal("sales-channel", "sales_channel") ? String(getVal("sales-channel", "sales_channel")).trim() : null,
    order_channel: getVal("order-channel", "order_channel") ? String(getVal("order-channel", "order_channel")).trim() : null,
    url: getVal("url") ? String(getVal("url")).trim() : null,
    ship_service_level: getVal("ship-service-level", "ship_service_level") ? String(getVal("ship-service-level", "ship_service_level")).trim() : null,
    product_name: getVal("product-name", "product_name", "title", "item-name") ? String(getVal("product-name", "product_name", "title", "item-name")).trim() : null,
    sku: String(sku).trim(),
    asin: getVal("asin", "ASIN") ? String(getVal("asin", "ASIN")).trim() : null,
    item_status: getVal("item-status", "item_status") ? String(getVal("item-status", "item_status")).trim() : null,
    quantity: Math.max(1, Math.round(cleanOrderNumber(getVal("quantity", "qty", "quantity-purchased")) || 1)),
    currency: getVal("currency") ? String(getVal("currency")).trim() : "USD",
    item_price: cleanOrderNumber(getVal("item-price", "item_price", "principal", "item-price-amount")),
    item_tax: cleanOrderNumber(getVal("item-tax", "item_tax", "tax")),
    shipping_price: cleanOrderNumber(getVal("shipping-price", "shipping_price", "shipping")),
    shipping_tax: cleanOrderNumber(getVal("shipping-tax", "shipping_tax")),
    gift_wrap_price: cleanOrderNumber(getVal("gift-wrap-price", "gift_wrap_price")),
    gift_wrap_tax: cleanOrderNumber(getVal("gift-wrap-tax", "gift_wrap_tax")),
    item_promotion_discount: cleanOrderNumber(getVal("item-promotion-discount", "item_promotion_discount")),
    ship_promotion_discount: cleanOrderNumber(getVal("ship-promotion-discount", "ship_promotion_discount")),
    ship_city: getVal("ship-city", "ship_city", "recipient-city") ? String(getVal("ship-city", "ship_city", "recipient-city")).trim() : null,
    ship_state: getVal("ship-state", "ship_state", "recipient-state") ? String(getVal("ship-state", "ship_state", "recipient-state")).trim() : null,
    ship_postal_code: getVal("ship-postal-code", "ship_postal_code", "recipient-postal-code", "postal-code") ? String(getVal("ship-postal-code", "ship_postal_code", "recipient-postal-code", "postal-code")).trim() : null,
    ship_country: getVal("ship-country", "ship_country", "recipient-country", "country") ? String(getVal("ship-country", "ship_country", "recipient-country", "country")).trim() : null,
    promotion_ids: getVal("promotion-ids", "promotion_ids") ? String(getVal("promotion-ids", "promotion_ids")).trim() : null,
    is_business_order: cleanOrderBool(getVal("is-business-order", "is_business_order", "is-b2b")),
    purchase_order_number: getVal("purchase-order-number", "purchase_order_number", "po-number") ? String(getVal("purchase-order-number", "purchase_order_number", "po-number")).trim() : null,
    price_designation: getVal("price-designation", "price_designation") ? String(getVal("price-designation", "price_designation")).trim() : null,
    customized_url: getVal("customized-url", "customized_url") ? String(getVal("customized-url", "customized_url")).trim() : null,
    customized_page: getVal("customized-page", "customized_page") ? String(getVal("customized-page", "customized_page")).trim() : null,
    signature_confirmation_recommended: cleanOrderBool(getVal("signature-confirmation-recommended", "signature_confirmation_recommended")),
  };
}

/**
 * Parse orders file buffer (TSV, CSV, or XLSX) into list of normalized orders
 */
export async function parseOrdersBuffer(
  buffer: Buffer,
  filename: string,
  storeId: string
): Promise<Partial<OrderItem>[]> {
  const lowerName = filename.toLowerCase();

  // Extract fallback date from filename if available (e.g. "02_AllOrders_2026-10-18.tsv" -> "2026-10-18")
  let fileFallbackDate: string | null = null;
  const isoMatch = filename.match(/\b(\d{4}[-_/]\d{1,2}[-_/]\d{1,2})\b/);
  if (isoMatch) {
    fileFallbackDate = cleanOrderDate(isoMatch[1]);
  } else {
    const textDateMatch = filename.match(
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[ _-](\d{1,2})[ _-](\d{4})\b/i
    );
    if (textDateMatch) {
      fileFallbackDate = convertToMarketplaceDate(`${textDateMatch[1]} ${textDateMatch[2]} ${textDateMatch[3]}`);
    }
  }

  // Excel file (.xlsx, .xls)
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    // 1. Tối ưu cực nhanh cho .xlsx bằng streaming và kiểm tra sheet name qua JSZip
    // Giảm bộ nhớ từ 3.5GB xuống <180MB, tốc độ đọc 43,000 dòng chỉ mất ~10-15s
    if (lowerName.endsWith(".xlsx")) {
      try {
        const zip = await JSZip.loadAsync(buffer);
        const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
        const sheetMatches = [...(workbookXml?.matchAll(/<sheet [^>]*name=\"([^\"]+)\"/g) || [])].map((m) => m[1]);

        let targetSheetName = "";
        if (sheetMatches.length > 0) {
          targetSheetName =
            sheetMatches.find((n) => n.toLowerCase().trim() === "đầu vào order") ||
            sheetMatches.find((n) => n.toLowerCase().includes("đầu vào")) ||
            sheetMatches.find((n) => {
              const s = n.toLowerCase().trim();
              return s === "orders" || s === "all orders" || s === "order";
            }) ||
            sheetMatches.find((n) => n.toLowerCase().includes("order")) ||
            sheetMatches[0];
        }

        if (targetSheetName) {
          const stream = Readable.from(buffer);
          const workbookReader = new (ExcelJS.stream.xlsx as any).WorkbookReader(stream, {
            entries: "emit",
            sharedStrings: "cache",
            styles: "ignore",
            hyperlinks: "ignore",
            worksheets: "emit",
          });

          const headers: string[] = [];
          const rows: Partial<OrderItem>[] = [];
          let targetFound = false;

          for await (const ws of workbookReader) {
            if (ws.name === targetSheetName) {
              targetFound = true;
              let isHeaderRow = true;
              for await (const row of ws) {
                const vals = (row.values as any[]) || [];
                if (isHeaderRow) {
                  isHeaderRow = false;
                  vals.forEach((v, idx) => {
                    if (v != null) headers[idx] = String(v).trim().replace(/^\uFEFF/, "");
                  });
                } else {
                  const rowData: Record<string, any> = {};
                  headers.forEach((h, idx) => {
                    if (h && vals[idx] !== undefined) {
                      let cellVal = vals[idx];
                      if (cellVal && typeof cellVal === "object") {
                        if ("result" in cellVal) cellVal = cellVal.result;
                        else if ("text" in cellVal) cellVal = cellVal.text;
                      }
                      rowData[h] = cellVal;
                    }
                  });
                  const normalized = normalizeOrderRow(rowData, storeId, fileFallbackDate);
                  if (normalized) rows.push(normalized);
                }
              }
              break; // Dừng ngay lập tức sau khi đọc xong sheet mục tiêu!
            } else {
              // Xả nhanh các sheet khác mà không parse tốn bộ nhớ
              for await (const _ of ws) {}
            }
          }

          if (targetFound && rows.length > 0) {
            return rows;
          }
        }
      } catch (streamErr) {
        console.warn("[parseOrdersBuffer] Lỗi streaming xlsx, chuyển về chế độ tải tiêu chuẩn:", streamErr);
      }
    }

    // Fallback chuẩn với ExcelJS (dành cho file .xls hoặc nếu stream không ra dòng)
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    // Prefer sheet named "Đầu vào Order" or "Orders" or the first sheet
    let worksheet = workbook.getWorksheet("Đầu vào Order");
    if (!worksheet) {
      worksheet = workbook.worksheets.find((ws) =>
        ws.name.toLowerCase().includes("order") || ws.name.toLowerCase().includes("đầu vào")
      );
    }
    if (!worksheet) worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const headers: string[] = [];
    const rows: Partial<OrderItem>[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell, colNumber) => {
          headers[colNumber] = String(cell.value || "").trim().replace(/^\uFEFF/, "");
        });
      } else {
        const rowData: Record<string, any> = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            let val = cell.value;
            // Handle formula result or object cell values
            if (val && typeof val === "object") {
              if ("result" in val) val = (val as any).result;
              else if ("text" in val) val = (val as any).text;
            }
            rowData[header] = val;
          }
        });
        const normalized = normalizeOrderRow(rowData, storeId, fileFallbackDate);
        if (normalized) rows.push(normalized);
      }
    });

    return rows;
  }

  // Text / TSV / CSV (strip UTF-8 BOM if present)
  const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  // Determine delimiter: tab vs comma
  const headerLine = lines[0];
  const isTab = headerLine.includes("\t");
  const delimiter = isTab ? "\t" : ",";

  const parseCsvLine = (line: string, delim: string): string[] => {
    if (delim === "\t") {
      return line.split("\t").map((item) => item.trim().replace(/^["']|["']$/g, ""));
    }
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delim && !inQuotes) {
        result.push(cur.trim().replace(/^["']|["']$/g, ""));
        cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim().replace(/^["']|["']$/g, ""));
    return result;
  };

  const headers = parseCsvLine(headerLine, delimiter);
  const rows: Partial<OrderItem>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    if (!values || values.length === 0) continue;
    const rowData: Record<string, any> = {};
    for (let h = 0; h < headers.length; h++) {
      rowData[headers[h]] = values[h] !== undefined ? values[h] : null;
    }
    const normalized = normalizeOrderRow(rowData, storeId, fileFallbackDate);
    if (normalized) rows.push(normalized);
  }

  return rows;
}

/**
 * Batch Upsert orders into PostgreSQL
 */
export async function batchUpsertOrders(
  storeId: string,
  orders: Partial<OrderItem>[]
): Promise<{ count: number }> {
  if (orders.length === 0) return { count: 0 };
  const sql = await getDatabaseClient();

  const chunkSize = 500;
  let totalProcessed = 0;

  const cols = [
    "store_id", "date", "amazon_order_id", "order_item_id", "merchant_order_id", "purchase_date",
    "last_updated_date", "order_status", "fulfillment_channel", "sales_channel",
    "order_channel", "url", "ship_service_level", "product_name", "sku", "asin",
    "item_status", "quantity", "currency", "item_price", "item_tax",
    "shipping_price", "shipping_tax", "gift_wrap_price", "gift_wrap_tax",
    "item_promotion_discount", "ship_promotion_discount", "ship_city", "ship_state",
    "ship_postal_code", "ship_country", "promotion_ids", "is_business_order",
    "purchase_order_number", "price_designation", "customized_url", "customized_page",
    "signature_confirmation_recommended"
  ] as const;

  for (let i = 0; i < orders.length; i += chunkSize) {
    const chunk = orders.slice(i, i + chunkSize);
    const validRows = chunk.filter((o) => o.amazon_order_id && o.sku);
    if (validRows.length === 0) continue;

    const rowsToInsert = validRows.map((o) => ({
      store_id: storeId,
      date: o.date ? o.date : null,
      amazon_order_id: o.amazon_order_id!,
      order_item_id: o.order_item_id ?? "",
      merchant_order_id: o.merchant_order_id ?? null,
      purchase_date: o.purchase_date ? new Date(o.purchase_date) : null,
      last_updated_date: o.last_updated_date ? new Date(o.last_updated_date) : null,
      order_status: o.order_status ?? null,
      fulfillment_channel: o.fulfillment_channel ?? null,
      sales_channel: o.sales_channel ?? null,
      order_channel: o.order_channel ?? null,
      url: o.url ?? null,
      ship_service_level: o.ship_service_level ?? null,
      product_name: o.product_name ?? null,
      sku: o.sku!,
      asin: o.asin ?? null,
      item_status: o.item_status ?? null,
      quantity: o.quantity ?? 1,
      currency: o.currency ?? "USD",
      item_price: o.item_price ?? null,
      item_tax: o.item_tax ?? null,
      shipping_price: o.shipping_price ?? null,
      shipping_tax: o.shipping_tax ?? null,
      gift_wrap_price: o.gift_wrap_price ?? null,
      gift_wrap_tax: o.gift_wrap_tax ?? null,
      item_promotion_discount: o.item_promotion_discount ?? null,
      ship_promotion_discount: o.ship_promotion_discount ?? null,
      ship_city: o.ship_city ?? null,
      ship_state: o.ship_state ?? null,
      ship_postal_code: o.ship_postal_code ?? null,
      ship_country: o.ship_country ?? null,
      promotion_ids: o.promotion_ids ?? null,
      is_business_order: o.is_business_order ?? false,
      purchase_order_number: o.purchase_order_number ?? null,
      price_designation: o.price_designation ?? null,
      customized_url: o.customized_url ?? null,
      customized_page: o.customized_page ?? null,
      signature_confirmation_recommended: o.signature_confirmation_recommended ?? false,
    }));

    // Khử trùng lặp trong cùng 1 batch để tránh lỗi Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const dedupeMap = new Map<string, typeof rowsToInsert[0]>();
    for (const r of rowsToInsert) {
      const key = `${r.amazon_order_id}:::${r.sku}:::${r.order_item_id}`;
      dedupeMap.set(key, r);
    }
    const dedupedRows = Array.from(dedupeMap.values());

    await sql`
      INSERT INTO accounting_orders ${sql(dedupedRows, ...cols)}
      ON CONFLICT (store_id, amazon_order_id, sku, order_item_id)
      DO UPDATE SET
        date = COALESCE(EXCLUDED.date, accounting_orders.date),
        merchant_order_id = COALESCE(EXCLUDED.merchant_order_id, accounting_orders.merchant_order_id),
        purchase_date = COALESCE(EXCLUDED.purchase_date, accounting_orders.purchase_date),
        last_updated_date = COALESCE(EXCLUDED.last_updated_date, accounting_orders.last_updated_date),
        order_status = COALESCE(EXCLUDED.order_status, accounting_orders.order_status),
        fulfillment_channel = COALESCE(EXCLUDED.fulfillment_channel, accounting_orders.fulfillment_channel),
        sales_channel = COALESCE(EXCLUDED.sales_channel, accounting_orders.sales_channel),
        order_channel = COALESCE(EXCLUDED.order_channel, accounting_orders.order_channel),
        url = COALESCE(EXCLUDED.url, accounting_orders.url),
        ship_service_level = COALESCE(EXCLUDED.ship_service_level, accounting_orders.ship_service_level),
        product_name = COALESCE(EXCLUDED.product_name, accounting_orders.product_name),
        asin = COALESCE(EXCLUDED.asin, accounting_orders.asin),
        item_status = COALESCE(EXCLUDED.item_status, accounting_orders.item_status),
        quantity = COALESCE(EXCLUDED.quantity, accounting_orders.quantity),
        currency = COALESCE(EXCLUDED.currency, accounting_orders.currency),
        item_price = COALESCE(EXCLUDED.item_price, accounting_orders.item_price),
        item_tax = COALESCE(EXCLUDED.item_tax, accounting_orders.item_tax),
        shipping_price = COALESCE(EXCLUDED.shipping_price, accounting_orders.shipping_price),
        shipping_tax = COALESCE(EXCLUDED.shipping_tax, accounting_orders.shipping_tax),
        gift_wrap_price = COALESCE(EXCLUDED.gift_wrap_price, accounting_orders.gift_wrap_price),
        gift_wrap_tax = COALESCE(EXCLUDED.gift_wrap_tax, accounting_orders.gift_wrap_tax),
        item_promotion_discount = COALESCE(EXCLUDED.item_promotion_discount, accounting_orders.item_promotion_discount),
        ship_promotion_discount = COALESCE(EXCLUDED.ship_promotion_discount, accounting_orders.ship_promotion_discount),
        ship_city = COALESCE(EXCLUDED.ship_city, accounting_orders.ship_city),
        ship_state = COALESCE(EXCLUDED.ship_state, accounting_orders.ship_state),
        ship_postal_code = COALESCE(EXCLUDED.ship_postal_code, accounting_orders.ship_postal_code),
        ship_country = COALESCE(EXCLUDED.ship_country, accounting_orders.ship_country),
        promotion_ids = COALESCE(EXCLUDED.promotion_ids, accounting_orders.promotion_ids),
        is_business_order = COALESCE(EXCLUDED.is_business_order, accounting_orders.is_business_order),
        purchase_order_number = COALESCE(EXCLUDED.purchase_order_number, accounting_orders.purchase_order_number),
        price_designation = COALESCE(EXCLUDED.price_designation, accounting_orders.price_designation),
        customized_url = COALESCE(EXCLUDED.customized_url, accounting_orders.customized_url),
        customized_page = COALESCE(EXCLUDED.customized_page, accounting_orders.customized_page),
        signature_confirmation_recommended = COALESCE(EXCLUDED.signature_confirmation_recommended, accounting_orders.signature_confirmation_recommended),
        updated_at = NOW();
    `;

    totalProcessed += validRows.length;
  }

  return { count: totalProcessed };
}
