"use client";

import { useState, useMemo, useEffect } from "react";
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
} from "@phosphor-icons/react";
import type { PpcSearchTermRow, MatchType, PpcAdType } from "@/lib/ppc/types";
import { PpcPagination } from "./ppc-pagination";

export interface SaleKwCandidate {
  key: string;
  customerSearchTerm: string;
  campaignName: string;
  targetCampaignName: string;
  adGroupName: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  targetKeyword: string;
  matchType: MatchType;
  adType: PpcAdType;
  sku?: string;
  storeId?: string;
  storeName?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  acos: number;
  bid: number;
  isAlreadyLaunched?: boolean;
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

interface PpcSaleKwViewProps {
  searchTerms: PpcSearchTermRow[];
  selectedStore: string;
  selectedSku: string;
  selectedDays: number;
  loading: boolean;
  notify: (message: string, type?: "success" | "error") => void;
  onOpenActionQueue?: () => void;
}

export function PpcSaleKwView({
  searchTerms,
  selectedStore,
  selectedSku,
  selectedDays,
  loading,
  notify,
  onOpenActionQueue,
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
  const [hideLaunched, setHideLaunched] = useState<boolean>(true);

  // 1. Threshold controls: mặc định Order > 2
  const [orderThreshold, setOrderThreshold] = useState<number>(2);
  const [orderOperator, setOrderOperator] = useState<">" | ">=">(">");

  // 2. Global Campaign Launch Settings
  const [dailyBudget, setDailyBudget] = useState<number>(10.0);
  const [defaultBid, setDefaultBid] = useState<number>(1.0);
  const [negateInSource, setNegateInSource] = useState<boolean>(false);
  const [bidMode, setBidMode] = useState<"cpc" | "fixed">("cpc");

  // 3. Filter & Sort state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [collapsedCampaigns, setCollapsedCampaigns] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Pagination for Candidates
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

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
  const fetchRegistry = async () => {
    try {
      setLoadingRegistry(true);
      const params = new URLSearchParams();
      if (selectedStore && selectedStore !== "ALL") {
        params.set("storeName", selectedStore);
      }
      const res = await fetch(`/api/ppc/sale-kw/registry?${params.toString()}`);
      if (!res.ok) return;
      const json = await res.json();
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
        setLaunchedLookupSet(new Set(json.data.lookupKeys || []));
      }
    } catch (err) {
      console.error("Lỗi khi tải Sale KW Registry:", err);
    } finally {
      setLoadingRegistry(false);
    }
  };

  useEffect(() => {
    fetchRegistry();
  }, [selectedStore]);

  // Aggregate search terms by (campaignName, customerSearchTerm)
  const allCandidates = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return [];

    const map = new Map<string, SaleKwCandidate>();

    for (const term of searchTerms) {
      const rawTerm = (term.customerSearchTerm || "").trim();
      const camp = (term.campaignName || "").trim();
      if (!rawTerm || !camp) continue;

      const groupKey = `${camp.toLowerCase()}|||${rawTerm.toLowerCase()}`;
      const existing = map.get(groupKey);

      if (!existing) {
        map.set(groupKey, {
          key: groupKey,
          customerSearchTerm: rawTerm,
          campaignName: camp,
          targetCampaignName: `${camp} (Sale KW)`,
          adGroupName: `${camp} (Sale KW)`,
          campaignId: term.campaignId,
          adGroupId: term.adGroupId,
          keywordId: term.keywordId,
          targetKeyword: term.targetKeyword || "",
          matchType: term.matchType || "Unknown",
          adType: term.adType || "SP",
          sku: (term as any).sku || "",
          storeId: term.storeId,
          storeName: term.storeName,
          impressions: term.impressions || 0,
          clicks: term.clicks || 0,
          spend: term.spend || 0,
          sales: term.sales || 0,
          orders: term.orders || 0,
          cpc: term.cpc || 0,
          acos: term.acos || 0,
          bid: term.cpc && term.cpc > 0 ? Math.round(term.cpc * 100) / 100 : defaultBid,
        });
      } else {
        existing.impressions += term.impressions || 0;
        existing.clicks += term.clicks || 0;
        existing.spend += term.spend || 0;
        existing.sales += term.sales || 0;
        existing.orders += term.orders || 0;
        if (!existing.campaignId && term.campaignId) existing.campaignId = term.campaignId;
        if (!existing.adGroupId && term.adGroupId) existing.adGroupId = term.adGroupId;
        if (!existing.sku && (term as any).sku) existing.sku = (term as any).sku;
      }
    }

    // Filter rule: Orders > orderThreshold (default > 2)
    const thresholdNum = Number(orderThreshold) || 2;
    const candidates = Array.from(map.values()).filter((c) => {
      return orderOperator === ">" ? c.orders > thresholdNum : c.orders >= thresholdNum;
    });

    for (const c of candidates) {
      c.cpc = c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : 0;
      c.acos = c.sales > 0 ? Math.round((c.spend / c.sales) * 10000) / 100 : 0;
      c.bid = bidMode === "cpc" && c.cpc > 0 ? Math.max(0.1, c.cpc) : defaultBid;
      c.isAlreadyLaunched = launchedLookupSet.has(c.key);
    }

    return candidates;
  }, [searchTerms, orderThreshold, orderOperator, defaultBid, bidMode, launchedLookupSet]);

  // Candidates count that are already launched
  const alreadyLaunchedCount = useMemo(() => {
    return allCandidates.filter((c) => c.isAlreadyLaunched).length;
  }, [allCandidates]);

  // Unique campaigns for filter dropdown
  const candidateCampaigns = useMemo(() => {
    return Array.from(new Set(allCandidates.map((c) => c.campaignName))).sort();
  }, [allCandidates]);

  // Filtered candidates
  const filteredCandidates = useMemo(() => {
    let list = [...allCandidates];

    if (hideLaunched) {
      list = list.filter((c) => !c.isAlreadyLaunched);
    }

    if (campaignFilter !== "ALL") {
      list = list.filter((c) => c.campaignName === campaignFilter);
    }

    if (searchQuery.trim()) {
      const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const text = `${c.customerSearchTerm} ${c.campaignName} ${c.sku || ""}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }

    // Sort by orders desc, then sales desc
    list.sort((a, b) => b.orders - a.orders || b.sales - a.sales);

    return list;
  }, [allCandidates, hideLaunched, campaignFilter, searchQuery]);

  // Group filtered candidates by Campaign Name
  const campaignGroups = useMemo(() => {
    const map = new Map<string, {
      campaignName: string;
      targetCampaignName: string;
      campaignId?: string;
      adGroupId?: string;
      sku?: string;
      items: SaleKwCandidate[];
      totalOrders: number;
      totalSales: number;
      totalSpend: number;
      totalClicks: number;
    }>();

    for (const c of filteredCandidates) {
      if (!map.has(c.campaignName)) {
        map.set(c.campaignName, {
          campaignName: c.campaignName,
          targetCampaignName: c.targetCampaignName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          sku: c.sku,
          items: [],
          totalOrders: 0,
          totalSales: 0,
          totalSpend: 0,
          totalClicks: 0,
        });
      }
      const group = map.get(c.campaignName)!;
      group.items.push(c);
      group.totalOrders += c.orders;
      group.totalSales += c.sales;
      group.totalSpend += c.spend;
      group.totalClicks += c.clicks;
      if (!group.sku && c.sku) group.sku = c.sku;
    }

    return Array.from(map.values()).sort((a, b) => b.totalOrders - a.totalOrders);
  }, [filteredCandidates]);

  // Paginated Campaign Groups
  const totalGroupPages = Math.max(1, Math.ceil(campaignGroups.length / pageSize));
  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return campaignGroups.slice(start, start + pageSize);
  }, [campaignGroups, page, pageSize]);

  // Summary Metrics of Candidates
  const stats = useMemo(() => {
    const totalTerms = filteredCandidates.length;
    const totalCamps = campaignGroups.length;
    const totalOrders = filteredCandidates.reduce((s, c) => s + c.orders, 0);
    const totalSales = filteredCandidates.reduce((s, c) => s + c.sales, 0);
    const totalSpend = filteredCandidates.reduce((s, c) => s + c.spend, 0);
    const totalClicks = filteredCandidates.reduce((s, c) => s + c.clicks, 0);
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

    return {
      totalTerms,
      totalCamps,
      totalOrders,
      totalSales,
      totalSpend,
      avgAcos,
      avgCpc,
    };
  }, [filteredCandidates, campaignGroups]);

  // Toggle selection for all terms
  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredCandidates.map((c) => c.key)));
    }
  };

  // Toggle selection for a single campaign
  const handleSelectCampaign = (campName: string, checked: boolean) => {
    const group = campaignGroups.find((g) => g.campaignName === campName);
    if (!group) return;
    const next = new Set(selectedKeys);
    for (const it of group.items) {
      if (checked) next.add(it.key);
      else next.delete(it.key);
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

  // Toggle collapse/expand of a campaign card
  const toggleCampaignCollapse = (campName: string) => {
    setCollapsedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(campName)) next.delete(campName);
      else next.add(campName);
      return next;
    });
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Selected items resolved
  const targetItems = useMemo(() => {
    if (selectedKeys.size > 0) {
      return filteredCandidates.filter((c) => selectedKeys.has(c.key));
    }
    return filteredCandidates;
  }, [filteredCandidates, selectedKeys]);

  // Handle Manual Export Bulksheet
  const handleExportBulksheet = async () => {
    if (targetItems.length === 0) {
      notify("Không có Search Term nào thỏa mãn để xuất file.", "error");
      return;
    }

    setIsExporting(true);
    try {
      const activeStoreName = selectedStore !== "ALL"
        ? selectedStore
        : targetItems.find((c) => c.storeName)?.storeName || targetItems[0]?.storeName || "STORE";

      const payload = {
        storeName: activeStoreName,
        dailyBudget,
        defaultBid,
        negateInSource,
        items: targetItems.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          adType: c.adType,
          sku: c.sku,
          bid: c.bid,
          matchType: c.matchType,
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
      let filename = `Upload_${activeStoreName}_Sale_KW_${targetItems.length}Terms.xlsx`;
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
    if (targetItems.length === 0) {
      notify("Không có Search Term nào thỏa mãn để Auto Upload.", "error");
      return;
    }
    setAutoUploadError(null);
    setAutoUploadSuccessResult(null);
    setAutoUploadStep(0);
    setIsAutoUploadModalOpen(true);
  };

  // Execute Auto Upload
  const handleExecuteAutoUpload = async () => {
    if (targetItems.length === 0) {
      notify("Không có Search Term nào thỏa mãn để Auto Upload.", "error");
      return;
    }

    setIsAutoUploading(true);
    setAutoUploadError(null);
    setAutoUploadStep(1);

    try {
      const activeStoreName = selectedStore !== "ALL"
        ? selectedStore
        : targetItems.find((c) => c.storeName)?.storeName || targetItems[0]?.storeName || "";
      const activeStoreId = targetItems.find((c) => c.storeId)?.storeId || targetItems[0]?.storeId;

      const payload = {
        storeName: activeStoreName,
        storeId: activeStoreId,
        dailyBudget,
        defaultBid,
        negateInSource,
        items: targetItems.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          adType: c.adType,
          sku: c.sku,
          bid: c.bid,
          matchType: c.matchType,
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
        campaignCount: json.campaignCount || 1,
        actionCount: json.actionCount || targetItems.length,
        message: json.message || "Đã xếp hàng tác vụ Bulk Upload lên Mac mini.",
      });

      setAutoUploadStep(2);
      notify("Đã xếp hàng Auto Upload thành công lên Mac mini!", "success");
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
        const res = await fetch(`/api/ppc/auto-upload/status?jobId=${autoUploadSuccessResult.jobId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.success && json.job) {
          setLiveUploadStatus({
            status: json.job.status,
            stage: json.job.stage,
            progressPct: json.job.progress_pct,
            amazonUploadId: json.job.amazon_upload_id,
            resultSummary: json.job.result_summary,
            errorMessage: json.job.error_message,
          });

          if (["SUCCESS", "PARTIAL_SUCCESS", "FAILED", "RESULT_TIMEOUT"].includes(json.job.status)) {
            return;
          }
        }
      } catch (err) {
        console.error("Lỗi polling trạng thái bulk upload:", err);
      }
      timer = setTimeout(pollStatus, 4000);
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
      fetchRegistry();
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

  return (
    <div className="space-y-5">
      {/* 1. Header Banner & Sub-Tabs */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 p-5 rounded-2xl border border-emerald-800/40 shadow-xl text-white">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 border border-emerald-500/30">
              <RocketLaunch size={24} weight="bold" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                Lên Camp Sale KW
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Targeting & Scaling
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Tự động gom các Search Term tiềm năng (Orders &gt; 2) của cùng một Campaign và lên Campaign mới tên là{" "}
                <span className="text-emerald-300 font-semibold">[Tên Camp cũ] (Sale KW)</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Sub-Tab Buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-800/80 rounded-xl border border-slate-700/60 self-start md:self-auto">
          <button
            onClick={() => setSubTab("candidates")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              subTab === "candidates"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-700/50"
            }`}
          >
            <Lightning size={16} weight="bold" />
            Tìm & Lên Camp
            {stats.totalTerms > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-900/80 text-emerald-200 border border-emerald-700/50">
                {stats.totalTerms}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubTab("registry")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              subTab === "registry"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-700/50"
            }`}
          >
            <ShieldCheck size={16} weight="bold" />
            Quản trị Camp Sale KW
            {registrySummary.totalKeywords > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-700 text-slate-200">
                {registrySummary.totalKeywords}
              </span>
            )}
          </button>
        </div>
      </div>

      {subTab === "candidates" ? (
        <>
          {/* 2. Stat Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-semibold">ST Tiềm năng</span>
                <Target size={16} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{stats.totalTerms.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Orders {orderOperator} {orderThreshold}</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-semibold">Số Camp sẽ lên</span>
                <RocketLaunch size={16} className="text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{stats.totalCamps.toLocaleString()}</div>
              <div className="text-[11px] text-indigo-600 font-medium mt-0.5">Camp mới (Sale KW)</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-semibold">Tổng Orders</span>
                <ShoppingBag size={16} className="text-amber-600" />
              </div>
              <div className="text-2xl font-black text-emerald-600">{stats.totalOrders.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Lịch sử tạo đơn</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-semibold">Doanh thu ST</span>
                <CurrencyDollar size={16} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">
                ${stats.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">ACOS TB: {stats.avgAcos.toFixed(1)}%</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs col-span-2 md:col-span-1">
              <div className="flex items-center justify-between text-slate-500 mb-1">
                <span className="text-xs font-semibold">CPC Trung Bình</span>
                <TrendUp size={16} className="text-blue-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">${stats.avgCpc.toFixed(2)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Gợi ý Bid khởi tạo</div>
            </div>
          </div>

          {/* 3. Filter Toolbar & Campaign Config Settings */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3.5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Order Threshold & Operator */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Funnel size={14} className="text-slate-500" /> Lọc Orders:
                </span>
                <div className="flex items-center rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs font-medium">
                  <button
                    onClick={() => setOrderOperator(">")}
                    className={`px-2 py-1 rounded cursor-pointer font-bold ${
                      orderOperator === ">" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    &gt;
                  </button>
                  <button
                    onClick={() => setOrderOperator(">=")}
                    className={`px-2 py-1 rounded cursor-pointer font-bold ${
                      orderOperator === ">=" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    &ge;
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={orderThreshold}
                  onChange={(e) => setOrderThreshold(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 px-2.5 py-1 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  title="Ngưỡng đơn hàng tối thiểu để gom lên Camp mới"
                />

                {/* Hide already launched toggle */}
                <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideLaunched}
                    onChange={(e) => setHideLaunched(e.target.checked)}
                    className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span>Ẩn ST đã lên Camp</span>
                  {alreadyLaunchedCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-bold">
                      {alreadyLaunchedCount}
                    </span>
                  )}
                </label>
              </div>

              {/* Campaign Creation Settings (Daily Budget, Bid, Negate In Source) */}
              <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-700">Ngân sách/ngày:</span>
                  <div className="flex items-center">
                    <span className="text-slate-400 mr-1">$</span>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={dailyBudget}
                      onChange={(e) => setDailyBudget(Math.max(1, Number(e.target.value) || 10))}
                      className="w-16 px-1.5 py-0.5 font-bold text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-700">Bid khởi tạo:</span>
                  <select
                    value={bidMode}
                    onChange={(e) => setBidMode(e.target.value as any)}
                    className="px-2 py-0.5 font-medium text-slate-800 bg-white border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
                  >
                    <option value="cpc">Theo CPC lịch sử</option>
                    <option value="fixed">Cố định ${defaultBid.toFixed(2)}</option>
                  </select>
                  {bidMode === "fixed" && (
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      value={defaultBid}
                      onChange={(e) => setDefaultBid(Math.max(0.1, Number(e.target.value) || 1.0))}
                      className="w-14 px-1.5 py-0.5 font-bold text-slate-900 bg-white border border-slate-300 rounded focus:outline-none focus:border-emerald-500"
                    />
                  )}
                </div>

                <label className="flex items-center gap-1.5 text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={negateInSource}
                    onChange={(e) => setNegateInSource(e.target.checked)}
                    className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <span title="Phủ định Negative Exact trong Campaign cũ để tránh cạnh tranh và gom traffic sạch vào Camp mới">
                    Phủ định Exact ở Camp cũ
                  </span>
                </label>
              </div>
            </div>

            {/* Search and Campaign Dropdown */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="flex flex-1 items-center gap-2.5 w-full">
                <div className="relative flex-1 max-w-md">
                  <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Tìm kiếm theo Search Term, Campaign hoặc SKU..."
                    className="w-full pl-9 pr-8 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Campaign Filter Dropdown */}
                {candidateCampaigns.length > 1 && (
                  <select
                    value={campaignFilter}
                    onChange={(e) => {
                      setCampaignFilter(e.target.value);
                      setPage(1);
                    }}
                    className="max-w-xs px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ALL">Tất cả Campaigns ({candidateCampaigns.length})</option>
                    {candidateCampaigns.map((camp) => (
                      <option key={camp} value={camp}>
                        {camp}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Action Buttons: Export Bulksheet & Auto Upload */}
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={handleExportBulksheet}
                  disabled={isExporting || targetItems.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 transition cursor-pointer disabled:opacity-50"
                  title="Tải file Excel Bulksheet để nạp thủ công lên Amazon Ads"
                >
                  {isExporting ? <CircleNotch size={14} className="animate-spin" /> : <FileXls size={15} className="text-emerald-700" />}
                  Xuất Bulksheet (.xlsx)
                </button>

                <button
                  onClick={handleOpenAutoUploadModal}
                  disabled={targetItems.length === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition cursor-pointer disabled:opacity-50"
                  title="Xếp hàng tự động nạp qua AdsPower / Mac mini lên Amazon"
                >
                  <CloudArrowUp size={16} weight="bold" />
                  Auto Upload (Mac mini)
                  {targetItems.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-800 text-emerald-200">
                      {targetItems.length}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 4. Campaign Groups List */}
          {loading ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
              <CircleNotch size={32} className="animate-spin mx-auto text-emerald-600 mb-2" />
              <p className="text-sm font-semibold">Đang tải và tính toán Search Terms...</p>
            </div>
          ) : campaignGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 space-y-2">
              <CheckCircle size={40} className="mx-auto text-emerald-500" />
              <h3 className="text-base font-bold text-slate-800">Không có Search Term nào thỏa mãn điều kiện</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Không tìm thấy Search Term có số Orders {orderOperator} {orderThreshold}. Hãy thử giảm ngưỡng Orders hoặc chọn khoảng ngày dài hơn.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select All Bar */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-600">
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
                    <strong className="text-slate-900">{campaignGroups.length}</strong> Campaigns
                  </span>
                </label>
                {selectedKeys.size > 0 && (
                  <span className="text-emerald-700 font-bold">
                    Đã chọn {selectedKeys.size} từ khóa
                  </span>
                )}
              </div>

              {/* Group Cards */}
              {paginatedGroups.map((group) => {
                const isCollapsed = collapsedCampaigns.has(group.campaignName);
                const isGroupFullySelected = group.items.every((it) => selectedKeys.has(it.key));
                const isGroupPartiallySelected =
                  !isGroupFullySelected && group.items.some((it) => selectedKeys.has(it.key));

                return (
                  <div
                    key={group.campaignName}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-all"
                  >
                    {/* Campaign Group Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/80 border-b border-slate-200 gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isGroupFullySelected}
                          ref={(el) => {
                            if (el) el.indeterminate = isGroupPartiallySelected;
                          }}
                          onChange={(e) => handleSelectCampaign(group.campaignName, e.target.checked)}
                          className="w-4 h-4 mt-1 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                              Nguồn:
                            </span>
                            <span className="text-xs font-bold text-slate-800 truncate max-w-md" title={group.campaignName}>
                              {group.campaignName}
                            </span>
                            {group.sku && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                                <Tag size={12} /> {group.sku}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                              <RocketLaunch size={13} weight="bold" /> Sẽ lên:
                            </span>
                            <span className="text-xs font-extrabold text-emerald-900 truncate max-w-lg">
                              {group.targetCampaignName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Campaign Summary Metrics & Collapse Toggle */}
                      <div className="flex items-center gap-4 self-end sm:self-auto">
                        <div className="flex items-center gap-3 text-xs">
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">ST Tiềm năng</div>
                            <div className="font-extrabold text-slate-900">{group.items.length} terms</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Orders / Sales</div>
                            <div className="font-extrabold text-emerald-700">
                              {group.totalOrders} / ${group.totalSales.toFixed(2)}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => toggleCampaignCollapse(group.campaignName)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition"
                          title={isCollapsed ? "Mở rộng danh sách từ khóa" : "Thu gọn"}
                        >
                          {isCollapsed ? <CaretDown size={18} /> : <CaretUp size={18} />}
                        </button>
                      </div>
                    </div>

                    {/* Terms Table inside Campaign */}
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100/50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-4 w-10"></th>
                              <th className="py-2.5 px-3 font-bold">Search Term</th>
                              <th className="py-2.5 px-3">Loại Target</th>
                              <th className="py-2.5 px-3 text-right">Orders</th>
                              <th className="py-2.5 px-3 text-right">Sales</th>
                              <th className="py-2.5 px-3 text-right">Clicks</th>
                              <th className="py-2.5 px-3 text-right">Spend</th>
                              <th className="py-2.5 px-3 text-right">CPC</th>
                              <th className="py-2.5 px-3 text-right">ACOS</th>
                              <th className="py-2.5 px-3 text-center">Bid Mục tiêu</th>
                              <th className="py-2.5 px-3 text-center">Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                            {group.items.map((item) => {
                              const isChecked = selectedKeys.has(item.key);
                              const isProd =
                                item.customerSearchTerm.toLowerCase().startsWith("b0") ||
                                item.customerSearchTerm.toLowerCase().startsWith("asin=") ||
                                item.customerSearchTerm.toLowerCase().startsWith("category=");

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
                                      checked={isChecked}
                                      onChange={() => handleToggleKey(item.key)}
                                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
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
                                  <td className="py-2.5 px-3">
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        isProd
                                          ? "bg-purple-100 text-purple-800"
                                          : "bg-emerald-100 text-emerald-800"
                                      }`}
                                    >
                                      {isProd ? "Product Targeting" : "Exact"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600">
                                    {item.orders}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                                    ${item.sales.toFixed(2)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right">{item.clicks}</td>
                                  <td className="py-2.5 px-3 text-right text-slate-600">
                                    ${item.spend.toFixed(2)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-600">
                                    ${item.cpc.toFixed(2)}
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
                                    <span className="font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                      ${item.bid.toFixed(2)}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {item.isAlreadyLaunched ? (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                                        Đã lên Camp
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
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
                <PpcPagination
                  currentPage={page}
                  totalPages={totalGroupPages}
                  totalItems={campaignGroups.length}
                  pageSize={pageSize}
                  pageSizeOptions={[10, 20, 50]}
                  itemName="chiến dịch"
                  onPageChange={setPage}
                  onPageSizeChange={(sz) => {
                    setPageSize(sz);
                    setPage(1);
                  }}
                />
              )}
            </div>
          )}
        </>
      ) : (
        /* 5. Sub-Tab 2: Quản trị Camp Sale KW (Registry) */
        <div className="space-y-4">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-semibold text-slate-500 mb-1">Camp Đã Lên</div>
              <div className="text-2xl font-black text-slate-900">
                {registrySummary.totalCampaigns.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Camp Sale KW</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-semibold text-slate-500 mb-1">Từ Khóa Đã Lên</div>
              <div className="text-2xl font-black text-emerald-600">
                {registrySummary.totalKeywords.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Được gom vào các camp mới</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-semibold text-slate-500 mb-1">Tổng Orders Gom</div>
              <div className="text-2xl font-black text-slate-900">
                {registrySummary.totalOrders.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Thời điểm thu hoạch</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="text-xs font-semibold text-slate-500 mb-1">Doanh Thu Gom</div>
              <div className="text-2xl font-black text-slate-900">
                ${registrySummary.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Chi tiêu: ${registrySummary.totalSpend.toFixed(2)}</div>
            </div>
          </div>

          {/* Registry Toolbar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <div className="relative flex-1 max-w-md w-full">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={regSearchQuery}
                onChange={(e) => {
                  setRegSearchQuery(e.target.value);
                  setRegPage(1);
                }}
                placeholder="Tìm trong danh mục Sale KW đã tạo..."
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
                      <td colSpan={10} className="py-12 text-center text-slate-500">
                        <CircleNotch size={24} className="animate-spin mx-auto text-emerald-600 mb-2" />
                        Đang tải danh mục...
                      </td>
                    </tr>
                  ) : paginatedRegItems.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-500">
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

      {/* 6. Auto Upload Confirmation & Execution Modal */}
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
                    <span className="text-emerald-700 font-extrabold text-sm">{targetItems.length}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Số Chiến Dịch mới sẽ tạo:</span>
                    <span className="font-bold text-slate-900">{campaignGroups.length}</span>
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
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle size={28} weight="bold" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-base">Đã Xếp Hàng Auto Upload Thành Công!</h4>
                  <p className="text-xs text-slate-500">{autoUploadSuccessResult.message}</p>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Mã Job:</span>
                    <span className="font-mono text-slate-800 font-bold">{autoUploadSuccessResult.jobId.slice(0, 13)}...</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Tên File:</span>
                    <span className="font-medium text-slate-800 truncate max-w-xs">{autoUploadSuccessResult.fileName}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Số Camp / Search Terms:</span>
                    <span className="font-bold text-emerald-700">
                      {autoUploadSuccessResult.campaignCount} Camp / {autoUploadSuccessResult.actionCount} Terms
                    </span>
                  </div>
                  {liveUploadStatus && (
                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex justify-between text-slate-600 mb-1">
                        <span>Tiến độ Worker Mac mini:</span>
                        <span className="font-bold text-indigo-700">{liveUploadStatus.stage || liveUploadStatus.status}</span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-600 h-full transition-all duration-500"
                          style={{ width: `${liveUploadStatus.progressPct || 35}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setIsAutoUploadModalOpen(false);
                      setSubTab("registry");
                    }}
                    className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition cursor-pointer"
                  >
                    Xem trong Quản trị Camp Sale KW
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
