import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:56738");
  const context = browser.contexts()[0];
  const pages = context.pages();
  const bulkPage = pages.find((p) => p.url().includes("bulk-operations")) || pages[0];

  // wait for table content to render
  await bulkPage.waitForSelector("div[role='table'], table, div[role='row']", { timeout: 10000 });
  await bulkPage.waitForTimeout(3000);

  const dump = await bulkPage.evaluate(() => {
    // Find all rows in virtual table or normal table
    const rowElements = Array.from(document.querySelectorAll("div[role='row'], tr"));
    const results: string[] = [];
    for (const r of rowElements) {
      const text = (r as HTMLElement).innerText?.replace(/\n+/g, " | ")?.trim();
      if (text && (text.includes("Downloading") || text.includes("Success") || text.includes("Failed") || text.includes("Status"))) {
        const links = Array.from(r.querySelectorAll("a")).map((a) => `${a.innerText}: ${a.href}`);
        results.push(`${text} ==> LINKS: [${links.join(", ")}]`);
      }
    }
    return results;
  });

  console.log("Found matching rows:", dump.length);
  dump.forEach((r, idx) => console.log(`[${idx}] ${r}`));

  await browser.close();
}

main().catch(console.error);
