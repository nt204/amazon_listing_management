import type { ListingInput, ProductBrief } from "@/lib/types";
import { mergeOperatorEvidence } from "@/lib/product-brief";

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [value.toLowerCase(), value])).values()];
}
function clauses(instruction: string) {
  return instruction
    .split(/\n|;|,(?=\s*(?:brand|store|thương hiệu|description|mô tả|bullet|title|tiêu đề|không|do not|don't|tránh))/i)
    .map((value) => value.replace(/^[•*\-\s]+/, "").trim())
    .filter(Boolean);
}

function extractBrand(instruction: string) {
  const match = instruction.match(
    /(?:brand|store|thương hiệu)\s*(?::|=|là|is)?\s*([\p{L}\p{N}][\p{L}\p{N}&' .-]{0,60}?)(?=\s*(?:,|;|\n|$))/iu,
  );
  return match?.[1]?.trim() || "";
}

function isExplicitFact(value: string) {
  return /[:：]/.test(value) ||
    /\b\d+(?:\.\d+)?\s*(?:inches?|in|cm|mm|ounces?|oz|ml|liters?|litres?|feet|ft|grams?|kg|lb)\b/iu.test(value) ||
    /\b(?:made (?:of|from)|dishwasher|microwave|hand wash|package includes|comes with)\b/iu.test(value);
}

function exclusionValue(value: string) {
  const english = value.match(
    /^(?:do not|don't|dont|never|avoid)(?:\s+(?:mention|use|include|claim))?\s+(.+)$/i,
  );
  if (english?.[1]) return english[1].trim();

  const explicitVietnamese = value.match(
    /^(?:không|đừng)\s+(?:đề cập|dùng|ghi|nêu|sử dụng|thêm)\s+(.+)$/i,
  );
  if (explicitVietnamese?.[1]) return explicitVietnamese[1].trim();

  const avoidVietnamese = value.match(
    /^tránh(?:\s+(?:đề cập|dùng|ghi|nêu|sử dụng|thêm))?\s+(.+)$/i,
  );
  return avoidVietnamese?.[1]?.trim() || "";
}

export function mergeReviewEvidence(
  input: ListingInput,
  brief: ProductBrief,
  instruction: string,
) {
  const brand = extractBrand(instruction);
  const addedFacts: string[] = [];
  const addedExclusions: string[] = [];

  for (const clause of clauses(instruction)) {
    const excluded = exclusionValue(clause);
    if (excluded) {
      addedExclusions.push(`Do not mention ${excluded}`);
    } else if (isExplicitFact(clause)) {
      addedFacts.push(clause);
    }
  }
  if (brand) addedFacts.push(`Brand: ${brand}`);

  const existingNotes = input.research.notes.trim();
  const updatedInput: ListingInput = {
    ...input,
    ...(brand ? { brand } : {}),
    research: {
      ...input.research,
      notes: unique([existingNotes, ...addedFacts, ...addedExclusions]).filter(Boolean).join("\n"),
    },
  };
  const updatedBrief = mergeOperatorEvidence(updatedInput, {
    ...brief,
    evidence_items: (brief.evidence_items || []).filter((item) => item.source !== "operator"),
    facts_to_avoid: unique([...brief.facts_to_avoid, ...addedExclusions]),
  });

  return {
    input: updatedInput,
    brief: updatedBrief,
    addedFacts,
    addedExclusions,
  };
}
