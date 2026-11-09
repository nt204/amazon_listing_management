/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useDeferredValue, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsDownUpIcon,
  CaretRightIcon,
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

interface KqkdData {
  year: number;
  months: { month: string; source: "closed" | "live" }[];
  skus: KqkdSku[];
  winResults: { eval_month: string; product_type: string; win_count: number; updated_by: string | null; updated_at: string }[];
  generatedAt: string;
}

type ViewMode = "overview" | "skus";
type Metric = "revenue" | "quantity" | "ads_fee" | "tacos" | "profit" | "roi";

// Sheet: Mục tiêu SKU WIN = 40% × số SKU đánh giá
const WIN_TARGET_RATE = 0.4;
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
    ton: s.qty_di - s.quantity,
  };
}

// Sắp xếp bảng SKU Testing: key = tên cột, hoặc "m|YYYY-MM|metric" cho cột theo tháng
type SortState = { key: string; dir: "asc" | "desc" } | null;
const TEXT_SORT_KEYS = new Set(["sku", "product_type", "status", "pic_idea", "listing_month", "eval_month"]);

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
  items: { month: number; target: number | null; win: number | null; rate: number | null; note?: string; tip: string }[];
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
            <div key={it.month} title={it.tip} className="group/bar relative flex h-full flex-1 items-end justify-center gap-[3px] rounded-t-sm transition-colors duration-150 hover:bg-slate-100/70">
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

// Trạng thái SKU (Bảng mã): WIN = Phát triển · Đang test · Dừng = Hủy
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

// Số Profit gọn: $1.6k · $245 · dưới $10 giữ 2 số lẻ (tránh hiện "-$0")
function compactProfit(v: number) {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 0.005 ? "-" : "";
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  if (a >= 10) return `${sign}${usd0.format(a)}`;
  return `${sign}$${a.toFixed(2)}`;
}

