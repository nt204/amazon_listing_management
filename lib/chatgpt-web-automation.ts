import { chromium, type Browser, type Cookie } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ChatGPTWebAutomationOptions {
  cookies?: string;
  sessionToken?: string;
  headless?: boolean;
  timeoutMs?: number;
  inputImageBuffer?: Buffer;
}

function sanitizePlaywrightCookie(raw: Partial<Cookie> & Record<string, unknown>): Cookie {
  const name = String(raw.name || "").trim();
  const value = String(raw.value || "").trim();
  let domain = String(raw.domain || ".chatgpt.com").trim();
  if (name.startsWith("__Host-")) {
    domain = "";
  } else if (!domain.includes("chatgpt")) {
    domain = ".chatgpt.com";
  }

  let sameSite: "Strict" | "Lax" | "None" = "Lax";
  const rawSameSite = String(raw.sameSite || "").toLowerCase();
  if (rawSameSite.includes("strict")) sameSite = "Strict";
  else if (rawSameSite.includes("none")) sameSite = "None";

  let expires = -1;
  if (typeof raw.expires === "number" && Number.isFinite(raw.expires) && raw.expires > 0) {
    expires = Math.floor(raw.expires);
  } else if (typeof raw.expirationDate === "number" && Number.isFinite(raw.expirationDate)) {
    expires = Math.floor(raw.expirationDate);
  }

  return {
    name,
    value,
    domain,
    path: "/",
    expires,
    httpOnly: Boolean(raw.httpOnly),
    secure: true,
    sameSite,
  };
}

