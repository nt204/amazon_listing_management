import { getPolicy } from "@/lib/policies";
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
  if (!includesKeyword(listing.title, input.main_keyword)) {
    errors.push({ field: "title", code: "MAIN_KEYWORD_MISSING", message: "Title must include the main keyword." });
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
  });
  if (input.configuration.generate_description && !listing.description.trim()) {
    errors.push({ field: "description", code: "DESCRIPTION_MISSING", message: "Description is required." });
  } else if (listing.description.length > policy.descriptionMax) {
    errors.push({ field: "description", code: "DESCRIPTION_TOO_LONG", message: `Description exceeds ${policy.descriptionMax} characters.` });
  }
  const backendBytes = new TextEncoder().encode(listing.backend_search_terms).length;
  if (backendBytes > policy.searchTermsMaxBytes) {
    errors.push({ field: "backend_search_terms", code: "SEARCH_TERMS_TOO_LONG", message: `Search terms exceed ${policy.searchTermsMaxBytes} bytes.` });
  }
  if (/\bB0[A-Z0-9]{8}\b/i.test(listing.backend_search_terms)) {
    errors.push({ field: "backend_search_terms", code: "ASIN_NOT_ALLOWED", message: "Remove ASINs from backend search terms." });
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
  const titleWords = normalize(listing.title).split(" ").filter((word) => word.length >= 3);
  const titleCounts = new Map<string, number>();
  titleWords.forEach((word) => titleCounts.set(word, (titleCounts.get(word) || 0) + 1));
  const titleRepetition = [...titleCounts.values()].some((count) => count > 2);

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
        { name: "Backend search terms", passed: !errors.some((error) => ["SEARCH_TERMS_TOO_LONG", "ASIN_NOT_ALLOWED"].includes(error.code)), detail: "Byte limit and ASIN removal" },
      ],
    },
  };
}
