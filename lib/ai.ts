import "server-only";

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { enrichCompetitorResearch } from "@/lib/competitor";
import { buildOperatorEvidenceItems, inferEvidenceCategory } from "@/lib/evidence";
import { enrichListingKeywordResearch } from "@/lib/helium10";
import { extractLocalOcr } from "@/lib/local-ocr";
import {
  cleanGeneratedTitle,
  formatGeneratedTitleCase,
  finalizeStructuredTitle,
  trimAtWordBoundary,
  trimDescriptionToTarget,
} from "@/lib/listing-sanitizer";
import { createMockListing } from "@/lib/mock";
import { getGeminiModels, getOpenAIModels } from "@/lib/models";
import { getPolicy } from "@/lib/policies";
import { getRuleRegistry } from "@/lib/rules";
import { generatedListingJsonSchema, generatedListingSchema } from "@/lib/schemas";
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
        minLength: input.configuration.generate_description ? 650 : 0,
        maxLength: input.configuration.generate_description ? policy.descriptionTargetMax : 0,
      },
    },
  } as const;
}

const systemInstruction = `Create clear Amazon listing copy from the supplied product input.
Operator facts and supplied product-image OCR are the source of truth. Use raw images only to understand visible appearance and confirm the supplied OCR.
Competitor data is light inspiration for search intent, strengths, and gaps. Never copy its wording, brand, ASIN, or unsupported product claims.
Use natural English Title Case in titles: capitalize important words, but keep articles, conjunctions, and short prepositions lowercase. Preserve visible product artwork wording in uppercase without quotation marks.
Return only the requested JSON.`;

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL.");
  return { mimeType: match[1], data: match[2] };
}

