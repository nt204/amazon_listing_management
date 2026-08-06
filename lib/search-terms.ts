import { getMarketplaceRules, getRuleProfile } from "@/lib/rules";
import type {
  BackendSearchTermAnalysis,
  CompetitorProfile,
  ListingContent,
  ListingInput,
} from "@/lib/types";

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

interface SearchTermOptions {
  listing: ListingContent;
  input: ListingInput;
  currentValue?: string;
  relatedKeywords?: string[];
  competitorProfile?: CompetitorProfile;
  maxBytes: number;
}

function candidateText(options: SearchTermOptions) {
  const competitor = options.competitorProfile || options.input.research.competitor_profile;
  const safeCompetitorTerms = (competitor?.keyword_candidates || [])
    .filter((keyword) => keyword.usable_for_listing)
    .map((keyword) => keyword.value);
  return [
    options.currentValue || options.listing.backend_search_terms,
    ...options.input.backend_keywords,
    ...(options.relatedKeywords || options.input.related_keywords),
    ...safeCompetitorTerms,
  ].join(" ");
}

function forbiddenWords(input: ListingInput, competitorProfile?: CompetitorProfile) {
  return new Set([
    ...words(input.brand),
    ...(competitorProfile?.blocked_terms || []).flatMap(words),
    ...(competitorProfile?.references || []).flatMap((reference) => words(reference.brand || "")),
    ...getRuleProfile(input).search.prohibited_words.flatMap(words),
  ]);
}

export function optimizeBackendSearchTerms(options: SearchTermOptions) {
  if (!options.input.configuration.generate_search_terms) return "";
  const stopWords = new Set(getMarketplaceRules(options.input).stop_words.map(normalize));
  const forbidden = forbiddenWords(
    options.input,
    options.competitorProfile || options.input.research.competitor_profile,
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words(candidateText(options))) {
    if (
      seen.has(word) ||
      stopWords.has(word) ||
      forbidden.has(word) ||
      /^b0[a-z0-9]{8}$/i.test(word)
    ) continue;
    const next = [...result, word].join(" ");
    if (bytes(next) > options.maxBytes) break;
    seen.add(word);
    result.push(word);
  }
  return result.join(" ");
}

export function analyzeBackendSearchTerms(options: SearchTermOptions): BackendSearchTermAnalysis {
  const value = options.currentValue ?? options.listing.backend_search_terms;
  const currentWords = words(value);
  const stopWords = new Set(getMarketplaceRules(options.input).stop_words.map(normalize));
  const forbidden = forbiddenWords(
    options.input,
    options.competitorProfile || options.input.research.competitor_profile,
  );
  const counts = new Map<string, number>();
  currentWords.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  const repeated = [...counts].filter(([, count]) => count > 1).map(([word]) => word);
  const includedStops = unique(currentWords.filter((word) => stopWords.has(word)));
  const prohibited = unique(currentWords.filter((word) => forbidden.has(word) || /^b0[a-z0-9]{8}$/i.test(word)));
  const visible = new Set(words([
    options.listing.title,
    ...options.listing.bullet_points,
    options.listing.description,
  ].join(" ")));
  const redundant = unique(currentWords.filter((word) => visible.has(word)));
  const suggested = optimizeBackendSearchTerms(options);
  const useful = unique(currentWords).filter((word) =>
    !stopWords.has(word) && !forbidden.has(word) && !/^b0[a-z0-9]{8}$/i.test(word),
  );
  const target = Math.max(1, getRuleProfile(options.input).limits.backend_useful_word_target);
  return {
    bytes_used: bytes(value.trim()),
    byte_limit: options.maxBytes,
    bytes_remaining: Math.max(0, options.maxBytes - bytes(value.trim())),
    unique_word_count: unique(currentWords).length,
    useful_word_count: useful.length,
    available_word_count: unique(words(suggested)).length,
    efficiency_percent: Math.round(Math.min(1, useful.length / target) * 100),
    repeated_words: repeated,
    redundant_visible_words: redundant,
    stop_words: includedStops,
    prohibited_terms: prohibited,
    low_intent_terms: [],
    irrelevant_terms: [],
    suggested_value: suggested,
    suggested_bytes: bytes(suggested),
    opportunity_words: unique(words(suggested).filter((word) => !currentWords.includes(word))),
  };
}
