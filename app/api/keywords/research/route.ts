import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { researchHelium10Keywords } from "@/lib/helium10";
import { getMarketplaceRules, getRuleProfile } from "@/lib/rules";
import { keywordResearchRequestSchema } from "@/lib/schemas";
import {
  authorize,
  enforceRateLimit,
  enforceRequestSize,
  routeErrorResponse,
} from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const actor = authorize(request, "write");
    enforceRequestSize(request, 32_000);
    await enforceRateLimit(
      actor,
      "helium10-keyword-research",
      Number(process.env.HELIUM10_RATE_LIMIT_PER_MINUTE || 10),
    );
    const payload = keywordResearchRequestSchema.parse(await request.json());
    const ruleProfile = actor.ruleProfile || payload.rule_profile;
    const configuration = { rule_profile: ruleProfile };
    const profile = getRuleProfile({ configuration });
    const marketplace = getMarketplaceRules({
      marketplace: payload.marketplace,
      configuration: {
        rule_profile: ruleProfile,
        ai_provider: "auto",
        gemini_model: "",
        openai_model: "",
        language: "",
        tone: "",
        bullet_count: 5,
        title_length: 200,
        bullet_length: 250,
        generate_description: true,
        generate_search_terms: true,
      },
    });
    const research = await researchHelium10Keywords({
      marketplace: payload.marketplace,
      main_keyword: payload.main_keyword,
      product_type: payload.product_type,
      brand: payload.brand,
      product_information: payload.product_information,
      target_customer: payload.target_customer,
      occasion: payload.occasion,
      stop_words: marketplace.stop_words,
      prohibited_words: profile.search.prohibited_words,
      role_words: profile.competitor.role_words,
      occasion_words: profile.competitor.occasions,
      competitor_count: profile.search.competitor_count,
      minimum_attribute_search_volume: profile.search.minimum_attribute_search_volume,
      maximum_generic_keywords: profile.search.maximum_generic_keywords,
      minimum_relevance_score: profile.search.minimum_relevance_score,
    }, request.signal);
    return NextResponse.json({ research });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({
        error: "Dữ liệu nghiên cứu keyword chưa hợp lệ.",
        issues: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      }, { status: 400 });
    }
    return routeErrorResponse(error, "Không thể nghiên cứu keyword từ Helium 10.", 502);
  }
}
