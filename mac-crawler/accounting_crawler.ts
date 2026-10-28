import { chromium, type BrowserContext, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
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
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || "http://127.0.0.1:50325";
const DEFAULT_CDP_PORT = Number(process.env.ADSPOWER_CDP_PORT || 0);

// Thư mục lưu trữ KẾ TOÁN HOÀN TOÀN TÁCH BIỆT với PPC Crawler
const safeAccountingDownloadDir = path.join(os.homedir(), "AmazonAccounting", "downloads");
const ACCOUNTING_DOWNLOAD_DIR = process.env.ACCOUNTING_DOWNLOAD_DIR || safeAccountingDownloadDir;
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const MAX_TASK_RETRIES = 5;
const MAX_HISTORICAL_ORDER_RETRIES = 3;
const MAX_MISSING_FILE_CHECKS = 3;
const ACCOUNTING_TASK_COUNT = 8;

import { ensureAmazonSession } from "./amazon_auth";

function getVietnamDateParts(now = new Date()): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour") };
}

/** Giữ nguyên quy tắc ngày của crawler KETOAN cũ: trước 15h lấy T-2, sau 15h lấy T-1. */
export function getLegacyAccountingTargetDate(now = new Date()): string {
  const { year, month, day, hour } = getVietnamDateParts(now);
  const target = new Date(Date.UTC(year, month - 1, day));
  target.setUTCDate(target.getUTCDate() - (hour < 15 ? 2 : 1));
  return target.toISOString().slice(0, 10);
}

function formatUsDateFromIso(dateStr: string, daysBefore = 0): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - daysBefore);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function formatPortfolioCalendarLabel(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

function subtractIsoDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Lock file riêng biệt cho Kế Toán, không làm ảnh hưởng PPC Lock
const ACCOUNTING_LOCK_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AmazonAccounting",
  "accounting_run.lock",
);

export function acquireAccountingLock(): () => void {
  fs.mkdirSync(path.dirname(ACCOUNTING_LOCK_PATH), { recursive: true });
  try {
    const fd = fs.openSync(ACCOUNTING_LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as any).code) : "";
    if (errorCode !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(ACCOUNTING_LOCK_PATH, "utf8").split(/\s+/)[0]);
    try {
      if (pid > 0) process.kill(pid, 0);
      throw new Error(`Một tiến trình tải file kế toán khác đang chạy (PID ${pid}).`);
    } catch (probe: unknown) {
      const probeCode = typeof probe === "object" && probe !== null && "code" in probe ? String((probe as any).code) : "";
      if (probeCode !== "ESRCH") throw probe;
      fs.unlinkSync(ACCOUNTING_LOCK_PATH);
      return acquireAccountingLock();
    }
  }
  return () => {
    try { fs.unlinkSync(ACCOUNTING_LOCK_PATH); } catch { }
  };
}

export interface StoreTarget {
  store_name: string;
  profile_id: string;
  /** UUID trong bảng `stores`; nếu có sẽ được xác minh lại với Web App trước khi import. */
  store_id?: string;
  enabled?: boolean;
  description?: string;
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
      throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể xác minh store trước khi nạp Shipment.");
    }
    const response = await fetch(`${webAppUrl}/api/accounting/stores`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      throw new Error(`Không lấy được danh sách store từ Web App (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const payload = await response.json() as { stores?: WebAppStore[] };
    if (!Array.isArray(payload.stores)) throw new Error("Web App trả về danh sách store không hợp lệ.");
    return payload.stores;
  })();
  try {
    return await webAppStoresPromise;
  } catch (error) {
    // Lỗi mạng/xác thực tạm thời không được cache để retry sau có cơ hội thành công.
    webAppStoresPromise = null;
    throw error;
  }
}

/** Chỉ chấp nhận một store khớp chính xác; không fallback theo tên gần đúng để tránh nạp nhầm. */
async function resolveVerifiedStoreId(store: StoreTarget): Promise<string> {
  const stores = await loadWebAppStores();
  const normalizedName = normalizeStoreName(store.store_name);
  const matches = stores.filter((candidate) => normalizeStoreName(candidate.name) === normalizedName);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Không tìm thấy store Web App tên chính xác "${store.store_name}".`
        : `Có ${matches.length} store Web App trùng tên "${store.store_name}"; từ chối import để tránh nạp nhầm.`,
    );
  }
  const matched = matches[0];
  if (store.store_id && store.store_id !== matched.id) {
    throw new Error(`store_id cấu hình cho ${store.store_name} không khớp Web App (${store.store_id} ≠ ${matched.id}).`);
  }
  if (matched.status && matched.status !== "active") {
    throw new Error(`Store ${store.store_name} đang ở trạng thái ${matched.status}; không import Shipment.`);
  }
  return matched.id;
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
  const fallbackStore = process.env.STORE_NAME || "HSOSTORE";
  const fallbackProfile = process.env.ADSPOWER_PROFILE_ID || "";
  return [{ store_name: fallbackStore, profile_id: fallbackProfile, enabled: true }];
}

// ============================================================================
// ADSPOWER PROFILE CONTROL (AUTO START & STOP TO SAVE MEMORY)
// ============================================================================
export async function startAdsPowerProfile(profileId: string): Promise<string> {
  if (DEFAULT_CDP_PORT > 0) {
    return `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
  }

  // 1. Kiểm tra xem profile đã chạy sẵn chưa
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

  // 2. Khởi động profile
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
  if (startData.code === 0 && (!startData.data?.debug_port && !startData.data?.ws?.puppeteer)) {
    console.warn(`[AdsPower API] Profile ${profileId} trả về success nhưng debug_port rỗng (tiến trình cũ bị treo). Đang dọn dẹp và thử lại...`);
    try {
      const { execSync } = await import("node:child_process");
      execSync(`pkill -9 -f "${profileId}" || true`, { stdio: "ignore" });
      execSync(`pkill -9 -f SunBrowser || true`, { stdio: "ignore" });
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
    const retryRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
    const retryData = (await retryRes.json()) as any;
    if (retryData.code === 0 && retryData.data?.debug_port) {
      console.log(`[AdsPower] Mở lại thành công profile ${profileId} sau khi dọn dẹp! CDP Port: ${retryData.data.debug_port}`);
      await new Promise((r) => setTimeout(r, 2000));
      return `http://127.0.0.1:${retryData.data.debug_port}`;
    }
    if (retryData.data?.ws?.puppeteer) {
      return retryData.data.ws.puppeteer;
    }
  }
  throw new Error(`AdsPower API từ chối mở profile ${profileId}: ${startData.msg || "Unknown error"}`);
}

