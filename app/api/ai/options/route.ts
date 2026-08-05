import { NextResponse } from "next/server";
import { GEMINI_MODELS, OPENAI_MODELS, type AiOptions } from "@/lib/models";

export const runtime = "nodejs";

export async function GET() {
  const options: AiOptions = {
    gemini_available: Boolean(process.env.GEMINI_API_KEY?.trim()),
    openai_available: Boolean(process.env.OPENAI_API_KEY?.trim()),
    mock_available: process.env.AI_MOCK_MODE === "true",
    gemini_models: [...GEMINI_MODELS],
    openai_models: [...OPENAI_MODELS],
  };
  return NextResponse.json(options);
}
