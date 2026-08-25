import "server-only";

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { enrichCompetitorResearch } from "@/lib/competitor";
import { buildOperatorEvidenceItems, inferEvidenceCategory } from "@/lib/evidence";
import { enrichListingKeywordResearch } from "@/lib/helium10";
import { extractLocalOcr } from "@/lib/local-ocr";
import {
  cleanGeneratedTitle,
  trimAtWordBoundary,
  trimDescriptionToTarget,
} from "@/lib/listing-sanitizer";
import { createMockListing } from "@/lib/mock";
import { getGeminiModels, getOpenAIModels } from "@/lib/models";
import { getPolicy } from "@/lib/policies";
import { getRuleRegistry } from "@/lib/rules";
import {
  aiGeneratedListingSchema,
  generatedListingJsonSchema,
} from "@/lib/schemas";
import { optimizeBackendSearchTerms } from "@/lib/search-terms";
import { buildTitleBlueprint, type TitleBlueprint } from "@/lib/title-strategy";
import { analyzeListing } from "@/lib/validation";
import type {
  ListingContent,
  ListingInput,
  ListingResult,
  ProductBrief,
  ProductEvidenceItem,
} from "@/lib/types";
import type { LocalOcrResult } from "@/lib/ocr";

type Provider = "gemini" | "openai";

export interface GenerationOptions {
  productBrief?: ProductBrief;
  writingFeedback?: string;
  currentListing?: ListingContent;
  reviewInstruction?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ListingGenerationProgress) => void;
}

export type ListingGenerationStage =
  | "keyword_research"
  | "competitor_research"
  | "ocr"
  | "ai_writer"
  | "validation";

export interface ListingGenerationProgress {
  stage: ListingGenerationStage;
  status: "started" | "completed";
  duration_ms?: number;
}

interface ProviderOutput {
  listing: ListingContent;
  inputTokens?: number;
  outputTokens?: number;
}

function listingResponseSchema(input: ListingInput) {
  const policy = getPolicy(input);
  return {
    ...generatedListingJsonSchema,
    properties: {
      ...generatedListingJsonSchema.properties,
      title: {
        ...generatedListingJsonSchema.properties.title,
        minLength: 1,
        maxLength: policy.titleMax,
      },
      bullet_points: {
        ...generatedListingJsonSchema.properties.bullet_points,
        items: {
          type: "string",
          minLength: Math.min(100, policy.bulletMax),
          maxLength: policy.bulletMax,
        },
      },
      description: {
        ...generatedListingJsonSchema.properties.description,
        minLength: input.configuration.generate_description ? policy.descriptionTargetMin : 0,
        maxLength: input.configuration.generate_description ? policy.descriptionTargetMax : 0,
      },
    },
  } as const;
}

const systemInstruction = `Create clear Amazon listing copy from the supplied product input.
Operator facts, supplied product-image OCR, and directly visible product attributes are the source of truth. Use raw images to identify product form, design/theme, intended setting, visible hardware, and clearly readable specification text. Numeric specifications and non-visible claims require operator data, OCR, or clearly readable image text.
Competitor data is light inspiration for search intent, strengths, and gaps. Never copy its wording, brand, ASIN, or unsupported product claims.
Use natural English Title Case in titles: capitalize important words, but keep articles, conjunctions, and short prepositions lowercase. Write visible artwork wording in readable Title Case without quotation marks.
Return only the requested JSON.`;

// The OpenAI SDK requires a finite positive timeout. Keep its watchdog near the
// maximum safe setTimeout value so Listing cancellation remains user-controlled.
const MANUAL_CANCELLATION_TIMEOUT_MS = 2_147_000_000;

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL.");
  return { mimeType: match[1], data: match[2] };
}

function withCancellation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
) {
  return operation(parentSignal || new AbortController().signal);
}

