"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Prohibit,
  FileXls,
  Copy,
  MagnifyingGlass,
  CheckCircle,
  Funnel,
  ShieldWarning,
  CircleNotch,
  ArrowSquareOut,
  SlidersHorizontal,
  Lightning,
  CloudArrowUp,
  Check,
  X,
  Info,
  WarningCircle,
} from "@phosphor-icons/react";
import type { PpcSearchTermRow, MatchType, PpcAdType } from "@/lib/ppc/types";
import { PpcPagination } from "./ppc-pagination";

export interface StOptimizationCandidate {
  key: string;
  customerSearchTerm: string;
  campaignName: string;
  adGroupName: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  targetKeyword: string;
  matchType: MatchType;
  adType: PpcAdType;
  storeId?: string;
  storeName?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
}

interface PpcStOptimizationViewProps {
  searchTerms: PpcSearchTermRow[];
  selectedStore: string;
  selectedSku: string;
  selectedDays: number;
  loading: boolean;
  notify: (message: string, type?: "success" | "error") => void;
}

export function PpcStOptimizationView({
  searchTerms,
  selectedStore,
  selectedSku,
  selectedDays,
  loading,
  notify,
}: PpcStOptimizationViewProps) {
  // 1. Threshold controls (User requirement: mặc định clicks > 20, có 1 ô nhỏ điều chỉnh ngưỡng click)
  const [clickThreshold, setClickThreshold] = useState<number>(20);
  const [clickOperator, setClickOperator] = useState<">" | ">=">(">");

  // 2. Filter & Sort state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [campaignFilter, setCampaignFilter] = useState<string>("ALL");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Auto Upload AdsPower modal state
  const [isAutoUploadModalOpen, setIsAutoUploadModalOpen] = useState<boolean>(false);
  const [isAutoUploading, setIsAutoUploading] = useState<boolean>(false);
  const [autoUploadStep, setAutoUploadStep] = useState<number>(0); // 0: confirm, 1: queuing, 2: success
  const [autoUploadSuccessResult, setAutoUploadSuccessResult] = useState<{
    jobId: string;
    fileName: string;
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

  const [sortField, setSortField] = useState<"clicks" | "spend" | "cpc" | "customerSearchTerm" | "campaignName">("clicks");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // 3. Aggregate search terms by (campaignName, customerSearchTerm) - DUY NHẤT trong source campaign!
  const allCandidates = useMemo(() => {
    if (!searchTerms || searchTerms.length === 0) return [];

    const map = new Map<string, StOptimizationCandidate>();

    for (const term of searchTerms) {
      const rawTerm = (term.customerSearchTerm || "").trim();
      const camp = (term.campaignName || "").trim();
      if (!rawTerm || !camp) continue;

      // Group key: campaignName + customerSearchTerm -> duy nhất trong source camp!
      const groupKey = `${camp.toLowerCase()}|||${rawTerm.toLowerCase()}`;
      const existing = map.get(groupKey);

      if (!existing) {
        map.set(groupKey, {
          key: groupKey,
          customerSearchTerm: rawTerm,
          campaignName: camp,
          adGroupName: (term.adGroupName || camp).trim(),
          campaignId: term.campaignId,
          adGroupId: term.adGroupId,
          keywordId: term.keywordId,
          targetKeyword: term.targetKeyword || "",
          matchType: term.matchType || "Unknown",
          adType: term.adType || "SP",
          storeId: term.storeId,
          storeName: term.storeName,
          impressions: term.impressions || 0,
          clicks: term.clicks || 0,
          spend: term.spend || 0,
          sales: term.sales || 0,
          orders: term.orders || 0,
          cpc: term.cpc || 0,
        });
      } else {
        existing.impressions += term.impressions || 0;
        existing.clicks += term.clicks || 0;
        existing.spend += term.spend || 0;
        existing.sales += term.sales || 0;
        existing.orders += term.orders || 0;
        if (!existing.campaignId && term.campaignId) existing.campaignId = term.campaignId;
        if (!existing.adGroupId && term.adGroupId) existing.adGroupId = term.adGroupId;
      }
    }

    // Lọc theo rule: Clicks > threshold (hoặc >=) AND Orders = 0
    const thresholdNum = Number(clickThreshold) || 20;
    const candidates = Array.from(map.values()).filter((c) => {
      if (c.orders !== 0) return false;
      return clickOperator === ">" ? c.clicks > thresholdNum : c.clicks >= thresholdNum;
    });

    for (const c of candidates) {
      c.cpc = c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : 0;
    }

    return candidates;
  }, [searchTerms, clickThreshold, clickOperator]);

  // Unique campaigns among candidates for filter dropdown
  const candidateCampaigns = useMemo(() => {
    return Array.from(new Set(allCandidates.map((c) => c.campaignName))).sort();
  }, [allCandidates]);

  // 4. Filtered & Sorted candidates
  const filteredCandidates = useMemo(() => {
    let list = [...allCandidates];

    if (campaignFilter !== "ALL") {
      list = list.filter((c) => c.campaignName === campaignFilter);
    }

    if (searchQuery.trim()) {
      const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const text = `${c.customerSearchTerm} ${c.campaignName} ${c.adGroupName} ${c.targetKeyword}`.toLowerCase();
        return tokens.every((tok) => text.includes(tok));
      });
    }

    list.sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (typeof valA === "string") {
        return sortDir === "asc" ? valA.localeCompare(String(valB)) : String(valB).localeCompare(valA);
      }
      return sortDir === "asc" ? (Number(valA) - Number(valB)) : (Number(valB) - Number(valA));
    });

    return list;
  }, [allCandidates, campaignFilter, searchQuery, sortField, sortDir]);

  // 5. Pagination
  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / pageSize));
  const paginatedCandidates = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredCandidates.slice(start, start + pageSize);
  }, [filteredCandidates, page, pageSize]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalTerms = filteredCandidates.length;
    const totalClicks = filteredCandidates.reduce((s, c) => s + c.clicks, 0);
    const totalSpend = filteredCandidates.reduce((s, c) => s + c.spend, 0);
    const affectedCampaigns = new Set(filteredCandidates.map((c) => c.campaignName)).size;

    return { totalTerms, totalClicks, totalSpend, affectedCampaigns };
  }, [filteredCandidates]);

  // Checkbox handlers
  const handleToggleSelectAll = () => {
    const visibleKeys = paginatedCandidates.map((c) => c.key);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selectedKeys.has(k));

    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleKeys.forEach((k) => next.delete(k));
      } else {
        visibleKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleToggleRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCopySingle = async (term: string, key: string) => {
    try {
      await navigator.clipboard.writeText(term);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
      notify(`Đã copy: "${term}"`, "success");
    } catch {
      notify("Không thể copy từ khóa", "error");
    }
  };

  const handleCopySelectedOrAll = async () => {
    const targetList = selectedKeys.size > 0
      ? filteredCandidates.filter((c) => selectedKeys.has(c.key))
      : filteredCandidates;

    if (targetList.length === 0) {
      notify("Không có từ khóa nào để copy", "error");
      return;
    }

    const textToCopy = Array.from(new Set(targetList.map((c) => c.customerSearchTerm))).join("\n");
    try {
      await navigator.clipboard.writeText(textToCopy);
      notify(`Đã copy ${targetList.length} search term vào clipboard`, "success");
    } catch {
      notify("Không thể copy danh sách từ khóa", "error");
    }
  };

  // 6. Export Amazon Bulksheet (.xlsx)
  const handleExportBulksheet = async () => {
    const targetList = selectedKeys.size > 0
      ? filteredCandidates.filter((c) => selectedKeys.has(c.key))
      : filteredCandidates;

    if (targetList.length === 0) {
      notify("Không có Search Term nào thỏa mãn để xuất file.", "error");
      return;
    }

    setIsExporting(true);
    try {
      const payload = {
        storeName: selectedStore,
        items: targetList.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          adType: c.adType,
          targetKeyword: c.targetKeyword,
          matchType: c.matchType,
          clicks: c.clicks,
          orders: c.orders,
          spend: c.spend,
        })),
      };

      const res = await fetch("/api/ppc/st-optimization/export", {
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
      let filename = `Upload_${selectedStore}_ST_Optimization_NegativeExact_${targetList.length}Terms.xlsx`;
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
    } catch (err: any) {
      console.error(err);
      notify(err.message || "Lỗi khi xuất file Bulksheet Amazon.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Target list for modal and execution
  const modalCandidates = useMemo(() => {
    return selectedKeys.size > 0
      ? filteredCandidates.filter((c) => selectedKeys.has(c.key))
      : filteredCandidates;
  }, [filteredCandidates, selectedKeys]);

  const handleOpenAutoUploadModal = () => {
    if (modalCandidates.length === 0) {
      notify("Không có Search Term nào thỏa mãn để Auto Upload.", "error");
      return;
    }
    setAutoUploadError(null);
    setAutoUploadSuccessResult(null);
    setAutoUploadStep(0);
    setIsAutoUploadModalOpen(true);
  };

  const handleExecuteAutoUpload = async () => {
    if (modalCandidates.length === 0) {
      notify("Không có Search Term nào thỏa mãn để Auto Upload.", "error");
      return;
    }

    setIsAutoUploading(true);
    setAutoUploadError(null);
    setAutoUploadStep(1);

    try {
      const payload = {
        storeName: selectedStore,
        items: modalCandidates.map((c) => ({
          customerSearchTerm: c.customerSearchTerm,
          campaignName: c.campaignName,
          adGroupName: c.adGroupName,
          campaignId: c.campaignId,
          adGroupId: c.adGroupId,
          adType: c.adType,
          targetKeyword: c.targetKeyword,
          matchType: c.matchType,
          clicks: c.clicks,
          orders: c.orders,
          spend: c.spend,
        })),
      };

      const res = await fetch("/api/ppc/st-optimization/auto-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || `Lỗi Auto Upload (HTTP ${res.status})`);
      }

      setAutoUploadStep(2);
      setAutoUploadSuccessResult({
        jobId: json.jobId,
        fileName: json.fileName,
        actionCount: json.actionCount || modalCandidates.length,
        message: json.message,
      });

      notify(`Đã xếp hàng Auto Upload ${json.actionCount || modalCandidates.length} search term lên Mac mini!`, "success");
    } catch (err: any) {
      console.error("Auto upload ST optimization error:", err);
      setAutoUploadError(err.message || "Lỗi khi xếp hàng upload lên AdsPower.");
      setAutoUploadStep(0);
    } finally {
      setIsAutoUploading(false);
    }
  };

  // Poll live upload status from worker
  useEffect(() => {
    if (!autoUploadSuccessResult?.jobId) return;
    const jobId = autoUploadSuccessResult.jobId;

    let isMounted = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (isMounted && json.data?.log) {
          const l = json.data.log;
          setLiveUploadStatus({
            status: l.status,
            stage: l.stage,
            progressPct: l.progress_pct ?? l.progressPct,
            amazonUploadId: l.amazon_upload_id ?? l.amazonUploadId,
            resultSummary: l.result_summary ?? l.resultSummary,
            errorMessage: l.error_message ?? l.errorMessage,
          });
        }
      } catch {
        // ignore background poll error
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [autoUploadSuccessResult?.jobId]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Rule & Filter Control Bar */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Left: Rule Configuration Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Rule Badge: Orders = 0 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span>Orders = 0</span>
          </div>

          {/* User Requested: Ô nhỏ điều chỉnh ngưỡng Clicks (mặc định clicks > 20) */}
          <div className="flex items-center rounded-lg border border-rose-300 bg-rose-50/80 px-2 py-1 shadow-2xs">
            <label className="text-[11px] font-extrabold text-rose-900 mr-1.5 flex items-center gap-1">
              <SlidersHorizontal size={13} weight="bold" />
              <span>Clicks:</span>
            </label>
            <select
              value={clickOperator}
              onChange={(e) => {
                setClickOperator(e.target.value as ">" | ">=");
                setPage(1);
                setSelectedKeys(new Set());
              }}
              className="bg-white border border-rose-200 text-rose-900 font-black text-xs rounded px-1.5 py-0.5 outline-none cursor-pointer mr-1"
              title="Toán tử so sánh"
            >
              <option value="&gt;">&gt;</option>
              <option value="&gt;=">&ge;</option>
            </select>
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              value={clickThreshold}
              onChange={(e) => {
                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                setClickThreshold(val);
                setPage(1);
                setSelectedKeys(new Set());
              }}
              className="w-14 px-1.5 py-0.5 text-center font-black text-rose-800 bg-white border border-rose-300 rounded font-mono text-xs outline-none focus:ring-1 focus:ring-rose-500"
              title="Nhập số ngưỡng clicks (mặc định: 20)"
            />
          </div>

          {/* Quick Campaign Filter */}
          <div className="relative">
            <select
              value={campaignFilter}
              onChange={(e) => {
                setCampaignFilter(e.target.value);
                setPage(1);
                setSelectedKeys(new Set());
              }}
              className="py-1.5 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 outline-none cursor-pointer max-w-[240px] truncate"
            >
              <option value="ALL">Tất cả Source Campaign ({candidateCampaigns.length})</option>
              {candidateCampaigns.map((camp) => (
                <option key={camp} value={camp}>
                  {camp}
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
                setSelectedKeys(new Set());
              }}
              placeholder="Lọc từ khóa, campaign..."
              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-rose-500"
            />
          </div>
        </div>

        {/* Right: Action Buttons */}
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={handleCopySelectedOrAll}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            title="Copy danh sách từ khóa"
          >
            <Copy size={13} />
            <span>{selectedKeys.size > 0 ? `Copy (${selectedKeys.size})` : "Copy Tất Cả"}</span>
          </button>

          {/* Export Bulksheet Button */}
          <button
            type="button"
            onClick={handleExportBulksheet}
            disabled={isExporting || filteredCandidates.length === 0}
            className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
            title="Xuất file Excel Bulksheet format chuẩn của Amazon Bulk Operations"
          >
            {isExporting ? (
              <>
                <CircleNotch size={14} className="animate-spin text-rose-600" />
                <span>Đang xuất...</span>
              </>
            ) : (
              <>
                <FileXls size={15} weight="bold" className="text-emerald-600" />
                <span>Xuất Bulksheet ({selectedKeys.size > 0 ? selectedKeys.size : filteredCandidates.length})</span>
              </>
            )}
          </button>

          {/* Auto Upload AdsPower Button */}
          <button
            type="button"
            onClick={handleOpenAutoUploadModal}
            disabled={filteredCandidates.length === 0}
            className="px-4 py-1.5 rounded-lg bg-linear-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title="Tự động xếp hàng upload phủ định lên Amazon Ads thông qua AdsPower trên Mac mini"
          >
            <Lightning size={15} weight="fill" className="text-amber-300 animate-pulse" />
            <span>
              ⚡ Auto Upload AdsPower ({selectedKeys.size > 0 ? selectedKeys.size : filteredCandidates.length})
            </span>
          </button>
        </div>
      </div>

      {/* 3. Summary Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 block uppercase">Search Terms vi phạm</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-black text-rose-700 font-mono">
              {summaryMetrics.totalTerms.toLocaleString("vi-VN")}
            </span>
            <span className="text-xs text-slate-500 font-semibold">từ</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Clicks {clickOperator} {clickThreshold} &amp; 0 đơn
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 block uppercase">Tổng Clicks lãng phí</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-black text-orange-600 font-mono">
              {summaryMetrics.totalClicks.toLocaleString("vi-VN")}
            </span>
            <span className="text-xs text-slate-500 font-semibold">clicks</span>
          </div>
          <span className="text-[10px] text-rose-600 font-semibold block mt-0.5">
            100% không chuyển đổi
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 block uppercase">Tiền lãng phí (Cắt lỗ)</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-black text-rose-600 font-mono">
              ${summaryMetrics.totalSpend.toFixed(2)}
            </span>
          </div>
          <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">
            Tiết kiệm khi phủ định
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 block uppercase">Source Campaign</span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-xl font-black text-indigo-700 font-mono">
              {summaryMetrics.affectedCampaigns}
            </span>
            <span className="text-xs text-slate-500 font-semibold">chiến dịch</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-0.5">
            Phủ định riêng từng camp
          </span>
        </div>
      </div>

      {/* 4. Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
        <table className="w-full text-left text-xs text-slate-700 border-collapse min-w-[1000px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
            <tr>
              <th className="p-3 w-8 text-center">
                <input
                  type="checkbox"
                  checked={
                    paginatedCandidates.length > 0 &&
                    paginatedCandidates.every((c) => selectedKeys.has(c.key))
                  }
                  onChange={handleToggleSelectAll}
                  className="rounded border-slate-300 accent-rose-600 cursor-pointer"
                />
              </th>
              <th
                className="py-3 px-3 cursor-pointer hover:text-rose-600"
                onClick={() => handleSort("customerSearchTerm")}
              >
                Customer Search Term {sortField === "customerSearchTerm" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th className="py-3 px-3 min-w-[140px]">Target Nguồn</th>
              <th
                className="py-3 px-3 cursor-pointer hover:text-rose-600 min-w-[220px]"
                onClick={() => handleSort("campaignName")}
              >
                Campaign {sortField === "campaignName" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-rose-600"
                onClick={() => handleSort("clicks")}
              >
                Clicks {sortField === "clicks" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th className="py-3 px-3 text-right">Orders</th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-rose-600"
                onClick={() => handleSort("spend")}
              >
                Spend ($) {sortField === "spend" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="py-3 px-3 text-right cursor-pointer hover:text-rose-600"
                onClick={() => handleSort("cpc")}
              >
                CPC ($) {sortField === "cpc" && (sortDir === "asc" ? "↑" : "↓")}
              </th>
              <th className="py-3 px-3 text-center whitespace-nowrap">Hành Động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <CircleNotch size={24} className="animate-spin text-rose-600" />
                    <span>Đang tải và tổng hợp dữ liệu Search Terms...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedCandidates.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500">
                  <div className="max-w-md mx-auto space-y-2">
                    <CheckCircle size={32} className="mx-auto text-emerald-500" />
                    <p className="font-bold text-slate-700">Tuyệt vời! Không có search term nào vượt ngưỡng đốt tiền.</p>
                    <p className="text-xs text-slate-400">
                      Không tìm thấy search term nào có Clicks {clickOperator} {clickThreshold} mà 0 đơn hàng trong khung thời gian hiện tại.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedCandidates.map((c) => {
                const isSelected = selectedKeys.has(c.key);
                const isCopied = copiedKey === c.key;
                const isProduct =
                  c.customerSearchTerm.toLowerCase().startsWith("b0") ||
                  c.customerSearchTerm.toLowerCase().startsWith("asin=");

                return (
                  <tr
                    key={c.key}
                    className={`hover:bg-slate-50/80 transition ${
                      isSelected ? "bg-rose-50/40" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleRow(c.key)}
                        className="rounded border-slate-300 accent-rose-600 cursor-pointer"
                      />
                    </td>

                    {/* Customer Search Term */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 group">
                        <span className="font-bold text-slate-900 font-mono text-[11px] max-w-[260px] truncate" title={c.customerSearchTerm}>
                          {c.customerSearchTerm}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopySingle(c.customerSearchTerm, c.key)}
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition cursor-pointer p-0.5"
                          title="Copy từ khóa này"
                        >
                          {isCopied ? <CheckCircle size={13} className="text-emerald-600" /> : <Copy size={13} />}
                        </button>
                      </div>
                      {isProduct && (
                        <span className="inline-block mt-0.5 text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1">
                          ASIN / Product
                        </span>
                      )}
                    </td>

                    {/* Target Keyword & Match Type */}
                    <td className="py-2.5 px-3">
                      <div className="text-slate-800 font-medium truncate max-w-[180px]" title={c.targetKeyword}>
                        {c.targetKeyword || "—"}
                      </div>
                      <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        {c.matchType}
                      </span>
                    </td>

                    {/* Source Campaign */}
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900 truncate max-w-[320px]" title={c.campaignName}>
                        {c.campaignName}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{c.adType}</span>
                    </td>

                    {/* Clicks */}
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-black text-rose-700 font-mono bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                        {c.clicks.toLocaleString("vi-VN")}
                      </span>
                    </td>

                    {/* Orders */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-400">
                      0
                    </td>

                    {/* Spend */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      ${c.spend.toFixed(2)}
                    </td>

                    {/* CPC */}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                      ${c.cpc.toFixed(2)}
                    </td>

                    {/* Action Tag */}
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black border border-rose-200">
                        <Prohibit size={11} weight="bold" />
                        <span>Negative Exact</span>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 5. Pagination Component */}
      <PpcPagination
        currentPage={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredCandidates.length}
        itemName="search term vi phạm"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {/* 6. Auto Upload AdsPower Confirmation & Execution Modal */}
      {isAutoUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                  <Lightning size={18} weight="fill" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Auto Upload Phủ Định (Negative Exact) lên Amazon Ads
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Máy Mac mini (AdsPower) sẽ tự động nạp file Bulksheet lên Amazon Campaign Manager
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isAutoUploading) setIsAutoUploadModalOpen(false);
                }}
                disabled={isAutoUploading}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer disabled:opacity-40"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {autoUploadStep === 2 && autoUploadSuccessResult ? (
                /* Live Progress & Real Results View */
                <div className="py-1 space-y-3.5">
                  {/* Real-time Status Card */}
                  {liveUploadStatus?.status === "SUCCESS" ? (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-xl">
                        <CheckCircle size={32} weight="fill" />
                      </div>
                      <h4 className="text-sm font-black text-emerald-950 uppercase tracking-wide">
                        AMAZON ADS ĐÃ XỬ LÝ HOÀN TẤT THÀNH CÔNG!
                      </h4>
                      <p className="text-xs text-emerald-700 font-medium">
                        File Bulksheet đã được tải lên và Amazon xác nhận ghi nhận thầu phủ định.
                      </p>
                      {liveUploadStatus.amazonUploadId && (
                        <div className="inline-block px-3 py-1 rounded-md bg-white border border-emerald-300 font-mono text-xs text-emerald-800 font-black shadow-2xs">
                          Amazon Upload ID: {liveUploadStatus.amazonUploadId}
                        </div>
                      )}
                    </div>
                  ) : liveUploadStatus?.status === "FAILED" ? (
                    <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto text-xl">
                        <WarningCircle size={32} weight="fill" />
                      </div>
                      <h4 className="text-sm font-black text-rose-950 uppercase">
                        TẢI LÊN THẤT BẠI
                      </h4>
                      <p className="text-xs text-rose-700">
                        {liveUploadStatus.errorMessage || "Có lỗi xảy ra trong quá trình AdsPower upload lên Amazon."}
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 text-center space-y-2">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto text-lg animate-spin">
                        <CircleNotch size={24} />
                      </div>
                      <h4 className="text-sm font-black text-indigo-950">
                        {liveUploadStatus?.stage === "UPLOADING"
                          ? "🚀 AdsPower Đang Mở Trình Duyệt & Tải Lên Amazon Ads..."
                          : liveUploadStatus?.stage === "WAITING_RESULT"
                          ? "⏳ Amazon Đang Đối Soát & Phê Duyệt File Bulksheet..."
                          : liveUploadStatus?.stage === "CLAIMED" || liveUploadStatus?.stage === "DOWNLOADING"
                          ? "📥 Mac mini Đã Nhận Lệnh, Đang Tải File Từ R2..."
                          : "⏳ Đã Xếp Hàng — Chờ Worker Mac mini Nhận Việc..."}
                      </h4>
                      <p className="text-[11px] text-indigo-700 font-medium">
                        Tiến trình upload đang thực thi thật 100% qua profile AdsPower trên Mac mini.
                      </p>
                    </div>
                  )}

                  {/* Task details table */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5 font-mono text-slate-700">
                    <div className="flex justify-between items-center pb-1.5 border-b border-slate-200">
                      <span className="text-slate-500 font-sans font-bold">Store:</span>
                      <span className="font-extrabold text-slate-900 font-sans">{selectedStore}</span>
                    </div>
                    <div className="flex justify-between items-center pb-1.5 border-b border-slate-200">
                      <span className="text-slate-500 font-sans font-bold">Số lượng:</span>
                      <span className="font-extrabold text-rose-600 font-sans">{autoUploadSuccessResult.actionCount} từ khóa (Negative Exact)</span>
                    </div>
                    <div className="flex justify-between items-center pb-1.5 border-b border-slate-200">
                      <span className="text-slate-500 font-sans font-bold">File Bulksheet:</span>
                      <span className="font-bold text-slate-800 truncate max-w-[280px]">{autoUploadSuccessResult.fileName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-sans font-bold">Trạng thái:</span>
                      <span className={`px-2 py-0.5 rounded font-black text-[11px] font-sans ${
                        liveUploadStatus?.status === "SUCCESS" ? "bg-emerald-100 text-emerald-800" :
                        liveUploadStatus?.status === "FAILED" ? "bg-rose-100 text-rose-800" :
                        "bg-amber-100 text-amber-800"
                      }`}>
                        {liveUploadStatus?.status || "PENDING"} ({liveUploadStatus?.stage || "FILE_READY"})
                      </span>
                    </div>
                  </div>

                  {/* Telegram Notification note */}
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-950 text-xs flex items-start gap-2.5">
                    <div className="text-base shrink-0 mt-0.5">📱</div>
                    <div className="text-[11px] leading-relaxed">
                      <b className="text-sky-900">Báo cáo Telegram tự động:</b> Khi Mac mini hoàn tất upload và nhận kết quả từ Amazon Ads, bot Telegram sẽ <b>tự động nổ tin nhắn thông báo</b> kèm tên file và kết quả chi tiết. Bạn có thể bấm <b>Đóng</b> ngay lúc này, tác vụ vẫn chạy ngầm trên Mac mini!
                    </div>
                  </div>
                </div>
              ) : (
                /* Confirmation View */
                <>
                  {autoUploadError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                      <WarningCircle size={16} weight="fill" className="shrink-0 text-rose-600" />
                      <span>{autoUploadError}</span>
                    </div>
                  )}

                  {/* Summary Metric Cards in Modal */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-center">
                      <span className="text-[10px] font-bold text-slate-400 block uppercase">Store mục tiêu</span>
                      <span className="text-xs font-black text-slate-800 truncate block mt-0.5">
                        {selectedStore || "Tất cả"}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl border border-rose-200 bg-rose-50/50 text-center">
                      <span className="text-[10px] font-bold text-rose-500 block uppercase">Số Search Term</span>
                      <span className="text-sm font-black text-rose-700 font-mono block mt-0.5">
                        {modalCandidates.length} từ
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 text-center">
                      <span className="text-[10px] font-bold text-emerald-600 block uppercase">Tiết kiệm ước tính</span>
                      <span className="text-sm font-black text-emerald-700 font-mono block mt-0.5">
                        ${modalCandidates.reduce((s, c) => s + c.spend, 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Safety & Logic Notice */}
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <ShieldWarning size={15} weight="fill" className="text-amber-600 shrink-0" />
                      <span>Cơ chế an toàn: Phủ định chỉ trong Source Campaign</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed pl-5">
                      Hệ thống tự động tra cứu chính xác Campaign ID &amp; Ad Group ID của từng từ khóa, tạo chỉ thị <b>Negative Exact</b> duy nhất trong chiến dịch nguồn đó, hoàn toàn không ảnh hưởng đến các chiến dịch khác.
                    </p>
                  </div>

                  {/* Search terms preview list */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-700 block">
                      Danh sách từ khóa sẽ phủ định ({modalCandidates.length}):
                    </span>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs bg-slate-50/50">
                      {modalCandidates.map((c, i) => (
                        <div key={c.key} className="p-2.5 flex items-center justify-between gap-3 hover:bg-white transition">
                          <div className="min-w-0 flex-1">
                            <span className="font-extrabold text-slate-900 block truncate font-mono text-[11px]">
                              {i + 1}. {c.customerSearchTerm}
                            </span>
                            <span className="text-[10px] text-slate-400 block truncate">
                              Chiến dịch: {c.campaignName}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-rose-700 font-black font-mono text-[11px] block">
                              {c.clicks} clicks / 0 đơn
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              lãng phí ${c.spend.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Progress when uploading */}
                  {isAutoUploading && (
                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center gap-2.5 text-xs text-indigo-900">
                      <CircleNotch size={18} className="animate-spin text-indigo-600 shrink-0" />
                      <div>
                        <span className="font-bold block">Đang tạo file Bulksheet &amp; đẩy lên hàng đợi...</span>
                        <span className="text-[10px] text-indigo-600">File sẽ được lưu vào Cloudflare R2 và kích hoạt worker AdsPower.</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2">
              {autoUploadStep === 2 ? (
                <button
                  type="button"
                  onClick={() => setIsAutoUploadModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition cursor-pointer"
                >
                  Đóng
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsAutoUploadModalOpen(false)}
                    disabled={isAutoUploading}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-40"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteAutoUpload}
                    disabled={isAutoUploading || modalCandidates.length === 0}
                    className="px-4 py-2 rounded-xl bg-linear-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white text-xs font-black transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isAutoUploading ? (
                      <>
                        <CircleNotch size={14} className="animate-spin" />
                        <span>Đang xử lý...</span>
                      </>
                    ) : (
                      <>
                        <Lightning size={14} weight="fill" className="text-amber-300" />
                        <span>Xác Nhận &amp; Đẩy Lên Amazon ({modalCandidates.length} từ)</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
