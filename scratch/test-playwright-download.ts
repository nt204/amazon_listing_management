import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:56738");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const bulkPage = pages.find((p) => p.url().includes("bulk-operations")) || pages[0];

  const destDir = path.join(os.homedir(), "Downloads", "Bulk file");
  const destFile = path.join(destDir, "test-row2-playwright.xlsx");

  console.log("Finding first available Download link on the page...");
  const downloadLink = await bulkPage.$('a[data-takt-id="Bulksheet_originalFileAction_download_original_file"], a[href*="bulk-operations/download"]');
  if (!downloadLink) {
    console.error("No download link found on page!");
    return;
  }

  const href = await downloadLink.getAttribute("href");
  console.log("Found download link href:", href);

  console.log("Testing method A: page.waitForEvent('download')...");
  try {
    const [download] = await Promise.all([
      bulkPage.waitForEvent("download", { timeout: 15000 }),
      downloadLink.click(),
    ]);
    console.log("Download event triggered! Suggested filename:", download.suggestedFilename());
    await download.saveAs(destFile);
    const stat = fs.statSync(destFile);
    console.log(`SUCCESS! Saved ${stat.size} bytes (${Math.round(stat.size / 1024 / 1024)} MB) to: ${destFile}`);
    return;
  } catch (err: any) {
    console.warn("Method A failed or timed out:", err.message);
  }

  console.log("\nTesting method B: Browser context fetch with internal session (bulkPage.evaluate)...");
  try {
    const base64Data = await bulkPage.evaluate(async (url: string) => {
      const response = await window.fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, href!);

    const base64Content = base64Data.split(",")[1];
    fs.writeFileSync(destFile, Buffer.from(base64Content, "base64"));
    const stat = fs.statSync(destFile);
    console.log(`SUCCESS via in-page fetch! Saved ${stat.size} bytes (${Math.round(stat.size / 1024 / 1024)} MB) to: ${destFile}`);
    return;
  } catch (err: any) {
    console.error("Method B failed:", err.message);
  }
}

main().catch(console.error);
