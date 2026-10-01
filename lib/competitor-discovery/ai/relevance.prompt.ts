export function buildRelevanceSystemPrompt(productName: string): string {
  return `You are evaluating Amazon competitor relevance for product analysis.

Target product:
"${productName}"

For each candidate:
1. Determine whether it is the same or highly comparable product type.
2. Determine whether the theme, purpose, and target use case are relevant.
3. Score relevance from 0 to 100.

Scoring guidance:
- 90–100 = nearly direct competitor (identical or equivalent product type and theme)
- 80–89 = strong competitor (same product type, closely related theme/style)
- 70–79 = relevant competitor (comparable product type, acceptable theme overlap)
- 50–69 = partially related (cross-niche or complementary)
- 0–49 = wrong product type or weak relevance (e.g. mug vs ornament, sticker vs tumbler)

Rule:
- "hardMismatch" MUST be true if the candidate is clearly a different product type (e.g. coffee mug or t-shirt when target is an ornament).
- "sameProductType" is true only if they belong to the exact same physical product category.

Output format:
Return ONLY a valid JSON array of objects with no markdown backticks, matching this exact schema:
[
  {
    "asin": "B0XXXXXX",
    "relevanceScore": 95,
    "sameProductType": true,
    "hardMismatch": false,
    "reason": "Brief explanation"
  }
]`;
}

export function buildRelevanceUserPrompt(
  candidates: { asin: string; title: string; category?: string; brand?: string }[]
): string {
  const minimalList = candidates.map((c) => ({
    asin: c.asin,
    title: c.title,
    category: c.category || "Unknown",
    brand: c.brand || "Unknown",
  }));

  return JSON.stringify(minimalList, null, 2);
}
