const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  
  // Click Yesterday or date
  const yestBtn = page.locator('button:has-text("Yesterday")').first();
  if (await yestBtn.isVisible({ timeout: 2000 })) {
    console.log('Clicking Yesterday...');
    await yestBtn.click();
  } else {
    const dayBtn = page.locator('button[data-iso-date="2026-10-12"]').first();
    if (await dayBtn.isVisible()) {
      await dayBtn.click();
      await page.waitForTimeout(500);
      await dayBtn.click();
    }
  }
  await page.waitForTimeout(1000);

  const applyBtn = page.locator('button:has-text("Apply")').first();
  if (await applyBtn.isVisible()) {
    console.log('Clicking Apply...');
    await applyBtn.click();
    await page.waitForTimeout(4000);
  }

  // Bây giờ tìm các nút trên bảng campaigns
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], a')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').trim().slice(0, 40).replace(/\n/g, ' '),
      e2e: el.getAttribute('data-e2e-id'),
      takt: el.getAttribute('data-takt-id'),
      aria: el.getAttribute('aria-label')
    })).filter(x => /export|filter|download|page|search/i.test(x.text || '') || /export|filter|download|search/i.test(x.aria || '') || /export|filter/i.test(x.e2e || ''));
  });

  console.log('AFTER APPLY BUTTONS:', JSON.stringify(buttons, null, 2));
  process.exit(0);
})();
