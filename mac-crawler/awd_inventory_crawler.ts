import { chromium, type BrowserContext, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { sendTelegramMessage } from "./telegram";

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
const DEFAULT_CDP_PORT = Number(process.env.ADSPOWER_CDP_PORT || 0);
const safeAccountingDownloadDir = path.join(os.homedir(), "AmazonAccounting", "downloads");
const ACCOUNTING_DOWNLOAD_DIR = process.env.ACCOUNTING_DOWNLOAD_DIR || safeAccountingDownloadDir;

// Lock file riêng biệt cho AWD Inventory Crawler, tuyệt đối không ảnh hưởng PPC Lock, FBA Inventory hay Daily Accounting
const AWD_INVENTORY_LOCK_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AmazonAccounting",
  "awd_inventory_run.lock"
);

export function acquireAwdInventoryLock(): () => void {
  fs.mkdirSync(path.dirname(AWD_INVENTORY_LOCK_PATH), { recursive: true });
  try {
    const fd = fs.openSync(AWD_INVENTORY_LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as any).code) : "";
    if (errorCode !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(AWD_INVENTORY_LOCK_PATH, "utf8").split(/\s+/)[0]);
    try {
      if (pid > 0) process.kill(pid, 0);
      throw new Error(`Một tiến trình tải file tồn kho AWD khác đang chạy (PID ${pid}).`);
    } catch (probe: unknown) {
      const probeCode = typeof probe === "object" && probe !== null && "code" in probe ? String((probe as any).code) : "";
      if (probeCode !== "ESRCH") throw probe;
      fs.unlinkSync(AWD_INVENTORY_LOCK_PATH);
      return acquireAwdInventoryLock();
    }
  }
  return () => {
    try { fs.unlinkSync(AWD_INVENTORY_LOCK_PATH); } catch {}
  };
}

export interface StoreTarget {
  store_name: string;
  profile_id: string;
  store_id?: string;
  enabled?: boolean;
}

interface WebAppStore {
  id: string;
  name: string;
  status?: string;
}

let webAppStoresPromise: Promise<WebAppStore[]> | null = null;

function normalizeStoreName(value: string): string {
  const norm = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  if (norm === "hsostore") return "warmstorey";
  return norm;
}

async function loadWebAppStores(): Promise<WebAppStore[]> {
  if (webAppStoresPromise) return webAppStoresPromise;
  webAppStoresPromise = (async () => {
    const webAppUrl = (process.env.WEB_APP_URL || "https://ncehub.net").replace(/\/$/, "");
    const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
    if (!authToken) {
      throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể xác minh store trước khi nạp AWD Inventory Ledger.");
    }
    const response = await fetch(`${webAppUrl}/api/accounting/stores`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      throw new Error(`Không lấy được danh sách store từ Web App (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const payload = (await response.json()) as { stores?: WebAppStore[] };
    if (!Array.isArray(payload.stores)) throw new Error("Web App trả về danh sách store không hợp lệ.");
    return payload.stores;
  })();
  try {
    return await webAppStoresPromise;
  } catch (error) {
    webAppStoresPromise = null;
    throw error;
  }
}

async function resolveVerifiedStoreId(store: StoreTarget): Promise<string> {
  const stores = await loadWebAppStores();
  const normalizedName = normalizeStoreName(store.store_name);
  const matches = stores.filter((candidate) => normalizeStoreName(candidate.name) === normalizedName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Không tìm thấy store Web App tên chính xác "${store.store_name}".`
        : `Có ${matches.length} store Web App trùng tên "${store.store_name}"; từ chối import để tránh nạp nhầm.`
    );
  }
  const matched = matches[0];
  if (store.store_id && store.store_id !== matched.id) {
    throw new Error(`store_id cấu hình cho ${store.store_name} không khớp Web App (${store.store_id} ≠ ${matched.id}).`);
  }
  return matched.id;
}

export async function parseAndIngestAwdInventoryLedgerFile(
  filePath: string,
  store: StoreTarget,
  snapshotDate: string
): Promise<{ insertedCount: number; updatedSkuMasterCount: number; totalTonKhoAwd: number }> {
  const webAppUrl = (process.env.WEB_APP_URL || "https://ncehub.net").replace(/\/$/, "");
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    return { insertedCount: 0, updatedSkuMasterCount: 0, totalTonKhoAwd: 0 };
  }
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp AWD Inventory Ledger.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - AWD Ledger] Đang gửi file lên Web App API: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const content = fs.readFileSync(filePath, "utf8");

  const formData = new FormData();
  const blob = new Blob([content], { type: "text/csv" });
  formData.append("file", blob, path.basename(filePath));
  formData.append("store_id", storeId);
  formData.append("snapshot_date", snapshotDate);

  const res = await fetch(`${webAppUrl}/api/accounting/awd-inventory-ledger`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });

  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API nạp AWD Inventory Ledger lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }

  const json = JSON.parse(responseText);
  return json.data || { insertedCount: 0, updatedSkuMasterCount: 0, totalTonKhoAwd: 0 };
}

