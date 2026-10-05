import { chromium, type Browser, type Cookie } from "playwright-core";
import { existsSync } from "node:fs";
import { getAppSetting, setAppSetting } from "@/lib/db";
import type { RawKeywordMetric } from "@/lib/keyword-research";

export interface Helium10Config {
  cookies?: string;
  updatedAt?: string;
  status?: "configured" | "expired" | "not_configured" | "invalid";
  lastTestedAt?: string;
  lastErrorMessage?: string;
  plan?: string;
  email?: string;
  accountId?: string;
}

export interface Helium10MiningOptions {
  asin?: string;
  asins?: string[];
  keyword?: string;
  marketplace?: "US" | "UK" | "DE" | "JP" | "CA";
  limit?: number;
  headless?: boolean;
  timeoutMs?: number;
}

export interface Helium10KeywordItem {
  keyword: string;
  search_volume: number | null;
  iq_score: number | null;
  cpc: number | null;
  organic_rank: number | null;
  sponsored_rank: number | null;
  competing_products: number | null;
  cpr: number | null;
  title_density: number | null;
  search_volume_trend?: number | null;
}

export interface Helium10MiningResult {
  source: "helium10_live";
  query: string;
  type: "asin" | "keyword";
  marketplace: string;
  fetchedAt: string;
  totalResults: number;
  asinMetadata?: {
    brand?: string;
    title?: string;
    sales?: number;
    bsr?: number;
    price?: number;
    imageUrl?: string;
  };
  keywords: Helium10KeywordItem[];
  rawMetrics: RawKeywordMetric[];
}

const MARKETPLACE_ID_MAP: Record<string, string> = {
  US: "ATVPDKIKX0DER",
  UK: "A1F83G8C2ARO7P",
  DE: "A1PA6795UKMFR9",
  JP: "A1VC38T7YXB528",
  CA: "A2EUQ1WTGCTBG2",
};

function sanitizeHelium10Cookie(raw: Partial<Cookie> & Record<string, unknown>): Cookie {
  const name = String(raw.name || "").trim();
  const value = String(raw.value || "").trim();
  let domain = String(raw.domain || ".helium10.com").trim();

  if (!domain.includes("helium10")) {
    domain = ".helium10.com";
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

export function parseHelium10Cookies(rawCookiesInput?: string): Cookie[] {
  const cookies: Cookie[] = [];
  if (!rawCookiesInput?.trim()) return cookies;

  const trimmed = rawCookiesInput.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.name && item.value) {
            cookies.push(sanitizeHelium10Cookie(item));
          }
        }
      }
    } catch {
      // Fall back to header parsing
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
            sanitizeHelium10Cookie({
              name,
              value,
              domain: ".helium10.com",
            }),
          );
        }
      }
    }
  }

  return cookies;
}

