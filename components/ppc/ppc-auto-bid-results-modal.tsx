"use client";

import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  MagnifyingGlass,
  ArrowsClockwise,
  Clock,
  ArrowRight,
  Target,
  CircleNotch,
  CaretRight,
  CaretDown,
  CalendarBlank,
  Megaphone,
} from "@phosphor-icons/react";
import type { TargetCurrentState } from "@/lib/ppc/target-current-state";
import {
  WINDOW_DAYS,
  buildTargetHistories,
  targetKeyOf,
  verifiedAmazonBid,
  type ActionKind,
  type ChangeStep,
  type TargetHistory,
  type WindowResult,
  type WindowState,
} from "@/lib/ppc/auto-bid-history";

export interface WindowDetail {
  outcome_id: string;
  window_days: number;
  status: string;
  outcome_label: string | null;
  observation_start: string;
  observation_end: string;
  maturity_date: string | null;
  baseline: Record<string, unknown>;
  observed: Record<string, unknown>;
  comparison: {
    reward_usd?: number | null;
    reward_norm?: number | null;
    t_threshold?: number | null;
    applied_delta_pct?: number | null;
    actual_contribution?: number | null;
    expected_contribution?: number | null;
    expected_source?: string | null;
  };
  evidence_quality: {
    spec_label?: string | null;
    validity?: string | null;
    reason_codes?: string[];
    confound_flags?: string[];
    eligible_for_learning?: boolean;
    interrupted_by_action_id?: string | null;
  };
  evaluated_at: string | null;
}

export interface BidOutcomeActionItem {
  action_id: string;
  store_id: string;
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  ad_group_id?: string | null;
  ad_group_name?: string | null;
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
  action_timestamp?: string | null;
  baseline: Record<string, unknown>;
  d3: WindowDetail | null;
  d7: WindowDetail | null;
  d14: WindowDetail | null;
  d30: WindowDetail | null;
  eligible_for_learning: boolean;
  evaluated_at: string | null;
  /** Trạng thái hiện tại của target từ báo cáo mới nhất (bid, ACOS 30 ngày, SV, rank). */
  current?: TargetCurrentState | null;
}

interface OutcomeSummary {
  total: number;
  totalFiltered?: number;
  uniqueTargets?: number;
  mature: number;
  observing: number;
  superseded: number;
  interrupted?: number;
  insufficientData: number;
  positive: number;
  neutral: number;
  negative: number;
  warning3d?: number;
  eligibleForLearning: number;
  totalRewardUsd: number;
  winRate: number | null;
}

interface PpcAutoBidResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedStore?: string;
}

