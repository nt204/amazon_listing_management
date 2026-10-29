"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, CircleNotch } from "@phosphor-icons/react";
import type { RequestActor } from "@/lib/auth";
import {
  LAUNCH_BIDDING_STRATEGIES,
  LAUNCH_MATCH_TYPES,
  LAUNCH_RUN_TYPES,
  buildLaunchPlan,
  isTermUsableForRunType,
  launchRunType,
  type LaunchBiddingStrategy,
  type LaunchMatchType,
  type LaunchRunType,
} from "@/lib/ppc/campaign-launch";
import {
  isAsinProductTarget,
  formatYYYYMMDD,
  extractFileDateDDMMYY,
  normalizeSaleKwDate,
  resolveSkuForSearchTerm,
} from "@/lib/ppc/sku-extractor";

type BidRule = "cpc" | "cpc_pct";
const UNKNOWN_SKU = "UNKNOWN_SKU";

interface LaunchSettings {
  runType: LaunchRunType;
  matchTypes: Record<LaunchMatchType, boolean>;
  dailyBudget: number;
  biddingStrategy: LaunchBiddingStrategy;
  bidRule: BidRule;
  bidValue: number;
  suffix: string;
}

const DEFAULT_SETTINGS: LaunchSettings = {
  runType: "SP03",
  matchTypes: { exact: true, phrase: true, broad: true },
  dailyBudget: 5,
  biddingStrategy: "Dynamic bids - down only",
  bidRule: "cpc",
  bidValue: 10,
  suffix: "",
};

interface LaunchItem {
  id: string;
  term: string;
  isAsin: boolean;
  sku: string;
  clicks: number;
  spend: number;
  orders: number;
  cpc: number;
  bidOverride: number | null;
}

// Dòng nguồn: search term hoặc target (term = targetKeyword)
export interface LaunchSourceRow {
  customerSearchTerm: string;
  campaignName: string;
  adGroupName?: string;
  portfolioName?: string;
  sku?: string;
  clicks: number;
  spend: number;
  orders: number;
  reportDate?: string;
  reportEndDate?: string;
  /** Dòng tổng ở bảng tóm tắt: đã cộng mọi campaign, ưu tiên hơn dòng chi tiết cùng term */
  grouped?: boolean;
}