export function buildHelium10CookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function getHelium10PlaywrightConfig(): Promise<Helium10Config> {
  try {
    const setting = await getAppSetting<Helium10Config>("helium10_config");
    if (setting?.cookies?.trim()) {
      return setting;
    }
  } catch {}

  const envCookie = process.env.HELIUM10_COOKIES?.trim();
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

/**
 * Validates Helium 10 cookies against live authenticated APIs.
 */
export async function validateHelium10Session(rawCookiesInput?: string): Promise<{
  valid: boolean;
  plan?: string;
  email?: string;
  accountId?: string;
  error?: string;
}> {
  const cookies = parseHelium10Cookies(rawCookiesInput);
  if (cookies.length === 0) {
    return { valid: false, error: "Định dạng cookie không hợp lệ." };
  }

  const cookieHeader = buildHelium10CookieHeader(cookies);

  try {
    const siteTokenRes = await fetch("https://members.helium10.com/api/v1/site/token", {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (siteTokenRes.status === 401 || siteTokenRes.status === 403) {
      return {
        valid: false,
        error: "Cookie Helium 10 đã hết hạn hoặc không có quyền truy cập. Vui lòng đăng nhập lại.",
      };
    }

    const tokenJson = await siteTokenRes.json().catch(() => null);
    const token = tokenJson?.data?.token;
    const accountId = String(tokenJson?.data?.account?.id || tokenJson?.data?.user?.id || "");

    // Also fetch sales estimator to check subscription plan
    const salesRes = await fetch(
      "https://members.helium10.com/black-box/sales-estimator?asin=B0D1XD1ZV3&marketplace=ATVPDKIKX0DER",
      {
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(8000),
      },
    );

    const salesJson = await salesRes.json().catch(() => null);
    const plan = salesJson?.userData?.plan || "Helium 10 Active";

    if (token) {
      return {
        valid: true,
        plan,
        accountId: accountId || undefined,
      };
    }

    return {
      valid: false,
      error: "Không thể xác thực với Helium 10 API. Vui lòng kiểm tra lại Cookie.",
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Lỗi kết nối tới Helium 10.",
    };
  }
}

export async function saveHelium10PlaywrightCookies(rawCookies: string): Promise<Helium10Config> {
  const parsed = parseHelium10Cookies(rawCookies);
  if (parsed.length === 0) {
    throw new Error(
      "Format cookie không hợp lệ. Vui lòng dán chuỗi JSON cookie hoặc chuỗi Cookie header (key=value; ...)."
    );
  }

  const check = await validateHelium10Session(rawCookies);
  if (!check.valid) {
    throw new Error(check.error || "Cookie Helium 10 không hợp lệ hoặc đã hết hạn.");
  }

  const config: Helium10Config = {
    cookies: rawCookies.trim(),
    updatedAt: new Date().toISOString(),
    status: "configured",
    lastTestedAt: new Date().toISOString(),
    plan: check.plan,
    accountId: check.accountId,
  };

  await setAppSetting("helium10_config", config as unknown as Record<string, unknown>);
  return config;
}

/**
 * Gets authentication tokens (site token + Pacvue bearer token) from Helium 10.
 */
async function getHelium10ApiTokens(cookieHeader: string, accountIdHint?: string) {
  const url = accountIdHint
    ? `https://members.helium10.com/api/v1/site/token?accountId=${accountIdHint}`
    : "https://members.helium10.com/api/v1/site/token";

  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`Helium 10 site token request failed with status ${res.status}`);
  }

  const json = await res.json();
  const token = json?.data?.token;
  const pacvueToken = json?.data?.pacvueToken;
  const accountId = String(json?.data?.account?.id || json?.data?.user?.id || accountIdHint || "");

  if (!token || !pacvueToken) {
    throw new Error("Không thể trích xuất token API Helium 10 từ phiên đăng nhập.");
  }

  return { token, pacvueToken, accountId };
}

/**
 * Direct REST API implementation of Cerebro Reverse ASIN (Server-ready, Headless, Blazing Fast).
 */
async function fetchCerebroDirectApi(
  asin: string,
  cookieHeader: string,
  marketplaceCode: string,
  limit: number,
  accountIdHint?: string,
): Promise<{
  keywords: Helium10KeywordItem[];
  asinMetadata?: Helium10MiningResult["asinMetadata"];
}> {
  const { token, pacvueToken, accountId } = await getHelium10ApiTokens(cookieHeader, accountIdHint);
  const mpId = MARKETPLACE_ID_MAP[marketplaceCode] || MARKETPLACE_ID_MAP.US;

  // 1. Fetch ASIN metadata concurrently
  const [salesRes, calcRes] = await Promise.all([
    fetch(
      `https://members.helium10.com/black-box/sales-estimator?asin=${encodeURIComponent(asin)}&marketplace=${mpId}`,
      {
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(8000),
      },
    ).catch(() => null),
    fetch(
      `https://members.helium10.com/extension/calculator-v2?asin=${encodeURIComponent(asin)}&marketplace=${mpId}`,
      {
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(8000),
      },
    ).catch(() => null),
  ]);

  const salesData = salesRes && salesRes.ok ? await salesRes.json().catch(() => null) : null;
  const calcData = calcRes && calcRes.ok ? await calcRes.json().catch(() => null) : null;

  let mainBsr: number | undefined = undefined;
  if (calcData?.bsrList && typeof calcData.bsrList === "object") {
    const bsrValues = Object.values(calcData.bsrList) as number[];
    if (bsrValues.length > 0) mainBsr = bsrValues[bsrValues.length - 1];
  }

  const asinMetadata: Helium10MiningResult["asinMetadata"] = {
    brand: calcData?.brand || undefined,
    title: calcData?.title || undefined,
    sales: typeof salesData?.last30DaysSales === "number" ? salesData.last30DaysSales : undefined,
    bsr: mainBsr,
    price: calcData?.price || calcData?.listPrice || undefined,
    imageUrl: calcData?.imageUrl || undefined,
  };

  // 2. POST create Cerebro search
  const createSearchUrl = `https://h10api.pacvue.com/rta/cerebro/v1/amazon/search/single?accountId=${accountId}`;
  const createRes = await fetch(createSearchUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "x-pacvue-token": "Bearer " + pacvueToken,
      referer: `https://members.helium10.com/cerebro-new?accountId=${accountId}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      productId: asin,
      marketplace: mpId,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`Cerebro search creation failed (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const createJson = await createRes.json();
  const searchId = createJson?.data?.id;
  if (!searchId) {
    throw new Error("Không nhận được searchId từ Helium 10 Cerebro.");
  }

  if (createJson.data.title && !asinMetadata.title) asinMetadata.title = createJson.data.title;
  if (createJson.data.imageUrl && !asinMetadata.imageUrl) asinMetadata.imageUrl = createJson.data.imageUrl;

  // 3. Poll and retrieve keyword table data
  let tableData: any[] = [];
  const pageSize = Math.min(Math.max(limit, 50), 200);

  for (let attempt = 1; attempt <= 12; attempt++) {
    const dataUrl = `https://h10api.pacvue.com/rta/cerebro/v1/amazon/search/single/${searchId}/data?accountId=${accountId}&include-all=0&include-any=1&page=1&per_page=${pageSize}&sort=default`;
    const dataRes = await fetch(dataUrl, {
      headers: {
        authorization: "Bearer " + token,
        "x-pacvue-token": "Bearer " + pacvueToken,
        referer: `https://members.helium10.com/cerebro-new/find-by-product/amazon/view/${searchId}?accountId=${accountId}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (dataRes.ok) {
      const dataJson = await dataRes.json();
      if (Array.isArray(dataJson?.data?.tableData) && dataJson.data.tableData.length > 0) {
        tableData = dataJson.data.tableData;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (tableData.length === 0) {
    throw new Error("Không có từ khóa nào được trả về từ Helium 10 Cerebro cho ASIN này.");
  }

  const keywords: Helium10KeywordItem[] = tableData.slice(0, limit).map((row) => {
    const rawVolume = typeof row.impressionExact30 === "number" ? row.impressionExact30 : (typeof row.searchVolume === "number" ? row.searchVolume : null);
    const rawCpc = typeof row.cpc === "number" ? (row.cpc > 50 ? row.cpc / 100 : row.cpc) : null;

    return {
      keyword: String(row.phrase || row.keyword || "").trim(),
      search_volume: rawVolume,
      iq_score: typeof row.iq === "number" ? Math.round(row.iq) : (typeof row.iq_score === "number" ? Math.round(row.iq_score) : null),
      cpc: rawCpc,
      organic_rank: typeof row.organicPosition === "number" ? row.organicPosition : (typeof row.organic_rank === "number" ? row.organic_rank : null),
      sponsored_rank: typeof row.sponsoredPosition === "number" ? row.sponsoredPosition : null,
      competing_products: typeof row.resultsNumber === "number" ? row.resultsNumber : null,
      cpr: typeof row.newCprExact === "number" ? Math.round(row.newCprExact) : null,
      title_density: typeof row.exactTitleMatchProductsCount === "number" ? row.exactTitleMatchProductsCount : null,
      search_volume_trend: typeof row.searchVolumeTrend30 === "number" ? row.searchVolumeTrend30 : null,
    };
  }).filter((k) => k.keyword.length > 0);

  return { keywords, asinMetadata };
}

/**
 * Direct REST API implementation of Magnet Seed Keyword (Server-ready, Headless, Blazing Fast).
 */
async function fetchMagnetDirectApi(
  keyword: string,
  cookieHeader: string,
  marketplaceCode: string,
  limit: number,
  accountIdHint?: string,
): Promise<{ keywords: Helium10KeywordItem[] }> {
  const { token, pacvueToken, accountId } = await getHelium10ApiTokens(cookieHeader, accountIdHint);
  const mpId = MARKETPLACE_ID_MAP[marketplaceCode] || MARKETPLACE_ID_MAP.US;

  // 1. POST create Magnet search
  const createSearchUrl = `https://h10api.pacvue.com/rta/magnet/v1/amazon/search/single?accountId=${accountId}`;
  const createRes = await fetch(createSearchUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "x-pacvue-token": "Bearer " + pacvueToken,
      referer: `https://members.helium10.com/magnet?accountId=${accountId}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      keyword,
      marketplace: mpId,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`Magnet search creation failed (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const createJson = await createRes.json();
  const searchId = createJson?.data?.id;
  if (!searchId) {
    throw new Error("Không nhận được searchId từ Helium 10 Magnet.");
  }

  // 2. Poll and retrieve keyword table data
  let tableData: any[] = [];
  const pageSize = Math.min(Math.max(limit, 50), 200);

  for (let attempt = 1; attempt <= 12; attempt++) {
    const dataUrl = `https://h10api.pacvue.com/rta/magnet/v1/amazon/search/single/${searchId}/results?accountId=${accountId}&page=1&per_page=${pageSize}`;
    const dataRes = await fetch(dataUrl, {
      headers: {
        authorization: "Bearer " + token,
        "x-pacvue-token": "Bearer " + pacvueToken,
        referer: `https://members.helium10.com/magnet/search/single/${searchId}?accountId=${accountId}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (dataRes.ok) {
      const dataJson = await dataRes.json();
      if (Array.isArray(dataJson?.data?.tableData) && dataJson.data.tableData.length > 0) {
        tableData = dataJson.data.tableData;
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (tableData.length === 0) {
    throw new Error("Không có từ khóa nào được trả về từ Helium 10 Magnet cho cụm từ khóa này.");
  }

  const keywords: Helium10KeywordItem[] = tableData.slice(0, limit).map((row) => {
    const rawVolume = typeof row.impressionExact30 === "number" ? row.impressionExact30 : (typeof row.searchVolume === "number" ? row.searchVolume : null);
    const rawCpc = typeof row.cpc === "number" ? (row.cpc > 50 ? row.cpc / 100 : row.cpc) : null;

    return {
      keyword: String(row.phrase || row.keyword || "").trim(),
      search_volume: rawVolume,
      iq_score: typeof row.iq === "number" ? Math.round(row.iq) : null,
      cpc: rawCpc,
      organic_rank: typeof row.position === "number" ? row.position : null,
      sponsored_rank: null,
      competing_products: typeof row.resultsNumber === "number" ? row.resultsNumber : null,
      cpr: typeof row.newCprExact === "number" ? Math.round(row.newCprExact) : null,
      title_density: typeof row.exactTitleMatchProductsCount === "number" ? row.exactTitleMatchProductsCount : null,
      search_volume_trend: typeof row.searchVolumeTrend30 === "number" ? row.searchVolumeTrend30 : null,
    };
  }).filter((k) => k.keyword.length > 0);

  return { keywords };
}

/**
 * Finds Chromium executable path across macOS and Linux servers.
 */
function resolveChromiumExecutablePath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH && existsSync(process.env.PLAYWRIGHT_CHROMIUM_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidatePaths = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // Linux VPS / Debian / Ubuntu / Docker
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];

  for (const p of candidatePaths) {
    if (existsSync(p)) return p;
  }

  return undefined;
}

/**
 * Main Helium 10 Keyword Mining entry point.
 * Uses Direct REST API by default (100% headless, server-friendly, 1.5s execution),
 * and falls back to Playwright if needed.
 */
export async function mineHelium10Keywords(
  options: Helium10MiningOptions
): Promise<Helium10MiningResult> {
  const asinsList = Array.isArray(options.asins) ? options.asins.filter(Boolean) : [];
  const query = (
    asinsList.length > 0 ? asinsList[0] : (options.asin || options.keyword || "")
  ).trim();
  const searchType: "asin" | "keyword" =
    asinsList.length > 0 || options.asin || /^B[A-Z0-9]{9}$/i.test(query) ? "asin" : "keyword";
  const marketplace = options.marketplace || "US";
  const limit = options.limit || 500;

  if (!query) {
    throw new Error("Vui lòng cung cấp ASIN hoặc Seed Keyword để đào từ khóa Helium 10.");
  }

  const config = await getHelium10PlaywrightConfig();
  if (!config.cookies) {
    throw new Error(
      "Chưa cấu hình Cookie Helium 10. Vui lòng bấm 'Cấu hình Cookie H10' ở góc trên để dán Cookie đăng nhập Helium 10."
    );
  }

  const cookies = parseHelium10Cookies(config.cookies);
  if (cookies.length === 0) {
    throw new Error(
      "Cookie Helium 10 không khả dụng hoặc đã hỏng. Vui lòng cập nhật Cookie trong phần Cấu hình Cookie."
    );
  }

  const cookieHeader = buildHelium10CookieHeader(cookies);

  // --- STRATEGY 1: Pure Direct Authenticated REST API (Primary, Blazing Fast & Server-Ready) ---
  try {
    if (searchType === "asin") {
      const apiResult = await fetchCerebroDirectApi(
        query,
        cookieHeader,
        marketplace,
        limit,
        config.accountId,
      );

      const rawMetrics: RawKeywordMetric[] = apiResult.keywords.map((k) => ({
        keyword: k.keyword,
        searchVolume: k.search_volume ?? undefined,
        relevance: k.iq_score ? Math.min(100, Math.max(10, Math.round(k.iq_score / 100))) : undefined,
        cpc: k.cpc ?? undefined,
        source: "helium10" as const,
      }));

      return {
        source: "helium10_live",
        query,
        type: "asin",
        marketplace,
        fetchedAt: new Date().toISOString(),
        totalResults: apiResult.keywords.length,
        asinMetadata: apiResult.asinMetadata,
        keywords: apiResult.keywords,
        rawMetrics,
      };
    } else {
      const apiResult = await fetchMagnetDirectApi(
        query,
        cookieHeader,
        marketplace,
        limit,
        config.accountId,
      );

      const rawMetrics: RawKeywordMetric[] = apiResult.keywords.map((k) => ({
        keyword: k.keyword,
        searchVolume: k.search_volume ?? undefined,
        relevance: k.iq_score ? Math.min(100, Math.max(10, Math.round(k.iq_score / 100))) : undefined,
        cpc: k.cpc ?? undefined,
        source: "helium10" as const,
      }));

      return {
        source: "helium10_live",
        query,
        type: "keyword",
        marketplace,
        fetchedAt: new Date().toISOString(),
        totalResults: apiResult.keywords.length,
        keywords: apiResult.keywords,
        rawMetrics,
      };
    }
  } catch (directApiErr) {
    console.warn("[Helium 10] Direct API attempt failed, trying browser automation fallback:", directApiErr);
  }

  // --- STRATEGY 2: Playwright Headless Browser Fallback ---
  let browser: Browser | null = null;
  let extractedKeywords: Helium10KeywordItem[] = [];
  let asinMetadata: Helium10MiningResult["asinMetadata"] = undefined;

  try {
    const executablePath = resolveChromiumExecutablePath();
    browser = await chromium.launch({
      headless: options.headless ?? true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-web-security",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    let interceptedKeywordsList: unknown[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (
        (url.includes("cerebro") || url.includes("magnet") || url.includes("pacvue.com")) &&
        !url.includes(".js") &&
        !url.includes(".css") &&
        !url.includes(".png")
      ) {
        try {
          const json = await response.json();
          const list =
            json?.data?.tableData ||
            json?.data?.items ||
            json?.data?.list ||
            json?.keywords ||
            (Array.isArray(json?.data) ? json.data : null);

          if (Array.isArray(list) && list.length > 0) {
            interceptedKeywordsList = list;
          }
        } catch {}
      }
    });

    const targetUrl = "https://members.helium10.com/cerebro-new";
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs || 35000,
    });

    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    if (currentUrl.includes("/user/signin") || currentUrl.includes("/login")) {
      throw new Error(
        "Cookie Helium 10 đã hết hạn hoặc chưa đăng nhập. Vui lòng bấm 'Cấu hình Cookie H10' để dán Cookie mới."
      );
    }

    // Wait up to 10 seconds for intercepted keywords
    for (let i = 0; i < 10; i++) {
      if (interceptedKeywordsList.length > 0) break;
      await page.waitForTimeout(1000);
    }

    if (interceptedKeywordsList.length > 0) {
      extractedKeywords = interceptedKeywordsList.slice(0, limit).map((row: any) => ({
        keyword: String(row.phrase || row.keyword || "").trim(),
        search_volume: typeof row.impressionExact30 === "number" ? row.impressionExact30 : (typeof row.searchVolume === "number" ? row.searchVolume : null),
        iq_score: typeof row.iq === "number" ? Math.round(row.iq) : null,
        cpc: typeof row.cpc === "number" ? (row.cpc > 50 ? row.cpc / 100 : row.cpc) : null,
        organic_rank: typeof row.organicPosition === "number" ? row.organicPosition : (typeof row.position === "number" ? row.position : null),
        sponsored_rank: typeof row.sponsoredPosition === "number" ? row.sponsoredPosition : null,
        competing_products: typeof row.resultsNumber === "number" ? row.resultsNumber : null,
        cpr: typeof row.newCprExact === "number" ? Math.round(row.newCprExact) : null,
        title_density: typeof row.exactTitleMatchProductsCount === "number" ? row.exactTitleMatchProductsCount : null,
        search_volume_trend: typeof row.searchVolumeTrend30 === "number" ? row.searchVolumeTrend30 : null,
      })).filter((k) => k.keyword.length > 0);
    }

    await context.close();
  } catch (err) {
    console.error("[Helium 10] Fallback error:", err);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  if (extractedKeywords.length === 0) {
    throw new Error(
      "Không thể lấy dữ liệu từ Helium 10 Cerebro/Magnet. Vui lòng kiểm tra lại Cookie đăng nhập Helium 10 bằng cách bấm 'Cài đặt Cookie H10'."
    );
  }

  const rawMetrics: RawKeywordMetric[] = extractedKeywords.map((k) => ({
    keyword: k.keyword,
    searchVolume: k.search_volume ?? undefined,
    relevance: k.iq_score ? Math.min(100, Math.max(10, Math.round(k.iq_score / 100))) : undefined,
    cpc: k.cpc ?? undefined,
    source: "helium10" as const,
  }));

  return {
    source: "helium10_live",
    query,
    type: searchType,
    marketplace,
    fetchedAt: new Date().toISOString(),
    totalResults: extractedKeywords.length,
    asinMetadata,
    keywords: extractedKeywords,
    rawMetrics,
  };
}
