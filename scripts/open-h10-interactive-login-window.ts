import { chromium } from "playwright-core";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import { saveHelium10PlaywrightCookies } from "../lib/helium10-playwright";

function base32Decode(str: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of str.toUpperCase().replace(/=/g, "")) {
    const val = alphabet.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function getHelium10TOTP(secret: string = "UOOUD6QB6DZ46NIM"): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  const counter = Math.floor(epoch / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

export async function openH10InteractiveLoginWindow(credentials = {
  email: "haonguyen36928@gmail.com",
  password: "Nce147@@2026",
  totpSecret: "UOOUD6QB6DZ46NIM",
}) {
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  console.log("\n=======================================================");
  console.log("🌐 MỞ CỬA SỔ CHROME TỰ ĐỘNG ĐĂNG NHẬP HELIUM 10");
  console.log("=======================================================\n");

  const browser = await chromium.launch({
    headless: false, // Visible window so user can solve captcha if prompted
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  console.log("👉 Đang mở trang đăng nhập Helium 10...");
  await page.goto("https://members.helium10.com/user/signin?re=L2NlcmVicm8=", {
    waitUntil: "domcontentloaded",
  });

  // Try to autofill email & password
  try {
    const emailInput = page.locator("#loginform-email");
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill(credentials.email);
      await page.locator("#loginform-password").fill(credentials.password);
      console.log("✓ Đã tự động điền Email và Password.");
      console.log("👉 Vui lòng click chuột vào ô 'I'm not a robot' và bấm nút LOG IN.");
    }
  } catch (err) {
    console.log("Không thể tự động điền form:", err);
  }

  console.log("\n⏳ Hệ thống đang theo dõi để tự động nhập 2FA Google Authenticator...");
  console.log("👉 Nếu có reCAPTCHA hình ảnh, bạn chỉ cần bấm xác minh trên màn hình Chrome.");

  let loggedIn = false;
  const maxWaitSeconds = 120;

  for (let i = 1; i <= maxWaitSeconds; i++) {
    await page.waitForTimeout(1000);
    const currentUrl = page.url();

    // 1. Check for 2FA / OTP field
    try {
      const otpSelector =
        'input[name="code"], input[name="otp"], input[name="token"], input[name="two_factor_code"], input[autocomplete="one-time-code"], input.otp-input, input[id*="otp" i], input[placeholder*="code" i]';
      const otpInput = page.locator(otpSelector).first();
      if (await otpInput.isVisible({ timeout: 300 }).catch(() => false)) {
        const val = await otpInput.inputValue().catch(() => "");
        if (!val || val.length < 6) {
          const code = getHelium10TOTP(credentials.totpSecret);
          console.log(`\n🔑 Phát hiện ô nhập 2FA Google Authenticator! Tự động sinh mã TOTP: ${code}`);
          await otpInput.fill(code);
          await page.waitForTimeout(400);

          const submitBtn = page
            .locator('button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Submit"), button[type="submit"]')
            .first();
          if (await submitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log("👉 Tự động click xác nhận mã 2FA...");
            await submitBtn.click().catch(() => { });
          }
        }
      }
    } catch { }

    // 1b. If on signin page, auto-click submit as soon as reCAPTCHA is verified
    if (currentUrl.includes("/user/signin") || currentUrl.includes("/login")) {
      try {
        const recaptchaFrame = page.frameLocator('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]');
        const checkedAnchor = recaptchaFrame.locator('#recaptcha-anchor[aria-checked="true"]');
        if (await checkedAnchor.isVisible({ timeout: 200 }).catch(() => false)) {
          const submitBtn = page.locator('button[type="submit"], #login-form button.btn-secondary').first();
          if (await submitBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            console.log("👉 reCAPTCHA đã xác minh thành công! Tự động bấm nút Log In...");
            await submitBtn.click().catch(() => { });
            await page.waitForTimeout(1500);
          }
        }
      } catch { }
    }

    // 2. Check if logged in
    if (
      currentUrl.includes("cerebro") ||
      currentUrl.includes("dashboard") ||
      currentUrl.includes("members.helium10.com/home") ||
      currentUrl.includes("magnet")
    ) {
      console.log(`\n🎉 ĐÃ ĐĂNG NHẬP THÀNH CÔNG VÀO HELIUM 10: ${currentUrl}`);
      loggedIn = true;
      break;
    }

    if (i % 15 === 0) {
      console.log(`... Đang theo dõi tiến trình đăng nhập (${i}/${maxWaitSeconds}s)...`);
    }
  }

  if (!loggedIn) {
    throw new Error("Hết thời gian chờ đăng nhập Helium 10.");
  }

  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  console.log(`\n✓ Đã trích xuất ${cookies.length} cookies phiên làm việc từ trình duyệt.`);

  if (cookies.length > 0) {
    const rawJson = JSON.stringify(cookies, null, 2);
    await saveHelium10PlaywrightCookies(rawJson);

    // Also update .env file
    const envPath = join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      let envContent = readFileSync(envPath, "utf-8");
      if (envContent.includes("HELIUM10_COOKIES=")) {
        envContent = envContent.replace(
          /HELIUM10_COOKIES=.*/g,
          `HELIUM10_COOKIES='${rawJson.replace(/'/g, "\\'")}'`
        );
      } else {
        envContent += `\nHELIUM10_COOKIES='${rawJson.replace(/'/g, "\\'")}'\n`;
      }
      writeFileSync(envPath, envContent, "utf-8");
    }

    console.log("🔥 ĐÃ LƯU COOKIE HELIUM 10 THÀNH CÔNG VÀO DATABASE VÀ FILE .env!");
    console.log("✨ Giờ đây toàn bộ tính năng đào từ khóa Helium 10 đã sẵn sàng sử dụng mượt mà.");
  } else {
    console.log("⚠️ Không tìm thấy cookie nào.");
  }

  await context.close();
  await browser.close();
  return cookies;
}

if (process.argv[1]?.endsWith("open-h10-interactive-login-window.ts")) {
  openH10InteractiveLoginWindow()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Lỗi:", err);
      process.exit(1);
    });
}
