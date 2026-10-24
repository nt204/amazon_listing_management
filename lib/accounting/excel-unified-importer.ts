import "server-only";

import fs from "node:fs";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import ExcelJS from "exceljs";

import { getDatabaseClient } from "@/lib/db";
import {
  normalizeOrderRow,
  batchUpsertOrders,
  type OrderItem,
} from "./orders-db";
import {
  cleanAdsDate,
  getMonthAndQuarter as getAdsMonthAndQuarter,
  getIsoWeek as getAdsIsoWeek,
  batchUpsertAds,
  type AdsItem,
} from "./ads-db";
import {
  cleanReturnDate,
  parseReturnNumber,
  getMonthAndQuarter as getReturnMonthAndQuarter,
  getIsoWeek as getReturnIsoWeek,
  batchUpsertReturns,
  type ReturnItem,
} from "./returns-db";
import {
  cleanServiceFeeDate,
  parseServiceFeeNumber,
  getMonthAndQuarter as getServiceFeeMonthAndQuarter,
  getIsoWeek as getServiceFeeIsoWeek,
  batchUpsertServiceFees,
  type ServiceFeeItem,
} from "./service-fees-db";
import {
  cleanDateOnly,
  parseInteger,
  parseNumeric,
  syncCheckShipmentsToInbound,
  INBOUND_HEADER_MAP,
  CHECK_SHIPMENT_HEADER_MAP,
} from "./inventory-db";

export function extractCellVal(val: any): any {
  if (val == null) return null;
  let curr = val;
  while (curr && typeof curr === "object" && !(curr instanceof Date)) {
    if ("result" in curr && curr.result !== undefined && curr.result !== null) {
      curr = curr.result;
    } else if ("text" in curr && curr.text !== undefined && curr.text !== null) {
      curr = curr.text;
    } else if ("hyperlink" in curr && curr.hyperlink !== undefined && curr.hyperlink !== null) {
      curr = curr.hyperlink;
    } else if (Array.isArray(curr.richText)) {
      curr = curr.richText.map((t: any) => t.text || "").join("");
      break;
    } else if ("formula" in curr && typeof curr.formula === "string") {
      const match = curr.formula.match(/,\s*"([^"]+)"\s*\)$/);
      if (match) {
        curr = match[1];
        break;
      }
      return null;
    } else {
      break;
    }
  }
  if (curr && typeof curr === "object" && !(curr instanceof Date)) {
    return null;
  }
  return curr;
}

export function cleanUrlCandidate(val: any): string | null {
  if (val == null) return null;
  let c = extractCellVal(val);
  if (c && typeof c === "object") {
    if ("hyperlink" in c && typeof c.hyperlink === "string") c = c.hyperlink;
    else if ("text" in c && typeof c.text === "string") c = c.text;
    else if ("result" in c && typeof c.result === "string") c = c.result;
  }
  if (!c || typeof c === "object") return null;
  const str = String(c).trim();
  if (
    !str ||
    str === "[object Object]" ||
    str.startsWith("=") ||
    str.toUpperCase().startsWith("IMAGE(")
  ) {
    return null;
  }
  if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("/")) {
    return str;
  }
  return null;
}

export function cleanTextVal(val: any): string | null {
  if (val == null) return null;
  let c = extractCellVal(val);
  if (c && typeof c === "object") {
    if ("text" in c && typeof c.text === "string") c = c.text;
    else if ("result" in c && typeof c.result === "string") c = c.result;
    else if ("hyperlink" in c && typeof c.hyperlink === "string") c = c.hyperlink;
  }
  if (c == null || typeof c === "object") return null;
  const str = String(c).trim();
  if (
    !str ||
    str === "[object Object]" ||
    str.startsWith("=") ||
    str.toUpperCase().startsWith("IFERROR(") ||
    str.toUpperCase().startsWith("INDEX(") ||
    str.toUpperCase().startsWith("_XLFN.")
  ) {
    return null;
  }
  return str;
}

export interface UnifiedImportResult {
  success: boolean;
  message: string;
  processedSheets: string[];
  counts: {
    orders: number;
    ads: number;
    returns: number;
    serviceFees: number;
    skuMaster: number;
    inbound?: number;
    checkShipment?: number;
    monthlyBasecost?: number;
  };
  totalProcessed: number;
  durationMs: number;
}

export interface UnifiedImportOptions {
  removeAfterDone?: boolean;
  chunkSize?: number;
  onProgress?: (sheetName: string, importedInSheet: number) => void;
}

/**
 * Đọc file Excel kế toán đa sheet (Orders, Ads, Returns, Service Fees, Bảng Mã, Đi Hàng, Check Shipment, Basecost Tháng)
 * Trực tiếp bằng stream 1 lượt (Single-Pass Stream) từ đĩa và commit từng chunk (1000 dòng) vào PostgreSQL.
 * Giải phóng RAM liên tục, không bao giờ gom toàn bộ mảng dữ liệu vào bộ nhớ, tránh OOM tuyệt đối.
 * Tự động xóa file tạm sau khi nạp xong.
 */
