import { chromium } from "playwright-core";
import { parseChatGPTCookies } from "../lib/chatgpt-web-automation";
import fs from "fs/promises";
import path from "path";

async function debugPlaywright() {
  console.log("🔍 Debugging ChatGPT Web Automation with Screenshots...");
  const cookies = parseChatGPTCookies();
  console.log(`🍪 Cookies injected: ${cookies.length}`);

  let browser;
  try {
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });
    } catch {
      browser = await chromium.launch({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    if (cookies.length > 0) {
      try {
        await context.addCookies(cookies);
      } catch {
        for (const cookie of cookies) {
          await context.addCookies([cookie]).catch((err) => {
            console.warn(`⚠️ Skipped cookie "${cookie.name}":`, err instanceof Error ? err.message : String(err));
          });
        }
      }
    }

    const page = await context.newPage();

    console.log("🌐 Navigating to https://chatgpt.com ...");
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    const screenshotDir = path.join(process.cwd(), "output");
    await fs.mkdir(screenshotDir, { recursive: true });

    await page.screenshot({ path: path.join(screenshotDir, "debug_1_after_goto.png") });
    console.log("📸 Saved debug_1_after_goto.png");

    const promptSelector = "#prompt-textarea, textarea[tabindex='0'], div[contenteditable='true']";
    const promptInput = page.locator(promptSelector).first();
    const count = await promptInput.count();

    console.log(`🔍 Prompt input found count: ${count}`);

    if (count > 0 && (await promptInput.isVisible())) {
      console.log("⌨️ Typing prompt into chat box...");
      await promptInput.focus();
      await promptInput.fill("Create a simple bright Christmas ornament hanging on a pine tree image");
      await page.screenshot({ path: path.join(screenshotDir, "debug_2_prompt_typed.png") });

      const sendBtn = page.locator("button[data-testid='send-button'], button[aria-label='Send prompt']").first();
      if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
        await sendBtn.click();
      } else {
        await promptInput.press("Enter");
      }
      console.log("🚀 Prompt submitted. Waiting 35 seconds for DALL-E image generation to complete...");
      await page.waitForTimeout(35000);

      await page.screenshot({ path: path.join(screenshotDir, "debug_3_after_submit.png") });
      console.log("📸 Saved debug_3_after_submit.png");

      const images = await page.locator("img").all();
      console.log(`🖼️ Total <img> elements found on page: ${images.length}`);
      for (let i = 0; i < images.length; i++) {
        const src = await images[i].getAttribute("src");
        const alt = await images[i].getAttribute("alt");
        const box = await images[i].boundingBox().catch(() => null);
        console.log(`  Img #${i+1}: src="${src?.substring(0, 70)}...", alt="${alt || ""}", size=${box ? `${box.width}x${box.height}` : "null"}`);
      }
    } else {
      console.log("⚠️ Prompt input area is not visible! Current URL:", page.url());
      const bodyText = await page.locator("body").innerText();
      console.log("📄 Body text snippet:", bodyText.substring(0, 300));
    }
  } catch (err) {
    console.error("❌ Debug error:", err);
  } finally {
    if (browser) await browser.close();
  }
}

debugPlaywright();
