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

/** Normalized physical specifications parsed from a Trello card description. */
export interface ParsedDimensions {
  length: string;
  width: string;
  thickness: string;
  formatted: string;
  capacity?: string;
}

export function mockupIndexFromAttachmentName(name: string): number | null {
  const match = name.trim().match(/^Mockup(\d+)_/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 && index <= 20 ? index : null;
}
