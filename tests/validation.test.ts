import assert from "node:assert/strict";
import test from "node:test";
import { createMockListing } from "../lib/mock";
import { mergeOperatorEvidence } from "../lib/product-brief";
import type { ListingInput } from "../lib/types";
import { analyzeListing } from "../lib/validation";

const input: ListingInput = {
  marketplace: "US",
  product_type: "Mug",
  internal_name: "Nurse Mug",
  brand: "North Pine Gifts",
  product_information: {
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 mug",
    features: ["Printed on both sides"],
    personalization: "",
    care_instructions: "Hand wash recommended",
    country_of_origin: "",
  },
  main_keyword: "funny nurse mug",
  related_keywords: ["nurse coffee mug", "registered nurse gift"],
  backend_keywords: ["healthcare worker appreciation"],
  research: {
    target_customer: "registered nurses",
    occasion: ["Nurse Week"],
    customer_insight: "Customers prefer useful gifts.",
    usp: "Original retro typography",
    competitor_asins: [],
    competitor_notes: "",
    notes: "",
  },
  images: [{ name: "test.png", type: "image/png", data_url: "data:image/png;base64,AA==" }],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.6-flash",
    openai_model: "gpt-5.6-terra",
    language: "English",
    tone: "Friendly and gift-oriented",
    bullet_count: 5,
    title_length: 180,
    bullet_length: 250,
    generate_description: true,
    generate_search_terms: true,
  },
};

test("mock output follows the required listing shape", () => {
  const listing = createMockListing(input);
  assert.equal(listing.bullet_points.length, 5);
  assert.match(listing.title.toLowerCase(), /funny nurse mug/);
  assert.ok(listing.description.length > 0);
});

test("validator accepts a compliant mock listing", () => {
  const result = analyzeListing(createMockListing(input), input);
  assert.equal(
    result.policy_validation.passed,
    true,
    JSON.stringify(result.policy_validation.errors),
  );
  assert.equal(result.policy_validation.errors.length, 0);
  assert.equal(result.seo_analysis.main_keyword_used, true);
});

test("validator blocks missing keyword and restricted claims", () => {
  const listing = createMockListing(input);
  listing.title = "BEST SELLER CERAMIC MUG";
  const result = analyzeListing(listing, input);
  assert.equal(result.policy_validation.passed, false);
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "MAIN_KEYWORD_MISSING"));
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "PROMOTIONAL_CLAIM"));
});

test("quality analysis catches repetitive titles and ignored operator facts", () => {
  const listing = {
    title:
      "Funny Cat Dad Ever Mug - Purr-fect Gift Coffee Cup for Men - Cat Lover Cat Mug",
    bullet_points: [
      "A charming gift that will make him smile.",
      "A thoughtful present for special occasions.",
      "Enjoy favorite beverages in style.",
      "A delightful design for home or office.",
      "A practical daily reminder of furry friends.",
    ],
    description:
      "A warm and thoughtful cat gift that celebrates a special bond and brings joy to every day. ".repeat(8),
    backend_search_terms: "dad gifts cat lover pet parent fathers day birthday men husband",
  };
  const result = analyzeListing(listing, { ...input, main_keyword: "cat mug" }, {
    suppliedFacts: ["Material: Ceramic", "Capacity: 11 oz", "Care: Dishwasher safe"],
    relatedKeywords: ["cat dad mug", "cat lover gift", "ceramic mug", "funny mug", "pet dad gift"],
  });

  assert.ok(
    result.policy_validation.errors.some((issue) => issue.code === "TITLE_WORD_REPETITION"),
  );
  assert.equal(result.content_quality.fact_coverage_percent, 0);
  assert.deepEqual(result.content_quality.unused_facts, [
    "Material: Ceramic",
    "Capacity: 11 oz",
    "Care: Dishwasher safe",
  ]);
});

