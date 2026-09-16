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
  } catch {}
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
    } catch {}
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
    } catch {}
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
      return data.code === 0;
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
  timeoutSeconds = 30,
): Promise<string[]> {
  const parentDir = path.dirname(dir);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      // 1. Kiểm tra nếu có file PPC vừa tải xong ở ~/Downloads thì chuyển vào dir
      if (fs.existsSync(parentDir)) {
        const parentFiles = fs.readdirSync(parentDir);
        const hasParentCr = parentFiles.some((f) => f.endsWith(".crdownload"));
        if (!hasParentCr) {
          for (const f of parentFiles) {
            if (
              (f.endsWith(".xlsx") || f.endsWith(".csv")) &&
              (/bulk|search.*term|update.*campaign|amazon.*bulk/i.test(f) || f.startsWith("bulk-") || f.startsWith("Warmstorey"))
            ) {
              const src = path.join(parentDir, f);
              const dest = path.join(dir, f);
              try {
                // Chỉ chuyển nếu file mới được tạo trong vòng 5 phút
                const stat = fs.statSync(src);
                if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) {
                  fs.renameSync(src, dest);
                }
              } catch {
                // Ignore
              }
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
  const statsBefore = getFileStatsMap(destDir);
  const reportsUrl = `https://advertising.amazon.com/reports${entityParam}`;

  // 1. Kiểm tra xem trên trang /reports đã có báo cáo Search Term cho adType vừa tạo hôm nay chưa
  await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const existingDownloadLink = await page.evaluate((type: string) => {
    const rows = Array.from(document.querySelectorAll("div.ag-row"));
    for (const r of rows) {
      const text = ((r as HTMLElement).innerText || "").trim();
      const isTarget = type === "SP" 
        ? /Search Term SP|Sponsored Products Search term/i.test(text)
        : /Search Term SB|Sponsored Brands Search term/i.test(text);
      if (isTarget) {
        const link = r.querySelector<HTMLAnchorElement>("a[data-takt-id='storm-ui-link'], a[href*='download-report']");
        if (link?.href) return link.href;
      }
    }
    return null;
  }, adType);

  if (existingDownloadLink) {
    console.log(`[AdsPower Auto] Tìm thấy link tải Search Term ${adType} có sẵn, tiến hành tải...`);
    await page.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, existingDownloadLink);

    const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 20);
    if (downloaded.length > 0) return downloaded[0];
  }

  // 2. Nếu chưa có hoặc muốn tạo mới: Tự động vào trang /reports/new để tạo cấu hình và chạy báo cáo
  console.log(`[AdsPower Auto] Tự động tạo mới báo cáo Search Term ${adType}...`);
  const createUrl = `https://advertising.amazon.com/reports/new${entityParam}`;
  await page.goto(createUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Chọn Category: Sponsored Brands (nếu SB), Sponsored Products mặc định là SP
  if (adType === "SB") {
    const catBtn = await page.$("#report-configuration-form\\:report-category-control-component-0");
    if (catBtn) {
      await catBtn.click();
      await page.waitForTimeout(800);
      const sbOpt = await page.$("[role=\"option\"]:has-text(\"Sponsored Brands\"), li:has-text(\"Sponsored Brands\")");
      if (sbOpt) await sbOpt.click();
      await page.waitForTimeout(1200);
    }
  }

  // Chọn Report Type: Search term
  const typeBtn = await page.$("#report-configuration-form\\:report-type-control-component-0");
  if (typeBtn) {
    const currentText = await typeBtn.innerText();
    if (!/Search term/i.test(currentText)) {
      await typeBtn.click();
      await page.waitForTimeout(800);
      const stOpt = await page.$("[role=\"option\"]:has-text(\"Search term\"), li:has-text(\"Search term\")");
      if (stOpt) await stOpt.click();
      await page.waitForTimeout(1000);
    }
  }

  // Đặt tên báo cáo
  const nameInput = await page.$("#report-settings-card-report-name-input");
  if (nameInput) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    await nameInput.fill(`${storeName} Search Term ${adType} ${today} Auto`);
  }

  // Bấm Run report
  const runBtn = await page.$("#urc_run_subscription_button");
  if (runBtn) {
    await runBtn.click();
    console.log(`[AdsPower Auto] Đã bấm Run report cho Search Term ${adType}!`);
  }

  // Chờ Amazon tạo xong (tối đa 40s) và lấy link tải
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    // Nếu đang ở trang history
    const dlOnHistory = await page.$eval(
      "a[data-takt-id='storm-ui-link'][href*='download-report'], a[href*='download-report']",
      (a: any) => a.href,
    ).catch(() => null);

    if (dlOnHistory) {
      await page.evaluate((url: string) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, dlOnHistory);

      const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 25);
      if (downloaded.length > 0) return downloaded[0];
    }

    // Kiểm tra trên trang danh sách /reports
    if (page.url().includes("/reports/history") && (await page.innerText("body")).includes("Pending")) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }

  // Fallback: Tìm lại trên trang /reports
  await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const fallbackLink = await page.evaluate((type: string) => {
    const rows = Array.from(document.querySelectorAll("div.ag-row"));
    for (const r of rows) {
      const text = ((r as HTMLElement).innerText || "").trim();
      const isTarget = type === "SP" ? /Search Term SP/i.test(text) : /Search Term SB/i.test(text);
      if (isTarget) {
        const link = r.querySelector<HTMLAnchorElement>("a[href*='download-report']");
        if (link?.href) return link.href;
      }
    }
    return null;
  }, adType);

  if (fallbackLink) {
    await page.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, fallbackLink);
    const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 20);
    if (downloaded.length > 0) return downloaded[0];
  }

  return null;
}

