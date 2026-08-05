import { getPolicy } from "@/lib/policies";
import { buildListingStrategy } from "@/lib/listing-strategy";
import { analyzeBackendSearchTerms } from "@/lib/search-terms";
import type {
  CompetitorProfile,
  KeywordUsage,
  ListingContent,
  ListingInput,
  ListingResult,
  ListingStrategy,
  ValidationIssue,
} from "@/lib/types";

export interface ListingAnalysisContext {
  relatedKeywords?: string[];
  suppliedFacts?: string[];
  factsToAvoid?: string[];
  policyRisks?: string[];
  blockedTerms?: string[];
  competitorProfile?: CompetitorProfile;
  listingStrategy?: ListingStrategy;
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

function withoutPhrases(value: string, phrases: string[]) {
  let normalizedValue = ` ${normalize(value)} `;
  for (const phrase of phrases) {
    const target = normalize(phrase);
    if (target) normalizedValue = normalizedValue.split(` ${target} `).join(" ");
  }
  return normalizedValue.trim();
}

function keywordPlacements(listing: ListingContent, keyword: string): KeywordUsage["placements"] {
  const placements: KeywordUsage["placements"] = [];
  if (includesKeyword(listing.title, keyword)) placements.push("title");
  if (listing.bullet_points.some((bullet) => includesKeyword(bullet, keyword))) placements.push("bullets");
  if (includesKeyword(listing.description, keyword)) placements.push("description");
  if (includesKeyword(listing.backend_search_terms, keyword)) placements.push("backend_search_terms");
  return placements;
}

function placementScore(placements: KeywordUsage["placements"], isMain: boolean) {
  if (isMain) {
    if (placements.includes("title")) return 100;
    if (placements.includes("bullets")) return 55;
    if (placements.includes("description")) return 35;
    if (placements.includes("backend_search_terms")) return 20;
    return 0;
  }
  if (placements.includes("title")) return 100;
  if (placements.includes("bullets")) return 90;
  if (placements.includes("backend_search_terms")) return 85;
  if (placements.includes("description")) return 65;
  return 0;
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

function longestSharedPhrase(first: string, second: string) {
  const firstWords = normalize(first).split(" ").filter(Boolean);
  const secondWords = normalize(second).split(" ").filter(Boolean);
  let previous = new Array<number>(secondWords.length + 1).fill(0);
  let longest = 0;
  let endIndex = 0;

  for (let firstIndex = 1; firstIndex <= firstWords.length; firstIndex += 1) {
    const current = new Array<number>(secondWords.length + 1).fill(0);
    for (let secondIndex = 1; secondIndex <= secondWords.length; secondIndex += 1) {
      if (firstWords[firstIndex - 1] !== secondWords[secondIndex - 1]) continue;
      current[secondIndex] = previous[secondIndex - 1] + 1;
      if (current[secondIndex] > longest) {
        longest = current[secondIndex];
        endIndex = firstIndex;
      }
    }
    previous = current;
  }

  return {
    phrase: firstWords.slice(endIndex - longest, endIndex).join(" "),
    wordCount: longest,
    secondWordCount: secondWords.length,
  };
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
  const compProfile = context.competitorProfile || input.research.competitor_profile;
  const strategyInput = compProfile
    ? { ...input, research: { ...input.research, competitor_profile: compProfile } }
    : input;
  const strategy = context.listingStrategy || buildListingStrategy(strategyInput);
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
  } else if (listing.title.length > 180) {
    warnings.push({
      field: "title",
      code: "TITLE_EXCEEDS_180",
      message: `Title is ${listing.title.length} characters (exceeds recommended 180 characters).`,
    });
  }

  if (input.brand && input.brand.trim()) {
    if (!includesKeyword(listing.title, input.brand)) {
      warnings.push({
        field: "title",
        code: "BRAND_MISSING_FROM_TITLE",
        message: `Brand '${input.brand}' is missing from Title.`,
      });
    }
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
  const titleWithoutBrand = input.brand
    ? listing.title.replace(new RegExp(input.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "")
    : listing.title;
  const prohibitedTitleCharacters = [...new Set(titleWithoutBrand.match(/[!$?_{}^¬¦]/g) || [])];
  if (prohibitedTitleCharacters.length) {
    errors.push({
      field: "title",
      code: "TITLE_SPECIAL_CHARACTERS",
      message: `Remove prohibited title characters: ${prohibitedTitleCharacters.join(" ")}.`,
    });
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
    input.configuration.generate_description &&
    listing.description &&
    listing.description.length < 700
  ) {
    warnings.push({
      field: "description",
      code: "DESCRIPTION_TOO_SHORT",
      message: `Description is ${listing.description.length} characters (less than recommended 700 characters).`,
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

  const backendAnalysis = analyzeBackendSearchTerms({
    listing,
    input,
    currentValue: listing.backend_search_terms,
    relatedKeywords: context.relatedKeywords,
    competitorProfile: compProfile,
    strategy,
    maxBytes: policy.searchTermsMaxBytes,
  });
  if (backendAnalysis.redundant_visible_words.length) {
    warnings.push({
      field: "backend_search_terms",
      code: "BACKEND_DUPLICATION_HIGH",
      message: `Remove words already indexed in visible copy: ${backendAnalysis.redundant_visible_words.join(", ")}.`,
    });
  }
  if (backendAnalysis.repeated_words.length) {
    warnings.push({
      field: "backend_search_terms",
      code: "BACKEND_WORD_REPETITION",
      message: `Backend search terms repeat: ${backendAnalysis.repeated_words.join(", ")}.`,
    });
  }
  if (backendAnalysis.stop_words.length) {
    warnings.push({
      field: "backend_search_terms",
      code: "BACKEND_STOP_WORDS",
      message: `Remove low-value stop words: ${backendAnalysis.stop_words.join(", ")}.`,
    });
  }
  if (backendAnalysis.prohibited_terms.length) {
    errors.push({
      field: "backend_search_terms",
      code: "BACKEND_PROHIBITED_TERMS",
      message: `Remove brand, ASIN, temporary, or subjective terms: ${backendAnalysis.prohibited_terms.join(", ")}.`,
    });
  }
  if (backendAnalysis.low_intent_terms.length) {
    warnings.push({
      field: "backend_search_terms",
      code: "BACKEND_LOW_INTENT",
      message: `Remove measurements, generic filler, or low-intent visual terms: ${backendAnalysis.low_intent_terms.join(", ")}.`,
    });
  }
  const backendCoveragePercent = backendAnalysis.efficiency_percent;

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
  const blockedTerms = unique(context.blockedTerms || []).filter(
    (term) => normalize(term) !== normalize(input.brand),
  );
  const leakedTerms = blockedTerms.filter((term) => includesPolicyTerm(allCopy, term));
  if (leakedTerms.length) {
    errors.push({
      field: "listing",
      code: "COMPETITOR_TERM_USED",
      message: `Remove competitor identifiers: ${leakedTerms.join(", ")}.`,
    });
  }

  const listingSegments = [
    { field: "title", label: "Title", value: listing.title },
    ...listing.bullet_points.map((value, index) => ({
      field: `bullet_points[${index}]`,
      label: `Bullet ${index + 1}`,
      value,
    })),
    { field: "description", label: "Description", value: listing.description },
  ];

  for (const [referenceIndex, reference] of (compProfile?.references || []).entries()) {
    if (!reference.title?.trim()) continue;
    const bestMatch = listingSegments
      .map((segment) => ({ ...segment, ...longestSharedPhrase(segment.value, reference.title || "") }))
      .sort((first, second) => second.wordCount - first.wordCount)[0];
    if (!bestMatch || bestMatch.wordCount < 7) continue;

    const sourceName = reference.asin || `reference ${referenceIndex + 1}`;
    const highRisk =
      bestMatch.wordCount >= 9 ||
      bestMatch.wordCount / Math.max(bestMatch.secondWordCount, 1) >= 0.65;
    const issue: ValidationIssue = {
      field: bestMatch.field,
      code: highRisk ? "COMPETITOR_PHRASE_OVERLAP" : "COMPETITOR_PHRASE_SIMILARITY",
      message: `${bestMatch.label} shares an exact ${bestMatch.wordCount}-word phrase with competitor ${sourceName}: "${bestMatch.phrase}". Rewrite it in original language.`,
      source_url: reference.url,
    };
    if (highRisk) errors.push(issue);
    else warnings.push(issue);
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

  const relatedKeywords = unique([
    ...(context.relatedKeywords || input.related_keywords),
    ...input.related_keywords,
    ...input.backend_keywords,
    ...(compProfile?.keyword_candidates || []).map((keyword) => keyword.value),
  ]).filter((keyword) => normalize(keyword) !== normalize(input.main_keyword));
  const operatorKeywords = new Set(
    [...input.related_keywords, ...input.backend_keywords].map(normalize),
  );
  const keywordUsage: KeywordUsage[] = [input.main_keyword, ...relatedKeywords].map(
    (keyword, index) => {
      const isMain = index === 0;
      const competitorMatch = compProfile?.keyword_candidates.find(
        (candidate) => normalize(candidate.value) === normalize(keyword),
      );
      const source = isMain
        ? "main"
        : operatorKeywords.has(normalize(keyword))
          ? "operator"
          : competitorMatch
            ? "competitor"
            : "ai";
      const weight = isMain
        ? 10
        : source === "operator"
          ? 6
          : source === "competitor"
            ? competitorMatch && competitorMatch.sources.length >= 2
              ? 7
              : 5
            : 3;
      const placements = keywordPlacements(listing, keyword);
      return {
        keyword,
        is_main: isMain,
        placements,
        source,
        weight,
        source_count: competitorMatch?.sources.length,
        confidence: competitorMatch?.confidence,
        usable: competitorMatch?.usable_for_listing ?? true,
        placement_score_percent: placementScore(placements, isMain),
      };
    },
  );
  const relatedUsed = keywordUsage
    .filter((item) => !item.is_main && item.usable !== false && item.placements.length)
    .map((item) => item.keyword);
  const unused = keywordUsage
    .filter((item) => !item.is_main && item.usable !== false && !item.placements.length)
    .map((item) => item.keyword);
  const mainUsed = keywordUsage[0]?.placements.length > 0;
  const stuffing = countOccurrences(allCopy, input.main_keyword) > 4;
  if (stuffing) {
    warnings.push({
      field: "listing",
      code: "KEYWORD_STUFFING",
      message: "The main keyword appears too often. Rewrite it more naturally.",
    });
  }

  const visibleCopy = [listing.title, ...listing.bullet_points, listing.description].join(" ");
  const recipientCopy = withoutPhrases(visibleCopy, strategy.occasion_terms);
  const audiencePool = unique([
    ...strategy.audience_terms,
    ...strategy.buyer_terms,
    ...strategy.recipient_terms,
  ]);
  const audiencesUsed = audiencePool.filter((term) => includesKeyword(visibleCopy, term));
  const recipientsUsed = strategy.recipient_terms.filter((term) => includesKeyword(recipientCopy, term));
  const occasionsUsed = strategy.occasion_terms.filter((term) => includesKeyword(visibleCopy, term));
  const titleAudienceUsed = strategy.audience_terms.some((term) => includesKeyword(listing.title, term));
  const titleOccasionUsed = strategy.occasion_terms.some((term) => includesKeyword(listing.title, term));
  const titleGiftIntent = /\b(gifts?|presents?|gifting)\b/i.test(listing.title) || titleOccasionUsed;
  const benefitPattern = /\b(gifts?|presents?|celebrat\w*|appreciat\w*|enjoy\w*|brighten\w*|remind\w*|smile\w*|routine|occasion|recipient|home|office|morning|break|conversation|practical|helps?)\b/i;
  const benefitBulletCount = listing.bullet_points.filter((bullet) =>
    benefitPattern.test(bullet) ||
    strategy.audience_terms.some((term) => includesKeyword(bullet, term)) ||
    strategy.occasion_terms.some((term) => includesKeyword(bullet, term)),
  ).length;
  const titleVisualHits = strategy.visual_terms.filter((term) => includesKeyword(listing.title, term));
  const audienceCoveragePercent = audiencePool.length
    ? Math.round((audiencesUsed.length / audiencePool.length) * 100)
    : 100;
  const occasionCoveragePercent = strategy.occasion_terms.length
    ? Math.round((occasionsUsed.length / strategy.occasion_terms.length) * 100)
    : 100;

  if (strategy.mode !== "function-led") {
    if (!titleGiftIntent) {
      warnings.push({
        field: "title",
        code: "PURCHASE_INTENT_MISSING_TITLE",
        message: "Title is missing the strongest sourced gift intent or occasion.",
      });
    }
    if (strategy.audience_terms.length && !titleAudienceUsed) {
      warnings.push({
        field: "title",
        code: "AUDIENCE_MISSING_TITLE",
        message: `Title should cover a high-priority audience such as ${strategy.audience_terms.slice(0, 3).join(", ")}.`,
      });
    }
    const recipientTarget = strategy.mode === "gift-led" ? Math.min(2, strategy.recipient_terms.length) : Math.min(1, strategy.recipient_terms.length);
    if (recipientsUsed.length < recipientTarget) {
      warnings.push({
        field: "description",
        code: "AUDIENCE_EXPANSION_LOW",
        message: `Expand relevant recipient coverage beyond the core audience. Current: ${recipientsUsed.length}/${recipientTarget}.`,
      });
    }
    const occasionTarget = strategy.mode === "gift-led" ? Math.min(3, strategy.occasion_terms.length) : Math.min(2, strategy.occasion_terms.length);
    if (occasionsUsed.length < occasionTarget) {
      warnings.push({
        field: "description",
        code: "OCCASION_COVERAGE_LOW",
        message: `Use more specific sourced or strategy-backed occasions. Current: ${occasionsUsed.length}/${occasionTarget}.`,
      });
    }
    if (strategy.mode === "gift-led" && benefitBulletCount < 3) {
      warnings.push({
        field: "bullet_points",
        code: "BENEFIT_COVERAGE_LOW",
        message: `Only ${benefitBulletCount}/5 bullets clearly communicate a shopper benefit, recipient, relationship, occasion, or use case.`,
      });
    }
    if (titleVisualHits.length >= 2 && !titleGiftIntent) {
      warnings.push({
        field: "title",
        code: "VISUAL_DETAIL_OVERWEIGHT",
        message: `Title prioritizes low-intent visual detail (${titleVisualHits.slice(0, 4).join(", ")}) ahead of purchase intent.`,
      });
    }
  }

  const marketingCoveragePercent = strategy.mode === "function-led"
    ? Math.round(
        (mainUsed ? 35 : 0) +
        Math.min(40, (benefitBulletCount / Math.max(policy.bulletCount, 1)) * 40) +
        (listing.description.length >= policy.descriptionTargetMin ? 25 : 0),
      )
    : Math.round(
        (titleGiftIntent ? 25 : 0) +
        (titleAudienceUsed ? 20 : 0) +
        Math.min(20, (recipientsUsed.length / Math.max(strategy.mode === "gift-led" ? 2 : 1, 1)) * 20) +
        Math.min(20, (occasionsUsed.length / Math.max(strategy.mode === "gift-led" ? 3 : 2, 1)) * 20) +
        Math.min(15, (benefitBulletCount / 3) * 15),
      );

  const scoredKeywords = keywordUsage.filter((item) => item.usable !== false);
  const totalKeywordWeight = scoredKeywords.reduce((total, item) => total + (item.weight || 0), 0);
  const usedKeywordWeight = scoredKeywords.reduce(
    (total, item) =>
      total + (item.weight || 0) * ((item.placement_score_percent || 0) / 100),
    0,
  );

  const weightedKeywordCoverage = totalKeywordWeight > 0
    ? Math.round((usedKeywordWeight / totalKeywordWeight) * 100)
    : 100;

  // Reference Utilization Calculation
  const refSignals = compProfile
    ? unique([
        ...compProfile.audiences.map((a) => a.value),
        ...compProfile.occasions.map((o) => o.value),
      ])
    : [];
  const usedRefSignals = refSignals.filter((signal) => includesPhrase(allCopy, signal));
  const referenceUtilizationPercent = refSignals.length > 0
    ? Math.round((usedRefSignals.length / refSignals.length) * 100)
    : 100;

  const factCoverage = positiveFacts.length
    ? Math.round((factsUsed.length / positiveFacts.length) * 100)
    : 100;

  const checks = [
    {
      name: "Title and format",
      passed: !hasIssue(errors, ["TITLE_TOO_LONG", "MAIN_KEYWORD_MISSING", "ALL_CAPS", "EMOJI_NOT_ALLOWED", "TITLE_SPECIAL_CHARACTERS", "TITLE_WORD_REPETITION", "BULLET_COUNT", "EMPTY_BULLET", "BULLET_TOO_LONG", "HTML_NOT_ALLOWED"]),
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
      passed: !hasIssue(errors, ["ASIN_NOT_ALLOWED", "COMPETITOR_TERM_USED"]),
      detail: "ASIN and competitor identifier leakage",
    },
    {
      name: "Competitor wording overlap",
      passed: !hasIssue([...errors, ...warnings], ["COMPETITOR_PHRASE_OVERLAP", "COMPETITOR_PHRASE_SIMILARITY"]),
      detail: "Long verbatim phrases from source listings require an original rewrite",
    },
    {
      name: "Purchase intent coverage",
      passed: !hasIssue(warnings, ["PURCHASE_INTENT_MISSING_TITLE", "AUDIENCE_MISSING_TITLE", "AUDIENCE_EXPANSION_LOW", "OCCASION_COVERAGE_LOW", "BENEFIT_COVERAGE_LOW", "VISUAL_DETAIL_OVERWEIGHT"]),
      detail: "Audience, benefit, recipient, occasion, and use-case coverage follows the inferred strategy",
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
      keyword_coverage_percent: weightedKeywordCoverage,
      backend_coverage_percent: backendCoveragePercent,
      backend_search_terms: backendAnalysis,
      purchase_strategy: strategy,
      marketing_coverage_percent: Math.min(100, marketingCoveragePercent),
      audience_coverage_percent: audienceCoveragePercent,
      occasion_coverage_percent: occasionCoveragePercent,
      keyword_stuffing_detected: stuffing,
      keyword_usage: keywordUsage,
    },
    content_quality: {
      supplied_facts: positiveFacts.map(({ fact }) => fact),
      facts_used: factsUsed,
      unused_facts: unusedFacts,
      fact_coverage_percent: factCoverage,
      reference_utilization_percent: referenceUtilizationPercent,
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
