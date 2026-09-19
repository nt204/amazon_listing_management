import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDatabaseClient } from "../lib/db";
import { ingestPpcFilePath } from "../lib/ppc/service";

const CDP_PORT = 52046;
const STORE_NAME = "HSOSTORE";
const DEST_DIR = path.join(os.homedir(), "Downloads", "Bulk file");

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

async function waitForNewDownload(dir: string, beforeStats: Map<string, number>, timeoutSec = 45): Promise<string | null> {
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
          // ensure file is not being written to
          await new Promise((r) => setTimeout(r, 1000));
          return fullPath;
        }
      } catch {}
    }
  }
  return null;
}

async function requestAndDownloadBulk(
  page: any,
  adType: "SP" | "SB",
  days: 7 | 30,
): Promise<string> {
  console.log(`\n========================================`);
  console.log(`[BULK] Bắt đầu tải Bulk ${adType} - ${days} ngày...`);
  console.log(`========================================`);

  const entityMatch = page.url().match(/entityId=([A-Z0-9]+)/);
  const entityId = entityMatch ? entityMatch[1] : "";
  const bulkUrl = `https://advertising.amazon.com/bulk-operations${entityId ? `?entityId=${entityId}` : ""}`;

  if (!page.url().includes("bulk-operations")) {
    await page.goto(bulkUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  // Record all existing download links on page
  const existingLinks = new Set<string>(
    await page.$$eval(
      'a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="bulk-operations/download"]',
      (els: any[]) => els.map((e) => e.href),
    ),
  );
  console.log(`[BULK] Đang có ${existingLinks.size} link tải cũ trên bảng.`);

  // Open modal if not open
  const downloadBtn = await page.$('button[data-takt-id="Bulksheet_home_download_campaigns_button"]');
  if (downloadBtn) {
    await downloadBtn.click();
    await page.waitForTimeout(1500);
  }

  // Cấu hình danh sách checkbox chính xác trong modal Bulksheet:
  // 1. Các mục BẮT BUỘC TÍCH (Included in export):
  //    - Performance data
  //    - Paused campaigns
  //    - Campaign items with zero impressions
  //    - Placement data for campaigns
  //    - Sponsored Products (hoặc Sponsored Brands tùy theo adType)
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

  // 2. Các mục BẮT BUỘC BỎ TÍCH (Search term tải riêng ở Reports, không kẹp vào Bulksheet):
  //    - Sponsored Products / Brands đối nghịch
  //    - Sponsored products search term data
  //    - Sponsored brands search term data
  //    - Sponsored Brands multi-ad group data
  //    - Sponsored Display data
  //    - Guidance for Sponsored products
  //    - Terminated campaigns
  //    - Brand asset data
  //    - Budget Rules Data
  //    - Export specific campaigns only
  const mustUncheckLabels = [
    adType === "SP" ? "Sponsored Brands data" : "Sponsored Products data",
    "Sponsored products search term data",
    "Sponsored brands search term data",
    "Sponsored Brands multi-ad group data",
    "Sponsored Display data",
    "Guidance for Sponsored products",
    "Terminated campaigns",
    "Brand asset data",
    "Budget Rules Data",
    "Export specific campaigns only",
  ];

  for (const label of mustUncheckLabels) {
    const el = await page.$(`label:has-text('${label}')`);
    const input = await el?.$("input");
    if (el && input && (await input.isChecked())) {
      await el.click();
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(300);

  // Configure Date Range
  const dateBtn = await page.$(
    'button[aria-label="Open date range picker"], button:has-text(" - 202"), div[data-takt-id="adz_bulkSheets_exportModal"] button:has-text(" - ")',
  );
  if (dateBtn) {
    await dateBtn.click();
    await page.waitForTimeout(600);

    const targetLabel = `${days} Days`;
    const presetBtn = await page.$(
      `div[role="dialog"] button:has-text("${targetLabel}"), div[role="presentation"] button:has-text("${targetLabel}"), button:has-text("${targetLabel}")`,
    );
    if (presetBtn) {
      console.log(`[BULK] Chọn preset ngày: ${targetLabel}`);
      await presetBtn.click();
      await page.waitForTimeout(800);
    } else {
      // Đóng popover lịch nếu không thấy preset để tránh che khuất nút Download
      await page.keyboard.press("Escape").catch(() => { });
      await page.waitForTimeout(300);
    }
  }

  // 3.5. Làm mờ (unfocus) input hiện tại để tránh giữ focus outline chặn sự kiện click
  await page.evaluate(() => {
    if (document.activeElement && typeof (document.activeElement as HTMLElement).blur === "function") {
      (document.activeElement as HTMLElement).blur();
    }
  });
  await page.waitForTimeout(300);

  // 4. Bấm Download trong modal
  const modalContainer = await page.$(
    'div[data-takt-id="adz_bulkSheets_exportModal"], div[role="dialog"]',
  );

  let modalDownload = null;
  if (modalContainer) {
    modalDownload = await modalContainer.$(
      'button[data-takt-id="adz_bulkSheets_exportModal_download_button"], button:text-is("Download"), button[type="submit"]',
    );
  }

  if (!modalDownload) {
    modalDownload = await page.$(
      'div[data-takt-id="adz_bulkSheets_exportModal"] button[data-takt-id="adz_bulkSheets_exportModal_download_button"], ' +
      'button[data-takt-id="adz_bulkSheets_exportModal_download_button"], ' +
      'div[data-takt-id="adz_bulkSheets_exportModal"] button:text-is("Download")',
    );
  }

  if (!modalDownload) {
    const jsBtn = await page.evaluateHandle(() => {
      const modal = document.querySelector('div[data-takt-id="adz_bulkSheets_exportModal"]') ||
                    document.querySelector('div[role="dialog"]');
      if (!modal) return null;
      const btns = Array.from(modal.querySelectorAll("button"));
      return btns.find(b => (b.textContent || "").trim().toLowerCase() === "download") || null;
    });
    if (jsBtn && jsBtn.asElement()) {
      modalDownload = jsBtn.asElement();
    }
  }

  if (!modalDownload) throw new Error("Không tìm thấy nút Download trong modal");

  console.log(`[BULK] Đang bấm Download để Amazon tạo file Bulk ${adType} ${days}d...`);
  let modalClosed = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await modalDownload.scrollIntoViewIfNeeded().catch(() => {});
      await modalDownload.click({ timeout: 2500 });
    } catch {
      await page.evaluate((btn: HTMLElement) => {
        if (!btn) return;
        btn.focus();
        btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        if (typeof btn.click === "function") btn.click();
      }, modalDownload);
    }

    modalClosed = await page
      .waitForSelector('div[data-takt-id="adz_bulkSheets_exportModal"]', {
        state: "detached",
        timeout: 3500,
      })
      .then(() => true)
      .catch(() => false);

    if (modalClosed) {
      console.log(`[BULK] Modal Bulksheet đã đóng thành công (lần thử ${attempt}).`);
      break;
    }

    console.warn(`[BULK] Lần ${attempt}: Modal chưa đóng, dispatch click qua JS...`);
    await page.evaluate(() => {
      const modal = document.querySelector('div[data-takt-id="adz_bulkSheets_exportModal"]') ||
                    document.querySelector('div[role="dialog"]');
      if (!modal) return;
      const btns = Array.from(modal.querySelectorAll("button"));
      const target = btns.find(b => (b.textContent || "").trim().toLowerCase() === "download");
      if (target) {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        target.click();
      }
    });
    await page.waitForTimeout(1000);
  }

  // Wait for new download link in the table
  console.log(`[BULK] Đang chờ Amazon tạo file mới (Full Bulksheet mất khoảng 5-15 phút)...`);
  let newDownloadUrl: string | null = null;
  const deadline = Date.now() + 900_000; // tối đa 15 phút cho Full Bulksheet

  while (Date.now() < deadline) {
    await page.waitForTimeout(10000);
    // Click Refresh button on page
    await page.click("button[aria-label*='Refresh'], button:has-text('Refresh')").catch(() => {});
    await page.waitForTimeout(1000);

    const currentLinks = await page.$$eval(
      'a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="bulk-operations/download"]',
      (els: any[]) => els.map((e) => e.href),
    );

    const candidate = currentLinks.find((url: string) => !existingLinks.has(url));
    if (candidate) {
      newDownloadUrl = candidate;
      console.log(`[BULK] ĐÃ PHÁT HIỆN LINK TẢI MỚI: ${newDownloadUrl}`);
      break;
    }
    console.log(`[BULK] Vẫn đang chờ Amazon xử lý...`);
  }

  if (!newDownloadUrl) {
    throw new Error(`Timeout: Amazon không tạo xong file Bulk ${adType} ${days}d sau 2 phút.`);
  }

  // Download the file
  const beforeStats = getFileStatsMap(DEST_DIR);
  await page.evaluate((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, newDownloadUrl);

  const downloadedPath = await waitForNewDownload(DEST_DIR, beforeStats, 30);
  if (!downloadedPath) throw new Error("File đã bấm tải nhưng không thấy xuất hiện trong thư mục.");

  // Rename file with adType and days for clarity and perfect identification
  const rawName = path.basename(downloadedPath);
  const standardizedName = `HSOSTORE_Bulk_${adType}_${days}Days_${rawName}`;
  const standardizedPath = path.join(DEST_DIR, standardizedName);
  fs.renameSync(downloadedPath, standardizedPath);

  console.log(`[BULK] TẢI THÀNH CÔNG: ${standardizedName} (${Math.round(fs.statSync(standardizedPath).size / 1024 / 1024)} MB)`);
  return standardizedPath;
}

async function downloadSearchTerms(
  page: any,
  adType: "SP" | "SB",
): Promise<string> {
  console.log(`\n========================================`);
  console.log(`[SEARCH TERM] Bắt đầu tải Search Term ${adType} (30 ngày)...`);
  console.log(`========================================`);

  const entityMatch = page.url().match(/entityId=([A-Z0-9]+)/);
  const entityId = entityMatch ? entityMatch[1] : "";
  const reportsUrl = `https://advertising.amazon.com/reports${entityId ? `?entityId=${entityId}` : ""}`;

  await page.goto(reportsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Find ready link for adType
  const targetLink = await page.evaluate((type: string) => {
    const rows = Array.from(document.querySelectorAll("div.ag-row, [role='row']"));
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

  if (!targetLink) {
    throw new Error(`Không tìm thấy link tải Search Term ${adType} trên trang /reports.`);
  }

  console.log(`[SEARCH TERM] Tìm thấy link tải: ${targetLink}`);
  const beforeStats = getFileStatsMap(DEST_DIR);

  await page.evaluate((url: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, targetLink);

  const downloadedPath = await waitForNewDownload(DEST_DIR, beforeStats, 30);
  if (!downloadedPath) throw new Error(`Không tải được file Search Term ${adType}`);

  const rawName = path.basename(downloadedPath);
  const standardizedName = `HSOSTORE_Search_Term_${adType}_30Days_${rawName}`;
  const standardizedPath = path.join(DEST_DIR, standardizedName);
  fs.renameSync(downloadedPath, standardizedPath);

  console.log(`[SEARCH TERM] TẢI THÀNH CÔNG: ${standardizedName} (${Math.round(fs.statSync(standardizedPath).size / 1024)} KB)`);
  return standardizedPath;
}

async function main() {
  console.log("=== KHỞI ĐỘNG TIẾN TRÌNH TẢI 6 FILE PPC ===");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Không kết nối được SunBrowser context");

  let page = context.pages().find((p) => p.url().includes("advertising.amazon.com"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/reports", { waitUntil: "domcontentloaded" });
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DEST_DIR,
  });

  const downloadedFiles: { name: string; path: string; days: number; type: string }[] = [];

  // 1. Bulk SP 30d
  const f1 = await requestAndDownloadBulk(page, "SP", 30);
  downloadedFiles.push({ name: path.basename(f1), path: f1, days: 30, type: "BULK_SP" });

  // 2. Bulk SB 30d
  const f2 = await requestAndDownloadBulk(page, "SB", 30);
  downloadedFiles.push({ name: path.basename(f2), path: f2, days: 30, type: "BULK_SB" });

  // 3. Bulk SP 7d
  const f3 = await requestAndDownloadBulk(page, "SP", 7);
  downloadedFiles.push({ name: path.basename(f3), path: f3, days: 7, type: "BULK_SP" });

  // 4. Bulk SB 7d
  const f4 = await requestAndDownloadBulk(page, "SB", 7);
  downloadedFiles.push({ name: path.basename(f4), path: f4, days: 7, type: "BULK_SB" });

  // 5. Search Term SP 30d
  const f5 = await downloadSearchTerms(page, "SP");
  downloadedFiles.push({ name: path.basename(f5), path: f5, days: 30, type: "ST_SP" });

  // 6. Search Term SB 30d
  const f6 = await downloadSearchTerms(page, "SB");
  downloadedFiles.push({ name: path.basename(f6), path: f6, days: 30, type: "ST_SB" });

  console.log("\n========================================");
  console.log(`ĐÃ THU THẬP ĐỦ 6 FILE CHUẨN XÁC:`);
  downloadedFiles.forEach((f, idx) => console.log(`${idx + 1}. [${f.type}] ${f.name}`));
  console.log("========================================\n");

  console.log("[AdsPower] Đóng tab trình duyệt sau khi tải xong để giải phóng bộ nhớ...");
  await page.close().catch(() => {});

  // Ingest all 6 files into Database
  console.log("=== BẮT ĐẦU NẠP 6 FILE VÀO CƠ SỞ DỮ LIỆU ===");
  const scope = { teamId: "default", actorId: "system" };

  for (const item of downloadedFiles) {
    console.log(`\n-> Đang nạp: ${item.name} (${item.days} ngày)...`);
    const res = await ingestPpcFilePath(scope, item.path, item.name, STORE_NAME, {
      days: item.days,
    });
    console.log(`   Xử lý: ${res.totalParsed} dòng, ${res.newInserted} dòng mới, ${res.updated} dòng cập nhật.`);
  }

  console.log("\n=== TẤT CẢ 6 FILE ĐÃ ĐƯỢC NẠP THÀNH CÔNG VÀO DATABASE! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[LỖI TIẾN TRÌNH]:", err);
  process.exit(1);
});
