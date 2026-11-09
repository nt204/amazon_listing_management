"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { X, Tag, StackIcon, ShoppingCartIcon, CubeIcon, PercentIcon, TargetIcon } from "@phosphor-icons/react";
import type { PpcSkuDailyTrendPoint } from "@/lib/ppc/types";

interface PpcSkuTrendModalProps {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
  storeName: string;
  mockupUrl?: string | null;
  dailyTrend: PpcSkuDailyTrendPoint[];
  targetAcos?: number;
}

export function PpcSkuTrendModal({
  isOpen,
  onClose,
  sku,
  storeName,
  mockupUrl,
  dailyTrend,
  targetAcos = 30,
}: PpcSkuTrendModalProps) {
  // Sync timeframe across all SKUs via localStorage
  const [timeframe, setTimeframeState] = useState<"7D" | "14D" | "30D">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ppc_sku_trend_timeframe");
      if (saved === "7D" || saved === "14D" || saved === "30D") return saved;
    }
    return "30D";
  });

  // When sku or store changes, restore the user's saved preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedTf = localStorage.getItem("ppc_sku_trend_timeframe");
      if (savedTf === "7D" || savedTf === "14D" || savedTf === "30D") {
        setTimeframeState(savedTf);
      }
    } catch {}
  }, [sku, storeName]);

  const handleSetTimeframe = (tf: "7D" | "14D" | "30D") => {
    setTimeframeState(tf);
    try {
      localStorage.setItem("ppc_sku_trend_timeframe", tf);
    } catch {}
  };

  const activeDays = timeframe === "7D" ? 7 : timeframe === "14D" ? 14 : 30;

  const { chartData, totals } = useMemo(() => {
    const sliced = (dailyTrend || []).slice(-activeDays);

    const totSpend = sliced.reduce((s, d) => s + (d.spend || 0), 0);
    const totSales = sliced.reduce((s, d) => s + (d.sales || 0), 0);
    const totOrders = sliced.reduce((s, d) => s + (d.orders || 0), 0);

    const data = sliced.map((d) => {
      const spend = d.spend || 0;
      const sales = d.sales || 0;
      const parts = d.date.split("-");
      const shortDate = parts.length >= 3 ? `${parts[2]}/${parts[1]}` : d.date;

      return {
        date: d.date,
        shortDate,
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        orders: d.orders || 0,
        // ACoS chỉ có nghĩa khi có sales; ngày tiêu tiền mà 0 sales đánh dấu chấm đỏ riêng
        acosNum: sales > 0 ? Math.round((spend / sales) * 1000) / 10 : null,
        noSaleSpend: sales <= 0 && spend > 0,
      };
    });

    const blendedAcos = totSales > 0 ? (totSpend / totSales) * 100 : (totSpend > 0 ? 999 : 0);

    return {
      chartData: data,
      totals: {
        spend: totSpend,
        sales: totSales,
        orders: totOrders,
        acos: blendedAcos,
      },
    };
  }, [dailyTrend, activeDays]);

  if (!isOpen) return null;

  // Hai trục chia cùng 4 khoảng để lưới $ (trái) và % (phải) trùng nhau.
  const maxMoney = Math.max(0, ...chartData.map((d) => Math.max(d.spend, d.sales)));
  const moneyCeil = niceCeil(maxMoney, 4);
  const moneyTicks = [0, 1, 2, 3, 4].map((i) => (moneyCeil / 4) * i);
  // Trục ACoS: luôn thấy vạch target; ngày ACoS quá cao bị chặn ở trần (giá trị thật xem ở tooltip)
  const maxAcos = Math.max(0, ...chartData.map((d) => d.acosNum ?? 0));
  const acosCeil = Math.min(
    niceCeil(Math.max(targetAcos * 2, maxAcos), 4),
    niceCeil(Math.max(targetAcos * 4, 200), 4),
  );
  const acosTicks = [0, 1, 2, 3, 4].map((i) => (acosCeil / 4) * i);
  const plotData = chartData.map((d) => ({
    ...d,
    acosPlot: d.acosNum == null ? null : Math.min(d.acosNum, acosCeil),
    noSalePlot: d.noSaleSpend ? acosCeil * 0.92 : null,
  }));
  type PlotPoint = (typeof plotData)[number];

  const barSize = timeframe === "30D" ? 8 : timeframe === "14D" ? 14 : 20;
  const noData = totals.spend <= 0 && totals.sales <= 0;

  const acosTone = (v: number | null) =>
    v == null ? "text-rose-600" : v <= targetAcos ? "text-emerald-600" : v <= 50 ? "text-amber-600" : "text-rose-600";

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    if (!active || !payload || payload.length === 0) return null;
    const d = payload[0].payload as PlotPoint;
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl text-xs">
        <p className="font-mono font-bold text-slate-900 border-b border-slate-100 pb-1 mb-1.5">{d.date}</p>
        <div className="space-y-1 font-mono text-[11px]">
          <TooltipRow swatch="h-2 w-2 rounded-xs bg-indigo-500" label="Spend" value={`$${d.spend.toFixed(2)}`} />
          <TooltipRow swatch="h-2 w-2 rounded-xs bg-green-500" label="Sales" value={`$${d.sales.toFixed(2)}`} />
          <TooltipRow swatch="h-2 w-2 rounded-xs bg-slate-300" label="Orders" value={String(d.orders)} />
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              ACoS
            </span>
            <span className={`font-black ${d.acosNum == null && !d.noSaleSpend ? "text-slate-400" : acosTone(d.acosNum)}`}>
              {d.acosNum != null ? `${d.acosNum.toFixed(1)}%` : d.noSaleSpend ? "Spend, 0 sales" : "—"}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 cursor-default animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {mockupUrl ? (
              <img
                src={mockupUrl}
                alt={sku}
                className="w-12 h-12 shrink-0 rounded-xl object-cover border border-slate-200 shadow-2xs"
              />
            ) : (
              <div className="w-12 h-12 shrink-0 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                <Tag size={20} />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-mono text-base font-black text-slate-900">{sku}</h3>
                <span className="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600">
                  {storeName}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Hiệu quả {activeDays} ngày</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Timeframe Switcher */}
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
              {(["7D", "14D", "30D"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => handleSetTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                    timeframe === tf ? "bg-slate-800 text-white shadow-2xs" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 gap-2.5 my-4 sm:grid-cols-[1fr_1fr_0.8fr_1.25fr]">
          <KpiCard
            tone="bg-indigo-50/70"
            iconTone="bg-indigo-100/70 text-indigo-600"
            icon={<StackIcon size={18} weight="duotone" />}
            label="Spend"
            value={`$${totals.spend.toFixed(2)}`}
          />
          <KpiCard
            tone="bg-emerald-50/70"
            iconTone="bg-emerald-100/70 text-emerald-600"
            icon={<ShoppingCartIcon size={18} weight="duotone" />}
            label="Sales"
            value={`$${totals.sales.toFixed(2)}`}
          />
          <KpiCard
            tone="bg-violet-50/70"
            iconTone="bg-violet-100/70 text-violet-600"
            icon={<CubeIcon size={18} weight="duotone" />}
            label="Orders"
            value={String(totals.orders)}
          />
          <KpiCard
            tone="bg-orange-50/70"
            iconTone="bg-orange-100/70 text-orange-500"
            icon={<PercentIcon size={18} weight="bold" />}
            label="ACoS"
            value={noData ? "—" : totals.acos > 500 ? "0 sales" : `${totals.acos.toFixed(1)}%`}
            valueClass={noData ? "text-slate-400" : totals.acos > 500 ? "text-rose-600" : acosTone(totals.acos)}
            aside={
              <div className="rounded-lg bg-white/90 px-2 py-1 text-center shadow-2xs">
                <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <TargetIcon size={11} weight="bold" />
                  Target
                </span>
                <span className="font-mono text-xs font-bold text-slate-700">{targetAcos.toFixed(1)}%</span>
              </div>
            }
          />
        </div>

        {/* Chart: Spend & Sales (cột, trục $ trái) + ACoS (đường, trục % phải) */}
        <div className="h-72 w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              No {timeframe} data available for this SKU
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={plotData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }} barGap={2}>
                <defs>
                  <linearGradient id="ppcSkuAcosFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f1f5f9" yAxisId="money" />
                <XAxis
                  dataKey="shortDate"
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                  interval={timeframe === "30D" ? 2 : 0}
                  tick={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }}
                />
                <YAxis
                  yAxisId="money"
                  width={46}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, moneyCeil]}
                  ticks={moneyTicks}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(val) => `$${formatTick(val)}`}
                />
                <YAxis
                  yAxisId="acos"
                  orientation="right"
                  width={42}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, acosCeil]}
                  ticks={acosTicks}
                  allowDataOverflow
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(val) => `${formatTick(val)}%`}
                />
                <Tooltip content={renderTooltip} cursor={{ fill: "#f8fafc" }} />

                <Bar yAxisId="money" dataKey="spend" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={barSize} />
                <Bar yAxisId="money" dataKey="sales" fill="#22c55e" radius={[3, 3, 0, 0]} barSize={barSize} />

                <ReferenceLine
                  yAxisId="acos"
                  y={targetAcos}
                  stroke="#22c55e"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  label={<TargetPill text={`Target ${formatTick(targetAcos)}%`} />}
                />

                <Area
                  yAxisId="acos"
                  type="monotone"
                  dataKey="acosPlot"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  fill="url(#ppcSkuAcosFill)"
                  connectNulls
                  zIndex={450}
                  dot={{ r: 4, fill: "#f97316", fillOpacity: 1, stroke: "#fff", strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: "#f97316", fillOpacity: 1, stroke: "#fff", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="acos"
                  dataKey="noSalePlot"
                  stroke="none"
                  legendType="none"
                  dot={{ r: 4, fill: "#e11d48", stroke: "#fff", strokeWidth: 2 }}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 mt-3 text-xs text-slate-600 font-semibold">
          <LegendItem marker={<span className="h-3 w-3 rounded-[3px] bg-indigo-500" />} label="Spend" />
          <LegendItem marker={<span className="h-3 w-3 rounded-[3px] bg-green-500" />} label="Sales" />
          <LegendItem
            marker={
              <span className="relative flex h-3 w-5 items-center">
                <span className="h-0.5 w-full bg-orange-500" />
                <span className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-orange-500" />
              </span>
            }
            label="ACoS"
          />
        </div>
      </div>
    </div>
  );
}

