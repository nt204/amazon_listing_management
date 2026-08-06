import type { ListingInput, ProductEvidenceCategory, ProductEvidenceItem } from "@/lib/types";

const measurementPattern = /\b\d+(?:\.\d+)?\s*(?:inches?|in|cm|mm|ounces?|oz|ml|liters?|litres?|l|feet|ft|grams?|g|kg|pounds?|lb|fl\s*oz)\b/iu;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function stablePart(value: string) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 48) || "fact";
}

export function inferEvidenceCategory(
  _input: ListingInput,
  value: string,
  fallback: ProductEvidenceCategory = "other",
): ProductEvidenceCategory {
  const normalized = normalize(value);
  if (measurementPattern.test(value)) return "dimensions";
  if (/\b(?:dishwasher|microwave|hand wash|machine washable|wipe clean)\b/i.test(value)) return "care";
  if (/\b(?:package|includes?|set of|pack of|comes with)\b/i.test(value)) return "package";
  if (/\b(?:made|manufactured|produced)\s+in\b/i.test(value)) return "origin";
  if (/\b(?:bpa free|food grade|non toxic|certified)\b/i.test(value)) return "safety";
  if (/\b(?:canvas|ceramic|cotton|glass|metal|polyester|porcelain|slate|steel|stone|wood)\b/.test(normalized)) return "material";
  return fallback;
}

function operatorItem(
  value: string,
  category: ProductEvidenceCategory,
  sourceField: string,
  index: number,
): ProductEvidenceItem {
  return {
    id: `operator-${index}-${stablePart(value)}`,
    value,
    category,
    source: "operator",
    source_image: null,
    source_text: value,
    source_field: sourceField,
    confidence: "high",
    publishable: true,
    verification: "verified",
    reason: "Operator supplied this product detail.",
  };
}

export function buildOperatorEvidenceItems(input: ListingInput) {
  const info = input.product_information;
  const rows: Array<[string, string, ProductEvidenceCategory]> = [
    ["product_information.material", info.material ? `Material: ${info.material}` : "", "material"],
    ["product_information.size_capacity", info.size_capacity ? `Size or capacity: ${info.size_capacity}` : "", "dimensions"],
    ["product_information.color", info.color ? `Color: ${info.color}` : "", "color"],
    ["product_information.package_contents", info.package_contents ? `Package contents: ${info.package_contents}` : "", "package"],
    ["product_information.personalization", info.personalization ? `Personalization: ${info.personalization}` : "", "other"],
    ["product_information.care_instructions", info.care_instructions ? `Care: ${info.care_instructions}` : "", "care"],
    ["product_information.country_of_origin", info.country_of_origin ? `Country of origin: ${info.country_of_origin}` : "", "origin"],
    ["brand", input.brand ? `Brand: ${input.brand}` : "", "other"],
    ...info.features.map((feature): [string, string, ProductEvidenceCategory] => [
      "product_information.features", `Feature: ${feature}`, "other",
    ]),
    ...input.research.notes
      .split(/\n+/)
      .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
      .filter((line) => line && !/^(?:do not|don't|dont|never|avoid)\b/i.test(line))
      .map((line): [string, string, ProductEvidenceCategory] => [
        "research.notes", line, inferEvidenceCategory(input, line),
      ]),
  ];
  return rows
    .filter(([, value]) => value.trim())
    .map(([field, value, category], index) => operatorItem(value, category, field, index));
}
