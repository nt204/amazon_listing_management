"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, CircleNotch } from "@phosphor-icons/react";
import type { PpcSearchTermRow } from "@/lib/ppc/types";
import type { RequestActor } from "@/lib/auth";
import type { SaleKwCampaignPayload } from "@/lib/ppc/service";
import {
  isAsinProductTarget,
  formatYYYYMMDD,
  extractFileDateDDMMYY,
  buildSaleKwCampaignName,
  generateSaleKwCampaignTriad,
  normalizeSaleKwDate,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";

type MatchKey = "exact" | "phrase" | "broad";
type BidRule = "cpc" | "cpc_pct" | "fixed";

const MATCH_TYPES: Array<{ key: MatchKey; label: string }> = [
  { key: "exact", label: "Exact" },
  { key: "phrase", label: "Phrase" },
  { key: "broad", label: "Broad" },
];
const UNKNOWN_SKU = "UNKNOWN_SKU";

interface LaunchSettings {
  matchTypes: Record<MatchKey, boolean>;
  dailyBudget: number;
  bidRule: BidRule;
  bidValue: number;
  negateInSource: boolean;
  adTypeCode: string;
  suffix: string;
}

const DEFAULT_SETTINGS: LaunchSettings = {
  matchTypes: { exact: true, phrase: true, broad: true },
  dailyBudget: 5,
  bidRule: "cpc",
  bidValue: 1,
  negateInSource: false,
  adTypeCode: "SP03",
  suffix: "",
};

interface LaunchItem {
  id: string;
  term: string;
  sku: string;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  bidOverride: number | null;
  sourceCampaignName: string;
  sourceCampaignId?: string;
  sourceAdGroupId?: string;
  sourceAdGroupName?: string;
  launched: boolean;
}

interface Props {
  selectedRows: PpcSearchTermRow[];
  storeName: string;
  storeId?: string;
  selectedSku: string;
  knownSkus: string[];
  actor?: RequestActor;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onClear: () => void;
  onLaunched: () => void;
}

function actorStorageId(actor?: RequestActor): string {
  return (actor?.userId || actor?.displayName || "default").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function defaultUserName(actor?: RequestActor): string {
  const raw = actor?.displayName?.trim();
  if (!raw) return "Loan";
  const part = raw.includes("@")
    ? raw.split("@")[0].replace(/[^a-zA-Z0-9]/g, "")
    : raw.replace(/[^a-zA-Z0-9\s]/g, "").trim().split(/\s+/)[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1) : "Loan";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Gộp các dòng đã chọn theo (SKU, search term); ASIN không lên camp keyword nên bỏ ra
function buildItems(rows: PpcSearchTermRow[], selectedSku: string): { items: LaunchItem[]; asinCount: number } {
  const map = new Map<string, LaunchItem>();
  let asinCount = 0;
  for (const row of rows) {
    const term = (row.customerSearchTerm || "").trim();
    if (!term) continue;
    if (isAsinProductTarget(term)) {
      asinCount++;
      continue;
    }
    const sku = resolveSkuForSearchTerm(row, selectedSku);
    const id = `${sku.toLowerCase()}|||${term.toLowerCase()}`;
    const existing = map.get(id);
    if (existing) {
      existing.clicks += Number(row.clicks) || 0;
      existing.spend += Number(row.spend) || 0;
      existing.sales += Number(row.sales) || 0;
      existing.orders += Number(row.orders) || 0;
      continue;
    }
    map.set(id, {
      id,
      term,
      sku,
      clicks: Number(row.clicks) || 0,
      spend: Number(row.spend) || 0,
      sales: Number(row.sales) || 0,
      orders: Number(row.orders) || 0,
      cpc: 0,
      bidOverride: null,
      sourceCampaignName: row.campaignName || sku,
      sourceCampaignId: row.campaignId,
      sourceAdGroupId: row.adGroupId,
      sourceAdGroupName: row.adGroupName,
      launched: false,
    });
  }
  const items = Array.from(map.values());
  for (const item of items) item.cpc = item.clicks > 0 ? round2(item.spend / item.clicks) : 0;
  return { items, asinCount };
}

export function PpcSearchTermLaunchPanel({
  selectedRows,
  storeName,
  storeId,
  selectedSku,
  knownSkus,
  actor,
  notify,
  onClear,
  onLaunched,
}: Props) {
  const storageId = actorStorageId(actor);
  const settingsKey = `ppc_st_launch_settings_${storageId}`;
  const userNameKey = `ppc_sale_kw_username_${storageId}`;

  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<LaunchSettings>(DEFAULT_SETTINGS);
  const [userName, setUserName] = useState(() => defaultUserName(actor));
  const [dateStr, setDateStr] = useState(() => formatYYYYMMDD());
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [asinCount, setAsinCount] = useState(0);
  const [checkingRegistry, setCheckingRegistry] = useState(false);
  const [busy, setBusy] = useState<"export" | "upload" | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ jobId: string; status: string; progress?: number; error?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const updateSettings = (patch: Partial<LaunchSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(settingsKey, JSON.stringify(next));
      } catch { }
      return next;
    });
  };

  const updateUserName = (value: string) => {
    setUserName(value);
    try {
      localStorage.setItem(userNameKey, value);
    } catch { }
  };

  const openPanel = async () => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      const savedName = localStorage.getItem(userNameKey);
      if (savedName?.trim()) setUserName(savedName.trim());
    } catch { }
    const built = buildItems(selectedRows, selectedSku);
    setItems(built.items);
    setAsinCount(built.asinCount);
    setUploadStatus(null);
    const reportDate = selectedRows.map((r) => r.reportEndDate || r.reportDate).find(Boolean);
    const parsed = reportDate ? extractFileDateDDMMYY(reportDate) : null;
    setDateStr(parsed ? normalizeSaleKwDate(parsed) : formatYYYYMMDD());
    setOpen(true);

    if (built.items.length === 0) return;
    setCheckingRegistry(true);
    try {
      const res = await fetch("/api/ppc/sale-kw/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          storeName,
          candidates: built.items.map((it) => ({ sku: it.sku, keyword: it.term })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        const keys = new Set<string>(json.lookupKeys || []);
        setItems((prev) => prev.map((it) => ({
          ...it,
          launched: keys.has(it.id) || keys.has(it.term.toLowerCase()),
        })));
      }
    } catch { } finally {
      setCheckingRegistry(false);
    }
  };

  const bidFor = (item: LaunchItem): number => {
    if (item.bidOverride && item.bidOverride > 0) return item.bidOverride;
    if (settings.bidRule === "fixed" || item.cpc <= 0) return Math.max(0.1, settings.bidValue || 1);
    if (settings.bidRule === "cpc_pct") return Math.max(0.1, round2(item.cpc * (1 + (settings.bidValue || 0) / 100)));
    return Math.max(0.1, item.cpc);
  };

  const activeItems = items;
  const enabledMatchTypes = MATCH_TYPES.filter((m) => settings.matchTypes[m.key]);

  const groups = useMemo(() => {
    const map = new Map<string, LaunchItem[]>();
    for (const it of activeItems) {
      if (!map.has(it.sku)) map.set(it.sku, []);
      map.get(it.sku)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNKNOWN_SKU) return -1;
      if (b === UNKNOWN_SKU) return 1;
      return a.localeCompare(b);
    });
  }, [activeItems]);

  const missingSkuCount = activeItems.filter((it) => !it.sku.trim() || it.sku === UNKNOWN_SKU).length;
  const skuCount = groups.filter(([sku]) => sku !== UNKNOWN_SKU).length;
  const campaignCount = skuCount * enabledMatchTypes.length;
  const blocker =
    activeItems.length === 0
      ? "Không còn term nào để lên camp."
      : enabledMatchTypes.length === 0
        ? "Chọn ít nhất 1 match type."
        : missingSkuCount > 0
          ? `Còn ${missingSkuCount} term chưa có SKU.`
          : null;

  const renameSku = (fromSku: string, toSku: string) => {
    const next = toSku.trim().toUpperCase();
    setItems((prev) => prev.map((it) => (it.sku === fromSku ? { ...it, sku: next } : it)));
  };

  const setItemSku = (id: string, sku: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, sku: sku.trim().toUpperCase() } : it)));
  };

  const setItemBid = (id: string, value: string) => {
    const num = Number(value);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, bidOverride: value === "" || !Number.isFinite(num) ? null : num } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const buildPayload = () => {
    const activeUser = userName.trim() || "Loan";
    const activeDate = dateStr.trim() || formatYYYYMMDD();
    const campaigns: SaleKwCampaignPayload[] = [];
    for (const [sku, skuItems] of groups) {
      const triad = generateSaleKwCampaignTriad({ sku, adTypeCode: settings.adTypeCode, userName: activeUser, dateStr: activeDate, suffix: settings.suffix });
      const clicks = skuItems.reduce((s, it) => s + it.clicks, 0);
      const spend = skuItems.reduce((s, it) => s + it.spend, 0);
      const avgCpc = clicks > 0 ? round2(spend / clicks) : 0;
      const first = skuItems[0];
      for (const m of enabledMatchTypes) {
        campaigns.push({
          sourceCampaignName: first.sourceCampaignName,
          sourceCampaignId: first.sourceCampaignId || "",
          sourceAdGroupId: first.sourceAdGroupId || "",
          sourceAdGroupName: first.sourceAdGroupName || first.sourceCampaignName,
          targetCampaignName: triad[m.key],
          adGroupName: triad[m.key],
          sku,
          dailyBudget: settings.dailyBudget || 5,
          defaultBid: avgCpc > 0 ? avgCpc : settings.bidValue || 1,
          biddingStrategy: "Dynamic bids - down only",
          negateInSource: settings.negateInSource,
          keywords: skuItems.map((it) => ({
            customerSearchTerm: it.term,
            keyword: it.term,
            matchType: m.key,
            bid: bidFor(it),
            orders: it.orders,
            sales: it.sales,
            clicks: it.clicks,
            spend: it.spend,
          })),
        });
      }
    }
    return {
      storeName,
      storeId,
      dailyBudget: settings.dailyBudget,
      defaultBid: settings.bidValue,
      negateInSource: settings.negateInSource,
      userName: activeUser,
      dateStr: activeDate,
      adTypeCode: settings.adTypeCode,
      campaigns,
      items: activeItems.map((it) => ({
        customerSearchTerm: it.term,
        sku: it.sku,
        campaignName: it.sourceCampaignName,
        adGroupName: it.sourceAdGroupName || it.sourceCampaignName,
        campaignId: it.sourceCampaignId,
        adGroupId: it.sourceAdGroupId,
        bid: bidFor(it),
        clicks: it.clicks,
        orders: it.orders,
        sales: it.sales,
        spend: it.spend,
        cpc: it.cpc,
        storeId,
        storeName,
      })),
    };
  };

  const finish = () => {
    setOpen(false);
    onLaunched();
  };

  const handleExport = async () => {
    if (blocker) return;
    setBusy("export");
    try {
      const res = await fetch("/api/ppc/sale-kw/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Lỗi xuất file (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename\*=UTF-8''([^;\n]+)/i) || disposition.match(/filename="?([^";\n]+)"?/i);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : "Sale_KW_Campaigns.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify(`Đã tải ${filename}`, "success");
      finish();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi xuất bulk file.", "error");
    } finally {
      setBusy(null);
    }
  };

  const pollUpload = (jobId: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const log = json.data?.log;
        if (res.ok && json.success && log) {
          const status = String(log.status || "");
          const error = log.errorMessage ?? log.error_message ?? log.resultSummary ?? log.result_summary;
          setUploadStatus({ jobId, status, progress: log.progressPct ?? log.progress_pct, error });
          if (status === "SUCCESS" || status === "PARTIAL_SUCCESS") {
            notify("Upload lên Amazon thành công.", "success");
            finish();
            return;
          }
          if (status === "FAILED" || status === "RESULT_TIMEOUT") {
            notify(`Upload thất bại: ${error || status}`, "error");
            return;
          }
        }
      } catch { }
      pollRef.current = setTimeout(tick, 3000);
    };
    void tick();
  };

  const handleUpload = async () => {
    if (blocker) return;
    if (!confirm(`Upload ${campaignCount} campaign (${activeItems.length} keyword) lên Amazon store ${storeName}?`)) return;
    setBusy("upload");
    try {
      const res = await fetch("/api/ppc/sale-kw/auto-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || json.message || `Lỗi upload (HTTP ${res.status})`);
      setUploadStatus({ jobId: json.jobId, status: "QUEUED" });
      pollUpload(json.jobId);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Lỗi khi upload.", "error");
    } finally {
      setBusy(null);
    }
  };

  const uploading = Boolean(uploadStatus && !["FAILED", "RESULT_TIMEOUT"].includes(uploadStatus.status));
  const uploadFailed = Boolean(uploadStatus && ["FAILED", "RESULT_TIMEOUT"].includes(uploadStatus.status));
  const previewName = buildSaleKwCampaignName({
    sku: groups.find(([sku]) => sku !== UNKNOWN_SKU)?.[0] || "SKU",
    adTypeCode: settings.adTypeCode,
    userName: userName.trim() || "Loan",
    matchType: (enabledMatchTypes[0]?.label ?? "Exact") as "Exact" | "Phrase" | "Broad",
    dateStr: dateStr.trim() || formatYYYYMMDD(),
    suffix: settings.suffix,
  });
  const inputCls = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
  const labelCls = "mb-1 block text-xs font-medium text-slate-500";
  const sectionTitleCls = "mb-2.5 text-xs font-bold uppercase tracking-wide text-slate-400";
  const datalistId = "ppc-st-launch-skus";

  return (
    <>
      {selectedRows.length > 0 && !open && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white py-2.5 pl-5 pr-2.5 shadow-xl">
          <span className="text-sm text-slate-600">
            Đã chọn <span className="font-bold text-slate-900">{selectedRows.length}</span> term
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            Bỏ chọn
          </button>
          <button
            type="button"
            onClick={openPanel}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer"
          >
            Lên camp
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/25" onClick={() => !busy && !uploading && setOpen(false)}>
          <div
            className="flex h-full w-full max-w-[680px] flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-base font-bold text-slate-900">Lên camp</div>
                <div className="text-sm text-slate-500">{storeName}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={Boolean(busy) || uploading}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* 1. Tên campaign */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className={sectionTitleCls}>Tên campaign</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label>
                    <span className={labelCls}>Người làm</span>
                    <input value={userName} onChange={(e) => updateUserName(e.target.value)} className={`${inputCls} w-full`} />
                  </label>
                  <label>
                    <span className={labelCls}>Ngày</span>
                    <input value={dateStr} onChange={(e) => setDateStr(e.target.value)} className={`${inputCls} w-full font-mono`} />
                  </label>
                  <label>
                    <span className={labelCls}>Loại</span>
                    <select
                      value={settings.adTypeCode}
                      onChange={(e) => updateSettings({ adTypeCode: e.target.value })}
                      className={`${inputCls} w-full cursor-pointer`}
                    >
                      <option value="SP03">SP03 KW</option>
                      <option value="SP04">SP04 Auto</option>
                      <option value="SB05">SB05 Video</option>
                      <option value="SB01">SB01</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelCls}>Đuôi tên</span>
                    <input
                      value={settings.suffix}
                      onChange={(e) => updateSettings({ suffix: e.target.value })}
                      placeholder="Không bắt buộc"
                      className={`${inputCls} w-full`}
                    />
                  </label>
                </div>
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 break-all">
                  {previewName}
                </div>
              </section>

              {/* 2. Cài đặt camp */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className={sectionTitleCls}>Cài đặt</div>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                  <div>
                    <span className={labelCls}>Match type</span>
                    <div className="flex gap-1.5">
                      {MATCH_TYPES.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => updateSettings({ matchTypes: { ...settings.matchTypes, [m.key]: !settings.matchTypes[m.key] } })}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold cursor-pointer ${
                            settings.matchTypes[m.key]
                              ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 text-slate-400 hover:text-slate-600"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span className={labelCls}>Budget / ngày ($)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={settings.dailyBudget}
                      onChange={(e) => updateSettings({ dailyBudget: Number(e.target.value) })}
                      className={`${inputCls} w-24`}
                    />
                  </label>
                  <div>
                    <span className={labelCls}>Bid</span>
                    <div className="flex gap-1.5">
                      <select
                        value={settings.bidRule}
                        onChange={(e) => updateSettings({ bidRule: e.target.value as BidRule })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        <option value="cpc">Bằng CPC</option>
                        <option value="cpc_pct">CPC ± %</option>
                        <option value="fixed">Cố định $</option>
                      </select>
                      {settings.bidRule !== "cpc" && (
                        <input
                          type="number"
                          step={settings.bidRule === "fixed" ? "0.05" : "5"}
                          value={settings.bidValue}
                          onChange={(e) => updateSettings({ bidValue: Number(e.target.value) })}
                          className={`${inputCls} w-20`}
                        />
                      )}
                    </div>
                  </div>
                  <label className="flex h-[38px] items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.negateInSource}
                      onChange={(e) => updateSettings({ negateInSource: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                    />
                    Negative exact ở camp gốc
                  </label>
                </div>
              </section>

              {/* 3. Keyword theo SKU */}
              <section className="px-6 py-4">
                <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={sectionTitleCls.replace("mb-2.5 ", "")}>Keyword · {activeItems.length}</span>
                  {checkingRegistry && <span className="text-xs text-slate-400">Đang kiểm tra term đã lên camp…</span>}
                  {asinCount > 0 && <span className="text-xs text-slate-400">Đã bỏ {asinCount} ASIN</span>}
                </div>

                <datalist id={datalistId}>
                  {knownSkus.map((sku) => <option key={sku} value={sku} />)}
                </datalist>

                <div className="space-y-3">
                  {groups.map(([sku, skuItems]) => {
                    const unknown = sku === UNKNOWN_SKU || !sku.trim();
                    return (
                      <div key={sku || "empty"} className={`overflow-hidden rounded-xl border ${unknown ? "border-amber-300" : "border-slate-200"}`}>
                        <div className={`flex items-center gap-2 border-b px-3.5 py-2 ${unknown ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                          {unknown ? (
                            <span className="text-sm font-semibold text-amber-800">Chưa có SKU, nhập cho từng term</span>
                          ) : (
                            <input
                              key={sku}
                              defaultValue={sku}
                              list={datalistId}
                              onBlur={(e) => e.target.value.trim() && e.target.value.trim().toUpperCase() !== sku && renameSku(sku, e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                              className="-mx-1 min-w-0 flex-1 rounded px-1 py-0.5 bg-transparent font-mono text-sm font-bold text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-200"
                            />
                          )}
                          <span className="ml-auto shrink-0 text-xs text-slate-400">{skuItems.length} term · {enabledMatchTypes.length} camp</span>
                        </div>
                        <table className="w-full table-fixed text-sm">
                          <colgroup>
                            <col />
                            <col className="w-14" />
                            <col className="w-20" />
                            <col className="w-24" />
                            <col className="w-9" />
                          </colgroup>
                          <thead>
                            <tr>
                              <td className="py-1.5 pl-3.5 pr-2 text-left text-xs font-normal normal-case tracking-normal text-slate-400">Search term</td>
                              <td className="px-2 py-1.5 text-right text-xs font-normal normal-case tracking-normal text-slate-400">Đơn</td>
                              <td className="px-2 py-1.5 text-right text-xs font-normal normal-case tracking-normal text-slate-400">CPC</td>
                              <td className="px-1 py-1.5 text-right text-xs font-normal normal-case tracking-normal text-slate-400">Bid</td>
                              <td />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {skuItems.map((it) => (
                              <tr key={it.id}>
                                <td className="py-2 pl-3.5 pr-2 text-slate-800">
                                  <div className="break-words">
                                    {it.term}
                                    {it.launched && (
                                      <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">đã lên camp</span>
                                    )}
                                  </div>
                                  {unknown && (
                                    <input
                                      placeholder="Nhập SKU"
                                      list={datalistId}
                                      onBlur={(e) => e.target.value.trim() && setItemSku(it.id, e.target.value)}
                                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                      className={`${inputCls} mt-1.5 w-48 font-mono`}
                                    />
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-2 py-2 text-right text-slate-500">{it.orders}</td>
                                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-slate-500">
                                  {it.cpc > 0 ? `$${it.cpc.toFixed(2)}` : "—"}
                                </td>
                                <td className="px-1 py-2">
                                  <input
                                    type="number"
                                    step="0.05"
                                    min="0.1"
                                    value={it.bidOverride ?? ""}
                                    placeholder={bidFor(it).toFixed(2)}
                                    onChange={(e) => setItemBid(it.id, e.target.value)}
                                    className={`${inputCls} w-full py-1 text-right font-mono placeholder:text-slate-700`}
                                  />
                                </td>
                                <td className="py-2 pr-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(it.id)}
                                    className="rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                                  >
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-3 border-t border-slate-200 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-bold text-slate-900">{activeItems.length}</span> keyword ·{" "}
                  <span className="font-bold text-slate-900">{skuCount}</span> SKU ·{" "}
                  <span className="font-bold text-slate-900">{campaignCount}</span> campaign
                </span>
                {blocker && <span className="font-semibold text-amber-700">{blocker}</span>}
              </div>
              {uploadStatus && (
                <div className={`text-sm ${uploadFailed ? "text-rose-600" : "text-slate-600"}`}>
                  {uploadFailed
                    ? `Upload thất bại: ${uploadStatus.error || uploadStatus.status}`
                    : `Đang upload lên Amazon… ${uploadStatus.progress != null ? `${uploadStatus.progress}%` : uploadStatus.status}`}
                </div>
              )}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={Boolean(blocker) || Boolean(busy) || uploading || checkingRegistry}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "export" && <CircleNotch size={15} className="animate-spin" />}
                  Tải bulk file
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={Boolean(blocker) || Boolean(busy) || uploading || checkingRegistry}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {(busy === "upload" || uploading) && <CircleNotch size={15} className="animate-spin" />}
                  Upload lên Amazon
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
