import { getPolicy } from "@/lib/policies";
import type {
  KeywordUsage,
  ListingContent,
  ListingInput,
  ListingResult,
  ValidationIssue,
} from "@/lib/types";

export interface ListingAnalysisContext {
  relatedKeywords?: string[];
  suppliedFacts?: string[];
  factsToAvoid?: string[];
  policyRisks?: string[];
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const compact = (value: string) => normalize(value).replace(/\s/g, "");

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  return normalize(haystack).split(normalize(needle)).length - 1;
}

function includesPhrase(haystack: string, needle: string) {
  return (
    Boolean(needle.trim()) &&
    ` ${normalize(haystack)} `.includes(` ${normalize(needle)} `)
  );
}

function includesKeyword(haystack: string, keyword: string) {
  const words = [...new Set(normalize(keyword).split(" ").filter(Boolean))];
  const haystackWords = new Set(normalize(haystack).split(" ").filter(Boolean));
  return words.length > 0 && words.every((word) => haystackWords.has(word));
}

function includesPolicyTerm(haystack: string, term: string) {
  return term.includes("#")
    ? haystack.toLowerCase().includes(term.toLowerCase())
    : includesPhrase(haystack, term);
}

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), value.trim()])).values()];
}

function keywordPlacements(listing: ListingContent, keyword: string): KeywordUsage["placements"] {
  const placements: KeywordUsage["placements"] = [];
  if (includesKeyword(listing.title, keyword)) placements.push("title");
  if (listing.bullet_points.some((bullet) => includesKeyword(bullet, keyword))) placements.push("bullets");
  if (includesKeyword(listing.description, keyword)) placements.push("description");
  if (includesKeyword(listing.backend_search_terms, keyword)) placements.push("backend_search_terms");
  return placements;
}

function factValue(fact: string) {
  const withoutBullet = fact.replace(/^[•*\-\s]+/, "").trim();
  const separator = withoutBullet.search(/[:：]/);
  return (separator >= 0 ? withoutBullet.slice(separator + 1) : withoutBullet).trim();
}

function avoidValue(fact: string) {
  return fact
    .replace(/^[•*\-\s]+/, "")
    .replace(/^(do not|don't|dont|never|avoid)\s+(mention|use|include|claim)?\s*/i, "")
    .trim();
}

const titleStopWords = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "or",
  "the",
  "to",
  "with",
]);

