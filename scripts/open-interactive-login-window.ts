import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveSellerSpriteCookies } from "../lib/sellersprite";

async function openInteractiveLoginWindow() {
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  console.log("\n=======================================================");
  console.log("🌐 MỞ CỬA SỔ CHROME ĐỂ ĐĂNG NHẬP SELLERSPRITE THẬT");
  console.log("Tài khoản: haonguyen36928@gmail.com");
  console.log("Mật khẩu: Nce123#@!");
  console.log("=======================================================\n");

  const browser = await chromium.launch({
    headless: false, // Open visible Chrome browser window
    executablePath,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });

  const page = await context.newPage();
  console.log("Đang mở trang đăng nhập SellerSprite...");
  await page.goto("https://www.sellersprite.com/v3/keyword-reverse?asin=B0GTQQMFVM", { waitUntil: "domcontentloaded" });

  console.log("⏳ Vui lòng kiểm tra cửa sổ Chrome vừa mở trên màn hình.");
  console.log("👉 Đăng nhập tài khoản haonguyen36928@gmail.com / Nce123#@!");
  console.log("⏳ Hệ thống sẽ đợi 25 giây để tự động lưu Cookie đăng nhập...");

  await page.waitForTimeout(25000);

  const cookies = await context.cookies();
  console.log(`\n✓ Đã ghi nhận ${cookies.length} phiên Cookie sau khi đăng nhập.`);

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
    console.log("🔥 ĐÃ LƯU COOKIE ĐÃ XÁC THỰC THÀNH CÔNG VÀO DB VÀ .env.local!");
  }

  await context.close();
  await browser.close();
}

openInteractiveLoginWindow().catch(console.error);
