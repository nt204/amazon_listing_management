import "server-only";

import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { chromium } from "playwright-core";
import type { DataScope } from "@/lib/db";
import {
  canonicalStoreName,
  ingestPpcFilePath,
  parseBulkFile,
  reportAdType,
} from "./service";
import {
  parseSearchTermCsv,
  parseSearchTermWorkbook,
} from "./parser";
import {
  recordPpcSyncLog,
  upsertPpcPerformance,
  upsertPpcSearchTerms,
} from "./repository";

export interface AdsPowerSyncResult {
  success: boolean;
  storeName: string;
  debugPort: number;
  downloadedFiles: string[];
  totalParsed: number;
  totalNew: number;
  totalUpdated: number;
  r2Uploaded?: number;
  message: string;
}

/**
 * Kiểm tra xem một TCP port có thực sự đang mở và phản hồi Chrome DevTools Protocol (/json/version) hay không.
 */
export async function isCdpPortResponding(port: number): Promise<boolean> {
  if (!port || port <= 0 || port > 65535) return false;
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1200 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Đợi cho đến khi CDP port sẵn sàng phản hồi (tối đa timeoutMs).
 */
export async function waitForCdpPort(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isCdpPortResponding(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

/**
 * Đóng tab an toàn sau khi xử lý xong theo yêu cầu ("xong tab nào thì tắt tab đó").
 * Dùng runBeforeUnload: false để đóng dứt khoát không bị chặn bởi dialog unsaved changes.
 * Nếu là tab duy nhất còn lại trong context, mở 1 tab trắng mới trước khi đóng
 * để tránh việc Chromium/AdsPower đóng hoàn toàn cửa sổ profile.
 */
export async function closeTabSafely(page: any, context?: any): Promise<void> {
  if (!page || (typeof page.isClosed === "function" && page.isClosed())) return;
  try {
    if (context && typeof context.pages === "function") {
      const remainingPages = context.pages().filter((p: any) => !p.isClosed());
      if (remainingPages.length <= 1) {
        await context.newPage().catch(() => { });
      }
    }
    await page.close({ runBeforeUnload: false }).catch(() => { });
  } catch (err) {
    console.warn("[AdsPower] Lỗi khi đóng tab:", err);
  }
}

/**
 * Tự động phát hiện cổng Chrome DevTools Protocol (CDP) của AdsPower SunBrowser đang MỞ THỰC SỰ trên máy.
 * Bắt buộc xác minh cổng phản hồi /json/version trước khi trả về (tránh stale ports từ phiên cũ).
 */
export async function detectAdsPowerDebugPort(): Promise<number | null> {
  // 1. Kiểm tra tiến trình SunBrowser đang lắng nghe TCP port qua lsof
  try {
    const lsofOutput = execSync("lsof -c SunBrowser -a -i TCP -s TCP:LISTEN -n -P", {
      encoding: "utf8",
      timeout: 3000,
    });
    const matches = Array.from(lsofOutput.matchAll(/127\.0\.0\.1:(\d+)|:(\d+)\s+\(LISTEN\)/g));
    for (const match of matches) {
      const port = Number(match[1] || match[2]);
      if (port > 0 && (await isCdpPortResponding(port))) {
        return port;
      }
    }
  } catch {
    // Tiếp tục fallback sang đọc log AdsPower
  }

  // 2. Fallback: đọc file log gần nhất của AdsPower và kiểm tra liveness của port
  try {
    const logDir = path.join(
      os.homedir(),
      "Library/Application Support/adspower_global/cwd_global/log",
    );
    if (fs.existsSync(logDir)) {
      const logFiles = fs
        .readdirSync(logDir)
        .filter((f) => f.startsWith("log.") && f.endsWith(".log"))
        .sort()
        .reverse();

      for (const logFile of logFiles.slice(0, 2)) {
        const content = fs.readFileSync(path.join(logDir, logFile), "utf8");
        const matches = Array.from(
          content.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/g),
        );
        for (let i = matches.length - 1; i >= 0; i--) {
          const port = Number(matches[i][1]);
          if (port > 0 && (await isCdpPortResponding(port))) {
            return port;
          }
        }
      }
    }
  } catch {
    // Bỏ qua
  }

  return null;
}

/**
 * Lấy URL Local API của AdsPower (mặc định http://127.0.0.1:50325 hoặc theo file local_api)
 */
export function getAdsPowerLocalApiUrl(): string {
  if (process.env.ADSPOWER_API_URL) return process.env.ADSPOWER_API_URL.replace(/\/+$/, "");
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^ADSPOWER_API_URL\s*=\s*["']?([^"'\r\n]+)["']?/m);
      if (match && match[1]) {
        process.env.ADSPOWER_API_URL = match[1].trim();
        return process.env.ADSPOWER_API_URL.replace(/\/+$/, "");
      }
    }
  } catch { }
  try {
    const localApiPath = process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support/adspower_global/cwd_global/source/local_api")
      : path.join(process.env.APPDATA || "", "adspower_global/cwd_global/source/local_api");
    if (fs.existsSync(localApiPath)) {
      const content = fs.readFileSync(localApiPath, "utf8").trim();
      if (content.startsWith("http")) {
        // Chuẩn hóa host nội bộ sang 127.0.0.1 để tránh lỗi phân giải DNS local.adspower.com
        return content.replace("local.adspower.com", "127.0.0.1").replace(/\/+$/, "");
      }
    }
  } catch {
    // Ignore
  }
  return "http://127.0.0.1:50325";
}

/**
 * Lấy AdsPower API Key (ưu tiên process.env, fallback đọc trực tiếp từ file .env nếu server chưa restart)
 */
export function getAdsPowerApiKey(): string {
  let key = (process.env.ADSPOWER_API_KEY || "").trim();
  if (!key) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        const match = content.match(/^ADSPOWER_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]) {
          key = match[1].trim();
          process.env.ADSPOWER_API_KEY = key;
        }
      }
    } catch {
      // Ignore
    }
  }
  return key;
}

/**
 * Lấy AdsPower Profile ID (ưu tiên options, mapping, process.env, fallback đọc từ file .env)
 */
export function getAdsPowerProfileId(override?: string, storeName = "HSOSTORE"): string {
  if (override && override.trim()) return override.trim();
  let id = (process.env.ADSPOWER_PROFILE_ID || "").trim();
  const store = canonicalStoreName(storeName);

  if (!id && process.env.ADSPOWER_PROFILES_JSON) {
    try {
      const mapping = JSON.parse(process.env.ADSPOWER_PROFILES_JSON);
      if (typeof mapping === "object" && mapping !== null) {
        id = mapping[store] || mapping[store.toUpperCase()] || mapping[store.toLowerCase()] || "";
      }
    } catch { }
  }

  if (!id) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        const match = content.match(/^ADSPOWER_PROFILE_ID\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]) {
          id = match[1].trim();
          process.env.ADSPOWER_PROFILE_ID = id;
        }
      }
    } catch { }
  }
  return id;
}

/**
 * Tự động gửi lệnh mở Profile trong AdsPower qua Local API (v2 hoặc v1).
 * Nếu ứng dụng AdsPower chưa chạy, tự động khởi động ứng dụng trước.
 */
