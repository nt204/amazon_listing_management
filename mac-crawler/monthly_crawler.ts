import { chromium, type BrowserContext, type Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sendTelegramMessage } from "./telegram";
import {
  loadEnv,
  getStoreList,
  startAdsPowerProfile,
  stopAdsPowerProfile,
} from "./accounting_crawler";
import { ensureAmazonSession } from "./amazon_auth";

loadEnv();

const execFileAsync = promisify(execFile);

const safeAccountingDownloadDir = path.join(os.homedir(), "AmazonAccounting", "downloads");
const ACCOUNTING_DOWNLOAD_DIR = process.env.ACCOUNTING_DOWNLOAD_DIR || safeAccountingDownloadDir;

// Lock file riêng cho Monthly Crawler để không trùng lặp và không ảnh hưởng luồng ngày
const MONTHLY_LOCK_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AmazonAccounting",
  "monthly_run.lock",
);

function acquireMonthlyLock(): () => void {
  fs.mkdirSync(path.dirname(MONTHLY_LOCK_PATH), { recursive: true });
  try {
    const fd = fs.openSync(MONTHLY_LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String((error as any).code) : "";
    if (errorCode !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(MONTHLY_LOCK_PATH, "utf8").split(/\s+/)[0]);
    try {
      process.kill(pid, 0);
      throw new Error(`Monthly crawler đang chạy với PID ${pid}. Huỷ tiến trình để tránh xung đột.`);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        console.warn(`[Lock] Lock cũ của PID ${pid} không còn sống. Gỡ lock cũ.`);
        fs.unlinkSync(MONTHLY_LOCK_PATH);
        return acquireMonthlyLock();
      }
      throw err;
    }
  }

  return () => {
    try {
      if (fs.existsSync(MONTHLY_LOCK_PATH)) {
        fs.unlinkSync(MONTHLY_LOCK_PATH);
      }
    } catch {}
  };
}

function isSignInUrl(url: string): boolean {
  return /signin|sign-in|ap\/signin/i.test(url);
}

async function withSessionRecovery<T>(
  taskLabel: string,
  page: Page,
  storeName: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error?.message || String(error);
    const sessionExpired =
      isSignInUrl(page.url()) ||
      /chưa đăng nhập|sign-in|signin|session expired|anti-csrftoken/i.test(msg);
    if (!sessionExpired) throw error;

    console.warn(`  [${taskLabel}] ⚠️ Phát hiện mất phiên hoặc yêu cầu đăng nhập (${msg}). Tự động đăng nhập qua ensureAmazonSession...`);
    await ensureAmazonSession(page, storeName);
    console.log(`  [${taskLabel}] Đã khôi phục phiên thành công. Thử lại thao tác...`);
    return await fn();
  }
}

