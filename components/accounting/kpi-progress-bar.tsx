"use client";

import { useEffect, useState } from "react";
import {
  addProgressTotals,
  kpiRatio,
  kpiTone,
  kpiWindowOf,
  type KpiProgressMetric,
  type KpiProgressTotals,
  type KpiWindow,
} from "@/lib/accounting/kpi-progress";

// Thanh tiến độ KPI dưới các chỉ số Revenue / Units / Profit của Team Performance và Stores Performance (trang Overview).
// Chỉ hiện khi kỳ đang chọn là 1 tuần hoặc 1 tháng; mục tiêu = KPI kinh doanh (FBA, SKU WIN + SKU TEST).

export interface StoreKpiTargetRow {
  storeId: string;
  dev: KpiProgressTotals | null;
  test: KpiProgressTotals | null;
}

export interface KpiTargetsState {
  window: KpiWindow | null;
  byStore: Map<string, StoreKpiTargetRow>;
}

const EMPTY: KpiTargetsState = { window: null, byStore: new Map() };

/** Tải mục tiêu KPI của các store trong khung tuần / tháng của kỳ đang chọn */
export function useKpiTargets(startDate: string, endDate: string, unit: string, storeIds: string[]): KpiTargetsState {
  const window = kpiWindowOf(startDate, endDate, unit);
  const key = window ? `${window.kind}|${window.startDate}|${window.endDate}|${[...storeIds].sort().join(",")}` : "";
  const [state, setState] = useState<{ key: string; value: KpiTargetsState }>({ key: "", value: EMPTY });

  useEffect(() => {
    if (!key || !window || !storeIds.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, unit, store_ids: storeIds.join(",") });
    fetch(`/api/accounting/dashboard/kpi-targets?${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { window: KpiWindow | null; stores: StoreKpiTargetRow[] } | null) => {
        if (!json) return;
        setState({ key, value: { window: json.window, byStore: new Map(json.stores.map((s) => [s.storeId, s])) } });
      })
      .catch(() => {
        // Lỗi / huỷ: không hiện thanh tiến độ
      });
    return () => controller.abort();
    // key đã gồm khung + danh sách store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return key && state.key === key ? state.value : EMPTY;
}

/** Mục tiêu theo nhóm SKU: all = WIN + TEST, win = SKU phát triển, test = SKU test */
export function storeTarget(row: StoreKpiTargetRow | undefined, group: "all" | "win" | "test" = "all"): KpiProgressTotals | null {
  if (!row) return null;
  if (group === "win") return row.dev;
  if (group === "test") return row.test;
  return addProgressTotals(row.dev, row.test);
}

// ───────────────────────── Khung "Tiến độ KPI" (trang Overview) ─────────────────────────
// Mỗi team FBA 1 dòng, các store của team thụt bên dưới; 3 cột Revenue · Profit · Units.
// Mỗi ô: thanh dài = mục tiêu cả kỳ, vạch "nhịp" = chỗ lẽ ra phải tới tính đến ngày đang xem.
// Màu theo nhịp như sheet BÁO CÁO TUẦN: thực tế ÷ (mục tiêu × ngày đã qua ÷ số ngày của kỳ)
//   ≥ 100% xanh "Đạt nhịp", ≥ 85% vàng "Sát nhịp", còn lại đỏ "Dưới nhịp".

export interface KpiProgressRow {
  key: string;
  label: string;
  level: "team" | "store" | "total";
  color?: string;
  actual: KpiProgressTotals;
  target: KpiProgressTotals | null;
}

const METRICS: { key: KpiProgressMetric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
  { key: "quantity", label: "Units" },
];

const TONE = {
  good: { bar: "bg-emerald-500", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Đạt nhịp" },
  near: { bar: "bg-amber-400", text: "text-amber-700", chip: "bg-amber-50 text-amber-700 ring-amber-200", label: "Sát nhịp" },
  bad: { bar: "bg-rose-500", text: "text-rose-700", chip: "bg-rose-50 text-rose-700 ring-rose-200", label: "Dưới nhịp" },
} as const;

const compact = (metric: KpiProgressMetric, v: number) => {
  const abs = Math.abs(v);
  const num =
    abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 10_000 ? `${(abs / 1000).toFixed(0)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${v < 0 ? "-" : ""}${metric === "quantity" ? "" : "$"}${num}`;
};
const full = (metric: KpiProgressMetric, v: number) =>
  metric === "quantity"
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

function ProgressCell({
  metric,
  actual,
  target,
  paceShare,
  daysLeft,
  strong,
}: {
  metric: KpiProgressMetric;
  actual: number;
  target: number | null;
  /** Phần kỳ đã qua (0..1) */
  paceShare: number;
  daysLeft: number;
  strong: boolean;
}) {
  if (target == null || !Number.isFinite(target) || target === 0) {
    return <td className="border-b border-slate-100 px-3 py-2 text-right text-[12px] text-slate-300">—</td>;
  }
  const ofTarget = kpiRatio(actual, target) ?? 0;
  const pace = kpiRatio(actual, target * paceShare);
  const tone = kpiTone(pace) ?? "bad";
  const gap = target - actual;
  const perDay = gap > 0 && daysLeft > 0 ? gap / daysLeft : null;
  const hint =
    gap <= 0 ? "Đã đạt mục tiêu cả kỳ" : perDay != null ? `Còn ${compact(metric, gap)} · cần ${compact(metric, perDay)}/ngày` : `Thiếu ${compact(metric, gap)}`;
  return (
    <td
      className="border-b border-slate-100 px-3 py-2 align-top"
      title={`${full(metric, actual)} / mục tiêu ${full(metric, target)} (${(ofTarget * 100).toFixed(1)}%) · nhịp hôm nay ${full(metric, target * paceShare)} → ${
        pace != null ? (pace * 100).toFixed(0) : "–"
      }% nhịp. ${hint}`}
    >
      <div className="flex items-baseline justify-between gap-2 tabular-nums">
        <span className={`${strong ? "text-[13.5px] font-bold text-slate-900" : "text-[12.5px] font-semibold text-slate-700"}`}>{compact(metric, actual)}</span>
        {/* Như sheet BÁO CÁO TUẦN: % đạt = thực tế ÷ mục tiêu tính tới hôm nay (nhịp); cùng màu với thanh */}
        <span className={`text-[12px] font-bold ${TONE[tone].text}`}>{pace != null ? `${Math.floor(pace * 100)}%` : "–"}</span>
      </div>
      <div className={`relative mt-1 w-full rounded-full bg-slate-100 ${strong ? "h-2" : "h-1.5"}`}>
        <div className={`h-full rounded-full ${TONE[tone].bar}`} style={{ width: `${Math.max(0, Math.min(100, ofTarget * 100))}%` }} />
        {paceShare < 1 && (
          <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-slate-700/70" style={{ left: `${paceShare * 100}%` }} aria-hidden />
        )}
      </div>
      <div className="mt-0.5 flex justify-between gap-2 text-[10.5px] leading-tight text-slate-400 tabular-nums">
        <span>
          / {compact(metric, target)} · {(ofTarget * 100).toFixed(0)}% cả kỳ
        </span>
        {strong && <span className={tone === "good" ? "text-emerald-600" : "text-slate-500"}>{gap <= 0 ? "Đã đạt" : perDay != null ? `cần ${compact(metric, perDay)}/ngày` : ""}</span>}
      </div>
    </td>
  );
}

export function KpiProgressCard({
  window,
  rangeEnd,
  rows,
}: {
  window: KpiWindow | null;
  /** Ngày cuối đang xem (có số liệu tới ngày này) */
  rangeEnd: string;
  rows: KpiProgressRow[];
}) {
  if (!window || !rows.some((r) => r.target)) return null;
  const totalDays = daysBetween(window.startDate, window.endDate);
  const seenEnd = rangeEnd < window.endDate ? rangeEnd : window.endDate;
  const elapsed = Math.max(1, Math.min(totalDays, daysBetween(window.startDate, seenEnd)));
  const paceShare = elapsed / totalDays;
  const daysLeft = totalDays - elapsed;
  const d = (s: string) => `${Number(s.slice(8))}/${Number(s.slice(5, 7))}`;
  const title = window.kind === "week" ? `KPI tuần ${d(window.startDate)} – ${d(window.endDate)}` : `KPI tháng ${Number(window.startDate.slice(5, 7))}/${window.startDate.slice(0, 4)}`;
  // Trạng thái chung của dòng tổng (Profit) để đặt nhãn ở tiêu đề
  const totalRow = rows.find((r) => r.level === "total") ?? rows[0];
  const headTone =
    totalRow.target && totalRow.target.profit
      ? kpiTone(kpiRatio(totalRow.actual.profit, totalRow.target.profit * paceShare)) ?? "bad"
      : null;
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">Tiến độ {title}</h2>
          {headTone && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${TONE[headTone].chip}`}>Profit tổng: {TONE[headTone].label}</span>}
        </div>
        <span className="text-[12px] text-slate-500">
          Đã qua <b className="text-slate-700">{elapsed}/{totalDays}</b> ngày{daysLeft > 0 ? ` · còn ${daysLeft} ngày` : ""}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 rounded bg-slate-700/70" /> nhịp = chỗ lẽ ra phải tới hôm nay
        </span>
        {(["good", "near", "bad"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${TONE[k].bar}`} />
            {TONE[k].label}
            {k === "good" ? " (≥ 100% nhịp)" : k === "near" ? " (85–100%)" : " (< 85%)"}
          </span>
        ))}
        <span>
          · % = thực tế ÷ mục tiêu tới hôm nay · mục tiêu cả {window.kind === "week" ? "tuần = KPI tháng ÷ số ngày × 7" : "tháng = KPI tháng"}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="rounded-l-lg bg-slate-50 px-3 py-2 pl-4 text-[13px] font-bold text-slate-700">Team / Store</th>
              {METRICS.map((m, i) => (
                <th key={m.key} className={`w-[26%] bg-slate-50 px-3 py-2 text-right text-[13px] font-bold text-slate-700 ${i === METRICS.length - 1 ? "rounded-r-lg" : ""}`}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const strong = r.level !== "store";
              return (
                <tr key={r.key} className={r.level === "total" ? "bg-slate-50/70" : r.level === "team" ? "bg-white" : ""}>
                  <td className={`border-b border-slate-100 py-2 pr-3 align-top ${r.level === "store" ? "pl-8" : "pl-4"}`}>
                    <div className="flex items-center gap-2">
                      {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />}
                      <span className={r.level === "store" ? "text-[12.5px] text-slate-600" : "text-[13.5px] font-bold text-slate-900"}>{r.label}</span>
                    </div>
                  </td>
                  {METRICS.map((m) => (
                    <ProgressCell
                      key={m.key}
                      metric={m.key}
                      actual={r.actual[m.key]}
                      target={r.target ? r.target[m.key] : null}
                      paceShare={paceShare}
                      daysLeft={daysLeft}
                      strong={strong}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