// Sparkline Profit từng tháng: trục 0 ở giữa, lãi = cột xanh lên, lỗ = cột đỏ xuống.
// Tháng trước khi listing bỏ trống; tháng hiện tại (tạm tính) tô nhạt. Bên cạnh ghi tổng Profit để biết độ lớn.
function ProfitSpark({
  values,
  total,
}: {
  values: { label: string; v: number | null; before?: boolean; partial?: boolean }[];
  total?: number;
}) {
  const W = 132;
  const H = 30;
  const mid = H / 2;
  // Thang tối thiểu $50: SKU chỉ lãi/lỗ vài đô không bị vẽ cột cao vống như SKU lãi hàng nghìn
  const max = Math.max(50, ...values.map((x) => (x.before ? 0 : Math.abs(x.v ?? 0))));
  const slot = W / Math.max(values.length, 1);
  const bw = Math.max(4, Math.min(8, slot - 2));
  return (
    <span className="flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block shrink-0">
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="#cbd5e1" strokeWidth={1} />
        {values.map((x, i) => {
          if (x.before || x.v == null || x.v === 0) return null;
          const h = Math.max(1.5, (Math.abs(x.v) / max) * (mid - 1));
          return (
            <rect
              key={x.label}
              x={slot * i + (slot - bw) / 2}
              y={x.v > 0 ? mid - h : mid}
              width={bw}
              height={h}
              rx={1}
              fill={x.v > 0 ? "#16a34a" : "#dc2626"}
              opacity={x.partial ? 0.4 : 1}
            >
              <title>{`${x.label}: Profit ${usd.format(x.v)}${x.partial ? " (tạm tính)" : ""}`}</title>
            </rect>
          );
        })}
      </svg>
      {total != null && (
        <span className={`w-14 text-right font-mono text-[11px] font-semibold tabular-nums ${total > 0 ? "text-emerald-700" : total < 0 ? "text-red-600" : "text-slate-300"}`}>
          {compactProfit(total)}
        </span>
      )}
    </span>
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
      className={`inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold transition-all duration-150 ${ok ? "bg-emerald-50 text-emerald-700 shadow-2xs" : "bg-slate-100 text-slate-600"}`}
    >
      {fmtPct(v)}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  return <span className={statusKind(status) === "loss" ? "text-slate-400" : ""}>{status}</span>;
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-4 py-3.5 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xs select-none ${
        highlight ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-[12px] font-semibold text-slate-500">{label}</div>
      <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tracking-tight tabular-nums transition-colors duration-200 ${highlight ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
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
function personNames(skus: KqkdSku[], role: PersonRole) {
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

  // SKU trong một người: theo cột đang sắp nếu SKU có cột tương ứng, mặc định Profit giảm dần
  const SKU_SORT_KEY: Record<string, string> = {
    von: "von_hang",
    revenue: "revenue",
    ads: "ads_fee",
    profit: "profit",
    hoanVonPct: "hoanVonPct",
    name: "sku",
  };
  const sortSkus = (list: KqkdSku[]) => {
    const k = sort ? SKU_SORT_KEY[sort.key] : undefined;
    if (!sort || !k) return list;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, k);
      const y = sortValue(b, k);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      if (typeof x === "string" || typeof y === "string") return sign * String(x).localeCompare(String(y), "vi");
      return sign * (x - y);
    });
  };
  const filtering = Boolean(q || fKind || sort);


  const maxAbsProfit = Math.max(1, ...people.map((p) => Math.abs(p.profit)));
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
          title="Tỉ lệ WIN = SKU trạng thái “Phát triển” / SKU đã đến tháng đánh giá. Bấm vào một người để xem từng SKU."
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
              { k: "loss", label: "Dừng" },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              aria-pressed={fKind === o.k}
              onClick={() => setFKind(o.k)}
              className={`cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-all duration-150 ${
                fKind === o.k ? "bg-white text-blue-700 shadow-2xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {o.label}
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
              <th colSpan={4} className={`${TH_BASE} ${SEP} text-center bg-blue-100 !text-blue-800`}>SKU</th>
              <th colSpan={2} className={`${TH_BASE} ${SEP} text-center bg-emerald-100 !text-emerald-800`}>WIN</th>
              <th colSpan={5} className={`${TH_BASE} ${SEP} text-center bg-violet-100 !text-violet-800`}>Tiền</th>
            </tr>
            <tr>
              <SortTh k="n" sort={sort} onSort={onSort} className={`${TH_BASE} ${SEP} text-right bg-blue-50 !text-blue-900`}>Tổng</SortTh>
              <SortTh k="win" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>WIN</SortTh>
              <SortTh k="test" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Đang test</SortTh>
              <SortTh k="loss" sort={sort} onSort={onSort} className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Dừng</SortTh>
              <SortTh k="winDue" sort={sort} onSort={onSort} className={`${TH_BASE} ${SEP} text-right bg-emerald-50 !text-emerald-900`}>WIN / đã đánh giá</SortTh>
              <SortTh k="rate" sort={sort} onSort={onSort} className={`${TH_BASE} text-center bg-emerald-50 !text-emerald-900`}>Tỉ lệ WIN</SortTh>
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
                <td colSpan={13} className="px-4 py-8 text-left text-sm !text-slate-500">
                  Không có người / SKU khớp bộ lọc.
                </td>
              </tr>
            )}
            {sortedPeople.map((p, i) => {
              const isOpen = open.has(p.key);
              const w = (Math.abs(p.profit) / maxAbsProfit) * 100;
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
                    <td className={`${TD} ${p.win ? "!text-emerald-700 font-semibold" : "!text-slate-300"}`}>{p.win}</td>
                    <td className={`${TD} ${zc(p.test)}`}>{p.test}</td>
                    <td className={`${TD} ${zc(p.loss)}`}>{p.loss}</td>
                    <td className={`${TD} ${SEP}`}>{p.due ? `${p.winDue}/${p.due}` : <span className="text-[11px] text-slate-400">chưa đến hạn</span>}</td>
                    <td className={`${TD} text-center`}><RatePill v={ratio(p.winDue, p.due)} /></td>
                    <td className={`${TD} ${SEP} ${zc(p.von)}`}>{fmtUsd(p.von)}</td>
                    <td className={`${TD} ${zc(p.revenue)}`}>{fmtUsd(p.revenue)}</td>
                    <td className={`${TD} ${zc(p.ads)}`}>{fmtUsd(p.ads)}</td>
                    <td className={`${TD} ${profitCls(p.profit)}`}>
                      <span className="flex items-center justify-end gap-2">
                        {fmtUsd(p.profit)}
                        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">
                          <span className={`block h-full rounded-full ${p.profit >= 0 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${w}%` }} />
                        </span>
                      </span>
                    </td>
                    <td className={TD}><HoanVonBar v={ratio(p.hoanVon, p.von)} /></td>
                  </tr>
                  {isOpen &&
                    sortSkus(p.skus).map((s, j) => {
                      const d = derive(s);
                      const last = j === p.skus.length - 1;
                      return (
                        <tr
                          key={s.sku}
                          className={`acc-rise bg-white hover:!bg-amber-50/50 [&_td]:!text-[12px] ${last ? "[&_td]:border-b-2 [&_td]:border-b-blue-200" : ""}`}
                          style={{ animationDelay: `${Math.min(j * 25, 400)}ms` }}
                        >
                          <td className={`${TD} !text-center !text-slate-300`}>{j + 1}</td>
                          <td className={`${TDL} pl-8`}>
                            <span className="flex items-center gap-2">
                              <ThumbZoom url={s.mockup_url} />
                              <span className="min-w-0">
                                <span className="block font-mono text-[11.5px] font-bold text-slate-900">{s.sku}</span>
                                <span className="block truncate text-[11px] text-slate-500" title={s.product_type || ""}>
                                  {s.product_type || "—"} · {monthLabel(s.listing_month)}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td colSpan={4} className={`${TDL} ${SEP}`}>
                            <StatusPill status={s.status} />
                          </td>
                          <td colSpan={2} className={`${TDL} ${SEP} !text-slate-500`}>
                            {s.eval_month ? `Đánh giá ${monthLabel(s.eval_month)}` : ""}
                          </td>
                          <td className={`${TD} ${SEP} ${zc(s.von_hang)}`}>{fmtUsd(s.von_hang)}</td>
                          <td className={`${TD} ${zc(s.revenue)}`}>{fmtUsd(s.revenue)}</td>
                          <td className={`${TD} ${zc(s.ads_fee)}`}>{fmtUsd(s.ads_fee)}</td>
                          <td className={`${TD} ${profitCls(s.profit)}`}>{fmtUsd(s.profit)}</td>
                          <td className={TD}><HoanVonBar v={d.hoanVonPct} /></td>
                        </tr>
                      );
                    })}
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
  const [fStatus, setFStatus] = useState("");
  const [fPic, setFPic] = useState("");
  const [fListM, setFListM] = useState("");
  const [fEvalM, setFEvalM] = useState("");
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
  const phoiOptions = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.product_type || "(trống)"))).sort((a, b) => a.localeCompare(b)),
    [allSkus]
  );
  const baseSkus = useMemo(() => (fPhoi ? allSkus.filter((s) => (s.product_type || "(trống)") === fPhoi) : allSkus), [allSkus, fPhoi]);
  const statuses = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.status).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [allSkus]
  );

  const deferredSearch = useDeferredValue(search);

  const picOptions = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.pic_idea?.trim() || "(trống)"))).sort((a, b) => a.localeCompare(b)),
    [allSkus]
  );
  const listMonthOptions = useMemo(() => Array.from(new Set(allSkus.map((s) => s.listing_month))).sort(), [allSkus]);
  const evalMonthOptions = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.eval_month).filter(Boolean) as string[])).sort(),
    [allSkus]
  );
  const activeFilters = [search, fStatus, fPhoi, fPic, fListM, fEvalM].filter(Boolean).length;
  const clearFilters = () => {
    setSearch("");
    setFStatus("");
    setFPhoi("");
    setFPic("");
    setFListM("");
    setFEvalM("");
  };

  // SKU Testing: Phôi (dùng chung với Tổng quan) + tìm kiếm + trạng thái + PIC + tháng, rồi sắp xếp
  const skus = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const out = baseSkus.filter(
      (s) =>
        (!fStatus || s.status === fStatus) &&
        (!fPic || (s.pic_idea?.trim() || "(trống)") === fPic) &&
        (!fListM || s.listing_month === fListM) &&
        (!fEvalM || (fEvalM === "none" ? !s.eval_month : s.eval_month === fEvalM)) &&
        (!q ||
          s.sku.toLowerCase().includes(q) ||
          (s.asin || "").toLowerCase().includes(q) ||
          (s.product_type || "").toLowerCase().includes(q) ||
          (s.pic_idea || "").toLowerCase().includes(q))
    );
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
  }, [baseSkus, deferredSearch, fStatus, fPic, fListM, fEvalM, sort]);

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
    for (const s of baseSkus) {
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
  }, [baseSkus, year, winMap, currentMonth]);

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

  // Bảng tháng: mở một tháng ra chia theo Phôi (mặc định) hoặc theo người (PIC Idea / PIC MKT / Design).
  // Số tổng của tháng giữ nguyên; chỉ các dòng con đổi cách gom. Theo người: WIN = số SKU "Phát triển" (chỉ xem, không điền).
  const [breakdown, setBreakdown] = useState<"phoi" | PersonRole>("phoi");
  const [peopleRole, setPeopleRole] = useState<PersonRole>("pic_idea");
  const pickBreakdown = (b: "phoi" | PersonRole) => {
    setBreakdown(b);
    if (b !== "phoi") setPeopleRole(b);
  };
  const byPerson = breakdown !== "phoi";
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
    const names = personNames(baseSkus, breakdown);
    return evals.map((e) => {
      const g = new Map<string, { n: number; suggest: number }>();
      for (const s of baseSkus) {
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
  }, [evals, baseSkus, breakdown]);

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
      { label: "Dừng", n: c.loss, color: "#cbd5e1" },
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
  const totals = useMemo(() => {
    let von = 0, revenue = 0, quantity = 0, basecost = 0, ads = 0, profit = 0, hoanVon = 0, qtyDi = 0;
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
    return { von, revenue, quantity, basecost, ads, profit, hoanVon, qtyDi, byMonth };
  }, [skus, months]);

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

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-2 font-sans">
      {/* TOOLBAR */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
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

        {allSkus.length > 0 && (
          <select id="kqkd-phoi" aria-label="Tên Phôi" value={fPhoi} onChange={(e) => setFPhoi(e.target.value)} className={selectCls}>
            <option value="">Tất cả phôi</option>
            {phoiOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        {mode === "skus" && allSkus.length > 0 && (
          <>
            <div className="relative w-44 transition-all duration-200 focus-within:w-56">
              <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="kqkd-search"
                type="text"
                placeholder="Tìm SKU, ASIN, phôi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-hidden focus:border-blue-500"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Xoá tìm kiếm">
                  <XIcon size={10} />
                </button>
              )}
            </div>
            <select id="kqkd-status" aria-label="Trạng thái" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
              <option value="">Tất cả trạng thái</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select id="kqkd-pic" aria-label="PIC Idea" value={fPic} onChange={(e) => setFPic(e.target.value)} className={selectCls}>
              <option value="">Tất cả PIC</option>
              {picOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select id="kqkd-listm" aria-label="Tháng listing" value={fListM} onChange={(e) => setFListM(e.target.value)} className={selectCls}>
              <option value="">Tháng listing: tất cả</option>
              {listMonthOptions.map((m) => (
                <option key={m} value={m}>
                  Listing {monthLabel(m)}
                </option>
              ))}
            </select>
            <select id="kqkd-evalm" aria-label="Tháng đánh giá" value={fEvalM} onChange={(e) => setFEvalM(e.target.value)} className={selectCls}>
              <option value="">Tháng đánh giá: tất cả</option>
              {evalMonthOptions.map((m) => (
                <option key={m} value={m}>
                  Đánh giá {monthLabel(m)}
                </option>
              ))}
              <option value="none">Chưa có tháng đánh giá</option>
            </select>
            {(activeFilters > 0 || sort) && (
              <button
                type="button"
                onClick={() => {
                  clearFilters();
                  setSort(null);
                }}
                className="animate-in fade-in zoom-in-95 duration-150 flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
              >
                <XIcon size={11} weight="bold" />
                Xoá lọc{activeFilters ? ` (${activeFilters})` : ""}
              </button>
            )}
            <select id="kqkd-metric" aria-label="Chỉ số theo tháng" value={metric} onChange={(e) => setMetric(e.target.value as Metric | "all")} className={selectCls}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  Theo tháng: {m.label}
                </option>
              ))}
              <option value="all">Theo tháng: tất cả chỉ số</option>
            </select>
          </>
        )}

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
            <div className="grid grid-cols-2 gap-3 p-3 pb-0 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label="Số lượng SKU" value={fmtInt(listingYear.n)} sub={`Listing ${year}`} />
              <Kpi
                label="Tổng vốn test"
                value={usd0.format(listingYear.von)}
                sub={`Hoàn vốn ${fmtPct(ratio(listingYear.hoanVon, listingYear.von)) || "0%"}`}
              />
              <Kpi
                label="Mục tiêu SKU WIN"
                value={evalYear.n ? `${Math.ceil(evalYear.n * WIN_TARGET_RATE - 1e-9)} SKU` : "—"}
                sub={`≥${Math.round(WIN_TARGET_RATE * 100)}% trên ${evalYear.n} SKU`}
              />
              <Kpi
                label="SKU WIN (KQ thực tế)"
                value={evalYear.doneN ? `${fmtInt(evalYear.win)}/${fmtInt(evalYear.doneN)}` : "—"}
                sub={evalYear.pendingN ? `${evalYear.pendingN} SKU chưa điền` : "Đã đánh giá"}
              />
              {(() => {
                const r = ratio(evalYear.win, evalYear.doneN);
                const diff = r != null ? (r - WIN_TARGET_RATE) * 100 : null;
                return (
                  <Kpi
                    label="Tỉ lệ WIN"
                    value={r != null ? fmtPct(r) : "—"}
                    sub={
                      diff != null
                        ? `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} điểm % so với mục tiêu`
                        : undefined
                    }
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
                  if (!e.due) return { month: m, target: null, win: null, rate: null, note: "chưa đến hạn", tip: `Tháng ${m}: ${e.n} SKU, chưa đến hạn đánh giá` };
                  const target = e.n * WIN_TARGET_RATE;
                  if (e.win != null) {
                    const r = ratio(e.win, e.doneN);
                    return {
                      month: m,
                      target,
                      win: e.win,
                      rate: r,
                      tip: `Tháng ${m}: ${e.win}/${e.doneN} SKU WIN / SKU đã đánh giá = ${fmtPct(r)} · mục tiêu ${fmtTarget(target)} (${Math.round(WIN_TARGET_RATE * 100)}% × ${e.n})${e.doneN < e.n ? ` · ${e.n - e.doneN} SKU chưa điền` : ""}`,
                    };
                  }
                  return {
                    month: m,
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
                  <span className="ml-2 text-[11px] font-semibold text-slate-500">Chi tiết theo:</span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {([{ key: "phoi", label: "Phôi" }, ...PERSON_ROLES] as const).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        aria-pressed={breakdown === o.key}
                        onClick={() => pickBreakdown(o.key)}
                        className={`cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors duration-150 ${
                          breakdown === o.key ? "bg-white text-blue-700 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        {o.label}
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
                  <col className="w-[8%]" />
                  <col className="w-[22%]" />
                  <col className="w-[8%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[9%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${TH} text-left align-bottom !text-slate-700`}>Tháng</th>
                    <th rowSpan={2} className={`${TH} text-left align-bottom !text-slate-700`}>{byPerson ? PERSON_ROLES.find((r) => r.key === breakdown)?.label : "Tên Phôi"}</th>
                    <th colSpan={3} className={`${TH_BASE} ${SEP} text-center bg-blue-100 !text-blue-800`}>R&amp;D Testing</th>
                    <th colSpan={4} className={`${TH_BASE} ${SEP} text-center bg-emerald-100 !text-emerald-800`}>Đánh giá SKU WIN</th>
                  </tr>
                  <tr>
                    <th className={`${TH_BASE} ${SEP} text-right bg-blue-50 !text-blue-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Vốn test</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>% Hoàn vốn</th>
                    <th className={`${TH_BASE} ${SEP} text-right bg-emerald-50 !text-emerald-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>Mục tiêu</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>WIN thực tế</th>
                    <th className={`${TH_BASE} text-center bg-emerald-50 !text-emerald-900`}>Tỉ lệ WIN</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-emerald-50/70 [&>td]:font-bold">
                    <td className={`${TDL} font-semibold`}>Tổng</td>
                    <td className={TDL} />
                    <td className={`${TD} ${SEP} font-semibold`}>{listingYear.n}</td>
                    <td className={`${TD} font-semibold`}>{fmtUsd(listingYear.von)}</td>
                    <td className={`${TD} font-semibold`}>
                      <PctBar v={ratio(listingYear.hoanVon, listingYear.von)} />
                    </td>
                    <td className={`${TD} ${SEP} font-semibold`} title="SKU thuộc các tháng đánh giá đã đến hạn">
                      {evalYear.n || ""}
                    </td>
                    <td className={`${TD} font-semibold`}>{evalYear.n ? fmtTarget(evalYear.n * WIN_TARGET_RATE) : ""}</td>
                    <td className={`${TD} font-semibold`} title="SKU WIN / SKU đã đánh giá">
                      {evalYear.doneN ? `${evalYear.win}/${evalYear.doneN}` : ""}
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
                          <td className={`${TDL} !text-slate-400`}>Không có</td>
                          <td colSpan={3} className={`${TDL} ${SEP} !text-center !text-slate-400`}>
                            Không có
                          </td>
                          <td colSpan={4} className={`${TDL} ${SEP} !text-center !text-slate-400`}>
                            Không có
                          </td>
                        </tr>
                      );
                    const { l, e } = row;
                    const rate = e && e.win != null ? ratio(e.win, e.doneN) : null;
                    const open = openMonths.has(row.month);
                    return (
                      <Fragment key={row.month}>
                        <tr
                          className={`cursor-pointer transition-colors duration-150 hover:!bg-amber-50/60 ${open ? "bg-blue-50 [&>td]:!font-bold [&>td]:!text-slate-900" : stripe}`}
                          onClick={() => toggleMonth(row.month)}
                        >
                          <td
                            rowSpan={row.phoi.length + 1}
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
                          <td className={`${TDL} ${open ? "font-bold !text-slate-900" : "!text-slate-700"}`}>
                            {open ? `Tổng ${row.phoi.length} ${byPerson ? "người" : "phôi"}` : "Tất cả"}
                          </td>
                          {l ? (
                            <>
                              <td className={`${TD} ${SEP}`}>{l.n}</td>
                              <td className={TD}>{fmtUsd(l.von)}</td>
                              <td className={TD}>
                                <PctBar v={ratio(l.hoanVon, l.von)} />
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} className={`${TDL} ${SEP} !text-center`}>
                              <span className="font-normal text-slate-400">Không có</span>
                            </td>
                          )}
                          {!e && (
                            <td colSpan={4} className={`${TDL} ${SEP} !text-center`}>
                              <span className="font-normal text-slate-400">Không có</span>
                            </td>
                          )}
                          {e && (
                            <>
                              <td className={`${TD} ${SEP} ${!e.due ? "!text-slate-400" : ""}`}>{e.n}</td>
                              <td className={`${TD} ${!e.due ? "!text-slate-400" : ""}`}>{fmtTarget(e.n * WIN_TARGET_RATE)}</td>
                              <td className={TD} title={e.win != null ? "SKU WIN / SKU đã đánh giá" : undefined}>
                                {!e.due ? (
                                  <span className="text-[11px] text-slate-400">chưa đến hạn</span>
                                ) : e.win != null ? (
                                  `${e.win}/${e.doneN}`
                                ) : (
                                  <span className="text-[11px] font-semibold text-amber-700">chưa điền</span>
                                )}
                              </td>
                              <td className={`${TD} text-center`}>{rate != null && <RatePill v={rate} />}</td>
                            </>
                          )}
                        </tr>
                        {row.phoi.map((phoi, pi) => {
                            const lr = l?.rows.find((r) => r.phoi === phoi);
                            const er = e?.rows.find((r) => r.phoi === phoi);
                            const last = pi === row.phoi.length - 1;
                            // Dòng phôi luôn có trong bảng, đóng thì cao 0 — mở ra trượt xuống mượt
                            const cell = `!p-0 ${open ? "" : "!border-y-0"}`;
                            const none = (span: number, wholeMonthEmpty: boolean) => (
                              <td colSpan={span} className={`${TDL} ${SEP} ${cell} !text-center !text-slate-300`}>
                                <Slide open={open}>{wholeMonthEmpty ? "\u00a0" : "—"}</Slide>
                              </td>
                            );
                            return (
                              <tr
                                key={phoi}
                                aria-hidden={!open}
                                className={`bg-white transition-colors duration-150 hover:!bg-amber-50/50 [&_td]:!text-slate-600 ${
                                  open && last ? "[&_td]:border-b-2 [&_td]:border-b-blue-200" : ""
                                }`}
                              >
                                <td className={`${TDL} ${cell}`}>
                                  <Slide open={open} className="pl-6">
                                    <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-slate-300 align-middle" />
                                    {phoi}
                                  </Slide>
                                </td>
                                {lr ? (
                                  <>
                                    <td className={`${TD} ${SEP} ${cell}`}>
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
                                  none(3, !l)
                                )}
                                {er && e ? (
                                  <>
                                    <td className={`${TD} ${SEP} ${cell}`}>
                                      <Slide open={open}>{er.n}</Slide>
                                    </td>
                                    <td className={`${TD} ${cell}`}>
                                      <Slide open={open}>{fmtTarget(er.n * WIN_TARGET_RATE)}</Slide>
                                    </td>
                                    <td className={`${TD} ${cell}`}>
                                      <Slide open={open} className="!py-1.5">
                                        {byPerson ? (
                                          e.due ? `${er.win}/${er.n}` : <span className="text-[11px] text-slate-400">chưa đến hạn</span>
                                        ) : (
                                        <WinInput
                                          key={`${e.month}|${phoi}|${er.win ?? ""}`}
                                          value={er.win}
                                          max={er.n}
                                          suggest={er.suggest}
                                          disabled={!open || !canEdit || !e.due}
                                          saving={savingWin === `${e.month}|${phoi}`}
                                          onCommit={(v) => saveWin(e.month, phoi, v)}
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
                                  none(4, !e)
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
            <table className="min-w-max border-separate border-spacing-0 text-xs [&_td]:border-t-0 [&_th]:border-t-0 [&_td:not(.kq-sep)]:border-l-0 [&_th:not(.kq-sep)]:border-l-0 [&_thead_tr:last-child>td]:border-b-2 [&_thead_tr:last-child>td]:border-b-slate-300">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th colSpan={8} className={`${TH_BASE} text-left bg-emerald-100 !text-emerald-900`}>Thông tin cơ bản</th>
                  <th colSpan={12} className={`${TH_BASE} ${SEP} text-left bg-blue-200 !text-blue-900`}>Life time</th>
                  {months.map((m, mi) => (
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
                  <th className={`${TH_BASE} bg-emerald-50 !text-emerald-900 sticky left-0 z-30 w-10 min-w-10 !px-1 text-center`}>STT</th>
                  <SortTh k="sku" sort={sort} onSort={onSort} align="left" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 sticky left-10 z-30 text-left`}>SKU</SortTh>
                  <th className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-left`}>Profit theo tháng</th>
                  <SortTh k="product_type" sort={sort} onSort={onSort} align="left" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-left`}>Product Type</SortTh>
                  <SortTh k="status" sort={sort} onSort={onSort} align="left" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-left`}>Trạng thái</SortTh>
                  <SortTh k="pic_idea" sort={sort} onSort={onSort} align="left" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-left`}>PIC Idea</SortTh>
                  <SortTh k="listing_month" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-right`}>Tháng listing</SortTh>
                  <SortTh k="eval_month" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-emerald-50 !text-emerald-900 text-right`}>Tháng đánh giá</SortTh>
                  <SortTh k="von_hang" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 ${SEP} text-right`}>Tổng vốn hàng</SortTh>
                  <SortTh k="revenue" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Revenue</SortTh>
                  <SortTh k="quantity" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Quantity</SortTh>
                  <SortTh k="basecost" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Basecost</SortTh>
                  <SortTh k="ads_fee" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Ads Fee</SortTh>
                  <SortTh k="tacos" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>TAcos</SortTh>
                  <SortTh k="profit" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Profit</SortTh>
                  <SortTh k="roi" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>ROI</SortTh>
                  <SortTh k="hoanVon" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Hoàn vốn</SortTh>
                  <SortTh k="hoanVonPct" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>% Hoàn vốn</SortTh>
                  <SortTh k="qty_di" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Số lượng đi hàng</SortTh>
                  <SortTh k="ton" sort={sort} onSort={onSort} align="right" className={`${TH_BASE} bg-blue-100 !text-blue-900 text-right`}>Tồn</SortTh>
                  {months.map((m) =>
                    monthMetrics.map((mt, j) => (
                      <SortTh
                        key={`${m.month}-${mt.key}`}
                        k={`m|${m.month}|${mt.key}`}
                        sort={sort}
                        onSort={onSort}
                        className={`${TH_BASE} text-right ${j === 0 ? SEP : ""} ${months.indexOf(m) % 2 ? "bg-amber-100 !text-amber-900" : "bg-violet-100 !text-violet-900"}`}
                      >
                        {mt.label}
                      </SortTh>
                    ))
                  )}
                </tr>
                <tr className={TOTAL_ROW}>
                  <td colSpan={2} className={`${TDL} font-semibold sticky left-0 z-30 bg-slate-100`}>
                    Tổng {skus.length}
                    {skus.length !== allSkus.length && <span className="font-normal text-slate-500">/{allSkus.length}</span>} SKU
                  </td>
                  <td className={`${TDL} font-semibold`}>
                    <ProfitSpark
                      total={totals.profit}
                      values={months.map((m) => ({
                        label: monthLabel(m.month),
                        v: totals.byMonth.get(m.month)?.cell.profit ?? null,
                        partial: m.month >= currentMonth,
                      }))}
                    />
                  </td>
                  <td colSpan={5} className={`${TDL} font-semibold`} />
                  <td className={`${TD} ${SEP} font-semibold`}>{fmtUsd(totals.von)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.revenue)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.quantity)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.basecost)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.ads)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(-totals.ads, totals.revenue))}</td>
                  <td className={`${TD} font-semibold ${signClass(totals.profit)}`}>{fmtUsd(totals.profit)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(totals.profit, totals.basecost))}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.hoanVon)}</td>
                  <td className={`${TD} font-semibold`}><HoanVonBar v={ratio(totals.hoanVon, totals.von)} /></td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.qtyDi)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.qtyDi - totals.quantity)}</td>
                  {months.map((m) =>
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
                    <td colSpan={20 + months.length * monthMetrics.length} className="px-4 py-10 text-left text-sm !text-slate-500">
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
                      <td className={`${TD} sticky left-0 z-10 w-10 min-w-10 !px-1 !text-center !text-slate-400 bg-white group-even:bg-slate-50 group-hover:!bg-orange-50 transition-colors duration-150`}>
                        {i + 1}
                      </td>
                      <td className={`${TDL} sticky left-10 z-10 bg-white shadow-[1px_0_0_#e2e8f0] group-even:bg-slate-50 group-hover:!bg-orange-50 transition-colors duration-150`}>
                        <span className="flex items-center gap-2">
                          <ThumbZoom url={s.mockup_url} />
                          <span className="font-mono text-[11.5px] font-bold text-slate-900">{s.sku}</span>
                        </span>
                      </td>
                      <td className={TDL}>
                        <ProfitSpark
                          total={s.profit}
                          values={months.map((m) => ({
                            label: monthLabel(m.month),
                            v: s.months[m.month]?.profit ?? null,
                            before: m.month < s.listing_month,
                            partial: m.month >= currentMonth,
                          }))}
                        />
                      </td>
                      <td className={`${TDL} max-w-[170px] truncate`} title={s.product_type || ""}>
                        {s.product_type}
                      </td>
                      <td className={TDL}>
                        <StatusPill status={s.status} />
                      </td>
                      <td className={TDL}>{s.pic_idea}</td>
                      <td className={TD}>{monthLabel(s.listing_month)}</td>
                      <td className={TD}>{s.eval_month ? monthLabel(s.eval_month) : ""}</td>
                      <td className={`${TD} ${SEP} ${zc(s.von_hang)}`}>{fmtUsd(s.von_hang)}</td>
                      <td className={`${TD} ${zc(s.revenue)}`}>{fmtUsd(s.revenue)}</td>
                      <td className={`${TD} ${zc(s.quantity)}`}>{fmtInt(s.quantity)}</td>
                      <td className={`${TD} ${zc(d.basecost)}`}>{fmtUsd(d.basecost)}</td>
                      <td className={`${TD} ${zc(s.ads_fee)}`}>{fmtUsd(s.ads_fee)}</td>
                      <td className={`${TD} ${zc(d.tacos)}`}>{fmtPct(d.tacos)}</td>
                      <td className={`${TD} bg-blue-50/40 font-semibold ${profitCls(s.profit)}`}>{fmtUsd(s.profit)}</td>
                      <td className={`${TD} ${zc(d.roi)}`}>{fmtPct(d.roi)}</td>
                      <td className={`${TD} ${zc(d.hoanVon)}`}>{fmtUsd(d.hoanVon)}</td>
                      <td className={`${TD} bg-blue-50/40`}>
                        <HoanVonBar v={d.hoanVonPct} />
                      </td>
                      <td className={`${TD} ${zc(s.qty_di)}`}>{fmtInt(s.qty_di)}</td>
                      <td
                        className={`${TD} ${d.ton < 0 ? "!text-red-600" : zc(d.ton)}`}
                        title={d.ton < 0 ? "Bán nhiều hơn số đi hàng — thiếu lô đi hàng trong Bảng nhập?" : undefined}
                      >
                        {fmtInt(d.ton)}
                      </td>
                      {months.map((m) => {
                        const before = m.month < s.listing_month;
                        return monthMetrics.map((mt, j) => {
                          const v = cellMetric(s.months[m.month], mt.key, s.unit_cost);
                          return (
                            <td
                              key={`${m.month}-${mt.key}`}
                              className={`${TD} ${j === 0 ? SEP : ""} ${before ? "bg-slate-100/70" : ""} ${mt.key === "profit" ? profitCls(v) : zc(v)}`}
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
          </AccountingViewTransition>
        )}
      </div>
    </div>
  );
}