/** Lấy chuỗi YYYY-MM của tháng trước */
export function getLastMonthStr(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/** Tính ngày bắt đầu và kết thúc dạng YYYY/MM/01 và YYYY/MM/30-31 cho Amazon API */
export function getMonthDateRange(monthStr: string): { startSlash: string; endSlash: string; lastDay: number } {
  const [year, month] = monthStr.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  const dd = String(lastDay).padStart(2, "0");
  return {
    startSlash: `${year}/${mm}/01`,
    endSlash: `${year}/${mm}/${dd}`,
    lastDay,
  };
}

// Cấu hình các báo cáo ReportCentral tháng
interface ReportCentralConfig {
  code: string;
  name: string;
  frpId: string;
  pageUrl: string;
  fileFormat: "CSV" | "TSV";
  ext: string;
}

const ADDITIONAL_MONTHLY_REPORTS: ReportCentralConfig[] = [
  {
    code: "11_RemovalOrderDetail",
    name: "Chi tiết đơn tiêu hủy/rút hàng (Removal Order)",
    frpId: "2660",
    pageUrl: "https://sellercentral.amazon.com/reportcentral/REMOVAL_ORDER_DETAIL/1",
    fileFormat: "CSV",
    ext: "csv",
  },
  {
    code: "12_InboundPlacementFees",
    name: "Phí đặt hàng nhập kho (Inbound Placement Fees)",
    frpId: "16800",
    pageUrl: "https://sellercentral.amazon.com/reportcentral/INBOUND_PLACEMENT_FEES_CHARGES/1",
    fileFormat: "CSV",
    ext: "csv",
  },
  {
    code: "13_LongTermStorageFees",
    name: "Phí lưu kho dài hạn (Long-Term Storage Fees)",
    frpId: "2615",
    pageUrl: "https://sellercentral.amazon.com/reportcentral/LONGTERM_STORAGE_FEE_CHARGES/1",
    fileFormat: "CSV",
    ext: "csv",
  },
  {
    code: "14_MonthlyStorageFees",
    name: "Phí lưu kho hằng tháng (Monthly Storage Fees)",
    frpId: "2673",
    pageUrl: "https://sellercentral.amazon.com/reportcentral/STORAGE_FEE_CHARGES/1",
    fileFormat: "CSV",
    ext: "csv",
  },
];

/** Tải File 01: Ads Portfolios cho kỳ báo cáo tháng */
async function downloadMonthlyPortfolios(
  page: Page,
  downloadDir: string,
  targetMonth: string,
  isPreviousMonth: boolean,
  storeName?: string,
): Promise<string> {
  const targetPath = path.join(downloadDir, `01_Portfolios_${targetMonth}.csv`);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 500) {
    console.log(`  [Ads Portfolios Tháng] File đã tồn tại: ${path.basename(targetPath)} (${fs.statSync(targetPath).size} bytes). Bỏ qua.`);
    return targetPath;
  }

  const url = "https://advertising.amazon.com/cm/portfolios";
  console.log(`  [Ads Portfolios Tháng] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  if (isSignInUrl(page.url())) {
    if (storeName) {
      console.log(`  [Ads Portfolios Tháng] Phát hiện trang đăng nhập. Gọi ensureAmazonSession...`);
      await ensureAmazonSession(page, storeName);
      if (!page.url().includes("/cm/portfolios")) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3500);
      }
    }
    if (isSignInUrl(page.url())) {
      throw new Error("Trang Amazon Advertising yêu cầu đăng nhập.");
    }
  }

  const datePickerBtn = page.locator('button[data-e2e-id="dateRangePickerButton"]').first();
  await datePickerBtn.waitFor({ state: "visible", timeout: 15000 });
  const currentRangeText = (await datePickerBtn.textContent()) || "";
  console.log(`  [Ads Portfolios Tháng] Trạng thái bộ lọc hiện tại: "${currentRangeText.trim()}"`);

  if (isPreviousMonth) {
    await datePickerBtn.click();
    await page.waitForTimeout(1500);

    const lastMonthBtn = page.locator('#AACChromePortal button:has-text("Last month")').first();
    if (await lastMonthBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log("  [Ads Portfolios Tháng] Đang chọn preset 'Last month'...");
      await lastMonthBtn.click();
      await page.waitForTimeout(1500);
    } else {
      console.warn("  [Ads Portfolios Tháng] Không tìm thấy nút preset 'Last month'.");
    }

    const saveBtn = page.locator('#AACChromePortal button:has-text("Save")').first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
    }
  }

  console.log(`  [Ads Portfolios Tháng] Bộ lọc sau khi áp dụng: "${(await datePickerBtn.textContent())?.trim()}"`);

  // Chọn 300 dòng hiển thị
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

  // Reset filter nếu có
  try {
    const resetBtn = page.locator('button[data-e2e-id="resetButton"]').first();
    if (await resetBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await resetBtn.evaluate((el: HTMLElement) => el.click());
      console.log("  [Ads Portfolios Tháng] Đã click nút Reset filter.");
      await page.waitForTimeout(2500);
    }
  } catch {}

  // Click Export
  const exportBtn = page.locator('button[data-e2e-id="export"]').first();
  await exportBtn.waitFor({ state: "visible", timeout: 20000 });
  console.log("  [Ads Portfolios Tháng] Chờ 10s trước khi Export để bảng dữ liệu ổn định...");
  await page.waitForTimeout(10000);

  console.log("  [Ads Portfolios Tháng] Đang nhấn nút Export và chờ tải file CSV...");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45000 }),
    exportBtn.evaluate((el: HTMLElement) => el.click()).catch(() => exportBtn.click()),
  ]);

  await download.saveAs(targetPath);
  console.log(`  [Ads Portfolios Tháng] ✅ Tải thành công: ${path.basename(targetPath)} (${fs.statSync(targetPath).size} bytes)`);

  // Tạo thêm bản sao 05_Campaigns_${month}.csv đồng bộ chuẩn kế toán
  const file05Path = path.join(downloadDir, `05_Campaigns_${targetMonth}.csv`);
  fs.copyFileSync(targetPath, file05Path);
  console.log(`  [Ads Chi Phí Tháng] ✅ Đã tạo bản sao: ${path.basename(file05Path)}`);

  return targetPath;
}

/** Tải File 02: All Orders tháng qua ReportCentral API */
async function downloadMonthlyOrders(
  page: Page,
  downloadDir: string,
  targetMonth: string,
  storeName?: string,
): Promise<string> {
  const targetPath = path.join(downloadDir, `02_AllOrders_${targetMonth}.tsv`);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 500) {
    console.log(`  [All Orders Tháng] File đã tồn tại: ${path.basename(targetPath)} (${fs.statSync(targetPath).size} bytes). Bỏ qua.`);
    return targetPath;
  }

  const { startSlash, endSlash } = getMonthDateRange(targetMonth);
  const url = "https://sellercentral.amazon.com/reportcentral/FlatFileAllOrdersReport/1";
  console.log(`  [All Orders Tháng] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);

  if (isSignInUrl(page.url())) {
    if (storeName) {
      console.log(`  [All Orders Tháng] Phát hiện trang đăng nhập. Gọi ensureAmazonSession...`);
      await ensureAmazonSession(page, storeName);
      if (!page.url().includes("FlatFileAllOrdersReport")) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3500);
      }
    }
    if (isSignInUrl(page.url())) {
      throw new Error("Seller Central chưa đăng nhập (đang ở màn hình Sign-In).");
    }
  }

  console.log(`  [All Orders Tháng] Gửi yêu cầu API báo cáo tháng từ ${startSlash} đến ${endSlash}...`);
  const reportInfo = await page.evaluate(
    async ({ startRep, endRep }) => {
      const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]') as HTMLMetaElement | null;
      if (!meta) throw new Error("Không tìm thấy anti-csrftoken-a2z trên trang Amazon (cần đăng nhập Seller Central)");
      const qs =
        "reportFileFormat=TSV&reportStartDate=" +
        encodeURIComponent(startRep) +
        "&reportEndDate=" +
        encodeURIComponent(endRep) +
        "&xdaysBeforeUntilToday=-1&startDateTimeOffset=0&endDateTimeOffset=0" +
        "&specialDateOptions=&reportFRPId=2400&language=&disableTimezone=true";
      const res = await fetch("/reportcentral/api/v1/submitDownloadReport?" + qs, {
        method: "POST",
        credentials: "include",
        headers: { "anti-csrftoken-a2z": meta.content },
      });
      if (!res.ok) throw new Error(`submitDownloadReport error HTTP ${res.status}`);
      return res.json();
    },
    { startRep: startSlash, endRep: endSlash }
  );

  const referenceId = reportInfo?.reportReferenceId;
  if (!referenceId) {
    throw new Error(`Amazon không trả về reportReferenceId: ${JSON.stringify(reportInfo)}`);
  }
  console.log(`  [All Orders Tháng] Reference ID: ${referenceId}. Đang chờ Amazon tạo báo cáo tháng...`);

  let isDone = false;
  for (let i = 0; i < 48; i++) {
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
    throw new Error("Báo cáo All Orders tháng chưa hoàn thành sau 4 phút.");
  }

  console.log(`  [All Orders Tháng] Báo cáo đã xong! Đang tải file TSV...`);
  const downloadUrl = `https://sellercentral.amazon.com/reportcentral/api/v1/downloadFile?referenceId=${referenceId}&fileFormat=TSV`;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    page.goto(downloadUrl).catch((err: any) => {
      if (!String(err?.message || "").includes("ERR_ABORTED")) throw err;
    }),
  ]);

  await download.saveAs(targetPath);
  console.log(`  [All Orders Tháng] ✅ Tải thành công: ${path.basename(targetPath)} (${fs.statSync(targetPath).size} bytes)`);
  return targetPath;
}