function getOutcomeMetrics(item: BidOutcomeActionItem) {
  const window = [item.d30, item.d14, item.d7, item.d3].find((entry) => entry?.observed && Object.keys(entry.observed).length > 0);
  const observed = window?.observed || {};
  const baseline = window?.baseline || item.baseline || {};
  const number = (key: string) => {
    const value = Number(observed[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const spend = number("spend");
  const sales = number("sales");
  const baselineSpend = Number(baseline.spend || 0);
  const baselineSales = Number(baseline.sales || 0);
  const contribution = Number(observed.contribution || window?.comparison?.actual_contribution || 0);
  const baselineContribution = Number(baseline.contribution || window?.comparison?.expected_contribution || 0);
  const reward = Number(window?.comparison?.reward_usd || contribution - baselineContribution || 0);
  const acos = observed.acos == null ? (sales > 0 ? (spend / sales) * 100 : spend > 0 ? 999 : 0) : number("acos");
  const baselineAcos = baseline.acos == null ? (baselineSales > 0 ? (baselineSpend / baselineSales) * 100 : 0) : Number(baseline.acos || 0);
  return {
    hasData: Boolean(window),
    spend,
    sales,
    orders: number("orders"),
    clicks: number("clicks"),
    acos,
    baselineSpend,
    baselineSales,
    baselineAcos,
    deltaAcos: acos >= 999 ? 999 : acos - baselineAcos,
    deltaSalesPct: baselineSales > 0 ? ((sales - baselineSales) / baselineSales) * 100 : null,
    deltaSpendPct: baselineSpend > 0 ? ((spend - baselineSpend) / baselineSpend) * 100 : null,
    contribution,
    baselineContribution,
    reward,
  };
}

function getAcosTone(acos: number, spend: number) {
  if (spend === 0) return "bg-slate-100 text-slate-600";
  if (acos <= 30) return "bg-emerald-100 text-emerald-700";
  if (acos <= 45) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function aggregateOutcomeMetrics(allItems: BidOutcomeActionItem[]) {
  // Lần chỉnh chưa có báo cáo sau ngày chỉnh không được tính như số 0.
  const items = allItems.filter((item) => getOutcomeMetrics(item).hasData);
  const total = items.reduce((sum, item) => {
    const metrics = getOutcomeMetrics(item);
    sum.spend += metrics.spend;
    sum.sales += metrics.sales;
    sum.orders += metrics.orders;
    sum.baselineSpend += metrics.baselineSpend;
    sum.baselineSales += metrics.baselineSales;
    sum.contribution += metrics.contribution;
    sum.baselineContribution += metrics.baselineContribution;
    sum.reward += metrics.reward;
    return sum;
  }, { spend: 0, sales: 0, orders: 0, baselineSpend: 0, baselineSales: 0, contribution: 0, baselineContribution: 0, reward: 0 });
  const acos = total.sales > 0 ? (total.spend / total.sales) * 100 : total.spend > 0 ? 999 : 0;
  const baselineAcos = total.baselineSales > 0 ? (total.baselineSpend / total.baselineSales) * 100 : 0;
  return {
    ...total,
    measured: items.length,
    acos,
    baselineAcos,
    deltaAcos: acos >= 999 ? 999 : acos - baselineAcos,
    deltaSalesPct: total.baselineSales > 0 ? ((total.sales - total.baselineSales) / total.baselineSales) * 100 : null,
    deltaSpendPct: total.baselineSpend > 0 ? ((total.spend - total.baselineSpend) / total.baselineSpend) * 100 : null,
  };
}

function getRewardTone(reward: number) {
  if (reward > 0) return { label: "Tốt", className: "bg-emerald-100 text-emerald-700" };
  if (reward < 0) return { label: "Kém", className: "bg-rose-100 text-rose-700" };
  return { label: "Trung bình", className: "bg-amber-100 text-amber-700" };
}

function BidSparkline({
  values,
  labels,
  height = 48,
  tone = "indigo",
}: {
  values: number[];
  labels?: string[];
  height?: number;
  tone?: "indigo" | "green" | "red";
}) {
  if (values.length === 0) return <div className="h-12 rounded-lg bg-slate-50" />;
  const width = 240;
  const chartHeight = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : 8 + (index / (values.length - 1)) * (width - 16);
    const y = values.length === 1 ? chartHeight / 2 : 5 + (1 - (value - min) / range) * (chartHeight - 10);
    return { x, y, value };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const color = tone === "green" ? "#16a34a" : tone === "red" ? "#dc2626" : "#4f46e5";

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${chartHeight}`} className="w-full" style={{ height }} role="img" aria-label="Biểu đồ thay đổi bid">
        <line x1="8" y1={chartHeight - 5} x2={width - 8} y2={chartHeight - 5} stroke="#e2e8f0" strokeWidth="1" />
        {points.length > 1 && <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((point, index) => (
          <g key={`${point.x}-${index}`}>
            <circle cx={point.x} cy={point.y} r={points.length === 1 ? 4 : 3} fill={color} />
            <circle cx={point.x} cy={point.y} r="6" fill="transparent" />
          </g>
        ))}
      </svg>
      {labels && labels.length > 1 && (
        <div className="flex justify-between text-[9px] font-semibold text-slate-400">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

// FORMAT TIỀN TỆ CHUẨN: -$38.4 thay vì $-38.4
export function formatCurrencyUsd(
  val: number | string | null | undefined,
  showPlus = false,
  digits = 1
): string {
  if (val == null || val === "") return "—";
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  if (isNaN(num)) return "—";
  const abs = Math.abs(num).toFixed(digits);
  if (num < 0) return `-$${abs}`;
  if (num > 0 && showPlus) return `+$${abs}`;
  return `$${abs}`;
}

export function formatPercent(val: number | string | null | undefined, showPlus = false): string {
  if (val == null || val === "") return "—";
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  if (isNaN(num)) return "—";
  const sign = num > 0 && showPlus ? "+" : "";
  return `${sign}${num.toFixed(1)}%`;
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

// Tính số ngày đã trôi qua kể từ khi áp dụng chỉnh bid
export function getDaysElapsed(item: { action_timestamp?: string | null; applied_on?: string | null }): number {
  const ts = item.action_timestamp || item.applied_on;
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  if (isNaN(t) || t === 0) return 0;
  const now = Date.now();
  const diffDays = Math.floor((now - t) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Đánh giá trạng thái từng mốc (3D, 7D, 14D, 30D) thống nhất, gọn gàng, đúng chuẩn
export function getWindowEvaluation(
  windowDetail: WindowDetail | null | undefined,
  windowDays: 3 | 7 | 14 | 30,
  daysElapsed: number
): {
  label: "Win" | "Loss" | "Bình thường" | "Đang chờ" | "Chưa có" | "Chưa đủ dữ liệu" | "Bị ngắt";
  color: string;
  tip: string;
  isPending: boolean;
} {
  // 1. Kiểm tra xem có bị hành động đổi bid mới đè lên không
  const isInterrupted =
    windowDetail?.status === "INTERRUPTED" ||
    windowDetail?.evidence_quality?.validity === "INTERRUPTED" ||
    windowDetail?.evidence_quality?.validity === "SUPERSEDED";
  if (isInterrupted) {
    return {
      label: "Bị ngắt",
      color: "text-slate-500 bg-slate-100 border-slate-200",
      tip: `Đã có lần chỉnh bid mới can thiệp trước khi hoàn tất ${windowDays}D`,
      isPending: false,
    };
  }

  // 2. Kiểm tra nếu chưa đủ số ngày trôi qua kể từ khi chỉnh bid
  if (daysElapsed < windowDays) {
    return {
      label: "Đang chờ",
      color: "text-sky-700 bg-sky-50 border-sky-200",
      tip: `Đang trong chu kỳ theo dõi ${windowDays}D (${daysElapsed}/${windowDays} ngày)`,
      isPending: true,
    };
  }

  // 3. Nếu đã đủ ngày nhưng chưa có bản ghi hoặc chưa có dữ liệu observed
  const hasObserved = Boolean(
    windowDetail?.observed &&
    (windowDetail.observed.clicks !== undefined ||
      windowDetail.observed.spend !== undefined ||
      windowDetail.observed.orders !== undefined)
  );

  if (!windowDetail || !hasObserved) {
    return {
      label: "Đang chờ",
      color: "text-sky-700 bg-sky-50 border-sky-200",
      tip: `Đang chờ báo cáo đối soát đủ ${windowDays} ngày`,
      isPending: true,
    };
  }

  // Dữ liệu cũ có thể mang nhãn INCONCLUSIVE chỉ vì ít click. Nếu đã có đủ
  // metrics và Reward thì vẫn kết luận; lượng mẫu chỉ ảnh hưởng độ tin cậy.
  if (
    windowDetail.status === "INSUFFICIENT_DATA" ||
    windowDetail.evidence_quality?.validity === "INCONCLUSIVE" ||
    windowDetail.outcome_label === "INCONCLUSIVE"
  ) {
    const reward = windowDetail.comparison?.reward_usd;
    if (typeof reward === "number") {
      if (reward > 0) {
        return {
          label: "Win",
          color: "text-emerald-700 bg-emerald-50 border-emerald-300 font-bold",
          tip: `Reward dương sau ${windowDays}D · độ tin cậy thấp`,
          isPending: false,
        };
      }
      if (reward < 0) {
        return {
          label: "Loss",
          color: "text-rose-700 bg-rose-50 border-rose-300 font-bold",
          tip: `Reward âm sau ${windowDays}D · độ tin cậy thấp`,
          isPending: false,
        };
      }
      return {
        label: "Bình thường",
        color: "text-slate-700 bg-slate-100 border-slate-200",
        tip: `Reward không đổi sau ${windowDays}D · độ tin cậy thấp`,
        isPending: false,
      };
    }
    return {
      label: "Chưa đủ dữ liệu",
      color: "text-amber-700 bg-amber-50 border-amber-200",
      tip: `Báo cáo ${windowDays}D chưa đồng bộ đủ ngày`,
      isPending: false,
    };
  }

  // 5. Kết luận Win / Loss / Bình thường
  if (windowDetail.outcome_label === "POSITIVE") {
    return {
      label: "Win",
      color: "text-emerald-700 bg-emerald-50 border-emerald-300 font-bold",
      tip: `Hiệu quả quảng cáo cải thiện tích cực sau ${windowDays}D`,
      isPending: false,
    };
  }

  if (windowDetail.outcome_label === "NEGATIVE") {
    return {
      label: "Loss",
      color: "text-rose-700 bg-rose-50 border-rose-300 font-bold",
      tip: `Hiệu quả quảng cáo giảm sút sau ${windowDays}D`,
      isPending: false,
    };
  }

  if (windowDetail.outcome_label === "NEUTRAL") {
    return {
      label: "Bình thường",
      color: "text-slate-700 bg-slate-100 border-slate-200 font-medium",
      tip: `Biến động trong ngưỡng bình thường sau ${windowDays}D`,
      isPending: false,
    };
  }

  // Fallback dựa trên reward_usd
  const reward = windowDetail.comparison?.reward_usd;
  if (reward != null) {
    if (reward > 0) {
      return {
        label: "Win",
        color: "text-emerald-700 bg-emerald-50 border-emerald-300 font-bold",
        tip: `Reward dương (+$${reward.toFixed(1)})`,
        isPending: false,
      };
    }
    if (reward < 0) {
      return {
        label: "Loss",
        color: "text-rose-700 bg-rose-50 border-rose-300 font-bold",
        tip: `Reward âm (-$${Math.abs(reward).toFixed(1)})`,
        isPending: false,
      };
    }
  }

  return {
    label: "Bình thường",
    color: "text-slate-700 bg-slate-100 border-slate-200 font-medium",
    tip: `Kết quả theo dõi ${windowDays}D ổn định`,
    isPending: false,
  };
}

// Kết luận tổng thể mốc cao nhất có kết quả rõ ràng (ví dụ: Win 7D, Loss 3D)
export function getOverallStatus(item: BidOutcomeActionItem, daysElapsed: number) {
  const eval30 = getWindowEvaluation(item.d30, 30, daysElapsed);
  const eval14 = getWindowEvaluation(item.d14, 14, daysElapsed);
  const eval7 = getWindowEvaluation(item.d7, 7, daysElapsed);
  const eval3 = getWindowEvaluation(item.d3, 3, daysElapsed);

  // Thứ tự ưu tiên mốc đã có kết luận rõ ràng (Win/Loss): 30D -> 14D -> 7D -> 3D
  for (const [days, ev] of [[30, eval30], [14, eval14], [7, eval7], [3, eval3]] as const) {
    if (ev.label === "Win") {
      return { badge: `Win ${days}D`, color: "text-emerald-800 bg-emerald-50 border-emerald-200" };
    }
    if (ev.label === "Loss") {
      return { badge: `Loss ${days}D`, color: "text-rose-800 bg-rose-50 border-rose-200" };
    }
  }

  for (const [days, ev] of [[30, eval30], [14, eval14], [7, eval7], [3, eval3]] as const) {
    if (ev.label === "Bình thường") {
      return { badge: `Hòa ${days}D`, color: "text-slate-700 bg-slate-100 border-slate-200" };
    }
  }

  if ([eval3, eval7, eval14, eval30].some((e) => e.label === "Bị ngắt")) {
    return { badge: "Bị ngắt", color: "text-slate-500 bg-slate-100 border-slate-200" };
  }

  if ([eval3, eval7, eval14, eval30].some((e) => e.label === "Đang chờ")) {
    const nextWaiting = [3, 7, 14, 30].find((d) => daysElapsed < d) || 3;
    return { badge: `Đang chờ ${nextWaiting}D`, color: "text-sky-700 bg-sky-50 border-sky-200" };
  }

  return { badge: "Chưa có", color: "text-slate-500 bg-slate-100 border-slate-200" };
}

const STATE_META: Record<WindowState, { label: string; className: string; dot: string }> = {
  WIN: { label: "Win", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "#059669" },
  LOSS: { label: "Loss", className: "border-rose-200 bg-rose-50 text-rose-700", dot: "#e11d48" },
  NEUTRAL: { label: "Bình thường", className: "border-slate-200 bg-slate-100 text-slate-700", dot: "#64748b" },
  LOW_DATA: { label: "Ít dữ liệu", className: "border-amber-200 bg-amber-50 text-amber-700", dot: "#d97706" },
  WAITING: { label: "Đang chờ", className: "border-sky-200 bg-sky-50 text-sky-700", dot: "#38bdf8" },
  OVERDUE: { label: "Thiếu báo cáo", className: "border-orange-200 bg-orange-50 text-orange-700", dot: "#ea580c" },
  INTERRUPTED: { label: "Bị ngắt", className: "border-slate-200 bg-white text-slate-400", dot: "#cbd5e1" },
};

const ACTION_STYLE: Record<ActionKind, { card: string; pill: string }> = {
  REVERT: { card: "border-rose-200 bg-rose-50/60", pill: "bg-rose-600 text-white" },
  NOT_APPLIED: { card: "border-orange-200 bg-orange-50/60", pill: "bg-orange-600 text-white" },
  WATCH: { card: "border-amber-200 bg-amber-50/60", pill: "bg-amber-500 text-white" },
  MISSING_DATA: { card: "border-orange-200 bg-orange-50/60", pill: "bg-orange-500 text-white" },
  SCALE: { card: "border-emerald-200 bg-emerald-50/60", pill: "bg-emerald-600 text-white" },
  KEEP: { card: "border-slate-200 bg-slate-50", pill: "bg-slate-600 text-white" },
  WAIT: { card: "border-sky-200 bg-sky-50/60", pill: "bg-sky-600 text-white" },
};

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : iso;
};

function StateChip({ result, withDays = false }: { result: WindowResult; withDays?: boolean }) {
  const meta = STATE_META[result.state];
  const tip = result.state === "WAITING"
    ? `Có kết quả ${result.days} ngày vào ${shortDate(result.dueDate)}`
    : result.state === "OVERDUE"
      ? `Đã quá ${shortDate(result.dueDate)} nhưng chưa có báo cáo`
      : `${meta.label} sau ${result.days} ngày`;
  return (
    <span title={tip} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>
      {withDays && <span className="font-black">{result.days}D</span>}
      {meta.label}
    </span>
  );
}

/**
 * Bậc thang bid theo thời gian: chấm trắng là bid ban đầu, mỗi chấm màu là một lần chỉnh (màu = kết quả),
 * chấm viền cam cuối cùng là bid Amazon đang chạy khi khác bid hệ thống đặt.
 */
function BidHistoryChart({
  steps,
  amazonBid = null,
  height = 52,
  detailed = false,
}: {
  steps: ChangeStep<BidOutcomeActionItem>[];
  amazonBid?: number | null;
  height?: number;
  detailed?: boolean;
}) {
  if (steps.length === 0) return null;
  const width = 260;
  const padX = 22;
  const padTop = 14;
  const padBottom = detailed ? 16 : 5;
  const values = [steps[0].oldBid, ...steps.map((s) => s.newBid)];
  const last = steps[steps.length - 1];
  const showAmazon = amazonBid != null && Math.abs(amazonBid - last.newBid) > 0.005;
  const all = showAmazon ? [...values, amazonBid] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = Math.max(max - min, 0.01);
  const count = all.length;
  const xAt = (i: number) => padX + (count === 1 ? 0.5 : i / (count - 1)) * (width - padX * 2);
  const yAt = (v: number) => padTop + (1 - (v - min) / range) * (height - padTop - padBottom);
  let path = `M ${xAt(0)} ${yAt(values[0])}`;
  for (let i = 1; i < values.length; i += 1) path += ` H ${xAt(i)} V ${yAt(values[i])}`;
  const label = (v: number) => `$${v.toFixed(2)}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label={`Lịch sử bid: ${values.map(label).join(" → ")}${showAmazon ? `, Amazon đang chạy ${label(amazonBid)}` : ""}`}>
      <path d={path} fill="none" stroke="#94a3b8" strokeWidth="1.5" />
      {showAmazon && (
        <line x1={xAt(values.length - 1)} y1={yAt(last.newBid)} x2={xAt(values.length)} y2={yAt(amazonBid)} stroke="#ea580c" strokeWidth="1.5" strokeDasharray="3 3" />
      )}
      <circle cx={xAt(0)} cy={yAt(values[0])} r="3" fill="#fff" stroke="#94a3b8" strokeWidth="1.5">
        <title>{`Bid ban đầu ${label(values[0])}`}</title>
      </circle>
      <text x={xAt(0)} y={yAt(values[0]) - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">{label(values[0])}</text>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <g key={step.action.action_id}>
            <circle cx={xAt(i + 1)} cy={yAt(step.newBid)} r="4.5" fill={STATE_META[step.summary.state].dot} stroke="#fff" strokeWidth="1.5">
              <title>{`${shortDate(step.date)}: ${label(step.oldBid)} → ${label(step.newBid)} (${step.deltaPct >= 0 ? "+" : ""}${step.deltaPct.toFixed(1)}%) · ${STATE_META[step.summary.state].label}`}</title>
            </circle>
            {(detailed || isLast) && (
              <text x={xAt(i + 1)} y={yAt(step.newBid) - 7} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#1e293b">{label(step.newBid)}</text>
            )}
            {detailed && <text x={xAt(i + 1)} y={height - 3} textAnchor="middle" fontSize="9" fill="#94a3b8">{shortDate(step.date)}</text>}
          </g>
        );
      })}
      {showAmazon && (
        <g>
          <circle cx={xAt(values.length)} cy={yAt(amazonBid)} r="4" fill="#fff" stroke="#ea580c" strokeWidth="2">
            <title>{`Amazon đang chạy ${label(amazonBid)}, khác bid hệ thống đặt ${label(last.newBid)}`}</title>
          </circle>
          <text x={xAt(values.length)} y={yAt(amazonBid) - 7} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#ea580c">{label(amazonBid)}</text>
        </g>
      )}
    </svg>
  );
}

