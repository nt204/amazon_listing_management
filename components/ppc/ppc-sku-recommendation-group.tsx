"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import type { RequestActor } from "@/lib/auth";
import { usePpcColumnVisibility } from "./use-ppc-column-visibility";
import {
  Tag,
  CheckCircle,
  X,
  CaretRight,
  ArrowRight,
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
  Lightning,
  Calculator,
  ShieldCheck,
  Check,
  Info,
  ClipboardText,
  CircleNotch,
  PencilSimple,
  Target,
  Sparkle,
  UserCircle,
} from "@phosphor-icons/react";
import {
  SKU_PREFIX_ERROR_PRODUCT_TYPE,
  type SkuRecommendationGroup,
  type PpcAction,
} from "@/lib/ppc/sku-architecture-types";
import type { PpcRecommendation, PpcSkuDailyTrendPoint } from "@/lib/ppc/types";
import type { AiReviewerExecutionResult } from "@/lib/ppc/ai-reviewer";
import { PpcPagination } from "./ppc-pagination";
import { SkuTrendSparkline } from "./ppc-sku-trend-modal";
import { PpcAutoBidResultsModal } from "./ppc-auto-bid-results-modal";
import { PpcSkuAiChatPanel } from "./ppc-sku-ai-chat-panel";
import {
  PpcAiReviewerModal,
  type AiReviewApplicationSnapshot,
} from "./ppc-ai-reviewer-modal";

interface PpcSkuRecommendationGroupProps {
  isActive: boolean;
  groups: SkuRecommendationGroup[];
  allRecommendations: PpcRecommendation[];
  isLoading: boolean;
  recommendationWindowDays: number;
  loadedRecommendationWindowDays: number | null;
  onRecommendationWindowChange: (days: 7 | 30) => void;
  /** force = bỏ qua cache (vd. sau khi đổi Max Bid). */
  onLoadSkuRecommendations: (sku: string, force?: boolean) => Promise<PpcRecommendation[]>;
  onApproveToQueue: (items: Array<{
    recommendation: PpcRecommendation;
    userFinalBid?: number;
    decisionSource?: "AI_AGENT";
    aiReview?: AiReviewApplicationSnapshot;
  }>) => Promise<void>;
  onOpenActionQueue: () => void;
  pendingQueueCount: number;
  actionQueue?: PpcAction[];
  selectedStore?: string;
  isStoreSwitching?: boolean;
  includePausedCampaigns?: boolean;
  onIncludePausedCampaignsChange?: (include: boolean) => void;
  targetSkuToOpen?: string | null;
  onClearTargetSkuToOpen?: () => void;
  actor?: RequestActor;
  /** dailyTrend theo SKU (từ bảng SKU) cho cột Trend (7D); bấm mở PpcSkuTrendModal như tab SKU. */
  skuTrends?: Map<string, PpcSkuDailyTrendPoint[]>;
  onOpenSkuTrend?: (data: { sku: string; storeName: string; mockupUrl?: string | null; dailyTrend: PpcSkuDailyTrendPoint[] }) => void;
}

export type QuickFilterType =
  | "ALL"
  | "INCREASE"
  | "DECREASE"
  | "PAUSE"
  | "BLEEDING"
  | "PROFITABLE"
  | "ZERO_SPEND"
  | "ZERO_SALES"
  | "PREFIX_ERROR";

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

