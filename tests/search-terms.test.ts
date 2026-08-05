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
  references: [
    { asin: "B09RPZN45W", url: "https://www.amazon.com/dp/B09RPZN45W", brand: "Stuff4", attributes: {} },
    { asin: "B012345678", url: "https://www.amazon.com/dp/B012345678", brand: "Mugful", attributes: {} },
  ],
  keyword_candidates: [
    { value: "pet dad present", sources: ["B09RPZN45W", "B012345678"], confidence: "high", usable_for_listing: true, missing_own_facts: [] },
    { value: "ceramic mug", sources: ["B09RPZN45W"], confidence: "medium", usable_for_listing: false, missing_own_facts: ["Ceramic"] },
  ],
  claims: [],
  audiences: [],
  occasions: [],
  blocked_terms: ["Stuff4", "Mugful", "B09RPZN45W", "B012345678"],
  captured_at: new Date(0).toISOString(),
};

const listing: ListingContent = {
  title: "Selsorix Cat Dad Mug, 12 oz Coffee Cup for Men",
  bullet_points: [
    "VISIBLE DESIGN - Cat artwork for a proud pet dad.",
    "CAPACITY - Holds 12 oz.",
    "GIFTING - A Father's Day option for cat lovers.",
    "USE - Coffee or tea at home and work.",
    "PACKAGE - Includes one mug.",
  ],
  description: "A white mug with cat artwork.",
  backend_search_terms: "Selsorix cat mug best B09RPZN45W feline owner gift for husband husband",
};

test("backend optimizer prioritizes operator and sourced competitor vocabulary without copying unsafe terms", () => {
  const value = optimizeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: profile } },
    currentValue: listing.backend_search_terms,
    relatedKeywords: input.related_keywords,
    competitorProfile: profile,
    maxBytes: 249,
  });

  assert.match(value, /^kitty parent feline owner/);
  assert.match(value, /\bpresent\b/);
  assert.doesNotMatch(value, /\bpet\b/);
  assert.doesNotMatch(value, /selsorix|stuff4|mugful|best|b09rpzn45w|ceramic|\bfor\b/i);
  assert.equal(new Set(value.split(" ")).size, value.split(" ").length);
  assert.ok(new TextEncoder().encode(value).length <= 249);
});

test("backend analysis explains repeated, visible, stop, and prohibited words", () => {
  const analysis = analyzeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: profile } },
    competitorProfile: profile,
    maxBytes: 249,
  });

  assert.ok(analysis.redundant_visible_words.includes("cat"));
  assert.ok(analysis.repeated_words.includes("husband"));
  assert.ok(analysis.stop_words.includes("for"));
  assert.ok(analysis.prohibited_terms.includes("selsorix"));
  assert.ok(analysis.prohibited_terms.includes("best"));
  assert.ok(analysis.suggested_bytes <= 249);
});

test("backend optimizer never recycles raw AI filler, measurements, or gibberish", () => {
  const value = optimizeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: profile } },
    currentValue: "stuff4 12oz gift holiday everyday use casi nafoa toot hon",
    relatedKeywords: ["feline parent present", "kitty enthusiast"],
    competitorProfile: profile,
    maxBytes: 249,
  });

  assert.doesNotMatch(value, /stuff4|12oz|\bgift\b|holiday|everyday|\buse\b|casi|nafoa|toot|hon/i);
  assert.match(value, /feline|kitty|present|enthusiast/i);
});

test("backend analysis classifies measurements and generic visual or usage filler", () => {
  const analysis = analyzeBackendSearchTerms({
    listing: { ...listing, backend_search_terms: "12oz artwork illustration everyday use holiday gift" },
    input,
    maxBytes: 249,
  });

  assert.deepEqual(analysis.low_intent_terms, [
    "12oz",
    "artwork",
    "illustration",
    "everyday",
    "use",
    "holiday",
    "gift",
  ]);
});

test("backend optimizer repairs stale competitor profiles whose old blocklist missed the title brand", () => {
  const staleProfile: CompetitorProfile = {
    ...profile,
    references: [{
      asin: "B09RPZN45W",
      url: "https://www.amazon.com/dp/B09RPZN45W",
      title: "Stuff4 Best Cat Dad Ever Mug Funny Gift for Cat Lovers",
      attributes: {},
    }],
    keyword_candidates: [{
      value: "stuff4 feline owner present",
      sources: ["B09RPZN45W"],
      confidence: "medium",
      usable_for_listing: true,
      missing_own_facts: [],
    }],
    blocked_terms: [],
  };
  const value = optimizeBackendSearchTerms({
    listing,
    input: { ...input, research: { ...input.research, competitor_profile: staleProfile } },
    competitorProfile: staleProfile,
    maxBytes: 249,
  });

  assert.doesNotMatch(value, /stuff4/i);
  assert.match(value, /feline|owner|present/i);
});

test("backend optimizer uses clean alternates to avoid an unnecessarily sparse field", () => {
  const visibleHeavyListing: ListingContent = {
    title: "Selsorix Cat Dad Mug, Funny Gift for Men, Husband, Father, Son and Daughter, 15 oz",
    bullet_points: [
      "A feline companion theme for a cat dad.",
      "For Father's Day, birthdays, and Christmas.",
      "Coffee and tea during his morning routine.",
      "For boyfriends, grandfathers, friends, and coworkers.",
      "A cat graphic on a white mug.",
    ],
    description: "Gift context for a cat owner.",
    backend_search_terms: "",
  };
  const value = optimizeBackendSearchTerms({
    listing: visibleHeavyListing,
    input: {
      ...input,
      backend_keywords: [],
      research: {
        ...input.research,
        target_customer: "son, daughter",
        occasion: ["Father's Day"],
      },
    },
    maxBytes: 249,
  });
  const bytes = new TextEncoder().encode(value).length;

  assert.ok(bytes >= 90, `Expected at least 90 useful bytes, received ${bytes}: ${value}`);
  assert.ok(bytes < 250);
  assert.match(value, /kitty|drinkware|spouse|hubby|partner|grandpa|colleague|bday|xmas/);
  assert.doesNotMatch(value, /women|wife|girlfriend|mother|grandmother|stuff4|12oz/i);
});
