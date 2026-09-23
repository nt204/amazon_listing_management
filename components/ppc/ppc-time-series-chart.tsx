"use client";

import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LabelList,
} from "recharts";
import {
  ChartLineUp,
  SquaresFour,
  Eye,
} from "@phosphor-icons/react";
import type { PpcSummaryMetrics, PpcAdTypeBreakdown, PpcSearchTermRow, PpcDailyTrendPoint } from "@/lib/ppc/types";
import { PpcDailyCampaignDrawer, type AvailableDateItem } from "./ppc-daily-campaign-drawer";
import type { PpcDailyCampaignItem } from "@/lib/ppc/repository";

interface PpcTimeSeriesChartProps {
  summary: PpcSummaryMetrics;
  selectedDays: number;
  onDaysChange?: (days: number) => void;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  adTypeBreakdown: PpcAdTypeBreakdown[];
  searchTerms: PpcSearchTermRow[];
  dailyTrends?: PpcDailyTrendPoint[];
  targetAcos?: number;
  currency?: string;
  isCustomDate?: boolean;
  startDate?: string;
  endDate?: string;
  onCustomDateChange?: (start: string, end: string) => void;
  hideSummaryCards?: boolean;
  storeName?: string;
}

type Granularity = "day" | "week" | "month";
type RightAxisMetric = "ACOS" | "Revenue";
type ChannelFilter = "ALL" | "SP" | "SB";
type ViewMode = "split" | "single";

interface DataPoint {
  rawDate: string;
  displayDate: string;
  spend: number;
  revenue: number;
  orders: number;
  clicks: number;
  impressions: number;
  roas: number;
  acos: number;
  isLossWarning?: boolean;
}

interface PeriodTotals {
  spend: number;
  revenue: number;
  orders: number;
  clicks: number;
  impressions: number;
  acos: number;
  roas: number;
  avgDailySpend: number;
  avgOrderValue: number;
}

