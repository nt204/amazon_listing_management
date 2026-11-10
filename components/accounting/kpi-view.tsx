/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState, useDeferredValue, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
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

const SOURCE_LABEL: Record<Source, string> = {
  closed: "đã chốt",
  history: "file tổng kết",
  live: "tạm tính",
  none: "chưa có số",
};

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
function targetOf(s: KpiSku, slot: TargetSlot) {
  return computeTarget(s.target[slot], unitEcon(s));
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
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  percent?: boolean;
  width?: string;
  ariaLabel: string;
}) {
  const shown = value == null ? "" : percent ? String(Math.round(value * 1000) / 10) : String(value);
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

function Thumb({ url }: { url: string | null }) {
  const src = getOptimizedThumbnailUrl(url, 64);
  if (!src) return <div className="h-9 w-9 shrink-0 rounded-md bg-slate-100" />;
  return <img src={src} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-slate-200 object-cover" />;
}

// ───────────────────────── Tổng quan tháng ─────────────────────────
function Tile({ label, actual, target, prev, ly, kind, cost }: { label: string; actual: number | null; target: number | null; prev: number | null; ly: number | null; kind: "usd" | "int" | "pct"; cost?: boolean }) {
  const ach = cost ? null : achievement(actual, target);
  const fmt = (v: number | null) => (kind === "usd" ? fmtUsd0(v) : kind === "int" ? fmtInt(v) : fmtPct(v));
  const gPrev = kind === "pct" ? (actual != null && prev != null ? actual - prev : null) : growth(actual, prev);
  const gLy = kind === "pct" ? (actual != null && ly != null ? actual - ly : null) : growth(actual, ly);
  const pp = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} điểm`);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-slate-900">{fmt(actual) || "—"}</span>
        {target != null && <span className="text-xs text-slate-500">/ mục tiêu {fmt(target)}</span>}
      </div>
      {!cost && target != null ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${ach != null && ach >= 1 ? "bg-emerald-500" : ach != null && ach >= 0.7 ? "bg-amber-500" : "bg-rose-500"}`}
              style={{ width: `${Math.max(0, Math.min(100, (ach ?? 0) * 100))}%` }}
            />
          </div>
          <span className={`text-xs font-bold tabular-nums ${achieveTone(ach)}`}>{fmtPct(ach)}</span>
        </div>
      ) : (
        <div className="h-[18px]" />
      )}
      <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-500">
        <span>
          vs tháng trước <b className={growthTone(gPrev, cost)}>{kind === "pct" ? pp(gPrev) : signed(gPrev)}</b>
        </span>
        <span>
          vs cùng kỳ <b className={growthTone(gLy, cost)}>{kind === "pct" ? pp(gLy) : signed(gLy)}</b>
        </span>
      </div>
    </div>
  );
}

