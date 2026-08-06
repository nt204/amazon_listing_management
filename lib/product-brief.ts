import { buildOperatorEvidenceItems } from "@/lib/evidence";
import type { ListingInput, ProductBrief } from "@/lib/types";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), value.trim()])).values()];
}

function noteLines(notes: string) {
  return notes
    .split(/\n+/)
    .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
    .filter(Boolean);
}

function isExclusion(value: string) {
  return /^(?:do not|don't|dont|never|avoid)\b/i.test(value);
}

export function operatorEvidence(input: ListingInput) {
  const info = input.product_information;
  const notes = noteLines(input.research.notes);
  return {
    suppliedFacts: unique([
      input.brand ? `Brand: ${input.brand}` : "",
      info.material ? `Material: ${info.material}` : "",
      info.size_capacity ? `Size or capacity: ${info.size_capacity}` : "",
      info.color ? `Color: ${info.color}` : "",
      info.package_contents ? `Package contents: ${info.package_contents}` : "",
      info.personalization ? `Personalization: ${info.personalization}` : "",
      info.care_instructions ? `Care: ${info.care_instructions}` : "",
      info.country_of_origin ? `Country of origin: ${info.country_of_origin}` : "",
      ...info.features.map((feature) => `Feature: ${feature}`),
      ...notes.filter((line) => !isExclusion(line)),
    ]),
    factsToAvoid: unique(notes.filter(isExclusion)),
  };
}

/** Refresh operator data on a saved brief before an AI revision. */
export function mergeOperatorEvidence(input: ListingInput, brief: ProductBrief): ProductBrief {
  const operator = operatorEvidence(input);
  return {
    ...brief,
    evidence_items: [
      ...buildOperatorEvidenceItems(input),
      ...(brief.evidence_items || []).filter((item) => item.source !== "operator"),
    ],
    supplied_facts: operator.suppliedFacts,
    related_keywords: unique([...input.related_keywords, ...brief.related_keywords]).slice(0, 20),
    backend_keywords: unique([...input.backend_keywords, ...(brief.backend_keywords || [])]).slice(0, 40),
    facts_to_avoid: unique([...operator.factsToAvoid, ...brief.facts_to_avoid]),
  };
}