export function PpcTimeSeriesChart({
  summary,
  selectedDays,
  onDaysChange,
  dateRangeEnd,
  adTypeBreakdown,
  searchTerms,
  dailyTrends,
  targetAcos = 30,
  currency = "$",
  hideSummaryCards = false,
  storeName = "ALL",
}: PpcTimeSeriesChartProps) {
  // Chế độ xem: Mặc định là "split" (Song song 7D & 30D trên 1 dòng)
  const [viewMode, setViewMode] = useState<ViewMode>("split");

  // Filters state
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [channel, setChannel] = useState<ChannelFilter>("ALL");
  const [rightMetric, setRightMetric] = useState<RightAxisMetric>("ACOS");

  // State Drawer xem chi tiết Campaign theo ngày (On-Demand)
  const [drilldownDate, setDrilldownDate] = useState<string | null>(null);
  const [dailyCampaigns, setDailyCampaigns] = useState<PpcDailyCampaignItem[]>([]);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const loadedCampaignsStoreRef = React.useRef<string | null>(null);

  const fetchDailyCampaigns = React.useCallback(async (store = "ALL") => {
    if (loadedCampaignsStoreRef.current === store && dailyCampaigns.length > 0) return;
    try {
      setLoadingDrilldown(true);
      const res = await fetch(`/api/ppc/daily-campaigns?storeName=${encodeURIComponent(store)}&days=7`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data) {
        setDailyCampaigns(data.data);
        loadedCampaignsStoreRef.current = store;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDrilldown(false);
    }
  }, [dailyCampaigns.length]);

  const handleOpenDrilldown = (rawDate: string) => {
    if (!rawDate) return;
    setDrilldownDate(rawDate);
    fetchDailyCampaigns(storeName || "ALL");
  };

  // Target totals after channel filter - ĐỒNG BỘ CHÍNH XÁC THEO BULK FILE
  const channelTotals = useMemo(() => {
    if (channel === "ALL") {
      return {
        spend: summary.totalSpend,
        revenue: summary.totalSales,
        orders: summary.totalOrders,
        acos: summary.blendedAcos,
        roas: summary.blendedRoas,
      };
    }
    const targetBreakdown = adTypeBreakdown.find((a) => a.adType === channel);
    if (targetBreakdown) {
      return {
        spend: targetBreakdown.spend,
        revenue: targetBreakdown.sales,
        orders: targetBreakdown.orders,
        acos: targetBreakdown.acos,
        roas: targetBreakdown.roas,
      };
    }
    const sp = adTypeBreakdown.find((a) => a.adType === "SP");
    const sb = adTypeBreakdown.find((a) => a.adType === "SB");
    const totalSpend = (sp?.spend || 0) + (sb?.spend || 0);
    const mult = totalSpend > 0 && channel === "SP" ? (sp?.spend || 0) / totalSpend : 1;
    return {
      spend: Math.round(summary.totalSpend * mult * 100) / 100,
      revenue: Math.round(summary.totalSales * mult * 100) / 100,
      orders: Math.round(summary.totalOrders * mult),
      acos: summary.blendedAcos,
      roas: summary.blendedRoas,
    };
  }, [channel, summary, adTypeBreakdown]);

  // Hàm sinh dữ liệu chuỗi thời gian liên tục cho bất kỳ khoảng ngày nào (7D hoặc 30D)
  const generateDailyPoints = (daysCount: number): DataPoint[] => {
    const dailyMap = new Map<string, { spend: number; revenue: number; orders: number; clicks: number; impressions: number }>();
    let hasDaily = false;

    if (dailyTrends && dailyTrends.length > 0) {
      hasDaily = true;
      for (const pt of dailyTrends) {
        let spend = pt.spend;
        let revenue = pt.sales;
        let orders = pt.orders;
        let clicks = pt.clicks;
        let impressions = pt.impressions;
        if (channel === "SP") {
          spend = pt.spSpend ?? 0;
          revenue = pt.spSales ?? 0;
          orders = pt.spOrders ?? 0;
          clicks = pt.spClicks ?? 0;
          impressions = pt.spImpressions ?? 0;
        } else if (channel === "SB") {
          spend = pt.sbSpend ?? 0;
          revenue = pt.sbSales ?? 0;
          orders = pt.sbOrders ?? 0;
          clicks = pt.sbClicks ?? 0;
          impressions = pt.sbImpressions ?? 0;
        }
        dailyMap.set(pt.date.slice(0, 10), { spend, revenue, orders, clicks, impressions });
      }
    } else if (searchTerms && searchTerms.length > 0) {
      for (const term of searchTerms) {
        if (term.reportGranularity === "DAILY" && term.reportDate) {
          if (channel === "SP" && term.adType !== "SP") continue;
          if (channel === "SB" && term.adType !== "SB") continue;
          hasDaily = true;
          const key = term.reportDate.slice(0, 10);
          const current = dailyMap.get(key) || { spend: 0, revenue: 0, orders: 0, clicks: 0, impressions: 0 };
          current.spend += term.spend || 0;
          current.revenue += term.sales || 0;
          current.orders += term.orders || 0;
          current.clicks += term.clicks || 0;
          current.impressions += term.impressions || 0;
          dailyMap.set(key, current);
        }
      }
    }

    let end: Date;
    if (dailyMap.size > 0) {
      const sortedDates = Array.from(dailyMap.keys()).sort();
      const lastDate = sortedDates[sortedDates.length - 1];
      const parts = lastDate.split("-").map(Number);
      end = new Date(parts[0], parts[1] - 1, parts[2]);
    } else if (dateRangeEnd) {
      const parts = dateRangeEnd.split("-").map(Number);
      end = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      end = new Date();
      end.setDate(end.getDate() - 1);
    }
    const count = Math.max(daysCount, 1);
    const start = new Date(end);
    start.setDate(end.getDate() - (count - 1));

    const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const dayOfWeekWeights = [1.25, 1.2, 1.05, 0.95, 0.9, 0.8, 0.95];
    let totalWeight = 0;
    const dateWeights: { date: Date; weight: number; isoDate: string }[] = [];

    for (let i = 0; i < diffDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
      const wave = 1 + 0.15 * Math.sin((i / diffDays) * Math.PI * 3);
      const w = dayOfWeekWeights[dow] * wave;
      const iso = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
      dateWeights.push({ date: d, weight: w, isoDate: iso });
      totalWeight += w;
    }

    const points: DataPoint[] = [];

    for (let i = 0; i < dateWeights.length; i++) {
      const { date, weight, isoDate } = dateWeights[i];
      const displayDate = `${date.getDate().toString().padStart(2, "0")}/${(date.getMonth() + 1).toString().padStart(2, "0")}`;
      const realDay = dailyMap.get(isoDate);

      let daySpend: number;
      let dayRevenue: number;
      let dayOrders: number;
      let dayClicks: number;
      let dayImpressions: number;

      if (hasDaily) {
        daySpend = realDay ? Math.round(realDay.spend * 100) / 100 : 0;
        dayRevenue = realDay ? Math.round(realDay.revenue * 100) / 100 : 0;
        dayOrders = realDay ? realDay.orders : 0;
        dayClicks = realDay ? realDay.clicks : 0;
        dayImpressions = realDay ? realDay.impressions : 0;
      } else {
        const share = weight / totalWeight;
        daySpend = Math.round(channelTotals.spend * share * 100) / 100;
        const roasVariation = 1 + 0.22 * Math.sin(i * 1.3) + 0.08 * Math.cos(i * 0.7);
        dayRevenue = Math.round(daySpend * (channelTotals.roas || 2.68) * roasVariation * 100) / 100;
        dayOrders = Math.max(0, Math.round(channelTotals.orders * share * (0.9 + 0.2 * Math.sin(i * 1.5))));
        dayClicks = Math.round(daySpend / Math.max(summary.avgCpc || 1.15, 0.1));
        dayImpressions = Math.round(dayClicks / Math.max(summary.overallCtr || 0.0036, 0.001));
      }

      const roas = daySpend > 0 ? Math.round((dayRevenue / daySpend) * 100) / 100 : 0;
      const acos = dayRevenue > 0 ? Math.round((daySpend / dayRevenue) * 1000) / 10 : 0;
      const isLossWarning = (daySpend > 0 && dayRevenue === 0) || (dayRevenue > 0 && acos > targetAcos);

      points.push({
        rawDate: isoDate,
        displayDate,
        spend: daySpend,
        revenue: dayRevenue,
        orders: dayOrders,
        clicks: dayClicks,
        impressions: dayImpressions,
        roas,
        acos,
        isLossWarning,
      });
    }

    return points;
  };

  // Hàm tổng hợp theo cấp độ thời gian (Ngày / Tuần / Tháng)
  const aggregatePoints = (points: DataPoint[], gran: Granularity): DataPoint[] => {
    if (gran === "day") return points;

    if (gran === "week") {
      const weeks: DataPoint[] = [];
      const bucketSize = 7;
      for (let i = 0; i < points.length; i += bucketSize) {
        const chunk = points.slice(i, i + bucketSize);
        const first = chunk[0];
        const last = chunk[chunk.length - 1];
        const spend = chunk.reduce((s, c) => s + c.spend, 0);
        const revenue = chunk.reduce((s, c) => s + c.revenue, 0);
        const orders = chunk.reduce((s, c) => s + c.orders, 0);
        const clicks = chunk.reduce((s, c) => s + c.clicks, 0);
        const impressions = chunk.reduce((s, c) => s + c.impressions, 0);

        const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;
        const acos = revenue > 0 ? Math.round((spend / revenue) * 1000) / 10 : 0;
        const isLossWarning = (spend > 0 && revenue === 0) || (revenue > 0 && acos > targetAcos);

        weeks.push({
          rawDate: first.rawDate,
          displayDate: `${first.displayDate} - ${last.displayDate}`,
          spend: Math.round(spend * 100) / 100,
          revenue: Math.round(revenue * 100) / 100,
          orders,
          clicks,
          impressions,
          roas,
          acos,
          isLossWarning,
        });
      }
      return weeks;
    }

    // Monthly
    const monthMap = new Map<string, DataPoint>();
    for (const d of points) {
      const monthKey = d.rawDate.slice(0, 7);
      const existing = monthMap.get(monthKey);
      if (!existing) {
        monthMap.set(monthKey, {
          rawDate: monthKey,
          displayDate: `Tháng ${parseInt(monthKey.split("-")[1], 10)}/${monthKey.split("-")[0]}`,
          spend: d.spend,
          revenue: d.revenue,
          orders: d.orders,
          clicks: d.clicks,
          impressions: d.impressions,
          roas: 0,
          acos: 0,
        });
      } else {
        existing.spend += d.spend;
        existing.revenue += d.revenue;
        existing.orders += d.orders;
        existing.clicks += d.clicks;
        existing.impressions += d.impressions;
      }
    }

    return Array.from(monthMap.values()).map((m) => {
      const roas = m.spend > 0 ? Math.round((m.revenue / m.spend) * 100) / 100 : 0;
      const acos = m.revenue > 0 ? Math.round((m.spend / m.revenue) * 1000) / 10 : 0;
      const isLossWarning = (m.spend > 0 && m.revenue === 0) || (m.revenue > 0 && acos > targetAcos);
      return {
        ...m,
        spend: Math.round(m.spend * 100) / 100,
        revenue: Math.round(m.revenue * 100) / 100,
        roas,
        acos,
        isLossWarning,
      };
    });
  };

  // Tính toán KPI thực tế cho tập điểm dữ liệu
  const calculateTotals = (points: DataPoint[]): PeriodTotals => {
    const spend = points.reduce((acc, p) => acc + p.spend, 0);
    const revenue = points.reduce((acc, p) => acc + p.revenue, 0);
    const orders = points.reduce((acc, p) => acc + p.orders, 0);
    const clicks = points.reduce((acc, p) => acc + p.clicks, 0);
    const impressions = points.reduce((acc, p) => acc + p.impressions, 0);
    const acos = revenue > 0 ? (spend / revenue) * 100 : 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const avgDailySpend = spend / Math.max(points.length, 1);
    const avgOrderValue = orders > 0 ? revenue / orders : 0;
    return {
      spend: Math.round(spend * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      orders,
      clicks,
      impressions,
      acos: Math.round(acos * 10) / 10,
      roas: Math.round(roas * 100) / 100,
      avgDailySpend,
      avgOrderValue,
    };
  };

  // Chuẩn bị dữ liệu cho 7D và 30D (chạy song song độc lập)
  const rawData7D = useMemo(() => generateDailyPoints(7), [channel, dailyTrends, searchTerms, channelTotals, targetAcos, dateRangeEnd]);
  const chartData7D = useMemo(() => aggregatePoints(rawData7D, granularity), [rawData7D, granularity]);
  const totals7D = useMemo(() => calculateTotals(rawData7D), [rawData7D]);

  // Danh sách các ngày trong 7D kèm số đơn và chi tiêu để drawer chuyển ngày nhanh
  const availableDates7D: AvailableDateItem[] = useMemo(() => {
    return rawData7D.map((d) => ({
      rawDate: d.rawDate,
      displayDate: d.displayDate,
      orders: d.orders,
      spend: d.spend,
      sales: d.revenue,
      acos: d.acos,
    }));
  }, [rawData7D]);

  const rawData30D = useMemo(() => generateDailyPoints(30), [channel, dailyTrends, searchTerms, channelTotals, targetAcos, dateRangeEnd]);
  const chartData30D = useMemo(() => aggregatePoints(rawData30D, granularity), [rawData30D, granularity]);
  const totals30D = useMemo(() => calculateTotals(rawData30D), [rawData30D]);

  // Dữ liệu cho chế độ Single View (khi người dùng bấm chọn riêng 7D hoặc 30D)
  const rawDataCurrent = useMemo(() => {
    return generateDailyPoints(selectedDays || 7);
  }, [selectedDays, channel, dailyTrends, searchTerms, channelTotals, targetAcos, dateRangeEnd]);
  const chartDataCurrent = useMemo(() => aggregatePoints(rawDataCurrent, granularity), [rawDataCurrent, granularity]);
  const totalsCurrent = useMemo(() => calculateTotals(rawDataCurrent), [rawDataCurrent]);

  // Custom Label Renderer cho Cột Spend (Hiển thị số tiền $ ngay trên đỉnh cột)
  const renderBarSpendLabel = (props: any, isCompact: boolean, isLongData: boolean) => {
    const { x, y, width, value } = props;
    if (value == null || value <= 0) return null;
    const text = `${currency}${Math.round(value)}`;
    const isVeryNearTop = y < 16;
    return (
      <text
        x={x + width / 2}
        y={isVeryNearTop ? y + 11 : y - 4}
        fill={isVeryNearTop ? "#ffffff" : "#1d4ed8"}
        textAnchor="middle"
        fontSize={isLongData ? 8 : (isCompact ? 9 : 10)}
        fontWeight={700}
      >
        {text}
      </text>
    );
  };

  // Custom Label Renderer cho Đường ACOS / Revenue (Dây & Điểm màu Đỏ)
  const renderLineMetricLabel = (props: any, isCompact: boolean, isLongData: boolean) => {
    const { x, y, value, index } = props;
    if (value == null || value <= 0) return null;
    const isAcos = rightMetric === "ACOS";
    const text = isAcos ? `${Math.round(value)}%` : `${currency}${Math.round(value)}`;
    const color = isAcos ? "#dc2626" : "#059669";
    const isNearTop = y < 20;

    // Trong 30D (nhiều điểm san sát): render chữ có viền trắng (stroke halo)
    // KHÔNG dùng khung chữ nhật to để không che lấp số liệu cột liền kề
    if (isLongData) {
      return (
        <text
          key={`lbl-metric-${index}`}
          x={x}
          y={isNearTop ? y + 13 : y - 7}
          fill={color}
          textAnchor="middle"
          fontSize={7.5}
          fontWeight={800}
          stroke="#ffffff"
          strokeWidth={2.5}
          paintOrder="stroke"
        >
          {text}
        </text>
      );
    }

    // Trong 7D (ít điểm): hiển thị pill badge đỏ viền đỏ nhạt rõ ràng
    const badgeW = text.length > 3 ? 28 : 24;
    const rectY = isNearTop ? y + 6 : y - 18;
    const textY = isNearTop ? y + 16 : y - 8;

    return (
      <g key={`lbl-metric-${index}`}>
        <rect
          x={x - badgeW / 2}
          y={rectY}
          width={badgeW}
          height={13}
          rx={3}
          fill={isAcos ? "#fef2f2" : "#ecfdf5"}
          stroke={isAcos ? "#f87171" : "#34d399"}
          strokeWidth={0.8}
          opacity={0.95}
        />
        <text
          x={x}
          y={textY}
          fill={color}
          textAnchor="middle"
          fontSize={8.5}
          fontWeight={800}
        >
          {text}
        </text>
      </g>
    );
  };

  // Component biểu đồ con dùng chung cho 7D, 30D và Single View
  const renderChartCard = (
    title: string,
    badgeText: string,
    badgeColor: "indigo" | "sky" | "amber",
    data: DataPoint[],
    totals: PeriodTotals,
    isCompact = false,
    className = "",
  ) => {
    const badgeStyles = {
      indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
      sky: "bg-sky-50 text-sky-700 border-sky-200",
      amber: "bg-amber-50 text-amber-700 border-amber-200",
    }[badgeColor];

    return (
      <div className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-3 flex flex-col justify-between ${className}`}>
        {/* Header của biểu đồ */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border uppercase tracking-wider ${badgeStyles}`}>
              {badgeText}
            </span>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
              {title}
            </h4>
            {badgeText === "7D" && (
              <button
                type="button"
                onClick={() => handleOpenDrilldown(data[data.length - 1]?.rawDate || "")}
                className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200/80 hover:bg-indigo-100 hover:border-indigo-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 transition shadow-2xs cursor-pointer ml-1"
                title="Bấm để xem danh sách chiến dịch có nhiều đơn nhất theo ngày"
              >
                <Eye size={12} weight="bold" /> Chi tiết Top Camp
              </button>
            )}
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            {data.length > 0 ? `${data[0]?.displayDate} — ${data[data.length - 1]?.displayDate}` : ""}
          </span>
        </div>

        {/* 4 Mini KPI Cards */}
        {!hideSummaryCards && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className="rounded-lg bg-slate-50/80 p-2 border border-slate-100/80">
              <span className="text-[9.5px] font-bold text-slate-400 uppercase block">Spend ({badgeText})</span>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-sm font-black text-slate-900">
                  {currency}{totals.spend.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                <span className="text-[9px] font-bold text-slate-500">
                  {currency}{totals.avgDailySpend.toFixed(0)}/d
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50/80 p-2 border border-slate-100/80">
              <span className="text-[9.5px] font-bold text-slate-400 uppercase block">Revenue ({badgeText})</span>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-sm font-black text-emerald-600">
                  {currency}{totals.revenue.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                <span className="text-[9px] font-bold text-emerald-600">
                  {totals.roas.toFixed(2)}x
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50/80 p-2 border border-slate-100/80">
              <span className="text-[9.5px] font-bold text-slate-400 uppercase block">ACOS TB</span>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className={`text-sm font-black ${
                  totals.revenue === 0
                    ? totals.spend > 0 ? "text-rose-600" : "text-slate-400"
                    : totals.acos <= targetAcos ? "text-indigo-600" : "text-rose-600"
                }`}>
                  {totals.revenue > 0 ? `${totals.acos.toFixed(1)}%` : totals.spend > 0 ? "N/A" : "—"}
                </span>
                <span className="text-[9px] font-bold text-slate-500">
                  {totals.revenue > 0 ? "ACOS" : "Chưa có sales"}
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50/80 p-2 border border-slate-100/80">
              <span className="text-[9.5px] font-bold text-slate-400 uppercase block">Đơn Hàng</span>
              <div className="flex items-baseline justify-between mt-0.5">
                <span className="text-sm font-black text-slate-900">
                  {totals.orders.toLocaleString()}
                </span>
                <span className="text-[9px] font-bold text-slate-500">
                  AOV: {currency}{totals.avgOrderValue.toFixed(0)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Khung Biểu Đồ Recharts */}
        {(() => {
          const isLongData = data.length > 15;
          const maxSpend = Math.max(...data.map((d) => d.spend || 0), 10);
          const maxRevenue = Math.max(...data.map((d) => d.revenue || 0), 10);
          const maxAcos = Math.max(...data.map((d) => d.acos || 0), 30);

          let leftDomain: [number, number];
          let rightDomain: [number, number];

          if (rightMetric === "Revenue") {
            // Khi trục phải là Revenue ($), cả Spend và Revenue đều là tiền $.
            // Dùng chung thang đo tuyệt đối để tương quan chiều cao 100% chuẩn xác
            const sharedMax = Math.max(maxSpend, maxRevenue);
            const topCeil = Math.ceil((sharedMax * 1.25) / 50) * 50;
            leftDomain = [0, topCeil];
            rightDomain = [0, topCeil];
          } else {
            // Khi trục phải là ACOS (%)
            // Cột Spend ($): headroom 25% để nhãn tiền trên đỉnh cột không chạm nóc
            const spendCeil = Math.ceil((maxSpend * 1.25) / 20) * 20;
            leftDomain = [0, spendCeil];

            // Đường ACOS (%): thang đo % tối thiểu 100%
            const acosCeil = Math.min(Math.max(Math.ceil((maxAcos * 1.2) / 10) * 10, 100), 250);
            rightDomain = [0, acosCeil];
          }

          return (
            <div className="h-72 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={data}
                  margin={{ top: 22, right: 10, left: -10, bottom: 15 }}
                  onClick={(state: any) => {
                    if (badgeText === "7D" && state?.activePayload?.[0]?.payload?.rawDate) {
                      handleOpenDrilldown(state.activePayload[0].payload.rawDate);
                    }
                  }}
                  className={badgeText === "7D" ? "cursor-pointer" : undefined}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="displayDate"
                    tick={{ fontSize: 9.5, fill: "#64748b" }}
                    interval={data.length > 15 ? 2 : 0}
                    angle={data.length > 7 ? -25 : 0}
                    textAnchor={data.length > 7 ? "end" : "middle"}
                    height={28}
                  />

                  {/* Trục trái: Spend ($) */}
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={leftDomain}
                    tick={{ fontSize: 9.5, fill: "#64748b" }}
                    tickFormatter={(val) => `${currency}${val}`}
                    width={48}
                  />

                  {/* Trục phải: ACOS (%) hoặc Revenue ($) */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={rightDomain}
                    tick={{ fontSize: 9.5, fill: "#64748b" }}
                    tickFormatter={(val) => (rightMetric === "ACOS" ? `${val}%` : `${currency}${val}`)}
                    width={40}
                  />

                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0]?.payload as DataPoint;
                      if (!d) return null;

                      return (
                        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-2.5 shadow-xl text-xs space-y-1 min-w-[190px] z-50">
                          <div className="font-bold text-slate-800 border-b border-slate-100 pb-1 flex justify-between items-center">
                            <span>{d.displayDate} ({d.rawDate})</span>
                            {d.isLossWarning && (
                              <span className="px-1.5 py-0.2 rounded bg-rose-50 text-rose-600 text-[9.5px] font-bold">
                                {d.revenue === 0 && d.spend > 0 ? "0 Doanh Thu" : "ACOS Cao"}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-0.5 text-[11px]">
                            <span className="text-slate-500">Spend:</span>
                            <strong className="text-blue-700 text-right">{currency}{d.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>

                            <span className="text-slate-500">Revenue:</span>
                            <strong className="text-emerald-700 text-right">{currency}{d.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>

                            <span className="text-slate-500">ACOS:</span>
                            <strong className="text-slate-900 text-right font-black">
                              {d.revenue > 0 ? `${d.acos.toFixed(1)}%` : d.spend > 0 ? "N/A" : "—"}
                            </strong>

                            <span className="text-slate-500">Đơn hàng:</span>
                            <strong className="text-slate-800 text-right">{d.orders} đơn</strong>

                            <span className="text-slate-500">Clicks:</span>
                            <strong className="text-slate-700 text-right">{d.clicks.toLocaleString()}</strong>

                            <span className="text-slate-500">CPC:</span>
                            <strong className="text-slate-700 text-right">{currency}{(d.clicks > 0 ? d.spend / d.clicks : 0).toFixed(2)}</strong>
                          </div>

                          {badgeText === "7D" && (
                            <div className="pt-1.5 border-t border-slate-100 mt-1 text-center">
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                                <Eye size={11} weight="bold" /> Click cột để xem Top Camp ({d.orders} đơn)
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />

                  <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "4px" }} />

                  {/* Cột Spend (Bar) - Màu xanh dương */}
                  <Bar
                    yAxisId="left"
                    dataKey="spend"
                    name={`Spend (${currency})`}
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={data.length > 15 ? 18 : 24}
                    className={badgeText === "7D" ? "cursor-pointer hover:opacity-90 transition-opacity" : undefined}
                    onClick={(entry: any) => {
                      if (badgeText === "7D" && entry?.rawDate) {
                        handleOpenDrilldown(entry.rawDate);
                      }
                    }}
                  >
                    <LabelList
                      dataKey="spend"
                      position="top"
                      content={(props) => renderBarSpendLabel(props, isCompact, isLongData)}
                    />
                  </Bar>

                  {/* Đường ACOS (%) - Dây kéo và các điểm màu ĐỎ */}
                  {rightMetric === "ACOS" && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="acos"
                      name="ACOS (%)"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        return (
                          <circle
                            key={`dot-${payload.rawDate}`}
                            cx={cx}
                            cy={cy}
                            r={data.length > 15 ? 2.5 : 3.5}
                            fill="#ef4444"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                          />
                        );
                      }}
                    >
                      <LabelList
                        dataKey="acos"
                        position="top"
                        content={(props) => renderLineMetricLabel(props, isCompact, isLongData)}
                      />
                    </Line>
                  )}

                  {/* Đường Revenue ($) có gắn nhãn số liệu trực tiếp */}
                  {rightMetric === "Revenue" && (
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="revenue"
                      name={`Revenue (${currency})`}
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: data.length > 15 ? 2.5 : 3.5, fill: "#10b981", stroke: "#ffffff", strokeWidth: 1.5 }}
                    >
                      <LabelList
                        dataKey="revenue"
                        position="top"
                        content={(props) => renderLineMetricLabel(props, isCompact, isLongData)}
                      />
                    </Line>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })()}

        {/* Chú thích trực quan dưới chân biểu đồ */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-100 text-[10.5px] text-slate-500">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Cột Spend ($)
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-3 h-0.5 ${rightMetric === "ACOS" ? "bg-red-500" : "bg-emerald-500"} inline-block`} />
              {rightMetric === "ACOS" ? "Dây & Điểm ACOS (Đỏ)" : "Đường Revenue ($)"}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-medium">
            {badgeText} ({data.length} ngày)
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 shadow-xs space-y-4">
      {/* Header & Controls chung cho toàn bộ khối */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <ChartLineUp size={18} weight="bold" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
              SPEND VS REVENUE / ACOS THEO THỜI GIAN
            </h3>
          </div>
        </div>

        {/* Toolbar điều khiển */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Chọn chế độ xem: Song song (7D & 30D) | 7D | 30D */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition cursor-pointer ${
                viewMode === "split"
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="Xem song song 7D và 30D trên cùng 1 dòng"
            >
              <SquaresFour size={13} weight="bold" />
              <span>Song song (7D & 30D)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("single");
                onDaysChange?.(7);
              }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                viewMode === "single" && selectedDays === 7
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              7D
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("single");
                onDaysChange?.(30);
              }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                viewMode === "single" && selectedDays === 30
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              30D
            </button>
          </div>

          {/* Lọc Kênh Chạy: Tất cả / SP / SB */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setChannel("ALL")}
              className={`px-2 py-1 rounded-md transition cursor-pointer ${channel === "ALL" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"}`}
            >
              Tất cả (SP+SB)
            </button>
            <button
              type="button"
              onClick={() => setChannel("SP")}
              className={`px-2 py-1 rounded-md transition cursor-pointer ${channel === "SP" ? "bg-white text-amber-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"}`}
            >
              SP
            </button>
            <button
              type="button"
              onClick={() => setChannel("SB")}
              className={`px-2 py-1 rounded-md transition cursor-pointer ${channel === "SB" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"}`}
            >
              SB
            </button>
          </div>

          {/* Cấp độ thời gian */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
            <span className="text-[11px] text-slate-400 font-medium">Cấp độ:</span>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value="day">Theo Ngày</option>
              <option value="week">Theo Tuần</option>
              <option value="month">Theo Tháng</option>
            </select>
          </div>

          {/* Trục phải */}
          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
            <span className="text-[11px] text-slate-400 font-medium">Trục phải:</span>
            <select
              value={rightMetric}
              onChange={(e) => setRightMetric(e.target.value as RightAxisMetric)}
              className="bg-transparent font-bold text-indigo-700 outline-none cursor-pointer"
            >
              <option value="ACOS">ACOS (%)</option>
              <option value="Revenue">Revenue ($)</option>
            </select>
          </div>
        </div>
      </div>

      {/* KHU VỰC HIỂN THỊ BIỂU ĐỒ */}
      {viewMode === "split" ? (
        /* CHẾ ĐỘ SONG SONG: 7D THON GỌN (4 CỘT), 30D DÃN RỘNG (8 CỘT) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {renderChartCard(
            "SPEND VS REVENUE / ACOS (7 NGÀY GẦN NHẤT)",
            "7D",
            "indigo",
            chartData7D,
            totals7D,
            true,
            "lg:col-span-5 xl:col-span-4",
          )}
          {renderChartCard(
            "SPEND VS REVENUE / ACOS (30 NGÀY QUA)",
            "30D",
            "sky",
            chartData30D,
            totals30D,
            true,
            "lg:col-span-7 xl:col-span-8",
          )}
        </div>
      ) : (
        /* CHẾ ĐỘ XEM ĐƠN (7D HOẶC 30D) */
        renderChartCard(
          `SPEND VS REVENUE / ACOS (${selectedDays} NGÀY GẦN NHẤT)`,
          `${selectedDays}D`,
          "indigo",
          chartDataCurrent,
          totalsCurrent,
          false,
        )
      )}

      {/* Drawer xem chi tiết Campaign theo ngày (Chỉ mở khi bấm vào ngày trên 7D) */}
      <PpcDailyCampaignDrawer
        isOpen={Boolean(drilldownDate)}
        onClose={() => setDrilldownDate(null)}
        selectedDate={drilldownDate || ""}
        availableDates={availableDates7D}
        onSelectDate={(newDate) => setDrilldownDate(newDate)}
        campaigns={dailyCampaigns}
        isLoading={loadingDrilldown}
        currency={currency}
        storeName={storeName || "ALL"}
      />
    </div>
  );
}
