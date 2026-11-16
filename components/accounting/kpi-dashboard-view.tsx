"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowsInIcon, ArrowsOutIcon } from "@phosphor-icons/react";
import { achievement, addMetrics, buildMonthReport, computeTarget, emptyMetrics, growth, periodLabel, type KpiMetrics } from "@/lib/accounting/kpi-calc";
import { kpiTone } from "@/lib/accounting/kpi-progress";
import { parseStoreTeams } from "@/lib/accounting/store-teams";
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

/** Số liệu như Tổng quan tháng của 1 store (hoặc bản gộp All) */
function computeKpi(data: KpiData) {
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
}

export type KpiStorePart = { name: string; team: string; data: KpiData };

// ── All store: vinh danh từng store vượt mục tiêu (không gộp theo team) (như "Điểm sáng tháng này" của Báo cáo Tổng quan) ──
// Số theo SKU đang target (SKU WIN): thực tế / mục tiêu Doanh thu · Lượng bán; team = cộng các store của team.
const STORE_COLORS = ["#5b9ce6", "#f28a5e", "#4fb8b1", "#8a7ae0", "#ffc247", "#3fd39a", "#f39cc0", "#e06a8a", "#6bbf59", "#c08a5b"];

type Pair = { actual: number; target: number | null };
type StoreRow = { name: string; color: string; revenue: Pair; quantity: Pair; testRevenue: Pair; testQuantity: Pair };
type TeamRow = { name: string; stores: StoreRow[]; revenue: Pair; quantity: Pair };
type Highlight = { store: string; color: string; items: { metric: string; ratio: number }[] };

/** "FBA 1" → "Team 1" (như file báo cáo); store chưa có team FBA → "Khác" */
function teamLabel(team: string) {
  const fba = parseStoreTeams(team).find((t) => /^fba\b/i.test(t));
  if (!fba) return "Khác";
  const m = fba.match(/^fba\s*(\d+)$/i);
  return m ? `Team ${m[1]}` : fba;
}

const sumPair = (list: Pair[]): Pair => {
  const withT = list.filter((p) => p.target != null);
  return { actual: list.reduce((a, p) => a + p.actual, 0), target: withT.length ? withT.reduce((a, p) => a + (p.target ?? 0), 0) : null };
};

