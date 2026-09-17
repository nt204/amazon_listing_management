import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ingestPpcFilePath } from "../lib/ppc/service";

const BULK_DIR = path.join(os.homedir(), "Downloads", "Bulk file");
const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const STORE_NAME = "HSOSTORE";

function getFileStats(dirs: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    try {
      for (const f of fs.readdirSync(d)) {
        try {
          const full = path.join(d, f);
          map.set(full, fs.statSync(full).mtimeMs);
        } catch {}
      }
    } catch {}
  }
  return map;
}

async function waitForNewFile(dirs: string[], beforeStats: Map<string, number>, timeoutSec = 120): Promise<string | null> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    for (const d of dirs) {
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        if (f.endsWith(".crdownload") || f.startsWith(".")) continue;
        const full = path.join(d, f);
        try {
          const stat = fs.statSync(full);
          const prev = beforeStats.get(full);
          if ((!prev && stat.size > 1000) || (prev && stat.mtimeMs > prev && stat.size > 1000)) {
            // Wait for write completion
            let lastSize = stat.size;
            while (true) {
              await new Promise((r) => setTimeout(r, 2000));
              const currentSize = fs.statSync(full).size;
              if (currentSize === lastSize && currentSize > 1000000) { // bulk files are >1MB
                return full;
              }
              lastSize = currentSize;
            }
          }
        } catch {}
      }
    }
  }
  return null;
}

async function getSB7dLink(page: any, targetId: string) {
  return page.evaluate((id: string) => {
    const rows = Array.from(document.querySelectorAll(".ag-center-cols-container .ag-row"));
    for (const r of rows) {
      const text = (r as HTMLElement).innerText || "";
      if (text.includes(id)) {
        const a = r.querySelector('a[href*="BulkSheetExportOutput"]');
        return {
          text: text.replace(/\n+/g, " | "),
          url: a ? (a as HTMLAnchorElement).href : null,
        };
      }
    }
    return null;
  }, targetId);
}

async function main() {
  console.log("=== BẮT ĐẦU QUY TRÌNH TẢI VÀ NẠP ĐỦ 6 FILE PPC ===");

  const browser = await chromium.connectOverCDP("http://127.0.0.1:52046");
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("bulk-operations"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://advertising.amazon.com/bulk-operations?entityId=ENTITYXUFI0NISIJNW", { waitUntil: "domcontentloaded" });
  }

  const targetSB7dId = "3ca9e520";
  console.log(`\n[Bước 1] Theo dõi tiến trình Bulk SB 7 Days (ID: ${targetSB7dId})...`);

  let downloadUrl: string | null = null;
  const deadline = Date.now() + 600_000; // 10 phút

  while (Date.now() < deadline) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForSelector(".ag-center-cols-container .ag-row", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const info = await getSB7dLink(page, targetSB7dId);
    if (info) {
      console.log(`[Status row]: ${info.text}`);
      if (info.url) {
        console.log(`[Amazon Sẵn Sàng] Tìm thấy link tải Bulk SB 7 Days: ${info.url.slice(0, 80)}...`);
        downloadUrl = info.url;
        break;
      }
    } else {
      console.log(`[Chưa thấy row] Đang tải lại danh sách...`);
    }

    console.log("[Đang chờ Amazon tạo file SB 7 Days] Đợi 10 giây...");
    await new Promise((r) => setTimeout(r, 10000));
  }

  if (!downloadUrl) {
    throw new Error("Hết thời gian chờ Amazon xử lý Bulk SB 7 Days!");
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: BULK_DIR,
  });

  console.log("\n[Bước 2] Tiến hành tải file Bulk SB 7 Days...");
  const beforeStats = getFileStats([BULK_DIR, DOWNLOADS_DIR]);
  await page.evaluate((id: string) => {
    const rows = Array.from(document.querySelectorAll(".ag-center-cols-container .ag-row"));
    for (const r of rows) {
      if ((r as HTMLElement).innerText?.includes(id)) {
        const a = r.querySelector('a[href*="BulkSheetExportOutput"]') as HTMLAnchorElement;
        if (a) {
          a.click();
          return true;
        }
      }
    }
    return false;
  }, targetSB7dId);

  const downloaded = await waitForNewFile([BULK_DIR, DOWNLOADS_DIR], beforeStats, 120);
  if (!downloaded) {
    throw new Error("Không bắt được file tải về của Bulk SB 7 Days!");
  }

  const targetSB7dPath = path.join(BULK_DIR, "HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx");
  if (fs.existsSync(targetSB7dPath)) fs.unlinkSync(targetSB7dPath);
  fs.renameSync(downloaded, targetSB7dPath);
  const sb7dMb = Math.round(fs.statSync(targetSB7dPath).size / 1024 / 1024);
  console.log(`-> ĐÃ LƯU THÀNH CÔNG: HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx (${sb7dMb} MB)`);

  console.log("\n==========================================");
  console.log("DANH SÁCH KIỂM KÊ ĐỦ 6 FILE PPC CHUẨN XÁC:");
  const all6Files = [
    { name: "HSOSTORE_Bulk_SP_30Days_20260817-20260917.xlsx", days: 30, type: "Bulk SP 30d" },
    { name: "HSOSTORE_Bulk_SB_30Days_20260817-20260917.xlsx", days: 30, type: "Bulk SB 30d" },
    { name: "HSOSTORE_Bulk_SP_7Days_20260910-20260917.xlsx", days: 7, type: "Bulk SP 7d" },
    { name: "HSOSTORE_Bulk_SB_7Days_20260910-20260917.xlsx", days: 7, type: "Bulk SB 7d" },
    { name: "HSOSTORE_Search_Term_SP_30Days_20260917.xlsx", days: 30, type: "Search Term SP 30d (Daily)" },
    { name: "HSOSTORE_Search_Term_SB_30Days_20260917.xlsx", days: 30, type: "Search Term SB 30d (Daily)" },
  ];

  for (let i = 0; i < all6Files.length; i++) {
    const f = all6Files[i];
    const full = path.join(BULK_DIR, f.name);
    if (!fs.existsSync(full)) {
      throw new Error(`THIẾU FILE: ${f.name}`);
    }
    const size = Math.round(fs.statSync(full).size / 1024);
    console.log(`${i + 1}. [${f.type}] ${f.name} - ${size >= 1024 ? (size / 1024).toFixed(1) + " MB" : size + " KB"}`);
  }
  console.log("==========================================\n");

  console.log("=== BẮT ĐẦU NẠP CẢ 6 FILE VÀO POSTGRESQL DATABASE ===");
  const scope = { teamId: "default", actorId: "system" };

  for (const f of all6Files) {
    const fullPath = path.join(BULK_DIR, f.name);
    console.log(`\n[Nạp DB] File: ${f.name} (phạm vi ${f.days} ngày)...`);
    const res = await ingestPpcFilePath(scope, fullPath, f.name, STORE_NAME, {
      days: f.days,
    });
    console.log(`-> Kết quả: Tổng ${res.totalParsed} dòng (Thêm mới: ${res.newInserted}, Cập nhật: ${res.updated})`);
  }

  console.log("\n=== TẤT CẢ 6 FILE ĐÃ ĐƯỢC TẢI VÀ NẠP VÀO DATABASE THÀNH CÔNG RỰC RỠ! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("[LỖI]:", err);
  process.exit(1);
});