/** Chuỗi bid đọc bằng chữ: bid ban đầu → từng lần chỉnh (màu = kết quả lần đó) → bid Amazon nếu khác. */
function BidTrail({ history }: { history: TargetHistory<BidOutcomeActionItem> }) {
  const steps = history.steps;
  const shown = steps.length > 4 ? steps.slice(-3) : steps;
  const latest = history.latest;
  const amazonBid = verifiedAmazonBid(latest);
  const notApplied = amazonBid != null && Math.abs(amazonBid - latest.newBid) > 0.005;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1 font-mono text-xs">
        {steps.length > 4 && <span className="text-slate-400" title={`${steps.length - 3} lần chỉnh trước đó`}>…</span>}
        <span className="text-slate-500">${shown[0].oldBid.toFixed(2)}</span>
        {shown.map((step) => (
          <Fragment key={step.action.action_id}>
            <span className="text-slate-300">→</span>
            <span
              title={`${shortDate(step.date)} · ${formatPercent(step.deltaPct, true)} · ${STATE_META[step.summary.state].label}`}
              className={`rounded border px-1 font-bold ${STATE_META[step.summary.state].className}`}
            >
              ${step.newBid.toFixed(2)}
            </span>
          </Fragment>
        ))}
        {notApplied && (
          <span className="rounded bg-orange-100 px-1 text-[10px] font-bold text-orange-700" title={`Báo cáo Amazon đến ${shortDate(latest.action.current?.asOf || "")}`}>
            Amazon ${amazonBid.toFixed(2)}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
        <span>Chỉnh {shortDate(latest.date)}</span>
        <span className={`font-black ${latest.deltaPct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(latest.deltaPct, true)}</span>
        <StateChip result={latest.summary} withDays />
      </span>
    </span>
  );
}

type ApplyState = { status: "saving" | "done" | "error"; message?: string };

/** Hành động ngay trên dòng: đề xuất + ô bid + Duyệt vào Action Queue. */
function ActionControl({
  history,
  baseBid,
  state,
  onApply,
}: {
  history: TargetHistory<BidOutcomeActionItem>;
  baseBid: number;
  state: ApplyState | undefined;
  onApply: (bid: number) => void;
}) {
  const suggested = history.action.targetBid ?? baseBid;
  const [value, setValue] = useState(suggested.toFixed(2));
  const bid = Number(value);
  const valid = Number.isFinite(bid) && bid >= 0.02;
  const changed = valid && Math.abs(bid - baseBid) > 0.005;
  return (
    <span className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
      <span className={`w-fit rounded-md px-2 py-0.5 text-[11px] font-black ${ACTION_STYLE[history.action.kind].pill}`} title={history.action.reason}>
        {history.action.title}
      </span>
      {state?.status === "done" ? (
        <span className="text-[11px] font-bold text-emerald-700">✓ Đã vào Action Queue · ${bid.toFixed(2)}</span>
      ) : (
        <span className="flex items-center gap-1">
          <span className="relative">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0.02"
              aria-label={`Bid mới cho ${history.keyword}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-[68px] rounded-md border border-slate-300 py-0.5 pl-4 pr-1 font-mono text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
          </span>
          <button
            type="button"
            disabled={!changed || state?.status === "saving"}
            onClick={() => onApply(bid)}
            title={changed ? `Đưa bid $${bid.toFixed(2)} vào Action Queue (bid đang chạy $${baseBid.toFixed(2)})` : `Bid đang chạy đã là $${baseBid.toFixed(2)}`}
            className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {state?.status === "saving" ? "Đang lưu…" : "Duyệt"}
          </button>
        </span>
      )}
      {state?.status === "error" && <span className="text-[10px] font-semibold text-rose-700">{state.message}</span>}
    </span>
  );
}

function VerdictLine({ step }: { step: ChangeStep<BidOutcomeActionItem> }) {
  const s = step.summary;
  if (s.state === "WAITING") return <span className="text-[11px] text-sky-700">Có kết quả {shortDate(s.dueDate)}</span>;
  if (s.state === "OVERDUE" || s.state === "INTERRUPTED") return null;
  const m = s.metrics;
  if (!m) return null;
  return (
    <span className="font-mono text-[11px] text-slate-600">
      {m.acosBefore != null && m.acosAfter != null ? `ACOS ${m.acosBefore.toFixed(0)}→${m.acosAfter.toFixed(0)}%` : m.acosAfter != null ? `ACOS ${m.acosAfter.toFixed(0)}%` : "Chưa ra đơn"}
      {s.reward != null && <b className={s.reward >= 0 ? " text-emerald-700" : " text-rose-700"}> {formatCurrencyUsd(s.reward, true, 1)}</b>}
    </span>
  );
}

