import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
          await new Promise((r) => setTimeout(r, 1000));
          return fullPath;
        }
      } catch {}
    }
  }
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:52046');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('bulk-operations'));
  if (!page) throw new Error('No bulk page');

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DEST_DIR,
  });

  const existingLinks = new Set<string>(
    await page.$$eval('a[href*="BulkSheetExportOutput"]', (els: any[]) => els.map(e => e.href))
  );
  console.log(`Đang có ${existingLinks.size} link BulkSheetExportOutput cũ.`);

  // Open modal if not open
  const isModalOpen = await page.$('button[data-takt-id="adz_bulkSheets_exportModal_download_button"]');
  if (!isModalOpen) {
    await page.click('button[data-takt-id="Bulksheet_home_download_campaigns_button"]');
    await page.waitForTimeout(1500);
  }

  // Check SP, uncheck SB
  const spInput = await page.$("label:has-text('Sponsored Products data') input");
  const sbInput = await page.$("label:has-text('Sponsored Brands data') input");
  if (spInput && !(await spInput.isChecked())) await page.click("label:has-text('Sponsored Products data')");
  if (sbInput && (await sbInput.isChecked())) await page.click("label:has-text('Sponsored Brands data')");

  // Select 7 Days
  const dateBtn = await page.$('div:has(button[data-takt-id="adz_bulkSheets_exportModal_download_button"]) button:has-text("2026")');
  if (dateBtn) {
    await dateBtn.click();
    await page.waitForTimeout(600);
    const presetBtn = await page.$('button:has-text("7 Days")');
    if (presetBtn) {
      await presetBtn.click();
      await page.waitForTimeout(600);
      const applyBtn = await page.$('button:has-text("Apply")');
      if (applyBtn) await applyBtn.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  // Click Download
  const modalDownload = await page.$('button[data-takt-id="adz_bulkSheets_exportModal_download_button"]');
  if (!modalDownload) throw new Error('No download button in modal');
  console.log('Bấm Download trong modal...');
  await modalDownload.click();
  await page.waitForTimeout(2000);

  // Poll for new link
  console.log('Đang chờ Amazon tạo file mới...');
  let newDownloadUrl: string | null = null;
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    // Reload table or page
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);

    const currentLinks = await page.$$eval('a[href*="BulkSheetExportOutput"]', (els: any[]) => els.map(e => e.href));
    const candidate = currentLinks.find((url: string) => !existingLinks.has(url));
    if (candidate) {
      newDownloadUrl = candidate;
      console.log('PHÁT HIỆN LINK MỚI:', newDownloadUrl);
      break;
    }
    console.log(`Đang chờ... (đã có ${currentLinks.length} links)`);
  }

  if (!newDownloadUrl) throw new Error('Timeout waiting for new link');

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
  console.log('TẢI THÀNH CÔNG:', downloadedPath);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
