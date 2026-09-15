"use client";

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
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
  ListDashes,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type {
  PpcAlert,
  PpcAdTypeBreakdown,
  PpcCampaignPerformance,
  PpcAdGroupPerformance,
  PpcDataHealth,
  PpcMatchTypeBreakdown,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSkuPerformance,
  PpcStore,
  PpcSummaryMetrics,
  PpcTargetPerformance,
  PpcVelocityComparison,
} from "@/lib/ppc/types";

interface PpcDashboardProps {
  isEmbedded?: boolean;
}

type SortField = "spend" | "sales" | "orders" | "clicks" | "impressions" | "ctr" | "acos" | "cvr" | "roas";
type SortDirection = "asc" | "desc";

const MATCH_TYPE_COLORS: Record<string, string> = {
  Exact: "#4f46e5", // Indigo
  Phrase: "#0284c7", // Sky
  Broad: "#059669", // Emerald
  Auto: "#d97706", // Amber
  Targeting: "#7c3aed", // Violet
};

const subscribeToHydration = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function searchTermKey(term: PpcSearchTermRow): string {
  return [
    term.id, term.storeName, term.adType, term.reportDate, term.portfolioName, term.campaignName,
    term.adGroupName, term.targetKeyword, term.customerSearchTerm, term.matchType,
  ].filter(Boolean).join("\u0000");
}

