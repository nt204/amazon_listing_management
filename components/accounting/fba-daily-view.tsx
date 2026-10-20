"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import type { FbaDailyItem, FbaDailyStats } from "@/lib/accounting/fba-daily-db";
import type { Store } from "@/lib/accounting/types";
import {
  type ColumnConfig,
  DEFAULT_FBA_DAILY_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";

const FBA_DAILY_COLUMNS_STORAGE_KEY = "acc_fba_daily_columns_global";
const FBA_DAILY_FROZEN_STORAGE_KEY = "acc_fba_daily_frozen_global";

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
}

function formatInteger(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(val));
}

function formatPercent(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

export function FbaDailyView() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "";
    }
    return "";
  });
  const [loadingStores, setLoadingStores] = useState(true);

  // Date Range state
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date();
    start.setTime(end.getTime());
    start.setDate(start.getDate() - 30);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      startDate: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      endDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
    };
  });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [sortField, setSortField] = useState<string>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const [items, setItems] = useState<FbaDailyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<FbaDailyStats | null>(null);
  const [loading, setLoading] = useState(false);

  // Table zoom
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("acc_fba_daily_zoom");
      return saved ? Number(saved) : 90;
    }
    return 90;
  });

  const handleZoomChange = (delta: number) => {
    setZoomLevel((prev) => {
      const next = Math.min(120, Math.max(70, prev + delta));
      localStorage.setItem("acc_fba_daily_zoom", String(next));
      return next;
    });
  };

  // Columns & Freezing
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(FBA_DAILY_COLUMNS_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defaultMap = new Map(DEFAULT_FBA_DAILY_COLUMNS.map((c) => [c.id, c]));
            return parsed.map((col: ColumnConfig) => {
              const def = defaultMap.get(col.id);
              return {
                ...col,
                label: col.label?.replace(/\s*\(\$\)\s*/g, "").trim() || def?.label || col.id,
                defaultLabel: def?.defaultLabel || col.defaultLabel || col.label,
                align: col.align || def?.align,
                width: col.width || def?.width,
              };
            });
          }
        } catch {
          // fallback
        }
      }
    }
    return DEFAULT_FBA_DAILY_COLUMNS;
  });

  const [frozenColumns, setFrozenColumns] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(FBA_DAILY_FROZEN_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // fallback
        }
      }
    }
    return ["stt", "week", "date"];
  });

  const [showColumnModal, setShowColumnModal] = useState(false);
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.visible !== false),
    [columns]
  );

  const handleResizeColumn = useCallback((colId: string, width: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) => (c.id === colId ? { ...c, width: Math.max(50, width) } : c));
      if (typeof window !== "undefined") {
        localStorage.setItem(FBA_DAILY_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const handleAutoFitColumn = useCallback(
    (colId: string) => {
      const targetCol = columns.find((c) => c.id === colId);
      if (!targetCol) return;
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;

      for (const item of items) {
        const val = (item as unknown as Record<string, unknown>)[colId];
        if (val != null) {
          let str = "";
          if (typeof val === "number") {
            str = colId.includes("pct") || colId === "margin" || colId === "roi" || colId === "tacos" || colId === "acos"
              ? `${(val * 100).toFixed(1)}%`
              : `$${val.toFixed(2)}`;
          } else {
            str = String(val).trim();
          }
          const w = measureText(str);
          maxContentWidth = Math.max(maxContentWidth, w);
        }
      }

      const contentWidth = maxContentWidth > 0 ? Math.ceil(maxContentWidth + 30) : 0;
      const labelWords = targetCol.label.split(/[-_ ]+/).filter(Boolean);
      const longestWordLength = labelWords.length > 0 ? Math.max(...labelWords.map((w) => w.length)) : 5;
      const headerWidth = Math.round(longestWordLength * 8.2 + 26);
      const snugWidth = Math.max(54, Math.max(contentWidth, headerWidth));

      handleResizeColumn(colId, snugWidth);
    },
    [columns, items, handleResizeColumn]
  );

  const handleReorderColumns = (sourceId: string, targetId: string) => {
    const fromIndex = columns.findIndex((c) => c.id === sourceId);
    const toIndex = columns.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const newCols = [...columns];
    const [moved] = newCols.splice(fromIndex, 1);
    newCols.splice(toIndex, 0, moved);
    setColumns(newCols);
    if (typeof window !== "undefined") {
      localStorage.setItem(FBA_DAILY_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    }
  };

  const handleSaveColumns = (newCols: ColumnConfig[]) => {
    setColumns(newCols);
    if (typeof window !== "undefined") {
      localStorage.setItem(FBA_DAILY_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    }
  };

  const handleResetColumns = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(FBA_DAILY_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(FBA_DAILY_FROZEN_STORAGE_KEY);
    }
    setColumns(DEFAULT_FBA_DAILY_COLUMNS);
    setFrozenColumns(["stt", "week", "date"]);
  };

  // Cumulative sticky left offsets for frozen columns
  const getCellFreezeProps = useCallback(
    (colId: string, isHeader = false) => {
      const isFrozen = frozenColumns.includes(colId);
      if (!isFrozen) {
        return {
          isFrozen: false,
          isBoundary: false,
          style: {},
          className: "",
        };
      }

      let leftOffset = 0;
      let isLast = false;
      const frozenVisible = visibleColumns.filter((c) => frozenColumns.includes(c.id));
      for (let i = 0; i < frozenVisible.length; i++) {
        const c = frozenVisible[i];
        if (c.id === colId) {
          isLast = i === frozenVisible.length - 1;
          break;
        }
        leftOffset += typeof c.width === "number" ? c.width : 110;
      }

      return {
        isFrozen: true,
        isBoundary: isLast,
        style: {
          position: "sticky" as const,
          left: `${leftOffset}px`,
          zIndex: isHeader ? 30 : 20,
        },
        className: isLast ? "border-r-2 border-r-amber-400 shadow-sm" : "",
      };
    },
    [frozenColumns, visibleColumns]
  );

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load stores
  useEffect(() => {
    async function loadStores() {
      try {
        setLoadingStores(true);
        const res = await fetch("/api/accounting/stores");
        if (res.ok) {
          const data = await res.json();
          const storeList: Store[] = data.stores || [];
          setStores(storeList);
          if (storeList.length > 0 && !selectedStoreId) {
            setSelectedStoreId(storeList[0].id);
            localStorage.setItem("acc_selected_store_id", storeList[0].id);
          }
        }
      } catch {
        // error
      } finally {
        setLoadingStores(false);
      }
    }
    loadStores();
  }, [selectedStoreId]);

  // Fetch FBA daily data
  const fetchData = useCallback(async () => {
    if (!selectedStoreId) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("store_id", selectedStoreId);
      if (dateRange.startDate) params.set("start_date", dateRange.startDate);
      if (dateRange.endDate) params.set("end_date", dateRange.endDate);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("sort_field", sortField);
      params.set("sort_dir", sortDirection);
      params.set("limit", "1000");

      const res = await fetch(`/api/accounting/financials/fba-daily?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
        setStats(data.stats || null);
      }
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, dateRange, debouncedSearch, sortField, sortDirection]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getExportUrl = () => {
    const params = new URLSearchParams();
    if (selectedStoreId) params.set("store_id", selectedStoreId);
    if (dateRange.startDate) params.set("start_date", dateRange.startDate);
    if (dateRange.endDate) params.set("end_date", dateRange.endDate);
    if (debouncedSearch) params.set("search", debouncedSearch);
    params.set("sort_field", sortField);
    params.set("sort_dir", sortDirection);
    return `/api/accounting/financials/fba-daily/export?${params.toString()}`;
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-800">
      {/* TOOLBAR: Store, Date Range, Search, Actions */}
      <div className="bg-slate-200/70 p-2 rounded-xl border border-slate-300 flex items-center justify-between gap-2 flex-wrap shadow-2xs shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Select */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs">
            <span className="text-[11px] font-bold uppercase text-slate-400">STORE</span>
            <select
              value={selectedStoreId}
              onChange={(e) => {
                setSelectedStoreId(e.target.value);
                localStorage.setItem("acc_selected_store_id", e.target.value);
              }}
              disabled={loadingStores}
              className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.marketplace})
                </option>
              ))}
            </select>
          </div>

          {/* Amazon Date Range Picker */}
          <PpcAmazonDatePicker
            value={dateRange}
            onChange={(next) => setDateRange(next)}
            align="left"
          />

          {/* Search Date or Week */}
          <div className="relative flex items-center">
            <MagnifyingGlassIcon
              size={14}
              className="absolute left-2.5 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              placeholder="Tìm ngày, tuần, tháng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44 rounded-lg border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-hidden shadow-2xs"
            />
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-2xs">
            <button
              type="button"
              onClick={() => handleZoomChange(-5)}
              title="Thu nhỏ"
              className="px-1.5 py-1 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <MinusIcon size={12} weight="bold" />
            </button>
            <span className="px-1.5 text-[11px] font-mono font-bold text-slate-700 select-none">
              {zoomLevel}%
            </span>
            <button
              type="button"
              onClick={() => handleZoomChange(5)}
              title="Phóng to"
              className="px-1.5 py-1 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <PlusIcon size={12} weight="bold" />
            </button>
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            type="button"
            onClick={() => fetchData()}
            disabled={loading}
            title="Tải lại dữ liệu"
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <ArrowClockwiseIcon
              size={14}
              className={loading ? "animate-spin text-amber-600" : "text-slate-600"}
            />
            <span>Làm mới</span>
          </button>

          {/* Column Manager */}
          <button
            type="button"
            onClick={() => setShowColumnModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <SlidersHorizontalIcon size={14} className="text-slate-600" />
            <span>Tùy chỉnh cột</span>
          </button>

          {/* Export Excel */}
          <a
            href={getExportUrl()}
            download
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
          >
            <DownloadSimpleIcon size={14} weight="bold" />
            <span>Xuất Excel</span>
          </a>
        </div>
      </div>

      {/* TABLE CONTAINER */}
      <div className="flex-1 overflow-auto bg-white relative">
        <div
          style={{
            zoom: `${zoomLevel}%`,
          }}
          className="min-w-full inline-block align-top"
        >
          <table className="w-full border-collapse text-left border-b border-slate-200">
            {/* THEAD with Header Row + Sticky TOTAL Row */}
            <thead className="sticky top-0 z-30 select-none">
              {/* ROW 1: COLUMN HEADERS */}
              <tr className="bg-amber-500 text-white text-xs font-bold shadow-xs">
                {visibleColumns.map((col) => {
                  const f = getCellFreezeProps(col.id, true);
                  const isSorted = sortField === col.id;
                  const bgStyle = f.isFrozen ? { backgroundColor: "#f59e0b" } : {};

                  return (
                    <ColumnHeaderCell
                      key={col.id}
                      col={col}
                      isFrozen={f.isFrozen}
                      isBoundary={f.isBoundary}
                      style={{ ...f.style, ...bgStyle }}
                      className="border-r border-amber-600/70 py-2 px-2.5 whitespace-nowrap"
                      draggable={true}
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
                    >
                      <div
                        onClick={() => handleSort(col.id)}
                        className={`flex items-center gap-1 cursor-pointer hover:text-amber-100 transition-colors ${
                          col.align === "center"
                            ? "justify-center"
                            : col.align === "right"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <span className="truncate">{col.label}</span>
                        {isSorted && (
                          <span className="text-white shrink-0">
                            {sortDirection === "asc" ? (
                              <CaretUpIcon size={12} weight="bold" />
                            ) : (
                              <CaretDownIcon size={12} weight="bold" />
                            )}
                          </span>
                        )}
                      </div>
                    </ColumnHeaderCell>
                  );
                })}
              </tr>

              {/* ROW 2: STICKY TOTAL ROW RIGHT BELOW HEADERS */}
              {stats && (
                <tr className="bg-[#fffbeb] text-slate-900 border-b-2 border-amber-500/80 text-xs select-none shadow-2xs">
                  {visibleColumns.map((col) => {
                    const f = getCellFreezeProps(col.id, true);
                    const bgStyle = f.isFrozen ? { backgroundColor: "#fffbeb" } : {};
                    const isProfitCol = col.id === "profit";

                    return (
                      <td
                        key={`total-${col.id}`}
                        style={{ ...f.style, ...bgStyle }}
                        className={`py-1.5 px-2.5 text-xs border-r border-amber-200/80 whitespace-nowrap font-semibold ${
                          col.align === "center"
                            ? "text-center"
                            : col.align === "right"
                            ? "text-right font-mono"
                            : "text-left"
                        } ${f.className}`}
                      >
                        {col.id === "stt" && (
                          <span className="inline-block px-1 py-0.5 rounded bg-amber-200/70 text-amber-950 text-[10px] font-black tracking-wider">
                            TOTAL
                          </span>
                        )}
                        {col.id === "week" && (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                        {col.id === "date" && (
                          <span className="font-bold text-slate-950 text-xs">
                            {stats.totalDays.toLocaleString()} Ngày
                          </span>
                        )}
                        {col.id === "revenue" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalRevenue)}
                          </span>
                        )}
                        {col.id === "quantity" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(stats.totalQuantity)}
                          </span>
                        )}
                        {col.id === "ads_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalAdsFee)}
                          </span>
                        )}
                        {col.id === "basecost" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalBasecost)}
                          </span>
                        )}
                        {col.id === "amazon_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalAmazonFee)}
                          </span>
                        )}
                        {col.id === "thue" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalThue)}
                          </span>
                        )}
                        {col.id === "promotion" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalPromotion)}
                          </span>
                        )}
                        {col.id === "return_cost" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalReturnCost)}
                          </span>
                        )}
                        {/* Profit: bold và màu xanh như yêu cầu */}
                        {isProfitCol && (
                          <span
                            className={`font-bold tabular-nums ${
                              stats.totalProfit > 0
                                ? "text-emerald-600"
                                : stats.totalProfit < 0
                                ? "text-red-600"
                                : "text-slate-950"
                            }`}
                          >
                            {formatCurrency(stats.totalProfit)}
                          </span>
                        )}
                        {col.id === "balance" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalBalance)}
                          </span>
                        )}
                        {col.id === "roi" && (
                          <span className="font-semibold text-slate-800 tabular-nums">
                            {formatPercent(stats.avgRoi)}
                          </span>
                        )}
                        {col.id === "tacos" && (
                          <span className="font-semibold text-slate-800 tabular-nums">
                            {formatPercent(stats.avgTacos)}
                          </span>
                        )}
                        {col.id === "acos" && (
                          <span className="font-semibold text-slate-800 tabular-nums">
                            {formatPercent(stats.avgAcos)}
                          </span>
                        )}
                        {col.id === "margin" && (
                          <span className="font-semibold text-slate-800 tabular-nums">
                            {formatPercent(stats.avgMargin)}
                          </span>
                        )}
                        {col.id === "margin_pre_ads" && (
                          <span className="font-semibold text-slate-800 tabular-nums">
                            {formatPercent(
                              stats.totalRevenue > 0
                                ? (stats.totalRevenue - stats.totalBasecost - stats.totalAmazonFee) / stats.totalRevenue
                                : 0
                            )}
                          </span>
                        )}
                        {col.id === "profit_per_item" && (() => {
                          const ppi = stats.totalQuantity > 0 ? stats.totalProfit / stats.totalQuantity : 0;
                          return (
                            <span
                              className={`font-bold tabular-nums ${
                                ppi > 0
                                  ? "text-emerald-600"
                                  : ppi < 0
                                  ? "text-red-600"
                                  : "text-slate-950"
                              }`}
                            >
                              {formatCurrency(ppi)}
                            </span>
                          );
                        })()}
                        {col.id === "revenue_ads" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalRevenueAds)}
                          </span>
                        )}
                        {col.id === "quantity_ads" && (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                        {col.id === "clicks" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(stats.totalClicks)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </thead>

            {/* TBODY */}
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-12">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                      <span className="text-slate-500 font-medium">Đang tính toán dữ liệu FBA theo ngày…</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-12 text-slate-400">
                    Không tìm thấy dữ liệu FBA cho khoảng thời gian đã chọn.
                  </td>
                </tr>
              ) : (
                items.map((item, index) => {
                  const isEven = index % 2 === 0;
                  const rowBg = isEven ? "bg-white" : "bg-slate-50/60";

                  return (
                    <tr
                      key={item.id}
                      className={`${rowBg} hover:bg-amber-50/40 transition-colors group`}
                    >
                      {visibleColumns.map((col) => {
                        const f = getCellFreezeProps(col.id);
                        const cellBg = f.isFrozen
                          ? { backgroundColor: isEven ? "#ffffff" : "#f8fafc" }
                          : {};

                        return (
                          <td
                            key={col.id}
                            style={{ ...f.style, ...cellBg }}
                            className={`py-1.5 px-2.5 text-xs border-r border-slate-100 whitespace-nowrap ${
                              col.align === "center"
                                ? "text-center"
                                : col.align === "right"
                                ? "text-right font-mono"
                                : "text-left"
                            } ${f.className}`}
                          >
                            {/* STT */}
                            {col.id === "stt" && (
                              <span className="text-slate-400 text-[11px] font-mono">
                                {index + 1}
                              </span>
                            )}

                            {/* Tuần */}
                            {col.id === "week" && (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">
                                {item.week}
                              </span>
                            )}

                            {/* Date */}
                            {col.id === "date" && (
                              <span className="font-bold text-slate-900 font-mono text-[11.5px]">
                                {item.date}
                              </span>
                            )}

                            {/* Revenue */}
                            {col.id === "revenue" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.revenue)}
                              </span>
                            )}

                            {/* Quantity */}
                            {col.id === "quantity" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatInteger(item.quantity)}
                              </span>
                            )}

                            {/* Ads Fee */}
                            {col.id === "ads_fee" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.ads_fee)}
                              </span>
                            )}

                            {/* Base Cost */}
                            {col.id === "basecost" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.basecost)}
                              </span>
                            )}

                            {/* AMZ Fee */}
                            {col.id === "amazon_fee" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.amazon_fee)}
                              </span>
                            )}

                            {/* Thuế */}
                            {col.id === "thue" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.thue)}
                              </span>
                            )}

                            {/* Promotion */}
                            {col.id === "promotion" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.promotion)}
                              </span>
                            )}

                            {/* Refund */}
                            {col.id === "return_cost" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.return_cost)}
                              </span>
                            )}

                            {/* Profit: font-semibold và xanh/đỏ như yêu cầu */}
                            {col.id === "profit" && (
                              <span
                                className={`font-semibold tabular-nums ${
                                  item.profit > 0
                                    ? "text-emerald-600"
                                    : item.profit < 0
                                    ? "text-red-600"
                                    : "text-slate-600"
                                }`}
                              >
                                {formatCurrency(item.profit)}
                              </span>
                            )}

                            {/* Balance */}
                            {col.id === "balance" && (
                              <span className="font-normal text-slate-900 tabular-nums">
                                {formatCurrency(item.balance)}
                              </span>
                            )}

                            {/* ROI */}
                            {col.id === "roi" && (
                              <span className="tabular-nums font-normal text-slate-700">
                                {formatPercent(item.roi)}
                              </span>
                            )}

                            {/* TACOS */}
                            {col.id === "tacos" && (
                              <span
                                className={`tabular-nums ${
                                  item.tacos > 0.2
                                    ? "text-rose-600 font-bold"
                                    : "text-slate-700"
                                }`}
                              >
                                {formatPercent(item.tacos)}
                              </span>
                            )}

                            {/* ACOS */}
                            {col.id === "acos" && (
                              <span
                                className={`tabular-nums ${
                                  item.acos > 0.35
                                    ? "text-rose-600 font-bold"
                                    : "text-slate-700"
                                }`}
                              >
                                {formatPercent(item.acos)}
                              </span>
                            )}

                            {/* % Profit (Margin) */}
                            {col.id === "margin" && (
                              <span
                                className={`tabular-nums ${
                                  item.margin > 0.15
                                    ? "text-emerald-700 font-semibold"
                                    : "text-slate-700"
                                }`}
                              >
                                {formatPercent(item.margin)}
                              </span>
                            )}

                            {/* % Profit trước ADS */}
                            {col.id === "margin_pre_ads" && (
                              <span className="tabular-nums font-normal text-slate-700">
                                {formatPercent(item.margin_pre_ads)}
                              </span>
                            )}

                            {/* Profit / item: font-semibold và xanh/đỏ */}
                            {col.id === "profit_per_item" && (
                              <span
                                className={`font-semibold tabular-nums ${
                                  item.profit_per_item > 0
                                    ? "text-emerald-600"
                                    : item.profit_per_item < 0
                                    ? "text-red-600"
                                    : "text-slate-600"
                                }`}
                              >
                                {formatCurrency(item.profit_per_item)}
                              </span>
                            )}

                            {/* Revenue ads */}
                            {col.id === "revenue_ads" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.revenue_ads)}
                              </span>
                            )}

                            {/* Quantity ads */}
                            {col.id === "quantity_ads" && (
                              <span className="tabular-nums text-slate-700">
                                {formatInteger(item.quantity_ads)}
                              </span>
                            )}

                            {/* Clicks */}
                            {col.id === "clicks" && (
                              <span className="tabular-nums text-slate-700">
                                {formatInteger(item.clicks)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FOOTER BAR */}
      <div className="bg-slate-100 px-3 py-1.5 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>
            Hiển thị <strong>{items.length}</strong> / <strong>{total}</strong> ngày
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span>Dữ liệu tự động tổng hợp từ Orders, Ads, Returns & Basecost</span>
        </div>
      </div>

      {/* COLUMN MANAGER MODAL */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title="FBA - DOANH THU THEO NGÀY"
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />
    </div>
  );
}