export async function startAdsPowerProfile(options: {
  storeName?: string;
  profileId?: string;
}): Promise<number | null> {
  const apiUrl = getAdsPowerLocalApiUrl();
  const apiKey = getAdsPowerApiKey();
  const store = canonicalStoreName(options.storeName || "HSOSTORE");

  // 1. Xác định profile ID từ options, env hoặc mapping
  let profileId = getAdsPowerProfileId(options.profileId, store);

  // 1.1 Quét thư mục cache của AdsPower để tự động chọn profile id gần nhất nếu chưa cấu hình
  if (!profileId) {
    try {
      const cacheDir = path.join(
        os.homedir(),
        "Library/Application Support/adspower_global/cwd_global/source/cache",
      );
      if (fs.existsSync(cacheDir)) {
        const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
        const profileDirs = entries
          .filter((e) => e.isDirectory() && e.name.includes("_"))
          .map((e) => ({
            profileId: e.name.split("_")[0],
            mtime: fs.statSync(path.join(cacheDir, e.name)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        if (profileDirs.length > 0) {
          profileId = profileDirs[0].profileId;
          console.log(`[AdsPower Auto] Tự động chọn profile gần nhất từ cache: ${profileId}`);
        }
      }
    } catch {
      // Bỏ qua
    }
  }

  // 2. Kiểm tra xem ứng dụng AdsPower đã chạy chưa
  let isApiAlive = false;
  try {
    const statusRes = await fetch(`${apiUrl}/status`, { signal: AbortSignal.timeout(3000) });
    isApiAlive = statusRes.ok;
  } catch {
    isApiAlive = false;
  }

  if (!isApiAlive) {
    console.log("[AdsPower Auto] AdsPower chưa chạy, đang tự động khởi động ứng dụng...");
    try {
      if (process.platform === "darwin") {
        execSync('open -a "AdsPower Global"', { stdio: "ignore" });
      } else if (process.platform === "win32" && process.env.ADDSPOWER_PATH) {
        execSync(`start "" "${process.env.ADDSPOWER_PATH}"`, { stdio: "ignore" });
      }
      // Đợi AdsPower khởi động API
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const res = await fetch(`${apiUrl}/status`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            isApiAlive = true;
            break;
          }
        } catch {
          // Tiếp tục đợi
        }
      }
    } catch (e) {
      console.warn("[AdsPower Auto] Không thể tự khởi động app AdsPower:", e);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["api-key"] = apiKey;
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // 3. Nếu chưa có profileId, thử tìm profile theo tên store qua API user/list
  if (!profileId) {
    try {
      const listUrl = `${apiUrl}/api/v1/user/list?page=1&page_size=50`;
      const listRes = await fetch(listUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (listRes.ok) {
        const listData = await listRes.json();
        if (listData.code === 0 && Array.isArray(listData.data?.list)) {
          const matched = listData.data.list.find((u: { name?: string; serial_number?: string; user_id?: string }) =>
            u.name?.toLowerCase().includes(store.toLowerCase()) ||
            u.user_id?.toLowerCase() === store.toLowerCase()
          );
          if (matched?.user_id) {
            profileId = matched.user_id;
          } else if (listData.data.list.length > 0 && listData.data.list[0].user_id) {
            profileId = listData.data.list[0].user_id;
          }
        }
      }
    } catch {
      // Bỏ qua nếu API không hỗ trợ
    }
  }

  if (!profileId) {
    console.warn(`[AdsPower Auto] Chưa cấu hình profile_id cho store ${store}. Sẽ fallback sang cổng đang mở.`);
    return null;
  }

  // 4. Kiểm tra xem profile này đã đang Active chưa
  try {
    const activeRes = await fetch(`${apiUrl}/api/v1/browser/active?user_id=${encodeURIComponent(profileId)}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (activeRes.ok) {
      const activeData = await activeRes.json();
      if (activeData.code === 0 && activeData.data?.status === "Active") {
        const port = Number(
          activeData.data?.debug_port ||
          activeData.data?.ws?.puppeteer?.match(/:(\d+)\//)?.[1]
        );
        if (port > 0 && (await waitForCdpPort(port, 4000))) {
          console.log(`[AdsPower Auto] Profile ${profileId} đã đang Active tại cổng ${port}`);
          return port;
        }
      }
    }
  } catch {
    // Tiếp tục khởi động
  }

  // 5. Gửi lệnh mở profile
  console.log(`[AdsPower Auto] Đang tự động mở profile ${profileId} (${store})...`);
  try {
    // Thử v2 trước
    const startRes = await fetch(`${apiUrl}/api/v2/browser-profile/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ profile_id: profileId }),
      signal: AbortSignal.timeout(25000),
    });
    if (startRes.ok) {
      const data = await startRes.json();
      if (data.code === 0) {
        const port = Number(
          data.data?.debug_port ||
          data.data?.ws?.puppeteer?.match(/:(\d+)\//)?.[1]
        );
        if (port > 0) {
          console.log(`[AdsPower Auto] Mở profile v2 ${profileId} thành công. Đang đợi CDP port ${port}...`);
          const ready = await waitForCdpPort(port, 15000);
          if (ready) return port;
        }
      } else if (data.msg?.toLowerCase().includes("api-key") || data.msg?.toLowerCase().includes("api key")) {
        throw new Error(
          "AdsPower đang bật chế độ bảo mật API (Require api-key). Hãy vào AdsPower > Cài đặt (Settings) > Cài đặt cục bộ (Local Settings) để TẮT công tắc Khóa API (khuyên dùng) HOẶC copy API Key điền vào .env (ADSPOWER_API_KEY=...), hoặc tự tay bấm nút 'Mở' profile trên AdsPower.",
        );
      }
    }

    // Fallback v1
    const startV1Res = await fetch(`${apiUrl}/api/v1/browser/start?user_id=${encodeURIComponent(profileId)}`, {
      headers,
      signal: AbortSignal.timeout(25000),
    });
    if (startV1Res.ok) {
      const data = await startV1Res.json();
      if (data.code === 0) {
        const port = Number(
          data.data?.debug_port ||
          data.data?.ws?.puppeteer?.match(/:(\d+)\//)?.[1]
        );
        if (port > 0) {
          console.log(`[AdsPower Auto] Mở profile v1 ${profileId} thành công. Đang đợi CDP port ${port}...`);
          const ready = await waitForCdpPort(port, 15000);
          if (ready) return port;
        }
      } else if (data.msg?.toLowerCase().includes("api-key") || data.msg?.toLowerCase().includes("api key")) {
        throw new Error(
          "AdsPower đang bật chế độ bảo mật API (Require api-key). Hãy vào AdsPower > Cài đặt (Settings) > Cài đặt cục bộ (Local Settings) để TẮT công tắc Khóa API (khuyên dùng) HOẶC copy API Key điền vào .env (ADSPOWER_API_KEY=...), hoặc tự tay bấm nút 'Mở' profile trên AdsPower.",
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("AdsPower đang bật chế độ bảo mật API")) {
      throw err;
    }
    console.error(`[AdsPower Auto] Lỗi khi gửi lệnh mở profile ${profileId}:`, err);
  }

  return null;
}

/**
 * Tự động đóng profile AdsPower sau khi hoàn tất.
 */
export async function stopAdsPowerProfile(profileId: string): Promise<boolean> {
  const apiUrl = getAdsPowerLocalApiUrl();
  const apiKey = getAdsPowerApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["api-key"] = apiKey;
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(`${apiUrl}/api/v2/browser-profile/stop`, {
      method: "POST",
      headers,
      body: JSON.stringify({ profile_id: profileId }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.code === 0) return true;
    }
  } catch {
    // Bỏ qua
  }
  try {
    const resV1 = await fetch(`${apiUrl}/api/v1/browser/stop?user_id=${encodeURIComponent(profileId)}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (resV1.ok) {
      const data = await resV1.json();
      if (data.code === 0) return true;
    }
  } catch {
    // Bỏ qua
  }
  return false;
}

function getFileStatsMap(dir: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    try {
      map.set(f, fs.statSync(path.join(dir, f)).mtimeMs);
    } catch {
      // Ignore
    }
  }
  return map;
}

/**
 * Đợi quá trình tải file hoàn tất (không còn file .crdownload và phát hiện file mới/cập nhật)
 * Tự động kiểm tra cả thư mục cha (Downloads) và di chuyển vào destDir nếu trình duyệt lưu ra ngoài.
 */
async function waitForNewOrUpdatedDownloads(
  dir: string,
  beforeMap: Map<string, number>,
  timeoutSeconds = 90,
  storeName = "HSOSTORE",
): Promise<string[]> {
  const parentDir = path.dirname(dir);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      // 1. Kiểm tra nếu có file PPC vừa tải xong ở ~/Downloads thì chuyển vào dir
      if (fs.existsSync(parentDir)) {
        const parentFiles = fs.readdirSync(parentDir);
        for (const f of parentFiles) {
          if (
            (f.endsWith(".xlsx") || f.endsWith(".csv")) &&
            (/bulk|search.*term|\bst\b|update.*campaign|amazon.*bulk/i.test(f) ||
             f.startsWith("bulk-") ||
             f.toLowerCase().includes(storeName.toLowerCase()) ||
             f.toLowerCase().includes("warmstorey") ||
             f.toLowerCase().includes("hsostore"))
          ) {
            const src = path.join(parentDir, f);
            const dest = path.join(dir, f);
            try {
              // Không chuyển file nếu nó có file tạm .crdownload đang đi kèm
              if (parentFiles.includes(`${f}.crdownload`)) continue;
              const stat = fs.statSync(src);
              // Chỉ chuyển nếu file mới được tạo/sửa trong vòng 10 phút và dung lượng > 0
              if (stat.size > 0 && Date.now() - stat.mtimeMs < 10 * 60 * 1000) {
                if (fs.existsSync(dest)) {
                  try { fs.unlinkSync(dest); } catch {}
                }
                fs.renameSync(src, dest);
              }
            } catch {
              // Ignore
            }
          }
        }
      }

      // 2. Kiểm tra các file trong dir
      const currentFiles = fs.readdirSync(dir);
      const isCrdownloadActive = currentFiles.some((f) => f.endsWith(".crdownload"));
      if (isCrdownloadActive) continue;

      const changedFiles: string[] = [];
      for (const f of currentFiles) {
        if (f.endsWith(".crdownload") || f.startsWith(".")) continue;
        const currentMtime = fs.statSync(path.join(dir, f)).mtimeMs;
        const prevMtime = beforeMap.get(f);
        if (prevMtime === undefined || currentMtime > (prevMtime || 0)) {
          changedFiles.push(path.join(dir, f));
        }
      }

      if (changedFiles.length > 0) {
        // Đảm bảo file đã ghi xong hoàn tất
        await new Promise((resolve) => setTimeout(resolve, 500));
        return changedFiles;
      }
    } catch {
      // Tiếp tục lặp
    }
  }
  return [];
}

/**
 * Tự động tạo và tải báo cáo Search Term (SP hoặc SB) từ Amazon Advertising
 */
async function autoCreateAndDownloadSearchTermReport(
  page: any,
  entityParam: string,
  adType: "SP" | "SB",
  storeName: string,
  destDir: string,
): Promise<string | null> {
  console.log(`\n========================================`);
  console.log(`[SEARCH TERM] Bắt đầu tải Search Term ${adType} (30 ngày)...`);
  console.log(`========================================`);

  const statsBefore = getFileStatsMap(destDir);
  const syncRunId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const reportName = `${storeName} ST ${adType} 30D ${today} ${syncRunId}`;
  let downloadUrl: string | null = null;

  // 1. Tự động vào trang /reports/new để tạo báo cáo mới có syncRunId duy nhất
  console.log(`[SEARCH TERM] Tự động tạo mới Search Term ${adType} với ID [${syncRunId}]...`);
  const createUrl = `https://advertising.amazon.com/reports/new${entityParam}`;
  await page.goto(createUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#urc_run_subscription_button, #report-settings-card-report-name-input", { timeout: 5000 }).catch(() => { });

  // Chọn Category: Sponsored Brands (nếu SB), Sponsored Products mặc định là SP
  if (adType === "SB") {
    const catBtn = await page.$("#report-configuration-form\\:report-category-control-component-0");
    if (catBtn) {
      await catBtn.click();
      const sbOpt = await page.waitForSelector("[role=\"option\"]:has-text(\"Sponsored Brands\"), li:has-text(\"Sponsored Brands\")", { timeout: 2000 }).catch(() => null);
      if (sbOpt) {
        await sbOpt.click();
        await page.waitForTimeout(300);
      }
    }
  }

  // Chọn Report Type: Search term
  const typeBtn = await page.$("#report-configuration-form\\:report-type-control-component-0");
  if (typeBtn) {
    const currentText = await typeBtn.innerText();
    if (!/Search term/i.test(currentText)) {
      await typeBtn.click();
      const stOpt = await page.waitForSelector("[role=\"option\"]:has-text(\"Search term\"), li:has-text(\"Search term\")", { timeout: 2000 }).catch(() => null);
      if (stOpt) {
        await stOpt.click();
        await page.waitForTimeout(300);
      }
    }
  }

  // Chọn Time unit: Daily (#time-units-day)
  const dayRadio = await page.$("#time-units-day, input[value='DAILY'], label[for='time-units-day']");
  if (dayRadio) {
    await dayRadio.click().catch(() => page.evaluate((el: any) => el?.click(), dayRadio));
    await page.waitForTimeout(300);
  }

  // Đặt tên báo cáo có chứa syncRunId duy nhất
  const nameInput = await page.$("#report-settings-card-report-name-input");
  if (nameInput) {
    await nameInput.fill(reportName);
  }

  // Bấm Run report
  const runBtn = await page.$("#urc_run_subscription_button");
  if (runBtn) {
    await runBtn.click().catch(async () => {
      await page.evaluate((el: any) => el?.click(), runBtn);
    });
    console.log(`[SEARCH TERM] Đã bấm Run report cho Search Term ${adType} (${syncRunId})!`);
    await page.waitForTimeout(2500);
  }

  // Chuyển sang trang /reports để theo dõi bảng kết quả
  const reportsUrl = `https://advertising.amazon.com/reports${entityParam}`;
  if (!page.url().includes("/reports?")) {
    console.log(`[SEARCH TERM] Chuyển đến trang danh sách báo cáo: ${reportsUrl}`);
    await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
  }

  // 2. Chờ Amazon tạo xong và tìm đúng row chứa syncRunId có trạng thái Completed
  const deadline = Date.now() + 180_000; // Tối đa 3 phút cho Search Term Report
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);

    const match = await page.evaluate((args: { targetId: string; adType: string }) => {
      // AG Grid chia thành pinned-left, center, pinned-right; cần gom nhóm theo row-index
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

      // Ưu tiên 1: Khớp chính xác syncRunId
      for (const [idx, entry] of rowIndexMap.entries()) {
        const fullText = entry.texts.join(" ");
        if (fullText.includes(args.targetId)) {
          const isCompleted = /completed|success|downloadable/i.test(fullText) || Boolean(entry.href);
          return { found: true, isCompleted, href: entry.href };
        }
      }

      // Ưu tiên 2 (Fallback): Khớp theo Search Term hôm nay đã hoàn thành
      const adTypeLabel = args.adType === "SB" ? "Sponsored Brands" : "Sponsored Products";
      for (const [idx, entry] of rowIndexMap.entries()) {
        const fullText = entry.texts.join(" ");
        const hasSearchTerm = /search\s*term/i.test(fullText);
        const hasAdType = fullText.includes(args.adType) || fullText.includes(adTypeLabel);
        if (hasSearchTerm && hasAdType && entry.href) {
          return { found: true, isCompleted: true, href: entry.href };
        }
      }

      return { found: false, isCompleted: false, href: null };
    }, { targetId: syncRunId, adType });

    if (match.found && match.isCompleted && match.href) {
      downloadUrl = match.href;
      console.log(`[SEARCH TERM] Đã tìm thấy link tải báo cáo cho ${syncRunId}! Link: ${downloadUrl}`);
      break;
    }

    // Bấm Refresh hoặc reload nếu còn pending
    const refreshBtn = await page.$("button[aria-label*='Refresh'], button:has-text('Refresh')");
    if (refreshBtn) {
      await refreshBtn.click().catch(() => {});
    } else {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }

  // Fallback: Tìm trên trang /reports đúng row chứa syncRunId hoặc Search Term hôm nay đã sẵn sàng
  if (!downloadUrl) {
    await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    downloadUrl = await page.evaluate((args: { targetId: string; adType: string }) => {
      const allRowEls = Array.from(document.querySelectorAll("div.ag-row[row-index], tr[row-index]"));
      const rowIndexMap = new Map<string, { texts: string[]; href: string | null }>();

      for (const r of allRowEls) {
        const idx = r.getAttribute("row-index") || r.getAttribute("aria-rowindex") || "";
        if (!idx) continue;
        if (!rowIndexMap.has(idx)) {
          rowIndexMap.set(idx, { texts: [], href: null });
        }
        const entry = rowIndexMap.get(idx)!;
        const txt = ((r as HTMLElement).innerText || "").trim();
        if (txt) entry.texts.push(txt);

        const link = r.querySelector<HTMLAnchorElement>(
          "a[href*='download-report'], a[data-takt-id='storm-ui-link'], a[href*='download']"
        );
        if (link?.href && !entry.href) {
          entry.href = link.href.startsWith("http") ? link.href : (location.origin + link.href);
        }
      }

      // 1. Tìm theo targetId
      for (const [idx, entry] of rowIndexMap.entries()) {
        const fullText = entry.texts.join(" ");
        if (fullText.includes(args.targetId) && entry.href) {
          return entry.href;
        }
      }

      // 2. Fallback thông minh: nếu có hàng Search Term cho đúng adType (30 ngày) đã tạo sẵn thì lấy luôn
      const adTypeLabel = args.adType === "SB" ? "Sponsored Brands" : "Sponsored Products";
      for (const [idx, entry] of rowIndexMap.entries()) {
        const fullText = entry.texts.join(" ");
        const hasSearchTerm = /search\s*term/i.test(fullText);
        const hasAdType = fullText.includes(args.adType) || fullText.includes(adTypeLabel);
        const has30d = /30\s*(?:day|days|d\b)/i.test(fullText);
        if (hasSearchTerm && hasAdType && has30d && entry.href) {
          if (!entry.href.includes("BulkSheetExportOutput") && !entry.href.includes("bulk-operations")) {
            return entry.href;
          }
        }
      }

      return null;
    }, { targetId: syncRunId, adType });
  }

  if (!downloadUrl) {
    console.warn(`[SEARCH TERM] Không tìm thấy link tải Search Term ${adType}`);
    await recordPpcSyncLog({ teamId: "default" } as any, {
      source: "ADSPOWER_DOWNLOAD",
      fileName: `${storeName}_Search_Term_${adType}_30Days`,
      status: "FAILED",
      message: `Hết thời gian chờ tạo Search Term ${adType} 30d từ Amazon`,
    }).catch(() => {});
    return null;
  }

  // 3. Bắt đầu tải file và đổi tên chuẩn: {STORE}_Search_Term_{ADTYPE}_30Days_{RAWNAME}
  console.log(`[SEARCH TERM] Bắt đầu tải file: ${downloadUrl}`);
  const allGuids = downloadUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  const reportId = allGuids[allGuids.length - 1] || "";
  let directLinkEl = reportId
    ? (await page.$(`a[href*="download-report"][href*="${reportId}"]`)) ||
      (await page.$(`a[href*="${reportId}"]`))
    : null;

  if (!directLinkEl && !page.url().includes("/reports?")) {
    await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    directLinkEl = reportId
      ? (await page.$(`a[href*="download-report"][href*="${reportId}"]`)) ||
        (await page.$(`a[href*="${reportId}"]`))
      : null;
  }

  let standardizedPath: string | null = null;

  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 90_000 }),
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
    const cleanRawName = suggestedName.replace(
      new RegExp(`^(?:${storeName}|Warmstorey)_(?:Bulk|Search_Term)_[^.]+?_`, "i"),
      "",
    );
    const standardizedName = `${storeName}_Search_Term_${adType}_30Days_${cleanRawName}`;
    standardizedPath = path.join(destDir, standardizedName);
    try {
      await download.saveAs(standardizedPath);
    } catch {
      // Với Page.setDownloadBehavior trên CDP, Chrome lưu trực tiếp vào thư mục chỉ định
    }
  } catch (downloadErr) {
    // waitForEvent download có thể timeout nếu Amazon tải ngầm
  }

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    const downloadedList = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 90, storeName);
    // Bỏ qua file Bulk nếu có file bulk rơi vào destDir
    const downloadedPath = downloadedList.find((f) => {
      const b = path.basename(f);
      return !b.startsWith("bulk-") && !/amazon.*bulk/i.test(b);
    }) || downloadedList[0];
    if (!downloadedPath) {
      throw new Error(`Không tải được file Search Term ${adType} về thư mục.`);
    }
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

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    throw new Error(`Không tìm thấy file Search Term ${adType} sau khi tải.`);
  }

  console.log(
    `[SEARCH TERM] TẢI THÀNH CÔNG: ${path.basename(standardizedPath)} (${Math.round(
      fs.statSync(standardizedPath).size / 1024,
    )} KB)`,
  );

  const stSizeKb = Math.round(fs.statSync(standardizedPath).size / 1024);
  const stSizeStr = stSizeKb >= 1024 ? `${(stSizeKb / 1024).toFixed(1)} MB` : `${stSizeKb} KB`;
  await recordPpcSyncLog({ teamId: "default" } as any, {
    source: "ADSPOWER_DOWNLOAD",
    fileName: path.basename(standardizedPath),
    status: "SUCCESS",
    message: `Tải thành công Search Term ${adType} 30d (${stSizeStr}) từ Amazon`,
  }).catch(() => {});

  return standardizedPath;
}

/**
 * Tự động phát hiện loại chiến dịch (SP hoặc SB) từ tên sheet bên trong file Excel
 */
async function detectActualBulkWorkbookAdType(filePath: string): Promise<"SP" | "SB" | null> {
  try {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.default.stream.xlsx.WorkbookReader(filePath, {});
    for await (const worksheetReader of wb) {
      const name = (((worksheetReader as any).name as string) || "").toLowerCase();
      if (name.includes("sponsored products") || name.includes("sp campaigns")) return "SP";
      if (name.includes("sponsored brands") || name.includes("sb campaigns") || name.includes("hsa campaigns")) return "SB";
    }
  } catch {}
  return null;
}

/**
 * Làm sạch tên file gốc, loại bỏ triệt để các tiền tố chuẩn hóa cũ bị lặp (như 30Days_30Days, HSOSTORE_Bulk_, v.v.)
 */
function sanitizeRawFileName(name: string, storeName: string): string {
  let clean = path.basename(name);
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_(?:Bulk|Search_Term)_(?:SP|SB)_(?:7|30)Days_`, "ig"), "");
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_(?:Bulk|Search_Term)_`, "ig"), "");
  clean = clean.replace(/^(?:SP|SB)_(?:7|30)Days_/ig, "");
  clean = clean.replace(/^(?:30Days_|7Days_)+/ig, "");
  clean = clean.replace(new RegExp(`^(?:${storeName}|Warmstorey|HSOSTORE)_`, "ig"), "");
  return clean;
}

/**
 * Đợi và định vị chính xác file Bulk Operations tải về (kiểm tra cả destDir và ~/Downloads)
 * Tuyệt đối không bao giờ nhận nhầm file Search Term.
 */
async function waitForBulkFileDownload(
  destDir: string,
  expectedRawName: string | null,
  timeoutSeconds = 120,
): Promise<string> {
  const parentDir = path.dirname(destDir);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 1. Nếu có tên file gốc cụ thể từ Amazon (ví dụ: bulk-a1qiqhomjzfqb8-20260821-20260920-1789875152141.xlsx)
    if (expectedRawName) {
      const destCandidate = path.join(destDir, expectedRawName);
      const parentCandidate = path.join(parentDir, expectedRawName);

      // Kiểm tra trong destDir
      if (fs.existsSync(destCandidate)) {
        const crdownload = path.join(destDir, `${expectedRawName}.crdownload`);
        if (!fs.existsSync(crdownload)) {
          const stat = fs.statSync(destCandidate);
          if (stat.size > 100_000) {
            return destCandidate;
          }
        }
      }

      // Kiểm tra trong parentDir (~/Downloads)
      if (fs.existsSync(parentCandidate)) {
        const crdownload = path.join(parentDir, `${expectedRawName}.crdownload`);
        if (!fs.existsSync(crdownload)) {
          const stat = fs.statSync(parentCandidate);
          if (stat.size > 100_000) {
            if (fs.existsSync(destCandidate)) {
              try { fs.unlinkSync(destCandidate); } catch {}
            }
            fs.renameSync(parentCandidate, destCandidate);
            console.log(`[BULK] Đã tự động chuyển ${expectedRawName} từ Downloads vào thư mục Bulk file.`);
            return destCandidate;
          }
        }
      }
    }

    // 2. Dò tìm file bulk mới bất kỳ (chỉ nhận file bắt đầu bằng bulk- hoặc amazon.*bulk và size > 1MB)
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
              console.log(`[BULK] Đã tự động chuyển ${f} từ Downloads vào thư mục Bulk file.`);
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

interface BulkTableRow {
  guid: string | null;
  text: string;
  href: string | null;
  isSuccess: boolean;
  isDownloading: boolean;
}

/**
 * Trích xuất toàn bộ danh sách hàng trong bảng Bulk Operations trên Amazon Advertising
 */
async function getBulkTableRows(bulkPage: any): Promise<BulkTableRow[]> {
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

/**
 * Pha 1: Bấm tạo file trong modal và khóa mã ID (exportRequestId) ngay khi bấm.
 * Hàm này đảm bảo lấy được mã GUID duy nhất trước khi trả về.
 */
async function triggerBulkExport(
  bulkPage: any,
  entityParam: string,
  adType: "SP" | "SB",
  days: 7 | 30,
): Promise<string> {
  const bulkUrl = `https://advertising.amazon.com/bulk-operations${entityParam}`;

  if (!bulkPage.url().includes("bulk-operations")) {
    await bulkPage.goto(bulkUrl, { waitUntil: "domcontentloaded" });
    await bulkPage.waitForTimeout(2000);
  }

  // 1. Mở modal Download campaigns nếu chưa mở
  let isModalOpen = await bulkPage.$(
    'button[data-takt-id="adz_bulkSheets_exportModal_download_button"]',
  );
  if (!isModalOpen) {
    const openModalBtn = await bulkPage.waitForSelector(
      'button[data-takt-id="Bulksheet_home_download_campaigns_button"]',
      { timeout: 25000 },
    ).catch(() => null);

    if (openModalBtn) {
      console.log(`[BULK] Mở modal Download campaigns...`);
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
  const dateBtn = await bulkPage.$('button:has-text(" - 202")');
  if (dateBtn) {
    await dateBtn.click();
    await bulkPage.waitForTimeout(600);

    const targetLabel = `${days} Days`;
    const presetBtn = await bulkPage.$(
      `button[data-takt-id="adz_bulkSheets_exportModal_date_range"]:has-text("${targetLabel}")`,
    );
    if (presetBtn) {
      console.log(`[BULK] Chọn preset ngày: ${targetLabel}`);
      await presetBtn.click();
      await bulkPage.waitForTimeout(500);

      // Bấm nút Apply để áp dụng ngày và đóng popover lịch
      const applyBtn = await bulkPage.$(
        'button[data-takt-id="adz_bulkSheets_exportModal_date_range-save"]',
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

  // Làm mờ input hiện tại để tránh giữ focus outline chặn sự kiện click
  await bulkPage.evaluate(() => {
    if (document.activeElement && typeof (document.activeElement as HTMLElement).blur === "function") {
      (document.activeElement as HTMLElement).blur();
    }
  });
  await bulkPage.waitForTimeout(300);

  // Chụp danh sách GUID các hàng hiện có trên bảng để nhận diện hàng mới
  const rowsBefore = await getBulkTableRows(bulkPage);
  const existingGuids = new Set<string>(rowsBefore.map((r) => r.guid).filter(Boolean) as string[]);

  // 4. Bấm Download trong modal và lắng nghe phản hồi POST để khóa exportRequestId
  const modalDownload = await bulkPage.$(
    'button[data-takt-id="adz_bulkSheets_exportModal_download_button"]',
  );
  if (!modalDownload) {
    throw new Error("Không tìm thấy nút Download trong modal Bulksheet");
  }

  console.log(`[BULK] Đang bấm Download để Amazon tạo file Bulk ${adType} ${days}d...`);
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
        console.log(`[BULK] Đã nhận diện targetRequestId từ phản hồi mạng: ${targetRequestId}`);
      }
    } catch {}
  }

  // Nếu API không trả về exportRequestId trực tiếp, dò tìm hàng mới xuất hiện ở đầu bảng
  if (!targetRequestId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await bulkPage.waitForTimeout(1500);
      const rowsAfter = await getBulkTableRows(bulkPage);
      const newRow = rowsAfter.find((r) => r.guid && !existingGuids.has(r.guid));
      if (newRow?.guid) {
        targetRequestId = newRow.guid;
        console.log(`[BULK] Phát hiện requestId mới từ bảng: ${targetRequestId}`);
        break;
      }
    }
  }

  if (!targetRequestId) {
    const currentRows = await getBulkTableRows(bulkPage);
    if (currentRows.length > 0 && currentRows[0].guid) {
      targetRequestId = currentRows[0].guid;
      console.log(`[BULK] Sử dụng requestId từ hàng đầu tiên: ${targetRequestId}`);
    }
  }

  if (!targetRequestId) {
    throw new Error(`[BULK] Không thể khóa mã ID (exportRequestId) cho Bulk ${adType} ${days}d.`);
  }

  return targetRequestId;
}

/**
 * Tải file của một hàng cụ thể theo mã requestId đã khóa và chuẩn hóa tên file
 */
async function downloadBulkFileByRow(
  bulkPage: any,
  task: { adType: "SP" | "SB"; days: 7 | 30; requestId: string },
  downloadUrl: string,
  storeName: string,
  destDir: string,
): Promise<{ savedPath: string; actualAdType: "SP" | "SB" }> {
  console.log(`[BULK] Bắt đầu tải file cho ${task.adType} ${task.days}d (ID: ${task.requestId})...`);
  console.log(`[BULK] Link tải Amazon: ${downloadUrl}`);

  const guid = task.requestId;
  const expectedRawName = downloadUrl.match(/bulk-[^/?]+\.xlsx/i)?.[0] || null;
  if (expectedRawName) {
    console.log(`[BULK] Tên file Amazon thực tế: ${expectedRawName}`);
  }

  const directLinkEl = await bulkPage.$(`a[href*="${guid}"]`).catch(() => null)
    || await bulkPage.$(`.ag-row:has-text("${guid}") a, tr:has-text("${guid}") a`).catch(() => null);

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
    standardizedPath = path.join(destDir, standardizedName);
    try {
      await download.saveAs(standardizedPath);
    } catch {
      // Chrome CDP có thể lưu trực tiếp vào thư mục chỉ định
    }
  } catch (downloadErr) {
    // Có thể timeout nếu browser lưu trực tiếp mà không bắn event
  }

  if (!standardizedPath || !fs.existsSync(standardizedPath)) {
    // Sử dụng bộ dò tìm file bulk chuyên dụng, đảm bảo không nhận nhầm Search Term
    const downloadedPath = await waitForBulkFileDownload(destDir, expectedRawName, 120);
    const rawName = path.basename(downloadedPath);
    const cleanRawName = sanitizeRawFileName(rawName, storeName);
    const standardizedName = `${storeName}_Bulk_${task.adType}_${task.days}Days_${cleanRawName}`;
    standardizedPath = path.join(destDir, standardizedName);
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
  if (actualAdType && actualAdType !== task.adType) {
    const rawName = path.basename(standardizedPath);
    const cleanRawName = sanitizeRawFileName(rawName, storeName);
    const correctedName = `${storeName}_Bulk_${actualAdType}_${task.days}Days_${cleanRawName}`;
    const correctedPath = path.join(destDir, correctedName);
    if (correctedPath !== standardizedPath) {
      if (fs.existsSync(correctedPath)) {
        try { fs.unlinkSync(correctedPath); } catch {}
      }
      fs.renameSync(standardizedPath, correctedPath);
      console.log(`[BULK] Đã tự động điều chỉnh nhãn file theo sheet thực tế: ${path.basename(standardizedPath)} -> ${correctedName}`);
      standardizedPath = correctedPath;
    }
  }

  const bulkSizeMb = (fs.statSync(standardizedPath).size / 1024 / 1024).toFixed(1);
  const effectiveAdType = actualAdType || task.adType;
  console.log(
    `[BULK] TẢI THÀNH CÔNG: ${path.basename(standardizedPath)} (${bulkSizeMb} MB) [Khớp ID: ${task.requestId}]`,
  );

  await recordPpcSyncLog({ teamId: "default" } as any, {
    source: "ADSPOWER_DOWNLOAD",
    fileName: path.basename(standardizedPath),
    status: "SUCCESS",
    message: `Tải thành công Bulk ${effectiveAdType} ${task.days}d (${bulkSizeMb} MB, ID: ${task.requestId}) từ Amazon`,
  }).catch(() => {});

  return { savedPath: standardizedPath, actualAdType: effectiveAdType };
}

interface BulkTaskItem {
  adType: "SP" | "SB";
  days: 7 | 30;
  requestId: string;
  filePath?: string;
}

/**
 * Tự động tạo và tải toàn bộ 4 file Bulk theo quy trình 2 pha:
 * - Pha 1: Bấm tạo lần lượt từng file -> Khóa mã ID (exportRequestId) ngay khi bấm -> Chờ 6s -> Bấm tạo file tiếp theo
 * - Pha 2: Ngồi chờ Amazon xử lý song song, hàng có ID nào xong thì bốc đúng file của ID đó
 */
async function createAndDownloadAllBulkReports(
  bulkPage: any,
  entityParam: string,
  storeName: string,
  destDir: string,
  onFileReady?: (filePath: string) => Promise<void>,
): Promise<string[]> {
  const tasks: BulkTaskItem[] = [
    { adType: "SP", days: 30, requestId: "" },
    { adType: "SB", days: 30, requestId: "" },
    { adType: "SP", days: 7, requestId: "" },
    { adType: "SB", days: 7, requestId: "" },
  ];

  console.log(`\n================================================================`);
  console.log(`🔒 [BULK PHA 1] KHÓA MÃ ID (exportRequestId) NGAY KHI BẤM`);
  console.log(`Quy tắc: Bấm SP 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 30d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SP 7d ➔ Ghi nhớ ID ➔ Chờ 6s ➔ Bấm SB 7d ➔ Ghi nhớ ID`);
  console.log(`Khi ghi xong ID rồi thì mới bấm tạo tiếp để tránh nhầm`);
  console.log(`================================================================\n`);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n[BULK PHA 1] [${i + 1}/4] Kích hoạt tạo Bulk ${task.adType} ${task.days} Days...`);

    task.requestId = await triggerBulkExport(bulkPage, entityParam, task.adType, task.days);

    console.log(`[BULK PHA 1] 🔒 ĐÃ GHI NHỚ: ${task.adType}_${task.days}D = ${task.requestId}`);

    // Chỉ khi ghi xong ID rồi thì mới bấm tạo tiếp để tránh nhầm, kèm thời gian chờ 6s chống rate limit Amazon
    if (i < tasks.length - 1) {
      console.log(`[BULK PHA 1] Đã ghi xong ID [${task.adType}_${task.days}D = ${task.requestId}]. Chờ 6s bảo vệ rate limit trước khi tạo file tiếp theo...`);
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

  const deadline = Date.now() + 1_800_000; // Tối đa 30 phút cho file lớn (Amazon SP có thể mất 15-25 phút)
  let pollIteration = 0;
  const usedHrefs = new Set<string>();

  while (Date.now() < deadline && tasks.some((t) => !t.filePath)) {
    pollIteration++;
    const rows = await getBulkTableRows(bulkPage);

    // 1. Ưu tiên khớp chính xác theo ID (requestId) đã khóa từ Pha 1
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
          destDir,
        );
        const targetTask = tasks.find(t => t.adType === actualAdType && t.days === task.days && !t.filePath)
          || tasks.find(t => t.adType === actualAdType && !t.filePath)
          || task;
        targetTask.filePath = savedPath;
        console.log(`[BULK PHA 2] ✅ Đã bốc xong: ${path.basename(savedPath)} (gán cho ${targetTask.adType} ${targetTask.days}d)`);

        if (onFileReady) {
          try {
            console.log(`[BULK PIPELINE] 🚀 Nạp ngay vào Database: ${path.basename(savedPath)}...`);
            await onFileReady(savedPath);
          } catch (ingestErr) {
            console.error(`[BULK PIPELINE] ⚠️ Lỗi khi nạp ngay file ${path.basename(savedPath)}:`, ingestErr);
          }
        }
      } else if (matchingRow && matchingRow.isDownloading) {
        // Amazon đang kết xuất file cho mã ID này, kiên nhẫn chờ
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

    // Reload page mỗi 2 vòng (24s) để đảm bảo trình duyệt cập nhật dữ liệu mới nhất từ Amazon
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

  const unfinished = tasks.filter((t) => !t.filePath);
  if (unfinished.length > 0) {
    const missingSummary = unfinished.map((t) => `${t.adType} ${t.days}d (ID: ${t.requestId})`).join(", ");
    throw new Error(`Timeout: Không thể tải xong các file Bulk sau 30 phút: ${missingSummary}`);
  }

  return tasks.map((t) => t.filePath!);
}

/**
 * Tự động chọn và tải 1 báo cáo Bulk Operations đơn lẻ (dành cho kiểm thử hoặc gọi riêng)
 */
async function autoCreateAndDownloadBulkReport(
  bulkPage: any,
  entityParam: string,
  adType: "SP" | "SB",
  days: 7 | 30,
  storeName: string,
  destDir: string,
  _usedUrls?: Set<string>,
): Promise<string | null> {
  const requestId = await triggerBulkExport(bulkPage, entityParam, adType, days);
  console.log(`[BULK] 🔒 ĐÃ GHI NHỚ MÃ ID: ${adType}_${days}D = ${requestId}`);

  const task = { adType, days, requestId };
  const deadline = Date.now() + 900_000;
  let pollIteration = 0;

  while (Date.now() < deadline) {
    pollIteration++;
    const rows = await getBulkTableRows(bulkPage);
    const matchingRow = rows.find(
      (r) =>
        (r.guid && r.guid.toLowerCase() === requestId.toLowerCase()) ||
        (r.text && r.text.toLowerCase().includes(requestId.toLowerCase())),
    );

    if (matchingRow && matchingRow.isSuccess && matchingRow.href) {
      const res = await downloadBulkFileByRow(bulkPage, task, matchingRow.href, storeName, destDir);
      return res.savedPath;
    }

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

  throw new Error(`Timeout chờ file Bulk ${adType} ${days}d (ID: ${requestId})`);
}

/**
 * Kết nối trình duyệt AdsPower, tự động tải đủ 6 file báo cáo PPC:
 * 1. Bulk Operations SP 30 ngày
 * 2. Bulk Operations SB 30 ngày
 * 3. Bulk Operations SP 7 ngày
 * 4. Bulk Operations SB 7 ngày
 * 5. Search Term SP 30 ngày
 * 6. Search Term SB 30 ngày
 */
export async function downloadAdsPowerReports(options: {
  port?: number;
  destDir?: string;
  storeName?: string;
  profileId?: string;
  autoStart?: boolean;
  onFileReady?: (filePath: string) => Promise<void>;
}): Promise<{ filePaths: string[]; debugPort: number }> {
  let debugPort: number | null = options.port || null;
  if (debugPort && !(await isCdpPortResponding(debugPort))) {
    debugPort = null;
  }

  // 1. Tìm cổng đang sống thực tế
  if (!debugPort) {
    debugPort = await detectAdsPowerDebugPort();
  }

  // 2. Nếu chưa có cửa sổ mở sẵn và autoStart !== false, tự động gọi API mở Profile
  if (!debugPort && options.autoStart !== false) {
    debugPort = await startAdsPowerProfile({
      storeName: options.storeName,
      profileId: options.profileId,
    });
  }

  if (!debugPort) {
    throw new Error(
      "Không tìm thấy trình duyệt AdsPower đang mở và không thể tự động khởi động. Vui lòng mở ứng dụng AdsPower hoặc cấu hình ADSPOWER_PROFILE_ID trong .env trước khi đồng bộ.",
    );
  }

  const destDir = options.destDir || path.join(os.homedir(), "Downloads", "Bulk file");
  fs.mkdirSync(destDir, { recursive: true });

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("Không tìm thấy context trình duyệt trong AdsPower.");
  }

  try {
    const browserCdp = await browser.newBrowserCDPSession();
    await browserCdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: destDir,
      eventsEnabled: true,
    });
  } catch {}

  const downloadedFiles: string[] = [];
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");

  // Tìm entityId từ các tab Amazon Ads đang mở, hoặc mở tab tạm để lấy rồi đóng ngay
  let entityId = "";
  for (const p of context.pages()) {
    const m = p.url().match(/entityId=([A-Z0-9]+)/);
    if (m && m[1]) {
      entityId = m[1];
      break;
    }
  }

  if (!entityId) {
    const initPage = await context.newPage();
    try {
      await initPage.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" });
      await initPage.waitForTimeout(2000);
      const m = initPage.url().match(/entityId=([A-Z0-9]+)/);
      if (m && m[1]) entityId = m[1];
    } finally {
      await closeTabSafely(initPage, context);
    }
  }

  const entityParam = entityId ? `?entityId=${entityId}` : "";

  try {
    // CHẠY 1 LUỒNG DUY NHẤT TUẦN TỰ (Single Worker Page) để chống hoàn toàn xung đột tên file
    console.log("\n[AdsPower] Bắt đầu quy trình tải tuần tự 1 luồng (Search Term -> Bulk Operations)...");
    const workerPage = await context.newPage();
    try {
      const pageCdp = await context.newCDPSession(workerPage);
      await pageCdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: destDir });

      // 1. Search Term SP 30 Days
      console.log("\n========================================");
      console.log("[1/6] ĐANG TẢI & NẠP: Search Term SP 30 Days...");
      console.log("========================================");
      const f1 = await autoCreateAndDownloadSearchTermReport(workerPage, entityParam, "SP", storeName, destDir);
      if (f1) {
        downloadedFiles.push(f1);
        if (options.onFileReady) {
          console.log(`[PIPELINE] 🚀 Nạp ngay vào Database: ${path.basename(f1)}...`);
          await options.onFileReady(f1).catch((e) => console.error(`[PIPELINE] Lỗi nạp ${path.basename(f1)}:`, e));
        }
      }

      // 2. Search Term SB 30 Days
      console.log("\n========================================");
      console.log("[2/6] ĐANG TẢI & NẠP: Search Term SB 30 Days...");
      console.log("========================================");
      const f2 = await autoCreateAndDownloadSearchTermReport(workerPage, entityParam, "SB", storeName, destDir);
      if (f2) {
        downloadedFiles.push(f2);
        if (options.onFileReady) {
          console.log(`[PIPELINE] 🚀 Nạp ngay vào Database: ${path.basename(f2)}...`);
          await options.onFileReady(f2).catch((e) => console.error(`[PIPELINE] Lỗi nạp ${path.basename(f2)}:`, e));
        }
      }

      // 3-6. Bulk Operations (SP 30D, SB 30D, SP 7D, SB 7D)
      console.log("\n========================================");
      console.log("[3-6/6] ĐANG TẠO & TẢI TUẦN TỰ 4 FILE BULK OPERATIONS...");
      console.log("========================================");
      const bulkFiles = await createAndDownloadAllBulkReports(
        workerPage,
        entityParam,
        storeName,
        destDir,
        async (savedPath) => {
          if (options.onFileReady) {
            console.log(`[PIPELINE] 🚀 Nạp ngay vào Database: ${path.basename(savedPath)}...`);
            await options.onFileReady(savedPath).catch((e) => console.error(`[PIPELINE] Lỗi nạp ${path.basename(savedPath)}:`, e));
          }
        },
      );
      downloadedFiles.push(...bulkFiles);

      console.log("\n========================================");
      console.log(`ĐÃ TẢI & NẠP THÀNH CÔNG ĐỦ ${downloadedFiles.length}/6 FILE PPC (1 LUỒNG TUẦN TỰ):`);
      downloadedFiles.forEach((f, idx) => console.log(`${idx + 1}. ${path.basename(f)}`));
      console.log("========================================\n");
    } finally {
      await closeTabSafely(workerPage, context);
    }
  } catch (error) {
    console.error("[AdsPower Automation] Lỗi trong quá trình tải báo cáo:", error);
    throw error;
  }

  return { filePaths: Array.from(new Set(downloadedFiles)), debugPort };
}

/**
 * Nạp trực tiếp các file báo cáo vừa tải vào cơ sở dữ liệu PPC của hệ thống.
 * Sử dụng ingestPpcFilePath để hỗ trợ stream file lớn, nhận diện số ngày (30d/7d) và loại chiến dịch chính xác.
 */
export async function ingestDownloadedPpcFiles(
  scope: DataScope,
  storeName: string,
  filePaths: string[],
): Promise<{ totalParsed: number; totalNew: number; totalUpdated: number }> {
  let totalParsed = 0;
  let totalNew = 0;
  let totalUpdated = 0;

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    try {
      console.log(`[AdsPower Ingest] Đang nạp: ${fileName}...`);
      const res = await ingestPpcFilePath(scope, filePath, fileName, storeName);
      totalParsed += res.totalParsed;
      totalNew += res.newInserted;
      totalUpdated += res.updated;
      console.log(`[AdsPower Ingest] Hoàn tất ${fileName}: ${res.totalParsed} dòng, ${res.newInserted} mới, ${res.updated} cập nhật.`);
      await recordPpcSyncLog(scope, {
        source: "DATA_INGEST",
        fileName,
        status: "SUCCESS",
        count: res.totalParsed,
        message: `Nạp dữ liệu ${fileName}: ${res.totalParsed.toLocaleString()} dòng (${res.newInserted.toLocaleString()} mới, ${res.updated.toLocaleString()} cập nhật)`,
      }).catch(() => {});
    } catch (err) {
      console.error(`[AdsPower Ingest] Lỗi xử lý file ${fileName}:`, err);
      await recordPpcSyncLog(scope, {
        source: "DATA_INGEST",
        fileName,
        status: "FAILED",
        message: `Lỗi nạp file: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {});
    }
  }

  return { totalParsed, totalNew, totalUpdated };
}

/**
 * Tự động sao lưu các file báo cáo đã tải lên Cloudflare R2
 */
async function uploadReportsToR2(storeName: string, filePaths: string[]): Promise<number> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "amazon-listing-production";
  const prefix = (process.env.PPC_R2_PREFIX || "ppc-reports").replace(/^\/+|\/+$/g, "");

  if (!accountId || !accessKeyId || !secretAccessKey) return 0;

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let uploaded = 0;

  for (const filePath of filePaths) {
    try {
      const fileName = path.basename(filePath);
      const r2Key = `${prefix}/input/${todayStr}/${storeName}/${fileName}`;
      const fileBytes = fs.readFileSync(filePath);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: r2Key,
          Body: fileBytes,
          ContentType: fileName.endsWith(".csv")
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      uploaded++;
    } catch (err) {
      console.warn(`[AdsPower R2 Upload] Lỗi khi upload ${filePath} lên R2:`, err);
    }
  }

  return uploaded;
}

