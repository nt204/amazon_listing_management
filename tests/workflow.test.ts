import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchTemplateCsv, encodeCsv, parseBatchCsv, parseCsv } from "../lib/csv";
import { mergeReviewEvidence } from "../lib/review";
import type { ListingInput, ProductBrief } from "../lib/types";

const input: ListingInput = {
  marketplace: "US",
  product_type: "Mug",
  internal_name: "Cat mug",
  brand: "",
  brand_profile_id: "",
  brand_guidelines: "",
  product_information: {
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 mug",
    features: [],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  },
  main_keyword: "cat mug",
  related_keywords: [],
  backend_keywords: [],
  research: {
    target_customer: "",
    occasion: [],
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

const brief: ProductBrief = {
  visual_facts: ["A white mug is visible."],
  exact_text: ["BEST CAT DAD"],
  colors: ["White"],
  styles: ["Cartoon"],
  subjects: ["Cat"],
  supplied_facts: ["Material: Ceramic"],
  inferred_audiences: ["Cat dads"],
  inferred_occasions: ["Father's Day"],
  related_keywords: ["cat dad mug", "cat lover gift", "feline mug", "pet dad gift", "cat coffee cup"],
  competitor_insights: [],
  listing_angle: "A cat dad gift with visible artwork text.",
  facts_to_avoid: [],
  policy_risks: [],
};

test("review instructions add explicit evidence without treating length requests as product facts", () => {
  const merged = mergeReviewEvidence(
    input,
    brief,
    "Dùng brand Limima, description khoảng 800 ký tự, factual hơn\nCapacity: 11 oz\nDo not mention microwave safe",
  );

  assert.equal(merged.input.brand, "Limima");
  assert.ok(merged.brief.supplied_facts.includes("Brand: Limima"));
  assert.ok(merged.brief.supplied_facts.includes("Capacity: 11 oz"));
  assert.ok(!merged.brief.supplied_facts.some((fact) => fact.includes("800")));
  assert.ok(merged.brief.facts_to_avoid.includes("Do not mention microwave safe"));
});

test("CSV parser preserves commas, quotes and product detail line breaks", () => {
  const encoded = encodeCsv([
    ["marketplace", "product_type", "internal_name", "main_keyword", "product_details", "brand", "reference_listing", "image_files"],
    ["US", "Mug", 'Cat "Dad" Mug', "cat dad mug", "Material: Ceramic\nCapacity: 11 oz", "Limima", "B09TEST", "front.png|back.png"],
  ]);
  const parsed = parseBatchCsv(encoded);
  assert.equal(parsed[0].internal_name, 'Cat "Dad" Mug');
  assert.equal(parsed[0].product_details, "Material: Ceramic\nCapacity: 11 oz");
  assert.equal(parsed[0].image_files, "front.png|back.png");
});

test("batch template contains every required import column", () => {
  const rows = parseCsv(buildBatchTemplateCsv());
  assert.deepEqual(rows[0], [
    "marketplace",
    "product_type",
    "internal_name",
    "main_keyword",
    "product_details",
    "brand",
    "reference_listing",
    "image_files",
  ]);
});