function simpleCompetitorReference(input: ListingInput) {
  const profile = input.research.competitor_profile;
  if (!profile) return undefined;
  return {
    titles_for_context_only: profile.references.map((reference) => reference.title).filter(Boolean).slice(0, 3),
    useful_search_language: profile.keyword_candidates
      .filter((keyword) => keyword.usable_for_listing)
      .map((keyword) => keyword.value)
      .slice(0, 8),
    audiences: profile.audiences.map((audience) => audience.value).slice(0, 5),
    occasions: profile.occasions.map((occasion) => occasion.value).slice(0, 5),
    competitor_claims_also_confirmed_by_operator: profile.claims
      .filter((claim) => claim.own_evidence === "confirmed")
      .map((claim) => claim.value)
      .slice(0, 8),
  };
}

function operatorInput(input: ListingInput) {
  return {
    marketplace: input.marketplace,
    product_type_hint: input.product_type,
    brand: input.brand || undefined,
    main_keyword: input.main_keyword,
    keyword_candidates: input.related_keywords,
    preferred_backend_keywords: input.backend_keywords,
    target_customer: input.research.target_customer || undefined,
    gift_giver: input.research.gift_giver || undefined,
    occasions: input.research.occasion,
    customer_insight: input.research.customer_insight || undefined,
    usp: input.research.usp || undefined,
    product_facts: {
      ...input.product_information,
      features: input.product_information.features,
      additional_notes: input.research.notes || undefined,
    },
    language: input.configuration.language,
    tone: input.configuration.tone,
    brand_guidelines: input.brand_guidelines || undefined,
  };
}

function ocrInput(ocr: LocalOcrResult | undefined, brief: ProductBrief | undefined) {
  if (ocr && ["success", "partial"].includes(ocr.status)) {
    return ocr.lines.map((line) => ({
      image: line.sourceImage,
      confidence: line.confidence,
      text: line.text,
    }));
  }
  return (brief?.exact_text || []).map((text) => ({ text }));
}