export function getStoreList(): StoreTarget[] {
  const storesPath = path.join(__dirname, "stores.json");
  if (fs.existsSync(storesPath)) {
    try {
      const raw = fs.readFileSync(storesPath, "utf8");
      const list = JSON.parse(raw) as StoreTarget[];
      if (Array.isArray(list) && list.length > 0) {
        return list.filter((s) => s.enabled !== false && s.store_name && s.profile_id);
      }
    } catch (err) {
      console.warn(`[Config] Không đọc được stores.json: ${(err as Error).message}`);
    }
  }
  return [];
}

/**
 * Tính ngày thứ 7 cần lấy dữ liệu AWD:
 * Yêu cầu người dùng:
 * - Chạy vào 4h sáng mỗi Thứ 4 (day 3).
 * - Ví dụ Thứ 4 ngày 28 thì chốt tải file Thứ 7 ngày 24/10 tuần trước (lùi 4 ngày).
 * - Nếu chạy vào Thứ 3 (day 2): hôm nay là thứ 3 nên chỉ tải được thứ 7 tuần trước nữa (lùi 10 ngày).
 * - Nếu người dùng chỉ định --date=YYYY-MM-DD thì dùng chính xác ngày đó.
 */
export function getTargetAwdSaturday(refDate = new Date()): { isoDate: string; usDate: string } {
  const d = new Date(refDate);
  const day = d.getDay(); // 0 = CN, 1 = T2, 2 = T3, 3 = T4, 4 = T5, 5 = T6, 6 = T7
  let diff = 0;
  if (day === 3) {
    // Thứ 4: lùi 4 ngày về Thứ 7 tuần trước (ngày 28 -> ngày 24)
    diff = 4;
  } else if (day === 2) {
    // Thứ 3: lùi 10 ngày về Thứ 7 tuần trước nữa (vì dữ liệu thứ 7 tuần vừa rồi chưa sẵn sàng trên AWD)
    diff = 10;
  } else if (day === 1) {
    // Thứ 2: lùi 9 ngày
    diff = 9;
  } else if (day === 4) {
    // Thứ 5: lùi 5 ngày
    diff = 5;
  } else if (day === 5) {
    // Thứ 6: lùi 6 ngày
    diff = 6;
  } else if (day === 6) {
    // Thứ 7: lùi 7 ngày về thứ 7 tuần trước
    diff = 7;
  } else {
    // Chủ nhật (0): lùi 8 ngày
    diff = 8;
  }
  d.setDate(d.getDate() - diff);

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const date = pad(d.getDate());

  const isoDate = `${year}-${month}-${date}`;
  const usDate = `${month}/${date}/${year}`;
  return { isoDate, usDate };
}

// AdsPower profile control
export async function startAdsPowerProfile(profileId: string): Promise<string> {
  if (DEFAULT_CDP_PORT > 0) {
    return `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
  }

  try {
    const res = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/local-active`);
    const data = (await res.json()) as { code?: number; data?: { list?: Array<{ user_id?: string; debug_port?: number }> } };
    const activeProfiles = data.data?.list || [];
    if (data.code === 0 && activeProfiles.length > 0) {
      const match = activeProfiles.find((item) => item.user_id === profileId);
      if (match && match.debug_port) {
        console.log(`[AdsPower] Profile ${profileId} đã chạy sẵn tại port ${match.debug_port}`);
        return `http://127.0.0.1:${match.debug_port}`;
      }
    }
  } catch (err) {
    console.warn(`[AdsPower] Kiểm tra local-active thất bại: ${(err as Error).message}`);
  }

  console.log(`[AdsPower] Đang mở trình duyệt profile: ${profileId}...`);
  const startRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
  const startData = (await startRes.json()) as any;
  if (startData.code === 0 && startData.data?.debug_port) {
    console.log(`[AdsPower] Mở thành công profile ${profileId}! CDP Port: ${startData.data.debug_port}`);
    await new Promise((r) => setTimeout(r, 2000));
    return `http://127.0.0.1:${startData.data.debug_port}`;
  }
  if (startData.data?.ws?.puppeteer) {
    return startData.data.ws.puppeteer;
  }
  throw new Error(`AdsPower API từ chối mở profile ${profileId}: ${startData.msg || "Unknown error"}`);
}

