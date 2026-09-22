import { chromium, type BrowserContext, type Page } from "playwright-core";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import ExcelJS from "exceljs";
import {
  type ReportTaskType,
  type ReportTaskState,
  type JobCheckpoint,
  computeFileSha256,
  loadJobCheckpoint,
  saveJobCheckpointAtomic,
  createDefaultTasksForStore,
} from "./checkpoint";

export function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function envInt(name: string, fallback: number, min = 1, max = 10_000): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(`CRAWLER_ABORTED: ${String(signal.reason || "Job bị hủy hoặc mất lease")}`);
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () =>
      reject(new Error(`CRAWLER_ABORTED: ${String(signal.reason || "Job bị hủy hoặc mất lease")}`)),
    { once: true })),
  ]);
}

async function retryWithBackoff<T>(
  label: string,
  maxAttempts: number,
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  const baseDelaySeconds = envInt("RETRY_BASE_DELAY_SECONDS", 5, 1, 300);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if ((error as Error).message.includes("CRAWLER_ABORTED")) break;
      if (attempt >= maxAttempts) break;
      const delaySeconds = Math.min(120, baseDelaySeconds * 2 ** (attempt - 1));
      console.warn(`[RETRY] ${label} lỗi lần ${attempt}/${maxAttempts}: ${(error as Error).message}. Thử lại sau ${delaySeconds}s...`);
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} thất bại sau ${maxAttempts} lần.`);
}


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

function testDirWritable(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe_${Date.now()}`);
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

const safeDownloadDir = path.join(os.homedir(), "AmazonPpcCrawler", "downloads");
const configuredDownloadDir = (process.env.DOWNLOAD_BASE_DIR || safeDownloadDir)
  .replace("$HOME", os.homedir()).replace("~", os.homedir());
const BASE_DOWNLOAD_DIR = testDirWritable(configuredDownloadDir) ? configuredDownloadDir : safeDownloadDir;
if (BASE_DOWNLOAD_DIR !== configuredDownloadDir) {
  console.warn(`[CONFIG] Không có quyền ghi vào ${configuredDownloadDir} (macOS TCC); chuyển sang: ${BASE_DOWNLOAD_DIR}`);
}

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