export async function stopAdsPowerProfile(profileId: string): Promise<void> {
  try {
    console.log(`[AdsPower] Đang đóng profile ${profileId} để giải phóng RAM cho Mac mini...`);
    await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`);
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const { execSync } = await import("node:child_process");
      execSync(`pkill -9 -f "${profileId}" || true`, { stdio: "ignore" });
    } catch {}
    console.log(`[AdsPower] => ĐÃ ĐÓNG HOÀN TOÀN PROFILE ${profileId}!`);
  } catch (err) {
    console.warn(`[AdsPower] Không đóng được profile ${profileId}: ${(err as Error).message}`);
  }
}

// Kiểm tra xem trình duyệt có đang bị kẹt ở màn hình đăng nhập không
function isSignInUrl(url: string): boolean {
  return url.includes("/signin") || url.includes("/ap/signin") || url.includes("/auth/signin");
}

// ============================================================================
// LOGIC TẢI 6 FILE BÁO CÁO KẾ TOÁN (SELLER CENTRAL & ADVERTISING)
// ============================================================================

export interface AccountingFilesResult {
  storeName: string;
  targetDate: string;
  files: {
    file01_portfolios?: string | null;
    file02_all_orders?: string | null;
    file03_returns?: string | null;
    file04_service_fees?: string | null;
    file05_campaigns?: string | null;
    file06_inventory?: string | null;
    file07_shipments?: string | null;
    file08_dc_shipments?: string | null;
  };
  errors: string[];
  /** Báo cáo không áp dụng cho store (ví dụ AWD/DC Shipments không có dữ liệu). */
  skipped: string[];
}

type AccountingFileKey = keyof AccountingFilesResult["files"];

interface AccountingDownloadTask {
  key: AccountingFileKey;
  label: string;
  filePrefix?: string;
  download: () => Promise<string | null>;
  /** Store không dùng AWD có thể không có nút Export; đây là trạng thái hợp lệ, không retry. */
  allowNoData?: boolean;
  afterSuccess?: () => Promise<void>;
}

function findExistingValidReportFile(dir: string, prefix: string, targetDateStr: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f.startsWith(prefix) && f.includes(targetDateStr) && !f.endsWith(".part") && !f.endsWith(".crdownload")) {
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).size > 0) {
          // Bắt buộc File 05 phải chứa header chuẩn của Portfolios, loại bỏ hoàn toàn file cũ cào nhầm Campaign Manager
          if (prefix.startsWith("05_Campaigns")) {
            const head = fs.readFileSync(full, "utf-8").slice(0, 300);
            if (head.includes("Campaign name") && !head.includes("Portfolio")) {
              return null;
            }
          }
          return full;
        }
      } catch {}
    }
  }
  return null;
}

function isDownloadedFileValid(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

async function downloadWithRetry(
  label: string,
  download: () => Promise<string | null>,
  maxAttempts = MAX_TASK_RETRIES,
  allowNoData = false,
): Promise<{ path: string | null; noData?: boolean; error?: string }> {
  let lastError = "Không xác định được lỗi tải file.";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`  [${label}] Lần thử ${attempt}/${maxAttempts}...`);
      const downloadedPath = await download();
      if (!downloadedPath && allowNoData) return { path: null, noData: true };
      if (!downloadedPath) throw new Error("Amazon không trả về file tải xuống.");
      return { path: downloadedPath };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [${label}] Lần ${attempt}/${maxAttempts}: ${lastError}`);
      if (attempt < maxAttempts) {
        // Crawler cũ refresh/chờ 30 giây rồi mới thử lại. Mỗi hàm download ở đây
        // đều điều hướng lại trang nguồn, nên không cần refresh riêng.
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
    }
  }
  return { path: null, error: lastError };
}

/**
 * File 01: Portfolios Report từ Amazon Advertising
 */
export async function downloadFile01Portfolios(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url = "https://advertising.amazon.com/cm/portfolios";
  console.log(`  [File 01 - Portfolios] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  if (isSignInUrl(page.url())) {
    throw new Error("Trang Amazon Advertising yêu cầu đăng nhập.");
  }

  // Crawler cũ luôn export Portfolios của đúng ngày báo cáo, không dùng date range mặc định.
  const calendarLabel = formatPortfolioCalendarLabel(targetDateStr);
  const datePickerBtn = page.locator('button[data-e2e-id="dateRangePickerButton"]').first();
  await datePickerBtn.waitFor({ state: "visible", timeout: 15000 });
  await datePickerBtn.click();
  const targetDay = page.locator(`td[aria-label*="${calendarLabel}"]:not([aria-disabled="true"])`).first();
  await targetDay.waitFor({ state: "visible", timeout: 10000 });
  await targetDay.click();
  const saveDateBtn = page.locator('#AACChromePortal button:has-text("Save")').first();
  await saveDateBtn.waitFor({ state: "visible", timeout: 10000 });
  await saveDateBtn.click();
  await page.waitForTimeout(2500);

  // Chọn 300 kết quả/trang nếu có
  try {
    const dropdownBtn = page.locator('button[data-e2e-id="dropdown"]').first();
    if (await dropdownBtn.isVisible({ timeout: 4000 })) {
      await dropdownBtn.click();
      await page.waitForTimeout(1000);
      const opt300 = page.locator('button[data-e2e-id="dropdownItem"][value="300"]').first();
      if (await opt300.isVisible({ timeout: 3000 })) {
        await opt300.click();
        await page.waitForTimeout(2000);
      }
    }
  } catch { }

  // Khớp hoàn toàn KETOAN cũ (Ketoanamz-01-6file.py:802-832):
  // 1. Reset filter (chờ tối đa 10s, click bằng script)
  try {
    const resetBtn = page.locator('button[data-e2e-id="resetButton"]').first();
    await resetBtn.waitFor({ state: "visible", timeout: 10000 });
    await resetBtn.evaluate((el: HTMLElement) => el.click());
    console.log("  [File 01 - Portfolios] Đã click nút 'Reset' filter.");
    await page.waitForTimeout(2500);
  } catch {
    console.log("  [File 01 - Portfolios] Không tìm thấy nút 'Reset' (có thể không có filter nào đang bật), tiếp tục.");
  }

  // 2. Xóa ô search terms nếu có
  try {
    const clearBtnXPath = page.locator("xpath=//input[@id='UCM-CM-APP:ALL_PORTFOLIOS:searchInput']/following-sibling::button").first();
    const searchInput = page.locator("input[id='UCM-CM-APP:ALL_PORTFOLIOS:searchInput'], #UCM-CM-APP\\:ALL_PORTFOLIOS\\:searchInput").first();

    let cleared = false;
    if (await clearBtnXPath.isVisible({ timeout: 4000 }).catch(() => false)) {
      await clearBtnXPath.evaluate((el: HTMLElement) => el.click());
      console.log("  [File 01 - Portfolios] Đã click nút Clear search terms.");
      cleared = true;
      await page.waitForTimeout(1500);
    }

    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const val = await searchInput.inputValue().catch(() => "");
      if (val && val.trim().length > 0) {
        await searchInput.fill("");
        await searchInput.press("Enter");
        console.log(`  [File 01 - Portfolios] Đã xóa text trong ô tìm kiếm (trước đó là '${val}').`);
        cleared = true;
        await page.waitForTimeout(1500);
      }
    }

    if (!cleared) {
      console.log("  [File 01 - Portfolios] Ô tìm kiếm đã trống hoặc không có nút xóa.");
    }
  } catch { }

  // 3. Tìm nút Export và chờ 10-12s như KETOAN cũ để table kết xuất lại dữ liệu sau khi reset
  const exportBtn = page.locator('button[data-e2e-id="export"]').first();
  await exportBtn.waitFor({ state: "visible", timeout: 20000 });

  console.log("  [File 01 - Portfolios] Đã tìm thấy nút Export. Chờ 10 giây để dữ liệu hoàn tất render trước khi bấm tải...");
  await page.waitForTimeout(10000);

  console.log(`  [File 01 - Portfolios] Đang nhấn nút Export và chờ tải file...`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45000 }),
    exportBtn.evaluate((el: HTMLElement) => el.click()).catch(() => exportBtn.click()),
  ]);

  const targetPath = path.join(downloadDir, `01_Portfolios_${targetDateStr}.csv`);
  await download.saveAs(targetPath);
  console.log(`  [File 01 - Portfolios] ✅ Tải thành công: ${path.basename(targetPath)}`);
  return targetPath;
}

/**
 * File 02: All Orders Report (Fulfillment Report)
 * Tận dụng API nội bộ submitDownloadReport để tải nhanh và không phụ thuộc giao diện
 */
async function downloadFile02AllOrders(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url = "https://sellercentral.amazon.com/reportcentral/FlatFileAllOrdersReport/1";
  console.log(`  [File 02 - All Orders] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập (đang ở màn hình Sign-In).");
  }

  // Chuyển đổi định dạng YYYY-MM-DD -> YYYY/MM/DD
  const slashDate = targetDateStr.replace(/-/g, "/");

  console.log(`  [File 02 - All Orders] Gửi yêu cầu API báo cáo ngày ${slashDate}...`);
  const reportInfo = await page.evaluate(async (repDate) => {
    const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]') as HTMLMetaElement | null;
    if (!meta) throw new Error("Không tìm thấy anti-csrftoken-a2z trên trang Amazon (cần đăng nhập Seller Central)");
    const qs =
      "reportFileFormat=TSV&reportStartDate=" +
      encodeURIComponent(repDate) +
      "&reportEndDate=" +
      encodeURIComponent(repDate) +
      "&xdaysBeforeUntilToday=-1&startDateTimeOffset=0&endDateTimeOffset=0" +
      "&specialDateOptions=&reportFRPId=2400&language=&disableTimezone=true";
    const res = await fetch("/reportcentral/api/v1/submitDownloadReport?" + qs, {
      method: "POST",
      credentials: "include",
      headers: { "anti-csrftoken-a2z": meta.content },
    });
    if (!res.ok) throw new Error(`submitDownloadReport error HTTP ${res.status}`);
    return res.json();
  }, slashDate);

  const referenceId = reportInfo?.reportReferenceId;
  if (!referenceId) {
    throw new Error(`Amazon không trả về reportReferenceId: ${JSON.stringify(reportInfo)}`);
  }
  const reportStartDateTime = String(reportInfo?.reportStartDateTime || "");
  if (!reportStartDateTime.startsWith(slashDate)) {
    throw new Error(`Ngày All Orders không khớp: yêu cầu ${slashDate}, Amazon trả về ${reportStartDateTime || "rỗng"}`);
  }
  console.log(`  [File 02 - All Orders] Reference ID: ${referenceId}. Đang chờ Amazon tạo báo cáo...`);

  // Poll trạng thái báo cáo (tối đa ~3 phút)
  let isDone = false;
  for (let i = 0; i < 36; i++) {
    await page.waitForTimeout(5000);
    const statusResult = await page.evaluate(async (refId) => {
      const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]') as HTMLMetaElement | null;
      const headers: Record<string, string> = meta?.content ? { "anti-csrftoken-a2z": meta.content } : {};
      const res = await fetch("/reportcentral/api/v1/getDownloadReportStatus?referenceIds=" + refId, {
        credentials: "include",
        headers,
      });
      if (!res.ok) return null;
      const list = await res.json();
      return Array.isArray(list) ? list[0] : null;
    }, referenceId);

    if (statusResult === "Done") {
      isDone = true;
      break;
    }
    if (statusResult && statusResult !== "InQueue" && statusResult !== "InProgress") {
      throw new Error(`Báo cáo kết thúc với trạng thái lạ: ${statusResult}`);
    }
  }

  if (!isDone) {
    throw new Error("Báo cáo All Orders chưa hoàn thành sau 3 phút.");
  }

  console.log(`  [File 02 - All Orders] Báo cáo đã xong! Đang tải file TSV...`);
  const downloadUrl = `https://sellercentral.amazon.com/reportcentral/api/v1/downloadFile?referenceId=${referenceId}&fileFormat=TSV`;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    page.goto(downloadUrl).catch((err: any) => {
      if (!String(err?.message || "").includes("ERR_ABORTED")) throw err;
    }),
  ]);

  const targetPath = path.join(downloadDir, `02_AllOrders_${targetDateStr}.tsv`);
  await download.saveAs(targetPath);
  console.log(`  [File 02 - All Orders] ✅ Tải thành công: ${path.basename(targetPath)}`);
  return targetPath;
}