export async function stopAdsPowerProfile(profileId: string): Promise<void> {
  try {
    console.log(`[AdsPower] Đang đóng profile ${profileId}...`);
    await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`[AdsPower] => Đã đóng profile ${profileId}`);
  } catch (err) {
    console.warn(`[AdsPower] Không đóng được profile ${profileId}: ${(err as Error).message}`);
  }
}

function isSignInUrl(url: string): boolean {
  return url.includes("/signin") || url.includes("/ap/signin") || url.includes("/auth/signin");
}

/**
 * Tải file báo cáo AWD Inventory Ledger (AWD_INVENTORY_LEDGER_REPORT/1)
 * Các đặc thù của giao diện AWD:
 * - URL: https://sellercentral.amazon.com/reportcentral/AWD_INVENTORY_LEDGER_REPORT/1
 * - Tab: Download (đã chọn mặc định hoặc click tab Download)
 * - Type of report: Summary view (radio value "88888")
 * - Aggregate report by location: Country (radio value "COUNTRY")
 * - Aggregate report by time period: Daily (dropdown "Aggregate report by time period", value "DAY" hoặc "DAILY")
 * - Date picker: #ledger-time-picker-kat-date-range-picker (From Date và To Date)
 * - Nút yêu cầu: Request Download (kat-button[label="Request Download"])
 * - Nút tải: kat-button[label="Download"] ở dòng đầu tiên của bảng kết quả
 */
