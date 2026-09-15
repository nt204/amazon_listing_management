"use client";

import { useState, useEffect } from "react";
import {
  CaretLeft,
  CaretRight,
  CaretDoubleLeft,
  CaretDoubleRight,
} from "@phosphor-icons/react";

export interface PpcPaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  pageSizeOptions?: number[];
  itemName?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function PpcPagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  pageSizeOptions = [15, 25, 50, 100, 200],
  itemName = "dòng",
  onPageChange,
  onPageSizeChange,
}: PpcPaginationProps) {
  const [jumpPage, setJumpPage] = useState(String(currentPage));

  useEffect(() => {
    setJumpPage(String(currentPage));
  }, [currentPage]);

  if (totalItems === 0) return null;

  const fromIndex = Math.min((currentPage - 1) * pageSize + 1, totalItems);
  const toIndex = Math.min(currentPage * pageSize, totalItems);

  const handleJumpSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsed = parseInt(jumpPage, 10);
    if (!Number.isNaN(parsed)) {
      const target = Math.max(1, Math.min(totalPages, parsed));
      onPageChange(target);
      setJumpPage(String(target));
    } else {
      setJumpPage(String(currentPage));
    }
  };

  // Generate pagination range with ellipses
  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "...")[] = [];
    pages.push(1);

    const leftBoundary = Math.max(2, currentPage - 1);
    const rightBoundary = Math.min(totalPages - 1, currentPage + 1);

    if (leftBoundary > 2) {
      pages.push("...");
    }

    for (let i = leftBoundary; i <= rightBoundary; i++) {
      pages.push(i);
    }

    if (rightBoundary < totalPages - 1) {
      pages.push("...");
    }

    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 select-none">
      {/* Items Summary Info */}
      <div className="flex items-center gap-1.5">
        <span>Hiển thị</span>
        <span className="font-bold text-slate-900">
          {fromIndex.toLocaleString("vi-VN")} - {toIndex.toLocaleString("vi-VN")}
        </span>
        <span>trên tổng số</span>
        <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
          {totalItems.toLocaleString("vi-VN")}
        </span>
        <span>{itemName}</span>
      </div>

      {/* Navigation and Page Size Controls */}
      <div className="flex flex-wrap items-center gap-2.5 ml-auto">
        {/* Page Size Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400 font-bold uppercase">Xem:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const newSize = Number(e.target.value);
              onPageSizeChange(newSize);
            }}
            className="py-1 px-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer transition shadow-2xs"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt} / trang
              </option>
            ))}
          </select>
        </div>

        {/* Buttons: First, Prev, Numbers, Next, Last */}
        <div className="flex items-center gap-1">
          {/* First Page */}
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            title="Trang đầu"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-600 cursor-pointer disabled:cursor-not-allowed transition shadow-2xs"
          >
            <CaretDoubleLeft size={13} weight="bold" />
          </button>

          {/* Prev Page */}
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            title="Trang trước"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-600 cursor-pointer disabled:cursor-not-allowed transition shadow-2xs"
          >
            <CaretLeft size={13} weight="bold" />
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) => {
              if (p === "...") {
                return (
                  <span key={`dots-${idx}`} className="px-1 text-slate-400 text-xs font-mono">
                    ...
                  </span>
                );
              }
              const isActive = p === currentPage;
              return (
                <button
                  key={`page-${p}`}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`min-w-[28px] h-7 px-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-xs border border-indigo-600 font-black"
                      : "border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 shadow-2xs"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {/* Next Page */}
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            title="Trang sau"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-600 cursor-pointer disabled:cursor-not-allowed transition shadow-2xs"
          >
            <CaretRight size={13} weight="bold" />
          </button>

          {/* Last Page */}
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            title="Trang cuối"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-600 cursor-pointer disabled:cursor-not-allowed transition shadow-2xs"
          >
            <CaretDoubleRight size={13} weight="bold" />
          </button>
        </div>

        {/* Quick Jump (useful when totalPages > 5) */}
        {totalPages > 5 && (
          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 pl-1 border-l border-slate-200">
            <span className="text-[11px] text-slate-400 font-medium">Đến:</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value.replace(/\D/g, ""))}
              onBlur={() => handleJumpSubmit()}
              className="w-11 py-1 px-1.5 text-center text-xs font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded-lg outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xs"
            />
            <span className="text-[11px] text-slate-400">/{totalPages}</span>
          </form>
        )}
      </div>
    </div>
  );
}