/** Tải báo cáo ReportCentral chuyên biệt qua submitDownloadReport API */
async function downloadMonthlyReportCentralFile(
  page: Page,
  downloadDir: string,
  targetMonth: string,
  config: ReportCentralConfig,
  storeName?: string,
): Promise<string | null> {
  const fileName = `${config.code}_${targetMonth}.${config.ext}`;
  const targetPath = path.join(downloadDir, fileName);

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 500) {
    console.log(`  [${config.code}] File đã tồn tại: ${fileName} (${fs.statSync(targetPath).size} bytes). Bỏ qua.`);
    return targetPath;
  }

  const { startSlash, endSlash } = getMonthDateRange(targetMonth);
  console.log(`  [${config.code}] Đang truy cập ${config.pageUrl}...`);
  await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  if (isSignInUrl(page.url())) {
    if (storeName) {
      console.log(`  [${config.code}] Phát hiện trang đăng nhập. Gọi ensureAmazonSession...`);
      await ensureAmazonSession(page, storeName);
      if (!page.url().includes(config.pageUrl)) {
        await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3000);
      }
    }
    if (isSignInUrl(page.url())) {
      throw new Error("Seller Central chưa đăng nhập.");
    }
  }

  console.log(`  [${config.code}] Gửi API submitDownloadReport (frpId ${config.frpId}) từ ${startSlash} đến ${endSlash}...`);
  const reportInfo = await page.evaluate(
    async ({ frpId, startRep, endRep, fileFmt }) => {
      const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]') as HTMLMetaElement | null;
      if (!meta) throw new Error("Không tìm thấy anti-csrftoken-a2z");
      const qs =
        `reportFileFormat=${fileFmt}&reportStartDate=` +
        encodeURIComponent(startRep) +
        "&reportEndDate=" +
        encodeURIComponent(endRep) +
        "&xdaysBeforeUntilToday=-1&startDateTimeOffset=0&endDateTimeOffset=0" +
        "&specialDateOptions=&reportFRPId=" +
        frpId +
        "&language=&disableTimezone=true";
      const res = await fetch("/reportcentral/api/v1/submitDownloadReport?" + qs, {
        method: "POST",
        credentials: "include",
        headers: { "anti-csrftoken-a2z": meta.content },
      });
      if (!res.ok) throw new Error(`submitDownloadReport error HTTP ${res.status}`);
      return res.json();
    },
    { frpId: config.frpId, startRep: startSlash, endRep: endSlash, fileFmt: config.fileFormat }
  );

  const referenceId = reportInfo?.reportReferenceId;
  if (!referenceId) {
    throw new Error(`Amazon không trả về reportReferenceId: ${JSON.stringify(reportInfo)}`);
  }
  console.log(`  [${config.code}] Reference ID: ${referenceId}. Đang chờ Amazon tạo báo cáo...`);

  let isDone = false;
  for (let i = 0; i < 48; i++) {
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
    if (statusResult === "Cancelled") {
      console.warn(`  [${config.code}] ℹ️ Amazon báo 'Cancelled' (Store không phát sinh dữ liệu cho kỳ này). Tạo file chuẩn header.`);
      if (config.code === "11_RemovalOrderDetail") {
        const header = '"request-date","order-id","order-source","order-type","order-status","last-updated-date","sku","fnsku","disposition","requested-quantity","cancelled-quantity","disposed-quantity","shipped-quantity","in-process-quantity","removal-fee","currency"\n';
        fs.writeFileSync(targetPath, header, "utf8");
        return targetPath;
      }
      return null;
    }
    if (statusResult && statusResult !== "InQueue" && statusResult !== "InProgress") {
      throw new Error(`Báo cáo kết thúc với trạng thái lạ: ${statusResult}`);
    }
  }

  if (!isDone) {
    throw new Error(`Báo cáo ${config.code} không hoàn thành sau 4 phút.`);
  }

  console.log(`  [${config.code}] Báo cáo đã xong! Đang tải file...`);
  const downloadUrl = `https://sellercentral.amazon.com/reportcentral/api/v1/downloadFile?referenceId=${referenceId}&fileFormat=${config.fileFormat}`;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 35000 }),
    page.goto(downloadUrl).catch((err: any) => {
      if (!String(err?.message || "").includes("ERR_ABORTED")) throw err;
    }),
  ]);

  await download.saveAs(targetPath);
  console.log(`  [${config.code}] ✅ Tải thành công: ${path.basename(targetPath)} (${fs.statSync(targetPath).size} bytes)`);
  return targetPath;
}

