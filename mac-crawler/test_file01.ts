import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { startAdsPowerProfile, stopAdsPowerProfile, downloadFile01Portfolios } from "./accounting_crawler";

const STORES: Record<string, string> = {
  WARMSTOREY: "k1fmv7mf",
  LIMIMA: "k1hcixym",
  FASTPEACE: "k1hikk9q",
  BOZSPACER: "k1hk2s3f",
  MALFIRST: "k1hiklwi",
};

async function main() {
  const storeArg = (process.argv[2] || "WARMSTOREY").toUpperCase();
  const dateArg = process.argv[3] || "2026-10-15";
  const profileId = STORES[storeArg];

  if (!profileId) {
    console.error(`Không tìm thấy store: ${storeArg}. Các store hợp lệ: ${Object.keys(STORES).join(", ")}`);
    process.exit(1);
  }

  console.log(`============================================================`);
  console.log(`TEST DOWNLOAD FILE 01 - PORTFOLIOS`);
  console.log(`Store: ${storeArg} | Profile ID: ${profileId}`);
  console.log(`Ngày mục tiêu (targetDate): ${dateArg}`);
  console.log(`============================================================\n`);

  let cdpUrl = "";
  try {
    cdpUrl = await startAdsPowerProfile(profileId);
  } catch (err: any) {
    console.error(`❌ Lỗi mở profile AdsPower: ${err.message}`);
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  const testDownloadDir = path.join(os.homedir(), "AmazonAccounting", "test_file01", storeArg);
  fs.mkdirSync(testDownloadDir, { recursive: true });

  try {
    const downloadedPath = await downloadFile01Portfolios(page, testDownloadDir, dateArg);
    if (downloadedPath && fs.existsSync(downloadedPath)) {
      const stats = fs.statSync(downloadedPath);
      console.log(`\n🎉 TẢI THÀNH CÔNG FILE 01:`);
      console.log(`- Đường dẫn: ${downloadedPath}`);
      console.log(`- Dung lượng: ${stats.size} bytes`);
      const lines = fs.readFileSync(downloadedPath, "utf-8").trim().split("\n");
      console.log(`- Tổng số dòng: ${lines.length}`);
      console.log(`- Dòng tiêu đề (Header): ${lines[0]}`);
      if (lines.length > 1) {
        console.log(`- Dòng dữ liệu mẫu 1: ${lines[1]}`);
      }
    } else {
      console.error(`❌ downloadFile01Portfolios trả về null hoặc không tìm thấy file!`);
    }
  } catch (err: any) {
    console.error(`❌ Lỗi khi thực hiện tải File 01: ${err.message}`);
  } finally {
    try {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await stopAdsPowerProfile(profileId).catch(() => {});
      console.log(`Đã đóng browser và dừng profile ${profileId}.`);
    } catch {}
  }
}

main().catch(console.error);
