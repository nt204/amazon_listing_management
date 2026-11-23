"use client";

// Cài đặt "Auto giảm Bid" (lib/ppc/auto-decrease.ts) — dùng chung cho tab Đề xuất & Auto Bid.
// Lô chờ duyệt có thể bỏ chọn từng target rồi xác nhận ngay trên web (nút "Xem chi tiết" trên thẻ Lark mở màn này).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  GearSix,
  CircleNotch,
  CheckCircle,
  Pause,
  WarningCircle,
  Bell as LarkBell,
} from "@phosphor-icons/react";
import { MockupHoverZoom } from "./ppc-manual-bid-view";

export interface AutoDecreaseSkuOption {
  sku: string;
  mockupUrl?: string | null;
  productType?: string;
  decreaseCount: number;
  spend: number;
}

interface Settings {
  storeId: string;
  enabled: boolean;
  scope: "ALL" | "SKUS";
  skus: string[];
  waitDays: number;
  minBid: number;
  cooldownDays: number;
  actorId: string;
  updatedAt: string | null;
}

interface BatchItem {
  recId: string;
  sku: string;
  keyword: string;
  matchType: string;
  campaignName: string;
  currentBid: number;
  finalBid: number;
  changePct: number;
  seenDays: number;
  spend: number;
  clicks: number;
  orders: number;
  acos: number | null;
}

interface Batch {
  id: string;
  runDate: string;
  status: string;
  itemCount: number;
  items: BatchItem[];
  recipients: Array<{ name: string; channel?: string; sent: boolean; error?: string }>;
  decidedByName: string | null;
  decidedAt: string | null;
  result: {
    uploaded?: boolean;
    actionCount?: number;
    error?: string | null;
    skipped?: Array<{ keyword: string; reason: string }>;
    snoozedUntil?: string;
  } | null;
  canConfirm: boolean;
}

interface Snapshot {
  settings: Settings;
  streaks: { tracked: number; ready: number; snoozed: number };
  batches: Batch[];
  /** Kênh mà chính mình sẽ nhận (Telegram / Lark). */
  myChannels: string[];
  /** Người khác đang bật cấu hình ở store này. */
  others: Array<{ name: string; scope: "ALL" | "SKUS"; skus: string[] }>;
  notifyHour: number;
  canEdit: boolean;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Chờ xác nhận", className: "bg-amber-100 text-amber-800 border-amber-200" },
  CONFIRMING: { label: "Đang xử lý", className: "bg-sky-100 text-sky-800 border-sky-200" },
  DONE: { label: "Đã giảm", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  FAILED: { label: "Lỗi", className: "bg-rose-100 text-rose-800 border-rose-200" },
  SNOOZED: { label: "Đã hoãn", className: "bg-slate-100 text-slate-700 border-slate-200" },
  EXPIRED: { label: "Hết hạn", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

/** Kết nối Telegram cá nhân với bot action (nhận tin 9h + bấm Xác nhận / Hoãn ngay trên Telegram). */
function TelegramConnect({ onChange }: { onChange?: () => void }) {
  const [state, setState] = useState<{
    configured: boolean;
    botUsername: string | null;
    link: { username: string | null; name: string | null; enabled: boolean } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/ppc/auto-decrease/telegram");
    if (res.ok) setState(await res.json());
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  // Đang chờ người dùng bấm Start trong Telegram → hỏi lại trạng thái vài giây một lần.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), 3000);
    const stop = setTimeout(() => setWaiting(false), 15 * 60_000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [waiting, refresh]);
  const linked = Boolean(state?.link?.enabled);
  useEffect(() => {
    if (!linked || !waiting) return;
    const timer = setTimeout(() => { setWaiting(false); setMsg("Đã kết nối."); onChange?.(); }, 0);
    return () => clearTimeout(timer);
  }, [linked, waiting, onChange]);

  if (!state?.configured) return null;

  const call = async (method: "POST" | "DELETE", body?: object) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/ppc/auto-decrease/telegram", {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Lỗi");
      return json;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const btn = "rounded-md border border-slate-200 px-2 py-0.5 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>Telegram của tôi:</span>
      {linked ? (
        <>
          <span className="font-semibold text-emerald-700">
            đã kết nối{state.link?.username ? ` @${state.link.username}` : state.link?.name ? ` (${state.link.name})` : ""}
          </span>
          <button type="button" className={btn} disabled={busy}
            onClick={async () => { if (await call("POST", { action: "test" })) setMsg("Đã gửi tin thử."); }}>
            Gửi thử
          </button>
          <button type="button" className={btn} disabled={busy}
            onClick={async () => { if (await call("DELETE")) { setMsg("Đã ngắt."); void refresh(); onChange?.(); } }}>
            Ngắt
          </button>
        </>
      ) : (
        <button
          type="button"
          className="rounded-md bg-sky-600 px-2 py-0.5 font-bold text-white hover:bg-sky-700 cursor-pointer disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            // Mở tab trước (trình duyệt chặn popup mở sau await), rồi gán link.
            const tab = window.open("about:blank", "_blank");
            const json = await call("POST", { action: "link" });
            if (json?.url) {
              if (tab) tab.location.href = json.url;
              else window.location.href = json.url;
              setWaiting(true);
              setMsg("Bấm Start trong Telegram để hoàn tất…");
            } else tab?.close();
          }}
        >
          Kết nối Telegram{state.botUsername ? ` (@${state.botUsername})` : ""}
        </button>
      )}
      {msg && <span className="text-slate-500">{msg}</span>}
    </div>
  );
}

