import type { ListingContent } from "@/lib/types";

export function trimDescriptionToTarget(value: string, minimum: number, maximum: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maximum) return trimmed;
  const clipped = trimmed.slice(0, maximum);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?"),
  );
  if (sentenceEnd + 1 >= minimum) return clipped.slice(0, sentenceEnd + 1).trim();
  const wordBoundary = clipped.lastIndexOf(" ");
  const shortened = clipped.slice(0, wordBoundary > minimum ? wordBoundary : maximum - 1).trimEnd();
  return `${shortened.replace(/[,:;\-]+$/, "")}.`.slice(0, maximum);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesPhrase(value: string, phrase: string) {
  const normalizedValue = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedPhrase = phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Boolean(normalizedPhrase) && ` ${normalizedValue} `.includes(` ${normalizedPhrase} `);
}

function cleanCopy(value: string) {
  const cleaned = value
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*([,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "")
    .trim();
  return cleaned.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix: string, letter: string) =>
    `${prefix}${letter.toUpperCase()}`,
  );
}

function removeTerms(value: string, terms: string[]) {
  const cleaned = terms.reduce(
    (copy, term) =>
      copy.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu"),
        "",
      ),
    value,
  );
  return cleanCopy(cleaned);
}

export function removeUnsupportedPerformanceLanguage(
  listing: ListingContent,
  performanceTerms: string[],
  trustedEvidence: string,
): ListingContent {
  const unsupportedTerms = performanceTerms.filter(
    (term) => !includesPhrase(trustedEvidence, term),
  );
  if (!unsupportedTerms.length) return listing;

  return {
    title: removeTerms(listing.title, unsupportedTerms),
    bullet_points: listing.bullet_points.map((bullet) => removeTerms(bullet, unsupportedTerms)),
    description: removeTerms(listing.description, unsupportedTerms),
    backend_search_terms: removeTerms(listing.backend_search_terms, unsupportedTerms),
  };
}
