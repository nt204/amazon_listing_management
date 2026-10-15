const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

async function testDownloadFile05(port, brand, targetDateStr) {
  console.log(`\n========================================`);
  console.log(`Testing File 05 for ${brand} on port ${port}...`);
  console.log(`========================================`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  
  const url = "https://advertising.amazon.com/campaign-manager/all-campaigns";
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(5000);

  // 1. Chờ bảng ban đầu load
  await page.waitForSelector('[role="row"], tr', { timeout: 20000 }).catch(() => {});

  // 2. Mở date picker
  const datePickerBtn = page.locator(
    'button[id*="dateRangeFilter:openContainer"], button[aria-label="Open date range picker"], button[data-e2e-id*="dateRangeFilter"]'
  ).first();
  await datePickerBtn.waitFor({ state: "visible", timeout: 20000 });
  console.log('Mở date picker...');
  await datePickerBtn.click();
  await page.waitForTimeout(1500);

  // 3. Chọn ngày
  console.log(`Chọn ngày: ${targetDateStr}...`);
  const targetDayBtn = page.locator(`button[data-iso-date="${targetDateStr}"]`).first();
  if (await targetDayBtn.isVisible({ timeout: 2500 })) {
    await targetDayBtn.click();
    await page.waitForTimeout(400);
    await targetDayBtn.click();
  } else {
    const yestBtn = page.locator('button:has-text("Yesterday")').first();
    if (await yestBtn.isVisible({ timeout: 2000 })) {
      await yestBtn.click();
    }
  }
  await page.waitForTimeout(1000);

  // 4. Click Apply date
  const applyDateBtn = page.locator('button:has-text("Apply"), button[data-takt-id*="dateRange-save"]').first();
  await applyDateBtn.click();
  console.log('Đã bấm Apply ngày, chờ bảng nạp dữ liệu (6 giây)...');
  await page.waitForTimeout(6000);

  // 5. Chờ bảng nạp xong dữ liệu
  await page.waitForSelector('[role="row"], tr', { timeout: 20000 }).catch(() => {});

  // 6. Kiểm tra phân trang và tổng số kết quả
  const paginationInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*of\s*([\d,]+)/i) || text.match(/of\s*([\d,]+)\s*results/i);
    const noRows = document.body.innerText.includes("No data available") || document.body.innerText.includes("No rows found");
    return {
      match: m ? m[0] : null,
      total: m ? parseInt((m[3] || m[1]).replace(/,/g, ''), 10) : 0,
      noRows
    };
  });
  console.log('Pagination info:', JSON.stringify(paginationInfo));

  const totalResults = paginationInfo.total;
  let totalPages = totalResults > 0 ? Math.ceil(totalResults / 300) : 1;
  // Giới hạn an toàn tối đa 10 trang để tránh treo nếu store có 50k campaign rác
  if (totalPages > 10) {
    console.log(`Phát hiện ${totalResults} campaigns (${totalPages} trang), giới hạn tối đa 5 trang đầu.`);
    totalPages = 5;
  }
  console.log(`Số trang cần tải: ${totalPages}`);

  const tempParts = [];
  for (let i = 0; i < totalPages; i++) {
    if (i > 0) {
      console.log(`Bấm Next Page sang trang ${i + 1}...`);
      const nextBtn = page.locator('[aria-label="Next Page"], [aria-label*="next page" i], button:has-text("Next")').first();
      await nextBtn.click();
      await page.waitForTimeout(5000);
      await page.waitForSelector('[role="row"], tr', { timeout: 15000 }).catch(() => {});
    }

    // Export dropdown
    const exportDropdown = page.locator('button[id*="udm-export-dropdown"], button:has-text("Export")').first();
    await exportDropdown.click();
    await page.waitForTimeout(1000);

    const downloadBtn = page.locator('button[id*="export"], button:has-text("Download")').first();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 35000 }),
      downloadBtn.click()
    ]);

    const partPath = `/tmp/test_part_${brand}_${i + 1}.csv`;
    await download.saveAs(partPath);
    console.log(`Trang ${i + 1}: Tải thành công ${fs.statSync(partPath).size} bytes`);
    tempParts.push(partPath);
  }

  // Gộp parts
  const finalPath = `/tmp/test_final_${brand}.csv`;
  if (tempParts.length === 1) {
    fs.copyFileSync(tempParts[0], finalPath);
  } else {
    let merged = "";
    for (let i = 0; i < tempParts.length; i++) {
      const content = fs.readFileSync(tempParts[i], 'utf8');
      const lines = content.split('\n');
      if (i === 0) {
        merged += content;
      } else {
        const body = lines.slice(1).join('\n');
        if (!merged.endsWith('\n')) merged += '\n';
        merged += body;
      }
    }
    fs.writeFileSync(finalPath, merged);
  }

  console.log(`=> KẾT QUẢ CUỐI CÙNG [${brand}]: ${fs.statSync(finalPath).size} bytes, ${fs.readFileSync(finalPath, 'utf8').split('\n').length} dòng.`);
  process.exit(0);
}

// Chạy test trên port 51626 (FASTPEACE)
testDownloadFile05(51626, "FASTPEACE", "2026-10-12").catch(e => {
  console.error("TEST ERROR:", e);
  process.exit(1);
});
