import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import ExcelJS from "exceljs";
import { sendTelegramMessage } from "./telegram";
import { ensureAmazonSession } from "./amazon_auth";
import { syncDiscrepanciesToGoogleSheet } from "./google_sheets_sync";

// ============================================================================
// CONFIGURATION & PATH RESOLUTION
// ============================================================================
export function loadEnv() {
  const envPath = path.join(__dirname, "config.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val.replace("$HOME", os.homedir());
        }
      }
    }
  }
}

loadEnv();

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || "http://127.0.0.1:50325";
const BASE_DOWNLOAD_DIR = path.join(os.homedir(), "AmazonAccounting", "downloads", "shipment_discrepancy");
const STATE_CACHE_FILE = path.join(BASE_DOWNLOAD_DIR, "reconciled_state_cache.json");

export interface DiscrepancyRow {
  store: string;
  sku: string;
  asin: string;
  shipment_id: string;
  amazon_received: number; // Units expected (số lượng đáng lẽ phải nhận - bên trên)
  so_luong_amazon_nhan: number; // Units located (số lượng thực - bên dưới)
  discrepancy: number; // chênh lệch (+ hoặc -)
  receiving_date: string; // mốc thời gian receiving/received
  status: string; // Action required, Units located, etc.
}

interface StoreConfig {
  store_name: string;
  profile_id: string;
  enabled?: boolean;
}

interface DbShipmentClassification {
  store: string;
  total_single_sku_items: number;
  total_multi_sku_shipments: number;
  single_sku_items: DiscrepancyRow[];
  /** Lô > 1 SKU đã đủ số nhận theo từng SKU trong bảng Chi tiết đi hàng → tính luôn, không mở Seller Central */
  db_resolved_items?: DiscrepancyRow[];
  multi_sku_shipments: string[];
  /** Trạng thái lô (Closed / Receiving / …) để biết lô nào còn thay đổi */
  shipment_status?: Record<string, string>;
}

/** Lô đã chốt: Closed và không còn dòng "Action required" → giữ cache, không mở lại Seller Central.
 *  Cache đọc bằng bản cũ (Located − Expected ≠ Discrepancy, do đọc nhầm cột) → coi như chưa chốt để đọc lại. */
function isSettled(status: string | undefined, items: DiscrepancyRow[]): boolean {
  if ((status || "").trim().toLowerCase() !== "closed") return false;
  if (items.some((it) => Number(it.so_luong_amazon_nhan) - Number(it.amazon_received) !== Number(it.discrepancy))) return false;
  return !items.some((it) => /action required/i.test(it.status || ""));
}

/** Đổi cách đọc bảng contents thì tăng số này → cache đọc bằng cách cũ bị bỏ, đọc lại Seller Central.
 *  2 (26/11/2026): Units located lấy ở kat-link trong ô "Units expected / Units located", bỏ ô của popover lồng bên trong. */
const PARSER_VERSION = 2;

interface CachedShipmentRecord {
  parser?: number;
  shipment_id: string;
  store: string;
  items: DiscrepancyRow[];
  receivingDate: string;
  last_checked_at: string;
}

// ============================================================================
// STATE CACHE & DATABASE PERSISTENCE (LƯU VĨNH VIỄN VÀO POSTGRESQL CHỐNG MẤT)
// ============================================================================
function loadStateCache(): Record<string, Record<string, CachedShipmentRecord>> {
  try {
    if (fs.existsSync(STATE_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_CACHE_FILE, "utf8"));
    }
  } catch (err: any) {
    console.warn(`[Cache] Không thể đọc file cache local: ${err.message}`);
  }

  // Nếu file cache local bị mất, tự động khôi phục từ PostgreSQL Server trong 0.1s!
  console.log(`[Cache] Đang khôi phục dữ liệu cache từ PostgreSQL Database trên server...`);
  try {
    const scriptPath = path.join(__dirname, "get_discrepancy_shipments.py");
    const output = execSync(`python3 "${scriptPath}" "--load-all-cached"`, {
      encoding: "utf8",
      timeout: 60000,
    });
    const restored = JSON.parse(output.trim());
    if (restored && typeof restored === "object" && !restored.error) {
      console.log(`✅ Đã khôi phục cache thành công từ Database Server!`);
      saveStateCache(restored);
      return restored;
    }
  } catch (err: any) {
    console.warn(`[Cache] Không thể khôi phục từ DB: ${err.message}`);
  }

  return {};
}

