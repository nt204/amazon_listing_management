"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Tag,
  Funnel,
  CheckCircle,
  X,
  CaretRight,
  ArrowUpRight,
  ArrowDownRight,
  Pause,
  Clock,
  CheckSquare,
  Square,
  MagnifyingGlass,
  ArrowsDownUp,
  CaretUp,
  CaretDown,
  Fire,
  WarningCircle,
  TrendUp,
  TrendDown,
  Sparkle,
  Lightning,
  Calculator,
  ShieldCheck,
  Check,
  Info,
} from "@phosphor-icons/react";
import type { SkuRecommendationGroup, PpcAction } from "@/lib/ppc/sku-architecture-types";
import type { PpcRecommendation } from "@/lib/ppc/types";

interface PpcSkuRecommendationGroupProps {
  groups: SkuRecommendationGroup[];
  allRecommendations: PpcRecommendation[];
  isLoading: boolean;
  onApproveToQueue: (items: Array<{ recommendation: PpcRecommendation; userFinalBid?: number }>) => Promise<void>;
  onOpenActionQueue: () => void;
  pendingQueueCount: number;
  actionQueue?: PpcAction[];
}

export type QuickFilterType =
  | "ALL"
  | "INCREASE"
  | "DECREASE"
  | "PAUSE"
  | "BLEEDING"
  | "PROFITABLE"
  | "ZERO_SPEND"
  | "ZERO_SALES";

export type SortField =
  | "sku"
  | "spend"
  | "sales"
  | "acos"
  | "breakEvenAcos"
  | "totalRecommendations"
  | "increaseCount"
  | "decreaseCount"
  | "pauseCount";

export type SortOrder = "asc" | "desc";

