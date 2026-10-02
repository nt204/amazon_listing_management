// hooks/use-bulk-selection.ts
"use client";

import { useState, useMemo, useCallback } from "react";
import type { BulkSelectionMode, BulkSelectionPayload } from "@/types/bulk-selection";

export interface UseBulkSelectionOptions<TFilters = Record<string, any>> {
  currentPageItems: Array<{ id: string }>;
  totalFilteredCount: number;
  currentFilters?: TFilters;
}

export function useBulkSelection<TFilters = Record<string, any>>({
  currentPageItems,
  totalFilteredCount,
  currentFilters = {} as TFilters,
}: UseBulkSelectionOptions<TFilters>) {
  const [mode, setMode] = useState<BulkSelectionMode>("MANUAL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  // Kiểm tra 1 dòng cụ thể có đang được chọn không
  const isSelected = useCallback(
    (id: string) => {
      if (mode === "MANUAL") {
        return selectedIds.has(id);
      }
      return !excludedIds.has(id);
    },
    [mode, selectedIds, excludedIds]
  );

  // Trạng thái checkbox ở header của trang hiện tại
  const isPageAllSelected = useMemo(() => {
    if (currentPageItems.length === 0) return false;
    return currentPageItems.every((item) => isSelected(item.id));
  }, [currentPageItems, isSelected]);

  const isPageIndeterminate = useMemo(() => {
    if (currentPageItems.length === 0) return false;
    const hasAny = currentPageItems.some((item) => isSelected(item.id));
    return hasAny && !isPageAllSelected;
  }, [currentPageItems, isSelected, isPageAllSelected]);

  // Toggle toàn bộ trang hiện tại
  const toggleSelectPage = useCallback(() => {
    if (isPageAllSelected) {
      if (mode === "ALL_FILTERED") {
        setExcludedIds((prev) => {
          const next = new Set(prev);
          currentPageItems.forEach((i) => next.add(i.id));
          return next;
        });
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          currentPageItems.forEach((i) => next.delete(i.id));
          return next;
        });
      }
    } else {
      if (mode === "ALL_FILTERED") {
        setExcludedIds((prev) => {
          const next = new Set(prev);
          currentPageItems.forEach((i) => next.delete(i.id));
          return next;
        });
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          currentPageItems.forEach((i) => next.add(i.id));
          return next;
        });
      }
    }
  }, [isPageAllSelected, mode, currentPageItems]);

  // Toggle 1 dòng cụ thể
  const toggleItem = useCallback(
    (id: string) => {
      if (mode === "ALL_FILTERED") {
        setExcludedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      }
    },
    [mode]
  );

  // Chọn toàn bộ theo bộ lọc hiện tại (Enterprise mode)
  const selectAllFiltered = useCallback(() => {
    setMode("ALL_FILTERED");
    setExcludedIds(new Set());
    setSelectedIds(new Set());
  }, []);

  // Hủy toàn bộ lựa chọn
  const clearSelection = useCallback(() => {
    setMode("MANUAL");
    setSelectedIds(new Set());
    setExcludedIds(new Set());
  }, []);

  // Tổng số lượng item đang được chọn thực tế
  const totalSelectedCount = useMemo(() => {
    if (mode === "MANUAL") {
      return selectedIds.size;
    }
    return Math.max(0, totalFilteredCount - excludedIds.size);
  }, [mode, selectedIds.size, totalFilteredCount, excludedIds.size]);

  // Tạo payload chuẩn để gửi lên Backend
  const getPayload = useCallback((): BulkSelectionPayload<TFilters> => {
    if (mode === "ALL_FILTERED") {
      return {
        mode: "ALL_FILTERED",
        excludedIds: Array.from(excludedIds),
        filters: currentFilters,
      };
    }
    return {
      mode: "MANUAL",
      selectedIds: Array.from(selectedIds),
    };
  }, [mode, excludedIds, currentFilters, selectedIds]);

  return {
    mode,
    selectedIds,
    excludedIds,
    isSelected,
    isPageAllSelected,
    isPageIndeterminate,
    totalSelectedCount,
    toggleSelectPage,
    toggleItem,
    selectAllFiltered,
    clearSelection,
    getPayload,
    setSelectedIds,
    setExcludedIds,
  };
}
