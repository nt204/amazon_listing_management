"use client";

import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
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
  ArrowsInLineHorizontalIcon,
  BarcodeIcon,
  CalculatorIcon,
  CameraIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  FileXlsIcon,
  FloppyDiskIcon,
  FunnelIcon,
  LockIcon,
  LockOpenIcon,
  ImageSquareIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  TrashIcon,
  TruckIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { SkuMasterItem, InboundShipmentItem, CheckShipmentItem, SkuChannel } from "@/lib/accounting/inventory-db";
import { channelTabActiveClass, channelTabBadgeActiveClass } from "./channel-tab-colors";
import { storeCanView, storeHasTeam } from "@/lib/accounting/store-teams";
import type { Store } from "@/lib/accounting/types";
import {
  AccountingTableSkeletonRows,
  AccountingTopProgressBar,
} from "./accounting-skeleton";

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

const DEFAULT_CHECK_SHIPMENT_STATUS = [
  "Closed",
  "Working",
  "In Transit",
  "Delivered",
  "Receiving",
  "Cancelled",
];

import {
  ColumnManagerModal,
  type ColumnConfig,
  DEFAULT_SKU_COLUMNS,
  DEFAULT_FBM_SKU_COLUMNS,
  DEFAULT_INBOUND_COLUMNS,
  DEFAULT_CHECK_SHIPMENT_COLUMNS,
  DEFAULT_MONTHLY_BASE_COST_COLUMNS,
  ColumnHeaderCell,
  createTextWidthMeasurer,
} from "./column-manager-modal";
import { InventoryHistoryDrawer } from "./inventory-history-drawer";
import {
  SHEET_LINKS_QUERY_KEY,
  confirmForceSync,
  describeLinkOutcome,
  describeSyncResult,
  requestSheetSync,
  useSheetLinks,
} from "./inventory-sheet-links-modal";
import type { LinkType, SheetType } from "@/lib/accounting/inventory-sheet-sync";
import { MonthlyBaseCostView, type MonthlyBaseCostViewRef } from "./monthly-base-cost-view";
import { PaginationBar } from "./pagination-bar";
import { FbmPwCostView, type FbmPwCostViewRef } from "./fbm-pw-cost-view";

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

// Universal Entity Badge: renders clean, readable text like Excel without distracting colors
function EntityBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400 font-normal">—</span>;
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
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return (
    <span className="text-slate-900 font-normal text-[13px] whitespace-nowrap">
      {clean}
    </span>
  );
}

function ProductTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return <span className="text-slate-400 font-normal">—</span>;
  const clean = typeof type === "string" ? type.trim() : "";
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
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return (
    <span className="text-slate-900 font-normal text-[13px] whitespace-nowrap">
      {clean}
    </span>
  );
}

// Interactive Combobox input with real floating dropdown list and free-text editing
function OptionTextInput({
  value,
  onChange,
  options = [],
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cleanOptions = useMemo(() => {
    return Array.from(new Set((options || []).map((o) => (o || "").trim()).filter(isValidComboboxOption)));
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!value || !value.trim()) return cleanOptions;
    const q = value.trim().toLowerCase();
    const exactMatch = cleanOptions.find((o) => o.toLowerCase() === q);
    if (exactMatch && cleanOptions.length <= 20) return cleanOptions;
    const matches = cleanOptions.filter((o) => o.toLowerCase().includes(q));
    return matches.length > 0 ? matches : cleanOptions;
  }, [cleanOptions, value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasOptions = cleanOptions.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (hasOptions) setIsOpen(true);
          }}
          onFocus={() => {
            if (hasOptions) setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsOpen(false);
            } else if (e.key === "ArrowDown" && hasOptions && !isOpen) {
              e.preventDefault();
              setIsOpen(true);
            }
          }}
          className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden transition ${
            hasOptions ? "pr-8" : ""
          } ${className}`}
        />
        {hasOptions && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setIsOpen((prev) => !prev);
              if (!isOpen && inputRef.current) inputRef.current.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition cursor-pointer"
            title="Mở danh sách lựa chọn"
          >
            <CaretDownIcon
              size={13}
              weight="bold"
              className={`transition-transform duration-150 ${isOpen ? "rotate-180 text-indigo-600" : ""}`}
            />
          </button>
        )}
      </div>

      {isOpen && hasOptions && (
        <div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-black/5 animate-in fade-in-50 zoom-in-95 duration-100">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const isSelected = opt.toLowerCase() === (value || "").trim().toLowerCase();
              return (
                <button
                  key={opt}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(opt);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs transition flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "bg-indigo-50 font-bold text-indigo-700"
                      : "text-slate-700 hover:bg-slate-100 font-medium"
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {isSelected && <span className="text-indigo-600 font-black text-xs">✓</span>}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-center text-xs text-slate-400 italic">
              Không có lựa chọn phù hợp
            </div>
          )}
        </div>
      )}
    </div>
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
  "sup",
  "line_ship",
  "status",
  "trang_thai",
  "tinh_trang_hang_den_kho",
]);

export const CHECK_SHIPMENT_COMBOBOX_FIELDS = new Set([
  "brand",
  "ship_to",
  "status",
]);

export function isComboboxField(table: "sku" | "inbound" | "check_shipment", fieldId: string): boolean {
  if (table === "sku") return SKU_COMBOBOX_FIELDS.has(fieldId);
  if (table === "inbound") return INBOUND_COMBOBOX_FIELDS.has(fieldId);
  return CHECK_SHIPMENT_COMBOBOX_FIELDS.has(fieldId);
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

export function cleanMonthOnly(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") {
    if (val instanceof Date && !isNaN(val.getTime())) {
      try {
        return val.toISOString().split("T")[0].substring(0, 7);
      } catch {
        const year = val.getFullYear();
        const month = String(val.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
      }
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
  if (/T\d{2}:\d{2}/i.test(s)) s = s.split(/[Tt]\d{2}:\d{2}/)[0].trim();
  if (s.includes(" 00:00:00")) s = s.split(" ")[0].trim();
  s = s.replace(/(\s+|T)?\d{2}:\d{2}:\d{2}(\.\d+)?Z?/i, "").trim();

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}`;
  }

  // YYYY-MM or YYYY/MM
  const ymMatch = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ymMatch) {
    return `${ymMatch[1]}-${ymMatch[2].padStart(2, "0")}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^\d{1,2}[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[2]}-${dmyMatch[1].padStart(2, "0")}`;
  }

  // MM/YYYY or MM-YYYY or M/YYYY
  const myMatch = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (myMatch) {
    return `${myMatch[2]}-${myMatch[1].padStart(2, "0")}`;
  }

  // Text like "Tháng 05/2026", "T5/2026"
  const textMonthMatch = s.match(/(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (textMonthMatch) {
    return `${textMonthMatch[2]}-${textMonthMatch[1].padStart(2, "0")}`;
  }

  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    try {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } catch {
      // ignore
    }
  }

  return s;
}

export function isMonthField(field: string): boolean {
  return field === "thang_listing" || field === "thang_danh_gia";
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
    "ngay_len_camp",
    "ngay_update",
    "created_date",
    "last_updated_date",
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
  if (field && isMonthField(field)) {
    return cleanMonthOnly(s);
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

// Active inline editor input only rendered when a cell is actively in edit mode
function ActiveCellEditor({
  table,
  id,
  field,
  value,
  options = [],
  onSave,
  onCancel,
  inputAlignClass,
  hasOptions,
}: {
  table: "sku" | "inbound" | "check_shipment";
  id: string;
  field: string;
  value: unknown;
  options?: string[];
  onSave: (table?: "sku" | "inbound" | "check_shipment" | unknown, id?: string, field?: string, val?: string) => void | Promise<void>;
  onCancel: () => void;
  inputAlignClass: string;
  hasOptions: boolean;
}) {
  const [localVal, setLocalVal] = useState(() => getRawEditableString(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const isCommittingRef = useRef(false);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    });
  }, []);

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

  const typed = localVal.trim().toLowerCase();
  const suggestedOptions = typed && localVal !== getRawEditableString(value)
    ? options.filter((option) => option.toLowerCase().includes(typed))
    : options;

  return (
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
          className={`h-full w-full rounded border border-emerald-500 bg-white px-2 ${hasOptions ? "pr-6" : ""} text-[13px] ${
            field === "sku" ? "font-bold" : "font-normal"
          } text-slate-950 focus:outline-none ${inputAlignClass}`}
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
                className="block w-full whitespace-nowrap rounded px-2.5 py-1.5 text-left text-[13px] font-medium text-slate-900 hover:bg-indigo-50 hover:text-indigo-700"
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
  );
}

// Ultra-fast, Excel-like Inline Editable Cell (0ms keystroke lag, auto-save on blur / Enter)
// Tab đã mở nhưng đang ẩn: bỏ qua render lại (DOM/state/ref giữ nguyên) để chuyển tab hoặc thao tác ở tab
// khác không phải reconcile cả bảng ẩn. Khi tab hiện lại sẽ render với dữ liệu mới nhất.
const FreezeWhenHidden = memo(
  function FreezeWhenHidden({ render }: { active: boolean; frozen?: boolean; render: () => React.ReactNode }) {
    return <>{render()}</>;
  },
  // frozen: đang chờ chuyển tab (lượt render khẩn chỉ để đổi màu nút) — chưa cần dựng lại bảng.
  (_prevProps, nextProps) => !nextProps.active || !!nextProps.frozen,
);

const EditableCell = memo(
  function EditableCell({
    table,
    id,
    field,
    value,
    display,
    className = "",
    style,
    inlineEditing,
    inlineSaving: _inlineSaving,
    onStartEdit,
    onChangeValue: _onChangeValue,
    onSave,
    onCancel,
    options = [],
  }: {
    table: "sku" | "inbound" | "check_shipment";
    id: string;
    field: string;
    value: unknown;
    display: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    inlineEditing: { table: "sku" | "inbound" | "check_shipment"; id: string; field: string; value?: string } | null;
    inlineSaving?: boolean;
    onStartEdit: (table: "sku" | "inbound" | "check_shipment", id: string, field: string, val?: unknown) => void;
    onChangeValue?: (newVal: string) => void;
    onSave: (table?: "sku" | "inbound" | "check_shipment" | unknown, id?: string, field?: string, val?: string) => void | Promise<void>;
    onCancel: () => void;
    options?: string[];
  }) {
    const isEditing =
      inlineEditing?.table === table &&
      inlineEditing?.id === id &&
      inlineEditing?.field === field;

    const alignClass = className.includes("text-center")
      ? "justify-center text-center"
      : className.includes("text-right")
      ? "justify-end text-right"
      : "justify-start text-left";

    const hasOptions = options.length > 0;

    return (
      <td
        onDoubleClick={() => onStartEdit(table, id, field, value)}
        style={{
          ...style,
          ...(isEditing ? { zIndex: 90 } : {}),
        }}
        className={`group/cell relative cursor-pointer select-none transition-colors hover:bg-amber-100/60 ${className} ${
          isEditing ? "!z-[90] overflow-visible" : "overflow-hidden"
        }`}
      >
        {/* Ghost in-flow content maintains EXACT column width and height - ZERO SHIFT */}
        <div className={`w-full h-full flex items-center min-w-0 ${alignClass} ${isEditing ? "invisible pointer-events-none select-none opacity-0" : ""}`}>
          <div
            className="truncate w-full min-w-0"
            title={
              typeof display === "string"
                ? display
                : typeof value === "string"
                ? value
                : undefined
            }
          >
            {display}
          </div>
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
          <ActiveCellEditor
            table={table}
            id={id}
            field={field}
            value={value}
            options={options}
            onSave={onSave}
            onCancel={onCancel}
            inputAlignClass={
              className.includes("text-center")
                ? "text-center"
                : className.includes("text-right")
                ? "text-right"
                : "text-left"
            }
            hasOptions={hasOptions}
          />
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
    // style chứa độ rộng / vị trí khóa cột: đổi độ rộng cột mà bỏ qua thì ô lệch khỏi tiêu đề
    const prevStyle = (prevProps.style ?? {}) as Record<string, unknown>;
    const nextStyle = (nextProps.style ?? {}) as Record<string, unknown>;
    const styleKeys = new Set([...Object.keys(prevStyle), ...Object.keys(nextStyle)]);
    for (const key of styleKeys) if (prevStyle[key] !== nextStyle[key]) return false;
    if (prevProps.options?.length !== nextProps.options?.length) return false;
    if (prevProps.options?.some((option, index) => option !== nextProps.options?.[index])) return false;
    return true;
  }
);

// High-performance Pagination Bar (50/trang, Trang 1/X, previous/next, jump)
function getOptimizedThumbnailUrl(url: string | null | undefined, w = 64): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("media-amazon.com") || trimmed.includes("images-amazon.com")) {
    if (/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    if (/\/images\/I\/[A-Za-z0-9%_+-]+\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    return trimmed;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/accounting/inventory/mockup-proxy?w=${w}&url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

// Background Image Preload Queue (limited concurrency: max 4 parallel requests to prevent network congestion)
const preloadedImageUrls = new Set<string>();
const preloadQueue: string[] = [];
let activePreloadWorkers = 0;
const MAX_CONCURRENT_PRELOADS = 4;

function processNextPreload() {
  if (typeof window === "undefined" || activePreloadWorkers >= MAX_CONCURRENT_PRELOADS) return;
  const nextUrl = preloadQueue.shift();
  if (!nextUrl) return;

  activePreloadWorkers++;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    preloadedImageUrls.add(nextUrl);
    activePreloadWorkers--;
    processNextPreload();
  };
  img.onerror = () => {
    activePreloadWorkers--;
    processNextPreload();
  };
  img.src = nextUrl;
}

export function queuePreloadImage(url: string | null | undefined) {
  if (!url || typeof window === "undefined") return;
  const optUrl = getOptimizedThumbnailUrl(url);
  if (!optUrl || preloadedImageUrls.has(optUrl) || preloadQueue.includes(optUrl)) return;
  preloadQueue.push(optUrl);
  processNextPreload();
}

// Automatically downscale an image (File, Blob, or DataURL) to max dimension and compress to WebP
async function downscaleImage(
  source: File | Blob | string,
  maxDimension = 240,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const handleImageLoaded = (img: HTMLImageElement) => {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) {
        resolve(typeof source === "string" ? source : "");
        return;
      }
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(typeof source === "string" ? source : "");
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      try {
        const webpUrl = canvas.toDataURL("image/webp", quality);
        if (webpUrl && webpUrl.startsWith("data:image/webp")) {
          resolve(webpUrl);
          return;
        }
      } catch {}
      try {
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(typeof source === "string" ? source : "");
      }
    };

    if (typeof source === "string") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => handleImageLoaded(img);
      img.onerror = () => resolve(source);
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => handleImageLoaded(img);
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error("Không thể đọc file ảnh"));
      reader.readAsDataURL(source);
    }
  });
}

// Extract image from clipboard event (handles pasted files, blobs, data URLs, image URLs)
async function extractImageFromClipboard(
  e: React.ClipboardEvent | ClipboardEvent,
  maxDimension = 240
): Promise<string | null> {
  const items = e.clipboardData?.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          return await downscaleImage(file, maxDimension);
        }
      }
    }
  }

  const text = e.clipboardData?.getData("text")?.trim();
  if (text) {
    if (text.startsWith("data:image/")) {
      e.preventDefault();
      return await downscaleImage(text, maxDimension);
    }
    if (text.startsWith("http://") || text.startsWith("https://")) {
      if (text.match(/\.(jpeg|jpg|png|gif|webp|avif|svg)(\?.*)?$/i)) {
        e.preventDefault();
        try {
          return await downscaleImage(text, maxDimension);
        } catch {
          return text;
        }
      }
    }
  }

  return null;
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

