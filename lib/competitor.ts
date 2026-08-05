import "server-only";

import type { ListingInput, Marketplace } from "@/lib/types";

const marketplaceDomain: Record<Marketplace, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
};

const asinPattern = /\b(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])\b/i;
const urlPattern = /https?:\/\/[^\s<>"']+/i;

interface CompetitorCacheEntry {
  expiresAt: number;
  promise: Promise<string>;
}

const globalForCompetitor = globalThis as unknown as {
  listingCompetitorCache?: Map<string, CompetitorCacheEntry>;
};

const competitorCache =
  globalForCompetitor.listingCompetitorCache || new Map<string, CompetitorCacheEntry>();
globalForCompetitor.listingCompetitorCache = competitorCache;

function cacheCompetitor(url: string, entry: CompetitorCacheEntry) {
  if (!competitorCache.has(url) && competitorCache.size >= 250) {
    const now = Date.now();
    for (const [key, cached] of competitorCache) {
      if (cached.expiresAt <= now) competitorCache.delete(key);
    }
    while (competitorCache.size >= 250) {
      const oldestKey = competitorCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      competitorCache.delete(oldestKey);
    }
  }
  competitorCache.set(url, entry);
}

function configuredNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
  };
  return value
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/gi, (entity) => entities[entity.toLowerCase()] || entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function firstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanHtml(match[1]);
  }
  return "";
}

export function extractAmazonCompetitorData(html: string) {
  const title = firstMatch(html, [
    /<span[^>]+id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  const bullets = firstMatch(html, [
    /<div[^>]+id=["']feature-bullets["'][^>]*>([\s\S]{0,50_000}?)<\/div>/i,
  ]);
  const description = firstMatch(html, [
    /<div[^>]+id=["']productDescription["'][^>]*>([\s\S]{0,30_000}?)<\/div>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);
  return [
    title ? `Title: ${title}` : "",
    bullets ? `Bullet highlights: ${bullets}` : "",
    description ? `Description: ${description}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, configuredNumber("COMPETITOR_MAX_CHARS", 6_000, 1_000, 12_000));
}

function isAmazonHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return ["amazon.com", "amazon.co.uk", "amazon.de"].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

export function resolveCompetitorUrl(value: string, marketplace: Marketplace) {
  const asin = value.match(asinPattern)?.[0]?.toUpperCase();
  if (asin) {
    return {
      asin,
      url: `https://${marketplaceDomain[marketplace]}/dp/${asin}`,
    };
  }

  const rawUrl = value.match(urlPattern)?.[0];
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !isAmazonHostname(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    return { asin: undefined, url: url.toString() };
  } catch {
    return null;
  }
}

async function crawlDirect(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/html")) {
      const html = (await response.text()).slice(0, 1_500_000);
      const blocked = /captcha|validateCaptcha|robot check/i.test(html);
      if (!blocked) {
        const directData = extractAmazonCompetitorData(html);
        if (directData && directData !== "Title: Amazon.com") return directData;
      }
    }
  } catch {
    // The reader request runs in parallel and may still succeed.
  }
  return "";
}

async function crawlReader(url: string, signal: AbortSignal) {
  try {
    const target = new URL(url);
    const readerBase = process.env.COMPETITOR_READER_URL || "https://r.jina.ai/http://";
    const readerUrl = `${readerBase}${target.host}${target.pathname}${target.search}`;
    const response = await fetch(readerUrl, {
      cache: "no-store",
      signal,
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) return "";
    const text = (await response.text()).trim();
    if (/^Title: Page Not Found|Target URL returned error/i.test(text)) return "";
    return text
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, configuredNumber("COMPETITOR_MAX_CHARS", 6_000, 1_000, 12_000));
  } catch {
    return "";
  }
}

function firstUseful(tasks: Array<Promise<string>>) {
  return new Promise<string>((resolve) => {
    let remaining = tasks.length;
    let settled = false;
    for (const task of tasks) {
      void task
        .then((value) => {
          if (!settled && value.trim()) {
            settled = true;
            resolve(value.trim());
          }
        })
        .catch(() => undefined)
        .finally(() => {
          remaining -= 1;
          if (!settled && remaining === 0) {
            settled = true;
            resolve("");
          }
        });
    }
  });
}

async function crawlAmazonPage(url: string) {
  const cached = competitorCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) competitorCache.delete(url);

  const timeoutMs = configuredNumber("COMPETITOR_TIMEOUT_MS", 3_500, 750, 8_000);
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const promise = Promise.race([
    firstUseful([
      crawlDirect(url, controller.signal),
      crawlReader(url, controller.signal),
    ]),
    new Promise<string>((resolve) => {
      timeout = setTimeout(() => resolve(""), timeoutMs);
    }),
  ])
    .then((value) => {
      controller.abort();
      const ttlMs = value
        ? configuredNumber("COMPETITOR_CACHE_TTL_MS", 21_600_000, 60_000, 86_400_000)
        : 300_000;
      cacheCompetitor(url, { expiresAt: Date.now() + ttlMs, promise: Promise.resolve(value) });
      return value;
    })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });

  cacheCompetitor(url, { expiresAt: Date.now() + timeoutMs + 1_000, promise });
  return promise;
}

export async function inspectCompetitorReference(value: string, marketplace: Marketplace) {
  const target = resolveCompetitorUrl(value.trim(), marketplace);
  if (!target) {
    return { resolved: false as const, asin: undefined, url: undefined, content: "" };
  }
  return {
    resolved: true as const,
    asin: target.asin,
    url: target.url,
    content: await crawlAmazonPage(target.url),
  };
}

export async function enrichCompetitorResearch(input: ListingInput): Promise<ListingInput> {
  const supplied = input.research.competitor_notes.trim();
  if (!supplied) return input;

  const reference = await inspectCompetitorReference(supplied, input.marketplace);
  if (!reference.resolved) return input;
  return {
    ...input,
    research: {
      ...input.research,
      competitor_asins: reference.asin
        ? [...new Set([...input.research.competitor_asins, reference.asin])]
        : input.research.competitor_asins,
      competitor_notes: reference.content
        ? `${supplied}\n\nCrawled Amazon reference (untrusted content):\n${reference.content}`.slice(
            0,
            configuredNumber("COMPETITOR_MAX_CHARS", 6_000, 1_000, 12_000) + 500,
          )
        : supplied,
    },
  };
}