/**
 * Tải Báo cáo Date Range Transactions (File 15) và Summary PDF (File 16 nếu có) từ:
 * https://sellercentral.amazon.com/payments/reports-repository?ref_=xx_rrepo_ttab_dash
 */
async function downloadPaymentsReportsRepository(
  page: Page,
  downloadDir: string,
  monthStr: string,
  storeName?: string,
): Promise<string[]> {
  const transFileName = `15_DateRangeTransactions_${monthStr}.csv`;
  const transTargetPath = path.join(downloadDir, transFileName);
  const summaryFileName = `16_DateRangeSummary_${monthStr}.pdf`;
  const summaryTargetPath = path.join(downloadDir, summaryFileName);

  const downloadedList: string[] = [];

  const hasTrans = fs.existsSync(transTargetPath) && fs.statSync(transTargetPath).size > 1000;
  const hasSummary = fs.existsSync(summaryTargetPath) && fs.statSync(summaryTargetPath).size > 1000;

  if (hasTrans) {
    console.log(`  [15_DateRangeTransactions] File đã tồn tại: ${transFileName} (${fs.statSync(transTargetPath).size} bytes).`);
    downloadedList.push(transTargetPath);
  }
  if (hasSummary) {
    console.log(`  [16_DateRangeSummary] File đã tồn tại: ${summaryFileName} (${fs.statSync(summaryTargetPath).size} bytes).`);
    downloadedList.push(summaryTargetPath);
  }

  // Nếu cả 2 file đều đã tồn tại thì mới bỏ qua toàn bộ
  if (hasTrans && hasSummary) {
    console.log(`  [Payments Reports] Cả 2 file Transactions & Summary đã có sẵn. Bỏ qua.`);
    return downloadedList;
  }

  const url = "https://sellercentral.amazon.com/payments/reports-repository?ref_=xx_rrepo_ttab_dash";
  console.log(`  [Payments Reports] Đang truy cập ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  if (isSignInUrl(page.url())) {
    if (storeName) {
      console.log(`  [Payments Reports] Phát hiện trang đăng nhập. Gọi ensureAmazonSession...`);
      await ensureAmazonSession(page, storeName);
      if (!page.url().includes("reports-repository")) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4000);
      }
    }
    if (isSignInUrl(page.url())) {
      throw new Error("Trang yêu cầu đăng nhập lại (Session expired).");
    }
  }

  // Đóng survey popup nếu có
  await page.evaluate(() => {
    document.querySelectorAll("div[role='dialog'], .ngstrim-exit-survey-dialog").forEach((e) => e.remove());
  });

  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthNumStr, 10) - 1;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // Kiểm tra danh sách báo cáo
  console.log(`  [Payments Reports] Kiểm tra danh sách báo cáo trên trang Payments...`);
  const findReports = async () => {
    return await page.evaluate(async (mStr) => {
      try {
        const res = await fetch("/payments/reports/api/reports?sortOrderByRequestDate=DESC&resultsPerPage=20&pageNum=1");
        if (!res.ok) return { trans: null, summary: null };
        const data = await res.json();
        const list = data.reportResponse || [];

        let trans: any = null;
        let summary: any = null;

        for (const item of list) {
          const d = new Date(item.startDate);
          const ptYearMonth = d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }).slice(0, 7);
          if (ptYearMonth === mStr) {
            if (item.reportType === "SELLER_TRANSACTION_DATE_RANGE" && !trans) {
              trans = item;
            }
            if (item.reportType === "SELLER_SUMMARY_DATE_RANGE" && !summary) {
              summary = item;
            }
          }
        }
        return { trans, summary };
      } catch {
        return { trans: null, summary: null };
      }
    }, monthStr);
  };

  let found = await findReports();

  const pad = (n: number) => String(n).padStart(2, "0");
  const startDateISO = `${year}-${pad(monthIdx + 1)}-01T00:00:00+07:00`;
  const endDateISO = `${year}-${pad(monthIdx + 1)}-${pad(daysInMonth)}T23:59:59+07:00`;
  const startMs = new Date(startDateISO).getTime();
  const endMs = new Date(endDateISO).getTime();

  // Nếu chưa có báo cáo Transaction cho tháng này và file chưa có trên máy, gửi yêu cầu tạo
  if (!found.trans && !hasTrans) {
    console.log(`  [15_DateRangeTransactions] Chưa có báo cáo Transaction tháng ${monthStr}. Đang gửi request tạo...`);
    await page.evaluate(async (params) => {
      const payload = {
        accountType: "ALL",
        reportType: "SELLER_TRANSACTION_DATE_RANGE",
        startDate: params.startMs,
        startDateISO: params.startDateISO,
        endDate: params.endMs,
        endDateISO: params.endDateISO,
        timeRangeType: "MONTHLY",
      };

      try {
        await fetch("/payments/reports/api/request-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {}
    }, { startMs, endMs, startDateISO, endDateISO });
  }

  // Nếu chưa có báo cáo Summary cho tháng này và file chưa có trên máy, gửi yêu cầu tạo Summary
  if (!found.summary && !hasSummary) {
    console.log(`  [16_DateRangeSummary] Chưa có báo cáo Summary tháng ${monthStr}. Đang gửi request tạo...`);
    await page.evaluate(async (params) => {
      const payload = {
        accountType: "ALL",
        reportType: "SELLER_SUMMARY_DATE_RANGE",
        startDate: params.startMs,
        startDateISO: params.startDateISO,
        endDate: params.endMs,
        endDateISO: params.endDateISO,
        timeRangeType: "MONTHLY",
      };

      try {
        await fetch("/payments/reports/api/request-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {}
    }, { startMs, endMs, startDateISO, endDateISO });
  }

  // Chờ báo cáo hoàn thành
  console.log(`  [Payments Reports] Đang chờ Amazon tạo báo cáo (tối đa 4 phút)...`);
  const startTime = Date.now();
  let transReportId: string | null = null;
  let summaryReportId: string | null = null;

  while (Date.now() - startTime < 240000) {
    await page.waitForTimeout(10000);
    found = await findReports();
    if (found.trans && found.trans.status === "DOWNLOADABLE") {
      transReportId = found.trans.reportId;
    }
    if (found.summary && found.summary.status === "DOWNLOADABLE") {
      summaryReportId = found.summary.reportId;
    }

    const transDone = hasTrans || transReportId !== null;
    const summaryDone = hasSummary || summaryReportId !== null;
    if (transDone && summaryDone) {
      break;
    }
    console.log(`  [Payments Reports] Trạng thái - Trans: ${found.trans?.status || (hasTrans ? "Cached" : "In progress...")}, Summary: ${found.summary?.status || (hasSummary ? "Cached" : "In progress...")}`);
  }

  if (!hasTrans && transReportId) {
    console.log(`  [15_DateRangeTransactions] Báo cáo đã xong! Đang tải file CSV...`);
    const dlUrl = `https://sellercentral.amazon.com/payments/reports/api/download-report?reportId=${transReportId}`;
    const content = await page.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Download HTTP " + res.status);
      return await res.text();
    }, dlUrl);

    if (content && content.length > 50) {
      fs.writeFileSync(transTargetPath, content, "utf8");
      console.log(`  [15_DateRangeTransactions] ✅ Tải thành công: ${transFileName} (${fs.statSync(transTargetPath).size} bytes)`);
      downloadedList.push(transTargetPath);
    }
  } else if (!hasTrans) {
    console.warn(`  [15_DateRangeTransactions] ⚠️ Không hoàn tất tải báo cáo Transaction sau 4 phút.`);
  }

  // Nếu có Summary Report hoàn tất, tải luôn PDF
  if (!hasSummary && summaryReportId) {
    try {
      console.log(`  [16_DateRangeSummary] Tìm thấy Summary PDF đã sẵn sàng! Đang tải...`);
      const dlSummaryUrl = `https://sellercentral.amazon.com/payments/reports/api/download-report?reportId=${summaryReportId}`;
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 35000 }),
        page.goto(dlSummaryUrl).catch((err: any) => {
          if (!String(err?.message || "").includes("ERR_ABORTED")) throw err;
        }),
      ]);
      await download.saveAs(summaryTargetPath);
      console.log(`  [16_DateRangeSummary] ✅ Tải thành công: ${summaryFileName} (${fs.statSync(summaryTargetPath).size} bytes)`);
      downloadedList.push(summaryTargetPath);
    } catch (err: any) {
      console.warn(`  [16_DateRangeSummary] Bỏ qua tải Summary PDF: ${err.message || err}`);
    }
  }

  return downloadedList;
}

