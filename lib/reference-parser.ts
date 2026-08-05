import type { Marketplace } from "@/lib/types";

const marketplaceDomain: Record<Marketplace, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
};

const asinPattern = /\b(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])\b/gi;
const urlPattern = /https?:\/\/[^\s<>"']+/gi;

export interface ReferenceTarget {
  asin?: string;
  url: string;
}

function isAmazonHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return ["amazon.com", "amazon.co.uk", "amazon.de"].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

function targetFromUrl(rawValue: string): ReferenceTarget | null {
  const rawUrl = rawValue.replace(/[),.;]+$/g, "");
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !isAmazonHostname(url.hostname)) return null;
    const asin = url.pathname.match(asinPattern)?.[0]?.toUpperCase();
    url.search = "";
    url.hash = "";
    url.pathname = asin ? `/dp/${asin}` : url.pathname;
    return { asin, url: url.toString() };
  } catch {
    return null;
  }
}

export function resolveReferenceTargets(
  value: string,
  marketplace: Marketplace,
  maxReferences = 3,
) {
  const targets: ReferenceTarget[] = [];
  const seen = new Set<string>();
  const add = (target: ReferenceTarget | null) => {
    if (!target || seen.has(target.url) || targets.length >= maxReferences) return;
    seen.add(target.url);
    targets.push(target);
  };

  const urls = value.match(urlPattern) || [];
  for (const rawUrl of urls) add(targetFromUrl(rawUrl));

  const withoutUrls = value.replace(urlPattern, " ");
  for (const match of withoutUrls.match(asinPattern) || []) {
    const asin = match.toUpperCase();
    add({ asin, url: `https://${marketplaceDomain[marketplace]}/dp/${asin}` });
  }

  return targets;
}
