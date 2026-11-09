"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { X, Tag } from "@phosphor-icons/react";
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
        // ACoS chỉ có nghĩa khi có sales; ngày tiêu tiền mà 0 sales được đánh dấu riêng ở tầng ACoS
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

  // Trục ACoS: luôn thấy vạch target; ngày ACoS quá cao bị chặn ở trần (giá trị thật xem ở tooltip)
  const maxAcos = Math.max(0, ...chartData.map((d) => d.acosNum ?? 0));
  const acosCeil = Math.min(
    Math.max(targetAcos * 2, Math.ceil(maxAcos / 20) * 20),
    Math.max(targetAcos * 4, 200),
  );
  const plotData = chartData.map((d) => ({
    ...d,
    acosPlot: d.acosNum == null ? null : Math.min(d.acosNum, acosCeil),
    noSalePlot: d.noSaleSpend ? acosCeil * 0.9 : null,
  }));
  type PlotPoint = (typeof plotData)[number];

  const xInterval = timeframe === "30D" ? 2 : 0;
  const yWidth = 44;
  const barSize = timeframe === "30D" ? 7 : timeframe === "14D" ? 12 : 18;

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
          <TooltipRow swatch="h-2 w-2 rounded-xs bg-emerald-500" label="Sales" value={`$${d.sales.toFixed(2)}`} />
          <TooltipRow swatch="h-2 w-2 rounded-xs bg-slate-400" label="Orders" value={String(d.orders)} />
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-0.5 w-2.5 bg-amber-500" />
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
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            {mockupUrl ? (
              <img
                src={mockupUrl}
                alt={sku}
                className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-2xs"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                <Tag size={20} />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-base font-black text-slate-900">{sku}</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-600">
                  {storeName}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{timeframe} performance trend • Spend, Sales, Orders & ACoS</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Timeframe Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              {(["7D", "14D", "30D"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => handleSetTimeframe(tf)}
                  className={`px-2 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                    timeframe === tf
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-500 hover:text-slate-800"
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

        {/* KPI: ô vuông màu trùng màu series trên biểu đồ */}
        <div className="grid grid-cols-4 gap-2.5 my-4">
          <KpiTile swatch="bg-indigo-500" label={`Spend (${timeframe})`} value={`$${totals.spend.toFixed(2)}`} />
          <KpiTile swatch="bg-emerald-500" label={`Sales (${timeframe})`} value={`$${totals.sales.toFixed(2)}`} />
          <KpiTile swatch="bg-slate-400" label={`Orders (${timeframe})`} value={String(totals.orders)} />
          <KpiTile
            swatch="bg-amber-500"
            label={`ACoS (${timeframe})`}
            value={totals.spend <= 0 && totals.sales <= 0 ? "—" : totals.acos > 500 ? "0 sales" : `${totals.acos.toFixed(1)}%`}
            valueClass={
              totals.spend <= 0 && totals.sales <= 0
                ? "text-slate-400"
                : totals.acos > 500
                  ? "text-rose-600"
                  : acosTone(totals.acos)
            }
          />
        </div>

        {/* Chart: 3 tầng chung trục ngày (không dùng 2 trục Y); rê chuột 1 tầng thì cả 3 cùng chỉ 1 ngày */}
        {chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-xs text-slate-400">
            No {timeframe} data available for this SKU
          </div>
        ) : (
          <div className="w-full">
            <PanelLabel>Spend vs Sales ($)</PanelLabel>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={plotData} syncId="ppcSkuTrend" margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="shortDate" interval={xInterval} hide />
                  <YAxis
                    width={yWidth}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(val) => `$${val}`}
                  />
                  <Tooltip content={renderTooltip} cursor={{ fill: "#f1f5f9" }} />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <Bar dataKey="spend" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={barSize} />
                  <Bar dataKey="sales" fill="#10b981" radius={[3, 3, 0, 0]} barSize={barSize} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <PanelLabel>
              ACoS (%){" "}
              <span className="font-normal text-slate-400">
                · nét đứt = target {targetAcos}% · chấm đỏ = có spend nhưng 0 sales
              </span>
            </PanelLabel>
            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={plotData} syncId="ppcSkuTrend" margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="shortDate" interval={xInterval} hide />
                  <YAxis
                    width={yWidth}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, acosCeil]}
                    allowDataOverflow
                    ticks={[0, targetAcos, acosCeil]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip content={() => null} cursor={{ stroke: "#cbd5e1" }} />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <ReferenceLine y={targetAcos} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="acosPlot"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 3, fill: "#f59e0b", stroke: "#fff", strokeWidth: 1.5 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="noSalePlot"
                    stroke="none"
                    dot={{ r: 4, fill: "#e11d48", stroke: "#fff", strokeWidth: 1.5 }}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <PanelLabel>Orders</PanelLabel>
            <div className="h-20 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={plotData} syncId="ppcSkuTrend" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="shortDate"
                    interval={xInterval}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }}
                  />
                  <YAxis
                    width={yWidth}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    domain={[0, (dataMax: number) => Math.max(1, dataMax)]}
                    tickCount={2}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <Tooltip content={() => null} cursor={{ fill: "#f1f5f9" }} />
                  <Bar dataKey="orders" fill="#94a3b8" radius={[3, 3, 0, 0]} barSize={barSize} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-semibold">
          <LegendItem swatch="w-2.5 h-2.5 rounded-xs bg-indigo-500" label="Spend" />
          <LegendItem swatch="w-2.5 h-2.5 rounded-xs bg-emerald-500" label="Sales" />
          <LegendItem swatch="w-2.5 h-0.5 bg-amber-500" label="ACoS" />
          <LegendItem swatch="w-2.5 h-2.5 rounded-xs bg-slate-400" label="Orders" />
        </div>
      </div>
    </div>
  );
}

function KpiTile({
  swatch,
  label,
  value,
  valueClass = "text-slate-900",
}: {
  swatch: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
      <span className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <span className={`h-2 w-2 rounded-xs ${swatch}`} />
        {label}
      </span>
      <span className={`font-mono text-sm font-black ${valueClass}`}>{value}</span>
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

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 pl-1 text-[11px] font-bold text-slate-600">{children}</p>;
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={swatch} />
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
