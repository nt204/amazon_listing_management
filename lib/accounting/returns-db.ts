import "server-only";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { getDatabaseClient } from "@/lib/db";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export interface ReturnItem {
  id: string;
  store_id: string;
  date: string;
  order_id: string;
  sku: string;
  loai: string;
  pic: string;
  basecost: number;
  transaction_status: string;
  transaction_type: string;
  product_details: string;
  total_product_charges: number;
  total_promotional_rebates: number;
  amazon_fees: number;
  other: number;
  total: number;
  return_sau_basecost: number;
  tuan: number;
  thang: number;
  quy: number;
  trang_thai: string;
  row_hash?: string;
  custom_fields?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface ReturnStats {
  totalRows: number;
  totalAmount: number;
  totalProductCharges: number;
  totalPromotionalRebates: number;
  totalAmazonFees: number;
  totalOther: number;
  totalBasecost: number;
  totalReturnSauBasecost: number;
  uniqueOrders: number;
  uniqueSkus: number;
}

export function cleanReturnDate(val: unknown): string | null {
  if (val == null) return null;

  // Excel serial date number (e.g. 46017 -> 2025-12-26)
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

export function parseReturnNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  let s = String(val).trim();
  if (!s || s === "—" || s === "-" || s === "null") return 0;
  // Handle parentheses negative: ($24.29) or (24.29) -> -24.29
  let isNeg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    isNeg = true;
    s = s.slice(1, -1).trim();
  }
  // Strip currency symbols and commas
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

export async function parseReturnBuffer(
  buffer: Buffer,
  fileName: string,
  storeId: string
): Promise<Omit<ReturnItem, "id" | "created_at" | "updated_at">[]> {
  const sql = await getDatabaseClient();
  const lowerName = fileName.toLowerCase();
  const isXlsx = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm");

  // Lookup order data and SKU master for smart column filling
  const [skuRows, orderRows] = await Promise.all([
    sql<{ sku: string; loai: string; pic_mkt: string; status: string; basecost_tb: number }[]>`
      SELECT sku, loai, pic_mkt, status, basecost_tb FROM accounting_sku_master WHERE store_id = ${storeId}
    `.catch(() => []),
    sql<{ amazon_order_id: string; sku: string; fulfillment_channel: string | null }[]>`
      SELECT amazon_order_id, sku, fulfillment_channel FROM accounting_orders WHERE store_id = ${storeId}
    `.catch(() => []),
  ]);

  const skuMap = new Map<string, { loai: string; pic: string; status: string; basecost: number }>();
  for (const s of skuRows) {
    if (s.sku) {
      skuMap.set(s.sku.trim().toUpperCase(), {
        loai: s.loai || "FBA",
        pic: s.pic_mkt || "",
        status: s.status || "Phát triển",
        basecost: Number(s.basecost_tb) || 0,
      });
    }
  }

  const orderInfoMap = new Map<string, { sku: string; loai: string }>();
  for (const o of orderRows) {
    if (o.amazon_order_id) {
      const isFbm = o.fulfillment_channel?.trim().toLowerCase() === "merchant";
      orderInfoMap.set(o.amazon_order_id.trim(), {
        sku: (o.sku || "").trim(),
        loai: isFbm ? "FBM" : "FBA",
      });
    }
  }

  const rawItems: Array<{
    date: string;
    order_id: string;
    sku: string;
    loai: string;
    pic: string;
    basecost: number;
    transaction_status: string;
    transaction_type: string;
    product_details: string;
    total_product_charges: number;
    total_promotional_rebates: number;
    amazon_fees: number;
    other: number;
    total: number;
    return_sau_basecost: number;
    tuan: number;
    thang: number;
    quy: number;
    trang_thai: string;
  }> = [];

  if (isXlsx) {
    let sheetName = "RETURN";
    try {
      const zip = await JSZip.loadAsync(buffer);
      const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
      if (workbookXml) {
        const matches = Array.from(workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"/g)).map((m) => m[1]);
        const found =
          matches.find((n) => n.trim().toUpperCase() === "RETURN") ||
          matches.find((n) => n.toLowerCase().includes("return")) ||
          matches[0];
        if (found) sheetName = found;
      }
    } catch {
      // ignore
    }

    // Stream read the specific sheet
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

            const orderIdRaw = getColVal(["order id", "mã đơn", "order_id"]);
            const dateRaw = getColVal(["date", "ngày"]);
            const cleanDate = cleanReturnDate(dateRaw);
            const orderId = String(orderIdRaw || "").trim();

            if (!cleanDate && !orderId) continue;
            const effectiveDate = cleanDate || new Date().toISOString().split("T")[0];

            let sku = String(getColVal(["sku"]) || "").trim();
            const orderInfo = orderId ? orderInfoMap.get(orderId) : null;
            if (!sku && orderInfo) {
              sku = orderInfo.sku;
            }

            const master = sku ? skuMap.get(sku.toUpperCase()) : null;
            const loai = String(getColVal(["loại", "loai"]) || orderInfo?.loai || master?.loai || "FBA").trim();
            const pic = String(getColVal(["pic", "pic mkt", "mkt pic"]) || master?.pic || "").trim();
            const basecostVal = getColVal(["basecost", "chi phí gốc"]);
            const basecost = basecostVal != null ? parseReturnNumber(basecostVal) : master ? -Math.abs(master.basecost) : 0;

            const txStatus = String(getColVal(["transaction status", "trạng thái giao dịch"]) || "Released").trim();
            const txType = String(getColVal(["transaction type", "loại giao dịch"]) || "Refund").trim();
            const prodDetails = String(getColVal(["product details", "chi tiết sản phẩm", "title"]) || "").trim();

            const prodCharges = parseReturnNumber(getColVal(["total product charges", "product charges"]));
            const rebates = parseReturnNumber(getColVal(["total promotional rebates", "promotional rebates"]));
            const amazonFees = parseReturnNumber(getColVal(["amazon fees", "phí amazon"]));
            const other = parseReturnNumber(getColVal(["other", "khác"]));
            const total = parseReturnNumber(getColVal(["total (usd)", "total", "tổng tiền", "tổng"]));

            const returnSauBasecostVal = getColVal(["return sau khi trừ basecost", "return_sau_basecost"]);
            const returnSauBasecost =
              returnSauBasecostVal != null
                ? parseReturnNumber(returnSauBasecostVal)
                : Number((total - basecost).toFixed(2));

            const { month, quarter } = getMonthAndQuarter(effectiveDate);
            const tuan = Number(getColVal(["tuần", "tuan"])) || getIsoWeek(effectiveDate);
            const thang = Number(getColVal(["tháng", "thang"])) || month;
            const quy = Number(getColVal(["quý", "quy"])) || quarter;
            const trangThai = String(getColVal(["trạng thái", "trang thai"]) || master?.status || "Phát triển").trim();

            rawItems.push({
              date: effectiveDate,
              order_id: orderId || "---",
              sku,
              loai,
              pic,
              basecost,
              transaction_status: txStatus,
              transaction_type: txType,
              product_details: prodDetails,
              total_product_charges: prodCharges,
              total_promotional_rebates: rebates,
              amazon_fees: amazonFees,
              other,
              total,
              return_sau_basecost: returnSauBasecost,
              tuan,
              thang,
              quy,
              trang_thai: trangThai,
            });
          }
        }
        break;
      } else {
        for await (const _ of ws) {}
      }
    }
  } else {
    // CSV / TSV file
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
    const statusIdx = getIdx(["transaction status", "status", "trạng thái giao dịch"]);
    const typeIdx = getIdx(["transaction type", "type", "loại giao dịch"]);
    const orderIdIdx = getIdx(["order id", "order-id", "mã đơn", "order_id"]);
    const detailsIdx = getIdx(["product details", "product-details", "product name", "chi tiết sản phẩm"]);
    const chargesIdx = getIdx(["total product charges", "product charges"]);
    const rebatesIdx = getIdx(["total promotional rebates", "promotional rebates"]);
    const feesIdx = getIdx(["amazon fees", "fees", "phí amazon"]);
    const otherIdx = getIdx(["other", "khác"]);
    const totalIdx = getIdx(["total (usd)", "total", "tổng"]);
    const skuIdx = getIdx(["sku", "msku"]);
    const loaiIdx = getIdx(["loại", "loai"]);
    const picIdx = getIdx(["pic", "pic mkt"]);
    const basecostIdx = getIdx(["basecost", "chi phí gốc"]);
    const retAfterBcIdx = getIdx(["return sau khi trừ basecost"]);
    const tuanIdx = getIdx(["tuần", "tuan"]);
    const thangIdx = getIdx(["tháng", "thang"]);
    const quyIdx = getIdx(["quý", "quy"]);
    const trangThaiIdx = getIdx(["trạng thái", "trang thai"]);

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i], delimiter);
      const getVal = (idx: number) => (idx !== -1 && idx < parts.length ? parts[idx].trim().replace(/^"|"$/g, "") : "");

      const dateRaw = getVal(dateIdx);
      const cleanDate = cleanReturnDate(dateRaw);
      const orderId = getVal(orderIdIdx);

      if (!cleanDate && !orderId) continue;
      const effectiveDate = cleanDate || new Date().toISOString().split("T")[0];

      let sku = getVal(skuIdx);
      const orderInfo = orderId ? orderInfoMap.get(orderId) : null;
      if (!sku && orderInfo) {
        sku = orderInfo.sku;
      }

      const master = sku ? skuMap.get(sku.toUpperCase()) : null;
      const loai = getVal(loaiIdx) || orderInfo?.loai || master?.loai || "FBA";
      const pic = getVal(picIdx) || master?.pic || "";
      const basecostVal = getVal(basecostIdx);
      const basecost = basecostVal ? parseReturnNumber(basecostVal) : master ? -Math.abs(master.basecost) : 0;

      const txStatus = getVal(statusIdx) || "Released";
      const txType = getVal(typeIdx) || "Refund";
      const prodDetails = getVal(detailsIdx);

      const prodCharges = parseReturnNumber(getVal(chargesIdx));
      const rebates = parseReturnNumber(getVal(rebatesIdx));
      const amazonFees = parseReturnNumber(getVal(feesIdx));
      const other = parseReturnNumber(getVal(otherIdx));
      const total = parseReturnNumber(getVal(totalIdx));

      const retAfterBcVal = getVal(retAfterBcIdx);
      const returnSauBasecost = retAfterBcVal
        ? parseReturnNumber(retAfterBcVal)
        : Number((total - basecost).toFixed(2));

      const { month, quarter } = getMonthAndQuarter(effectiveDate);
      const tuan = parseInt(getVal(tuanIdx), 10) || getIsoWeek(effectiveDate);
      const thang = parseInt(getVal(thangIdx), 10) || month;
      const quy = parseInt(getVal(quyIdx), 10) || quarter;
      const trangThai = getVal(trangThaiIdx) || master?.status || "Phát triển";

      rawItems.push({
        date: effectiveDate,
        order_id: orderId || "---",
        sku,
        loai,
        pic,
        basecost,
        transaction_status: txStatus,
        transaction_type: txType,
        product_details: prodDetails,
        total_product_charges: prodCharges,
        total_promotional_rebates: rebates,
        amazon_fees: amazonFees,
        other,
        total,
        return_sau_basecost: returnSauBasecost,
        tuan,
        thang,
        quy,
        trang_thai: trangThai,
      });
    }
  }

  // Deduplication & Deterministic Row Hash
  const occurrenceTracker = new Map<string, number>();
  const results: Omit<ReturnItem, "id" | "created_at" | "updated_at">[] = [];

  for (const item of rawItems) {
    const key = `${item.date}::${item.order_id}::${item.total.toFixed(2)}::${item.amazon_fees.toFixed(2)}`;
    const count = (occurrenceTracker.get(key) || 0) + 1;
    occurrenceTracker.set(key, count);

    const hashPayload = `${storeId}::${key}::occ_${count}`;
    const rowHash = createHash("md5").update(hashPayload).digest("hex");

    results.push({
      store_id: storeId,
      date: item.date,
      order_id: item.order_id,
      sku: item.sku,
      loai: item.loai,
      pic: item.pic,
      basecost: item.basecost,
      transaction_status: item.transaction_status,
      transaction_type: item.transaction_type,
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
      row_hash: rowHash,
      custom_fields: {},
    });
  }

  return results;
}

