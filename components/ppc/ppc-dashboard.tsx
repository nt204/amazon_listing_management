"use client";

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowsClockwise,
  ChartLineUp,
  CheckCircle,
  Copy,
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
  PpcCampaignPerformance,
  PpcMatchTypeBreakdown,
  PpcRecommendation,
  PpcSearchTermRow,
  PpcSkuPerformance,
  PpcStore,
  PpcSummaryMetrics,
} from "@/lib/ppc/types";

interface PpcDashboardProps {
  isEmbedded?: boolean;
}

type SortField = "spend" | "sales" | "orders" | "clicks" | "acos" | "cvr" | "roas";
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
    term.id, term.storeName, term.reportDate, term.portfolioName, term.campaignName,
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
  const [skuPerformance, setSkuPerformance] = useState<PpcSkuPerformance[]>([]);
  const [campaignPerformance, setCampaignPerformance] = useState<PpcCampaignPerformance[]>([]);
  const [matchTypeBreakdown, setMatchTypeBreakdown] = useState<PpcMatchTypeBreakdown[]>([]);
  const [searchTerms, setSearchTerms] = useState<PpcSearchTermRow[]>([]);
  const [alerts, setAlerts] = useState<PpcAlert[]>([]);
  const [recommendations, setRecommendations] = useState<PpcRecommendation[]>([]);
  const [targetAcos, setTargetAcos] = useState(30);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Navigation tab for data slicing
  const [activeTab, setActiveTab] = useState<
    "overview" | "campaigns" | "skus" | "match_types" | "search_terms" | "alerts" | "recommendations"
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

  // Campaign search & sort
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignSortField, setCampaignSortField] = useState<SortField>("spend");
  const [campaignSortDir, setCampaignSortDir] = useState<SortDirection>("desc");

  // SKU search & sort
  const [skuQuery, setSkuQuery] = useState("");
  const [skuSortField, setSkuSortField] = useState<SortField>("spend");
  const [skuSortDir, setSkuSortDir] = useState<SortDirection>("desc");

  const [loading, setLoading] = useState(true);
  const [syncingR2, setSyncingR2] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStore, setUploadStore] = useState("Bozspacer");
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const notify = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 4000);
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
      setSkuPerformance(data.skuPerformance || []);
      setCampaignPerformance(data.campaignPerformance || []);
      setMatchTypeBreakdown(data.matchTypeBreakdown || []);
      setSearchTerms(data.searchTerms || []);
      setAlerts(data.alerts || []);
      setRecommendations(data.recommendations || []);
      setAvailableSkus(data.availableSkus || []);
      setTargetAcos(data.targetAcos || 30);
      setLastSyncedAt(data.lastSyncedAt || null);
      setSelectedTerms(new Set());
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

      const res = await fetch("/api/ppc/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload thất bại");

      notify(data.message || "Nạp file Excel thành công!");
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

  // Filtered & Sorted SKUs
  const filteredSortedSkus = useMemo(() => {
    let list = [...skuPerformance];
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
  }, [skuPerformance, skuQuery, skuSortField, skuSortDir]);

  // Chart Data: Top 7 Campaigns by Spend
  const topCampaignChartData = useMemo(() => {
    return campaignPerformance.slice(0, 7).map((c) => ({
      name: c.campaignName.length > 20 ? `${c.campaignName.slice(0, 18)}...` : c.campaignName,
      spend: c.spend,
      sales: c.sales,
      acos: c.acos > 150 ? 150 : c.acos,
    }));
  }, [campaignPerformance]);

  // Chart Data: Match Type Spend & Sales Share
  const matchTypePieData = useMemo(() => {
    return matchTypeBreakdown.map((m) => ({
      name: m.matchType,
      value: m.spend,
      sales: m.sales,
      spendShare: m.spendShare,
      color: MATCH_TYPE_COLORS[m.matchType] || "#94a3b8",
    }));
  }, [matchTypeBreakdown]);

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
        return `${campSafe},"${c.storeName}","${c.targetingType}",${c.spend.toFixed(2)},${c.sales.toFixed(2)},${c.orders},${c.clicks},${c.cpc.toFixed(2)},${(c.ctr * 100).toFixed(2)},${(c.cvr * 100).toFixed(1)},${c.acos.toFixed(1)},${c.roas.toFixed(2)}`;
      });
      filename = `ppc-campaigns-${Date.now()}.csv`;
    } else {
      header = "SKU,Store,Spend ($),Sales ($),Orders,Clicks,CVR (%),ACOS (%),ROAS\n";
      rows = filteredSortedSkus.map((s) => {
        return `"${s.sku}","${s.storeName}",${s.spend.toFixed(2)},${s.sales.toFixed(2)},${s.orders},${s.clicks},${(s.cvr * 100).toFixed(1)},${s.acos.toFixed(1)},${s.roas.toFixed(2)}`;
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
                Bóc tách số liệu quảng cáo theo Chiến dịch, SKU, Loại khớp và Search Terms khách gõ
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
              <span>Nạp Excel</span>
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
                <option value="ALL">Tất cả Store ({stores.length})</option>
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
                  <option value="ALL">Tất cả SKU ({availableSkus.length})</option>
                  {availableSkus.map((sku) => (
                    <option key={sku} value={sku}>
                      {sku}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
              <span className="text-slate-500 font-semibold text-[11px]">Thời gian:</span>
              <select
                value={selectedDays}
                onChange={(event) => setSelectedDays(Number(event.target.value))}
                className="bg-transparent text-slate-900 font-bold outline-none cursor-pointer text-xs"
              >
                <option value={7}>7 ngày</option>
                <option value={14}>14 ngày</option>
                <option value={30}>30 ngày</option>
                <option value={60}>60 ngày</option>
                <option value={90}>90 ngày</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] font-medium text-slate-400 text-right">
            <div>Attribution: <strong className="text-slate-600">theo cột trong báo cáo</strong></div>
            <div>{loading ? "Đang tải dữ liệu…" : lastSyncedAt ? `Cập nhật: ${new Date(lastSyncedAt).toLocaleString("vi-VN")}` : "Chưa có lần đồng bộ"}</div>
          </div>
        </div>
      </div>

      {!loading && searchTerms.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>Chưa có dữ liệu PPC trong {selectedDays} ngày gần nhất.</strong>{" "}
          Hãy nạp báo cáo Search Term hoặc đồng bộ từ R2. Hệ thống không tự chèn dữ liệu mẫu.
        </div>
      )}

      {/* EXECUTIVE KPI CARDS */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Ad Spend */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Chi Tiêu (Spend)
            </span>
            <div className="text-xl font-black text-slate-900 mt-0.5">
              ${summary.totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              CPC TB: <strong className="text-slate-800">${summary.avgCpc.toFixed(2)}</strong>
            </div>
          </div>

          {/* Ad Sales */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Doanh Số Ads
            </span>
            <div className="text-xl font-black text-emerald-600 mt-0.5">
              ${summary.totalSales.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Đơn: <strong className="text-slate-800">{summary.totalOrders}</strong> ({summary.totalUnits} sp)
            </div>
          </div>

          {/* ACOS */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              ACOS Trung Bình
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span
                className={`text-xl font-black ${
                  summary.blendedAcos <= targetAcos
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
                className={`text-[9px] font-bold px-1 rounded uppercase ${
                  summary.blendedAcos <= targetAcos
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {summary.blendedAcos <= targetAcos ? "Đạt" : "Cao"}
              </span>
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Target: <strong className="text-slate-800">{targetAcos.toFixed(1)}%</strong>
            </div>
          </div>

          {/* ROAS */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              ROAS (Lợi Tức)
            </span>
            <div className="text-xl font-black text-sky-600 mt-0.5">
              {summary.blendedRoas.toFixed(2)}x
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Sales / Spend
            </div>
          </div>

          {/* CVR & CTR */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Tỷ Lệ Mua (CVR)
            </span>
            <div className="text-xl font-black text-indigo-600 mt-0.5">
              {(summary.overallCvr * 100).toFixed(1)}%
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              CTR: <strong className="text-slate-800">{(summary.overallCtr * 100).toFixed(2)}%</strong>
            </div>
          </div>

          {/* Clicks & Impr */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Lượt Clicks
            </span>
            <div className="text-xl font-black text-slate-800 mt-0.5">
              {summary.totalClicks.toLocaleString()}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 mt-1">
              Hiển thị: <strong className="text-slate-800">{summary.totalImpressions.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      )}

      {/* VISUAL CHARTS ROW (Using Recharts) */}
      {mounted && summary && (
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
                  <Bar dataKey="spend" name="Chi Tiêu" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={30} />
                  <Bar dataKey="sales" name="Doanh Số" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={30} />
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
                <span className="text-[10px] font-bold text-slate-400">TỔNG SPEND</span>
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

      {/* DATA SLICING SUB-TABS (Bóc tách dữ liệu) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/60 rounded-xl border border-slate-200/80 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "overview"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ChartLineUp size={15} weight={activeTab === "overview" ? "bold" : "regular"} />
          <span>Tổng Quan</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("campaigns")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "campaigns"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <FolderSimple size={15} weight={activeTab === "campaigns" ? "bold" : "regular"} />
          <span>Theo Chiến Dịch ({campaignPerformance.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("skus")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "skus"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Tag size={15} weight={activeTab === "skus" ? "bold" : "regular"} />
          <span>Theo SKU / Portfolio ({skuPerformance.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("match_types")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "match_types"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ChartPieSlice size={15} weight={activeTab === "match_types" ? "bold" : "regular"} />
          <span>Theo Loại Khớp ({matchTypeBreakdown.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("search_terms")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "search_terms"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <ListDashes size={15} weight={activeTab === "search_terms" ? "bold" : "regular"} />
          <span>Báo Cáo Search Terms ({searchTerms.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("alerts")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "alerts"
              ? "bg-white text-rose-700 shadow-xs border border-rose-100"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>Cảnh Báo ({alerts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("recommendations")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
            activeTab === "recommendations"
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
                  Top Search Terms Sinh Lời Tốt Nhất (ACOS &le; {targetAcos.toFixed(1)}%)
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setTermPerformanceFilter("WITH_ORDERS");
                    setActiveTab("search_terms");
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
                  Top Search Terms Cắn Tiền 0 Đơn (Clicks &ge; 9)
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setTermPerformanceFilter("ZERO_ORDERS_BLEEDING");
                    setActiveTab("search_terms");
                  }}
                  className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  Xem &amp; Phủ định →
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
                      <th className="py-1.5 text-right">Trạng Thái</th>
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
                              0 ĐƠN
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
                  <th className="py-3 px-3.5">Chiến Dịch (Campaign)</th>
                  <th className="py-3 px-3">Store</th>
                  <th className="py-3 px-3">Loại</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("spend", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Chi Tiêu ($) {campaignSortField === "spend" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Doanh Số ($) {campaignSortField === "sales" && (campaignSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", campaignSortField, campaignSortDir, setCampaignSortField, setCampaignSortDir)
                    }
                  >
                    Đơn {campaignSortField === "orders" && (campaignSortDir === "asc" ? "↑" : "↓")}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredSortedCampaigns.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition">
                    <td className="py-2.5 px-3.5 font-bold text-slate-900 max-w-xs truncate">
                      {c.campaignName}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-medium">{c.storeName}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                        {c.targetingType}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">${c.spend.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-600">${c.sales.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">{c.orders}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{c.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">${c.cpc.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{(c.cvr * 100).toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                          c.acos <= Math.min(20, targetAcos)
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
                  </tr>
                ))}
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

            <button
              type="button"
              onClick={() => handleExportCsv("skus")}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer self-end sm:self-auto"
            >
              <Download size={14} /> Xuất CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">SKU / Portfolio</th>
                  <th className="py-3 px-3">Store</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("spend", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Chi Tiêu ($) {skuSortField === "spend" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("sales", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Doanh Số ($) {skuSortField === "sales" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() => handleSort("orders", skuSortField, skuSortDir, setSkuSortField, setSkuSortDir)}
                  >
                    Đơn {skuSortField === "orders" && (skuSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right">Clicks</th>
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
                      <Tag size={14} className="text-indigo-600" />
                      <span>{s.sku}</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{s.storeName}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">${s.spend.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-emerald-600">${s.sales.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">{s.orders}</td>
                    <td className="py-2.5 px-3 text-right text-slate-600">{s.clicks}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{(s.cvr * 100).toFixed(1)}%</td>
                    <td className="py-2.5 px-3 text-right">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                          s.acos <= Math.min(20, targetAcos)
                            ? "bg-emerald-50 text-emerald-700"
                            : s.acos <= targetAcos
                            ? "bg-teal-50 text-teal-700"
                            : s.acos <= 50
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {s.acos > 500 ? "0 sales" : `${s.acos.toFixed(1)}%`}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-sky-600">{s.roas.toFixed(2)}x</td>
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
                  <th className="py-3 px-3.5">Loại Khớp (Match Type)</th>
                  <th className="py-3 px-3 text-right">Chi Tiêu ($)</th>
                  <th className="py-3 px-3 text-right">% Chi Tiêu</th>
                  <th className="py-3 px-3 text-right">Doanh Số ($)</th>
                  <th className="py-3 px-3 text-right">% Doanh Số</th>
                  <th className="py-3 px-3 text-right">Đơn Hàng</th>
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
                    <td className="py-3 px-3 text-right text-slate-700">{(m.cvr * 100).toFixed(1)}%</td>
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
                  <th className="py-3 px-3">Match Type</th>
                  <th className="py-3 px-3">Chiến Dịch</th>
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
                    Chi Tiêu ($) {termSortField === "spend" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("sales", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Doanh Số ($) {termSortField === "sales" && (termSortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600"
                    onClick={() =>
                      handleSort("orders", termSortField, termSortDir, setTermSortField, setTermSortDir)
                    }
                  >
                    Đơn {termSortField === "orders" && (termSortDir === "asc" ? "↑" : "↓")}
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
                    <td colSpan={11} className="p-8 text-center text-slate-400 font-sans font-medium">
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
                            className={`${
                              t.orders === 0 && t.clicks >= 9
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
        <div className="space-y-2">
          {recommendations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs font-semibold text-slate-500">
              Không có đề xuất tối ưu trong phạm vi đang lọc.
            </div>
          ) : recommendations.map((recommendation) => (
            <div key={recommendation.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-black text-slate-900">{recommendation.keyword}</div>
                <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">{recommendation.recType}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{recommendation.reason}</p>
              <div className="mt-2 text-[11px] font-semibold text-slate-400">
                {recommendation.storeName} · {recommendation.campaignName || "Chưa gán campaign"}
                {recommendation.recommendedBid !== undefined ? ` · Bid đề xuất $${recommendation.recommendedBid.toFixed(2)}` : ""}
              </div>
            </div>
          ))}
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
                  <p className="text-[11px] font-medium text-slate-500">Định dạng file Excel .xlsx từ Seller Central</p>
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
                <label className="block text-slate-700 font-bold mb-1.5">Chọn file Excel (.xlsx):</label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
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