test("quality analysis tracks keyword placement and supplied fact coverage", () => {
  const listing = {
    title:
      "Best Cat Dad Ever Mug, Funny Cat Lover Coffee Cup for Men, Father's Day Gift, Ceramic 11 oz",
    bullet_points: [
      "CERAMIC BUILD - This 11 oz ceramic mug is sized for coffee, tea, cocoa, and other daily drinks.",
      "EASY CARE - Dishwasher safe for convenient cleanup after everyday use.",
      "VISIBLE DESIGN - Best Cat Dad Ever artwork pairs a cat illustration with clear black lettering.",
      "CAT LOVER GIFT - Made for cat dads, pet parents, husbands, and men who enjoy feline humor.",
      "GIFTING OCCASIONS - A funny mug for Father's Day, birthdays, Christmas, or cat dad appreciation.",
    ],
    description:
      "Celebrate a proud cat dad with a ceramic coffee mug built around the exact Best Cat Dad Ever design shown in the artwork. The 11 oz capacity suits coffee, tea, cocoa, and other everyday drinks, while the dishwasher-safe care detail makes cleanup simple. Clear black lettering and the cat illustration create an easy-to-read design for home or office. This cat lover gift is a practical choice for a husband, father, pet parent, or friend on Father's Day, birthdays, Christmas, and everyday appreciation. The focused design keeps the message visible while giving cat owners a useful cup they can reach for throughout the day.",
    backend_search_terms: "kitty owner feline pet parent animal dad husband birthday christmas",
  };
  const result = analyzeListing(listing, { ...input, main_keyword: "cat mug" }, {
    suppliedFacts: ["Material: Ceramic", "Capacity: 11 oz", "Care: Dishwasher safe"],
    relatedKeywords: ["cat dad mug", "cat lover gift", "ceramic mug", "funny mug", "pet dad gift"],
  });

  assert.equal(
    result.policy_validation.passed,
    true,
    JSON.stringify(result.policy_validation.errors),
  );
  assert.equal(result.content_quality.fact_coverage_percent, 100);
  assert.equal(result.content_quality.title_repetition_detected, false);
  assert.ok(result.seo_analysis.keyword_usage?.some(
    (item) => item.keyword === "cat dad mug" && item.placements.includes("title"),
  ));
});

test("operator evidence is merged deterministically before listing generation", () => {
  const merged = mergeOperatorEvidence(
    {
      ...input,
      brand: "ABC",
      research: {
        ...input.research,
        notes: "Dishwasher safe\nGift for RN\nDo not mention microwave",
      },
    },
    {
      visual_facts: ["A white mug is visible."],
      exact_text: ["BEST NURSE EVER"],
      colors: ["White"],
      styles: ["Retro"],
      subjects: ["Mug"],
      supplied_facts: ["Product type: Mug", "Main keyword: funny nurse mug"],
      inferred_audiences: ["Nurses"],
      inferred_occasions: ["Graduation"],
      related_keywords: [
        "nurse coffee mug",
        "registered nurse gift",
        "nurse graduation mug",
        "nurse week gift",
        "funny rn mug",
      ],
      competitor_insights: [],
      listing_angle: "A practical nurse gift.",
      facts_to_avoid: [
        "Material ceramic is not visually verifiable.",
        "Capacity 11 oz is not visually verifiable.",
      ],
      policy_risks: [],
    },
  );

  assert.ok(merged.supplied_facts.includes("Brand: ABC"));
  assert.ok(merged.supplied_facts.includes("Material: Ceramic"));
  assert.ok(merged.supplied_facts.includes("Size or capacity: 11 oz"));
  assert.ok(merged.supplied_facts.includes("Dishwasher safe"));
  assert.ok(merged.supplied_facts.includes("Gift for RN"));
  assert.ok(!merged.supplied_facts.some((fact) => fact.startsWith("Product type:")));
  assert.deepEqual(merged.facts_to_avoid, ["Do not mention microwave"]);
});

test("validator flags quality modifiers that the operator did not supply", () => {
  const listing = createMockListing(input);
  listing.bullet_points[0] = "Durable ceramic construction with a comfortable handle for daily use.";
  const result = analyzeListing(listing, input, {
    suppliedFacts: ["Material: Ceramic", "Capacity: 11 oz"],
  });

  assert.ok(
    result.policy_validation.errors.some((issue) => issue.code === "UNVERIFIED_PERFORMANCE"),
  );
  assert.equal(
    result.policy_validation.checks?.find((check) => check.name === "Product claim support")
      ?.passed,
    false,
  );
});
