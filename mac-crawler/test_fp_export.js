const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  
  // Kiểm tra date hiện tại
  const dateBtn = page.locator('button[id*="dateRangeFilter:openContainer"]').first();
  console.log('Date text:', await dateBtn.innerText());

  // Click Export dropdown
  const exportDropdown = page.locator('button[id*="udm-export-dropdown"], button:has-text("Export")').first();
  await exportDropdown.click();
  await page.waitForTimeout(1000);

  const downloadOption = page.locator('button[id*="export"], button:has-text("Download")').first();
  console.log('Clicking Download...');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 35000 }),
    downloadOption.click()
  ]);

  const tmpPath = '/tmp/test_fastpeace_export.csv';
  await download.saveAs(tmpPath);
  console.log('Downloaded size:', fs.statSync(tmpPath).size);
  console.log('Downloaded lines:', fs.readFileSync(tmpPath, 'utf8').split('\n').length);
  console.log('First 3 lines:\n', fs.readFileSync(tmpPath, 'utf8').split('\n').slice(0, 3).join('\n'));
  process.exit(0);
})();
