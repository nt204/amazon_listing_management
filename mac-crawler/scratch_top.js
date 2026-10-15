const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  const topButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], [data-e2e-id]')).slice(0, 40).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').slice(0, 50),
      e2e: el.getAttribute('data-e2e-id'),
      takt: el.getAttribute('data-takt-id'),
      aria: el.getAttribute('aria-label')
    }));
  });
  console.log('TOP BUTTONS:', JSON.stringify(topButtons, null, 2));
  process.exit(0);
})();
