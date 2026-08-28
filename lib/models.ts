const DEFAULT_GEMINI_MODELS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Quality)", note: "Higher multimodal quality" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "Strong general quality" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Legacy compatible" },
] as const;

const DEFAULT_OPENAI_MODELS = [
  { id: "gpt-4o", label: "GPT-4o (Standard)", note: "High quality multimodal model" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "Highest quality" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Balanced quality and cost" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (CheapKey AI)", note: "Giá rẻ & tốc độ cao qua CheapKey AI" },
  {
    id: "gemini-3.7-flash-cheapkey",
    label: "Gemini 3.7 Flash (CheapKey AI)",
    note: "Gemini 3.7 Flash qua cổng CheapKey AI",
  },
  {
    id: "gemini-3.5-flash-lite-cheapkey",
    label: "Gemini 3.5 Flash-Lite (CheapKey AI)",
    note: "Gemini 3.5 Flash-Lite qua cổng CheapKey AI",
  },
] as const;

export const CHEAPKEY_GEMINI_3_7_FLASH_MODEL = "gemini-3.7-flash-cheapkey";
export const CHEAPKEY_GEMINI_3_7_FLASH_UPSTREAM_MODEL = "gemini-3.7-flash";
export const CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL = "gemini-3.5-flash-lite-cheapkey";
export const CHEAPKEY_GEMINI_3_5_FLASH_LITE_UPSTREAM_MODEL = "gemini-3.5-flash-lite";

export function isCheapKeyGeminiTextModel(model: string) {
  return model === CHEAPKEY_GEMINI_3_7_FLASH_MODEL ||
    model === CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL;
}

export function isCheapKeyTextModel(model: string) {
  return model === "gpt-5.6-luna" || model.includes("cheapkey");
}

export function resolveCheapKeyUpstreamTextModel(model: string) {
  if (model === CHEAPKEY_GEMINI_3_7_FLASH_MODEL) {
    return CHEAPKEY_GEMINI_3_7_FLASH_UPSTREAM_MODEL;
  }
  if (model === CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL) {
    return CHEAPKEY_GEMINI_3_5_FLASH_LITE_UPSTREAM_MODEL;
  }
  return process.env.CHEAPKEYAI_UPSTREAM_TEXT_MODEL?.trim() || model;
}

export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI_MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
export const DEFAULT_LISTING_FALLBACK_MODEL = CHEAPKEY_GEMINI_3_5_FLASH_LITE_MODEL;

export function getListingFallbackModel(model: string) {
  return model === DEFAULT_OPENAI_MODEL ? DEFAULT_LISTING_FALLBACK_MODEL : undefined;
}

export interface ListingModelCandidate {
  provider: "gemini" | "openai";
  model: string;
}

export function getListingModelCandidates(options: {
  preference: AiProviderPreference;
  geminiModel?: string;
  openaiModel?: string;
  hasGemini: boolean;
  hasOpenAI: boolean;
}): ListingModelCandidate[] {
  const preferred = options.preference === "gemini" ? "gemini" : "openai";
  const preferredModel = preferred === "gemini"
    ? options.geminiModel || DEFAULT_GEMINI_MODEL
    : options.openaiModel || DEFAULT_OPENAI_MODEL;
  const alternateProvider = preferred === "gemini" ? "openai" : "gemini";
  const alternateModel = alternateProvider === "gemini"
    ? options.geminiModel || DEFAULT_GEMINI_MODEL
    : options.openaiModel || DEFAULT_OPENAI_MODEL;
  const candidates: ListingModelCandidate[] = [];
  const addCandidate = (provider: ListingModelCandidate["provider"], model: string) => {
    const available = provider === "gemini" ? options.hasGemini : options.hasOpenAI;
    if (!available || candidates.some((candidate) =>
      candidate.provider === provider && candidate.model === model
    )) return;
    candidates.push({ provider, model });
  };

  addCandidate(preferred, preferredModel);
  const modelFallback = getListingFallbackModel(preferredModel);
  if (preferred === "openai" && modelFallback) {
    addCandidate("openai", modelFallback);
  }
  addCandidate(alternateProvider, alternateModel);
  return candidates;
}

interface ModelOption {
  id: string;
  label: string;
  note: string;
}

function configuredModels(name: string, defaults: readonly ModelOption[]) {
  const raw = process.env[name]?.trim();
  if (!raw) return defaults.map((model) => ({ ...model }));
  const parsed = JSON.parse(raw) as ModelOption[];
  if (
    !Array.isArray(parsed) || !parsed.length ||
    parsed.some((model) => !model.id?.trim() || !model.label?.trim() || typeof model.note !== "string")
  ) {
    throw new Error(`${name} must be a non-empty JSON array of {id,label,note}.`);
  }
  return parsed;
}

export function getGeminiModels() {
  return configuredModels("GEMINI_MODELS_JSON", DEFAULT_GEMINI_MODELS);
}

export function getOpenAIModels() {
  return configuredModels("OPENAI_MODELS_JSON", DEFAULT_OPENAI_MODELS);
}

export type AiProviderPreference = "auto" | "gemini" | "openai";

export interface AiOptions {
  gemini_available: boolean;
  openai_available: boolean;
  mock_available: boolean;
  gemini_models: Array<{ id: string; label: string; note: string }>;
  openai_models: Array<{ id: string; label: string; note: string }>;
  product_types: Array<{ value: string; label: string }>;
  listing_defaults: {
    rule_profile: string;
    gemini_model: string;
    openai_model: string;
    title_length: number;
    bullet_length: number;
    bullet_count: number;
  };
}
