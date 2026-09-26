"use client";

import { useState, useMemo } from "react";
import {
  MagnifyingGlass,
  Copy,
  Trash,
  ArrowsClockwise,
  Check,
  ShieldCheck,
  CircleNotch,
  WarningCircle,
  FileXls,
} from "@phosphor-icons/react";
import { PpcPagination } from "./ppc-pagination";

export interface NegativeRegistryItem {
  id: string;
  store_id: string;
  store_name: string;
  ad_type: string;
  campaign_id: string | null;
  campaign_name: string;
  ad_group_id: string | null;
  ad_group_name: string | null;
  keyword_text: string;
  match_type: string;
  level: string;
  state: string;
  source: string;
  source_job_id: string | null;
  clicks: number;
  spend: number;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

interface PpcNegativeHubViewProps {
  selectedStore: string;
  items: NegativeRegistryItem[];
  summary: {
    totalNegatives: number;
    totalCampaigns: number;
    totalSpendPrevented: number;
  };
  loading: boolean;
  onRefresh: () => void;
  notify: (message: string, type?: "success" | "error") => void;
}

export function PpcNegativeHubView({
  selectedStore,
  items,
  summary,
  loading,
  onRefresh,
  notify,
}: PpcNegativeHubViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [adTypeFilter, setAdTypeFilter] = useState<"ALL" | "SP" | "SB">("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<NegativeRegistryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filtered items
  const filteredItems = useMemo(() => {
    let list = [...items];

    if (adTypeFilter !== "ALL") {
      list = list.filter((it) => (it.ad_type || "SP").toUpperCase() === adTypeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (it) =>
          it.keyword_text.toLowerCase().includes(q) ||
          it.campaign_name.toLowerCase().includes(q) ||
          (it.ad_group_name && it.ad_group_name.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [items, adTypeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(null), 1500);
      notify(`Đã copy: "${text}"`, "success");
    } catch {
      notify("Không thể copy từ khóa", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/ppc/negative-keywords?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || "Lỗi khi xóa từ khóa.");
      }
      notify(`Đã xóa "${deleteTarget.keyword_text}" khỏi Negative Hub.`, "success");
      setDeleteTarget(null);
      onRefresh();
    } catch (err: any) {
      notify(err.message || "Lỗi khi xóa từ khóa", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Summary Metric Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
            <ShieldCheck size={22} weight="bold" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">
              Tổng số từ đã phủ định
            </span>
            <span className="text-xl font-black text-slate-900 font-mono">
              {summary.totalNegatives} <span className="text-xs text-slate-500 font-normal">từ khóa</span>
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
            <span className="text-lg font-black">🎯</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">
              Chiến dịch được bảo vệ
            </span>
            <span className="text-xl font-black text-slate-900 font-mono">
              {summary.totalCampaigns} <span className="text-xs text-slate-500 font-normal">campaigns</span>
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
            <span className="text-lg font-black">💰</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-400 block uppercase">
              Chi phí lãng phí đã chặn
            </span>
            <span className="text-xl font-black text-emerald-700 font-mono">
              ${Number(summary.totalSpendPrevented || 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Filter & Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Ad Type Filter */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setAdTypeFilter("ALL");
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                adTypeFilter === "ALL" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => {
                setAdTypeFilter("SP");
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                adTypeFilter === "SP" ? "bg-emerald-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              SP (Products)
            </button>
            <button
              type="button"
              onClick={() => {
                setAdTypeFilter("SB");
                setPage(1);
              }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                adTypeFilter === "SB" ? "bg-purple-600 text-white shadow-xs" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              SB (Brands)
            </button>
          </div>

          {/* Search box */}
          <div className="relative min-w-[220px]">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo từ khóa, chiến dịch..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            title="Tải lại danh sách"
          >
            <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
            <span>Làm Mới</span>
          </button>
        </div>
      </div>

      {/* 3. Negative Keywords Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-3 w-12 text-center">STT</th>
                <th className="py-2.5 px-3 w-16">Loại</th>
                <th className="py-2.5 px-3">Từ Khóa / ASIN Phủ Định</th>
                <th className="py-2.5 px-3 w-28">Match Type</th>
                <th className="py-2.5 px-3">Chiến Dịch &amp; Nhóm</th>
                <th className="py-2.5 px-3 w-24 text-right">Clicks / Spend</th>
                <th className="py-2.5 px-3 w-32">Nguồn &amp; Cấp độ</th>
                <th className="py-2.5 px-3 w-24">Ngày Phủ Định</th>
                <th className="py-2.5 px-3 w-14 text-center">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <CircleNotch size={24} className="animate-spin mx-auto text-indigo-600 mb-2" />
                    <span>Đang tải danh sách Negative Registry...</span>
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <ShieldCheck size={36} className="mx-auto text-slate-300 mb-2" />
                    <span className="font-semibold block text-slate-600">
                      Chưa có từ khóa nào trong Negative Hub của shop này.
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Khi bạn Auto Upload phủ định Search Term, từ khóa sẽ tự động được lưu vào đây.
                    </span>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, index) => {
                  const globalIdx = (page - 1) * pageSize + index + 1;
                  const isCopied = copiedKey === item.id;
                  const isASIN =
                    item.keyword_text.toLowerCase().startsWith("b0") ||
                    item.keyword_text.toLowerCase().startsWith("asin=");

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {globalIdx}
                      </td>

                      {/* Ad Type */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            item.ad_type === "SB"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {item.ad_type || "SP"}
                        </span>
                      </td>

                      {/* Keyword Text */}
                      <td className="py-2.5 px-3 font-medium">
                        <div className="flex items-center gap-1.5 group">
                          <span
                            className={`font-mono text-xs font-bold select-all ${
                              isASIN ? "text-amber-800" : "text-slate-900"
                            }`}
                          >
                            {item.keyword_text}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(item.keyword_text, item.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 transition cursor-pointer p-0.5"
                            title="Copy từ khóa"
                          >
                            {isCopied ? (
                              <Check size={12} className="text-emerald-600" weight="bold" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        {item.reason && (
                          <span className="text-[10px] text-slate-400 block truncate max-w-sm" title={item.reason}>
                            {item.reason}
                          </span>
                        )}
                      </td>

                      {/* Match Type */}
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          {item.match_type || "negativeExact"}
                        </span>
                      </td>

                      {/* Campaign & Ad Group */}
                      <td className="py-2.5 px-3">
                        <span
                          className="font-semibold text-slate-800 block truncate max-w-[260px]"
                          title={item.campaign_name}
                        >
                          {item.campaign_name}
                        </span>
                        {item.ad_group_name && item.ad_group_name !== item.campaign_name && (
                          <span
                            className="text-[10px] text-slate-400 block truncate max-w-[260px]"
                            title={item.ad_group_name}
                          >
                            {item.ad_group_name}
                          </span>
                        )}
                      </td>

                      {/* Clicks / Spend */}
                      <td className="py-2.5 px-3 text-right font-mono">
                        <span className="text-rose-700 font-bold block text-[11px]">
                          {item.clicks || 0} clk
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          ${Number(item.spend || 0).toFixed(2)}
                        </span>
                      </td>

                      {/* Source & Level */}
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-100 text-slate-600 w-fit">
                            {item.level === "CAMPAIGN" ? "Campaign Level" : "Ad Group Level"}
                          </span>
                          <span className="text-[9px] text-indigo-600 font-semibold block">
                            {item.source === "AUTO_UPLOAD" ? "⚡ Auto Upload" : "Amazon Bulksheet"}
                          </span>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-2.5 px-3 text-[11px] text-slate-500 whitespace-nowrap">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleDateString("vi-VN", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : "--"}
                      </td>

                      {/* Action: Delete */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                          title="Xóa khỏi Negative Hub"
                        >
                          <Trash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && filteredItems.length > pageSize && (
          <div className="p-3 border-t border-slate-200 bg-slate-50/50">
            <PpcPagination
              currentPage={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                <WarningCircle size={20} weight="fill" />
                <span>Xác nhận xóa khỏi Negative Hub</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bạn có chắc chắn muốn xóa từ khóa{" "}
                <b className="font-mono text-slate-900 font-extrabold">&quot;{deleteTarget.keyword_text}&quot;</b> khỏi
                danh sách Negative Hub của chiến dịch <b className="text-slate-900">&quot;{deleteTarget.campaign_name}&quot;</b> không?
              </p>
              <p className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                Lưu ý: Thao tác này chỉ xóa bản ghi lưu vết trên hệ thống để từ khóa có thể xuất hiện lại trong đề xuất nếu tiếp tục phát sinh click không chuyển đổi.
              </p>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isDeleting ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}
                <span>Xác Nhận Xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
