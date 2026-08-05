import type {
  BackendSearchTermAnalysis,
  CompetitorProfile,
  ListingContent,
  ListingInput,
  ListingStrategy,
} from "@/lib/types";
import { buildListingStrategy } from "@/lib/listing-strategy";
import { inferCompetitorBrandFromTitle } from "@/lib/competitor-profile";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const prohibitedWords = new Set([
  "amazing",
  "best",
  "cheapest",
  "discount",
  "new",
  "sale",
  "trending",
]);

const lowIntentWords = new Set([
  "artwork",
  "choice",
  "design",
  "everyday",
  "favorite",
  "favourite",
  "gift",
  "gifts",
  "graphic",
  "holiday",
  "ideal",
  "illustration",
  "option",
  "printed",
  "suitable",
  "use",
  "used",
  "uses",
  "using",
]);

const measurementWords = new Set([
  "oz",
  "ounce",
  "ounces",
  "ml",
  "liter",
  "liters",
  "litre",
  "litres",
  "inch",
  "inches",
  "cm",
  "mm",
]);

const genericBrandWords = new Set([
  "and",
  "company",
  "co",
  "gift",
  "gifts",
  "shop",
  "store",
  "studio",
  "the",
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function canonicalWord(value: string) {
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (
    value.length > 3 &&
    value.endsWith("s") &&
    !value.endsWith("ss") &&
    !["christmas", "glass"].includes(value)
  ) {
    return value.slice(0, -1);
  }
  return value;
}

function isMeasurementWord(value: string) {
  return (
    /^\d+(?:\.\d+)?(?:oz|ml|l|in|inch|inches|cm|mm)?$/i.test(value) ||
    measurementWords.has(value)
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function forbiddenWordSet(input: ListingInput, competitorProfile?: CompetitorProfile) {
  const referenceBrandTokens = (competitorProfile?.references || []).flatMap((reference) =>
    tokens(
      reference.brand ||
      (reference.title ? inferCompetitorBrandFromTitle(reference.title, input) : ""),
    ),
  );
  return new Set([
    ...prohibitedWords,
    ...tokens(input.brand).filter((word) => !genericBrandWords.has(word)),
    ...referenceBrandTokens.filter((word) => !genericBrandWords.has(word)),
    ...(competitorProfile?.blocked_terms || []).flatMap(tokens),
  ].map(canonicalWord));
}

function visibleWordSet(listing: ListingContent, input: ListingInput) {
  return new Set(
    tokens([listing.title, ...listing.bullet_points, input.brand].join(" ")).map(canonicalWord),
  );
}

function orderedCompetitorKeywords(profile?: CompetitorProfile) {
  return (profile?.keyword_candidates || [])
    .filter((keyword) => keyword.usable_for_listing)
    .sort((first, second) =>
      second.sources.length - first.sources.length || first.value.localeCompare(second.value),
    )
    .map((keyword) => keyword.value);
}

interface SearchTermOptions {
  listing: ListingContent;
  input: ListingInput;
  currentValue?: string;
  relatedKeywords?: string[];
  competitorProfile?: CompetitorProfile;
  strategy?: ListingStrategy;
  maxBytes: number;
}

export function optimizeBackendSearchTerms({
  listing,
  input,
  relatedKeywords = input.related_keywords,
  competitorProfile = input.research.competitor_profile,
  strategy = buildListingStrategy(input),
  maxBytes,
}: SearchTermOptions) {
  if (!input.configuration.generate_search_terms) return "";

  const visibleWords = visibleWordSet(listing, input);
  const forbiddenWords = forbiddenWordSet(input, competitorProfile);
  const seen = new Set<string>();
  const result: string[] = [];
  const candidates = [
    ...input.backend_keywords,
    ...strategy.backend_candidates,
    ...orderedCompetitorKeywords(competitorProfile),
    ...relatedKeywords,
  ];

  for (const candidate of candidates) {
    for (const word of tokens(candidate)) {
      const canonical = canonicalWord(word);
      if (
        seen.has(canonical) ||
        visibleWords.has(canonical) ||
        stopWords.has(word) ||
        forbiddenWords.has(canonical) ||
        lowIntentWords.has(word) ||
        isMeasurementWord(word) ||
        /^b0[a-z0-9]{8}$/i.test(word)
      ) {
        continue;
      }
      const nextValue = [...result, word].join(" ");
      if (byteLength(nextValue) > maxBytes) continue;
      seen.add(canonical);
      result.push(word);
    }
  }

  return result.join(" ");
}

export function analyzeBackendSearchTerms(options: SearchTermOptions): BackendSearchTermAnalysis {
  const {
    listing,
    input,
    currentValue = listing.backend_search_terms,
    competitorProfile = input.research.competitor_profile,
    maxBytes,
  } = options;
  const currentTokens = tokens(currentValue);
  const visibleWords = visibleWordSet(listing, input);
  const forbiddenWords = forbiddenWordSet(input, competitorProfile);
  const counts = new Map<string, number>();
  currentTokens.forEach((word) => {
    const canonical = canonicalWord(word);
    counts.set(canonical, (counts.get(canonical) || 0) + 1);
  });

  const repeatedWords = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([word]) => word);
  const redundantVisibleWords = unique(
    currentTokens.filter((word) => visibleWords.has(canonicalWord(word))),
  );
  const includedStopWords = unique(currentTokens.filter((word) => stopWords.has(word)));
  const includedProhibited = unique(
    currentTokens.filter(
      (word) => forbiddenWords.has(canonicalWord(word)) || /^b0[a-z0-9]{8}$/i.test(word),
    ),
  );
  const includedLowIntent = unique(
    currentTokens.filter((word) => lowIntentWords.has(word) || isMeasurementWord(word)),
  );
  const inefficientWords = new Set([
    ...repeatedWords,
    ...redundantVisibleWords,
    ...includedStopWords,
    ...includedProhibited,
    ...includedLowIntent,
  ].map(canonicalWord));
  const usefulWordCount = unique(currentTokens.map(canonicalWord)).filter(
    (word) => !inefficientWords.has(word),
  ).length;
  const suggestedValue = optimizeBackendSearchTerms(options);
  const currentSet = new Set(currentTokens);
  const opportunityWords = tokens(suggestedValue).filter((word) => !currentSet.has(word));
  const bytesUsed = byteLength(currentValue.trim());

  return {
    bytes_used: bytesUsed,
    byte_limit: maxBytes,
    bytes_remaining: Math.max(0, maxBytes - bytesUsed),
    unique_word_count: unique(currentTokens.map(canonicalWord)).length,
    efficiency_percent: currentTokens.length
      ? Math.round((usefulWordCount / currentTokens.length) * 100)
      : 100,
    repeated_words: repeatedWords,
    redundant_visible_words: redundantVisibleWords,
    stop_words: includedStopWords,
    prohibited_terms: includedProhibited,
    low_intent_terms: includedLowIntent,
    suggested_value: suggestedValue,
    suggested_bytes: byteLength(suggestedValue),
    opportunity_words: opportunityWords,
  };
}
