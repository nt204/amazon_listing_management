import assert from "node:assert/strict";
import test from "node:test";
import { createMockListing } from "../lib/mock";
import {
  removeUnsupportedPerformanceLanguage,
  trimDescriptionToTarget,
} from "../lib/listing-sanitizer";
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
  listing.title = "BEST SELLER CERAMIC MUG!";
  const result = analyzeListing(listing, input);
  assert.equal(result.policy_validation.passed, false);
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "MAIN_KEYWORD_MISSING"));
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "PROMOTIONAL_CLAIM"));
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "TITLE_SPECIAL_CHARACTERS"));
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

test("sanitizer removes unsupported performance language without another AI pass", () => {
  const listing = createMockListing(input);
  listing.title = "Premium Quality Funny Nurse Mug, Durable Ceramic Gift";
  listing.bullet_points[0] = "Durable ceramic construction with a comfortable handle for daily use.";

  const sanitized = removeUnsupportedPerformanceLanguage(
    listing,
    ["comfortable", "durable", "premium quality"],
    "Material: Ceramic",
  );

  assert.equal(sanitized.title, "Funny Nurse Mug, Ceramic Gift");
  assert.equal(sanitized.bullet_points[0], "Ceramic construction with a handle for daily use.");
});

test("sanitizer preserves performance language explicitly supplied by the operator", () => {
  const listing = createMockListing(input);
  listing.bullet_points[0] = "Durable ceramic construction for everyday use.";

  const sanitized = removeUnsupportedPerformanceLanguage(
    listing,
    ["durable", "premium quality"],
    "Feature: Durable finish",
  );

  assert.equal(sanitized.bullet_points[0], listing.bullet_points[0]);
});

test("description sanitizer keeps generated copy inside the configured target", () => {
  const description = `${"A useful sentence grounded in verified evidence. ".repeat(20)}Final copy.`;
  const trimmed = trimDescriptionToTarget(description, 700, 900);

  assert.ok(trimmed.length >= 700);
  assert.ok(trimmed.length <= 900);
  assert.match(trimmed, /[.!?]$/);
});

test("validator blocks competitor brands and ASINs from every listing field", () => {
  const listing = createMockListing(input);
  listing.bullet_points[0] = "A Stuff4-inspired nurse gift with ASIN B0GTQX2FLW.";
  const result = analyzeListing(listing, input, {
    blockedTerms: ["Stuff4", "B0GTQX2FLW"],
  });

  assert.ok(
    result.policy_validation.errors.some((issue) => issue.code === "COMPETITOR_TERM_USED"),
  );
});

test("validator calculates rule-based weighted SEO coverage and flags missing brand / duplicate backend / short description", () => {
  const listing = {
    title: "Funny Nurse Mug 11 oz Ceramic Coffee Cup",
    bullet_points: [
      "GREAT GIFT - Funny nurse mug for healthcare workers.",
      "CERAMIC MUG - 11 oz white ceramic coffee cup.",
      "CARE - Hand wash recommended for long lasting print.",
      "BEVERAGE - Enjoy favorite beverages every morning.",
      "OCCASIONS - Suitable for Nurse Week, birthdays, or appreciation.",
    ],
    description: "Short description.",
    backend_search_terms: "Funny Nurse Mug 11 oz Ceramic Coffee Cup",
  };

  const result = analyzeListing(listing, input, {
    suppliedFacts: ["Material: Ceramic", "Capacity: 11 oz"],
    relatedKeywords: ["nurse coffee mug", "registered nurse gift"],
  });

  assert.ok(result.seo_analysis.keyword_coverage_percent > 0);
  assert.ok(result.seo_analysis.backend_coverage_percent !== undefined);
  assert.ok(result.policy_validation.warnings.some((w) => w.code === "BRAND_MISSING_FROM_TITLE"));
  assert.ok(result.policy_validation.warnings.some((w) => w.code === "DESCRIPTION_TOO_SHORT"));
  assert.ok(result.policy_validation.warnings.some((w) => w.code === "BACKEND_DUPLICATION_HIGH"));
});

