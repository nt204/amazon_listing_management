const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  
  const impOption = page.locator('#campaignOverviewAllCampaigns\\:addFilterSelector\\:optionSelector button:has-text("Impressions")').first();
  console.log('Clicking Impressions option...');
  await impOption.click();
  await page.waitForTimeout(1500);

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, button')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: el.innerText || el.value || '',
      type: el.type,
      aria: el.getAttribute('aria-label')
    })).filter(x => /greater|apply|save|filter/i.test(x.text || '') || x.tag === 'INPUT' || /filter/i.test(x.id || ''));
  });

  console.log('IMPRESSION FILTER INPUTS:', JSON.stringify(inputs, null, 2));
  process.exit(0);
})();
