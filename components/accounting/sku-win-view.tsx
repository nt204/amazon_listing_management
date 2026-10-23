/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  EyeSlashIcon,
  FileXlsIcon,
  FunnelIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StorefrontIcon,
  TargetIcon,
  TrophyIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  ColumnManagerModal,
  ColumnHeaderCell,
  createTextWidthMeasurer,
  type ColumnConfig,
  DEFAULT_SKU_WIN_COLUMNS,
} from "./column-manager-modal";
import {
  PpcAmazonDatePicker,
  type DateRange,
} from "@/components/ppc/ppc-amazon-date-picker";
import {
  getAmazonLatestAvailableDate,
  getSavedStoreDateRange,
  saveStoreDateRange,
} from "./financials-date-utils";

export interface SkuWinItem {
  id: string;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup: string | null;
  mockup_url: string | null;
  brand: string | null;
  status: string | null;
  niche: string | null;
  pic_mkt: string | null;
  amazon_fee_unit: number;
  referral_fee_pct: number;
  custom_price: number | null;

  revenue: number;
  quantity: number;
  ads_fee: number;
  basecost: number;
  amazon_fee: number;
  thue: number;
  promotion: number;
  return_cost: number;
  profit: number;

  profit_per_item: number;
  basecost_per_item: number;
  tacos: number;
  acos: number;
  margin: number;
  roi: number;

  revenue_ads: number;
  all_time_quantity: number;
  return_count: number;
  return_rate: number;
  shipped_qty: number;

  revenue_target: number | null;
  unit_target: number | null;
  spend_target: number | null;
  profit_target: number | null;

  compare_revenue?: number;
  compare_quantity?: number;
  compare_ads_fee?: number;
  compare_tacos?: number;
  compare_profit?: number;
  growth?: number | null;
}

export interface SkuWinStats {
  totalSkus: number;
  totalRevenue: number;
  totalQuantity: number;
  totalAdsFee: number;
  totalBasecost: number;
  totalAmazonFee: number;
  totalThue: number;
  totalPromotion: number;
  totalReturnCost: number;
  totalProfit: number;
  totalRevenueAds: number;
  avgMargin: number;
  avgTacos: number;
  avgRoi: number;
  winCount: number;
  lossCount: number;
}

interface Store {
  id: string;
  name: string;
  marketplace?: string;
}

const SKU_WIN_COLUMNS_STORAGE_KEY = "accounting_sku_win_columns_global";
const SKU_WIN_FROZEN_STORAGE_KEY = "accounting_sku_win_frozen_through";

// Number formatters
const formatCurrency = (val: number | null | undefined) => {
  if (val == null || isNaN(val)) return "0.00";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
};

const formatInteger = (val: number | null | undefined) => {
  if (val == null || isNaN(val)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(val));
};

const formatPercent = (val: number | null | undefined) => {
  if (val == null || isNaN(val)) return "0.0%";
  return `${(val * 100).toFixed(1)}%`;
};