function AutoDecreaseHelp({ notifyHour }: { notifyHour: number }) {
  const hour = `${String(notifyHour).padStart(2, "0")}:00`;
  return (
    <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs leading-relaxed text-slate-700">
      <div>
        <div className="mb-1 font-black text-slate-900">Cách hoạt động</div>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Mỗi ngày có dữ liệu mới, hệ thống đếm số ngày liên tiếp mỗi target có đề xuất <b>giảm bid</b>.
            Đếm lại từ đầu khi: hết đề xuất giảm, có người duyệt / bỏ qua trên NCE Hub, hoặc <b>bid đã bị đổi</b>
            (kể cả sửa thẳng trên Amazon Ads).</li>
          <li>Đủ số ngày ở mục <b>Chờ chưa action</b> mà chưa ai xử lý → {hour} sáng gửi thẻ Lark cá nhân.</li>
          <li>Bấm <b>Xác nhận giảm</b> → hệ thống tính lại theo dữ liệu mới nhất, tạo file Bulk và Mac mini đẩy lên Amazon. Kết quả upload báo về Lark của người bấm.</li>
          <li>Bấm <b>Hoãn 3 ngày</b> → không nhắc lại các target đó trong 3 ngày.</li>
          <li><b>Không bấm gì thì bid không đổi.</b> Thẻ hết hạn sau 1 ngày; sáng hôm sau nhắc lại nếu đề xuất vẫn còn.</li>
        </ol>
      </div>
      <div>
        <div className="mb-1 font-black text-slate-900">Cấu hình</div>
        <ul className="list-disc space-y-0.5 pl-4">
          <li><b>Phạm vi:</b> chỉ các SKU được chọn, hoặc tất cả SKU của store. Nên bắt đầu với vài SKU.</li>
          <li><b>Chờ chưa action:</b> số ngày dữ liệu liên tiếp còn đề xuất giảm. Ngày crawler không chạy thì không tính.</li>
          <li><b>Bid mới:</b> đúng bid đề xuất của rule Auto Bid (như tab Đề xuất).</li>
          <li><b>Bid tối thiểu:</b> không hạ bid xuống dưới mức này; target đã ở sàn thì bỏ qua.</li>
          <li><b>Bỏ qua nếu vừa chỉnh:</b> target có chỉnh bid (bất kỳ màn nào) trong số ngày này thì không đưa vào thẻ.</li>
        </ul>
      </div>
      <div>
        <div className="mb-1 font-black text-slate-900">Tự động bỏ qua khi xác nhận</div>
        <p>Đề xuất giảm không còn · bid hiện tại đã khác lúc gửi thẻ · target vừa được chỉnh hoặc đang chờ upload.</p>
      </div>
      <div>
        <div className="mb-1 font-black text-slate-900">Mỗi người tự cấu hình</div>
        <p>
          Cấu hình ở đây là <b>của riêng bạn</b>. Chỉ người đã bật cấu hình mới nhận thông báo, và chỉ cho các SKU
          trong cấu hình của mình; chỉ bạn duyệt / hoãn được lô của bạn. Cần được phân quyền <b>phụ trách store</b>
          (Phân quyền Store → nhận thông báo action) và <b>Kết nối Telegram</b> (hoặc Lark) để nhận tin.
          Chưa kết nối thì lô vẫn hiện ở mục <b>Lô thông báo gần đây</b> để duyệt trên web (bỏ chọn được từng target).
          Hai người chọn trùng SKU: ai xác nhận trước thì target được giảm, lô của người kia tự bỏ qua target đó.
        </p>
      </div>
    </div>
  );
}