function getLatestEnvVar(key: string): string {
  if (process.env[key]?.trim()) return process.env[key]!;
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${key}=`)) {
          const val = trimmed.substring(key.length + 1).trim();
          if (val) return val;
        }
      }
    }
  } catch {}
  return "";
}

/**
 * Parses raw cookie strings (JSON or key=value header format) into Playwright Cookie objects.
 */
export function parseChatGPTCookies(cookiesRaw?: string, sessionTokenRaw?: string): Cookie[] {
  const cookies: Cookie[] = [];

  const rawCookies = cookiesRaw || getLatestEnvVar("CHATGPT_WEB_COOKIES");
  const rawToken = sessionTokenRaw || getLatestEnvVar("CHATGPT_SESSION_TOKEN");

  if (rawCookies?.trim()) {
    const trimmed = rawCookies.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.name && item.value) {
              cookies.push(sanitizePlaywrightCookie(item));
            }
          }
        }
      } catch (err) {
        console.warn("[ChatGPT Web Automation] Failed to parse JSON cookies, falling back to header parsing:", err);
      }
    }

    if (cookies.length === 0) {
      // Key=value string format: "key1=val1; key2=val2"
      if (trimmed.includes("=") && trimmed.includes(";")) {
        const pairs = trimmed.split(";");
        for (const pair of pairs) {
          const idx = pair.indexOf("=");
          if (idx > 0) {
            const name = pair.substring(0, idx).trim();
            const value = pair.substring(idx + 1).trim();
            if (name && value) {
              cookies.push(sanitizePlaywrightCookie({ name, value }));
            }
          }
        }
      } else if (trimmed.includes(",")) {
        // User pasted comma-separated chunked tokens directly: "val0,val1"
        const parts = trimmed.split(",");
        parts.forEach((part, index) => {
          if (part.trim()) {
            cookies.push(
              sanitizePlaywrightCookie({
                name: `__Secure-next-auth.session-token.${index}`,
                value: part.trim(),
                httpOnly: true,
              }),
            );
          }
        });
      } else if (trimmed.includes("=")) {
        const idx = trimmed.indexOf("=");
        cookies.push(
          sanitizePlaywrightCookie({
            name: trimmed.substring(0, idx).trim(),
            value: trimmed.substring(idx + 1).trim(),
          }),
        );
      } else {
        // Single raw token string
        cookies.push(
          sanitizePlaywrightCookie({
            name: "__Secure-next-auth.session-token",
            value: trimmed,
            httpOnly: true,
          }),
        );
      }
    }
  }

  if (rawToken?.trim() && !cookies.some((c) => c.name.includes("session-token"))) {
    const trimmedToken = rawToken.trim();
    if (trimmedToken.includes("session-token.")) {
      // Format: "__Secure-next-auth.session-token.0=val0; __Secure-next-auth.session-token.1=val1"
      const pairs = trimmedToken.split(";");
      for (const pair of pairs) {
        const idx = pair.indexOf("=");
        if (idx > 0) {
          cookies.push({
            name: pair.substring(0, idx).trim(),
            value: pair.substring(idx + 1).trim(),
            domain: ".chatgpt.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          });
        }
      }
    } else if (trimmedToken.includes(",")) {
      // Split by comma into .0 and .1
      const parts = trimmedToken.split(",");
      parts.forEach((part, index) => {
        cookies.push({
          name: `__Secure-next-auth.session-token.${index}`,
          value: part.trim(),
          domain: ".chatgpt.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        });
      });
    } else {
      cookies.push({
        name: "__Secure-next-auth.session-token",
        value: trimmedToken,
        domain: ".chatgpt.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
    }
  }

  return cookies.filter(
    (c) =>
      c.name &&
      c.value &&
      !c.name.includes(" ") &&
      !c.name.includes(";") &&
      !c.name.includes(",") &&
      !c.name.includes("="),
  );
}

/**
 * Automation function to open ChatGPT Web, submit prompt, wait for generated image,
 * inspect HTML element <img src="...">, and return the image buffer.
 */
export async function generateChatGPTWebImage(
  prompt: string,
  options?: ChatGPTWebAutomationOptions,
): Promise<Buffer> {
  const isHeadless = options?.headless ?? (getLatestEnvVar("CHATGPT_WEB_HEADLESS") !== "false");
  const timeoutMs = options?.timeoutMs || 120_000;

  const cookies = parseChatGPTCookies(options?.cookies, options?.sessionToken);

  let browser: Browser | null = null;
  try {
    console.info("[ChatGPT Web Automation] Launching Chrome browser...");
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: isHeadless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch {
      browser = await chromium.launch({
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: isHeadless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    }

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    if (cookies.length === 0) {
      console.warn(
        "[ChatGPT Web Automation] Warning: No CHATGPT_WEB_COOKIES or CHATGPT_SESSION_TOKEN provided in .env!",
      );
    } else {
      console.info(`[ChatGPT Web Automation] Injecting ${cookies.length} session cookies for chatgpt.com...`);
      try {
        await context.addCookies(cookies);
      } catch {
        for (const cookie of cookies) {
          await context.addCookies([cookie]).catch((err) => {
            console.warn(
              `[ChatGPT Web Automation] Warning: Skipped invalid cookie "${cookie.name}":`,
              err instanceof Error ? err.message : String(err),
            );
          });
        }
      }
    }

    const page = await context.newPage();

    console.info("[ChatGPT Web Automation] Navigating to https://chatgpt.com...");
    try {
      await page.goto("https://chatgpt.com", {
        waitUntil: "commit",
        timeout: 60_000,
      });
    } catch (gotoErr) {
      console.warn("[ChatGPT Web Automation] Initial page load warning, attempting to continue:", gotoErr);
    }

    // Check for prompt input area
    const promptSelector = "#prompt-textarea, textarea[tabindex='0'], div[contenteditable='true']";
    try {
      await page.waitForSelector(promptSelector, { timeout: 30_000 });
    } catch {
      throw new Error(
        "Không thể tìm thấy ô nhập prompt trên chatgpt.com. Phiên đăng nhập có thể đã hết hạn. Vui lòng cập nhật CHATGPT_WEB_COOKIES hoặc CHATGPT_SESSION_TOKEN trong .env",
      );
    }

    // Upload optional input reference design image if provided
    if (options?.inputImageBuffer) {
      try {
        const fileInput = page.locator("input[type='file']").first();
        if ((await fileInput.count()) > 0) {
          console.info("[ChatGPT Web Automation] Attaching input design image to chat...");
          const fs = await import("fs/promises");
          const path = await import("path");
          const os = await import("os");
          const tmpPath = path.join(os.tmpdir(), `chatgpt_input_${Date.now()}.png`);
          await fs.writeFile(tmpPath, options.inputImageBuffer);
          await fileInput.setInputFiles(tmpPath);
          await fs.unlink(tmpPath).catch(() => {});
          await page.waitForTimeout(2000);
        }
      } catch (uploadErr) {
        console.warn("[ChatGPT Web Automation] Notice: File upload failed, proceeding with prompt text:", uploadErr);
      }
    }

    console.info("[ChatGPT Web Automation] Typing prompt into ChatGPT chat box...");
    const promptInput = page.locator(promptSelector).first();
    await promptInput.focus();
    await promptInput.fill(prompt);
    await page.waitForTimeout(1000);

    // Record existing images (including any uploaded input attachment preview thumbnails) before sending prompt
    const existingImages = await page.locator("img").all();
    const existingSrcs = new Set(await Promise.all(existingImages.map(async (img) => img.getAttribute("src"))));

    // Click send button when enabled, or press Enter
    const sendButtonSelector = "button[data-testid='send-button']:not([disabled]), button[aria-label='Send prompt']:not([disabled])";
    const sendButton = page.locator(sendButtonSelector).first();

    if ((await sendButton.count()) > 0 && (await sendButton.isVisible())) {
      await sendButton.click();
    } else {
      await promptInput.press("Enter");
    }

    // Auto-click Retry if ChatGPT Web temporary error occurs
    await page.waitForTimeout(3000);
    const retryButton = page.locator("button:has-text('Retry')").first();
    if ((await retryButton.count()) > 0 && (await retryButton.isVisible())) {
      console.info("[ChatGPT Web Automation] Notice: Temporary web glitch detected, clicking Retry button...");
      await retryButton.click();
    }

    console.info("[ChatGPT Web Automation] Waiting for image generation response...");

    // Wait for a new img tag to appear inside ChatGPT Assistant response container
    const startTime = Date.now();
    let imageSrc: string | null = null;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(2000);

      // Auto-click Retry if web error occurs during generation
      const retryBtn = page.locator("button:has-text('Retry')").first();
      if ((await retryBtn.count()) > 0 && (await retryBtn.isVisible())) {
        console.info("[ChatGPT Web Automation] Notice: Temporary web glitch detected, clicking Retry button...");
        await retryBtn.click().catch(() => {});
        await page.waitForTimeout(3000);
      }

      // Search ONLY inside assistant message containers to avoid picking up user attachment thumbnails
      const assistantImgs = await page
        .locator(
          "div[data-message-author-role='assistant'] img, article:has([data-message-author-role='assistant']) img, .agent-turn img",
        )
        .all();

      for (const img of assistantImgs) {
        const src = await img.getAttribute("src");
        if (
          src &&
          !existingSrcs.has(src) &&
          !src.includes("avatar") &&
          !src.includes("profile") &&
          !src.includes("user")
        ) {
          if (
            src.includes("oaiusercontent") ||
            src.includes("files.") ||
            src.includes("backend-api") ||
            src.startsWith("blob:") ||
            src.startsWith("data:image")
          ) {
            imageSrc = src;
            break;
          }

          const box = await img.boundingBox().catch(() => null);
          if (box && box.width > 150 && box.height > 150) {
            imageSrc = src;
            break;
          }
        }
      }

      if (imageSrc) break;
    }

    if (!imageSrc) {
      // Fallback inspect: check any non-icon/non-avatar image inside assistant response containers
      const responseImgs = await page
        .locator(
          "div[data-message-author-role='assistant'] img, article:has([data-message-author-role='assistant']) img, .agent-turn img",
        )
        .all();
      for (const img of responseImgs) {
        const src = await img.getAttribute("src");
        if (src && !existingSrcs.has(src) && !src.includes("avatar") && !src.includes("profile") && !src.includes("user")) {
          imageSrc = src;
          break;
        }
      }
    }

    if (!imageSrc) {
      throw new Error(
        "Đã gửi prompt thành công tới ChatGPT Web nhưng không tìm thấy thẻ <img src='...'> của ảnh được gen. Vui lòng kiểm tra lại tài khoản ChatGPT Plus của bạn.",
      );
    }

    console.info(`[ChatGPT Web Automation] Found generated image HTML element: <img src="${imageSrc.substring(0, 80)}...">`);

    // Download image content
    let imageBuffer: Buffer;
    if (imageSrc.startsWith("data:image")) {
      const base64Data = imageSrc.split(",")[1];
      imageBuffer = Buffer.from(base64Data, "base64");
    } else {
      console.info("[ChatGPT Web Automation] Fetching image buffer from URL via browser context...");
      const response = await page.request.get(imageSrc);
      if (!response.ok()) {
        throw new Error(`Không thể tải ảnh từ URL: ${imageSrc} (HTTP ${response.status()})`);
      }
      imageBuffer = await response.body();
    }

    return imageBuffer;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
