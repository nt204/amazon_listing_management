const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  
  // Nút Export dropdown
  const exportDropdown = page.locator('#campaignOverviewAllCampaigns\\:udm-export-dropdown, button:has-text("Export")').first();
  if (await exportDropdown.isVisible({ timeout: 5000 })) {
    console.log('Clicking Export dropdown...');
    await exportDropdown.click();
    await page.waitForTimeout(1000);
  }

  // Nút Download trong menu
  const downloadBtn = page.locator('#campaignOverviewAllCampaigns\\:export, button:has-text("Download")').first();
  console.log('Clicking Download and waiting for file...');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 35000 }),
    downloadBtn.click()
  ]);

  const targetPath = '/tmp/test_05_campaigns.csv';
  await download.saveAs(targetPath);
  console.log('DOWNLOAD SUCCESS! Size:', fs.statSync(targetPath).size, 'bytes');
  console.log('FIRST 500 BYTES:\n', fs.readFileSync(targetPath, 'utf8').slice(0, 500));
  process.exit(0);
})();
