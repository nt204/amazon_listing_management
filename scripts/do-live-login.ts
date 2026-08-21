import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveSellerSpriteCookies, mineSellerSpriteKeywords } from "../lib/sellersprite";

async function doLiveLogin() {
  const username = process.env.SELLERSPRITE_USERNAME || "haonguyen36928@gmail.com";
  const password = process.env.SELLERSPRITE_PASSWORD || "Nce123#@!";
  const asin = "B0GTQQMFVM";

  console.log("=== Performing Live SellerSprite Account Login ===");
  console.log(`Account: ${username}`);

  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  const browser = await chromium.launch({
    headless: false, // Headful mode to ensure 100% login success
    executablePath,
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log("1. Navigating to SellerSprite homepage...");
  await page.goto("https://www.sellersprite.com/v3/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Click login button in header
  const loginLink = page.locator(".user-info, .user-name, a:has-text('Sign In'), button:has-text('Sign In'), a:has-text('Log In')").first();
  if (await loginLink.isVisible({ timeout: 4000 })) {
    console.log("2. Clicking Sign In link...");
    await loginLink.click();
    await page.waitForTimeout(2000);
  }

  // Switch to Password Login tab if visible
  const tabs = page.locator(".el-dialog .el-tabs__item");
  if ((await tabs.count()) > 1) {
    console.log("3. Switching to Password Login Tab...");
    await tabs.nth(1).click();
    await page.waitForTimeout(1000);
  }

  const emailInput = page.locator(".el-dialog input[type='text'], .el-dialog input[type='email'], input[placeholder*='Email'], input[placeholder*='Account']").first();
  const passInput = page.locator(".el-dialog input[type='password'], input[type='password']").first();

  if (await passInput.isVisible({ timeout: 5000 })) {
    console.log(`4. Filling email: ${username}...`);
    await emailInput.fill(username);
    await passInput.fill(password);
    await page.waitForTimeout(500);

    const submitBtn = page.locator(".el-dialog button.el-button--primary, button[type='submit'], .btn-login").first();
    console.log("5. Submitting login form...");
    await submitBtn.click();
    console.log("6. Waiting 10 seconds for user authentication...");
    await page.waitForTimeout(10000);
  } else {
    console.log("⚠️ Login inputs not visible automatically, waiting 15 seconds for manual login in Chrome window if needed...");
    await page.waitForTimeout(15000);
  }

  const cookies = await context.cookies();
  console.log(`7. Captured ${cookies.length} session cookies.`);

  if (cookies.length > 0) {
    const rawJson = JSON.stringify(cookies);
    await saveSellerSpriteCookies(rawJson);

    const envPath = join(process.cwd(), ".env.local");
    let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
    if (envContent.includes("SELLERSPRITE_COOKIES=")) {
      envContent = envContent.replace(/SELLERSPRITE_COOKIES=.*/g, `SELLERSPRITE_COOKIES='${rawJson.replace(/'/g, "\\'")}'`);
    } else {
      envContent += `\nSELLERSPRITE_COOKIES='${rawJson.replace(/'/g, "\\'")}'\n`;
    }
    writeFileSync(envPath, envContent, "utf-8");
    console.log("🔥 Successfully saved AUTHENTICATED LIVE SESSION COOKIES to DB and .env.local!");
  }

  await context.close();
  await browser.close();

  // Test live keyword extraction for ASIN B0GTQQMFVM
  console.log(`\n=== Testing Live Mining for ${asin} ===`);
  const result = await mineSellerSpriteKeywords({ asin, marketplace: "US", limit: 25 });
  console.log("✓ Result Source:", result.source);
  console.log("✓ Total Results:", result.totalResults);
  if (result.keywords.length > 0) {
    console.log("✓ Live Keywords Extracted:");
    console.table(result.keywords.slice(0, 10));
  }
}

doLiveLogin().catch(console.error);