/**
 * Tự động chọn và tải báo cáo Bulk Operations (SP hoặc SB) từ Amazon Advertising
 */
async function autoCreateAndDownloadBulkReport(
  bulkPage: any,
  entityParam: string,
  adType: "SP" | "SB",
  destDir: string,
): Promise<string | null> {
  const statsBefore = getFileStatsMap(destDir);
  const bulkUrl = `https://advertising.amazon.com/bulk-operations${entityParam}`;

  if (!bulkPage.url().includes("bulk-operations")) {
    await bulkPage.goto(bulkUrl, { waitUntil: "domcontentloaded" });
    await bulkPage.waitForTimeout(2500);
  }

  console.log(`[AdsPower Auto] Đang cấu hình và yêu cầu file Bulk ${adType}...`);

  // Mở modal Download campaigns nếu chưa mở
  const isModalOpen = await bulkPage.$("[data-takt-id='adz_bulkSheets_exportModal_download_button']");
  if (!isModalOpen) {
    await bulkPage.click("button[data-takt-id='Bulksheet_home_download_campaigns_button']");
    await bulkPage.waitForTimeout(1500);
  }

  // Tùy chỉnh Checkbox theo adType
  const spInput = await bulkPage.$("label:has-text('Sponsored Products data') input");
  const sbInput = await bulkPage.$("label:has-text('Sponsored Brands data') input");

  if (adType === "SP") {
    if (spInput && !(await spInput.isChecked())) {
      await bulkPage.click("label:has-text('Sponsored Products data')");
    }
    if (sbInput && (await sbInput.isChecked())) {
      await bulkPage.click("label:has-text('Sponsored Brands data')");
    }
  } else {
    // SB
    if (sbInput && !(await sbInput.isChecked())) {
      await bulkPage.click("label:has-text('Sponsored Brands data')");
    }
    if (spInput && (await spInput.isChecked())) {
      await bulkPage.click("label:has-text('Sponsored Products data')");
    }
  }
  await bulkPage.waitForTimeout(800);

  // Bấm Download trong modal để Amazon bắt đầu tạo file
  const modalDownloadBtn = await bulkPage.$("button[data-takt-id='adz_bulkSheets_exportModal_download_button']");
  if (modalDownloadBtn) {
    await modalDownloadBtn.click();
    console.log(`[AdsPower Auto] Đã gửi yêu cầu tạo Bulk file ${adType}!`);
  }

  // Đợi link tải Bulk xuất hiện ở dòng đầu tiên của bảng Bulksheet
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await bulkPage.waitForTimeout(4000);
    // Bấm nút Refresh bảng nếu có
    await bulkPage.click("button[aria-label*='Refresh'], button:has-text('Refresh')").catch(() => {});

    const downloadLink = await bulkPage.evaluate(() => {
      const firstRow = document.querySelector(".ag-center-cols-container .ag-row, .ag-row-first");
      if (!firstRow) return null;
      const link = firstRow.querySelector<HTMLAnchorElement>("a[data-takt-id='Bulksheet_originalFileAction_download_original_file'], a[href*='bulk-operations/download'], a[href*='bulk-operations']");
      return link?.href || null;
    });

    if (downloadLink) {
      console.log(`[AdsPower Auto] Tìm thấy link tải Bulk ${adType}, bắt đầu tải...`);
      await bulkPage.evaluate((url: string) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, downloadLink);

      const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 20);
      if (downloaded.length > 0) return downloaded[0];
      break;
    }
  }

  // Fallback: Tìm link tải mới nhất hiện có trên bảng
  const topLink = await bulkPage.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>("a[data-takt-id='Bulksheet_originalFileAction_download_original_file'], a[href*='bulk-operations/download']");
    return link?.href || null;
  });

  if (topLink) {
    await bulkPage.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, topLink);
    const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 15);
    if (downloaded.length > 0) return downloaded[0];
  }

  return null;
}

