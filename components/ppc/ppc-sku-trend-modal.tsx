"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { X, Tag, StackIcon, ShoppingCartIcon, CubeIcon, PercentIcon, TargetIcon, CaretRight, CircleNotch } from "@phosphor-icons/react";
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

  // Bấm 1 cột → xem spend/đơn ngày đó đến từ target nào; null = cả kỳ đang xem
  // Gắn ngày đang chọn với SKU/store/kỳ — đổi một trong ba thì tự về "cả kỳ"
  const selectionScope = `${storeName}|${sku}|${timeframe}`;
  const [dateSelection, setDateSelection] = useState<{ scope: string; date: string } | null>(null);
  const selectedDate = dateSelection?.scope === selectionScope ? dateSelection.date : null;
  const setSelectedDate = (update: (prev: string | null) => string | null) => {
    const next = update(selectedDate);
    setDateSelection(next ? { scope: selectionScope, date: next } : null);
  };

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
        className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl p-5 shadow-2xl border border-slate-200 cursor-default animate-in zoom-in-95 duration-150"
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
              <ComposedChart
                data={plotData}
                margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                barGap={2}
                className="cursor-pointer"
                onClick={(state: unknown) => {
                  const st = state as { activeTooltipIndex?: number | string | null; activeIndex?: number | string | null; activeLabel?: string | number } | null;
                  const idx = Number(st?.activeTooltipIndex ?? st?.activeIndex);
                  const point = Number.isInteger(idx) && plotData[idx]
                    ? plotData[idx]
                    : plotData.find((d) => d.shortDate === st?.activeLabel);
                  if (!point) return;
                  setSelectedDate((prev) => (prev === point.date ? null : point.date));
                }}
              >
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

                <Bar yAxisId="money" dataKey="spend" fill="#6366f1" radius={[3, 3, 0, 0]} barSize={barSize}>
                  {plotData.map((d) => (
                    <Cell key={d.date} fillOpacity={selectedDate && selectedDate !== d.date ? 0.3 : 1} />
                  ))}
                </Bar>
                <Bar yAxisId="money" dataKey="sales" fill="#22c55e" radius={[3, 3, 0, 0]} barSize={barSize}>
                  {plotData.map((d) => (
                    <Cell key={d.date} fillOpacity={selectedDate && selectedDate !== d.date ? 0.3 : 1} />
                  ))}
                </Bar>

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

        {chartData.length > 0 && (
          <SkuTargetBreakdown
            sku={sku}
            storeName={storeName}
            startDate={selectedDate ?? chartData[0].date}
            endDate={selectedDate ?? chartData[chartData.length - 1].date}
            selectedDate={selectedDate}
            periodLabel={`${activeDays} ngày`}
            onClearDate={() => setDateSelection(null)}
            targetAcos={targetAcos}
          />
        )}
      </div>
    </div>
  );
}

