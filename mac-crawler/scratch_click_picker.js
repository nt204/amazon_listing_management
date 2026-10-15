const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  
  const pickerBtn = page.locator('button[aria-label="Open date range picker"]').first();
  console.log('Found picker button, clicking...');
  await pickerBtn.click();
  await page.waitForTimeout(2000);

  const dialogElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, input, [role="button"], [role="dialog"], [data-iso-date], [aria-label]')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || el.value || '').trim().slice(0, 40).replace(/\n/g, ' '),
      iso: el.getAttribute('data-iso-date'),
      aria: el.getAttribute('aria-label'),
      takt: el.getAttribute('data-takt-id')
    })).filter(x => x.iso || /apply|save|yesterday|oct|custom|cancel/i.test(x.text) || /date|calendar|save|apply/i.test(x.aria || ''));
  });

  console.log('DATE PICKER DIALOG ELEMENTS:', JSON.stringify(dialogElements.slice(0, 40), null, 2));
  process.exit(0);
})();