/**
 * Kết nối trình duyệt AdsPower, tự động chọn, tạo và tải đủ 4 file báo cáo PPC:
 * 1. Search Term SP
 * 2. Search Term SB
 * 3. Bulk Operations SP
 * 4. Bulk Operations SB
 */
export async function downloadAdsPowerReports(options: {
  port?: number;
  destDir?: string;
  storeName?: string;
  profileId?: string;
  autoStart?: boolean;
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

  const downloadedFiles: string[] = [];
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");

  // Tìm hoặc mở trang Amazon Ads để lấy entityId
  let page = context.pages().find((p) => p.url().includes("advertising.amazon.com"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" });
  }

  const entityMatch = page.url().match(/entityId=([A-Z0-9]+)/);
  const entityId = entityMatch ? entityMatch[1] : "";
  const entityParam = entityId ? `?entityId=${entityId}` : "";

  // Cấu hình CDP cho page
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: destDir,
  });

  try {
    // 1. TỰ ĐỘNG TẠO / TẢI SEARCH TERM SP
    console.log("[AdsPower Automation] Bắt đầu tự động lấy Search Term SP...");
    const spSearchFile = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SP", storeName, destDir);
    if (spSearchFile) downloadedFiles.push(spSearchFile);

    // 2. TỰ ĐỘNG TẠO / TẢI SEARCH TERM SB
    console.log("[AdsPower Automation] Bắt đầu tự động lấy Search Term SB...");
    const sbSearchFile = await autoCreateAndDownloadSearchTermReport(page, entityParam, "SB", storeName, destDir);
    if (sbSearchFile) downloadedFiles.push(sbSearchFile);

    // 3 & 4. TỰ ĐỘNG CẤU HÌNH VÀ TẢI BULK SP & BULK SB TRÊN TRANG BULK OPERATIONS
    let bulkPage = context.pages().find((p) => p.url().includes("bulk-operations"));
    let createdBulkPage = false;
    if (!bulkPage) {
      bulkPage = await context.newPage();
      createdBulkPage = true;
      await bulkPage.goto(`https://advertising.amazon.com/bulk-operations${entityParam}`, { waitUntil: "domcontentloaded" });
    }

    const bulkCdp = await context.newCDPSession(bulkPage);
    await bulkCdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: destDir,
    });

    // 3. Tự động chọn và tải Bulk SP
    console.log("[AdsPower Automation] Bắt đầu tự động lấy Bulk Operations SP...");
    const bulkSpFile = await autoCreateAndDownloadBulkReport(bulkPage, entityParam, "SP", destDir);
    if (bulkSpFile) downloadedFiles.push(bulkSpFile);

    // 4. Tự động chọn và tải Bulk SB
    console.log("[AdsPower Automation] Bắt đầu tự động lấy Bulk Operations SB...");
    const bulkSbFile = await autoCreateAndDownloadBulkReport(bulkPage, entityParam, "SB", destDir);
    if (bulkSbFile) downloadedFiles.push(bulkSbFile);

    if (createdBulkPage) {
      await bulkPage.close().catch(() => {});
    }

    // 5. SMART FALLBACK: Đảm bảo có đủ 4 file từ thư mục nếu có file vừa tải trong ngày
    const allRecentFiles = fs.readdirSync(destDir)
      .filter((f) => !f.endsWith(".crdownload") && !f.startsWith("."))
      .map((f) => {
        const fullPath = path.join(destDir, f);
        return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      })
      .filter((f) => Date.now() - f.mtime < 24 * 60 * 60 * 1000)
      .sort((a, b) => b.mtime - a.mtime);

    // Bổ sung Search Term SP nếu thiếu
    if (!downloadedFiles.some((f) => /search.*sp/i.test(path.basename(f)))) {
      const existingSp = allRecentFiles.find((f) => /search.*sp/i.test(f.name));
      if (existingSp) downloadedFiles.push(existingSp.path);
    }

    // Bổ sung Search Term SB nếu thiếu
    if (!downloadedFiles.some((f) => /search.*sb/i.test(path.basename(f)))) {
      const existingSb = allRecentFiles.find((f) => /search.*sb/i.test(f.name));
      if (existingSb) downloadedFiles.push(existingSb.path);
    }

    // Bổ sung Bulk nếu thiếu
    if (!downloadedFiles.some((f) => /bulk/i.test(path.basename(f)))) {
      const existingBulk = allRecentFiles.filter((f) => /bulk.*\.xlsx$/i.test(f.name));
      if (existingBulk.length > 0) downloadedFiles.push(existingBulk[0].path);
      if (existingBulk.length > 1) downloadedFiles.push(existingBulk[1].path);
    }
  } catch (error) {
    console.error("[AdsPower Automation] Lỗi trong quá trình tải báo cáo:", error);
    throw error;
  }

  return { filePaths: Array.from(new Set(downloadedFiles)), debugPort };
}