function OverviewPage({
  data,
  canEdit,
  onSaveNote,
}: {
  data: KpiData;
  canEdit: boolean;
  onSaveNote: (note: string) => Promise<void>;
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
      const tc = targetOf(s, "cur");
      const tn = targetOf(s, "next");
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
  }, [data.skus, data.teamTargets]);

  // Như sheet BÁO CÁO THÁNG: "tổng team" = SKU phát triển; SKU test là dòng "P/L SKU testing" riêng
  const a = sum.by.dev;
  const t = sum.by.test;
  const lyOk = data.sources.ly !== "none";
  const lyNextOk = data.sources.lyNext !== "none";
  const tCur = a.hasTCur ? a.tCur : null;
  const tNext = a.hasTNext ? a.tNext : null;
  const testTNext = t.hasTNext ? t.tNext : null;
  const fees = data.storeFees ?? { prev: null, cur: null, ly: null, lyNext: null };
  const report = useMemo(
    () =>
      buildMonthReport({
        dev: { prev: a.prev, cur: a.cur, ly: lyOk ? a.ly : null, lyNext: lyNextOk ? a.lyNext : null, tCur, tNext },
        test: { prev: t.prev, cur: t.cur, ly: lyOk ? t.ly : null, lyNext: lyNextOk ? t.lyNext : null, tNext: testTNext },
        storeFeeCur: fees.cur,
      }),
    [a, t, lyOk, lyNextOk, tCur, tNext, testTNext, fees.cur],
  );

  const [note, setNote] = useState(data.note?.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const dirty = note !== (data.note?.note ?? "");

  const th = "px-3 py-2 text-right text-[11px] font-semibold text-slate-600 whitespace-nowrap";
  const td = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  // Bảng BÁO CÁO THÁNG: lưới đen, tên cột như sheet
  const hd = "border-r border-b border-black px-2.5 py-1.5 text-[11px] font-bold text-black whitespace-nowrap";
  const cell = "border-r border-b border-black px-2.5 py-1.5 whitespace-nowrap";
  const REPORT_COLS: { key: ReportCol; label: string; ratio?: boolean; bg: string }[] = [
    { key: "prev", label: `[Result] ${periodLabel(periods.prev)}`, bg: "" },
    { key: "tCur", label: `[Target] ${periodLabel(periods.cur)}`, bg: "bg-[#fff2cc]" },
    { key: "ly", label: `[Result] ${periodLabel(periods.ly)}`, bg: "" },
    { key: "cur", label: `[Result] ${periodLabel(periods.cur)}`, bg: "bg-[#cfe2f3]" },
    { key: "rPrev", label: "[Result] Tăng trưởng/tháng trước", ratio: true, bg: "" },
    { key: "rLy", label: "[Result] Tăng trưởng/cùng kỳ", ratio: true, bg: "" },
    { key: "kpi", label: "Tỷ lệ đạt KPI", ratio: true, bg: "bg-[#d9ead3]" },
    { key: "lyNext", label: `[Result] ${periodLabel(periods.lyNext)}`, bg: "" },
    { key: "tNextDev", label: `[Target] SKU WIN ${periodLabel(periods.next)}`, bg: "bg-[#fff2cc]" },
    { key: "tNextGrowth", label: "[Target] Tăng trưởng/tháng trước", ratio: true, bg: "" },
    { key: "tNextTest", label: `[Target] SKU TEST ${periodLabel(periods.next)}`, bg: "bg-[#fff2cc]" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={`Revenue SKU phát triển ${periodLabel(periods.cur)}`} actual={a.cur.revenue} target={tCur?.revenue ?? null} prev={a.prev.revenue} ly={lyOk ? a.ly.revenue : null} kind="usd" />
        <Tile
          label="Gross Profit"
          actual={report.gross.cur ?? null}
          target={report.gross.tCur ?? null}
          prev={report.gross.prev ?? null}
          ly={report.gross.ly ?? null}
          kind="usd"
        />
        <Tile label="Quantity" actual={a.cur.quantity} target={tCur?.quantity ?? null} prev={a.prev.quantity} ly={lyOk ? a.ly.quantity : null} kind="int" />
        <Tile label="TACoS" actual={tacosOf(a.cur)} target={tacosOf(tCur)} prev={tacosOf(a.prev)} ly={lyOk ? tacosOf(a.ly) : null} kind="pct" cost />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-900">Báo cáo tổng team · {periodLabel(periods.cur)}</h3>
          <span className="text-[11px] text-slate-500">Tổng team = SKU phát triển (FBA) · SKU test tính riêng ở dòng P/L SKU testing</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-separate border-spacing-0 border-l border-t border-black text-xs">
            <thead>
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-white text-left`} />
                <th colSpan={7} className={`${hd} bg-[#d9ead3] text-center uppercase`}>Báo cáo tháng</th>
                <th colSpan={4} className={`${hd} bg-[#fce5cd] text-center uppercase`}>Mục tiêu tháng</th>
              </tr>
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-white text-left`}>Chỉ số</th>
                {REPORT_COLS.map((c) => (
                  <th key={c.key} className={`${hd} text-right ${c.bg}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REPORT_ROWS.map((r) => {
                const row = report[r.key];
                const strong = r.key === "revenue" || r.key === "gross";
                return (
                  <tr key={r.key} className={strong ? "font-bold" : ""}>
                    <td className={`${cell} sticky left-0 z-10 bg-white text-left font-semibold`}>{r.label}</td>
                    {REPORT_COLS.map((c) => {
                      const v = row[c.key];
                      const isRatio = c.ratio;
                      const text = v == null ? "" : isRatio || r.kind === "pct" ? fmtPct(v) : r.kind === "int" ? fmtInt(v) : fmtUsd(v);
                      return (
                        <td key={c.key} className={`${cell} text-right tabular-nums ${c.bg}`}>
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

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-bold text-slate-900">Theo nhóm SKU · {periodLabel(periods.cur)}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600">Nhóm</th>
                <th className={th}>Số SKU</th>
                <th className={th}>Revenue</th>
                <th className={th}>Mục tiêu Rev</th>
                <th className={th}>% đạt</th>
                <th className={th}>Profit</th>
                <th className={th}>Mục tiêu Profit</th>
                <th className={th}>% đạt</th>
                <th className={th}>TACoS</th>
              </tr>
            </thead>
            <tbody>
              {(["dev", "test"] as const).map((g) => {
                const x = sum.by[g];
                const t = x.hasTCur ? x.tCur : null;
                const ar = achievement(x.cur.revenue, t?.revenue);
                const ap = achievement(x.cur.profit, t?.profit);
                return (
                  <tr key={g} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 font-semibold text-slate-800">{GROUP_LABEL[g]}</td>
                    <td className={td}>{data.skus.filter((s) => s.group === g).length}</td>
                    <td className={`${td} font-semibold`}>{fmtUsd(x.cur.revenue)}</td>
                    <td className={`${td} text-slate-600`}>{fmtUsd(t?.revenue)}</td>
                    <td className={`${td} font-bold ${achieveTone(ar)}`}>{fmtPct(ar)}</td>
                    <td className={`${td} font-semibold ${x.cur.profit < 0 ? "text-rose-700" : ""}`}>{fmtUsd(x.cur.profit)}</td>
                    <td className={`${td} text-slate-600`}>{fmtUsd(t?.profit)}</td>
                    <td className={`${td} font-bold ${achieveTone(ap)}`}>{fmtPct(ap)}</td>
                    <td className={td}>{fmtPct(tacosOf(x.cur))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

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
  onOpen,
}: {
  data: KpiData;
  skus: KpiSku[];
  canEdit: boolean;
  onSaveTarget: (sku: string, slot: TargetSlot, patch: Partial<TargetRow>) => void;
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
        tc: targetOf(s, "cur"),
        tn: targetOf(s, "next"),
      })),
    [skus],
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
    <NumInput ariaLabel={`Unit ${slot === "cur" ? "mục tiêu" : "tháng sau"} ${c.s.sku}`} value={c.s.target[slot]?.units ?? null} disabled={!canEdit} onCommit={(v) => save(c.s.sku, slot, { units: v })} />
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
        { id: "asin", label: "ASIN", kind: "text", render: (c) => <span className="text-slate-600">{c.s.asin || ""}</span> },
        { id: "avail", label: "Available now", kind: "int", value: (c) => c.s.ton_kho },
        { id: "price", label: "Price", value: (c) => c.s.price, total: () => "" },
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
        { id: "tn-qty", label: "Quantity ✎", value: tv(tn, (m) => m.quantity), render: unitInput("next") },
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

  // 3 cột đầu cố định (Product Type, Mockup, SKU)
  const FIX = [
    { label: "Product Type", w: 120 },
    { label: "Mockup", w: 56 },
    { label: "SKU", w: 150 },
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
                  className={`sticky z-30 ${GROUP_PALETTE.info.sub} px-2 py-1.5 text-left text-[11px] font-bold text-black ${grid}`}
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
  const tc = targetOf(sku, "cur");
  const tn = targetOf(sku, "next");
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
                      <NumInput ariaLabel="Unit" width="w-20" value={t?.units ?? null} disabled={!canEdit} onCommit={(v) => onSaveTarget(sku.sku, slot, { units: v })} />
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
            return { ...s, target: { ...s.target, [slot]: { ...base, ...patch } } };
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
    if (mode === "overview") body = <OverviewPage key={`${selectedStoreId}:${data.period}`} data={data} canEdit={canEdit} onSaveNote={saveNote} />;
    else body = <SkuTable data={data} skus={visibleSkus} canEdit={canEdit} onSaveTarget={saveTarget} onOpen={setOpenSku} />;
  }

  const sourceNote = data && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-500">
      <span>Nguồn số:</span>
      {(
        [
          ["prev", data.periods.prev],
          ["cur", data.periods.cur],
          ["ly", data.periods.ly],
          ["lyNext", data.periods.lyNext],
        ] as const
      ).map(([k, p]) => (
        <span key={k}>
          {periodLabel(p)} <b className={data.sources[k] === "none" ? "text-rose-600" : data.sources[k] === "live" ? "text-amber-700" : "text-slate-700"}>{SOURCE_LABEL[data.sources[k]]}</b>
        </span>
      ))}
      {(data.sources.ly === "none" || data.sources.lyNext === "none") && canEdit && (
        <button type="button" onClick={() => setShowImport(true)} className="cursor-pointer font-semibold text-blue-700 hover:underline">
          Nạp số năm trước từ file tổng kết →
        </button>
      )}
    </div>
  );

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
            <span className="ml-auto text-[11px] text-slate-500">Ô vàng ✎ là leader nhập · Nhấn mã SKU để xem chi tiết</span>
          </div>
        )}
      </div>

      {sourceNote}

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
