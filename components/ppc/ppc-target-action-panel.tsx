"use client";

// Tab Target: thao tác trên các target đã tick — đổi bid (gõ từng dòng hoặc áp chung), tạm dừng, bật lại, phủ định.
// Mọi thao tác chỉ áp cho đúng target đó trong đúng campaign của nó.
// - Đổi bid / Tạm dừng / Bật lại → Action Queue (/api/ppc/actions) như tab Manual Bid.
// - Phủ định → /api/ppc/targets/negative (đường ống Negative List: Auto Upload Mac mini hoặc tải file).
import { useMemo, useState } from "react";
import { CircleNotch, X } from "@phosphor-icons/react";
import { applyBidOp, type BulkBidOp } from "@/lib/ppc/manual-bid";
import { extractSkuFromText } from "@/lib/ppc/sku-extractor";
import { targetNegativeKind } from "@/lib/ppc/target-negative";
import type { PpcTargetPerformance } from "@/lib/ppc/types";
import { useDragSelect } from "./use-drag-select";

type Mode = "bid" | "pause" | "enable" | "negative";
type BidOpKind = "set" | "inc" | "dec" | "cpc";
type NegMatch = "negativeExact" | "negativePhrase";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "bid", label: "Đổi bid" },
  { key: "pause", label: "Tạm dừng" },
  { key: "enable", label: "Bật lại" },
  { key: "negative", label: "Phủ định" },
];

const BID_OPS: Array<{ kind: BidOpKind; label: string; unit: string; placeholder: string }> = [
  { kind: "set", label: "Đặt bid", unit: "$", placeholder: "0.75" },
  { kind: "inc", label: "Tăng", unit: "%", placeholder: "10" },
  { kind: "dec", label: "Giảm", unit: "%", placeholder: "10" },
  { kind: "cpc", label: "Theo CPC ×", unit: "×", placeholder: "1" },
];

const isPaused = (t: PpcTargetPerformance) => /pause/i.test(t.state || "");
const isArchived = (t: PpcTargetPerformance) => /archiv/i.test(t.state || "");

function targetTypeOf(t: PpcTargetPerformance): "EXACT" | "PHRASE" | "PRODUCT" {
  const m = (t.matchType || "").toLowerCase();
  if (m.includes("exact")) return "EXACT";
  if (m.includes("phrase") || m.includes("broad")) return "PHRASE";
  return "PRODUCT";
}

function toBulkOp(kind: BidOpKind, value: number): BulkBidOp {
  if (kind === "inc") return { kind: "pct", value };
  if (kind === "dec") return { kind: "pct", value: -value };
  if (kind === "cpc") return { kind: "cpc", value };
  return { kind: "set", value };
}

const money = (v: number | null | undefined) => (v == null ? "—" : `$${v.toFixed(2)}`);
const parseNum = (v: string) => parseFloat(v.replace(",", "."));

type PlanRow = { t: PpcTargetPerformance; key: string; skip: string | null; newBid: number | null };