// getAmazonLatestAvailableDate is imported from ./financials-date-utils

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// Pagination Bar Component flush with table card (như Bảng Mã)
function PaginationBar({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  onLimitChange,
  label = "SKU",
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  onLimitChange?: (newLimit: number) => void;
  label?: string;
}) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(totalItems, page * limit);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-[#f8fafc] px-4 py-2 text-xs text-slate-700 font-semibold select-none shrink-0">
      <div className="flex items-center gap-3">
        <span>
          Hiển thị <strong className="text-slate-950 font-black">{startItem}–{endItem}</strong> / <strong className="text-slate-950 font-black">{totalItems.toLocaleString()}</strong> {label}
        </span>
        {onLimitChange && (
          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-300 pl-3">
            <span className="text-slate-500 text-[11px]">Mỗi trang:</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer shadow-2xs"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={1000}>Tất cả</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(1)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang đầu"
        >
          « Đầu
        </button>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang trước"
        >
          ‹ Trước
        </button>

        <div className="flex items-center gap-1 px-2 font-mono text-xs">
          <span className="text-slate-500">Trang</span>
          <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
            {page}
          </span>
          <span className="text-slate-500">/ {totalPages}</span>
        </div>

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang sau"
        >
          Sau ›
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition shadow-2xs text-[11px]"
          title="Trang cuối"
        >
          Cuối »
        </button>
      </div>
    </div>
  );
}

export function SkuWinView() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "";
    }
    return "";
  });
  const selectedStore = useMemo(() => stores.find((s) => s.id === selectedStoreId), [stores, selectedStoreId]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Amazon reports are complete through yesterday.
  const financialMaxDate = useMemo(() => getAmazonLatestAvailableDate(), []);
  // Date Range state: defaults to 'This Month' or per-account saved range
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const initStoreId = typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") || "" : "";
    return getSavedStoreDateRange("sku_win", initStoreId, financialMaxDate);
  });
  const startDate = dateRange.startDate;
  const endDate = dateRange.endDate;

  // Search
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  // Sorting
  const [sortField, setSortField] = useState<string>("profit");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Table Zoom Control (60% to 150%)
  const [tableZoom, setTableZoom] = useState<number>(100);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Data state
  const [items, setItems] = useState<SkuWinItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SkuWinStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);

  // Column Drag & Drop Reorder
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  // Column Context Menu
  const [columnContextMenu, setColumnContextMenu] = useState<{
    field: string;
    x: number;
    y: number;
  } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Column Filters
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  // Field Editor Modal (Cấu hình riêng 1 cột theo đúng Bảng Mã)
  const [fieldEditor, setFieldEditor] = useState<{
    field_id: string;
    label: string;
    options: string[];
    allow_custom_value: boolean;
  } | null>(null);
  const [newFieldOption, setNewFieldOption] = useState("");

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const notify = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 2500);
  }, []);

  // Column Manager & Freezing
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(SKU_WIN_COLUMNS_STORAGE_KEY);
        if (saved) {
          const parsed: ColumnConfig[] = JSON.parse(saved);
          const colMap = new Map(parsed.map((c) => [c.id, c]));
          return DEFAULT_SKU_WIN_COLUMNS.map((def) => {
            const user = colMap.get(def.id);
            if (!user) return def;
            let userLabel = (user.label || def.label).replace(/\s*\(\$\)/g, "").trim();
            if (def.id === "revenue" && (userLabel.toLowerCase() === "revenue" || !userLabel)) userLabel = "Revenue";
            if (def.id === "quantity" && (userLabel.toLowerCase() === "quantity" || !userLabel)) userLabel = "Quantity";
            return { ...def, label: userLabel, visible: user.visible, width: user.width || def.width };
          });
        }
      } catch (err) {
        console.error("Failed to load sku win columns:", err);
      }
    }
    return DEFAULT_SKU_WIN_COLUMNS;
  });
  const [showColumnModal, setShowColumnModal] = useState(false);

  const [frozenThrough, setFrozenThrough] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SKU_WIN_FROZEN_STORAGE_KEY) || "sku";
    }
    return "sku";
  });

  // Target & Price Edit Modal
  const [targetModalItem, setTargetModalItem] = useState<SkuWinItem | null>(null);
  const [targetForm, setTargetForm] = useState({
    price: "",
    revenue_target: "",
    unit_target: "",
    spend_target: "",
    profit_target: "",
  });
  const [savingTarget, setSavingTarget] = useState(false);

  // Image Preview Modal
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnContextMenu(null);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // 1. Fetch Stores (Only once on mount)
  useEffect(() => {
    let ignore = false;
    async function loadStores() {
      try {
        const res = await fetch("/api/accounting/stores");
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            const list: Store[] = data.stores || [];
            setStores(list);
            
            if (list.length > 0) {
              const savedId = typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") || "" : "";
              const matchedStore = list.find((s) => s.id === savedId);
              const limimaStore = list.find((s) => s.name.toUpperCase().includes("LIMIMA"));
              const targetStore = matchedStore || limimaStore || list[0];

              setSelectedStoreId(targetStore.id);
              if (typeof window !== "undefined") {
                localStorage.setItem("acc_selected_store_id", targetStore.id);
              }
              setDateRange(getSavedStoreDateRange("sku_win", targetStore.id, financialMaxDate));
            }
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
  }, []);

  const handleStoreSelect = (newStoreId: string) => {
    if (!newStoreId) return;
    setSelectedStoreId(newStoreId);
    if (typeof window !== "undefined") {
      localStorage.setItem("acc_selected_store_id", newStoreId);
      window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: newStoreId }));
    }
    setDateRange(getSavedStoreDateRange("sku_win", newStoreId, financialMaxDate));
    setPage(1);
  };

  // Sync store change from other tabs
  useEffect(() => {
    const handleSyncStore = (e: any) => {
      const newStoreId = e.detail || (typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") : null);
      if (newStoreId && newStoreId !== selectedStoreId && stores.some((s) => s.id === newStoreId)) {
        setSelectedStoreId(newStoreId);
        setDateRange(getSavedStoreDateRange("sku_win", newStoreId, financialMaxDate));
        setPage(1);
      }
    };
    window.addEventListener("acc_store_changed", handleSyncStore);
    window.addEventListener("storage", handleSyncStore);
    return () => {
      window.removeEventListener("acc_store_changed", handleSyncStore);
      window.removeEventListener("storage", handleSyncStore);
    };
  }, [selectedStoreId, stores]);

  // 2. Fetch Data
  const fetchData = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        store_id: selectedStoreId,
        page: String(page),
        limit: String(limit),
        sort_field: sortField,
        sort_dir: sortDirection,
        sku_type: "all",
      });

      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/accounting/financials/sku-win?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error("Error fetching SKU Win data:", err);
    } finally {
      setLoading(false);
    }
  }, [
    selectedStoreId,
    page,
    limit,
    sortField,
    sortDirection,
    startDate,
    endDate,
    debouncedSearch,
  ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
  }, [fetchData]);

  // Sorting Handler
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    setPage(1);
  };

  // Copy SKU
  const handleCopySku = (sku: string) => {
    navigator.clipboard.writeText(sku);
    setCopiedSku(sku);
    notify(`Đã copy SKU "${sku}"`, "success");
    setTimeout(() => setCopiedSku(null), 2000);
  };

  // Open Target Modal
  const handleOpenTargetModal = (item: SkuWinItem) => {
    setTargetModalItem(item);
    setTargetForm({
      price: item.custom_price != null ? String(item.custom_price) : "",
      revenue_target: item.revenue_target != null ? String(item.revenue_target) : "",
      unit_target: item.unit_target != null ? String(item.unit_target) : "",
      spend_target: item.spend_target != null ? String(item.spend_target) : "",
      profit_target: item.profit_target != null ? String(item.profit_target) : "",
    });
  };

  // Save Target Modal
  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetModalItem || !selectedStoreId) return;
    setSavingTarget(true);
    try {
      const res = await fetch("/api/accounting/financials/sku-win", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId,
          id: targetModalItem.id,
          price: targetForm.price ? parseFloat(targetForm.price) : null,
          targets: {
            revenue: targetForm.revenue_target ? parseFloat(targetForm.revenue_target) : null,
            unit: targetForm.unit_target ? parseInt(targetForm.unit_target, 10) : null,
            spend: targetForm.spend_target ? parseFloat(targetForm.spend_target) : null,
            profit: targetForm.profit_target ? parseFloat(targetForm.profit_target) : null,
          },
        }),
      });

      if (res.ok) {
        setTargetModalItem(null);
        notify("Đã lưu mục tiêu thành công!", "success");
        fetchData();
      }
    } catch (err) {
      console.error("Failed to save target:", err);
      notify("Lỗi khi lưu mục tiêu", "error");
    } finally {
      setSavingTarget(false);
    }
  };

  // Column Management
  const handleSaveColumns = (updated: ColumnConfig[]) => {
    setColumns(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem(SKU_WIN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
    }
  };

  const handleResetColumns = () => {
    setColumns(DEFAULT_SKU_WIN_COLUMNS);
    if (typeof window !== "undefined") {
      localStorage.removeItem(SKU_WIN_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(SKU_WIN_FROZEN_STORAGE_KEY);
    }
    setFrozenThrough("sku");
    notify("Đã đưa cấu hình cột về mặc định!", "success");
  };

  // Visible Columns
  const visibleColumns = useMemo(() => columns.filter((c) => c.visible !== false), [columns]);

  // Pre-calculate freeze metrics for all visible columns (O(1) Map lookup instead of inner loops on every cell)
  const freezeMetrics = useMemo(() => {
    const map = new Map<
      string,
      {
        isFrozen: boolean;
        isBoundary: boolean;
        headerStyle: React.CSSProperties;
        bodyStyle: React.CSSProperties;
        className: string;
      }
    >();

    let offset = 0;
    const frozenIndex = visibleColumns.findIndex((c) => c.id === frozenThrough);

    for (let i = 0; i < visibleColumns.length; i++) {
      const col = visibleColumns[i];
      const widthNum =
        typeof col.width === "number"
          ? col.width
          : parseInt(String(col.width).replace(/\D/g, "") || "100", 10);

      const isFrozen = frozenIndex !== -1 && i <= frozenIndex;
      if (isFrozen) {
        const isBoundary = col.id === frozenThrough;
        map.set(col.id, {
          isFrozen: true,
          isBoundary,
          headerStyle: {
            position: "sticky",
            left: `${offset}px`,
            zIndex: 40,
          },
          bodyStyle: {
            position: "sticky",
            left: `${offset}px`,
            zIndex: 20,
          },
          className: isBoundary
            ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
            : "",
        });
        offset += widthNum;
      } else {
        map.set(col.id, {
          isFrozen: false,
          isBoundary: false,
          headerStyle: {},
          bodyStyle: {},
          className: "",
        });
      }
    }
    return map;
  }, [visibleColumns, frozenThrough]);

  // Fast freeze helpers with instant O(1) Map lookup
  const getCellFreezeProps = useCallback(
    (colId: string, isHeader = false) => {
      const metric = freezeMetrics.get(colId);
      if (!metric) {
        return { isFrozen: false, isBoundary: false, style: {}, className: "" };
      }
      return {
        isFrozen: metric.isFrozen,
        isBoundary: metric.isBoundary,
        style: isHeader ? metric.headerStyle : metric.bodyStyle,
        className: metric.className,
      };
    },
    [freezeMetrics]
  );

  // Resize Column
  const handleResizeColumn = useCallback((colId: string, width: number) => {
    setColumns((prev) => {
      const updated = prev.map((c) => (c.id === colId ? { ...c, width: Math.max(50, width) } : c));
      if (typeof window !== "undefined") {
        localStorage.setItem(SKU_WIN_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // Auto-fit Column
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
      notify("Đã thu nhỏ cột!", "success");
    },
    [columns, items, handleResizeColumn, notify]
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
    notify("Đã đổi vị trí cột!", "success");
  };

  // Set Frozen Boundary
  const handleSetFrozenColumn = (colId: string) => {
    setFrozenThrough(colId);
    if (typeof window !== "undefined") {
      localStorage.setItem(SKU_WIN_FROZEN_STORAGE_KEY, colId);
    }
    notify(`Đã khóa đến cột "${colId}".`, "success");
  };

  // Quick Hide Column
  const handleQuickHideColumn = (colId: string) => {
    const updated = columns.map((c) => (c.id === colId ? { ...c, visible: false } : c));
    handleSaveColumns(updated);
    notify(`Đã ẩn cột "${colId}".`, "success");
  };

  // Scan Column Options for context menu filter
  const getColumnOptions = useCallback((colId: string): string[] => {
    const set = new Set<string>();
    for (const item of items) {
      const val = (item as unknown as Record<string, unknown>)[colId];
      if (val != null && String(val).trim()) {
        set.add(String(val).trim());
      }
    }
    return Array.from(set).sort();
  }, [items]);

  // Scan unique options from rows for FieldEditor modal
  const scanOptionsFromRows = useCallback((fieldId: string): string[] => {
    const set = new Set<string>();
    for (const item of items) {
      const val = (item as unknown as Record<string, unknown>)[fieldId];
      if (val != null && String(val).trim() && String(val).trim() !== "0" && String(val).trim() !== "-") {
        set.add(String(val).trim());
      }
    }
    return Array.from(set).sort();
  }, [items]);

  // Save single column configuration
  const saveFieldEditor = () => {
    if (!fieldEditor) return;
    const updated = columns.map((c) => {
      if (c.id === fieldEditor.field_id) {
        return {
          ...c,
          label: fieldEditor.label.trim() || c.label,
          options: fieldEditor.options,
          allow_custom_value: fieldEditor.allow_custom_value,
        };
      }
      return c;
    });
    handleSaveColumns(updated);
    setFieldEditor(null);
    notify("Đã lưu cấu hình cột!", "success");
  };

  // Client-side filtering if user applies a column filter from context menu
  const displayItems = useMemo(() => {
    if (!Object.values(columnFilters).some(Boolean)) {
      return items;
    }
    return items.filter((item) => {
      for (const [key, filterVal] of Object.entries(columnFilters)) {
        if (!filterVal) continue;
        const val = (item as unknown as Record<string, unknown>)[key];
        if (val == null) return false;
        if (String(val).toLowerCase() !== filterVal.toLowerCase()) {
          return false;
        }
      }
      return true;
    });
  }, [items, columnFilters]);

  const totalPages = Math.max(1, Math.ceil((total || 1) / limit));

  // Export URL
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      store_id: selectedStoreId,
      sort_field: sortField,
      sort_dir: sortDirection,
      sku_type: "all",
    });
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/accounting/financials/sku-win/export?${params.toString()}`;
  }, [
    selectedStoreId,
    sortField,
    sortDirection,
    startDate,
    endDate,
    debouncedSearch,
  ]);

  return (
    <div className="w-full space-y-2 font-sans">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-2xl transition-all ${toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
            }`}
        >
          {toast.type === "success" ? <CheckCircleIcon size={20} weight="bold" /> : <WarningCircleIcon size={20} weight="bold" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* TOOLBAR: Store, Date Range, Search, Zoom, Actions */}
      <div className="bg-slate-200/70 p-2 rounded-xl border border-slate-300 flex items-center justify-between gap-2 flex-wrap shadow-2xs shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Selector */}
          <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs hover:border-slate-400 transition-colors">
            <StorefrontIcon size={15} weight="bold" className="text-amber-600 mr-1.5 shrink-0" />
            <select
              id="skuwin-store-select"
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
                    {s.name} ({s.marketplace || "US"})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Amazon Standard Date Range Picker */}
          <PpcAmazonDatePicker
            value={dateRange}
            onChange={(newRange) => {
              setDateRange(newRange);
              if (selectedStoreId) {
                saveStoreDateRange("sku_win", selectedStoreId, newRange);
              }
              setPage(1);
            }}
            maxDate={financialMaxDate}
            align="left"
          />

          {/* Search */}
          <div className="relative w-36 sm:w-44 focus-within:!w-56 transition-all duration-200">
            <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm SKU, ASIN, Type..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white pl-7 pr-5 py-1 text-xs font-medium text-slate-800 placeholder-slate-400 outline-hidden transition focus:border-amber-500 shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <XIcon size={10} />
              </button>
            )}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden shadow-2xs">
            <button
              type="button"
              onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
              className="px-1.5 py-1 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Thu nhỏ bảng (-10%)"
            >
              <MinusIcon size={11} weight="bold" />
            </button>
            <span className="px-1.5 text-[11px] font-mono font-bold text-slate-700 select-none min-w-[36px] text-center">
              {tableZoom}%
            </span>
            <button
              type="button"
              onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
              className="px-1.5 py-1 text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Phóng to bảng (+10%)"
            >
              <PlusIcon size={11} weight="bold" />
            </button>
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div className="flex items-center gap-2">
          {/* Refresh */}
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            title="Tải lại bảng dữ liệu"
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
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
            title={`Cấu hình cột LỌC SKU WIN (${visibleColumns.length}/${columns.length})`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <SlidersHorizontalIcon size={14} className="text-slate-600" />
            <span>Tùy chỉnh cột</span>
          </button>

          {/* Export Excel */}
          <a
            href={exportUrl}
            download
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
            title="Xuất file Excel đúng chuẩn format LỌC SKU WIN"
          >
            <FileXlsIcon size={14} weight="bold" />
            <span>Xuất Excel</span>
          </a>
        </div>
      </div>

      {/* Active Column Filters Strip */}
      {Object.values(columnFilters).some(Boolean) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-1.5 text-xs shadow-2xs shrink-0">
          <span className="font-bold text-amber-900 inline-flex items-center gap-1">
            <FunnelIcon size={12} weight="fill" />
            Đang lọc:
          </span>
          {Object.entries(columnFilters).map(([field, val]) => {
            if (!val) return null;
            const col = columns.find((c) => c.id === field);
            return (
              <span
                key={field}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 font-medium text-slate-800 border border-amber-300 shadow-2xs"
              >
                <span className="text-slate-500 font-semibold">{col?.label || field}:</span>
                <span className="font-bold text-slate-900">{val}</span>
                <button
                  type="button"
                  onClick={() => setColumnFilters((prev) => ({ ...prev, [field]: "" }))}
                  className="ml-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                >
                  <XIcon size={11} weight="bold" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => setColumnFilters({})}
            className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer ml-1"
          >
            Xóa tất cả lọc
          </button>
        </div>
      )}

      {/* 3. DATA TABLE (EXCEL GRID CHUẨN GIAO DIỆN BẢNG MÃ CÓ ĐẦY ĐỦ CHỨC NĂNG, FIT CHIỀU CAO) */}
      <div className="rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-210px)] min-h-[520px] scrollbar-thin">
          <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
            <table className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <colgroup>
                {visibleColumns.map((column) => {
                  const configuredWidth = typeof column.width === "number"
                    ? column.width
                    : Number.parseInt(column.width || "", 10);
                  const width = column.id === "stt"
                    ? `${Math.max(configuredWidth || 55, 72)}px`
                    : typeof column.width === "number"
                      ? `${column.width}px`
                      : column.width || "110px";
                  return <col key={column.id} style={{ width }} />;
                })}
              </colgroup>

              {/* Header màu cam chuẩn Bảng Mã (#ff9900) với ColumnHeaderCell (drag, resize, auto-fit, context menu) */}
              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs tracking-[0.02em]">
                  {visibleColumns.map((col) => {
                    const f = getCellFreezeProps(col.id, true);
                    const isSorted = sortField === col.id;
                    const isKeyBoldCol = col.id === "stt" || col.id === "mockup" || col.id === "sku";
                    let displayColLabel = (col.label || "").replace(/\s*\(\$\)/g, "").trim();
                    if (col.id === "revenue" && (displayColLabel.toLowerCase() === "revenue" || !displayColLabel)) {
                      displayColLabel = "Revenue";
                    } else if (col.id === "quantity" && (displayColLabel.toLowerCase() === "quantity" || !displayColLabel)) {
                      displayColLabel = "Quantity";
                    }

                    return (
                      <ColumnHeaderCell
                        key={col.id}
                        col={col}
                        isFrozen={f.isFrozen}
                        isBoundary={f.isBoundary}
                        style={f.style}
                        className={`py-1.5 px-2 text-xs bg-[#ff9900] text-slate-950 select-none ${isKeyBoldCol ? "font-bold text-slate-950" : "font-normal text-slate-900"
                          } ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}
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
                        onColumnClick={(id, e) => {
                          setColumnContextMenu({
                            field: id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <div
                          className={`flex items-center w-full min-h-[30px] relative group/title px-0.5 ${col.align === "center" ? "justify-center" : col.align === "right" ? "justify-end" : "justify-start"
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(col.id)}
                            className="inline-flex items-center gap-1 hover:underline cursor-pointer truncate"
                            title={`Bấm để sắp xếp theo ${displayColLabel}`}
                          >
                            <span className="truncate">{displayColLabel}</span>
                            {isSorted ? (
                              sortDirection === "asc" ? (
                                <CaretUpIcon size={12} weight="bold" className="shrink-0 text-slate-950" />
                              ) : (
                                <CaretDownIcon size={12} weight="bold" className="shrink-0 text-slate-950" />
                              )
                            ) : null}
                          </button>
                          {columnFilters[col.id] && (
                            <span
                              title={`Đang lọc: ${columnFilters[col.id]}`}
                              className="ml-1 inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-slate-900 text-white shrink-0 text-[9px]"
                            >
                              <FunnelIcon size={8} weight="fill" />
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setColumnContextMenu({
                                field: col.id,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            className={`ml-1 p-0.5 rounded text-slate-900 transition cursor-pointer shrink-0 ${columnFilters[col.id]
                                ? "opacity-100 bg-amber-600/30"
                                : "opacity-0 group-hover/title:opacity-100 hover:bg-amber-600/40"
                              }`}
                            title={`Tùy chọn, Lọc & Setting cột "${col.label}"`}
                          >
                            <SlidersHorizontalIcon size={11} weight="bold" />
                          </button>
                        </div>
                      </ColumnHeaderCell>
                    );
                  })}
                </tr>

                {/* ROW 2: TOTAL / SUM ROW ĐỨNG NGAY TRÊN ĐẦU MỖI CỘT TƯƠNG ỨNG */}
                {stats && (
                  <tr className="bg-[#fffbeb] text-slate-900 border-b border-amber-300 text-xs select-none shadow-2xs">
                    {visibleColumns.map((col) => {
                      const f = getCellFreezeProps(col.id, true);
                      const isKeyBoldCol = col.id === "stt" || col.id === "mockup" || col.id === "sku";
                      const isProfitCol = col.id === "profit";
                      const bgStyle = f.isFrozen ? { backgroundColor: "#fffbeb" } : {};

                      return (
                        <td
                          key={`total-${col.id}`}
                          style={{ ...f.style, ...bgStyle }}
                          className={`py-1.5 px-2.5 text-xs border-b border-amber-300 whitespace-nowrap ${
                            f.isBoundary
                              ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                              : "border-r border-amber-200/80"
                          } ${
                            isKeyBoldCol ? "font-bold text-slate-950" : "font-semibold"
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
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                          {col.id === "mockup" && null}
                          {col.id === "sku" && (
                            <span className="font-black text-slate-950 text-xs">
                              {stats.totalSkus.toLocaleString()} SKUs
                            </span>
                          )}
                          {col.id === "asin" && (
                            <span className="text-slate-400 text-[11px]">—</span>
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
                          {col.id === "basecost_per_item" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatCurrency(stats.totalQuantity > 0 ? stats.totalBasecost / stats.totalQuantity : 0)}
                            </span>
                          )}
                          {col.id === "tacos" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatPercent(stats.avgTacos)}
                            </span>
                          )}
                          {col.id === "acos" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatPercent(stats.totalRevenueAds > 0 ? stats.totalAdsFee / stats.totalRevenueAds : 0)}
                            </span>
                          )}
                          {col.id === "margin" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatPercent(stats.avgMargin)}
                            </span>
                          )}
                          {col.id === "roi" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatPercent(stats.avgRoi)}
                            </span>
                          )}
                          {col.id === "revenue_ads" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatCurrency(stats.totalRevenueAds)}
                            </span>
                          )}
                          {col.id === "return_rate" && (
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {formatPercent(stats.totalQuantity > 0 ? stats.totalReturnCost / stats.totalQuantity : 0)}
                            </span>
                          )}
                          {col.id !== "stt" &&
                            col.id !== "product_type" &&
                            col.id !== "mockup" &&
                            col.id !== "sku" &&
                            col.id !== "asin" &&
                            col.id !== "revenue" &&
                            col.id !== "quantity" &&
                            col.id !== "ads_fee" &&
                            col.id !== "basecost" &&
                            col.id !== "amazon_fee" &&
                            col.id !== "thue" &&
                            col.id !== "promotion" &&
                            col.id !== "return_cost" &&
                            col.id !== "profit" &&
                            col.id !== "profit_per_item" &&
                            col.id !== "basecost_per_item" &&
                            col.id !== "tacos" &&
                            col.id !== "acos" &&
                            col.id !== "margin" &&
                            col.id !== "roi" &&
                            col.id !== "revenue_ads" &&
                            col.id !== "return_rate" && (
                              <span className="text-slate-400 text-[11px]">—</span>
                            )}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </thead>

              {/* Body */}
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-24 text-center text-slate-500 font-bold text-sm">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-amber-600" />
                      Đang tải dữ liệu Lọc SKU Win của Store {selectedStore?.name}...
                    </td>
                  </tr>
                ) : displayItems.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-24 text-center text-slate-500 text-sm">
                      <PackageIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Không tìm thấy SKU nào phù hợp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  displayItems.map((item, idx) => {
                    const stt = (page - 1) * limit + idx + 1;
                    const isEven = idx % 2 === 0;

                    return (
                      <tr
                        key={item.id}
                        className={`h-[36px] hover:bg-amber-50/70 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200 ${isEven ? "bg-white" : "bg-[#f8fafc]"
                          }`}
                      >
                        {visibleColumns.map((col) => {
                          const f = getCellFreezeProps(col.id, false);
                          const isKeyBoldCol = col.id === "stt" || col.id === "mockup" || col.id === "sku";
                          const isProfitCol = col.id === "profit";
                          const bgStyle = f.isFrozen ? { backgroundColor: isEven ? "#ffffff" : "#f8fafc" } : {};

                          return (
                            <td
                              key={col.id}
                              style={{ ...f.style, ...bgStyle }}
                              className={`py-1.5 px-2.5 text-xs text-slate-900 border-b border-slate-200 transition-colors ${
                                f.isBoundary
                                  ? "border-r-2 border-r-slate-300 shadow-[3px_0_6px_-2px_rgba(0,0,0,0.08)]"
                                  : "border-r border-slate-200"
                              } ${isKeyBoldCol ? "font-bold text-slate-950" : "font-normal"
                                } ${col.align === "center"
                                  ? "text-center"
                                  : col.align === "right"
                                    ? "text-right font-mono"
                                    : "text-left"
                                }`}
                            >
                              {/* STT + Edit */}
                              {col.id === "stt" && (
                                <div className="flex items-center justify-center gap-1">
                                  <span className="text-slate-500">{stt}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenTargetModal(item)}
                                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-amber-100 hover:text-amber-800 transition cursor-pointer"
                                    title="Cài đặt mục tiêu / Giá bán SKU"
                                  >
                                    <PencilSimpleIcon size={12} weight="bold" />
                                  </button>
                                </div>
                              )}

                              {/* Product Type */}
                              {col.id === "product_type" && (
                                <span className="font-normal text-slate-800">{item.product_type || "—"}</span>
                              )}

                              {/* Image / Mockup */}
                              {col.id === "mockup" && (
                                <div className="flex justify-center items-center">
                                  {item.mockup_url || item.mockup ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreviewImage({
                                          url: item.mockup_url || item.mockup || "",
                                          title: `${item.sku} - ${item.product_type}`,
                                        })
                                      }
                                      className="h-7 w-7 rounded-md border border-slate-200 overflow-hidden bg-slate-100 hover:ring-2 hover:ring-amber-500 transition cursor-pointer"
                                      title="Nhấn để xem ảnh phóng to"
                                    >
                                      <img
                                        src={item.mockup_url || item.mockup || ""}
                                        alt={item.sku}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    </button>
                                  ) : (
                                    <div className="h-7 w-7 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                                      <PackageIcon size={14} />
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* SKU */}
                              {col.id === "sku" && (
                                <div className="flex items-center gap-1.5 font-bold text-slate-900 font-mono">
                                  <span className="truncate max-w-[140px]" title={item.sku}>
                                    {item.sku}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopySku(item.sku)}
                                    className="text-slate-400 hover:text-slate-700 transition cursor-pointer"
                                    title="Copy SKU"
                                  >
                                    {copiedSku === item.sku ? (
                                      <CheckIcon size={13} className="text-emerald-600 font-bold" />
                                    ) : (
                                      <CopyIcon size={13} />
                                    )}
                                  </button>
                                </div>
                              )}

                              {/* ASIN */}
                              {col.id === "asin" && (
                                <div className="flex items-center justify-center gap-1">
                                  {item.asin ? (
                                    <a
                                      href={`https://www.amazon.com/dp/${item.asin}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5 font-mono text-[11px] font-semibold"
                                      title={`Xem ASIN ${item.asin} trên Amazon`}
                                    >
                                      <span>{item.asin}</span>
                                      <ArrowSquareOutIcon size={12} />
                                    </a>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </div>
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

                              {/* Basecost */}
                              {col.id === "basecost" && (
                                <span className="font-normal text-slate-900 tabular-nums">
                                  {formatCurrency(item.basecost)}
                                </span>
                              )}

                              {/* Amazon Fee - màu bình thường */}
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

                              {/* Return */}
                              {col.id === "return_cost" && (
                                <span className="font-normal text-slate-900 tabular-nums">
                                  {formatCurrency(item.return_cost)}
                                </span>
                              )}

                              {/* Profit - màu xanh khi dương, màu đỏ khi âm */}
                              {isProfitCol && (
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

                              {/* Profit / item - màu xanh khi dương, màu đỏ khi âm */}
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

                              {/* Advanced ratio columns */}
                              {col.id === "basecost_per_item" && (
                                <span className="tabular-nums text-slate-700">{formatCurrency(item.basecost_per_item)}</span>
                              )}
                              {col.id === "tacos" && (
                                <span className={`tabular-nums ${item.tacos > 0.2 ? "text-rose-600 font-bold" : "text-slate-700"}`}>
                                  {formatPercent(item.tacos)}
                                </span>
                              )}
                              {col.id === "acos" && (
                                <span className={`tabular-nums ${item.acos > 0.35 ? "text-rose-600 font-bold" : "text-slate-700"}`}>
                                  {formatPercent(item.acos)}
                                </span>
                              )}
                              {col.id === "margin" && (
                                <span className={`tabular-nums font-semibold ${item.margin > 0.15 ? "text-emerald-700" : "text-slate-700"}`}>
                                  {formatPercent(item.margin)}
                                </span>
                              )}
                              {col.id === "roi" && (
                                <span className={`tabular-nums font-semibold ${item.roi > 0.3 ? "text-emerald-700" : "text-slate-700"}`}>
                                  {formatPercent(item.roi)}
                                </span>
                              )}
                              {col.id === "revenue_ads" && (
                                <span className="tabular-nums text-slate-700">{formatCurrency(item.revenue_ads)}</span>
                              )}
                              {col.id === "all_time_quantity" && (
                                <span className="tabular-nums text-slate-700">{formatInteger(item.all_time_quantity)}</span>
                              )}
                              {col.id === "return_rate" && (
                                <span className="tabular-nums text-slate-700">{formatPercent(item.return_rate)}</span>
                              )}
                              {col.id === "shipped_qty" && (
                                <span className="tabular-nums text-slate-700">{formatInteger(item.shipped_qty)}</span>
                              )}

                              {/* Target columns */}
                              {col.id === "revenue_target" && (
                                <span className="text-slate-600 tabular-nums">
                                  {item.revenue_target != null ? formatCurrency(item.revenue_target) : "—"}
                                </span>
                              )}
                              {col.id === "unit_target" && (
                                <span className="text-slate-600 tabular-nums">
                                  {item.unit_target != null ? formatInteger(item.unit_target) : "—"}
                                </span>
                              )}
                              {col.id === "spend_target" && (
                                <span className="text-slate-600 tabular-nums">
                                  {item.spend_target != null ? formatCurrency(item.spend_target) : "—"}
                                </span>
                              )}
                              {col.id === "profit_target" && (
                                <span className="text-slate-600 tabular-nums">
                                  {item.profit_target != null ? formatCurrency(item.profit_target) : "—"}
                                </span>
                              )}

                              {/* Metadata columns */}
                              {col.id === "brand" && <span>{item.brand || "—"}</span>}
                              {col.id === "status" && (
                                <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                                  {item.status || "Active"}
                                </span>
                              )}
                              {col.id === "niche" && <span>{item.niche || "—"}</span>}
                              {col.id === "pic_mkt" && <span>{item.pic_mkt || "—"}</span>}
                              {col.id === "custom_price" && (
                                <span className="text-slate-700 font-medium tabular-nums">
                                  {item.custom_price != null ? formatCurrency(item.custom_price) : "—"}
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

        {/* Bottom Pagination flush with table container border (chuẩn Bảng Mã) */}
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={total}
          limit={limit}
          onPageChange={(p) => setPage(p)}
          onLimitChange={(l) => {
            setLimit(l);
            setPage(1);
          }}
          label="SKU"
        />
      </div>

      {/* COLUMN CONTEXT MENU (BẢNG MÃ STANDARD) */}
      {columnContextMenu && (() => {
        const field = columnContextMenu.field;
        const col = columns.find((c) => c.id === field);
        const colLabel = col?.label || field;
        const isCurrentBoundary = frozenThrough === field;
        const options = getColumnOptions(field);

        return (
          <div
            ref={columnMenuRef}
            className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.min(columnContextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
              top: Math.min(columnContextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 220),
            }}
          >
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tùy chọn cột</span>
              <span className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{colLabel}</span>
            </div>

            <div className="p-1 space-y-0.5">
              {/* Thu nhỏ cột này */}
              <button
                type="button"
                onClick={() => {
                  handleAutoFitColumn(field);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <SlidersHorizontalIcon size={14} className="text-amber-600 shrink-0" />
                <span>Thu nhỏ cột</span>
              </button>

              {/* Setting cột - Mở modal cấu hình cho riêng cột này (theo đúng chuẩn Bảng Mã) */}
              <button
                type="button"
                onClick={() => {
                  const targetCol = columns.find((c) => c.id === field);
                  setFieldEditor({
                    field_id: field,
                    label: targetCol?.label || field,
                    options: targetCol?.options || getColumnOptions(field),
                    allow_custom_value: targetCol?.allow_custom_value ?? true,
                  });
                  setNewFieldOption("");
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <PencilSimpleIcon size={14} className="text-slate-500 shrink-0" />
                <span>Setting cột</span>
              </button>

              {/* Khóa đến cột này / Bỏ khóa */}
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
                  <span>Về khóa mặc định (SKU)</span>
                </button>
              )}

              {/* Ẩn cột này */}
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
                    setColumnFilters((prev) => ({
                      ...prev,
                      [field]: event.target.value,
                    }));
                    setColumnContextMenu(null);
                  }}
                  className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="">Tất cả</option>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })()}

      {/* 4. TARGET & PRICE EDIT MODAL */}
      {targetModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <TargetIcon size={16} className="text-amber-600" weight="bold" />
                  <span>Cài đặt Mục tiêu & Giá SKU</span>
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{targetModalItem.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setTargetModalItem(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <XIcon size={16} weight="bold" />
              </button>
            </div>

            <form onSubmit={handleSaveTarget} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Giá niêm yết Bảng Mã
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={targetForm.price}
                  onChange={(e) => setTargetForm({ ...targetForm, price: e.target.value })}
                  placeholder="Mặc định lấy từ đơn hàng"
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  Dùng để tính Amazon Fee (15% x giá) và Thuế (1.5% x giá)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Revenue mục tiêu</label>
                  <input
                    type="number"
                    step="0.01"
                    value={targetForm.revenue_target}
                    onChange={(e) => setTargetForm({ ...targetForm, revenue_target: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Unit mục tiêu</label>
                  <input
                    type="number"
                    value={targetForm.unit_target}
                    onChange={(e) => setTargetForm({ ...targetForm, unit_target: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Spend Ads mục tiêu</label>
                  <input
                    type="number"
                    step="0.01"
                    value={targetForm.spend_target}
                    onChange={(e) => setTargetForm({ ...targetForm, spend_target: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Profit mục tiêu</label>
                  <input
                    type="number"
                    step="0.01"
                    value={targetForm.profit_target}
                    onChange={(e) => setTargetForm({ ...targetForm, profit_target: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTargetModalItem(null)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingTarget}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-xs font-bold text-white shadow-xs cursor-pointer transition disabled:opacity-50"
                >
                  {savingTarget ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. IMAGE PREVIEW MODAL */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="max-h-[90vh] max-w-[90vw] rounded-2xl bg-white p-3 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-900">{previewImage.title}</span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <XIcon size={18} weight="bold" />
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={previewImage.title}
              className="max-h-[75vh] max-w-[80vw] object-contain rounded-lg mx-auto"
            />
          </div>
        </div>
      )}

      {/* 6. MODAL CẤU HÌNH RIÊNG 1 CỘT (FIELD EDITOR MODAL) */}
      {fieldEditor && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 animate-in fade-in duration-150"
          onClick={() => setFieldEditor(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-sm font-black text-slate-900">Cấu hình cột</p>
                <p className="text-xs text-slate-500 font-mono">{fieldEditor.field_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setFieldEditor(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <XIcon size={18} weight="bold" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              <label className="block font-bold text-slate-700">
                Tên cột
                <input
                  value={fieldEditor.label}
                  onChange={(e) => setFieldEditor({ ...fieldEditor, label: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-medium focus:border-indigo-500 focus:outline-hidden"
                />
              </label>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-700">
                    Giá trị lựa chọn ({fieldEditor.options.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const rowVals = scanOptionsFromRows(fieldEditor.field_id);
                      const merged = [...new Set([...fieldEditor.options, ...rowVals])];
                      const added = merged.length - fieldEditor.options.length;
                      setFieldEditor({ ...fieldEditor, options: merged });
                      if (added > 0) {
                        notify(`Đã quét thêm ${added} giá trị mới từ bảng!`);
                      } else {
                        notify("Không có thêm giá trị mới nào trong bảng");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                    title="Tự động quét tất cả các dòng trong bảng để lấy giá trị hiện có"
                  >
                    <ArrowClockwiseIcon size={12} weight="bold" />
                    <span>Quét giá trị từ bảng</span>
                  </button>
                </div>

                {fieldEditor.options.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
                    Chưa có giá trị nào. Bạn có thể bấm <strong>&quot;Quét giá trị từ bảng&quot;</strong> hoặc nhập giá trị mới bên dưới.
                  </div>
                ) : (
                  <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {fieldEditor.options.map((option, index) => (
                      <div key={`${option}-${index}`} className="flex gap-2 items-center">
                        <input
                          value={option}
                          onChange={(e) =>
                            setFieldEditor({
                              ...fieldEditor,
                              options: fieldEditor.options.map((item, i) => (i === index ? e.target.value : item)),
                            })
                          }
                          className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:border-indigo-500 focus:outline-hidden"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFieldEditor({
                              ...fieldEditor,
                              options: fieldEditor.options.filter((_, i) => i !== index),
                            })
                          }
                          className="text-xs font-semibold text-rose-600 hover:text-rose-800 px-2 py-1 cursor-pointer"
                        >
                          Xóa
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  value={newFieldOption}
                  onChange={(e) => setNewFieldOption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const val = newFieldOption.trim();
                      if (!val || val === "0" || val === "-") {
                        notify("Giá trị không hợp lệ hoặc bằng 0", "error");
                        return;
                      }
                      if (!fieldEditor.options.includes(val)) {
                        setFieldEditor({ ...fieldEditor, options: [...fieldEditor.options, val] });
                      }
                      setNewFieldOption("");
                    }
                  }}
                  placeholder="Thêm giá trị mới..."
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-hidden font-medium"
                />
                <button
                  type="button"
                  onClick={() => {
                    const val = newFieldOption.trim();
                    if (!val || val === "0" || val === "-") {
                      notify("Giá trị không hợp lệ hoặc bằng 0", "error");
                      return;
                    }
                    if (!fieldEditor.options.includes(val)) {
                      setFieldEditor({ ...fieldEditor, options: [...fieldEditor.options, val] });
                    }
                    setNewFieldOption("");
                  }}
                  className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3.5 py-2 font-bold text-slate-700 transition cursor-pointer"
                >
                  Thêm
                </button>
              </div>

              <label className="flex items-center gap-2 font-semibold text-slate-700 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={fieldEditor.allow_custom_value}
                  onChange={(e) => setFieldEditor({ ...fieldEditor, allow_custom_value: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Cho phép nhập giá trị khác</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 bg-slate-50">
              <button
                type="button"
                onClick={() => setFieldEditor(null)}
                className="rounded-lg px-4 py-2 font-bold text-slate-600 hover:bg-slate-200 transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={saveFieldEditor}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-5 py-2 font-bold text-white transition shadow-xs cursor-pointer"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. COLUMN MANAGER MODAL */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title="LỌC SKU WIN"
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />
    </div>
  );
}
