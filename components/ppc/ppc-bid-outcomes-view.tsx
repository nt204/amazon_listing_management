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
} from "@phosphor-icons/react";

export interface WindowOutcomeDetail {
  outcome_id: string;
  window_days: number;
  status: string; // 'OBSERVING' | 'PROVISIONAL' | 'MATURE' | 'CONTAMINATED' | 'INSUFFICIENT_DATA'
  outcome_label: string | null; // 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null
  observation_start: string;
  observation_end: string;
  maturity_date: string | null;
  observed: Record<string, any>;
  comparison: {
    reward_usd?: number | null;
    reward_norm?: number | null;
    t_threshold?: number | null;
    applied_delta_pct?: number | null;
    actual_contribution?: number | null;
    expected_contribution?: number | null;
    expected_source?: string | null;
    control_count?: number;
    control_shift_w?: number;
  };
  evidence_quality: {
    spec_label?: string | null;
    validity?: string | null;
    baseline_quality?: string | null;
    reason_codes?: string[];
    confound_flags?: string[];
    eligible_for_learning?: boolean;
    end_clean_observation?: string | null;
    interrupted_by_action_id?: string | null;
    superseded_by_action_id?: string | null;
    label_version?: number;
    evaluator_version?: string;
  };
  evaluated_at: string | null;
}

