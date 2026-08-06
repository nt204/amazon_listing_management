import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitorProfile } from "../lib/competitor-profile";
import type { ListingInput } from "../lib/types";

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
    competitor_notes: "",
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

const content = `Title: Stuff4 Best Cat Dad Mug, Playful Cat Silhouette Design | Gift for Cat Lovers | Ceramic Coffee Mug, 11oz : Amazon.co.uk
Brand Stuff4
Material Ceramic
Colour White
Capacity 11 Fluid ounces
Special feature Microwave Safe
The mug is dishwasher and microwave safe.`;

test("ASIN reference extraction keeps useful context and separates missing product claims", () => {
  const profile = buildCompetitorProfile(
    [{ asin: "B0GTQX2FLW", url: "https://www.amazon.co.uk/dp/B0GTQX2FLW", content }],
    input,
  );

  assert.equal(profile.references[0].brand, "Stuff4");
  assert.equal(profile.references[0].attributes.material, "Ceramic");
  assert.ok(profile.blocked_terms.includes("Stuff4"));
  assert.ok(profile.blocked_terms.includes("B0GTQX2FLW"));
  assert.equal(profile.claims.find((claim) => /11/.test(claim.value))?.own_evidence, "confirmed");
  assert.equal(profile.claims.find((claim) => claim.value === "Ceramic")?.own_evidence, "missing");
  assert.ok(profile.keyword_candidates.some((keyword) => keyword.value === "cat dad mug"));
  assert.ok(!profile.keyword_candidates.some((keyword) => /stuff4/i.test(keyword.value)));
});

test("leading competitor brand is inferred when Amazon omits the brand field", () => {
  const profile = buildCompetitorProfile([{
    asin: "B09RPZN45W",
    url: "https://www.amazon.co.uk/dp/B09RPZN45W",
    content: "Title: Stuff4 Cat Dad Mug, Funny Coffee Cup for Cat Lovers : Amazon.co.uk",
  }], input);

  assert.equal(profile.references[0].brand, "Stuff4");
  assert.ok(profile.blocked_terms.includes("Stuff4"));
});

test("generic title leaders and operator audiences are not treated as brands", () => {
  const article = buildCompetitorProfile([{
    asin: "B0DSGNQJT1",
    url: "https://www.amazon.com/dp/B0DSGNQJT1",
    content: "Title: The Leonardo Collection Cat Mug for Home and Kitchen",
  }], input);
  const audience = buildCompetitorProfile([{
    asin: "B0H6KZRMDG",
    url: "https://www.amazon.com/dp/B0H6KZRMDG",
    content: "Title: Army Gifts for Men - Decorative Slate Plaque with Stand",
  }], {
    ...input,
    product_type: "Ornament",
    main_keyword: "Decorative Slate Plaque",
    research: { ...input.research, target_customer: "army soldier" },
  });

  assert.equal(article.references[0].brand, undefined);
  assert.equal(audience.references[0].brand, undefined);
});
