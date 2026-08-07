function cleanCopy(value: string) {
  return value
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "")
    .trim();
}

/** Preserve the AI-written title while cleaning whitespace and punctuation spacing only. */
export function cleanGeneratedTitle(value: string) {
  return value
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])(?!\s|$)/g, "$1 ")
    .replace(/\s{2,}/g, " ")
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

/** Keep brand and the two exact core keywords once at the start of the title. */
export function normalizeRequiredTitle(
  title: string,
  brand: string,
  mainKeyword: string,
  extendedKeyword = "",
) {
  const identity = [brand.trim(), mainKeyword.trim()].filter(Boolean).join(" ");
  const hasDistinctExtension = extendedKeyword.trim() &&
    extendedKeyword.trim().toLocaleLowerCase() !== mainKeyword.trim().toLocaleLowerCase();
  const prefix = hasDistinctExtension ? `${identity}, ${extendedKeyword.trim()}` : identity;
  if (!prefix) return cleanCopy(title);

  let remainder = removePhrase(removePhrase(removePhrase(title, brand), mainKeyword), extendedKeyword);
  const keywordWords = [...new Set(mainKeyword.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
  for (const word of keywordWords) remainder = removePhrase(remainder, word);
  remainder = cleanCopy(remainder.replace(/(?:\s*[,;:|–—-]\s*){2,}/g, ", "));
  return remainder ? `${prefix}, ${remainder}` : prefix;
}

export function replaceTitleAndWithHyphens(title: string) {
  return cleanCopy(title.replace(/\s+(?:and|&)\s+/giu, "-"));
}

export function limitTitleWordRepetition(title: string, maximum = 2) {
  const counts = new Map<string, number>();
  const limited = title.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word) => {
    const key = word.normalize("NFKC").toLocaleLowerCase().replace(/[’]/g, "'");
    const nextCount = (counts.get(key) || 0) + 1;
    counts.set(key, nextCount);
    return nextCount <= maximum ? word : "";
  });
  return cleanCopy(
    limited
      .replace(/\s*-\s*-\s*/g, "-")
      .replace(/\b(for|from)\s*-\s*/giu, "$1 ")
      .replace(/(?:\s*[,;:|]\s*){2,}/g, ", ")
      .replace(/\s+([,;:|])/g, "$1"),
  );
}

export function repeatedTitleWords(title: string, maximum = 2) {
  const counts = new Map<string, number>();
  for (const match of title.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
    const key = match[0].normalize("NFKC").toLocaleLowerCase().replace(/[’]/g, "'");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > maximum)
    .map(([word]) => word);
}

export function finalizeStructuredTitle(options: {
  title: string;
  brand: string;
  coreKeyword1: string;
  coreKeyword2?: string;
}) {
  return limitTitleWordRepetition(
    replaceTitleAndWithHyphens(
      normalizeRequiredTitle(
        options.title,
        options.brand,
        options.coreKeyword1,
        options.coreKeyword2,
      ),
    ),
  );
}
