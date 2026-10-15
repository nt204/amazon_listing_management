const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];
  await page.screenshot({ path: '/tmp/after_imp_click.png' });
  console.log('SCREENSHOT SAVED');
  process.exit(0);
})();
