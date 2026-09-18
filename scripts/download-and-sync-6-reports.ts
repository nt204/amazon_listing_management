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

  // Configure Checkbox according to adType
  const spInput = await page.$("label:has-text('Sponsored Products data') input");
  const sbInput = await page.$("label:has-text('Sponsored Brands data') input");

  if (adType === "SP") {
    if (spInput && !(await spInput.isChecked())) {
      await page.click("label:has-text('Sponsored Products data')");
    }
    if (sbInput && (await sbInput.isChecked())) {
      await page.click("label:has-text('Sponsored Brands data')");
    }
  } else {
    // SB
    if (sbInput && !(await sbInput.isChecked())) {
      await page.click("label:has-text('Sponsored Brands data')");
    }
    if (spInput && (await spInput.isChecked())) {
      await page.click("label:has-text('Sponsored Products data')");
    }
  }
  await page.waitForTimeout(500);

  // Configure Date Range
  const dateBtn = await page.$(
    'div:has(button[data-takt-id="adz_bulkSheets_exportModal_download_button"]) button:has-text("2026")',
  );
  if (dateBtn) {
    await dateBtn.click();
    await page.waitForTimeout(600);

    const targetLabel = `${days} Days`;
    const presetBtn = await page.$(`button:has-text("${targetLabel}")`);
    if (presetBtn) {
      console.log(`[BULK] Chọn preset ngày: ${targetLabel}`);
      await presetBtn.click();
      await page.waitForTimeout(600);

      const applyBtn = await page.$('button:has-text("Apply")');
      if (applyBtn) {
        await applyBtn.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }
  }

  // Click modal Download button
  const modalDownload = await page.$('button[data-takt-id="adz_bulkSheets_exportModal_download_button"]');
  if (!modalDownload) throw new Error("Không tìm thấy nút Download trong modal");

  console.log(`[BULK] Đang bấm Download để Amazon tạo file Bulk ${adType} ${days}d...`);
  await modalDownload.click();
  await page.waitForTimeout(2000);

  // Wait for new download link in the table
  console.log(`[BULK] Đang chờ Amazon tạo file mới (không dùng lại link cũ)...`);
  let newDownloadUrl: string | null = null;
  const deadline = Date.now() + 120_000; // tối đa 2 phút

  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
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
