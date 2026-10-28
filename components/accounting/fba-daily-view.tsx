"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StorefrontIcon,
} from "@phosphor-icons/react";
import type { FbaDailyItem, FbaDailyStats } from "@/lib/accounting/fba-daily-db";
import type { FbmDailyItem, FbmDailyStats } from "@/lib/accounting/fbm-financials-db";
import { storeHasTeam } from "@/lib/accounting/store-teams";
import type { Store } from "@/lib/accounting/types";
import {
  type ColumnConfig,
  DEFAULT_FBA_DAILY_COLUMNS,
  DEFAULT_FBM_DAILY_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";
import {
  getAmazonLatestAvailableDate,
  getSavedStoreDateRange,
  saveStoreDateRange,
} from "./financials-date-utils";

const FBA_DAILY_COLUMNS_STORAGE_KEY = "acc_fba_daily_columns_global";
const FBA_DAILY_FROZEN_STORAGE_KEY = "acc_fba_daily_frozen_global";

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

type DailyItem = FbaDailyItem & Partial<Pick<FbmDailyItem, "organic_sales" | "aov" | "basecost_per_item" | "ads_per_item">>;
type DailyStats = FbaDailyStats & Partial<Pick<FbmDailyStats, "totalQuantityAds" | "avgMarginPreAds">>;

/** channel="fbm": tab FBM theo ngày (sheet "FBM"), chỉ hiện các store có team FBM. */
export function FbaDailyView({ channel = "fba" }: { channel?: "fba" | "fbm" } = {}) {
  const fbm = channel === "fbm";
  const channelLabel = fbm ? "FBM" : "FBA";
  const rangeKey = fbm ? "fbm_daily" : "fba_daily";
  const columnsStorageKey = fbm ? "acc_fbm_daily_columns_global" : FBA_DAILY_COLUMNS_STORAGE_KEY;
  const frozenStorageKey = fbm ? "acc_fbm_daily_frozen_global" : FBA_DAILY_FROZEN_STORAGE_KEY;
  const defaultColumns = fbm ? DEFAULT_FBM_DAILY_COLUMNS : DEFAULT_FBA_DAILY_COLUMNS;
  const financialMaxDate = useMemo(() => getAmazonLatestAvailableDate(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "";
    }
    return "";
  });
  const [loadingStores, setLoadingStores] = useState(true);

  // Date Range state: defaults to 'This Month' or per-account saved range
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const initStoreId = typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") || "" : "";
    return getSavedStoreDateRange(rangeKey, initStoreId, financialMaxDate);
  });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [sortField, setSortField] = useState<string>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [items, setItems] = useState<DailyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(false);
  // FBM: SKU có đơn nhưng thiếu trong Bảng mã FBM
  const [missingSkus, setMissingSkus] = useState<string[]>([]);

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
      const saved = localStorage.getItem(columnsStorageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defaultMap = new Map(defaultColumns.map((c) => [c.id, c]));
            const restored = parsed.map((col: ColumnConfig) => {
              const def = defaultMap.get(col.id);
              return {
                ...col,
                label: col.label?.replace(/\s*\(\$\)\s*/g, "").trim() || def?.label || col.id,
                defaultLabel: def?.defaultLabel || col.defaultLabel || col.label,
                align: col.align || def?.align,
                width: col.width || def?.width,
              };
            });
            const restoredIds = new Set(restored.map((col: ColumnConfig) => col.id));
            return [
              ...restored,
              ...defaultColumns.filter((col) => !restoredIds.has(col.id)),
            ];
          }
        } catch {
          // fallback
        }
      }
    }
    return defaultColumns;
  });

  const [frozenColumns, setFrozenColumns] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(frozenStorageKey);
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
  const [columnContextMenu, setColumnContextMenu] = useState<{
    field: string;
    x: number;
    y: number;
  } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const visibleColumns = useMemo(
    () => columns.filter((col) => col.visible !== false),
    [columns]
  );

  const handleResizeColumn = useCallback((colId: string, width: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) => (c.id === colId ? { ...c, width: Math.max(50, width) } : c));
      if (typeof window !== "undefined") {
        localStorage.setItem(columnsStorageKey, JSON.stringify(updated));
      }
      return updated;
    });
  }, [columnsStorageKey]);

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
              : val.toFixed(2);
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
      localStorage.setItem(columnsStorageKey, JSON.stringify(newCols));
    }
  };

  const handleSaveColumns = (newCols: ColumnConfig[]) => {
    setColumns(newCols);
    if (typeof window !== "undefined") {
      localStorage.setItem(columnsStorageKey, JSON.stringify(newCols));
    }
  };

  const handleResetColumns = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(columnsStorageKey);
      localStorage.removeItem(frozenStorageKey);
    }
    setColumns(defaultColumns);
    setFrozenColumns(["stt", "week", "date"]);
  };

  const handleSetFrozenThrough = useCallback(
    (colId: string) => {
      const targetIndex = visibleColumns.findIndex((col) => col.id === colId);
      if (targetIndex === -1) return;

      const nextFrozenColumns = visibleColumns.slice(0, targetIndex + 1).map((col) => col.id);
      setFrozenColumns(nextFrozenColumns);
      if (typeof window !== "undefined") {
        localStorage.setItem(frozenStorageKey, JSON.stringify(nextFrozenColumns));
      }
    },
    [visibleColumns, frozenStorageKey]
  );

  const handleResetFrozenColumns = useCallback(() => {
    const defaultFrozenColumns = ["stt", "week", "date"];
    setFrozenColumns(defaultFrozenColumns);
    if (typeof window !== "undefined") {
      localStorage.setItem(frozenStorageKey, JSON.stringify(defaultFrozenColumns));
    }
  }, [frozenStorageKey]);

  const handleQuickHideColumn = useCallback(
    (colId: string) => {
      handleSaveColumns(columns.map((col) => (col.id === colId ? { ...col, visible: false } : col)));
      setFrozenColumns((current) => {
        if (!current.includes(colId)) return current;
        const next = current.filter((id) => id !== colId);
        if (typeof window !== "undefined") {
          localStorage.setItem(frozenStorageKey, JSON.stringify(next));
        }
        return next;
      });
    },
    [columns, frozenStorageKey]
  );

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setColumnContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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
        className: isLast
          ? (isHeader
              ? "border-r-2 border-r-amber-700/80 shadow-sm"
              : "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]")
          : "",
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

  // Load stores (only once on mount)
  useEffect(() => {
    let ignore = false;
    async function loadStores() {
      try {
        setLoadingStores(true);
        const res = await fetch("/api/accounting/stores");
        if (res.ok) {
          const data = await res.json();
          if (ignore) return;
          const allStores: Store[] = data.stores || [];
          const storeList = fbm ? allStores.filter((s) => storeHasTeam(s.team, "FBM")) : allStores;
          setStores(storeList);
          
          if (storeList.length > 0) {
            const savedId = typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") || "" : "";
            const matchedStore = storeList.find((s) => s.id === savedId);
            const limimaStore = storeList.find((s) => s.name.toUpperCase().includes("LIMIMA"));
            const targetStore = matchedStore || limimaStore || storeList[0];
            
            setSelectedStoreId(targetStore.id);
            if (typeof window !== "undefined") {
              localStorage.setItem("acc_selected_store_id", targetStore.id);
              // Báo cho thanh tab Financials biết store thực tế (để ẩn/hiện tab FBM)
              if (targetStore.id !== savedId) {
                window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: targetStore.id }));
              }
            }
            setDateRange(getSavedStoreDateRange(rangeKey, targetStore.id, financialMaxDate));
          }
        }
      } catch (err) {
        console.error("Failed to load stores:", err);
      } finally {
        setLoadingStores(false);
      }
    }
    loadStores();
    return () => {
      ignore = true;
    };
  }, [fbm, rangeKey]);

  const handleStoreSelect = (newStoreId: string) => {
    if (!newStoreId) return;
    setSelectedStoreId(newStoreId);
    if (typeof window !== "undefined") {
      localStorage.setItem("acc_selected_store_id", newStoreId);
      window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: newStoreId }));
    }
    setDateRange(getSavedStoreDateRange(rangeKey, newStoreId, financialMaxDate));
  };

  // Sync store change from other tabs
  useEffect(() => {
    const handleSyncStore = (e: any) => {
      const newStoreId = e.detail || (typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") : null);
      if (newStoreId && newStoreId !== selectedStoreId && stores.some((s) => s.id === newStoreId)) {
        setSelectedStoreId(newStoreId);
        setDateRange(getSavedStoreDateRange(rangeKey, newStoreId, financialMaxDate));
      }
    };
    window.addEventListener("acc_store_changed", handleSyncStore);
    window.addEventListener("storage", handleSyncStore);
    return () => {
      window.removeEventListener("acc_store_changed", handleSyncStore);
      window.removeEventListener("storage", handleSyncStore);
    };
  }, [selectedStoreId, stores, rangeKey]);

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

      if (fbm) params.set("channel", "fbm");
      const res = await fetch(`/api/accounting/financials/fba-daily?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
        setStats(data.stats || null);
        setMissingSkus(data.missingSkus || []);
      }
    } catch {
      // error
    } finally {
      setLoading(false);
    }
  }, [fbm, selectedStoreId, dateRange, debouncedSearch, sortField, sortDirection]);

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
    if (fbm) params.set("channel", "fbm");
    return `/api/accounting/financials/fba-daily/export?${params.toString()}`;
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-800">
      {/* TOOLBAR: Store, Date Range, Search, Actions */}
      <div className="bg-slate-200/70 p-2 rounded-xl border border-slate-300 flex items-center justify-between gap-2 flex-wrap shadow-2xs shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Switcher */}
          <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs hover:border-slate-400 transition-colors">
            <StorefrontIcon size={15} weight="bold" className="text-amber-600 mr-1.5 shrink-0" />
            <select
              id={`${channel}-store-select`}
              value={selectedStoreId}
              onChange={(e) => handleStoreSelect(e.target.value)}
              disabled={loadingStores || stores.length === 0}
              className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer pr-5 appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: "right 0 center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "1.25em 1.25em",
              }}
            >
              {loadingStores ? (
                <option value="">Đang tải store...</option>
              ) : stores.length === 0 ? (
                <option value="">Không có store</option>
              ) : (
                stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Amazon Date Range Picker */}
          <PpcAmazonDatePicker
            value={dateRange}
            onChange={(next) => {
              setDateRange(next);
              if (selectedStoreId) {
                saveStoreDateRange(rangeKey, selectedStoreId, next);
              }
            }}
            maxDate={financialMaxDate}
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

      {fbm && missingSkus.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shrink-0">
          <span className="font-bold">
            {missingSkus.length >= 200 ? "200+" : missingSkus.length} SKU có đơn FBM nhưng chưa có trong Bảng mã FBM
          </span>{" "}
          — thiếu % Referal / Total nên AMZ Fee (và Basecost khi đơn chưa có PW) của các SKU này đang tính = 0. Bổ sung ở
          Inventory → Bảng mã FBM:{" "}
          <span className="font-mono">{missingSkus.slice(0, 12).join(", ")}{missingSkus.length > 12 ? ", …" : ""}</span>
        </div>
      )}

      {/* TABLE CONTAINER */}
      <div className="flex-1 overflow-auto bg-white relative">
        <div
          style={{
            zoom: `${zoomLevel}%`,
          }}
          className="min-w-full inline-block align-top"
        >
          <table className="w-full border-separate border-spacing-0 text-left border-b border-slate-200">
            {/* THEAD with Header Row + Sticky TOTAL Row */}
            <thead className="sticky top-0 z-30 select-none bg-[#ff9900] text-slate-950">
              {/* ROW 1: COLUMN HEADERS */}
              <tr className="text-xs font-bold shadow-xs">
                {visibleColumns.map((col) => {
                  const f = getCellFreezeProps(col.id, true);
                  const isSorted = sortField === col.id;
                  const bgStyle = f.isFrozen ? { backgroundColor: "#ff9900" } : {};

                  return (
                    <ColumnHeaderCell
                      key={col.id}
                      col={col}
                      isFrozen={f.isFrozen}
                      isBoundary={f.isBoundary}
                      style={{ ...f.style, ...bgStyle }}
                      className="py-2 px-2.5 whitespace-nowrap bg-[#ff9900] text-slate-950"
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
                        className={`group/title flex min-h-[30px] w-full items-center gap-1 ${
                          col.align === "center"
                            ? "justify-center"
                            : col.align === "right"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.id)}
                          className="inline-flex min-w-0 cursor-pointer items-center gap-1 truncate transition-colors hover:text-amber-100"
                          title={`Bấm để sắp xếp theo ${col.label}`}
                        >
                          <span className="truncate">{col.label}</span>
                          {isSorted && (
                            <span className="shrink-0 text-white">
                            {sortDirection === "asc" ? (
                              <CaretUpIcon size={12} weight="bold" />
                            ) : (
                              <CaretDownIcon size={12} weight="bold" />
                            )}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setColumnContextMenu({
                              field: col.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          className="ml-0.5 shrink-0 cursor-pointer rounded p-0.5 text-slate-900 opacity-0 transition hover:bg-amber-600/40 group-hover/title:opacity-100 focus-visible:opacity-100"
                          title={`Tùy chọn & Setting cột "${col.label}"`}
                          aria-label={`Tùy chọn cột ${col.label}`}
                        >
                          <SlidersHorizontalIcon size={11} weight="bold" />
                        </button>
                      </div>
                    </ColumnHeaderCell>
                  );
                })}
              </tr>

              {/* ROW 2: STICKY TOTAL ROW RIGHT BELOW HEADERS */}
              {stats && (
                <tr className="bg-[#fffbeb] text-slate-900 border-b border-amber-300 text-xs select-none shadow-2xs">
                  {visibleColumns.map((col) => {
                    const f = getCellFreezeProps(col.id, true);
                    const bgStyle = f.isFrozen ? { backgroundColor: "#fffbeb" } : {};
                    const isProfitCol = col.id === "profit";

                    return (
                      <td
                        key={`total-${col.id}`}
                        style={{ ...f.style, ...bgStyle }}
                        className={`py-1.5 px-2.5 text-xs border-b border-amber-300 whitespace-nowrap font-semibold ${
                          f.isBoundary
                            ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                            : "border-r border-amber-200/80"
                        } ${
                          col.align === "center"
                            ? "text-center"
                            : col.align === "right"
                            ? "text-right font-mono"
                            : "text-left"
                        }`}
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
                        {col.id === "net_profit" && (
                          <span className={`font-bold tabular-nums ${stats.totalNetProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatCurrency(stats.totalNetProfit)}
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
                              stats.avgMarginPreAds ??
                                (stats.totalRevenue > 0
                                  ? (stats.totalRevenue - stats.totalBasecost - stats.totalAmazonFee) / stats.totalRevenue
                                  : 0)
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
                        {col.id === "organic_sales" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(stats.totalQuantity - (stats.totalQuantityAds ?? 0))}
                          </span>
                        )}
                        {col.id === "aov" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalQuantity > 0 ? stats.totalRevenue / stats.totalQuantity : 0)}
                          </span>
                        )}
                        {col.id === "basecost_per_item" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalQuantity > 0 ? stats.totalBasecost / stats.totalQuantity : 0)}
                          </span>
                        )}
                        {col.id === "ads_per_item" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(stats.totalQuantity > 0 ? stats.totalAdsFee / stats.totalQuantity : 0)}
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
                      <span className="text-slate-500 font-medium">Đang tính toán dữ liệu {channelLabel} theo ngày…</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-12 text-slate-400">
                    Không tìm thấy dữ liệu {channelLabel} cho khoảng thời gian đã chọn.
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
                            className={`py-1.5 px-2.5 text-xs border-b border-slate-200 whitespace-nowrap ${
                              f.isBoundary
                                ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                                : "border-r border-slate-200"
                            } ${
                              col.align === "center"
                                ? "text-center"
                                : col.align === "right"
                                ? "text-right font-mono"
                                : "text-left"
                            }`}
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
                                {item.week?.startsWith("Tuần ") ? item.week.replace(/^Tuần\s*/i, "T") : item.week}
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

                            {col.id === "net_profit" && (
                              <span className={`font-semibold tabular-nums ${item.net_profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {formatCurrency(item.net_profit)}
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

                            {/* FBM: Organic sale, AOV, Basecost/item, Ads/Item */}
                            {col.id === "organic_sales" && (
                              <span className="tabular-nums text-slate-700">
                                {item.organic_sales == null ? "—" : formatInteger(item.organic_sales)}
                              </span>
                            )}
                            {(col.id === "aov" || col.id === "basecost_per_item" || col.id === "ads_per_item") && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item[col.id])}
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

      {/* COLUMN CONTEXT MENU */}
      {columnContextMenu && (() => {
        const field = columnContextMenu.field;
        const col = columns.find((item) => item.id === field);
        const colLabel = col?.label || field;
        const visibleIndex = visibleColumns.findIndex((item) => item.id === field);
        const isCurrentBoundary =
          visibleIndex >= 0 &&
          frozenColumns.includes(field) &&
          !visibleColumns.slice(visibleIndex + 1).some((item) => frozenColumns.includes(item.id));

        return (
          <div
            ref={columnMenuRef}
            className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.max(8, Math.min(columnContextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 232)),
              top: Math.max(8, Math.min(columnContextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 210)),
            }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tùy chọn cột</span>
              <span className="max-w-[120px] truncate text-xs font-bold text-slate-900">{colLabel}</span>
            </div>

            <div className="space-y-0.5 p-1">
              <button
                type="button"
                onClick={() => {
                  handleAutoFitColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                <SlidersHorizontalIcon size={14} className="shrink-0 text-amber-600" />
                <span>Thu nhỏ cột</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowColumnModal(true);
                  setColumnContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                <PencilSimpleIcon size={14} className="shrink-0 text-slate-500" />
                <span>Setting cột</span>
              </button>

              {!isCurrentBoundary ? (
                <button
                  type="button"
                  onClick={() => {
                    handleSetFrozenThrough(field);
                    setColumnContextMenu(null);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-left text-xs font-bold text-amber-950 transition hover:bg-amber-100"
                >
                  <LockIcon size={14} weight="bold" className="shrink-0 text-amber-600" />
                  <span>Khóa đến cột này</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    handleResetFrozenColumns();
                    setColumnContextMenu(null);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  <LockOpenIcon size={14} weight="bold" className="shrink-0 text-amber-600" />
                  <span>Về khóa mặc định (Date)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleQuickHideColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <EyeSlashIcon size={14} className="shrink-0 text-rose-500" />
                <span>Ẩn cột này</span>
              </button>
            </div>
          </div>
        );
      })()}

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
        title={`${channelLabel} - DOANH THU THEO NGÀY`}
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />
    </div>
  );
}