/**
 * Điền ngày chính xác vào web component kat-date-picker của Amazon Payments Event.
 * Khắc phục triệt để lỗi Playwright bắt nhầm thẻ <input hidden="true" name="startDate/endDate">.
 */
async function fillPaymentsDatePicker(page: Page, pickerIndex: number, dateStr: string): Promise<void> {
  const actualValue = await page.evaluate(
    ({ idx, val }) => {
      const pickers = document.querySelectorAll("div.time-range-selection > kat-date-picker");
      const p = pickers[idx - 1] as any;
      if (!p) throw new Error(`Không tìm thấy date picker thứ ${idx}`);
      const katInput = p.shadowRoot?.querySelector("kat-input") || p.querySelector("kat-input");
      const input = katInput?.shadowRoot?.querySelector("input") || katInput?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) throw new Error(`Không tìm thấy input của date picker thứ ${idx}`);

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      setter?.call(input, val);
      for (const eventName of ["input", "change", "blur"]) {
        input.dispatchEvent(new Event(eventName, { bubbles: true, composed: true }));
      }
      return input.value;
    },
    { idx: pickerIndex, val: dateStr }
  );
  if (actualValue !== dateStr) {
    throw new Error(`Date picker ${pickerIndex} không nhận ngày ${dateStr} (giá trị thực tế: ${actualValue || "rỗng"}).`);
  }
}

async function applyPaymentsDateRange(page: Page, dateFromStr: string, dateToStr: string): Promise<void> {
  await fillPaymentsDatePicker(page, 1, dateFromStr);
  await fillPaymentsDatePicker(page, 2, dateToStr);

  const form = page.locator("div.time-range-selection").locator("xpath=ancestor::form[1]");
  const updateButton = form.locator("kat-button").first();
  await updateButton.waitFor({ state: "visible", timeout: 10_000 });
  await updateButton.click({ force: true });

  const nativeSubmit = form.locator("button").first();
  if (await nativeSubmit.isVisible().catch(() => false)) {
    await nativeSubmit.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(6_000);

  const displayedValues = await page.evaluate(() =>
    Array.from(document.querySelectorAll("div.time-range-selection > kat-date-picker")).slice(0, 2).map((picker: any) => {
      const katInput = picker.shadowRoot?.querySelector("kat-input") || picker.querySelector("kat-input");
      const input = katInput?.shadowRoot?.querySelector("input") || katInput?.querySelector("input");
      return input?.value || "";
    })
  );
  if (displayedValues[0] !== dateFromStr || displayedValues[1] !== dateToStr) {
    throw new Error(`Amazon không giữ bộ lọc ngày sau Update: ${displayedValues.join(" → ") || "không đọc được"}.`);
  }
  console.log(`  [Payments] ✅ Đã áp dụng bộ lọc ngày ${dateFromStr} - ${dateToStr}.`);
}

function validatePaymentsCsvDateRange(filePath: string, dateFromStr: string, dateToStr: string): void {
  const parseUsDate = (value: string) => {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : Number.NaN;
  };
  const from = parseUsDate(dateFromStr);
  const to = parseUsDate(dateToStr);
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const invalidDates: string[] = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/^"?([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})"?,/);
    if (!match) continue;
    const value = parseUsDate(match[1]);
    if (!Number.isFinite(value) || value < from || value > to) invalidDates.push(match[1]);
    if (invalidDates.length >= 3) break;
  }
  if (invalidDates.length > 0) {
    fs.unlinkSync(filePath);
    throw new Error(`Amazon xuất dữ liệu ngoài kỳ ${dateFromStr}-${dateToStr}: ${invalidDates.join(", ")}. Đã xóa file sai.`);
  }
}

/** Gỡ bỏ các popup hướng dẫn (Joyride tour) hoặc dialog cản trở click của Amazon */
async function dismissOverlays(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      document.querySelectorAll("#react-joyride-portal, .react-joyride__overlay, .react-joyride__tooltip").forEach((el) => el.remove());
      const closers = document.querySelectorAll<HTMLElement>("button[data-action='close'], button[aria-label='Close'], button[data-action='skip'], [data-testid='modal-close']");
      closers.forEach((c) => c.click());
    });
  } catch {}
}

