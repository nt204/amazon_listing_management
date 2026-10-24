"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsInLineHorizontalIcon,
  CaretLeftIcon,
  CaretRightIcon,
  EyeSlashIcon,
  FunnelIcon,
  LockIcon,
  LockOpenIcon,
  PencilSimpleIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ReturnItem, ReturnStats } from "@/lib/accounting/returns-db";
import type { Store } from "@/lib/accounting/types";
import {
  type ColumnConfig,
  DEFAULT_RETURN_INPUT_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";

export const RETURN_COLUMNS_STORAGE_KEY = "acc_return_input_columns_global";
export const RETURN_FROZEN_STORAGE_KEY = "acc_return_input_frozen_global";

function getColumnWidth(column?: ColumnConfig, fallback = 120): number {
  if (!column?.width) return fallback;
  if (typeof column.width === "number") return column.width;
  if (typeof column.width === "string") {
    const match = column.width.match(/w-\[(\d+)px\]/);
    if (match) return Number(match[1]);
    const num = parseInt(column.width, 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return fallback;
}

function formatCurrency(val?: number | null): string {
  if (val === undefined || val === null || isNaN(val)) return "$0.00";
  const isNeg = val < 0;
  const abs = Math.abs(val);
  return `${isNeg ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface ReturnInputViewProps {
  stores: Store[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
  dateSort: "asc" | "desc";
  setDateSort: (d: "asc" | "desc") => void;
  startDate: string;
  setStartDate: (d: string) => void;
  endDate: string;
  setEndDate: (d: string) => void;
  onStatsChange?: (stats: ReturnStats) => void;
  tableZoom?: number;
  showImportModal: boolean;
  setShowImportModal: (open: boolean) => void;
  showColumnModal: boolean;
  setShowColumnModal: (open: boolean) => void;
  resetColumnsSignal?: number;
  reloadSignal?: number;
  onTotalReturnsChange?: (total: number) => void;
  notify?: (message: string, type?: "success" | "error") => void;
}

export function ReturnInputView({
  stores,
  selectedStoreId,
  search,
  dateSort,
  startDate,
  endDate,
  onStatsChange,
  tableZoom = 100,
  showImportModal,
  setShowImportModal,
  showColumnModal,
  setShowColumnModal,
  resetColumnsSignal = 0,
  reloadSignal = 0,
  onTotalReturnsChange,
  notify = () => {},
}: ReturnInputViewProps) {
  const currentStore = useMemo(
    () => stores.find((s) => s.id === selectedStoreId),
    [stores, selectedStoreId]
  );

  // Data state
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Column header interactions & Drag/Drop
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);
  const [columnContextMenu, setColumnContextMenu] = useState<{
    x: number;
    y: number;
    field: string;
  } | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Columns & Frozen configuration
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(RETURN_COLUMNS_STORAGE_KEY);
      if (saved) {
        try {
          const parsed: ColumnConfig[] = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defaultMap = new Map(DEFAULT_RETURN_INPUT_COLUMNS.map((c) => [c.id, c]));
            const merged: ColumnConfig[] = [];
            const seen = new Set<string>();

            for (const col of parsed) {
              const def = defaultMap.get(col.id);
              if (def) {
                merged.push({
                  ...def,
                  ...col,
                  width: col.width ?? def.width,
                  label: col.label || def.label,
                });
                seen.add(col.id);
              }
            }
            for (const def of DEFAULT_RETURN_INPUT_COLUMNS) {
              if (!seen.has(def.id)) merged.push(def);
            }
            return merged;
          }
        } catch (err) {
          console.warn("Failed to load return columns:", err);
        }
      }
    }
    return DEFAULT_RETURN_INPUT_COLUMNS;
  });

  const [frozenThrough, setFrozenThrough] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(RETURN_FROZEN_STORAGE_KEY) || "sku";
    }
    return "sku";
  });

  // Save Column configurations
  const handleSaveColumns = useCallback(
    (newCols: ColumnConfig[]) => {
      setColumns(newCols);
      try {
        localStorage.setItem(RETURN_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
      } catch {}
      notify("Đã cập nhật cấu hình cột Return cho toàn bộ các Store!", "success");
    },
    [notify]
  );

  const handleResetColumns = useCallback(() => {
    setColumns(DEFAULT_RETURN_INPUT_COLUMNS);
    setFrozenThrough("sku");
    try {
      localStorage.removeItem(RETURN_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(RETURN_FROZEN_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục các cột Return về mặc định file Excel!", "success");
  }, [notify]);

  // Sync external signal triggers
  useEffect(() => {
    if (resetColumnsSignal > 0) {
      handleResetColumns();
    }
  }, [resetColumnsSignal, handleResetColumns]);

  // Reorder columns
  const handleReorderColumns = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      setColumns((prev) => {
        const fromIndex = prev.findIndex((c) => c.id === fromId);
        const toIndex = prev.findIndex((c) => c.id === toId);
        if (fromIndex === -1 || toIndex === -1) return prev;
        const updated = [...prev];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        try {
          localStorage.setItem(RETURN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
    },
    []
  );

  // Resize column
  const handleResizeColumn = useCallback((colId: string, newWidth: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) =>
        c.id === colId ? { ...c, width: Math.max(54, Math.round(newWidth)) } : c
      );
      try {
        localStorage.setItem(RETURN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // Auto-fit calculations
  const calculateAutoFitWidth = useCallback(
    (colId: string, label: string): number => {
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;
      for (const item of returns) {
        const val = (item as any)[colId];
        if (val != null) {
          let str = "";
          if (typeof val === "number") {
            str = `$${val.toFixed(2)}`;
          } else {
            str = String(val).trim();
          }
          maxContentWidth = Math.max(maxContentWidth, measureText(str));
        }
      }

      const contentWidth = maxContentWidth > 0 ? Math.ceil(maxContentWidth + 30) : 0;
      const labelWords = (label || colId).split(/[-_ ]+/).filter(Boolean);
      const longestWordLength =
        labelWords.length > 0 ? Math.max(...labelWords.map((w) => w.length)) : 5;
      const headerWidth = Math.round(longestWordLength * 8.2 + 26);
      const targetWidth = Math.max(contentWidth, headerWidth);
      return Math.max(54, targetWidth);
    },
    [returns]
  );

  const handleAutoFitColumn = useCallback(
    (colId: string) => {
      setColumns((prev) => {
        const targetCol = prev.find((c) => c.id === colId);
        if (!targetCol) return prev;
        const snugWidth = calculateAutoFitWidth(colId, targetCol.label);
        const updated = prev.map((c) =>
          c.id === colId ? { ...c, width: snugWidth } : c
        );
        try {
          localStorage.setItem(RETURN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã thu nhỏ cột!", "success");
    },
    [calculateAutoFitWidth, notify]
  );

  // Set frozen boundary
  const handleSetFrozenColumn = useCallback(
    (colId: string) => {
      setFrozenThrough(colId);
      try {
        localStorage.setItem(RETURN_FROZEN_STORAGE_KEY, colId);
      } catch {}
      notify("Đã cập nhật vị trí khóa cột!", "success");
    },
    [notify]
  );

  // Hide column
  const handleQuickHideColumn = useCallback(
    (colId: string) => {
      setColumns((prev) => {
        const updated = prev.map((c) =>
          c.id === colId ? { ...c, visible: false } : c
        );
        try {
          localStorage.setItem(RETURN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột!", "success");
    },
    [notify]
  );

  // Column options for filter
  const getColumnOptions = useCallback(
    (fieldId: string) => {
      const set = new Set<string>();
      returns.forEach((row) => {
        const val = (row as any)[fieldId];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          set.add(String(val).trim());
        }
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 50);
    },
    [returns]
  );

  const setColumnFilter = useCallback((field: string, val: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!val) delete next[field];
      else next[field] = val;
      return next;
    });
    setPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setColumnFilters({});
    setPage(1);
  }, []);

  // Reset page on date range change
  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  // Fetch Return Data
  const fetchReturns = useCallback(async () => {
    if (!selectedStoreId) {
      setReturns([]);
      setTotalRows(0);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("store_id", selectedStoreId);
      params.set("page", String(page));
      params.set("limit", String(limit));
      params.set("dateSort", dateSort);
      if (search) params.set("search", search);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      for (const [col, val] of Object.entries(columnFilters)) {
        if (val) params.set(`filter_${col}`, val);
      }

      const res = await fetch(`/api/accounting/returns?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải dữ liệu Return");
      const data = await res.json();

      setReturns(data.items || []);
      setTotalRows(data.totalRows || 0);
      if (data.stats) {
        onStatsChange?.(data.stats);
      }
      onTotalReturnsChange?.(data.totalRows || 0);
    } catch (err: any) {
      notify(err.message || "Lỗi tải dữ liệu Return", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, page, limit, dateSort, search, startDate, endDate, columnFilters, notify, onStatsChange, onTotalReturnsChange]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns, reloadSignal]);

  // Click-outside listener for column menu
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnContextMenu(null);
      }
    };
    if (columnContextMenu) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [columnContextMenu]);

  // Frozen columns calculation
  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const freezeMap = useMemo(() => {
    const boundaryIndex = visibleColumns.findIndex((c) => c.id === frozenThrough);
    let leftSum = 0;
    const map: Record<
      string,
      { isFrozen: boolean; isBoundary: boolean; left: number; width: number }
    > = {};

    visibleColumns.forEach((c, idx) => {
      const width = getColumnWidth(c);
      const isFrozen = boundaryIndex >= 0 && idx <= boundaryIndex;
      const isBoundary = boundaryIndex >= 0 && idx === boundaryIndex;
      map[c.id] = {
        isFrozen,
        isBoundary,
        left: isFrozen ? leftSum : 0,
        width,
      };
      if (isFrozen) {
        leftSum += width;
      }
    });

    return map;
  }, [visibleColumns, frozenThrough]);

  const getCellFreezeProps = useCallback(
    (colId: string, isHeader = false) => {
      const freeze = freezeMap[colId];
      if (!freeze?.isFrozen) {
        const width = freeze?.width || 120;
        return {
          isFrozen: false,
          isBoundary: false,
          style: {
            width,
            minWidth: width,
            maxWidth: width,
          } as React.CSSProperties,
          className: isHeader
            ? "bg-[#ff9900] text-slate-950 border-r border-amber-600"
            : "border-r border-slate-200 group-even:bg-slate-50/60 group-hover:bg-amber-50/40",
        };
      }

      const style: React.CSSProperties = {
        position: "sticky",
        left: freeze.left,
        zIndex: isHeader ? 40 : 20,
        width: freeze.width,
        minWidth: freeze.width,
        maxWidth: freeze.width,
        backgroundColor: isHeader ? "#f59e0b" : "#ffffff",
      };

      const className = isHeader
        ? `bg-[#f59e0b] text-slate-950 ${
            freeze.isBoundary
              ? "border-r-2 !border-r-amber-900"
              : "border-r border-amber-600"
          }`
        : `bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] ${
            freeze.isBoundary
              ? "border-r-2 !border-r-slate-400"
              : "border-r border-slate-200"
          }`;

      return {
        isFrozen: true,
        isBoundary: freeze.isBoundary,
        style,
        className,
      };
    },
    [freezeMap]
  );

  const totalPages = Math.max(1, Math.ceil(totalRows / limit));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Read-only cell renderer (Không cho sửa/xóa vì đây là dữ liệu đầu vào import)
  const renderCellContent = (item: ReturnItem, colId: string, rowIndex: number) => {
    switch (colId) {
      case "stt":
        return <span className="text-[13px] text-slate-700 font-medium tabular-nums">{(page - 1) * limit + rowIndex + 1}</span>;
      case "sku":
        return (
          <span className="font-medium text-slate-950 text-[13px] select-all" title={item.sku || ""}>
            {item.sku || "—"}
          </span>
        );
      case "loai":
        return <span className="text-[13px] font-normal text-slate-900">{item.loai || "—"}</span>;
      case "pic":
        return <span className="text-[13px] font-normal text-slate-900">{item.pic || "—"}</span>;
      case "basecost":
        return (
          <span className="text-[13px] font-medium text-slate-900 tabular-nums">
            {item.basecost != null ? formatCurrency(item.basecost) : "—"}
          </span>
        );
      case "date":
        return <span className="text-[13px] font-normal text-slate-900 whitespace-nowrap tabular-nums">{item.date || "—"}</span>;
      case "order_id":
        return (
          <span
            className="text-[13px] font-medium text-indigo-700 select-all cursor-pointer hover:underline"
            title="Mã đơn hàng Amazon"
          >
            {item.order_id || "—"}
          </span>
        );
      case "transaction_status":
        return (
          <span className="inline-block px-2 py-0.5 rounded text-xs border shadow-2xs bg-emerald-100 text-emerald-950 border-emerald-300 font-medium">
            {item.transaction_status || "Completed"}
          </span>
        );
      case "transaction_type":
        return <span className="text-[13px] font-normal text-slate-900">{item.transaction_type || "Refund"}</span>;
      case "product_details":
        return (
          <span className="text-slate-900 text-[13px] truncate block leading-snug" title={item.product_details || ""}>
            {item.product_details || "—"}
          </span>
        );
      case "total_product_charges":
        return (
          <span className="text-[13px] font-medium text-rose-700 tabular-nums">
            {formatCurrency(item.total_product_charges)}
          </span>
        );
      case "total_promotional_rebates":
        return <span className="text-[13px] font-normal text-slate-900 tabular-nums">{formatCurrency(item.total_promotional_rebates)}</span>;
      case "amazon_fees":
        return (
          <span className="text-[13px] font-medium text-amber-800 tabular-nums">
            {formatCurrency(item.amazon_fees)}
          </span>
        );
      case "other":
        return <span className="text-[13px] font-normal text-slate-900 tabular-nums">{formatCurrency(item.other)}</span>;
      case "total":
        return (
          <span className="text-[13px] font-bold text-rose-700 tabular-nums">
            {formatCurrency(item.total)}
          </span>
        );
      case "return_sau_basecost":
        return (
          <span className={`text-[13px] font-bold tabular-nums ${(item.return_sau_basecost ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {formatCurrency(item.return_sau_basecost)}
          </span>
        );
      case "tuan":
        return <span className="text-[13px] font-normal text-slate-900 text-center block tabular-nums">{item.tuan != null ? `W${item.tuan}` : "—"}</span>;
      case "thang":
        return <span className="text-[13px] font-normal text-slate-900 text-center block tabular-nums">{item.thang != null ? `T${item.thang}` : "—"}</span>;
      case "quy":
        return <span className="text-[13px] font-normal text-slate-900 text-center block tabular-nums">{item.quy != null ? `Q${item.quy}` : "—"}</span>;
      case "trang_thai":
        return <span className="text-[13px] font-normal text-slate-900">{item.trang_thai || "—"}</span>;
      default: {
        const raw = (item as any)[colId];
        return <span className="text-[13px] font-normal text-slate-900">{raw != null && raw !== "" ? String(raw) : "—"}</span>;
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* ACTIVE COLUMN FILTERS BAR */}
      {Object.keys(columnFilters).length > 0 && (
        <div className="flex items-center gap-2 p-2 bg-amber-50/60 border border-amber-200 rounded-xl flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
            <FunnelIcon size={12} weight="bold" />
            Đang lọc theo:
          </span>
          {Object.entries(columnFilters).map(([field, val]) => {
            const col = columns.find((c) => c.id === field);
            const label = col?.label || field;
            return (
              <span
                key={field}
                className="inline-flex items-center gap-1 text-xs bg-white text-amber-950 border border-amber-300 px-2 py-0.5 rounded-md font-semibold shadow-2xs"
              >
                <span className="text-slate-600 font-medium">{label}:</span>
                <span className="font-bold text-amber-900">{val}</span>
                <button
                  type="button"
                  onClick={() => setColumnFilter(field, "")}
                  className="ml-1 hover:text-rose-600 rounded p-0.5 cursor-pointer"
                  title={`Xóa lọc cột ${label}`}
                >
                  <XIcon size={12} weight="bold" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer ml-1"
          >
            Xóa tất cả lọc
          </button>
        </div>
      )}

      {/* SPREADSHEET TABLE */}
      <div className="rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col relative">
        {loading && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-200 z-50 overflow-hidden">
            <div className="h-full bg-amber-600 animate-pulse w-full" />
          </div>
        )}

        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
          <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
            <table className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-xs font-medium">
              <colgroup>
                {visibleColumns.map((col) => (
                  <col key={col.id} style={{ width: getColumnWidth(col) }} />
                ))}
              </colgroup>

              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs font-semibold uppercase tracking-[0.04em]">
                  {visibleColumns.map((col) => {
                    const f = getCellFreezeProps(col.id, true);
                    return (
                      <ColumnHeaderCell
                        key={col.id}
                        col={col}
                        isFrozen={f.isFrozen}
                        isBoundary={f.isBoundary}
                        style={f.style}
                        className={`py-1.5 px-2 text-xs bg-[#ff9900] text-slate-900 font-bold border-r border-amber-600/60 leading-tight select-none ${f.className}`}
                        draggable={!col.isFrozen}
                        isDragging={headerDragId === col.id}
                        isDragOver={headerDragOverId === col.id}
                        onDragStart={() => setHeaderDragId(col.id)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setHeaderDragOverId(col.id);
                        }}
                        onDragLeave={() => setHeaderDragOverId(null)}
                        onDrop={() => {
                          if (headerDragId && headerDragOverId) {
                            handleReorderColumns(headerDragId, headerDragOverId);
                          }
                          setHeaderDragId(null);
                          setHeaderDragOverId(null);
                        }}
                        onDragEnd={() => {
                          setHeaderDragId(null);
                          setHeaderDragOverId(null);
                        }}
                        onResize={handleResizeColumn}
                        onAutoFit={handleAutoFitColumn}
                        onColumnClick={(id, e) => {
                          setColumnContextMenu({
                            field: id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <div className="flex items-center justify-center w-full min-h-[32px] relative group/title px-1">
                          <span
                            className="leading-tight break-words text-center font-bold text-slate-900 text-xs whitespace-normal inline-flex items-center gap-1 justify-center"
                            title={col.label}
                          >
                            <span className="line-clamp-2 break-words whitespace-normal leading-tight">
                              {col.label}
                            </span>
                            {columnFilters[col.id] && (
                              <span
                                title={`Đang lọc: ${columnFilters[col.id]}`}
                                className="inline-block h-2 w-2 rounded-full bg-rose-600 ring-2 ring-white shrink-0"
                              />
                            )}
                          </span>
                        </div>
                      </ColumnHeaderCell>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="bg-white text-xs">
                {loading && returns.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-20 text-center text-slate-400">
                      <div className="inline-flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                        <span>Đang tải dữ liệu Return...</span>
                      </div>
                    </td>
                  </tr>
                ) : returns.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-20 text-center text-slate-500">
                      <div className="mx-auto max-w-sm space-y-2">
                        <p className="font-semibold text-slate-700">Chưa có dữ liệu Return</p>
                        <p className="text-xs text-slate-500">
                          Nhấn nút <b>"Nhập File Return"</b> ở thanh công cụ phía trên để nạp file báo cáo đối soát hoàn tiền từ Amazon Seller Central hoặc ketoan_limima.xlsx.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  returns.map((row, rowIndex) => (
                    <tr
                      key={row.id}
                      className="group h-[34px] min-h-[34px] transition-colors hover:bg-amber-50/50 even:bg-slate-50/60 [&>td]:border-b [&>td]:border-slate-200"
                    >
                      {visibleColumns.map((col) => {
                        const f = getCellFreezeProps(col.id, false);
                        const alignClass =
                          col.align === "center"
                            ? "text-center"
                            : col.align === "right"
                            ? "text-right"
                            : "text-left";

                        const cellVal = (row as any)[col.id];
                        return (
                          <td
                            key={col.id}
                            style={f.style}
                            className={`py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200 ${alignClass} ${f.className} overflow-hidden text-ellipsis whitespace-nowrap`}
                          >
                            <div className="truncate w-full min-w-0" title={typeof cellVal === "string" ? cellVal : undefined}>
                              {renderCellContent(row, col.id, rowIndex)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TABLE FOOTER / PAGINATION */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              Hiển thị{" "}
              <b>
                {totalRows === 0 ? 0 : (page - 1) * limit + 1} -{" "}
                {Math.min(page * limit, totalRows)}
              </b>{" "}
              trên tổng số <b>{totalRows.toLocaleString()}</b> dòng Return
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-slate-500 font-medium">Số dòng:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Đầu
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <CaretLeftIcon size={16} />
            </button>

            <span className="px-2 font-mono font-bold text-slate-800">
              Trang {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <CaretRightIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Cuối
            </button>
          </div>
        </div>
      </div>

      {/* COLUMN CONTEXT MENU */}
      {columnContextMenu && (() => {
        const field = columnContextMenu.field;
        const col = columns.find((c) => c.id === field);
        const colLabel = col?.label || field;
        const isCurrentBoundary = frozenThrough === field;
        const options = getColumnOptions(field);

        return (
          <div
            ref={columnMenuRef}
            style={{
              position: "fixed",
              left: Math.min(columnContextMenu.x, window.innerWidth - 240),
              top: Math.min(columnContextMenu.y, window.innerHeight - 260),
              zIndex: 100,
            }}
            className="w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">TÙY CHỌN CỘT</span>
              <span className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{colLabel}</span>
            </div>

            <div className="p-1 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setShowColumnModal(true);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <PencilSimpleIcon size={14} className="text-slate-500 shrink-0" />
                <span>Setting cột</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleAutoFitColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <ArrowsInLineHorizontalIcon size={14} className="text-amber-600 shrink-0" />
                <span>Thu nhỏ cột</span>
              </button>

              {!isCurrentBoundary ? (
                <button
                  type="button"
                  onClick={() => {
                    handleSetFrozenColumn(field);
                    setColumnContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-bold text-amber-950 bg-amber-50 hover:bg-amber-100 transition cursor-pointer"
                >
                  <LockIcon size={14} weight="bold" className="text-amber-600 shrink-0" />
                  <span>Khóa đến cột này</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    handleSetFrozenColumn("sku");
                    setColumnContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  <LockOpenIcon size={14} weight="bold" className="text-amber-600 shrink-0" />
                  <span>Bỏ khóa tùy chỉnh</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleQuickHideColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-rose-700 hover:bg-rose-50 transition cursor-pointer"
              >
                <EyeSlashIcon size={14} className="text-rose-500 shrink-0" />
                <span>Ẩn cột này</span>
              </button>
            </div>

            {options.length > 0 && (
              <label className="block border-t border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50/50">
                Lọc cột này
                <select
                  autoFocus
                  value={columnFilters[field] || ""}
                  onChange={(event) => {
                    setColumnFilter(field, event.target.value);
                    setColumnContextMenu(null);
                  }}
                  className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-hidden cursor-pointer"
                >
                  <option value="">-- Tất cả giá trị --</option>
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })()}

      {/* COLUMN SETTINGS MODAL */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
        title="Quản Lý Cột Bảng Return & Hoàn Tiền"
      />

      {/* IMPORT MODAL */}
      <ReturnImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        storeId={selectedStoreId}
        storeName={currentStore?.name || "Store"}
        onSuccess={() => {
          setShowImportModal(false);
          fetchReturns();
        }}
      />
    </div>
  );
}

// Modal import helper
function ReturnImportModal({
  isOpen,
  onClose,
  storeId,
  storeName,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeName: string;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpload = async () => {
    if (!file || !storeId) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("store_id", storeId);

    try {
      const res = await fetch("/api/accounting/returns/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tải lên thất bại");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Lỗi khi nạp file");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">Nhập Dữ Liệu Return & Hoàn Tiền</h3>
            <p className="text-xs text-slate-500 mt-0.5">Store đích: <b className="text-indigo-600">{storeName}</b></p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-indigo-400 transition bg-slate-50/50">
            <UploadSimpleIcon size={32} className="mx-auto text-slate-400" />
            <p className="mt-2 text-xs font-semibold text-slate-700">
              Chọn file báo cáo Return (.xlsx, .csv, .tsv)
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Hỗ trợ file báo cáo hoàn tiền từ Amazon Payments hoặc Sheet RETURN từ ketoan_limima.xlsx
            </p>
            <input
              type="file"
              accept=".xlsx,.csv,.tsv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-3 text-xs"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 font-medium">
              ⚠️ {error}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <p className="font-bold">✅ Nạp dữ liệu thành công!</p>
              <p className="mt-1">
                Đã xử lý <b>{result.processed}</b> / <b>{result.totalParsed}</b> dòng.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Đóng
          </button>
          {result ? (
            <button
              type="button"
              onClick={onSuccess}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-2xs"
            >
              Hoàn tất & Làm mới bảng
            </button>
          ) : (
            <button
              type="button"
              disabled={!file || uploading}
              onClick={handleUpload}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-2xs"
            >
              {uploading ? "Đang xử lý..." : "Tiến hành nạp dữ liệu"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
