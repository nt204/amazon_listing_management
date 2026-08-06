import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBackendSearchTerms, optimizeBackendSearchTerms } from "../lib/search-terms";
import type { CompetitorProfile, ListingContent, ListingInput } from "../lib/types";

const input: ListingInput = {
  marketplace: "US",
  product_type: "Mug",
  internal_name: "Cat Dad Mug",
  brand: "Selsorix",
  product_information: {
    material: "Ceramic",
    size_capacity: "12 oz",
    color: "White",
    package_contents: "1 mug",
    features: [],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  },
  main_keyword: "cat dad mug",
  related_keywords: ["cat lover gift", "pet parent cup"],
  backend_keywords: ["kitty parent", "feline owner"],
  research: {
    target_customer: "Cat dads",
    occasion: ["Father's Day"],
    customer_insight: "",
    usp: "",
    competitor_asins: [],
    competitor_notes: "",
    notes: "",
  },
  images: [{ name: "cat.png", type: "image/png", data_url: "data:image/png;base64,AA==" }],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.6-flash",
    openai_model: "gpt-5.6-terra",
    language: "English",
    tone: "Clear and factual",
    bullet_count: 5,
    title_length: 180,
    bullet_length: 250,
    generate_description: true,
    generate_search_terms: true,
  },
};

const profile: CompetitorProfile = {
  references: [{
    asin: "B09RPZN45W",
    url: "https://www.amazon.com/dp/B09RPZN45W",
    title: "Stuff4 Cat Dad Mug Gift for Pet Owners",
    brand: "Stuff4",
    attributes: {},
  }],
  keyword_candidates: [{
    value: "pet dad present",
    sources: ["B09RPZN45W"],
    confidence: "medium",
    usable_for_listing: true,
    missing_own_facts: [],
  }],
  claims: [],
  audiences: [],
  occasions: [],
  blocked_terms: ["Stuff4", "B09RPZN45W"],
  captured_at: new Date(0).toISOString(),
};

const listing: ListingContent = {
  title: "Selsorix Cat Dad Mug, 12 oz Coffee Cup for Men",
  bullet_points: ["One", "Two", "Three", "Four", "Five"],
  description: "A white mug with cat artwork.",
  backend_search_terms: "feline coffee present husband feline the Selsorix B09RPZN45W",
};

test("optimizer keeps AI vocabulary first and expands it from operator and safe competitor terms", () => {
  const value = optimizeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: profile } },
    currentValue: listing.backend_search_terms,
    competitorProfile: profile,
    maxBytes: 249,
  });

  assert.match(value, /^feline coffee present husband/);
  assert.match(value, /kitty parent/);
  assert.match(value, /\bpet\b/);
  assert.match(value, /\bdad\b/);
  assert.doesNotMatch(value, /selsorix|stuff4|b09rpzn45w|\bthe\b/i);
});

test("optimizer removes duplicate words and respects Amazon's byte limit", () => {
  const value = optimizeBackendSearchTerms({
    listing,
    input,
    currentValue: "feline ".repeat(100) + "kitty owner coffee drinkware animal parent present",
    maxBytes: 30,
  });

  assert.equal(new Set(value.split(" ")).size, value.split(" ").length);
  assert.ok(new TextEncoder().encode(value).length <= 30);
});

test("analysis reports useful basic cleanup information", () => {
  const analysis = analyzeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: profile } },
    competitorProfile: profile,
    maxBytes: 249,
  });

  assert.ok(analysis.repeated_words.includes("feline"));
  assert.ok(analysis.stop_words.includes("the"));
  assert.ok(analysis.prohibited_terms.includes("selsorix"));
  assert.ok(analysis.prohibited_terms.includes("b09rpzn45w"));
  assert.ok(analysis.suggested_bytes <= 249);
});

test("search term generation can be disabled", () => {
  const value = optimizeBackendSearchTerms({
    listing,
    input: {
      ...input,
      configuration: { ...input.configuration, generate_search_terms: false },
    },
    maxBytes: 249,
  });

  assert.equal(value, "");
});
