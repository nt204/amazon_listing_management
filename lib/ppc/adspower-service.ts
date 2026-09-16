import "server-only";

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
  message: string;
}

/**
 * Tự động phát hiện cổng Chrome DevTools Protocol (CDP) của AdsPower SunBrowser đang mở trên macOS.
 */
export function detectAdsPowerDebugPort(): number | null {
  // 1. Kiểm tra tiến trình SunBrowser đang lắng nghe TCP port qua lsof
  try {
    const lsofOutput = execSync("lsof -c SunBrowser -a -i TCP -s TCP:LISTEN -n -P", {
      encoding: "utf8",
      timeout: 3000,
    });
    const match = lsofOutput.match(/127\.0\.0\.1:(\d+)|:(\d+)\s+\(LISTEN\)/);
    if (match) {
      const port = Number(match[1] || match[2]);
      if (port > 0) return port;
    }
  } catch {
    // Tiếp tục fallback sang đọc log AdsPower
  }

  // 2. Fallback: đọc file log gần nhất của AdsPower
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
        if (matches.length) {
          const lastPort = Number(matches[matches.length - 1][1]);
          if (lastPort > 0) return lastPort;
        }
      }
    }
  } catch {
    // Bỏ qua
  }

  return null;
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
            if ((f.startsWith("bulk-") && f.endsWith(".xlsx")) || (/search.*term/i.test(f) && (f.endsWith(".xlsx") || f.endsWith(".csv")))) {
              const src = path.join(parentDir, f);
              const dest = path.join(dir, f);
              try {
                // Chỉ chuyển nếu file mới được tạo trong vòng 2 phút
                const stat = fs.statSync(src);
                if (Date.now() - stat.mtimeMs < 2 * 60 * 1000) {
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
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await bulkPage.waitForTimeout(5000);
    const downloadLink = await bulkPage.evaluate(() => {
      const firstRow = document.querySelector(".ag-center-cols-container .ag-row");
      if (!firstRow) return null;
      const link = firstRow.querySelector<HTMLAnchorElement>("a[data-takt-id='Bulksheet_originalFileAction_download_original_file'], a[href*='bulk-operations/download']");
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

      const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 60);
      if (downloaded.length > 0) return downloaded[0];
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
    const downloaded = await waitForNewOrUpdatedDownloads(destDir, statsBefore, 60);
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
}): Promise<{ filePaths: string[]; debugPort: number }> {
  const debugPort = options.port || detectAdsPowerDebugPort();
  if (!debugPort) {
    throw new Error(
      "Không tìm thấy trình duyệt AdsPower đang mở. Vui lòng mở profile shop trong AdsPower trước khi đồng bộ.",
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
 * Trình chạy trọn gói: Tự động tải từ AdsPower + Nạp dữ liệu vào Dashboard.
 */
export async function syncPpcFromAdsPower(
  scope: DataScope,
  options: { storeName?: string; destDir?: string } = {},
): Promise<AdsPowerSyncResult> {
  const storeName = canonicalStoreName(options.storeName || "HSOSTORE");
  const { filePaths, debugPort } = await downloadAdsPowerReports({
    storeName,
    destDir: options.destDir,
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

  const { totalParsed, totalNew, totalUpdated } = await ingestDownloadedPpcFiles(
    scope,
    storeName,
    filePaths,
  );

  return {
    success: true,
    storeName,
    debugPort,
    downloadedFiles: filePaths.map((p) => path.basename(p)),
    totalParsed,
    totalNew,
    totalUpdated,
    message: `Đã tự động tải và nạp thành công ${filePaths.length} file cho shop ${storeName}: ghi ${totalNew} dòng mới, cập nhật ${totalUpdated} dòng.`,
  };
}