/**
 * File 03: Return Report
 */
async function downloadFile03Returns(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url =
    "https://sellercentral.amazon.com/payments/event/view?accountType=PAYABLE&eventType=AffordabilityExpenseReversal&eventType=AmazonShippingReimbursement&eventType=FulfillmentFeeRefund&eventType=Refund&eventType=RetrochargeReversal&eventType=PerformanceBondRefund&resultsPerPage=10&pageNumber=1";
  console.log(`  [File 03 - Returns] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  await dismissOverlays(page);

  // Tính 7 ngày gần nhất
  const dateFromStr = formatUsDateFromIso(targetDateStr, 6);
  const dateToStr = formatUsDateFromIso(targetDateStr);

  await applyPaymentsDateRange(page, dateFromStr, dateToStr);

  await dismissOverlays(page);

  const downloadBtn = page.locator("kat-card kat-button:has-text('Download'), kat-button[label='Download'], kat-card button:has-text('Download')").first();
  if (await downloadBtn.isVisible({ timeout: 8000 })) {
    const isDisabled = await downloadBtn.getAttribute("disabled");
    if (isDisabled !== null && isDisabled !== "false") {
      console.log(`  [File 03 - Returns] Không có dữ liệu hoàn hàng (Nút Download bị disable). Tạo file rỗng.`);
      const emptyPath = path.join(downloadDir, `03_Returns_${targetDateStr}.csv`);
      fs.writeFileSync(emptyPath, "Date,Order ID,SKU,Transaction type,Payment Type,Payment Detail,Amount,Quantity\n");
      return emptyPath;
    }

    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        downloadBtn.click({ force: true }),
      ]);

      const targetPath = path.join(downloadDir, `03_Returns_${targetDateStr}.csv`);
      await download.saveAs(targetPath);
      validatePaymentsCsvDateRange(targetPath, dateFromStr, dateToStr);
      console.log(`  [File 03 - Returns] ✅ Tải thành công: ${path.basename(targetPath)}`);
      return targetPath;
    } catch (err: any) {
      throw err;
    }
  }

  throw new Error("Không thấy nút Download Returns sau khi áp dụng bộ lọc ngày.");
}

/**
 * File 04: Service Fees Report
 */
async function downloadFile04ServiceFees(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url =
    "https://sellercentral.amazon.com/payments/event/view?accountType=PAYABLE&eventType=ProductAdsPayment&eventType=SellerDealPayment&eventType=SellerReviewEnrollmentPayment&eventType=SellerCouponPayment&eventType=ServiceFee&eventType=AmazonUpstreamProcessingFee&eventType=AmazonUpstreamStorageTransportationFee&eventType=StorageReservationBilling&eventType=STARStorageBilling&eventType=StandardFeeTransaction&eventType=EPRFeeChargeback&resultsPerPage=10&pageNumber=1";
  console.log(`  [File 04 - Service Fees] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  await dismissOverlays(page);

  const dateFromStr = formatUsDateFromIso(targetDateStr, 6);
  const dateToStr = formatUsDateFromIso(targetDateStr);

  await applyPaymentsDateRange(page, dateFromStr, dateToStr);

  await dismissOverlays(page);

  const downloadBtn = page.locator("kat-card kat-button:has-text('Download'), kat-button[label='Download'], kat-card button:has-text('Download')").first();
  if (await downloadBtn.isVisible({ timeout: 8000 })) {
    const isDisabled = await downloadBtn.getAttribute("disabled");
    if (isDisabled !== null && isDisabled !== "false") {
      console.log(`  [File 04 - Service Fees] Không có dữ liệu phí dịch vụ (Nút Download bị disable). Tạo file rỗng.`);
      const emptyPath = path.join(downloadDir, `04_ServiceFees_${targetDateStr}.csv`);
      fs.writeFileSync(emptyPath, "Date,Transaction type,Payment Type,Payment Detail,Amount\n");
      return emptyPath;
    }

    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        downloadBtn.click({ force: true }),
      ]);

      const targetPath = path.join(downloadDir, `04_ServiceFees_${targetDateStr}.csv`);
      await download.saveAs(targetPath);
      validatePaymentsCsvDateRange(targetPath, dateFromStr, dateToStr);
      console.log(`  [File 04 - Service Fees] ✅ Tải thành công: ${path.basename(targetPath)}`);
      return targetPath;
    } catch (err: any) {
      throw err;
    }
  }

  throw new Error("Không thấy nút Download Service Fees sau khi áp dụng bộ lọc ngày.");
}

/**
 * File 05: Amazon Advertising Portfolios Report (Bám sát chuẩn kế toán)
 * Báo cáo tổng hợp chi phí Ads theo từng danh mục Portfolio cho kế toán (Portfolio, Spend, Sales, ACOS...)
 * Nội dung bắt buộc phải là Portfolios Report từ https://advertising.amazon.com/cm/portfolios
 */