export function PpcDashboard({ isEmbedded = false }: PpcDashboardProps) {
  const mounted = useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot);

  const [stores, setStores] = useState<PpcStore[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>("ALL");
  const [selectedSku, setSelectedSku] = useState<string>("ALL");
  const [selectedDays, setSelectedDays] = useState(30);
  const [availableSkus, setAvailableSkus] = useState<string[]>([]);

  const [summary, setSummary] = useState<PpcSummaryMetrics | null>(null);
  const [velocity, setVelocity] = useState<PpcVelocityComparison | null>(null);
  const [skuPerformance, setSkuPerformance] = useState<PpcSkuPerformance[]>([]);
  const [campaignPerformance, setCampaignPerformance] = useState<PpcCampaignPerformance[]>([]);
  const [adGroupPerformance, setAdGroupPerformance] = useState<PpcAdGroupPerformance[]>([]);
  const [targetPerformance, setTargetPerformance] = useState<PpcTargetPerformance[]>([]);
  const [adTypeBreakdown, setAdTypeBreakdown] = useState<PpcAdTypeBreakdown[]>([]);
  const [dataHealth, setDataHealth] = useState<PpcDataHealth | null>(null);
  const [matchTypeBreakdown, setMatchTypeBreakdown] = useState<PpcMatchTypeBreakdown[]>([]);
  const [searchTerms, setSearchTerms] = useState<PpcSearchTermRow[]>([]);
  const [alerts, setAlerts] = useState<PpcAlert[]>([]);
  const [recommendations, setRecommendations] = useState<PpcRecommendation[]>([]);
  const [targetAcos, setTargetAcos] = useState(30);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Drill-down hierarchy state: Campaign -> Ad Group -> Target/Keyword -> Search Terms
  const [selectedCampaignForDrilldown, setSelectedCampaignForDrilldown] = useState<string | null>(null);
  const [selectedAdGroupForDrilldown, setSelectedAdGroupForDrilldown] = useState<string | null>(null);
  const [expandedTargetKey, setExpandedTargetKey] = useState<string | null>(null);

  // Navigation tab for data slicing (Hierarchy: Overview -> Campaigns -> Ad Groups -> Targets -> Search Terms | SKU parallel view)
  const [activeTab, setActiveTab] = useState<
    "overview" | "campaigns" | "ad_groups" | "targets" | "skus" | "match_types" | "search_terms" | "alerts" | "recommendations"
  >("overview");

  // Filters & sorting for Search Terms
  const [searchTermQuery, setSearchTermQuery] = useState("");
  const [matchTypeFilter, setMatchTypeFilter] = useState("ALL");
  const [termPerformanceFilter, setTermPerformanceFilter] = useState<
    "ALL" | "WITH_ORDERS" | "ZERO_ORDERS_BLEEDING" | "HIGH_ACOS"
  >("ALL");
  const [termSortField, setTermSortField] = useState<SortField>("spend");
  const [termSortDir, setTermSortDir] = useState<SortDirection>("desc");
  const [termPage, setTermPage] = useState(1);
  const [termPageSize, setTermPageSize] = useState(15);
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());

  // SKU category filter
  const [skuCategoryFilter, setSkuCategoryFilter] = useState<"ALL" | "HERO" | "BLEEDING" | "POTENTIAL" | "ZERO_CLICKS">("ALL");
  const [hidePausedSkus, setHidePausedSkus] = useState(true);

  // Action Center recommendation filters & export
  const [recPriorityFilter, setRecPriorityFilter] = useState<"ALL" | "P0" | "P1" | "P2">("ALL");
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set());
  const [exportingBulksheet, setExportingBulksheet] = useState(false);

  // Campaign search & sort
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignSortField, setCampaignSortField] = useState<SortField>("spend");
  const [campaignSortDir, setCampaignSortDir] = useState<SortDirection>("desc");

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
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStore, setUploadStore] = useState("Warmstorey");
  const [uploadEndDate, setUploadEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Notification helper
  const notify = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ppc/metrics?storeName=${encodeURIComponent(selectedStore)}&sku=${encodeURIComponent(selectedSku)}&days=${selectedDays}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Không thể tải số liệu PPC");
      const data = await res.json();
      setStores(data.stores || []);
      setSummary(data.summary || null);
      setVelocity(data.velocity || null);
      setSkuPerformance(data.skuPerformance || []);
      setCampaignPerformance(data.campaignPerformance || []);
      setAdGroupPerformance(data.adGroups || []);
      setTargetPerformance(data.targets || []);
      setAdTypeBreakdown(data.adTypeBreakdown || []);
      setDataHealth(data.dataHealth || null);
      setMatchTypeBreakdown(data.matchTypeBreakdown || []);
      setSearchTerms(data.searchTerms || []);
      setAlerts(data.alerts || []);
      setRecommendations(data.recommendations || []);
      setAvailableSkus(data.availableSkus || []);
      setTargetAcos(data.targetAcos || 30);
      setLastSyncedAt(data.lastSyncedAt || null);
      setSelectedTerms(new Set());
      setSelectedRecs(new Set());
      setTermPage(1);
    } catch (err) {
      console.error(err);
      notify(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu từ máy chủ", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedStore, selectedSku, selectedDays]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const handleSyncR2 = async () => {
    setSyncingR2(true);
    try {
      const res = await fetch("/api/ppc/sync-r2", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đồng bộ Cloudflare R2");
      notify(
        data.message || "Đã đồng bộ báo cáo mới nhất từ Cloudflare R2!",
        data.result?.failed ? "error" : "success",
      );
      await loadData();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Đồng bộ R2 thất bại", "error");
    } finally {
      setSyncingR2(false);
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
      await loadData();
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
      const q = searchTermQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.customerSearchTerm.toLowerCase().includes(q) ||
          t.campaignName.toLowerCase().includes(q) ||
          t.portfolioName.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const valA = a[termSortField];
      const valB = b[termSortField];
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

  // Filtered & Sorted Campaigns
  const filteredSortedCampaigns = useMemo(() => {
    let list = [...campaignPerformance];
    if (campaignQuery.trim()) {
      const q = campaignQuery.toLowerCase();
      list = list.filter(
        (c) => c.campaignName.toLowerCase().includes(q) || c.storeName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const valA = a[campaignSortField];
      const valB = b[campaignSortField];
      return campaignSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [campaignPerformance, campaignQuery, campaignSortField, campaignSortDir]);

  // Filtered & Sorted Ad Groups (Level 3 in hierarchy)
  const filteredSortedAdGroups = useMemo(() => {
    let list = [...adGroupPerformance];
    if (selectedCampaignForDrilldown) {
      list = list.filter((ag) => ag.campaignName === selectedCampaignForDrilldown);
    }
    if (adGroupQuery.trim()) {
      const q = adGroupQuery.toLowerCase();
      list = list.filter(
        (ag) => ag.adGroupName.toLowerCase().includes(q) || ag.campaignName.toLowerCase().includes(q) || ag.storeName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const valA = a[adGroupSortField];
      const valB = b[adGroupSortField];
      return adGroupSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [adGroupPerformance, selectedCampaignForDrilldown, adGroupQuery, adGroupSortField, adGroupSortDir]);

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
      const q = targetQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.targetKeyword.toLowerCase().includes(q) ||
          t.campaignName.toLowerCase().includes(q) ||
          t.adGroupName.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const valA = a[targetSortField];
      const valB = b[targetSortField];
      return targetSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [targetPerformance, selectedCampaignForDrilldown, selectedAdGroupForDrilldown, targetQuery, targetSortField, targetSortDir]);

  // Child Search Terms Lookup for each Target Keyword
  const getChildSearchTerms = useCallback((target: PpcTargetPerformance) => {
    const norm = (s: string) => (s || "").trim().toLowerCase();
    const targetKwNorm = norm(target.targetKeyword);
    const campNorm = norm(target.campaignName);
    const agNorm = norm(target.adGroupName);

    return searchTerms.filter((term) => {
      const termKw = norm(term.targetKeyword);
      const termCamp = norm(term.campaignName);
      const termAg = norm(term.adGroupName);

      const matchKw = termKw === targetKwNorm || (targetKwNorm && term.customerSearchTerm.toLowerCase().includes(targetKwNorm));
      const matchCamp = !campNorm || termCamp === campNorm;
      const matchAg = !agNorm || termAg === agNorm;

      return matchKw && matchCamp && matchAg;
    });
  }, [searchTerms]);

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
      } else {
        list = list.filter((s) => s.skuCategory === skuCategoryFilter);
      }
    }
    if (skuQuery.trim()) {
      const q = skuQuery.toLowerCase();
      list = list.filter((s) => s.sku.toLowerCase().includes(q) || s.storeName.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const valA = a[skuSortField];
      const valB = b[skuSortField];
      return skuSortDir === "asc" ? valA - valB : valB - valA;
    });
    return list;
  }, [activeSkuPerformance, skuCategoryFilter, skuQuery, skuSortField, skuSortDir]);

  // Filtered Recommendations by Priority
  const filteredRecommendations = useMemo(() => {
    let list = [...recommendations];
    if (recPriorityFilter !== "ALL") {
      list = list.filter((r) => r.priority === recPriorityFilter);
    }
    return list;
  }, [recommendations, recPriorityFilter]);

  // Export Bulksheet update file
  const handleExportBulksheet = async (recsToExport?: PpcRecommendation[]) => {
    const list = recsToExport || recommendations.filter((r) => selectedRecs.has(r.id));
    const targetList = list.length > 0 ? list : recommendations;
    if (targetList.length === 0) {
      notify("Không có đề xuất nào để xuất Bulksheet.", "error");
      return;
    }
    setExportingBulksheet(true);
    try {
      const res = await fetch("/api/ppc/export-bulksheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: targetList }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Xuất file thất bại");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Amazon_Bulksheet_Update_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      notify(`Đã xuất thành công ${targetList.length} đề xuất sang file Bulksheet Amazon!`, "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xuất file", "error");
    } finally {
      setExportingBulksheet(false);
    }
  };

  const copyKeyword = async (kw: string) => {
    try {
      await navigator.clipboard.writeText(kw);
      notify(`Đã copy "${kw}" vào clipboard!`, "success");
    } catch {
      notify("Trình duyệt không cho phép ghi vào clipboard.", "error");
    }
  };

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
    // Fallback from searchTerms when Bulk is not yet ingested
    const map = new Map<string, { spend: number; sales: number }>();
    for (const st of searchTerms) {
      const name = st.campaignName || "Unknown Campaign";
      const cur = map.get(name) || { spend: 0, sales: 0 };
      cur.spend += st.spend;
      cur.sales += st.sales;
      map.set(name, cur);
    }
    return Array.from(map.entries())
      .map(([name, val]) => ({
        name: name.length > 20 ? `${name.slice(0, 18)}...` : name,
        spend: Math.round(val.spend * 100) / 100,
        sales: Math.round(val.sales * 100) / 100,
        acos: val.sales > 0 ? Math.round((val.spend / val.sales) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 7);
  }, [campaignPerformance, searchTerms]);

  // Chart Data: Match Type Spend & Sales Share
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
    // Fallback from searchTerms when Bulk is not yet ingested
    const map = new Map<string, { spend: number; sales: number }>();
    let totalSpend = 0;
    for (const st of searchTerms) {
      const mt = st.matchType ? st.matchType.toUpperCase() : "UNKNOWN";
      const key = mt.includes("EXACT") ? "Exact" : mt.includes("PHRASE") ? "Phrase" : mt.includes("BROAD") ? "Broad" : "Other";
      const cur = map.get(key) || { spend: 0, sales: 0 };
      cur.spend += st.spend;
      cur.sales += st.sales;
      totalSpend += st.spend;
      map.set(key, cur);
    }
    return Array.from(map.entries()).map(([name, val]) => ({
      name,
      value: Math.round(val.spend * 100) / 100,
      sales: Math.round(val.sales * 100) / 100,
      spendShare: totalSpend > 0 ? Math.round((val.spend / totalSpend) * 1000) / 10 : 0,
      color: MATCH_TYPE_COLORS[name] || "#94a3b8",
    }));
  }, [matchTypeBreakdown, searchTerms]);

  // Sort Handler Helper
  const handleSort = (
    field: SortField,
    currentField: SortField,
    currentDir: SortDirection,
    setField: (f: SortField) => void,
    setDir: (d: SortDirection) => void
  ) => {
    if (currentField === field) {
      setDir(currentDir === "asc" ? "desc" : "asc");
    } else {
      setField(field);
      setDir("desc");
    }
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
  const handleExportCsv = (type: "search_terms" | "campaigns" | "skus") => {
    let header = "";
    let rows: string[] = [];
    let filename = "";

    if (type === "search_terms") {
      header = "Customer Search Term,Match Type,SKU / Portfolio,Campaign,Clicks,Spend ($),Sales ($),Orders,CTR (%),CVR (%),ACOS (%)\n";
      rows = filteredSortedSearchTerms.map((t) => {
        const termSafe = `"${t.customerSearchTerm.replace(/"/g, '""')}"`;
        const portSafe = `"${t.portfolioName.replace(/"/g, '""')}"`;
        const campSafe = `"${t.campaignName.replace(/"/g, '""')}"`;
        return `${termSafe},"${t.matchType}",${portSafe},${campSafe},${t.clicks},${t.spend.toFixed(2)},${t.sales.toFixed(2)},${t.orders},${(t.ctr * 100).toFixed(2)},${(t.cvr * 100).toFixed(1)},${t.acos.toFixed(1)}`;
      });
      filename = `ppc-search-terms-${Date.now()}.csv`;
    } else if (type === "campaigns") {
      header = "Campaign Name,Store,Targeting,Spend ($),Sales ($),Orders,Clicks,CPC ($),CTR (%),CVR (%),ACOS (%),ROAS\n";
      rows = filteredSortedCampaigns.map((c) => {
        const campSafe = `"${c.campaignName.replace(/"/g, '""')}"`;
        return `${campSafe},"${c.storeName}","${c.targetingType}",${c.spend.toFixed(2)},${c.sales.toFixed(2)},${c.orders},${c.clicks},${c.cpc.toFixed(2)},${c.ctr.toFixed(2)},${c.cvr.toFixed(1)},${c.acos.toFixed(1)},${c.roas.toFixed(2)}`;
      });
      filename = `ppc-campaigns-${Date.now()}.csv`;
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
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Multi-Store Live
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Hiệu suất từ Bulk theo Campaign, Target, SKU; truy vấn khách hàng từ Search Term Report
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 self-stretch lg:self-auto justify-end">
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

            <a
              href={`/api/ppc/seed?storeName=${encodeURIComponent(selectedStore !== "ALL" ? selectedStore : "Bozspacer")}`}
              download
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition cursor-pointer"
              title="Tải template Excel chuẩn"
            >
              <Download size={14} weight="bold" />
              <span>Template</span>
            </a>
          </div>
        </div>

        {/* Filters: Store & SKU */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Store Filter */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <Storefront size={15} className="text-indigo-600" weight="duotone" />
              <span className="text-slate-500 font-semibold text-[11px]">Store:</span>
              <select
                value={selectedStore}
                onChange={(e) => {
                  setSelectedStore(e.target.value);
                  setSelectedSku("ALL");
                }}
                className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs"
              >
                <option value="ALL">All Stores ({stores.length})</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name} ({s.marketplace}) - Target {s.targetAcos}%
                  </option>
                ))}
              </select>
            </div>

            {/* SKU Filter */}
            {availableSkus.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
                <Tag size={15} className="text-emerald-600" weight="duotone" />
                <span className="text-slate-500 font-semibold text-[11px]">SKU:</span>
                <select
                  value={selectedSku}
                  onChange={(e) => setSelectedSku(e.target.value)}
                  className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs max-w-[200px] truncate"
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
              <span className="text-slate-500 font-semibold text-[11px]">Date Range:</span>
              <select
                value={selectedDays}
                onChange={(event) => setSelectedDays(Number(event.target.value))}
                className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs"
              >
                <option value={7}>Last 7 Days</option>
                <option value={14}>Last 14 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={60}>Last 60 Days</option>
                <option value={90}>Last 90 Days</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] font-medium text-slate-400 text-right">
            <div>Attribution: <strong className="text-slate-600">theo cột trong báo cáo</strong></div>
            <div>{loading ? "Đang tải dữ liệu…" : lastSyncedAt ? `Cập nhật: ${new Date(lastSyncedAt).toLocaleString("vi-VN")}` : "Chưa có lần đồng bộ"}</div>
          </div>
        </div>
      </div>

      {!loading && dataHealth && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-1 font-extrabold ${dataHealth.campaignRows > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                Performance: {dataHealth.campaignRows > 0 ? `Bulk · ${dataHealth.campaignRows} campaigns` : "Chưa có campaign grain"}
              </span>
              <span className={`rounded px-2 py-1 font-extrabold ${dataHealth.searchTermRows > 0 ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                Search Terms: {dataHealth.searchTermRows.toLocaleString()} rows
              </span>
              <span className="rounded bg-indigo-50 px-2 py-1 font-extrabold text-indigo-700">
                Targets: {dataHealth.targetRows.toLocaleString()}
              </span>
              {adTypeBreakdown.map((item) => (
                <span key={item.adType} className="rounded bg-slate-100 px-2 py-1 font-bold text-slate-700">
                  {item.adType}: ${item.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ACOS {item.acos > 500 ? "0 sales" : `${item.acos.toFixed(1)}%`}
                </span>
              ))}
            </div>
            <span className="font-semibold text-slate-400">Không cộng chéo entity grain</span>
          </div>
          {dataHealth.warnings.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] font-medium text-amber-800">
              {dataHealth.warnings.join(" · ")}
            </div>
          )}
        </div>
      )}

      {!loading && searchTerms.length === 0 && (!dataHealth || dataHealth.performanceRows === 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Chưa có dữ liệu PPC trong {selectedDays} ngày gần nhất.</strong>{" "}
          Hãy nạp Bulk SP/SB và Search Term SP/SB hoặc đồng bộ từ R2. Hệ thống không tự chèn dữ liệu mẫu.
        </div>
      )}

      {/* EXECUTIVE KPI CARDS */}
      {summary && ((dataHealth?.campaignRows || 0) > 0 || searchTerms.length > 0) && (
        <div className="space-y-3">
          {(dataHealth?.campaignRows || 0) === 0 && searchTerms.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-sky-50 border border-sky-200 px-4 py-2.5 text-xs text-sky-900 font-medium">
              <span className="flex h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              <span>
                Các chỉ số KPI và biểu đồ bên dưới đang được tổng hợp trực tiếp từ <strong>Search Term Report ({searchTerms.length.toLocaleString()} truy vấn)</strong> do hệ thống chưa có dữ liệu Bulk Operations. Khi nạp file Bulk, bạn sẽ mở khóa thêm phân tích cấp Chiến Dịch, Nhóm QC, Target và Placement.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {/* SPEND */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              SPEND
            </span>
            <div className="text-xl font-black text-slate-900 mt-0.5">
              ${summary.totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              CPC: <strong className="text-slate-800">${summary.avgCpc.toFixed(2)}</strong>
            </div>
          </div>

          {/* SALES */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              SALES
            </span>
            <div className="text-xl font-black text-emerald-600 mt-0.5">
              ${summary.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Orders: <strong className="text-slate-800">{summary.totalOrders}</strong> ({summary.totalUnits} units)
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

          {/* ROAS */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              ROAS
            </span>
            <div className="text-xl font-black text-sky-600 mt-0.5">
              {summary.blendedRoas.toFixed(2)}x
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Target: <strong className="text-slate-800">{(100 / Math.max(targetAcos, 1)).toFixed(2)}x</strong>
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
              CTR: <strong className="text-slate-800">{(summary.overallCtr * 100).toFixed(2)}%</strong>
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
              CPC: <strong className="text-slate-800">${summary.avgCpc.toFixed(2)}</strong>
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
              Orders: <strong className="text-slate-800">{summary.totalOrders}</strong>
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

      {/* VISUAL CHARTS ROW (Using Recharts) */}
      {mounted && summary && ((dataHealth?.campaignRows || 0) > 0 || searchTerms.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Chart 1: Top Campaigns Spend vs Sales */}
          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Chi Tiêu &amp; Doanh Số Theo Chiến Dịch Hàng Đầu
              </h3>
              <span className="text-[11px] text-slate-400 font-semibold">Top {topCampaignChartData.length} Campaigns</span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCampaignChartData} margin={{ top: 10, right: 10, left: -10, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    angle={-15}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === "Chi Tiêu") return [`$${Number(value).toFixed(2)}`, name];
                      if (name === "Doanh Số") return [`$${Number(value).toFixed(2)}`, name];
                      return [value, name];
                    }}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      borderRadius: "10px",
                      borderColor: "#e2e8f0",
                      fontSize: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "5px" }} />
                  <Bar dataKey="spend" name="Spend" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={30} />
                  <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Match Type Spend Distribution */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Tỷ Trọng Chi Tiêu Theo Match Type
              </h3>
              <ChartPieSlice size={16} className="text-indigo-600" />
            </div>

            <div className="h-44 w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={matchTypePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {matchTypePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`$${Number(value).toFixed(2)}`, "Chi Tiêu"]}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      borderRadius: "8px",
                      borderColor: "#e2e8f0",
                      fontSize: "11px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] font-bold text-slate-400">TOTAL SPEND</span>
                <span className="text-xs font-black text-slate-800">${summary.totalSpend.toFixed(0)}</span>
              </div>
            </div>

            {/* Concise Legend */}
            <div className="mt-auto grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              {matchTypeBreakdown.map((m) => (
                <div key={m.matchType} className="flex items-center justify-between p-1.5 rounded-lg bg-slate-50">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: MATCH_TYPE_COLORS[m.matchType] || "#94a3b8" }}
                    />
                    <span className="font-bold text-slate-700">{m.matchType}</span>
                  </div>
                  <span className="font-mono font-extrabold text-slate-900">{m.spendShare}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DATA SLICING SUB-TABS (Bóc tách dữ liệu theo kiến trúc 5 tầng + SKU song song) */}
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
          <span>2. Chiến Dịch ({campaignPerformance.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ad_groups")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "ad_groups"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <ListDashes size={15} weight={activeTab === "ad_groups" ? "bold" : "regular"} />
          <span>3. Nhóm QC ({filteredSortedAdGroups.length})</span>
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
          <span>4. Target / Keyword ({filteredSortedTargets.length})</span>
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
          <span>5. Search Terms ({searchTerms.length})</span>
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
          <span>Sản Phẩm (SKU / ASIN)</span>
          <span className="text-[9px] px-1 py-0.2 bg-indigo-50 text-indigo-600 rounded font-bold border border-indigo-100">Dimension riêng</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("match_types")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "match_types"
            ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <ChartPieSlice size={15} weight={activeTab === "match_types" ? "bold" : "regular"} />
          <span>Loại Khớp ({matchTypeBreakdown.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("alerts")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "alerts"
            ? "bg-white text-rose-700 shadow-xs border border-rose-100"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <span>Cảnh Báo ({alerts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("recommendations")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${activeTab === "recommendations"
            ? "bg-white text-emerald-700 shadow-xs border border-emerald-100"
            : "text-slate-600 hover:text-slate-900"
            }`}
        >
          <span>Đề Xuất ({recommendations.length})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: OVERVIEW SUMMARY TABLE */}
      {/* ========================================================================= */}
      {activeTab === "overview" && (
        <div className="space-y-3">
          {/* Quick High-Impact Table: Top Converting vs Bleeding Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top 5 Best Performers */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                <h4 className="text-xs font-black uppercase text-emerald-800 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Top Profitable Search Terms (ACOS &le; {targetAcos.toFixed(1)}%)
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
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="relative flex-1 sm:w-72">
              <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={campaignQuery}
                onChange={(e) => setCampaignQuery(e.target.value)}
                placeholder="Tìm tên chiến dịch..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>

            <button
              type="button"
              onClick={() => handleExportCsv("campaigns")}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer self-end sm:self-auto"
            >
              <Download size={14} /> Xuất CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">Campaign Name</th>
                  <th className="py-3 px-3">Store</th>
                  <th className="py-3 px-3">Ad / Targeting</th>
                  <th className="py-3 px-3">State / Budget</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Spend ($) {campaignSortField === "spend" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Sales ($) {campaignSortField === "sales" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Orders {campaignSortField === "orders" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">Clicks</th>
                  <th className="py-3 px-3 text-right">CPC</th>
                  <th className="py-3 px-3 text-right">CVR</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    ACOS (%) {campaignSortField === "acos" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">ROAS</th>
                  <th className="py-3 px-3 text-center">Nhóm QC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredSortedCampaigns.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <FolderSimple size={24} className="text-slate-300" />
                        <span className="font-semibold text-slate-600">Chưa có dữ liệu Chiến Dịch</span>
                        <span className="text-xs text-slate-400 max-w-md">
                          Dữ liệu Chiến Dịch được trích xuất từ báo cáo Bulk Operations. Vui lòng nhấn &quot;Nạp báo cáo PPC&quot; hoặc &quot;Đồng bộ R2&quot; để tải file Bulk.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSortedCampaigns.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 px-3.5 font-bold text-slate-900 max-w-xs truncate">
                      {c.campaignName}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-medium">{c.storeName}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                        {c.adType || "?"} · {c.targetingType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-500">
                      <div className="font-bold text-slate-700">{c.state || "—"}</div>
                      <div>{c.dailyBudget ? `$${c.dailyBudget.toFixed(2)}/day` : "No budget"}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">${c.spend.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-600">${c.sales.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">{c.orders}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{c.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">${c.cpc.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{c.cvr.toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right">
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
                    <td className="py-2.5 px-3 text-right font-bold text-sky-600">{c.roas.toFixed(2)}x</td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCampaignForDrilldown(c.campaignName);
                          setActiveTab("ad_groups");
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[11px] transition cursor-pointer border border-indigo-200"
                        title="Drill-down xem các Nhóm QC của chiến dịch này"
                      >
                        <span>Nhóm QC</span>
                        <span>→</span>
                      </button>
                    </td>
                  </tr>
                ))) }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: BREAKDOWN BY AD GROUP (Level 3 Hierarchy) */}
      {/* ========================================================================= */}
      {activeTab === "ad_groups" && (
        <div className="space-y-3">
          {/* Breadcrumb / Active drilldown banner */}
          {selectedCampaignForDrilldown && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50/90 border border-indigo-200 text-xs">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold">
                <span>📍 Đang lọc theo Chiến Dịch:</span>
                <span className="font-black text-indigo-950 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-2xs">
                  {selectedCampaignForDrilldown}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCampaignForDrilldown(null)}
                className="text-xs font-bold text-indigo-700 hover:text-indigo-950 underline cursor-pointer"
              >
                ✕ Xem tất cả Nhóm QC ({adGroupPerformance.length})
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="relative flex-1 sm:w-72">
              <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={adGroupQuery}
                onChange={(e) => setAdGroupQuery(e.target.value)}
                placeholder="Tìm tên nhóm quảng cáo..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
              />
            </div>
            <div className="text-xs font-bold text-slate-500">
              Hiển thị: <strong className="text-slate-900">{filteredSortedAdGroups.length}</strong> nhóm QC
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">Ad Group Name</th>
                  <th className="py-3 px-3">Campaign Name</th>
                  <th className="py-3 px-3">Store</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", adGroupSortField, adGroupSortDir, setAdGroupSortField, setAdGroupSortDir)
                    }
                  >
                    Spend ($) {adGroupSortField === "spend" && (adGroupSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", adGroupSortField, adGroupSortDir, setAdGroupSortField, setAdGroupSortDir)
                    }
                  >
                    Sales ($) {adGroupSortField === "sales" && (adGroupSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", adGroupSortField, adGroupSortDir, setAdGroupSortField, setAdGroupSortDir)
                    }
                  >
                    Orders {adGroupSortField === "orders" && (adGroupSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">Clicks</th>
                  <th className="py-3 px-3 text-right">CPC</th>
                  <th className="py-3 px-3 text-right">CVR</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("acos", adGroupSortField, adGroupSortDir, setAdGroupSortField, setAdGroupSortDir)
                    }
                  >
                    ACOS (%) {adGroupSortField === "acos" && (adGroupSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">ROAS</th>
                  <th className="py-3 px-3 text-center">Mục Tiêu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredSortedAdGroups.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center font-medium text-slate-400">
                      Không có nhóm quảng cáo nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredSortedAdGroups.map((ag, i) => (
                    <tr key={i} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 max-w-xs truncate">
                        {ag.adGroupName}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-600 max-w-xs truncate">{ag.campaignName}</td>
                      <td className="py-2.5 px-3 text-slate-500 font-medium">{ag.storeName}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">${ag.spend.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-black text-emerald-600">${ag.sales.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-black text-slate-900">{ag.orders}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{ag.clicks}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">${ag.cpc.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-700">{ag.cvr.toFixed(1)}%</td>
                      <td className="py-2.5 px-3 text-right">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                            ag.acos <= Math.min(20, targetAcos)
                              ? "bg-emerald-50 text-emerald-700"
                              : ag.acos <= targetAcos
                                ? "bg-teal-50 text-teal-700"
                                : ag.acos <= 50
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {ag.acos > 500 ? "0 sales" : `${ag.acos.toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-sky-600">{ag.roas.toFixed(2)}x</td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCampaignForDrilldown(ag.campaignName);
                            setSelectedAdGroupForDrilldown(ag.adGroupName);
                            setActiveTab("targets");
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[11px] transition cursor-pointer border border-indigo-200"
                          title="Drill-down xem các Targets của nhóm quảng cáo này"
                        >
                          <span>Xem Targets</span>
                          <span>→</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW: BREAKDOWN BY TARGET / KEYWORD (Level 4 Hierarchy + Search Term 2-Layer) */}
      {/* ========================================================================= */}
      {activeTab === "targets" && (
        <div className="space-y-3">
          {/* Active drilldown banner */}
          {(selectedCampaignForDrilldown || selectedAdGroupForDrilldown) && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-indigo-50/90 border border-indigo-200 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-indigo-900 font-semibold">
                <span>📍 Đang lọc theo:</span>
                {selectedCampaignForDrilldown && (
                  <span className="font-bold text-indigo-950 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
                    Chiến dịch: {selectedCampaignForDrilldown}
                  </span>
                )}
                {selectedAdGroupForDrilldown && (
                  <span className="font-bold text-indigo-950 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
                    Nhóm QC: {selectedAdGroupForDrilldown}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCampaignForDrilldown(null);
                  setSelectedAdGroupForDrilldown(null);
                }}
                className="text-xs font-bold text-indigo-700 hover:text-indigo-950 underline cursor-pointer"
              >
                ✕ Xem tất cả Targets ({targetPerformance.length})
              </button>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-black text-slate-900 flex items-center gap-2">
                  <span>Target Performance &amp; Search Term Intelligence</span>
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700 border border-indigo-200">
                    2 Lớp Dữ Liệu
                  </span>
                </h3>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                  Lớp 1 (Bulk Target Grain): Hiệu suất &amp; Bid thực thi. Lớp 2 (Search Term Breakdown): Nhấp vào từng Target để xem các truy vấn thực tế, Harvest candidate và Negative candidate.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder="Tìm keyword / target..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full min-w-[1100px] text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
                <tr>
                  <th className="px-3.5 py-3">Target / Keyword</th>
                  <th className="px-3 py-3">Campaign / Ad Group</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">State</th>
                  <th className="px-3 py-3 text-right">Bid</th>
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
                  <th className="px-3 py-3 text-right">ROAS</th>
                  <th className="px-3 py-3 text-center">Search Terms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSortedTargets.length === 0 ? (
                  <tr><td colSpan={13} className="p-8 text-center font-medium text-slate-400">Chưa có target grain cho kỳ đang chọn.</td></tr>
                ) : filteredSortedTargets.slice(0, 300).map((target) => {
                  const targetKey = `${target.storeName}-${target.adType}-${target.campaignName}-${target.adGroupName}-${target.targetKeyword}`;
                  const childTerms = getChildSearchTerms(target);
                  const isExpanded = expandedTargetKey === targetKey;

                  // Intelligence calculation for child queries
                  const harvestCandidates = childTerms.filter((t) => t.orders > 0 && t.acos <= targetAcos);
                  const bleederCandidates = childTerms.filter((t) => t.orders === 0 && (t.clicks >= 9 || t.spend >= 15));
                  const bleederSpend = bleederCandidates.reduce((sum, t) => sum + t.spend, 0);

                  return (
                    <tr key={targetKey} className="group">
                      <td colSpan={13} className="p-0">
                        {/* Primary Target Row */}
                        <div className={`grid grid-cols-[minmax(220px,1.5fr)_minmax(200px,1.2fr)_80px_70px_65px_75px_80px_60px_65px_65px_75px_65px_110px] items-center px-3.5 py-2.5 transition ${isExpanded ? "bg-indigo-50/40" : "hover:bg-slate-50/80"}`}>
                          <div className="font-bold text-slate-900 truncate pr-2">
                            <div className="truncate">{target.targetKeyword}</div>
                            <div className="text-[10px] font-medium text-slate-400">{target.targetId || "No target ID"}</div>
                          </div>
                          <div className="truncate pr-2">
                            <div className="truncate font-semibold text-slate-700">{target.campaignName}</div>
                            <div className="truncate text-[10px] text-slate-400">{target.adGroupName}</div>
                          </div>
                          <div>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">{target.adType} · {target.matchType}</span>
                          </div>
                          <div className="text-[11px] font-bold text-slate-500">{target.state || "—"}</div>
                          <div className="text-right font-mono font-black text-slate-800">{target.currentBid ? `$${target.currentBid.toFixed(2)}` : "—"}</div>
                          <div className="text-right font-mono font-bold text-slate-900">${target.spend.toFixed(2)}</div>
                          <div className="text-right font-mono font-black text-emerald-600">${target.sales.toFixed(2)}</div>
                          <div className="text-right font-mono font-bold text-slate-900">{target.orders}</div>
                          <div className="text-right font-mono text-slate-600">${target.cpc.toFixed(2)}</div>
                          <div className="text-right font-mono text-slate-700">{target.cvr.toFixed(1)}%</div>
                          <div className={`text-right font-mono font-black ${target.acos <= targetAcos ? "text-emerald-700" : "text-rose-700"}`}>
                            {target.acos > 500 ? "0 sales" : `${target.acos.toFixed(1)}%`}
                          </div>
                          <div className="text-right font-mono font-bold text-sky-600">{target.roas.toFixed(2)}x</div>
                          <div className="text-center pl-2">
                            <button
                              type="button"
                              onClick={() => setExpandedTargetKey(isExpanded ? null : targetKey)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-extrabold transition cursor-pointer border ${
                                isExpanded
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                                  : childTerms.length > 0
                                    ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200"
                                    : "bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200"
                              }`}
                              title="Xem các customer search terms do target này kích hoạt"
                            >
                              <MagnifyingGlass size={11} weight="bold" />
                              <span>{childTerms.length} Terms</span>
                              <span>{isExpanded ? "▲" : "▼"}</span>
                            </button>
                          </div>
                        </div>

                        {/* Inline Expandable Layer 2: Search Term Breakdown */}
                        {isExpanded && (
                          <div className="bg-slate-50/90 p-3.5 border-t border-indigo-100 space-y-2.5 animate-in fade-in duration-150">
                            {/* Header Context & Intelligence Insight */}
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 p-2.5 rounded-lg bg-white border border-indigo-100 shadow-2xs">
                              <div>
                                <div className="text-xs font-black text-slate-900 flex items-center gap-2">
                                  <span>🎯 Search Terms kích hoạt bởi &quot;{target.targetKeyword}&quot; ({target.matchType})</span>
                                  <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold">
                                    Target ACOS: {target.acos > 500 ? "0 sales" : `${target.acos.toFixed(1)}%`}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Chiến dịch: <strong className="text-slate-700">{target.campaignName}</strong> • Nhóm QC: <strong className="text-slate-700">{target.adGroupName}</strong> • Giá thầu hiện tại: <strong className="text-indigo-700">${target.currentBid?.toFixed(2) || "—"}</strong>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-extrabold">
                                {harvestCandidates.length > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    🟢 {harvestCandidates.length} Harvest Candidate
                                  </span>
                                )}
                                {bleederCandidates.length > 0 && (
                                  <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                    🔴 {bleederCandidates.length} Negative Candidate (-${bleederSpend.toFixed(2)})
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 2-Layer Intelligence Tip */}
                            {bleederCandidates.length > 0 ? (
                              <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200 text-[11px] text-amber-900 font-medium">
                                💡 <strong>Gợi ý thông minh (Recommendation Engine):</strong> Target ACOS {target.acos}% không hẳn do cả keyword xấu! Đang có <strong>${bleederSpend.toFixed(2)}</strong> bị lãng phí từ {bleederCandidates.length} query 0 đơn. <strong>Không nên giảm bid toàn bộ target ngay</strong>, hãy thêm Negative các query này trước, ACOS target cha sẽ tự động hạ xuống!
                              </div>
                            ) : harvestCandidates.length > 0 ? (
                              <div className="p-2.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-[11px] text-emerald-900 font-medium">
                                🚀 <strong>Gợi ý mở rộng:</strong> Có {harvestCandidates.length} search term chuyển đổi rất tốt với ACOS thấp. Nên tách (Harvest) thành Exact Target riêng để tăng ngân sách và kiểm soát giá thầu tối ưu.
                              </div>
                            ) : null}

                            {/* Sub-table: Queries */}
                            {childTerms.length === 0 ? (
                              <div className="p-4 text-center text-xs text-slate-400 font-medium bg-white rounded-lg border border-slate-200">
                                Chưa ghi nhận customer search term nào phát sinh click trong kỳ báo cáo cho target này.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="w-full text-left text-xs text-slate-700">
                                  <thead className="bg-slate-100/75 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                    <tr>
                                      <th className="py-2 px-3">Customer Search Term</th>
                                      <th className="py-2 px-2.5 text-right">Clicks</th>
                                      <th className="py-2 px-2.5 text-right">Spend ($)</th>
                                      <th className="py-2 px-2.5 text-right">Sales ($)</th>
                                      <th className="py-2 px-2.5 text-right">Orders</th>
                                      <th className="py-2 px-2.5 text-right">CVR</th>
                                      <th className="py-2 px-2.5 text-right">ACOS</th>
                                      <th className="py-2 px-3 text-center">Khuyến Nghị (Action)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 font-medium">
                                    {childTerms.map((term, tIdx) => {
                                      const isHarvest = term.orders > 0 && term.acos <= targetAcos;
                                      const isBleeder = term.orders === 0 && (term.clicks >= 9 || term.spend >= 15);
                                      return (
                                        <tr key={tIdx} className="hover:bg-slate-50/60">
                                          <td className="py-2 px-3 font-bold text-slate-900">{term.customerSearchTerm}</td>
                                          <td className="py-2 px-2.5 text-right font-mono">{term.clicks}</td>
                                          <td className="py-2 px-2.5 text-right font-mono">${term.spend.toFixed(2)}</td>
                                          <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-600">${term.sales.toFixed(2)}</td>
                                          <td className="py-2 px-2.5 text-right font-mono font-bold">{term.orders}</td>
                                          <td className="py-2 px-2.5 text-right font-mono">{term.cvr.toFixed(1)}%</td>
                                          <td className="py-2 px-2.5 text-right font-mono font-bold">
                                            {term.orders === 0 ? "0 sales" : `${term.acos.toFixed(1)}%`}
                                          </td>
                                          <td className="py-2 px-3 text-center">
                                            {isHarvest ? (
                                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                🟢 Harvest sang Exact
                                              </span>
                                            ) : isBleeder ? (
                                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">
                                                🔴 Thêm Negative
                                              </span>
                                            ) : (
                                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                                🟡 Keep / Theo dõi
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
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: BREAKDOWN BY SKU / PORTFOLIO */}
      {/* ========================================================================= */}
      {activeTab === "skus" && (
        <div className="space-y-3">
          {/* Category Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Phân Hạng:</span>
            <button
              type="button"
              onClick={() => setSkuCategoryFilter("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${skuCategoryFilter === "ALL" ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              Tất cả ({activeSkuPerformance.length})
            </button>
            <button
              type="button"
              onClick={() => setSkuCategoryFilter("HERO")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${skuCategoryFilter === "HERO"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100"
                }`}
            >
              <span>🏆 Hero SKUs</span>
              <span className="text-[10px] opacity-80">({activeSkuPerformance.filter((s) => s.skuCategory === "HERO").length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSkuCategoryFilter("BLEEDING")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${skuCategoryFilter === "BLEEDING"
                ? "bg-rose-600 text-white shadow-xs"
                : "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-100"
                }`}
            >
              <span>⚠️ Bleeding SKUs</span>
              <span className="text-[10px] opacity-80">({activeSkuPerformance.filter((s) => s.skuCategory === "BLEEDING").length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSkuCategoryFilter("POTENTIAL")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${skuCategoryFilter === "POTENTIAL"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-100"
                }`}
            >
              <span>🌱 Tiềm Năng</span>
              <span className="text-[10px] opacity-80">({activeSkuPerformance.filter((s) => s.skuCategory === "POTENTIAL").length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSkuCategoryFilter("ZERO_CLICKS")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1 ${skuCategoryFilter === "ZERO_CLICKS"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                }`}
            >
              <span>🎯 0 Clicks - Cần Sửa</span>
              <span className="text-[10px] opacity-80">({activeSkuPerformance.filter((s) => s.clicks === 0).length})</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="relative flex-1 sm:w-72">
              <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={skuQuery}
                onChange={(e) => setSkuQuery(e.target.value)}
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
                  <th className="py-3 px-2.5 text-center">Trạng Thái / Tier</th>
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
                  <th className="py-3 px-2 text-right">% Spend</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("sales", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Sales ($) {skuSortField === "sales" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-2 text-right">% Sales</th>
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
                  <th className="py-3 px-3 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredSortedSkus.map((s, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 px-3.5 font-bold text-slate-900 flex items-center gap-2">
                      <Tag size={14} className="text-indigo-600 shrink-0" />
                      <span className="truncate max-w-[280px]" title={s.sku}>{s.sku}</span>
                    </td>
                    <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase ${s.skuCategory === "HERO"
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                        : s.skuCategory === "BLEEDING"
                          ? "bg-rose-100 text-rose-800 border border-rose-200"
                          : s.skuCategory === "POTENTIAL"
                            ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                            : s.clicks === 0 && s.impressions > 0
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : s.clicks === 0
                                ? "bg-slate-100 text-slate-500 border border-slate-200"
                                : "bg-slate-100 text-slate-600"
                        }`}>
                        {s.skuCategory === "HERO" && "🏆 Hero"}
                        {s.skuCategory === "BLEEDING" && "⚠️ Cắn Tiền"}
                        {s.skuCategory === "POTENTIAL" && "🌱 Tiềm Năng"}
                        {s.clicks === 0 && s.impressions > 0 && "🎯 0 Click - Sửa Listing"}
                        {s.clicks === 0 && s.impressions === 0 && "⏸️ 0 Imp."}
                        {s.clicks > 0 && s.skuCategory === "NEUTRAL" && "Neutral"}
                      </span>
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
                    <td className="py-2.5 px-2 text-right text-slate-500 font-bold">{s.spendShare}%</td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-600">${s.sales.toFixed(2)}</td>
                    <td className="py-2.5 px-2 text-right text-emerald-700 font-bold">{s.revenueShare}%</td>
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
                    <td className="py-2.5 px-3 text-right font-bold text-sky-600">
                      {s.spend === 0 ? "-" : `${s.roas.toFixed(2)}x`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 4: BREAKDOWN BY MATCH TYPE */}
      {/* ========================================================================= */}
      {activeTab === "match_types" && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">Match Type</th>
                  <th className="py-3 px-3 text-right">Spend ($)</th>
                  <th className="py-3 px-3 text-right">% Spend</th>
                  <th className="py-3 px-3 text-right">Sales ($)</th>
                  <th className="py-3 px-3 text-right">% Sales</th>
                  <th className="py-3 px-3 text-right">Orders</th>
                  <th className="py-3 px-3 text-right">Clicks</th>
                  <th className="py-3 px-3 text-right">CPC ($)</th>
                  <th className="py-3 px-3 text-right">CVR (%)</th>
                  <th className="py-3 px-3 text-right">ACOS (%)</th>
                  <th className="py-3 px-3 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {matchTypeBreakdown.map((m) => (
                  <tr key={m.matchType} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-3.5 font-bold text-slate-900 flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: MATCH_TYPE_COLORS[m.matchType] || "#94a3b8" }}
                      />
                      <span>{m.matchType}</span>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900">${m.spend.toFixed(2)}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-500">{m.spendShare}%</td>
                    <td className="py-3 px-3 text-right font-black text-emerald-600">${m.sales.toFixed(2)}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-500">{m.salesShare}%</td>
                    <td className="py-3 px-3 text-right font-black text-slate-900">{m.orders}</td>
                    <td className="py-3 px-3 text-right text-slate-600">{m.clicks}</td>
                    <td className="py-3 px-3 text-right text-slate-600">${m.cpc.toFixed(2)}</td>
                    <td className="py-3 px-3 text-right text-slate-700">{m.cvr.toFixed(1)}%</td>
                    <td className="py-3 px-3 text-right font-black text-slate-900">{m.acos.toFixed(1)}%</td>
                    <td className="py-3 px-3 text-right font-bold text-sky-600">{m.roas.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <option value="ALL">Tất cả Hiệu Suất ({searchTerms.length})</option>
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
                      handleSort("clicks", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Clicks {termSortField === "clicks" && (termSortDir === "asc" ? "↑" : "↓")}
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
                  <th className="py-3 px-3 text-right">CTR (%)</th>
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
                {paginatedSearchTerms.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-slate-400 font-sans font-medium">
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
                        <td className="py-2.5 px-3 font-sans font-bold text-slate-900 max-w-xs truncate">
                          {t.customerSearchTerm}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-[10px] font-black text-indigo-700">{t.adType || "?"}</td>
                        <td className="py-2.5 px-3 font-sans">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {t.matchType}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 font-sans max-w-[180px] truncate">
                          {t.campaignName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-800">{t.clicks}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900">${t.spend.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-black text-emerald-600">${t.sales.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900">{t.orders}</td>
                        <td className="py-2.5 px-3 text-right text-slate-500">{(t.ctr * 100).toFixed(2)}%</td>
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

          {/* Pagination */}
          <div className="flex items-center justify-between px-2 text-xs font-semibold text-slate-500">
            <div>
              Hiển thị {filteredSortedSearchTerms.length ? (termPage - 1) * termPageSize + 1 : 0} -{" "}
              {Math.min(termPage * termPageSize, filteredSortedSearchTerms.length)} trên tổng số{" "}
              <strong className="text-slate-900">{filteredSortedSearchTerms.length}</strong> từ khóa
            </div>

            <div className="flex items-center gap-2">
              <select
                value={termPageSize}
                onChange={(e) => {
                  setTermPageSize(Number(e.target.value));
                  setTermPage(1);
                }}
                className="py-1 px-2 rounded-lg border border-slate-200 bg-white text-xs outline-none cursor-pointer"
              >
                <option value={15}>15 dòng/trang</option>
                <option value={30}>30 dòng/trang</option>
                <option value={50}>50 dòng/trang</option>
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={termPage <= 1}
                  onClick={() => setTermPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  Trước
                </button>
                <span className="px-2 py-1 text-slate-700 font-bold">
                  {termPage} / {totalTermPages}
                </span>
                <button
                  type="button"
                  disabled={termPage >= totalTermPages}
                  onClick={() => setTermPage((p) => Math.min(totalTermPages, p + 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  Sau
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-xs font-semibold text-emerald-800">
              Không có cảnh báo PPC trong phạm vi đang lọc.
            </div>
          ) : alerts.map((alert) => (
            <div key={alert.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-900">{alert.title}</div>
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${alert.severity === "CRITICAL" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                  {alert.severity}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{alert.message}</p>
              <div className="mt-2 text-[11px] font-semibold text-slate-400">{alert.storeName} · {alert.sku || "Chưa gán SKU"}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "recommendations" && (
        <div className="space-y-4">
          {/* Shop Action Center Header & Controls */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900">
                    Trung Tâm Hành Động & Đề Xuất Tối Ưu (Shop Action Center)
                  </h3>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-100">
                    {recommendations.length} đề xuất
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Phân tầng ưu tiên tự động: <strong className="text-rose-600">P0</strong> Cắt lỗ khẩn cấp · <strong className="text-emerald-600">P1</strong> Scale sản phẩm thắng · <strong className="text-sky-600">P2</strong> Thu hoạch từ khóa tiềm năng. Xuất file nạp trực tiếp Amazon Bulk Operations.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRecs.size === filteredRecommendations.length && filteredRecommendations.length > 0) {
                      setSelectedRecs(new Set());
                    } else {
                      setSelectedRecs(new Set(filteredRecommendations.map((r) => r.id)));
                    }
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  {selectedRecs.size === filteredRecommendations.length && filteredRecommendations.length > 0
                    ? "Bỏ Chọn Tất Cả"
                    : `Chọn Tất Cả (${filteredRecommendations.length})`}
                </button>

                <button
                  type="button"
                  disabled={exportingBulksheet || recommendations.length === 0}
                  onClick={() => handleExportBulksheet()}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-emerald-500/20 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50 transition cursor-pointer"
                >
                  {exportingBulksheet ? (
                    <>
                      <ArrowsClockwise size={16} className="animate-spin" />
                      <span>Đang tạo Bulksheet...</span>
                    </>
                  ) : (
                    <>
                      <Download size={16} weight="bold" />
                      <span>
                        Xuất Bulksheet Amazon (.xlsx)
                        {selectedRecs.size > 0 ? ` (${selectedRecs.size} mục)` : ` (${filteredRecommendations.length})`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Filter Chips by Priority */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
                Lọc mức ưu tiên:
              </span>
              <button
                type="button"
                onClick={() => setRecPriorityFilter("ALL")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${recPriorityFilter === "ALL"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
              >
                Tất Cả ({recommendations.length})
              </button>
              <button
                type="button"
                onClick={() => setRecPriorityFilter("P0")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${recPriorityFilter === "P0"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-rose-50 text-rose-700 border border-rose-200/60 hover:bg-rose-100"
                  }`}
              >
                <span>🚨 P0 - Cắt Lỗ Khẩn Cấp</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                  {recommendations.filter((r) => r.priority === "P0").length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRecPriorityFilter("P1")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${recPriorityFilter === "P1"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200/60 hover:bg-emerald-100"
                  }`}
              >
                <span>📈 P1 - Scale & Tăng Trưởng</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                  {recommendations.filter((r) => r.priority === "P1").length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRecPriorityFilter("P2")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${recPriorityFilter === "P2"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "bg-sky-50 text-sky-700 border border-sky-200/60 hover:bg-sky-100"
                  }`}
              >
                <span>🎯 P2 - Thu Hoạch Từ Khóa</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                  {recommendations.filter((r) => r.priority === "P2").length}
                </span>
              </button>
            </div>
          </div>

          {/* List of Recommendation Cards */}
          {filteredRecommendations.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <CheckCircle size={28} weight="duotone" />
              </div>
              <h4 className="mt-3 text-sm font-bold text-slate-800">Không có đề xuất trong nhóm này</h4>
              <p className="mt-1 text-xs text-slate-500">
                Tất cả các từ khóa và chiến dịch trong nhóm này đều đang vận hành trong ngưỡng cho phép.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecommendations.map((rec) => {
                const isSelected = selectedRecs.has(rec.id);
                const priorityBadge =
                  rec.priority === "P0" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800 border border-rose-200">
                      🚨 P0: CẮT LỖ KHẨN CẤP
                    </span>
                  ) : rec.priority === "P1" ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 border border-emerald-200">
                      📈 P1: SCALE CHIẾN DỊCH
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-800 border border-sky-200">
                      🎯 P2: THU HOẠCH TỪ KHÓA
                    </span>
                  );

                const typeBadge =
                  rec.recType === "NEGATIVE_KEYWORD" ? (
                    <span className="rounded bg-rose-50 px-2 py-0.5 text-[10px] font-extrabold text-rose-700 border border-rose-100">
                      PHỦ ĐỊNH CHÍNH XÁC (NEGATIVE EXACT)
                    </span>
                  ) : rec.recType === "BID_DECREASE" ? (
                    <span className="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 border border-amber-100">
                      HẠ GIÁ THẦU (BID REDUCTION)
                    </span>
                  ) : rec.recType === "BID_INCREASE" ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 border border-emerald-100">
                      TĂNG GIÁ THẦU (BID INCREASE)
                    </span>
                  ) : (
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700 border border-indigo-100">
                      THU HOẠCH TỪ KHÓA (HARVEST)
                    </span>
                  );

                return (
                  <div
                    key={rec.id}
                    className={`rounded-2xl border transition p-4 shadow-2xs ${isSelected
                      ? "border-indigo-400 bg-indigo-50/20 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedRecs((prev) => {
                            const next = new Set(prev);
                            if (next.has(rec.id)) next.delete(rec.id);
                            else next.add(rec.id);
                            return next;
                          });
                        }}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />

                      <div className="flex-1 min-w-0">
                        {/* Badges & Meta */}
                        <div className="flex flex-wrap items-center gap-2">
                          {priorityBadge}
                          {typeBadge}
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            {rec.storeName}
                          </span>
                          {rec.campaignName && (
                            <span className="truncate max-w-xs text-[11px] font-medium text-slate-400">
                              {rec.campaignName}
                            </span>
                          )}
                        </div>

                        {/* Keyword & Copy */}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-slate-900 bg-slate-50 px-2 py-1 rounded border border-slate-200/80">
                            {rec.keyword}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyKeyword(rec.keyword)}
                            className="p-1 text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                            title="Sao chép từ khóa"
                          >
                            <Copy size={14} />
                          </button>
                        </div>

                        {/* Reason / Logic */}
                        <div className="mt-2.5 rounded-xl bg-slate-50/80 border border-slate-100 p-3 text-xs text-slate-700">
                          <p className="leading-relaxed">{rec.reason}</p>
                        </div>

                        {/* Bid comparison & Action footer */}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                          <div className="flex items-center gap-3 text-xs font-semibold text-slate-600">
                            {rec.recommendedBid !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">Giá thầu đề xuất:</span>
                                <span className="font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                  ${rec.recommendedBid.toFixed(2)}
                                </span>
                              </div>
                            )}
                            {rec.estimatedSavings !== undefined && rec.estimatedSavings > 0 && (
                              <div className="flex items-center gap-1 text-emerald-700">
                                <span>Chi phí kỳ báo cáo có thể tránh:</span>
                                <strong className="font-black">${rec.estimatedSavings.toFixed(2)}</strong>
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={exportingBulksheet}
                            onClick={() => handleExportBulksheet([rec])}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition cursor-pointer"
                          >
                            <Download size={13} weight="bold" />
                            <span>Xuất riêng mục này sang Bulksheet</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL UPLOAD EXCEL FILE */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col">
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
                      {s.name} ({s.marketplace})
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
    </div>
  );
}
