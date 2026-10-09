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
  TrendUp,
  TrendDown,
  Sparkle,
  ArrowRight,
  ArrowDown,
  Lightbulb,
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
  const [statusFilter, setStatusFilter] = useState<"ALL" | "WIN" | "NEUTRAL" | "LOSS" | "WARNING_3D" | "OBSERVING" | "INTERRUPTED">("ALL");
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

  // Helper cho trạng thái 3D
  const get3dStatus = (item: BidOutcomeActionItem) => {
    const d3 = item.d3;
    if (!d3) return { badge: "⏳ Chưa ghi nhận", color: "text-slate-400 bg-slate-50 border-slate-200", tip: "Đang chờ đồng bộ dữ liệu mốc 3d" };

    const isInterrupted = d3.status === "INTERRUPTED" || d3.evidence_quality?.validity === "INTERRUPTED";
    if (isInterrupted) {
      return { badge: "⛔ Đã ngắt", color: "text-slate-500 bg-slate-100 border-slate-300", tip: "Đã có lần chỉnh bid mới đè lên" };
    }

    const obs = d3.observed || {};
    const bSpendDay = item.baseline?.spend ? Number(item.baseline.spend) / 30 : 0;
    const obsSpend = Number(obs.spend || 0);
    const obsClicks = Number(obs.clicks || 0);

    if (bSpendDay > 1 && obsSpend / 3 > bSpendDay * 2.2) {
      return { badge: "⚠️ Spend tăng nhanh", color: "text-amber-800 bg-amber-50 border-amber-300 font-bold", tip: `Spend $${(obsSpend / 3).toFixed(1)}/d so với mức cũ $${bSpendDay.toFixed(1)}/d` };
    }

    if (obsClicks === 0 && d3.status !== "OBSERVING") {
      return { badge: "⚠️ Mất traffic (0 click)", color: "text-rose-800 bg-rose-50 border-rose-300 font-bold", tip: "Không có click nào trong 3d qua" };
    }

    if (d3.status === "OBSERVING") {
      return { badge: "⏳ Đang theo dõi", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: "Đang thu thập dữ liệu 3d đầu" };
    }

    return { badge: "✅ Ổn định", color: "text-emerald-800 bg-emerald-50 border-emerald-300", tip: "Tốc độ chi tiêu và traffic trong ngưỡng an toàn" };
  };

  // Helper cho trạng thái 7D
  const get7dStatus = (item: BidOutcomeActionItem) => {
    const d7 = item.d7;
    if (!d7) return { badge: "⏳ Chưa tới hạn", color: "text-slate-400 bg-slate-50 border-slate-200", tip: "Chưa tới mốc 7d" };

    const isInterrupted = d7.status === "INTERRUPTED" || d7.evidence_quality?.validity === "INTERRUPTED";
    if (isInterrupted) {
      return { badge: "⛔ Đã ngắt", color: "text-slate-500 bg-slate-100 border-slate-300", tip: "Đã chỉnh bid mới trước khi xong 7D" };
    }

    if (d7.status === "OBSERVING") {
      return { badge: "⏳ Đang theo dõi", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: "Chưa hoàn tất chu kỳ 7d" };
    }

    if (d7.outcome_label === "POSITIVE") {
      return { badge: "🟢 Xu hướng tốt", color: "text-emerald-800 bg-emerald-50 border-emerald-300 font-bold", tip: "ACOS hoặc đơn hàng có tín hiệu cải thiện" };
    }
    if (d7.outcome_label === "NEGATIVE") {
      return { badge: "🔴 Xu hướng xấu", color: "text-rose-800 bg-rose-50 border-rose-300 font-bold", tip: "Chi phí tăng hoặc hiệu quả thấp hơn kỳ vọng" };
    }
    if (d7.outcome_label === "NEUTRAL") {
      return { badge: "🟡 Cải thiện nhẹ", color: "text-amber-800 bg-amber-50 border-amber-300", tip: "Hiệu quả giữ nguyên, trong mức biến động cho phép" };
    }
    if (d7.status === "INSUFFICIENT_DATA" || d7.evidence_quality?.validity === "INCONCLUSIVE") {
      return { badge: "⚪ Chưa đủ số liệu", color: "text-slate-600 bg-slate-100 border-slate-200", tip: "Số lượng click hoặc đơn còn quá ít để kết luận" };
    }

    return { badge: "⏳ Đang theo dõi", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: "Đang thu thập số liệu" };
  };

  // Helper cho trạng thái 14D
  const get14dStatus = (item: BidOutcomeActionItem) => {
    const d14 = item.d14;
    if (!d14) return { badge: "⏳ Chưa tới hạn", color: "text-slate-400 bg-slate-50 border-slate-200", tip: "Chưa đủ 14d kể từ khi chỉnh bid" };

    const isInterrupted = d14.status === "INTERRUPTED" || d14.evidence_quality?.validity === "INTERRUPTED";
    if (isInterrupted) {
      return { badge: "⛔ Đã ngắt", color: "text-slate-500 bg-slate-100 border-slate-300", tip: "Bị đè bởi đợt chỉnh bid tiếp theo" };
    }

    if (d14.status === "OBSERVING") {
      return { badge: "⏳ Đang chạy", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: `Đang đợi đủ thời gian attribution chuẩn (tới ${d14.observation_end || "14D"})` };
    }

    if (d14.outcome_label === "POSITIVE") {
      return { badge: "🟢 WIN", color: "text-emerald-900 bg-emerald-100 border-emerald-400 font-black", tip: "Lần chỉnh thành công, mang lại hiệu quả rõ rệt" };
    }
    if (d14.outcome_label === "NEGATIVE") {
      return { badge: "🔴 LOSS", color: "text-rose-900 bg-rose-100 border-rose-400 font-black", tip: "Lần chỉnh không hiệu quả, nên xem xét điều chỉnh lại" };
    }
    if (d14.outcome_label === "NEUTRAL") {
      return { badge: "🟡 NEUTRAL", color: "text-amber-900 bg-amber-100 border-amber-300 font-bold", tip: "Kết quả hòa vốn so với baseline" };
    }
    if (d14.status === "INSUFFICIENT_DATA" || d14.evidence_quality?.validity === "INCONCLUSIVE") {
      return { badge: "⚪ Chưa đủ số liệu", color: "text-slate-600 bg-slate-100 border-slate-200", tip: "Lượng click hoặc đơn chưa đủ mẫu để kết luận" };
    }

    return { badge: "⏳ Đang chạy", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: "Đang tích lũy dữ liệu" };
  };

  // Helper cho trạng thái 30D
  const get30dStatus = (item: BidOutcomeActionItem) => {
    const d30 = item.d30;
    if (!d30) return { badge: "⏳ Chưa tới hạn", color: "text-slate-400 bg-slate-50 border-slate-200", tip: "Chưa đủ 30d kể từ khi chỉnh bid" };

    const isInterrupted = d30.status === "INTERRUPTED" || d30.evidence_quality?.validity === "INTERRUPTED";
    if (isInterrupted) {
      return { badge: "⛔ Đã ngắt", color: "text-slate-500 bg-slate-100 border-slate-300", tip: "Đã dừng đánh giá dài hạn do có bid mới đè lên" };
    }

    if (d30.status === "OBSERVING") {
      return { badge: "⏳ Đang chạy", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: `Đang hoàn tất chu kỳ dài hạn 30d (tới ${d30.observation_end || "30D"})` };
    }

    const reward = d30.comparison?.reward_usd;
    if (reward != null) {
      const num = Number(reward);
      if (num > 0) {
        return { badge: `🟢 ${formatCurrencyUsd(num, true)}`, color: "text-emerald-950 bg-emerald-100/90 border-emerald-400 font-black", tip: `Tăng thêm ${formatCurrencyUsd(num)} Net Profit` };
      }
      if (num < 0) {
        return { badge: `🔴 ${formatCurrencyUsd(num)}`, color: "text-rose-950 bg-rose-100/90 border-rose-400 font-black", tip: `Giảm ${formatCurrencyUsd(num)} Net Profit` };
      }
      return { badge: "🟡 Hòa vốn", color: "text-slate-700 bg-slate-100 border-slate-300", tip: "Net Profit không đổi đáng kể" };
    }

    if (d30.outcome_label === "POSITIVE") {
      return { badge: "🟢 WIN", color: "text-emerald-900 bg-emerald-100 border-emerald-400 font-black", tip: "Đóng góp tích cực dài hạn" };
    }
    if (d30.outcome_label === "NEGATIVE") {
      return { badge: "🔴 LOSS", color: "text-rose-900 bg-rose-100 border-rose-400 font-black", tip: "Kém hiệu quả dài hạn" };
    }
    if (d30.status === "INSUFFICIENT_DATA" || d30.evidence_quality?.validity === "INCONCLUSIVE") {
      return { badge: "⚪ Chưa đủ số liệu", color: "text-slate-600 bg-slate-100 border-slate-200", tip: "Lượng click hoặc đơn chưa đủ mẫu thống kê" };
    }

    return { badge: "⏳ Đang chạy", color: "text-indigo-700 bg-indigo-50 border-indigo-200", tip: "Đang tích lũy dữ liệu" };
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter === "ALL") return true;
      const primary = item.d30 || item.d14 || item.d7 || item.d3;
      const label = item.d30?.outcome_label || item.d14?.outcome_label || item.d7?.outcome_label;

      const isInterrupted =
        item.d30?.status === "INTERRUPTED" ||
        item.d14?.status === "INTERRUPTED" ||
        item.d7?.status === "INTERRUPTED" ||
        item.d30?.evidence_quality?.validity === "INTERRUPTED" ||
        item.d14?.evidence_quality?.validity === "INTERRUPTED" ||
        item.d7?.evidence_quality?.validity === "INTERRUPTED";

      if (statusFilter === "INTERRUPTED") return isInterrupted;
      if (statusFilter === "WIN") return label === "POSITIVE";
      if (statusFilter === "LOSS") return label === "NEGATIVE";
      if (statusFilter === "NEUTRAL") return label === "NEUTRAL";
      if (statusFilter === "WARNING_3D") {
        const d3Status = get3dStatus(item);
        return d3Status.badge.includes("Spend") || d3Status.badge.includes("traffic");
      }
      if (statusFilter === "OBSERVING") {
        return primary?.status === "OBSERVING" && !isInterrupted;
      }
      return true;
    });
  }, [items, statusFilter]);

  // CHỈ LẤY BẢN GHI MỚI NHẤT CHO MỖI TARGET (Sắp xếp thời gian giảm dần, loại bỏ các lần bị đè)
  const latestTargetItems = useMemo(() => {
    // Sắp xếp đảm bảo bản ghi có thời gian/ngày chỉnh mới nhất luôn đứng trước
    const sorted = [...filteredItems].sort((a, b) => {
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
  }, [filteredItems]);

  // Cấu trúc nhóm Chiến dịch (chứa các targets mới nhất)
  const campaignGroups = useMemo(() => {
    const campMap = new Map<string, BidOutcomeActionItem[]>();

    for (const item of latestTargetItems) {
      const cKey = item.campaign_id || item.campaign_name || "unknown";
      if (!campMap.has(cKey)) {
        campMap.set(cKey, []);
      }
      campMap.get(cKey)!.push(item);
    }

    const sortedCampKeys = Array.from(campMap.keys()).sort((a, b) => {
      const itemsA = campMap.get(a)!;
      const itemsB = campMap.get(b)!;
      const nameA = itemsA[0]?.campaign_name || a;
      const nameB = itemsB[0]?.campaign_name || b;
      return nameA.localeCompare(nameB);
    });

    return sortedCampKeys.map((cKey) => {
      const cItems = campMap.get(cKey)!;
      const first = cItems[0];

      let warning3d = 0;
      let loss = 0;
      let win = 0;

      for (const item of cItems) {
        const label = item.d30?.outcome_label || item.d14?.outcome_label || item.d7?.outcome_label;
        if (label === "POSITIVE") win++;
        else if (label === "NEGATIVE") loss++;

        const st3 = get3dStatus(item);
        if (st3.badge.includes("Spend") || st3.badge.includes("traffic")) warning3d++;
      }

      return {
        campaignId: first?.campaign_id || cKey,
        campaignName: first?.campaign_name || (cKey === "unknown" ? "Chiến dịch không xác định" : cKey),
        campaignType: first?.campaign_type || "SP",
        sku: first?.sku || "",
        items: cItems,
        stats: {
          total: cItems.length,
          warning3d,
          loss,
          win,
        },
      };
    });
  }, [latestTargetItems]);

  // Mặc định ĐÓNG TOÀN BỘ; chỉ tự động mở khi có tìm kiếm hoặc lọc trạng thái
  useEffect(() => {
    if (search.trim() || statusFilter !== "ALL") {
      const all: Record<string, boolean> = {};
      for (const c of campaignGroups) {
        all[c.campaignId] = true;
      }
      setExpandedCampaigns(all);
    } else {
      setExpandedCampaigns({});
    }
  }, [search, statusFilter]);

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

  // Render từng dòng Target/Từ khóa (Gọn gàng, sạch sẽ)
  const renderTargetRow = (item: BidOutcomeActionItem) => {
    const st3 = get3dStatus(item);
    const st7 = get7dStatus(item);
    const st14 = get14dStatus(item);
    const st30 = get30dStatus(item);

    const deltaPct = item.applied_delta_pct || 0;
    const isIncrease = deltaPct > 0;

    return (
      <tr
        key={item.action_id}
        onClick={() => setSelectedAction(item)}
        className="hover:bg-indigo-50/40 transition cursor-pointer group"
      >
        {/* TARGET / KEYWORD */}
        <td className="py-2.5 px-4">
          <div className="font-bold text-slate-900 group-hover:text-indigo-700 transition">
            {item.target_keyword || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold mt-0.5">
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
                <span className="text-slate-400">
                  {item.applied_on}
                </span>
              </>
            )}
          </div>
        </td>

        {/* BID CHANGE */}
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1.5 font-bold font-mono text-slate-800">
            <span className="text-slate-400">${Number(item.old_value || 0).toFixed(2)}</span>
            <ArrowRight size={12} className="text-slate-300" weight="bold" />
            <span className={isIncrease ? "text-emerald-700 font-extrabold" : "text-rose-700 font-extrabold"}>
              ${Number(item.final_value || item.system_suggested_value || 0).toFixed(2)}
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
            title={st3.tip}
            className={`inline-block px-2.5 py-1 rounded-lg text-[11px] border transition ${st3.color}`}
          >
            {st3.badge}
          </span>
        </td>

        {/* 7D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={st7.tip}
            className={`inline-block px-2.5 py-1 rounded-lg text-[11px] border transition ${st7.color}`}
          >
            {st7.badge}
          </span>
        </td>

        {/* 14D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={st14.tip}
            className={`inline-block px-2.5 py-1 rounded-lg text-[11px] border transition ${st14.color}`}
          >
            {st14.badge}
          </span>
        </td>

        {/* 30D STATUS */}
        <td className="py-2.5 px-2 text-center">
          <span
            title={st30.tip}
            className={`inline-block px-2.5 py-1 rounded-lg text-[11px] border transition ${st30.color}`}
          >
            {st30.badge}
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
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-indigo-600 hover:text-white transition shadow-2xs cursor-pointer"
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
        {/* HEADER: GRAIN RÕ RÀNG (LẦN CHỈNH & TARGET) */}
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
                  ({summary?.total || 0} lần chỉnh bid · {summary?.uniqueTargets || 0} targets)
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

        {/* SUMMARY CARDS (ĐỒNG BỘ 100% CÙNG GRAIN ACTION-LEVEL) */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 px-6 py-3.5 border-b border-slate-100 bg-slate-50/40">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 block">Tổng Lần Chỉnh</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-slate-900">{summary?.total || 0}</span>
              <span className="text-[10px] text-slate-400 font-semibold">lần</span>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
              <CheckCircle size={13} weight="fill" className="text-emerald-600" />
              <span>Thắng (Win)</span>
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-emerald-700">{summary?.positive || 0}</span>
              {summary?.winRate != null && (
                <span className="text-[10px] font-black text-emerald-600 ml-1">({summary.winRate.toFixed(0)}%)</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-rose-800 flex items-center gap-1">
              <XCircle size={13} weight="fill" className="text-rose-600" />
              <span>Kém / Cần sửa</span>
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-rose-700">{summary?.negative || 0}</span>
              <span className="text-[10px] text-rose-600">lần</span>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-300 bg-amber-100/50 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
              <WarningCircle size={13} weight="fill" className="text-amber-600" />
              <span>Cảnh báo 3D</span>
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-amber-900">{summary?.warning3d || 0}</span>
              <span className="text-[10px] text-amber-800">mục</span>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-slate-100/70 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
              <Prohibit size={13} weight="bold" className="text-slate-500" />
              <span>Bị ngắt (Đè)</span>
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-lg font-black text-slate-800">{summary?.interrupted || 0}</span>
              <span className="text-[10px] text-slate-500">lần</span>
            </div>
          </div>

          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-indigo-800 flex items-center gap-1">
              <TrendUp size={13} weight="bold" className="text-indigo-600" />
              <span>Net Profit</span>
            </span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-lg font-black ${(summary?.totalRewardUsd || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {formatCurrencyUsd(summary?.totalRewardUsd || 0, true)}
              </span>
            </div>
          </div>
        </div>

        {/* TOOLBAR: CÁC TAB LỌC ĐẾM CHUẨN XÁC THEO SUMMARY */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm Keyword, ASIN, SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 rounded-xl border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600/20 shadow-2xs"
              />
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5 text-xs font-bold text-slate-600 flex-wrap">
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs font-extrabold" : "hover:text-slate-900"
                  }`}
              >
                Tất cả ({summary?.total || items.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("WIN")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "WIN" ? "bg-emerald-600 text-white shadow-2xs font-extrabold" : "text-emerald-700 hover:text-emerald-900"
                  }`}
              >
                🟢 Win ({summary?.positive || 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("LOSS")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "LOSS" ? "bg-rose-600 text-white shadow-2xs font-extrabold" : "text-rose-700 hover:text-rose-900"
                  }`}
              >
                🔴 Cần sửa ({summary?.negative || 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("WARNING_3D")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "WARNING_3D" ? "bg-amber-500 text-white shadow-2xs font-extrabold" : "text-amber-800 hover:text-amber-950"
                  }`}
              >
                ⚠️ Cảnh báo 3D ({summary?.warning3d || 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("INTERRUPTED")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "INTERRUPTED" ? "bg-slate-700 text-white shadow-2xs font-extrabold" : "text-slate-700 hover:text-slate-950"
                  }`}
              >
                ⛔ Bị ngắt ({summary?.interrupted || 0})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("OBSERVING")}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition cursor-pointer ${statusFilter === "OBSERVING" ? "bg-indigo-600 text-white shadow-2xs font-extrabold" : "text-indigo-700 hover:text-indigo-900"
                  }`}
              >
                ⏳ Đang chạy ({summary?.observing || 0})
              </button>
            </div>
          </div>

          {/* EXPAND CONTROLS: ĐƠN GIẢN, GỌN GÀNG */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExpandAll}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition shadow-2xs cursor-pointer"
            >
              Mở tất cả
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

        {/* MAIN BODY: DANH SÁCH CHIẾN DỊCH (GOM THEO CHIẾN DỊCH, CHỈ LẤY TARGET MỚI NHẤT) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 thin-scrollbar">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
              <CircleNotch size={28} className="animate-spin text-indigo-600" />
              <span className="text-xs font-bold">Đang tải kết quả theo dõi bid...</span>
            </div>
          ) : campaignGroups.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
              <Clock size={36} className="text-slate-300" weight="duotone" />
              <span className="text-sm font-bold text-slate-600">Chưa có dữ liệu chỉnh bid trong bộ lọc này</span>
              <p className="text-xs text-slate-400 max-w-sm text-center">
                Sau khi áp dụng chỉnh bid từ Auto Bid lên Amazon, hệ thống sẽ tự động ghi nhận và theo dõi tại đây.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {campaignGroups.map((camp) => {
                const isOpen = expandedCampaigns[camp.campaignId] ?? false;

                return (
                  <div
                    key={camp.campaignId}
                    className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs transition"
                  >
                    {/* HEADER CHIẾN DỊCH: 1 DÒNG GỌN GÀNG, KHÔNG RƯỜM RÀ */}
                    <div
                      onClick={() => toggleCampaign(camp.campaignId)}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/90 hover:bg-slate-100/70 transition cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-slate-400 hover:text-slate-700 shrink-0">
                          {isOpen ? (
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
                        <span className="text-xs font-semibold text-slate-500">
                          {camp.stats.total} targets
                        </span>
                        {camp.stats.warning3d > 0 && (
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                            ⚠️ {camp.stats.warning3d}
                          </span>
                        )}
                        {camp.stats.loss > 0 && (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                            🔴 {camp.stats.loss}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* BẢNG TARGETS KHI MỞ */}
                    {isOpen && (
                      <div className="border-t border-slate-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              <th className="py-2.5 px-4">Target / Từ Khóa</th>
                              <th className="py-2.5 px-3">Lần Chỉnh Bid</th>
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
            <span>Hiển thị <strong>{latestTargetItems.length}</strong> targets · <strong>{campaignGroups.length}</strong> chiến dịch (Lần chỉnh mới nhất)</span>
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

// POPUP HỖ TRỢ QUYẾT ĐỊNH: THIẾT KẾ ĐƠN GIẢN, TRỰC QUAN THEO MOCKUP
function ActionDecisionSupportModal({
  action,
  onClose,
}: {
  action: BidOutcomeActionItem;
  onClose: () => void;
}) {
  // Ưu tiên đọc baseline từ action hoặc fallback sang d7/d3/d14
  const b =
    action.baseline && Object.keys(action.baseline).length > 0 && (action.baseline.spend !== undefined || action.baseline.clicks !== undefined)
      ? action.baseline
      : (action.d7 as any)?.baseline && Object.keys((action.d7 as any).baseline).length > 0
      ? (action.d7 as any).baseline
      : (action.d3 as any)?.baseline && Object.keys((action.d3 as any).baseline).length > 0
      ? (action.d3 as any).baseline
      : (action.d14 as any)?.baseline && Object.keys((action.d14 as any).baseline).length > 0
      ? (action.d14 as any).baseline
      : action.baseline || {};

  const oldBid = Number(action.old_value || 0);
  const newBid = Number(action.final_value || action.system_suggested_value || 0);
  const deltaPct = action.applied_delta_pct || 0;

  // Baseline 30D normalized to daily average
  const bDays = Number(b.days || 30) || 30;
  const bClicks = Number(b.clicks || 0);
  const bOrders = Number(b.orders || 0);
  const bSpend = Number(b.spend || 0);
  const bSales = Number(b.sales || 0);
  const bClicksDaily = bClicks / bDays;
  const bOrdersDaily = bOrders / bDays;
  const bSpendDaily = bSpend / bDays;
  const bSalesDaily = bSales / bDays;
  const bAcos = bSales > 0 ? (bSpend / bSales) * 100 : null;
  const bProfit = Number(b.contribution ?? (bSales * 0.35 - bSpend));
  const bProfitDaily = bProfit / bDays;

  // Windows data
  const w3 = action.d3;
  const w7 = action.d7;
  const w14 = action.d14;
  const w30 = action.d30;

  // Day difference from applied_on
  const appliedDate = action.applied_on ? new Date(action.applied_on) : new Date();
  const today = new Date();
  const daysElapsed = Math.max(0, Math.floor((today.getTime() - appliedDate.getTime()) / (1000 * 60 * 60 * 24)));

  const formatShortDate = (dStr?: string | null) => {
    if (!dStr) return "";
    const parts = dStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return dStr;
  };

  const getWindowDateRange = (w: WindowDetail | null, windowDays: number) => {
    if (w?.observation_start && w?.observation_end) {
      const inclusiveEnd = new Date(`${w.observation_end}T00:00:00Z`);
      inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
      return `${formatShortDate(w.observation_start)} → ${formatShortDate(inclusiveEnd.toISOString().slice(0, 10))}`;
    }
    if (action.applied_on) {
      try {
        const start = new Date(`${action.applied_on}T00:00:00Z`);
        start.setUTCDate(start.getUTCDate() + 1);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + windowDays - 1);
        const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return `${fmt(start)} → ${fmt(end)}`;
      } catch {
        return "";
      }
    }
    return "";
  };

  const baselineDateRange = useMemo(() => {
    if (!action.applied_on) return "";
    try {
      const applied = new Date(action.applied_on);
      const start = new Date(applied);
      start.setDate(start.getDate() - 30);
      const end = new Date(applied);
      end.setDate(end.getDate() - 1);
      const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      return `${fmt(start)} → ${fmt(end)}`;
    } catch {
      return "";
    }
  }, [action.applied_on]);

  // Helper to extract and compute window stats
  const parseWindow = (w: WindowDetail | null, windowDays: number) => {
    const dateRangeText = getWindowDateRange(w, windowDays);

    if (!w) {
      return {
        isAvailable: false,
        windowDays,
        dateRangeText,
        statusText: daysElapsed < windowDays ? "Đang theo dõi" : "Chưa có dữ liệu",
        clicks: null,
        clicksDaily: null,
        clicksDeltaPct: null,
        orders: null,
        ordersDaily: null,
        ordersDeltaPct: null,
        spend: null,
        spendDaily: null,
        spendDeltaPct: null,
        sales: null,
        salesDaily: null,
        salesDeltaPct: null,
        acos: null,
        acosDeltaPt: null,
        profit: null,
        profitDaily: null,
        profitDeltaPct: null,
        profitDeltaUsd: null,
      };
    }

    const isInterrupted = w.status === "INTERRUPTED" || w.evidence_quality?.validity === "INTERRUPTED";
    if (isInterrupted) {
      return {
        isAvailable: false,
        windowDays,
        dateRangeText,
        statusText: "Đã ngắt",
        clicks: null,
        clicksDaily: null,
        clicksDeltaPct: null,
        orders: null,
        ordersDaily: null,
        ordersDeltaPct: null,
        spend: null,
        spendDaily: null,
        spendDeltaPct: null,
        sales: null,
        salesDaily: null,
        salesDeltaPct: null,
        acos: null,
        acosDeltaPt: null,
        profit: null,
        profitDaily: null,
        profitDeltaPct: null,
        profitDeltaUsd: null,
      };
    }

    const obs = w.observed || {};
    const hasData = obs.spend !== undefined && obs.spend !== null;

    if (!hasData) {
      return {
        isAvailable: false,
        windowDays,
        dateRangeText,
        statusText: daysElapsed < windowDays ? "Đang theo dõi" : "Chưa có dữ liệu",
        clicks: null,
        clicksDaily: null,
        clicksDeltaPct: null,
        orders: null,
        ordersDaily: null,
        ordersDeltaPct: null,
        spend: null,
        spendDaily: null,
        spendDeltaPct: null,
        sales: null,
        salesDaily: null,
        salesDeltaPct: null,
        acos: null,
        acosDeltaPt: null,
        profit: null,
        profitDaily: null,
        profitDeltaPct: null,
        profitDeltaUsd: null,
      };
    }

    const clicks = Number(obs.clicks || 0);
    const orders = Number(obs.orders || 0);
    const spend = Number(obs.spend || 0);
    const sales = Number(obs.sales || 0);
    const acos = sales > 0 ? (spend / sales) * 100 : null;
    const profit = obs.contribution != null ? Number(obs.contribution) : (sales * 0.35 - spend);

    const clicksDaily = clicks / windowDays;
    const ordersDaily = orders / windowDays;
    const spendDaily = spend / windowDays;
    const salesDaily = sales / windowDays;
    const profitDaily = profit / windowDays;

    const clicksDeltaPct = bClicksDaily > 0 ? ((clicksDaily - bClicksDaily) / bClicksDaily) * 100 : (clicksDaily > 0 ? 100 : 0);
    const ordersDeltaPct = bOrdersDaily > 0 ? ((ordersDaily - bOrdersDaily) / bOrdersDaily) * 100 : (ordersDaily > 0 ? 100 : 0);
    const spendDeltaPct = bSpendDaily > 0 ? ((spendDaily - bSpendDaily) / bSpendDaily) * 100 : (spendDaily > 0 ? 100 : 0);
    const salesDeltaPct = bSalesDaily > 0 ? ((salesDaily - bSalesDaily) / bSalesDaily) * 100 : (salesDaily > 0 ? 100 : 0);
    const acosDeltaPt = acos != null && bAcos != null ? acos - bAcos : null;
    const profitDeltaPct = bProfitDaily !== 0 ? ((profitDaily - bProfitDaily) / Math.abs(bProfitDaily)) * 100 : (profitDaily > 0 ? 100 : -100);
    const profitDeltaUsd = profit - (bProfitDaily * windowDays);

    return {
      isAvailable: true,
      windowDays,
      dateRangeText,
      statusText: w.outcome_label || "Đã có số liệu",
      clicks,
      clicksDaily,
      clicksDeltaPct,
      orders,
      ordersDaily,
      ordersDeltaPct,
      spend,
      spendDaily,
      spendDeltaPct,
      sales,
      salesDaily,
      salesDeltaPct,
      acos,
      acosDeltaPt,
      profit,
      profitDaily,
      profitDeltaPct,
      profitDeltaUsd,
    };
  };

  const m3 = parseWindow(w3, 3);
  const m7 = parseWindow(w7, 7);
  const m14 = parseWindow(w14, 14);
  const m30 = parseWindow(w30, 30);

  // Active evaluation window (prefer latest available: 14D -> 7D -> 3D -> 30D)
  const activeWin = m14.isAvailable ? m14 : (m7.isAvailable ? m7 : (m3.isAvailable ? m3 : (m30.isAvailable ? m30 : m7)));

  // Render metric cell helper (Value + Daily + Delta %)
  const renderMetricCell = (
    win: ReturnType<typeof parseWindow>,
    metricKey: "clicks" | "orders" | "spend" | "sales",
    isGoodPositive = true,
    isCurrency = false
  ) => {
    if (!win.isAvailable) {
      return (
        <td className="py-3 px-3 text-center text-slate-300 font-bold border-r border-slate-100 last:border-r-0">
          —
        </td>
      );
    }
    const val = win[metricKey];
    const daily = win[`${metricKey}Daily` as keyof typeof win] as number | null;
    const delta = win[`${metricKey}DeltaPct` as keyof typeof win] as number | null;

    const isGoodDelta = delta != null && (delta === 0 ? null : delta > 0 === isGoodPositive);
    const deltaColor =
      delta == null || delta === 0
        ? "text-slate-400"
        : isGoodDelta
        ? "text-emerald-600"
        : "text-rose-500";

    return (
      <td className="py-3 px-3 border-r border-slate-100 last:border-r-0">
        <div className="flex items-center justify-between px-2">
          <div>
            <span className="font-bold text-slate-900">
              {isCurrency ? formatCurrencyUsd(val) : (val ?? 0)}
            </span>
            <span className="text-slate-400 text-[11px] ml-1">
              ({isCurrency ? formatCurrencyUsd(daily) : (daily ?? 0).toFixed(2)}/d)
            </span>
          </div>
          {delta != null && (
            <span className={`font-bold ${deltaColor}`}>
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </span>
          )}
        </div>
      </td>
    );
  };

  // Render ACOS cell helper
  const renderAcosCell = (win: ReturnType<typeof parseWindow>) => {
    if (!win.isAvailable || win.acos == null) {
      return (
        <td className="py-3 px-3 text-center text-slate-300 font-bold border-r border-slate-100 last:border-r-0">
          —
        </td>
      );
    }
    const isGoodDelta = win.acosDeltaPt != null && win.acosDeltaPt <= 0;
    const color =
      win.acosDeltaPt == null
        ? "text-slate-400"
        : isGoodDelta
        ? "text-emerald-600"
        : "text-rose-500";

    return (
      <td className="py-3 px-3 border-r border-slate-100 last:border-r-0">
        <div className="flex items-center justify-between px-2">
          <span className="font-bold text-slate-900">{win.acos.toFixed(1)}%</span>
          {win.acosDeltaPt != null && (
            <span className={`font-bold ${color}`}>
              {win.acosDeltaPt <= 0 ? "" : "+"}
              {win.acosDeltaPt.toFixed(1)}pt
            </span>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-100">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto thin-scrollbar">
        {/* HEADER SECTION */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">
                Kết quả chỉnh Bid
              </span>
              <span className="text-xs text-slate-400 font-medium">
                Ngày chỉnh: {action.applied_on || "—"} ({daysElapsed}d trước)
              </span>
            </div>
            <h3 className="text-2xl font-black text-slate-900 mt-1">
              {action.target_keyword}
            </h3>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              SKU: {action.sku || "—"} | Campaign: {action.campaign_name || "—"} | Ad Group: AG01
            </p>
          </div>

          <div className="flex items-start gap-4">
            {/* BID BEFORE / AFTER BOX */}
            <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-2">
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Bid trước</div>
                <div className="text-sm font-black text-slate-900">${oldBid.toFixed(2)}</div>
              </div>
              <span className="text-slate-400 font-bold">→</span>
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Bid sau</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-black text-indigo-600">${newBid.toFixed(2)}</span>
                  <span className={`text-xs font-bold ${deltaPct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    ({deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* CLOSE BUTTON */}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        {/* =========================================================================
            4 METRIC SUMMARY CARDS (Clicks, Orders, Sales, Profit)
            ========================================================================= */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">
                Hiệu quả hiện tại
              </span>
              <span className="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                {formatShortDate(action.applied_on)} → Nay ({daysElapsed}d qua)
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">
              Đối chiếu với tốc độ trung bình 30d trước
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* CLICKS */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 shadow-2xs">
              <div className="text-[11px] text-slate-500 font-medium">Clicks hiện tại</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-xl font-black text-slate-900">
                  {activeWin.isAvailable && activeWin.clicks != null ? activeWin.clicks : "—"}
                </span>
                {activeWin.clicksDeltaPct != null && (
                  <span className={`text-xs font-bold ${
                    (activeWin.clicksDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-500"
                  }`}>
                    {activeWin.clicksDeltaPct >= 0 ? "+" : ""}{Math.round(activeWin.clicksDeltaPct)}%
                  </span>
                )}
              </div>
              <div className={`w-full h-1 rounded-full mt-2 ${
                (activeWin.clicksDeltaPct ?? 0) >= 0 ? "bg-emerald-500" : "bg-rose-500"
              }`} />
            </div>

            {/* ORDERS */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 shadow-2xs">
              <div className="text-[11px] text-slate-500 font-medium">Orders hiện tại</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-xl font-black text-slate-900">
                  {activeWin.isAvailable && activeWin.orders != null ? activeWin.orders : "—"}
                </span>
                {activeWin.ordersDeltaPct != null && (
                  <span className={`text-xs font-bold ${
                    (activeWin.ordersDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-500"
                  }`}>
                    {activeWin.ordersDeltaPct >= 0 ? "+" : ""}{Math.round(activeWin.ordersDeltaPct)}%
                  </span>
                )}
              </div>
              <div className={`w-full h-1 rounded-full mt-2 ${
                (activeWin.ordersDeltaPct ?? 0) >= 0 ? "bg-emerald-500" : "bg-rose-500"
              }`} />
            </div>

            {/* SALES */}
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 shadow-2xs">
              <div className="text-[11px] text-slate-500 font-medium">Sales hiện tại</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-xl font-black text-slate-900">
                  {activeWin.isAvailable && activeWin.sales != null ? formatCurrencyUsd(activeWin.sales) : "—"}
                </span>
                {activeWin.salesDeltaPct != null && (
                  <span className={`text-xs font-bold ${
                    (activeWin.salesDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-500"
                  }`}>
                    {activeWin.salesDeltaPct >= 0 ? "+" : ""}{Math.round(activeWin.salesDeltaPct)}%
                  </span>
                )}
              </div>
              <div className={`w-full h-1 rounded-full mt-2 ${
                (activeWin.salesDeltaPct ?? 0) >= 0 ? "bg-emerald-500" : "bg-rose-500"
              }`} />
            </div>
          </div>
        </div>

        {/* =========================================================================
            BẢNG ĐỐI CHIẾU SỐ LIỆU CHI TIẾT
            ========================================================================= */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs thin-scrollbar">
          <table className="w-full text-left text-xs border-collapse min-w-[780px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">
                <th className="py-2.5 px-3.5 w-24 text-slate-800">Chỉ số</th>
                <th className="py-2.5 px-3 text-center border-r border-slate-100 min-w-[130px]">
                  <div>Baseline</div>
                  <div className="text-[10px] font-normal text-slate-400 whitespace-nowrap">
                    {baselineDateRange ? `30d (${baselineDateRange})` : "30d trước"}
                  </div>
                </th>
                <th className="py-2.5 px-3 text-center border-r border-slate-100 min-w-[130px]">
                  <div className="flex items-center justify-center gap-1 font-bold text-slate-800">
                    {m3.isAvailable && ((m3.ordersDeltaPct ?? 0) >= 0 && (m3.salesDeltaPct ?? 0) >= 0) ? (
                      <TrendUp size={14} weight="bold" className="text-emerald-600" />
                    ) : (
                      <TrendDown size={14} weight="bold" className="text-rose-500" />
                    )}
                    <span>3d</span>
                  </div>
                  {m3.dateRangeText && (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5 whitespace-nowrap">
                      {m3.dateRangeText}
                    </div>
                  )}
                </th>
                <th className="py-2.5 px-3 text-center border-r border-slate-100 min-w-[130px]">
                  <div className="flex items-center justify-center gap-1 font-bold text-slate-800">
                    {m7.isAvailable && ((m7.ordersDeltaPct ?? 0) >= 0 && (m7.salesDeltaPct ?? 0) >= 0) ? (
                      <TrendUp size={14} weight="bold" className="text-emerald-600" />
                    ) : (
                      <TrendDown size={14} weight="bold" className="text-rose-500" />
                    )}
                    <span>7d</span>
                  </div>
                  {m7.dateRangeText && (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5 whitespace-nowrap">
                      {m7.dateRangeText}
                    </div>
                  )}
                </th>
                <th className="py-2.5 px-3 text-center border-r border-slate-100 min-w-[130px]">
                  <div className="font-bold text-slate-700">14d</div>
                  {m14.dateRangeText && (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5 whitespace-nowrap">
                      {m14.dateRangeText}
                    </div>
                  )}
                </th>
                <th className="py-2.5 px-3 text-center min-w-[130px]">
                  <div className="font-bold text-slate-700">30d</div>
                  {m30.dateRangeText && (
                    <div className="text-[10px] font-normal text-slate-400 mt-0.5 whitespace-nowrap">
                      {m30.dateRangeText}
                    </div>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium">
              {/* CLICKS */}
              <tr>
                <td className="py-3 px-4 font-bold text-slate-800">Clicks</td>
                <td className="py-3 px-3 text-center border-r border-slate-100">
                  <span className="font-bold text-slate-900">{bClicks}</span>
                  <span className="text-slate-400 text-[11px] ml-1">({bClicksDaily.toFixed(2)}/d)</span>
                </td>
                {renderMetricCell(m3, "clicks", true)}
                {renderMetricCell(m7, "clicks", true)}
                {renderMetricCell(m14, "clicks", true)}
                {renderMetricCell(m30, "clicks", true)}
              </tr>

              {/* ORDERS */}
              <tr>
                <td className="py-3 px-4 font-bold text-slate-800">Orders</td>
                <td className="py-3 px-3 text-center border-r border-slate-100">
                  <span className="font-bold text-slate-900">{bOrders}</span>
                  <span className="text-slate-400 text-[11px] ml-1">({bOrdersDaily.toFixed(2)}/d)</span>
                </td>
                {renderMetricCell(m3, "orders", true)}
                {renderMetricCell(m7, "orders", true)}
                {renderMetricCell(m14, "orders", true)}
                {renderMetricCell(m30, "orders", true)}
              </tr>

              {/* SPEND */}
              <tr>
                <td className="py-3 px-4 font-bold text-slate-800">Spend</td>
                <td className="py-3 px-3 text-center border-r border-slate-100">
                  <span className="font-bold text-slate-900">${bSpend.toFixed(1)}</span>
                  <span className="text-slate-400 text-[11px] ml-1">(${bSpendDaily.toFixed(2)}/d)</span>
                </td>
                {renderMetricCell(m3, "spend", false, true)}
                {renderMetricCell(m7, "spend", false, true)}
                {renderMetricCell(m14, "spend", false, true)}
                {renderMetricCell(m30, "spend", false, true)}
              </tr>

              {/* SALES */}
              <tr>
                <td className="py-3 px-4 font-bold text-slate-800">Sales</td>
                <td className="py-3 px-3 text-center border-r border-slate-100">
                  <span className="font-bold text-slate-900">${bSales.toFixed(1)}</span>
                  <span className="text-slate-400 text-[11px] ml-1">(${bSalesDaily.toFixed(2)}/d)</span>
                </td>
                {renderMetricCell(m3, "sales", true, true)}
                {renderMetricCell(m7, "sales", true, true)}
                {renderMetricCell(m14, "sales", true, true)}
                {renderMetricCell(m30, "sales", true, true)}
              </tr>

              {/* ACOS */}
              <tr>
                <td className="py-3 px-4 font-bold text-slate-800">ACOS</td>
                <td className="py-3 px-3 text-center border-r border-slate-100">
                  <span className="font-bold text-slate-900">{bAcos != null ? `${bAcos.toFixed(1)}%` : "—"}</span>
                </td>
                {renderAcosCell(m3)}
                {renderAcosCell(m7)}
                {renderAcosCell(m14)}
                {renderAcosCell(m30)}
              </tr>
            </tbody>
          </table>
        </div>

        {/* =========================================================================
            BOTTOM: ĐỀ XUẤT & NÚT ĐÓNG
            ========================================================================= */}
        <div className="flex items-center justify-between pt-2">
          {/* RECOMMENDATION */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-400 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Lightbulb size={20} weight="fill" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Đề xuất</div>
              <div className="text-xs font-black text-slate-900 mt-0.5">
                Chưa cho thấy hiệu quả. Nên giữ bid hiện tại hoặc giảm bid.
              </div>
            </div>
          </div>

          {/* CLOSE BUTTON */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-7 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
