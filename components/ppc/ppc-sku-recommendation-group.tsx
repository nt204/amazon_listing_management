"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
} from "@phosphor-icons/react";
import {
  SKU_PREFIX_ERROR_PRODUCT_TYPE,
  type SkuRecommendationGroup,
  type PpcAction,
} from "@/lib/ppc/sku-architecture-types";
import type { PpcRecommendation } from "@/lib/ppc/types";
import type { AiReviewerExecutionResult } from "@/lib/ppc/ai-reviewer";
import { PpcPagination } from "./ppc-pagination";
import { PpcAutoBidResultsModal } from "./ppc-auto-bid-results-modal";
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

interface RecFinalBidInputProps {
  initialValue: number;
  onCommit: (val: number) => void;
  disabled?: boolean;
}

function RecFinalBidInput({ initialValue, onCommit, disabled }: RecFinalBidInputProps) {
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
      className={`inline-flex items-center justify-end rounded border px-1.5 py-0.5 transition ${
        isFocused
          ? "border-indigo-600 bg-white ring-1 ring-indigo-500 shadow-2xs"
          : "border-slate-300 bg-white hover:border-indigo-400"
      } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] font-bold text-slate-400 select-none mr-0.5">$</span>
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
        className="w-14 text-right font-mono font-bold text-slate-900 text-xs bg-transparent border-0 p-0 focus:outline-none focus:ring-0"
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
}: PpcSkuRecommendationGroupProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPhôi, setSelectedPhôi] = useState("ALL");
  const [selectedNiche, setSelectedNiche] = useState("ALL");
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>("ALL");
  const [selectedCampType, setSelectedCampType] = useState<"ALL" | "SP03" | "SB05" | "SB01">("ALL");
  const [sortField, setSortField] = useState<SortField>("totalRecommendations");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedSkuGroup, setSelectedSkuGroup] = useState<SkuRecommendationGroup | null>(null);
  const [loadingSkuDetails, setLoadingSkuDetails] = useState(false);
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
        if (!matchSku && !matchAsin && !matchNiche && !matchPhôi) return false;
      }

      // 2. Phôi filter
      if (selectedPhôi !== "ALL" && g.productType !== selectedPhôi) {
        return false;
      }

      // 3. Niche filter
      if (selectedNiche !== "ALL" && (g.niche || "").trim() !== selectedNiche) {
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
  }, [groups, searchTerm, selectedPhôi, selectedNiche, quickFilter, selectedCampType, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedGroups = filteredGroups.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    // Filters and sorting describe a new result set; show it from the first page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [searchTerm, selectedPhôi, selectedNiche, quickFilter, selectedCampType, sortField, sortOrder]);

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
  const currentSkuRecs = useMemo(() => {
    if (!selectedSkuGroup) return [];
    return allRecommendations
      .filter((r) => (r.sku || "").toUpperCase() === selectedSkuGroup.sku.toUpperCase())
      .filter((r) => {
        if (modalActionFilter !== "ALL" && r.recType !== modalActionFilter) return false;
        if (modalCampTypeFilter !== "ALL") {
          const camp = (r.campaignName || "").toUpperCase();
          const ruleProf = (r.ruleProfile || "").toUpperCase();
          let cType = "SP03";
          if (ruleProf.startsWith("SB05") || /SB05|\bVIDEO\b/.test(camp)) cType = "SB05";
          else if (ruleProf.startsWith("SB01") || /SB01/.test(camp)) cType = "SB01";
          else if (ruleProf.startsWith("SP03") || /SP03/.test(camp)) cType = "SP03";
          else if (r.adType === "SB") cType = "SB";
          if (cType !== modalCampTypeFilter) return false;
        }
        if (modalSearch) {
          const q = modalSearch.toLowerCase().trim();
          const matchKw = (r.keyword || "").toLowerCase().includes(q);
          const matchCamp = (r.campaignName || "").toLowerCase().includes(q);
          if (!matchKw && !matchCamp) return false;
        }
        return true;
      });
  }, [allRecommendations, selectedSkuGroup, modalActionFilter, modalCampTypeFilter, modalSearch]);

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
      };
    });
  }, [currentSkuRecs]);

  // Mặc định đóng tất cả các thẻ campaign khi mở SKU modal hoặc đóng modal
  useEffect(() => {
    setExpandedCampaigns(new Set());
  }, [selectedSkuGroup?.sku]);

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

  const isFilterActive =
    searchTerm !== "" ||
    selectedPhôi !== "ALL" ||
    selectedNiche !== "ALL" ||
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
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Search, Phôi, Window Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Box */}
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                placeholder="Tìm SKU, ASIN, Niche..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-7.5 pr-6 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/20 w-48 shadow-2xs"
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
                className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1"
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
                className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1 max-w-[200px]"
              >
                <option value="ALL">Tất cả Niche ({groups.length})</option>
                {nicheOptions.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} ({n.count})
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
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-600 font-medium bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/90 shadow-2xs">
              <span>
                <strong className="text-slate-900 font-semibold">{filteredGroups.length}</strong>/{groups.length} SKU
              </span>
              <span className="text-slate-300">•</span>
              <span>
                <strong className="text-indigo-700 font-semibold">{filteredRecommendationsCount}</strong> đề xuất
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Spend: <strong className="text-slate-900 font-mono font-semibold">${filteredAggregates.spend.toFixed(0)}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Sales: <strong className="text-emerald-700 font-mono font-semibold">${filteredAggregates.sales.toFixed(0)}</strong>
              </span>
            </div>

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
          <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1 mr-0.5 shrink-0">
            <Funnel size={11} weight="bold" className="text-slate-500" />
            <span>Lọc:</span>
          </span>

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
            <CheckSquare size={17} weight="fill" className="text-indigo-600" />
            <span>Đã chọn {selectedSkus.size} SKU</span>
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
        <table className="w-full text-left text-xs">
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
                    <td className="py-3 px-3 text-slate-500">{group.asin || "—"}</td>
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
          onClick={() => setSelectedSkuGroup(null)}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] bg-white border border-slate-200 rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-3">
                {selectedSkuGroup.mockupUrl && (
                  <img
                    src={getOptimizedThumbnailUrl(selectedSkuGroup.mockupUrl, 96) || selectedSkuGroup.mockupUrl}
                    alt={selectedSkuGroup.sku}
                    className="w-12 h-12 rounded-xl object-cover border border-slate-200 shadow-xs shrink-0"
                    loading="lazy"
                  />
                )}
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-black text-slate-900">
                      ĐỀ XUẤT CHO SKU: <span className="text-indigo-600 font-mono">{selectedSkuGroup.sku}</span>
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {selectedSkuGroup.productType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>ASIN: {selectedSkuGroup.asin}</span>
                    {selectedSkuGroup.picMkt && <span>• PIC: <strong className="text-slate-700">{selectedSkuGroup.picMkt}</strong></span>}
                    {selectedSkuGroup.niche && <span>• Niche: <strong className="text-slate-700">{selectedSkuGroup.niche}</strong></span>}
                    <span>•</span>
                    {loadingSkuDetails ? (
                      <span className="inline-flex items-center gap-1 text-indigo-600 font-semibold animate-pulse">
                        <CircleNotch size={12} className="animate-spin" />
                        Đang tải và tính toán chi tiết đề xuất...
                      </span>
                    ) : (
                      <span>Tổng cộng {currentSkuRecs.length} đề xuất tối ưu hóa</span>
                    )}
                  </p>
                </div>
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
                    {(() => {
                      const econ = selectedSkuGroup.economics;
                      const calculated = econ.calculatedMaxBid ?? econ.maxBid;
                      const isOverridden = econ.maxBidOverride != null && econ.maxBidOverride > 0 && calculated > 0;
                      // Lỗi Prefix / thiếu dữ liệu (Max Bid tự tính = 0) thì không cho đặt tay
                      const canEdit = calculated > 0 && /^[0-9a-f-]{36}$/i.test(econ.storeId);
                      return (
                        <div className={`bg-white p-2.5 rounded-xl border shadow-2xs ${isOverridden ? "border-violet-300" : "border-slate-200"}`}>
                          <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-500">
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
                            <div className="mt-0.5 space-y-1">
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
                                className="w-full rounded border border-indigo-300 px-1 py-0.5 text-center font-mono text-xs font-bold text-slate-900 focus:border-indigo-600 focus:outline-none"
                              />
                              <div className="flex justify-center gap-1">
                                <button
                                  type="button"
                                  disabled={isSavingMaxBid}
                                  onClick={() => void handleSaveMaxBid(Number(maxBidDraft))}
                                  className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                  {isSavingMaxBid ? "..." : "Lưu"}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingMaxBid}
                                  onClick={() => setMaxBidDraft(null)}
                                  className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={`text-xs font-black font-mono mt-0.5 ${isOverridden ? "text-violet-700" : "text-indigo-600"}`}>
                                ${econ.maxBid.toFixed(2)}
                              </div>
                              {isOverridden && (
                                <div className="mt-0.5 text-[9px] text-slate-500">
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
                      {loadingSkuDetails ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1.5 animate-pulse">
                          <CircleNotch size={12} className="animate-spin text-indigo-600" />
                          Đang tải chi tiết...
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {currentSkuRecs.length} targets · {groupedByCampaign.length} campaigns
                        </span>
                      )}
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
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${modalActionFilter === "ALL" ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:text-slate-900"
                          }`}
                      >
                        Tất cả
                      </button>
                      <button
                        onClick={() => setModalActionFilter("BID_INCREASE")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${modalActionFilter === "BID_INCREASE" ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:text-emerald-600"
                          }`}
                      >
                        ↑ Tăng
                      </button>
                      <button
                        onClick={() => setModalActionFilter("BID_DECREASE")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${modalActionFilter === "BID_DECREASE" ? "bg-rose-50 text-rose-700" : "text-slate-600 hover:text-rose-600"
                          }`}
                      >
                        ↓ Giảm
                      </button>
                      <button
                        onClick={() => setModalActionFilter("PAUSE_TARGET")}
                        className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${modalActionFilter === "PAUSE_TARGET" ? "bg-amber-50 text-amber-800" : "text-slate-600 hover:text-amber-700"
                          }`}
                      >
                        ⏸ Pause
                      </button>
                    </div>

                    {/* Modal Campaign Type filter pills */}
                    <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 text-xs">
                      {(["SP03", "SB05", "SB01"] as const).map((type) => {
                        const isActive = modalCampTypeFilter === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setModalCampTypeFilter(modalCampTypeFilter === type ? "ALL" : type)}
                            className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition ${
                              isActive
                                ? type === "SB05"
                                  ? "bg-purple-600 text-white shadow-2xs"
                                  : type === "SB01"
                                    ? "bg-blue-600 text-white shadow-2xs"
                                    : "bg-indigo-600 text-white shadow-2xs"
                                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                            }`}
                          >
                            {type}
                          </button>
                        );
                      })}
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
                      disabled={loadingSkuDetails || groupedByCampaign.length === 0}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
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
                      disabled={loadingSkuDetails || currentSkuRecs.length === 0}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
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

                    {selectedRecIds.size > 0 && (
                      <button
                        type="button"
                        onClick={handleBatchEditRecBids}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 text-xs font-bold transition shadow-2xs cursor-pointer"
                        title="Chỉnh sửa Final Bid hàng loạt cho các mục đang chọn"
                      >
                        <PencilSimple size={13} weight="bold" />
                        <span>Sửa Bid ({selectedRecIds.size})</span>
                      </button>
                    )}

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
                        disabled={selectedRecIds.size === 0 || isApproving || isStoreSwitching}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-2xs disabled:opacity-40 cursor-pointer"
                      >
                        <CheckCircle size={14} weight="bold" />
                        <span>{isApproving ? "Đang xử lý..." : isStoreSwitching ? "Đang đổi Store..." : `Duyệt ${selectedRecIds.size} mục đã chọn`}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Grouped Campaign Cards */}
                {loadingSkuDetails ? (
                  <div className="py-16 text-center space-y-3 bg-slate-50/70 rounded-2xl border border-dashed border-indigo-200 animate-in fade-in duration-150">
                    <div className="inline-flex p-3 rounded-2xl bg-indigo-50 text-indigo-600 animate-spin">
                      <CircleNotch size={28} weight="bold" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        Đang tải và tính toán chi tiết đề xuất cho SKU {selectedSkuGroup.sku}...
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Hệ thống đang đối chiếu dữ liệu chiến dịch và áp dụng công thức tối ưu hóa theo quy chuẩn...
                      </p>
                    </div>
                  </div>
                ) : groupedByCampaign.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-slate-200">
                    {modalSearch || modalActionFilter !== "ALL" || modalCampTypeFilter !== "ALL"
                      ? "Không tìm thấy đề xuất nào phù hợp với bộ lọc tìm kiếm hiện tại."
                      : "Không có đề xuất nào cho SKU này trong kỳ dữ liệu đã chọn."}
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
                          className={`rounded-xl border transition shadow-2xs overflow-hidden ${isExpanded
                              ? "border-indigo-200 ring-1 ring-indigo-200/50 bg-white"
                              : "border-slate-200 hover:border-indigo-300 bg-white"
                            }`}
                        >
                          {/* Campaign Header Bar — Click anywhere to expand/collapse */}
                          <div
                            onClick={() => toggleCampaignExpanded(cg.campaignName)}
                            className={`flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 border-b cursor-pointer select-none transition ${isExpanded
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
                                className={`text-slate-400 transition-transform duration-200 ${isExpanded ? "rotate-90 text-indigo-600" : "text-slate-400"
                                  }`}
                              />

                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-200/80">
                                {cg.campaignType}
                              </span>

                              {cg.campaignState === "paused" && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200/80">
                                  PAUSED
                                </span>
                              )}

                              {/* FULL CAMPAIGN NAME (NO TRUNCATION!) */}
                              <h4
                                className="font-semibold text-slate-900 text-xs break-all select-all flex-1 hover:text-indigo-600 transition"
                                title="Bấm để mở / thu gọn danh sách target"
                              >
                                {cg.campaignName}
                              </h4>
                            </div>

                            <div className="flex items-center gap-2 text-[11px]">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleBatchEditCampaignRecBids(cg.recs, cg.campaignName);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 bg-white transition cursor-pointer"
                                title="Đặt nhanh Final Bid cho toàn bộ targets trong campaign này"
                              >
                                <PencilSimple size={11} weight="bold" />
                                <span>Sửa Bid</span>
                              </button>

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
                                        className={`hover:bg-indigo-50/20 transition ${isSelected ? "bg-indigo-50/40" : ""
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
                                        <td className="py-2.5 px-3 col-primary">
                                          <div className="font-bold text-slate-900 break-words flex items-center gap-1.5" title={rec.keyword}>
                                            <span className="font-bold text-slate-900">{rec.keyword}</span>
                                            <button
                                              type="button"
                                              onClick={() => handleExplainRule(rec)}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition cursor-pointer shrink-0"
                                              title="Xem điều kiện rule và phép tính tạo ra mức bid này"
                                            >
                                              <Info size={10} weight="bold" />
                                              <span>Explain</span>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleOpenAiReview(rec)}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-indigo-500/20 text-purple-700 border border-purple-200 transition cursor-pointer shrink-0 shadow-2xs group"
                                              title="AI Reviewer (gpt-5.6-terra): Bấm để AI phản biện và xem bảng số liệu chứng minh"
                                            >
                                              <Sparkle size={10} weight="fill" className="text-purple-600 group-hover:scale-110 transition-transform" />
                                              <span>AI</span>
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
                                            <RecFinalBidInput
                                              initialValue={finalBid}
                                              disabled={isApproving || isStoreSwitching}
                                              onCommit={(newVal) => {
                                                setUserFinalBids((prev) => ({
                                                  ...prev,
                                                  [rec.id]: newVal,
                                                }));
                                                setAiReviewApplications((prev) => {
                                                  const next = { ...prev };
                                                  delete next[rec.id];
                                                  return next;
                                                });
                                              }}
                                            />
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                                          {rec.ruleProfile || "v1.0"}
                                        </td>
                                        <td
                                          className={`sticky right-0 z-[5] border-l border-slate-100 py-2.5 px-3 text-center shadow-[-6px_0_10px_-8px_rgba(15,23,42,0.3)] ${isSelected ? "bg-indigo-50" : "bg-white"
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
                                              disabled={isApproving || isStoreSwitching}
                                              className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[11px] border border-indigo-200 transition cursor-pointer disabled:opacity-40"
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