/**
 * Nạp trực tiếp các file báo cáo vừa tải vào cơ sở dữ liệu PPC của hệ thống.
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
    const buffer = fs.readFileSync(filePath);
    const adType = reportAdType(fileName);

    try {
      if (/search[\s_-]*term/i.test(fileName)) {
        const rows = fileName.toLowerCase().endsWith(".csv")
          ? parseSearchTermCsv(buffer, storeName, adType)
          : await parseSearchTermWorkbook(buffer, storeName, adType);

        if (rows.length) {
          const saved = await upsertPpcSearchTerms(scope, storeName, rows, { replaceExisting: true });
          totalParsed += rows.length;
          totalNew += saved.inserted;
          totalUpdated += saved.updated;

          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `[AdsPower Auto] Search Term ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật.`,
          });
        }
      } else if (/bulk/i.test(fileName)) {
        const rows = await parseBulkFile(buffer, storeName, fileName);
        if (rows.length) {
          const saved = await upsertPpcPerformance(scope, storeName, rows, { replaceExisting: true });
          totalParsed += rows.length;
          totalNew += saved.inserted;
          totalUpdated += saved.updated;

          await recordPpcSyncLog(scope, {
            source: "MANUAL_UPLOAD",
            fileName,
            status: "SUCCESS",
            count: saved.inserted + saved.updated,
            message: `[AdsPower Auto] Bulk ${adType}: ${saved.inserted} dòng mới, ${saved.updated} dòng cập nhật.`,
          });
        }
      }
    } catch (err) {
      console.error(`[AdsPower Ingest] Lỗi xử lý file ${fileName}:`, err);
      await recordPpcSyncLog(scope, {
        source: "MANUAL_UPLOAD",
        fileName,
        status: "FAILED",
        message: `[AdsPower Auto] Lỗi nạp file: ${err instanceof Error ? err.message : String(err)}`,
      });
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
 * Trình chạy trọn gói: Tự động mở AdsPower + Tải báo cáo + Nạp Database + Lưu trữ R2.
 */
export async function syncPpcFromAdsPower(
  scope: DataScope,
  options: { storeName?: string; destDir?: string; profileId?: string; autoStart?: boolean } = {},
): Promise<AdsPowerSyncResult> {
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");
  const { filePaths, debugPort } = await downloadAdsPowerReports({
    storeName,
    destDir: options.destDir,
    profileId: options.profileId,
    autoStart: options.autoStart,
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

  // 1. Nạp dữ liệu vào PostgreSQL Database
  const { totalParsed, totalNew, totalUpdated } = await ingestDownloadedPpcFiles(
    scope,
    storeName,
    filePaths,
  );

  // 2. Tự động sao lưu các file tải về lên Cloudflare R2
  let r2Uploaded = 0;
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    try {
      r2Uploaded = await uploadReportsToR2(storeName, filePaths);
    } catch (r2Err) {
      console.warn("[AdsPower Sync] Lỗi khi tải file lên R2 (dữ liệu DB vẫn an toàn):", r2Err);
    }
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
    message: `Đã tự động tải và nạp thành công ${filePaths.length} file cho shop ${storeName}: ghi ${totalNew} dòng mới, cập nhật ${totalUpdated} dòng vào Database${r2Uploaded > 0 ? `, đã sao lưu ${r2Uploaded} file lên Cloudflare R2.` : "."}`,
  };
}
