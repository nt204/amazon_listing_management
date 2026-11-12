"use client";

import { useMemo } from "react";
import { XIcon } from "@phosphor-icons/react";
import {
  growthOf,
  monthLabel,
  weekSummaries,
  type DailyLike,
  type MonthAgg,
  type MonthFee,
} from "./daily-month-groups";

// Khung bên phải tab FBA / FBM theo ngày — như các khối bên phải sheet kế toán:
//   Profit theo tháng + Tăng trưởng, Tổng theo tuần (TB Revenue/sl, TB Profit/sl), Chi phí khác Amazon (FBA).

const money = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

function Growth({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-300">—</span>;
  return (
    <span className={`font-semibold ${value >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
      {value >= 0 ? "▲" : "▼"} {(value * 100).toFixed(1)}%
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h4 className="border-b border-slate-200 bg-[#ff9900] px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-950 rounded-t-lg">
        {title}
      </h4>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const TH = "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-1 text-right text-[10.5px] font-bold text-slate-600";
const THL = TH.replace("text-right", "text-left");
const TD = "whitespace-nowrap border-b border-slate-100 px-2 py-1 text-right font-mono tabular-nums";
const TDL = "whitespace-nowrap border-b border-slate-100 px-2 py-1 text-left font-semibold text-slate-800";

export function DailySummaryPanel({
  items,
  aggs,
  fees,
  onClose,
}: {
  items: DailyLike[];
  aggs: MonthAgg[];
  /** null = FBM (không có Service Fees) */
  fees: MonthFee[] | null;
  onClose: () => void;
}) {
  const weeks = useMemo(() => weekSummaries(items), [items]);

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-slate-300 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-black uppercase tracking-wide text-slate-800">Tổng hợp</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng khung tổng hợp"
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
        >
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-2.5 text-[11.5px] text-slate-700">
        <Block title="Profit theo tháng">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={THL}>Tháng</th>
                <th className={TH}>Revenue</th>
                <th className={TH}>SL</th>
                <th className={TH} title="Profit của dòng tổng tháng (đã trừ Service Fees với FBA)">
                  Tổng profit
                </th>
                <th className={TH}>Tăng trưởng</th>
              </tr>
            </thead>
            <tbody>
              {aggs.map((a, i) => (
                <tr key={a.month}>
                  <td className={TDL}>{monthLabel(a.month).replace("THÁNG ", "T")}</td>
                  <td className={TD}>{money(a.revenue)}</td>
                  <td className={TD}>{int(a.quantity)}</td>
                  <td className={`${TD} font-bold ${a.profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(a.profit)}</td>
                  <td className={TD}>
                    <Growth value={i > 0 ? growthOf(a.profit, aggs[i - 1].profit) : null} />
                  </td>
                </tr>
              ))}
              {!aggs.length && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-slate-400">
                    Chưa có dữ liệu
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Block>

        <Block title="Tổng theo tuần">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={THL}>Tuần</th>
                <th className={TH}>Revenue</th>
                <th className={TH}>SL</th>
                <th className={TH}>Profit</th>
                <th className={TH}>TB Rev/sl</th>
                <th className={TH}>TB Profit/sl</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.key}>
                  <td className={TDL} title={`${w.startDate} → ${w.endDate}`}>
                    {w.week}
                    <span className="ml-1 text-[10px] font-normal text-slate-400">
                      {dm(w.startDate)}–{dm(w.endDate)}
                    </span>
                  </td>
                  <td className={TD}>{money(w.revenue)}</td>
                  <td className={TD}>{int(w.quantity)}</td>
                  <td className={`${TD} font-semibold ${w.profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(w.profit)}</td>
                  <td className={TD}>{money(w.quantity ? w.revenue / w.quantity : null)}</td>
                  <td className={TD}>{money(w.quantity ? w.profit / w.quantity : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        {fees && (
          <Block title="Chi phí khác Amazon (Service Fees)">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={THL}>Khoản</th>
                  {aggs.map((a) => (
                    <th key={a.month} className={TH}>
                      T{Number(a.month.slice(5, 7))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Service Fees", "total"],
                    ["FBA Inventory Storage Fee", "storage"],
                    ["FBA Long-Term Storage Fee", "longTermStorage"],
                    ["FBA Inbound Placement Service Fee", "inboundPlacement"],
                    ["Cost of Advertising", "advertising"],
                    ["Other fees", "other"],
                    ["FEE (trừ vào Profit)", "fee"],
                  ] as const
                ).map(([label, k]) => (
                  <tr key={k} className={k === "fee" ? "bg-amber-50 font-bold" : ""}>
                    <td className={TDL}>{label}</td>
                    {aggs.map((a) => {
                      const f = fees.find((x) => x.month === a.month);
                      return (
                        <td key={a.month} className={TD}>
                          {f ? money(f[k]) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        )}
      </div>
    </aside>
  );
}
