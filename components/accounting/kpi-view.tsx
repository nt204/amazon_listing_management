/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, useDeferredValue, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CloudArrowDownIcon,
  MagnifyingGlassIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { storeCanEdit, storeCanView } from "@/lib/accounting/store-teams";
import type { StoreAccessInfo } from "@/lib/accounting/types";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import {
  achievement,
  addMetrics,
  computeTarget,
  buildMonthReport,
  DEFAULT_TARGET_FORMULA,
  emptyMetrics,
  grossProfit,
  REPORT_ROWS,
  storageAndOther,
  type ReportCol,
  growth,
  periodLabel,
  shiftPeriod,
  tacosOf,
  type KpiMetrics,
  type KpiTargetFormula,
  type KpiTargetInput,
} from "@/lib/accounting/kpi-calc";
import { AccountingTopProgressBar, AnimatedTabPill } from "./accounting-skeleton";

// Mục "KPI kinh doanh" — theo file "<STORE> - KẾ HOẠCH KINH DOANH 2026":
// Tổng quan tháng (BÁO CÁO THÁNG) · SKU phát triển (CHI TIẾT SKU) · SKU test (CHI TIẾT SKU TEST).

interface Store {
  id: string;
  name: string;
  team?: string;
  access?: StoreAccessInfo;
}

interface TargetRow extends KpiTargetInput {
  cause: string | null;
  solution: string | null;
  action: string | null;
  review: string | null;
  target_action: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

interface KpiSku {
  sku: string;
  group: "dev" | "test";
  status: string | null;
  brand: string | null;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  pic_mkt: string | null;
  pic_idea?: string | null;
  ton_kho: number | null;
  price: number | null;
  basecost_unit: number | null;
  amazon_fee_unit: number | null;
  referral_pct: number | null;
  actual: { prev: KpiMetrics | null; cur: KpiMetrics | null; ly: KpiMetrics | null; lyNext: KpiMetrics | null };
  target: { cur: TargetRow | null; next: TargetRow | null };
}

type Source = "closed" | "history" | "live" | "none";
interface KpiData {
  period: string;
  periods: { prev: string; cur: string; next: string; ly: string; lyNext: string };
  sources: Record<"prev" | "cur" | "ly" | "lyNext", Source>;
  storeFees?: Record<"prev" | "cur" | "ly" | "lyNext", number | null>;
  skus: KpiSku[];
  note: { note: string; updated_by: string | null; updated_at: string | null } | null;
  teamTargets?: Record<"cur" | "next", Partial<Record<"dev" | "test", KpiMetrics>>>;
  historyYears: number[];
  /** Công thức tính mục tiêu của store (nạp từ sheet KẾ HOẠCH, sửa tay được) */
  targetFormula?: KpiTargetFormula & { source?: string | null; updated_by?: string | null };
  generatedAt: string;
}

type Mode = "overview" | "dev" | "test";
type TargetSlot = "cur" | "next";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const fmtUsd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : usd.format(Math.abs(v) < 0.005 ? 0 : v));
const fmtUsd0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : usd0.format(Math.abs(v) < 0.5 ? 0 : v));
const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : int.format(v));
const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : `${(v * 100).toFixed(1)}%`);

const GROUP_LABEL = { dev: "SKU phát triển", test: "SKU test" } as const;

// Dòng của bảng P&L — đúng thứ tự tab BÁO CÁO THÁNG: Gross Profit chưa trừ Adjustment / Placement Fee,
// hai khoản này nằm dưới; "Profit SKU" = sau cả hai (= cột Profit của CHI TIẾT SKU).
type PlKey = keyof KpiMetrics | "tacos" | "gross" | "store_fee";
const PL_ROWS: { key: PlKey; label: string; kind: "usd" | "int" | "pct"; cost?: boolean; strong?: boolean; sub?: boolean; storeOnly?: boolean }[] = [
  { key: "revenue", label: "Revenue", kind: "usd", strong: true },
  { key: "quantity", label: "Quantity", kind: "int" },
  { key: "ads_fee", label: "Ads Fee", kind: "usd", cost: true },
  { key: "basecost", label: "Basecost", kind: "usd", cost: true },
  { key: "amazon_fee", label: "Amazon Fee", kind: "usd", cost: true },
  { key: "tacos", label: "TACoS", kind: "pct", cost: true },
  { key: "ads_tax", label: "Ads tax 10% Ads", kind: "usd", cost: true },
  { key: "tncn_tax", label: "TNCN tax 1% Rev", kind: "usd", cost: true },
  { key: "ref_tax", label: "Ref tax", kind: "usd", cost: true },
  { key: "return_amount", label: "Return", kind: "usd", cost: true },
  { key: "storage_fee", label: "Chi phí lưu kho", kind: "usd", cost: true },
  { key: "other_fee", label: "CP khác", kind: "usd", cost: true },
  // Phí cấp store, không gắn SKU — chỉ ở trang Tổng quan (sheet: 'INPUT KQ hiện tại'!AE2 cộng vào Gross Profit)
  { key: "store_fee", label: "AWD/Subscription/Disposal Fee", kind: "usd", cost: true, storeOnly: true },
  { key: "gross", label: "Gross Profit", kind: "usd", strong: true },
  { key: "adjustment", label: "Adjustment", kind: "usd", cost: true, sub: true },
  { key: "placement_fee", label: "Placement Fee", kind: "usd", cost: true, sub: true },
  { key: "profit", label: "Profit SKU (sau Adj. + Placement)", kind: "usd", strong: true },
];

// ───────────────────────── Công thức mục tiêu của store (như khối "Kết quả kinh doanh mục tiêu" của sheet) ─────────────────────────
function TargetFormulaPanel({
  formula,
  canEdit,
  onSave,
}: {
  formula: KpiData["targetFormula"];
  canEdit: boolean;
  onSave: (patch: Partial<KpiTargetFormula>) => Promise<void>;
}) {
  const f: KpiTargetFormula = formula ?? DEFAULT_TARGET_FORMULA;
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const save = async (patch: Partial<KpiTargetFormula>) => {
    setSaving(true);
    try {
      await onSave(patch);
    } finally {
      setSaving(false);
    }
  };
  const pctInput = (value: number, onCommit: (v: number) => void, label: string) => (
    <NumInput
      value={value}
      percent
      width="w-16"
      ariaLabel={label}
      disabled={!canEdit || saving}
      onCommit={(v) => {
        if (v != null && v >= 0 && v <= 1) onCommit(v);
      }}
    />
  );
  const sel = "h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-800 disabled:bg-slate-50";
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between p-3 text-left transition hover:bg-slate-50/80 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <CaretRightIcon
            size={14}
            weight="bold"
            className={`text-slate-500 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
          <h3 className="text-sm font-bold text-slate-900">Công thức mục tiêu của store</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {open ? "Đang mở" : "Nhấn để xem / chỉnh sửa"}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          {formula?.source ? `Nguồn: ${formula.source}` : "Mặc định"}
          {formula?.updated_by ? ` · ${formula.updated_by}` : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3 pt-3">
          <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">AMZ Fee =</span>
              <select
                aria-label="Cách tính Amazon fee mục tiêu"
                className={sel}
                disabled={!canEdit || saving}
                value={f.amazon_mode}
                onChange={(e) => {
                  const mode = e.target.value as KpiTargetFormula["amazon_mode"];
                  void save({ amazon_mode: mode, amazon_pct: mode === "revenue_pct" ? 0.33 : 0.15 });
                }}
              >
                <option value="unit_plus_pct">Unit × Amazon fee + % REV</option>
                <option value="revenue_pct">% REV</option>
              </select>
              {pctInput(f.amazon_pct, (v) => void save({ amazon_pct: v }), "% REV của Amazon fee mục tiêu")}
            </label>
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">Return =</span>
              <select
                aria-label="Cách tính Return mục tiêu"
                className={sel}
                disabled={!canEdit || saving}
                value={f.return_mode}
                onChange={(e) => void save({ return_mode: e.target.value as KpiTargetFormula["return_mode"] })}
              >
                <option value="rate">% REV</option>
                <option value="actual">Return thực tế tháng trước</option>
              </select>
              {f.return_mode === "rate" && pctInput(f.return_rate, (v) => void save({ return_rate: v }), "% Return mục tiêu")}
            </label>
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">Ref tax = 10% ×</span>
              {pctInput(f.ref_pct, (v) => void save({ ref_pct: v }), "% referral của Ref tax mục tiêu")}
              <span>REV</span>
            </label>
          </div>
          <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2 text-xs text-slate-700 sm:grid-cols-2">
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">[Target] Tăng trưởng/tháng trước = mục tiêu tháng sau ÷</span>
              <select
                aria-label="Mẫu số cột tăng trưởng mục tiêu"
                className={sel}
                disabled={!canEdit || saving}
                value={f.growth_base}
                onChange={(e) => void save({ growth_base: e.target.value as KpiTargetFormula["growth_base"] })}
              >
                <option value="target">mục tiêu tháng này</option>
                <option value="actual">thực tế tháng này</option>
              </select>
              <select
                aria-label="Có trừ 1 ở cột tăng trưởng mục tiêu"
                className={sel}
                disabled={!canEdit || saving}
                value={f.growth_minus_one ? "1" : "0"}
                onChange={(e) => void save({ growth_minus_one: e.target.value === "1" })}
              >
                <option value="1">− 1</option>
                <option value="0">(không trừ 1)</option>
              </select>
            </label>
            <label className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">Dòng CP khác tháng này:</span>
              <select
                aria-label="Dấu dòng CP khác"
                className={sel}
                disabled={!canEdit || saving}
                value={String(f.other_fee_sign)}
                onChange={(e) => void save({ other_fee_sign: e.target.value === "-1" ? -1 : 1 })}
              >
                <option value="1">như hệ thống</option>
                <option value="-1">đảo dấu</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Tự lấy theo công thức sheet KẾ HOẠCH KINH DOANH khi nạp mục tiêu. Ads tax = 10% Ads, TNCN = 1% REV, Lưu kho = số leader nhập.
          </p>
        </div>
      )}
    </section>
  );
}

/** storeFee: phí AWD/Subscription cấp store của tháng (chỉ trang Tổng quan); Gross Profit trừ phí này như sheet */
function metricValue(m: KpiMetrics | null | undefined, key: PlKey, storeFee: number | null = null): number | null {
  if (!m) return null;
  if (key === "tacos") return tacosOf(m);
  if (key === "store_fee") return storeFee;
  if (key === "gross") return (grossProfit(m) ?? 0) - (storeFee ?? 0);
  return m[key];
}
function fmtMetric(v: number | null, kind: "usd" | "int" | "pct") {
  if (v == null) return "";
  return kind === "usd" ? fmtUsd(v) : kind === "int" ? fmtInt(v) : fmtPct(v);
}

/** % đạt: xanh ≥100%, vàng ≥70%, đỏ còn lại */
function achieveTone(v: number | null) {
  if (v == null) return "text-slate-400";
  if (v >= 1) return "text-emerald-700";
  if (v >= 0.7) return "text-amber-700";
  return "text-rose-700";
}
function growthTone(v: number | null, cost = false) {
  if (v == null || Math.abs(v) < 0.0005) return "text-slate-500";
  const good = cost ? v < 0 : v > 0;
  return good ? "text-emerald-700" : "text-rose-700";
}
const signed = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${fmtPct(v)}`);

function unitEcon(s: KpiSku) {
  return { price: s.price, basecost_unit: s.basecost_unit, amazon_fee_unit: s.amazon_fee_unit, referral_pct: s.referral_pct };
}
/**
 * Mục tiêu theo công thức của store. Return "theo thực tế" (MALFIRST: =BH) = Return thực tế tháng trước tháng mục tiêu:
 * mục tiêu tháng sau ← thực tế tháng đang xem, mục tiêu tháng đang xem ← thực tế tháng trước.
 */
function targetOf(s: KpiSku, slot: TargetSlot, formula?: KpiTargetFormula) {
  const base = slot === "next" ? s.actual.cur : s.actual.prev;
  return computeTarget(s.target[slot], unitEcon(s), formula, base ? Math.abs(base.return_amount) : null);
}

function monthOptions(center: string) {
  const out: string[] = [];
  for (let i = -14; i <= 2; i++) out.push(shiftPeriod(center, i));
  return out.reverse();
}

// ───────────────────────── Ô nhập số (lưu khi rời ô / Enter) ─────────────────────────
function NumInput({
  value,
  onCommit,
  placeholder,
  disabled,
  percent,
  width = "w-16",
  ariaLabel,
  decimals = 2,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  percent?: boolean;
  width?: string;
  ariaLabel: string;
  /** Số chữ số lẻ khi hiển thị (giá trị lưu giữ nguyên) — Unit hiện số nguyên như sheet (114.4 → 114) */
  decimals?: number;
}) {
  // Làm tròn khi hiển thị để không hiện đuôi số thực (29.700000000000003)
  const shown = value == null ? "" : percent ? String(Math.round(value * 1000) / 10) : String(Number(value.toFixed(decimals)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const t = draft.trim().replace(",", ".").replace("%", "");
    setDraft(null);
    if (t === shown) return;
    if (t === "") return onCommit(null);
    const x = Number(t);
    if (!Number.isFinite(x) || x < 0) return;
    onCommit(percent ? x / 100 : x);
  };
  return (
    <div className="relative inline-flex items-center">
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? shown}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={`${width} h-7 rounded-md border border-slate-200 bg-amber-50/40 px-1.5 text-right text-xs font-semibold tabular-nums text-slate-900 placeholder:font-normal placeholder:text-slate-400 hover:border-amber-300 focus:border-blue-500 focus:bg-white focus:outline-hidden disabled:cursor-not-allowed disabled:bg-transparent disabled:hover:border-slate-200 ${percent ? "pr-4" : ""}`}
      />
      {percent && <span className="pointer-events-none absolute right-1.5 text-[10px] text-slate-400">%</span>}
    </div>
  );
}

/** Ô Price nhấn đúp để sửa tay — chỉ tác động vào tính toán mục tiêu, không làm đổi giá thực tế từ order */
function EditablePriceCell({
  value,
  canEdit,
  onCommit,
}: {
  value: number | null;
  canEdit: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    setDraft(value != null ? String(value) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const t = draft.trim().replace(",", ".").replace("$", "");
    if (t === (value != null ? String(value) : "")) return;
    if (t === "") {
      onCommit(null);
      return;
    }
    const x = Number(t);
    if (!Number.isFinite(x) || x < 0) return;
    onCommit(Math.round(x * 100) / 100);
  };

  if (editing && canEdit) {
    return (
      <div className="relative inline-flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
        <span className="pointer-events-none absolute left-1 text-[11px] text-slate-400">$</span>
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={value != null ? String(value) : "0.00"}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-6 w-16 rounded border border-blue-500 bg-white pl-3.5 pr-1 text-right text-xs font-semibold tabular-nums text-slate-900 shadow-xs outline-hidden"
        />
      </div>
    );
  }

  return (
    <span
      onDoubleClick={startEdit}
      title={canEdit ? "Nhấn đúp (ấn 2 cái) để sửa giá mục tiêu" : undefined}
      className={`inline-block w-full select-none text-right tabular-nums ${
        canEdit ? "cursor-pointer hover:font-bold hover:text-blue-700 hover:underline" : ""
      }`}
    >
      {fmtUsd(value)}
    </span>
  );
}

function Thumb({ url, size = "md" }: { url: string | null; size?: "sm" | "md" }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const src = getOptimizedThumbnailUrl(url, 64);
  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  if (!src) return <div className={`${dim} shrink-0 rounded-md bg-slate-100`} />;
  return (
    <>
      <img
        src={src}
        alt=""
        loading="lazy"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: r.right + 10, y: r.top });
        }}
        onMouseLeave={() => setPos(null)}
        className={`${dim} shrink-0 rounded-md border border-slate-200 object-cover cursor-pointer transition-transform hover:scale-105`}
      />
      {pos && url && typeof document !== "undefined" && createPortal(
        <div
          className="pointer-events-none fixed z-[99999] rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${pos.x}px`,
            top: `${Math.max(10, Math.min(window.innerHeight - 210, pos.y - 70))}px`,
          }}
        >
          <img src={url} alt="" className="h-48 w-48 rounded-lg object-contain bg-slate-50" />
        </div>,
        document.body,
      )}
    </>
  );
}

