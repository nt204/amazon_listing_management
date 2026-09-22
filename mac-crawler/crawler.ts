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
// ============================================================================
// CRAWL LOGIC: ADPOWER SERVICE SNAPSHOT & GUID LOCKING (CHUẨN TỪ PROJECT)
// ============================================================================

interface BulkTableRow {
  guid: string | null;
  text: string;
  href: string | null;
  isSuccess: boolean;
  isDownloading: boolean;
}

function sanitizeRawFileName(name: string, storeName: string): string {
  let clean = path.basename(name);
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_(?:Bulk|Search_Term)_(?:SP|SB)_(?:7|30)Days_`, "ig"), "");
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_(?:Bulk|Search_Term)_`, "ig"), "");
  clean = clean.replace(/^(?:SP|SB)_(?:7|30)Days_/ig, "");
  clean = clean.replace(/^(?:30Days_|7Days_)+/ig, "");
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_`, "ig"), "");
  return clean;
}

async function getBulkTableRows(bulkPage: Page): Promise<BulkTableRow[]> {
  return await bulkPage.evaluate(() => {
    const allRowEls = Array.from(
      document.querySelectorAll("div.ag-row[row-index], tr[row-index], tr[role='row'], table tbody tr"),
    );
    const map = new Map<string, { texts: string[]; href: string | null }>();

    for (const r of allRowEls) {
      const idx = r.getAttribute("row-index") || r.getAttribute("aria-rowindex") || String(Math.random());
      if (!map.has(idx)) {
        map.set(idx, { texts: [], href: null });
      }
      const item = map.get(idx)!;
      const text = (r as HTMLElement).innerText ? (r as HTMLElement).innerText.replace(/\s+/g, " ") : "";
      if (text) item.texts.push(text);

      const a = r.querySelector<HTMLAnchorElement>(
        'a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="BulkSheetExportOutput"], a[href*="bulk-operations/download"]',
      );
      if (a?.href && !item.href) {
        item.href = a.href.startsWith("http") ? a.href : (location.origin + a.href);
      }
    }

    return Array.from(map.values()).map((item) => {
      const fullText = item.texts.join(" ");
      const guidMatch = fullText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const guid = guidMatch ? guidMatch[0].toLowerCase() : null;
      return {
        guid,
        text: fullText,
        href: item.href,
        isSuccess: /Success/i.test(fullText),
        isDownloading: /Downloading|In progress|Pending/i.test(fullText),
      };
    });
  });
}

async function waitForBulkFileDownload(
  destDir: string,
  expectedRawName: string | null,
  timeoutSeconds = 120,
): Promise<string> {
  const parentDir = path.dirname(destDir);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (expectedRawName) {
      const destCandidate = path.join(destDir, expectedRawName);
      const parentCandidate = path.join(parentDir, expectedRawName);

      if (fs.existsSync(destCandidate)) {
        const crdownload = path.join(destDir, `${expectedRawName}.crdownload`);
        if (!fs.existsSync(crdownload)) {
          const stat = fs.statSync(destCandidate);
          if (stat.size > 100_000) return destCandidate;
        }
      }

      if (fs.existsSync(parentCandidate)) {
        const crdownload = path.join(parentDir, `${expectedRawName}.crdownload`);
        if (!fs.existsSync(crdownload)) {
          const stat = fs.statSync(parentCandidate);
          if (stat.size > 100_000) {
            if (fs.existsSync(destCandidate)) {
              try { fs.unlinkSync(destCandidate); } catch {}
            }
            fs.renameSync(parentCandidate, destCandidate);
            return destCandidate;
          }
        }
      }
    }

    const scanDirs = [destDir, parentDir];
    for (const d of scanDirs) {
      if (!fs.existsSync(d)) continue;
      const files = fs.readdirSync(d);
      for (const f of files) {
        if (!f.endsWith(".xlsx") || f.includes(".crdownload") || f.startsWith(".")) continue;
        if (!f.startsWith("bulk-") && !/amazon.*bulk/i.test(f)) continue;
        if (/search.*term|ST_/i.test(f)) continue;

        const fullPath = path.join(d, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 1_000_000 && Date.now() - stat.mtimeMs < 10 * 60 * 1000) {
            if (d === parentDir) {
              const targetPath = path.join(destDir, f);
              if (fs.existsSync(targetPath)) {
                try { fs.unlinkSync(targetPath); } catch {}
              }
              fs.renameSync(fullPath, targetPath);
              return targetPath;
            }
            return fullPath;
          }
        } catch {}
      }
    }
  }

  throw new Error(`Timeout: Không tìm thấy file bulk tải về sau ${timeoutSeconds} giây.`);
}

async function detectActualBulkWorkbookAdType(filePath: string): Promise<"SP" | "SB" | null> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    for (const ws of wb.worksheets) {
      const name = (ws.name || "").toLowerCase();
      if (name.includes("sponsored products") || name.includes("sp campaigns")) return "SP";
      if (name.includes("sponsored brands") || name.includes("sb campaigns") || name.includes("hsa campaigns")) return "SB";
    }
  } catch {}
  return null;
}

async function triggerBulkExport(
  bulkPage: Page,
  entityParam: string,
  adType: "SP" | "SB",
  days: 7 | 30,
): Promise<string> {
  const bulkUrl = `https://advertising.amazon.com/bulk-operations${entityParam}`;

  if (!bulkPage.url().includes("bulk-operations")) {
    await bulkPage.goto(bulkUrl, { waitUntil: "domcontentloaded" });
    await bulkPage.waitForTimeout(2500);
  }

  const currentUrl = bulkPage.url();
  if (currentUrl.includes("/signin") || currentUrl.includes("/ap/signin")) {
    throw new Error(`Profile AdsPower chưa đăng nhập Amazon Seller (URL: ${currentUrl}). Vui lòng đăng nhập trước.`);
  }

  // 1. Mở modal Download campaigns nếu chưa mở
  let isModalOpen = await bulkPage.$(
    'button[data-takt-id="adz_bulkSheets_exportModal_download_button"]',
  );
  if (!isModalOpen) {
    const openModalBtn = await bulkPage.waitForSelector(
      'button[data-takt-id="Bulksheet_home_download_campaigns_button"], button:has-text("Create & download"), button:has-text("Download a bulksheet")',
      { timeout: 25000 },
    ).catch(() => null);

    if (openModalBtn) {
      console.log(`  [BULK] Mở modal Download campaigns...`);
      for (let attempt = 0; attempt < 3; attempt++) {
        await openModalBtn.click().catch(async () => {
          await bulkPage.evaluate((el: any) => el?.click(), openModalBtn);
        });
        const found = await bulkPage.waitForSelector(
          'button[data-takt-id="adz_bulkSheets_exportModal_download_button"]',
          { timeout: 8000 },
        ).catch(() => null);
        if (found) {
          isModalOpen = found;
          break;
        }
        await bulkPage.waitForTimeout(1000);
      }
      if (!isModalOpen) {
        throw new Error("Không thể mở modal Bulksheet sau 3 lần thử click.");
      }
      await bulkPage.waitForTimeout(600);
    }
  }

  // 2. Cấu hình Date Range preset (7 Days hoặc 30 Days)
  const dateBtn = await bulkPage.$(
    'button[aria-label="Open date range picker"], button:has-text(" - 202"), div[data-takt-id="adz_bulkSheets_exportModal"] button:has-text(" - ")',
  );
  if (dateBtn) {
    await dateBtn.click();
    await bulkPage.waitForTimeout(600);

    const targetLabel = `${days} Days`;
    const presetBtn = await bulkPage.$(
      `button[data-takt-id="adz_bulkSheets_exportModal_date_range"]:has-text("${targetLabel}"), div[role="dialog"] button:has-text("${targetLabel}"), button:has-text("${targetLabel}"), button:has-text("Past ${days} days")`,
    );
    if (presetBtn) {
      console.log(`  [BULK] Chọn preset ngày: ${targetLabel}`);
      await presetBtn.click();
      await bulkPage.waitForTimeout(500);

      const applyBtn = await bulkPage.$(
        'button[data-takt-id="adz_bulkSheets_exportModal_date_range-save"], button:has-text("Apply")',
      );
      if (applyBtn) {
        await applyBtn.click();
        await bulkPage.waitForTimeout(600);
      }
    } else {
      await bulkPage.keyboard.press("Escape").catch(() => {});
      await bulkPage.waitForTimeout(300);
    }
  }

  // 3. Cấu hình chính xác các checkbox theo data-takt-id
  const checkTaktIds = [
    "adz_bulkSheets_exportModal_include_performance_data",
    "adz_bulkSheets_exportModal_include_paused",
    "adz_bulkSheets_exportModal_include_zero_impressions",
    "adz_bulkSheets_exportModal_include_placement_data",
    adType === "SP"
      ? "adz_bulkSheets_exportModal_include_sp_data"
      : "adz_bulkSheets_exportModal_include_sb_data",
  ];

  const uncheckTaktIds = [
    adType === "SP"
      ? "adz_bulkSheets_exportModal_include_sb_data"
      : "adz_bulkSheets_exportModal_include_sp_data",
    "adz_bulkSheets_exportModal_include_sp_search_term",
    "adz_bulkSheets_exportModal_include_sb_search_term",
    "adz_bulkSheets_exportModal_include_sd_data",
    "adz_bulkSheets_exportModal_include_terminated",
    "adz_bulkSheets_exportModal_include_brand_asset",
    "adz_bulkSheets_exportModal_include_sp_guidance",
    "adz_bulkSheets_exportModal_include_budget_rules",
    "adz_bulkSheets_exportModal_include_sb_multi_ad_group",
  ];

  for (const tid of checkTaktIds) {
    const input = await bulkPage.$(`input[data-takt-id="${tid}"]`);
    if (input && !(await input.isChecked())) {
      await input.click({ force: true }).catch(() =>
        bulkPage.evaluate((el: any) => el?.click(), input),
      );
      await bulkPage.waitForTimeout(100);
    }
  }

  for (const tid of uncheckTaktIds) {
    const input = await bulkPage.$(`input[data-takt-id="${tid}"]`);
    if (input && (await input.isChecked())) {
      await input.click({ force: true }).catch(() =>
        bulkPage.evaluate((el: any) => el?.click(), input),
      );
      await bulkPage.waitForTimeout(100);
    }
  }

  // Làm mờ input hiện tại
  await bulkPage.evaluate(() => {
    if (document.activeElement && typeof (document.activeElement as HTMLElement).blur === "function") {
      (document.activeElement as HTMLElement).blur();
    }
  });
  await bulkPage.waitForTimeout(300);

  // Chụp danh sách GUID các hàng hiện có trên bảng để nhận diện hàng mới (SNAPSHOT)
  const rowsBefore = await getBulkTableRows(bulkPage);
  const existingGuids = new Set<string>(rowsBefore.map((r) => r.guid).filter(Boolean) as string[]);
  console.log(`  [BULK] Snapshot bảng hiện tại: ${existingGuids.size} file GUID.`);

  // 4. Bấm Download trong modal và lắng nghe phản hồi POST để khóa exportRequestId
  const modalDownload = await bulkPage.$(
    'button[data-takt-id="adz_bulkSheets_exportModal_download_button"], button:text-is("Download"), button[type="submit"]',
  );
  if (!modalDownload) {
    throw new Error("Không tìm thấy nút Download trong modal Bulksheet");
  }

  console.log(`  [BULK] Đang bấm Download để Amazon tạo file Bulk ${adType} ${days}d...`);
  const exportPromise = bulkPage.waitForResponse(
    (res: any) =>
      res.url().includes("/bulk-operations/export") &&
      res.request().method() === "POST",
    { timeout: 15000 },
  ).catch(() => null);

  await modalDownload.click().catch(async () => {
    await bulkPage.evaluate((btn: any) => btn?.click(), modalDownload);
  });

  // Chờ modal đóng
  await bulkPage
    .waitForSelector('button[data-takt-id="adz_bulkSheets_exportModal_download_button"]', {
      state: "detached",
      timeout: 8000,
    })
    .catch(() => {});

  const exportRes = await exportPromise;
  let targetRequestId: string | null = null;
  if (exportRes && exportRes.status() >= 200 && exportRes.status() < 300) {
    try {
      const json = await exportRes.json();
      targetRequestId = (json.exportRequestId || json.requestId || json.id || "").toLowerCase() || null;
      if (targetRequestId) {
        console.log(`  [BULK] 🔒 Khóa mã targetRequestId từ response mạng: ${targetRequestId}`);
      }
    } catch {}
  }

  // Nếu API không trả về exportRequestId trực tiếp, dò tìm hàng mới xuất hiện ở đầu bảng so với snapshot
  if (!targetRequestId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await bulkPage.waitForTimeout(1500);
      const rowsAfter = await getBulkTableRows(bulkPage);
      const newRow = rowsAfter.find((r) => r.guid && !existingGuids.has(r.guid));
      if (newRow?.guid) {
        targetRequestId = newRow.guid;
        console.log(`  [BULK] 🔒 Khóa mã targetRequestId từ snapshot bảng: ${targetRequestId}`);
        break;
      }
    }
  }

  if (!targetRequestId) {
    const currentRows = await getBulkTableRows(bulkPage);
    if (currentRows.length > 0 && currentRows[0].guid) {
      targetRequestId = currentRows[0].guid;
      console.log(`  [BULK] 🔒 Sử dụng requestId từ hàng đầu tiên: ${targetRequestId}`);
    }
  }

  if (!targetRequestId) {
    throw new Error(`[BULK] Không thể khóa mã ID (exportRequestId) cho Bulk ${adType} ${days}d.`);
  }

  return targetRequestId;
}

