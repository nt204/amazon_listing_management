const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], [data-e2e-id], [data-takt-id]')).slice(40, 100).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').slice(0, 50).replace(/\n/g, ' '),
      e2e: el.getAttribute('data-e2e-id'),
      takt: el.getAttribute('data-takt-id'),
      aria: el.getAttribute('aria-label')
    }));
  });
  console.log('BUTTONS 40-100:', JSON.stringify(buttons, null, 2));
  process.exit(0);
})();
