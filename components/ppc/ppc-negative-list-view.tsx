"use client";

// Negative List: dán list keyword (VD cột "Negative Phrase KW" trong Google Sheet) → phủ định cho toàn bộ
// campaign của ASIN được chọn (Campaign Negative Keyword), xếp hàng Auto Upload lên Mac mini.
// Lô "Xuất File" chờ tick "Đã upload lên Amazon" mới sang Negative Hub; lô Auto Upload tự sang khi Mac mini chạy xong.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ListBullets,
  MagnifyingGlass,
  CircleNotch,
  CloudArrowUp,
  CheckCircle,
  WarningCircle,
  X,
  Info,
  Package,
  Trash,
  Plus,
  CaretRight,
  FileXls,
  CheckSquare,
} from "@phosphor-icons/react";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";

interface AsinCampaign {
  asin: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adType: string;
  campaignState: string;
  clicks: number;
  spend: number;
  orders: number;
}

interface PendingBatch {
  id: string;
  kind: "EXPORT" | "AUTO_UPLOAD";
  fileName: string;
  matchType: string;
  status: string;
  rowCount: number;
  keywordCount: number;
  campaignCount: number;
  keywords: string[];
  createdAt: string;
  createdBy: string | null;
}

interface AsinPick {
  asin: string;
  skus: string[];
  campaignCount: number;
  mockupUrl: string | null;
}

function Mockup({ url, size }: { url: string | null; size: number }) {
  const src = getOptimizedThumbnailUrl(url, size * 2) || url;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{ width: size, height: size }}
      className="rounded-lg object-cover bg-slate-100 border border-slate-300 shrink-0"
    />
  ) : (
    <div
      style={{ width: size, height: size }}
      className="rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-300 shrink-0"
    >
      <Package size={Math.round(size / 2)} weight="duotone" />
    </div>
  );
}

interface PpcNegativeListViewProps {
  selectedStore: string;
  /** Kênh FBA / FBM của store chia kênh (FASTPEACE) — lô chỉ hiện campaign thuộc kênh này. */
  channel?: "FBA" | "FBM" | null;
  notify: (message: string, type?: "success" | "error") => void;
  onQueued?: () => void;
  /** Mở ngăn Action Queue (phần "Kết quả thực thi") để theo dõi job vừa xếp hàng. */
  onOpenActionQueue?: () => void;
  onKeywordCountChange?: (count: number) => void;
}

const HEADER_WORDS = new Set(["negative phrase kw", "negative exact kw", "negative kw", "keyword", "keywords"]);
const STORAGE_KEY = "ppc:negative-list:keywords";

function parseKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const kw = line.replace(/\s+/g, " ").trim().toLowerCase();
    if (!kw || kw.length > 80 || HEADER_WORDS.has(kw) || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

const fmtMoney = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtBatchTime = (v: string) =>
  new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });

