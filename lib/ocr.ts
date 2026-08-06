export interface OcrLine {
  text: string;
  confidence: number;
  sourceImage: number;
  occurrences: number;
}

export interface LocalOcrResult {
  engine: "tesseract";
  language: string;
  status: "success" | "partial" | "failed" | "disabled";
  imagesProcessed: number;
  lines: OcrLine[];
  warnings: string[];
}

export function ocrLineId(index: number) {
  return `ocr-line-${index + 1}`;
}

interface OcrLineRules {
  minimum_word_confidence: number;
  minimum_line_confidence: number;
  medium_confidence: number;
  high_confidence: number;
  repeated_line_confidence_bonus: number;
  minimum_alphanumeric_characters: number;
  maximum_line_characters: number;
  maximum_lines: number;
}

interface OcrWord {
  text: string;
  confidence: number;
  order: number;
}

const normalizedKey = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function joinWords(words: OcrWord[]) {
  return words
    .sort((left, right) => left.order - right.order)
    .map((word) => word.text.replace(/[\u0000-\u001f\u007f]/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?%)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function weightedConfidence(words: OcrWord[]) {
  const weighted = words.reduce((summary, word) => {
    const weight = Math.max(word.text.match(/[\p{L}\p{N}]/gu)?.length || 0, 1);
    return {
      score: summary.score + Math.max(word.confidence, 0) * weight,
      weight: summary.weight + weight,
    };
  }, { score: 0, weight: 0 });
  return weighted.weight ? weighted.score / weighted.weight : 0;
}

export function parseOcrTsv(
  tsv: string,
  sourceImage: number,
  rules: OcrLineRules,
): OcrLine[] {
  const groups = new Map<string, { paragraphKey: string; lineOrder: number; words: OcrWord[] }>();
  for (const [rowIndex, row] of tsv.split(/\r?\n/).entries()) {
    if (!row.trim()) continue;
    const columns = row.split("\t");
    if (columns.length < 12 || columns[0] !== "5") continue;
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join("\t").trim();
    if (!text || !Number.isFinite(confidence)) continue;
    const key = [columns[1], columns[2], columns[3], columns[4]].join(":");
    const group = groups.get(key) || {
      paragraphKey: [columns[1], columns[2], columns[3]].join(":"),
      lineOrder: Number(columns[4]) || rowIndex,
      words: [],
    };
    group.words.push({ text, confidence, order: Number(columns[5]) || rowIndex });
    groups.set(key, group);
  }

  const paragraphLines = new Map<string, Array<{ text: string; confidence: number; order: number }>>();
  for (const group of groups.values()) {
    const words = group.words;
    if (!words.some((word) => word.confidence >= rules.minimum_word_confidence)) continue;
    const text = joinWords(words);
    const alphanumericCharacters = text.match(/[\p{L}\p{N}]/gu)?.length || 0;
    const confidence = weightedConfidence(words);
    if (
      alphanumericCharacters < rules.minimum_alphanumeric_characters ||
      text.length > rules.maximum_line_characters ||
      confidence < rules.minimum_line_confidence
    ) continue;
    const paragraph = paragraphLines.get(group.paragraphKey) || [];
    paragraph.push({ text, confidence, order: group.lineOrder });
    paragraphLines.set(group.paragraphKey, paragraph);
  }

  return [...paragraphLines.values()].flatMap((paragraph): OcrLine[] => {
    const ordered = paragraph.sort((left, right) => left.order - right.order);
    const combined = ordered.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    const combinedConfidence = ordered.reduce((sum, line) => sum + line.confidence, 0) /
      Math.max(ordered.length, 1);
    if (combined.length > rules.maximum_line_characters) {
      return ordered.map((line) => ({
        text: line.text,
        confidence: Math.round(line.confidence * 10) / 10,
        sourceImage,
        occurrences: 1,
      }));
    }
    return [{
      text: combined,
      confidence: Math.round(combinedConfidence * 10) / 10,
      sourceImage,
      occurrences: 1,
    }];
  });
}

export function parseOcrTextFallback(
  text: string,
  confidence: number,
  sourceImage: number,
  rules: OcrLineRules,
) {
  if (confidence < rules.minimum_line_confidence) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const alphanumericCharacters = line.match(/[\p{L}\p{N}]/gu)?.length || 0;
      return alphanumericCharacters >= rules.minimum_alphanumeric_characters &&
        line.length <= rules.maximum_line_characters;
    })
    .map((line): OcrLine => ({
      text: line,
      confidence: Math.round(confidence * 10) / 10,
      sourceImage,
      occurrences: 1,
    }));
}

export function consolidateOcrLines(
  lines: OcrLine[],
  rules: OcrLineRules,
  priorityPattern?: string,
) {
  const consolidated = new Map<string, { line: OcrLine; sourceImages: Set<number> }>();
  for (const line of lines) {
    const key = normalizedKey(line.text);
    if (!key) continue;
    const existing = consolidated.get(key);
    if (!existing) {
      consolidated.set(key, { line: { ...line }, sourceImages: new Set([line.sourceImage]) });
      continue;
    }
    existing.sourceImages.add(line.sourceImage);
    if (
      line.confidence > existing.line.confidence ||
      (line.confidence === existing.line.confidence && line.text.length > existing.line.text.length)
    ) existing.line = { ...line };
  }

  const priority = priorityPattern ? new RegExp(priorityPattern, "iu") : undefined;
  return [...consolidated.values()]
    .map(({ line, sourceImages }) => ({
      ...line,
      occurrences: sourceImages.size,
      confidence: Math.min(
        100,
        Math.round((line.confidence + Math.max(0, sourceImages.size - 1) *
          rules.repeated_line_confidence_bonus) * 10) / 10,
      ),
    }))
    .sort((left, right) =>
      Number(Boolean(priority?.test(right.text))) - Number(Boolean(priority?.test(left.text))) ||
      right.occurrences - left.occurrences ||
      right.confidence - left.confidence ||
      left.sourceImage - right.sourceImage,
    )
    .slice(0, rules.maximum_lines);
}