test("validator blocks long verbatim phrases copied from a sourced competitor title", () => {
  const listing = createMockListing({ ...input, brand: "Selsorix", main_keyword: "cat dad mug" });
  listing.title =
    "Selsorix Best Cat Dad Ever Mug Funny Coffee Cup for Cat Lovers and Pet Owners";
  const sourceUrl = "https://www.amazon.com/dp/B09RPZN45W";
  const result = analyzeListing(listing, { ...input, brand: "Selsorix", main_keyword: "cat dad mug" }, {
    competitorProfile: {
      references: [{
        asin: "B09RPZN45W",
        url: sourceUrl,
        title: "Stuff4 Best Cat Dad Ever Mug Funny Coffee Cup for Cat Lovers and Pet Owners",
        brand: "Stuff4",
        attributes: {},
      }],
      keyword_candidates: [],
      claims: [],
      audiences: [],
      occasions: [],
      blocked_terms: ["Stuff4", "B09RPZN45W"],
      captured_at: new Date(0).toISOString(),
    },
  });

  const issue = result.policy_validation.errors.find(
    (item) => item.code === "COMPETITOR_PHRASE_OVERLAP",
  );
  assert.ok(issue);
  assert.equal(issue.source_url, sourceUrl);
  assert.equal(
    result.policy_validation.checks?.find((check) => check.name === "Competitor wording overlap")
      ?.passed,
    false,
  );
});

test("validator allows ordinary SEO vocabulary shared with competitor listings", () => {
  const listing = createMockListing({ ...input, brand: "Selsorix", main_keyword: "cat dad mug" });
  listing.title = "Selsorix Cat Dad Mug, 12 oz Ceramic Coffee Cup for Pet Owners";
  const result = analyzeListing(listing, { ...input, brand: "Selsorix", main_keyword: "cat dad mug" }, {
    competitorProfile: {
      references: [{
        asin: "B09RPZN45W",
        url: "https://www.amazon.com/dp/B09RPZN45W",
        title: "Stuff4 Best Cat Dad Ever Mug Funny Coffee Cup for Cat Lovers and Pet Owners",
        brand: "Stuff4",
        attributes: {},
      }],
      keyword_candidates: [],
      claims: [],
      audiences: [],
      occasions: [],
      blocked_terms: ["Stuff4", "B09RPZN45W"],
      captured_at: new Date(0).toISOString(),
    },
  });

  assert.ok(!result.policy_validation.errors.some(
    (item) => item.code === "COMPETITOR_PHRASE_OVERLAP",
  ));
  assert.ok(!result.policy_validation.warnings.some(
    (item) => item.code === "COMPETITOR_PHRASE_SIMILARITY",
  ));
});

