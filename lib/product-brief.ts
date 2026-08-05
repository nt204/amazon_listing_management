import type { ListingInput, ProductBrief } from "@/lib/types";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

function unique(values: string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [normalize(value), value.trim()])).values()];
}

function factValue(fact: string) {
  const separator = fact.search(/[:：]/);
  return (separator >= 0 ? fact.slice(separator + 1) : fact).trim();
}

function additionalDetailLines(notes: string) {
  return notes
    .split(/\n+/)
    .map((line) => line.replace(/^[•*\-\s]+/, "").trim())
    .filter(Boolean);
}

function isExclusion(value: string) {
  return /^(do not|don't|dont|never|avoid)\b/i.test(value);
}

export function operatorEvidence(input: ListingInput) {
  const info = input.product_information;
  const noteLines = additionalDetailLines(input.research.notes);
  const suppliedFacts = [
    input.brand ? `Brand: ${input.brand}` : "",
    info.material ? `Material: ${info.material}` : "",
    info.size_capacity ? `Size or capacity: ${info.size_capacity}` : "",
    info.color ? `Color: ${info.color}` : "",
    info.package_contents ? `Package contents: ${info.package_contents}` : "",
    info.personalization ? `Personalization: ${info.personalization}` : "",
    info.care_instructions ? `Care: ${info.care_instructions}` : "",
    info.country_of_origin ? `Country of origin: ${info.country_of_origin}` : "",
    ...info.features.map((feature) => `Feature: ${feature}`),
    ...noteLines.filter((line) => !isExclusion(line)),
  ];
  return {
    suppliedFacts: unique(suppliedFacts),
    factsToAvoid: unique(noteLines.filter(isExclusion)),
  };
}

export function mergeOperatorEvidence(input: ListingInput, brief: ProductBrief): ProductBrief {
  const operator = operatorEvidence(input);
  const modelFacts = brief.supplied_facts.filter(
    (fact) => !/^(product type|main keyword|marketplace)\s*:/i.test(fact),
  );
  const explicitValues = operator.suppliedFacts
    .map(factValue)
    .map(normalize)
    .filter((value) => value.length >= 2);
  const modelAvoid = brief.facts_to_avoid.filter((claim) => {
    const normalizedClaim = normalize(claim);
    return !explicitValues.some((value) => normalizedClaim.includes(value));
  });

  return {
    ...brief,
    supplied_facts: unique([...operator.suppliedFacts, ...modelFacts]),
    facts_to_avoid: unique([...operator.factsToAvoid, ...modelAvoid]),
  };
}
