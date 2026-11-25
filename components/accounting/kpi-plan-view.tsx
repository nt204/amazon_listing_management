"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeftIcon, CaretRightIcon, CloudArrowDownIcon } from "@phosphor-icons/react";
import {
  emptyPlan,
  halfLabel,
  halfMonths,
  PLAN_ROWS,
  planRowValue,
  sumPlans,
  type PlanHalf,
  type PlanKey,
  type PlanMonth,
  type StorePlanData,
} from "@/lib/accounting/kpi-plan-calc";

// Tab "Plan (Kỳ … )" của KPI kinh doanh — như file "THEO DÕI KẾ HOẠCH CÁC STORE":
// mỗi tháng của kỳ 2 cột: kế hoạch (T7, T8…) và Result (số chốt sổ tháng, tự điền khi tháng đã tổng kết).

type PlanResponse = StorePlanData & { sheetUrl: string | null };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function fmt(v: number | null, kind: "usd" | "int" | "pct") {
  if (v == null || !Number.isFinite(v)) return "";
  if (kind === "pct") return `${(v * 100).toFixed(2)}%`;
  if (kind === "int") return int.format(v);
  return usd.format(Math.abs(v) < 0.005 ? 0 : v);
}

/** Dòng mà Result cao hơn kế hoạch là tốt (tô xanh / đỏ khi so với kế hoạch) */
const HIGHER_IS_BETTER = new Set(["revenue", "quantity", "profit", "roi", "margin"]);

const hd = "border-r border-b border-black px-2.5 py-2.5 text-[13.5px] font-extrabold text-black whitespace-nowrap";
const cell = "border-r border-b border-black px-2 py-1.5 whitespace-nowrap";

