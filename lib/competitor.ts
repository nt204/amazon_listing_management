import "server-only";

import type { ListingInput, Marketplace } from "@/lib/types";

const marketplaceDomain: Record<Marketplace, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
};

const asinPattern = /\b(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])\b/i;
const urlPattern = /https?:\/\/[^\s<>"']+/i;

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
    .slice(0, 12_000);
}

function isAmazonHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return ["amazon.com", "amazon.co.uk", "amazon.de"].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function resolveCompetitorUrl(value: string, marketplace: Marketplace) {
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
    return { asin: undefined, url: url.toString() };
  } catch {
    return null;
  }
}

async function crawlAmazonPage(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
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
    // Amazon commonly returns an anti-bot page. The reader fallback below handles it.
  } finally {
    clearTimeout(timeout);
  }

  const readerController = new AbortController();
  const readerTimeout = setTimeout(() => readerController.abort(), 12_000);
  try {
    const target = new URL(url);
    const readerBase = process.env.COMPETITOR_READER_URL || "https://r.jina.ai/http://";
    const readerUrl = `${readerBase}${target.host}${target.pathname}${target.search}`;
    const response = await fetch(readerUrl, {
      cache: "no-store",
      signal: readerController.signal,
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) return "";
    const text = (await response.text()).trim();
    if (/^Title: Page Not Found|Target URL returned error/i.test(text)) return "";
    return text.slice(0, 14_000);
  } catch {
    return "";
  } finally {
    clearTimeout(readerTimeout);
  }
}

export async function enrichCompetitorResearch(input: ListingInput): Promise<ListingInput> {
  const supplied = input.research.competitor_notes.trim();
  if (!supplied) return input;

  const target = resolveCompetitorUrl(supplied, input.marketplace);
  if (!target) return input;

  const crawled = await crawlAmazonPage(target.url);
  return {
    ...input,
    research: {
      ...input.research,
      competitor_asins: target.asin
        ? [...new Set([...input.research.competitor_asins, target.asin])]
        : input.research.competitor_asins,
      competitor_notes: crawled
        ? `${supplied}\n\nCrawled Amazon reference (untrusted content):\n${crawled}`.slice(0, 20_000)
        : supplied,
    },
  };
}
