/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsDownUpIcon,
  CaretRightIcon,
  CheckIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { storeCanEdit, storeCanView } from "@/lib/accounting/store-teams";
import type { StoreAccessInfo } from "@/lib/accounting/types";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import { AccountingTopProgressBar, AccountingViewTransition, AnimatedTabPill } from "./accounting-skeleton";

// Tab KQKD — tham khảo file "BÁO CÁO KQKD SKU TESTING" (tab Tổng quan tháng + SKU TESTING).

interface Store {
  id: string;
  name: string;
  team?: string;
  access?: StoreAccessInfo;
}

interface MonthCell {
  revenue: number;
  quantity: number;
  ads_fee: number;
  profit: number;
}

interface KqkdSku {
  id: string;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  status: string | null;
  pic_idea: string | null;
  pic_mkt?: string | null;
  design_pic?: string | null;
  ton_kho?: number | null;
  ton_kho_updated_at?: string | null;
  listing_month: string;
  eval_month: string | null;
  von_hang: number;
  qty_di: number;
  unit_cost: number | null;
  revenue: number;
  quantity: number;
  ads_fee: number;
  profit: number;
  months: Record<string, MonthCell>;
}

// SKU listing năm trước, tháng đánh giá thuộc năm đang xem — chỉ vào phần "Đánh giá SKU WIN"
type KqkdEvalSku = Pick<KqkdSku, "sku" | "product_type" | "status" | "pic_idea" | "pic_mkt" | "design_pic" | "listing_month" | "eval_month">;

interface KqkdData {
  year: number;
  months: { month: string; source: "closed" | "live" }[];
  skus: KqkdSku[];
  evalSkus?: KqkdEvalSku[];
  winResults: { eval_month: string; product_type: string; win_count: number; updated_by: string | null; updated_at: string }[];
  generatedAt: string;
}

type ViewMode = "overview" | "skus";
type Metric = "revenue" | "quantity" | "ads_fee" | "tacos" | "profit" | "roi";

// Sheet: Mục tiêu SKU WIN = 40% × số SKU đánh giá
const WIN_TARGET_RATE = 0.4;
const SHOW_MONTH_COLS = false;
// Trạng thái Bảng mã của SKU đã WIN — dùng để gợi ý số WIN cho team
const WIN_STATUS = "phát triển";
const LOSS_STATUS = "hủy";

