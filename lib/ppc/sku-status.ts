import { isWinStatus } from "./new-camp-fields";

export const SKU_STATUSES = ["WIN", "TEST", "FAIL"] as const;
export type SkuStatus = (typeof SKU_STATUSES)[number];
export type SkuStatusFilter = "ALL" | SkuStatus;

export function getSkuStatus(status?: string | null): SkuStatus | null {
  const value = status?.normalize("NFC").trim().toLowerCase();
  if (isWinStatus(value) || value === "win") return "WIN";
  if (value === "test" || value === "đang test") return "TEST";
  if (value === "fail" || value === "hủy" || value === "huỷ") return "FAIL";
  return null;
}
