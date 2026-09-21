import { chromium, type BrowserContext, type Page } from "playwright-core";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

// ============================================================================
// CONFIGURATION RESOLUTION
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
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val.replace("$HOME", os.homedir()).replace("~", os.homedir());
        }
      }
    }
  }
}

loadEnv();

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || "http://local.adspower.net:50325";
const DEFAULT_CDP_PORT = Number(process.env.ADSPOWER_CDP_PORT || 0);

const rawBaseDir = process.env.DOWNLOAD_BASE_DIR || path.join(os.homedir(), "Downloads", "Bulk file");
const BASE_DOWNLOAD_DIR = rawBaseDir.replace("$HOME", os.homedir()).replace("~", os.homedir());

export interface StoreTarget {
  store_name: string;
  profile_id: string;
  enabled?: boolean;
  description?: string;
}

export function getStoreList(): StoreTarget[] {
  const storesPath = path.join(__dirname, "stores.json");
  if (fs.existsSync(storesPath)) {
    try {
      const raw = fs.readFileSync(storesPath, "utf8");
      const list = JSON.parse(raw) as StoreTarget[];
      if (Array.isArray(list) && list.length > 0) {
        const enabled = list.filter((s) => s.enabled !== false && s.store_name && s.profile_id);
        if (enabled.length > 0) {
          const names = new Set<string>();
          const profiles = new Set<string>();
          for (const store of enabled) {
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(store.store_name)) {
              throw new Error(`Tên store không an toàn cho folder/R2: ${store.store_name}`);
            }
            const nameKey = store.store_name.toLowerCase();
            if (names.has(nameKey)) throw new Error(`Store bị trùng trong stores.json: ${store.store_name}`);
            if (profiles.has(store.profile_id)) throw new Error(`AdsPower profile bị map cho nhiều store: ${store.profile_id}`);
            names.add(nameKey);
            profiles.add(store.profile_id);
          }
          if (DEFAULT_CDP_PORT > 0 && enabled.length > 1) {
            throw new Error("ADSPOWER_CDP_PORT cố định chỉ an toàn cho một store; hãy bỏ biến này khi chạy nhiều store.");
          }
          return enabled;
        }
      }
    } catch (err) {
      console.warn(`[Config] Không đọc được stores.json, sử dụng cấu hình từ config.env: ${(err as Error).message}`);
    }
  }

  // Fallback từ config.env
  const fallbackStore = process.env.STORE_NAME || "HSOSTORE";
  const fallbackProfile = process.env.ADSPOWER_PROFILE_ID || "";
  if (!fallbackProfile) throw new Error("Không có store hợp lệ trong stores.json và thiếu ADSPOWER_PROFILE_ID.");
  return [{ store_name: fallbackStore, profile_id: fallbackProfile, enabled: true }];
}

const LOCK_PATH = path.join(os.homedir(), "Library", "Application Support", "AmazonPpcCrawler", "run.lock");

export function acquireCrawlerLock(): () => void {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const fd = fs.openSync(LOCK_PATH, "wx", 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    fs.closeSync(fd);
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (errorCode !== "EEXIST") throw error;
    const pid = Number(fs.readFileSync(LOCK_PATH, "utf8").split(/\s+/)[0]);
    try {
      if (pid > 0) process.kill(pid, 0);
      throw new Error(`Một tiến trình crawler khác đang chạy (PID ${pid}).`);
    } catch (probe: unknown) {
      const probeCode = typeof probe === "object" && probe !== null && "code" in probe ? String(probe.code) : "";
      if (probeCode !== "ESRCH") throw probe;
      fs.unlinkSync(LOCK_PATH);
      return acquireCrawlerLock();
    }
  }
  return () => {
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  };
}

// ============================================================================
// CLOUDFLARE R2 STREAMING UPLOADER
// ============================================================================
let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (s3ClientInstance) return s3ClientInstance;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  s3ClientInstance = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3ClientInstance;
}

