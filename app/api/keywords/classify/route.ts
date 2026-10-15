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

    // Limit to max 1000 keywords
    const validKeywords = rawKeywords.slice(0, 1000);

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

STRICT CLASSIFICATION RULES:
1. SUB-CATEGORY & FORM FACTOR MISMATCH:
   - You MUST differentiate apparel and product form factors strictly!
   - If target is a "jacket" / "coat" (sleeved outerwear): keywords for "vest" / "waistcoat" (sleeveless), "shirt", "dress", "pants", "boots", "hat" are DIFFERENT apparel items. You MUST classify them as type: "WRONG_PRODUCT", negative: true, relevance: <= 35.
   - If target is a "vest": keywords for "jacket", "hoodie", "cardigan" -> type: "WRONG_PRODUCT", negative: true, relevance: <= 35.
   - If target is a "tumbler": keywords for "mug", "straw", "water bottle", "backpack" -> type: "WRONG_PRODUCT", negative: true, relevance: <= 35.
2. RELEVANCE SCORING:
   - 90-100: Exact same product type matching core themes (e.g. target "cow girl jacket" -> "cowgirl jacket", "girls western jacket", "cow print coat").
   - 75-89: Direct variations, synonyms, or close thematic attributes of the EXACT SAME product type.
   - 50-74: Broad gift, event or audience searches where target product can legitimately be bought (e.g. "cowgirl gifts", "western costume for girls").
   - 0-49: Wrong product type, unrelated items, or sub-category mismatch -> MUST have negative: true.
3. COMPETITOR BRANDS:
   - If keyword specifies a competitor brand not owned by target, mark negative: true.`;

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
                "You are an expert Amazon PPC Semantic Classifier. Evaluate keyword relevance to the target product with strict product sub-category enforcement. Output strictly a JSON array without explanations or markdown formatting.",
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
            const rawType = ["PRODUCT", "GIFT", "EVENT", "AUDIENCE", "WRONG_PRODUCT"].includes(item.type)
              ? item.type
              : "PRODUCT";
            const isNegative = Boolean(item.negative) || rawType === "WRONG_PRODUCT";
            let rel = typeof item.relevance === "number" ? Math.max(0, Math.min(100, Math.round(item.relevance))) : 70;
            if (isNegative && rel > 45) {
              rel = 35;
            }

            allResults.push({
              id: item.id,
              keyword: original.keyword,
              relevance: rel,
              type: rawType,
              negative: isNegative,
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
