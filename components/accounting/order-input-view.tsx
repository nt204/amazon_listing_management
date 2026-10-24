"use client";

import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import dynamic from "next/dynamic";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInLineHorizontalIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  DotsSixVerticalIcon,
  DownloadSimpleIcon,
  EyeSlashIcon,
  FileTextIcon,
  FileXlsIcon,
  FunnelIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PackageIcon,
  PencilSimpleIcon,
  GearIcon,
  PlusIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  TrendUpIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { OrderItem, OrderStats } from "@/lib/accounting/orders-db";
import type { Store } from "@/lib/accounting/types";
import {
  type ColumnConfig,
  DEFAULT_ORDER_INPUT_COLUMNS,
  ColumnHeaderCell,
  ColumnManagerModal,
  createTextWidthMeasurer,
} from "./column-manager-modal";
import type { ReturnStats } from "@/lib/accounting/returns-db";
import type { ServiceFeeStats } from "@/lib/accounting/service-fees-db";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";

const ImportTabLoading = () => (
  <div className="grid min-h-[420px] place-items-center rounded-xl border border-slate-200 bg-white" role="status">
    <div className="text-center">
      <div className="mx-auto h-7 w-7 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
      <p className="mt-2 text-xs font-bold text-slate-500">Đang tải bảng dữ liệu…</p>
    </div>
  </div>
);
const AdsInputView = dynamic(
  () => import("./ads-input-view").then((module) => module.AdsInputView),
  { loading: ImportTabLoading },
);
const ReturnInputView = dynamic(
  () => import("./return-input-view").then((module) => module.ReturnInputView),
  { loading: ImportTabLoading },
);
const ServiceFeeInputView = dynamic(
  () => import("./service-fee-input-view").then((module) => module.ServiceFeeInputView),
  { loading: ImportTabLoading },
);

const ORDER_COLUMNS_STORAGE_KEY = "acc_order_input_columns_global";
const ORDER_FROZEN_STORAGE_KEY = "acc_order_input_frozen_global";

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

function getAmazonLatestAvailableDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type ImportTab = "orders" | "ads" | "return" | "service_fee";

