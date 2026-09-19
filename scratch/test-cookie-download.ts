import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:56738");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const bulkPage = pages.find((p) => p.url().includes("bulk-operations")) || pages[0];

  const downloadUrl = "https://advertising.amazon.com/bulk-operations/download/BulkSheetExportOutput/ENTITYXUFI0NISIJNW/2026/9/18/c5d0eb21-9047-429c-9568-213e8b64b07e/bulk-a1qiqhomjzfqb8-20260819-20260918-1789726784314.xlsx?entityId=ENTITYXUFI0NISIJNW";
  
  const destDir = path.join(os.homedir(), "Downloads", "Bulk file");
  const destFile = path.join(destDir, "HSOSTORE_Bulk_SP_30Days_test.xlsx");

  console.log("Option 1: Filter cookies to advertising.amazon.com only...");
  const allCookies = await context.cookies("https://advertising.amazon.com");
  console.log(`Filtered to ${allCookies.length} amazon cookies.`);
  const cookieHeader = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const res = await fetch(downloadUrl, {
    headers: {
      "Cookie": cookieHeader,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "Referer": bulkPage.url(),
    },
  });

  console.log("Response status:", res.status, res.statusText);
  console.log("Content-Type:", res.headers.get("content-type"));
  console.log("Content-Length:", res.headers.get("content-length"));

  if (res.ok) {
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destFile, Buffer.from(arrayBuffer));
    const stat = fs.statSync(destFile);
    console.log(`SUCCESS via fetch! Saved ${stat.size} bytes (${Math.round(stat.size / 1024 / 1024)} MB) to: ${destFile}`);
  } else {
    const text = await res.text();
    console.error("Fetch failed:", text.slice(0, 300));
  }
}

main().catch(console.error);
