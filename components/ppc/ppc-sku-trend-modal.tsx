"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
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
}

export function PpcSkuTrendModal({
  isOpen,
  onClose,
  sku,
  storeName,
  mockupUrl,
  dailyTrend,
}: PpcSkuTrendModalProps) {
  if (!isOpen) return null;

  const { chartData, totals } = useMemo(() => {
    let totSpend = 0;
    let totSales = 0;
    let totOrders = 0;

    const data = (dailyTrend || []).map((d) => {
      totSpend += d.spend || 0;
      totSales += d.sales || 0;
      totOrders += d.orders || 0;
      const acos = d.sales > 0 ? (d.spend / d.sales) * 100 : (d.spend > 0 ? 999 : 0);
      const parts = d.date.split("-");
      const shortDate = parts.length >= 3 ? `${parts[2]}/${parts[1]}` : d.date;

      return {
        date: d.date,
        shortDate,
        spend: Math.round((d.spend || 0) * 100) / 100,
        sales: Math.round((d.sales || 0) * 100) / 100,
        orders: d.orders || 0,
        acos: acos > 500 ? "0 sales" : `${acos.toFixed(1)}%`,
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
  }, [dailyTrend]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 cursor-default animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
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
              <p className="text-xs text-slate-400 mt-0.5">7-day spend & sales performance trend</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Minimal KPI Badges */}
        <div className="grid grid-cols-4 gap-2.5 my-4">
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <span className="block text-[11px] font-semibold text-slate-400">Spend (7D)</span>
            <span className="font-mono text-sm font-black text-slate-900">${totals.spend.toFixed(2)}</span>
          </div>
          <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 text-center">
            <span className="block text-[11px] font-semibold text-emerald-600">Sales (7D)</span>
            <span className="font-mono text-sm font-black text-emerald-700">${totals.sales.toFixed(2)}</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <span className="block text-[11px] font-semibold text-slate-400">Orders (7D)</span>
            <span className="font-mono text-sm font-black text-slate-900">{totals.orders}</span>
          </div>
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-center">
            <span className="block text-[11px] font-semibold text-slate-400">ACoS (7D)</span>
            <span
              className={`font-mono text-sm font-black ${
                totals.acos > 500
                  ? "text-rose-600"
                  : totals.acos <= 30
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

        {/* Minimal Chart */}
        <div className="h-56 w-full pt-2">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              No 7-day data available for this SKU
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="shortDate"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickFormatter={(val) => `$${val}`}
                />
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
                            <span className="font-black text-slate-900">{d.acos}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
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
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-indigo-500" />
            <span>Spend (Line)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
