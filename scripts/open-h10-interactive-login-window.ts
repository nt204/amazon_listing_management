import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveHelium10PlaywrightCookies } from "../lib/helium10-playwright";

async function openH10InteractiveLoginWindow() {
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  console.log("\n=======================================================");
  console.log("🌐 MỞ CỬA SỔ CHROME ĐỂ ĐĂNG NHẬP HELIUM 10");
  console.log("=======================================================\n");

  const browser = await chromium.launch({
    headless: false, // Open visible Chrome browser window for user login
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  console.log("👉 Đang mở trang đăng nhập Helium 10...");
  await page.goto("https://members.helium10.com/user/signin?re=L2NlcmVicm8=", { waitUntil: "domcontentloaded" });

  console.log("\n⏳ Vui lòng đăng nhập tài khoản Helium 10 trên cửa sổ Chrome vừa mở.");
  console.log("⏳ Hệ thống sẽ theo dõi và tự động lưu phiên làm việc ngay khi đăng nhập thành công...\n");

  let loggedIn = false;
  const maxWaitSeconds = 90;
  for (let i = 1; i <= maxWaitSeconds; i++) {
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    if (
      currentUrl.includes("cerebro") ||
      currentUrl.includes("dashboard") ||
      currentUrl.includes("members.helium10.com/home") ||
      currentUrl.includes("magnet")
    ) {
      console.log(`\n✓ Đã phát hiện đăng nhập thành công vào: ${currentUrl}`);
      loggedIn = true;
      break;
    }
    if (i % 10 === 0) {
      console.log(`... Vẫn đang đợi bạn đăng nhập (${i}/${maxWaitSeconds}s) - URL hiện tại: ${currentUrl}`);
    }
  }

  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  console.log(`\n✓ Đã trích xuất ${cookies.length} cookies từ trình duyệt.`);

  if (cookies.length > 0) {
    const rawJson = JSON.stringify(cookies, null, 2);
    await saveHelium10PlaywrightCookies(rawJson);

    // Also update .env file
    const envPath = join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      let envContent = readFileSync(envPath, "utf-8");
      if (envContent.includes("HELIUM10_COOKIES=")) {
        envContent = envContent.replace(/HELIUM10_COOKIES=.*/g, `HELIUM10_COOKIES='${rawJson.replace(/'/g, "\\'")}'`);
      } else {
        envContent += `\nHELIUM10_COOKIES='${rawJson.replace(/'/g, "\\'")}'\n`;
      }
      writeFileSync(envPath, envContent, "utf-8");
    }

    console.log("🔥 ĐÃ LƯU COOKIE HELIUM 10 THÀNH CÔNG VÀO DATABASE VÀ FILE .env!");
    console.log("✨ Bạn đã có thể tra cứu và đào từ khóa Helium 10 / Cerebro bình thường.");
  } else {
    console.log("⚠️ Không tìm thấy cookie nào.");
  }

  await context.close();
  await browser.close();
  process.exit(0);
}

openH10InteractiveLoginWindow().catch((err) => {
  console.error("Lỗi khi mở phiên đăng nhập:", err);
  process.exit(1);
});