export async function publishCompleteBatchWithStaging(
  files: DownloadedFileInfo[],
  storeName: string,
  batchDate: string,
  batchId?: string,
  tasks?: ReportTaskState[],
  signal?: AbortSignal,
): Promise<void> {
  if (files.length !== 6) throw new Error(`Batch ${storeName} chưa đủ 6 file.`);
  const s3 = getS3Client();
  if (!s3) throw new Error("Thiếu credentials R2.");

  const prefix = (process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "");
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const finalBatchId = batchId || `${storeName}_${batchDate.replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`\n============================================================`);
  console.log(`[R2 STAGING & PUBLISH] BẮT ĐẦU ĐẨY BATCH ${finalBatchId}`);
  console.log(`============================================================`);

  const manifestEntries: Array<{
    type: string;
    days: number;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    finalKey: string;
  }> = [];

  for (const file of files) {
    throwIfAborted(signal);
    const fileName = path.basename(file.path);
    const finalKey = `${prefix}/input/${batchDate.replace(/-/g, "")}/${storeName}/${finalBatchId}/${file.relativeSubdir}/${fileName}`;
    const sha256 = await computeFileSha256(file.path);

    // File được upload đúng một lần vào batch riêng. Batch chưa có
    // _COMPLETE.json không bao giờ được ingest, nên marker chính là commit atom.
    console.log(`  [R2 PUBLISH] Đang upload: ${finalKey}...`);
    const uploadAttempts = envInt("R2_UPLOAD_MAX_ATTEMPTS", 5, 1, 10);
    await retryWithBackoff(`Publish R2 ${fileName}`, uploadAttempts, async () => {
      throwIfAborted(signal);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: finalKey,
        Body: fs.createReadStream(file.path),
        ContentType: fileName.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
      }), { abortSignal: signal });
    });

    manifestEntries.push({
      type: file.type,
      days: file.days,
      fileName,
      sizeBytes: file.sizeBytes,
      sha256,
      finalKey,
    });

    if (tasks) {
      const matchedTask = tasks.find((t) =>
        t.store === storeName && t.type === file.type && t.days === file.days &&
        (!t.localPath || path.resolve(t.localPath) === path.resolve(file.path)),
      );
      if (matchedTask) {
        matchedTask.status = "UPLOADED";
        matchedTask.sha256 = sha256;
        matchedTask.r2Key = finalKey;
      }
    }
  }

  // Ghi file chốt hạ cuối cùng. Reader chỉ nhìn thấy batch sau bước này.
  const markerKey = `${prefix}/input/${batchDate.replace(/-/g, "")}/${storeName}/${finalBatchId}/_COMPLETE.json`;
  throwIfAborted(signal);
  await retryWithBackoff("Publish R2 complete marker", envInt("R2_UPLOAD_MAX_ATTEMPTS", 5, 1, 10), async () => s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: markerKey,
      Body: JSON.stringify(
        {
          version: 2,
          batchId: finalBatchId,
          storeName,
          batchDate: batchDate.replace(/-/g, ""),
          completedAt: new Date().toISOString(),
          files: manifestEntries.map((f) => f.finalKey),
          checksums: manifestEntries.map((f) => ({ key: f.finalKey, sha256: f.sha256, sizeBytes: f.sizeBytes })),
        },
        null,
        2,
      ),
      ContentType: "application/json",
    }), { abortSignal: signal },
  ));
  console.log(`[R2] ✅ Đã chốt hạ marker nguyên tử: ${markerKey}`);
}

// Giữ alias tương thích
async function publishCompleteBatch(
  files: DownloadedFileInfo[],
  storeName: string,
  batchDate: string,
): Promise<void> {
  await publishCompleteBatchWithStaging(files, storeName, batchDate);
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

async function ensureAdsPowerApiReady(): Promise<void> {
  const isReady = async () => {
    try {
      const response = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/local-active`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await isReady()) return;

  if (process.platform !== "darwin") {
    throw new Error(`AdsPower Local API chưa sẵn sàng tại ${ADSPOWER_API_URL}.`);
  }

  const appName = process.env.ADSPOWER_APP_NAME || "AdsPower Global";
  console.log(`[AdsPower] Local API chưa sẵn sàng; đang mở ứng dụng "${appName}"...`);
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/open", ["-a", appName], (error) => error ? reject(error) : resolve());
  }).catch((error) => {
    throw new Error(`Không thể mở ứng dụng ${appName}: ${(error as Error).message}`);
  });

  const deadline = Date.now() + envInt("ADSPOWER_APP_START_TIMEOUT_SECONDS", 60, 10, 180) * 1000;
  while (Date.now() < deadline) {
    if (await isReady()) {
      console.log("[AdsPower] Local API đã sẵn sàng.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`AdsPower đã được mở nhưng Local API chưa sẵn sàng tại ${ADSPOWER_API_URL}.`);
}

async function startAdsPowerProfileWithRetry(profileId: string): Promise<string> {
  try {
    await ensureAdsPowerApiReady();
    return await retryWithBackoff(
      `Mở AdsPower profile ${profileId}`,
      envInt("ADSPOWER_MAX_ATTEMPTS", 3, 1, 5),
      async (attempt) => {
        if (attempt > 1) await stopAdsPowerProfile(profileId);
        return startAdsPowerProfile(profileId);
      },
    );
  } catch (error) {
    await stopAdsPowerProfile(profileId);
    throw error;
  }
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

async function waitForNewDownload(dir: string, beforeStats: Map<string, number>, timeoutSec = 60, signal?: AbortSignal): Promise<string | null> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
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
  signal?: AbortSignal,
): Promise<string> {
  const parentDir = path.dirname(destDir);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
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
  signal?: AbortSignal,
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
      raceWithAbort(bulkPage.waitForEvent("download", { timeout: 60_000 }), signal),
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
    const downloadedPath = await waitForBulkFileDownload(initialDir, expectedRawName, 120, signal);
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
  requestedSlots?: Array<{ adType: "SP" | "SB"; days: number }>,
  checkpointTasks?: ReportTaskState[],
  saveCheckpoint?: () => void,
  signal?: AbortSignal,
): Promise<DownloadedFileInfo[]> {
  const allTasks: BulkTaskItem[] = [
    { adType: "SP", days: 30, requestId: "" },
    { adType: "SB", days: 30, requestId: "" },
    { adType: "SP", days: 7, requestId: "" },
    { adType: "SB", days: 7, requestId: "" },
  ];
  const tasks = requestedSlots?.length
    ? allTasks.filter((task) => requestedSlots.some((slot) => slot.adType === task.adType && slot.days === task.days))
    : allTasks;
  for (const task of tasks) {
    const saved = checkpointTasks?.find((item) => (!item.store || item.store === storeName) && item.type === `BULK_${task.adType}` && item.days === task.days);
    if (saved?.amazonRequestId && ["AMAZON_PROCESSING", "RETRY_WAIT", "DOWNLOADABLE"].includes(saved.status)) {
      task.requestId = saved.amazonRequestId;
      console.log(`[BULK RESUME] ♻️ Tiếp tục theo dõi ${task.adType}_${task.days}D ID ${task.requestId}, không tạo lại.`);
    }
  }

  console.log(`\n================================================================`);
  console.log(`🔒 [BULK PHA 1] KHÓA MÃ ID (exportRequestId) NGAY KHI BẤM`);
  console.log(`Quy tắc: Bấm SP 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SP 7d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 7d ➔ Ghi nhớ ID`);
  console.log(`================================================================\n`);

  for (let i = 0; i < tasks.length; i++) {
    throwIfAborted(signal);
    const task = tasks[i];
    if (task.requestId) continue;
    console.log(`\n[BULK PHA 1] [${i + 1}/4] Kích hoạt tạo Bulk ${task.adType} ${task.days} Days...`);
    if (onProgress) await onProgress(`[${storeName}] Kích hoạt Bulk ${task.adType} ${task.days}d`, 20 + i * 5);

    task.requestId = await triggerBulkExport(bulkPage, entityParam, task.adType, task.days);
    const checkpointTask = checkpointTasks?.find((item) => (!item.store || item.store === storeName) && item.type === `BULK_${task.adType}` && item.days === task.days);
    if (checkpointTask) {
      checkpointTask.amazonRequestId = task.requestId;
      checkpointTask.status = "AMAZON_PROCESSING";
      checkpointTask.attempt += 1;
      checkpointTask.lastError = null;
      saveCheckpoint?.();
    }
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
    throwIfAborted(signal);
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
          signal,
        );

        task.filePath = savedPath;
        const checkpointTask = checkpointTasks?.find((item) => (!item.store || item.store === storeName) && item.type === `BULK_${actualAdType}` && item.days === task.days);
        if (checkpointTask) {
          checkpointTask.status = "DOWNLOADED";
          checkpointTask.localPath = savedPath;
          checkpointTask.sizeBytes = fs.statSync(savedPath).size;
          checkpointTask.lastError = null;
          saveCheckpoint?.();
        }
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
      console.log(`\n[BULK PHA 2] 🎉 TẤT CẢ ${tasks.length} FILE BULK CÒN THIẾU ĐÃ ĐƯỢC BỐC XONG!`);
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
    for (const missingTask of missing) {
      const checkpointTask = checkpointTasks?.find((item) => (!item.store || item.store === storeName) && item.type === `BULK_${missingTask.adType}` && item.days === missingTask.days);
      if (checkpointTask) {
        checkpointTask.lastError = `Bulk request ${missingTask.requestId} không hoàn tất trong 30 phút`;
        checkpointTask.amazonRequestId = null;
        checkpointTask.status = checkpointTask.attempt >= 3 ? "FAILED" : "NOT_STARTED";
      }
    }
    saveCheckpoint?.();
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
  task?: ReportTaskState,
  saveCheckpoint?: () => void,
  signal?: AbortSignal,
): Promise<DownloadedFileInfo> {
  throwIfAborted(signal);
  console.log(`\n  ========================================`);
  console.log(`  [SEARCH TERM] Bắt đầu xử lý Search Term ${adType} (30 ngày)...`);
  console.log(`  ========================================`);

  const canResumeRequest = Boolean(
    task?.amazonRequestId &&
    ["REQUESTED", "AMAZON_PROCESSING", "DOWNLOADABLE", "RETRY_WAIT"].includes(task.status),
  );
  const syncRunId = canResumeRequest
    ? String(task!.amazonRequestId)
    : Math.random().toString(36).slice(2, 8).toUpperCase();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const now = new Date();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const todayMonthDay = `${monthNames[now.getMonth()]} ${now.getDate()}`;
  const reportName = canResumeRequest && task?.reportName
    ? task.reportName
    : `${storeName} ST ${adType} 30D ${today} ${syncRunId}`;
  let downloadUrl: string | null = null;

  if (task && !canResumeRequest) {
    const maxCreates = 1 + envInt("AMAZON_REPORT_MAX_RECREATE", 2, 0, 5);
    if ((task.attempt || 0) >= maxCreates) {
      task.status = "FAILED";
      task.lastError = `Đã hết giới hạn ${maxCreates} lần tạo report Amazon`;
      saveCheckpoint?.();
      throw new Error(`Search Term ${adType} đã hết giới hạn tạo lại report (${maxCreates} lần).`);
    }
    task.amazonRequestId = syncRunId;
    task.reportName = reportName;
    // Chỉ chuyển sang AMAZON_PROCESSING sau khi click Run thành công. Nếu form lỗi
    // trước lúc submit, lần retry phải tạo lại thay vì poll một ID chưa tồn tại.
    task.status = "NOT_STARTED";
    task.attempt = (task.attempt || 0) + 1;
    task.lastError = null;
    saveCheckpoint?.();
  }

  // 1. KIỂM TRA TRƯỚC: Nếu trên trang /reports đã có sẵn báo cáo Search Term hoàn thành hôm nay, bốc luôn không cần tạo lại
  const reportsUrl = `https://advertising.amazon.com/reports${entityParam}`;
  console.log(`  [SEARCH TERM] Kiểm tra danh sách báo cáo trên Amazon: ${reportsUrl}`);
  await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const existingDownloadUrl = await page.evaluate((args: { targetId: string; adType: string; today: string; todayMonthDay: string }) => {
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
        "a[data-takt-id='storm-ui-link'], a[href*='download-report'], a[href*='download'], a[href*='export']"
      );
      if (link?.href && !entry.href) {
        entry.href = link.href.startsWith("http") ? link.href : (location.origin + link.href);
      }
    }

    const adTypeLabel = args.adType === "SB" ? "Sponsored Brands" : "Sponsored Products";
    for (const [, entry] of rowIndexMap.entries()) {
      const fullText = entry.texts.join(" ");
      const hasSearchTerm = /search\s*term/i.test(fullText);
      const hasAdType = fullText.includes(args.adType) || fullText.includes(adTypeLabel);
      const hasToday = fullText.includes(args.today) || fullText.includes(args.todayMonthDay);
      if (hasSearchTerm && hasAdType && hasToday && entry.href) {
        return entry.href;
      }
    }
    return null;
  }, { targetId: syncRunId, adType, today, todayMonthDay });

  if (existingDownloadUrl) {
    console.log(`  [SEARCH TERM] ⚡ PHÁT HIỆN BÁO CÁO CÓ SẴN! Đã có sẵn Search Term ${adType} hoàn thành trên Amazon. Bốc file ngay!`);
    downloadUrl = existingDownloadUrl;
  }

  // 2. Nếu chưa có báo cáo sẵn, tiến hành tạo mới trên Amazon
  if (!downloadUrl && !canResumeRequest) {
    console.log(`  [SEARCH TERM] Chưa có file sẵn. Tự động mở form tạo mới Search Term ${adType} (ID: ${syncRunId})...`);
    
    // Thử vào thẳng link tạo báo cáo hoặc click nút "Create report"
    const createUrl = `https://advertising.amazon.com/reports/new${entityParam}`;
    await page.goto(createUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);

    const nameSelectors = [
      "#report-settings-card-report-name-input",
      'input[id*="report-settings-card"]',
      'input[id*="report-name"]',
      'input[data-testid*="report-name"]',
      'input[name*="reportName"]',
      'input[name*="report-name"]',
      'input[aria-label*="Report name" i]',
      'input[placeholder*="Report name" i]',
    ];

    let nameInput = await page.$(nameSelectors.join(", "));
    if (!nameInput) {
      const createBtnSelectors = [
        'button[data-takt-id="storm-ui-button"][data-takt-feature*="urc-subscriptions-table-container"]',
        'button[data-takt-feature*="urc-subscriptions-table-container"]',
        'button[data-testid*="create-report"]',
        'button:has-text("Create report")',
        'a:has-text("Create report")',
        'a[href*="/reports/new"]',
      ];
      for (const cSel of createBtnSelectors) {
        const cBtn = await page.$(cSel);
        if (cBtn && (await cBtn.isVisible().catch(() => false))) {
          console.log(`  [SEARCH TERM] Bấm nút Create report để mở form...`);
          await cBtn.click().catch(() => {});
          await page.waitForTimeout(3000);
          break;
        }
      }
    }

    // Chờ ô input xuất hiện nếu đang render
    if (!nameInput) {
      nameInput = await page.waitForSelector(nameSelectors.join(", "), { timeout: 10000 }).catch(() => null);
    }

    if (adType === "SB") {
      const catBtn = await page.waitForSelector(
        "#report-configuration-form\\:report-category-control-component-0, button[id*='report-category']",
        { timeout: 4000 },
      ).catch(() => null);
      if (catBtn) {
        await catBtn.click();
        const sbOpt = await page.waitForSelector(
          '[role="option"]:has-text("Sponsored Brands"), li:has-text("Sponsored Brands")',
          { timeout: 3000 },
        ).catch(() => null);
        if (sbOpt) {
          await sbOpt.click();
          await page.waitForTimeout(400);
        }
      }
    }

    const typeBtn = await page.waitForSelector(
      "#report-configuration-form\\:report-type-control-component-0, button[id*='report-type']",
      { timeout: 4000 },
    ).catch(() => null);
    if (typeBtn) {
      const currentText = await typeBtn.innerText().catch(() => "");
      if (!/Search term/i.test(currentText)) {
        await typeBtn.click();
        const stOpt = await page.waitForSelector(
          '[role="option"]:has-text("Search term"), li:has-text("Search term")',
          { timeout: 3000 },
        ).catch(() => null);
        if (stOpt) {
          await stOpt.click();
          await page.waitForTimeout(400);
        }
      }
    }

    const dayRadio = await page.$("#time-units-day, input[value='DAILY'], label[for='time-units-day']");
    if (dayRadio) {
      await dayRadio.click().catch(() => page.evaluate((el: any) => el?.click(), dayRadio));
      await page.waitForTimeout(300);
    }

    if (nameInput) {
      await nameInput.click().catch(() => {});
      await nameInput.fill("");
      await nameInput.fill(reportName);
      await nameInput.dispatchEvent("input").catch(() => {});
      await nameInput.dispatchEvent("change").catch(() => {});
      console.log(`  [SEARCH TERM] Đã điền tên report: "${reportName}"`);
    } else {
      console.warn(`  [SEARCH TERM] Không tìm thấy ô tên report, dùng tên mặc định của Amazon.`);
    }

    const runSelectors = [
      "#urc_run_subscription_button",
      'button[id*="run_subscription"]',
      'button:has-text("Run report")',
      'button[data-testid*="run-report"]',
    ];
    const runBtn = await page.waitForSelector(runSelectors.join(", "), { timeout: 8000 }).catch(() => null);
    if (runBtn) {
      await runBtn.click().catch(async () => {
        await page.evaluate((el: any) => el?.click(), runBtn);
      });
      console.log(`  [SEARCH TERM] ✅ Đã bấm Run report cho Search Term ${adType} (${syncRunId})!`);
      await page.waitForTimeout(2500);
    }

    if (task) {
      task.status = "AMAZON_PROCESSING";
      saveCheckpoint?.();
    }
  }

  const timeoutMinutes = envInt("AMAZON_REPORT_TIMEOUT_MINUTES", 30, 5, 120);

  // 3. Nếu chưa có downloadUrl, chuyển sang trang /reports để theo dõi tiến độ hoàn thành
  if (!downloadUrl) {
    if (!page.url().includes("/reports?")) {
      console.log(`  [SEARCH TERM] Chuyển đến trang danh sách báo cáo: ${reportsUrl}`);
      await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
    }

    // Chờ bảng dữ liệu render
    await page.waitForSelector("div.ag-root, div.ag-row, table, [role='grid']", { timeout: 15000 }).catch(() => {});

    const deadline = Date.now() + timeoutMinutes * 60_000;
    const startTime = Date.now();
    let pollIteration = 0;
    const pollBase = envInt("AMAZON_REPORT_POLL_SECONDS", 12, 5, 60);
    const pollBackoff = [pollBase, pollBase, Math.max(pollBase, 20), Math.max(pollBase, 30)];

    while (Date.now() < deadline) {
      throwIfAborted(signal);
      pollIteration++;
      const waitSeconds = pollBackoff[Math.min(pollIteration - 1, pollBackoff.length - 1)];

      const match = await page.evaluate((args: { targetId: string; adType: string; today: string; todayMonthDay: string }) => {
        const allRowEls = Array.from(document.querySelectorAll("div.ag-row, tr, [role='row']"));
        const rowIndexMap = new Map<string, { texts: string[]; href: string | null; isCompleted: boolean; isFailed: boolean }>();

        for (const r of allRowEls) {
          const idx = r.getAttribute("row-index") || r.getAttribute("row-id") || r.getAttribute("aria-rowindex") || String(Math.random());
          if (!rowIndexMap.has(idx)) {
            rowIndexMap.set(idx, { texts: [], href: null, isCompleted: false, isFailed: false });
          }
          const entry = rowIndexMap.get(idx)!;
          const txt = ((r as HTMLElement).innerText || "").trim();
          const title = (r.getAttribute("title") || "").trim();
          const childTitles = Array.from(r.querySelectorAll("[title]")).map((el) => el.getAttribute("title") || "").join(" ");
          if (txt || title || childTitles) {
            entry.texts.push(txt, title, childTitles);
          }

          const link = r.querySelector<HTMLAnchorElement | HTMLButtonElement>(
            "a[data-takt-id='storm-ui-link'], a[href*='download-report'], a[href*='download'], a[href*='export'], button[data-takt-id*='download'], button[aria-label*='download' i]"
          );
          if (link && !entry.href) {
            if ((link as HTMLAnchorElement).href) {
              const h = (link as HTMLAnchorElement).href;
              entry.href = h.startsWith("http") ? h : (location.origin + h);
            } else {
              entry.href = "clickable-button";
            }
          }

          const fullRowText = entry.texts.join(" ").toLowerCase();
          if (
            fullRowText.includes("completed") ||
            fullRowText.includes("success") ||
            fullRowText.includes("downloadable") ||
            fullRowText.includes("hoàn thành") ||
            fullRowText.includes("đã xong") ||
            Boolean(entry.href)
          ) {
            entry.isCompleted = true;
          }

          if (fullRowText.includes("failed") || fullRowText.includes("thất bại") || fullRowText.includes("error")) {
            entry.isFailed = true;
          }
        }

        // Ưu tiên 1: Khớp chính xác syncRunId vừa tạo
        for (const [, entry] of rowIndexMap.entries()) {
          const fullText = entry.texts.join(" ");
          if (fullText.includes(args.targetId)) {
            return { found: true, isCompleted: entry.isCompleted, isFailed: entry.isFailed, href: entry.href };
          }
        }

        // Ưu tiên 2 (Fallback như Web): Khớp báo cáo Search Term cùng loại đã hoàn thành trong ngày
        const adTypeLabel = args.adType === "SB" ? "Sponsored Brands" : "Sponsored Products";
        for (const [, entry] of rowIndexMap.entries()) {
          const fullText = entry.texts.join(" ");
          const hasSearchTerm = /search\s*term/i.test(fullText);
          const hasAdType = fullText.includes(args.adType) || fullText.includes(adTypeLabel);
          const hasToday = fullText.includes(args.today) || fullText.includes(args.todayMonthDay);
          if (hasSearchTerm && hasAdType && hasToday && entry.href) {
            return { found: true, isCompleted: true, isFailed: false, href: entry.href };
          }
        }

        return { found: false, isCompleted: false, isFailed: false, href: null };
      }, { targetId: syncRunId, adType, today, todayMonthDay });

      if (match.found && match.isFailed) {
        if (task) task.status = "FAILED";
        saveCheckpoint?.();
        throw new Error(`Amazon báo cáo trạng thái FAILED cho Search Term ${adType} (${syncRunId}).`);
      }

      if (match.found && match.isCompleted && match.href) {
        downloadUrl = match.href;
        if (task) task.status = "DOWNLOADABLE";
        saveCheckpoint?.();
        console.log(`  [SEARCH TERM] ✅ Đã tìm thấy link tải báo cáo Search Term ${adType}! Link: ${downloadUrl}`);
        break;
      }

      const elapsedStr = formatMmSs(Date.now() - startTime);
      const timeoutStr = `${timeoutMinutes}:00`;
      console.log(`  [ST ${adType}] Amazon đang xử lý ${syncRunId} — ${elapsedStr}/${timeoutStr} — lần poll ${pollIteration}`);

      await page.waitForTimeout(waitSeconds * 1000);

      // Bấm Refresh của bảng AG Grid
      const refreshBtn = await page.$(
        'button[aria-label*="Refresh" i], button:has-text("Refresh"), button:has-text("Làm mới"), button[data-testid*="refresh" i], button[data-takt-id*="refresh" i], button:has(svg[data-icon="refresh"])',
      );
      if (refreshBtn) {
        await refreshBtn.click().catch(() => {});
      }
    }
  }

  if (!downloadUrl) {
    if (task) {
      task.status = "RETRY_WAIT";
      task.lastError = `Amazon vẫn chưa hoàn tất sau ${timeoutMinutes} phút`;
      task.nextRetryAt = new Date(Date.now() + 10 * 60_000).toISOString();
      saveCheckpoint?.();
    }
    throw new Error(`Timeout: Không tạo xong file Search Term ${adType} với ID ${syncRunId} sau ${timeoutMinutes} phút.`);
  }

  // 3. Tải file về thư mục chỉ định
  console.log(`  [SEARCH TERM] Bắt đầu tải file: ${downloadUrl}`);
  const allGuids = downloadUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  const reportId = allGuids[allGuids.length - 1] || "";
  let directLinkEl = reportId
    ? (await page.$(`a[href*="download-report"][href*="${reportId}"]`)) ||
      (await page.$(`a[href*="${reportId}"]`))
    : null;

  if (!directLinkEl) {
    directLinkEl = await page.evaluateHandle((targetId: string) => {
      const allRows = Array.from(document.querySelectorAll("div.ag-row, tr, [role='row']"));
      for (const r of allRows) {
        const full = ((r as HTMLElement).innerText || "") + " " + (r.getAttribute("title") || "") + " " + Array.from(r.querySelectorAll("[title]")).map((el) => el.getAttribute("title") || "").join(" ");
        if (full.includes(targetId)) {
          const btn = r.querySelector<HTMLElement>(
            "a[data-takt-id='storm-ui-link'], a[href*='download-report'], a[href*='download'], button[data-takt-id*='download'], button"
          );
          if (btn) return btn;
        }
      }
      return null;
    }, syncRunId).then((h) => h.asElement()).catch(() => null);
  }

  const downloadAttempts = envInt("DOWNLOAD_MAX_ATTEMPTS", 3, 1, 5);
  const standardizedPath = await retryWithBackoff<string>(
    `Tải Search Term ${adType} (${syncRunId})`,
    downloadAttempts,
    async () => {
    throwIfAborted(signal);
    if (task) {
      task.status = "DOWNLOADING";
      saveCheckpoint?.();
    }
    let savedPath: string | null = null;
    const beforeStats = getFileStatsMap(destDir);
    try {
    const [download] = await Promise.all([
      raceWithAbort(page.waitForEvent("download", { timeout: envInt("REPORT_DOWNLOAD_TIMEOUT_MINUTES", 15, 1, 60) * 60_000 }), signal),
      (async () => {
        if (directLinkEl) {
          await directLinkEl.click().catch(async () => {
            await page.evaluate((el: any) => el?.click(), directLinkEl);
          });
        } else if (downloadUrl) {
          await page.goto(downloadUrl, { waitUntil: "commit" }).catch(async () => {
            await page.evaluate((url: string) => {
              const a = document.createElement("a");
              a.href = url;
              a.download = "";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }, downloadUrl);
          });
        }
      })(),
    ]);

    const suggestedName = download.suggestedFilename();
    const cleanRawName = sanitizeRawFileName(suggestedName, storeName);
    const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${cleanRawName}`;
    savedPath = path.join(destDir, standardizedName);
    try {
      await download.saveAs(savedPath);
    } catch {}
  } catch {}

  if (!savedPath || !fs.existsSync(savedPath)) {
    const downloadedPath = await waitForNewDownload(destDir, beforeStats, envInt("REPORT_DOWNLOAD_TIMEOUT_MINUTES", 15, 1, 60) * 60, signal);
    if (!downloadedPath) throw new Error(`Không tải được file Search Term ${adType}`);
    const rawName = path.basename(downloadedPath);
    const cleanRawName = sanitizeRawFileName(rawName, storeName);
    const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${cleanRawName}`;
    savedPath = path.join(destDir, standardizedName);
    if (downloadedPath !== savedPath) {
      if (fs.existsSync(savedPath)) {
        try { fs.unlinkSync(savedPath); } catch {}
      }
      fs.renameSync(downloadedPath, savedPath);
    }
  }
    if (!savedPath || !fs.existsSync(savedPath) || fs.statSync(savedPath).size === 0) {
      throw new Error(`File Search Term ${adType} tải về bị thiếu hoặc rỗng.`);
    }
    return savedPath;
  });

  const stat = fs.statSync(standardizedPath);
  if (task) {
    task.status = "DOWNLOADED";
    task.localPath = standardizedPath;
    task.sizeBytes = stat.size;
    task.lastError = null;
    task.nextRetryAt = null;
    saveCheckpoint?.();
  }
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

async function inspectWorkbookStreaming(filePath: string, headerRows = 0): Promise<{ sheetNames: string; headerText: string }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore",
  });
  const sheetNames: string[] = [];
  let headerText = "";
  for await (const worksheet of reader) {
    sheetNames.push(String((worksheet as any).name || "").toLowerCase());
    if (headerRows > 0 && sheetNames.length === 1) {
      let rowsRead = 0;
      for await (const row of worksheet) {
        const values = row.values;
        headerText += ` ${Array.isArray(values) ? values.map((value) => String(value ?? "")).join(" ") : String(values ?? "")}`;
        rowsRead += 1;
        if (rowsRead >= headerRows) break;
      }
    }
  }
  return { sheetNames: sheetNames.join(" "), headerText };
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
    try {
    const stat = fs.statSync(file.path);
    if (!stat.isFile() || stat.size === 0) throw new Error(`File rỗng hoặc không hợp lệ: ${file.name}`);
    if (file.type.startsWith("BULK_")) {
      if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error(`Bulk phải là XLSX: ${file.name}`);
      const { sheetNames } = await inspectWorkbookStreaming(file.path);
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
        ({ headerText } = await inspectWorkbookStreaming(file.path, 10));
      } else {
        throw new Error(`Search Term phải là XLSX hoặc CSV: ${file.name}`);
      }
      const normalized = headerText.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      if (!/search term|customer search term/.test(normalized) || !/campaign/.test(normalized) || !/click|spend|cost/.test(normalized)) {
        throw new Error(`File không có schema Search Term hợp lệ: ${file.name}`);
      }
    }
    } catch (error) {
      throw new Error(`VALIDATION_FAILED:${file.name}:${(error as Error).message}`);
    }
  }
}