interface Props {
  selectedRows: LaunchSourceRow[];
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

// Gộp các dòng đã chọn theo (SKU, term)
function buildItems(rows: LaunchSourceRow[], selectedSku: string): LaunchItem[] {
  const map = new Map<string, LaunchItem>();
  const groupedIds = new Set<string>();
  const ordered = [...rows].sort((a, b) => Number(Boolean(b.grouped)) - Number(Boolean(a.grouped)));
  for (const row of ordered) {
    const term = (row.customerSearchTerm || "").trim();
    if (!term) continue;
    if (row.grouped) groupedIds.add(term.toLowerCase());
    else if (groupedIds.has(term.toLowerCase())) continue;
    const sku = resolveSkuForSearchTerm(row, selectedSku);
    const id = `${sku.toLowerCase()}|||${term.toLowerCase()}`;
    const existing = map.get(id);
    if (existing) {
      existing.clicks += Number(row.clicks) || 0;
      existing.spend += Number(row.spend) || 0;
      existing.orders += Number(row.orders) || 0;
      continue;
    }
    map.set(id, {
      id,
      term,
      isAsin: isAsinProductTarget(term),
      sku,
      clicks: Number(row.clicks) || 0,
      spend: Number(row.spend) || 0,
      orders: Number(row.orders) || 0,
      cpc: 0,
      bidOverride: null,
    });
  }
  const items = Array.from(map.values());
  for (const item of items) item.cpc = item.clicks > 0 ? round2(item.spend / item.clicks) : 0;
  return items;
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
  const settingsKey = `ppc_campaign_launch_settings_${storageId}`;
  const userNameKey = `ppc_sale_kw_username_${storageId}`;

  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<LaunchSettings>(DEFAULT_SETTINGS);
  const [userName, setUserName] = useState(() => defaultUserName(actor));
  const [dateStr, setDateStr] = useState(() => formatYYYYMMDD());
  const [items, setItems] = useState<LaunchItem[]>([]);
  const [commonBid, setCommonBid] = useState("");
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

  const openPanel = () => {
    try {
      const saved = localStorage.getItem(settingsKey);
      if (saved) {
        const parsedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        if (parsedSettings.bidRule !== "cpc_pct") parsedSettings.bidRule = "cpc";
        setSettings(parsedSettings);
      }
      const savedName = localStorage.getItem(userNameKey);
      if (savedName?.trim()) setUserName(savedName.trim());
    } catch { }
    setItems(buildItems(selectedRows, selectedSku));
    setCommonBid("");
    setUploadStatus(null);
    const reportDate = selectedRows.map((r) => r.reportEndDate || r.reportDate).find(Boolean);
    const parsed = reportDate ? extractFileDateDDMMYY(reportDate) : null;
    setDateStr(parsed ? normalizeSaleKwDate(parsed) : formatYYYYMMDD());
    setOpen(true);
  };

  const bidFor = (item: LaunchItem): number => {
    if (item.bidOverride && item.bidOverride > 0) return item.bidOverride;
    if (item.cpc <= 0) return 1;
    if (settings.bidRule === "cpc_pct") return Math.max(0.1, round2(item.cpc * (1 + (settings.bidValue || 0) / 100)));
    return Math.max(0.1, item.cpc);
  };

  const runType = launchRunType(settings.runType);
  const enabledMatchTypes = LAUNCH_MATCH_TYPES.filter((m) => settings.matchTypes[m.key]);
  const usable = (it: LaunchItem) => isTermUsableForRunType(it.term, runType.value);
  const usableItems = items.filter(usable);
  const missingSkuCount = usableItems.filter((it) => !it.sku.trim() || it.sku === UNKNOWN_SKU).length;

  const groups = useMemo(() => {
    const map = new Map<string, LaunchItem[]>();
    for (const it of items) {
      if (!map.has(it.sku)) map.set(it.sku, []);
      map.get(it.sku)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNKNOWN_SKU) return -1;
      if (b === UNKNOWN_SKU) return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  const launchTerms = usableItems
    .filter((it) => it.sku.trim() && it.sku !== UNKNOWN_SKU)
    .map((it) => ({ term: it.term, sku: it.sku, bid: bidFor(it), clicks: it.clicks, spend: it.spend }));
  const launchOptions = {
    runType: runType.value,
    matchTypes: enabledMatchTypes.map((m) => m.key),
    dailyBudget: settings.dailyBudget,
    biddingStrategy: settings.biddingStrategy,
    userName: userName.trim() || "Loan",
    dateStr: dateStr.trim() || formatYYYYMMDD(),
    suffix: settings.suffix,
    commonBid: Number(commonBid) > 0 ? Number(commonBid) : undefined,
  };
  const plan = buildLaunchPlan(launchTerms, launchOptions);
  const campaignsBySku = new Map<string, string[]>();
  for (const camp of plan.campaigns) {
    if (!campaignsBySku.has(camp.sku)) campaignsBySku.set(camp.sku, []);
    campaignsBySku.get(camp.sku)!.push(camp.name);
  }

  const blocker =
    usableItems.length === 0
      ? `Không có term nào phù hợp ${runType.label}.`
      : runType.target === "keyword" && enabledMatchTypes.length === 0
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

  const applyCommonBid = (value: string) => {
    setCommonBid(value);
    const num = Number(value);
    const bid = value === "" || !Number.isFinite(num) || num <= 0 ? null : num;
    setItems((prev) => prev.map((it) => ({ ...it, bidOverride: bid })));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const requestBody = (mode: "export" | "upload") =>
    JSON.stringify({ mode, storeName, storeId, terms: launchTerms, options: launchOptions });

  const finish = () => {
    setOpen(false);
    onLaunched();
  };

  const handleExport = async () => {
    if (blocker) return;
    setBusy("export");
    try {
      const res = await fetch("/api/ppc/campaign-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("export"),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Lỗi xuất file (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const match = (res.headers.get("Content-Disposition") || "").match(/filename="?([^";\n]+)"?/i);
      const filename = match?.[1] || "Launch_Campaigns.xlsx";
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
    if (!confirm(`Upload ${plan.campaigns.length} campaign lên Amazon store ${storeName}?`)) return;
    setBusy("upload");
    try {
      const res = await fetch("/api/ppc/campaign-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody("upload"),
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
  const inputCls = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
  const labelCls = "mb-1 block text-xs font-medium text-slate-500";
  const sectionTitleCls = "text-xs font-bold uppercase tracking-wide text-slate-400";
  const datalistId = "ppc-st-launch-skus";

  return (
    <>
      <div className="flex items-center gap-1.5">
        {selectedRows.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            Bỏ chọn
          </button>
        )}
        <button
          type="button"
          onClick={openPanel}
          disabled={selectedRows.length === 0}
          title={selectedRows.length === 0 ? "Tick chọn term / target để lên camp" : undefined}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          Lên camp{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/25" onClick={() => !busy && !uploading && setOpen(false)}>
          <div
            className="flex h-full w-full max-w-[780px] flex-col bg-white shadow-2xl"
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
              {/* Dạng chạy + match type */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                  <select
                    value={settings.runType}
                    onChange={(e) => updateSettings({ runType: e.target.value as LaunchRunType })}
                    className={`${inputCls} min-w-[200px] cursor-pointer font-semibold`}
                  >
                    {LAUNCH_RUN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    <option disabled>SB01 / SB05 Video (chưa hỗ trợ)</option>
                  </select>
                  {runType.target === "keyword" && (
                    <div className="flex gap-1.5">
                      {LAUNCH_MATCH_TYPES.map((m) => (
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
                  )}
                </div>
              </section>

              {/* Ngân sách, bid, tên campaign */}
              <section className="border-b border-slate-100 px-6 py-4">
                <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
                  <label>
                    <span className={labelCls}>Budget ($)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={settings.dailyBudget}
                      onChange={(e) => updateSettings({ dailyBudget: Number(e.target.value) })}
                      className={`${inputCls} w-16`}
                    />
                  </label>
                  {runType.adProduct === "SP" && (
                    <label>
                      <span className={labelCls}>Bidding strategy</span>
                      <select
                        value={settings.biddingStrategy}
                        onChange={(e) => updateSettings({ biddingStrategy: e.target.value as LaunchBiddingStrategy })}
                        className={`${inputCls} cursor-pointer`}
                      >
                        {LAUNCH_BIDDING_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </label>
                  )}
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
                      </select>
                      {settings.bidRule === "cpc_pct" && (
                        <input
                          type="number"
                          step="5"
                          value={settings.bidValue}
                          onChange={(e) => updateSettings({ bidValue: Number(e.target.value) })}
                          className={`${inputCls} w-16`}
                        />
                      )}
                    </div>
                  </div>
                  {/* Bid chung: điền là áp cho mọi term, xóa trống thì quay về bid theo CPC */}
                  <label>
                    <span className={labelCls}>Bid chung ($)</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0.1"
                      value={commonBid}
                      placeholder="Để trống"
                      onChange={(e) => applyCommonBid(e.target.value)}
                      className={`${inputCls} w-24`}
                    />
                  </label>
                  <label>
                    <span className={labelCls}>Người làm</span>
                    <input value={userName} onChange={(e) => updateUserName(e.target.value)} className={`${inputCls} w-20`} />
                  </label>
                  <label>
                    <span className={labelCls}>Ngày</span>
                    <input value={dateStr} onChange={(e) => setDateStr(e.target.value)} className={`${inputCls} w-[104px] font-mono`} />
                  </label>
                  <label className="min-w-[110px] flex-1">
                    <span className={labelCls}>Đuôi tên</span>
                    <input
                      value={settings.suffix}
                      onChange={(e) => updateSettings({ suffix: e.target.value })}
                      placeholder="Không bắt buộc"
                      className={`${inputCls} w-full`}
                    />
                  </label>
                </div>
              </section>

              {/* 4. Search term theo SKU */}
              <section className="px-6 py-4">
                <div className={`${sectionTitleCls} mb-2.5`}>Search term · {usableItems.length}</div>

                <datalist id={datalistId}>
                  {knownSkus.map((sku) => <option key={sku} value={sku} />)}
                </datalist>

                <div className="space-y-3">
                  {groups.map(([sku, skuItems]) => {
                    const unknown = sku === UNKNOWN_SKU || !sku.trim();
                    const campNames = campaignsBySku.get(sku) || [];
                    return (
                      <div key={sku || "empty"} className={`overflow-hidden rounded-xl border ${unknown ? "border-amber-300" : "border-slate-200"}`}>
                        <div className={`border-b px-3.5 py-2 ${unknown ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                          <div className="flex items-center gap-2">
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
                            {campNames.length > 0 ? (
                              <span className="ml-auto shrink-0 text-xs text-slate-400">{skuItems.length} term · {campNames.length} camp</span>
                            ) : (
                              <span className="ml-auto shrink-0 text-xs font-medium text-amber-700">Không lên camp {runType.nameLabel}</span>
                            )}
                          </div>
                          {campNames.length > 0 && (
                            <div className="mt-1 space-y-0.5 font-mono text-[11px] leading-snug text-slate-500">
                              {campNames.map((name) => <div key={name} className="break-all">{name}</div>)}
                            </div>
                          )}
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
                              <td className="py-1.5 pl-3.5 pr-2 text-left text-xs text-slate-400">Search term</td>
                              <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-600">Đơn</td>
                              <td className="px-2 py-1.5 text-right text-xs font-semibold text-slate-600">CPC</td>
                              <td className="px-1 py-1.5 text-right text-xs font-semibold text-slate-600">Bid</td>
                              <td />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {skuItems.map((it) => (
                              <tr key={it.id} className={usable(it) ? "" : "opacity-40"}>
                                <td className="py-2 pl-3.5 pr-2 text-slate-800">
                                  <div className="break-words">
                                    {it.term}
                                    {it.isAsin && (
                                      <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">ASIN</span>
                                    )}
                                    {!usable(it) && (
                                      <span className="ml-2 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">bỏ qua</span>
                                    )}
                                  </div>
                                  {unknown && usable(it) && (
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
                  <span className="font-bold text-slate-900">{usableItems.length}</span> term ·{" "}
                  <span className="font-bold text-slate-900">{campaignsBySku.size}</span> SKU ·{" "}
                  <span className="font-bold text-slate-900">{plan.campaigns.length}</span> campaign
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
                  disabled={Boolean(blocker) || Boolean(busy) || uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === "export" && <CircleNotch size={15} className="animate-spin" />}
                  Tải bulk file
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={Boolean(blocker) || Boolean(busy) || uploading}
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
