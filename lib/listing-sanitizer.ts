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
    .replace(/([,;:!?]|\.(?!\d))(?!\s|$)/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
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

export function repeatedTitleWords(
  title: string,
  maximum = 2,
  exemptWords: Iterable<string> = [],
) {
  const exemptions = new Set(
    [...exemptWords].map((word) => word.normalize("NFKC").toLocaleLowerCase().replace(/[’]/g, "'")),
  );
  const counts = new Map<string, number>();
  for (const match of title.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
    const key = match[0].normalize("NFKC").toLocaleLowerCase().replace(/[’]/g, "'");
    if (exemptions.has(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > maximum)
    .map(([word]) => word);
}