function quarantineInvalidFile(error: unknown, tasks: ReportTaskState[], storeRootDir: string, storeName?: string): void {
  const message = (error as Error).message || "";
  const match = message.match(/^VALIDATION_FAILED:([^:]+):/);
  if (!match) return;
  const fileName = match[1];
  const task = tasks.find((item) => (!storeName || item.store === storeName) && item.localPath && path.basename(item.localPath) === fileName);
  if (!task?.localPath || !fs.existsSync(task.localPath)) return;
  const quarantineDir = path.join(storeRootDir, "quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const quarantinePath = path.join(quarantineDir, `${Date.now()}_${path.basename(task.localPath)}`);
  fs.renameSync(task.localPath, quarantinePath);
  console.warn(`[VALIDATION] Đã cách ly file lỗi: ${quarantinePath}`);
  task.localPath = null;
  task.sizeBytes = 0;
  task.sha256 = null;
  task.status = task.amazonRequestId ? "DOWNLOADABLE" : "NOT_STARTED";
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

export interface CrawlStoreOptions {
  jobId?: string;
  batchId?: string;
  checkpoint?: JobCheckpoint;
  onTaskUpdate?: (task: ReportTaskState) => Promise<void> | void;
  signal?: AbortSignal;
}

export async function crawlStore(
  store: StoreTarget,
  todayStr: string,
  onProgress?: ProgressCallback,
  options?: CrawlStoreOptions,
): Promise<DownloadedFileInfo[]> {
  const storeRootDir = path.join(BASE_DOWNLOAD_DIR, todayStr, store.store_name);
  const spDir = path.join(storeRootDir, "SP");
  const sbDir = path.join(storeRootDir, "SB");
  const batchDate = todayStr.replace(/-/g, "");

  fs.mkdirSync(spDir, { recursive: true });
  fs.mkdirSync(sbDir, { recursive: true });

  const checkpoint = options?.checkpoint || loadJobCheckpoint(options?.jobId || `daily-${store.store_name}-${batchDate}`) || {
    jobId: options?.jobId || `daily-${store.store_name}-${batchDate}`,
    batchId: options?.batchId || `${store.store_name}_${batchDate}_${Math.random().toString(36).slice(2, 8)}`,
    storeName: store.store_name,
    batchDate,
    stage: "CRAWLING",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runAttempt: 0,
    lastError: null,
    tasks: createDefaultTasksForStore(store.store_name),
  } satisfies JobCheckpoint;
  checkpoint.runAttempt = (checkpoint.runAttempt || 0) + 1;
  checkpoint.stage = "CRAWLING";
  checkpoint.lastError = null;
  const saveCheckpoint = () => saveJobCheckpointAtomic(checkpoint);
  const notifyTask = async (task: ReportTaskState) => {
    saveCheckpoint();
    if (options?.onTaskUpdate) await options.onTaskUpdate(task);
  };
  const tasks = checkpoint.tasks;
  throwIfAborted(options?.signal);
  const findTask = (type: ReportTaskType, days: number) =>
    tasks.find((t) => t.store === store.store_name && t.type === type && t.days === days);

  // Khôi phục trạng thái các file đã tải sẵn trên ổ cứng
  for (const t of tasks) {
    if (t.store !== store.store_name) continue;
    const targetSubDir = t.type.includes("SP") ? spDir : sbDir;
    if (!t.localPath && fs.existsSync(targetSubDir)) {
      const diskFiles = fs.readdirSync(targetSubDir)
        .filter((name) => /\.(xlsx|csv)$/i.test(name))
        .sort((a, b) => fs.statSync(path.join(targetSubDir, b)).mtimeMs - fs.statSync(path.join(targetSubDir, a)).mtimeMs);
      const matched = diskFiles.find((f) => {
        const lower = f.toLowerCase();
        const hasType = t.type.startsWith("BULK_")
          ? /(?:^|[_ -])bulk(?:[_ -])/.test(lower)
          : /search[_ -]*term/.test(lower);
        const hasAd = t.type.includes("SP") ? lower.includes("sp") : lower.includes("sb");
        const hasDays = lower.includes(`${t.days}days`) || lower.includes(`${t.days}d`);
        return hasType && hasAd && hasDays;
      });
      if (matched) {
        t.localPath = path.join(targetSubDir, matched);
      }
    }
    if (t.localPath && fs.existsSync(t.localPath)) {
      const stat = fs.statSync(t.localPath);
      if (stat.size > 0) {
        t.status = "DOWNLOADED";
        t.sizeBytes = stat.size;
      }
    }
  }
  saveCheckpoint();

  const downloadedFiles: DownloadedFileInfo[] = [];

  const bulkTasks = [
    findTask("BULK_SP", 30),
    findTask("BULK_SB", 30),
    findTask("BULK_SP", 7),
    findTask("BULK_SB", 7),
  ].filter(Boolean) as ReportTaskState[];

  const allBulkDone = bulkTasks.length === 4 && bulkTasks.every((t) => t.localPath && fs.existsSync(t.localPath) && fs.statSync(t.localPath).size > 0);

  console.log("\n************************************************************");
  console.log(`>>> BẮT ĐẦU CRAWL CHO STORE: [${store.store_name}]`);
  console.log(`    Profile ID: ${store.profile_id}`);
  console.log(`    Thư mục lưu trữ: ${storeRootDir}`);
  if (allBulkDone) {
    console.log(`    [Checkpoint] Đã có đủ 4 file Bulk chuẩn, sẽ chỉ tập trung vào Search Term!`);
  }
  console.log("************************************************************");

  if (onProgress) await onProgress(`Đang mở AdsPower profile ${store.profile_id}`, 10);

  const cdpEndpoint = await startAdsPowerProfileWithRetry(store.profile_id);
  console.log(`[Browser] Kết nối CDP tại: ${cdpEndpoint}...`);

  const browser = await chromium.connectOverCDP(cdpEndpoint).catch(async (error) => {
    await stopAdsPowerProfile(store.profile_id);
    throw error;
  });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    await stopAdsPowerProfile(store.profile_id);
    throw new Error(`Không tìm thấy context trình duyệt của store ${store.store_name}.`);
  }

  let page = context.pages().find((p) => p.url().includes("advertising.amazon.com"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" }).catch(async (error) => {
      await browser.close().catch(() => {});
      await stopAdsPowerProfile(store.profile_id);
      throw error;
    });
    await page.waitForTimeout(3000);
  }

  try {
    const entityId = page.url().match(/entityId=([A-Z0-9]+)/)?.[1] || "";
    const entityParam = entityId ? `?entityId=${entityId}` : "";

    // 1. Tự động xử lý 4 file Bulk
    if (allBulkDone) {
      console.log(`  [BULK CHECKPOINT] ✅ Khôi phục cả 4 file Bulk từ ổ cứng, không cần tải lại:`);
      for (const bt of bulkTasks) {
        console.log(`    - ${path.basename(bt.localPath!)} (${((bt.sizeBytes || 0) / (1024 * 1024)).toFixed(1)} MB)`);
        downloadedFiles.push({
          name: path.basename(bt.localPath!),
          path: bt.localPath!,
          relativeSubdir: bt.type.includes("SP") ? "SP" : "SB",
          days: bt.days,
          type: bt.type,
          sizeBytes: bt.sizeBytes || fs.statSync(bt.localPath!).size,
        });
      }
    } else {
      const missingBulkSlots = bulkTasks
        .filter((task) => !task.localPath || !fs.existsSync(task.localPath) || fs.statSync(task.localPath).size === 0)
        .map((task) => ({ adType: task.type.endsWith("_SB") ? "SB" as const : "SP" as const, days: task.days }));
      console.log(`[BULK RESUME] Chỉ tải ${missingBulkSlots.length} file còn thiếu; giữ nguyên ${4 - missingBulkSlots.length} file đã có.`);
      for (const task of bulkTasks.filter((task) => !missingBulkSlots.some((slot) => task.type === `BULK_${slot.adType}` && task.days === slot.days))) {
        downloadedFiles.push({
          name: path.basename(task.localPath!), path: task.localPath!,
          relativeSubdir: task.type.endsWith("_SB") ? "SB" : "SP",
          days: task.days, type: task.type, sizeBytes: fs.statSync(task.localPath!).size,
        });
      }
      const bulkFiles = await createAndDownloadAllBulkReports(
        page, entityParam, store.store_name, spDir, sbDir, onProgress,
        missingBulkSlots, tasks, saveCheckpoint, options?.signal,
      );
      downloadedFiles.push(...bulkFiles);
      for (const bf of bulkFiles) {
        const matched = tasks.find((t) => t.store === store.store_name && t.type === bf.type && t.days === bf.days);
        if (matched) {
          matched.localPath = bf.path;
          matched.sizeBytes = bf.sizeBytes;
          matched.status = "DOWNLOADED";
          await notifyTask(matched);
        }
      }
    }

    // 2. Search Term SP 30d
    const stSpTask = findTask("ST_SP", 30);
    if (stSpTask && stSpTask.localPath && fs.existsSync(stSpTask.localPath) && fs.statSync(stSpTask.localPath).size > 0) {
      console.log(`  [ST CHECKPOINT] ✅ Khôi phục Search Term SP 30d từ đĩa: ${path.basename(stSpTask.localPath)}`);
      downloadedFiles.push({
        name: path.basename(stSpTask.localPath),
        path: stSpTask.localPath,
        relativeSubdir: "SP",
        days: 30,
        type: "ST_SP",
        sizeBytes: stSpTask.sizeBytes || fs.statSync(stSpTask.localPath).size,
      });
    } else {
      if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SP 30 Ngày`, 85);
      const stSp = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SP", store.store_name, spDir, stSpTask, saveCheckpoint, options?.signal);
      downloadedFiles.push(stSp);
      if (stSpTask) {
        stSpTask.localPath = stSp.path;
        stSpTask.sizeBytes = stSp.sizeBytes;
        stSpTask.status = "DOWNLOADED";
        await notifyTask(stSpTask);
      }
    }

    // 3. Search Term SB 30d
    const stSbTask = findTask("ST_SB", 30);
    if (stSbTask && stSbTask.localPath && fs.existsSync(stSbTask.localPath) && fs.statSync(stSbTask.localPath).size > 0) {
      console.log(`  [ST CHECKPOINT] ✅ Khôi phục Search Term SB 30d từ đĩa: ${path.basename(stSbTask.localPath)}`);
      downloadedFiles.push({
        name: path.basename(stSbTask.localPath),
        path: stSbTask.localPath,
        relativeSubdir: "SB",
        days: 30,
        type: "ST_SB",
        sizeBytes: stSbTask.sizeBytes || fs.statSync(stSbTask.localPath).size,
      });
    } else {
      if (onProgress) await onProgress(`[${store.store_name}] Tải Search Term SB 30 Ngày`, 95);
      const stSb = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SB", store.store_name, sbDir, stSbTask, saveCheckpoint, options?.signal);
      downloadedFiles.push(stSb);
      if (stSbTask) {
        stSbTask.localPath = stSb.path;
        stSbTask.sizeBytes = stSb.sizeBytes;
        stSbTask.status = "DOWNLOADED";
        await notifyTask(stSbTask);
      }
    }

    await validateDownloadedBatch(downloadedFiles);
    for (const task of tasks) {
      if (task.store !== store.store_name) continue;
      if (task.localPath && fs.existsSync(task.localPath)) {
        task.status = "VALIDATED";
        task.sha256 = await computeFileSha256(task.localPath);
        task.lastError = null;
        task.nextRetryAt = null;
      }
    }
    checkpoint.stage = "VALIDATED";
    saveCheckpoint();

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
          batchId: options?.batchId,
          files: downloadedFiles,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\n  [Manifest] Đã lưu manifest của [${store.store_name}] tại: ${manifestPath}`);

    if (onProgress) await onProgress(`[${store.store_name}] Đã kiểm tra đủ 6 file, đang publish batch lên R2`, 98);
    await publishCompleteBatchWithStaging(downloadedFiles, store.store_name, batchDate, checkpoint.batchId, tasks, options?.signal);
    checkpoint.stage = "UPLOADED";
    saveCheckpoint();
  } catch (error) {
    quarantineInvalidFile(error, tasks, storeRootDir, store.store_name);
    checkpoint.stage = "RETRY_WAIT";
    checkpoint.lastError = (error as Error).message;
    const activeTask = tasks.find((task) => task.store === store.store_name && !["DOWNLOADED", "VALIDATED", "UPLOADED"].includes(task.status));
    if (activeTask) {
      activeTask.lastError = (error as Error).message;
      if (activeTask.status !== "AMAZON_PROCESSING" && activeTask.status !== "FAILED") {
        activeTask.status = "RETRY_WAIT";
      }
      activeTask.nextRetryAt = new Date(Date.now() + 10 * 60_000).toISOString();
    }
    saveCheckpoint();
    throw error;
  } finally {
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
  const publishedBatches: Array<{ batchId: string; batchDate: string; storeName: string }> = [];

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    console.log(`\n============================================================`);
    console.log(`[TIẾN TRÌNH ${i + 1}/${stores.length}]: ĐANG XỬ LÝ STORE [${store.store_name}]`);
    console.log(`============================================================`);

    try {
      const controller = new AbortController();
      const timeoutMinutes = envInt("CRAWLER_JOB_TIMEOUT_MINUTES", 120, 15, 720);
      const timeout = setTimeout(() => controller.abort(`Vượt timeout tổng ${timeoutMinutes} phút`), timeoutMinutes * 60_000);
      const files = await retryWithBackoff(
        `Crawl store ${store.store_name}`,
        envInt("CRAWLER_MAX_JOB_ATTEMPTS", 3, 1, 5),
        async (attempt) => {
          console.log(`[JOB RETRY] Store ${store.store_name}: vòng chạy ${attempt}/${envInt("CRAWLER_MAX_JOB_ATTEMPTS", 3, 1, 5)}.`);
          return crawlStore(store, todayStr, undefined, {
            jobId: `daily-${store.store_name}-${todayStr.replace(/-/g, "")}`,
            signal: controller.signal,
          });
        },
      ).finally(() => clearTimeout(timeout));
      storeResults[store.store_name] = { success: true, count: files.length };
      const completedCheckpoint = loadJobCheckpoint(`daily-${store.store_name}-${todayStr.replace(/-/g, "")}`);
      if (completedCheckpoint) {
        publishedBatches.push({
          batchId: completedCheckpoint.batchId,
          batchDate: completedCheckpoint.batchDate,
          storeName: store.store_name,
        });
      }
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
  const syncTargetPath = path.join(os.homedir(), "Library", "Application Support", "AmazonPpcCrawler", "last-sync-target.json");
  fs.mkdirSync(path.dirname(syncTargetPath), { recursive: true });
  const syncTargetTemp = `${syncTargetPath}.tmp.${process.pid}`;
  fs.writeFileSync(syncTargetTemp, JSON.stringify({ batches: publishedBatches }, null, 2), { mode: 0o600 });
  fs.renameSync(syncTargetTemp, syncTargetPath);
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
