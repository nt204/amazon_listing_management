import { chromium, type Browser, type Cookie } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getAppSetting, setAppSetting } from "@/lib/db";
import type { RawKeywordMetric } from "@/lib/keyword-research";

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
 * Generate synthetic keyword results when live API is unavailable or mock mode is requested
 */

function generateMockKeywords(query: string, limit: number = 20): SellerSpriteKeywordItem[] {
  const seed = query.toLowerCase().replace(/[^a-z0-9]/g, " ").trim() || "acrylic ornament";
  const modifiers = [
    "gift", "personalized", "custom name", "decorated", "with lights", 
    "for christmas", "memorial", "tree decoration", "bulk set", "clear",
    "double sided", "flat ornament", "craft blank", "hanging", "souvenir",
    "festive", "rustic", "modern", "shatterproof", "vintage"
  ];

  return modifiers.slice(0, limit).map((mod, idx) => {
    const keyword = `${seed} ${mod}`;
    const baseVolume = Math.max(250, 15000 - idx * 650 + Math.floor(Math.random() * 300));
    return {
      keyword,
      search_volume: baseVolume,
      cpc: Number((0.45 + (idx % 5) * 0.25).toFixed(2)),
      aba_rank: (idx + 1) * 1250,
      purchase_rate: Number((0.08 - idx * 0.003).toFixed(3)),
      click_share: Number((0.15 - idx * 0.005).toFixed(3)),
      competing_products: 450 + idx * 80,
      relevance_score: Number((0.95 - idx * 0.03).toFixed(2)),
    };
  });
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
