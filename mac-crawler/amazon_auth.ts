import type { Page } from "playwright-core";
import crypto from "node:crypto";

function base32Decode(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTOTP(secret: string, timeStep = 30): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  const time = Math.floor(epoch / timeStep);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigInt64BE(BigInt(time));
  const hmac = crypto.createHmac("sha1", key).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

export async function ensureAmazonSession(page: Page, storeName: string): Promise<void> {
  const currentUrl = page.url();
  const isSignInUrl =
    currentUrl.includes("/signin") ||
    currentUrl.includes("/ap/signin") ||
    currentUrl.includes("/auth-mfa") ||
    currentUrl.includes("/auth/signin") ||
    currentUrl.includes("openid.return_to");

  // Kiểm tra xem trang có các input đăng nhập không
  const hasLoginInput = await page
    .$("#ap_email, #ap_password, #auth-mfa-otpcode, a[href*='/ap/signin'], button:has-text('Sign in')")
    .catch(() => null);

  if (!isSignInUrl && !hasLoginInput) {
    return;
  }

  const storeKey = storeName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const email =
    process.env[`${storeKey}_AMAZON_EMAIL`] ||
    (storeKey === "BOZSPACER" ? (process.env.BOZSPACER_AMAZON_EMAIL || "jennie662quynhnhunce@gmail.com") : "");
  const password =
    process.env[`${storeKey}_AMAZON_PASSWORD`] ||
    (storeKey === "BOZSPACER" ? (process.env.BOZSPACER_AMAZON_PASSWORD || "") : "");
  const secret =
    process.env[`${storeKey}_AMAZON_2FA_SECRET`] ||
    (storeKey === "BOZSPACER" ? (process.env.BOZSPACER_AMAZON_2FA_SECRET || "") : "");

  if (!password) {
    throw new Error(
      `Profile ${storeName} chưa đăng nhập Amazon (URL: ${currentUrl}). Chưa có ${storeKey}_AMAZON_PASSWORD trong config.env để tự đăng nhập.`,
    );
  }

  console.log(`[${storeName}] 🔐 Phát hiện trang đăng nhập Amazon (${currentUrl}). Tiến hành tự động điền thông tin...`);

  // Nếu đang ở trang trung gian có nút "Sign in" hoặc link signin
  const intermediateBtn = await page.$("a[href*='/ap/signin'], button:has-text('Sign in')").catch(() => null);
  if (intermediateBtn && !(await page.$("#ap_password")) && !(await page.$("#ap_email"))) {
    const isVisible = await intermediateBtn.isVisible().catch(() => false);
    if (isVisible) {
      console.log(`[${storeName}] Nhấn nút đăng nhập trung gian...`);
      await Promise.all([
        page.waitForNavigation({ timeout: 25000 }).catch(() => null),
        intermediateBtn.click(),
      ]);
      await page.waitForTimeout(2000);
    }
  }

  // 1. Kiểm tra ô email nếu chưa chọn sẵn
  const emailSelector = "#ap_email, #ap_email_login, input[name='email'], input[type='email']";
  const emailField = await page.waitForSelector(emailSelector, { timeout: 5000 }).catch(() => null);
  if (emailField && (await emailField.isVisible().catch(() => false))) {
    if (email) {
      console.log(`[${storeName}] Điền email: ${email}...`);
      await emailField.fill(email);
      const continueBtn = await page.$(
        "#continue input[type='submit'], #continue, input#continue, button:has-text('Continue'), span#continue",
      );
      if (continueBtn) {
        console.log(`[${storeName}] Nhấn Continue...`);
        await Promise.all([
          page.waitForNavigation({ timeout: 25000 }).catch(() => null),
          continueBtn.click(),
        ]);
        await page.waitForTimeout(2500);
      }
    }
  }

  // 2. Kiểm tra ô mật khẩu
  const pwdSelector = "#ap_password, input[name='password'], input[type='password']";
  const pwdField = await page.waitForSelector(pwdSelector, { timeout: 10000 }).catch(() => null);
  if (pwdField && (await pwdField.isVisible().catch(() => false))) {
    console.log(`[${storeName}] Điền mật khẩu...`);
    await pwdField.fill(password);
    const rememberCheckbox = await page.$("input[name='rememberMe'], #auth-remember-me");
    if (rememberCheckbox) await rememberCheckbox.check().catch(() => {});
    const submitBtn = await page.$(
      "#signInSubmit, input#signInSubmit, span#signInSubmit input[type='submit'], button[type='submit']",
    );
    if (submitBtn) {
      console.log(`[${storeName}] Click Đăng nhập...`);
      await Promise.all([
        page.waitForNavigation({ timeout: 25000 }).catch(() => null),
        submitBtn.click(),
      ]);
      await page.waitForTimeout(3000);
    }
  }

  // 3. Kiểm tra màn hình 2FA OTP
  const otpSelector = "#auth-mfa-otpcode, input[name='otpCode'], input[name='mfaCode'], input[type='tel']";
  const otpField = await page.waitForSelector(otpSelector, { timeout: 10000 }).catch(() => null);
  if (otpField && (await otpField.isVisible().catch(() => false))) {
    if (!secret) {
      throw new Error(`[${storeName}] Yêu cầu OTP 2FA nhưng chưa cấu hình ${storeKey}_AMAZON_2FA_SECRET trong config.env.`);
    }
    console.log(`[${storeName}] 🔑 Phát hiện màn hình Two-Step Verification OTP. Đang tự động sinh mã TOTP...`);
    const otp = generateTOTP(secret);
    console.log(`[${storeName}] Mã OTP tạo được: ${otp}. Đang submit...`);
    await otpField.fill(otp);

    const mfaRemember = await page.$("#auth-mfa-remember-device, input[name='rememberDevice']");
    if (mfaRemember) await mfaRemember.check().catch(() => {});

    const mfaSubmit = await page.$(
      "#auth-signin-button, input#auth-signin-button, span#auth-signin-button input[type='submit'], button:has-text('Sign in')",
    );
    if (mfaSubmit) {
      console.log(`[${storeName}] Click Xác thực OTP...`);
      await Promise.all([
        page.waitForNavigation({ timeout: 25000 }).catch(() => null),
        mfaSubmit.click(),
      ]);
      await page.waitForTimeout(4000);
    }
  }

  // 4. Kiểm tra nút chọn tài khoản / merchant picker nếu có
  const selectAccountBtn = await page.$(
    "button[name='selectAccount'], button:has-text('Select Account'), button:has-text('Select account'), input[value='Select Account']",
  ).catch(() => null);
  if (selectAccountBtn && (await selectAccountBtn.isVisible().catch(() => false))) {
    console.log(`[${storeName}] Phát hiện màn hình chọn account, click Select Account...`);
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => null),
      selectAccountBtn.click(),
    ]);
    await page.waitForTimeout(3000);
  }

  await page.waitForTimeout(4000);
  const afterUrl = page.url();
  if (afterUrl.includes("/signin") || afterUrl.includes("/ap/signin")) {
    throw new Error(`[${storeName}] Đăng nhập tự động không thành công. URL hiện tại: ${afterUrl}`);
  }
  console.log(`[${storeName}] ✅ Đăng nhập thành công! URL hiện tại: ${afterUrl}`);
}
