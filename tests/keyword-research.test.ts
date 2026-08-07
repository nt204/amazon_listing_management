import assert from "node:assert/strict";
import test from "node:test";
import {
  createKeywordResearchSnapshot,
  formatGenericKeywords,
  type KeywordResearchContext,
} from "../lib/keyword-research";

const context: KeywordResearchContext = {
  marketplace: "US",
  main_keyword: "cat dad mug",
  product_type: "Mug",
  brand: "North Pine Gifts",
  product_information: {
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 mug",
    features: ["Printed on both sides"],
    personalization: "",
    care_instructions: "Hand wash",
    country_of_origin: "",
  },
  target_customer: "Cat dads",
  occasion: ["Father's Day"],
  stop_words: ["a", "and", "for", "the", "with"],
  prohibited_words: ["best", "sale"],
  role_words: ["dad", "father", "owner", "lover"],
  occasion_words: ["Father's Day", "Birthday", "Christmas"],
  competitor_count: 5,
  minimum_attribute_search_volume: 150,
  maximum_generic_keywords: 20,
  minimum_relevance_score: 45,
};

const asins = ["B000000001", "B000000002", "B000000003", "B000000004", "B000000005"];

test("keyword research ranks relevant competitor terms and rejects high-volume noise", () => {
  const research = createKeywordResearchSnapshot({
    context,
    source: "helium10",
    competitorAsins: asins,
    capturedAt: new Date(0).toISOString(),
    rawTerms: [
      { keyword: "cat dad gift mug", search_volume: 2_000, organic_rank: 5, competitor_asins: asins },
      { keyword: "cat dad mug", search_volume: 2_500, organic_rank: 8, competitor_asins: asins },
      { keyword: "ceramic cat dad mug", search_volume: 120, organic_rank: 10, competitor_asins: asins.slice(0, 4) },
      { keyword: "white cat dad mug", search_volume: 220, organic_rank: 14, competitor_asins: asins.slice(0, 3) },
      { keyword: "stainless steel cat dad mug", search_volume: 1_100, organic_rank: 9, competitor_asins: asins.slice(0, 4) },
      { keyword: "wholesale kitchen mug", search_volume: 9_000, organic_rank: 2, competitor_asins: asins.slice(0, 1) },
      { keyword: "North Pine Gifts cat mug", search_volume: 600, organic_rank: 12, competitor_asins: asins.slice(0, 2) },
    ],
  });

  assert.deepEqual(research.competitor_asins, asins);
  assert.deepEqual(research.top_core_keywords, ["cat dad mug", "cat dad gift mug"]);
  assert.equal(research.terms.find((term) => term.keyword === "white cat dad mug")?.selected, true);
  assert.match(
    research.terms.find((term) => term.keyword === "ceramic cat dad mug")?.exclusion_reason || "",
    /Search Volume > 150/,
  );
  assert.equal(research.terms.find((term) => term.keyword === "wholesale kitchen mug")?.selected, false);
  assert.equal(research.terms.find((term) => term.keyword === "north pine gifts cat mug")?.selected, false);
  assert.match(
    research.terms.find((term) => term.keyword === "stainless steel cat dad mug")?.exclusion_reason || "",
    /chưa được xác nhận/i,
  );
});

test("search terms are lowercase, unique, stop-word free and byte limited", () => {
  const research = createKeywordResearchSnapshot({
    context,
    source: "helium10",
    competitorAsins: asins,
    rawTerms: [
      { keyword: "Cat Dad Mug for Father", search_volume: 800, competitor_asins: asins },
      { keyword: "Father Cat Mug Gift", search_volume: 500, competitor_asins: asins.slice(0, 4) },
    ],
  });
  const words = research.search_terms.split(" ");
  assert.equal(research.search_terms, research.search_terms.toLowerCase());
  assert.equal(new Set(words).size, words.length);
  assert.ok(!words.includes("for"));
  assert.ok(new TextEncoder().encode(research.search_terms).length <= 249);
});

test("generic keyword display uses Title Case and semicolon separators", () => {
  assert.equal(
    formatGenericKeywords(["cat dad mug", "father's day gift"]),
    "Cat Dad Mug; Father's Day Gift",
  );
});
