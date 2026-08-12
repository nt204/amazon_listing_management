import { normalizeKeyword } from "@/lib/keyword-research";
import { getPolicy } from "@/lib/policies";
import type { KeywordResearchTerm, ListingInput } from "@/lib/types";

export interface RankedTitleKeyword {
  keyword: string;
  searchVolume: number | null;
}

export interface TitleBlueprint {
  brand: string;
  productType: string;
  designThemeCandidates: string[];
  highIntentKeywordCandidates: RankedTitleKeyword[];
  recipient: string;
  styleUseCandidates: string[];
  keyFeatureCandidates: string[];
  size: string;
  maxCharacters: number;
  idealMinimumCharacters: number;
  idealMaximumCharacters: number;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function metricForKeyword(terms: KeywordResearchTerm[], keyword: string) {
  const normalized = normalizeKeyword(keyword);
  return terms.find((term) => normalizeKeyword(term.keyword) === normalized)?.search_volume ?? null;
}

export function buildTitleBlueprint(input: ListingInput): TitleBlueprint {
  const policy = getPolicy(input);
  const terms = input.research.keyword_research?.terms || [];
  const info = input.product_information;
  const measuredCandidates = terms
    .filter((term) => term.selected && ["core", "long_tail"].includes(term.category))
    .sort((left, right) =>
      right.relevance_score - left.relevance_score ||
      (right.search_volume || 0) - (left.search_volume || 0) ||
      right.opportunity_score - left.opportunity_score,
    )
    .map((term) => term.keyword);
  const highIntentKeywordCandidates = unique([
    input.main_keyword,
    ...measuredCandidates,
    ...input.related_keywords,
  ]).map((keyword) => ({
    keyword,
    searchVolume: metricForKeyword(terms, keyword),
  }));

  return {
    brand: input.brand.trim(),
    productType: input.product_type.trim(),
    designThemeCandidates: unique([
      input.research.usp,
      info.color,
    ]),
    highIntentKeywordCandidates,
    recipient: /^(buyers?|gift buyers?|shoppers?|customers?|recipients?)$/i.test(input.research.target_customer.trim())
      ? ""
      : input.research.target_customer.trim(),
    styleUseCandidates: unique([
      ...info.features,
      info.care_instructions,
    ]),
    keyFeatureCandidates: unique([
      ...info.features,
      info.material,
      info.personalization,
    ]),
    size: info.size_capacity.trim(),
    maxCharacters: policy.titleMax,
    idealMinimumCharacters: policy.titleTargetMin,
    idealMaximumCharacters: policy.titleTargetMax,
  };
}