function parseSkus(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export function PpcAutoDecreaseSettingsModal({
  isOpen,
  onClose,
  selectedStore,
  skuOptions,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedStore?: string;
  /** SKU gợi ý khi thêm (ưu tiên SKU đang có đề xuất giảm), kèm ảnh mockup. */
  skuOptions: AutoDecreaseSkuOption[];
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [skuInput, setSkuInput] = useState("");
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [busyBatch, setBusyBatch] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedStore || selectedStore === "ALL") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ppc/auto-decrease?storeName=${encodeURIComponent(selectedStore)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Không tải được cài đặt.");
      setData(json);
      setDraft(json.settings);
      setSelected(Object.fromEntries(
        (json.batches as Batch[]).filter((b) => b.canConfirm).map((b) => [b.id, new Set(b.items.map((i) => i.recId))]),
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedStore]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [isOpen, load]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const optionBySku = useMemo(() => new Map(skuOptions.map((o) => [o.sku, o])), [skuOptions]);
  const suggestions = useMemo(() => {
    const chosen = new Set(draft?.skus || []);
    // Ô đang có danh sách dán sẵn (nhiều SKU) thì không lọc theo nó.
    const query = /[\s,;]/.test(skuInput.trim()) ? "" : skuInput.trim().toUpperCase();
    return skuOptions
      .filter((o) => !chosen.has(o.sku))
      .filter((o) => !query || o.sku.includes(query) || (o.productType || "").toUpperCase().includes(query))
      .slice(0, 50);
  }, [skuOptions, draft?.skus, skuInput]);

  if (!isOpen) return null;

  const canEdit = Boolean(data?.canEdit);
  const dirty = Boolean(data && draft && JSON.stringify(data.settings) !== JSON.stringify(draft));

  const update = (patch: Partial<Settings>) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  const addSku = (sku: string) => {
    if (!draft) return;
    update({ skus: Array.from(new Set([...draft.skus, sku])) });
    setSkuInput("");
  };
  const addSkus = () => {
    const add = parseSkus(skuInput);
    if (!add.length || !draft) return;
    update({ skus: Array.from(new Set([...draft.skus, ...add])) });
    setSkuInput("");
  };

  const save = async () => {
    if (!draft || !selectedStore) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/ppc/auto-decrease", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, ...draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Không lưu được.");
      setNotice("Đã lưu cài đặt.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const decide = async (batch: Batch, action: "confirm" | "snooze") => {
    const recIds = Array.from(selected[batch.id] || []);
    if (action === "confirm") {
      if (!recIds.length) {
        setError("Chưa chọn target nào.");
        return;
      }
      if (!window.confirm(`Giảm bid ${recIds.length} target và đẩy file Bulk lên Amazon Ads?`)) return;
    }
    setBusyBatch(batch.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/ppc/auto-decrease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, batchId: batch.id, ...(action === "confirm" ? { recIds } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Không xử lý được.");
      if (action === "snooze") setNotice(`Đã hoãn tới hết ngày ${json.snoozedUntil}.`);
      else if (json.result?.uploaded) setNotice(`Đã duyệt ${json.result.actionCount} target, file Bulk đang chờ Mac mini upload.`);
      else setError(`Chưa upload được: ${json.result?.error || "lỗi không xác định"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyBatch(null);
    }
  };

  const toggleItem = (batchId: string, recId: string) => {
    setSelected((prev) => {
      const next = new Set(prev[batchId] || []);
      if (next.has(recId)) next.delete(recId);
      else next.add(recId);
      return { ...prev, [batchId]: next };
    });
  };

  const inputCls = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none disabled:bg-slate-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <GearSix size={20} weight="bold" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-black text-slate-900">Auto giảm Bid của tôi</h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-black text-indigo-800">{selectedStore}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm font-black cursor-pointer ${
                showHelp ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 text-slate-500 hover:bg-slate-100"
              }`}
              aria-label="Hướng dẫn"
              title="Hướng dẫn sử dụng"
            >
              ?
            </button>
            <button type="button" onClick={() => { setNotice(""); setError(""); setShowHelp(false); onClose(); }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Đóng">
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-5">
          {loading && !data && (
            <div className="flex items-center gap-2 text-sm text-slate-500"><CircleNotch size={16} className="animate-spin" /> Đang tải…</div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" /> {notice}
            </div>
          )}
          {showHelp && <AutoDecreaseHelp notifyHour={data?.notifyHour ?? 9} />}
          {data && !canEdit && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Chỉ xem — bạn chưa được phân quyền phụ trách store này.
            </div>
          )}

          {draft && data && (
            <>
              {/* Bật / tắt */}
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-black text-slate-900">Bật Auto giảm Bid</div>
                <input
                  type="checkbox"
                  className="h-5 w-9 cursor-pointer accent-indigo-600"
                  checked={draft.enabled}
                  disabled={!canEdit}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />
              </label>

              {/* Phạm vi */}
              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Phạm vi áp dụng</div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["SKUS", "SKU được chọn"],
                    ["ALL", "Tất cả SKU của store"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => update({ scope: value })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold cursor-pointer disabled:cursor-not-allowed ${
                        draft.scope === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.scope === "SKUS" && (
                  <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {draft.skus.length === 0 && <span className="text-xs text-slate-400">Chưa chọn SKU nào.</span>}
                      {draft.skus.map((sku) => (
                        <span key={sku} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 py-0.5 pl-0.5 pr-2 text-xs font-bold text-indigo-800">
                          <MockupHoverZoom url={optionBySku.get(sku)?.mockupUrl} sku={sku} size={22} />
                          {sku}
                          {canEdit && (
                            <button type="button" className="cursor-pointer text-indigo-400 hover:text-indigo-700" aria-label={`Bỏ ${sku}`}
                              onClick={() => update({ skus: draft.skus.filter((s) => s !== sku) })}>
                              <X size={11} weight="bold" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {canEdit && (
                      <div className="relative">
                        <div className="flex gap-2">
                          <input
                            value={skuInput}
                            onChange={(e) => { setSkuInput(e.target.value); setPickerOpen(true); }}
                            onFocus={() => setPickerOpen(true)}
                            onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); addSkus(); }
                              if (e.key === "Escape") setPickerOpen(false);
                            }}
                            placeholder="Tìm SKU / phôi"
                            className={inputCls}
                          />
                          <button type="button" onClick={addSkus} className="shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer">
                            Thêm
                          </button>
                        </div>
                        {pickerOpen && suggestions.length > 0 && (
                          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                            {suggestions.map((opt) => (
                              <button
                                key={opt.sku}
                                type="button"
                                // onMouseDown: chạy trước onBlur của ô nhập nên danh sách không đóng mất lượt bấm.
                                onMouseDown={(e) => { e.preventDefault(); addSku(opt.sku); }}
                                className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-indigo-50 cursor-pointer"
                              >
                                <MockupHoverZoom url={opt.mockupUrl} sku={opt.sku} size={36} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-bold text-slate-800">{opt.sku}</span>
                                  <span className="block truncate text-[11px] text-slate-500">
                                    {opt.productType || "—"} · Spend ${opt.spend.toFixed(2)}
                                  </span>
                                </span>
                                {opt.decreaseCount > 0 && (
                                  <span className="shrink-0 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                    ↓ {opt.decreaseCount} giảm bid
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {(() => {
                  // Trùng phạm vi với người khác: ai xác nhận trước thì target được giảm, lô người kia tự bỏ qua target đó.
                  const mine = new Set(draft.skus);
                  const overlaps = data.others
                    .map((o) => {
                      if (o.scope === "ALL" || draft.scope === "ALL") return { name: o.name, label: o.scope === "ALL" ? "tất cả SKU" : `${o.skus.length} SKU` };
                      const shared = o.skus.filter((s) => mine.has(s));
                      return shared.length ? { name: o.name, label: shared.slice(0, 5).join(", ") + (shared.length > 5 ? ` +${shared.length - 5}` : "") } : null;
                    })
                    .filter((o): o is { name: string; label: string } => o !== null);
                  if (!overlaps.length) return null;
                  return (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Trùng với cấu hình của: {overlaps.map((o) => <span key={o.name}><b>{o.name}</b> ({o.label}) </span>)}
                      — ai xác nhận trước thì target được giảm, lô của người kia tự bỏ qua target đó.
                    </div>
                  );
                })()}
              </div>

              {/* Thông số */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Chờ chưa action</div>
                  <select className={inputCls} disabled={!canEdit} value={draft.waitDays}
                    onChange={(e) => update({ waitDays: Number(e.target.value) })}>
                    {[2, 3, 4, 5, 7, 10, 14].map((d) => <option key={d} value={d}>{d} ngày</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Bid tối thiểu</div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                    <input type="number" min={0.02} step={0.01} className={`${inputCls} pl-5`} disabled={!canEdit}
                      value={draft.minBid} onChange={(e) => update({ minBid: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Bỏ qua nếu vừa chỉnh</div>
                  <select className={inputCls} disabled={!canEdit} value={draft.cooldownDays}
                    onChange={(e) => update({ cooldownDays: Number(e.target.value) })}>
                    {[0, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d === 0 ? "Không" : `trong ${d} ngày`}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <LarkBell size={13} weight="bold" />
                    {String(data.notifyHour).padStart(2, "0")}:00 gửi riêng cho bạn qua{" "}
                    {data.myChannels.length
                      ? <span className="font-semibold text-slate-700">{data.myChannels.join(" + ")}</span>
                      : <span className="font-semibold text-rose-700">— chưa kết nối (lô vẫn hiện ở đây để duyệt)</span>}
                  </div>
                  <TelegramConnect onChange={() => void load()} />
                  <div>
                    Theo dõi <b>{data.streaks.tracked}</b> · đủ ngày <b>{data.streaks.ready}</b>
                    {data.streaks.snoozed ? <> · hoãn <b>{data.streaks.snoozed}</b></> : null}
                  </div>
                </div>
                {canEdit && (
                  <button type="button" onClick={save} disabled={!dirty || saving}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                    {saving && <CircleNotch size={13} className="animate-spin" />} Lưu cài đặt
                  </button>
                )}
              </div>

              {/* Lô gần đây */}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Lô thông báo gần đây</div>
                {data.batches.length === 0 && <div className="text-xs text-slate-400">Chưa có lô nào.</div>}
                {data.batches.map((batch) => {
                  const meta = STATUS_META[batch.status] || STATUS_META.EXPIRED;
                  const sel = selected[batch.id] || new Set<string>();
                  return (
                    <div key={batch.id} className="rounded-xl border border-slate-200">
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="text-sm font-black text-slate-800">{batch.runDate}</span>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>{meta.label}</span>
                        <span className="text-xs text-slate-500">{batch.itemCount} target</span>
                        {batch.decidedByName && <span className="text-xs text-slate-500">· {batch.decidedByName}</span>}
                        {batch.status === "PENDING" && !batch.recipients.some((r) => r.sent) && (
                          <span
                            className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                            title={batch.recipients.map((r) => `${r.name}${r.channel ? ` (${r.channel})` : ""}: ${r.error || "chưa gửi"}`).join("\n") || "Chưa có người nhận"}
                          >
                            Chưa gửi được thông báo — duyệt tại đây
                          </span>
                        )}
                        {batch.result?.error && (
                          <span className="text-xs text-rose-700" title={batch.result.error}>
                            · {batch.result.error.split("\n").filter(Boolean).pop()?.slice(0, 160)}
                          </span>
                        )}
                        {batch.result?.skipped?.length ? <span className="text-xs text-slate-500">· bỏ qua {batch.result.skipped.length}</span> : null}
                      </div>
                      {batch.canConfirm && (
                        <>
                          <div className="max-h-72 overflow-auto border-t border-slate-100">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500">
                                <tr>
                                  <th className="px-2 py-1.5 text-left">
                                    <input type="checkbox" className="cursor-pointer"
                                      checked={sel.size === batch.items.length}
                                      onChange={(e) => setSelected((prev) => ({
                                        ...prev,
                                        [batch.id]: e.target.checked ? new Set(batch.items.map((i) => i.recId)) : new Set(),
                                      }))} />
                                  </th>
                                  <th className="px-2 py-1.5 text-left">SKU</th>
                                  <th className="px-2 py-1.5 text-left">Target</th>
                                  <th className="px-2 py-1.5 text-right">Bid</th>
                                  <th className="px-2 py-1.5 text-right">Spend 30N</th>
                                  <th className="px-2 py-1.5 text-right">Hiệu quả</th>
                                  <th className="px-2 py-1.5 text-right">Ngày</th>
                                </tr>
                              </thead>
                              <tbody>
                                {batch.items.map((item) => (
                                  <tr key={item.recId} className="border-t border-slate-100">
                                    <td className="px-2 py-1">
                                      <input type="checkbox" className="cursor-pointer" disabled={!canEdit}
                                        checked={sel.has(item.recId)} onChange={() => toggleItem(batch.id, item.recId)} />
                                    </td>
                                    <td className="px-2 py-1 font-bold text-slate-700">
                                      <span className="flex items-center gap-1.5">
                                        <MockupHoverZoom url={optionBySku.get(item.sku)?.mockupUrl} sku={item.sku} size={26} />
                                        {item.sku}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1 text-slate-700" title={item.campaignName}>{item.keyword}</td>
                                    <td className="whitespace-nowrap px-2 py-1 text-right">
                                      ${item.currentBid.toFixed(2)} → <b>${item.finalBid.toFixed(2)}</b>{" "}
                                      <span className="text-rose-600">({item.changePct}%)</span>
                                    </td>
                                    <td className="px-2 py-1 text-right">${item.spend.toFixed(2)}</td>
                                    <td className="whitespace-nowrap px-2 py-1 text-right text-slate-600">
                                      {item.orders > 0 ? `ACOS ${item.acos ?? "—"}%` : `${item.clicks} click, 0 đơn`}
                                    </td>
                                    <td className="px-2 py-1 text-right">{item.seenDays}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {canEdit && (
                            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-3 py-2">
                              <button type="button" disabled={busyBatch === batch.id} onClick={() => decide(batch, "snooze")}
                                className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
                                <Pause size={13} weight="bold" /> Hoãn 3 ngày
                              </button>
                              <button type="button" disabled={busyBatch === batch.id || sel.size === 0} onClick={() => decide(batch, "confirm")}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                                {busyBatch === batch.id ? <CircleNotch size={13} className="animate-spin" /> : <CheckCircle size={13} weight="bold" />}
                                Xác nhận giảm ({sel.size})
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