function TargetHistoryPanel({ history, onClose }: { history: TargetHistory<BidOutcomeActionItem>; onClose: () => void }) {
  const [openStep, setOpenStep] = useState<string | null>(null);
  const style = ACTION_STYLE[history.action.kind];
  const stepsNewestFirst = [...history.steps].reverse();
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-slate-900">{history.keyword || "—"}</h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase text-slate-600">{history.matchType}</span>
            {history.campaignName}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng chi tiết" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
          <X size={18} weight="bold" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 thin-scrollbar">
        <section className={`rounded-xl border p-3.5 ${style.card}`}>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Hành động bây giờ</span>
          <p className="mt-1 text-base font-black text-slate-900">{history.action.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">{history.action.reason}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>Bid hiện tại <b className="font-mono text-slate-900">${history.currentBid.toFixed(2)}</b></span>
            {history.bestStep && (
              <span>Bid tốt nhất từng đạt <b className="font-mono text-emerald-700">${history.bestStep.newBid.toFixed(2)}</b> ({shortDate(history.bestStep.date)})</span>
            )}
          </div>
        </section>

        <section>
          <h4 className="mb-1 text-xs font-black text-slate-700">Lịch sử bid · {history.steps.length} lần chỉnh</h4>
          <div className="rounded-xl border border-slate-200 px-2 py-1">
            <BidHistoryChart steps={history.steps} amazonBid={verifiedAmazonBid(history.latest)} height={110} detailed />
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-black text-slate-700">Từng lần chỉnh (mới nhất trước)</h4>
          {stepsNewestFirst.map((step, index) => {
            const isOpen = openStep === step.action.action_id;
            return (
              <div key={step.action.action_id} className="rounded-xl border border-slate-200">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenStep(isOpen ? null : step.action.action_id)}
                  className="flex w-full flex-col gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">{formatDisplayDate(step.date)}</span>
                    {index === 0 && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-black text-indigo-700">Gần nhất</span>}
                    <span className="font-mono text-sm font-black text-slate-900">
                      ${step.oldBid.toFixed(2)} <ArrowRight size={11} weight="bold" className="inline text-slate-400" /> ${step.newBid.toFixed(2)}
                    </span>
                    <span className={`text-xs font-black ${step.deltaPct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(step.deltaPct, true)}</span>
                    <CaretDown size={12} weight="bold" className={`ml-auto text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {WINDOW_DAYS.map((days) => <StateChip key={days} result={step.windows[days]} withDays />)}
                  </span>
                  <VerdictLine step={step} />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-200">
                    <ActionDecisionSupportModal action={step.action} onClose={() => setOpenStep(null)} embedded />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

export function PpcAutoBidResultsModal({
  isOpen,
  onClose,
  selectedStore,
}: PpcAutoBidResultsModalProps) {
  const [items, setItems] = useState<BidOutcomeActionItem[]>([]);
  const [summary, setSummary] = useState<OutcomeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"ALL" | "3D" | "7D" | "14D" | "30D" | "COMPLETED" | "INTERRUPTED">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "WIN" | "NEUTRAL" | "LOSS" | "WARNING_3D">("ALL");
  const [selectedAction, setSelectedAction] = useState<BidOutcomeActionItem | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");

  const fetchOutcomes = useCallback(async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStore && selectedStore !== "ALL") {
        params.set("storeName", selectedStore);
      }
      // Load đủ dữ liệu để hiển thị toàn bộ các đợt chỉnh bid (không bị giới hạn 500)
      params.set("limit", "1500");

      const res = await fetch(`/api/ppc/action-outcomes?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải kết quả theo dõi bid");
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
        setSummary(json.data.summary || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isOpen, selectedStore]);

  useEffect(() => {
    if (isOpen) {
      // Fetching is the external synchronization owned by this modal lifecycle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchOutcomes();
    }
  }, [isOpen, fetchOutcomes]);

  useEffect(() => {
    // Always start from the collapsed campaign list on each open/close cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedCampaign(null);
    setSelectedAction(null);
  }, [isOpen]);

  const handleRunEvaluation = async () => {
    try {
      setEvaluating(true);
      const res = await fetch("/api/ppc/action-outcomes", { method: "POST" });
      if (res.ok) {
        await fetchOutcomes();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEvaluating(false);
    }
  };

  // Xác định chặng hiện tại của target
  const getItemStage = useCallback((item: BidOutcomeActionItem): "3D" | "7D" | "14D" | "30D" | "COMPLETED" | "INTERRUPTED" => {
    const isInterrupted =
      item.d3?.status === "INTERRUPTED" ||
      item.d7?.status === "INTERRUPTED" ||
      item.d14?.status === "INTERRUPTED" ||
      item.d30?.status === "INTERRUPTED" ||
      item.d3?.evidence_quality?.validity === "INTERRUPTED" ||
      item.d7?.evidence_quality?.validity === "INTERRUPTED" ||
      item.d14?.evidence_quality?.validity === "INTERRUPTED" ||
      item.d30?.evidence_quality?.validity === "INTERRUPTED";

    if (isInterrupted) return "INTERRUPTED";

    if (item.d30 && item.d30.status === "MATURE") return "COMPLETED";
    if (item.d14 && item.d14.status === "MATURE") return "30D";
    if (item.d7 && item.d7.status === "MATURE") return "14D";
    if (item.d3 && item.d3.status === "MATURE") return "7D";

    const days = getDaysElapsed(item);
    if (days <= 3) return "3D";
    if (days <= 7) return "7D";
    if (days <= 14) return "14D";
    if (days <= 30) return "30D";
    return "COMPLETED";
  }, []);

  // Lấy bản ghi mới nhất cho mỗi Target (Toàn bộ trước khi áp dụng bộ lọc Stage/Status)
  const allLatestTargetItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const timeA = new Date(a.action_timestamp || a.applied_on || 0).getTime();
      const timeB = new Date(b.action_timestamp || b.applied_on || 0).getTime();
      return timeB - timeA;
    });

    const seenTargets = new Set<string>();
    const result: BidOutcomeActionItem[] = [];

    for (const item of sorted) {
      const key = item.target_id || `${item.campaign_id || ""}_${item.target_keyword}_${item.match_type}`;
      if (!seenTargets.has(key)) {
        seenTargets.add(key);
        result.push(item);
      }
    }

    return result;
  }, [items]);

  // Đếm số lượng targets theo từng chặng
  const stageCounts = useMemo(() => {
    const counts = {
      ALL: allLatestTargetItems.length,
      "3D": 0,
      "7D": 0,
      "14D": 0,
      "30D": 0,
      COMPLETED: 0,
      INTERRUPTED: 0,
    };
    for (const item of allLatestTargetItems) {
      const st = getItemStage(item);
      counts[st] = (counts[st] || 0) + 1;
    }
    return counts;
  }, [allLatestTargetItems, getItemStage]);

  const effectiveStatusFilter = statusFilter === "LOSS" && (summary?.negative || 0) === 0
    ? "ALL"
    : statusFilter === "WIN" && (summary?.positive || 0) === 0
      ? "ALL"
      : statusFilter === "NEUTRAL" && (summary?.neutral || 0) === 0
        ? "ALL"
        : statusFilter;

  // Lọc items theo cả Chặng (Stage) và Kết quả (Status)
  const visibleTargetItems = useMemo(() => {
    return allLatestTargetItems.filter((item) => {
      const query = search.trim().toLocaleLowerCase();
      if (query) {
        const searchable = [item.target_keyword, item.campaign_name, item.sku, item.match_type]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        if (!searchable.includes(query)) return false;
      }

      // 1. Lọc theo chặng
      if (stageFilter !== "ALL") {
        const st = getItemStage(item);
        if (st !== stageFilter) return false;
      }

      // 2. Lọc theo kết quả
      if (effectiveStatusFilter !== "ALL") {
        const label = item.d30?.outcome_label || item.d14?.outcome_label || item.d7?.outcome_label || item.d3?.outcome_label;
        if (effectiveStatusFilter === "WIN") return label === "POSITIVE";
        if (effectiveStatusFilter === "LOSS") return label === "NEGATIVE";
        if (effectiveStatusFilter === "NEUTRAL") return label === "NEUTRAL";
        if (effectiveStatusFilter === "WARNING_3D") {
          const days = getDaysElapsed(item);
          const ev3 = getWindowEvaluation(item.d3, 3, days);
          return ev3.label === "Loss";
        }
      }

      return true;
    });
  }, [allLatestTargetItems, search, stageFilter, effectiveStatusFilter, getItemStage]);

  // Exception-first: lỗi có reward âm lớn nhất lên đầu, sau đó mới tới win,
  // bình thường và các target còn đang theo dõi.
  const rankedVisibleTargetItems = useMemo(() => {
    const outcomeRank = (item: BidOutcomeActionItem) => {
      const days = getDaysElapsed(item);
      const evaluations = [
        getWindowEvaluation(item.d30, 30, days),
        getWindowEvaluation(item.d14, 14, days),
        getWindowEvaluation(item.d7, 7, days),
        getWindowEvaluation(item.d3, 3, days),
      ];
      if (evaluations.some((result) => result.label === "Loss")) return 0;
      if (evaluations.some((result) => result.label === "Win")) return 1;
      if (evaluations.some((result) => result.label === "Bình thường")) return 2;
      return 3;
    };
    const latestReward = (item: BidOutcomeActionItem) =>
      Number(item.d30?.comparison?.reward_usd ?? item.d14?.comparison?.reward_usd ?? item.d7?.comparison?.reward_usd ?? item.d3?.comparison?.reward_usd ?? 0);

    return [...visibleTargetItems].sort((a, b) => {
      const rankDiff = outcomeRank(a) - outcomeRank(b);
      if (rankDiff !== 0) return rankDiff;
      const rewardDiff = latestReward(a) - latestReward(b);
      if (rewardDiff !== 0) return rewardDiff;
      return new Date(b.action_timestamp || b.applied_on || 0).getTime()
        - new Date(a.action_timestamp || a.applied_on || 0).getTime();
    });
  }, [visibleTargetItems]);

  // Gom theo Chiến dịch cho các target đang hiển thị
  const campaignGroups = useMemo(() => {
    const campMap = new Map<string, BidOutcomeActionItem[]>();

    for (const item of visibleTargetItems) {
      const cKey = item.campaign_id || item.campaign_name || "unknown";
      if (!campMap.has(cKey)) {
        campMap.set(cKey, []);
      }
      campMap.get(cKey)!.push(item);
    }

    const sortedCampKeys = Array.from(campMap.keys()).sort((a, b) => {
      const itemsA = campMap.get(a)!;
      const itemsB = campMap.get(b)!;
      const maxTimeA = Math.max(...itemsA.map((it) => new Date(it.action_timestamp || it.applied_on || 0).getTime()));
      const maxTimeB = Math.max(...itemsB.map((it) => new Date(it.action_timestamp || it.applied_on || 0).getTime()));
      if (maxTimeB !== maxTimeA) {
        return maxTimeB - maxTimeA;
      }
      if (itemsB.length !== itemsA.length) {
        return itemsB.length - itemsA.length;
      }
      const nameA = itemsA[0]?.campaign_name || a;
      const nameB = itemsB[0]?.campaign_name || b;
      return nameA.localeCompare(nameB);
    });

    return sortedCampKeys.map((cKey) => {
      const cItems = campMap.get(cKey)!;
      cItems.sort((a, b) => {
        const timeA = new Date(a.action_timestamp || a.applied_on || 0).getTime();
        const timeB = new Date(b.action_timestamp || b.applied_on || 0).getTime();
        return timeB - timeA;
      });
      const first = cItems[0];

      let campWarning3d = 0;
      let campLoss = 0;
      let campWin = 0;

      for (const item of cItems) {
        const days = getDaysElapsed(item);
        const ev3 = getWindowEvaluation(item.d3, 3, days);
        const ev7 = getWindowEvaluation(item.d7, 7, days);
        const ev14 = getWindowEvaluation(item.d14, 14, days);
        const ev30 = getWindowEvaluation(item.d30, 30, days);

        if ([ev30, ev14, ev7, ev3].some((e) => e.label === "Win")) campWin++;
        if ([ev30, ev14, ev7, ev3].some((e) => e.label === "Loss")) campLoss++;
        if (ev3.label === "Loss") campWarning3d++;
      }

      const latestActionDate = first?.applied_on || (first?.action_timestamp ? new Date(first.action_timestamp).toISOString().split("T")[0] : "");

      return {
        campaignId: first?.campaign_id || cKey,
        campaignName: first?.campaign_name || (cKey === "unknown" ? "Chiến dịch không xác định" : cKey),
        campaignType: first?.campaign_type || "SP",
        sku: first?.sku || "",
        items: cItems,
        latestActionDate,
        stats: {
          total: cItems.length,
          warning3d: campWarning3d,
          loss: campLoss,
          win: campWin,
        },
      };
    });
  }, [visibleTargetItems]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, Map<string, BidOutcomeActionItem[]>>();
    for (const item of rankedVisibleTargetItems) {
      const date = item.applied_on || (item.action_timestamp ? item.action_timestamp.slice(0, 10) : "Không rõ ngày");
      const campaignId = item.campaign_id || item.campaign_name || "unknown";
      if (!groups.has(date)) groups.set(date, new Map());
      const campaigns = groups.get(date)!;
      const current = campaigns.get(campaignId) || [];
      current.push(item);
      campaigns.set(campaignId, current);
    }

    return Array.from(groups.entries())
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, campaignMap]) => {
        const campaigns = Array.from(campaignMap.entries()).map(([campaignId, campaignItems]) => {
          const first = campaignItems[0];
          let loss = 0;
          let win = 0;
          let warning3d = 0;
          for (const item of campaignItems) {
            const days = getDaysElapsed(item);
            const evaluations = [
              getWindowEvaluation(item.d30, 30, days),
              getWindowEvaluation(item.d14, 14, days),
              getWindowEvaluation(item.d7, 7, days),
              getWindowEvaluation(item.d3, 3, days),
            ];
            if (evaluations.some((evaluation) => evaluation.label === "Loss")) loss++;
            if (evaluations.some((evaluation) => evaluation.label === "Win")) win++;
            if (evaluations[3].label === "Loss") warning3d++;
          }
          return {
            campaignId,
            campaignName: first.campaign_name || (campaignId === "unknown" ? "Chiến dịch không xác định" : campaignId),
            campaignType: first.campaign_type || "SP",
            sku: first.sku || "",
            items: campaignItems,
            latestActionDate: date,
            stats: { total: campaignItems.length, warning3d, loss, win },
          };
        }).sort((a, b) => b.stats.loss - a.stats.loss || b.items.length - a.items.length || a.campaignName.localeCompare(b.campaignName));

        return {
          date,
          campaigns,
          targetCount: campaigns.reduce((sum, campaign) => sum + campaign.items.length, 0),
          lossCount: campaigns.reduce((sum, campaign) => sum + campaign.stats.loss, 0),
        };
      });
  }, [rankedVisibleTargetItems]);

  const campaignHistoryMap = useMemo(() => {
    const map = new Map<string, BidOutcomeActionItem[]>();
    for (const item of items) {
      const key = item.campaign_id || item.campaign_name || "unknown";
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [items]);

  const [applyState, setApplyState] = useState<Record<string, ApplyState>>({});

  // Duyệt bid ngay tại đây: cùng luồng với tab Recommendations (POST /api/ppc/actions → Action Queue).
  const applyBid = useCallback(async (history: TargetHistory<BidOutcomeActionItem>, bid: number) => {
    const item = history.latest.action;
    const oldBid = verifiedAmazonBid(history.latest) ?? history.currentBid;
    const match = (item.match_type || "").toLowerCase();
    setApplyState((prev) => ({ ...prev, [history.key]: { status: "saving" } }));
    try {
      const res = await fetch("/api/ppc/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: item.store_id,
          items: [{
            recommendation: {
              id: `auto-bid-history:${item.target_id}:${Date.now()}`,
              storeId: item.store_id,
              storeName: selectedStore || "",
              adType: item.campaign_type || "SP",
              recType: bid > oldBid ? "BID_INCREASE" : "BID_DECREASE",
              targetType: match.includes("exact") ? "EXACT" : match.includes("phrase") ? "PHRASE" : /asin|product|category/.test(match) ? "PRODUCT" : "PHRASE",
              matchType: item.match_type,
              keyword: item.target_keyword,
              campaignName: item.campaign_name,
              adGroupName: item.ad_group_name || "",
              sku: item.sku,
              campaignId: item.campaign_id,
              adGroupId: item.ad_group_id || "",
              keywordId: item.target_id,
              currentBid: oldBid,
              recommendedBid: history.action.targetBid ?? bid,
              reason: history.action.reason,
              estimatedSavings: 0,
              status: "PENDING",
              ruleProfile: "auto-bid-history",
              createdAt: new Date().toISOString(),
            },
            userFinalBid: bid,
            decisionSource: history.action.targetBid != null && Math.abs(history.action.targetBid - bid) < 0.005 ? "RULE_ENGINE" : "USER_EDIT",
          }],
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || json?.message || "Không duyệt được bid.");
      setApplyState((prev) => ({ ...prev, [history.key]: { status: "done" } }));
    } catch (error) {
      setApplyState((prev) => ({ ...prev, [history.key]: { status: "error", message: error instanceof Error ? error.message : "Không duyệt được bid." } }));
    }
  }, [selectedStore]);

  // Lịch sử chỉnh bid của từng target → hành động hiện tại.
  const historyByTarget = useMemo(() => {
    const map = new Map<string, TargetHistory<BidOutcomeActionItem>>();
    for (const history of buildTargetHistories(items)) map.set(history.key, history);
    return map;
  }, [items]);

  const campaignTrend = useCallback((campaignId: string) => {
    const byDate = new Map<string, BidOutcomeActionItem[]>();
    for (const item of campaignHistoryMap.get(campaignId) || []) {
      const date = item.applied_on || (item.action_timestamp ? item.action_timestamp.slice(0, 10) : "Không rõ ngày");
      const current = byDate.get(date) || [];
      current.push(item);
      byDate.set(date, current);
    }

    return Array.from(byDate.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, dayItems]) => {
        const oldBid = dayItems.reduce((sum, item) => sum + Number(item.old_value || 0), 0) / dayItems.length;
        const newBid = dayItems.reduce((sum, item) => sum + Number(item.final_value || item.system_suggested_value || 0), 0) / dayItems.length;
        const reward = dayItems.reduce((sum, item) => {
          const value = item.d30?.comparison?.reward_usd ?? item.d14?.comparison?.reward_usd ?? item.d7?.comparison?.reward_usd ?? item.d3?.comparison?.reward_usd ?? 0;
          return sum + Number(value);
        }, 0);
        const metrics = aggregateOutcomeMetrics(dayItems);
        return {
          date,
          oldBid,
          newBid,
          changePct: oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0,
          reward,
          targets: dayItems.length,
          acos: metrics.acos,
        };
      });
  }, [campaignHistoryMap]);

  const activeDateGroup = dateGroups.find((group) => group.date === selectedDate) || dateGroups[0];
  const overviewMetrics = aggregateOutcomeMetrics(activeDateGroup?.campaigns.flatMap((campaign) => campaign.items) || []);

  // Kept for the dense table variant used by older outcome views.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderTargetRow = (item: BidOutcomeActionItem) => {
    const days = getDaysElapsed(item);
    const ev3 = getWindowEvaluation(item.d3, 3, days);
    const ev7 = getWindowEvaluation(item.d7, 7, days);
    const ev14 = getWindowEvaluation(item.d14, 14, days);
    const ev30 = getWindowEvaluation(item.d30, 30, days);
    const overall = getOverallStatus(item, days);

    const oldBid = Number(item.old_value || 0);
    const newBid = Number(item.final_value || item.system_suggested_value || 0);
    const deltaPct = item.applied_delta_pct || (oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0);
    const isIncrease = deltaPct > 0;

    const latestWindow = item.d30?.observed && Object.keys(item.d30.observed).length > 0 ? item.d30
      : item.d14?.observed && Object.keys(item.d14.observed).length > 0 ? item.d14
        : item.d7?.observed && Object.keys(item.d7.observed).length > 0 ? item.d7
          : item.d3;
    const reward = latestWindow?.comparison?.reward_usd;
    const isSelected = selectedAction?.action_id === item.action_id;

    return (
      <tr
        key={item.action_id}
        onClick={() => setSelectedAction(item)}
        className={`transition cursor-pointer group ${isSelected ? "bg-indigo-50/70" : "hover:bg-slate-50"}`}
      >
        {/* TARGET / KEYWORD */}
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 group-hover:text-indigo-700 transition truncate max-w-[280px]">
              {item.target_keyword || "—"}
            </span>
            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${overall.color}`}>
              {overall.badge}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium mt-1">
            {item.match_type && (
              <span className="rounded bg-slate-100 px-1.5 py-0.2 text-slate-600 font-bold uppercase">
                {item.match_type}
              </span>
            )}
            <span className="max-w-[260px] truncate text-slate-400" title={item.campaign_name}>
              {item.campaign_name}
            </span>
            {item.sku && (
              <span className="text-slate-500 font-mono">
                SKU: {item.sku}
              </span>
            )}
            {item.applied_on && (
              <>
                <span>•</span>
                <span className="text-slate-400">{item.applied_on}</span>
              </>
            )}
          </div>
        </td>

        {/* BID CHANGE */}
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1.5 font-bold font-mono text-slate-800 text-xs">
            <span className="text-slate-400">${oldBid.toFixed(2)}</span>
            <ArrowRight size={12} className="text-slate-300" weight="bold" />
            <span className={isIncrease ? "text-emerald-700 font-extrabold" : "text-rose-700 font-extrabold"}>
              ${newBid.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] font-bold mt-0.5">
            <span className={isIncrease ? "text-emerald-600" : "text-rose-600"}>
              {isIncrease ? "+" : ""}{deltaPct.toFixed(1)}%
            </span>
          </div>
        </td>

        {/* 3D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={ev3.tip}
            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] border transition ${ev3.color}`}
          >
            {ev3.label}
          </span>
        </td>

        {/* 7D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={ev7.tip}
            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] border transition ${ev7.color}`}
          >
            {ev7.label}
          </span>
        </td>

        {/* 14D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={ev14.tip}
            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] border transition ${ev14.color}`}
          >
            {ev14.label}
          </span>
        </td>

        {/* 30D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={ev30.tip}
            className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] border transition ${ev30.color}`}
          >
            {ev30.label}
          </span>
        </td>

        {/* REWARD / OPEN INSPECTOR */}
        <td className="py-2.5 px-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <span className={`font-mono text-[11px] font-black ${reward == null ? "text-slate-300" : reward >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {reward == null ? "—" : formatCurrencyUsd(reward, true)}
            </span>
            <CaretRight size={14} weight="bold" className={isSelected ? "text-indigo-600" : "text-slate-300"} />
          </div>
        </td>
      </tr>
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderTargetCard = (item: BidOutcomeActionItem) => {
    const targetKey = item.target_id || `${item.campaign_id}_${item.target_keyword}_${item.match_type}`;
    const history = items
      .filter((candidate) => (candidate.target_id || `${candidate.campaign_id}_${candidate.target_keyword}_${candidate.match_type}`) === targetKey)
      .sort((a, b) => new Date(a.action_timestamp || a.applied_on || 0).getTime() - new Date(b.action_timestamp || b.applied_on || 0).getTime());
    const days = getDaysElapsed(item);
    const overall = getOverallStatus(item, days);
    const oldBid = Number(item.old_value || 0);
    const newBid = Number(item.final_value || item.system_suggested_value || 0);
    const deltaPct = item.applied_delta_pct || (oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0);
    const latestWindow = item.d30?.observed && Object.keys(item.d30.observed).length > 0 ? item.d30
      : item.d14?.observed && Object.keys(item.d14.observed).length > 0 ? item.d14
        : item.d7?.observed && Object.keys(item.d7.observed).length > 0 ? item.d7
          : item.d3;
    const reward = latestWindow?.comparison?.reward_usd;
    const isSelected = selectedAction?.action_id === item.action_id;
    const metrics = getOutcomeMetrics(item);

    return (
      <button
        type="button"
        key={item.action_id}
        onClick={() => setSelectedAction(item)}
        className={`grid w-full gap-3 rounded-lg border p-3 text-left transition active:translate-y-px md:grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_auto] ${isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-100" : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"}`}
      >
        <span className="min-w-0 self-center">
          <span className="flex items-center gap-2">
            <span className="truncate text-xs font-black text-slate-900">{item.target_keyword || "—"}</span>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${overall.color}`}>{overall.badge}</span>
          </span>
          <span className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-black text-slate-600">{item.match_type}</span>
            {item.sku && <span className="truncate font-mono">{item.sku}</span>}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-bold text-slate-500">
            <span>Spend {formatCurrencyUsd(metrics.spend, false, 2)}</span>
            <span>Sales {formatCurrencyUsd(metrics.sales, false, 2)}</span>
            <span>Orders {metrics.orders}</span>
            <span>ACoS {formatPercent(metrics.acos)}</span>
            <span>Clicks {metrics.clicks}</span>
          </span>
        </span>
        <span className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5">
          <BidSparkline
            values={history.map((entry) => Number(entry.final_value || entry.system_suggested_value || 0))}
            labels={history.map((entry) => entry.applied_on || entry.action_timestamp?.slice(0, 10) || "")}
            height={34}
          />
        </span>
        <span className="flex min-w-[170px] items-center justify-end gap-3 self-center">
          <span>
            <span className="flex items-center gap-1.5 font-mono text-xs font-black">
              <span className="text-slate-400">${oldBid.toFixed(2)}</span>
              <ArrowRight size={11} weight="bold" className="text-slate-300" />
              <span className={deltaPct >= 0 ? "text-emerald-700" : "text-rose-700"}>${newBid.toFixed(2)}</span>
            </span>
            <span className={`mt-0.5 block text-right text-[10px] font-black ${deltaPct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatPercent(deltaPct, true)}</span>
          </span>
          <span className={`w-14 text-right font-mono text-[10px] font-black ${reward == null ? "text-slate-300" : reward >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {reward == null ? "—" : formatCurrencyUsd(reward, true)}
          </span>
          <CaretRight size={14} weight="bold" className={isSelected ? "text-indigo-600" : "text-slate-300"} />
        </span>
      </button>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 bg-white">
          <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
              <Target size={22} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-black text-slate-900">Kết quả Auto Bid</h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-black text-indigo-800">
                  {selectedStore || "Tất cả Store"}
                </span>
                <span className="hidden text-xs font-semibold text-slate-500 sm:inline">{allLatestTargetItems.length} targets</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dateGroups.length > 0 && (
              <div className="relative">
                <CalendarBlank size={15} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <select
                  aria-label="Chọn ngày chỉnh bid"
                  value={activeDateGroup?.date || ""}
                  onChange={(event) => {
                    setSelectedDate(event.target.value);
                    setExpandedCampaign(null);
                    setSelectedAction(null);
                  }}
                  className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-xs font-black text-slate-800 shadow-2xs focus:border-indigo-500 focus:outline-none"
                >
                  {dateGroups.map((group) => <option key={group.date} value={group.date}>{formatDisplayDate(group.date)}</option>)}
                </select>
                <CaretDown size={13} weight="bold" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            )}
            <button
              type="button"
              onClick={handleRunEvaluation}
              disabled={evaluating || loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-indigo-600 transition disabled:opacity-50 cursor-pointer"
              title="Đánh giá lại toàn bộ các lần chỉnh bid với số liệu mới nhất"
            >
              <ArrowsClockwise size={15} className={evaluating ? "animate-spin text-indigo-600" : ""} weight="bold" />
              <span>{evaluating ? "Đang tính..." : "Cập nhật kết quả"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        {/* EXECUTIVE SUMMARY */}
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-white p-4 sm:grid-cols-5">
          {[
            { label: "Cần xử lý", value: summary?.negative || 0, tone: "text-rose-700" },
            { label: "Đang thắng", value: summary?.positive || 0, tone: "text-emerald-700" },
            { label: "Đang theo dõi", value: summary?.observing || 0, tone: "text-sky-700" },
            { label: "ACoS", value: overviewMetrics.measured === 0 || overviewMetrics.acos >= 999 ? "—" : formatPercent(overviewMetrics.acos), tone: getAcosTone(overviewMetrics.acos, overviewMetrics.spend).split(" ")[1] },
            { label: "Sales", value: overviewMetrics.measured === 0 ? "—" : formatCurrencyUsd(overviewMetrics.sales, false, 2), tone: "text-emerald-700" },
          ].map((metric) => (
            <button
              type="button"
              key={metric.label}
              onClick={() => metric.label === "Cần xử lý" && Number(metric.value) > 0 ? setStatusFilter("LOSS") : metric.label === "Đang thắng" && Number(metric.value) > 0 ? setStatusFilter("WIN") : null}
              className={`rounded-xl border border-slate-100 px-4 py-3 text-left transition active:translate-y-px ${metric.label === "Cần xử lý" ? "bg-rose-50/40 hover:bg-rose-50" : metric.label === "Đang thắng" || metric.label === "Sales" ? "bg-emerald-50/45 hover:bg-emerald-50" : metric.label === "ACoS" ? "bg-amber-50/35 hover:bg-amber-50" : "bg-sky-50/45 hover:bg-sky-50"}`}
            >
              <span className="block text-xs font-bold text-slate-600">{metric.label}</span>
              <span className={`mt-1 block text-xl font-black leading-none ${metric.tone}`}>{metric.value}</span>
            </button>
          ))}
        </div>

        {/* TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                aria-label="Tìm target, chiến dịch hoặc SKU"
                placeholder="Tìm target, campaign, SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-500 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* KẾT QUẢ LÀ BỘ LỌC CHÍNH */}
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs font-bold text-slate-600">
              {[
                { id: "LOSS", label: "Cần xử lý", count: summary?.negative || 0 },
                { id: "WIN", label: "Win", count: summary?.positive || 0 },
                { id: "NEUTRAL", label: "Bình thường", count: summary?.neutral || 0 },
                { id: "ALL", label: "Tất cả", count: stageCounts.ALL },
              ].map((tab) => {
                const isActive = effectiveStatusFilter === tab.id;
                const isDisabled = tab.id !== "ALL" && tab.count === 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                    className={`rounded-md px-2 py-1 text-[11px] transition flex items-center gap-1 ${isDisabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"} ${
                      isActive
                        ? tab.id === "LOSS" ? "bg-rose-600 text-white shadow-sm" : "bg-white text-slate-900 shadow-sm"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded px-1 text-[10px] font-bold ${
                        isActive && tab.id === "LOSS" ? "bg-white/20 text-white" : isActive ? "bg-indigo-100 text-indigo-700" : "bg-slate-200/80 text-slate-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <select
              aria-label="Lọc theo giai đoạn đánh giá"
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value as typeof stageFilter)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 focus:border-indigo-600 focus:outline-none"
            >
              <option value="ALL">Mọi giai đoạn</option>
              <option value="3D">3D · {stageCounts["3D"]}</option>
              <option value="7D">7D · {stageCounts["7D"]}</option>
              <option value="14D">14D · {stageCounts["14D"]}</option>
              <option value="30D">30D · {stageCounts["30D"]}</option>
              <option value="COMPLETED">Đã xong · {stageCounts.COMPLETED}</option>
              <option value="INTERRUPTED">Bị ngắt · {stageCounts.INTERRUPTED}</option>
            </select>
          </div>
        </div>

        {/* MASTER / DETAIL TRÊN CÙNG MỘT MÀN HÌNH */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={`min-h-0 flex-1 overflow-y-auto thin-scrollbar ${selectedAction ? "lg:w-[58%]" : "w-full"}`}>
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
              <CircleNotch size={28} className="animate-spin text-indigo-600" />
              <span className="text-xs font-bold">Đang tải kết quả theo dõi bid...</span>
            </div>
          ) : visibleTargetItems.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
              <Clock size={36} className="text-slate-300" weight="duotone" />
              <span className="text-sm font-bold text-slate-600">Không có target nào trong mục này</span>
            </div>
          ) : (
            <div className="overflow-x-auto p-3 sm:p-4">
              <div className="min-w-[1180px] overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="grid grid-cols-[minmax(280px,1.4fr)_105px_70px_90px_95px_65px_75px_85px_minmax(140px,0.7fr)] items-center gap-3 border-b-2 border-indigo-500 bg-slate-100 px-4 py-3.5 text-sm font-black text-slate-800">
                  <span>Campaign</span><span>Ngày chỉnh</span><span>Targets</span><span>Spend</span><span>Sales</span><span>Orders</span><span>ACoS</span><span>Δ ACoS</span><span>Trend</span>
                </div>
                {(activeDateGroup?.campaigns || []).map((campaign) => {
                  const campaignKey = `${activeDateGroup.date}:${campaign.campaignId}`;
                  const campaignOpen = expandedCampaign === campaignKey;
                  const trend = campaignTrend(campaign.campaignId || campaign.campaignName || "unknown");
                  const metrics = aggregateOutcomeMetrics(campaign.items);
                  const rewardTone = getRewardTone(metrics.reward);
                  return (
                    <div key={campaignKey} className="border-b border-slate-200 last:border-b-0">
                      <button
                        type="button"
                        aria-expanded={campaignOpen}
                        onClick={() => setExpandedCampaign(campaignOpen ? null : campaignKey)}
                        className={`grid w-full grid-cols-[minmax(280px,1.4fr)_105px_70px_90px_95px_65px_75px_85px_minmax(140px,0.7fr)] items-center gap-3 px-4 py-4 text-left transition ${campaignOpen ? "bg-indigo-50/40" : "hover:bg-slate-50"}`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <CaretRight size={14} weight="bold" className={`shrink-0 text-slate-400 transition-transform ${campaignOpen ? "rotate-90" : ""}`} />
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600"><Megaphone size={16} weight="bold" /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-slate-900">{campaign.campaignName}</span>
                            <span className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500"><span>{campaign.items.length} targets</span><span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${rewardTone.className}`}>{rewardTone.label}</span></span>
                          </span>
                        </span>
                        <span className="text-sm font-bold text-slate-700">{formatDisplayDate(activeDateGroup.date)}</span>
                        <span className="text-sm font-black text-slate-800">{campaign.items.length}</span>
                        {metrics.measured === 0 ? (
                          <>
                            {(() => {
                              const cur = campaign.items.reduce((sum, item) => {
                                const state = historyByTarget.get(targetKeyOf(item))?.latest.action.current;
                                if (state) {
                                  sum.spend += state.spend;
                                  sum.sales += state.sales;
                                  sum.orders += state.orders;
                                }
                                return sum;
                              }, { spend: 0, sales: 0, orders: 0 });
                              const acos = cur.sales > 0 ? (cur.spend / cur.sales) * 100 : cur.spend > 0 ? 999 : 0;
                              return (
                                <>
                                  <span title="30 ngày gần nhất"><span className="block font-mono text-sm font-semibold text-slate-700">{formatCurrencyUsd(cur.spend, false, 2)}</span><span className="text-[10px] font-semibold text-slate-400">30 ngày</span></span>
                                  <span title="30 ngày gần nhất"><span className="block font-mono text-sm font-semibold text-slate-700">{formatCurrencyUsd(cur.sales, false, 2)}</span><span className="text-[10px] font-semibold text-slate-400">30 ngày</span></span>
                                  <span className="text-sm font-bold text-slate-700">{cur.orders}</span>
                                  <span className={`w-fit rounded-md px-2 py-1 text-sm font-black ${getAcosTone(acos, cur.spend)}`}>{cur.spend === 0 ? "—" : acos >= 999 ? "∞" : formatPercent(acos)}</span>
                                </>
                              );
                            })()}
                            <span className="text-xs font-semibold text-sky-700">
                              {(() => {
                                const due = campaign.items
                                  .map((item) => historyByTarget.get(targetKeyOf(item))?.latest.summary)
                                  .find((result) => result?.state === "WAITING");
                                return due ? `Chờ · ${shortDate(due.dueDate)}` : "Thiếu báo cáo";
                              })()}
                            </span>
                          </>
                        ) : (
                          <>
                        <span><span className="block font-mono text-sm font-semibold text-slate-700">{formatCurrencyUsd(metrics.spend, false, 2)}</span><span className={`text-[10px] font-black ${(metrics.deltaSpendPct || 0) <= 0 ? "text-emerald-700" : "text-rose-700"}`}>{metrics.deltaSpendPct == null ? "—" : formatPercent(metrics.deltaSpendPct, true)}</span></span>
                        <span><span className="block font-mono text-sm font-semibold text-slate-700">{formatCurrencyUsd(metrics.sales, false, 2)}</span><span className={`text-[10px] font-black ${(metrics.deltaSalesPct || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{metrics.deltaSalesPct == null ? "—" : formatPercent(metrics.deltaSalesPct, true)}</span></span>
                        <span className="text-sm font-bold text-slate-700">{metrics.orders}</span>
                        <span className={`w-fit rounded-md px-2 py-1 text-sm font-black ${getAcosTone(metrics.acos, metrics.spend)}`}>{metrics.acos >= 999 ? "—" : formatPercent(metrics.acos)}</span>
                        <span className={`w-fit rounded-md px-2 py-1 text-sm font-black ${metrics.deltaAcos <= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{metrics.deltaAcos >= 999 ? "—" : `${metrics.deltaAcos > 0 ? "+" : ""}${metrics.deltaAcos.toFixed(1)} điểm`}</span>
                          </>
                        )}
                        <span className="rounded-lg bg-slate-50 px-2 py-1"><BidSparkline values={trend.map((point) => point.acos).filter((value) => value < 999)} height={38} tone={metrics.deltaAcos <= 0 ? "green" : "red"} /></span>
                      </button>
                      {campaignOpen && (
                        <div className="m-3 overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full min-w-[1280px] border-collapse text-sm">
                            <thead className="bg-slate-100 text-left text-xs font-black text-slate-700">
                              <tr>
                                <th className="px-4 py-2.5">Target</th>
                                <th className="px-2 py-2.5 text-right" title="Search volume tháng">SV</th>
                                <th className="px-2 py-2.5 text-right" title="Organic rank">Org</th>
                                <th className="px-2 py-2.5 text-right" title="Sponsored rank">SP</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">Impr</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">Clicks</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">Spend</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">Sales</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">Orders</th>
                                <th className="px-2 py-2.5 text-right" title="30 ngày gần nhất">ACoS</th>
                                <th className="px-3 py-2.5">Lịch sử bid</th>
                                <th className="px-3 py-2.5">Hành động</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {campaign.items.map((item) => {
                                const history = historyByTarget.get(targetKeyOf(item));
                                if (!history) return null;
                                const cur = history.latest.action.current;
                                const isSelected = selectedAction != null && targetKeyOf(selectedAction) === history.key;
                                const paused = cur?.state && cur.state.toLowerCase() !== "enabled";
                                return (
                                  <tr key={item.action_id} onClick={() => setSelectedAction(isSelected ? null : item)} className={`cursor-pointer ${isSelected ? "bg-indigo-50/70" : "bg-white hover:bg-slate-50"}`}>
                                    <td className="max-w-[240px] px-4 py-2.5">
                                      <span className="block truncate text-sm font-bold text-slate-900" title={history.keyword}>{history.keyword || "—"}</span>
                                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                                        <span className="rounded bg-slate-100 px-1.5 font-bold uppercase text-slate-600">{history.matchType}</span>
                                        {paused && <span className="rounded bg-slate-200 px-1.5 font-bold text-slate-600">{cur?.state}</span>}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur?.searchVolume != null ? cur.searchVolume.toLocaleString("en-US") : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur?.organicRank != null ? `#${cur.organicRank}` : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur?.sponsoredRank != null ? `#${cur.sponsoredRank}` : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur ? cur.impressions.toLocaleString("en-US") : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur ? cur.clicks.toLocaleString("en-US") : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur ? formatCurrencyUsd(cur.spend, false, 2) : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur ? formatCurrencyUsd(cur.sales, false, 2) : "—"}</td>
                                    <td className="px-2 py-2.5 text-right font-mono text-xs text-slate-700">{cur ? cur.orders : "—"}</td>
                                    <td className="px-2 py-2.5 text-right">
                                      {cur && cur.spend > 0 ? (
                                        <span className={`inline-block rounded-md px-1.5 py-0.5 font-mono text-xs font-black ${getAcosTone(cur.acos ?? 999, cur.spend)}`}>{cur.acos != null ? `${cur.acos.toFixed(0)}%` : "∞"}</span>
                                      ) : <span className="text-xs text-slate-400">—</span>}
                                    </td>
                                    <td className="w-[260px] px-3 py-2">
                                      <BidTrail history={history} />
                                    </td>
                                    <td className="w-[230px] px-3 py-2">
                                      <ActionControl
                                        history={history}
                                        baseBid={verifiedAmazonBid(history.latest) ?? history.currentBid}
                                        state={applyState[history.key]}
                                        onApply={(bid) => applyBid(history, bid)}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {selectedAction && (
          <aside className="min-h-0 border-t border-slate-200 bg-white lg:w-[42%] lg:border-l lg:border-t-0">
            {(() => {
              const history = historyByTarget.get(targetKeyOf(selectedAction));
              return history ? (
                <TargetHistoryPanel key={history.key} history={history} onClose={() => setSelectedAction(null)} />
              ) : (
                <ActionDecisionSupportModal action={selectedAction} onClose={() => setSelectedAction(null)} embedded />
              );
            })()}
          </aside>
        )}
        </div>

        {/* FOOTER INFO BAR */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-2.5 bg-slate-50 text-[11px] text-slate-500 font-medium">
          <div>
            <span>Hiển thị <strong>{rankedVisibleTargetItems.length}</strong> targets · <strong>{campaignGroups.length}</strong> chiến dịch</span>
          </div>
          <div>
            <span className="text-slate-400">Tổng toàn bộ: {summary?.total || items.length} lần chỉnh</span>
          </div>
        </div>
      </div>

    </div>
  );
}

export type DetailWindowDays = 3 | 7 | 14 | 30;

function computeDateRanges(
  appliedDateStr: string,
  windowDays: number,
  baseline: Record<string, unknown>,
  observed: Record<string, unknown>
) {
  const formatDate = (dateStr: string) => {
    if (!dateStr || typeof dateStr !== "string") return "";
    const [y, m, d] = dateStr.slice(0, 10).split("-");
    return y && m && d ? `${d}/${m}` : dateStr;
  };

  const addDays = (baseIso: string, days: number) => {
    try {
      const [y, m, d] = baseIso.slice(0, 10).split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + days);
      return dt.toISOString().slice(0, 10);
    } catch {
      return baseIso;
    }
  };

  const cleanApplied = (appliedDateStr || new Date().toISOString().slice(0, 10)).slice(0, 10);

  // Trước: [applied - windowDays, applied - 1]
  const beforeStart = String(baseline.window_start || addDays(cleanApplied, -windowDays));
  const beforeEnd = String(baseline.window_end || addDays(cleanApplied, -1));
  const beforeRange = `${formatDate(beforeStart)} – ${formatDate(beforeEnd)}`;

  // Sau: [applied + 1, applied + windowDays]
  const afterStart = String(observed.window_start || addDays(cleanApplied, 1));
  const afterEnd = String(observed.window_end || addDays(cleanApplied, windowDays));
  const afterRange = `${formatDate(afterStart)} – ${formatDate(afterEnd)}`;

  return { beforeRange, afterRange };
}

export function ActionDecisionSupportModal({
  action,
  onClose,
  embedded = false,
}: {
  action: BidOutcomeActionItem;
  onClose: () => void;
  embedded?: boolean;
}) {
  const windows: Record<DetailWindowDays, WindowDetail | null> = {
    3: action.d3,
    7: action.d7,
    14: action.d14,
    30: action.d30,
  };
  const hasObservedData = (window: WindowDetail | null) => Boolean(
    window && (window.observed?.spend !== undefined || window.observed?.clicks !== undefined || window.observed?.orders !== undefined)
  );
  const initialWindow: DetailWindowDays = hasObservedData(action.d30)
    ? 30
    : hasObservedData(action.d14)
      ? 14
      : hasObservedData(action.d7)
        ? 7
        : 3;
  const [selectedWindowDays, setSelectedWindowDays] = useState<DetailWindowDays>(initialWindow);
  const window = windows[selectedWindowDays];
  const baseline = window?.baseline && Object.keys(window.baseline).length > 0
    ? window.baseline
    : action.baseline || {};
  const observed = window?.observed || {};
  const baselineDays = Math.max(1, Number(baseline.days || 30));
  const isExactBaseline = baseline.source_method === "EXACT_PRE_WINDOW";
  const baselineScale = isExactBaseline ? 1 : selectedWindowDays / baselineDays;
  const hasBaseline = baseline.spend !== undefined || baseline.clicks !== undefined || baseline.orders !== undefined;
  const hasObserved = observed.spend !== undefined || observed.clicks !== undefined || observed.orders !== undefined;

  // BE ACoS chính là biên đóng góp trước quảng cáo. Evaluator lưu giá trị
  // đã chuẩn hóa (0.3 = 30%) cùng nguồn lấy từ economics của SKU.
  const rawMargin = Number(baseline.margin || 0.35);
  const marginPct = rawMargin > 1 ? rawMargin / 100 : rawMargin;
  const marginSource = String(baseline.margin_source || "LEGACY_FALLBACK");

  const beforeSpend = hasBaseline ? Number(baseline.spend || 0) * baselineScale : null;
  const beforeClicks = hasBaseline ? Math.round(Number(baseline.clicks || 0) * baselineScale) : null;
  const beforeOrders = hasBaseline ? Math.round(Number(baseline.orders || 0) * baselineScale) : null;
  const beforeSales = hasBaseline ? Number(baseline.sales || 0) * baselineScale : null;
  const beforeContribution = hasBaseline
    ? (baseline.contribution !== undefined ? Number(baseline.contribution) * baselineScale : (beforeSales != null && beforeSpend != null ? beforeSales * marginPct - beforeSpend : null))
    : null;

  const afterSpend = hasObserved ? Number(observed.spend || 0) : null;
  const afterClicks = hasObserved ? Math.round(Number(observed.clicks || 0)) : null;
  const afterOrders = hasObserved ? Math.round(Number(observed.orders || 0)) : null;
  const afterSales = hasObserved ? Number(observed.sales || 0) : null;
  const afterContribution = hasObserved
    ? (observed.contribution !== undefined ? Number(observed.contribution) : (afterSales != null && afterSpend != null ? afterSales * marginPct - afterSpend : null))
    : null;

  const beforeAcos = beforeSales != null && beforeSales > 0 && beforeSpend != null
    ? (beforeSpend / beforeSales) * 100
    : null;
  const afterAcos = afterSales != null && afterSales > 0 && afterSpend != null
    ? (afterSpend / afterSales) * 100
    : null;

  const { beforeRange, afterRange } = computeDateRanges(
    action.applied_on || action.action_timestamp || "",
    selectedWindowDays,
    baseline,
    observed
  );

  const getStatus = (detail: WindowDetail | null) => {
    if (!detail) return { label: "Chưa có", color: "text-slate-600 bg-slate-100 border-slate-200" };
    if (detail.status === "INTERRUPTED" || detail.evidence_quality?.validity === "INTERRUPTED" || detail.evidence_quality?.validity === "SUPERSEDED") {
      return { label: "Bị ngắt", color: "text-slate-500 bg-slate-100 border-slate-200" };
    }
    if (!hasObservedData(detail)) {
      return { label: "Đang chờ", color: "text-sky-700 bg-sky-50 border-sky-200" };
    }
    if (detail.outcome_label === "POSITIVE") return { label: "Win", color: "text-emerald-700 bg-emerald-50 border-emerald-300" };
    if (detail.outcome_label === "NEGATIVE") return { label: "Loss", color: "text-rose-700 bg-rose-50 border-rose-300" };
    if (detail.outcome_label === "NEUTRAL") return { label: "Bình thường", color: "text-slate-700 bg-slate-100 border-slate-200" };
    if (detail.outcome_label === "INCONCLUSIVE" || detail.status === "INSUFFICIENT_DATA") {
      const reward = detail.comparison?.reward_usd;
      if (typeof reward === "number") {
        if (reward > 0) return { label: "Win", color: "text-emerald-700 bg-emerald-50 border-emerald-300" };
        if (reward < 0) return { label: "Loss", color: "text-rose-700 bg-rose-50 border-rose-300" };
        return { label: "Bình thường", color: "text-slate-700 bg-slate-100 border-slate-200" };
      }
      return { label: "Chưa đủ dữ liệu", color: "text-amber-700 bg-amber-50 border-amber-200" };
    }
    return { label: "Đang chờ", color: "text-sky-700 bg-sky-50 border-sky-200" };
  };

  const selectedStatus = getStatus(window);
  const reward = window?.comparison?.reward_usd;
  const oldBid = Number(action.old_value || 0);
  const newBid = Number(action.final_value || action.system_suggested_value || 0);
  const deltaPct = action.applied_delta_pct || (oldBid > 0 ? ((newBid - oldBid) / oldBid) * 100 : 0);

  const percentChange = (oldVal: number | null, newVal: number | null) => {
    if (oldVal == null || newVal == null) return null;
    if (oldVal === 0) return newVal === 0 ? 0 : null;
    return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
  };
  const formatNumber = (value: number | null) => value == null ? "—" : String(value);

  const rows = [
    {
      label: "Spend",
      before: formatCurrencyUsd(beforeSpend, false, 2),
      after: formatCurrencyUsd(afterSpend, false, 2),
      delta: percentChange(beforeSpend, afterSpend),
      isAcosOrContrib: false,
      lowerIsBetter: true,
      suffix: "%",
    },
    {
      label: "Clicks",
      before: formatNumber(beforeClicks),
      after: formatNumber(afterClicks),
      delta: percentChange(beforeClicks, afterClicks),
      isAcosOrContrib: false,
      lowerIsBetter: false,
      suffix: "%",
    },
    {
      label: "Orders",
      before: formatNumber(beforeOrders),
      after: formatNumber(afterOrders),
      delta: percentChange(beforeOrders, afterOrders),
      isAcosOrContrib: false,
      lowerIsBetter: false,
      suffix: "%",
    },
    {
      label: "Sales",
      before: formatCurrencyUsd(beforeSales, false, 2),
      after: formatCurrencyUsd(afterSales, false, 2),
      delta: percentChange(beforeSales, afterSales),
      isAcosOrContrib: false,
      lowerIsBetter: false,
      suffix: "%",
    },
    {
      label: "ACoS",
      before: beforeAcos == null ? "—" : `${beforeAcos.toFixed(1)}%`,
      after: afterAcos == null ? "—" : `${afterAcos.toFixed(1)}%`,
      delta: beforeAcos != null && afterAcos != null ? afterAcos - beforeAcos : null,
      isAcosOrContrib: true,
      lowerIsBetter: true,
      suffix: " điểm %",
    },
    {
      label: "Contribution",
      before: formatCurrencyUsd(beforeContribution, false, 2),
      after: formatCurrencyUsd(afterContribution, false, 2),
      delta: beforeContribution != null && afterContribution != null ? afterContribution - beforeContribution : null,
      isAcosOrContrib: true,
      isUsdDelta: true,
      lowerIsBetter: false,
      suffix: " USD",
    },
  ];

  return (
    <div className={embedded
      ? "h-full min-h-0 bg-white"
      : "fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
    }>
      <div className={embedded
        ? "h-full overflow-y-auto bg-white thin-scrollbar"
        : "max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl thin-scrollbar"
      }>
        {/* MODAL HEADER */}
        <div className={`sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white ${embedded ? "px-4 py-3" : "px-6 py-4"}`}>
          <div className="min-w-0">
            <span className="block text-[11px] font-bold text-slate-500">
              Phân tích trước – sau
            </span>
            <h3 className="mt-1 truncate text-base font-black text-slate-900">
              {action.target_keyword}
            </h3>
            <div className="mt-1 flex items-center gap-2 text-xs font-mono">
              <span className="font-bold text-slate-800">
                Bid ${oldBid.toFixed(2)} → ${newBid.toFixed(2)}
              </span>
              <span className={`font-bold ${deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
              </span>
              {action.applied_on && (
                <span className="text-slate-400 font-sans text-[11px]">
                  • Ngày chỉnh: {action.applied_on}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className={`${embedded ? "space-y-3 p-4" : "space-y-4 p-6"}`}>
          {/* TABS 3D, 7D, 14D, 30D */}
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
            {([3, 7, 14, 30] as DetailWindowDays[]).map((days) => {
              const st = getStatus(windows[days]);
              const isSelected = selectedWindowDays === days;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => setSelectedWindowDays(days)}
                  className={`flex flex-col items-center justify-center py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    isSelected ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <span className="text-xs font-black">{days}D</span>
                  <span className={`text-[10px] font-bold mt-0.5 px-1.5 py-0.2 rounded border ${st.color}`}>
                    {st.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 2 KHỐI SO SÁNH THỜI GIAN TRƯỚC - SAU */}
          <div className="grid grid-cols-2 gap-3">
            {/* THẺ TRƯỚC */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
              <span className="text-[11px] font-bold text-slate-500 block">
                Trước chỉnh bid · {selectedWindowDays} ngày
              </span>
              <div className="text-base font-black text-slate-900 mt-1 font-mono">
                {beforeRange || "—"}
              </div>
              <div className="text-xs text-slate-500 mt-1 font-mono">
                Bid: <b className="text-slate-800">${oldBid.toFixed(2)}</b>
              </div>
            </div>

            {/* THẺ SAU */}
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3.5">
              <span className="text-[11px] font-bold text-indigo-700 block">
                Sau chỉnh bid · {selectedWindowDays} ngày
              </span>
              <div className="text-base font-black text-indigo-950 mt-1 font-mono">
                {afterRange || "—"}
              </div>
              <div className="text-xs text-indigo-700 mt-1 font-mono">
                Bid: <b className="text-indigo-900">${newBid.toFixed(2)}</b>
              </div>
            </div>
          </div>

          {/* NGUỒN DỮ LIỆU */}
          <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
            <span>
              {isExactBaseline ? (
                <span className="text-emerald-700 font-semibold">
                  ✓ Dữ liệu đối soát cùng khoảng thời gian ({selectedWindowDays} ngày trước ↔ {selectedWindowDays} ngày sau)
                </span>
              ) : (
                <span className="text-amber-700 font-medium">
                  ⚠️ Dữ liệu trước quy đổi từ Baseline 30D (Dự phòng)
                </span>
              )}
            </span>
            <span className={marginSource === "LEGACY_FALLBACK" ? "text-amber-600" : "text-slate-500"}>
              BE ACoS: <b>{Math.round(marginPct * 100)}%</b>
              {marginSource === "LEGACY_FALLBACK" ? " (mặc định)" : ""}
            </span>
          </div>

          {/* BẢNG SO SÁNH 6 CHỈ SỐ */}
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 text-[11px] font-bold uppercase">
                <tr>
                  <th className="py-2.5 px-4 text-left">Chỉ Số</th>
                  <th className="py-2.5 px-4 text-right">Trước</th>
                  <th className="py-2.5 px-4 text-right">Sau</th>
                  <th className="py-2.5 px-4 text-right">Thay Đổi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  let deltaText = "—";
                  let deltaColor = "text-slate-500";

                  if (row.delta != null) {
                    const isPositive = row.delta > 0;
                    const isZero = row.delta === 0;

                    if (row.isUsdDelta) {
                      deltaText = formatCurrencyUsd(row.delta, true, 2);
                    } else if (row.isAcosOrContrib) {
                      deltaText = `${isPositive ? "+" : "−"}${Math.abs(row.delta).toFixed(1)}${row.suffix}`;
                    } else {
                      deltaText = `${isPositive ? "+" : ""}${row.delta.toFixed(1)}${row.suffix}`;
                    }

                    if (isZero) {
                      deltaColor = "text-slate-500";
                    } else if (row.lowerIsBetter) {
                      deltaColor = row.delta < 0 ? "text-emerald-700" : "text-rose-700";
                    } else {
                      deltaColor = row.delta > 0 ? "text-emerald-700" : "text-rose-700";
                    }
                  }

                  return (
                    <tr key={row.label} className="hover:bg-slate-50/60 transition">
                      <td className="py-2.5 px-4 font-bold text-slate-800">{row.label}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-600">
                        {row.before}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                        {row.after}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-mono font-black ${deltaColor}`}>
                        {deltaText}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!hasObserved && (
            <div className="rounded-xl bg-amber-50/80 border border-amber-200 px-3.5 py-2 text-xs text-amber-800 font-medium">
              Chưa có báo cáo sau chỉnh bid đủ {selectedWindowDays} ngày. Kết quả sẽ được đối soát tự động khi sync báo cáo mới.
            </div>
          )}

          {/* TÓM TẮT KẾT LUẬN & REWARD */}
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Kết luận {selectedWindowDays}D:</span>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-black border ${selectedStatus.color}`}>
                {selectedStatus.label}
              </span>
            </div>
            {reward != null && (
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-slate-500 font-sans font-medium">Reward:</span>
                <span className={`font-black ${reward >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {formatCurrencyUsd(reward, true)}
                </span>
              </div>
            )}
          </div>

          {!embedded && <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer"
            >
              Đóng
            </button>
          </div>}
        </div>
      </div>
    </div>
  );
}
