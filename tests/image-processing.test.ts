import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  createStoredImageDerivatives,
  createTrelloImageDerivatives,
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

test("Trello display derivatives are bounded WebP files and leave the master untouched", async () => {
  const master = await sharp({
    create: {
      width: 2_000,
      height: 1_500,
      channels: 4,
      background: { r: 25, g: 120, b: 220, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
  const masterCopy = Buffer.from(master);

  const derivatives = await createTrelloImageDerivatives(master);
  assert.deepEqual(master, masterCopy);
  assert.deepEqual(
    derivatives.map((item) => item.variant),
    ["preview", "thumbnail"],
  );

  const preview = derivatives.find((item) => item.variant === "preview");
  const thumbnail = derivatives.find((item) => item.variant === "thumbnail");
  assert.ok(preview);
  assert.ok(thumbnail);
  assert.equal(preview.mimeType, "image/webp");
  assert.equal(thumbnail.mimeType, "image/webp");
  assert.ok(Math.max(preview.width, preview.height) <= 1_280);
  assert.ok(Math.max(thumbnail.width, thumbnail.height) <= 320);
  assert.match(preview.sha256, /^[a-f0-9]{64}$/);
  assert.match(thumbnail.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await sharp(preview.bytes).metadata()).format, "webp");
  assert.equal((await sharp(thumbnail.bytes).metadata()).format, "webp");
});
