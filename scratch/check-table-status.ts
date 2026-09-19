import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:56738");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const bulkPage = pages.find((p) => p.url().includes("bulk-operations")) || pages[0];

  // Click refresh button on Amazon page
  const refreshBtn = await bulkPage.$("button[aria-label*='Refresh'], button:has-text('Refresh')");
  if (refreshBtn) {
    console.log("Clicking refresh...");
    await refreshBtn.click();
    await bulkPage.waitForTimeout(2000);
  } else {
    console.log("Reloading page...");
    await bulkPage.reload({ waitUntil: "domcontentloaded" });
    await bulkPage.waitForTimeout(2000);
  }

  const rows = await bulkPage.evaluate(() => {
    // find all tr elements in the table
    const trs = Array.from(document.querySelectorAll("table tbody tr"));
    return trs.map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => {
        const text = td.innerText.trim();
        const links = Array.from(td.querySelectorAll("a")).map((a) => ({ text: a.innerText.trim(), href: a.href }));
        return { text, links };
      });
      return cells;
    }).filter((r) => r.length > 0);
  });

  console.log(`Found ${rows.length} rows.`);
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    console.log(`\n--- Row ${i + 1} ---`);
    rows[i].forEach((col, idx) => {
      console.log(`  Col ${idx}: "${col.text}" ${col.links.length ? JSON.stringify(col.links) : ""}`);
    });
  }

  await browser.close();
}

main().catch(console.error);
