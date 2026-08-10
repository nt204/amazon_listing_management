import assert from "node:assert/strict";
import test from "node:test";
import { buildExcelListingInput, splitGenericKeywords, toAmazonTemplateItem } from "@/lib/excel-batch";
import type { ListingInput, StoredListing } from "@/lib/types";

const baseInput = {
  marketplace: "US",
  product_type: "Old product",
  internal_name: "Old item",
  brand: "Celsorix",
  brand_profile_id: "brand-1",
  brand_guidelines: "Use a warm tone.",
  product_information: {
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 mug",
    features: ["Old feature"],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  },
  main_keyword: "old keyword",
  related_keywords: ["old related keyword"],
  backend_keywords: ["old generic keyword"],
  research: {
    target_customer: "Old audience",
    gift_giver: "Old giver",
    occasion: ["Old occasion"],
    customer_insight: "Old insight",
    usp: "Old USP",
    competitor_asins: [],
    competitor_notes: "Old competitor",
    notes: "Old notes",
  },
  images: [],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.5-flash-lite",
    openai_model: "gpt-5.6-terra",
    language: "English",
    tone: "Natural",
    bullet_count: 3,
    title_length: 100,
    bullet_length: 150,
    generate_description: false,
    generate_search_terms: false,
  },
} satisfies ListingInput;

const row = {
  source_row: 2,
  sku: "AOTT0001L01C",
  main_keyword: "memorial hanging ornament",
  generic_keywords: "sympathy keepsake | remembrance gift; memorial decor\nfamily ornament",
  image_urls: ["https://trello.com/product.png"],
};

const template = {
  id: "template-1",
  name: "Hanging Ornament",
  original_filename: "HANGING_ORNAMENT.xlsx",
  file_extension: ".xlsx",
  product_type: "HANGING_ORNAMENT",
  metadata: {
    sheet_name: "Template",
    attribute_row: 5,
    label_row: 4,
    data_row: 7,
    column_count: 346,
    last_column: "MH",
    source_parent_row: 7,
    source_child_row: 8,
    content_columns: {
      sku: "A",
      title: "G",
      description: "AJ",
      bullet_points: ["AK", "AL", "AM", "AN", "AO"],
      generic_keywords: "AP",
      main_image: "Z",
    },
    defaults: {
      material: "Acrylic",
      size_capacity: "3.5 x 3.5 x 0.05 Inches",
      color: "",
      package_contents: "Ribbon",
      features: ["2D flat printed hanging ornament"],
      country_of_origin: "Vietnam",
    },
  },
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

test("splitGenericKeywords accepts the separators used in Excel", () => {
  assert.deepEqual(splitGenericKeywords(row.generic_keywords), [
    "sympathy keepsake",
    "remembrance gift",
    "memorial decor",
    "family ornament",
  ]);
});

test("Excel import builds a self-contained Hanging Ornament input", () => {
  const images = [{ name: "product.png", type: "image/png", data_url: "data:image/png;base64,AAAA" }];
  const input = buildExcelListingInput(baseInput, row, images, template);

  assert.equal(input.internal_name, row.sku);
  assert.equal(input.brand, "Celsorix");
  assert.equal(input.product_type, "Hanging Ornament");
  assert.equal(input.main_keyword, row.main_keyword);
  assert.equal(input.product_information.material, "Acrylic");
  assert.match(input.product_information.size_capacity, /3\.5 x 3\.5 x 0\.05 Inches/);
  assert.deepEqual(input.backend_keywords, splitGenericKeywords(row.generic_keywords));
  assert.equal(input.research.target_customer, "");
  assert.equal(input.configuration.bullet_count, 5);
  assert.equal(input.configuration.title_length, 200);
  assert.equal(input.configuration.bullet_length, 300);
  assert.equal(input.configuration.generate_description, true);
  assert.equal(input.configuration.generate_search_terms, true);
});

test("Amazon template export keeps original Trello URLs and generated content", () => {
  const listing = {
    input: baseInput,
    current_listing: {
      title: "Generated title",
      bullet_points: ["One", "Two", "Three", "Four", "Five"],
      description: "Generated description",
      backend_search_terms: "generated generic keywords",
    },
  } as unknown as StoredListing;

  assert.deepEqual(toAmazonTemplateItem(row, listing), {
    sku: row.sku,
    image_urls: row.image_urls,
    brand: "Celsorix",
    listing: listing.current_listing,
  });
});
