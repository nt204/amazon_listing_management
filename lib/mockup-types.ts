export type MockupModel =
  | "gpt-image-2"
  | "gpt-image-2-c"
  | "gpt-image-2-cheapkey"
  | "gpt-image-1.5"
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "fast-graphic"
  | "chatgpt-web-automation";

export type MockupImageQuality = "low" | "medium" | "high";

/** One source image is retained as Content 1; at most six additional images use AI. */
export const MAX_AI_MOCKUPS_PER_PRODUCT = 6;

export function planMockupGeneration(input: {
  selectedSteps?: readonly number[];
  existingIndexes: readonly number[];
  forceRegenerate: boolean;
}) {
  const targetIndexes = Array.from(
    new Set(input.selectedSteps || [2, 3, 4, 5, 6, 7]),
  ).filter((index) => index >= 2);
  const selectedStepSet = new Set(targetIndexes);
  const existingIndexesSet = new Set(input.existingIndexes);
  const skipIndexes = Array.from(
    new Set([
      1,
      ...Array.from(existingIndexesSet).filter(
        (index) =>
          !(
            input.forceRegenerate &&
            selectedStepSet.has(index) &&
            index >= 2
          ),
      ),
    ]),
  );
  const existingAiCount = Array.from(existingIndexesSet).filter(
    (index) => index >= 2,
  ).length;
  const maxAiAllowed = input.forceRegenerate
    ? MAX_AI_MOCKUPS_PER_PRODUCT
    : Math.max(0, MAX_AI_MOCKUPS_PER_PRODUCT - existingAiCount);
  const stepsToGenerate = targetIndexes
    .filter((index) => !skipIndexes.includes(index))
    .slice(0, maxAiAllowed);

  return {
    selectedStepSet,
    skipIndexes,
    existingAiCount,
    stepsToGenerate,
  };
}

export function limitSelectedMockupContents<
  T extends { id: number; checked: boolean },
>(contents: readonly T[]): T[] {
  let selectedAiCount = 0;

  return contents.map((content) => {
    if (content.id === 1) {
      return content.checked ? content : { ...content, checked: true };
    }
    if (!content.checked) return content;
    if (selectedAiCount >= MAX_AI_MOCKUPS_PER_PRODUCT) {
      return { ...content, checked: false };
    }
    selectedAiCount += 1;
    return content;
  });
}

/** Normalized physical specifications parsed from a Trello card description. */
export interface ParsedDimensions {
  length: string;
  width: string;
  thickness: string;
  formatted: string;
  capacity?: string;
}

export function mockupIndexFromAttachmentName(name: string): number | null {
  const match = name.trim().match(/^Mockup\s*(\d+)(?=[\s_.-]|$)/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 && index <= 20 ? index : null;
}

/**
 * Keep the source artwork first and generated mockups in their numbered slots.
 * A decorated copy is used so ties retain the order received from Trello.
 */
export function sortMockupAttachments<T extends { name: string }>(
  attachments: readonly T[],
): T[] {
  return attachments
    .map((attachment, originalIndex) => ({ attachment, originalIndex }))
    .sort((left, right) => {
      const leftIndex = mockupIndexFromAttachmentName(left.attachment.name);
      const rightIndex = mockupIndexFromAttachmentName(right.attachment.name);

      if (leftIndex === null && rightIndex !== null) return -1;
      if (leftIndex !== null && rightIndex === null) return 1;

      return (
        (leftIndex ?? 0) - (rightIndex ?? 0) ||
        left.originalIndex - right.originalIndex
      );
    })
    .map(({ attachment }) => attachment);
}
