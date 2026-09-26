"use client";

import { startTransition, useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore, Fragment } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowsClockwise,
  ChartLineUp,
  CheckCircle,
  Copy,
  Crosshair,
  Download,
  MagnifyingGlass,
  Storefront,
  Tag,
  UploadSimple,
  X,
  FolderSimple,
  ChartPieSlice,
  ArrowRight,
  ArrowSquareOut,
  CalendarBlank,
  Gear,
  Clock,
  Sliders,
  Plus,
  CircleNotch,
} from "@phosphor-icons/react";
import { PpcPagination } from "./ppc-pagination";
import {
  extractSkuFromText,
  extractCampaignDate,
  formatPpcExportFilename,
} from "@/lib/ppc/sku-extractor";
import { PpcSkuEconomicsTable } from "./ppc-sku-economics-table";
import { PpcSkuRecommendationGroupView } from "./ppc-sku-recommendation-group";
import { PpcActionQueueDrawer } from "./ppc-action-queue-drawer";
import { PpcSettingsTab } from "./ppc-settings-tab";
import { PpcFileManagerModal } from "./ppc-file-manager-modal";
import { PpcNotificationPopover } from "./ppc-notification-popover";
import { PpcAddStoreModal } from "./ppc-add-store-modal";
import { PpcStoreManagerModal } from "./ppc-store-manager-modal";
import type {
  SkuEconomics,
  SkuRecommendationGroup,
  ProductCostMaster,
  PpcRuleVersion,
  BulkExport,
  PpcAction,
} from "@/lib/ppc/sku-architecture-types";
import { PpcMultiStoreView } from "./ppc-multi-store-view";
import type {
  PpcAlert,
  PpcAdTypeBreakdown,
  PpcCampaignPerformance,
  PpcAdGroupPerformance,
  PpcDataHealth,
  PpcKeywordMatchTypeBreakdown,
  PpcMatchTypeBreakdown,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSkuPerformance,
  PpcStore,
  PpcStoreSummary,
  PpcSummaryMetrics,
  PpcTargetPerformance,
  PpcTargetTypeBreakdown,
  PpcVelocityComparison,
  PpcDailyTrendPoint,
} from "@/lib/ppc/types";

interface PpcDashboardProps {
  isEmbedded?: boolean;
  initialTab?: "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "alerts" | "recommendations" | "settings";
  initialSubTab?: "phoi" | "rules" | "history";
}

interface PpcDetailCounts {
  campaigns: number;
  adGroups: number;
  targets: number;
  skus: number;
  searchTerms: number;
}

type SortField = "spend" | "sales" | "orders" | "clicks" | "impressions" | "ctr" | "acos" | "cvr" | "roas";
type CampaignSortField = SortField | "date";
type SortDirection = "asc" | "desc";

const TARGET_TYPE_COLORS: Record<string, string> = {
  Keyword: "#6366f1", // Indigo
  Auto: "#f59e0b", // Amber
  "Product Targeting": "#8b5cf6", // Violet
  Other: "#94a3b8", // Slate
};

const KEYWORD_MATCH_TYPE_COLORS: Record<string, string> = {
  Exact: "#2563eb", // Blue
  Phrase: "#0284c7", // Sky
  Broad: "#10b981", // Emerald
  Unknown: "#94a3b8", // Slate
};

const MATCH_TYPE_COLORS: Record<string, string> = {
  Exact: "#2563eb", // Blue
  Phrase: "#0284c7", // Sky
  Broad: "#10b981", // Emerald
  Auto: "#f59e0b", // Amber
  Targeting: "#8b5cf6", // Violet
};

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const PpcTimeSeriesChart = dynamic(
  () => import("./ppc-time-series-chart").then((module) => module.PpcTimeSeriesChart),
  { loading: () => <div className="h-[360px] animate-pulse rounded-xl bg-slate-100" /> },
);

const PpcPerformanceRankingChart = dynamic(
  () => import("./ppc-performance-ranking-chart").then((module) => module.PpcPerformanceRankingChart),
  { loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-slate-100" /> },
);

import { PpcOverviewSkeleton } from "./ppc-overview-skeleton";

function searchTermKey(term: PpcSearchTermRow): string {
  return [
    term.id, term.storeName, term.adType, term.reportDate, term.portfolioName, term.campaignName,
    term.adGroupName, term.targetKeyword, term.customerSearchTerm, term.matchType,
  ].filter(Boolean).join("\u0000");
}

function formatSyncTime(isoString: string | null): string {
  if (!isoString) return "--:--:--";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "--:--:--";
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "--:--:--";
  }
}

