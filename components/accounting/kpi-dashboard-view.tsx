"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowsInIcon, ArrowsOutIcon } from "@phosphor-icons/react";
import { achievement, addMetrics, buildMonthReport, computeTarget, emptyMetrics, growth, periodLabel, type KpiMetrics } from "@/lib/accounting/kpi-calc";
import { kpiTone } from "@/lib/accounting/kpi-progress";
import type { KpiData, KpiSku } from "./kpi-view";

// Tab "Dashboard" của KPI kinh doanh — bản trình chiếu của "Tổng quan tháng" cho store đang chọn:
// chỉ giữ chỉ số chính (Doanh thu · Lượng bán) dạng thanh thực tế / mục tiêu.
//   Tổng quan  = SKU WIN + SKU TEST (như 4 card của Tổng quan tháng), so tháng trước
//   SKU WIN    = cột [Target] / [Result] SKU WIN của bảng BÁO CÁO THÁNG
//   SKU TEST   = cột [Target] / [Result] SKU TEST
//   R&D        = số mẫu test đi hàng / KPI store, SKU WIN / SKU đánh giá (mục tiêu 40%) — như bảng "Theo phôi"

type Tone = "good" | "near" | "bad" | null;

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtUsd = (v: number) => usd0.format(Math.abs(v) < 0.5 ? 0 : v);
const fmtInt = (v: number) => int.format(v);
const fmtPct = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);

/** KQKD: mục tiêu SKU WIN = 40% × số SKU đánh giá */
const WIN_TARGET_RATE = 0.4;
const WIN_STATUS = "phát triển";

const TONE_BAR: Record<Exclude<Tone, null>, string> = { good: "bg-emerald-500", near: "bg-orange-400", bad: "bg-rose-500" };
const TONE_PILL: Record<Exclude<Tone, null>, string> = { good: "bg-emerald-600 text-white", near: "bg-orange-400 text-white", bad: "bg-rose-600 text-white" };
const TONE_TEXT: Record<Exclude<Tone, null>, string> = { good: "Đạt", near: "Gần đạt", bad: "Chưa đạt" };

type Fmt = "usd" | "int" | "pct";
const fmtBy = (v: number, f: Fmt) => (f === "usd" ? fmtUsd(v) : f === "int" ? fmtInt(v) : fmtPct(v));

function targetOf(s: KpiSku, data: KpiData) {
  const unit = { price: s.price, basecost_unit: s.basecost_unit, amazon_fee_unit: s.amazon_fee_unit, referral_pct: s.referral_pct };
  return computeTarget(s.target.cur, unit, data.targetFormula, s.actual.prev ? Math.abs(s.actual.prev.return_amount) : null);
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${tone ? TONE_PILL[tone] : "border border-slate-200 bg-slate-50 text-slate-500"}`}>
      {children}
    </span>
  );
}

function Mom({ value, label }: { value: number | null; label: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className="text-[11px] text-slate-400">
      <span className={`font-mono font-semibold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
        {up ? "▲+" : "▼"}
        {(value * 100).toFixed(1)}%
      </span>{" "}
      so {label}
    </span>
  );
}

/** Thanh thực tế / mục tiêu: chưa đạt thì thanh = % đạt, vạch ở 100%; vượt thì thanh đầy, vạch lùi về mục tiêu */
function Bullet({ actual, target, tone }: { actual: number; target: number | null; tone: Tone }) {
  const r = achievement(actual, target);
  const fill = target == null || r == null ? 0 : Math.max(0, Math.min(1, r)) * 100;
  const marker = target == null || r == null ? null : r > 1 && actual > 0 ? (target / actual) * 100 : 100;
  return (
    <div className="relative h-2.5 rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${tone ? TONE_BAR[tone] : "bg-slate-300"}`} style={{ width: `${fill}%` }} />
      {marker != null && <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-slate-800/60" style={{ left: `calc(${Math.min(100, Math.max(0, marker))}% - 1px)` }} />}
    </div>
  );
}

function StatRow({ label, actual, target, fmt }: { label: string; actual: number | null; target: number | null; fmt: Fmt }) {
  const a = actual ?? 0;
  const r = achievement(a, target);
  const tone = kpiTone(r);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-slate-500">{label}</span>
        <span className="font-mono tabular-nums">
          <b className="text-[15px] text-slate-900">{fmtBy(a, fmt)}</b>
          <span className="text-xs text-slate-400"> / {target == null ? "—" : fmtBy(target, fmt)}</span>
        </span>
      </div>
      <Bullet actual={a} target={target} tone={tone} />
      <div className="mt-1.5">{target == null ? <Pill tone={null}>Chưa có mục tiêu</Pill> : <Pill tone={tone}>{tone ? `${TONE_TEXT[tone]} · ${fmtPct(r)}` : fmtPct(r)}</Pill>}</div>
    </div>
  );
}