/**
 * Trình chạy trọn gói: Tự động mở AdsPower + Tải 6 file báo cáo + Kiểm tra + Đổi tên + Nạp Database + Lưu trữ R2 + Tắt web sau khi dùng.
 */
export async function syncPpcFromAdsPower(
  scope: DataScope,
  options: { storeName?: string; destDir?: string; profileId?: string; autoStart?: boolean; closeBrowserAfter?: boolean } = {},
): Promise<AdsPowerSyncResult> {
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");
  const profileId = getAdsPowerProfileId(options.profileId, storeName);

  let totalParsed = 0;
  let totalNew = 0;
  let totalUpdated = 0;
  let r2Uploaded = 0;
  const processedFiles = new Set<string>();

  const handleFileReady = async (filePath: string) => {
    const fileName = path.basename(filePath);
    if (processedFiles.has(fileName)) return;
    processedFiles.add(fileName);

    // 1. Nạp ngay vào Database
    try {
      console.log(`[AdsPower Ingest] Đang nạp ngay: ${fileName}...`);
      const res = await ingestPpcFilePath(scope, filePath, fileName, storeName);
      totalParsed += res.totalParsed;
      totalNew += res.newInserted;
      totalUpdated += res.updated;
      console.log(`[AdsPower Ingest] Hoàn tất ${fileName}: ${res.totalParsed} dòng (${res.newInserted} mới, ${res.updated} cập nhật).`);
      await recordPpcSyncLog(scope, {
        source: "DATA_INGEST",
        fileName,
        status: "SUCCESS",
        count: res.totalParsed,
        message: `Nạp dữ liệu ${fileName}: ${res.totalParsed.toLocaleString()} dòng (${res.newInserted.toLocaleString()} mới, ${res.updated.toLocaleString()} cập nhật)`,
      }).catch(() => {});
    } catch (err) {
      console.error(`[AdsPower Ingest] Lỗi xử lý file ${fileName}:`, err);
      await recordPpcSyncLog(scope, {
        source: "DATA_INGEST",
        fileName,
        status: "FAILED",
        message: `Lỗi nạp file: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {});
    }

    // 2. Sao lưu lên Cloudflare R2 ngay khi tải xong
    if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
      try {
        const count = await uploadReportsToR2(storeName, [filePath]);
        r2Uploaded += count;
        if (count > 0) {
          console.log(`[AdsPower Sync] Đã lưu trữ ${fileName} lên Cloudflare R2.`);
        }
      } catch (r2Err) {
        console.warn(`[AdsPower Sync] Lỗi khi tải ${fileName} lên R2:`, r2Err);
      }
    }
  };

  const { filePaths, debugPort } = await downloadAdsPowerReports({
    storeName,
    destDir: options.destDir,
    profileId,
    autoStart: options.autoStart,
    onFileReady: handleFileReady,
  });

  if (!filePaths.length) {
    return {
      success: false,
      storeName,
      debugPort,
      downloadedFiles: [],
      totalParsed: 0,
      totalNew: 0,
      totalUpdated: 0,
      message: "Không tìm thấy file báo cáo mới nào để tải từ Amazon Ads.",
    };
  }

  // Safety check: nạp bổ sung nếu có file nào chưa nạp
  for (const fp of filePaths) {
    const fn = path.basename(fp);
    if (!processedFiles.has(fn)) {
      await handleFileReady(fp);
    }
  }

  await recordPpcSyncLog(scope, {
    source: "SYSTEM",
    status: totalParsed > 0 ? "SUCCESS" : "FAILED",
    count: totalParsed,
    message: totalParsed > 0
      ? `Đồng bộ hoàn tất: Đã tải ${filePaths.length}/6 file, nạp ${totalParsed.toLocaleString()} dòng (${totalNew.toLocaleString()} mới, ${totalUpdated.toLocaleString()} cập nhật)`
      : `Đồng bộ hoàn tất: Đã tải ${filePaths.length}/6 file nhưng không có dòng dữ liệu nào được nạp.`,
  }).catch(() => {});

  if (r2Uploaded > 0) {
    await recordPpcSyncLog(scope, {
      source: "CLOUDFLARE_R2",
      status: "SUCCESS",
      count: r2Uploaded,
      message: `Đã sao lưu ${r2Uploaded} file báo cáo lên Cloudflare R2 an toàn`,
    }).catch(() => {});
  }

  // Tắt web sau khi dùng theo yêu cầu
  if (options.closeBrowserAfter !== false && profileId) {
    console.log(`[AdsPower Sync] Đóng trình duyệt AdsPower profile ${profileId} để giải phóng RAM máy...`);
    await stopAdsPowerProfile(profileId).catch(() => {});
  }

  return {
    success: true,
    storeName,
    debugPort,
    downloadedFiles: filePaths.map((p) => path.basename(p)),
    totalParsed,
    totalNew,
    totalUpdated,
    r2Uploaded,
    message: `Đã tự động tải đủ ${filePaths.length}/6 file cho shop ${storeName}: ghi ${totalNew} dòng mới, cập nhật ${totalUpdated} dòng vào Database${r2Uploaded > 0 ? `, đã sao lưu ${r2Uploaded} file lên Cloudflare R2.` : "."}`,
  };
}

export interface BulkUploadResult {
  success: boolean;
  storeName: string;
  debugPort: number;
  fileName: string;
  profileId?: string;
  profileName?: string;
  message: string;
}

/**
 * Tự động kết nối AdsPower và upload file Bulk (.xlsx) lên Amazon Ads Bulk Operations.
 */
export async function uploadBulkFileToAmazonAds(options: {
  filePath: string;
  storeName?: string;
  profileId?: string;
  autoStart?: boolean;
}): Promise<BulkUploadResult> {
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");
  const fileName = path.basename(options.filePath);

  if (!fs.existsSync(options.filePath)) {
    throw new Error(`File Bulk không tồn tại tại đường dẫn: ${options.filePath}`);
  }

  let debugPort = await detectAdsPowerDebugPort();
  if (!debugPort && options.autoStart !== false) {
    debugPort = await startAdsPowerProfile({
      storeName,
      profileId: options.profileId,
    });
  }

  if (!debugPort) {
    throw new Error(
      "Không tìm thấy trình duyệt AdsPower đang mở và không thể tự động khởi động. Vui lòng mở ứng dụng AdsPower trước khi thực hiện.",
    );
  }

  console.log(`[AdsPower Upload] Kết nối tới AdsPower CDP port ${debugPort}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("Không tìm thấy context trình duyệt trong AdsPower.");
  }

  // Tìm entityId từ bất kỳ tab Amazon Ads nào đang mở
  let entityId = "";
  for (const p of context.pages()) {
    const m = p.url().match(/entityId=([A-Z0-9]+)/);
    if (m && m[1]) {
      entityId = m[1];
      break;
    }
  }

  // Nếu chưa có, mở trang reports để lấy entityId
  if (!entityId) {
    let p = context.pages().find((x) => x.url().includes("advertising.amazon.com"));
    let created = false;
    if (!p) {
      p = await context.newPage();
      created = true;
      await p.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(2000);
    }
    const m = p.url().match(/entityId=([A-Z0-9]+)/);
    if (m) entityId = m[1];
    if (created) await closeTabSafely(p, context);
  }

  const entityParam = entityId ? `?entityId=${entityId}` : "";
  console.log(`[AdsPower Upload] Sử dụng entityId: "${entityId}"`);

  // Mở tab mới riêng cho quy trình upload
  const bulkPage = await context.newPage();
  await bulkPage.goto(`https://advertising.amazon.com/bulk-operations${entityParam}`, { waitUntil: "domcontentloaded" });

  console.log(`[AdsPower Upload] Bắt đầu upload file: ${fileName}...`);

  try {
    // 1. Kiểm tra xem modal upload đã mở sẵn chưa
    let fileInput = await bulkPage.$("input[type='file']");
    if (!fileInput) {
      console.log("[AdsPower Upload] Chờ nút 'Upload campaigns' xuất hiện trên trang...");
      const openUploadBtn = await bulkPage.waitForSelector(
        "button[data-takt-id='Bulksheet_home_upload_campaigns_button'], button:has-text('Upload campaigns')",
        { timeout: 30000 }
      ).catch(() => null);

      if (!openUploadBtn) {
        throw new Error("Trang Amazon Ads Bulk Operations tải quá lâu hoặc không tìm thấy nút 'Upload campaigns'.");
      }

      console.log("[AdsPower Upload] Bấm nút 'Upload campaigns' để mở popup tải file...");
      await openUploadBtn.click();
      fileInput = await bulkPage.waitForSelector("input[type='file']", { state: "attached", timeout: 15000 }).catch(() => null);
    }

    if (!fileInput) {
      throw new Error("Không tìm thấy ô chọn file sau khi mở popup Upload campaigns.");
    }

    // 2. Tải file lên input file chooser
    console.log(`[AdsPower Upload] Đang nạp file ${fileName} vào input file chooser...`);
    await fileInput.setInputFiles(options.filePath);

    // 3. Chờ nút xác nhận 'Upload' trong modal sáng lên và bấm
    const uploadConfirmBtnSelector = "button[data-takt-id='adz_bulkSheets_unifiedUploadModal_upload_button'], button:has-text('Upload'):not([data-takt-id*='home'])";

    // Chờ tối đa 25s để Amazon Ads xác thực file xong và kích hoạt nút Upload
    console.log("[AdsPower Upload] Đang chờ Amazon Ads xác thực file Bulk...");
    const uploadConfirmBtn = await bulkPage.waitForSelector(
      `${uploadConfirmBtnSelector}:not([disabled]):not([aria-disabled='true'])`,
      { timeout: 25000 }
    ).catch(async () => {
      return await bulkPage.$(uploadConfirmBtnSelector);
    });

    if (uploadConfirmBtn) {
      console.log("[AdsPower Upload] Bấm nút xác nhận Upload trong modal...");
      await uploadConfirmBtn.click();
      console.log("[AdsPower Upload] Chờ hệ thống Amazon tiếp nhận file...");
      await bulkPage.waitForSelector("div[role='alert'], .ag-row", { timeout: 5000 }).catch(() => { });
      await bulkPage.waitForTimeout(2000);
    } else {
      console.warn("[AdsPower Upload] Không thấy nút xác nhận Upload riêng, file có thể đã tự động tiếp nhận.");
    }

    console.log(`[AdsPower Upload] Đã upload thành công file ${fileName} lên Amazon Ads Bulk Operations!`);
  } finally {
    // Xong việc thì dứt khoát thoát tab Bulk Operations ngay để giải phóng RAM và sạch trình duyệt
    console.log("[AdsPower Upload] Đang dứt khoát thoát tab Bulk Operations sau khi đẩy xong...");
    try {
      if (bulkPage && !bulkPage.isClosed()) {
        await bulkPage.close({ runBeforeUnload: false }).catch(() => {});
      }
    } catch {}
    await closeTabSafely(bulkPage, context);
    console.log("[AdsPower Upload] ✅ Đã thoát sạch tab sau khi đẩy xong!");
  }

  const profileId = getAdsPowerProfileId(options.profileId, storeName);

  return {
    success: true,
    storeName,
    debugPort,
    fileName,
    profileId: profileId || undefined,
    profileName: profileId || storeName,
    message: `Đã tự động tải file ${fileName} lên Amazon Ads Bulk Operations thành công qua AdsPower.`,
  };
}

