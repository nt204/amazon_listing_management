"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  EyeIcon,
  FileXlsIcon,
  FloppyDiskIcon,
  ImageSquareIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  TruckIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { SkuMasterItem, InboundShipmentItem } from "@/lib/accounting/inventory-db";
import type { Store } from "@/lib/accounting/types";

const DEFAULT_PRODUCT_TYPES = [
  "11 Oz Glass",
  "11 Oz Mug",
  "20oz Tumbler",
  "Acrylic Ornament",
  "Acrylic Suncatcher Ornament",
  "Blanket",
  "Blanket Hoodie",
  "Book Nook",
  "Cake Topper",
  "Car Visor",
  "Ceramic Ornament",
  "Docking Station",
  "Garden Flag",
  "Glass Ornament",
  "Handprint Kit",
  "Hologram Ornament",
  "Kitchen Towel",
  "Makeup Bag",
  "Oodie",
  "Ornament",
  "Pillow",
  "Poster",
  "Resin Ornament",
  "Reserved Chair Sign",
  "Stained Glass Suncatcher",
  "Suncatcher Ornament",
  "Tumbler 20 Oz",
  "Wind Chime",
  "Wooden Ornament",
];

const DEFAULT_INBOUND_STATUS = [
  "Working",
  "In Transit",
  "Receiving",
  "Closed",
  "Cancelled",
  "Delivered",
];

const DEFAULT_INBOUND_TRANG_THAI = [
  "Phát triển",
  "Active",
  "Test",
  "Tối ưu",
  "Hủy",
  "Tạm dừng",
  "Đã updated",
];
import {
  ColumnManagerModal,
  type ColumnConfig,
  DEFAULT_SKU_COLUMNS,
  DEFAULT_INBOUND_COLUMNS,
  ColumnHeaderCell,
} from "./column-manager-modal";
import { InventoryHistoryDrawer } from "./inventory-history-drawer";

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

// Native datalist keeps a field editable while offering values already used in this Store.
function OptionTextInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder: string;
}) {
  const listId = useId();

  return (
    <>
      <input
        type="text"
        list={listId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </>
  );
}

function ProductTypeInput(props: Omit<React.ComponentProps<typeof OptionTextInput>, "placeholder">) {
  return (
    <div className="space-y-1">
      <label className="font-bold text-slate-700">
        Tên Phôi (Product Type) <span className="text-rose-500">*</span>
      </label>
      <OptionTextInput {...props} placeholder="Chọn từ Store hoặc nhập tên phôi..." />
    </div>
  );
}

export const SKU_COMBOBOX_FIELDS = new Set([
  "product_type",
  "pic_mkt",
  "loai",
  "niche",
  "pic_idea",
  "status",
  "event",
  "tinh_trang",
  "design_pic",
]);

export const INBOUND_COMBOBOX_FIELDS = new Set([
  "product_type",
  "line_ship",
  "status",
  "trang_thai",
]);

export function isComboboxField(table: "sku" | "inbound", fieldId: string): boolean {
  return table === "sku" ? SKU_COMBOBOX_FIELDS.has(fieldId) : INBOUND_COMBOBOX_FIELDS.has(fieldId);
}

export function isValidComboboxOption(val: unknown): boolean {
  if (val == null) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (
    s === "0" ||
    s === "0.00" ||
    s === "00" ||
    s === "000" ||
    s === "$0.00" ||
    s === "-" ||
    s === "—" ||
    s === "null" ||
    s === "undefined" ||
    s === "#N/A" ||
    s === "#REF!" ||
    s === "#VALUE!" ||
    s === "[object Object]"
  ) {
    return false;
  }
  return true;
}

export function cleanDateOnly(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") {
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString().split("T")[0];
    }
    return "";
  }
  let s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "-" ||
    s === "null" ||
    s === "undefined" ||
    s === "#N/A" ||
    s === "[object Object]"
  ) {
    return "";
  }
  if (s.includes("T")) s = s.split("T")[0].trim();
  if (s.includes(" 00:00:00")) s = s.split(" ")[0].trim();
  s = s.replace(/(\s+|T)?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/i, "").trim();
  return s;
}