const MONTHS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "quantity", label: "Quantity" },
  { key: "ads_fee", label: "Ads Fee" },
  { key: "tacos", label: "TAcos" },
  { key: "profit", label: "Profit" },
  { key: "roi", label: "ROI" },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US");
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtUsd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return usd.format(v);
}
function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtInt(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return int.format(v);
}
function fmtTarget(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function ratio(num: number, den: number) {
  return den ? num / den : null;
}
// "YYYY-MM" + n tháng
function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// Sheet SKU TESTING cột "Thời gian đánh giá": tháng listing + 3 → + 4 (đánh giá sau 3, muộn nhất 4 tháng).
// Tô đỏ khi đã đến hạn (tháng thứ 3–4) hoặc quá hạn — so theo YYYY-MM để qua năm vẫn đúng.
function evalWindow(listingMonth: string) {
  const from = addMonths(listingMonth, 3);
  const to = addMonths(listingMonth, 4);
  return { from, to, label: `Tháng ${monthNum(from)} - Tháng ${monthNum(to)}` };
}

// Trạng thái ô "Thời gian đánh giá" của 1 SKU:
// done = đã đánh giá (Bảng mã đã chốt Phát triển / Hủy) → nền nhạt
// late = chưa đánh giá mà đã qua tháng thứ 4 · due = đang trong tháng thứ 3–4 · soon = tháng sau bắt đầu đến hạn → đỏ tươi
// later = còn xa → hồng nhạt
type EvalState = "done" | "late" | "due" | "soon" | "later";
function evalState(s: KqkdSku, currentMonth: string): EvalState {
  if (statusKind(s.status) !== "test") return "done";
  const w = evalWindow(s.listing_month);
  if (w.to < currentMonth) return "late";
  if (w.from <= currentMonth) return "due";
  if (w.from === addMonths(currentMonth, 1)) return "soon";
  return "later";
}
const EVAL_STATE_LABEL: Record<EvalState, string> = {
  done: "đã đánh giá",
  late: "quá hạn, chưa đánh giá",
  due: "đến hạn đánh giá",
  soon: "sắp đến hạn (tháng sau)",
  later: "chưa đến hạn",
};
// Cần đánh giá ngay = chưa đánh giá mà đã tới tháng đánh giá (tháng thứ 3–4) hoặc quá hạn → đỏ đậm
const needsEval = (st: EvalState) => st === "late" || st === "due";

// Ô Profit âm: tô đỏ cả ô cho dễ thấy SKU / tháng lỗ
const NEG_CELL = "!bg-[#FF0000] !text-slate-950 !font-bold";
// Ô Hoàn vốn khi đã thu về nhiều hơn Tổng vốn hàng: tô xanh cả ô
const POS_CELL = "!bg-[#83C75D] !text-slate-950 !font-normal";
// Hai cột Tổng vốn hàng / Hoàn vốn: nền vàng (như sheet) để dễ so với nhau
const YELLOW_CELL = "!bg-[#FACE9C]";
// Cột Profit (SKU Testing): vàng rất nhạt
const PROFIT_CELL = "!bg-[#FFF9DB]";
// Ô Trạng thái tô như sheet: Phát triển xanh lá · Test vàng nhạt · Hủy đỏ
function statusCellClass(status: string | null) {
  const s = (status || "").trim().toLowerCase();
  if (s === WIN_STATUS) return POS_CELL;
  if (s === "test") return "!bg-[#FFF2CC] !text-slate-950";
  if (s === LOSS_STATUS) return "!bg-[#FF0000] !text-slate-950";
  return "";
}

function monthNum(period: string) {
  return Number(period.slice(5, 7));
}
function monthLabel(period: string) {
  return `T${monthNum(period)}/${period.slice(0, 4)}`;
}
function statusKind(status: string | null) {
  const s = (status || "").trim().toLowerCase();
  return s === WIN_STATUS ? "win" : s === LOSS_STATUS ? "loss" : "test";
}
function signClass(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return "";
  return v > 0 ? "" : "!text-red-600";
}

// Basecost = giá vốn lô × đã bán · ROI = Profit / Basecost · Hoàn vốn = Basecost + Profit (tiền vốn đã thu về)
function derive(s: KqkdSku) {
  const basecost = s.unit_cost != null ? s.unit_cost * s.quantity : 0;
  const hoanVon = basecost + s.profit;
  return {
    basecost,
    tacos: ratio(-s.ads_fee, s.revenue),
    roi: ratio(s.profit, basecost),
    hoanVon,
    hoanVonPct: ratio(hoanVon, s.von_hang),
    // Tồn = tồn kho mới nhất hệ thống đang tính (Inventory Ledger FBA + AWD). Chưa có dữ liệu tồn → null (để trống)
    ton: s.ton_kho ?? null,
  };
}

// Sắp xếp bảng SKU Testing: key = tên cột, hoặc "m|YYYY-MM|metric" cho cột theo tháng
type SortState = { key: string; dir: "asc" | "desc" } | null;
const TEXT_SORT_KEYS = new Set(["sku", "product_type", "status", "pic_idea", "listing_month", "eval_month", "eval_window"]);

function sortValue(s: KqkdSku, key: string): string | number | null {
  if (key.startsWith("m|")) {
    const [, month, mt] = key.split("|");
    return cellMetric(s.months[month], mt as Metric, s.unit_cost);
  }
  const d = derive(s);
  switch (key) {
    case "sku":
      return s.sku;
    case "product_type":
      return s.product_type || null;
    case "status":
      return s.status || null;
    case "pic_idea":
      return s.pic_idea?.trim() || null;
    case "listing_month":
      return s.listing_month;
    case "eval_window":
      return addMonths(s.listing_month, 3);
    case "eval_month":
      return s.eval_month;
    case "von_hang":
      return s.von_hang;
    case "revenue":
      return s.revenue;
    case "quantity":
      return s.quantity;
    case "basecost":
      return d.basecost;
    case "ads_fee":
      return s.ads_fee;
    case "tacos":
      return d.tacos;
    case "profit":
      return s.profit;
    case "roi":
      return d.roi;
    case "hoanVon":
      return d.hoanVon;
    case "hoanVonPct":
      return d.hoanVonPct;
    case "qty_di":
      return s.qty_di;
    case "ton":
      return d.ton;
    default:
      return null;
  }
}

// Tiêu đề cột bấm được để sắp xếp: lần 1 giảm dần (chữ: A→Z), lần 2 đảo chiều, lần 3 bỏ sắp xếp
function SortTh({
  k,
  sort,
  onSort,
  className,
  align = "right",
  rowSpan,
  children,
}: {
  k: string;
  rowSpan?: number;
  sort: SortState;
  onSort: (k: string) => void;
  className: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const active = sort?.key === k;
  const Icon = !active ? ArrowsDownUpIcon : sort.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <th rowSpan={rowSpan} className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        title="Bấm để sắp xếp"
        className={`group/sort inline-flex w-full cursor-pointer select-none items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{children}</span>
        <Icon
          size={11}
          weight="bold"
          className={`shrink-0 transition-all duration-150 ${active ? "text-blue-600" : "opacity-0 group-hover/sort:opacity-50"}`}
        />
      </button>
    </th>
  );
}

// ===== Lọc kiểu Excel trên tiêu đề cột (bảng SKU Testing) =====
// Bấm tên cột → hộp lọc: sắp xếp, tìm, tích chọn từng giá trị đang có trong cột (kèm số dòng).
// Danh sách giá trị của 1 cột tính trên các dòng đã qua bộ lọc của CÁC CỘT KHÁC (giống Excel).
// Bộ lọc lưu tập giá trị được chọn theo đúng chữ hiển thị trong ô; không có key = không lọc cột đó.
type ColFilters = Record<string, Set<string>>;
const BLANK = "(Trống)";
const USD_KEYS = new Set(["von_hang", "revenue", "basecost", "ads_fee", "profit", "hoanVon"]);
const INT_KEYS = new Set(["quantity", "qty_di", "ton"]);
const PCT_KEYS = new Set(["tacos", "roi", "hoanVonPct"]);

function filterLabel(s: KqkdSku, key: string, year: number): string {
  switch (key) {
    case "listing_month":
      return monthLabel(s.listing_month);
    case "eval_month":
      return s.eval_month ? monthLabel(s.eval_month) : BLANK;
    case "eval_window": {
      const w = evalWindow(s.listing_month);
      const y = w.from.slice(0, 4);
      return y !== String(year) ? `${w.label} (${y})` : w.label;
    }
  }
  const v = sortValue(s, key);
  if (v == null || v === "") return BLANK;
  if (typeof v === "string") return v.trim() || BLANK;
  const out = USD_KEYS.has(key) ? fmtUsd(v) : INT_KEYS.has(key) ? fmtInt(v) : PCT_KEYS.has(key) ? fmtPct(v) : String(v);
  return out || BLANK;
}

function passesColFilters(s: KqkdSku, filters: ColFilters, year: number, except?: string) {
  for (const k in filters) {
    if (k !== except && !filters[k].has(filterLabel(s, k, year))) return false;
  }
  return true;
}

type FilterOption = { label: string; count: number };
type FilterOpen = { key: string; title: string; rect: DOMRect };

// Tiêu đề cột: bấm mở hộp lọc; mũi tên = đang sắp xếp, phễu xanh đặc = đang lọc
function FilterTh({
  k,
  sort,
  filters,
  onOpen,
  className,
  align = "right",
  children,
}: {
  k: string;
  sort: SortState;
  filters: ColFilters;
  onOpen: (k: string, th: HTMLElement) => void;
  className: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const dir = sort?.key === k ? sort.dir : null;
  const filtered = k in filters;
  return (
    <th className={className} aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={(e) => onOpen(k, e.currentTarget.closest("th") as HTMLElement)}
        title="Bấm để lọc / sắp xếp"
        className={`group/f inline-flex w-full cursor-pointer select-none items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{children}</span>
        {dir && (dir === "asc" ? <ArrowUpIcon size={11} weight="bold" className="shrink-0 text-blue-800" /> : <ArrowDownIcon size={11} weight="bold" className="shrink-0 text-blue-800" />)}
        <FunnelSimpleIcon
          size={12}
          weight={filtered ? "fill" : "bold"}
          className={`shrink-0 transition-opacity duration-150 ${filtered ? "text-blue-800" : "opacity-40 group-hover/f:opacity-90"}`}
        />
      </button>
    </th>
  );
}

function ColumnFilterPopover({
  open,
  options,
  selected,
  sortDir,
  textSort,
  onSort,
  onApply,
  onClose,
}: {
  open: FilterOpen;
  options: FilterOption[];
  selected: Set<string> | undefined;
  sortDir: "asc" | "desc" | null;
  textSort: boolean;
  onSort: (dir: "asc" | "desc") => void;
  onApply: (next: Set<string> | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set(options.filter((o) => !selected || selected.has(o.label)).map((o) => o.label))
  );
  const ref = useRef<HTMLDivElement>(null);

  // Đóng khi bấm ra ngoài, Esc, cuộn trang/bảng hoặc đổi cỡ cửa sổ (hộp đặt theo vị trí tiêu đề lúc mở)
  useEffect(() => {
    const inside = (t: EventTarget | null) => !!ref.current && t instanceof Node && ref.current.contains(t);
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const visible = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;
  const checkedVisible = visible.filter((o) => draft.has(o.label)).length;

  const setMany = (labels: string[], on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev);
      for (const l of labels) {
        if (on) next.add(l);
        else next.delete(l);
      }
      return next;
    });
  const toggle = (label: string) => setMany([label], !draft.has(label));

  // Đang tìm: chỉ giữ các giá trị khớp từ khoá và được tích (như Excel). Tích đủ mọi giá trị = bỏ lọc cột.
  const apply = () => {
    const next = term ? new Set(visible.filter((o) => draft.has(o.label)).map((o) => o.label)) : draft;
    onApply(options.every((o) => next.has(o.label)) ? null : next);
  };
  const canApply = (term ? checkedVisible : draft.size) > 0;

  const W = 290;
  const left = Math.max(8, Math.min(open.rect.left, window.innerWidth - W - 8));
  const top = Math.min(open.rect.bottom + 4, window.innerHeight - 200);

  const sortBtn = (dir: "asc" | "desc", label: string) => (
    <button
      type="button"
      onClick={() => onSort(dir)}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-100 ${sortDir === dir ? "font-semibold text-blue-700" : "text-slate-800"}`}
    >
      {dir === "asc" ? <ArrowUpIcon size={13} weight="bold" /> : <ArrowDownIcon size={13} weight="bold" />}
      {label}
      {sortDir === dir && <CheckIcon size={13} weight="bold" className="ml-auto" />}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Lọc cột ${open.title}`}
      style={{ left, top, width: W }}
      className="animate-in fade-in zoom-in-95 fixed z-[200] flex max-h-[min(560px,calc(100vh-24px))] flex-col rounded-xl border border-slate-200 bg-white p-2 font-sans shadow-xl duration-100"
    >
      <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{open.title}</div>
      {sortBtn("asc", textSort ? "Sắp xếp A → Z" : "Sắp xếp nhỏ → lớn")}
      {sortBtn("desc", textSort ? "Sắp xếp Z → A" : "Sắp xếp lớn → nhỏ")}
      <div className="my-1.5 h-px bg-slate-200" />
      {selected && (
        <button
          type="button"
          onClick={() => onApply(null)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-800 hover:bg-slate-100"
        >
          <XIcon size={13} weight="bold" className="text-rose-600" />
          Xoá bộ lọc cột này
        </button>
      )}
      <div className="px-2.5 pb-1 pt-1 text-[13px] font-semibold text-slate-800">Lọc theo giá trị</div>
      <div className="flex items-center justify-between px-2.5 pb-1.5 text-xs">
        <span>
          <button type="button" onClick={() => setMany(visible.map((o) => o.label), true)} className="cursor-pointer text-blue-700 underline-offset-2 hover:underline">
            Chọn tất cả {visible.length}
          </button>
          <span className="text-slate-400"> - </span>
          <button type="button" onClick={() => setMany(visible.map((o) => o.label), false)} className="cursor-pointer text-blue-700 underline-offset-2 hover:underline">
            Xóa
          </button>
        </span>
        <span className="text-slate-500">Đang hiển thị {visible.length}</span>
      </div>
      <div className="relative mx-1 mb-1.5">
        <MagnifyingGlassIcon size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canApply) apply();
          }}
          placeholder="Tìm giá trị..."
          className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-2.5 pr-7 text-xs text-slate-800 outline-hidden focus:border-blue-500"
        />
      </div>
      <div className="mx-1 min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 py-1 scrollbar-thin" style={{ maxHeight: 260 }}>
        {visible.length === 0 && <div className="px-3 py-3 text-center text-xs text-slate-400">Không có giá trị khớp</div>}
        {visible.map((o) => {
          const on = draft.has(o.label);
          return (
            <label key={o.label} className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[13px] text-slate-800 hover:bg-slate-50">
              <input type="checkbox" checked={on} onChange={() => toggle(o.label)} className="h-3.5 w-3.5 cursor-pointer accent-emerald-700" />
              <span className={`min-w-0 flex-1 truncate ${o.label === BLANK ? "italic text-slate-500" : ""}`} title={o.label}>
                {o.label}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{o.count}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end gap-2 px-1">
        <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-lg border border-slate-300 px-4 text-xs font-semibold text-emerald-800 hover:bg-slate-50">
          Hủy
        </button>
        <button
          type="button"
          disabled={!canApply}
          onClick={apply}
          className="h-8 cursor-pointer rounded-lg bg-emerald-800 px-5 text-xs font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          OK
        </button>
      </div>
    </div>,
    document.body
  );
}

function cellMetric(c: MonthCell | undefined, metric: Metric, unitCost: number | null): number | null {
  if (!c) return null;
  switch (metric) {
    case "revenue":
      return c.revenue;
    case "quantity":
      return c.quantity;
    case "ads_fee":
      return c.ads_fee;
    case "profit":
      return c.profit;
    case "tacos":
      return ratio(-c.ads_fee, c.revenue);
    case "roi":
      return unitCost ? ratio(c.profit, c.quantity * unitCost) : null;
  }
}
function fmtMetric(v: number | null, metric: Metric) {
  if (v == null) return "";
  if (metric === "quantity") return fmtInt(v);
  if (metric === "tacos" || metric === "roi") return fmtPct(v);
  return fmtUsd(v);
}

// Ô "SKU WIN thực tế" (team điền): lưu khi rời ô / Enter; trống = chưa điền. Placeholder = số SKU "Phát triển" trong Bảng mã.
function WinInput({
  value,
  max,
  suggest,
  disabled,
  saving,
  onCommit,
}: {
  value: number | null;
  max: number;
  suggest: number;
  disabled: boolean;
  saving: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const reset = () => setDraft(value == null ? "" : String(value));
  const commit = () => {
    const t = draft.trim();
    const next = t === "" ? null : Number.parseInt(t, 10);
    if (next != null && (!Number.isFinite(next) || next < 0 || next > max)) return reset();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      value={draft}
      placeholder={disabled ? "" : String(suggest)}
      disabled={disabled || saving}
      aria-label="SKU WIN thực tế"
      title={disabled ? undefined : `Tối đa ${max}. Gợi ý ${suggest} = số SKU trạng thái Phát triển`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          reset();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-14 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs outline-hidden placeholder:italic placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-200 transition-all duration-150 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent ${
        saving ? "opacity-60 animate-pulse" : ""
      }`}
    />
  );
}

const C_TARGET = "#bfdbfe";
const C_WIN = "#2563eb";
const C_GOOD = "#16a34a";
const C_TEST = "#f59e0b";

// Kết quả SKU WIN theo tháng đánh giá: cột Mục tiêu cạnh cột WIN thực tế (một trục = số SKU), % WIN ghi trên cột.
function WinChart({
  items,
}: {
  items: {
    month: number;
    target: number | null;
    win: number | null;
    rate: number | null;
    note?: string;
    tip: string;
    n?: number;
    doneN?: number;
  }[];
}) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.target ?? 0, i.win ?? 0)));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs transition-all duration-200 hover:shadow-xs">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-slate-800">SKU WIN theo tháng</span>
        <span className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm transition-transform duration-200 hover:scale-125" style={{ background: C_TARGET }} /> Mục tiêu
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm transition-transform duration-200 hover:scale-125" style={{ background: C_WIN }} /> WIN thực tế
          </span>
        </span>
      </figcaption>
      <div className="relative mt-6 h-28 border-b border-slate-200">
        <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
          <div className="border-t border-dashed border-slate-100" />
          <div className="border-t border-dashed border-slate-100" />
          <div />
        </div>
        <div className="absolute inset-0 flex">
          {items.map((it) => (
            <div key={it.month} aria-label={it.tip} className="group/bar relative flex h-full flex-1 items-end justify-center gap-[3px] rounded-t-sm transition-colors duration-150 hover:bg-slate-100/70">
              {/* Hộp số liệu khi rê chuột: số SKU đánh giá, mục tiêu, WIN thực tế */}
              <div
                className={`pointer-events-none absolute bottom-full z-30 mb-2 w-max min-w-[168px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11.5px] opacity-0 shadow-lg transition-all duration-150 translate-y-1 group-hover/bar:translate-y-0 group-hover/bar:opacity-100 ${
                  it.month <= 2 ? "left-0" : it.month >= 11 ? "right-0" : "left-1/2 -translate-x-1/2"
                }`}
              >
                <div className="mb-1 font-bold text-slate-800">Tháng {it.month}</div>
                {it.n ? (
                  <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                    <dt className="text-slate-500">SKU đánh giá</dt>
                    <dd className="text-right font-mono font-semibold tabular-nums text-slate-900">{it.n}</dd>
                    {it.target != null && (
                      <>
                        <dt className="flex items-center gap-1.5 text-slate-500">
                          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: C_TARGET }} />
                          Mục tiêu
                        </dt>
                        <dd className="text-right font-mono font-semibold tabular-nums text-slate-900">{fmtTarget(it.target)} SKU</dd>
                        <dt className="flex items-center gap-1.5 text-slate-500">
                          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: C_WIN }} />
                          WIN thực tế
                        </dt>
                        <dd className="text-right font-mono font-semibold tabular-nums text-slate-900">
                          {it.win != null ? `${it.win}/${it.doneN ?? it.n} SKU` : <span className="font-sans font-normal text-amber-700">chưa điền</span>}
                        </dd>
                      </>
                    )}
                    {it.rate != null && (
                      <>
                        <dt className="text-slate-500">Tỉ lệ WIN</dt>
                        <dd className={`text-right font-mono font-bold tabular-nums ${it.rate >= WIN_TARGET_RATE ? "text-emerald-700" : "text-slate-900"}`}>{fmtPct(it.rate)}</dd>
                      </>
                    )}
                    {it.note && <dd className="col-span-2 text-slate-400">{it.note}</dd>}
                    {it.doneN != null && it.doneN < it.n && it.win != null && (
                      <dd className="col-span-2 text-amber-700">{it.n - it.doneN} SKU chưa điền</dd>
                    )}
                  </dl>
                ) : (
                  <div className="text-slate-400">Không có SKU đánh giá</div>
                )}
              </div>
              {(it.rate != null || it.note) && (
                <span
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] transition-transform duration-200 group-hover/bar:scale-105 ${it.rate != null ? "font-semibold text-slate-800" : "text-slate-400"}`}
                  style={{ bottom: `calc(${h(Math.max(it.target ?? 0, it.win ?? 0))} + 4px)` }}
                >
                  {it.rate != null ? fmtPct(it.rate) : it.note}
                </span>
              )}
              {it.target != null && (
                <div
                  className="w-[40%] max-w-7 rounded-t-[3px] transition-[height] duration-500 ease-out group-hover/bar:brightness-95"
                  style={{ height: h(it.target), background: C_TARGET }}
                />
              )}
              {it.target != null && (
                <div
                  className="w-[40%] max-w-7 rounded-t-[3px] transition-[height] duration-500 ease-out group-hover/bar:brightness-110"
                  style={{ height: it.win ? h(it.win) : "0", background: C_WIN }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex pt-1">
        {items.map((it) => (
          <span key={it.month} className="flex-1 text-center text-[11px] text-slate-500 font-medium transition-colors duration-150 hover:text-slate-900">
            T{it.month}
          </span>
        ))}
      </div>
    </figure>
  );
}

// Trạng thái SKU (Bảng mã): WIN = Phát triển · Đang test · Hủy
function StatusDonut({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  const segs = parts.map((p, i) => {
    const len = total ? (p.n / total) * C : 0;
    const offset = parts.slice(0, i).reduce((a, q) => a + (total ? (q.n / total) * C : 0), 0);
    return { ...p, len, offset };
  });
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs transition-all duration-200 hover:shadow-xs">
      <figcaption className="text-[13px] font-bold text-slate-800">Trạng thái SKU ({total})</figcaption>
      <div className="mt-2 flex items-center gap-6">
        <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label="Trạng thái SKU">
          <circle cx={55} cy={55} r={R} fill="none" stroke="#f1f5f9" strokeWidth={16} />
          {segs.map((p) => (
            <circle
              key={p.label}
              cx={55}
              cy={55}
              r={R}
              fill="none"
              stroke={p.color}
              strokeWidth={16}
              strokeDasharray={`${Math.max(0, p.len - 1.5)} ${C}`}
              strokeDashoffset={-p.offset}
              className="transition-all duration-500 ease-out hover:opacity-80 cursor-pointer"
            >
              <title>{`${p.label}: ${p.n}`}</title>
            </circle>
          ))}
          <text x={55} y={52} textAnchor="middle" transform="rotate(90 55 55)" fontSize={20} fontWeight={700} fill="#0f172a">
            {total}
          </text>
          <text x={55} y={68} textAnchor="middle" transform="rotate(90 55 55)" fontSize={10} fill="#64748b">
            SKU
          </text>
        </svg>
        <ul className="space-y-2.5 text-[13px]">
          {parts.map((p) => (
            <li key={p.label} className="group/item flex items-center gap-2 transition-transform duration-150 hover:translate-x-0.5 cursor-pointer">
              <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full transition-transform duration-150 group-hover/item:scale-125" style={{ background: p.color }} />
              <span className="w-20 text-slate-700 font-medium group-hover/item:text-slate-900">{p.label}</span>
              <span className="w-8 text-right font-mono font-semibold tabular-nums text-slate-900">{p.n}</span>
              <span className="w-14 text-right font-mono tabular-nums text-slate-500">{fmtPct(ratio(p.n, total))}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

// Lưới kẻ mảnh mọi ô; vạch dọc đậm hơn (SEP) ở đầu mỗi nhóm cột.
// Màu chữ trên td/th phải dùng "!" vì CSS chung của Accounting đặt màu cho table td/th.
const TH_BASE = "border border-slate-200 px-3 py-2 text-[11px] font-semibold whitespace-nowrap";
const TH = `${TH_BASE} bg-slate-50 !text-slate-600`;
const TD = "border border-slate-100 px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap";
const TDL = "border border-slate-100 px-3 py-1.5 text-left whitespace-nowrap";
const SEP = "kq-sep border-l-2 border-l-slate-200";
// Ô không áp dụng: gạch ngang nhạt để khỏi lẫn với ô trống
const TOTAL_ROW = "bg-slate-100 [&>td]:border-t-2 [&>td]:border-t-slate-300";

// % hoàn vốn: chỉ số; âm = đỏ
function PctBar({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  return <span className={v < 0 ? "text-red-600" : ""}>{fmtPct(v)}</span>;
}

// Bảng SKU Testing: số 0 / trống in nhạt để số thật nổi lên; Profit xanh khi lãi, đỏ khi lỗ
function zc(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) || Math.abs(v) < 0.005 ? "!text-slate-300" : "";
}
function profitCls(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return "!text-slate-300";
  return v > 0 ? "!text-emerald-700" : "!text-red-600";
}

// % hoàn vốn dạng thanh: đầy = đã thu đủ vốn hàng
function HoanVonBar({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  const w = Math.max(0, Math.min(1, v)) * 100;
  const color = v < 0 ? "bg-red-500" : v >= 1 ? "bg-emerald-500" : v >= 0.5 ? "bg-blue-500" : "bg-amber-500";
  return (
    <span className="flex items-center justify-end gap-2">
      <span className={v < 0 ? "text-red-600" : v >= 1 ? "font-semibold text-emerald-700" : ""}>{fmtPct(v)}</span>
      <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
      </span>
    </span>
  );
}

// Ảnh SKU: lia chuột hoặc bấm để xem ảnh to (fixed, không bị khung cuộn của bảng cắt)
function ThumbZoom({ url }: { url: string | null }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const thumb = getOptimizedThumbnailUrl(url, 64);
  const big = getOptimizedThumbnailUrl(url, 320);
  // Ảnh đang hiện: cuộn bảng hoặc bấm chỗ khác thì đóng
  useEffect(() => {
    if (!pos) return;
    const close = () => {
      setPinned(false);
      setPos(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("mousedown", close);
    };
  }, [pos]);
  if (!thumb) return <span className="h-7 w-7 shrink-0 rounded border border-dashed border-slate-200" />;
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const size = 240;
    const y = Math.max(8, Math.min(window.innerHeight - size - 8, r.top + r.height / 2 - size / 2));
    setPos({ x: r.right + 8, y });
  };
  return (
    <>
      <img
        src={thumb}
        alt=""
        loading="lazy"
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => !pinned && setPos(null)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (pinned) {
            setPinned(false);
            setPos(null);
          } else {
            setPinned(true);
            show(e.currentTarget);
          }
        }}
        className="h-7 w-7 shrink-0 cursor-zoom-in rounded border border-slate-200 object-cover transition-transform duration-150 hover:scale-110"
      />
      {/* Portal ra body: ô SKU sticky (z-10) và dòng có animation transform tạo stacking context riêng,
          để popup bên trong sẽ bị ô khác đè / lệch vị trí */}
      {pos &&
        createPortal(
          <span
            className="animate-in fade-in zoom-in-95 duration-150 pointer-events-none fixed z-[1000] block h-60 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            style={{ left: Math.min(pos.x, window.innerWidth - 248), top: pos.y }}
          >
            <img src={big || thumb} alt="" className="h-full w-full rounded object-contain" />
          </span>,
          document.body
        )}
    </>
  );
}

// Tỉ lệ WIN so với mục tiêu: nhãn màu
// Nội dung ô trượt mở/đóng mượt (bảng không animate được chiều cao dòng, nên animate nội dung trong ô)
function Slide({ open, className = "", children }: { open: boolean; className?: string; children?: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={`px-3 py-2.5 ${className}`}>{children}</div>
      </div>
    </div>
  );
}

function RatePill({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  const ok = v >= WIN_TARGET_RATE;
  return (
    <span
      title={ok ? "Đạt mục tiêu" : "Chưa đạt mục tiêu"}
      className={`font-semibold tabular-nums ${ok ? "text-emerald-700" : "text-rose-600"}`}
    >
      {fmtPct(v)}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  // Ô đã tô màu theo trạng thái (statusCellClass) nên chữ luôn đen, kể cả Hủy
  return <span>{status}</span>;
}

function Kpi({
  label,
  value,
  sub,
  highlight,
  valueClass,
  onClick,
  clickTitle,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  highlight?: boolean;
  valueClass?: string;
  /** Bấm thẻ → sang SKU Testing lọc đúng các SKU của thẻ */
  onClick?: () => void;
  clickTitle?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
      title={onClick ? clickTitle : undefined}
      className={`min-w-0 rounded-xl border px-4 py-3.5 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xs select-none ${
        highlight ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"
      } ${onClick ? "cursor-pointer hover:border-blue-300" : ""}`}
    >
      <div className="text-[12px] font-semibold text-slate-500">{label}</div>
      <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tracking-tight tabular-nums transition-colors duration-200 ${valueClass ?? (highlight ? "text-emerald-700" : "text-slate-900")}`}>{value}</div>
      {sub && <div className="mt-2 text-[11.5px] text-slate-500">{sub}</div>}
    </div>
  );
}

// Skeleton loading cho tab KQKD: chống giật layout, tăng độ mượt khi đổi năm / đổi store
function KqkdSkeleton() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50/60 p-3 space-y-3 font-sans">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs space-y-2">
            <div className="h-3 w-20 rounded bg-slate-200/70 acc-shimmer" />
            <div className="h-7 w-28 rounded bg-slate-200/90 acc-shimmer" />
            <div className="h-2.5 w-24 rounded bg-slate-100 acc-shimmer" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        <div className="h-44 rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-2xs">
          <div className="flex justify-between">
            <div className="h-4 w-32 rounded bg-slate-200/70 acc-shimmer" />
            <div className="h-3 w-36 rounded bg-slate-200/60 acc-shimmer" />
          </div>
          <div className="h-28 rounded bg-slate-100/70 acc-shimmer" />
        </div>
        <div className="h-44 rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-2xs">
          <div className="h-4 w-28 rounded bg-slate-200/70 acc-shimmer" />
          <div className="flex items-center gap-4">
            <div className="h-24 w-24 rounded-full bg-slate-200/70 acc-shimmer" />
            <div className="space-y-2 flex-1">
              <div className="h-3 w-full rounded bg-slate-200/60 acc-shimmer" />
              <div className="h-3 w-4/5 rounded bg-slate-200/60 acc-shimmer" />
              <div className="h-3 w-3/5 rounded bg-slate-200/60 acc-shimmer" />
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3 shadow-2xs">
        <div className="h-4 w-28 rounded bg-slate-200/70 acc-shimmer" />
        <div className="h-36 rounded bg-slate-100/70 acc-shimmer" />
      </div>
    </div>
  );
}

// ===== NGƯỜI R&D: hiệu quả theo từng người (PIC Idea / PIC MKT / Design) =====
type PersonRole = "pic_idea" | "pic_mkt" | "design_pic";
const PERSON_ROLES: { key: PersonRole; label: string }[] = [{ key: "pic_idea", label: "PIC Idea" }];
// Bảng mã ghi tên không thống nhất ("Cường"/"Cuong", "Đức"/"Duc"): gom theo tên bỏ dấu, viết thường
function personKey(name: string | null | undefined) {
  const t = (name || "").trim();
  if (!t) return "";
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ");
}

// key (bỏ dấu) → tên hiển thị = cách viết gặp nhiều nhất
function personNames(skus: Pick<KqkdSku, PersonRole>[], role: PersonRole) {
  const counts = new Map<string, Map<string, number>>();
  for (const s of skus) {
    const raw = (s[role] ?? "").trim();
    const k = personKey(raw) || "(trống)";
    const m = counts.get(k) || new Map<string, number>();
    m.set(raw || "(chưa ghi tên)", (m.get(raw || "(chưa ghi tên)") || 0) + 1);
    counts.set(k, m);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, Array.from(m.entries()).sort((x, y) => y[1] - x[1])[0][0]);
  return out;
}

type PersonStat = {
  key: string;
  name: string;
  skus: KqkdSku[];
  n: number;
  win: number;
  test: number;
  loss: number;
  due: number;
  winDue: number;
  von: number;
  revenue: number;
  ads: number;
  basecost: number;
  profit: number;
  hoanVon: number;
};

function KqkdPeople({
  skus,
  currentMonth,
  role,
}: {
  skus: KqkdSku[];
  currentMonth: string;
  role: PersonRole;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const [fKind, setFKind] = useState<"" | "win" | "test" | "loss">("");
  const [sort, setSort] = useState<SortState>(null);
  const onSort = (k: string) =>
    setSort((prev) => {
      const first: "asc" | "desc" = k === "name" ? "asc" : "desc";
      if (prev?.key !== k) return { key: k, dir: first };
      if (prev.dir === first) return { key: k, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
  const deferredQ = useDeferredValue(q);

  // Lọc SKU trước khi gom theo người: số liệu từng người = đúng phần SKU đang lọc
  const filtered = useMemo(() => {
    const t = personKey(deferredQ);
    return skus.filter((s) => {
      if (fKind && statusKind(s.status) !== fKind) return false;
      if (!t) return true;
      return (
        personKey(s[role]).includes(t) ||
        s.sku.toLowerCase().includes(t) ||
        personKey(s.product_type).includes(t)
      );
    });
  }, [skus, deferredQ, fKind, role]);

  const people = useMemo(() => {
    const map = new Map<string, PersonStat & { names: Map<string, number> }>();
    for (const s of filtered) {
      const raw = (s[role] ?? "").trim();
      const key = personKey(raw) || "(trống)";
      const cur: PersonStat & { names: Map<string, number> } = map.get(key) || {
        key, name: "", names: new Map(), skus: [], n: 0, win: 0, test: 0, loss: 0, due: 0, winDue: 0, von: 0, revenue: 0, ads: 0, basecost: 0, profit: 0, hoanVon: 0,
      };
      cur.names.set(raw || "(trống)", (cur.names.get(raw || "(trống)") || 0) + 1);
      const d = derive(s);
      const kind = statusKind(s.status);
      cur.skus.push(s);
      cur.n += 1;
      cur[kind] += 1;
      if (s.eval_month && s.eval_month <= currentMonth) {
        cur.due += 1;
        if (kind === "win") cur.winDue += 1;
      }
      cur.von += s.von_hang;
      cur.revenue += s.revenue;
      cur.ads += s.ads_fee;
      cur.basecost += d.basecost;
      cur.profit += s.profit;
      cur.hoanVon += d.hoanVon;
      map.set(key, cur);
    }
    const out: PersonStat[] = [];
    for (const p of map.values()) {
      // Tên hiển thị = cách viết gặp nhiều nhất
      const name = Array.from(p.names.entries()).sort((a, b) => b[1] - a[1])[0][0];
      p.skus.sort((a, b) => b.profit - a.profit);
      out.push({ ...p, name });
    }
    return out.sort((a, b) => (a.key === "(trống)" ? 1 : b.key === "(trống)" ? -1 : b.profit - a.profit || b.n - a.n));
  }, [filtered, role, currentMonth]);

  // Sắp xếp người theo cột đã chọn; "(chưa ghi tên)" luôn ở cuối
  const sortedPeople = useMemo(() => {
    if (!sort) return people;
    const val = (p: PersonStat): number | string | null => {
      switch (sort.key) {
        case "name":
          return p.name;
        case "rate":
          return ratio(p.winDue, p.due);
        case "winDue":
          return p.due ? p.winDue : null;
        case "hoanVonPct":
          return ratio(p.hoanVon, p.von);
        default:
          return (p as unknown as Record<string, number>)[sort.key] ?? null;
      }
    };
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...people].sort((a, b) => {
      if (a.key === "(trống)" || b.key === "(trống)") return a.key === "(trống)" ? 1 : -1;
      const x = val(a);
      const y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      if (typeof x === "string" || typeof y === "string") return sign * String(x).localeCompare(String(y), "vi");
      return sign * (x - y);
    });
  }, [people, sort]);

  // Mở một người: tóm tắt theo phôi (Product Type) của người đó, cùng cột với dòng người.
  // Sắp theo cột đang chọn (cột "Người" = tên phôi A→Z), mặc định Profit giảm dần.
  const phoiOf = (p: PersonStat): PersonStat[] => {
    const m = new Map<string, PersonStat>();
    for (const s of p.skus) {
      const key = s.product_type || "(trống)";
      const cur: PersonStat = m.get(key) || {
        key, name: key, skus: [], n: 0, win: 0, test: 0, loss: 0, due: 0, winDue: 0, von: 0, revenue: 0, ads: 0, basecost: 0, profit: 0, hoanVon: 0,
      };
      const d = derive(s);
      const kind = statusKind(s.status);
      cur.skus.push(s);
      cur.n += 1;
      cur[kind] += 1;
      if (s.eval_month && s.eval_month <= currentMonth) {
        cur.due += 1;
        if (kind === "win") cur.winDue += 1;
      }
      cur.von += s.von_hang;
      cur.revenue += s.revenue;
      cur.ads += s.ads_fee;
      cur.basecost += d.basecost;
      cur.profit += s.profit;
      cur.hoanVon += d.hoanVon;
      m.set(key, cur);
    }
    const list = Array.from(m.values());
    const k = sort?.key ?? "profit";
    const sign = sort ? (sort.dir === "asc" ? 1 : -1) : -1;
    const val = (x: PersonStat): number | string | null =>
      k === "name" ? x.name : k === "hoanVonPct" ? ratio(x.hoanVon, x.von) : k === "rate" ? ratio(x.winDue, x.due) : ((x as unknown as Record<string, number>)[k] ?? null);
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      if (typeof x === "string" || typeof y === "string") return sign * String(x).localeCompare(String(y), "vi");
      return sign * (x - y);
    });
  };
  const filtering = Boolean(q || fKind || sort);


  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const H = TH;
  return (
    <section className="mx-3 mb-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <h3
          className="text-[14px] font-bold text-slate-800"
          title="Đã đánh giá = SKU đã đến tháng đánh giá. Bấm vào một người để xem từng SKU."
        >
          PIC IDEA
        </h3>
        <div className="relative ml-2 w-48 transition-all duration-200 focus-within:w-60">
          <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm người, SKU, phôi..."
            aria-label="Tìm trong bảng PIC IDEA"
            className="h-7 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-6 text-xs font-medium text-slate-800 placeholder-slate-400 outline-hidden transition-colors focus:border-blue-500"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Xoá tìm kiếm" className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-slate-600">
              <XIcon size={10} />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(
            [
              { k: "", label: "Tất cả" },
              { k: "win", label: "WIN" },
              { k: "test", label: "Đang test" },
              { k: "loss", label: "Hủy" },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              aria-pressed={fKind === o.k}
              onClick={() => setFKind(o.k)}
              className={`relative z-10 cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold select-none transition-colors duration-150 ${
                fKind === o.k ? "text-blue-700" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {fKind === o.k && <AnimatedTabPill layoutId="kqkd-people-kind-pill" className="rounded-md bg-white shadow-2xs" />}
              <span className="relative z-10">{o.label}</span>
            </button>
          ))}
        </div>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setFKind("");
              setSort(null);
            }}
            className="animate-in fade-in zoom-in-95 duration-150 flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
          >
            <XIcon size={10} weight="bold" />
            Xoá lọc
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((prev) => (prev.size ? new Set() : new Set(sortedPeople.map((p) => p.key))))}
          className="ml-auto cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-2xs transition-all duration-150 hover:bg-slate-50 hover:text-slate-900 active:scale-95"
        >
          {open.size ? "Thu gọn tất cả" : "Mở tất cả"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px] [&_td]:py-2.5">
          <thead>
            <tr>
              <th rowSpan={2} className={`${H} w-10 text-center align-bottom`}>STT</th>
              <SortTh k="name" sort={sort} onSort={onSort} align="left" rowSpan={2} className={`${H} text-left align-bottom`}>Người</SortTh>
              <th colSpan={5} className={`${TH_BASE} ${SEP} text-center bg-blue-100 !text-blue-800`}>SKU</th>
              <th colSpan={5} className={`${TH_BASE} ${SEP} text-center bg-violet-100 !text-violet-800`}>Tiền</th>
            </tr>
            <tr>
              <SortTh k="n" sort={sort} onSort={onSort} className={`${TH_BASE} ${SEP} text-right bg-blue-50 !text-blue-900`}>Tổng</SortTh>
              <SortTh k="due" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Đã đánh giá</SortTh>
              <SortTh k="win" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>WIN</SortTh>
              <SortTh k="test" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Đang test</SortTh>
              <SortTh k="loss" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Hủy</SortTh>
              <SortTh k="von" sort={sort} onSort={onSort} className={`${TH_BASE} ${SEP} text-right bg-violet-50 !text-violet-900`}>Vốn test</SortTh>
              <SortTh k="revenue" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-violet-50 !text-violet-900`}>Revenue</SortTh>
              <SortTh k="ads" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-violet-50 !text-violet-900`}>Ads Fee</SortTh>
              <SortTh k="profit" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-violet-50 !text-violet-900`}>Profit</SortTh>
              <SortTh k="hoanVonPct" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-violet-50 !text-violet-900`}>% Hoàn vốn</SortTh>
            </tr>
          </thead>
          <tbody>
            {sortedPeople.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-left text-sm !text-slate-500">
                  Không có người / SKU khớp bộ lọc.
                </td>
              </tr>
            )}
            {sortedPeople.map((p, i) => {
              const isOpen = open.has(p.key);
              return (
                <Fragment key={p.key}>
                  <tr
                    onClick={() => toggle(p.key)}
                    className={`cursor-pointer transition-colors duration-150 hover:!bg-amber-50/60 ${isOpen ? "bg-blue-50 [&>td]:!font-bold [&>td]:!text-slate-900" : i % 2 ? "bg-slate-50/80" : "bg-white"}`}
                  >
                    <td className={`${TD} !text-center !text-slate-400`}>{i + 1}</td>
                    <td className={`${TDL} font-semibold ${isOpen ? "border-l-4 border-l-blue-500" : ""}`}>
                      <span className="inline-flex items-center gap-1.5">
                        <CaretRightIcon size={12} className={`shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90 text-blue-600" : "text-slate-400"}`} />
                        <span className={p.key === "(trống)" ? "italic text-slate-400" : ""}>{p.key === "(trống)" ? "(chưa ghi tên)" : p.name}</span>
                      </span>
                    </td>
                    <td className={`${TD} ${SEP}`}>{p.n}</td>
                    <td className={`${TD} ${zc(p.due)}`}>{p.due}</td>
                    <td className={`${TD} ${p.win ? "!text-emerald-700 font-semibold" : "!text-slate-300"}`}>{p.win}</td>
                    <td className={`${TD} ${zc(p.test)}`}>{p.test}</td>
                    <td className={`${TD} ${zc(p.loss)}`}>{p.loss}</td>
                    <td className={`${TD} ${SEP} ${zc(p.von)}`}>{fmtUsd(p.von)}</td>
                    <td className={`${TD} ${zc(p.revenue)}`}>{fmtUsd(p.revenue)}</td>
                    <td className={`${TD} ${zc(p.ads)}`}>{fmtUsd(p.ads)}</td>
                    <td className={`${TD} ${profitCls(p.profit)}`}>{fmtUsd(p.profit)}</td>
                    <td className={TD}><HoanVonBar v={ratio(p.hoanVon, p.von)} /></td>
                  </tr>
                  {isOpen &&
                    (() => {
                      const rows = phoiOf(p);
                      return rows.map((f, j) => (
                        <tr
                          key={f.key}
                          className={`acc-rise bg-white hover:!bg-amber-50/50 [&_td]:!text-slate-600 ${j === rows.length - 1 ? "[&_td]:border-b-2 [&_td]:border-b-blue-200" : ""}`}
                          style={{ animationDelay: `${Math.min(j * 30, 400)}ms` }}
                        >
                          <td className={`${TD} !text-center !text-slate-300`}>{j + 1}</td>
                          <td className={`${TDL} pl-8`}>
                            <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-slate-300 align-middle" />
                            <span className={f.key === "(trống)" ? "italic !text-slate-400" : ""}>{f.key === "(trống)" ? "(chưa ghi phôi)" : f.name}</span>
                          </td>
                          <td className={`${TD} ${SEP}`}>{f.n}</td>
                          <td className={`${TD} ${zc(f.due)}`}>{f.due}</td>
                          <td className={`${TD} ${f.win ? "!text-emerald-700 font-semibold" : "!text-slate-300"}`}>{f.win}</td>
                          <td className={`${TD} ${zc(f.test)}`}>{f.test}</td>
                          <td className={`${TD} ${zc(f.loss)}`}>{f.loss}</td>
                          <td className={`${TD} ${SEP} ${zc(f.von)}`}>{fmtUsd(f.von)}</td>
                          <td className={`${TD} ${zc(f.revenue)}`}>{fmtUsd(f.revenue)}</td>
                          <td className={`${TD} ${zc(f.ads)}`}>{fmtUsd(f.ads)}</td>
                          <td className={`${TD} ${profitCls(f.profit)}`}>{fmtUsd(f.profit)}</td>
                          <td className={TD}>
                            <HoanVonBar v={ratio(f.hoanVon, f.von)} />
                          </td>
                        </tr>
                      ));
                    })()}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Mục "KQKD SKU" riêng trên sidebar: hai trang Tổng quan tháng / SKU Testing chuyển bằng nút trên thanh công cụ.
export function KqkdView() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "overview";
    try {
      const saved = window.sessionStorage.getItem("acc_kqkd_mode");
      return saved === "skus" ? "skus" : "overview";
    } catch {
      return "overview";
    }
  });
  const handleMode = (m: ViewMode) => {
    setMode(m);
    try {
      window.sessionStorage.setItem("acc_kqkd_mode", m);
    } catch {
      // bỏ qua: trình duyệt chặn storage
    }
  };
  const [data, setData] = useState<KqkdData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWin, setSavingWin] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Bảng SKU Testing: lọc kiểu Excel trên từng cột
  const [colFilters, setColFilters] = useState<ColFilters>({});
  // Lọc mang từ thẻ KPI của Tổng quan sang (bấm thẻ): giữ đúng danh sách SKU của thẻ, có nhãn để bỏ
  // (chỉ áp cho đúng store + năm lúc bấm; đổi store / năm là tự bỏ)
  const [kpiPresetState, setKpiPreset] = useState<{ scope: string; label: string; skus: Set<string>; outside: number } | null>(null);
  const kpiPreset = kpiPresetState?.scope === `${selectedStoreId}|${year}` ? kpiPresetState : null;
  const [filterOpen, setFilterOpen] = useState<FilterOpen | null>(null);
  const openFilter = useCallback(
    (key: string, th: HTMLElement) => setFilterOpen({ key, title: th.textContent?.trim() || key, rect: th.getBoundingClientRect() }),
    [setFilterOpen]
  );
  const closeFilter = useCallback(() => setFilterOpen(null), [setFilterOpen]);
  const [sort, setSort] = useState<SortState>(null);
  const onSort = (k: string) =>
    setSort((prev) => {
      const first: "asc" | "desc" = TEXT_SORT_KEYS.has(k) ? "asc" : "desc";
      if (prev?.key !== k) return { key: k, dir: first };
      if (prev.dir === first) return { key: k, dir: first === "asc" ? "desc" : "asc" };
      return null;
    });
  const [metric, setMetric] = useState<Metric | "all">("profit");
  const [fPhoi, setFPhoi] = useState("");
  // Tháng đang mở xem chi tiết phôi (mặc định mở sẵn tháng hiện tại, các tháng khác thu gọn)
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([currentMonth]));
  const toggleMonth = (m: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((json: { stores?: Store[] }) => {
        if (ignore) return;
        const list = (json.stores || []).filter((s) => storeCanView(s, "FBA"));
        setStores(list);
        const saved = window.localStorage.getItem("acc_selected_store_id") || "";
        const target = list.find((s) => s.id === saved) || list[0];
        if (target) setSelectedStoreId(target.id);
      })
      .catch(() => {
        if (!ignore) setStores([]);
      })
      .finally(() => {
        if (!ignore) setLoadingStores(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Đồng bộ store với các tab khác
  useEffect(() => {
    const sync = (e: Event) => {
      const id = (e as CustomEvent<string>).detail || window.localStorage.getItem("acc_selected_store_id") || "";
      if (id && stores.some((s) => s.id === id)) setSelectedStoreId(id);
    };
    window.addEventListener("acc_store_changed", sync);
    return () => window.removeEventListener("acc_store_changed", sync);
  }, [stores]);

  const handleStoreSelect = (id: string) => {
    setSelectedStoreId(id);
    window.localStorage.setItem("acc_selected_store_id", id);
    window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: id }));
  };

  const load = useCallback(
    async (refresh = false) => {
      if (!selectedStoreId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store_id: selectedStoreId, year: String(year) });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/accounting/financials/kqkd?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Không tải được dữ liệu");
        setData(json as KqkdData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu");
      } finally {
        setLoading(false);
      }
    },
    [selectedStoreId, year]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canEdit = storeCanEdit(stores.find((s) => s.id === selectedStoreId), "FBA");

  const saveWin = useCallback(
    async (evalMonth: string, productType: string, winCount: number | null) => {
      if (!selectedStoreId) return;
      setSavingWin(`${evalMonth}|${productType}`);
      setError(null);
      try {
        const res = await fetch("/api/accounting/financials/kqkd", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: selectedStoreId, eval_month: evalMonth, product_type: productType, win_count: winCount }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Không lưu được số SKU WIN");
        setData((prev) => {
          if (!prev) return prev;
          const rest = prev.winResults.filter((w) => !(w.eval_month === evalMonth && w.product_type === productType));
          return {
            ...prev,
            winResults:
              winCount == null
                ? rest
                : [...rest, { eval_month: evalMonth, product_type: productType, win_count: winCount, updated_by: null, updated_at: new Date().toISOString() }],
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không lưu được số SKU WIN");
      } finally {
        setSavingWin(null);
      }
    },
    [selectedStoreId]
  );

  const allSkus = useMemo(() => data?.skus || [], [data]);
  // Tổng quan: lọc theo Tên Phôi (= Product Type) — KPI, biểu đồ, bảng cùng cập nhật
  const allEvalSkus = useMemo(() => data?.evalSkus || [], [data]);
  const phoiOptions = useMemo(
    () => Array.from(new Set([...allSkus, ...allEvalSkus].map((s) => s.product_type || "(trống)"))).sort((a, b) => a.localeCompare(b)),
    [allSkus, allEvalSkus]
  );
  const baseSkus = useMemo(() => (fPhoi ? allSkus.filter((s) => (s.product_type || "(trống)") === fPhoi) : allSkus), [allSkus, fPhoi]);
  // Phần Đánh giá SKU WIN = cohort + SKU listing năm trước có tháng đánh giá trong năm (sheet Tổng quan tháng: T1/T2)
  const evalPool = useMemo<KqkdEvalSku[]>(
    () => [...baseSkus, ...(fPhoi ? allEvalSkus.filter((s) => (s.product_type || "(trống)") === fPhoi) : allEvalSkus)],
    [baseSkus, allEvalSkus, fPhoi]
  );
  const deferredSearch = useDeferredValue(search);
  const activeFilters = (search ? 1 : 0) + Object.keys(colFilters).length + (kpiPreset ? 1 : 0);
  const clearFilters = () => {
    setSearch("");
    setColFilters({});
    setKpiPreset(null);
  };

  // SKU Testing: ô tìm kiếm + lọc từng cột kiểu Excel, rồi sắp xếp. Không phụ thuộc bộ lọc Phôi của Tổng quan
  // (cột Product Type có bộ lọc riêng).
  const searchedSkus = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const pool = kpiPreset ? allSkus.filter((s) => kpiPreset.skus.has(s.sku)) : allSkus;
    if (!q) return pool;
    return pool.filter(
      (s) =>
        s.sku.toLowerCase().includes(q) ||
        (s.asin || "").toLowerCase().includes(q) ||
        (s.product_type || "").toLowerCase().includes(q) ||
        (s.pic_idea || "").toLowerCase().includes(q)
    );
  }, [allSkus, deferredSearch, kpiPreset]);

  const skus = useMemo(() => {
    const out = searchedSkus.filter((s) => passesColFilters(s, colFilters, year));
    if (!sort) return out;
    const sign = sort.dir === "asc" ? 1 : -1;
    return out
      .map((s) => ({ s, v: sortValue(s, sort.key) }))
      .sort((a, b) => {
        // Ô trống luôn nằm cuối, bất kể chiều sắp xếp
        if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? 0 : 1) : -1;
        if (typeof a.v === "string" || typeof b.v === "string") return sign * String(a.v).localeCompare(String(b.v), "vi");
        return sign * (a.v - b.v);
      })
      .map((x) => x.s);
  }, [searchedSkus, colFilters, year, sort]);

  // Giá trị cho hộp lọc đang mở: các dòng đã qua bộ lọc cột khác, xếp theo giá trị thật (số / tháng), ô trống cuối
  const filterOptions = useMemo<FilterOption[]>(() => {
    if (!filterOpen) return [];
    const key = filterOpen.key;
    const m = new Map<string, { v: string | number | null; count: number }>();
    for (const s of searchedSkus) {
      if (!passesColFilters(s, colFilters, year, key)) continue;
      const label = filterLabel(s, key, year);
      const cur = m.get(label);
      if (cur) cur.count++;
      else m.set(label, { v: label === BLANK ? null : sortValue(s, key), count: 1 });
    }
    return Array.from(m.entries())
      .sort(([la, a], [lb, b]) => {
        if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? 0 : 1) : -1;
        if (typeof a.v === "number" && typeof b.v === "number") return a.v - b.v;
        return String(a.v).localeCompare(String(b.v), "vi") || la.localeCompare(lb, "vi");
      })
      .map(([label, x]) => ({ label, count: x.count }));
  }, [filterOpen, searchedSkus, colFilters, year]);

  const months = useMemo(() => data?.months || [], [data]);

  // ===== TỔNG QUAN: listing theo tháng (tháng listing) =====
  const lastMonth = year < currentYear ? 12 : year > currentYear ? 0 : now.getMonth() + 1;

  const listing = useMemo(() => {
    const byMonth = new Map<string, Map<string, { n: number; von: number; hoanVon: number }>>();
    for (const s of baseSkus) {
      if (!s.listing_month.startsWith(String(year))) continue;
      const g = byMonth.get(s.listing_month) || new Map();
      const phoi = s.product_type || "(trống)";
      const cur = g.get(phoi) || { n: 0, von: 0, hoanVon: 0 };
      cur.n += 1;
      cur.von += s.von_hang;
      cur.hoanVon += derive(s).hoanVon;
      g.set(phoi, cur);
      byMonth.set(s.listing_month, g);
    }
    const maxM = Math.max(lastMonth, ...Array.from(byMonth.keys()).map(monthNum));
    const out: { month: string; n: number; von: number; hoanVon: number; rows: { phoi: string; n: number; von: number; hoanVon: number }[] }[] = [];
    for (let m = 1; m <= maxM; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const rows = Array.from((byMonth.get(key) || new Map()).entries())
        .map(([phoi, v]) => ({ phoi, ...v }))
        .sort((a, b) => b.von - a.von);
      out.push({
        month: key,
        rows,
        n: rows.reduce((a, r) => a + r.n, 0),
        von: rows.reduce((a, r) => a + r.von, 0),
        hoanVon: rows.reduce((a, r) => a + r.hoanVon, 0),
      });
    }
    return out;
  }, [baseSkus, year, lastMonth]);

  // ===== TỔNG QUAN: đánh giá theo tháng đánh giá =====
  const winMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of data?.winResults || []) map.set(`${w.eval_month}|${w.product_type}`, w.win_count);
    return map;
  }, [data]);

  const evals = useMemo(() => {
    const byMonth = new Map<string, Map<string, { n: number; suggest: number }>>();
    for (const s of evalPool) {
      if (!s.eval_month || !s.eval_month.startsWith(String(year))) continue;
      const g = byMonth.get(s.eval_month) || new Map();
      const phoi = s.product_type || "(trống)";
      const cur = g.get(phoi) || { n: 0, suggest: 0 };
      cur.n += 1;
      if (statusKind(s.status) === "win") cur.suggest += 1;
      g.set(phoi, cur);
      byMonth.set(s.eval_month, g);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, g]) => {
        const rows = Array.from(g.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([phoi, v]) => ({ phoi, ...v, win: winMap.has(`${month}|${phoi}`) ? winMap.get(`${month}|${phoi}`)! : null }));
        // Tỉ lệ chỉ tính trên các phôi team đã điền — phôi chưa điền không kéo tỉ lệ xuống
        const done = rows.filter((r) => r.win != null);
        return {
          month,
          due: month <= currentMonth,
          rows,
          n: rows.reduce((a, r) => a + r.n, 0),
          suggest: rows.reduce((a, r) => a + r.suggest, 0),
          doneN: done.reduce((a, r) => a + r.n, 0),
          win: done.length ? done.reduce((a, r) => a + (r.win || 0), 0) : null,
        };
      });
  }, [evalPool, year, winMap, currentMonth]);

  const noEvalCount = useMemo(() => baseSkus.filter((s) => !s.eval_month).length, [baseSkus]);

  // Kỳ đánh giá = các tháng đánh giá đã đến hạn. Tháng chưa đến hạn không vào mục tiêu lẫn mẫu số.
  // n = SKU đến hạn · doneN = SKU đã có kết quả (team đã điền) · pendingN = đến hạn nhưng chưa điền (khác với "không WIN")
  const evalYear = useMemo(() => {
    const due = evals.filter((e) => e.due);
    const n = due.reduce((a, b) => a + b.n, 0);
    const doneN = due.reduce((a, b) => a + b.doneN, 0);
    const win = due.reduce((a, b) => a + (b.win || 0), 0);
    const notDueN = evals.filter((e) => !e.due).reduce((a, b) => a + b.n, 0);
    return { n, doneN, win, pendingN: n - doneN, notDueN };
  }, [evals]);

  // SKU đã đánh giá (mẫu số của Tỉ lệ WIN): tháng đánh giá trong năm, đã đến hạn, phôi đã điền kết quả WIN
  const evalDoneSkus = useMemo(() => {
    const out = new Set<string>();
    for (const s of evalPool) {
      if (!s.eval_month || !s.eval_month.startsWith(String(year)) || s.eval_month > currentMonth) continue;
      if (winMap.has(`${s.eval_month}|${s.product_type || "(trống)"}`)) out.add(s.sku);
    }
    return out;
  }, [evalPool, year, currentMonth, winMap]);

  // Bấm thẻ KPI → sang SKU Testing, lọc đúng các SKU của thẻ (bỏ các lọc cũ). Phôi đang chọn ở Tổng quan đi kèm.
  const jumpToSkus = (label: string, skus: Iterable<string>) => {
    const set = new Set(skus);
    const inTable = allSkus.filter((s) => set.has(s.sku)).length;
    setSearch("");
    setColFilters({});
    setSort(null);
    setKpiPreset({ scope: `${selectedStoreId}|${year}`, label: fPhoi ? `${label} · ${fPhoi}` : label, skus: set, outside: set.size - inTable });
    handleMode("skus");
  };

  // Bảng tháng: mở một tháng ra chia theo Phôi (mặc định) hoặc theo người (PIC Idea / PIC MKT / Design).
  // Số tổng của tháng giữ nguyên; chỉ các dòng con đổi cách gom. Theo người: WIN = số SKU "Phát triển" (chỉ xem, không điền).
  const [breakdown, setBreakdown] = useState<"phoi" | PersonRole>("phoi");
  const [peopleRole, setPeopleRole] = useState<PersonRole>("pic_idea");
  const pickBreakdown = (b: "phoi" | PersonRole) => {
    setBreakdown(b);
    if (b !== "phoi") setPeopleRole(b);
  };
  const byPerson = breakdown !== "phoi";
  const nameLabel = byPerson ? PERSON_ROLES.find((r) => r.key === breakdown)?.label : "Tên Phôi";
  const tableListing = useMemo(() => {
    if (breakdown === "phoi") return listing;
    const names = personNames(baseSkus, breakdown);
    return listing.map((b) => {
      const g = new Map<string, { n: number; von: number; hoanVon: number }>();
      for (const s of baseSkus) {
        if (s.listing_month !== b.month) continue;
        const k = names.get(personKey(s[breakdown]) || "(trống)") || "(chưa ghi tên)";
        const cur = g.get(k) || { n: 0, von: 0, hoanVon: 0 };
        cur.n += 1;
        cur.von += s.von_hang;
        cur.hoanVon += derive(s).hoanVon;
        g.set(k, cur);
      }
      return { ...b, rows: Array.from(g.entries()).map(([phoi, v]) => ({ phoi, ...v })).sort((x, y) => y.von - x.von) };
    });
  }, [listing, baseSkus, breakdown]);
  const tableEvals = useMemo(() => {
    if (breakdown === "phoi") return evals;
    const names = personNames(evalPool, breakdown);
    return evals.map((e) => {
      const g = new Map<string, { n: number; suggest: number }>();
      for (const s of evalPool) {
        if (s.eval_month !== e.month) continue;
        const k = names.get(personKey(s[breakdown]) || "(trống)") || "(chưa ghi tên)";
        const cur = g.get(k) || { n: 0, suggest: 0 };
        cur.n += 1;
        if (statusKind(s.status) === "win") cur.suggest += 1;
        g.set(k, cur);
      }
      const rows = Array.from(g.entries())
        .map(([phoi, v]) => ({ phoi, ...v, win: v.suggest as number | null }))
        .sort((x, y) => x.phoi.localeCompare(y.phoi));
      return { ...e, rows };
    });
  }, [evals, evalPool, breakdown]);

  // Một bảng chung theo tháng: phần Listing (SKU listing tháng đó) + phần Đánh giá (SKU đến hạn đánh giá tháng đó).
  // Dòng phôi = hợp các phôi của hai phần; phần nào không có phôi đó thì để trống. Tháng trống liền nhau gộp một dòng.
  const mergedRows = useMemo(() => {
    type L = (typeof tableListing)[number];
    type E = (typeof tableEvals)[number];
    type Row = { kind: "month"; month: string; l?: L; e?: E; phoi: string[] } | { kind: "empty"; from: number; to: number };
    const maxM = Math.max(lastMonth, ...tableListing.map((b) => monthNum(b.month)), ...tableEvals.map((e) => monthNum(e.month)));
    const out: Row[] = [];
    for (let m = 1; m <= maxM; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const l = tableListing.find((b) => b.month === key && b.n);
      const e = tableEvals.find((x) => x.month === key);
      const last = out[out.length - 1];
      if (!l && !e) {
        if (last?.kind === "empty" && last.to === m - 1) last.to = m;
        else out.push({ kind: "empty", from: m, to: m });
        continue;
      }
      const phoi = Array.from(new Set([...(l?.rows.map((r) => r.phoi) || []), ...(e?.rows.map((r) => r.phoi) || [])]));
      out.push({ kind: "month", month: key, l, e, phoi });
    }
    return out;
  }, [tableListing, tableEvals, lastMonth, year]);

  // Nút "Xem tất cả / Thu gọn" chỉ xét các tháng đang hiện trên bảng (tháng hiện tại có thể chưa có dòng)
  const anyMonthOpen = mergedRows.some((r) => r.kind === "month" && openMonths.has(r.month));

  const statusParts = useMemo(() => {
    const c = { win: 0, test: 0, loss: 0 };
    for (const s of baseSkus) c[statusKind(s.status)] += 1;
    return [
      { label: "WIN", n: c.win, color: C_GOOD },
      { label: "Đang test", n: c.test, color: C_TEST },
      { label: "Hủy", n: c.loss, color: "#cbd5e1" },
    ];
  }, [baseSkus]);

  const listingYear = useMemo(
    () => ({
      n: listing.reduce((a, b) => a + b.n, 0),
      von: listing.reduce((a, b) => a + b.von, 0),
      hoanVon: listing.reduce((a, b) => a + b.hoanVon, 0),
    }),
    [listing]
  );

  // ===== SKU TESTING: dòng tổng =====
  // Số phôi = số Product Type khác nhau (bỏ trống) trong danh sách đang lọc / toàn bộ
  const phoiCount = useMemo(() => {
    const count = (list: KqkdSku[]) => new Set(list.map((s) => s.product_type?.trim()).filter(Boolean)).size;
    return { shown: count(skus), all: count(allSkus) };
  }, [skus, allSkus]);

  const totals = useMemo(() => {
    let von = 0, revenue = 0, quantity = 0, basecost = 0, ads = 0, profit = 0, hoanVon = 0, qtyDi = 0, ton = 0;
    let hasTon = false;
    for (const s of skus) {
      const d = derive(s);
      von += s.von_hang;
      revenue += s.revenue;
      quantity += s.quantity;
      basecost += d.basecost;
      ads += s.ads_fee;
      profit += s.profit;
      hoanVon += d.hoanVon;
      qtyDi += s.qty_di;
      if (s.ton_kho != null) {
        ton += s.ton_kho;
        hasTon = true;
      }
    }
    const byMonth = new Map<string, { cell: MonthCell; cost: number }>();
    for (const { month } of months) {
      const cell = { revenue: 0, quantity: 0, ads_fee: 0, profit: 0 };
      let cost = 0;
      for (const s of skus) {
        const c = s.months[month];
        if (!c) continue;
        cell.revenue += c.revenue;
        cell.quantity += c.quantity;
        cell.ads_fee += c.ads_fee;
        cell.profit += c.profit;
        cost += c.quantity * (s.unit_cost || 0);
      }
      byMonth.set(month, { cell, cost });
    }
    return { von, revenue, quantity, basecost, ads, profit, hoanVon, qtyDi, ton: hasTon ? ton : null, byMonth };
  }, [skus, months]);

  // Cột theo tháng chỉ dùng để tính toán, không hiển thị trên bảng (bật lại: SHOW_MONTH_COLS = true)
  const tableMonths = SHOW_MONTH_COLS ? months : [];
  const monthMetrics = metric === "all" ? METRICS : METRICS.filter((m) => m.key === metric);
  const totalMetric = (month: string, mt: Metric) => {
    const t = totals.byMonth.get(month);
    if (!t) return null;
    if (mt === "roi") return ratio(t.cell.profit, t.cost);
    return cellMetric(t.cell, mt, null);
  };

  const years = useMemo(() => {
    const list = [];
    for (let y = currentYear; y >= 2024; y--) list.push(y);
    return list;
  }, [currentYear]);

  const selectCls = "h-8 cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:outline-hidden";
  // Bộ lọc đang bật thì tô xanh để nhìn là biết đang lọc gì
  const filterCls = (value: string) =>
    `h-8 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold focus:outline-hidden ${
      value ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-800"
    }`;
  const phoiSelect = (
    <select id="kqkd-phoi" aria-label="Tên Phôi" value={fPhoi} onChange={(e) => setFPhoi(e.target.value)} className={filterCls(fPhoi)}>
      <option value="">Phôi: tất cả</option>
      {phoiOptions.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-2 font-sans">
      {/* TOOLBAR — tầng 1: bối cảnh (store · năm · chế độ) · tầng 2 (SKU Testing): tìm + lọc · tuỳ chọn hiển thị */}
      <div className="flex shrink-0 flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs">
            <StorefrontIcon size={15} weight="bold" className="mr-1.5 shrink-0 text-slate-500" />
            <select
              id="kqkd-store-select"
              value={selectedStoreId}
              onChange={(e) => handleStoreSelect(e.target.value)}
              disabled={loadingStores || stores.length === 0}
              className="cursor-pointer bg-transparent font-bold text-slate-800 focus:outline-hidden"
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

          <select id="kqkd-year-select" aria-label="Năm listing" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
            {years.map((y) => (
              <option key={y} value={y}>
                Listing {y}
              </option>
            ))}
          </select>

          <span className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />

          <div className="relative flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100/90 p-0.5 shadow-2xs">
            {(
              [
                { key: "overview", label: "Tổng quan tháng" },
                { key: "skus", label: "SKU Testing" },
              ] as const
            ).map((o) => {
              const isActive = mode === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => handleMode(o.key)}
                  className={`relative z-10 cursor-pointer rounded-md px-3.5 py-1 text-xs font-bold select-none transition-colors duration-150 ${
                    isActive ? "text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {isActive && (
                    <AnimatedTabPill
                      layoutId="kqkd-mode-pill"
                      className="bg-blue-600 shadow-xs rounded-md"
                    />
                  )}
                  <span className="relative z-10">{o.label}</span>
                </button>
              );
            })}
          </div>

          {mode === "overview" && allSkus.length > 0 && phoiSelect}

          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || !selectedStoreId}
            className="ml-auto flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowClockwiseIcon size={14} className={loading ? "animate-spin text-amber-600" : "text-slate-600"} />
            <span>Làm mới</span>
          </button>
        </div>

        {mode === "skus" && allSkus.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-slate-50/60 p-2">
            <div className="relative w-56 transition-all duration-200 focus-within:w-72">
              <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="kqkd-search"
                type="text"
                placeholder="Tìm SKU, ASIN, phôi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`h-8 w-full rounded-lg border bg-white pl-7 pr-5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-hidden focus:border-blue-500 ${search ? "border-blue-400" : "border-slate-300"}`}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Xoá tìm kiếm">
                  <XIcon size={10} />
                </button>
              )}
            </div>

            {kpiPreset && (
              <span
                className="animate-in fade-in zoom-in-95 duration-150 inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 pl-2.5 pr-1 text-xs font-semibold text-blue-800"
                title={kpiPreset.outside ? `${kpiPreset.outside} SKU listing năm trước không có trong bảng SKU Testing (chỉ có ở phần đánh giá)` : undefined}
              >
                Từ Tổng quan: {kpiPreset.label} ({kpiPreset.skus.size - kpiPreset.outside}
                {kpiPreset.outside ? ` + ${kpiPreset.outside} SKU năm trước` : ""})
                <button
                  type="button"
                  onClick={() => setKpiPreset(null)}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded-md hover:bg-blue-100"
                  aria-label="Bỏ lọc từ Tổng quan"
                >
                  <XIcon size={10} weight="bold" />
                </button>
              </span>
            )}
            <span className="text-[11px] font-medium text-slate-400">Bấm tên cột để lọc / sắp xếp</span>
            {(activeFilters > 0 || sort) && (
              <button
                type="button"
                onClick={() => {
                  clearFilters();
                  setSort(null);
                }}
                className="animate-in fade-in zoom-in-95 duration-150 flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50"
              >
                <XIcon size={11} weight="bold" />
                Xoá lọc{activeFilters ? ` (${activeFilters})` : ""}
              </button>
            )}

            {SHOW_MONTH_COLS && (
            <label htmlFor="kqkd-metric" className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              Cột tháng
              <select id="kqkd-metric" aria-label="Chỉ số theo tháng" value={metric} onChange={(e) => setMetric(e.target.value as Metric | "all")} className={selectCls}>
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
                <option value="all">Tất cả chỉ số</option>
              </select>
            </label>
            )}
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

      <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <AccountingTopProgressBar loading={loading} variant="indigo" />

        {loading && !data && <KqkdSkeleton />}

        {!loading && data && allSkus.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-slate-500">
            Không có SKU listing năm {year}
          </div>
        )}

        {/* TỔNG QUAN THÁNG */}
        {mode === "overview" && allSkus.length > 0 && (
          <AccountingViewTransition transitionKey="overview" className="flex-1 overflow-auto bg-slate-50">
            <div className="grid grid-cols-2 gap-3 p-3 pb-0 md:grid-cols-3 xl:grid-cols-6">
              <Kpi
                label="Số lượng SKU"
                value={fmtInt(listingYear.n)}
                sub={`Listing ${year}`}
                onClick={() => jumpToSkus(`SKU listing ${year}`, baseSkus.map((s) => s.sku))}
                clickTitle="Xem các SKU này ở SKU Testing"
              />
              <Kpi
                onClick={() => jumpToSkus(`SKU listing ${year}`, baseSkus.map((s) => s.sku))}
                clickTitle="Xem các SKU này ở SKU Testing"
                label="Tổng vốn test"
                value={usd0.format(listingYear.von)}
                sub={`Hoàn vốn ${fmtPct(ratio(listingYear.hoanVon, listingYear.von)) || "0%"}`}
              />
              {(() => {
                // Revenue / Profit cả đời của các SKU listing trong năm (theo bộ lọc phôi)
                const rev = baseSkus.reduce((a, s) => a + s.revenue, 0);
                const ads = baseSkus.reduce((a, s) => a + s.ads_fee, 0);
                const profit = baseSkus.reduce((a, s) => a + s.profit, 0);
                const margin = ratio(profit, rev);
                return (
                  <>
                    <Kpi
                      label="Revenue"
                      value={usd0.format(rev)}
                      sub={`TACoS ${fmtPct(ratio(-ads, rev)) || "0%"}`}
                      onClick={() => jumpToSkus(`SKU listing ${year}`, baseSkus.map((s) => s.sku))}
                      clickTitle="Xem các SKU này ở SKU Testing"
                    />
                    <Kpi
                      onClick={() => jumpToSkus(`SKU listing ${year}`, baseSkus.map((s) => s.sku))}
                      clickTitle="Xem các SKU này ở SKU Testing"
                      label="Profit"
                      value={usd0.format(profit)}
                      valueClass={profit < 0 ? "text-red-600" : undefined}
                      sub={`Biên lợi nhuận ${fmtPct(margin) || "0%"}`}
                    />
                  </>
                );
              })()}
              <Kpi
                onClick={evalDoneSkus.size ? () => jumpToSkus(`SKU đã đánh giá ${year}`, evalDoneSkus) : undefined}
                clickTitle="Xem các SKU đã đánh giá ở SKU Testing"
                label="SKU WIN (KQ thực tế)"
                value={evalYear.doneN ? `${fmtInt(evalYear.win)}/${fmtInt(evalYear.doneN)}` : "—"}
                sub={evalYear.pendingN ? `${evalYear.pendingN} SKU chưa điền` : "Đã đánh giá"}
              />
              {(() => {
                const r = ratio(evalYear.win, evalYear.doneN);
                return (
                  <Kpi
                    onClick={evalDoneSkus.size ? () => jumpToSkus(`SKU đã đánh giá ${year}`, evalDoneSkus) : undefined}
                    clickTitle="Xem các SKU đã đánh giá ở SKU Testing"
                    label="Tỉ lệ WIN"
                    value={r != null ? fmtPct(r) : "—"}
                    highlight={r != null && r >= WIN_TARGET_RATE}
                  />
                );
              })()}
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[2fr_1fr]">
              <WinChart
                items={MONTHS_12.map((m) => {
                  const e = evals.find((x) => monthNum(x.month) === m);
                  if (!e) return { month: m, target: null, win: null, rate: null, tip: `Tháng ${m}: không có SKU đánh giá` };
                  if (!e.due) return { month: m, n: e.n, target: null, win: null, rate: null, note: "chưa đến hạn", tip: `Tháng ${m}: ${e.n} SKU, chưa đến hạn đánh giá` };
                  const target = e.n * WIN_TARGET_RATE;
                  if (e.win != null) {
                    const r = ratio(e.win, e.doneN);
                    return {
                      month: m,
                      n: e.n,
                      doneN: e.doneN,
                      target,
                      win: e.win,
                      rate: r,
                      tip: `Tháng ${m}: ${e.win}/${e.doneN} SKU WIN / SKU đã đánh giá = ${fmtPct(r)} · mục tiêu ${fmtTarget(target)} (${Math.round(WIN_TARGET_RATE * 100)}% × ${e.n})${e.doneN < e.n ? ` · ${e.n - e.doneN} SKU chưa điền` : ""}`,
                    };
                  }
                  return {
                    month: m,
                    n: e.n,
                    target,
                    win: null,
                    rate: null,
                    note: undefined,
                    tip: `Tháng ${m}: ${e.n} SKU đến hạn, chưa điền kết quả · mục tiêu ${fmtTarget(target)}`,
                  };
                })}
              />
              <StatusDonut parts={statusParts} />
            </div>

            <section className="mx-3 mb-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-bold text-slate-800">Theo tháng</h3>
                  <div className="ml-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {([{ key: "phoi", label: "Phôi" }, ...PERSON_ROLES] as const).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        aria-pressed={breakdown === o.key}
                        onClick={() => pickBreakdown(o.key)}
                        className={`relative z-10 cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold select-none transition-colors duration-150 ${
                          breakdown === o.key ? "text-blue-700" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {breakdown === o.key && <AnimatedTabPill layoutId="kqkd-breakdown-pill" className="rounded-md bg-white shadow-2xs" />}
                        <span className="relative z-10">{o.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMonths(() =>
                      anyMonthOpen ? new Set() : new Set(mergedRows.flatMap((r) => (r.kind === "month" ? [r.month] : [])))
                    )
                  }
                  className="cursor-pointer rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-2xs transition-all duration-150 hover:bg-slate-50 hover:text-slate-900 active:scale-95"
                >
                  {anyMonthOpen ? "Thu gọn tất cả" : "Xem tất cả theo phôi"}
                </button>
              </div>
              {/* table-fixed + colgroup: độ rộng cột cố định, mở/đóng tháng không làm bảng co giãn */}
              <table className="w-full min-w-[960px] table-fixed border-collapse text-[13px] [&_td]:py-2.5 [&_td]:!text-[13px]">
                <colgroup>
                  <col className="w-[6%]" />
                  <col className="w-[16%]" />
                  <col className="w-[7%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[16%]" />
                  <col className="w-[7%]" />
                  <col className="w-[8%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${TH} text-left align-bottom !text-slate-700`}>Tháng</th>
                    <th colSpan={4} className={`${TH_BASE} ${SEP} text-center bg-blue-100 !text-blue-800`}>R&amp;D Testing</th>
                    <th colSpan={5} className={`${TH_BASE} ${SEP} text-center bg-emerald-100 !text-emerald-800`}>Đánh giá SKU WIN</th>
                  </tr>
                  <tr>
                    <th className={`${TH_BASE} ${SEP} text-left bg-blue-50 !text-blue-900`}>{nameLabel}</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Vốn test</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>% Hoàn vốn</th>
                    <th className={`${TH_BASE} ${SEP} text-left bg-emerald-50 !text-emerald-900`}>{nameLabel}</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>Mục tiêu</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>WIN thực tế</th>
                    <th className={`${TH_BASE} text-center bg-emerald-50 !text-emerald-900`}>Tỉ lệ WIN</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-emerald-50/70 [&>td]:font-bold">
                    <td className={`${TDL} font-semibold`}>Tổng</td>
                    <td className={`${TDL} ${SEP}`} />
                    <td className={`${TD} font-semibold`}>{listingYear.n}</td>
                    <td className={`${TD} font-semibold`}>{fmtUsd(listingYear.von)}</td>
                    <td className={`${TD} font-semibold`}>
                      <PctBar v={ratio(listingYear.hoanVon, listingYear.von)} />
                    </td>
                    <td className={`${TDL} ${SEP}`} />
                    <td className={`${TD} font-semibold`} title="SKU thuộc các tháng đánh giá đã đến hạn">
                      {evalYear.n || ""}
                    </td>
                    <td className={`${TD} font-semibold`}>{evalYear.n ? fmtTarget(evalYear.n * WIN_TARGET_RATE) : ""}</td>
                    <td className={`${TD} font-semibold`} title={evalYear.pendingN ? `${evalYear.pendingN} SKU chưa điền kết quả` : undefined}>
                      {evalYear.doneN ? evalYear.win : ""}
                    </td>
                    <td className={`${TD} text-center font-semibold`}>
                      <RatePill v={ratio(evalYear.win, evalYear.doneN)} />
                    </td>
                  </tr>
                  {mergedRows.map((row, idx) => {
                    // Dòng xen kẽ màu cho dễ dò theo hàng
                    const stripe = idx % 2 === 1 ? "bg-slate-50/80" : "bg-white";
                    if (row.kind === "empty")
                      return (
                        <tr key={`e${row.from}`} className={stripe}>
                          <td className={`${TDL} pl-8 font-semibold !text-slate-500`}>T{row.from === row.to ? row.from : `${row.from}–T${row.to}`}</td>
                          <td colSpan={4} className={`${TDL} ${SEP} !text-center !text-slate-400`}>
                            Không có
                          </td>
                          <td colSpan={5} className={`${TDL} ${SEP} !text-center !text-slate-400`}>
                            Không có
                          </td>
                        </tr>
                      );
                    const { l, e } = row;
                    const rate = e && e.win != null ? ratio(e.win, e.doneN) : null;
                    const open = openMonths.has(row.month);
                    // Hai khối độc lập (như Excel): mỗi bên tự liệt kê phôi của mình, dòng i bên trái không liên quan dòng i bên phải
                    const lRows = l?.rows ?? [];
                    const eRows = e?.rows ?? [];
                    const childN = Math.max(lRows.length, eRows.length);
                    return (
                      <Fragment key={row.month}>
                        <tr
                          className={`cursor-pointer transition-colors duration-150 hover:!bg-amber-50/60 ${open ? "bg-blue-50 [&>td]:!font-bold [&>td]:!text-slate-900" : stripe}`}
                          onClick={() => toggleMonth(row.month)}
                        >
                          <td
                            rowSpan={childN + 1}
                            className={`${TDL} font-semibold ${open ? "!align-top border-l-4 border-l-blue-500 bg-blue-50" : ""}`}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <CaretRightIcon
                                size={12}
                                className={`transition-transform duration-200 ease-out shrink-0 ${open ? "rotate-90 text-blue-600 font-bold" : "text-slate-400"}`}
                              />
                              T{monthNum(row.month)}
                            </span>
                          </td>
                          {l ? (
                            <>
                              <td className={`${TDL} ${SEP} ${open ? "" : "!text-slate-700"}`}>{open ? (byPerson ? "" : `${lRows.length} phôi`) : "Tất cả"}</td>
                              <td className={TD}>{l.n}</td>
                              <td className={TD}>{fmtUsd(l.von)}</td>
                              <td className={TD}>
                                <PctBar v={ratio(l.hoanVon, l.von)} />
                              </td>
                            </>
                          ) : (
                            <td colSpan={4} className={`${TDL} ${SEP} !text-center`}>
                              <span className="font-normal text-slate-400">Không có</span>
                            </td>
                          )}
                          {e ? (
                            <>
                              <td className={`${TDL} ${SEP} ${open ? "" : "!text-slate-700"}`}>{open ? (byPerson ? "" : `${eRows.length} phôi`) : "Tất cả"}</td>
                              <td className={`${TD} ${!e.due ? "!text-slate-400" : ""}`}>{e.n}</td>
                              <td className={`${TD} ${!e.due ? "!text-slate-400" : ""}`}>{fmtTarget(e.n * WIN_TARGET_RATE)}</td>
                              <td className={TD} title={e.due && e.win != null && e.doneN < e.n ? `${e.n - e.doneN} SKU chưa điền kết quả` : undefined}>
                                {!e.due ? (
                                  <span className="text-[11px] text-slate-400">chưa đến hạn</span>
                                ) : e.win != null ? (
                                  e.win
                                ) : (
                                  <span className="text-[11px] font-semibold text-amber-700">chưa điền</span>
                                )}
                              </td>
                              <td className={`${TD} text-center`}>{rate != null && <RatePill v={rate} />}</td>
                            </>
                          ) : (
                            <td colSpan={5} className={`${TDL} ${SEP} !text-center`}>
                              <span className="font-normal text-slate-400">Không có</span>
                            </td>
                          )}
                        </tr>
                        {Array.from({ length: childN }, (_, pi) => {
                          const lr = lRows[pi];
                          const er = eRows[pi];
                          const last = pi === childN - 1;
                          // Dòng con luôn có trong bảng, đóng thì cao 0 — mở ra trượt xuống mượt
                          const cell = `!p-0 ${open ? "" : "!border-y-0"}`;
                          const blank = (span: number) => (
                            <td colSpan={span} className={`${TDL} ${SEP} ${cell}`}>
                              <Slide open={open}>{"\u00a0"}</Slide>
                            </td>
                          );
                          const name = (text: string) => (
                            <td className={`${TDL} ${SEP} ${cell}`}>
                              <Slide open={open} className="truncate pl-5" >
                                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-slate-300 align-middle" />
                                <span title={text}>{text}</span>
                              </Slide>
                            </td>
                          );
                          return (
                            <tr
                              key={pi}
                              aria-hidden={!open}
                              className={`bg-white transition-colors duration-150 hover:!bg-amber-50/50 [&_td]:!text-slate-600 ${
                                open && last ? "[&_td]:border-b-2 [&_td]:border-b-blue-200" : ""
                              }`}
                            >
                              {lr ? (
                                <>
                                  {name(lr.phoi)}
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open}>{lr.n}</Slide>
                                  </td>
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open}>{fmtUsd(lr.von)}</Slide>
                                  </td>
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open}>
                                      <PctBar v={ratio(lr.hoanVon, lr.von)} />
                                    </Slide>
                                  </td>
                                </>
                              ) : (
                                blank(4)
                              )}
                              {er && e ? (
                                <>
                                  {name(er.phoi)}
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open}>{er.n}</Slide>
                                  </td>
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open}>{fmtTarget(er.n * WIN_TARGET_RATE)}</Slide>
                                  </td>
                                  <td className={`${TD} ${cell}`}>
                                    <Slide open={open} className="!py-1.5">
                                      {byPerson ? (
                                        e.due ? er.win : <span className="text-[11px] text-slate-400">chưa đến hạn</span>
                                      ) : (
                                        <WinInput
                                          key={`${e.month}|${er.phoi}|${er.win ?? ""}`}
                                          value={er.win}
                                          max={er.n}
                                          suggest={er.suggest}
                                          disabled={!open || !canEdit || !e.due}
                                          saving={savingWin === `${e.month}|${er.phoi}`}
                                          onCommit={(v) => saveWin(e.month, er.phoi, v)}
                                        />
                                      )}
                                    </Slide>
                                  </td>
                                  <td className={`${TD} text-center ${cell}`}>
                                    <Slide open={open}>
                                      <RatePill v={er.win != null && (!byPerson || e.due) ? ratio(er.win, er.n) : null} />
                                    </Slide>
                                  </td>
                                </>
                              ) : (
                                blank(5)
                              )}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {noEvalCount > 0 && <p className="px-3 py-2 text-[11px] text-slate-600">{noEvalCount} SKU chưa có tháng đánh giá</p>}
            </section>

            <KqkdPeople
              skus={baseSkus}
              currentMonth={currentMonth}
              role={peopleRole}
            />
          </AccountingViewTransition>
        )}

        {/* SKU TESTING */}
        {mode === "skus" && allSkus.length > 0 && (
          <AccountingViewTransition transitionKey="skus" className="flex-1 overflow-auto scrollbar-thin">
            {/* border-separate: tiêu đề dính (sticky) mang theo viền của ô — border-collapse để lại khe trong suốt giữa các dòng khi cuộn.
                Bỏ viền trên/trái của từng ô để không bị viền đôi; giữ vạch dọc đậm (kq-sep) đầu mỗi nhóm cột. */}
            <table className="min-w-max border-separate border-spacing-0 text-xs [&_td]:!border-black [&_th]:!border-black [&_td]:border-t-0 [&_th]:border-t-0 [&_td:not(.kq-sep)]:border-l-0 [&_th:not(.kq-sep)]:border-l-0 [&_thead_tr:last-child>td]:border-b-2 [&_thead_tr:last-child>td]:border-b-slate-300">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th colSpan={3} className={`${TH_BASE} text-left bg-[#FF8C00] !text-black !border-black !border-t !border-l sticky left-0 z-30`}>Thông tin cơ bản</th>
                  <th colSpan={5} className={`${TH_BASE} bg-[#FF8C00] !border-black !border-t`} />
                  <th colSpan={10} className={`${TH_BASE} ${SEP} text-left bg-blue-200 !text-blue-900`}>Life time</th>
                  {tableMonths.map((m, mi) => (
                    <th
                      key={m.month}
                      colSpan={monthMetrics.length}
                      className={`${TH_BASE} ${SEP} text-left ${mi % 2 ? "bg-amber-200 !text-amber-900" : "bg-violet-200 !text-violet-900"}`}
                      title={m.source === "closed" ? "Số đã chốt sổ tháng" : "Tính từ dữ liệu ngày (chưa chốt sổ)"}
                    >
                      {monthLabel(m.month)}
                      {m.month >= currentMonth && <span className="ml-1 font-normal text-slate-400">tạm tính</span>}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black !border-l sticky left-0 z-30 w-[40px] min-w-[40px] max-w-[40px] !px-1 text-center`}>STT</th>
                  <FilterTh k="product_type" sort={sort} filters={colFilters} onOpen={openFilter} align="left" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black sticky left-[40px] z-30 w-[180px] min-w-[180px] max-w-[180px] text-left`}>Product Type</FilterTh>
                  <FilterTh k="sku" sort={sort} filters={colFilters} onOpen={openFilter} align="left" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black sticky left-[220px] z-30 text-left`}>SKU</FilterTh>
                  <FilterTh k="status" sort={sort} filters={colFilters} onOpen={openFilter} align="left" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black text-left`}>Trạng thái</FilterTh>
                  <FilterTh k="pic_idea" sort={sort} filters={colFilters} onOpen={openFilter} align="left" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black text-left`}>PIC Idea</FilterTh>
                  <FilterTh k="listing_month" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black text-right`}>Tháng listing</FilterTh>
                  <FilterTh k="eval_month" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black text-right`}>Tháng đánh giá</FilterTh>
                  <FilterTh k="eval_window" sort={sort} filters={colFilters} onOpen={openFilter} align="left" className={`${TH_BASE} bg-[#FF8C00] !text-black !border-black text-left`}>Thời gian đánh giá</FilterTh>
                  <FilterTh k="von_hang" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} !bg-yellow-200 !text-yellow-900 ${SEP} text-right`}>Tổng vốn hàng</FilterTh>
                  <FilterTh k="revenue" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Revenue</FilterTh>
                  <FilterTh k="quantity" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Quantity</FilterTh>
                  <FilterTh k="basecost" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Basecost</FilterTh>
                  <FilterTh k="ads_fee" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Ads Fee</FilterTh>
                  <FilterTh k="tacos" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>TAcos</FilterTh>
                  <FilterTh k="profit" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} !bg-yellow-200 !text-yellow-900 text-right`}>Profit</FilterTh>
                  <FilterTh k="roi" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>ROI</FilterTh>
                  <FilterTh k="qty_di" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Số lượng đi hàng</FilterTh>
                  <FilterTh k="ton" sort={sort} filters={colFilters} onOpen={openFilter} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Tồn</FilterTh>
                  {tableMonths.map((m) =>
                    monthMetrics.map((mt, j) => (
                      <SortTh
                        key={`${m.month}-${mt.key}`}
                        k={`m|${m.month}|${mt.key}`}
                        sort={sort}
                        onSort={onSort}
                        className={`${TH_BASE} text-right ${j === 0 ? SEP : ""} ${tableMonths.indexOf(m) % 2 ? "bg-amber-100 !text-amber-900" : "bg-violet-100 !text-violet-900"}`}
                      >
                        {mt.label}
                      </SortTh>
                    ))
                  )}
                </tr>
                <tr className={TOTAL_ROW}>
                  <td className={`${TDL} font-semibold sticky left-0 z-30 w-[40px] min-w-[40px] max-w-[40px] !px-1 text-center bg-slate-100`}>Tổng</td>
                  <td className={`${TDL} font-semibold sticky left-[40px] z-30 w-[180px] min-w-[180px] max-w-[180px] bg-slate-100`}>
                    {phoiCount.shown}
                    {phoiCount.shown !== phoiCount.all && <span className="font-normal text-slate-500">/{phoiCount.all}</span>} phôi
                  </td>
                  <td className={`${TDL} font-semibold sticky left-[220px] z-30 bg-slate-100`}>
                    {skus.length}
                    {skus.length !== allSkus.length && <span className="font-normal text-slate-500">/{allSkus.length}</span>} SKU
                  </td>
                  <td colSpan={5} className={`${TDL} font-semibold`} />
                  <td className={`${TD} ${SEP} ${YELLOW_CELL} font-semibold`}>{fmtUsd(totals.von)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.revenue)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.quantity)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.basecost)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.ads)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(-totals.ads, totals.revenue))}</td>
                  <td className={`${TD} ${PROFIT_CELL} font-semibold ${signClass(totals.profit)}`}>{fmtUsd(totals.profit)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(totals.profit, totals.basecost))}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.qtyDi)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.ton)}</td>
                  {tableMonths.map((m) =>
                    monthMetrics.map((mt, j) => {
                      const v = totalMetric(m.month, mt.key);
                      return (
                        <td key={`${m.month}-${mt.key}`} className={`${TD} ${j === 0 ? SEP : ""} font-semibold ${mt.key === "profit" ? signClass(v) : ""}`}>
                          {fmtMetric(v, mt.key)}
                        </td>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {skus.length === 0 && (
                  <tr>
                    <td colSpan={18 + tableMonths.length * monthMetrics.length} className="px-4 py-10 text-left text-sm !text-slate-500">
                      Không có SKU khớp bộ lọc.{" "}
                      <button type="button" onClick={clearFilters} className="cursor-pointer font-semibold text-blue-600 hover:underline">
                        Xoá lọc
                      </button>
                    </td>
                  </tr>
                )}
                {skus.map((s, i) => {
                  const d = derive(s);
                  return (
                    <tr key={s.sku} className="group bg-white even:bg-slate-50/70 transition-colors duration-150 hover:!bg-orange-50 [content-visibility:auto] [contain-intrinsic-size:36px]">
                      <td className={`${TD} sticky left-0 z-10 w-[40px] min-w-[40px] max-w-[40px] !px-1 !text-center !text-slate-400 bg-white group-even:bg-slate-50 group-hover:!bg-orange-50 transition-colors duration-150`}>
                        {i + 1}
                      </td>
                      <td
                        className={`${TDL} sticky left-[40px] z-10 w-[180px] min-w-[180px] max-w-[180px] truncate bg-white group-even:bg-slate-50 group-hover:!bg-orange-50 transition-colors duration-150`}
                        title={s.product_type || ""}
                      >
                        {s.product_type}
                      </td>
                      <td className={`${TDL} sticky left-[220px] z-10 bg-white shadow-[1px_0_0_#e2e8f0] group-even:bg-slate-50 group-hover:!bg-orange-50 transition-colors duration-150`}>
                        <span className="flex items-center gap-2">
                          <ThumbZoom url={s.mockup_url} />
                          <span className="font-mono text-[11.5px] font-bold text-slate-900">{s.sku}</span>
                        </span>
                      </td>
                      <td className={`${TDL} ${statusCellClass(s.status)}`}>
                        <StatusPill status={s.status} />
                      </td>
                      <td className={TDL}>{s.pic_idea}</td>
                      <td className={TD}>{monthLabel(s.listing_month)}</td>
                      <td className={TD}>{s.eval_month ? monthLabel(s.eval_month) : ""}</td>
                      {(() => {
                        const w = evalWindow(s.listing_month);
                        // Chưa đánh giá mà quá hạn / đến hạn / sắp đến hạn: đỏ tươi; đã đánh giá: nền nhạt; còn xa: hồng nhạt
                        const st = evalState(s, currentMonth);
                        const cls = needsEval(st)
                          ? "!bg-[#FF0000] !font-normal !text-slate-950"
                          : st === "done"
                            ? "!bg-[#AFD788] !text-slate-950"
                            : "!bg-rose-50 !text-rose-700";
                        return (
                          <td
                            className={`${TDL} ${cls}`}
                            title={`Đánh giá ${monthLabel(w.from)} – ${monthLabel(w.to)} (listing ${monthLabel(s.listing_month)} + 3–4 tháng) · ${EVAL_STATE_LABEL[st]}`}
                          >
                            {w.label}
                          </td>
                        );
                      })()}
                      <td className={`${TD} ${SEP} ${YELLOW_CELL} ${zc(s.von_hang)}`}>{fmtUsd(s.von_hang)}</td>
                      <td className={`${TD} ${zc(s.revenue)}`}>{fmtUsd(s.revenue)}</td>
                      <td className={`${TD} ${zc(s.quantity)}`}>{fmtInt(s.quantity)}</td>
                      <td className={`${TD} ${zc(d.basecost)}`}>{fmtUsd(d.basecost)}</td>
                      <td className={`${TD} ${zc(s.ads_fee)}`}>{fmtUsd(s.ads_fee)}</td>
                      <td className={`${TD} ${zc(d.tacos)}`}>{fmtPct(d.tacos)}</td>
                      <td className={`${TD} ${s.profit <= -0.005 ? NEG_CELL : `${PROFIT_CELL} font-semibold ${profitCls(s.profit)}`}`}>{fmtUsd(s.profit)}</td>
                      <td className={`${TD} ${zc(d.roi)}`}>{fmtPct(d.roi)}</td>
                      <td className={`${TD} ${zc(s.qty_di)}`}>{fmtInt(s.qty_di)}</td>
                      <td
                        className={`${TD} ${zc(d.ton)}`}
                        title={
                          d.ton == null
                            ? "Chưa có dữ liệu tồn kho (Inventory Ledger) cho SKU này"
                            : `Tồn kho hệ thống${s.ton_kho_updated_at ? ` · cập nhật ${s.ton_kho_updated_at.slice(0, 10)}` : ""}`
                        }
                      >
                        {fmtInt(d.ton)}
                      </td>
                      {tableMonths.map((m) => {
                        const before = m.month < s.listing_month;
                        return monthMetrics.map((mt, j) => {
                          const v = cellMetric(s.months[m.month], mt.key, s.unit_cost);
                          return (
                            <td
                              key={`${m.month}-${mt.key}`}
                              className={`${TD} ${j === 0 ? SEP : ""} ${before ? "bg-slate-100/70" : ""} ${mt.key === "profit" ? (v != null && v <= -0.005 ? NEG_CELL : profitCls(v)) : zc(v)}`}
                            >
                              {fmtMetric(v, mt.key)}
                            </td>
                          );
                        });
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filterOpen && (
              <ColumnFilterPopover
                key={filterOpen.key}
                open={filterOpen}
                options={filterOptions}
                selected={colFilters[filterOpen.key]}
                sortDir={sort?.key === filterOpen.key ? sort.dir : null}
                textSort={TEXT_SORT_KEYS.has(filterOpen.key)}
                onSort={(dir) => {
                  setSort({ key: filterOpen.key, dir });
                  setFilterOpen(null);
                }}
                onApply={(next) => {
                  const key = filterOpen.key;
                  setColFilters((prev) => {
                    const out = { ...prev };
                    if (next) out[key] = next;
                    else delete out[key];
                    return out;
                  });
                  setFilterOpen(null);
                }}
                onClose={closeFilter}
              />
            )}
          </AccountingViewTransition>
        )}
      </div>
    </div>
  );
}
