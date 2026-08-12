import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  createStoredImageDerivatives,
  prepareListingImagesForAi,
} from "../lib/image-processing";
import type { ListingInput } from "../lib/types";

function inputWithImage(dataUrl: string): ListingInput {
  return {
    marketplace: "US",
    product_type: "Hanging Ornament",
    internal_name: "TEST-SKU",
    brand: "Limima",
    product_information: {
      material: "Glass",
      size_capacity: "3.1 inches",
      color: "Red",
      package_contents: "1 ornament",
      features: [],
      personalization: "",
      care_instructions: "",
      country_of_origin: "US",
    },
    main_keyword: "hanging ornament",
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
    images: [{ name: "master.png", type: "image/png", data_url: dataUrl }],
    configuration: {
      ai_provider: "auto",
      gemini_model: "gemini-test",
      openai_model: "gpt-test",
      language: "English",
      tone: "Natural",
      bullet_count: 5,
      title_length: 200,
      bullet_length: 300,
      generate_description: true,
      generate_search_terms: true,
    },
  };
}

test("image pipeline keeps exact master bytes and creates bounded derivatives", async () => {
  const master = await sharp({
    create: {
      width: 1_900,
      height: 1_200,
      channels: 4,
      background: { r: 220, g: 30, b: 40, alpha: 0.75 },
    },
  })
    .png()
    .toBuffer();
  const originalDataUrl = `data:image/png;base64,${master.toString("base64")}`;

  const prepared = await prepareListingImagesForAi(inputWithImage(originalDataUrl));
  assert.equal(prepared.images[0].original_data_url, originalDataUrl);
  assert.equal(prepared.images[0].type, "image/jpeg");

  const derivatives = await createStoredImageDerivatives(prepared.images[0]);
  assert.deepEqual(derivatives.originalBytes, master);
  assert.equal(derivatives.originalMimeType, "image/png");
  assert.equal(derivatives.previewMimeType, "image/webp");

  const aiMetadata = await sharp(derivatives.aiBytes).metadata();
  const previewMetadata = await sharp(derivatives.previewBytes).metadata();
  assert.ok(Math.max(aiMetadata.width || 0, aiMetadata.height || 0) <= 1_600);
  assert.ok(
    Math.max(previewMetadata.width || 0, previewMetadata.height || 0) <= 640,
  );
});