export function isDateField(field: string): boolean {
  return [
    "ngay_request",
    "ngay_thanh_toan",
    "ngay_di",
    "ngay_den",
    "thang_listing",
    "thang_danh_gia",
    "event_250th",
    "ngay_danh_gia_sku_event",
  ].includes(field);
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

function getRawEditableString(val: unknown, field?: string): string {
  if (val == null) return "";
  if (typeof val === "object") {
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString().split("T")[0];
    }
    return "";
  }
  let s = String(val).trim();
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
  if (field && isDateField(field)) {
    return cleanDateOnly(s);
  }
  if (s.includes("T") && (s.endsWith("Z") || s.includes("T00:00:00") || s.includes(".000Z"))) {
    s = s.split("T")[0].trim();
  }
  if (s.includes(" 00:00:00")) {
    s = s.split(" ")[0].trim();
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
    options = [],
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
    options?: string[];
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
    const typed = localVal.trim().toLowerCase();
    const suggestedOptions = typed && localVal !== getRawEditableString(value)
      ? options.filter((option) => option.toLowerCase().includes(typed))
      : options;

    const hasOptions = options.length > 0;

    return (
      <td
        onDoubleClick={() => onStartEdit(table, id, field, value)}
        className={`group/cell relative cursor-pointer select-none transition-colors hover:bg-amber-100/60 ${className} ${
          isEditing ? "!z-[90] overflow-visible" : ""
        }`}
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
            title={hasOptions ? "Chọn hoặc sửa ô này" : "Sửa ô này"}
          >
            {hasOptions ? (
              <CaretDownIcon size={12} weight="bold" className="text-slate-600" />
            ) : (
              <PencilSimpleIcon size={12} weight="bold" />
            )}
          </button>
        )}

        {isEditing && (
          <div
            className="absolute inset-0 z-30 p-0.5 flex items-center bg-white rounded ring-2 ring-emerald-600 shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative h-full w-full">
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
                onBlur={commitSave}
                className={`h-full w-full rounded border border-emerald-500 bg-white px-2 ${hasOptions ? "pr-6" : ""} text-xs font-bold text-slate-950 focus:outline-none ${inputAlignClass}`}
              />
              {hasOptions && (
                <div className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <CaretDownIcon size={12} weight="bold" />
                </div>
              )}
              {hasOptions && (
                <div className="absolute left-0 top-full z-[100] mt-1 max-h-56 min-w-[200px] w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-2xl">
                  {suggestedOptions.slice(0, 40).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        isCommittingRef.current = true;
                        setLocalVal(option);
                        onSave(table, id, field, option);
                      }}
                      className="block w-full whitespace-nowrap rounded px-2.5 py-1.5 text-left text-xs font-semibold text-slate-800 hover:bg-indigo-50 hover:text-indigo-700"
                    >
                      {option}
                    </button>
                  ))}
                  {suggestedOptions.length === 0 && (
                    <div className="px-2.5 py-2 text-xs text-slate-400">Nhấn Enter để lưu giá trị mới</div>
                  )}
                </div>
              )}
            </div>
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
    if (prevProps.options?.length !== nextProps.options?.length) return false;
    if (prevProps.options?.some((option, index) => option !== nextProps.options?.[index])) return false;
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
  const s = cleanDateOnly(val);
  return s || "—";
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

  // Column management states
  const [skuColumns, setSkuColumns] = useState<ColumnConfig[]>(DEFAULT_SKU_COLUMNS);
  const [inboundColumns, setInboundColumns] = useState<ColumnConfig[]>(DEFAULT_INBOUND_COLUMNS);
  const [showColumnModal, setShowColumnModal] = useState(false);

  const SKU_COLUMNS_STORAGE_KEY = `accounting_sku_columns_${selectedStoreId || "none"}`;
  const INBOUND_COLUMNS_STORAGE_KEY = `accounting_inbound_columns_${selectedStoreId || "none"}`;

  // Load columns from localStorage (áp dụng đồng bộ tất cả store)
  useEffect(() => {
    try {
      const skuStored = localStorage.getItem(SKU_COLUMNS_STORAGE_KEY);
      if (skuStored) {
        const parsed: ColumnConfig[] = JSON.parse(skuStored);
        const defaultMap = new Map(DEFAULT_SKU_COLUMNS.map((def) => [def.id, def]));
        const ordered: ColumnConfig[] = [];
        const seenIds = new Set<string>();

        // Frozen columns always stay first
        for (const def of DEFAULT_SKU_COLUMNS.filter((c) => c.isFrozen)) {
          const found = parsed.find((p) => p.id === def.id);
          ordered.push(found ? { ...def, ...found, isFrozen: true } : def);
          seenIds.add(def.id);
        }

        // Add columns in the order saved by user in parsed
        for (const item of parsed) {
          if (seenIds.has(item.id)) continue;
          if (defaultMap.has(item.id)) {
            const def = defaultMap.get(item.id)!;
            ordered.push({ ...def, ...item, isFrozen: false });
            seenIds.add(item.id);
          } else if (item.isCustom) {
            ordered.push(item);
            seenIds.add(item.id);
          }
        }

        // Add any remaining default columns
        for (const def of DEFAULT_SKU_COLUMNS) {
          if (!seenIds.has(def.id)) {
            ordered.push(def);
            seenIds.add(def.id);
          }
        }
        setSkuColumns(ordered);
      } else {
        setSkuColumns(DEFAULT_SKU_COLUMNS);
      }

      const inboundStored = localStorage.getItem(INBOUND_COLUMNS_STORAGE_KEY);
      if (inboundStored) {
        const parsed: ColumnConfig[] = JSON.parse(inboundStored);
        const defaultMap = new Map(DEFAULT_INBOUND_COLUMNS.map((def) => [def.id, def]));
        const ordered: ColumnConfig[] = [];
        const seenIds = new Set<string>();

        // Frozen columns always stay first
        for (const def of DEFAULT_INBOUND_COLUMNS.filter((c) => c.isFrozen)) {
          const found = parsed.find((p) => p.id === def.id);
          ordered.push(found ? { ...def, ...found, isFrozen: true } : def);
          seenIds.add(def.id);
        }

        // Add columns in the order saved by user in parsed
        for (const item of parsed) {
          if (seenIds.has(item.id)) continue;
          if (defaultMap.has(item.id)) {
            const def = defaultMap.get(item.id)!;
            ordered.push({ ...def, ...item, isFrozen: false });
            seenIds.add(item.id);
          } else if (item.isCustom) {
            ordered.push(item);
            seenIds.add(item.id);
          }
        }

        // Add any remaining default columns
        for (const def of DEFAULT_INBOUND_COLUMNS) {
          if (!seenIds.has(def.id)) {
            ordered.push(def);
            seenIds.add(def.id);
          }
        }
        setInboundColumns(ordered);
      } else {
        setInboundColumns(DEFAULT_INBOUND_COLUMNS);
      }
    } catch {}
  }, [selectedStoreId, SKU_COLUMNS_STORAGE_KEY, INBOUND_COLUMNS_STORAGE_KEY]);

  const handleSaveSkuColumns = useCallback((newCols: ColumnConfig[]) => {
    setSkuColumns(newCols);
    try {
      localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify("Đã lưu thiết lập cột BẢNG MÃ cho Store này!", "success");
  }, [SKU_COLUMNS_STORAGE_KEY]);

  const handleResetSkuColumns = useCallback(() => {
    setSkuColumns(DEFAULT_SKU_COLUMNS);
    try {
      localStorage.removeItem(SKU_COLUMNS_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục cột BẢNG MÃ về mặc định!", "success");
  }, [SKU_COLUMNS_STORAGE_KEY]);

  const handleSaveInboundColumns = useCallback((newCols: ColumnConfig[]) => {
    setInboundColumns(newCols);
    try {
      localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify("Đã lưu thiết lập cột CHI TIẾT ĐI HÀNG cho Store này!", "success");
  }, [INBOUND_COLUMNS_STORAGE_KEY]);

  const handleResetInboundColumns = useCallback(() => {
    setInboundColumns(DEFAULT_INBOUND_COLUMNS);
    try {
      localStorage.removeItem(INBOUND_COLUMNS_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục cột CHI TIẾT ĐI HÀNG về mặc định!", "success");
  }, [INBOUND_COLUMNS_STORAGE_KEY]);

  const handleQuickHideColumn = useCallback((tab: "sku" | "inbound", colId: string) => {
    if (tab === "sku") {
      setSkuColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    } else {
      setInboundColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    }
  }, [SKU_COLUMNS_STORAGE_KEY, INBOUND_COLUMNS_STORAGE_KEY]);

  const skuColMap = useMemo(() => {
    const map: Record<string, ColumnConfig> = {};
    for (const c of skuColumns) map[c.id] = c;
    return map;
  }, [skuColumns]);

  const skuCustomColumns = useMemo(() => {
    return skuColumns.filter((c) => c.isCustom);
  }, [skuColumns]);

  const skuVisibleCount = useMemo(() => {
    return skuColumns.filter((c) => c.visible).length;
  }, [skuColumns]);

  const activeScrollableSkuColumns = useMemo(() => {
    return skuColumns.filter((c) => !c.isFrozen && c.visible !== false);
  }, [skuColumns]);

  const inboundColMap = useMemo(() => {
    const map: Record<string, ColumnConfig> = {};
    for (const c of inboundColumns) map[c.id] = c;
    return map;
  }, [inboundColumns]);

  const inboundCustomColumns = useMemo(() => {
    return inboundColumns.filter((c) => c.isCustom);
  }, [inboundColumns]);

  const inboundVisibleCount = useMemo(() => {
    return inboundColumns.filter((c) => c.visible).length;
  }, [inboundColumns]);

  const activeScrollableInboundColumns = useMemo(() => {
    return inboundColumns.filter((c) => !c.isFrozen && c.visible !== false);
  }, [inboundColumns]);

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

  const fieldOptionsQuery = useQuery({
    queryKey: ["inventory-field-options", selectedStoreId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/inventory/options?store_id=${selectedStoreId}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách lựa chọn của Store");
      return res.json() as Promise<{
        sku: Record<"product_type" | "pic_mkt" | "loai" | "niche" | "pic_idea" | "status" | "event" | "tinh_trang" | "design_pic", string[]>;
        inbound: Record<"product_type" | "sup" | "line_ship" | "status" | "trang_thai", string[]>;
      }>;
    },
    enabled: !!selectedStoreId,
  });

  const fieldSettingsQuery = useQuery({
    queryKey: ["inventory-field-settings", selectedStoreId],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/inventory/field-settings?store_id=${selectedStoreId}`);
      if (!res.ok) throw new Error("Không thể tải cấu hình cột");
      return res.json() as Promise<{ settings: Array<{ entity_type: "sku" | "inbound"; field_id: string; label: string; input_type: "text" | "select"; options: string[]; allow_custom_value: boolean }> }>;
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
  const [fieldEditor, setFieldEditor] = useState<{ entity_type: "sku" | "inbound"; field_id: string; label: string; input_type: "text" | "select"; options: string[]; allow_custom_value: boolean } | null>(null);
  const [newFieldOption, setNewFieldOption] = useState("");

  const scanOptionsFromRows = useCallback((tab: "sku" | "inbound", fieldId: string) => {
    if (!isComboboxField(tab, fieldId)) return [];
    const items = tab === "sku" ? allSkus : allShipments;
    const values = new Set<string>();
    for (const item of items) {
      const val = (item as any)[fieldId] ?? (item as any)?.custom_fields?.[fieldId];
      if (val != null && typeof val === "string") {
        const trimmed = val.trim();
        if (isValidComboboxOption(trimmed)) values.add(trimmed);
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [allSkus, allShipments]);

  const handleQuickRenameColumn = useCallback((tab: "sku" | "inbound", colId: string, currentLabel: string) => {
    const saved = fieldSettingsQuery.data?.settings.find((item) => item.entity_type === tab && item.field_id === colId);
    setNewFieldOption("");
    const isCombo = isComboboxField(tab, colId);

    if (!isCombo) {
      setFieldEditor({
        entity_type: tab,
        field_id: colId,
        label: saved?.label || currentLabel,
        input_type: "text",
        options: [],
        allow_custom_value: true,
      });
      return;
    }

    const scannedDb = tab === "sku"
      ? (fieldOptionsQuery.data?.sku as Record<string, string[]> | undefined)?.[colId]
      : (fieldOptionsQuery.data?.inbound as Record<string, string[]> | undefined)?.[colId];
    const rowValues = scanOptionsFromRows(tab, colId);

    let initialOptions: string[] = [];
    if (saved && Array.isArray(saved.options) && saved.options.length > 0) {
      initialOptions = saved.options.filter(isValidComboboxOption);
    } else {
      initialOptions = [...new Set([...(scannedDb || []), ...rowValues])].filter(isValidComboboxOption);
      if (colId === "product_type" && initialOptions.length === 0) {
        initialOptions = DEFAULT_PRODUCT_TYPES.filter(isValidComboboxOption);
      }
    }

    setFieldEditor(saved ? { ...saved, input_type: "select", options: initialOptions } : {
      entity_type: tab,
      field_id: colId,
      label: currentLabel,
      input_type: "select",
      options: initialOptions,
      allow_custom_value: true,
    });
  }, [fieldSettingsQuery.data, fieldOptionsQuery.data, scanOptionsFromRows]);

  const saveFieldEditor = async () => {
    if (!fieldEditor || !selectedStoreId || !fieldEditor.label.trim()) return;
    const isCombo = isComboboxField(fieldEditor.entity_type, fieldEditor.field_id);
    const cleanedOptions = isCombo ? [...new Set(fieldEditor.options.map((o) => o.trim()).filter(isValidComboboxOption))] : [];
    const payload = {
      ...fieldEditor,
      label: fieldEditor.label.trim(),
      input_type: isCombo ? ("select" as const) : ("text" as const),
      options: cleanedOptions,
      store_id: selectedStoreId,
    };
    const res = await fetch("/api/accounting/inventory/field-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { notify("Không thể lưu cấu hình cột", "error"); return; }
    const savedSetting = payload;
    (fieldEditor.entity_type === "sku" ? setSkuColumns : setInboundColumns)((prev) => prev.map((col) => col.id === fieldEditor.field_id ? { ...col, label: savedSetting.label } : col));
    queryClient.setQueryData(["inventory-field-settings", selectedStoreId], (current: typeof fieldSettingsQuery.data) => ({
      settings: [...(current?.settings || []).filter((item) => !(item.entity_type === savedSetting.entity_type && item.field_id === savedSetting.field_id)), savedSetting],
    }));
    queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
    setFieldEditor(null);
    notify("Đã lưu cấu hình cột");
  };

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
        value: getRawEditableString(currentValue, field),
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
      const rawValue = valueArg !== undefined ? valueArg : inlineEditing?.value;
      const cleanValue = isDateField(field || "") ? cleanDateOnly(rawValue) : (rawValue ?? "");

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
            value: cleanValue,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không thể lưu ô dữ liệu.");

        const updateCachedRows = (oldData: any) => {
          if (!oldData?.items) return oldData;
          return {
            ...oldData,
            items: oldData.items.map((item: any) => item.id === id ? { ...item, ...data.item } : item),
          };
        };
        if (table === "sku") {
          queryClient.setQueriesData({ queryKey: ["sku-master", selectedStoreId] }, updateCachedRows);
        } else {
          queryClient.setQueriesData({ queryKey: ["inbound-shipments", selectedStoreId] }, updateCachedRows);
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

  const compareDatesDesc = (aStr?: string | null, bStr?: string | null): number => {
    const aClean = (aStr || "").trim();
    const bClean = (bStr || "").trim();
    if (aClean && !bClean) return -1;
    if (!aClean && bClean) return 1;
    if (!aClean && !bClean) return 0;
    const timeA = Date.parse(aClean);
    const timeB = Date.parse(bClean);
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return bClean.localeCompare(aClean);
  };

  // Mặc định sắp xếp BẢNG MÃ theo tháng listing mới nhất
  const sortedSkus = useMemo(() => {
    return [...allSkus].sort((a, b) => {
      const cmp = compareDatesDesc(a.thang_listing, b.thang_listing);
      if (cmp !== 0) return cmp;
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ca !== cb) return cb - ca;
      return (a.row_order ?? 999999) - (b.row_order ?? 999999);
    });
  }, [allSkus]);

  // Mặc định sắp xếp CHI TIẾT ĐI HÀNG theo ngày đi từ mới nhất
  const sortedShipments = useMemo(() => {
    return [...allShipments].sort((a, b) => {
      const cmp = compareDatesDesc(a.ngay_di, b.ngay_di);
      if (cmp !== 0) return cmp;
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return cb - ca;
    });
  }, [allShipments]);

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

  // Options are scoped to the selected Store and include every record, not only this page.
  const productTypesFor = useCallback((entityType: "sku" | "inbound") => {
    const configured = fieldSettingsQuery.data?.settings
      .find((item) => item.entity_type === entityType && item.field_id === "product_type" && item.input_type === "select")?.options;
    if (configured && configured.length > 0) {
      return [...new Set(configured)].filter(isValidComboboxOption).sort((a, b) => a.localeCompare(b));
    }
    const scannedDb = fieldOptionsQuery.data?.[entityType]?.product_type || [];
    const rowVals = scanOptionsFromRows(entityType, "product_type");
    const merged = [...new Set([...scannedDb, ...rowVals])].filter(isValidComboboxOption);
    if (merged.length > 0) return merged.sort((a, b) => a.localeCompare(b));
    return DEFAULT_PRODUCT_TYPES.filter(isValidComboboxOption);
  }, [fieldOptionsQuery.data, fieldSettingsQuery.data, scanOptionsFromRows]);
  const skuProductTypes = useMemo(() => productTypesFor("sku"), [productTypesFor]);
  const inboundProductTypes = useMemo(() => productTypesFor("inbound"), [productTypesFor]);

  const skuOptions = useMemo(() => {
    const base: Record<string, string[]> = { ...(fieldOptionsQuery.data?.sku || {}) };
    const settings = fieldSettingsQuery.data?.settings || [];
    const res: Record<string, string[]> = {};
    for (const field of SKU_COMBOBOX_FIELDS) {
      const dbVals = (base[field] || []).filter(isValidComboboxOption);
      const rowVals = scanOptionsFromRows("sku", field);
      const setting = settings.find((item) => item.entity_type === "sku" && item.field_id === field);
      let opts = setting?.input_type === "select" && setting.options && setting.options.length > 0
        ? setting.options.filter(isValidComboboxOption)
        : [...new Set([...dbVals, ...rowVals])].filter(isValidComboboxOption);
      if (field === "product_type") {
        opts = skuProductTypes;
      }
      res[field] = opts;
    }
    return res;
  }, [fieldOptionsQuery.data, fieldSettingsQuery.data, scanOptionsFromRows, skuProductTypes]);

  const inboundOptions = useMemo(() => {
    const base: Record<string, string[]> = { ...(fieldOptionsQuery.data?.inbound || {}) };
    const settings = fieldSettingsQuery.data?.settings || [];
    const res: Record<string, string[]> = {};
    for (const field of INBOUND_COMBOBOX_FIELDS) {
      const dbVals = (base[field] || []).filter(isValidComboboxOption);
      const rowVals = scanOptionsFromRows("inbound", field);
      const setting = settings.find((item) => item.entity_type === "inbound" && item.field_id === field);
      let opts = setting?.input_type === "select" && setting.options && setting.options.length > 0
        ? setting.options.filter(isValidComboboxOption)
        : [...new Set([...dbVals, ...rowVals])].filter(isValidComboboxOption);
      if (field === "status" && (!opts || opts.length === 0)) opts = DEFAULT_INBOUND_STATUS.filter(isValidComboboxOption);
      if (field === "trang_thai" && (!opts || opts.length === 0)) opts = DEFAULT_INBOUND_TRANG_THAI.filter(isValidComboboxOption);
      if (field === "product_type") {
        opts = inboundProductTypes;
      }
      res[field] = opts;
    }
    return res;
  }, [fieldOptionsQuery.data, fieldSettingsQuery.data, scanOptionsFromRows, inboundProductTypes]);

  useEffect(() => {
    const settings = fieldSettingsQuery.data?.settings;
    if (!settings) return;
    const applyLabels = (columns: ColumnConfig[], type: "sku" | "inbound") => columns.map((column) => {
      const setting = settings.find((item) => item.entity_type === type && item.field_id === column.id);
      return setting ? { ...column, label: setting.label } : column;
    });
    setSkuColumns((current) => applyLabels(current, "sku"));
    setInboundColumns((current) => applyLabels(current, "inbound"));
  }, [fieldSettingsQuery.data]);

  // History Drawer state
  const [historyDrawer, setHistoryDrawer] = useState<{
    isOpen: boolean;
    entityType?: "sku" | "inbound";
    entityId?: string;
    entityTitle?: string;
  }>({ isOpen: false });

  // 30s Undo state for deleted items
  const [undoDelete, setUndoDelete] = useState<{
    entityType: "sku" | "inbound";
    entityId: string;
    label: string;
    secondsLeft: number;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);

  // Countdown timer for 30s Undo delete
  useEffect(() => {
    if (!undoDelete) return;
    const timer = setInterval(() => {
      setUndoDelete((prev) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) return null;
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [undoDelete?.entityId]);

  const handleUndoDelete = async () => {
    if (!undoDelete || !selectedStoreId) return;
    setUndoing(true);
    try {
      const res = await fetch("/api/accounting/inventory/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId,
          entity_type: undoDelete.entityType,
          entity_id: undoDelete.entityId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Không thể hoàn tác thao tác xóa.");
      }
      notify(`Đã hoàn tác và khôi phục ${undoDelete.label} thành công!`, "success");
      const restoredType = undoDelete.entityType;
      setUndoDelete(null);
      if (restoredType === "sku") {
        fetchSkus();
      } else {
        fetchShipments();
      }
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setUndoing(false);
    }
  };

  // Delete SKU (Soft-delete with 30s Undo)
  const handleDeleteSku = async (id: string, skuName: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa SKU ${skuName}?`)) return;
    try {
      const res = await fetch(
        `/api/accounting/inventory/sku-master?id=${id}&store_id=${selectedStoreId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa SKU");
      setUndoDelete({
        entityType: "sku",
        entityId: id,
        label: skuName,
        secondsLeft: 30,
      });
      notify(`Đã chuyển SKU ${skuName} vào thùng rác (Có thể hoàn tác trong 30s)`);
      fetchSkus();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  // Delete Shipment (Soft-delete with 30s Undo)
  const handleDeleteShipment = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa lô hàng ${name}?`)) return;
    try {
      const res = await fetch(
        `/api/accounting/inventory/inbound-shipments?id=${id}&store_id=${selectedStoreId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa lô hàng");
      setUndoDelete({
        entityType: "inbound",
        entityId: id,
        label: name,
        secondsLeft: 30,
      });
      notify(`Đã chuyển lô hàng ${name} vào thùng rác (Có thể hoàn tác trong 30s)`);
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

  // Duplicate (Nhân bản) SKU lên dòng mới nhất để sửa mã SKU
  const [duplicatingSkuId, setDuplicatingSkuId] = useState<string | null>(null);
  const handleDuplicateSku = async (item: SkuMasterItem) => {
    if (!selectedStoreId) return;
    setDuplicatingSkuId(item.id);
    try {
      const baseSku = item.sku.replace(/-COPY(-\d+)?$/i, "");
      let copySku = `${baseSku}-COPY`;
      let counter = 1;
      const existingSkus = new Set(allSkus.map((s) => s.sku.toLowerCase()));
      while (existingSkus.has(copySku.toLowerCase())) {
        counter++;
        copySku = `${baseSku}-COPY-${counter}`;
      }

      const payload = {
        store_id: selectedStoreId,
        sku: copySku,
        brand: item.brand || null,
        product_type: item.product_type || null,
        mockup: item.mockup || null,
        mockup_url: item.mockup_url || item.mockup || null,
        asin: item.asin || null,
        fnsku: item.fnsku || null,
        amazon_fee: item.amazon_fee != null ? Number(item.amazon_fee) : null,
        referral_fee_pct: item.referral_fee_pct != null ? Number(item.referral_fee_pct) : null,
        pic_mkt: item.pic_mkt || null,
        loai: item.loai || null,
        niche: item.niche || null,
        pic_idea: item.pic_idea || null,
        status: item.status || "Active",
        event: item.event || null,
        tinh_trang: item.tinh_trang || null,
        design_pic: item.design_pic || null,
        thang_listing: item.thang_listing || null,
        thang_danh_gia: item.thang_danh_gia || null,
        event_250th: item.event_250th || null,
        ngay_danh_gia_sku_event: item.ngay_danh_gia_sku_event || null,
        amazon_fba_fee_thay_doi: item.amazon_fba_fee_thay_doi != null ? Number(item.amazon_fba_fee_thay_doi) : null,
        basecost_tb: item.basecost_tb != null ? Number(item.basecost_tb) : null,
        brand_entity_id: item.brand_entity_id || null,
        creative_asins_video: item.creative_asins_video || null,
        creative_asins_collection: item.creative_asins_collection || null,
        video_media_ids: item.video_media_ids || null,
        creative_headline: item.creative_headline || null,
        brand_logo_asset_id: item.brand_logo_asset_id || null,
        landing_page_url: item.landing_page_url || null,
        custom_fields: item.custom_fields || null,
      };

      const res = await fetch("/api/accounting/inventory/sku-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể nhân bản SKU");

      setSkuPage(1);

      // Cập nhật tức thời vào cache query
      queryClient.setQueryData(
        ["sku-master", selectedStoreId, 1, skuLimit, debouncedSkuSearch, skuStatusFilter, skuTypeFilter],
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            items: [data.item, ...oldData.items.filter((i: any) => i.id !== data.item.id)],
            total: (oldData.total || 0) + 1,
          };
        }
      );

      await fetchSkus();

      notify(`Đã nhân bản SKU lên dòng đầu tiên! Nhập mã SKU mới để hoàn tất.`, "success");

      // Tự động kích hoạt sửa trực tiếp ô SKU mới để người dùng gõ ngay mã mới
      if (data.item?.id) {
        setTimeout(() => {
          startInlineEdit("sku", data.item.id, "sku", data.item.sku);
        }, 120);
      }
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setDuplicatingSkuId(null);
    }
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
      queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
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
      queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
      fetchShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSavingShipment(false);
    }
  };

  // Duplicate (Nhân bản) Lô hàng
  const [duplicatingShipmentId, setDuplicatingShipmentId] = useState<string | null>(null);
  const handleDuplicateShipment = async (item: InboundShipmentItem) => {
    if (!selectedStoreId) return;
    setDuplicatingShipmentId(item.id);
    try {
      const baseName = item.ten_lo_hang || item.sku || "Shipment";
      const copyName = `${baseName}-COPY`;

      const payload = {
        store_id: selectedStoreId,
        sku_id: item.sku_id || null,
        sku: item.sku,
        brand: item.brand || null,
        sup: item.sup || null,
        ngay_request: item.ngay_request || null,
        product_type: item.product_type || null,
        mockup: item.mockup || null,
        quantity: item.quantity ? Number(item.quantity) : 0,
        line_ship: item.line_ship || null,
        base_cost_per_unit: item.base_cost_per_unit != null ? Number(item.base_cost_per_unit) : null,
        card: item.card != null ? Number(item.card) : null,
        tag: item.tag != null ? Number(item.tag) : null,
        shipping_fee: item.shipping_fee != null ? Number(item.shipping_fee) : null,
        hop_tui: item.hop_tui != null ? Number(item.hop_tui) : null,
        final_basecost: item.final_basecost != null ? Number(item.final_basecost) : null,
        total_basecost: item.total_basecost != null ? Number(item.total_basecost) : null,
        ngay_thanh_toan: item.ngay_thanh_toan || null,
        ten_lo_hang: copyName,
        shipment_id: item.shipment_id ? `${item.shipment_id}-COPY` : null,
        ngay_di: item.ngay_di || null,
        ngay_den: item.ngay_den || null,
        amazon_received: item.amazon_received != null ? Number(item.amazon_received) : null,
        tinh_trang_hang_den_kho: item.tinh_trang_hang_den_kho || null,
        status: item.status || "In Transit",
        so_luong_amazon_nhan: item.so_luong_amazon_nhan != null ? Number(item.so_luong_amazon_nhan) : null,
        discrepancy: item.discrepancy != null ? Number(item.discrepancy) : null,
        note: item.note || null,
        trang_thai: item.trang_thai || null,
        custom_fields: item.custom_fields || null,
      };

      const res = await fetch("/api/accounting/inventory/inbound-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể nhân bản lô hàng");

      setShipmentPage(1);
      queryClient.setQueryData(
        ["inbound-shipments", selectedStoreId, 1, shipmentLimit, debouncedShipmentSearch, shipmentStatusFilter],
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            items: [data.item, ...oldData.items.filter((i: any) => i.id !== data.item.id)],
            total: (oldData.total || 0) + 1,
          };
        }
      );
      await fetchShipments();

      notify(`Đã nhân bản lô hàng lên dòng đầu tiên!`, "success");

      if (data.item?.id) {
        setTimeout(() => {
          startInlineEdit("inbound", data.item.id, "ten_lo_hang", data.item.ten_lo_hang);
        }, 120);
      }
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setDuplicatingShipmentId(null);
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

  // Direct Drag-and-Drop state and handlers for Table Headers
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  const handleReorderSkuColumns = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setSkuColumns((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === fromId);
      const toIndex = prev.findIndex((c) => c.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      if (prev[fromIndex].isFrozen || prev[toIndex].isFrozen) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      try {
        localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    notify("Đã thay đổi vị trí cột!", "success");
  }, [SKU_COLUMNS_STORAGE_KEY]);

  const handleReorderInboundColumns = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setInboundColumns((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === fromId);
      const toIndex = prev.findIndex((c) => c.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      if (prev[fromIndex].isFrozen || prev[toIndex].isFrozen) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      try {
        localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    notify("Đã thay đổi vị trí cột!", "success");
  }, [INBOUND_COLUMNS_STORAGE_KEY]);

  // Dynamic Scrollable Column Header & Cell Renderers (Follows user-customized order)
  const renderSkuHeader = useCallback((col: ColumnConfig) => {
    const isCustom = col.isCustom;
    const isFee = col.id === "amazon_fee";
    const isPercent = col.id === "referral_fee_pct";
    const isRight = col.id === "amazon_fba_fee_thay_doi" || col.id === "basecost_tb";
    const isCenter = isFee || isPercent;

    let alignClass = "";
    if (isCenter) alignClass = "text-center";
    else if (isRight) alignClass = "text-right";

    const isDragging = headerDragId === col.id;
    const isDragOver = headerDragOverId === col.id;

    return (
      <ColumnHeaderCell
        key={col.id}
        col={col}
        draggable={!col.isFrozen}
        isDragging={isDragging}
        isDragOver={isDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", col.id);
          e.dataTransfer.effectAllowed = "move";
          setHeaderDragId(col.id);
        }}
        onDragOver={(e) => {
          if (!headerDragId || headerDragId === col.id || col.isFrozen) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (headerDragOverId !== col.id) {
            setHeaderDragOverId(col.id);
          }
        }}
        onDragLeave={() => {
          if (headerDragOverId === col.id) {
            setHeaderDragOverId(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (col.isFrozen) return;
          const sourceId = e.dataTransfer.getData("text/plain") || headerDragId;
          if (sourceId && sourceId !== col.id) {
            handleReorderSkuColumns(sourceId, col.id);
          }
          setHeaderDragId(null);
          setHeaderDragOverId(null);
        }}
        onDragEnd={() => {
          setHeaderDragId(null);
          setHeaderDragOverId(null);
        }}
        className={`py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight ${alignClass}`}
        onQuickHide={(id) => handleQuickHideColumn("sku", id)}
        onQuickRename={(id, l) => handleQuickRenameColumn("sku", id, l)}
      >
        <div className={isCenter ? "flex flex-col items-center justify-center" : isRight ? "flex flex-col items-end" : ""}>
          <div className="flex items-center gap-1">
            <span>{col.label}</span>
            {isCustom && (
              <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-900 font-bold">
                Custom
              </span>
            )}
          </div>
          {col.id === "amazon_fee" && (
            <div className="text-[10px] font-bold opacity-90">(chưa có referal fee)</div>
          )}
        </div>
      </ColumnHeaderCell>
    );
  }, [headerDragId, headerDragOverId, handleReorderSkuColumns, handleQuickHideColumn, handleQuickRenameColumn]);

  const renderSkuCell = useCallback((col: ColumnConfig, item: SkuMasterItem) => {
    const cid = col.id;

    if (col.isCustom) {
      return (
        <EditableCell
          key={col.id}
          table="sku"
          id={item.id}
          field={col.id}
          value={item.custom_fields?.[col.id] ?? ""}
          display={safeDisplay(item.custom_fields?.[col.id])}
          className="py-1.5 px-3 text-xs border-r border-slate-200"
          inlineEditing={inlineEditing}
          inlineSaving={inlineSaving}
          onStartEdit={startInlineEdit}
          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
          onSave={handleSaveInlineCell}
          onCancel={() => setInlineEditing(null)}
        />
      );
    }

    if (cid === "mockup_url") {
      return (
        <td key={col.id} className="py-1.5 px-3 text-xs border-r border-slate-200">
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
      );
    }

    if (cid === "landing_page_url") {
      return (
        <td key={col.id} className="py-1.5 px-3 text-xs border-r border-slate-200">
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
      );
    }

    let cellValue: any = (item as any)[cid];
    const setting = fieldSettingsQuery.data?.settings.find((entry) => entry.entity_type === "sku" && entry.field_id === cid);
    let displayNode: React.ReactNode = safeDisplay(cellValue);
    let cellClass = "py-1.5 px-3 text-xs border-r border-slate-200";

    switch (cid) {
      case "brand":
        displayNode = <span className="font-semibold text-slate-800">{safeDisplay(item.brand)}</span>;
        break;
      case "asin":
        cellClass = "py-1.5 px-3 text-xs font-mono text-xs font-bold text-slate-900 border-r border-slate-200";
        break;
      case "fnsku":
        cellClass = "py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-800 border-r border-slate-200";
        break;
      case "amazon_fee":
        displayNode = item.amazon_fee != null ? `$${item.amazon_fee.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-center font-mono font-bold text-pink-950 bg-pink-50/80 group-even:bg-pink-100/40 border-r border-pink-200";
        break;
      case "referral_fee_pct":
        displayNode = item.referral_fee_pct != null ? `${(item.referral_fee_pct * 100).toFixed(0)}%` : "—";
        cellClass = "py-1.5 px-3 text-xs text-center font-mono font-semibold text-slate-900 border-r border-slate-200";
        break;
      case "pic_mkt":
        displayNode = <EntityBadge value={item.pic_mkt} />;
        break;
      case "loai":
        displayNode = <EntityBadge value={item.loai} />;
        break;
      case "niche":
        displayNode = <EntityBadge value={item.niche} />;
        break;
      case "pic_idea":
        displayNode = <EntityBadge value={item.pic_idea} />;
        break;
      case "status":
        displayNode = <StatusBadge status={item.status} />;
        break;
      case "event":
        displayNode = <EntityBadge value={item.event} />;
        break;
      case "tinh_trang":
        displayNode = <EntityBadge value={item.tinh_trang} />;
        break;
      case "design_pic":
        displayNode = <EntityBadge value={item.design_pic} />;
        break;
      case "thang_listing":
        displayNode = safeDisplay(formatDate(item.thang_listing));
        cellClass = "py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200";
        break;
      case "thang_danh_gia":
        displayNode = safeDisplay(formatDate(item.thang_danh_gia));
        cellClass = "py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200";
        break;
      case "event_250th":
        displayNode = safeDisplay(formatDate(item.event_250th));
        cellClass = "py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200";
        break;
      case "ngay_danh_gia_sku_event":
        displayNode = safeDisplay(formatDate(item.ngay_danh_gia_sku_event));
        cellClass = "py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200";
        break;
      case "amazon_fba_fee_thay_doi":
        displayNode = item.amazon_fba_fee_thay_doi != null ? `$${item.amazon_fba_fee_thay_doi.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-semibold text-pink-950 bg-pink-50/50 group-even:bg-pink-100/30 border-r border-pink-200 text-xs";
        break;
      case "basecost_tb":
        displayNode = item.basecost_tb != null ? `$${item.basecost_tb.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-black text-slate-950 border-r border-slate-200 text-xs";
        break;
      case "brand_entity_id":
      case "creative_asins_video":
      case "creative_asins_collection":
      case "video_media_ids":
      case "brand_logo_asset_id":
        cellClass = "py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-700 border-r border-slate-200";
        break;
      case "creative_headline":
        cellClass = "py-1.5 px-3 text-xs text-slate-900 font-semibold border-r border-slate-200 text-xs";
        break;
    }

    return (
      <EditableCell
        key={col.id}
        table="sku"
        id={item.id}
        field={cid as any}
        value={cellValue}
        display={displayNode}
        className={cellClass}
        inlineEditing={inlineEditing}
        inlineSaving={inlineSaving}
        onStartEdit={startInlineEdit}
        onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
        onSave={handleSaveInlineCell}
        onCancel={() => setInlineEditing(null)}
        options={
          isComboboxField("sku", cid)
            ? (setting?.input_type === "select" && setting.options && setting.options.length > 0
                ? setting.options.filter(isValidComboboxOption)
                : (skuOptions[cid] || []).filter(isValidComboboxOption))
            : []
        }
      />
    );
  }, [inlineEditing, inlineSaving, startInlineEdit, handleSaveInlineCell, fieldSettingsQuery.data, skuOptions]);

  const renderInboundHeader = useCallback((col: ColumnConfig) => {
    const isCustom = col.isCustom;
    const isCenter = col.id === "line_ship" || col.id === "discrepancy";
    const isRight =
      col.id === "quantity" ||
      col.id === "base_cost_per_unit" ||
      col.id === "card" ||
      col.id === "tag" ||
      col.id === "shipping_fee" ||
      col.id === "hop_tui" ||
      col.id === "final_basecost" ||
      col.id === "total_basecost" ||
      col.id === "amazon_received" ||
      col.id === "so_luong_amazon_nhan";

    let alignClass = "";
    if (isCenter) alignClass = "text-center";
    else if (isRight) alignClass = "text-right";

    const isDragging = headerDragId === col.id;
    const isDragOver = headerDragOverId === col.id;

    return (
      <ColumnHeaderCell
        key={col.id}
        col={col}
        draggable={!col.isFrozen}
        isDragging={isDragging}
        isDragOver={isDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", col.id);
          e.dataTransfer.effectAllowed = "move";
          setHeaderDragId(col.id);
        }}
        onDragOver={(e) => {
          if (!headerDragId || headerDragId === col.id || col.isFrozen) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (headerDragOverId !== col.id) {
            setHeaderDragOverId(col.id);
          }
        }}
        onDragLeave={() => {
          if (headerDragOverId === col.id) {
            setHeaderDragOverId(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (col.isFrozen) return;
          const sourceId = e.dataTransfer.getData("text/plain") || headerDragId;
          if (sourceId && sourceId !== col.id) {
            handleReorderInboundColumns(sourceId, col.id);
          }
          setHeaderDragId(null);
          setHeaderDragOverId(null);
        }}
        onDragEnd={() => {
          setHeaderDragId(null);
          setHeaderDragOverId(null);
        }}
        className={`py-2 px-3 text-xs bg-[#ff9900] text-slate-950 font-black border-r border-amber-600/60 leading-tight ${alignClass}`}
        onQuickHide={(id) => handleQuickHideColumn("inbound", id)}
        onQuickRename={(id, l) => handleQuickRenameColumn("inbound", id, l)}
      >
        <div className={isCenter ? "flex flex-col items-center justify-center" : isRight ? "flex flex-col items-end" : ""}>
          <div className="flex items-center gap-1">
            <span>{col.label}</span>
            {isCustom && (
              <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-900 font-bold">
                Custom
              </span>
            )}
          </div>
        </div>
      </ColumnHeaderCell>
    );
  }, [headerDragId, headerDragOverId, handleReorderInboundColumns, handleQuickHideColumn, handleQuickRenameColumn]);

  const renderInboundCell = useCallback((col: ColumnConfig, item: InboundShipmentItem) => {
    const cid = col.id;

    if (col.isCustom) {
      return (
        <EditableCell
          key={col.id}
          table="inbound"
          id={item.id}
          field={col.id}
          value={item.custom_fields?.[col.id] ?? ""}
          display={safeDisplay(item.custom_fields?.[col.id])}
          className="py-1.5 px-3 text-xs border-r border-slate-200"
          inlineEditing={inlineEditing}
          inlineSaving={inlineSaving}
          onStartEdit={startInlineEdit}
          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
          onSave={handleSaveInlineCell}
          onCancel={() => setInlineEditing(null)}
        />
      );
    }

    let cellValue: any = (item as any)[cid];
    const setting = fieldSettingsQuery.data?.settings.find((entry) => entry.entity_type === "inbound" && entry.field_id === cid);
    let displayNode: React.ReactNode = safeDisplay(cellValue);
    let cellClass = "py-1.5 px-3 text-xs border-r border-slate-200";

    switch (cid) {
      case "brand":
        displayNode = <span className="font-semibold text-slate-800">{safeDisplay(item.brand)}</span>;
        break;
      case "sup":
        displayNode = <EntityBadge value={item.sup} />;
        break;
      case "ngay_request":
      case "ngay_thanh_toan":
      case "ngay_di":
      case "ngay_den":
        displayNode = safeDisplay(formatDate(cellValue));
        cellClass = "py-1.5 px-3 text-xs text-slate-800 font-mono text-xs font-semibold border-r border-slate-200";
        break;
      case "quantity":
        displayNode = item.quantity?.toLocaleString() || 0;
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-950 border-r border-slate-200 text-xs";
        break;
      case "line_ship":
        displayNode = <EntityBadge value={item.line_ship} />;
        cellClass = "py-1.5 px-3 text-xs text-center border-r border-slate-200";
        break;
      case "base_cost_per_unit":
        displayNode = item.base_cost_per_unit != null ? `$${item.base_cost_per_unit.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-semibold text-slate-900 border-r border-slate-200 text-xs";
        break;
      case "card":
      case "tag":
      case "shipping_fee":
      case "hop_tui":
        displayNode = cellValue != null ? `$${cellValue.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono text-slate-800 border-r border-slate-200 text-xs";
        break;
      case "final_basecost":
        displayNode = item.final_basecost != null ? `$${item.final_basecost.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-950 border-r border-slate-200 text-xs";
        break;
      case "total_basecost":
        displayNode = item.total_basecost != null ? `$${item.total_basecost.toLocaleString()}` : "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-black text-indigo-700 border-r border-slate-200 text-xs";
        break;
      case "ten_lo_hang":
        displayNode = safeDisplay(item.ten_lo_hang);
        cellClass = "py-1.5 px-3 text-xs font-semibold text-slate-900 border-r border-slate-200 text-xs";
        break;
      case "shipment_id":
        displayNode = safeDisplay(item.shipment_id);
        cellClass = "py-1.5 px-3 text-xs font-mono text-xs font-semibold text-slate-800 border-r border-slate-200";
        break;
      case "amazon_received":
        displayNode = item.amazon_received?.toLocaleString() || "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-bold text-slate-900 border-r border-slate-200 text-xs";
        break;
      case "tinh_trang_hang_den_kho":
        displayNode = <EntityBadge value={item.tinh_trang_hang_den_kho} />;
        break;
      case "status":
        displayNode = <StatusBadge status={item.status} />;
        break;
      case "so_luong_amazon_nhan":
        displayNode = item.so_luong_amazon_nhan?.toLocaleString() || "—";
        cellClass = "py-1.5 px-3 text-xs text-right font-mono font-bold text-emerald-700 border-r border-slate-200 text-xs";
        break;
      case "discrepancy":
        displayNode = item.discrepancy ? (
          <span className="font-mono font-bold text-rose-600">{item.discrepancy}</span>
        ) : (
          <span className="text-slate-400">0</span>
        );
        cellClass = "py-1.5 px-3 text-xs text-center border-r border-slate-200";
        break;
      case "note":
        displayNode = safeDisplay(item.note);
        cellClass = "py-1.5 px-3 text-xs text-slate-800 border-r border-slate-200 text-xs";
        break;
      case "trang_thai":
        displayNode = <EntityBadge value={item.trang_thai} />;
        break;
    }

    return (
      <EditableCell
        key={col.id}
        table="inbound"
        id={item.id}
        field={cid as any}
        value={cellValue}
        display={displayNode}
        className={cellClass}
        inlineEditing={inlineEditing}
        inlineSaving={inlineSaving}
        onStartEdit={startInlineEdit}
        onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
        onSave={handleSaveInlineCell}
        onCancel={() => setInlineEditing(null)}
        options={
          isComboboxField("inbound", cid)
            ? (setting?.input_type === "select" && setting.options && setting.options.length > 0
                ? setting.options.filter(isValidComboboxOption)
                : (inboundOptions[cid] || []).filter(isValidComboboxOption))
            : []
        }
      />
    );
  }, [inlineEditing, inlineSaving, startInlineEdit, handleSaveInlineCell, fieldSettingsQuery.data, inboundOptions]);

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

            <button
              type="button"
              onClick={() => setShowColumnModal(true)}
              className="inline-flex items-center justify-center rounded-lg border border-amber-400 bg-amber-50 p-2 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
              title={`Cấu hình cột ${activeTab === "sku" ? "BẢNG MÃ" : "CHI TIẾT ĐI HÀNG"} (${activeTab === "sku" ? skuVisibleCount : inboundVisibleCount}/${activeTab === "sku" ? skuColumns.length : inboundColumns.length})`}
            >
              <SlidersHorizontalIcon size={16} weight="bold" />
            </button>

            <button
              type="button"
              onClick={() =>
                setHistoryDrawer({
                  isOpen: true,
                  entityType: activeTab,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-indigo-700 transition shadow-2xs cursor-pointer"
              title="Xem lịch sử thay đổi & khôi phục dữ liệu"
            >
              <ClockCounterClockwiseIcon size={15} weight="bold" />
              <span>Lịch sử</span>
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
              {skuProductTypes.map((t) => (
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
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table className="min-w-max w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs font-semibold uppercase tracking-[0.04em] whitespace-nowrap">
                  {/* FROZEN 1: STT */}
                  {skuColMap["stt"]?.visible !== false && (
                    <th className="py-2 px-1 text-center w-[58px] min-w-[58px] max-w-[58px] bg-[#f59e0b] border-r border-amber-600 sticky left-0 z-40 text-xs text-slate-950">
                      {skuColMap["stt"]?.label || "STT"}
                    </th>
                  )}
                  {/* FROZEN 2: Product Type */}
                  {skuColMap["product_type"]?.visible !== false && (
                    <th className="group/hdr py-2 px-3 w-[155px] min-w-[155px] max-w-[155px] bg-[#f59e0b] border-r border-amber-600 sticky left-[58px] z-40 text-xs text-slate-950">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{skuColMap["product_type"]?.label || "Product Type"}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickRenameColumn("sku", "product_type", skuColMap["product_type"]?.label || "Product Type");
                          }}
                          className="opacity-0 group-hover/hdr:opacity-100 p-0.5 rounded hover:bg-amber-600/70 text-slate-950 transition cursor-pointer"
                          title="Cấu hình danh sách Product Type"
                        >
                          <PencilSimpleIcon size={12} weight="bold" />
                        </button>
                      </div>
                    </th>
                  )}
                  {/* FROZEN 3: Mockup */}
                  {skuColMap["mockup"]?.visible !== false && (
                    <th className="py-2 px-1 text-center w-[76px] min-w-[76px] max-w-[76px] bg-[#f59e0b] border-r border-amber-600 sticky left-[213px] z-40 text-xs text-slate-950">
                      {skuColMap["mockup"]?.label || "Mockup"}
                    </th>
                  )}
                  {/* FROZEN 4: SKU - BOUNDARY DIVIDER WITH BULLETPROOF LINE */}
                  {skuColMap["sku"]?.visible !== false && (
                    <th className="py-2 px-3 w-[160px] min-w-[160px] max-w-[160px] bg-[#f59e0b] sticky left-[289px] z-40 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] after:absolute after:top-0 after:bottom-0 after:right-0 after:w-[2px] after:bg-amber-900 after:z-50 border-r-2 !border-r-amber-900 text-xs text-slate-950">
                      {skuColMap["sku"]?.label || "SKU"}
                    </th>
                  )}

                  {/* SCROLLABLE DYNAMIC COLUMNS (IN USER-DEFINED ORDER) */}
                  {activeScrollableSkuColumns.map((col) => renderSkuHeader(col))}

                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingSkus ? (
                  <tr>
                    <td colSpan={skuVisibleCount + 1} className="py-20 text-center text-slate-500 font-bold text-base">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                      Đang tải Bảng Mã của Store {selectedStore?.name}...
                    </td>
                  </tr>
                ) : sortedSkus.length === 0 ? (
                  <tr>
                    <td colSpan={skuVisibleCount + 1} className="py-20 text-center text-slate-500 text-sm">
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
                          {skuColMap["stt"]?.visible !== false && (
                          <td className="py-1 px-1 text-center font-mono text-xs font-bold text-slate-700 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-0 z-20 w-[58px] min-w-[58px] max-w-[58px]">
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
                          )}

                          {/* FROZEN 2: Product Type */}
                          {skuColMap["product_type"]?.visible !== false && (
<EditableCell
                            table="sku"
                            id={item.id}
                            field="product_type"
                            value={item.product_type}
                            display={<EntityBadge value={item.product_type} />}
                            className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[58px] z-20 text-xs w-[155px] min-w-[155px] max-w-[155px]"
                            inlineEditing={inlineEditing}
                            inlineSaving={inlineSaving}
                            onStartEdit={startInlineEdit}
                            onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                            onSave={handleSaveInlineCell}
                            onCancel={() => setInlineEditing(null)}
                            options={skuProductTypes}
                          />
)}

                          {/* FROZEN 3: Mockup */}
                          {skuColMap["mockup"]?.visible !== false && (
                          <td className="py-1 px-1 text-center bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[213px] z-20 w-[76px] min-w-[76px] max-w-[76px]">
                            <MockupThumbnail
                              url={item.mockup_url || item.mockup}
                              alt={item.sku}
                              onPreview={(url) => setPreviewModalUrl(url)}
                            />
                          </td>
                          )}

                          {/* FROZEN 4: SKU - BOUNDARY DIVIDER WITH BULLETPROOF LINE */}
                          {skuColMap["sku"]?.visible !== false && (
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
                          className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] sticky left-[289px] z-20 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] after:absolute after:top-0 after:bottom-0 after:right-0 after:w-[2px] after:bg-slate-600 after:z-30 border-r-2 !border-r-slate-600 text-xs w-[160px] min-w-[160px] max-w-[160px]"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />
)}

                        {/* SCROLLABLE DYNAMIC DATA CELLS (IN USER-DEFINED ORDER) */}
                        {activeScrollableSkuColumns.map((col) => renderSkuCell(col, item))}

                        {/* THAO TÁC: Sửa, Sao chép (Duplicate), Xóa */}
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
                              disabled={duplicatingSkuId === item.id}
                              onClick={() => handleDuplicateSku(item)}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 p-1 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50"
                              title="Nhân bản (Sao chép) SKU lên dòng mới nhất để sửa mã"
                            >
                              {duplicatingSkuId === item.id ? (
                                <ArrowClockwiseIcon size={16} className="animate-spin" />
                              ) : (
                                <CopyIcon size={16} weight="bold" />
                              )}
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
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table className="min-w-max w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
                <tr className="text-xs font-semibold uppercase tracking-[0.04em] whitespace-nowrap">
                  {/* FROZEN 1: STT */}
                  {inboundColMap["stt"]?.visible !== false && (
                    <th className="py-2 px-1 text-center w-[58px] min-w-[58px] max-w-[58px] bg-[#f59e0b] border-r border-amber-600 sticky left-0 z-40 text-xs text-slate-950">
                      {inboundColMap["stt"]?.label || "STT"}
                    </th>
                  )}
                  {/* FROZEN 2: Product Type */}
                  {inboundColMap["product_type"]?.visible !== false && (
                    <th className="group/hdr py-2 px-3 w-[155px] min-w-[155px] max-w-[155px] bg-[#f59e0b] border-r border-amber-600 sticky left-[58px] z-40 text-xs text-slate-950">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{inboundColMap["product_type"]?.label || "Product Type"}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQuickRenameColumn("inbound", "product_type", inboundColMap["product_type"]?.label || "Product Type");
                          }}
                          className="opacity-0 group-hover/hdr:opacity-100 p-0.5 rounded hover:bg-amber-600/70 text-slate-950 transition cursor-pointer"
                          title="Cấu hình danh sách Product Type"
                        >
                          <PencilSimpleIcon size={12} weight="bold" />
                        </button>
                      </div>
                    </th>
                  )}
                  {/* FROZEN 3: Mockup */}
                  {inboundColMap["mockup"]?.visible !== false && (
                    <th className="py-2 px-1 text-center w-[76px] min-w-[76px] max-w-[76px] bg-[#f59e0b] border-r border-amber-600 sticky left-[213px] z-40 text-xs text-slate-950">
                      {inboundColMap["mockup"]?.label || "Mockup"}
                    </th>
                  )}
                  {/* FROZEN 4: SKU - BOUNDARY DIVIDER WITH BULLETPROOF LINE */}
                  {inboundColMap["sku"]?.visible !== false && (
                    <th className="py-2 px-3 w-[160px] min-w-[160px] max-w-[160px] bg-[#f59e0b] sticky left-[289px] z-40 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] after:absolute after:top-0 after:bottom-0 after:right-0 after:w-[2px] after:bg-amber-900 after:z-50 border-r-2 !border-r-amber-900 text-xs text-slate-950">
                      {inboundColMap["sku"]?.label || "SKU"}
                    </th>
                  )}

                  {/* SCROLLABLE DYNAMIC COLUMNS (IN USER-DEFINED ORDER) */}
                  {activeScrollableInboundColumns.map((col) => renderInboundHeader(col))}

                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-950 font-black">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loadingShipments ? (
                  <tr>
                    <td colSpan={inboundVisibleCount + 1} className="py-20 text-center text-slate-500 font-bold text-base">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                      Đang tải danh sách lô hàng của Store {selectedStore?.name}...
                    </td>
                  </tr>
                ) : sortedShipments.length === 0 ? (
                  <tr>
                    <td colSpan={inboundVisibleCount + 1} className="py-20 text-center text-slate-500 text-sm">
                      <TruckIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Chưa có lô hàng nào trong Store {selectedStore?.name}. Nhấn <strong>Thêm Lô Hàng</strong> hoặc <strong>Import Đi Hàng</strong> để nạp dữ liệu.
                    </td>
                  </tr>
                ) : (
                  sortedShipments.map((item, idx) => {
                    const stt = (shipmentPage - 1) * shipmentLimit + idx + 1;
                    return (
                      <tr
                        key={item.id}
                        className="group h-[52px] min-h-[52px] bg-white even:bg-[#f8fafc] hover:bg-[#fef9c3] transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200"
                      >
                          {/* FROZEN 1: STT with Pencil Button aligned */}
                          {inboundColMap["stt"]?.visible !== false && (
                          <td className="py-1 px-1 text-center font-mono text-xs font-bold text-slate-700 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-0 z-20 w-[58px] min-w-[58px] max-w-[58px]">
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
                          )}

                          {/* FROZEN 2: Product Type */}
                          {inboundColMap["product_type"]?.visible !== false && (
<EditableCell
                            table="inbound"
                            id={item.id}
                            field="product_type"
                            value={item.product_type}
                            display={<EntityBadge value={item.product_type} />}
                            className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[58px] z-20 text-xs w-[155px] min-w-[155px] max-w-[155px]"
                            inlineEditing={inlineEditing}
                            inlineSaving={inlineSaving}
                            onStartEdit={startInlineEdit}
                            onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                            onSave={handleSaveInlineCell}
                            onCancel={() => setInlineEditing(null)}
                            options={inboundProductTypes}
                          />
)}

                          {/* FROZEN 3: Mockup */}
                          {inboundColMap["mockup"]?.visible !== false && (
                          <td className="py-1 px-1 text-center bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] border-r border-slate-300 sticky left-[213px] z-20 w-[76px] min-w-[76px] max-w-[76px]">
                            <MockupThumbnail
                              url={item.mockup}
                              alt={item.sku}
                              onPreview={(url) => setPreviewModalUrl(url)}
                            />
                          </td>
                          )}

                          {/* FROZEN 4: SKU - BOUNDARY DIVIDER WITH BULLETPROOF LINE */}
                          {inboundColMap["sku"]?.visible !== false && (
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
                          className="py-1.5 px-3 bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] sticky left-[289px] z-20 shadow-[4px_0_8px_-1px_rgba(0,0,0,0.18)] after:absolute after:top-0 after:bottom-0 after:right-0 after:w-[2px] after:bg-slate-600 after:z-30 border-r-2 !border-r-slate-600 text-xs w-[160px] min-w-[160px] max-w-[160px]"
                          inlineEditing={inlineEditing}
                          inlineSaving={inlineSaving}
                          onStartEdit={startInlineEdit}
                          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                          onSave={handleSaveInlineCell}
                          onCancel={() => setInlineEditing(null)}
                        />
)}

                        {/* SCROLLABLE DYNAMIC DATA CELLS (IN USER-DEFINED ORDER) */}
                        {activeScrollableInboundColumns.map((col) => renderInboundCell(col, item))}

                        {/* THAO TÁC: Sửa, Sao chép (Duplicate), Xóa */}
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
                              disabled={duplicatingShipmentId === item.id}
                              onClick={() => handleDuplicateShipment(item)}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 p-1 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50"
                              title="Nhân bản (Sao chép) lô hàng lên dòng mới nhất để sửa"
                            >
                              {duplicatingShipmentId === item.id ? (
                                <ArrowClockwiseIcon size={16} className="animate-spin" />
                              ) : (
                                <CopyIcon size={16} weight="bold" />
                              )}
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
              <div className="flex items-center gap-1.5">
                {skuFormData.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryDrawer({
                        isOpen: true,
                        entityType: "sku",
                        entityId: skuFormData.id,
                        entityTitle: skuFormData.sku,
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Xem lịch sử chỉnh sửa của riêng SKU này"
                  >
                    <ClockCounterClockwiseIcon size={14} weight="bold" />
                    <span>Lịch sử</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowSkuModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                >
                  <XIcon size={20} />
                </button>
              </div>
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
                  options={skuProductTypes}
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
                  <OptionTextInput
                    placeholder="VD: Truong, Loan..."
                    value={skuFormData.pic_mkt}
                    onChange={(val) => setSkuFormData({ ...skuFormData, pic_mkt: val })}
                    options={skuOptions?.pic_mkt || []}
                  />
                </div>

                {/* Loại */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Loại (FBA / FBM)</label>
                  <OptionTextInput
                    value={skuFormData.loai}
                    onChange={(val) => setSkuFormData({ ...skuFormData, loai: val })}
                    placeholder="Chọn loại fulfillment hoặc nhập mới..."
                    options={skuOptions?.loai || []}
                  />
                </div>

                {/* Niche */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Niche</label>
                  <OptionTextInput
                    placeholder="VD: Women, Men, Christmas..."
                    value={skuFormData.niche}
                    onChange={(val) => setSkuFormData({ ...skuFormData, niche: val })}
                    options={skuOptions?.niche || []}
                  />
                </div>

                {/* PIC Idea */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">PIC Idea</label>
                  <OptionTextInput
                    placeholder="VD: Loan, Cường..."
                    value={skuFormData.pic_idea}
                    onChange={(val) => setSkuFormData({ ...skuFormData, pic_idea: val })}
                    options={skuOptions?.pic_idea || []}
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Trạng thái</label>
                  <OptionTextInput
                    value={skuFormData.status}
                    onChange={(val) => setSkuFormData({ ...skuFormData, status: val })}
                    placeholder="Chọn trạng thái hoặc nhập mới..."
                    options={skuOptions?.status || []}
                  />
                </div>

                {/* Tình trạng */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tình trạng phôi</label>
                  <OptionTextInput
                    placeholder="VD: Đang bán, Chuẩn bị bán..."
                    value={skuFormData.tinh_trang}
                    onChange={(val) => setSkuFormData({ ...skuFormData, tinh_trang: val })}
                    options={skuOptions?.tinh_trang || []}
                  />
                </div>

                {/* Event */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Event</label>
                  <OptionTextInput
                    placeholder="VD: Christmas, Mother's Day..."
                    value={skuFormData.event}
                    onChange={(val) => setSkuFormData({ ...skuFormData, event: val })}
                    options={skuOptions?.event || []}
                  />
                </div>

                {/* DESIGN PIC */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">DESIGN PIC</label>
                  <OptionTextInput
                    placeholder="VD: Designer Name"
                    value={skuFormData.design_pic}
                    onChange={(val) => setSkuFormData({ ...skuFormData, design_pic: val })}
                    options={skuOptions?.design_pic || []}
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
              <div className="flex items-center gap-1.5">
                {shipmentFormData.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryDrawer({
                        isOpen: true,
                        entityType: "inbound",
                        entityId: shipmentFormData.id,
                        entityTitle: shipmentFormData.ten_lo_hang || shipmentFormData.sku,
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Xem lịch sử chỉnh sửa của riêng lô hàng này"
                  >
                    <ClockCounterClockwiseIcon size={14} weight="bold" />
                    <span>Lịch sử</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowShipmentModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                >
                  <XIcon size={20} />
                </button>
              </div>
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
                  <OptionTextInput
                    placeholder="VD: Xưởng A, Sup B"
                    value={shipmentFormData.sup}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, sup: val })}
                    options={inboundOptions?.sup || []}
                  />
                </div>

                {/* Line ship */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Line Ship</label>
                  <OptionTextInput
                    placeholder="VD: AIR, SEA FAST..."
                    value={shipmentFormData.line_ship}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, line_ship: val })}
                    options={inboundOptions?.line_ship || []}
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
                  options={inboundProductTypes}
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
                  <OptionTextInput
                    value={shipmentFormData.status}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, status: val })}
                    placeholder="Chọn status hoặc nhập mới..."
                    options={inboundOptions?.status || DEFAULT_INBOUND_STATUS}
                  />
                </div>

                {/* Trạng thái */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Trạng thái</label>
                  <OptionTextInput
                    value={shipmentFormData.trang_thai}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, trang_thai: val })}
                    placeholder="Chọn trạng thái hoặc nhập mới..."
                    options={inboundOptions?.trang_thai || DEFAULT_INBOUND_TRANG_THAI}
                  />
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

      {/* MODAL QUẢN LÝ & TÙY CHỈNH CỘT (THÊM / SỬA / XÓA / ẨN CỘT) */}
      <ColumnManagerModal
        isOpen={showColumnModal}
        onClose={() => setShowColumnModal(false)}
        title={activeTab === "sku" ? "BẢNG MÃ" : "CHI TIẾT ĐI HÀNG"}
        columns={activeTab === "sku" ? skuColumns : inboundColumns}
        onSave={activeTab === "sku" ? handleSaveSkuColumns : handleSaveInboundColumns}
        onReset={activeTab === "sku" ? handleResetSkuColumns : handleResetInboundColumns}
      />

      {/* DRAWER LỊCH SỬ THAY ĐỔI & KHÔI PHỤC PHIÊN BẢN */}
      <InventoryHistoryDrawer
        isOpen={historyDrawer.isOpen}
        onClose={() => setHistoryDrawer({ isOpen: false })}
        storeId={selectedStoreId || ""}
        storeName={selectedStore?.name}
        entityType={historyDrawer.entityType}
        entityId={historyDrawer.entityId}
        entityTitle={historyDrawer.entityTitle}
        onRestored={() => {
          fetchSkus();
          fetchShipments();
          notify("Đã khôi phục dữ liệu thành công!", "success");
        }}
      />

      {/* THÔNG BÁO HOÀN TÁC 30 GIÂY KHI XÓA (UNDO BANNER) */}
      {undoDelete && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/95 backdrop-blur-md text-white p-3.5 shadow-2xl animate-in slide-in-from-bottom-5 duration-200 max-w-sm w-full">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                <TrashIcon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">
                  Đã xóa {undoDelete.entityType === "sku" ? "SKU" : "lô hàng"}:{" "}
                  <span className="font-mono text-amber-300">{undoDelete.label}</span>
                </p>
                <p className="text-[11px] text-slate-400">
                  Hoàn tác trong <strong className="text-amber-400 font-mono">{undoDelete.secondsLeft}s</strong>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleUndoDelete}
                disabled={undoing}
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300 transition flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
              >
                <ArrowCounterClockwiseIcon size={13} weight="bold" />
                {undoing ? "Đang phục hồi..." : "Hoàn tác"}
              </button>
              <button
                type="button"
                onClick={() => setUndoDelete(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-white transition cursor-pointer"
                title="Đóng thông báo"
              >
                <XIcon size={15} />
              </button>
            </div>
          </div>
          <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${(undoDelete.secondsLeft / 30) * 100}%` }}
            />
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
      {fieldEditor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setFieldEditor(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><p className="text-sm font-black text-slate-900">Cấu hình cột</p><p className="text-xs text-slate-500">{fieldEditor.field_id}</p></div>
              <button type="button" onClick={() => setFieldEditor(null)} className="p-1 text-slate-400 hover:text-slate-700"><XIcon size={18} /></button>
            </div>
            <div className="space-y-4 p-5 text-xs">
              <label className="block font-bold text-slate-700">
                Tên cột
                <input
                  value={fieldEditor.label}
                  onChange={(e) => setFieldEditor({ ...fieldEditor, label: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>

              {isComboboxField(fieldEditor.entity_type, fieldEditor.field_id) ? (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-700">
                        Giá trị lựa chọn ({fieldEditor.options.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const rowVals = scanOptionsFromRows(fieldEditor.entity_type, fieldEditor.field_id);
                          const dbVals = fieldEditor.entity_type === "sku"
                            ? (fieldOptionsQuery.data?.sku as Record<string, string[]> | undefined)?.[fieldEditor.field_id] || []
                            : (fieldOptionsQuery.data?.inbound as Record<string, string[]> | undefined)?.[fieldEditor.field_id] || [];
                          const merged = [...new Set([...fieldEditor.options, ...dbVals, ...rowVals])].filter(isValidComboboxOption);
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
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-xs text-slate-500">
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
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 px-2 py-1"
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
                          if (!isValidComboboxOption(val)) {
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
                        if (!isValidComboboxOption(val)) {
                          notify("Giá trị không hợp lệ hoặc bằng 0", "error");
                          return;
                        }
                        if (!fieldEditor.options.includes(val)) {
                          setFieldEditor({ ...fieldEditor, options: [...fieldEditor.options, val] });
                        }
                        setNewFieldOption("");
                      }}
                      className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 font-bold text-slate-700 transition"
                    >
                      Thêm
                    </button>
                  </div>

                  <label className="flex items-center gap-2 font-semibold text-slate-700 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fieldEditor.allow_custom_value}
                      onChange={(e) => setFieldEditor({ ...fieldEditor, allow_custom_value: e.target.checked })}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Cho phép nhập giá trị khác
                  </label>
                </>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600">
                  <p className="font-semibold text-slate-700">Trường dữ liệu tiêu chuẩn</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Cột này là trường văn bản / số, không sử dụng menu lựa chọn (combo box). Bạn có thể đổi tên hiển thị của cột ở trên.
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => setFieldEditor(null)} className="rounded-lg px-3 py-2 font-bold text-slate-600">Hủy</button><button type="button" onClick={saveFieldEditor} className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white">Lưu</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
