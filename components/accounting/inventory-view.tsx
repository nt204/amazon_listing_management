"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  EyeIcon,
  FileXlsIcon,
  FloppyDiskIcon,
  ImageSquareIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  TruckIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { SkuMasterItem, InboundShipmentItem } from "@/lib/accounting/inventory-db";
import type { Store } from "@/lib/accounting/types";

// Debounce hook for instant, throttled searching (300ms)
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// Singleton Query Client for Inventory
const inventoryQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Dynamic Entity Palettes (16 harmonious pastel presets)
const ENTITY_PALETTES = [
  { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-300" },
  { bg: "bg-sky-100", text: "text-sky-950", border: "border-sky-300" },
  { bg: "bg-purple-100", text: "text-purple-950", border: "border-purple-300" },
  { bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300" },
  { bg: "bg-pink-100", text: "text-pink-950", border: "border-pink-300" },
  { bg: "bg-teal-100", text: "text-teal-950", border: "border-teal-300" },
  { bg: "bg-rose-100", text: "text-rose-950", border: "border-rose-300" },
  { bg: "bg-indigo-100", text: "text-indigo-950", border: "border-indigo-300" },
  { bg: "bg-orange-100", text: "text-orange-950", border: "border-orange-300" },
  { bg: "bg-lime-100", text: "text-lime-950", border: "border-lime-300" },
  { bg: "bg-cyan-100", text: "text-cyan-950", border: "border-cyan-300" },
  { bg: "bg-violet-100", text: "text-violet-950", border: "border-violet-300" },
  { bg: "bg-fuchsia-100", text: "text-fuchsia-950", border: "border-fuchsia-300" },
  { bg: "bg-yellow-100", text: "text-yellow-950", border: "border-yellow-300" },
  { bg: "bg-blue-100", text: "text-blue-950", border: "border-blue-300" },
  { bg: "bg-stone-200", text: "text-stone-900", border: "border-stone-400" },
];

function getEntityStyle(val: string): { bg: string; text: string; border: string } {
  const clean = val.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return ENTITY_PALETTES[hash % ENTITY_PALETTES.length];
}

// Universal Entity Badge: colors any fixed entity across ANY current or future store
function EntityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400 font-medium">—</span>;
  const clean = typeof value === "string" ? value.trim() : "";
  if (
    !clean ||
    clean === "—" ||
    clean === "[object Object]" ||
    clean.includes("[object Object]") ||
    clean === "#N/A" ||
    clean === "#REF!" ||
    clean === "#VALUE!" ||
    clean === "null" ||
    clean === "undefined"
  ) {
    return <span className="text-slate-400 font-medium">—</span>;
  }
  const style = getEntityStyle(clean);
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium border shadow-2xs whitespace-nowrap ${style.bg} ${style.text} ${style.border}`}
    >
      {clean}
    </span>
  );
}

function ProductTypeBadge({ type }: { type: string | null | undefined }) {
  return <EntityBadge value={type} />;
}

// Clean Autocomplete Input for Product Type (No annotations, no 'Chọn' text)
function ProductTypeInput({
  value,
  onChange,
  existingTypes,
}: {
  value: string;
  onChange: (val: string) => void;
  existingTypes: string[];
}) {
  const [open, setOpen] = useState(false);
  const cleanVal = (value || "").trim().toLowerCase();
  const filtered = cleanVal
    ? existingTypes.filter((t) => t.toLowerCase().includes(cleanVal))
    : existingTypes;

  return (
    <div className="relative space-y-1">
      <label className="font-bold text-slate-700">
        Tên Phôi (Product Type) <span className="text-rose-500">*</span>
      </label>

      <div className="relative">
        <input
          type="text"
          placeholder="Nhập tên phôi..."
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-300 bg-white p-1 shadow-2xl z-50 divide-y divide-slate-100">
            {filtered.slice(0, 15).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onChange(type);
                  setOpen(false);
                }}
                className="flex w-full items-center px-3 py-2 text-xs text-left font-semibold text-slate-800 hover:bg-indigo-50 hover:text-indigo-900 rounded transition cursor-pointer"
              >
                <span>{type}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function safeDisplay(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "object") return "—";
  const s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "[object Object]" ||
    s.includes("[object Object]") ||
    s === "#N/A" ||
    s === "#REF!" ||
    s === "#VALUE!" ||
    s === "null" ||
    s === "undefined"
  ) {
    return "—";
  }
  return s;
}

function getRawEditableString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") return "";
  const s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "[object Object]" ||
    s.includes("[object Object]") ||
    s === "#N/A" ||
    s === "#REF!" ||
    s === "#VALUE!" ||
    s === "null" ||
    s === "undefined"
  ) {
    return "";
  }
  return s;
}

// Ultra-fast, Excel-like Inline Editable Cell (0ms keystroke lag, auto-save on blur / Enter)
const EditableCell = memo(
  function EditableCell({
    table,
    id,
    field,
    value,
    display,
    className = "",
    inlineEditing,
    inlineSaving: _inlineSaving,
    onStartEdit,
    onChangeValue: _onChangeValue,
    onSave,
    onCancel,
  }: {
    table: "sku" | "inbound";
    id: string;
    field: string;
    value: unknown;
    display: React.ReactNode;
    className?: string;
    inlineEditing: { table: "sku" | "inbound"; id: string; field: string; value?: string } | null;
    inlineSaving?: boolean;
    onStartEdit: (table: "sku" | "inbound", id: string, field: string, val?: unknown) => void;
    onChangeValue?: (newVal: string) => void;
    onSave: (table?: "sku" | "inbound" | unknown, id?: string, field?: string, val?: string) => void | Promise<void>;
    onCancel: () => void;
  }) {
    const isEditing =
      inlineEditing?.table === table &&
      inlineEditing?.id === id &&
      inlineEditing?.field === field;

    const [localVal, setLocalVal] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const isCommittingRef = useRef(false);

    useEffect(() => {
      if (isEditing) {
        setLocalVal(getRawEditableString(value));
        isCommittingRef.current = false;
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        });
      }
    }, [isEditing, value]);

    const commitSave = () => {
      if (isCommittingRef.current) return;
      isCommittingRef.current = true;
      const cleanLocal = localVal.trim();
      const cleanOrig = getRawEditableString(value);
      if (cleanLocal !== cleanOrig) {
        onSave(table, id, field, cleanLocal);
      } else {
        onCancel();
      }
    };

    const alignClass = className.includes("text-center")
      ? "justify-center text-center"
      : className.includes("text-right")
      ? "justify-end text-right"
      : "justify-start text-left";

    const inputAlignClass = className.includes("text-center")
      ? "text-center"
      : className.includes("text-right")
      ? "text-right"
      : "text-left";

    return (
      <td
        onDoubleClick={() => onStartEdit(table, id, field, value)}
        className={`group/cell relative cursor-pointer select-none transition-colors hover:bg-amber-100/60 ${className}`}
      >
        {/* Ghost in-flow content maintains EXACT column width and height - ZERO SHIFT */}
        <div className={`w-full h-full flex items-center ${alignClass} ${isEditing ? "invisible pointer-events-none select-none opacity-0" : ""}`}>
          {display}
        </div>

        {/* Quick edit button on hover (1-click edit) */}
        {!isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit(table, id, field, value);
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover/cell:opacity-100 hover:bg-slate-200/80 text-slate-400 hover:text-indigo-600 transition cursor-pointer"
            title="Sửa ô này"
          >
            <PencilSimpleIcon size={12} weight="bold" />
          </button>
        )}

        {isEditing && (
          <div
            className="absolute inset-0 z-30 p-0.5 flex items-center bg-white rounded ring-2 ring-emerald-600 shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={localVal}
              onChange={(e) => setLocalVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitSave();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  isCommittingRef.current = true;
                  onCancel();
                }
              }}
              onBlur={() => {
                commitSave();
              }}
              className={`h-full w-full rounded border border-emerald-500 bg-white px-2 text-xs font-bold text-slate-950 focus:outline-none ${inputAlignClass}`}
            />
          </div>
        )}
      </td>
    );
  },
  (prevProps, nextProps) => {
    const wasEditing =
      prevProps.inlineEditing?.table === prevProps.table &&
      prevProps.inlineEditing?.id === prevProps.id &&
      prevProps.inlineEditing?.field === prevProps.field;

    const willEdit =
      nextProps.inlineEditing?.table === nextProps.table &&
      nextProps.inlineEditing?.id === nextProps.id &&
      nextProps.inlineEditing?.field === nextProps.field;

    if (wasEditing !== willEdit) return false;
    if (prevProps.value !== nextProps.value) return false;
    if (prevProps.id !== nextProps.id) return false;
    if (prevProps.field !== nextProps.field) return false;
    if (prevProps.className !== nextProps.className) return false;
    return true;
  }
);

// High-performance Pagination Bar (50/trang, Trang 1/X, previous/next, jump)
function PaginationBar({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  onLimitChange,
  label = "mục",
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-[#f8fafc] px-4 py-2.5 text-xs text-slate-700 font-semibold select-none">
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
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
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

function getOptimizedThumbnailUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("trello.com") || trimmed.includes("drive.google.com")) {
    return `/api/accounting/inventory/mockup-proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

// Compact, Fast Mockup Thumbnail (44x44px, async decode, low fetch priority, in-place preview)
function MockupThumbnail({
  url,
  alt,
  onPreview,
}: {
  url: string | null;
  alt: string;
  onPreview?: (url: string) => void;
}) {
  const [hasError, setHasError] = useState(false);
  const optimizedUrl = useMemo(() => getOptimizedThumbnailUrl(url), [url]);

  if (!url || hasError) {
    return (
      <div className="flex h-11 w-11 mx-auto shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400">
        <ImageSquareIcon size={20} weight="duotone" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPreview?.(url)}
      className="group relative block h-11 w-11 mx-auto shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5 hover:border-amber-500 hover:ring-2 hover:ring-amber-200 transition shadow-2xs cursor-pointer"
      title="Nhấn để xem trước ảnh (Không chuyển trang)"
    >
      <img
        src={optimizedUrl || url}
        alt={alt}
        width={44}
        height={44}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onError={() => setHasError(true)}
        className="h-full w-full object-contain rounded transition-transform duration-150 group-hover:scale-110"
      />
    </button>
  );
}

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  "phát triển": { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-300" },
  "test": { bg: "bg-sky-100", text: "text-sky-950", border: "border-sky-300" },
  "tối ưu": { bg: "bg-purple-100", text: "text-purple-950", border: "border-purple-300" },
  "hủy": { bg: "bg-rose-100", text: "text-rose-950", border: "border-rose-300" },
  "closed": { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-300" },
  "receiving": { bg: "bg-teal-100", text: "text-teal-950", border: "border-teal-300" },
  "in transit": { bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300" },
  "working": { bg: "bg-indigo-100", text: "text-indigo-950", border: "border-indigo-300" },
  "active": { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-300" },
  "inactive": { bg: "bg-slate-200", text: "text-slate-800", border: "border-slate-400" },
  "đã updated": { bg: "bg-emerald-100", text: "text-emerald-950", border: "border-emerald-300" },
  "pending": { bg: "bg-yellow-100", text: "text-yellow-950", border: "border-yellow-300" },
  "cần đánh giá": { bg: "bg-amber-100", text: "text-amber-950", border: "border-amber-300" },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400 font-medium">—</span>;
  const s = typeof status === "string" ? status.trim() : "";
  if (
    !s ||
    s === "—" ||
    s === "[object Object]" ||
    s.includes("[object Object]") ||
    s === "#N/A" ||
    s === "#REF!" ||
    s === "#VALUE!" ||
    s === "null" ||
    s === "undefined"
  ) {
    return <span className="text-slate-400 font-medium">—</span>;
  }
  const lower = s.toLowerCase();
  let style = STATUS_STYLES[lower];
  if (!style) {
    style = getEntityStyle(lower);
  }
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold border shadow-2xs whitespace-nowrap ${style.bg} ${style.text} ${style.border}`}
    >
      {s}
    </span>
  );
}

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  if (typeof val === "object") return "—";
  const s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "[object Object]" ||
    s.includes("[object Object]") ||
    s === "#N/A" ||
    s === "#REF!" ||
    s === "#VALUE!" ||
    s === "null" ||
    s === "undefined"
  ) {
    return "—";
  }
  if (s.includes("T")) return s.split("T")[0];
  if (s.includes(" 00:00:00")) return s.split(" ")[0];
  return s;
}

const emptySkuForm = {
  id: "",
  sku: "",
  brand: "",
  product_type: "",
  mockup_url: "",
  asin: "",
  fnsku: "",
  amazon_fee: "",
  referral_fee_pct: "",
  pic_mkt: "",
  loai: "",
  niche: "",
  pic_idea: "",
  status: "Active",
  event: "",
  tinh_trang: "",
  design_pic: "",
  thang_listing: "",
  thang_danh_gia: "",
  event_250th: "",
  ngay_danh_gia_sku_event: "",
  amazon_fba_fee_thay_doi: "",
  basecost_tb: "",
  brand_entity_id: "",
  creative_asins_video: "",
  creative_asins_collection: "",
  video_media_ids: "",
  creative_headline: "",
  brand_logo_asset_id: "",
  landing_page_url: "",
};

const emptyShipmentForm = {
  id: "",
  sku: "",
  brand: "",
  sup: "",
  ngay_request: "",
  product_type: "",
  mockup: "",
  quantity: "",
  line_ship: "",
  base_cost_per_unit: "",
  card: "",
  tag: "",
  shipping_fee: "",
  hop_tui: "",
  final_basecost: "",
  total_basecost: "",
  ngay_thanh_toan: "",
  ten_lo_hang: "",
  shipment_id: "",
  ngay_di: "",
  ngay_den: "",
  amazon_received: "",
  tinh_trang_hang_den_kho: "",
  status: "In Transit",
  so_luong_amazon_nhan: "",
  discrepancy: "",
  note: "",
  trang_thai: "",
};

export function InventoryView() {
  return (
    <QueryClientProvider client={inventoryQueryClient}>
      <InventoryViewInner />
    </QueryClientProvider>
  );
}

function InventoryViewInner() {
  const queryClient = useQueryClient();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const selectedStore = useMemo(() => stores.find((s) => s.id === selectedStoreId), [stores, selectedStoreId]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Active Tab: "sku" | "inbound"
  const [activeTab, setActiveTab] = useState<"sku" | "inbound">("sku");

  // Search & Filter state (Debounced 300ms)
  const [skuSearch, setSkuSearch] = useState("");
  const [skuStatusFilter, setSkuStatusFilter] = useState("");
  const [skuTypeFilter, setSkuTypeFilter] = useState("");
  const debouncedSkuSearch = useDebounce(skuSearch, 300);

  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentStatusFilter, setShipmentStatusFilter] = useState("");
  const debouncedShipmentSearch = useDebounce(shipmentSearch, 300);

  // Blur backdrop mockup preview modal state
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);

  // Pagination 50/1 states
  const [skuPage, setSkuPage] = useState(1);
  const [skuLimit, setSkuLimit] = useState(50);

  const [shipmentPage, setShipmentPage] = useState(1);
  const [shipmentLimit, setShipmentLimit] = useState(50);

  // Reset page to 1 when filters or selected store change
  useEffect(() => {
    setSkuPage(1);
  }, [selectedStoreId, debouncedSkuSearch, skuStatusFilter, skuTypeFilter]);

  useEffect(() => {
    setShipmentPage(1);
  }, [selectedStoreId, debouncedShipmentSearch, shipmentStatusFilter]);

  // 1. TanStack Query for SKU Master (Server-side Page Pagination, 50/trang)
  const skuQuery = useQuery({
    queryKey: ["sku-master", selectedStoreId, skuPage, skuLimit, debouncedSkuSearch, skuStatusFilter, skuTypeFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        store_id: selectedStoreId!,
        page: String(skuPage),
        limit: String(skuLimit),
      });
      if (debouncedSkuSearch) params.set("search", debouncedSkuSearch);
      if (skuStatusFilter) params.set("status", skuStatusFilter);
      if (skuTypeFilter) params.set("product_type", skuTypeFilter);

      const res = await fetch(`/api/accounting/inventory/sku-master?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách SKU Master");
      return res.json() as Promise<{
        items: SkuMasterItem[];
        total: number;
        page: number;
        limit: number;
      }>;
    },
    enabled: !!selectedStoreId,
  });

  const allSkus = skuQuery.data?.items || [];
  const skuTotalCount = skuQuery.data?.total ?? 0;
  const skuTotal = skuTotalCount;
  const skuTotalPages = Math.max(1, Math.ceil(skuTotal / skuLimit));

  // 2. TanStack Query for Inbound Shipments (Server-side Page Pagination, 50/trang)
  const shipmentQuery = useQuery({
    queryKey: ["inbound-shipments", selectedStoreId, shipmentPage, shipmentLimit, debouncedShipmentSearch, shipmentStatusFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        store_id: selectedStoreId!,
        page: String(shipmentPage),
        limit: String(shipmentLimit),
      });
      if (debouncedShipmentSearch) params.set("search", debouncedShipmentSearch);
      if (shipmentStatusFilter) params.set("status", shipmentStatusFilter);

      const res = await fetch(`/api/accounting/inventory/inbound-shipments?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách Inbound Shipments");
      return res.json() as Promise<{
        items: InboundShipmentItem[];
        total: number;
        page: number;
        limit: number;
      }>;
    },
    enabled: !!selectedStoreId,
  });

  const allShipments = shipmentQuery.data?.items || [];
  const shipmentTotalCount = shipmentQuery.data?.total ?? 0;
  const shipmentTotal = shipmentTotalCount;
  const shipmentTotalPages = Math.max(1, Math.ceil(shipmentTotal / shipmentLimit));

  const fetchSkus = useCallback(() => {
    return skuQuery.refetch();
  }, [skuQuery]);

  const fetchShipments = useCallback(() => {
    return shipmentQuery.refetch();
  }, [shipmentQuery]);

  const loadingSkus = skuQuery.isLoading;
  const loadingShipments = shipmentQuery.isLoading;

  // Modals & Forms
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    type?: "sku" | "inbound";
    count?: number;
    errors?: string[];
  } | null>(null);

  // SKU Edit / Add Modal
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [skuFormData, setSkuFormData] = useState(emptySkuForm);
  const [savingSku, setSavingSku] = useState(false);

  // Shipment Edit / Add Modal
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [shipmentFormData, setShipmentFormData] = useState(emptyShipmentForm);
  const [savingShipment, setSavingShipment] = useState(false);

  // View Detail Modals
  const [selectedSkuDetail, setSelectedSkuDetail] = useState<SkuMasterItem | null>(null);
  const [selectedShipmentDetail, setSelectedShipmentDetail] = useState<InboundShipmentItem | null>(null);

  // Dynamic table zoom (+/- scale controls)
  const [tableZoom, setTableZoom] = useState<number>(100);

  // Inline cell editing
  const [inlineEditing, setInlineEditing] = useState<{
    table: "sku" | "inbound";
    id: string;
    field: string;
    value?: string;
  } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  const startInlineEdit = useCallback(
    (table: "sku" | "inbound", id: string, field: string, currentValue?: unknown) => {
      setInlineEditing({
        table,
        id,
        field,
        value: getRawEditableString(currentValue),
      });
    },
    []
  );

  const cancelInlineEdit = useCallback(() => {
    setInlineEditing(null);
  }, []);

  const handleSaveInlineCell = useCallback(
    async (
      tableArg?: "sku" | "inbound" | unknown,
      idArg?: string,
      fieldArg?: string,
      valueArg?: string
    ) => {
      if (!selectedStore) return;
      const table = (typeof tableArg === "string" ? tableArg : inlineEditing?.table) as "sku" | "inbound" | undefined;
      const id = idArg || inlineEditing?.id;
      const field = fieldArg || inlineEditing?.field;
      const value = valueArg !== undefined ? valueArg : inlineEditing?.value;

      if (!table || !id || !field) return;

      setInlineSaving(true);
      try {
        const url =
          table === "sku"
            ? "/api/accounting/inventory/sku-master"
            : "/api/accounting/inventory/inbound-shipments";

        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            store_id: selectedStore.id,
            field,
            value: value ?? "",
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không thể lưu ô dữ liệu.");

        // Direct in-place cache mutation for single record (0ms lag, no refetch of whole table needed!)
        if (table === "sku") {
          queryClient.setQueryData(
            ["sku-master", selectedStoreId, skuPage, skuLimit, debouncedSkuSearch, skuStatusFilter, skuTypeFilter],
            (oldData: any) => {
              if (!oldData) return oldData;
              return {
                ...oldData,
                items: oldData.items.map((item: any) =>
                  item.id === id ? { ...item, ...data.item } : item
                ),
              };
            }
          );
        } else {
          queryClient.setQueryData(
            ["inbound-shipments", selectedStoreId, shipmentPage, shipmentLimit, debouncedShipmentSearch, shipmentStatusFilter],
            (oldData: any) => {
              if (!oldData) return oldData;
              return {
                ...oldData,
                items: oldData.items.map((item: any) =>
                  item.id === id ? { ...item, ...data.item } : item
                ),
              };
            }
          );
        }

        notify("Đã lưu ô dữ liệu thành công!", "success");
        setInlineEditing(null);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setInlineSaving(false);
      }
    },
    [selectedStore, selectedStoreId, skuPage, skuLimit, shipmentPage, shipmentLimit, debouncedSkuSearch, debouncedShipmentSearch, skuStatusFilter, skuTypeFilter, shipmentStatusFilter, inlineEditing, queryClient]
  );

  // Mặc định sắp xếp phôi tháng listing từ mới nhất đến cũ
  const sortedSkus = useMemo(() => {
    return [...allSkus].sort((a, b) => {
      const da = a.thang_listing ? a.thang_listing.trim() : "";
      const db = b.thang_listing ? b.thang_listing.trim() : "";
      if (da && !db) return -1;
      if (!da && db) return 1;
      if (da && db && da !== db) return db.localeCompare(da);
      return (a.row_order ?? 999999) - (b.row_order ?? 999999);
    });
  }, [allSkus]);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const notify = (message: string, type: "success" | "error" = "success") => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Fetch Stores list
  const fetchStores = useCallback(async () => {
    try {
      setLoadingStores(true);
      const res = await fetch("/api/accounting/stores");
      if (!res.ok) throw new Error("Không thể tải danh sách Store");
      const data = (await res.json()) as { stores: Store[] };
      const list = data.stores || [];
      setStores(list);

      // Default to LIMIMA or first store
      if (list.length > 0 && !selectedStoreId) {
        const limima = list.find((s) => s.name.toLowerCase() === "limima");
        setSelectedStoreId(limima ? limima.id : list[0].id);
      }
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setLoadingStores(false);
    }
  }, [selectedStoreId]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // Handle Store Switch (Isolates data immediately, old requests aborted)
  const handleStoreSelect = (storeId: string) => {
    setSelectedStoreId(storeId);
  };

  // Dynamic set of all existing product types for autocomplete
  const existingProductTypes = useMemo(() => {
    return Array.from(
      new Set([
        ...allSkus.map((s) => s.product_type?.trim()).filter(Boolean),
        ...allShipments.map((s) => s.product_type?.trim()).filter(Boolean),
        "Bullet Tumbler",
        "3D Popup Card",
        "Stainless Steel Tumbler",
        "Aryclic Ornament",
        "Glass Ornament",
        "Garden Flag",
        "30oz Tumbler",
        "20oz Tumbler",
        "14oz Tumbler",
        "Pebble Ornament",
        "Pebble Card",
        "Banner",
        "Slate",
        "pebble plaque",
        "Hat",
        "Suncatcher Ornament",
        "Open When Envelopes",
        "Badge Reel",
        "Pocket Hug",
        "Resin",
        "Fan Flag",
        "Metal Sign",
        "Stained Glass Suncatcher",
        "Bunting Flag",
        "Glass Suncatcher",
        "Wood Sign",
        "Wooden Block",
      ] as string[])
    ).sort((a, b) => a.localeCompare(b));
  }, [allSkus, allShipments]);

  // Delete SKU
  const handleDeleteSku = async (id: string, skuName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa SKU ${skuName}?`)) return;
    try {
      const res = await fetch(
        `/api/accounting/inventory/sku-master?id=${id}&store_id=${selectedStoreId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa SKU");
      notify(`Đã xóa SKU ${skuName}`);
      fetchSkus();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  // Delete Shipment
  const handleDeleteShipment = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa lô hàng ${name}?`)) return;
    try {
      const res = await fetch(
        `/api/accounting/inventory/inbound-shipments?id=${id}&store_id=${selectedStoreId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa lô hàng");
      notify(`Đã xóa lô hàng ${name}`);
      fetchShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  // Open Form to Add New SKU
  const handleOpenAddSku = () => {
    const curStore = stores.find((s) => s.id === selectedStoreId);
    setSkuFormData({
      ...emptySkuForm,
      brand: curStore ? curStore.name : "",
    });
    setShowSkuModal(true);
  };

  // Open Form to Edit Existing SKU
  const handleOpenEditSku = (item: SkuMasterItem) => {
    setSkuFormData({
      id: item.id,
      sku: item.sku || "",
      brand: item.brand || "",
      product_type: item.product_type || "",
      mockup_url: item.mockup_url || item.mockup || "",
      asin: item.asin || "",
      fnsku: item.fnsku || "",
      amazon_fee: item.amazon_fee != null ? String(item.amazon_fee) : "",
      referral_fee_pct: item.referral_fee_pct != null ? String(item.referral_fee_pct) : "",
      pic_mkt: item.pic_mkt || "",
      loai: item.loai || "",
      niche: item.niche || "",
      pic_idea: item.pic_idea || "",
      status: item.status || "Active",
      event: item.event || "",
      tinh_trang: item.tinh_trang || "",
      design_pic: item.design_pic || "",
      thang_listing: item.thang_listing || "",
      thang_danh_gia: item.thang_danh_gia || "",
      event_250th: item.event_250th || "",
      ngay_danh_gia_sku_event: item.ngay_danh_gia_sku_event || "",
      amazon_fba_fee_thay_doi: item.amazon_fba_fee_thay_doi != null ? String(item.amazon_fba_fee_thay_doi) : "",
      basecost_tb: item.basecost_tb != null ? String(item.basecost_tb) : "",
      brand_entity_id: item.brand_entity_id || "",
      creative_asins_video: item.creative_asins_video || "",
      creative_asins_collection: item.creative_asins_collection || "",
      video_media_ids: item.video_media_ids || "",
      creative_headline: item.creative_headline || "",
      brand_logo_asset_id: item.brand_logo_asset_id || "",
      landing_page_url: item.landing_page_url || "",
    });
    setShowSkuModal(true);
  };

  // Submit SKU Form (Add or Edit)
  const handleSaveSku = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skuFormData.sku.trim()) {
      notify("Vui lòng điền mã SKU!", "error");
      return;
    }
    if (!selectedStoreId) return;

    try {
      setSavingSku(true);
      const payload = {
        store_id: selectedStoreId,
        sku: skuFormData.sku.trim(),
        brand: skuFormData.brand.trim() || null,
        product_type: skuFormData.product_type.trim() || null,
        mockup: skuFormData.mockup_url.trim() || null,
        mockup_url: skuFormData.mockup_url.trim() || null,
        asin: skuFormData.asin.trim() || null,
        fnsku: skuFormData.fnsku.trim() || null,
        amazon_fee: skuFormData.amazon_fee ? parseFloat(skuFormData.amazon_fee) : null,
        referral_fee_pct: skuFormData.referral_fee_pct ? parseFloat(skuFormData.referral_fee_pct) : null,
        pic_mkt: skuFormData.pic_mkt.trim() || null,
        loai: skuFormData.loai.trim() || null,
        niche: skuFormData.niche.trim() || null,
        pic_idea: skuFormData.pic_idea.trim() || null,
        status: skuFormData.status.trim() || "Active",
        event: skuFormData.event.trim() || null,
        tinh_trang: skuFormData.tinh_trang.trim() || null,
        design_pic: skuFormData.design_pic.trim() || null,
        thang_listing: skuFormData.thang_listing.trim() || null,
        thang_danh_gia: skuFormData.thang_danh_gia.trim() || null,
        event_250th: skuFormData.event_250th.trim() || null,
        ngay_danh_gia_sku_event: skuFormData.ngay_danh_gia_sku_event.trim() || null,
        amazon_fba_fee_thay_doi: skuFormData.amazon_fba_fee_thay_doi ? parseFloat(skuFormData.amazon_fba_fee_thay_doi) : null,
        basecost_tb: skuFormData.basecost_tb ? parseFloat(skuFormData.basecost_tb) : null,
        brand_entity_id: skuFormData.brand_entity_id.trim() || null,
        creative_asins_video: skuFormData.creative_asins_video.trim() || null,
        creative_asins_collection: skuFormData.creative_asins_collection.trim() || null,
        video_media_ids: skuFormData.video_media_ids.trim() || null,
        creative_headline: skuFormData.creative_headline.trim() || null,
        brand_logo_asset_id: skuFormData.brand_logo_asset_id.trim() || null,
        landing_page_url: skuFormData.landing_page_url.trim() || null,
      };

      const res = await fetch("/api/accounting/inventory/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Lỗi khi lưu SKU");
      }

      notify(skuFormData.id ? "Đã cập nhật phôi SKU thành công!" : "Đã tạo phôi SKU mới thành công!");
      setShowSkuModal(false);
      fetchSkus();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSavingSku(false);
    }
  };

  // Open Form to Add New Shipment
  const handleOpenAddShipment = () => {
    const curStore = stores.find((s) => s.id === selectedStoreId);
    setShipmentFormData({
      ...emptyShipmentForm,
      brand: curStore ? curStore.name : "",
    });
    setShowShipmentModal(true);
  };

  // Open Form to Edit Existing Shipment
  const handleOpenEditShipment = (item: InboundShipmentItem) => {
    setShipmentFormData({
      id: item.id,
      sku: item.sku || "",
      brand: item.brand || "",
      sup: item.sup || "",
      ngay_request: item.ngay_request || "",
      product_type: item.product_type || "",
      mockup: item.mockup || "",
      quantity: item.quantity != null ? String(item.quantity) : "",
      line_ship: item.line_ship || "",
      base_cost_per_unit: item.base_cost_per_unit != null ? String(item.base_cost_per_unit) : "",
      card: item.card != null ? String(item.card) : "",
      tag: item.tag != null ? String(item.tag) : "",
      shipping_fee: item.shipping_fee != null ? String(item.shipping_fee) : "",
      hop_tui: item.hop_tui != null ? String(item.hop_tui) : "",
      final_basecost: item.final_basecost != null ? String(item.final_basecost) : "",
      total_basecost: item.total_basecost != null ? String(item.total_basecost) : "",
      ngay_thanh_toan: item.ngay_thanh_toan || "",
      ten_lo_hang: item.ten_lo_hang || "",
      shipment_id: item.shipment_id || "",
      ngay_di: item.ngay_di || "",
      ngay_den: item.ngay_den || "",
      amazon_received: item.amazon_received != null ? String(item.amazon_received) : "",
      tinh_trang_hang_den_kho: item.tinh_trang_hang_den_kho || "",
      status: item.status || "In Transit",
      so_luong_amazon_nhan: item.so_luong_amazon_nhan != null ? String(item.so_luong_amazon_nhan) : "",
      discrepancy: item.discrepancy != null ? String(item.discrepancy) : "",
      note: item.note || "",
      trang_thai: item.trang_thai || "",
    });
    setShowShipmentModal(true);
  };

  // Submit Shipment Form (Add or Edit)
  const handleSaveShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipmentFormData.sku.trim()) {
      notify("Vui lòng điền mã SKU cho lô hàng!", "error");
      return;
    }
    if (!selectedStoreId) return;

    try {
      setSavingShipment(true);
      const payload = {
        store_id: selectedStoreId,
        sku: shipmentFormData.sku.trim(),
        brand: shipmentFormData.brand.trim() || null,
        sup: shipmentFormData.sup.trim() || null,
        ngay_request: shipmentFormData.ngay_request.trim() || null,
        product_type: shipmentFormData.product_type.trim() || null,
        mockup: shipmentFormData.mockup.trim() || null,
        quantity: shipmentFormData.quantity ? parseInt(shipmentFormData.quantity, 10) : 0,
        line_ship: shipmentFormData.line_ship.trim() || null,
        base_cost_per_unit: shipmentFormData.base_cost_per_unit ? parseFloat(shipmentFormData.base_cost_per_unit) : null,
        card: shipmentFormData.card ? parseFloat(shipmentFormData.card) : null,
        tag: shipmentFormData.tag ? parseFloat(shipmentFormData.tag) : null,
        shipping_fee: shipmentFormData.shipping_fee ? parseFloat(shipmentFormData.shipping_fee) : null,
        hop_tui: shipmentFormData.hop_tui ? parseFloat(shipmentFormData.hop_tui) : null,
        final_basecost: shipmentFormData.final_basecost ? parseFloat(shipmentFormData.final_basecost) : null,
        total_basecost: shipmentFormData.total_basecost ? parseFloat(shipmentFormData.total_basecost) : null,
        ngay_thanh_toan: shipmentFormData.ngay_thanh_toan.trim() || null,
        ten_lo_hang: shipmentFormData.ten_lo_hang.trim() || null,
        shipment_id: shipmentFormData.shipment_id.trim() || null,
        ngay_di: shipmentFormData.ngay_di.trim() || null,
        ngay_den: shipmentFormData.ngay_den.trim() || null,
        amazon_received: shipmentFormData.amazon_received ? parseInt(shipmentFormData.amazon_received, 10) : null,
        tinh_trang_hang_den_kho: shipmentFormData.tinh_trang_hang_den_kho.trim() || null,
        status: shipmentFormData.status.trim() || "In Transit",
        so_luong_amazon_nhan: shipmentFormData.so_luong_amazon_nhan ? parseInt(shipmentFormData.so_luong_amazon_nhan, 10) : null,
        discrepancy: shipmentFormData.discrepancy ? parseInt(shipmentFormData.discrepancy, 10) : null,
        note: shipmentFormData.note.trim() || null,
        trang_thai: shipmentFormData.trang_thai.trim() || null,
      };

      const res = await fetch("/api/accounting/inventory/inbound-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Lỗi khi lưu lô hàng");
      }

      notify(shipmentFormData.id ? "Đã cập nhật lô hàng thành công!" : "Đã tạo lô hàng mới thành công!");
      setShowShipmentModal(false);
      fetchShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSavingShipment(false);
    }
  };

  // Import Action
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedStoreId) return;

    const formData = new FormData();
    formData.append("store_id", selectedStoreId);
    formData.append("type", activeTab);
    formData.append("file", file);

    try {
      setImporting(true);
      setImportResult(null);
      const res = await fetch("/api/accounting/inventory/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi khi import file");
      setImportResult(data);
      const label = activeTab === "sku" ? "SKU" : "lô hàng";
      notify(`Đã import thành công ${data.count} ${label}!`);
      if (activeTab === "sku") fetchSkus();
      else fetchShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="w-full space-y-2.5">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-2xl transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
          }`}
        >
          {toast.type === "success" ? <CheckCircleIcon size={20} /> : <WarningCircleIcon size={20} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* TOP HEADER: Store Switcher on the same top line to pull functional tabs UP */}
      <div className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Left: Title + Store Selector directly next to it */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 pr-3 border-r border-slate-200">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-black text-sm shadow-xs">
                <PackageIcon size={16} weight="bold" />
              </span>
              <h1 className="text-base font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
                Inventory
              </h1>
            </div>

            {/* Store selector: store changes are infrequent, so keep the header compact. */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="inventory-store-select"
                className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500"
              >
                Store
              </label>
              <select
                id="inventory-store-select"
                value={selectedStoreId}
                onChange={(event) => handleStoreSelect(event.target.value)}
                disabled={loadingStores || stores.length === 0}
                aria-label="Chọn Store để xem dữ liệu Inventory"
                className="min-w-[220px] rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 shadow-2xs outline-none transition hover:border-slate-400 hover:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {loadingStores ? (
                  <option value="">Đang tải danh sách Store...</option>
                ) : stores.length === 0 ? (
                  <option value="">Chưa có Store</option>
                ) : (
                  stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Right: Action Buttons: Thêm phôi/lô hàng (KHÔNG THỪA DẤU CỘNG) + Import + Reload */}
          <div className="flex items-center gap-2 self-end lg:self-center">
            {activeTab === "sku" ? (
              <button
                type="button"
                onClick={handleOpenAddSku}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition shadow-xs cursor-pointer"
              >
                <PlusIcon size={15} weight="bold" />
                <span>Thêm Phôi</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenAddShipment}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition shadow-xs cursor-pointer"
              >
                <PlusIcon size={15} weight="bold" />
                <span>Thêm Lô Hàng</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowImportModal(true);
                setImportResult(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
            >
              <UploadSimpleIcon size={15} weight="bold" />
              <span>{activeTab === "sku" ? "Nhập Bảng Mã" : "Nhập Đi Hàng"}</span>
            </button>

            <a
              href={`/api/accounting/inventory/export?store_id=${selectedStoreId}&type=${activeTab}`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
              title="Xuất Excel toàn bộ dữ liệu từ Server"
            >
              <FileXlsIcon size={15} weight="bold" />
              <span>Xuất Excel</span>
            </a>

            <button
              type="button"
              onClick={() => (activeTab === "sku" ? fetchSkus() : fetchShipments())}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
              title="Tải lại bảng dữ liệu"
            >
              <ArrowClockwiseIcon
                size={15}
                weight="bold"
                className={loadingSkus || loadingShipments ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>
      </div>

      {/* TABS & QUICK FILTER BAR: Sheet tabs + Quick Filter in ONE compact line */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 bg-slate-200/70 p-1.5 rounded-xl border border-slate-300">
        {/* Sheet Tabs like Excel */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("sku")}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide transition-all cursor-pointer ${
              activeTab === "sku"
                ? "bg-emerald-600 text-white shadow-sm font-black border border-emerald-700"
                : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
            }`}
          >
            <PackageIcon size={16} weight="bold" />
            <span>Bảng Mã</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                activeTab === "sku" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
              }`}
            >
              {skuTotal}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("inbound")}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide transition-all cursor-pointer ${
              activeTab === "inbound"
                ? "bg-emerald-600 text-white shadow-sm font-black border border-emerald-700"
                : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
            }`}
          >
            <TruckIcon size={16} weight="bold" />
            <span>Chi Tiết Đi Hàng</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                activeTab === "inbound" ? "bg-emerald-700 text-white" : "bg-slate-300 text-slate-700"
              }`}
            >
              {shipmentTotal}
            </span>
          </button>
        </div>

        {/* Filter Controls inline + Table Zoom Controls */}
        {activeTab === "sku" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative min-w-[220px]">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm SKU, ASIN, Niche..."
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
            <select
              value={skuTypeFilter}
              onChange={(e) => setSkuTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer"
            >
              <option value="">Tất cả Loại Phôi</option>
              {existingProductTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={skuStatusFilter}
              onChange={(e) => setSkuStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer"
            >
              <option value="">Tất cả Trạng thái</option>
              <option value="Active">Active</option>
              <option value="Phát triển">Phát triển</option>
              <option value="Inactive">Inactive</option>
              <option value="Đã updated">Đã updated</option>
            </select>

            {/* Zoom Controls (+ / -) */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
              <button
                type="button"
                onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                className="h-6 w-6 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                title="Thu nhỏ bảng (-10%)"
              >
                <MinusIcon size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => setTableZoom(100)}
                className="px-1.5 py-0.5 text-[11px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                title="Đặt lại cỡ 100%"
              >
                {tableZoom}%
              </button>
              <button
                type="button"
                onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                className="h-6 w-6 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                title="Phóng to bảng (+10%)"
              >
                <PlusIcon size={13} weight="bold" />
              </button>
            </div>

            <span className="text-xs font-bold text-slate-700 whitespace-nowrap px-1">
              Trang {skuPage}/{skuTotalPages} • {skuTotal.toLocaleString()} SKU
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative min-w-[240px]">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm Tên lô, SKU, Shipment ID..."
                value={shipmentSearch}
                onChange={(e) => setShipmentSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
            <select
              value={shipmentStatusFilter}
              onChange={(e) => setShipmentStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer"
            >
              <option value="">Tất cả Trạng thái</option>
              <option value="In Transit">In Transit</option>
              <option value="Receiving">Receiving</option>
              <option value="Closed">Closed</option>
              <option value="Working">Working</option>
            </select>

            {/* Zoom Controls (+ / -) */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-2xs">
              <button
                type="button"
                onClick={() => setTableZoom((z) => Math.max(60, z - 10))}
                className="h-6 w-6 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                title="Thu nhỏ bảng (-10%)"
              >
                <MinusIcon size={13} weight="bold" />
              </button>
              <button
                type="button"
                onClick={() => setTableZoom(100)}
                className="px-1.5 py-0.5 text-[11px] font-mono font-bold text-slate-700 hover:text-indigo-600 cursor-pointer"
                title="Đặt lại cỡ 100%"
              >
                {tableZoom}%
              </button>
              <button
                type="button"
                onClick={() => setTableZoom((z) => Math.min(150, z + 10))}
                className="h-6 w-6 rounded flex items-center justify-center font-bold text-slate-700 hover:bg-white hover:text-indigo-600 hover:shadow-2xs active:scale-95 transition cursor-pointer"
                title="Phóng to bảng (+10%)"
              >
                <PlusIcon size={13} weight="bold" />
              </button>
            </div>

            <span className="text-xs font-bold text-slate-700 whitespace-nowrap px-1">
              Trang {shipmentPage}/{shipmentTotalPages} • {shipmentTotal.toLocaleString()} Lô
            </span>
          </div>
        )}
      </div>

      {/* TAB 1: SKU MASTER TABLE
          FROZEN COLUMNS: STT (left-0), Product Type (left-[56px]), Phôi Mockup (left-[230px]), Mã SKU (left-[326px])
          SOLID 100% OPAQUE BACKGROUND & CRISP DIVIDER LINE */}
      {activeTab === "sku" && (
        <div className="rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px]">
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table className="min-w-max w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs font-semibold uppercase tracking-[0.04em] whitespace-nowrap">
                  {/* FROZEN 1: STT */}
                  <th className="py-2 px-1 text-center w-[58px] min-w-[58px] bg-[#f59e0b] border-r border-amber-600 sticky left-0 z-40 text-xs text-slate-950">
                    STT
                  </th>
                  {/* FROZEN 2: Product Type */}
                  <th className="py-2 px-3 w-[155px] min-w-[155px] bg-[#f59e0b] border-r border-amber-600 sticky left-[58px] z-40 text-xs text-slate-950">
                    Product Type
                  </th>
                  {/* FROZEN 3: Mockup */}
                  <th className="py-2 px-1 text-center w-[76px] min-w-[76px] bg-[#f59e0b] border-r border-amber-600 sticky left-[213px] z-40 text-xs text-slate-950">
                    Mockup
                  </th>
                  {/* FROZEN 4: SKU */}
                  <th className="py-2 px-3 w-[160px] min-w-[160px] bg-[#f59e0b] border-r-2 !border-r-amber-800 sticky left-[289px] z-40 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] text-xs text-slate-950">
                    SKU
                  </th>

                  {/* SCROLLABLE COLUMNS (Exact names and vàng cam color from Excel) */}
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Brand</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">ASIN</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">FNSKU</th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>AMAZON FEE</div>
                    <div className="text-[10px] font-bold opacity-90">(chưa có referal fee)</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>%</div>
                    <div>Referal</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>PIC</div>
                    <div>MKT</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Loại</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Niche</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>PIC</div>
                    <div>Idea</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Trạng thái</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Event</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Tình trạng</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>DESIGN</div>
                    <div>PIC</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Mockup</div>
                    <div>url</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Tháng</div>
                    <div>listing</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Tháng</div>
                    <div>đánh giá</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Event</div>
                    <div>250th</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Ngày đánh giá</div>
                    <div>SKU Event</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Amazon FBA Fee</div>
                    <div>thay đổi</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Basecost</div>
                    <div>trung bình</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Brand Entity</div>
                    <div>ID</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Creative ASINs</div>
                    <div>(Video)</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Creative ASINs</div>
                    <div>(Collection)</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Video Media</div>
                    <div>IDs</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Creative</div>
                    <div>Headline</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Brand Logo</div>
                    <div>Asset ID</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Landing Page</div>
                    <div>URL</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingSkus ? (
                  <tr>
                    <td colSpan={32} className="py-20 text-center text-slate-500 font-bold text-base">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                      Đang tải Bảng Mã của Store {selectedStore?.name}...
                    </td>
                  </tr>
                ) : sortedSkus.length === 0 ? (
                  <tr>
                    <td colSpan={32} className="py-20 text-center text-slate-500 text-sm">
                      <PackageIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Chưa có SKU nào trong Store {selectedStore?.name}. Nhấn <strong>Thêm Phôi SKU</strong> hoặc <strong>Import Bảng Mã</strong> để nhập dữ liệu.
                    </td>
                  </tr>
                ) : (
                  sortedSkus.map((item, idx) => {
                    const stt = (skuPage - 1) * skuLimit + idx + 1;
                    return (
                      <tr
                        key={item.id}
                        className="group h-[52px] min-h-[52px] bg-white even:bg-[#f8fafc] hover:bg-[#fef9c3] transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200"
                      >
                          {/* FROZEN 1: STT with Pencil Button aligned */}
                          <td className="py-1 px-1 text-center font-mono text-xs font-bold text-slate-700 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-0 z-20">
                            <div className="flex items-center justify-between gap-1 w-full px-1">
                              <span className="w-5 text-center font-mono font-bold text-slate-600">{stt}</span>
                              <button
                                type="button"
                                onClick={() => handleOpenEditSku(item)}
                                className="p-1 rounded text-slate-400 hover:text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                                title="Sửa thông tin SKU này"
                              >
                                <PencilSimpleIcon size={14} weight="bold" />
                              </button>
                            </div>
                          </td>

                          {/* FROZEN 2: Product Type */}
                          <EditableCell
                            table="sku"
                            id={item.id}
                            field="product_type"
                            value={item.product_type}
                            display={<EntityBadge value={item.product_type} />}
                            className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[58px] z-20 text-xs"
                            inlineEditing={inlineEditing}
                            inlineSaving={inlineSaving}
                            onStartEdit={startInlineEdit}
                            onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                            onSave={handleSaveInlineCell}
                            onCancel={() => setInlineEditing(null)}
                          />

                          {/* FROZEN 3: Mockup */}
                          <td className="py-1 px-1 text-center bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[213px] z-20">
                            <MockupThumbnail
                              url={item.mockup_url || item.mockup}
                              alt={item.sku}
                              onPreview={(url) => setPreviewModalUrl(url)}
                            />
                          </td>

                          {/* FROZEN 4: SKU */}
                          <EditableCell
                            table="sku"
                            id={item.id}
                            field="sku"
                          value={item.sku}
                          display={
                            <span className="font-mono font-semibold text-slate-950 bg-slate-100 px-2 py-0.5 rounded-md text-xs border border-slate-300">
                              {item.sku}
                            </span>
                          }
                          className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r-2 !border-r-slate-500 sticky left-[289px] z-20 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        {/* SCROLLABLE DATA CELLS */}
                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="brand"
                          value={item.brand}
                          display={<span className="font-semibold text-slate-800">{safeDisplay(item.brand)}</span>}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="asin"
                          value={item.asin}
                          display={safeDisplay(item.asin)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-bold text-slate-900 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="fnsku"
                          value={item.fnsku}
                          display={safeDisplay(item.fnsku)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-800 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="amazon_fee"
                          value={item.amazon_fee}
                          display={item.amazon_fee != null ? `$${item.amazon_fee.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-center font-mono font-bold text-pink-950 bg-pink-50/80 group-even:bg-pink-100/40 border-r border-pink-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="referral_fee_pct"
                          value={item.referral_fee_pct}
                          display={
                            item.referral_fee_pct != null
                              ? `${(item.referral_fee_pct * 100).toFixed(0)}%`
                              : "—"
                          }
                          className="py-1.5 px-3 text-xs text-center font-mono font-semibold text-slate-900 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="pic_mkt"
                          value={item.pic_mkt}
                          display={<EntityBadge value={item.pic_mkt} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="loai"
                          value={item.loai}
                          display={<EntityBadge value={item.loai} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="niche"
                          value={item.niche}
                          display={<EntityBadge value={item.niche} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="pic_idea"
                          value={item.pic_idea}
                          display={<EntityBadge value={item.pic_idea} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="status"
                          value={item.status}
                          display={<StatusBadge status={item.status} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="event"
                          value={item.event}
                          display={<EntityBadge value={item.event} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="tinh_trang"
                          value={item.tinh_trang}
                          display={<EntityBadge value={item.tinh_trang} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="design_pic"
                          value={item.design_pic}
                          display={<EntityBadge value={item.design_pic} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <td className="py-1.5 px-3 text-xs border-r border-slate-200">
                          {item.mockup_url ? (
                            <a
                              href={item.mockup_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition"
                            >
                              <ArrowSquareOutIcon size={14} weight="bold" />
                              <span>Mở link</span>
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="thang_listing"
                          value={item.thang_listing}
                          display={safeDisplay(formatDate(item.thang_listing))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="thang_danh_gia"
                          value={item.thang_danh_gia}
                          display={safeDisplay(formatDate(item.thang_danh_gia))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="event_250th"
                          value={item.event_250th}
                          display={safeDisplay(formatDate(item.event_250th))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="ngay_danh_gia_sku_event"
                          value={item.ngay_danh_gia_sku_event}
                          display={safeDisplay(formatDate(item.ngay_danh_gia_sku_event))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="amazon_fba_fee_thay_doi"
                          value={item.amazon_fba_fee_thay_doi}
                          display={
                            item.amazon_fba_fee_thay_doi != null
                              ? `$${item.amazon_fba_fee_thay_doi.toFixed(2)}`
                              : "—"
                          }
                          className="py-1.5 px-3 text-xs text-right font-mono font-semibold text-pink-950 bg-pink-50/50 group-even:bg-pink-100/30 border-r border-pink-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="basecost_tb"
                          value={item.basecost_tb}
                          display={item.basecost_tb != null ? `$${item.basecost_tb.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-black text-slate-950 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="brand_entity_id"
                          value={item.brand_entity_id}
                          display={safeDisplay(item.brand_entity_id)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="creative_asins_video"
                          value={item.creative_asins_video}
                          display={safeDisplay(item.creative_asins_video)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="creative_asins_collection"
                          value={item.creative_asins_collection}
                          display={safeDisplay(item.creative_asins_collection)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="video_media_ids"
                          value={item.video_media_ids}
                          display={safeDisplay(item.video_media_ids)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="creative_headline"
                          value={item.creative_headline}
                          display={safeDisplay(item.creative_headline)}
                          className="py-1.5 px-3 text-xs text-slate-900 font-semibold border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="sku"
                          id={item.id}
                          field="brand_logo_asset_id"
                          value={item.brand_logo_asset_id}
                          display={safeDisplay(item.brand_logo_asset_id)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <td className="py-1.5 px-3 text-xs border-r border-slate-200">
                          {item.landing_page_url ? (
                            <a
                              href={item.landing_page_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-200 transition"
                            >
                              <ArrowSquareOutIcon size={14} weight="bold" />
                              <span>Landing Page</span>
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        {/* THAO TÁC: Sửa, Xem chi tiết, Xóa */}
                        <td className="py-1.5 px-3 text-xs text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditSku(item)}
                              className="rounded-lg bg-indigo-50 border border-indigo-200 p-1 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                              title="Sửa thông tin phôi SKU"
                            >
                              <PencilSimpleIcon size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedSkuDetail(item)}
                              className="rounded-lg bg-slate-100 border border-slate-200 p-1 text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                              title="Xem chi tiết"
                            >
                              <EyeIcon size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSku(item.id, item.sku)}
                              className="rounded-lg bg-rose-50 border border-rose-200 p-1 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                              title="Xóa phôi SKU"
                            >
                              <TrashIcon size={16} weight="bold" />
                            </button>
                          </div>
                        </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
          </div>

          {/* Pagination Bar 50/1 */}
          <PaginationBar
            page={skuPage}
            totalPages={skuTotalPages}
            totalItems={skuTotal}
            limit={skuLimit}
            onPageChange={setSkuPage}
            onLimitChange={(l) => {
              setSkuLimit(l);
              setSkuPage(1);
            }}
            label="SKU"
          />
        </div>
      )}

      {/* TAB 2: INBOUND SHIPMENTS TABLE
          FROZEN COLUMNS: STT (left-0), Product Type (left-[56px]), Mockup (left-[230px]), Mã SKU (left-[326px]) */}
      {activeTab === "inbound" && (
        <div className="rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px]">
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table className="min-w-max w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs font-semibold uppercase tracking-[0.04em] whitespace-nowrap">
                  {/* FROZEN 1: STT */}
                  <th className="py-2 px-1 text-center w-[58px] min-w-[58px] bg-[#f59e0b] border-r border-amber-600 sticky left-0 z-40 text-xs text-slate-950">
                    STT
                  </th>
                  {/* FROZEN 2: Product Type */}
                  <th className="py-2 px-3 w-[155px] min-w-[155px] bg-[#f59e0b] border-r border-amber-600 sticky left-[58px] z-40 text-xs text-slate-950">
                    Product Type
                  </th>
                  {/* FROZEN 3: Mockup */}
                  <th className="py-2 px-1 text-center w-[76px] min-w-[76px] bg-[#f59e0b] border-r border-amber-600 sticky left-[213px] z-40 text-xs text-slate-950">
                    Mockup
                  </th>
                  {/* FROZEN 4: SKU */}
                  <th className="py-2 px-3 w-[160px] min-w-[160px] bg-[#f59e0b] border-r-2 !border-r-amber-800 sticky left-[289px] z-40 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] text-xs text-slate-950">
                    SKU
                  </th>

                  {/* SCROLLABLE INBOUND COLUMNS (Exact names and vàng cam color from Excel) */}
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">BRAND</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">SUP</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Ngày</div>
                    <div>request</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Quantity</th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Line</div>
                    <div>ship</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Base Cost</div>
                    <div>/Unit</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Card</th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Tag</th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Shipping</div>
                    <div>fee</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Hộp/túi</th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Final</div>
                    <div>Basecost</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Total</div>
                    <div>Basecost</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Ngày</div>
                    <div>thanh toán</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Tên lô hàng</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Shipment</div>
                    <div>ID</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Ngày đi</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Ngày đến</th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Amazon</div>
                    <div>Received</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Tình trạng hàng</div>
                    <div>đến kho</div>
                  </th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Status</th>
                  <th className="py-2 px-3 text-xs text-right bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight">
                    <div>Số lượng</div>
                    <div>Amazon nhận</div>
                  </th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Discrepancy</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Note</th>
                  <th className="py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60">Trạng thái</th>
                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingShipments ? (
                  <tr>
                    <td colSpan={29} className="py-20 text-center text-slate-500 font-bold text-base">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                      Đang tải danh sách lô hàng của Store {selectedStore?.name}...
                    </td>
                  </tr>
                ) : allShipments.length === 0 ? (
                  <tr>
                    <td colSpan={29} className="py-20 text-center text-slate-500 text-sm">
                      <TruckIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Chưa có lô hàng nào trong Store {selectedStore?.name}. Nhấn <strong>Thêm Lô Hàng</strong> hoặc <strong>Import Đi Hàng</strong> để nạp dữ liệu.
                    </td>
                  </tr>
                ) : (
                  allShipments.map((item, idx) => {
                    const stt = (shipmentPage - 1) * shipmentLimit + idx + 1;
                    return (
                      <tr
                        key={item.id}
                        className="group h-[52px] min-h-[52px] bg-white even:bg-[#f8fafc] hover:bg-[#fef9c3] transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200"
                      >
                          {/* FROZEN 1: STT with Pencil Button aligned */}
                          <td className="py-1 px-1 text-center font-mono text-xs font-bold text-slate-700 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-0 z-20">
                            <div className="flex items-center justify-between gap-1 w-full px-1">
                              <span className="w-5 text-center font-mono font-bold text-slate-600">{stt}</span>
                              <button
                                type="button"
                                onClick={() => handleOpenEditShipment(item)}
                                className="p-1 rounded text-slate-400 hover:text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                                title="Sửa lô hàng này"
                              >
                                <PencilSimpleIcon size={14} weight="bold" />
                              </button>
                            </div>
                          </td>

                          {/* FROZEN 2: Product Type */}
                          <EditableCell
                            table="inbound"
                            id={item.id}
                            field="product_type"
                            value={item.product_type}
                            display={<EntityBadge value={item.product_type} />}
                            className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[58px] z-20 text-xs"
                            inlineEditing={inlineEditing}
                            inlineSaving={inlineSaving}
                            onStartEdit={startInlineEdit}
                            onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                            onSave={handleSaveInlineCell}
                            onCancel={() => setInlineEditing(null)}
                          />

                          {/* FROZEN 3: Mockup */}
                          <td className="py-1 px-1 text-center bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[213px] z-20">
                            <MockupThumbnail
                              url={item.mockup}
                              alt={item.sku}
                              onPreview={(url) => setPreviewModalUrl(url)}
                            />
                          </td>

                          {/* FROZEN 4: SKU */}
                          <EditableCell
                            table="inbound"
                            id={item.id}
                            field="sku"
                          value={item.sku}
                          display={
                            <span className="font-mono font-bold text-slate-950 bg-slate-100 px-2 py-0.5 rounded-md text-xs border border-slate-300">
                              {item.sku}
                            </span>
                          }
                          className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r-2 !border-r-slate-500 sticky left-[289px] z-20 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        {/* SCROLLABLE INBOUND DATA */}
                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="brand"
                          value={item.brand}
                          display={<span className="font-semibold text-slate-800">{safeDisplay(item.brand)}</span>}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="sup"
                          value={item.sup}
                          display={<EntityBadge value={item.sup} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="ngay_request"
                          value={item.ngay_request}
                          display={safeDisplay(formatDate(item.ngay_request))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="quantity"
                          value={item.quantity}
                          display={item.quantity?.toLocaleString() || 0}
                          className="py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-950 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="line_ship"
                          value={item.line_ship}
                          display={<EntityBadge value={item.line_ship} />}
                          className="py-1.5 px-3 text-xs text-center border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="base_cost_per_unit"
                          value={item.base_cost_per_unit}
                          display={item.base_cost_per_unit != null ? `$${item.base_cost_per_unit.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-semibold text-slate-900 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="card"
                          value={item.card}
                          display={item.card != null ? `$${item.card.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono text-slate-800 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="tag"
                          value={item.tag}
                          display={item.tag != null ? `$${item.tag.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono text-slate-800 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="shipping_fee"
                          value={item.shipping_fee}
                          display={item.shipping_fee != null ? `$${item.shipping_fee.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono text-slate-800 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="hop_tui"
                          value={item.hop_tui}
                          display={item.hop_tui != null ? `$${item.hop_tui.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono text-slate-800 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="final_basecost"
                          value={item.final_basecost}
                          display={item.final_basecost != null ? `$${item.final_basecost.toFixed(2)}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-950 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="total_basecost"
                          value={item.total_basecost}
                          display={item.total_basecost != null ? `$${item.total_basecost.toLocaleString()}` : "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-black text-indigo-700 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="ngay_thanh_toan"
                          value={item.ngay_thanh_toan}
                          display={safeDisplay(formatDate(item.ngay_thanh_toan))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="ten_lo_hang"
                          value={item.ten_lo_hang}
                          display={safeDisplay(item.ten_lo_hang)}
                          className="py-1.5 px-3 text-xs font-semibold text-slate-900 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="shipment_id"
                          value={item.shipment_id}
                          display={safeDisplay(item.shipment_id)}
                          className="py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-800 border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="ngay_di"
                          value={item.ngay_di}
                          display={safeDisplay(formatDate(item.ngay_di))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="ngay_den"
                          value={item.ngay_den}
                          display={safeDisplay(formatDate(item.ngay_den))}
                          className="py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="amazon_received"
                          value={item.amazon_received}
                          display={item.amazon_received?.toLocaleString() || "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-900 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="tinh_trang_hang_den_kho"
                          value={item.tinh_trang_hang_den_kho}
                          display={<EntityBadge value={item.tinh_trang_hang_den_kho} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="status"
                          value={item.status}
                          display={<StatusBadge status={item.status} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="so_luong_amazon_nhan"
                          value={item.so_luong_amazon_nhan}
                          display={item.so_luong_amazon_nhan?.toLocaleString() || "—"}
                          className="py-1.5 px-3 text-xs text-right font-mono font-bold text-emerald-700 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="discrepancy"
                          value={item.discrepancy}
                          display={
                            item.discrepancy ? (
                              <span className="font-mono font-bold text-rose-600">
                                {item.discrepancy}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )
                          }
                          className="py-1.5 px-3 text-xs text-center border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="note"
                          value={item.note}
                          display={safeDisplay(item.note)}
                          className="py-1.5 px-3 text-xs text-slate-800 border-r border-slate-200 text-xs"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />

                        <EditableCell
                          table="inbound"
                          id={item.id}
                          field="trang_thai"
                          value={item.trang_thai}
                          display={<EntityBadge value={item.trang_thai} />}
                          className="py-1.5 px-3 text-xs border-r border-slate-200"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />
                        {/* THAO TÁC: Sửa, Xem chi tiết, Xóa */}
                        <td className="py-1.5 px-3 text-xs text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditShipment(item)}
                              className="rounded-lg bg-indigo-50 border border-indigo-200 p-1 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                              title="Sửa thông tin lô hàng"
                            >
                              <PencilSimpleIcon size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedShipmentDetail(item)}
                              className="rounded-lg bg-slate-100 border border-slate-200 p-1 text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                              title="Xem chi tiết"
                            >
                              <EyeIcon size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteShipment(item.id, item.ten_lo_hang || item.sku)}
                              className="rounded-lg bg-rose-50 border border-rose-200 p-1 text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                              title="Xóa lô hàng"
                            >
                              <TrashIcon size={16} weight="bold" />
                            </button>
                          </div>
                        </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Bar 50/1 */}
        <PaginationBar
          page={shipmentPage}
          totalPages={shipmentTotalPages}
          totalItems={shipmentTotal}
          limit={shipmentLimit}
          onPageChange={setShipmentPage}
          onLimitChange={(l) => {
            setShipmentLimit(l);
            setShipmentPage(1);
          }}
          label="Lô hàng"
        />
      </div>
    )}

      {/* MODAL 1: NHÂN VIÊN ĐIỀN THÊM PHÔI MỚI HOẶC SỬA PHÔI CŨ (SKU MASTER) */}
      {showSkuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
                  {skuFormData.id ? <PencilSimpleIcon size={18} /> : <PlusIcon size={18} />}
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {skuFormData.id ? `Sửa Thông Tin Phôi: ${skuFormData.sku}` : "Thêm Phôi / SKU Mới Cho Nhân Viên"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Store: <strong className="text-indigo-700">{selectedStore?.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSkuModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <XIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveSku} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* SKU */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Mã SKU <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: MTL24052503PQ"
                    value={skuFormData.sku}
                    onChange={(e) => setSkuFormData({ ...skuFormData, sku: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Brand */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Brand / Nhãn hàng</label>
                  <input
                    type="text"
                    placeholder="VD: LIMIMA"
                    value={skuFormData.brand}
                    onChange={(e) => setSkuFormData({ ...skuFormData, brand: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Product Type with SMART AUTOCOMPLETE & PREDICTION */}
                <ProductTypeInput
                  value={skuFormData.product_type}
                  onChange={(val) => setSkuFormData({ ...skuFormData, product_type: val })}
                  existingTypes={existingProductTypes}
                />

                {/* Mockup URL / Link phôi ảnh */}
                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700">Link Ảnh Mockup (URL ảnh trực tiếp)</label>
                  <input
                    type="url"
                    placeholder="https://... (Link ảnh phôi để hiển thị ảnh to trong bảng)"
                    value={skuFormData.mockup_url}
                    onChange={(e) => setSkuFormData({ ...skuFormData, mockup_url: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Preview Image if entered */}
                <div className="space-y-1 flex flex-col items-center justify-center">
                  <span className="font-bold text-slate-700 text-[11px]">Xem trước ảnh phôi</span>
                  {skuFormData.mockup_url ? (
                    <div className="h-14 w-14 rounded-lg border border-slate-300 p-0.5 overflow-hidden bg-white">
                      <img src={getOptimizedThumbnailUrl(skuFormData.mockup_url) || skuFormData.mockup_url} alt="preview" className="h-full w-full object-contain" />
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400">Chưa có link ảnh</span>
                  )}
                </div>

                {/* ASIN */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">ASIN</label>
                  <input
                    type="text"
                    placeholder="VD: B0F9THYHQ7"
                    value={skuFormData.asin}
                    onChange={(e) => setSkuFormData({ ...skuFormData, asin: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* FNSKU */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">FNSKU</label>
                  <input
                    type="text"
                    placeholder="VD: X004P9ZU6H"
                    value={skuFormData.fnsku}
                    onChange={(e) => setSkuFormData({ ...skuFormData, fnsku: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Amazon Fee */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Amazon Fee ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 4.55"
                    value={skuFormData.amazon_fee}
                    onChange={(e) => setSkuFormData({ ...skuFormData, amazon_fee: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Referral Fee Pct */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">% Referral (VD: 0.15 = 15%)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 0.15"
                    value={skuFormData.referral_fee_pct}
                    onChange={(e) => setSkuFormData({ ...skuFormData, referral_fee_pct: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* PIC MKT */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">PIC MKT</label>
                  <input
                    type="text"
                    placeholder="VD: Truong, Loan..."
                    value={skuFormData.pic_mkt}
                    onChange={(e) => setSkuFormData({ ...skuFormData, pic_mkt: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Loại */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Loại (FBA / FBM)</label>
                  <select
                    value={skuFormData.loai}
                    onChange={(e) => setSkuFormData({ ...skuFormData, loai: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="">Chọn loại fulfillment</option>
                    <option value="FBA">FBA</option>
                    <option value="FBM">FBM</option>
                  </select>
                </div>

                {/* Niche */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Niche</label>
                  <input
                    type="text"
                    placeholder="VD: Women, Men, Christmas..."
                    value={skuFormData.niche}
                    onChange={(e) => setSkuFormData({ ...skuFormData, niche: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* PIC Idea */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">PIC Idea</label>
                  <input
                    type="text"
                    placeholder="VD: Loan, Cường..."
                    value={skuFormData.pic_idea}
                    onChange={(e) => setSkuFormData({ ...skuFormData, pic_idea: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Trạng thái</label>
                  <select
                    value={skuFormData.status}
                    onChange={(e) => setSkuFormData({ ...skuFormData, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="Active">Active</option>
                    <option value="Phát triển">Phát triển</option>
                    <option value="Mới update">Mới update</option>
                    <option value="Đã update">Đã update</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>

                {/* Tình trạng */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tình trạng phôi</label>
                  <input
                    type="text"
                    placeholder="VD: Đang bán, Chuẩn bị bán..."
                    value={skuFormData.tinh_trang}
                    onChange={(e) => setSkuFormData({ ...skuFormData, tinh_trang: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Event */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Event</label>
                  <input
                    type="text"
                    placeholder="VD: Christmas, Mother's Day..."
                    value={skuFormData.event}
                    onChange={(e) => setSkuFormData({ ...skuFormData, event: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* DESIGN PIC */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">DESIGN PIC</label>
                  <input
                    type="text"
                    placeholder="VD: Designer Name"
                    value={skuFormData.design_pic}
                    onChange={(e) => setSkuFormData({ ...skuFormData, design_pic: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Basecost TB */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Basecost trung bình ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 3.90"
                    value={skuFormData.basecost_tb}
                    onChange={(e) => setSkuFormData({ ...skuFormData, basecost_tb: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Landing page url */}
                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700">Landing Page URL</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={skuFormData.landing_page_url}
                    onChange={(e) => setSkuFormData({ ...skuFormData, landing_page_url: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="col-span-full border-t border-slate-200 pt-3">
                  <p className="text-xs font-extrabold text-slate-800">Thông tin listing, phí & creative</p>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tháng listing</label>
                  <input
                    type="text"
                    placeholder="VD: 2026-10"
                    value={skuFormData.thang_listing}
                    onChange={(e) => setSkuFormData({ ...skuFormData, thang_listing: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tháng đánh giá</label>
                  <input
                    type="text"
                    placeholder="VD: 2026-11"
                    value={skuFormData.thang_danh_gia}
                    onChange={(e) => setSkuFormData({ ...skuFormData, thang_danh_gia: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Event 250th</label>
                  <input
                    type="text"
                    placeholder="VD: Black Friday"
                    value={skuFormData.event_250th}
                    onChange={(e) => setSkuFormData({ ...skuFormData, event_250th: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ngày đánh giá SKU Event</label>
                  <input
                    type="text"
                    placeholder="VD: 2026-10-15"
                    value={skuFormData.ngay_danh_gia_sku_event}
                    onChange={(e) => setSkuFormData({ ...skuFormData, ngay_danh_gia_sku_event: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Amazon FBA Fee thay đổi ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 0.35"
                    value={skuFormData.amazon_fba_fee_thay_doi}
                    onChange={(e) => setSkuFormData({ ...skuFormData, amazon_fba_fee_thay_doi: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Brand Entity ID</label>
                  <input
                    type="text"
                    placeholder="VD: ENTITY123"
                    value={skuFormData.brand_entity_id}
                    onChange={(e) => setSkuFormData({ ...skuFormData, brand_entity_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Creative ASINs Video</label>
                  <input
                    type="text"
                    placeholder="ASIN, phân cách bằng dấu phẩy"
                    value={skuFormData.creative_asins_video}
                    onChange={(e) => setSkuFormData({ ...skuFormData, creative_asins_video: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Creative ASINs Collection</label>
                  <input
                    type="text"
                    placeholder="ASIN, phân cách bằng dấu phẩy"
                    value={skuFormData.creative_asins_collection}
                    onChange={(e) => setSkuFormData({ ...skuFormData, creative_asins_collection: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Video Media IDs</label>
                  <input
                    type="text"
                    placeholder="Media ID, phân cách bằng dấu phẩy"
                    value={skuFormData.video_media_ids}
                    onChange={(e) => setSkuFormData({ ...skuFormData, video_media_ids: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700">Creative Headline</label>
                  <input
                    type="text"
                    placeholder="VD: Quà tặng cá nhân hóa cho mùa lễ"
                    value={skuFormData.creative_headline}
                    onChange={(e) => setSkuFormData({ ...skuFormData, creative_headline: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Brand Logo Asset ID</label>
                  <input
                    type="text"
                    placeholder="VD: logo_asset_123"
                    value={skuFormData.brand_logo_asset_id}
                    onChange={(e) => setSkuFormData({ ...skuFormData, brand_logo_asset_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowSkuModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingSku}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  <FloppyDiskIcon size={16} weight="bold" />
                  <span>{savingSku ? "Đang lưu..." : skuFormData.id ? "Cập nhật Phôi" : "Lưu Phôi Mới"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: NHÂN VIÊN ĐIỀN THÊM HOẶC SỬA LÔ HÀNG (INBOUND SHIPMENTS) */}
      {showShipmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
                  {shipmentFormData.id ? <PencilSimpleIcon size={18} /> : <PlusIcon size={18} />}
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {shipmentFormData.id ? `Sửa Thông Tin Lô Hàng: ${shipmentFormData.ten_lo_hang || shipmentFormData.sku}` : "Thêm Lô Hàng Đi Mới"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Store: <strong className="text-indigo-700">{selectedStore?.name}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowShipmentModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <XIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveShipment} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* SKU */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Mã SKU <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: MTL24052503PQ"
                    value={shipmentFormData.sku}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, sku: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Tên lô hàng */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tên lô hàng</label>
                  <input
                    type="text"
                    placeholder="VD: LÔ 1 THÁNG 5"
                    value={shipmentFormData.ten_lo_hang}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, ten_lo_hang: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Shipment ID */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Shipment ID</label>
                  <input
                    type="text"
                    placeholder="VD: FBA17XXXXXX"
                    value={shipmentFormData.shipment_id}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, shipment_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Quantity */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Số lượng (Quantity)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="VD: 500"
                    value={shipmentFormData.quantity}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, quantity: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* SUP */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">SUP (Nhà cung cấp)</label>
                  <input
                    type="text"
                    placeholder="VD: Xưởng A, Sup B"
                    value={shipmentFormData.sup}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, sup: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Line ship */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Line Ship</label>
                  <input
                    type="text"
                    placeholder="VD: AIR, SEA FAST..."
                    value={shipmentFormData.line_ship}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, line_ship: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Base Cost / Unit */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Base Cost/Unit ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 3.50"
                    value={shipmentFormData.base_cost_per_unit}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, base_cost_per_unit: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Final Basecost */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Final Basecost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 4.10"
                    value={shipmentFormData.final_basecost}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, final_basecost: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Total Basecost */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Total Basecost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="VD: 2050"
                    value={shipmentFormData.total_basecost}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, total_basecost: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Product Type with autocomplete */}
                <ProductTypeInput
                  value={shipmentFormData.product_type}
                  onChange={(val) => setShipmentFormData({ ...shipmentFormData, product_type: val })}
                  existingTypes={existingProductTypes}
                />

                {/* Ngày Request */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ngày Request</label>
                  <input
                    type="date"
                    value={shipmentFormData.ngay_request}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, ngay_request: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Ngày đi */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ngày đi</label>
                  <input
                    type="date"
                    value={shipmentFormData.ngay_di}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, ngay_di: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Ngày đến */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ngày đến</label>
                  <input
                    type="date"
                    value={shipmentFormData.ngay_den}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, ngay_den: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Status</label>
                  <select
                    value={shipmentFormData.status}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  >
                    <option value="In Transit">In Transit</option>
                    <option value="Receiving">Receiving</option>
                    <option value="Closed">Closed</option>
                    <option value="Working">Working</option>
                  </select>
                </div>

                {/* Số lượng Amazon nhận */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Số lượng Amazon nhận</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="VD: 500"
                    value={shipmentFormData.so_luong_amazon_nhan}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, so_luong_amazon_nhan: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Discrepancy */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Chênh lệch (Discrepancy)</label>
                  <input
                    type="number"
                    placeholder="VD: 0"
                    value={shipmentFormData.discrepancy}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, discrepancy: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Note */}
                <div className="space-y-1 md:col-span-3">
                  <label className="font-bold text-slate-700">Ghi chú (Note)</label>
                  <input
                    type="text"
                    placeholder="Ghi chú về lô hàng..."
                    value={shipmentFormData.note}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, note: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowShipmentModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingShipment}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  <FloppyDiskIcon size={16} weight="bold" />
                  <span>{savingShipment ? "Đang lưu..." : shipmentFormData.id ? "Cập nhật Lô Hàng" : "Lưu Lô Hàng Mới"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: IMPORT EXCEL */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
                  <FileXlsIcon size={18} weight="bold" />
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  {activeTab === "sku" ? "Nhập Dữ Liệu Bảng Mã (Excel)" : "Nhập Dữ Liệu Chi Tiết Đi Hàng (Excel)"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <XIcon size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900 space-y-1">
                <p className="font-bold">Đang nạp dữ liệu cho Store: {selectedStore?.name}</p>
                <p className="text-indigo-700">
                  Hệ thống tự động tìm đúng sheet <strong>{activeTab === "sku" ? "BẢNG MÃ" : "CHI TIẾT ĐI HÀNG"}</strong> trong file Excel để cập nhật.
                </p>
              </div>

              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 hover:border-indigo-400 hover:bg-indigo-50/20 transition cursor-pointer">
                <UploadSimpleIcon size={32} className="text-indigo-600 mb-2" weight="duotone" />
                <span className="text-sm font-bold text-slate-800">Chọn file Excel (.xlsx) từ máy tính</span>
                <span className="text-xs text-slate-500 mt-1">Dung lượng tối đa 50MB</span>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  disabled={importing}
                  className="hidden"
                />
              </label>

              {importing && (
                <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-indigo-700">
                  <ArrowClockwiseIcon size={16} className="animate-spin" />
                  <span>Đang xử lý và lưu dữ liệu vào hệ thống...</span>
                </div>
              )}

              {importResult && (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    importResult.success
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}
                >
                  <p className="font-bold">
                    {importResult.success
                      ? `Import thành công ${importResult.count} dòng dữ liệu!`
                      : "Có lỗi khi import dữ liệu."}
                  </p>
                  {importResult.errors && importResult.errors.length > 0 && (
                    <ul className="mt-2 list-disc pl-4 space-y-0.5 text-[11px] text-rose-700">
                      {importResult.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: XEM CHI TIẾT SKU */}
      {selectedSkuDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Chi Tiết Phôi SKU</h3>
                <p className="text-xs text-indigo-700 font-mono font-bold">{selectedSkuDetail.sku}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <XIcon size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Brand</span>
                <p className="font-bold text-slate-900">{selectedSkuDetail.brand || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Product Type</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.product_type || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">ASIN</span>
                <p className="font-mono font-bold text-slate-900">{selectedSkuDetail.asin || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">FNSKU</span>
                <p className="font-mono font-bold text-slate-900">{selectedSkuDetail.fnsku || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Amazon Fee</span>
                <p className="font-bold text-slate-900">{selectedSkuDetail.amazon_fee ? `$${selectedSkuDetail.amazon_fee}` : "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">% Referral</span>
                <p className="font-bold text-slate-900">{selectedSkuDetail.referral_fee_pct ? `${(selectedSkuDetail.referral_fee_pct * 100).toFixed(0)}%` : "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">PIC MKT</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.pic_mkt || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Niche</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.niche || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Trạng thái</span>
                <p className="font-bold text-slate-900">{selectedSkuDetail.status || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Event</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.event || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tình trạng</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.tinh_trang || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">DESIGN PIC</span>
                <p className="font-semibold text-slate-900">{selectedSkuDetail.design_pic || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 col-span-2 sm:col-span-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Mockup URL</span>
                <p className="font-mono text-xs text-indigo-700 break-all">
                  {selectedSkuDetail.mockup_url ? (
                    <a href={selectedSkuDetail.mockup_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {selectedSkuDetail.mockup_url}
                    </a>
                  ) : "—"}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: XEM CHI TIẾT LÔ HÀNG */}
      {selectedShipmentDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Chi Tiết Lô Hàng Đi</h3>
                <p className="text-xs text-indigo-700 font-mono font-bold">
                  {selectedShipmentDetail.ten_lo_hang || selectedShipmentDetail.shipment_id || selectedShipmentDetail.sku}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedShipmentDetail(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <XIcon size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Mã SKU</span>
                <p className="font-mono font-bold text-slate-900">{selectedShipmentDetail.sku}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Số lượng đi</span>
                <p className="font-bold text-slate-900">{selectedShipmentDetail.quantity?.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Số lượng nhận</span>
                <p className="font-bold text-emerald-700">
                  {selectedShipmentDetail.so_luong_amazon_nhan ?? selectedShipmentDetail.amazon_received ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Chênh lệch</span>
                <p className="font-bold text-rose-600">{selectedShipmentDetail.discrepancy || 0}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Line Ship</span>
                <p className="font-semibold text-slate-900">{selectedShipmentDetail.line_ship || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Final Basecost</span>
                <p className="font-bold text-slate-900">
                  {selectedShipmentDetail.final_basecost ? `$${selectedShipmentDetail.final_basecost.toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Total Basecost</span>
                <p className="font-black text-indigo-700">
                  {selectedShipmentDetail.total_basecost ? `$${selectedShipmentDetail.total_basecost.toLocaleString()}` : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tình trạng kho</span>
                <p className="font-semibold text-slate-900">{selectedShipmentDetail.tinh_trang_hang_den_kho || "—"}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                <p className="font-bold text-slate-900">{selectedShipmentDetail.status || "—"}</p>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedShipmentDetail(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PREVIEW MOCKUP ẢNH MỜ (BLURRY BACKDROP PREVIEW, KHÔNG CHUYỂN TRANG) */}
      {previewModalUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewModalUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 cursor-zoom-out"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl max-h-[85vh] p-2.5 bg-white/95 rounded-2xl shadow-2xl border border-white/20 flex flex-col items-center cursor-default overflow-hidden animate-in zoom-in-95 duration-150"
          >
            <button
              type="button"
              onClick={() => setPreviewModalUrl(null)}
              className="absolute top-3 right-3 z-10 rounded-full bg-black/60 hover:bg-black text-white p-1.5 transition cursor-pointer shadow-md"
              title="Đóng preview"
            >
              <XIcon size={18} weight="bold" />
            </button>
            <div className="relative flex items-center justify-center w-full max-h-[75vh] overflow-hidden rounded-xl bg-slate-100">
              <img
                src={getOptimizedThumbnailUrl(previewModalUrl) || previewModalUrl}
                alt="Mockup Preview"
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
              />
            </div>
            <div className="w-full flex items-center justify-between px-3 pt-2 text-xs text-slate-600">
              <span className="font-medium truncate max-w-[360px]">{previewModalUrl}</span>
              <a
                href={previewModalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-bold transition ml-2 shrink-0"
              >
                <span>Mở link gốc</span>
                <ArrowSquareOutIcon size={14} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