function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
) {
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 45_000);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`AI request timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  const abort = () => controller.abort(parentSignal?.reason || new Error("AI request cancelled."));
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  return operation(controller.signal).finally(() => {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  });
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
    product_type: input.product_type,
    brand: input.brand || undefined,
    main_keyword: input.main_keyword,
    related_keywords: input.related_keywords,
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
- Title: use this exact group order: Brand + Core KW 1 + Core KW 2 + gift occasions + gift recipients + gift givers + product.
- Write one coherent, shopper-readable title. Use natural English connectors and punctuation instead of concatenating raw keyword labels.
- Use natural English Title Case throughout the title. Capitalize important nouns, verbs, adjectives, adverbs, brand words, and product-name words; keep articles, conjunctions, and short prepositions lowercase, including a, an, the, and, but, or, for, at, by, from, in, of, on, to, and with.
- Use the official brand styling when supplied; otherwise write the brand in Title Case. Never leave the brand or product name in generic lowercase.
- If the title uses exact wording visibly printed on the product or confirmed by OCR, write that wording in uppercase without quotation marks, for example THANK YOU VETERANS.
- Never use straight or curly quotation marks anywhere in the title.
- Keep the words and word order of Core KW 1 and Core KW 2 unchanged, while adjusting their letter casing to match the title rule. Core KW 1 is operator.main_keyword. Core KW 2 is exactly the first phrase in operator.related_keywords. Never replace Core KW 2 with another research term.
- Put the complete Brand + Core KW 1 combination within the first ${titleBlueprint.primaryKeywordWindow} characters so it remains visible on mobile.
- Treat title_blueprint.events only as a reference list, never as a list of events that must appear. Select 0-4 events only when the product theme, visible artwork or OCR text, operator occasions, or measured occasion keywords strongly support them.
- Product relevance outranks calendar proximity. Never choose an event merely because its daysUntil value is small or because it appears early in the candidate list. A strongly theme-matched annual event may be used even when its next occurrence is farther away.
- Prefer events marked operatorSelected or keywordResearchSupported when they also match the product. After selecting relevant events, order timely dated events before year-round occasions. Do not carry an event from current_listing unless the current evidence still supports it.
- Choose recipient and giver synonyms that fit the product. Prefer title_blueprint.audienceKeywords in descending Search Volume order. In recipient or giver synonym groups, use hyphens instead of the word "and", for example "for Dad-Father-Daddy".
- End the title with a concise product segment containing a supported advantage and the product name. If the product word already appears twice in the core keywords, use a natural supported synonym in the final segment.
- No normalized word may appear more than twice anywhere in the title. Do not keyword-stuff.
- Aim for ${titleBlueprint.idealMinimumCharacters}-${titleBlueprint.idealMaximumCharacters} characters, including spaces and punctuation. Prefer concise natural wording over filling unused space.
- The hard title limit is ${Math.min(policy.titleMax, titleBlueprint.maxCharacters)} characters. Do not approach this limit merely to add more keywords.
- Return the final polished title yourself. The server will not reorder its segments, inject keywords, replace connectors, or delete repeated words after generation.
- Bullets: write exactly 5 Amazon-style benefit-led bullets, roughly 120-200 characters each, as plain text in this exact format: BENEFIT-LED HEADER IN CAPS: Natural sentence.
- Build each bullet as hook or key benefit + verified feature + customer benefit + relevant use case. Add relevant keywords naturally without keyword stuffing.
- Cover these angles in order: primary message or benefit; design or style; verified size, material, capacity, or other useful detail; ease of use, care, or display; recipient and gift occasion.
- If an angle lacks verified evidence, replace it with another supported benefit. Never invent a detail. Do not use numbering, bullet symbols, brackets, or Markdown in the bullet text.
- Description: ${input.configuration.generate_description ? "about 700-1000 characters" : "empty string"}; factual and easy to read.
- Backend search terms: ${input.configuration.generate_search_terms ? "space-separated relevant shopper terms, ideally 120-220 bytes; generate useful alternate shopper wording that is not already prominent in the visible copy" : "empty string"}; no punctuation, brands, ASINs, filler, or repeated words.
- Use operator data and OCR that clearly belongs to the product. Ignore OCR noise and do not complete missing text.
- Numbers, material, package contents, manufacturing method, weight, care, personalization, origin, safety, and performance may be stated only when the exact detail appears in operator data or supplied OCR, never from a competitor or visual inference.
- Do not add unsupported quality adjectives such as premium, high-quality, durable, genuine, sturdy, or heavy.
- Generate the copy and search vocabulary yourself. Use competitor information only to understand context, useful choices, and gaps; do not copy it.

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
  const response = await withTimeout((requestSignal) =>
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
  return {
    listing: generatedListingSchema.parse(JSON.parse(response.text)),
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
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await withTimeout((requestSignal) => client.responses.create({
    model,
    instructions: systemInstruction,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...input.images.map((image): OpenAI.Responses.ResponseInputImage => ({
          type: "input_image",
          image_url: image.data_url,
          detail: "auto",
        })),
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "amazon_listing",
        strict: true,
        schema: listingResponseSchema(input),
      },
    },
  }, { signal: requestSignal, maxRetries: 0, timeout: Number(process.env.AI_TIMEOUT_MS || 45_000) }), signal);
  if (!response.output_text) throw new Error("OpenAI returned an empty response.");
  return {
    listing: generatedListingSchema.parse(JSON.parse(response.output_text)),
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  };
}

function cleanListing(
  listing: ListingContent,
  input: ListingInput,
  brief: ProductBrief,
  titleBlueprint: TitleBlueprint,
) {
  const policy = getPolicy(input);
  const title = trimAtWordBoundary(
    formatGeneratedTitleCase(
      finalizeStructuredTitle({
        title: listing.title,
        brand: titleBlueprint.brand,
        coreKeyword1: titleBlueprint.coreKeyword1.keyword,
        coreKeyword2: titleBlueprint.coreKeyword2?.keyword,
      }),
      {
        brand: input.brand,
        uppercasePhrases: brief.exact_text,
      }
    ),
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
  const keywordInput = options.productBrief
    ? sourceInput
    : await enrichListingKeywordResearch(sourceInput, options.signal);
  const input = options.productBrief
    ? keywordInput
    : await enrichCompetitorResearch(keywordInput);
  const ocr = options.productBrief ? undefined : await extractLocalOcr(input, options.signal);
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
    providerOutput = { listing: options.currentListing || createMockListing(input) };
  } else {
    const preferred: Provider = input.configuration.ai_provider === "openai" ? "openai" : "gemini";
    const providers = [preferred, preferred === "gemini" ? "openai" : "gemini"]
      .filter((provider, index, values) => values.indexOf(provider) === index)
      .filter((provider) => provider === "gemini" ? hasGemini : hasOpenAI) as Provider[];
    if (!providers.length) throw new Error("No AI provider is configured.");
    let firstError: unknown;
    try {
      const provider = providers[0];
      modelUsed = provider;
      modelName = provider === "gemini"
        ? input.configuration.gemini_model || getGeminiModels()[0].id
        : input.configuration.openai_model || getOpenAIModels()[0].id;
      providerOutput = provider === "gemini"
        ? await callGemini(input, modelName, prompt, options.signal)
        : await callOpenAI(input, modelName, prompt, options.signal);
    } catch (error) {
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
        providerOutput = provider === "gemini"
          ? await callGemini(input, modelName, prompt, options.signal)
          : await callOpenAI(input, modelName, prompt, options.signal);
      } catch (fallbackError) {
        throw new AggregateError(
          [firstError, fallbackError],
          `All configured AI providers failed. ${providers[0]}: ${firstError instanceof Error ? firstError.message : String(firstError)}; ${provider}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }
  }

  const listing = cleanListing(providerOutput.listing, input, brief, titleBlueprint);
  const analysis = analyzeListing(listing, input, {
    relatedKeywords: brief.related_keywords,
    suppliedFacts: brief.supplied_facts,
    imageFacts: brief.image_facts,
    competitorProfile: input.research.competitor_profile,
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
