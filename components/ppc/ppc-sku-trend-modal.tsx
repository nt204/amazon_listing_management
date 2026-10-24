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

export type SkuTrendMetricMode = "spend_sales" | "acos";

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

  // Sync metric mode across all SKUs / accounts via localStorage
  const [metricMode, setMetricModeState] = useState<SkuTrendMetricMode>(() => {
    if (typeof window !== "undefined") {
      const savedStore = storeName ? localStorage.getItem(`ppc_sku_trend_metric_${storeName}`) : null;
      if (savedStore === "spend_sales" || savedStore === "acos") return savedStore;
      const savedGlobal = localStorage.getItem("ppc_sku_trend_metric");
      if (savedGlobal === "spend_sales" || savedGlobal === "acos") return savedGlobal;
    }
    return "spend_sales";
  });

  // When sku or store changes, restore the user's saved preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedMode = (storeName && localStorage.getItem(`ppc_sku_trend_metric_${storeName}`)) || localStorage.getItem("ppc_sku_trend_metric");
      if (savedMode === "spend_sales" || savedMode === "acos") {
        setMetricModeState(savedMode);
      }
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

  const handleSetMetricMode = (mode: SkuTrendMetricMode) => {
    setMetricModeState(mode);
    try {
      localStorage.setItem("ppc_sku_trend_metric", mode);
      if (storeName) {
        localStorage.setItem(`ppc_sku_trend_metric_${storeName}`, mode);
      }
    } catch {}
  };

  if (!isOpen) return null;

  const activeDays = timeframe === "7D" ? 7 : timeframe === "14D" ? 14 : 30;

  const { chartData, totals } = useMemo(() => {
    const sliced = (dailyTrend || []).slice(-activeDays);

    let totSpend = 0;
    let totSales = 0;
    let totOrders = 0;

    const data = sliced.map((d) => {
      totSpend += d.spend || 0;
      totSales += d.sales || 0;
      totOrders += d.orders || 0;
      const rawAcos = d.sales > 0 ? (d.spend / d.sales) * 100 : (d.spend > 0 ? 999 : 0);
      const acosNum = d.sales > 0 ? Math.round(((d.spend / d.sales) * 100) * 10) / 10 : null;
      const parts = d.date.split("-");
      const shortDate = parts.length >= 3 ? `${parts[2]}/${parts[1]}` : d.date;

      return {
        date: d.date,
        shortDate,
        spend: Math.round((d.spend || 0) * 100) / 100,
        sales: Math.round((d.sales || 0) * 100) / 100,
        orders: d.orders || 0,
        acosNum,
        acosLabel: rawAcos > 500 ? "0 sales" : `${rawAcos.toFixed(1)}%`,
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
              <p className="text-xs text-slate-400 mt-0.5">
                {timeframe} performance trend • {metricMode === "spend_sales" ? "Spend & Sales" : "Sales & ACoS"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Metric Mode Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => handleSetMetricMode("spend_sales")}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  metricMode === "spend_sales"
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Biểu đồ Doanh số & Chi tiêu"
              >
                Spend & Sales
              </button>
              <button
                type="button"
                onClick={() => handleSetMetricMode("acos")}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                  metricMode === "acos"
                    ? "bg-white text-amber-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Biểu đồ Doanh số & Tỷ lệ ACoS"
              >
                ACoS
              </button>
            </div>

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

        {/* Minimal KPI Badges */}
        <div className="grid grid-cols-4 gap-2.5 my-4">
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <span className="block text-[11px] font-semibold text-slate-400">Spend ({timeframe})</span>
            <span className="font-mono text-sm font-black text-slate-900">${totals.spend.toFixed(2)}</span>
          </div>
          <div className={`p-2.5 rounded-xl border text-center transition ${
            metricMode === "spend_sales"
              ? "bg-emerald-50/60 border-emerald-200 ring-1 ring-emerald-200/60"
              : "bg-slate-50 border-slate-100"
          }`}>
            <span className="block text-[11px] font-semibold text-emerald-600">Sales ({timeframe})</span>
            <span className="font-mono text-sm font-black text-emerald-700">${totals.sales.toFixed(2)}</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <span className="block text-[11px] font-semibold text-slate-400">Orders ({timeframe})</span>
            <span className="font-mono text-sm font-black text-slate-900">{totals.orders}</span>
          </div>
          <div className={`p-2.5 rounded-xl border text-center transition ${
            metricMode === "acos"
              ? "bg-amber-50/70 border-amber-200 ring-1 ring-amber-200/60"
              : "bg-slate-50 border-slate-100"
          }`}>
            <span className="block text-[11px] font-semibold text-slate-400">ACoS ({timeframe})</span>
            <span
              className={`font-mono text-sm font-black ${
                totals.acos > 500
                  ? "text-rose-600"
                  : totals.acos <= targetAcos
                    ? "text-emerald-600"
                    : totals.acos <= 50
                      ? "text-amber-600"
                      : "text-rose-600"
              }`}
            >
              {totals.acos > 500 ? "0 sales" : `${totals.acos.toFixed(1)}%`}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div className="h-64 w-full pt-2">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              No {timeframe} data available for this SKU
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="shortDate"
                  axisLine={false}
                  tickLine={false}
                  interval={timeframe === "30D" ? 2 : 0}
                  tick={{ fontSize: 10, fill: "#64748b", fontWeight: 600 }}
                />

                {metricMode === "spend_sales" ? (
                  /* Single Axis for Spend & Sales ($) */
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(val) => `$${val}`}
                  />
                ) : (
                  /* Dual Axis: Left is Sales ($), Right is ACoS (%) */
                  <>
                    <YAxis
                      yAxisId="salesAxis"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: "#10b981" }}
                      tickFormatter={(val) => `$${val}`}
                    />
                    <YAxis
                      yAxisId="acosAxis"
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      domain={[0, (dataMax: number) => Math.max(60, Math.ceil(dataMax / 10) * 10)]}
                      tick={{ fontSize: 10, fill: "#f59e0b" }}
                      tickFormatter={(val) => `${val}%`}
                    />
                    <ReferenceLine
                      yAxisId="acosAxis"
                      y={targetAcos}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{
                        value: `Target: ${targetAcos}%`,
                        fill: "#94a3b8",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  </>
                )}

                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl text-xs">
                        <p className="font-mono font-bold text-slate-900 border-b border-slate-100 pb-1 mb-1.5">
                          {d.date}
                        </p>
                        <div className="space-y-1 font-mono text-[11px]">
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">Spend:</span>
                            <span className="font-black text-indigo-600">${d.spend.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">Sales:</span>
                            <span className="font-black text-emerald-600">${d.sales.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-slate-500">Orders:</span>
                            <span className="font-bold text-slate-800">{d.orders}</span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1">
                            <span className="text-slate-500">Daily ACoS:</span>
                            <span className={`font-black ${d.acosNum === null ? "text-rose-500" : d.acosNum <= targetAcos ? "text-emerald-600" : "text-amber-600"}`}>
                              {d.acosLabel}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />

                {/* Bars for Sales */}
                <Bar
                  yAxisId={metricMode === "acos" ? "salesAxis" : undefined}
                  dataKey="sales"
                  fill="#10b981"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={timeframe === "30D" ? 14 : 26}
                />

                {/* Line depending on metricMode */}
                {metricMode === "spend_sales" ? (
                  <Line
                    type="monotone"
                    dataKey="spend"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={timeframe === "30D" ? false : { r: 3, fill: "#6366f1", strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                  />
                ) : (
                  <Line
                    yAxisId="acosAxis"
                    type="monotone"
                    dataKey="acosNum"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    connectNulls={false}
                    dot={timeframe === "30D" ? false : { r: 3, fill: "#f59e0b", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Minimal legend */}
        <div className="flex items-center justify-center gap-6 mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
            <span>Sales (Bar)</span>
          </div>
          {metricMode === "spend_sales" ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-indigo-500" />
              <span>Spend (Line)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-amber-500" />
              <span>Daily ACoS % (Line)</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
