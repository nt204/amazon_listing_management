import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitorProfile } from "../lib/competitor-profile";
import { mergeCompetitorProfile } from "../lib/product-brief";
import type { ListingInput, ProductBrief } from "../lib/types";

const input: ListingInput = {
  marketplace: "UK",
  product_type: "Mug",
  internal_name: "Cat Dad Mug",
  brand: "Celsorix",
  product_information: {
    material: "",
    size_capacity: "",
    color: "",
    package_contents: "",
    features: [],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  },
  main_keyword: "cat dad mug",
  related_keywords: [],
  backend_keywords: [],
  research: {
    target_customer: "",
    occasion: [],
    customer_insight: "",
    usp: "",
    competitor_asins: [],
    competitor_notes: "https://www.amazon.co.uk/dp/B0GTQX2FLW",
    notes: "11 oz",
  },
  images: [{ name: "cat.png", type: "image/png", data_url: "data:image/png;base64,AA==" }],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.5-flash-lite",
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

const content = `Title: Stuff4 Best Cat Dad Mug, Playful Cat Silhouette Design in Orange and Black | Fun Gift for Lovers | Sturdy Coffee Mug, 11oz Ceramic Gloss Mug : Amazon.co.uk: Home & Kitchen
Brand Stuff4
Material Ceramic
Colour White
Capacity 11 Fluid ounces
Special feature Microwave Safe
Features the bold slogan BEST CAT DAD EVER with playful cat silhouettes.
A cheerful pick for Father's Day or birthdays for cat lovers.
Built for repeated use, it is dishwasher and microwave safe.
A sturdy coffee mug for everyday drinks.`;

test("competitor extractors build a sourced profile and classify own evidence", () => {
  const profile = buildCompetitorProfile(
    [{ asin: "B0GTQX2FLW", url: "https://www.amazon.co.uk/dp/B0GTQX2FLW", content }],
    input,
  );

  assert.equal(profile.references[0].brand, "Stuff4");
  assert.equal(profile.references[0].attributes.material, "Ceramic");
  assert.ok(profile.blocked_terms.includes("Stuff4"));
  assert.ok(profile.blocked_terms.includes("B0GTQX2FLW"));
  assert.equal(
    profile.claims.find((claim) => /11/.test(claim.value))?.own_evidence,
    "confirmed",
  );
  assert.equal(
    profile.claims.find((claim) => claim.value === "Ceramic")?.own_evidence,
    "missing",
  );
  assert.equal(
    profile.claims.find((claim) => claim.value === "Dishwasher safe")?.own_evidence,
    "missing",
  );
  assert.ok(
    profile.keyword_candidates.some(
      (keyword) => keyword.value === "cat dad mug" && keyword.usable_for_listing,
    ),
  );
  assert.ok(
    profile.keyword_candidates.some(
      (keyword) => keyword.value.includes("ceramic") && !keyword.usable_for_listing,
    ),
  );
  assert.ok(!profile.keyword_candidates.some((keyword) => /stuff4/i.test(keyword.value)));
  assert.ok(!profile.keyword_candidates.some((keyword) => keyword.value === "fun gift for lovers"));
  assert.ok(
    profile.keyword_candidates.some(
      (keyword) => keyword.value === "sturdy coffee mug" && !keyword.usable_for_listing,
    ),
  );
});

test("competitor profile feeds only usable keywords and blocks unsupported claims", () => {
  const profile = buildCompetitorProfile(
    [{ asin: "B0GTQX2FLW", url: "https://www.amazon.co.uk/dp/B0GTQX2FLW", content }],
    input,
  );
  const brief: ProductBrief = {
    visual_facts: ["A mug is visible."],
    exact_text: ["BEST CAT DAD EVER"],
    colors: ["Grey"],
    styles: ["Cartoon"],
    subjects: ["Cat"],
    supplied_facts: ["11 oz"],
    inferred_audiences: ["Cat dads"],
    inferred_occasions: [],
    related_keywords: ["cat dad mug", "cat lover gift", "pet dad mug", "cat coffee cup", "gift for cat dad"],
    competitor_insights: [],
    listing_angle: "A cat dad mug with cartoon artwork.",
    facts_to_avoid: [],
    policy_risks: [],
  };
  const enrichedInput = {
    ...input,
    research: { ...input.research, competitor_profile: profile },
  };
  const merged = mergeCompetitorProfile(enrichedInput, brief);

  assert.ok(merged.facts_to_avoid.includes("Ceramic"));
  assert.ok(merged.facts_to_avoid.includes("Dishwasher safe"));
  assert.ok(!merged.related_keywords.some((keyword) => keyword.includes("ceramic")));
  assert.ok(merged.competitor_insights.some((insight) => insight.includes("Source-backed")));
});
