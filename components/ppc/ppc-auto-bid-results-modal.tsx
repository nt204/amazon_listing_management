"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  MagnifyingGlass,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
  XCircle,
  Clock,
  Sparkle,
  ArrowRight,
  ArrowDown,
  Target,
  CircleNotch,
  Prohibit,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";

export interface WindowDetail {
  outcome_id: string;
  window_days: number;
  status: string;
  outcome_label: string | null;
  observation_start: string;
  observation_end: string;
  maturity_date: string | null;
  baseline: Record<string, any>;
  observed: Record<string, any>;
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
  baseline: Record<string, any>;
  d3: WindowDetail | null;
  d7: WindowDetail | null;
  d14: WindowDetail | null;
  d30: WindowDetail | null;
  eligible_for_learning: boolean;
  evaluated_at: string | null;
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

  // Quản lý đóng/mở từng chiến dịch (mặc định đóng toàn bộ)
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});

  const fetchOutcomes = useCallback(async () => {
    if (!isOpen) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (selectedStore && selectedStore !== "ALL") {
        params.set("storeName", selectedStore);
      }
      if (search.trim()) {
        params.set("search", search.trim());
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
  }, [isOpen, selectedStore, search]);

  useEffect(() => {
    if (isOpen) {
      fetchOutcomes();
    }
  }, [isOpen, fetchOutcomes]);

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

  // Lọc items theo cả Chặng (Stage) và Kết quả (Status)
  const visibleTargetItems = useMemo(() => {
    return allLatestTargetItems.filter((item) => {
      // 1. Lọc theo chặng
      if (stageFilter !== "ALL") {
        const st = getItemStage(item);
        if (st !== stageFilter) return false;
      }

      // 2. Lọc theo kết quả
      if (statusFilter !== "ALL") {
        const label = item.d30?.outcome_label || item.d14?.outcome_label || item.d7?.outcome_label;
        if (statusFilter === "WIN") return label === "POSITIVE";
        if (statusFilter === "LOSS") return label === "NEGATIVE";
        if (statusFilter === "NEUTRAL") return label === "NEUTRAL";
        if (statusFilter === "WARNING_3D") {
          const days = getDaysElapsed(item);
          const ev3 = getWindowEvaluation(item.d3, 3, days);
          return ev3.label === "Loss";
        }
      }

      return true;
    });
  }, [allLatestTargetItems, stageFilter, statusFilter, getItemStage, getDaysElapsed, getWindowEvaluation]);

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
  }, [visibleTargetItems, getDaysElapsed, getWindowEvaluation]);

  // Mặc định luôn THU GỌN; chỉ tự động mở khi người dùng gõ tìm kiếm keyword
  useEffect(() => {
    if (search.trim()) {
      const all: Record<string, boolean> = {};
      for (const c of campaignGroups) {
        all[c.campaignId] = true;
      }
      setExpandedCampaigns(all);
    } else {
      setExpandedCampaigns({});
    }
  }, [search]);

  const toggleCampaign = (campaignId: string) => {
    setExpandedCampaigns((prev) => ({
      ...prev,
      [campaignId]: !prev[campaignId],
    }));
  };

  const handleExpandAll = () => {
    const all: Record<string, boolean> = {};
    for (const c of campaignGroups) {
      all[c.campaignId] = true;
    }
    setExpandedCampaigns(all);
  };

  const handleCollapseAll = () => {
    setExpandedCampaigns({});
  };

  // Render từng dòng Target (Gọn gàng, sạch sẽ, chuẩn 4 mốc 3D/7D/14D/30D)
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

    return (
      <tr
        key={item.action_id}
        onClick={() => setSelectedAction(item)}
        className="hover:bg-indigo-50/30 transition cursor-pointer group"
      >
        {/* TARGET / KEYWORD */}
        <td className="py-2.5 px-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 group-hover:text-indigo-700 transition">
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

        {/* ACTION BUTTON */}
        <td className="py-2.5 px-3 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAction(item);
            }}
            className="rounded-lg bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 hover:bg-indigo-600 hover:text-white transition cursor-pointer"
          >
            Chi tiết
          </button>
        </td>
      </tr>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
              <Target size={22} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-black text-slate-900">Theo Dõi Kết Quả Chỉnh Bid (Auto Bid)</h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-black text-indigo-800">
                  {selectedStore || "Tất cả Store"}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  ({summary?.total || 0} lần chỉnh · {allLatestTargetItems.length} targets)
                </span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-black ${(summary?.totalRewardUsd || 0) >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  Reward {formatCurrencyUsd(summary?.totalRewardUsd || 0, true)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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

        {/* TOOLBAR: GỌN GÀNG, ĐẸP MẮT */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-6 py-2 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm Keyword, ASIN, SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 pl-8 pr-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:outline-none"
              />
            </div>

            {/* CÁC TAB CHIA MỤC THEO CHẶNG */}
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs font-bold text-slate-600 flex-wrap">
              {[
                { id: "ALL", label: "Tất cả", count: stageCounts.ALL },
                { id: "3D", label: "3D", count: stageCounts["3D"] },
                { id: "7D", label: "7D", count: stageCounts["7D"] },
                { id: "14D", label: "14D", count: stageCounts["14D"] },
                { id: "30D", label: "30D", count: stageCounts["30D"] },
                { id: "COMPLETED", label: "Đã xong", count: stageCounts.COMPLETED },
                { id: "INTERRUPTED", label: "Bị ngắt", count: stageCounts.INTERRUPTED },
              ].map((tab) => {
                const isActive = stageFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStageFilter(tab.id as any)}
                    className={`rounded-md px-2 py-1 text-[11px] transition cursor-pointer flex items-center gap-1 ${
                      isActive
                        ? "bg-white text-slate-900 shadow-2xs font-extrabold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`rounded px-1 text-[10px] font-bold ${
                        isActive ? "bg-indigo-100 text-indigo-700" : "bg-slate-200/80 text-slate-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* BỘ LỌC KẾT QUẢ PHỤ */}
            <div className="flex items-center gap-0.5 rounded-lg bg-slate-50 border border-slate-200 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                className={`rounded px-2 py-0.5 text-[11px] font-bold transition cursor-pointer ${
                  statusFilter === "ALL" ? "bg-slate-800 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("WIN")}
                className={`rounded px-2 py-0.5 text-[11px] font-bold transition cursor-pointer ${
                  statusFilter === "WIN" ? "bg-emerald-600 text-white" : "text-emerald-700 hover:bg-emerald-50"
                }`}
              >
                Win ({summary?.positive || 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("LOSS")}
                className={`rounded px-2 py-0.5 text-[11px] font-bold transition cursor-pointer ${
                  statusFilter === "LOSS" ? "bg-rose-600 text-white" : "text-rose-700 hover:bg-rose-50"
                }`}
              >
                Cần sửa ({summary?.negative || 0})
              </button>
            </div>
          </div>

          {/* EXPAND CONTROLS */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExpandAll}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs cursor-pointer"
            >
              Mở tất cả ({campaignGroups.length})
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs cursor-pointer"
            >
              Thu gọn
            </button>
          </div>
        </div>

        {/* MAIN BODY: DANH SÁCH CHIẾN DỊCH */}
        <div className="flex-1 overflow-y-auto px-6 py-4 thin-scrollbar">
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
            <div className="space-y-2.5">
              {campaignGroups.map((camp) => {
                const isCampOpen = expandedCampaigns[camp.campaignId] ?? false;

                return (
                  <div
                    key={camp.campaignId}
                    className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs transition"
                  >
                    {/* HEADER CHIẾN DỊCH */}
                    <div
                      onClick={() => toggleCampaign(camp.campaignId)}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/90 hover:bg-slate-100/70 transition cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-slate-400 hover:text-slate-700 shrink-0">
                          {isCampOpen ? (
                            <CaretDown size={13} weight="bold" />
                          ) : (
                            <CaretRight size={13} weight="bold" />
                          )}
                        </div>
                        <span className="text-xs font-bold text-slate-800 truncate" title={camp.campaignName}>
                          {camp.campaignName}
                        </span>
                        {camp.campaignType && (
                          <span className="rounded bg-slate-200/70 px-1.5 py-0.2 text-[10px] font-bold text-slate-600 shrink-0">
                            {camp.campaignType}
                          </span>
                        )}
                        {camp.sku && (
                          <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.2 rounded border border-slate-200 shrink-0">
                            {camp.sku}
                          </span>
                        )}
                      </div>

                      {/* SỐ LƯỢNG VÀ BADGE CẢNH BÁO */}
                      <div className="flex items-center gap-2 shrink-0">
                        {camp.latestActionDate && (
                          <span className="text-[10px] text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 font-mono">
                            {camp.latestActionDate}
                          </span>
                        )}
                        <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                          {camp.stats.total} targets
                        </span>
                        {camp.stats.warning3d > 0 && (
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                            {camp.stats.warning3d} cảnh báo
                          </span>
                        )}
                        {camp.stats.loss > 0 && (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            {camp.stats.loss} cần sửa
                          </span>
                        )}
                      </div>
                    </div>

                    {/* BẢNG TARGETS KHI MỞ */}
                    {isCampOpen && (
                      <div className="border-t border-slate-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              <th className="py-2.5 px-4">Target / Từ Khóa</th>
                              <th className="py-2.5 px-3">Đổi Bid</th>
                              <th className="py-2.5 px-2 text-center">3D</th>
                              <th className="py-2.5 px-2 text-center">7D</th>
                              <th className="py-2.5 px-2 text-center">14D</th>
                              <th className="py-2.5 px-2 text-center">30D</th>
                              <th className="py-2.5 px-3 text-right">Chi Tiết</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {camp.items.map((item) => renderTargetRow(item))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FOOTER INFO BAR */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-2.5 bg-slate-50 text-[11px] text-slate-500 font-medium">
          <div>
            <span>Hiển thị <strong>{visibleTargetItems.length}</strong> targets · <strong>{campaignGroups.length}</strong> chiến dịch</span>
          </div>
          <div>
            <span className="text-slate-400">Tổng toàn bộ: {summary?.total || items.length} lần chỉnh</span>
          </div>
        </div>
      </div>

      {/* POPUP HỖ TRỢ QUYẾT ĐỊNH: KẾT LUẬN + LÝ DO + HÀNH ĐỘNG TIẾP THEO + BẢNG MA TRẬN */}
      {selectedAction && (
        <ActionDecisionSupportModal
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
        />
      )}
    </div>
  );
}

export type DetailWindowDays = 3 | 7 | 14 | 30;

function computeDateRanges(
  appliedDateStr: string,
  windowDays: number,
  baseline: Record<string, any>,
  observed: Record<string, any>
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
  const beforeStart = baseline.window_start || addDays(cleanApplied, -windowDays);
  const beforeEnd = baseline.window_end || addDays(cleanApplied, -1);
  const beforeRange = `${formatDate(beforeStart)} – ${formatDate(beforeEnd)}`;

  // Sau: [applied + 1, applied + windowDays]
  const afterStart = observed.window_start || addDays(cleanApplied, 1);
  const afterEnd = observed.window_end || addDays(cleanApplied, windowDays);
  const afterRange = `${formatDate(afterStart)} – ${formatDate(afterEnd)}`;

  return { beforeRange, afterRange };
}

export function ActionDecisionSupportModal({
  action,
  onClose,
}: {
  action: BidOutcomeActionItem;
  onClose: () => void;
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
  const rawMargin = Number((baseline as any)?.margin || (action as any)?.context?.economics?.break_even_acos || 0.35);
  const marginPct = rawMargin > 1 ? rawMargin / 100 : rawMargin;
  const marginSource = String((baseline as any)?.margin_source || "LEGACY_FALLBACK");

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

  const getStatus = (detail: WindowDetail | null, days: DetailWindowDays) => {
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

  const selectedStatus = getStatus(window, selectedWindowDays);
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
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl thin-scrollbar">
        {/* MODAL HEADER */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/80">
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              So Sánh Hiệu Quả Trước – Sau Chỉnh Bid
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

        <div className="p-6 space-y-4">
          {/* TABS 3D, 7D, 14D, 30D */}
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
            {([3, 7, 14, 30] as DetailWindowDays[]).map((days) => {
              const st = getStatus(windows[days], days);
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

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
