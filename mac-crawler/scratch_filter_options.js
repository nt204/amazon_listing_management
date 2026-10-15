const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  
  const filterByBtn = page.locator('#campaignOverviewAllCampaigns\\:addFilterSelector\\:optionSelector-trigger, button:has-text("Filter by")').first();
  console.log('Clicking Filter by...');
  await filterByBtn.click();
  await page.waitForTimeout(1500);

  const filterOptions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], button, [id*="option"]')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').trim().slice(0, 40)
    })).filter(x => /impression|spend|cost|status|budget|state/i.test(x.text || '') || /impression/i.test(x.id || ''));
  });

  console.log('FILTER OPTIONS:', JSON.stringify(filterOptions, null, 2));
  process.exit(0);
})();
