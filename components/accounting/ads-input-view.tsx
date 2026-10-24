"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  ArrowsInLineHorizontalIcon,
  CaretDownIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  FunnelIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { AdsItem, AdsStats } from "@/lib/accounting/ads-db";
import type { Store } from "@/lib/accounting/types";
import {
  type ColumnConfig,
  DEFAULT_ADS_INPUT_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";

export const ADS_COLUMNS_STORAGE_KEY = "acc_ads_input_columns_global";
export const ADS_FROZEN_STORAGE_KEY = "acc_ads_input_frozen_global";

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

function formatCurrency(val: number | null | undefined, currency = "USD"): string {
  if (val == null || isNaN(val)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(val);
}

function formatNumber(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "0";
  return new Intl.NumberFormat("en-US").format(val);
}

export interface AdsInputViewProps {
  stores: Store[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  search?: string;
  setSearch?: (s: string) => void;
  tableZoom?: number;
  showImportModal?: boolean;
  setShowImportModal?: (open: boolean) => void;
  showColumnModal?: boolean;
  setShowColumnModal?: (open: boolean) => void;
  resetColumnsSignal?: number;
  autoFitColumnsSignal?: number;
  reloadSignal?: number;
  onTotalAdsChange?: (total: number) => void;
  notify?: (msg: string, type?: "success" | "error") => void;
  dateSort?: "asc" | "desc";
  setDateSort?: (sort: "asc" | "desc" | ((prev: "asc" | "desc") => "asc" | "desc")) => void;
  startDate?: string;
  setStartDate?: (d: string) => void;
  endDate?: string;
  setEndDate?: (d: string) => void;
  onStatsChange?: (stats: AdsStats) => void;
}

export function AdsInputView({
  stores,
  selectedStoreId,
  onStoreChange,
  search: externalSearch,
  setSearch: setExternalSearch,
  tableZoom = 90,
  showImportModal: externalShowImportModal,
  setShowImportModal: setExternalShowImportModal,
  showColumnModal: externalShowColumnModal,
  setShowColumnModal: setExternalShowColumnModal,
  resetColumnsSignal = 0,
  autoFitColumnsSignal = 0,
  reloadSignal = 0,
  onTotalAdsChange,
  notify: externalNotify,
  dateSort: externalDateSort,
  setDateSort: externalSetDateSort,
  startDate: externalStartDate,
  setStartDate: externalSetStartDate,
  endDate: externalEndDate,
  setEndDate: externalSetEndDate,
  onStatsChange,
}: AdsInputViewProps) {
  // Local state fallbacks if not controlled by parent
  const [internalSearch, setInternalSearch] = useState("");
  const search = externalSearch !== undefined ? externalSearch : internalSearch;
  const setSearch = setExternalSearch || setInternalSearch;

  const [internalShowImportModal, setInternalShowImportModal] = useState(false);
  const showImportModal = externalShowImportModal !== undefined ? externalShowImportModal : internalShowImportModal;
  const setShowImportModal = setExternalShowImportModal || setInternalShowImportModal;

  const [internalShowColumnModal, setInternalShowColumnModal] = useState(false);
  const showColumnModal = externalShowColumnModal !== undefined ? externalShowColumnModal : internalShowColumnModal;
  const setShowColumnModal = setExternalShowColumnModal || setInternalShowColumnModal;

  const [localToast, setLocalToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const notify = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      if (externalNotify) {
        externalNotify(msg, type);
      } else {
        setLocalToast({ message: msg, type });
        setTimeout(() => setLocalToast((prev) => (prev?.message === msg ? null : prev)), 4000);
      }
    },
    [externalNotify]
  );

  // Data & Stats
  const [ads, setAds] = useState<AdsItem[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [stats, setStats] = useState<AdsStats>({
    totalRows: 0,
    totalSpend: 0,
    totalSales: 0,
    totalClicks: 0,
    totalOrders: 0,
    totalImpressions: 0,
    avgCpc: 0,
    avgAcos: 0,
    avgRoas: 0,
    totalThue10: 0,
  });
  const [loading, setLoading] = useState(false);

  // Pagination & Filtering (Luôn mặc định 50 bản ghi khi vào lại để tránh lag)
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("acc_ads_input_limit");
      } catch {}
    }
    return 50;
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [internalDateSort, setInternalDateSort] = useState<"asc" | "desc">("desc");
  const dateSort = externalDateSort !== undefined ? externalDateSort : internalDateSort;
  const setDateSort = externalSetDateSort || setInternalDateSort;

  const [internalStartDate, setInternalStartDate] = useState("");
  const startDate = externalStartDate !== undefined ? externalStartDate : internalStartDate;
  const setStartDate = externalSetStartDate || setInternalStartDate;

  const [internalEndDate, setInternalEndDate] = useState("");
  const endDate = externalEndDate !== undefined ? externalEndDate : internalEndDate;
  const setEndDate = externalSetEndDate || setInternalEndDate;
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Column Drag & Drop Reorder
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  // Column Context Menu & Inline Editing
  const [columnContextMenu, setColumnContextMenu] = useState<{
    field: string;
    x: number;
    y: number;
  } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const [fieldEditor, setFieldEditor] = useState<{
    field_id: string;
    label: string;
    options: string[];
    allow_custom_value?: boolean;
  } | null>(null);
  const [newFieldOption, setNewFieldOption] = useState("");

  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Columns & Freezing Configuration (Stored globally across all stores)
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(ADS_COLUMNS_STORAGE_KEY);
        if (saved) {
          const parsed: ColumnConfig[] = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defaultMap = new Map(DEFAULT_ADS_INPUT_COLUMNS.map((c) => [c.id, c]));
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
            for (const def of DEFAULT_ADS_INPUT_COLUMNS) {
              if (!seen.has(def.id)) merged.push(def);
            }
            return merged;
          }
        }
      } catch (err) {
        console.warn("Failed to load ads columns:", err);
      }
    }
    return DEFAULT_ADS_INPUT_COLUMNS;
  });

  const [frozenThrough, setFrozenThrough] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(ADS_FROZEN_STORAGE_KEY);
      if (saved) return saved;
    }
    return "sku";
  });

  // Đồng bộ cấu hình cột Ads khi chuyển Store
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ADS_COLUMNS_STORAGE_KEY);
      if (saved) {
        const parsed: ColumnConfig[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const defaultMap = new Map(DEFAULT_ADS_INPUT_COLUMNS.map((c) => [c.id, c]));
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
          for (const def of DEFAULT_ADS_INPUT_COLUMNS) {
            if (!seen.has(def.id)) merged.push(def);
          }
          setColumns(merged);
        }
      } else {
        setColumns(DEFAULT_ADS_INPUT_COLUMNS);
      }

      const savedFrozen = localStorage.getItem(ADS_FROZEN_STORAGE_KEY);
      if (savedFrozen) setFrozenThrough(savedFrozen);
    } catch (err) {
      console.warn("Failed to reload ads columns on store change:", err);
    }
  }, [selectedStoreId]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Reset page on date range change
  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  // Fetch Ads Data
  const fetchAds = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("store_id", selectedStoreId);
      params.set("page", String(page));
      params.set("limit", String(limit));
      params.set("dateSort", dateSort);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      for (const [col, val] of Object.entries(columnFilters)) {
        if (val) params.set(`filter_${col}`, val);
      }

      const res = await fetch(`/api/accounting/ads?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải dữ liệu Ads");
      const data = await res.json();

      setAds(data.rows || []);
      setTotalRows(data.total || 0);
      if (data.stats) {
        setStats(data.stats);
        onStatsChange?.(data.stats);
      }
      if (onTotalAdsChange) onTotalAdsChange(data.total || 0);
    } catch (err: any) {
      notify(err.message || "Lỗi nạp danh sách Ads", "error");
    } finally {
      setLoading(false);
    }
  }, [
    selectedStoreId,
    page,
    limit,
    dateSort,
    debouncedSearch,
    startDate,
    endDate,
    columnFilters,
    notify,
    onTotalAdsChange,
    onStatsChange,
  ]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  // Listen to external signals (reset, autofit, reload from parent top toolbar)
  const prevResetSignal = useRef(resetColumnsSignal);
  const prevAutoFitSignal = useRef(autoFitColumnsSignal);
  const prevReloadSignal = useRef(reloadSignal);

  useEffect(() => {
    if (resetColumnsSignal > prevResetSignal.current) {
      prevResetSignal.current = resetColumnsSignal;
      handleResetColumns();
    }
  }, [resetColumnsSignal]);

  useEffect(() => {
    if (autoFitColumnsSignal > prevAutoFitSignal.current) {
      prevAutoFitSignal.current = autoFitColumnsSignal;
      handleAutoFitAllColumns();
    }
  }, [autoFitColumnsSignal]);

  useEffect(() => {
    if (reloadSignal > prevReloadSignal.current) {
      prevReloadSignal.current = reloadSignal;
      handleSyncLatestAndReload();
    }
  }, [reloadSignal]);

  // Sync latest from R2 and reload
  const handleSyncLatestAndReload = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/accounting/files/sync-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "05_CAMPAIGNS" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(data.message || "Đã nạp file Ads mới nhất cho các Store!", "success");
      }
    } catch (e: any) {
      console.warn("Lỗi đồng bộ file Ads:", e);
    } finally {
      fetchAds();
    }
  };

  // Close context menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Save Column configurations
  const handleSaveColumns = useCallback(
    (newCols: ColumnConfig[]) => {
      setColumns(newCols);
      try {
        localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
      } catch {}
      notify("Đã cập nhật cấu hình cột Ads cho toàn bộ các Store!", "success");
    },
    [notify]
  );

  const handleResetColumns = useCallback(() => {
    setColumns(DEFAULT_ADS_INPUT_COLUMNS);
    setFrozenThrough("sku");
    try {
      localStorage.removeItem(ADS_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(ADS_FROZEN_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục các cột Ads về mặc định file Excel!", "success");
  }, [notify]);

  // Reorder columns
  const handleReorderColumns = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      setColumns((prev) => {
        const fromIndex = prev.findIndex((c) => c.id === fromId);
        const toIndex = prev.findIndex((c) => c.id === toId);
        if (fromIndex < 0 || toIndex < 0) return prev;
        const updated = [...prev];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        try {
          localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã đổi vị trí cột!", "success");
    },
    [notify]
  );

  // Resize column
  const handleResizeColumn = useCallback((colId: string, width: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) =>
        c.id === colId ? { ...c, width: Math.max(50, width) } : c
      );
      try {
        localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // Auto-fit calculations
  const calculateAutoFitWidth = useCallback(
    (colId: string, label: string): number => {
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;
      for (const item of ads) {
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
    [ads]
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
          localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã thu nhỏ cột!", "success");
    },
    [calculateAutoFitWidth, notify]
  );

  const handleAutoFitAllColumns = useCallback(() => {
    setColumns((prev) => {
      const updated = prev.map((c) => {
        const snugWidth = calculateAutoFitWidth(c.id, c.label);
        return { ...c, width: snugWidth };
      });
      try {
        localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    notify("Đã thu nhỏ tất cả các cột!", "success");
  }, [calculateAutoFitWidth, notify]);

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

  // Column filter helper
  const setColumnFilter = useCallback((fieldId: string, value: string) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!value || value.trim() === "") {
        delete next[fieldId];
      } else {
        next[fieldId] = value.trim();
      }
      return next;
    });
    setPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setColumnFilters({});
    setStartDate("");
    setEndDate("");
    setSearch("");
    setPage(1);
  }, [setSearch]);

  const getColumnOptions = useCallback(
    (fieldId: string) => {
      const set = new Set<string>();
      ads.forEach((row) => {
        const val = (row as any)[fieldId];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          set.add(String(val).trim());
        }
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 50);
    },
    [ads]
  );

  // Context Menu Actions
  const handleQuickHideColumn = useCallback(
    (colId: string) => {
      setColumns((prev) => {
        const updated = prev.map((c) =>
          c.id === colId ? { ...c, visible: false } : c
        );
        try {
          localStorage.setItem(ADS_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    },
    [notify]
  );

  const handleSetFrozenColumn = useCallback(
    (colId: string) => {
      setFrozenThrough(colId);
      try {
        localStorage.setItem(ADS_FROZEN_STORAGE_KEY, colId);
      } catch {}
      const colLabel = columns.find((c) => c.id === colId)?.label || colId;
      notify(`Đã khóa các cột đến "${colLabel}".`, "success");
    },
    [columns, notify]
  );

  // Inline Cell Save
  const handleSaveCell = async (id: string, field: string, val: string) => {
    if (!selectedStoreId) return;
    try {
      const res = await fetch("/api/accounting/ads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId,
          id,
          field,
          value: val,
        }),
      });
      if (!res.ok) throw new Error("Cập nhật ô thất bại");
      setAds((prev) =>
        prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
      );
      notify(`Đã cập nhật ${field} thành công!`, "success");
    } catch (err: any) {
      notify(err.message || "Lỗi lưu dữ liệu", "error");
    } finally {
      setEditingCell(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / limit));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Cell Content Renderer matching Order Input typography
  const renderCellContent = (item: AdsItem, colId: string, rowIndex: number) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === colId;

    if (isEditing) {
      return (
        <input
          autoFocus
          type="text"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSaveCell(item.id, colId, editingValue);
            } else if (e.key === "Escape") {
              setEditingCell(null);
            }
          }}
          onBlur={() => handleSaveCell(item.id, colId, editingValue)}
          className="w-full rounded border border-indigo-500 bg-indigo-50/50 px-1.5 py-0.5 text-xs font-semibold text-slate-900 outline-hidden"
        />
      );
    }

    switch (colId) {
      case "stt":
        return (
          <span className="font-mono text-xs text-slate-500 font-normal">
            {(page - 1) * limit + rowIndex + 1}
          </span>
        );
      case "date":
        return (
          <span className="font-normal text-[13px] text-slate-900 whitespace-nowrap tabular-nums">
            {item.date || "—"}
          </span>
        );
      case "portfolio":
        return (
          <span
            onDoubleClick={() => {
              setEditingCell({ id: item.id, field: "portfolio" });
              setEditingValue(item.portfolio || "");
            }}
            className="text-[13px] font-medium text-indigo-700 hover:underline cursor-pointer select-all truncate block"
            title={`${item.portfolio} (Nhấp đúp để sửa)`}
          >
            {item.portfolio}
          </span>
        );
      case "sku":
        return (
          <span
            onDoubleClick={() => {
              setEditingCell({ id: item.id, field: "sku" });
              setEditingValue(item.sku || "");
            }}
            className="text-[13px] font-medium text-slate-950 truncate block cursor-pointer select-all"
            title={`${item.sku || "—"} (Nhấp đúp để sửa)`}
          >
            {item.sku || "—"}
          </span>
        );
      case "status": {
        const isEnabled = item.status?.toLowerCase().includes("enabled");
        const isPaused = item.status?.toLowerCase().includes("paused");
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              isEnabled
                ? "bg-amber-100 text-amber-950 border border-amber-300"
                : isPaused
                ? "bg-rose-100 text-rose-950 border border-rose-300"
                : "bg-slate-100 text-slate-900 border border-slate-300"
            }`}
          >
            {item.status ? item.status.replace("PORTFOLIO_STATUS_", "") : "—"}
          </span>
        );
      }
      case "budget_type":
        return (
          <span className="text-[13px] font-normal text-slate-900">
            {item.budget_type || "—"}
          </span>
        );
      case "budget":
        return (
          <span className="text-[13px] font-normal text-slate-900 tabular-nums">
            {item.budget > 0 ? formatCurrency(item.budget) : "No Cap"}
          </span>
        );
      case "impressions":
        return (
          <span className="text-[13px] font-normal text-slate-900 tabular-nums">
            {formatNumber(item.impressions)}
          </span>
        );
      case "clicks":
        return (
          <span className="text-[13px] font-normal text-slate-950 tabular-nums">
            {formatNumber(item.clicks)}
          </span>
        );
      case "ctr":
        return (
          <span className="text-[13px] font-normal text-slate-900 tabular-nums">
            {(item.ctr * 100).toFixed(2)}%
          </span>
        );
      case "spend":
        return (
          <span className="text-[13px] font-normal text-rose-700 tabular-nums">
            {formatCurrency(item.spend)}
          </span>
        );
      case "cpc":
        return (
          <span className="text-[13px] font-normal text-slate-900 tabular-nums">
            {formatCurrency(item.cpc)}
          </span>
        );
      case "orders":
        return (
          <span className="text-[13px] font-normal text-slate-900 tabular-nums">
            {formatNumber(item.orders)}
          </span>
        );
      case "sales":
        return (
          <span className="text-[13px] font-medium text-emerald-700 tabular-nums">
            {formatCurrency(item.sales)}
          </span>
        );
      case "acos":
        return (
          <span className="text-[13px] font-medium text-amber-800 tabular-nums">
            {(item.acos * 100).toFixed(1)}%
          </span>
        );
      case "roas":
        return (
          <span className="text-[13px] font-medium text-emerald-700 tabular-nums">
            {item.roas.toFixed(2)}
          </span>
        );
      case "thue_10":
        return (
          <span className="text-[13px] font-normal text-amber-900 tabular-nums">
            {formatCurrency(item.thue_10)}
          </span>
        );
      case "loai":
        return (
          <span
            onDoubleClick={() => {
              setEditingCell({ id: item.id, field: "loai" });
              setEditingValue(item.loai || "");
            }}
            className="text-[13px] font-normal text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded cursor-pointer"
          >
            {item.loai || "FBA"}
          </span>
        );
      case "mkt_pic":
        return (
          <span
            onDoubleClick={() => {
              setEditingCell({ id: item.id, field: "mkt_pic" });
              setEditingValue(item.mkt_pic || "");
            }}
            className="text-[13px] font-medium text-indigo-700 cursor-pointer"
          >
            {item.mkt_pic || "—"}
          </span>
        );
      case "tuan":
        return <span className="text-[13px] text-slate-700 tabular-nums">{item.tuan || "—"}</span>;
      case "thang":
        return <span className="text-[13px] text-slate-700 tabular-nums">{item.thang || "—"}</span>;
      case "quy":
        return <span className="text-[13px] text-slate-700 tabular-nums">{item.quy || "—"}</span>;
      case "trang_thai":
        return (
          <span
            onDoubleClick={() => {
              setEditingCell({ id: item.id, field: "trang_thai" });
              setEditingValue(item.trang_thai || "");
            }}
            className="text-[13px] text-slate-700 cursor-pointer"
          >
            {item.trang_thai || "—"}
          </span>
        );
      default: {
        const raw = (item as any)[colId];
        return (
          <span className="text-[13px] text-slate-900">
            {raw != null && raw !== "" ? String(raw) : "—"}
          </span>
        );
      }
    }
  };

  return (
    <>
      {/* Toast Notification (local fallback) */}
      {localToast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-semibold shadow-lg transition-all animate-in fade-in slide-in-from-top-4 ${
            localToast.type === "success"
              ? "bg-emerald-600 text-white shadow-emerald-600/20"
              : "bg-rose-600 text-white shadow-rose-600/20"
          }`}
        >
          <span>{localToast.message}</span>
        </div>
      )}

      {/* ACTIVE COLUMN FILTERS BAR (Only shown when filtered) */}
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

              <tbody className="divide-y divide-slate-200">
                {ads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={visibleColumns.length}
                      className="py-16 text-center text-slate-500 font-medium"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="text-sm font-bold text-slate-700">
                          Chưa có dữ liệu Chi Phí Ads cho Store này
                        </span>
                        <p className="text-xs text-slate-400 max-w-md">
                          Bấm nút <strong>&quot;Nhập File Ads&quot;</strong> hoặc{" "}
                          <strong>&quot;Làm mới&quot;</strong> để tự động đọc File 05 Ads tải về từ Amazon.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowImportModal(true)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-xs cursor-pointer"
                        >
                          <UploadSimpleIcon size={16} weight="bold" />
                          <span>Nhập File Ads Ngay</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  ads.map((item, rowIndex) => (
                    <tr
                      key={item.id}
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

                        const cellVal = (item as any)[col.id];
                        return (
                          <td
                            key={col.id}
                            style={f.style}
                            className={`py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200 ${alignClass} ${f.className} overflow-hidden text-ellipsis whitespace-nowrap`}
                          >
                            <div className="truncate w-full min-w-0" title={typeof cellVal === "string" ? cellVal : undefined}>
                              {renderCellContent(item, col.id, rowIndex)}
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

        {/* PAGINATION BAR */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>Hiển thị</span>
            <select
              value={limit}
              onChange={(e) => {
                const newLimit = Number(e.target.value);
                setLimit(newLimit);
                setPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 shadow-2xs outline-hidden focus:border-indigo-500 cursor-pointer"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
            <span>dòng / trang</span>
            <span className="text-slate-400 select-none">•</span>
            <span>Tổng {totalRows.toLocaleString()} dòng</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Đầu
            </button>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Trước
            </button>
            <span className="px-2 font-bold text-slate-800">
              Trang {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Sau
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
              className="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Cuối
            </button>
          </div>
        </div>
      </div>

      {/* CONTEXT MENU CHO TIÊU ĐỀ CỘT */}
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
              {/* Setting cột */}
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

              {/* Thu nhỏ cột này */}
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

            {/* Lọc cột này */}
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
                  <option value="">Tất cả</option>
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

      {/* COLUMN MANAGER MODAL */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title="BÁO CÁO CHI PHÍ ADS"
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />

      {/* ADS IMPORT MODAL */}
      {showImportModal && (
        <AdsImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          storeId={selectedStoreId}
          storeName={stores.find((s) => s.id === selectedStoreId)?.name || "Store"}
          onSuccess={() => {
            fetchAds();
            setShowImportModal(false);
          }}
          notify={notify}
        />
      )}
    </>
  );
}

/**
 * Modal nạp file Ads chuẩn cho Tab Ads (File 05, Amazon Portfolios, hoặc ketoan_limima sheet ADS)
 */
function AdsImportModal({
  isOpen,
  onClose,
  storeId,
  storeName,
  onSuccess,
  notify,
}: {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  storeName: string;
  onSuccess: () => void;
  notify: (msg: string, type?: "success" | "error") => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !storeId) return;
    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("store_id", storeId);

      const res = await fetch("/api/accounting/ads/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Tải lên thất bại");

      notify(
        data.message || `Đã nạp thành công ${data.processed || 0} dòng chi phí Ads!`,
        "success"
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess();
    } catch (err: any) {
      notify(err.message, "error");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
              <UploadSimpleIcon size={20} weight="bold" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Nhập File Báo Cáo Chi Phí Ads
              </h2>
              <p className="text-xs text-slate-500">
                Store: <span className="font-bold text-slate-800">{storeName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition cursor-pointer ${
            dragActive
              ? "border-indigo-500 bg-indigo-50/50"
              : file
              ? "border-emerald-500 bg-emerald-50/30"
              : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          <UploadSimpleIcon
            size={36}
            weight="duotone"
            className={file ? "text-emerald-600" : "text-slate-400"}
          />
          <p className="mt-2 text-xs font-bold text-slate-800">
            {file ? file.name : "Kéo thả file Ads hoặc bấm để chọn"}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Hỗ trợ File 05 tải từ Amazon (.csv, .tsv) hoặc file Excel (.xlsx sheet ADS)
          </p>
          {file && (
            <span className="mt-2 inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
              {(file.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50 cursor-pointer shadow-xs"
          >
            <UploadSimpleIcon size={14} weight="bold" />
            <span>{isUploading ? "Đang xử lý nạp file..." : "Xác nhận Nhập File"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