test("marketing QC catches image-description-first copy and weak gift coverage generally", () => {
  const catInput: ListingInput = {
    ...input,
    brand: "Selsorix",
    main_keyword: "cat dad mug",
    related_keywords: ["cat lover gift"],
    backend_keywords: [],
    research: {
      ...input.research,
      target_customer: "Cat dads",
      occasion: ["Father's Day"],
    },
  };
  const listing = {
    title: "Selsorix Cat Dad Mug 12 oz Novelty Coffee Cup Cute Tabby Cat Illustration Best Cat Dad Ever Artwork",
    bullet_points: [
      "Features an illustrated gray and white tabby cat graphic with bold typography.",
      "Displays the phrase Best Cat Dad Ever for cat owners.",
      "Provides a 12 oz capacity for coffee tea or cocoa.",
      "Shows printed artwork on a white body with a rounded handle.",
      "A novelty gifting choice for Father's Day birthdays or holidays for men.",
    ],
    description: "A white mug with a tabby illustration for a cat owner at home or the office.",
    backend_search_terms: "stuff4 12oz gift holiday everyday use",
  };
  const result = analyzeListing(listing, catInput, {
    competitorProfile: {
      references: [{
        url: "https://www.amazon.com/dp/B09RPZN45W",
        title: "Stuff4 Best Cat Dad Ever Mug Funny Gift for Cat Lovers",
        brand: "Stuff4",
        attributes: {},
      }],
      keyword_candidates: [],
      claims: [],
      audiences: [],
      occasions: [],
      blocked_terms: ["Stuff4", "B09RPZN45W"],
      captured_at: new Date(0).toISOString(),
    },
  });

  assert.equal(result.seo_analysis.purchase_strategy?.mode, "gift-led");
  assert.ok((result.seo_analysis.marketing_coverage_percent || 0) < 70);
  assert.ok(result.policy_validation.warnings.some((issue) => issue.code === "PURCHASE_INTENT_MISSING_TITLE"));
  assert.ok(result.policy_validation.warnings.some((issue) => issue.code === "AUDIENCE_EXPANSION_LOW"));
  assert.ok(result.policy_validation.warnings.some((issue) => issue.code === "OCCASION_COVERAGE_LOW"));
  assert.ok(result.policy_validation.warnings.some((issue) => issue.code === "VISUAL_DETAIL_OVERWEIGHT"));
  assert.ok(result.policy_validation.warnings.some((issue) => issue.code === "BACKEND_LOW_INTENT"));
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "BACKEND_PROHIBITED_TERMS"));
});

test("marketing QC rewards audience, recipient, occasion, benefit, and purchase-intent coverage", () => {
  const catInput: ListingInput = {
    ...input,
    brand: "Selsorix",
    main_keyword: "cat dad mug",
    related_keywords: ["cat lover gift"],
    backend_keywords: ["feline owner", "kitty parent"],
    research: {
      ...input.research,
      target_customer: "Cat dads",
      occasion: ["Father's Day"],
    },
  };
  const listing = {
    title: "Selsorix Cat Dad Mug, Funny Gift for Men and Feline Lovers, Birthday, Father's Day or Christmas Present",
    bullet_points: [
      "CELEBRATE HIS CAT-DAD PRIDE - A playful message that recognizes the bond between a man and his feline companion.",
      "READY FOR GIFTING MOMENTS - A thoughtful option for Father's Day, birthdays, Christmas, or appreciation.",
      "BRIGHTEN HIS ROUTINE - Adds personality to morning coffee, afternoon tea, and drink breaks at home or work.",
      "MADE FOR PROUD PET PEOPLE - Relevant for husbands, boyfriends, fathers, grandfathers, friends, and coworkers.",
      "SUPPORTED PRODUCT DETAIL - The supplied 11 oz capacity gives the recipient a practical cup for favorite drinks.",
    ],
    description: "Celebrate a proud cat dad with a useful gift that connects his daily coffee routine to the pet he loves. It is relevant for a husband, boyfriend, father, grandfather, friend, or coworker who treats a feline companion like family. Choose it for Father's Day, a birthday, Christmas, or a simple appreciation moment. The playful message supplies the personality, while the confirmed 11 oz capacity supports coffee, tea, and other everyday drinks without relying on unsupported material, care, or performance claims.",
    backend_search_terms: "kitty owner pet parent animal father appreciation",
  };
  const result = analyzeListing(listing, catInput, {
    suppliedFacts: ["Capacity: 11 oz"],
  });

  assert.equal(result.seo_analysis.purchase_strategy?.mode, "gift-led");
  assert.ok((result.seo_analysis.marketing_coverage_percent || 0) >= 90);
  assert.ok(!result.policy_validation.warnings.some((issue) => [
    "PURCHASE_INTENT_MISSING_TITLE",
    "AUDIENCE_MISSING_TITLE",
    "AUDIENCE_EXPANSION_LOW",
    "OCCASION_COVERAGE_LOW",
    "BENEFIT_COVERAGE_LOW",
    "VISUAL_DETAIL_OVERWEIGHT",
  ].includes(issue.code)));
});
