import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:52046');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('bulk-operations'));
  if (!page) throw new Error('No bulk page');

  // Open modal if not open
  const isModalOpen = await page.$('button[data-takt-id="adz_bulkSheets_exportModal_download_button"]');
  if (!isModalOpen) {
    await page.click('button[data-takt-id="Bulksheet_home_download_campaigns_button"]');
    await page.waitForTimeout(1500);
  }

  // Check SB, uncheck SP
  const spInput = await page.$("label:has-text('Sponsored Products data') input");
  const sbInput = await page.$("label:has-text('Sponsored Brands data') input");
  if (sbInput && !(await sbInput.isChecked())) await page.click("label:has-text('Sponsored Brands data')");
  if (spInput && (await spInput.isChecked())) await page.click("label:has-text('Sponsored Products data')");
  await page.waitForTimeout(500);

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
  console.log('Bấm Download cho Bulk SB 7 Days...');
  await modalDownload.click();
  await page.waitForTimeout(2000);
  console.log('Đã gửi yêu cầu Bulk SB 7 Days thành công!');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