function buildPrompt(
  input: ListingInput,
  ocr: LocalOcrResult | undefined,
  options: GenerationOptions,
  titleBlueprint: TitleBlueprint,
) {
  const policy = getPolicy(input);
  return `Create one Amazon ${input.marketplace} listing.

Requirements:
- Title: follow this slot order: [BRAND] [CORE PRODUCT TYPE], [THEME/DESIGN] [PRIMARY SEARCH INTENT] [RECIPIENT], [KEY ATTRIBUTE/USE] [FEATURE], [SIZE/COUNT]. Keep supported slots in this order. Do not output brackets or plus signs.
- Use the exact supplied brand. CORE PRODUCT TYPE must clearly identify what the item physically is in specific shopper-facing language; operator.product_type_hint is a category hint, not wording that must be copied.
- PRIMARY SEARCH INTENT must contain operator.main_keyword using the same words in the same order; letter casing may change for natural Title Case. This is required in every title. A distinct relevant measured or related keyword may supplement the main keyword but must never replace it.
- Relevance outranks search volume. Never use a keyword that changes the product type, placement, recipient, or use. Gift intent must not replace the core product type.
- RECIPIENT must be a specific target person or relationship (e.g. "for Mom", "for Men", "for Teachers") ONLY when explicitly supported by input data. NEVER write generic filler phrases like "for buyers", "for gift buyers", "for shoppers", "for customers", or "for recipient". If no specific target recipient is specified, omit the recipient slot completely.
- Fill every supported slot with distinct information. Omit unsupported slots and their separators; never invent content merely to complete the formula.
- Write natural Title Case with ordinary punctuation. Do not use quotation marks or the characters ! $ ? _ { } ^ ¬ ¦ unless one appears in the exact supplied brand. Avoid synonym stacking and do not repeat a meaningful word more than twice; grammar words are exempt.
- Aim for ${titleBlueprint.idealMinimumCharacters}-${titleBlueprint.idealMaximumCharacters} useful characters. The hard limit is ${Math.min(policy.titleMax, titleBlueprint.maxCharacters)} characters. Use the available space for supported shopper information and relevant long-tail intent, but never add filler or redundant phrases to reach the target.
- Return the final polished title yourself. The server only cleans spacing and enforces the hard length limit.
- Bullets: write exactly 5 detailed, information-rich Amazon bullets of about ${policy.bulletTargetMin}-${Math.min(policy.bulletTargetMax, policy.bulletMax)} characters each, as plain text in this exact format: BENEFIT-LED HEADER IN CAPS: Natural sentence.
- Build each bullet as hook or key benefit + verified feature + customer benefit + relevant use case. Add relevant keywords naturally without keyword stuffing.
- Cover these angles in order: primary message or benefit; design or style; verified size, material, capacity, or other useful detail; ease of use, care, or display; recipient and gift occasion.
- If an angle lacks verified evidence, replace it with another supported benefit. Keep every bullet distinct. Do not use numbering, bullet symbols, brackets, Markdown, emojis, price or shipping information, seller details, promotions, guarantees, refunds, or calls to action.
- Description: ${input.configuration.generate_description ? `about ${policy.descriptionTargetMin}-${policy.descriptionTargetMax} characters` : "empty string"}; create a detailed product narrative that opens with the primary purpose, then explains supported design, physical details, use context, audience, and occasions in natural paragraphs. Expand on the product instead of repeating the five bullets sentence-for-sentence. Do not include promotional, pricing, shipping, contact, or seller information.
- Generic keywords: ${input.configuration.generate_search_terms ? `return one space-separated string in generic_keywords within ${policy.searchTermsMaxBytes} bytes, prioritizing relevant synonyms, alternate shopper wording, audience, and occasion terms not already well covered in visible copy` : "return an empty generic_keywords string"}; no punctuation, brands, competitor names, ASINs, filler, subjective claims, or duplicate words.
- Use operator data and OCR that clearly belongs to the product. Ignore OCR noise and do not complete missing text.
- Numbers, material, package contents, manufacturing method, weight, care, personalization, origin, safety, and performance may be stated only when the exact detail appears in operator data, supplied OCR, or clearly readable product-image text, never from a competitor or visual inference.
- Do not add unsupported quality adjectives such as premium, high-quality, durable, genuine, sturdy, or heavy.
- Generate the copy and search vocabulary yourself. Use competitor information only to understand context, useful choices, and gaps; do not copy it.
- Before returning JSON, silently verify the product type, factual support, title length and characters, distinct bullet content, and backend-term relevance. When choosing between shorter and longer copy, prefer the longer version only when every added phrase contributes verified product information, a customer benefit, useful context, recipient or occasion intent, or relevant search vocabulary.

INPUT:
${JSON.stringify({
    title_blueprint: titleBlueprint,
    operator: operatorInput(input),
    product_image_ocr: ocrInput(ocr, options.productBrief),
    competitor_reference: simpleCompetitorReference(input),
    current_listing: options.currentListing,
    requested_revision: options.reviewInstruction || options.writingFeedback || undefined,
  }, null, 2)}`;
}

