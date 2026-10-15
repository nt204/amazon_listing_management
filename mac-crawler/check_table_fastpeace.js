const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:51626');
  const page = browser.contexts()[0].pages()[0];

  const tableData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('div[role="row"], tr')).map(r => (r.innerText || '').slice(0, 100).replace(/\n/g, ' | '));
    const pagination = document.body.innerText.match(/\d+\s*-\s*\d+\s*of\s*[\d,]+/i) || document.body.innerText.match(/of\s*[\d,]+\s*results/i);
    const noRows = Array.from(document.querySelectorAll('h3, [id*="noRows"]')).map(h => h.innerText);
    return {
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
      pagination: pagination ? pagination[0] : null,
      noRows
    };
  });
  console.log('TABLE DATA:', JSON.stringify(tableData, null, 2));
  process.exit(0);
})();