export async function uploadFileImmediatelyToR2(
  filePath: string,
  storeName: string,
  subDir: "SP" | "SB",
  batchDate: string,
): Promise<string> {
  const s3 = getS3Client();
  if (!s3) {
    throw new Error("Thiếu credentials R2; không thể publish batch PPC.");
  }

  const fileName = path.basename(filePath);
  const fileSizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
  const prefix = (process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "");
  const r2Key = `${prefix}/input/${batchDate}/${storeName}/${subDir}/${fileName}`;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";

  console.log(`  [R2 STREAMING] >>> ĐANG ĐẨY NGAY LẬP TỨC LÊN R2: ${fileName} (${fileSizeMb} MB)...`);
  console.log(`                 R2 Key: ${r2Key}`);

  try {
    const fileStream = fs.createReadStream(filePath);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: fileStream,
        ContentType: fileName.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
      }),
    );
    console.log(`  [R2 STREAMING] => [THÀNH CÔNG] File đã sẵn sàng trên Cloudflare R2!`);
    return r2Key;
  } catch (err) {
    console.error(`  [R2 STREAMING] => [LỖI] Không thể đẩy file lên R2: ${(err as Error).message}`);
    throw err;
  }
}

async function publishCompleteBatch(
  files: DownloadedFileInfo[],
  storeName: string,
  batchDate: string,
): Promise<void> {
  if (files.length !== 6) throw new Error(`Batch ${storeName} chưa đủ 6 file.`);
  const keys: string[] = [];
  for (const file of files) {
    keys.push(await uploadFileImmediatelyToR2(file.path, storeName, file.relativeSubdir, batchDate));
  }
  const s3 = getS3Client();
  if (!s3) throw new Error("Thiếu cấu hình R2.");
  const prefix = (process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "");
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const markerKey = `${prefix}/input/${batchDate}/${storeName}/_COMPLETE.json`;
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: markerKey,
    Body: JSON.stringify({ version: 1, storeName, batchDate, completedAt: new Date().toISOString(), files: keys }),
    ContentType: "application/json",
  }));
  console.log(`[R2] Batch ${storeName} đã đủ 6 file; published marker ${markerKey}`);
}

// ============================================================================
// ADSPOWER PROFILE CONTROLLER (AUTO START & STOP TO SAVE RAM)
// ============================================================================
export async function startAdsPowerProfile(profileId: string): Promise<string> {
  if (DEFAULT_CDP_PORT > 0) {
    return `http://127.0.0.1:${DEFAULT_CDP_PORT}`;
  }

  // 1. Kiểm tra xem profile đã active chưa
  try {
    const res = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/local-active`);
    const data = await res.json() as { code?: number; data?: { list?: Array<{ user_id?: string; debug_port?: number }> } };
    const activeProfiles = data.data?.list || [];
    if (data.code === 0 && activeProfiles.length > 0) {
      const match = activeProfiles.find((item) => item.user_id === profileId);
      if (match && match.debug_port) {
        console.log(`[AdsPower] Profile ${profileId} đã chạy sẵn tại port ${match.debug_port}`);
        return `http://127.0.0.1:${match.debug_port}`;
      }
    }
  } catch (err) {
    console.warn(`[AdsPower API] Kiểm tra local-active thất bại: ${(err as Error).message}`);
  }

  // 2. Khởi động profile
  try {
    console.log(`[AdsPower] Đang mở trình duyệt profile: ${profileId}...`);
    const startRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
    const startData = await startRes.json();
    if (startData.code === 0 && startData.data?.debug_port) {
      console.log(`[AdsPower] Mở thành công profile ${profileId}! CDP Port: ${startData.data.debug_port}`);
      await new Promise((r) => setTimeout(r, 2000));
      return `http://127.0.0.1:${startData.data.debug_port}`;
    }
    if (startData.data?.ws?.puppeteer) {
      return startData.data.ws.puppeteer;
    }
  } catch (err) {
    console.warn(`[AdsPower API] Lỗi khởi động profile: ${(err as Error).message}`);
  }

  throw new Error(`Không thể mở đúng AdsPower profile ${profileId}; không dùng CDP fallback để tránh lẫn store.`);
}

export async function stopAdsPowerProfile(profileId: string): Promise<void> {
  try {
    console.log(`[AdsPower] Đang đóng profile ${profileId} để giải phóng RAM cho Mac mini...`);
    await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(`[AdsPower] => ĐÃ ĐÓNG HOÀN TOÀN PROFILE ${profileId}!`);
  } catch (err) {
    console.warn(`[AdsPower] Không đóng được profile ${profileId}: ${(err as Error).message}`);
  }
}

