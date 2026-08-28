import { NextResponse } from "next/server";
import {
  DEFAULT_OPENAI_MODEL,
  getGeminiModels,
  getOpenAIModels,
  type AiOptions,
} from "@/lib/models";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getRuleProfile, getRuleRegistry } from "@/lib/rules";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = authorize(request, "read");
    const registry = getRuleRegistry();
    const ruleProfile = actor.ruleProfile || registry.default_profile;
    const profile = getRuleProfile({ configuration: { rule_profile: ruleProfile } });
    const geminiModels = getGeminiModels();
    const openAIModels = getOpenAIModels();
    const configuredGemini = process.env.GEMINI_MODEL?.trim();
    const configuredOpenAI = process.env.OPENAI_MODEL?.trim();
    const options: AiOptions = {
      gemini_available: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openai_available: Boolean(
        process.env.OPENAI_API_KEY?.trim() ||
        process.env.CHEAPKEYAI_GEMINI_API_KEY?.trim() ||
        process.env.CHEAPKEYAI_TEXT_API_KEY?.trim() ||
        process.env.CHEAPKEYAI_LUNA_API_KEY?.trim() ||
        process.env.CHEAPKEYAI_API_KEY?.trim(),
      ),
      mock_available: process.env.AI_MOCK_MODE === "true",
      gemini_models: geminiModels,
      openai_models: openAIModels,
      product_types: [...profile.product_types],
      listing_defaults: {
        rule_profile: ruleProfile,
        gemini_model: geminiModels.some((model) => model.id === configuredGemini) ? configuredGemini! : geminiModels[0].id,
        openai_model: openAIModels.some((model) => model.id === configuredOpenAI)
          ? configuredOpenAI!
          : openAIModels.some((model) => model.id === DEFAULT_OPENAI_MODEL)
            ? DEFAULT_OPENAI_MODEL
            : openAIModels[0].id,
        title_length: profile.limits.title_max,
        bullet_length: profile.limits.bullet_max,
        bullet_count: profile.limits.bullet_count,
      },
    };
    return NextResponse.json(options);
  } catch (error) {
    return routeErrorResponse(error, "Could not load AI options.", 500);
  }
}