function simpleBrief(
  input: ListingInput,
  ocr: LocalOcrResult | undefined,
  existing?: ProductBrief,
): ProductBrief {
  if (existing) return existing;
  const lines = ocr?.lines || [];
  const operatorItems = buildOperatorEvidenceItems(input);
  const ocrItems: ProductEvidenceItem[] = lines.map((line, index) => ({
    id: `ocr-${index + 1}`,
    value: line.text,
    category: inferEvidenceCategory(input, line.text, "text"),
    source: "image_ocr",
    source_image: line.sourceImage,
    source_text: line.text,
    source_field: "",
    confidence: line.confidence >= 82 ? "high" : line.confidence >= 65 ? "medium" : "low",
    publishable: true,
    verification: "verified",
    reason: "Local OCR supplied directly to the listing writer.",
    selected_for_product: true,
  }));
  const competitor = simpleCompetitorReference(input);
  return {
    visual_facts: [],
    exact_text: lines.map((line) => line.text),
    selected_ocr_line_ids: [],
    ocr_selection_complete: false,
    image_facts: ocrItems.filter((item) => item.category !== "text").map((item) => item.value),
    evidence_items: [...operatorItems, ...ocrItems],
    colors: input.product_information.color ? [input.product_information.color] : [],
    styles: [],
    subjects: [],
    supplied_facts: operatorItems.map((item) => item.value),
    inferred_audiences: input.research.target_customer ? [input.research.target_customer] : [],
    inferred_occasions: input.research.occasion,
    related_keywords: [
      ...input.related_keywords,
      ...(competitor?.useful_search_language || []),
    ].slice(0, 12),
    backend_keywords: input.backend_keywords,
    competitor_insights: competitor?.titles_for_context_only.map((title) => `Reference context: ${title}`) || [],
    listing_angle: input.research.usp || input.main_keyword,
    facts_to_avoid: [],
    policy_risks: [],
    ocr: {
      engine: "tesseract",
      language: ocr?.language || "eng",
      status: ocr?.status || "disabled",
      images_processed: ocr?.imagesProcessed || 0,
      line_count: lines.length,
      selected_line_count: lines.length,
      selection: "direct",
      warnings: ocr?.warnings || [],
    },
  };
}

async function callGemini(
  input: ListingInput,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<ProviderOutput> {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const response = await withCancellation((requestSignal) =>
    client.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          ...input.images.map((image) => ({ inlineData: parseDataUrl(image.data_url) })),
        ],
      }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: listingResponseSchema(input),
        temperature: 0.2,
        abortSignal: requestSignal,
      },
    }), signal);
  if (!response.text) {
    const reason = response.candidates?.[0]?.finishReason || "unknown";
    throw new Error(`Gemini returned an empty response (finish_reason=${reason}).`);
  }
  const generated = aiGeneratedListingSchema.parse(JSON.parse(response.text));
  return {
    listing: {
      title: generated.title,
      bullet_points: generated.bullet_points,
      description: generated.description,
      backend_search_terms: generated.generic_keywords,
    },
    inputTokens: response.usageMetadata?.promptTokenCount,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
  };
}

async function callOpenAI(
  input: ListingInput,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<ProviderOutput> {
  const cheapKeyApiKey =
    process.env.CHEAPKEYAI_TEXT_API_KEY?.trim() ||
    process.env.CHEAPKEYAI_LUNA_API_KEY?.trim() ||
    process.env.CHEAPKEYAI_API_KEY?.trim();
  const cheapKeyBaseUrl = (
    process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1"
  )
    .trim()
    .replace(/\/+$/, "");

  const isCheapKeyModel = model === "gpt-5.6-luna" || model.includes("cheapkey");
  const usesCheapKey = Boolean(
    cheapKeyApiKey && (isCheapKeyModel || !process.env.OPENAI_API_KEY?.trim()),
  );

  if (isCheapKeyModel && !cheapKeyApiKey && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "CHEAPKEYAI_TEXT_API_KEY hoặc CHEAPKEYAI_API_KEY chưa được cấu hình trên server để sử dụng model gpt-5.6-luna (CheapKey AI).",
    );
  }

  const client = usesCheapKey
    ? new OpenAI({
        apiKey: cheapKeyApiKey,
        baseURL: cheapKeyBaseUrl,
      })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const targetModel = isCheapKeyModel
    ? process.env.CHEAPKEYAI_UPSTREAM_TEXT_MODEL?.trim() || model
    : model;

  let rawOutputText = "";
  let usageInputTokens: number | undefined;
  let usageOutputTokens: number | undefined;

  try {
    const response = await withCancellation(
      (requestSignal) =>
        client.responses.create(
          {
            model: targetModel,
            instructions: systemInstruction,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  ...input.images.map(
                    (image): OpenAI.Responses.ResponseInputImage => ({
                      type: "input_image",
                      image_url: image.data_url,
                      detail: "auto",
                    }),
                  ),
                ],
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "amazon_listing",
                strict: true,
                schema: listingResponseSchema(input),
              },
            },
          },
          { signal: requestSignal, maxRetries: 0, timeout: MANUAL_CANCELLATION_TIMEOUT_MS },
        ),
      signal,
    );
    rawOutputText = response.output_text;
    usageInputTokens = response.usage?.input_tokens;
    usageOutputTokens = response.usage?.output_tokens;
  } catch (responsesErr) {
    if (signal?.aborted) throw signal.reason || responsesErr;
    if (!usesCheapKey) throw responsesErr;
    // Fallback to OpenAI Chat Completion endpoint for proxy providers if v1/responses is unavailable
    const chatResponse = await withCancellation(
      (requestSignal) =>
        client.chat.completions.create(
          {
            model: targetModel,
            messages: [
              { role: "system", content: systemInstruction },
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  ...input.images.map((image) => ({
                    type: "image_url" as const,
                    image_url: { url: image.data_url },
                  })),
                ],
              },
            ],
            response_format: { type: "json_object" },
          },
          { signal: requestSignal, maxRetries: 0, timeout: MANUAL_CANCELLATION_TIMEOUT_MS },
        ),
      signal,
    );
    rawOutputText = chatResponse.choices?.[0]?.message?.content || "";
    usageInputTokens = chatResponse.usage?.prompt_tokens;
    usageOutputTokens = chatResponse.usage?.completion_tokens;
  }

  if (!rawOutputText) throw new Error("AI provider returned an empty response.");
  const generated = aiGeneratedListingSchema.parse(JSON.parse(rawOutputText));
  return {
    listing: {
      title: generated.title,
      bullet_points: generated.bullet_points,
      description: generated.description,
      backend_search_terms: generated.generic_keywords,
    },
    inputTokens: usageInputTokens,
    outputTokens: usageOutputTokens,
  };
}