// Compact, Interactive Mockup Cell with Paste & Auto-Downscale support in tables
const MockupCell = memo(function MockupCell({
  table,
  id,
  field,
  url,
  alt,
  onPreview,
  onSave,
  notify,
}: {
  table: "sku" | "inbound";
  id: string;
  field: "mockup" | "mockup_url";
  url: string | null;
  alt: string;
  onPreview?: (preview: {
    url: string;
    table: "sku" | "inbound";
    id: string;
    field: "mockup" | "mockup_url";
    title: string;
  }) => void;
  onSave: (table: "sku" | "inbound", id: string, field: string, value: string) => Promise<void> | void;
  notify?: (message: string, type?: "success" | "error") => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasError, setHasError] = useState(false);
  const optimizedUrl = useMemo(() => getOptimizedThumbnailUrl(url), [url]);

  const handleProcessImage = async (fileOrUrl: File | Blob | string) => {
    setIsProcessing(true);
    try {
      const downscaled = await downscaleImage(fileOrUrl, 240, 0.82);
      await onSave(table, id, field, downscaled);
      notify?.("Đã dán và tự động nén ảnh Mockup!", "success");
    } catch (err) {
      notify?.("Lỗi xử lý ảnh: " + (err as Error).message, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const extracted = await extractImageFromClipboard(e, 240);
    if (extracted) {
      await handleProcessImage(extracted);
    }
  };

  const handleOpenPreview = () => {
    onPreview?.({
      url: url || "",
      table,
      id,
      field,
      title: alt,
    });
  };

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      className="group/mockup relative flex h-11 w-11 mx-auto items-center justify-center rounded-lg border border-slate-200 bg-white p-0.5 hover:border-indigo-500 hover:ring-2 hover:ring-indigo-200 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-300 focus:outline-hidden transition shadow-2xs select-none"
      title="Click ảnh để xem chi tiết / thay ảnh | Dán ảnh nhanh (Ctrl+V)"
    >
      {isProcessing ? (
        <div className="flex h-full w-full items-center justify-center text-indigo-600 bg-white/90">
          <ArrowClockwiseIcon size={18} weight="bold" className="animate-spin" />
        </div>
      ) : url && !hasError ? (
        <button
          type="button"
          onClick={handleOpenPreview}
          className="h-full w-full block overflow-hidden rounded cursor-pointer"
        >
          <img
            src={optimizedUrl || url}
            alt={alt}
            width={44}
            height={44}
            loading="eager"
            decoding="async"
            onError={(e) => {
              // Nếu link proxy bị lỗi, fallback thử link trực tiếp
              const target = e.currentTarget;
              if (url && target.src !== url) {
                target.src = url;
              } else {
                setHasError(true);
              }
            }}
            className="h-full w-full object-contain rounded transition-transform duration-150 group-hover/mockup:scale-105"
          />
        </button>
      ) : (
        /* Empty placeholder */
        <div
          onClick={() => {
            onPreview?.({
              url: "",
              table,
              id,
              field,
              title: alt,
            });
          }}
          className="flex h-full w-full items-center justify-center rounded bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
          title="Chưa có ảnh. Click để xem chi tiết / đổi ảnh hoặc ấn Ctrl+V để dán"
        >
          <ImageSquareIcon size={20} weight="duotone" />
        </div>
      )}
    </div>
  );
});

// Full-featured Mockup Paste & Upload Field for Add/Edit Modals
function MockupPasteField({
  label = "Ảnh Mockup",
  value,
  onChange,
  onPreview,
  notify,
}: {
  label?: string;
  value: string;
  onChange: (val: string) => void;
  onPreview?: (url: string) => void;
  notify?: (message: string, type?: "success" | "error") => void;
}) {
  const [isCompressing, setIsCompressing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const optimizedUrl = useMemo(() => getOptimizedThumbnailUrl(value), [value]);

  const handleProcess = async (fileOrUrl: File | Blob | string) => {
    setIsCompressing(true);
    try {
      const downscaled = await downscaleImage(fileOrUrl, 280, 0.82);
      onChange(downscaled);
      notify?.("Đã nén và tự động tối ưu ảnh Mockup!", "success");
    } catch (err) {
      notify?.("Lỗi nén ảnh: " + (err as Error).message, "error");
    } finally {
      setIsCompressing(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const extracted = await extractImageFromClipboard(e, 280);
    if (extracted) {
      await handleProcess(extracted);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleProcess(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-1.5 md:col-span-3">
      <div className="flex items-center justify-between">
        <label className="font-bold text-slate-700 flex items-center gap-1.5">
          <ImageSquareIcon size={16} weight="bold" className="text-indigo-600" />
          <span>{label}</span>
          <span className="text-[11px] font-normal text-slate-500">(Cho phép dán ảnh trực tiếp với Ctrl+V)</span>
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            Xóa ảnh
          </button>
        )}
      </div>

      <div
        tabIndex={0}
        onPaste={handlePaste}
        className="flex flex-col sm:flex-row items-center gap-3 p-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 hover:bg-slate-50 hover:border-indigo-400 focus:border-indigo-500 focus:bg-indigo-50/30 focus:outline-hidden transition"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />

        {/* Thumbnail Preview Box */}
        <div className="relative h-16 w-16 shrink-0 rounded-lg border border-slate-300 bg-white p-0.5 overflow-hidden flex items-center justify-center shadow-2xs">
          {isCompressing ? (
            <ArrowClockwiseIcon size={24} className="animate-spin text-indigo-600" />
          ) : value ? (
            <img
              src={optimizedUrl || value}
              alt="Mockup preview"
              className="h-full w-full object-contain rounded cursor-pointer"
              onClick={() => onPreview?.(value)}
              title="Click để phóng to ảnh"
            />
          ) : (
            <ImageSquareIcon size={28} className="text-slate-300" />
          )}
        </div>

        {/* Controls: URL input or Paste Zone Hint */}
        <div className="flex-1 w-full space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Dán ảnh (Ctrl+V) tại đây hoặc nhập link URL https://..."
              value={value.startsWith("data:image/") ? "[Ảnh đã tải lên & tự động nén WebP]" : value}
              onChange={(e) => {
                if (!e.target.value.startsWith("[Ảnh")) {
                  onChange(e.target.value);
                }
              }}
              onPaste={handlePaste}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs font-mono"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-100 hover:text-indigo-600 transition shadow-2xs cursor-pointer shrink-0 flex items-center gap-1.5"
            >
              <UploadSimpleIcon size={14} weight="bold" />
              <span>Chọn file</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <span>💡 <b>Mẹo:</b> Sao chép ảnh từ bất kỳ đâu (Zalo, website, chụp màn hình) rồi ấn <b>Ctrl+V</b> để dán. Hệ thống sẽ tự động downscale ảnh WebP siêu nhẹ.</span>
          </p>
        </div>
      </div>
    </div>
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
  "delivered": { bg: "bg-blue-100", text: "text-blue-950", border: "border-blue-300" },
  "cancelled": { bg: "bg-rose-100", text: "text-rose-950", border: "border-rose-300" },
  "deleted": { bg: "bg-slate-200", text: "text-slate-800", border: "border-slate-400" },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400 font-normal">—</span>;
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
    return <span className="text-slate-400 font-normal">—</span>;
  }
  return (
    <span className="text-slate-900 font-normal text-[13px] whitespace-nowrap">
      {s}
    </span>
  );
}

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const s = cleanDateOnly(val);
  return s || "—";
}

function formatMonth(val: string | null | undefined): string {
  if (!val) return "—";
  const s = cleanMonthOnly(val);
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

const emptyCheckShipmentForm = {
  id: "",
  ngay_update: "",
  brand: "",
  shipment_name: "",
  shipment_id: "",
  created_date: "",
  last_updated_date: "",
  ship_to: "",
  skus_count: "",
  units_expected: "",
  units_located: "",
  discrepancy: "",
  status: "Closed",
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
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "";
    }
    return "";
  });
  const selectedStore = useMemo(() => stores.find((s) => s.id === selectedStoreId), [stores, selectedStoreId]);
  const [loadingStores, setLoadingStores] = useState(true);

  // Giữ nguyên tab Inventory đang mở khi reload trang trong cùng một phiên browser.
  type InventoryTab = "sku" | "inbound" | "check_shipment" | "monthly_base_cost";
  const [activeTab, setActiveTab] = useState<InventoryTab>(() => {
    if (typeof window === "undefined") return "sku";
    const savedTab = window.sessionStorage.getItem("accounting_inventory_active_tab");
    return savedTab === "sku" || savedTab === "inbound" || savedTab === "check_shipment" || savedTab === "monthly_base_cost"
      ? savedTab
      : "sku";
  });

  useEffect(() => {
    window.sessionStorage.setItem("accounting_inventory_active_tab", activeTab);
  }, [activeTab]);

  const [visitedTabs, setVisitedTabs] = useState<Record<InventoryTab, boolean>>(() => ({
    sku: activeTab === "sku",
    inbound: activeTab === "inbound",
    check_shipment: activeTab === "check_shipment",
    monthly_base_cost: activeTab === "monthly_base_cost",
  }));

  // Nút tab đổi màu ngay theo activeTab; phần bảng đi theo shownTab (deferred) nên được render ở mức ưu tiên
  // thấp, chia nhỏ — click/hover không bị đơ trong lúc dựng bảng của tab mới.
  const shownTab = useDeferredValue(activeTab);
  const tabSwitchPending = shownTab !== activeTab;
  if (!visitedTabs[shownTab]) setVisitedTabs((prev) => ({ ...prev, [shownTab]: true }));

  const handleTabChange = useCallback((tab: InventoryTab) => {
    setActiveTab(tab);
  }, []);

  // Store có team FBM có thêm tab BẢNG MÃ FBM: cùng giao diện/chức năng BẢNG MÃ nhưng dữ liệu
  // và import tách riêng (bảng accounting_sku_master_fbm).
  // Phân quyền kế toán: chỉ hiện kênh người dùng được xem (team FBA x → FBA; team FBM → FBM)
  const storeHasFbm = storeHasTeam(selectedStore?.team, "FBM") && storeCanView(selectedStore, "FBM");
  const storeCanFba = loadingStores || storeCanView(selectedStore, "FBA");
  // Không xem được FBA: tab Đi Hàng / Check Shipment (chỉ có FBA) quay về Bảng Mã FBM
  if (!storeCanFba && (activeTab === "inbound" || activeTab === "check_shipment")) handleTabChange("sku");
  const [skuChannelState, setSkuChannelState] = useState<SkuChannel>(() => {
    if (typeof window === "undefined") return "fba";
    return window.sessionStorage.getItem("accounting_inventory_sku_channel") === "fbm" ? "fbm" : "fba";
  });
  const skuChannel: SkuChannel = !storeCanFba ? "fbm" : loadingStores || storeHasFbm ? skuChannelState : "fba";
  const isFbmSheet = activeTab === "sku" && skuChannel === "fbm";
  const skuEntityType = skuChannel === "fbm" ? "sku_fbm" : "sku";
  const skuSheetLabel = skuChannel === "fbm" ? "Bảng Mã FBM" : "Bảng Mã";

  const monthlyBaseCostRef = useRef<MonthlyBaseCostViewRef>(null);
  // Store có team FBM có thêm tab BASECOST THÁNG FBM (dữ liệu ĐẦU VÀO FBM PW từ link Kế Toán Tổng Hợp FBM),
  // dùng chung tab Basecost Tháng như cặp Bảng Mã / Bảng Mã FBM.
  const [baseCostChannelState, setBaseCostChannelState] = useState<SkuChannel>(() => {
    if (typeof window === "undefined") return "fba";
    return window.sessionStorage.getItem("accounting_inventory_basecost_channel") === "fbm" ? "fbm" : "fba";
  });
  const baseCostChannel: SkuChannel = !storeCanFba ? "fbm" : loadingStores || storeHasFbm ? baseCostChannelState : "fba";
  const isFbmBaseCost = activeTab === "monthly_base_cost" && baseCostChannel === "fbm";
  const fbmPwCostRef = useRef<FbmPwCostViewRef>(null);
  const handleBaseCostChannelChange = useCallback((channel: SkuChannel) => {
    setBaseCostChannelState(channel);
    window.sessionStorage.setItem("accounting_inventory_basecost_channel", channel);
    handleTabChange("monthly_base_cost");
  }, [handleTabChange]);
  const [monthlyBaseCostYear, setMonthlyBaseCostYear] = useState<number>(2026);
  const [syncingMonthlyBaseCost, setSyncingMonthlyBaseCost] = useState<boolean>(false);

  // Search & Filter state (Debounced 300ms)
  const [skuSearch, setSkuSearch] = useState("");
  const [skuStatusFilter, setSkuStatusFilter] = useState("");
  const [skuTypeFilter, setSkuTypeFilter] = useState("");
  const debouncedSkuSearch = useDebounce(skuSearch, 300);

  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentStatusFilter, setShipmentStatusFilter] = useState("");
  const debouncedShipmentSearch = useDebounce(shipmentSearch, 300);

  const [checkShipmentSearch, setCheckShipmentSearch] = useState("");
  const [checkShipmentStatusFilter, setCheckShipmentStatusFilter] = useState("");
  const [checkShipmentBrandFilter, setCheckShipmentBrandFilter] = useState("");
  const debouncedCheckShipmentSearch = useDebounce(checkShipmentSearch, 300);

  const [monthlyBaseCostSearch, setMonthlyBaseCostSearch] = useState("");
  const debouncedMonthlyBaseCostSearch = useDebounce(monthlyBaseCostSearch, 300);

  // Bấm tiêu đề một cột ngày để đổi giữa mới nhất và cũ nhất.
  // Mặc định Bảng Mã và Đi Hàng sắp xếp theo ngày tạo (created_at DESC) để dòng mới luôn ở trên đầu.
  const [dateSort, setDateSort] = useState<Record<"sku" | "inbound" | "check_shipment", { field: string; direction: "asc" | "desc" }>>({
    sku: { field: "created_at", direction: "desc" },
    inbound: { field: "created_at", direction: "desc" },
    check_shipment: { field: "ngay_update", direction: "desc" },
  });
  const [columnFilters, setColumnFilters] = useState<Record<"sku" | "inbound" | "check_shipment", Record<string, string>>>({
    sku: {},
    inbound: {},
    check_shipment: {},
  });
  const [openColumnFilter, setOpenColumnFilter] = useState<{ table: "sku" | "inbound" | "check_shipment"; field: string } | null>(null);
  const [columnContextMenu, setColumnContextMenu] = useState<{
    table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost";
    field: string;
    x: number;
    y: number;
  } | null>(null);
  const [frozenThrough, setFrozenThrough] = useState<Record<"sku" | "inbound" | "check_shipment" | "monthly_base_cost", string>>({
    sku: "sku",
    inbound: "sku",
    check_shipment: "shipment_name",
    monthly_base_cost: "asin",
  });
  const skuTableRef = useRef<HTMLTableElement>(null);
  const inboundTableRef = useRef<HTMLTableElement>(null);
  const checkShipmentTableRef = useRef<HTMLTableElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!columnContextMenu) return;
    const closeMenu = (event: MouseEvent) => {
      if (!columnMenuRef.current?.contains(event.target as Node)) setColumnContextMenu(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [columnContextMenu]);
  const setColumnFilter = useCallback((table: "sku" | "inbound" | "check_shipment", field: string, value: string) => {
    setColumnFilters((previous) => {
      const nextTable = { ...previous[table] };
      if (!value) {
        delete nextTable[field];
      } else {
        nextTable[field] = value;
      }
      return {
        ...previous,
        [table]: nextTable,
      };
    });
    if (table === "sku") setSkuPage(1);
    if (table === "inbound") setShipmentPage(1);
    if (table === "check_shipment") setCheckShipmentPage(1);
  }, []);
  const toggleDateSort = useCallback((table: "sku" | "inbound" | "check_shipment", field: string) => {
    setDateSort((previous) => {
      const current = previous[table];
      return {
        ...previous,
        [table]: {
          field,
          direction: current.field === field && current.direction === "desc" ? "asc" : "desc",
        },
      };
    });
  }, []);

  // Blur backdrop mockup preview modal state (with optional inline change action)
  const [previewModal, setPreviewModal] = useState<{
    url: string;
    table?: "sku" | "inbound";
    id?: string;
    field?: "mockup" | "mockup_url";
    title?: string;
  } | null>(null);
  const [isUpdatingPreviewMockup, setIsUpdatingPreviewMockup] = useState(false);
  const previewFileInputRef = useRef<HTMLInputElement>(null);

  // Column management states
  const [skuColumns, setSkuColumns] = useState<ColumnConfig[]>(DEFAULT_SKU_COLUMNS);
  const [inboundColumns, setInboundColumns] = useState<ColumnConfig[]>(DEFAULT_INBOUND_COLUMNS);
  const [checkShipmentColumns, setCheckShipmentColumns] = useState<ColumnConfig[]>(DEFAULT_CHECK_SHIPMENT_COLUMNS);
  const [monthlyBaseCostColumns, setMonthlyBaseCostColumns] = useState<ColumnConfig[]>(DEFAULT_MONTHLY_BASE_COST_COLUMNS);
  const [showColumnModal, setShowColumnModal] = useState(false);

  // BẢNG MÃ FBM có bộ cột riêng (theo mẫu sheet FBM) và lưu thiết lập cột riêng.
  const SKU_COLUMNS_STORAGE_KEY = skuChannel === "fbm" ? "accounting_sku_fbm_columns_global" : "accounting_sku_columns_global";
  const skuDefaultColumns = skuChannel === "fbm" ? DEFAULT_FBM_SKU_COLUMNS : DEFAULT_SKU_COLUMNS;
  const INBOUND_COLUMNS_STORAGE_KEY = "accounting_inbound_columns_global";
  const CHECK_SHIPMENT_COLUMNS_STORAGE_KEY = "accounting_check_shipment_columns_global";
  const MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY = "accounting_monthly_base_cost_columns_global";
  const FROZEN_COLUMNS_STORAGE_KEY = "accounting_frozen_columns_global";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(FROZEN_COLUMNS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setFrozenThrough((current) => ({ ...current, ...parsed }));
    } catch {}
  }, [FROZEN_COLUMNS_STORAGE_KEY, selectedStoreId]);

  const setFrozenThroughColumn = useCallback((table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost", field: string) => {
    setFrozenThrough((current) => {
      const next = { ...current, [table]: field };
      try { localStorage.setItem(FROZEN_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [FROZEN_COLUMNS_STORAGE_KEY]);

  // Column sizes are deliberately stored as pixels. This keeps widths stable when
  // the browser is zoomed and makes the resize handle work for custom columns too.
  const getColumnWidth = useCallback((column?: ColumnConfig, fallback = 160) => {
    if (!column?.width) return fallback;
    if (typeof column.width === "number") return column.width;
    if (typeof column.width === "string") {
      const match = column.width.match(/w-\[(\d+)px\]/);
      if (match) return Number(match[1]);
      const num = parseInt(column.width, 10);
      if (!isNaN(num) && num > 0) return num;
    }
    return fallback;
  }, []);

  const resizeColumn = useCallback((table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost", id: string, width: number) => {
    const update = (columns: ColumnConfig[]) => columns.map((column) => column.id === id ? { ...column, width } : column);
    if (table === "sku") {
      setSkuColumns((previous) => {
        const next = update(previous);
        try { localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    } else if (table === "inbound") {
      setInboundColumns((previous) => {
        const next = update(previous);
        try { localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    } else if (table === "check_shipment") {
      setCheckShipmentColumns((previous) => {
        const next = update(previous);
        try { localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    } else {
      setMonthlyBaseCostColumns((previous) => {
        const next = update(previous);
        try { localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [SKU_COLUMNS_STORAGE_KEY, INBOUND_COLUMNS_STORAGE_KEY, CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  // A resize can start anywhere on the last 8px of a header. This also covers
  // the permanently frozen identification columns, not only dynamic columns.
  const handleHeaderResizePointerDown = useCallback((
    table: "sku" | "inbound" | "check_shipment",
    columnIds: string[],
    event: React.PointerEvent<HTMLTableSectionElement>,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, select, input, a")) return;
    const header = target.closest("th");
    if (!header) return;
    const index = Array.from(header.parentElement?.children || []).indexOf(header);
    const columnId = columnIds[index];
    if (!columnId) return;
    const bounds = header.getBoundingClientRect();
    if (bounds.right - event.clientX > 10) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = bounds.width;
    const onMove = (moveEvent: PointerEvent) => {
      resizeColumn(table, columnId, Math.max(72, Math.min(520, Math.round(startWidth + moveEvent.clientX - startX))));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [resizeColumn]);

  const handleHeaderClick = useCallback((
    table: "sku" | "inbound" | "check_shipment",
    columnIds: string[],
    event: React.MouseEvent<HTMLTableSectionElement>,
  ) => {
    if ((event.target as HTMLElement).closest("button, select, input, a")) return;
    const header = (event.target as HTMLElement).closest("th");
    if (!header) return;
    const index = Array.from(header.parentElement?.children || []).indexOf(header);
    const field = columnIds[index];
    if (!field) return;
    setColumnContextMenu({ table, field, x: event.clientX, y: event.clientY });
  }, []);

  // Load columns from localStorage (áp dụng đồng bộ tất cả store)
  useEffect(() => {
    try {
      const mergeFromParsed = (parsedCols: ColumnConfig[], defaultCols: ColumnConfig[]) => {
        const defaultMap = new Map(defaultCols.map((def) => [def.id, def]));
        const ordered: ColumnConfig[] = [];
        const seenIds = new Set<string>();

        // Giữ chính xác thứ tự, độ rộng (kéo dãn/thu nhỏ) và trạng thái hiển thị của người dùng
        for (const item of parsedCols) {
          if (seenIds.has(item.id)) continue;
          if (defaultMap.has(item.id)) {
            const def = defaultMap.get(item.id)!;
            ordered.push({
              ...def,
              ...item,
              width: item.width ?? def.width,
              label: item.label || def.label,
            });
            seenIds.add(item.id);
          } else if (item.isCustom) {
            ordered.push(item);
            seenIds.add(item.id);
          }
        }

        // Bổ sung các cột mặc định còn thiếu (nếu có update)
        for (const def of defaultCols) {
          if (!seenIds.has(def.id)) {
            if (def.id === "gia_tri_ton") {
              const tonIdx = ordered.findIndex((c) => c.id === "ton_kho");
              if (tonIdx >= 0) {
                ordered.splice(tonIdx + 1, 0, def);
                seenIds.add(def.id);
                continue;
              }
            }
            ordered.push(def);
            seenIds.add(def.id);
          }
        }
        return ordered;
      };

      const skuStored = localStorage.getItem(SKU_COLUMNS_STORAGE_KEY);
      if (skuStored) {
        const parsed: ColumnConfig[] = JSON.parse(skuStored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSkuColumns(mergeFromParsed(parsed, skuDefaultColumns));
        }
      } else {
        setSkuColumns(skuDefaultColumns);
      }

      const inboundStored = localStorage.getItem(INBOUND_COLUMNS_STORAGE_KEY);
      if (inboundStored) {
        const parsed: ColumnConfig[] = JSON.parse(inboundStored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setInboundColumns(mergeFromParsed(parsed, DEFAULT_INBOUND_COLUMNS));
        }
      } else {
        setInboundColumns(DEFAULT_INBOUND_COLUMNS);
      }

      const checkStored = localStorage.getItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY);
      if (checkStored) {
        const parsed: ColumnConfig[] = JSON.parse(checkStored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCheckShipmentColumns(mergeFromParsed(parsed, DEFAULT_CHECK_SHIPMENT_COLUMNS));
        }
      } else {
        setCheckShipmentColumns(DEFAULT_CHECK_SHIPMENT_COLUMNS);
      }

      const monthlyStored = localStorage.getItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY);
      if (monthlyStored) {
        const parsed: ColumnConfig[] = JSON.parse(monthlyStored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMonthlyBaseCostColumns(mergeFromParsed(parsed, DEFAULT_MONTHLY_BASE_COST_COLUMNS));
        }
      } else {
        setMonthlyBaseCostColumns(DEFAULT_MONTHLY_BASE_COST_COLUMNS);
      }
    } catch {}
  }, [selectedStoreId, SKU_COLUMNS_STORAGE_KEY, skuDefaultColumns, INBOUND_COLUMNS_STORAGE_KEY, CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  const handleSaveSkuColumns = useCallback((newCols: ColumnConfig[]) => {
    setSkuColumns(newCols);
    try {
      localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify(`Đã lưu thiết lập cột ${skuSheetLabel.toUpperCase()} cho tất cả Store!`, "success");
  }, [SKU_COLUMNS_STORAGE_KEY, skuSheetLabel]);

  const handleResetSkuColumns = useCallback(() => {
    setSkuColumns(skuDefaultColumns);
    try {
      localStorage.removeItem(SKU_COLUMNS_STORAGE_KEY);
    } catch {}
    notify(`Đã khôi phục cột ${skuSheetLabel.toUpperCase()} về mặc định!`, "success");
  }, [SKU_COLUMNS_STORAGE_KEY, skuDefaultColumns, skuSheetLabel]);

  const handleSaveInboundColumns = useCallback((newCols: ColumnConfig[]) => {
    setInboundColumns(newCols);
    try {
      localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify("Đã lưu thiết lập cột CHI TIẾT ĐI HÀNG cho tất cả Store!", "success");
  }, [INBOUND_COLUMNS_STORAGE_KEY]);

  const handleResetInboundColumns = useCallback(() => {
    setInboundColumns(DEFAULT_INBOUND_COLUMNS);
    try {
      localStorage.removeItem(INBOUND_COLUMNS_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục cột CHI TIẾT ĐI HÀNG về mặc định!", "success");
  }, [INBOUND_COLUMNS_STORAGE_KEY]);

  const handleSaveCheckShipmentColumns = useCallback((newCols: ColumnConfig[]) => {
    setCheckShipmentColumns(newCols);
    try {
      localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify("Đã lưu thiết lập cột CHECK SHIPMENT cho tất cả Store!", "success");
  }, [CHECK_SHIPMENT_COLUMNS_STORAGE_KEY]);

  const handleResetCheckShipmentColumns = useCallback(() => {
    setCheckShipmentColumns(DEFAULT_CHECK_SHIPMENT_COLUMNS);
    try {
      localStorage.removeItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục cột CHECK SHIPMENT về mặc định!", "success");
  }, [CHECK_SHIPMENT_COLUMNS_STORAGE_KEY]);

  const handleSaveMonthlyBaseCostColumns = useCallback((newCols: ColumnConfig[]) => {
    setMonthlyBaseCostColumns(newCols);
    try {
      localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(newCols));
    } catch {}
    notify("Đã lưu thiết lập cột BASECOST THÁNG cho tất cả Store!", "success");
  }, [MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  const handleResetMonthlyBaseCostColumns = useCallback(() => {
    setMonthlyBaseCostColumns(DEFAULT_MONTHLY_BASE_COST_COLUMNS);
    try {
      localStorage.removeItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY);
    } catch {}
    notify("Đã khôi phục cột BASECOST THÁNG về mặc định!", "success");
  }, [MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  const handleQuickHideColumn = useCallback((tab: "sku" | "inbound" | "check_shipment" | "monthly_base_cost", colId: string) => {
    if (tab === "sku") {
      setSkuColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    } else if (tab === "inbound") {
      setInboundColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    } else if (tab === "check_shipment") {
      setCheckShipmentColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    } else {
      setMonthlyBaseCostColumns((prev) => {
        const updated = prev.map((c) => (c.id === colId ? { ...c, visible: false } : c));
        try {
          localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        return updated;
      });
      notify("Đã ẩn cột khỏi bảng!", "success");
    }
  }, [SKU_COLUMNS_STORAGE_KEY, INBOUND_COLUMNS_STORAGE_KEY, CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  const monthlyBaseCostVisibleCount = useMemo(() => {
    return monthlyBaseCostColumns.filter((c) => c.visible !== false).length;
  }, [monthlyBaseCostColumns]);

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

  const checkShipmentColMap = useMemo(() => {
    const map: Record<string, ColumnConfig> = {};
    for (const c of checkShipmentColumns) map[c.id] = c;
    return map;
  }, [checkShipmentColumns]);

  const checkShipmentCustomColumns = useMemo(() => {
    return checkShipmentColumns.filter((c) => c.isCustom);
  }, [checkShipmentColumns]);

  const checkShipmentVisibleCount = useMemo(() => {
    return checkShipmentColumns.filter((c) => c.visible).length;
  }, [checkShipmentColumns]);

  const activeScrollableCheckShipmentColumns = useMemo(() => {
    return checkShipmentColumns.filter((c) => !c.isFrozen && c.visible !== false);
  }, [checkShipmentColumns]);

  const orderedVisibleSkuColumns = useMemo(() => {
    const fixed = ["stt", "product_type", "mockup", "sku"]
      .map((id) => skuColMap[id])
      .filter((c): c is ColumnConfig => !!c && c.visible !== false);
    return [...fixed, ...activeScrollableSkuColumns];
  }, [skuColMap, activeScrollableSkuColumns]);

  const skuFreezeMap = useMemo(() => {
    const boundary = frozenThrough.sku || "sku";
    const lastFrozenIndex = orderedVisibleSkuColumns.findIndex((c) => c.id === boundary);
    let leftSum = 0;
    const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};
    orderedVisibleSkuColumns.forEach((col, idx) => {
      const width = getColumnWidth(col);
      const isFrozen = lastFrozenIndex >= 0 && idx <= lastFrozenIndex;
      const isBoundary = lastFrozenIndex >= 0 && idx === lastFrozenIndex;
      map[col.id] = {
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
  }, [orderedVisibleSkuColumns, frozenThrough.sku, getColumnWidth]);

  const orderedVisibleInboundColumns = useMemo(() => {
    const fixed = ["stt", "product_type", "mockup", "sku"]
      .map((id) => inboundColMap[id])
      .filter((c): c is ColumnConfig => !!c && c.visible !== false);
    return [...fixed, ...activeScrollableInboundColumns];
  }, [inboundColMap, activeScrollableInboundColumns]);

  const inboundFreezeMap = useMemo(() => {
    const boundary = frozenThrough.inbound || "sku";
    const lastFrozenIndex = orderedVisibleInboundColumns.findIndex((c) => c.id === boundary);
    let leftSum = 0;
    const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};
    orderedVisibleInboundColumns.forEach((col, idx) => {
      const width = getColumnWidth(col);
      const isFrozen = lastFrozenIndex >= 0 && idx <= lastFrozenIndex;
      const isBoundary = lastFrozenIndex >= 0 && idx === lastFrozenIndex;
      map[col.id] = {
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
  }, [orderedVisibleInboundColumns, frozenThrough.inbound, getColumnWidth]);

  const orderedVisibleCheckShipmentColumns = useMemo(() => {
    const fixed = ["stt", "shipment_id", "shipment_name"]
      .map((id) => checkShipmentColMap[id])
      .filter((c): c is ColumnConfig => !!c && c.visible !== false);
    return [...fixed, ...activeScrollableCheckShipmentColumns];
  }, [checkShipmentColMap, activeScrollableCheckShipmentColumns]);

  const checkShipmentFreezeMap = useMemo(() => {
    const boundary = frozenThrough.check_shipment || "shipment_name";
    const lastFrozenIndex = orderedVisibleCheckShipmentColumns.findIndex((c) => c.id === boundary);
    let leftSum = 0;
    const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};
    orderedVisibleCheckShipmentColumns.forEach((col, idx) => {
      const width = getColumnWidth(col);
      const isFrozen = lastFrozenIndex >= 0 && idx <= lastFrozenIndex;
      const isBoundary = lastFrozenIndex >= 0 && idx === lastFrozenIndex;
      map[col.id] = {
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
  }, [orderedVisibleCheckShipmentColumns, frozenThrough.check_shipment, getColumnWidth]);

  const getCellFreezeProps = useCallback(
    (
      freezeMap: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }>,
      colId: string,
      isHeader = false,
    ) => {
      const freeze = freezeMap[colId];
      if (!freeze || !freeze.isFrozen) {
        return {
          isFrozen: false,
          isBoundary: false,
          style: {
            width: freeze?.width,
            minWidth: freeze?.width,
            maxWidth: freeze?.width,
          } as React.CSSProperties,
          className: "",
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
              : "border-r border-slate-300"
          }`;
      return {
        isFrozen: true,
        isBoundary: freeze.isBoundary,
        style,
        className,
      };
    },
    [],
  );

  // Pagination states (Mặc định 100 dòng / trang)
  const [skuPage, setSkuPage] = useState(1);
  const [skuLimit, setSkuLimit] = useState(100);

  const [shipmentPage, setShipmentPage] = useState(1);
  const [shipmentLimit, setShipmentLimit] = useState(100);

  const [checkShipmentPage, setCheckShipmentPage] = useState(1);
  const [checkShipmentLimit, setCheckShipmentLimit] = useState(50);

  const effectiveSkuStatus = columnFilters.sku?.status || skuStatusFilter;
  const effectiveSkuProductType = columnFilters.sku?.product_type || skuTypeFilter;

  // Reset page to 1 when filters or selected store change
  useEffect(() => {
    setSkuPage(1);
  }, [selectedStoreId, debouncedSkuSearch, effectiveSkuStatus, effectiveSkuProductType]);

  useEffect(() => {
    setShipmentPage(1);
  }, [selectedStoreId, debouncedShipmentSearch, shipmentStatusFilter, dateSort.inbound]);

  useEffect(() => {
    setCheckShipmentPage(1);
  }, [selectedStoreId, debouncedCheckShipmentSearch, checkShipmentStatusFilter, checkShipmentBrandFilter]);

  const handleSkuSheetChange = useCallback((channel: SkuChannel) => {
    setSkuChannelState(channel);
    window.sessionStorage.setItem("accounting_inventory_sku_channel", channel);
    setSkuPage(1);
    handleTabChange("sku");
  }, [handleTabChange, setSkuPage]);

  // 1. TanStack Query for SKU Master (Server-side Page Pagination, 100/trang)
  const skuQuery = useQuery({
    queryKey: ["sku-master", selectedStoreId, skuChannel, skuPage, skuLimit, debouncedSkuSearch, effectiveSkuStatus, effectiveSkuProductType],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        store_id: selectedStoreId!,
        page: String(skuPage),
        limit: String(skuLimit),
        channel: skuChannel,
      });
      if (debouncedSkuSearch) params.set("search", debouncedSkuSearch);
      if (effectiveSkuStatus) params.set("status", effectiveSkuStatus);
      if (effectiveSkuProductType) params.set("product_type", effectiveSkuProductType);

      const res = await fetch(`/api/accounting/inventory/sku-master?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách SKU Master");
      return res.json() as Promise<{
        items: SkuMasterItem[];
        total: number;
        page: number;
        limit: number;
      }>;
    },
    enabled: !!selectedStoreId && activeTab === "sku",
  });

  const allSkus = useMemo(() => skuQuery.data?.items ?? [], [skuQuery.data?.items]);
  const skuTotalCount = skuQuery.data?.total ?? 0;
  const skuTotal = skuTotalCount;
  const skuTotalPages = Math.max(1, Math.ceil(skuTotal / skuLimit));

  // Số SKU của bảng mã còn lại (FBA ↔ FBM) cho badge trên tab.
  const otherSkuChannel: SkuChannel = skuChannel === "fbm" ? "fba" : "fbm";
  const otherSkuCountQuery = useQuery({
    queryKey: ["sku-master-count", selectedStoreId, otherSkuChannel],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ store_id: selectedStoreId!, page: "1", limit: "1", channel: otherSkuChannel });
      const res = await fetch(`/api/accounting/inventory/sku-master?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải số lượng SKU");
      return ((await res.json()) as { total: number }).total;
    },
    enabled: !!selectedStoreId && storeHasFbm,
  });
  // Bảng chính chỉ tải khi mở tab → tab chưa mở lấy số cho badge từ request đếm nhẹ (limit=1).
  const currentSkuCountQuery = useQuery({
    queryKey: ["sku-master-count", selectedStoreId, skuChannel],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ store_id: selectedStoreId!, page: "1", limit: "1", channel: skuChannel });
      const res = await fetch(`/api/accounting/inventory/sku-master?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải số lượng SKU");
      return ((await res.json()) as { total: number }).total;
    },
    enabled: !!selectedStoreId && !skuQuery.data,
  });
  const skuBadgeCount = skuQuery.data?.total ?? currentSkuCountQuery.data ?? 0;
  const fbaSkuCount = skuChannel === "fba" ? skuBadgeCount : otherSkuCountQuery.data ?? 0;
  const fbmSkuCount = skuChannel === "fbm" ? skuBadgeCount : otherSkuCountQuery.data ?? 0;

  // 2. TanStack Query for Inbound Shipments (Server-side Page Pagination, 100/trang)
  const shipmentQuery = useQuery({
    queryKey: ["inbound-shipments", selectedStoreId, shipmentPage, shipmentLimit, debouncedShipmentSearch, shipmentStatusFilter, dateSort.inbound.field, dateSort.inbound.direction],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        store_id: selectedStoreId!,
        page: String(shipmentPage),
        limit: String(shipmentLimit),
      });
      if (debouncedShipmentSearch) params.set("search", debouncedShipmentSearch);
      if (shipmentStatusFilter) params.set("status", shipmentStatusFilter);
      params.set("sort_field", dateSort.inbound.field);
      params.set("sort_dir", dateSort.inbound.direction);

      const res = await fetch(`/api/accounting/inventory/inbound-shipments?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách Inbound Shipments");
      return res.json() as Promise<{
        items: InboundShipmentItem[];
        total: number;
        page: number;
        limit: number;
      }>;
    },
    enabled: !!selectedStoreId && activeTab === "inbound",
  });

  const allShipments = useMemo(() => shipmentQuery.data?.items ?? [], [shipmentQuery.data?.items]);
  const shipmentTotalCount = shipmentQuery.data?.total ?? 0;
  const shipmentTotal = shipmentTotalCount;
  const shipmentTotalPages = Math.max(1, Math.ceil(shipmentTotal / shipmentLimit));

  // 3. TanStack Query for Check Shipments (Server-side Page Pagination, 50/trang)
  const checkShipmentQuery = useQuery({
    queryKey: ["check-shipments", selectedStoreId, checkShipmentPage, checkShipmentLimit, debouncedCheckShipmentSearch, checkShipmentStatusFilter, checkShipmentBrandFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        store_id: selectedStoreId!,
        page: String(checkShipmentPage),
        limit: String(checkShipmentLimit),
      });
      if (debouncedCheckShipmentSearch) params.set("search", debouncedCheckShipmentSearch);
      if (checkShipmentStatusFilter) params.set("status", checkShipmentStatusFilter);
      if (checkShipmentBrandFilter) params.set("brand", checkShipmentBrandFilter);

      const res = await fetch(`/api/accounting/inventory/check-shipments?${params.toString()}`, { signal });
      if (!res.ok) throw new Error("Không thể tải danh sách Check Shipments");
      return res.json() as Promise<{
        items: CheckShipmentItem[];
        total: number;
        page: number;
        limit: number;
      }>;
    },
    enabled: !!selectedStoreId && activeTab === "check_shipment",
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
      return res.json() as Promise<{ settings: Array<{ entity_type: "sku" | "inbound" | "check_shipment"; field_id: string; label: string; input_type: "text" | "select"; options: string[]; allow_custom_value: boolean }> }>;
    },
    enabled: !!selectedStoreId,
  });

  const allCheckShipments = useMemo(() => checkShipmentQuery.data?.items ?? [], [checkShipmentQuery.data?.items]);
  const checkShipmentTotalCount = checkShipmentQuery.data?.total ?? 0;
  const checkShipmentTotal = checkShipmentTotalCount;
  const checkShipmentTotalPages = Math.max(1, Math.ceil(checkShipmentTotal / checkShipmentLimit));

  // Badge số dòng cho tab Đi Hàng / Check Shipment khi bảng chính chưa tải (tab chưa mở).
  const shipmentCountQuery = useQuery({
    queryKey: ["inbound-shipments-count", selectedStoreId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/inventory/inbound-shipments?store_id=${selectedStoreId}&page=1&limit=1`, { signal });
      if (!res.ok) throw new Error("Không thể tải số lượng lô hàng");
      return ((await res.json()) as { total: number }).total;
    },
    enabled: !!selectedStoreId && !shipmentQuery.data,
  });
  const checkShipmentCountQuery = useQuery({
    queryKey: ["check-shipments-count", selectedStoreId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/accounting/inventory/check-shipments?store_id=${selectedStoreId}&page=1&limit=1`, { signal });
      if (!res.ok) throw new Error("Không thể tải số lượng Check Shipment");
      return ((await res.json()) as { total: number }).total;
    },
    enabled: !!selectedStoreId && !checkShipmentQuery.data,
  });
  const shipmentBadgeCount = shipmentQuery.data?.total ?? shipmentCountQuery.data ?? 0;
  const checkShipmentBadgeCount = checkShipmentQuery.data?.total ?? checkShipmentCountQuery.data ?? 0;

  const fetchSkus = useCallback(() => {
    return skuQuery.refetch();
  }, [skuQuery]);

  const fetchShipments = useCallback(() => {
    return shipmentQuery.refetch();
  }, [shipmentQuery]);

  const fetchCheckShipments = useCallback(() => {
    return checkShipmentQuery.refetch();
  }, [checkShipmentQuery]);

  const loadingSkus = skuQuery.isLoading;
  const loadingShipments = shipmentQuery.isLoading;
  const loadingCheckShipments = checkShipmentQuery.isLoading;
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const notify = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Modals & Forms
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    type?: "sku" | "inbound" | "check_shipment" | "monthly_base_cost";
    count?: number;
    errors?: string[];
  } | null>(null);
  // Link Google Sheet lưu theo store (cấu hình ở System Admin): file INVENTORY cho Bảng Mã FBA + Chi tiết
  // đi hàng, file FBM cho Bảng Mã FBM. Nút tải lại của tab đồng bộ ngay đúng tab đó.
  const [syncingSheet, setSyncingSheet] = useState(false);
  const sheetLinksQuery = useSheetLinks(!!selectedStoreId);
  const currentSheetType: SheetType | null =
    activeTab === "sku"
      ? (skuChannel === "fbm" ? "sku_fbm" : "sku")
      : activeTab === "inbound"
      ? "inbound"
      : isFbmBaseCost
      ? "fbm_pw"
      : null;
  const linkTypeOfSheet = (type: SheetType): LinkType =>
    type === "sku_fbm" ? "fbm" : type === "fbm_pw" ? "fbm_accounting" : "inventory";
  const currentSheetLink = sheetLinksQuery.data?.links.find(
    (link) =>
      link.store_id === selectedStoreId &&
      currentSheetType != null &&
      link.link_type === linkTypeOfSheet(currentSheetType),
  );
  const [sheetUrl, setSheetUrl] = useState("");
  // Ô link Google Sheet trong modal Nhập: Bảng Mã FBM hoặc Kế Toán Tổng Hợp FBM (tab Basecost Tháng FBM)
  const importSheetLinkType: LinkType = isFbmBaseCost ? "fbm_accounting" : "fbm";

  const openImportModal = () => {
    setShowImportModal(true);
    setImportResult(null);
    setSheetUrl(
      sheetLinksQuery.data?.links.find((link) => link.store_id === selectedStoreId && link.link_type === importSheetLinkType)?.sheet_url ?? "",
    );
  };

  // SKU Edit / Add Modal
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [skuFormData, setSkuFormData] = useState(emptySkuForm);
  const [savingSku, setSavingSku] = useState(false);

  // Shipment Edit / Add Modal
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [shipmentFormData, setShipmentFormData] = useState(emptyShipmentForm);
  const [savingShipment, setSavingShipment] = useState(false);

  // Check Shipment Edit / Add Modal
  const [showCheckShipmentModal, setShowCheckShipmentModal] = useState(false);
  const [checkShipmentFormData, setCheckShipmentFormData] = useState(emptyCheckShipmentForm);
  const [savingCheckShipment, setSavingCheckShipment] = useState(false);
  const [duplicatingCheckShipmentId, setDuplicatingCheckShipmentId] = useState<string | null>(null);

  const [fieldEditor, setFieldEditor] = useState<{ entity_type: "sku" | "inbound" | "check_shipment"; field_id: string; label: string; input_type: "text" | "select"; options: string[]; allow_custom_value: boolean } | null>(null);
  const [newFieldOption, setNewFieldOption] = useState("");

  const scanOptionsFromRows = useCallback((tab: "sku" | "inbound" | "check_shipment", fieldId: string) => {
    const items = tab === "sku" ? allSkus : tab === "inbound" ? allShipments : allCheckShipments;
    const values = new Set<string>();
    for (const item of items) {
      const rawVal = (item as any)[fieldId] ?? (item as any)?.custom_fields?.[fieldId];
      if (rawVal != null) {
        const str = typeof rawVal === "string" ? rawVal.trim() : String(rawVal).trim();
        if (isValidComboboxOption(str)) values.add(str);
      }
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [allSkus, allShipments, allCheckShipments]);

  const handleQuickRenameColumn = useCallback((tab: "sku" | "inbound" | "check_shipment", colId: string, currentLabel: string) => {
    const saved = fieldSettingsQuery.data?.settings.find((item) => item.entity_type === tab && item.field_id === colId);
    setNewFieldOption("");
    const isCombo = isComboboxField(tab, colId);

    let initialOptions: string[] = [];
    if (saved && Array.isArray(saved.options) && saved.options.length > 0) {
      initialOptions = saved.options.filter(isValidComboboxOption);
    } else if (isCombo) {
      if (tab === "sku") {
        const scannedDb = (fieldOptionsQuery.data?.sku as Record<string, string[]> | undefined)?.[colId];
        const rowValues = scanOptionsFromRows(tab, colId);
        initialOptions = [...new Set([...(scannedDb || []), ...rowValues])].filter(isValidComboboxOption);
        if (colId === "product_type" && initialOptions.length === 0) {
          initialOptions = DEFAULT_PRODUCT_TYPES.filter(isValidComboboxOption);
        }
      } else if (tab === "inbound") {
        const scannedDb = (fieldOptionsQuery.data?.inbound as Record<string, string[]> | undefined)?.[colId];
        const rowValues = scanOptionsFromRows(tab, colId);
        initialOptions = [...new Set([...(scannedDb || []), ...rowValues])].filter(isValidComboboxOption);
      } else {
        const rowValues = scanOptionsFromRows(tab, colId);
        const defaults = colId === "status" ? DEFAULT_CHECK_SHIPMENT_STATUS : [];
        initialOptions = [...new Set([...defaults, ...rowValues])].filter(isValidComboboxOption);
      }
    } else {
      initialOptions = (saved?.options || []).filter(isValidComboboxOption);
    }

    setFieldEditor({
      entity_type: tab,
      field_id: colId,
      label: saved?.label || currentLabel,
      input_type: initialOptions.length > 0 ? "select" : "text",
      options: initialOptions,
      allow_custom_value: saved?.allow_custom_value ?? true,
    });
  }, [fieldSettingsQuery.data, fieldOptionsQuery.data, scanOptionsFromRows]);

  const saveFieldEditor = async () => {
    if (!fieldEditor || !selectedStoreId || !fieldEditor.label.trim()) return;
    const cleanedOptions = [...new Set(fieldEditor.options.map((o) => o.trim()).filter(isValidComboboxOption))];
    const payload = {
      ...fieldEditor,
      label: fieldEditor.label.trim(),
      input_type: (cleanedOptions.length > 0 ? "select" : "text") as "select" | "text",
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
    if (fieldEditor.entity_type === "sku") {
      setSkuColumns((prev) => prev.map((col) => col.id === fieldEditor.field_id ? { ...col, label: savedSetting.label } : col));
    } else if (fieldEditor.entity_type === "inbound") {
      setInboundColumns((prev) => prev.map((col) => col.id === fieldEditor.field_id ? { ...col, label: savedSetting.label } : col));
    } else {
      setCheckShipmentColumns((prev) => prev.map((col) => col.id === fieldEditor.field_id ? { ...col, label: savedSetting.label } : col));
    }
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

  // Dynamic table zoom (+/- scale controls) - Default 90% as requested by user
  const [tableZoom, setTableZoom] = useState<number>(90);

  // Inline cell editing
  const [inlineEditing, setInlineEditing] = useState<{
    table: "sku" | "inbound" | "check_shipment";
    id: string;
    field: string;
    value?: string;
  } | null>(null);
  const [inlineSaving, setInlineSaving] = useState(false);

  const startInlineEdit = useCallback(
    (table: "sku" | "inbound" | "check_shipment", id: string, field: string, currentValue?: unknown) => {
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
      tableArg?: "sku" | "inbound" | "check_shipment" | unknown,
      idArg?: string,
      fieldArg?: string,
      valueArg?: string
    ) => {
      if (!selectedStore) return;
      const table = (typeof tableArg === "string" ? tableArg : inlineEditing?.table) as "sku" | "inbound" | "check_shipment" | undefined;
      const id = idArg || inlineEditing?.id;
      const field = fieldArg || inlineEditing?.field;
      const rawValue = valueArg !== undefined ? valueArg : inlineEditing?.value;
      const cleanValue = isMonthField(field || "")
        ? cleanMonthOnly(rawValue)
        : isDateField(field || "")
        ? cleanDateOnly(rawValue)
        : (rawValue ?? "");

      if (!table || !id || !field) return;

      setInlineSaving(true);
      try {
        const url =
          table === "sku"
            ? "/api/accounting/inventory/sku-master"
            : table === "inbound"
            ? "/api/accounting/inventory/inbound-shipments"
            : "/api/accounting/inventory/check-shipments";

        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            store_id: selectedStore.id,
            field,
            value: cleanValue,
            ...(table === "sku" ? { channel: skuChannel } : {}),
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
          queryClient.setQueriesData({ queryKey: ["sku-master", selectedStoreId, skuChannel] }, updateCachedRows);
        } else if (table === "inbound") {
          queryClient.setQueriesData({ queryKey: ["inbound-shipments", selectedStoreId] }, updateCachedRows);
          if (field === "quantity" || field === "shipment_id" || field === "so_luong_amazon_nhan") {
            queryClient.invalidateQueries({ queryKey: ["inbound-shipments", selectedStoreId] });
          }
        } else {
          queryClient.setQueriesData({ queryKey: ["check-shipments", selectedStoreId] }, updateCachedRows);
        }

        notify("Đã lưu ô dữ liệu thành công!", "success");
        setInlineEditing(null);
      } catch (err) {
        notify((err as Error).message, "error");
      } finally {
        setInlineSaving(false);
      }
    },
    [selectedStore, selectedStoreId, inlineEditing, notify, queryClient, skuChannel]
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

  // Mặc định sắp xếp BẢNG MÃ theo ngày tạo mới nhất (dòng mới luôn ở trên đầu)
  const sortedSkus = useMemo(() => {
    return allSkus.filter((item) => Object.entries(columnFilters.sku).every(([field, value]) =>
      !value || String((item as any)[field] ?? item.custom_fields?.[field] ?? "").trim() === value,
    )).sort((a, b) => {
      const sort = dateSort.sku;
      if (sort.field === "created_at") {
        const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
        const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ca !== cb) return sort.direction === "desc" ? cb - ca : ca - cb;
      } else {
        const cmp = compareDatesDesc((a as any)[sort.field], (b as any)[sort.field]) * (sort.direction === "desc" ? 1 : -1);
        if (cmp !== 0) return cmp;
      }
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ca !== cb) return cb - ca;
      return (a.row_order ?? 999999) - (b.row_order ?? 999999);
    });
  }, [allSkus, dateSort.sku, columnFilters.sku]);

  // Thống kê tổng tồn và tổng giá trị tồn kho của các SKU hiển thị
  const skuInventorySummary = useMemo(() => {
    let totalTon = 0;
    let totalGiaTri = 0;
    for (const item of sortedSkus) {
      const ton = item.ton_kho != null ? Number(item.ton_kho) : 0;
      if (ton > 0) {
        totalTon += ton;
        const val = item.gia_tri_ton != null
          ? Number(item.gia_tri_ton)
          : (item.gia_trung_binh_nam != null && Number(item.gia_trung_binh_nam) > 0
              ? ton * Number(item.gia_trung_binh_nam)
              : (item.basecost_tb != null && Number(item.basecost_tb) > 0 ? ton * Number(item.basecost_tb) : 0));
        totalGiaTri += val;
      }
    }
    return { totalTon, totalGiaTri };
  }, [sortedSkus]);

  // Mặc định sắp xếp CHI TIẾT ĐI HÀNG theo ngày tạo mới nhất (dòng mới luôn ở trên đầu)
  const sortedShipments = useMemo(() => {
    return allShipments.filter((item) => Object.entries(columnFilters.inbound).every(([field, value]) =>
      !value || String((item as any)[field] ?? item.custom_fields?.[field] ?? "").trim() === value,
    )).sort((a, b) => {
      const sort = dateSort.inbound;
      if (sort.field === "created_at") {
        const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
        const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (ca !== cb) return sort.direction === "desc" ? cb - ca : ca - cb;
      } else {
        const cmp = compareDatesDesc((a as any)[sort.field], (b as any)[sort.field]) * (sort.direction === "desc" ? 1 : -1);
        if (cmp !== 0) return cmp;
      }
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return cb - ca;
    });
  }, [allShipments, dateSort.inbound, columnFilters.inbound]);

  // Mặc định sắp xếp CHECK SHIPMENT theo ngày update từ mới nhất
  const sortedCheckShipments = useMemo(() => {
    return allCheckShipments.filter((item) => Object.entries(columnFilters.check_shipment).every(([field, value]) =>
      !value || String((item as any)[field] ?? item.custom_fields?.[field] ?? "").trim() === value,
    )).sort((a, b) => {
      const sort = dateSort.check_shipment;
      const cmp = compareDatesDesc((a as any)[sort.field], (b as any)[sort.field]) * (sort.direction === "desc" ? 1 : -1);
      if (cmp !== 0) return cmp;
      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return cb - ca;
    });
  }, [allCheckShipments, dateSort.check_shipment, columnFilters.check_shipment]);

  const checkShipmentBrands = useMemo(() => {
    const set = new Set<string>();
    for (const item of allCheckShipments) {
      if (item.brand) set.add(item.brand);
    }
    return Array.from(set).sort();
  }, [allCheckShipments]);

  const skuScrollRef = useRef<HTMLDivElement>(null);
  const shipmentScrollRef = useRef<HTMLDivElement>(null);

  // Preload ảnh nền cho các SKU/Shipment trên trang hiện tại (trì hoãn 100ms sau khi render tab để không tranh chấp CPU)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === "sku" && sortedSkus.length > 0) {
        for (const item of sortedSkus) {
          if (item) {
            queuePreloadImage(item.mockup_url || item.mockup);
          }
        }
      } else if (activeTab === "inbound" && sortedShipments.length > 0) {
        for (const item of sortedShipments) {
          if (item) {
            queuePreloadImage(item.mockup);
          }
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeTab, sortedSkus, sortedShipments]);

  useEffect(() => {
    skuScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedStoreId, skuPage, debouncedSkuSearch, skuTypeFilter, columnFilters.sku]);

  useEffect(() => {
    shipmentScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedStoreId, shipmentPage, debouncedShipmentSearch, shipmentStatusFilter, columnFilters.inbound]);

  // Tính toán độ rộng vừa khít nội dung thực tế và tiêu đề cột cho tất cả các bảng
  const calculateAutoFitWidth = useCallback(
    (
      table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost",
      colId: string,
      label: string
    ): number => {
      // Cột hiển thị thuần UI không có chuỗi dữ liệu để đo.
      if (colId === "mockup") return 72;
      if (colId === "sparkline") return 110;

      // Quét toàn bộ dữ liệu đang nạp để cột luôn bao trọn giá trị dài nhất.
      const measureText = createTextWidthMeasurer();
      let maxContentWidth = 0;
      if (table === "sku") {
        for (const item of allSkus) {
          const val = (item as any)[colId] ?? (item.custom_fields as any)?.[colId];
          if (val != null) {
            let str = "";
            if (typeof val === "number" && (colId.includes("fee") || colId.includes("cost"))) {
              str = `$${val.toFixed(2)}`;
            } else {
              str = String(val).trim();
            }
            maxContentWidth = Math.max(maxContentWidth, measureText(str));
          }
        }
      } else if (table === "inbound") {
        for (const item of allShipments) {
          const val = (item as any)[colId] ?? (item.custom_fields as any)?.[colId];
          if (val != null) {
            let str = "";
            if (typeof val === "number" && (colId.includes("cost") || colId.includes("fee") || colId.includes("price"))) {
              str = `$${val.toFixed(2)}`;
            } else {
              str = String(val).trim();
            }
            maxContentWidth = Math.max(maxContentWidth, measureText(str));
          }
        }
      } else if (table === "check_shipment") {
        for (const item of allCheckShipments) {
          const val = (item as any)[colId] ?? (item.custom_fields as any)?.[colId];
          if (val != null) {
            const str = String(val).trim();
            maxContentWidth = Math.max(maxContentWidth, measureText(str));
          }
        }
      }

      const contentWidth = maxContentWidth > 0 ? Math.ceil(maxContentWidth + 30) : 0;

      // Chiều rộng tối thiểu để tiêu đề không bị cắt chữ quá nhỏ (ngắt theo dấu gạch ngang, khoảng trắng, gạch dưới)
      const labelWords = (label || colId).split(/[-_ \n/]+/).filter(Boolean);
      const longestWordLength = labelWords.length > 0 ? Math.max(...labelWords.map((w) => w.length)) : 5;
      const headerWidth = Math.round(longestWordLength * 8.2 + 24);

      const targetWidth = Math.max(contentWidth, headerWidth);

      return Math.max(52, targetWidth);
    },
    [allSkus, allShipments, allCheckShipments]
  );

  const handleAutoFitColumn = useCallback(
    (table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost", colId: string) => {
      if (table === "sku") {
        setSkuColumns((prev) => {
          const targetCol = prev.find((c) => c.id === colId);
          if (!targetCol) return prev;
          const snugWidth = calculateAutoFitWidth(table, colId, targetCol.label);
          const updated = prev.map((c) => (c.id === colId ? { ...c, width: snugWidth } : c));
          try {
            localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "inbound") {
        setInboundColumns((prev) => {
          const targetCol = prev.find((c) => c.id === colId);
          if (!targetCol) return prev;
          const snugWidth = calculateAutoFitWidth(table, colId, targetCol.label);
          const updated = prev.map((c) => (c.id === colId ? { ...c, width: snugWidth } : c));
          try {
            localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "check_shipment") {
        setCheckShipmentColumns((prev) => {
          const targetCol = prev.find((c) => c.id === colId);
          if (!targetCol) return prev;
          const snugWidth = calculateAutoFitWidth(table, colId, targetCol.label);
          const updated = prev.map((c) => (c.id === colId ? { ...c, width: snugWidth } : c));
          try {
            localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "monthly_base_cost") {
        setMonthlyBaseCostColumns((prev) => {
          const targetCol = prev.find((c) => c.id === colId);
          if (!targetCol) return prev;
          const snugWidth = calculateAutoFitWidth(table, colId, targetCol.label);
          const updated = prev.map((c) => (c.id === colId ? { ...c, width: snugWidth } : c));
          try {
            localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
      notify("Đã thu nhỏ cột!", "success");
    },
    [
      calculateAutoFitWidth,
      SKU_COLUMNS_STORAGE_KEY,
      INBOUND_COLUMNS_STORAGE_KEY,
      CHECK_SHIPMENT_COLUMNS_STORAGE_KEY,
      MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY,
      notify,
    ]
  );

  const handleAutoFitAllColumns = useCallback(
    (table: "sku" | "inbound" | "check_shipment" | "monthly_base_cost") => {
      if (table === "sku") {
        setSkuColumns((prev) => {
          const updated = prev.map((c) => ({
            ...c,
            width: calculateAutoFitWidth("sku", c.id, c.label),
          }));
          try {
            localStorage.setItem(SKU_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "inbound") {
        setInboundColumns((prev) => {
          const updated = prev.map((c) => ({
            ...c,
            width: calculateAutoFitWidth("inbound", c.id, c.label),
          }));
          try {
            localStorage.setItem(INBOUND_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "check_shipment") {
        setCheckShipmentColumns((prev) => {
          const updated = prev.map((c) => ({
            ...c,
            width: calculateAutoFitWidth("check_shipment", c.id, c.label),
          }));
          try {
            localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      } else if (table === "monthly_base_cost") {
        setMonthlyBaseCostColumns((prev) => {
          const updated = prev.map((c) => ({
            ...c,
            width: calculateAutoFitWidth("monthly_base_cost", c.id, c.label),
          }));
          try {
            localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
      notify("Đã thu nhỏ tất cả các cột!", "success");
    },
    [
      calculateAutoFitWidth,
      SKU_COLUMNS_STORAGE_KEY,
      INBOUND_COLUMNS_STORAGE_KEY,
      CHECK_SHIPMENT_COLUMNS_STORAGE_KEY,
      MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY,
      notify,
    ]
  );

  // 1. Fetch Stores list
  const fetchStores = useCallback(async () => {
    try {
      setLoadingStores(true);
      const res = await fetch("/api/accounting/stores");
      if (!res.ok) throw new Error("Không thể tải danh sách Store");
      const data = (await res.json()) as { stores: Store[] };
      const list = data.stores || [];
      setStores(list);

      // Prioritize saved store from localStorage to sync with other accounting functions
      const savedStore = typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") : null;
      if (savedStore && list.some((s) => s.id === savedStore)) {
        setSelectedStoreId((curr) => curr || savedStore);
      } else if (list.length > 0) {
        if (!selectedStoreId || !list.some((s) => s.id === selectedStoreId)) {
          const limima = list.find((s) => s.name.toLowerCase() === "limima");
          const defaultId = limima ? limima.id : list[0].id;
          setSelectedStoreId(defaultId);
          if (typeof window !== "undefined") {
            localStorage.setItem("acc_selected_store_id", defaultId);
          }
        }
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

  // Handle Store Switch (Isolates data immediately, updates global selection)
  const handleStoreSelect = (storeId: string) => {
    setSelectedStoreId(storeId);
    if (typeof window !== "undefined") {
      localStorage.setItem("acc_selected_store_id", storeId);
      window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: storeId }));
    }
  };

  // Listen to store changes from other tabs or components
  useEffect(() => {
    const handleSyncStore = (e: any) => {
      const newStoreId = e.detail || (typeof window !== "undefined" ? localStorage.getItem("acc_selected_store_id") : null);
      if (newStoreId && newStoreId !== selectedStoreId) {
        setSelectedStoreId(newStoreId);
      }
    };
    window.addEventListener("acc_store_changed", handleSyncStore);
    window.addEventListener("storage", handleSyncStore);
    return () => {
      window.removeEventListener("acc_store_changed", handleSyncStore);
      window.removeEventListener("storage", handleSyncStore);
    };
  }, [selectedStoreId]);

  useEffect(() => {
    const handleImportCompleted = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type !== "success") return;
      fetchSkus();
      fetchShipments();
      fetchCheckShipments();
      monthlyBaseCostRef.current?.reload();
    };
    window.addEventListener("accounting-import-completed", handleImportCompleted);
    return () => window.removeEventListener("accounting-import-completed", handleImportCompleted);
  }, [fetchSkus, fetchShipments, fetchCheckShipments]);

  const [syncingLatestFiles, setSyncingLatestFiles] = useState(false);

  // Reload tab: Khi ấn làm mới ở bảng Check Shipment, tự động nạp file mới nhất cho tất cả các store từ Cloudflare R2 / lưu trữ rồi refetch
  const refreshAfterSheetSync = useCallback((type: SheetType) => {
    queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
    queryClient.invalidateQueries({ queryKey: ["sku-master-count", selectedStoreId] });
    if (type === "fbm_pw") queryClient.invalidateQueries({ queryKey: ["fbm-pw-costs", selectedStoreId] });
    else if (type === "inbound") fetchShipments();
    else fetchSkus();
  }, [queryClient, selectedStoreId, fetchShipments, fetchSkus]);

  const handleReloadTab = useCallback(async () => {
    if (activeTab === "check_shipment") {
      try {
        setSyncingLatestFiles(true);
        const res = await fetch("/api/accounting/files/sync-latest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "07_SHIPMENTS" }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          notify(data.message || "Đã nạp file Check Shipment mới nhất cho các Store!", "success");
        }
      } catch (err: any) {
        console.warn("Lỗi nạp file shipment mới nhất:", err);
      } finally {
        setSyncingLatestFiles(false);
        fetchCheckShipments();
      }
    } else if ((activeTab === "sku" || activeTab === "inbound" || isFbmBaseCost) && currentSheetType && currentSheetLink && selectedStoreId) {
      // Tab có link Google Sheet: đồng bộ ngay đúng store + sheet đang mở rồi tải lại bảng
      setSyncingSheet(true);
      let outcome = await requestSheetSync("sync", { store_id: selectedStoreId, sheet_type: currentSheetType, trigger: "reload" });
      // Bị chặn vì sheet thiếu nhiều dòng: hỏi xác nhận rồi đọc lại, bỏ qua giới hạn an toàn
      if (outcome.parts[currentSheetType]?.blocked && confirmForceSync(outcome.parts[currentSheetType]?.error)) {
        outcome = await requestSheetSync("sync", { store_id: selectedStoreId, sheet_type: currentSheetType, trigger: "reload", force: true });
      }
      setSyncingSheet(false);
      queryClient.invalidateQueries({ queryKey: SHEET_LINKS_QUERY_KEY });
      const part = outcome.parts[currentSheetType];
      if (outcome.ok && part?.result) {
        const warn = part.result.warnings.length ? ` (${part.result.warnings.join(" ")})` : "";
        notify(`Đã đồng bộ từ Google Sheet: ${describeSyncResult(part.result)}${warn}`, "success");
      } else {
        notify(`Đồng bộ Google Sheet lỗi: ${part?.error ?? outcome.error}`, "error");
      }
      refreshAfterSheetSync(currentSheetType);
    } else if (activeTab === "sku") {
      fetchSkus();
    } else if (activeTab === "inbound") {
      fetchShipments();
    } else if (isFbmBaseCost) {
      fbmPwCostRef.current?.reload();
    } else {
      fetchCheckShipments();
    }
  }, [activeTab, isFbmBaseCost, fetchCheckShipments, fetchSkus, fetchShipments, currentSheetType, currentSheetLink, selectedStoreId, queryClient, notify, refreshAfterSheetSync]);


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

  const checkShipmentOptions = useMemo(() => {
    const brandOpts = Array.from(new Set(allCheckShipments.map((i) => i.brand).filter(Boolean) as string[])).sort();
    const shipToOpts = Array.from(new Set(allCheckShipments.map((i) => i.ship_to).filter(Boolean) as string[])).sort();
    return {
      brand: brandOpts.length > 0 ? brandOpts : (selectedStore ? [selectedStore.name] : []),
      ship_to: shipToOpts,
      status: DEFAULT_CHECK_SHIPMENT_STATUS,
    };
  }, [allCheckShipments, selectedStore]);

  const getColumnOptions = useCallback(
    (table: "sku" | "inbound" | "check_shipment", fieldId: string): string[] => {
      const setting = fieldSettingsQuery.data?.settings.find(
        (s) => s.entity_type === table && s.field_id === fieldId
      );
      // 1. Cột có cấu hình giá trị lựa chọn riêng trong "Cấu hình cột"
      if (setting && Array.isArray(setting.options) && setting.options.length > 0) {
        return setting.options.filter(isValidComboboxOption);
      }
      // 2. Cột có cấu hình nhưng không có giá trị lựa chọn (0 giá trị) hoặc là loại text thường => Tuyệt đối không tạo combobox
      if (setting && (setting.input_type === "text" || (Array.isArray(setting.options) && setting.options.length === 0))) {
        return [];
      }
      // 3. Nếu không thuộc danh sách cột combobox mặc định (như shipment_name, shipment_id, sku, note...) => Không tạo combobox
      if (!isComboboxField(table, fieldId)) {
        return [];
      }
      // 4. Cột combobox mặc định (status, product_type, sup, line_ship, trang_thai, brand, ship_to)
      const opts = table === "sku" ? skuOptions[fieldId] : table === "inbound" ? inboundOptions[fieldId] : (checkShipmentOptions as any)[fieldId];
      if (opts && opts.length > 0) {
        return opts.filter(isValidComboboxOption);
      }
      return [];
    },
    [fieldSettingsQuery.data, skuOptions, inboundOptions, checkShipmentOptions]
  );

  useEffect(() => {
    const settings = fieldSettingsQuery.data?.settings;
    if (!settings) return;
    const applyLabels = (columns: ColumnConfig[], type: "sku" | "inbound" | "check_shipment") => columns.map((column) => {
      const setting = settings.find((item) => item.entity_type === type && item.field_id === column.id);
      return setting ? { ...column, label: setting.label } : column;
    });
    setSkuColumns((current) => applyLabels(current, "sku"));
    setInboundColumns((current) => applyLabels(current, "inbound"));
    setCheckShipmentColumns((current) => applyLabels(current, "check_shipment"));
  }, [fieldSettingsQuery.data]);

  // History Drawer state
  const [historyDrawer, setHistoryDrawer] = useState<{
    isOpen: boolean;
    entityType?: "sku" | "sku_fbm" | "inbound" | "check_shipment" | "monthly_base_cost";
    entityId?: string;
    entityTitle?: string;
  }>({ isOpen: false });

  // 30s Undo state for deleted items
  const [undoDelete, setUndoDelete] = useState<{
    entityType: "sku" | "sku_fbm" | "inbound" | "check_shipment";
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
      if (restoredType === "sku" || restoredType === "sku_fbm") {
        fetchSkus();
      } else if (restoredType === "inbound") {
        fetchShipments();
      } else {
        fetchCheckShipments();
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
        `/api/accounting/inventory/sku-master?id=${id}&store_id=${selectedStoreId}&channel=${skuChannel}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa SKU");
      setUndoDelete({
        entityType: skuEntityType,
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

  // Delete Check Shipment (Soft-delete with 30s Undo)
  const handleDeleteCheckShipment = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc muốn xóa shipment check ${name}?`)) return;
    try {
      const res = await fetch(
        `/api/accounting/inventory/check-shipments?id=${id}&store_id=${selectedStoreId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Không thể xóa shipment");
      setUndoDelete({
        entityType: "check_shipment",
        entityId: id,
        label: name,
        secondsLeft: 30,
      });
      notify(`Đã chuyển shipment ${name} vào thùng rác (Có thể hoàn tác trong 30s)`);
      fetchCheckShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  // Open Form to Add New Check Shipment
  const handleOpenAddCheckShipment = () => {
    const curStore = stores.find((s) => s.id === selectedStoreId);
    setCheckShipmentFormData({
      ...emptyCheckShipmentForm,
      brand: curStore ? curStore.name : "",
      ngay_update: new Date().toISOString().split("T")[0],
    });
    setShowCheckShipmentModal(true);
  };

  // Open Form to Edit Existing Check Shipment
  const handleOpenEditCheckShipment = (item: CheckShipmentItem) => {
    setCheckShipmentFormData({
      id: item.id,
      ngay_update: cleanDateOnly(item.ngay_update) || "",
      brand: item.brand || "",
      shipment_name: item.shipment_name || "",
      shipment_id: item.shipment_id || "",
      created_date: cleanDateOnly(item.created_date) || "",
      last_updated_date: cleanDateOnly(item.last_updated_date) || "",
      ship_to: item.ship_to || "",
      skus_count: item.skus_count != null ? String(item.skus_count) : "",
      units_expected: item.units_expected != null ? String(item.units_expected) : "",
      units_located: item.units_located != null ? String(item.units_located) : "",
      discrepancy: item.discrepancy != null ? String(item.discrepancy) : "",
      status: item.status || "Closed",
    });
    setShowCheckShipmentModal(true);
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
      thang_listing: cleanMonthOnly(item.thang_listing) || "",
      thang_danh_gia: cleanMonthOnly(item.thang_danh_gia) || "",
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
        channel: skuChannel,
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
        thang_listing: cleanMonthOnly(item.thang_listing) || null,
        thang_danh_gia: cleanMonthOnly(item.thang_danh_gia) || null,
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

      // Cập nhật tức thời vào cache query
      queryClient.setQueryData(
        ["sku-master", selectedStoreId, skuChannel, skuPage, skuLimit, debouncedSkuSearch, skuStatusFilter, skuTypeFilter],
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            items: [data.item, ...oldData.items.filter((i: any) => i.id !== data.item.id)],
            total: (oldData.total || 0) + 1,
          };
        }
      );

      setSkuPage(1);
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
        channel: skuChannel,
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
        thang_listing: cleanMonthOnly(skuFormData.thang_listing) || null,
        thang_danh_gia: cleanMonthOnly(skuFormData.thang_danh_gia) || null,
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

      if (!skuFormData.id) {
        setSkuPage(1);
      }
      notify(skuFormData.id ? "Đã cập nhật phôi SKU thành công!" : "Đã tạo phôi SKU mới thành công!");
      setShowSkuModal(false);
      queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
      await fetchSkus();
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
      const parseNum = (v: string | number | undefined | null) => {
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
        return isNaN(n) ? null : n;
      };
      const parseIntNum = (v: string | number | undefined | null) => {
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v).replace(/,/g, ""), 10);
        return isNaN(n) ? null : n;
      };

      const payload = {
        ...(shipmentFormData.id ? { id: shipmentFormData.id } : {}),
        store_id: selectedStoreId,
        sku: shipmentFormData.sku.trim(),
        brand: shipmentFormData.brand.trim() || null,
        sup: shipmentFormData.sup.trim() || null,
        ngay_request: cleanDateOnly(shipmentFormData.ngay_request) || null,
        product_type: shipmentFormData.product_type.trim() || null,
        mockup: shipmentFormData.mockup.trim() || null,
        quantity: parseIntNum(shipmentFormData.quantity) ?? 0,
        line_ship: shipmentFormData.line_ship.trim() || null,
        base_cost_per_unit: parseNum(shipmentFormData.base_cost_per_unit),
        card: parseNum(shipmentFormData.card),
        tag: parseNum(shipmentFormData.tag),
        shipping_fee: parseNum(shipmentFormData.shipping_fee),
        hop_tui: parseNum(shipmentFormData.hop_tui),
        final_basecost: parseNum(shipmentFormData.final_basecost),
        total_basecost: parseNum(shipmentFormData.total_basecost),
        ngay_thanh_toan: cleanDateOnly(shipmentFormData.ngay_thanh_toan) || null,
        ten_lo_hang: shipmentFormData.ten_lo_hang.trim() || null,
        shipment_id: shipmentFormData.shipment_id.trim() || null,
        ngay_di: cleanDateOnly(shipmentFormData.ngay_di) || null,
        ngay_den: cleanDateOnly(shipmentFormData.ngay_den) || null,
        amazon_received: parseIntNum(shipmentFormData.amazon_received),
        tinh_trang_hang_den_kho: shipmentFormData.tinh_trang_hang_den_kho.trim() || null,
        status: shipmentFormData.status.trim() || "In Transit",
        so_luong_amazon_nhan: parseIntNum(shipmentFormData.so_luong_amazon_nhan),
        discrepancy: parseIntNum(shipmentFormData.discrepancy),
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

      if (!shipmentFormData.id) {
        setShipmentPage(1);
      }
      notify(shipmentFormData.id ? "Đã cập nhật lô hàng thành công!" : "Đã tạo lô hàng mới thành công!");
      setShowShipmentModal(false);
      queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
      await fetchShipments();
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

  // Submit Check Shipment Form (Add or Edit)
  const handleSaveCheckShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkShipmentFormData.shipment_id.trim() && !checkShipmentFormData.shipment_name.trim()) {
      notify("Vui lòng điền Shipment ID hoặc Tên Shipment!", "error");
      return;
    }
    if (!selectedStoreId) return;

    try {
      setSavingCheckShipment(true);
      const parseIntNum = (v: string | number | undefined | null) => {
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? Math.floor(v) : parseInt(String(v).replace(/,/g, ""), 10);
        return isNaN(n) ? null : n;
      };

      const payload = {
        ...(checkShipmentFormData.id ? { id: checkShipmentFormData.id } : {}),
        store_id: selectedStoreId,
        ngay_update: cleanDateOnly(checkShipmentFormData.ngay_update) || null,
        brand: checkShipmentFormData.brand.trim() || null,
        shipment_name: checkShipmentFormData.shipment_name.trim() || null,
        shipment_id: checkShipmentFormData.shipment_id.trim() || null,
        created_date: cleanDateOnly(checkShipmentFormData.created_date) || null,
        last_updated_date: cleanDateOnly(checkShipmentFormData.last_updated_date) || null,
        ship_to: checkShipmentFormData.ship_to.trim() || null,
        skus_count: parseIntNum(checkShipmentFormData.skus_count),
        units_expected: parseIntNum(checkShipmentFormData.units_expected),
        units_located: parseIntNum(checkShipmentFormData.units_located),
        discrepancy: parseIntNum(checkShipmentFormData.discrepancy),
        status: checkShipmentFormData.status.trim() || "Closed",
      };

      const res = await fetch("/api/accounting/inventory/check-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Lỗi khi lưu check shipment");
      }

      notify(checkShipmentFormData.id ? "Đã cập nhật shipment thành công!" : "Đã tạo shipment mới thành công!");
      setShowCheckShipmentModal(false);
      fetchCheckShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSavingCheckShipment(false);
    }
  };

  // Duplicate Check Shipment
  const handleDuplicateCheckShipment = async (item: CheckShipmentItem) => {
    if (!selectedStoreId) return;
    try {
      setDuplicatingCheckShipmentId(item.id);
      const payload = {
        store_id: selectedStoreId,
        ngay_update: item.ngay_update || null,
        brand: item.brand || null,
        shipment_name: item.shipment_name ? `${item.shipment_name} (Copy)` : null,
        shipment_id: item.shipment_id ? `${item.shipment_id}-COPY` : null,
        created_date: item.created_date || null,
        last_updated_date: item.last_updated_date || null,
        ship_to: item.ship_to || null,
        skus_count: item.skus_count != null ? Number(item.skus_count) : null,
        units_expected: item.units_expected != null ? Number(item.units_expected) : null,
        units_located: item.units_located != null ? Number(item.units_located) : null,
        discrepancy: item.discrepancy != null ? Number(item.discrepancy) : null,
        status: item.status || "Closed",
        custom_fields: item.custom_fields || null,
      };

      const res = await fetch("/api/accounting/inventory/check-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể nhân bản shipment");

      setCheckShipmentPage(1);
      queryClient.setQueryData(
        ["check-shipments", selectedStoreId, 1, checkShipmentLimit, debouncedCheckShipmentSearch, checkShipmentStatusFilter, checkShipmentBrandFilter],
        (oldData: any) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            items: [data.item, ...oldData.items.filter((i: any) => i.id !== data.item.id)],
            total: (oldData.total || 0) + 1,
          };
        }
      );
      await fetchCheckShipments();
      notify("Đã nhân bản check shipment lên dòng đầu tiên!", "success");

      if (data.item?.id) {
        setTimeout(() => {
          startInlineEdit("check_shipment", data.item.id, "shipment_name", data.item.shipment_name);
        }, 120);
      }
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setDuplicatingCheckShipmentId(null);
    }
  };

  // Sync Check Shipments to Inbound
  const [syncingShipments, setSyncingShipments] = useState(false);

  const handleSyncCheckShipmentsToInbound = async () => {
    if (!selectedStoreId || syncingShipments) return;
    try {
      setSyncingShipments(true);
      const res = await fetch("/api/accounting/inventory/check-shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", store_id: selectedStoreId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi khi đồng bộ shipment");
      notify(
        `Đã đồng bộ thành công! Cập nhật ${data.updated_count || 0} dòng trong Chi Tiết Đi Hàng.`,
        "success",
      );
      fetchShipments();
      fetchCheckShipments();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setSyncingShipments(false);
    }
  };

  // Import Action (Hỗ trợ nạp 1 file quét tất cả 4 sheet chạy ẩn ở nền hoặc file CSV)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !selectedStoreId) return;

    const files = Array.from(fileList);
    try {
      setImporting(true);
      setImportResult(null);

      for (const file of files) {
        const isExcel = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
        if (isExcel && isFbmSheet) {
          // BẢNG MÃ FBM import riêng: chỉ đọc sheet bảng mã của file, không qua luồng quét 4 sheet.
          const formData = new FormData();
          formData.append("store_id", selectedStoreId);
          formData.append("type", "sku");
          formData.append("channel", "fbm");
          formData.append("file", file);

          const res = await fetch("/api/accounting/inventory/import", {
            method: "POST",
            body: formData,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Lỗi khi import Bảng Mã FBM");
          setImportResult({ success: true, count: data.count || 0, errors: data.errors || [] });
          notify(`Đã import ${data.count || 0} SKU vào Bảng Mã FBM!`, "success");
          queryClient.invalidateQueries({ queryKey: ["inventory-field-options", selectedStoreId] });
          fetchSkus();
        } else if (isExcel) {
          const formData = new FormData();
          formData.append("store_id", selectedStoreId);
          formData.append("file", file);

          const res = await fetch("/api/accounting/unified-import", {
            method: "POST",
            body: formData,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Tải lên thất bại");

          if (data.job?.id) {
            const trackedJob = { id: data.job.id, fileName: file.name };
            localStorage.setItem("accounting_import_active_job", JSON.stringify(trackedJob));
            window.dispatchEvent(new CustomEvent("accounting-import-queued", { detail: trackedJob }));
            setShowImportModal(false);
            notify(`Đã bắt đầu nạp ngầm file ${file.name}. Hệ thống đang quét các sheet và phân bổ dữ liệu ở chế độ nền.`, "success");
            return;
          }
        } else {
          // CSV file fallback (ví dụ check shipment CSV)
          const formData = new FormData();
          formData.append("store_id", selectedStoreId);
          formData.append("type", activeTab);
          formData.append("file", file);

          const res = await fetch("/api/accounting/inventory/import", {
            method: "POST",
            body: formData,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Lỗi khi import file CSV");
          notify(data.message || `Đã import thành công file CSV!`, "success");
          if (activeTab === "check_shipment") {
            fetchCheckShipments();
            fetchShipments();
          }
        }
      }
    } catch (err: any) {
      setImportResult({
        success: false,
        count: 0,
        errors: [(err as Error).message],
      });
      notify((err as Error).message || "Lỗi khi nạp file", "error");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleImportFromSheet = async () => {
    const url = sheetUrl.trim();
    if (!selectedStoreId || !url || importing) return;
    setImporting(true);
    setImportResult(null);
    const part: SheetType = importSheetLinkType === "fbm_accounting" ? "fbm_pw" : "sku_fbm";
    const outcome = await requestSheetSync("save", { store_id: selectedStoreId, link_type: importSheetLinkType, sheet_url: url });
    const result = outcome.parts[part]?.result;
    setImporting(false);
    queryClient.invalidateQueries({ queryKey: SHEET_LINKS_QUERY_KEY });
    if (outcome.ok && result) {
      setImportResult({ success: true, count: result.sheetRows, errors: result.warnings });
      notify(`Đã đồng bộ từ tab "${result.tabTitle}": ${describeLinkOutcome(outcome)}`, "success");
      refreshAfterSheetSync(part);
    } else {
      const message = outcome.error ?? "Lỗi không xác định.";
      setImportResult({ success: false, count: 0, errors: [message] });
      notify(message, "error");
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

  const handleReorderCheckShipmentColumns = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setCheckShipmentColumns((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === fromId);
      const toIndex = prev.findIndex((c) => c.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      if (prev[fromIndex].isFrozen || prev[toIndex].isFrozen) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      try {
        localStorage.setItem(CHECK_SHIPMENT_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    notify("Đã thay đổi vị trí cột!", "success");
  }, [CHECK_SHIPMENT_COLUMNS_STORAGE_KEY]);

  const handleReorderMonthlyBaseCostColumns = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setMonthlyBaseCostColumns((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === fromId);
      const toIndex = prev.findIndex((c) => c.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      if (prev[fromIndex].isFrozen || prev[toIndex].isFrozen) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      try {
        localStorage.setItem(MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    notify("Đã thay đổi vị trí cột!", "success");
  }, [MONTHLY_BASE_COST_COLUMNS_STORAGE_KEY]);

  // Dynamic Scrollable Column Header & Cell Renderers (Follows user-customized order)
  const renderSkuHeader = useCallback((col: ColumnConfig) => {
    const isCustom = col.isCustom;
    const isFee = col.id === "amazon_fee";
    const isPercent = col.id === "referral_fee_pct";
    const isRight = ["amazon_fba_fee_thay_doi", "basecost_tb", "basecost", "shipping_fee", "add_shipping_fee", "total_cost", "ton_kho", "gia_tri_ton"].includes(col.id);
    const isCenter = isFee || isPercent;

    let alignClass = "";
    if (isCenter) alignClass = "text-center";
    else if (isRight) alignClass = "text-right";

    const isDragging = headerDragId === col.id;
    const isDragOver = headerDragOverId === col.id;
    const isDate = isDateField(col.id);
    const sortDirection = dateSort.sku.field === col.id ? dateSort.sku.direction : null;
    const options = isDate ? [] : getColumnOptions("sku", col.id);
    const f = getCellFreezeProps(skuFreezeMap, col.id, true);

    return (
      <ColumnHeaderCell
        key={col.id}
        col={col}
        style={f.style}
        isFrozen={f.isFrozen}
        isBoundary={f.isBoundary}
        draggable={!col.isFrozen && !f.isFrozen}
        isDragging={isDragging}
        isDragOver={isDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", col.id);
          e.dataTransfer.effectAllowed = "move";
          setHeaderDragId(col.id);
        }}
        onDragOver={(e) => {
          if (!headerDragId || headerDragId === col.id || col.isFrozen || f.isFrozen) return;
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
          if (col.isFrozen || f.isFrozen) return;
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
        className={`py-2 px-3 text-xs ${col.id === "ton_kho" ? "bg-[#ffff00]" : col.id === "gia_tri_ton" ? "bg-[#dcfce7] text-emerald-950" : "bg-[#ff9900]"} text-slate-900 font-bold border-r border-amber-600/60 leading-tight ${alignClass} ${f.className}`}
        onResize={(id, width) => resizeColumn("sku", id, width)}
        onAutoFit={(id) => handleAutoFitColumn("sku", id)}
        onColumnClick={(id, event) => setColumnContextMenu({ table: "sku", field: id, x: event.clientX, y: event.clientY })}
      >
        <div className={`w-full ${isCenter ? "flex flex-col items-center justify-center text-center" : isRight ? "flex flex-col items-end" : ""}`}>
          <div className="flex items-center gap-1 w-full min-w-0 justify-center">
            {isDate ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleDateSort("sku", col.id); }}
                className="inline-flex items-center gap-0.5 hover:underline cursor-pointer max-w-full justify-center"
                title={sortDirection === "desc" ? "Đang mới nhất trước — bấm để đổi sang cũ nhất" : "Đang cũ nhất trước — bấm để đổi sang mới nhất"}
              >
                <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center">{col.label}</span>
                {sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" className="shrink-0" /> : <CaretDownIcon size={12} weight="bold" className="shrink-0" />}
              </button>
            ) : (
              <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center max-w-full" title={col.label}>
                {col.label}
              </span>
            )}
            {columnFilters.sku[col.id] && (
              <span
                className="h-2 w-2 rounded-full bg-slate-900 shrink-0 ring-1 ring-white"
                title={`Đang lọc: ${columnFilters.sku[col.id]}`}
              />
            )}
            {isCustom && (
              <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-900 font-bold shrink-0">
                Custom
              </span>
            )}
          </div>
          {col.id === "amazon_fee" && (
            <div className="text-[10px] font-bold opacity-90 line-clamp-2 break-words whitespace-normal leading-tight max-w-full" title="chưa có referal fee">(chưa có referal fee)</div>
          )}
        </div>
      </ColumnHeaderCell>
    );
  }, [skuFreezeMap, getCellFreezeProps, headerDragId, headerDragOverId, handleReorderSkuColumns, resizeColumn, handleAutoFitColumn, dateSort.sku, toggleDateSort, getColumnOptions, columnFilters.sku, setColumnFilter, openColumnFilter]);

  const renderSkuCell = useCallback((col: ColumnConfig, item: SkuMasterItem) => {
    const cid = col.id;
    const f = getCellFreezeProps(skuFreezeMap, cid, false);

    if (col.isCustom) {
      return (
        <EditableCell
          key={col.id}
          table="sku"
          id={item.id}
          field={col.id}
          value={item.custom_fields?.[col.id] ?? ""}
          display={safeDisplay(item.custom_fields?.[col.id])}
          style={f.style}
          className={`py-1 px-2.5 text-[12.5px] ${f.className || "border-r border-slate-200"}`}
          inlineEditing={inlineEditing}
          inlineSaving={inlineSaving}
          onStartEdit={startInlineEdit}
          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
          onSave={handleSaveInlineCell}
          onCancel={() => setInlineEditing(null)}
          options={getColumnOptions("sku", col.id)}
        />
      );
    }

    if (cid === "mockup_url") {
      return (
        <td key={col.id} style={f.style} className={`py-1 px-2.5 text-[12.5px] overflow-hidden ${f.className || "border-r border-slate-200"}`}>
          <div className="truncate w-full min-w-0">
            {item.mockup_url ? (
              <a
                href={item.mockup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition"
              >
                <ArrowSquareOutIcon size={14} weight="bold" />
                <span>Mở link</span>
              </a>
            ) : (
              "—"
            )}
          </div>
        </td>
      );
    }

    if (cid === "total_cost") {
      // Total = Basecost + Shipping fee + Add shipping fee (DB tự tính, không sửa trực tiếp)
      return (
        <td key={col.id} style={f.style} className={`py-1.5 px-2.5 text-[13px] text-right tabular-nums text-slate-900 ${f.className || "border-r border-slate-200"}`}>
          {item.total_cost != null ? `$${item.total_cost.toFixed(2)}` : "—"}
        </td>
      );
    }

    if (cid === "ton_kho") {
      // Tồn = In Transit Between Warehouses + Ending Warehouse Balance, lấy từ Inventory Ledger (không sửa tay)
      return (
        <td
          key={col.id}
          style={f.style}
          className={`py-1.5 px-2.5 text-[13px] text-right font-bold tabular-nums text-slate-900 ${f.className || "border-r border-slate-200 bg-[#fff9c4]"}`}
          title={
            item.ton_kho != null
              ? `In Transit ${item.in_transit_between_warehouses ?? 0} + Ending ${item.ending_warehouse_balance ?? 0}${
                  item.ton_kho_updated_at ? ` · cập nhật ${formatDate(item.ton_kho_updated_at)}` : ""
                }`
              : "Chưa có dữ liệu Inventory Ledger"
          }
        >
          {item.ton_kho != null ? item.ton_kho.toLocaleString("en-US") : "—"}
        </td>
      );
    }

    if (cid === "gia_tri_ton") {
      // Giá trị tồn = Giá trung bình năm * Số lượng tồn (lấy từ Chi Tiết Đi Hàng: giá trị hàng nhập / số lượng * tồn)
      const giaTbNam = item.gia_trung_binh_nam != null && Number(item.gia_trung_binh_nam) > 0
        ? Number(item.gia_trung_binh_nam)
        : (item.basecost_tb != null && Number(item.basecost_tb) > 0 ? Number(item.basecost_tb) : null);
      const tonKho = item.ton_kho != null ? Number(item.ton_kho) : null;
      const effectiveTon = tonKho != null ? Math.max(0, tonKho) : 0;
      const giaTriTon = item.gia_tri_ton != null
        ? Number(item.gia_tri_ton)
        : (giaTbNam != null && tonKho != null ? effectiveTon * giaTbNam : null);

      return (
        <td
          key={col.id}
          style={f.style}
          className={`py-1.5 px-2.5 text-[13px] text-right font-bold tabular-nums text-emerald-800 ${f.className || "border-r border-slate-200 bg-[#f0fdf4]"}`}
          title={
            giaTriTon != null && giaTbNam != null
              ? `Giá trị tồn = Giá TB năm ($${giaTbNam.toFixed(2)}) × Tồn (${tonKho != null ? tonKho.toLocaleString("en-US") : 0})${
                  item.inbound_qty ? ` · Nhập trong năm: ${item.inbound_qty.toLocaleString("en-US")} pcs ($${(item.inbound_cost ?? 0).toFixed(2)})` : ""
                } = $${giaTriTon.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "Chưa có dữ liệu giá hàng nhập trong năm hoặc Basecost TB"
          }
        >
          {giaTriTon != null
            ? `$${giaTriTon.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "—"}
        </td>
      );
    }

    if (cid === "landing_page_url") {
      return (
        <td key={col.id} style={f.style} className={`py-1 px-2.5 text-[12.5px] overflow-hidden ${f.className || "border-r border-slate-200"}`}>
          <div className="truncate w-full min-w-0">
            {item.landing_page_url ? (
              <a
                href={item.landing_page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-200 transition"
              >
                <ArrowSquareOutIcon size={14} weight="bold" />
                <span>Landing Page</span>
              </a>
            ) : (
              "—"
            )}
          </div>
        </td>
      );
    }

    let cellValue: any = (item as any)[cid];
    let displayNode: React.ReactNode = safeDisplay(cellValue);
    let cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200";

    switch (cid) {
      case "sku":
        displayNode = <span className="font-bold text-slate-950 text-[13px] col-sku col-primary" style={{ fontWeight: 700 }}>{safeDisplay(item.sku)}</span>;
        cellClass = "py-1.5 px-2.5 text-[13px] font-bold text-slate-950 border-r border-slate-200 col-sku col-primary";
        break;
      case "brand":
        displayNode = <span className="font-normal text-[13px] text-slate-900">{safeDisplay(item.brand)}</span>;
        break;
      case "asin":
        cellClass = "py-1.5 px-2.5 text-[13px] font-normal text-slate-900 border-r border-slate-200";
        break;
      case "fnsku":
        cellClass = "py-1.5 px-2.5 text-[13px] font-normal text-slate-900 border-r border-slate-200";
        break;
      case "amazon_fee":
        displayNode = item.amazon_fee != null ? `$${item.amazon_fee.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-center font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "referral_fee_pct":
        displayNode = item.referral_fee_pct != null ? `${(item.referral_fee_pct * 100).toFixed(0)}%` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-center font-normal tabular-nums text-slate-900 border-r border-slate-200";
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
        displayNode = safeDisplay(formatMonth(item.thang_listing));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "thang_danh_gia":
        displayNode = safeDisplay(formatMonth(item.thang_danh_gia));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "event_250th":
        displayNode = safeDisplay(formatDate(item.event_250th));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "ngay_danh_gia_sku_event":
        displayNode = safeDisplay(formatDate(item.ngay_danh_gia_sku_event));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "amazon_fba_fee_thay_doi":
        displayNode = item.amazon_fba_fee_thay_doi != null ? `$${item.amazon_fba_fee_thay_doi.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "basecost_tb":
        displayNode = item.basecost_tb != null ? `$${item.basecost_tb.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "basecost":
      case "shipping_fee":
      case "add_shipping_fee":
        displayNode = typeof cellValue === "number" ? `$${cellValue.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "sup":
        displayNode = <EntityBadge value={item.sup} />;
        break;
      case "ngay_len_camp":
        displayNode = safeDisplay(formatDate(item.ngay_len_camp));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "brand_entity_id":
      case "creative_asins_video":
      case "creative_asins_collection":
      case "video_media_ids":
      case "brand_logo_asset_id":
        cellClass = "py-1.5 px-2.5 text-[13px] font-normal text-slate-900 border-r border-slate-200";
        break;
      case "creative_headline":
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal border-r border-slate-200";
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
        style={f.style}
        className={`${cellClass} ${f.className}`}
        inlineEditing={inlineEditing}
        inlineSaving={inlineSaving}
        onStartEdit={startInlineEdit}
        onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
        onSave={handleSaveInlineCell}
        onCancel={() => setInlineEditing(null)}
        options={getColumnOptions("sku", cid)}
      />
    );
  }, [skuFreezeMap, getCellFreezeProps, inlineEditing, inlineSaving, startInlineEdit, handleSaveInlineCell, getColumnOptions]);

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
    const isDate = isDateField(col.id);
    const sortDirection = dateSort.inbound.field === col.id ? dateSort.inbound.direction : null;
    const options = isDate ? [] : getColumnOptions("inbound", col.id);
    const f = getCellFreezeProps(inboundFreezeMap, col.id, true);

    return (
      <ColumnHeaderCell
        key={col.id}
        col={col}
        style={f.style}
        isFrozen={f.isFrozen}
        isBoundary={f.isBoundary}
        draggable={!col.isFrozen && !f.isFrozen}
        isDragging={isDragging}
        isDragOver={isDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", col.id);
          e.dataTransfer.effectAllowed = "move";
          setHeaderDragId(col.id);
        }}
        onDragOver={(e) => {
          if (!headerDragId || headerDragId === col.id || col.isFrozen || f.isFrozen) return;
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
          if (col.isFrozen || f.isFrozen) return;
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
        className={`py-2 px-3 text-xs bg-[#ff9900] text-slate-900 font-bold border-r border-amber-600/60 leading-tight ${alignClass} ${f.className}`}
        onResize={(id, width) => resizeColumn("inbound", id, width)}
        onAutoFit={(id) => handleAutoFitColumn("inbound", id)}
        onColumnClick={(id, event) => setColumnContextMenu({ table: "inbound", field: id, x: event.clientX, y: event.clientY })}
      >
        <div className={`w-full ${isCenter ? "flex flex-col items-center justify-center text-center" : isRight ? "flex flex-col items-end" : ""}`}>
          <div className="flex items-center gap-1 w-full min-w-0 justify-center">
            {isDate ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleDateSort("inbound", col.id); }}
                className="inline-flex items-center gap-0.5 hover:underline cursor-pointer max-w-full justify-center"
                title={sortDirection === "desc" ? "Đang mới nhất trước — bấm để đổi sang cũ nhất" : "Đang cũ nhất trước — bấm để đổi sang mới nhất"}
              >
                <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center">{col.label}</span>
                {sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" className="shrink-0" /> : <CaretDownIcon size={12} weight="bold" className="shrink-0" />}
              </button>
            ) : (
              <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center max-w-full" title={col.label}>
                {col.label}
              </span>
            )}
            {columnFilters.inbound[col.id] && (
              <span
                className="h-2 w-2 rounded-full bg-slate-900 shrink-0 ring-1 ring-white"
                title={`Đang lọc: ${columnFilters.inbound[col.id]}`}
              />
            )}
            {isCustom && (
              <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-900 font-bold shrink-0">
                Custom
              </span>
            )}
          </div>
          {false && options.length > 0 && openColumnFilter?.table === "inbound" && openColumnFilter?.field === col.id && (
            <select
              value={columnFilters.inbound[col.id] || ""}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setColumnFilter("inbound", col.id, e.target.value)}
              className="mt-1 max-w-full rounded border border-amber-700/40 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-slate-800 cursor-pointer"
              title={`Lọc ${col.label}`}
            >
              <option value="">Tất cả</option>
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
        </div>
      </ColumnHeaderCell>
    );
  }, [inboundFreezeMap, getCellFreezeProps, headerDragId, headerDragOverId, handleReorderInboundColumns, resizeColumn, handleAutoFitColumn, dateSort.inbound, toggleDateSort, getColumnOptions, columnFilters.inbound, setColumnFilter, openColumnFilter]);

  const renderInboundCell = useCallback((col: ColumnConfig, item: InboundShipmentItem) => {
    const cid = col.id;
    const f = getCellFreezeProps(inboundFreezeMap, cid, false);

    if (col.isCustom) {
      return (
        <EditableCell
          key={col.id}
          table="inbound"
          id={item.id}
          field={col.id}
          value={item.custom_fields?.[col.id] ?? ""}
          display={safeDisplay(item.custom_fields?.[col.id])}
          style={f.style}
          className={`py-1 px-2.5 text-[12.5px] ${f.className || "border-r border-slate-200"}`}
          inlineEditing={inlineEditing}
          inlineSaving={inlineSaving}
          onStartEdit={startInlineEdit}
          onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
          onSave={handleSaveInlineCell}
          onCancel={() => setInlineEditing(null)}
          options={getColumnOptions("inbound", col.id)}
        />
      );
    }

    let cellValue: any = (item as any)[cid];
    let displayNode: React.ReactNode = safeDisplay(cellValue);
    let cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200";

    switch (cid) {
      case "sku":
        displayNode = <span className="font-bold text-slate-950 text-[13px] col-sku col-primary" style={{ fontWeight: 700 }}>{safeDisplay(item.sku)}</span>;
        cellClass = "py-1.5 px-2.5 text-[13px] font-bold text-slate-950 border-r border-slate-200 col-sku col-primary";
        break;
      case "brand":
        displayNode = <span className="font-normal text-[13px] text-slate-900">{safeDisplay(item.brand)}</span>;
        break;
      case "sup":
        displayNode = <EntityBadge value={item.sup} />;
        break;
      case "ngay_request":
      case "ngay_thanh_toan":
      case "ngay_di":
      case "ngay_den":
        displayNode = safeDisplay(formatDate(cellValue));
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200";
        break;
      case "quantity":
        displayNode = item.quantity?.toLocaleString() || 0;
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-950 border-r border-slate-200";
        break;
      case "line_ship":
        displayNode = <EntityBadge value={item.line_ship} />;
        cellClass = "py-1.5 px-2.5 text-[13px] text-center border-r border-slate-200";
        break;
      case "base_cost_per_unit":
        displayNode = item.base_cost_per_unit != null ? `$${item.base_cost_per_unit.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "card":
      case "tag":
      case "shipping_fee":
      case "hop_tui":
        displayNode = cellValue != null ? `$${cellValue.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "final_basecost":
        displayNode = item.final_basecost != null ? `$${item.final_basecost.toFixed(2)}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-medium tabular-nums text-slate-950 border-r border-slate-200";
        break;
      case "total_basecost":
        displayNode = item.total_basecost != null ? `$${item.total_basecost.toLocaleString()}` : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-semibold tabular-nums text-indigo-900 border-r border-slate-200";
        break;
      case "ten_lo_hang":
        displayNode = safeDisplay(item.ten_lo_hang);
        cellClass = "py-1.5 px-2.5 text-[13px] font-normal text-slate-900 border-r border-slate-200";
        break;
      case "shipment_id":
        displayNode = safeDisplay(item.shipment_id);
        cellClass = "py-1.5 px-2.5 text-[13px] font-normal text-slate-900 border-r border-slate-200";
        break;
      case "amazon_received":
        displayNode = item.amazon_received?.toLocaleString() || "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
        break;
      case "tinh_trang_hang_den_kho":
        displayNode = <EntityBadge value={item.tinh_trang_hang_den_kho} />;
        break;
      case "status":
        displayNode = <StatusBadge status={item.status} />;
        break;
      case "so_luong_amazon_nhan":
        displayNode = item.so_luong_amazon_nhan != null ? item.so_luong_amazon_nhan.toLocaleString() : "—";
        cellClass = "py-1.5 px-2.5 text-[13px] text-right font-medium tabular-nums text-emerald-800 border-r border-slate-200";
        break;
      case "discrepancy":
        displayNode = item.discrepancy != null ? (
          item.discrepancy !== 0 ? (
            <span className="font-normal tabular-nums text-rose-600">{item.discrepancy}</span>
          ) : (
            <span className="text-slate-400 font-normal tabular-nums">0</span>
          )
        ) : (
          "—"
        );
        cellClass = "py-1.5 px-2.5 text-[13px] text-center border-r border-slate-200";
        break;
      case "note":
        displayNode = safeDisplay(item.note);
        cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200";
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
        style={f.style}
        className={`${cellClass} ${f.className}`}
        inlineEditing={inlineEditing}
        inlineSaving={inlineSaving}
        onStartEdit={startInlineEdit}
        onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
        onSave={handleSaveInlineCell}
        onCancel={() => setInlineEditing(null)}
        options={getColumnOptions("inbound", cid)}
      />
    );
  }, [inboundFreezeMap, getCellFreezeProps, inlineEditing, inlineSaving, startInlineEdit, handleSaveInlineCell, getColumnOptions]);

  const renderCheckShipmentHeader = useCallback(
    (col: ColumnConfig) => {
      const isCustom = col.isCustom;
      const isCenter = col.id === "brand" || col.id === "ngay_update" || col.id === "created_date" || col.id === "last_updated_date" || col.id === "ship_to" || col.id === "discrepancy" || col.id === "status";
      const isRight = col.id === "skus_count" || col.id === "units_expected" || col.id === "units_located";

      let alignClass = "";
      if (isCenter) alignClass = "text-center";
      else if (isRight) alignClass = "text-right";

      const isDragging = headerDragId === col.id;
      const isDragOver = headerDragOverId === col.id;
      const isDate = isDateField(col.id);
      const sortDirection = dateSort.check_shipment.field === col.id ? dateSort.check_shipment.direction : null;
      const options = isDate ? [] : getColumnOptions("check_shipment", col.id);
      const f = getCellFreezeProps(checkShipmentFreezeMap, col.id, true);

      return (
        <ColumnHeaderCell
          key={col.id}
          col={col}
          style={f.style}
          isFrozen={f.isFrozen}
          isBoundary={f.isBoundary}
          draggable={!col.isFrozen && !f.isFrozen}
          isDragging={isDragging}
          isDragOver={isDragOver}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", col.id);
            e.dataTransfer.effectAllowed = "move";
            setHeaderDragId(col.id);
          }}
          onDragOver={(e) => {
            if (!headerDragId || headerDragId === col.id || col.isFrozen || f.isFrozen) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (headerDragOverId !== col.id) {
              setHeaderDragOverId(col.id);
            }
          }}
          onDragLeave={() => {
            if (headerDragOverId === col.id) setHeaderDragOverId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (col.isFrozen || f.isFrozen) return;
            const sourceId = e.dataTransfer.getData("text/plain") || headerDragId;
            if (sourceId && sourceId !== col.id) {
              handleReorderCheckShipmentColumns(sourceId, col.id);
            }
            setHeaderDragId(null);
            setHeaderDragOverId(null);
          }}
          onDragEnd={() => {
            setHeaderDragId(null);
            setHeaderDragOverId(null);
          }}
          className={`py-2 px-3 text-xs bg-[#ff9900] text-slate-900 font-bold border-r border-amber-600/60 leading-tight ${alignClass} ${f.className}`}
          onResize={(id, width) => resizeColumn("check_shipment", id, width)}
          onAutoFit={(id) => handleAutoFitColumn("check_shipment", id)}
          onColumnClick={(id, event) => setColumnContextMenu({ table: "check_shipment", field: id, x: event.clientX, y: event.clientY })}
        >
          <div className={`w-full ${isCenter ? "flex flex-col items-center justify-center text-center" : isRight ? "flex flex-col items-end" : ""}`}>
            <div className="flex items-center gap-1 w-full min-w-0 justify-center">
              {isDate ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleDateSort("check_shipment", col.id); }}
                  className="inline-flex items-center gap-0.5 hover:underline cursor-pointer max-w-full justify-center"
                  title={sortDirection === "desc" ? "Đang mới nhất trước — bấm để đổi sang cũ nhất" : "Đang cũ nhất trước — bấm để đổi sang mới nhất"}
                >
                  <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center">{col.label}</span>
                  {sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" className="shrink-0" /> : <CaretDownIcon size={12} weight="bold" className="shrink-0" />}
                </button>
              ) : (
                <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center max-w-full" title={col.label}>
                  {col.label}
                </span>
              )}
              {columnFilters.check_shipment[col.id] && (
                <span
                  className="h-2 w-2 rounded-full bg-slate-900 shrink-0 ring-1 ring-white"
                  title={`Đang lọc: ${columnFilters.check_shipment[col.id]}`}
                />
              )}
              {isCustom && (
                <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-900 font-bold shrink-0">
                  Custom
                </span>
              )}
            </div>
            {false && options.length > 0 && openColumnFilter?.table === "check_shipment" && openColumnFilter?.field === col.id && (
              <select
                value={columnFilters.check_shipment[col.id] || ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setColumnFilter("check_shipment", col.id, e.target.value)}
                className="mt-1 max-w-full rounded border border-amber-700/40 bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-slate-800 cursor-pointer"
                title={`Lọc ${col.label}`}
              >
                <option value="">Tất cả</option>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
          </div>
        </ColumnHeaderCell>
      );
    },
    [checkShipmentFreezeMap, getCellFreezeProps, headerDragId, headerDragOverId, handleReorderCheckShipmentColumns, resizeColumn, handleAutoFitColumn, dateSort.check_shipment, toggleDateSort, getColumnOptions, columnFilters.check_shipment, setColumnFilter, openColumnFilter]
  );

  const renderCheckShipmentCell = useCallback(
    (col: ColumnConfig, item: CheckShipmentItem) => {
      const cid = col.id;
      const f = getCellFreezeProps(checkShipmentFreezeMap, cid, false);

      if (col.isCustom) {
        return (
          <EditableCell
            key={col.id}
            table="check_shipment"
            id={item.id}
            field={col.id}
            value={item.custom_fields?.[col.id] ?? ""}
            display={safeDisplay(item.custom_fields?.[col.id])}
            style={f.style}
            className={`py-1 px-2.5 text-[12.5px] ${f.className || "border-r border-slate-200"}`}
            inlineEditing={inlineEditing}
            inlineSaving={inlineSaving}
            onStartEdit={startInlineEdit}
            onChangeValue={(val) => setInlineEditing((prev) => (prev ? { ...prev, value: val } : null))}
            onSave={handleSaveInlineCell}
            onCancel={() => setInlineEditing(null)}
            options={getColumnOptions("check_shipment", col.id)}
          />
        );
      }

      let cellValue: any = (item as any)[cid];
      let displayNode: React.ReactNode = safeDisplay(cellValue);
      let cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 border-r border-slate-200";

      switch (cid) {
        case "brand":
          displayNode = <EntityBadge value={item.brand} />;
          cellClass = "py-1.5 px-2.5 text-[13px] text-center border-r border-slate-200";
          break;
        case "ngay_update":
        case "created_date":
        case "last_updated_date":
          displayNode = safeDisplay(formatDate(cellValue));
          cellClass = "py-1.5 px-2.5 text-[13px] text-slate-900 font-normal tabular-nums border-r border-slate-200 text-center";
          break;
        case "ship_to":
          displayNode = <EntityBadge value={item.ship_to} />;
          cellClass = "py-1.5 px-2.5 text-[13px] text-center border-r border-slate-200";
          break;
        case "skus_count":
          displayNode = item.skus_count != null ? item.skus_count.toLocaleString() : "—";
          cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-900 border-r border-slate-200";
          break;
        case "units_expected":
          displayNode = item.units_expected != null ? item.units_expected.toLocaleString() : "—";
          cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-slate-950 border-r border-slate-200";
          break;
        case "units_located":
          displayNode = item.units_located != null ? item.units_located.toLocaleString() : "—";
          cellClass = "py-1.5 px-2.5 text-[13px] text-right font-normal tabular-nums text-emerald-800 border-r border-slate-200";
          break;
        case "discrepancy": {
          const disc = item.discrepancy ?? (item.units_located != null && item.units_expected != null ? item.units_located - item.units_expected : 0);
          if (disc === 0) {
            displayNode = <span className="text-slate-400 font-normal tabular-nums">0</span>;
          } else if (disc < 0) {
            displayNode = (
              <span className="font-normal tabular-nums text-rose-600">
                {disc}
              </span>
            );
          } else {
            displayNode = (
              <span className="font-normal tabular-nums text-emerald-600">
                +{disc}
              </span>
            );
          }
          cellClass = "py-1.5 px-2.5 text-[13px] text-center border-r border-slate-200";
          break;
        }
        case "status":
          displayNode = <StatusBadge status={item.status} />;
          cellClass = "py-1 px-2.5 text-xs text-center border-r border-slate-200";
          break;
        case "shipment_id":
          displayNode = (
            <span className="font-mono font-normal text-slate-900 text-xs">
              {item.shipment_id || "—"}
            </span>
          );
          cellClass = "py-1 px-2.5 text-xs border-r border-slate-200 text-center";
          break;
        case "shipment_name":
          displayNode = <span className="font-normal text-slate-900 text-xs">{safeDisplay(item.shipment_name)}</span>;
          cellClass = "py-1 px-2.5 text-xs border-r border-slate-200";
          break;
      }

      return (
        <EditableCell
          key={col.id}
          table="check_shipment"
          id={item.id}
          field={cid as any}
          value={cellValue}
          display={displayNode}
          style={f.style}
          className={`${cellClass} ${f.className}`}
          inlineEditing={inlineEditing}
          inlineSaving={inlineSaving}
          onStartEdit={startInlineEdit}
          onChangeValue={(val) => setInlineEditing((prev) => (prev ? { ...prev, value: val } : null))}
          onSave={handleSaveInlineCell}
          onCancel={() => setInlineEditing(null)}
          options={getColumnOptions("check_shipment", cid)}
        />
      );
    },
    [checkShipmentFreezeMap, getCellFreezeProps, inlineEditing, inlineSaving, startInlineEdit, handleSaveInlineCell, getColumnOptions]
  );

  const contextFilterOptions =
    columnContextMenu && columnContextMenu.table !== "monthly_base_cost"
      ? (() => {
          const opts = getColumnOptions(columnContextMenu.table, columnContextMenu.field);
          if (opts.length > 0) return opts;
          return scanOptionsFromRows(columnContextMenu.table, columnContextMenu.field).filter(isValidComboboxOption);
        })()
      : [];

  const renderSkuSheetTab = (sheet: { channel: SkuChannel; label: string; count: number }) => {
    const isActive = activeTab === "sku" && skuChannel === sheet.channel;
    return (
      <button
        key={`sku-${sheet.channel}`}
        type="button"
        onClick={() => handleSkuSheetChange(sheet.channel)}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 2xl:px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none ${
          isActive
            ? channelTabActiveClass(sheet.channel)
            : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
        }`}
      >
        <PackageIcon size={16} weight="bold" />
        <span>{sheet.label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
            isActive ? channelTabBadgeActiveClass(sheet.channel) : "bg-slate-300 text-slate-700"
          }`}
        >
          {sheet.count}
        </span>
      </button>
    );
  };

  const renderBaseCostTab = (sheet: { channel: SkuChannel; label: string }) => {
    const isActive = activeTab === "monthly_base_cost" && baseCostChannel === sheet.channel;
    return (
      <button
        key={`basecost-${sheet.channel}`}
        type="button"
        onClick={() => handleBaseCostChannelChange(sheet.channel)}
        className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 2xl:px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none ${
          isActive
            ? channelTabActiveClass(sheet.channel)
            : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
        }`}
      >
        <CalculatorIcon size={16} weight="bold" />
        <span>{sheet.label}</span>
      </button>
    );
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

      {columnContextMenu && (() => {
        const table = columnContextMenu.table;
        const field = columnContextMenu.field;
        const columns =
          table === "sku"
            ? skuColumns
            : table === "inbound"
            ? inboundColumns
            : table === "check_shipment"
            ? checkShipmentColumns
            : monthlyBaseCostColumns;
        const col = columns.find((item) => item.id === field);
        const colLabel = col?.label || field;
        const defaultBoundary =
          table === "check_shipment"
            ? "shipment_name"
            : table === "monthly_base_cost"
            ? "asin"
            : "sku";
        const currentBoundary = frozenThrough[table];
        const isCurrentBoundary = currentBoundary === field;
        const isDefault = currentBoundary === defaultBoundary;

        return (
          <div
            ref={columnMenuRef}
            className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.min(columnContextMenu.x, window.innerWidth - 240),
              top: Math.min(columnContextMenu.y, window.innerHeight - 200),
            }}
          >
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tùy chọn cột</span>
              <span className="text-xs font-bold text-slate-900 truncate max-w-[120px]">{colLabel}</span>
            </div>

            <div className="p-1 space-y-0.5">
              {/* THU NHỎ CỘT */}
              <button
                type="button"
                onClick={() => {
                  handleAutoFitColumn(table, field);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <ArrowsInLineHorizontalIcon size={14} className="text-amber-600 shrink-0" />
                <span>Thu nhỏ cột</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (table === "monthly_base_cost") {
                    setShowColumnModal(true);
                  } else if (col) {
                    handleQuickRenameColumn(table, col.id, col.label);
                  }
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                <PencilSimpleIcon size={14} className="text-slate-500 shrink-0" />
                <span>Setting cột</span>
              </button>

              {/* KHÓA CỘT: Cố định từ cột 1 đến cột này */}
              {!isCurrentBoundary ? (
                <button
                  type="button"
                  onClick={() => {
                    setFrozenThroughColumn(table, field);
                    notify(`Đã khóa các cột từ cột 1 đến "${colLabel}". Khi lướt sang phải, các cột này sẽ giữ nguyên cố định để gióng hàng.`, "success");
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
                    setFrozenThroughColumn(table, defaultBoundary);
                    notify("Đã đưa vùng khóa cột về mặc định.", "success");
                    setColumnContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  <LockOpenIcon size={14} weight="bold" className="text-amber-600 shrink-0" />
                  <span>Bỏ khóa tùy chỉnh</span>
                </button>
              )}

              {!isDefault && !isCurrentBoundary && (
                <button
                  type="button"
                  onClick={() => {
                    setFrozenThroughColumn(table, defaultBoundary);
                    notify("Đã đưa vùng khóa cột về mặc định.", "success");
                    setColumnContextMenu(null);
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-1 rounded-lg text-left text-[11px] text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                >
                  <ArrowCounterClockwiseIcon size={13} className="text-slate-400 shrink-0" />
                  <span>Về khóa mặc định ({defaultBoundary.toUpperCase()})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleQuickHideColumn(table, field);
                  setColumnContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-left text-xs font-semibold text-rose-700 hover:bg-rose-50 transition cursor-pointer"
              >
                <EyeSlashIcon size={14} className="text-rose-500 shrink-0" />
                <span>Ẩn cột này</span>
              </button>
            </div>

            {columnContextMenu.table !== "monthly_base_cost" && contextFilterOptions.length > 0 && (
              <label className="block border-t border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                Lọc cột này
                <select
                  autoFocus
                  value={columnFilters[columnContextMenu.table][columnContextMenu.field] || ""}
                  onChange={(event) => {
                    if (columnContextMenu.table !== "monthly_base_cost") {
                      setColumnFilter(columnContextMenu.table, columnContextMenu.field, event.target.value);
                    }
                    setColumnContextMenu(null);
                  }}
                  className="mt-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="">Tất cả</option>
                  {contextFilterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            )}
          </div>
        );
      })()}

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

          {/* Right: Action Buttons (Tab nào nút của tab đó) */}
          <div className="flex items-center gap-2 self-end lg:self-center">
            {isFbmBaseCost ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openImportModal}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Dán link Google Sheet Kế Toán Tổng Hợp FBM (tab ĐẦU VÀO FBM PW)"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập Basecost FBM</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    window.location.href = `/api/accounting/inventory/fbm-pw-costs?${fbmPwCostRef.current?.exportQuery() ?? `store_id=${selectedStoreId}`}&format=xlsx`;
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel theo bộ lọc đang xem"
                >
                  <FileXlsIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleReloadTab}
                  disabled={syncingSheet}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  title={
                    currentSheetLink
                      ? `Đồng bộ ngay từ Google Sheet "${currentSheetLink.spreadsheet_title ?? ""}" rồi tải lại bảng`
                      : "Tải lại bảng dữ liệu"
                  }
                >
                  <ArrowClockwiseIcon size={16} weight="bold" className={syncingSheet ? "animate-spin text-indigo-600" : ""} />
                </button>
              </div>
            ) : activeTab === "monthly_base_cost" ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => monthlyBaseCostRef.current?.syncYear()}
                  disabled={syncingMonthlyBaseCost}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3.5 py-1.5 text-xs font-bold text-white hover:from-amber-600 hover:to-orange-600 transition shadow-xs cursor-pointer disabled:opacity-50"
                  title="Tự động tính Base Cost theo công thức bình quân gia quyền"
                >
                  <SparkleIcon size={15} weight="fill" className={syncingMonthlyBaseCost ? "animate-spin" : ""} />
                  <span>{syncingMonthlyBaseCost ? "Đang tính Base Cost..." : "Tự động tính Base Cost"}</span>
                </button>

                <button
                  type="button"
                  onClick={openImportModal}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                  title="Nhập file Excel dữ liệu đầu năm hoặc bảng Basecost 12 tháng"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>Nhập Excel</span>
                </button>

                <a
                  href={`/api/accounting/inventory/export?store_id=${selectedStoreId}&type=monthly_base_cost&year=${monthlyBaseCostYear}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất file Excel đúng định dạng 12 tháng"
                >
                  <FileXlsIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                <button
                  type="button"
                  onClick={() => setShowColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title={`Cấu hình cột BASECOST THÁNG (${monthlyBaseCostVisibleCount}/${monthlyBaseCostColumns.length})`}
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setHistoryDrawer({
                      isOpen: true,
                      entityType: "monthly_base_cost",
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-indigo-700 transition shadow-2xs cursor-pointer"
                  title="Xem lịch sử thay đổi Base Cost"
                >
                  <ClockCounterClockwiseIcon size={15} weight="bold" />
                  <span>Lịch sử</span>
                </button>

                <button
                  type="button"
                  onClick={() => monthlyBaseCostRef.current?.reload()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
                  title="Tải lại bảng Basecost Tháng"
                >
                  <ArrowClockwiseIcon size={16} weight="bold" />
                </button>
              </div>
            ) : (
              <>
                {activeTab === "sku" ? (
                  <button
                    type="button"
                    onClick={handleOpenAddSku}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition shadow-xs cursor-pointer"
                  >
                    <PlusIcon size={15} weight="bold" />
                    <span>Thêm Phôi</span>
                  </button>
                ) : activeTab === "inbound" ? (
                  <button
                    type="button"
                    onClick={handleOpenAddShipment}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition shadow-xs cursor-pointer"
                  >
                    <PlusIcon size={15} weight="bold" />
                    <span>Thêm Lô Hàng</span>
                  </button>
                ) : activeTab === "check_shipment" ? (
                  <button
                    type="button"
                    onClick={handleOpenAddCheckShipment}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 transition shadow-xs cursor-pointer"
                  >
                    <PlusIcon size={15} weight="bold" />
                    <span>Thêm Shipment</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={openImportModal}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs cursor-pointer"
                >
                  <UploadSimpleIcon size={15} weight="bold" />
                  <span>{activeTab === "sku" ? `Nhập ${skuSheetLabel}` : activeTab === "inbound" ? "Nhập Đi Hàng" : "Nhập Check Shipment"}</span>
                </button>

                {activeTab === "check_shipment" && (
                  <button
                    type="button"
                    onClick={handleSyncCheckShipmentsToInbound}
                    disabled={syncingShipments}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-100 transition shadow-2xs cursor-pointer disabled:opacity-50"
                    title="Đồng bộ Units Located sang cột Số Lượng Amazon Nhận và Status sang Đi Hàng"
                  >
                    <ArrowClockwiseIcon size={14} weight="bold" className={syncingShipments ? "animate-spin" : ""} />
                    <span>Đồng bộ Đi Hàng</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowColumnModal(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 transition shadow-2xs cursor-pointer"
                  title={`Cấu hình cột ${
                    activeTab === "sku"
                      ? skuSheetLabel.toUpperCase()
                      : activeTab === "inbound"
                      ? "CHI TIẾT ĐI HÀNG"
                      : activeTab === "check_shipment"
                      ? "CHECK SHIPMENT"
                      : "BASECOST THÁNG"
                  } (${
                    activeTab === "sku"
                      ? skuVisibleCount
                      : activeTab === "inbound"
                      ? inboundVisibleCount
                      : activeTab === "check_shipment"
                      ? checkShipmentVisibleCount
                      : monthlyBaseCostVisibleCount
                  }/${
                    activeTab === "sku"
                      ? skuColumns.length
                      : activeTab === "inbound"
                      ? inboundColumns.length
                      : activeTab === "check_shipment"
                      ? checkShipmentColumns.length
                      : monthlyBaseCostColumns.length
                  })`}
                >
                  <SlidersHorizontalIcon size={16} weight="bold" className="text-amber-700" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setHistoryDrawer({
                      isOpen: true,
                      entityType: activeTab === "sku" ? skuEntityType : activeTab,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-indigo-700 transition shadow-2xs cursor-pointer"
                  title="Xem lịch sử thay đổi & khôi phục dữ liệu"
                >
                  <ClockCounterClockwiseIcon size={15} weight="bold" />
                  <span>Lịch sử</span>
                </button>

                <a
                  href={`/api/accounting/inventory/export?store_id=${selectedStoreId}&type=${activeTab}${isFbmSheet ? "&channel=fbm" : ""}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer"
                  title="Xuất Excel toàn bộ dữ liệu từ Server"
                >
                  <FileXlsIcon size={15} weight="bold" />
                  <span>Xuất Excel</span>
                </a>

                <button
                  type="button"
                  onClick={handleReloadTab}
                  disabled={loadingSkus || loadingShipments || loadingCheckShipments || syncingLatestFiles || syncingSheet}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition shadow-2xs cursor-pointer disabled:opacity-50"
                  title={
                    activeTab === "check_shipment"
                      ? "Tải lại tab và tự động nạp file Check Shipment mới nhất cho tất cả các Store"
                      : currentSheetLink
                      ? `Đồng bộ ngay từ Google Sheet "${currentSheetLink.spreadsheet_title ?? ""}" rồi tải lại bảng`
                      : "Tải lại bảng dữ liệu"
                  }
                >
                  <ArrowClockwiseIcon
                    size={16}
                    weight="bold"
                    className={
                      loadingSkus || loadingShipments || loadingCheckShipments || syncingLatestFiles || syncingSheet
                        ? "animate-spin text-indigo-600"
                        : ""
                    }
                  />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* TABS & QUICK FILTER BAR: Sheet tabs + Quick Filter in ONE compact line */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-slate-200/70 p-1.5 rounded-xl border border-slate-300 min-h-[46px]">
        {/* Sheet Tabs like Excel */}
        <div className="flex items-center gap-1 min-w-0 max-w-full overflow-x-auto">
          {storeCanFba && (
          <>
          {renderSkuSheetTab({ channel: "fba", label: "Bảng Mã", count: fbaSkuCount })}

          <button
            type="button"
            onClick={() => handleTabChange("inbound")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 2xl:px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none ${
              activeTab === "inbound"
                ? channelTabActiveClass("fba")
                : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
            }`}
          >
            <TruckIcon size={16} weight="bold" />
            <span>Chi Tiết Đi Hàng</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                activeTab === "inbound" ? channelTabBadgeActiveClass("fba") : "bg-slate-300 text-slate-700"
              }`}
            >
              {shipmentBadgeCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("check_shipment")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 2xl:px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer select-none ${
              activeTab === "check_shipment"
                ? channelTabActiveClass("fba")
                : "border-transparent text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
            }`}
          >
            <BarcodeIcon size={16} weight="bold" />
            <span>Check Shipment</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                activeTab === "check_shipment" ? channelTabBadgeActiveClass("fba") : "bg-slate-300 text-slate-700"
              }`}
            >
              {checkShipmentBadgeCount}
            </span>
          </button>

          {renderBaseCostTab({ channel: "fba", label: "Basecost Tháng" })}
          </>
          )}

          {/* Vạch ngăn nhóm tab FBA với nhóm tab FBM cho đỡ lẫn */}
          {storeHasFbm && (
            <>
              {storeCanFba && <span className="mx-1.5 h-6 w-px shrink-0 bg-slate-400" aria-hidden="true" />}
              {renderSkuSheetTab({ channel: "fbm", label: "Bảng Mã FBM", count: fbmSkuCount })}
              {renderBaseCostTab({ channel: "fbm", label: "Basecost FBM" })}
            </>
          )}
        </div>

        {/* Filter Controls inline + Table Zoom Controls */}
        {activeTab === "sku" ? (
          <div className="flex items-center gap-2 flex-wrap ml-auto justify-end min-w-0">
            {skuInventorySummary.totalTon > 0 && (
              <div
                className="hidden xl:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium shadow-2xs select-none"
                title="Tổng số lượng và giá trị tồn kho của các SKU hiển thị"
              >
                <span>Tồn: <strong className="font-bold text-emerald-950">{skuInventorySummary.totalTon.toLocaleString("en-US")}</strong> pcs</span>
                <span>•</span>
                <span>Giá trị tồn: <strong className="font-bold text-emerald-950 font-mono">${skuInventorySummary.totalGiaTri.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
              </div>
            )}
            <div className="relative w-40 sm:w-52 focus-within:!w-64 transition-all duration-200">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm SKU, ASIN, Niche..."
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
              />
              {skuSearch && (
                <button
                  type="button"
                  onClick={() => setSkuSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                  title="Xoá tìm kiếm"
                >
                  <XIcon size={12} weight="bold" />
                </button>
              )}
            </div>
            <select
              value={skuTypeFilter}
              onChange={(e) => setSkuTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer shadow-2xs"
            >
              <option value="">Tất cả Loại Phôi</option>
              {skuProductTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
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
          </div>
        ) : activeTab === "inbound" ? (
          <div className="flex items-center gap-2 flex-wrap ml-auto justify-end min-w-0">
            <div className="relative w-40 sm:w-52 focus-within:!w-64 transition-all duration-200">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm lô, SKU, Shipment ID..."
                value={shipmentSearch}
                onChange={(e) => setShipmentSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
              />
              {shipmentSearch && (
                <button
                  type="button"
                  onClick={() => setShipmentSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                  title="Xoá tìm kiếm"
                >
                  <XIcon size={12} weight="bold" />
                </button>
              )}
            </div>
            <select
              value={shipmentStatusFilter}
              onChange={(e) => setShipmentStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer shadow-2xs"
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
          </div>
        ) : activeTab === "check_shipment" ? (
          <div className="flex items-center gap-2 flex-wrap ml-auto justify-end min-w-0">
            <div className="relative w-40 sm:w-52 focus-within:!w-64 transition-all duration-200">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm Shipment ID, name..."
                value={checkShipmentSearch}
                onChange={(e) => setCheckShipmentSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
              />
              {checkShipmentSearch && (
                <button
                  type="button"
                  onClick={() => setCheckShipmentSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                  title="Xoá tìm kiếm"
                >
                  <XIcon size={12} weight="bold" />
                </button>
              )}
            </div>
            <select
              value={checkShipmentStatusFilter}
              onChange={(e) => setCheckShipmentStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer shadow-2xs"
            >
              <option value="">Tất cả Trạng thái</option>
              {DEFAULT_CHECK_SHIPMENT_STATUS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
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
          </div>
        ) : activeTab === "monthly_base_cost" ? (
          <div className="flex items-center gap-2 flex-wrap ml-auto justify-end min-w-0">
            {/* Basecost Tháng FBM có ô tìm kiếm + lọc tháng riêng ngay trên bảng */}
            {!isFbmBaseCost && (<>
            <div className="relative w-40 sm:w-52 focus-within:!w-64 transition-all duration-200">
              <MagnifyingGlassIcon
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm SKU, ASIN, Loại SP..."
                value={monthlyBaseCostSearch}
                onChange={(e) => setMonthlyBaseCostSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
              />
              {monthlyBaseCostSearch && (
                <button
                  type="button"
                  onClick={() => setMonthlyBaseCostSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                  title="Xoá tìm kiếm"
                >
                  <XIcon size={12} weight="bold" />
                </button>
              )}
            </div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Năm:
            </span>
            <div className="relative">
              <select
                aria-label="Chọn năm"
                value={monthlyBaseCostYear}
                onChange={(e) => setMonthlyBaseCostYear(Number(e.target.value))}
                className="pl-2.5 pr-7 py-1 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-2xs"
              >
                <option value={2026}>Năm 2026</option>
                <option value={2025}>Năm 2025</option>
                <option value={2024}>Năm 2024</option>
                <option value={2027}>Năm 2027</option>
              </select>
              <CaretDownIcon className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
            </>)}

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
          </div>
        ) : null}
      </div>

      {/* ACTIVE COLUMN FILTERS BAR (HIỂN THỊ CÁC CỘT ĐANG ĐƯỢC LỌC) */}
      {activeTab !== "monthly_base_cost" && Object.keys(columnFilters[activeTab] || {}).length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50/80 rounded-xl border border-amber-200 flex-wrap shadow-2xs">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-300">
            <FunnelIcon size={12} weight="bold" />
            Đang lọc theo:
          </span>
          {Object.entries(columnFilters[activeTab] || {}).map(([field, val]) => {
            const activeColumns =
              activeTab === "sku"
                ? skuColumns
                : activeTab === "inbound"
                ? inboundColumns
                : checkShipmentColumns;
            const col = activeColumns.find((c) => c.id === field);
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
                  onClick={() => setColumnFilter(activeTab, field, "")}
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
            onClick={() => {
              setColumnFilters((prev) => ({
                ...prev,
                [activeTab]: {},
              }));
            }}
            className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer ml-1"
          >
            Xóa tất cả lọc
          </button>
        </div>
      )}

      {/* TAB 1: SKU MASTER TABLE
          FROZEN COLUMNS: STT (left-0), Product Type (left-[56px]), Phôi Mockup (left-[230px]), Mã SKU (left-[326px])
          SOLID 100% OPAQUE BACKGROUND & CRISP DIVIDER LINE */}
      {visitedTabs.sku && (
        <div className={`rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col relative ${shownTab === "sku" ? "" : "hidden"}`}>
          <FreezeWhenHidden active={shownTab === "sku"} frozen={tabSwitchPending} render={() => (<>
          <AccountingTopProgressBar loading={loadingSkus} variant="indigo" />
          <div
            ref={skuScrollRef}
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600"
          >
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table ref={skuTableRef} className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <colgroup>
                {orderedVisibleSkuColumns.map((column) => (
                  <col key={column.id} style={{ width: getColumnWidth(column) }} />
                ))}
                <col style={{ width: 142 }} />
              </colgroup>
              <thead
                className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs"
              >
                <tr className="text-xs font-semibold uppercase tracking-[0.04em]">
                  {orderedVisibleSkuColumns.map((col) => renderSkuHeader(col))}

                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-900 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-slate-200 transition-opacity duration-200 ${
                  loadingSkus && sortedSkus.length > 0 ? "opacity-60 pointer-events-none" : "opacity-100"
                }`}
              >
                {loadingSkus && sortedSkus.length === 0 ? (
                  <AccountingTableSkeletonRows rows={12} colSpan={skuVisibleCount + 1} />
                ) : sortedSkus.length === 0 ? (
                  <tr>
                    <td colSpan={skuVisibleCount + 1} className="py-20 text-center text-slate-500 text-sm">
                      <PackageIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Chưa có SKU nào trong {skuSheetLabel} của Store {selectedStore?.name}. Nhấn <strong>Thêm Phôi</strong> hoặc <strong>Nhập {skuSheetLabel}</strong> để nhập dữ liệu.
                    </td>
                  </tr>
                ) : (
                  sortedSkus.map((item, idx) => {
                    const stt = (skuPage - 1) * skuLimit + idx + 1;
                    return (
                      <tr
                        key={item.id}
                        data-index={idx}
                        className={`inventory-row group h-[34px] min-h-[34px] hover:bg-amber-50/60 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200 ${idx % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"}`}
                      >
                          {/* FROZEN 1: STT with Pencil Button aligned */}
                          {skuColMap["stt"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(skuFreezeMap, "stt", false);
                            return (
                              <td
                                style={f.style}
                                className={`py-1.5 px-1 text-center text-[13px] font-medium text-slate-700 ${f.className}`}
                              >
                                <div className="flex items-center justify-between gap-1 w-full px-1">
                                  <span className="w-5 text-center text-[13px] font-medium text-slate-700 tabular-nums">{stt}</span>
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
                            );
                          })()}

                          {/* FROZEN 2: Product Type */}
                          {skuColMap["product_type"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(skuFreezeMap, "product_type", false);
                            return (
                              <EditableCell
                                table="sku"
                                id={item.id}
                                field="product_type"
                                value={item.product_type}
                                display={<ProductTypeBadge type={item.product_type} />}
                                style={f.style}
                                className={`py-1.5 px-3 text-[13px] ${f.className}`}
                                inlineEditing={inlineEditing}
                                inlineSaving={inlineSaving}
                                onStartEdit={startInlineEdit}
                                onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                                onSave={handleSaveInlineCell}
                                onCancel={() => setInlineEditing(null)}
                                options={skuProductTypes}
                              />
                            );
                          })()}

                          {/* FROZEN 3: Mockup */}
                          {skuColMap["mockup"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(skuFreezeMap, "mockup", false);
                            return (
                              <td
                                style={f.style}
                                className={`py-1 px-1 text-center ${f.className}`}
                              >
                                <MockupCell
                                  table="sku"
                                  id={item.id}
                                  field="mockup_url"
                                  url={item.mockup_url || item.mockup}
                                  alt={item.sku}
                                  onPreview={(previewData) => setPreviewModal(previewData)}
                                  onSave={(tbl, id, fld, val) => handleSaveInlineCell(tbl, id, fld, val)}
                                  notify={notify}
                                />
                              </td>
                            );
                          })()}

                          {/* FROZEN 4: SKU */}
                          {skuColMap["sku"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(skuFreezeMap, "sku", false);
                            return (
                              <EditableCell
                                table="sku"
                                id={item.id}
                                field="sku"
                                value={item.sku}
                                display={
                                  <span className="font-bold text-slate-950 text-[13px] col-sku col-primary" style={{ fontWeight: 700 }}>
                                    {item.sku}
                                  </span>
                                }
                                style={{ ...f.style, fontWeight: 700 }}
                                className={`py-1.5 px-3 text-[13px] font-bold col-sku col-primary ${f.className}`}
                                inlineEditing={inlineEditing}
                                inlineSaving={inlineSaving}
                                onStartEdit={startInlineEdit}
                                onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                                onSave={handleSaveInlineCell}
                                onCancel={() => setInlineEditing(null)}
                                options={getColumnOptions("sku", "sku")}
                              />
                            );
                          })()}

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

          {/* Pagination Bar 100/1 */}
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
          </>)} />
        </div>
      )}

      {/* TAB 2: INBOUND SHIPMENTS TABLE
          FROZEN COLUMNS: STT (left-0), Product Type (left-[56px]), Mockup (left-[230px]), Mã SKU (left-[326px]) */}
      {visitedTabs.inbound && (
        <div className={`rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col relative ${shownTab === "inbound" ? "" : "hidden"}`}>
          <FreezeWhenHidden active={shownTab === "inbound"} frozen={tabSwitchPending} render={() => (<>
          <AccountingTopProgressBar loading={loadingShipments} variant="indigo" />
          <div
            ref={shipmentScrollRef}
            className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600"
          >
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table ref={inboundTableRef} className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <colgroup>
                {orderedVisibleInboundColumns.map((column) => (
                  <col key={column.id} style={{ width: getColumnWidth(column) }} />
                ))}
                <col style={{ width: 142 }} />
              </colgroup>
              <thead
                className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs"
              >
                <tr className="text-xs font-semibold uppercase tracking-[0.04em]">
                  {orderedVisibleInboundColumns.map((col) => renderInboundHeader(col))}

                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-900 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-slate-200 transition-opacity duration-200 ${
                  loadingShipments && sortedShipments.length > 0 ? "opacity-60 pointer-events-none" : "opacity-100"
                }`}
              >
                {loadingShipments && sortedShipments.length === 0 ? (
                  <AccountingTableSkeletonRows rows={10} colSpan={inboundVisibleCount + 1} />
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
                        data-index={idx}
                        className={`inventory-row group h-[34px] min-h-[34px] hover:bg-amber-50/60 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200 ${idx % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"}`}
                      >
                          {/* FROZEN 1: STT with Pencil Button aligned */}
                          {inboundColMap["stt"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(inboundFreezeMap, "stt", false);
                            return (
                              <td
                                style={f.style}
                                className={`py-1.5 px-1 text-center text-[13px] font-medium text-slate-700 ${f.className}`}
                              >
                                <div className="flex items-center justify-between gap-1 w-full px-1">
                                  <span className="w-5 text-center text-[13px] font-medium text-slate-700 tabular-nums">{stt}</span>
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
                            );
                          })()}

                          {/* FROZEN 2: Product Type */}
                          {inboundColMap["product_type"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(inboundFreezeMap, "product_type", false);
                            return (
                              <EditableCell
                                table="inbound"
                                id={item.id}
                                field="product_type"
                                value={item.product_type}
                                display={<ProductTypeBadge type={item.product_type} />}
                                style={f.style}
                                className={`py-1.5 px-3 text-[13px] ${f.className}`}
                                inlineEditing={inlineEditing}
                                inlineSaving={inlineSaving}
                                onStartEdit={startInlineEdit}
                                onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                                onSave={handleSaveInlineCell}
                                onCancel={() => setInlineEditing(null)}
                                options={inboundProductTypes}
                              />
                            );
                          })()}

                          {/* FROZEN 3: Mockup */}
                          {inboundColMap["mockup"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(inboundFreezeMap, "mockup", false);
                            return (
                              <td
                                style={f.style}
                                className={`py-1 px-1 text-center ${f.className}`}
                              >
                                <MockupCell
                                  table="inbound"
                                  id={item.id}
                                  field="mockup"
                                  url={item.mockup}
                                  alt={item.sku}
                                  onPreview={(previewData) => setPreviewModal(previewData)}
                                  onSave={(tbl, id, fld, val) => handleSaveInlineCell(tbl, id, fld, val)}
                                  notify={notify}
                                />
                              </td>
                            );
                          })()}

                          {/* FROZEN 4: SKU */}
                          {inboundColMap["sku"]?.visible !== false && (() => {
                            const f = getCellFreezeProps(inboundFreezeMap, "sku", false);
                            return (
                              <EditableCell
                                table="inbound"
                                id={item.id}
                                field="sku"
                                value={item.sku}
                                display={
                                  <span className="font-bold text-slate-950 text-[13px] col-sku col-primary" style={{ fontWeight: 700 }}>
                                    {item.sku}
                                  </span>
                                }
                                style={{ ...f.style, fontWeight: 700 }}
                                className={`py-1.5 px-3 text-[13px] font-bold col-sku col-primary ${f.className}`}
                                inlineEditing={inlineEditing}
                                inlineSaving={inlineSaving}
                                onStartEdit={startInlineEdit}
                                onChangeValue={(val) => setInlineEditing((prev) => prev ? { ...prev, value: val } : null)}
                                onSave={handleSaveInlineCell}
                                onCancel={() => setInlineEditing(null)}
                                options={getColumnOptions("inbound", "sku")}
                              />
                            );
                          })()}

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

        {/* Pagination Bar 100/1 */}
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
          </>)} />
      </div>
    )}

      {/* TAB 3: CHECK SHIPMENT TABLE
          FROZEN COLUMNS: STT (left-0), Shipment ID (left-[58px]), Shipment Name (left-[218px]) */}
      {visitedTabs.check_shipment && (
        <div className={`rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col relative ${shownTab === "check_shipment" ? "" : "hidden"}`}>
          <FreezeWhenHidden active={shownTab === "check_shipment"} frozen={tabSwitchPending} render={() => (<>
          <AccountingTopProgressBar loading={loadingCheckShipments} variant="indigo" />
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-230px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
              <table ref={checkShipmentTableRef} className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-sm">
              <colgroup>
                {orderedVisibleCheckShipmentColumns.map((col) => (
                  <col key={col.id} style={{ width: getColumnWidth(col) }} />
                ))}
                <col style={{ width: 142 }} />
              </colgroup>
              <thead
                onPointerDown={(event) => handleHeaderResizePointerDown("check_shipment", ["stt", "shipment_id", "shipment_name", ...activeScrollableCheckShipmentColumns.map((column) => column.id)], event)}
                onClick={(event) => handleHeaderClick("check_shipment", ["stt", "shipment_id", "shipment_name", ...activeScrollableCheckShipmentColumns.map((column) => column.id)], event)}
                className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs"
              >
                <tr className="text-xs font-semibold uppercase tracking-[0.04em]">
                  {orderedVisibleCheckShipmentColumns.map((col) => renderCheckShipmentHeader(col))}

                  <th className="py-2 px-3 text-xs text-center bg-[#ff9900] text-slate-900 font-bold">Thao tác</th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-slate-200 transition-opacity duration-200 ${
                  loadingCheckShipments && sortedCheckShipments.length > 0 ? "opacity-60 pointer-events-none" : "opacity-100"
                }`}
              >
                {loadingCheckShipments && sortedCheckShipments.length === 0 ? (
                  <AccountingTableSkeletonRows rows={10} colSpan={checkShipmentVisibleCount + 1} />
                ) : sortedCheckShipments.length === 0 ? (
                  <tr>
                    <td colSpan={checkShipmentVisibleCount + 1} className="py-20 text-center text-slate-500 text-sm">
                      <BarcodeIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      Chưa có shipment nào trong Store {selectedStore?.name}. Nhấn <strong>Thêm Shipment</strong> hoặc <strong>Nhập Check Shipment</strong> để nạp dữ liệu.
                    </td>
                  </tr>
                ) : (
                  sortedCheckShipments.map((item, idx) => {
                    const stt = (checkShipmentPage - 1) * checkShipmentLimit + idx + 1;
                    return (
                      <tr
                        key={item.id}
                        className="inventory-row group h-[34px] min-h-[34px] bg-white even:bg-[#f8fafc] hover:bg-amber-50/60 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200"
                      >
                        {/* FROZEN 1: STT with Pencil Button aligned */}
                        {checkShipmentColMap["stt"]?.visible !== false && (() => {
                          const f = getCellFreezeProps(checkShipmentFreezeMap, "stt", false);
                          return (
                            <td
                              style={f.style}
                              className={`py-1.5 px-1 text-center text-[13px] font-medium text-slate-700 ${f.className}`}
                            >
                              <div className="flex items-center justify-between gap-1 w-full px-1">
                                <span className="w-5 text-center text-[13px] font-medium text-slate-700 tabular-nums">{stt}</span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditCheckShipment(item)}
                                  className="p-1 rounded text-slate-400 hover:text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                                  title="Sửa shipment này"
                                >
                                  <PencilSimpleIcon size={14} weight="bold" />
                                </button>
                              </div>
                            </td>
                          );
                        })()}

                        {/* FROZEN 2: Shipment ID */}
                        {checkShipmentColMap["shipment_id"]?.visible !== false && (() => {
                          const f = getCellFreezeProps(checkShipmentFreezeMap, "shipment_id", false);
                          return (
                            <EditableCell
                              table="check_shipment"
                              id={item.id}
                              field="shipment_id"
                              value={item.shipment_id}
                              display={
                                <span className="font-medium text-slate-900 text-[13px]">
                                  {item.shipment_id || "—"}
                                </span>
                              }
                              style={f.style}
                              className={`py-1.5 px-3 text-[13px] text-center ${f.className}`}
                              inlineEditing={inlineEditing}
                              inlineSaving={inlineSaving}
                              onStartEdit={startInlineEdit}
                              onChangeValue={(val) => setInlineEditing((prev) => (prev ? { ...prev, value: val } : null))}
                              onSave={handleSaveInlineCell}
                              onCancel={() => setInlineEditing(null)}
                              options={getColumnOptions("check_shipment", "shipment_id")}
                            />
                          );
                        })()}

                        {/* FROZEN 3: Shipment Name */}
                        {checkShipmentColMap["shipment_name"]?.visible !== false && (() => {
                          const f = getCellFreezeProps(checkShipmentFreezeMap, "shipment_name", false);
                          return (
                            <EditableCell
                              table="check_shipment"
                              id={item.id}
                              field="shipment_name"
                              value={item.shipment_name}
                              display={
                                <span className="font-semibold text-slate-900 text-[13px]">
                                  {safeDisplay(item.shipment_name)}
                                </span>
                              }
                              style={f.style}
                              className={`py-1.5 px-3 text-[13px] ${f.className}`}
                              inlineEditing={inlineEditing}
                              inlineSaving={inlineSaving}
                              onStartEdit={startInlineEdit}
                              onChangeValue={(val) => setInlineEditing((prev) => (prev ? { ...prev, value: val } : null))}
                              onSave={handleSaveInlineCell}
                              onCancel={() => setInlineEditing(null)}
                              options={getColumnOptions("check_shipment", "shipment_name")}
                            />
                          );
                        })()}

                        {/* SCROLLABLE DYNAMIC DATA CELLS */}
                        {activeScrollableCheckShipmentColumns.map((col) => renderCheckShipmentCell(col, item))}

                        {/* THAO TÁC: Sửa, Sao chép (Duplicate), Xóa */}
                        <td className="py-1.5 px-3 text-xs text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditCheckShipment(item)}
                              className="rounded-lg bg-indigo-50 border border-indigo-200 p-1 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                              title="Sửa thông tin shipment"
                            >
                              <PencilSimpleIcon size={16} weight="bold" />
                            </button>
                            <button
                              type="button"
                              disabled={duplicatingCheckShipmentId === item.id}
                              onClick={() => handleDuplicateCheckShipment(item)}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 p-1 text-emerald-700 hover:bg-emerald-100 transition cursor-pointer disabled:opacity-50"
                              title="Nhân bản (Sao chép) shipment lên dòng mới nhất để sửa"
                            >
                              {duplicatingCheckShipmentId === item.id ? (
                                <ArrowClockwiseIcon size={16} className="animate-spin" />
                              ) : (
                                <CopyIcon size={16} weight="bold" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCheckShipment(item.id, item.shipment_name || item.shipment_id || "")}
                              className="rounded-lg bg-rose-50 border border-rose-200 p-1 text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                              title="Xóa shipment"
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
          page={checkShipmentPage}
          totalPages={checkShipmentTotalPages}
          totalItems={checkShipmentTotal}
          limit={checkShipmentLimit}
          onPageChange={setCheckShipmentPage}
          onLimitChange={(l) => {
            setCheckShipmentLimit(l);
            setCheckShipmentPage(1);
          }}
          label="Shipment"
        />
          </>)} />
      </div>
    )}

      {/* TAB 4b: BASECOST THÁNG FBM (dữ liệu thô ĐẦU VÀO FBM PW) */}
      {shownTab === "monthly_base_cost" && baseCostChannel === "fbm" && selectedStoreId && (
        <div className="rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col flex-1 min-h-[580px]">
          <FbmPwCostView
            ref={fbmPwCostRef}
            storeId={selectedStoreId}
            storeName={selectedStore?.name}
            tableZoom={tableZoom}
            onOpenImport={openImportModal}
          />
        </div>
      )}

      {/* TAB 4: BASECOST THÁNG */}
      {visitedTabs.monthly_base_cost && (
        <div className={`rounded-xl border border-slate-300 bg-white shadow-2xs overflow-hidden flex flex-col flex-1 min-h-[580px] ${shownTab === "monthly_base_cost" && baseCostChannel !== "fbm" ? "" : "hidden"}`}>
          <FreezeWhenHidden active={shownTab === "monthly_base_cost" && baseCostChannel !== "fbm"} frozen={tabSwitchPending} render={() => (<>
          <MonthlyBaseCostView
            ref={monthlyBaseCostRef}
            storeId={selectedStoreId}
            storeName={selectedStore?.name}
            year={monthlyBaseCostYear}
            search={debouncedMonthlyBaseCostSearch}
            tableZoom={tableZoom}
            onYearChange={setMonthlyBaseCostYear}
            onSyncingChange={setSyncingMonthlyBaseCost}
            notify={notify}
            onOpenHistory={(sku) =>
              setHistoryDrawer({
                isOpen: true,
                entityType: "monthly_base_cost",
                entityTitle: sku,
              })
            }
            columns={monthlyBaseCostColumns}
            frozenThrough={frozenThrough.monthly_base_cost}
            onFreezeColumn={(colId) => setFrozenThroughColumn("monthly_base_cost", colId)}
            onResizeColumn={(colId, w) => resizeColumn("monthly_base_cost", colId, w)}
            onAutoFitColumn={(colId) => handleAutoFitColumn("monthly_base_cost", colId)}
            onReorderColumns={handleReorderMonthlyBaseCostColumns}
            onColumnContextMenu={(field, x, y) => setColumnContextMenu({ table: "monthly_base_cost", field, x, y })}
          />
          </>)} />
        </div>
      )}

      {/* MODAL 1: NHÂN VIÊN ĐIỀN THÊM PHÔI MỚI HOẶC SỬA PHÔI CŨ (SKU MASTER) */}
      {showSkuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            tabIndex={0}
            onPaste={async (e) => {
              const extracted = await extractImageFromClipboard(e, 280);
              if (extracted) {
                setSkuFormData((prev) => ({ ...prev, mockup_url: extracted }));
                notify("Đã tự động nén và dán ảnh Mockup!", "success");
              }
            }}
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4 outline-hidden"
          >
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
                        entityType: skuEntityType,
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
                  options={getColumnOptions("sku", "product_type")}
                />

                {/* Mockup Paste & Upload Zone with Auto-Downscaling */}
                <MockupPasteField
                  label="Ảnh Mockup Phôi SKU"
                  value={skuFormData.mockup_url}
                  onChange={(val) => setSkuFormData({ ...skuFormData, mockup_url: val })}
                  onPreview={(url) => setPreviewModal({ url })}
                  notify={notify}
                />

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
                    options={getColumnOptions("sku", "pic_mkt")}
                  />
                </div>

                {/* Loại */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Loại (FBA / FBM)</label>
                  <OptionTextInput
                    value={skuFormData.loai}
                    onChange={(val) => setSkuFormData({ ...skuFormData, loai: val })}
                    placeholder="Chọn loại fulfillment hoặc nhập mới..."
                    options={getColumnOptions("sku", "loai")}
                  />
                </div>

                {/* Niche */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Niche</label>
                  <OptionTextInput
                    placeholder="VD: Women, Men, Christmas..."
                    value={skuFormData.niche}
                    onChange={(val) => setSkuFormData({ ...skuFormData, niche: val })}
                    options={getColumnOptions("sku", "niche")}
                  />
                </div>

                {/* PIC Idea */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">PIC Idea</label>
                  <OptionTextInput
                    placeholder="VD: Loan, Cường..."
                    value={skuFormData.pic_idea}
                    onChange={(val) => setSkuFormData({ ...skuFormData, pic_idea: val })}
                    options={getColumnOptions("sku", "pic_idea")}
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Trạng thái</label>
                  <OptionTextInput
                    value={skuFormData.status}
                    onChange={(val) => setSkuFormData({ ...skuFormData, status: val })}
                    placeholder="Chọn trạng thái hoặc nhập mới..."
                    options={getColumnOptions("sku", "status")}
                  />
                </div>

                {/* Tình trạng */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Tình trạng phôi</label>
                  <OptionTextInput
                    placeholder="VD: Đang bán, Chuẩn bị bán..."
                    value={skuFormData.tinh_trang}
                    onChange={(val) => setSkuFormData({ ...skuFormData, tinh_trang: val })}
                    options={getColumnOptions("sku", "tinh_trang")}
                  />
                </div>

                {/* Event */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Event</label>
                  <OptionTextInput
                    placeholder="VD: Christmas, Mother's Day..."
                    value={skuFormData.event}
                    onChange={(val) => setSkuFormData({ ...skuFormData, event: val })}
                    options={getColumnOptions("sku", "event")}
                  />
                </div>

                {/* DESIGN PIC */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">DESIGN PIC</label>
                  <OptionTextInput
                    placeholder="VD: Designer Name"
                    value={skuFormData.design_pic}
                    onChange={(val) => setSkuFormData({ ...skuFormData, design_pic: val })}
                    options={getColumnOptions("sku", "design_pic")}
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
          <div
            tabIndex={0}
            onPaste={async (e) => {
              const extracted = await extractImageFromClipboard(e, 280);
              if (extracted) {
                setShipmentFormData((prev) => ({ ...prev, mockup: extracted }));
                notify("Đã tự động nén và dán ảnh Mockup!", "success");
              }
            }}
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4 outline-hidden"
          >
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
                    options={getColumnOptions("inbound", "sup")}
                  />
                </div>

                {/* Line ship */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Line Ship</label>
                  <OptionTextInput
                    placeholder="VD: AIR, SEA FAST..."
                    value={shipmentFormData.line_ship}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, line_ship: val })}
                    options={getColumnOptions("inbound", "line_ship")}
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
                  options={getColumnOptions("inbound", "product_type")}
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
                    options={getColumnOptions("inbound", "status")}
                  />
                </div>

                {/* Trạng thái */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Trạng thái</label>
                  <OptionTextInput
                    value={shipmentFormData.trang_thai}
                    onChange={(val) => setShipmentFormData({ ...shipmentFormData, trang_thai: val })}
                    placeholder="Chọn trạng thái hoặc nhập mới..."
                    options={getColumnOptions("inbound", "trang_thai")}
                  />
                </div>

                {/* Số lượng Amazon nhận */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-700">Số lượng Amazon nhận</label>
                    {shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star") && (
                      <span className="text-[10px] text-amber-600 font-medium">Lô STAR: Tự động bằng Quantity</span>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0"
                    placeholder="VD: 500"
                    value={
                      shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star")
                        ? (shipmentFormData.quantity || "")
                        : shipmentFormData.so_luong_amazon_nhan
                    }
                    disabled={shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star")}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, so_luong_amazon_nhan: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                {/* Discrepancy */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-700">Chênh lệch (Discrepancy)</label>
                    {shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star") && (
                      <span className="text-[10px] text-emerald-600 font-medium">Lô STAR: = 0</span>
                    )}
                  </div>
                  <input
                    type="number"
                    placeholder="VD: 0"
                    value={
                      shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star")
                        ? "0"
                        : shipmentFormData.discrepancy
                    }
                    disabled={shipmentFormData.shipment_id?.trim().toLowerCase().startsWith("star")}
                    onChange={(e) => setShipmentFormData({ ...shipmentFormData, discrepancy: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                {/* Mockup Paste & Upload Zone with Auto-Downscaling */}
                <MockupPasteField
                  label="Ảnh Mockup Đơn Hàng / Lô Hàng"
                  value={shipmentFormData.mockup}
                  onChange={(val) => setShipmentFormData({ ...shipmentFormData, mockup: val })}
                  onPreview={(url) => setPreviewModal({ url })}
                  notify={notify}
                />

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

      {/* MODAL CHECK SHIPMENT: THÊM / SỬA CHECK SHIPMENT */}
      {showCheckShipmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-700 text-white font-bold shadow-xs">
                  <BarcodeIcon size={20} weight="bold" />
                </span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {checkShipmentFormData.id ? "Cập Nhật Thông Tin Check Shipment" : "Thêm Mới Check Shipment"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Store: <strong className="text-indigo-700">{selectedStore?.name}</strong>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {checkShipmentFormData.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryDrawer({
                        isOpen: true,
                        entityType: "check_shipment",
                        entityId: checkShipmentFormData.id,
                        entityTitle: checkShipmentFormData.shipment_name || checkShipmentFormData.shipment_id || "Shipment",
                      });
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition flex items-center gap-1.5 cursor-pointer"
                    title="Xem lịch sử chỉnh sửa của shipment này"
                  >
                    <ClockCounterClockwiseIcon size={14} weight="bold" />
                    <span>Lịch sử</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowCheckShipmentModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                >
                  <XIcon size={20} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveCheckShipment} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* Shipment ID */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Shipment ID <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="VD: FBA18V8XXXX"
                    value={checkShipmentFormData.shipment_id}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, shipment_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Shipment Name */}
                <div className="space-y-1 md:col-span-2">
                  <label className="font-bold text-slate-700">Shipment Name</label>
                  <input
                    type="text"
                    placeholder="VD: FBA (10/08/2026 14:30)-1"
                    value={checkShipmentFormData.shipment_name}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, shipment_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Brand */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Brand</label>
                  <input
                    type="text"
                    placeholder="VD: LIMIMA"
                    value={checkShipmentFormData.brand}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, brand: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Ship to */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ship To</label>
                  <input
                    type="text"
                    placeholder="VD: ABE8, CLT2..."
                    value={checkShipmentFormData.ship_to}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, ship_to: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Status</label>
                  <select
                    value={checkShipmentFormData.status}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  >
                    {DEFAULT_CHECK_SHIPMENT_STATUS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ngày Update */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Ngày Update</label>
                  <input
                    type="date"
                    value={checkShipmentFormData.ngay_update}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, ngay_update: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Created Date */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Created Date</label>
                  <input
                    type="date"
                    value={checkShipmentFormData.created_date}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, created_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Last Updated Date */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Last Updated Date</label>
                  <input
                    type="date"
                    value={checkShipmentFormData.last_updated_date}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, last_updated_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* SKUs */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">SKUs (Số loại SKU)</label>
                  <input
                    type="number"
                    placeholder="VD: 1"
                    value={checkShipmentFormData.skus_count}
                    onChange={(e) => setCheckShipmentFormData({ ...checkShipmentFormData, skus_count: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Units Expected */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Units Expected</label>
                  <input
                    type="number"
                    placeholder="VD: 100"
                    value={checkShipmentFormData.units_expected}
                    onChange={(e) => {
                      const exp = e.target.value;
                      const loc = checkShipmentFormData.units_located;
                      const disc = loc !== "" && exp !== "" ? Number(loc) - Number(exp) : "";
                      setCheckShipmentFormData({
                        ...checkShipmentFormData,
                        units_expected: exp,
                        discrepancy: disc !== "" ? String(disc) : checkShipmentFormData.discrepancy,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>

                {/* Units Located */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Units Located</label>
                  <input
                    type="number"
                    placeholder="VD: 100"
                    value={checkShipmentFormData.units_located}
                    onChange={(e) => {
                      const loc = e.target.value;
                      const exp = checkShipmentFormData.units_expected;
                      const disc = loc !== "" && exp !== "" ? Number(loc) - Number(exp) : "";
                      setCheckShipmentFormData({
                        ...checkShipmentFormData,
                        units_located: loc,
                        discrepancy: disc !== "" ? String(disc) : checkShipmentFormData.discrepancy,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCheckShipmentModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingCheckShipment}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-800 transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  <FloppyDiskIcon size={16} weight="bold" />
                  <span>{savingCheckShipment ? "Đang lưu..." : checkShipmentFormData.id ? "Cập nhật Shipment" : "Lưu Shipment Mới"}</span>
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
                  {isFbmBaseCost ? "Nhập Basecost FBM" : isFbmSheet ? "Nhập Bảng Mã FBM" : "Nhập File Quản Lý Kho (Inventory)"}
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
              {isFbmBaseCost ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
                  <p className="font-semibold text-indigo-800">
                    Dán link Google Sheet KẾ TOÁN TỔNG HỢP FBM của Store {selectedStore?.name}.
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-600">
                    Hệ thống chép nguyên văn tab &quot;ĐẦU VÀO FBM PW&quot; (Order ID, PWOrderId, OrderName, NetPrice) vào Basecost FBM, không ghi gì vào các tab khác.
                  </p>
                </div>
              ) : isFbmSheet ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
                  <p className="font-semibold text-indigo-800">
                    Nhập riêng cho BẢNG MÃ FBM của Store {selectedStore?.name}.
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-600">
                    Tải file hoặc dán link Google Sheet. Hệ thống đọc tab &quot;FBM_&lt;Store&gt;&quot; và không ảnh hưởng Bảng Mã FBA hay các sheet khác.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
                  <p className="font-semibold text-indigo-800">
                    ⚡ Hệ thống tự động quét 1 lần toàn bộ file và phân bổ nạp đủ cho cả 4 sheet: BẢNG MÃ, CHI TIẾT ĐI HÀNG, CHECK SHIPMENT AMAZON, BASECOST THÁNG.
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-600">
                    Tiến trình chạy ngầm tiết kiệm RAM tuyệt đối, không đơ trình duyệt. Tiến độ và thông báo hoàn tất sẽ hiển thị ở góc trên bên phải màn hình.
                  </p>
                </div>
              )}

              {/* Basecost Tháng FBM chỉ nhập qua link Google Sheet (file kế toán tổng hợp rất nặng) */}
              {!isFbmBaseCost && (
              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 hover:border-indigo-400 hover:bg-indigo-50/20 transition cursor-pointer">
                <UploadSimpleIcon size={32} className="text-indigo-600 mb-2" weight="duotone" />
                <span className="text-sm font-bold text-slate-800 text-center">
                  Chọn file từ máy tính
                </span>
                <span className="text-xs text-slate-500 mt-1 text-center">
                  Hỗ trợ đọc nhiều file (.csv, .xlsx, .xls)
                </span>
                <input
                  type="file"
                  multiple
                  accept={activeTab === "check_shipment" ? ".csv, .xlsx, .xls" : ".xlsx, .xls"}
                  onChange={handleFileUpload}
                  disabled={importing}
                  className="hidden"
                />
              </label>
              )}

              {(isFbmSheet || isFbmBaseCost) && (
                <>
                  {!isFbmBaseCost && (
                  <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" />
                    hoặc
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  )}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700" htmlFor="fbm-sheet-url">
                      {isFbmBaseCost ? "Link Google Sheet Kế Toán Tổng Hợp FBM" : "Link Google Sheet"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="fbm-sheet-url"
                        type="url"
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleImportFromSheet();
                        }}
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        disabled={importing}
                        className="field-control flex-1"
                      />
                      <button
                        type="button"
                        onClick={handleImportFromSheet}
                        disabled={importing || !sheetUrl.trim()}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition disabled:opacity-50 cursor-pointer"
                      >
                        <UploadSimpleIcon size={14} weight="bold" />
                        <span>Nhập</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Link được lưu cho store và tự đồng bộ mỗi sáng {sheetLinksQuery.data?.schedule.hour ?? 4}:00 cùng Bảng Mã FBM. Hệ thống tự tìm tab{" "}
                      {isFbmBaseCost ? <>&quot;ĐẦU VÀO FBM PW&quot;</> : <>&quot;FBM_&lt;Store&gt;&quot;</>}. Sheet cần chia sẻ quyền <strong>Người xem</strong> cho:
                    </p>
                    {sheetLinksQuery.data?.service_account_email ? (
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                        <code className="min-w-0 flex-1 truncate text-[11px] text-slate-800">{sheetLinksQuery.data.service_account_email}</code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(sheetLinksQuery.data?.service_account_email || "");
                            notify("Đã copy email để chia sẻ sheet!", "success");
                          }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                        >
                          <CopyIcon size={13} weight="bold" />
                          Copy
                        </button>
                      </div>
                    ) : sheetLinksQuery.isFetched ? (
                      <p className="text-[11px] font-semibold text-rose-600">Chưa cấu hình Google service account trên server.</p>
                    ) : null}
                  </div>
                </>
              )}

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
                  {selectedShipmentDetail.so_luong_amazon_nhan != null
                    ? selectedShipmentDetail.so_luong_amazon_nhan.toLocaleString()
                    : (selectedShipmentDetail.amazon_received?.toLocaleString() ?? "—")}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Chênh lệch</span>
                <p className="font-bold text-rose-600">
                  {selectedShipmentDetail.discrepancy != null ? selectedShipmentDetail.discrepancy : "—"}
                </p>
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
        title={
          activeTab === "sku"
            ? skuSheetLabel.toUpperCase()
            : activeTab === "inbound"
            ? "CHI TIẾT ĐI HÀNG"
            : activeTab === "check_shipment"
            ? "CHECK SHIPMENT"
            : "BASECOST THÁNG"
        }
        columns={
          activeTab === "sku"
            ? skuColumns
            : activeTab === "inbound"
            ? inboundColumns
            : activeTab === "check_shipment"
            ? checkShipmentColumns
            : monthlyBaseCostColumns
        }
        onSave={
          activeTab === "sku"
            ? handleSaveSkuColumns
            : activeTab === "inbound"
            ? handleSaveInboundColumns
            : activeTab === "check_shipment"
            ? handleSaveCheckShipmentColumns
            : handleSaveMonthlyBaseCostColumns
        }
        onReset={
          activeTab === "sku"
            ? handleResetSkuColumns
            : activeTab === "inbound"
            ? handleResetInboundColumns
            : activeTab === "check_shipment"
            ? handleResetCheckShipmentColumns
            : handleResetMonthlyBaseCostColumns
        }
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
        showFbm={storeHasFbm}
        onRestored={() => {
          fetchSkus();
          fetchShipments();
          fetchCheckShipments();
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
                  Đã xóa {undoDelete.entityType === "sku" ? "SKU" : undoDelete.entityType === "inbound" ? "lô hàng" : "shipment"}:{" "}
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

      {/* MODAL PREVIEW MOCKUP ẢNH MỜ (BLURRY BACKDROP PREVIEW, CÓ NÚT THAY ẢNH / DÁN ẢNH) */}
      {previewModal && (
        <div
          role="dialog"
          aria-modal="true"
          tabIndex={0}
          onPaste={async (e) => {
            if (!previewModal.table || !previewModal.id || !previewModal.field) return;
            const extracted = await extractImageFromClipboard(e, 240);
            if (!extracted) return;
            setIsUpdatingPreviewMockup(true);
            try {
              const downscaled = await downscaleImage(extracted, 240, 0.82);
              await handleSaveInlineCell(previewModal.table, previewModal.id, previewModal.field, downscaled);
              setPreviewModal((prev) => (prev ? { ...prev, url: downscaled } : null));
              notify("Đã thay và tự động nén ảnh Mockup mới thành công!", "success");
            } catch (err) {
              notify("Lỗi khi thay ảnh: " + (err as Error).message, "error");
            } finally {
              setIsUpdatingPreviewMockup(false);
            }
          }}
          onClick={() => {
            if (!isUpdatingPreviewMockup) setPreviewModal(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200 cursor-zoom-out outline-hidden"
        >
          <input
            ref={previewFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !previewModal.table || !previewModal.id || !previewModal.field) return;
              setIsUpdatingPreviewMockup(true);
              try {
                const downscaled = await downscaleImage(file, 240, 0.82);
                await handleSaveInlineCell(previewModal.table, previewModal.id, previewModal.field, downscaled);
                setPreviewModal((prev) => (prev ? { ...prev, url: downscaled } : null));
                notify("Đã cập nhật ảnh Mockup mới thành công!", "success");
              } catch (err) {
                notify("Lỗi khi cập nhật ảnh: " + (err as Error).message, "error");
              } finally {
                setIsUpdatingPreviewMockup(false);
                if (previewFileInputRef.current) previewFileInputRef.current.value = "";
              }
            }}
          />

          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl w-full p-4 bg-white/95 rounded-2xl shadow-2xl border border-white/20 flex flex-col items-center cursor-default overflow-hidden animate-in zoom-in-95 duration-150"
          >
            {/* Header toolbar */}
            <div className="w-full flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 truncate">
                <span className="font-black text-sm text-slate-800">Mockup Preview</span>
                {previewModal.title && (
                  <span className="text-xs text-slate-500 truncate max-w-[280px]">
                    ({previewModal.title})
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 transition cursor-pointer"
                title="Đóng preview (Esc)"
              >
                <XIcon size={18} weight="bold" />
              </button>
            </div>

            {/* Image display */}
            <div className="relative flex items-center justify-center w-full min-h-[220px] max-h-[70vh] my-3 overflow-hidden rounded-xl bg-slate-100">
              {isUpdatingPreviewMockup ? (
                <div className="flex flex-col items-center justify-center gap-2 p-8 text-indigo-600">
                  <ArrowClockwiseIcon size={28} weight="bold" className="animate-spin" />
                  <span className="text-xs font-bold text-slate-600">Đang nén WebP và cập nhật...</span>
                </div>
              ) : previewModal.url ? (
                <img
                  src={getOptimizedThumbnailUrl(previewModal.url) || previewModal.url}
                  alt={previewModal.title || "Mockup Preview"}
                  className="max-w-full max-h-[65vh] object-contain rounded-lg"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 p-10 text-slate-400">
                  <ImageSquareIcon size={44} weight="duotone" />
                  <span className="text-xs font-medium">Chưa có ảnh mockup</span>
                </div>
              )}
            </div>

            {/* Bottom Actions toolbar */}
            <div className="w-full flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
              <div className="flex items-center gap-2 truncate text-slate-500">
                {previewModal.table ? (
                  <span className="text-[11px] text-slate-400">Ấn <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px] text-slate-700 font-bold">Ctrl + V</kbd> để dán ảnh mới</span>
                ) : (
                  <span className="truncate max-w-[260px] text-[11px] font-mono">{previewModal.url}</span>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto shrink-0">
                {/* Nút THAY ẢNH - chỉ xuất hiện khi ấn vào ảnh trong bảng */}
                {previewModal.table && previewModal.id && previewModal.field && (
                  <button
                    type="button"
                    disabled={isUpdatingPreviewMockup}
                    onClick={() => previewFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 active:scale-95 transition shadow-xs cursor-pointer"
                    title="Chọn file ảnh từ máy hoặc dán ảnh (Ctrl+V)"
                  >
                    <CameraIcon size={15} weight="bold" />
                    <span>Thay ảnh</span>
                  </button>
                )}

                {previewModal.url && (
                  <a
                    href={previewModal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold transition"
                  >
                    <span>Mở link gốc</span>
                    <ArrowSquareOutIcon size={14} weight="bold" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {fieldEditor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 animate-in fade-in duration-150" onClick={() => setFieldEditor(null)}>
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
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => setFieldEditor(null)} className="rounded-lg px-3 py-2 font-bold text-slate-600">Hủy</button><button type="button" onClick={saveFieldEditor} className="rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white">Lưu</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
