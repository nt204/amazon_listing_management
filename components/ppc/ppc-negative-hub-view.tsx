"use client";

// Negative Hub: phủ định ĐÃ lên Amazon, gom theo từng lô (job Auto Upload / lô Xuất File đã tick "Đã upload").
// Lô mới xuất file chưa xác nhận và lô đang Auto Upload nằm ở tab Negative List.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlass,
  Trash,
  ArrowsClockwise,
  ShieldCheck,
  CircleNotch,
  WarningCircle,
  CaretRight,
  CloudArrowUp,
  FileXls,
  Stack,
} from "@phosphor-icons/react";
import { PpcCopyButton } from "./ppc-copy-button";

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

interface NegativeBatch {
  batchKey: string;
  jobId: string | null;
  storeName: string;
  source: string;
  method: "AUTO_UPLOAD" | "EXPORT_CONFIRMED" | "EXPORT" | "OTHER";
  matchTypes: string[];
  adTypes: string[];
  levels: string[];
  rowCount: number;
  keywordCount: number;
  campaignCount: number;
  spend: number;
  keywords: string[];
  createdAt: string;
  fileName: string | null;
  createdBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

interface BatchDetail {
  keywords: Array<{ keyword: string; campaigns: number; clicks: number; spend: number }>;
  campaigns: Array<{ campaignName: string; adGroupName: string | null; adType: string; keywords: number }>;
}

interface HubSummary {
  totalNegatives: number;
  totalCampaigns: number;
  totalSpendPrevented: number;
  totalBatches: number;
}

interface PpcNegativeHubViewProps {
  selectedStore: string;
  /** Kênh FBA / FBM của store chia kênh (FASTPEACE) — chỉ hiện phủ định của campaign thuộc kênh này. */
  channel?: "FBA" | "FBM" | null;
  notify: (message: string, type?: "success" | "error") => void;
  /** Gọi sau khi xoá lô để màn cha cập nhật số đếm. */
  onChanged?: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  NEGATIVE_LIST: "Negative List",
  AUTO_UPLOAD: "Đề xuất phủ định ST",
  MANUAL_EXPORT: "Đề xuất phủ định ST",
};

const MATCH_LABEL: Record<string, string> = {
  negativePhrase: "Negative Phrase",
  negativeExact: "Negative Exact",
};

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtDateTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })
    : "--";

function MethodBadge({ method }: { method: NegativeBatch["method"] }) {
  if (method === "AUTO_UPLOAD") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold whitespace-nowrap">
        <CloudArrowUp size={12} weight="bold" /> Auto Upload
      </span>
    );
  }
  if (method === "EXPORT_CONFIRMED" || method === "EXPORT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold whitespace-nowrap">
        <FileXls size={12} weight="bold" /> Xuất file · upload tay
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold whitespace-nowrap">
      Khác
    </span>
  );
}