export function PpcDashboard({ isEmbedded = false, initialTab, initialSubTab }: PpcDashboardProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  const [stores, setStores] = useState<PpcStore[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<PpcStoreSummary[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [selectedSku, setSelectedSku] = useState<string>("ALL");
  const [selectedDays, setSelectedDays] = useState(30);
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const effectiveReportDays = useMemo(() => {
    if (!isCustomDate || !customStartDate || !customEndDate) return Math.max(selectedDays, 1);
    const start = Date.parse(`${customStartDate}T00:00:00Z`);
    const end = Date.parse(`${customEndDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Math.max(selectedDays, 1);
    return Math.round((end - start) / 86_400_000) + 1;
  }, [customEndDate, customStartDate, isCustomDate, selectedDays]);
  const [availableSkus, setAvailableSkus] = useState<string[]>([]);

  const [summary, setSummary] = useState<PpcSummaryMetrics | null>(null);
  const [velocity, setVelocity] = useState<PpcVelocityComparison | null>(null);
  const [skuPerformance, setSkuPerformance] = useState<PpcSkuPerformance[]>([]);
  const [campaignPerformance, setCampaignPerformance] = useState<PpcCampaignPerformance[]>([]);
  const [overviewCampaigns, setOverviewCampaigns] = useState<PpcCampaignPerformance[]>([]);
  const [adGroupPerformance, setAdGroupPerformance] = useState<PpcAdGroupPerformance[]>([]);
  const [targetPerformance, setTargetPerformance] = useState<PpcTargetPerformance[]>([]);
  const [adTypeBreakdown, setAdTypeBreakdown] = useState<PpcAdTypeBreakdown[]>([]);
  const [dataHealth, setDataHealth] = useState<PpcDataHealth | null>(null);
  const [targetTypeBreakdown, setTargetTypeBreakdown] = useState<PpcTargetTypeBreakdown[]>([]);
  const [keywordMatchTypeBreakdown, setKeywordMatchTypeBreakdown] = useState<PpcKeywordMatchTypeBreakdown[]>([]);
  const [matchTypeBreakdown, setMatchTypeBreakdown] = useState<PpcMatchTypeBreakdown[]>([]);
  const [searchTerms, setSearchTerms] = useState<PpcSearchTermRow[]>([]);
  const [alerts, setAlerts] = useState<PpcAlert[]>([]);
  const [targetAcos, setTargetAcos] = useState(30);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [detailCounts, setDetailCounts] = useState<PpcDetailCounts | null>(null);
  const [loadingSection, setLoadingSection] = useState<string | null>(null);
  const loadedSectionsRef = useRef(new Set<string>());
  const detailRequestIdRef = useRef(0);

  // Drill-down hierarchy state: Campaign -> Ad Group -> Target/Keyword -> Search Terms
  const [selectedCampaignForDrilldown, setSelectedCampaignForDrilldown] = useState<string | null>(null);
  const [selectedAdGroupForDrilldown, setSelectedAdGroupForDrilldown] = useState<string | null>(null);
  const [expandedTargetKey, setExpandedTargetKey] = useState<string | null>(null);

  // Navigation tab for data slicing (Hierarchy: Overview -> Campaigns -> Ad Groups -> Targets -> Search Terms | SKU parallel view | Settings)
  const [activeTab, setActiveTab] = useState<
    "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "alerts" | "recommendations" | "settings"
  >(initialTab || "overview");
  const [settingsSubTab, setSettingsSubTab] = useState<"phoi" | "rules" | "history">(initialSubTab || "phoi");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialSubTab) {
      setSettingsSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  // SKU-First Architecture state
  const [skuSubView, setSkuSubView] = useState<"economics" | "performance">("economics");
  const [skuEconomicsList, setSkuEconomicsList] = useState<SkuEconomics[]>([]);
  const [skuRecGroups, setSkuRecGroups] = useState<SkuRecommendationGroup[]>([]);
  const [skuRecAllRecs, setSkuRecAllRecs] = useState<PpcRecommendation[]>([]);
  const [loadedRecommendationWindowDays, setLoadedRecommendationWindowDays] = useState<number | null>(null);
  const [actionQueue, setActionQueue] = useState<PpcAction[]>([]);
  const [actionQueueCount, setActionQueueCount] = useState<number>(0);
  const lastLoadedRecKeyRef = useRef<string>("");
  const groupedRecRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const groupedRecRequestIdRef = useRef(0);
  const currentFiltersRef = useRef({
    store: selectedStore,
    sku: selectedSku,
    days: selectedDays,
    isCustomDate,
    start: customStartDate,
    end: customEndDate,
  });
  const pendingActionCount = actionQueue.length > 0 ? actionQueue.length : actionQueueCount;
  const [isActionQueueOpen, setIsActionQueueOpen] = useState(false);
  const [costMasters, setCostMasters] = useState<ProductCostMaster[]>([]);
  const [ruleVersions, setRuleVersions] = useState<PpcRuleVersion[]>([]);
  const [bulkHistory, setBulkHistory] = useState<BulkExport[]>([]);
  const [loadingSkuEcon, setLoadingSkuEcon] = useState(false);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Filters & sorting for Search Terms
  const [searchTermQuery, setSearchTermQuery] = useState("");
  const [matchTypeFilter, setMatchTypeFilter] = useState("ALL");
  const [termPerformanceFilter, setTermPerformanceFilter] = useState<
    "ALL" | "WITH_ORDERS" | "ZERO_ORDERS_BLEEDING" | "HIGH_ACOS"
  >("ALL");
  const [termSortField, setTermSortField] = useState<SortField>("spend");
  const [termSortDir, setTermSortDir] = useState<SortDirection>("desc");
  const [termPage, setTermPage] = useState(1);
  const [termPageSize, setTermPageSize] = useState(25);
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignPageSize, setCampaignPageSize] = useState(25);
  const [loadingCampaignPage, setLoadingCampaignPage] = useState(false);
  const [campaignServerMeta, setCampaignServerMeta] = useState({
    total: 0,
    activeCount: 0,
    pausedCount: 0,
    totals: { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
  });
  const [adGroupPage, setAdGroupPage] = useState(1);
  const [adGroupPageSize, setAdGroupPageSize] = useState(25);
  const [targetPage, setTargetPage] = useState(1);
  const [targetPageSize, setTargetPageSize] = useState(25);
  const [skuPage, setSkuPage] = useState(1);
  const [skuPageSize, setSkuPageSize] = useState(25);
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());

  // SKU category filter
  const [skuCategoryFilter, setSkuCategoryFilter] = useState<"ALL" | "HERO" | "BLEEDING" | "POTENTIAL" | "ZERO_CLICKS" | "ZERO_SPEND">("ALL");
  const [hidePausedSkus, setHidePausedSkus] = useState(false);


  // Campaign search & sort & multi-dimension filters
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignSortField, setCampaignSortField] = useState<CampaignSortField>("date");
  const [campaignSortDir, setCampaignSortDir] = useState<SortDirection>("desc");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ACTIVE");
  const [campaignGroupFilter, setCampaignGroupFilter] = useState<"ALL" | "BLEEDING" | "HIGH_ACOS" | "GOOD">("ALL");
  const [campaignFormatFilter, setCampaignFormatFilter] = useState<string>("ALL");
  const [campaignSpendFilter, setCampaignSpendFilter] = useState<"ALL" | "HAS_SPEND" | "ZERO_SPEND" | "SPEND_GT_50" | "SPEND_GT_100">("ALL");

  // Ad Group search & sort
  const [adGroupQuery, setAdGroupQuery] = useState("");
  const [adGroupSortField, setAdGroupSortField] = useState<SortField>("spend");
  const [adGroupSortDir, setAdGroupSortDir] = useState<SortDirection>("desc");

  // Target search & sort
  const [targetQuery, setTargetQuery] = useState("");
  const [targetSortField, setTargetSortField] = useState<SortField>("spend");
  const [targetSortDir, setTargetSortDir] = useState<SortDirection>("desc");

  // SKU search & sort
  const [skuQuery, setSkuQuery] = useState("");
  const [skuSortField, setSkuSortField] = useState<SortField>("spend");
  const [skuSortDir, setSkuSortDir] = useState<SortDirection>("desc");

  const [loading, setLoading] = useState(true);
  const [syncingR2, setSyncingR2] = useState(false);
  const [syncingAdsPower, setSyncingAdsPower] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  const [showAddStoreModal, setShowAddStoreModal] = useState(false);
  const [showStoreManagerModal, setShowStoreManagerModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStore, setUploadStore] = useState("HSOSTORE");
  const [uploadEndDate, setUploadEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateRangeStart, setDateRangeStart] = useState<string | null>(null);
  const [dateRangeEnd, setDateRangeEnd] = useState<string | null>(null);
  const [dailyTrends, setDailyTrends] = useState<PpcDailyTrendPoint[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [summary7D, setSummary7D] = useState<PpcSummaryMetrics | null>(null);
  const [adTypeBreakdown7D, setAdTypeBreakdown7D] = useState<PpcAdTypeBreakdown[]>([]);
  const metricsRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const metricsRequestIdRef = useRef(0);

  // Notification helper
  const notify = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Close upload modal on ESC key
  useEffect(() => {
    if (!showUploadModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShowUploadModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showUploadModal]);

  const loadData = useCallback(async (refresh = false) => {
    detailRequestIdRef.current += 1;
    metricsRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++metricsRequestIdRef.current;
    metricsRequestRef.current = { controller, id: requestId };
    setLoading(true);
    try {
      const dateParams = isCustomDate && customStartDate && customEndDate
        ? `&startDate=${encodeURIComponent(customStartDate)}&endDate=${encodeURIComponent(customEndDate)}`
        : "";
      const res = await fetch(
        `/api/ppc/metrics?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}${dateParams}${refresh ? "&refresh=1" : ""}`,
        { cache: "no-store", signal: controller.signal }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || errData.message || (res.status === 401 ? "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." : `Lỗi máy chủ (HTTP ${res.status})`);
        throw new Error(msg);
      }
      const data = await res.json();
      loadedSectionsRef.current.add("overview");
      if (refresh) {
        lastLoadedRecKeyRef.current = "";
      }
      startTransition(() => {
        setStores(data.stores || []);
        setStoreSummaries(data.storeSummaries || []);
        setSummary(data.summary || null);
        setSummary7D(data.summary7D || null);
        setAdTypeBreakdown7D(data.adTypeBreakdown7D || []);
        setVelocity(data.velocity || null);
        if (data.skuPerformance && data.skuPerformance.length > 0) setSkuPerformance(data.skuPerformance);
        if (data.campaignPerformance && data.campaignPerformance.length > 0) {
          setCampaignPerformance(data.campaignPerformance);
          setOverviewCampaigns(data.campaignPerformance);
        }
        if (data.adGroups && data.adGroups.length > 0) setAdGroupPerformance(data.adGroups);
        if (data.targets && data.targets.length > 0) setTargetPerformance(data.targets);
        setAdTypeBreakdown(data.adTypeBreakdown || []);
        setDataHealth(data.dataHealth || null);
        setTargetTypeBreakdown(data.targetTypeBreakdown || []);
        setKeywordMatchTypeBreakdown(data.keywordMatchTypeBreakdown || []);
        setMatchTypeBreakdown(data.matchTypeBreakdown || []);
        setSearchTerms(data.searchTerms || []);
        setAlerts(data.alerts || []);
        setAvailableSkus(data.availableSkus || []);
        setTargetAcos(data.targetAcos || 30);
        setDateRangeStart(data.dateRangeStart || null);
        setDateRangeEnd(data.dateRangeEnd || null);
        setDailyTrends(data.dailyTrends || []);
        setLastSyncedAt(data.lastSyncedAt || null);
        setDetailCounts(data.detailCounts || null);
        setSelectedTerms(new Set());
        setTermPage(1);
        setCampaignPage(1);
        setAdGroupPage(1);
        setTargetPage(1);
        setSkuPage(1);
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      notify(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu từ máy chủ", "error");
    } finally {
      if (metricsRequestRef.current?.id === requestId) {
        metricsRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [selectedStore, selectedSku, selectedDays, isCustomDate, customStartDate, customEndDate]);

  const loadSection = useCallback(async (section: string) => {
    if (loadedSectionsRef.current.has(section)) return;
    const requestId = ++detailRequestIdRef.current;
    setLoadingSection(section);
    try {
      const dateParams = isCustomDate && customStartDate && customEndDate
        ? `&startDate=${encodeURIComponent(customStartDate)}&endDate=${encodeURIComponent(customEndDate)}`
        : "";
      const res = await fetch(
        `/api/ppc/metrics?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}&section=${encodeURIComponent(section)}${dateParams}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || errData.message || (res.status === 401 ? "Phiên làm việc đã hết hạn" : `Lỗi tải bảng dữ liệu (HTTP ${res.status})`);
        throw new Error(msg);
      }
      const data = await res.json();
      if (requestId !== detailRequestIdRef.current) return;
      loadedSectionsRef.current.add(section);
      startTransition(() => {
        if (data.stores && data.stores.length > 0) setStores(data.stores);
        if (section === "campaigns") setCampaignPerformance(data.campaignPerformance || []);
        if (section === "ad_groups") setAdGroupPerformance(data.adGroups || []);
        if (section === "targets") setTargetPerformance(data.targets || []);
        if (section === "skus") setSkuPerformance(data.skuPerformance || []);
        if (section === "search_terms") setSearchTerms(data.searchTerms || []);
        setDetailCounts((current) => data.detailCounts ? { ...current, ...data.detailCounts } : current);
      });
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setLoadingSection(null);
      }
    }
  }, [selectedStore, selectedSku, selectedDays, isCustomDate, customStartDate, customEndDate]);

  useEffect(() => {
    if (activeTab !== "campaigns") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingCampaignPage(true);
      try {
        const params = new URLSearchParams({
          storeName: selectedStore, sku: selectedSku, days: String(selectedDays),
          query: campaignQuery, status: campaignStatusFilter, adType: campaignFormatFilter,
          spendFilter: campaignSpendFilter, groupFilter: campaignGroupFilter,
          targetAcos: String(targetAcos), sortField: campaignSortField,
          sortDirection: campaignSortDir, page: String(campaignPage), pageSize: String(campaignPageSize),
        });
        const res = await fetch(`/api/ppc/campaigns?${params}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`Không thể tải Campaign (HTTP ${res.status})`);
        const data = await res.json();
        setCampaignPerformance(data.campaigns || []);
        setCampaignServerMeta({
          total: Number(data.total || 0), activeCount: Number(data.activeCount || 0),
          pausedCount: Number(data.pausedCount || 0),
          totals: data.totals || { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        notify(error instanceof Error ? error.message : "Không thể tải Campaign", "error");
      } finally {
        if (!controller.signal.aborted) setLoadingCampaignPage(false);
      }
    }, campaignQuery ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, selectedStore, selectedSku, selectedDays, campaignQuery, campaignStatusFilter,
    campaignFormatFilter, campaignSpendFilter, campaignGroupFilter, targetAcos,
    campaignSortField, campaignSortDir, campaignPage, campaignPageSize]);

  const loadSkuEconomics = useCallback(async () => {
    try {
      setLoadingSkuEcon(true);
      const res = await fetch(`/api/ppc/sku-economics?days=${selectedDays}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data) {
        setSkuEconomicsList(data.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSkuEcon(false);
    }
  }, [selectedDays]);

  const loadGroupedRecommendations = useCallback(async (force = false) => {
    const currentKey = `${selectedStore}:${selectedSku}:${selectedDays}`;
    if (!force && lastLoadedRecKeyRef.current === currentKey) {
      return;
    }

    groupedRecRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++groupedRecRequestIdRef.current;
    groupedRecRequestRef.current = { controller, id: requestId };

    setLoadingRecs(true);
    try {
      const res = await fetch(
        `/api/ppc/recommendations/grouped?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}&summary=1${force ? "&refresh=1" : ""}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) return;
      const data = await res.json();
      if (requestId !== groupedRecRequestIdRef.current || data?.recommendationWindowDays !== selectedDays) {
        return;
      }
      if (data?.data?.groups) {
        lastLoadedRecKeyRef.current = currentKey;
        setLoadedRecommendationWindowDays(selectedDays);
        setSkuRecGroups(data.data.groups);
        if (Array.isArray(data?.data?.allRecommendations)) {
          setSkuRecAllRecs(data.data.allRecommendations);
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error(e);
    } finally {
      if (groupedRecRequestRef.current?.id === requestId) {
        groupedRecRequestRef.current = null;
        setLoadingRecs(false);
      }
    }
  }, [selectedStore, selectedSku, selectedDays]);

  const loadSkuRecommendationDetails = useCallback(async (sku: string) => {
    const res = await fetch(
      `/api/ppc/recommendations/grouped?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(sku)}&days=${selectedDays}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Không thể tải recommendation cho SKU ${sku}`);
    const data = await res.json();
    if (data?.recommendationWindowDays !== selectedDays) throw new Error("Recommendation trả về sai kỳ dữ liệu.");
    const recommendations = Array.isArray(data?.data?.allRecommendations) ? data.data.allRecommendations : [];
    setSkuRecAllRecs(recommendations);
    return recommendations;
  }, [selectedStore, selectedDays]);

  const loadActionQueueCount = useCallback(async () => {
    try {
      const res = await fetch("/api/ppc/actions/count", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") {
        setActionQueueCount(data.count);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadActionQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/ppc/actions", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data) {
        setActionQueue(data.data);
        setActionQueueCount(data.data.length);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadBulkHistory = useCallback(async () => {
    try {
      const resHistory = await fetch("/api/ppc/bulk-export", { cache: "no-store" });
      if (resHistory.ok) {
        const d = await resHistory.json();
        if (d?.data) setBulkHistory(d.data);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleUpdateSkuEconomics = async (sku: string, updates: Partial<SkuEconomics>) => {
    const res = await fetch("/api/ppc/sku-economics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, ...updates }),
    });
    if (!res.ok) throw new Error("Không thể cập nhật thông số SKU.");
    void loadSkuEconomics();
    notify(`Đã cập nhật thông số kinh tế cho SKU ${sku}`, "success");
  };

  const handleApproveToQueue = async (items: Array<{ recommendation: PpcRecommendation; userFinalBid?: number }>) => {
    const res = await fetch("/api/ppc/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error("Không thể duyệt hành động vào Action Queue.");
    const data = await res.json();
    void loadActionQueue();
    void loadGroupedRecommendations(true);
    notify(data.message || "Đã duyệt đề xuất vào Action Queue!", "success");
  };

  const handleRemoveAction = async (actionId: string) => {
    const res = await fetch(`/api/ppc/actions?actionId=${encodeURIComponent(actionId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Không thể xóa hành động.");
    void loadActionQueue();
    notify("Đã xóa hành động khỏi Action Queue.", "success");
  };

  const handleRemoveActions = async (actionIds: string[]) => {
    if (!actionIds || actionIds.length === 0) return;
    const targetStore = stores.find((s) => s.name === selectedStore)?.id || stores[0]?.id;
    const res = await fetch(`/api/ppc/actions?storeId=${encodeURIComponent(targetStore || "")}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionIds }),
    });
    if (!res.ok) throw new Error("Không thể xóa các hành động đã chọn.");
    void loadActionQueue();
    notify(`Đã xóa ${actionIds.length} hành động khỏi Action Queue.`, "success");
  };

  const handleExportBulk = async (selectedActionIds?: string[]) => {
    const res = await fetch("/api/ppc/bulk-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionIds: selectedActionIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Không thể xuất file Bulk.");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const fileName = match ? match[1] : `bulk_export_${Date.now()}.xlsx`;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    void loadActionQueue();
    void loadBulkHistory();
    notify(`Đã tạo và tải file bulk: ${fileName}`, "success");
  };

  const handleSaveCostMaster = async (data: {
    productType: string;
    baseCost: number;
    defaultAmazonFee: number;
    taxRate: number;
    effectiveFrom?: string;
    notes?: string;
  }) => {
    const res = await fetch("/api/ppc/cost-master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Không thể lưu phiên bản Phôi mới.");
    void loadSkuEconomics();
    notify(`Đã lưu phiên bản mới cho phôi ${data.productType}`, "success");
  };

  // Initial mount: only load the lightweight queue count. Recommendations are
  // intentionally lazy because a cold computation is expensive.
  useEffect(() => {
    void loadActionQueueCount();
  }, [loadActionQueueCount]);

  // Lazy-load drawer data only when opened
  useEffect(() => {
    if (isActionQueueOpen) {
      void loadActionQueue();
      void loadBulkHistory();
    }
  }, [isActionQueueOpen, loadActionQueue, loadBulkHistory]);

  // Coordinated effect: filter changes and tab switches without race conditions
  useEffect(() => {
    const filtersChanged =
      currentFiltersRef.current.store !== selectedStore ||
      currentFiltersRef.current.sku !== selectedSku ||
      currentFiltersRef.current.days !== selectedDays ||
      currentFiltersRef.current.isCustomDate !== isCustomDate ||
      currentFiltersRef.current.start !== customStartDate ||
      currentFiltersRef.current.end !== customEndDate;

    if (filtersChanged) {
      currentFiltersRef.current = {
        store: selectedStore,
        sku: selectedSku,
        days: selectedDays,
        isCustomDate,
        start: customStartDate,
        end: customEndDate,
      };
      loadedSectionsRef.current.clear();
      lastLoadedRecKeyRef.current = "";
      setSelectedCampaignForDrilldown(null);
      setSelectedAdGroupForDrilldown(null);
    }

    if (filtersChanged || !loadedSectionsRef.current.has("overview")) {
      const timer = window.setTimeout(() => void loadData(), 0);
      if (activeTab === "overview") {
        return () => {
          window.clearTimeout(timer);
          metricsRequestRef.current?.controller.abort();
        };
      }
    }

    if (activeTab !== "overview" && ["ad_groups", "targets", "skus", "search_terms"].includes(activeTab)) {
      if (!loadedSectionsRef.current.has(activeTab)) {
        void loadSection(activeTab).catch((error) => {
          notify(error instanceof Error ? error.message : "Không thể tải bảng dữ liệu PPC", "error");
        });
      }
      if (activeTab === "skus") {
        void loadSkuEconomics();
      }
    } else if (activeTab === "recommendations") {
      void loadGroupedRecommendations();
      if (actionQueue.length === 0) {
        void loadActionQueue();
      }
    } else if (skuRecGroups.length === 0 && !loadingRecs && detailCounts?.skus) {
      const preloadTimer = window.setTimeout(() => {
        void loadGroupedRecommendations();
      }, 400);
      return () => window.clearTimeout(preloadTimer);
    }
  }, [
    activeTab,
    selectedStore,
    selectedSku,
    selectedDays,
    loadData,
    loadSection,
    loadSkuEconomics,
    loadGroupedRecommendations,
    loadActionQueue,
    actionQueue.length,
  ]);

  const handleSyncR2 = async () => {
    setSyncingR2(true);
    try {
      const targetStore = selectedStore !== "ALL" ? selectedStore : undefined;
      const res = await fetch("/api/ppc/sync-r2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: targetStore, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ Cloudflare R2");

      if (data.job?.status === "COMPLETED" && !data.accepted) {
        notify(data.message || "Đã đồng bộ báo cáo mới nhất từ Cloudflare R2!", "success");
        await loadData(true);
        return;
      }

      const jobId = data.job?.id;
      if (!jobId) {
        notify(data.message || "Đã gửi yêu cầu đồng bộ R2!", "success");
        await loadData(true);
        return;
      }

      notify(data.message || "Đã đưa vào hàng đợi đồng bộ, đang xử lý ngầm...");

      // Polling kiểm tra trạng thái job
      const pollInterval = 3000;
      const maxPollTime = 300_000;
      const startTime = Date.now();

      while (Date.now() - startTime < maxPollTime) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        const statusRes = await fetch(`/api/ppc/sync-r2?jobId=${encodeURIComponent(jobId)}`);
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        const job = statusData.job;
        if (!job) continue;

        if (job.status === "COMPLETED") {
          notify(`Đồng bộ R2 hoàn tất thành công cho batch ${job.batch_id}!`, "success");
          await loadData(true);
          return;
        }

        if (job.status === "FAILED" || job.status === "CANCELLED") {
          throw new Error(job.error_message || `Đồng bộ thất bại (trạng thái ${job.status}).`);
        }
      }

      notify("Tiến trình đồng bộ đang tiếp tục chạy ngầm trên máy chủ. Bạn có thể làm mới trang sau ít phút.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Đồng bộ R2 thất bại", "error");
    } finally {
      setSyncingR2(false);
    }
  };

  const handleSyncAdsPower = async () => {
    setSyncingAdsPower(true);
    try {
      const targetStore = selectedStore !== "ALL" ? selectedStore : (stores[0]?.name || "HSOSTORE");
      const res = await fetch("/api/ppc/adspower-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: targetStore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tự động tải từ AdsPower");
      notify(
        data.message || `Đã tự động tải và nạp báo cáo mới cho shop ${targetStore}!`,
        data.success ? "success" : "error",
      );
      await loadData(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Tự động tải AdsPower thất bại", "error");
    } finally {
      setSyncingAdsPower(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("storeName", uploadStore);
      formData.append("reportDays", String(selectedDays));
      formData.append("reportEndDate", uploadEndDate);

      const res = await fetch("/api/ppc/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload thất bại");

      notify(data.message || "Nạp báo cáo PPC thành công!");
      setShowUploadModal(false);
      setUploadFile(null);
      await loadData(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi nạp file", "error");
    } finally {
      setUploading(false);
    }
  };

  // Filtered & Sorted Search Terms
  const filteredSortedSearchTerms = useMemo(() => {
    let list = [...searchTerms];

    if (matchTypeFilter !== "ALL") {
      list = list.filter((t) => t.matchType === matchTypeFilter);
    }

    if (termPerformanceFilter === "WITH_ORDERS") {
      list = list.filter((t) => t.orders > 0);
    } else if (termPerformanceFilter === "ZERO_ORDERS_BLEEDING") {
      list = list.filter((t) => t.orders === 0 && t.clicks >= 9);
    } else if (termPerformanceFilter === "HIGH_ACOS") {
      list = list.filter((t) => t.orders > 0 && t.acos > 60);
    }

    if (searchTermQuery.trim()) {
      const tokens = searchTermQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((t) => {
        const text = `${t.customerSearchTerm} ${t.campaignName} ${t.portfolioName || ""}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }

    list.sort((a, b) => {
      const valA = a[termSortField] ?? 0;
      const valB = b[termSortField] ?? 0;
      return termSortDir === "asc" ? valA - valB : valB - valA;
    });

    return list;
  }, [searchTerms, matchTypeFilter, termPerformanceFilter, searchTermQuery, termSortField, termSortDir]);

  // Paginated Search Terms
  const totalTermPages = Math.max(1, Math.ceil(filteredSortedSearchTerms.length / termPageSize));
  const paginatedSearchTerms = useMemo(() => {
    const start = (termPage - 1) * termPageSize;
    return filteredSortedSearchTerms.slice(start, start + termPageSize);
  }, [filteredSortedSearchTerms, termPage, termPageSize]);

  // Targets count per campaign map (for instant 1-click drilldown)
  const targetsPerCampaign = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of targetPerformance) {
      if (t.campaignName) {
        map.set(t.campaignName, (map.get(t.campaignName) || 0) + 1);
      }
    }
    return map;
  }, [targetPerformance]);

  // Filtered & Sorted Campaigns (Default: Active only, sorted Newest to Oldest)
  const filteredSortedCampaigns = campaignPerformance;

  // Aggregated totals for currently filtered campaigns
  const filteredCampaignTotals = useMemo(() => {
    const { spend, sales, orders, clicks, impressions } = campaignServerMeta.totals;
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    return { spend, sales, orders, clicks, impressions, ctr, acos, roas, count: campaignServerMeta.total };
  }, [campaignServerMeta]);

  // Paginated Campaigns
  const totalCampaignPages = Math.max(1, Math.ceil(campaignServerMeta.total / campaignPageSize));
  const paginatedCampaigns = filteredSortedCampaigns;

  // Filtered & Sorted Ad Groups (Level 3 in hierarchy)
  const filteredSortedAdGroups = useMemo(() => {
    let list = [...adGroupPerformance];
    if (selectedCampaignForDrilldown) {
      list = list.filter((ag) => ag.campaignName === selectedCampaignForDrilldown);
    }
    if (adGroupQuery.trim()) {
      const tokens = adGroupQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((ag) => {
        const text = `${ag.adGroupName} ${ag.campaignName} ${ag.storeName}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }
    list.sort((a, b) => {
      const valA = a[adGroupSortField];
      const valB = b[adGroupSortField];
      return adGroupSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [adGroupPerformance, selectedCampaignForDrilldown, adGroupQuery, adGroupSortField, adGroupSortDir]);

  // Paginated Ad Groups
  const totalAdGroupPages = Math.max(1, Math.ceil(filteredSortedAdGroups.length / adGroupPageSize));
  const paginatedAdGroups = useMemo(() => {
    const start = (adGroupPage - 1) * adGroupPageSize;
    return filteredSortedAdGroups.slice(start, start + adGroupPageSize);
  }, [filteredSortedAdGroups, adGroupPage, adGroupPageSize]);

  // Filtered & Sorted Targets / Keywords (Level 4 in hierarchy)
  const filteredSortedTargets = useMemo(() => {
    let list = [...targetPerformance];
    if (selectedCampaignForDrilldown) {
      list = list.filter((t) => t.campaignName === selectedCampaignForDrilldown);
    }
    if (selectedAdGroupForDrilldown) {
      list = list.filter((t) => t.adGroupName === selectedAdGroupForDrilldown);
    }
    if (targetQuery.trim()) {
      const tokens = targetQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((t) => {
        const text = `${t.targetKeyword || ""} ${t.campaignName || ""} ${t.adGroupName || ""}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }
    list.sort((a, b) => {
      const valA = a[targetSortField] ?? 0;
      const valB = b[targetSortField] ?? 0;
      return targetSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [targetPerformance, selectedCampaignForDrilldown, selectedAdGroupForDrilldown, targetQuery, targetSortField, targetSortDir]);

  // Paginated Targets
  const totalTargetPages = Math.max(1, Math.ceil(filteredSortedTargets.length / targetPageSize));
  const paginatedTargets = useMemo(() => {
    const start = (targetPage - 1) * targetPageSize;
    return filteredSortedTargets.slice(start, start + targetPageSize);
  }, [filteredSortedTargets, targetPage, targetPageSize]);

  // Pre-index search terms by stable Amazon IDs first, with normalized names as
  // a fallback for reports that omit those IDs.
  const { searchTermsByAdGroup, searchTermsByCampaign, searchTermsByCampaignId, searchTermsByAdGroupId } = useMemo(() => {
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const byAg = new Map<string, PpcSearchTermRow[]>();
    const byCamp = new Map<string, PpcSearchTermRow[]>();
    const byCampId = new Map<string, PpcSearchTermRow[]>();
    const byAgId = new Map<string, PpcSearchTermRow[]>();
    const append = (map: Map<string, PpcSearchTermRow[]>, key: string, term: PpcSearchTermRow) => {
      const list = map.get(key);
      if (list) list.push(term);
      else map.set(key, [term]);
    };
    for (const term of searchTerms) {
      const storeKey = (term.storeId || term.storeName || "").trim().toLowerCase();
      const camp = norm(term.campaignName);
      const ag = norm(term.adGroupName);
      const campaignId = (term.campaignId || "").trim();
      const adGroupId = (term.adGroupId || "").trim();

      if (campaignId) append(byCampId, campaignId, term);
      if (campaignId && adGroupId) append(byAgId, `${campaignId}\u0000${adGroupId}`, term);
      if (camp) {
        append(byCamp, `${storeKey}\u0000${camp}`, term);
        append(byCamp, camp, term);
      }

      if (camp && ag) {
        append(byAg, `${storeKey}\u0000${camp}|||${ag}`, term);
        append(byAg, `${camp}|||${ag}`, term);
      }
    }
    return {
      searchTermsByAdGroup: byAg,
      searchTermsByCampaign: byCamp,
      searchTermsByCampaignId: byCampId,
      searchTermsByAdGroupId: byAgId,
    };
  }, [searchTerms]);

  // Search terms are attributed in two layers:
  // Layer 1: Confirmed source attribution directly from Amazon reporting (Keyword ID or Targeting expression + Match Type).
  // Layer 2: Conservative inference ONLY when the search term report leaves targeting blank, requiring unambiguous sole match.
  const getChildSearchTerms = useCallback((target: PpcTargetPerformance) => {
    const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizeTarget = (val: string | undefined | null) => {
      if (!val) return "";
      let s = val.toLowerCase().trim();
      s = s.replace(/^["'\[]+|["'\]]+$/g, "").trim();
      const asinMatch = s.match(/^asin\s*=\s*["']?([a-z0-9]{10})["']?$/i);
      if (asinMatch) return asinMatch[1];
      return s.replace(/\s+/g, " ");
    };
    const normalizeMatchType = (m: string | undefined | null) => {
      const s = (m || "").toLowerCase().trim();
      if (s.includes("exact")) return "exact";
      if (s.includes("phrase")) return "phrase";
      if (s.includes("broad")) return "broad";
      if (s.includes("auto")) return "auto";
      if (s.includes("target")) return "targeting";
      return "unknown";
    };
    const isMatchTypeCompatible = (tm: string | undefined | null, targetM: string | undefined | null) => {
      const a = normalizeMatchType(tm);
      const b = normalizeMatchType(targetM);
      if (a === "unknown" || b === "unknown") return true;
      return a === b;
    };
    const lexicalNorm = (s: string) => norm(s)
      .replace(/['’]s\b/g, "")
      .replace(/\+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const id = (value: string | undefined) => (value || "").trim();
    const stopWords = new Set(["a", "an", "the", "for", "to", "my"]);
    const stemWord = (word: string) => {
      if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
      if (word.endsWith("es") && word.length > 3 && !word.endsWith("sses")) return word.slice(0, -2);
      if (word.endsWith("s") && word.length > 2 && !word.endsWith("ss")) return word.slice(0, -1);
      return word;
    };
    const canonicalTokens = (value: string) => lexicalNorm(value)
      .split(" ")
      .filter((word) => word && !stopWords.has(word))
      .map(stemWord)
      .sort();

    const targetKwNorm = normalizeTarget(target.targetKeyword);
    const targetId = id(target.targetId);
    const targetCampaignId = id(target.campaignId);
    const targetAdGroupId = id(target.adGroupId);
    const storeKey = id(target.storeId) || norm(target.storeName);
    const campNorm = norm(target.campaignName);
    const agNorm = norm(target.adGroupName);
    const isSb = target.adType === "SB";
    const isNumericAg = /^\d+$/.test(agNorm);

    // Determine candidate pool
    let candidates: PpcSearchTermRow[];
    const idAgKey = `${targetCampaignId}\u0000${targetAdGroupId}`;
    const scopedAgKey = `${storeKey}\u0000${campNorm}|||${agNorm}`;
    const rawAgKey = `${campNorm}|||${agNorm}`;
    const scopedCampKey = `${storeKey}\u0000${campNorm}`;

    if (targetCampaignId && targetAdGroupId && searchTermsByAdGroupId.has(idAgKey)) {
      candidates = searchTermsByAdGroupId.get(idAgKey)!;
    } else if (targetCampaignId && searchTermsByCampaignId.has(targetCampaignId)) {
      candidates = searchTermsByCampaignId.get(targetCampaignId)!;
    } else if (campNorm && agNorm && !isNumericAg && !isSb && (searchTermsByAdGroup.has(scopedAgKey) || searchTermsByAdGroup.has(rawAgKey))) {
      candidates = searchTermsByAdGroup.get(scopedAgKey) || searchTermsByAdGroup.get(rawAgKey)!;
    } else if (campNorm && (searchTermsByCampaign.has(scopedCampKey) || searchTermsByCampaign.has(campNorm))) {
      candidates = searchTermsByCampaign.get(scopedCampKey) || searchTermsByCampaign.get(campNorm)!;
    } else {
      candidates = searchTerms;
    }

    const isInTargetScope = (term: PpcSearchTermRow, candidate: PpcTargetPerformance) => {
      // 1. Store scope
      const termStoreId = id(term.storeId);
      const candStoreId = id(candidate.storeId);
      if (termStoreId && candStoreId && termStoreId !== candStoreId) return false;
      const termStoreName = norm(term.storeName || "");
      const candStoreName = norm(candidate.storeName || "");
      if (termStoreName && candStoreName && termStoreName !== candStoreName) return false;

      // 2. Ad Type scope (SP vs SB vs SD)
      if (term.adType && term.adType !== "UNKNOWN" && candidate.adType && candidate.adType !== "UNKNOWN" && term.adType !== candidate.adType) return false;

      // 3. Campaign scope
      const termCampId = id(term.campaignId);
      const candCampId = id(candidate.campaignId);
      const termCampName = norm(term.campaignName);
      const candCampName = norm(candidate.campaignName);
      if (termCampId && candCampId) {
        if (termCampId !== candCampId) return false;
      } else if (candCampName && termCampName && termCampName !== candCampName) {
        return false;
      }

      // 4. Ad Group scope (SB campaigns omit ad groups or have default ad group)
      const candIsSb = candidate.adType === "SB" || term.adType === "SB";
      if (!candIsSb) {
        const termAgId = id(term.adGroupId);
        const candAgId = id(candidate.adGroupId);
        const termAgName = norm(term.adGroupName);
        const candAgName = norm(candidate.adGroupName);
        const isNumeric = /^\d+$/.test(candAgName);
        if (termAgId && candAgId) {
          if (termAgId !== candAgId) return false;
        } else if (candAgName && termAgName && !isNumeric && termAgName !== candAgName) {
          return false;
        }
      }
      return true;
    };

    const matchesTargetForInference = (term: PpcSearchTermRow, candidate: PpcTargetPerformance) => {
      const candNorm = normalizeTarget(candidate.targetKeyword);
      const queryNorm = normalizeTarget(term.customerSearchTerm);
      if (!candNorm || !queryNorm) return false;

      const candMatch = normalizeMatchType(candidate.matchType);
      const candTokens = canonicalTokens(candNorm);
      const queryTokens = canonicalTokens(queryNorm);

      if (candMatch === "exact") {
        return candTokens.length === queryTokens.length && candTokens.every((word, idx) => word === queryTokens[idx]);
      }
      if (candMatch === "phrase") {
        const candWords = lexicalNorm(candNorm).split(" ").filter(Boolean).map(stemWord);
        const queryWords = lexicalNorm(queryNorm).split(" ").filter(Boolean).map(stemWord);
        if (!candWords.length || queryWords.length < candWords.length) return false;
        for (let i = 0; i <= queryWords.length - candWords.length; i++) {
          let seqMatch = true;
          for (let j = 0; j < candWords.length; j++) {
            if (queryWords[i + j] !== candWords[j]) {
              seqMatch = false;
              break;
            }
          }
          if (seqMatch) return true;
        }
        return false;
      }
      if (candMatch === "broad") {
        if (!candTokens.length) return false;
        return candTokens.every((word) => queryTokens.includes(word));
      }
      if (candMatch === "targeting") {
        return candNorm === queryNorm;
      }
      return false;
    };

    const confirmed: PpcSearchTermRow[] = [];
    const inferred: PpcSearchTermRow[] = [];

    for (const term of candidates) {
      if (!isInTargetScope(term, target)) continue;

      const termTargetId = id(term.keywordId);
      const termKwNorm = normalizeTarget(term.targetKeyword);

      // Layer 1: Confirmed attribution directly from Amazon reporting
      // 1.1 Match by Amazon Keyword / Target ID
      if (targetId && termTargetId) {
        if (targetId === termTargetId) confirmed.push(term);
        continue;
      }

      // 1.2 Match by Amazon Targeting expression + compatible Match Type
      if (termKwNorm) {
        if (termKwNorm === targetKwNorm && isMatchTypeCompatible(term.matchType, target.matchType)) {
          confirmed.push(term);
        }
        // If term already has an Amazon target that doesn't match this target, do not steal it.
        continue;
      }

      // Layer 2: Conservative inference ONLY when the term has NO targetKeyword in report.
      // Prevent hallucinations ("ảo giác") by requiring unambiguous sole matching target.
      const plausibleTargets = targetPerformance.filter((candidate) =>
        isInTargetScope(term, candidate) && matchesTargetForInference(term, candidate),
      );
      const uniqueTargets = new Map<string, PpcTargetPerformance>();
      for (const cand of plausibleTargets) {
        const key = id(cand.targetId) || [
          id(cand.campaignId), id(cand.adGroupId), normalizeTarget(cand.targetKeyword), normalizeMatchType(cand.matchType),
        ].join("\u0000");
        if (!uniqueTargets.has(key)) uniqueTargets.set(key, cand);
      }
      const soleTarget = uniqueTargets.size === 1 ? Array.from(uniqueTargets.values())[0] : undefined;
      if (soleTarget) {
        const soleKey = id(soleTarget.targetId) || normalizeTarget(soleTarget.targetKeyword);
        const thisKey = targetId || targetKwNorm;
        if (soleKey === thisKey && isMatchTypeCompatible(soleTarget.matchType, target.matchType)) {
          inferred.push(term);
        }
      }
    }
    return { confirmed, inferred };
  }, [searchTerms, searchTermsByAdGroup, searchTermsByCampaign, searchTermsByCampaignId, searchTermsByAdGroupId, targetPerformance]);

  // Filtered & Sorted SKUs
  const activeSkuPerformance = useMemo(() => {
    return hidePausedSkus
      ? skuPerformance.filter((s) => s.impressions > 0 || s.clicks > 0 || s.spend > 0)
      : skuPerformance;
  }, [skuPerformance, hidePausedSkus]);

  const filteredSortedSkus = useMemo(() => {
    let list = [...activeSkuPerformance];
    if (skuCategoryFilter !== "ALL") {
      if (skuCategoryFilter === "ZERO_CLICKS") {
        list = list.filter((s) => s.clicks === 0);
      } else if (skuCategoryFilter === "ZERO_SPEND") {
        list = list.filter((s) => s.spend === 0);
      } else {
        list = list.filter((s) => s.skuCategory === skuCategoryFilter);
      }
    }
    if (skuQuery.trim()) {
      const tokens = skuQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((s) => {
        const text = `${s.sku} ${s.storeName}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }
    list.sort((a, b) => {
      const valA = a[skuSortField];
      const valB = b[skuSortField];
      return skuSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [activeSkuPerformance, skuCategoryFilter, skuQuery, skuSortField, skuSortDir]);

  // Paginated SKUs
  const totalSkuPages = Math.max(1, Math.ceil(filteredSortedSkus.length / skuPageSize));
  const paginatedSkus = useMemo(() => {
    const start = (skuPage - 1) * skuPageSize;
    return filteredSortedSkus.slice(start, start + skuPageSize);
  }, [filteredSortedSkus, skuPage, skuPageSize]);

  // Chart Data: Top 7 Campaigns by Spend
  const topCampaignChartData = useMemo(() => {
    if (campaignPerformance.length > 0) {
      return campaignPerformance.slice(0, 7).map((c) => ({
        name: c.campaignName.length > 20 ? `${c.campaignName.slice(0, 18)}...` : c.campaignName,
        spend: c.spend,
        sales: c.sales,
        acos: c.acos > 150 ? 150 : c.acos,
      }));
    }
    return [];
  }, [campaignPerformance]);

  // Chart Data: Target Type Spend Distribution
  const targetTypePieData = useMemo(() => {
    if (targetTypeBreakdown.length > 0) {
      return targetTypeBreakdown
        .filter((t) => t.spend > 0)
        .map((t) => ({
          name: t.targetType,
          value: t.spend,
          sales: t.sales,
          spendShare: t.spendShare,
          color: TARGET_TYPE_COLORS[t.targetType] || "#94a3b8",
        }));
    }
    return [];
  }, [targetTypeBreakdown]);

  // Chart Data: Keyword Match Type Spend Distribution (Exact, Phrase, Broad)
  const keywordMatchTypePieData = useMemo(() => {
    if (keywordMatchTypeBreakdown.length > 0) {
      return keywordMatchTypeBreakdown
        .filter((m) => m.spend > 0)
        .map((m) => ({
          name: m.matchType,
          value: m.spend,
          sales: m.sales,
          spendShare: m.spendShare,
          color: KEYWORD_MATCH_TYPE_COLORS[m.matchType] || "#94a3b8",
        }));
    }
    return [];
  }, [keywordMatchTypeBreakdown]);

  // Chart Data: Legacy Match Type Spend & Sales Share
  const matchTypePieData = useMemo(() => {
    if (matchTypeBreakdown.length > 0) {
      return matchTypeBreakdown.map((m) => ({
        name: m.matchType,
        value: m.spend,
        sales: m.sales,
        spendShare: m.spendShare,
        color: MATCH_TYPE_COLORS[m.matchType] || "#94a3b8",
      }));
    }
    return [];
  }, [matchTypeBreakdown]);

  // Sort Handler Helper
  const handleSort = <T extends string>(
    field: T,
    currentField: T,
    currentDir: SortDirection,
    setField: (f: T) => void,
    setDir: (d: SortDirection) => void,
    resetPage?: () => void
  ) => {
    if (currentField === field) {
      setDir(currentDir === "asc" ? "desc" : "asc");
    } else {
      setField(field);
      setDir("desc");
    }
    resetPage?.();
  };

  // Checkbox Selection
  const toggleTermSelect = (term: PpcSearchTermRow) => {
    const key = searchTermKey(term);
    const next = new Set(selectedTerms);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedTerms(next);
  };

  const toggleSelectAllVisible = () => {
    const visibleKeys = paginatedSearchTerms.map(searchTermKey);
    if (visibleKeys.length > 0 && visibleKeys.every((key) => selectedTerms.has(key))) {
      const next = new Set(selectedTerms);
      visibleKeys.forEach((key) => next.delete(key));
      setSelectedTerms(next);
    } else {
      setSelectedTerms(new Set([...selectedTerms, ...visibleKeys]));
    }
  };

  const handleCopySelected = async () => {
    const list = selectedTerms.size > 0
      ? filteredSortedSearchTerms.filter((term) => selectedTerms.has(searchTermKey(term))).map((term) => term.customerSearchTerm)
      : filteredSortedSearchTerms.map((t) => t.customerSearchTerm);
    if (list.length === 0) return;
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      notify(`Đã copy ${list.length} từ khóa vào clipboard!`);
    } catch {
      notify("Trình duyệt không cho phép ghi vào clipboard.", "error");
    }
  };

  // CSV Exporter
  const handleExportCsv = async (type: "search_terms" | "campaigns" | "skus") => {
    let header = "";
    let rows: string[] = [];
    let filename = "";

    if (type === "search_terms") {
      header = "Customer Search Term,Match Type,SKU / Portfolio,Campaign,Clicks,Spend ($),Sales ($),Orders,CTR (%),CVR (%),ACOS (%)\n";
      rows = filteredSortedSearchTerms.map((t) => {
        const termSafe = `"${t.customerSearchTerm.replace(/"/g, '""')}"`;
        const portSafe = `"${(t.portfolioName || "").replace(/"/g, '""')}"`;
        const campSafe = `"${t.campaignName.replace(/"/g, '""')}"`;
        return `${termSafe},"${t.matchType}",${portSafe},${campSafe},${t.clicks},${t.spend.toFixed(2)},${t.sales.toFixed(2)},${t.orders},${(t.ctr * 100).toFixed(2)},${(t.cvr * 100).toFixed(1)},${t.acos.toFixed(1)}`;
      });
      filename = `ppc-search-terms-${Date.now()}.csv`;
    } else if (type === "campaigns") {
      const params = new URLSearchParams({
        storeName: selectedStore, sku: selectedSku, days: String(selectedDays), query: campaignQuery,
        status: campaignStatusFilter, adType: campaignFormatFilter, spendFilter: campaignSpendFilter,
        groupFilter: campaignGroupFilter, targetAcos: String(targetAcos), sortField: campaignSortField,
        sortDirection: campaignSortDir, page: "1", pageSize: "20000", export: "1",
      });
      const exportResponse = await fetch(`/api/ppc/campaigns?${params}`, { cache: "no-store" });
      if (!exportResponse.ok) {
        notify("Không thể tải toàn bộ Campaign để xuất CSV.", "error");
        return;
      }
      const exportData = await exportResponse.json();
      const exportCampaigns: PpcCampaignPerformance[] = exportData.campaigns || [];
      header = "Campaign Name,Store,Targeting,Spend ($),Sales ($),Orders,Clicks,CPC ($),CTR (%),CVR (%),ACOS (%),ROAS\n";
      rows = exportCampaigns.map((c) => {
        const campSafe = `"${c.campaignName.replace(/"/g, '""')}"`;
        return `${campSafe},"${c.storeName}","${c.targetingType}",${c.spend.toFixed(2)},${c.sales.toFixed(2)},${c.orders},${c.clicks},${c.cpc.toFixed(2)},${c.ctr.toFixed(2)},${c.cvr.toFixed(1)},${c.acos.toFixed(1)},${c.roas.toFixed(2)}`;
      });
      const firstCamp = exportCampaigns[0];
      const autoSku = selectedSku !== "ALL" ? selectedSku : (firstCamp ? extractSkuFromText(firstCamp.campaignName) || "" : "");
      const autoTitle = firstCamp?.campaignName ? firstCamp.campaignName.replace(/^([A-Z0-9]+\s+)+/, "").trim() : "Campaigns";
      filename = formatPpcExportFilename({
        title: autoTitle || "Campaigns",
        sku: autoSku || undefined,
        campaignName: firstCamp?.campaignName,
        adType: firstCamp?.adType || "SP",
        days: selectedDays,
        fileType: "Campaign File",
        extension: "csv",
      });
    } else {
      header = "SKU,Store,Tier,Impressions,Clicks,CTR (%),Spend ($),Sales ($),Orders,CVR (%),ACOS (%),ROAS\n";
      rows = filteredSortedSkus.map((s) => {
        const tier = s.skuCategory === "HERO" ? "Hero" : s.skuCategory === "BLEEDING" ? "Bleeding" : s.skuCategory === "POTENTIAL" ? "Potential" : s.clicks === 0 ? "0 Clicks" : "Neutral";
        return `"${s.sku}","${s.storeName}","${tier}",${s.impressions || 0},${s.clicks},${(s.ctr || 0).toFixed(2)},${s.spend.toFixed(2)},${s.sales.toFixed(2)},${s.orders},${s.cvr.toFixed(1)},${s.acos.toFixed(1)},${s.roas.toFixed(2)}`;
      });
      filename = `ppc-skus-${Date.now()}.csv`;
    }

    const blob = new Blob(["\uFEFF" + header + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Đã xuất file ${filename}!`);
  };

  return (
    <div className={`w-full space-y-4 text-slate-800 ${!isEmbedded ? "max-w-7xl mx-auto p-6" : ""}`}>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-bold border animate-in fade-in ${toast.type === "error" ? "bg-rose-900 border-rose-700" : "bg-slate-900 border-slate-700"}`}>
          {toast.type === "error" ? <X size={16} weight="bold" className="text-rose-200 shrink-0" /> : <CheckCircle size={16} weight="fill" className="text-emerald-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* TOP CONTROL BAR (Executive Header) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <ChartLineUp size={22} weight="duotone" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-slate-900 tracking-tight">
                  Amazon PPC Seller Dashboard
                </h2>
                {selectedStore === "ALL" ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Multi-Store Live
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                    <Storefront size={12} weight="bold" />
                    <span>Store: {selectedStore}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                {selectedStore === "ALL"
                  ? "Tổng quan hiệu suất quảng cáo đa store"
                  : `Phân tích chuyên sâu chiến dịch cho store ${selectedStore}`}
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 self-stretch lg:self-auto justify-end flex-wrap">
            {(selectedStore !== "ALL" || activeTab !== "overview") && (
              <button
                type="button"
                onClick={() => {
                  setSelectedStore("ALL");
                  setSelectedSku("ALL");
                  setActiveTab("overview");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/90 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer shadow-2xs"
                title="Quay lại giao diện thống kê so sánh tất cả các store"
              >
                <Storefront size={14} weight="bold" />
                <span>← Tất cả Store</span>
              </button>
            )}
            {!isEmbedded && (
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
              >
                ← Workspace
              </Link>
            )}

            <button
              type="button"
              onClick={handleSyncAdsPower}
              disabled={syncingAdsPower}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-700 transition cursor-pointer disabled:opacity-60"
              title="Tự động kết nối trình duyệt AdsPower, click tải báo cáo mới nhất từ Amazon và nạp thẳng vào Dashboard"
            >
              <ArrowsClockwise size={14} className={syncingAdsPower ? "animate-spin" : ""} weight="bold" />
              <span>{syncingAdsPower ? "Đang tải AdsPower..." : "Tự động AdsPower"}</span>
            </button>

            <button
              type="button"
              onClick={handleSyncR2}
              disabled={syncingR2}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer disabled:opacity-60"
            >
              <ArrowsClockwise size={14} className={syncingR2 ? "animate-spin" : ""} weight="bold" />
              <span>{syncingR2 ? "Đang đồng bộ..." : "Đồng bộ R2"}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition cursor-pointer"
            >
              <UploadSimple size={14} className="text-sky-600" weight="bold" />
              <span>Nạp báo cáo PPC</span>
            </button>

            <button
              type="button"
              onClick={() => setShowFileManagerModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs"
              title="Quản lý và xóa triệt để file trên Server & Cloudflare R2"
            >
              <FolderSimple size={14} className="text-amber-600" weight="bold" />
              <span>Quản lý File</span>
            </button>

            <a
              href={`/api/ppc/seed?storeName=${encodeURIComponent(selectedStore !== "ALL" ? selectedStore : "Bozspacer")}`}
              download
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition cursor-pointer"
              title="Tải template Excel chuẩn"
            >
              <Download size={14} weight="bold" />
              <span>Template</span>
            </a>

            <PpcNotificationPopover onRefreshParent={() => void loadData(true)} />
          </div>
        </div>

        {/* Filters: Store, SKU & Compact Data Status */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Store Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <Storefront size={15} className="text-indigo-600" weight="duotone" />
              <span className="text-slate-500 font-semibold text-[11px]">Store:</span>
              <select
                value={selectedStore}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedStore(val);
                  setSelectedSku("ALL");
                  if (val === "ALL") {
                    setActiveTab("overview");
                  }
                }}
                className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs"
              >
                <option value="ALL">All Stores ({stores.length})</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name === "HSOSTORE" ? "HSOSTORE (Brand: Warmstorey)" : s.name} ({s.marketplace}) - Target {s.targetAcos}%
                  </option>
                ))}
              </select>
            </div>

            {/* Nút Quản Lý Store */}
            <button
              type="button"
              onClick={() => setShowStoreManagerModal(true)}
              className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer shadow-2xs"
              title="Quản lý danh sách, chỉnh sửa hoặc xóa store"
            >
              <Gear size={13} weight="bold" className="text-slate-500" />
              <span className="hidden sm:inline">Quản Lý Store</span>
            </button>

            {/* SKU Filter (Chỉ hiển thị khi đã chọn 1 shop cụ thể) */}
            {selectedStore !== "ALL" && availableSkus.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <Tag size={15} className="text-emerald-600" weight="duotone" />
                <span className="text-slate-500 font-semibold text-[11px]">SKU:</span>
                <select
                  value={selectedSku}
                  onChange={(e) => setSelectedSku(e.target.value)}
                  className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs max-w-[180px] truncate"
                >
                  <option value="ALL">All SKUs ({availableSkus.length})</option>
                  {availableSkus.map((sku) => (
                    <option key={sku} value={sku}>
                      {sku}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-slate-500 font-semibold text-[11px]">Date:</span>
              <select
                value={isCustomDate ? "custom" : selectedDays}
                onChange={(event) => {
                  if (event.target.value === "custom") {
                    setIsCustomDate(true);
                  } else {
                    setIsCustomDate(false);
                    setSelectedDays(Number(event.target.value));
                  }
                }}
                className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs"
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={60}>Last 60 Days</option>
                <option value={90}>Last 90 Days</option>
                {isCustomDate && (
                  <option value="custom">
                    Tùy chọn ({customStartDate && customEndDate ? `${customStartDate.slice(5).replace("-", "/")}—${customEndDate.slice(5).replace("-", "/")}` : "..."})
                  </option>
                )}
              </select>
            </div>

            {dateRangeStart && dateRangeEnd && (
              <div className="flex items-center gap-1.5 bg-indigo-50/80 border border-indigo-200/80 rounded-lg px-2.5 py-1 text-xs text-indigo-950 font-bold" title="Khoảng thời gian dữ liệu thực tế đang phân tích">
                <CalendarBlank size={14} className="text-indigo-600 shrink-0" weight="bold" />
                <span>
                  {dateRangeStart.split("-").reverse().join("/")} — {dateRangeEnd.split("-").reverse().join("/")}
                </span>
              </div>
            )}
          </div>

          {/* Right: Compact Data Status (Chỉ hiển thị khi đang soi 1 store cụ thể) */}
          {loading && !dataHealth ? (
            <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              <span>Đang tải số liệu…</span>
            </div>
          ) : selectedStore !== "ALL" && dataHealth ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <div className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium border ${dataHealth.campaignRows > 0
                ? "bg-emerald-50/80 text-emerald-800 border-emerald-200/60"
                : "bg-amber-50 text-amber-800 border-amber-200"
                }`} title="Bulk Performance Campaigns">
                <span className="text-slate-500 font-normal">Bulk:</span>
                <span className="font-bold">{dataHealth.campaignRows.toLocaleString()} camps</span>
              </div>

              <div className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium border ${dataHealth.searchTermRows > 0
                ? "bg-sky-50/80 text-sky-800 border-sky-200/60"
                : "bg-slate-50 text-slate-600 border-slate-200"
                }`} title="Search Term Report Rows">
                <span className="text-slate-500 font-normal">Search:</span>
                <span className="font-bold">{dataHealth.searchTermRows.toLocaleString()}</span>
              </div>

              <div className="inline-flex items-center gap-1 rounded-md bg-indigo-50/70 border border-indigo-200/60 px-2 py-0.5 font-medium text-indigo-800" title="Targets Active">
                <span className="text-slate-500 font-normal">Targets:</span>
                <span className="font-bold">{dataHealth.targetRows.toLocaleString()}</span>
              </div>

              <div className="inline-flex items-center gap-1 text-slate-500 ml-1">
                <span className="text-[10px] text-slate-400">Sync:</span>
                <span className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-[10px]">
                  {formatSyncTime(lastSyncedAt)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {!loading && searchTerms.length === 0 && (!dataHealth || dataHealth.performanceRows === 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Chưa có dữ liệu PPC trong {selectedDays} ngày gần nhất.</strong>{" "}
          Hãy nạp Bulk SP/SB và Search Term SP/SB hoặc đồng bộ từ R2. Hệ thống không tự chèn dữ liệu mẫu.
        </div>
      )}

      {/* SKELETON LOADING STATE */}
      {loading && !summary && (
        <PpcOverviewSkeleton />
      )}

      {/* NẾU ĐANG Ở CHẾ ĐỘ XEM TẤT CẢ SHOP VÀ TAB TỔNG QUAN: HIỂN THỊ GIAO DIỆN MULTI-STORE HUB */}
      {selectedStore === "ALL" && activeTab === "overview" && (
        <PpcMultiStoreView
          storeSummaries={storeSummaries}
          summary={summary}
          dailyTrends={dailyTrends}
          adTypeBreakdown={adTypeBreakdown}
          searchTerms={searchTerms}
          selectedDays={selectedDays}
          onDaysChange={(days) => {
            setIsCustomDate(false);
            setSelectedDays(days);
          }}
          isCustomDate={isCustomDate}
          startDate={customStartDate}
          endDate={customEndDate}
          onCustomDateChange={(start, end) => {
            setCustomStartDate(start);
            setCustomEndDate(end);
            setIsCustomDate(true);
          }}
          dateRangeStart={dateRangeStart || undefined}
          dateRangeEnd={dateRangeEnd || undefined}
          onSelectStore={(storeName) => {
            setSelectedStore(storeName);
            setSelectedSku("ALL");
          }}
          onRefreshStores={() => void loadData(true)}
          currency="$"
        />
      )}

      {/* EXECUTIVE KPI CARDS (KHI XEM 1 SHOP HOẶC KHI CHUYỂN CÁC TAB KHÁC) */}
      {(selectedStore !== "ALL" || activeTab !== "overview") && summary && ((dataHealth?.campaignRows || 0) > 0 || searchTerms.length > 0) && (
        <div className="space-y-3">
          {(dataHealth?.campaignRows || 0) === 0 && searchTerms.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-sky-50 border border-sky-200 px-4 py-2.5 text-xs text-sky-900 font-medium">
              <span className="flex h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              <span>
                Chưa có Bulk Operations cho kỳ đang chọn. Search Term Report chỉ được dùng trong mục Search Term, Wasted Spend và Harvest; KPI và biểu đồ không lấy số thay thế từ báo cáo này.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            {/* SPEND */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                SPEND
              </span>
              <div className="text-xl font-black text-slate-900 mt-0.5 truncate">
                ${summary.totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Avg: <strong className="text-slate-800">${(summary.totalSpend / effectiveReportDays).toFixed(1)}/d</strong>
              </div>
            </div>

            {/* SALES */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                SALES
              </span>
              <div className="text-xl font-black text-emerald-600 mt-0.5 truncate">
                ${summary.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Avg: <strong className="text-slate-800">${(summary.totalSales / effectiveReportDays).toFixed(1)}/d</strong>
              </div>
            </div>

            {/* ORDERS */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                ORDERS
              </span>
              <div className="text-xl font-black text-slate-900 mt-0.5">
                {summary.totalOrders.toLocaleString()}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Units: <strong className="text-slate-800">{summary.totalUnits.toLocaleString()}</strong>
              </div>
            </div>

            {/* ACOS */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                ACOS
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span
                  className={`text-xl font-black ${summary.blendedAcos <= targetAcos
                    ? "text-emerald-600"
                    : summary.blendedAcos <= 35
                      ? "text-teal-600"
                      : summary.blendedAcos <= 50
                        ? "text-amber-600"
                        : "text-rose-600"
                    }`}
                >
                  {summary.blendedAcos.toFixed(1)}%
                </span>
                <span
                  className={`text-[9px] font-bold px-1 rounded uppercase ${summary.blendedAcos <= targetAcos
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                    }`}
                >
                  {summary.blendedAcos <= targetAcos ? "PASS" : "HIGH"}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Target: <strong className="text-slate-800">{targetAcos.toFixed(1)}%</strong>
              </div>
            </div>

            {/* IMPRESSIONS */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                IMPRESSIONS
              </span>
              <div className="text-xl font-black text-slate-900 mt-0.5">
                {summary.totalImpressions.toLocaleString()}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Avg: <strong className="text-slate-800">{(summary.totalImpressions / effectiveReportDays).toLocaleString(undefined, { maximumFractionDigits: 0 })}/d</strong>
              </div>
            </div>

            {/* CLICKS */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                CLICKS
              </span>
              <div className="text-xl font-black text-slate-800 mt-0.5">
                {summary.totalClicks.toLocaleString()}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Avg: <strong className="text-slate-800">{(summary.totalClicks / effectiveReportDays).toFixed(1)}/d</strong>
              </div>
            </div>

            {/* CPC */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                CPC
              </span>
              <div className="text-xl font-black text-slate-900 mt-0.5">
                ${summary.avgCpc.toFixed(2)}
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Cost / Click
              </div>
            </div>

            {/* CVR */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                CVR
              </span>
              <div className="text-xl font-black text-indigo-600 mt-0.5">
                {(summary.overallCvr * 100).toFixed(1)}%
              </div>
              <div className="text-[11px] font-semibold text-slate-500 mt-1">
                Conv. Rate
              </div>
            </div>
          </div>

          {/* AD TYPE BREAKDOWN & TRAFFIC ROW (1 dòng tinh gọn) */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-2xs overflow-x-auto">
            {/* Left: Ad Type Pills */}
            <div className="flex items-center gap-2 shrink-0">
              {adTypeBreakdown.map((item) => {
                const isSp = item.adType === "SP";
                const isSb = item.adType === "SB";
                const badgeClass = isSp
                  ? "bg-amber-500 text-white"
                  : isSb
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-700 text-white";
                const label = isSp ? "Sponsored Products" : isSb ? "Sponsored Brands" : item.adType;

                return (
                  <div
                    key={item.adType}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs shadow-2xs"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider ${badgeClass}`}
                      title={label}
                    >
                      {item.adType}
                    </span>

                    <div className="flex items-center gap-2.5">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold mr-1">{item.adType} Spend</span>
                        <strong className="text-slate-900 font-black">
                          ${item.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </strong>
                      </div>

                      <div className="h-3 w-px bg-slate-200" />

                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold mr-1">Sales</span>
                        <strong className="text-emerald-700 font-black">
                          ${item.sales.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </strong>
                      </div>

                      <div className="h-3 w-px bg-slate-200" />

                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold mr-1">ACOS</span>
                        <strong className={`font-black ${item.acos <= targetAcos ? "text-emerald-600" : "text-amber-600"}`}>
                          {item.acos > 500 ? "0 sales" : `${item.acos.toFixed(1)}%`}
                        </strong>
                      </div>

                      <div className="h-3 w-px bg-slate-200" />

                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold mr-1">Orders</span>
                        <strong className="text-slate-800 font-bold">
                          {item.orders.toLocaleString()}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: Traffic Group (Impressions + CTR) */}
            <div className="flex items-center gap-2.5 shrink-0 pl-3 border-l border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">
                  TRAFFIC
                </span>
                <div className="h-3 w-px bg-slate-200" />
              </div>

              <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs shadow-2xs">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold mr-1.5">Impressions</span>
                  <strong className="text-slate-900 font-black">
                    {summary.totalImpressions.toLocaleString()}
                  </strong>
                </div>

                <div className="h-3 w-px bg-slate-200" />

                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold mr-1.5">CTR</span>
                  <strong className="text-indigo-600 font-black">
                    {(summary.overallCtr * 100).toFixed(2)}%
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VELOCITY & MULTI-PERIOD COMPARISON MONITOR */}
      {velocity && (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-sky-50/70 p-4 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-600 text-white shadow-xs">
                <ChartLineUp size={18} weight="bold" />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900">
                  Spend Velocity &amp; Trend (Last 7d vs {velocity.baselineDays}d baseline)
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Daily Spend: <strong className="text-slate-800">${velocity.recentDailySpend.toFixed(2)}/day</strong> (baseline ${velocity.baselineDailySpend.toFixed(2)}/day)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3.5">
              {/* Spend Growth */}
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Spend Growth</span>
                <span className={`text-xs font-black ${velocity.spendGrowthRate > 15 ? "text-rose-600" : velocity.spendGrowthRate < -10 ? "text-slate-600" : "text-emerald-600"}`}>
                  {velocity.spendGrowthRate > 0 ? `+${velocity.spendGrowthRate}%` : `${velocity.spendGrowthRate}%`}
                </span>
              </div>

              {/* ACOS Delta */}
              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">ACOS Delta</span>
                <span className={`text-xs font-black ${velocity.acosDelta > 3 ? "text-rose-600" : velocity.acosDelta < -2 ? "text-emerald-600" : "text-slate-800"}`}>
                  {velocity.acosDelta > 0 ? `+${velocity.acosDelta}%` : `${velocity.acosDelta}%`} (7d: {velocity.recentAcos.toFixed(1)}%)
                </span>
              </div>

              {/* Status Badge */}
              <span className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wide border ${velocity.trendStatus === "ACCELERATING_EFFICIENCY"
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : velocity.trendStatus === "OVERSPENDING_RISK"
                  ? "bg-rose-100 text-rose-800 border-rose-200"
                  : velocity.trendStatus === "COOLING_DOWN"
                    ? "bg-slate-100 text-slate-700 border-slate-200"
                    : "bg-indigo-50 text-indigo-700 border-indigo-100"
                }`}>
                {velocity.trendStatus === "ACCELERATING_EFFICIENCY" && "🚀 High Efficiency"}
                {velocity.trendStatus === "OVERSPENDING_RISK" && "⚠️ Overspending Risk"}
                {velocity.trendStatus === "COOLING_DOWN" && "❄️ Spend Decreasing"}
                {velocity.trendStatus === "STABLE" && "⚖️ Stable"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 2 BIỂU ĐỒ CỐT LÕI PPC DASHBOARD THEO SPEC KỸ THUẬT (KHI XEM 1 SHOP HOẶC CHUYỂN TAB) */}
      {(selectedStore !== "ALL" || activeTab !== "overview") && mounted && summary && ((dataHealth?.campaignRows || 0) > 0 || searchTerms.length > 0) && (
        <div className="space-y-4">
          {/* BIỂU ĐỒ 1: Spend vs Revenue / ROAS theo thời gian */}
          {dailyTrends.length > 0 ? <PpcTimeSeriesChart
            summary={summary}
            summary7D={summary7D}
            adTypeBreakdown7D={adTypeBreakdown7D}
            dailyTrends={dailyTrends}
            selectedDays={selectedDays}
            onDaysChange={(days) => {
              setIsCustomDate(false);
              setSelectedDays(days);
            }}
            isCustomDate={isCustomDate}
            startDate={customStartDate}
            endDate={customEndDate}
            onCustomDateChange={(start, end) => {
              setCustomStartDate(start);
              setCustomEndDate(end);
              setIsCustomDate(true);
            }}
            dateRangeStart={dateRangeStart || undefined}
            dateRangeEnd={dateRangeEnd || undefined}
            adTypeBreakdown={adTypeBreakdown}
            targetAcos={targetAcos}
            currency="$"
            storeName={selectedStore}
          /> : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              Chưa có Bulk Campaign snapshot theo từng ngày cho kỳ này. Hệ thống không dùng Search Term Report hoặc chia đều snapshot nhiều ngày để tạo số liệu giả.
            </div>
          )}

          {/* BIỂU ĐỒ 2: So sánh hiệu suất theo dạng chạy */}
          <PpcPerformanceRankingChart
            campaigns={overviewCampaigns.length > 0 ? overviewCampaigns : campaignPerformance}
            targetAcos={targetAcos}
            currency="$"
          />
        </div>
      )}

      {/* DATA SLICING SUB-TABS (Bóc tách dữ liệu theo kiến trúc 5 tầng + SKU song song - ẨN KHI Ở TỔNG QUAN TẤT CẢ SHOP) */}
      {(selectedStore !== "ALL" || activeTab !== "overview") && (
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/60 rounded-xl border border-slate-200/80 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "overview"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <ChartLineUp size={15} weight={activeTab === "overview" ? "bold" : "regular"} />
          <span>1. Tổng Quan</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("campaigns")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "campaigns"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <FolderSimple size={15} weight={activeTab === "campaigns" ? "bold" : "regular"} />
          <span>2. Campaign ({detailCounts?.campaigns !== undefined ? detailCounts.campaigns.toLocaleString("vi-VN") : (loading ? "..." : campaignPerformance.length.toLocaleString("vi-VN"))})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("targets")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "targets"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <Crosshair size={15} weight={activeTab === "targets" ? "bold" : "regular"} />
          <span>3. Target / Keyword ({detailCounts?.targets !== undefined ? detailCounts.targets.toLocaleString("vi-VN") : (loading ? "..." : targetPerformance.length.toLocaleString("vi-VN"))})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("search_terms")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "search_terms"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <MagnifyingGlass size={15} weight={activeTab === "search_terms" ? "bold" : "regular"} />
          <span>4. Search Terms ({detailCounts?.searchTerms !== undefined ? detailCounts.searchTerms.toLocaleString("vi-VN") : (loading ? "..." : searchTerms.length.toLocaleString("vi-VN"))})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("skus")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "skus"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <Tag size={15} weight={activeTab === "skus" ? "bold" : "regular"} />
          <span>5. SKU ({detailCounts?.skus !== undefined ? detailCounts.skus.toLocaleString("vi-VN") : (loading ? "..." : activeSkuPerformance.length.toLocaleString("vi-VN"))})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("recommendations")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "recommendations"
            ? "bg-white text-emerald-700 shadow-xs border border-emerald-100"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <span>6. Đề Xuất ({skuRecGroups.length > 0 ? `${skuRecGroups.length.toLocaleString("vi-VN")} SKU` : (detailCounts?.skus !== undefined ? `${detailCounts.skus.toLocaleString("vi-VN")} SKU` : (loadingRecs ? "..." : "0 SKU"))})</span>
        </button>

        {/* Action Queue Quick Trigger */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsActionQueueOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-extrabold transition cursor-pointer shadow-2xs"
            title="Mở Action Queue"
          >
            <Clock size={15} weight="bold" />
            <span>Action Queue</span>
            <span className="px-1.5 py-0.2 rounded-full bg-sky-600 text-white text-[10px] font-extrabold">
              {pendingActionCount}
            </span>
          </button>
        </div>
      </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: OVERVIEW SUMMARY TABLE (CHỈ HIỂN THỊ KHI ĐANG XEM 1 SHOP CỤ THỂ) */}
      {/* ========================================================================= */}
      {activeTab === "overview" && selectedStore !== "ALL" && (
        <div className="space-y-3">
          {/* Quick High-Impact Table: Top Converting vs Bleeding Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top 5 Best Performers */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <h4 className="text-xs font-black uppercase text-emerald-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Top Profitable Search Terms (ACOS &le; {targetAcos.toFixed(1)}%)
                  <span className="normal-case text-[9px] font-semibold text-slate-400">Nguồn: Search Term Report</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setTermPerformanceFilter("WITH_ORDERS");
                    setActiveTab("search_terms");
                  }}
                  className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                >
                  View all →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                      <th className="py-1.5">Search Term</th>
                      <th className="py-1.5 text-right">Orders</th>
                      <th className="py-1.5 text-right">Spend</th>
                      <th className="py-1.5 text-right">Sales</th>
                      <th className="py-1.5 text-right">ACOS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {searchTerms
                      .filter((t) => t.orders >= 2 && t.acos <= targetAcos)
                      .slice(0, 5)
                      .map((t, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-1.5 font-bold text-slate-800 max-w-[160px] truncate">
                            {t.customerSearchTerm}
                          </td>
                          <td className="py-1.5 text-right font-black text-slate-900">{t.orders}</td>
                          <td className="py-1.5 text-right text-slate-600">${t.spend.toFixed(2)}</td>
                          <td className="py-1.5 text-right font-black text-emerald-600">${t.sales.toFixed(2)}</td>
                          <td className="py-1.5 text-right font-bold text-emerald-700">{t.acos.toFixed(1)}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 5 Bleeding Terms (Zero orders) */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <h4 className="text-xs font-black uppercase text-rose-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Top Bleeding Terms (0 Orders, Clicks &ge; 9)
                  <span className="normal-case text-[9px] font-semibold text-slate-400">Nguồn: Search Term Report</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setTermPerformanceFilter("ZERO_ORDERS_BLEEDING");
                    setActiveTab("search_terms");
                  }}
                  className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  Review &amp; Negate →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                      <th className="py-1.5">Search Term</th>
                      <th className="py-1.5 text-right">Clicks</th>
                      <th className="py-1.5 text-right">Spend</th>
                      <th className="py-1.5 text-right">CVR</th>
                      <th className="py-1.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {searchTerms
                      .filter((t) => t.clicks >= 9 && t.orders === 0)
                      .slice(0, 5)
                      .map((t, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-1.5 font-bold text-slate-800 max-w-[160px] truncate">
                            {t.customerSearchTerm}
                          </td>
                          <td className="py-1.5 text-right font-black text-rose-700">{t.clicks}</td>
                          <td className="py-1.5 text-right font-black text-slate-900">${t.spend.toFixed(2)}</td>
                          <td className="py-1.5 text-right text-slate-400">0%</td>
                          <td className="py-1.5 text-right">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">
                              0 ORDERS
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: BREAKDOWN BY CAMPAIGN */}
      {/* ========================================================================= */}
      {activeTab === "campaigns" && (
        <div id="ppc-campaigns-section" className="space-y-3.5 scroll-mt-6">
          {/* Campaign Search & Filter Toolbar (Single Clean Row) */}
          <div className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs text-xs">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1 min-w-0">
              {/* Search input with clear button */}
              <div className="relative min-w-[220px] flex-1">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={campaignQuery}
                  onChange={(e) => {
                    setCampaignQuery(e.target.value);
                    setCampaignPage(1);
                  }}
                  placeholder="Tìm tên campaign hoặc SKU..."
                  className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600 transition"
                />
                {campaignQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCampaignQuery("");
                      setCampaignPage(1);
                    }}
                    className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X size={13} weight="bold" />
                  </button>
                )}
              </div>

              {/* Status segmented control: Active (default) / Paused / Tất cả */}
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-bold shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setCampaignStatusFilter("ACTIVE");
                    setCampaignPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition cursor-pointer ${campaignStatusFilter === "ACTIVE"
                    ? "bg-white text-emerald-700 shadow-2xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Active ({campaignServerMeta.activeCount.toLocaleString("vi-VN")})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCampaignStatusFilter("PAUSED");
                    setCampaignPage(1);
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition cursor-pointer ${campaignStatusFilter === "PAUSED"
                    ? "bg-white text-amber-700 shadow-2xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                    }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span>Paused ({campaignServerMeta.pausedCount.toLocaleString("vi-VN")})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCampaignStatusFilter("ALL");
                    setCampaignPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${campaignStatusFilter === "ALL"
                    ? "bg-white text-indigo-700 shadow-2xs font-extrabold"
                    : "text-slate-600 hover:text-slate-900"
                    }`}
                >
                  Tất cả ({(campaignServerMeta.activeCount + campaignServerMeta.pausedCount).toLocaleString("vi-VN")})
                </button>
              </div>

              {/* Format Filter */}
              <select
                value={campaignFormatFilter}
                onChange={(e) => {
                  setCampaignFormatFilter(e.target.value);
                  setCampaignPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-indigo-600 cursor-pointer shrink-0 hidden sm:block"
              >
                <option value="ALL">Định dạng (Tất cả)</option>
                <option value="SP">Sponsored Products (SP)</option>
                <option value="SB">Sponsored Brands (SB)</option>
                <option value="SD">Sponsored Display (SD)</option>
              </select>

              {/* Sort Dropdown */}
              <select
                value={`${campaignSortField}_${campaignSortDir}`}
                onChange={(e) => {
                  const [f, d] = e.target.value.split("_") as [SortField, SortDirection];
                  setCampaignSortField(f);
                  setCampaignSortDir(d);
                  setCampaignPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-indigo-600 cursor-pointer shrink-0"
              >
                <option value="date_desc">Ngày campaign: Mới nhất</option>
                <option value="date_asc">Ngày campaign: Cũ nhất</option>
                <option value="spend_desc">Chi tiêu: Cao → Thấp</option>
                <option value="sales_desc">Doanh số: Cao → Thấp</option>
                <option value="orders_desc">Đơn hàng: Nhiều → Ít</option>
                <option value="acos_desc">ACOS: Cao → Thấp</option>
                <option value="impressions_desc">Hiển thị: Nhiều → Ít</option>
              </select>

              {/* Reset button if filter active */}
              {(campaignQuery ||
                campaignStatusFilter !== "ACTIVE" ||
                campaignGroupFilter !== "ALL" ||
                campaignFormatFilter !== "ALL" ||
                campaignSpendFilter !== "ALL" ||
                campaignSortField !== "date" ||
                campaignSortDir !== "desc") && (
                  <button
                    type="button"
                    onClick={() => {
                      setCampaignQuery("");
                      setCampaignStatusFilter("ACTIVE");
                      setCampaignGroupFilter("ALL");
                      setCampaignFormatFilter("ALL");
                      setCampaignSpendFilter("ALL");
                      setCampaignSortField("date");
                      setCampaignSortDir("desc");
                      setCampaignPage(1);
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                    title="Đặt lại bộ lọc về mặc định"
                  >
                    <X size={13} weight="bold" /> Đặt lại
                  </button>
                )}
            </div>

            <button
              type="button"
              onClick={() => handleExportCsv("campaigns")}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Download size={14} /> Xuất CSV
            </button>
          </div>

          {/* Live Metrics Strip for Filtered Campaigns (Tone Xanh - Trắng) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 p-2.5 rounded-xl bg-gradient-to-r from-blue-50/80 via-indigo-50/50 to-sky-50/60 border border-blue-100 shadow-2xs text-xs">
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Số Campaign</div>
              <div className="text-base font-black text-slate-900 mt-0.5">{filteredCampaignTotals.count.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                {campaignStatusFilter === "ACTIVE" ? "Active" : campaignStatusFilter === "PAUSED" ? "Paused" : "Tất cả"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Lượt Hiển Thị (Impr)</div>
              <div className="text-base font-black text-slate-900 mt-0.5">{filteredCampaignTotals.impressions.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                CTR {filteredCampaignTotals.ctr.toFixed(2)}% · {filteredCampaignTotals.clicks.toLocaleString()} clicks
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Tổng Chi Tiêu</div>
              <div className="text-base font-black text-rose-600 mt-0.5">${filteredCampaignTotals.spend.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                CPC ${filteredCampaignTotals.clicks > 0 ? (filteredCampaignTotals.spend / filteredCampaignTotals.clicks).toFixed(2) : "0.00"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Doanh Số</div>
              <div className="text-base font-black text-emerald-600 mt-0.5">${filteredCampaignTotals.sales.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 font-medium">{filteredCampaignTotals.orders} đơn hàng</div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Đơn Hàng</div>
              <div className="text-base font-black text-indigo-700 mt-0.5">{filteredCampaignTotals.orders}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                {filteredCampaignTotals.clicks > 0
                  ? `${((filteredCampaignTotals.orders / filteredCampaignTotals.clicks) * 100).toFixed(1)}% CVR`
                  : "0% CVR"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">ACOS Trung Bình</div>
              <div
                className={`text-base font-black mt-0.5 ${filteredCampaignTotals.acos <= targetAcos
                  ? "text-emerald-600"
                  : filteredCampaignTotals.acos <= 50
                    ? "text-amber-600"
                    : "text-rose-600"
                  }`}
              >
                {filteredCampaignTotals.sales > 0 ? `${filteredCampaignTotals.acos.toFixed(1)}%` : "N/A"}
              </div>
              <div className="text-[10px] text-slate-500 font-medium">Mục tiêu ≤ {targetAcos}%</div>
            </div>
          </div>

          {/* Campaigns Data Table */}
          <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs transition-opacity ${loadingCampaignPage ? "opacity-60" : "opacity-100"}`} aria-busy={loadingCampaignPage}>
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5 min-w-[280px]">Campaign Name</th>
                  <th className="py-3 px-3">Store</th>
                  <th className="py-3 px-3">Ad / Targeting</th>
                  <th className="py-3 px-3">State / Budget</th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("date", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                    title="Ngày được suy ra từ mã ngày trong tên campaign; nhấn để sắp xếp"
                  >
                    Ngày campaign {campaignSortField === "date" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("impressions", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                    title="Nhấn để sắp xếp theo lượt hiển thị (Impressions)"
                  >
                    Hiển Thị {campaignSortField === "impressions" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("clicks", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                  >
                    Clicks {campaignSortField === "clicks" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("ctr", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                    title="Tỷ lệ click trên lượt hiển thị (CTR = Clicks / Impressions)"
                  >
                    CTR (%) {campaignSortField === "ctr" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                  >
                    Spend ($) {campaignSortField === "spend" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                  >
                    Sales ($) {campaignSortField === "sales" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                  >
                    Orders {campaignSortField === "orders" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">CPC</th>
                  <th className="py-3 px-3 text-right">CVR</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir, () => setCampaignPage(1))
                    }
                  >
                    ACOS (%) {campaignSortField === "acos" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredSortedCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <FolderSimple size={24} className="text-slate-300" />
                        <span className="font-semibold text-slate-600">Không tìm thấy campaign phù hợp bộ lọc</span>
                        <span className="text-xs text-slate-400 max-w-md">
                          Thử đổi bộ lọc sang &quot;Paused&quot; hoặc &quot;Tất cả&quot;, hoặc xóa từ khóa tìm kiếm.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedCampaigns.map((c, i) => {
                    const rawDate = extractCampaignDate(c.campaignName);
                    const dateStr = rawDate > 0 ? String(rawDate) : "";
                    const formattedDate =
                      dateStr.length === 8
                        ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
                        : "—";

                    return (
                      <tr key={i} className="hover:bg-slate-50/80 transition group">
                        {/* Campaign Name: Clickable to view Targets directly */}
                        <td className="py-2.5 px-3.5 min-w-[280px] max-w-[550px]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCampaignForDrilldown(c.campaignName);
                              setSelectedAdGroupForDrilldown(null);
                              setTargetQuery("");
                              setTargetPage(1);
                              setActiveTab("targets");
                            }}
                            className="text-left font-bold text-slate-900 hover:text-indigo-600 hover:underline cursor-pointer transition leading-snug break-words block"
                            title="Nhấn để xem các Target / Keyword của Campaign này"
                          >
                            {c.campaignName}
                          </button>
                        </td>

                        <td className="py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">{c.storeName}</td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {c.adType || "?"} · {c.targetingType}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                          <div className="font-bold text-slate-700 flex items-center gap-1">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${!/pause|archive/i.test(c.state || "") ? "bg-emerald-500" : "bg-amber-500"
                                }`}
                            />
                            <span>{c.state || "—"}</span>
                          </div>
                          <div>{c.dailyBudget ? `$${c.dailyBudget.toFixed(2)}/day` : "No budget"}</div>
                        </td>

                        {/* Creation Date */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-[11px] font-mono text-slate-600">
                          {formattedDate !== "—" ? (
                            <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-700 font-bold">
                              {formattedDate}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Impressions */}
                        <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap font-mono">
                          {(c.impressions || 0).toLocaleString()}
                        </td>

                        {/* Clicks */}
                        <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap font-mono">
                          {(c.clicks || 0).toLocaleString()}
                        </td>

                        {/* CTR */}
                        <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap font-mono">
                          {c.ctr ? `${c.ctr.toFixed(2)}%` : "0.00%"}
                        </td>

                        <td className="py-2.5 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                          ${c.spend.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-emerald-600 whitespace-nowrap">
                          ${c.sales.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900 whitespace-nowrap">{c.orders}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">${c.cpc.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap">{c.cvr.toFixed(1)}%</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${c.acos <= Math.min(20, targetAcos)
                              ? "bg-emerald-50 text-emerald-700"
                              : c.acos <= targetAcos
                                ? "bg-teal-50 text-teal-700"
                                : c.acos <= 50
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                          >
                            {c.acos > 500 ? "0 sales" : `${c.acos.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PpcPagination
            currentPage={campaignPage}
            totalPages={totalCampaignPages}
            pageSize={campaignPageSize}
            totalItems={campaignServerMeta.total}
            pageSizeOptions={[15, 25, 50, 100, 200]}
            itemName="campaign"
            onPageChange={setCampaignPage}
            onPageSizeChange={(size) => {
              setCampaignPageSize(size);
              setCampaignPage(1);
            }}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: BREAKDOWN BY TARGET / KEYWORD (Level 4 Hierarchy + Search Term 2-Layer) */}
      {/* ========================================================================= */}
      {activeTab === "targets" && (
        <div className="space-y-3">
          {/* Active drilldown banner */}
          {(selectedCampaignForDrilldown || selectedAdGroupForDrilldown) && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs shadow-2xs">
              <div className="flex flex-wrap items-center gap-2 text-indigo-900 font-semibold">
                <span className="px-2 py-0.5 rounded bg-indigo-600 text-white font-black text-[11px]">
                  🎯 Đang xem Target / Keyword của:
                </span>
                {selectedCampaignForDrilldown && (
                  <span className="font-extrabold text-indigo-950 bg-white px-2.5 py-1 rounded-md border border-indigo-200 shadow-2xs">
                    Chiến dịch: {selectedCampaignForDrilldown}
                  </span>
                )}
                {selectedAdGroupForDrilldown && (
                  <span className="font-extrabold text-indigo-950 bg-white px-2.5 py-1 rounded-md border border-indigo-200 shadow-2xs">
                    Nhóm QC: {selectedAdGroupForDrilldown}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("campaigns")}
                  className="px-3 py-1.5 rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 font-bold text-xs flex items-center gap-1 shadow-2xs cursor-pointer transition"
                >
                  ← Quay lại Campaign
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCampaignForDrilldown(null);
                    setSelectedAdGroupForDrilldown(null);
                  }}
                  className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-semibold cursor-pointer underline"
                >
                  ✕ Xem tất cả Targets ({detailCounts?.targets ?? targetPerformance.length})
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
              Target / Keyword Performance
            </h3>

            <div className="relative w-full sm:w-80">
              <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={targetQuery}
                onChange={(e) => {
                  setTargetQuery(e.target.value);
                  setTargetPage(1);
                }}
                placeholder="Tìm theo keyword, tên campaign hoặc SKU..."
                className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600 transition"
              />
              {targetQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setTargetQuery("");
                    setTargetPage(1);
                  }}
                  className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Xóa tìm kiếm"
                >
                  <X size={13} weight="bold" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full min-w-[1300px] text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
                <tr>
                  <th className="px-3.5 py-3 text-left">Target / Keyword</th>
                  <th className="px-3 py-3 text-left">Campaign</th>
                  <th className="px-3 py-3 text-left">Type</th>
                  <th className="px-3 py-3 text-left">State</th>
                  <th className="px-3 py-3 text-right">Bid</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("impressions", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                    title="Nhấn để sắp xếp theo lượt hiển thị (Impressions)"
                  >
                    Hiển Thị {targetSortField === "impressions" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("clicks", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                  >
                    Clicks {targetSortField === "clicks" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("ctr", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                    title="Tỷ lệ click trên lượt hiển thị (CTR = Clicks / Impressions)"
                  >
                    CTR (%) {targetSortField === "ctr" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                  >
                    Spend ($) {targetSortField === "spend" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                  >
                    Sales ($) {targetSortField === "sales" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                  >
                    Orders {targetSortField === "orders" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-3 py-3 text-right">CPC</th>
                  <th className="px-3 py-3 text-right">CVR</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir)
                    }
                  >
                    ACOS (%) {targetSortField === "acos" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-3.5 py-3 text-center whitespace-nowrap min-w-[125px] sticky right-0 z-20 bg-slate-50 border-l border-slate-200 shadow-[-4px_0_8px_rgba(0,0,0,0.04)]">
                    Search Terms
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingSection === "targets" ? (
                  <tr>
                    <td colSpan={15} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải danh sách Target / Keyword...</span>
                        <span className="text-[11px] text-slate-400">Đang tải dữ liệu từ máy chủ, vui lòng đợi trong giây lát</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredSortedTargets.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-xs text-slate-400">
                      {targetQuery ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="font-semibold text-slate-600">
                            Không tìm thấy target nào khớp với &quot;{targetQuery}&quot;
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setTargetQuery("");
                              setTargetPage(1);
                            }}
                            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                          >
                            ✕ Xóa từ khóa tìm kiếm
                          </button>
                        </div>
                      ) : selectedCampaignForDrilldown ? (
                        <span className="font-semibold text-slate-500">
                          Chiến dịch này chưa có target trong kỳ đang chọn.
                        </span>
                      ) : (
                        <span>Chưa có target trong kỳ đang chọn.</span>
                      )}
                    </td>
                  </tr>
                ) : paginatedTargets.map((target) => {
                  const targetKey = [
                    target.storeId || target.storeName,
                    target.adType,
                    target.campaignId || target.campaignName,
                    target.adGroupId || target.adGroupName,
                    target.targetId || target.targetKeyword,
                    target.matchType,
                  ].join("\u0000");
                  const isExpanded = expandedTargetKey === targetKey;
                  const childTerms = isExpanded ? (() => {
                    const res = getChildSearchTerms(target);
                    return [...res.confirmed, ...res.inferred].sort(
                      (a, b) => b.spend - a.spend || b.orders - a.orders || b.clicks - a.clicks,
                    );
                  })() : [];

                  return (
                    <Fragment key={targetKey}>
                      <tr className={`group transition ${isExpanded ? "bg-indigo-50/40" : "hover:bg-slate-50/80"}`}>
                        <td className="px-3.5 py-2.5 font-bold text-slate-900 min-w-[180px]">
                          <div className="break-words leading-snug" title={target.targetKeyword}>{target.targetKeyword}</div>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700 min-w-[260px]">
                          <div className="break-words leading-snug" title={target.campaignName}>{target.campaignName}</div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{target.adType} · {target.matchType}</span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-[11px] font-bold text-slate-500">{target.state || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-black text-slate-800 whitespace-nowrap">{target.currentBid ? `$${target.currentBid.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{(target.impressions || 0).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600 whitespace-nowrap">{(target.clicks || 0).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{target.ctr ? `${target.ctr.toFixed(2)}%` : "0.00%"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 whitespace-nowrap">${target.spend.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-black text-emerald-600 whitespace-nowrap">${target.sales.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 whitespace-nowrap">{target.orders}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600 whitespace-nowrap">${target.cpc.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{target.cvr.toFixed(1)}%</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-black whitespace-nowrap ${target.acos <= targetAcos ? "text-emerald-700" : "text-rose-700"}`}>
                          {target.acos > 500 ? "0 sales" : `${target.acos.toFixed(1)}%`}
                        </td>
                        <td className={`px-3.5 py-2.5 text-center whitespace-nowrap min-w-[125px] sticky right-0 z-10 border-l border-slate-200 shadow-[-4px_0_8px_rgba(0,0,0,0.04)] transition ${
                          isExpanded ? "bg-indigo-50" : "bg-white group-hover:bg-slate-50"
                        }`}>
                          <button
                            type="button"
                            onClick={() => setExpandedTargetKey(isExpanded ? null : targetKey)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer border shrink-0 ${isExpanded
                              ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                              : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200"
                              }`}
                            title="Xem các customer search terms do target này kích hoạt"
                          >
                            <MagnifyingGlass size={12} weight="bold" />
                            <span>{isExpanded ? "Đóng Terms" : "Xem Terms"}</span>
                            <span className="text-[9px]">{isExpanded ? "▲" : "▼"}</span>
                          </button>
                        </td>
                      </tr>

                      {/* Inline Expandable Layer 2: Search Term Breakdown (Clean & Minimalist) */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 border-b border-slate-200">
                          <td colSpan={15} className="p-3">
                            {childTerms.length === 0 ? (
                              <div className="p-3 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                                Không có customer search term nào phát sinh click trong kỳ báo cáo.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-2xs">
                                <table className="w-full text-left text-xs text-slate-700">
                                  <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                    <tr>
                                      <th className="py-2 px-3.5">Customer Search Term</th>
                                      <th className="py-2 px-2.5 text-right">Hiển Thị</th>
                                      <th className="py-2 px-2.5 text-right">Clicks</th>
                                      <th className="py-2 px-2.5 text-right">Spend ($)</th>
                                      <th className="py-2 px-2.5 text-right">Sales ($)</th>
                                      <th className="py-2 px-2.5 text-right">Orders</th>
                                      <th className="py-2 px-2.5 text-right">CVR</th>
                                      <th className="py-2 px-2.5 text-right">ACOS</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 font-medium">
                                    {childTerms.map((term, tIdx) => (
                                      <tr key={`${searchTermKey(term)}-${tIdx}`} className="hover:bg-slate-50/80 transition">
                                        <td className="py-2 px-3.5 font-bold text-slate-900">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span>{term.customerSearchTerm}</span>
                                            {term.matchType && term.matchType !== "Unknown" && (
                                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                                                {term.matchType}
                                              </span>
                                            )}
                                            {!term.targetKeyword && (
                                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200" title="Từ khóa suy luận do báo cáo gốc của Amazon thiếu cột Targeting">
                                                Suy luận
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td className="py-2 px-2.5 text-right font-mono text-slate-600">{(term.impressions || 0).toLocaleString()}</td>
                                        <td className="py-2 px-2.5 text-right font-mono text-slate-600">{term.clicks}</td>
                                        <td className="py-2 px-2.5 text-right font-mono text-slate-900">${term.spend.toFixed(2)}</td>
                                        <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-600">${term.sales.toFixed(2)}</td>
                                        <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">{term.orders}</td>
                                        <td className="py-2 px-2.5 text-right font-mono text-slate-600">{(term.cvr * 100).toFixed(1)}%</td>
                                        <td className="py-2 px-2.5 text-right font-mono">
                                          <span
                                            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${term.orders === 0
                                              ? "text-rose-600 bg-rose-50"
                                              : term.acos <= targetAcos
                                                ? "text-emerald-700 bg-emerald-50"
                                                : "text-amber-700 bg-amber-50"
                                              }`}
                                          >
                                            {term.orders === 0 ? "0 sales" : `${term.acos.toFixed(1)}%`}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PpcPagination
            currentPage={targetPage}
            totalPages={totalTargetPages}
            pageSize={targetPageSize}
            totalItems={filteredSortedTargets.length}
            pageSizeOptions={[15, 25, 50, 100]}
            itemName="targets"
            onPageChange={setTargetPage}
            onPageSizeChange={(size) => {
              setTargetPageSize(size);
              setTargetPage(1);
            }}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 5: HIỆU SUẤT QUẢNG CÁO SKU */}
      {/* ========================================================================= */}
      {activeTab === "skus" && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="relative flex-1 sm:w-72">
              <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={skuQuery}
                onChange={(e) => {
                  setSkuQuery(e.target.value);
                  setSkuPage(1);
                }}
                placeholder="Tìm SKU hoặc Store..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>

            <div className="flex items-center gap-3 self-end sm:self-auto">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold cursor-pointer select-none bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition">
                <input
                  type="checkbox"
                  checked={hidePausedSkus}
                  onChange={(e) => setHidePausedSkus(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Ẩn SKU tạm dừng (0 Imp)</span>
              </label>

              <button
                type="button"
                onClick={() => handleExportCsv("skus")}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">SKU / Portfolio</th>
                  <th className="py-3 px-2.5">Store</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("impressions", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Hiển Thị {skuSortField === "impressions" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("clicks", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Clicks {skuSortField === "clicks" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-2 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("ctr", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    CTR (%) {skuSortField === "ctr" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("spend", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Spend ($) {skuSortField === "spend" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("sales", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Sales ($) {skuSortField === "sales" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("orders", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Orders {skuSortField === "orders" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">CVR</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("acos", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    ACOS (%) {skuSortField === "acos" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {loadingSection === "skus" ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải danh sách SKU...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedSkus.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-xs text-slate-400">
                      Không tìm thấy SKU nào trong kỳ đang chọn.
                    </td>
                  </tr>
                ) : (
                  paginatedSkus.map((s, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 px-3.5 font-bold text-slate-900 flex items-center gap-2">
                      <Tag size={14} className="text-indigo-600 shrink-0" />
                      <span className="truncate max-w-[280px]" title={s.sku}>{s.sku}</span>
                    </td>
                    <td className="py-2.5 px-2.5 text-slate-600">{s.storeName}</td>
                    <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                      {s.impressions ? s.impressions.toLocaleString() : "0"}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-bold ${s.clicks === 0 ? "text-slate-400" : "text-slate-900"}`}>
                      {s.clicks}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-500 font-medium">
                      {s.impressions > 0 ? `${(s.ctr || 0).toFixed(2)}%` : "-"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">${s.spend.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-600">${s.sales.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">{s.orders}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{s.clicks > 0 ? `${s.cvr.toFixed(1)}%` : "-"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${s.spend === 0
                          ? "bg-slate-50 text-slate-400"
                          : s.acos <= Math.min(20, targetAcos)
                            ? "bg-emerald-50 text-emerald-700"
                            : s.acos <= targetAcos
                              ? "bg-teal-50 text-teal-700"
                              : s.acos <= 50
                                ? "bg-amber-50 text-amber-700"
                                : "bg-rose-50 text-rose-700"
                          }`}
                      >
                        {s.spend === 0 ? "-" : s.acos > 500 ? "0 sales" : `${s.acos.toFixed(1)}%`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PpcPagination
            currentPage={skuPage}
            totalPages={totalSkuPages}
            pageSize={skuPageSize}
            totalItems={filteredSortedSkus.length}
            pageSizeOptions={[15, 25, 50, 100]}
            itemName="SKU"
            onPageChange={setSkuPage}
            onPageSizeChange={(size) => {
              setSkuPageSize(size);
              setSkuPage(1);
            }}
          />
        </div>
      )}



      {/* ========================================================================= */}
      {/* VIEW 5: CUSTOMER SEARCH TERMS REPORT (Full Drill-Down) */}
      {/* ========================================================================= */}
      {activeTab === "search_terms" && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-col lg:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 sm:w-64">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTermQuery}
                  onChange={(e) => {
                    setSearchTermQuery(e.target.value);
                    setTermPage(1);
                    setSelectedTerms(new Set());
                  }}
                  placeholder="Lọc từ khóa khách gõ, campaign..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
                />
              </div>

              {/* Match Type Filter */}
              <select
                value={matchTypeFilter}
                onChange={(e) => {
                  setMatchTypeFilter(e.target.value);
                  setTermPage(1);
                  setSelectedTerms(new Set());
                }}
                className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                <option value="ALL">Tất cả Match Type</option>
                <option value="Exact">Exact</option>
                <option value="Phrase">Phrase</option>
                <option value="Broad">Broad</option>
                <option value="Auto">Auto</option>
                <option value="Targeting">Targeting</option>
              </select>

              {/* Performance Filter */}
              <select
                value={termPerformanceFilter}
                onChange={(e) => {
                  setTermPerformanceFilter(e.target.value as typeof termPerformanceFilter);
                  setTermPage(1);
                  setSelectedTerms(new Set());
                }}
                className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                <option value="ALL">Tất cả Hiệu Suất ({detailCounts?.searchTerms ?? searchTerms.length})</option>
                <option value="WITH_ORDERS">Đã Ra Đơn (Orders &gt; 0)</option>
                <option value="ZERO_ORDERS_BLEEDING">Cắn Tiền 0 Đơn (Clicks &ge; 9)</option>
                <option value="HIGH_ACOS">ACOS Cao (&gt; 60%)</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 w-full lg:w-auto justify-end">
              <button
                type="button"
                onClick={handleCopySelected}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Copy size={13} />
                <span>{selectedTerms.size > 0 ? `Copy (${selectedTerms.size})` : "Copy Tất Cả"}</span>
              </button>

              <button
                type="button"
                onClick={() => handleExportCsv("search_terms")}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={13} /> Xuất CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={paginatedSearchTerms.length > 0 && paginatedSearchTerms.every((term) => selectedTerms.has(searchTermKey(term)))}
                      onChange={toggleSelectAllVisible}
                      className="rounded border-slate-300 accent-indigo-600"
                    />
                  </th>
                  <th className="py-3 px-3">Customer Search Term</th>
                  <th className="py-3 px-3">Ad Type</th>
                  <th className="py-3 px-3">Match Type</th>
                  <th className="py-3 px-3">Campaign</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("impressions", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                    title="Nhấn để sắp xếp theo lượt hiển thị (Impressions)"
                  >
                    Hiển Thị {termSortField === "impressions" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("clicks", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Clicks {termSortField === "clicks" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("ctr", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                    title="Tỷ lệ click trên lượt hiển thị (CTR = Clicks / Impressions)"
                  >
                    CTR (%) {termSortField === "ctr" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Spend ($) {termSortField === "spend" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Sales ($) {termSortField === "sales" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Orders {termSortField === "orders" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("cvr", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    CVR (%) {termSortField === "cvr" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    ACOS (%) {termSortField === "acos" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {loadingSection === "search_terms" ? (
                  <tr>
                    <td colSpan={13} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải dữ liệu Search Terms...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedSearchTerms.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-8 text-center text-slate-400 font-sans font-medium">
                      Không tìm thấy từ khóa nào phù hợp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  paginatedSearchTerms.map((t, idx) => {
                    const isSelected = selectedTerms.has(searchTermKey(t));
                    let rowBg = isSelected ? "bg-indigo-50/50" : "";
                    if (t.orders >= 2 && t.acos <= targetAcos) rowBg = isSelected ? "bg-emerald-100/50" : "bg-emerald-50/30";
                    else if (t.clicks >= 9 && t.orders === 0) rowBg = isSelected ? "bg-rose-100/50" : "bg-rose-50/30";

                    return (
                      <tr key={idx} className={`hover:bg-slate-50/90 transition ${rowBg}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleTermSelect(t)}
                            className="rounded border-slate-300 accent-indigo-600"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-sans font-bold text-slate-900 min-w-[180px] break-words">
                          {t.customerSearchTerm}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[10px] font-black text-indigo-700">{t.adType || "?"}</td>
                        <td className="py-2.5 px-3 font-sans">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {t.matchType}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-sans min-w-[240px] break-words leading-snug">
                          {t.campaignName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-700">{(t.impressions || 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-800">{t.clicks}</td>
                        <td className="py-2.5 px-3 text-right text-slate-500">{t.ctr ? `${(t.ctr * 100).toFixed(2)}%` : "0.00%"}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">${t.spend.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-black text-emerald-600">${t.sales.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900">{t.orders}</td>
                        <td className="py-2.5 px-3 text-right text-slate-700">{(t.cvr * 100).toFixed(1)}%</td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          <span
                            className={`${t.orders === 0 && t.clicks >= 9
                              ? "text-rose-700 font-black"
                              : t.orders > 0 && t.acos <= targetAcos
                                ? "text-emerald-700 font-black"
                                : "text-slate-800"
                              }`}
                          >
                            {t.acos > 500 ? "0 sales" : `${t.acos.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PpcPagination
            currentPage={termPage}
            totalPages={totalTermPages}
            pageSize={termPageSize}
            totalItems={filteredSortedSearchTerms.length}
            pageSizeOptions={[15, 25, 50, 100]}
            itemName="từ khóa tìm kiếm"
            onPageChange={setTermPage}
            onPageSizeChange={(size) => {
              setTermPageSize(size);
              setTermPage(1);
            }}
          />
        </div>
      )}



      {activeTab === "recommendations" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <PpcSkuRecommendationGroupView
            groups={skuRecGroups}
            allRecommendations={skuRecAllRecs}
            isLoading={loadingRecs}
            recommendationWindowDays={selectedDays}
            loadedRecommendationWindowDays={loadedRecommendationWindowDays}
            onRecommendationWindowChange={(days) => {
              setIsCustomDate(false);
              setSelectedDays(days);
            }}
            onLoadSkuRecommendations={loadSkuRecommendationDetails}
            onApproveToQueue={handleApproveToQueue}
            onOpenActionQueue={() => setIsActionQueueOpen(true)}
            pendingQueueCount={pendingActionCount}
            actionQueue={actionQueue}
          />
        </div>
      )}

      {/* MODAL UPLOAD EXCEL FILE */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                  <UploadSimple size={18} weight="bold" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">Nạp Báo Cáo Amazon Ads</h3>
                  <p className="text-[11px] font-medium text-slate-500">Bulk SP/SB (.xlsx) hoặc Search Term SP/SB (.xlsx, .csv)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="p-5 space-y-4 text-xs font-medium">
              <div>
                <label className="block text-slate-700 font-bold mb-1.5">Gán Cho Store:</label>
                <input
                  list="ppc-store-options"
                  value={uploadStore}
                  onChange={(e) => setUploadStore(e.target.value)}
                  maxLength={80}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 font-bold outline-none cursor-pointer"
                />
                <datalist id="ppc-store-options">
                  {stores.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name === "HSOSTORE" ? "HSOSTORE (Brand: Warmstorey)" : s.name} ({s.marketplace})
                    </option>
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1.5">Chọn báo cáo PPC:</label>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block font-bold text-slate-700">Kỳ báo cáo:</label>
                  <select
                    value={selectedDays}
                    onChange={(event) => setSelectedDays(Number(event.target.value))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-bold text-slate-900 outline-none"
                  >
                    {[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} ngày</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block font-bold text-slate-700">Ngày kết thúc:</label>
                  <input
                    type="date"
                    value={uploadEndDate}
                    onChange={(event) => setUploadEndDate(event.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-bold text-slate-900 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {uploading ? "Đang xử lý..." : "Bắt đầu nạp"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ACTION QUEUE DRAWER & BULK EXPORT WIZARD */}
      <PpcActionQueueDrawer
        isOpen={isActionQueueOpen}
        onClose={() => setIsActionQueueOpen(false)}
        actions={actionQueue}
        onRemoveAction={handleRemoveAction}
        onRemoveActions={handleRemoveActions}
        onExportBulk={handleExportBulk}
        bulkHistory={bulkHistory}
        onRefreshBulkHistory={() => void loadBulkHistory()}
        storeName={selectedStore === "ALL" ? (stores[0]?.name || "HSOSTORE") : selectedStore}
        storeId={stores.find((s) => s.name === selectedStore)?.id || stores[0]?.id}
        onRefreshActionQueue={() => void loadActionQueue()}
      />

      {/* FILE MANAGER MODAL (SERVER & R2 PURGE) */}
      <PpcFileManagerModal
        isOpen={showFileManagerModal}
        onClose={() => setShowFileManagerModal(false)}
        onDataChanged={() => void loadData(true)}
      />

      {/* ADD STORE MODAL */}
      <PpcAddStoreModal
        isOpen={showAddStoreModal}
        onClose={() => setShowAddStoreModal(false)}
        onStoreCreated={(newStore) => {
          notify(`Đã tạo store "${newStore.name}" (${newStore.marketplace}) thành công!`, "success");
          void loadData(true);
          setSelectedStore(newStore.name);
          setSelectedSku("ALL");
        }}
      />

      {/* STORE MANAGER MODAL */}
      <PpcStoreManagerModal
        isOpen={showStoreManagerModal}
        onClose={() => setShowStoreManagerModal(false)}
        onStoreSelected={(name) => {
          void loadData(true);
          setSelectedStore(name);
          setSelectedSku("ALL");
        }}
        onNavigateToCostMaster={(name) => {
          void loadData(true);
          setSelectedStore(name);
          setSelectedSku("ALL");
          setActiveTab("settings");
          setSettingsSubTab("phoi");
        }}
      />
    </div>
  );
}