export async function downloadAwdInventoryLedgerReport(
  page: Page,
  downloadDir: string,
  targetIsoDate: string,
  targetUsDate: string
): Promise<string | null> {
  const url = "https://sellercentral.amazon.com/reportcentral/AWD_INVENTORY_LEDGER_REPORT/1";
  console.log(`  [AWD Ledger] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  // 1. Chuyển sang Tab "Download" nếu chưa ở tab Download
  try {
    const downloadTab = page.locator('kat-tab[label="Download"], a:has-text("Download"), button:has-text("Download")').first();
    if (await downloadTab.isVisible({ timeout: 5000 })) {
      await downloadTab.click();
      console.log(`  [AWD Ledger] Đã click tab 'Download'.`);
      await page.waitForTimeout(2000);
    }
  } catch {}

  // 2. Đảm bảo chọn Radio "Summary view" (value 88888)
  try {
    await page.evaluate(() => {
      const radio = (document.querySelector('kat-radio-button[value="88888"], input[value="88888"], kat-radio-button[label*="Summary"], input[aria-label="Summary view"]') ||
        Array.from(document.querySelectorAll('kat-radio-button, input[type="radio"]')).find((r: any) =>
          (r.textContent || r.label || r.value || "").toLowerCase().includes("summary")
        )) as HTMLElement | null;
      if (radio) {
        radio.click();
        (radio as any).checked = true;
      }
    });
    await page.waitForTimeout(1000);
  } catch {}

  // 3. Đảm bảo chọn Radio "Country"
  try {
    await page.evaluate(() => {
      const radio = (document.querySelector('kat-radio-button[value="COUNTRY"], input[value="COUNTRY"], kat-radio-button[label*="Country"], input[aria-label="Country"]') ||
        Array.from(document.querySelectorAll('kat-radio-button, input[type="radio"]')).find((r: any) =>
          (r.textContent || r.label || r.value || "").toLowerCase().includes("country")
        )) as HTMLElement | null;
      if (radio) {
        radio.click();
        (radio as any).checked = true;
      }
    });
    await page.waitForTimeout(1000);
  } catch {}

  // 4. Chọn "Daily" trong Dropdown "Aggregate report by time period"
  try {
    await page.evaluate(() => {
      const dd = (document.querySelector('kat-dropdown[label*="time period"], kat-dropdown[kat-aria-label*="time period"]') ||
        Array.from(document.querySelectorAll("kat-dropdown")).find((d: any) =>
          (d.getAttribute("label") || d.getAttribute("kat-aria-label") || "").toLowerCase().includes("time period")
        )) as any;
      if (dd) {
        if (dd.shadowRoot) {
          const opt = Array.from(dd.shadowRoot.querySelectorAll("kat-option")).find((o: any) =>
            (o.getAttribute("value") || "").toUpperCase() === "DAY" ||
            (o.getAttribute("value") || "").toUpperCase() === "DAILY" ||
            (o.textContent || "").toLowerCase().includes("daily")
          ) as HTMLElement | null;
          if (opt) opt.click();
        }
        dd.value = "DAY";
        dd.dispatchEvent(new CustomEvent("change", { detail: { value: "DAY" }, bubbles: true, composed: true }));
      }
    });
    await page.waitForTimeout(1000);
  } catch {}

  // 5. Điền From Date và To Date vào date range picker
  console.log(`  [AWD Ledger] Đang điền ngày chốt sổ AWD: ${targetUsDate} (${targetIsoDate})...`);
  const dateFilled = await page.evaluate((usDate) => {
    let count = 0;
    const rangePicker = (document.querySelector("#ledger-time-picker-kat-date-range-picker") ||
      document.querySelector("kat-date-range-picker")) as any;

    if (rangePicker && rangePicker.shadowRoot) {
      const pickers = rangePicker.shadowRoot.querySelectorAll("kat-date-picker");
      pickers.forEach((p: any) => {
        const katInput = p.shadowRoot?.querySelector("kat-input") || p.querySelector("kat-input");
        const input = katInput?.shadowRoot?.querySelector("input") || katInput?.querySelector("input") || p.shadowRoot?.querySelector("input");
        if (input) {
          input.value = usDate;
          input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
          count++;
        }
      });
      rangePicker.setAttribute("start-value", usDate);
      rangePicker.setAttribute("end-value", usDate);
      rangePicker.dispatchEvent(new CustomEvent("change", { detail: { startValue: usDate, endValue: usDate }, bubbles: true, composed: true }));
    }

    const allInputs = Array.from(document.querySelectorAll('kat-date-picker input, input[placeholder*="MM/DD/YYYY"]'));
    for (const inp of allInputs as HTMLInputElement[]) {
      inp.value = usDate;
      inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      inp.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
      count++;
    }
    return count;
  }, targetUsDate);

  console.log(`  [AWD Ledger] Kết quả điền ngày: ${dateFilled} inputs được cập nhật thành ${targetUsDate}`);
  await page.waitForTimeout(2000);

  // 6. Nhấn nút "Request Download" (AWD button label là "Request Download")
  console.log(`  [AWD Ledger] Đang nhấn nút 'Request Download'...`);
  const requestBtn = page.locator('kat-button[label="Request Download"], button:has-text("Request Download"), [data-testid="request-download"]').first();
  await requestBtn.waitFor({ state: "visible", timeout: 15000 });
  await requestBtn.click();
  console.log(`  [AWD Ledger] Đã click 'Request Download'. Đang theo dõi tiến độ tạo báo cáo trong bảng...`);
  await page.waitForTimeout(5000);

  // 7. Chờ nút "Download" xuất hiện ở dòng đầu tiên của bảng lịch sử yêu cầu
  const startTime = Date.now();
  const MAX_WAIT_MS = 300000; // 5 phút

  while (Date.now() - startTime < MAX_WAIT_MS) {
    const statusInfo = await page.evaluate(() => {
      const rows = document.querySelectorAll("kat-table-body kat-table-row, table tbody tr");
      if (!rows.length) return { status: "empty", hasDownload: false, text: "" };
      const firstRow = rows[0];
      const text = (firstRow.textContent || "").trim();
      const btn = firstRow.querySelector("kat-button[label='Download']") ||
        Array.from(firstRow.querySelectorAll("button, kat-button")).find((b: any) =>
          (b.getAttribute("label") || b.textContent || "").trim() === "Download"
        );
      if (btn) return { status: "ready", hasDownload: true, text };
      if (text.includes("No Data Available")) return { status: "no_data", hasDownload: false, text };
      if (text.includes("Cancelled") || text.includes("Fatal")) return { status: "failed", hasDownload: false, text };
      return { status: "in_progress", hasDownload: false, text };
    });

    if (statusInfo.hasDownload) {
      console.log(`  [AWD Ledger] ✅ Báo cáo AWD đã tạo xong! Đang bấm tải file...`);
      break;
    }

    if (statusInfo.status === "no_data") {
      console.warn(`  [AWD Ledger] ⚠️ Dòng đầu tiên báo 'No Data Available' cho ngày ${targetUsDate}. Amazon chưa tổng hợp số liệu cho ngày này!`);
      return null;
    }

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [AWD Ledger] Báo cáo đang xử lý... chờ 10 giây (đã chờ ${elapsedSec}s, trạng thái: ${statusInfo.status})...`);
    await page.waitForTimeout(10000);

    // Sau 25s reload trang và quay lại tab Download
    if (elapsedSec >= 25 && elapsedSec % 20 < 10) {
      try {
        console.log(`  [AWD Ledger] Đang làm mới trang để cập nhật bảng báo cáo...`);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        const tab = page.locator('kat-tab[label="Download"], a:has-text("Download")').first();
        if (await tab.isVisible({ timeout: 5000 })) {
          await tab.click();
          await page.waitForTimeout(2000);
        }
      } catch {}
    }
  }

  // 8. Bấm tải file CSV
  const tableDownloadBtn = page.locator("kat-table-body kat-table-row:nth-child(1) kat-button[label='Download'], table tbody tr:nth-child(1) button:has-text('Download')").first();
  await tableDownloadBtn.waitFor({ state: "visible", timeout: 25000 });

  fs.mkdirSync(downloadDir, { recursive: true });
  const targetFileName = `10_AwdInventoryLedger_${targetIsoDate}.csv`;
  const finalFilePath = path.join(downloadDir, targetFileName);

  console.log(`  [AWD Ledger] Bắt đầu tải file và lưu vào: ${finalFilePath}`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45000 }),
    (async () => {
      try {
        await tableDownloadBtn.click({ timeout: 5000 });
      } catch {
        await page.evaluate(() => {
          const rows = document.querySelectorAll("kat-table-body kat-table-row, table tbody tr");
          const firstRow = rows[0];
          const katBtn = firstRow?.querySelector("kat-button[label='Download']") as any;
          if (katBtn?.shadowRoot?.querySelector("button")) {
            katBtn.shadowRoot.querySelector("button").click();
          } else if (katBtn) {
            katBtn.click();
          }
        });
      }
    })(),
  ]);

  await download.saveAs(finalFilePath);
  console.log(`  [AWD Ledger] ✅ Tải thành công: ${targetFileName} (${fs.statSync(finalFilePath).size} bytes)`);

  return finalFilePath;
}

