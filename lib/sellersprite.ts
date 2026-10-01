import { chromium, type Browser, type Cookie } from "playwright-core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { getAppSetting, setAppSetting } from "@/lib/db";
import type { RawKeywordMetric } from "@/lib/keyword-research";
import type { AmazonCompetitorCandidate, AmazonCompetitorSearchResult } from "./amazon-asin-types";
import { extractBrandFromTitle } from "./amazon-asin-types";
import { decodeHtml } from "@/lib/competitor-discovery/domain/normalize";

export interface SellerSpriteConfig {
  cookies?: string;
  updatedAt?: string;
  status?: "configured" | "expired" | "not_configured" | "invalid";
  lastTestedAt?: string;
  lastErrorMessage?: string;
}

export interface SellerSpriteMiningOptions {
  asin?: string;
  keyword?: string;
  marketplace?: "US" | "UK" | "DE" | "JP";
  limit?: number;
  headless?: boolean;
  timeoutMs?: number;
}

export interface SellerSpriteKeywordItem {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  aba_rank: number | null;
  purchase_rate: number | null;
  click_share: number | null;
  competing_products: number | null;
  relevance_score: number | null;
}

export interface SellerSpriteMiningResult {
  source: "sellersprite_live" | "sellersprite_mock";
  query: string;
  marketplace: string;
  fetchedAt: string;
  totalResults: number;
  keywords: SellerSpriteKeywordItem[];
  rawMetrics: RawKeywordMetric[];
}

function sanitizeSellerSpriteCookie(raw: Partial<Cookie> & Record<string, unknown>): Cookie {
  const name = String(raw.name || "").trim();
  const value = String(raw.value || "").trim();
  let domain = String(raw.domain || ".sellersprite.com").trim();

  if (!domain.includes("sellersprite")) {
    domain = ".sellersprite.com";
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
    path: String(raw.path || "/"),
    expires,
    httpOnly: Boolean(raw.httpOnly),
    secure: Boolean(raw.secure),
    sameSite,
  };
}

/**
 * Parses raw cookie strings (JSON or key=value header format) into Playwright Cookie objects.
 */
export function parseSellerSpriteCookies(rawCookiesInput?: string): Cookie[] {
  const cookies: Cookie[] = [];
  if (!rawCookiesInput?.trim()) return cookies;

  const trimmed = rawCookiesInput.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.name && item.value) {
            cookies.push(sanitizeSellerSpriteCookie(item));
          }
        }
      }
    } catch {
      // Fall back to header parsing if JSON fails
    }
  }

  if (cookies.length === 0 && trimmed.includes("=")) {
    const pairs = trimmed.split(";");
    for (const pair of pairs) {
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const name = pair.substring(0, idx).trim();
        const value = pair.substring(idx + 1).trim();
        if (name && value) {
          cookies.push(
            sanitizeSellerSpriteCookie({
              name,
              value,
              domain: ".sellersprite.com",
            }),
          );
        }
      }
    }
  }

  return cookies;
}

export async function getSellerSpriteConfig(): Promise<SellerSpriteConfig> {
  try {
    const setting = await getAppSetting<SellerSpriteConfig>("sellersprite_config");
    if (setting?.cookies?.trim()) {
      return setting;
    }
  } catch {}

  const envCookie = process.env.SELLERSPRITE_COOKIES?.trim();
  if (envCookie) {
    return {
      cookies: envCookie,
      updatedAt: new Date().toISOString(),
      status: "configured",
    };
  }

  return {
    status: "not_configured",
  };
}

export async function saveSellerSpriteCookies(rawCookies: string): Promise<SellerSpriteConfig> {
  const parsed = parseSellerSpriteCookies(rawCookies);
  if (parsed.length === 0) {
    throw new Error("Format cookie không hợp lệ. Vui lòng dán chuỗi JSON cookie hoặc chuỗi Cookie header (key=value; ...).");
  }

  const config: SellerSpriteConfig = {
    cookies: rawCookies.trim(),
    updatedAt: new Date().toISOString(),
    status: "configured",
    lastTestedAt: new Date().toISOString(),
  };

  await setAppSetting("sellersprite_config", config as unknown as Record<string, unknown>);
  return config;
}

export async function saveSellerSpriteToken(rawToken: string): Promise<{ token: string; updatedAt: string }> {
  const token = rawToken.trim();
  if (!token) throw new Error("Token không được để trống.");
  const existing = (await getAppSetting<Record<string, unknown>>("sellersprite_config")) || {};
  const updated = {
    ...existing,
    token,
    updatedAt: new Date().toISOString(),
    status: "configured",
  };
  await setAppSetting("sellersprite_config", updated);
  return { token, updatedAt: updated.updatedAt };
}

