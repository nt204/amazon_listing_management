import { getRuleProfile, getRuleRegistry } from "@/lib/rules";
import type { ListingInput } from "@/lib/types";

export function getPolicy(input: ListingInput) {
  const registry = getRuleRegistry();
  const profile = getRuleProfile(input);
  const limits = profile.limits;
  const configuredTitleLimit = input.configuration.title_length;

  return {
    titleMax: Math.min(configuredTitleLimit, limits.title_max),
    bulletMax: Math.min(input.configuration.bullet_length, limits.bullet_max),
    bulletTargetMin: limits.bullet_target_min,
    bulletTargetMax: limits.bullet_target_max,
    bulletCount: limits.bullet_count,
    descriptionMax: limits.description_max,
    descriptionTargetMin: limits.description_target_min,
    descriptionTargetMax: limits.description_target_max,
    searchTermsMaxBytes: limits.search_terms_max_bytes,
    backendUsefulWordTarget: limits.backend_useful_word_target,
    version: `${registry.version}:${input.configuration.rule_profile || registry.default_profile}:${input.marketplace}`,
  };
}
