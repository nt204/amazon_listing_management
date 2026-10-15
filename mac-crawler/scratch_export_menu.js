const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  
  const exportBtn = page.locator('#campaignOverviewAllCampaigns\\:udm-export-dropdown, button:has-text("Export")').first();
  console.log('Clicking Export button...');
  await exportBtn.click();
  await page.waitForTimeout(1500);

  const menuItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, a')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').trim().slice(0, 50).replace(/\n/g, ' '),
      e2e: el.getAttribute('data-e2e-id'),
      takt: el.getAttribute('data-takt-id')
    })).filter(x => /export|csv|spreadsheet|download/i.test(x.text || '') || /export|csv/i.test(x.e2e || ''));
  });

  console.log('EXPORT MENU ITEMS:', JSON.stringify(menuItems, null, 2));
  process.exit(0);
})();
