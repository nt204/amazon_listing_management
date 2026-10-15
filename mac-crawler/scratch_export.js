const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
  const page = browser.contexts()[0].pages()[0];
  
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], a')).map(el => ({
      tag: el.tagName,
      id: el.id,
      text: (el.innerText || '').trim().slice(0, 40).replace(/\n/g, ' '),
      e2e: el.getAttribute('data-e2e-id'),
      takt: el.getAttribute('data-takt-id'),
      aria: el.getAttribute('aria-label')
    })).filter(x => /export|filter|download|300|page|search/i.test(x.text || '') || /export|filter|download|search/i.test(x.aria || '') || /export|filter/i.test(x.e2e || ''));
  });

  console.log('EXPORT & FILTER BUTTONS:', JSON.stringify(buttons, null, 2));
  process.exit(0);
})();
