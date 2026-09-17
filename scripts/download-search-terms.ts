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
  let page = context.pages().find(p => p.url().includes('/reports'));
  if (!page) {
    page = await context.newPage();
  }
  await page.goto('https://advertising.amazon.com/reports?entityId=ENTITYXUFI0NISIJNW', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DEST_DIR,
  });

  const reports = [
    {
      name: "Search Term SP 30d",
      targetName: "HSOSTORE_Search_Term_SP_30Days_20260917.xlsx",
      url: "https://advertising.amazon.com/reports/subscriptions/324471a2-d634-466f-97c4-45a9bac7f8d4/download-report/e1c91d65-8be8-4a25-8d1f-c453a2ef5141"
    },
    {
      name: "Search Term SB 30d",
      targetName: "HSOSTORE_Search_Term_SB_30Days_20260917.xlsx",
      url: "https://advertising.amazon.com/reports/subscriptions/e4b4d258-1379-47c6-8bf1-93c706ecac64/download-report/37931234-d9c3-495f-96d7-fb87e2365eec"
    }
  ];

  for (const r of reports) {
    console.log(`Đang tải: ${r.name}...`);
    const beforeStats = getFileStatsMap(DEST_DIR);
    await page.evaluate((url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, r.url);

    const downloaded = await waitForNewDownload(DEST_DIR, beforeStats, 30);
    if (downloaded) {
      const targetPath = path.join(DEST_DIR, r.targetName);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      fs.renameSync(downloaded, targetPath);
      console.log(`-> Đã lưu: ${r.targetName} (${Math.round(fs.statSync(targetPath).size / 1024)} KB)`);
    } else {
      console.error(`-> Không tải được ${r.name}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
