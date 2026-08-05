import assert from "node:assert/strict";
import test from "node:test";
import { buildListingStrategy } from "../lib/listing-strategy";
import type { CompetitorProfile, ListingInput } from "../lib/types";

function inputFor(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    marketplace: "US",
    product_type: "Mug",
    internal_name: "Cat Dad Mug",
    brand: "Selsorix",
    product_information: {
      material: "",
      size_capacity: "12 oz",
      color: "White",
      package_contents: "",
      features: [],
      personalization: "",
      care_instructions: "",
      country_of_origin: "",
    },
    main_keyword: "cat dad mug",
    related_keywords: ["cat lover gift"],
    backend_keywords: [],
    research: {
      target_customer: "Cat dads",
      occasion: ["Father's Day"],
      customer_insight: "",
      usp: "",
      competitor_asins: [],
      competitor_notes: "",
      notes: "",
    },
    images: [{ name: "product.png", type: "image/png", data_url: "data:image/png;base64,AA==" }],
    configuration: {
      ai_provider: "auto",
      gemini_model: "gemini-3.5-flash-lite",
      openai_model: "gpt-5.6-terra",
      language: "English",
      tone: "Clear and natural",
      bullet_count: 5,
      title_length: 180,
      bullet_length: 250,
      generate_description: true,
      generate_search_terms: true,
    },
    ...overrides,
  };
}

test("purchase strategy makes gift-led POD copy audience and occasion first without treating context as facts", () => {
  const strategy = buildListingStrategy(inputFor());

  assert.equal(strategy.mode, "gift-led");
  assert.equal(strategy.marketing_percent, 70);
  assert.ok(strategy.audience_terms.includes("cat dad"));
  assert.ok(strategy.recipient_terms.includes("husband"));
  assert.ok(strategy.recipient_terms.includes("boyfriend"));
  assert.ok(strategy.recipient_terms.includes("grandfather"));
  assert.ok(strategy.occasion_terms.includes("Father's Day"));
  assert.ok(strategy.occasion_terms.includes("Birthday"));
  assert.ok(strategy.occasion_terms.includes("Christmas"));
  assert.ok(strategy.backend_candidates.includes("feline"));
  assert.ok(strategy.backend_candidates.includes("kitty"));
  assert.ok(strategy.backend_candidates.includes("daddy"));
  assert.ok(strategy.backend_candidates.includes("drinkware"));
  assert.equal(strategy.bullet_jobs.length, 5);
});

test("buyer roles do not flip the inferred recipient gender or pollute backend expansion", () => {
  const base = inputFor();
  const strategy = buildListingStrategy(inputFor({
    research: { ...base.research, target_customer: "son, daughter" },
  }), {
    visual_facts: ["A mug is visible."],
    exact_text: ["BEST CAT DAD EVER"],
    colors: ["White"],
    styles: [],
    subjects: ["Cat"],
    supplied_facts: ["Capacity: 15 oz"],
    inferred_audiences: ["son", "daughter", "cat dad from son and daughter"],
    inferred_occasions: ["Father's Day"],
    related_keywords: ["cat dad mug", "cat dad from son daughter", "cat lovers men", "fathers day cat dad", "cat dad birthday"],
    competitor_insights: [],
    listing_angle: "Gift for a cat dad.",
    facts_to_avoid: [],
    policy_risks: [],
  });

  assert.deepEqual(strategy.buyer_terms, ["son", "daughter"]);
  assert.ok(strategy.recipient_terms.includes("husband"));
  assert.ok(strategy.recipient_terms.includes("father"));
  assert.ok(!strategy.recipient_terms.includes("wife"));
  assert.ok(!strategy.recipient_terms.includes("girlfriend"));
  assert.ok(!strategy.recipient_terms.includes("mother"));
});

test("purchase strategy stays function-led when search evidence has no gift, recipient, or occasion intent", () => {
  const base = inputFor();
  const strategy = buildListingStrategy(inputFor({
    product_type: "Water Filter",
    main_keyword: "replacement water filter",
    related_keywords: ["compatible filtration cartridge"],
    product_information: { ...base.product_information, size_capacity: "" },
    research: { ...base.research, target_customer: "", occasion: [] },
  }));

  assert.equal(strategy.mode, "function-led");
  assert.equal(strategy.marketing_percent, 30);
  assert.deepEqual(strategy.recipient_terms, []);
  assert.deepEqual(strategy.occasion_terms, []);
});

test("sourced competitor signals can activate a general gift strategy", () => {
  const base = inputFor({ related_keywords: [], research: { ...inputFor().research, occasion: [] } });
  const profile: CompetitorProfile = {
    references: [{
      url: "https://www.amazon.com/dp/B012345678",
      title: "Brand Nurse Mug Gift for Coworker Birthday Appreciation",
      attributes: {},
    }],
    keyword_candidates: [],
    claims: [],
    audiences: [{ value: "nurse coworker", sources: ["B012345678"], confidence: "medium" }],
    occasions: [{ value: "Birthday", sources: ["B012345678"], confidence: "medium" }],
    blocked_terms: ["Brand"],
    captured_at: new Date(0).toISOString(),
  };
  const strategy = buildListingStrategy({
    ...base,
    main_keyword: "nurse mug",
    research: { ...base.research, competitor_profile: profile },
  });

  assert.equal(strategy.mode, "gift-led");
  assert.ok(strategy.audience_terms.some((term) => term.includes("nurse")));
  assert.ok(strategy.occasion_terms.includes("Birthday"));
});
