import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api-guard";
import { competitorConfig } from "@/lib/competitor-discovery/config/competitor.config";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface KeywordClassifyItem {
  id: number;
  keyword: string;
  search_volume?: number | null;
}

export interface KeywordClassificationResult {
  id: number;
  keyword: string;
  relevance: number;
  type: "PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE" | "WRONG_PRODUCT";
  negative: boolean;
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
 * 1 Single AI Batch Stage: Semantic Relevance & Type Classification for Reverse Keywords
 * Low-cost, fast, ultra-compact JSON output format
 */
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      productTitle?: string;
      keywords?: KeywordClassifyItem[];
    };

    const productTitle = String(body.productTitle || "").trim();
    const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];

    if (!productTitle) {
      return NextResponse.json(
        { error: "Vui lòng cung cấp Tên sản phẩm mục tiêu (Product Title)." },
        { status: 400 }
      );
    }

    if (rawKeywords.length === 0) {
      return NextResponse.json({ classifications: [] });
    }

    // Limit to max 500 keywords to stay safe with token limits
    const validKeywords = rawKeywords.slice(0, 500);

    const endpoint = `${competitorConfig.ai.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const model = competitorConfig.ai.model || "gemini-2.5-flash";

    // Split into batches of 150 keywords per request
    const batchSize = 150;
    const allResults: KeywordClassificationResult[] = [];

    for (let i = 0; i < validKeywords.length; i += batchSize) {
      const batch = validKeywords.slice(i, i + batchSize);

      const promptUser = `TARGET PRODUCT: "${productTitle}"

KEYWORDS TO CLASSIFY:
${batch.map((k) => `${k.id}. ${k.keyword}`).join("\n")}

Respond ONLY with a valid JSON array of objects with keys: id (number), relevance (0-100), type ("PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE" | "WRONG_PRODUCT"), negative (boolean).
Mark negative: true if the keyword clearly refers to a different product type (e.g. blanket, shirt, jacket when target is tumbler, or rival brands like stanley/yeti if not applicable).`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${competitorConfig.ai.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are an expert Amazon PPC Semantic Classifier. Evaluate keyword relevance to the target product. Output strictly a JSON array without explanations or markdown formatting.",
            },
            {
              role: "user",
              content: promptUser,
            },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`AI API error ${response.status}: ${errText.slice(0, 150)}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Phản hồi từ AI rỗng.");
      }

      const parsed = JSON.parse(cleanJsonText(content));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const original = batch.find((k) => k.id === item.id);
          if (original) {
            allResults.push({
              id: item.id,
              keyword: original.keyword,
              relevance: typeof item.relevance === "number" ? Math.max(0, Math.min(100, Math.round(item.relevance))) : 70,
              type: ["PRODUCT", "GIFT", "EVENT", "AUDIENCE", "WRONG_PRODUCT"].includes(item.type)
                ? item.type
                : "PRODUCT",
              negative: Boolean(item.negative),
            });
          }
        }
      }
    }

    return NextResponse.json({
      classifications: allResults,
      total: allResults.length,
    });
  } catch (error) {
    console.error("Keyword classification failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi khi phân loại từ khóa bằng AI." },
      { status: 500 }
    );
  }
}