export async function listReturns(
  storeId: string,
  params: {
    page?: number;
    limit?: number;
    search?: string;
    dateSort?: "asc" | "desc";
    startDate?: string;
    endDate?: string;
    sku?: string;
    orderId?: string;
    status?: string;
    filters?: Record<string, string>;
  } = {}
): Promise<{
  items: ReturnItem[];
  totalRows: number;
  stats: ReturnStats;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const sql = await getDatabaseClient();
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(1000, params.limit || 50));
  const offset = (page - 1) * limit;
  const dateSort = params.dateSort === "asc" ? "ASC" : "DESC";

  // Build filter conditions
  const conditions = [sql`store_id = ${storeId}`];

  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(sql`(
      order_id ILIKE ${q} OR
      sku ILIKE ${q} OR
      pic ILIKE ${q} OR
      product_details ILIKE ${q} OR
      transaction_status ILIKE ${q} OR
      trang_thai ILIKE ${q}
    )`);
  }

  if (params.startDate) {
    conditions.push(sql`date >= ${params.startDate}::date`);
  }
  if (params.endDate) {
    conditions.push(sql`date <= ${params.endDate}::date`);
  }
  if (params.sku) {
    conditions.push(sql`sku ILIKE ${`%${params.sku.trim()}%`}`);
  }
  if (params.orderId) {
    conditions.push(sql`order_id ILIKE ${`%${params.orderId.trim()}%`}`);
  }
  if (params.status) {
    conditions.push(sql`transaction_status = ${params.status}`);
  }

  if (params.filters) {
    for (const [col, val] of Object.entries(params.filters)) {
      if (!val) continue;
      const q = `%${val.trim()}%`;
      if (col === "order_id") conditions.push(sql`order_id ILIKE ${q}`);
      else if (col === "sku") conditions.push(sql`sku ILIKE ${q}`);
      else if (col === "pic") conditions.push(sql`pic ILIKE ${q}`);
      else if (col === "loai") conditions.push(sql`loai ILIKE ${q}`);
      else if (col === "transaction_status") conditions.push(sql`transaction_status ILIKE ${q}`);
      else if (col === "transaction_type") conditions.push(sql`transaction_type ILIKE ${q}`);
      else if (col === "trang_thai") conditions.push(sql`trang_thai ILIKE ${q}`);
      else if (col === "product_details") conditions.push(sql`product_details ILIKE ${q}`);
    }
  }

  const whereClause = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  // Compute aggregate stats across matching dataset
  const [statsResult] = await sql<
    {
      total_rows: string;
      total_amount: string;
      total_charges: string;
      total_rebates: string;
      total_amazon_fees: string;
      total_other: string;
      total_basecost: string;
      total_ret_sau_basecost: string;
      unique_orders: string;
      unique_skus: string;
    }[]
  >`
    SELECT
      COUNT(*)::text as total_rows,
      COALESCE(SUM(total), 0)::text as total_amount,
      COALESCE(SUM(total_product_charges), 0)::text as total_charges,
      COALESCE(SUM(total_promotional_rebates), 0)::text as total_rebates,
      COALESCE(SUM(amazon_fees), 0)::text as total_amazon_fees,
      COALESCE(SUM(other), 0)::text as total_other,
      COALESCE(SUM(basecost), 0)::text as total_basecost,
      COALESCE(SUM(return_sau_basecost), 0)::text as total_ret_sau_basecost,
      COUNT(DISTINCT order_id)::text as unique_orders,
      COUNT(DISTINCT NULLIF(sku, ''))::text as unique_skus
    FROM accounting_returns
    WHERE ${whereClause}
  `;

  const totalRows = parseInt(statsResult?.total_rows || "0", 10);
  const totalPages = Math.ceil(totalRows / limit) || 1;

  // Retrieve paginated items
  const items = await sql<ReturnItem[]>`
    SELECT
      id, store_id, date::text as date, order_id, sku, loai, pic,
      basecost::float, transaction_status, transaction_type, product_details,
      total_product_charges::float, total_promotional_rebates::float,
      amazon_fees::float, other::float, total::float,
      return_sau_basecost::float, tuan, thang, quy, trang_thai,
      custom_fields, created_at::text, updated_at::text
    FROM accounting_returns
    WHERE ${whereClause}
    ORDER BY date ${sql.unsafe(dateSort)}, order_id ASC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const stats: ReturnStats = {
    totalRows,
    totalAmount: parseFloat(statsResult?.total_amount || "0"),
    totalProductCharges: parseFloat(statsResult?.total_charges || "0"),
    totalPromotionalRebates: parseFloat(statsResult?.total_rebates || "0"),
    totalAmazonFees: parseFloat(statsResult?.total_amazon_fees || "0"),
    totalOther: parseFloat(statsResult?.total_other || "0"),
    totalBasecost: parseFloat(statsResult?.total_basecost || "0"),
    totalReturnSauBasecost: parseFloat(statsResult?.total_ret_sau_basecost || "0"),
    uniqueOrders: parseInt(statsResult?.unique_orders || "0", 10),
    uniqueSkus: parseInt(statsResult?.unique_skus || "0", 10),
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

export async function batchUpsertReturns(
  storeId: string,
  items: Omit<ReturnItem, "id" | "created_at" | "updated_at">[]
): Promise<{ count: number; createdCount: number }> {
  if (items.length === 0) return { count: 0, createdCount: 0 };
  const sql = await getDatabaseClient();

  // Deduplicate within the same batch by row_hash
  const dedupedMap = new Map<string, typeof items[0]>();
  for (const item of items) {
    if (item.row_hash) {
      dedupedMap.set(item.row_hash, item);
    }
  }
  const deduped = Array.from(dedupedMap.values());
  if (deduped.length === 0) return { count: 0, createdCount: 0 };

  const snapshotDates = Array.from(new Set(deduped.map((item) => item.date).filter(Boolean)));
  const CHUNK_SIZE = 500;
  const cols = [
    "store_id", "date", "order_id", "sku", "loai", "pic", "basecost",
    "transaction_status", "transaction_type", "product_details",
    "total_product_charges", "total_promotional_rebates", "amazon_fees",
    "other", "total", "return_sau_basecost", "tuan", "thang", "quy",
    "trang_thai", "row_hash"
  ] as const;

  // File Return là snapshot đầy đủ theo ngày. Thay thế nguyên ngày để dữ liệu cũ
  // (đặc biệt các dòng từng thiếu SKU) không tồn tại song song với snapshot mới.
  await sql.begin(async (transaction) => {
    await transaction`
      DELETE FROM accounting_returns
      WHERE store_id = ${storeId}
        AND date IN ${transaction(snapshotDates)}
    `;

    for (let i = 0; i < deduped.length; i += CHUNK_SIZE) {
      const chunk = deduped.slice(i, i + CHUNK_SIZE);
      await transaction`
        INSERT INTO accounting_returns ${transaction(chunk, ...cols)}
      `;
    }
  });

  return { count: deduped.length, createdCount: deduped.length };
}

export async function updateReturnCell(
  storeId: string,
  id: string,
  field: string,
  value: any
): Promise<void> {
  const sql = await getDatabaseClient();
  const allowedFields = [
    "sku", "loai", "pic", "basecost", "transaction_status", "product_details",
    "total", "return_sau_basecost", "tuan", "thang", "quy", "trang_thai"
  ];

  if (!allowedFields.includes(field)) {
    throw new Error(`Field '${field}' is not allowed to be edited directly.`);
  }

  await sql`
    UPDATE accounting_returns
    SET ${sql({ [field]: value, updated_at: new Date().toISOString() })}
    WHERE store_id = ${storeId} AND id = ${id}
  `;
}

export async function deleteReturn(storeId: string, id: string): Promise<void> {
  const sql = await getDatabaseClient();
  await sql`
    DELETE FROM accounting_returns
    WHERE store_id = ${storeId} AND id = ${id}
  `;
}

export async function deleteReturnBatch(storeId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const sql = await getDatabaseClient();
  const res = await sql`
    DELETE FROM accounting_returns
    WHERE store_id = ${storeId} AND id IN ${sql(ids)}
  `;
  return res.count || ids.length;
}