export async function importUnifiedAccountingExcel(
  filePath: string,
  storeId: string,
  options: UnifiedImportOptions = {}
): Promise<UnifiedImportResult> {
  const startTime = Date.now();
  const chunkSize = options.chunkSize || 1000;
  const counts = {
    orders: 0,
    ads: 0,
    returns: 0,
    serviceFees: 0,
    skuMaster: 0,
    inbound: 0,
    checkShipment: 0,
    monthlyBasecost: 0,
  };
  const processedSheets: string[] = [];

  if (!fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại trên hệ thống: ${filePath}`);
  }

  const sql = await getDatabaseClient();

  // 1. Quét danh sách sheet từ metadata zip mà không giải nén nội dung xml
  let sheetNames: string[] = [];
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(fileBuffer);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
    if (workbookXml) {
      sheetNames = [...workbookXml.matchAll(/<sheet [^>]*name=\"([^\"]+)\"/g)].map((m) => m[1]);
    }
  } catch (err: any) {
    console.warn("[ExcelUnifiedImporter] Không thể đọc danh sách sheet qua JSZip:", err.message);
  }

  // 2. Tìm tên sheet tương ứng cho các bảng
  const findSheet = (patterns: string[]): string | null => {
    for (const p of patterns) {
      const match = sheetNames.find((s) => s.trim().toLowerCase() === p.toLowerCase());
      if (match) return match;
    }
    for (const p of patterns) {
      const match = sheetNames.find((s) => s.trim().toLowerCase().includes(p.toLowerCase()));
      if (match) return match;
    }
    return null;
  };

  const targetOrdersSheet = findSheet(["đầu vào order", "all orders", "orders", "order"]);
  const targetAdsSheet = findSheet(["ads", "campaign ads", "campaigns", "portfolio"]);
  const targetReturnSheet = findSheet(["return", "returns"]);
  const targetServiceFeeSheet = findSheet(["service fees", "service fee", "servicefees"]);
  const targetSkuMasterSheet = findSheet(["bảng mã", "bang ma", "sku master", "bang_ma", "danh mục sku", "bảng mã sku"]);
  const targetInboundSheet = findSheet(["chi tiết đi hàng", "chi tiet di hang", "inbound shipments", "inbound", "di hang"]);
  const targetCheckShipmentSheet = findSheet(["check shipment amazon", "check shipment", "check_shipment", "shipment amazon", "check shipment amz"]);
  const targetBasecostThangSheet = findSheet(["basecost tháng", "basecost thang", "basecost_thang", "monthly basecost", "base cost tháng"]);

  const targetSheetsToFind = new Set([
    targetOrdersSheet, 
    targetAdsSheet, 
    targetReturnSheet, 
    targetServiceFeeSheet, 
    targetSkuMasterSheet,
    targetInboundSheet,
    targetCheckShipmentSheet,
    targetBasecostThangSheet
  ].filter(Boolean) as string[]);
  let completedSheetsCount = 0;

  console.log("[ExcelUnifiedImporter] Mục tiêu sheet nhận diện được:", {
    targetOrdersSheet,
    targetAdsSheet,
    targetReturnSheet,
    targetServiceFeeSheet,
    targetSkuMasterSheet,
    targetInboundSheet,
    targetCheckShipmentSheet,
    targetBasecostThangSheet,
    totalTargetSheets: targetSheetsToFind.size,
  });

  // Pre-load all stores to route brands in Check Shipment
  const allStores = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM stores
  `;
  const storeByName = new Map<string, string>();
  for (const st of allStores) {
    if (st.name) storeByName.set(st.name.trim().toLowerCase(), st.id);
  }

  // Chuẩn bị SKU Master & Store Metadata trước cho Ads, Return, Inbound & Basecost
  const skuMasters = await sql<{ id: string; sku: string; brand: string | null; product_type: string | null; mockup: string | null; loai: string | null; pic_mkt: string | null; status: string | null; basecost_tb: string | null }[]>`
    SELECT id, sku, brand, product_type, mockup, loai, pic_mkt, status, basecost_tb::text
    FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;
  const skuMap = new Map<string, { id: string | null; brand: string; productType: string; loai: string; pic_mkt: string; pic: string; status: string; basecost: number; mockup?: string | null }>();
  for (const s of skuMasters) {
    const skuKey = s.sku.trim().toUpperCase();
    skuMap.set(skuKey, {
      id: s.id,
      brand: s.brand || "",
      productType: s.product_type || "",
      loai: s.loai || "",
      pic_mkt: s.pic_mkt || "",
      pic: s.pic_mkt || "",
      status: s.status || "Phát triển",
      basecost: parseFloat(s.basecost_tb || "0") || 0,
      mockup: cleanUrlCandidate(s.mockup),
    });
  }

  // Lấy store name
  const storeRes = await sql<{ name: string }[]>`
    SELECT name FROM stores WHERE id = ${storeId} LIMIT 1
  `;
  const storeName = storeRes[0]?.name || "STORE";

  // Tracker cho Returns, Service Fees & Orders để sinh deterministic hash / unique item id
  const returnOccurrenceTracker = new Map<string, number>();
  const serviceFeeOccurrenceTracker = new Map<string, number>();
  const orderOccurrenceTracker = new Map<string, number>();

  try {
    // 3. ĐỌC SINGLE-PASS DUY NHẤT TOÀN BỘ WORKBOOK
    const stream = fs.createReadStream(filePath);
    const workbookReader = new (ExcelJS.stream.xlsx as any).WorkbookReader(stream, {
      entries: "emit",
      sharedStrings: "cache",
      styles: "ignore",
      hyperlinks: "ignore",
      worksheets: "emit",
    });

    for await (const ws of workbookReader) {
      const currentSheetName = ws.name;

      // ==========================================
      // SHEET 1: ĐẦU VÀO ORDER
      // ==========================================
      if (currentSheetName === targetOrdersSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Orders: "${currentSheetName}"`);
        const orderRows: Partial<OrderItem>[] = [];
        const headers: string[] = [];
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

            // Fallback: Nếu ô tiêu đề cột order-item-id bị trống trong Excel (ví dụ Col AM / index 38-40)
            if (!rowData["order-item-id"] && !rowData["order_item_id"]) {
              for (let i = 35; i < vals.length; i++) {
                const val = vals[i];
                if (val != null) {
                  let rawVal = typeof val === "object" ? (val.result ?? val.text ?? val) : val;
                  if (typeof rawVal === "number" && rawVal > 1e13 && rawVal < 1e16) {
                    rowData["order-item-id"] = BigInt(Math.round(rawVal)).toString();
                    break;
                  } else if (typeof rawVal === "string" && /^\d{13,16}$/.test(rawVal.trim())) {
                    rowData["order-item-id"] = rawVal.trim();
                    break;
                  }
                }
              }
            }

            const normalized = normalizeOrderRow(rowData, storeId, null);
            if (normalized) {
              const occKey = `${normalized.amazon_order_id}::${normalized.sku}`;
              const occ = (orderOccurrenceTracker.get(occKey) || 0) + 1;
              orderOccurrenceTracker.set(occKey, occ);
              if (!normalized.order_item_id && occ > 1) {
                normalized.order_item_id = `item_${occ}`;
              }
              orderRows.push(normalized);
            }
          }
        }
        if (orderRows.length > 0) {
          const res = await batchUpsertOrders(storeId, orderRows, { snapshot: "dates" });
          counts.orders += res.count;
          options.onProgress?.("orders", counts.orders);
        }
        processedSheets.push(`Orders (${currentSheetName}): ${counts.orders.toLocaleString()} dòng`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Orders: ${counts.orders} dòng`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 2: ADS
      // ==========================================
      else if (currentSheetName === targetAdsSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet ADS: "${currentSheetName}"`);
        let adsChunk: Array<Omit<AdsItem, "id" | "created_at" | "updated_at">> = [];
        const headers: string[] = [];
        let isHeaderRow = true;

        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) {
                let str = "";
                if (typeof v === "object" && v !== null) {
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

            const portfolioVal = getColVal(["portfolio", "portfolio name", "state"]);
            if (!portfolioVal) continue;
            const portfolio = String(portfolioVal).trim();
            if (!portfolio) continue;

            const dateRaw = getColVal(["date", "ngày", "state"]) || vals[1];
            const cleanDate = cleanAdsDate(dateRaw);
            if (!cleanDate) continue;

            const spend = Number(getColVal(["spend(usd)", "spend", "chi phí"])) || 0;
            const sales = Number(getColVal(["sales(usd)", "sales", "doanh thu"])) || 0;
            const clicks = Number(getColVal(["clicks", "click"])) || 0;
            const impressions = Number(getColVal(["impressions", "impression"])) || 0;
            const orders = Number(getColVal(["orders", "order"])) || 0;
            const status = String(getColVal(["status", "trạng thái portfolio"]) || "PORTFOLIO_STATUS_ENABLED").trim();
            const budgetType = String(getColVal(["budget type", "loại budget"]) || "NO_CAP").trim();
            const budget = Number(getColVal(["budget(usd)", "budget"])) || 0;
            const budgetStart = String(getColVal(["budget start"]) || "").trim();
            const budgetEnd = String(getColVal(["budget end"]) || "").trim();
            const campaignCount = Number(getColVal(["campaign count"])) || 0;
            const ctr = Number(getColVal(["ctr"])) || (impressions > 0 ? clicks / impressions : 0);
            const cpc = Number(getColVal(["cpc(usd)", "cpc"])) || (clicks > 0 ? spend / clicks : 0);
            const acos = Number(getColVal(["acos"])) || (sales > 0 ? spend / sales : 0);
            const roas = Number(getColVal(["roas"])) || (spend > 0 ? sales / spend : 0);

            let sku = String(getColVal(["sku", "msku"]) || "").trim();
            let loai = String(getColVal(["loại", "loai"]) || "").trim();
            let mktPic = String(getColVal(["mkt pic", "pic mkt", "pic"]) || "").trim();
            let trangThai = String(getColVal(["trạng thái", "trang thai"]) || "").trim();

            if (!sku) {
              for (const [knownSkuKey] of skuMap) {
                if (portfolio.toUpperCase().includes(knownSkuKey)) {
                  sku = knownSkuKey;
                  break;
                }
              }
              if (!sku) {
                const tokens = portfolio.split(/\s+/);
                const lastToken = tokens[tokens.length - 1];
                if (lastToken && /^[A-Z0-9-]+$/i.test(lastToken) && lastToken.length >= 4) {
                  sku = lastToken;
                }
              }
            }

            const matchedMaster = sku ? skuMap.get(sku.toUpperCase()) : null;
            if (!loai) loai = matchedMaster?.loai || "";
            if (!mktPic) mktPic = matchedMaster?.pic_mkt || portfolio.split(/\s+/)[0] || "";
            if (!trangThai) trangThai = matchedMaster?.status || "Phát triển";

            const { month, quarter } = getAdsMonthAndQuarter(cleanDate);
            const tuan = Number(getColVal(["tuần", "tuan"])) || getAdsIsoWeek(cleanDate);
            const thang = Number(getColVal(["tháng", "thang"])) || month;
            const quy = Number(getColVal(["quý", "quy"])) || quarter;
            const thue10 = Number(getColVal(["thuế 10%", "thue 10%"])) || Number((spend * 0.1).toFixed(3));

            adsChunk.push({
              store_id: storeId,
              date: cleanDate,
              portfolio,
              status,
              budget_type: budgetType,
              budget,
              budget_start: budgetStart,
              budget_end: budgetEnd,
              campaign_count: campaignCount,
              impressions,
              clicks,
              ctr,
              spend,
              cpc,
              orders,
              sales,
              acos,
              roas,
              ntb_orders: 0,
              pct_orders_ntb: 0,
              ntb_sales: 0,
              pct_sales_ntb: 0,
              viewable_impressions: 0,
              vcpm: 0,
              sku,
              loai,
              mkt_pic: mktPic,
              tuan,
              thang,
              quy,
              thue_10: thue10,
              trang_thai: trangThai,
            });

            // Giữ toàn bộ sheet để batchUpsertAds thay snapshot theo ngày đúng
            // một lần; gọi theo chunk sẽ làm chunk sau xóa dữ liệu chunk trước.
          }
        }
        if (adsChunk.length > 0) {
          const res = await batchUpsertAds(storeId, adsChunk, { snapshot: "dates" });
          counts.ads += res.count;
          adsChunk = [];
        }
        processedSheets.push(`ADS (${currentSheetName}): ${counts.ads.toLocaleString()} dòng`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet ADS: ${counts.ads} dòng`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 3: RETURN
      // ==========================================
      else if (currentSheetName === targetReturnSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Return: "${currentSheetName}"`);
        let returnChunk: Omit<ReturnItem, "id" | "created_at" | "updated_at">[] = [];
        const headers: string[] = [];
        let isHeaderRow = true;

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
            const dateRaw = getColVal(["date", "ngày"]) || vals[5] || vals[6];
            const cleanDate = cleanReturnDate(dateRaw);
            const orderId = String(orderIdRaw || "").trim();

            if (!cleanDate && !orderId) continue;
            const effectiveDate = cleanDate || new Date().toISOString().split("T")[0];

            const sku = String(getColVal(["sku", "msku"]) || vals[1] || "").trim();
            const master = sku ? skuMap.get(sku.toUpperCase()) : null;
            const loai = String(getColVal(["loại", "loai"]) || master?.loai || "").trim();
            const pic = String(getColVal(["pic", "pic mkt", "mkt pic"]) || master?.pic || "").trim();
            const basecostVal = getColVal(["basecost", "chi phí gốc"]) || vals[4];
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

            const { month, quarter } = getReturnMonthAndQuarter(effectiveDate);
            const tuan = Number(getColVal(["tuần", "tuan"])) || getReturnIsoWeek(effectiveDate);
            const thang = Number(getColVal(["tháng", "thang"])) || month;
            const quy = Number(getColVal(["quý", "quy"])) || quarter;
            const trangThai = String(getColVal(["trạng thái", "trang thai"]) || master?.status || "Phát triển").trim();

            const key = `${effectiveDate}::${orderId}::${total.toFixed(2)}::${amazonFees.toFixed(2)}`;
            const count = (returnOccurrenceTracker.get(key) || 0) + 1;
            returnOccurrenceTracker.set(key, count);

            const hashPayload = `${storeId}::${key}::occ_${count}`;
            const rowHash = createHash("md5").update(hashPayload).digest("hex");

            returnChunk.push({
              store_id: storeId,
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
              row_hash: rowHash,
              custom_fields: {},
            });

            options.onProgress?.("returns", returnChunk.length);
          }
        }
        if (returnChunk.length > 0) {
          const res = await batchUpsertReturns(storeId, returnChunk, { snapshot: "dates" });
          counts.returns = res.count;
          returnChunk = [];
        }
        processedSheets.push(`RETURN (${currentSheetName}): ${counts.returns.toLocaleString()} dòng`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Return: ${counts.returns} dòng`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 4: SERVICE FEES
      // ==========================================
      else if (currentSheetName === targetServiceFeeSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Service Fees: "${currentSheetName}"`);
        let feeChunk: Omit<ServiceFeeItem, "id" | "created_at" | "updated_at">[] = [];
        const headers: string[] = [];
        let isHeaderRow = true;

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
            if (!headers[2]) headers[2] = "date";
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

            const storeNameVal = String(getColVal(["store", "cửa hàng"]) || vals[12] || storeName).trim();

            const { month, quarter } = getServiceFeeMonthAndQuarter(effectiveDate);
            const thang = parseInt(getColVal(["tháng", "thang"]) || vals[1], 10) || month;
            const tuan = getServiceFeeIsoWeek(effectiveDate);
            const quy = quarter;

            const key = `${effectiveDate}::${txType}::${prodDetails}::${total.toFixed(2)}::${orderId}`;
            const count = (serviceFeeOccurrenceTracker.get(key) || 0) + 1;
            serviceFeeOccurrenceTracker.set(key, count);

            const hashPayload = `${storeId}::${key}::occ_${count}`;
            const rowHash = createHash("md5").update(hashPayload).digest("hex");

            feeChunk.push({
              store_id: storeId,
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
              row_hash: rowHash,
              custom_fields: {},
            });

            if (feeChunk.length >= chunkSize) {
              const res = await batchUpsertServiceFees(storeId, feeChunk);
              counts.serviceFees += res.count;
              options.onProgress?.("serviceFees", counts.serviceFees);
              feeChunk = [];
            }
          }
        }
        if (feeChunk.length > 0) {
          const res = await batchUpsertServiceFees(storeId, feeChunk);
          counts.serviceFees += res.count;
          feeChunk = [];
        }
        processedSheets.push(`Service Fees (${currentSheetName}): ${counts.serviceFees.toLocaleString()} dòng`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Service Fees: ${counts.serviceFees} dòng`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 5: BẢNG MÃ (SKU MASTER)
      // ==========================================
      else if (currentSheetName === targetSkuMasterSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet BẢNG MÃ: "${currentSheetName}"`);
        const skuRows: Array<any> = [];
        const headers: string[] = [];
        let isHeaderRow = true;

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

            const skuVal = getColVal(["sku", "mã sku", "msku"]) || vals[4];
            if (!skuVal) continue;
            const sku = String(skuVal).trim();
            if (!sku || sku.toLowerCase() === "sku") continue;

            const brand = String(getColVal(["brand", "thương hiệu"]) || vals[1] || "").trim() || null;
            const productType = String(getColVal(["product type", "loại sản phẩm", "loại sp"]) || vals[2] || "").trim() || null;
            const rawMockupUrl = getColVal(["mockup url", "mockup_url", "url mockup", "link mockup"]) ?? extractCellVal(vals[17]);
            const rawMockup = getColVal(["mockup", "hình ảnh", "ảnh"]) ?? extractCellVal(vals[3]);
            const resolvedMockup = cleanUrlCandidate(rawMockupUrl) || cleanUrlCandidate(rawMockup) || null;
            const asin = String(getColVal(["asin"]) || vals[5] || "").trim() || null;
            const fnsku = String(getColVal(["fnsku"]) || vals[6] || "").trim() || null;
            const rawAmzFee = getColVal(["amazon fee", "fba fee", "amazon fee (chưa có referal fee)"]) || vals[7];
            const amazonFee = rawAmzFee != null && !isNaN(Number(rawAmzFee)) ? Number(rawAmzFee) : null;
            const rawRef = getColVal(["% referal", "% referral", "referral", "referal"]) || vals[8];
            let referralFeePct = rawRef != null && !isNaN(Number(rawRef)) ? Number(rawRef) : null;
            if (referralFeePct != null && referralFeePct > 1) referralFeePct = referralFeePct / 100;
            const picMkt = String(getColVal(["pic mkt", "marketing", "mkt pic"]) || vals[9] || "").trim() || null;
            const loai = String(getColVal(["loại", "loai"]) || vals[10] || "FBA").trim() || "FBA";
            const niche = String(getColVal(["niche"]) || vals[11] || "").trim() || null;
            const picIdea = String(getColVal(["pic idea", "idea pic"]) || vals[12] || "").trim() || null;
            const status = String(getColVal(["trạng thái", "status"]) || vals[13] || "Phát triển").trim() || "Phát triển";
            const rawBasecost = getColVal(["basecost trung bình", "basecost", "basecost_tb", "chi phí gốc"]) || extractCellVal(vals[24]);
            const basecostTb = rawBasecost != null && !isNaN(Number(rawBasecost)) ? Number(rawBasecost) : null;

            skuRows.push({
              store_id: storeId,
              sku,
              brand,
              product_type: productType,
              mockup: resolvedMockup,
              mockup_url: resolvedMockup,
              asin,
              fnsku,
              amazon_fee: amazonFee,
              referral_fee_pct: referralFeePct,
              pic_mkt: picMkt,
              loai,
              niche,
              pic_idea: picIdea,
              status,
              basecost_tb: basecostTb
            });
          }
        }

        if (skuRows.length > 0) {
          for (const s of skuRows) {
            const upsertRes = await sql<{ id: string }[]>`
              INSERT INTO accounting_sku_master (
                store_id, sku, brand, product_type, mockup, mockup_url, asin, fnsku, 
                amazon_fee, referral_fee_pct, pic_mkt, loai, niche, pic_idea, status, basecost_tb, updated_at
              ) VALUES (
                ${s.store_id}, ${s.sku}, ${s.brand}, ${s.product_type}, ${s.mockup}, ${s.mockup_url}, ${s.asin}, ${s.fnsku},
                ${s.amazon_fee}, ${s.referral_fee_pct}, ${s.pic_mkt}, ${s.loai}, ${s.niche}, ${s.pic_idea}, ${s.status}, ${s.basecost_tb}, NOW()
              )
              ON CONFLICT (store_id, sku) DO UPDATE SET
                brand = COALESCE(EXCLUDED.brand, accounting_sku_master.brand),
                product_type = COALESCE(EXCLUDED.product_type, accounting_sku_master.product_type),
                mockup = CASE 
                  WHEN EXCLUDED.mockup IS NOT NULL AND EXCLUDED.mockup != '[object Object]' THEN EXCLUDED.mockup
                  WHEN accounting_sku_master.mockup = '[object Object]' THEN NULL
                  ELSE accounting_sku_master.mockup
                END,
                mockup_url = CASE 
                  WHEN EXCLUDED.mockup_url IS NOT NULL AND EXCLUDED.mockup_url != '[object Object]' THEN EXCLUDED.mockup_url
                  WHEN accounting_sku_master.mockup_url = '[object Object]' THEN NULL
                  ELSE accounting_sku_master.mockup_url
                END,
                asin = COALESCE(EXCLUDED.asin, accounting_sku_master.asin),
                fnsku = COALESCE(EXCLUDED.fnsku, accounting_sku_master.fnsku),
                amazon_fee = COALESCE(EXCLUDED.amazon_fee, accounting_sku_master.amazon_fee),
                referral_fee_pct = COALESCE(EXCLUDED.referral_fee_pct, accounting_sku_master.referral_fee_pct),
                pic_mkt = COALESCE(EXCLUDED.pic_mkt, accounting_sku_master.pic_mkt),
                loai = COALESCE(EXCLUDED.loai, accounting_sku_master.loai),
                niche = COALESCE(EXCLUDED.niche, accounting_sku_master.niche),
                pic_idea = COALESCE(EXCLUDED.pic_idea, accounting_sku_master.pic_idea),
                status = COALESCE(EXCLUDED.status, accounting_sku_master.status),
                basecost_tb = COALESCE(EXCLUDED.basecost_tb, accounting_sku_master.basecost_tb),
                deleted_at = NULL,
                updated_at = NOW()
              RETURNING id
            `;
            const skuKey = s.sku.trim().toUpperCase();
            skuMap.set(skuKey, {
              id: upsertRes[0]?.id || skuMap.get(skuKey)?.id || null,
              brand: s.brand || "",
              productType: s.product_type || "",
              loai: s.loai || "",
              pic_mkt: s.pic_mkt || "",
              pic: s.pic_mkt || "",
              status: s.status || "Phát triển",
              basecost: s.basecost_tb || 0,
              mockup: s.mockup || null,
            });
          }
          counts.skuMaster = skuRows.length;
          options.onProgress?.("skuMaster", counts.skuMaster);
        }
        processedSheets.push(`BẢNG MÃ (${currentSheetName}): ${counts.skuMaster.toLocaleString()} SKU`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Bảng Mã: ${counts.skuMaster} SKU`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 6: CHI TIẾT ĐI HÀNG
      // ==========================================
      else if (currentSheetName === targetInboundSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Chi Tiết Đi Hàng: "${currentSheetName}"`);
        options.onProgress?.("inbound", counts.inbound);

        // Pre-load existing inbound shipments for this store to do fast O(1) matching
        const existingInbound = await sql<{ id: string; sku: string; shipment_id: string | null; ten_lo_hang: string | null }[]>`
          SELECT id, LOWER(TRIM(sku)) as sku, LOWER(TRIM(COALESCE(shipment_id, ''))) as shipment_id, LOWER(TRIM(COALESCE(ten_lo_hang, ''))) as ten_lo_hang
          FROM accounting_inbound_shipments
          WHERE store_id = ${storeId} AND deleted_at IS NULL
        `;
        const inboundByShipment = new Map<string, string>();
        const inboundByTenLoHang = new Map<string, string>();
        for (const row of existingInbound) {
          if (row.shipment_id) inboundByShipment.set(`${row.sku}::${row.shipment_id}`, row.id);
          if (row.ten_lo_hang) inboundByTenLoHang.set(`${row.sku}::${row.ten_lo_hang}`, row.id);
        }

        const headers: string[] = [];
        let isHeaderRow = true;
        let inboundChunk: any[] = [];

        const flushInboundChunk = async (chunk: any[]) => {
          for (const item of chunk) {
            if (item.targetId) {
              await sql`
                UPDATE accounting_inbound_shipments SET
                  sku_id = COALESCE(${item.sku_id}, accounting_inbound_shipments.sku_id),
                  brand = COALESCE(${item.brand}, accounting_inbound_shipments.brand),
                  sup = COALESCE(${item.sup}, accounting_inbound_shipments.sup),
                  ngay_request = COALESCE(${item.ngay_request}, accounting_inbound_shipments.ngay_request),
                  product_type = COALESCE(${item.product_type}, accounting_inbound_shipments.product_type),
                  mockup = COALESCE(${item.mockup}, accounting_inbound_shipments.mockup),
                  quantity = ${item.quantity},
                  line_ship = COALESCE(${item.line_ship}, accounting_inbound_shipments.line_ship),
                  base_cost_per_unit = COALESCE(${item.base_cost_per_unit}, accounting_inbound_shipments.base_cost_per_unit),
                  card = COALESCE(${item.card}, accounting_inbound_shipments.card),
                  tag = COALESCE(${item.tag}, accounting_inbound_shipments.tag),
                  shipping_fee = COALESCE(${item.shipping_fee}, accounting_inbound_shipments.shipping_fee),
                  hop_tui = COALESCE(${item.hop_tui}, accounting_inbound_shipments.hop_tui),
                  final_basecost = ${item.final_basecost},
                  total_basecost = ${item.total_basecost},
                  ngay_thanh_toan = COALESCE(${item.ngay_thanh_toan}, accounting_inbound_shipments.ngay_thanh_toan),
                  ten_lo_hang = COALESCE(${item.ten_lo_hang}, accounting_inbound_shipments.ten_lo_hang),
                  shipment_id = COALESCE(${item.shipment_id}, accounting_inbound_shipments.shipment_id),
                  ngay_di = COALESCE(${item.ngay_di}, accounting_inbound_shipments.ngay_di),
                  ngay_den = COALESCE(${item.ngay_den}, accounting_inbound_shipments.ngay_den),
                  amazon_received = COALESCE(${item.amazon_received}, accounting_inbound_shipments.amazon_received),
                  tinh_trang_hang_den_kho = CASE
                    WHEN accounting_inbound_shipments.tinh_trang_hang_den_kho LIKE '%object Object%' THEN COALESCE(${item.tinh_trang_hang_den_kho}, ${item.status}, 'Working')
                    ELSE COALESCE(${item.tinh_trang_hang_den_kho}, accounting_inbound_shipments.tinh_trang_hang_den_kho, ${item.status})
                  END,
                  status = CASE
                    WHEN accounting_inbound_shipments.status LIKE '%object Object%' THEN COALESCE(${item.status}, 'Working')
                    ELSE COALESCE(${item.status}, accounting_inbound_shipments.status, 'Working')
                  END,
                  so_luong_amazon_nhan = COALESCE(${item.so_luong_amazon_nhan}, accounting_inbound_shipments.so_luong_amazon_nhan),
                  discrepancy = COALESCE(${item.discrepancy}, accounting_inbound_shipments.discrepancy),
                  note = COALESCE(${item.note}, accounting_inbound_shipments.note),
                  trang_thai = COALESCE(${item.trang_thai}, accounting_inbound_shipments.trang_thai),
                  deleted_at = NULL,
                  updated_at = NOW()
                WHERE id = ${item.targetId}
              `;
            } else {
              const res = await sql<{ id: string }[]>`
                INSERT INTO accounting_inbound_shipments (
                  store_id, sku_id, brand, sup, ngay_request, product_type, mockup, sku,
                  quantity, line_ship, base_cost_per_unit, card, tag, shipping_fee, hop_tui,
                  final_basecost, total_basecost, ngay_thanh_toan, ten_lo_hang, shipment_id,
                  ngay_di, ngay_den, amazon_received, tinh_trang_hang_den_kho, status,
                  so_luong_amazon_nhan, discrepancy, note, trang_thai, created_at, updated_at
                ) VALUES (
                  ${item.store_id}, ${item.sku_id}, ${item.brand}, ${item.sup}, ${item.ngay_request}, ${item.product_type}, ${item.mockup}, ${item.sku},
                  ${item.quantity}, ${item.line_ship}, ${item.base_cost_per_unit}, ${item.card}, ${item.tag}, ${item.shipping_fee}, ${item.hop_tui},
                  ${item.final_basecost}, ${item.total_basecost}, ${item.ngay_thanh_toan}, ${item.ten_lo_hang}, ${item.shipment_id},
                  ${item.ngay_di}, ${item.ngay_den}, ${item.amazon_received}, ${item.tinh_trang_hang_den_kho}, ${item.status},
                  ${item.so_luong_amazon_nhan}, ${item.discrepancy}, ${item.note}, ${item.trang_thai}, NOW(), NOW()
                ) RETURNING id
              `;
              const newId = res[0]?.id;
              if (newId) {
                if (item.keyShipment) inboundByShipment.set(item.keyShipment, newId);
                if (item.keyTenLo) inboundByTenLoHang.set(item.keyTenLo, newId);
              }
            }
          }
        };

        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) {
                const raw = String(extractCellVal(v)).trim().toLowerCase().replace(/\s+/g, " ");
                headers[idx] = INBOUND_HEADER_MAP[raw] || raw;
              }
            });
          } else {
            const getColVal = (patterns: string[]): any => {
              for (const p of patterns) {
                const idx = headers.indexOf(p.toLowerCase());
                if (idx !== -1 && vals[idx] !== undefined) {
                  return extractCellVal(vals[idx]);
                }
              }
              return null;
            };

            const rawSku = getColVal(["sku", "mã sku", "ma sku"]) ?? extractCellVal(vals[6]);
            if (!rawSku) continue;
            const sku = String(rawSku).trim();
            if (!sku || sku.toLowerCase() === "sku") continue;

            const brand = cleanTextVal(getColVal(["brand", "thương hiệu"]) ?? extractCellVal(vals[1])) || storeName;
            const sup = cleanTextVal(getColVal(["sup", "supplier", "nhà cung cấp"]) ?? extractCellVal(vals[2]));
            const ngay_request = cleanDateOnly(getColVal(["ngay_request", "ngày request", "ngay request"]) ?? extractCellVal(vals[3]));
            const product_type = cleanTextVal(getColVal(["product_type", "product type", "loại sản phẩm", "loai sp"]) ?? extractCellVal(vals[4]));
            const rawMockupUrl = getColVal(["mockup url", "mockup_url", "url mockup", "link mockup"]);
            const rawMockup = getColVal(["mockup", "hình ảnh", "ảnh"]) ?? extractCellVal(vals[5]);
            const mockup = cleanUrlCandidate(rawMockupUrl) || cleanUrlCandidate(rawMockup) || (sku ? skuMap.get(sku.toUpperCase())?.mockup : null) || null;
            const quantity = parseInteger(getColVal(["quantity", "số lượng", "so luong", "qty"]) ?? extractCellVal(vals[7])) || 0;
            const line_ship = cleanTextVal(getColVal(["line_ship", "line ship", "vận chuyển"]) ?? extractCellVal(vals[8]));
            const base_cost_per_unit = parseNumeric(getColVal(["base_cost_per_unit", "base cost/unit", "base cost"]) ?? extractCellVal(vals[9]));
            const card = parseNumeric(getColVal(["card"]) ?? extractCellVal(vals[10]));
            const tag = parseNumeric(getColVal(["tag"]) ?? extractCellVal(vals[11]));
            const shipping_fee = parseNumeric(getColVal(["shipping_fee", "shipping fee", "phí ship"]) ?? extractCellVal(vals[12]));
            const hop_tui = parseNumeric(getColVal(["hop_tui", "hộp/túi", "hop/tui", "hộp", "túi"]) ?? extractCellVal(vals[13]));
            const rawFinalBasecost = parseNumeric(getColVal(["final_basecost", "final basecose", "final basecost"]) ?? extractCellVal(vals[14]));
            const final_basecost = rawFinalBasecost ?? ((base_cost_per_unit || 0) + (card || 0) + (tag || 0) + (shipping_fee || 0) + (hop_tui || 0));
            const rawTotalBasecost = parseNumeric(getColVal(["total_basecost", "total basecost", "total base cost"]) ?? extractCellVal(vals[15]));
            const total_basecost = rawTotalBasecost ?? (final_basecost * quantity);
            const ngay_thanh_toan = cleanDateOnly(getColVal(["ngay_thanh_toan", "ngày thanh toán", "ngay thanh toan"]) ?? extractCellVal(vals[16]));
            const ten_lo_hang = cleanTextVal(getColVal(["ten_lo_hang", "tên lô hàng", "ten lo hang"]) ?? extractCellVal(vals[17]));
            const shipment_id = cleanTextVal(getColVal(["shipment_id", "shipment id", "mã shipment"]) ?? extractCellVal(vals[18]));
            const ngay_di = cleanDateOnly(getColVal(["ngay_di", "ngày đi", "ngay di"]) ?? extractCellVal(vals[19]));
            const ngay_den = cleanDateOnly(getColVal(["ngay_den", "ngày đến", "ngay den"]) ?? extractCellVal(vals[20]));
            const amazon_received = parseInteger(getColVal(["amazon_received", "amazon received"]) ?? extractCellVal(vals[21]));
            const rawTinhTrang = cleanTextVal(getColVal(["tinh_trang_hang_den_kho", "tình trạng hàng đến kho"]) ?? extractCellVal(vals[22]));
            const rawStatus = cleanTextVal(getColVal(["status", "trạng thái shipment"]) ?? extractCellVal(vals[23]));
            const status = rawStatus || rawTinhTrang || "Working";
            const tinh_trang_hang_den_kho = rawTinhTrang || rawStatus || status;
            const isStar = Boolean(shipment_id?.toLowerCase().startsWith("star"));
            const rawSoLuongNhan = parseInteger(getColVal(["so_luong_amazon_nhan", "số lượng amazon nhận"]) ?? extractCellVal(vals[24]));
            const so_luong_amazon_nhan = isStar ? quantity : rawSoLuongNhan;
            const rawDiscrepancy = parseInteger(getColVal(["discrepancy", "chênh lệch"]) ?? extractCellVal(vals[25]));
            const discrepancy = isStar ? 0 : (rawDiscrepancy ?? ((quantity || 0) - (so_luong_amazon_nhan ?? amazon_received ?? 0)));
            const note = cleanTextVal(getColVal(["note", "ghi chú"]) ?? extractCellVal(vals[26]));
            const trang_thai = cleanTextVal(getColVal(["trang_thai", "trạng thái"]) ?? extractCellVal(vals[27])) || "Phát triển";

            // Bỏ qua dòng placeholder nếu số lượng <= 0 và không có shipment_id
            if (quantity <= 0 && (!shipment_id || !shipment_id.trim())) continue;

            const skuKey = sku.toUpperCase();
            const skuMeta = skuMap.get(skuKey);
            const sku_id = skuMeta?.id || null;

            // Match existing record
            const keyShipment = shipment_id ? `${sku.toLowerCase()}::${shipment_id.toLowerCase()}` : "";
            const keyTenLo = ten_lo_hang ? `${sku.toLowerCase()}::${ten_lo_hang.toLowerCase()}` : "";
            const targetId = (keyShipment ? inboundByShipment.get(keyShipment) : null) || (keyTenLo ? inboundByTenLoHang.get(keyTenLo) : null);

            inboundChunk.push({
              targetId,
              store_id: storeId,
              sku_id,
              brand,
              sup,
              ngay_request,
              product_type: product_type || skuMeta?.productType || null,
              mockup,
              sku,
              quantity,
              line_ship,
              base_cost_per_unit,
              card,
              tag,
              shipping_fee,
              hop_tui,
              final_basecost,
              total_basecost,
              ngay_thanh_toan,
              ten_lo_hang,
              shipment_id,
              ngay_di,
              ngay_den,
              amazon_received,
              tinh_trang_hang_den_kho,
              status,
              so_luong_amazon_nhan,
              discrepancy,
              note,
              trang_thai,
              keyShipment,
              keyTenLo
            });

            if (inboundChunk.length >= chunkSize) {
              await flushInboundChunk(inboundChunk);
              counts.inbound += inboundChunk.length;
              options.onProgress?.("inbound", counts.inbound);
              inboundChunk = [];
            }
          }
        }

        if (inboundChunk.length > 0) {
          await flushInboundChunk(inboundChunk);
          counts.inbound += inboundChunk.length;
          inboundChunk = [];
        }

        // Tự động đồng bộ ngay Check Shipment sang Chi Tiết Đi Hàng
        await syncCheckShipmentsToInbound(storeId, undefined, "unified-importer").catch(() => {});

        processedSheets.push(`CHI TIẾT ĐI HÀNG (${currentSheetName}): ${counts.inbound.toLocaleString()} lô`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Chi Tiết Đi Hàng: ${counts.inbound} lô`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 7: CHECK SHIPMENT AMAZON
      // ==========================================
      else if (currentSheetName === targetCheckShipmentSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Check Shipment: "${currentSheetName}"`);
        options.onProgress?.("checkShipment", counts.checkShipment);

        // Pre-load all check shipments
        const existingCheck = await sql<{ id: string; store_id: string; shipment_id: string }[]>`
          SELECT id, store_id, LOWER(TRIM(shipment_id)) as shipment_id
          FROM accounting_amazon_check_shipments
          WHERE deleted_at IS NULL
        `;
        const checkShipmentMap = new Map<string, string>();
        for (const row of existingCheck) {
          checkShipmentMap.set(`${row.store_id}::${row.shipment_id}`, row.id);
        }

        const headers: string[] = [];
        let isHeaderRow = true;
        let checkChunk: any[] = [];
        const affectedStoreIds = new Set<string>([storeId]);

        const flushCheckChunk = async (chunk: any[]) => {
          for (const item of chunk) {
            if (item.targetId) {
              await sql`
                UPDATE accounting_amazon_check_shipments SET
                  ngay_update = COALESCE(${item.ngay_update}, accounting_amazon_check_shipments.ngay_update),
                  brand = COALESCE(${item.brand}, accounting_amazon_check_shipments.brand),
                  shipment_name = COALESCE(${item.shipment_name}, accounting_amazon_check_shipments.shipment_name),
                  shipment_id = ${item.shipment_id},
                  created_date = COALESCE(${item.created_date}, accounting_amazon_check_shipments.created_date),
                  last_updated_date = COALESCE(${item.last_updated_date}, accounting_amazon_check_shipments.last_updated_date),
                  ship_to = COALESCE(${item.ship_to}, accounting_amazon_check_shipments.ship_to),
                  skus_count = COALESCE(${item.skus_count}, accounting_amazon_check_shipments.skus_count),
                  units_expected = COALESCE(${item.units_expected}, accounting_amazon_check_shipments.units_expected),
                  units_located = COALESCE(${item.units_located}, accounting_amazon_check_shipments.units_located),
                  discrepancy = COALESCE(${item.discrepancy}, accounting_amazon_check_shipments.discrepancy),
                  status = COALESCE(${item.status}, accounting_amazon_check_shipments.status),
                  deleted_at = NULL,
                  last_changed_by = 'unified-importer',
                  updated_at = NOW()
                WHERE id = ${item.targetId}
              `;
            } else {
              const res = await sql<{ id: string }[]>`
                INSERT INTO accounting_amazon_check_shipments (
                  store_id, ngay_update, brand, shipment_name, shipment_id,
                  created_date, last_updated_date, ship_to, skus_count,
                  units_expected, units_located, discrepancy, status,
                  last_changed_by, created_at, updated_at
                ) VALUES (
                  ${item.store_id}, ${item.ngay_update}, ${item.brand}, ${item.shipment_name}, ${item.shipment_id},
                  ${item.created_date}, ${item.last_updated_date}, ${item.ship_to}, ${item.skus_count},
                  ${item.units_expected}, ${item.units_located}, ${item.discrepancy}, ${item.status},
                  'unified-importer', NOW(), NOW()
                ) RETURNING id
              `;
              const newId = res[0]?.id;
              if (newId && item.key) {
                checkShipmentMap.set(item.key, newId);
              }
            }
          }
        };

        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) {
                const raw = String(extractCellVal(v)).trim().toLowerCase().replace(/\s+/g, " ");
                headers[idx] = CHECK_SHIPMENT_HEADER_MAP[raw] || raw;
              }
            });
            // Default col 2 to brand if not mapped
            if (!headers[2] || headers[2] === "") headers[2] = "brand";
          } else {
            const getColVal = (patterns: string[]): any => {
              for (const p of patterns) {
                const idx = headers.indexOf(p.toLowerCase());
                if (idx !== -1 && vals[idx] !== undefined) {
                  return extractCellVal(vals[idx]);
                }
              }
              return null;
            };

            const rawShipmentId = getColVal(["shipment_id", "shipment id", "mã shipment"]) ?? extractCellVal(vals[4]);
            const rawShipmentName = getColVal(["shipment_name", "shipment name", "tên shipment"]) ?? extractCellVal(vals[3]);
            if (!rawShipmentId && !rawShipmentName) continue;

            const shipment_id = cleanTextVal(rawShipmentId) || `SHIP-${Date.now()}-${counts.checkShipment + 1}`;
            const shipment_name = cleanTextVal(rawShipmentName);

            const rawBrand = getColVal(["brand", "store", "thương hiệu"]) ?? extractCellVal(vals[2]);
            const brandStr = cleanTextVal(rawBrand) || "";
            let rowStoreId = storeId;
            if (brandStr && storeByName.has(brandStr.toLowerCase())) {
              rowStoreId = storeByName.get(brandStr.toLowerCase())!;
            }
            affectedStoreIds.add(rowStoreId);

            const ngay_update = cleanDateOnly(getColVal(["ngay_update", "ngày update", "update date"]) ?? extractCellVal(vals[1]));
            const created_date = cleanDateOnly(getColVal(["created_date", "created", "ngày tạo"]) ?? extractCellVal(vals[5]));
            const last_updated_date = cleanDateOnly(getColVal(["last_updated_date", "last updated", "cập nhật lần cuối"]) ?? extractCellVal(vals[6]));
            const ship_to = cleanTextVal(getColVal(["ship_to", "ship to", "kho đến"]) ?? extractCellVal(vals[7]));
            const skus_count = parseInteger(getColVal(["skus_count", "skus", "sku", "số sku"]) ?? extractCellVal(vals[8])) || 1;
            const units_expected = parseInteger(getColVal(["units_expected", "units expected", "dự kiến"]) ?? extractCellVal(vals[9])) || 0;
            const units_located = parseInteger(getColVal(["units_located", "units located", "thực nhận"]) ?? extractCellVal(vals[10])) || 0;
            const rawDiscrepancy = parseInteger(getColVal(["discrepancy", "chênh lệch"]) ?? extractCellVal(vals[12]));
            const discrepancy = rawDiscrepancy ?? (units_located - units_expected);
            const status = cleanTextVal(getColVal(["status", "trạng thái"]) ?? extractCellVal(vals[11])) || "Working";

            const key = `${rowStoreId}::${shipment_id.toLowerCase()}`;
            const targetId = checkShipmentMap.get(key);

            checkChunk.push({
              targetId,
              store_id: rowStoreId,
              ngay_update,
              brand: brandStr || (rowStoreId === storeId ? storeName : null),
              shipment_name,
              shipment_id,
              created_date,
              last_updated_date,
              ship_to,
              skus_count,
              units_expected,
              units_located,
              discrepancy,
              status,
              key
            });

            if (checkChunk.length >= chunkSize) {
              await flushCheckChunk(checkChunk);
              counts.checkShipment += checkChunk.filter(c => c.store_id === storeId).length;
              options.onProgress?.("checkShipment", counts.checkShipment);
              checkChunk = [];
            }
          }
        }

        if (checkChunk.length > 0) {
          await flushCheckChunk(checkChunk);
          counts.checkShipment += checkChunk.filter(c => c.store_id === storeId).length;
          checkChunk = [];
        }

        // Đồng bộ check shipment sang inbound cho tất cả store bị ảnh hưởng
        for (const sId of affectedStoreIds) {
          await syncCheckShipmentsToInbound(sId, undefined, "unified-importer").catch(() => {});
        }

        processedSheets.push(`CHECK SHIPMENT (${currentSheetName}): ${counts.checkShipment.toLocaleString()} lô`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Check Shipment: ${counts.checkShipment} lô`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // ==========================================
      // SHEET 8: BASECOST THÁNG
      // ==========================================
      else if (currentSheetName === targetBasecostThangSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Basecost Tháng: "${currentSheetName}"`);
        options.onProgress?.("monthlyBasecost", counts.monthlyBasecost);

        const headers: string[] = [];
        let isHeaderRow = true;
        let baseChunk: any[] = [];

        const flushBasecostChunk = async (chunk: any[]) => {
          for (const b of chunk) {
            await sql`
              INSERT INTO accounting_monthly_base_cost (
                store_id, period, sku, sku_id, brand, product_type,
                sl_ton_dau_ky, basecost_dau_ky, gtri_ton_dau_ky,
                sl_nhap, gtri_nhap, don_gia_nhap_tb,
                tong_sl_kha_dung, tong_gtri_kha_dung, basecost_thang,
                calculation_rule, is_overridden, last_changed_by, updated_at
              ) VALUES (
                ${b.store_id}, ${b.period}, ${b.sku}, ${b.sku_id}, ${b.brand}, ${b.product_type},
                ${b.sl_ton_dau_ky}, ${b.basecost_dau_ky}, ${b.gtri_ton_dau_ky},
                ${b.sl_nhap}, ${b.gtri_nhap}, ${b.don_gia_nhap_tb},
                ${b.tong_sl_kha_dung}, ${b.tong_gtri_kha_dung}, ${b.basecost_thang},
                ${b.calculation_rule}, false, 'unified-importer', NOW()
              )
              ON CONFLICT (store_id, period, sku) DO UPDATE SET
                sku_id = COALESCE(EXCLUDED.sku_id, accounting_monthly_base_cost.sku_id),
                brand = COALESCE(EXCLUDED.brand, accounting_monthly_base_cost.brand),
                product_type = COALESCE(EXCLUDED.product_type, accounting_monthly_base_cost.product_type),
                sl_ton_dau_ky = EXCLUDED.sl_ton_dau_ky,
                basecost_dau_ky = EXCLUDED.basecost_dau_ky,
                gtri_ton_dau_ky = EXCLUDED.gtri_ton_dau_ky,
                sl_nhap = EXCLUDED.sl_nhap,
                gtri_nhap = EXCLUDED.gtri_nhap,
                don_gia_nhap_tb = EXCLUDED.don_gia_nhap_tb,
                tong_sl_kha_dung = EXCLUDED.tong_sl_kha_dung,
                tong_gtri_kha_dung = EXCLUDED.tong_gtri_kha_dung,
                basecost_thang = CASE 
                  WHEN accounting_monthly_base_cost.is_overridden THEN accounting_monthly_base_cost.basecost_thang
                  ELSE EXCLUDED.basecost_thang
                END,
                calculation_rule = EXCLUDED.calculation_rule,
                last_changed_by = 'unified-importer',
                deleted_at = NULL,
                updated_at = NOW()
            `;
          }
        };

        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) {
                headers[idx] = String(extractCellVal(v)).trim().toLowerCase().replace(/\s+/g, " ");
              }
            });
          } else {
            const getColVal = (patterns: string[]): any => {
              for (const p of patterns) {
                const idx = headers.indexOf(p.toLowerCase());
                if (idx !== -1 && vals[idx] !== undefined) {
                  return extractCellVal(vals[idx]);
                }
              }
              return null;
            };

            const rawMonth = getColVal(["month", "tháng", "thang"]) ?? extractCellVal(vals[1]);
            const rawSku = getColVal(["sku", "mã sku", "ma sku"]) ?? extractCellVal(vals[5]);
            const rawBasecost = getColVal(["basecost tính/tháng", "basecost", "basecost tính / tháng", "basecost thang"]) ?? extractCellVal(vals[13]);

            if (!rawSku || rawMonth == null || rawBasecost == null) continue;
            const sku = String(rawSku).trim();
            if (!sku || sku.toLowerCase() === "sku") continue;

            const monthNum = parseInt(String(rawMonth), 10);
            if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) continue;

            const basecostNum = parseFloat(String(rawBasecost));
            if (isNaN(basecostNum)) continue;

            const period = `2026-${String(monthNum).padStart(2, "0")}`;
            const brandVal = getColVal(["brand", "thương hiệu"]) ?? extractCellVal(vals[4]);
            const brand = String(brandVal || storeName || "").trim() || null;

            // Brand filter: Nếu dòng ghi rõ brand của store khác trong hệ thống thì bỏ qua
            if (brand && storeName && brand.toLowerCase() !== storeName.toLowerCase()) {
              if (storeByName.has(brand.toLowerCase()) && storeByName.get(brand.toLowerCase()) !== storeId) {
                continue;
              }
            }

            const rawSlTon = parseNumeric(getColVal(["hàng tồn đầu tháng", "tồn đầu tháng", "sl tồn đầu kỳ"]) ?? extractCellVal(vals[7])) || 0;
            const rawBasecostDauKy = parseNumeric(getColVal(["trung bình giá đầu tháng", "giá đầu tháng", "basecost đầu kỳ"]) ?? extractCellVal(vals[8])) || 0;
            const rawSlNhap = parseNumeric(getColVal(["số hàng nhập kho/tháng", "hàng nhập", "sl nhập"]) ?? extractCellVal(vals[9])) || 0;
            const rawGtriNhap = parseNumeric(getColVal(["tổng tiền đã đi", "giá trị nhập", "gtri nhập"]) ?? extractCellVal(vals[10])) || 0;
            const rawDonGiaNhapTb = parseNumeric(getColVal(["trung bình giá", "đơn giá nhập tb"]) ?? extractCellVal(vals[11])) || 0;

            const gtriTonDauKy = rawSlTon * rawBasecostDauKy;
            const tongSlKhaDung = rawSlTon + rawSlNhap;
            const tongGtriKhaDung = gtriTonDauKy + rawGtriNhap;

            const skuMeta = skuMap.get(sku.toUpperCase());
            const sku_id = skuMeta?.id || null;
            const product_type = skuMeta?.productType || null;

            baseChunk.push({
              store_id: storeId,
              period,
              sku,
              sku_id,
              brand,
              product_type,
              sl_ton_dau_ky: rawSlTon,
              basecost_dau_ky: rawBasecostDauKy,
              gtri_ton_dau_ky: gtriTonDauKy,
              sl_nhap: rawSlNhap,
              gtri_nhap: rawGtriNhap,
              don_gia_nhap_tb: rawDonGiaNhapTb,
              tong_sl_kha_dung: tongSlKhaDung,
              tong_gtri_kha_dung: tongGtriKhaDung,
              basecost_thang: basecostNum,
              calculation_rule: "carry_over",
            });

            if (baseChunk.length >= chunkSize) {
              await flushBasecostChunk(baseChunk);
              counts.monthlyBasecost += baseChunk.length;
              options.onProgress?.("monthlyBasecost", counts.monthlyBasecost);
              baseChunk = [];
            }
          }
        }

        if (baseChunk.length > 0) {
          await flushBasecostChunk(baseChunk);
          counts.monthlyBasecost += baseChunk.length;
          baseChunk = [];
        }

        processedSheets.push(`BASECOST THÁNG (${currentSheetName}): ${counts.monthlyBasecost.toLocaleString()} dòng`);
        console.log(`[ExcelUnifiedImporter] ✅ Hoàn thành Sheet Basecost Tháng: ${counts.monthlyBasecost} dòng`);
        completedSheetsCount++;
        if (completedSheetsCount >= targetSheetsToFind.size) {
          console.log(`[ExcelUnifiedImporter] 🎯 Đã nạp đủ ${completedSheetsCount}/${targetSheetsToFind.size} sheet. Đóng stream.`);
          try { stream.destroy(); } catch {}
          break;
        }
      }

      // Sheet không thuộc các sheet trên -> xả nhanh qua iterator
      else {
        if (completedSheetsCount >= targetSheetsToFind.size && targetSheetsToFind.size > 0) {
          try { stream.destroy(); } catch {}
          break;
        }
        for await (const _ of ws) {}
      }
    }
  } finally {
    // 4. Tự động xóa file tạm sau khi nạp xong
    if (options.removeAfterDone) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[ExcelUnifiedImporter] 🗑️ Đã xóa file tạm thành công: ${filePath}`);
        }
      } catch (err: any) {
        console.warn(`[ExcelUnifiedImporter] ⚠️ Lỗi khi xóa file tạm: ${err?.message}`);
      }
    }
  }

  // 5. Tự động đồng bộ ngược SKU Master sang Ads & Returns
  try {
    await sql`
      UPDATE accounting_ads a
      SET mkt_pic = COALESCE(NULLIF(a.mkt_pic, ''), sm.pic_mkt),
          loai = COALESCE(NULLIF(a.loai, ''), sm.loai, 'FBA')
      FROM accounting_sku_master sm
      WHERE sm.store_id = a.store_id 
        AND sm.sku = a.sku 
        AND a.store_id = ${storeId};
    `;
    await sql`
      UPDATE accounting_returns r
      SET pic = COALESCE(NULLIF(r.pic, ''), sm.pic_mkt),
          loai = COALESCE(NULLIF(r.loai, ''), sm.loai, 'FBA'),
          basecost = CASE 
            WHEN COALESCE(r.basecost, 0) = 0 THEN -ABS(COALESCE(sm.basecost_tb, 0)) 
            ELSE r.basecost 
          END,
          return_sau_basecost = CASE 
            WHEN COALESCE(r.return_sau_basecost, 0) = 0 AND COALESCE(sm.basecost_tb, 0) > 0 
              THEN r.total + ABS(COALESCE(sm.basecost_tb, 0))
            ELSE r.return_sau_basecost 
          END
      FROM accounting_sku_master sm
      WHERE sm.store_id = r.store_id 
        AND sm.sku = r.sku 
        AND r.store_id = ${storeId};
    `;
    console.log(`[ExcelUnifiedImporter] 🔄 Đã đồng bộ SKU Master sang Ads & Returns cho store ${storeId}`);
  } catch (syncErr: any) {
    console.warn(`[ExcelUnifiedImporter] ⚠️ Lỗi khi đồng bộ SKU Master:`, syncErr?.message);
  }

  const durationMs = Date.now() - startTime;
  const totalProcessed =
    counts.orders +
    counts.ads +
    counts.returns +
    counts.serviceFees +
    counts.skuMaster +
    counts.inbound +
    counts.checkShipment +
    counts.monthlyBasecost;

  const msgParts: string[] = [];
  if (counts.skuMaster > 0) msgParts.push(`${counts.skuMaster.toLocaleString()} SKU Bảng Mã`);
  if (counts.inbound > 0) msgParts.push(`${counts.inbound.toLocaleString()} lô Chi tiết đi hàng`);
  if (counts.checkShipment > 0) msgParts.push(`${counts.checkShipment.toLocaleString()} Check Shipment`);
  if (counts.monthlyBasecost > 0) msgParts.push(`${counts.monthlyBasecost.toLocaleString()} dòng Basecost Tháng`);
  if (counts.orders > 0) msgParts.push(`${counts.orders.toLocaleString()} đơn hàng`);
  if (counts.ads > 0) msgParts.push(`${counts.ads.toLocaleString()} dòng Ads`);
  if (counts.returns > 0) msgParts.push(`${counts.returns.toLocaleString()} hoàn tiền Return`);
  if (counts.serviceFees > 0) msgParts.push(`${counts.serviceFees.toLocaleString()} phí Service Fees`);

  const message =
    msgParts.length > 0
      ? `Đã nạp thành công toàn bộ dữ liệu từ file Excel (${(durationMs / 1000).toFixed(1)}s): ${msgParts.join(", ")}!`
      : "Không tìm thấy dòng dữ liệu hợp lệ trong các sheet mục tiêu.";

  return {
    success: true,
    message,
    processedSheets,
    counts,
    totalProcessed,
    durationMs,
  };
}