export function PpcSkuRecommendationGroupView({
  groups,
  allRecommendations,
  isLoading,
  onApproveToQueue,
  onOpenActionQueue,
  pendingQueueCount,
  actionQueue,
}: PpcSkuRecommendationGroupProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPhôi, setSelectedPhôi] = useState("ALL");
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("ALL");
  const [sortField, setSortField] = useState<SortField>("totalRecommendations");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedSkuGroup, setSelectedSkuGroup] = useState<SkuRecommendationGroup | null>(null);

  // Detail View State
  const [selectedRecIds, setSelectedRecIds] = useState<Set<string>>(new Set());
  const [userFinalBids, setUserFinalBids] = useState<Record<string, number>>({});
  const [isApproving, setIsApproving] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [modalActionFilter, setModalActionFilter] = useState<"ALL" | "BID_INCREASE" | "BID_DECREASE" | "PAUSE_TARGET">("ALL");
  const [recentlyApprovedIds, setRecentlyApprovedIds] = useState<Set<string>>(new Set());
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [explainingRecId, setExplainingRecId] = useState<string | null>(null);
  const [aiExplanationModal, setAiExplanationModal] = useState<{
    rec: PpcRecommendation;
    explanation: string;
    structured?: any;
  } | null>(null);

  const handleExplainWithAi = async (rec: PpcRecommendation) => {
    setExplainingRecId(rec.id);
    try {
      const res = await fetch("/api/ppc/ai-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: rec.keyword,
          matchType: rec.matchType,
          campaignName: rec.campaignName,
          recType: rec.recType,
          currentBid: rec.currentBid,
          recommendedBid: rec.recommendedBid,
          clicks: rec.clicks,
          spend: rec.spend,
          sales: rec.sales,
          orders: rec.orders,
          cpc: rec.cpc,
          breakEvenAcos: selectedSkuGroup?.economics?.breakEvenAcos,
          maxBid: selectedSkuGroup?.economics?.maxBid,
          productType: rec.productType || selectedSkuGroup?.productType,
          ruleProfile: rec.ruleProfile,
          ruleReason: rec.reason,
          sku: rec.sku || selectedSkuGroup?.sku,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể lấy giải thích từ AI");
      }
      setAiExplanationModal({
        rec,
        explanation: data.explanation,
        structured: data.structured,
      });
    } catch (err: any) {
      alert("Lỗi AI: " + (err.message || "Vui lòng thử lại"));
    } finally {
      setExplainingRecId(null);
    }
  };

  const handleOpenActionQueueModal = () => {
    setSelectedSkuGroup(null);
    onOpenActionQueue();
  };

  // Handle ESC key to close modal
  useEffect(() => {
    if (!selectedSkuGroup) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedSkuGroup(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSkuGroup]);

  // Dynamic available Phôi list with counts
  const phôiOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      const p = g.productType || "Chưa xác định";
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [groups]);

  // Quick Filter Counts for badges
  const filterCounts = useMemo(() => {
    let increase = 0;
    let decrease = 0;
    let pause = 0;
    let bleeding = 0;
    let profitable = 0;
    let zeroSpend = 0;
    let zeroSales = 0;

    for (const g of groups) {
      if (g.increaseCount > 0) increase++;
      if (g.decreaseCount > 0) decrease++;
      if (g.pauseCount > 0) pause++;
      if (g.spend > 0 && g.acos > g.breakEvenAcos) bleeding++;
      if (g.sales > 0 && g.acos <= g.breakEvenAcos) profitable++;
      if (g.spend === 0) zeroSpend++;
      if (g.spend > 0 && g.sales === 0) zeroSales++;
    }

    return {
      all: groups.length,
      increase,
      decrease,
      pause,
      bleeding,
      profitable,
      zeroSpend,
      zeroSales,
    };
  }, [groups]);

  // Handle Sort Toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder(field === "sku" ? "asc" : "desc");
    }
  };

  // Filtered & Sorted Level 1 Groups
  const filteredGroups = useMemo(() => {
    const result = groups.filter((g) => {
      // 1. Search term
      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        const matchSku = g.sku.toLowerCase().includes(q);
        const matchAsin = g.asin.toLowerCase().includes(q);
        if (!matchSku && !matchAsin) return false;
      }

      // 2. Phôi filter
      if (selectedPhôi !== "ALL" && g.productType !== selectedPhôi) {
        return false;
      }

      // 3. Quick Filter
      switch (quickFilter) {
        case "INCREASE":
          return g.increaseCount > 0;
        case "DECREASE":
          return g.decreaseCount > 0;
        case "PAUSE":
          return g.pauseCount > 0;
        case "BLEEDING":
          return g.spend > 0 && g.acos > g.breakEvenAcos;
        case "PROFITABLE":
          return g.sales > 0 && g.acos <= g.breakEvenAcos;
        case "ZERO_SPEND":
          return g.spend === 0;
        case "ZERO_SALES":
          return g.spend > 0 && g.sales === 0;
        case "ALL":
        default:
          return true;
      }
    });

    // 4. Sort
    return result.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];

      if (typeof valA === "string" && typeof valB === "string") {
        return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      const numA = typeof valA === "number" ? valA : 0;
      const numB = typeof valB === "number" ? valB : 0;
      return sortOrder === "asc" ? numA - numB : numB - numA;
    });
  }, [groups, searchTerm, selectedPhôi, quickFilter, sortField, sortOrder]);

  // Recommendations for the currently selected SKU (Modal)
  const currentSkuRecs = useMemo(() => {
    if (!selectedSkuGroup) return [];
    return allRecommendations
      .filter((r) => (r.sku || "").toUpperCase() === selectedSkuGroup.sku.toUpperCase())
      .filter((r) => {
        if (modalActionFilter !== "ALL" && r.recType !== modalActionFilter) return false;
        if (modalSearch) {
          const q = modalSearch.toLowerCase().trim();
          const matchKw = (r.keyword || "").toLowerCase().includes(q);
          const matchCamp = (r.campaignName || "").toLowerCase().includes(q);
          if (!matchKw && !matchCamp) return false;
        }
        return true;
      });
  }, [allRecommendations, selectedSkuGroup, modalActionFilter, modalSearch]);

  // Group currentSkuRecs by Campaign
  const groupedByCampaign = useMemo(() => {
    const map = new Map<string, PpcRecommendation[]>();
    for (const rec of currentSkuRecs) {
      const campName = rec.campaignName || "Chưa xác định Campaign";
      if (!map.has(campName)) {
        map.set(campName, []);
      }
      map.get(campName)!.push(rec);
    }

    return Array.from(map.entries()).map(([campaignName, recs]) => {
      let totalIncrease = 0;
      let totalDecrease = 0;
      let totalPause = 0;
      for (const r of recs) {
        if (r.recType === "BID_INCREASE") totalIncrease++;
        else if (r.recType === "BID_DECREASE") totalDecrease++;
        else if (r.recType === "PAUSE_TARGET") totalPause++;
      }
      const firstRec = recs[0];
      let campType = "SP";
      if (firstRec?.ruleProfile) {
        const parts = firstRec.ruleProfile.split(" ");
        campType = parts[0] || "SP";
      } else if (campaignName.includes("SB01")) {
        campType = "SB01";
      } else if (campaignName.includes("SB05")) {
        campType = "SB05";
      } else if (campaignName.includes("SP03")) {
        campType = "SP03";
      } else if (firstRec?.adType) {
        campType = firstRec.adType;
      }

      return {
        campaignName,
        campaignType: campType,
        adType: firstRec?.adType,
        recs,
        totalIncrease,
        totalDecrease,
        totalPause,
      };
    });
  }, [currentSkuRecs]);

  const toggleCampaignExpanded = (campName: string) => {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(campName)) next.delete(campName);
      else next.add(campName);
      return next;
    });
  };

  const handleExpandAllCampaigns = () => {
    if (expandedCampaigns.size === groupedByCampaign.length) {
      setExpandedCampaigns(new Set());
    } else {
      setExpandedCampaigns(new Set(groupedByCampaign.map((c) => c.campaignName)));
    }
  };

  const handleToggleSelectCampaign = (campRecs: PpcRecommendation[]) => {
    const next = new Set(selectedRecIds);
    const allSelected = campRecs.length > 0 && campRecs.every((r) => next.has(r.id));
    if (allSelected) {
      for (const r of campRecs) next.delete(r.id);
    } else {
      for (const r of campRecs) next.add(r.id);
    }
    setSelectedRecIds(next);
  };

  // Select all inside SKU Detail
  const handleToggleSelectAll = () => {
    if (selectedRecIds.size === currentSkuRecs.length) {
      setSelectedRecIds(new Set());
    } else {
      setSelectedRecIds(new Set(currentSkuRecs.map((r) => r.id)));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    const next = new Set(selectedRecIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRecIds(next);
  };

  const handleFinalBidChange = (id: string, val: string) => {
    const cleaned = val.replace(",", ".");
    const num = parseFloat(cleaned);
    setUserFinalBids((prev) => ({
      ...prev,
      [id]: isNaN(num) ? 0 : num,
    }));
  };

  // Targets already present in actionQueue
  const queuedTargetSet = useMemo(() => {
    const set = new Set<string>();
    if (actionQueue) {
      for (const act of actionQueue) {
        if (act.targetId) set.add(String(act.targetId));
        if (act.recommendationId) set.add(String(act.recommendationId));
        if (act.targetKeyword && act.campaignId) {
          set.add(`${act.campaignId}___${act.targetKeyword.trim().toLowerCase()}`);
        }
      }
    }
    return set;
  }, [actionQueue]);

  // Approve selected into Action Queue
  const handleApproveSelected = async () => {
    if (selectedRecIds.size === 0) return;
    try {
      setIsApproving(true);
      const approvedIds = Array.from(selectedRecIds);
      const itemsToApprove = currentSkuRecs
        .filter((r) => selectedRecIds.has(r.id))
        .map((r) => ({
          recommendation: r,
          userFinalBid: userFinalBids[r.id] ?? r.recommendedBid ?? r.currentBid ?? 0,
        }));

      await onApproveToQueue(itemsToApprove);
      setRecentlyApprovedIds((prev) => new Set([...prev, ...approvedIds]));
      setSelectedRecIds(new Set());
    } catch (err) {
      alert("Lỗi khi duyệt đề xuất: " + String(err));
    } finally {
      setIsApproving(false);
    }
  };

  // Approve single
  const handleApproveSingle = async (rec: PpcRecommendation) => {
    try {
      setIsApproving(true);
      await onApproveToQueue([
        {
          recommendation: rec,
          userFinalBid: userFinalBids[rec.id] ?? rec.recommendedBid ?? rec.currentBid ?? 0,
        },
      ]);
      setRecentlyApprovedIds((prev) => new Set([...prev, rec.id]));
    } catch (err) {
      alert("Lỗi khi duyệt đề xuất: " + String(err));
    } finally {
      setIsApproving(false);
    }
  };

  const renderActionBadge = (recType: string) => {
    switch (recType) {
      case "BID_INCREASE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ArrowUpRight size={13} weight="bold" />
            Tăng
          </span>
        );
      case "BID_DECREASE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            <ArrowDownRight size={13} weight="bold" />
            Giảm
          </span>
        );
      case "PAUSE_TARGET":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Pause size={13} weight="bold" />
            Tạm dừng
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
            {recType}
          </span>
        );
    }
  };

  // Filtered recommendations count in filtered groups
  const filteredRecommendationsCount = useMemo(() => {
    return filteredGroups.reduce((acc, g) => acc + g.totalRecommendations, 0);
  }, [filteredGroups]);

  // Aggregate stats for filtered groups
  const filteredAggregates = useMemo(() => {
    let spend = 0;
    let sales = 0;
    for (const g of filteredGroups) {
      spend += g.spend;
      sales += g.sales;
    }
    const acos = sales > 0 ? (spend / sales) * 100 : (spend > 0 ? 999 : 0);
    return { spend, sales, acos };
  }, [filteredGroups]);

  // Render Sort Header Helper
  const renderSortHeader = (label: string, field: SortField, align: "left" | "right" | "center" = "left") => {
    const isActive = sortField === field;
    return (
      <th
        onClick={() => handleSort(field)}
        className={`py-3 px-3 text-${align} select-none cursor-pointer hover:bg-slate-100/80 transition group`}
        title={`Click để sắp xếp theo ${label}`}
      >
        <div className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"}`}>
          <span className={isActive ? "text-indigo-700 font-black" : "text-slate-700 font-bold group-hover:text-slate-900"}>
            {label}
          </span>
          <span className="text-slate-400">
            {isActive ? (
              sortOrder === "asc" ? (
                <CaretUp size={13} weight="bold" className="text-indigo-600" />
              ) : (
                <CaretDown size={13} weight="bold" className="text-indigo-600" />
              )
            ) : (
              <ArrowsDownUp size={11} className="opacity-0 group-hover:opacity-60 transition" />
            )}
          </span>
        </div>
      </th>
    );
  };

  const isFilterActive = searchTerm !== "" || selectedPhôi !== "ALL" || quickFilter !== "ALL";

  return (
    <div className="space-y-4">
      {/* Top Filter Area: Search, Phôi & Summary */}
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Box */}
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm theo SKU hoặc ASIN..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/20 w-60 shadow-2xs"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} weight="bold" />
                </button>
              )}
            </div>

            {/* Dynamic Phôi Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
              <Tag size={14} className="text-slate-400" />
              <span className="text-slate-500">Phôi:</span>
              <select
                value={selectedPhôi}
                onChange={(e) => setSelectedPhôi(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 font-bold focus:outline-none cursor-pointer pr-1"
              >
                <option value="ALL">Tất cả Phôi ({groups.length})</option>
                {phôiOptions.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Filter Button */}
            {isFilterActive && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedPhôi("ALL");
                  setQuickFilter("ALL");
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer shadow-2xs"
                title="Xóa toàn bộ bộ lọc"
              >
                <X size={13} weight="bold" />
                <span>Đặt lại</span>
              </button>
            )}
          </div>

          {/* Counts & Aggregates Badge */}
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-black text-indigo-700">
              Dữ liệu chỉnh bid: 30D
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <span>
                Hiển thị <strong className="text-slate-900 font-bold">{filteredGroups.length}</strong>/{groups.length} SKU
              </span>
              <span className="text-slate-300">•</span>
              <span>
                <strong className="text-indigo-700 font-bold">{filteredRecommendationsCount}</strong> đề xuất
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Spend: <strong className="text-slate-900 font-mono font-bold">${filteredAggregates.spend.toFixed(0)}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Sales: <strong className="text-emerald-700 font-mono font-bold">${filteredAggregates.sales.toFixed(0)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Quick Filter Chips (BỘ LỌC NHANH - TINH TẾ, GỌN GÀNG, 1 HÀNG) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200/70">
          <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1 mr-0.5">
            <Funnel size={12} weight="bold" className="text-indigo-600" />
            <span>Lọc:</span>
          </span>

          {/* All */}
          <button
            type="button"
            onClick={() => setQuickFilter("ALL")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "ALL"
                ? "bg-indigo-50 text-indigo-700 border-indigo-300 ring-1 ring-indigo-200 shadow-2xs font-extrabold"
                : "bg-slate-100/90 text-slate-700 hover:bg-slate-200/80 border-slate-200"
            }`}
          >
            <span>Tất cả</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "ALL" ? "bg-indigo-100 text-indigo-800" : "bg-white text-slate-700 shadow-2xs border border-slate-200/60"
            }`}>
              {filterCounts.all}
            </span>
          </button>

          {/* Increase */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "INCREASE" ? "ALL" : "INCREASE")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "INCREASE"
                ? "bg-emerald-100 text-emerald-900 border-emerald-400 ring-1 ring-emerald-300 shadow-2xs font-extrabold"
                : "bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/80 border-emerald-200/80"
            }`}
          >
            <ArrowUpRight size={12} weight="bold" className="text-emerald-600" />
            <span>Tăng Bid</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "INCREASE" ? "bg-emerald-200 text-emerald-950" : "bg-white text-emerald-900 shadow-2xs border border-emerald-200/60"
            }`}>
              {filterCounts.increase}
            </span>
          </button>

          {/* Decrease */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "DECREASE" ? "ALL" : "DECREASE")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "DECREASE"
                ? "bg-rose-100 text-rose-900 border-rose-400 ring-1 ring-rose-300 shadow-2xs font-extrabold"
                : "bg-rose-50/70 text-rose-800 hover:bg-rose-100/80 border-rose-200/80"
            }`}
          >
            <ArrowDownRight size={12} weight="bold" className="text-rose-600" />
            <span>Giảm Bid</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "DECREASE" ? "bg-rose-200 text-rose-950" : "bg-white text-rose-900 shadow-2xs border border-rose-200/60"
            }`}>
              {filterCounts.decrease}
            </span>
          </button>

          {/* Pause */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "PAUSE" ? "ALL" : "PAUSE")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "PAUSE"
                ? "bg-amber-100 text-amber-950 border-amber-400 ring-1 ring-amber-300 shadow-2xs font-extrabold"
                : "bg-amber-50/70 text-amber-900 hover:bg-amber-100/80 border-amber-200/80"
            }`}
          >
            <Pause size={12} weight="bold" className="text-amber-600" />
            <span>Pause</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "PAUSE" ? "bg-amber-200 text-amber-950" : "bg-white text-amber-950 shadow-2xs border border-amber-200/60"
            }`}>
              {filterCounts.pause}
            </span>
          </button>

          {/* Bleeding: ACoS > BE ACoS */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "BLEEDING" ? "ALL" : "BLEEDING")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "BLEEDING"
                ? "bg-red-100 text-red-950 border-red-400 ring-1 ring-red-300 shadow-2xs font-extrabold"
                : "bg-red-50/70 text-red-800 hover:bg-red-100/80 border-red-200/80"
            }`}
            title="Các SKU có ACoS vượt ngưỡng hòa vốn (đang chạy lỗ)"
          >
            <WarningCircle size={12} weight="bold" className="text-red-600" />
            <span>Lỗ (ACoS cao)</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "BLEEDING" ? "bg-red-200 text-red-950" : "bg-white text-red-950 shadow-2xs border border-red-200/60"
            }`}>
              {filterCounts.bleeding}
            </span>
          </button>

          {/* Profitable: ACoS <= BE ACoS */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "PROFITABLE" ? "ALL" : "PROFITABLE")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "PROFITABLE"
                ? "bg-teal-100 text-teal-950 border-teal-400 ring-1 ring-teal-300 shadow-2xs font-extrabold"
                : "bg-teal-50/70 text-teal-800 hover:bg-teal-100/80 border-teal-200/80"
            }`}
            title="Các SKU có ACoS thấp hơn hoặc bằng mức hòa vốn (đang có lãi)"
          >
            <CheckCircle size={12} weight="bold" className="text-teal-600" />
            <span>ACoS Tốt</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "PROFITABLE" ? "bg-teal-200 text-teal-950" : "bg-white text-teal-950 shadow-2xs border border-teal-200/60"
            }`}>
              {filterCounts.profitable}
            </span>
          </button>

          {/* Zero Spend: Chưa cắn tiền */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "ZERO_SPEND" ? "ALL" : "ZERO_SPEND")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "ZERO_SPEND"
                ? "bg-sky-100 text-sky-950 border-sky-400 ring-1 ring-sky-300 shadow-2xs font-extrabold"
                : "bg-sky-50/70 text-sky-800 hover:bg-sky-100/80 border-sky-200/80"
            }`}
            title="Các SKU chưa phát sinh chi phí quảng cáo (Spend = $0)"
          >
            <Clock size={12} weight="bold" className="text-sky-600" />
            <span>Chưa cắn tiền</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "ZERO_SPEND" ? "bg-sky-200 text-sky-950" : "bg-white text-sky-950 shadow-2xs border border-sky-200/60"
            }`}>
              {filterCounts.zeroSpend}
            </span>
          </button>

          {/* Zero Sales: Tiêu tiền chưa ra đơn */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "ZERO_SALES" ? "ALL" : "ZERO_SALES")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer border ${
              quickFilter === "ZERO_SALES"
                ? "bg-purple-100 text-purple-950 border-purple-400 ring-1 ring-purple-300 shadow-2xs font-extrabold"
                : "bg-purple-50/70 text-purple-800 hover:bg-purple-100/80 border-purple-200/80"
            }`}
            title="Các SKU đã tiêu tiền nhưng chưa ra đơn hàng nào"
          >
            <Fire size={12} weight="bold" className="text-purple-600" />
            <span>Chưa ra đơn</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
              quickFilter === "ZERO_SALES" ? "bg-purple-200 text-purple-950" : "bg-white text-purple-950 shadow-2xs border border-purple-200/60"
            }`}>
              {filterCounts.zeroSales}
            </span>
          </button>
        </div>
      </div>

      {/* Level 1 Table: Grouped by SKU */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-bold">
            <tr>
              {renderSortHeader("SKU", "sku", "left")}
              <th className="py-3 px-3">ASIN</th>
              <th className="py-3 px-3">Phôi</th>
              {renderSortHeader("Spend", "spend", "right")}
              {renderSortHeader("Sales", "sales", "right")}
              {renderSortHeader("ACoS", "acos", "right")}
              {renderSortHeader("BE ACoS", "breakEvenAcos", "right")}
              {renderSortHeader("Đề xuất", "totalRecommendations", "center")}
              {renderSortHeader("Tăng Bid", "increaseCount", "center")}
              {renderSortHeader("Giảm Bid", "decreaseCount", "center")}
              {renderSortHeader("Pause", "pauseCount", "center")}
              <th className="py-3 px-3 text-center">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-slate-400 font-medium">
                  Không tìm thấy SKU nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const isBleeding = group.spend > 0 && group.acos > group.breakEvenAcos;
                const isGoodAcos = group.sales > 0 && group.acos <= group.breakEvenAcos;

                return (
                  <tr
                    key={group.sku}
                    onClick={() => {
                      setSelectedSkuGroup(group);
                      setRecentlyApprovedIds(new Set());
                      setSelectedRecIds(new Set());
                    }}
                    className="hover:bg-indigo-50/30 transition cursor-pointer group"
                  >
                    <td className="py-3 px-3 font-bold text-slate-900 group-hover:text-indigo-600 transition">
                      {group.sku}
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono">{group.asin || "—"}</td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                        {group.productType}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-900 font-bold font-mono">
                      ${group.spend.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-700 font-black font-mono">
                      ${group.sales.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold">
                      <span
                        className={
                          isBleeding
                            ? "text-rose-600"
                            : isGoodAcos
                            ? "text-emerald-700"
                            : "text-slate-800"
                        }
                      >
                        {group.acos.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-black text-amber-700 font-mono">
                      {group.breakEvenAcos.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-extrabold text-xs border border-indigo-200">
                        {group.totalRecommendations}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-black text-emerald-700 font-mono">
                      {group.increaseCount > 0 ? group.increaseCount : "—"}
                    </td>
                    <td className="py-3 px-3 text-center font-black text-rose-700 font-mono">
                      {group.decreaseCount > 0 ? group.decreaseCount : "—"}
                    </td>
                    <td className="py-3 px-3 text-center font-black text-amber-800 font-mono">
                      {group.pauseCount > 0 ? group.pauseCount : "—"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100/90 border border-indigo-200/70 shadow-2xs transition cursor-pointer">
                        <span>Chi tiết</span>
                        <CaretRight size={12} weight="bold" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* SKU RECOMMENDATION DETAIL MODAL */}
      {selectedSkuGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={() => setSelectedSkuGroup(null)}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] bg-white border border-slate-200 rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-black text-slate-900">
                    ĐỀ XUẤT CHO SKU: <span className="text-indigo-600">{selectedSkuGroup.sku}</span>
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {selectedSkuGroup.productType}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  ASIN: {selectedSkuGroup.asin} • Tổng cộng {currentSkuRecs.length} đề xuất tối ưu hóa
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedSkuGroup(null);
                  setModalSearch("");
                  setModalActionFilter("ALL");
                  setRecentlyApprovedIds(new Set());
                  setSelectedRecIds(new Set());
                  setExpandedCampaigns(new Set());
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* TOP BLOCKS: BLOCK A & BLOCK B */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Block A — SKU Economics */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Block A — SKU Economics
                    </h3>
                    <span className="text-[10px] text-slate-500">
                      CR Source: <strong className="text-slate-800">{selectedSkuGroup.economics.crSource}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-center pt-1">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Price</div>
                      <div className="text-xs font-black text-slate-900 font-mono mt-0.5">
                        ${selectedSkuGroup.economics.sellingPrice.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Profit B. Ads</div>
                      <div className="text-xs font-black text-emerald-700 font-mono mt-0.5">
                        ${selectedSkuGroup.economics.profitBeforeAds.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">BE ACoS</div>
                      <div className="text-xs font-black text-amber-700 font-mono mt-0.5">
                        {selectedSkuGroup.breakEvenAcos.toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">CR</div>
                      <div className="text-xs font-bold text-slate-800 font-mono mt-0.5">
                        {(selectedSkuGroup.economics.cr * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Max Bid</div>
                      <div className="text-xs font-black text-indigo-600 font-mono mt-0.5">
                        ${selectedSkuGroup.economics.maxBid.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Block B — PPC Summary */}
                <div className="bg-indigo-50/40 rounded-2xl p-4 border border-indigo-100 space-y-3">
                  <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                    <h3 className="text-xs font-black text-indigo-900 uppercase tracking-wider">
                      Block B — PPC Summary
                    </h3>
                    <span className="text-[10px] text-indigo-600 font-bold">Chu kỳ 30 ngày gần nhất</span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center pt-1">
                    <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Spend</div>
                      <div className="text-xs font-black text-slate-900 font-mono mt-0.5">
                        ${selectedSkuGroup.spend.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Sales</div>
                      <div className="text-xs font-black text-emerald-700 font-mono mt-0.5">
                        ${selectedSkuGroup.sales.toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">Orders</div>
                      <div className="text-xs font-black text-slate-900 font-mono mt-0.5">
                        {selectedSkuGroup.orders}
                      </div>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-indigo-100 shadow-2xs">
                      <div className="text-[10px] font-semibold text-slate-500">ACoS</div>
                      <div className="text-xs font-black text-amber-700 font-mono mt-0.5">
                        {selectedSkuGroup.acos.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* BLOCK C: RECOMMENDATIONS TABLE GROUPED BY CAMPAIGN */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                        Block C — Đề Xuất
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {currentSkuRecs.length} targets · {groupedByCampaign.length} campaigns
                      </span>
                    </div>

                    {/* Modal search */}
                    <div className="relative">
                      <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Lọc từ khóa / campaign..."
                        value={modalSearch}
                        onChange={(e) => setModalSearch(e.target.value)}
                        className="pl-7 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-xs w-52 focus:outline-none focus:border-indigo-600"
                      />
                    </div>

                    {/* Modal action filter pills */}
                    <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 text-xs">
                      <button
                        onClick={() => setModalActionFilter("ALL")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          modalActionFilter === "ALL" ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Tất cả
                      </button>
                      <button
                        onClick={() => setModalActionFilter("BID_INCREASE")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          modalActionFilter === "BID_INCREASE" ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:text-emerald-600"
                        }`}
                      >
                        ↑ Tăng
                      </button>
                      <button
                        onClick={() => setModalActionFilter("BID_DECREASE")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          modalActionFilter === "BID_DECREASE" ? "bg-rose-50 text-rose-700" : "text-slate-600 hover:text-rose-600"
                        }`}
                      >
                        ↓ Giảm
                      </button>
                      <button
                        onClick={() => setModalActionFilter("PAUSE_TARGET")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                          modalActionFilter === "PAUSE_TARGET" ? "bg-amber-50 text-amber-800" : "text-slate-600 hover:text-amber-700"
                        }`}
                      >
                        ⏸ Pause
                      </button>
                    </div>

                    {selectedRecIds.size > 0 && (
                      <span className="text-xs text-indigo-600 font-bold">
                        (Đã chọn {selectedRecIds.size} mục)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleExpandAllCampaigns}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                    >
                      {expandedCampaigns.size === groupedByCampaign.length && groupedByCampaign.length > 0 ? (
                        <>
                          <CaretUp size={14} weight="bold" className="text-indigo-600" />
                          <span>Thu gọn tất cả</span>
                        </>
                      ) : (
                        <>
                          <CaretDown size={14} weight="bold" className="text-indigo-600" />
                          <span>Mở tất cả ({groupedByCampaign.length})</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer flex items-center gap-1.5"
                    >
                      {selectedRecIds.size === currentSkuRecs.length && currentSkuRecs.length > 0 ? (
                        <>
                          <CheckSquare size={15} className="text-indigo-600" weight="fill" />
                          <span>Bỏ chọn tất cả</span>
                        </>
                      ) : (
                        <>
                          <Square size={15} className="text-slate-400" />
                          <span>Chọn tất cả ({currentSkuRecs.length})</span>
                        </>
                      )}
                    </button>

                    {recentlyApprovedIds.size > 0 && selectedRecIds.size === 0 ? (
                      <button
                        onClick={handleOpenActionQueueModal}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition shadow-2xs cursor-pointer animate-in fade-in duration-200"
                        title="Đã duyệt vào Action Queue. Bấm vào đây để mở Action Queue"
                      >
                        <Lightning size={14} weight="fill" className="text-amber-300" />
                        <span>Action ({recentlyApprovedIds.size})</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleApproveSelected}
                        disabled={selectedRecIds.size === 0 || isApproving}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-2xs disabled:opacity-40 cursor-pointer"
                      >
                        <CheckCircle size={14} weight="bold" />
                        <span>{isApproving ? "Đang xử lý..." : `Duyệt ${selectedRecIds.size} mục đã chọn`}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Grouped Campaign Cards */}
                {groupedByCampaign.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-slate-200">
                    Không có đề xuất nào cho SKU này theo bộ lọc hiện tại.
                  </div>
                ) : (
                  <div className="space-y-3.5 max-h-[52vh] overflow-y-auto pr-1">
                    {groupedByCampaign.map((cg) => {
                      const isCampaignAllSelected = cg.recs.length > 0 && cg.recs.every((r) => selectedRecIds.has(r.id));
                      const isCampaignSomeSelected = !isCampaignAllSelected && cg.recs.some((r) => selectedRecIds.has(r.id));
                      const isExpanded = expandedCampaigns.has(cg.campaignName);

                      return (
                        <div
                          key={cg.campaignName}
                          className={`rounded-xl border transition shadow-2xs overflow-hidden ${
                            isExpanded
                              ? "border-indigo-200 ring-1 ring-indigo-200/50 bg-white"
                              : "border-slate-200 hover:border-indigo-300 bg-white"
                          }`}
                        >
                          {/* Campaign Header Bar — Click anywhere to expand/collapse */}
                          <div
                            onClick={() => toggleCampaignExpanded(cg.campaignName)}
                            className={`flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 border-b cursor-pointer select-none transition ${
                              isExpanded
                                ? "bg-indigo-50/50 border-indigo-100"
                                : "bg-slate-50/90 hover:bg-indigo-50/30 border-slate-200"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
                              {/* Checkbox wrapper with stopPropagation */}
                              <div onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => handleToggleSelectCampaign(cg.recs)}
                                  className="text-slate-400 hover:text-slate-700 cursor-pointer p-0.5 rounded"
                                  title={isCampaignAllSelected ? "Bỏ chọn campaign này" : "Chọn tất cả trong campaign này"}
                                >
                                  {isCampaignAllSelected ? (
                                    <CheckSquare size={17} className="text-indigo-600" weight="fill" />
                                  ) : isCampaignSomeSelected ? (
                                    <div className="w-4 h-4 rounded border-2 border-indigo-600 flex items-center justify-center bg-indigo-50">
                                      <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                                    </div>
                                  ) : (
                                    <Square size={17} />
                                  )}
                                </button>
                              </div>

                              <CaretRight
                                size={15}
                                weight="bold"
                                className={`text-slate-400 transition-transform duration-200 ${
                                  isExpanded ? "rotate-90 text-indigo-600" : "text-slate-400"
                                }`}
                              />

                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-200/80">
                                {cg.campaignType}
                              </span>

                              {/* FULL CAMPAIGN NAME (NO TRUNCATION!) */}
                              <h4
                                className="font-bold text-slate-900 text-xs font-mono break-all select-all flex-1 hover:text-indigo-600 transition"
                                title="Bấm để mở / thu gọn danh sách target"
                              >
                                {cg.campaignName}
                              </h4>
                            </div>

                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="px-2 py-0.5 rounded font-bold text-slate-600 bg-white border border-slate-200">
                                {cg.recs.length} target{cg.recs.length > 1 ? "s" : ""}
                              </span>

                              {cg.totalIncrease > 0 && (
                                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  ↑ {cg.totalIncrease}
                                </span>
                              )}
                              {cg.totalDecrease > 0 && (
                                <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                  ↓ {cg.totalDecrease}
                                </span>
                              )}
                              {cg.totalPause > 0 && (
                                <span className="text-amber-800 font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                  ⏸ {cg.totalPause}
                                </span>
                              )}

                              <span className="text-[11px] font-bold text-indigo-600 pl-1">
                                {isExpanded ? "Thu gọn ▲" : "Xem target ▼"}
                              </span>
                            </div>
                          </div>

                          {/* Target Table Inside Campaign (only visible when expanded) */}
                          {isExpanded && (
                            <div className="overflow-x-auto animate-in fade-in duration-150">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50/60 text-slate-600 border-b border-slate-100 font-bold text-[11px]">
                                  <tr>
                                    <th className="py-2.5 px-3 w-8"></th>
                                    <th className="py-2.5 px-2 w-24">Hành động</th>
                                    <th className="py-2.5 px-3">Target / Keyword</th>
                                    <th className="py-2.5 px-3 text-right">Current Bid</th>
                                    <th className="py-2.5 px-3 text-right">Suggested Bid</th>
                                    <th className="py-2.5 px-3 text-right w-24">Final Bid</th>
                                    <th className="py-2.5 px-3">Rule Profile</th>
                                    <th className="sticky right-0 z-10 w-24 border-l border-slate-100 bg-slate-50/80 py-2.5 px-3 text-center shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.3)]">
                                      Thao tác
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                  {cg.recs.map((rec) => {
                                    const isSelected = selectedRecIds.has(rec.id);
                                    const finalBid = userFinalBids[rec.id] ?? rec.recommendedBid ?? rec.currentBid ?? 0;
                                    const isApproved = recentlyApprovedIds.has(rec.id);

                                    return (
                                      <tr
                                        key={rec.id}
                                        className={`hover:bg-indigo-50/20 transition ${
                                          isSelected ? "bg-indigo-50/40" : ""
                                        }`}
                                      >
                                        <td className="py-2.5 px-3">
                                          <button
                                            type="button"
                                            onClick={() => handleToggleSelectOne(rec.id)}
                                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                          >
                                            {isSelected ? (
                                              <CheckSquare size={16} className="text-indigo-600" weight="fill" />
                                            ) : (
                                              <Square size={16} />
                                            )}
                                          </button>
                                        </td>
                                        <td className="py-2.5 px-2 whitespace-nowrap">
                                          {renderActionBadge(rec.recType)}
                                        </td>
                                        <td className="py-2.5 px-3">
                                          <div className="font-bold text-slate-900 break-words flex items-center gap-1.5" title={rec.keyword}>
                                            <span>{rec.keyword}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleExplainWithAi(rec)}
                                              disabled={explainingRecId === rec.id}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 transition cursor-pointer disabled:opacity-50 shrink-0"
                                              title="AI (Gemini 2.5 Flash) giải thích tại sao đề xuất mức bid này"
                                            >
                                              <Sparkle size={10} weight="fill" className={explainingRecId === rec.id ? "animate-spin text-violet-600" : "text-violet-600"} />
                                              <span>{explainingRecId === rec.id ? "Đang nghĩ..." : "AI"}</span>
                                            </button>
                                          </div>
                                          {rec.matchType && (
                                            <div className="text-[10px] text-slate-400 uppercase font-mono mt-0.5">
                                              Match: {rec.matchType}
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                          ${rec.currentBid ? rec.currentBid.toFixed(2) : "0.00"}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-black text-indigo-700 font-mono">
                                          {rec.recType === "PAUSE_TARGET" ? "—" : `$${(rec.recommendedBid || 0).toFixed(2)}`}
                                        </td>
                                        <td className="py-2.5 px-3 text-right">
                                          {rec.recType === "PAUSE_TARGET" ? (
                                            <span className="text-slate-400 font-mono font-bold">Pause</span>
                                          ) : (
                                            <input
                                              type="text"
                                              inputMode="decimal"
                                              value={finalBid ? finalBid.toFixed(2) : ""}
                                              onChange={(e) => handleFinalBidChange(rec.id, e.target.value)}
                                              className="w-18 px-2 py-1 bg-slate-50 border border-slate-300 rounded text-right text-slate-900 font-mono text-xs focus:outline-none focus:border-indigo-600 focus:bg-white"
                                            />
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                                          {rec.ruleProfile || "v1.0"}
                                        </td>
                                        <td
                                          className={`sticky right-0 z-[5] border-l border-slate-100 py-2.5 px-3 text-center shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.3)] ${
                                            isSelected ? "bg-indigo-50" : "bg-white"
                                          }`}
                                        >
                                          {isApproved ? (
                                            <button
                                              onClick={handleOpenActionQueueModal}
                                              className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] shadow-2xs transition cursor-pointer flex items-center justify-center gap-1 mx-auto"
                                              title="Mục này đã được duyệt vào hàng đợi. Bấm vào đây để mở Action Queue"
                                            >
                                              <Lightning size={12} weight="fill" className="text-amber-300" />
                                              <span>Action</span>
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => handleApproveSingle(rec)}
                                              disabled={isApproving}
                                              className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[11px] border border-indigo-200 transition cursor-pointer"
                                            >
                                              Duyệt
                                            </button>
                                          )}
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
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 bg-slate-50/70">
              <span className="text-xs text-slate-500">
                Lưu ý: Hành động duyệt sẽ đẩy đề xuất vào <strong>Action Queue</strong> để kiểm tra trùng lặp trước khi xuất Amazon Bulk File.
              </span>
              <button
                onClick={() => {
                  setSelectedSkuGroup(null);
                  setRecentlyApprovedIds(new Set());
                  setSelectedRecIds(new Set());
                  setExpandedCampaigns(new Set());
                }}
                className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition cursor-pointer shadow-2xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Explanation Modal */}
      {aiExplanationModal && (() => {
        const rec = aiExplanationModal.rec;
        const breakEven = selectedSkuGroup?.economics?.breakEvenAcos;
        const maxBidCap = selectedSkuGroup?.economics?.maxBid;
        const info = getStructuredAiExplanation(aiExplanationModal, breakEven, maxBidCap);
        const actualAcosStr = rec.sales && rec.sales > 0 && rec.spend ? `${((rec.spend / rec.sales) * 100).toFixed(1)}%` : "Chưa có";
        const isIncrease = rec.recType === "BID_INCREASE";
        const isPause = rec.recType === "PAUSE_TARGET";

        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 max-w-lg w-full p-5 space-y-3.5 overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-2 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                    <Sparkle size={18} weight="fill" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>Giải thích Đề xuất Bid</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 font-semibold border border-violet-200">
                        AI Rule Engine
                      </span>
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono mt-0.5 flex-wrap">
                      <span className="font-bold text-slate-800">{rec.keyword}</span>
                      {rec.matchType && (
                        <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-semibold text-[10px] uppercase">
                          {rec.matchType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAiExplanationModal(null)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer shrink-0"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 4 Quick Stat Pills */}
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-1.5">
                  <div className="text-[9px] text-slate-400 uppercase">Giá thầu</div>
                  <div className="font-bold text-xs">
                    <span className="text-slate-400 line-through mr-1">${rec.currentBid?.toFixed(2)}</span>
                    <span className={isPause ? "text-rose-600" : isIncrease ? "text-emerald-700" : "text-indigo-700"}>
                      ${rec.recommendedBid?.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-1.5">
                  <div className="text-[9px] text-slate-400 uppercase">Avg CPC</div>
                  <div className="font-bold text-xs text-indigo-700 font-mono">
                    ${(rec.cpc || 0).toFixed(2)}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-1.5">
                  <div className="text-[9px] text-slate-400 uppercase">ACoS / Hòa vốn</div>
                  <div className="font-bold text-xs text-slate-800 font-mono">
                    {actualAcosStr} {breakEven ? `/ ${breakEven}%` : ""}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-lg p-1.5">
                  <div className="text-[9px] text-slate-400 uppercase">Đơn / Clicks</div>
                  <div className="font-bold text-xs text-slate-800 font-mono">
                    {rec.orders || 0} đơn / {rec.clicks || 0} clk
                  </div>
                </div>
              </div>

              {/* Khối 1: Luật áp dụng & Điều kiện */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1.5 text-xs shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span>📋 Luật áp dụng</span>
                  </span>
                  {info.ruleName && (
                    <span className="px-2 py-0.5 rounded bg-violet-50 text-violet-700 font-mono font-bold text-[10px] border border-violet-200">
                      {info.ruleName}
                    </span>
                  )}
                </div>
                <p className="text-slate-700 leading-relaxed">
                  {info.ruleCondition}
                </p>
              </div>

              {/* Khối 2: Phép tính số học & Trần/Sàn */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span>🧮 Phép tính & Giới hạn</span>
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                    <ShieldCheck size={13} weight="fill" className="text-emerald-600" />
                    <span>Hợp lệ</span>
                  </span>
                </div>

                <div className="bg-slate-900 text-slate-100 rounded-lg p-2.5 font-mono text-xs flex items-center justify-between flex-wrap gap-2">
                  <span className="text-slate-300">{info.formula}</span>
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="text-slate-400">➔</span>
                    <span className="text-emerald-400 px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-800">
                      {info.resultBid}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1 border border-slate-100 font-mono">
                  <span>Sàn: $0.10</span>
                  <span className="text-indigo-700 font-bold">Đề xuất: {info.resultBid}</span>
                  <span>Trần: ${maxBidCap ? maxBidCap.toFixed(2) : "2.80"}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setAiExplanationModal(null)}
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function getStructuredAiExplanation(
  modal: { rec: PpcRecommendation; explanation: string; structured?: any },
  breakEvenAcos?: number,
  maxBidLimit?: number
) {
  const structured = modal.structured;
  if (structured && structured.ruleCondition && structured.formula) {
    return {
      ruleName: structured.ruleName || "MATCHED_RULE",
      ruleCondition: structured.ruleCondition,
      formula: structured.formula,
      resultBid: structured.resultBid || `$${(modal.rec.recommendedBid || 0).toFixed(2)}`,
      boundaryNote: structured.boundaryNote || "",
    };
  }

  const rec = modal.rec;
  const beAcos = breakEvenAcos ?? 48;
  const actualAcos = rec.sales && rec.sales > 0 && rec.spend ? (rec.spend / rec.sales) * 100 : null;
  const isIncrease = rec.recType === "BID_INCREASE";
  const isPause = rec.recType === "PAUSE_TARGET";
  const isWarning = actualAcos !== null && actualAcos > 40 && actualAcos <= beAcos;

  let ruleName = rec.reason ? rec.reason.split(":")[0]?.replace(/\[.*?\]\s*/, "").trim() : "PPC_RULE";
  let ruleCondition = "";

  if (isPause) {
    ruleCondition = `${rec.clicks || 0} clicks không ra đơn (vượt trần cho phép) ➔ Tạm dừng target (PAUSE).`;
  } else if (isIncrease) {
    ruleCondition = `ACoS ${actualAcos?.toFixed(1)}% ≤ 20% (vùng hiệu quả cao) ➔ Tăng +8% Current Bid.`;
  } else if (isWarning) {
    ruleCondition = `ACoS ${actualAcos?.toFixed(1)}% nằm trong khoảng [40% - ${beAcos}% hòa vốn] ➔ Quy định giảm -8% Avg CPC.`;
  } else if (actualAcos !== null && actualAcos > beAcos) {
    ruleCondition = `ACoS ${actualAcos?.toFixed(1)}% vượt ACoS hòa vốn (${beAcos}%) ➔ Giảm mạnh -15% Avg CPC.`;
  } else {
    ruleCondition = rec.reason || `Khớp điều kiện quy tắc tối ưu.`;
  }

  const exactCpc = rec.spend && rec.clicks && rec.clicks > 0 ? rec.spend / rec.clicks : (rec.cpc || rec.currentBid || 0);
  const formula = isPause
    ? `Tạm dừng target (Bid = $${(rec.recommendedBid || 0).toFixed(2)})`
    : isIncrease
    ? `$${(rec.currentBid || 0).toFixed(2)} (Current Bid) × 1.08 = $${((rec.currentBid || 0) * 1.08).toFixed(3)}`
    : `$${exactCpc.toFixed(2)} (Avg CPC) × 0.92 = $${(exactCpc * 0.92).toFixed(3)}`;

  return {
    ruleName,
    ruleCondition,
    formula,
    resultBid: `$${(rec.recommendedBid || 0).toFixed(2)}`,
    boundaryNote: maxBidLimit
      ? `Sàn $0.10 ≤ $${(rec.recommendedBid || 0).toFixed(2)} ≤ Trần $${maxBidLimit.toFixed(2)}`
      : `Nằm trong khoảng an toàn`,
  };
}
