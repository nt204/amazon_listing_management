import { getPolicy } from "@/lib/policies";
import { repeatedTitleWords } from "@/lib/listing-sanitizer";
import { getMarketplaceRules } from "@/lib/rules";
import { analyzeBackendSearchTerms } from "@/lib/search-terms";
import type {
  CompetitorProfile,
  KeywordUsage,
  ListingContent,
  ListingInput,
  ListingResult,
  ProductEvidenceItem,
  ValidationIssue,
} from "@/lib/types";

export interface ListingAnalysisContext {
  relatedKeywords?: string[];
  suppliedFacts?: string[];
  imageFacts?: string[];
  evidenceItems?: ProductEvidenceItem[];
  factsToAvoid?: string[];
  policyRisks?: string[];
  blockedTerms?: string[];
  competitorProfile?: CompetitorProfile;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), value.trim()])).values()];
}

function includesKeyword(value: string, keyword: string) {
  const required = normalize(keyword).split(" ").filter(Boolean);
  const available = new Set(normalize(value).split(" ").filter(Boolean));
  return required.length > 0 && required.every((word) => available.has(word));
}

function includesPhrase(value: string, phrase: string) {
  const normalizedPhrase = normalize(phrase);
  return Boolean(normalizedPhrase) && ` ${normalize(value)} `.includes(` ${normalizedPhrase} `);
}

function factValue(value: string) {
  const separator = value.search(/[:：]/);
  return (separator >= 0 ? value.slice(separator + 1) : value).trim();
}

function placements(listing: ListingContent, keyword: string): KeywordUsage["placements"] {
  const result: KeywordUsage["placements"] = [];
  if (includesKeyword(listing.title, keyword)) result.push("title");
  if (listing.bullet_points.some((bullet) => includesKeyword(bullet, keyword))) result.push("bullets");
  if (includesKeyword(listing.description, keyword)) result.push("description");
  if (includesKeyword(listing.backend_search_terms, keyword)) result.push("backend_search_terms");
  return result;
}