async function downloadFile05Campaigns(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const targetPath = path.join(downloadDir, `05_Campaigns_${targetDateStr}.csv`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  // 1. Nếu File 01 (Portfolios) đã được tải thành công trước đó trong cùng store, tái sử dụng ngay nội dung chuẩn
  const existingPortfolio01 = path.join(downloadDir, `01_Portfolios_${targetDateStr}.csv`);
  if (fs.existsSync(existingPortfolio01)) {
    try {
      const stat = fs.statSync(existingPortfolio01);
      if (stat.size > 200) {
        fs.copyFileSync(existingPortfolio01, targetPath);
        console.log(`  [File 05 - Ads Portfolios] ✅ Tái sử dụng nội dung Portfolios chuẩn từ File 01: ${path.basename(targetPath)}`);
        return targetPath;
      }
    } catch {}
  }

  // 2. Nếu chưa có, truy cập trực tiếp trang Portfolios để tải đúng chuẩn kế toán
  const url = "https://advertising.amazon.com/cm/portfolios";
  console.log(`  [File 05 - Ads Portfolios] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  if (isSignInUrl(page.url())) {
    throw new Error("Trang Amazon Advertising yêu cầu đăng nhập.");
  }

  // Chọn ngày
  const calendarLabel = formatPortfolioCalendarLabel(targetDateStr);
  const datePickerBtn = page.locator('button[data-e2e-id="dateRangePickerButton"]').first();
  await datePickerBtn.waitFor({ state: "visible", timeout: 15000 });
  await datePickerBtn.click();
  const targetDay = page.locator(`td[aria-label*="${calendarLabel}"]:not([aria-disabled="true"])`).first();
  if (await targetDay.isVisible({ timeout: 4000 })) {
    await targetDay.click();
  } else {
    // Thử nút Yesterday nếu không bấm được ngày trực tiếp
    const yest = page.locator('button:has-text("Yesterday"), button[data-e2e-id*="yesterday"]').first();
    if (await yest.isVisible({ timeout: 2000 })) {
      await yest.click();
    }
  }

  const saveDateBtn = page.locator('#AACChromePortal button:has-text("Save")').first();
  await saveDateBtn.waitFor({ state: "visible", timeout: 10000 });
  await saveDateBtn.click();
  await page.waitForTimeout(2500);

  // Chọn 300 kết quả/trang nếu có
  try {
    const dropdownBtn = page.locator('button[data-e2e-id="dropdown"]').first();
    if (await dropdownBtn.isVisible({ timeout: 4000 })) {
      await dropdownBtn.click();
      await page.waitForTimeout(1000);
      const opt300 = page.locator('button[data-e2e-id="dropdownItem"][value="300"]').first();
      if (await opt300.isVisible({ timeout: 3000 })) {
        await opt300.click();
        await page.waitForTimeout(2000);
      }
    }
  } catch {}

  // Bỏ mọi bộ lọc/search còn sót trước khi export
  try {
    const resetBtn = page.locator('button[data-e2e-id="resetButton"]').first();
    if (await resetBtn.isVisible({ timeout: 3000 })) await resetBtn.click();
    const clearSearchBtn = page.locator('#UCM-CM-APP\\:ALL_PORTFOLIOS\\:searchInput + button').first();
    if (await clearSearchBtn.isVisible({ timeout: 2000 })) await clearSearchBtn.click();
    await page.waitForTimeout(1500);
  } catch {}

  // Tìm nút Export
  const exportBtn = page.locator('button[data-e2e-id="export"]').first();
  await exportBtn.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log(`  [File 05 - Ads Portfolios] Đang nhấn nút Export và chờ tải file...`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    exportBtn.click(),
  ]);

  await download.saveAs(targetPath);
  console.log(`  [File 05 - Ads Portfolios] ✅ Tải thành công chuẩn Portfolios: ${path.basename(targetPath)}`);
  return targetPath;
}

/**
 * File 06: FBA Inventory Report (Manage FBA Inventory Health)
 * Nguồn dữ liệu số lượng tồn kho đầu tháng cho Basecost
 */
async function downloadFile06Inventory(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url = "https://sellercentral.amazon.com/reportcentral/MANAGE_INVENTORY_HEALTH/1";
  console.log(`  [File 06 - FBA Inventory] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  // Nút "Request .txt Download"
  const requestBtn = page.locator("#report-page-kat-box kat-button").first();
  if (await requestBtn.isVisible({ timeout: 10000 })) {
    await requestBtn.click();
    console.log(`  [File 06 - FBA Inventory] Đã click 'Request .txt Download'. Đang chờ nút Download...`);
    await page.waitForTimeout(4000);
  }

  // Script cũ chờ tối đa 5 phút để Amazon kết xuất file Inventory.
  const tableDownloadBtn = page.locator("kat-table-body kat-table-row:nth-child(1) kat-button[label='Download']").first();
  await tableDownloadBtn.waitFor({ state: "visible", timeout: 300000 });

  console.log(`  [File 06 - FBA Inventory] Đã thấy nút Download! Đang tải file...`);
  await page.waitForTimeout(2000);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    tableDownloadBtn.click(),
  ]);

  const targetPath = path.join(downloadDir, `06_FbaInventory_${targetDateStr}.txt`);
  await download.saveAs(targetPath);
  console.log(`  [File 06 - FBA Inventory] ✅ Tải thành công: ${path.basename(targetPath)}`);
  return targetPath;
}

/**
 * File 07: Shipment Report (Shipping Queue)
 * Tự động nạp vào bảng CHECK SHIPMENT của Store
 */
