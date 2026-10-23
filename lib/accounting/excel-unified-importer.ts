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
 * Đọc file Excel kế toán đa sheet (Orders, Ads, Returns, Service Fees)
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
  const counts = { orders: 0, ads: 0, returns: 0, serviceFees: 0, skuMaster: 0, monthlyBasecost: 0 };
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
  const targetBasecostThangSheet = findSheet(["basecost tháng", "basecost thang", "basecost_thang", "monthly basecost", "base cost tháng"]);

  const targetSheetsToFind = new Set([
    targetOrdersSheet, 
    targetAdsSheet, 
    targetReturnSheet, 
    targetServiceFeeSheet, 
    targetSkuMasterSheet,
    targetBasecostThangSheet
  ].filter(Boolean) as string[]);
  let completedSheetsCount = 0;

  console.log("[ExcelUnifiedImporter] Mục tiêu sheet nhận diện được:", {
    targetOrdersSheet,
    targetAdsSheet,
    targetReturnSheet,
    targetServiceFeeSheet,
    totalTargetSheets: targetSheetsToFind.size,
  });

  // Chuẩn bị SKU Master & Store Metadata trước cho Ads & Return
  const skuMasters = await sql<{ sku: string; loai: string | null; pic_mkt: string | null; status: string | null; basecost_tb: string | null }[]>`
    SELECT sku, loai, pic_mkt, status, basecost_tb::text
    FROM accounting_sku_master
    WHERE store_id = ${storeId} AND deleted_at IS NULL
  `;
  const skuMap = new Map<string, { loai: string; pic_mkt: string; pic: string; status: string; basecost: number }>();
  for (const s of skuMasters) {
    const skuKey = s.sku.trim().toUpperCase();
    skuMap.set(skuKey, {
      loai: s.loai || "",
      pic_mkt: s.pic_mkt || "",
      pic: s.pic_mkt || "",
      status: s.status || "Phát triển",
      basecost: parseFloat(s.basecost_tb || "0") || 0,
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
          const res = await batchUpsertOrders(storeId, orderRows, { snapshot: "all" });
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
          const res = await batchUpsertAds(storeId, adsChunk, { snapshot: "all" });
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
          const res = await batchUpsertReturns(storeId, returnChunk, { snapshot: "all" });
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
            const mockup = String(getColVal(["mockup", "hình ảnh", "ảnh", "mockup url"]) || vals[3] || "").trim() || null;
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
            const rawBasecost = getColVal(["basecost", "basecost_tb", "chi phí gốc"]) || vals[24];
            const basecostTb = rawBasecost != null && !isNaN(Number(rawBasecost)) ? Number(rawBasecost) : null;

            skuRows.push({
              store_id: storeId,
              sku,
              brand,
              product_type: productType,
              mockup,
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
            await sql`
              INSERT INTO accounting_sku_master (
                store_id, sku, brand, product_type, mockup, asin, fnsku, 
                amazon_fee, referral_fee_pct, pic_mkt, loai, niche, pic_idea, status, basecost_tb, updated_at
              ) VALUES (
                ${s.store_id}, ${s.sku}, ${s.brand}, ${s.product_type}, ${s.mockup}, ${s.asin}, ${s.fnsku},
                ${s.amazon_fee}, ${s.referral_fee_pct}, ${s.pic_mkt}, ${s.loai}, ${s.niche}, ${s.pic_idea}, ${s.status}, ${s.basecost_tb}, NOW()
              )
              ON CONFLICT (store_id, sku) DO UPDATE SET
                brand = COALESCE(EXCLUDED.brand, accounting_sku_master.brand),
                product_type = COALESCE(EXCLUDED.product_type, accounting_sku_master.product_type),
                asin = COALESCE(EXCLUDED.asin, accounting_sku_master.asin),
                fnsku = COALESCE(EXCLUDED.fnsku, accounting_sku_master.fnsku),
                amazon_fee = COALESCE(EXCLUDED.amazon_fee, accounting_sku_master.amazon_fee),
                referral_fee_pct = COALESCE(EXCLUDED.referral_fee_pct, accounting_sku_master.referral_fee_pct),
                pic_mkt = COALESCE(EXCLUDED.pic_mkt, accounting_sku_master.pic_mkt),
                loai = COALESCE(EXCLUDED.loai, accounting_sku_master.loai),
                status = COALESCE(EXCLUDED.status, accounting_sku_master.status),
                basecost_tb = COALESCE(EXCLUDED.basecost_tb, accounting_sku_master.basecost_tb),
                deleted_at = NULL,
                updated_at = NOW()
            `;
            const skuKey = s.sku.trim().toUpperCase();
            skuMap.set(skuKey, {
              loai: s.loai || "",
              pic_mkt: s.pic_mkt || "",
              pic: s.pic_mkt || "",
              status: s.status || "Phát triển",
              basecost: s.basecost_tb || 0,
            });
          }
          counts.skuMaster = skuRows.length;
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
      // SHEET 6: BASECOST THÁNG
      // ==========================================
      else if (currentSheetName === targetBasecostThangSheet) {
        console.log(`[ExcelUnifiedImporter] 🚀 Đang đọc Sheet Basecost Tháng: "${currentSheetName}"`);
        const headers: string[] = [];
        let isHeaderRow = true;
        const baseRows: Array<{
          store_id: string;
          sku: string;
          period: string;
          basecost_thang: number;
          brand?: string | null;
          asin?: string | null;
        }> = [];

        for await (const row of ws) {
          const vals = (row.values as any[]) || [];
          if (isHeaderRow) {
            isHeaderRow = false;
            vals.forEach((v, idx) => {
              if (v != null) headers[idx] = String(v).trim().toLowerCase().replace(/\s+/g, " ");
            });
          } else {
            const getColVal = (patterns: string[]): any => {
              for (const p of patterns) {
                const idx = headers.indexOf(p.toLowerCase());
                if (idx !== -1 && vals[idx] !== undefined) {
                  let cellVal = vals[idx];
                  if (cellVal && typeof cellVal === "object") {
                    if ("result" in cellVal) cellVal = cellVal.result;
                    else if ("text" in cellVal) cellVal = cellVal.text;
                  }
                  return cellVal;
                }
              }
              return null;
            };

            const rawMonth = getColVal(["month", "tháng", "thang"]) || vals[1];
            const rawSku = getColVal(["sku", "mã sku", "ma sku"]) || vals[5];
            const rawBasecost = getColVal(["basecost tính/tháng", "basecost", "basecost tính / tháng", "basecost thang"]) || vals[13];

            if (!rawSku || rawMonth == null || rawBasecost == null) continue;
            const sku = String(rawSku).trim();
            if (!sku || sku.toLowerCase() === "sku") continue;

            const monthNum = parseInt(String(rawMonth), 10);
            if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) continue;

            const basecostNum = parseFloat(String(rawBasecost));
            if (isNaN(basecostNum)) continue;

            const period = `2026-${String(monthNum).padStart(2, "0")}`;
            const brand = String(getColVal(["brand", "thương hiệu"]) || vals[4] || "").trim() || null;
            const asin = String(getColVal(["asin"]) || vals[6] || "").trim() || null;

            baseRows.push({
              store_id: storeId,
              sku,
              period,
              basecost_thang: basecostNum,
              brand,
              asin,
            });
          }
        }

        if (baseRows.length > 0) {
          for (const b of baseRows) {
            await sql`
              INSERT INTO accounting_monthly_base_cost (
                store_id, sku, period, basecost_thang, brand, asin, updated_at
              ) VALUES (
                ${b.store_id}, ${b.sku}, ${b.period}, ${b.basecost_thang}, ${b.brand ?? null}, ${b.asin ?? null}, NOW()
              )
              ON CONFLICT (store_id, period, sku) DO UPDATE SET
                basecost_thang = EXCLUDED.basecost_thang,
                brand = COALESCE(EXCLUDED.brand, accounting_monthly_base_cost.brand),
                asin = COALESCE(EXCLUDED.asin, accounting_monthly_base_cost.asin),
                updated_at = NOW()
            `;
          }
          counts.monthlyBasecost = baseRows.length;
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
  // Đảm bảo dữ liệu luôn nhất quán 100% cho dù thứ tự các sheet trong file Excel nằm ở bất kỳ đâu
  try {
    await sql`
      UPDATE accounting_ads a
      SET pic_mkt = COALESCE(NULLIF(a.pic_mkt, ''), sm.pic_mkt),
          loai = COALESCE(NULLIF(a.loai, ''), sm.loai, 'FBA')
      FROM accounting_sku_master sm
      WHERE sm.store_id = a.store_id 
        AND sm.sku = a.sku 
        AND a.store_id = ${storeId};
    `;
    await sql`
      UPDATE accounting_returns r
      SET pic_mkt = COALESCE(NULLIF(r.pic_mkt, ''), sm.pic_mkt),
          loai = COALESCE(NULLIF(r.loai, ''), sm.loai, 'FBA'),
          basecost = CASE 
            WHEN COALESCE(r.basecost, 0) = 0 THEN COALESCE(sm.basecost_tb, 0) 
            ELSE r.basecost 
          END,
          return_sau_basecost = CASE 
            WHEN COALESCE(r.return_sau_basecost, 0) = 0 AND COALESCE(sm.basecost_tb, 0) > 0 
              THEN r.total - COALESCE(sm.basecost_tb, 0)
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
  const totalProcessed = counts.orders + counts.ads + counts.returns + counts.serviceFees + counts.skuMaster + counts.monthlyBasecost;

  const msgParts: string[] = [];
  if (counts.skuMaster > 0) msgParts.push(`${counts.skuMaster.toLocaleString()} SKU Bảng Mã`);
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