function saveStateCache(cache: Record<string, Record<string, CachedShipmentRecord>>) {
  try {
    fs.mkdirSync(BASE_DOWNLOAD_DIR, { recursive: true });
    fs.writeFileSync(STATE_CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err: any) {
    console.warn(`[Cache] Không thể lưu file cache local: ${err.message}`);
  }
}

function persistDiscrepanciesToDb(items: DiscrepancyRow[], replace?: { store: string; shipments: string[] }) {
  if ((!items || items.length === 0) && !replace?.shipments.length) return;
  try {
    const scriptPath = path.join(__dirname, "save_discrepancy_items.py");
    const jsonStr = JSON.stringify({ items, replace });
    execSync(`python3 "${scriptPath}"`, {
      input: jsonStr,
      encoding: "utf8",
      timeout: 30000,
    });
    console.log(`💾 Đã đồng bộ lưu vĩnh viễn ${items.length} bản ghi vào PostgreSQL Database.`);
  } catch (err: any) {
    console.warn(`[DB Sync] Cảnh báo khi lưu DB: ${err.message}`);
  }
}

// ============================================================================
// ADSPOWER CONTROLS
// ============================================================================
async function ensureBrowser(profileId: string): Promise<string> {
  try {
    const activeRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/active?user_id=${profileId}`);
    const activeData = (await activeRes.json()) as any;
    if (activeData.code === 0 && activeData.data?.status === "Active") {
      const listRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/local-active`);
      const listData = (await listRes.json()) as any;
      const match = listData.data?.list?.find((item: any) => item.user_id === profileId);
      if (match?.debug_port) {
        console.log(`[AdsPower] Profile ${profileId} đang mở sẵn ở port ${match.debug_port}`);
        return `http://127.0.0.1:${match.debug_port}`;
      }
    }
  } catch {}

  console.log(`[AdsPower] Đang khởi động profile ${profileId}...`);
  const startRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
  const startData = (await startRes.json()) as any;
  if (startData.code === 0 && startData.data?.debug_port) {
    await new Promise((r) => setTimeout(r, 2000));
    return `http://127.0.0.1:${startData.data.debug_port}`;
  }
  throw new Error(`Không thể khởi động AdsPower profile ${profileId}: ${JSON.stringify(startData)}`);
}