export function OrderInputView() {
  const [activeTab, setActiveTab] = useState<ImportTab>(() => {
    if (typeof window !== "undefined") {
      const saved = window.sessionStorage.getItem("accounting_import_active_tab") as ImportTab;
      if (saved && ["orders", "ads", "return", "service_fee"].includes(saved)) {
        return saved;
      }
    }
    return "orders";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("accounting_import_active_tab", activeTab);
    }
  }, [activeTab]);

  // Keep visited tabs in DOM with CSS hidden for instant 0ms tab switching
  const [visitedTabs, setVisitedTabs] = useState<Record<ImportTab, boolean>>(() => ({
    orders: activeTab === "orders",
    ads: activeTab === "ads",
    return: activeTab === "return",
    service_fee: activeTab === "service_fee",
  }));

  const handleTabChange = useCallback((tab: ImportTab) => {
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    startTransition(() => {
      setActiveTab(tab);
    });
  }, []);

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "";
    }
    return "";
  });
  const [loadingStores, setLoadingStores] = useState(true);

  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [stats, setStats] = useState<OrderStats>({
    totalOrders: 0,
    totalUnits: 0,
    totalRevenue: 0,
    pendingCount: 0,
    shippedCount: 0,
    canceledCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [totalAds, setTotalAds] = useState(0);
  const [totalReturns, setTotalReturns] = useState(0);
  const [totalServiceFees, setTotalServiceFees] = useState(0);

  useEffect(() => {
    if (!selectedStoreId) return;
    fetch(`/api/accounting/ads?store_id=${selectedStoreId}&limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.total === "number") setTotalAds(d.total);
      })
      .catch(() => {});

    fetch(`/api/accounting/returns?store_id=${selectedStoreId}&limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.totalRows === "number") setTotalReturns(d.totalRows);
      })
      .catch(() => {});

    fetch(`/api/accounting/service-fees?store_id=${selectedStoreId}&limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.totalRows === "number") setTotalServiceFees(d.totalRows);
      })
      .catch(() => {});
  }, [selectedStoreId]);

  // Pagination & Filtering (Luôn mặc định 50 bản ghi khi vào lại để tránh lag)
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("acc_order_input_limit");
      } catch {}
    }
    return 50;
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateSort, setDateSort] = useState<"asc" | "desc">("desc");

  // Amazon reports are complete through yesterday; keep all 4 tabs on the same range.
  const importMaxDate = getAmazonLatestAvailableDate();
  const [importDateRange, setImportDateRange] = useState<DateRange>({
    startDate: "",
    endDate: "",
  });
  const handleDateRangeChange = (newRange: DateRange) => {
    setImportDateRange(newRange);
    setPage(1);
  };
  const orderStartDate = importDateRange.startDate;
  const orderEndDate = importDateRange.endDate;
  const setOrderStartDate = (d: string) => setImportDateRange((prev) => ({ ...prev, startDate: d }));
  const setOrderEndDate = (d: string) => setImportDateRange((prev) => ({ ...prev, endDate: d }));
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [tableZoom, setTableZoom] = useState(90);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const notify = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast((prev) => (prev?.message === message ? null : prev)), 30_000);
  }, []);

  // Columns & Freezing
  const [columns, setColumns] = useState<ColumnConfig[]>(DEFAULT_ORDER_INPUT_COLUMNS);
  const [frozenThrough, setFrozenThrough] = useState<string>("amazon_order_id");
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Ads Tab State & Action Signals
  const [adsSearch, setAdsSearch] = useState("");
  const [adsDateSort, setAdsDateSort] = useState<"asc" | "desc">("desc");
  const adsStartDate = importDateRange.startDate;
  const adsEndDate = importDateRange.endDate;
  const setAdsStartDate = (d: string) => setImportDateRange((prev) => ({ ...prev, startDate: d }));
  const setAdsEndDate = (d: string) => setImportDateRange((prev) => ({ ...prev, endDate: d }));
  const [adsStats, setAdsStats] = useState({
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
  const [showAdsImportModal, setShowAdsImportModal] = useState(false);
  const [showAdsColumnModal, setShowAdsColumnModal] = useState(false);
  const [resetAdsColumnsSignal, setResetAdsColumnsSignal] = useState(0);
  const [autoFitAdsColumnsSignal, setAutoFitAdsColumnsSignal] = useState(0);
  const [reloadAdsSignal, setReloadAdsSignal] = useState(0);

  // Return Tab State & Action Signals
  const [returnSearch, setReturnSearch] = useState("");
  const [returnDateSort, setReturnDateSort] = useState<"asc" | "desc">("desc");
  const returnStartDate = importDateRange.startDate;
  const returnEndDate = importDateRange.endDate;
  const setReturnStartDate = (d: string) => setImportDateRange((prev) => ({ ...prev, startDate: d }));
  const setReturnEndDate = (d: string) => setImportDateRange((prev) => ({ ...prev, endDate: d }));
  const [returnStats, setReturnStats] = useState<ReturnStats>({
    totalRows: 0,
    totalAmount: 0,
    totalProductCharges: 0,
    totalPromotionalRebates: 0,
    totalAmazonFees: 0,
    totalOther: 0,
    totalBasecost: 0,
    totalReturnSauBasecost: 0,
    uniqueOrders: 0,
    uniqueSkus: 0,
  });
  const [showReturnImportModal, setShowReturnImportModal] = useState(false);
  const [showReturnColumnModal, setShowReturnColumnModal] = useState(false);
  const [resetReturnColumnsSignal, setResetReturnColumnsSignal] = useState(0);
  const [reloadReturnSignal, setReloadReturnSignal] = useState(0);

  // Service Fee Tab State & Action Signals
  const [serviceFeeSearch, setServiceFeeSearch] = useState("");
  const [serviceFeeDateSort, setServiceFeeDateSort] = useState<"asc" | "desc">("desc");
  const serviceFeeStartDate = importDateRange.startDate;
  const serviceFeeEndDate = importDateRange.endDate;
  const setServiceFeeStartDate = (d: string) => setImportDateRange((prev) => ({ ...prev, startDate: d }));
  const setServiceFeeEndDate = (d: string) => setImportDateRange((prev) => ({ ...prev, endDate: d }));
  const [serviceFeeStats, setServiceFeeStats] = useState<ServiceFeeStats>({
    totalRows: 0,
    totalAmount: 0,
    totalProductCharges: 0,
    totalPromotionalRebates: 0,
    totalAmazonFees: 0,
    totalOther: 0,
    uniqueFeeTypes: 0,
    uniqueOrders: 0,
  });
  const [showServiceFeeImportModal, setShowServiceFeeImportModal] = useState(false);
  const [showServiceFeeColumnModal, setShowServiceFeeColumnModal] = useState(false);
  const [resetServiceFeeColumnsSignal, setResetServiceFeeColumnsSignal] = useState(0);
  const [reloadServiceFeeSignal, setReloadServiceFeeSignal] = useState(0);

  // Context Menu
  const [columnContextMenu, setColumnContextMenu] = useState<{
    field: string;
    x: number;
    y: number;
  } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Field Editor Modal state (Single Column Setting)
  const [fieldEditor, setFieldEditor] = useState<{
    field_id: string;
    label: string;
    options: string[];
    allow_custom_value: boolean;
  } | null>(null);
  const [newFieldOption, setNewFieldOption] = useState("");

  // Drag & drop columns
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Load stores once
  useEffect(() => {
    let isMounted = true;
    async function loadStores() {
      try {
        setLoadingStores(true);
        const res = await fetch("/api/accounting/stores");
        if (!res.ok) throw new Error("Failed to load stores");
        const data = await res.json();
        const list: Store[] = data.stores || [];
        if (!isMounted) return;
        setStores(list);
        if (list.length > 0) {
          const savedStore = localStorage.getItem("acc_selected_store_id");
          if (savedStore && list.some((s) => s.id === savedStore)) {
            setSelectedStoreId((curr) => curr || savedStore);
          } else {
            const limima = list.find((s) => s.name.toLowerCase() === "limima");
            const targetId = limima ? limima.id : list[0].id;
            setSelectedStoreId((curr) => curr || targetId);
          }
        }
      } catch (err: any) {
        if (isMounted) notify("Lỗi khi tải danh sách Store: " + err.message, "error");
      } finally {
        if (isMounted) setLoadingStores(false);
      }
    }
    loadStores();
    return () => {
      isMounted = false;
    };
  }, [notify]);

  // Load column configurations from localStorage (đồng bộ tất cả store), preserving all default columns
  useEffect(() => {
    try {
      const savedCols = localStorage.getItem(ORDER_COLUMNS_STORAGE_KEY);
      if (savedCols) {
        const parsed: ColumnConfig[] = JSON.parse(savedCols);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const defaultMap = new Map(DEFAULT_ORDER_INPUT_COLUMNS.map((c) => [c.id, c]));
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

          // Append any missing default columns
          for (const def of DEFAULT_ORDER_INPUT_COLUMNS) {
            if (!seen.has(def.id)) {
              merged.push(def);
            }
          }

          setColumns(merged);
        }
      } else {
        setColumns(DEFAULT_ORDER_INPUT_COLUMNS);
      }

      const savedFrozen = localStorage.getItem(ORDER_FROZEN_STORAGE_KEY);
      if (savedFrozen) {
        setFrozenThrough(savedFrozen);
      } else {
        setFrozenThrough("amazon_order_id");
      }
    } catch {}
  }, [selectedStoreId]);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!selectedStoreId) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("store_id", selectedStoreId);
      params.set("page", String(page));
      params.set("limit", String(limit));
      params.set("dateSort", dateSort);
      if (orderStartDate) params.set("startDate", orderStartDate);
      if (orderEndDate) params.set("endDate", orderEndDate);
      if (debouncedSearch) params.set("search", debouncedSearch);

      for (const [key, val] of Object.entries(columnFilters)) {
        if (val) params.set(`filter_${key}`, val);
      }

      const res = await fetch(`/api/accounting/orders?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Máy chủ phản hồi mã ${res.status}`);
      }
      const data = await res.json();
      setOrders(data.orders || []);
      setTotalOrders(data.total || 0);
      if (data.stats) setStats(data.stats);
    } catch (err: any) {
      notify("Lỗi tải đơn hàng: " + err.message, "error");
    } finally {
      setLoading(false);
      setIsInitialLoad(false);
    }
  }, [selectedStoreId, page, limit, dateSort, orderStartDate, orderEndDate, debouncedSearch, columnFilters, notify]);

  const [syncingLatest, setSyncingLatest] = useState(false);

  // Reload tab: tự động nạp file mới nhất cho tất cả các store từ Cloudflare R2 / lưu trữ rồi refresh
  const handleReload = useCallback(async () => {
    try {
      setSyncingLatest(true);
      const res = await fetch("/api/accounting/files/sync-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "02_ALL_ORDERS" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        notify(data.message || "Đã nạp file Order mới nhất cho các Store!", "success");
      }
    } catch (e: any) {
      console.warn("Lỗi đồng bộ file order mới nhất:", e);
    } finally {
      setSyncingLatest(false);
      fetchOrders();
    }
  }, [fetchOrders, notify]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const handleImportCompleted = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type !== "success") return;
      void fetchOrders();
      setReloadAdsSignal((signal) => signal + 1);
      setReloadReturnSignal((signal) => signal + 1);
      setReloadServiceFeeSignal((signal) => signal + 1);
      setImportDateRange({ startDate: "", endDate: "" });
      setPage(1);
    };
    window.addEventListener("accounting-import-completed", handleImportCompleted);
    return () => window.removeEventListener("accounting-import-completed", handleImportCompleted);
  }, [fetchOrders]);

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

  const handleStoreChange = (id: string) => {
    setSelectedStoreId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("acc_selected_store_id", id);
      window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: id }));
    }
    setPage(1);
  };

  // Sync with store selection when changed from Inventory or other tabs
  useEffect(() => {
    const handleSyncStore = (e: any) => {
      const newStoreId = e.detail || (typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") : null);
      if (newStoreId && newStoreId !== selectedStoreId && stores.some((s) => s.id === newStoreId)) {
        setSelectedStoreId(newStoreId);
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

  // Visible and Frozen Columns Map
  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns]);

  const freezeMap = useMemo(() => {
    const boundaryIndex = visibleColumns.findIndex((c) => c.id === frozenThrough);
    let leftSum = 0;
    const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};

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
            freeze.isBoundary ? "border-r-2 !border-r-amber-900" : "border-r border-amber-600"
          }`
        : `bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] ${
            freeze.isBoundary ? "border-r-2 !border-r-slate-400" : "border-r border-slate-200"
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
          localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã đổi vị trí cột!", "success");
    },
    [notify]
  );

  // Resize column
  const handleResizeColumn = useCallback(
    (colId: string, width: number) => {
      setColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, width: Math.max(50, width) } : c));
        try {
          localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
    },
    []
  );

  // Tính toán độ rộng vừa khít nội dung thực tế và tiêu đề cột.
  const calculateAutoFitWidth = useCallback(
    (colId: string, label: string): number => {
      // Quét toàn bộ dữ liệu đang nạp để cột luôn bao trọn giá trị dài nhất.
      // Đo đúng pixel theo font hiển thị, thay vì nhân số ký tự. Cách nhân ký tự
      // thường thiếu độ rộng với mã Amazon có chữ số, dấu gạch nối và font-medium.
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;
      for (const item of orders) {
        const val = (item as any)[colId];
        if (val != null) {
          let str = "";
          if (typeof val === "number") {
            str = `$${val.toFixed(2)}`;
          } else {
            str = String(val).trim();
            if (colId.includes("date")) {
              str = str.replace("T", " ").replace("+00:00", "").trim();
            }
          }
          const measuredWidth = measureText(str);
          maxContentWidth = Math.max(maxContentWidth, measuredWidth);
        }
      }

      // px-2.5 ở ô + viền + khoảng an toàn để không kích hoạt text-ellipsis.
      const contentWidth = maxContentWidth > 0 ? Math.ceil(maxContentWidth + 30) : 0;

      // Chiều rộng tối thiểu để tiêu đề không bị cắt chữ quá nhỏ (cho phép ngắt dòng theo dấu gạch ngang)
      const labelWords = (label || colId).split(/[-_ ]+/).filter(Boolean);
      const longestWordLength = labelWords.length > 0 ? Math.max(...labelWords.map((w) => w.length)) : 5;
      const headerWidth = Math.round(longestWordLength * 8.2 + 26);

      const targetWidth = Math.max(contentWidth, headerWidth);

      return Math.max(54, targetWidth);
    },
    [orders]
  );

  // Auto-fit 1 cột cụ thể khi user nhấp đúp vào thanh phân cách hoặc chọn từ menu
  const handleAutoFitColumn = useCallback(
    (colId: string) => {
      setColumns((prev) => {
        const targetCol = prev.find((c) => c.id === colId);
        if (!targetCol) return prev;
        const snugWidth = calculateAutoFitWidth(colId, targetCol.label);
        const updated = prev.map((c) => (c.id === colId ? { ...c, width: snugWidth } : c));
        try {
          localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã thu nhỏ cột!", "success");
    },
    [calculateAutoFitWidth, notify]
  );

  // Auto-fit toàn bộ các cột hiển thị để vừa khít hoàn hảo nội dung
  const handleAutoFitAllColumns = useCallback(() => {
    setColumns((prev) => {
      const updated = prev.map((c) => {
        const snugWidth = calculateAutoFitWidth(c.id, c.label);
        return { ...c, width: snugWidth };
      });
      try {
        localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    notify("Đã thu nhỏ tất cả các cột!", "success");
  }, [calculateAutoFitWidth, notify]);

  // Save Column Manager modal changes
  const handleSaveColumns = useCallback(
    (newCols: ColumnConfig[]) => {
      setColumns(newCols);
      try {
        localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
      } catch {}
      notify("Đã lưu cấu hình cột cho tất cả Store!", "success");
    },
    [notify]
  );

  // Reset columns
  const handleResetColumns = useCallback(() => {
    setColumns(DEFAULT_ORDER_INPUT_COLUMNS);
    try {
      localStorage.removeItem(ORDER_COLUMNS_STORAGE_KEY);
      localStorage.removeItem(ORDER_FROZEN_STORAGE_KEY);
    } catch {}
    setFrozenThrough("amazon_order_id");
    notify("Đã đưa cấu hình cột về mặc định!", "success");
  }, [notify]);

  // Scan existing unique values from current loaded orders
  const scanOptionsFromRows = useCallback(
    (fieldId: string) => {
      const values = new Set<string>();
      for (const order of orders) {
        const rawVal = (order as any)[fieldId] ?? (order as any)?.raw_data?.[fieldId];
        if (rawVal != null) {
          const str = String(rawVal).trim();
          if (str && str !== "0" && str !== "-" && str !== "null" && str !== "undefined") {
            values.add(str);
          }
        }
      }
      return Array.from(values).sort((a, b) => a.localeCompare(b));
    },
    [orders]
  );

  // Get available filter options for a column
  const getColumnOptions = useCallback(
    (fieldId: string): string[] => {
      const col = columns.find((c) => c.id === fieldId);
      if (col?.options && col.options.length > 0) {
        return col.options;
      }
      return scanOptionsFromRows(fieldId);
    },
    [columns, scanOptionsFromRows]
  );

  // Set filter value for a column and reset to page 1
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

  // Clear all active filters
  const clearAllFilters = useCallback(() => {
    setColumnFilters({});
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  }, []);

  // Open single column setting modal
  const handleOpenFieldEditor = useCallback(
    (fieldId: string, currentLabel: string) => {
      const col = columns.find((c) => c.id === fieldId);
      const initialOptions = col?.options || [];
      setNewFieldOption("");
      setFieldEditor({
        field_id: fieldId,
        label: col?.label || currentLabel,
        options: initialOptions,
        allow_custom_value: col?.allow_custom_value ?? true,
      });
    },
    [columns]
  );

  // Save single column configuration
  const saveFieldEditor = useCallback(() => {
    if (!fieldEditor || !fieldEditor.label.trim()) return;
    const cleanedOptions = [
      ...new Set(
        fieldEditor.options
          .map((o) => o.trim())
          .filter((o) => o && o !== "0" && o !== "-" && o !== "null" && o !== "undefined")
      ),
    ];
    const updatedLabel = fieldEditor.label.trim();

    setColumns((prev) => {
      const next = prev.map((col) => {
        if (col.id === fieldEditor.field_id) {
          return {
            ...col,
            label: updatedLabel,
            options: cleanedOptions,
            allow_custom_value: fieldEditor.allow_custom_value,
          };
        }
        return col;
      });
      try {
        localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    setFieldEditor(null);
    notify(`Đã lưu cấu hình cột "${updatedLabel}"!`, "success");
  }, [fieldEditor, notify]);

  // Quick hide column
  const handleQuickHideColumn = useCallback(
    (colId: string) => {
      setColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(ORDER_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    },
    [notify]
  );

  // Set frozen boundary
  const handleSetFrozenColumn = useCallback(
    (colId: string) => {
      setFrozenThrough(colId);
      try {
        localStorage.setItem(ORDER_FROZEN_STORAGE_KEY, colId);
      } catch {}
      const colLabel = columns.find((c) => c.id === colId)?.label || colId;
      notify(`Đã khóa các cột đến "${colLabel}".`, "success");
    },
    [columns, notify]
  );

  const selectedStore = stores.find((s) => s.id === selectedStoreId);
  const totalPages = Math.max(1, Math.ceil(totalOrders / limit));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Cell renderer matching compact Inventory tab typography
  const renderCellContent = (item: OrderItem, colId: string, rowIndex: number) => {
    switch (colId) {
      case "stt":
        return <span className="text-[13px] text-slate-700 font-medium tabular-nums">{(page - 1) * limit + rowIndex + 1}</span>;
      case "date":
        return <span className="font-normal text-[13px] text-slate-900 whitespace-nowrap tabular-nums">{item.date || "—"}</span>;
      case "amazon_order_id":
        return (
          <span
            className="text-[13px] font-medium text-indigo-700 hover:underline cursor-pointer select-all"
            title="Click đúp để sao chép mã đơn"
          >
            {item.amazon_order_id}
          </span>
        );
      case "merchant_order_id":
        return <span className="text-[13px] text-slate-900 font-normal">{item.merchant_order_id || "—"}</span>;
      case "purchase_date":
        return (
          <span className="text-[13px] text-slate-900 whitespace-nowrap tabular-nums">
            {item.purchase_date ? item.purchase_date.replace("T", " ").replace("+00:00", "") : "—"}
          </span>
        );
      case "last_updated_date":
        return (
          <span className="text-[13px] text-slate-900 whitespace-nowrap tabular-nums">
            {item.last_updated_date ? item.last_updated_date.replace("T", " ").replace("+00:00", "") : "—"}
          </span>
        );
      case "order_status": {
        const s = (item.order_status || "").toLowerCase();
        const badgeColor =
          s === "shipped"
            ? "bg-emerald-100 text-emerald-950 border-emerald-300 font-medium"
            : s === "pending"
            ? "bg-amber-100 text-amber-950 border-amber-300 font-medium"
            : s === "canceled" || s === "cancelled"
            ? "bg-rose-100 text-rose-950 border-rose-300 font-medium"
            : "bg-slate-100 text-slate-900 border-slate-300 font-medium";
        return (
          <span className={`inline-block px-2 py-0.5 rounded text-xs border shadow-2xs ${badgeColor}`}>
            {item.order_status || "—"}
          </span>
        );
      }
      case "fulfillment_channel":
        return (
          <span
            className={`font-semibold text-[13px] ${
              item.fulfillment_channel === "Amazon" ? "text-indigo-800" : "text-amber-800"
            }`}
          >
            {item.fulfillment_channel || "—"}
          </span>
        );
      case "sales_channel":
        return <span className="text-slate-900 font-normal text-[13px]">{item.sales_channel || "—"}</span>;
      case "ship_service_level":
        return <span className="text-slate-800 text-[13px]">{item.ship_service_level || "—"}</span>;
      case "product_name":
        return (
          <span
            className="text-slate-900 text-[13px] truncate block select-text"
            title={item.product_name || ""}
          >
            {item.product_name || "—"}
          </span>
        );
      case "sku":
        return (
          <span className="font-medium text-slate-950 text-[13px] select-all" title={item.sku}>
            {item.sku || "—"}
          </span>
        );
      case "asin":
        return (
          <a
            href={`https://www.amazon.com/dp/${item.asin}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-indigo-700 hover:underline"
          >
            {item.asin || "—"}
          </a>
        );
      case "item_status":
        return <span className="text-[13px] font-normal text-slate-900">{item.item_status || "—"}</span>;
      case "quantity":
        return <span className="font-normal text-[13px] text-slate-950 tabular-nums">{item.quantity}</span>;
      case "currency":
        return <span className="text-xs text-slate-700 font-medium uppercase">{item.currency || "USD"}</span>;
      case "item_price":
        return (
          <span className="font-medium text-[13px] tabular-nums text-emerald-800">
            {item.item_price != null ? `$${item.item_price.toFixed(2)}` : "—"}
          </span>
        );
      case "item_tax":
        return (
          <span className="text-slate-900 text-[13px] tabular-nums">
            {item.item_tax != null ? `$${item.item_tax.toFixed(2)}` : "—"}
          </span>
        );
      case "shipping_price":
        return (
          <span className="text-slate-900 text-[13px] tabular-nums">
            {item.shipping_price != null ? `$${item.shipping_price.toFixed(2)}` : "—"}
          </span>
        );
      case "shipping_tax":
        return (
          <span className="text-slate-900 text-[13px] tabular-nums">
            {item.shipping_tax != null ? `$${item.shipping_tax.toFixed(2)}` : "—"}
          </span>
        );
      case "gift_wrap_price":
        return (
          <span className="text-slate-900 text-[13px] tabular-nums">
            {item.gift_wrap_price != null ? `$${item.gift_wrap_price.toFixed(2)}` : "—"}
          </span>
        );
      case "gift_wrap_tax":
        return (
          <span className="text-slate-900 text-[13px] tabular-nums">
            {item.gift_wrap_tax != null ? `$${item.gift_wrap_tax.toFixed(2)}` : "—"}
          </span>
        );
      case "item_promotion_discount":
        return (
          <span className="text-rose-700 font-normal text-[13px] tabular-nums">
            {item.item_promotion_discount != null ? `-$${Math.abs(item.item_promotion_discount).toFixed(2)}` : "—"}
          </span>
        );
      case "ship_promotion_discount":
        return (
          <span className="text-rose-700 font-normal text-[13px] tabular-nums">
            {item.ship_promotion_discount != null ? `-$${Math.abs(item.ship_promotion_discount).toFixed(2)}` : "—"}
          </span>
        );
      case "ship_city":
        return <span className="text-slate-900 text-[13px]">{item.ship_city || "—"}</span>;
      case "ship_state":
        return <span className="font-normal text-slate-900 text-[13px]">{item.ship_state || "—"}</span>;
      case "ship_postal_code":
        return <span className="text-slate-900 text-[13px] tabular-nums">{item.ship_postal_code || "—"}</span>;
      case "ship_country":
        return <span className="font-normal text-slate-900 text-[13px]">{item.ship_country || "—"}</span>;
      case "is_business_order":
        return item.is_business_order ? (
          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-950 border border-purple-300">
            B2B
          </span>
        ) : (
          <span className="text-slate-400 text-xs">No</span>
        );
      default: {
        const val = (item as any)[colId];
        return <span className="text-slate-900 text-[13px]">{val != null ? String(val) : "—"}</span>;
      }
    }
  };

  return (
    <div className="w-full space-y-3">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[100] flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-2xl transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          {toast.type === "success" ? <CheckCircleIcon size={20} /> : <WarningCircleIcon size={20} />}
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} className="rounded p-0.5 text-white/80 hover:bg-white/15 hover:text-white" aria-label="Đóng thông báo">
            <XIcon size={16} weight="bold" />
          </button>
        </div>
      )}

      {/* HEADER SECTION: Title, Store Selector & Action Buttons */}
      <div className="rounded-xl border border-slate-300 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Left: Title & Store Selector */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-black text-sm shadow-xs">
                <UploadSimpleIcon size={16} weight="bold" />
              </span>
              <div>
                <h1 className="text-base font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
                  Import
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="order-store-select"
                className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"
              >
                Store
              </label>
              <select
                id="order-store-select"
                value={selectedStoreId}
                onChange={(e) => handleStoreChange(e.target.value)}
                disabled={loadingStores || stores.length === 0}
                className="min-w-[200px] rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs outline-none transition hover:border-slate-400 hover:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed"
              >
                {loadingStores ? (
                  <option value="">Đang tải Store...</option>
                ) : stores.length === 0 ? (
                  <option value="">Chưa có Store</option>
                ) : (
                  stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-2 self-end lg:self-center flex-wrap">
            {activeTab === "orders" ? (
              <>
                {/* Import Button */}
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Tải lên file order (.txt, .tsv, .csv, .xlsx từ Amazon hoặc ketoan_limima)"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập File Order</span>
                </button>

                {/* Export Excel Button */}
                <a
                  href={`/api/accounting/orders/export?store_id=${selectedStoreId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel toàn bộ dữ liệu Đầu vào Order"
                >
                  <DownloadSimpleIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                {/* Reset to Excel default order */}
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Đặt lại đầy đủ tất cả các cột theo đúng thứ tự file Excel gốc"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  <span>Cột chuẩn Excel</span>
                </button>

                {/* Column Configuration Button - Icon Only */}
                <button
                  type="button"
                  onClick={() => setShowColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title={`Cài đặt cột ĐẦU VÀO ORDER (${visibleColumns.length}/${columns.length})`}
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                {/* Refresh - Icon Only */}
                <button
                  type="button"
                  onClick={handleReload}
                  disabled={loading || syncingLatest}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  title={syncingLatest ? "Đang nạp file Order mới nhất..." : "Làm mới: Tải lại dữ liệu và tự động nạp file Order mới nhất cho tất cả các Store"}
                >
                  <ArrowClockwiseIcon size={16} weight="bold" className={loading || syncingLatest ? "animate-spin text-indigo-600" : ""} />
                </button>
              </>
            ) : activeTab === "ads" ? (
              <>
                {/* Import Ads Button */}
                <button
                  type="button"
                  onClick={() => setShowAdsImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Tải lên file báo cáo chi phí Ads (File 05 từ Amazon hoặc ketoan_limima sheet ADS)"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập File Ads</span>
                </button>

                {/* Export Excel Button */}
                <a
                  href={`/api/accounting/ads/export?store_id=${selectedStoreId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel toàn bộ dữ liệu Chi phí Ads (chuẩn 31 cột kế toán)"
                >
                  <DownloadSimpleIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                {/* Reset to Excel default order */}
                <button
                  type="button"
                  onClick={() => setResetAdsColumnsSignal((s) => s + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Đặt lại đầy đủ tất cả các cột theo đúng thứ tự file Excel sheet ADS"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  <span>Cột chuẩn Excel</span>
                </button>

                {/* Column Configuration Button - Icon Only */}
                <button
                  type="button"
                  onClick={() => setShowAdsColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title="Cài đặt cột ADS"
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                {/* Refresh - Icon Only */}
                <button
                  type="button"
                  onClick={() => setReloadAdsSignal((s) => s + 1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Làm mới: Tải lại và đồng bộ file 05 Ads mới nhất cho các Store"
                >
                  <ArrowClockwiseIcon size={16} weight="bold" className="text-indigo-600" />
                </button>
              </>
            ) : activeTab === "return" ? (
              <>
                {/* Import Return Button */}
                <button
                  type="button"
                  onClick={() => setShowReturnImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Tải lên file báo cáo hoàn tiền Return (File 03 từ Amazon hoặc sheet RETURN từ ketoan_limima)"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập File Return</span>
                </button>

                {/* Export Excel Button */}
                <a
                  href={`/api/accounting/returns/export?store_id=${selectedStoreId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel toàn bộ dữ liệu Return & Hoàn tiền"
                >
                  <DownloadSimpleIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                {/* Reset to Excel default order */}
                <button
                  type="button"
                  onClick={() => setResetReturnColumnsSignal((s) => s + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Đặt lại đầy đủ tất cả các cột theo đúng thứ tự file Excel sheet RETURN"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  <span>Cột chuẩn Excel</span>
                </button>

                {/* Column Configuration Button - Icon Only */}
                <button
                  type="button"
                  onClick={() => setShowReturnColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title="Cài đặt cột RETURN"
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                {/* Refresh - Icon Only */}
                <button
                  type="button"
                  onClick={() => setReloadReturnSignal((s) => s + 1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Làm mới: Tải lại dữ liệu Return mới nhất cho Store"
                >
                  <ArrowClockwiseIcon size={16} weight="bold" className="text-indigo-600" />
                </button>
              </>
            ) : (
              <>
                {/* Import Service Fee Button */}
                <button
                  type="button"
                  onClick={() => setShowServiceFeeImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Tải lên file chi phí phụ sàn Amazon (File 04 từ Amazon hoặc sheet Service Fees từ ketoan_limima)"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập File Service Fee</span>
                </button>

                {/* Export Excel Button */}
                <a
                  href={`/api/accounting/service-fees/export?store_id=${selectedStoreId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel toàn bộ dữ liệu Service Fees"
                >
                  <DownloadSimpleIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                {/* Reset to Excel default order */}
                <button
                  type="button"
                  onClick={() => setResetServiceFeeColumnsSignal((s) => s + 1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Đặt lại đầy đủ tất cả các cột theo đúng thứ tự file Excel sheet Service Fees"
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  <span>Cột chuẩn Excel</span>
                </button>

                {/* Column Configuration Button - Icon Only */}
                <button
                  type="button"
                  onClick={() => setShowServiceFeeColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title="Cài đặt cột SERVICE FEE"
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                {/* Refresh - Icon Only */}
                <button
                  type="button"
                  onClick={() => setReloadServiceFeeSignal((s) => s + 1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Làm mới: Tải lại dữ liệu Service Fee mới nhất cho Store"
                >
                  <ArrowClockwiseIcon size={16} weight="bold" className="text-indigo-600" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* TABS, FILTERS & STATS UNIFIED BAR */}
      <div className="bg-slate-200/70 p-2 rounded-xl border border-slate-300 flex flex-col gap-1.5 shadow-2xs">
        {/* Row 1: Sheet Tabs */}
        <div className="flex items-center justify-start min-h-[34px] overflow-x-auto no-scrollbar">
          {/* Sheet Tabs */}
          <div className="flex items-center gap-1 shrink-0 overflow-x-auto no-scrollbar py-0.5">
            {/* Tab 1: Orders */}
            <button
              type="button"
              onClick={() => handleTabChange("orders")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none whitespace-nowrap ${
                activeTab === "orders"
                  ? "bg-emerald-600 text-white shadow-2xs border-emerald-700"
                  : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <ShoppingCartIcon size={14} weight="bold" />
              <span>Đầu Vào Order</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  activeTab === "orders" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
                }`}
              >
                {totalOrders.toLocaleString()}
              </span>
            </button>

            {/* Tab 2: Ads */}
            <button
              type="button"
              onClick={() => handleTabChange("ads")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none whitespace-nowrap ${
                activeTab === "ads"
                  ? "bg-emerald-600 text-white shadow-2xs border-emerald-700"
                  : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <TrendUpIcon size={14} weight="bold" />
              <span>Ads</span>
              {totalAds > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    activeTab === "ads" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
                  }`}
                >
                  {totalAds}
                </span>
              )}
            </button>

            {/* Tab 3: Return */}
            <button
              type="button"
              onClick={() => handleTabChange("return")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none whitespace-nowrap ${
                activeTab === "return"
                  ? "bg-emerald-600 text-white shadow-2xs border-emerald-700"
                  : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <ArrowCounterClockwiseIcon size={14} weight="bold" />
              <span>Return</span>
              {totalReturns > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    activeTab === "return" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
                  }`}
                >
                  {totalReturns}
                </span>
              )}
            </button>

            {/* Tab 4: Service Fee */}
            <button
              type="button"
              onClick={() => handleTabChange("service_fee")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none whitespace-nowrap ${
                activeTab === "service_fee"
                  ? "bg-emerald-600 text-white shadow-2xs border-emerald-700"
                  : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              <ReceiptIcon size={14} weight="bold" />
              <span>Service Fee</span>
              {totalServiceFees > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    activeTab === "service_fee" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
                  }`}
                >
                  {totalServiceFees}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="w-full border-t border-slate-300/80" />

        {/* Row 2: Active tab filters on the left, evaluation stats on the right */}
        <div className="flex items-center gap-3 min-h-[32px] flex-nowrap overflow-visible">

          {/* Active Tab Filters */}
          {activeTab === "orders" ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="h-4 w-px bg-slate-300 select-none hidden md:block" />

              {/* Sort Date Toggle */}
              <button
                type="button"
                onClick={() => setDateSort((prev) => (prev === "desc" ? "asc" : "desc"))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold transition shadow-2xs whitespace-nowrap cursor-pointer ${
                  dateSort === "desc"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                title="Sắp xếp theo ngày mua đơn hàng"
              >
                {dateSort === "desc" ? <CaretDownIcon size={12} weight="bold" /> : <CaretUpIcon size={12} weight="bold" />}
                <span>{dateSort === "desc" ? "Mới nhất" : "Cũ nhất"}</span>
              </button>

              {/* Date range picker (Orders) */}
              <PpcAmazonDatePicker
                value={importDateRange}
                onChange={handleDateRangeChange}
                maxDate={importMaxDate}
                align="left"
              />



              {/* Quick Search Input */}
              <div className="relative w-36 sm:w-44 focus-within:!w-56 transition-all duration-200">
                <MagnifyingGlassIcon
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Tìm đơn, SKU, City..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-6 pr-5 py-0.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 shadow-2xs"
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

              {/* Zoom Controls (+ / -) */}
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Thu nhỏ bảng (-10%)"
                >
                  <MinusIcon size={11} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom(100)}
                  className="px-1 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                  title="Đặt lại cỡ 100%"
                >
                  {tableZoom}%
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Phóng to bảng (+10%)"
                >
                  <PlusIcon size={11} weight="bold" />
                </button>
              </div>
            </div>
          ) : activeTab === "ads" ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="h-4 w-px bg-slate-300 select-none hidden md:block" />

              {/* Sort Date Toggle */}
              <button
                type="button"
                onClick={() => setAdsDateSort((prev) => (prev === "desc" ? "asc" : "desc"))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold transition shadow-2xs whitespace-nowrap cursor-pointer ${
                  adsDateSort === "desc"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                title="Sắp xếp theo ngày báo cáo Ads"
              >
                {adsDateSort === "desc" ? <CaretDownIcon size={12} weight="bold" /> : <CaretUpIcon size={12} weight="bold" />}
                <span>{adsDateSort === "desc" ? "Mới nhất" : "Cũ nhất"}</span>
              </button>

              {/* Date range picker (Ads) */}
              <PpcAmazonDatePicker
                value={importDateRange}
                onChange={handleDateRangeChange}
                maxDate={importMaxDate}
                align="left"
              />

              {/* Quick Search Input (Ads) */}
              <div className="relative w-36 sm:w-44 focus-within:!w-56 transition-all duration-200">
                <MagnifyingGlassIcon
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Tìm Portfolio, SKU, PIC..."
                  value={adsSearch}
                  onChange={(e) => setAdsSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-6 pr-5 py-0.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 shadow-2xs"
                />
                {adsSearch && (
                  <button
                    type="button"
                    onClick={() => setAdsSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <XIcon size={10} />
                  </button>
                )}
              </div>

              {/* Zoom Controls (+ / -) */}
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Thu nhỏ bảng (-10%)"
                >
                  <MinusIcon size={11} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom(100)}
                  className="px-1 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                  title="Đặt lại cỡ 100%"
                >
                  {tableZoom}%
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Phóng to bảng (+10%)"
                >
                  <PlusIcon size={11} weight="bold" />
                </button>
              </div>
            </div>
          ) : activeTab === "return" ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="h-4 w-px bg-slate-300 select-none hidden md:block" />

              <button
                type="button"
                onClick={() => setReturnDateSort((prev) => (prev === "desc" ? "asc" : "desc"))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold transition shadow-2xs whitespace-nowrap cursor-pointer ${
                  returnDateSort === "desc"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                title="Sắp xếp theo ngày Return"
              >
                {returnDateSort === "desc" ? <CaretDownIcon size={12} weight="bold" /> : <CaretUpIcon size={12} weight="bold" />}
                <span>{returnDateSort === "desc" ? "Mới nhất" : "Cũ nhất"}</span>
              </button>

              {/* Date range picker (Return) */}
              <PpcAmazonDatePicker
                value={importDateRange}
                onChange={handleDateRangeChange}
                maxDate={importMaxDate}
                align="left"
              />

              <div className="relative w-36 sm:w-44 focus-within:!w-56 transition-all duration-200">
                <MagnifyingGlassIcon
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Tìm Order ID, SKU, PIC..."
                  value={returnSearch}
                  onChange={(e) => setReturnSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-6 pr-5 py-0.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 shadow-2xs"
                />
                {returnSearch && (
                  <button
                    type="button"
                    onClick={() => setReturnSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <XIcon size={10} />
                  </button>
                )}
              </div>

              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Thu nhỏ bảng (-10%)"
                >
                  <MinusIcon size={11} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom(100)}
                  className="px-1 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                  title="Đặt lại cỡ 100%"
                >
                  {tableZoom}%
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Phóng to bảng (+10%)"
                >
                  <PlusIcon size={11} weight="bold" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="h-4 w-px bg-slate-300 select-none hidden md:block" />

              <button
                type="button"
                onClick={() => setServiceFeeDateSort((prev) => (prev === "desc" ? "asc" : "desc"))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-bold transition shadow-2xs whitespace-nowrap cursor-pointer ${
                  serviceFeeDateSort === "desc"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                title="Sắp xếp theo ngày Service Fee"
              >
                {serviceFeeDateSort === "desc" ? <CaretDownIcon size={12} weight="bold" /> : <CaretUpIcon size={12} weight="bold" />}
                <span>{serviceFeeDateSort === "desc" ? "Mới nhất" : "Cũ nhất"}</span>
              </button>

              {/* Date range picker (Service Fee) */}
              <PpcAmazonDatePicker
                value={importDateRange}
                onChange={handleDateRangeChange}
                maxDate={importMaxDate}
                align="left"
              />

              <div className="relative w-36 sm:w-44 focus-within:!w-56 transition-all duration-200">
                <MagnifyingGlassIcon
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  placeholder="Tìm loại phí, Order ID..."
                  value={serviceFeeSearch}
                  onChange={(e) => setServiceFeeSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white pl-6 pr-5 py-0.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 shadow-2xs"
                />
                {serviceFeeSearch && (
                  <button
                    type="button"
                    onClick={() => setServiceFeeSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <XIcon size={10} />
                  </button>
                )}
              </div>

              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Thu nhỏ bảng (-10%)"
                >
                  <MinusIcon size={11} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom(100)}
                  className="px-1 py-0.5 text-[10px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                  title="Đặt lại cỡ 100%"
                >
                  {tableZoom}%
                </button>
                <button
                  type="button"
                  onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                  className="h-5 w-5 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                  title="Phóng to bảng (+10%)"
                >
                  <PlusIcon size={11} weight="bold" />
                </button>
              </div>
            </div>
          )}

        {/* Evaluation Stats */}
        {activeTab === "orders" ? (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-900 justify-end py-0.5 ml-auto">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Orders:</span>
              <span className="font-bold text-slate-950 font-mono">{stats.totalOrders.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Units:</span>
              <span className="font-bold text-slate-950 font-mono">{stats.totalUnits.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Sales:</span>
              <span className="font-bold text-emerald-700 font-mono">{formatCurrency(stats.totalRevenue)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Shipped:</span>
              <span className="font-bold text-slate-950 font-mono">{stats.shippedCount.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Pending:</span>
              <span className="font-bold text-slate-950 font-mono">{stats.pendingCount.toLocaleString()}</span>
            </div>
            {stats.canceledCount > 0 && (
              <>
                <span className="text-slate-400 select-none">|</span>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 font-medium">Canceled:</span>
                  <span className="font-bold text-slate-950 font-mono">{stats.canceledCount.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        ) : activeTab === "ads" ? (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-900 justify-end py-0.5 ml-auto">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Total:</span>
              <span className="font-bold text-slate-950 font-mono">{adsStats.totalRows.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Spend:</span>
              <span className="font-bold text-rose-700 font-mono">{formatCurrency(adsStats.totalSpend)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Tax 10%:</span>
              <span className="font-bold text-amber-900 font-mono">{formatCurrency(adsStats.totalThue10)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Sales:</span>
              <span className="font-bold text-emerald-700 font-mono">{formatCurrency(adsStats.totalSales)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Clicks:</span>
              <span className="font-bold text-slate-950 font-mono">{formatNumber(adsStats.totalClicks)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Orders:</span>
              <span className="font-bold text-slate-950 font-mono">{formatNumber(adsStats.totalOrders)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">ACOS:</span>
              <span className="font-bold text-amber-800 font-mono">{adsStats.avgAcos.toFixed(1)}%</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">ROAS:</span>
              <span className="font-bold text-emerald-700 font-mono">{adsStats.avgRoas.toFixed(2)}</span>
            </div>
          </div>
        ) : activeTab === "return" ? (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-900 justify-end py-0.5 ml-auto">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Returns:</span>
              <span className="font-bold text-slate-950 font-mono">{returnStats.totalRows.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Total Hoàn:</span>
              <span className="font-bold text-rose-700 font-mono">{formatCurrency(returnStats.totalAmount)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Amazon Fees:</span>
              <span className="font-bold text-amber-700 font-mono">{formatCurrency(returnStats.totalAmazonFees)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Basecost:</span>
              <span className="font-bold text-slate-700 font-mono">{formatCurrency(returnStats.totalBasecost)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Sau Basecost:</span>
              <span className="font-bold text-emerald-700 font-mono">{formatCurrency(returnStats.totalReturnSauBasecost)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">SKUs:</span>
              <span className="font-bold text-indigo-700 font-mono">{returnStats.uniqueSkus.toLocaleString()}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-900 justify-end py-0.5 ml-auto">
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Khoản phí:</span>
              <span className="font-bold text-slate-950 font-mono">{serviceFeeStats.totalRows.toLocaleString()}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Tổng phí:</span>
              <span className="font-bold text-rose-700 font-mono">{formatCurrency(serviceFeeStats.totalAmount)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Amazon Fees:</span>
              <span className="font-bold text-amber-700 font-mono">{formatCurrency(serviceFeeStats.totalAmazonFees)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Other:</span>
              <span className="font-bold text-slate-700 font-mono">{formatCurrency(serviceFeeStats.totalOther)}</span>
            </div>
            <span className="text-slate-400 select-none">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-medium">Hạng mục:</span>
              <span className="font-bold text-indigo-700 font-mono">{serviceFeeStats.uniqueFeeTypes.toLocaleString()}</span>
            </div>
          </div>
        )}
        </div>
      </div>

      {visitedTabs.orders && (
        <div className={activeTab === "orders" ? "space-y-3" : "hidden"}>
          {/* ACTIVE COLUMN FILTERS BAR (Chỉ hiện khi có lọc) */}
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
        {/* Subtle top loading progress bar instead of wiping out table rows */}
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
                            <span className="line-clamp-2 break-words whitespace-normal leading-tight">{col.label}</span>
                            {columnFilters[col.id] && (
                              <span
                                title={`Đang lọc: ${columnFilters[col.id]}`}
                                className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-indigo-600 text-white shrink-0"
                              >
                                <FunnelIcon size={9} weight="fill" />
                              </span>
                            )}
                          </span>
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
                            className={`ml-1 p-0.5 rounded text-slate-900 transition cursor-pointer shrink-0 ${
                              columnFilters[col.id]
                                ? "opacity-100 bg-amber-600/30"
                                : "opacity-0 group-hover/title:opacity-100 hover:bg-amber-600/40"
                            }`}
                            title={`Tùy chọn, Lọc & Setting cột "${col.label}"`}
                          >
                            <SlidersHorizontalIcon size={12} weight="bold" />
                          </button>
                        </div>
                      </ColumnHeaderCell>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {isInitialLoad && loading ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-24 text-center text-slate-500 font-bold">
                      <div className="inline-flex items-center gap-2 text-indigo-600">
                        <ArrowClockwiseIcon size={18} weight="bold" className="animate-spin" />
                        <span>Đang tải danh sách đơn hàng...</span>
                      </div>
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length} className="py-24 text-center text-slate-500">
                      <div className="space-y-2">
                        <PackageIcon size={36} className="mx-auto text-slate-300" />
                        <p className="font-bold text-slate-700">Chưa có đơn hàng nào cho Store này</p>
                        <p className="text-xs text-slate-400">
                          Bấm nút <b>"Nhập File Order"</b> để tải lên báo cáo đơn hàng từ Amazon Seller Central hoặc ketoan_limima.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  orders.map((item, rowIndex) => (
                    <tr
                      key={item.id}
                      className="group h-[34px] min-h-[34px] bg-white even:bg-[#f8fafc] hover:bg-[#fef9c3] transition-colors [&>td]:border-b [&>td]:border-slate-200"
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
                            className={`py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200 transition-colors leading-tight ${alignClass} ${f.className} overflow-hidden text-ellipsis whitespace-nowrap`}
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
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs text-slate-600 gap-2">
          <div className="flex items-center gap-2">
            <span>
              Hiển thị <b>{orders.length > 0 ? (page - 1) * limit + 1 : 0}</b> -{" "}
              <b>{Math.min(page * limit, totalOrders)}</b> trên tổng số <b>{totalOrders.toLocaleString()}</b> dòng
            </span>
            <div className="flex items-center gap-1 pl-2 border-l border-slate-300">
              <label htmlFor="limit-select" className="text-[11px] text-slate-500 font-medium">
                Dòng/trang:
              </label>
              <select
                id="limit-select"
                value={limit}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setLimit(val);
                  setPage(1);
                }}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-800"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              « Đầu
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              ‹ Trước
            </button>

            <span className="px-2 font-mono font-bold text-slate-800">
              Trang {page} / {totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Sau ›
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Cuối »
            </button>
          </div>
        </div>
      </div>
    </div>
  )}

  {visitedTabs.ads && (
    <div className={activeTab === "ads" ? "space-y-3" : "hidden"}>
      <AdsInputView
        stores={stores}
        selectedStoreId={selectedStoreId}
        onStoreChange={handleStoreChange}
        search={adsSearch}
        setSearch={setAdsSearch}
        dateSort={adsDateSort}
        setDateSort={setAdsDateSort}
        startDate={adsStartDate}
        setStartDate={setAdsStartDate}
        endDate={adsEndDate}
        setEndDate={setAdsEndDate}
        onStatsChange={setAdsStats}
        tableZoom={tableZoom}
        showImportModal={showAdsImportModal}
        setShowImportModal={setShowAdsImportModal}
        showColumnModal={showAdsColumnModal}
        setShowColumnModal={setShowAdsColumnModal}
        resetColumnsSignal={resetAdsColumnsSignal}
        autoFitColumnsSignal={autoFitAdsColumnsSignal}
        reloadSignal={reloadAdsSignal}
        onTotalAdsChange={setTotalAds}
        notify={notify}
      />
    </div>
  )}

  {visitedTabs.return && (
    <div className={activeTab === "return" ? "space-y-3" : "hidden"}>
      <ReturnInputView
        stores={stores}
        selectedStoreId={selectedStoreId}
        onStoreChange={handleStoreChange}
        search={returnSearch}
        setSearch={setReturnSearch}
        dateSort={returnDateSort}
        setDateSort={setReturnDateSort}
        startDate={returnStartDate}
        setStartDate={setReturnStartDate}
        endDate={returnEndDate}
        setEndDate={setReturnEndDate}
        onStatsChange={setReturnStats}
        tableZoom={tableZoom}
        showImportModal={showReturnImportModal}
        setShowImportModal={setShowReturnImportModal}
        showColumnModal={showReturnColumnModal}
        setShowColumnModal={setShowReturnColumnModal}
        resetColumnsSignal={resetReturnColumnsSignal}
        reloadSignal={reloadReturnSignal}
        onTotalReturnsChange={setTotalReturns}
        notify={notify}
      />
    </div>
  )}

  {visitedTabs.service_fee && (
    <div className={activeTab === "service_fee" ? "space-y-3" : "hidden"}>
      <ServiceFeeInputView
        stores={stores}
        selectedStoreId={selectedStoreId}
        onStoreChange={handleStoreChange}
        search={serviceFeeSearch}
        setSearch={setServiceFeeSearch}
        dateSort={serviceFeeDateSort}
        setDateSort={setServiceFeeDateSort}
        startDate={serviceFeeStartDate}
        setStartDate={setServiceFeeStartDate}
        endDate={serviceFeeEndDate}
        setEndDate={setServiceFeeEndDate}
        onStatsChange={setServiceFeeStats}
        tableZoom={tableZoom}
        showImportModal={showServiceFeeImportModal}
        setShowImportModal={setShowServiceFeeImportModal}
        showColumnModal={showServiceFeeColumnModal}
        setShowColumnModal={setShowServiceFeeColumnModal}
        resetColumnsSignal={resetServiceFeeColumnsSignal}
        reloadSignal={reloadServiceFeeSignal}
        onTotalServiceFeesChange={setTotalServiceFees}
        notify={notify}
      />
    </div>
  )}


      {/* CONTEXT MENU */}
      {columnContextMenu && (() => {
        const field = columnContextMenu.field;
        const col = columns.find((c) => c.id === field);
        const colLabel = col?.label || field;
        const isCurrentBoundary = frozenThrough === field;
        const isDefault = frozenThrough === "amazon_order_id";

        return (
          <div
            ref={columnMenuRef}
            className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.min(columnContextMenu.x, window.innerWidth - 240),
              top: Math.min(columnContextMenu.y, window.innerHeight - 200),
            }}
          >
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">TÙY CHỌN CỘT</span>
              <span className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{colLabel}</span>
            </div>

            <div className="p-1 space-y-0.5">
              {/* Setting cột - Mở modal cấu hình cho riêng cột này */}
              <button
                type="button"
                onClick={() => {
                  handleOpenFieldEditor(field, colLabel);
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
                    handleSetFrozenColumn("amazon_order_id");
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

            {/* Lọc cột này - Tương tự như trong Inventory / Bảng Mã */}
            {(() => {
              const options = getColumnOptions(field);
              if (options.length === 0) return null;
              return (
                <label className="block border-t border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50/50">
                  Lọc cột này
                  <select
                    autoFocus
                    value={columnFilters[field] || ""}
                    onChange={(event) => {
                      setColumnFilter(field, event.target.value);
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
              );
            })()}
          </div>
        );
      })()}

      {/* MODAL CẤU HÌNH CỘT ĐƠN LẺ (FIELD EDITOR MODAL) */}
      {fieldEditor && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50/50">
              <div>
                <p className="text-sm font-black text-slate-900">Cấu hình cột</p>
                <p className="text-xs text-slate-500">{fieldEditor.field_id}</p>
              </div>
              <button
                type="button"
                onClick={() => setFieldEditor(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg hover:bg-slate-100"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-5 text-xs">
              {/* Tên cột */}
              <label className="block font-bold text-slate-700">
                Tên cột
                <input
                  value={fieldEditor.label}
                  onChange={(e) => setFieldEditor({ ...fieldEditor, label: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </label>

              {/* Giá trị lựa chọn */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-700">
                    Giá trị lựa chọn ({fieldEditor.options.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const rowVals = scanOptionsFromRows(fieldEditor.field_id);
                      const merged = [...new Set([...fieldEditor.options, ...rowVals])].filter(
                        (o) => o && o !== "0" && o !== "-"
                      );
                      const added = merged.length - fieldEditor.options.length;
                      setFieldEditor({ ...fieldEditor, options: merged });
                      if (added > 0) {
                        notify(`Đã quét thêm ${added} giá trị mới từ bảng!`, "success");
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
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-xs text-slate-500">
                    Chưa có giá trị nào. Bạn có thể bấm <strong>&quot;Quét giá trị từ bảng&quot;</strong> hoặc nhập giá trị mới bên dưới.
                  </div>
                ) : (
                  <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 thin-scrollbar">
                    {fieldEditor.options.map((option, index) => (
                      <div key={`${option}-${index}`} className="flex gap-2 items-center">
                        <input
                          value={option}
                          onChange={(e) =>
                            setFieldEditor({
                              ...fieldEditor,
                              options: fieldEditor.options.map((item, i) =>
                                i === index ? e.target.value : item
                              ),
                            })
                          }
                          className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:border-indigo-500 focus:outline-none"
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

              {/* Thêm giá trị mới */}
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
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
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
                  className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 font-bold text-slate-700 transition cursor-pointer"
                >
                  Thêm
                </button>
              </div>

              {/* Checkbox Cho phép nhập giá trị khác */}
              <label className="flex items-center gap-2 font-semibold text-slate-700 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={fieldEditor.allow_custom_value}
                  onChange={(e) =>
                    setFieldEditor({ ...fieldEditor, allow_custom_value: e.target.checked })
                  }
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Cho phép nhập giá trị khác</span>
              </label>
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 bg-slate-50/50">
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
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-5 py-2 font-bold text-white transition shadow-sm cursor-pointer"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CẤU HÌNH CỘT (COLUMN MANAGER MODAL) */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title="ĐẦU VÀO ORDER"
        columns={columns}
        onSave={handleSaveColumns}
        onReset={handleResetColumns}
      />

      {/* MODAL NHẬP FILE ORDER / KẾ TOÁN TỔNG HỢP */}
      {showImportModal && (
        <OrderImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          storeId={selectedStoreId}
          storeName={selectedStore?.name || "Store"}
          onSuccess={(allSheets?: boolean) => {
            fetchOrders();
            if (allSheets) {
              setReloadAdsSignal((s) => s + 1);
              setReloadReturnSignal((s) => s + 1);
              setReloadServiceFeeSignal((s) => s + 1);
              // Bỏ lọc ngày để người dùng nhìn thấy toàn bộ dữ liệu lịch sử vừa nạp
              setImportDateRange({ startDate: "", endDate: "" });
              setPage(1);
            }
            setShowImportModal(false);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

/**
 * Modal Import Order file (.txt, .tsv, .csv, .xlsx, .xls)
 * Tích hợp tự động quét & nạp trọn bộ 4 Sheet (Order, Ads, Return, Fees) từ file Excel tổng hợp
 */
function OrderImportModal({
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
  onSuccess: (allSheets?: boolean) => void;
  notify: (msg: string, type?: "success" | "error") => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importAllSheets, setImportAllSheets] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const isXlsx = file?.name ? file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") : false;

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
      const isExcelFile = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
      const useUnified = isExcelFile && importAllSheets;
      const endpoint = useUnified ? "/api/accounting/unified-import" : "/api/accounting/orders/import";

      const formData = new FormData();
      formData.append("file", file);
      formData.append("store_id", storeId);

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Tải lên thất bại");

      if (useUnified && data.job?.id) {
        const trackedJob = { id: data.job.id, fileName: file.name };
        localStorage.setItem("accounting_import_active_job", JSON.stringify(trackedJob));
        window.dispatchEvent(new CustomEvent("accounting-import-queued", { detail: trackedJob }));
        onClose();
        return;
      }

      notify(data.message || `Đã nhập thành công toàn bộ dữ liệu!`, "success");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(useUnified);
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
              <h2 className="text-base font-bold text-slate-900">Nhập File Kế Toán / Đầu Vào Order</h2>
              <p className="text-xs text-slate-500">Store: <span className="font-bold text-slate-800">{storeName}</span></p>
            </div>
          </div>
          <button
            type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Drag & Drop Area */}
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
              ? "border-emerald-400 bg-emerald-50/40"
              : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.tsv,.csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />

          {file ? (
            <div className="space-y-1">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <FileXlsIcon size={28} weight="bold" />
              </div>
              <p className="text-sm font-bold text-slate-800">{file.name}</p>
              <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-bold underline cursor-pointer"
              >
                ✕ Hủy / Xóa file đã chọn
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <UploadSimpleIcon size={26} weight="bold" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  Kéo thả file vào đây hoặc <span className="text-indigo-600 underline">chọn file</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Hỗ trợ: Báo cáo Amazon (.txt, .tsv, .csv) hoặc file Excel tổng hợp <b>.xlsx</b> (chứa 4 sheet: <i>Đầu vào Order, ADS, RETURN, Service Fees</i> như ketoan_limima.xlsx).
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Unified 4-Sheet Option if XLSX */}
        {isXlsx && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-950 space-y-1.5">
            <label className="flex items-start gap-2 cursor-pointer font-bold select-none text-emerald-900">
              <input
                type="checkbox"
                checked={importAllSheets}
                onChange={(e) => setImportAllSheets(e.target.checked)}
                className="mt-0.5 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
              />
              <div>
                <span>Tự động quét & nạp trọn bộ cả 4 Sheet (Order, ADS, RETURN, Service Fees)</span>
                <p className="text-[11px] font-normal text-emerald-700 mt-0.5">
                  Đọc bằng Single-Pass Stream trực tiếp từ đĩa, cam kết <b>không bao giờ tràn RAM</b> (OOM), đọc đầy đủ 100% dòng dữ liệu và <b>tự động xóa file tạm</b> trên máy chủ ngay sau khi nạp xong.
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Instructions */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5 text-xs text-indigo-950 space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            <CheckCircleIcon size={14} weight="bold" className="text-indigo-600" />
            Cơ chế nạp thông minh & tự động hóa:
          </p>
          <ul className="list-disc list-inside text-indigo-800 space-y-0.5 pl-1 text-[11.5px]">
            <li>Tự động nhận diện tab separator của Amazon và chuẩn hóa tên cột.</li>
            <li>Tự động trích xuất cột <b>Date</b> từ <code>purchase-date</code> nếu file chưa có.</li>
            <li>Tự động gộp / cập nhật (Upsert) theo khóa chuẩn, không lo bị trùng lặp.</li>
            <li>Sau khi nạp xong, hệ thống sẽ tự động chuyển sang chế độ <b>"Toàn bộ lịch sử"</b> để xem trọn vẹn dữ liệu.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-700 transition shadow-sm disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <ArrowClockwiseIcon size={14} className="animate-spin" />
                <span>Đang stream & nạp dữ liệu (không tràn RAM)...</span>
              </>
            ) : (
              <>
                <UploadSimpleIcon size={14} weight="bold" />
                <span>Bắt đầu nạp dữ liệu</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
export const ImportView = OrderInputView;
