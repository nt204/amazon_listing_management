import type { ListingInput } from "@/lib/types";

const promotionalTerms = [
  "#1",
  "best seller",
  "guaranteed",
  "free shipping",
  "limited time",
];

const medicalAndSafetyTerms = [
  "cure",
  "cures",
  "treats disease",
  "prevents disease",
  "heals",
  "therapeutic",
  "100% safe",
];

const intellectualPropertyTerms = [
  "barbie",
  "disney",
  "harry potter",
  "hello kitty",
  "marvel",
  "pokemon",
  "star wars",
];

const unverifiedPerformanceTerms = [
  "comfortable",
  "durable",
  "fade resistant",
  "generous",
  "heat resistant",
  "ideal",
  "leakproof",
  "long lasting",
  "perfect",
  "premium quality",
  "scratch resistant",
  "ultimate",
  "versatile",
];

export function getPolicy(input: ListingInput) {
  const configuredTitleLimit = input.configuration.title_length;
  const marketplaceTitleLimit = input.marketplace === "US" ? 200 : 200;

  return {
    titleMax: Math.min(configuredTitleLimit, marketplaceTitleLimit),
    bulletMax: input.configuration.bullet_length,
    bulletCount: 5,
    descriptionMax: 2_000,
    descriptionTargetMin: 700,
    descriptionTargetMax: 900,
    searchTermsMaxBytes: 249,
    promotionalTerms,
    medicalAndSafetyTerms,
    intellectualPropertyTerms,
    unverifiedPerformanceTerms,
    restrictedTerms: [...promotionalTerms, ...medicalAndSafetyTerms],
    version: `amazon-${input.marketplace.toLowerCase()}-${input.product_type
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-v3`,
  };
}
