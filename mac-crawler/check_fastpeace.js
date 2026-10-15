const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  await page.goto('https://advertising.amazon.com/campaign-manager/all-campaigns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      elements: Array.from(document.querySelectorAll('button, [id*="filter"], [id*="pagination"], [role="tab"], h3')).map(e => ({
        tag: e.tagName,
        id: e.id,
        text: (e.innerText || '').trim().slice(0, 50),
        aria: e.getAttribute('aria-label')
      })).filter(x => /all|filter|result|page|no rows|no data|campaign|fastpeace/i.test(x.text || '') || /filter|search/i.test(x.aria || ''))
    };
  });
  console.log('FASTPEACE INFO:', JSON.stringify(info, null, 2));
  await page.screenshot({ path: '/tmp/fastpeace_cm.png' });
  console.log('SCREENSHOT SAVED');
  process.exit(0);
})();
