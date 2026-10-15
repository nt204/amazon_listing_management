import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { startAdsPowerProfile, stopAdsPowerProfile } from "./accounting_crawler";

async function testFile08(storeName: string, profileId: string) {
  console.log(`\n============================================================`);
  console.log(`TEST CLICK EXPORT NÚT: button[data-tag="protos-table-export-button"]`);
  console.log(`Store: [${storeName}] | Profile: [${profileId}]`);
  console.log(`============================================================`);

  let cdpUrl = "";
  try {
    cdpUrl = await startAdsPowerProfile(profileId);
  } catch (e: any) {
    console.error(`Không mở được profile: ${e.message}`);
    return;
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  const url = "https://sellercentral.amazon.com/amazonsell/dc-shipments?orderBy=UPDATE_TIME&isOrderAscending=false&pageSize=100&pageIndex=0";
  console.log(`[File 08] Đang mở trang: ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);

  if (page.url().includes("/ap/signin")) {
    console.error("❌ Session hết hạn!");
    await browser.close();
    await stopAdsPowerProfile(profileId);
    return;
  }

  const exportBtn = page.locator("button[data-tag='protos-table-export-button']").first();
  const isVis = await exportBtn.isVisible().catch(() => false);
  console.log(`[File 08] button[data-tag='protos-table-export-button'] isVisible: ${isVis}`);

  if (!isVis) {
    console.error("❌ Không tìm thấy button[data-tag='protos-table-export-button']!");
    await browser.close();
    await stopAdsPowerProfile(profileId);
    return;
  }

  const downloadDir = path.join(os.homedir(), "AmazonAccounting", "downloads", "2026-10-12", storeName);
  fs.mkdirSync(downloadDir, { recursive: true });
  const targetPath = path.join(downloadDir, `08_DcShipments_2026-10-12.csv`);

  console.log(`[File 08] Đang click button[data-tag='protos-table-export-button']...`);
  
  let downloadTriggered = false;
  // Lắng nghe sự kiện download
  page.once("download", async (download) => {
    downloadTriggered = true;
    console.log(`🎉 BẮT ĐƯỢC DOWNLOAD EVENT! Filename: ${download.suggestedFilename()}`);
    await download.saveAs(targetPath);
    console.log(`✅ ĐÃ LƯU FILE THÀNH CÔNG: ${targetPath} (${fs.statSync(targetPath).size} bytes)`);
  });

  await exportBtn.click();
  console.log(`[File 08] Đã click nút export, chờ 5s kiểm tra phản hồi...`);
  await page.waitForTimeout(5000);

  if (!downloadTriggered) {
    // Kiểm tra xem có dropdown hoặc modal nào xuất hiện không
    const popups = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("[role='menuitem'], [role='dialog'], [data-tag*='export'], kat-dropdown-item, .awsui_dropdown-item, li"));
      return items.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.textContent || "").trim().length > 0;
      }).map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        role: el.getAttribute("role"),
        html: el.outerHTML.slice(0, 150)
      }));
    });
    console.log(`[File 08] Các item hiển thị sau khi click:`, popups);

    // Chờ thêm 10s nữa phòng trường hợp file đang generate
    console.log(`[File 08] Chờ thêm 10s xem download có xuất hiện không...`);
    await page.waitForTimeout(10000);
  }

  // Chụp ảnh lại màn hình sau click
  const screenshotAfter = path.join(os.homedir(), "AmazonAccounting", "dc_after_export_click.png");
  await page.screenshot({ path: screenshotAfter });
  console.log(`[File 08] Đã chụp screenshot sau click: ${screenshotAfter}`);

  await browser.close();
  await stopAdsPowerProfile(profileId);
  console.log(`[File 08] Hoàn thành test.`);
}

testFile08("HSOSTORE", "k1fmv7mf").catch(console.error);