interface BulkTaskItem {
  adType: "SP" | "SB";
  days: 7 | 30;
  requestId: string;
  filePath?: string;
}

async function downloadBulkFileByRow(
  bulkPage: Page,
  task: { adType: "SP" | "SB"; days: 7 | 30; requestId: string },
  downloadUrl: string,
  storeName: string,
  spDir: string,
  sbDir: string,
): Promise<{ savedPath: string; actualAdType: "SP" | "SB"; targetDir: string }> {
  console.log(`  [BULK] Bắt đầu tải file cho ${task.adType} ${task.days}d (Khớp ID: ${task.requestId})...`);

  const guid = task.requestId;
  const expectedRawName = downloadUrl.match(/bulk-[^/?]+\.xlsx/i)?.[0] || null;
  const directLinkEl = await bulkPage.$(`a[href*="${guid}"]`).catch(() => null)
    || await bulkPage.$(`.ag-row:has-text("${guid}") a, tr:has-text("${guid}") a`).catch(() => null);

  const initialDir = task.adType === "SP" ? spDir : sbDir;
  let standardizedPath: string | null = null;

  try {
    const [download] = await Promise.all([
      bulkPage.waitForEvent("download", { timeout: 60_000 }),
      (async () => {
        if (directLinkEl) {
          await directLinkEl.click().catch(async () => {
            await bulkPage.evaluate((el: any) => el?.click(), directLinkEl);
          });
        } else {
          await bulkPage.evaluate((url: string) => {
            const a = document.createElement("a");
            a.href = url;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }, downloadUrl);
        }
      })(),
    ]);

    const suggestedName = download.suggestedFilename();
    const cleanRawName = sanitizeRawFileName(suggestedName, storeName);
    const standardizedName = `${storeName}_Bulk_${task.adType}_${task.days}Days_${cleanRawName}`;
    standardizedPath = path.join(initialDir, standardizedName);
    try {
      await download.saveAs(standardizedPath);
    } catch {}
  } catch {}

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    const downloadedPath = await waitForBulkFileDownload(initialDir, expectedRawName, 120);
    const rawName = path.basename(downloadedPath);
    const cleanRawName = sanitizeRawFileName(rawName, storeName);
    const standardizedName = `${storeName}_Bulk_${task.adType}_${task.days}Days_${cleanRawName}`;
    standardizedPath = path.join(initialDir, standardizedName);
    if (downloadedPath !== standardizedPath) {
      if (fs.existsSync(standardizedPath)) {
        try { fs.unlinkSync(standardizedPath); } catch {}
      }
      fs.renameSync(downloadedPath, standardizedPath);
    }
  }

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    throw new Error(`Không tìm thấy file Bulk sau khi tải và chuẩn hóa (ID: ${task.requestId}).`);
  }

  // Tự động kiểm tra sheet bên trong file để đảm bảo gắn nhãn SP/SB chính xác 100%
  const actualAdType = await detectActualBulkWorkbookAdType(standardizedPath).catch(() => null);
  const effectiveAdType = actualAdType || task.adType;
  const correctTargetDir = effectiveAdType === "SP" ? spDir : sbDir;

  const rawName = path.basename(standardizedPath);
  const cleanRawName = sanitizeRawFileName(rawName, storeName);
  const correctedName = `${storeName}_Bulk_${effectiveAdType}_${task.days}Days_${cleanRawName}`;
  const correctedPath = path.join(correctTargetDir, correctedName);

  if (correctedPath !== standardizedPath) {
    if (fs.existsSync(correctedPath)) {
      try { fs.unlinkSync(correctedPath); } catch {}
    }
    fs.renameSync(standardizedPath, correctedPath);
    standardizedPath = correctedPath;
  }

  const bulkSizeMb = (fs.statSync(standardizedPath).size / 1024 / 1024).toFixed(1);
  console.log(
    `  [BULK] ✅ TẢI THÀNH CÔNG: ${path.basename(standardizedPath)} (${bulkSizeMb} MB) [Khớp ID: ${task.requestId}]`,
  );

  return { savedPath: standardizedPath, actualAdType: effectiveAdType, targetDir: correctTargetDir };
}