export function PpcTargetActionPanel({
  selectedRows,
  storeName,
  storeId,
  notify,
  onQueued,
}: {
  selectedRows: PpcTargetPerformance[];
  storeName: string;
  storeId?: string;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onQueued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("bid");
  const [opKind, setOpKind] = useState<BidOpKind>("set");
  const [opValue, setOpValue] = useState("");
  const [negMatch, setNegMatch] = useState<NegMatch>("negativeExact");
  const [submitting, setSubmitting] = useState<null | "queue" | "upload" | "export">(null);
  // Bid gõ tay từng dòng. Ô chung bên trên điền sẵn cho mọi dòng, sửa lại từng dòng được.
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  // Dòng bỏ tích ngay trong khung (không làm thao tác này cho dòng đó)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const opValueNum = parseNum(opValue);
  const valueOk = Number.isFinite(opValueNum) && opValueNum > 0;

  // Từng dòng: làm được không (lý do bỏ qua), bid mới.
  const plan: PlanRow[] = useMemo(() => {
    return selectedRows.map((t, i) => {
      const key = t.targetId || `${t.campaignId}|${t.adGroupId}|${t.targetKeyword}|${i}`;
      const row = (skip: string | null, newBid: number | null = null): PlanRow => ({ t, key, skip, newBid });
      if (t.grouped) return row("Dòng gộp — mở chi tiết để chọn từng target");
      if (isArchived(t)) return row("Đã archive");
      if (!t.campaignId || !t.adGroupId) return row("Thiếu Campaign / Ad group ID");
      if (mode === "negative") {
        if ((t.adType || "").toUpperCase() === "SD") return row("SD không có phủ định");
        if (!targetNegativeKind(t.targetKeyword, t.adType)) return row("Target Auto / category không phủ định được");
        return row(null);
      }
      if (!t.targetId) return row("Thiếu Target ID");
      const bid = t.currentBid ?? 0;
      if (mode === "pause") return isPaused(t) ? row("Đang tạm dừng") : row(null, bid);
      if (mode === "enable") return isPaused(t) ? row(null, bid) : row("Đang chạy");
      // Đổi bid trong bulksheet luôn kèm State = enabled → sẽ bật lại target đang dừng, nên bỏ qua dòng đang dừng.
      if (isPaused(t)) return row("Đang tạm dừng");
      const typed = parseNum(drafts.get(key) || "");
      if (!(Number.isFinite(typed) && typed > 0)) return row(null, null);
      const next = applyBidOp({ kind: "set", value: typed }, { bid, cpc: t.cpc || 0, adType: t.adType || "SP" });
      return row(null, next != null && Math.abs(next - bid) >= 0.005 ? next : null);
    });
  }, [selectedRows, mode, drafts]);

  const selectable = useMemo(() => plan.filter((p) => !p.skip), [plan]);
  const selectableKeys = useMemo(() => selectable.map((p) => p.key), [selectable]);
  const includedKeys = useMemo(() => new Set(selectableKeys.filter((k) => !excluded.has(k))), [selectableKeys, excluded]);
  const included = selectable.filter((p) => includedKeys.has(p.key));
  const ready = mode === "bid" ? included.filter((p) => p.newBid != null) : included;

  // Bấm / kéo tô / Shift để tích – bỏ tích dòng trong khung, như tab Manual Bid
  const drag = useDragSelect(selectableKeys, includedKeys, (next) => {
    setExcluded(new Set(selectableKeys.filter((k) => !next.has(k))));
  });
  const allIncluded = selectable.length > 0 && included.length === selectable.length;

  const applyToAll = () => {
    if (!valueOk) return;
    setDrafts((prev) => {
      const next = new Map(prev);
      for (const p of included) {
        const bid = p.t.currentBid ?? 0;
        if (opKind !== "set" && opKind !== "cpc" && !(bid > 0)) continue;
        const v = applyBidOp(toBulkOp(opKind, opValueNum), { bid, cpc: p.t.cpc || 0, adType: p.t.adType || "SP" });
        if (v != null) next.set(p.key, v.toFixed(2));
      }
      return next;
    });
  };

  // Enter / ↓ / ↑ trong ô bid: nhảy dòng như bảng tính
  const focusBid = (idx: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-ta-bid="${idx}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  const reset = () => {
    setOpen(false);
    setOpValue("");
    setDrafts(new Map());
    setExcluded(new Set());
  };

  const submitQueue = async () => {
    if (ready.length === 0 || submitting) return;
    const stamp = Date.now();
    const items = ready.map(({ t, newBid }) => {
      const bid = t.currentBid ?? 0;
      const finalBid = newBid ?? bid;
      const recType = mode === "pause" ? "PAUSE_TARGET" : mode === "enable" ? "BID_INCREASE" : finalBid > bid ? "BID_INCREASE" : "BID_DECREASE";
      return {
        recommendation: {
          id: `target-tab:${mode}:${t.targetId}:${stamp}`,
          storeId: t.storeId || storeId,
          storeName,
          adType: t.adType || "SP",
          recType,
          targetType: targetTypeOf(t),
          matchType: t.matchType,
          keyword: t.targetKeyword,
          campaignName: t.campaignName,
          adGroupName: t.adGroupName,
          sku: extractSkuFromText(t.campaignName) || extractSkuFromText(t.adGroupName) || "",
          campaignId: t.campaignId,
          adGroupId: t.adGroupId,
          keywordId: t.targetId,
          currentBid: bid,
          recommendedBid: finalBid,
          reason: mode === "pause" ? "Tạm dừng từ tab Target" : mode === "enable" ? "Bật lại từ tab Target" : "Đổi bid từ tab Target",
          estimatedSavings: 0,
          status: "PENDING",
          ruleProfile: "target-tab",
          clicks: t.clicks,
          spend: t.spend,
          sales: t.sales,
          orders: t.orders,
          cpc: t.cpc,
          createdAt: new Date().toISOString(),
        },
        userFinalBid: finalBid,
        decisionSource: "USER_EDIT",
        ...(mode === "enable" ? { actionType: "ENABLE_TARGET" } : {}),
      };
    });
    setSubmitting("queue");
    try {
      const res = await fetch("/api/ppc/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, storeId, items }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "Không đưa được vào hàng đợi.");
      notify(`Đã đưa ${items.length} thay đổi vào Action Queue.`, "success");
      reset();
      onQueued();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không đưa được vào hàng đợi.", "error");
    } finally {
      setSubmitting(null);
    }
  };

  const submitNegative = async (how: "upload" | "export") => {
    if (ready.length === 0 || submitting) return;
    setSubmitting(how);
    try {
      const res = await fetch("/api/ppc/targets/negative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName,
          matchType: negMatch,
          mode: how,
          items: ready.map(({ t }) => ({ campaignId: t.campaignId, adGroupId: t.adGroupId, keyword: t.targetKeyword })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Lỗi phủ định (HTTP ${res.status})`);
      }
      if (how === "export") {
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition") || "";
        const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] || /filename="([^"]+)"/.exec(cd)?.[1] || "Target_Negative.xlsx");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        const count = res.headers.get("X-Action-Count");
        const skippedCount = Number(res.headers.get("X-Skipped-Count") || 0);
        notify(`Đã tải file ${count} phủ định${skippedCount ? `, bỏ qua ${skippedCount} đã phủ định trước đó` : ""}. Upload xong thì tick "Đã upload" ở tab Negative List.`, "success");
      } else {
        const json = await res.json().catch(() => null);
        notify(json?.message || "Đã xếp hàng Auto Upload phủ định.", "success");
      }
      reset();
      onQueued();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Lỗi phủ định.", "error");
    } finally {
      setSubmitting(null);
    }
  };

  const modeLabel = MODES.find((m) => m.key === mode)!.label;
  const currentOp = BID_OPS.find((o) => o.kind === opKind)!;
  const skippedCount = plan.length - selectable.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={selectedRows.length === 0}
        title={selectedRows.length === 0 ? "Tick chọn target để đổi bid / tạm dừng / bật lại / phủ định" : undefined}
        className="rounded-lg border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
      >
        Đổi bid{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/25" onClick={() => !submitting && setOpen(false)}>
          <div className="flex h-full w-full max-w-[820px] flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <div className="text-base font-bold text-slate-900">Đổi bid</div>
                <div className="text-sm text-slate-500">
                  {storeName} · {selectedRows.length} target đã chọn
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={Boolean(submitting)}
                aria-label="Đóng"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            <section className="space-y-3 border-b border-slate-100 px-6 py-4">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Thao tác">
                {MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.key}
                    onClick={() => {
                      setMode(m.key);
                      setExcluded(new Set());
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold cursor-pointer ${
                      mode === m.key ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === "bid" && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={opKind}
                    onChange={(e) => setOpKind(e.target.value as BidOpKind)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 cursor-pointer"
                  >
                    {BID_OPS.map((o) => (
                      <option key={o.kind} value={o.kind}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={opValue}
                      onChange={(e) => setOpValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyToAll()}
                      placeholder={currentOp.placeholder}
                      className="h-9 w-28 rounded-lg border border-slate-200 pl-3 pr-7 text-sm tabular-nums outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400">{currentOp.unit}</span>
                  </div>
                  {drafts.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setDrafts(new Map())}
                      className="h-9 rounded-lg px-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
                    >
                      Xoá bid đã gõ
                    </button>
                  )}
                </div>
              )}

              {mode === "negative" && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="radiogroup" aria-label="Kiểu phủ định">
                    {(["negativeExact", "negativePhrase"] as NegMatch[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={negMatch === m}
                        onClick={() => setNegMatch(m)}
                        className={`rounded-md px-3 py-1 text-sm font-semibold cursor-pointer ${
                          negMatch === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {m === "negativeExact" ? "Negative Exact" : "Negative Phrase"}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-500">Chỉ trong campaign của từng target · ASIN luôn là Negative Product Targeting</span>
                </div>
              )}
            </section>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="w-10 py-2 pl-6 pr-1">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        checked={allIncluded}
                        disabled={selectable.length === 0}
                        onChange={() => setExcluded(allIncluded ? new Set(selectableKeys) : new Set())}
                        className="h-3.5 w-3.5 cursor-pointer accent-indigo-600"
                      />
                    </th>
                    <th className="px-2 py-2 font-semibold">Target</th>
                    <th className="px-2 py-2 font-semibold">Campaign</th>
                    <th className="px-2 py-2 text-right font-semibold">Bid hiện tại</th>
                    <th className="px-6 py-2 text-right font-semibold">{mode === "bid" ? "Bid mới" : "Kết quả"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.map((p) => {
                    const { t, key, skip } = p;
                    const selIdx = skip ? -1 : selectableKeys.indexOf(key);
                    const on = !skip && includedKeys.has(key);
                    const showBidInput = mode === "bid" && !skip;
                    const myBidIdx = selIdx; // ô bid có ở mọi dòng làm được → cùng thứ tự với dòng chọn được
                    return (
                      <tr
                        key={key}
                        {...(skip ? {} : drag.rowProps(selIdx, key))}
                        className={`select-none ${skip ? "text-slate-400" : "cursor-pointer text-slate-700"} ${on ? "bg-indigo-50" : skip ? "" : "hover:bg-slate-50"}`}
                      >
                        <td className="py-1.5 pl-6 pr-1">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={Boolean(skip)}
                            readOnly
                            tabIndex={-1}
                            className="pointer-events-none h-3.5 w-3.5 accent-indigo-600"
                          />
                        </td>
                        <td className="max-w-[220px] truncate px-2 py-1.5 font-semibold" title={t.targetKeyword}>
                          {t.targetKeyword}
                          <span className="ml-1.5 font-normal text-slate-400">{t.matchType}</span>
                        </td>
                        <td className="max-w-[240px] truncate px-2 py-1.5" title={t.campaignName}>
                          {t.campaignName}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(t.currentBid)}</td>
                        <td className="px-6 py-1.5 text-right tabular-nums">
                          {skip ? (
                            <span className="text-[11px]">{skip}</span>
                          ) : showBidInput ? (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {on && p.newBid != null && (
                                <span className={`text-[11px] font-bold ${p.newBid > (t.currentBid ?? 0) ? "text-emerald-700" : "text-rose-700"}`}>
                                  {p.newBid > (t.currentBid ?? 0) ? "▲" : "▼"}
                                </span>
                              )}
                              <span className="relative">
                                <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400">$</span>
                                <input
                                  data-ta-bid={myBidIdx}
                                  inputMode="decimal"
                                  aria-label={`Bid mới cho ${t.targetKeyword}`}
                                  value={drafts.get(key) ?? ""}
                                  placeholder={t.currentBid != null ? t.currentBid.toFixed(2) : ""}
                                  onFocus={(e) => e.target.select()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === "ArrowDown") {
                                      e.preventDefault();
                                      focusBid(myBidIdx + 1);
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      focusBid(myBidIdx - 1);
                                    }
                                  }}
                                  onChange={(e) => {
                                    const v = e.target.value.replace(/[^0-9.,]/g, "");
                                    setDrafts((prev) => {
                                      const next = new Map(prev);
                                      if (v) next.set(key, v);
                                      else next.delete(key);
                                      return next;
                                    });
                                  }}
                                  className={`h-7 w-20 rounded-md border pl-5 pr-2 text-right tabular-nums outline-none placeholder:text-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${
                                    on ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-400"
                                  }`}
                                />
                              </span>
                            </span>
                          ) : on ? (
                            <span className="font-semibold">
                              {mode === "negative" ? (targetNegativeKind(t.targetKeyword, t.adType) === "asin" ? "Neg. Product" : negMatch === "negativeExact" ? "Neg. Exact" : "Neg. Phrase") : modeLabel}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">Bỏ qua</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
              <span className="text-xs text-slate-500">
                {ready.length} thay đổi{skippedCount > 0 ? ` · ${skippedCount} không làm được` : ""}
              </span>
              {mode === "negative" ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => submitNegative("export")}
                    disabled={ready.length === 0 || Boolean(submitting)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    {submitting === "export" && <CircleNotch size={14} className="animate-spin" />}
                    Tải file
                  </button>
                  <button
                    type="button"
                    onClick={() => submitNegative("upload")}
                    disabled={ready.length === 0 || Boolean(submitting)}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    {submitting === "upload" && <CircleNotch size={14} className="animate-spin" />}
                    Phủ định {ready.length > 0 ? `${ready.length} target` : ""} → Auto Upload
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={submitQueue}
                  disabled={ready.length === 0 || Boolean(submitting)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {submitting === "queue" && <CircleNotch size={14} className="animate-spin" />}
                  {modeLabel} {ready.length > 0 ? `${ready.length} target` : ""} → hàng đợi
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
