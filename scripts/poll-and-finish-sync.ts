import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { getDatabaseClient } from "../lib/db";
import { ingestPpcFilePath } from "../lib/ppc/service";

const DEST_DIR = path.join(os.homedir(), "Downloads", "Bulk file");
const STORE_NAME = "HSOSTORE";

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
          // ensure writing finished
          await new Promise((r) => setTimeout(r, 2000));
          return fullPath;
        }
      } catch {}
    }
  }
  return null;
}

async function getRowLinkById(page: any, idSubstr: string): Promise<string | null> {
  return page.evaluate((targetId: string) => {
    const rows = Array.from(document.querySelectorAll(".ag-center-cols-container .ag-row"));
    for (const r of rows) {
      const text = (r as HTMLElement).innerText || "";
      if (text.includes(targetId)) {
        const a = r.querySelector('a[href*="BulkSheetExportOutput"]');
        return a ? (a as HTMLAnchorElement).href : null;
      }
    }
    return null;
  }, idSubstr);
}

async function downloadFileFromUrl(page: any, url: string, targetName: string): Promise<string> {
  console.log(`Bắt đầu tải: ${targetName}...`);
  const beforeStats = getFileStatsMap(DEST_DIR);
  await page.evaluate((u: string) => {
    const a = document.createElement("a");
    a.href = u;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, url);

  const downloaded = await waitForNewDownload(DEST_DIR, beforeStats, 90);
  if (!downloaded) throw new Error(`Không tải được file ${targetName}`);

  const targetPath = path.join(DEST_DIR, targetName);
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  fs.renameSync(downloaded, targetPath);
  const sizeMb = Math.round(fs.statSync(targetPath).size / 1024 / 1024);
  console.log(`-> Đã lưu: ${targetName} (${sizeMb} MB)`);
  return targetPath;
}

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:52046");
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("bulk-operations"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/bulk-operations?entityId=ENTITYXUFI0NISIJNW", { waitUntil: "domcontentloaded" });
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DEST_DIR,
  });

  const targets = [
    {
      id: "7d6e6dd4", // requested at 9:34 AM (SP 7 Days)
      targetName: "HSOSTORE_Bulk_SP_7Days_20260910-20260917.xlsx",
      desc: "Bulk SP 7 Days",
    },
    {
      id: "3ca9e520", // requested at 9:40 AM (SB 7 Days)
      targetName: "HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx",
      desc: "Bulk SB 7 Days",
    },
  ];

  const downloaded7dFiles: string[] = [];

  for (const t of targets) {
    console.log(`\n=== Đang theo dõi tiến trình: ${t.desc} (ID: ${t.id}) ===`);
    let link: string | null = null;
    const deadline = Date.now() + 600_000; // 10 phút

    while (Date.now() < deadline) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForSelector(".ag-center-cols-container .ag-row", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1000);

      link = await getRowLinkById(page, t.id);
      if (link) {
        console.log(`[Amazon Sẵn Sàng] Tìm thấy link tải cho ${t.desc}!`);
        break;
      }
      console.log(`[Đang chờ Amazon xử lý ${t.desc}] Đợi 10 giây...`);
      await new Promise((r) => setTimeout(r, 10000));
    }

    if (!link) throw new Error(`Timeout: ${t.desc} không hoàn thành sau 10 phút.`);
    const savedPath = await downloadFileFromUrl(page, link, t.targetName);
    downloaded7dFiles.push(savedPath);
  }

  console.log("\n==========================================");
  console.log("ĐÃ CÓ ĐỦ 6 FILE CHUẨN XÁC:");
  const all6Files = [
    { name: "HSOSTORE_Bulk_SP_30Days_20260817-20260917.xlsx", days: 30 },
    { name: "HSOSTORE_Bulk_SB_30Days_20260817-20260917.xlsx", days: 30 },
    { name: "HSOSTORE_Bulk_SP_7Days_20260910-20260917.xlsx", days: 7 },
    { name: "HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx", days: 7 },
    { name: "HSOSTORE_Search_Term_SP_30Days_20260917.xlsx", days: 30 },
    { name: "HSOSTORE_Search_Term_SB_30Days_20260917.xlsx", days: 30 },
  ];

  all6Files.forEach((f, idx) => {
    const full = path.join(DEST_DIR, f.name);
    const size = fs.existsSync(full) ? Math.round(fs.statSync(full).size / 1024) + " KB" : "MISSING";
    console.log(`${idx + 1}. ${f.name} [${size}]`);
  });
  console.log("==========================================\n");

  console.log("=== BẮT ĐẦU NẠP CẢ 6 FILE VÀO POSTGRESQL DATABASE ===");
  const scope = { teamId: "default", actorId: "system" };

  for (const f of all6Files) {
    const fullPath = path.join(DEST_DIR, f.name);
    console.log(`-> Nạp file: ${f.name} (phạm vi ${f.days} ngày)...`);
    const res = await ingestPpcFilePath(scope, fullPath, f.name, STORE_NAME, {
      days: f.days,
    });
    console.log(`   Hoàn tất: ${res.totalParsed} dòng (Mới: ${res.newInserted}, Update: ${res.updated})`);
  }

  console.log("\n=== TẤT CẢ 6 FILE ĐÃ ĐƯỢC NẠP VÀO DATABASE THÀNH CÔNG RỰC RỠ! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("[LỖI]:", err);
  process.exit(1);
});
