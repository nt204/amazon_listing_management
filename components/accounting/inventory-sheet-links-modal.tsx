"use client";

import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  FloppyDiskIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Store } from "@/lib/accounting/types";
import type {
  LinkSyncOutcome,
  LinkType,
  SheetLink,
  SheetSyncResult,
  SheetType,
} from "@/lib/accounting/inventory-sheet-sync";
import { storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";

export const SHEET_LINKS_QUERY_KEY = ["inventory-sheet-links"];

export const LINK_LABELS: Record<LinkType, { title: string; hint: string; parts: SheetType[] }> = {
  inventory: {
    title: "File INVENTORY",
    hint: "Link file \"<STORE> INVENTORY\" — dùng cho Bảng Mã FBA + Chi Tiết Đi Hàng",
    parts: ["sku", "inbound"],
  },
  fbm: { title: "File Bảng Mã FBM", hint: "Link file \"BẢNG MÃ FBM\" — tab FBM_<Store>", parts: ["sku_fbm"] },
  fbm_accounting: {
    title: "File Kế Toán Tổng Hợp FBM",
    hint: "Link file \"FBM - <STORE> - KẾ TOÁN TỔNG HỢP\" — tab ĐẦU VÀO FBM PW → Basecost FBM",
    parts: ["fbm_pw"],
  },
};

export const PART_LABELS: Record<SheetType, string> = {
  sku: "Bảng Mã FBA",
  inbound: "Chi Tiết Đi Hàng",
  sku_fbm: "Bảng Mã FBM",
  fbm_pw: "Basecost FBM",
};

export interface SheetLinksResponse {
  links: SheetLink[];
  service_account_email: string | null;
  schedule: { enabled: boolean; running: boolean; hour: number };
}

export type SheetSyncOutcome = LinkSyncOutcome & { skipped?: boolean };

export function useSheetLinks(enabled = true) {
  return useQuery({
    queryKey: SHEET_LINKS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/accounting/inventory/sheet-links");
      if (!res.ok) throw new Error("Không tải được danh sách link Google Sheet");
      return (await res.json()) as SheetLinksResponse;
    },
    enabled,
  });
}