export interface GroupedActionOutcomeItem {
  action_id: string;
  store_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  target_id: string;
  target_keyword: string;
  match_type: string;
  sku: string;
  old_value: string | number;
  system_suggested_value: string | number;
  final_value: string | number;
  applied_delta_pct: number;
  action_status: string;
  approved_by: string | null;
  applied_on: string;
  baseline: Record<string, any>;
  d7: WindowOutcomeDetail | null;
  d30: WindowOutcomeDetail | null;
  eligible_for_learning: boolean;
  evaluated_at: string | null;
}

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

  const renderBadge = (w: WindowOutcomeDetail | null) => {
    if (!w) return <span className="text-slate-300 font-mono text-[10px]">—</span>;

    const isInterrupted =
      w.status === "INTERRUPTED" ||
      w.status === "SUPERSEDED" ||
      w.evidence_quality?.validity === "INTERRUPTED" ||
      w.evidence_quality?.validity === "SUPERSEDED";

    if (isInterrupted) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black"
          title={`Bị action mới cắt ngang vào ngày ${w.evidence_quality?.end_clean_observation || ""}`}
        >
          🟠 BỊ CẮT
        </span>
      );
    }

    const label = w.outcome_label || w.evidence_quality?.spec_label;
    if (label === "POSITIVE") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black">
          <CheckCircle size={11} weight="fill" />
          POSITIVE
          {w.status === "PROVISIONAL" && <span className="text-[9px] font-medium text-emerald-600 opacity-80">(tạm)</span>}
        </span>
      );
    }
    if (label === "NEGATIVE") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black">
          <XCircle size={11} weight="fill" />
          NEGATIVE
          {w.status === "PROVISIONAL" && <span className="text-[9px] font-medium text-rose-600 opacity-80">(tạm)</span>}
        </span>
      );
    }
    if (label === "NEUTRAL") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-black">
          ⚪ NEUTRAL
          {w.status === "PROVISIONAL" && <span className="text-[9px] font-medium text-slate-500 opacity-80">(tạm)</span>}
        </span>
      );
    }
    if (w.status === "OBSERVING" || w.status === "PENDING") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
          <Clock size={11} />
          OBSERVING
        </span>
      );
    }
    if (w.status === "INSUFFICIENT_DATA" || w.evidence_quality?.validity === "INCONCLUSIVE") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
          <WarningCircle size={11} />
          INCONCLUSIVE
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">
        CONFOUNDED
      </span>
    );
  };

  const renderWindowCell = (w: WindowOutcomeDetail | null) => {
    if (!w) {
      return <div className="text-slate-300 font-mono text-center text-xs">—</div>;
    }

    const actual = w.comparison?.actual_contribution;
    const expected = w.comparison?.expected_contribution;
    const reward = w.comparison?.reward_usd;

    return (
      <div className="space-y-1 min-w-[130px]">
        <div className="flex items-center justify-between gap-1.5">
          {renderBadge(w)}
          {reward !== null && reward !== undefined ? (
            <span
              className={`font-mono font-black text-xs shrink-0 ${
                reward > 0 ? "text-emerald-600" : reward < 0 ? "text-rose-600" : "text-slate-600"
              }`}
            >
              {formatUsd(reward, true)}
            </span>
          ) : (
            <span className="text-slate-400 font-mono text-xs">—</span>
          )}
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5">
          <span>
            Act:{" "}
            <b className="text-slate-800">
              {formatUsd(actual)}
            </b>
          </span>
          <span>
            Exp:{" "}
            <span className="text-slate-600 font-bold">
              {formatUsd(expected)}
            </span>
          </span>
        </div>

        {w.evidence_quality?.end_clean_observation &&
          (w.evidence_quality?.validity === "SUPERSEDED" || w.evidence_quality?.validity === "INTERRUPTED") && (
            <div className="text-[9px] text-amber-700 font-semibold" title={`Bị action mới ghi đè từ ${w.evidence_quality.end_clean_observation}`}>
              Đè từ: {w.evidence_quality.end_clean_observation.slice(5)}
            </div>
          )}
      </div>
    );
  };

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
                <th className="py-3.5 px-3">SKU</th>
                <th className="py-3.5 px-3">Đổi Bid</th>
                <th className="py-3.5 px-3">Baseline 30D</th>
                <th className="py-3.5 px-3 bg-indigo-50/40 border-l border-indigo-100">
                  <div className="text-indigo-900 font-black">Cửa Sổ 7D (Ngắn Hạn)</div>
                  <div className="text-[10px] text-indigo-500 font-semibold lowercase">reward / actual / expected</div>
                </th>
                <th className="py-3.5 px-3 bg-purple-50/40 border-l border-purple-100">
                  <div className="text-purple-900 font-black">Cửa Sổ 30D (Dài Hạn)</div>
                  <div className="text-[10px] text-purple-500 font-semibold lowercase">reward / actual / expected</div>
                </th>
                <th className="py-3.5 px-3 text-center">Học AI</th>
                <th className="py-3.5 px-4 text-center">Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <ArrowsClockwise size={24} className="animate-spin mx-auto mb-2 text-indigo-500" />
                    Đang nạp dữ liệu đánh giá 7D & 30D...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
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
                  const isEligible = item.eligible_for_learning === true;

                  return (
                    <tr key={item.action_id} className="hover:bg-slate-50/80 transition">
                      {/* Keyword */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-extrabold text-slate-900 truncate" title={item.target_keyword}>
                          {item.target_keyword || item.target_id}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.2 bg-slate-100 rounded text-[10px] font-bold">
                            {item.match_type || "Keyword"}
                          </span>
                          <span className="truncate max-w-[130px]" title={item.campaign_name}>
                            {item.campaign_name}
                          </span>
                        </div>
                      </td>

                      {/* SKU */}
                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-700">{item.sku || "N/A"}</span>
                      </td>

                      {/* Bid Change */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-extrabold text-slate-900">
                          ${Number(item.old_value || 0).toFixed(2)} → ${Number(item.final_value || 0).toFixed(2)}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-[10px] font-bold ${deltaPct < 0 ? "text-blue-600" : "text-emerald-600"}`}>
                            {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%
                          </span>
                          <span className="text-[10px] text-slate-400">• {item.applied_on}</span>
                        </div>
                      </td>

                      {/* Baseline 30D */}
                      <td className="py-3 px-3 font-mono text-[11px] whitespace-nowrap">
                        <div className="font-bold text-slate-800">
                          {formatUsd(item.baseline?.contribution)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {item.baseline?.clicks ?? 0} clicks • ${Number(item.baseline?.spend ?? 0).toFixed(0)} sp
                        </div>
                      </td>

                      {/* 7D Window Column */}
                      <td className="py-3 px-3 bg-indigo-50/20 border-l border-indigo-100/60">
                        {renderWindowCell(item.d7)}
                      </td>

                      {/* 30D Window Column */}
                      <td className="py-3 px-3 bg-purple-50/20 border-l border-purple-100/60">
                        {renderWindowCell(item.d30)}
                      </td>

                      {/* AI Eligible */}
                      <td className="py-3 px-3 text-center">
                        {isEligible ? (
                          <span
                            className="inline-flex items-center justify-center p-1 rounded-full bg-emerald-100 text-emerald-700"
                            title="Đạt tiêu chuẩn 100% sạch huấn luyện AI"
                          >
                            <Check size={14} weight="bold" />
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
                      </td>

                      {/* Audit Modal trigger */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedAuditItem(item)}
                          className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition cursor-pointer"
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

      {/* Audit Modal (Step-by-Step Explanation for BOTH 7D & 30D) */}
      {selectedAuditItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-3xl rounded-3xl border border-slate-200 shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-2xl bg-indigo-100 text-indigo-700">
                  <Calculator size={24} weight="bold" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Đối Chiếu & Giải Trình Toàn Diện (7D vs 30D Trajectory)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mô hình kinh tế lượng so sánh song song ngắn hạn và dài hạn cho cùng một quyết định đổi bid
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuditItem(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto text-xs">
              {/* Meta info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Target Keyword</span>
                  <div className="font-extrabold text-slate-900 truncate mt-0.5" title={selectedAuditItem.target_keyword}>
                    {selectedAuditItem.target_keyword}
                  </div>
                  <div className="text-[10px] text-slate-500">{selectedAuditItem.match_type}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">SKU / Store</span>
                  <div className="font-extrabold text-slate-900 mt-0.5">{selectedAuditItem.sku || "N/A"}</div>
                  <div className="text-[10px] text-slate-500">{selectedAuditItem.store_id}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Đổi Bid</span>
                  <div className="font-extrabold text-slate-900 mt-0.5">
                    ${Number(selectedAuditItem.old_value).toFixed(2)} → ${Number(selectedAuditItem.final_value).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500">{selectedAuditItem.applied_on}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Học AI Training</span>
                  <div className="mt-0.5">
                    {selectedAuditItem.eligible_for_learning ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-extrabold text-xs">
                        <Check size={14} weight="bold" /> Sạch 100%
                      </span>
                    ) : (
                      <span className="text-amber-700 font-bold text-xs">Chưa đủ điều kiện</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Superseded Notice if applicable */}
              {(selectedAuditItem.d30?.evidence_quality?.validity === "SUPERSEDED" ||
                selectedAuditItem.d7?.evidence_quality?.validity === "SUPERSEDED") && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
                  <div className="font-extrabold flex items-center gap-1.5 text-amber-900">
                    <WarningCircle size={16} weight="fill" />
                    <span>Hành Động Bị Ghi Đè Bởi Action Mới (SUPERSEDED)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Target này xuất hiện action đổi bid mới vào ngày{" "}
                    <b>{selectedAuditItem.d30?.evidence_quality?.end_clean_observation || selectedAuditItem.d7?.evidence_quality?.end_clean_observation}</b>.
                    Chu kỳ quan sát sạch kết thúc tại thời điểm đó và cửa sổ dài hạn bị nhiễu do tác động của bid mới.
                    Hành động này được gắn nhãn <b>BỊ GHI ĐÈ</b> để hệ thống AI không học nhầm tín hiệu lẫn lộn.
                  </p>
                </div>
              )}

              {/* Step 1: FACTS COMPARISON */}
              <div className="p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="font-black text-slate-900 text-xs flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">1</span>
                  SỐ LIỆU GỐC AMAZON (FACTS): BASELINE VS D7 VS D30
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px]">
                  {/* Baseline Facts */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                    <div className="font-bold text-slate-700 mb-1 flex items-center justify-between">
                      <span>Baseline 30 ngày trước:</span>
                    </div>
                    <div>Clicks: <b>{selectedAuditItem.baseline?.clicks ?? 0}</b></div>
                    <div>Orders: <b>{selectedAuditItem.baseline?.orders ?? 0}</b></div>
                    <div>Spend: <b>${Number(selectedAuditItem.baseline?.spend ?? 0).toFixed(2)}</b></div>
                    <div>Sales: <b>${Number(selectedAuditItem.baseline?.sales ?? 0).toFixed(2)}</b></div>
                    <div>Contribution: <b>${Number(selectedAuditItem.baseline?.contribution ?? 0).toFixed(2)}</b></div>
                  </div>

                  {/* D7 Observed Facts */}
                  <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100">
                    <div className="font-bold text-indigo-900 mb-1 flex items-center justify-between">
                      <span>Sau áp dụng 7 ngày (D7):</span>
                      {renderBadge(selectedAuditItem.d7)}
                    </div>
                    {selectedAuditItem.d7?.comparison?.actual_contribution !== null && selectedAuditItem.d7?.comparison?.actual_contribution !== undefined ? (
                      <>
                        <div>Clicks: <b>{selectedAuditItem.d7?.observed?.clicks ?? 0}</b></div>
                        <div>Orders: <b>{selectedAuditItem.d7?.observed?.orders ?? 0}</b></div>
                        <div>Spend: <b>${Number(selectedAuditItem.d7?.observed?.spend ?? 0).toFixed(2)}</b></div>
                        <div>Sales: <b>${Number(selectedAuditItem.d7?.observed?.sales ?? 0).toFixed(2)}</b></div>
                        <div>Contribution: <b>${Number(selectedAuditItem.d7?.observed?.contribution ?? 0).toFixed(2)}</b></div>
                      </>
                    ) : (
                      <div className="text-amber-700 py-2">
                        ⏳ Đang quan sát (kết thúc {selectedAuditItem.d7?.observation_end})
                      </div>
                    )}
                  </div>

                  {/* D30 Observed Facts */}
                  <div className="p-3 bg-purple-50/50 rounded-xl border border-purple-100">
                    <div className="font-bold text-purple-900 mb-1 flex items-center justify-between">
                      <span>Sau áp dụng 30 ngày (D30):</span>
                      {renderBadge(selectedAuditItem.d30)}
                    </div>
                    {selectedAuditItem.d30?.comparison?.actual_contribution !== null && selectedAuditItem.d30?.comparison?.actual_contribution !== undefined ? (
                      <>
                        <div>Clicks: <b>{selectedAuditItem.d30?.observed?.clicks ?? 0}</b></div>
                        <div>Orders: <b>{selectedAuditItem.d30?.observed?.orders ?? 0}</b></div>
                        <div>Spend: <b>${Number(selectedAuditItem.d30?.observed?.spend ?? 0).toFixed(2)}</b></div>
                        <div>Sales: <b>${Number(selectedAuditItem.d30?.observed?.sales ?? 0).toFixed(2)}</b></div>
                        <div>Contribution: <b>${Number(selectedAuditItem.d30?.observed?.contribution ?? 0).toFixed(2)}</b></div>
                      </>
                    ) : (
                      <div className="text-amber-700 py-2">
                        ⏳ Đang quan sát (kết thúc {selectedAuditItem.d30?.observation_end})
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 2: CONTRIBUTION FORMULAS */}
              <div className="p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="font-black text-slate-900 text-xs flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">2</span>
                  KỲ VỌNG (EXPECTED) VS THỰC TẾ (ACTUAL) CONTRIBUTION
                </div>

                <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 font-mono text-[11px]">
                  <div>Công thức chung: <b>Contribution = Sales × Margin - Spend</b></div>
                  <div>• Baseline/ngày: <b>${(Number(selectedAuditItem.baseline?.contribution ?? 0) / 30).toFixed(2)} / ngày</b></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                  {/* D7 Comparison */}
                  <div className="p-3 bg-indigo-50/40 rounded-xl border border-indigo-100 space-y-1">
                    <div className="font-bold text-indigo-950">Cửa Sổ D7 (7 Ngày):</div>
                    <div>• Expected Kỳ vọng: <b>{formatUsd(selectedAuditItem.d7?.comparison?.expected_contribution)}</b></div>
                    <div>• Actual Thực tế: <b>{selectedAuditItem.d7?.comparison?.actual_contribution !== null && selectedAuditItem.d7?.comparison?.actual_contribution !== undefined ? formatUsd(selectedAuditItem.d7?.comparison?.actual_contribution) : "Chưa kết thúc cửa sổ"}</b></div>
                  </div>

                  {/* D30 Comparison */}
                  <div className="p-3 bg-purple-50/40 rounded-xl border border-purple-100 space-y-1">
                    <div className="font-bold text-purple-950">Cửa Sổ D30 (30 Ngày):</div>
                    <div>• Expected Kỳ vọng: <b>{formatUsd(selectedAuditItem.d30?.comparison?.expected_contribution)}</b></div>
                    <div>• Actual Thực tế: <b>{selectedAuditItem.d30?.comparison?.actual_contribution !== null && selectedAuditItem.d30?.comparison?.actual_contribution !== undefined ? formatUsd(selectedAuditItem.d30?.comparison?.actual_contribution) : "Chưa kết thúc cửa sổ"}</b></div>
                  </div>
                </div>
              </div>

              {/* Step 3: REWARD & TOLERANCE THRESHOLD T */}
              <div className="p-4 rounded-2xl border border-slate-200 space-y-3">
                <div className="font-black text-slate-900 text-xs flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">3</span>
                  PHẦN THƯỞNG KINH TẾ (REWARD = ACTUAL - EXPECTED) & NGƯỠNG DUNG SAI (T)
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
                  {/* D7 Reward */}
                  <div className="p-3 bg-indigo-50/40 rounded-xl border border-indigo-100 space-y-1">
                    <div className="font-bold text-indigo-950">Reward D7 (Ngắn Hạn):</div>
                    <div>• Dung sai T = <b>{formatUsd(selectedAuditItem.d7?.comparison?.t_threshold ?? 3)}</b></div>
                    {selectedAuditItem.d7?.comparison?.reward_usd !== null && selectedAuditItem.d7?.comparison?.reward_usd !== undefined ? (
                      <div>• Reward = <b className={(selectedAuditItem.d7.comparison.reward_usd ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {formatUsd(selectedAuditItem.d7.comparison.reward_usd, true)}
                      </b></div>
                    ) : (
                      <div className="text-amber-700"><i>Chưa tính do chưa đủ ngày quan sát</i></div>
                    )}
                  </div>

                  {/* D30 Reward */}
                  <div className="p-3 bg-purple-50/40 rounded-xl border border-purple-100 space-y-1">
                    <div className="font-bold text-purple-950">Reward D30 (Dài Hạn):</div>
                    <div>• Dung sai T = <b>{formatUsd(selectedAuditItem.d30?.comparison?.t_threshold ?? 3)}</b></div>
                    {selectedAuditItem.d30?.comparison?.reward_usd !== null && selectedAuditItem.d30?.comparison?.reward_usd !== undefined ? (
                      <div>• Reward = <b className={(selectedAuditItem.d30.comparison.reward_usd ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {formatUsd(selectedAuditItem.d30.comparison.reward_usd, true)}
                      </b></div>
                    ) : (
                      <div className="text-amber-700"><i>Chưa tính do chưa đủ ngày quan sát</i></div>
                    )}
                  </div>
                </div>
              </div>

              {/* Step 4: AI TRAJECTORY CONCLUSION */}
              <div className="p-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 space-y-2">
                <div className="font-black text-indigo-950 text-xs flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">4</span>
                  TỔNG HỢP QUỸ ĐẠO HỌC TẬP (AI TRAJECTORY SUMMARY)
                </div>
                <div className="space-y-1.5 mt-2">
                  <div>
                    Nhãn D7 (Ngắn hạn): <b>{selectedAuditItem.d7?.outcome_label || selectedAuditItem.d7?.status || "N/A"}</b>
                    {selectedAuditItem.d7?.evidence_quality?.reason_codes?.length ? ` (${selectedAuditItem.d7.evidence_quality.reason_codes.join(", ")})` : ""}
                  </div>
                  <div>
                    Nhãn D30 (Dài hạn): <b>{selectedAuditItem.d30?.outcome_label || selectedAuditItem.d30?.status || "N/A"}</b>
                    {selectedAuditItem.d30?.evidence_quality?.reason_codes?.length ? ` (${selectedAuditItem.d30.evidence_quality.reason_codes.join(", ")})` : ""}
                  </div>
                  <div>
                    Đủ tiêu chuẩn huấn luyện mô hình RL: <b>{selectedAuditItem.eligible_for_learning ? "✅ CÓ (Dữ liệu sạch)" : "❌ KHÔNG (Bị loại trừ để bảo toàn chất lượng model)"}</b>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAuditItem(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-extrabold text-xs hover:bg-slate-800 transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