function buildAllStores(parts: KpiStorePart[]) {
  const stores = parts.map((p, i): StoreRow & { team: string } => {
    const r = computeKpi(p.data).report;
    return {
      name: p.name,
      team: teamLabel(p.team),
      color: STORE_COLORS[i % STORE_COLORS.length],
      revenue: { actual: r.revenue.cur ?? 0, target: r.revenue.tCur ?? null },
      quantity: { actual: r.quantity.cur ?? 0, target: r.quantity.tCur ?? null },
      testRevenue: { actual: r.revenue.curTest ?? 0, target: r.revenue.tCurTest ?? null },
      testQuantity: { actual: r.quantity.curTest ?? 0, target: r.quantity.tCurTest ?? null },
    };
  });
  const teamNames = [...new Set(stores.map((s) => s.team))].sort((a, b) => (a === "Khác" ? 1 : b === "Khác" ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const teams: TeamRow[] = teamNames.map((name) => {
    // Trong team: store doanh thu (SKU WIN) cao xếp trước
    const list = stores.filter((s) => s.team === name).sort((a, b) => b.revenue.actual - a.revenue.actual);
    return { name, stores: list, revenue: sumPair(list.map((s) => s.revenue)), quantity: sumPair(list.map((s) => s.quantity)) };
  });
  const highlights: Highlight[] = [];
  for (const t of teams) {
    for (const st of t.stores) {
      // Gộp theo store: chỉ số nào của store có mục tiêu và đạt ≥ 100% thì liệt kê trong thẻ của store đó
      const items: Highlight["items"] = [];
      const push = (metric: string, p: Pair) => {
        const ratio = achievement(p.actual, p.target);
        if (p.target != null && p.target > 0 && ratio != null && ratio >= 1) items.push({ metric, ratio });
      };
      push("Doanh thu SKU WIN", st.revenue);
      push("Lượng bán SKU WIN", st.quantity);
      push("Doanh thu SKU TEST", st.testRevenue);
      push("Lượng bán SKU TEST", st.testQuantity);
      if (items.length) highlights.push({ store: st.name, color: st.color, items });
    }
  }
  return { teams, highlights, storeCount: stores.length };
}

function TonePct({ p }: { p: Pair }) {
  const r = achievement(p.actual, p.target);
  const tone = kpiTone(r);
  return <b className={`ml-2 rounded-full px-2.5 py-0.5 text-sm font-extrabold text-white ${tone ? TONE_PILL[tone] : "bg-slate-400"}`}>{fmtPct(r)}</b>;
}

function StoreStat({ label, p, fmt, color }: { label: string; p: Pair; fmt: Fmt; color: string }) {
  const r = achievement(p.actual, p.target);
  const tone = kpiTone(r);
  return (
    <div className="mb-3.5 last:mb-1">
      <div className="mb-2 flex items-baseline justify-between text-[15px]">
        <span className="font-bold text-slate-700">{label}</span>
        <span className="font-mono tabular-nums">
          <b className="text-lg font-extrabold text-slate-900">{fmtBy(p.actual, fmt)}</b>
          <span className="ml-1 text-[15px] font-bold text-slate-500">/ {p.target == null ? "—" : fmtBy(p.target, fmt)}</span>
        </span>
      </div>
      <Bullet actual={p.actual} target={p.target} tone={tone} color={color} />
      <div className="mt-1">
        {p.target == null ? <Pill tone={null} big>Chưa có mục tiêu</Pill> : <Pill tone={tone} big>{tone ? `${TONE_TEXT[tone]} · ${fmtPct(r)}` : fmtPct(r)}</Pill>}
      </div>
    </div>
  );
}

function AllStoresSections({ parts }: { parts: KpiStorePart[] }) {
  const { teams, highlights } = useMemo(() => buildAllStores(parts), [parts]);
  return (
    <>
      <section className="mb-7">
        <h3 className="mb-3 text-[22px] font-extrabold text-slate-900">Điểm sáng tháng này</h3>
        {highlights.length ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {highlights.map((h) => (
              <div key={h.store} className="rounded-[10px] border border-l-4 border-emerald-500 bg-white px-4 py-3.5 shadow-2xs">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: h.color }} />
                  <span className="text-lg font-extrabold text-slate-900">{h.store}</span>
                  <span className="text-[15px] font-semibold text-slate-500">vượt mục tiêu</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {h.items.map((it) => (
                    <div key={it.metric} className="flex items-baseline justify-between gap-3">
                      <span className="text-[15px] font-bold text-slate-700">{it.metric}</span>
                      <span className="font-mono text-[26px] font-extrabold tabular-nums text-emerald-600">{fmtPct(it.ratio)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[10px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-500">Chưa có store nào vượt 100% mục tiêu tháng này.</div>
        )}
      </section>

      <section className="mb-7">
        <h3 className="mb-3 flex items-center gap-2 text-[22px] font-extrabold text-slate-900">
          Hiệu quả kinh doanh FBA
        </h3>
        <div className="flex flex-col gap-4">
          {teams.map((t) => (
            <div key={t.name} className="rounded-[14px] border border-slate-200 bg-slate-100/60 p-3.5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-0.5">
                <span className="text-lg font-extrabold text-slate-900">
                  {t.name} · {t.stores.map((s) => s.name).join(" + ")}
                </span>
                <div className="flex flex-wrap gap-5 font-semibold">
                  <div><span className="text-[15px] font-bold text-slate-700">Doanh thu</span><TonePct p={t.revenue} /></div>
                  <div><span className="text-[15px] font-bold text-slate-700">Lượng bán</span><TonePct p={t.quantity} /></div>
                </div>
              </div>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
                {t.stores.map((st) => (
                  <div key={st.name} className="rounded-xl border border-slate-200 bg-white px-4 pb-3 pt-3.5 shadow-2xs">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="h-3 w-3 flex-none rounded-full" style={{ background: st.color }} />
                      <span className="text-lg font-extrabold text-slate-900">{st.name}</span>
                    </div>
                    <StoreStat label="Doanh thu" p={st.revenue} fmt="usd" color={st.color} />
                    <StoreStat label="Lượng bán" p={st.quantity} fmt="int" color={st.color} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Pill({ tone, children, big }: { tone: Tone; children: ReactNode; big?: boolean }) {
  return (
    <span className={`inline-block rounded-full font-bold ${big ? "px-2.5 py-0.5 text-[13px]" : "px-2 py-0.5 text-[11px]"} ${tone ? TONE_PILL[tone] : "border border-slate-200 bg-slate-50 text-slate-500"}`}>
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
function Bullet({ actual, target, tone, color, small, noMarker }: { actual: number; target: number | null; tone: Tone; color?: string; small?: boolean; noMarker?: boolean }) {
  const r = achievement(actual, target);
  const fill = target == null || r == null ? 0 : Math.max(0, Math.min(1, r)) * 100;
  const marker = target == null || r == null ? null : r > 1 && actual > 0 ? (target / actual) * 100 : 100;
  return (
    <div className={`relative rounded-full bg-slate-100 ${small ? "h-[7px]" : "h-2.5"}`}>
      <div className={`h-full rounded-full ${color ? "" : tone ? TONE_BAR[tone] : "bg-slate-300"}`} style={{ width: `${fill}%`, ...(color ? { background: color } : {}) }} />
      {marker != null && !noMarker && <div className="absolute -bottom-1 -top-1 w-0.5 rounded bg-slate-800/60" style={{ left: `calc(${Math.min(100, Math.max(0, marker))}% - 1px)` }} />}
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

function BigCard({ label, actual, target, fmt, mom, momLabel, hideBar }: { label: string; actual: number | null; target: number | null; fmt: Fmt; mom: number | null; momLabel: string; hideBar?: boolean }) {
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
      {!hideBar && <Bullet actual={a} target={target} tone={tone} noMarker />}
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

export function KpiDashboardView({ data, storeId, storeParts }: { data: KpiData; storeId: string; storeParts?: KpiStorePart[] | null }) {
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
  const k = useMemo(() => computeKpi(data), [data]);

  const r = k.report;
  // Tất cả store: thẻ tổng chỉ hiện số, không vẽ thanh tiến độ
  const isAll = !!storeParts?.length;
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
          <BigCard label="Doanh thu" actual={r.revenue.curTotal ?? null} target={k.tTotal?.revenue ?? null} fmt="usd" mom={growth(r.revenue.curTotal, k.prevTotal.revenue)} momLabel={prevLabel} hideBar={isAll} />
          <BigCard label="Lượng bán" actual={r.quantity.curTotal ?? null} target={k.tTotal?.quantity ?? null} fmt="int" mom={growth(r.quantity.curTotal, k.prevTotal.quantity)} momLabel={prevLabel} hideBar={isAll} />
        </div>

        {storeParts && storeParts.length > 0 && <AllStoresSections parts={storeParts} />}

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