export function analyzeListing(
  listing: ListingContent,
  input: ListingInput,
  context: ListingAnalysisContext = {},
): Pick<ListingResult, "seo_analysis" | "content_quality" | "policy_validation"> {
  const policy = getPolicy(input);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!listing.title.trim()) {
    errors.push({ field: "title", code: "TITLE_MISSING", message: "Title is required." });
  } else if (listing.title.length > policy.titleMax) {
    errors.push({ field: "title", code: "TITLE_TOO_LONG", message: `Title exceeds ${policy.titleMax} characters.` });
  }
  if (
    listing.title.trim() &&
    (listing.title.length < policy.titleTargetMin || listing.title.length > policy.titleTargetMax)
  ) {
    warnings.push({
      field: "title",
      code: "TITLE_LENGTH_NOT_IDEAL",
      message: `Title should ideally contain ${policy.titleTargetMin}-${policy.titleTargetMax} characters.`,
    });
  }
  if (/["“”]/u.test(listing.title)) {
    errors.push({
      field: "title",
      code: "TITLE_QUOTES_NOT_ALLOWED",
      message: "Title must not contain straight or curly quotation marks.",
    });
  }
  const titleOutsideExactBrand = input.brand.trim() && listing.title.startsWith(input.brand.trim())
    ? listing.title.slice(input.brand.trim().length)
    : listing.title;
  const prohibitedTitleCharacters = titleOutsideExactBrand.match(/[!$?_{}^¬¦]/gu) || [];
  if (prohibitedTitleCharacters.length) {
    errors.push({
      field: "title",
      code: "TITLE_PROHIBITED_CHARACTERS",
      message: `Title contains prohibited characters: ${unique(prohibitedTitleCharacters).join(" ")}.`,
    });
  }
  const requiredOpening = input.brand.trim();
  if (
    requiredOpening &&
    !listing.title.toLocaleLowerCase().startsWith(requiredOpening.toLocaleLowerCase())
  ) {
    errors.push({
      field: "title",
      code: "TITLE_BRAND_OPENING",
      message: "Title must begin with the supplied brand.",
    });
  }
  if (!includesPhrase(listing.title, input.main_keyword)) {
    errors.push({
      field: "title",
      code: "MAIN_KEYWORD_MISSING",
      message: "Title must contain the main keyword using the same words in the same order.",
    });
  }
  const repeatedWords = repeatedTitleWords(
    listing.title,
    2,
    getMarketplaceRules(input).stop_words,
  );
  if (repeatedWords.length) {
    errors.push({
      field: "title",
      code: "TITLE_WORD_REPETITION",
      message: `Title repeats these words more than twice: ${repeatedWords.join(", ")}.`,
    });
  }
  if (listing.bullet_points.length !== policy.bulletCount) {
    errors.push({ field: "bullet_points", code: "BULLET_COUNT", message: `Exactly ${policy.bulletCount} bullet points are required.` });
  }
  listing.bullet_points.forEach((bullet, index) => {
    if (!bullet.trim()) {
      errors.push({ field: `bullet_points[${index}]`, code: "EMPTY_BULLET", message: `Bullet ${index + 1} is empty.` });
    } else if (bullet.length > policy.bulletMax) {
      errors.push({ field: `bullet_points[${index}]`, code: "BULLET_TOO_LONG", message: `Bullet ${index + 1} exceeds ${policy.bulletMax} characters.` });
    }
    if (bullet.trim() && !/^[\p{Lu}\p{N}][\p{Lu}\p{N} '&/+-]{1,60}:\s+\S/u.test(bullet)) {
      errors.push({ field: `bullet_points[${index}]`, code: "BULLET_FORMAT", message: `Bullet ${index + 1} must use UPPERCASE BENEFIT HEADER: natural sentence.` });
    }
    if (/(?:https?:\/\/|www\.|\b(?:refund|money[- ]back|guarantee|free shipping|discount|sale price)\b|[\p{Extended_Pictographic}])/iu.test(bullet)) {
      errors.push({ field: `bullet_points[${index}]`, code: "BULLET_PROHIBITED_CONTENT", message: `Bullet ${index + 1} contains promotional, guarantee, link, or emoji content.` });
    }
  });
  if (input.configuration.generate_description && !listing.description.trim()) {
    errors.push({ field: "description", code: "DESCRIPTION_MISSING", message: "Description is required." });
  } else if (listing.description.length > policy.descriptionMax) {
    errors.push({ field: "description", code: "DESCRIPTION_TOO_LONG", message: `Description exceeds ${policy.descriptionMax} characters.` });
  }
  const backendBytes = new TextEncoder().encode(listing.backend_search_terms).length;
  if (backendBytes > policy.searchTermsMaxBytes) {
    errors.push({ field: "backend_search_terms", code: "SEARCH_TERMS_TOO_LONG", message: `Generic keywords exceed ${policy.searchTermsMaxBytes} bytes.` });
  }
  if (/\bB0[A-Z0-9]{8}\b/i.test(listing.backend_search_terms)) {
    errors.push({ field: "backend_search_terms", code: "ASIN_NOT_ALLOWED", message: "Remove ASINs from Generic keywords." });
  }
  if (/[^\p{L}\p{N}\s;]/u.test(listing.backend_search_terms)) {
    errors.push({ field: "backend_search_terms", code: "SEARCH_TERMS_PUNCTUATION", message: "Generic keywords may use semicolons as separators but no other punctuation." });
  }
  const backendWords = normalize(listing.backend_search_terms).split(" ").filter(Boolean);
  if (new Set(backendWords).size !== backendWords.length) {
    errors.push({ field: "backend_search_terms", code: "SEARCH_TERMS_DUPLICATE", message: "Remove duplicate words from Generic keywords." });
  }
  if (input.brand.trim() && includesKeyword(listing.backend_search_terms, input.brand)) {
    errors.push({ field: "backend_search_terms", code: "SEARCH_TERMS_BRAND", message: "Remove brand names from Generic keywords." });
  }

  const keywords = unique([
    input.main_keyword,
    ...input.related_keywords,
    ...(context.relatedKeywords || []),
  ]);
  const keywordUsage: KeywordUsage[] = keywords.map((keyword, index) => ({
    keyword,
    is_main: index === 0,
    placements: placements(listing, keyword),
    source: index === 0 ? "main" : input.related_keywords.includes(keyword) ? "operator" : "competitor",
    weight: index === 0 ? 3 : 1,
    placement_score_percent: placements(listing, keyword).length ? 100 : 0,
  }));
  const usedKeywords = keywordUsage.filter((keyword) => keyword.placements.length);
  const weightedTotal = keywordUsage.reduce((sum, keyword) => sum + (keyword.weight || 1), 0);
  const weightedUsed = usedKeywords.reduce((sum, keyword) => sum + (keyword.weight || 1), 0);

  const allCopy = [listing.title, ...listing.bullet_points, listing.description].join(" ");
  const suppliedFacts = unique(context.suppliedFacts || []);
  const imageFacts = unique(context.imageFacts || []);
  const usedFacts = suppliedFacts.filter((fact) => includesKeyword(allCopy, factValue(fact)));
  const usedImageFacts = imageFacts.filter((fact) => includesKeyword(allCopy, factValue(fact)));
  const allFacts = [...suppliedFacts, ...imageFacts];
  const allUsedFacts = [...usedFacts, ...usedImageFacts];
  const backendAnalysis = analyzeBackendSearchTerms({
    listing,
    input,
    currentValue: listing.backend_search_terms,
    relatedKeywords: context.relatedKeywords,
    competitorProfile: context.competitorProfile,
    maxBytes: policy.searchTermsMaxBytes,
  });
  const titleRepetition = repeatedWords.length > 0;

  return {
    seo_analysis: {
      main_keyword: input.main_keyword,
      main_keyword_used: keywordUsage[0]?.placements.length > 0,
      related_keywords_used: usedKeywords.filter((keyword) => !keyword.is_main).map((keyword) => keyword.keyword),
      unused_keywords: keywordUsage.filter((keyword) => !keyword.is_main && !keyword.placements.length).map((keyword) => keyword.keyword),
      keyword_coverage_percent: weightedTotal ? Math.round((weightedUsed / weightedTotal) * 100) : 100,
      backend_coverage_percent: backendAnalysis.efficiency_percent,
      backend_search_terms: backendAnalysis,
      keyword_stuffing_detected: titleRepetition,
      keyword_usage: keywordUsage,
    },
    content_quality: {
      supplied_facts: suppliedFacts,
      facts_used: usedFacts,
      unused_facts: suppliedFacts.filter((fact) => !usedFacts.includes(fact)),
      image_facts: imageFacts,
      image_facts_used: usedImageFacts,
      unused_image_facts: imageFacts.filter((fact) => !usedImageFacts.includes(fact)),
      fact_coverage_percent: allFacts.length ? Math.round((allUsedFacts.length / allFacts.length) * 100) : 100,
      reference_utilization_percent: input.research.competitor_profile
        ? Math.min(100, Math.round((usedKeywords.filter((keyword) => keyword.source === "competitor").length / Math.max(1, keywordUsage.filter((keyword) => keyword.source === "competitor").length)) * 100))
        : undefined,
      title_repetition_detected: titleRepetition,
    },
    policy_validation: {
      passed: errors.length === 0,
      errors,
      warnings,
      checks: [
        { name: "Amazon format", passed: errors.length === 0, detail: "Required fields and marketplace length limits" },
        { name: "Generic keywords", passed: !errors.some((error) => error.field === "backend_search_terms"), detail: "Byte limit, clean formatting, and prohibited-term removal" },
      ],
    },
  };
}
