"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  RocketLaunch,
  FileXls,
  Copy,
  MagnifyingGlass,
  CheckCircle,
  Funnel,
  CircleNotch,
  ArrowSquareOut,
  SlidersHorizontal,
  Lightning,
  CloudArrowUp,
  Check,
  X,
  Info,
  WarningCircle,
  ShieldCheck,
  ArrowsClockwise,
  Trash,
  CaretDown,
  CaretUp,
  Tag,
  TrendUp,
  CurrencyDollar,
  ShoppingBag,
  Target,
  ArrowLeft,
} from "@phosphor-icons/react";
import type { PpcSearchTermRow, MatchType, PpcAdType } from "@/lib/ppc/types";
import type { RequestActor } from "@/lib/auth";
import {
  isAsinProductTarget,
  formatDDMMYY,
  extractFileDateDDMMYY,
  extractAdTypeCode,
  buildSaleKwCampaignName,
  generateSaleKwCampaignTriad,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";
import { PpcPagination } from "./ppc-pagination";

export interface SaleKwCandidate {
  key: string;
  sku: string;
  customerSearchTerm: string;
  sourceCampaignNames: string[];
  sourceCampaignId?: string;
  sourceAdGroupId?: string;
  sourceAdGroupName?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  acos: number;
  bid: number;
  storeId?: string;
  storeName?: string;
  isAlreadyLaunched?: boolean;
}

export interface SaleKwSkuGroup {
  sku: string;
  items: SaleKwCandidate[];
  totalOrders: number;
  totalSales: number;
  totalSpend: number;
  totalClicks: number;
  avgCpc: number;
  adTypeCode: string;
  campaignNames: {
    exact: string;
    phrase: string;
    broad: string;
  };
}

export interface SaleKwRegistryItem {
  id: string;
  store_id: string;
  store_name: string;
  source_campaign_id: string | null;
  source_campaign_name: string;
  target_campaign_name: string;
  ad_group_name: string;
  keyword_text: string;
  match_type: string;
  target_type: string;
  sku: string | null;
  bid: number;
  daily_budget: number;
  orders: number;
  sales: number;
  clicks: number;
  spend: number;
  cpc: number;
  state: string;
  source: string;
  source_job_id: string | null;
  created_at: string;
  updated_at: string;
}

type SaleKwMatchType = "exact" | "phrase" | "broad";

const SALE_KW_MATCH_TYPES: SaleKwMatchType[] = ["exact", "phrase", "broad"];

function matchTypeSelectionKey(sku: string, matchType: SaleKwMatchType): string {
  return `${sku.trim().toLowerCase()}|||${matchType}`;
}

export function getCampaignArchitectureType(name: string): "SP04 (Auto)" | "SP03 (Keyword)" | "SB05 (Video)" | "SB01 (Brands)" | "SP02 (PAT)" | "Khác" {
  const upper = (name || "").toUpperCase();
  if (upper.includes("SP04") || upper.includes("AUTO")) return "SP04 (Auto)";
  if (upper.includes("SB05") || upper.includes("VIDEO")) return "SB05 (Video)";
  if (upper.includes("SB01") || upper.includes("BRANDS")) return "SB01 (Brands)";
  if (upper.includes("SP02") || upper.includes("PAT") || upper.includes("ASIN")) return "SP02 (PAT)";
  if (upper.includes("SP03") || upper.includes("KW") || upper.includes("EXACT") || upper.includes("PHRASE") || upper.includes("BROAD")) return "SP03 (Keyword)";
  return "Khác";
}

interface PpcSaleKwViewProps {
  searchTerms: PpcSearchTermRow[];
  selectedStore: string;
  selectedSku: string;
  selectedDays: number;
  loading: boolean;
  notify: (message: string, type?: "success" | "error") => void;
  onOpenActionQueue?: () => void;
  actor?: RequestActor;
  stores?: Array<{ id: string; name: string }>;
}

export function PpcSaleKwView({
  searchTerms,
  selectedStore,
  selectedSku,
  selectedDays,
  loading,
  notify,
  onOpenActionQueue,
  actor,
  stores,
}: PpcSaleKwViewProps) {
  // 0. Sub-tab state
  const [subTab, setSubTab] = useState<"candidates" | "registry">("candidates");

  // Registry state
  const [registryItems, setRegistryItems] = useState<SaleKwRegistryItem[]>([]);
  const [registrySummary, setRegistrySummary] = useState<{
    totalCampaigns: number;
    totalKeywords: number;
    totalOrders: number;
    totalSales: number;
    totalSpend: number;
  }>({
    totalCampaigns: 0,
    totalKeywords: 0,
    totalOrders: 0,
    totalSales: 0,
    totalSpend: 0,
  });
  const [launchedLookupSet, setLaunchedLookupSet] = useState<Set<string>>(new Set());
  const [loadingRegistry, setLoadingRegistry] = useState<boolean>(false);
  const [loadingRegistryLookup, setLoadingRegistryLookup] = useState<boolean>(false);
  const [registryLookupReady, setRegistryLookupReady] = useState<boolean>(false);
  const [registryLookupError, setRegistryLookupError] = useState<string | null>(null);
  const [registryLookupRetry, setRegistryLookupRetry] = useState(0);
  const registryListRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const registryLookupRequestRef = useRef<{ controller: AbortController; id: number } | null>(null);
  const registryRequestIdRef = useRef(0);
  const [hideLaunched, setHideLaunched] = useState<boolean>(true);

  // 1. Threshold controls: Mặc định Order > 2
  const [orderThreshold, setOrderThreshold] = useState<number>(2);
  const [orderOperator, setOrderOperator] = useState<">" | ">=">(">");

  // Storage key theo từng tài khoản (actor.userId hoặc actor.displayName)
  const userStorageKey = useMemo(() => {
    const id = actor?.userId || actor?.displayName || "default";
    return `ppc_sale_kw_username_${id.trim().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }, [actor?.userId, actor?.displayName]);

  // 2. Campaign Naming & Triad Parameters (SKU + Dạng chạy + "KW" + Tên người dùng + Match Type + Ngày tháng năm + "(sale kw)")
  const [userName, setUserName] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const id = actor?.userId || actor?.displayName || "default";
        const key = `ppc_sale_kw_username_${id.trim().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const saved = localStorage.getItem(key);
        if (saved && saved.trim()) return saved.trim();
      } catch (e) {}
    }
    if (actor?.displayName) {
      const raw = actor.displayName.trim();
      if (raw.includes("@")) {
        const part = raw.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
        return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "Loan";
      }
      const clean = raw.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/)[0];
      return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Loan";
    }
    return "Loan";
  });

  // Tự động đồng bộ / load lại tên khi đổi tài khoản
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(userStorageKey);
        if (saved && saved.trim()) {
          setUserName(saved.trim());
          return;
        }
      } catch (e) {}
    }
    if (actor?.displayName) {
      const raw = actor.displayName.trim();
      if (raw.includes("@")) {
        const part = raw.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
        setUserName(part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "Loan");
        return;
      }
      const clean = raw.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/)[0];
      setUserName(clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Loan");
    }
  }, [userStorageKey, actor?.displayName]);

  // Hàm thay đổi tên người dùng: Lưu ngay lập tức vào localStorage theo tài khoản mà không cần bấm nút lưu
  const handleUserNameChange = (val: string) => {
    setUserName(val);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(userStorageKey, val);
      } catch (e) {
        console.error("Lỗi khi lưu userName vào localStorage:", e);
      }
    }
  };

  // Tự động trích xuất ngày tạo file / ngày báo cáo từ danh sách searchTerms (định dạng DDMMYY 6 chữ số)
  const fileReportDate = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return null;
    for (const t of searchTerms) {
      const raw = t.reportEndDate || t.reportDate || t.reportStartDate;
      if (raw) {
        const parsed = extractFileDateDDMMYY(raw);
        if (parsed) return parsed;
      }
    }
    return null;
  }, [searchTerms]);

  const [customDate, setCustomDate] = useState<string>(() => {
    return formatDDMMYY(new Date());
  });

  // Khi có file / nạp dữ liệu searchTerms mới -> Tự động điền ngày tạo file đó
  useEffect(() => {
    if (fileReportDate) {
      setCustomDate(fileReportDate);
    }
  }, [fileReportDate]);

  const [adTypeCode, setAdTypeCode] = useState<string>("SP03");

  // 3. Global Campaign Launch Settings: Mặc định ngân sách ban đầu là 5$
  const [dailyBudget, setDailyBudget] = useState<number>(5.0);
  const [defaultBid, setDefaultBid] = useState<number>(1.0);
  const [negateInSource, setNegateInSource] = useState<boolean>(false);
  const [bidMode, setBidMode] = useState<"cpc" | "fixed">("cpc");

  // 4. Filter & Sort state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [skuFilter, setSkuFilter] = useState<string>("ALL");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [collapsedSkus, setCollapsedSkus] = useState<Set<string>>(new Set());
  // Mặc định cả 3 match type đều được chọn. Chỉ lưu các lựa chọn người dùng đã bỏ tích.
  const [disabledMatchTypes, setDisabledMatchTypes] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const previousStoreRef = useRef(selectedStore);
  useEffect(() => {
    if (previousStoreRef.current !== selectedStore) {
      previousStoreRef.current = selectedStore;
      setSelectedKeys(new Set());
      setAutoUploadSuccessResult(null);
      setAutoUploadError(null);
      setIsAutoUploadModalOpen(false);
      setAutoUploadStep(0);
    }
  }, [selectedStore]);

  // Pagination for Candidates
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Registry tab filters & pagination
  const [regSearchQuery, setRegSearchQuery] = useState<string>("");
  const [regPage, setRegPage] = useState<number>(1);
  const [regPageSize, setRegPageSize] = useState<number>(50);
  const [selectedRegIds, setSelectedRegIds] = useState<Set<string>>(new Set());
  const [isDeletingReg, setIsDeletingReg] = useState<boolean>(false);

  // Auto Upload modal state
  const [isAutoUploadModalOpen, setIsAutoUploadModalOpen] = useState<boolean>(false);
  const [isAutoUploading, setIsAutoUploading] = useState<boolean>(false);
  const [autoUploadStep, setAutoUploadStep] = useState<number>(0);
  const [autoUploadSuccessResult, setAutoUploadSuccessResult] = useState<{
    jobId: string;
    fileName: string;
    campaignCount: number;
    actionCount: number;
    message: string;
  } | null>(null);
  const [autoUploadError, setAutoUploadError] = useState<string | null>(null);
  const [liveUploadStatus, setLiveUploadStatus] = useState<{
    status: string;
    stage: string;
    progressPct?: number;
    amazonUploadId?: string;
    resultSummary?: string;
    errorMessage?: string;
  } | null>(null);

  // Fetch registry
  const fetchRegistry = useCallback(async () => {
    registryListRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++registryRequestIdRef.current;
    registryListRequestRef.current = { controller, id: requestId };
    try {
      setLoadingRegistry(true);
      const params = new URLSearchParams();
      if (selectedStore && selectedStore !== "ALL") {
        params.set("storeName", selectedStore);
      }
      const res = await fetch(`/api/ppc/sale-kw/registry?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Không thể tải Registry Sale KW (HTTP ${res.status})`);
      const json = await res.json();
      if (registryListRequestRef.current?.id !== requestId) return;
      if (json.success && json.data) {
        setRegistryItems(json.data.items || []);
        setRegistrySummary(
          json.data.summary || {
            totalCampaigns: 0,
            totalKeywords: 0,
            totalOrders: 0,
            totalSales: 0,
            totalSpend: 0,
          }
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Lỗi khi tải Sale KW Registry:", err);
    } finally {
      if (registryListRequestRef.current?.id === requestId) {
        registryListRequestRef.current = null;
        setLoadingRegistry(false);
      }
    }
  }, [selectedStore]);

  useEffect(() => {
    void fetchRegistry();
    return () => registryListRequestRef.current?.controller.abort();
  }, [fetchRegistry]);

  // Aggregate search terms by (SKU, customerSearchTerm)
  // Bỏ qua ASIN ("chỉ lấy keyword thôi, asin bỏ qua")
  // Bid = CPC trung bình ("bid sẽ là lấy cpc trung bình của search term đó")
  const candidateBase = useMemo(() => {
    // Không gộp dữ liệu giữa nhiều store: cùng SKU/keyword ở các store khác nhau
    // có thể có CPC và lịch sử lên campaign hoàn toàn khác nhau.
    if (selectedStore === "ALL") return [];
    if (!searchTerms || searchTerms.length === 0) return [];

    const map = new Map<string, SaleKwCandidate>();

    for (const term of searchTerms) {
      const rawTerm = (term.customerSearchTerm || "").trim();
      if (!rawTerm) continue;

      // 1. Chỉ lấy Keyword thôi, ASIN bỏ qua hoàn toàn
      if (isAsinProductTarget(rawTerm)) continue;

      const sku = resolveSkuForSearchTerm(term, selectedSku);
      const groupKey = `${sku.toLowerCase()}|||${rawTerm.toLowerCase()}`;
      const existing = map.get(groupKey);

      if (!existing) {
        map.set(groupKey, {
          key: groupKey,
          sku,
          customerSearchTerm: rawTerm,
          sourceCampaignNames: term.campaignName ? [term.campaignName.trim()] : [],
          sourceCampaignId: term.campaignId,
          sourceAdGroupId: term.adGroupId,
          sourceAdGroupName: term.adGroupName,
          impressions: Number(term.impressions) || 0,
          clicks: Number(term.clicks) || 0,
          spend: Number(term.spend) || 0,
          sales: Number(term.sales) || 0,
          orders: Number(term.orders) || 0,
          cpc: 0,
          acos: 0,
          bid: defaultBid,
          storeId: term.storeId,
          storeName: term.storeName,
        });
      } else {
        existing.impressions += Number(term.impressions) || 0;
        existing.clicks += Number(term.clicks) || 0;
        existing.spend += Number(term.spend) || 0;
        existing.sales += Number(term.sales) || 0;
        existing.orders += Number(term.orders) || 0;
        if (term.campaignName && !existing.sourceCampaignNames.includes(term.campaignName.trim())) {
          existing.sourceCampaignNames.push(term.campaignName.trim());
        }
        if (!existing.sourceCampaignId && term.campaignId) existing.sourceCampaignId = term.campaignId;
        if (!existing.sourceAdGroupId && term.adGroupId) existing.sourceAdGroupId = term.adGroupId;
        if (!existing.sourceAdGroupName && term.adGroupName) existing.sourceAdGroupName = term.adGroupName;
      }
    }

    // 2. Lọc search term có orders > 2 của SKU đó
    const thresholdNum = Number(orderThreshold) || 2;
    const candidates = Array.from(map.values()).filter((c) => {
      return orderOperator === ">" ? c.orders > thresholdNum : c.orders >= thresholdNum;
    });

    for (const c of candidates) {
      // 3. Bid lấy CPC trung bình của search term đó: spend / clicks (làm tròn 2 chữ số thập phân)
      const spendNum = Number(c.spend) || 0;
      const clicksNum = Number(c.clicks) || 0;
      const salesNum = Number(c.sales) || 0;
      c.cpc = clicksNum > 0 ? Math.round((spendNum / clicksNum) * 100) / 100 : 0;
      c.acos = salesNum > 0 ? Math.round((spendNum / salesNum) * 10000) / 100 : 0;
      c.bid = bidMode === "cpc" && c.cpc > 0 ? Math.max(0.1, c.cpc) : defaultBid;
    }

    return candidates;
  }, [searchTerms, selectedSku, orderThreshold, orderOperator, defaultBid, bidMode, selectedStore]);

  const allCandidates = useMemo(() => {
    return candidateBase.map((candidate) => ({
      ...candidate,
      isAlreadyLaunched:
        launchedLookupSet.has(candidate.key) ||
        launchedLookupSet.has(candidate.customerSearchTerm.toLowerCase()),
    }));
  }, [candidateBase, launchedLookupSet]);

  useEffect(() => {
    registryLookupRequestRef.current?.controller.abort();
    setLaunchedLookupSet(new Set());
    setRegistryLookupError(null);

    if (loading) {
      setRegistryLookupReady(false);
      setLoadingRegistryLookup(false);
      return;
    }
    if (candidateBase.length === 0) {
      setRegistryLookupReady(true);
      setLoadingRegistryLookup(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++registryRequestIdRef.current;
    registryLookupRequestRef.current = { controller, id: requestId };
    setRegistryLookupReady(false);
    setLoadingRegistryLookup(true);

    const loadLookup = async () => {
      try {
        const res = await fetch("/api/ppc/sale-kw/registry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({
            storeName: selectedStore,
            candidates: candidateBase.map((candidate) => ({
              sku: candidate.sku,
              keyword: candidate.customerSearchTerm,
            })),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.error || json.message || `Không thể kiểm tra Registry (HTTP ${res.status})`);
        }
        if (registryLookupRequestRef.current?.id !== requestId) return;
        setLaunchedLookupSet(new Set(json.lookupKeys || []));
        setRegistryLookupReady(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (registryLookupRequestRef.current?.id !== requestId) return;
        console.error("Lỗi khi kiểm tra Sale KW Registry:", error);
        setRegistryLookupError(error instanceof Error ? error.message : "Không thể kiểm tra Registry Sale KW.");
        setRegistryLookupReady(false);
      } finally {
        if (registryLookupRequestRef.current?.id === requestId) {
          registryLookupRequestRef.current = null;
          setLoadingRegistryLookup(false);
        }
      }
    };

    void loadLookup();
    return () => controller.abort();
  }, [candidateBase, loading, registryLookupRetry, selectedStore]);

  // Candidates count that are already launched
  const alreadyLaunchedCount = useMemo(() => {
    return allCandidates.filter((c) => c.isAlreadyLaunched).length;
  }, [allCandidates]);

  // Unique SKUs for filter dropdown
  const candidateSkus = useMemo(() => {
    return Array.from(new Set(allCandidates.map((c) => c.sku))).sort();
  }, [allCandidates]);

  // Filtered candidates
  const filteredCandidates = useMemo(() => {
    let list = [...allCandidates];

    if (hideLaunched) {
      list = list.filter((c) => !c.isAlreadyLaunched);
    }

    if (skuFilter !== "ALL") {
      list = list.filter((c) => c.sku === skuFilter);
    }

    if (searchQuery.trim()) {
      const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const text = `${c.customerSearchTerm} ${c.sku} ${c.sourceCampaignNames.join(" ")}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }

    // Sort by orders desc, then sales desc
    list.sort((a, b) => b.orders - a.orders || b.sales - a.sales);

    return list;
  }, [allCandidates, hideLaunched, skuFilter, searchQuery]);

  // Group filtered candidates by SKU and generate the 3 Target Campaigns (Exact, Phrase, Broad)
  const skuGroups = useMemo(() => {
    const map = new Map<string, SaleKwSkuGroup>();

    for (const c of filteredCandidates) {
      if (!map.has(c.sku)) {
        const campNames = generateSaleKwCampaignTriad({
          sku: c.sku,
          adTypeCode,
          userName: userName.trim() || "Loan",
          dateStr: customDate.trim() || formatDDMMYY(),
        });

        map.set(c.sku, {
          sku: c.sku,
          items: [],
          totalOrders: 0,
          totalSales: 0,
          totalSpend: 0,
          totalClicks: 0,
          avgCpc: 0,
          adTypeCode,
          campaignNames: campNames,
        });
      }
      const g = map.get(c.sku)!;
      g.items.push(c);
      g.totalOrders += Number(c.orders) || 0;
      g.totalSales += Number(c.sales) || 0;
      g.totalSpend += Number(c.spend) || 0;
      g.totalClicks += Number(c.clicks) || 0;
    }

    const groups = Array.from(map.values());
    for (const g of groups) {
      const clicks = Number(g.totalClicks) || 0;
      const spend = Number(g.totalSpend) || 0;
      g.avgCpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
    }

    return groups.sort((a, b) => b.totalOrders - a.totalOrders || b.totalSales - a.totalSales);
  }, [filteredCandidates, adTypeCode, userName, customDate]);

  // Paginated SKU Groups
  const totalGroupPages = Math.max(1, Math.ceil(skuGroups.length / pageSize));
  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return skuGroups.slice(start, start + pageSize);
  }, [skuGroups, page, pageSize]);

  // Summary Metrics of Candidates
  const stats = useMemo(() => {
    const totalTerms = filteredCandidates.length;
    const totalSkus = skuGroups.length;
    const totalCamps = skuGroups.reduce(
      (sum, group) =>
        sum +
        SALE_KW_MATCH_TYPES.filter(
          (matchType) => !disabledMatchTypes.has(matchTypeSelectionKey(group.sku, matchType))
        ).length,
      0
    );
    const totalOrders = filteredCandidates.reduce((s, c) => s + (Number(c.orders) || 0), 0);
    const totalSales = filteredCandidates.reduce((s, c) => s + (Number(c.sales) || 0), 0);
    const totalSpend = filteredCandidates.reduce((s, c) => s + (Number(c.spend) || 0), 0);
    const totalClicks = filteredCandidates.reduce((s, c) => s + (Number(c.clicks) || 0), 0);
    const avgAcos = totalSales > 0 ? Math.round(((totalSpend / totalSales) * 100) * 100) / 100 : 0;
    const avgCpc = totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0;

    return {
      totalTerms,
      totalSkus,
      totalCamps,
      totalOrders,
      totalSales,
      totalSpend,
      avgAcos,
      avgCpc,
    };
  }, [filteredCandidates, skuGroups, disabledMatchTypes]);

  // Toggle selection for all terms (chỉ chọn những term chưa lên Camp)
  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredCandidates.filter((c) => !c.isAlreadyLaunched).map((c) => c.key)));
    }
  };

  // Toggle selection for all terms in a SKU
  const handleSelectSku = (sku: string, checked: boolean) => {
    const group = skuGroups.find((g) => g.sku === sku);
    if (!group) return;
    const next = new Set(selectedKeys);
    for (const it of group.items) {
      if (checked) {
        if (!it.isAlreadyLaunched) next.add(it.key);
      } else {
        next.delete(it.key);
      }
    }
    setSelectedKeys(next);
  };

  // Toggle selection for an individual term
  const handleToggleKey = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  // Toggle collapse/expand of a SKU card
  const toggleSkuCollapse = (sku: string) => {
    setCollapsedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const isMatchTypeEnabled = (sku: string, matchType: SaleKwMatchType) => {
    return !disabledMatchTypes.has(matchTypeSelectionKey(sku, matchType));
  };

  const handleToggleMatchType = (sku: string, matchType: SaleKwMatchType) => {
    const selectionKey = matchTypeSelectionKey(sku, matchType);
    setDisabledMatchTypes((prev) => {
      const next = new Set(prev);
      if (next.has(selectionKey)) next.delete(selectionKey);
      else next.add(selectionKey);
      return next;
    });
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Selected items resolved (chỉ lấy các term chưa lên Camp để không bao giờ tạo trùng)
  const targetItems = useMemo(() => {
    let list = filteredCandidates;
    if (selectedKeys.size > 0) {
      list = filteredCandidates.filter((c) => selectedKeys.has(c.key));
    }
    return list.filter((c) => !c.isAlreadyLaunched);
  }, [filteredCandidates, selectedKeys]);

  const enabledTargetSkus = useMemo(() => {
    const skus = new Set(targetItems.map((c) => c.sku));
    return new Set(
      Array.from(skus).filter((sku) =>
        SALE_KW_MATCH_TYPES.some(
          (matchType) => !disabledMatchTypes.has(matchTypeSelectionKey(sku, matchType))
        )
      )
    );
  }, [targetItems, disabledMatchTypes]);

  const launchableTargetItems = useMemo(() => {
    return targetItems.filter((item) => enabledTargetSkus.has(item.sku));
  }, [targetItems, enabledTargetSkus]);

  const targetSkuCount = enabledTargetSkus.size;

  const targetCampaignCount = useMemo(() => {
    return Array.from(enabledTargetSkus).reduce(
      (sum, sku) =>
        sum +
        SALE_KW_MATCH_TYPES.filter(
          (matchType) => !disabledMatchTypes.has(matchTypeSelectionKey(sku, matchType))
        ).length,
      0
    );
  }, [enabledTargetSkus, disabledMatchTypes]);

  // Build Campaign payload theo các match type được chọn cho từng SKU
  const buildTriadCampaignsPayload = () => {
    const skuMap = new Map<string, SaleKwCandidate[]>();
    for (const it of launchableTargetItems) {
      if (!skuMap.has(it.sku)) {
        skuMap.set(it.sku, []);
      }
      skuMap.get(it.sku)!.push(it);
    }

    const activeDateStr = customDate.trim() || formatDDMMYY();
    const activeUser = userName.trim() || "Loan";
    const campaigns: any[] = [];

    for (const [sku, items] of skuMap.entries()) {
      const triad = generateSaleKwCampaignTriad({
        sku,
        adTypeCode,
        userName: activeUser,
        dateStr: activeDateStr,
      });

      const totalSkuSpend = items.reduce((s, it) => s + it.spend, 0);
      const totalSkuClicks = items.reduce((s, it) => s + it.clicks, 0);
      const skuAvgCpc = totalSkuClicks > 0 ? Math.round((totalSkuSpend / totalSkuClicks) * 100) / 100 : defaultBid;

      const sourceCampName = items[0]?.sourceCampaignNames?.[0] || sku;
      const sourceCampId = items[0]?.sourceCampaignId || "";
      const sourceAgId = items[0]?.sourceAdGroupId || "";
      const sourceAgName = items[0]?.sourceAdGroupName || sourceCampName;

      const configs: Array<{ matchTypeTitle: "Exact" | "Phrase" | "Broad"; matchTypeLower: "exact" | "phrase" | "broad"; campName: string }> = [
        { matchTypeTitle: "Exact", matchTypeLower: "exact", campName: triad.exact },
        { matchTypeTitle: "Phrase", matchTypeLower: "phrase", campName: triad.phrase },
        { matchTypeTitle: "Broad", matchTypeLower: "broad", campName: triad.broad },
      ];

      for (const cfg of configs) {
        if (!isMatchTypeEnabled(sku, cfg.matchTypeLower)) continue;

        const keywords = items.map((it) => {
          const kwBid = it.bid && it.bid > 0
            ? it.bid
            : it.cpc && it.cpc > 0
              ? Math.max(0.1, it.cpc)
              : defaultBid;

          return {
            customerSearchTerm: it.customerSearchTerm,
            keyword: it.customerSearchTerm,
            matchType: cfg.matchTypeLower,
            bid: kwBid,
            orders: it.orders,
            sales: it.sales,
            clicks: it.clicks,
            spend: it.spend,
          };
        });

        campaigns.push({
          sourceCampaignName: sourceCampName,
          sourceCampaignId: sourceCampId,
          sourceAdGroupId: sourceAgId,
          sourceAdGroupName: sourceAgName,
          targetCampaignName: cfg.campName,
          adGroupName: cfg.campName,
          sku,
          dailyBudget,
          defaultBid: skuAvgCpc > 0 ? skuAvgCpc : defaultBid,
          biddingStrategy: "Dynamic bids - down only",
          negateInSource,
          keywords,
        });
      }
    }

    return campaigns;
  };

  // Handle Manual Export Bulksheet
  const handleExportBulksheet = async () => {
    if (!registryLookupReady) {
      notify("Đang kiểm tra các từ khóa đã lên Campaign. Vui lòng chờ hoàn tất.", "error");
      return;
    }
    if (launchableTargetItems.length === 0 || targetCampaignCount === 0) {
      notify("Hãy chọn ít nhất một match type để xuất file.", "error");
      return;
    }

    setIsExporting(true);
    try {
      const storeObj = stores?.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase());
      const activeStoreName = selectedStore !== "ALL"
        ? (storeObj?.name || selectedStore)
        : launchableTargetItems.find((c) => c.storeName)?.storeName || launchableTargetItems[0]?.storeName || "STORE";

      const triadCampaigns = buildTriadCampaignsPayload();

      const payload = {
        storeName: activeStoreName,
        dailyBudget,
        defaultBid,
        negateInSource,
        userName,
        dateStr: customDate,
        adTypeCode,
        campaigns: triadCampaigns,
        items: launchableTargetItems.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          sku: c.sku,
          campaignName: c.sourceCampaignNames?.[0] || c.sku,
          adGroupName: c.sourceAdGroupName || c.sku,
          campaignId: c.sourceCampaignId,
          adGroupId: c.sourceAdGroupId,
          bid: c.bid,
          clicks: c.clicks,
          orders: c.orders,
          sales: c.sales,
          spend: c.spend,
          cpc: c.cpc,
        })),
      };

      const res = await fetch("/api/ppc/sale-kw/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.message || `Lỗi xuất file (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      let filename = `Upload_${activeStoreName}_Sale_KW_${triadCampaigns.length}Camps_${launchableTargetItems.length}Terms.xlsx`;
      const match = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^'";\n]+)['"]?/i);
      if (match?.[1]) {
        filename = decodeURIComponent(match[1]);
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      notify(`Đã xuất thành công file Bulksheet: ${filename}`, "success");
      // Cập nhật ngay lập tức vào set đã lên Camp để chuyển sang Hub quản trị tức thì
      setLaunchedLookupSet((prev) => {
        const next = new Set(prev);
        for (const it of launchableTargetItems) {
          const keyword = it.customerSearchTerm.trim().toLowerCase();
          if (it.sku) {
            next.add(`${it.sku.trim().toLowerCase()}|||${keyword}`);
          } else next.add(keyword);
        }
        return next;
      });
      setSelectedKeys(new Set());
      setHideLaunched(true);
      fetchRegistry();
    } catch (err: any) {
      console.error(err);
      notify(err.message || "Lỗi khi xuất file Bulksheet Amazon.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Open Auto Upload Modal
  const handleOpenAutoUploadModal = () => {
    if (selectedStore === "ALL") {
      notify("Không thể Auto Upload khi đang chọn 'Tất cả Store'. Vui lòng chọn 1 Store cụ thể trên thanh điều hướng để đảm bảo upload chính xác vào đúng tài khoản Amazon Seller.", "error");
      return;
    }
    if (!registryLookupReady) {
      notify("Đang kiểm tra các từ khóa đã lên Campaign. Vui lòng chờ hoàn tất.", "error");
      return;
    }
    if (launchableTargetItems.length === 0 || targetCampaignCount === 0) {
      notify("Hãy chọn ít nhất một match type để Auto Upload.", "error");
      return;
    }

    const conflictingItem = launchableTargetItems.find((c) => {
      if (c.storeName && c.storeName !== "ALL" && c.storeName.toLowerCase() !== selectedStore.toLowerCase()) return true;
      return false;
    });
    if (conflictingItem) {
      notify(`Dữ liệu chứa từ khóa thuộc Store "${conflictingItem.storeName}", không khớp với Store "${selectedStore}". Vui lòng làm mới trang để đảm bảo dữ liệu đồng bộ.`, "error");
      return;
    }

    setAutoUploadError(null);
    setAutoUploadSuccessResult(null);
    setAutoUploadStep(0);
    setIsAutoUploadModalOpen(true);
  };

  // Execute Auto Upload
  const handleExecuteAutoUpload = async () => {
    if (selectedStore === "ALL") {
      notify("Không thể Auto Upload khi đang chọn 'Tất cả Store'. Vui lòng chọn 1 Store cụ thể.", "error");
      return;
    }
    if (!registryLookupReady) {
      notify("Chưa thể xác nhận trạng thái các từ khóa đã lên Campaign.", "error");
      return;
    }
    if (launchableTargetItems.length === 0 || targetCampaignCount === 0) {
      notify("Hãy chọn ít nhất một match type để Auto Upload.", "error");
      return;
    }

    setIsAutoUploading(true);
    setAutoUploadError(null);
    setAutoUploadStep(1);

    try {
      const storeObj = stores?.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase());
      const activeStoreName = storeObj?.name || selectedStore;
      const activeStoreId = storeObj?.id || launchableTargetItems.find((c) => c.storeId)?.storeId || launchableTargetItems[0]?.storeId;

      const triadCampaigns = buildTriadCampaignsPayload();

      const payload = {
        storeName: activeStoreName,
        storeId: activeStoreId,
        dailyBudget,
        defaultBid,
        negateInSource,
        userName,
        dateStr: customDate,
        adTypeCode,
        campaigns: triadCampaigns,
        items: launchableTargetItems.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          sku: c.sku,
          campaignName: c.sourceCampaignNames?.[0] || c.sku,
          adGroupName: c.sourceAdGroupName || c.sku,
          campaignId: c.sourceCampaignId,
          adGroupId: c.sourceAdGroupId,
          bid: c.bid,
          clicks: c.clicks,
          orders: c.orders,
          sales: c.sales,
          spend: c.spend,
          cpc: c.cpc,
          storeId: c.storeId,
          storeName: c.storeName,
        })),
      };

      const res = await fetch("/api/ppc/sale-kw/auto-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || `Lỗi Auto Upload (HTTP ${res.status})`);
      }

      setAutoUploadSuccessResult({
        jobId: json.jobId,
        fileName: json.fileName,
        campaignCount: json.campaignCount || triadCampaigns.length,
        actionCount: json.actionCount || launchableTargetItems.length,
        message: json.message || "Đã xếp hàng tác vụ Bulk Upload lên Mac mini.",
      });

      setAutoUploadStep(2);
      notify("Đã xếp hàng Auto Upload thành công lên Mac mini!", "success");
      setLaunchedLookupSet((prev) => {
        const next = new Set(prev);
        for (const it of launchableTargetItems) {
          const keyword = it.customerSearchTerm.trim().toLowerCase();
          if (it.sku) {
            next.add(`${it.sku.trim().toLowerCase()}|||${keyword}`);
          } else next.add(keyword);
        }
        return next;
      });
      setSelectedKeys(new Set());
      setHideLaunched(true);
      fetchRegistry();
    } catch (err: any) {
      console.error("Auto upload error:", err);
      setAutoUploadError(err.message || "Lỗi khi kích hoạt Auto Upload.");
      setAutoUploadStep(0);
    } finally {
      setIsAutoUploading(false);
    }
  };

  // Poll live upload status when job is submitted
  useEffect(() => {
    if (!autoUploadSuccessResult?.jobId) return;

    let timer: NodeJS.Timeout;
    const pollStatus = async () => {
      try {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(autoUploadSuccessResult.jobId)}`);
        if (!res.ok) return;
        const json = await res.json();
        const l = json.data?.log;
        if (json.success && l) {
          setLiveUploadStatus({
            status: l.status,
            stage: l.stage,
            progressPct: l.progressPct ?? l.progress_pct,
            amazonUploadId: l.amazonUploadId ?? l.amazon_upload_id,
            resultSummary: l.resultSummary ?? l.result_summary,
            errorMessage: l.errorMessage ?? l.error_message,
          });

          if (["SUCCESS", "PARTIAL_SUCCESS", "FAILED", "RESULT_TIMEOUT"].includes(l.status)) {
            if (l.status === "SUCCESS" || l.status === "PARTIAL_SUCCESS") {
              fetchRegistry();
            }
            return;
          }
        }
      } catch (err) {
        console.error("Lỗi polling trạng thái bulk upload:", err);
      }
      timer = setTimeout(pollStatus, 3000);
    };

    pollStatus();
    return () => clearTimeout(timer);
  }, [autoUploadSuccessResult?.jobId]);

  // Registry bulk delete
  const handleDeleteRegistrySelected = async () => {
    if (selectedRegIds.size === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedRegIds.size} từ khóa khỏi quản trị Sale KW?`)) return;

    setIsDeletingReg(true);
    try {
      const res = await fetch(`/api/ppc/sale-kw/registry?ids=${Array.from(selectedRegIds).join(",")}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || "Lỗi khi xóa từ khóa.");
      }
      notify(json.message || "Đã xóa thành công!", "success");
      setSelectedRegIds(new Set());
      void fetchRegistry();
      setRegistryLookupRetry((value) => value + 1);
    } catch (err: any) {
      notify(err.message || "Lỗi khi xóa.", "error");
    } finally {
      setIsDeletingReg(false);
    }
  };

  // Filtered Registry Items
  const filteredRegItems = useMemo(() => {
    let list = [...registryItems];
    if (regSearchQuery.trim()) {
      const q = regSearchQuery.toLowerCase();
      list = list.filter((it) =>
        it.keyword_text.toLowerCase().includes(q) ||
        it.source_campaign_name.toLowerCase().includes(q) ||
        it.target_campaign_name.toLowerCase().includes(q) ||
        (it.sku && it.sku.toLowerCase().includes(q))
      );
    }
    return list;
  }, [registryItems, regSearchQuery]);

  const totalRegPages = Math.max(1, Math.ceil(filteredRegItems.length / regPageSize));
  const paginatedRegItems = useMemo(() => {
    const start = (regPage - 1) * regPageSize;
    return filteredRegItems.slice(start, start + regPageSize);
  }, [filteredRegItems, regPage, regPageSize]);

  const handleCopySelectedOrAll = async () => {
    const targetItems = selectedKeys.size > 0
      ? launchableTargetItems.filter((i) => selectedKeys.has(i.key))
      : launchableTargetItems;

    if (targetItems.length === 0) {
      notify("Không có Search Term nào để copy", "error");
      return;
    }

    const textToCopy = Array.from(new Set(targetItems.map((i) => i.customerSearchTerm))).join("\n");
    try {
      await navigator.clipboard.writeText(textToCopy);
      notify(`Đã copy ${targetItems.length} search term vào clipboard`, "success");
    } catch {
      notify("Không thể copy danh sách từ khóa", "error");
    }
  };

  const candidateDataPending = loading || loadingRegistryLookup || (!registryLookupReady && !registryLookupError);
  const candidateActionsDisabled =
    selectedStore === "ALL" || loading || loadingRegistryLookup || !registryLookupReady;

  return (
    <div className="space-y-4">
      {/* 1. Sub-tab Navigation Header (đồng bộ bố cục ST Optimization) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab("candidates")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
              subTab === "candidates"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <RocketLaunch size={15} weight="bold" />
            <span>Lên Camp Sale KW</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                subTab === "candidates" ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {allCandidates.filter((c) => !c.isAlreadyLaunched).length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab("registry")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
              subTab === "registry"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck size={15} weight="bold" />
            <span>Quản trị Camp Sale KW (Registry)</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                subTab === "registry" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {registrySummary.totalKeywords}
            </span>
          </button>
        </div>

        {subTab === "candidates" && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs">
              <input
                type="checkbox"
                checked={hideLaunched}
                onChange={(e) => setHideLaunched(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4 cursor-pointer"
              />
              <span>Ẩn ST đã lên Camp</span>
              {alreadyLaunchedCount > 0 && (
                <span className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {alreadyLaunchedCount} đã lên
                </span>
              )}
            </label>

            <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-2xs">
              <input
                type="checkbox"
                checked={negateInSource}
                onChange={(e) => setNegateInSource(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4 cursor-pointer"
              />
              <span title="Phủ định Negative Exact trong Campaign cũ để tránh cạnh tranh">
                Phủ định Exact ở Camp cũ
              </span>
            </label>
          </div>
        )}
      </div>

      {subTab === "candidates" ? (
        <>
          {/* 2. Rule & Filter Control Bar (đồng bộ bố cục ST Optimization) */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
            {/* Top Toolbar Row: Filters Left, Actions Right */}
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
              {/* Left: Filter Controls */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Lọc Orders (giống ST Optim Clicks) */}
                <div className="flex items-center rounded-lg border border-emerald-300 bg-emerald-50/80 px-2 py-1 shadow-2xs">
                  <label className="text-[11px] font-extrabold text-emerald-900 mr-1.5 flex items-center gap-1">
                    <Funnel size={13} weight="bold" />
                    <span>Orders:</span>
                  </label>
                  <select
                    value={orderOperator}
                    onChange={(e) => setOrderOperator(e.target.value as ">" | ">=")}
                    className="bg-white border border-emerald-200 text-emerald-900 font-black text-xs rounded px-1.5 py-0.5 outline-none cursor-pointer mr-1"
                    title="Toán tử so sánh"
                  >
                    <option value="&gt;">&gt;</option>
                    <option value="&gt;=">&ge;</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={orderThreshold}
                    onChange={(e) => setOrderThreshold(Math.max(1, Number(e.target.value) || 1))}
                    className="w-14 px-1.5 py-0.5 text-center font-black text-emerald-800 bg-white border border-emerald-300 rounded font-mono text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                    title="Ngưỡng đơn hàng tối thiểu"
                  />
                </div>

                {/* Quick SKU Filter */}
                {candidateSkus.length > 1 && (
                  <div className="relative">
                    <select
                      value={skuFilter}
                      onChange={(e) => {
                        setSkuFilter(e.target.value);
                        setPage(1);
                      }}
                      className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 outline-none cursor-pointer max-w-[240px] truncate"
                    >
                      <option value="ALL">Tất cả SKU ({candidateSkus.length})</option>
                      {candidateSkus.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Search Input */}
                <div className="relative min-w-[220px] flex-1 sm:flex-initial">
                  <MagnifyingGlass size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Lọc từ khóa, SKU..."
                    className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-emerald-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Right: Action Buttons (giống ST Optim) */}
              <div className="flex items-center gap-2 justify-end">
                <button
                  type="button"
                  onClick={handleCopySelectedOrAll}
                  disabled={candidateActionsDisabled}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Copy danh sách Search Term"
                >
                  <Copy size={13} />
                  <span>{selectedKeys.size > 0 ? `Copy (${selectedKeys.size})` : "Copy Tất Cả"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportBulksheet}
                  disabled={candidateActionsDisabled || isExporting || launchableTargetItems.length === 0 || targetCampaignCount === 0}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Xuất file Excel Bulksheet theo các match type đã chọn"
                >
                  {isExporting ? (
                    <>
                      <CircleNotch size={14} className="animate-spin text-emerald-600" />
                      <span>Đang xuất...</span>
                    </>
                  ) : (
                    <>
                      <FileXls size={15} weight="bold" className="text-emerald-600" />
                      <span>Xuất Bulksheet ({targetCampaignCount})</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleOpenAutoUploadModal}
                  disabled={candidateActionsDisabled || launchableTargetItems.length === 0 || targetCampaignCount === 0 || selectedStore === "ALL"}
                  className="px-4 py-1.5 rounded-lg bg-linear-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  title={selectedStore === "ALL" ? "Vui lòng chọn 1 Store cụ thể trên thanh công cụ để thực hiện Auto Upload" : "Xếp hàng tự động nạp qua AdsPower lên Amazon"}
                >
                  <Lightning size={15} weight="fill" className="text-amber-300 animate-pulse" />
                  <span>Auto Upload ({targetCampaignCount} camps)</span>
                </button>
              </div>
            </div>

            {/* Campaign Config Parameters (Row 2 inside Card) */}
            <div className="flex flex-wrap items-center gap-3 pt-2.5 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-600" title="Tên người dùng gắn vào tên chiến dịch">Người dùng:</span>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => handleUserNameChange(e.target.value)}
                  placeholder="Loan"
                  className="w-20 px-2 py-0.5 font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-600" title="Dạng chạy (ví dụ SP03)">Dạng chạy:</span>
                <select
                  value={adTypeCode}
                  onChange={(e) => setAdTypeCode(e.target.value)}
                  className="px-2 py-0.5 font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="SP03">SP03 (Keyword)</option>
                  <option value="SP01">SP01</option>
                  <option value="SP02">SP02 (PAT)</option>
                  <option value="SP04">SP04 (Auto)</option>
                  <option value="SB05">SB05 (Video)</option>
                  <option value="SB01">SB01 (Brands)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-600" title="Ngày tháng năm định dạng DDMMYY">Ngày (DDMMYY):</span>
                <input
                  type="text"
                  maxLength={6}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="w-20 px-2 py-0.5 font-mono font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500 text-center"
                  placeholder="100124"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-600">Ngân sách/camp:</span>
                <div className="flex items-center">
                  <span className="text-slate-400 mr-1">$</span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(Math.max(1, Number(e.target.value) || 5))}
                    className="w-14 px-1.5 py-0.5 font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-600">Bid:</span>
                <select
                  value={bidMode}
                  onChange={(e) => setBidMode(e.target.value as any)}
                  className="px-2 py-0.5 font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="cpc">CPC TB từng term</option>
                  <option value="fixed">Cố định ${defaultBid.toFixed(2)}</option>
                </select>
                {bidMode === "fixed" && (
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    value={defaultBid}
                    onChange={(e) => setDefaultBid(Math.max(0.1, Number(e.target.value) || 1.0))}
                    className="w-14 px-1.5 py-0.5 font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            </div>
          </div>

          {/* 3. Summary Metric Cards (bố cục dưới toolbar giống ST Optimization) */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">ST Tiềm năng</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-slate-900 font-mono">
                  {stats.totalTerms.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 font-semibold">từ</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Orders {orderOperator} {orderThreshold}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">SKU đủ chuẩn</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-indigo-600 font-mono">
                  {stats.totalSkus.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 font-semibold">SKU</span>
              </div>
              <span className="text-[10px] text-indigo-600 font-semibold block mt-0.5">
                Sản phẩm có đơn
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">Số Camp sẽ lên</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-purple-700 font-mono">
                  {stats.totalCamps.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 font-semibold">camp</span>
              </div>
              <span className="text-[10px] text-purple-600 font-semibold block mt-0.5">
                Theo match type đã chọn
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">Tổng Orders</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-emerald-600 font-mono">
                  {stats.totalOrders.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 font-semibold">đơn</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Lịch sử tạo đơn
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">Doanh thu ST</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-slate-900 font-mono">
                  ${stats.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">
                ACOS TB: {stats.avgAcos.toFixed(1)}%
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 block uppercase">CPC Trung Bình</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-xl font-black text-blue-600 font-mono">
                  ${stats.avgCpc.toFixed(2)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Gợi ý Bid khởi tạo
              </span>
            </div>
          </div>

          {/* 3. SKU Groups List */}
          {selectedStore === "ALL" ? (
            <div className="p-8 text-center bg-amber-50 rounded-2xl border border-amber-200 space-y-2">
              <WarningCircle size={32} className="mx-auto text-amber-600" />
              <h3 className="text-sm font-bold text-amber-950">Hãy chọn một Store cụ thể</h3>
              <p className="text-xs text-amber-800 max-w-lg mx-auto">
                Sale KW cần tính CPC, kiểm tra lịch sử và tạo Campaign riêng theo từng Store để tránh gộp sai dữ liệu.
              </p>
            </div>
          ) : registryLookupError ? (
            <div className="p-8 text-center bg-rose-50 rounded-2xl border border-rose-200 space-y-3">
              <WarningCircle size={32} className="mx-auto text-rose-600" />
              <div>
                <h3 className="text-sm font-bold text-rose-900">Chưa thể kiểm tra từ khóa đã lên Campaign</h3>
                <p className="mt-1 text-xs text-rose-700">{registryLookupError}</p>
              </div>
              <button
                type="button"
                onClick={() => setRegistryLookupRetry((value) => value + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
              >
                <ArrowsClockwise size={14} weight="bold" />
                Thử tải lại
              </button>
            </div>
          ) : candidateDataPending ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              <CircleNotch size={32} className="animate-spin mx-auto text-emerald-600 mb-2" />
              <p className="text-sm font-semibold">
                {loading ? "Đang tải và tính toán Search Terms..." : "Đang kiểm tra lịch sử Campaign Sale KW..."}
              </p>
            </div>
          ) : skuGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
              <CheckCircle size={40} className="mx-auto text-emerald-500" />
              <h3 className="text-base font-bold text-slate-800">Không có Search Term nào thỏa mãn điều kiện</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Không tìm thấy Search Term (từ khóa chữ) có số Orders {orderOperator} {orderThreshold}. Hãy thử giảm ngưỡng Orders hoặc chọn khoảng ngày dài hơn.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select All Bar */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 flex-wrap gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedKeys.size > 0 && selectedKeys.size === filteredCandidates.length}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span>
                    Chọn tất cả{" "}
                    <strong className="text-slate-900">{filteredCandidates.length}</strong> từ khóa trong{" "}
                    <strong className="text-slate-900">{skuGroups.length}</strong> SKU{" "}
                    <span className="text-slate-400 text-[11px]">
                      (nếu chọn hết sẽ tạo {stats.totalCamps} chiến dịch theo match type đã chọn)
                    </span>
                  </span>
                </label>
                {selectedKeys.size > 0 ? (
                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-900 px-3 py-1 rounded-lg border border-emerald-200">
                    <span className="font-bold text-xs">
                      Đang chọn: {targetSkuCount} SKU ({selectedKeys.size} từ khóa) &rarr; Sẽ tạo đúng{" "}
                      <strong className="text-purple-700 font-black text-sm">{targetCampaignCount} chiến dịch</strong>
                    </span>
                    <span className="text-[11px] text-emerald-700 font-medium">
                      (tính theo từng SKU và match type đã chọn)
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs italic">
                    Chưa tích chọn (mặc định sẽ xuất/nạp toàn bộ nếu không chọn lẻ)
                  </span>
                )}
              </div>

              {/* SKU Group Cards */}
              {paginatedGroups.map((group) => {
                const isCollapsed = collapsedSkus.has(group.sku);
                const isGroupFullySelected = group.items.every((it) => selectedKeys.has(it.key));
                const isGroupPartiallySelected =
                  !isGroupFullySelected && group.items.some((it) => selectedKeys.has(it.key));
                const exactEnabled = isMatchTypeEnabled(group.sku, "exact");
                const phraseEnabled = isMatchTypeEnabled(group.sku, "phrase");
                const broadEnabled = isMatchTypeEnabled(group.sku, "broad");

                return (
                  <div
                    key={group.sku}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-all"
                  >
                    {/* SKU Group Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/80 border-b border-slate-200 gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isGroupFullySelected}
                          ref={(el) => {
                            if (el) el.indeterminate = isGroupPartiallySelected;
                          }}
                          onChange={(e) => handleSelectSku(group.sku, e.target.checked)}
                          className="w-4 h-4 mt-1 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          {/* SKU identifier */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black px-2.5 py-1 rounded-md bg-indigo-600 text-white flex items-center gap-1.5 shrink-0 shadow-2xs">
                              <Tag size={13} weight="bold" /> SKU: {group.sku}
                            </span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 border border-slate-300 shrink-0">
                              {group.items.length} từ khóa (Orders {orderOperator} {orderThreshold})
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                              {group.totalOrders} đơn &middot; ${group.totalSales.toFixed(2)} doanh thu
                            </span>
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 shrink-0">
                              CPC TB: ${group.avgCpc.toFixed(2)}
                            </span>
                          </div>

                          {/* Triad Campaigns Preview: Tách 3 camp Exact, Phrase, Broad */}
                          <div className="space-y-1.5 pt-1">
                            {/* Exact Camp */}
                            <div className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              exactEnabled
                                ? "bg-blue-50/70 border-blue-200/80"
                                : "bg-slate-50 border-slate-200 text-slate-400"
                            }`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={exactEnabled}
                                  onChange={() => handleToggleMatchType(group.sku, "exact")}
                                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer shrink-0"
                                  aria-label={`Tạo Campaign Exact cho SKU ${group.sku}`}
                                />
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white uppercase shrink-0 ${exactEnabled ? "bg-blue-600" : "bg-slate-400"}`}>
                                  Exact
                                </span>
                                <span className={`font-extrabold truncate font-mono text-[11px] ${exactEnabled ? "text-blue-950" : "text-slate-400"}`}>
                                  {group.campaignNames.exact}
                                </span>
                              </div>
                              <button
                                onClick={() => copyToClipboard(group.campaignNames.exact, `${group.sku}_exact`)}
                                className="text-blue-600 hover:text-blue-800 p-1 shrink-0"
                                title="Copy tên Campaign Exact"
                              >
                                {copiedKey === `${group.sku}_exact` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                              </button>
                            </div>

                            {/* Phrase Camp */}
                            <div className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              phraseEnabled
                                ? "bg-sky-50/70 border-sky-200/80"
                                : "bg-slate-50 border-slate-200 text-slate-400"
                            }`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={phraseEnabled}
                                  onChange={() => handleToggleMatchType(group.sku, "phrase")}
                                  className="w-4 h-4 text-sky-600 rounded border-slate-300 focus:ring-sky-500 cursor-pointer shrink-0"
                                  aria-label={`Tạo Campaign Phrase cho SKU ${group.sku}`}
                                />
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white uppercase shrink-0 ${phraseEnabled ? "bg-sky-600" : "bg-slate-400"}`}>
                                  Phrase
                                </span>
                                <span className={`font-extrabold truncate font-mono text-[11px] ${phraseEnabled ? "text-sky-950" : "text-slate-400"}`}>
                                  {group.campaignNames.phrase}
                                </span>
                              </div>
                              <button
                                onClick={() => copyToClipboard(group.campaignNames.phrase, `${group.sku}_phrase`)}
                                className="text-sky-600 hover:text-sky-800 p-1 shrink-0"
                                title="Copy tên Campaign Phrase"
                              >
                                {copiedKey === `${group.sku}_phrase` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                              </button>
                            </div>

                            {/* Broad Camp */}
                            <div className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                              broadEnabled
                                ? "bg-emerald-50/70 border-emerald-200/80"
                                : "bg-slate-50 border-slate-200 text-slate-400"
                            }`}>
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={broadEnabled}
                                  onChange={() => handleToggleMatchType(group.sku, "broad")}
                                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shrink-0"
                                  aria-label={`Tạo Campaign Broad cho SKU ${group.sku}`}
                                />
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white uppercase shrink-0 ${broadEnabled ? "bg-emerald-600" : "bg-slate-400"}`}>
                                  Broad
                                </span>
                                <span className={`font-extrabold truncate font-mono text-[11px] ${broadEnabled ? "text-emerald-950" : "text-slate-400"}`}>
                                  {group.campaignNames.broad}
                                </span>
                              </div>
                              <button
                                onClick={() => copyToClipboard(group.campaignNames.broad, `${group.sku}_broad`)}
                                className="text-emerald-600 hover:text-emerald-800 p-1 shrink-0"
                                title="Copy tên Campaign Broad"
                              >
                                {copiedKey === `${group.sku}_broad` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SKU Card Collapse Toggle */}
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                          onClick={() => toggleSkuCollapse(group.sku)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition"
                          title={isCollapsed ? "Mở rộng danh sách từ khóa" : "Thu gọn"}
                        >
                          {isCollapsed ? <CaretDown size={18} /> : <CaretUp size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* Terms Table inside SKU Group */}
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100/50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-4 w-10"></th>
                              <th className="py-2.5 px-3 font-bold">Search Term</th>
                              <th className="py-2.5 px-3">Nguồn</th>
                              <th className="py-2.5 px-3 text-right">Orders</th>
                              <th className="py-2.5 px-3 text-right">Sales</th>
                              <th className="py-2.5 px-3 text-right">Clicks</th>
                              <th className="py-2.5 px-3 text-right">Spend</th>
                              <th className="py-2.5 px-3 text-center">CPC TB (Bid nạp)</th>
                              <th className="py-2.5 px-3 text-right">ACOS</th>
                              <th className="py-2.5 px-3 text-center">Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                            {group.items.map((item) => {
                              const isChecked = selectedKeys.has(item.key);

                              return (
                                <tr
                                  key={item.key}
                                  className={`hover:bg-slate-50/80 transition-colors ${
                                    isChecked ? "bg-emerald-50/30" : ""
                                  }`}
                                >
                                  <td className="py-2.5 px-4">
                                    <input
                                      type="checkbox"
                                      disabled={item.isAlreadyLaunched}
                                      checked={isChecked && !item.isAlreadyLaunched}
                                      onChange={() => handleToggleKey(item.key)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3 font-bold text-slate-900">
                                    <div className="flex items-center gap-1.5">
                                      <span>{item.customerSearchTerm}</span>
                                      <button
                                        onClick={() => copyToClipboard(item.customerSearchTerm, item.key)}
                                        className="text-slate-400 hover:text-slate-600 transition"
                                        title="Copy Search Term"
                                      >
                                        {copiedKey === item.key ? (
                                          <Check size={12} className="text-emerald-600" />
                                        ) : (
                                          <Copy size={12} />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate" title={item.sourceCampaignNames.join(", ")}>
                                    {item.sourceCampaignNames.join(", ")}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600">
                                    <span className="px-2 py-0.5 bg-emerald-100/70 text-emerald-900 rounded font-black">
                                      {item.orders}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                                    ${item.sales.toFixed(2)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">{item.clicks}</td>
                                  <td className="py-2.5 px-3 text-right text-slate-600">
                                    ${item.spend.toFixed(2)}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    <span className="font-extrabold text-slate-900 bg-emerald-50 border border-emerald-300 text-emerald-950 px-2 py-0.5 rounded font-mono" title="Bid sẽ nạp cho các campaign đã chọn = CPC trung bình của term">
                                      ${item.bid.toFixed(2)}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right">
                                    <span
                                      className={`font-semibold ${
                                        item.acos <= 25
                                          ? "text-emerald-600"
                                          : item.acos <= 40
                                          ? "text-amber-600"
                                          : "text-rose-600"
                                      }`}
                                    >
                                      {item.acos.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {item.isAlreadyLaunched ? (
                                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1">
                                        <Check size={11} weight="bold" /> Đã lên Camp
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                        Sẵn sàng
                                      </span>
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

              {/* Pagination */}
              {totalGroupPages > 1 && (
                <div className="pt-2">
                  <PpcPagination
                    currentPage={page}
                    totalPages={totalGroupPages}
                    totalItems={skuGroups.length}
                    pageSize={pageSize}
                    pageSizeOptions={[10, 20, 50]}
                    itemName="SKU"
                    onPageChange={setPage}
                    onPageSizeChange={(sz) => {
                      setPageSize(sz);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* SubTab 2: Registry Management */
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <button
              onClick={() => setSubTab("candidates")}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs transition cursor-pointer"
            >
              <ArrowLeft size={14} />
              Quay lại Danh sách Đề xuất
            </button>
            <div className="text-xs text-slate-500 font-medium">
              Quản lý các Search Term và Campaign đã nạp vào hệ thống Sale KW
            </div>
          </div>

          {/* Registry Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs text-slate-500 mb-1">Số Campaign Đã Lên</div>
              <div className="text-2xl font-black text-slate-900">{registrySummary.totalCampaigns}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs text-slate-500 mb-1">Số Từ Khóa Đã Nạp</div>
              <div className="text-2xl font-black text-indigo-600">{registrySummary.totalKeywords}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs text-slate-500 mb-1">Tổng Orders Gốc</div>
              <div className="text-2xl font-black text-emerald-600">{registrySummary.totalOrders}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs text-slate-500 mb-1">Tổng Doanh Thu Gốc</div>
              <div className="text-2xl font-black text-slate-900">${registrySummary.totalSales.toFixed(2)}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs text-slate-500 mb-1">Tổng Chi Phí Gốc</div>
              <div className="text-2xl font-black text-slate-900">${registrySummary.totalSpend.toFixed(2)}</div>
            </div>
          </div>

          {/* Registry Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <div className="relative flex-1 max-w-md w-full">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={regSearchQuery}
                onChange={(e) => {
                  setRegSearchQuery(e.target.value);
                  setRegPage(1);
                }}
                placeholder="Tìm từ khóa, campaign đích, SKU trong registry..."
                className="w-full pl-9 pr-8 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              {regSearchQuery && (
                <button
                  onClick={() => setRegSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              {selectedRegIds.size > 0 && (
                <button
                  onClick={handleDeleteRegistrySelected}
                  disabled={isDeletingReg}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                >
                  <Trash size={14} />
                  Xóa {selectedRegIds.size} mục đã chọn
                </button>
              )}
              <button
                onClick={fetchRegistry}
                disabled={loadingRegistry}
                className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition"
                title="Làm mới danh sách"
              >
                <ArrowsClockwise size={16} className={loadingRegistry ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Registry Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={
                          paginatedRegItems.length > 0 &&
                          paginatedRegItems.every((it) => selectedRegIds.has(it.id))
                        }
                        onChange={(e) => {
                          const next = new Set(selectedRegIds);
                          if (e.target.checked) {
                            paginatedRegItems.forEach((it) => next.add(it.id));
                          } else {
                            paginatedRegItems.forEach((it) => next.delete(it.id));
                          }
                          setSelectedRegIds(next);
                        }}
                        className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3">Search Term</th>
                    <th className="py-3 px-3">Target Campaign (Mới)</th>
                    <th className="py-3 px-3">Match Type</th>
                    <th className="py-3 px-3">Source Campaign (Cũ)</th>
                    <th className="py-3 px-3">SKU</th>
                    <th className="py-3 px-3 text-right">Orders</th>
                    <th className="py-3 px-3 text-right">Sales</th>
                    <th className="py-3 px-3 text-center">Bid</th>
                    <th className="py-3 px-3 text-center">Nguồn tạo</th>
                    <th className="py-3 px-3 text-center">Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {loadingRegistry ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500">
                        <CircleNotch size={24} className="animate-spin mx-auto text-emerald-600 mb-2" />
                        Đang tải danh mục...
                      </td>
                    </tr>
                  ) : paginatedRegItems.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-slate-500">
                        Chưa có Campaign Sale KW nào được ghi nhận.
                      </td>
                    </tr>
                  ) : (
                    paginatedRegItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedRegIds.has(item.id)}
                            onChange={(e) => {
                              const next = new Set(selectedRegIds);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setSelectedRegIds(next);
                            }}
                            className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900">
                          {item.keyword_text}
                        </td>
                        <td className="py-3 px-3 font-bold text-emerald-800 max-w-xs truncate" title={item.target_campaign_name}>
                          {item.target_campaign_name}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            item.match_type.toLowerCase() === "exact"
                              ? "bg-blue-100 text-blue-800"
                              : item.match_type.toLowerCase() === "phrase"
                              ? "bg-sky-100 text-sky-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}>
                            {item.match_type}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-600 max-w-xs truncate" title={item.source_campaign_name}>
                          {item.source_campaign_name}
                        </td>
                        <td className="py-3 px-3 font-semibold text-indigo-700">
                          {item.sku || "-"}
                        </td>
                        <td className="py-3 px-3 text-right font-extrabold text-emerald-600">
                          {item.orders}
                        </td>
                        <td className="py-3 px-3 text-right font-semibold text-slate-900">
                          ${Number(item.sales || 0).toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-slate-800">
                          ${Number(item.bid || 1).toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              item.source === "AUTO_UPLOAD"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {item.source === "AUTO_UPLOAD" ? "Auto Mac" : "Xuất File"}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center text-slate-500 text-[11px]">
                          {new Date(item.created_at).toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalRegPages > 1 && (
              <div className="p-3 border-t border-slate-200">
                <PpcPagination
                  currentPage={regPage}
                  totalPages={totalRegPages}
                  totalItems={filteredRegItems.length}
                  pageSize={regPageSize}
                  pageSizeOptions={[20, 50, 100]}
                  itemName="mục"
                  onPageChange={setRegPage}
                  onPageSizeChange={(sz) => {
                    setRegPageSize(sz);
                    setRegPage(1);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Auto Upload Confirmation & Execution Modal */}
      {isAutoUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            {autoUploadStep === 0 && (
              <>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                      <CloudArrowUp size={22} weight="bold" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-slate-900 text-base">Xác nhận Auto Upload Sale KW</h3>
                      <p className="text-xs text-slate-500">Tự động nạp lên Amazon qua AdsPower & Mac mini</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsAutoUploadModalOpen(false)}
                    className="text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="bg-emerald-50/60 rounded-2xl p-4 border border-emerald-100/80 space-y-2 text-xs">
                  <div className="flex justify-between font-bold text-slate-800">
                    <span>Số Search Term sẽ lên Camp:</span>
                    <span className="text-emerald-700 font-extrabold text-sm">{launchableTargetItems.length}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Số SKU được chọn:</span>
                    <span className="font-bold text-slate-900">{targetSkuCount} SKU</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Số Campaign mới theo match type đã chọn:</span>
                    <span className="font-extrabold text-purple-700">{targetCampaignCount} campaigns</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Tên người dùng:</span>
                    <span className="font-bold text-slate-900">{userName || "Loan"}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Dạng chạy / Ngày chạy:</span>
                    <span className="font-bold text-slate-900">{adTypeCode} / {customDate}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Ngân sách mỗi Camp:</span>
                    <span className="font-bold text-slate-900">${dailyBudget.toFixed(2)}/ngày</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Phủ định ở Camp cũ:</span>
                    <span className="font-bold text-slate-900">
                      {negateInSource ? "Có (Negative Exact)" : "Không"}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start gap-2">
                  <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
                  <span>
                    Quy trình: Hệ thống xuất file Excel Bulksheet chuẩn Amazon và đưa vào hàng đợi Cloudflare R2.
                    Worker Mac mini sẽ tự động mở AdsPower, tải file lên Amazon Ads Bulk Operations và báo kết quả.
                  </span>
                </div>

                {autoUploadError && (
                  <div className="p-3 bg-rose-50 text-rose-700 rounded-xl text-xs flex items-center gap-2 border border-rose-200">
                    <WarningCircle size={16} className="shrink-0" />
                    <span>{autoUploadError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    onClick={() => setIsAutoUploadModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    onClick={handleExecuteAutoUpload}
                    disabled={isAutoUploading}
                    className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isAutoUploading ? <CircleNotch size={14} className="animate-spin" /> : <CloudArrowUp size={16} weight="bold" />}
                    Bắt đầu Auto Upload
                  </button>
                </div>
              </>
            )}

            {autoUploadStep === 1 && (
              <div className="py-8 text-center space-y-3">
                <CircleNotch size={40} className="animate-spin text-emerald-600 mx-auto" />
                <h4 className="font-bold text-slate-800 text-sm">Đang chuẩn bị file Bulksheet & kết nối R2...</h4>
                <p className="text-xs text-slate-500">Vui lòng đợi giây lát</p>
              </div>
            )}

            {autoUploadStep === 2 && autoUploadSuccessResult && (
              <div className="space-y-4">
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle size={28} weight="fill" />
                  </div>
                  <h3 className="font-black text-slate-900 text-base">Đã gửi lệnh Auto Upload thành công!</h3>
                  <p className="text-xs text-slate-600">
                    Đã tạo và xếp hàng <strong>{autoUploadSuccessResult.campaignCount}</strong> chiến dịch cho Mac mini xử lý.
                  </p>
                </div>

                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mã Job:</span>
                    <span className="font-mono text-slate-800">{autoUploadSuccessResult.jobId.slice(0, 13)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tên File Bulksheet:</span>
                    <span className="font-medium text-slate-900 truncate max-w-[200px]" title={autoUploadSuccessResult.fileName}>
                      {autoUploadSuccessResult.fileName}
                    </span>
                  </div>
                  {liveUploadStatus && (
                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700">Trạng thái Mac mini:</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          liveUploadStatus.status === "SUCCESS"
                            ? "bg-emerald-100 text-emerald-800"
                            : liveUploadStatus.status === "FAILED"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-blue-100 text-blue-800 animate-pulse"
                        }`}>
                          {liveUploadStatus.status}
                        </span>
                      </div>
                      {liveUploadStatus.stage && (
                        <div className="text-[11px] text-slate-500">
                          Giai đoạn: <strong>{liveUploadStatus.stage}</strong>
                        </div>
                      )}
                      {liveUploadStatus.progressPct !== undefined && (
                        <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1 overflow-hidden">
                          <div
                            className="bg-emerald-600 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${liveUploadStatus.progressPct}%` }}
                          />
                        </div>
                      )}
                      {liveUploadStatus.resultSummary && (
                        <div className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 p-2 rounded border border-emerald-200 mt-1">
                          {liveUploadStatus.resultSummary}
                        </div>
                      )}
                      {liveUploadStatus.errorMessage && (
                        <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded border border-rose-200 mt-1">
                          {liveUploadStatus.errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  {onOpenActionQueue && (
                    <button
                      onClick={() => {
                        setIsAutoUploadModalOpen(false);
                        onOpenActionQueue();
                      }}
                      className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowSquareOut size={14} /> Xem Hàng đợi Tác vụ
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setIsAutoUploadModalOpen(false);
                      setSubTab("registry");
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition cursor-pointer ml-auto"
                  >
                    Xem Quản trị Sale KW
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
