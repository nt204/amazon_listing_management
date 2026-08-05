export const GEMINI_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Fast)", note: "Default for lower latency" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash (Quality)", note: "Higher multimodal quality" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "Strong general quality" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Deep reasoning" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Legacy compatible" },
] as const;

export const OPENAI_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "Highest quality" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "Balanced quality and cost" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "Lowest cost and latency" },
] as const;

export type AiProviderPreference = "auto" | "gemini" | "openai";

export interface AiOptions {
  gemini_available: boolean;
  openai_available: boolean;
  mock_available: boolean;
  gemini_models: Array<{ id: string; label: string; note: string }>;
  openai_models: Array<{ id: string; label: string; note: string }>;
}
