import type { ListingInput, ProductBrief } from "@/lib/types";

const factLabels = [
  "material",
  "chất liệu",
  "capacity",
  "dung tích",
  "size",
  "kích thước",
  "color",
  "màu",
  "care",
  "wash",
  "dishwasher",
  "microwave",
  "origin",
  "xuất xứ",
  "package",
  "personalization",
  "feature",
  "brand",
  "thương hiệu",
];

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
  const lower = value.toLowerCase();
  const colonIndex = value.search(/[:：]/);
  if (colonIndex > 0) {
    const label = lower.slice(0, colonIndex).trim();
    return factLabels.some((candidate) => label.includes(candidate));
  }
  return /^(dishwasher safe|microwave safe|hand wash|made in\b|printed on\b|bpa[ -]?free\b)/i.test(
    value,
  );
}

function exclusionValue(value: string) {
  const match = value.match(
    /^(?:do not|don't|dont|never|avoid|không|đừng|tránh)(?:\s+(?:mention|use|include|claim|đề cập|dùng|ghi))?\s+(.+)$/i,
  );
  return match?.[1]?.trim() || "";
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

  return {
    input: brand ? { ...input, brand } : input,
    brief: {
      ...brief,
      supplied_facts: unique([...brief.supplied_facts, ...addedFacts]),
      facts_to_avoid: unique([...brief.facts_to_avoid, ...addedExclusions]),
    },
    addedFacts,
    addedExclusions,
  };
}
