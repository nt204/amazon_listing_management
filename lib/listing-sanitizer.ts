function cleanCopy(value: string) {
  return value
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrase(value: string, phrase: string) {
  if (!phrase.trim()) return value;
  const expression = escapeRegExp(phrase.trim()).replace(/\s+/g, "[\\s-]+");
  return value.replace(new RegExp(`(?<![\\p{L}\\p{N}])${expression}(?![\\p{L}\\p{N}])`, "giu"), " ");
}

export function trimAtWordBoundary(value: string, maximum: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maximum) return trimmed;
  const clipped = trimmed.slice(0, maximum + 1);
  const boundary = clipped.lastIndexOf(" ");
  return cleanCopy(clipped.slice(0, boundary >= Math.floor(maximum * 0.6) ? boundary : maximum));
}

export function trimDescriptionToTarget(value: string, minimum: number, maximum: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maximum) return trimmed;
  const clipped = trimmed.slice(0, maximum);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (sentenceEnd + 1 >= minimum) return clipped.slice(0, sentenceEnd + 1).trim();
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > minimum ? boundary : maximum - 1).trimEnd().replace(/[,:;\-]+$/, "")}.`;
}

/** Keep brand and the exact main keyword once at the start of the title. */
export function normalizeRequiredTitle(title: string, brand: string, mainKeyword: string) {
  const prefix = [brand.trim(), mainKeyword.trim()].filter(Boolean).join(" ");
  if (!prefix) return cleanCopy(title);

  let remainder = removePhrase(removePhrase(title, brand), mainKeyword);
  const keywordWords = [...new Set(mainKeyword.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
  for (const word of keywordWords) remainder = removePhrase(remainder, word);
  remainder = cleanCopy(remainder.replace(/(?:\s*[,;:|–—-]\s*){2,}/g, ", "));
  return remainder ? `${prefix}, ${remainder}` : prefix;
}