function BigCard({ label, actual, target, fmt, mom, momLabel }: { label: string; actual: number | null; target: number | null; fmt: Fmt; mom: number | null; momLabel: string }) {
  const a = actual ?? 0;
  const r = achievement(a, target);
  const tone = kpiTone(r);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-2xs">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[28px] font-semibold tabular-nums text-slate-900">{fmtBy(a, fmt)}</span>
        <span className="font-mono text-sm text-slate-400">/ {target == null ? "—" : fmtBy(target, fmt)}</span>
      </div>
      <div className="mb-2 mt-1 flex flex-wrap items-center justify-between gap-2">
        {target == null ? <Pill tone={null}>Chưa có mục tiêu</Pill> : <Pill tone={tone}>{tone ? `${TONE_TEXT[tone]} · ${fmtPct(r)}` : fmtPct(r)}</Pill>}
        <Mom value={mom} label={momLabel} />
      </div>
      <Bullet actual={a} target={target} tone={tone} />
    </div>
  );
}

function Panel({ title, sub, accent, children }: { title: string; sub?: string; accent: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="mb-4 flex items-center gap-2">
        <span className={`h-5 w-1.5 rounded-full ${accent}`} />
        <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
        {sub && <span className="ml-auto text-[11px] text-slate-400">{sub}</span>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function KpiDashboardView({ data, storeId }: { data: KpiData; storeId: string }) {
  const { periods } = data;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const sync = () => setIsFull(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  };

  // ── Số liệu như Tổng quan tháng ──
  const k = useMemo(() => {
    const blank = () => ({ prev: emptyMetrics(), cur: emptyMetrics(), tCur: emptyMetrics(), hasT: false });
    const by = { dev: blank(), test: blank() };
    for (const s of data.skus) {
      const g = by[s.group];
      g.prev = addMetrics(g.prev, s.actual.prev);
      g.cur = addMetrics(g.cur, s.actual.cur);
      by.test.cur = addMetrics(by.test.cur, s.actual.curAsTest);
      const t = targetOf(s, data);
      if (t) g.hasT = true;
      g.tCur = addMetrics(g.tCur, t);
    }
    for (const g of ["dev", "test"] as const) {
      const team = data.teamTargets?.cur[g];
      if (!by[g].hasT && team) Object.assign(by[g], { tCur: { ...emptyMetrics(), ...team }, hasT: true });
    }
    const dev = by.dev;
    const test = by.test;
    const report = buildMonthReport({
      dev: { prev: dev.prev, cur: dev.cur, ly: null, lyNext: null, tCur: dev.hasT ? dev.tCur : null, tNext: null },
      test: { prev: test.prev, cur: test.cur, ly: null, lyNext: null, tNext: null, tCur: test.hasT ? test.tCur : null },
      storeFeeCur: data.storeFees?.cur ?? null,
      formula: data.targetFormula,
    });
    const tTotal: KpiMetrics | null = dev.hasT || test.hasT ? addMetrics(dev.hasT ? dev.tCur : emptyMetrics(), test.hasT ? test.tCur : emptyMetrics()) : null;
    const prevTotal = addMetrics(dev.prev, test.prev);
    return { report, tTotal, prevTotal, hasDevT: dev.hasT, hasTestT: test.hasT };
  }, [data]);

  const r = k.report;
  const prevLabel = periodLabel(periods.prev);

  // ── R&D: như bảng "Theo phôi" của Tổng quan tháng ──
  const year = Number(periods.cur.slice(0, 4));
  const [kqkd, setKqkd] = useState<{ skus?: Record<string, unknown>[]; evalSkus?: Record<string, unknown>[]; winResults?: Record<string, unknown>[] } | null>(null);
  const [testTarget, setTestTarget] = useState<number | null>(null);
  useEffect(() => {
    if (!storeId) return;
    let active = true;
    fetch(`/api/accounting/financials/kqkd?store_id=${storeId}&year=${year}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => active && json && setKqkd(json))
      .catch(() => {});
    fetch(`/api/accounting/financials/kqkd/test-targets?store_id=${storeId}&month=${periods.cur}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => active && json && setTestTarget(json.target ?? null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [storeId, year, periods.cur]);

  const curPeriod = periods.cur;
  const rnd = useMemo(() => {
    if (!kqkd) return null;
    const listed = (kqkd.skus || []).filter((s) => s.listing_month === curPeriod).length;
    const manual = new Map<string, number>();
    for (const w of kqkd.winResults || []) if (w.eval_month === curPeriod) manual.set(String(w.product_type), Number(w.win_count) || 0);
    const byType = new Map<string, { n: number; suggest: number }>();
    for (const s of [...(kqkd.skus || []), ...(kqkd.evalSkus || [])]) {
      if (s.eval_month !== curPeriod) continue;
      const name = String(s.product_type || "(trống)");
      const cur = byType.get(name) || { n: 0, suggest: 0 };
      cur.n += 1;
      if (String(s.status || "").trim().toLowerCase() === WIN_STATUS) cur.suggest += 1;
      byType.set(name, cur);
    }
    let win = 0;
    let evaluated = 0;
    for (const [name, x] of byType) {
      evaluated += x.n;
      win += manual.get(name) ?? x.suggest;
    }
    return { listed, win, evaluated };
  }, [kqkd, curPeriod]);


  return (
    <div ref={rootRef} className="min-h-full overflow-auto bg-slate-50">
      <div className="mx-auto max-w-[1280px] px-4 pb-10 pt-5 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-600">Tổng quan tháng</h2>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-3 text-[11px] text-slate-500 sm:flex">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />≥ 100%</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" />≥ 85%</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />&lt; 85%</span>
              <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-slate-700" />mục tiêu</span>
            </span>
            <button
              type="button"
              onClick={toggleFull}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {isFull ? <ArrowsInIcon size={14} /> : <ArrowsOutIcon size={14} />}
              {isFull ? "Thoát trình chiếu" : "Trình chiếu"}
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <BigCard label="Doanh thu" actual={r.revenue.curTotal ?? null} target={k.tTotal?.revenue ?? null} fmt="usd" mom={growth(r.revenue.curTotal, k.prevTotal.revenue)} momLabel={prevLabel} />
          <BigCard label="Lượng bán" actual={r.quantity.curTotal ?? null} target={k.tTotal?.quantity ?? null} fmt="int" mom={growth(r.quantity.curTotal, k.prevTotal.quantity)} momLabel={prevLabel} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="KPI SKU WIN" sub="SKU phát triển" accent="bg-blue-600">
            <StatRow label="Doanh thu" actual={r.revenue.cur ?? null} target={r.revenue.tCur ?? null} fmt="usd" />
            <StatRow label="Lượng bán" actual={r.quantity.cur ?? null} target={r.quantity.tCur ?? null} fmt="int" />
          </Panel>
          <Panel title="KPI SKU TEST" sub="SKU đang test" accent="bg-violet-500">
            <StatRow label="Doanh thu" actual={r.revenue.curTest ?? null} target={r.revenue.tCurTest ?? null} fmt="usd" />
            <StatRow label="Lượng bán" actual={r.quantity.curTest ?? null} target={r.quantity.tCurTest ?? null} fmt="int" />
          </Panel>
          <Panel title="KPI R&D" sub="Mẫu test & tỉ lệ WIN" accent="bg-emerald-500">
            {!rnd ? (
              <div className="text-xs text-slate-400">Đang tải số liệu R&D...</div>
            ) : (
              <>
                <StatRow label="Số mẫu test đi hàng" actual={rnd.listed} target={testTarget} fmt="int" />
                <StatRow label={`SKU WIN / ${rnd.evaluated} SKU đánh giá`} actual={rnd.win} target={rnd.evaluated ? rnd.evaluated * WIN_TARGET_RATE : null} fmt="int" />
                <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                  <span className="text-[13px] text-slate-500">Tỉ lệ WIN (mục tiêu 40%)</span>
                  <span className="font-mono text-lg font-bold tabular-nums text-slate-900">{fmtPct(rnd.evaluated ? rnd.win / rnd.evaluated : null)}</span>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
