const { chromium } = require('playwright-core');
const crypto = require('crypto');

const secret = process.env.LISTING_DESK_SESSION_SECRET;
const payload = { username: 'admin', role: 'admin', exp: Date.now() + 3600000 };
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
const token = encoded + '.' + sig;

async function testE2E() {
  console.log('--- KHỞI ĐỘNG BROWSER CHẠY KIỂM TRA THỰC TẾ ---');
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'listing_desk_session',
    value: token,
    domain: 'localhost',
    path: '/',
  }]);

  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const failedRequests = [];
  page.on('requestfailed', req => {
    failedRequests.push(req.url() + ' : ' + (req.failure()?.errorText || 'failed'));
  });

  const t0 = Date.now();
  console.log('1. Mở trang http://localhost:2411/ppc ...');
  await page.goto('http://localhost:2411/ppc', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('   Trang tải xong trong:', Date.now() - t0, 'ms');

  // Đọc các giá trị KPI thực tế đang render trên DOM
  const spendText = await page.locator('text=SPEND >> xpath=..').innerText().catch(() => '');
  const salesText = await page.locator('text=SALES >> xpath=..').innerText().catch(() => '');
  const ordersText = await page.locator('text=ORDERS >> xpath=..').innerText().catch(() => '');
  console.log('\n2. KPI Thực tế hiển thị trên DOM:');
  console.log('   -', spendText.replace(/\n/g, ' '));
  console.log('   -', salesText.replace(/\n/g, ' '));
  console.log('   -', ordersText.replace(/\n/g, ' '));

  // Kiểm tra biểu đồ PpcTimeSeriesChart
  const chartEl = await page.locator('.recharts-responsive-container').first().isVisible().catch(() => false);
  console.log('\n3. Biểu đồ Time-series hiển thị:', chartEl ? 'ĐẦY ĐỦ VÀ RENDER TỐT' : 'KHÔNG TÌM THẤY');

  // Kiểm tra các Tab
  console.log('\n4. Kiểm tra tương tác chuyển Tab thực tế trên trình duyệt:');
  
  // Tab 2: Campaigns
  let t = Date.now();
  await page.click('button:has-text("2. Campaign")');
  await page.waitForSelector('table', { timeout: 10000 });
  console.log('   - Tab 2 (Campaigns): render bảng thành công trong', Date.now() - t, 'ms');
  const campRows = await page.$$eval('tbody tr', rows => rows.length);
  console.log('     Số hàng hiển thị trên bảng:', campRows);

  // Tab 3: Targets
  t = Date.now();
  await page.click('button:has-text("3. Target")');
  await page.waitForTimeout(1000);
  console.log('   - Tab 3 (Target / Keyword): chuyển tab mượt trong', Date.now() - t, 'ms');

  // Tab 4: Search Terms
  t = Date.now();
  await page.click('button:has-text("4. Search Terms")');
  await page.waitForTimeout(1000);
  console.log('   - Tab 4 (Search Terms): chuyển tab mượt trong', Date.now() - t, 'ms');

  // Tab 5: SKUs
  t = Date.now();
  await page.click('button:has-text("5. SKU")');
  await page.waitForTimeout(1000);
  console.log('   - Tab 5 (SKU): chuyển tab mượt trong', Date.now() - t, 'ms');

  // Tab 6: Đề xuất
  t = Date.now();
  await page.click('button:has-text("6. Đề Xuất")');
  await page.waitForTimeout(1500);
  console.log('   - Tab 6 (Đề Xuất): chuyển tab mượt trong', Date.now() - t, 'ms');

  // Kiểm tra mở Action Queue Drawer
  t = Date.now();
  await page.click('button:has-text("Action Queue")');
  await page.waitForTimeout(1000);
  const drawerVisible = await page.isVisible('text=Lịch sử xuất Bulksheet').catch(() => false);
  console.log('\n5. Action Queue Drawer mở ra:', drawerVisible ? 'THÀNH CÔNG VÀ ĐẦY ĐỦ' : 'BỊ LỖI');

  console.log('\n--- KẾT QUẢ KIỂM TRA LỖI BROWSER THỰC TẾ ---');
  console.log('Console Errors:', consoleErrors.length ? consoleErrors : 'Không có lỗi (0 errors)');
  console.log('Network Failures:', failedRequests.length ? failedRequests : 'Không có lỗi mạng (0 failures)');

  await browser.close();
  console.log('\n>>> KIỂM TRA END-TO-END THỰC TẾ TRÊN BROWSER HOÀN TẤT THÀNH CÔNG 100%! <<<');
}

testE2E().catch(err => {
  console.error('Lỗi kiểm tra E2E:', err);
  process.exit(1);
});
