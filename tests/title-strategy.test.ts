import assert from "node:assert/strict";
import test from "node:test";
import { buildTitleBlueprint } from "../lib/title-strategy";
import type { KeywordResearchTerm, ListingInput } from "../lib/types";

function term(
  keyword: string,
  searchVolume: number,
  category: KeywordResearchTerm["category"],
): KeywordResearchTerm {
  return {
    keyword,
    search_volume: searchVolume,
    cpc: null,
    iq_score: null,
    organic_rank: null,
    sponsored_rank: null,
    competitor_asins: [],
    competitor_count: 5,
    category,
    relevance_score: 90,
    opportunity_score: 80,
    selected: true,
  };
}

const keywordTerms = [
  term("cat dad mug", 3_000, "core"),
  term("cat dad gift mug", 2_200, "core"),
  term("funny cat dad mug", 1_400, "core"),
  term("gift for father", 1_100, "audience"),
  term("gift from daughter", 800, "audience"),
  term("christmas cat dad gift", 1_600, "occasion"),
];

const input: ListingInput = {
  marketplace: "US",
  product_type: "Coffee Mug",
  internal_name: "Cat dad mug",
  brand: "North Pine",
  brand_profile_id: "",
  brand_guidelines: "",
  product_information: {
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 mug",
    features: ["Printed on both sides"],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  },
  main_keyword: "cat dad mug",
  related_keywords: ["funny cat dad mug"],
  backend_keywords: [],
  research: {
    target_customer: "Dad, Father, Daddy",
    gift_giver: "Daughter, Son",
    occasion: ["Father's Day", "Christmas", "Birthday"],
    customer_insight: "",
    usp: "Printed on both sides",
    competitor_asins: [],
    competitor_notes: "",
    notes: "",
    keyword_research: {
      source: "helium10",
      seed_keyword: "cat dad mug",
      marketplace: "US",
      competitor_asins: [],
      terms: keywordTerms,
      generic_keywords: keywordTerms.map((item) => item.keyword),
      search_terms: "cat dad gift father daughter",
      top_core_keywords: ["cat dad mug", "cat dad gift mug"],
      minimum_attribute_search_volume: 150,
      captured_at: "2026-08-07T00:00:00.000Z",
      warnings: [],
    },
  },
  images: [{ name: "cat.png", type: "image/png", data_url: "data:image/png;base64,AA==" }],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.6-flash",
    openai_model: "gpt-5.6-terra",
    language: "English",
    tone: "Natural",
    bullet_count: 5,
    title_length: 200,
    bullet_length: 250,
    generate_description: true,
    generate_search_terms: true,
  },
};

test("title blueprint maps verified input to the requested title template", () => {
  const blueprint = buildTitleBlueprint(input);

  assert.equal(blueprint.brand, "North Pine");
  assert.equal(blueprint.productType, "Coffee Mug");
  assert.deepEqual(blueprint.designThemeCandidates, ["Printed on both sides", "White"]);
  assert.deepEqual(blueprint.highIntentKeywordCandidates, [
    { keyword: "cat dad mug", searchVolume: 3_000 },
    { keyword: "cat dad gift mug", searchVolume: 2_200 },
    { keyword: "funny cat dad mug", searchVolume: 1_400 },
  ]);
  assert.equal(blueprint.recipient, "Dad, Father, Daddy");
  assert.deepEqual(blueprint.styleUseCandidates, ["Printed on both sides"]);
  assert.deepEqual(blueprint.keyFeatureCandidates, ["Printed on both sides", "Ceramic"]);
  assert.equal(blueprint.size, "11 oz");
  assert.equal(blueprint.idealMinimumCharacters, 150);
  assert.equal(blueprint.idealMaximumCharacters, 190);
  assert.equal(blueprint.maxCharacters, 200);
});
