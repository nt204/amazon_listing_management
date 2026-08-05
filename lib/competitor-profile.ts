import { operatorEvidence } from "@/lib/product-brief";
import type {
  CompetitorClaim,
  CompetitorKeywordSignal,
  CompetitorProfile,
  CompetitorSignal,
  ListingInput,
} from "@/lib/types";

export interface CrawledReference {
  asin?: string;
  url: string;
  content: string;
}

const audienceNouns =
  "dads?|fathers?|moms?|mothers?|parents?|grandmas?|grandpas?|wives|husbands|nurses?|teachers?|lovers?|owners?|friends?|coworkers?|men|women|kids?|boys?|girls?";
const occasions = [
  "Father's Day",
  "Mother's Day",
  "Valentine's Day",
  "Nurse Week",
  "Birthday",
  "Christmas",
  "Graduation",
  "Anniversary",
  "Retirement",
];
const careAndPerformanceClaims = [
  ["Dishwasher safe", "care"],
  ["Microwave safe", "care"],
  ["Hand wash only", "care"],
  ["BPA free", "care"],
  ["Leakproof", "performance"],
  ["Fade resistant", "performance"],
  ["Scratch resistant", "performance"],
  ["Heat resistant", "performance"],
  ["Weather resistant", "performance"],
  ["Drop proof", "performance"],
  ["Reusable", "performance"],
  ["Comfortable", "performance"],
  ["Durable", "performance"],
  ["Long lasting", "performance"],
  ["Premium quality", "performance"],
  ["Sturdy", "performance"],
] as const;

function cleanText(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_#|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,\-–—]+|[\s:;,\-–—]+$/g, "")
    .trim();
}

