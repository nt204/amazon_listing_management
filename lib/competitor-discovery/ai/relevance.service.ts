import type {
  SellerSpriteCandidate,
  ScoredCandidate,
  AiRelevanceResult,
} from "../domain/competitor.types";
import { competitorConfig } from "../config/competitor.config";
import { buildRelevanceSystemPrompt, buildRelevanceUserPrompt } from "./relevance.prompt";

function validateAiResult(item: any): item is AiRelevanceResult {
  return (
    item &&
    typeof item.asin === "string" &&
    typeof item.relevanceScore === "number" &&
    item.relevanceScore >= 0 &&
    item.relevanceScore <= 100 &&
    typeof item.hardMismatch === "boolean"
  );
}

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Executes a single AI batch call via CheapKey OpenAI-compatible endpoint
 */
async function callRelevanceAiBatch(
  targetProduct: string,
  batch: SellerSpriteCandidate[],
  retriesLeft: number = 2
): Promise<Map<string, AiRelevanceResult>> {
  const systemPrompt = buildRelevanceSystemPrompt(targetProduct);
  const userPrompt = buildRelevanceUserPrompt(batch);

  const endpoint = `${competitorConfig.ai.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${competitorConfig.ai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: competitorConfig.ai.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`CheapKey AI HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Phản hồi từ CheapKey AI rỗng.");
    }

    const parsed = JSON.parse(cleanJsonText(content));
    if (!Array.isArray(parsed)) {
      throw new Error("Dữ liệu trả về từ CheapKey AI không phải mảng JSON.");
    }

    const resultMap = new Map<string, AiRelevanceResult>();
    for (const item of parsed) {
      if (validateAiResult(item)) {
        let score = item.relevanceScore;
        if (score <= 1.0 && score > 0) {
          score = Math.round(score * 100);
        }
        resultMap.set(item.asin.toUpperCase(), {
          asin: item.asin.toUpperCase(),
          relevanceScore: Math.max(0, Math.min(100, Math.round(score))),
          sameProductType: Boolean(item.sameProductType),
          hardMismatch: Boolean(item.hardMismatch),
          reason: String(item.reason || "").trim(),
        });
      }
    }

    return resultMap;
  } catch (error) {
    if (retriesLeft > 0) {
      console.warn(`[AI Relevance] Lỗi đánh giá AI, thử lại (${retriesLeft} lần còn lại):`, error);
      await new Promise((r) => setTimeout(r, 1200));
      return callRelevanceAiBatch(targetProduct, batch, retriesLeft - 1);
    }
    throw new Error(`AI_RELEVANCE_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Step 5: Evaluates competitor relevance in batches (Section 8, 10, 11, 12).
 * Merges scores into candidates, flagging unscored candidates without fabricating scores.
 */
export async function evaluateCandidatesRelevance(
  targetProduct: string,
  candidates: SellerSpriteCandidate[]
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) return [];

  const maxBatchSize = competitorConfig.ai.maxBatchSize || 30;
  const batches: SellerSpriteCandidate[][] = [];

  for (let i = 0; i < candidates.length; i += maxBatchSize) {
    batches.push(candidates.slice(i, i + maxBatchSize));
  }

  const allAiResults = new Map<string, AiRelevanceResult>();

  // Execute all batches concurrently (Section 10)
  const batchMaps = await Promise.all(
    batches.map((batch) => callRelevanceAiBatch(targetProduct, batch))
  );
  for (const bMap of batchMaps) {
    bMap.forEach((v, k) => allAiResults.set(k, v));
  }

  // Merge results into ScoredCandidates
  return candidates.map((candidate) => {
    const aiResult = allAiResults.get(candidate.asin.toUpperCase());

    if (aiResult) {
      return {
        ...candidate,
        status: "AI_SCORED",
        ai: {
          relevanceScore: aiResult.relevanceScore,
          sameProductType: aiResult.sameProductType,
          hardMismatch: aiResult.hardMismatch,
          reason: aiResult.reason,
        },
        scores: {
          relevance: aiResult.relevanceScore,
          revenue: 0,
          sales: 0,
          bsr: 0,
          final: 0,
        },
      };
    }

    // Unscored candidate (Section 11): Do not invent fake score
    return {
      ...candidate,
      status: "AI_SCORED",
      rejectReason: "AI_UNSCORED",
      ai: {
        relevanceScore: 0,
        sameProductType: false,
        hardMismatch: true,
        reason: "Không nhận được phản hồi đánh giá từ AI.",
      },
      scores: {
        relevance: 0,
        revenue: 0,
        sales: 0,
        bsr: 0,
        final: 0,
      },
    };
  });
}
