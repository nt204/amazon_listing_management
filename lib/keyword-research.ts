import type {
  KeywordResearchCategory,
  KeywordResearchSnapshot,
  KeywordResearchTerm,
  Marketplace,
} from "@/lib/types";

export interface KeywordResearchContext {
  marketplace: Marketplace;
  main_keyword: string;
  product_type: string;
  brand: string;
  product_information: {
    material: string;
    size_capacity: string;
    color: string;
    package_contents: string;
    features: string[];
    personalization: string;
    care_instructions: string;
    country_of_origin: string;
  };
  target_customer: string;
  occasion: string[];
  stop_words: string[];
  prohibited_words: string[];
  role_words: string[];
  occasion_words: string[];
  competitor_count: number;
  minimum_attribute_search_volume: number;
  maximum_generic_keywords: number;
  minimum_relevance_score: number;
}

export interface RawKeywordMetric {
  keyword: string;
  search_volume?: number | null;
  cpc?: number | null;
  iq_score?: number | null;
  organic_rank?: number | null;
  sponsored_rank?: number | null;
  competitor_asins?: string[];
  competitor_count?: number;
}

const asinPattern = /\b(?:B[A-Z0-9]{9}|[0-9]{9}[0-9X])\b/i;
const attributeSignalTokens = new Set(`
  acrylic aluminum aluminium bamboo black blue bronze canvas ceramic cotton dishwasher durable
  engraved glass gold handmade handwash insulated iron leakproof leather linen metal microwave
  personalized plastic porcelain printed red reusable silver stainless steel stone sturdy vinyl
  waterproof white wood wooden wool yellow oz ounce ounces ml liter litre liters litres inch inches
`.split(/\s+/).filter(Boolean));