async function createAndDownloadAllBulkReports(
  bulkPage: Page,
  entityParam: string,
  storeName: string,
  spDir: string,
  sbDir: string,
  onProgress?: ProgressCallback,
): Promise<DownloadedFileInfo[]> {
  const tasks: BulkTaskItem[] = [
    { adType: "SP", days: 30, requestId: "" },
    { adType: "SB", days: 30, requestId: "" },
    { adType: "SP", days: 7, requestId: "" },
    { adType: "SB", days: 7, requestId: "" },
  ];

  console.log(`\n================================================================`);
  console.log(`🔒 [BULK PHA 1] KHÓA MÃ ID (exportRequestId) NGAY KHI BẤM`);
  console.log(`Quy tắc: Bấm SP 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SP 7d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 7d ➔ Ghi nhớ ID`);
  console.log(`================================================================\n`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n[BULK PHA 1] [${i + 1}/4] Kích hoạt tạo Bulk ${task.adType} ${task.days} Days...`);
    if (onProgress) await onProgress(`[${storeName}] Kích hoạt Bulk ${task.adType} ${task.days}d`, 20 + i * 5);

    task.requestId = await triggerBulkExport(bulkPage, entityParam, task.adType, task.days);
    console.log(`[BULK PHA 1] 🔒 ĐÃ GHI NHỚ: ${task.adType}_${task.days}D = ${task.requestId}`);

    if (i < tasks.length - 1) {
      console.log(`[BULK PHA 1] Chờ 6s bảo vệ rate limit trước khi tạo file tiếp theo...`);
      await bulkPage.waitForTimeout(6000);
    }
  }

  console.log(`\n================================================================`);
  console.log(`🔒 [BULK PHA 1 HOÀN TẤT] ĐÃ KHÓA TOÀN BỘ 4 MÃ GUID TỪ AMAZON:`);
  tasks.forEach((t) => console.log(`   * ${t.adType}_${t.days}D: ID = ${t.requestId}`));
  console.log(`================================================================\n`);

  console.log(`\n================================================================`);
  console.log(`⏳ [BULK PHA 2] CHỜ VÀ BỐC ĐÚNG FILE THEO TỪNG MÃ ID ĐÃ KHÓA`);
  console.log(`Amazon xử lý song song cả 4 file. Hàng có ID nào xong thì bốc đúng file của ID đó.`);
  console.log(`================================================================\n`);

  const deadline = Date.now() + 1_800_000; // Tối đa 30 phút
  let pollIteration = 0;
  const usedHrefs = new Set<string>();
  const results: DownloadedFileInfo[] = [];

  while (Date.now() < deadline && tasks.some((t) => !t.filePath)) {
    pollIteration++;
    const rows = await getBulkTableRows(bulkPage);

    for (const task of tasks) {
      if (task.filePath) continue;

      const matchingRow = rows.find(
        (r) =>
          (r.guid && r.guid.toLowerCase() === task.requestId.toLowerCase()) ||
          (r.text && r.text.toLowerCase().includes(task.requestId.toLowerCase())),
      );

      if (matchingRow && matchingRow.isSuccess && matchingRow.href && !usedHrefs.has(matchingRow.href)) {
        console.log(`\n[BULK PHA 2] 🎯 Hàng ID ${task.requestId} (${task.adType} ${task.days}d) ĐÃ XONG (Success)! Bắt đầu bốc file...`);
        usedHrefs.add(matchingRow.href);

        const { savedPath, actualAdType } = await downloadBulkFileByRow(
          bulkPage,
          task,
          matchingRow.href,
          storeName,
          spDir,
          sbDir,
        );

        task.filePath = savedPath;
        results.push({
          name: path.basename(savedPath),
          path: savedPath,
          relativeSubdir: actualAdType,
          days: task.days,
          type: `BULK_${actualAdType}`,
          sizeBytes: fs.statSync(savedPath).size,
        });

        if (onProgress) await onProgress(`[${storeName}] Tải xong Bulk ${actualAdType} ${task.days}d`, 40 + results.length * 8);
      }
    }

    const remaining = tasks.filter((t) => !t.filePath);
    if (remaining.length === 0) {
      console.log(`\n[BULK PHA 2] 🎉 TẤT CẢ 4 FILE BULK ĐÃ ĐƯỢC BỐC XONG CHÍNH XÁC THEO MÃ ID!`);
      break;
    }

    const remainingSummary = remaining.map((t) => `${t.adType}_${t.days}D (${t.requestId.slice(0, 8)}...)`).join(", ");
    console.log(`[BULK PHA 2] Đang chờ Amazon hoàn tất: ${remainingSummary} (refresh sau 12s)...`);
    await bulkPage.waitForTimeout(12000);

    if (pollIteration % 2 === 0) {
      await bulkPage.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await bulkPage.waitForTimeout(2000);
    } else {
      const refreshBtn = await bulkPage.$(
        'button[aria-label*="Refresh"], button:has-text("Refresh")',
      );
      if (refreshBtn) {
        await refreshBtn.click().catch(() => {});
      }
    }
  }

  const missing = tasks.filter((t) => !t.filePath);
  if (missing.length > 0) {
    throw new Error(`[BULK] Timeout: Không hoàn tất đủ 4 file Bulk. Thiếu: ${missing.map((m) => `${m.adType}_${m.days}D`).join(", ")}`);
  }

  return results;
}

// ============================================================================
// CRAWL LOGIC: SEARCH TERM (GẮN syncRunId ĐỂ TRÁNH TẢI NHẦM FILE CŨ)
// ============================================================================

async function autoCreateAndDownloadSearchTermReport(
  page: Page,
  entityParam: string,
  adType: "SP" | "SB",
  storeName: string,
  destDir: string,
): Promise<DownloadedFileInfo> {
  console.log(`\n  ========================================`);
  console.log(`  [SEARCH TERM] Bắt đầu tải Search Term ${adType} (30 ngày)...`);
  console.log(`  ========================================`);

  const syncRunId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const reportName = `${storeName} ST ${adType} 30D ${today} ${syncRunId}`;
  let downloadUrl: string | null = null;

  // 1. Tự động vào trang /reports/new để tạo báo cáo mới có syncRunId duy nhất
  console.log(`  [SEARCH TERM] Tự động tạo mới Search Term ${adType} với ID [${syncRunId}]...`);
  const createUrl = `https://advertising.amazon.com/reports/new${entityParam}`;
  await page.goto(createUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#urc_run_subscription_button, #report-settings-card-report-name-input", { timeout: 8000 }).catch(() => {});

  if (adType === "SB") {
    const catBtn = await page.$("#report-configuration-form\\:report-category-control-component-0");
    if (catBtn) {
      await catBtn.click();
      const sbOpt = await page.waitForSelector('[role="option"]:has-text("Sponsored Brands"), li:has-text("Sponsored Brands")', { timeout: 3000 }).catch(() => null);
      if (sbOpt) {
        await sbOpt.click();
        await page.waitForTimeout(300);
      }
    }
  }

  const typeBtn = await page.$("#report-configuration-form\\:report-type-control-component-0");
  if (typeBtn) {
    const currentText = await typeBtn.innerText();
    if (!/Search term/i.test(currentText)) {
      await typeBtn.click();
      const stOpt = await page.waitForSelector('[role="option"]:has-text("Search term"), li:has-text("Search term")', { timeout: 3000 }).catch(() => null);
      if (stOpt) {
        await stOpt.click();
        await page.waitForTimeout(300);
      }
    }
  }

  const dayRadio = await page.$("#time-units-day, input[value='DAILY'], label[for='time-units-day']");
  if (dayRadio) {
    await dayRadio.click().catch(() => page.evaluate((el: any) => el?.click(), dayRadio));
    await page.waitForTimeout(300);
  }

  const nameInput = await page.$("#report-settings-card-report-name-input");
  if (nameInput) {
    await nameInput.fill(reportName);
  }

  const runBtn = await page.$("#urc_run_subscription_button");
  if (runBtn) {
    await runBtn.click().catch(async () => {
      await page.evaluate((el: any) => el?.click(), runBtn);
    });
    console.log(`  [SEARCH TERM] Đã bấm Run report cho Search Term ${adType} (${syncRunId})!`);
    await page.waitForTimeout(2500);
  }

  const reportsUrl = `https://advertising.amazon.com/reports${entityParam}`;
  if (!page.url().includes("/reports?")) {
    await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
  }

  // 2. Chờ Amazon tạo xong và tìm đúng row chứa syncRunId có trạng thái Completed
  const deadline = Date.now() + 240_000; // Tối đa 4 phút cho Search Term
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);

    const match = await page.evaluate((args: { targetId: string; adType: string }) => {
      const allRowEls = Array.from(document.querySelectorAll("div.ag-row[row-index], tr[row-index], table tbody tr"));
      const rowIndexMap = new Map<string, { texts: string[]; href: string | null }>();

      for (const r of allRowEls) {
        const idx = r.getAttribute("row-index") || r.getAttribute("aria-rowindex") || String(Math.random());
        if (!rowIndexMap.has(idx)) {
          rowIndexMap.set(idx, { texts: [], href: null });
        }
        const entry = rowIndexMap.get(idx)!;
        const txt = ((r as HTMLElement).innerText || "").trim();
        if (txt) entry.texts.push(txt);

        const link = r.querySelector<HTMLAnchorElement>(
          "a[data-takt-id='storm-ui-link'], a[href*='download-report'], a[href*='download']"
        );
        if (link?.href && !entry.href) {
          entry.href = link.href.startsWith("http") ? link.href : (location.origin + link.href);
        }
      }

      // 1. Ưu tiên khớp chính xác syncRunId vừa tạo
      for (const [idx, entry] of rowIndexMap.entries()) {
        const fullText = entry.texts.join(" ");
        if (fullText.includes(args.targetId)) {
          const isCompleted = /completed|success|downloadable/i.test(fullText) || Boolean(entry.href);
          return { found: true, isCompleted, href: entry.href };
        }
      }

      return { found: false, isCompleted: false, href: null };
    }, { targetId: syncRunId, adType });

    if (match.found && match.isCompleted && match.href) {
      downloadUrl = match.href;
      console.log(`  [SEARCH TERM] ✅ Đã tìm thấy file báo cáo hoàn tất khớp ID [${syncRunId}]!`);
      break;
    }

    const refreshBtn = await page.$("button[aria-label*='Refresh'], button:has-text('Refresh')");
    if (refreshBtn) {
      await refreshBtn.click().catch(() => {});
    } else {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }

  if (!downloadUrl) {
    throw new Error(`Timeout: Không tạo xong file Search Term ${adType} với ID ${syncRunId} sau 4 phút.`);
  }

  // 3. Tải file về thư mục chỉ định
  console.log(`  [SEARCH TERM] Bắt đầu tải file: ${downloadUrl}`);
  const allGuids = downloadUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  const reportId = allGuids[allGuids.length - 1] || "";
  let directLinkEl = reportId
    ? (await page.$(`a[href*="download-report"][href*="${reportId}"]`)) ||
      (await page.$(`a[href*="${reportId}"]`))
    : null;

  let standardizedPath: string | null = null;
  const beforeStats = getFileStatsMap(destDir);

  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      (async () => {
        if (directLinkEl) {
          await directLinkEl.click().catch(async () => {
            await page.evaluate((el: any) => el?.click(), directLinkEl);
          });
        } else {
          await page.evaluate((url: string) => {
            const a = document.createElement("a");
            a.href = url;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }, downloadUrl);
        }
      })(),
    ]);

    const suggestedName = download.suggestedFilename();
    const cleanRawName = sanitizeRawFileName(suggestedName, storeName);
    const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${cleanRawName}`;
    standardizedPath = path.join(destDir, standardizedName);
    try {
      await download.saveAs(standardizedPath);
    } catch {}
  } catch {}

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    const downloadedPath = await waitForNewDownload(destDir, beforeStats, 60);
    if (!downloadedPath) throw new Error(`Không tải được file Search Term ${adType}`);
    const rawName = path.basename(downloadedPath);
    const cleanRawName = sanitizeRawFileName(rawName, storeName);
    const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${cleanRawName}`;
    standardizedPath = path.join(destDir, standardizedName);
    if (downloadedPath !== standardizedPath) {
      if (fs.existsSync(standardizedPath)) {
        try { fs.unlinkSync(standardizedPath); } catch {}
      }
      fs.renameSync(downloadedPath, standardizedPath);
    }
  }

  const stat = fs.statSync(standardizedPath);
  console.log(
    `  [SEARCH TERM] ✅ TẢI THÀNH CÔNG: ${path.basename(standardizedPath)} (${(stat.size / 1024).toFixed(1)} KB) [Khớp ID: ${syncRunId}]`,
  );

  return {
    name: path.basename(standardizedPath),
    path: standardizedPath,
    relativeSubdir: adType,
    days: 30,
    type: `ST_${adType}`,
    sizeBytes: stat.size,
  };
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
    // 1. Tự động tạo và tải 4 file Bulk theo quy trình 2 pha (Khóa exportRequestId + Snapshot bảng)
    const entityId = page.url().match(/entityId=([A-Z0-9]+)/)?.[1] || "";
    const entityParam = entityId ? `?entityId=${entityId}` : "";
    const bulkFiles = await createAndDownloadAllBulkReports(page, entityParam, store.store_name, spDir, sbDir, onProgress);
    downloadedFiles.push(...bulkFiles);

    // 2. Search Term SP 30d (Gắn syncRunId duy nhất)
    if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SP 30 Ngày`, 85);
    const stSp = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SP", store.store_name, spDir);
    downloadedFiles.push(stSp);

    // 3. Search Term SB 30d (Gắn syncRunId duy nhất)
    if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SB 30 Ngày`, 95);
    const stSb = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SB", store.store_name, sbDir);
    downloadedFiles.push(stSb);

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
