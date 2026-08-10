import ruleData from "@/config/listing-rules.json";
import type { ListingInput, Marketplace } from "@/lib/types";

interface OcrRules {
  enabled: boolean;
  language: string;
  page_segmentation_mode: "AUTO" | "SINGLE_COLUMN" | "SINGLE_BLOCK" | "SPARSE_TEXT" | "SPARSE_TEXT_OSD";
  additional_page_segmentation_modes: Array<"AUTO" | "SINGLE_COLUMN" | "SINGLE_BLOCK" | "SPARSE_TEXT" | "SPARSE_TEXT_OSD">;
  minimum_word_confidence: number;
  minimum_line_confidence: number;
  medium_confidence: number;
  high_confidence: number;
  repeated_line_confidence_bonus: number;
  minimum_alphanumeric_characters: number;
  maximum_line_characters: number;
  maximum_lines: number;
  maximum_images: number;
  timeout_ms: number;
}

interface RuleProfile {
  product_types: Array<{ value: string; label: string }>;
  limits: {
    title_max: number;
    title_target_min: number;
    title_target_max: number;
    bullet_max: number;
    bullet_target_min: number;
    bullet_target_max: number;
    bullet_count: number;
    description_max: number;
    description_target_min: number;
    description_target_max: number;
    search_terms_max_bytes: number;
    backend_useful_word_target: number;
    competitor_keyword_max_words: number;
  };
  marketplace_overrides: Record<Marketplace, { language: string; stop_words: string[] }>;
  ocr: OcrRules;
  search: {
    prohibited_words: string[];
    competitor_count: number;
    minimum_attribute_search_volume: number;
    maximum_generic_keywords: number;
    minimum_relevance_score: number;
  };
  competitor: {
    role_words: string[];
    product_words: string[];
    occasions: string[];
  };
  generation: {
    field_revision_rules: Record<"title" | "bullet_points" | "description" | "backend_search_terms", string>;
  };
}

interface ListingRuleRegistry {
  version: string;
  prompt_version: string;
  default_profile: string;
  profiles: Record<string, RuleProfile>;
}

let cachedRegistry: ListingRuleRegistry | undefined;

function parseRegistry(value: unknown): ListingRuleRegistry {
  const registry = value as ListingRuleRegistry;
  if (!registry?.version || !registry.prompt_version || !registry.default_profile || !registry.profiles) {
    throw new Error("Listing rule registry is incomplete.");
  }
  for (const [name, profile] of Object.entries(registry.profiles)) {
    if (!profile.product_types?.length || !profile.limits || !profile.ocr || !profile.search || !profile.competitor || !profile.generation) {
      throw new Error(`Rule profile '${name}' is incomplete.`);
    }
    if (Object.values(profile.limits).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Rule profile '${name}' has invalid limits.`);
    }
    if (
      profile.limits.title_target_min > profile.limits.title_target_max ||
      profile.limits.title_target_max > profile.limits.title_max
    ) {
      throw new Error(`Rule profile '${name}' has inconsistent title limits.`);
    }
    for (const marketplace of ["US", "UK", "DE"] as Marketplace[]) {
      const rules = profile.marketplace_overrides?.[marketplace];
      if (!rules?.language || !Array.isArray(rules.stop_words)) {
        throw new Error(`Rule profile '${name}' is missing ${marketplace} marketplace rules.`);
      }
    }
  }
  if (!registry.profiles[registry.default_profile]) {
    throw new Error(`Listing rule profile '${registry.default_profile}' does not exist.`);
  }
  return registry;
}

export function getRuleRegistry() {
  if (!cachedRegistry) {
    const override = process.env.LISTING_RULES_JSON?.trim();
    cachedRegistry = parseRegistry(override ? JSON.parse(override) : ruleData);
  }
  return cachedRegistry;
}

export function getRuleProfile(input?: { configuration: { rule_profile?: string } }) {
  const registry = getRuleRegistry();
  const requested = input?.configuration.rule_profile?.trim() || registry.default_profile;
  const profile = registry.profiles[requested];
  if (!profile) throw new Error(`Unknown listing rule profile '${requested}'.`);
  return profile;
}

export function getMarketplaceRules(input: Pick<ListingInput, "marketplace" | "configuration">) {
  return getRuleProfile(input).marketplace_overrides[input.marketplace];
}

export function resetRuleRegistryForTests() {
  cachedRegistry = undefined;
}