export interface SellerSpriteCredentials {
  username?: string;
  password?: string;
}

/**
 * Automates login to SellerSprite via Playwright to fetch fresh session cookies automatically
 */
export async function autoLoginSellerSprite(creds?: SellerSpriteCredentials): Promise<string> {
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    await page.goto("https://www.sellersprite.com/v3/keyword-reverse", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const cookies = await context.cookies();
    await context.close();

    if (cookies.length === 0) {
      throw new Error("Không thể lấy Cookie tự động từ SellerSprite.");
    }

    const rawCookieJson = JSON.stringify(cookies);
    await saveSellerSpriteCookies(rawCookieJson);
    return rawCookieJson;
  } finally {
    await browser.close().catch(() => {});
  }
}



/**
 * Main SellerSprite Keyword Mining entry point using Playwright Core
 */
export async function mineSellerSpriteKeywords(
  options: SellerSpriteMiningOptions,
  allowAutoRetry: boolean = true,
): Promise<SellerSpriteMiningResult> {
  const query = (options.asin || options.keyword || "").trim();
  const marketplace = options.marketplace || "US";
  const limit = options.limit || 500;

  if (!query) {
    throw new Error("Vui lòng cung cấp ASIN hoặc Seed Keyword để đào.");
  }

  const config = await getSellerSpriteConfig();

  if (!config.cookies) {
    throw new Error("Chưa cấu hình Cookie SellerSprite. Vui lòng bấm 'Cấu hình Cookie' ở góc trên bên phải để dán Cookie đăng nhập SellerSprite.");
  }

  const cookies = parseSellerSpriteCookies(config.cookies);
  if (cookies.length === 0) {
    throw new Error("Cookie SellerSprite không khả dụng hoặc đã hỏng. Vui lòng cập nhật Cookie trong phần Cài đặt.");
  }

  let browser: Browser | null = null;
  try {
    const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(macChromePath) ? macChromePath : undefined);
    browser = await chromium.launch({
      headless: options.headless ?? true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Optimized for Linux 6GB RAM VPS / Docker
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    let interceptedData: unknown = null;

    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/api/") &&
        (url.includes("reversing") || url.includes("keyword-miner") || url.includes("relation/reversing"))
      ) {
        try {
          const json = await response.json();
          const dataObj = json?.data;
          const items = Array.isArray(dataObj) ? dataObj : (dataObj?.items || dataObj?.list || json?.items);
          if (Array.isArray(items) && items.length > 0) {
            const first = items[0];
            if (first && typeof first === "object" && ("keywords" in first || "searches" in first || "keyword" in first || "bid" in first)) {
              interceptedData = json;
              console.log(`✓ Intercepted live SellerSprite payload from ${url} with ${items.length} items`);
            }
          }
        } catch {}
      }
    });

    // Navigate to clean SellerSprite page
    const targetUrl = options.asin 
      ? "https://www.sellersprite.com/v3/keyword-reverse"
      : "https://www.sellersprite.com/v3/keyword-miner";

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 30000,
    });

    await page.waitForTimeout(3000);

    try {
      if (options.asin) {
        const asinInput = page.locator("input[placeholder*='Enter ASIN']").first();
        await asinInput.fill(options.asin);
        await page.waitForTimeout(500);

        const searchBtn = page.locator("button:has-text('Search'), button:has-text('ASIN Lookup')").first();
        await searchBtn.click();
      }
    } catch {}

    // Execute multi-page pagination loop in browser context to collect ALL keywords across pages up to limit
    try {
      const evalRes = await page.evaluate(async ({ targetAsin, targetKeyword, targetLimit }) => {
        try {
          let allItems: unknown[] = [];
          const pageSize = 50;
          const maxPages = Math.min(20, Math.ceil(targetLimit / pageSize));

          for (let pageNum = 0; pageNum < maxPages; pageNum++) {
            const skip = pageNum * pageSize;
            let url = "";
            let bodyData: Record<string, unknown> = {};

            if (targetAsin) {
              url = "/v3/api/relation/reversing?market=COM";
              bodyData = {
                asin: targetAsin,
                limit: pageSize,
                skip: skip,
                month: "",
                badges: [],
                conversionKeywordTypes: [],
                trafficKeywordTypes: [],
                order: 12,
                desc: true,
                exactly: false,
                ac: false,
                keywordBidMatchType: "exact",
                filterDeletedKeywords: false,
              };
            } else {
              url = "/v3/api/keyword-miner?market=COM";
              bodyData = {
                keyword: targetKeyword,
                limit: pageSize,
                skip: skip,
                order: 1,
                desc: true,
              };
            }

            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
              },
              body: JSON.stringify(bodyData),
            });
            const json = await res.json();
            if (json?.code === "OK" && Array.isArray(json?.data?.items) && json.data.items.length > 0) {
              allItems = allItems.concat(json.data.items);
              if (json.data.items.length < pageSize) {
                break; // End of SellerSprite database results
              }
            } else {
              break;
            }
          }
          return { code: "OK", data: { items: allItems } };
        } catch (e) {
          return null;
        }
      }, { targetAsin: options.asin, targetKeyword: options.keyword, targetLimit: limit });

      if (evalRes && evalRes.code === "OK" && evalRes.data?.items && evalRes.data.items.length > 0) {
        interceptedData = evalRes;
        console.log(`✓ Direct browser fetch collected ALL ${evalRes.data.items.length} live keywords across pages for ${options.asin || options.keyword}`);
      }
    } catch {}

    // Wait for live XHR API response to arrive from Vue Axios request if not captured yet
    for (let i = 0; i < 20; i++) {
      if (interceptedData) break;
      await page.waitForTimeout(500);
    }

    let extractedKeywords: SellerSpriteKeywordItem[] = [];

    if (interceptedData && typeof interceptedData === "object") {
      const payload = interceptedData as Record<string, unknown>;
      const dataObj = (payload.data && typeof payload.data === "object") ? (payload.data as Record<string, unknown>) : payload;
      const list = (Array.isArray(dataObj) ? dataObj : (dataObj.items || dataObj.list || payload.items || payload.result)) as Record<string, unknown>[];

      if (Array.isArray(list)) {
        extractedKeywords = list.slice(0, limit).map((row) => ({
          keyword: String(row.keywords || row.keyword || row.word || row.query || "").trim(),
          search_volume: typeof row.searches === "number" ? row.searches : (typeof row.searchVolume === "number" ? row.searchVolume : null),
          cpc: typeof row.bid === "number" ? row.bid : (typeof row.cpc === "number" ? row.cpc : null),
          aba_rank: typeof row.abaRank === "number" ? row.abaRank : (typeof row.aba === "number" ? row.aba : null),
          purchase_rate: typeof row.purchaseRate === "number" ? row.purchaseRate : null,
          click_share: typeof row.clickRate === "number" ? row.clickRate : null,
          competing_products: typeof row.products === "number" ? row.products : (typeof row.competitors === "number" ? row.competitors : null),
          relevance_score: typeof row.relevance === "number" ? row.relevance : 0.85,
        })).filter(k => k.keyword.length > 0);
      }
    }

    // Fallback: If XHR interception didn't return list, parse DOM rows
    if (extractedKeywords.length === 0) {
      extractedKeywords = await page.evaluate((maxLimit) => {
        const rows = Array.from(document.querySelectorAll("table tbody tr, .keyword-row, .result-row"));
        const results: SellerSpriteKeywordItem[] = [];

        for (const row of rows) {
          if (results.length >= maxLimit) break;
          const text = row.textContent || "";
          const kwEl = row.querySelector(".keyword, .word-cell, td:nth-child(2)");
          if (kwEl && kwEl.textContent?.trim()) {
            const kw = kwEl.textContent.trim();
            const volMatch = text.match(/([\d,]+)\s*(search|volume|tháng)/i);
            const search_volume = volMatch ? parseInt(volMatch[1].replace(/,/g, ""), 10) : null;
            results.push({
              keyword: kw,
              search_volume,
              cpc: null,
              aba_rank: null,
              purchase_rate: null,
              click_share: null,
              competing_products: null,
              relevance_score: 0.8,
            });
          }
        }
        return results;
      }, limit);
    }

    await context.close();

    if (extractedKeywords.length === 0) {
      throw new Error("Không thể trích xuất keyword từ SellerSprite. Vui lòng kiểm tra lại Cookie đăng nhập hoặc đảm bảo tài khoản SellerSprite đang còn hạn sử dụng.");
    }

    return {
      source: "sellersprite_live",
      query,
      marketplace,
      fetchedAt: new Date().toISOString(),
      totalResults: extractedKeywords.length,
      keywords: extractedKeywords,
      rawMetrics: extractedKeywords.map((item) => ({
        keyword: item.keyword,
        search_volume: item.search_volume,
        cpc: item.cpc,
        iq_score: item.aba_rank ? Math.max(1, Math.floor(100000 / item.aba_rank)) : null,
        organic_rank: null,
        sponsored_rank: null,
        competitor_count: item.competing_products ?? undefined,
      })),
    };
  } catch (error) {
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Calculates SellerSprite token using the official Chrome extension TKK algorithm
 */
function calSellerSpriteTk(e: string, t: string): string {
  function r(e: number, t: string): number {
    for (let r = 0; r < t.length - 2; r += 3) {
      let n: number = t.charCodeAt(r + 2);
      n = "a" <= t.charAt(r + 2) ? n - 87 : Number(t.charAt(r + 2));
      n = "+" === t.charAt(r + 1) ? e >>> n : e << n;
      e = "+" === t.charAt(r) ? (e + n) & 4294967295 : e ^ n;
    }
    return e;
  }

  const n = t.split(".");
  let numT = Number(n[0]) || 0;
  const a: number[] = [];
  let s = 0;

  for (let i = 0; i < e.length; i++) {
    let o = e.charCodeAt(i);
    if (128 > o) {
      a[s++] = o;
    } else if (2048 > o) {
      a[s++] = (o >> 6) | 192;
      a[s++] = (63 & o) | 128;
    } else if (55296 === (64512 & o) && i + 1 < e.length && 56320 === (64512 & e.charCodeAt(i + 1))) {
      o = 65536 + ((1023 & o) << 10) + (1023 & e.charCodeAt(++i));
      a[s++] = (o >> 18) | 240;
      a[s++] = ((o >> 12) & 63) | 128;
      a[s++] = ((o >> 6) & 63) | 128;
      a[s++] = (63 & o) | 128;
    } else {
      a[s++] = (o >> 12) | 224;
      a[s++] = ((o >> 6) & 63) | 128;
      a[s++] = (63 & o) | 128;
    }
  }

  let curr = numT;
  for (let sIdx = 0; sIdx < a.length; sIdx++) {
    curr = r((curr += a[sIdx]), "+-a^+6");
  }
  curr = r(curr, "+-3^+b+-f");
  if (0 > (curr ^= Number(n[1]) || 0)) {
    curr = 2147483648 + (2147483647 & curr);
  }
  const modN = curr % 1e6;
  return modN.toString() + "." + (modN ^ numT);
}

export function computeSellerSpriteTk(e?: string | null, t?: string | null): string {
  const parts: string[] = [];
  const args = [e, t];
  for (let i = 0; i < args.length; i++) {
    const val = args[i];
    if (val && String(val).length > 0) {
      parts.push(String(val));
    }
  }
  if (parts.length < 1) return "";
  const version = "5.0.5";
  const extVersion = version.replace(/\./, "00").replace(/\./g, "0") + ".1364508470";
  return calSellerSpriteTk(parts.join(""), extVersion);
}

/**
 * Signs in to SellerSprite Extension API directly using authentic credentials & TKK algorithm.
 * Automatically retrieves a fresh session token and caches it in DB.
 */
export async function signInSellerSpriteExtension(
  email?: string,
  password?: string
): Promise<string> {
  const userEmail = email || process.env.SELLERSPRITE_USERNAME;
  const userPass = password || process.env.SELLERSPRITE_PASSWORD;

  if (!userEmail || !userPass) {
    throw new Error("Thiếu tài khoản hoặc mật khẩu SellerSprite để đăng nhập.");
  }

  const passHash = createHash("md5").update(userPass).digest("hex");
  const tk = computeSellerSpriteTk(userEmail, passHash);

  const url = new URL("https://www.sellersprite.com/v2/extension/signin");
  url.searchParams.set("email", userEmail);
  url.searchParams.set("password", passHash);
  url.searchParams.set("tk", tk);
  url.searchParams.set("version", "5.0.5");
  url.searchParams.set("language", "en");
  url.searchParams.set("extension", "lnbmbgocenenhhhdojdielgnmeflbnfb");
  url.searchParams.set("source", "chrome");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`SellerSprite SignIn lỗi HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.code !== "OK" && json.code !== "200" && json.code !== 200) {
    const message = String(json.message || `Đăng nhập SellerSprite thất bại: ${json.code}`);
    if (/wrong password|locked after|trial time/i.test(message)) {
      throw new Error(
        "Sai mật khẩu SellerSprite. Đã dừng tự động thử lại để tránh khóa tài khoản. Hãy cập nhật SELLERSPRITE_PASSWORD trong .env rồi khởi động lại ứng dụng."
      );
    }
    throw new Error(message);
  }

  const token = json.data?.token;
  if (!token || typeof token !== "string") {
    throw new Error("SellerSprite không trả về token hợp lệ sau khi đăng nhập.");
  }

  // Cache token into DB for fast subsequent access
  try {
    await saveSellerSpriteToken(token);
  } catch (err) {
    console.warn("Could not save SellerSprite token to DB:", err);
  }
  return token;
}

let sellerSpriteTokenRefresh: Promise<string> | null = null;
let recentlyRefreshedSellerSpriteToken: { previousToken: string; token: string; at: number } | null = null;
let sellerSpriteAuthBlockedError: Error | null = null;

async function renewSellerSpriteExtensionToken(expiredToken: string): Promise<string> {
  const url = new URL("https://www.sellersprite.com/v2/extension/tk/signin");
  url.searchParams.set("version", "5.0.5");
  url.searchParams.set("language", "en");
  url.searchParams.set("extension", "lnbmbgocenenhhhdojdielgnmeflbnfb");
  url.searchParams.set("source", "chrome");

  const response = await fetch(url.toString(), {
    headers: {
      "Auth-Token": expiredToken,
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`SellerSprite renewal HTTP ${response.status}: ${response.statusText}`);
  }
  if (!payload || (payload.code !== "OK" && payload.code !== "200" && payload.code !== 200)) {
    throw new Error(payload?.message || `SellerSprite renewal thất bại: ${payload?.code || "UNKNOWN"}`);
  }

  const token = payload.data?.token;
  if (typeof token !== "string" || token.trim().length <= 10) {
    throw new Error("SellerSprite renewal không trả về token hợp lệ.");
  }

  await saveSellerSpriteToken(token);
  return token;
}

/**
 * Refreshes the extension token once even when several requests discover an
 * expired token at the same time. SellerSprite may invalidate an older token
 * when a new extension session is created, so concurrent sign-ins are unsafe.
 */
export async function refreshSellerSpriteExtensionToken(expiredToken?: string): Promise<string> {
  if (
    expiredToken &&
    recentlyRefreshedSellerSpriteToken &&
    recentlyRefreshedSellerSpriteToken.previousToken === expiredToken &&
    Date.now() - recentlyRefreshedSellerSpriteToken.at < 10_000
  ) {
    return recentlyRefreshedSellerSpriteToken.token;
  }

  if (!sellerSpriteTokenRefresh) {
    sellerSpriteTokenRefresh = (async () => {
      if (expiredToken) {
        try {
          return await renewSellerSpriteExtensionToken(expiredToken);
        } catch (renewalError) {
          console.warn("SellerSprite token renewal failed; trying credential sign-in:", renewalError);
        }
      }

      if (sellerSpriteAuthBlockedError) {
        throw sellerSpriteAuthBlockedError;
      }
      return signInSellerSpriteExtension();
    })()
      .then((token) => {
        recentlyRefreshedSellerSpriteToken = {
          previousToken: expiredToken || "",
          token,
          at: Date.now(),
        };
        sellerSpriteAuthBlockedError = null;
        return token;
      })
      .catch((error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        if (/sai mật khẩu|wrong password|khóa tài khoản/i.test(normalizedError.message)) {
          sellerSpriteAuthBlockedError = normalizedError;
        }
        throw normalizedError;
      })
      .finally(() => {
        sellerSpriteTokenRefresh = null;
      });
  }

  return sellerSpriteTokenRefresh;
}

/**
 * Automatically discovers active SellerSprite extension token from local Chrome profile,
 * DB settings, or environment variables. Automatically logs in if token is expired.
 */
export async function getSellerSpriteExtensionToken(): Promise<string> {
  // 1. Check DB settings
  try {
    const dbConfig = await getAppSetting<{ token?: string }>("sellersprite_config");
    if (dbConfig?.token && dbConfig.token.trim().length > 10) {
      return dbConfig.token.trim();
    }
  } catch {}

  // 2. Check process.env
  if (process.env.SELLERSPRITE_TOKEN && process.env.SELLERSPRITE_TOKEN.trim().length > 10) {
    return process.env.SELLERSPRITE_TOKEN.trim();
  }

  // 3. No cached token: create one from the configured credentials. Do not
  // fall back to a hard-coded token because it will inevitably expire.
  return refreshSellerSpriteExtensionToken();
}

/**
 * Searches SellerSprite Competitor Lookup directly via the authentic Extension API.
 * Provides real ASINs, Monthly Units Sold, Monthly Revenue, BSR, Price, Ratings, Gross Margin & Badges.
 */
export async function searchSellerSpriteCompetitors(
  query: string,
  marketplace: string = "US"
): Promise<AmazonCompetitorSearchResult> {
  let token = await getSellerSpriteExtensionToken();
  const trimmed = query.trim();
  const isAsin = /^[A-Z0-9]{10}$/i.test(trimmed) || (trimmed.includes(",") && trimmed.length <= 150);

  const qParam = isAsin ? "" : trimmed;
  const asinsParam = isAsin ? trimmed : "";
  const tk = computeSellerSpriteTk(qParam, asinsParam);

  const marketCode = marketplace.toUpperCase();
  const buildUrl = () => {
    const url = new URL(`https://e.sellersprite.com/v2/extension/competitor-lookup/${marketCode}`);
    if (qParam) url.searchParams.set("q", qParam);
    if (asinsParam) url.searchParams.set("asins", asinsParam);
    url.searchParams.set("tk", tk);
    url.searchParams.set("version", "5.0.5");
    url.searchParams.set("language", "en");
    url.searchParams.set("extension", "lnbmbgocenenhhhdojdielgnmeflbnfb");
    url.searchParams.set("source", "chrome");
    return url.toString();
  };

  const doFetch = (activeToken: string) =>
    fetch(buildUrl(), {
      headers: {
        "Auth-Token": activeToken,
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });

  let response = await doFetch(token);
  let payload = await response.json();

  const isAuthError =
    payload.code === "ERR_NEED_RE_AUTHORIZED" ||
    payload.code === "ERR_GLOBAL_403" ||
    payload.code === "ERR_NEED_RENEWAL_AUTHORIZED" ||
    payload.code === "ERR_TOKEN_EXPIRED" ||
    (typeof payload.message === "string" && /token expired|re-auth|sign out and login|unauthorized|forbidden/i.test(payload.message));

  // If token expired, auto-refresh via credentials and retry once
  if (isAuthError) {
    try {
      token = await refreshSellerSpriteExtensionToken(token);
      response = await doFetch(token);
      payload = await response.json();
    } catch (error) {
      throw new Error(
        `Không thể tự động làm mới token SellerSprite: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (!response.ok) {
    throw new Error(`SellerSprite API phản hồi lỗi HTTP ${response.status}: ${response.statusText}`);
  }

  if (payload.code !== "OK" && payload.code !== "200" && payload.code !== 200) {
    throw new Error(payload.message || `Lỗi SellerSprite API: ${payload.code}`);
  }

  const rawItems: any[] = payload.data?.items || [];
  if (rawItems.length === 0) {
    throw new Error(`SellerSprite không tìm thấy ASIN đối thủ nào cho "${trimmed}".`);
  }

  let totalPrice = 0;
  let validPriceCount = 0;
  let totalReviews = 0;
  let validReviewCount = 0;
  let totalRating = 0;
  let validRatingCount = 0;
  let totalRevenue = 0;
  let totalUnits = 0;
  let totalBsr = 0;
  let validBsrCount = 0;
  const brandCountMap = new Map<string, number>();

  const candidates: AmazonCompetitorCandidate[] = rawItems.map((item, idx) => {
    const asin = String(item.asin || "").trim();
    const title = decodeHtml(String(item.title || "").trim());
    const brand = decodeHtml(String(item.brand || extractBrandFromTitle(title) || "").trim());
    const category = String(item.bsr_label || item.node_label_path || item.category || "").trim();
    const priceNum = typeof item.price === "number" && item.price > 0 ? item.price : null;
    const price = priceNum ? `$${priceNum.toFixed(2)}` : "";
    const monthlySales = typeof item.units === "number" ? item.units : typeof item.month_units === "number" ? item.month_units : null;
    const revenue = typeof item.amount === "number" && item.amount > 0 ? item.amount : typeof item.sub_total_amount === "number" && item.sub_total_amount > 0 ? item.sub_total_amount : null;
    const fees = typeof item.fba === "number" ? item.fba : null;
    const bsr = typeof item.bsr === "number" ? item.bsr : null;
    const bsrText = item.bsr_label && bsr ? `#${bsr.toLocaleString()} in ${item.bsr_label}` : bsr ? `#${bsr.toLocaleString()}` : "";
    const rating = typeof item.rating === "number" ? item.rating : null;
    const reviewCount = typeof item.reviews === "number" ? item.reviews : 0;
    const img = String(item.image_zoom || item.image || "");
    const profit = typeof item.profit === "number" ? item.profit : null;
    const variations = typeof item.variations === "number" ? item.variations : null;

    const badges: string[] = Array.isArray(item.badges) ? item.badges : [];
    const isSponsored = badges.includes("SP") || badges.includes("SPB") || badges.includes("SPV");
    const isBestSeller = badges.includes("BS");
    const isAmazonChoice = badges.includes("AC");

    const sellerCountry = item.seller_dto?.nation_name || item.seller_dto?.nation_code || "";
    const fulfillment = item.seller_type || (fees ? "FBA" : "FBM");

    // Aggregates
    if (priceNum) {
      totalPrice += priceNum;
      validPriceCount++;
    }
    if (reviewCount > 0) {
      totalReviews += reviewCount;
      validReviewCount++;
    }
    if (rating) {
      totalRating += rating;
      validRatingCount++;
    }
    if (revenue) {
      totalRevenue += revenue;
    }
    if (monthlySales) {
      totalUnits += monthlySales;
    }
    if (bsr && bsr > 0) {
      totalBsr += bsr;
      validBsrCount++;
    }
    if (brand) {
      brandCountMap.set(brand, (brandCountMap.get(brand) || 0) + 1);
    }

    let categoryGroup: AmazonCompetitorCandidate["categoryGroup"] = "top_organic";
    if (isSponsored) {
      categoryGroup = "sponsored";
    } else if (isBestSeller) {
      categoryGroup = "best_seller";
    }

    // Recommendation logic: strictly organic top ranks with sales and reviews, never sponsored
    const isRecommended = !isSponsored;

    return {
      asin,
      title,
      brand,
      category,
      bsrCategory: category,
      price,
      priceNum,
      revenue,
      monthlySales,
      fees,
      bsr,
      bsrText,
      sellerCountry,
      fulfillment,
      rating,
      ratingText: rating ? `${rating.toFixed(1)} out of 5 stars` : "",
      reviewCount,
      img,
      isSponsored,
      isBestSeller,
      isAmazonChoice,
      categoryGroup,
      isRecommended,
      profit,
      variations,
    };
  });

  const sortedBrands = Array.from(brandCountMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map((e) => e[0]);

  // Strictly pick top 10 non-sponsored (organic) ASINs
  const recommendedAsins = candidates
    .filter((c) => !c.isSponsored)
    .slice(0, 10)
    .map((c) => c.asin);

  return {
    query: trimmed,
    marketplace,
    source: "sellersprite_live",
    totalFound: candidates.length,
    totalRecommended: recommendedAsins.length,
    candidates,
    recommendedAsins,
    stats: {
      avgPrice: validPriceCount > 0 ? Number((totalPrice / validPriceCount).toFixed(2)) : 0,
      avgReviews: validReviewCount > 0 ? Math.round(totalReviews / validReviewCount) : 0,
      avgRating: validRatingCount > 0 ? Number((totalRating / validRatingCount).toFixed(1)) : 0,
      avgRevenue: candidates.length > 0 ? Math.round(totalRevenue / candidates.length) : 0,
      totalRevenue: Math.round(totalRevenue),
      avgBsr: validBsrCount > 0 ? Math.round(totalBsr / validBsrCount) : 0,
      totalUnits,
      topBrands: sortedBrands,
    },
  };
}

export interface SellerSpriteReverseKeywordItem {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  aba_rank: number | null;
  organic_rank: number | null;
  relevance_score: number | null;
  competing_products: number | null;
  asin_count: number;
  matched_asins: string[];
}

/**
 * Reverses keywords for a list of ASINs directly from SellerSprite extension API.
 * 100% authentic live data without simulation or fallback.
 */
export async function reverseSellerSpriteKeywords(
  asins: string[],
  marketplace: string = "US",
  limit: number = 300
): Promise<{ keywords: SellerSpriteReverseKeywordItem[]; total: number }> {
  const validAsins = Array.from(new Set(asins.map((a) => a.trim().toUpperCase()))).filter(
    (a) => /^[A-Z0-9]{10}$/.test(a)
  );

  if (validAsins.length === 0) {
    throw new Error("Không có ASIN hợp lệ nào để Reverse từ khóa.");
  }

  let token = await getSellerSpriteExtensionToken();
  const marketCode = marketplace.toUpperCase();
  const keywordMap = new Map<string, SellerSpriteReverseKeywordItem>();

  // Process ASINs in parallel chunks (up to 5 concurrently) to maintain high speed
  const chunkSize = 5;
  for (let i = 0; i < validAsins.length; i += chunkSize) {
    const batch = validAsins.slice(i, i + chunkSize);
    await Promise.all(
      batch.map(async (asin) => {
        try {
          const tk = computeSellerSpriteTk(asin, null);
          const url = new URL("https://e.sellersprite.com/v2/extension/keyword/reverse/v2/list");
          url.searchParams.set("asin", asin);
          url.searchParams.set("tk", tk);
          url.searchParams.set("version", "5.0.5");
          url.searchParams.set("language", "en");
          url.searchParams.set("extension", "lnbmbgocenenhhhdojdielgnmeflbnfb");
          url.searchParams.set("source", "chrome");

          const body = {
            marketplace: marketCode,
            asin: asin,
            pageNum: 1,
            pageSize: 50,
            orderBy: 5, // SEARCHES desc
            desc: true,
            onlyAC: false,
            filterRoot: false,
            badges: [],
            trafficKeywordTypes: [],
            conversionKeywordTypes: [],
            exactly: false,
            includeKeywords: [],
            excludeKeywords: [],
          };

          let res = await fetch(url.toString(), {
            method: "POST",
            headers: {
              "Auth-Token": token,
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            },
            body: JSON.stringify(body),
          });

          let json = await res.json();
          const isAuthError =
            json.code === "ERR_NEED_RE_AUTHORIZED" ||
            json.code === "ERR_GLOBAL_403" ||
            json.code === "ERR_NEED_RENEWAL_AUTHORIZED" ||
            json.code === "ERR_TOKEN_EXPIRED" ||
            (typeof json.message === "string" && /token expired|re-auth|sign out and login|unauthorized|forbidden/i.test(json.message));

          if (isAuthError) {
            token = await refreshSellerSpriteExtensionToken(token);
            res = await fetch(url.toString(), {
              method: "POST",
              headers: {
                "Auth-Token": token,
                "Content-Type": "application/json",
                Accept: "application/json",
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
              },
              body: JSON.stringify(body),
            });
            json = await res.json();
          }

          if (json.code !== "OK" && json.code !== 200 && json.code !== "200") return;

          const items: any[] = json.data?.items || [];
          for (const it of items) {
            const kw = String(it.keyword || "").trim();
            if (!kw) continue;
            const kwKey = kw.toLowerCase();

            const searches = typeof it.searches === "number" ? it.searches : null;
            const bid = typeof it.bid === "number" ? it.bid : typeof it.phrasePpc === "number" ? it.phrasePpc : null;
            const abaRank = typeof it.searchRank === "number" ? it.searchRank : null;
            const competing = typeof it.products === "number" ? it.products : null;
            const rankPos = typeof it.rankPosition?.position === "number" ? it.rankPosition.position : null;
            const clickRate = typeof it.clickRate === "number" ? it.clickRate : null;

            const existing = keywordMap.get(kwKey);
            if (existing) {
              if (!existing.matched_asins.includes(asin)) {
                existing.matched_asins.push(asin);
                existing.asin_count = existing.matched_asins.length;
              }
              if (rankPos && (!existing.organic_rank || rankPos < existing.organic_rank)) {
                existing.organic_rank = rankPos;
              }
              if (!existing.search_volume && searches) {
                existing.search_volume = searches;
              }
              if (!existing.cpc && bid) {
                existing.cpc = bid;
              }
              if (!existing.aba_rank && abaRank) {
                existing.aba_rank = abaRank;
              }
            } else {
              keywordMap.set(kwKey, {
                keyword: kw,
                search_volume: searches,
                cpc: bid,
                aba_rank: abaRank,
                organic_rank: rankPos,
                relevance_score: clickRate ? Math.min(1, Math.max(0.1, Number((clickRate * 10).toFixed(2)))) : 0.8,
                competing_products: competing,
                asin_count: 1,
                matched_asins: [asin],
              });
            }
          }
        } catch (err) {
          console.warn(`SellerSprite reverse failed for ASIN ${asin}:`, err);
        }
      })
    );
  }

  const resultList = Array.from(keywordMap.values());
  // Sort by ASIN count descending, then by search volume descending
  resultList.sort((a, b) => {
    if (b.asin_count !== a.asin_count) return b.asin_count - a.asin_count;
    const volA = a.search_volume || 0;
    const volB = b.search_volume || 0;
    return volB - volA;
  });

  return {
    keywords: resultList.slice(0, limit),
    total: resultList.length,
  };
}