async function downloadFile07Shipments(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url = "https://sellercentral.amazon.com/gp/ssof/shipping-queue.html?sc_shipments_redirect=0#fbashipment";
  console.log(`  [File 07 - Shipments] Đang truy cập Shipping Queue: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  // Chọn 100 kết quả/trang bằng thao tác Shadow DOM
  try {
    await page.evaluate(() => {
      const dropdown = document.querySelector("#pagination-dropdown > kat-dropdown");
      if (dropdown && dropdown.shadowRoot) {
        const header = dropdown.shadowRoot.querySelector(".select-header") as HTMLElement | null;
        if (header) header.click();
      }
    });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const dropdown = document.querySelector("#pagination-dropdown > kat-dropdown");
      if (dropdown && dropdown.shadowRoot) {
        const options = dropdown.shadowRoot.querySelectorAll("kat-option");
        for (let i = 0; i < options.length; i++) {
          if (options[i].textContent?.includes("100") || options[i].getAttribute("value") === "100") {
            (options[i] as HTMLElement).click();
            break;
          }
        }
      }
    });
    await page.waitForTimeout(3000);
  } catch { }

  // 3. Kiểm tra Sort Arrow: Đảm bảo sắp xếp giảm dần (arrow-down) để lô hàng MỚI NHẤT luôn ở Trang 1
  try {
    console.log(`  [File 07 - Shipments] Đang kiểm tra chiều sắp xếp (mới nhất lên đầu)...`);
    for (let attempt = 0; attempt < 5; attempt++) {
      const isArrowDown = await page.evaluate(() => {
        const icon = document.querySelector("#toggle-header-icon kat-icon") as HTMLElement | null;
        return icon?.getAttribute("name") === "arrow-down";
      });

      if (isArrowDown) {
        console.log(`  [File 07 - Shipments] Chiều sắp xếp OK: Lô hàng mới nhất ở đầu bảng (arrow-down).`);
        break;
      } else {
        console.log(`  [File 07 - Shipments] Đang click đổi sắp xếp sang mới nhất (arrow-down)...`);
        await page.locator("#toggle-header-container, th[aria-sort='ascending'], th:has-text('Last updated'), th:has-text('Created')").first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }
  } catch (e: any) {
    console.warn(`  [File 07 - Shipments] Bỏ qua kiểm tra Sort Arrow:`, e?.message);
  }

  // 4. Click Export table data (hỗ trợ cả giao diện cũ và mới)
  const exportBtn = page.locator(
    "#export-link-container a kat-link, #export-link-container a, button[aria-label*='Export'], button[aria-label*='download'], [data-testid='export-button']"
  ).first();
  await exportBtn.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log(`  [File 07 - Shipments] Nhấn Export table data và chờ tải file...`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    exportBtn.click(),
  ]);

  const targetPath = path.join(downloadDir, `07_Shipments_${targetDateStr}.csv`);
  await download.saveAs(targetPath);
  console.log(`  [File 07 - Shipments] ✅ Tải thành công: ${path.basename(targetPath)}`);
  return targetPath;
}

/**
 * File 08: Distribution Center (AWD) Shipments Report
 * URL: https://sellercentral.amazon.com/amazonsell/dc-shipments?orderBy=UPDATE_TIME&isOrderAscending=false&pageSize=100&pageIndex=0
 */
export async function downloadFile08DcShipments(page: Page, downloadDir: string, targetDateStr: string): Promise<string | null> {
  const url = "https://sellercentral.amazon.com/amazonsell/dc-shipments?orderBy=UPDATE_TIME&isOrderAscending=false&pageSize=100&pageIndex=0";
  console.log(`  [File 08 - DC Shipments] Đang truy cập Distribution Center Shipments: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);

  if (isSignInUrl(page.url())) {
    throw new Error("Seller Central chưa đăng nhập.");
  }

  console.log(`  [File 08 - DC Shipments] Đang chờ nút Export/Download hoặc trạng thái không có dữ liệu...`);

  // Không dùng selector chung như "button" để kết luận trang đã tải xong: thanh điều
  // hướng luôn có button và từng khiến crawler bỏ qua báo cáo khi bảng AWD tải chậm.
  const exportSelector = [
    "button[data-tag='protos-table-export-button']",
    "button[aria-label*='Export' i]",
    "button[aria-label*='Download' i]",
    "button[title*='Export' i]",
    "button[title*='Download' i]",
  ].join(", ");
  const explicitEmptyPattern = /^(no shipments(?: found)?|no data(?: available)?|no records(?: found)?|you (?:do not|don't) have any (?:awd )?shipments)[.!]?$/i;
  const deadline = Date.now() + 45_000;
  let exportBtn = page.locator(exportSelector).first();
  let btnFound = false;
  let hasExplicitEmptyState = false;

  while (Date.now() < deadline) {
    if (isSignInUrl(page.url())) throw new Error("Seller Central chưa đăng nhập.");
    btnFound = await exportBtn.isVisible().catch(() => false);
    if (btnFound) break;

    hasExplicitEmptyState = await page.locator("main, [role='main'], body").first().evaluate(
      (root, patternSource) => {
        const pattern = new RegExp(patternSource, "i");
        return Array.from(root.querySelectorAll("p, span, div, td")).some((element) => {
          const htmlElement = element as HTMLElement;
          const text = (htmlElement.innerText || "").replace(/\s+/g, " ").trim();
          if (!pattern.test(text)) return false;
          const style = window.getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
      },
      explicitEmptyPattern.source,
    ).catch(() => false);
    if (hasExplicitEmptyState) break;
    await page.waitForTimeout(1500);
  }

  if (!btnFound && hasExplicitEmptyState) {
    console.warn(`  [File 08 - DC Shipments] Amazon xác nhận không có dữ liệu AWD; bỏ qua hợp lệ.`);
    return null;
  }

  if (!btnFound) {
    const evidencePath = path.join(downloadDir, `08_DcShipments_${targetDateStr}_export_missing_${Date.now()}.png`);
    await page.screenshot({ path: evidencePath, fullPage: true }).catch(() => {});
    throw new Error(`Trang AWD đã mở nhưng nút Export chưa xuất hiện sau 45 giây. Ảnh kiểm tra: ${evidencePath}`);
  }

  console.log(`  [File 08 - DC Shipments] Nhấn nút Export và chờ tải file...`);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    exportBtn.click(),
  ]);

  const targetPath = path.join(downloadDir, `08_DcShipments_${targetDateStr}.csv`);
  await download.saveAs(targetPath);
  console.log(`  [File 08 - DC Shipments] ✅ Tải thành công: ${path.basename(targetPath)}`);
  return targetPath;
}

// ============================================================================
// BÓC TÁCH DỮ LIỆU & NẠP VÀO DATABASE WEB APP
// ============================================================================

export async function parseAndIngestShipmentFile(filePath: string, store: StoreTarget): Promise<number> {
  const webAppUrl = process.env.WEB_APP_URL || "https://ncehub.net";
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return 0;
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp Shipment.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - Check Shipment] Đang đọc file: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const content = fs.readFileSync(filePath, "utf8");

  const formData = new FormData();
  const blob = new Blob([content], { type: "text/csv" });
  formData.append("file", blob, path.basename(filePath));
  formData.append("type", "check_shipment");
  formData.append("store_id", storeId);

  const res = await fetch(`${webAppUrl.replace(/\/$/, "")}/api/accounting/inventory/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API import Check Shipment lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText) as {
    count?: number; created_count?: number; updated_count?: number; total_errors?: number; errors?: string[];
  };
  if ((data.total_errors || 0) > 0) {
    throw new Error(`Import Check Shipment có ${data.total_errors} dòng lỗi: ${(data.errors || []).join("; ")}`);
  }
  console.log(`  [Ingest - Check Shipment] ✅ ${store.store_name}: tạo ${data.created_count || 0}, cập nhật ${data.updated_count || 0}, tổng ${data.count || 0}.`);
  return data.count || 0;
}

export async function parseAndIngestOrderFile(filePath: string, store: StoreTarget): Promise<number> {
  const webAppUrl = process.env.WEB_APP_URL || "https://ncehub.net";
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return 0;
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp Đơn hàng.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - All Orders] Đang đọc file: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const content = fs.readFileSync(filePath, "utf8");

  const formData = new FormData();
  const blob = new Blob([content], { type: "text/tab-separated-values" });
  formData.append("file", blob, path.basename(filePath));
  formData.append("store_id", storeId);
  const reportDate = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!reportDate) throw new Error(`Không xác định được ngày báo cáo từ tên file ${path.basename(filePath)}.`);
  formData.append("coverage_start", reportDate);
  formData.append("coverage_end", reportDate);

  const res = await fetch(`${webAppUrl.replace(/\/$/, "")}/api/accounting/orders/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API import Orders lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText) as {
    success?: boolean; processed?: number; totalParsed?: number; message?: string;
  };
  console.log(`  [Ingest - All Orders] ✅ ${store.store_name}: nạp thành công ${data.processed || 0} / ${data.totalParsed || 0} đơn hàng.`);
  return data.processed || 0;
}

export async function parseAndIngestAdsFile(filePath: string, store: StoreTarget): Promise<number> {
  const webAppUrl = process.env.WEB_APP_URL || "https://ncehub.net";
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return 0;
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp Ads.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - Ads] Đang đọc file: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const fileBuffer = fs.readFileSync(filePath);
  const isXlsx = filePath.endsWith(".xlsx");

  const formData = new FormData();
  const blob = new Blob([fileBuffer], {
    type: isXlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  });
  formData.append("file", blob, path.basename(filePath));
  formData.append("store_id", storeId);
  const reportDate = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!reportDate) throw new Error(`Không xác định được ngày báo cáo từ tên file ${path.basename(filePath)}.`);
  formData.append("coverage_start", reportDate);
  formData.append("coverage_end", reportDate);

  const res = await fetch(`${webAppUrl.replace(/\/$/, "")}/api/accounting/ads/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API import Ads lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText) as {
    success?: boolean; processed?: number; totalParsed?: number; message?: string;
  };
  console.log(`  [Ingest - Ads] ✅ ${store.store_name}: nạp thành công ${data.processed || 0} / ${data.totalParsed || 0} dòng chi phí Ads.`);
  return data.processed || 0;
}

export async function parseAndIngestReturnsFile(filePath: string, store: StoreTarget): Promise<number> {
  const webAppUrl = process.env.WEB_APP_URL || "https://ncehub.net";
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return 0;
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp Returns.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - Returns] Đang đọc file: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const fileBuffer = fs.readFileSync(filePath);
  const isXlsx = filePath.endsWith(".xlsx");

  const formData = new FormData();
  const blob = new Blob([fileBuffer], {
    type: isXlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  });
  formData.append("file", blob, path.basename(filePath));
  formData.append("store_id", storeId);
  const reportDate = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!reportDate) throw new Error(`Không xác định được ngày báo cáo từ tên file ${path.basename(filePath)}.`);
  formData.append("coverage_start", subtractIsoDays(reportDate, 6));
  formData.append("coverage_end", reportDate);

  const res = await fetch(`${webAppUrl.replace(/\/$/, "")}/api/accounting/returns/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API import Returns lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText) as {
    success?: boolean; processed?: number; totalParsed?: number; message?: string;
  };
  console.log(`  [Ingest - Returns] ✅ ${store.store_name}: nạp thành công ${data.processed || 0} / ${data.totalParsed || 0} dòng Returns.`);
  return data.processed || 0;
}

