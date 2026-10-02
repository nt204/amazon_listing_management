// types/bulk-selection.ts

export type BulkSelectionMode = "MANUAL" | "ALL_FILTERED";

export interface ManualBulkSelectionPayload {
  mode: "MANUAL";
  selectedIds: string[];
}

export interface AllFilteredBulkSelectionPayload<TFilters = Record<string, any>> {
  mode: "ALL_FILTERED";
  excludedIds: string[];
  filters: TFilters;
}

export type BulkSelectionPayload<TFilters = Record<string, any>> =
  | ManualBulkSelectionPayload
  | AllFilteredBulkSelectionPayload<TFilters>;

/**
 * Helper kiểm tra xem một ID cụ thể có nằm trong phạm vi lựa chọn không
 */
export function isItemBulkSelected(
  id: string,
  payload: BulkSelectionPayload
): boolean {
  if (payload.mode === "MANUAL") {
    return payload.selectedIds.includes(id);
  }
  return !payload.excludedIds.includes(id);
}