/** Đồng bộ file tháng lên Cloudflare R2 */
async function syncMonthlyToR2(monthStr: string): Promise<void> {
  const uploaderScript = path.join(__dirname, "upload_accounting_r2.ts");
  if (!fs.existsSync(uploaderScript)) {
    console.warn("[R2 Sync] Không tìm thấy upload_accounting_r2.ts, bỏ qua sync R2.");
    return;
  }
  console.log(`\n[R2 Sync] Đang đồng bộ báo cáo tháng ${monthStr} lên Cloudflare R2...`);
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", uploaderScript, `--date=${monthStr}`], {
      cwd: __dirname,
    });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (err: any) {
    console.error(`[R2 Sync] Lỗi khi upload R2:`, err?.message || err);
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function main() {
  const releaseLock = acquireMonthlyLock();

  try {
    const now = new Date();
    const lastMonthStr = getLastMonthStr(now);

    // Đọc tham số dòng lệnh: --month=YYYY-MM (hoặc --date=YYYY-MM), --store=STORE_NAME
    const monthArg =
      process.argv.find((arg) => arg.startsWith("--month="))?.slice("--month=".length) ||
      process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
    const storeArg = process.argv.find((arg) => arg.startsWith("--store="))?.slice("--store=".length);

    // Hỗ trợ lọc báo cáo tải: --reports=14 hoặc --only-reports=14_MonthlyStorageFees,...
    const reportsArg =
      process.argv.find((arg) => arg.startsWith("--reports="))?.slice("--reports=".length) ||
      process.argv.find((arg) => arg.startsWith("--only-reports="))?.slice("--only-reports=".length);
    const reportFilters = reportsArg
      ? reportsArg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : null;

    // Hỗ trợ cờ auto-ingest: --no-ingest / --skip-ingest, --force / --force-ingest
    const noIngest = process.argv.includes("--no-ingest") || process.argv.includes("--skip-ingest");
    const forceIngest = process.argv.includes("--force") || process.argv.includes("--force-ingest");
    const shouldAutoIngest = !noIngest && (!reportFilters || process.argv.includes("--ingest") || forceIngest);

    const isReportWanted = (code: string) => {
      if (!reportFilters || reportFilters.length === 0) return true;
      const c = code.toLowerCase();
      return reportFilters.some((f) => c.includes(f) || f.includes(c));
    };

    const targetMonth = monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : lastMonthStr;
    const isPreviousMonth = targetMonth === lastMonthStr;

    const allStores = getStoreList();
    const targetStores = storeArg
      ? allStores.filter((s) => s.store_name.toLowerCase() === storeArg.toLowerCase())
      : allStores;

    if (targetStores.length === 0) {
      console.error(`[Lỗi] Không tìm thấy store nào phù hợp ${storeArg ? `với "${storeArg}"` : "trong stores.json"}.`);
      return;
    }

    const { startSlash, endSlash } = getMonthDateRange(targetMonth);
    const filterInfo = reportFilters ? ` [Lọc báo cáo: ${reportFilters.join(", ")}]` : "";
    const msgStart = `🚀 [BÁO CÁO THÁNG] Bắt đầu tải báo cáo tháng ${targetMonth} (${startSlash} → ${endSlash})${filterInfo} cho ${targetStores.length} store: ${targetStores.map((s) => s.store_name).join(", ")}`;
    console.log(`\n${msgStart}\n`);
    await sendTelegramMessage(msgStart).catch(() => {});

    const summaryResults: Array<{ store: string; files: string[]; status: "SUCCESS" | "FAILED" | "PARTIAL"; error?: string }> = [];

    for (const store of targetStores) {
      console.log(`\n======================================================`);
      console.log(`  BẮT ĐẦU CRAWL THÁNG ${targetMonth} CHO STORE: ${store.store_name} (Profile: ${store.profile_id})`);
      console.log(`======================================================`);

      const storeDownloadDir = path.join(ACCOUNTING_DOWNLOAD_DIR, targetMonth, store.store_name);
      fs.mkdirSync(storeDownloadDir, { recursive: true });

      const downloadedFiles: string[] = [];

      try {
        console.log(`[AdsPower] Khởi động profile ${store.profile_id}...`);
        const cdpUrl = await startAdsPowerProfile(store.profile_id);
        const browser = await chromium.connectOverCDP(cdpUrl);
        const context = browser.contexts()[0];
        const page = context.pages()[0] || (await context.newPage());

        try {
          // 1. Tải File 01: Ads Portfolios (+ File 05 Campaigns)
          if (isReportWanted("01_Portfolios") || isReportWanted("01") || isReportWanted("ads")) {
            const p1 = await withSessionRecovery("Ads Portfolios", page, store.store_name, () =>
              downloadMonthlyPortfolios(page, storeDownloadDir, targetMonth, isPreviousMonth, store.store_name),
            );
            if (p1) downloadedFiles.push(path.basename(p1));
            const p5 = path.join(storeDownloadDir, `05_Campaigns_${targetMonth}.csv`);
            if (fs.existsSync(p5)) downloadedFiles.push(path.basename(p5));
          }

          // 2. Tải File 02: All Orders
          if (isReportWanted("02_AllOrders") || isReportWanted("02") || isReportWanted("orders")) {
            const p2 = await withSessionRecovery("All Orders", page, store.store_name, () =>
              downloadMonthlyOrders(page, storeDownloadDir, targetMonth, store.store_name),
            );
            if (p2) downloadedFiles.push(path.basename(p2));
          }

          // 3. Tải 4 báo cáo kế toán tháng mới (Removal, Inbound Placement, Long-term Storage, Monthly Storage)
          for (const repConfig of ADDITIONAL_MONTHLY_REPORTS) {
            if (!isReportWanted(repConfig.code) && !isReportWanted(repConfig.code.slice(0, 2))) {
              continue;
            }
            try {
              const p = await withSessionRecovery(repConfig.code, page, store.store_name, () =>
                downloadMonthlyReportCentralFile(page, storeDownloadDir, targetMonth, repConfig, store.store_name),
              );
              if (p) downloadedFiles.push(path.basename(p));
            } catch (repErr: any) {
              console.warn(`  ⚠️ Lỗi khi tải ${repConfig.code}: ${repErr.message || repErr}`);
            }
          }

          // 4. Tải Báo cáo Date Range Transactions & Summary từ Payments Reports Repository
          if (
            isReportWanted("15_DateRangeTransactions") ||
            isReportWanted("16_DateRangeSummary") ||
            isReportWanted("15") ||
            isReportWanted("16") ||
            isReportWanted("payments") ||
            isReportWanted("transactions")
          ) {
            try {
              const pRepo = await withSessionRecovery("Payments Repository", page, store.store_name, () =>
                downloadPaymentsReportsRepository(page, storeDownloadDir, targetMonth, store.store_name),
              );
              for (const p of pRepo) {
                downloadedFiles.push(path.basename(p));
              }
            } catch (repoErr: any) {
              console.warn(`  ⚠️ Lỗi khi tải payments reports repository: ${repoErr.message || repoErr}`);
            }
          }

          summaryResults.push({ store: store.store_name, files: downloadedFiles, status: "SUCCESS" });
        } finally {
          await browser.close().catch(() => {});
          await stopAdsPowerProfile(store.profile_id).catch(() => {});
          console.log(`[AdsPower] Đã đóng trình duyệt cho store ${store.store_name}.`);
        }
      } catch (storeError: any) {
        console.error(`❌ [LỖI STORE ${store.store_name}]:`, storeError.message || storeError);
        summaryResults.push({
          store: store.store_name,
          files: downloadedFiles,
          status: "FAILED",
          error: storeError.message || String(storeError),
        });
      }
    }

    // Đồng bộ lên Cloudflare R2
    await syncMonthlyToR2(targetMonth);

    const successStores = summaryResults.filter((r) => r.status === "SUCCESS");

    // 5. Tự động tính toán kế toán tháng trực tiếp từ file thô vừa tải và lưu vào PostgreSQL
    if (!shouldAutoIngest) {
      console.log(`\n⏭️ [AUTO-INGEST] Bỏ qua bước tính toán tự động (${noIngest ? "--no-ingest được kích hoạt" : "đang chạy chế độ lọc báo cáo lẻ"}).`);
    } else {
      console.log(`\n📊 [AUTO-INGEST] Bắt đầu tính toán kế toán tháng từ file thô cho các store thành công...`);
      const pythonBin = process.env.PYTHON_BIN || (fs.existsSync("/opt/homebrew/bin/python3") ? "/opt/homebrew/bin/python3" : (fs.existsSync("/usr/local/bin/python3") ? "/usr/local/bin/python3" : "python3"));
      const ingestErrors: { store: string; error: string }[] = [];
      for (const s of successStores) {
        try {
          let scriptPath = path.join(__dirname, "..", "scripts", "ingest_monthly_from_raw.py");
          if (!fs.existsSync(scriptPath)) {
            scriptPath = path.join(__dirname, "scripts", "ingest_monthly_from_raw.py");
          }
          console.log(`  -> Đang tính toán tự động cho store ${s.store} (${targetMonth}) bằng ${scriptPath} [Python: ${pythonBin}]...`);
          const ingestArgs = [
            scriptPath,
            "--store",
            s.store,
            "--month",
            targetMonth,
          ];
          if (forceIngest) {
            ingestArgs.push("--force");
          }
          const { stdout, stderr } = await execFileAsync(pythonBin, ingestArgs);
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
          console.log(`  ✅ [AUTO-INGEST ${s.store}] Hoàn tất!`);
        } catch (ingestErr: any) {
          const errMsg = ingestErr.stderr || ingestErr.message || String(ingestErr);
          console.error(`  ❌ [AUTO-INGEST LỖI ${s.store}]:`, errMsg);
          ingestErrors.push({ store: s.store, error: errMsg.trim().slice(0, 300) });
        }
      }

      if (ingestErrors.length > 0) {
        summaryResults.forEach((r) => {
          const err = ingestErrors.find((e) => e.store === r.store);
          if (err) {
            r.status = "PARTIAL";
            r.error = `Auto-ingest: ${err.error}`;
          }
        });
      }
    }

    // Báo cáo hoàn tất
    const failedStores = summaryResults.filter((r) => r.status === "FAILED");
    const partialStores = summaryResults.filter((r) => r.status === "PARTIAL");

    let finalReport = `🏁 [HOÀN TẤT BÁO CÁO THÁNG ${targetMonth}]\n`;
    finalReport += `✅ Tải file thành công: ${successStores.length}/${targetStores.length} store\n`;
    for (const s of successStores) {
      finalReport += `  • ${s.store}: ${s.files.join(", ")}\n`;
    }
    if (partialStores.length > 0) {
      finalReport += `⚠️ Lỗi tính toán Auto-Ingest: ${partialStores.length} store\n`;
      for (const p of partialStores) {
        finalReport += `  • ${p.store}: ${p.error}\n`;
      }
    }
    if (failedStores.length > 0) {
      finalReport += `❌ Thất bại tải file: ${failedStores.length} store\n`;
      for (const f of failedStores) {
        finalReport += `  • ${f.store}: ${f.error}\n`;
      }
    }

    console.log(`\n${finalReport}`);
    await sendTelegramMessage(finalReport).catch(() => {});

  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("FATAL ERROR in monthly_crawler:", err);
    process.exit(1);
  });
}