function normalize(value: string) {
  return cleanText(value)
    .toLowerCase()
    .replace(/fluid ounces?|fl\.?\s*oz\.?/g, "oz")
    .replace(/ounces?/g, "oz")
    .replace(/\b(\d+(?:\.\d+)?)\s+(oz|ml|l)\b/g, "$1$2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), cleanText(value)])).values()];
}

function sourceId(reference: CrawledReference) {
  return reference.asin || reference.url;
}

function extractTitle(content: string) {
  const titleLine = content.match(/^Title:\s*(.+)$/im)?.[1];
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  return (titleLine || heading || "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*:\s*Amazon\.[^:]+(?::.*)?$/i, "");
}

function extractAttributes(content: string) {
  const attributes: Record<string, string> = {};
  const labels: Array<[string, RegExp]> = [
    ["brand", /^(?:Brand|Manufacturer)\s*:?[ \t]+(.+)$/i],
    ["material", /^Material\s*:?[ \t]+(.+)$/i],
    ["color", /^(?:Colour|Color)(?: Name)?\s*:?[ \t]+(.+)$/i],
    ["capacity", /^(?:Capacity|Size|Size Name)\s*:?[ \t]+(.+)$/i],
    ["special_feature", /^Special feature\s*:?[ \t]+(.+)$/i],
  ];
  for (const rawLine of content.split(/\n+/)) {
    const line = cleanText(rawLine);
    for (const [key, pattern] of labels) {
      const match = line.match(pattern);
      const value = cleanText(match?.[1] || "").slice(0, 120);
      const invalidBrand = key === "brand" && /amazon|category|registry|warranty|may not apply/i.test(value);
      if (value && !invalidBrand && !attributes[key]) attributes[key] = value;
    }
  }
  if (!attributes.brand) {
    const store = content.match(/Visit the ([^\]\n]{1,80}) Store/i)?.[1];
    if (store) attributes.brand = cleanText(store);
  }
  return attributes;
}

const nonBrandTitleLeaders = new Set([
  "best", "fun", "funny", "cute", "novelty", "unique", "personalized", "custom", "retro",
  "ceramic", "steel", "stainless", "glass", "plastic", "wood", "wooden", "cotton", "white",
  "black", "blue", "red", "pink", "green", "large", "small", "mini", "premium", "official",
  "coffee", "tea", "travel", "birthday", "christmas", "fathers", "mothers",
]);

export function inferCompetitorBrandFromTitle(title: string, input: ListingInput) {
  const cleaned = cleanText(title);
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  const mainKeyword = cleanText(input.main_keyword).toLowerCase();
  const exactMainIndex = mainKeyword ? lower.indexOf(mainKeyword) : -1;
  if (exactMainIndex > 0) {
    const prefix = cleanText(cleaned.slice(0, exactMainIndex).replace(/[|,;:\-]+$/g, ""));
    const prefixWords = prefix.split(/\s+/).filter(Boolean);
    const first = normalize(prefixWords[0] || "");
    if (
      prefixWords.length > 0 &&
      prefixWords.length <= 3 &&
      !nonBrandTitleLeaders.has(first)
    ) {
      return prefix;
    }
  }

  const firstToken = cleaned.match(/^[\p{L}\p{N}][\p{L}\p{N}&'.-]*/u)?.[0] || "";
  const first = normalize(firstToken);
  const inputWords = new Set(wordsForBrandCheck(`${input.main_keyword} ${input.product_type}`));
  if (!first || nonBrandTitleLeaders.has(first) || inputWords.has(first)) return "";
  const titleWords = normalize(cleaned).split(" ").filter(Boolean);
  const hasProductContext = titleWords.some((word) =>
    /^(mug|cup|tumbler|shirt|tshirt|tee|hoodie|blanket|ornament|candle|poster|plaque|keychain|necklace|bracelet|bag|pillow|notebook|journal|card|sign|bottle)s?$/.test(word),
  );
  if (!hasProductContext || titleWords.length < 4) return "";
  return firstToken;
}

function wordsForBrandCheck(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function extractAudiences(content: string, title: string) {
  const focused = [title, ...content.split(/\n+/).filter((line) => /gift|for\s|dad|mom|lover|owner|nurse|teacher/i.test(line)).slice(0, 30)].join(" ");
  const matches = focused.matchAll(
    new RegExp(`\\b([a-z][a-z'-]*(?:\\s+[a-z][a-z'-]*){0,2}\\s+(?:${audienceNouns}))\\b`, "gi"),
  );
  return unique(
    [...matches].map((match) =>
      cleanText(match[1]).replace(/^(?:best|fun|funny|gift|for|any|proud|playful)\s+/i, ""),
    ),
  ).slice(0, 10);
}

function extractOccasions(content: string) {
  return occasions.filter((occasion) =>
    new RegExp(`\\b${occasion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(content),
  );
}

function extractKeywordCandidates(
  title: string,
  brand: string,
  input: ListingInput,
) {
  const withoutBrand = brand
    ? title.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "")
    : title;
  const chunks = withoutBrand
    .split(/\s+[|–—-]\s+|[,;]+/)
    .map((chunk) => cleanText(chunk).toLowerCase())
    .filter((chunk) => {
      const words = chunk.split(/\s+/);
      const hasProduct = /\b(mug|cup|tumbler|shirt|t-shirt|blanket|ornament)\b/i.test(chunk);
      const hasAudienceGift = /\bgift\b/i.test(chunk) && new RegExp(`\\b(?:${audienceNouns})\\b`, "i").test(chunk);
      const genericGift = /^(?:fun|great|perfect|unique)?\s*gift for (?:lovers|men|women|him|her)$/i.test(chunk);
      return words.length >= 2 && words.length <= 9 && !genericGift && (hasProduct || hasAudienceGift);
    });
  if (normalize(title).includes(normalize(input.main_keyword))) chunks.unshift(input.main_keyword);
  return unique(chunks).slice(0, 12);
}

function extractClaims(content: string, attributes: Record<string, string>) {
  const claims: Array<{ value: string; category: CompetitorClaim["category"] }> = [];
  const normalizedContent = normalize(content);
  const add = (value: string, category: CompetitorClaim["category"]) => {
    const cleaned = cleanText(value);
    if (cleaned) claims.push({ value: cleaned, category });
  };
  if (attributes.material) add(attributes.material, "material");
  if (attributes.capacity) add(attributes.capacity, "capacity");
  if (attributes.color) add(attributes.color, "color");
  if (attributes.special_feature) add(attributes.special_feature, "care");
  for (const [claim, category] of careAndPerformanceClaims) {
    if (normalizedContent.includes(normalize(claim))) add(claim, category);
  }
  if (/dishwasher(?: and microwave)? safe/.test(normalizedContent)) add("Dishwasher safe", "care");
  if (/microwave(?: and dishwasher)? safe/.test(normalizedContent)) add("Microwave safe", "care");
  for (const match of content.matchAll(/\b\d+(?:\.\d+)?\s*(?:fl(?:uid)?\s*oz|oz|ml|litres?|liters?)\b/gi)) {
    add(match[0], "capacity");
  }
  for (const match of content.matchAll(/\b\d+(?:\.\d+)?\s*(?:inches?|cm|mm)\b/gi)) {
    add(match[0], "dimensions");
  }
  for (const match of content.matchAll(/\b(?:made|designed|printed)\s+in\s+[a-z][a-z .'-]{2,35}/gi)) {
    add(match[0], "origin");
  }
  return [...new Map(claims.map((claim) => [`${claim.category}:${normalize(claim.value)}`, claim])).values()];
}

function operatorText(input: ListingInput) {
  return operatorEvidence(input).suppliedFacts.join("\n");
}

function hasOwnEvidence(claim: string, evidence: string) {
  const normalizedClaim = normalize(claim);
  const normalizedEvidence = normalize(evidence);
  return Boolean(normalizedClaim) && ` ${normalizedEvidence} `.includes(` ${normalizedClaim} `);
}

function aggregateSignals(values: Array<{ value: string; source: string }>): CompetitorSignal[] {
  const grouped = new Map<string, { value: string; sources: Set<string> }>();
  for (const item of values) {
    const key = normalize(item.value);
    if (!key) continue;
    const current = grouped.get(key) || { value: cleanText(item.value), sources: new Set<string>() };
    current.sources.add(item.source);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((item) => ({
    value: item.value,
    sources: [...item.sources],
    confidence: item.sources.size > 1 ? "high" : "medium",
  }));
}

export function buildCompetitorProfile(
  references: CrawledReference[],
  input: ListingInput,
  maxEvidenceChars = 6_000,
): CompetitorProfile {
  const perReference = Math.max(500, Math.floor(maxEvidenceChars / Math.max(references.length, 1)));
  const evidence = operatorText(input);
  const extracted = references.map((reference) => {
    const content = reference.content.slice(0, perReference);
    const title = extractTitle(content);
    const attributes = extractAttributes(content);
    const detectedBrand = attributes.brand || inferCompetitorBrandFromTitle(title, input);
    if (detectedBrand) attributes.brand = detectedBrand;
    const source = sourceId(reference);
    return {
      reference,
      source,
      title,
      attributes,
      keywords: extractKeywordCandidates(title, attributes.brand || "", input),
      claims: extractClaims(content, attributes),
      audiences: extractAudiences(content, title),
      occasions: extractOccasions(content),
    };
  });

  const claims = aggregateSignals(
    extracted.flatMap((item) => item.claims.map((claim) => ({ value: `${claim.category}:${claim.value}`, source: item.source }))),
  ).map((signal): CompetitorClaim => {
    const separator = signal.value.indexOf(":");
    const category = signal.value.slice(0, separator) as CompetitorClaim["category"];
    const value = signal.value.slice(separator + 1);
    return {
      ...signal,
      value,
      category,
      own_evidence: hasOwnEvidence(value, evidence) ? "confirmed" : "missing",
    };
  });
  const missingClaims = claims.filter((claim) => claim.own_evidence === "missing");
  const keywordCandidates = aggregateSignals(
    extracted.flatMap((item) => item.keywords.map((value) => ({ value, source: item.source }))),
  ).map((signal): CompetitorKeywordSignal => {
    const missingOwnFacts = missingClaims
      .filter((claim) => ["material", "capacity", "dimensions", "care", "performance", "origin"].includes(claim.category))
      .filter((claim) => normalize(signal.value).includes(normalize(claim.value)))
      .map((claim) => claim.value);
    return {
      ...signal,
      usable_for_listing: missingOwnFacts.length === 0,
      missing_own_facts: unique(missingOwnFacts),
    };
  });
  const blockedTerms = unique([
    ...references.flatMap((reference) => (reference.asin ? [reference.asin] : [])),
    ...extracted.flatMap((item) => (item.attributes.brand ? [item.attributes.brand] : [])),
  ]).filter((term) => normalize(term) !== normalize(input.brand));
  const safeKeywordCandidates = keywordCandidates.filter(
    (keyword) => !blockedTerms.some((term) => normalize(keyword.value).includes(normalize(term))),
  );

  return {
    references: extracted.map(({ reference, title, attributes }) => ({
      asin: reference.asin,
      url: reference.url,
      title: title || undefined,
      brand: attributes.brand || undefined,
      attributes,
    })),
    keyword_candidates: safeKeywordCandidates.slice(0, 20),
    claims: claims.slice(0, 25),
    audiences: aggregateSignals(
      extracted.flatMap((item) => item.audiences.map((value) => ({ value, source: item.source }))),
    ).slice(0, 15),
    occasions: aggregateSignals(
      extracted.flatMap((item) => item.occasions.map((value) => ({ value, source: item.source }))),
    ).slice(0, 12),
    blocked_terms: blockedTerms.slice(0, 12),
    captured_at: new Date().toISOString(),
  };
}
