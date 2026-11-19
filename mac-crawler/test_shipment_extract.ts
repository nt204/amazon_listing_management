import { chromium } from "playwright-core";

const ADSPOWER_API_URL = process.env.ADSPOWER_API_URL || "http://127.0.0.1:50325";

async function ensureBrowser(profileId: string) {
  try {
    const activeRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/active?user_id=${profileId}`);
    const activeData = (await activeRes.json()) as any;
    if (activeData.code === 0 && activeData.data?.status === "Active") {
      const listRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/local-active`);
      const listData = (await listRes.json()) as any;
      const match = listData.data?.list?.find((item: any) => item.user_id === profileId);
      if (match?.debug_port) return `http://127.0.0.1:${match.debug_port}`;
    }
  } catch {}

  const startRes = await fetch(`${ADSPOWER_API_URL}/api/v1/browser/start?user_id=${profileId}&open_tabs=1`);
  const startData = (await startRes.json()) as any;
  return `http://127.0.0.1:${startData.data.debug_port}`;
}

async function main() {
  const profileId = "k1hikk9q"; // FASTPEACE
  const testShipments = ["FBA19K5KV1WX", "FBA19K5SD4YZ"];

  const cdpUrl = await ensureBrowser(profileId);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  for (const sId of testShipments) {
    const eventsUrl = `https://sellercentral.amazon.com/fba/inbound-shipment/summary/${sId}/shipmentEvents`;
    await page.goto(eventsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const eventFrame = page.frames().find((f: any) => f.name() === "iframe-shipment-event" || f.url().includes("/fba/shipmentevents/"));
    if (eventFrame) {
      const text = await eventFrame.evaluate(() => document.body?.innerText || "");
      console.log(`\n--- Events for ${sId} ---`);
      console.log(text.slice(0, 1500).replace(/\n\s*\n/g, "\n"));
    }
  }

  await browser.close().catch(() => {});
  await fetch(`${ADSPOWER_API_URL}/api/v1/browser/stop?user_id=${profileId}`).catch(() => {});
}

main().catch(console.error);
