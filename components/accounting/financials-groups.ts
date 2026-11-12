// Mục Financials trên sidebar chia theo kỳ: Ngày / Tuần / Tháng — mỗi mục chỉ hiện các tab của kỳ đó.
// File nhỏ, không import component: sidebar (listing-workspace) dùng được mà không nạp cả FinancialsWorkspace.

export type FinancialsSubTab =
  | "sku_win"
  | "sku_test"
  | "sku_monthly"
  | "weekly"
  | "fba"
  | "fbm"
  | "sku_monthly_fbm"
  | "fbm_fixed";

export type FinancialsGroup = "day" | "week" | "month";

export const FINANCIALS_GROUPS: FinancialsGroup[] = ["day", "week", "month"];

export const GROUP_TABS: Record<FinancialsGroup, FinancialsSubTab[]> = {
  day: ["fba", "sku_win", "sku_test", "fbm", "fbm_fixed"],
  week: ["weekly"],
  month: ["sku_monthly", "sku_monthly_fbm"],
};

const SUB_TABS = Object.values(GROUP_TABS).flat();

export function isSubTab(value: string | null | undefined): value is FinancialsSubTab {
  return SUB_TABS.includes(value as FinancialsSubTab);
}

/** subtab trên URL / sidebar: "day" | "week" | "month", hoặc key tab cũ (vd "sku_monthly") → kỳ chứa tab đó */
export function financialsGroupOf(subTab: string | null | undefined): FinancialsGroup {
  if (FINANCIALS_GROUPS.includes(subTab as FinancialsGroup)) return subTab as FinancialsGroup;
  if (isSubTab(subTab)) return FINANCIALS_GROUPS.find((g) => GROUP_TABS[g].includes(subTab)) ?? "day";
  return "day";
}