/** Số tròn đẹp ≥ v, chia hết cho `steps` khoảng (vd 112 → 120 với 4 khoảng). */
function niceCeil(v: number, steps: number) {
  if (v <= 0) return steps;
  const rawStep = v / steps;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? 10 * mag;
  return step * steps;
}

function formatTick(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
}

/** Nhãn "Target 30%" dạng pill ở đầu vạch target. */
function TargetPill({ text, viewBox }: { text: string; viewBox?: { x?: number; y?: number } }) {
  const x = (viewBox?.x ?? 0) + 8;
  const y = viewBox?.y ?? 0;
  const w = text.length * 6 + 16;
  return (
    <g>
      <rect x={x} y={y - 10} width={w} height={20} rx={6} fill="#22c55e" />
      <text x={x + w / 2} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
        {text}
      </text>
    </g>
  );
}

function KpiCard({
  tone,
  iconTone,
  icon,
  label,
  value,
  valueClass = "text-slate-900",
  aside,
}: {
  tone: string;
  iconTone: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl p-3 ${tone}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-600">{label}</span>
        <span className={`block truncate font-mono text-lg font-black leading-tight ${valueClass}`}>{value}</span>
      </div>
      {aside}
    </div>
  );
}

function TooltipRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="flex items-center gap-1.5 text-slate-500">
        <span className={swatch} />
        {label}
      </span>
      <span className="font-black text-slate-900">{value}</span>
    </div>
  );
}

