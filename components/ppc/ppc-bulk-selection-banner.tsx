// components/ppc/ppc-bulk-selection-banner.tsx
"use client";

import React from "react";
import { Sparkle, ArrowCounterClockwise } from "@phosphor-icons/react";
import type { BulkSelectionMode } from "@/types/bulk-selection";

export interface PpcBulkSelectionBannerProps {
  mode: BulkSelectionMode;
  isPageAllSelected: boolean;
  currentPageCount: number;
  totalFilteredCount: number;
  totalSelectedCount: number;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  itemName?: string;
  className?: string;
}

export const PpcBulkSelectionBanner: React.FC<PpcBulkSelectionBannerProps> = ({
  mode,
  isPageAllSelected,
  currentPageCount,
  totalFilteredCount,
  totalSelectedCount,
  onSelectAllFiltered,
  onClearSelection,
  itemName = "mục",
  className = "",
}) => {
  // Chỉ hiển thị khi chọn hết trang và còn nhiều trang khác, HOẶC đã ở chế độ ALL_FILTERED
  const shouldShow =
    (isPageAllSelected && totalFilteredCount > currentPageCount) ||
    mode === "ALL_FILTERED";

  if (!shouldShow) return null;

  return (
    <div
      className={`px-4 py-2.5 text-center text-xs font-medium border-y transition-all duration-200 animate-in fade-in slide-in-from-top-1 ${
        mode === "ALL_FILTERED"
          ? "bg-amber-50/90 text-amber-950 border-amber-200/80 shadow-2xs"
          : "bg-indigo-50/90 text-indigo-950 border-indigo-200/80 shadow-2xs"
      } ${className}`}
    >
      {mode === "MANUAL" ? (
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          <span>
            Đã chọn <strong className="font-bold text-indigo-700">{currentPageCount}</strong> {itemName} trên trang này.
          </span>
          <button
            type="button"
            onClick={onSelectAllFiltered}
            className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-800 underline decoration-indigo-300 hover:decoration-indigo-800 underline-offset-2 transition cursor-pointer ml-1"
          >
            <Sparkle size={13} weight="fill" className="text-amber-500" />
            <span>
              Chọn toàn bộ {totalFilteredCount.toLocaleString("vi-VN")} {itemName} phù hợp với bộ lọc hiện tại
            </span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Đang chọn toàn bộ{" "}
            <strong className="font-extrabold text-amber-900 bg-amber-200/60 px-1.5 py-0.5 rounded font-mono">
              {totalSelectedCount.toLocaleString("vi-VN")}
            </strong>{" "}
            {itemName} phù hợp với bộ lọc.
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex items-center gap-1 font-bold text-rose-600 hover:text-rose-800 underline decoration-rose-300 hover:decoration-rose-800 underline-offset-2 transition cursor-pointer ml-2"
          >
            <ArrowCounterClockwise size={13} weight="bold" />
            <span>Hủy chọn tất cả</span>
          </button>
        </div>
      )}
    </div>
  );
};