interface BreakdownRow {
  storeName: string;
  campaignName: string;
  adGroupName: string;
  targetKeyword: string;
  matchType: string;
  searchTerm: string;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

/** Spend / đơn của SKU tách theo target (search term report theo ngày). */
function SkuTargetBreakdown({
  sku,
  storeName,
  startDate,
  endDate,
  selectedDate,
  periodLabel,
  onClearDate,
  targetAcos,
}: {
  sku: string;
  storeName: string;
  startDate: string;
  endDate: string;
  selectedDate: string | null;
  periodLabel: string;
  onClearDate: () => void;
  targetAcos: number;
}) {
  // Kết quả gắn với khoá request: đổi ngày / SKU thì dữ liệu cũ tự bị bỏ qua cho tới khi tải xong
  const requestKey = `${storeName}|${sku}|${startDate}|${endDate}`;
  const [result, setResult] = useState<{
    key: string;
    rows: BreakdownRow[] | null;
    latestReportDate: string | null;
    error: string | null;
  } | null>(null);
  const [expandedState, setExpanded] = useState<{ key: string; ids: Set<string> } | null>(null);
  const current = result?.key === requestKey ? result : null;
  const rows = current?.rows ?? null;
  const latestReportDate = current?.latestReportDate ?? null;
  const error = current?.error ?? null;
  const expanded = expandedState?.key === requestKey ? expandedState.ids : new Set<string>();
  const toggleExpanded = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded({ key: requestKey, ids: next });
  };

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ storeName: storeName || "ALL", sku, startDate, endDate });
    fetch(`/api/ppc/sku-target-breakdown?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Không tải được chi tiết target.");
        setResult({
          key: requestKey,
          rows: Array.isArray(data?.rows) ? data.rows : [],
          latestReportDate: data?.latestReportDate ?? null,
          error: null,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, rows: null, latestReportDate: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [requestKey, sku, storeName, startDate, endDate]);

  const targets = useMemo(() => {
    const map = new Map<string, {
      key: string; campaignName: string; targetKeyword: string; matchType: string;
      clicks: number; spend: number; sales: number; orders: number; terms: BreakdownRow[];
    }>();
    for (const r of rows || []) {
      const key = `${r.storeName}|${r.campaignName}|${r.adGroupName}|${r.targetKeyword}|${r.matchType}`;
      let t = map.get(key);
      if (!t) {
        t = { key, campaignName: r.campaignName, targetKeyword: r.targetKeyword, matchType: r.matchType, clicks: 0, spend: 0, sales: 0, orders: 0, terms: [] };
        map.set(key, t);
      }
      t.clicks += r.clicks;
      t.spend += r.spend;
      t.sales += r.sales;
      t.orders += r.orders;
      t.terms.push(r);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend || b.sales - a.sales);
  }, [rows]);

  const total = targets.reduce(
    (acc, t) => ({ spend: acc.spend + t.spend, sales: acc.sales + t.sales, orders: acc.orders + t.orders, clicks: acc.clicks + t.clicks }),
    { spend: 0, sales: 0, orders: 0, clicks: 0 },
  );
  const fmtDate = (d: string) => {
    const p = d.split("-");
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
  };
  const acosText = (spend: number, sales: number) =>
    sales > 0 ? `${((spend / sales) * 100).toFixed(1)}%` : spend > 0 ? "0 sales" : "—";
  const acosClass = (spend: number, sales: number) =>
    sales > 0 ? ((spend / sales) * 100 <= targetAcos ? "text-emerald-600" : "text-rose-600") : spend > 0 ? "text-rose-600" : "text-slate-300";
  const noReportYet = Boolean(selectedDate && latestReportDate && selectedDate > latestReportDate);
  // Search term report về chậm hơn số Ads theo ngày → tổng bảng có thể thấp hơn tổng biểu đồ
  const partialCoverage = Boolean(!selectedDate && latestReportDate && latestReportDate < endDate);

  return (
    <div className="mt-4 rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="text-xs font-bold text-slate-800">
          Spend / đơn theo target · {selectedDate ? `ngày ${fmtDate(selectedDate)}` : periodLabel}
          {rows && rows.length > 0 && (
            <span className="ml-2 font-mono font-semibold text-slate-500">
              ${total.spend.toFixed(2)} spend · {total.orders} đơn · ${total.sales.toFixed(2)} sales
            </span>
          )}
        </div>
        {selectedDate ? (
          <button
            type="button"
            onClick={onClearDate}
            className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
          >
            Xem cả {periodLabel}
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Bấm vào 1 cột để xem riêng ngày đó</span>
        )}
      </div>

      {partialCoverage && rows && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Search term report mới có tới {fmtDate(latestReportDate!)} — các ngày sau đó chưa tách được theo target.
        </div>
      )}
      {error ? (
        <div className="px-3 py-4 text-xs text-rose-600">{error}</div>
      ) : rows === null ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
          <CircleNotch size={14} className="animate-spin" /> Đang tải chi tiết target...
        </div>
      ) : targets.length === 0 ? (
        <div className="px-3 py-4 text-xs text-slate-400">
          {noReportYet
            ? `Chưa có search term report cho ngày này (report mới nhất: ${fmtDate(latestReportDate!)}).`
            : "Không có click / spend nào theo target trong khoảng này (search term report)."}
        </div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="py-2 pl-3 pr-2">Target</th>
                <th className="py-2 px-2">Campaign</th>
                <th className="py-2 px-2 text-right">Clicks</th>
                <th className="py-2 px-2 text-right">Spend</th>
                <th className="py-2 px-2 text-right">Orders</th>
                <th className="py-2 px-2 text-right">Sales</th>
                <th className="py-2 pl-2 pr-3 text-right">ACoS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {targets.map((t) => {
                const isOpen = expanded.has(t.key);
                return (
                  <React.Fragment key={t.key}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => toggleExpanded(t.key)}
                      title="Bấm để xem search term"
                    >
                      <td className="py-2 pl-3 pr-2">
                        <div className="flex items-start gap-1">
                          <CaretRight size={11} weight="bold" className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          <div>
                            <div className="font-semibold text-slate-900 break-words">{t.targetKeyword || "(auto / không rõ)"}</div>
                            <div className="text-[10px] text-slate-400 capitalize">{(t.matchType || "").toLowerCase()} · {t.terms.length} search term</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-[11px] text-slate-500 break-all max-w-[280px]">{t.campaignName}</td>
                      <td className="py-2 px-2 text-right font-mono">{t.clicks}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900">${t.spend.toFixed(2)}</td>
                      <td className={`py-2 px-2 text-right font-mono ${t.orders ? "font-bold text-emerald-700" : "text-slate-300"}`}>{t.orders}</td>
                      <td className={`py-2 px-2 text-right font-mono ${t.sales ? "text-slate-900" : "text-slate-300"}`}>${t.sales.toFixed(2)}</td>
                      <td className={`py-2 pl-2 pr-3 text-right font-mono font-semibold ${acosClass(t.spend, t.sales)}`}>{acosText(t.spend, t.sales)}</td>
                    </tr>
                    {isOpen && t.terms.map((st) => (
                      <tr key={`${t.key}|${st.searchTerm}`} className="bg-slate-50/60 text-slate-500">
                        <td className="py-1.5 pl-8 pr-2 italic break-words" colSpan={2}>“{st.searchTerm}”</td>
                        <td className="py-1.5 px-2 text-right font-mono">{st.clicks}</td>
                        <td className="py-1.5 px-2 text-right font-mono">${st.spend.toFixed(2)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono ${st.orders ? "font-bold text-emerald-700" : ""}`}>{st.orders}</td>
                        <td className="py-1.5 px-2 text-right font-mono">${st.sales.toFixed(2)}</td>
                        <td className={`py-1.5 pl-2 pr-3 text-right font-mono ${acosClass(st.spend, st.sales)}`}>{acosText(st.spend, st.sales)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