function LegendItem({ marker, label }: { marker: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {marker}
      <span>{label}</span>
    </div>
  );
}

/** Sparkline 7 ngày (xanh = có sales, đỏ = chỉ có spend); bấm để mở PpcSkuTrendModal. */
export function SkuTrendSparkline({
  dailyTrend,
  sku,
  storeName,
  mockupUrl,
  onOpenDetail,
}: {
  dailyTrend?: PpcSkuDailyTrendPoint[];
  sku: string;
  storeName: string;
  mockupUrl?: string | null;
  onOpenDetail?: (data: {
    sku: string;
    storeName: string;
    mockupUrl?: string | null;
    dailyTrend: PpcSkuDailyTrendPoint[];
  }) => void;
}) {
  if (!dailyTrend || dailyTrend.length === 0) {
    return <span className="text-[10px] text-slate-300 font-mono">-</span>;
  }

  // The sparkline shows the last 7 days
  const last7 = dailyTrend.slice(-7);
  const maxVal = Math.max(...last7.map((d) => Math.max(d.spend || 0, d.sales || 0)), 1);
  const totSpend = last7.reduce((s, d) => s + (d.spend || 0), 0);
  const totSales = last7.reduce((s, d) => s + (d.sales || 0), 0);
  const totOrders = last7.reduce((s, d) => s + (d.orders || 0), 0);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpenDetail?.({ sku, storeName, mockupUrl, dailyTrend });
      }}
      className="group/spark inline-flex items-end gap-[3px] h-6 px-1.5 py-0.5 rounded hover:bg-indigo-50/70 cursor-pointer transition select-none"
      title={`7D: Spend $${totSpend.toFixed(1)} • Sales $${totSales.toFixed(1)} (${totOrders} orders) - Click to view 30D trend`}
    >
      {last7.map((d, idx) => {
        const hasSales = (d.sales || 0) > 0;
        const hasSpend = (d.spend || 0) > 0;
        const val = hasSales ? d.sales : d.spend;
        const heightPx = Math.max(3, Math.min(18, Math.round((val / maxVal) * 18)));

        let bgClass = "bg-slate-200";
        if (hasSales) {
          bgClass = "bg-emerald-500 group-hover/spark:bg-emerald-600";
        } else if (hasSpend) {
          bgClass = "bg-rose-400 group-hover/spark:bg-rose-500";
        }

        return (
          <div
            key={idx}
            className="flex flex-col items-center justify-end h-full"
            style={{ width: "6px" }}
          >
            <div
              style={{ height: `${heightPx}px` }}
              className={`w-full rounded-xs ${bgClass} transition-all`}
            />
          </div>
        );
      })}
    </div>
  );
}
