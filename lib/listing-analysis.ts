import { getPolicy } from "@/lib/policies";
import { getRuleRegistry } from "@/lib/rules";
import type { ListingInput, ListingResult, StoredListing } from "@/lib/types";
import { analyzeListing, type ListingAnalysisContext } from "@/lib/validation";

export function inputWithResultResearch(
  input: ListingInput,
  result: Pick<ListingResult, "competitor_profile">,
): ListingInput {
  const competitorProfile = result.competitor_profile || input.research.competitor_profile;
  return competitorProfile
    ? { ...input, research: { ...input.research, competitor_profile: competitorProfile } }
    : input;
}

export function buildAnalysisContext(
  input: ListingInput,
  result: Pick<ListingResult, "product_analysis" | "competitor_profile">,
): ListingAnalysisContext {
  const brief = result.product_analysis;
  const enrichedInput = inputWithResultResearch(input, result);
  const competitorProfile = result.competitor_profile || enrichedInput.research.competitor_profile;
  return {
    relatedKeywords: brief?.related_keywords,
    suppliedFacts: brief?.supplied_facts,
    imageFacts: brief?.image_facts,
    evidenceItems: brief?.evidence_items,
    competitorProfile,
  };
}

export function revalidateStoredListing(stored: StoredListing) {
  const input = inputWithResultResearch(stored.input, stored.result);
  const analysis = analyzeListing(
    stored.current_listing,
    input,
    buildAnalysisContext(input, stored.result),
  );
  const result: ListingResult = {
    ...stored.result,
    status: analysis.policy_validation.passed ? "success" : "needs_review",
    listing: stored.current_listing,
    ...analysis,
    metadata: {
      ...stored.result.metadata,
      policy_version: getPolicy(input).version,
      prompt_version: stored.result.metadata.prompt_version || getRuleRegistry().prompt_version,
      evidence_version: "simple-ocr-v1",
      rule_profile: input.configuration.rule_profile || getRuleRegistry().default_profile,
    },
  };
  return { input, result, analysis };
}