// ───────────────────────── Tổng quan tháng ─────────────────────────
/** Mũi tên tăng / giảm + màu tốt / xấu (chi phí như TACoS: giảm là tốt). Không dấu +/−: mũi tên đã thể hiện. */
function Delta({ label, value, base, kind, cost, baseLabel }: { label: string; value: number | null; base: number | null; kind: "usd" | "int" | "pct"; cost?: boolean; baseLabel: string }) {
  // pct (TACoS): chênh lệch theo điểm %; số tiền / số lượng: % tăng trưởng
  const d = kind === "pct" ? (value != null && base != null ? value - base : null) : growth(value, base);
  const fmtBase = kind === "usd" ? fmtUsd0(base) : kind === "int" ? fmtInt(base) : fmtPct(base);
  const flat = d == null || Math.abs(d) < 0.0005;
  return (
    <span className="inline-flex items-center gap-1" title={base != null ? `${baseLabel}: ${fmtBase}` : `${baseLabel}: chưa có số`}>
      <span className="text-slate-500">{label}</span>
      {d == null ? (
        <b className="text-slate-400">—</b>
      ) : (
        <b className={`inline-flex items-center gap-0.5 tabular-nums ${growthTone(d, cost)}`}>
          {!flat && (d > 0 ? <ArrowUpRightIcon size={11} weight="bold" /> : <ArrowDownRightIcon size={11} weight="bold" />)}
          {`${Math.abs(d * 100).toFixed(1)}%`}
        </b>
      )}
    </span>
  );
}

/**
 * Ô KPI tháng. Mục tiêu càng cao càng tốt (Revenue, Profit, Quantity): thanh % đạt + còn thiếu / đã vượt;
 * tháng đang chạy (pace) thì có vạch nhịp cần đạt tới hôm nay và số dự kiến cả tháng theo nhịp hiện tại.
 * Chi phí (TACoS, cost): càng thấp càng tốt → Đạt / Vượt mục tiêu bao nhiêu điểm.
 */
function Tile({
  label,
  period,
  live,
  actual,
  target,
  prev,
  ly,
  prevLabel,
  lyLabel,
  kind,
  cost,
  pace,
  extra,
}: {
  label: string;
  period: string;
  /** Số tạm tính (tháng chưa chốt) */
  live?: boolean;
  actual: number | null;
  target: number | null;
  prev: number | null;
  ly: number | null;
  prevLabel: string;
  lyLabel: string;
  kind: "usd" | "int" | "pct";
  cost?: boolean;
  /** Phần tháng đã qua (0–1) khi tháng chưa hết; null = tháng đã qua */
  pace: number | null;
  extra?: ReactNode;
}) {
  const fmt = (v: number | null) => (kind === "usd" ? fmtUsd0(v) : kind === "int" ? fmtInt(v) : fmtPct(v));
  const ach = cost ? null : achievement(actual, target);
  // Tháng đang chạy: so với nhịp (đạt ≥ nhịp là xanh), tháng đã qua: so với 100%
  const goal = pace ?? 1;
  const tone = ach == null ? "slate" : ach >= goal ? "emerald" : ach >= goal * 0.85 ? "amber" : "rose";
  const BAR = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-300" }[tone];
  const TEXT = { emerald: "text-emerald-700", amber: "text-amber-700", rose: "text-rose-700", slate: "text-slate-400" }[tone];
  const gap = actual != null && target != null ? actual - target : null;
  const projected = pace && actual != null ? actual / pace : null;

  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${live ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`} title={live ? "Số tạm tính, tháng chưa chốt" : undefined}>
          {period}
          {live ? " · tạm tính" : ""}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-bold leading-none tabular-nums text-slate-900">{fmt(actual) || "—"}</span>
        {extra && <span className="text-xs font-medium text-slate-500">{extra}</span>}
      </div>

      <div className="mt-3 min-h-[44px]">
        {target == null ? (
          <div className="text-[11.5px] text-slate-400">Chưa có mục tiêu</div>
        ) : cost ? (
          (() => {
            const ok = actual != null && actual <= target;
            const diff = actual != null ? Math.abs(actual - target) * 100 : null;
            return (
              <>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-slate-500">
                    Mục tiêu ≤ <b className="text-slate-700">{fmtPct(target)}</b>
                  </span>
                  {actual != null && (
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                      {ok ? "Đạt" : "Vượt mục tiêu"}
                    </span>
                  )}
                </div>
                {diff != null && (
                  <div className={`mt-1.5 text-[11.5px] font-semibold ${ok ? "text-emerald-700" : "text-rose-700"}`}>
                    {ok ? `Thấp hơn mục tiêu ${diff.toFixed(1)}%` : `Cao hơn mục tiêu ${diff.toFixed(1)}%`}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          <>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-slate-500">
                Mục tiêu <b className="text-slate-700">{fmt(target)}</b>
              </span>
              <b className={`tabular-nums ${TEXT}`}>Đạt {fmtPct(ach) || "0%"}</b>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-[width] duration-500 ${BAR}`} style={{ width: `${Math.max(0, Math.min(100, (ach ?? 0) * 100))}%` }} />
              {pace != null && (
                <span
                  className="absolute -top-1 h-4 w-0.5 rounded bg-slate-700"
                  style={{ left: `${Math.min(100, pace * 100)}%` }}
                  title={`Nhịp cần đạt tới hôm nay: ${fmtPct(pace)} mục tiêu`}
                />
              )}
            </div>
            <div className="mt-1.5 text-[11.5px] text-slate-500">
              {gap != null && gap >= 0 ? (
                <span className="font-semibold text-emerald-700">Vượt mục tiêu {fmt(gap)}</span>
              ) : projected != null ? (
                <span>
                  Dự kiến cả tháng <b className={projected >= (target ?? 0) ? "text-emerald-700" : "text-rose-700"}>{fmt(projected)}</b>
                </span>
              ) : gap != null ? (
                <span>
                  Còn thiếu <b className="text-rose-700">{fmt(-gap)}</b>
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 text-[11.5px]">
        <Delta label="Tháng trước" value={actual} base={prev} kind={kind} cost={cost} baseLabel={prevLabel} />
        <Delta label="Cùng kỳ" value={actual} base={ly} kind={kind} cost={cost} baseLabel={lyLabel} />
      </div>
    </div>
  );
}

// ===== BẢNG THEO THÁNG PHÔI & PIC (KQKD) TRONG TỔNG QUAN THÁNG KPI =====
const WIN_TARGET_RATE = 0.4;
const WIN_STATUS = "phát triển";
const LOSS_STATUS = "hủy";

function statusKind(status: string | null | undefined): "win" | "test" | "loss" {
  const s = (status || "").trim().toLowerCase();
  return s === WIN_STATUS ? "win" : s === LOSS_STATUS ? "loss" : "test";
}

function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || !Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 0.000001) return null;
  return num / den;
}

function fmtTarget(v: number) {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function RatePill({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const good = v >= WIN_TARGET_RATE;
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
        good ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
      }`}
    >
      {fmtPct(v)}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const k = statusKind(status);
  const bg = k === "win" ? "bg-emerald-100 text-emerald-800" : k === "test" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${bg}`}>
      {status || "—"}
    </span>
  );
}

