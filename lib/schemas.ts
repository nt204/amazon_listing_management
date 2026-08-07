import { z } from "zod";
import { getGeminiModels, getOpenAIModels } from "@/lib/models";

const cleanedString = z.string().trim();

const productInformationSchema = z.object({
  material: cleanedString,
  size_capacity: cleanedString,
  color: cleanedString,
  package_contents: cleanedString,
  features: z.array(cleanedString).max(20),
  personalization: cleanedString,
  care_instructions: cleanedString,
  country_of_origin: cleanedString,
});

const keywordResearchCategorySchema = z.enum([
  "core",
  "long_tail",
  "occasion",
  "audience",
  "attribute",
  "other",
]);

const nullableMetric = z.number().nonnegative().nullable();

const keywordResearchTermSchema = z.object({
  keyword: cleanedString.min(1).max(200),
  search_volume: nullableMetric,
  cpc: nullableMetric,
  iq_score: nullableMetric,
  organic_rank: nullableMetric,
  sponsored_rank: nullableMetric,
  competitor_asins: z.array(cleanedString).max(20),
  competitor_count: z.number().int().nonnegative(),
  category: keywordResearchCategorySchema,
  relevance_score: z.number().min(0).max(100),
  opportunity_score: z.number().min(0).max(100),
  selected: z.boolean(),
  exclusion_reason: cleanedString.max(500).optional(),
});

const keywordResearchSnapshotSchema = z.object({
  source: z.enum(["helium10", "mock"]),
  seed_keyword: cleanedString.min(1).max(200),
  marketplace: z.enum(["US", "UK", "DE"]),
  competitor_asins: z.array(cleanedString).max(20),
  terms: z.array(keywordResearchTermSchema).max(1_000),
  generic_keywords: z.array(cleanedString).max(100),
  search_terms: cleanedString.max(500),
  top_core_keywords: z.array(cleanedString).max(2),
  minimum_attribute_search_volume: z.number().nonnegative(),
  captured_at: cleanedString,
  warnings: z.array(cleanedString.max(1_000)).max(50),
});

function configuredBytes(name: string, fallback: number) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function decodedBase64Bytes(value: string) {
  const payload = value.slice(value.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

const imageInputSchema = z.object({
  name: cleanedString.max(255),
  type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data_url: z.string(),
}).superRefine((image, context) => {
  const match = image.data_url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1] !== image.type) {
    context.addIssue({ code: "custom", path: ["data_url"], message: "Invalid image data or MIME type." });
    return;
  }
  const maxBytes = configuredBytes("MAX_IMAGE_BYTES", 5_000_000);
  if (decodedBase64Bytes(image.data_url) > maxBytes) {
    context.addIssue({ code: "custom", path: ["data_url"], message: `Image exceeds ${maxBytes} bytes.` });
  }
});

export const listingInputSchema = z.object({
  marketplace: z.enum(["US", "UK", "DE"]),
  product_type: cleanedString.min(1, "Hãy chọn loại sản phẩm."),
  internal_name: cleanedString.min(1, "Thiếu tên nội bộ của sản phẩm."),
  brand: cleanedString,
  brand_profile_id: cleanedString.optional().default(""),
  brand_guidelines: cleanedString.max(10_000).optional().default(""),
  product_information: productInformationSchema,
  main_keyword: cleanedString.min(1, "Hãy nhập từ khóa chính."),
  related_keywords: z.array(cleanedString).max(50),
  backend_keywords: z.array(cleanedString).max(50),
  research: z.object({
    target_customer: cleanedString,
    gift_giver: cleanedString.optional().default(""),
    occasion: z.array(cleanedString).max(20),
    customer_insight: cleanedString,
    usp: cleanedString,
    competitor_asins: z.array(cleanedString).max(20),
    competitor_notes: cleanedString.max(20_000).default(""),
    notes: cleanedString.max(20_000),
    keyword_research: keywordResearchSnapshotSchema.optional(),
  }),
  images: z.array(imageInputSchema)
    .min(1, "Hãy tải ít nhất một ảnh sản phẩm.")
    .max(10, "Chỉ được tải tối đa 10 ảnh.")
    .superRefine((images, context) => {
      const total = images.reduce((sum, image) => sum + decodedBase64Bytes(image.data_url), 0);
      const maxTotal = configuredBytes("MAX_TOTAL_IMAGE_BYTES", 20_000_000);
      if (total > maxTotal) context.addIssue({ code: "custom", message: `Total image payload exceeds ${maxTotal} bytes.` });
    }),
  configuration: z.object({
    rule_profile: cleanedString.max(120).optional().default(""),
    ai_provider: z.enum(["auto", "gemini", "openai"]),
    gemini_model: cleanedString.refine(
      (value) => getGeminiModels().some((model) => model.id === value),
      "Gemini model is not in the configured model catalog.",
    ),
    openai_model: cleanedString.refine(
      (value) => getOpenAIModels().some((model) => model.id === value),
      "OpenAI model is not in the configured model catalog.",
    ),
    language: cleanedString.min(1),
    tone: cleanedString.min(1),
    bullet_count: z.number().int().min(3).max(7),
    title_length: z.number().int().min(40).max(200),
    bullet_length: z.number().int().min(100).max(500),
    generate_description: z.boolean(),
    generate_search_terms: z.boolean(),
  }),
});

export const keywordResearchRequestSchema = z.object({
  marketplace: z.enum(["US", "UK", "DE"]),
  main_keyword: cleanedString.min(1, "Hãy nhập từ khóa chính."),
  product_type: cleanedString.min(1, "Hãy chọn loại sản phẩm."),
  brand: cleanedString,
  product_information: productInformationSchema,
  target_customer: cleanedString,
  occasion: z.array(cleanedString).max(20),
  rule_profile: cleanedString.max(120).optional().default(""),
});

export const generatedListingSchema = z.object({
  title: z.string(),
  bullet_points: z.array(z.string()).length(5),
  description: z.string(),
  backend_search_terms: z.string(),
});

export const generatedListingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "bullet_points", "description", "backend_search_terms"],
  properties: {
    title: { type: "string", description: "Natural Amazon SEO title." },
    bullet_points: {
      type: "array",
      description: "Exactly five clear feature-and-benefit bullet points.",
      items: { type: "string" },
    },
    description: { type: "string", description: "Factual product description." },
    backend_search_terms: {
      type: "string",
      description: "Relevant space-separated Amazon backend search terms without punctuation.",
    },
  },
} as const;

export const reviewInstructionSchema = z.object({
  instruction: cleanedString.min(2, "Hãy nhập yêu cầu chỉnh sửa.").max(2_000),
});

export const workflowStatusSchema = z.object({ status: z.enum(["Review"]) });
export const batchListingSchema = z.object({ items: z.array(listingInputSchema).min(1).max(10) });
export const brandProfileSchema = z.object({
  name: cleanedString.min(1, "Hãy nhập tên brand.").max(120),
  guidelines: cleanedString.max(10_000),
});
