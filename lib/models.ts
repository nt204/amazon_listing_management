const DEFAULT_GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Fast)", note: "Default for lower latency" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Quality)", note: "Higher multimodal quality" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "Strong general quality" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Deep reasoning" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Legacy compatible" },
] as const;

const DEFAULT_OPENAI_MODELS = [
  { id: "gpt-4o", label: "GPT-4o (Standard)", note: "High quality multimodal model" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini (Fast & Low Cost)", note: "Fastest response" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "Highest quality" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Balanced quality and cost" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Lowest cost and latency" },
] as const;

export const DEFAULT_GEMINI_MODEL = DEFAULT_GEMINI_MODELS[0].id;
export const DEFAULT_OPENAI_MODEL = DEFAULT_OPENAI_MODELS[0].id;

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