async function stopBrowser(profileId: string): Promise<void> {
  console.log(`[AdsPower] Đang đóng profile ${profileId}...`);
  await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`).catch(() => {});
}

// ============================================================================
// DATABASE SHIPMENTS RESOLVER
// ============================================================================
export function classifyShipmentsFromDb(storeName: string): DbShipmentClassification {
  try {
    const scriptPath = path.join(__dirname, "get_discrepancy_shipments.py");
    const output = execSync(`python3 "${scriptPath}" "${storeName}"`, {
      encoding: "utf8",
      timeout: 60000,
    });
    const parsed = JSON.parse(output.trim());
    if (parsed.error) {
      console.error(`[DB Error ${storeName}] ${parsed.error}`);
      return {
        store: storeName,
        total_single_sku_items: 0,
        total_multi_sku_shipments: 0,
        single_sku_items: [],
        multi_sku_shipments: [],
      };
    }
    return parsed;
  } catch (err: any) {
    console.error(`[DB Error ${storeName}] Không thể truy vấn: ${err.message}`);
    return {
      store: storeName,
      total_single_sku_items: 0,
      total_multi_sku_shipments: 0,
      single_sku_items: [],
      multi_sku_shipments: [],
    };
  }
}

// ============================================================================
// PARSING HELPERS
// ============================================================================
function parseReceivingDate(eventsText: string): string {
  const lines = eventsText.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower === "received" || lower === "receiving") {
      const prev1 = lines[i - 1] || "";
      const prev2 = lines[i - 2] || "";
      if (/\d+:\d+/.test(prev1)) {
        return `${prev2} ${prev1}`.trim();
      }
      return prev1;
    }
  }
  const m = eventsText.match(
    /([A-Za-z]+ \d{1,2}, \d{4},? \d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*GMT[+-]\d+)?)\s*(?:Receiving|Received)/i
  );
  if (m) return m[1].trim();
  return "";
}

// ============================================================================
// SHIPMENT SCRAPER (CHO LÔ > 1 SKU)
// ============================================================================
async function extractShipmentDiscrepancy(
  page: Page,
  storeName: string,
  shipmentId: string
): Promise<{ items: DiscrepancyRow[]; receivingDate: string; ok: boolean }> {
  const results: DiscrepancyRow[] = [];

  await page.evaluate(() => window.scrollBy(0, 150)).catch(() => {});

  // 1. Trích xuất mốc thời gian Receiving từ shipmentEvents
  const eventsUrl = `https://sellercentral.amazon.com/fba/inbound-shipment/summary/${shipmentId}/shipmentEvents`;
  let receivingDate = "";
  try {
    await page.goto(eventsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    const eventFrame = page
      .frames()
      .find((f) => f.name() === "iframe-shipment-event" || f.url().includes("/fba/shipmentevents/"));
    if (eventFrame) {
      await eventFrame
        .waitForSelector("text=Received, text=Receiving, text=Shipment created", { timeout: 8000 })
        .catch(() => {});
      const eventText = await eventFrame.evaluate(() => document.body?.innerText || "");
      receivingDate = parseReceivingDate(eventText);
    }
  } catch (err: any) {
    console.warn(`  [${shipmentId}] Cảnh báo khi đọc shipmentEvents: ${err.message}`);
  }

  // 2. Trích xuất danh sách SKU/ASIN và số lượng lệch từ contents
  const contentsUrl = `https://sellercentral.amazon.com/fba/inbound-shipment/summary/${shipmentId}/contents`;
  let ok = false;
  try {
    await page.goto(contentsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const contentFrame = page
      .frames()
      .find((f) => f.name() === "iframe-shipment-content" || f.url().includes("/fba/wmsr/"));

    if (!contentFrame) {
      console.warn(`  [${shipmentId}] Không tìm thấy iframe-shipment-content`);
      return { items: results, receivingDate, ok: false };
    }

    await contentFrame
      .waitForSelector("kat-table-body kat-table-row, text=No discrepancies have been found", { timeout: 10000 })
      .catch(() => {});
    // Đọc được trang = có bảng hoặc Amazon ghi rõ không có lệch (khác với trang lỗi / chưa tải được)
    ok = await contentFrame
      .evaluate(
        "!!document.querySelector('kat-table-body kat-table-row') || /No discrepancies have been found/i.test(document.body ? document.body.innerText : '')",
      )
      .then(Boolean)
      .catch(() => false);

    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      const pageItems = await contentFrame.evaluate(() => {
        // Bảng "Show discrepancies only" (Amazon bật sẵn): chỉ liệt kê SKU bị lệch — SKU không có trong bảng là nhận đủ.
        // Mỗi ô "Units expected / Units located" có bảng popover lồng bên trong (kat-table-row / kat-table-cell
        // "Quantity / Reason") → chỉ lấy dòng / ô trực tiếp của bảng chính, bỏ phần nằm trong kat-popover.
        const rows = Array.from(document.querySelectorAll("kat-table-body kat-table-row")).filter((r) => !r.closest("kat-popover"));
        const extracted: any[] = [];
        const headTexts = Array.from(document.querySelectorAll("kat-table-head kat-table-cell"))
          .filter((c) => !c.closest("kat-popover"))
          .map((c) => ((c as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().toLowerCase());
        const qtyCol = headTexts.findIndex((t) => /expected/.test(t));
        const discCol = headTexts.findIndex((t) => /discrepanc/.test(t));

        for (const r of rows) {
          const fullText = (r as HTMLElement).innerText || "";
          if (!fullText.includes("ASIN:")) continue;

          const cells = Array.from(r.children).filter((c) => c.tagName.toLowerCase() === "kat-table-cell");
          if (cells.length < 4) continue;

          // SKU (cell 0)
          const msku = (cells[0] as HTMLElement)?.innerText?.trim() || "";

          // ASIN
          const asinCell = cells.find((c) => (c as HTMLElement).innerText?.includes("ASIN:"));
          const asinText = (asinCell as HTMLElement)?.innerText || fullText;
          const asinMatch = asinText.match(/ASIN:\s*([A-Z0-9]{10})/i);
          const asin = asinMatch ? asinMatch[1] : "";

          // Ô số lượng: <div>Units expected</div> + <kat-link label="Units located"> (mở popover chi tiết)
          const qCell = cells[qtyCol >= 0 ? qtyCol : 3];
          const expText = ((qCell?.querySelector(":scope > div") as HTMLElement | null)?.textContent || "").trim();
          const unitsExpected = /^\d+$/.test(expText) ? parseInt(expText, 10) : 0;
          const locLabel = (qCell?.querySelector("kat-link[label]")?.getAttribute("label") || "").trim();
          const locatedFromHeader = /^\d+$/.test(locLabel);
          let unitsLocated = locatedFromHeader ? parseInt(locLabel, 10) : unitsExpected;

          // Ô Discrepancy của Amazon ("-3" / "+1")
          const discCell = cells[discCol >= 0 ? discCol : 4];
          const discText = ((discCell as HTMLElement)?.innerText || "").replace(/\s+/g, "").trim();
          const amazonDisc = /^[+-]?\d+$/.test(discText) ? parseInt(discText, 10) : null;

          let discrepancy = unitsLocated - unitsExpected;
          let mismatch = false;
          if (locatedFromHeader) {
            mismatch = amazonDisc != null && amazonDisc !== discrepancy;
          } else if (amazonDisc != null) {
            discrepancy = amazonDisc;
            unitsLocated = unitsExpected + amazonDisc;
          }

          // Xử lý status chuẩn xác (không bao giờ ra 'null')
          const dropdown = r.querySelector("kat-dropdown");
          let status = "";
          if (dropdown) {
            const optionsAttr = dropdown.getAttribute("options");
            const val = dropdown.getAttribute("value");
            if (optionsAttr) {
              try {
                const opts = JSON.parse(optionsAttr);
                const matched = opts.find((o: any) => String(o.value) === String(val));
                if (matched && matched.name) {
                  status = matched.name;
                }
              } catch {}
            }
            if (!status) {
              status = (dropdown as HTMLElement).innerText?.trim() || "";
            }
          }

          if (!status || status.toLowerCase() === "null") {
            const lastCellText = (cells[cells.length - 1] as HTMLElement)?.innerText?.trim() || "";
            if (lastCellText && lastCellText.toLowerCase() !== "null") {
              status = lastCellText;
            } else {
              status = discrepancy !== 0 ? "Action required" : "Units located. No action required.";
            }
          }

          extracted.push({
            sku: msku,
            asin,
            unitsExpected,
            unitsLocated,
            discrepancy,
            status,
            mismatch,
            amazonDisc,
            source: locatedFromHeader ? "header" : amazonDisc != null ? "disc-cell" : "position",
          });
        }
        return { items: extracted, headTexts };
      }).then((res: any) => {
        if (pageNum === 1) console.log(`  [${shipmentId}] Tiêu đề bảng contents: ${JSON.stringify(res.headTexts)}`);
        return res.items as any[];
      });

      for (const item of pageItems) {
        if (item.mismatch) {
          console.warn(`  ⚠️ [${shipmentId}] ${item.sku}: Located ${item.unitsLocated} − Expected ${item.unitsExpected} = ${item.discrepancy} nhưng ô Discrepancy của Amazon ghi ${item.amazonDisc}`);
        } else if (item.source !== "header") {
          console.warn(`  ⚠️ [${shipmentId}] ${item.sku}: không dò được cột Located theo tiêu đề (dùng ${item.source})`);
        }
        results.push({
          store: storeName,
          sku: item.sku,
          asin: item.asin,
          shipment_id: shipmentId,
          amazon_received: item.unitsExpected,
          so_luong_amazon_nhan: item.unitsLocated,
          discrepancy: item.discrepancy,
          receiving_date: receivingDate,
          status: item.status,
        });
      }

      const nextBtn = await contentFrame.$("kat-pagination [data-testid='next-page'], kat-pagination button[aria-label*='Next']");
      if (nextBtn && (await nextBtn.isEnabled().catch(() => false))) {
        pageNum++;
        await nextBtn.click();
        await page.waitForTimeout(3000);
      } else {
        hasNextPage = false;
      }
    }
  } catch (err: any) {
    console.error(`  [${shipmentId}] Lỗi trích xuất contents: ${err.message}`);
    ok = false;
  }

  return { items: results, receivingDate, ok };
}

// ============================================================================
// EXPORT EXCEL & CSV (CÁCH 2: 1 FILE DUY NHẤT GỒM NHIỀU TAB CHO TỪNG STORE)
// ============================================================================
function addWorksheetWithData(
  workbook: ExcelJS.Workbook,
  tabTitle: string,
  rows: DiscrepancyRow[],
  includeStoreCol = true
) {
  const worksheet = workbook.addWorksheet(tabTitle, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns: any[] = [];
  if (includeStoreCol) {
    columns.push({ header: "Store", key: "store", width: 14 });
  }
  columns.push(
    { header: "SKU", key: "sku", width: 22 },
    { header: "ASIN", key: "asin", width: 15 },
    { header: "Shipment ID", key: "shipment_id", width: 18 },
    { header: "Amazon Received", key: "amazon_received", width: 18 },
    { header: "Số Lượng Amazon Nhận", key: "so_luong_amazon_nhan", width: 22 },
    { header: "Discrepancy", key: "discrepancy", width: 14 },
    { header: "Receiving Date", key: "receiving_date", width: 26 },
    { header: "Status", key: "status", width: 25 }
  );

  worksheet.columns = columns;

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1E3A8A" }, // Xanh navy hiện đại
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 28;

  for (const r of rows) {
    const rowData: any = {
      sku: r.sku,
      asin: r.asin,
      shipment_id: r.shipment_id,
      amazon_received: r.amazon_received,
      so_luong_amazon_nhan: r.so_luong_amazon_nhan,
      discrepancy: r.discrepancy,
      receiving_date: r.receiving_date,
      status: r.status,
    };
    if (includeStoreCol) {
      rowData.store = r.store;
    }

    const row = worksheet.addRow(rowData);

    if (includeStoreCol) {
      row.getCell("store").alignment = { horizontal: "center" };
    }
    row.getCell("asin").alignment = { horizontal: "center" };
    row.getCell("shipment_id").alignment = { horizontal: "center" };
    row.getCell("amazon_received").alignment = { horizontal: "right" };
    row.getCell("so_luong_amazon_nhan").alignment = { horizontal: "right" };
    row.getCell("discrepancy").alignment = { horizontal: "right" };
    row.getCell("receiving_date").alignment = { horizontal: "center" };

    const discCell = row.getCell("discrepancy");
    if (r.discrepancy < 0) {
      discCell.font = { color: { argb: "DC2626" }, bold: true };
    } else if (r.discrepancy > 0) {
      discCell.font = { color: { argb: "16A34A" }, bold: true };
    }
  }
}

export function cleanOldTemporaryFiles() {
  try {
    if (!fs.existsSync(BASE_DOWNLOAD_DIR)) return;
    const files = fs.readdirSync(BASE_DOWNLOAD_DIR);
    for (const f of files) {
      // Xóa tất cả các file excel, csv trên local vì đã chuyển sang cập nhật trực tiếp trên Google Sheets
      if (f.endsWith(".xlsx") || f.endsWith(".csv")) {
        fs.unlinkSync(path.join(BASE_DOWNLOAD_DIR, f));
        console.log(`🧹 Đã dọn file local thừa: ${f}`);
      }
    }
  } catch (err: any) {
    console.warn(`Lỗi dọn file: ${err.message}`);
  }
}

export async function exportConsolidatedWorkbook(
  allRows: DiscrepancyRow[],
  storeList: string[]
): Promise<{ excelPath: string; csvPath: string }> {
  cleanOldTemporaryFiles();
  fs.mkdirSync(BASE_DOWNLOAD_DIR, { recursive: true });

  const excelPath = path.join(BASE_DOWNLOAD_DIR, "shipment_discrepancy_ALL_STORES.xlsx");
  const csvPath = path.join(BASE_DOWNLOAD_DIR, "shipment_discrepancy_ALL_STORES.csv");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Listing Management";
  workbook.created = new Date();

  // Tab 1: Tổng hợp tất cả store
  addWorksheetWithData(workbook, "Tất Cả", allRows, true);

  // Tab 2..N: Mỗi store 1 tab riêng
  for (const sName of storeList) {
    const storeRows = allRows.filter((r) => r.store.toUpperCase() === sName.toUpperCase());
    if (storeRows.length > 0) {
      addWorksheetWithData(workbook, sName, storeRows, false);
    }
  }

  await workbook.xlsx.writeFile(excelPath);

  // Xuất file CSV gộp
  const csvHeaders = [
    "store",
    "sku",
    "asin",
    "shipment_id",
    "amazon_received",
    "so_luong_amazon_nhan",
    "discrepancy",
    "receiving_date",
    "status",
  ];
  const csvRows = [csvHeaders.join(",")];
  for (const r of allRows) {
    const escapeCsv = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    csvRows.push(
      [
        escapeCsv(r.store),
        escapeCsv(r.sku),
        escapeCsv(r.asin),
        escapeCsv(r.shipment_id),
        r.amazon_received,
        r.so_luong_amazon_nhan,
        r.discrepancy,
        escapeCsv(r.receiving_date),
        escapeCsv(r.status),
      ].join(",")
    );
  }
  fs.writeFileSync(csvPath, csvRows.join("\n"), "utf8");

  console.log(`\n✅ Đã cập nhật file Master (Cách 2 - Nhiều Tabs):`);
  console.log(`  - Excel: ${excelPath}`);
  console.log(`  - CSV:   ${csvPath}`);

  return { excelPath, csvPath };
}

export async function exportSingleStoreWorkbook(
  storeName: string,
  rows: DiscrepancyRow[]
): Promise<{ excelPath: string; csvPath: string }> {
  fs.mkdirSync(BASE_DOWNLOAD_DIR, { recursive: true });

  const excelPath = path.join(BASE_DOWNLOAD_DIR, `shipment_discrepancy_${storeName}.xlsx`);
  const csvPath = path.join(BASE_DOWNLOAD_DIR, `shipment_discrepancy_${storeName}.csv`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amazon Listing Management";
  workbook.created = new Date();

  addWorksheetWithData(workbook, storeName, rows, false);
  await workbook.xlsx.writeFile(excelPath);

  const csvHeaders = [
    "store",
    "sku",
    "asin",
    "shipment_id",
    "amazon_received",
    "so_luong_amazon_nhan",
    "discrepancy",
    "receiving_date",
    "status",
  ];
  const csvRows = [csvHeaders.join(",")];
  for (const r of rows) {
    const escapeCsv = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    csvRows.push(
      [
        escapeCsv(r.store),
        escapeCsv(r.sku),
        escapeCsv(r.asin),
        escapeCsv(r.shipment_id),
        r.amazon_received,
        r.so_luong_amazon_nhan,
        r.discrepancy,
        escapeCsv(r.receiving_date),
        escapeCsv(r.status),
      ].join(",")
    );
  }
  fs.writeFileSync(csvPath, csvRows.join("\n"), "utf8");

  return { excelPath, csvPath };
}

// ============================================================================
// SINGLE STORE WORKER
// ============================================================================
async function processStore(
  storeConfig: StoreConfig,
  stateCache: Record<string, Record<string, CachedShipmentRecord>>,
  options?: { limit?: number; specificShipmentIds?: string[] }
): Promise<DiscrepancyRow[]> {
  const storeName = storeConfig.store_name.toUpperCase();
  console.log(`\n---------------------------------------------------------------`);
  console.log(`🏪 XỬ LÝ STORE: ${storeName} (Profile: ${storeConfig.profile_id})`);
  console.log(`---------------------------------------------------------------`);

  if (!stateCache[storeName]) {
    stateCache[storeName] = {};
  }

  const classification = classifyShipmentsFromDb(storeName);
  const singleSkuItems = classification.single_sku_items;
  const dbResolvedItems = classification.db_resolved_items || [];
  const shipmentStatus = classification.shipment_status || {};
  let candidateMultiShipments = options?.specificShipmentIds || classification.multi_sku_shipments;

  if (options?.limit && options.limit > 0) {
    candidateMultiShipments = candidateMultiShipments.slice(0, options.limit);
  }

  console.log(`  - Lô 1 SKU (tự động giải quyết): ${singleSkuItems.length} mặt hàng.`);
  console.log(`  - Lô > 1 SKU tính từ bảng (đủ số nhận theo SKU): ${dbResolvedItems.length} mặt hàng.`);
  console.log(`  - Lô > 1 SKU tổng cộng: ${candidateMultiShipments.length} lô.`);

  const needBrowserCheck: string[] = [];
  const cachedRows: DiscrepancyRow[] = [];

  for (const sId of candidateMultiShipments) {
    const cached = stateCache[storeName][sId];
    // Lô chưa chốt (Receiving…) hoặc còn "Action required" thì số lệch còn đổi → mở lại Seller Central
    const forceRecheck = !!options?.specificShipmentIds?.includes(sId);
    if (
      cached && cached.parser === PARSER_VERSION && cached.items && cached.items.length > 0 && !forceRecheck &&
      isSettled(shipmentStatus[sId], cached.items)
    ) {
      cachedRows.push(...cached.items);
    } else {
      needBrowserCheck.push(sId);
    }
  }

  console.log(`  - Lô > 1 SKU đã cache sẵn (không cần mở web): ${candidateMultiShipments.length - needBrowserCheck.length} lô.`);
  console.log(`  - Lô > 1 SKU CẦN MỞ SELLER CENTRAL: ${needBrowserCheck.length} lô (${needBrowserCheck.join(", ") || "không có"}).`);

  const browserCheckedRows: DiscrepancyRow[] = [];
  /** Lô đọc được trang contents → thay toàn bộ số cũ của lô (SKU không còn trong bảng lệch = nhận đủ, xoá dòng cũ) */
  const verifiedShipments: string[] = [];

  if (needBrowserCheck.length > 0) {
    console.log(`\n  🌐 Đang mở profile AdsPower ${storeConfig.profile_id}...`);
    const cdpUrl = await ensureBrowser(storeConfig.profile_id);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());

    await context.addCookies([
      { name: "lc-main", value: "en_US", domain: ".amazon.com", path: "/" },
      { name: "lc-acbus", value: "en_US", domain: ".amazon.com", path: "/" },
      { name: "locale", value: "en_US", domain: ".amazon.com", path: "/" },
      { name: "seller_locale", value: "en_US", domain: ".amazon.com", path: "/" },
    ]);

    const page = context.pages()[0] || (await context.newPage());
    await ensureAmazonSession(page, storeName);

    try {
      for (let i = 0; i < needBrowserCheck.length; i++) {
        const sId = needBrowserCheck[i];
        console.log(`  [${i + 1}/${needBrowserCheck.length}] Đang kiểm tra Seller Central shipment: ${sId}...`);
        const { items, receivingDate, ok } = await extractShipmentDiscrepancy(page, storeName, sId);
        if (ok) verifiedShipments.push(sId);
        else console.warn(`    ⚠️ Không đọc được trang contents của ${sId} — giữ số cũ, lần sau đọc lại.`);
        console.log(`    -> Trích xuất được ${items.length} mặt hàng.`);
        for (const it of items) {
          console.log(
            `       SKU: ${it.sku} | ASIN: ${it.asin} | Expected: ${it.amazon_received} | Located: ${it.so_luong_amazon_nhan} | Discrepancy: ${it.discrepancy} | Status: ${it.status}`
          );
        }
        browserCheckedRows.push(...items);

        stateCache[storeName][sId] = {
          parser: PARSER_VERSION,
          shipment_id: sId,
          store: storeName,
          items,
          receivingDate,
          last_checked_at: new Date().toISOString(),
        };

        if (i < needBrowserCheck.length - 1) {
          const delay = Math.floor(Math.random() * 3000) + 4000;
          console.log(`    (Nghỉ mô phỏng ${Math.round(delay / 1000)}s chống quét bot...)`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      await browser.close().catch(() => {});
      await stopBrowser(storeConfig.profile_id);
      saveStateCache(stateCache);
    }
  }

  const allStoreRows = [...singleSkuItems, ...dbResolvedItems, ...cachedRows, ...browserCheckedRows];
  
  // Đồng bộ lưu vĩnh viễn vào Database PostgreSQL
  if (allStoreRows.length > 0 || verifiedShipments.length > 0) {
    persistDiscrepanciesToDb(allStoreRows, { store: storeName, shipments: verifiedShipments });
  }

  return allStoreRows;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
export async function runShipmentDiscrepancyCrawler(options?: {
  storeName?: string;
  allStores?: boolean;
  limit?: number;
  shipmentIds?: string[];
  /** false: chỉ cập nhật DB + Google Sheet, không gửi Telegram (chạy hằng ngày, Telegram chỉ sáng thứ 2) */
  notify?: boolean;
}) {
  const storesPath = path.join(__dirname, "stores.json");
  let stores: StoreConfig[] = [];
  if (fs.existsSync(storesPath)) {
    stores = JSON.parse(fs.readFileSync(storesPath, "utf8"));
  }

  const stateCache = loadStateCache();
  const allStoresRows: DiscrepancyRow[] = [];

  const runAll = options?.allStores || options?.storeName?.toUpperCase() === "ALL";

  if (runAll) {
    console.log(`\n===============================================================`);
    console.log(`🚀 BẮT ĐẦU QUÉT SHIPMENT DISCREPANCY CHO TẤT CẢ CÁC STORE (${stores.length} stores)`);
    console.log(`===============================================================`);

    const processedStoreNames: string[] = [];

    for (const st of stores) {
      if (st.enabled === false) continue;
      try {
        const rows = await processStore(st, stateCache, { limit: options?.limit });
        allStoresRows.push(...rows);
        processedStoreNames.push(st.store_name);
      } catch (err: any) {
        console.error(`❌ Lỗi xử lý store ${st.store_name}: ${err.message}`);
      }
    }

    if (allStoresRows.length > 0) {
      console.log(`\n===============================================================`);
      console.log(`📊 ĐANG ĐỒNG BỘ DỮ LIỆU ĐỐI SOÁT LÊN GOOGLE SHEETS (TỔNG ${allStoresRows.length} DÒNG)...`);
      cleanOldTemporaryFiles();

      const allRegisteredStores = stores.map((s) => s.store_name);
      let sheetUrl = "";
      try {
        sheetUrl = await syncDiscrepanciesToGoogleSheet(allStoresRows, allRegisteredStores);
      } catch (e: any) {
        console.warn(`[GoogleSheet] Lỗi đồng bộ: ${e.message}`);
      }

      const totalLost = allStoresRows.reduce((acc, r) => (r.discrepancy < 0 ? acc + Math.abs(r.discrepancy) : acc), 0);
      const totalOver = allStoresRows.reduce((acc, r) => (r.discrepancy > 0 ? acc + r.discrepancy : acc), 0);

      const messageParts = [
        `🔔 *Báo Cáo Đối Soát Shipment Amazon Discrepancy (ALL STORES)*`,
        `🏪 Tổng số store: *${processedStoreNames.length}*`,
        `📋 Tổng số dòng dữ liệu: *${allStoresRows.length}*`,
        `🔴 Tổng thiếu: *${totalLost}* units`,
        `🟢 Tổng thừa: *${totalOver}* units`,
      ];
      if (sheetUrl) {
        messageParts.push(`🌐 Google Sheet: [Mở Bảng Đối Soát Online](${sheetUrl})`);
      }

      if (options?.notify !== false) {
        await sendTelegramMessage(messageParts.join("\n")).catch((e) => console.warn(`Telegram error: ${e.message}`));
      }
    }
  } else {
    const targetStoreName = (options?.storeName || "FASTPEACE").toUpperCase();
    const storeConfig = stores.find((s) => s.store_name.toUpperCase() === targetStoreName);
    if (!storeConfig) {
      throw new Error(`Không tìm thấy store "${targetStoreName}" trong stores.json!`);
    }

    const rows = await processStore(storeConfig, stateCache, {
      limit: options?.limit,
      specificShipmentIds: options?.shipmentIds,
    });
    allStoresRows.push(...rows);

    // Dữ liệu các store khác lấy từ DB (bảng accounting_shipment_discrepancies, đủ cả lô 1 SKU);
    // DB lỗi thì dùng cache local như trước.
    const fullDataset: DiscrepancyRow[] = [...rows];
    let otherStores: Record<string, Record<string, CachedShipmentRecord>> = stateCache;
    try {
      const scriptPath = path.join(__dirname, "get_discrepancy_shipments.py");
      const output = execSync(`python3 "${scriptPath}" "--load-all-cached"`, { encoding: "utf8", timeout: 30000 });
      const fromDb = JSON.parse(output.trim());
      if (fromDb && typeof fromDb === "object" && !fromDb.error) otherStores = fromDb;
    } catch (err: any) {
      console.warn(`[DB] Không tải được dữ liệu store khác, dùng cache local: ${err.message}`);
    }
    for (const [stName, shipments] of Object.entries(otherStores)) {
      if (stName.toUpperCase() === targetStoreName) continue;
      for (const rec of Object.values(shipments)) {
        if (rec.items && Array.isArray(rec.items) && rec.items.length > 0) fullDataset.push(...rec.items);
      }
    }

    cleanOldTemporaryFiles();
    const allRegisteredStores = stores.map((s) => s.store_name);
    try {
      await syncDiscrepanciesToGoogleSheet(fullDataset, allRegisteredStores);
    } catch (e: any) {
      console.warn(`[GoogleSheet] Lỗi đồng bộ: ${e.message}`);
    }
  }

  console.log(`\n🎉 HOÀN THÀNH TIẾN TRÌNH.`);
  return allStoresRows;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let store: string | undefined;
  let allStores = false;
  let limit: number | undefined;
  const specificIds: string[] = [];
  let notify = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") allStores = true;
    if (args[i] === "--no-notify") notify = false;
    if (args[i] === "--store" && args[i + 1]) store = args[++i];
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--id" && args[i + 1]) specificIds.push(args[++i]);
  }

  runShipmentDiscrepancyCrawler({
    storeName: store,
    allStores,
    shipmentIds: specificIds.length > 0 ? specificIds : undefined,
    limit,
    notify,
  }).catch((err) => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
  });
}