export async function parseAndIngestServiceFeesFile(filePath: string, store: StoreTarget): Promise<number> {
  const webAppUrl = process.env.WEB_APP_URL || "https://ncehub.net";
  const authToken = process.env.WEB_APP_AUTH_TOKEN?.trim();
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return 0;
  if (!authToken) throw new Error("Thiếu WEB_APP_AUTH_TOKEN; không thể nạp Service Fees.");

  const storeId = await resolveVerifiedStoreId(store);

  console.log(`  [Ingest - Service Fees] Đang đọc file: ${path.basename(filePath)} → ${store.store_name} (${storeId})...`);
  const fileBuffer = fs.readFileSync(filePath);
  const isXlsx = filePath.endsWith(".xlsx");

  const formData = new FormData();
  const blob = new Blob([fileBuffer], {
    type: isXlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  });
  formData.append("file", blob, path.basename(filePath));
  formData.append("store_id", storeId);

  const res = await fetch(`${webAppUrl.replace(/\/$/, "")}/api/accounting/service-fees/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`API import Service Fees lỗi HTTP ${res.status}: ${responseText.slice(0, 500)}`);
  }
  const data = JSON.parse(responseText) as {
    success?: boolean; processed?: number; totalParsed?: number; message?: string;
  };
  console.log(`  [Ingest - Service Fees] ✅ ${store.store_name}: nạp thành công ${data.processed || 0} / ${data.totalParsed || 0} dòng Service Fees.`);
  return data.processed || 0;
}

// ============================================================================
// HÀM CHÍNH: CRAWL KẾ TOÁN CHO TỪNG STORE
// ============================================================================

export async function crawlAccountingForStore(
  store: StoreTarget,
  targetDateStr: string,
): Promise<AccountingFilesResult> {
  const storeDownloadDir = path.join(ACCOUNTING_DOWNLOAD_DIR, targetDateStr, store.store_name);
  fs.mkdirSync(storeDownloadDir, { recursive: true });

  const result: AccountingFilesResult = {
    storeName: store.store_name,
    targetDate: targetDateStr,
    files: {},
    errors: [],
    skipped: [],
  };

  console.log(`\n============================================================`);
  console.log(`>>> BẮT ĐẦU TẢI BÁO CÁO KẾ TOÁN: [${store.store_name}]`);
  console.log(`    Profile ID: ${store.profile_id}`);
  console.log(`    Thư mục lưu trữ: ${storeDownloadDir}`);
  console.log(`============================================================`);

  let cdpEndpoint: string | null = null;
  let browser: any = null;

  try {
    cdpEndpoint = await startAdsPowerProfile(store.profile_id);
    browser = await chromium.connectOverCDP(cdpEndpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Không tìm thấy browser context.");

    let page = context.pages()[0];
    if (!page) page = await context.newPage();

    const finalErrors = new Map<AccountingFileKey, string>();
    const supplementalErrors: string[] = [];
    const noDataTasks = new Set<AccountingFileKey>();
    let historicalOrdersDone = false;
    const tasks: AccountingDownloadTask[] = [
      {
        key: "file01_portfolios",
        label: "File 01 - Portfolios",
        filePrefix: "01_Portfolios_",
        download: () => downloadFile01Portfolios(page, storeDownloadDir, targetDateStr),
      },
      {
        key: "file02_all_orders",
        label: "File 02 - All Orders",
        filePrefix: "02_AllOrders_",
        download: () => downloadFile02AllOrders(page, storeDownloadDir, targetDateStr),
        afterSuccess: async () => {
          const orderPath = result.files.file02_all_orders;
          if (orderPath) {
            try {
              await parseAndIngestOrderFile(orderPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 02 - All Orders] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
          if (historicalOrdersDone) return;
          historicalOrdersDone = true;
          // Amazon có thể sửa status/discount/quantity sau ngày phát sinh. Làm mới
          // liên tục 14 ngày gần nhất để không bỏ lọt các ngày nằm giữa.
          for (const daysAgo of Array.from({ length: 14 }, (_, index) => index + 1)) {
            const historicalDate = subtractIsoDays(targetDateStr, daysAgo);
            const existingHistorical = findExistingValidReportFile(storeDownloadDir, "02_AllOrders_", historicalDate);
            const historical = await downloadWithRetry(
              `File 02 lịch sử (${historicalDate})`,
              () => downloadFile02AllOrders(page, storeDownloadDir, historicalDate),
              MAX_HISTORICAL_ORDER_RETRIES,
            );
            if (historical.path) {
              try {
                await parseAndIngestOrderFile(historical.path, store);
              } catch (err: any) {
                supplementalErrors.push(`File 02 lịch sử (${historicalDate}) ingest: ${err?.message}`);
              }
            } else if (existingHistorical) {
              // Chỉ dùng file cũ làm phương án dự phòng; bình thường phải tải lại để
              // nhận các sửa đổi muộn từ Amazon.
              try {
                await parseAndIngestOrderFile(existingHistorical, store);
                console.warn(`  ⚠️ [File 02 lịch sử (${historicalDate})] Dùng file dự phòng trên máy.`);
              } catch (err: any) {
                supplementalErrors.push(`File 02 lịch sử (${historicalDate}) ingest fallback: ${err?.message}`);
              }
            } else {
              supplementalErrors.push(`File 02 lịch sử (${historicalDate}): ${historical.error}`);
            }
          }
        },
      },
      {
        key: "file03_returns",
        label: "File 03 - Returns",
        filePrefix: "03_Returns_",
        download: () => downloadFile03Returns(page, storeDownloadDir, targetDateStr),
        afterSuccess: async () => {
          const returnsPath = result.files.file03_returns;
          if (returnsPath) {
            try {
              await parseAndIngestReturnsFile(returnsPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 03 - Returns] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
        },
      },
      {
        key: "file04_service_fees",
        label: "File 04 - Service Fees",
        filePrefix: "04_ServiceFees_",
        download: () => downloadFile04ServiceFees(page, storeDownloadDir, targetDateStr),
        afterSuccess: async () => {
          const serviceFeesPath = result.files.file04_service_fees;
          if (serviceFeesPath) {
            try {
              await parseAndIngestServiceFeesFile(serviceFeesPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 04 - Service Fees] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
        },
      },
      {
        key: "file05_campaigns",
        label: "File 05 - Campaigns",
        filePrefix: "05_Campaigns_",
        download: () => downloadFile05Campaigns(page, storeDownloadDir, targetDateStr),
        afterSuccess: async () => {
          const campaignsPath = result.files.file05_campaigns;
          if (campaignsPath) {
            try {
              await parseAndIngestAdsFile(campaignsPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 05 - Campaigns] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
        },
      },
      {
        key: "file06_inventory",
        label: "File 06 - FBA Inventory",
        filePrefix: "06_FbaInventory_",
        download: () => downloadFile06Inventory(page, storeDownloadDir, targetDateStr),
      },
      {
        key: "file07_shipments",
        label: "File 07 - Shipments",
        filePrefix: "07_Shipments_",
        download: () => downloadFile07Shipments(page, storeDownloadDir, targetDateStr),
        afterSuccess: async () => {
          const shipmentPath = result.files.file07_shipments;
          if (shipmentPath) {
            try {
              await parseAndIngestShipmentFile(shipmentPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 07 - Shipments] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
        },
      },
      {
        key: "file08_dc_shipments",
        label: "File 08 - DC Shipments (AWD)",
        filePrefix: "08_DcShipments_",
        download: () => downloadFile08DcShipments(page, storeDownloadDir, targetDateStr),
        allowNoData: true,
        afterSuccess: async () => {
          const dcShipmentPath = result.files.file08_dc_shipments;
          if (dcShipmentPath) {
            try {
              await parseAndIngestShipmentFile(dcShipmentPath, store);
            } catch (err: any) {
              console.warn(`  ⚠️ [File 08 - DC Shipments] Tạm thời chưa nạp tự động vào Web App (${err?.message}). File đã tải an toàn trên máy.`);
            }
          }
        },
      },
    ];

    const runTask = async (task: AccountingDownloadTask) => {
      // Tối ưu: Nếu file của ngày này đã tồn tại hợp lệ trên máy và không ép cào lại, dùng luôn file có sẵn
      if (process.env.FORCE_DOWNLOAD !== "true" && task.filePrefix) {
        const existingFile = findExistingValidReportFile(storeDownloadDir, task.filePrefix, targetDateStr);
        if (existingFile) {
          console.log(`  [${task.label}] ⚡ Đã có file hợp lệ trên máy: ${path.basename(existingFile)} (bỏ qua cào lại).`);
          result.files[task.key] = existingFile;
          finalErrors.delete(task.key);
          if (task.afterSuccess) {
            try {
              await task.afterSuccess();
            } catch (err: any) {
              console.warn(`  ⚠️ [${task.label}] Lỗi afterSuccess: ${err?.message}`);
            }
          }
          return;
        }
      }

      const downloadWithSessionRecovery = async () => {
        try {
          return await task.download();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const sessionExpired = isSignInUrl(page.url()) || /chưa đăng nhập|sign-in|signin/i.test(message);
          if (!sessionExpired) throw error;

          await ensureAmazonSession(page, store.store_name);
          console.log(`  [${task.label}] Thử lại ngay sau khi khôi phục phiên thành công...`);
          return task.download();
        }
      };
      const downloaded = await downloadWithRetry(task.label, downloadWithSessionRecovery, MAX_TASK_RETRIES, Boolean(task.allowNoData));
      if (downloaded.noData) {
        noDataTasks.add(task.key);
        finalErrors.delete(task.key);
        if (!result.skipped.includes(task.label)) result.skipped.push(task.label);
        console.log(`  ℹ️ [${task.label}] Không có dữ liệu/nút Export cho store này; bỏ qua hợp lệ.`);
        return;
      }
      if (!downloaded.path) {
        finalErrors.set(task.key, `${task.label}: ${downloaded.error}`);
        return;
      }
      result.files[task.key] = downloaded.path;
      noDataTasks.delete(task.key);
      result.skipped = result.skipped.filter((label) => label !== task.label);
      finalErrors.delete(task.key);
      try {
        await task.afterSuccess?.();
      } catch (error) {
        // Import Shipment thất bại phải được retry như một task lỗi; không được
        // báo download thành công rồi bỏ qua dữ liệu chưa vào đúng bảng/store.
        result.files[task.key] = null;
        const message = error instanceof Error ? error.message : String(error);
        finalErrors.set(task.key, `${task.label}: ${message}`);
        console.error(`  ❌ [${task.label}] Hậu xử lý thất bại: ${message}`);
      }
    };

    // Lượt tải ban đầu: mỗi file được thử tối đa 5 lần như script KETOAN cũ.
    for (const task of tasks) await runTask(task);

    // Sau đó chỉ chạy lại các file còn thiếu. Logic cũ kiểm tra tối đa 3 vòng;
    // vòng thứ ba là lần chốt lỗi, nên có hai lượt tải bổ sung thực tế.
    for (let check = 1; check <= MAX_MISSING_FILE_CHECKS; check++) {
      // Script cũ kiểm tra file thật trên ổ đĩa, không chỉ dựa vào trạng thái trong RAM.
      const missingTasks = tasks.filter((task) => !noDataTasks.has(task.key) && !isDownloadedFileValid(result.files[task.key]));
      if (missingTasks.length === 0) break;
      if (check === MAX_MISSING_FILE_CHECKS) {
        console.error(`  ⛔ Còn thiếu sau ${MAX_MISSING_FILE_CHECKS} vòng kiểm tra: ${missingTasks.map((task) => task.label).join(", ")}`);
        break;
      }
      console.warn(`  🔄 Vòng tải lại ${check}/${MAX_MISSING_FILE_CHECKS}: ${missingTasks.map((task) => task.label).join(", ")}`);
      for (const task of missingTasks) await runTask(task);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }

    result.errors.push(...finalErrors.values(), ...supplementalErrors);

  } finally {
    // ĐẢM BẢO 100% ĐÓNG TRÌNH DUYỆT VÀ PROFILE NGAY ĐỂ KHÔNG ĐẦY RAM
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopAdsPowerProfile(store.profile_id);
  }

  return result;
}

// ============================================================================
// HÀM CHẠY TOÀN BỘ STORE (CHẠY TUẦN TỰ AN TOÀN RAM)
// ============================================================================

export async function runAccountingPipeline(specificStoreName?: string, customDate?: string): Promise<void> {
  const releaseLock = acquireAccountingLock();
  
  // Giữ nguyên quy tắc thời điểm của KETOAN cũ, theo giờ Việt Nam.
  const targetDateStr = customDate || getLegacyAccountingTargetDate();

  console.log(`\n============================================================`);
  console.log(`[ACCOUNTING CRAWLER] BẮT ĐẦU TIẾN TRÌNH TẢI BÁO CÁO KẾ TOÁN`);
  console.log(`Ngày báo cáo (chốt sổ): ${targetDateStr}`);
  console.log(`Thư mục lưu trữ: ${ACCOUNTING_DOWNLOAD_DIR}`);
  console.log(`============================================================`);

  const allStores = getStoreList();
  const storesToRun = specificStoreName
    ? allStores.filter((s) => s.store_name.toLowerCase() === specificStoreName.toLowerCase())
    : allStores;

  if (storesToRun.length === 0) {
    console.error(`[Lỗi] Không tìm thấy store nào phù hợp.`);
    releaseLock();
    return;
  }

  await sendTelegramMessage(
    `🚀 <b>[Accounting Crawler] Bắt đầu tải báo cáo Kế Toán hàng ngày</b>\n` +
    `• Ngày: <code>${targetDateStr}</code>\n` +
    `• Số lượng store: <b>${storesToRun.length}</b> (${storesToRun.map((s) => s.store_name).join(", ")})`
  );

  const overallResults: AccountingFilesResult[] = [];

  try {
    for (const store of storesToRun) {
      try {
        const res = await crawlAccountingForStore(store, targetDateStr);
        overallResults.push(res);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[${store.store_name}] Lỗi cấp store; tiếp tục store tiếp theo: ${message}`);
        overallResults.push({
          storeName: store.store_name,
          targetDate: targetDateStr,
          files: {},
          errors: [`Lỗi cấp store: ${message}`],
          skipped: [],
        });
      }
      // Chờ 3 giây trước khi chuyển store tiếp theo
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Tổng hợp báo cáo Telegram
    let summaryMsg = `✅ <b>[Accounting Crawler] Hoàn tất tải báo cáo Kế Toán</b>\n• Ngày: <code>${targetDateStr}</code>\n\n`;
    for (const r of overallResults) {
      const successCount = Object.values(r.files).filter(Boolean).length;
      summaryMsg += `🏪 <b>${r.storeName}</b>: ${successCount}/${ACCOUNTING_TASK_COUNT} file thành công\n`;
      if (r.skipped.length > 0) {
        summaryMsg += `   ℹ️ Không áp dụng: ${r.skipped.join(", ")}\n`;
      }
      if (r.errors.length > 0) {
        summaryMsg += `  ⚠️ Lỗi: ${r.errors.join("; ")}\n`;
      }
    }

    await sendTelegramMessage(summaryMsg);
    if (overallResults.some((result) => result.errors.length > 0)) {
      throw new Error("Accounting crawler hoàn tất một phần; xem Telegram/log để biết store hoặc file lỗi.");
    }
  } catch (err) {
    console.error(`[CRITICAL] Lỗi nghiêm trọng trong Accounting Pipeline: ${(err as Error).message}`);
    await sendTelegramMessage(`💥 <b>[Accounting Crawler] Gặp lỗi nghiêm trọng</b>: ${(err as Error).message}`);
  } finally {
    releaseLock();
    console.log(`[ACCOUNTING CRAWLER] Đã giải phóng lock và kết thúc phiên làm việc.`);
  }
}

// Nếu chạy trực tiếp từ dòng lệnh: tsx accounting_crawler.ts [--store=NAME] [--date=YYYY-MM-DD]
if (require.main === module) {
  const storeArg = process.argv.find((arg) => arg.startsWith("--store="))?.split("=")[1];
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1];
  runAccountingPipeline(storeArg, dateArg).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