/** "thêm 3 · sửa 5 · xóa 1" — tóm tắt 1 lần đồng bộ. */
export function describeSyncResult(result: SheetSyncResult): string {
  const parts = [
    result.inserted && `thêm ${result.inserted}`,
    result.updated && `sửa ${result.updated}`,
    result.restored && `khôi phục ${result.restored}`,
    result.deleted && `xóa ${result.deleted}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "không có thay đổi";
}

/** Tóm tắt kết quả theo từng phần: "Bảng Mã FBA: sửa 2 · Chi Tiết Đi Hàng: không có thay đổi". */
export function describeLinkOutcome(outcome: SheetSyncOutcome): string {
  return (Object.entries(outcome.parts) as [SheetType, NonNullable<SheetSyncOutcome["parts"][SheetType]>][])
    .map(([part, p]) => `${PART_LABELS[part]}: ${p.ok && p.result ? describeSyncResult(p.result) : p.error}`)
    .join(" · ");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** Hỏi xác nhận trước khi bỏ qua giới hạn an toàn (sheet thiếu nhiều dòng so với web). */
export function confirmForceSync(error: string | undefined) {
  return confirm(
    `${error ?? ""}\n\nVẫn đồng bộ theo sheet? Các dòng không còn trên sheet sẽ bị xóa (khôi phục được qua Lịch sử).`,
  );
}

/** Lưu link (PUT) hoặc đồng bộ ngay (POST sync). */
export async function requestSheetSync(
  action: "save" | "sync",
  body: { store_id: string; link_type?: LinkType; sheet_type?: SheetType; sheet_url?: string; trigger?: "manual" | "reload"; force?: boolean },
): Promise<SheetSyncOutcome> {
  const res = await fetch(
    action === "save" ? "/api/accounting/inventory/sheet-links" : "/api/accounting/inventory/sheet-links/sync",
    { method: action === "save" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (data && typeof data.ok === "boolean" && data.parts) return data as SheetSyncOutcome;
  return { ok: false, parts: {}, error: data?.error || "Không kết nối được máy chủ." };
}

function PartStatusBadge({
  part,
  link,
  onForce,
}: {
  part: SheetType;
  link: SheetLink | undefined;
  onForce: (part: SheetType) => void;
}) {
  const outcome = link?.last_result?.parts?.[part];
  if (!outcome) return null;
  const warnings = outcome.result?.warnings ?? [];

  if (!outcome.ok) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/80 px-2.5 py-1.5 text-xs text-rose-800">
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          <WarningCircleIcon size={14} weight="bold" className="mt-0.5 shrink-0 text-rose-600" />
          <div className="min-w-0">
            <span className="font-bold">{PART_LABELS[part]}: </span>
            <span className="text-rose-700">{outcome.error}</span>
          </div>
        </div>
        {outcome.blocked && (
          <button
            type="button"
            onClick={() => onForce(part)}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-rose-700 cursor-pointer transition shadow-xs"
            title="Bỏ qua giới hạn an toàn và đọc lại toàn bộ sheet vào web"
          >
            <ArrowClockwiseIcon size={12} weight="bold" />
            Vẫn đồng bộ
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
      <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
        <CheckCircleIcon size={12} weight="fill" className="text-emerald-600" />
        {PART_LABELS[part]}:
      </span>
      {outcome.result ? (
        <>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
            {outcome.result.sheetRows} dòng
          </span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800 border border-emerald-200/50">
            {describeSyncResult(outcome.result)}
          </span>
        </>
      ) : (
        <span className="text-slate-400">Đã đồng bộ</span>
      )}
      {outcome.at && <span className="text-[10px] text-slate-400">{formatTime(outcome.at)}</span>}
      {warnings.length > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 border border-amber-200/60"
          title={warnings.join("\n")}
        >
          <WarningCircleIcon size={11} weight="bold" className="text-amber-600" />
          {warnings.length === 1 ? warnings[0] : `${warnings.length} lưu ý`}
        </span>
      )}
    </div>
  );
}

function LinkRow({
  store,
  linkType,
  link,
  onChanged,
}: {
  store: Store;
  linkType: LinkType;
  link: SheetLink | undefined;
  onChanged: (parts: SheetType[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "sync" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(!link);

  const meta = LINK_LABELS[linkType];
  const value = draft ?? link?.sheet_url ?? "";
  const dirty = value.trim() !== (link?.sheet_url ?? "");

  const run = async (action: "save" | "sync") => {
    setBusy(action);
    setError(null);
    const outcome = await requestSheetSync(action, {
      store_id: store.id,
      link_type: linkType,
      ...(action === "save" ? { sheet_url: value.trim() } : { trigger: "manual" as const }),
    });
    setBusy(null);
    if (!outcome.ok && Object.keys(outcome.parts).length === 0) {
      setError(outcome.error ?? "Lỗi không xác định.");
    } else {
      setDraft(null);
      setIsEditing(false);
    }
    onChanged(meta.parts);
  };

  const forceSync = async (part: SheetType) => {
    if (!confirmForceSync(link?.last_result?.parts?.[part]?.error)) return;
    setBusy("sync");
    setError(null);
    const outcome = await requestSheetSync("sync", { store_id: store.id, sheet_type: part, trigger: "manual", force: true });
    setBusy(null);
    if (!outcome.ok && Object.keys(outcome.parts).length === 0) setError(outcome.error ?? "Lỗi không xác định.");
    onChanged([part]);
  };

  const remove = async () => {
    if (!confirm(`Xóa link ${meta.title} của ${store.name}? Dữ liệu đã đồng bộ vẫn giữ nguyên.`)) return;
    setBusy("delete");
    await fetch(`/api/accounting/inventory/sheet-links?store_id=${store.id}&link_type=${linkType}`, { method: "DELETE" });
    setBusy(null);
    setDraft(null);
    setError(null);
    setIsEditing(true);
    onChanged(meta.parts);
  };

  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-2.5 transition hover:bg-slate-50/80">
      {/* 1 Single Horizontal Row */}
      <div className="flex items-center gap-2">
        {/* Fixed-width Label */}
        <span
          className="w-46 shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 shadow-2xs border border-slate-200 truncate"
          title={meta.title}
        >
          {meta.title}
        </span>

        {/* Center: Input (when editing) OR Clickable Sheet Title (when linked) */}
        {isEditing ? (
          <input
            type="url"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) run("save");
              if (e.key === "Escape" && link) {
                setDraft(null);
                setIsEditing(false);
              }
            }}
            placeholder={meta.hint}
            disabled={busy !== null}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none shadow-2xs"
          />
        ) : link ? (
          <a
            href={link.sheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50/50 hover:border-emerald-300 transition shadow-2xs truncate"
            title="Mở file Google Sheet trong tab mới"
          >
            <span className="truncate">{link.spreadsheet_title || link.sheet_url}</span>
            <ArrowSquareOutIcon size={13} weight="bold" className="shrink-0 text-emerald-600" />
          </a>
        ) : (
          <div className="min-w-0 flex-1 text-xs text-slate-400 italic px-2">
            Chưa có liên kết
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {busy === "sync" || busy === "save" ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700">
              <ArrowClockwiseIcon size={13} className="animate-spin" />
              Đang đồng bộ...
            </span>
          ) : isEditing ? (
            <div className="flex items-center gap-1">
              {link && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setIsEditing(false);
                    setError(null);
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 transition cursor-pointer"
                >
                  Hủy
                </button>
              )}
              <button
                type="button"
                onClick={() => run("save")}
                disabled={busy !== null || !value.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 transition cursor-pointer shadow-xs shrink-0"
              >
                <FloppyDiskIcon size={13} weight="bold" />
                <span>Lưu link</span>
              </button>
            </div>
          ) : link ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => run("sync")}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-indigo-600 transition disabled:opacity-50 cursor-pointer shadow-2xs"
                title="Đồng bộ ngay file này"
              >
                <ArrowClockwiseIcon size={13} weight="bold" />
                <span>Đồng bộ</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-indigo-600 transition cursor-pointer shadow-2xs"
                title="Chỉnh sửa link Google Sheet"
              >
                <PencilSimpleIcon size={14} weight="bold" />
              </button>
              <button
                type="button"
                onClick={remove}
                className="rounded-lg border border-slate-200 bg-white p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition cursor-pointer shadow-2xs"
                title="Xóa kết nối link"
              >
                <TrashIcon size={14} weight="bold" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
            >
              + Thêm link
            </button>
          )}
        </div>
      </div>

      {/* Global error banner */}
      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <WarningCircleIcon size={14} weight="bold" className="mt-0.5 shrink-0 text-rose-600" />
          <span className="min-w-0 break-words flex-1">{error}</span>
        </div>
      )}

      {/* Status section (badges) */}
      {!isEditing && link && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200/60 pt-2 pl-1">
          {meta.parts.map((part) => (
            <PartStatusBadge key={part} part={part} link={link} onForce={forceSync} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface InventorySheetLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Gọi sau mỗi lần lưu / đồng bộ / xóa (để màn hình đang mở tải lại dữ liệu nếu cần). */
  onSynced?: (storeId: string, parts: SheetType[]) => void;
}

const sheetLinksQueryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export function InventorySheetLinksModal(props: InventorySheetLinksModalProps) {
  return (
    <QueryClientProvider client={sheetLinksQueryClient}>
      <SheetLinksModalContent {...props} />
    </QueryClientProvider>
  );
}

function SheetLinksModalContent({ isOpen, onClose, onSynced }: InventorySheetLinksModalProps) {
  const queryClient = useQueryClient();
  const linksQuery = useSheetLinks(isOpen);
  const storesQuery = useQuery({
    queryKey: ["accounting-stores-for-sheet-links"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/stores");
      if (!res.ok) throw new Error("Không tải được danh sách store");
      return ((await res.json()) as { stores: Store[] }).stores;
    },
    enabled: isOpen,
  });

  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  if (!isOpen) return null;

  const email = linksQuery.data?.service_account_email;
  const schedule = linksQuery.data?.schedule;
  const allLinks = linksQuery.data?.links ?? [];

  const linkFor = (storeId: string, linkType: LinkType) =>
    allLinks.find((link) => link.store_id === storeId && link.link_type === linkType);

  const stores = (storesQuery.data ?? [])
    .filter((store) => store.status !== "inactive")
    .sort((a, b) => a.name.localeCompare(b.name));

  // Determine store status: "ok" (all links succeeded), "error" (any link failed), "unlinked" (no links)
  const getStoreStatus = (storeId: string): "ok" | "error" | "unlinked" => {
    const storeLinks = allLinks.filter((l) => l.store_id === storeId);
    if (storeLinks.length === 0) return "unlinked";
    const hasError = storeLinks.some((l) => {
      if (l.last_status === "error") return true;
      const parts = l.last_result?.parts;
      if (parts) {
        return Object.values(parts).some((p) => p && !p.ok);
      }
      return false;
    });
    return hasError ? "error" : "ok";
  };

  const filteredStores = stores.filter((store) => {
    if (selectedStoreId !== "all" && store.id !== selectedStoreId) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return store.name.toLowerCase().includes(q) || (store.team ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const handleCopyEmail = () => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/60">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-extrabold text-slate-900">Liên kết Google Sheet — Inventory</h3>
              {schedule?.enabled && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Tự động {schedule.hour ?? 4}:00 sáng
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Quản lý link kết nối Google Sheet cho Bảng Mã FBA, Chi Tiết Đi Hàng và Basecost FBM theo từng Store.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition cursor-pointer"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        {/* Compact Service Account Bar */}
        <div className="border-b border-indigo-100 bg-indigo-50/70 px-6 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-medium text-indigo-900">
                Chia sẻ sheet quyền <strong className="font-bold text-indigo-950">Người xem</strong> cho:
              </span>
              {email ? (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-2 py-0.5 shadow-2xs">
                  <code className="text-xs font-semibold text-slate-800">{email}</code>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer transition"
                    title="Sao chép email"
                  >
                    {copied ? (
                      <>
                        <CheckIcon size={12} weight="bold" className="text-emerald-600" />
                        <span className="text-emerald-700">Đã chép</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon size={12} weight="bold" />
                        <span>Chép</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <span className="text-xs text-rose-600 font-semibold">Chưa cấu hình service account</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer transition"
            >
              <InfoIcon size={14} weight="bold" />
              <span>{showGuide ? "Ẩn lưu ý" : "Lưu ý đồng bộ"}</span>
            </button>
          </div>

          {showGuide && (
            <div className="mt-2 pt-2 border-t border-indigo-200/60 text-[11px] text-indigo-900 leading-relaxed space-y-1">
              <p>• <strong>Bản gốc là Google Sheet:</strong> Ô có giá trị trên sheet sẽ ghi đè lên web; ô trống trên sheet sẽ không xóa dữ liệu cũ đang có trên web.</p>
              <p>• <strong>Dòng đi hàng:</strong> Nếu không còn trên sheet sẽ bị đánh dấu xóa (có thể khôi phục ở tab Lịch sử). Bảng Mã SKU không tự xóa.</p>
              <p>• Nút tải lại ở từng bảng sẽ đồng bộ dữ liệu ngay lập tức cho tab và store đang chọn.</p>
            </div>
          )}
        </div>

        {/* Store Tabs Filter & Quick Search */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-2.5 bg-white gap-3">
          {/* Store Pills (Horizontal scroll) */}
          <div className="flex items-center gap-1.5 overflow-x-auto thin-scrollbar py-0.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSelectedStoreId("all")}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
                selectedStoreId === "all"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Tất cả ({stores.length})
            </button>

            {stores.map((s) => {
              const status = getStoreStatus(s.id);
              const isSelected = selectedStoreId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedStoreId(s.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "ok"
                        ? "bg-emerald-500"
                        : status === "error"
                        ? "bg-rose-500"
                        : "bg-slate-300"
                    }`}
                  />
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Search */}
          {selectedStoreId === "all" && (
            <div className="relative shrink-0 w-44">
              <MagnifyingGlassIcon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm store..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-400 outline-none"
              />
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="space-y-4 overflow-y-auto px-6 py-4 thin-scrollbar flex-1 bg-slate-50/40">
          {linksQuery.isLoading || storesQuery.isLoading ? (
            <div className="py-12 text-center text-xs font-semibold text-slate-500 flex flex-col items-center gap-2">
              <ArrowClockwiseIcon size={20} className="animate-spin text-indigo-600" />
              <span>Đang tải danh sách liên kết...</span>
            </div>
          ) : linksQuery.isError || storesQuery.isError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-xs font-semibold text-rose-700">
              {((linksQuery.error || storesQuery.error) as Error).message}
            </div>
          ) : filteredStores.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Không tìm thấy store nào phù hợp.
            </div>
          ) : (
            filteredStores.map((store) => {
              const linkTypes: LinkType[] = [
                ...(storeHasFbaTeam(store.team) ? (["inventory"] as const) : []),
                ...(storeHasTeam(store.team, "FBM") ? (["fbm", "fbm_accounting"] as const) : []),
              ];
              const storeStatus = getStoreStatus(store.id);

              return (
                <section
                  key={store.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:border-slate-300"
                >
                  {/* Store Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          storeStatus === "ok"
                            ? "bg-emerald-500"
                            : storeStatus === "error"
                            ? "bg-rose-500"
                            : "bg-slate-300"
                        }`}
                        title={
                          storeStatus === "ok"
                            ? "Tất cả link hoạt động tốt"
                            : storeStatus === "error"
                            ? "Có link gặp lỗi đồng bộ"
                            : "Chưa cấu hình link"
                        }
                      />
                      <h4 className="text-sm font-extrabold text-slate-900">{store.name}</h4>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200/60">
                        {store.team || "Chưa gán team"}
                      </span>
                    </div>

                    {selectedStoreId === "all" && (
                      <button
                        type="button"
                        onClick={() => setSelectedStoreId(store.id)}
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                      >
                        Chỉ xem store này →
                      </button>
                    )}
                  </div>

                  {/* Links for this store */}
                  <div className="mt-3 space-y-2.5">
                    {linkTypes.length === 0 ? (
                      <p className="text-xs text-slate-400 py-1">Store chưa có team FBA/FBM nên chưa cần cấu hình link.</p>
                    ) : (
                      linkTypes.map((linkType) => (
                        <LinkRow
                          key={`${store.id}-${linkType}-${linkFor(store.id, linkType)?.updated_at ?? "new"}`}
                          store={store}
                          linkType={linkType}
                          link={linkFor(store.id, linkType)}
                          onChanged={(parts) => {
                            queryClient.invalidateQueries({ queryKey: SHEET_LINKS_QUERY_KEY });
                            onSynced?.(store.id, parts);
                          }}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-white">
          <div className="text-xs text-slate-400">
            {selectedStoreId !== "all" && (
              <button
                type="button"
                onClick={() => setSelectedStoreId("all")}
                className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
              >
                ← Xem tất cả các store
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer shadow-xs"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
