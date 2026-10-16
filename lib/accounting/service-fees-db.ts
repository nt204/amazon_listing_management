import "server-only";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export interface ServiceFeeItem {
  id: string;
  store_id: string;
  date: string;
  transaction_type: string;
  order_id: string;
  product_details: string;
  transaction_status: string;
  total_product_charges: number;
  total_promotional_rebates: number;
  amazon_fees: number;
  other: number;
  total: number;
  store_name: string;
  thang: number;
  tuan: number;
  quy: number;
  row_hash?: string;
  custom_fields?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceFeeStats {
  totalRows: number;
  totalAmount: number;
  totalProductCharges: number;
  totalPromotionalRebates: number;
  totalAmazonFees: number;
  totalOther: number;
  uniqueFeeTypes: number;
  uniqueOrders: number;
}

export function cleanServiceFeeDate(val: unknown): string | null {
  if (val == null) return null;

  // Excel serial date number (e.g. 46024 -> 2026-01-02)
  if (typeof val === "number" && !isNaN(val) && val > 20000 && val < 80000) {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split("T")[0];
  }

  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null" || s === "None" || s === "undefined") return null;

  const num = parseFloat(s);
  if (!isNaN(num) && num > 20000 && num < 80000 && /^\d+(\.\d+)?$/.test(s)) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }

  if (s.includes("T")) s = s.split("T")[0].trim();
  if (s.includes(" 00:00:00")) s = s.split(" ")[0].trim();
  s = s.replace(/(\s+|T)?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/i, "").trim();

  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  // MM/DD/YYYY or DD/MM/YYYY
  const parts = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (parts) {
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);
    const year = parts[3];
    if (p1 <= 12) {
      return `${year}-${String(p1).padStart(2, "0")}-${String(p2).padStart(2, "0")}`;
    } else {
      return `${year}-${String(p2).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
    }
  }

  return null;
}

export function parseServiceFeeNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null") return 0;
  let isNeg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    isNeg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$€£,\s]/g, "");
  const num = parseFloat(s);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

export function getIsoWeek(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return 0;
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getMonthAndQuarter(dateStr: string): { month: number; quarter: number } {
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return { month: 0, quarter: 0 };
  const month = d.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { month, quarter };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let inQuotes = false;
  let currentVal = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(currentVal.trim());
      currentVal = "";
    } else {
      currentVal += char;
    }
  }
  values.push(currentVal.trim());
  return values;
}

export async function parseServiceFeeBuffer(
  buffer: Buffer,
  fileName: string,
  storeId: string
): Promise<Omit<ServiceFeeItem, "id" | "created_at" | "updated_at">[]> {
  const sql = await getDatabaseClient();
  const lowerName = fileName.toLowerCase();
  const isXlsx = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm");

  // Get Store Name
  const [storeInfo] = await sql<{ name: string }[]>`
    SELECT name FROM stores WHERE id = ${storeId} LIMIT 1
  `.catch(() => []);
  const defaultStoreName = storeInfo?.name || "";

  const rawItems: Array<{
    date: string;
    transaction_type: string;
    order_id: string;
    product_details: string;
    transaction_status: string;
    total_product_charges: number;
    total_promotional_rebates: number;
    amazon_fees: number;
    other: number;
    total: number;
    store_name: string;
    thang: number;
    tuan: number;
    quy: number;
  }> = [];

  if (isXlsx) {
    let sheetName = "Service Fees";
    try {
      const zip = await JSZip.loadAsync(buffer);
      const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
      if (workbookXml) {
        const matches = Array.from(workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"/g)).map((m) => m[1]);
        const found =
          matches.find((n) => n.trim().toLowerCase() === "service fees") ||
          matches.find((n) => n.toLowerCase().includes("service")) ||
          matches[0];
        if (found) sheetName = found;
      }
    } catch {
      // ignore
    }

    const stream = Readable.from(buffer);
    const workbookReader = new (ExcelJS.stream.xlsx as any).WorkbookReader(stream, {
      entries: "emit",
      sharedStrings: "cache",
      styles: "ignore",
      hyperlinks: "ignore",
      worksheets: "emit",
    });

    const headers: string[] = [];
    let isHeaderRow = true;

    for await (const ws of workbookReader) {
      if (ws.name === sheetName || !sheetName) {
        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) {
                let str = "";
                if (typeof v === "object") {
                  str = String((v as any).result || (v as any).text || (v as any).formula || "").trim().toLowerCase();
                } else {
                  str = String(v).trim().toLowerCase();
                }
                headers[idx] = str;
              }
            });
            // If col 2 (idx 2) is empty in ketoan_limima.xlsx row 1, set it as "date"
            if (!headers[2]) {
              headers[2] = "date";
            }
          } else {
            const getColVal = (patterns: string[]): any => {
              for (const p of patterns) {
                const idx = headers.indexOf(p.toLowerCase());
                if (idx !== -1 && vals[idx] !== undefined) {
                  let c = vals[idx];
                  while (c && typeof c === "object" && !(c instanceof Date)) {
                    if ("result" in c) c = c.result;
                    else if ("text" in c) c = c.text;
                    else break;
                  }
                  return c;
                }
              }
              return null;
            };

            // In ketoan_limima: col 2 (B) is Date, col 1 (A) is Month
            const dateRaw = getColVal(["date", "ngày"]) || vals[2];
            const cleanDate = cleanServiceFeeDate(dateRaw);
            const prodDetails = String(getColVal(["product details", "product-details", "chi tiết sản phẩm"]) || vals[6] || "").trim();
            const totalVal = getColVal(["total (usd)", "total", "tổng"]) || vals[11];
            const total = parseServiceFeeNumber(totalVal);

            if (!cleanDate && !prodDetails && total === 0) continue;
            const effectiveDate = cleanDate || new Date().toISOString().split("T")[0];

            const txType = String(getColVal(["transaction type", "type", "loại giao dịch"]) || vals[4] || "Service Fees").trim();
            const txStatus = String(getColVal(["transaction status", "status"]) || vals[3] || "Released").trim();
            const orderId = String(getColVal(["order id", "order-id", "mã đơn"]) || vals[5] || "---").trim();

            const prodCharges = parseServiceFeeNumber(getColVal(["total product charges", "product charges"]) || vals[7]);
            const rebates = parseServiceFeeNumber(getColVal(["total promotional rebates", "promotional rebates"]) || vals[8]);
            const amazonFees = parseServiceFeeNumber(getColVal(["amazon fees", "fees", "phí amazon"]) || vals[9]);
            const other = parseServiceFeeNumber(getColVal(["other", "khác"]) || vals[10]);

            const storeNameVal = String(getColVal(["store", "cửa hàng"]) || vals[12] || defaultStoreName).trim();

            const { month, quarter } = getMonthAndQuarter(effectiveDate);
            const thang = parseInt(getColVal(["tháng", "thang"]) || vals[1], 10) || month;
            const tuan = getIsoWeek(effectiveDate);
            const quy = quarter;

            rawItems.push({
              date: effectiveDate,
              transaction_type: txType || "Service Fees",
              order_id: orderId || "---",
              product_details: prodDetails,
              transaction_status: txStatus || "Released",
              total_product_charges: prodCharges,
              total_promotional_rebates: rebates,
              amazon_fees: amazonFees,
              other,
              total,
              store_name: storeNameVal,
              thang,
              tuan,
              quy,
            });
          }
        }
        break;
      } else {
        for await (const _ of ws) {}
      }
    }
  } else {
    // CSV / TSV file (e.g. from 04_ServiceFees_... crawler)
    const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const firstLine = lines[0];
    const delimiter = firstLine.includes("\t") ? "\t" : ",";
    const headerCols = parseCsvLine(firstLine, delimiter).map((h) => h.toLowerCase().trim().replace(/^"|"$/g, ""));

    const getIdx = (patterns: string[]): number => {
      for (const p of patterns) {
        const idx = headerCols.indexOf(p.toLowerCase());
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const dateIdx = getIdx(["date", "ngày"]);
    const statusIdx = getIdx(["transaction status", "status", "trạng thái"]);
    const typeIdx = getIdx(["transaction type", "type", "loại giao dịch"]);
    const orderIdIdx = getIdx(["order id", "order-id", "mã đơn", "order_id"]);
    const detailsIdx = getIdx(["product details", "product-details", "product name", "chi tiết sản phẩm"]);
    const chargesIdx = getIdx(["total product charges", "product charges"]);
    const rebatesIdx = getIdx(["total promotional rebates", "promotional rebates"]);
    const feesIdx = getIdx(["amazon fees", "fees", "phí amazon"]);
    const otherIdx = getIdx(["other", "khác"]);
    const totalIdx = getIdx(["total (usd)", "total", "tổng"]);
    const storeIdx = getIdx(["store", "cửa hàng"]);
    const thangIdx = getIdx(["tháng", "thang"]);
    const tuanIdx = getIdx(["tuần", "tuan"]);
    const quyIdx = getIdx(["quý", "quy"]);

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i], delimiter);
      const getVal = (idx: number) => (idx !== -1 && idx < parts.length ? parts[idx].trim().replace(/^"|"$/g, "") : "");

      const dateRaw = getVal(dateIdx);
      const cleanDate = cleanServiceFeeDate(dateRaw);
      const prodDetails = getVal(detailsIdx);
      const total = parseServiceFeeNumber(getVal(totalIdx));

      if (!cleanDate && !prodDetails && total === 0) continue;
      const effectiveDate = cleanDate || new Date().toISOString().split("T")[0];

      const txStatus = getVal(statusIdx) || "Released";
      const txType = getVal(typeIdx) || "Service Fees";
      const orderId = getVal(orderIdIdx) || "---";

      const prodCharges = parseServiceFeeNumber(getVal(chargesIdx));
      const rebates = parseServiceFeeNumber(getVal(rebatesIdx));
      const amazonFees = parseServiceFeeNumber(getVal(feesIdx));
      const other = parseServiceFeeNumber(getVal(otherIdx));
      const storeNameVal = getVal(storeIdx) || defaultStoreName;

      const { month, quarter } = getMonthAndQuarter(effectiveDate);
      const thang = parseInt(getVal(thangIdx), 10) || month;
      const tuan = parseInt(getVal(tuanIdx), 10) || getIsoWeek(effectiveDate);
      const quy = parseInt(getVal(quyIdx), 10) || quarter;

      rawItems.push({
        date: effectiveDate,
        transaction_type: txType,
        order_id: orderId,
        product_details: prodDetails,
        transaction_status: txStatus,
        total_product_charges: prodCharges,
        total_promotional_rebates: rebates,
        amazon_fees: amazonFees,
        other,
        total,
        store_name: storeNameVal,
        thang,
        tuan,
        quy,
      });
    }
  }

  // Deduplication & Deterministic Row Hash
  const occurrenceTracker = new Map<string, number>();
  const results: Omit<ServiceFeeItem, "id" | "created_at" | "updated_at">[] = [];

  for (const item of rawItems) {
    const key = `${item.date}::${item.transaction_type}::${item.order_id}::${item.product_details.slice(0, 40)}::${item.total.toFixed(2)}::${item.amazon_fees.toFixed(2)}`;
    const count = (occurrenceTracker.get(key) || 0) + 1;
    occurrenceTracker.set(key, count);

    const hashPayload = `${storeId}::${key}::occ_${count}`;
    const rowHash = createHash("md5").update(hashPayload).digest("hex");

    results.push({
      store_id: storeId,
      date: item.date,
      transaction_type: item.transaction_type,
      order_id: item.order_id,
      product_details: item.product_details,
      transaction_status: item.transaction_status,
      total_product_charges: item.total_product_charges,
      total_promotional_rebates: item.total_promotional_rebates,
      amazon_fees: item.amazon_fees,
      other: item.other,
      total: item.total,
      store_name: item.store_name,
      thang: item.thang,
      tuan: item.tuan,
      quy: item.quy,
      row_hash: rowHash,
      custom_fields: {},
    });
  }

  return results;
}

export async function listServiceFees(
  storeId: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    dateSort?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
    orderId?: string;
    status?: string;
    feeType?: string;
    filters?: Record<string, string>;
  } = {}
): Promise<{
  items: ServiceFeeItem[];
  totalRows: number;
  stats: ServiceFeeStats;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(1000, params.limit || 50));
  const offset = (page - 1) * limit;
  const dateSort = params.dateSort === "asc" ? "ASC" : "DESC";

  const conditions = [sql`store_id = ${storeId}`];

  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(sql`(
      order_id ILIKE ${q} OR
      product_details ILIKE ${q} OR
      transaction_type ILIKE ${q} OR
      transaction_status ILIKE ${q} OR
      store_name ILIKE ${q}
    )`);
  }

  if (params.startDate) {
    conditions.push(sql`date >= ${params.startDate}::date`);
  }
  if (params.endDate) {
    conditions.push(sql`date <= ${params.endDate}::date`);
  }
  if (params.orderId) {
    conditions.push(sql`order_id ILIKE ${`%${params.orderId.trim()}%`}`);
  }
  if (params.status) {
    conditions.push(sql`transaction_status = ${params.status}`);
  }
  if (params.feeType) {
    conditions.push(sql`product_details ILIKE ${`%${params.feeType.trim()}%`}`);
  }

  if (params.filters) {
    for (const [col, val] of Object.entries(params.filters)) {
      if (!val) continue;
      const q = `%${val.trim()}%`;
      if (col === "order_id") conditions.push(sql`order_id ILIKE ${q}`);
      else if (col === "product_details") conditions.push(sql`product_details ILIKE ${q}`);
      else if (col === "transaction_type") conditions.push(sql`transaction_type ILIKE ${q}`);
      else if (col === "transaction_status") conditions.push(sql`transaction_status ILIKE ${q}`);
      else if (col === "store_name") conditions.push(sql`store_name ILIKE ${q}`);
    }
  }

  const whereClause = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const [statsResult] = await sql<
    {
      total_rows: string;
      total_amount: string;
      total_charges: string;
      total_rebates: string;
      total_amazon_fees: string;
      total_other: string;
      unique_fee_types: string;
      unique_orders: string;
    }[]
  >`
    SELECT
      COUNT(*)::text as total_rows,
      COALESCE(SUM(total), 0)::text as total_amount,
      COALESCE(SUM(total_product_charges), 0)::text as total_charges,
      COALESCE(SUM(total_promotional_rebates), 0)::text as total_rebates,
      COALESCE(SUM(amazon_fees), 0)::text as total_amazon_fees,
      COALESCE(SUM(other), 0)::text as total_other,
      COUNT(DISTINCT product_details)::text as unique_fee_types,
      COUNT(DISTINCT NULLIF(order_id, '---'))::text as unique_orders
    FROM accounting_service_fees
    WHERE ${whereClause}
  `;

  const totalRows = parseInt(statsResult?.total_rows || "0", 10);
  const totalPages = Math.ceil(totalRows / limit) || 1;

  const items = await sql<ServiceFeeItem[]>`
    SELECT
      id, store_id, date::text as date, transaction_type, order_id, product_details,
      transaction_status, total_product_charges::float, total_promotional_rebates::float,
      amazon_fees::float, other::float, total::float, store_name,
      thang, tuan, quy, custom_fields, created_at::text, updated_at::text
    FROM accounting_service_fees
    WHERE ${whereClause}
    ORDER BY date ${sql.unsafe(dateSort)}, order_id ASC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const stats: ServiceFeeStats = {
    totalRows,
    totalAmount: parseFloat(statsResult?.total_amount || "0"),
    totalProductCharges: parseFloat(statsResult?.total_charges || "0"),
    totalPromotionalRebates: parseFloat(statsResult?.total_rebates || "0"),
    totalAmazonFees: parseFloat(statsResult?.total_amazon_fees || "0"),
    totalOther: parseFloat(statsResult?.total_other || "0"),
    uniqueFeeTypes: parseInt(statsResult?.unique_fee_types || "0", 10),
    uniqueOrders: parseInt(statsResult?.unique_orders || "0", 10),
  };

  return {
    items,
    totalRows,
    stats,
    page,
    limit,
    totalPages,
  };
}

export async function batchUpsertServiceFees(
  storeId: string,
  items: Omit<ServiceFeeItem, "id" | "created_at" | "updated_at">[]
): Promise<{ count: number; createdCount: number }> {
  if (items.length === 0) return { count: 0, createdCount: 0 };
  const sql = await getDatabaseClient();

  const dedupedMap = new Map<string, typeof items[0]>();
  for (const item of items) {
    if (item.row_hash) {
      dedupedMap.set(item.row_hash, item);
    }
  }
  const deduped = Array.from(dedupedMap.values());

  const CHUNK_SIZE = 500;
  let totalProcessed = 0;

  for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + CHUNK_SIZE);
    const cols = [
      "store_id", "date", "transaction_type", "order_id", "product_details",
      "transaction_status", "total_product_charges", "total_promotional_rebates",
      "amazon_fees", "other", "total", "store_name", "thang", "tuan", "quy", "row_hash"
    ] as const;

    await sql`
      INSERT INTO accounting_service_fees ${sql(chunk, ...cols)}
      ON CONFLICT (store_id, row_hash) DO UPDATE SET
        transaction_type = EXCLUDED.transaction_type,
        order_id = EXCLUDED.order_id,
        product_details = EXCLUDED.product_details,
        transaction_status = EXCLUDED.transaction_status,
        total_product_charges = EXCLUDED.total_product_charges,
        total_promotional_rebates = EXCLUDED.total_promotional_rebates,
        amazon_fees = EXCLUDED.amazon_fees,
        other = EXCLUDED.other,
        total = EXCLUDED.total,
        store_name = CASE WHEN EXCLUDED.store_name != '' THEN EXCLUDED.store_name ELSE accounting_service_fees.store_name END,
        thang = EXCLUDED.thang,
        tuan = EXCLUDED.tuan,
        quy = EXCLUDED.quy,
        updated_at = NOW()
    `;

    totalProcessed += chunk.length;
  }

  return { count: totalProcessed, createdCount: totalProcessed };
}

export async function updateServiceFeeCell(
  storeId: string,
  id: string,
  field: string,
  value: any
): Promise<void> {
  const sql = await getDatabaseClient();
  const allowedFields = [
    "transaction_type", "order_id", "product_details", "transaction_status",
    "total", "amazon_fees", "other", "store_name", "thang", "tuan", "quy"
  ];

  if (!allowedFields.includes(field)) {
    throw new Error(`Field '${field}' is not allowed to be edited directly.`);
  }

  await sql`
    UPDATE accounting_service_fees
    SET ${sql({ [field]: value, updated_at: new Date().toISOString() })}
    WHERE store_id = ${storeId} AND id = ${id}
  `;
}

export async function deleteServiceFee(storeId: string, id: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    DELETE FROM accounting_service_fees
    WHERE store_id = ${storeId} AND id = ${id}
  `;
}

export async function deleteServiceFeeBatch(storeId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM accounting_service_fees
    WHERE store_id = ${storeId} AND id IN ${sql(ids)}
  `;
  return res.count || ids.length;
}