export function PpcNegativeHubView({ selectedStore, channel = null, notify, onChanged }: PpcNegativeHubViewProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [adTypeFilter, setAdTypeFilter] = useState<"ALL" | "SP" | "SB">("ALL");
  const [batches, setBatches] = useState<NegativeBatch[]>([]);
  const [summary, setSummary] = useState<HubSummary>({ totalNegatives: 0, totalCampaigns: 0, totalSpendPrevented: 0, totalBatches: 0 });
  // Đang tải = bộ lọc hiện tại chưa có kết quả (không setState đồng bộ trong effect)
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, BatchDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<NegativeBatch | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Gõ tìm kiếm → đợi 400ms mới gọi API
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = useMemo(() => {
    const params = new URLSearchParams({ view: "batches" });
    if (selectedStore && selectedStore !== "ALL") params.set("storeName", selectedStore);
    if (channel) params.set("channel", channel);
    if (adTypeFilter !== "ALL") params.set("adType", adTypeFilter);
    if (search) params.set("search", search);
    return params.toString();
  }, [selectedStore, channel, adTypeFilter, search]);
  const loading = refreshing || loadedFor !== queryKey;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/ppc/negative-keywords?${queryKey}`, { signal, cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${res.status}`);
        setBatches(json.data.batches || []);
        setSummary(json.data.summary);
        setDetails({});
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Không tải được Negative Hub.");
      } finally {
        if (!signal?.aborted) {
          setLoadedFor(queryKey);
          setRefreshing(false);
        }
      }
    },
    [queryKey],
  );

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  useEffect(() => {
    const ctrl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState chỉ chạy sau khi fetch xong
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const toggleOpen = async (b: NegativeBatch) => {
    if (openKey === b.batchKey) {
      setOpenKey(null);
      return;
    }
    setOpenKey(b.batchKey);
    if (details[b.batchKey]) return;
    setLoadingDetail(b.batchKey);
    try {
      const params = new URLSearchParams({ view: "batch", batchKey: b.batchKey, storeName: b.storeName });
      if (channel) params.set("channel", channel);
      const res = await fetch(`/api/ppc/negative-keywords?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setDetails((prev) => ({ ...prev, [b.batchKey]: json.data }));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Không tải được chi tiết lô.", "error");
    } finally {
      setLoadingDetail(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const params = new URLSearchParams({ batchKey: deleteTarget.batchKey, storeName: deleteTarget.storeName });
      if (channel) params.set("channel", channel);
      const res = await fetch(`/api/ppc/negative-keywords?${params}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || "Lỗi khi xoá lô.");
      notify(json.message || "Đã xoá lô khỏi Negative Hub.", "success");
      setDeleteTarget(null);
      setOpenKey(null);
      refresh();
      onChanged?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xoá lô.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  const showStore = !selectedStore || selectedStore === "ALL";

  return (
    <div className="space-y-4">
      {/* 1. Tổng quan */}
      <div data-tour="neg-hub-summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
            <ShieldCheck size={22} weight="bold" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 block uppercase">Tổng dòng phủ định</span>
            <span className="text-xl font-black text-slate-900 font-mono">{fmtNum(summary.totalNegatives)}</span>
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
            <Stack size={22} weight="bold" />
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 block uppercase">Số lô (job)</span>
            <span className="text-xl font-black text-slate-900 font-mono">{fmtNum(summary.totalBatches)}</span>
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
            <span className="text-lg font-black">🎯</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 block uppercase">Chiến dịch được bảo vệ</span>
            <span className="text-xl font-black text-slate-900 font-mono">{fmtNum(summary.totalCampaigns)}</span>
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
            <span className="text-lg font-black">💰</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-slate-500 block uppercase">Chi phí lãng phí đã chặn</span>
            <span className="text-xl font-black text-emerald-700 font-mono">${Number(summary.totalSpendPrevented || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* 2. Bộ lọc */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold">
            {(["ALL", "SP", "SB"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAdTypeFilter(t)}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${adTypeFilter === t ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                  }`}
              >
                {t === "ALL" ? "Tất cả" : t === "SP" ? "SP (Products)" : "SB (Brands)"}
              </button>
            ))}
          </div>
          <div className="relative min-w-[240px]">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm lô chứa từ khoá / chiến dịch..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
        >
          <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
          <span>Làm Mới</span>
        </button>
      </div>

      {/* 3. Danh sách lô — mỗi lô 1 dòng, thông tin chia cột */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {loading && batches.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            <CircleNotch size={24} className="animate-spin mx-auto text-indigo-600 mb-2" />
            Đang tải Negative Hub...
          </div>
        ) : error ? (
          <div className="py-10 text-center text-rose-700 text-xs font-semibold">
            <WarningCircle size={24} className="mx-auto mb-2" />
            {error}
          </div>
        ) : batches.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            <ShieldCheck size={36} className="mx-auto text-slate-300 mb-2" />
            <span className="font-semibold block text-slate-600">
              {search ? "Không có lô nào chứa từ khoá / chiến dịch này." : "Chưa có lô phủ định nào trong Negative Hub."}
            </span>
            <span className="text-[11px]">
              Lô Auto Upload chạy xong, hoặc lô Xuất File đã tick “Đã upload” sẽ hiện ở đây.
            </span>
          </div>
        ) : (
          <div data-tour="neg-hub-table" className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="py-2.5 pl-4 pr-2 w-8"></th>
                  <th className="py-2.5 px-2 text-left whitespace-nowrap">Cách đưa lên</th>
                  <th className="py-2.5 px-2 text-left whitespace-nowrap">Nguồn</th>
                  <th className="py-2.5 px-2 text-left whitespace-nowrap">Kiểu</th>
                  {showStore && <th className="py-2.5 px-2 text-left">Store</th>}
                  <th className="py-2.5 px-2 text-left">File / Lô</th>
                  <th className="py-2.5 px-2 text-left whitespace-nowrap">Thời gian</th>
                  <th className="py-2.5 px-2 text-left whitespace-nowrap">Người làm</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Keyword</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Campaign</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Dòng</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">Đã chặn</th>
                  <th className="py-2.5 pl-2 pr-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => {
                  const open = openKey === b.batchKey;
                  const detail = details[b.batchKey];
                  const colCount = showStore ? 13 : 12;
                  return (
                    <Fragment key={b.batchKey}>
                      <tr onClick={() => void toggleOpen(b)} className={`cursor-pointer ${open ? "bg-slate-50" : "hover:bg-slate-50"}`}>
                        <td className="py-2.5 pl-4 pr-2">
                          <CaretRight size={12} weight="bold" className={`text-slate-500 transition-transform ${open ? "rotate-90" : ""}`} />
                        </td>
                        <td className="py-2.5 px-2">
                          <MethodBadge method={b.method} />
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap font-bold text-indigo-700">{SOURCE_LABEL[b.source] || b.source}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex flex-col gap-1">
                            {b.matchTypes.map((m) => (
                              <span key={m} className="w-fit px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                                {MATCH_LABEL[m] || m}
                              </span>
                            ))}
                          </div>
                        </td>
                        {showStore && <td className="py-2.5 px-2 font-black text-slate-700 whitespace-nowrap">{b.storeName}</td>}
                        <td className="py-2.5 px-2 min-w-[200px]">
                          <span className="font-semibold text-slate-800 break-all">{b.fileName || "—"}</span>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap text-slate-700">
                          {fmtDateTime(b.createdAt)}
                          {b.confirmedAt && (
                            <span className="block text-[10px] text-emerald-700">✓ xác nhận {fmtDateTime(b.confirmedAt)}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap text-slate-700">
                          {b.createdBy || "—"}
                          {b.confirmedBy && b.confirmedBy !== b.createdBy && (
                            <span className="block text-[10px] text-emerald-700">✓ {b.confirmedBy}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-bold text-orange-600">{fmtNum(b.keywordCount)}</td>
                        <td className="py-2.5 px-2 text-right font-mono font-bold text-indigo-600">{fmtNum(b.campaignCount)}</td>
                        <td className="py-2.5 px-2 text-right font-mono font-black text-slate-900">{fmtNum(b.rowCount)}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-emerald-700 whitespace-nowrap">
                          {b.spend > 0 ? `$${b.spend.toFixed(2)}` : "—"}
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <button
                            type="button"
                            data-tour="neg-hub-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(b);
                            }}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="Xoá cả lô khỏi Negative Hub"
                          >
                            <Trash size={15} />
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50">
                          <td colSpan={colCount} className="px-4 pb-4 pt-1 pl-10">
                            {loadingDetail === b.batchKey || !detail ? (
                              <div className="py-6 text-center text-xs text-slate-500">
                                <CircleNotch size={18} className="animate-spin mx-auto mb-1 text-indigo-600" />
                                Đang tải chi tiết lô...
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,340px)_1fr] gap-3">
                                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                  <div className="px-3 py-2 border-b border-slate-200 bg-amber-50 text-xs font-black text-slate-800 flex items-center justify-between">
                                    <span>Keyword ({fmtNum(detail.keywords.length)})</span>
                                    <PpcCopyButton value={detail.keywords.map((k) => k.keyword).join("\n")} label="danh sách keyword" />
                                  </div>
                                  <div className="max-h-[360px] overflow-auto divide-y divide-slate-50">
                                    {detail.keywords.map((k) => (
                                      <div key={k.keyword} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                        <span className="font-mono font-semibold text-slate-900 break-all">{k.keyword}</span>
                                        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
                                          {fmtNum(k.campaigns)} camp{k.spend > 0 ? ` · $${k.spend.toFixed(2)}` : ""}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                  <div className="px-3 py-2 border-b border-slate-200 bg-indigo-50 text-xs font-black text-slate-800">
                                    Campaign ({fmtNum(detail.campaigns.length)})
                                  </div>
                                  <div className="max-h-[360px] overflow-auto divide-y divide-slate-50">
                                    {detail.campaigns.map((c) => (
                                      <div key={c.campaignName} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-black shrink-0">{c.adType}</span>
                                        <span className="font-semibold text-slate-800 break-words flex-1 min-w-0">{c.campaignName}</span>
                                        <PpcCopyButton value={c.campaignName} label="campaign" />
                                        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">{fmtNum(c.keywords)} kw</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
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
        )}
      </div>

      {/* Xác nhận xoá lô */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                <WarningCircle size={20} weight="fill" />
                <span>Xoá lô khỏi Negative Hub</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Xoá <b className="text-rose-600">{fmtNum(deleteTarget.rowCount)} dòng</b> ({fmtNum(deleteTarget.keywordCount)} keyword ×{" "}
                {fmtNum(deleteTarget.campaignCount)} campaign) của lô{" "}
                <b className="text-slate-900 break-all">{deleteTarget.fileName || fmtDateTime(deleteTarget.createdAt)}</b>?
              </p>
              <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                Chỉ xoá bản ghi lưu vết trên hệ thống (để có thể phủ định lại các cặp này). Phủ định đang chạy trên Amazon không bị gỡ.
              </p>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isDeleting ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}
                <span>Xoá lô</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