function getOptimizedThumbnailUrl(url: string | null | undefined, w = 64): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("media-amazon.com") || trimmed.includes("images-amazon.com")) {
    if (/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    if (/\/images\/I\/[A-Za-z0-9%_+-]+\.([a-zA-Z]+)(?:\?.*)?$/.test(trimmed)) {
      return trimmed.replace(/\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    }
    return trimmed;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/accounting/inventory/mockup-proxy?w=${w}&url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

// Dạng chạy của campaign: ưu tiên ruleProfile, sau đó đoán theo tên campaign.
function getRecCampaignType(rec: PpcRecommendation): string {
  const camp = (rec.campaignName || "").toUpperCase();
  const ruleProf = (rec.ruleProfile || "").toUpperCase();
  if (ruleProf.startsWith("SB05") || /SB05|\bVIDEO\b/.test(camp)) return "SB05";
  if (ruleProf.startsWith("SB01") || /SB01/.test(camp)) return "SB01";
  if (ruleProf.startsWith("SP03") || /SP03/.test(camp)) return "SP03";
  if (rec.adType === "SB") return "SB";
  return "SP03";
}

function AcosValue({ spend, sales, breakEvenAcos, className = "" }: {
  spend: number;
  sales: number;
  breakEvenAcos: number;
  className?: string;
}) {
  if (sales <= 0) {
    return <span className={`${spend > 0 ? "text-rose-600" : "text-slate-400"} ${className}`}>—</span>;
  }
  const acos = (spend / sales) * 100;
  const tone = breakEvenAcos > 0 && acos > breakEvenAcos ? "text-rose-600" : "text-emerald-600";
  return <span className={`${tone} ${className}`}>{acos.toFixed(1)}%</span>;
}

interface RecFinalBidInputProps {
  initialValue: number;
  onCommit: (val: number) => void;
  disabled?: boolean;
  large?: boolean;
}

function RecFinalBidInput({ initialValue, onCommit, disabled, large = false }: RecFinalBidInputProps) {
  const [val, setVal] = useState<string>(initialValue ? initialValue.toFixed(2) : "0.00");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setVal(initialValue ? initialValue.toFixed(2) : "0.00");
    }
  }, [initialValue, isFocused]);

  const handleCommit = () => {
    const cleaned = val.replace(",", ".");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed) && parsed > 0) {
      const rounded = Math.round(parsed * 100) / 100;
      onCommit(rounded);
      setVal(rounded.toFixed(2));
    } else {
      setVal(initialValue ? initialValue.toFixed(2) : "0.00");
    }
  };

  return (
    <div
      className={`inline-flex items-center border transition ${
        large ? "w-full rounded-lg px-3 py-2" : "justify-end rounded-md px-2 py-1"
      } ${
        isFocused
          ? "border-indigo-600 bg-white ring-1 ring-indigo-500 shadow-2xs"
          : "border-slate-300 bg-white hover:border-indigo-400"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`font-bold text-slate-400 select-none mr-1 ${large ? "text-sm" : "text-[10px]"}`}>$</span>
      <input
        type="text"
        inputMode="decimal"
        value={val}
        disabled={disabled}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          handleCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setVal(initialValue ? initialValue.toFixed(2) : "0.00");
            e.currentTarget.blur();
          }
        }}
        className={`font-mono font-bold text-slate-900 bg-transparent border-0 p-0 focus:outline-none focus:ring-0 ${
          large ? "flex-1 min-w-0 text-base" : "w-14 text-right text-xs"
        }`}
        title="Nhập mức Final Bid và bấm Enter hoặc click ra ngoài để lưu"
      />
    </div>
  );
}

export function PpcSkuRecommendationGroupView({
  isActive,
  groups,
  allRecommendations,
  isLoading,
  recommendationWindowDays,
  loadedRecommendationWindowDays,
  onRecommendationWindowChange,
  onLoadSkuRecommendations,
  onApproveToQueue,
  onOpenActionQueue,
  pendingQueueCount,
  actionQueue,
  selectedStore,
  isStoreSwitching = false,
  includePausedCampaigns = false,
  onIncludePausedCampaignsChange,
  targetSkuToOpen,
  onClearTargetSkuToOpen,
  actor,
  skuTrends,
  onOpenSkuTrend,
}: PpcSkuRecommendationGroupProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [recTable, setRecTable] = useState<HTMLTableElement | null>(null);
  const recColumnPicker = usePpcColumnVisibility(recTable, "sku_recommendations", actor);
  const [selectedPhôi, setSelectedPhôi] = useState("ALL");
  const [selectedNiche, setSelectedNiche] = useState("ALL");
  const [selectedPic, setSelectedPic] = useState("ALL");
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("ALL");
  const [selectedCampType, setSelectedCampType] = useState<"ALL" | "SP03" | "SB05" | "SB01">("ALL");
  const [sortField, setSortField] = useState<SortField>("totalRecommendations");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedSkuGroup, setSelectedSkuGroup] = useState<SkuRecommendationGroup | null>(null);
  const [loadingSkuDetails, setLoadingSkuDetails] = useState(false);
  // Lưu theo SKU: mở SKU khác thì panel chat tự đóng.
  const [aiChatSku, setAiChatSku] = useState<string | null>(null);
  const isAiChatOpen = Boolean(selectedSkuGroup && aiChatSku === selectedSkuGroup.sku);
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const selectAllSkusRef = useRef<HTMLInputElement>(null);

  // Detail View State
  const [selectedRecIds, setSelectedRecIds] = useState<Set<string>>(new Set());
  const [userFinalBids, setUserFinalBids] = useState<Record<string, number>>({});
  const [aiReviewApplications, setAiReviewApplications] = useState<Record<string, {
    source: "AI_AGENT" | "RULE_FALLBACK";
    audit: AiReviewApplicationSnapshot;
  }>>({});
  const [isApproving, setIsApproving] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [modalActionFilter, setModalActionFilter] = useState<"ALL" | "BID_INCREASE" | "BID_DECREASE" | "PAUSE_TARGET">("ALL");
  const [modalCampTypeFilter, setModalCampTypeFilter] = useState<"ALL" | "SP03" | "SB05" | "SB01">("ALL");
  const [modalCampaignFilter, setModalCampaignFilter] = useState("ALL");
  // Target đang xem ở panel chi tiết bên phải; null = target đầu tiên
  const [focusedRecId, setFocusedRecId] = useState<string | null>(null);
  const autoExpandedSkuRef = useRef<string | null>(null);
  const [recentlyApprovedIds, setRecentlyApprovedIds] = useState<Set<string>>(new Set());
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [ruleExplanationModal, setRuleExplanationModal] = useState<PpcRecommendation | null>(null);
  const [showOutcomesModal, setShowOutcomesModal] = useState(false);
  // Max Bid nhập tay trong Block A: null = đang không sửa
  const [maxBidDraft, setMaxBidDraft] = useState<string | null>(null);
  const [isSavingMaxBid, setIsSavingMaxBid] = useState(false);
  const previousRecommendationWindowRef = useRef(recommendationWindowDays);
  const previousStoreRef = useRef(selectedStore);

  // When store changes, reset all open modals, selections and filters to prevent cross-store leakage
  useEffect(() => {
    if (previousStoreRef.current !== selectedStore) {
      previousStoreRef.current = selectedStore;
      setSelectedSkuGroup(null);
      setSelectedRecIds(new Set());
      setSelectedSkus(new Set());
      setUserFinalBids({});
      setAiReviewApplications({});
      setRecentlyApprovedIds(new Set());
      setRuleExplanationModal(null);
      setSearchTerm("");
      setSelectedPhôi("ALL");
      setSelectedNiche("ALL");
      setQuickFilter("ALL");
      setSelectedCampType("ALL");
      setModalCampTypeFilter("ALL");
      setModalCampaignFilter("ALL");
      setFocusedRecId(null);
      setExpandedCampaigns(new Set());
    }
  }, [selectedStore]);

  // Keep an open SKU detail modal attached to the newly loaded attribution
  // window instead of retaining the old group object in local state.
  useEffect(() => {
    // This state mirrors the refreshed group object while the detail modal is open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSkuGroup((current) => {
      if (!current) return null;
      return groups.find((group) => group.sku.toUpperCase() === current.sku.toUpperCase()) || null;
    });
  }, [groups]);

  // Open SKU group detail modal when requested from external tab (e.g. Tab SKU)
  useEffect(() => {
    if (!targetSkuToOpen) return;
    const norm = targetSkuToOpen.toUpperCase().trim();
    const found = groups.find((group) => group.sku.toUpperCase() === norm);
    if (found) {
      void handleOpenSkuGroup(found);
      onClearTargetSkuToOpen?.();
    } else if (!isLoading && groups.length > 0) {
      // SKU không có trong danh sách đề xuất → Lỗi Prefix, không gán số của phôi mặc định
      const fallbackGroup: SkuRecommendationGroup = {
        sku: targetSkuToOpen,
        asin: "",
        productType: SKU_PREFIX_ERROR_PRODUCT_TYPE,
        mockupUrl: null,
        picMkt: null,
        niche: null,
        spend: 0,
        sales: 0,
        orders: 0,
        clicks: 0,
        acos: 0,
        breakEvenAcos: 0,
        totalRecommendations: 0,
        increaseCount: 0,
        decreaseCount: 0,
        pauseCount: 0,
        budgetCount: 0,
        campaignTypes: [],
        campaignStates: [],
        economics: {
          id: targetSkuToOpen,
          storeId: selectedStore || "",
          sku: targetSkuToOpen,
          productType: SKU_PREFIX_ERROR_PRODUCT_TYPE,
          asin: "",
          sellingPrice: 0,
          baseCost: 0,
          amazonFee: 0,
          taxRate: 0.03,
          profitBeforeAds: 0,
          breakEvenAcos: 0,
          cr: 0.1,
          crSource: "ASSUMED",
          maxBid: 0,
          costSource: "INHERITED",
        },
      };
      void handleOpenSkuGroup(fallbackGroup);
      onClearTargetSkuToOpen?.();
    }
  }, [targetSkuToOpen, groups, isLoading]);

  // AI explanations contain calculated values from one attribution window.
  // Close them on a window change so 7D copy can never be shown as 30D data.
  useEffect(() => {
    if (previousRecommendationWindowRef.current !== recommendationWindowDays) {
      setRuleExplanationModal(null);
      setSelectedRecIds(new Set());
      setSelectedSkus(new Set());
      setUserFinalBids({});
      setAiReviewApplications({});
      previousRecommendationWindowRef.current = recommendationWindowDays;
    }
  }, [recommendationWindowDays]);

  const handleToggleSku = (sku: string) => {
    setSelectedSkus((current) => {
      const next = new Set(current);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const handleToggleAllVisibleSkus = () => {
    setSelectedSkus((current) => {
      const next = new Set(current);
      if (areAllVisibleSkusSelected) {
        for (const group of filteredGroups) next.delete(group.sku);
      } else {
        for (const group of filteredGroups) next.add(group.sku);
      }
      return next;
    });
  };

  const handleApproveSelectedSkus = async () => {
    if (selectedSkus.size === 0 || isStoreSwitching || isBulkApproving) return;

    try {
      setIsBulkApproving(true);
      const skuList = Array.from(selectedSkus);
      const recommendations: PpcRecommendation[] = [];

      // Load in small batches to avoid flooding the grouped recommendation API.
      for (let index = 0; index < skuList.length; index += 5) {
        const batch = skuList.slice(index, index + 5);
        const batchResults = await Promise.all(batch.map((sku) => onLoadSkuRecommendations(sku)));
        recommendations.push(...batchResults.flat());
      }

      if (recommendations.length === 0) {
        alert("Các SKU đã chọn không còn đề xuất nào để duyệt.");
        return;
      }

      await onApproveToQueue(recommendations.map((recommendation) => ({
        recommendation,
        userFinalBid: recommendation.recommendedBid ?? recommendation.currentBid ?? 0,
      })));
      setSelectedSkus(new Set());
    } catch (err) {
      alert("Lỗi khi duyệt nhiều SKU: " + String(err));
    } finally {
      setIsBulkApproving(false);
    }
  };

  const handleExplainRule = (rec: PpcRecommendation) => setRuleExplanationModal(rec);

  const [aiReviewModalRec, setAiReviewModalRec] = useState<PpcRecommendation | null>(null);
  const [aiReviewResult, setAiReviewResult] = useState<AiReviewerExecutionResult | null>(null);
  const [aiReviewScenarioInfo, setAiReviewScenarioInfo] = useState<any>(null);
  const [aiReviewRetrievalMetadata, setAiReviewRetrievalMetadata] = useState<any>(null);
  const [isAiReviewLoading, setIsAiReviewLoading] = useState(false);
  const [aiReviewError, setAiReviewError] = useState<string | null>(null);

  const handleOpenAiReview = async (rec: PpcRecommendation) => {
    setAiReviewModalRec(rec);
    setAiReviewResult(null);
    setAiReviewScenarioInfo(null);
    setAiReviewRetrievalMetadata(null);
    setAiReviewError(null);
    setIsAiReviewLoading(true);

    try {
      const res = await fetch("/api/ppc/ai-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation: rec }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Không thể gọi AI Reviewer");
      }
      setAiReviewResult(data.result);
      setAiReviewScenarioInfo(data.scenario_info);
      setAiReviewRetrievalMetadata(data.retrieval_metadata);
    } catch (err: unknown) {
      setAiReviewError(err instanceof Error ? err.message : "Lỗi kết nối AI Reviewer");
    } finally {
      setIsAiReviewLoading(false);
    }
  };

  const handleOpenActionQueueModal = () => {
    setSelectedSkuGroup(null);
    onOpenActionQueue();
  };

  // value = null → bỏ số nhập tay, quay về Max Bid tự tính
  const handleSaveMaxBid = async (value: number | null) => {
    if (!selectedSkuGroup || isSavingMaxBid) return;
    if (value !== null && !(value > 0 && value <= 100)) {
      alert("Max Bid phải lớn hơn 0 và không quá $100.");
      return;
    }
    const { sku, economics } = selectedSkuGroup;
    try {
      setIsSavingMaxBid(true);
      const res = await fetch("/api/ppc/sku-economics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: economics.storeId, sku, maxBidOverride: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || "Không lưu được Max Bid");
      const override: number | null = data.data.maxBidOverride;
      const calculated = economics.calculatedMaxBid ?? economics.maxBid;
      setSelectedSkuGroup((current) =>
        current && current.sku === sku
          ? { ...current, economics: { ...current.economics, maxBidOverride: override, maxBid: override ?? calculated } }
          : current,
      );
      setMaxBidDraft(null);
      // Trần bid đổi → tính lại đề xuất của SKU
      await onLoadSkuRecommendations(sku, true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Không lưu được Max Bid");
    } finally {
      setIsSavingMaxBid(false);
    }
  };

  const handleOpenSkuGroup = async (
    group: SkuRecommendationGroup,
    overrideAction?: "ALL" | "BID_INCREASE" | "BID_DECREASE" | "PAUSE_TARGET",
    overrideCampType?: "ALL" | "SP03" | "SB05" | "SB01",
  ) => {
    setSelectedSkuGroup(group);
    setMaxBidDraft(null);

    // Mặc định lọc action theo quickFilter hiện tại (nếu đang bấm Tăng Bid, Giảm Bid, Pause)
    let initialAction: "ALL" | "BID_INCREASE" | "BID_DECREASE" | "PAUSE_TARGET" = "ALL";
    if (overrideAction) {
      initialAction = overrideAction;
    } else if (quickFilter === "INCREASE") {
      initialAction = "BID_INCREASE";
    } else if (quickFilter === "DECREASE") {
      initialAction = "BID_DECREASE";
    } else if (quickFilter === "PAUSE") {
      initialAction = "PAUSE_TARGET";
    }
    setModalActionFilter(initialAction);

    // Mặc định lọc dạng chạy theo selectedCampType hiện tại
    const initialCampType = overrideCampType || (selectedCampType !== "ALL" ? selectedCampType : "ALL");
    setModalCampTypeFilter(initialCampType);
    setModalCampaignFilter("ALL");
    setModalSearch("");
    setFocusedRecId(null);

    setRecentlyApprovedIds(new Set());
    setSelectedRecIds(new Set());
    setExpandedCampaigns(new Set());
    setLoadingSkuDetails(true);
    try {
      await onLoadSkuRecommendations(group.sku);
    } catch (error) {
      console.error(error);
      setSelectedSkuGroup(null);
    } finally {
      setLoadingSkuDetails(false);
    }
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

  // Dynamic available Niche list with counts
  const nicheOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      const n = (g.niche || "").trim();
      if (n) {
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [groups]);

  const picOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      const pic = (g.picMkt || "").trim();
      if (pic) counts.set(pic, (counts.get(pic) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
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
    let prefixError = 0;

    for (const g of groups) {
      if (g.increaseCount > 0) increase++;
      if (g.decreaseCount > 0) decrease++;
      if (g.pauseCount > 0) pause++;
      if (g.spend > 0 && g.acos > g.breakEvenAcos) bleeding++;
      if (g.sales > 0 && g.acos <= g.breakEvenAcos) profitable++;
      if (g.spend === 0) zeroSpend++;
      if (g.spend > 0 && g.sales === 0) zeroSales++;
      if (
        g.productType === SKU_PREFIX_ERROR_PRODUCT_TYPE ||
        g.productType === "Lỗi Prefix" ||
        !g.productType ||
        g.productType === "Chưa xác định"
      ) {
        prefixError++;
      }
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
      prefixError,
    };
  }, [groups]);

  // Campaign Type Counts for badges
  const campTypeCounts = useMemo(() => {
    let sp03 = 0;
    let sb05 = 0;
    let sb01 = 0;
    for (const g of groups) {
      const types = g.campaignTypes || [];
      if (types.includes("SP03")) sp03++;
      if (types.includes("SB05")) sb05++;
      if (types.includes("SB01")) sb01++;
    }
    return { sp03, sb05, sb01 };
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
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const filteredGroups = useMemo(() => {
    const result = groups.filter((g) => {
      // 1. Search term
      if (searchTerm) {
        const q = searchTerm.toLowerCase().trim();
        const matchSku = g.sku.toLowerCase().includes(q);
        const matchAsin = g.asin.toLowerCase().includes(q);
        const matchNiche = (g.niche || "").toLowerCase().includes(q);
        const matchPhôi = (g.productType || "").toLowerCase().includes(q);
        const matchPic = (g.picMkt || "").toLowerCase().includes(q);
        if (!matchSku && !matchAsin && !matchNiche && !matchPhôi && !matchPic) return false;
      }

      // 2. Phôi filter
      if (selectedPhôi !== "ALL" && g.productType !== selectedPhôi) {
        return false;
      }

      // 3. Niche filter
      if (selectedNiche !== "ALL" && (g.niche || "").trim() !== selectedNiche) {
        return false;
      }

      // PIC MKT filter
      if (selectedPic !== "ALL" && (g.picMkt || "").trim() !== selectedPic) {
        return false;
      }

      // 4. Quick Filter
      switch (quickFilter) {
        case "INCREASE":
          if (g.increaseCount <= 0) return false;
          break;
        case "DECREASE":
          if (g.decreaseCount <= 0) return false;
          break;
        case "PAUSE":
          if (g.pauseCount <= 0) return false;
          break;
        case "BLEEDING":
          if (!(g.spend > 0 && g.acos > g.breakEvenAcos)) return false;
          break;
        case "PROFITABLE":
          if (!(g.sales > 0 && g.acos <= g.breakEvenAcos)) return false;
          break;
        case "ZERO_SPEND":
          if (g.spend !== 0) return false;
          break;
        case "ZERO_SALES":
          if (!(g.spend > 0 && g.sales === 0)) return false;
          break;
        case "PREFIX_ERROR":
          if (!(
            g.productType === SKU_PREFIX_ERROR_PRODUCT_TYPE ||
            g.productType === "Lỗi Prefix" ||
            !g.productType ||
            g.productType === "Chưa xác định"
          )) return false;
          break;
        case "ALL":
        default:
          break;
      }

      // 5. Dạng chạy filter
      if (selectedCampType !== "ALL") {
        const types = g.campaignTypes;
        if (!types || !types.includes(selectedCampType)) {
          return false;
        }
      }

      return true;
    });

    // 6. Sort
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
  }, [groups, searchTerm, selectedPhôi, selectedNiche, selectedPic, quickFilter, selectedCampType, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedGroups = filteredGroups.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    // Filters and sorting describe a new result set; show it from the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [searchTerm, selectedPhôi, selectedNiche, selectedPic, quickFilter, selectedCampType, sortField, sortOrder]);

  const selectedVisibleSkuCount = filteredGroups.reduce(
    (count, group) => count + (selectedSkus.has(group.sku) ? 1 : 0),
    0,
  );
  const areAllVisibleSkusSelected = filteredGroups.length > 0
    && selectedVisibleSkuCount === filteredGroups.length;

  useEffect(() => {
    if (selectAllSkusRef.current) {
      selectAllSkusRef.current.indeterminate = selectedVisibleSkuCount > 0 && !areAllVisibleSkusSelected;
    }
  }, [selectedVisibleSkuCount, areAllVisibleSkusSelected]);

  // Recommendations for the currently selected SKU (Modal)
  const skuAllRecs = useMemo(() => {
    if (!selectedSkuGroup) return [];
    const sku = selectedSkuGroup.sku.toUpperCase();
    return allRecommendations.filter((r) => (r.sku || "").toUpperCase() === sku);
  }, [allRecommendations, selectedSkuGroup]);

  const modalCampaignOptions = useMemo(
    () => Array.from(new Set(skuAllRecs.map((r) => r.campaignName || "Chưa xác định Campaign"))).sort(),
    [skuAllRecs],
  );

  // Mọi bộ lọc trừ Tăng/Giảm/Pause — để đếm số trên các nút lọc hành động
  const skuRecsBeforeActionFilter = useMemo(() => {
    const q = modalSearch.toLowerCase().trim();
    return skuAllRecs.filter((r) => {
      if (modalCampTypeFilter !== "ALL" && getRecCampaignType(r) !== modalCampTypeFilter) return false;
      if (modalCampaignFilter !== "ALL" && (r.campaignName || "Chưa xác định Campaign") !== modalCampaignFilter) return false;
      if (q) {
        const matchKw = (r.keyword || "").toLowerCase().includes(q);
        const matchCamp = (r.campaignName || "").toLowerCase().includes(q);
        if (!matchKw && !matchCamp) return false;
      }
      return true;
    });
  }, [skuAllRecs, modalCampTypeFilter, modalCampaignFilter, modalSearch]);

  const modalActionCounts = useMemo(() => {
    const counts = { ALL: skuRecsBeforeActionFilter.length, BID_INCREASE: 0, BID_DECREASE: 0, PAUSE_TARGET: 0 };
    for (const r of skuRecsBeforeActionFilter) {
      if (r.recType === "BID_INCREASE" || r.recType === "BID_DECREASE" || r.recType === "PAUSE_TARGET") {
        counts[r.recType]++;
      }
    }
    return counts;
  }, [skuRecsBeforeActionFilter]);

  const currentSkuRecs = useMemo(
    () => modalActionFilter === "ALL"
      ? skuRecsBeforeActionFilter
      : skuRecsBeforeActionFilter.filter((r) => r.recType === modalActionFilter),
    [skuRecsBeforeActionFilter, modalActionFilter],
  );

  const focusedRec = currentSkuRecs.find((r) => r.id === focusedRecId) ?? currentSkuRecs[0] ?? null;

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
      let spend = 0;
      let sales = 0;
      let orders = 0;
      for (const r of recs) {
        if (r.recType === "BID_INCREASE") totalIncrease++;
        else if (r.recType === "BID_DECREASE") totalDecrease++;
        else if (r.recType === "PAUSE_TARGET") totalPause++;
        spend += r.spend || 0;
        sales += r.sales || 0;
        orders += r.orders || 0;
      }
      const firstRec = recs[0];
      const campState = (firstRec?.campaignState || "enabled").toLowerCase();
      let campType = "SP03";
      if (firstRec?.ruleProfile) {
        const parts = firstRec.ruleProfile.split(" ");
        campType = parts[0] || "SP03";
      } else if (/SB05|\bVIDEO\b/i.test(campaignName)) {
        campType = "SB05";
      } else if (campaignName.includes("SB01")) {
        campType = "SB01";
      } else if (campaignName.includes("SP03")) {
        campType = "SP03";
      } else if (firstRec?.adType === "SB") {
        campType = "SB";
      }

      return {
        campaignName,
        campaignType: campType,
        campaignState: campState,
        adType: firstRec?.adType,
        recs,
        totalIncrease,
        totalDecrease,
        totalPause,
        spend,
        sales,
        orders,
      };
    });
  }, [currentSkuRecs]);

  // Đóng tất cả các thẻ campaign khi đổi SKU / đóng modal; sau khi tải xong sẽ mở sẵn campaign đầu tiên
  useEffect(() => {
    setExpandedCampaigns(new Set());
    autoExpandedSkuRef.current = null;
  }, [selectedSkuGroup?.sku]);

  useEffect(() => {
    if (!selectedSkuGroup || loadingSkuDetails || groupedByCampaign.length === 0) return;
    if (autoExpandedSkuRef.current === selectedSkuGroup.sku) return;
    autoExpandedSkuRef.current = selectedSkuGroup.sku;
    setExpandedCampaigns(new Set([groupedByCampaign[0].campaignName]));
  }, [selectedSkuGroup, loadingSkuDetails, groupedByCampaign]);

  const closeSkuModal = () => {
    setSelectedSkuGroup(null);
    setModalSearch("");
    setModalActionFilter("ALL");
    setModalCampaignFilter("ALL");
    setFocusedRecId(null);
    setRecentlyApprovedIds(new Set());
    setSelectedRecIds(new Set());
    setExpandedCampaigns(new Set());
  };

  const handleCommitFinalBid = (id: string, value: number) => {
    setUserFinalBids((prev) => ({ ...prev, [id]: value }));
    setAiReviewApplications((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

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
    setAiReviewApplications((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleBatchEditRecBids = () => {
    if (selectedRecIds.size === 0) return;
    const raw = window.prompt(`Nhập mức Final Bid ($) mới áp dụng cho ${selectedRecIds.size} mục đã chọn:`, "0.55");
    if (!raw) return;
    const cleaned = raw.replace(",", ".");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num <= 0) {
      alert("Vui lòng nhập số tiền hợp lệ (> 0).");
      return;
    }
    const rounded = Math.round(num * 100) / 100;
    setUserFinalBids((prev) => {
      const next = { ...prev };
      selectedRecIds.forEach((id) => {
        next[id] = rounded;
      });
      return next;
    });
    setAiReviewApplications((prev) => {
      const next = { ...prev };
      selectedRecIds.forEach((id) => delete next[id]);
      return next;
    });
  };

  const handleBatchEditCampaignRecBids = (recs: PpcRecommendation[], campaignName: string) => {
    const activeRecs = recs.filter((r) => r.recType !== "PAUSE_TARGET");
    if (activeRecs.length === 0) return;
    const raw = window.prompt(`Nhập mức Final Bid ($) mới cho toàn bộ ${activeRecs.length} targets trong campaign "${campaignName}":`, "0.55");
    if (!raw) return;
    const cleaned = raw.replace(",", ".");
    const num = parseFloat(cleaned);
    if (isNaN(num) || num <= 0) {
      alert("Vui lòng nhập số tiền hợp lệ (> 0).");
      return;
    }
    const rounded = Math.round(num * 100) / 100;
    setUserFinalBids((prev) => {
      const next = { ...prev };
      activeRecs.forEach((r) => {
        next[r.id] = rounded;
      });
      return next;
    });
    setAiReviewApplications((prev) => {
      const next = { ...prev };
      activeRecs.forEach((rec) => delete next[rec.id]);
      return next;
    });
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
    if (selectedRecIds.size === 0 || isStoreSwitching) return;
    try {
      setIsApproving(true);
      const approvedIds = Array.from(selectedRecIds);
      const itemsToApprove = currentSkuRecs
        .filter((r) => selectedRecIds.has(r.id))
        .map((r) => ({
          recommendation: r,
          userFinalBid: userFinalBids[r.id] ?? r.recommendedBid ?? r.currentBid ?? 0,
          decisionSource: aiReviewApplications[r.id]?.source === "AI_AGENT" ? "AI_AGENT" as const : undefined,
          aiReview: aiReviewApplications[r.id]?.audit,
        }));

      if (selectedStore && selectedStore !== "ALL") {
        const mismatched = itemsToApprove.find((it) => {
          const sName = it.recommendation.storeName;
          return sName && sName !== "ALL" && sName.toLowerCase() !== selectedStore.toLowerCase();
        });
        if (mismatched) {
          alert(`Đề xuất này thuộc Store "${mismatched.recommendation.storeName}", không khớp với Store "${selectedStore}" hiện tại. Đã chặn duyệt để tránh nhầm Store!`);
          return;
        }
      }

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
    if (isStoreSwitching) return;
    try {
      if (selectedStore && selectedStore !== "ALL") {
        const sName = rec.storeName;
        if (sName && sName !== "ALL" && sName.toLowerCase() !== selectedStore.toLowerCase()) {
          alert(`Đề xuất này thuộc Store "${rec.storeName}", không khớp với Store "${selectedStore}" hiện tại. Đã chặn duyệt để tránh nhầm Store!`);
          return;
        }
      }

      setIsApproving(true);
      await onApproveToQueue([
        {
          recommendation: rec,
          userFinalBid: userFinalBids[rec.id] ?? rec.recommendedBid ?? rec.currentBid ?? 0,
          decisionSource: aiReviewApplications[rec.id]?.source === "AI_AGENT" ? "AI_AGENT" as const : undefined,
          aiReview: aiReviewApplications[rec.id]?.audit,
        },
      ]);
      setRecentlyApprovedIds((prev) => new Set([...prev, rec.id]));
    } catch (err) {
      alert("Lỗi khi duyệt đề xuất: " + String(err));
    } finally {
      setIsApproving(false);
    }
  };

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
        className={`py-3 px-3 text-${align} whitespace-nowrap select-none cursor-pointer hover:bg-slate-100/80 transition group`}
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

  const isFilterActive =
    searchTerm !== "" ||
    selectedPhôi !== "ALL" ||
    selectedNiche !== "ALL" ||
    selectedPic !== "ALL" ||
    quickFilter !== "ALL" ||
    selectedCampType !== "ALL";

  const isSwitchingWindow = isLoading
    && loadedRecommendationWindowDays !== null
    && loadedRecommendationWindowDays !== recommendationWindowDays;

  return (
    <div className="relative space-y-4" aria-busy={isActive && isLoading}>
      {isSwitchingWindow && (
        <div className="absolute inset-0 z-50 flex items-start justify-center rounded-2xl bg-white/45 pt-20 backdrop-blur-[1px] cursor-wait">
          <div className="rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-xs font-black text-indigo-700 shadow-lg">
            Updating recommendations to {recommendationWindowDays}D…
          </div>
        </div>
      )}
      {/* Top Filter Area: Search, Phôi & Summary */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs space-y-2.5">
        {/* Row 1: Controls, Metrics & Auto Bid Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Left: Search, Phôi, Window Toggle */}
          <div className="contents">
            {/* Search Box */}
            <div className="relative w-full sm:w-44">
              <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm SKU, ASIN, Niche..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-7.5 pr-6 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/20 w-full shadow-2xs"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} weight="bold" />
                </button>
              )}
            </div>

            {/* Dynamic Phôi Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
              <Tag size={13} className="text-slate-400 shrink-0" />
              <select
                value={selectedPhôi}
                onChange={(e) => setSelectedPhôi(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1 max-w-[120px]"
              >
                <option value="ALL">Tất cả Phôi ({groups.length})</option>
                {phôiOptions.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Dynamic Niche Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
              <Sparkle size={13} className="text-slate-400 shrink-0" />
              <select
                value={selectedNiche}
                onChange={(e) => setSelectedNiche(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1 max-w-[120px]"
              >
                <option value="ALL">Tất cả Niche ({groups.length})</option>
                {nicheOptions.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} ({n.count})
                  </option>
                ))}
              </select>
            </div>

            {/* PIC MKT Dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-2xs">
              <UserCircle size={13} className="text-slate-400 shrink-0" />
              <select
                value={selectedPic}
                onChange={(e) => setSelectedPic(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1 max-w-[110px]"
              >
                <option value="ALL">Tất cả PIC ({groups.length})</option>
                {picOptions.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox: Bao gồm Camp Paused */}
            {onIncludePausedCampaignsChange && (
              <label
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-700 font-semibold cursor-pointer select-none transition shadow-2xs"
                title="Mặc định chỉ tải campaign enable. Tích chọn để tải thêm đề xuất cho các campaign đang paused."
              >
                <input
                  type="checkbox"
                  checked={Boolean(includePausedCampaigns)}
                  disabled={isLoading}
                  onChange={(e) => onIncludePausedCampaignsChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Camp Paused</span>
              </label>
            )}

            {/* Reset Filter Button */}
            {isFilterActive && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedPhôi("ALL");
                  setSelectedNiche("ALL");
                  setSelectedPic("ALL");
                  setQuickFilter("ALL");
                  setSelectedCampType("ALL");
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition cursor-pointer shadow-2xs"
                title="Đặt lại bộ lọc"
              >
                <X size={12} weight="bold" />
                <span>Đặt lại</span>
              </button>
            )}

            {isLoading && (
              <div className="flex items-center gap-1 text-indigo-600 text-xs font-medium animate-pulse">
                <CircleNotch size={13} className="animate-spin shrink-0" />
                <span>Đang tải...</span>
              </div>
            )}
          </div>

          {/* Right: Aggregates & Action Button */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-600 font-medium bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/90 shadow-2xs">
              <span>
                Spend: <strong className="text-slate-900 font-mono font-semibold">${filteredAggregates.spend.toFixed(0)}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Sales: <strong className="text-emerald-700 font-mono font-semibold">${filteredAggregates.sales.toFixed(0)}</strong>
              </span>
            </div>

            {recColumnPicker}

            {/* Nút Kết Quả Auto Bid */}
            <button
              type="button"
              onClick={() => setShowOutcomesModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-700 transition cursor-pointer shadow-2xs shrink-0"
              title="Theo dõi kết quả sau chỉnh bid (3D, 7D, 14D, 30D)"
            >
              <Target size={14} weight="bold" className="text-indigo-100" />
              <span>Kết quả Auto Bid</span>
            </button>
          </div>
        </div>

        {/* Row 2: Quick Filter Chips (Gọn gàng trên 1 hàng, không bị rớt dòng lẻ loi) */}
        <div className="flex items-center gap-1 pt-2 border-t border-slate-100 overflow-x-auto no-scrollbar">

          {/* Tất cả */}
          <button
            type="button"
            onClick={() => setQuickFilter("ALL")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "ALL"
                ? "bg-slate-900 text-white border-slate-900 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200/80"
            }`}
          >
            <span>Tất cả</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "ALL" ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-600"
            }`}>
              {filterCounts.all}
            </span>
          </button>

          {/* Tăng Bid */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "INCREASE" ? "ALL" : "INCREASE")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "INCREASE"
                ? "bg-emerald-700 text-white border-emerald-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-emerald-50/50 hover:text-emerald-800 border-slate-200/80"
            }`}
          >
            <ArrowUpRight size={12} weight="bold" className={quickFilter === "INCREASE" ? "text-white" : "text-emerald-600"} />
            <span>Tăng Bid</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "INCREASE" ? "bg-emerald-800 text-emerald-100" : "bg-emerald-50 text-emerald-700"
            }`}>
              {filterCounts.increase}
            </span>
          </button>

          {/* Giảm Bid */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "DECREASE" ? "ALL" : "DECREASE")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "DECREASE"
                ? "bg-rose-700 text-white border-rose-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-rose-50/50 hover:text-rose-800 border-slate-200/80"
            }`}
          >
            <ArrowDownRight size={12} weight="bold" className={quickFilter === "DECREASE" ? "text-white" : "text-rose-600"} />
            <span>Giảm Bid</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "DECREASE" ? "bg-rose-800 text-rose-100" : "bg-rose-50 text-rose-700"
            }`}>
              {filterCounts.decrease}
            </span>
          </button>

          {/* Pause */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "PAUSE" ? "ALL" : "PAUSE")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "PAUSE"
                ? "bg-amber-700 text-white border-amber-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-amber-50/50 hover:text-amber-800 border-slate-200/80"
            }`}
          >
            <Pause size={12} weight="bold" className={quickFilter === "PAUSE" ? "text-white" : "text-amber-600"} />
            <span>Pause</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "PAUSE" ? "bg-amber-800 text-amber-100" : "bg-amber-50 text-amber-700"
            }`}>
              {filterCounts.pause}
            </span>
          </button>

          {/* Lỗ ACoS */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "BLEEDING" ? "ALL" : "BLEEDING")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "BLEEDING"
                ? "bg-red-700 text-white border-red-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-red-50/50 hover:text-red-800 border-slate-200/80"
            }`}
          >
            <WarningCircle size={12} weight="bold" className={quickFilter === "BLEEDING" ? "text-white" : "text-red-600"} />
            <span>Lỗ ACoS</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "BLEEDING" ? "bg-red-800 text-red-100" : "bg-red-50 text-red-700"
            }`}>
              {filterCounts.bleeding}
            </span>
          </button>

          {/* ACoS Tốt */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "PROFITABLE" ? "ALL" : "PROFITABLE")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "PROFITABLE"
                ? "bg-teal-700 text-white border-teal-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-teal-50/50 hover:text-teal-800 border-slate-200/80"
            }`}
          >
            <CheckCircle size={12} weight="bold" className={quickFilter === "PROFITABLE" ? "text-white" : "text-teal-600"} />
            <span>ACoS Tốt</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "PROFITABLE" ? "bg-teal-800 text-teal-100" : "bg-teal-50 text-teal-700"
            }`}>
              {filterCounts.profitable}
            </span>
          </button>

          {/* Chưa cắn tiền */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "ZERO_SPEND" ? "ALL" : "ZERO_SPEND")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "ZERO_SPEND"
                ? "bg-sky-700 text-white border-sky-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-sky-50/50 hover:text-sky-800 border-slate-200/80"
            }`}
          >
            <Clock size={12} weight="bold" className={quickFilter === "ZERO_SPEND" ? "text-white" : "text-sky-600"} />
            <span>Chưa cắn tiền</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "ZERO_SPEND" ? "bg-sky-800 text-sky-100" : "bg-sky-50 text-sky-700"
            }`}>
              {filterCounts.zeroSpend}
            </span>
          </button>

          {/* Chưa ra đơn */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "ZERO_SALES" ? "ALL" : "ZERO_SALES")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "ZERO_SALES"
                ? "bg-violet-700 text-white border-violet-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-violet-50/50 hover:text-violet-800 border-slate-200/80"
            }`}
          >
            <Fire size={12} weight="bold" className={quickFilter === "ZERO_SALES" ? "text-white" : "text-violet-600"} />
            <span>Chưa ra đơn</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "ZERO_SALES" ? "bg-violet-800 text-violet-100" : "bg-violet-50 text-violet-700"
            }`}>
              {filterCounts.zeroSales}
            </span>
          </button>

          {/* Lỗi Prefix */}
          <button
            type="button"
            onClick={() => setQuickFilter(quickFilter === "PREFIX_ERROR" ? "ALL" : "PREFIX_ERROR")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              quickFilter === "PREFIX_ERROR"
                ? "bg-rose-700 text-white border-rose-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-rose-50/50 hover:text-rose-800 border-slate-200/80"
            }`}
          >
            <WarningCircle size={12} weight="bold" className={quickFilter === "PREFIX_ERROR" ? "text-white" : "text-rose-600"} />
            <span>Lỗi Prefix</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              quickFilter === "PREFIX_ERROR" ? "bg-rose-800 text-rose-100" : "bg-rose-50 text-rose-700"
            }`}>
              {filterCounts.prefixError}
            </span>
          </button>

          {/* Dạng chạy Filter Chips */}
          <div className="h-3.5 w-px bg-slate-200 mx-0.5 shrink-0" />

          {/* SP03 */}
          <button
            type="button"
            onClick={() => setSelectedCampType(selectedCampType === "SP03" ? "ALL" : "SP03")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              selectedCampType === "SP03"
                ? "bg-indigo-700 text-white border-indigo-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-800 border-slate-200/80"
            }`}
          >
            <span className="font-bold">SP03</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              selectedCampType === "SP03" ? "bg-indigo-800 text-white" : "bg-indigo-50 text-indigo-700"
            }`}>
              {campTypeCounts.sp03}
            </span>
          </button>

          {/* SB05 */}
          <button
            type="button"
            onClick={() => setSelectedCampType(selectedCampType === "SB05" ? "ALL" : "SB05")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              selectedCampType === "SB05"
                ? "bg-purple-700 text-white border-purple-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-purple-50/50 hover:text-purple-800 border-slate-200/80"
            }`}
          >
            <span className="font-bold">SB05</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              selectedCampType === "SB05" ? "bg-purple-800 text-white" : "bg-purple-50 text-purple-700"
            }`}>
              {campTypeCounts.sb05}
            </span>
          </button>

          {/* SB01 */}
          <button
            type="button"
            onClick={() => setSelectedCampType(selectedCampType === "SB01" ? "ALL" : "SB01")}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border shrink-0 ${
              selectedCampType === "SB01"
                ? "bg-blue-700 text-white border-blue-700 shadow-2xs"
                : "bg-white text-slate-700 hover:bg-blue-50/50 hover:text-blue-800 border-slate-200/80"
            }`}
          >
            <span className="font-bold">SB01</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              selectedCampType === "SB01" ? "bg-blue-800 text-white" : "bg-blue-50 text-blue-700"
            }`}>
              {campTypeCounts.sb01}
            </span>
          </button>
        </div>
      </div>

      {selectedSkus.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-900">
            <button
              type="button"
              onClick={() => setSelectedSkus(new Set())}
              disabled={isBulkApproving}
              className="flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              <CheckSquare size={17} weight="fill" className="text-indigo-600" />
              <span>Đã chọn {selectedSkus.size} SKU</span>
            </button>
            {selectedVisibleSkuCount !== selectedSkus.size && (
              <span className="font-medium text-indigo-600">
                ({selectedVisibleSkuCount} trong bộ lọc hiện tại)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedSkus(new Set())}
              disabled={isBulkApproving}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Bỏ chọn
            </button>
            <button
              type="button"
              onClick={() => void handleApproveSelectedSkus()}
              disabled={isBulkApproving || isStoreSwitching}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-black text-white shadow-2xs transition hover:bg-indigo-700 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
            >
              {isBulkApproving ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <CheckCircle size={14} weight="bold" />
              )}
              <span>{isBulkApproving ? "Đang duyệt..." : `Duyệt ${selectedSkus.size} SKU`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Level 1 Table: Grouped by SKU */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
        <table ref={setRecTable} className="w-full text-left text-xs">
          <thead className="bg-slate-50/90 text-slate-600 border-b border-slate-200 font-bold">
            <tr>
              <th className="w-10 py-3 pl-3 pr-1 text-center">
                <input
                  ref={selectAllSkusRef}
                  type="checkbox"
                  checked={areAllVisibleSkusSelected}
                  onChange={handleToggleAllVisibleSkus}
                  disabled={isLoading || filteredGroups.length === 0 || isBulkApproving}
                  aria-label="Chọn tất cả SKU trong kết quả lọc"
                  title="Chọn tất cả SKU trong kết quả lọc"
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600 disabled:cursor-not-allowed"
                />
              </th>
              <th className="w-12 py-3 px-2 text-center text-xs font-bold text-slate-500">Ảnh</th>
              {renderSortHeader("SKU", "sku", "left")}
              <th className="py-3 px-3">Phôi</th>
              {renderSortHeader("Spend", "spend", "right")}
              {renderSortHeader("Sales", "sales", "right")}
              {renderSortHeader("ACoS", "acos", "right")}
              {renderSortHeader("BE ACoS", "breakEvenAcos", "right")}
              {renderSortHeader("Đề xuất", "totalRecommendations", "center")}
              {renderSortHeader("Tăng Bid", "increaseCount", "center")}
              {renderSortHeader("Giảm Bid", "decreaseCount", "center")}
              {renderSortHeader("Pause", "pauseCount", "center")}
              <th className="py-3 px-3 text-center whitespace-nowrap">Chi tiết</th>
              <th className="py-3 px-3 text-center w-24 whitespace-nowrap">Trend (7D)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {isLoading ? (
              <tr>
                <td colSpan={14} className="py-16 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2.5">
                    <CircleNotch size={30} className="animate-spin text-indigo-600" />
                    <span className="font-bold text-sm text-slate-800">
                      Đang phân tích &amp; nạp đề xuất tối ưu cho {selectedStore === "ALL" ? "tất cả store" : selectedStore || "Store"}...
                    </span>
                    <span className="text-xs text-slate-400">
                      Đang đối chiếu dữ liệu ACoS, trần bid và SKU Architecture
                    </span>
                  </div>
                </td>
              </tr>
            ) : filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-400 font-medium">
                  Không tìm thấy SKU nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              paginatedGroups.map((group) => {
                const isBleeding = group.spend > 0 && group.acos > group.breakEvenAcos;
                const isGoodAcos = group.sales > 0 && group.acos <= group.breakEvenAcos;
                const isSkuSelected = selectedSkus.has(group.sku);

                return (
                  <tr
                    key={group.sku}
                    onClick={() => {
                      void handleOpenSkuGroup(group);
                      setRecentlyApprovedIds(new Set());
                      setSelectedRecIds(new Set());
                    }}
                    className={`transition cursor-pointer group ${isSkuSelected ? "bg-indigo-50/70 hover:bg-indigo-100/60" : "hover:bg-indigo-50/30"}`}
                  >
                    <td className="py-3 pl-3 pr-1 text-center">
                      <input
                        type="checkbox"
                        checked={isSkuSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => handleToggleSku(group.sku)}
                        disabled={isBulkApproving}
                        aria-label={`Chọn SKU ${group.sku}`}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="py-2.5 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                      {group.mockupUrl ? (
                        <div className="relative group/mockup inline-block">
                          <img
                            src={getOptimizedThumbnailUrl(group.mockupUrl, 64) || group.mockupUrl}
                            alt={group.sku}
                            className="w-9 h-9 rounded-md object-cover border border-slate-200 shadow-2xs group-hover/mockup:ring-2 group-hover/mockup:ring-indigo-500 transition cursor-pointer"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget.parentElement?.querySelector(".mockup-fallback");
                              if (fallback) (fallback as HTMLElement).style.display = "flex";
                            }}
                          />
                          <div className="mockup-fallback hidden w-9 h-9 mx-auto rounded-md bg-slate-100 items-center justify-center text-slate-300">
                            <Tag size={14} />
                          </div>
                          <div className="hidden group-hover/mockup:block absolute left-12 top-1/2 -translate-y-1/2 z-50 p-1 bg-white rounded-xl shadow-2xl border border-slate-200 pointer-events-none w-48 h-48">
                            <img
                              src={getOptimizedThumbnailUrl(group.mockupUrl, 400) || group.mockupUrl}
                              alt={group.sku}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="w-9 h-9 mx-auto rounded-md bg-slate-100 flex items-center justify-center text-slate-300">
                          <Tag size={14} />
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-900 group-hover:text-indigo-600 transition col-primary">
                      {group.sku}
                    </td>
                    <td className="py-3 px-3 text-slate-700 font-medium">
                      {group.productType || "—"}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-800 font-normal">
                      ${group.spend.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-700 font-normal">
                      ${group.sales.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-normal">
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
                    <td className="py-3 px-3 text-right text-amber-700 font-normal">
                      {group.breakEvenAcos.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-normal text-xs border border-indigo-200">
                        {group.totalRecommendations}
                      </span>
                    </td>
                    <td
                      className={`py-3 px-3 text-center text-emerald-700 font-normal transition ${
                        group.increaseCount > 0 ? "cursor-pointer hover:bg-emerald-100/60 font-semibold" : ""
                      }`}
                      title={group.increaseCount > 0 ? "Mở và chỉ xem các target Tăng Bid" : undefined}
                      onClick={(e) => {
                        if (group.increaseCount > 0) {
                          e.stopPropagation();
                          void handleOpenSkuGroup(group, "BID_INCREASE");
                        }
                      }}
                    >
                      {group.increaseCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                          <ArrowUpRight size={11} weight="bold" />
                          {group.increaseCount}
                        </span>
                      ) : "—"}
                    </td>
                    <td
                      className={`py-3 px-3 text-center text-rose-700 font-normal transition ${
                        group.decreaseCount > 0 ? "cursor-pointer hover:bg-rose-100/60 font-semibold" : ""
                      }`}
                      title={group.decreaseCount > 0 ? "Mở và chỉ xem các target Giảm Bid" : undefined}
                      onClick={(e) => {
                        if (group.decreaseCount > 0) {
                          e.stopPropagation();
                          void handleOpenSkuGroup(group, "BID_DECREASE");
                        }
                      }}
                    >
                      {group.decreaseCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-800">
                          <ArrowDownRight size={11} weight="bold" />
                          {group.decreaseCount}
                        </span>
                      ) : "—"}
                    </td>
                    <td
                      className={`py-3 px-3 text-center text-amber-800 font-normal transition ${
                        group.pauseCount > 0 ? "cursor-pointer hover:bg-amber-100/60 font-semibold" : ""
                      }`}
                      title={group.pauseCount > 0 ? "Mở và chỉ xem các target Pause" : undefined}
                      onClick={(e) => {
                        if (group.pauseCount > 0) {
                          e.stopPropagation();
                          void handleOpenSkuGroup(group, "PAUSE_TARGET");
                        }
                      }}
                    >
                      {group.pauseCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                          <Pause size={11} weight="bold" />
                          {group.pauseCount}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button className="inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100/90 border border-indigo-200/70 shadow-2xs transition cursor-pointer">
                        <span>Chi tiết</span>
                        <CaretRight size={12} weight="bold" />
                      </button>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <SkuTrendSparkline
                        dailyTrend={skuTrends?.get(group.sku)}
                        sku={group.sku}
                        storeName={selectedStore || ""}
                        mockupUrl={group.mockupUrl}
                        onOpenDetail={onOpenSkuTrend}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredGroups.length > 0 && (
        <PpcPagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredGroups.length}
          pageSizeOptions={[50, 100, 200]}
          itemName="SKU"
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {/* SKU RECOMMENDATION DETAIL MODAL */}
      {selectedSkuGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto"
          onClick={closeSkuModal}
        >
          <div className={`flex flex-col lg:flex-row gap-3 w-full items-stretch justify-center ${isAiChatOpen ? "max-w-[1720px]" : "max-w-[1280px]"}`}>
          <div
            className="w-full min-w-0 max-w-[1280px] h-[92vh] bg-white border border-slate-200 rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-4 min-w-0">
                {selectedSkuGroup.mockupUrl && (
                  <img
                    src={getOptimizedThumbnailUrl(selectedSkuGroup.mockupUrl, 128) || selectedSkuGroup.mockupUrl}
                    alt={selectedSkuGroup.sku}
                    className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setAiChatSku(isAiChatOpen ? null : selectedSkuGroup.sku)}
                      title="Chat với AI về SKU này"
                      className={`inline-flex items-center gap-1.5 text-lg font-black rounded-md px-1 -mx-1 cursor-pointer transition-colors ${
                        isAiChatOpen ? "bg-indigo-100 text-indigo-700" : "text-slate-900 hover:bg-indigo-50 hover:text-indigo-700"
                      }`}
                    >
                      {selectedSkuGroup.sku}
                      <Sparkle size={14} weight="fill" className="text-violet-500" />
                    </button>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
                      {selectedSkuGroup.productType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span>ASIN: {selectedSkuGroup.asin || "—"}</span>
                    {selectedSkuGroup.picMkt && <span>• PIC: <strong className="text-slate-700">{selectedSkuGroup.picMkt}</strong></span>}
                    {selectedSkuGroup.niche && <span>• Niche: <strong className="text-slate-700">{selectedSkuGroup.niche}</strong></span>}
                    <span>
                      • Giá ${selectedSkuGroup.economics.sellingPrice.toFixed(2)} · Lãi trước Ads ${selectedSkuGroup.economics.profitBeforeAds.toFixed(2)} · CR {(selectedSkuGroup.economics.cr * 100).toFixed(1)}% ({selectedSkuGroup.economics.crSource})
                    </span>
                  </p>
                </div>
              </div>
              <button
                onClick={closeSkuModal}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* LEFT: KPI + campaigns */}
              <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4">
                {/* KPI row */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
                  {[
                    { label: "Sales", value: `$${selectedSkuGroup.sales.toFixed(2)}`, tone: "text-slate-900" },
                    { label: "Spend", value: `$${selectedSkuGroup.spend.toFixed(2)}`, tone: "text-slate-900" },
                    { label: "Orders", value: String(selectedSkuGroup.orders), tone: "text-slate-900" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">{kpi.label}</div>
                      <div className={`text-lg font-black font-mono mt-0.5 ${kpi.tone}`}>{kpi.value}</div>
                    </div>
                  ))}
                  <div className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">ACOS</div>
                    <AcosValue
                      spend={selectedSkuGroup.spend}
                      sales={selectedSkuGroup.sales}
                      breakEvenAcos={selectedSkuGroup.breakEvenAcos}
                      className="block text-lg font-black font-mono mt-0.5"
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">BE ACOS</div>
                    <div className="text-lg font-black font-mono mt-0.5 text-slate-900">
                      {selectedSkuGroup.breakEvenAcos.toFixed(1)}%
                    </div>
                  </div>
                  {(() => {
                    const econ = selectedSkuGroup.economics;
                    const calculated = econ.calculatedMaxBid ?? econ.maxBid;
                    const isOverridden = econ.maxBidOverride != null && econ.maxBidOverride > 0 && calculated > 0;
                    // Lỗi Prefix / thiếu dữ liệu (Max Bid tự tính = 0) thì không cho đặt tay
                    const canEdit = calculated > 0 && /^[0-9a-f-]{36}$/i.test(econ.storeId);
                    return (
                      <div className={`rounded-xl border px-3.5 py-2.5 ${isOverridden ? "border-violet-300" : "border-slate-200"}`}>
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          Max Bid
                          {maxBidDraft === null && canEdit && (
                            <button
                              type="button"
                              onClick={() => setMaxBidDraft(econ.maxBid.toFixed(2))}
                              className="text-slate-400 hover:text-indigo-600"
                              title="Sửa Max Bid"
                            >
                              <PencilSimple size={11} weight="bold" />
                            </button>
                          )}
                        </div>
                        {maxBidDraft !== null ? (
                          <div className="mt-0.5 flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              autoFocus
                              value={maxBidDraft}
                              disabled={isSavingMaxBid}
                              onChange={(e) => setMaxBidDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleSaveMaxBid(Number(maxBidDraft));
                                else if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setMaxBidDraft(null);
                                }
                              }}
                              className="w-full min-w-0 rounded border border-indigo-300 px-1 py-0.5 font-mono text-xs font-bold text-slate-900 focus:border-indigo-600 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={isSavingMaxBid}
                              onClick={() => void handleSaveMaxBid(Number(maxBidDraft))}
                              className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-700 disabled:opacity-50"
                              title="Lưu"
                            >
                              {isSavingMaxBid ? <CircleNotch size={11} className="animate-spin" /> : <Check size={11} weight="bold" />}
                            </button>
                            <button
                              type="button"
                              disabled={isSavingMaxBid}
                              onClick={() => setMaxBidDraft(null)}
                              className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50"
                              title="Hủy"
                            >
                              <X size={11} weight="bold" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className={`text-lg font-black font-mono mt-0.5 ${isOverridden ? "text-violet-700" : "text-indigo-600"}`}>
                              ${econ.maxBid.toFixed(2)}
                            </div>
                            {isOverridden && (
                              <div className="text-[10px] text-slate-500">
                                Sửa tay · tự tính ${calculated.toFixed(2)}{" "}
                                <button
                                  type="button"
                                  disabled={isSavingMaxBid}
                                  onClick={() => void handleSaveMaxBid(null)}
                                  className="font-bold text-indigo-600 hover:underline disabled:opacity-50"
                                  title="Bỏ số nhập tay, dùng Max Bid tự tính"
                                >
                                  Bỏ
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 p-2.5">
                  <select
                    value={
                      modalCampaignFilter !== "ALL"
                        ? `camp:${modalCampaignFilter}`
                        : modalCampTypeFilter !== "ALL"
                          ? `type:${modalCampTypeFilter}`
                          : "ALL"
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("camp:")) {
                        const name = v.slice(5);
                        setModalCampaignFilter(name);
                        setModalCampTypeFilter("ALL");
                        setExpandedCampaigns(new Set([name]));
                      } else {
                        setModalCampaignFilter("ALL");
                        setModalCampTypeFilter(v.startsWith("type:") ? (v.slice(5) as "SP03" | "SB05" | "SB01") : "ALL");
                      }
                    }}
                    className="h-9 w-56 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 focus:outline-none focus:border-indigo-600 cursor-pointer"
                  >
                    <option value="ALL">Tất cả campaign</option>
                    <optgroup label="Dạng chạy">
                      <option value="type:SP03">SP03</option>
                      <option value="type:SB05">SB05</option>
                      <option value="type:SB01">SB01</option>
                    </optgroup>
                    <optgroup label="Campaign">
                      {modalCampaignOptions.map((name) => (
                        <option key={name} value={`camp:${name}`}>{name}</option>
                      ))}
                    </optgroup>
                  </select>

                  <div className="relative flex-1 min-w-[180px]">
                    <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Lọc từ khóa / target..."
                      value={modalSearch}
                      onChange={(e) => setModalSearch(e.target.value)}
                      className="h-9 w-full pl-8 pr-3 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-600"
                    />
                  </div>

                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    {([
                      { key: "ALL", label: "Tất cả", active: "bg-white text-indigo-700 shadow-2xs" },
                      { key: "BID_INCREASE", label: "Tăng", active: "bg-white text-emerald-700 shadow-2xs" },
                      { key: "BID_DECREASE", label: "Giảm", active: "bg-white text-rose-700 shadow-2xs" },
                      { key: "PAUSE_TARGET", label: "Pause", active: "bg-white text-amber-700 shadow-2xs" },
                    ] as const).map((pill) => (
                      <button
                        key={pill.key}
                        type="button"
                        onClick={() => setModalActionFilter(pill.key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer transition ${
                          modalActionFilter === pill.key ? pill.active : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {pill.label}
                        <span className="rounded bg-slate-200/70 px-1.5 text-[10px] font-bold text-slate-600">
                          {modalActionCounts[pill.key]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Selection / bulk actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-3 text-slate-500">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      disabled={loadingSkuDetails || currentSkuRecs.length === 0}
                      className="inline-flex items-center gap-1.5 font-semibold hover:text-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {selectedRecIds.size === currentSkuRecs.length && currentSkuRecs.length > 0 ? (
                        <CheckSquare size={15} className="text-indigo-600" weight="fill" />
                      ) : (
                        <Square size={15} />
                      )}
                      Chọn tất cả ({currentSkuRecs.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleExpandAllCampaigns}
                      disabled={loadingSkuDetails || groupedByCampaign.length === 0}
                      className="inline-flex items-center gap-1 font-semibold hover:text-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {expandedCampaigns.size === groupedByCampaign.length && groupedByCampaign.length > 0 ? (
                        <><CaretUp size={13} weight="bold" /> Thu gọn tất cả</>
                      ) : (
                        <><CaretDown size={13} weight="bold" /> Mở tất cả ({groupedByCampaign.length})</>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedRecIds.size > 0 && (
                      <button
                        type="button"
                        onClick={handleBatchEditRecBids}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-bold cursor-pointer"
                        title="Chỉnh sửa Final Bid hàng loạt cho các mục đang chọn"
                      >
                        <PencilSimple size={13} weight="bold" />
                        Sửa Bid ({selectedRecIds.size})
                      </button>
                    )}
                    {recentlyApprovedIds.size > 0 && selectedRecIds.size === 0 ? (
                      <button
                        onClick={handleOpenActionQueueModal}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                        title="Đã duyệt vào Action Queue. Bấm để mở Action Queue"
                      >
                        <Lightning size={14} weight="fill" className="text-amber-300" />
                        Action ({recentlyApprovedIds.size})
                      </button>
                    ) : (
                      <button
                        onClick={handleApproveSelected}
                        disabled={selectedRecIds.size === 0 || isApproving || isStoreSwitching}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-40 cursor-pointer"
                      >
                        <CheckCircle size={14} weight="bold" />
                        {isApproving ? "Đang xử lý..." : isStoreSwitching ? "Đang đổi Store..." : `Duyệt ${selectedRecIds.size} mục đã chọn`}
                      </button>
                    )}
                  </div>
                </div>

                {/* Campaign cards */}
                {loadingSkuDetails ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-center rounded-xl border border-dashed border-slate-200">
                    <CircleNotch size={26} weight="bold" className="animate-spin text-indigo-600" />
                    <p className="text-sm font-semibold text-slate-600">
                      Đang tải và tính toán đề xuất cho SKU {selectedSkuGroup.sku}...
                    </p>
                  </div>
                ) : groupedByCampaign.length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-400 rounded-xl border border-slate-200">
                    {modalSearch || modalActionFilter !== "ALL" || modalCampTypeFilter !== "ALL" || modalCampaignFilter !== "ALL"
                      ? "Không tìm thấy đề xuất nào phù hợp với bộ lọc hiện tại."
                      : "Không có đề xuất nào cho SKU này trong kỳ dữ liệu đã chọn."}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedByCampaign.map((cg) => {
                      const isCampaignAllSelected = cg.recs.length > 0 && cg.recs.every((r) => selectedRecIds.has(r.id));
                      const isCampaignSomeSelected = !isCampaignAllSelected && cg.recs.some((r) => selectedRecIds.has(r.id));
                      const isExpanded = expandedCampaigns.has(cg.campaignName);
                      const campaignCheckbox = (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectCampaign(cg.recs);
                          }}
                          className="text-slate-400 hover:text-slate-700 cursor-pointer"
                          title={isCampaignAllSelected ? "Bỏ chọn campaign này" : "Chọn tất cả trong campaign này"}
                        >
                          {isCampaignAllSelected ? (
                            <CheckSquare size={17} className="text-indigo-600" weight="fill" />
                          ) : isCampaignSomeSelected ? (
                            <div className="w-[15px] h-[15px] m-px rounded-[3px] border-2 border-indigo-600 flex items-center justify-center bg-indigo-50">
                              <div className="w-2 h-0.5 bg-indigo-600 rounded" />
                            </div>
                          ) : (
                            <Square size={17} />
                          )}
                        </button>
                      );

                      return (
                        <div
                          key={cg.campaignName}
                          className={`rounded-xl border overflow-hidden transition ${isExpanded ? "border-indigo-200" : "border-slate-200 hover:border-indigo-200"}`}
                        >
                          {/* Campaign header — click để mở / thu gọn */}
                          <div
                            onClick={() => toggleCampaignExpanded(cg.campaignName)}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 cursor-pointer select-none hover:bg-slate-50/70"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-[260px]">
                              {campaignCheckbox}
                              <CaretRight
                                size={14}
                                weight="bold"
                                className={`shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90 text-indigo-600" : "text-slate-400"}`}
                              />
                              <span className="shrink-0 px-2 py-1 rounded-md text-[11px] font-black bg-indigo-50 text-indigo-700">
                                {cg.campaignType}
                              </span>
                              <div className="min-w-0">
                                <h4 className="font-bold text-slate-900 text-[13px] break-all" title={cg.campaignName}>
                                  {cg.campaignName}
                                </h4>
                                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                  <span>{cg.recs.length} target{cg.recs.length > 1 ? "s" : ""}</span>
                                  <span>•</span>
                                  <span className={cg.campaignState === "paused" ? "font-semibold text-amber-700" : ""}>
                                    {cg.campaignState === "paused" ? "Paused" : "Active"}
                                  </span>
                                  {cg.totalIncrease > 0 && <span className="font-semibold text-emerald-600">↑{cg.totalIncrease}</span>}
                                  {cg.totalDecrease > 0 && <span className="font-semibold text-rose-600">↓{cg.totalDecrease}</span>}
                                  {cg.totalPause > 0 && <span className="font-semibold text-amber-700">⏸{cg.totalPause}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-5 text-xs">
                              {[
                                { label: "Spend", value: `$${cg.spend.toFixed(2)}` },
                                { label: "Sales", value: `$${cg.sales.toFixed(2)}` },
                                { label: "Orders", value: String(cg.orders) },
                              ].map((m) => (
                                <div key={m.label} className="w-16">
                                  <div className="text-[11px] text-slate-500">{m.label}</div>
                                  <div className="font-bold font-mono text-slate-900">{m.value}</div>
                                </div>
                              ))}
                              <div className="w-16">
                                <div className="text-[11px] text-slate-500">ACOS</div>
                                <AcosValue
                                  spend={cg.spend}
                                  sales={cg.sales}
                                  breakEvenAcos={selectedSkuGroup.breakEvenAcos}
                                  className="font-bold font-mono"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBatchEditCampaignRecBids(cg.recs, cg.campaignName);
                                }}
                                className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                                title="Đặt nhanh Final Bid cho toàn bộ targets trong campaign này"
                              >
                                <PencilSimple size={14} weight="bold" />
                              </button>
                            </div>
                          </div>

                          {/* Target table */}
                          {isExpanded && (
                            <div className="overflow-x-auto border-t border-slate-100">
                              <table className="w-full text-left text-xs">
                                <thead className="text-slate-500 text-[11px] font-semibold border-b border-slate-100">
                                  <tr>
                                    <th className="py-2.5 pl-4 pr-2 w-8">{campaignCheckbox}</th>
                                    <th className="py-2.5 px-3">Target / Keyword</th>
                                    <th className="py-2.5 px-3 text-right whitespace-nowrap" title="Orders · ACOS trong kỳ dữ liệu">
                                      {recommendationWindowDays}D
                                    </th>
                                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Current Bid</th>
                                    <th className="py-2.5 px-3 text-right">Suggested</th>
                                    <th className="py-2.5 px-3 text-right whitespace-nowrap">Final Bid</th>
                                    <th className="py-2.5 pl-2 pr-4 w-20"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                  {cg.recs.map((rec) => {
                                    const isSelected = selectedRecIds.has(rec.id);
                                    const isFocused = focusedRec?.id === rec.id;
                                    const finalBid = userFinalBids[rec.id] ?? rec.recommendedBid ?? rec.currentBid ?? 0;
                                    const isApproved = recentlyApprovedIds.has(rec.id);
                                    const suggestedTone = rec.recType === "BID_INCREASE"
                                      ? "text-emerald-600"
                                      : rec.recType === "BID_DECREASE"
                                        ? "text-rose-600"
                                        : "text-slate-700";

                                    return (
                                      <tr
                                        key={rec.id}
                                        onClick={() => setFocusedRecId(rec.id)}
                                        className={`cursor-pointer transition ${isFocused ? "bg-indigo-50/70" : isSelected ? "bg-indigo-50/30" : "hover:bg-slate-50"}`}
                                      >
                                        <td className="py-2.5 pl-4 pr-2">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleToggleSelectOne(rec.id);
                                            }}
                                            className="text-slate-400 hover:text-slate-700 cursor-pointer"
                                          >
                                            {isSelected ? (
                                              <CheckSquare size={17} className="text-indigo-600" weight="fill" />
                                            ) : (
                                              <Square size={17} />
                                            )}
                                          </button>
                                        </td>
                                        <td className="py-2.5 px-3 col-primary">
                                          <div className="font-semibold text-[13px] text-slate-900 break-words">{rec.keyword}</div>
                                          {rec.matchType && (
                                            <div className="text-[11px] text-slate-400 capitalize">{rec.matchType.toLowerCase()}</div>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                                          <span className="text-slate-700 mr-2">{rec.orders || 0}</span>
                                          <AcosValue
                                            spend={rec.spend || 0}
                                            sales={rec.sales || 0}
                                            breakEvenAcos={selectedSkuGroup.breakEvenAcos}
                                            className="inline-block w-12"
                                          />
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                                          ${(rec.currentBid || 0).toFixed(2)}
                                        </td>
                                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                                          {rec.recType === "PAUSE_TARGET" ? (
                                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px]">Pause</span>
                                          ) : (
                                            <span className={suggestedTone}>${(rec.recommendedBid || 0).toFixed(2)}</span>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right">
                                          {rec.recType === "PAUSE_TARGET" ? (
                                            <span className="text-slate-400 font-mono">—</span>
                                          ) : (
                                            <RecFinalBidInput
                                              initialValue={finalBid}
                                              disabled={isApproving || isStoreSwitching}
                                              onCommit={(newVal) => handleCommitFinalBid(rec.id, newVal)}
                                            />
                                          )}
                                        </td>
                                        <td className="py-2.5 pl-2 pr-4 text-right">
                                          {isApproved ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenActionQueueModal();
                                              }}
                                              className="whitespace-nowrap inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                                              title="Đã duyệt vào hàng đợi. Bấm để mở Action Queue"
                                            >
                                              <Lightning size={12} weight="fill" className="text-amber-300" />
                                              Action
                                            </button>
                                          ) : (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void handleApproveSingle(rec);
                                              }}
                                              disabled={isApproving || isStoreSwitching}
                                              className={`whitespace-nowrap px-3.5 py-1.5 rounded-lg font-bold text-[11px] transition cursor-pointer disabled:opacity-40 ${
                                                isFocused
                                                  ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                                                  : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700"
                                              }`}
                                            >
                                              {isStoreSwitching ? "Chờ..." : "Duyệt"}
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

                <p className="text-[11px] text-slate-400">
                  Duyệt sẽ đẩy đề xuất vào <strong className="text-slate-500">Action Queue</strong> để kiểm tra trùng lặp trước khi xuất Amazon Bulk File.
                </p>
              </div>

              {/* RIGHT: target detail */}
              <aside className="lg:w-[300px] shrink-0 overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-100 bg-slate-50/50 p-4">
                {loadingSkuDetails ? null : !focusedRec ? (
                  <div className="h-full flex items-center justify-center text-center text-xs text-slate-400">
                    Chọn một target để xem chi tiết
                  </div>
                ) : (() => {
                  const rec = focusedRec;
                  const clicks = rec.clicks || 0;
                  const orders = rec.orders || 0;
                  const spend = rec.spend || 0;
                  const sales = rec.sales || 0;
                  const currentBid = rec.currentBid || 0;
                  const suggestedBid = rec.recommendedBid || 0;
                  const isPause = rec.recType === "PAUSE_TARGET";
                  const changePct = currentBid > 0 && !isPause ? ((suggestedBid - currentBid) / currentBid) * 100 : null;
                  const finalBid = userFinalBids[rec.id] ?? rec.recommendedBid ?? rec.currentBid ?? 0;
                  const isApproved = recentlyApprovedIds.has(rec.id);
                  const cpc = rec.cpc ?? (clicks > 0 ? spend / clicks : 0);
                  const isPaused = (rec.campaignState || "").toLowerCase() === "paused";

                  return (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900 break-words leading-snug">{rec.keyword}</h3>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                          {rec.matchType && <span className="capitalize">{rec.matchType.toLowerCase()}</span>}
                          {rec.matchType && <span>•</span>}
                          <span>{getRecCampaignType(rec)}</span>
                          <span>•</span>
                          <span className={isPaused ? "font-semibold text-amber-700" : ""}>{isPaused ? "Paused" : "Active"}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={rec.campaignName}>{rec.campaignName}</div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{recommendationWindowDays} ngày</div>
                        <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                          {[
                            { label: "Clicks", value: String(clicks) },
                            { label: "Orders", value: String(orders) },
                            { label: "Spend", value: `$${spend.toFixed(2)}` },
                            { label: "Sales", value: `$${sales.toFixed(2)}` },
                            { label: "CPC", value: clicks > 0 || rec.cpc ? `$${cpc.toFixed(2)}` : "—" },
                          ].map((m) => (
                            <div key={m.label} className="min-w-0">
                              <div className="text-[10px] text-slate-500">{m.label}</div>
                              <div className="text-xs font-bold font-mono text-slate-900">{m.value}</div>
                            </div>
                          ))}
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-500">ACOS</div>
                            <AcosValue
                              spend={spend}
                              sales={sales}
                              breakEvenAcos={selectedSkuGroup.breakEvenAcos}
                              className="block text-xs font-bold font-mono"
                            />
                          </div>
                          {[
                            { label: "CVR", value: clicks > 0 ? `${((orders / clicks) * 100).toFixed(1)}%` : "—" },
                            { label: "ROAS", value: spend > 0 ? (sales / spend).toFixed(2) : "—" },
                            { label: "BE ACOS", value: `${selectedSkuGroup.breakEvenAcos.toFixed(1)}%` },
                          ].map((m) => (
                            <div key={m.label} className="min-w-0">
                              <div className="text-[10px] text-slate-500">{m.label}</div>
                              <div className="text-xs font-bold font-mono text-slate-700">{m.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-baseline gap-1.5 font-mono">
                            <span className="text-sm font-bold text-slate-500">${currentBid.toFixed(2)}</span>
                            <ArrowRight size={12} className="text-slate-400 self-center" />
                            {isPause ? (
                              <span className="text-base font-black font-sans text-amber-700">Pause</span>
                            ) : (
                              <span className={`text-base font-black ${rec.recType === "BID_DECREASE" ? "text-rose-600" : "text-emerald-600"}`}>
                                ${suggestedBid.toFixed(2)}
                              </span>
                            )}
                          </div>
                          {changePct !== null && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${changePct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                              {changePct >= 0 ? "↑" : "↓"} {Math.abs(changePct).toFixed(0)}%
                            </span>
                          )}
                        </div>

                        {isApproved ? (
                          <button
                            onClick={handleOpenActionQueueModal}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                          >
                            <Lightning size={13} weight="fill" className="text-amber-300" />
                            Đã duyệt · Mở Action Queue
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            {!isPause && (
                              <div className="flex-1 min-w-0" title="Bid cuối cùng">
                                <RecFinalBidInput
                                  large
                                  initialValue={finalBid}
                                  disabled={isApproving || isStoreSwitching}
                                  onCommit={(newVal) => handleCommitFinalBid(rec.id, newVal)}
                                />
                              </div>
                            )}
                            <button
                              onClick={() => void handleApproveSingle(rec)}
                              disabled={isApproving || isStoreSwitching}
                              className={`${isPause ? "w-full" : "shrink-0"} px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40`}
                            >
                              {isStoreSwitching ? "Đang đổi Store..." : isPause ? "Duyệt tạm dừng" : "Duyệt"}
                            </button>
                          </div>
                        )}
                      </div>

                      {rec.reason && (
                        <div className="text-[11px] leading-relaxed">
                          <span className="font-semibold text-slate-500">Lý do: </span>
                          <span className="text-slate-700">{rec.reason}</span>
                          {rec.ruleProfile && <span className="text-slate-400"> · {rec.ruleProfile}</span>}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleExplainRule(rec)}
                          className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          title="Xem điều kiện rule và phép tính tạo ra mức bid này"
                        >
                          <Info size={12} weight="bold" />
                          Giải thích
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAiReview(rec)}
                          className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-purple-200 bg-white text-[11px] font-semibold text-purple-700 hover:bg-purple-50 cursor-pointer"
                          title="AI phản biện đề xuất này"
                        >
                          <Sparkle size={12} weight="fill" />
                          AI phản biện
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </aside>
            </div>
          </div>
          {isAiChatOpen && (
            <PpcSkuAiChatPanel
              storeId={selectedSkuGroup.economics.storeId}
              sku={selectedSkuGroup.sku}
              onClose={() => setAiChatSku(null)}
            />
          )}
          </div>
        </div>
      )}

      {/* Deterministic rule explanation modal */}
      {ruleExplanationModal && (() => {
        const rec = ruleExplanationModal;
        const breakEven = selectedSkuGroup?.economics?.breakEvenAcos;
        const maxBidCap = selectedSkuGroup?.economics?.maxBid;
        const info = getRuleExplanation(rec, breakEven, maxBidCap);
        const actualAcosStr = rec.sales && rec.sales > 0 && rec.spend ? `${((rec.spend / rec.sales) * 100).toFixed(1)}%` : "Chưa có";
        const isIncrease = rec.recType === "BID_INCREASE";
        const isPause = rec.recType === "PAUSE_TARGET";

        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 max-w-4xl w-full max-h-[92dvh] overflow-y-auto p-5 sm:p-7 space-y-5 flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                    <Info size={24} weight="fill" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-lg sm:text-xl flex items-center gap-2 flex-wrap">
                      <span>Giải thích Đề xuất Bid</span>
                      <span className="text-xs sm:text-sm font-mono px-2.5 py-1 rounded-md bg-violet-50 text-violet-700 font-semibold border border-violet-200">
                        Rule Calculation
                      </span>
                    </h3>
                    <div className="flex items-center gap-2 text-sm sm:text-base text-slate-500 font-mono mt-1 flex-wrap">
                      <span className="font-bold text-slate-800">{rec.keyword}</span>
                      {rec.matchType && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold text-xs uppercase">
                          {rec.matchType}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRuleExplanationModal(null)}
                  className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition cursor-pointer shrink-0"
                  aria-label="Đóng giải thích"
                >
                  <X size={22} />
                </button>
              </div>

              {/* Quick Stat Pills */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 text-center">
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-3">
                  <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Bid</div>
                  <div className="font-bold text-base mt-1">
                    <span className="text-slate-400 line-through mr-1">${rec.currentBid?.toFixed(2)}</span>
                    <span className={isPause ? "text-rose-600" : isIncrease ? "text-emerald-700" : "text-indigo-700"}>
                      ${rec.recommendedBid?.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-3">
                  <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Avg CPC</div>
                  <div className="font-bold text-base text-indigo-700 font-mono mt-1">
                    ${(rec.cpc || 0).toFixed(2)}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-3">
                  <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Spend</div>
                  <div className="font-bold text-base text-slate-800 font-mono mt-1">
                    ${(rec.spend || 0).toFixed(2)}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-3">
                  <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">ACoS / Break-even</div>
                  <div className="font-bold text-base text-slate-800 font-mono mt-1">
                    {actualAcosStr} {breakEven ? `/ ${breakEven}%` : ""}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-3 col-span-2 lg:col-span-1">
                  <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide whitespace-nowrap">Orders / Clicks</div>
                  <div className="font-bold text-base text-slate-800 font-mono mt-1">
                    {rec.orders || 0} ord / {rec.clicks || 0} clk
                  </div>
                </div>
              </div>

              {/* Khối 1: Luật áp dụng & Điều kiện */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-base sm:text-lg flex items-center gap-2">
                    <ClipboardText size={20} weight="duotone" className="text-violet-700" />
                    <span>Luật áp dụng</span>
                  </span>
                  {info.ruleName && (
                    <span className="px-2.5 py-1 rounded-md bg-violet-50 text-violet-700 font-mono font-bold text-xs sm:text-sm border border-violet-200">
                      {info.ruleName}
                    </span>
                  )}
                </div>
                <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                  {info.ruleCondition}
                </p>
              </div>

              {/* Khối 2: Phép tính số học & Trần/Sàn */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-base sm:text-lg flex items-center gap-2">
                    <Calculator size={20} weight="duotone" className="text-violet-700" />
                    <span>Phép tính & Giới hạn</span>
                  </span>
                  <span className="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                    <ShieldCheck size={18} weight="fill" className="text-emerald-600" />
                    <span>Hợp lệ</span>
                  </span>
                </div>

                <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-4 font-mono text-sm sm:text-base leading-relaxed flex items-center justify-between flex-wrap gap-3 overflow-x-auto">
                  <span className="text-slate-300">{info.formula}</span>
                  <div className="flex items-center gap-1.5 font-bold">
                    <ArrowUpRight size={18} className="text-slate-400" />
                    <span className="text-emerald-400 px-2.5 py-1 rounded-md bg-emerald-950 border border-emerald-800">
                      {info.resultBid}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 divide-x divide-slate-200">
                  <div className="px-3 py-3 text-center sm:px-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:text-xs">Min Bid</div>
                    <div className="mt-1 font-mono text-base font-bold text-slate-800 sm:text-lg">{info.minBid}</div>
                  </div>
                  <div className="px-3 py-3 text-center sm:px-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:text-xs">Max Bid</div>
                    <div className="mt-1 font-mono text-base font-bold text-slate-800 sm:text-lg">{info.maxBid}</div>
                  </div>
                  <div className="bg-emerald-50 px-3 py-3 text-center sm:px-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 sm:text-xs">Bid cuối</div>
                    <div className="mt-1 font-mono text-base font-bold text-emerald-700 sm:text-lg">{info.resultBid}</div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setRuleExplanationModal(null)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white rounded-lg text-sm font-bold transition cursor-pointer"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hộp thoại theo dõi kết quả Auto Bid (3D, 7D, 14D, 30D) */}
      <PpcAutoBidResultsModal
        isOpen={showOutcomesModal}
        onClose={() => setShowOutcomesModal(false)}
        selectedStore={selectedStore}
      />

      {/* Modal AI Reviewer Phản Biện */}
      <PpcAiReviewerModal
        isOpen={!!aiReviewModalRec}
        onClose={() => setAiReviewModalRec(null)}
        recommendation={aiReviewModalRec}
        aiResult={aiReviewResult}
        scenarioInfo={aiReviewScenarioInfo}
        retrievalMetadata={aiReviewRetrievalMetadata}
        isLoading={isAiReviewLoading}
        errorMessage={aiReviewError}
        onApplyBid={(bid, source, audit) => {
          if (aiReviewModalRec) {
            setUserFinalBids((prev) => ({
              ...prev,
              [aiReviewModalRec.id]: bid,
            }));
            setAiReviewApplications((prev) => ({
              ...prev,
              [aiReviewModalRec.id]: { source, audit },
            }));
          }
        }}
      />
    </div>
  );
}

function getRuleExplanation(
  rec: PpcRecommendation,
  breakEvenAcos?: number,
  maxBidLimit?: number
) {
  const beAcos = breakEvenAcos ?? 48;
  const actualAcos = rec.sales && rec.sales > 0 && rec.spend ? (rec.spend / rec.sales) * 100 : null;
  const isIncrease = rec.recType === "BID_INCREASE";
  const isPause = rec.recType === "PAUSE_TARGET";
  const ruleName = rec.ruleProfile || "PPC_RULE";
  const fallbackCondition = rec.orders && rec.orders > 0
    ? `${rec.orders} đơn, ACoS ${actualAcos?.toFixed(1) ?? "N/A"}% so với mức hòa vốn ${beAcos.toFixed(1)}%.`
    : `${rec.clicks || 0} clicks, chưa có đơn và đã chi $${(rec.spend || 0).toFixed(2)}.`;
  const ruleCondition = (rec.reason || fallbackCondition)
    .replace(/\s*\((?:Sàn rule:[^)]*|Không ép sàn;[^)]*)\)\s*$/i, "")
    .trim();

  // 1. Nhận diện chính xác Base tính toán theo nội dung luật trong reason
  // - Nếu rule chứa "Avg CPC" -> base là Avg CPC (exactCpc)
  // - Nếu rule chứa "Current Bid" -> base là Current Bid
  // - Fallback: BID_INCREASE dùng Current Bid, BID_DECREASE dùng Avg CPC
  const isAvgCpcBase = /avg\s*cpc/i.test(rec.reason || "");
  const isCurrentBidBase = /current\s*bid/i.test(rec.reason || "");

  const exactCpc = rec.spend && rec.clicks && rec.clicks > 0 ? rec.spend / rec.clicks : (rec.cpc || rec.currentBid || 0);
  const calculationBase = isAvgCpcBase
    ? exactCpc
    : isCurrentBidBase
      ? (rec.currentBid || 0)
      : (rec.recType === "BID_INCREASE" ? (rec.currentBid || 0) : exactCpc);
  const baseLabel = isAvgCpcBase
    ? "Avg CPC"
    : isCurrentBidBase
      ? "Current Bid"
      : (rec.recType === "BID_INCREASE" ? "Current Bid" : "Avg CPC");

  // 2. Lấy % điều chỉnh từ rule text (ví dụ: -> -15% Avg CPC)
  const rulePercentMatch = rec.reason?.match(/->\s*([+-]?\d+(?:\.\d+)?)%/i);
  const displayedRulePercent = rulePercentMatch ? Number(rulePercentMatch[1]) : null;

  const ruleMultiplier = displayedRulePercent !== null
    ? 1 + displayedRulePercent / 100
    : (calculationBase > 0 ? (rec.recommendedBid || 0) / calculationBase : 1);
  const ruleChangePercent = displayedRulePercent ?? ((ruleMultiplier - 1) * 100);

  const rawRuleBid = calculationBase * ruleMultiplier;
  const wasAdjusted = Math.abs(rawRuleBid - (rec.recommendedBid || 0)) >= 0.005;
  const calculationResult = wasAdjusted
    ? `$${rawRuleBid.toFixed(4)} → $${(rec.recommendedBid || 0).toFixed(2)}`
    : `$${(rec.recommendedBid || 0).toFixed(2)}`;

  const formula = isPause
    ? `Không tính bid mới: target được chuyển sang PAUSE để dừng phát sinh chi phí.`
    : `$${calculationBase.toFixed(2)} ${baseLabel} × ${ruleMultiplier.toFixed(3)} (${ruleChangePercent >= 0 ? "+" : ""}${ruleChangePercent.toFixed(1)}%) = ${calculationResult}`;

  const maxBidMatch = rec.reason?.match(/trần campaign:\s*\$([0-9.]+)/i);
  const maxBid = Number(maxBidMatch?.[1] || maxBidLimit || 0);

  return {
    ruleName,
    ruleCondition,
    formula,
    resultBid: isPause ? "PAUSE" : `$${(rec.recommendedBid || 0).toFixed(2)}`,
    minBid: isPause ? "—" : "Không ép sàn",
    maxBid: isPause || maxBid <= 0 ? "—" : `$${maxBid.toFixed(2)}`,
  };
}
