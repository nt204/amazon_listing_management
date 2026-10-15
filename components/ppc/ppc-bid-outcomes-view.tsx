"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  XCircle,
  Clock,
  Sparkle,
  TrendUp,
  TrendDown,
  Info,
  Funnel,
  ShieldCheck,
  Calculator,
  X,
  MagnifyingGlass,
  Check,
  ArrowRight,
} from "@phosphor-icons/react";
import {
  ActionDecisionSupportModal,
  getWindowEvaluation,
  getOverallStatus,
  type WindowDetail,
  type BidOutcomeActionItem,
} from "./ppc-auto-bid-results-modal";

export type WindowOutcomeDetail = WindowDetail;
export type GroupedActionOutcomeItem = BidOutcomeActionItem;

interface OutcomeSummary {
  total: number;
  totalFiltered?: number;
  mature: number;
  observing: number;
  superseded: number;
  interrupted?: number;
  insufficientData: number;
  positive: number;
  neutral: number;
  negative: number;
  eligibleForLearning: number;
  totalRewardUsd: number;
  winRate: number | null;
}

export function formatUsd(val: number | string | null | undefined, showPlus = false): string {
  if (val === null || val === undefined) return "—";
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  if (isNaN(num)) return "—";
  const abs = Math.abs(num).toFixed(2);
  if (num < 0) {
    return `-$${abs}`;
  }
  if (showPlus && num > 0) {
    return `+$${abs}`;
  }
  return `$${abs}`;
}

interface PpcBidOutcomesViewProps {
  selectedStore: string;
}