function repeatedTitleWords(title: string) {
  const counts = new Map<string, number>();
  for (const word of normalize(title).split(" ")) {
    if (word.length < 3 || titleStopWords.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 2).map(([word]) => word);
}

function hasIssue(issues: ValidationIssue[], codes: string[]) {
  return issues.some((issue) => codes.includes(issue.code));
}

export function analyzeListing(
  listing: ListingContent,
  input: ListingInput,
  context: ListingAnalysisContext = {},
): Pick<ListingResult, "seo_analysis" | "content_quality" | "policy_validation"> {
  const policy = getPolicy(input);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const allCopy = [
    listing.title,
    ...listing.bullet_points,
    listing.description,
    listing.backend_search_terms,
  ].join(" ");

  if (listing.title.length > policy.titleMax) {
    errors.push({
      field: "title",
      code: "TITLE_TOO_LONG",
      message: `Title is ${listing.title.length} characters. Limit: ${policy.titleMax}.`,
    });
  }
  if (!includesKeyword(listing.title, input.main_keyword)) {
    errors.push({
      field: "title",
      code: "MAIN_KEYWORD_MISSING",
      message: "Title must contain all meaningful terms from the main keyword.",
    });
  }
  if (listing.title === listing.title.toUpperCase() && /[A-Z]/.test(listing.title)) {
    errors.push({ field: "title", code: "ALL_CAPS", message: "Title must not be written in all caps." });
  }
  if (/\p{Extended_Pictographic}/u.test(listing.title)) {
    errors.push({ field: "title", code: "EMOJI_NOT_ALLOWED", message: "Remove emoji from the title." });
  }
  const repeatedWords = repeatedTitleWords(listing.title);
  if (repeatedWords.length) {
    errors.push({
      field: "title",
      code: "TITLE_WORD_REPETITION",
      message: `Title repeats ${repeatedWords.join(", ")} too often. Rewrite it naturally.`,
    });
  }

  if (listing.bullet_points.length !== policy.bulletCount) {
    errors.push({
      field: "bullet_points",
      code: "BULLET_COUNT",
      message: `Expected ${policy.bulletCount} bullet points, received ${listing.bullet_points.length}.`,
    });
  }
  listing.bullet_points.forEach((bullet, index) => {
    if (!bullet.trim()) {
      errors.push({
        field: `bullet_points[${index}]`,
        code: "EMPTY_BULLET",
        message: "Bullet point cannot be empty.",
      });
    }
    if (bullet.length > policy.bulletMax) {
      errors.push({
        field: `bullet_points[${index}]`,
        code: "BULLET_TOO_LONG",
        message: `Bullet is ${bullet.length} characters. Limit: ${policy.bulletMax}.`,
      });
    }
  });

  if (listing.description.length > policy.descriptionMax) {
    warnings.push({
      field: "description",
      code: "DESCRIPTION_TOO_LONG",
      message: `Description exceeds ${policy.descriptionMax} characters.`,
    });
  } else if (
    listing.description &&
    (listing.description.length < policy.descriptionTargetMin ||
      listing.description.length > policy.descriptionTargetMax)
  ) {
    warnings.push({
      field: "description",
      code: "DESCRIPTION_OUTSIDE_TARGET",
      message: `Description target is ${policy.descriptionTargetMin}-${policy.descriptionTargetMax} characters.`,
    });
  }
  if (/<\/?(script|style|iframe|a)\b/i.test(listing.description)) {
    errors.push({
      field: "description",
      code: "HTML_NOT_ALLOWED",
      message: "Description contains unsupported HTML.",
    });
  }

  const searchBytes = new TextEncoder().encode(listing.backend_search_terms).length;
  if (searchBytes > policy.searchTermsMaxBytes) {
    errors.push({
      field: "backend_search_terms",
      code: "SEARCH_TERMS_TOO_LONG",
      message: `Backend search terms use ${searchBytes} bytes. Limit: ${policy.searchTermsMaxBytes}.`,
    });
  }
  if (/\bB0[A-Z0-9]{8}\b/i.test(listing.backend_search_terms)) {
    errors.push({
      field: "backend_search_terms",
      code: "ASIN_NOT_ALLOWED",
      message: "Backend search terms must not include an ASIN.",
    });
  }

  for (const term of policy.promotionalTerms) {
    if (includesPolicyTerm(allCopy, term)) {
      errors.push({
        field: "listing",
        code: "PROMOTIONAL_CLAIM",
        message: `Remove restricted promotional claim: “${term}”.`,
      });
    }
  }
  for (const term of policy.medicalAndSafetyTerms) {
    if (includesPolicyTerm(allCopy, term)) {
      errors.push({
        field: "listing",
        code: "MEDICAL_OR_SAFETY_CLAIM",
        message: `Remove restricted medical or safety claim: “${term}”.`,
      });
    }
  }

  const ipMatches = policy.intellectualPropertyTerms.filter((term) => includesPhrase(allCopy, term));
  if (ipMatches.length) {
    warnings.push({
      field: "listing",
      code: "IP_REVIEW",
      message: `Review possible trademark or character terms: ${ipMatches.join(", ")}.`,
    });
  }
  for (const risk of unique(context.policyRisks || [])) {
    warnings.push({ field: "listing", code: "AI_POLICY_RISK", message: risk });
  }

  const positiveFacts = unique(context.suppliedFacts || [])
    .map((fact) => ({ fact, value: factValue(fact) }))
    .filter(({ value }) => compact(value).length >= 3);
  const factsUsed = positiveFacts
    .filter(({ value }) => compact(allCopy).includes(compact(value)))
    .map(({ fact }) => fact);
  const unusedFacts = positiveFacts
    .filter(({ fact }) => !factsUsed.includes(fact))
    .map(({ fact }) => fact);

  for (const forbidden of unique(context.factsToAvoid || [])) {
    const target = avoidValue(forbidden);
    if (compact(target).length >= 3 && compact(allCopy).includes(compact(target))) {
      errors.push({
        field: "listing",
        code: "FORBIDDEN_FACT_USED",
        message: `The listing includes an operator-excluded claim: ${target}.`,
      });
    }
  }

  const legacyFacts = normalize(
    [
      ...input.product_information.features,
      input.product_information.material,
      input.product_information.size_capacity,
      input.product_information.color,
      input.product_information.care_instructions,
      input.research.usp,
      input.research.notes,
      ...(context.suppliedFacts || []),
    ].join(" "),
  );
  if (/dishwasher safe|microwave safe|bpa.free/i.test(allCopy) && !/dishwasher safe|microwave safe|bpa.free/i.test(legacyFacts)) {
    errors.push({
      field: "listing",
      code: "UNVERIFIED_CLAIM",
      message: "A care or safety claim may not be supported by the supplied product data.",
    });
  }
  const unsupportedPerformance = policy.unverifiedPerformanceTerms.filter(
    (term) => includesPolicyTerm(allCopy, term) && !includesPolicyTerm(legacyFacts, term),
  );
  if (unsupportedPerformance.length) {
    errors.push({
      field: "listing",
      code: "UNVERIFIED_PERFORMANCE",
      message: `Remove unsupported quality or performance language: ${unsupportedPerformance.join(", ")}.`,
    });
  }

  const relatedKeywords = unique(context.relatedKeywords || input.related_keywords).filter(
    (keyword) => normalize(keyword) !== normalize(input.main_keyword),
  );
  const keywordUsage: KeywordUsage[] = [input.main_keyword, ...relatedKeywords].map(
    (keyword, index) => ({
      keyword,
      is_main: index === 0,
      placements: keywordPlacements(listing, keyword),
    }),
  );
  const relatedUsed = keywordUsage
    .filter((item) => !item.is_main && item.placements.length)
    .map((item) => item.keyword);
  const unused = keywordUsage
    .filter((item) => !item.is_main && !item.placements.length)
    .map((item) => item.keyword);
  const mainUsed = keywordUsage[0]?.placements.length > 0;
  const usedKeywords = keywordUsage.filter((item) => item.placements.length).length;
  const stuffing = countOccurrences(allCopy, input.main_keyword) > 4;
  if (stuffing) {
    warnings.push({
      field: "listing",
      code: "KEYWORD_STUFFING",
      message: "The main keyword appears too often. Rewrite it more naturally.",
    });
  }

  const factCoverage = Math.round((factsUsed.length / Math.max(positiveFacts.length, 1)) * 100);
  const checks = [
    {
      name: "Title and format",
      passed: !hasIssue(errors, ["TITLE_TOO_LONG", "MAIN_KEYWORD_MISSING", "ALL_CAPS", "EMOJI_NOT_ALLOWED", "TITLE_WORD_REPETITION", "BULLET_COUNT", "EMPTY_BULLET", "BULLET_TOO_LONG", "HTML_NOT_ALLOWED"]),
      detail: "Title, five bullets, character limits, capitalization, and formatting",
    },
    {
      name: "Promotional claims",
      passed: !hasIssue(errors, ["PROMOTIONAL_CLAIM"]),
      detail: "Configured promotional and ranking claims",
    },
    {
      name: "Medical and safety claims",
      passed:
        !hasIssue(errors, ["MEDICAL_OR_SAFETY_CLAIM"]) &&
        !hasIssue(errors, ["UNVERIFIED_CLAIM"]),
      detail: "Medical, care, and safety language",
    },
    {
      name: "Product claim support",
      passed: !hasIssue(errors, ["UNVERIFIED_PERFORMANCE"]),
      detail: "Quality, durability, comfort, and performance claims require operator evidence",
    },
    {
      name: "Competitor identifiers",
      passed: !hasIssue(errors, ["ASIN_NOT_ALLOWED"]),
      detail: "ASIN and competitor identifier leakage",
    },
    {
      name: "Trademark and character review",
      passed: !hasIssue(warnings, ["IP_REVIEW"]),
      detail: "Configured trademark and character terms; not a legal clearance",
    },
    {
      name: "AI content risk review",
      passed: !hasIssue(warnings, ["AI_POLICY_RISK"]),
      detail: "Possible copyright, hate, restricted-language, or other image-text risks",
    },
    {
      name: "Operator exclusions",
      passed: !hasIssue(errors, ["FORBIDDEN_FACT_USED"]),
      detail: "Claims the operator explicitly asked the system to omit",
    },
  ];

  return {
    seo_analysis: {
      main_keyword: input.main_keyword,
      main_keyword_used: mainUsed,
      related_keywords_used: relatedUsed,
      unused_keywords: unused,
      keyword_coverage_percent: Math.round((usedKeywords / Math.max(keywordUsage.length, 1)) * 100),
      keyword_stuffing_detected: stuffing,
      keyword_usage: keywordUsage,
    },
    content_quality: {
      supplied_facts: positiveFacts.map(({ fact }) => fact),
      facts_used: factsUsed,
      unused_facts: unusedFacts,
      fact_coverage_percent: positiveFacts.length ? factCoverage : 100,
      title_repetition_detected: repeatedWords.length > 0,
    },
    policy_validation: {
      passed: errors.length === 0,
      errors,
      warnings,
      checks,
    },
  };
}