function getFileStatsMap(dir: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    try {
      map.set(f, fs.statSync(path.join(dir, f)).mtimeMs);
    } catch {}
  }
  return map;
}

async function waitForNewDownload(dir: string, beforeStats: Map<string, number>, timeoutSec = 60): Promise<string | null> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".crdownload") || f.startsWith(".")) continue;
      const fullPath = path.join(dir, f);
      try {
        const stat = fs.statSync(fullPath);
        const prevMtime = beforeStats.get(f);
        if ((!prevMtime && stat.size > 0) || (prevMtime && stat.mtimeMs > prevMtime && stat.size > 0)) {
          await new Promise((r) => setTimeout(r, 1000));
          return fullPath;
        }
      } catch {}
    }
  }
  return null;
}

// ============================================================================
// CRAWL LOGIC: BULK OPERATIONS
// ============================================================================
async function requestAndDownloadBulk(
  page: Page,
  context: BrowserContext,
  storeName: string,
  targetDir: string,
  adType: "SP" | "SB",
  days: 7 | 30,
): Promise<string> {
  console.log(`\n  ------------------------------------------------------------`);
  console.log(`  [BULK] Bắt đầu xử lý: Bulk ${adType} - ${days} Ngày cho [${storeName}]...`);
  console.log(`  ------------------------------------------------------------`);

  const entityMatch = page.url().match(/entityId=([A-Z0-9]+)/);
  const entityId = entityMatch ? entityMatch[1] : "";
  const bulkUrl = `https://advertising.amazon.com/bulk-operations${entityId ? `?entityId=${entityId}` : ""}`;

  if (!page.url().includes("bulk-operations")) {
    await page.goto(bulkUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  const existingLinks = new Set<string>(
    await page.$$eval(
      'a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="bulk-operations/download"]',
      (els) => els.map((element) => (element as HTMLAnchorElement).href),
    ),
  );

  const downloadBtn = await page.$('button[data-takt-id="Bulksheet_home_download_campaigns_button"]');
  if (downloadBtn) {
    await downloadBtn.click();
    await page.waitForTimeout(1500);
  }

  const mustCheckLabels = [
    "Performance data",
    "Paused campaigns",
    "Campaign items with zero impressions",
    "Placement data for campaigns",
    adType === "SP" ? "Sponsored Products data" : "Sponsored Brands data",
  ];

  for (const label of mustCheckLabels) {
    const el = await page.$(`label:has-text('${label}')`);
    const input = await el?.$("input");
    if (el && input && !(await input.isChecked())) {
      await el.click();
      await page.waitForTimeout(150);
    }
  }

  const mustUncheckLabels = [
    adType === "SP" ? "Sponsored Brands data" : "Sponsored Products data",
    "Sponsored products search term data",
    "Sponsored brands search term data",
    "Sponsored Brands multi-ad group data",
    "Sponsored Display data",
  ];

  for (const label of mustUncheckLabels) {
    const el = await page.$(`label:has-text('${label}')`);
    const input = await el?.$("input");
    if (el && input && (await input.isChecked())) {
      await el.click();
      await page.waitForTimeout(150);
    }
  }

  // Chọn Date Range
  const dateRangeBtn = await page.$('button[data-takt-id="Bulksheet_download_custom_date_range_button"]');
  if (dateRangeBtn) {
    await dateRangeBtn.click();
    await page.waitForTimeout(1000);

    const targetOptionText = days === 7 ? "Past 7 days" : "Past 30 days";
    const option = await page.$(`text="${targetOptionText}"`);
    if (option) {
      await option.click();
      await page.waitForTimeout(1000);
    } else throw new Error(`Không tìm thấy date range "${targetOptionText}".`);
  } else throw new Error("Không tìm thấy nút chọn date range của Bulk Operations.");

  // Bấm Create spreadsheet
  console.log(`  [BULK] Yêu cầu Amazon tạo spreadsheet (${days} ngày)...`);
  const createBtn = await page.$('button[data-takt-id="Bulksheet_create_spreadsheet_button"]');
  if (createBtn) {
    await createBtn.click();
  }

  let downloadUrl: string | null = null;
  const startWait = Date.now();

  while (Date.now() - startWait < 180000) {
    await page.waitForTimeout(5000);
    const links = await page.$$('a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="bulk-operations/download"]');
    for (const link of links) {
      const href = await link.getAttribute("href");
      if (href && !existingLinks.has(href)) {
        downloadUrl = href;
        break;
      }
    }
    if (downloadUrl) break;
  }

  if (!downloadUrl) {
    throw new Error(`Timeout chờ Amazon render link tải file Bulk ${adType} - ${days}d`);
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: targetDir,
  });

  const beforeStats = getFileStatsMap(targetDir);

  await page.evaluate((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, downloadUrl);

  const downloadedPath = await waitForNewDownload(targetDir, beforeStats, 90);
  if (!downloadedPath) throw new Error(`Tải file Bulk ${adType} ${days}d thất bại.`);

  // 1. ĐỔI TÊN FILE CHUẨN
  const rawName = path.basename(downloadedPath);
  const standardizedName = `${storeName}_Bulk_${adType}_${days}Days_${rawName}`;
  const finalPath = path.join(targetDir, standardizedName);

  if (downloadedPath !== finalPath) {
    fs.renameSync(downloadedPath, finalPath);
  }

  const stat = fs.statSync(finalPath);
  console.log(`  [BULK] => THÀNH CÔNG: ${path.basename(finalPath)} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);

  return finalPath;
}

// ============================================================================
// CRAWL LOGIC: SEARCH TERM REPORTS
// ============================================================================
async function downloadSearchTerms(
  page: Page,
  context: BrowserContext,
  storeName: string,
  targetDir: string,
  adType: "SP" | "SB",
): Promise<string> {
  console.log(`\n  ------------------------------------------------------------`);
  console.log(`  [SEARCH TERM] Bắt đầu xử lý: Search Term ${adType} - 30 Ngày cho [${storeName}]...`);
  console.log(`  ------------------------------------------------------------`);

  const entityId = page.url().match(/entityId=([A-Z0-9]+)/)?.[1] || "";
  const entityParam = entityId ? `?entityId=${entityId}` : "";
  const reportsUrl = `https://advertising.amazon.com/reports${entityParam}`;
  const requestId = `${storeName}-${adType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reportName = `${storeName} Search Term ${adType} 30D ${requestId}`;

  // Luôn tạo report mới cho lần chạy này; không lấy một hàng COMPLETED cũ.
  await page.goto(`https://advertising.amazon.com/reports/new${entityParam}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  if (adType === "SB") {
    const category = await page.$("#report-configuration-form\\:report-category-control-component-0");
    if (!category) throw new Error("Không tìm thấy bộ chọn loại quảng cáo của Search Term report.");
    await category.click();
    const option = await page.waitForSelector('[role="option"]:has-text("Sponsored Brands"), li:has-text("Sponsored Brands")', { timeout: 5000 });
    await option.click();
  }

  const reportType = await page.$("#report-configuration-form\\:report-type-control-component-0");
  if (!reportType) throw new Error("Không tìm thấy bộ chọn Report Type.");
  if (!/search\s*term/i.test(await reportType.innerText())) {
    await reportType.click();
    const option = await page.waitForSelector('[role="option"]:has-text("Search term"), li:has-text("Search term")', { timeout: 5000 });
    await option.click();
  }

  const daily = await page.$("#time-units-day, input[value='DAILY'], label[for='time-units-day']");
  if (daily) await daily.click().catch(() => {});
  const nameInput = await page.$("#report-settings-card-report-name-input");
  if (!nameInput) throw new Error("Không tìm thấy ô tên report.");
  await nameInput.fill(reportName);
  const runButton = await page.$("#urc_run_subscription_button");
  if (!runButton) throw new Error("Không tìm thấy nút Run report.");
  await runButton.click();
  await page.waitForTimeout(2500);
  if (!page.url().includes("/reports")) await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: targetDir,
  });

  let downloadUrl: string | null = null;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline && !downloadUrl) {
    downloadUrl = await page.evaluate((targetId) => {
      const groups = new Map<string, { text: string; href: string | null }>();
      const rows = Array.from(document.querySelectorAll("div.ag-row[row-index], tr[row-index], table tbody tr, div[role='row']"));
      for (const row of rows) {
        const index = row.getAttribute("row-index") || row.getAttribute("aria-rowindex") || String(rows.indexOf(row));
        const current = groups.get(index) || { text: "", href: null };
        current.text += ` ${(row as HTMLElement).innerText || ""}`;
        const anchor = row.querySelector<HTMLAnchorElement>('a[href*="download-report"], a[href*="download"], a[data-takt-id="storm-ui-link"]');
        if (anchor?.href) current.href = anchor.href;
        groups.set(index, current);
      }
      for (const value of groups.values()) {
        if (value.text.includes(targetId) && /COMPLETED|SUCCESS|Download|Ready/i.test(value.text) && value.href) return value.href;
      }
      return null;
    }, requestId);
    if (!downloadUrl) {
      await page.waitForTimeout(10_000);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }

  if (!downloadUrl) {
    throw new Error(`Không tìm thấy report Search Term ${adType} đúng request ID ${requestId}.`);
  }

  const beforeStats = getFileStatsMap(targetDir);
  await page.evaluate((url) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, downloadUrl);

  const downloadedPath = await waitForNewDownload(targetDir, beforeStats, 60);
  if (!downloadedPath) throw new Error(`Không tải được file Search Term ${adType}`);

  // 1. ĐỔI TÊN FILE CHUẨN
  const rawName = path.basename(downloadedPath);
  const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${rawName}`;
  const finalPath = path.join(targetDir, standardizedName);

  if (downloadedPath !== finalPath) {
    fs.renameSync(downloadedPath, finalPath);
  }

  const stat = fs.statSync(finalPath);
  console.log(`  [SEARCH TERM] => THÀNH CÔNG: ${path.basename(finalPath)} (${(stat.size / 1024).toFixed(1)} KB)`);

  return finalPath;
}

async function validateDownloadedBatch(files: DownloadedFileInfo[]): Promise<void> {
  const expected = new Set(["BULK_SP:30", "BULK_SB:30", "BULK_SP:7", "BULK_SB:7", "ST_SP:30", "ST_SB:30"]);
  const actual = new Set(files.map((file) => `${file.type}:${file.days}`));
  if (files.length !== 6 || actual.size !== 6 || [...expected].some((slot) => !actual.has(slot))) {
    throw new Error(`Batch sai thành phần. Có: ${[...actual].join(", ")}; cần đủ 6 slot chuẩn.`);
  }
  const realPaths = new Set(files.map((file) => fs.realpathSync(file.path)));
  if (realPaths.size !== 6) throw new Error("Batch có file trùng đường dẫn.");
  for (const file of files) {
    const stat = fs.statSync(file.path);
    if (!stat.isFile() || stat.size === 0) throw new Error(`File rỗng hoặc không hợp lệ: ${file.name}`);
    if (file.type.startsWith("BULK_")) {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(`Bulk phải là XLSX: ${file.name}`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file.path);
      const sheetNames = workbook.worksheets.map((sheet) => sheet.name.toLowerCase()).join(" ");
      const expectedAdType = file.relativeSubdir;
      const valid = expectedAdType === "SP"
        ? /sponsored products|sp campaigns/.test(sheetNames)
        : /sponsored brands|sb campaigns|hsa campaigns/.test(sheetNames);
      if (!valid) throw new Error(`Nội dung workbook không khớp ${expectedAdType}: ${file.name}`);
    } else {
      let headerText = "";
      if (file.name.toLowerCase().endsWith(".csv")) {
        const fd = fs.openSync(file.path, "r");
        try {
          const buffer = Buffer.alloc(Math.min(stat.size, 128 * 1024));
          fs.readSync(fd, buffer, 0, buffer.length, 0);
          headerText = buffer.toString("utf8");
        } finally {
          fs.closeSync(fd);
        }
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.path);
        const sheet = workbook.worksheets[0];
        for (let rowNumber = 1; rowNumber <= Math.min(10, sheet?.rowCount || 0); rowNumber++) {
          const values = sheet.getRow(rowNumber).values;
          headerText += ` ${Array.isArray(values) ? values.map((value) => String(value ?? "")).join(" ") : String(values ?? "")}`;
        }
      } else {
        throw new Error(`Search Term phải là XLSX hoặc CSV: ${file.name}`);
      }
      const normalized = headerText.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      if (!/search term|customer search term/.test(normalized) || !/campaign/.test(normalized) || !/click|spend|cost/.test(normalized)) {
        throw new Error(`File không có schema Search Term hợp lệ: ${file.name}`);
      }
    }
  }
}

// ============================================================================
// SINGLE STORE CRAWLER PIPELINE
// ============================================================================
export interface DownloadedFileInfo {
  name: string;
  path: string;
  relativeSubdir: "SP" | "SB";
  days: number;
  type: string;
  sizeBytes: number;
}

export type ProgressCallback = (step: string, percent: number) => Promise<void> | void;

export async function crawlStore(
  store: StoreTarget,
  todayStr: string,
  onProgress?: ProgressCallback,
): Promise<DownloadedFileInfo[]> {
  const storeRootDir = path.join(BASE_DOWNLOAD_DIR, todayStr, store.store_name);
  const spDir = path.join(storeRootDir, "SP");
  const sbDir = path.join(storeRootDir, "SB");
  const batchDate = todayStr.replace(/-/g, "");

  fs.mkdirSync(spDir, { recursive: true });
  fs.mkdirSync(sbDir, { recursive: true });

  console.log("\n************************************************************");
  console.log(`>>> BẮT ĐẦU CRAWL CHO STORE: [${store.store_name}]`);
  console.log(`    Profile ID: ${store.profile_id}`);
  console.log(`    Thư mục lưu trữ: ${storeRootDir}`);
  console.log("************************************************************");

  if (onProgress) await onProgress(`Đang mở AdsPower profile ${store.profile_id}`, 10);

  const cdpEndpoint = await startAdsPowerProfile(store.profile_id);
  console.log(`[Browser] Kết nối CDP tại: ${cdpEndpoint}...`);

  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error(`Không tìm thấy context trình duyệt của store ${store.store_name}.`);

  let page = context.pages().find((p) => p.url().includes("advertising.amazon.com"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  }

  const downloadedFiles: DownloadedFileInfo[] = [];

  try {
    // 1. Bulk SP 30d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Bulk SP 30 Ngày`, 25);
    const f1 = await requestAndDownloadBulk(page, context, store.store_name, spDir, "SP", 30);
    downloadedFiles.push({
      name: path.basename(f1),
      path: f1,
      relativeSubdir: "SP",
      days: 30,
      type: "BULK_SP",
      sizeBytes: fs.statSync(f1).size,
    });

    // 2. Bulk SB 30d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Bulk SB 30 Ngày`, 40);
    const f2 = await requestAndDownloadBulk(page, context, store.store_name, sbDir, "SB", 30);
    downloadedFiles.push({
      name: path.basename(f2),
      path: f2,
      relativeSubdir: "SB",
      days: 30,
      type: "BULK_SB",
      sizeBytes: fs.statSync(f2).size,
    });

    // 3. Bulk SP 7d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Bulk SP 7 Ngày`, 55);
    const f3 = await requestAndDownloadBulk(page, context, store.store_name, spDir, "SP", 7);
    downloadedFiles.push({
      name: path.basename(f3),
      path: f3,
      relativeSubdir: "SP",
      days: 7,
      type: "BULK_SP",
      sizeBytes: fs.statSync(f3).size,
    });

    // 4. Bulk SB 7d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Bulk SB 7 Ngày`, 70);
    const f4 = await requestAndDownloadBulk(page, context, store.store_name, sbDir, "SB", 7);
    downloadedFiles.push({
      name: path.basename(f4),
      path: f4,
      relativeSubdir: "SB",
      days: 7,
      type: "BULK_SB",
      sizeBytes: fs.statSync(f4).size,
    });

    // 5. Search Term SP 30d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SP 30 Ngày`, 85);
    const f5 = await downloadSearchTerms(page, context, store.store_name, spDir, "SP");
    downloadedFiles.push({
      name: path.basename(f5),
      path: f5,
      relativeSubdir: "SP",
      days: 30,
      type: "ST_SP",
      sizeBytes: fs.statSync(f5).size,
    });

    // 6. Search Term SB 30d
    if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SB 30 Ngày`, 95);
    const f6 = await downloadSearchTerms(page, context, store.store_name, sbDir, "SB");
    downloadedFiles.push({
      name: path.basename(f6),
      path: f6,
      relativeSubdir: "SB",
      days: 30,
      type: "ST_SB",
      sizeBytes: fs.statSync(f6).size,
    });

    await validateDownloadedBatch(downloadedFiles);

    // Ghi manifest riêng cho store này
    const manifestPath = path.join(storeRootDir, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          date: todayStr,
          storeName: store.store_name,
          profileId: store.profile_id,
          files: downloadedFiles,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\n  [Manifest] Đã lưu manifest của [${store.store_name}] tại: ${manifestPath}`);
    if (onProgress) await onProgress(`[${store.store_name}] Đã kiểm tra đủ 6 file, đang publish batch lên R2`, 98);
    await publishCompleteBatch(downloadedFiles, store.store_name, batchDate);
  } finally {
    // 3. ĐÓNG HOÀN TOÀN TRÌNH DUYỆT ĐỂ GIẢI PHÓNG RAM
    console.log(`[AdsPower] Đang ngắt kết nối CDP và đóng AdsPower của store [${store.store_name}]...`);
    await browser.close().catch(() => {});
    await stopAdsPowerProfile(store.profile_id);
    console.log(`[AdsPower] => ĐÃ ĐÓNG HOÀN TOÀN TRÌNH DUYỆT SHOP [${store.store_name}]! (RAM ĐÃ ĐƯỢC GIẢI PHÓNG)`);
  }

  return downloadedFiles;
}

