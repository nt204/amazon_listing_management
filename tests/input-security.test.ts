import assert from "node:assert/strict";
import test from "node:test";
import { listingInputSchema } from "../lib/schemas";

function inputWithImage(type: "image/png" | "image/jpeg", dataUrl: string) {
  return {
    marketplace: "US",
    product_type: "Mug",
    internal_name: "Mug",
    brand: "",
    product_information: {
      material: "", size_capacity: "", color: "", package_contents: "", features: [],
      personalization: "", care_instructions: "", country_of_origin: "",
    },
    main_keyword: "mug",
    related_keywords: [],
    backend_keywords: [],
    research: {
      target_customer: "", occasion: [], customer_insight: "", usp: "",
      competitor_asins: [], competitor_notes: "", notes: "",
    },
    images: [{ name: "test.png", type, data_url: dataUrl }],
    configuration: {
      ai_provider: "auto", gemini_model: "model", openai_model: "model", language: "English",
      tone: "Natural", bullet_count: 5, title_length: 180, bullet_length: 250,
      generate_description: true, generate_search_terms: true,
    },
  };
}

test("image input validates MIME agreement and decoded byte limits", () => {
  assert.equal(
    listingInputSchema.safeParse(inputWithImage("image/jpeg", "data:image/png;base64,AA==")).success,
    false,
  );
  const previous = process.env.MAX_IMAGE_BYTES;
  process.env.MAX_IMAGE_BYTES = "2";
  try {
    assert.equal(
      listingInputSchema.safeParse(inputWithImage("image/png", "data:image/png;base64,AAAA")).success,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.MAX_IMAGE_BYTES;
    else process.env.MAX_IMAGE_BYTES = previous;
  }
});
