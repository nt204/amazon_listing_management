const { chromium } = require('playwright-core');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:49914');
    const page = browser.contexts()[0].pages()[0];
    console.log('PAGE URL:', page.url());
    console.log('PAGE TITLE:', await page.title());
    
    // Screenshot
    await page.screenshot({ path: '/tmp/cm_page.png' });
    console.log('SAVED SCREENSHOT TO /tmp/cm_page.png');

    const buttons = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, [role="button"], a, input'));
      return all.map(el => ({
        tag: el.tagName,
        id: el.id,
        text: (el.innerText || el.value || '').trim().slice(0, 40),
        e2e: el.getAttribute('data-e2e-id'),
        takt: el.getAttribute('data-takt-id'),
        aria: el.getAttribute('aria-label')
      })).filter(x => x.id || x.e2e || x.takt || x.aria || /date|filter|export|today|yesterday/i.test(x.text));
    });
    console.log('INTERESTING ELEMENTS:', JSON.stringify(buttons, null, 2));
  } catch (err) {
    console.error('ERROR:', err);
  }
  process.exit(0);
})();