export function normalizeKeyword(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/(?:^|\s)'|'(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalizeKeyword(value).split(" ").filter(Boolean);
}

export function isKeywordExpansion(candidate: string, coreKeyword: string) {
  const candidateWords = new Set(words(candidate));
  const coreWords = words(coreKeyword);
  return (
    normalizeKeyword(candidate) !== normalizeKeyword(coreKeyword) &&
    coreWords.length > 0 &&
    coreWords.every((word) => candidateWords.has(word))
  );
}

function unique(values: string[]) {
  return [...new Set(values.map(normalizeKeyword).filter(Boolean))];
}

function numberOrNull(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : null;
}

function positiveRank(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

function tokenOverlap(candidate: Set<string>, reference: Set<string>) {
  if (!candidate.size || !reference.size) return 0;
  let matches = 0;
  for (const token of candidate) if (reference.has(token)) matches += 1;
  return matches / Math.min(candidate.size, reference.size);
}

function hasAny(candidate: Set<string>, reference: Set<string>) {
  for (const token of candidate) if (reference.has(token)) return true;
  return false;
}

function phraseIncludesAny(value: string, phrases: string[]) {
  const normalized = ` ${normalizeKeyword(value)} `;
  return phrases.some((phrase) => {
    const target = normalizeKeyword(phrase);
    return target && normalized.includes(` ${target} `);
  });
}

function classifyKeyword(
  keyword: string,
  context: KeywordResearchContext,
  attributeTokens: Set<string>,
): KeywordResearchCategory {
  const keywordTokens = new Set(words(keyword));
  const seedTokens = new Set(words(context.main_keyword));
  if (phraseIncludesAny(keyword, context.occasion_words)) return "occasion";
  if (hasAny(keywordTokens, attributeTokens) || hasAny(keywordTokens, attributeSignalTokens)) return "attribute";
  if (tokenOverlap(keywordTokens, seedTokens) >= 0.75) return "core";
  if (hasAny(keywordTokens, new Set(context.role_words.map(normalizeKeyword)))) return "audience";
  if (keywordTokens.size >= 3 && hasAny(keywordTokens, seedTokens)) return "long_tail";
  return "other";
}

function computeRelevance(
  keyword: string,
  context: KeywordResearchContext,
  attributeTokens: Set<string>,
) {
  const normalized = normalizeKeyword(keyword);
  const candidate = new Set(words(keyword));
  const seed = new Set(words(context.main_keyword));
  const product = new Set(words(context.product_type));
  const audience = new Set(words(context.target_customer));
  const occasions = new Set(context.occasion.flatMap(words));
  const seedOverlap = tokenOverlap(candidate, seed);
  const productOverlap = tokenOverlap(candidate, product);
  const contextMatch = hasAny(candidate, audience) || hasAny(candidate, occasions) || hasAny(candidate, attributeTokens);
  const exactBonus = normalized === normalizeKeyword(context.main_keyword)
    ? 35
    : normalized.includes(normalizeKeyword(context.main_keyword))
      ? 20
      : 0;
  return Math.min(
    100,
    Math.round(seedOverlap * 45 + productOverlap * 20 + (contextMatch ? 20 : 0) + exactBonus),
  );
}

function mergeMetrics(rawTerms: RawKeywordMetric[]) {
  const merged = new Map<string, RawKeywordMetric>();
  for (const raw of rawTerms) {
    const keyword = normalizeKeyword(raw.keyword);
    if (!keyword || keyword.length > 200 || words(keyword).length > 10 || asinPattern.test(keyword)) continue;
    const current = merged.get(keyword);
    if (!current) {
      merged.set(keyword, {
        ...raw,
        keyword,
        competitor_asins: unique(raw.competitor_asins || []).map((asin) => asin.toUpperCase()),
      });
      continue;
    }
    const asins = unique([...(current.competitor_asins || []), ...(raw.competitor_asins || [])])
      .map((asin) => asin.toUpperCase());
    merged.set(keyword, {
      keyword,
      search_volume: Math.max(numberOrNull(current.search_volume) || 0, numberOrNull(raw.search_volume) || 0) || null,
      cpc: Math.max(numberOrNull(current.cpc) || 0, numberOrNull(raw.cpc) || 0) || null,
      iq_score: Math.max(numberOrNull(current.iq_score) || 0, numberOrNull(raw.iq_score) || 0) || null,
      organic_rank: Math.min(positiveRank(current.organic_rank) || Number.POSITIVE_INFINITY, positiveRank(raw.organic_rank) || Number.POSITIVE_INFINITY),
      sponsored_rank: Math.min(positiveRank(current.sponsored_rank) || Number.POSITIVE_INFINITY, positiveRank(raw.sponsored_rank) || Number.POSITIVE_INFINITY),
      competitor_asins: asins,
      competitor_count: Math.max(current.competitor_count || 0, raw.competitor_count || 0, asins.length),
    });
  }
  return [...merged.values()].map((metric) => ({
    ...metric,
    organic_rank: metric.organic_rank === Number.POSITIVE_INFINITY ? null : metric.organic_rank,
    sponsored_rank: metric.sponsored_rank === Number.POSITIVE_INFINITY ? null : metric.sponsored_rank,
  }));
}

function attributeVocabulary(context: KeywordResearchContext) {
  const info = context.product_information;
  return new Set(words([
    info.material,
    info.size_capacity,
    info.color,
    ...info.features,
    info.personalization,
    info.care_instructions,
    info.country_of_origin,
  ].join(" ")).filter((word) => word.length > 1));
}

function reasonForExclusion(
  metric: RawKeywordMetric,
  category: KeywordResearchCategory,
  relevance: number,
  context: KeywordResearchContext,
) {
  if (phraseIncludesAny(metric.keyword, [context.brand])) return "Chứa brand của sản phẩm";
  if (phraseIncludesAny(metric.keyword, context.prohibited_words)) return "Chứa từ bị cấm";
  const ownAttributes = attributeVocabulary(context);
  const unsupportedAttributes = words(metric.keyword).filter(
    (word) => attributeSignalTokens.has(word) && !ownAttributes.has(word),
  );
  if (unsupportedAttributes.length) {
    return `Đặc điểm chưa được xác nhận: ${[...new Set(unsupportedAttributes)].join(", ")}`;
  }
  const normalizedMetric = normalizeKeyword(metric.keyword);
  const normalizedOwnAttributes = normalizeKeyword([
    context.product_information.material,
    context.product_information.size_capacity,
    context.product_information.color,
    ...context.product_information.features,
    context.product_information.personalization,
    context.product_information.care_instructions,
    context.product_information.country_of_origin,
  ].join(" "));
  const measuredAttributes = normalizedMetric.match(/\b\d+(?:\.\d+)?\s+(?:oz|ounces?|ml|liters?|litres?|inches?)\b/g) || [];
  const unsupportedMeasurement = measuredAttributes.find(
    (measurement) => !` ${normalizedOwnAttributes} `.includes(` ${measurement} `),
  );
  if (unsupportedMeasurement) return `Thông số chưa được xác nhận: ${unsupportedMeasurement}`;
  if (!numberOrNull(metric.search_volume)) return "Không có Search Volume";
  if (relevance < context.minimum_relevance_score) return "Độ liên quan thấp";
  if (
    category === "attribute" &&
    Number(metric.search_volume || 0) <= context.minimum_attribute_search_volume
  ) {
    return `Đặc điểm sản phẩm cần Search Volume > ${context.minimum_attribute_search_volume}`;
  }
  return "";
}

function buildSearchTerms(
  selected: KeywordResearchTerm[],
  context: KeywordResearchContext,
  maxBytes = 249,
) {
  const blocked = new Set([
    ...context.stop_words,
    ...context.prohibited_words,
    ...words(context.brand),
  ].map(normalizeKeyword));
  const seen = new Set<string>();
  const result: string[] = [];
  const ordered = [...selected].sort((left, right) =>
    right.opportunity_score - left.opportunity_score ||
    (right.search_volume || 0) - (left.search_volume || 0),
  );
  for (const term of ordered) {
    for (const rawWord of words(term.keyword)) {
      const word = rawWord.replace(/'/g, "");
      if (!word || seen.has(word) || blocked.has(rawWord) || blocked.has(word) || asinPattern.test(word)) continue;
      const next = [...result, word].join(" ");
      if (new TextEncoder().encode(next).length > maxBytes) return result.join(" ");
      seen.add(word);
      result.push(word);
    }
  }
  return result.join(" ");
}

export function titleCaseKeyword(keyword: string) {
  return words(keyword).map((word) =>
    word ? `${word[0].toLocaleUpperCase()}${word.slice(1)}` : "",
  ).join(" ");
}

export function formatGenericKeywords(keywords: string[]) {
  return keywords.map(titleCaseKeyword).join("; ");
}

export function createKeywordResearchSnapshot(options: {
  context: KeywordResearchContext;
  rawTerms: RawKeywordMetric[];
  competitorAsins: string[];
  source: KeywordResearchSnapshot["source"];
  warnings?: string[];
  capturedAt?: string;
}): KeywordResearchSnapshot {
  const { context } = options;
  const attributes = attributeVocabulary(context);
  const metrics = mergeMetrics(options.rawTerms);
  const maxVolume = Math.max(1, ...metrics.map((metric) => numberOrNull(metric.search_volume) || 0));
  const scoredTerms: KeywordResearchTerm[] = metrics.map((metric) => {
    const category = classifyKeyword(metric.keyword, context, attributes);
    const relevance = computeRelevance(metric.keyword, context, attributes);
    const searchVolume = numberOrNull(metric.search_volume);
    const competitorAsins = unique(metric.competitor_asins || []).map((asin) => asin.toUpperCase());
    const competitorCount = Math.max(metric.competitor_count || 0, competitorAsins.length);
    const volumeScore = searchVolume
      ? Math.log10(searchVolume + 1) / Math.log10(maxVolume + 1)
      : 0;
    const coverageScore = Math.min(1, competitorCount / Math.max(1, context.competitor_count));
    const bestRank = Math.min(
      positiveRank(metric.organic_rank) || Number.POSITIVE_INFINITY,
      positiveRank(metric.sponsored_rank) || Number.POSITIVE_INFINITY,
    );
    const rankScore = Number.isFinite(bestRank) ? Math.max(0, 1 - (bestRank - 1) / 100) : 0;
    const iqScore = numberOrNull(metric.iq_score);
    const opportunity = Math.min(100, Math.round(
      relevance * 0.45 + volumeScore * 25 + coverageScore * 20 + rankScore * 7 + Math.min(1, (iqScore || 0) / 1_000) * 3,
    ));
    const exclusionReason = reasonForExclusion(metric, category, relevance, context);
    return {
      keyword: metric.keyword,
      search_volume: searchVolume,
      cpc: numberOrNull(metric.cpc),
      iq_score: iqScore,
      organic_rank: positiveRank(metric.organic_rank),
      sponsored_rank: positiveRank(metric.sponsored_rank),
      competitor_asins: competitorAsins,
      competitor_count: competitorCount,
      category,
      relevance_score: relevance,
      opportunity_score: opportunity,
      selected: !exclusionReason,
      ...(exclusionReason ? { exclusion_reason: exclusionReason } : {}),
    };
  }).sort((left, right) =>
    Number(right.selected) - Number(left.selected) ||
    right.opportunity_score - left.opportunity_score ||
    (right.search_volume || 0) - (left.search_volume || 0),
  );
  let selectedCount = 0;
  const terms = scoredTerms.map((term) => {
    if (!term.selected) return term;
    selectedCount += 1;
    if (selectedCount <= context.maximum_generic_keywords) return term;
    return {
      ...term,
      selected: false,
      exclusion_reason: `Ngoài top ${context.maximum_generic_keywords} keyword theo opportunity score`,
    };
  });
  const selected = terms.filter((term) => term.selected);
  const coreKeyword = normalizeKeyword(context.main_keyword);
  const coreKeywordVolume = terms.find((term) => term.keyword === coreKeyword)?.search_volume;
  const extendedKeyword = selected
    .filter((term) => ["core", "long_tail"].includes(term.category))
    .filter((term) => isKeywordExpansion(term.keyword, coreKeyword))
    .filter((term) =>
      coreKeywordVolume === null || coreKeywordVolume === undefined ||
      term.search_volume === null || term.search_volume <= coreKeywordVolume,
    )
    .sort((left, right) =>
      (right.search_volume || 0) - (left.search_volume || 0) ||
      right.opportunity_score - left.opportunity_score,
    )
    .at(0)?.keyword;
  const topCoreKeywords = [coreKeyword, extendedKeyword].filter(Boolean) as string[];
  return {
    source: options.source,
    seed_keyword: normalizeKeyword(context.main_keyword),
    marketplace: context.marketplace,
    competitor_asins: unique(options.competitorAsins).map((asin) => asin.toUpperCase()).slice(0, context.competitor_count),
    terms,
    generic_keywords: selected.map((term) => term.keyword),
    search_terms: buildSearchTerms(selected, context),
    top_core_keywords: topCoreKeywords,
    minimum_attribute_search_volume: context.minimum_attribute_search_volume,
    captured_at: options.capturedAt || new Date().toISOString(),
    warnings: options.warnings || [],
  };
}
