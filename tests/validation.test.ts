import assert from "node:assert/strict";
import test from "node:test";
import { createMockListing } from "../lib/mock";
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

test("a complete listing passes the basic Amazon format checks", () => {
  const result = analyzeListing(createMockListing(input), input);

  assert.equal(result.policy_validation.passed, true, JSON.stringify(result.policy_validation.errors));
  assert.equal(result.seo_analysis.main_keyword_used, true);
  assert.equal(result.policy_validation.warnings.length, 0);
});

test("validator requires the main keyword in the title", () => {
  const listing = createMockListing(input);
  listing.title = "North Pine Gifts Ceramic Coffee Cup";

  const result = analyzeListing(listing, input);
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "MAIN_KEYWORD_MISSING"));
});

test("validator enforces title, bullet, description, and search-term limits", () => {
  const listing = createMockListing(input);
  listing.title = `${listing.title} ${"extra ".repeat(40)}`;
  listing.bullet_points = ["Only one bullet"];
  listing.description = "";
  listing.backend_search_terms = "keyword ".repeat(50);

  const result = analyzeListing(listing, input);
  const codes = result.policy_validation.errors.map((issue) => issue.code);
  assert.ok(codes.includes("TITLE_TOO_LONG"));
  assert.ok(codes.includes("BULLET_COUNT"));
  assert.ok(codes.includes("DESCRIPTION_MISSING"));
  assert.ok(codes.includes("SEARCH_TERMS_TOO_LONG"));
});

test("validator removes ASINs from publishable backend terms", () => {
  const listing = createMockListing(input);
  listing.backend_search_terms = "healthcare nurse B0GTQX2FLW appreciation";

  const result = analyzeListing(listing, input);
  assert.ok(result.policy_validation.errors.some((issue) => issue.code === "ASIN_NOT_ALLOWED"));
});

test("quality summary reports keyword and supplied fact usage without blocking publishing", () => {
  const listing = createMockListing(input);
  listing.description += " Made from ceramic with an 11 oz capacity.";

  const result = analyzeListing(listing, input, {
    suppliedFacts: ["Material: Ceramic", "Capacity: 11 oz", "Care: Dishwasher safe"],
    relatedKeywords: ["nurse coffee mug"],
  });

  assert.ok(result.seo_analysis.keyword_coverage_percent > 0);
  assert.ok(result.content_quality.facts_used.includes("Material: Ceramic"));
  assert.ok(result.content_quality.unused_facts.includes("Care: Dishwasher safe"));
  assert.equal(result.policy_validation.passed, true);
});
