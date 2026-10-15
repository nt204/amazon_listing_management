const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  
  // Điền 0 vào ô input của popup Impressions
  const popup = page.locator('div:has-text("Impressions")').last();
  const inputEl = popup.locator('input').first();
  await inputEl.fill('0');
  await page.waitForTimeout(500);

  // Click Apply trong popup
  const applyBtn = popup.locator('button:has-text("Apply")').first();
  console.log('Clicking Apply in Impressions popup...');
  await applyBtn.click();
  await page.waitForTimeout(5000);

  // Đọc pagination status
  const paginationText = await page.evaluate(() => {
    const m = document.body.innerText.match(/\d+\s*-\s*\d+\s*of\s*[\d,]+/i) || document.body.innerText.match(/of\s*[\d,]+\s*results/i);
    return m ? m[0] : 'None';
  });
  console.log('PAGINATION AFTER FILTER:', paginationText);

  // Export
  const exportBtn = page.locator('button[id*="udm-export-dropdown"], button:has-text("Export")').first();
  await exportBtn.click();
  await page.waitForTimeout(1000);

  const downloadBtn = page.locator('button[id*="export"], button:has-text("Download")').first();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 35000 }),
    downloadBtn.click()
  ]);

  const dest = '/tmp/fp_filtered_05.csv';
  await download.saveAs(dest);
  console.log('Exported lines:', fs.readFileSync(dest, 'utf8').split('\n').length);
  console.log('Sample rows:\n', fs.readFileSync(dest, 'utf8').split('\n').slice(0, 5).join('\n'));
  process.exit(0);
})();
