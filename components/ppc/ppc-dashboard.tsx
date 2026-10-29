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
  UserCircle,
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
  DotsThreeVertical,
  CaretDown,
  Check,
  Info,
  Scales,
  List as ListIcon,
} from "@phosphor-icons/react";
import { AccountMenu } from "@/components/account-menu";
import { PpcStCampaignRollupView } from "./ppc-st-campaign-rollup-view";
import { PpcBidOutcomesView } from "./ppc-bid-outcomes-view";
import { PpcStOptimizationView } from "./ppc-st-optimization-view";
import { PpcSaleKwView } from "./ppc-sale-kw-view";
import { PpcPagination } from "./ppc-pagination";
import {
  extractSkuFromText,
  extractCampaignDate,
  formatPpcExportFilename,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import { PpcSkuEconomicsTable } from "./ppc-sku-economics-table";
import { PpcSkuMappingPanel } from "./ppc-sku-mapping-panel";
import { PpcSkuRecommendationGroupView } from "./ppc-sku-recommendation-group";
import { PpcActionQueueDrawer } from "./ppc-action-queue-drawer";
import { PpcFloatingActionQueue } from "./ppc-floating-action-queue";
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
import { PpcCopyButton } from "./ppc-copy-button";
import { PpcSearchVolumeCell, PpcOrganicRankCell, PpcSponsoredRankCell } from "./ppc-search-volume";
import { PpcKeywordGroupRows, PpcSummaryTableHead, usePpcSummarySort, useKeywordGroupSelection, type KeywordGroupRow } from "./ppc-keyword-group-rows";
import { PpcSkuTrendModal } from "./ppc-sku-trend-modal";
import { PpcSearchTermLaunchPanel } from "./ppc-search-term-launch-panel";
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
  PpcSkuDailyTrendPoint,
} from "@/lib/ppc/types";

import type { RequestActor } from "@/lib/auth";
import { usePpcFrozenColumns } from "./use-ppc-frozen-columns";

interface PpcDashboardProps {
  isEmbedded?: boolean;
  initialTab?: "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "st_campaigns" | "st_optimization" | "sale_kw" | "alerts" | "recommendations" | "outcomes" | "settings";
  initialSubTab?: "phoi" | "rules" | "history";
  initialStore?: string;
  actor?: RequestActor;
  navNonce?: number;
  standaloneTab?: "st_campaigns" | "st_optimization" | "sale_kw" | "recommendations" | "outcomes";
  activeTabProp?: "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "st_campaigns" | "st_optimization" | "sale_kw" | "alerts" | "recommendations" | "outcomes" | "settings";
  onTabChange?: (tab: string) => void;
  onOpenMobileNav?: () => void;
  headerTitle?: string;
}

interface PpcDetailCounts {
  campaigns: number;
  adGroups: number;
  targets: number;
  skus: number;
  searchTerms: number;
}