/**
 * Tải file lên Cloudflare R2
 */
async function uploadFileToR2(filePath: string, storeName: string, dateStr: string) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.ACCOUNTING_R2_PREFIX || "accounting-reports").replace(/^\/+|\/+$/g, "");

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.warn(`[R2] Chưa cấu hình R2 credentials; bỏ qua upload Cloudflare R2.`);
    return;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const r2Key = `${prefix}/${dateStr}/${storeName}/${fileName}`;

  console.log(`  [R2 Upload] Đang tải lên R2: ${r2Key}...`);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: "text/csv",
    })
  );
  console.log(`  [R2 Upload] ✅ Đã lưu vào Quản lý file trên R2: ${r2Key}`);
}

/**
 * Hàm thực thi toàn bộ pipeline tải AWD Inventory Ledger cho các Store
 */
export async function runAwdInventoryLedgerCrawler(): Promise<void> {
  const releaseLock = acquireAwdInventoryLock();
  try {
    const requestedDate = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
    const requestedStore = process.argv.find((arg) => arg.startsWith("--store="))?.slice("--store=".length);

    let targetSaturday: { isoDate: string; usDate: string };
    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      const [y, m, d] = requestedDate.split("-");
      targetSaturday = { isoDate: requestedDate, usDate: `${m}/${d}/${y}` };
    } else {
      targetSaturday = getTargetAwdSaturday(new Date());
    }

    console.log(`\n======================================================================`);
    console.log(`🏬 BẮT ĐẦU CRAWL TỒN KHO AWD HÀNG TUẦN (AWD INVENTORY LEDGER REPORT)`);
    console.log(`📅 Ngày chốt tồn kho AWD (Thứ 7): ${targetSaturday.isoDate} (${targetSaturday.usDate})`);
    console.log(`⏰ Thời gian chạy: ${new Date().toLocaleString("vi-VN")}`);
    console.log(`======================================================================\n`);

    const allStores = getStoreList();
    const stores = requestedStore
      ? allStores.filter((s) => s.store_name.toUpperCase() === requestedStore.toUpperCase())
      : allStores;

    if (stores.length === 0) {
      console.log(`[Config] Không có store nào cần crawl tồn kho AWD.`);
      return;
    }

    for (const store of stores) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`🏪 Bắt đầu xử lý Store: ${store.store_name} (Profile: ${store.profile_id})`);
      console.log(`------------------------------------------------------------`);

      let browserContext: BrowserContext | null = null;
      try {
        const cdpUrl = await startAdsPowerProfile(store.profile_id);
        const browser = await chromium.connectOverCDP(cdpUrl);
        const contexts = browser.contexts();
        browserContext = contexts[0] || (await browser.newContext());
        const page = browserContext.pages()[0] || (await browserContext.newPage());

        const storeDownloadDir = path.join(ACCOUNTING_DOWNLOAD_DIR, targetSaturday.isoDate, store.store_name);
        const downloadedFilePath = await downloadAwdInventoryLedgerReport(
          page,
          storeDownloadDir,
          targetSaturday.isoDate,
          targetSaturday.usDate
        );

        if (!downloadedFilePath) {
          console.warn(`  ⚠️ Store ${store.store_name} không có dữ liệu tải về (No Data Available) cho ngày ${targetSaturday.isoDate}.`);
          await sendTelegramMessage(
            `ℹ️ <b>[AWD INVENTORY LEDGER]</b> Store <b>${store.store_name}</b> chưa có dữ liệu ngày <b>${targetSaturday.isoDate}</b> (No Data Available từ Amazon).`
          );
          continue;
        }

        // 1. Upload lên Cloudflare R2
        await uploadFileToR2(downloadedFilePath, store.store_name, targetSaturday.isoDate);

        // 2. Tự động gửi file lên Web App API để đọc các cột và nạp vào database
        console.log(`  [Database] Đang nạp dữ liệu tồn kho AWD vào Database qua Web App API...`);
        const ingestResult = await parseAndIngestAwdInventoryLedgerFile(
          downloadedFilePath,
          store,
          targetSaturday.isoDate
        );

        console.log(
          `  [Database] ✅ Nạp thành công: ${ingestResult.insertedCount} dòng, cập nhật ${ingestResult.updatedSkuMasterCount} SKU, tổng tồn kho AWD ${ingestResult.totalTonKhoAwd.toLocaleString("en-US")} units!`
        );

        await sendTelegramMessage(
          `🏬 <b>[AWD INVENTORY LEDGER] TỒN KHO THỨ 7 (${targetSaturday.isoDate})</b>\n` +
          `🏪 Store: <b>${store.store_name}</b>\n` +
          `📊 Tổng tồn kho AWD: <b>${ingestResult.totalTonKhoAwd.toLocaleString("en-US")} units</b>\n` +
          `🏷️ SKU cập nhật trong Bảng Mã: <b>${ingestResult.updatedSkuMasterCount}</b>\n` +
          `📁 File: <code>${path.basename(downloadedFilePath)}</code>`
        );
      } catch (err: any) {
        console.error(`  ❌ [LỖI] Store ${store.store_name} gặp lỗi khi tải AWD Inventory Ledger:`, err?.message || err);
        const errMsg = String(err?.message || err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        await sendTelegramMessage(
          `⚠️ <b>[AWD INVENTORY LEDGER LỖI]</b> Store <b>${store.store_name}</b> không tải được báo cáo tồn kho AWD:\n<code>${errMsg.slice(0, 500)}</code>`
        );
      } finally {
        if (browserContext) {
          try { await browserContext.close(); } catch {}
        }
        await stopAdsPowerProfile(store.profile_id);
      }
    }

    console.log(`\n======================================================================`);
    console.log(`🎉 HOÀN TẤT TOÀN BỘ TIẾN TRÌNH CRAWL TỒN KHO AWD HÀNG TUẦN!`);
    console.log(`======================================================================\n`);
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  runAwdInventoryLedgerCrawler().catch((err) => {
    console.error("FATAL ERROR IN AWD INVENTORY LEDGER CRAWLER:", err);
    process.exit(1);
  });
}