function ExpandedSkuList({
  skus,
  title,
  period,
  onOpenSku,
}: {
  skus: Array<Record<string, unknown>>;
  title: string;
  period: string;
  onOpenSku?: (sku: string) => void;
}) {
  return (
    <div className="border-l-4 border-l-blue-600 bg-slate-50/90 p-2.5 sm:p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-slate-800">
          Danh sách {skus.length} SKU ({title}):
        </span>
        <span className="text-[11px] text-slate-400">
          Rê chuột vào ảnh để phóng to · Bấm SKU để xem chi tiết
        </span>
      </div>

      <div className="max-h-[380px] overflow-auto rounded-lg border border-slate-200 bg-white shadow-xs">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 text-slate-700">
              <th className="w-8 px-2 py-1.5 text-center font-medium">#</th>
              <th className="w-10 px-1 py-1.5 text-center font-medium">Ảnh</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">SKU / Phôi</th>
              <th className="px-2 py-1.5 text-center font-medium">Trạng thái</th>
              <th className="px-2 py-1.5 text-left font-medium">PIC Idea</th>
              <th className="px-2 py-1.5 text-right font-medium">Đơn</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Revenue</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">Profit</th>
              <th className="px-2.5 py-1.5 text-right font-medium">TACoS</th>
              <th className="px-2 py-1.5 text-right font-medium">Tồn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {skus.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-4 text-center text-slate-400">
                  Không có SKU nào
                </td>
              </tr>
            ) : (
              skus.map((sItem, idx) => {
                const s = sItem as {
                  sku?: string;
                  mockup_url?: string;
                  product_type?: string;
                  status?: string;
                  pic_idea?: string;
                  actual?: { cur?: KpiMetrics };
                  months?: Record<string, { revenue?: number; profit?: number; ads_fee?: number; quantity?: number }>;
                  revenue?: number;
                  profit?: number;
                  ads_fee?: number;
                  quantity?: number;
                  ton_kho?: number;
                };
                const isKpiSku = Boolean(s.actual);
                const mCell = !isKpiSku ? (s.months?.[period] || s) : null;
                const rev = isKpiSku ? s.actual?.cur?.revenue : (mCell?.revenue ?? s.revenue);
                const prof = isKpiSku ? s.actual?.cur?.profit : (mCell?.profit ?? s.profit);
                const ads = isKpiSku ? s.actual?.cur?.ads_fee : (mCell?.ads_fee ?? s.ads_fee);
                const units = isKpiSku ? s.actual?.cur?.quantity : (mCell?.quantity ?? s.quantity);
                const tacos = isKpiSku ? tacosOf(s.actual?.cur) : ratio(-(ads || 0), rev || 0);
                const ton = s.ton_kho;

                return (
                  <tr key={s.sku || idx} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-2 py-1.5 text-center text-slate-400 font-mono text-[10px]">
                      {idx + 1}
                    </td>
                    <td className="px-1 py-1 text-center">
                      <Thumb url={s.mockup_url ?? null} size="sm" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div
                        onClick={() => s.sku && onOpenSku?.(s.sku)}
                        className={`font-semibold font-mono text-slate-800 ${
                          onOpenSku ? "cursor-pointer hover:text-blue-700 hover:underline" : ""
                        }`}
                        title={onOpenSku ? "Nhấn để xem chi tiết SKU" : undefined}
                      >
                        {s.sku}
                      </div>
                      {s.product_type && (
                        <div className="text-[10.5px] text-slate-400 truncate max-w-[200px]" title={s.product_type}>
                          {s.product_type}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-2 py-1.5 text-left text-slate-600 truncate max-w-[120px]" title={s.pic_idea || ""}>
                      {s.pic_idea || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 font-mono">
                      {units != null && units > 0 ? fmtInt(units) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-slate-900 font-mono">
                      {fmtUsd(rev)}
                    </td>
                    <td className={`px-2.5 py-1.5 text-right tabular-nums font-semibold font-mono ${
                      prof != null && prof < 0 ? "text-rose-600" : "text-slate-900"
                    }`}>
                      {fmtUsd(prof)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-700 font-mono">
                      {fmtPct(tacos)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500 font-mono">
                      {ton != null ? fmtInt(ton) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiPhoiPicTable({
  storeId,
  period,
  skus,
  targetFormula,
  onOpenSku,
}: {
  storeId?: string;
  period: string;
  skus: KpiSku[];
  targetFormula?: KpiTargetFormula;
  onOpenSku?: (sku: string) => void;
}) {
  const year = useMemo(() => Number(period.slice(0, 4)) || new Date().getFullYear(), [period]);
  const [kqkdData, setKqkdData] = useState<Record<string, unknown> | null>(null);
  const [breakdown, setBreakdown] = useState<"phoi" | "pic_idea">("phoi");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    fetch(`/api/accounting/financials/kqkd?store_id=${storeId}&year=${year}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (active && res) setKqkdData(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [storeId, year]);

  const toggleExpanded = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  const nameLabel = breakdown === "phoi" ? "Tên Phôi" : "PIC Idea";

  // --- KQKD DATA ---
  const winMap = useMemo(() => {
    const map = new Map<string, number>();
    const winList = (kqkdData?.winResults || []) as Array<Record<string, unknown>>;
    for (const w of winList) {
      map.set(`${w.eval_month}|${w.product_type}`, Number(w.win_count) || 0);
    }
    return map;
  }, [kqkdData]);

  const curListingSkus = useMemo(() => {
    const list = (kqkdData?.skus || []) as Array<Record<string, unknown>>;
    return list.filter((s) => s.listing_month === period);
  }, [kqkdData, period]);

  const curEvalSkus = useMemo(() => {
    const list1 = (kqkdData?.skus || []) as Array<Record<string, unknown>>;
    const list2 = (kqkdData?.evalSkus || []) as Array<Record<string, unknown>>;
    const pool = [...list1, ...list2];
    return pool.filter((s) => s.eval_month === period);
  }, [kqkdData, period]);

  const lRows = useMemo(() => {
    const m = new Map<string, { name: string; n: number; von: number; hoanVon: number; skus: Array<Record<string, unknown>> }>();
    for (const s of curListingSkus) {
      const rawName = String((breakdown === "phoi" ? s.product_type : s.pic_idea) || "(trống)");
      const cur = m.get(rawName) || { name: rawName, n: 0, von: 0, hoanVon: 0, skus: [] };
      cur.n += 1;
      cur.von += Number(s.von_hang || 0);
      const basecost = s.unit_cost != null ? Number(s.unit_cost) * Number(s.quantity || 0) : 0;
      const hoanVon = basecost + Number(s.profit || 0);
      cur.hoanVon += hoanVon;
      cur.skus.push(s);
      m.set(rawName, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.von - a.von);
  }, [curListingSkus, breakdown]);

  const eRows = useMemo(() => {
    const m = new Map<string, { name: string; n: number; suggest: number; win: number | null; skus: Array<Record<string, unknown>> }>();
    for (const s of curEvalSkus) {
      const rawName = String((breakdown === "phoi" ? s.product_type : s.pic_idea) || "(trống)");
      const cur = m.get(rawName) || { name: rawName, n: 0, suggest: 0, win: null, skus: [] };
      cur.n += 1;
      const isWin = statusKind(s.status as string) === "win";
      if (isWin) cur.suggest += 1;
      cur.skus.push(s);
      m.set(rawName, cur);
    }
    return Array.from(m.values())
      .map((r) => {
        const manualWin = winMap.get(`${period}|${r.name}`);
        const win = manualWin != null ? manualWin : r.suggest;
        return { ...r, win };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [curEvalSkus, breakdown, winMap, period]);

  const lTotal = useMemo(() => {
    const n = lRows.reduce((a, r) => a + r.n, 0);
    const von = lRows.reduce((a, r) => a + r.von, 0);
    const hoanVon = lRows.reduce((a, r) => a + r.hoanVon, 0);
    return { n, von, hoanVon, rate: ratio(hoanVon, von) };
  }, [lRows]);

  const eTotal = useMemo(() => {
    const n = eRows.reduce((a, r) => a + r.n, 0);
    const win = eRows.reduce((a, r) => a + (r.win || 0), 0);
    return { n, win, rate: ratio(win, n) };
  }, [eRows]);

  const childN = Math.max(lRows.length, eRows.length);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/50 px-3 py-2.5 sm:px-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-bold text-slate-900">
            Theo {breakdown === "phoi" ? "Phôi" : "PIC"} · {periodLabel(period)}
          </h3>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => {
                setBreakdown("phoi");
                setExpandedKey(null);
              }}
              className={`cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-all ${
                breakdown === "phoi" ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Phôi
            </button>
            <button
              type="button"
              onClick={() => {
                setBreakdown("pic_idea");
                setExpandedKey(null);
              }}
              className={`cursor-pointer rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-all ${
                breakdown === "pic_idea" ? "bg-blue-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              PIC Idea
            </button>
          </div>
        </div>

                <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            Ấn vào dòng để xổ danh sách SKU
          </span>
        </div>
      </div>

      
        <div className="overflow-x-auto">
          <table className="w-full acc-kpi-subtable min-w-[880px] table-fixed border-collapse text-xs [&_td]:py-2 [&_td]:px-2.5">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-300">
                <th colSpan={4} className="border-r border-slate-300 bg-blue-200 py-2 text-center font-bold text-blue-950 text-xs">
                  R&amp;D Testing ({periodLabel(period)})
                </th>
                <th colSpan={5} className="bg-emerald-200 py-2 text-center font-bold text-emerald-950 text-xs">
                  Đánh giá SKU WIN ({periodLabel(period)})
                </th>
              </tr>
              <tr className="border-b border-slate-300 text-[11.5px]">
                <th className="bg-blue-100 py-2 text-left font-bold text-blue-950">{nameLabel}</th>
                <th className="bg-blue-100 py-2 text-right font-bold text-blue-950">Số SKU</th>
                <th className="bg-blue-100 py-2 text-right font-bold text-blue-950">Vốn test</th>
                <th className="border-r border-slate-300 bg-blue-100 py-2 text-right font-bold text-blue-950">% Hoàn vốn</th>
                <th className="bg-emerald-100 py-2 text-left font-bold text-emerald-950">{nameLabel}</th>
                <th className="bg-emerald-100 py-2 text-right font-bold text-emerald-950">Số SKU</th>
                <th className="bg-emerald-100 py-2 text-right font-bold text-emerald-950">Mục tiêu</th>
                <th className="bg-emerald-100 py-2 text-right font-bold text-emerald-950">WIN thực tế</th>
                <th className="bg-emerald-100 py-2 text-center font-bold text-emerald-950">Tỉ lệ WIN</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200 bg-slate-100 font-bold text-slate-900">
                <td className="text-left font-bold">Tổng</td>
                <td className="text-right font-mono">{lTotal.n || "—"}</td>
                <td className="text-right font-mono">{lTotal.von ? fmtUsd(lTotal.von) : "—"}</td>
                <td className="border-r border-slate-200 text-right font-mono">
                  {lTotal.rate != null ? fmtPct(lTotal.rate) : "—"}
                </td>
                <td className="text-left font-bold">Tổng</td>
                <td className="text-right font-mono">{eTotal.n || "—"}</td>
                <td className="text-right font-mono">{eTotal.n ? fmtTarget(eTotal.n * 0.4) : "—"}</td>
                <td className="text-right font-mono">{eTotal.win != null ? eTotal.win : "—"}</td>
                <td className="text-center font-mono">
                  {eTotal.rate != null ? <RatePill v={eTotal.rate} /> : "—"}
                </td>
              </tr>

              {childN === 0 ? (
                <tr>
                  <td colSpan={4} className="border-r border-slate-200 py-6 text-center text-slate-400">
                    Không có SKU listing mới trong tháng {periodLabel(period)}
                  </td>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Không có SKU đến hạn đánh giá trong tháng {periodLabel(period)}
                  </td>
                </tr>
              ) : (
                Array.from({ length: childN }).map((_, pi) => {
                  const lr = lRows[pi];
                  const er = eRows[pi];
                  const lKey = lr ? `l:${lr.name}` : null;
                  const eKey = er ? `e:${er.name}` : null;
                  const isExpL = lKey && expandedKey === lKey;
                  const isExpE = eKey && expandedKey === eKey;

                  return (
                    <Fragment key={pi}>
                      <tr className="border-b border-slate-100 transition-colors hover:bg-amber-50/50">
                        {lr ? (
                          <>
                            <td
                              onClick={() => lKey && toggleExpanded(lKey)}
                              className="cursor-pointer font-medium text-slate-800 hover:text-blue-700"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <CaretRightIcon
                                  size={11}
                                  className={`text-slate-400 transition-transform ${isExpL ? "rotate-90 text-blue-600" : ""}`}
                                />
                                <span className="truncate max-w-[160px]" title={lr.name}>
                                  {lr.name}
                                </span>
                              </span>
                            </td>
                            <td
                              onClick={() => lKey && toggleExpanded(lKey)}
                              className="cursor-pointer text-right font-mono"
                            >
                              {lr.n}
                            </td>
                            <td
                              onClick={() => lKey && toggleExpanded(lKey)}
                              className="cursor-pointer text-right font-mono"
                            >
                              {fmtUsd(lr.von)}
                            </td>
                            <td
                              onClick={() => lKey && toggleExpanded(lKey)}
                              className="cursor-pointer border-r border-slate-200 text-right font-mono"
                            >
                              {fmtPct(ratio(lr.hoanVon, lr.von))}
                            </td>
                          </>
                        ) : (
                          <td colSpan={4} className="border-r border-slate-200 text-center text-slate-300">
                            —
                          </td>
                        )}

                        {er ? (
                          <>
                            <td
                              onClick={() => eKey && toggleExpanded(eKey)}
                              className="cursor-pointer font-medium text-slate-800 hover:text-blue-700"
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <CaretRightIcon
                                  size={11}
                                  className={`text-slate-400 transition-transform ${isExpE ? "rotate-90 text-blue-600" : ""}`}
                                />
                                <span className="truncate max-w-[160px]" title={er.name}>
                                  {er.name}
                                </span>
                              </span>
                            </td>
                            <td
                              onClick={() => eKey && toggleExpanded(eKey)}
                              className="cursor-pointer text-right font-mono"
                            >
                              {er.n}
                            </td>
                            <td
                              onClick={() => eKey && toggleExpanded(eKey)}
                              className="cursor-pointer text-right font-mono"
                            >
                              {fmtTarget(er.n * 0.4)}
                            </td>
                            <td
                              onClick={() => eKey && toggleExpanded(eKey)}
                              className="cursor-pointer text-right font-mono font-semibold"
                            >
                              {er.win ?? "—"}
                            </td>
                            <td
                              onClick={() => eKey && toggleExpanded(eKey)}
                              className="cursor-pointer text-center font-mono"
                            >
                              <RatePill v={ratio(er.win, er.n)} />
                            </td>
                          </>
                        ) : (
                          <td colSpan={5} className="text-center text-slate-300">
                            —
                          </td>
                        )}
                      </tr>

                      {isExpL && lr && (
                        <tr className="border-b border-slate-200 bg-slate-50/70 animate-in fade-in duration-150">
                          <td colSpan={9} className="p-0">
                            <ExpandedSkuList
                              skus={lr.skus}
                              title={`R&D Listing: ${lr.name}`}
                              period={period}
                              onOpenSku={onOpenSku}
                            />
                          </td>
                        </tr>
                      )}

                      {isExpE && er && (
                        <tr className="border-b border-slate-200 bg-slate-50/70 animate-in fade-in duration-150">
                          <td colSpan={9} className="p-0">
                            <ExpandedSkuList
                              skus={er.skus}
                              title={`Đánh giá WIN: ${er.name}`}
                              period={period}
                              onOpenSku={onOpenSku}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
    </section>
  );
}

function OverviewPage({
  data,
  canEdit,
  storeId,
  onSaveNote,
  onSaveFormula,
  onOpenSku,
}: {
  data: KpiData;
  canEdit: boolean;
  storeId?: string;
  onSaveNote: (note: string) => Promise<void>;
  onSaveFormula: (patch: Partial<KpiTargetFormula>) => Promise<void>;
  onOpenSku?: (sku: string) => void;
}) {
  const { periods } = data;
  const sum = useMemo(() => {
    const blank = () => ({ prev: emptyMetrics(), cur: emptyMetrics(), ly: emptyMetrics(), lyNext: emptyMetrics(), tCur: emptyMetrics(), tNext: emptyMetrics(), hasTCur: false, hasTNext: false });
    const by = { dev: blank(), test: blank() };
    for (const s of data.skus) {
      const g = by[s.group];
      g.prev = addMetrics(g.prev, s.actual.prev);
      g.cur = addMetrics(g.cur, s.actual.cur);
      g.ly = addMetrics(g.ly, s.actual.ly);
      g.lyNext = addMetrics(g.lyNext, s.actual.lyNext);
      const tc = targetOf(s, "cur", data.targetFormula);
      const tn = targetOf(s, "next", data.targetFormula);
      if (tc) g.hasTCur = true;
      if (tn) g.hasTNext = true;
      g.tCur = addMetrics(g.tCur, tc);
      g.tNext = addMetrics(g.tNext, tn);
    }
    // Tháng không có mục tiêu từng SKU (sheet đã ghi đè) → dùng số tổng team nạp từ BÁO CÁO THÁNG
    for (const k of ["dev", "test"] as const) {
      const team = data.teamTargets;
      if (!by[k].hasTCur && team?.cur[k]) Object.assign(by[k], { tCur: team.cur[k], hasTCur: true });
      if (!by[k].hasTNext && team?.next[k]) Object.assign(by[k], { tNext: team.next[k], hasTNext: true });
    }
    return { by };
  }, [data.skus, data.teamTargets, data.targetFormula]);

  // Như sheet BÁO CÁO THÁNG: "tổng team" = SKU phát triển; SKU test là dòng "P/L SKU testing" riêng
  const a = sum.by.dev;
  const t = sum.by.test;
  const lyOk = data.sources.ly !== "none";
  const lyNextOk = data.sources.lyNext !== "none";
  const tCur = a.hasTCur ? a.tCur : null;
  const tNext = a.hasTNext ? a.tNext : null;
  const testTNext = t.hasTNext ? t.tNext : null;
  const testTCur = t.hasTCur ? t.tCur : null;
  const fees = data.storeFees ?? { prev: null, cur: null, ly: null, lyNext: null };
  const report = useMemo(
    () =>
      buildMonthReport({
        dev: { prev: a.prev, cur: a.cur, ly: lyOk ? a.ly : null, lyNext: lyNextOk ? a.lyNext : null, tCur, tNext },
        test: { prev: t.prev, cur: t.cur, ly: lyOk ? t.ly : null, lyNext: lyNextOk ? t.lyNext : null, tNext: testTNext, tCur: testTCur },
        storeFeeCur: fees.cur,
        formula: data.targetFormula,
      }),
    [a, t, lyOk, lyNextOk, tCur, tNext, testTNext, testTCur, fees.cur, data.targetFormula],
  );

  // Tổng cả WIN + TEST cho 4 card tổng quan
  const total = useMemo(() => {
    const cur = addMetrics(a.cur, t.cur);
    const prev = addMetrics(a.prev, t.prev);
    const ly = addMetrics(a.ly, t.ly);
    const hasTCur = a.hasTCur || t.hasTCur;
    const tCurCombined = hasTCur
      ? addMetrics(a.hasTCur ? a.tCur : emptyMetrics(), t.hasTCur ? t.tCur : emptyMetrics())
      : null;
    return { cur, prev, ly, tCur: tCurCombined };
  }, [a, t]);
  const grossCur = report.gross.curTotal ?? null;
  const grossTarget = total.tCur?.profit ?? null;
  const grossPrev = total.prev.profit;
  const grossLy = lyOk ? total.ly.profit : null;

  const [note, setNote] = useState(data.note?.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const dirty = note !== (data.note?.note ?? "");

  // Bảng BÁO CÁO THÁNG: lưới đen, tên cột như sheet
  const hd = "border-r border-b border-black px-2 py-1 text-[11px] font-extrabold text-black whitespace-nowrap";
  const cell = "border-r border-b border-black px-2 py-1 whitespace-nowrap";

  // Phân nhóm màu sắc trực quan theo yêu cầu:
  // - Cột Chỉ số: màu cam #ff9900 chuẩn theo ảnh chụp
  // - Tham chiếu quá khứ: màu vàng đậm hơn chút (bg-[#fef08a] / bg-white)
  // - Cụm WIN & TEST: đồng nhất cùng màu vàng cam ấm (bg-[#fdba74] / bg-[#ffedd5])
  // - Cột KPI (WIN & TEST): giữ màu xanh lá (bg-[#a3cf95] / bg-[#d9ead3])
  const REPORT_COLS: {
    key: ReportCol;
    label: string[];
    title: string;
    ratio?: boolean;
    headCls: string;
    cellCls: string;
    divider?: boolean;
  }[] = [
    // 1. Tham chiếu quá khứ (2 cột) — Ô giá trị màu trắng
    {
      key: "prev",
      label: ["[Result]", periodLabel(periods.prev)],
      title: `[Result] ${periodLabel(periods.prev)} (tháng trước)`,
      headCls: "bg-[#fef08a] text-black font-extrabold",
      cellCls: "bg-white",
    },
    {
      key: "ly",
      label: ["[Result]", periodLabel(periods.ly)],
      title: `[Result] ${periodLabel(periods.ly)} (cùng kỳ năm ngoái)`,
      headCls: "bg-[#fef08a] text-black font-extrabold",
      cellCls: "bg-white",
      divider: true,
    },
    // 2. Đánh giá tháng này - Cụm WIN 1 màu (Cam/Peach) + KPI xanh lá
    {
      key: "tCur",
      label: ["[Target]", "SKU WIN", periodLabel(periods.cur)],
      title: `[Target] SKU WIN ${periodLabel(periods.cur)} (Mục tiêu)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
    {
      key: "cur",
      label: ["[Result]", "SKU WIN", periodLabel(periods.cur)],
      title: `[Result] SKU WIN ${periodLabel(periods.cur)} (Thực tế)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
    {
      key: "kpi",
      label: ["Tỷ lệ", "đạt KPI WIN"],
      title: "Tỷ lệ đạt KPI WIN (Thực tế / Mục tiêu)",
      ratio: true,
      headCls: "bg-[#a3cf95] text-black font-black",
      cellCls: "bg-[#d9ead3] font-bold text-emerald-950",
    },
    {
      key: "rPrev",
      label: ["[Result]", "Tăng trưởng", "/tháng trước"],
      title: "[Result] Tăng trưởng so với tháng trước",
      ratio: true,
      headCls: "bg-[#fed7aa] text-black font-extrabold",
      cellCls: "bg-white",
    },
    {
      key: "rLy",
      label: ["[Result]", "Tăng trưởng", "/cùng kỳ"],
      title: "[Result] Tăng trưởng so với cùng kỳ năm ngoái",
      ratio: true,
      headCls: "bg-[#fed7aa] text-black font-extrabold",
      cellCls: "bg-white",
      divider: true,
    },
    // 3. Đánh giá tháng này - Cụm TEST cùng màu vàng/peach như SKU WIN + KPI xanh lá
    {
      key: "tCurTest",
      label: ["[Target]", "SKU TEST", periodLabel(periods.cur)],
      title: `[Target] SKU TEST ${periodLabel(periods.cur)} (Mục tiêu TEST)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
    {
      key: "curTest",
      label: ["[Result]", "SKU TEST", periodLabel(periods.cur)],
      title: `[Result] SKU TEST ${periodLabel(periods.cur)} (Thực tế TEST)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
    {
      key: "kpiTest",
      label: ["Tỷ lệ", "đạt KPI TEST"],
      title: "Tỷ lệ đạt KPI SKU TEST (Thực tế / Mục tiêu)",
      ratio: true,
      headCls: "bg-[#a3cf95] text-black font-black",
      cellCls: "bg-[#d9ead3] font-bold text-emerald-950",
      divider: true,
    },
    // 4. Kế hoạch tháng sau (4 cột) — đồng bộ màu theo cụm
    {
      key: "lyNext",
      label: ["[Result]", periodLabel(periods.lyNext)],
      title: `[Result] ${periodLabel(periods.lyNext)} (căn cứ cùng kỳ năm ngoái)`,
      headCls: "bg-[#fef08a] text-black font-extrabold",
      cellCls: "bg-white",
    },
    {
      key: "tNextDev",
      label: ["[Target]", "SKU WIN", periodLabel(periods.next)],
      title: `[Target] SKU WIN ${periodLabel(periods.next)} (Mục tiêu WIN tháng sau)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
    {
      key: "tNextGrowth",
      label: ["[Target]", "Tăng trưởng", "/tháng trước"],
      title: "[Target] Tỷ lệ tăng trưởng mục tiêu tháng sau",
      ratio: true,
      headCls: "bg-[#a3cf95] text-black font-extrabold",
      cellCls: "bg-white font-semibold text-slate-800",
    },
    {
      key: "tNextTest",
      label: ["[Target]", "SKU TEST", periodLabel(periods.next)],
      title: `[Target] SKU TEST ${periodLabel(periods.next)} (Mục tiêu TEST tháng sau)`,
      headCls: "bg-[#fdba74] text-black font-extrabold",
      cellCls: "bg-[#ffedd5]",
    },
  ];

  // Tháng đang chạy: phần tháng đã qua (số liệu tới hết hôm qua) → vạch nhịp + dự kiến cả tháng
  const pace = (() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (periods.cur !== ym) return null;
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsed = now.getDate() - 1;
    return elapsed > 0 ? elapsed / days : null;
  })();
  const tileCommon = {
    period: periodLabel(periods.cur),
    live: data.sources.cur === "live",
    prevLabel: periodLabel(periods.prev),
    lyLabel: periodLabel(periods.ly),
    pace,
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          {...tileCommon}
          label="Revenue"
          actual={total.cur.revenue}
          target={total.tCur?.revenue ?? null}
          prev={total.prev.revenue}
          ly={lyOk ? total.ly.revenue : null}
          kind="usd"
        />
        <Tile
          {...tileCommon}
          label="Gross Profit"
          actual={grossCur}
          target={grossTarget}
          prev={grossPrev}
          ly={grossLy}
          kind="usd"
          extra={grossCur != null && total.cur.revenue ? `Margin ${fmtPct(grossCur / total.cur.revenue)}` : undefined}
        />
        <Tile
          {...tileCommon}
          label="Quantity"
          actual={total.cur.quantity}
          target={total.tCur?.quantity ?? null}
          prev={total.prev.quantity}
          ly={lyOk ? total.ly.quantity : null}
          kind="int"
        />
        <Tile
          {...tileCommon}
          label="TACoS"
          actual={tacosOf(total.cur)}
          target={total.tCur ? tacosOf(total.tCur) : null}
          prev={tacosOf(total.prev)}
          ly={lyOk ? tacosOf(total.ly) : null}
          kind="pct"
          cost
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 bg-slate-50/50">
          <h3 className="text-sm font-bold text-slate-900">Báo cáo tổng team · {periodLabel(periods.cur)}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full acc-kpi-report-table border-separate border-spacing-0 border-l border-t border-black text-xs">
            <thead>
              {/* Cấp 1: Các khối chức năng */}
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-[#ff9900] text-left`} />
                <th colSpan={2} className={`${hd} bg-[#fde047] border-r-2 border-r-black`} />
                <th colSpan={5} className={`${hd} bg-[#fb923c] text-black text-center uppercase tracking-wide font-black border-r-2 border-r-black`}>
                  Đánh giá tháng {periodLabel(periods.cur)} (SKU WIN)
                </th>
                <th colSpan={3} className={`${hd} bg-[#fb923c] text-black text-center uppercase tracking-wide font-black border-r-2 border-r-black`}>
                  SKU TEST {periodLabel(periods.cur)}
                </th>
                <th colSpan={4} className={`${hd} bg-[#fb923c] text-black text-center uppercase tracking-wide font-black`}>
                  Mục tiêu tháng {periodLabel(periods.next)}
                </th>
              </tr>
              {/* Cấp 2: Từng cột chỉ số */}
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-[#ff9900] text-black text-left font-black text-xs`}>Chỉ số</th>
                {REPORT_COLS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    className={`${hd} text-right align-bottom leading-tight ${c.headCls} ${c.divider ? "border-r-2 border-r-black" : ""}`}
                  >
                    {c.label.map((line, i) => (
                      <span key={i} className={`block font-black text-black ${i === 0 ? "text-[11px]" : "text-[12px]"}`}>
                        {line}
                      </span>
                    ))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REPORT_ROWS.filter((r) => r.key !== "pl_test").map((r) => {
                const row = report[r.key];
                // Như sheet: cột tên chỉ số và cả dòng Gross Profit tô cam #ff9900, chữ đậm
                const profitRow = r.key === "gross";
                return (
                  <tr key={r.key} className={profitRow ? "font-bold" : ""}>
                    <td className={`${cell} sticky left-0 z-10 bg-[#ff9900] text-left font-bold`}>{r.label}</td>
                    {REPORT_COLS.map((c) => {
                      const v = row[c.key];
                      const isRatio = c.ratio;
                      const text = v == null ? "" : isRatio || r.kind === "pct" ? fmtPct(v) : r.kind === "int" ? fmtInt(v) : fmtUsd(v);
                      return (
                        <td
                          key={c.key}
                          className={`${cell} text-right tabular-nums ${c.divider ? "border-r-2 border-r-black" : ""} ${
                            profitRow ? "bg-[#ff9900] font-bold text-black" : c.cellCls
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <KpiPhoiPicTable
        storeId={storeId}
        period={periods.cur}
        skus={data.skus}
        targetFormula={data.targetFormula}
        onOpenSku={onOpenSku}
      />

      <TargetFormulaPanel formula={data.targetFormula} canEdit={canEdit} onSave={onSaveFormula} />

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Đánh giá tổng quan</h3>
          {data.note?.updated_by && !dirty && (
            <span className="text-[11px] text-slate-400">
              {data.note.updated_by} · {data.note.updated_at ? new Date(data.note.updated_at).toLocaleString("vi-VN") : ""}
            </span>
          )}
        </div>
        <textarea
          aria-label="Đánh giá tổng quan"
          value={note}
          disabled={!canEdit}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Tổng kết kết quả team? Đánh giá năng lực/hiệu suất team/cá nhân? Bài học/Đề xuất hỗ trợ? Chiến lược hành động sắp tới?"
          className="w-full resize-y rounded-lg border border-slate-200 p-2.5 text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
        />
        {canEdit && dirty && (
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setNote(data.note?.note ?? "")} className="h-7 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
              Huỷ
            </button>
            <button
              type="button"
              disabled={savingNote}
              onClick={async () => {
                setSavingNote(true);
                try {
                  await onSaveNote(note);
                } finally {
                  setSavingNote(false);
                }
              }}
              className="h-7 cursor-pointer rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingNote ? "Đang lưu..." : "Lưu đánh giá"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ───────────────────────── Bảng SKU (phát triển / test) — đúng 99 cột của CHI TIẾT SKU / CHI TIẾT SKU TEST ─────────────────────────
// Nhóm kết quả (cùng kỳ, tháng trước, thực tế, cùng kỳ tháng sau): chi phí số âm như sheet.
// Nhóm mục tiêu: chi phí số dương, Gross Profit = REV − các chi phí (sheet: =AM-AO-AP-…).

interface RowCtx {
  s: KpiSku;
  ly: KpiMetrics | null;
  prev: KpiMetrics | null;
  cur: KpiMetrics | null;
  lyNext: KpiMetrics | null;
  tc: KpiMetrics | null;
  tn: KpiMetrics | null;
}

interface ColDef {
  id: string;
  label: string;
  /** Giá trị số để cộng dòng tổng (bỏ qua nếu không có) */
  value?: (c: RowCtx) => number | null | undefined;
  /** Định dạng ô; mặc định theo kind */
  kind?: "usd" | "int" | "pct" | "text";
  /** Dòng tổng tự tính (vd TACoS, %), khi không cộng được */
  total?: (t: RowCtx) => ReactNode;
  /** Ô tuỳ biến (ô nhập) */
  render?: (c: RowCtx) => ReactNode;
  width?: number;
  tone?: "good-bad";
}

interface ColGroup {
  key: string;
  title: string;
  sub: string;
  tone: string;
  cols: ColDef[];
}

// Màu đúng như sheet CHI TIẾT SKU / CHI TIẾT SKU TEST (đọc từ định dạng ô):
// dòng tháng #6d9eeb; dòng tên nhóm + tên cột theo nhóm; riêng tên cột "Thông tin sản phẩm" cam #ff9900; ô dữ liệu trắng.
const MONTH_BG = "bg-[#6d9eeb]";
const GROUP_PALETTE: Record<string, { head: string; sub: string }> = {
  info: { head: "bg-[#93c47d]", sub: "bg-[#ff9900]" },
  ly: { head: "bg-[#f9cb9c]", sub: "bg-[#f9cb9c]" },
  prev: { head: "bg-[#fff2cc]", sub: "bg-[#fff2cc]" },
  cur: { head: "bg-[#d5a6bd]", sub: "bg-[#d5a6bd]" },
  lyNext: { head: "bg-[#f9cb9c]", sub: "bg-[#f9cb9c]" },
  tnext: { head: "bg-[#b6d7a8]", sub: "bg-[#b6d7a8]" },
  tneval: { head: "bg-[#b6d7a8]", sub: "bg-[#b6d7a8]" },
};
/** Sheet tô đỏ nhạt ô % tăng trưởng âm (Đánh giá mục tiêu) */
const NEG_PCT_BG = "bg-[#ea9999]";

const neg = (v: number | null | undefined) => (v == null ? null : -v);

/** 12 cột kết quả 1 tháng như sheet (Lưu kho + CP khác gộp) */
function resultCols(prefix: string, pick: (c: RowCtx) => KpiMetrics | null, tncnLabel = "TNCN tax 1% Rev"): ColDef[] {
  const v = (f: (m: KpiMetrics) => number) => (c: RowCtx) => {
    const m = pick(c);
    return m ? f(m) : null;
  };
  return [
    { id: `${prefix}-rev`, label: "Revenue", value: v((m) => m.revenue) },
    { id: `${prefix}-qty`, label: "Quantity", kind: "int", value: v((m) => m.quantity) },
    { id: `${prefix}-ads`, label: "Ads Fee", value: v((m) => -m.ads_fee) },
    { id: `${prefix}-bc`, label: "Basecost", value: v((m) => -m.basecost) },
    { id: `${prefix}-amz`, label: "Amazon Fee", value: v((m) => -m.amazon_fee) },
    { id: `${prefix}-tacos`, label: "TAcos", kind: "pct", value: (c) => tacosOf(pick(c)), total: (t) => fmtPct(tacosOf(pick(t))) },
    { id: `${prefix}-adstax`, label: "Ads tax 10% Ads", value: v((m) => -m.ads_tax) },
    { id: `${prefix}-tncn`, label: tncnLabel, value: v((m) => -m.tncn_tax) },
    { id: `${prefix}-ref`, label: "Ref tax", value: v((m) => -m.ref_tax) },
    { id: `${prefix}-ret`, label: "Return", value: v((m) => -m.return_amount) },
    { id: `${prefix}-other`, label: "Lưu kho + CP khác", value: v((m) => -storageAndOther(m)) },
    { id: `${prefix}-profit`, label: "Profit", value: v((m) => m.profit), tone: "good-bad" },
  ];
}

function SkuTable({
  data,
  skus,
  canEdit,
  onSaveTarget,
  onSavePrice,
  onOpen,
}: {
  data: KpiData;
  skus: KpiSku[];
  canEdit: boolean;
  onSaveTarget: (sku: string, slot: TargetSlot, patch: Partial<TargetRow>) => void;
  onSavePrice?: (sku: string, price: number | null) => void;
  onOpen: (sku: string) => void;
}) {
  const { periods } = data;
  const rows: RowCtx[] = useMemo(
    () =>
      skus.map((s) => ({
        s,
        ly: s.actual.ly,
        prev: s.actual.prev,
        cur: s.actual.cur,
        lyNext: s.actual.lyNext,
        tc: targetOf(s, "cur", data.targetFormula),
        tn: targetOf(s, "next", data.targetFormula),
      })),
    [skus, data.targetFormula],
  );

  // Dòng tổng: cộng từng tháng; mục tiêu chỉ cộng SKU đã nhập
  const totalCtx: RowCtx = useMemo(() => {
    const sumOf = (pick: (r: RowCtx) => KpiMetrics | null) => {
      let any = false;
      let acc = emptyMetrics();
      for (const r of rows) {
        const m = pick(r);
        if (m) {
          any = true;
          acc = addMetrics(acc, m);
        }
      }
      return any ? acc : null;
    };
    return {
      s: skus[0],
      ly: sumOf((r) => r.ly),
      prev: sumOf((r) => r.prev),
      cur: sumOf((r) => r.cur),
      lyNext: sumOf((r) => r.lyNext),
      tc: sumOf((r) => r.tc),
      tn: sumOf((r) => r.tn),
    };
  }, [rows, skus]);

  const save = (sku: string, slot: TargetSlot, patch: Partial<TargetRow>) => onSaveTarget(sku, slot, patch);
  const unitInput = (slot: TargetSlot) => function UnitCell(c: RowCtx) {
    return (
    <NumInput ariaLabel={`Unit ${slot === "cur" ? "mục tiêu" : "tháng sau"} ${c.s.sku}`} value={c.s.target[slot]?.units ?? null} decimals={0} disabled={!canEdit} onCommit={(v) => save(c.s.sku, slot, { units: v })} />
    );
  };
  const tacosInput = (slot: TargetSlot) => function TacosCell(c: RowCtx) {
    return (
    <NumInput ariaLabel={`TACoS ${slot === "cur" ? "mục tiêu" : "tháng sau"} ${c.s.sku}`} percent value={c.s.target[slot]?.tacos ?? null} disabled={!canEdit} onCommit={(v) => save(c.s.sku, slot, { tacos: v })} />
    );
  };
  const storageInput = (slot: TargetSlot) => function StorageCell(c: RowCtx) {
    return (
    <NumInput ariaLabel={`Lưu kho ${slot === "cur" ? "mục tiêu" : "tháng sau"} ${c.s.sku}`} value={c.s.target[slot]?.storage_fee ?? null} disabled={!canEdit} onCommit={(v) => save(c.s.sku, slot, { storage_fee: v })} />
    );
  };
  const tv = (pick: (c: RowCtx) => KpiMetrics | null, f: (m: KpiMetrics) => number) => (c: RowCtx) => {
    const m = pick(c);
    return m ? f(m) : null;
  };
  const tn = (c: RowCtx) => c.tn;

  const groups: ColGroup[] = [
    {
      key: "info",
      title: "Thông tin sản phẩm",
      sub: "",
      tone: "text-slate-700",
      cols: [
        { id: "avail", label: "Available now", kind: "int", value: (c) => c.s.ton_kho },
        { id: "bcu", label: "Basecost", value: (c) => c.s.basecost_unit, total: () => "" },
      ],
    },
    {
      key: "ly",
      title: "Kết quả kinh doanh cùng kỳ năm trước",
      sub: `Tháng ${periodLabel(periods.ly).slice(1)}`,
      tone: "text-slate-700",
      cols: resultCols("ly", (c) => c.ly),
    },
    {
      key: "prev",
      title: "Kết quả kinh doanh tháng trước",
      sub: `Tháng ${periodLabel(periods.prev).slice(1)}`,
      tone: "text-slate-700",
      cols: resultCols("prev", (c) => c.prev, "Thuế TNCN 1% Rev"),
    },
    {
      key: "cur",
      title: "Kết quả kinh doanh thực tế",
      sub: `Tháng ${periodLabel(periods.cur).slice(1)}`,
      tone: "bg-blue-50 text-blue-900",
      cols: [
        { id: "c-rev", label: "Revenue", value: (c) => c.cur?.revenue ?? null },
        { id: "c-qty", label: "Quantity", kind: "int", value: (c) => c.cur?.quantity ?? null },
        { id: "c-ads", label: "Ads Fee", value: (c) => neg(c.cur?.ads_fee) },
        { id: "c-bc", label: "Basecost", value: (c) => neg(c.cur?.basecost) },
        { id: "c-amz", label: "Amazon Fee", value: (c) => neg(c.cur?.amazon_fee) },
        { id: "c-tacos", label: "TAcos", kind: "pct", value: (c) => tacosOf(c.cur), total: (t) => fmtPct(tacosOf(t.cur)) },
        { id: "c-adstax", label: "Ads tax 10% Ads", value: (c) => neg(c.cur?.ads_tax) },
        { id: "c-tncn", label: "TNCN tax 1% Rev", value: (c) => neg(c.cur?.tncn_tax) },
        { id: "c-ref", label: "Ref tax", value: (c) => neg(c.cur?.ref_tax) },
        { id: "c-ret", label: "Return", value: (c) => neg(c.cur?.return_amount) },
        { id: "c-adj", label: "Adjustment", value: (c) => neg(c.cur?.adjustment) },
        { id: "c-sto", label: "Lưu kho", value: (c) => neg(c.cur?.storage_fee) },
        { id: "c-plc", label: "Placement Fee", value: (c) => neg(c.cur?.placement_fee) },
        { id: "c-other", label: "CP khác", value: (c) => neg(c.cur?.other_fee) },
        { id: "c-profit", label: "Profit", value: (c) => c.cur?.profit ?? null, tone: "good-bad" },
      ],
    },
    {
      key: "lyNext",
      title: "Kết quả kinh doanh cùng kỳ tháng sau năm trước",
      sub: `Tháng ${periodLabel(periods.lyNext).slice(1)}`,
      tone: "text-slate-700",
      cols: resultCols("lyn", (c) => c.lyNext),
    },
    {
      key: "tnext",
      title: "Kết quả kinh doanh mục tiêu",
      sub: `Tháng ${periodLabel(periods.next).slice(1)}`,
      tone: "bg-indigo-50 text-indigo-900",
      cols: [
        { id: "tn-rev", label: "Revenue", value: tv(tn, (m) => m.revenue) },
        { id: "tn-qty", label: "Quantity ✎", kind: "int", value: tv(tn, (m) => m.quantity), render: unitInput("next") },
        { id: "tn-ads", label: "Ads Fee", value: tv(tn, (m) => m.ads_fee) },
        { id: "tn-bc", label: "Basecost", value: tv(tn, (m) => m.basecost) },
        { id: "tn-amz", label: "Amazon fee", value: tv(tn, (m) => m.amazon_fee) },
        { id: "tn-tacos", label: "Tacos ✎", kind: "pct", value: (c) => c.s.target.next?.tacos ?? null, render: tacosInput("next"), total: (t) => fmtPct(tacosOf(t.tn)) },
        { id: "tn-adstax", label: "Ads tax 10% Ads", value: tv(tn, (m) => m.ads_tax) },
        { id: "tn-tncn", label: "TNCN tax 1% Rev", value: tv(tn, (m) => m.tncn_tax) },
        { id: "tn-ref", label: "10% Ref tax", value: tv(tn, (m) => m.ref_tax) },
        { id: "tn-ret", label: "Return (2%)", value: tv(tn, (m) => m.return_amount) },
        { id: "tn-sto", label: "Lưu kho ✎", value: (c) => c.s.target.next?.storage_fee ?? null, render: storageInput("next") },
        { id: "tn-profit", label: "Profit", value: tv(tn, (m) => m.profit), tone: "good-bad" },
      ],
    },
    {
      key: "tneval",
      title: "Đánh giá mục tiêu",
      sub: "",
      tone: "text-slate-700",
      cols: [
        {
          id: "vs-ly",
          label: "So với cùng kỳ năm trước",
          kind: "pct",
          value: (c) => growth(c.tn?.profit, c.lyNext?.profit),
          total: (t) => signed(growth(t.tn?.profit, t.lyNext?.profit)),
          tone: "good-bad",
        },
        {
          id: "vs-prev",
          label: "So với tháng trước",
          kind: "pct",
          value: (c) => growth(c.tn?.profit, c.cur?.profit),
          total: (t) => signed(growth(t.tn?.profit, t.cur?.profit)),
          tone: "good-bad",
        },
        { id: "diff", label: "Chênh profit so với tháng trước", value: (c) => (c.tn ? c.tn.profit - (c.cur?.profit ?? 0) : null), tone: "good-bad" },
        {
          id: "roi",
          label: "ROI",
          kind: "pct",
          value: (c) => (c.tn && c.tn.basecost ? c.tn.profit / c.tn.basecost : null),
          total: (t) => fmtPct(t.tn && t.tn.basecost ? t.tn.profit / t.tn.basecost : null),
        },
      ],
    },
  ];

  const shown = groups;
  const fmtCell = (col: ColDef, v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "";
    if (col.kind === "int") return fmtInt(v);
    if (col.kind === "pct") return fmtPct(v);
    return fmtUsd(v);
  };
  const toneCls = (col: ColDef, v: number | null | undefined) =>
    col.tone === "good-bad" && col.kind === "pct" && v != null && v < -0.00005 ? NEG_PCT_BG : "";
  const totalCell = (col: ColDef): ReactNode => {
    if (col.total) return col.total(totalCtx);
    if (!col.value || col.kind === "text") return "";
    let sum = 0;
    let any = false;
    for (const r of rows) {
      const v = col.value(r);
      if (v != null && Number.isFinite(v)) {
        sum += v;
        any = true;
      }
    }
    return any ? <span className={toneCls(col, sum)}>{fmtCell(col, sum)}</span> : "";
  };

  // 4 cột đầu cố định (Product Type, Mockup, SKU, Price)
  const FIX = [
    { label: "Product Type", w: 120 },
    { label: "Mockup", w: 56 },
    { label: "SKU", w: 140 },
    { label: "Price ✎", w: 84 },
  ];
  const leftOf = (i: number) => FIX.slice(0, i).reduce((a, f) => a + f.w, 0);
  // Lưới kẻ đen như bảng SKU Testing: mỗi ô kẻ phải + dưới, bảng kẻ trên + trái; đầu mỗi nhóm cột kẻ đậm
  const grid = "border-r border-b border-black";
  const fixCls = `sticky z-10 bg-white group-hover:bg-yellow-50 ${grid}`;
  const th = `px-2 py-1.5 text-right text-[11px] font-bold text-black whitespace-nowrap ${grid}`;
  const td = `px-2 py-1 text-right tabular-nums whitespace-nowrap ${grid}`;
  const pal = (g: ColGroup) => GROUP_PALETTE[g.key] || GROUP_PALETTE.info;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <table className="border-separate border-spacing-0 border-l border-t border-black text-xs">
          <thead className="sticky top-0 z-20">
            <tr>
              <th colSpan={FIX.length} className={`sticky left-0 z-30 ${MONTH_BG} px-2 py-1.5 text-left text-[11px] font-bold uppercase text-black ${grid}`}>
                Bóc tách chi tiết · {skus.length} SKU
              </th>
              {shown.map((g) => (
                <th key={g.key} colSpan={g.cols.length} className={`px-2 py-1 text-center text-[11px] font-bold text-black ${grid} ${g.sub || g.key === "info" ? MONTH_BG : "bg-white"}`}>
                  {g.sub}
                </th>
              ))}
            </tr>
            <tr>
              <th colSpan={FIX.length} className={`sticky left-0 z-30 ${GROUP_PALETTE.info.head} px-2 py-1.5 text-left text-[11px] font-bold uppercase text-black ${grid}`}>
                Thông tin sản phẩm
              </th>
              {shown.map((g) => (
                <th key={g.key} colSpan={g.cols.length} className={`px-2 py-1.5 text-center text-[11px] font-bold text-black ${grid} ${pal(g).head}`}>
                  {g.key === "info" ? "" : g.title}
                </th>
              ))}
            </tr>
            <tr>
              {FIX.map((f, i) => (
                <th
                  key={f.label}
                  style={{ left: leftOf(i), minWidth: f.w, maxWidth: f.w }}
                  className={`sticky z-30 ${GROUP_PALETTE.info.sub} px-2 py-1.5 ${f.label.startsWith("Price") ? "text-right" : "text-left"} text-[11px] font-bold text-black ${grid}`}
                >
                  {f.label}
                </th>
              ))}
              {shown.map((g) =>
                g.cols.map((col) => (
                  <th key={col.id} style={col.width ? { minWidth: col.width } : undefined} className={`${th} ${pal(g).sub} ${col.kind === "text" ? "text-left" : ""}`}>
                    {col.label}
                  </th>
                )),
              )}
            </tr>
            <tr className="font-bold">
              {/* Dòng Tổng tô vàng nhạt để tách khỏi tiêu đề và các dòng SKU */}
              <td colSpan={FIX.length} className={`sticky left-0 z-30 border-b-2 bg-[#FFF2CC] px-2 py-1.5 text-left text-black ${grid}`}>
                Tổng
              </td>
              {shown.map((g) =>
                g.cols.map((col) => (
                  <td key={col.id} className={`${td} border-b-2 bg-[#FFF2CC] text-black`}>
                    {totalCell(col)}
                  </td>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.s.sku} className="group">
                <td style={{ left: leftOf(0), minWidth: FIX[0].w, maxWidth: FIX[0].w }} className={`${fixCls} truncate px-2 py-1 text-black`} title={c.s.product_type || ""}>
                  {c.s.product_type || ""}
                </td>
                <td style={{ left: leftOf(1), minWidth: FIX[1].w, maxWidth: FIX[1].w }} className={`${fixCls} px-2 py-1`}>
                  <Thumb url={c.s.mockup_url} />
                </td>
                <td
                  style={{ left: leftOf(2), minWidth: FIX[2].w, maxWidth: FIX[2].w }}
                  className={`${fixCls} cursor-pointer truncate px-2 py-1 font-bold text-blue-800 hover:underline`}
                  onClick={() => onOpen(c.s.sku)}
                  title="Xem chi tiết"
                >
                  {c.s.sku}
                </td>
                <td
                  style={{ left: leftOf(3), minWidth: FIX[3].w, maxWidth: FIX[3].w }}
                  className={`${fixCls} px-2 py-1 text-right`}
                >
                  <EditablePriceCell
                    value={c.s.price}
                    canEdit={canEdit}
                    onCommit={(newPrice) => onSavePrice?.(c.s.sku, newPrice)}
                  />
                </td>
                {shown.map((g) =>
                  g.cols.map((col) => {
                    const v = col.value ? col.value(c) : null;
                    return (
                      <td
                        key={col.id}
                        className={`${td} bg-white text-black group-hover:bg-yellow-50 ${toneCls(col, v)} ${col.kind === "text" ? "text-left" : ""}`}
                      >
                        {col.render ? col.render(c) : fmtCell(col, v)}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={FIX.length + shown.reduce((a, g) => a + g.cols.length, 0)} className={`px-3 py-10 text-center text-sm text-slate-500 ${grid}`}>
                  Không có SKU nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Drawer chi tiết 1 SKU ─────────────────────────
function SkuDrawer({
  data,
  sku,
  canEdit,
  onClose,
  onSaveTarget,
}: {
  data: KpiData;
  sku: KpiSku;
  canEdit: boolean;
  onClose: () => void;
  onSaveTarget: (sku: string, slot: TargetSlot, patch: Partial<TargetRow>) => void;
}) {
  const { periods } = data;
  const tc = targetOf(sku, "cur", data.targetFormula);
  const tn = targetOf(sku, "next", data.targetFormula);
  const cols: { label: string; m: KpiMetrics | null; tone?: string }[] = [
    { label: `Cùng kỳ ${periodLabel(periods.ly)}`, m: sku.actual.ly },
    { label: `Tháng trước ${periodLabel(periods.prev)}`, m: sku.actual.prev },
    { label: `Mục tiêu ${periodLabel(periods.cur)}`, m: tc, tone: "bg-amber-50/60" },
    { label: `Thực tế ${periodLabel(periods.cur)}`, m: sku.actual.cur, tone: "bg-blue-50/60" },
    { label: `Cùng kỳ ${periodLabel(periods.lyNext)}`, m: sku.actual.lyNext },
    { label: `Mục tiêu ${periodLabel(periods.next)}`, m: tn, tone: "bg-indigo-50/60" },
  ];

  const [texts, setTexts] = useState({ cause: sku.target.cur?.cause ?? "", solution: sku.target.cur?.solution ?? "", action: sku.target.cur?.action ?? "" });
  const saveText = (k: "cause" | "solution" | "action") => {
    const v = texts[k].trim();
    if (v === (sku.target.cur?.[k] ?? "")) return;
    onSaveTarget(sku.sku, "cur", { [k]: v || null });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-[860px] flex-col overflow-hidden bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <Thumb url={sku.mockup_url} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">{sku.sku}</div>
            <div className="truncate text-xs text-slate-500">
              {GROUP_LABEL[sku.group]} · {sku.product_type || "—"} · {sku.asin || "—"}
              {sku.pic_mkt ? ` · PIC ${sku.pic_mkt}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="cursor-pointer rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ["Giá bán", fmtUsd(sku.price)],
              ["Basecost/unit", fmtUsd(sku.basecost_unit)],
              ["Amazon fee/unit", fmtUsd(sku.amazon_fee_unit)],
              ["Referral", fmtPct(sku.referral_pct)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="text-[11px] text-slate-500">{k}</div>
                <div className="font-semibold tabular-nums text-slate-900">{v || "—"}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["cur", "next"] as const).map((slot) => {
              const t = sku.target[slot];
              return (
                <div key={slot} className={`rounded-lg border p-3 ${slot === "cur" ? "border-amber-200 bg-amber-50/40" : "border-indigo-200 bg-indigo-50/40"}`}>
                  <div className="mb-2 text-xs font-bold text-slate-800">Mục tiêu {periodLabel(slot === "cur" ? periods.cur : periods.next)}</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <label className="flex items-center justify-between gap-2">
                      Unit
                      <NumInput ariaLabel="Unit" width="w-20" decimals={0} value={t?.units ?? null} disabled={!canEdit} onCommit={(v) => onSaveTarget(sku.sku, slot, { units: v })} />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      TACoS
                      <NumInput ariaLabel="TACoS" width="w-20" percent value={t?.tacos ?? null} disabled={!canEdit} onCommit={(v) => onSaveTarget(sku.sku, slot, { tacos: v })} />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      Giá
                      <NumInput ariaLabel="Giá" width="w-20" value={t?.price ?? null} placeholder={sku.price != null ? String(sku.price) : ""} disabled={!canEdit} onCommit={(v) => onSaveTarget(sku.sku, slot, { price: v })} />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      Lưu kho dự tính
                      <NumInput ariaLabel="Lưu kho dự tính" width="w-20" value={t?.storage_fee ?? null} disabled={!canEdit} onCommit={(v) => onSaveTarget(sku.sku, slot, { storage_fee: v })} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-2.5 py-2 text-left text-[11px] font-semibold text-slate-600">Chỉ số</th>
                  {cols.map((c) => (
                    <th key={c.label} className={`px-2.5 py-2 text-right text-[11px] font-semibold text-slate-600 ${c.tone || ""}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PL_ROWS.filter((r) => !r.storeOnly).map((r) => (
                  <tr key={r.key} className={`border-b border-slate-100 ${r.strong ? "font-bold" : ""}`}>
                    <td className="px-2.5 py-1.5 text-slate-700">{r.label}</td>
                    {cols.map((c) => {
                      const v = metricValue(c.m, r.key);
                      return (
                        <td key={c.label} className={`px-2.5 py-1.5 text-right tabular-nums ${c.tone || ""} ${r.key === "profit" && v != null && v < 0 ? "text-rose-700" : ""}`}>
                          {fmtMetric(v, r.kind)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-800">Đánh giá {periodLabel(periods.cur)}</div>
            {(
              [
                ["cause", "Nguyên nhân"],
                ["solution", "Giải pháp"],
                ["action", "Action"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">{label}</span>
                <textarea
                  value={texts[k]}
                  disabled={!canEdit}
                  rows={2}
                  onChange={(e) => setTexts((p) => ({ ...p, [k]: e.target.value }))}
                  onBlur={() => saveText(k)}
                  className="w-full resize-y rounded-lg border border-slate-200 p-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden disabled:bg-slate-50"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── Hộp nạp số năm trước ─────────────────────────
function HistoryImportModal({ storeId, storeName, onClose, onDone }: { storeId: string; storeName: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; year: number; rows: number; months: { period: string; skus: number; revenue: number; profit: number }[] } | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/accounting/financials/kpi/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Không nạp được");
      setResult(json);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không nạp được");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-bold text-slate-900">Nạp số năm trước · {storeName}</div>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Dán link file <b>TỔNG KẾT CUỐI THÁNG_{storeName} &lt;năm&gt;</b>. Hệ thống tính lại kết quả từng SKU FBA từng tháng theo đúng công thức tab SKU-monthly
          (từ các tab Basecost, Ads, Trans Rp, Lưu kho…) để làm cột &quot;Cùng kỳ năm trước&quot;. Nạp lại sẽ thay số cũ của năm đó. Sheet cần chia sẻ quyền Người xem cho
          email service account.
        </p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="mb-2 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-xs focus:border-blue-500 focus:outline-hidden"
        />
        {err && <div className="mb-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700">{err}</div>}
        {result && (
          <div className="mb-2 max-h-56 overflow-y-auto rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-xs text-emerald-900">
            <div className="mb-1 font-bold">
              Đã nạp {result.title}: {result.rows} dòng SKU-tháng
            </div>
            <table className="w-full tabular-nums">
              <tbody>
                {result.months.map((m) => (
                  <tr key={m.period}>
                    <td>{periodLabel(m.period)}</td>
                    <td className="text-right">{m.skus} SKU</td>
                    <td className="text-right">{fmtUsd0(m.revenue)}</td>
                    <td className={`text-right ${m.profit < 0 ? "text-rose-700" : ""}`}>{fmtUsd0(m.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            Đóng
          </button>
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={run}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy && <ArrowClockwiseIcon size={13} className="animate-spin" />}
            {busy ? "Đang đọc sheet..." : "Nạp số"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── Hộp nạp mục tiêu từ file KẾ HOẠCH KINH DOANH ─────────────────────────
type TargetImportResult = {
  title: string;
  skuTargets: { tab: string; group: "dev" | "test"; period: string; count: number; notInMaster: string[] }[];
  teamTargets: { tab: string; group: "dev" | "test"; period: string; revenue: number; profit: number }[];
};
function TargetImportModal({ storeId, storeName, onClose, onDone }: { storeId: string; storeName: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<TargetImportResult | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/accounting/financials/kpi/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Không nạp được");
      setResult(json);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không nạp được");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-sm font-bold text-slate-900">Nạp mục tiêu từ sheet · {storeName}</div>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Dán link file <b>{storeName} - KẾ HOẠCH KINH DOANH &lt;năm&gt;</b>. Lấy mục tiêu từng SKU (Quantity, Tacos, Lưu kho, Price, Basecost, Amazon fee) ở khối
          tháng sau của tab CHI TIẾT SKU / CHI TIẾT SKU TEST, và mục tiêu tổng team ở các tab BÁO CÁO THÁNG. Nạp lại sẽ ghi đè số mục tiêu, giữ nguyên Nguyên nhân /
          Giải pháp / Action.
        </p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="mb-2 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-xs focus:border-blue-500 focus:outline-hidden"
        />
        {err && <div className="mb-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700">{err}</div>}
        {result && (
          <div className="mb-2 max-h-64 overflow-y-auto rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-xs text-emerald-900">
            <div className="mb-1 font-bold">Đã nạp {result.title}</div>
            {result.skuTargets.map((x) => (
              <div key={x.tab}>
                {x.tab} → mục tiêu {periodLabel(x.period)}: <b>{x.count} SKU</b>
                {x.notInMaster.length > 0 && (
                  <span className="text-amber-800"> · {x.notInMaster.length} SKU không thuộc nhóm này trong Bảng mã: {x.notInMaster.join(", ")}</span>
                )}
              </div>
            ))}
            {result.teamTargets.length > 0 && <div className="mt-1 font-semibold">Mục tiêu tổng team:</div>}
            {result.teamTargets.map((x) => (
              <div key={`${x.period}-${x.group}`} className="tabular-nums">
                {periodLabel(x.period)} {GROUP_LABEL[x.group]}: Revenue {fmtUsd0(x.revenue)} · Profit {fmtUsd0(x.profit)} <span className="text-emerald-700/70">({x.tab})</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            Đóng
          </button>
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={run}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy && <ArrowClockwiseIcon size={13} className="animate-spin" />}
            {busy ? "Đang đọc sheet..." : "Nạp mục tiêu"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── Trang chính ─────────────────────────
export function KpiView() {
  const defaultPeriod = useMemo(() => shiftPeriod(new Date().toISOString().slice(0, 7), -1), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [period, setPeriod] = useState(defaultPeriod);
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "overview";
    try {
      const saved = window.sessionStorage.getItem("acc_kpi_mode");
      return saved === "dev" || saved === "test" ? saved : "overview";
    } catch {
      return "overview";
    }
  });
  const handleMode = (m: Mode) => {
    setMode(m);
    try {
      window.sessionStorage.setItem("acc_kpi_mode", m);
    } catch {
      // trình duyệt chặn storage
    }
  };
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fType, setFType] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showTargetImport, setShowTargetImport] = useState(false);

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
        const params = new URLSearchParams({ store_id: selectedStoreId, period });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/accounting/financials/kpi?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Không tải được dữ liệu");
        setData(json as KpiData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu");
      } finally {
        setLoading(false);
      }
    },
    [selectedStoreId, period],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const selectedStore = stores.find((s) => s.id === selectedStoreId);
  const canEdit = storeCanEdit(selectedStore, "FBA");

  const saveTarget = useCallback(
    async (sku: string, slot: TargetSlot, patch: Partial<TargetRow>) => {
      if (!data || !selectedStoreId) return;
      const targetPeriod = slot === "cur" ? data.periods.cur : data.periods.next;
      // Cập nhật ngay trên giao diện, lỗi thì tải lại
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skus: prev.skus.map((s) => {
            if (s.sku !== sku) return s;
            const base: TargetRow = s.target[slot] || { units: null, tacos: null, price: null, storage_fee: null, cause: null, solution: null, action: null, review: null, target_action: null, updated_by: null, updated_at: null };
            // Sửa Unit / TACoS / giá / lưu kho thì bỏ số gõ tay nạp từ sheet (server cũng xoá) → tính lại theo công thức
            const edited = ["units", "tacos", "price", "storage_fee"].some((k) => k in patch);
            return { ...s, target: { ...s.target, [slot]: { ...base, ...patch, ...(edited ? { sheet_metrics: null } : {}) } } };
          }),
        };
      });
      try {
        const res = await fetch("/api/accounting/financials/kpi", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: selectedStoreId, period: targetPeriod, sku, ...patch }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Không lưu được mục tiêu");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không lưu được mục tiêu");
        void load();
      }
    },
    [data, selectedStoreId, load],
  );

  const savePrice = useCallback(
    async (sku: string, price: number | null) => {
      if (!data || !selectedStoreId) return;
      // Cập nhật ngay trên giao diện: đổi giá bán, bỏ sheet_metrics của SKU để mục tiêu tự tính lại theo giá mới
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          skus: prev.skus.map((s) => {
            if (s.sku !== sku) return s;
            return {
              ...s,
              price,
              target: {
                cur: s.target.cur ? { ...s.target.cur, price, sheet_metrics: null } : null,
                next: s.target.next ? { ...s.target.next, price, sheet_metrics: null } : null,
              },
            };
          }),
        };
      });
      try {
        const res = await fetch("/api/accounting/financials/kpi", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: selectedStoreId, period: data.periods.cur, sku, sku_price: price }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Không lưu được giá");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không lưu được giá");
        void load();
      }
    },
    [data, selectedStoreId, load],
  );

  const saveNote = useCallback(
    async (note: string) => {
      if (!data || !selectedStoreId) return;
      const res = await fetch("/api/accounting/financials/kpi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: selectedStoreId, period: data.periods.cur, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Không lưu được đánh giá");
        return;
      }
      setData((prev) => (prev ? { ...prev, note: { note, updated_by: "Bạn", updated_at: new Date().toISOString() } } : prev));
    },
    [data, selectedStoreId],
  );

  const saveFormula = useCallback(
    async (patch: Partial<KpiTargetFormula>) => {
      if (!data || !selectedStoreId) return;
      const res = await fetch("/api/accounting/financials/kpi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: selectedStoreId, period: data.periods.cur, target_formula: patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Không lưu được công thức mục tiêu");
        return;
      }
      setData((prev) => (prev ? { ...prev, targetFormula: json.targetFormula } : prev));
    },
    [data, selectedStoreId],
  );

  const deferredSearch = useDeferredValue(search);
  const groupSkus = useMemo(() => (data?.skus || []).filter((s) => s.group === (mode === "test" ? "test" : "dev")), [data, mode]);
  const typeOptions = useMemo(() => Array.from(new Set(groupSkus.map((s) => s.product_type || "(trống)"))).sort(), [groupSkus]);
  const visibleSkus = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return groupSkus.filter((s) => {
      if (fType && (s.product_type || "(trống)") !== fType) return false;
      if (onlyActive && !s.actual.cur?.revenue && !s.actual.cur?.ads_fee && !s.target.cur && !s.target.next) return false;
      if (!q) return true;
      return [s.sku, s.asin, s.product_type, s.pic_mkt].some((x) => x?.toLowerCase().includes(q));
    });
  }, [groupSkus, deferredSearch, fType, onlyActive]);

  const openSkuRow = data?.skus.find((s) => s.sku === openSku) || null;

  const filterCls = (v: string) =>
    `h-8 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold focus:outline-hidden ${v ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700"}`;

  const counts = useMemo(() => {
    const c = { dev: 0, test: 0 };
    for (const s of data?.skus || []) c[s.group] += 1;
    return c;
  }, [data]);

  let body: ReactNode = null;
  if (data) {
    if (mode === "overview") body = <OverviewPage key={`${selectedStoreId}:${data.period}`} data={data} canEdit={canEdit} storeId={selectedStoreId} onSaveNote={saveNote} onSaveFormula={saveFormula} onOpenSku={setOpenSku} />;
    else body = <SkuTable data={data} skus={visibleSkus} canEdit={canEdit} onSaveTarget={saveTarget} onSavePrice={savePrice} onOpen={setOpenSku} />;
  }

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-2 font-sans">
      <div className="flex shrink-0 flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 p-2">
          <div className="flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs">
            <StorefrontIcon size={15} weight="bold" className="mr-1.5 shrink-0 text-slate-500" />
            <select
              id="kpi-store-select"
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

          <div className="flex h-8 items-center rounded-lg border border-slate-300 bg-white">
            <button type="button" aria-label="Tháng trước" onClick={() => setPeriod((p) => shiftPeriod(p, -1))} className="flex h-full cursor-pointer items-center px-1.5 text-slate-500 hover:text-slate-900">
              <CaretLeftIcon size={13} weight="bold" />
            </button>
            <select id="kpi-period" aria-label="Tháng báo cáo" value={period} onChange={(e) => setPeriod(e.target.value)} className="cursor-pointer bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden">
              {monthOptions(defaultPeriod).map((p) => (
                <option key={p} value={p}>
                  Báo cáo {periodLabel(p)}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Tháng sau" onClick={() => setPeriod((p) => shiftPeriod(p, 1))} className="flex h-full cursor-pointer items-center px-1.5 text-slate-500 hover:text-slate-900">
              <CaretRightIcon size={13} weight="bold" />
            </button>
          </div>

          <span className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />

          <div className="relative flex h-8 items-center rounded-lg border border-slate-300 bg-slate-100/90 p-0.5 shadow-2xs">
            {(
              [
                { key: "overview", label: "Tổng quan tháng" },
                { key: "dev", label: `SKU phát triển${data ? ` (${counts.dev})` : ""}` },
                { key: "test", label: `SKU test${data ? ` (${counts.test})` : ""}` },
              ] as const
            ).map((o) => {
              const isActive = mode === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => handleMode(o.key)}
                  className={`relative z-10 cursor-pointer rounded-md px-3.5 py-1 text-xs font-bold select-none transition-colors duration-150 ${isActive ? "text-white" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {isActive && <AnimatedTabPill layoutId="kpi-mode-pill" className="bg-blue-600 shadow-xs rounded-md" />}
                  <span className="relative z-10">{o.label}</span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {canEdit && selectedStore && (
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CloudArrowDownIcon size={14} className="text-slate-600" />
                <span>Nạp số năm trước</span>
              </button>
            )}
            {canEdit && selectedStore && (
              <button
                type="button"
                onClick={() => setShowTargetImport(true)}
                className="flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CloudArrowDownIcon size={14} className="text-slate-600" />
                <span>Nạp mục tiêu</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading || !selectedStoreId}
              className="flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <ArrowClockwiseIcon size={14} className={loading ? "animate-spin text-amber-600" : "text-slate-600"} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {mode !== "overview" && data && (
          <div className="flex flex-wrap items-center gap-2 bg-slate-50/60 p-2">
            <div className="relative w-56 transition-all duration-200 focus-within:w-72">
              <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="kpi-search"
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
            <select aria-label="Phôi" value={fType} onChange={(e) => setFType(e.target.value)} className={filterCls(fType)}>
              <option value="">Phôi: tất cả</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-blue-600" />
              Chỉ SKU có bán / có mục tiêu
            </label>
            <span className="ml-auto text-[11px] text-slate-500">Ô vàng ✎ là leader nhập · Nhấn đúp ô Price để sửa giá mục tiêu · Nhấn mã SKU để xem chi tiết</span>
          </div>
        )}
      </div>


      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

      <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <AccountingTopProgressBar loading={loading} variant="indigo" />
        {loading && !data && <div className="p-6 text-center text-xs text-slate-500">Đang tải KPI...</div>}
        {!loading && !data && !error && <div className="p-6 text-center text-xs text-slate-500">Chọn store để xem KPI.</div>}
        {data && <div className={`flex-1 ${mode === "overview" ? "overflow-auto" : "overflow-hidden bg-white"}`}>{body}</div>}
      </div>

      {openSkuRow && data && (
        <SkuDrawer key={`${openSkuRow.sku}:${data.period}`} data={data} sku={openSkuRow} canEdit={canEdit} onClose={() => setOpenSku(null)} onSaveTarget={saveTarget} />
      )}
      {showTargetImport && selectedStore && (
        <TargetImportModal storeId={selectedStore.id} storeName={selectedStore.name} onClose={() => setShowTargetImport(false)} onDone={() => void load(true)} />
      )}
      {showImport && selectedStore && (
        <HistoryImportModal storeId={selectedStore.id} storeName={selectedStore.name} onClose={() => setShowImport(false)} onDone={() => void load(true)} />
      )}
    </div>
  );
}