function PendingBatchRows({
  batch: b,
  open,
  busy,
  isAuto,
  onToggle,
  onConfirm,
  onAutoUpload,
  onCancel,
}: {
  batch: PendingBatch;
  open: boolean;
  busy: boolean;
  isAuto: boolean;
  onToggle: () => void;
  onConfirm: () => void;
  onAutoUpload: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <tr className={`align-middle ${open ? "bg-slate-50" : "hover:bg-slate-50"}`}>
        <td className="py-2.5 pl-4 pr-2">
          <button type="button" onClick={onToggle} className="text-slate-500 cursor-pointer" title="Xem keyword">
            <CaretRight size={12} weight="bold" className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        </td>
        <td className="py-2.5 px-2 min-w-[220px]">
          <div className="flex items-center gap-2">
            {isAuto ? (
              <CloudArrowUp size={16} weight="bold" className="text-rose-600 shrink-0" />
            ) : (
              <FileXls size={16} weight="bold" className="text-emerald-600 shrink-0" />
            )}
            <span className="font-bold text-slate-800 break-all">{b.fileName || b.id}</span>
          </div>
        </td>
        <td className="py-2.5 px-2 whitespace-nowrap text-slate-700">{fmtBatchTime(b.createdAt)}</td>
        <td className="py-2.5 px-2 whitespace-nowrap text-slate-700">{b.createdBy || "—"}</td>
        <td className="py-2.5 px-2 whitespace-nowrap">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            {b.matchType === "negativeExact" ? "Negative Exact" : "Negative Phrase"}
          </span>
        </td>
        <td className="py-2.5 px-2 text-right font-mono font-bold text-orange-600">{b.keywordCount.toLocaleString("en-US")}</td>
        <td className="py-2.5 px-2 text-right font-mono font-bold text-indigo-600">{b.campaignCount.toLocaleString("en-US")}</td>
        <td className="py-2.5 px-2 text-right font-mono font-black text-slate-900">{b.rowCount.toLocaleString("en-US")}</td>
        <td className="py-2.5 pl-2 pr-4">
          {isAuto ? (
            <div className="flex justify-end">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-[11px] font-bold whitespace-nowrap">
                <CircleNotch size={12} className="animate-spin" /> Đang Auto Upload{b.status ? ` · ${b.status}` : ""}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:text-rose-600 hover:border-rose-300 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                Huỷ lô
              </button>
              <button
                type="button"
                onClick={onAutoUpload}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 cursor-pointer disabled:opacity-60 shadow-xs whitespace-nowrap"
              >
                <CloudArrowUp size={14} weight="bold" />
                Auto Upload
              </button>
              <button
                type="button"
                data-tour="neg-nl-confirm-uploaded-btn"
                onClick={onConfirm}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 cursor-pointer disabled:opacity-60 shadow-xs whitespace-nowrap"
              >
                {busy ? <CircleNotch size={14} className="animate-spin" /> : <CheckSquare size={14} weight="bold" />}
                Đã upload
              </button>
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td></td>
          <td colSpan={8} className="pb-3 pr-4">
            <div className="flex flex-wrap gap-1">
              {b.keywords.map((k) => (
                <span key={k} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[10px] font-mono">
                  {k}
                </span>
              ))}
              {b.keywordCount > b.keywords.length && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                  +{(b.keywordCount - b.keywords.length).toLocaleString("en-US")} từ
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function PpcNegativeListView({ selectedStore, channel = null, notify, onQueued, onOpenActionQueue, onKeywordCountChange }: PpcNegativeListViewProps) {
  const [picks, setPicks] = useState<AsinPick[]>([]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AsinPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [keywordText, setKeywordText] = useState(() => {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) || "" : "";
    } catch {
      return "";
    }
  });
  const [matchType, setMatchType] = useState<"negativePhrase" | "negativeExact">("negativePhrase");

  const [campaigns, setCampaigns] = useState<AsinCampaign[]>([]);
  const [missingAsins, setMissingAsins] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [campaignSearch, setCampaignSearch] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    jobId: string;
    fileName: string;
    actionCount: number;
    skipped: number;
    message: string;
  } | null>(null);
  const [liveStatus, setLiveStatus] = useState<{
    status: string;
    stage?: string;
    progressPct?: number;
    errorMessage?: string;
  } | null>(null);

  // Giữ callback mới nhất mà không làm effect poll chạy lại mỗi lần render
  const onQueuedRef = useRef(onQueued);
  useEffect(() => {
    onQueuedRef.current = onQueued;
  }, [onQueued]);

  // Lô chờ xác nhận (Xuất File) / đang Auto Upload
  const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  // Thao tác cần xác nhận trên 1 lô: huỷ lô / Auto Upload lô đã xuất
  const [pendingAction, setPendingAction] = useState<{ batch: PendingBatch; action: "cancel" | "auto_upload" } | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  const loadPendingBatches = useCallback(async () => {
    // View được dựng lại theo store (key={selectedStore}) → store "ALL" chỉ cần bỏ qua
    if (!selectedStore || selectedStore === "ALL") return;
    try {
      const params = new URLSearchParams({ storeName: selectedStore });
      if (channel) params.set("channel", channel);
      const res = await fetch(`/api/ppc/negative-list/batches?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) setPendingBatches(json.batches || []);
    } catch {
      // bỏ qua lỗi tải nền
    }
  }, [selectedStore, channel]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState chỉ chạy sau khi fetch xong
    void loadPendingBatches();
  }, [loadPendingBatches]);

  // Còn lô Auto Upload đang chạy → hỏi lại định kỳ để lô tự biến mất (sang Negative Hub) khi xong
  const hasRunningAuto = pendingBatches.some((b) => b.kind === "AUTO_UPLOAD");
  useEffect(() => {
    if (!hasRunningAuto) return;
    const timer = setInterval(() => {
      void loadPendingBatches().then(() => onQueuedRef.current?.());
    }, 20000);
    return () => clearInterval(timer);
  }, [hasRunningAuto, loadPendingBatches]);

  const handleBatchAction = async (batch: PendingBatch, action: "confirm" | "cancel" | "auto_upload") => {
    setBatchBusy(batch.id);
    try {
      const res = await fetch("/api/ppc/negative-list/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, channel, batchId: batch.id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${res.status}`);
      notify(json.message, "success");
      setPendingAction(null);
      await loadPendingBatches();
      onQueuedRef.current?.();
      // Auto Upload → mở ngăn Action Queue để theo dõi tiến độ như nút Auto Upload thường
      if (action === "auto_upload") onOpenActionQueue?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi cập nhật lô.", "error");
    } finally {
      setBatchBusy(null);
    }
  };

  const keywords = useMemo(() => parseKeywords(keywordText), [keywordText]);
  const loadedAsins = useMemo(() => picks.map((p) => p.asin), [picks]);
  const selectedCampaigns = useMemo(() => campaigns.filter((c) => selectedIds.has(c.campaignId)), [campaigns, selectedIds]);
  const totalRows = keywords.length * selectedCampaigns.length;
  const sdCount = selectedCampaigns.filter((c) => c.adType === "SD").length;

  const visibleCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => c.campaignName.toLowerCase().includes(q) || c.asin.toLowerCase().includes(q));
  }, [campaigns, campaignSearch]);

  useEffect(() => {
    onKeywordCountChange?.(keywords.length);
  }, [keywords.length, onKeywordCountChange]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, keywordText);
      } catch {
        // bỏ qua: trình duyệt chặn localStorage
      }
    }, 400);
    return () => clearTimeout(t);
  }, [keywordText]);

  // Gợi ý ASIN/SKU khi gõ (debounce 250 ms, huỷ request cũ)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ storeName: selectedStore, q });
        const res = await fetch(`/api/ppc/negative-list?${params}`, { signal: ctrl.signal, cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        setSuggestions(json.items || []);
        setActiveIndex(0);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setSuggestions([]);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, selectedStore]);

  // Bấm ra ngoài → đóng dropdown
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Tải campaign của các ASIN mới thêm; giữ nguyên lựa chọn của campaign cũ
  const loadCampaignsFor = async (asinList: string[]) => {
    setLoadingCampaigns(true);
    setLookupError(null);
    try {
      const params = new URLSearchParams({ storeName: selectedStore, asins: asinList.join(",") });
      const res = await fetch(`/api/ppc/negative-list?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${res.status}`);
      const list: AsinCampaign[] = json.campaigns || [];
      setMissingAsins((prev) => [...new Set([...prev, ...(json.missingAsins || [])])]);
      setCampaigns((prev) => {
        const known = new Set(prev.map((c) => c.campaignId));
        return [...prev, ...list.filter((c) => !known.has(c.campaignId))];
      });
      // Mặc định chọn campaign đang chạy (SD không phủ định keyword được)
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const c of list) if (c.campaignState === "enabled" && c.adType !== "SD") next.add(c.campaignId);
        return next;
      });
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Không tải được campaign.");
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const addPick = (item: AsinPick) => {
    setQuery("");
    setSuggestions([]);
    setDropdownOpen(false);
    if (picks.some((p) => p.asin === item.asin)) return;
    setPicks((prev) => [...prev, item]);
    loadCampaignsFor([item.asin]);
  };

  const removePick = (asin: string) => {
    setPicks((prev) => prev.filter((p) => p.asin !== asin));
    setMissingAsins((prev) => prev.filter((a) => a !== asin));
    const removedIds = new Set(campaigns.filter((c) => c.asin === asin).map((c) => c.campaignId));
    setCampaigns((prev) => prev.filter((c) => c.asin !== asin));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !removedIds.has(id))));
  };

  const clearPicks = () => {
    setPicks([]);
    setCampaigns([]);
    setSelectedIds(new Set());
    setMissingAsins([]);
    setLookupError(null);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = suggestions[activeIndex];
      if (hit) addPick(hit);
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
    }
  };

  const showDropdown = dropdownOpen && query.trim().length >= 2;

  const toggleCampaign = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Gom campaign theo ASIN (mỗi ASIN = 1 SKU đã chọn), mặc định thu gọn
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const byAsin = new Map<string, AsinCampaign[]>();
    for (const c of visibleCampaigns) {
      const list = byAsin.get(c.asin) || [];
      list.push(c);
      byAsin.set(c.asin, list);
    }
    return picks
      .filter((p) => byAsin.has(p.asin))
      .map((p) => {
        const list = byAsin.get(p.asin) || [];
        return {
          asin: p.asin,
          sku: p.skus.join(", ") || p.asin,
          mockupUrl: p.mockupUrl,
          campaigns: list,
          clicks: list.reduce((n, c) => n + c.clicks, 0),
          spend: Math.round(list.reduce((n, c) => n + c.spend, 0) * 100) / 100,
          orders: list.reduce((n, c) => n + c.orders, 0),
        };
      });
  }, [picks, visibleCampaigns]);

  // Đang lọc campaign → tự mở các nhóm có kết quả
  const isGroupOpen = (asin: string) => expanded.has(asin) || campaignSearch.trim().length > 0;
  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.asin));
  const toggleGroupOpen = (asin: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  };
  const toggleExpandAll = () => setExpanded(allExpanded ? new Set() : new Set(groups.map((g) => g.asin)));
  // Chọn hàng loạt trên các campaign đang hiển thị (theo ô lọc); SD luôn bỏ qua
  const selectableVisible = visibleCampaigns.filter((c) => c.adType !== "SD");
  const nVisibleSelected = selectableVisible.filter((c) => selectedIds.has(c.campaignId)).length;
  const selectBulk = (mode: "all" | "none") => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of visibleCampaigns) {
        if (mode === "none" || c.adType === "SD") next.delete(c.campaignId);
        else next.add(c.campaignId);
      }
      return next;
    });
  };
  const toggleGroupSelect = (list: AsinCampaign[], allSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of list) {
        if (c.adType === "SD") continue;
        if (allSelected) next.delete(c.campaignId);
        else next.add(c.campaignId);
      }
      return next;
    });
  };

  // Xuất file Bulksheet để tự upload lên Amazon → tạo lô chờ tick "Đã upload lên Amazon"
  const handleExport = async () => {
    if (keywords.length === 0) return notify("Danh sách keyword đang trống.", "error");
    if (selectedCampaigns.length === 0) return notify("Chưa chọn campaign nào.", "error");
    setExporting(true);
    try {
      const res = await fetch("/api/ppc/negative-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "export",
          storeName: selectedStore,
          asins: loadedAsins,
          campaignIds: selectedCampaigns.map((c) => c.campaignId),
          keywords,
          matchType,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || json.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="([^"]+)"/);
      const filename = m ? decodeURIComponent(m[1]) : "Negative_List.xlsx";
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      const count = Number(res.headers.get("X-Action-Count") || 0);
      const skipped = Number(res.headers.get("X-Skipped-Count") || 0);
      const fileCount = Number(res.headers.get("X-File-Count") || 1);
      notify(
        `Đã xuất ${count.toLocaleString("en-US")} dòng ${matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact"}` +
          (fileCount > 1 ? ` (file zip gồm ${fileCount} file)` : "") +
          (skipped > 0 ? `, bỏ qua ${skipped.toLocaleString("en-US")} cặp đã phủ định` : "") +
          ". Upload xong file nào thì tick “Đã upload” file đó ở mục Lô chờ xác nhận.",
        "success",
      );
      void loadPendingBatches();
      onQueuedRef.current?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xuất file.", "error");
    } finally {
      setExporting(false);
    }
  };

  const openConfirm = () => {
    if (keywords.length === 0) return notify("Danh sách keyword đang trống.", "error");
    if (selectedCampaigns.length === 0) return notify("Chưa chọn campaign nào.", "error");
    setSubmitError(null);
    setResult(null);
    setLiveStatus(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/ppc/negative-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName: selectedStore,
          asins: loadedAsins,
          campaignIds: selectedCampaigns.map((c) => c.campaignId),
          keywords,
          matchType,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${res.status}`);
      setResult({
        jobId: json.jobId,
        fileName: json.fileName,
        actionCount: json.actionCount,
        skipped: json.skipped || 0,
        message: json.message,
      });
      notify(`Đã xếp hàng Auto Upload ${json.actionCount} dòng phủ định lên Mac mini!`, "success");
      void loadPendingBatches();
      onQueued?.();
      // Chuyển sang ngăn Action Queue → "Kết quả thực thi" để theo dõi tiến độ (giống Auto Upload Negative KW / Sale KW).
      if (onOpenActionQueue) {
        setIsModalOpen(false);
        onOpenActionQueue();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Lỗi khi xếp hàng Negative List.");
    } finally {
      setSubmitting(false);
    }
  };

  // Theo dõi trạng thái job trên Mac mini
  useEffect(() => {
    if (!result?.jobId || !isModalOpen) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(result.jobId)}`);
        if (!res.ok) return;
        const json = await res.json();
        const l = json.data?.log;
        if (!alive || !l) return;
        setLiveStatus({
          status: l.status,
          stage: l.stage,
          progressPct: l.progress_pct ?? l.progressPct,
          errorMessage: l.error_message ?? l.errorMessage,
        });
        if (["SUCCESS", "COMPLETED", "FAILED", "RESULT_TIMEOUT"].includes(l.status)) {
          clearInterval(timer);
          if (l.status === "SUCCESS" || l.status === "COMPLETED") onQueuedRef.current?.();
          void loadPendingBatches();
        }
      } catch {
        // bỏ qua lỗi poll nền
      }
    };
    // poll() chỉ đụng tới timer sau await → timer luôn đã khởi tạo
    const timer = setInterval(poll, 3000);
    poll();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [result?.jobId, isModalOpen, loadPendingBatches]);

  const matchLabel = matchType === "negativePhrase" ? "Negative Phrase" : "Negative Exact";

  return (
    <div className="space-y-4">
      {/* 1. Thanh nhập ASIN + Match type */}
      <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div ref={searchBoxRef} className="relative flex-1 min-w-[260px] max-w-2xl">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              data-tour="neg-nl-asin-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setDropdownOpen(true);
                if (e.target.value.trim().length < 2) setSuggestions([]);
              }}
              onFocus={() => setDropdownOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Tìm ASIN hoặc SKU để thêm vào danh sách..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-9 py-2 text-xs font-bold text-slate-800 placeholder:font-medium placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300"
            />
            {(searching || loadingCampaigns) && (
              <CircleNotch size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-600" />
            )}

            {showDropdown && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white border border-slate-300 rounded-xl shadow-lg overflow-hidden">
                {suggestions.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-600">
                    {searching ? "Đang tìm..." : `Không có ASIN/SKU nào chạy quảng cáo trong store ${selectedStore} khớp “${query.trim()}”.`}
                  </p>
                ) : (
                  <ul className="max-h-[360px] overflow-auto py-1">
                    {suggestions.map((item, idx) => {
                      const added = picks.some((p) => p.asin === item.asin);
                      return (
                        <li key={item.asin}>
                          <button
                            type="button"
                            data-tour={idx === 0 ? "neg-nl-suggestion-first" : undefined}
                            aria-pressed={added}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => addPick(item)}
                            disabled={added}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition cursor-pointer disabled:cursor-default ${
                              idx === activeIndex && !added ? "bg-orange-50" : ""
                            } ${added ? "opacity-50" : ""}`}
                          >
                            <Mockup url={item.mockupUrl} size={40} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-black text-slate-800 truncate">{item.skus.join(", ") || "—"}</p>
                              <p className="text-xs font-mono text-slate-700">{item.asin}</p>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold whitespace-nowrap">
                              {item.campaignCount} campaign
                            </span>
                            {added ? (
                              <CheckCircle size={16} weight="fill" className="text-emerald-500" />
                            ) : (
                              <Plus size={14} weight="bold" className="text-orange-600" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div data-tour="neg-nl-match-type" className="flex items-center bg-slate-100 rounded-xl p-0.5 ml-auto">
            {(["negativePhrase", "negativeExact"] as const).map((m) => (
              <button
                key={m}
                type="button"
                data-tour={m === "negativePhrase" ? "neg-nl-match-phrase" : "neg-nl-match-exact"}
                aria-pressed={matchType === m}
                onClick={() => setMatchType(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                  matchType === m ? "bg-white text-orange-700 shadow-xs" : "text-slate-700 hover:text-slate-700"
                }`}
              >
                {m === "negativePhrase" ? "Negative Phrase" : "Negative Exact"}
              </button>
            ))}
          </div>
        </div>
        {picks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {picks.map((p, pickIdx) => {
              const n = campaigns.filter((c) => c.asin === p.asin).length;
              return (
                <div
                  key={p.asin}
                  className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl bg-orange-50 border border-orange-200"
                >
                  <Mockup url={p.mockupUrl} size={32} />
                  <div className="leading-tight">
                    <p className="text-xs font-black text-slate-800">{p.skus[0] || p.asin}</p>
                    <p className="text-[11px] font-mono text-slate-700">
                      {p.asin} · {n} camp
                    </p>
                  </div>
                  <button
                    type="button"
                    data-tour={pickIdx === picks.length - 1 ? "neg-nl-pick-remove-last" : undefined}
                    onClick={() => removePick(p.asin)}
                    className="ml-1 text-slate-700 hover:text-rose-600 cursor-pointer"
                    title="Bỏ ASIN này"
                  >
                    <X size={13} weight="bold" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={clearPicks}
              className="flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-rose-600 cursor-pointer"
            >
              <Trash size={12} weight="bold" /> Bỏ tất cả
            </button>
          </div>
        )}
        {lookupError && (
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            <WarningCircle size={14} weight="bold" />
            {lookupError}
          </div>
        )}
        {missingAsins.length > 0 && (
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <Info size={14} weight="bold" />
            Không tìm thấy campaign nào cho: <span className="font-mono">{missingAsins.join(", ")}</span>
          </div>
        )}
      </div>

      {/* 1b. Lô chờ xác nhận: Xuất File chờ tick "Đã upload" / Auto Upload, lô Auto Upload đang chạy */}
      {pendingBatches.length > 0 && (
        <div data-tour="neg-nl-pending-batches" className="bg-white border border-amber-300 rounded-2xl shadow-2xs overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50">
            <WarningCircle size={15} weight="bold" className="text-amber-700" />
            <span className="text-xs font-black text-slate-800">Lô chờ xác nhận{channel ? ` · ${channel}` : ""}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[11px] font-mono font-bold">{pendingBatches.length}</span>
            <span className="text-[11px] text-slate-600">
              Chưa tính là đã phủ định. Đã upload tay → tick “Đã upload”. Lỡ xuất mà chưa upload → bấm “Auto Upload”.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-4 pr-2 w-8"></th>
                  <th className="py-2 px-2 text-left">File</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">Thời gian</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">Người xuất</th>
                  <th className="py-2 px-2 text-left whitespace-nowrap">Kiểu</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Keyword</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Campaign</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Dòng</th>
                  <th className="py-2 pl-2 pr-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingBatches.map((b) => {
                  const isAuto = b.kind === "AUTO_UPLOAD";
                  const open = openBatchId === b.id;
                  const busy = batchBusy === b.id;
                  return (
                    <PendingBatchRows
                      key={b.id}
                      batch={b}
                      open={open}
                      busy={busy}
                      isAuto={isAuto}
                      onToggle={() => setOpenBatchId(open ? null : b.id)}
                      onConfirm={() => void handleBatchAction(b, "confirm")}
                      onAutoUpload={() => setPendingAction({ batch: b, action: "auto_upload" })}
                      onCancel={() => setPendingAction({ batch: b, action: "cancel" })}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Thẻ tổng quan */}
      <div data-tour="neg-nl-stats" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-black uppercase tracking-wide text-slate-600">Keyword phủ định</p>
          <p className="mt-1 text-2xl font-black text-orange-600">
            {keywords.length} <span className="text-sm font-bold text-slate-700">từ</span>
          </p>
        </div>
        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-black uppercase tracking-wide text-slate-600">Campaign áp dụng</p>
          <p className="mt-1 text-2xl font-black text-indigo-600">
            {selectedCampaigns.length}
            <span className="text-sm font-bold text-slate-700"> / {campaigns.length} campaign</span>
          </p>
        </div>
        <div className="bg-white border border-slate-300 rounded-2xl p-4 shadow-2xs">
          <p className="text-xs font-black uppercase tracking-wide text-slate-600">Tổng dòng phủ định</p>
          <p className="mt-1 text-2xl font-black text-rose-600">
            {totalRows.toLocaleString("en-US")} <span className="text-sm font-bold text-slate-700">dòng</span>
          </p>
        </div>
      </div>

      {/* 3. Keyword + Campaign */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr] gap-4">
        {/* Keyword list */}
        <div className="bg-white border border-slate-300 rounded-2xl shadow-2xs flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-amber-50">
            <div className="flex items-center gap-2">
              <ListBullets size={15} weight="bold" className="text-amber-700" />
              <span className="text-xs font-black text-slate-800">{matchLabel} KW</span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[11px] font-mono font-bold">
                {keywords.length}
              </span>
            </div>
            {keywordText && (
              <button
                type="button"
                onClick={() => setKeywordText("")}
                className="flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-rose-600 cursor-pointer"
              >
                <Trash size={12} weight="bold" /> Xoá
              </button>
            )}
          </div>
          <textarea
            data-tour="neg-nl-keywords-input"
            value={keywordText}
            onChange={(e) => setKeywordText(e.target.value)}
            placeholder={"Dán cột keyword từ Google Sheet, mỗi dòng 1 từ:\nactivities\nanimal\napron\nbackdrop\n..."}
            spellCheck={false}
            className="flex-1 min-h-[360px] w-full resize-y px-4 py-3 text-xs font-mono font-semibold leading-6 text-slate-900 placeholder:text-slate-500 focus:outline-none bg-[linear-gradient(transparent_23px,#f1f5f9_24px)] bg-[length:100%_24px] bg-[position:0_12px]"
          />
        </div>

        {/* Campaign gom theo SKU / ASIN */}
        <div data-tour="neg-nl-campaign-list" className="bg-white border border-slate-300 rounded-2xl shadow-2xs flex flex-col overflow-hidden">
          {/* Thanh hành động ở trên cùng → không bị danh sách dài đẩy trôi xuống */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
            {groups.length > 0 && (
              <>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = nVisibleSelected > 0 && nVisibleSelected < selectableVisible.length;
                    }}
                    checked={selectableVisible.length > 0 && nVisibleSelected === selectableVisible.length}
                    onChange={() => selectBulk(nVisibleSelected === selectableVisible.length ? "none" : "all")}
                    className="rounded border-slate-300 text-indigo-600 h-4 w-4 cursor-pointer"
                  />
                  {nVisibleSelected}/{selectableVisible.length}
                </label>
                <button
                  type="button"
                  onClick={toggleExpandAll}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  {allExpanded ? "Thu gọn tất cả" : "Mở tất cả"}
                </button>
              </>
            )}
            <div className="relative ml-auto w-full sm:w-56">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                value={campaignSearch}
                onChange={(e) => setCampaignSearch(e.target.value)}
                placeholder="Lọc campaign..."
                className="w-full bg-white border border-slate-300 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <button
              type="button"
              data-tour="neg-nl-export-btn"
              onClick={handleExport}
              disabled={totalRows === 0 || exporting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-emerald-600 text-emerald-700 text-xs font-black hover:bg-emerald-50 transition cursor-pointer disabled:border-slate-300 disabled:text-slate-600 disabled:bg-slate-100 disabled:cursor-not-allowed shadow-xs"
            >
              {exporting ? <CircleNotch size={15} className="animate-spin" /> : <FileXls size={15} weight="bold" />}
              Xuất File
            </button>
            <button
              type="button"
              data-tour="neg-nl-auto-upload-btn"
              data-tour-safe="opens-modal"
              onClick={openConfirm}
              disabled={totalRows === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 transition cursor-pointer disabled:bg-slate-300 disabled:text-slate-700 disabled:cursor-not-allowed shadow-xs"
            >
              <CloudArrowUp size={15} weight="bold" />
              Auto Upload phủ định
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-16 text-center">
              {loadingCampaigns ? (
                <CircleNotch size={28} className="animate-spin text-slate-600" />
              ) : (
                <>
                  <Package size={32} weight="duotone" className="text-slate-300" />
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto max-h-[520px] divide-y divide-slate-200">
              {groups.map((g) => {
                const open = isGroupOpen(g.asin);
                const selectable = g.campaigns.filter((c) => c.adType !== "SD");
                const nSel = selectable.filter((c) => selectedIds.has(c.campaignId)).length;
                const nEnabled = g.campaigns.filter((c) => c.campaignState === "enabled").length;
                return (
                  <div key={g.asin}>
                    {/* Dòng SKU */}
                    <div
                      onClick={() => toggleGroupOpen(g.asin)}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 ${open ? "bg-slate-100" : ""}`}
                    >
                      <CaretRight
                        size={13}
                        weight="bold"
                        className={`text-slate-600 transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
                      />
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) el.indeterminate = nSel > 0 && nSel < selectable.length;
                        }}
                        checked={selectable.length > 0 && nSel === selectable.length}
                        disabled={selectable.length === 0}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleGroupSelect(g.campaigns, nSel === selectable.length)}
                        className="rounded border-slate-300 text-indigo-600 h-4 w-4 cursor-pointer shrink-0"
                      />
                      <Mockup url={g.mockupUrl} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-800 truncate">{g.sku}</p>
                        <p className="text-xs font-mono text-slate-700">{g.asin}</p>
                      </div>
                      <div className="hidden md:flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-bold whitespace-nowrap">
                          {nSel}/{g.campaigns.length} chọn
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${
                            nEnabled > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {nEnabled} đang chạy
                        </span>
                      </div>
                      <div className="text-right text-xs font-mono text-slate-600 w-[150px] shrink-0">
                        {g.clicks.toLocaleString("en-US")} clk · {fmtMoney(g.spend)} · {g.orders} đơn
                      </div>
                    </div>

                    {/* Campaign của SKU */}
                    {open &&
                      g.campaigns.map((c) => {
                        const isSd = c.adType === "SD";
                        const checked = selectedIds.has(c.campaignId);
                        return (
                          <div
                            key={c.campaignId}
                            onClick={() => !isSd && toggleCampaign(c.campaignId)}
                            className={`flex items-center gap-3 pl-11 pr-4 py-2 border-t border-slate-50 text-xs ${
                              isSd ? "bg-slate-50 text-slate-600" : "cursor-pointer hover:bg-slate-50"
                            } ${checked ? "bg-indigo-50" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isSd}
                              onChange={() => toggleCampaign(c.campaignId)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-indigo-600 h-4 w-4 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            />
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-black shrink-0">{c.adType}</span>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-800 break-words">{c.campaignName}</p>
                              {isSd && <p className="text-[11px] text-slate-600">SD không hỗ trợ Negative Keyword</p>}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${
                                c.campaignState === "enabled" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {c.campaignState}
                            </span>
                            <div className="text-right text-xs font-mono text-slate-600 w-[150px] shrink-0">
                              {c.clicks.toLocaleString("en-US")} clk · {fmtMoney(c.spend)} · {c.orders} đơn
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4. Modal xác nhận / tiến trình */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <CloudArrowUp size={18} weight="bold" className="text-rose-600" />
                <h3 className="text-sm font-black text-slate-900">Auto Upload Negative List</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={submitting}
                className="text-slate-700 hover:text-slate-700 cursor-pointer"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 text-xs">
              {!result ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-orange-50 p-3">
                      <p className="text-lg font-black text-orange-600">{keywords.length}</p>
                      <p className="text-[11px] font-bold text-slate-700">keyword</p>
                    </div>
                    <div className="rounded-xl bg-indigo-50 p-3">
                      <p className="text-lg font-black text-indigo-600">{selectedCampaigns.length}</p>
                      <p className="text-[11px] font-bold text-slate-700">campaign</p>
                    </div>
                    <div className="rounded-xl bg-rose-50 p-3">
                      <p className="text-lg font-black text-rose-600">{totalRows.toLocaleString("en-US")}</p>
                      <p className="text-[11px] font-bold text-slate-700">dòng phủ định</p>
                    </div>
                  </div>
                  <ul className="space-y-1 text-slate-600">
                    <li>• Store: <b>{selectedStore}</b> · ASIN: <span className="font-mono">{loadedAsins.join(", ")}</span></li>
                    <li>• Kiểu: <b>{matchLabel}</b> ở cấp <b>Campaign</b> (Campaign Negative Keyword)</li>
                    {totalRows > 30000 && (
                      <li className="text-indigo-700">• Hơn 30,000 dòng → tự chia thành nhiều file (≤ 30,000 dòng/file), mỗi file 1 job upload.</li>
                    )}
                    <li>• Cặp keyword × campaign đã có trong Negative Hub (hoặc đang Auto Upload) sẽ được bỏ qua. Lô mới xuất file chưa xác nhận thì vẫn upload.</li>
                    {sdCount > 0 && <li className="text-amber-700">• {sdCount} campaign SD sẽ bị bỏ qua.</li>}
                  </ul>
                  {submitError && (
                    <div className="flex items-start gap-2 text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-semibold">
                      <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
                      {submitError}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-semibold">
                    <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
                    <div>
                      <p>{result.message}</p>
                      {result.skipped > 0 && (
                        <p className="text-xs font-medium text-emerald-700">Bỏ qua {result.skipped} cặp đã phủ định trước đó.</p>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 break-all">File: {result.fileName}</p>
                  <div>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-600 mb-1">
                      <span>{liveStatus ? `${liveStatus.status}${liveStatus.stage ? ` · ${liveStatus.stage}` : ""}` : "Đang chờ Mac mini nhận job..."}</span>
                      <span>{liveStatus?.progressPct ?? 25}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full transition-all ${liveStatus?.status === "FAILED" ? "bg-rose-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, Math.max(0, liveStatus?.progressPct ?? 25))}%` }}
                      />
                    </div>
                    {liveStatus?.errorMessage && <p className="mt-1 text-xs text-rose-600">{liveStatus.errorMessage}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                data-tour="neg-nl-modal-cancel"
                onClick={() => setIsModalOpen(false)}
                disabled={submitting}
                className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {result ? "Đóng" : "Huỷ"}
              </button>
              {!result && (
                <button
                  type="button"
                  data-tour="neg-nl-modal-confirm"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 cursor-pointer disabled:opacity-60"
                >
                  {submitting ? <CircleNotch size={14} className="animate-spin" /> : <CloudArrowUp size={14} weight="bold" />}
                  Xác nhận Upload
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Xác nhận huỷ lô / Auto Upload lô đã xuất */}
      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 space-y-3 text-xs">
              {pendingAction.action === "auto_upload" ? (
                <>
                  <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                    <CloudArrowUp size={18} weight="bold" /> Auto Upload lô đã xuất
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-orange-50 p-2.5">
                      <p className="text-base font-black text-orange-600">{pendingAction.batch.keywordCount.toLocaleString("en-US")}</p>
                      <p className="text-[11px] font-bold text-slate-700">keyword</p>
                    </div>
                    <div className="rounded-xl bg-indigo-50 p-2.5">
                      <p className="text-base font-black text-indigo-600">{pendingAction.batch.campaignCount.toLocaleString("en-US")}</p>
                      <p className="text-[11px] font-bold text-slate-700">campaign</p>
                    </div>
                    <div className="rounded-xl bg-rose-50 p-2.5">
                      <p className="text-base font-black text-rose-600">{pendingAction.batch.rowCount.toLocaleString("en-US")}</p>
                      <p className="text-[11px] font-bold text-slate-700">dòng</p>
                    </div>
                  </div>
                  <p className="text-slate-700">
                    Tạo lại file Bulk từ lô <b className="break-all">{pendingAction.batch.fileName}</b> và để Mac mini tự upload lên Amazon.
                    Chạy xong lô tự chuyển sang Negative Hub.
                  </p>
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    Chỉ dùng khi file này <b>chưa</b> được upload tay lên Amazon.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                    <WarningCircle size={18} weight="fill" /> Huỷ lô xuất file
                  </div>
                  <p className="text-slate-700">
                    Huỷ lô <b className="break-all">{pendingAction.batch.fileName}</b> ({pendingAction.batch.rowCount.toLocaleString("en-US")} dòng)? Dùng
                    khi file này <b>không</b> upload lên Amazon. Các cặp keyword × campaign sẽ không được ghi vào Negative Hub.
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                disabled={batchBusy === pendingAction.batch.id}
                className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={() => void handleBatchAction(pendingAction.batch, pendingAction.action)}
                disabled={batchBusy === pendingAction.batch.id}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700 cursor-pointer disabled:opacity-60"
              >
                {batchBusy === pendingAction.batch.id ? (
                  <CircleNotch size={14} className="animate-spin" />
                ) : pendingAction.action === "auto_upload" ? (
                  <CloudArrowUp size={14} weight="bold" />
                ) : (
                  <Trash size={14} weight="bold" />
                )}
                {pendingAction.action === "auto_upload" ? "Xác nhận Auto Upload" : "Huỷ lô"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