// ============================================================================
// MAIN EXECUTION FLOW (MULTI-STORE LOOP)
// ============================================================================
async function main() {
  const releaseLock = acquireCrawlerLock();
  try {
  const stores = getStoreList();

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;

  console.log("============================================================");
  console.log(`[MAC CRAWLER STREAMING] BẮT ĐẦU CRAWL BÁO CÁO PPC`);
  console.log(`Số lượng Store cấu hình: ${stores.length}`);
  console.log(`Danh sách Store: ${stores.map((s) => s.store_name).join(", ")}`);
  console.log(`Cơ chế: kiểm tra đủ đúng 6 file rồi mới publish batch nguyên tử lên R2.`);
  console.log(`Thời gian bắt đầu: ${new Date().toLocaleString("vi-VN")}`);
  console.log("============================================================");

  let successStores = 0;
  const storeResults: Record<string, { success: boolean; count: number; error?: string }> = {};

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    console.log(`\n============================================================`);
    console.log(`[TIẾN TRÌNH ${i + 1}/${stores.length}]: ĐANG XỬ LÝ STORE [${store.store_name}]`);
    console.log(`============================================================`);

    try {
      const files = await crawlStore(store, todayStr);
      storeResults[store.store_name] = { success: true, count: files.length };
      successStores++;
      console.log(`=> HOÀN TẤT STORE [${store.store_name}]: Tải và đẩy R2 thành công ${files.length}/6 file.`);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`=> [LỖI] Crawl store [${store.store_name}] thất bại: ${msg}`);
      storeResults[store.store_name] = { success: false, count: 0, error: msg };
    }
  }

  console.log("\n============================================================");
  console.log(`[MAC CRAWLER] TỔNG KẾT TIẾN TRÌNH CRAWL ĐA CỬA HÀNG:`);
  console.log(`Hoàn thành: ${successStores}/${stores.length} Store`);
  for (const [sName, res] of Object.entries(storeResults)) {
    console.log(`  - [${sName}]: ${res.success ? `THÀNH CÔNG (${res.count} file)` : `THẤT BẠI (${res.error})`}`);
  }
  console.log("============================================================\n");

  if (successStores !== stores.length) {
    throw new Error(`Batch tổng chưa hoàn tất: chỉ ${successStores}/${stores.length} store thành công.`);
  }
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\n[MAC CRAWLER MULTI-STORE FATAL ERROR]:", err);
    process.exit(1);
  });
}
