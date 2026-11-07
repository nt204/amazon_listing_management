"use client";

import { profitColClass } from "./profit-column";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  CopyIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FileTextIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StorefrontIcon,
  WarningCircleIcon,
  CalculatorIcon,
} from "@phosphor-icons/react";
import type { SkuMonthlyItem, SkuMonthlyStoreSummary, AvailableMonthOption } from "@/lib/accounting/sku-monthly-db";
import {
  type ColumnConfig,
  DEFAULT_SKU_MONTHLY_COLUMNS,
  DEFAULT_SKU_MONTHLY_FBM_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";
import { PaginationBar } from "./pagination-bar";
import {
  AccountingTableSkeletonRows,
  AccountingTopProgressBar,
} from "./accounting-skeleton";

// Mỗi kênh lưu cấu hình cột riêng (tab SKU FBM-monthly có bộ cột khác SKU Monthly FBA)
const CHANNEL_CONFIG = {
  fba: {
    columnsKey: "acc_sku_monthly_columns_v4",
    frozenKey: "acc_sku_monthly_frozen_v4",
    defaultColumns: DEFAULT_SKU_MONTHLY_COLUMNS,
    api: "/api/accounting/financials/sku-monthly",
    title: "BÁO CÁO THÁNG SKU (SKU-MONTHLY)",
    sheet: "SKU-monthly",
  },
  fbm: {
    columnsKey: "acc_sku_monthly_fbm_columns_v1",
    frozenKey: "acc_sku_monthly_fbm_frozen_v1",
    defaultColumns: DEFAULT_SKU_MONTHLY_FBM_COLUMNS,
    api: "/api/accounting/financials/sku-monthly-fbm",
    title: "BÁO CÁO THÁNG SKU FBM (SKU FBM-MONTHLY)",
    sheet: "SKU FBM-monthly",
  },
} as const;
const PAGE_SIZE_STORAGE_KEY = "acc_sku_monthly_page_size";

// Cột hiển thị khác tên trường dữ liệu
const SORT_FIELD_ALIAS: Record<string, string> = { amazon_fee: "amazon_fee_total" };
// So chuỗi kiểu tự nhiên: SKU2 < SKU10, không phân biệt hoa thường / dấu
const COLLATOR = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

/**
 * Tìm kiếm trên SKU, ASIN, Product Type, Trạng thái, FNSKU (không phân biệt hoa thường / dấu):
 *  - nhiều từ cách nhau bằng khoảng trắng: dòng phải chứa đủ các từ ("glass ornament off")
 *  - dán danh sách cách nhau bằng dấu phẩy / xuống dòng: dòng khớp một trong các mục (dán nhiều SKU một lúc)
 */
function buildSearchMatcher(query: string): ((item: SkuMonthlyItem) => boolean) | null {
  const groups = normalizeText(query)
    .split(/[,;\n]+/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);
  if (!groups.length) return null;
  return (item) => {
    const haystack = normalizeText(
      [item.sku, item.asin, item.product_type, item.status, item.fnsku].filter(Boolean).join(" "),
    );
    return groups.some((words) => words.every((word) => haystack.includes(word)));
  };
}
const SKU_MONTHLY_ZOOM_STORAGE_KEY = "acc_sku_monthly_zoom";

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

interface SkuMonthlyViewProps {
  storeId?: string;
  /** fbm: tab "SKU FBM-monthly" (cột A-to-z / Chargeback / Phí chủ store thay cho các phí FBA) */
  channel?: "fba" | "fbm";
}

export function SkuMonthlyView({ storeId: propStoreId, channel = "fba" }: SkuMonthlyViewProps) {
  const config = CHANNEL_CONFIG[channel];
  const SKU_MONTHLY_COLUMNS_STORAGE_KEY = config.columnsKey;
  const SKU_MONTHLY_FROZEN_STORAGE_KEY = config.frozenKey;
  const defaultColumns: ColumnConfig[] = config.defaultColumns;
  const isFbm = channel === "fbm";
  // Store management sync
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (propStoreId) return propStoreId;
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "4acb9a51-eb3e-4096-b510-4d3e98100283";
    }
    return "4acb9a51-eb3e-4096-b510-4d3e98100283";
  });

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number | "all">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("acc_selected_month");
      if (saved === "all") return "all";
      if (saved && !isNaN(Number(saved))) return Number(saved);
    }
    return 10; // Default to latest complete month (Tháng 10)
  });
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("acc_selected_year");
      if (saved && !isNaN(Number(saved))) return Number(saved);
    }
    return 2026;
  });
  const [availableMonths, setAvailableMonths] = useState<AvailableMonthOption[]>([]);

  // Search & Sorting
  const [search, setSearch] = useState("");
  // Lọc / sắp xếp chạy trên trình duyệt (đã có đủ SKU của kỳ): gõ / bấm cột không phải tải lại từ server
  const deferredSearch = useDeferredValue(search);
  const [sortField, setSortField] = useState<string>("revenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Data & UI states
  const [items, setItems] = useState<SkuMonthlyItem[]>([]);
  // Phân trang phía client (API trả đủ SKU để dòng tổng / sắp xếp đúng trên toàn bộ): store FBM có hàng nghìn SKU
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
      if ([25, 50, 100, 200].includes(saved)) return saved;
    }
    return 50;
  });
  const [summary, setSummary] = useState<SkuMonthlyStoreSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const [selectedSkuDetail, setSelectedSkuDetail] = useState<SkuMonthlyItem | null>(null);

  // Recalculate raw data state
  const [recalculating, setRecalculating] = useState<boolean>(false);
  const [showRecalcModal, setShowRecalcModal] = useState<boolean>(false);
  const [recalcFeedback, setRecalcFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Table zoom
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(SKU_MONTHLY_ZOOM_STORAGE_KEY);
      return saved ? Number(saved) : 90;
    }
    return 90;
  });

  const handleZoomChange = (delta: number) => {
    setZoomLevel((prev) => {
      const next = Math.min(120, Math.max(70, prev + delta));
      localStorage.setItem(SKU_MONTHLY_ZOOM_STORAGE_KEY, String(next));
      return next;
    });
  };

  // Columns & Freezing
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(SKU_MONTHLY_COLUMNS_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const defaultMap = new Map(defaultColumns.map((c) => [c.id, c]));
            const restored = parsed
              .filter((col: ColumnConfig) => col.id !== "actions")
              .map((col: ColumnConfig) => {
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
      const saved = localStorage.getItem(SKU_MONTHLY_FROZEN_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // fallback
        }
      }
    }
    return ["stt", "sku"];
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

  const handleSaveColumns = (newCols: ColumnConfig[]) => {
    setColumns(newCols);
    if (typeof window !== "undefined") {
      localStorage.setItem(SKU_MONTHLY_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    }
  };

  const handleResetColumns = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(SKU_MONTHLY_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(SKU_MONTHLY_FROZEN_STORAGE_KEY);
    }
    setColumns(defaultColumns);
    setFrozenColumns(["stt", "sku"]);
  };

  const handleSetFrozenThrough = useCallback(
    (colId: string) => {
      const targetIndex = visibleColumns.findIndex((col) => col.id === colId);
      if (targetIndex === -1) return;

      const nextFrozenColumns = visibleColumns.slice(0, targetIndex + 1).map((col) => col.id);
      setFrozenColumns(nextFrozenColumns);
      if (typeof window !== "undefined") {
        localStorage.setItem(SKU_MONTHLY_FROZEN_STORAGE_KEY, JSON.stringify(nextFrozenColumns));
      }
    },
    [visibleColumns, SKU_MONTHLY_FROZEN_STORAGE_KEY]
  );

  const handleResetFrozenColumns = useCallback(() => {
    const defaultFrozenColumns = ["stt", "sku"];
    setFrozenColumns(defaultFrozenColumns);
    if (typeof window !== "undefined") {
      localStorage.setItem(SKU_MONTHLY_FROZEN_STORAGE_KEY, JSON.stringify(defaultFrozenColumns));
    }
  }, [SKU_MONTHLY_FROZEN_STORAGE_KEY]);

  const handleQuickHideColumn = useCallback(
    (colId: string) => {
      handleSaveColumns(columns.map((col) => (col.id === colId ? { ...col, visible: false } : col)));
      setFrozenColumns((current) => {
        if (!current.includes(colId)) return current;
        const next = current.filter((id) => id !== colId);
        if (typeof window !== "undefined") {
          localStorage.setItem(SKU_MONTHLY_FROZEN_STORAGE_KEY, JSON.stringify(next));
        }
        return next;
      });
    },
    [columns]
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

  // Khóa liền mạch từ cột đầu tới cột khóa cuối cùng (mặc định tới SKU): cột nằm giữa 2 cột khóa cũng phải khóa,
  // không thì Product Type / Mockup cuộn trôi xuống dưới STT + SKU
  const lockedColumns = useMemo(() => {
    let last = -1;
    visibleColumns.forEach((col, i) => {
      if (frozenColumns.includes(col.id)) last = i;
    });
    return visibleColumns.slice(0, last + 1).map((col) => col.id);
  }, [frozenColumns, visibleColumns]);

  // Cumulative sticky left offsets for frozen columns
  const getCellFreezeProps = useCallback(
    (colId: string, isHeader = false) => {
      const isFrozen = lockedColumns.includes(colId);
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
      const frozenVisible = visibleColumns.filter((c) => lockedColumns.includes(c.id));
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
          ? isHeader
            ? "border-r-2 border-r-amber-700/80 shadow-xs"
            : "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
          : "",
      };
    },
    [lockedColumns, visibleColumns]
  );

  // Resize Column
  const handleResizeColumn = useCallback((colId: string, width: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) => (c.id === colId ? { ...c, width: Math.max(50, width) } : c));
      if (typeof window !== "undefined") {
        localStorage.setItem(SKU_MONTHLY_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, [SKU_MONTHLY_COLUMNS_STORAGE_KEY]);

  // Auto-fit Column
  const handleAutoFitColumn = useCallback(
    (colId: string) => {
      const targetCol = columns.find((c) => c.id === colId);
      if (!targetCol) return;
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;

      for (const item of items) {
        let str = "";
        const val = (item as any)[colId];
        if (val != null) {
          if (typeof val === "number") {
            str = colId.includes("pct") || colId === "margin" || colId === "roi" || colId === "tacos" || colId === "acos"
              ? `${(val * 100).toFixed(1)}%`
              : formatCurrency(val);
          } else {
            str = String(val).trim();
          }
          const w = measureText(str);
          maxContentWidth = Math.max(maxContentWidth, w);
        }
      }

      const contentWidth = maxContentWidth > 0 ? Math.ceil(maxContentWidth + 28) : 0;
      const labelWords = targetCol.label.split(/[-_ ]+/).filter(Boolean);
      const longestWordLength = labelWords.length > 0 ? Math.max(...labelWords.map((w) => w.length)) : 5;
      const headerWidth = Math.round(longestWordLength * 8.5 + 30);
      const snugWidth = Math.max(54, Math.max(contentWidth, headerWidth));

      handleResizeColumn(colId, snugWidth);
    },
    [columns, items, handleResizeColumn]
  );

  // Reorder Columns
  const handleReorderColumns = (sourceId: string, targetId: string) => {
    const fromIndex = columns.findIndex((c) => c.id === sourceId);
    const toIndex = columns.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const newCols = [...columns];
    const [moved] = newCols.splice(fromIndex, 1);
    newCols.splice(toIndex, 0, moved);
    handleSaveColumns(newCols);
  };

  // Load stores once on mount
  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((data) => {
        if (!ignore && data.stores) setStores(data.stores);
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, []);

  // Sync store change from global events
  useEffect(() => {
    const handleStoreChange = () => {
      const stored = localStorage.getItem("acc_selected_store_id");
      if (stored && stored !== selectedStoreId) {
        setSelectedStoreId(stored);
      }
    };
    window.addEventListener("acc_store_changed", handleStoreChange);
    window.addEventListener("storage", handleStoreChange);

    return () => {
      window.removeEventListener("acc_store_changed", handleStoreChange);
      window.removeEventListener("storage", handleStoreChange);
    };
  }, [selectedStoreId]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        storeId: selectedStoreId,
        year: String(selectedYear),
        month: String(selectedMonth),
      });

      const res = await fetch(`${config.api}?${params.toString()}`);
      if (!res.ok) throw new Error(`Lỗi tải dữ liệu (${res.status})`);

      const data = await res.json();
      setItems(data.items || []);
      setPage(1);
      setSummary(data.summary || null);
      if (data.availableMonths && data.availableMonths.length > 0) {
        setAvailableMonths(data.availableMonths);
      }
    } catch (err: any) {
      console.error("[SkuMonthlyView] Error:", err);
      setError(err.message || "Không thể tải báo cáo tháng");
    } finally {
      setLoading(false);
    }
  }, [config.api, selectedStoreId, selectedYear, selectedMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // SKU FBM-monthly: hiện cả tháng chưa có số (đến tháng hiện tại) để chọn rồi bấm "Tính từ file thô"
  const monthOptions = useMemo(() => {
    const options: { month: number; label: string; activeSkus: number | null }[] = availableMonths.map((m) => ({
      month: m.month,
      label: m.label,
      activeSkus: m.activeSkus,
    }));
    if (isFbm) {
      const now = new Date();
      const lastMonth = selectedYear < now.getFullYear() ? 12 : selectedYear === now.getFullYear() ? now.getMonth() + 1 : 0;
      for (let month = 1; month <= lastMonth; month++) {
        if (!options.some((o) => o.month === month)) {
          options.push({ month, label: `Tháng ${month}/${selectedYear}`, activeSkus: null });
        }
      }
      options.sort((a, b) => b.month - a.month);
    }
    return options;
  }, [availableMonths, isFbm, selectedYear]);

  // Tìm kiếm + sắp xếp trên TOÀN BỘ SKU của kỳ rồi mới chia trang
  const displayItems = useMemo(() => {
    const matcher = buildSearchMatcher(deferredSearch);
    const filtered = matcher ? items.filter(matcher) : items;
    const field = SORT_FIELD_ALIAS[sortField] ?? sortField;
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[field];
      const bv = (b as unknown as Record<string, unknown>)[field];
      // Ô trống (—) luôn xuống cuối dù sắp tăng hay giảm
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * COLLATOR.compare(String(av), String(bv));
    });
  }, [items, deferredSearch, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(displayItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = displayItems.slice(pageStart, pageStart + pageSize);

  // Recalculate handler
  const handleRecalculate = async () => {
    if (selectedMonth === "all") return;
    setRecalculating(true);
    setShowRecalcModal(false);
    setRecalcFeedback(null);
    try {
      const res = await fetch(config.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          year: selectedYear,
          month: selectedMonth,
          force: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Có lỗi xảy ra khi tính toán lại");
      }
      setRecalcFeedback({
        success: true,
        message: data.message || `Đã hoàn tất tính toán kỳ ${selectedMonth}/${selectedYear} từ raw data!`,
      });
      await fetchData();
    } catch (err: any) {
      setRecalcFeedback({
        success: false,
        message: err.message || "Lỗi khi tính toán lại từ raw data",
      });
    } finally {
      setRecalculating(false);
    }
  };

  // Handle column sorting
  const handleSort = (field: string) => {
    if (field === "stt" || field === "mockup") return;
    setPage(1);
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSku(text);
    setTimeout(() => setCopiedSku(null), 1500);
  };

  const handleStoreSelect = (newStoreId: string) => {
    if (!newStoreId) return;
    setSelectedStoreId(newStoreId);
    if (typeof window !== "undefined") {
      localStorage.setItem("acc_selected_store_id", newStoreId);
      window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: newStoreId }));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden select-none font-accounting-system">
      {/* 1. TOOLBAR: Store, Month, Search, Zoom, Actions (Đồng bộ 100% với FBA ngày) */}
      <div className="bg-slate-200/70 p-2 rounded-xl border border-slate-300 flex items-center justify-between gap-2 flex-wrap shadow-2xs shrink-0 select-none">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Selector */}
          <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs hover:border-slate-400 transition-colors">
            <StorefrontIcon size={15} weight="bold" className="text-amber-600 mr-1.5 shrink-0" />
            <select
              value={selectedStoreId}
              onChange={(e) => handleStoreSelect(e.target.value)}
              disabled={stores.length === 0}
              className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer pr-5 appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: "right 0 center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "1.25em 1.25em",
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Selector */}
          <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs hover:border-slate-400 transition-colors">
            <CalendarBlankIcon size={15} weight="bold" className="text-amber-600 mr-1.5 shrink-0" />
            <select
              value={selectedMonth}
              onChange={(e) => {
                const val = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
                setSelectedMonth(val);
                if (typeof window !== "undefined") {
                  localStorage.setItem("acc_selected_month", String(val));
                }
              }}
              className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer pr-5 appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: "right 0 center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "1.25em 1.25em",
              }}
            >
              {availableMonths.length > 0 ? (
                monthOptions.map((m) => (
                  <option key={m.month} value={m.month}>
                    {m.activeSkus == null ? `${m.label} (chưa có số)` : `${m.label} (${m.activeSkus} SKUs)`}
                  </option>
                ))
              ) : (
                <>
                  <option value={9}>Tháng 9/2026</option>
                  <option value={8}>Tháng 8/2026</option>
                  <option value={7}>Tháng 7/2026</option>
                  <option value={6}>Tháng 6/2026</option>
                  <option value={5}>Tháng 5/2026</option>
                  <option value={4}>Tháng 4/2026</option>
                  <option value={3}>Tháng 3/2026</option>
                  <option value={2}>Tháng 2/2026</option>
                  <option value={1}>Tháng 1/2026</option>
                </>
              )}
              <option value="all">Tất cả các tháng (YTD)</option>
            </select>
          </div>

          {/* Search SKU, ASIN */}
          <div className="relative flex items-center">
            <MagnifyingGlassIcon
              size={14}
              className="absolute left-2.5 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              placeholder="Tìm SKU, ASIN, Product Type… (dán nhiều SKU cách nhau dấu phẩy)"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-72 rounded-lg border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs text-slate-900 placeholder-slate-400 focus:border-amber-500 focus:outline-hidden shadow-2xs"
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

          {/* Recalculate Button */}
          <button
            type="button"
            onClick={() => setShowRecalcModal(true)}
            disabled={recalculating || selectedMonth === "all"}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            title="Tính toán lại P&L từ các file thô crawler tải về"
          >
            <CalculatorIcon
              size={14}
              className={recalculating ? "animate-spin text-indigo-600" : "text-indigo-600"}
            />
            <span>{recalculating ? "Đang tính..." : "Tính từ file thô"}</span>
          </button>

          {/* Export Excel */}
          <a
            href={`${config.api}/export?storeId=${selectedStoreId}&month=${selectedMonth}&year=${selectedYear}&search=${encodeURIComponent(
              search
            )}`}
            download
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
          >
            <DownloadSimpleIcon size={14} weight="bold" />
            <span>Xuất Excel</span>
          </a>
        </div>
      </div>

      {/* 2. TABLE CONTAINER: Sticky Orange Header & Sticky Amber Total Row */}
      <div className="flex-1 overflow-auto bg-white relative">
        <AccountingTopProgressBar loading={loading} variant="amber" />
        <div
          style={{
            zoom: `${zoomLevel}%`,
          }}
          className="min-w-full inline-block align-top"
        >
          <table className="acc-financial-table w-full border-separate border-spacing-0 text-left border-b border-slate-200">
            {/* THEAD with Header Row + Sticky TOTAL Row (Đúng màu #ff9900 của Amazon / FBA ngày) */}
            <thead className="sticky top-0 z-30 select-none bg-[#ff9900] text-slate-950">
              {/* ROW 1: COLUMN HEADERS */}
              <tr className="text-[15px] font-bold shadow-xs">
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
                      className={`py-2 px-2.5 whitespace-nowrap bg-[#ff9900] text-slate-950 ${profitColClass(col.id, "head")}`}
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
                        className={`group/title flex min-h-[38px] w-full items-center gap-1 ${
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
              {summary && (
                <tr className="bg-[#fffbeb] text-slate-900 border-b border-amber-300 text-xs select-none shadow-2xs">
                  {visibleColumns.map((col) => {
                    const f = getCellFreezeProps(col.id, true);
                    const bgStyle = f.isFrozen ? { backgroundColor: "#fffbeb" } : {};
                    const isProfitCol = col.id === "profit";

                    return (
                      <td
                        key={`total-${col.id}`}
                        style={{ ...f.style, ...bgStyle }}
                        className={`${profitColClass(col.id, "total")} py-1.5 px-2.5 text-xs border-b border-amber-300 whitespace-nowrap font-semibold ${
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
                        {col.id === "product_type" && (
                          <span className="text-slate-700 font-bold">{summary.active_sku_count} active</span>
                        )}
                        {col.id === "mockup" && <span className="text-slate-400">—</span>}
                        {col.id === "sku" && <span className="font-bold text-slate-950">{displayItems.length} SKUs</span>}
                        {col.id === "asin" && <span className="text-slate-400">—</span>}
                        {col.id === "revenue" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_revenue)}
                          </span>
                        )}
                        {col.id === "quantity" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(summary.total_quantity)}
                          </span>
                        )}
                        {col.id === "ads_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_ads_fee)}
                          </span>
                        )}
                        {col.id === "basecost" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_basecost)}
                          </span>
                        )}
                        {col.id === "amazon_fee_unrecognized" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_amazon_fee_unrecognized)}
                          </span>
                        )}
                        {col.id === "amazon_fee_trans" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_amazon_fee_trans)}
                          </span>
                        )}
                        {col.id === "amazon_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_amazon_fee)}
                          </span>
                        )}
                        {col.id === "thue" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_thue)}
                          </span>
                        )}
                        {col.id === "return_amount" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_return_amount)}
                          </span>
                        )}
                        {col.id === "adjustment" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_adjustment)}
                          </span>
                        )}
                        {col.id === "storage_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_storage_fee)}
                          </span>
                        )}
                        {col.id === "placement_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_placement_fee)}
                          </span>
                        )}
                        {col.id === "long_term_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_long_term_fee)}
                          </span>
                        )}
                        {col.id === "fba_customer_return_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_fba_customer_return_fee)}
                          </span>
                        )}
                        {col.id === "liquidations" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_liquidations)}
                          </span>
                        )}
                        {col.id === "basecost_return_adjustment" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_basecost_return_adj)}
                          </span>
                        )}
                        {col.id === "removal" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_removal)}
                          </span>
                        )}
                        {isProfitCol && (
                          <span
                            className={`font-bold tabular-nums ${
                              summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600"
                            }`}
                          >
                            {formatCurrency(summary.net_profit)}
                          </span>
                        )}
                        {col.id === "margin" && (
                          <span
                            className={`font-bold tabular-nums ${
                              (summary.margin || 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                            }`}
                          >
                            {formatPercent(summary.margin)}
                          </span>
                        )}
                        {col.id === "tacos" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatPercent(summary.tacos)}
                          </span>
                        )}
                        {col.id === "acos" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatPercent(summary.acos)}
                          </span>
                        )}
                        {col.id === "roi" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatPercent(summary.roi)}
                          </span>
                        )}
                        {col.id === "profit_per_item" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {summary.total_quantity > 0 ? formatCurrency(summary.net_profit / summary.total_quantity) : "—"}
                          </span>
                        )}
                        {col.id === "basecost_per_item" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {summary.total_quantity > 0 ? formatCurrency(summary.total_basecost / summary.total_quantity) : "—"}
                          </span>
                        )}
                        {col.id === "vat_tax_adjustment" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.vat_tax_adjustment)}
                          </span>
                        )}
                        {col.id === "removal_qty_2024" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(items.reduce((s, i) => s + (i.removal_qty_2024 || 0), 0))}
                          </span>
                        )}
                        {col.id === "awd_subscription_fees" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.awd_subscription_fees)}
                          </span>
                        )}
                        {col.id === "basecost_adjustment" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.basecost_adjustment)}
                          </span>
                        )}
                        {col.id === "revenue_ads" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_revenue_ads)}
                          </span>
                        )}
                        {col.id === "a_to_z_claim" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_a_to_z_claim)}
                          </span>
                        )}
                        {col.id === "chargeback_refund" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.total_chargeback_refund)}
                          </span>
                        )}
                        {col.id === "owner_fee" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatCurrency(summary.owner_fee ?? 0)}
                          </span>
                        )}
                        {col.id === "available_now" && (
                          <span className="font-bold text-slate-950 tabular-nums">
                            {formatInteger(summary.total_available_now)}
                          </span>
                        )}
                        {(col.id === "listing_month" || col.id === "review_month" || col.id === "status" || col.id === "fnsku") && (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </thead>

            {/* TBODY: Data Rows */}
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && items.length === 0 ? (
                <AccountingTableSkeletonRows
                  rows={12}
                  columnsCount={visibleColumns.length}
                  rowHeightClass="h-[36px]"
                />
              ) : displayItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    className="py-16 text-center text-slate-500"
                  >
                    <FileTextIcon size={36} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-bold text-slate-700">Không tìm thấy dữ liệu SKU phù hợp</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Thử thay đổi bộ lọc tìm kiếm hoặc chọn tháng khác
                    </p>
                  </td>
                </tr>
              ) : (
                pageItems.map((item, pageIdx) => {
                  const idx = pageStart + pageIdx;
                  const isProfit = item.profit >= 0;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedSkuDetail(item)}
                      className={`hover:bg-amber-50/40 transition-colors cursor-pointer group ${
                        idx % 2 === 0 ? "bg-white" : "bg-[#f8fafc]/50"
                      }`}
                    >
                      {visibleColumns.map((col) => {
                        const f = getCellFreezeProps(col.id, false);
                        const bgStyle = f.isFrozen
                          ? { backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }
                          : {};

                        return (
                          <td
                            key={col.id}
                            style={{ ...f.style, ...bgStyle }}
                            className={`${profitColClass(col.id, "body")} py-1.5 px-2.5 text-xs border-r border-b border-slate-200 whitespace-nowrap ${
                              f.isBoundary
                                ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                                : ""
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
                              <span className="text-slate-500 font-semibold">{idx + 1}</span>
                            )}

                            {/* Product Type */}
                            {col.id === "product_type" && (
                              <span className="font-semibold text-slate-800">
                                {item.product_type || "Chưa phân loại"}
                              </span>
                            )}

                            {/* Mockup */}
                            {col.id === "mockup" && (
                              <div className="relative mx-auto h-7 w-7 rounded bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                                {item.mockup_url ? (
                                  <Image
                                    src={item.mockup_url}
                                    alt={item.sku}
                                    fill
                                    sizes="28px"
                                    className="object-cover"
                                    unoptimized
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-slate-400">
                                    —
                                  </div>
                                )}
                              </div>
                            )}

                            {/* SKU */}
                            {col.id === "sku" && (
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900 group-hover:text-amber-700 transition">
                                  {item.sku}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(item.sku);
                                  }}
                                  className="text-slate-400 hover:text-slate-700 transition"
                                  title="Copy SKU"
                                >
                                  <CopyIcon size={12} />
                                </button>
                              </div>
                            )}

                            {/* ASIN */}
                            {col.id === "asin" && (
                              <span className="font-mono text-slate-600">{item.asin || "—"}</span>
                            )}

                            {/* Revenue */}
                            {col.id === "revenue" && (
                              <span className="font-bold text-slate-900 tabular-nums">
                                {formatCurrency(item.revenue)}
                              </span>
                            )}

                            {/* Quantity */}
                            {col.id === "quantity" && (
                              <span className="tabular-nums text-slate-700">
                                {formatInteger(item.quantity)}
                              </span>
                            )}

                            {/* Ads Fee */}
                            {col.id === "ads_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.ads_fee)}
                              </span>
                            )}

                            {/* Base Cost */}
                            {col.id === "basecost" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.basecost)}
                              </span>
                            )}

                            {/* Amazon Fee (chưa ghi nhận) */}
                            {col.id === "amazon_fee_unrecognized" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.amazon_fee_unrecognized)}
                              </span>
                            )}

                            {/* Amazon fee (transperance report) */}
                            {col.id === "amazon_fee_trans" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.amazon_fee_trans)}
                              </span>
                            )}

                            {/* AMZ Fee */}
                            {col.id === "amazon_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.amazon_fee_total)}
                              </span>
                            )}

                            {/* Thuế */}
                            {col.id === "thue" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.thue)}
                              </span>
                            )}

                            {/* Refund */}
                            {col.id === "return_amount" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.return_amount)}
                              </span>
                            )}

                            {/* Adjustment */}
                            {col.id === "adjustment" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.adjustment)}
                              </span>
                            )}

                            {/* Storage fee */}
                            {col.id === "storage_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.storage_fee)}
                              </span>
                            )}

                            {/* Placement fee */}
                            {col.id === "placement_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.placement_fee)}
                              </span>
                            )}

                            {/* Long term fee */}
                            {col.id === "long_term_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.long_term_fee)}
                              </span>
                            )}

                            {/* FBA Return Fee */}
                            {col.id === "fba_customer_return_fee" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.fba_customer_return_fee)}
                              </span>
                            )}

                            {/* Liquidations */}
                            {col.id === "liquidations" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.liquidations)}
                              </span>
                            )}

                            {/* Basecost Return/Adj */}
                            {col.id === "basecost_return_adjustment" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.basecost_return_adjustment)}
                              </span>
                            )}

                            {/* Removal */}
                            {col.id === "removal" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.removal)}
                              </span>
                            )}

                            {/* Profit: Xanh lục nếu dương, đỏ nếu âm */}
                            {col.id === "profit" && (
                              <span
                                className={`font-bold tabular-nums ${
                                  isProfit ? "text-emerald-700" : "text-rose-600"
                                }`}
                              >
                                {formatCurrency(item.profit)}
                              </span>
                            )}

                            {/* Margin % */}
                            {col.id === "margin" && (
                              <span
                                className={`font-semibold tabular-nums ${
                                  (item.margin || 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                                }`}
                              >
                                {formatPercent(item.margin)}
                              </span>
                            )}

                            {/* TACOS */}
                            {col.id === "tacos" && (
                              <span className="tabular-nums text-slate-700">
                                {formatPercent(item.tacos)}
                              </span>
                            )}

                            {/* ACOS */}
                            {col.id === "acos" && (
                              <span className="tabular-nums text-slate-700">
                                {formatPercent(item.acos)}
                              </span>
                            )}

                            {/* ROI */}
                            {col.id === "roi" && (
                              <span className="font-semibold tabular-nums text-slate-700">
                                {formatPercent(item.roi)}
                              </span>
                            )}

                            {/* Profit/Item */}
                            {col.id === "profit_per_item" && (
                              <span
                                className={`tabular-nums font-medium ${
                                  item.profit_per_item != null && item.profit_per_item >= 0
                                    ? "text-emerald-700"
                                    : "text-rose-600"
                                }`}
                              >
                                {formatCurrency(item.profit_per_item)}
                              </span>
                            )}

                            {/* Basecost/Item */}
                            {col.id === "basecost_per_item" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.basecost_per_item)}
                              </span>
                            )}

                            {/* VAT/Tax Adjustment */}
                            {col.id === "vat_tax_adjustment" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.vat_tax_adjustment)}
                              </span>
                            )}

                            {/* SL đã removal 2024 */}
                            {col.id === "removal_qty_2024" && (
                              <span className="tabular-nums text-slate-700">
                                {formatInteger(item.removal_qty_2024)}
                              </span>
                            )}

                            {/* AWD/Subscription/Amazon Fees/Disposal Fee */}
                            {col.id === "awd_subscription_fees" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.awd_subscription_fees)}
                              </span>
                            )}

                            {/* Basecost Adjustment */}
                            {col.id === "basecost_adjustment" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.basecost_adjustment)}
                              </span>
                            )}

                            {/* A-to-z / Chargeback (SKU FBM-monthly) */}
                            {col.id === "a_to_z_claim" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.a_to_z_claim ?? 0)}
                              </span>
                            )}
                            {col.id === "chargeback_refund" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.chargeback_refund ?? 0)}
                              </span>
                            )}
                            {/* Phí chủ store chỉ có ở dòng tổng */}
                            {col.id === "owner_fee" && <span className="text-slate-400">—</span>}

                            {/* Revenue ads */}
                            {col.id === "revenue_ads" && (
                              <span className="tabular-nums text-slate-700">
                                {formatCurrency(item.revenue_ads)}
                              </span>
                            )}

                            {/* Tồn kho */}
                            {col.id === "available_now" && (
                              <span className="font-bold tabular-nums text-indigo-700">
                                {formatInteger(item.available_now)}
                              </span>
                            )}

                            {/* Tháng listing */}
                            {col.id === "listing_month" && (
                              <span className="text-slate-600 text-xs">
                                {item.listing_month || "—"}
                              </span>
                            )}

                            {/* Tháng đánh giá */}
                            {col.id === "review_month" && (
                              <span className="text-slate-600 text-xs">
                                {item.review_month || "—"}
                              </span>
                            )}

                            {/* Trạng thái */}
                            {col.id === "status" && (
                              item.status ? (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700">
                                  {item.status}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )
                            )}

                            {/* FNSKU */}
                            {col.id === "fnsku" && (
                              item.fnsku ? (
                                <span className="font-mono text-[11px] text-slate-600">
                                  {item.fnsku}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )
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

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        totalItems={displayItems.length}
        limit={pageSize}
        onPageChange={setPage}
        onLimitChange={(size) => {
          setPageSize(size);
          setPage(1);
          if (typeof window !== "undefined") localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
        }}
        label="SKU"
      />

      {/* 3. FOOTER BAR (Đồng bộ với FBA ngày) */}
      <div className="bg-slate-100 px-3 py-1.5 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span>
            Hiển thị <strong>{displayItems.length}</strong>
            {displayItems.length !== items.length && <> / {items.length}</>} SKU
            {summary && (
              <>
                {" "}— trong đó <strong className="text-emerald-700">{summary.active_sku_count}</strong> SKU phát sinh giao dịch
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span>
            Dữ liệu tự động tổng hợp từ sheet {config.sheet} trong file kế toán
            {summary?.data_source === "file" && " — kỳ này nạp từ file TỔNG KẾT"}
          </span>
        </div>
      </div>

      {/* COLUMN CONTEXT MENU (Khóa cột, Ẩn cột, Thu nhỏ tự động) */}
      {columnContextMenu && (() => {
        const field = columnContextMenu.field;
        const col = columns.find((item) => item.id === field);
        const colLabel = col?.label || field;
        const visibleIndex = visibleColumns.findIndex((item) => item.id === field);
        const isCurrentBoundary =
          visibleIndex >= 0 &&
          lockedColumns.includes(field) &&
          !visibleColumns.slice(visibleIndex + 1).some((item) => lockedColumns.includes(item.id));

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
                  <span>Về khóa mặc định (SKU)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleQuickHideColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
              >
                <EyeSlashIcon size={14} className="shrink-0 text-rose-500" />
                <span>Ẩn cột này</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* COLUMN MANAGER MODAL (Tùy chỉnh cột kéo thả) */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title={config.title}
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />

      {/* DETAILED BREAKDOWN MODAL */}
      {selectedSkuDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedSkuDetail(null)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                  {selectedSkuDetail.mockup_url ? (
                    <Image
                      src={selectedSkuDetail.mockup_url}
                      alt={selectedSkuDetail.sku}
                      fill
                      sizes="56px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
                      No pic
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-slate-900">{selectedSkuDetail.sku}</h2>
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200/50">
                      {selectedSkuDetail.product_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                    <span>
                      ASIN: <b className="font-mono text-slate-800">{selectedSkuDetail.asin || "—"}</b>
                    </span>
                    <span>
                      FNSKU: <b className="font-mono text-slate-800">{selectedSkuDetail.fnsku || "—"}</b>
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Modal Breakdown Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Doanh Thu</span>
                <div className="text-base font-black text-slate-900 mt-1">
                  {formatCurrency(selectedSkuDetail.revenue)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Số lượng: <b>{selectedSkuDetail.quantity}</b> items
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Chi Phí Ads</span>
                <div className="text-base font-black text-rose-600 mt-1">
                  {formatCurrency(selectedSkuDetail.ads_fee)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  T-ACOS: <b>{formatPercent(selectedSkuDetail.tacos)}</b>
                </div>
              </div>

              <div
                className={`rounded-xl border p-3 ${
                  selectedSkuDetail.profit >= 0
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-rose-200 bg-rose-50/40"
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Lợi Nhuận Ròng
                </span>
                <div
                  className={`text-base font-black mt-1 ${
                    selectedSkuDetail.profit >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {formatCurrency(selectedSkuDetail.profit)}
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">
                  Biên: <b>{formatPercent(selectedSkuDetail.margin)}</b>
                </div>
              </div>
            </div>

            {/* Chi tiết phụ phí */}
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Chi tiết các khoản phí
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Giá vốn hàng bán (Basecost):</span>
                  <span className="font-bold text-slate-900">{formatCurrency(selectedSkuDetail.basecost)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Phí sàn Amazon:</span>
                  <span className="font-bold text-rose-600">
                    {formatCurrency(selectedSkuDetail.amazon_fee_total)}
                  </span>
                </div>
                {!isFbm && (
                  <>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">Phí lưu kho (Storage Fee):</span>
                    <span className="font-bold text-rose-600">{formatCurrency(selectedSkuDetail.storage_fee)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">Phí Placement Inbound:</span>
                    <span className="font-bold text-rose-600">
                      {formatCurrency(selectedSkuDetail.placement_fee)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">Phí Long-Term Storage:</span>
                    <span className="font-bold text-rose-600">{formatCurrency(selectedSkuDetail.long_term_fee)}</span>
                  </div>
                  </>
                )}
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Thuế (Tax):</span>
                  <span className="font-bold text-slate-900">{formatCurrency(selectedSkuDetail.thue)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Khách hoàn tiền (Refund / Return):</span>
                  <span className="font-bold text-rose-600">
                    {formatCurrency(selectedSkuDetail.return_amount)}
                  </span>
                </div>
                {isFbm ? (
                  <>
                    <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-600">A-to-z Guarantee Claim:</span>
                      <span className="font-bold text-rose-600">{formatCurrency(selectedSkuDetail.a_to_z_claim ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                      <span className="text-slate-600">Chargeback Refund:</span>
                      <span className="font-bold text-rose-600">{formatCurrency(selectedSkuDetail.chargeback_refund ?? 0)}</span>
                    </div>
                  </>
                ) : (
                  <>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">Điều chỉnh (Adjustment):</span>
                    <span className="font-bold text-slate-900">{formatCurrency(selectedSkuDetail.adjustment)}</span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">FBA Customer Return Fee:</span>
                    <span className="font-bold text-rose-600">
                      {formatCurrency(selectedSkuDetail.fba_customer_return_fee)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                    <span className="text-slate-600">Thu hồi hàng (Removal):</span>
                    <span className="font-bold text-rose-600">{formatCurrency(selectedSkuDetail.removal)}</span>
                  </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECALCULATE MODAL */}
      {showRecalcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                <CalculatorIcon size={22} weight="bold" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Tính toán lại từ Raw Data</h3>
                <p className="text-xs text-slate-500">
                  Tháng {selectedMonth}/{selectedYear} - Store:{" "}
                  {stores.find((s) => s.id === selectedStoreId)?.name || "Store hiện tại"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5">
                <WarningCircleIcon size={16} weight="bold" className="text-amber-600 shrink-0" />
                Lưu ý quan trọng:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 text-[11px]">
                <li>Hệ thống sẽ chạy parser đọc trực tiếp từ các file báo cáo thô trong thư mục crawler tải về.</li>
                <li>Dữ liệu tháng {selectedMonth}/{selectedYear} trong cơ sở dữ liệu sẽ được cập nhật lại theo các file mới nhất.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowRecalcModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleRecalculate}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700 shadow-2xs transition cursor-pointer"
              >
                Xác nhận tính lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FEEDBACK TOAST */}
      {recalcFeedback && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-2xl bg-white p-4 shadow-xl border border-slate-200 space-y-2 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-start gap-3">
            {recalcFeedback.success ? (
              <CheckCircleIcon size={22} weight="fill" className="text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <WarningCircleIcon size={22} weight="fill" className="text-rose-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900">
                {recalcFeedback.success ? "Tính toán thành công!" : "Tính toán thất bại"}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">{recalcFeedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setRecalcFeedback(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold ml-2 cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