export function PpcBidOutcomesView({ selectedStore }: PpcBidOutcomesViewProps) {
  const [items, setItems] = useState<GroupedActionOutcomeItem[]>([]);
  const [summary, setSummary] = useState<OutcomeSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [evaluating, setEvaluating] = useState<boolean>(false);
  const [selectedAuditItem, setSelectedAuditItem] = useState<GroupedActionOutcomeItem | null>(null);

  // Filters
  const [labelFilter, setLabelFilter] = useState<string>("ALL");
  const [eligibleOnly, setEligibleOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedStore && selectedStore !== "ALL") {
        params.set("storeName", selectedStore);
      }
      if (labelFilter !== "ALL") {
        params.set("label", labelFilter);
      }
      if (eligibleOnly) {
        params.set("eligibleForLearning", "true");
      }
      params.set("limit", "250");

      const res = await fetch(`/api/ppc/action-outcomes?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải kết quả đánh giá đổi bid");
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
        setSummary(json.data.summary || null);
      }
    } catch (err) {
      console.error("Load outcomes error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedStore, labelFilter, eligibleOnly]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleEvaluateNow = async () => {
    setEvaluating(true);
    try {
      const res = await fetch("/api/ppc/action-outcomes", { method: "POST" });
      if (!res.ok) throw new Error("Chạy đánh giá thất bại");
      await loadData();
    } catch (err) {
      console.error("Run evaluation error:", err);
    } finally {
      setEvaluating(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(
      (item) =>
        (item.target_keyword || "").toLowerCase().includes(q) ||
        (item.sku || "").toLowerCase().includes(q) ||
        (item.campaign_name || "").toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const getDaysElapsed = useCallback((item: GroupedActionOutcomeItem) => {
    const ts = item.action_timestamp || item.applied_on;
    if (!ts) return 0;
    const t = new Date(ts).getTime();
    if (isNaN(t) || t === 0) return 0;
    const now = Date.now();
    return Math.max(0, Math.floor((now - t) / (1000 * 60 * 60 * 24)));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 font-bold text-lg">
              <Calculator size={22} weight="bold" />
            </span>
            <h2 className="text-lg font-black text-slate-900 tracking-tight">
              Đánh Giá Kết Quả Đổi Bid (7D & 30D Unified Outcomes)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Một hàng duy nhất cho mỗi hành động đổi bid, tích hợp đồng thời cửa sổ <b>7D (ngắn hạn)</b> và <b>30D (dài hạn)</b> chuẩn bị dữ liệu trajectory cho AI model.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            <ArrowsClockwise size={15} className={loading ? "animate-spin" : ""} />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            onClick={handleEvaluateNow}
            disabled={evaluating}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            <Sparkle size={15} weight="fill" className={evaluating ? "animate-spin" : ""} />
            <span>{evaluating ? "Đang quét đánh giá..." : "Chạy Đánh Giá Ngay"}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Actions */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hành Động Đổi Bid</span>
            <span className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
              <Clock size={16} />
            </span>
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {summary ? summary.total.toLocaleString("vi-VN") : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-2">
            <span>Đã chốt: <b className="text-indigo-600">{summary?.mature ?? 0}</b></span>
            <span>•</span>
            <span>Đang theo dõi: <b className="text-blue-600">{summary?.observing ?? 0}</b></span>
            <span>•</span>
            <span>Bị ghi đè: <b className="text-amber-600">{summary?.superseded ?? 0}</b></span>
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tỷ Lệ Thắng (Win Rate)</span>
            <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendUp size={16} weight="bold" />
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            {summary?.winRate !== null && summary?.winRate !== undefined
              ? `${summary.winRate.toFixed(1)}%`
              : "N/A"}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
            <span className="text-emerald-700 font-bold">🟢 {summary?.positive ?? 0} Thắng</span>
            <span>•</span>
            <span className="text-rose-700 font-bold">🔴 {summary?.negative ?? 0} Thua</span>
            <span>•</span>
            <span className="text-slate-600 font-bold">⚪ {summary?.neutral ?? 0} Hòa</span>
          </div>
        </div>

        {/* Net Contribution Reward */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lợi Nhuận Thêm (Reward)</span>
            <span className={`p-1.5 rounded-lg ${(summary?.totalRewardUsd ?? 0) >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
              {(summary?.totalRewardUsd ?? 0) >= 0 ? <TrendUp size={16} /> : <TrendDown size={16} />}
            </span>
          </div>
          <div className={`text-2xl font-black mt-2 ${(summary?.totalRewardUsd ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {formatUsd(summary?.totalRewardUsd ?? 0, true)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Tổng giá trị thặng dư thực tế vượt trên mức kỳ vọng
          </div>
        </div>

        {/* AI Learning Dataset */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Chuẩn Học AI</span>
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <ShieldCheck size={16} weight="bold" />
            </span>
          </div>
          <div className="text-2xl font-black text-indigo-600 mt-2">
            {summary ? summary.eligibleForLearning.toLocaleString("vi-VN") : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Đã thanh lọc nhiễu & ghi đè (Dữ liệu học tập sạch)
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setLabelFilter("ALL")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "ALL" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600"
              }`}
            >
              Tất cả nhãn
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("POSITIVE")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "POSITIVE" ? "bg-emerald-600 text-white shadow-xs" : "text-emerald-700"
              }`}
            >
              🟢 Positive
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("NEUTRAL")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "NEUTRAL" ? "bg-slate-700 text-white shadow-xs" : "text-slate-700"
              }`}
            >
              ⚪ Neutral
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("NEGATIVE")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "NEGATIVE" ? "bg-rose-600 text-white shadow-xs" : "text-rose-700"
              }`}
            >
              🔴 Negative
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("OBSERVING")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "OBSERVING" ? "bg-blue-600 text-white shadow-xs" : "text-blue-700"
              }`}
            >
              🔵 Đang chờ
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("INSUFFICIENT_DATA")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "INSUFFICIENT_DATA" ? "bg-amber-600 text-white shadow-xs" : "text-amber-700"
              }`}
            >
              🟡 Thiếu Data
            </button>
            <button
              type="button"
              onClick={() => setLabelFilter("INTERRUPTED")}
              className={`px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition ${
                labelFilter === "INTERRUPTED" || labelFilter === "SUPERSEDED" ? "bg-amber-600 text-white shadow-xs" : "text-amber-700"
              }`}
            >
              🟠 Bị cắt
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none ml-2">
            <input
              type="checkbox"
              checked={eligibleOnly}
              onChange={(e) => setEligibleOnly(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
            />
            <span>Chỉ lấy mẫu học AI</span>
          </label>
        </div>

        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo keyword, SKU..."
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Main Unified Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4">Từ khóa / Target</th>
                <th className="py-3.5 px-3">Đổi Bid</th>
                <th className="py-3.5 px-3 text-center">3D</th>
                <th className="py-3.5 px-3 text-center">7D</th>
                <th className="py-3.5 px-3 text-center">14D</th>
                <th className="py-3.5 px-3 text-center">30D</th>
                <th className="py-3.5 px-4 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <ArrowsClockwise size={24} className="animate-spin mx-auto mb-2 text-indigo-500" />
                    Đang nạp dữ liệu đánh giá 3D, 7D, 14D & 30D...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Không có hành động nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const deltaPct = item.applied_delta_pct ?? (
                    item.old_value && item.final_value
                      ? ((Number(item.final_value) - Number(item.old_value)) / Number(item.old_value)) * 100
                      : 0
                  );
                  const daysElapsed = getDaysElapsed(item);
                  const overallStatus = getOverallStatus(item, daysElapsed);

                  const ev3 = getWindowEvaluation(item.d3, 3, daysElapsed);
                  const ev7 = getWindowEvaluation(item.d7, 7, daysElapsed);
                  const ev14 = getWindowEvaluation(item.d14, 14, daysElapsed);
                  const ev30 = getWindowEvaluation(item.d30, 30, daysElapsed);

                  return (
                    <tr key={item.action_id} className="hover:bg-slate-50/80 transition">
                      {/* Keyword & Target */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-slate-900 truncate" title={item.target_keyword}>
                            {item.target_keyword || item.target_id}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black border shrink-0 ${overallStatus.color}`}>
                            {overallStatus.badge}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.2 bg-slate-100 rounded text-[10px] font-bold">
                            {item.match_type || "Keyword"}
                          </span>
                          <span className="font-semibold text-slate-700">{item.sku || "N/A"}</span>
                          <span className="text-slate-300">•</span>
                          <span className="truncate max-w-[130px]" title={item.campaign_name}>
                            {item.campaign_name}
                          </span>
                        </div>
                      </td>

                      {/* Bid Change */}
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-xs">
                        <div className="font-extrabold text-slate-900">
                          ${Number(item.old_value || 0).toFixed(2)} → ${Number(item.final_value || 0).toFixed(2)}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 font-sans">
                          <span className={`text-[10px] font-bold ${deltaPct < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                          </span>
                          {item.applied_on && (
                            <span className="text-[10px] text-slate-400">• {item.applied_on}</span>
                          )}
                        </div>
                      </td>

                      {/* 3D Window Column */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border transition ${ev3.color}`}
                          title={ev3.tip}
                        >
                          {ev3.label}
                        </span>
                      </td>

                      {/* 7D Window Column */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border transition ${ev7.color}`}
                          title={ev7.tip}
                        >
                          {ev7.label}
                        </span>
                      </td>

                      {/* 14D Window Column */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border transition ${ev14.color}`}
                          title={ev14.tip}
                        >
                          {ev14.label}
                        </span>
                      </td>

                      {/* 30D Window Column */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold border transition ${ev30.color}`}
                          title={ev30.tip}
                        >
                          {ev30.label}
                        </span>
                      </td>

                      {/* Action Modal Trigger */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedAuditItem(item)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs transition cursor-pointer"
                        >
                          Chi tiết
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Support & Before-After Modal */}
      {selectedAuditItem && (
        <ActionDecisionSupportModal
          action={selectedAuditItem}
          onClose={() => setSelectedAuditItem(null)}
        />
      )}
    </div>
  );
}