export function KpiPlanView({
  storeIds,
  initialPeriod,
  canEdit,
  aggregate,
}: {
  /** 1 store, hoặc mọi store khi xem All (cộng số) */
  storeIds: string[];
  initialPeriod: string;
  canEdit: boolean;
  aggregate: boolean;
}) {
  const [y0, m0] = initialPeriod.split("-").map(Number);
  const [term, setTerm] = useState<{ year: number; half: PlanHalf }>({ year: y0, half: m0 <= 6 ? 1 : 2 });
  // Đổi tháng báo cáo ở thanh trên → nhảy về kỳ của tháng đó
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTerm({ year: y0, half: m0 <= 6 ? 1 : 2 });
  }, [y0, m0]);

  const [parts, setParts] = useState<PlanResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ period: string; key: PlanKey; text: string } | null>(null);
  const [showImport, setShowImport] = useState(false);

  const storeKey = storeIds.join(",");
  const load = useCallback(async () => {
    if (!storeKey) return;
    setLoading(true);
    setError(null);
    try {
      const ids = storeKey.split(",");
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const params = new URLSearchParams({ store_id: id, year: String(term.year), half: String(term.half) });
          const res = await fetch(`/api/accounting/financials/kpi/plan?${params.toString()}`);
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json?.error || "Không tải được Plan");
          return json as PlanResponse;
        }),
      );
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!ok.length) {
        const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        throw first?.reason instanceof Error ? first.reason : new Error("Không tải được Plan");
      }
      setParts(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Plan");
    } finally {
      setLoading(false);
    }
  }, [storeKey, term.year, term.half]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const months: PlanMonth[] = useMemo(() => {
    const periods = halfMonths(term.year, term.half);
    if (!parts) return periods.map((period) => ({ period, plan: null, result: null, resultSource: null }));
    return periods.map((period) => {
      const ms = parts.map((p) => p.months.find((m) => m.period === period));
      const sources = ms.map((m) => m?.resultSource).filter(Boolean);
      const order = ["running", "live", "sheet", "closed"] as const;
      return {
        period,
        plan: sumPlans(ms.map((m) => m?.plan)),
        result: sumPlans(ms.map((m) => m?.result)),
        // Gộp nhiều store: hiện nguồn "kém chắc chắn" nhất để biết số còn tạm
        resultSource: order.find((o) => sources.includes(o)) ?? null,
      };
    });
  }, [parts, term.year, term.half]);

  const totalPlan = useMemo(() => sumPlans(months.map((m) => m.plan)), [months]);
  const totalResult = useMemo(() => sumPlans(months.map((m) => m.result)), [months]);
  const editable = canEdit && !aggregate;

  const save = async (period: string, key: PlanKey, text: string) => {
    setEditing(null);
    const trimmed = text.replace(/[$,\s]/g, "");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value != null && !Number.isFinite(value)) {
      setError("Giá trị không hợp lệ.");
      return;
    }
    const storeId = storeIds[0];
    // Cập nhật ngay trên bảng, lỗi thì tải lại
    setParts((prev) =>
      prev?.map((p) =>
        p.storeId !== storeId
          ? p
          : {
              ...p,
              months: p.months.map((m) => {
                if (m.period !== period) return m;
                return { ...m, plan: { ...(m.plan ?? emptyPlan()), [key]: value ?? 0 } };
              }),
            },
      ) ?? prev,
    );
    try {
      const res = await fetch("/api/accounting/financials/kpi/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, period, key, value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Không lưu được");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được");
      void load();
    }
  };

  const shiftKy = (d: 1 | -1) =>
    setTerm((k) => (d === 1 ? (k.half === 1 ? { year: k.year, half: 2 } : { year: k.year + 1, half: 1 }) : k.half === 2 ? { year: k.year, half: 1 } : { year: k.year - 1, half: 2 }));

  const resultTone = (key: string, result: number | null, plan: number | null) => {
    if (!HIGHER_IS_BETTER.has(key) || result == null || plan == null || !plan) return "";
    return result >= plan ? "text-emerald-700" : "text-rose-600";
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 items-center rounded-lg border border-slate-300 bg-white">
              <button type="button" aria-label="Kỳ trước" onClick={() => shiftKy(-1)} className="flex h-full cursor-pointer items-center px-1.5 text-slate-500 hover:text-slate-900">
                <CaretLeftIcon size={12} weight="bold" />
              </button>
              <span className="px-1 text-xs font-bold text-slate-800">{halfLabel(term.year, term.half)}</span>
              <button type="button" aria-label="Kỳ sau" onClick={() => shiftKy(1)} className="flex h-full cursor-pointer items-center px-1.5 text-slate-500 hover:text-slate-900">
                <CaretRightIcon size={12} weight="bold" />
              </button>
            </div>
            <h3 className="text-sm font-bold text-slate-900">
              Kế hoạch {halfLabel(term.year, term.half)} {aggregate ? "· Tất cả store" : ""}
            </h3>
            {loading && <span className="text-[11px] text-slate-400">Đang tải…</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowImport(true)}
                className="flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CloudArrowDownIcon size={14} />
                Nạp từ Google Sheet
              </button>
            )}
          </div>
        </div>
        {error && <div className="border-b border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">{error}</div>}
        <div className="overflow-x-auto">
          <table className="acc-kpi-report-table w-full border-separate border-spacing-0 border-l border-t border-black text-xs">
            <thead>
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-[#ff9900]`} />
                <th colSpan={15} className={`${hd} bg-[#fb923c] text-center font-black uppercase tracking-wide`}>
                  {term.half === 2 ? "Mục tiêu " : ""}
                  {halfLabel(term.year, term.half).replace(" - ", "/")}
                </th>
              </tr>
              <tr>
                <th className={`${hd} sticky left-0 z-10 bg-[#ff9900] text-left text-[13.5px] font-black`}>Chỉ số</th>
                {months.map((m) => (
                  <MonthHead key={m.period} month={m} />
                ))}
                <th className={`${hd} bg-[#fde047] text-right`}>TOTAL</th>
                <th className={`${hd} bg-blue-100 text-right`}>Result</th>
                <th className={`${hd} bg-emerald-100 text-right`} title="Result TOTAL ÷ kế hoạch TOTAL">% đạt</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ROWS.map((r) => {
                const profitRow = r.key === "profit";
                const isRatio = r.kind === "pct";
                const rowCls = profitRow ? "bg-[#ff9900] font-bold text-black" : "";
                return (
                  <tr key={r.key} className={profitRow ? "font-bold" : ""}>
                    <td className={`${cell} sticky left-0 z-10 bg-[#ff9900] text-left font-bold`}>{r.label}</td>
                    {months.map((m) => {
                      const planV = planRowValue(m.plan, r.key);
                      const resV = planRowValue(m.result, r.key);
                      const canEditCell = editable && !isRatio;
                      const isEditing = editing && editing.period === m.period && editing.key === r.key;
                      return [
                        <td
                          key={`${m.period}-p`}
                          onClick={canEditCell && !isEditing ? () => setEditing({ period: m.period, key: r.key as PlanKey, text: planV == null ? "" : String(Math.round(planV * 100) / 100) }) : undefined}
                          title={canEditCell ? "Bấm để sửa kế hoạch" : undefined}
                          className={`${cell} text-right tabular-nums ${rowCls || "bg-amber-50/40"} ${canEditCell ? "cursor-text hover:bg-amber-100" : ""}`}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editing.text}
                              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              onBlur={() => void save(m.period, r.key as PlanKey, editing.text)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="w-24 rounded border border-blue-400 bg-white px-1 text-right text-xs text-black outline-hidden"
                            />
                          ) : (
                            fmt(planV, r.kind)
                          )}
                        </td>,
                        <td key={`${m.period}-r`} className={`${cell} acc-month-end text-right tabular-nums ${rowCls || "bg-blue-50/50"} ${resultTone(r.key, resV, planV)}`}>
                          {fmt(resV, r.kind)}
                        </td>,
                      ];
                    })}
                    <td className={`${cell} text-right tabular-nums ${rowCls || "bg-[#fef9c3]"}`}>{fmt(planRowValue(totalPlan, r.key), r.kind)}</td>
                    <td
                      className={`${cell} text-right tabular-nums ${rowCls || "bg-blue-100/70"} ${resultTone(r.key, planRowValue(totalResult, r.key), planRowValue(totalPlan, r.key))}`}
                    >
                      {fmt(planRowValue(totalResult, r.key), r.kind)}
                    </td>
                    {(() => {
                      // % đạt = Result ÷ kế hoạch (dòng tỷ lệ TACOS / ROI / Margin bỏ trống)
                      const tp = planRowValue(totalPlan, r.key);
                      const tr = planRowValue(totalResult, r.key);
                      const rate = isRatio || tp == null || tr == null || !tp ? null : tr / tp;
                      const tone = rate == null || !HIGHER_IS_BETTER.has(r.key) ? "" : rate >= 1 ? "text-emerald-700" : "text-rose-600";
                      return (
                        <td className={`${cell} text-right tabular-nums ${rowCls || "bg-emerald-50/60"} ${tone}`}>
                          {rate == null ? "" : `${(rate * 100).toFixed(1)}%`}
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {showImport && (
        <PlanImportModal
          defaultUrl={parts?.[0]?.sheetUrl ?? ""}
          onClose={() => setShowImport(false)}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}

function MonthHead({ month }: { month: PlanMonth }) {
  const m = Number(month.period.slice(5));
  return (
    <>
      <th className={`${hd} bg-[#fde047] text-right`}>T{m}</th>
      <th
        className={`${hd} acc-month-end bg-blue-100 text-right`}
        title={
          month.resultSource === "closed"
            ? "Số chốt sổ tháng"
            : month.resultSource === "live"
            ? "Tính từ dữ liệu ngày (tháng chưa chốt sổ)"
            : month.resultSource === "running"
            ? "Tháng đang chạy — tạm tính tới hôm nay"
            : month.resultSource === "sheet"
            ? "Result nạp từ sheet (hệ thống không có dữ liệu tháng này)"
            : "Chưa có dữ liệu"
        }
      >
        {month.resultSource === "running" ? "Result (tạm)" : "Result"}
      </th>
    </>
  );
}

interface ImportResult {
  title: string;
  stores: { store: string; tab: string; months: number; periods: string[] }[];
  skippedTabs: string[];
}

function PlanImportModal({ defaultUrl, onClose, onDone }: { defaultUrl: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/accounting/financials/kpi/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
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
        <div className="mb-1 text-sm font-bold text-slate-900">Nạp Plan từ Google Sheet</div>
        <p className="mb-3 text-xs leading-relaxed text-slate-500">
          Dán link file <b>THEO DÕI KẾ HOẠCH CÁC STORE</b>. Mỗi tab trùng tên store (LIMIMA, MALFIRST…) được đọc theo từng khối kỳ (KỲ I/2026, MỤC TIÊU KỲ II/2026…):
          cột T1…T12 là kế hoạch, cột Result chỉ dùng cho tháng hệ thống chưa chốt sổ. Nạp lại sẽ ghi đè số kế hoạch các tháng có trong file.
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
            {result.stores.map((s) => (
              <div key={s.tab}>
                {s.store}: <b>{s.months} tháng</b>
                {s.periods.length ? ` (${s.periods[0]} → ${s.periods[s.periods.length - 1]})` : ""}
              </div>
            ))}
            {result.skippedTabs.length > 0 && <div className="mt-1 text-emerald-800/70">Bỏ qua tab: {result.skippedTabs.join(", ")}</div>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-md px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            Đóng
          </button>
          <button
            type="button"
            disabled={busy || !url.trim()}
            onClick={run}
            className="h-8 cursor-pointer rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Đang nạp…" : "Nạp"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
