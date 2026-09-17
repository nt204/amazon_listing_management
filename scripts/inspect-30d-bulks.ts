import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

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
  let page = context.pages().find(p => p.url().includes('bulk-operations'));
  if (!page) {
    page = await context.newPage();
    await page.goto('https://advertising.amazon.com/bulk-operations?entityId=ENTITYXUFI0NISIJNW', { waitUntil: 'domcontentloaded' });
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DEST_DIR,
  });

  const filesToTest = [
    {
      id: "f0399e43",
      url: "https://advertising.amazon.com/bulk-operations/download/BulkSheetExportOutput/ENTITYXUFI0NISIJNW/2026/9/17/f0399e43-7db8-4d88-a6d1-a65226bd805b/bulk-a1qiqhomjzfqb8-20260817-20260917-1789611465444.xlsx?entityId=ENTITYXUFI0NISIJNW"
    },
    {
      id: "a68335f5",
      url: "https://advertising.amazon.com/bulk-operations/download/BulkSheetExportOutput/ENTITYXUFI0NISIJNW/2026/9/17/a68335f5-b5bc-439b-a159-11d8a24f4fc6/bulk-a1qiqhomjzfqb8-20260817-20260917-1789611551816.xlsx?entityId=ENTITYXUFI0NISIJNW"
    }
  ];

  for (const item of filesToTest) {
    console.log(`Đang tải: ${item.id}...`);
    const beforeStats = getFileStatsMap(DEST_DIR);
    await page.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, item.url);

    const downloaded = await waitForNewDownload(DEST_DIR, beforeStats, 40);
    if (!downloaded) {
      console.error(`Không tải được: ${item.id}`);
      continue;
    }
    console.log(`Đã tải về: ${downloaded} (${Math.round(fs.statSync(downloaded).size / 1024 / 1024)} MB)`);

    // Check sheets
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error buffer
    await wb.xlsx.load(fs.readFileSync(downloaded));
    const sheets = wb.worksheets.map(w => w.name);
    console.log(`Sheets in ${path.basename(downloaded)}:`, sheets);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