function cleanListing(
  listing: ListingContent,
  input: ListingInput,
  brief: ProductBrief,
) {
  const policy = getPolicy(input);
  const title = trimAtWordBoundary(
    cleanGeneratedTitle(listing.title),
    policy.titleMax,
  );
  const bulletPoints = listing.bullet_points.slice(0, 5).map((bullet) =>
    trimAtWordBoundary(bullet, policy.bulletMax),
  );
  const description = input.configuration.generate_description
    ? trimDescriptionToTarget(listing.description, policy.descriptionTargetMin, policy.descriptionTargetMax)
    : "";
  const base: ListingContent = {
    title,
    bullet_points: bulletPoints,
    description,
    backend_search_terms: listing.backend_search_terms,
  };
  return {
    ...base,
    backend_search_terms: optimizeBackendSearchTerms({
      listing: base,
      input,
      currentValue: listing.backend_search_terms,
      relatedKeywords: brief.related_keywords,
      competitorProfile: input.research.competitor_profile,
      maxBytes: policy.searchTermsMaxBytes,
    }),
  };
}

export async function generateListing(
  sourceInput: ListingInput,
  options: GenerationOptions = {},
): Promise<ListingResult> {
  const startedAt = Date.now();
  const stageTimings: Partial<Record<ListingGenerationStage, number>> = {};
  const runStage = async <T>(stage: ListingGenerationStage, operation: () => Promise<T> | T) => {
    options.onProgress?.({ stage, status: "started" });
    const stageStartedAt = Date.now();
    try {
      return await operation();
    } finally {
      const duration = Date.now() - stageStartedAt;
      stageTimings[stage] = duration;
      options.onProgress?.({ stage, status: "completed", duration_ms: duration });
    }
  };
  const keywordInput = options.productBrief
    ? sourceInput
    : await runStage("keyword_research", () => enrichListingKeywordResearch(sourceInput, options.signal));
  const input = options.productBrief
    ? keywordInput
    : await runStage("competitor_research", () => enrichCompetitorResearch(keywordInput));
  const ocr = options.productBrief
    ? undefined
    : await runStage("ocr", () => extractLocalOcr(input, options.signal));
  const brief = simpleBrief(input, ocr, options.productBrief);
  const titleBlueprint = buildTitleBlueprint(input);
  const prompt = buildPrompt(input, ocr, options, titleBlueprint);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());
  const mock = !hasGemini && !hasOpenAI && process.env.AI_MOCK_MODE === "true";
  let modelUsed: ListingResult["model_used"] = mock ? "mock" : "gemini";
  let modelName = mock ? "mock-template" : input.configuration.gemini_model;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  let providerOutput: ProviderOutput;

  if (mock) {
    providerOutput = await runStage("ai_writer", () => ({
      listing: options.currentListing || createMockListing(input),
    }));
  } else {
    const preferred: Provider = input.configuration.ai_provider === "openai" ? "openai" : "gemini";
    const providers = [preferred, preferred === "gemini" ? "openai" : "gemini"]
      .filter((provider, index, values) => values.indexOf(provider) === index)
      .filter((provider) => provider === "gemini" ? hasGemini : hasOpenAI) as Provider[];
    if (!providers.length) throw new Error("No AI provider is configured.");
    let firstError: unknown;
    providerOutput = await runStage("ai_writer", async () => {
      try {
        const provider = providers[0];
        modelUsed = provider;
        modelName = provider === "gemini"
          ? input.configuration.gemini_model || getGeminiModels()[0].id
          : input.configuration.openai_model || getOpenAIModels()[0].id;
        return provider === "gemini"
          ? await callGemini(input, modelName, prompt, options.signal)
          : await callOpenAI(input, modelName, prompt, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason || error;
        firstError = error;
        const provider = providers[1];
        if (!provider) throw error;
        fallbackUsed = true;
        fallbackReason = error instanceof Error ? error.message : String(error);
        modelUsed = provider;
        modelName = provider === "gemini"
          ? input.configuration.gemini_model || getGeminiModels()[0].id
          : input.configuration.openai_model || getOpenAIModels()[0].id;
        try {
          return provider === "gemini"
            ? await callGemini(input, modelName, prompt, options.signal)
            : await callOpenAI(input, modelName, prompt, options.signal);
        } catch (fallbackError) {
          throw new AggregateError(
            [firstError, fallbackError],
            `All configured AI providers failed. ${providers[0]}: ${firstError instanceof Error ? firstError.message : String(firstError)}; ${provider}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
          );
        }
      }
    });
  }

  const { listing, analysis } = await runStage("validation", () => {
    const cleanedListing = cleanListing(providerOutput.listing, input, brief);
    return {
      listing: cleanedListing,
      analysis: analyzeListing(cleanedListing, input, {
        relatedKeywords: brief.related_keywords,
        suppliedFacts: brief.supplied_facts,
        imageFacts: brief.image_facts,
        competitorProfile: input.research.competitor_profile,
      }),
    };
  });
  return {
    request_id: crypto.randomUUID(),
    status: analysis.policy_validation.passed ? "success" : "needs_review",
    marketplace: input.marketplace,
    product_type: input.product_type,
    model_used: modelUsed,
    fallback_used: fallbackUsed,
    image_analysis: {
      analyzed: Boolean(input.images.length),
      image_count: input.images.length,
      observations: brief.exact_text.slice(0, 8),
    },
    product_analysis: brief,
    competitor_profile: input.research.competitor_profile,
    listing,
    ...analysis,
    metadata: {
      processing_time_ms: Date.now() - startedAt,
      stage_timings_ms: stageTimings as Record<string, number>,
      retry_count: 0,
      prompt_version: getRuleRegistry().prompt_version,
      policy_version: getPolicy(input).version,
      evidence_version: "simple-ocr-v1",
      rule_profile: input.configuration.rule_profile || getRuleRegistry().default_profile,
      created_at: new Date().toISOString(),
      model_name: modelName,
      fallback_reason: fallbackReason,
      input_tokens: providerOutput.inputTokens,
      output_tokens: providerOutput.outputTokens,
    },
  };
}