interface PpcOverviewAttentionSku {
  sku: string;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  breakEvenAcos: number;
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

function getOptimizedThumbnailUrl(url: string | null | undefined, w = 64): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.includes("media-amazon.com") || trimmed.includes("images-amazon.com")) {
    // Amazon CDN dynamic resizing: replace existing modifier or insert before extension
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

const STORE_SCOPED_TABS = new Set<string>(["campaigns", "ad_groups", "targets", "skus", "match_types", "search_terms", "st_campaigns"]);

// Dòng tổng phía trên bảng: bỏ mã SKU khỏi nội dung tìm kiếm, chỉ hiện phần keyword (không có thì "Tất cả …")
function querySummaryLabel(query: string, allLabel: string): string {
  const words = query.trim().split(/\s+/).filter((word) => word && !(/^[a-z0-9-]{6,}$/i.test(word) && /[a-z]/i.test(word) && /\d/.test(word)));
  return words.length > 0 ? words.join(" ") : allLabel;
}

function searchTermKey(term: PpcSearchTermRow): string {
  return [
    term.id, term.storeName, term.adType, term.reportDate, term.portfolioName, term.campaignName,
    term.adGroupName, term.targetKeyword, term.customerSearchTerm, term.matchType,
  ].filter(Boolean).join("\u0000");
}

type SearchTermSkuSummary = {
  sku: string;
  totalImpressions: number;
  totalClicks: number;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  acos: number;
  mockupUrl?: string | null;
};

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

export function getTargetDisplayType(target: {
  adType?: string;
  matchType?: string;
  campaignName?: string;
  targetKeyword?: string;
}) {
  const camp = (target.campaignName || "").toLowerCase();
  const kw = (target.targetKeyword || "").toLowerCase().trim();
  const rawMatch = (target.matchType || "").trim();
  const adType = (target.adType || "SP").toUpperCase();

  const isAuto =
    camp.includes("sp04") ||
    camp.includes("auto") ||
    ["close-match", "loose-match", "substitutes", "complements"].some((t) => kw.includes(t)) ||
    kw.includes("auto targeting");

  let match = rawMatch;
  if (isAuto || !rawMatch || rawMatch.toLowerCase() === "unknown" || rawMatch.toLowerCase() === "targeting" || rawMatch === "-") {
    if (isAuto || camp.includes("sp04")) {
      match = "Auto";
    }
  }

  const label = `${adType} · ${match || (isAuto ? "Auto" : "Unknown")}`;

  let badgeColor = "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700";
  if (match === "Auto" || (isAuto && match !== "Exact" && match !== "Phrase" && match !== "Broad")) {
    badgeColor = "rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200/80";
  } else if (match?.toLowerCase() === "exact") {
    badgeColor = "rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200/80";
  } else if (match?.toLowerCase() === "phrase") {
    badgeColor = "rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 border border-sky-200/80";
  } else if (match?.toLowerCase() === "broad") {
    badgeColor = "rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200/80";
  }

  return { label, badgeColor, matchType: match || "Unknown" };
}

function SkuTrendSparkline({
  dailyTrend,
  sku,
  storeName,
  mockupUrl,
  onOpenDetail,
}: {
  dailyTrend?: PpcSkuDailyTrendPoint[];
  sku: string;
  storeName: string;
  mockupUrl?: string | null;
  onOpenDetail?: (data: {
    sku: string;
    storeName: string;
    mockupUrl?: string | null;
    dailyTrend: PpcSkuDailyTrendPoint[];
  }) => void;
}) {
  if (!dailyTrend || dailyTrend.length === 0) {
    return <span className="text-[10px] text-slate-300 font-mono">-</span>;
  }

  // The sparkline shows the last 7 days
  const last7 = dailyTrend.slice(-7);
  const maxVal = Math.max(...last7.map((d) => Math.max(d.spend || 0, d.sales || 0)), 1);
  const totSpend = last7.reduce((s, d) => s + (d.spend || 0), 0);
  const totSales = last7.reduce((s, d) => s + (d.sales || 0), 0);
  const totOrders = last7.reduce((s, d) => s + (d.orders || 0), 0);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onOpenDetail?.({ sku, storeName, mockupUrl, dailyTrend });
      }}
      className="group/spark inline-flex items-end gap-[3px] h-6 px-1.5 py-0.5 rounded hover:bg-indigo-50/70 cursor-pointer transition select-none"
      title={`7D: Spend $${totSpend.toFixed(1)} • Sales $${totSales.toFixed(1)} (${totOrders} orders) - Click to view 30D trend`}
    >
      {last7.map((d, idx) => {
        const hasSales = (d.sales || 0) > 0;
        const hasSpend = (d.spend || 0) > 0;
        const val = hasSales ? d.sales : d.spend;
        const heightPx = Math.max(3, Math.min(18, Math.round((val / maxVal) * 18)));

        let bgClass = "bg-slate-200";
        if (hasSales) {
          bgClass = "bg-emerald-500 group-hover/spark:bg-emerald-600";
        } else if (hasSpend) {
          bgClass = "bg-rose-400 group-hover/spark:bg-rose-500";
        }

        return (
          <div
            key={idx}
            className="flex flex-col items-center justify-end h-full"
            style={{ width: "6px" }}
          >
            <div
              style={{ height: `${heightPx}px` }}
              className={`w-full rounded-xs ${bgClass} transition-all`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function PpcDashboard({
  isEmbedded = false,
  initialTab,
  initialSubTab,
  initialStore,
  actor,
  navNonce,
  standaloneTab,
  activeTabProp,
  onTabChange,
  onOpenMobileNav,
  headerTitle,
}: PpcDashboardProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  const [stores, setStores] = useState<PpcStore[]>([]);
  const [storeSummaries, setStoreSummaries] = useState<PpcStoreSummary[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>(initialStore || "ALL");
  const [storePreferenceReady, setStorePreferenceReady] = useState(false);

  useEffect(() => {
    let restoredStore = initialStore || "";
    try {
      if (!restoredStore) {
        restoredStore = new URLSearchParams(window.location.search).get("store") || "";
      }
      if (!restoredStore) {
        restoredStore = localStorage.getItem("nce_ppc_last_store") || "";
      }
    } catch { }
    setSelectedStore(restoredStore || "ALL");
    setStorePreferenceReady(true);
  }, [initialStore]);

  // Khi mở tính năng yêu cầu chọn store mà đang ở ALL: Cảnh báo người dùng chọn store thay vì tự gán mặc định
  useEffect(() => {
    if (!storePreferenceReady) return;
    if (standaloneTab && (selectedStore === "ALL" || !selectedStore)) {
      setShowStoreNotice(true);
      setIsStoreHighlight(true);
      notify("Vui lòng chọn 1 Store cụ thể để sử dụng tính năng này", "info");
      const timer = setTimeout(() => setIsStoreHighlight(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [standaloneTab, selectedStore, navNonce, storePreferenceReady]);
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
  const [overviewSearchTerms, setOverviewSearchTerms] = useState<PpcSearchTermRow[]>([]);
  const [searchTerms, setSearchTerms] = useState<PpcSearchTermRow[]>([]);
  const [searchTermsReady, setSearchTermsReady] = useState(false);
  const [alerts, setAlerts] = useState<PpcAlert[]>([]);
  const [targetAcos, setTargetAcos] = useState(30);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [detailCounts, setDetailCounts] = useState<PpcDetailCounts | null>(null);
  const [loadingSection, setLoadingSection] = useState<string | null>(null);
  const loadedSectionsRef = useRef(new Set<string>());
  const sectionRequestIdRef = useRef(0);
  const sectionRequestsRef = useRef(new Map<string, { controller: AbortController; id: number }>());

  // Drill-down hierarchy state: Campaign -> Ad Group -> Target/Keyword -> Search Terms
  const [selectedCampaignForDrilldown, setSelectedCampaignForDrilldown] = useState<string | null>(null);
  const [selectedCampaignIdForDrilldown, setSelectedCampaignIdForDrilldown] = useState<string | null>(null);
  const [selectedAdGroupForDrilldown, setSelectedAdGroupForDrilldown] = useState<string | null>(null);
  const [expandedTargetKey, setExpandedTargetKey] = useState<string | null>(null);
  const lastLoadedTargetsParamsRef = useRef<string>("");

  // Navigation tab for data slicing (Hierarchy: Overview -> Campaigns -> Ad Groups -> Targets -> Search Terms -> ST Campaigns -> ST Optimization -> Sale KW | SKU parallel view | Settings)
  const [activeTab, setActiveTabState] = useState<
    "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "st_campaigns" | "st_optimization" | "sale_kw" | "alerts" | "recommendations" | "outcomes" | "settings"
  >(standaloneTab || activeTabProp || initialTab || "overview");

  const setActiveTab = useCallback((tab: any) => {
    setActiveTabState(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  const tabTitle = useMemo(() => {
    if (headerTitle) return headerTitle;
    const map: Record<string, string> = {
      overview: "Amazon PPC Dashboard & Analytics",
      campaigns: "Amazon PPC - Quản Lý Campaign",
      targets: "Amazon PPC - Quản Lý Target & Keyword",
      search_terms: "Amazon PPC - Báo Cáo Search Terms",
      skus: "Amazon PPC - Hiệu Suất Theo SKU",
      st_campaigns: "Amazon PPC - Đối Soát Search Term",
      st_optimization: "Amazon PPC - Negative Keyword (ST Optimization)",
      sale_kw: "Amazon PPC - Lên Campaign Sale KW",
      recommendations: "Amazon PPC - Đề Xuất & Auto Bid",
      outcomes: "Amazon PPC - Đánh Giá Bid",
      alerts: "Amazon PPC - Cảnh Báo",
      settings: "Amazon PPC - Cài Đặt",
    };
    return map[activeTab] || "Amazon PPC - Quản Lý Target & Keyword";
  }, [headerTitle, activeTab]);

  useEffect(() => {
    if (activeTabProp) {
      if (selectedStore === "ALL" && activeTabProp !== "overview") {
        notify("Vui lòng chọn 1 Store cụ thể để xem chi tiết", "info");
        setIsStoreHighlight(true);
        setShowStoreNotice(true);
        setTimeout(() => setIsStoreHighlight(false), 2500);
      }
      setActiveTabState(activeTabProp);
    }
  }, [activeTabProp, selectedStore]);

  useEffect(() => {
    if (standaloneTab || initialTab) return;
    try {
      const urlParam = new URLSearchParams(window.location.search).get("tab") as any;
      const validTabs = ["overview", "campaigns", "ad_groups", "targets", "skus", "match_types", "search_terms", "st_campaigns", "st_optimization", "sale_kw", "alerts", "recommendations", "outcomes", "settings"];
      if (urlParam && validTabs.includes(urlParam)) {
        setActiveTab(urlParam);
        return;
      }
      const saved = localStorage.getItem("nce_ppc_last_tab") as any;
      if (saved && validTabs.includes(saved)) setActiveTab(saved);
    } catch { }
  }, [standaloneTab, initialTab]);

  const [settingsSubTab, setSettingsSubTab] = useState<"phoi" | "rules" | "history">(initialSubTab || "phoi");

  useEffect(() => {
    if (initialSubTab) return;
    try {
      const urlParam = new URLSearchParams(window.location.search).get("subTab") as any;
      if (urlParam && ["phoi", "rules", "history"].includes(urlParam)) {
        setSettingsSubTab(urlParam);
        return;
      }
      const saved = localStorage.getItem("nce_ppc_last_subtab") as any;
      if (saved && ["phoi", "rules", "history"].includes(saved)) setSettingsSubTab(saved);
    } catch { }
  }, [initialSubTab]);

  useEffect(() => {
    if (standaloneTab) {
      setActiveTabState(standaloneTab);
    } else if (activeTabProp) {
      setActiveTabState(activeTabProp);
    } else if (initialTab) {
      setActiveTabState(initialTab);
    } else {
      setActiveTabState("overview");
      setShowStoreNotice(false);
      setIsStoreHighlight(false);
    }
  }, [standaloneTab, activeTabProp, initialTab, navNonce]);

  useEffect(() => {
    if (initialSubTab) {
      setSettingsSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    if (initialStore) {
      setSelectedStore(initialStore);
    }
  }, [initialStore]);

  // Synchronize tab, store, subTab to localStorage and URL searchParams
  useEffect(() => {
    if (!storePreferenceReady) return;
    try {
      localStorage.setItem("nce_ppc_last_tab", activeTab);
      localStorage.setItem("nce_ppc_last_store", selectedStore);
      localStorage.setItem("nce_ppc_last_subtab", settingsSubTab);

      const url = new URL(window.location.href);
      let changed = false;

      if (activeTab === "overview") {
        if (url.searchParams.has("tab")) {
          url.searchParams.delete("tab");
          changed = true;
        }
      } else {
        if (url.searchParams.get("tab") !== activeTab) {
          url.searchParams.set("tab", activeTab);
          changed = true;
        }
      }

      if (selectedStore === "ALL") {
        if (url.searchParams.has("store")) {
          url.searchParams.delete("store");
          changed = true;
        }
      } else {
        if (url.searchParams.get("store") !== selectedStore) {
          url.searchParams.set("store", selectedStore);
          changed = true;
        }
      }

      if (activeTab === "settings") {
        if (url.searchParams.get("subTab") !== settingsSubTab) {
          url.searchParams.set("subTab", settingsSubTab);
          changed = true;
        }
      } else {
        if (url.searchParams.has("subTab")) {
          url.searchParams.delete("subTab");
          changed = true;
        }
      }

      if (changed) {
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch { }
  }, [activeTab, selectedStore, settingsSubTab, storePreferenceReady]);

  // Các bảng chi tiết (Campaign / Target / Search Term / SKU / Đối soát ST) chỉ xem theo 1 store:
  // ở All Stores thì hiện khung chọn store thay vì tải dữ liệu toàn bộ store
  const storeRequired = selectedStore === "ALL" && STORE_SCOPED_TABS.has(activeTab);

  // Keep-alive state: preserve DOM and scroll position for visited tabs (zero re-render delay)
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([initialTab || "overview"]));
  useEffect(() => {
    if (storeRequired) return;
    setMountedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab, storeRequired]);

  // In-memory caches for instant tab/drilldown interactions
  const skuRecDetailsCacheRef = useRef<Map<string, PpcRecommendation[]>>(new Map());
  const childTermsCacheRef = useRef<Map<string, { confirmed: PpcSearchTermRow[]; inferred: PpcSearchTermRow[] }>>(new Map());

  // SKU-First Architecture state
  const [targetSkuToOpen, setTargetSkuToOpen] = useState<string | null>(null);
  const [skuSubView, setSkuSubView] = useState<"economics" | "performance">("performance");
  const [syncingAccounting, setSyncingAccounting] = useState(false);
  const [skuEconomicsList, setSkuEconomicsList] = useState<SkuEconomics[]>([]);
  const [skuRecGroups, setSkuRecGroups] = useState<SkuRecommendationGroup[]>([]);
  const [skuRecAllRecs, setSkuRecAllRecs] = useState<PpcRecommendation[]>([]);
  const [loadedRecommendationWindowDays, setLoadedRecommendationWindowDays] = useState<number | null>(null);
  const [includePausedRecs, setIncludePausedRecs] = useState(false);
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
  const [isActionQueueOpen, setIsActionQueueOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      return p.get("drawer") === "history" || p.get("history") === "1" || p.get("action_queue") === "1";
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("drawer") === "history" || p.get("history") === "1" || p.get("action_queue") === "1") {
      setIsActionQueueOpen(true);
    }
  }, []);

  const [costMasters, setCostMasters] = useState<ProductCostMaster[]>([]);
  const [ruleVersions, setRuleVersions] = useState<PpcRuleVersion[]>([]);
  const [bulkHistory, setBulkHistory] = useState<BulkExport[]>([]);
  const [loadingSkuEcon, setLoadingSkuEcon] = useState(false);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Filters & sorting for Search Terms
  const [searchTermQuery, setSearchTermQuery] = useState("");
  const [matchTypeFilter, setMatchTypeFilter] = useState("ALL");
  const [searchTermCampaignFilter, setSearchTermCampaignFilter] = useState("ALL");
  const [termViewMode, setTermViewMode] = useState<"aggregated" | "daily">("aggregated");
  const [termPerformanceFilter, setTermPerformanceFilter] = useState<
    "ALL" | "WITH_ORDERS" | "ZERO_ORDERS_BLEEDING" | "HIGH_ACOS"
  >("ALL");
  const [termMinClicks, setTermMinClicks] = useState("");
  const [termMaxClicks, setTermMaxClicks] = useState("");
  const [termMinOrders, setTermMinOrders] = useState("");
  const [termMaxOrders, setTermMaxOrders] = useState("");
  const [termMinAcos, setTermMinAcos] = useState("");
  const [termMaxAcos, setTermMaxAcos] = useState("");
  const [termSortField, setTermSortField] = useState<SortField | "cpc">("spend");
  const [termSortDir, setTermSortDir] = useState<SortDirection>("desc");
  const [termPage, setTermPage] = useState(1);
  const [termPageSize, setTermPageSize] = useState(25);
  // Khóa cột cho các bảng Campaign / Target / Search Term / SKU — lưu theo từng tài khoản
  const campaignFrozen = usePpcFrozenColumns("campaigns", actor, 1);
  const targetFrozen = usePpcFrozenColumns("targets", actor, 2);
  const searchTermFrozen = usePpcFrozenColumns("search_terms", actor, 2);
  const skuFrozen = usePpcFrozenColumns("skus", actor, 2);
  // Sắp xếp bảng tổng (SKU + keyword) phía trên tab Target / Search Term
  const targetSummarySort = usePpcSummarySort();
  const searchTermSummarySort = usePpcSummarySort();

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
  const [overviewWeakSkus, setOverviewWeakSkus] = useState<PpcOverviewAttentionSku[]>([]);
  const [loadingOverviewWeakSkus, setLoadingOverviewWeakSkus] = useState(false);
  // Giữ cả dòng đã chọn để chọn được qua nhiều trang / bộ lọc rồi lên camp một lần
  const [selectedTermRows, setSelectedTermRows] = useState<Map<string, PpcSearchTermRow>>(new Map());
  const selectedTerms = useMemo(() => new Set(selectedTermRows.keys()), [selectedTermRows]);
  const lastTermSelectIndexRef = useRef<number | null>(null);
  const clearSelectedTerms = useCallback(() => {
    setSelectedTermRows(new Map());
    lastTermSelectIndexRef.current = null;
  }, []);

  // SKU category & niche filter
  const [skuCategoryFilter, setSkuCategoryFilter] = useState<"ALL" | "HERO" | "BLEEDING" | "POTENTIAL" | "ZERO_CLICKS" | "ZERO_SPEND">("ALL");
  const [skuNicheFilter, setSkuNicheFilter] = useState<string>("ALL");
  const [skuPicFilter, setSkuPicFilter] = useState<string>("ALL");
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

  // Target search & sort (Server-paginated 50 rows/page)
  const [targetQuery, setTargetQuery] = useState("");
  const [targetSortField, setTargetSortField] = useState<SortField>("spend");
  const [targetSortDir, setTargetSortDir] = useState<SortDirection>("desc");
  const [serverTargets, setServerTargets] = useState<PpcTargetPerformance[]>([]);
  const [serverTargetTotal, setServerTargetTotal] = useState(0);
  const [serverTargetTotalPages, setServerTargetTotalPages] = useState(1);
  const [serverTargetSummary, setServerTargetSummary] = useState<{
    count: number;
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
    ctr: number;
    cpc: number;
    cvr: number;
    acos: number;
    skuGroups?: SearchTermSkuSummary[];
    keywordGroups?: KeywordGroupRow[] | null;
    keywordGroupTotal?: number;
  }>({
    count: 0,
    impressions: 0,
    clicks: 0,
    spend: 0,
    sales: 0,
    orders: 0,
    ctr: 0,
    cpc: 0,
    cvr: 0,
    acos: 0,
    skuGroups: [],
  });
  const [hoveredMockup, setHoveredMockup] = useState<{
    url: string;
    sku?: string;
    rect: { top: number; right: number };
  } | null>(null);
  const [previewModalMockup, setPreviewModalMockup] = useState<{
    url: string;
    sku?: string;
  } | null>(null);
  const [selectedSkuTrendModal, setSelectedSkuTrendModal] = useState<{
    sku: string;
    storeName: string;
    mockupUrl?: string | null;
    dailyTrend: PpcSkuDailyTrendPoint[];
  } | null>(null);
  const [loadingTargetsServer, setLoadingTargetsServer] = useState(false);
  const [expandedChildTerms, setExpandedChildTerms] = useState<
    Record<string, { loading: boolean; terms: PpcSearchTermRow[]; error?: string }>
  >({});
  const [targetRefreshKey, setTargetRefreshKey] = useState(0);

  // SKU search & sort
  const [skuQuery, setSkuQuery] = useState("");
  const [skuSortField, setSkuSortField] = useState<SortField>("spend");
  const [skuSortDir, setSkuSortDir] = useState<SortDirection>("desc");

  const [loading, setLoading] = useState(true);
  const [isStoreSwitching, setIsStoreSwitching] = useState(false);
  const isStoreSwitchingRef = useRef(false);
  const [syncingR2, setSyncingR2] = useState(false);
  const [syncingAdsPower, setSyncingAdsPower] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showFileManagerModal, setShowFileManagerModal] = useState(false);
  const [showAddStoreModal, setShowAddStoreModal] = useState(false);
  const [showStoreManagerModal, setShowStoreManagerModal] = useState(false);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const actionDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionDropdownRef.current && !actionDropdownRef.current.contains(e.target as Node)) {
        setShowActionDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStore, setUploadStore] = useState("HSOSTORE");
  const [uploadEndDate, setUploadEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateRangeStart, setDateRangeStart] = useState<string | null>(null);
  const [dateRangeEnd, setDateRangeEnd] = useState<string | null>(null);
  const [dailyTrends, setDailyTrends] = useState<PpcDailyTrendPoint[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [summary7D, setSummary7D] = useState<PpcSummaryMetrics | null>(null);
  const [adTypeBreakdown7D, setAdTypeBreakdown7D] = useState<PpcAdTypeBreakdown[]>([]);
  const metricsRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const metricsRequestIdRef = useRef(0);

  // Notification helper
  const notify = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const storeSelectRef = useRef<HTMLButtonElement>(null);
  const storeDropdownContainerRef = useRef<HTMLDivElement>(null);
  const [isStoreDropdownOpen, setIsStoreDropdownOpen] = useState(false);
  const [isStoreHighlight, setIsStoreHighlight] = useState(false);
  const [showStoreNotice, setShowStoreNotice] = useState(false);
  const [pendingFeatureTab, setPendingFeatureTab] = useState<
    | "overview"
    | "campaigns"
    | "ad_groups"
    | "targets"
    | "skus"
    | "match_types"
    | "search_terms"
    | "st_campaigns"
    | "st_optimization"
    | "sale_kw"
    | "alerts"
    | "recommendations"
    | "outcomes"
    | "settings"
    | null
  >(null);

  useEffect(() => {
    if (!isStoreDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (storeDropdownContainerRef.current && !storeDropdownContainerRef.current.contains(e.target as Node)) {
        setIsStoreDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsStoreDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStoreDropdownOpen]);

  const handleFeatureTabClick = useCallback((tabKey:
    | "overview"
    | "campaigns"
    | "ad_groups"
    | "targets"
    | "skus"
    | "match_types"
    | "search_terms"
    | "st_campaigns"
    | "st_optimization"
    | "sale_kw"
    | "alerts"
    | "recommendations"
    | "outcomes"
    | "settings"
  ) => {
    if (selectedStore === "ALL" && tabKey !== "overview") {
      notify("Vui lòng chọn 1 Store cụ thể để sử dụng tính năng này", "info");
      setIsStoreHighlight(true);
      setShowStoreNotice(true);
      setPendingFeatureTab(tabKey);
      setIsStoreDropdownOpen(true);
      setTimeout(() => setIsStoreHighlight(false), 2500);
      storeSelectRef.current?.focus();
      return;
    }
    setShowStoreNotice(false);
    setActiveTab(tabKey);
  }, [selectedStore]);

  const handleStoreChange = useCallback((storeName: string) => {
    setSelectedStore(storeName);
    setSelectedSku("ALL");
    setSkuNicheFilter("ALL");
    setSkuPicFilter("ALL");
    setIsStoreHighlight(false);
    setShowStoreNotice(false);
    if (storeName === "ALL") {
      setActiveTab("overview");
      setPendingFeatureTab(null);
    } else if (pendingFeatureTab) {
      setActiveTab(pendingFeatureTab);
      setPendingFeatureTab(null);
    }
  }, [pendingFeatureTab]);

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
        if (!loadedSectionsRef.current.has("skus") && activeTab === "overview") {
          setSkuPerformance(data.skuPerformance || []);
        }
        setCampaignPerformance(data.campaignPerformance || []);
        setOverviewCampaigns(data.campaignPerformance || []);
        setAdGroupPerformance(data.adGroups || []);
        setTargetPerformance(data.targets || []);
        setAdTypeBreakdown(data.adTypeBreakdown || []);
        setDataHealth(data.dataHealth || null);
        setTargetTypeBreakdown(data.targetTypeBreakdown || []);
        setKeywordMatchTypeBreakdown(data.keywordMatchTypeBreakdown || []);
        setMatchTypeBreakdown(data.matchTypeBreakdown || []);
        setOverviewSearchTerms(data.searchTerms || []);
        setAlerts(data.alerts || []);
        setTargetAcos(data.targetAcos || 30);
        setDateRangeStart(data.dateRangeStart || null);
        setDateRangeEnd(data.dateRangeEnd || null);
        setDailyTrends(data.dailyTrends || []);
        setLastSyncedAt(data.lastSyncedAt || null);
        setDetailCounts(data.detailCounts || null);
        clearSelectedTerms();
        clearSelectedTargets();
        termGroupSelection.clear();
        targetGroupSelection.clear();
        setTermPage(1);
        setCampaignPage(1);
        setAdGroupPage(1);
        setTargetPage(1);
        setSkuPage(1);
      });
      if (isStoreSwitchingRef.current) {
        isStoreSwitchingRef.current = false;
        notify(
          `Đã tải xong dữ liệu cho ${selectedStore === "ALL" ? "Tất cả Store" : `Store ${selectedStore}`}`,
          "success"
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error(err);
      notify(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu từ máy chủ", "error");
    } finally {
      if (metricsRequestRef.current?.id === requestId) {
        metricsRequestRef.current = null;
        setLoading(false);
        setIsStoreSwitching(false);
      }
    }
  }, [selectedStore, selectedSku, selectedDays, isCustomDate, customStartDate, customEndDate]);

  const loadSection = useCallback(async (section: string, options: { force?: boolean } = {}) => {
    if (!options.force && loadedSectionsRef.current.has(section)) return;
    sectionRequestsRef.current.get(section)?.controller.abort();
    const controller = new AbortController();
    const requestId = ++sectionRequestIdRef.current;
    sectionRequestsRef.current.set(section, { controller, id: requestId });
    setLoadingSection(section);
    if (section === "search_terms") setSearchTermsReady(false);
    try {
      const dateParams = isCustomDate && customStartDate && customEndDate
        ? `&startDate=${encodeURIComponent(customStartDate)}&endDate=${encodeURIComponent(customEndDate)}`
        : "";
      const campaignDrilldownParam = section === "targets" && selectedCampaignForDrilldown
        ? `&campaignName=${encodeURIComponent(selectedCampaignForDrilldown)}`
        : "";
      const res = await fetch(
        `/api/ppc/metrics?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}&section=${encodeURIComponent(section)}${dateParams}${campaignDrilldownParam}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || errData.message || (res.status === 401 ? "Phiên làm việc đã hết hạn" : `Lỗi tải bảng dữ liệu (HTTP ${res.status})`);
        throw new Error(msg);
      }
      const data = await res.json();
      if (sectionRequestsRef.current.get(section)?.id !== requestId) return;
      loadedSectionsRef.current.add(section);
      startTransition(() => {
        if (data.stores && data.stores.length > 0) setStores(data.stores);
        if (section === "campaigns") setCampaignPerformance(data.campaignPerformance || []);
        if (section === "ad_groups") setAdGroupPerformance(data.adGroups || []);
        if (section === "targets") setTargetPerformance(data.targets || []);
        if (section === "skus") setSkuPerformance(data.skuPerformance || []);
        if (section === "search_terms") {
          setSearchTerms(data.searchTerms || []);
          setSearchTermsReady(true);
        }
        setDetailCounts((current) => data.detailCounts ? { ...current, ...data.detailCounts } : current);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    } finally {
      if (sectionRequestsRef.current.get(section)?.id === requestId) {
        sectionRequestsRef.current.delete(section);
        setLoadingSection((current) => current === section ? null : current);
      }
    }
  }, [selectedStore, selectedSku, selectedDays, isCustomDate, customStartDate, customEndDate, selectedCampaignForDrilldown]);

  const refreshData = useCallback(async () => {
    skuRecDetailsCacheRef.current.clear();
    childTermsCacheRef.current.clear();
    for (const request of sectionRequestsRef.current.values()) {
      request.controller.abort();
    }
    sectionRequestsRef.current.clear();
    loadedSectionsRef.current.clear();
    setLoadingSection(null);
    setSearchTerms([]);
    setSearchTermsReady(false);

    // Refresh overview first so cache invalidation completes before detail data is requested.
    await loadData(true);

    const detailSection = activeTab === "st_optimization" || activeTab === "sale_kw"
      ? "search_terms"
      : ["ad_groups", "skus", "search_terms"].includes(activeTab)
        ? activeTab
        : null;
    if (detailSection) {
      await loadSection(detailSection, { force: true });
    }
    if (activeTab === "targets") {
      setTargetRefreshKey((k) => k + 1);
    }
  }, [activeTab, loadData, loadSection]);

  useEffect(() => {
    if (activeTab !== "campaigns" || selectedStore === "ALL") return;
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

  // Server-side paginated fetch for Targets (50 rows/page, 300ms debounce, SQL summary aggregation)
  useEffect(() => {
    if (activeTab !== "targets" || selectedStore === "ALL") return;

    const currentParamsKey = `${selectedStore}:${selectedSku}:${selectedDays}:${targetPage}:${targetPageSize}:${targetQuery}:${targetSortField}:${targetSortDir}:${selectedCampaignIdForDrilldown || ""}:${selectedCampaignForDrilldown || ""}:${selectedAdGroupForDrilldown || ""}`;

    // If targets are already loaded with the exact same parameters, keep current view instantly without reloading spinner
    if (lastLoadedTargetsParamsRef.current === currentParamsKey && serverTargets.length > 0) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingTargetsServer(true);
      try {
        const params = new URLSearchParams({
          storeName: selectedStore,
          sku: selectedSku,
          days: String(selectedDays),
          page: String(targetPage),
          pageSize: String(targetPageSize),
          search: targetQuery,
          sortBy: targetSortField,
          sortDir: targetSortDir,
          // Prioritize exact campaignId lookup (1.6ms index) - only pass campaignName if id is missing
          ...(selectedCampaignIdForDrilldown
            ? { campaignId: selectedCampaignIdForDrilldown }
            : (selectedCampaignForDrilldown ? { campaignName: selectedCampaignForDrilldown } : {})),
          ...(selectedAdGroupForDrilldown ? { adGroupName: selectedAdGroupForDrilldown } : {}),
        });
        const res = await fetch(`/api/ppc/targets?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Không thể tải Target / Keyword (HTTP ${res.status})`);
        const json = await res.json();
        if (json.success && json.data) {
          lastLoadedTargetsParamsRef.current = currentParamsKey;
          setServerTargets(json.data.items || []);
          const exactTargetTotal = Number(json.data.total || 0);
          setServerTargetTotal(exactTargetTotal);
          // The paginated endpoint counts the complete filtered SQL result.
          // Keep the tab badge in sync with it instead of the legacy 20k payload cap.
          setDetailCounts((current) => current
            ? { ...current, targets: exactTargetTotal }
            : current);
          setServerTargetTotalPages(Math.max(1, Number(json.data.totalPages || 1)));
          if (json.data.summary) {
            setServerTargetSummary({
              ...json.data.summary,
              skuGroups: json.data.exactSkuSummaries || [],
              keywordGroups: json.data.keywordGroups || null,
              keywordGroupTotal: Number(json.data.keywordGroupTotal || 0),
            });
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        notify(error instanceof Error ? error.message : "Không thể tải Target / Keyword", "error");
      } finally {
        if (!controller.signal.aborted) setLoadingTargetsServer(false);
      }
    }, targetQuery ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeTab,
    selectedStore,
    selectedSku,
    selectedDays,
    targetPage,
    targetPageSize,
    targetQuery,
    targetSortField,
    targetSortDir,
    selectedCampaignIdForDrilldown,
    selectedCampaignForDrilldown,
    selectedAdGroupForDrilldown,
    targetRefreshKey,
  ]);

  // Server-side paginated fetch for Search Terms (50 rows/page, accurate DB count)
  const [serverSearchTerms, setServerSearchTerms] = useState<PpcSearchTermRow[] | null>(null);
  const [serverSearchTermTotal, setServerSearchTermTotal] = useState<number | null>(null);
  const [serverSearchTermTotalPages, setServerSearchTermTotalPages] = useState<number>(1);
  const [serverSearchTermSummary, setServerSearchTermSummary] = useState<any>(null);
  const [loadingSearchTermsServer, setLoadingSearchTermsServer] = useState<boolean>(false);
  const lastLoadedSearchTermsParamsRef = useRef<string>("");
  const [stOptimizationServerCount, setStOptimizationServerCount] = useState<number | null>(null);
  const [saleKwServerCount, setSaleKwServerCount] = useState<number | null>(null);

  // Pre-fetch accurate server badge counts for ST Optimization and Sale KW tabs
  useEffect(() => {
    let active = true;
    const fetchBadgeCounts = async () => {
      try {
        const storeParam = selectedStore && selectedStore !== "ALL" ? `&storeName=${encodeURIComponent(selectedStore)}` : "";
        const [optRes, saleRes] = await Promise.all([
          fetch(`/api/ppc/search-terms/optimization?days=${selectedDays}${storeParam}&pageSize=1`),
          fetch(`/api/ppc/search-terms/sale-keywords?days=${selectedDays}${storeParam}&pageSize=1`),
        ]);
        if (optRes.ok) {
          const optJson = await optRes.json();
          if (active && optJson.success && optJson.data) {
            setStOptimizationServerCount(optJson.data.total ?? optJson.data.summary?.candidateCount ?? 0);
          }
        }
        if (saleRes.ok) {
          const saleJson = await saleRes.json();
          if (active && saleJson.success && saleJson.data) {
            setSaleKwServerCount(saleJson.data.total ?? 0);
          }
        }
      } catch {
        // silent fallback to local calculation
      }
    };
    fetchBadgeCounts();
    return () => {
      active = false;
    };
  }, [selectedStore, selectedDays]);

  useEffect(() => {
    if (activeTab !== "search_terms" || selectedStore === "ALL") return;

    const currentParamsKey = `${selectedStore}:${selectedSku}:${selectedDays}:${termPage}:${termPageSize}:${searchTermQuery}:${termSortField}:${termSortDir}:${searchTermCampaignFilter}:${matchTypeFilter}:${termPerformanceFilter}:${termMinClicks}:${termMaxClicks}:${termMinOrders}:${termMaxOrders}:${termMinAcos}:${termMaxAcos}`;

    if (lastLoadedSearchTermsParamsRef.current === currentParamsKey && serverSearchTerms !== null) {
      return;
    }

    const hasInputFilter = Boolean(
      searchTermQuery.trim() ||
      termMinClicks.trim() ||
      termMaxClicks.trim() ||
      termMinOrders.trim() ||
      termMaxOrders.trim() ||
      termMinAcos.trim() ||
      termMaxAcos.trim()
    );

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingSearchTermsServer(true);
      try {
        const params = new URLSearchParams({
          storeName: selectedStore,
          sku: selectedSku,
          days: String(selectedDays),
          page: String(termPage),
          pageSize: String(termPageSize),
          search: searchTermQuery.trim(),
          sortBy: termSortField,
          sortDir: termSortDir,
          ...(searchTermCampaignFilter !== "ALL" ? { campaignName: searchTermCampaignFilter } : {}),
          ...(matchTypeFilter !== "ALL" ? { matchType: matchTypeFilter } : {}),
          ...(termPerformanceFilter !== "ALL" ? { performanceFilter: termPerformanceFilter } : {}),
          ...(termMinClicks.trim() ? { minClicks: termMinClicks.trim() } : {}),
          ...(termMaxClicks.trim() ? { maxClicks: termMaxClicks.trim() } : {}),
          ...(termMinOrders.trim() ? { minOrders: termMinOrders.trim() } : {}),
          ...(termMaxOrders.trim() ? { maxOrders: termMaxOrders.trim() } : {}),
          ...(termMinAcos.trim() ? { minAcos: termMinAcos.trim() } : {}),
          ...(termMaxAcos.trim() ? { maxAcos: termMaxAcos.trim() } : {}),
        });
        const res = await fetch(`/api/ppc/search-terms?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Không thể tải Search Terms (HTTP ${res.status})`);
        const json = await res.json();
        if (json.success && json.data) {
          lastLoadedSearchTermsParamsRef.current = currentParamsKey;
          setServerSearchTerms(json.data.items || []);
          const exactTotal = Number(json.data.total || 0);
          setServerSearchTermTotal(exactTotal);
          setDetailCounts((current) => current ? { ...current, searchTerms: exactTotal } : current);
          setServerSearchTermTotalPages(Math.max(1, Number(json.data.totalPages || 1)));
          setServerSearchTermSummary({
            ...(json.data.exactSummary || json.data.summary),
            skuGroups: json.data.exactSkuSummaries || [],
            keywordGroups: json.data.keywordGroups || null,
            keywordGroupTotal: Number(json.data.keywordGroupTotal || 0),
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        notify(error instanceof Error ? error.message : "Không thể tải Search Terms", "error");
      } finally {
        if (!controller.signal.aborted) setLoadingSearchTermsServer(false);
      }
    }, hasInputFilter ? 300 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    activeTab,
    selectedStore,
    selectedSku,
    selectedDays,
    termPage,
    termPageSize,
    searchTermQuery,
    termSortField,
    termSortDir,
    searchTermCampaignFilter,
    matchTypeFilter,
    termPerformanceFilter,
    termMinClicks,
    termMaxClicks,
    termMinOrders,
    termMaxOrders,
    termMinAcos,
    termMaxAcos,
  ]);

  // On-demand child search terms loader for expanded Target row
  const handleToggleExpandTarget = useCallback(async (target: PpcTargetPerformance, targetKey: string) => {
    if (expandedTargetKey === targetKey) {
      setExpandedTargetKey(null);
      return;
    }
    setExpandedTargetKey(targetKey);

    // If already loaded in cache, do not re-fetch
    if (expandedChildTerms[targetKey]?.terms && !expandedChildTerms[targetKey]?.loading) {
      return;
    }

    setExpandedChildTerms((prev) => ({
      ...prev,
      [targetKey]: { loading: true, terms: [] },
    }));

    try {
      const params = new URLSearchParams({
        storeName: target.storeName || selectedStore || "ALL",
        targetId: target.targetId || "",
        targetKeyword: target.targetKeyword || "",
        campaignName: target.campaignName || "",
        adGroupName: target.adGroupName || "",
        limit: "100",
      });
      const res = await fetch(`/api/ppc/targets/search-terms?${params}`);
      if (!res.ok) throw new Error("Không thể tải search terms con");
      const json = await res.json();
      const terms: PpcSearchTermRow[] = json.data || [];
      setExpandedChildTerms((prev) => ({
        ...prev,
        [targetKey]: { loading: false, terms },
      }));
    } catch (err) {
      setExpandedChildTerms((prev) => ({
        ...prev,
        [targetKey]: {
          loading: false,
          terms: [],
          error: err instanceof Error ? err.message : "Lỗi khi tải search terms",
        },
      }));
    }
  }, [expandedTargetKey, expandedChildTerms, selectedStore]);

  const loadSkuEconomics = useCallback(async () => {
    if (!selectedStore || selectedStore === "ALL") {
      setSkuEconomicsList([]);
      return;
    }
    try {
      setLoadingSkuEcon(true);
      const res = await fetch(`/api/ppc/sku-economics?days=${selectedDays}&storeId=${encodeURIComponent(selectedStore)}`, { cache: "no-store" });
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
  }, [selectedDays, selectedStore]);

  const loadGroupedRecommendations = useCallback(async (force = false) => {
    const currentKey = `${selectedStore}:${selectedSku}:${selectedDays}:${includePausedRecs ? 1 : 0}`;
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
        `/api/ppc/recommendations/grouped?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}&summary=1&includePaused=${includePausedRecs ? "1" : "0"}${force ? "&refresh=1" : ""}`,
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
  }, [selectedStore, selectedSku, selectedDays, includePausedRecs]);

  useEffect(() => {
    if (activeTab === "recommendations") return;
    groupedRecRequestRef.current?.controller.abort();
  }, [activeTab]);

  const loadSkuRecommendationDetails = useCallback(async (sku: string, force = false) => {
    const cacheKey = `${selectedStore}:${selectedDays}:${sku.trim().toUpperCase()}:${includePausedRecs ? 1 : 0}`;
    const cached = force ? undefined : skuRecDetailsCacheRef.current.get(cacheKey);
    if (cached) {
      setSkuRecAllRecs(cached);
      return cached;
    }
    const res = await fetch(
      `/api/ppc/recommendations/grouped?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(sku)}&days=${selectedDays}&includePaused=${includePausedRecs ? "1" : "0"}`,
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Không thể tải recommendation cho SKU ${sku}`);
    const data = await res.json();
    if (data?.recommendationWindowDays !== selectedDays) throw new Error("Recommendation trả về sai kỳ dữ liệu.");
    const recommendations = Array.isArray(data?.data?.allRecommendations) ? data.data.allRecommendations : [];
    skuRecDetailsCacheRef.current.set(cacheKey, recommendations);
    setSkuRecAllRecs(recommendations);
    return recommendations;
  }, [selectedStore, selectedDays, includePausedRecs]);

  const loadActionQueueCount = useCallback(async (targetStore?: string) => {
    try {
      const activeStore = targetStore !== undefined ? targetStore : selectedStore;
      const params = new URLSearchParams();
      if (activeStore && activeStore !== "ALL") {
        params.set("storeName", activeStore);
      } else {
        params.set("storeName", "ALL");
      }
      params.set("allUsers", "true");
      const res = await fetch(`/api/ppc/actions/count?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") {
        setActionQueueCount(data.count);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedStore]);

  const loadActionQueue = useCallback(async (targetStore?: string) => {
    try {
      const activeStore = targetStore !== undefined ? targetStore : selectedStore;
      const params = new URLSearchParams();
      if (activeStore && activeStore !== "ALL") {
        params.set("storeName", activeStore);
      } else {
        params.set("storeName", "ALL");
      }
      params.set("allUsers", "true");
      const res = await fetch(`/api/ppc/actions?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data) {
        setActionQueue(data.data);
        setActionQueueCount(data.data.length);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedStore]);

  const loadBulkHistory = useCallback(async (targetStore?: string) => {
    try {
      const activeStore = targetStore !== undefined ? targetStore : selectedStore;
      const query = activeStore && activeStore !== "ALL"
        ? `?storeName=${encodeURIComponent(activeStore)}`
        : "?storeId=ALL";
      const resHistory = await fetch(`/api/ppc/bulk-export${query}`, { cache: "no-store" });
      if (resHistory.ok) {
        const d = await resHistory.json();
        if (d?.data) setBulkHistory(d.data);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedStore]);

  const handleUpdateSkuEconomics = async (sku: string, updates: Partial<SkuEconomics>) => {
    const res = await fetch("/api/ppc/sku-economics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeName: selectedStore, sku, ...updates }),
    });
    if (!res.ok) throw new Error("Không thể cập nhật thông số SKU.");
    void loadSkuEconomics();
    notify(`Đã cập nhật thông số kinh tế cho SKU ${sku}`, "success");
  };

  const handleSaveSkuMappings = async (
    mappings: Array<{ sku: string; productType: string; asin?: string }>,
  ) => {
    const res = await fetch("/api/ppc/sku-economics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeName: selectedStore, mappings }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Không thể lưu mapping SKU.");
    await loadSkuEconomics();
    void loadGroupedRecommendations(true);
    notify(`Đã lưu mapping cho ${body.updatedCount || mappings.length} SKU.`, "success");
  };

  const handleSyncFromAccounting = async () => {
    if (!selectedStore || selectedStore === "ALL") {
      notify("Vui lòng chọn một Store cụ thể để đồng bộ Bảng mã.", "error");
      return;
    }
    try {
      setSyncingAccounting(true);
      const res = await fetch("/api/ppc/sku-economics/sync-accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Không thể đồng bộ dữ liệu từ Accounting.");
      }
      notify(data.message || `Đã đồng bộ SKU từ Bảng mã cho ${selectedStore}!`, "success");
      await loadSkuEconomics();
      void loadGroupedRecommendations(true);
      void refreshData();
    } catch (e: any) {
      console.error(e);
      notify(e.message || "Lỗi khi đồng bộ từ Bảng mã Accounting", "error");
    } finally {
      setSyncingAccounting(false);
    }
  };

  const handleJumpToAutoBid = useCallback((sku: string) => {
    if (!sku) return;
    setTargetSkuToOpen(sku);
    setMountedTabs((prev) => new Set([...prev, "recommendations"]));
    setActiveTab("recommendations");
    if (skuRecGroups.length === 0) {
      void loadGroupedRecommendations(false);
    }
  }, [skuRecGroups.length, loadGroupedRecommendations]);

  // Auto-sync accounting master data silently on store select (no manual button needed)
  const lastAutoSyncedStoreRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedStore || selectedStore === "ALL") return;
    if (lastAutoSyncedStoreRef.current === selectedStore) return;
    lastAutoSyncedStoreRef.current = selectedStore;
    fetch("/api/ppc/sku-economics/sync-accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeName: selectedStore }),
    })
      .then((res) => {
        if (res.ok) {
          void loadSkuEconomics();
        }
      })
      .catch((err) => console.warn("[Auto-sync Accounting]", err));
  }, [selectedStore, loadSkuEconomics]);

  const handleApproveToQueue = async (items: Array<{
    recommendation: PpcRecommendation;
    userFinalBid?: number;
    decisionSource?: "AI_AGENT";
    aiReview?: unknown;
  }>) => {
    const storeObj = stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase());
    const res = await fetch("/api/ppc/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        storeName: selectedStore,
        storeId: storeObj?.id,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Không thể duyệt hành động vào Action Queue.");
    }
    const data = await res.json();
    void loadActionQueue(selectedStore);
    void loadActionQueueCount(selectedStore);
    void loadGroupedRecommendations(true);
    notify(data.message || "Đã duyệt đề xuất vào Action Queue!", "success");
  };

  const handleRemoveAction = async (actionId: string) => {
    const targetStore = selectedStore === "ALL" ? "ALL" : (stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.id || "");
    const res = await fetch(`/api/ppc/actions?actionId=${encodeURIComponent(actionId)}&storeId=${encodeURIComponent(targetStore)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Không thể xóa hành động.");
    void loadActionQueue(selectedStore);
    void loadActionQueueCount(selectedStore);
    notify("Đã xóa hành động khỏi Action Queue.", "success");
  };

  const handleRemoveActions = async (actionIdsOrPayload: string[] | any) => {
    const isPayload = actionIdsOrPayload && typeof actionIdsOrPayload === "object" && !Array.isArray(actionIdsOrPayload);
    if (!isPayload && (!actionIdsOrPayload || actionIdsOrPayload.length === 0)) return;
    const targetStore = selectedStore === "ALL" ? "ALL" : (stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.id || "");
    const body = isPayload ? actionIdsOrPayload : { actionIds: actionIdsOrPayload };
    const res = await fetch(`/api/ppc/actions?storeId=${encodeURIComponent(targetStore)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Không thể xóa các hành động đã chọn.");
    const json = await res.json().catch(() => ({}));
    void loadActionQueue(selectedStore);
    void loadActionQueueCount(selectedStore);
    notify(json.message || `Đã xóa hành động khỏi Action Queue.`, "success");
  };

  const handleExportBulk = async (selectedActionIdsOrPayload?: string[] | any) => {
    const isPayload = selectedActionIdsOrPayload && typeof selectedActionIdsOrPayload === "object" && !Array.isArray(selectedActionIdsOrPayload);
    const body = isPayload ? selectedActionIdsOrPayload : { actionIds: selectedActionIdsOrPayload };
    const res = await fetch("/api/ppc/bulk-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  // Mount & Store switch: load store-specific action queue count
  useEffect(() => {
    void loadActionQueueCount(selectedStore);
  }, [selectedStore, loadActionQueueCount]);

  // Lazy-load drawer data only when opened, filtered by active store
  useEffect(() => {
    if (isActionQueueOpen) {
      void loadActionQueue(selectedStore);
      void loadBulkHistory(selectedStore);
    }
  }, [isActionQueueOpen, selectedStore, loadActionQueue, loadBulkHistory]);

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
      const storeChanged = currentFiltersRef.current.store !== selectedStore;
      currentFiltersRef.current = {
        store: selectedStore,
        sku: selectedSku,
        days: selectedDays,
        isCustomDate,
        start: customStartDate,
        end: customEndDate,
      };
      for (const request of sectionRequestsRef.current.values()) {
        request.controller.abort();
      }
      sectionRequestsRef.current.clear();
      loadedSectionsRef.current.clear();
      lastLoadedRecKeyRef.current = "";
      setLoadingSection(null);
      setSearchTerms([]);
      setSearchTermsReady(false);
      setSelectedCampaignForDrilldown(null);
      setSelectedCampaignIdForDrilldown(null);
      setSelectedAdGroupForDrilldown(null);
      setSkuRecGroups([]);
      setSkuRecAllRecs([]);
      if (storeChanged) {
        isStoreSwitchingRef.current = true;
        setIsStoreSwitching(true);
        setLoading(true);
        notify(
          `Đang chuyển sang ${selectedStore === "ALL" ? "Tất cả Store" : `Store ${selectedStore}`}...`,
          "info"
        );
        setSummary(null);
        setSummary7D(null);
        setDataHealth(null);
        setCampaignPerformance([]);
        setAdGroupPerformance([]);
        setTargetPerformance([]);
        setSkuPerformance([]);
        setDailyTrends([]);
        setOverviewSearchTerms([]);
        setOverviewCampaigns([]);
        setDetailCounts(null);
        setActionQueue([]);
        setActionQueueCount(0);
        void loadActionQueue(selectedStore);
        void loadActionQueueCount(selectedStore);
      }
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

    if (activeTab !== "overview" && ["ad_groups", "skus"].includes(activeTab) && selectedStore !== "ALL") {
      const sectionToLoad = activeTab;
      const isMissingFullSkus = sectionToLoad === "skus" && (skuPerformance.length <= 10 && (detailCounts?.skus ?? 0) > 10);
      if (!loadedSectionsRef.current.has(sectionToLoad) || isMissingFullSkus) {
        void loadSection(sectionToLoad, { force: isMissingFullSkus }).catch((error) => {
          notify(error instanceof Error ? error.message : "Không thể tải bảng dữ liệu PPC", "error");
        });
      }
      if (activeTab === "skus") {
        void loadSkuEconomics();
      }
    } else if (activeTab === "recommendations") {
      void loadGroupedRecommendations();
      void loadActionQueue(selectedStore);
      void loadActionQueueCount(selectedStore);
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

  useEffect(() => {
    if (activeTab !== "overview" || selectedStore === "ALL") {
      setOverviewWeakSkus([]);
      setLoadingOverviewWeakSkus(false);
      return;
    }

    const controller = new AbortController();
    setLoadingOverviewWeakSkus(true);
    void fetch(
      `/api/ppc/sku-economics/overview?storeId=${encodeURIComponent(selectedStore)}&days=${selectedDays}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        setOverviewWeakSkus(Array.isArray(body?.data) ? body.data : []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Không thể tải tổng quan SKU cần chú ý:", error);
        setOverviewWeakSkus([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOverviewWeakSkus(false);
      });

    return () => controller.abort();
  }, [activeTab, selectedStore, selectedDays]);

  useEffect(() => {
    return () => {
      metricsRequestRef.current?.controller.abort();
      for (const request of sectionRequestsRef.current.values()) {
        request.controller.abort();
      }
      sectionRequestsRef.current.clear();
    };
  }, []);

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
        await refreshData();
        return;
      }

      const jobId = data.job?.id;
      if (!jobId) {
        notify(data.message || "Đã gửi yêu cầu đồng bộ R2!", "success");
        await refreshData();
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
          await refreshData();
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
      await refreshData();
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
      await refreshData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi nạp file", "error");
    } finally {
      setUploading(false);
    }
  };

  // Aggregated Search Terms by Campaign + Search Term + Match Type (Tổng hợp cả kỳ)
  const aggregatedSearchTerms = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return [];
    const map = new Map<string, PpcSearchTermRow>();

    for (const t of searchTerms) {
      const camp = (t.campaignName || "").trim();
      const term = (t.customerSearchTerm || "").trim();
      const match = t.matchType || "Unknown";
      const key = `${camp.toLowerCase()}|||${term.toLowerCase()}|||${match.toLowerCase()}`;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...t });
      } else {
        existing.impressions = (existing.impressions || 0) + (t.impressions || 0);
        existing.clicks = (existing.clicks || 0) + (t.clicks || 0);
        existing.spend = (existing.spend || 0) + (t.spend || 0);
        existing.sales = (existing.sales || 0) + (t.sales || 0);
        existing.orders = (existing.orders || 0) + (t.orders || 0);
        existing.units = (existing.units || 0) + (t.units || 0);
      }
    }

    const list = Array.from(map.values());
    for (const r of list) {
      r.cpc = r.clicks > 0 ? Math.round((r.spend / r.clicks) * 100) / 100 : 0;
      r.ctr = r.impressions > 0 ? Math.round((r.clicks / r.impressions) * 10000) / 10000 : 0;
      r.cvr = r.clicks > 0 ? Math.round((r.orders / r.clicks) * 10000) / 10000 : 0;
      r.acos = r.sales > 0 ? Math.round((r.spend / r.sales) * 1000) / 10 : (r.spend > 0 ? 999 : 0);
      r.roas = r.spend > 0 ? Math.round((r.sales / r.spend) * 100) / 100 : 0;
    }
    return list;
  }, [searchTerms]);

  // Unique campaigns for Search Terms filter (rút ngắn theo từ khóa đang tìm trong ô search)
  const searchTermCampaigns = useMemo(() => {
    let source = aggregatedSearchTerms;
    if (searchTermQuery.trim()) {
      const tokens = searchTermQuery.toLowerCase().split(/\s+/).filter(Boolean);
      source = source.filter((t) => {
        const text = `${t.customerSearchTerm} ${t.campaignName} ${t.portfolioName || ""}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }
    return Array.from(new Set(source.map((t) => t.campaignName).filter(Boolean))).sort();
  }, [aggregatedSearchTerms, searchTermQuery]);

  // Tự động đưa về ALL nếu campaign đã chọn không còn trong danh sách campaign liên quan
  useEffect(() => {
    if (
      searchTermCampaignFilter !== "ALL" &&
      searchTermCampaigns.length > 0 &&
      !searchTermCampaigns.includes(searchTermCampaignFilter)
    ) {
      setSearchTermCampaignFilter("ALL");
    }
  }, [searchTermCampaigns, searchTermCampaignFilter]);

  // Filtered & Sorted Search Terms
  const filteredSortedSearchTerms = useMemo(() => {
    let list = [...aggregatedSearchTerms];

    if (searchTermCampaignFilter !== "ALL") {
      list = list.filter((t) => t.campaignName === searchTermCampaignFilter);
    }

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

    const minClicks = termMinClicks.trim() !== "" ? parseFloat(termMinClicks) : null;
    const maxClicks = termMaxClicks.trim() !== "" ? parseFloat(termMaxClicks) : null;
    if (minClicks !== null && !isNaN(minClicks)) {
      list = list.filter((t) => (t.clicks || 0) >= minClicks);
    }
    if (maxClicks !== null && !isNaN(maxClicks)) {
      list = list.filter((t) => (t.clicks || 0) <= maxClicks);
    }

    const minOrders = termMinOrders.trim() !== "" ? parseFloat(termMinOrders) : null;
    const maxOrders = termMaxOrders.trim() !== "" ? parseFloat(termMaxOrders) : null;
    if (minOrders !== null && !isNaN(minOrders)) {
      list = list.filter((t) => (t.orders || 0) >= minOrders);
    }
    if (maxOrders !== null && !isNaN(maxOrders)) {
      list = list.filter((t) => (t.orders || 0) <= maxOrders);
    }

    const minAcos = termMinAcos.trim() !== "" ? parseFloat(termMinAcos) : null;
    const maxAcos = termMaxAcos.trim() !== "" ? parseFloat(termMaxAcos) : null;
    if (minAcos !== null && !isNaN(minAcos)) {
      list = list.filter((t) => (t.acos || 0) >= minAcos);
    }
    if (maxAcos !== null && !isNaN(maxAcos)) {
      list = list.filter((t) => (t.acos || 0) <= maxAcos);
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
  }, [
    aggregatedSearchTerms,
    searchTermCampaignFilter,
    matchTypeFilter,
    termPerformanceFilter,
    termMinClicks,
    termMaxClicks,
    termMinOrders,
    termMaxOrders,
    termMinAcos,
    termMaxAcos,
    searchTermQuery,
    termSortField,
    termSortDir,
  ]);

  const isSearchTermFiltered = Boolean(
    searchTermQuery.trim() ||
    searchTermCampaignFilter !== "ALL" ||
    matchTypeFilter !== "ALL" ||
    termPerformanceFilter !== "ALL" ||
    termMinClicks.trim() !== "" ||
    termMaxClicks.trim() !== "" ||
    termMinOrders.trim() !== "" ||
    termMaxOrders.trim() !== "" ||
    termMinAcos.trim() !== "" ||
    termMaxAcos.trim() !== ""
  );

  // Paginated Search Terms
  const totalTermPages = Math.max(1, Math.ceil(filteredSortedSearchTerms.length / termPageSize));
  const paginatedSearchTerms = useMemo(() => {
    const start = (termPage - 1) * termPageSize;
    return filteredSortedSearchTerms.slice(start, start + termPageSize);
  }, [filteredSortedSearchTerms, termPage, termPageSize]);

  // ST Optimization bleeding candidates count (Clicks > 20 & Orders = 0 in source campaign)
  const stOptimizationCandidateCount = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return 0;
    const map = new Map<string, { clicks: number; orders: number }>();
    for (const term of searchTerms) {
      const rawTerm = (term.customerSearchTerm || "").trim().toLowerCase();
      const camp = (term.campaignName || "").trim().toLowerCase();
      if (!rawTerm || !camp) continue;
      const key = `${camp}|||${rawTerm}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { clicks: term.clicks || 0, orders: term.orders || 0 });
      } else {
        existing.clicks += term.clicks || 0;
        existing.orders += term.orders || 0;
      }
    }
    let count = 0;
    for (const item of map.values()) {
      if (item.orders === 0 && item.clicks > 20) {
        count++;
      }
    }
    return count;
  }, [searchTerms]);

  // Sale KW candidate count (Orders > 2 in source campaign)
  const saleKwCandidateCount = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return 0;
    const map = new Map<string, number>();
    for (const term of searchTerms) {
      const rawTerm = (term.customerSearchTerm || "").trim().toLowerCase();
      const camp = (term.campaignName || "").trim().toLowerCase();
      if (!rawTerm || !camp) continue;
      const key = `${camp}|||${rawTerm}`;
      map.set(key, (map.get(key) || 0) + (term.orders || 0));
    }
    let count = 0;
    for (const orders of map.values()) {
      if (orders > 2) {
        count++;
      }
    }
    return count;
  }, [searchTerms]);

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

  // Server-paginated Targets / Keywords (50 rows/page, SQL-aggregated metrics, zero memory bloat)
  const paginatedTargets = serverTargets;
  const filteredSortedTargets = serverTargets;
  const filteredTargetTotals = serverTargetSummary;
  const totalTargetPages = serverTargetTotalPages;

  // Unique row key helper for Targets
  const targetRowKey = useCallback((target: PpcTargetPerformance) => {
    return [
      target.storeId || target.storeName,
      target.adType,
      target.campaignId || target.campaignName,
      target.adGroupId || target.adGroupName,
      target.targetId || target.targetKeyword,
      target.matchType,
    ].join("\u0000");
  }, []);

  // Chọn target để lên camp: giữ cả dòng qua nhiều trang / bộ lọc, Shift + click chọn cả đoạn
  const [selectedTargetRows, setSelectedTargetRows] = useState<Map<string, PpcTargetPerformance>>(new Map());
  const lastTargetSelectIndexRef = useRef<number | null>(null);
  const clearSelectedTargets = useCallback(() => {
    setSelectedTargetRows(new Map());
    lastTargetSelectIndexRef.current = null;
  }, []);

  const toggleTargetSelect = (target: PpcTargetPerformance, index: number, shiftKey = false) => {
    const key = targetRowKey(target);
    const shouldSelect = !selectedTargetRows.has(key);
    const last = lastTargetSelectIndexRef.current;
    const range = shiftKey && last !== null && last < serverTargets.length
      ? serverTargets.slice(Math.min(last, index), Math.max(last, index) + 1)
      : [target];
    const next = new Map(selectedTargetRows);
    for (const row of range) {
      if (shouldSelect) next.set(targetRowKey(row), row);
      else next.delete(targetRowKey(row));
    }
    lastTargetSelectIndexRef.current = index;
    setSelectedTargetRows(next);
  };

  const isTargetPageAllSelected = serverTargets.length > 0 && serverTargets.every((t) => selectedTargetRows.has(targetRowKey(t)));
  const toggleSelectAllTargets = () => {
    const next = new Map(selectedTargetRows);
    if (isTargetPageAllSelected) serverTargets.forEach((t) => next.delete(targetRowKey(t)));
    else serverTargets.forEach((t) => next.set(targetRowKey(t), t));
    setSelectedTargetRows(next);
  };

  const selectedTargetLaunchRows = useMemo(
    () => Array.from(selectedTargetRows.values()).map((t) => ({ ...t, customerSearchTerm: t.targetKeyword })),
    [selectedTargetRows],
  );

  // Helper normalizers for high-speed term-target matching
  const normStr = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const normalizeTargetVal = (val: string | undefined | null) => {
    if (!val) return "";
    let s = val.toLowerCase().trim();
    s = s.replace(/^["'\[]+|["'\]]+$/g, "").trim();
    const asinMatch = s.match(/^asin\s*=\s*["']?([a-z0-9]{10})["']?$/i);
    if (asinMatch) return asinMatch[1];
    return s.replace(/\s+/g, " ");
  };
  const normalizeMatchTypeVal = (m: string | undefined | null) => {
    const s = (m || "").toLowerCase().trim();
    if (s.includes("exact")) return "exact";
    if (s.includes("phrase")) return "phrase";
    if (s.includes("broad")) return "broad";
    if (s.includes("auto")) return "auto";
    if (s.includes("target")) return "targeting";
    return "unknown";
  };

  // Pre-index search terms into O(1) Hash Maps by Amazon IDs and Target expressions
  const {
    searchTermsByAdGroup,
    searchTermsByCampaign,
    searchTermsByCampaignId,
    searchTermsByAdGroupId,
    searchTermsByKeywordId,
    searchTermsByTargetKey,
  } = useMemo(() => {
    childTermsCacheRef.current.clear();
    const byAg = new Map<string, PpcSearchTermRow[]>();
    const byCamp = new Map<string, PpcSearchTermRow[]>();
    const byCampId = new Map<string, PpcSearchTermRow[]>();
    const byAgId = new Map<string, PpcSearchTermRow[]>();
    const byKwId = new Map<string, PpcSearchTermRow[]>();
    const byTargetKey = new Map<string, PpcSearchTermRow[]>();

    const append = (map: Map<string, PpcSearchTermRow[]>, key: string, term: PpcSearchTermRow) => {
      const list = map.get(key);
      if (list) list.push(term);
      else map.set(key, [term]);
    };

    for (const term of searchTerms) {
      const storeKey = (term.storeId || term.storeName || "").trim().toLowerCase();
      const camp = normStr(term.campaignName);
      const ag = normStr(term.adGroupName);
      const campaignId = (term.campaignId || "").trim();
      const adGroupId = (term.adGroupId || "").trim();
      const kwId = (term.keywordId || "").trim();
      const kwNorm = normalizeTargetVal(term.targetKeyword);
      const matchTypeNorm = normalizeMatchTypeVal(term.matchType);

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

      // O(1) Exact Keyword ID lookup
      if (kwId) {
        append(byKwId, kwId, term);
        if (campaignId) append(byKwId, `${campaignId}\u0000${kwId}`, term);
      }

      // O(1) Target Expression + Match Type lookup
      if (kwNorm) {
        if (campaignId && adGroupId) {
          append(byTargetKey, `${campaignId}\u0000${adGroupId}\u0000${kwNorm}\u0000${matchTypeNorm}`, term);
        }
        if (campaignId) {
          append(byTargetKey, `${campaignId}\u0000${kwNorm}\u0000${matchTypeNorm}`, term);
        }
        if (camp) {
          append(byTargetKey, `${camp}\u0000${kwNorm}\u0000${matchTypeNorm}`, term);
        }
      }
    }
    return {
      searchTermsByAdGroup: byAg,
      searchTermsByCampaign: byCamp,
      searchTermsByCampaignId: byCampId,
      searchTermsByAdGroupId: byAgId,
      searchTermsByKeywordId: byKwId,
      searchTermsByTargetKey: byTargetKey,
    };
  }, [searchTerms]);

  // Search terms attribution: O(1) Hash Map with conservative inference fallback
  const getChildSearchTerms = useCallback((target: PpcTargetPerformance) => {
    const targetKwNorm = normalizeTargetVal(target.targetKeyword);
    const targetId = (target.targetId || "").trim();
    const targetCampaignId = (target.campaignId || "").trim();
    const targetAdGroupId = (target.adGroupId || "").trim();
    const targetMatchType = normalizeMatchTypeVal(target.matchType);
    const campNorm = normStr(target.campaignName);

    const cacheKey = `${targetId}\u0000${targetCampaignId}\u0000${targetAdGroupId}\u0000${targetKwNorm}\u0000${targetMatchType}`;
    const cached = childTermsCacheRef.current.get(cacheKey);
    if (cached) return cached;

    // Fast-path 1: O(1) lookup by exact Amazon Keyword / Target ID
    if (targetId) {
      const byId = (targetCampaignId ? searchTermsByKeywordId.get(`${targetCampaignId}\u0000${targetId}`) : null) ||
        searchTermsByKeywordId.get(targetId);
      if (byId && byId.length > 0) {
        const res = { confirmed: byId, inferred: [] as PpcSearchTermRow[] };
        childTermsCacheRef.current.set(cacheKey, res);
        return res;
      }
    }

    // Fast-path 2: O(1) lookup by Target Keyword Expression + Match Type
    if (targetKwNorm) {
      const byKey = (targetCampaignId && targetAdGroupId ? searchTermsByTargetKey.get(`${targetCampaignId}\u0000${targetAdGroupId}\u0000${targetKwNorm}\u0000${targetMatchType}`) : null) ||
        (targetCampaignId ? searchTermsByTargetKey.get(`${targetCampaignId}\u0000${targetKwNorm}\u0000${targetMatchType}`) : null) ||
        (campNorm ? searchTermsByTargetKey.get(`${campNorm}\u0000${targetKwNorm}\u0000${targetMatchType}`) : null);
      if (byKey && byKey.length > 0) {
        const res = { confirmed: byKey, inferred: [] as PpcSearchTermRow[] };
        childTermsCacheRef.current.set(cacheKey, res);
        return res;
      }
    }

    // Fallback: Scoped candidate pool inference
    const idAgKey = `${targetCampaignId}\u0000${targetAdGroupId}`;
    let candidates: PpcSearchTermRow[];
    if (targetCampaignId && targetAdGroupId && searchTermsByAdGroupId.has(idAgKey)) {
      candidates = searchTermsByAdGroupId.get(idAgKey)!;
    } else if (targetCampaignId && searchTermsByCampaignId.has(targetCampaignId)) {
      candidates = searchTermsByCampaignId.get(targetCampaignId)!;
    } else if (campNorm && searchTermsByCampaign.has(campNorm)) {
      candidates = searchTermsByCampaign.get(campNorm)!;
    } else {
      candidates = searchTerms;
    }

    const confirmed: PpcSearchTermRow[] = [];
    const inferred: PpcSearchTermRow[] = [];

    for (const term of candidates) {
      const termKwNorm = normalizeTargetVal(term.targetKeyword);
      const termTargetId = (term.keywordId || "").trim();

      if (targetId && termTargetId && targetId === termTargetId) {
        confirmed.push(term);
        continue;
      }
      if (termKwNorm && termKwNorm === targetKwNorm) {
        confirmed.push(term);
      }
    }

    const res = { confirmed, inferred };
    childTermsCacheRef.current.set(cacheKey, res);
    return res;
  }, [searchTerms, searchTermsByAdGroupId, searchTermsByCampaignId, searchTermsByCampaign, searchTermsByKeywordId, searchTermsByTargetKey]);

  // Filtered & Sorted SKUs
  const activeSkuPerformance = useMemo(() => {
    return hidePausedSkus
      ? skuPerformance.filter((s) => s.impressions > 0 || s.clicks > 0 || s.spend > 0)
      : skuPerformance;
  }, [skuPerformance, hidePausedSkus]);

  const skuMockupBySku = useMemo(
    () => new Map(activeSkuPerformance.filter((s) => s.mockupUrl).map((s) => [s.sku, s.mockupUrl as string])),
    [activeSkuPerformance],
  );

  // Ảnh mockup nhỏ cho bảng SKU bán tốt / cần chú ý: hover xem lớn, bấm để phóng to (cùng kiểu bảng SKU)
  const renderOverviewSkuThumb = (sku: string, url?: string | null) =>
    url ? (
      <div
        className="relative shrink-0 cursor-pointer group/thumb"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoveredMockup({ url, sku, rect: { top: r.top, right: r.right } });
        }}
        onMouseLeave={() => setHoveredMockup(null)}
        onClick={() => setPreviewModalMockup({ url, sku })}
        title="Nhấn để xem ảnh phóng to"
      >
        <img
          src={getOptimizedThumbnailUrl(url, 80) || url}
          alt={sku}
          className="h-9 w-9 rounded-md border border-slate-200 object-cover shadow-2xs transition-all group-hover/thumb:border-indigo-500 group-hover/thumb:ring-2 group-hover/thumb:ring-indigo-200"
          loading="lazy"
        />
      </div>
    ) : (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300">
        <Tag size={14} />
      </div>
    );

  const overviewTopSkus = useMemo(() => {
    return activeSkuPerformance
      .filter((sku) => sku.orders > 0 && sku.acos <= targetAcos)
      .sort((a, b) => b.sales - a.sales || b.orders - a.orders)
      .slice(0, 5);
  }, [activeSkuPerformance, targetAcos]);

  const skuNicheOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of activeSkuPerformance) {
      const n = (s.niche || "").trim();
      if (n) {
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [activeSkuPerformance]);

  const skuPicOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of activeSkuPerformance) {
      const pic = (s.picMkt || "").trim();
      if (pic) counts.set(pic, (counts.get(pic) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [activeSkuPerformance]);

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
    if (skuNicheFilter !== "ALL") {
      list = list.filter((s) => (s.niche || "").trim() === skuNicheFilter);
    }
    if (skuPicFilter !== "ALL") {
      list = list.filter((s) => (s.picMkt || "").trim() === skuPicFilter);
    }
    if (skuQuery.trim()) {
      const tokens = skuQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((s) => {
        const text = `${s.sku} ${s.storeName} ${s.asin || ""} ${s.productType || ""} ${s.niche || ""} ${s.picMkt || ""}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }
    list.sort((a, b) => {
      const valA = a[skuSortField];
      const valB = b[skuSortField];
      return skuSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [activeSkuPerformance, skuCategoryFilter, skuNicheFilter, skuPicFilter, skuQuery, skuSortField, skuSortDir]);

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
  // Shift + click chọn / bỏ chọn cả đoạn từ dòng bấm trước đó
  const toggleTermSelect = (term: PpcSearchTermRow, index: number, shiftKey = false) => {
    const visible = serverSearchTerms || paginatedSearchTerms;
    const key = searchTermKey(term);
    const shouldSelect = !selectedTermRows.has(key);
    const last = lastTermSelectIndexRef.current;
    const range = shiftKey && last !== null && last < visible.length
      ? visible.slice(Math.min(last, index), Math.max(last, index) + 1)
      : [term];
    const next = new Map(selectedTermRows);
    for (const row of range) {
      if (shouldSelect) next.set(searchTermKey(row), row);
      else next.delete(searchTermKey(row));
    }
    lastTermSelectIndexRef.current = index;
    setSelectedTermRows(next);
  };

  const toggleSelectAllVisible = () => {
    const visible = serverSearchTerms || paginatedSearchTerms;
    const next = new Map(selectedTermRows);
    if (visible.length > 0 && visible.every((term) => next.has(searchTermKey(term)))) {
      visible.forEach((term) => next.delete(searchTermKey(term)));
    } else {
      visible.forEach((term) => next.set(searchTermKey(term), term));
    }
    setSelectedTermRows(next);
  };

  // Bảng tổng khi tìm theo SKU: chọn 1 / tất cả keyword để lên camp (gắn SKU nếu chỉ có 1 SKU)
  const termGroupSelection = useKeywordGroupSelection();
  const targetGroupSelection = useKeywordGroupSelection();
  const withSummarySku = (groups: KeywordGroupRow[] | null | undefined, skuGroups: Array<{ sku: string }> | undefined) => {
    const sku = skuGroups?.length === 1 ? skuGroups[0].sku : undefined;
    return (groups || []).map((g) => ({ ...g, sku }));
  };
  const sortedTermKeywordGroups = withSummarySku(
    serverSearchTermSummary?.keywordGroups ? searchTermSummarySort.sortKeywordGroups(serverSearchTermSummary.keywordGroups) : null,
    serverSearchTermSummary?.skuGroups,
  );
  const sortedTargetKeywordGroups = withSummarySku(
    serverTargetSummary?.keywordGroups ? targetSummarySort.sortKeywordGroups(serverTargetSummary.keywordGroups) : null,
    serverTargetSummary?.skuGroups,
  );
  const groupLaunchRows = (selected: Map<string, KeywordGroupRow & { sku?: string }>) =>
    Array.from(selected.values()).map((g) => ({
      customerSearchTerm: g.targetKeyword ?? g.customerSearchTerm ?? "",
      campaignName: g.campaignName || "",
      sku: g.sku,
      clicks: g.clicks,
      spend: g.spend,
      orders: g.orders,
      reportDate: g.reportDate,
      grouped: true,
    }));

  const launchKnownSkus = useMemo(() => {
    const skus = new Set<string>();
    for (const term of searchTerms) {
      const sku = resolveSkuForSearchTerm(term);
      if (sku && sku !== "UNKNOWN_SKU") skus.add(sku);
    }
    return Array.from(skus).sort();
  }, [searchTerms]);

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
      header = "Customer Search Term,Match Type,SKU / Portfolio,Campaign,SV,Org Rank,Spon Rank,Clicks,Spend ($),Sales ($),Orders,CTR (%),CVR (%),ACOS (%)\n";
      rows = filteredSortedSearchTerms.map((t) => {
        const termSafe = `"${t.customerSearchTerm.replace(/"/g, '""')}"`;
        const portSafe = `"${(t.portfolioName || "").replace(/"/g, '""')}"`;
        const campSafe = `"${t.campaignName.replace(/"/g, '""')}"`;
        const sv = t.searchVolume ?? "";
        const org = (t as any).organicRank ? `#${(t as any).organicRank}` : "";
        const spon = (t as any).sponsoredRank ? `#${(t as any).sponsoredRank}` : "";
        return `${termSafe},"${t.matchType}",${portSafe},${campSafe},${sv},"${org}","${spon}",${t.clicks},${t.spend.toFixed(2)},${t.sales.toFixed(2)},${t.orders},${(t.ctr * 100).toFixed(2)},${(t.cvr * 100).toFixed(1)},${t.acos.toFixed(1)}`;
      });
      const cleanStore = (selectedStore && selectedStore !== "ALL" ? selectedStore : "ALL").replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
      filename = `ppc-search-terms-${cleanStore}-${Date.now()}.csv`;
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
      const cleanStore = (selectedStore && selectedStore !== "ALL" ? selectedStore : "ALL").replace(/[/\\?%*:|"<>]/g, "_").trim().replace(/\s+/g, "_");
      filename = `ppc-skus-${cleanStore}-${Date.now()}.csv`;
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
    <div className={`font-accounting-system w-full space-y-3.5 text-slate-800 ${!isEmbedded ? "max-w-7xl mx-auto p-6" : ""}`}>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-20 right-6 z-50 text-white px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-bold border animate-in fade-in ${toast.type === "error"
          ? "bg-rose-900 border-rose-700"
          : toast.type === "info"
            ? "bg-indigo-950 border-indigo-700 text-indigo-100"
            : "bg-slate-900 border-slate-700"
          }`}>
          {toast.type === "error" ? (
            <X size={16} weight="bold" className="text-rose-200 shrink-0" />
          ) : toast.type === "info" ? (
            <Info size={16} weight="bold" className="text-indigo-300 shrink-0" />
          ) : (
            <CheckCircle size={16} weight="fill" className="text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Animated Progress Bar when loading */}
      {(loading || isStoreSwitching || loadingSection !== null) && (
        <div className="fixed top-0 left-0 right-0 h-1 z-50 overflow-hidden bg-indigo-100 shadow-xs">
          <div className="h-full bg-gradient-to-r from-indigo-500 via-sky-400 to-indigo-600 animate-[pulse_1s_ease-in-out_infinite] w-full" />
        </div>
      )}

      {/* MASTER TOP CONTROL BAR - UNIFIED 1-ROW HEADER */}
      <div className={`border border-slate-200/90 bg-white/95 backdrop-blur-md shadow-2xs ${
        isEmbedded
          ? "sticky -top-3 sm:-top-4 md:-top-6 z-40 -mt-3 sm:-mt-4 md:-mt-6 -mx-3 sm:-mx-4 md:-mx-6 mb-3 sm:mb-4 px-3 sm:px-5 py-2 border-x-0 border-t-0"
          : "rounded-xl p-2.5 mb-4"
      }`}>
        <div className="flex items-center justify-between gap-2 sm:gap-3 flex-wrap lg:flex-nowrap">
          {/* Cụm Trái: Title + Phân cách + Chọn Store */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {onOpenMobileNav && (
              <button
                type="button"
                onClick={onOpenMobileNav}
                className="flex lg:hidden h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition cursor-pointer shrink-0"
                title="Mở menu điều hướng"
                aria-label="Mở menu điều hướng"
              >
                <ListIcon size={18} weight="bold" />
              </button>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:flex h-2.5 w-2.5 rounded-full bg-indigo-600 ring-4 ring-indigo-100 shrink-0" />
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-800 truncate max-w-[140px] xs:max-w-[200px] md:max-w-none">
                {tabTitle}
              </h2>
            </div>

            <div className="hidden sm:block h-4 w-px bg-slate-200 shrink-0" />

            {/* Store dropdown */}
            <div ref={storeDropdownContainerRef} className="relative shrink-0">
              <button
                ref={storeSelectRef}
                type="button"
                onClick={() => setIsStoreDropdownOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 sm:gap-2 rounded-xl px-2.5 sm:px-3 py-1.5 transition-all duration-200 cursor-pointer select-none ${isStoreHighlight
                    ? "ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50 text-emerald-950 shadow-md scale-105"
                    : isStoreDropdownOpen
                      ? "bg-emerald-100 border border-emerald-400 text-emerald-950 shadow-xs"
                      : "bg-emerald-50/90 hover:bg-emerald-100/90 border border-emerald-300/90 shadow-2xs text-emerald-950"
                  }`}
              >
                <Storefront
                  size={17}
                  className={isStoreHighlight ? "text-emerald-600 animate-bounce shrink-0" : "text-emerald-600 shrink-0"}
                  weight="fill"
                />
                <span className="text-[10px] sm:text-[11px] font-extrabold text-emerald-700 uppercase tracking-wider hidden xs:inline">Store:</span>
                <span className="font-black text-emerald-900 text-xs sm:text-sm tracking-tight truncate max-w-[100px] sm:max-w-[180px]">
                  {selectedStore === "ALL" ? `All Stores (${stores.length})` : selectedStore}
                </span>
                <CaretDown
                  size={12}
                  weight="bold"
                  className={`text-emerald-700 transition-transform duration-200 shrink-0 ${isStoreDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {/* Smooth Custom Dropdown Menu */}
              {isStoreDropdownOpen && (
                <div
                  className="absolute left-0 top-full mt-1.5 w-64 z-50 rounded-2xl bg-white border border-slate-200/90 shadow-xl p-1.5 transition-all animate-in fade-in zoom-in-95 duration-150 origin-top-left"
                  role="menu"
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1 flex items-center justify-between">
                    <span>Chọn gian hàng</span>
                    <span className="text-[9px] font-semibold text-slate-400">{stores.length} stores</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-0.5 thin-scrollbar">
                    <button
                      type="button"
                      onClick={() => {
                        handleStoreChange("ALL");
                        setIsStoreDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-left ${selectedStore === "ALL"
                          ? "bg-emerald-600 text-white font-black shadow-xs"
                          : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-900"
                        }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Storefront size={16} weight={selectedStore === "ALL" ? "bold" : "regular"} className="shrink-0" />
                        <span className="truncate">All Stores</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${selectedStore === "ALL" ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"
                        }`}>
                        {stores.length}
                      </span>
                    </button>

                    {stores.map((s) => {
                      const isSelected = selectedStore === s.name;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            handleStoreChange(s.name);
                            setIsStoreDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer text-left ${isSelected
                              ? "bg-emerald-600 text-white font-black shadow-xs"
                              : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-900"
                            }`}
                        >
                          <span className="truncate">{s.name}</span>
                          {isSelected && <Check size={14} weight="bold" className="shrink-0 ml-2" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cụm Phải: Chọn Kỳ thời gian (Pills) + Sync time + Thao tác + Bell + AccountMenu */}
          <div className="flex items-center gap-1.5 sm:gap-2 justify-end shrink-0 ml-auto lg:ml-0">
            {/* Chọn Kỳ Thời Gian: Segmented Pill */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
              {[7, 14, 30, 60].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setIsCustomDate(false);
                    setSelectedDays(d);
                  }}
                  className={`px-2 sm:px-2.5 py-1 rounded-md transition cursor-pointer text-xs ${!isCustomDate && selectedDays === d
                      ? "bg-white text-indigo-700 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900"
                    }`}
                >
                  {d}D
                </button>
              ))}
            </div>

            {/* Sync Time */}
            {lastSyncedAt && (
              <div className="hidden xl:flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600" title="Thời gian đồng bộ dữ liệu gần nhất">
                <Clock size={12} className="text-slate-400 shrink-0" weight="bold" />
                <span className="font-mono font-bold text-[11px] text-slate-700">
                  {formatSyncTime(lastSyncedAt)}
                </span>
              </div>
            )}

            {/* Compact Action Dropdown */}
            <div className="relative" ref={actionDropdownRef}>
              <button
                type="button"
                onClick={() => setShowActionDropdown((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs"
                title="Công cụ & Thao tác (Tự động AdsPower, Đồng bộ R2, Nạp báo cáo PPC...)"
              >
                <DotsThreeVertical size={14} weight="bold" className="text-slate-500" />
                <span className="hidden sm:inline">Thao tác</span>
                <CaretDown size={10} weight="bold" className="text-slate-400" />
              </button>

              {showActionDropdown && (
                <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowActionDropdown(false);
                      void handleSyncAdsPower();
                    }}
                    disabled={syncingAdsPower}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                  >
                    <ArrowsClockwise size={14} className={syncingAdsPower ? "animate-spin text-emerald-600" : "text-emerald-600"} weight="bold" />
                    <span>{syncingAdsPower ? "Đang tải AdsPower..." : "Tự động AdsPower"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowActionDropdown(false);
                      void handleSyncR2();
                    }}
                    disabled={syncingR2}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
                  >
                    <ArrowsClockwise size={14} className={syncingR2 ? "animate-spin text-indigo-600" : "text-indigo-600"} weight="bold" />
                    <span>{syncingR2 ? "Đang đồng bộ..." : "Đồng bộ R2"}</span>
                  </button>

                  <div className="h-px bg-slate-100 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setShowActionDropdown(false);
                      setShowUploadModal(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <UploadSimple size={14} className="text-sky-600" weight="bold" />
                    <span>Nạp báo cáo PPC</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowActionDropdown(false);
                      setShowFileManagerModal(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <FolderSimple size={14} className="text-amber-600" weight="bold" />
                    <span>Quản lý File</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowActionDropdown(false);
                      setShowStoreManagerModal(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <Gear size={14} className="text-slate-500" weight="bold" />
                    <span>Quản lý Store</span>
                  </button>

                  <a
                    href={`/api/ppc/seed?storeName=${encodeURIComponent(selectedStore !== "ALL" ? selectedStore : "Bozspacer")}`}
                    download
                    onClick={() => setShowActionDropdown(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    <Download size={14} className="text-slate-500" weight="bold" />
                    <span>Tải Template</span>
                  </a>
                </div>
              )}
            </div>

            <PpcNotificationPopover onRefreshParent={() => void refreshData()} />

            {/* Phân cách + User Account Menu */}
            {isEmbedded && (
              <>
                <div className="hidden sm:block h-4 w-px bg-slate-200 shrink-0 ml-0.5" />
                <div className="shrink-0">
                  {actor ? (
                    <AccountMenu actor={actor} />
                  ) : (
                    <AccountMenu
                      actor={{
                        teamId: "default",
                        userId: "guest",
                        displayName: "User",
                        role: "admin",
                        ruleProfile: "",
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>


      {!standaloneTab && !loading && overviewSearchTerms.length === 0 && (!dataHealth || dataHealth.performanceRows === 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Chưa có dữ liệu PPC trong {selectedDays} ngày gần nhất.</strong>{" "}
          Hãy nạp Bulk SP/SB và Search Term SP/SB hoặc đồng bộ từ R2. Hệ thống không tự chèn dữ liệu mẫu.
        </div>
      )}

      {/* SKELETON LOADING STATE */}
      {!standaloneTab && loading && !summary && (
        <PpcOverviewSkeleton />
      )}

      {/* NẾU ĐANG Ở CHẾ ĐỘ XEM TẤT CẢ SHOP VÀ TAB TỔNG QUAN: HIỂN THỊ GIAO DIỆN MULTI-STORE HUB */}
      {!standaloneTab && selectedStore === "ALL" && activeTab === "overview" && (
        <PpcMultiStoreView
          storeSummaries={storeSummaries}
          summary={summary}
          dailyTrends={dailyTrends}
          adTypeBreakdown={adTypeBreakdown}
          searchTerms={overviewSearchTerms}
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
            handleStoreChange(storeName);
          }}
          onRefreshStores={() => void refreshData()}
          currency="$"
        />
      )}

      {/* EXECUTIVE KPI CARDS (CHỈ HIỂN THỊ KHI Ở TAB TỔNG QUAN CỦA 1 SHOP CỤ THỂ, ẨN KHI Ở TÍNH NĂNG ĐỘC LẬP HOẶC TAB CHI TIẾT) */}
      {!standaloneTab && activeTab === "overview" && selectedStore !== "ALL" && summary && ((dataHealth?.campaignRows || 0) > 0 || overviewSearchTerms.length > 0) && (
        <div className="space-y-3">
          {(dataHealth?.campaignRows || 0) === 0 && overviewSearchTerms.length > 0 && (
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

      {/* 2 BIỂU ĐỒ CỐT LÕI PPC DASHBOARD THEO SPEC KỸ THUẬT (CHỈ HIỂN THỊ KHI Ở TAB TỔNG QUAN CỦA 1 SHOP CỤ THỂ) */}
      {!standaloneTab && activeTab === "overview" && selectedStore !== "ALL" && mounted && summary && ((dataHealth?.campaignRows || 0) > 0 || overviewSearchTerms.length > 0) && (
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



      {/* ========================================================================= */}
      {/* VIEW 1: OVERVIEW SUMMARY TABLE (CHỈ HIỂN THỊ KHI ĐANG XEM TỔNG QUAN 1 SHOP CỤ THỂ) */}
      {/* ========================================================================= */}
      {!standaloneTab && activeTab === "overview" && selectedStore !== "ALL" && (
        <div className="space-y-3">
          {/* Quick High-Impact Table: Strong vs weak SKU performance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top 5 best-selling SKUs */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <h4 className="text-xs font-black uppercase text-emerald-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  SKU bán tốt
                  <span className="normal-case text-[9px] font-semibold text-slate-400">Có đơn, ACOS &le; {targetAcos.toFixed(1)}%</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setSkuCategoryFilter("ALL");
                    setSkuSortField("sales");
                    setSkuSortDir("desc");
                    setActiveTab("skus");
                  }}
                  className="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
                >
                  Xem tất cả →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                      <th className="py-1.5">SKU</th>
                      <th className="py-1.5 text-right">Spend</th>
                      <th className="py-1.5 text-right">Orders</th>
                      <th className="py-1.5 text-right">Sales</th>
                      <th className="py-1.5 text-right">ACOS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {overviewTopSkus.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-[11px] text-slate-400">
                          Chưa có SKU đạt mục tiêu trong kỳ này.
                        </td>
                      </tr>
                    ) : overviewTopSkus.map((sku) => (
                      <tr key={`${sku.storeName || selectedStore}-${sku.sku}`} className="hover:bg-slate-50">
                        <td className="py-1.5 font-bold text-slate-800 max-w-[200px]">
                          <div className="flex items-center gap-2 min-w-0">
                            {renderOverviewSkuThumb(sku.sku, sku.mockupUrl)}
                            <span className="truncate" title={sku.sku}>{sku.sku}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right text-slate-700">${sku.spend.toFixed(2)}</td>
                        <td className="py-1.5 text-right font-normal text-slate-800">{sku.orders}</td>
                        {/* Màu đặt trên span: CSS bảng chung ép màu chữ của td */}
                        <td className="py-1.5 text-right font-normal"><span className="text-emerald-600">${sku.sales.toFixed(2)}</span></td>
                        <td className="py-1.5 text-right">
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200"
                            title={`Mục tiêu ACOS ≤ ${targetAcos.toFixed(1)}%`}
                          >
                            {sku.acos.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 5 SKUs that need attention */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <h4 className="text-xs font-black uppercase text-rose-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  SKU cần chú ý
                  <span className="normal-case text-[9px] font-semibold text-slate-400">ACOS &gt; Break-even ACOS của SKU</span>
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setSkuCategoryFilter("ALL");
                    setSkuSortField("acos");
                    setSkuSortDir("desc");
                    setActiveTab("skus");
                  }}
                  className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  Kiểm tra SKU →
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                      <th className="py-1.5">SKU</th>
                      <th className="py-1.5 text-right">Spend</th>
                      <th className="py-1.5 text-right">Orders</th>
                      <th className="py-1.5 text-right">Sales</th>
                      <th className="py-1.5 text-right">ACOS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {loadingOverviewWeakSkus ? (
                      Array.from({ length: 5 }).map((_, index) => (
                        <tr key={`attention-sku-skeleton-${index}`} aria-hidden="true">
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="h-9 w-9 animate-pulse rounded-md bg-slate-100" />
                              <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
                            </div>
                          </td>
                          <td className="py-2 pl-4"><div className="ml-auto h-3 w-14 animate-pulse rounded bg-slate-100" /></td>
                          <td className="py-2 pl-4"><div className="ml-auto h-3 w-8 animate-pulse rounded bg-slate-100" /></td>
                          <td className="py-2 pl-4"><div className="ml-auto h-3 w-14 animate-pulse rounded bg-slate-100" /></td>
                          <td className="py-2 pl-4"><div className="ml-auto h-4 w-12 animate-pulse rounded bg-rose-50" /></td>
                        </tr>
                      ))
                    ) : overviewWeakSkus.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-[11px] text-slate-400">
                          Không có SKU vượt ngưỡng cảnh báo.
                        </td>
                      </tr>
                    ) : overviewWeakSkus.map((sku) => (
                      <tr key={`${selectedStore}-${sku.sku}`} className="hover:bg-slate-50">
                        <td className="py-1.5 font-bold text-slate-800 max-w-[200px]">
                          <div className="flex items-center gap-2 min-w-0">
                            {renderOverviewSkuThumb(sku.sku, skuMockupBySku.get(sku.sku))}
                            <span className="truncate" title={sku.sku}>{sku.sku}</span>
                          </div>
                        </td>
                        <td className="py-1.5 text-right font-normal"><span className="text-rose-700">${sku.spend.toFixed(2)}</span></td>
                        <td className="py-1.5 text-right font-normal text-slate-800">{sku.orders}</td>
                        <td className="py-1.5 text-right font-normal text-slate-700">${sku.sales.toFixed(2)}</td>
                        <td className="py-1.5 text-right">
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200"
                            title={`Break-even ACoS: ${sku.breakEvenAcos.toFixed(1)}%`}
                          >
                            {sku.acos.toFixed(1)}%
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
      {storeRequired && (
        <div className="p-8 text-center bg-amber-50/80 rounded-2xl border border-amber-200 space-y-3 my-4 shadow-2xs">
          <Storefront size={36} className="mx-auto text-amber-600" weight="duotone" />
          <h3 className="text-sm font-bold text-amber-950">Vui lòng chọn một Store cụ thể</h3>
          <p className="text-xs text-amber-800 max-w-lg mx-auto">
            Bảng Campaign, Target, Search Term và SKU chỉ xem theo từng Store. Ở All Stores chỉ có trang Tổng quan.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleStoreChange(s.name)}
                className="px-3.5 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-100 hover:border-amber-400 transition cursor-pointer shadow-xs"
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {mountedTabs.has("campaigns") && (
        <div id="ppc-campaigns-section" className={activeTab === "campaigns" && !storeRequired ? "space-y-3.5 scroll-mt-6" : "hidden"}>
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

            <div className="flex shrink-0 items-center gap-2">
              {campaignFrozen.columnPicker}
              <button
                type="button"
                onClick={() => handleExportCsv("campaigns")}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Download size={14} /> Xuất CSV
              </button>
            </div>
          </div>

          {/* Live Metrics Strip for Filtered Campaigns (Tone Xanh - Trắng) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 p-2.5 rounded-xl bg-gradient-to-r from-blue-50/80 via-indigo-50/50 to-sky-50/60 border border-blue-100 shadow-2xs text-xs">
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Campaigns</div>
              <div className="text-base font-black text-slate-900 mt-0.5">{filteredCampaignTotals.count.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                {campaignStatusFilter === "ACTIVE" ? "Active" : campaignStatusFilter === "PAUSED" ? "Paused" : "All"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Impressions</div>
              <div className="text-base font-black text-slate-900 mt-0.5">{filteredCampaignTotals.impressions.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                CTR {filteredCampaignTotals.ctr.toFixed(2)}% · {filteredCampaignTotals.clicks.toLocaleString()} clicks
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Spend</div>
              <div className="text-base font-black text-rose-600 mt-0.5">${filteredCampaignTotals.spend.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                CPC ${filteredCampaignTotals.clicks > 0 ? (filteredCampaignTotals.spend / filteredCampaignTotals.clicks).toFixed(2) : "0.00"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Sales</div>
              <div className="text-base font-black text-emerald-600 mt-0.5">${filteredCampaignTotals.sales.toFixed(2)}</div>
              <div className="text-[10px] text-slate-500 font-medium">{filteredCampaignTotals.orders} orders</div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Orders</div>
              <div className="text-base font-black text-indigo-700 mt-0.5">{filteredCampaignTotals.orders}</div>
              <div className="text-[10px] text-slate-500 font-medium">
                {filteredCampaignTotals.clicks > 0
                  ? `${((filteredCampaignTotals.orders / filteredCampaignTotals.clicks) * 100).toFixed(1)}% CVR`
                  : "0% CVR"}
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-white border border-blue-100/80 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-blue-700/80 tracking-wide">Avg ACOS</div>
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
              <div className="text-[10px] text-slate-500 font-medium">Target ≤ {targetAcos}%</div>
            </div>
          </div>

          {/* Campaigns Data Table */}
          <div className={`overflow-auto max-h-[calc(100vh-120px)] rounded-xl border border-slate-200 bg-white shadow-2xs transition-opacity ${loadingCampaignPage ? "opacity-60" : "opacity-100"}`} aria-busy={loadingCampaignPage}>
            <table ref={campaignFrozen.tableRef} className="w-full text-left text-xs text-slate-700">
              <thead title="Chuột phải vào tiêu đề cột để khóa cột" className="sticky top-0 z-30 shadow-[0_1px_0_0_rgb(226,232,240)] bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
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
              <tbody className="divide-y divide-slate-100 font-normal">
                {(loading || isStoreSwitching || loadingSection === "campaigns" || loadingCampaignPage) ? (
                  <tr>
                    <td colSpan={14} className="py-16 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={26} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-sm text-slate-800">Đang tải danh sách Campaign cho {selectedStore === "ALL" ? "tất cả store" : selectedStore}...</span>
                        <span className="text-xs text-slate-400">Vui lòng đợi giây lát trong khi hệ thống đồng bộ dữ liệu</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredSortedCampaigns.length === 0 ? (
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
                        {/* Campaign Name: Clickable to view Targets directly (IN ĐẬM) */}
                        <td className="py-2.5 px-3.5 min-w-[280px] max-w-[550px] col-primary font-bold">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCampaignForDrilldown(c.campaignName);
                              setSelectedCampaignIdForDrilldown(c.campaignId || null);
                              setSelectedAdGroupForDrilldown(null);
                              setTargetQuery("");
                              setTargetPage(1);
                              setActiveTab("targets");
                            }}
                            className="text-left font-bold text-slate-900 hover:text-indigo-600 hover:underline cursor-pointer transition leading-snug break-words block"
                            title="Nhấn vào tên Campaign để xem các Target / Keyword của Campaign này"
                          >
                            {c.campaignName}
                          </button>
                        </td>

                        <td className="py-2.5 px-3 text-slate-500 font-normal whitespace-nowrap">{c.storeName}</td>

                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-normal bg-slate-100 text-slate-700">
                            {c.adType || "?"} · {c.targetingType}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap font-normal">
                          <div className="font-normal text-slate-700 flex items-center gap-1">
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
                            <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-700 font-normal">
                              {formattedDate}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>

                        {/* Impressions */}
                        <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap font-mono font-normal">
                          {(c.impressions || 0).toLocaleString()}
                        </td>

                        {/* Clicks */}
                        <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap font-mono font-normal">
                          {(c.clicks || 0).toLocaleString()}
                        </td>

                        {/* CTR */}
                        <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap font-mono font-normal">
                          {c.ctr ? `${c.ctr.toFixed(2)}%` : "0.00%"}
                        </td>

                        {/* Spend ($) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700 whitespace-nowrap">
                          ${c.spend.toFixed(2)}
                        </td>
                        {/* Sales ($) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700 whitespace-nowrap">
                          ${c.sales.toFixed(2)}
                        </td>
                        {/* Orders - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700 whitespace-nowrap">{c.orders}</td>
                        {/* CPC - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-600 whitespace-nowrap">${c.cpc.toFixed(2)}</td>
                        {/* CVR - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700 whitespace-nowrap">{c.cvr.toFixed(1)}%</td>

                        {/* ACOS (%) - IN ĐẬM */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${c.acos <= Math.min(20, targetAcos)
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
      {mountedTabs.has("targets") && (
        <div className={activeTab === "targets" && !storeRequired ? "space-y-3" : "hidden"}>
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
                    setSelectedCampaignIdForDrilldown(null);
                    setSelectedAdGroupForDrilldown(null);
                    setTargetPage(1);
                  }}
                  className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 text-xs font-semibold cursor-pointer underline"
                >
                  ✕ Xem tất cả Targets ({detailCounts?.targets ?? serverTargetTotal})
                </button>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex flex-wrap items-center gap-2">
              {/* Keyword Search */}
              <div className="relative flex-1 sm:min-w-[200px] max-w-xs">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => {
                    setTargetQuery(e.target.value);
                    setTargetPage(1);
                  }}
                  placeholder={selectedCampaignForDrilldown ? "Tìm target trong chiến dịch này..." : "Tìm keyword, campaign hoặc SKU..."}
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

              {/* Dropdown chọn nhanh chiến dịch để chỉ tìm kiếm trong chiến dịch đó */}
              <select
                value={selectedCampaignForDrilldown || "ALL"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "ALL") {
                    setSelectedCampaignForDrilldown(null);
                    setSelectedCampaignIdForDrilldown(null);
                  } else {
                    const found = campaignPerformance.find((c) => c.campaignName === val);
                    setSelectedCampaignForDrilldown(val);
                    setSelectedCampaignIdForDrilldown(found?.campaignId || null);
                  }
                  setTargetPage(1);
                }}
                className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer max-w-[240px] truncate"
                title="Lọc nhanh target theo chiến dịch để tìm kiếm tức thì"
              >
                <option value="ALL">Tất cả chiến dịch ({campaignPerformance.length})</option>
                {campaignPerformance.map((c) => (
                  <option key={c.campaignId || c.campaignName} value={c.campaignName}>
                    {c.campaignName}
                  </option>
                ))}
              </select>

              {/* Reset Filters */}
              {(targetQuery || selectedCampaignForDrilldown) && (
                <button
                  type="button"
                  onClick={() => {
                    setTargetQuery("");
                    setSelectedCampaignForDrilldown(null);
                    setSelectedCampaignIdForDrilldown(null);
                    setSelectedAdGroupForDrilldown(null);
                    setTargetPage(1);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  title="Đặt lại tất cả bộ lọc"
                >
                  <X size={13} weight="bold" /> Đặt lại
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                {targetFrozen.columnPicker}
                {selectedStore !== "ALL" && (
                  <PpcSearchTermLaunchPanel
                    selectedRows={[...groupLaunchRows(targetGroupSelection.selected), ...selectedTargetLaunchRows]}
                    storeName={stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.name || selectedStore}
                    storeId={stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.id}
                    selectedSku={selectedSku}
                    knownSkus={launchKnownSkus}
                    actor={actor}
                    notify={notify}
                    onClear={() => { clearSelectedTargets(); targetGroupSelection.clear(); }}
                    onLaunched={() => { clearSelectedTargets(); targetGroupSelection.clear(); }}
                  />
                )}
              </div>
              {/* Results count indicator */}
              <div className="text-xs text-slate-500 font-medium">
                Khớp <span className="font-extrabold text-slate-900">{serverTargetTotal.toLocaleString("vi-VN")}</span>
                {detailCounts?.targets && (targetQuery || selectedCampaignForDrilldown)
                  ? ` / ${detailCounts.targets.toLocaleString("vi-VN")}`
                  : ""}{" "}
                mục
              </div>
            </div>
          </div>

          {/* Totals for the current Target query; detail rows stay separated by campaign. */}
          {targetQuery.trim() && serverTargetSummary && (
            <div className="overflow-auto max-h-[480px] rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full min-w-[1100px] text-left">
                <PpcSummaryTableHead
                  keywordLabel="Target / Keyword"
                  sort={targetSummarySort}
                  selection={serverTargetSummary.keywordGroups ? targetGroupSelection.selectionFor(sortedTargetKeywordGroups) : undefined}
                />
                <tbody className="divide-y divide-slate-100">
                  {targetSummarySort.sortSkuGroups((serverTargetSummary.skuGroups?.length
                    ? serverTargetSummary.skuGroups
                    : [{
                        sku: selectedSku !== "ALL" ? selectedSku : "TẤT CẢ SKU",
                        totalImpressions: serverTargetSummary.impressions,
                        totalClicks: serverTargetSummary.clicks,
                        totalSpend: serverTargetSummary.spend,
                        totalSales: serverTargetSummary.sales,
                        totalOrders: serverTargetSummary.orders,
                        acos: serverTargetSummary.acos,
                        mockupUrl: null,
                      }]
                  ) as SearchTermSkuSummary[]).map((group) => (
                    <tr key={group.sku} className="hover:bg-slate-50/70">
                      <td className="px-3 py-3 text-center">
                        {group.mockupUrl ? (
                          <div
                            className="relative inline-block cursor-pointer group/thumb"
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setHoveredMockup({ url: group.mockupUrl!, sku: group.sku, rect: { top: r.top, right: r.right } });
                            }}
                            onMouseLeave={() => setHoveredMockup(null)}
                            onClick={() => setPreviewModalMockup({ url: group.mockupUrl!, sku: group.sku })}
                            title="Nhấn để xem ảnh phóng to"
                          >
                            <img
                              src={getOptimizedThumbnailUrl(group.mockupUrl, 80) || group.mockupUrl}
                              alt={group.sku}
                              className="h-12 w-12 rounded-lg border border-slate-200 object-cover shadow-2xs group-hover/thumb:border-indigo-500 group-hover/thumb:ring-2 group-hover/thumb:ring-indigo-200 transition-all"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                            <Tag size={17} />
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-sm font-black text-slate-900">{group.sku}</td>
                      <td className="px-3 py-3 text-sm font-bold text-slate-900">{querySummaryLabel(targetQuery, "Tất cả target")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{Number(group.totalImpressions || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{Number(group.totalClicks || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalImpressions > 0 ? ((group.totalClicks / group.totalImpressions) * 100).toFixed(2) : "0.00"}%</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-slate-900">${Number(group.totalSpend || 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-emerald-600">${Number(group.totalSales || 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-slate-900">{Number(group.totalOrders || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalClicks > 0 ? ((group.totalOrders / group.totalClicks) * 100).toFixed(1) : "0.0"}%</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalClicks > 0 ? `$${(group.totalSpend / group.totalClicks).toFixed(2)}` : "-"}</td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={`inline-flex min-w-[68px] justify-center rounded-md px-2 py-1 font-mono text-sm font-black ${
                            group.acos > 500
                              ? "bg-rose-100 text-rose-700"
                              : group.acos < 30
                                ? "bg-emerald-100 text-emerald-700"
                                : group.acos <= 50
                                  ? "bg-amber-200 text-amber-900"
                                  : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {group.acos > 500 ? "0 sales" : `${Number(group.acos || 0).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {serverTargetSummary.keywordGroups && (
                    <PpcKeywordGroupRows
                      groups={sortedTargetKeywordGroups}
                      total={serverTargetSummary.keywordGroupTotal || 0}
                      selection={targetGroupSelection.selectionFor(sortedTargetKeywordGroups)}
                    />
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-auto max-h-[calc(100vh-120px)] rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table ref={targetFrozen.tableRef} className="w-full min-w-[1050px] text-left text-xs text-slate-700">
              <thead title="Chuột phải vào tiêu đề cột để khóa cột" className="sticky top-0 z-30 shadow-[0_1px_0_0_rgb(226,232,240)] border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-3 text-center w-10">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      checked={isTargetPageAllSelected}
                      onChange={toggleSelectAllTargets}
                      title="Chọn tất cả trên trang này"
                    />
                  </th>
                  <th className="px-3 py-3 text-left">Target / Keyword</th>
                  <th className="px-3 py-3 text-left">Campaign</th>
                  <th className="px-3 py-3 text-left">Type</th>
                  <th className="px-3 py-3 text-right">Bid</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("impressions", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                    title="Nhấn để sắp xếp theo lượt hiển thị (Impressions)"
                  >
                    Impression {targetSortField === "impressions" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-2.5 py-3 text-right whitespace-nowrap"
                    title="Search Volume tháng từ Helium 10"
                  >
                    SV
                  </th>
                  <th
                    className="px-2 py-3 text-center whitespace-nowrap"
                    title="Thứ hạng tự nhiên (Organic Rank) của sản phẩm"
                  >
                    Org Rank
                  </th>
                  <th
                    className="px-2 py-3 text-center whitespace-nowrap"
                    title="Thứ hạng quảng cáo (Sponsored Rank) của sản phẩm"
                  >
                    Spon Rank
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("clicks", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                  >
                    Clicks {targetSortField === "clicks" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("ctr", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                    title="Tỷ lệ click trên lượt hiển thị (CTR = Clicks / Impressions)"
                  >
                    CTR (%) {targetSortField === "ctr" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                  >
                    Spend ($) {targetSortField === "spend" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                  >
                    Sales ($) {targetSortField === "sales" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                  >
                    ACOS (%) {targetSortField === "acos" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-3 py-3 text-right">CPC</th>
                  <th className="px-3 py-3 text-right">CVR</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", targetSortField, targetSortDir, setTargetSortField, setTargetSortDir, () => setTargetPage(1))
                    }
                  >
                    Orders {targetSortField === "orders" && (targetSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-2 py-3 text-center whitespace-nowrap w-[60px] min-w-[60px] sticky right-0 z-20 bg-slate-50 border-l border-slate-200 shadow-[-4px_0_8px_rgba(0,0,0,0.04)]">
                    Terms
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(loading || isStoreSwitching || loadingTargetsServer || loadingSection === "targets") ? (
                  <tr>
                    <td colSpan={16} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải danh sách Target / Keyword cho {selectedStore === "ALL" ? "tất cả store" : selectedStore}...</span>
                        <span className="text-[11px] text-slate-400">Đang tải dữ liệu từ máy chủ, vui lòng đợi trong giây lát</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredSortedTargets.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="p-8 text-center text-xs text-slate-400">
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
                ) : (
                  <>
                    {/* Sticky / Highlighted Top TOTAL Row (SQL-aggregated across entire filtered database scope) */}
                    <tr className="bg-slate-100 font-black border-b-2 border-slate-300 text-slate-900 shadow-xs">
                      <td className="px-3 py-2.5 text-center text-slate-400 font-bold">—</td>
                      <td className="px-3.5 py-2.5 font-black text-slate-900 min-w-[180px]">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider">
                            TOTAL
                          </span>
                          <span className="text-slate-600 text-[11px] font-bold">
                            ({serverTargetSummary.count.toLocaleString()} targets)
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-400 min-w-[260px]">—</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-400 font-bold">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-400 whitespace-nowrap">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {serverTargetSummary.impressions.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-400 whitespace-nowrap">—</td>
                      <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-400 whitespace-nowrap">—</td>
                      <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-400 whitespace-nowrap">—</td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {serverTargetSummary.clicks.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {serverTargetSummary.ctr.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-rose-600 whitespace-nowrap">
                        ${serverTargetSummary.spend.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-emerald-600 whitespace-nowrap">
                        ${serverTargetSummary.sales.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black whitespace-nowrap">
                        <span
                          className={`inline-flex min-w-[68px] justify-center rounded-md px-2 py-1 font-mono text-xs font-black ${
                            serverTargetSummary.spend > 0 && serverTargetSummary.sales <= 0
                              ? "bg-rose-100 text-rose-700"
                              : serverTargetSummary.acos < 30
                                ? "bg-emerald-100 text-emerald-700"
                                : serverTargetSummary.acos <= 50
                                  ? "bg-amber-200 text-amber-900"
                                  : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {serverTargetSummary.spend > 0 && serverTargetSummary.sales <= 0
                            ? "0 sales"
                            : `${serverTargetSummary.acos.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-800 whitespace-nowrap">
                        ${serverTargetSummary.cpc.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-slate-800 whitespace-nowrap">
                        {serverTargetSummary.cvr.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-black text-indigo-700 whitespace-nowrap">
                        {serverTargetSummary.orders.toLocaleString()}
                      </td>
                      <td className="px-2 py-2.5 text-center whitespace-nowrap w-[60px] min-w-[60px] sticky right-0 z-10 bg-slate-100 border-l border-slate-300 font-bold text-slate-400">
                        —
                      </td>
                    </tr>

                    {paginatedTargets.map((target, targetIdx) => {
                      const badge = getTargetDisplayType(target);
                      const targetKey = targetRowKey(target);
                      const isExpanded = expandedTargetKey === targetKey;
                      const childData = expandedChildTerms[targetKey];
                      const childTerms = childData?.terms || [];
                      const isSelected = selectedTargetRows.has(targetKey);

                      return (
                        <Fragment key={targetKey}>
                          <tr className={`group transition ${isSelected ? "bg-indigo-50/70" : isExpanded ? "bg-indigo-50/40" : "hover:bg-slate-50/80"}`}>
                            <td className="px-3 py-2.5 text-center">
                              <input
                                type="checkbox"
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                checked={isSelected}
                                onChange={(e) => toggleTargetSelect(target, targetIdx, (e.nativeEvent as MouseEvent).shiftKey)}
                              />
                            </td>
                            <td className="px-3 py-2.5 font-bold text-slate-900 min-w-[180px] col-primary">
                              <div className="break-words leading-snug font-bold" title={target.targetKeyword}>{target.targetKeyword}</div>
                            </td>
                            {/* Bảng Target: chỉ Target / Keyword và ACOS in đậm, còn lại chữ thường */}
                            <td className="px-3 py-2.5 text-slate-700 min-w-[260px]">
                              <div className="break-words leading-snug" title={target.campaignName}>{target.campaignName}</div>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className={badge.badgeColor.replace("font-bold", "font-normal")}>{badge.label}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-800 whitespace-nowrap">{target.currentBid ? `$${target.currentBid.toFixed(2)}` : "—"}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{(target.impressions || 0).toLocaleString()}</td>
                            <PpcSearchVolumeCell
                              className="px-2.5 py-2.5"
                              searchVolume={target.searchVolume}
                              searchVolumeTrend={target.searchVolumeTrend}
                              estImpressionShare={target.estImpressionShare}
                            />
                            <PpcOrganicRankCell
                              className="px-2 py-2.5"
                              organicRank={(target as any).organicRank}
                            />
                            <PpcSponsoredRankCell
                              className="px-2 py-2.5"
                              sponsoredRank={(target as any).sponsoredRank}
                            />
                            <td className="px-3 py-2.5 text-right font-mono text-slate-600 whitespace-nowrap">{(target.clicks || 0).toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{target.ctr ? `${target.ctr.toFixed(2)}%` : "0.00%"}</td>
                            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                              {target.orders === 0 && target.spend >= 15 ? (
                                <span
                                  className="inline-block px-1.5 py-0.5 rounded font-normal text-rose-700 bg-rose-50 border border-rose-300"
                                  title="Cảnh báo: Chi tiêu vượt ngưỡng ($15+) nhưng chưa có đơn hàng nào"
                                >
                                  ${target.spend.toFixed(2)}
                                </span>
                              ) : (
                                <span className={target.spend > 0 ? "text-slate-900" : "text-slate-400"}>
                                  ${target.spend.toFixed(2)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-emerald-600 whitespace-nowrap">${target.sales.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                              {target.orders === 0 || target.sales === 0 ? (
                                <span
                                  className={`inline-flex min-w-[64px] justify-center rounded-md px-2 py-0.5 font-mono text-[11px] font-black ${
                                    target.spend > 0 ? "bg-rose-100 text-rose-700" : "text-slate-400"
                                  }`}
                                >
                                  {target.spend > 0 ? "0 sales" : "—"}
                                </span>
                              ) : (
                                <span
                                  className={`inline-flex min-w-[64px] justify-center rounded-md px-2 py-0.5 font-mono text-[11px] font-black ${
                                    target.acos < 30
                                      ? "bg-emerald-100 text-emerald-700"
                                      : target.acos <= 50
                                        ? "bg-amber-200 text-amber-900"
                                        : "bg-rose-100 text-rose-700"
                                  }`}
                                  title={`ACOS: ${target.acos.toFixed(1)}%`}
                                >
                                  {target.acos.toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-600 whitespace-nowrap">${target.cpc.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">{target.cvr.toFixed(1)}%</td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-900 whitespace-nowrap">{target.orders}</td>
                            <td className={`px-2 py-2 text-center whitespace-nowrap w-[60px] min-w-[60px] sticky right-0 z-10 border-l border-slate-200 shadow-[-4px_0_8px_rgba(0,0,0,0.04)] transition ${isExpanded ? "bg-indigo-50" : isSelected ? "bg-indigo-50/70" : "bg-white group-hover:bg-slate-50"
                              }`}>
                              <button
                                type="button"
                                onClick={() => handleToggleExpandTarget(target, targetKey)}
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-[11px] font-extrabold transition cursor-pointer border shrink-0 ${isExpanded
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                                  : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200"
                                  }`}
                                title={isExpanded ? "Đóng danh sách terms" : "Xem các customer search terms"}
                              >
                                {isExpanded ? "Đóng" : "Xem"}
                              </button>
                            </td>
                          </tr>

                          {/* Inline Expandable Layer 2: On-demand Child Search Term Breakdown */}
                          {isExpanded && (
                            <tr className="bg-slate-50/70 border-b border-slate-200">
                              <td colSpan={16} className="p-3">
                                {childData?.loading ? (
                                  <div className="flex items-center justify-center gap-2 p-6 bg-white rounded-lg border border-slate-200 text-xs text-slate-600">
                                    <CircleNotch size={18} className="animate-spin text-indigo-600" />
                                    <span className="font-bold">Đang tải customer search terms từ máy chủ...</span>
                                  </div>
                                ) : childData?.error ? (
                                  <div className="p-3 text-center text-xs text-rose-600 bg-rose-50 rounded-lg border border-rose-200">
                                    {childData.error}
                                  </div>
                                ) : childTerms.length === 0 ? (
                                  <div className="p-3 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                                    Không có customer search term nào phát sinh click trong kỳ báo cáo.
                                  </div>
                                ) : (
                                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-2xs">
                                    <table className="w-full text-left text-xs text-slate-700">
                                      <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                        <tr>
                                          <th className="py-2 px-3.5">Search Term</th>
                                          <th className="py-2 px-2 text-right">SV</th>
                                          <th className="py-2 px-2 text-center">Org Rank</th>
                                          <th className="py-2 px-2 text-center">Spon Rank</th>
                                          <th className="py-2 px-2.5 text-right">Impression</th>
                                          <th className="py-2 px-2.5 text-right">Clicks</th>
                                          <th className="py-2 px-2.5 text-right">Spend ($)</th>
                                          <th className="py-2 px-2.5 text-right">Sales ($)</th>
                                          <th className="py-2 px-2.5 text-right">ACOS</th>
                                          <th className="py-2 px-2.5 text-right">CVR</th>
                                          <th className="py-2 px-2.5 text-right">Orders</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 font-medium">
                                        {childTerms.map((term, tIdx) => (
                                          <tr key={`${term.id || term.customerSearchTerm}-${tIdx}`} className="hover:bg-slate-50/80 transition">
                                            <td className="py-2 px-3.5 font-bold text-slate-900">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span>{term.customerSearchTerm}</span>
                                                {term.matchType && term.matchType !== "Unknown" && (
                                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
                                                    {term.matchType}
                                                  </span>
                                                )}
                                                {!term.targetKeyword && (
                                                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 border border-amber-200" title="Từ khóa suy luận">
                                                    Suy luận
                                                  </span>
                                                )}
                                              </div>
                                            </td>
                                            <PpcSearchVolumeCell
                                              className="py-2 px-2"
                                              searchVolume={term.searchVolume}
                                              searchVolumeTrend={term.searchVolumeTrend}
                                            />
                                            <PpcOrganicRankCell
                                              className="py-2 px-2"
                                              organicRank={(term as any).organicRank}
                                            />
                                            <PpcSponsoredRankCell
                                              className="py-2 px-2"
                                              sponsoredRank={(term as any).sponsoredRank}
                                            />
                                            <td className="py-2 px-2.5 text-right font-mono text-slate-600">{(term.impressions || 0).toLocaleString()}</td>
                                            <td className="py-2 px-2.5 text-right font-mono text-slate-600">{term.clicks}</td>
                                            <td className="py-2 px-2.5 text-right font-mono whitespace-nowrap">
                                              {term.orders === 0 && term.spend >= 10 ? (
                                                <span
                                                  className="inline-block px-1.5 py-0.5 rounded font-black text-rose-700 bg-rose-50 border border-rose-300 text-[11px]"
                                                  title="Search term chi tiêu cao ($10+) chưa có đơn"
                                                >
                                                  ${term.spend.toFixed(2)}
                                                </span>
                                              ) : (
                                                <span className={term.spend > 0 ? "text-slate-900" : "text-slate-400"}>
                                                  ${term.spend.toFixed(2)}
                                                </span>
                                              )}
                                            </td>
                                            <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-600">${term.sales.toFixed(2)}</td>
                                            <td className="py-2 px-2.5 text-right font-mono">
                                              <span
                                                className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black border ${term.orders === 0 || term.sales === 0
                                                  ? term.spend >= 10
                                                    ? "text-rose-700 bg-rose-50 border-rose-300"
                                                    : "text-slate-500 bg-slate-50 border-slate-200"
                                                  : term.acos > 50
                                                    ? "text-rose-700 bg-rose-50 border-rose-300"
                                                    : term.acos <= targetAcos
                                                      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                                      : "text-amber-700 bg-amber-50 border-amber-200"
                                                  }`}
                                              >
                                                {term.orders === 0 ? "0 sales" : `${term.acos.toFixed(1)}%`}
                                              </span>
                                            </td>
                                            <td className="py-2 px-2.5 text-right font-mono text-slate-600">{(term.cvr * 100).toFixed(1)}%</td>
                                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-900">{term.orders}</td>
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
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <PpcPagination
            currentPage={targetPage}
            totalPages={totalTargetPages}
            pageSize={targetPageSize}
            totalItems={serverTargetTotal}
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
      {mountedTabs.has("skus") && (
        <div className={activeTab === "skus" && !storeRequired ? "space-y-3" : "hidden"}>
          {selectedStore !== "ALL" && (
            <PpcSkuMappingPanel skuList={skuEconomicsList} onSave={handleSaveSkuMappings} />
          )}
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
                placeholder="Tìm SKU..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>

            <div className="flex items-center gap-2.5 flex-wrap self-end sm:self-auto">
              {/* Dropdown Niche */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition">
                <Tag size={13} className="text-slate-400 shrink-0" />
                <span>Niche:</span>
                <select
                  value={skuNicheFilter}
                  onChange={(e) => {
                    setSkuNicheFilter(e.target.value);
                    setSkuPage(1);
                  }}
                  className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1"
                >
                  <option value="ALL">Tất cả Niche ({activeSkuPerformance.length})</option>
                  {skuNicheOptions.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name} ({n.count})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dropdown PIC MKT */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition">
                <UserCircle size={13} className="text-slate-400 shrink-0" />
                <span>PIC MKT:</span>
                <select
                  value={skuPicFilter}
                  onChange={(e) => {
                    setSkuPicFilter(e.target.value);
                    setSkuPage(1);
                  }}
                  className="bg-transparent border-none text-xs text-slate-800 font-semibold focus:outline-none cursor-pointer pr-1"
                >
                  <option value="ALL">Tất cả PIC ({activeSkuPerformance.length})</option>
                  {skuPicOptions.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.count})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold cursor-pointer select-none bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition">
                <input
                  type="checkbox"
                  checked={hidePausedSkus}
                  onChange={(e) => setHidePausedSkus(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Ẩn SKU tạm dừng (0 Imp)</span>
              </label>

              {skuFrozen.columnPicker}
              <button
                type="button"
                onClick={() => handleExportCsv("skus")}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-auto max-h-[calc(100vh-120px)] rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table ref={skuFrozen.tableRef} className="w-full text-left text-xs text-slate-700">
              <thead title="Chuột phải vào tiêu đề cột để khóa cột" className="sticky top-0 z-30 shadow-[0_1px_0_0_rgb(226,232,240)] bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-2 text-center w-12">Ảnh</th>
                  <th className="py-3 px-3.5">SKU</th>
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
                  <th className="py-3 px-3 text-center w-24">Trend (7D)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {(loading || isStoreSwitching || loadingSection === "skus" || loadingSkuEcon) ? (
                  <tr>
                    <td colSpan={12} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải danh sách SKU cho {selectedStore === "ALL" ? "tất cả store" : selectedStore}...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedSkus.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-xs text-slate-400">
                      Không tìm thấy SKU nào trong kỳ đang chọn.
                    </td>
                  </tr>
                ) : (
                  paginatedSkus.map((s, i) => (
                    <tr key={i} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-2 text-center">
                        {s.mockupUrl ? (
                          <div
                            className="relative inline-block cursor-pointer group/thumb"
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setHoveredMockup({ url: s.mockupUrl!, sku: s.sku, rect: { top: r.top, right: r.right } });
                            }}
                            onMouseLeave={() => setHoveredMockup(null)}
                            onClick={() => handleJumpToAutoBid(s.sku)}
                            title={`Mở đề xuất Auto Bid cho ${s.sku}`}
                          >
                            <img
                              src={getOptimizedThumbnailUrl(s.mockupUrl, 64) || s.mockupUrl}
                              alt={s.sku}
                              className="w-9 h-9 rounded-md object-cover border border-slate-200 shadow-2xs group-hover/thumb:ring-2 group-hover/thumb:ring-indigo-500 transition"
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
                          </div>
                        ) : (
                          <div
                            className="w-9 h-9 mx-auto rounded-md bg-slate-100 flex items-center justify-center text-slate-300 cursor-pointer hover:bg-slate-200 transition"
                            onClick={() => handleJumpToAutoBid(s.sku)}
                            title={`Mở đề xuất Auto Bid cho ${s.sku}`}
                          >
                            <Tag size={14} />
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 col-primary">
                        <button
                          type="button"
                          onClick={() => handleJumpToAutoBid(s.sku)}
                          className="truncate max-w-[280px] font-bold text-slate-900 font-mono hover:text-indigo-600 hover:underline cursor-pointer text-left transition inline-block"
                          title={`Mở đề xuất Auto Bid cho SKU: ${s.sku}`}
                        >
                          {s.sku}
                        </button>
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-600">{s.storeName}</td>
                      <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                        {s.impressions ? s.impressions.toLocaleString() : "0"}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-normal ${s.clicks === 0 ? "text-slate-400" : "text-slate-700"}`}>
                        {s.clicks}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-500 font-normal">
                        {s.impressions > 0 ? `${(s.ctr || 0).toFixed(2)}%` : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-normal text-slate-800">${s.spend.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-normal text-emerald-600">${s.sales.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-normal text-slate-700">{s.orders}</td>
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
                      <td className="py-2.5 px-3 text-center">
                        <SkuTrendSparkline
                          dailyTrend={s.dailyTrend}
                          sku={s.sku}
                          storeName={s.storeName}
                          mockupUrl={s.mockupUrl}
                          onOpenDetail={(data) => setSelectedSkuTrendModal(data)}
                        />
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
      {mountedTabs.has("search_terms") && (
        <div className={activeTab === "search_terms" && !storeRequired ? "space-y-3" : "hidden"}>
          {/* Filter Bar */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Keyword Search */}
              <div className="relative flex-1 sm:min-w-[200px] max-w-xs">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTermQuery}
                  onChange={(e) => {
                    setSearchTermQuery(e.target.value);
                    setTermPage(1);
                  }}
                  placeholder="Lọc từ khóa khách gõ, campaign..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600 transition"
                />
              </div>

              {/* Campaign Filter (tự động rút ngắn theo từ khóa đang tìm) */}
              <select
                value={searchTermCampaignFilter}
                onChange={(e) => {
                  setSearchTermCampaignFilter(e.target.value);
                  setTermPage(1);
                }}
                className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer max-w-[220px] truncate"
                title="Lọc theo Campaign (danh sách tự động rút ngắn theo từ khóa đang tìm)"
              >
                <option value="ALL">Tất cả Campaign ({searchTermCampaigns.length})</option>
                {searchTermCampaigns.map((camp) => (
                  <option key={camp} value={camp}>
                    {camp}
                  </option>
                ))}
              </select>

              {/* Match Type Filter */}
              <select
                value={matchTypeFilter}
                onChange={(e) => {
                  setMatchTypeFilter(e.target.value);
                  setTermPage(1);
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

              {/* Range Filters: Clicks */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
                <span className="text-slate-600 font-bold shrink-0">Clicks:</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Từ"
                  value={termMinClicks}
                  onChange={(e) => {
                    setTermMinClicks(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
                <span className="text-slate-400 font-bold">-</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Đến"
                  value={termMaxClicks}
                  onChange={(e) => {
                    setTermMaxClicks(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
              </div>

              {/* Range Filters: Orders */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
                <span className="text-slate-600 font-bold shrink-0">Orders:</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Từ"
                  value={termMinOrders}
                  onChange={(e) => {
                    setTermMinOrders(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
                <span className="text-slate-400 font-bold">-</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Đến"
                  value={termMaxOrders}
                  onChange={(e) => {
                    setTermMaxOrders(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
              </div>

              {/* Range Filters: ACOS (%) */}
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
                <span className="text-slate-600 font-bold shrink-0">ACoS (%):</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Từ"
                  value={termMinAcos}
                  onChange={(e) => {
                    setTermMinAcos(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
                <span className="text-slate-400 font-bold">-</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Đến"
                  value={termMaxAcos}
                  onChange={(e) => {
                    setTermMaxAcos(e.target.value);
                    setTermPage(1);
                  }}
                  className="w-12 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-center font-bold text-slate-800 outline-none focus:border-indigo-600"
                />
              </div>

              {/* Reset Filters */}
              {isSearchTermFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTermQuery("");
                    setSearchTermCampaignFilter("ALL");
                    setMatchTypeFilter("ALL");
                    setTermPerformanceFilter("ALL");
                    setTermMinClicks("");
                    setTermMaxClicks("");
                    setTermMinOrders("");
                    setTermMaxOrders("");
                    setTermMinAcos("");
                    setTermMaxAcos("");
                    setTermPage(1);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  title="Đặt lại tất cả bộ lọc"
                >
                  <X size={13} weight="bold" /> Đặt lại
                </button>
              )}

              <div className="ml-auto flex items-center gap-2">
                {searchTermFrozen.columnPicker}
                {selectedStore !== "ALL" && (
                  <PpcSearchTermLaunchPanel
                    selectedRows={[...groupLaunchRows(termGroupSelection.selected), ...Array.from(selectedTermRows.values())]}
                    storeName={stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.name || selectedStore}
                    storeId={stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.id}
                    selectedSku={selectedSku}
                    knownSkus={launchKnownSkus}
                    actor={actor}
                    notify={notify}
                    onClear={() => { clearSelectedTerms(); termGroupSelection.clear(); }}
                    onLaunched={() => { clearSelectedTerms(); termGroupSelection.clear(); }}
                  />
                )}
              </div>
              {/* Results count indicator */}
              <div className="text-xs text-slate-500 font-medium">
                Khớp <span className="font-extrabold text-slate-900">{(serverSearchTermTotal ?? filteredSortedSearchTerms.length).toLocaleString("vi-VN")}</span> / {(serverSearchTermTotal ?? detailCounts?.searchTerms ?? aggregatedSearchTerms.length).toLocaleString("vi-VN")} từ khóa
              </div>
            </div>
          </div>

          {/* Totals for the current Search Term query; detail rows stay separated by campaign. */}
          {searchTermQuery.trim() && serverSearchTermSummary && (
            <div className="overflow-auto max-h-[480px] rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full min-w-[1100px] text-left">
                <PpcSummaryTableHead
                  keywordLabel="Search Term"
                  sort={searchTermSummarySort}
                  selection={serverSearchTermSummary.keywordGroups ? termGroupSelection.selectionFor(sortedTermKeywordGroups) : undefined}
                />
                <tbody className="divide-y divide-slate-100">
                  {searchTermSummarySort.sortSkuGroups((serverSearchTermSummary.skuGroups?.length
                    ? serverSearchTermSummary.skuGroups
                    : [{ ...serverSearchTermSummary, sku: selectedSku !== "ALL" ? selectedSku : "TẤT CẢ SKU" }]
                  ) as SearchTermSkuSummary[]).map((group) => (
                    <tr key={group.sku} className="hover:bg-slate-50/70">
                      <td className="px-3 py-3 text-center">
                        {group.mockupUrl ? (
                          <div
                            className="relative inline-block cursor-pointer group/thumb"
                            onMouseEnter={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setHoveredMockup({ url: group.mockupUrl!, sku: group.sku, rect: { top: r.top, right: r.right } });
                            }}
                            onMouseLeave={() => setHoveredMockup(null)}
                            onClick={() => setPreviewModalMockup({ url: group.mockupUrl!, sku: group.sku })}
                            title="Nhấn để xem ảnh phóng to"
                          >
                            <img
                              src={getOptimizedThumbnailUrl(group.mockupUrl, 80) || group.mockupUrl}
                              alt={group.sku}
                              className="h-12 w-12 rounded-lg border border-slate-200 object-cover shadow-2xs group-hover/thumb:border-indigo-500 group-hover/thumb:ring-2 group-hover/thumb:ring-indigo-200 transition-all"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                            <Tag size={17} />
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-sm font-black text-slate-900">{group.sku}</td>
                      <td className="px-3 py-3 text-sm font-bold text-slate-900">{querySummaryLabel(searchTermQuery, "Tất cả search term")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{Number(group.totalImpressions || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{Number(group.totalClicks || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalImpressions > 0 ? ((group.totalClicks / group.totalImpressions) * 100).toFixed(2) : "0.00"}%</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-slate-900">${Number(group.totalSpend || 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-emerald-600">${Number(group.totalSales || 0).toFixed(2)}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-black text-slate-900">{Number(group.totalOrders || 0).toLocaleString("vi-VN")}</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalClicks > 0 ? ((group.totalOrders / group.totalClicks) * 100).toFixed(1) : "0.0"}%</td>
                      <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-800">{group.totalClicks > 0 ? `$${(group.totalSpend / group.totalClicks).toFixed(2)}` : "-"}</td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={`inline-flex min-w-[68px] justify-center rounded-md px-2 py-1 font-mono text-sm font-black ${
                            group.acos > 500
                              ? "bg-rose-100 text-rose-700"
                              : group.acos < 30
                                ? "bg-emerald-100 text-emerald-700"
                                : group.acos <= 50
                                  ? "bg-amber-200 text-amber-900"
                                  : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {group.acos > 500 ? "0 sales" : `${Number(group.acos || 0).toFixed(1)}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {serverSearchTermSummary.keywordGroups && (
                    <PpcKeywordGroupRows
                      groups={sortedTermKeywordGroups}
                      total={serverSearchTermSummary.keywordGroupTotal || 0}
                      selection={termGroupSelection.selectionFor(sortedTermKeywordGroups)}
                    />
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Table */}
          <div className="overflow-auto max-h-[calc(100vh-120px)] rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table ref={searchTermFrozen.tableRef} className="w-full text-left text-xs text-slate-700">
              <thead title="Chuột phải vào tiêu đề cột để khóa cột" className="sticky top-0 z-30 shadow-[0_1px_0_0_rgb(226,232,240)] bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={(serverSearchTerms || paginatedSearchTerms).length > 0 && (serverSearchTerms || paginatedSearchTerms).every((term) => selectedTerms.has(searchTermKey(term)))}
                      onChange={toggleSelectAllVisible}
                      className="rounded border-slate-300 accent-indigo-600"
                    />
                  </th>
                  <th className="py-3 px-3">Search Term</th>
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
                    className="py-3 px-2.5 text-right whitespace-nowrap"
                    title="Search Volume tháng từ Helium 10"
                  >
                    SV
                  </th>
                  <th
                    className="py-3 px-2 text-center whitespace-nowrap"
                    title="Thứ hạng tự nhiên (Organic Rank) của sản phẩm"
                  >
                    Org Rank
                  </th>
                  <th
                    className="py-3 px-2 text-center whitespace-nowrap"
                    title="Thứ hạng quảng cáo (Sponsored Rank) của sản phẩm"
                  >
                    Spon Rank
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
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 whitespace-nowrap"
                    onClick={() =>
                      handleSort("cpc", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                    title="CPC trung bình = Spend / Clicks"
                  >
                    CPC ($) {termSortField === "cpc" && (termSortDir === "asc" ? "↑" : "↓")}
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
              <tbody className="divide-y divide-slate-100 font-mono text-[11px] font-normal">
                {(loadingSearchTermsServer || (!serverSearchTerms && (!searchTermsReady || loadingSection === "search_terms" || loading || isStoreSwitching))) ? (
                  <tr>
                    <td colSpan={17} className="p-12 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <CircleNotch size={24} className="animate-spin text-indigo-600" />
                        <span className="font-bold text-slate-700">Đang tải dữ liệu Search Terms từ máy chủ...</span>
                      </div>
                    </td>
                  </tr>
                ) : (serverSearchTerms || paginatedSearchTerms).length === 0 ? (
                  <tr>
                    <td colSpan={17} className="p-8 text-center text-slate-400 font-sans font-medium">
                      Không tìm thấy từ khóa nào phù hợp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  (serverSearchTerms || paginatedSearchTerms).map((t, idx) => {
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
                            onChange={(e) => toggleTermSelect(t, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                            className="rounded border-slate-300 accent-indigo-600"
                          />
                        </td>
                        {/* Search Term - IN ĐẬM */}
                        <td className="py-2.5 px-3 font-sans font-bold text-slate-900 min-w-[180px] break-words">
                          {t.customerSearchTerm}
                        </td>
                        {/* Ad Type - Viết thường */}
                        <td className="py-2.5 px-3 font-sans text-[10px] font-normal text-indigo-700">{t.adType || "?"}</td>
                        {/* Match Type - Viết thường */}
                        <td className="py-2.5 px-3 font-sans">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-normal bg-slate-100 text-slate-700">
                            {t.matchType}
                          </span>
                        </td>
                        {/* Campaign - Viết thường */}
                        <td className="py-2.5 px-3 text-slate-600 font-sans font-normal min-w-[280px] max-w-[420px] align-top leading-snug">
                          <div className="flex items-start gap-1">
                            <span className="min-w-0 flex-1 whitespace-normal break-words">{t.campaignName}</span>
                            <PpcCopyButton value={t.campaignName} label="campaign" />
                          </div>
                          {t.adGroupName && t.adGroupName !== t.campaignName && (
                            <div className="mt-1 flex items-start gap-1 text-[10px] text-slate-400">
                              <span className="min-w-0 flex-1 whitespace-normal break-words">Nhóm: {t.adGroupName}</span>
                              <PpcCopyButton value={t.adGroupName} label="ad group" />
                            </div>
                          )}
                        </td>
                        {/* Hiển thị - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">{(t.impressions || 0).toLocaleString()}</td>
                        <PpcSearchVolumeCell
                          className="py-2.5 px-2.5"
                          searchVolume={t.searchVolume}
                          searchVolumeTrend={t.searchVolumeTrend}
                          estImpressionShare={t.estImpressionShare}
                        />
                        <PpcOrganicRankCell
                          className="py-2.5 px-2"
                          organicRank={(t as any).organicRank}
                        />
                        <PpcSponsoredRankCell
                          className="py-2.5 px-2"
                          sponsoredRank={(t as any).sponsoredRank}
                        />
                        {/* Clicks - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">{t.clicks}</td>
                        {/* CTR (%) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-600">{Number.isFinite(t.ctr) ? `${(t.ctr * 100).toFixed(2)}%` : "-"}</td>
                        {/* Spend ($) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">${t.spend.toFixed(2)}</td>
                        {/* Sales ($) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">${t.sales.toFixed(2)}</td>
                        {/* Orders - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">{t.orders}</td>
                        {/* CVR (%) - Viết thường */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">{Number.isFinite(t.cvr) ? `${(t.cvr * 100).toFixed(1)}%` : "-"}</td>
                        {/* CPC trung bình = Spend / Clicks */}
                        <td className="py-2.5 px-3 text-right font-normal text-slate-700">{t.clicks > 0 ? `$${(t.spend / t.clicks).toFixed(2)}` : "-"}</td>
                        {/* ACOS (%) - IN ĐẬM */}
                        <td className="py-2.5 px-3 text-right font-bold">
                          <span
                            className={`font-bold ${t.orders === 0 && t.clicks >= 9
                              ? "text-rose-700 font-bold"
                              : t.orders > 0 && t.acos <= targetAcos
                                ? "text-emerald-700 font-bold"
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
            totalPages={serverSearchTermTotal !== null ? serverSearchTermTotalPages : totalTermPages}
            pageSize={termPageSize}
            totalItems={serverSearchTermTotal ?? filteredSortedSearchTerms.length}
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

      {/* VIEW 5.5: ST CAMPAIGN ROLL-UP (ĐỐI SOÁT CHIẾN DỊCH TỔNG HỢP TỪ SEARCH TERMS) */}
      {/* ========================================================================= */}
      {mountedTabs.has("st_campaigns") && (
        <div className={activeTab === "st_campaigns" && !storeRequired ? "space-y-3" : "hidden"}>
          <PpcStCampaignRollupView
            selectedStore={selectedStore}
            selectedSku={selectedSku}
            stores={stores}
            targetAcos={targetAcos}
            notify={notify}
          />
        </div>
      )}

      {mountedTabs.has("st_optimization") && (
        <div className={activeTab === "st_optimization" ? "" : "hidden"}>
          {selectedStore === "ALL" ? (
            <div className="p-8 text-center bg-amber-50/80 rounded-2xl border border-amber-200 space-y-3 my-4 shadow-2xs">
              <Storefront size={36} className="mx-auto text-amber-600" weight="duotone" />
              <h3 className="text-sm font-bold text-amber-950">Vui lòng chọn một Store cụ thể</h3>
              <p className="text-xs text-amber-800 max-w-lg mx-auto">
                Tính năng Negative Keyword cần xác định đúng Store để phát hiện từ khóa lãng phí và thực hiện phủ định chuẩn xác.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleStoreChange(s.name)}
                    className="px-3.5 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-100 hover:border-amber-400 transition cursor-pointer shadow-xs"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <PpcStOptimizationView
              isActive={activeTab === "st_optimization"}
              searchTerms={searchTerms}
              selectedStore={selectedStore}
              selectedSku={selectedSku}
              selectedDays={selectedDays}
              loading={loading}
              notify={notify}
              onOpenActionQueue={() => setIsActionQueueOpen(true)}
              stores={stores}
              onCandidateCountChange={(cnt) => setStOptimizationServerCount(cnt)}
            />
          )}
        </div>
      )}

      {mountedTabs.has("sale_kw") && (
        <div className={activeTab === "sale_kw" ? "" : "hidden"}>
          {selectedStore === "ALL" ? (
            <div className="p-8 text-center bg-amber-50/80 rounded-2xl border border-amber-200 space-y-3 my-4 shadow-2xs">
              <Storefront size={36} className="mx-auto text-amber-600" weight="duotone" />
              <h3 className="text-sm font-bold text-amber-950">Vui lòng chọn một Store cụ thể</h3>
              <p className="text-xs text-amber-800 max-w-lg mx-auto">
                Lên Camp Sale KW cần tính CPC, kiểm tra lịch sử và tạo Campaign riêng theo từng Store để tránh nhầm lẫn dữ liệu.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleStoreChange(s.name)}
                    className="px-3.5 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-100 hover:border-amber-400 transition cursor-pointer shadow-xs"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <PpcSaleKwView
              isActive={activeTab === "sale_kw"}
              searchTerms={searchTerms}
              selectedStore={selectedStore}
              selectedSku={selectedSku}
              selectedDays={selectedDays}
              loading={loading}
              notify={notify}
              onOpenActionQueue={() => setIsActionQueueOpen(true)}
              actor={actor}
              stores={stores}
              onCandidateCountChange={(cnt) => setSaleKwServerCount(cnt)}
            />
          )}
        </div>
      )}

      {mountedTabs.has("recommendations") && (
        <div className={activeTab === "recommendations" ? "rounded-2xl border border-slate-200 bg-white p-4 shadow-xs" : "hidden"}>
          {selectedStore === "ALL" ? (
            <div className="p-8 text-center bg-amber-50/80 rounded-2xl border border-amber-200 space-y-3 my-4 shadow-2xs">
              <Storefront size={36} className="mx-auto text-amber-600" weight="duotone" />
              <h3 className="text-sm font-bold text-amber-950">Vui lòng chọn một Store cụ thể</h3>
              <p className="text-xs text-amber-800 max-w-lg mx-auto">
                Auto Bid / Đề xuất tối ưu giá thầu được tính toán và áp dụng riêng biệt cho từng Store.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                {stores.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleStoreChange(s.name)}
                    className="px-3.5 py-1.5 rounded-xl bg-white border border-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-100 hover:border-amber-400 transition cursor-pointer shadow-xs"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <PpcSkuRecommendationGroupView
              isActive={activeTab === "recommendations"}
              actor={actor}
              groups={skuRecGroups}
              allRecommendations={skuRecAllRecs}
              isLoading={loadingRecs}
              recommendationWindowDays={selectedDays}
              loadedRecommendationWindowDays={loadedRecommendationWindowDays}
              onRecommendationWindowChange={(days) => {
                setIsCustomDate(false);
                setSelectedDays(days);
              }}
              includePausedCampaigns={includePausedRecs}
              onIncludePausedCampaignsChange={setIncludePausedRecs}
              onLoadSkuRecommendations={loadSkuRecommendationDetails}
              onApproveToQueue={handleApproveToQueue}
              onOpenActionQueue={() => setIsActionQueueOpen(true)}
              pendingQueueCount={pendingActionCount}
              actionQueue={actionQueue}
              selectedStore={selectedStore}
              isStoreSwitching={isStoreSwitching}
              targetSkuToOpen={targetSkuToOpen}
              onClearTargetSkuToOpen={() => setTargetSkuToOpen(null)}
            />
          )}
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
        onRefreshBulkHistory={() => void loadBulkHistory(selectedStore)}
        storeName={selectedStore}
        storeId={
          selectedStore === "ALL"
            ? "ALL"
            : (stores.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase())?.id || "")
        }
        onRefreshActionQueue={() => {
          void loadActionQueue(selectedStore);
          void loadActionQueueCount(selectedStore);
        }}
      />

      {/* FILE MANAGER MODAL (SERVER & R2 PURGE) */}
      <PpcFileManagerModal
        isOpen={showFileManagerModal}
        onClose={() => setShowFileManagerModal(false)}
        onDataChanged={() => void refreshData()}
      />

      {/* ADD STORE MODAL */}
      <PpcAddStoreModal
        isOpen={showAddStoreModal}
        onClose={() => setShowAddStoreModal(false)}
        onStoreCreated={(newStore) => {
          notify(`Đã tạo store "${newStore.name}" (${newStore.marketplace}) thành công!`, "success");
          setSelectedStore(newStore.name);
          setSelectedSku("ALL");
        }}
      />

      {/* STORE MANAGER MODAL */}
      <PpcStoreManagerModal
        isOpen={showStoreManagerModal}
        onClose={() => setShowStoreManagerModal(false)}
        onStoreSelected={(name) => {
          setSelectedStore(name);
          setSelectedSku("ALL");
        }}
        onNavigateToCostMaster={(name) => {
          setSelectedStore(name);
          setSelectedSku("ALL");
          setActiveTab("settings");
          setSettingsSubTab("phoi");
        }}
      />

      {/* FLOATING ACTION QUEUE BUTTON (DRAGGABLE, GÓC DƯỚI) */}
      {selectedStore !== "ALL" && (
        <PpcFloatingActionQueue
          onOpen={() => setIsActionQueueOpen(true)}
          pendingActionCount={pendingActionCount}
          selectedStore={selectedStore}
        />
      )}

      {/* FLOATING HOVER PREVIEW (Thoát khỏi table overflow-x-auto, không bao giờ bị che/cắt) */}
      {hoveredMockup && (
        <div
          className="fixed z-[9999] pointer-events-none bg-white p-1.5 rounded-xl shadow-2xl border border-slate-200 w-52 h-52 animate-in fade-in zoom-in-95 duration-100"
          style={{
            top: Math.max(16, Math.min(hoveredMockup.rect.top - 20, typeof window !== "undefined" ? window.innerHeight - 224 : 0)),
            left: Math.min(hoveredMockup.rect.right + 12, typeof window !== "undefined" ? window.innerWidth - 224 : 0),
          }}
        >
          <img
            src={getOptimizedThumbnailUrl(hoveredMockup.url, 400) || hoveredMockup.url}
            alt={hoveredMockup.sku || "Mockup preview"}
            className="w-full h-full object-cover rounded-lg"
          />
        </div>
      )}

      {/* LIGHTBOX MODAL KHI CLICK ẢNH */}
      {previewModalMockup && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150 cursor-pointer"
          onClick={() => setPreviewModalMockup(null)}
        >
          <div
            className="relative max-w-lg w-full bg-white rounded-2xl p-4 shadow-2xl border border-slate-200 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <span className="font-mono font-bold text-sm text-slate-900">
                {previewModalMockup.sku || "Mockup Preview"}
              </span>
              <button
                type="button"
                onClick={() => setPreviewModalMockup(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer transition"
              >
                <X size={18} weight="bold" />
              </button>
            </div>
            <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-50 flex items-center justify-center border border-slate-100">
              <img
                src={getOptimizedThumbnailUrl(previewModalMockup.url, 800) || previewModalMockup.url}
                alt={previewModalMockup.sku || "Mockup preview"}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL XEM TREND 30 NGÀY CHO 1 SKU */}
      {selectedSkuTrendModal && (
        <PpcSkuTrendModal
          isOpen={Boolean(selectedSkuTrendModal)}
          onClose={() => setSelectedSkuTrendModal(null)}
          sku={selectedSkuTrendModal.sku}
          storeName={selectedSkuTrendModal.storeName}
          mockupUrl={selectedSkuTrendModal.mockupUrl}
          dailyTrend={selectedSkuTrendModal.dailyTrend}
          targetAcos={targetAcos}
        />
      )}

      {/* Menu khóa cột (chuột phải vào tiêu đề cột) */}
      {campaignFrozen.menu}
      {targetFrozen.menu}
      {searchTermFrozen.menu}
      {skuFrozen.menu}
    </div>
  );
}
