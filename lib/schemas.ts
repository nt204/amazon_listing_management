import { z } from "zod";

const cleanedString = z.string().trim();

export const listingInputSchema = z.object({
  marketplace: z.enum(["US", "UK", "DE"]),
  product_type: cleanedString.min(1, "Hãy chọn loại sản phẩm."),
  internal_name: cleanedString.min(1, "Thiếu tên nội bộ của sản phẩm."),
  brand: cleanedString,
  brand_profile_id: cleanedString.optional().default(""),
  brand_guidelines: cleanedString.max(10_000).optional().default(""),
  product_information: z.object({
    material: cleanedString,
    size_capacity: cleanedString,
    color: cleanedString,
    package_contents: cleanedString,
    features: z.array(cleanedString).max(20),
    personalization: cleanedString,
    care_instructions: cleanedString,
    country_of_origin: cleanedString,
  }),
  main_keyword: cleanedString.min(1, "Hãy nhập từ khóa chính."),
  related_keywords: z.array(cleanedString).max(50),
  backend_keywords: z.array(cleanedString).max(50),
  research: z.object({
    target_customer: cleanedString,
    occasion: z.array(cleanedString).max(20),
    customer_insight: cleanedString,
    usp: cleanedString,
    competitor_asins: z.array(cleanedString).max(20),
    competitor_notes: cleanedString.max(20_000).default(""),
    notes: cleanedString.max(20_000),
  }),
  images: z
    .array(
      z.object({
        name: cleanedString,
        type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data_url: z.string().startsWith("data:image/"),
      }),
    )
    .min(1, "Hãy tải ít nhất một ảnh sản phẩm.")
    .max(10, "Chỉ được tải tối đa 10 ảnh."),
  configuration: z.object({
    ai_provider: z.enum(["auto", "gemini", "openai"]),
    gemini_model: z.enum([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]),
    openai_model: z.enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
    language: cleanedString.min(1),
    tone: cleanedString.min(1),
    bullet_count: z.number().int().min(3).max(7),
    title_length: z.number().int().min(80).max(200),
    bullet_length: z.number().int().min(100).max(500),
    generate_description: z.boolean(),
    generate_search_terms: z.boolean(),
  }),
});

export const generatedListingSchema = z.object({
  title: z.string(),
  bullet_points: z.array(z.string()).length(5),
  description: z.string(),
  backend_search_terms: z.string(),
});

export const reviewInstructionSchema = z.object({
  instruction: cleanedString
    .min(2, "Hãy nhập yêu cầu chỉnh sửa.")
    .max(2_000, "Yêu cầu chỉnh sửa tối đa 2.000 ký tự."),
});

export const workflowStatusSchema = z.object({
  status: z.enum(["Review"]),
});

export const batchListingSchema = z.object({
  items: z.array(listingInputSchema).min(1).max(10),
});

export const brandProfileSchema = z.object({
  name: cleanedString.min(1, "Hãy nhập tên brand.").max(120),
  guidelines: cleanedString.max(10_000),
});

export const productBriefSchema = z.object({
  visual_facts: z.array(z.string().trim().min(1)).max(20),
  exact_text: z.array(z.string().trim().min(1)).max(20),
  colors: z.array(z.string().trim().min(1)).max(12),
  styles: z.array(z.string().trim().min(1)).max(10),
  subjects: z.array(z.string().trim().min(1)).max(15),
  supplied_facts: z.array(z.string().trim().min(1)).max(25),
  inferred_audiences: z.array(z.string().trim().min(1)).max(10),
  inferred_occasions: z.array(z.string().trim().min(1)).max(10),
  related_keywords: z.array(z.string().trim().min(1)).min(5).max(12),
  competitor_insights: z.array(z.string().trim().min(1)).max(10),
  listing_angle: z.string().trim().min(1),
  facts_to_avoid: z.array(z.string().trim().min(1)).max(15),
  policy_risks: z.array(z.string().trim().min(1)).max(10),
});

export const generatedListingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "bullet_points", "description", "backend_search_terms"],
  properties: {
    title: {
      type: "string",
      description: "Natural Amazon title using all meaningful main-keyword terms without redundant words.",
    },
    bullet_points: {
      type: "array",
      description: "Exactly five distinct, evidence-based product bullets.",
      items: { type: "string" },
      minItems: 5,
      maxItems: 5,
    },
    description: {
      type: "string",
      description: "Concise factual product description without unsupported claims or generic filler.",
    },
    backend_search_terms: {
      type: "string",
      description: "Space-separated high-relevance search terms with no punctuation or duplicate words.",
    },
  },
} as const;

const stringArray = (description: string, maxItems: number, minItems = 0) => ({
  type: "array",
  description,
  items: { type: "string" },
  minItems,
  maxItems,
});

export const productBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "visual_facts",
    "exact_text",
    "colors",
    "styles",
    "subjects",
    "supplied_facts",
    "inferred_audiences",
    "inferred_occasions",
    "related_keywords",
    "competitor_insights",
    "listing_angle",
    "facts_to_avoid",
    "policy_risks",
  ],
  properties: {
    visual_facts: stringArray("Facts directly visible in the supplied product images.", 20),
    exact_text: stringArray("Verbatim text visible in the artwork or product images.", 20),
    colors: stringArray("Prominent colors directly visible in the product design.", 12),
    styles: stringArray("Visual design styles supported by the images.", 10),
    subjects: stringArray("Objects, characters, icons, or motifs visible in the images.", 15),
    supplied_facts: stringArray(
      "Atomic product facts explicitly supplied by the operator, preferably formatted as Label: value.",
      25,
    ),
    inferred_audiences: stringArray("Likely audiences inferred from the keyword and design, not product facts.", 10),
    inferred_occasions: stringArray("Likely shopping or gifting occasions inferred from context.", 10),
    related_keywords: stringArray("Natural high-relevance search phrases derived from the main keyword and evidence.", 12, 5),
    competitor_insights: stringArray("Positioning or keyword insights from reference listings without copied wording.", 10),
    listing_angle: {
      type: "string",
      description: "One concise positioning direction grounded in the strongest evidence.",
    },
    facts_to_avoid: stringArray("Claims explicitly forbidden by the operator or not supported by evidence.", 15),
    policy_risks: stringArray("Potential trademark, character, copyright, hate, medical, or restricted-language risks.", 10),
  },
} as const;
