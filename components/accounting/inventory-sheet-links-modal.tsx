"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CopyIcon,
  FloppyDiskIcon,
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

const LINK_LABELS: Record<LinkType, { title: string; hint: string; parts: SheetType[] }> = {
  inventory: {
    title: "File INVENTORY",
    hint: "Link file \"<STORE> INVENTORY\" — dùng cho Bảng Mã FBA + Chi Tiết Đi Hàng",
    parts: ["sku", "inbound"],
  },
  fbm: { title: "File Bảng Mã FBM", hint: "Link file \"BẢNG MÃ FBM\" — tab FBM_<Store>", parts: ["sku_fbm"] },
};

const PART_LABELS: Record<SheetType, string> = { sku: "Bảng Mã FBA", inbound: "Chi Tiết Đi Hàng", sku_fbm: "Bảng Mã FBM" };

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

/** Lưu link (PUT) hoặc đồng bộ ngay (POST sync). */
export async function requestSheetSync(
  action: "save" | "sync",
  body: { store_id: string; link_type?: LinkType; sheet_type?: SheetType; sheet_url?: string; trigger?: "manual" | "reload" },
): Promise<SheetSyncOutcome> {
  const res = await fetch(
    action === "save" ? "/api/accounting/inventory/sheet-links" : "/api/accounting/inventory/sheet-links/sync",
    { method: action === "save" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (data && typeof data.ok === "boolean" && data.parts) return data as SheetSyncOutcome;
  return { ok: false, parts: {}, error: data?.error || "Không kết nối được máy chủ." };
}

function PartStatus({ part, link }: { part: SheetType; link: SheetLink | undefined }) {
  const outcome = link?.last_result?.parts?.[part];
  if (!outcome) return null;
  const warnings = outcome.result?.warnings ?? [];
  return (
    <p className={`flex items-start gap-1 text-[11px] ${outcome.ok ? "text-slate-500" : "font-semibold text-rose-600"}`}>
      {outcome.ok ? (
        <CheckCircleIcon size={13} weight="bold" className="mt-px shrink-0 text-emerald-600" />
      ) : (
        <WarningCircleIcon size={13} weight="bold" className="mt-px shrink-0" />
      )}
      <span className="min-w-0 break-words">
        <strong className="font-semibold text-slate-700">{PART_LABELS[part]}</strong> · {formatTime(outcome.at)} ·{" "}
        {outcome.ok && outcome.result
          ? `${outcome.result.sheetRows} dòng · ${describeSyncResult(outcome.result)}${warnings.length ? ` · ${warnings.join(" ")}` : ""}`
          : outcome.error}
      </span>
    </p>
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
    // Lỗi trước khi lưu (link sai, chưa chia sẻ, thiếu tab) không có kết quả từng phần → hiện ngay dưới ô
    if (!outcome.ok && Object.keys(outcome.parts).length === 0) setError(outcome.error ?? "Lỗi không xác định.");
    else setDraft(null);
    onChanged(meta.parts);
  };

  const remove = async () => {
    if (!confirm(`Xóa link ${meta.title} của ${store.name}? Dữ liệu đã đồng bộ vẫn giữ nguyên.`)) return;
    setBusy("delete");
    await fetch(`/api/accounting/inventory/sheet-links?store_id=${store.id}&link_type=${linkType}`, { method: "DELETE" });
    setBusy(null);
    setDraft(null);
    setError(null);
    onChanged(meta.parts);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">{meta.title}</span>
        {link?.spreadsheet_title && <span className="min-w-0 truncate text-[11px] text-slate-400">{link.spreadsheet_title}</span>}
      </div>
      <div className="flex gap-1.5">
        <input
          type="url"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty && value.trim()) run("save");
          }}
          placeholder={meta.hint}
          disabled={busy !== null}
          className="field-control min-w-0 flex-1"
        />
        {dirty && value.trim() ? (
          <button
            type="button"
            onClick={() => run("save")}
            disabled={busy !== null}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            title="Kiểm tra link, lưu và đồng bộ ngay"
          >
            {busy === "save" ? <ArrowClockwiseIcon size={14} className="animate-spin" /> : <FloppyDiskIcon size={14} weight="bold" />}
            Lưu
          </button>
        ) : link ? (
          <>
            <button
              type="button"
              onClick={() => run("sync")}
              disabled={busy !== null}
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
              title="Đồng bộ ngay cả file"
            >
              <ArrowClockwiseIcon size={15} weight="bold" className={busy === "sync" ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
              title="Xóa link"
            >
              <TrashIcon size={15} weight="bold" />
            </button>
          </>
        ) : null}
      </div>
      {busy === "save" || busy === "sync" ? (
        <p className="text-[11px] font-semibold text-indigo-700">Đang đọc sheet và đồng bộ...</p>
      ) : error ? (
        <p className="flex items-start gap-1 text-[11px] font-semibold text-rose-600">
          <WarningCircleIcon size={13} weight="bold" className="mt-px shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      ) : (
        meta.parts.map((part) => <PartStatus key={part} part={part} link={link} />)
      )}
    </div>
  );
}

interface InventorySheetLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Gọi sau mỗi lần lưu / đồng bộ / xóa (để màn hình đang mở tải lại dữ liệu nếu cần). */
  onSynced?: (storeId: string, parts: SheetType[]) => void;
}

// Cửa sổ dùng ở System Admin (không nằm trong QueryClientProvider nào) nên tự mang client riêng.
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
  if (!isOpen) return null;

  const email = linksQuery.data?.service_account_email;
  const schedule = linksQuery.data?.schedule;
  const linkFor = (storeId: string, linkType: LinkType) =>
    linksQuery.data?.links.find((link) => link.store_id === storeId && link.link_type === linkType);
  const stores = (storesQuery.data ?? []).filter((store) => store.status !== "inactive");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-slate-900">Link Google Sheet — Inventory</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {schedule && !schedule.running ? (
                <span className="font-semibold text-rose-600">Lịch tự đồng bộ đang tắt. </span>
              ) : (
                <span className="font-semibold text-emerald-700">Tự đồng bộ mỗi ngày lúc {schedule?.hour ?? 4}:00 sáng. </span>
              )}
              Nút tải lại ở từng tab Inventory đồng bộ ngay đúng tab, store đó. Import file vẫn dùng như cũ.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
            <XIcon size={20} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4 thin-scrollbar">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
            <p>
              Chia sẻ sheet quyền <strong>Người xem</strong> cho email bên dưới. Sheet là bản gốc: ô có giá trị ghi đè web, ô trống
              không xóa dữ liệu đang có. Dòng đi hàng không còn trên sheet bị xóa (khôi phục được ở Lịch sử); SKU không tự xóa.
            </p>
            {email ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5">
                <code className="min-w-0 flex-1 truncate text-[11px] text-slate-800">{email}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(email)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 cursor-pointer"
                >
                  <CopyIcon size={13} weight="bold" />
                  Copy
                </button>
              </div>
            ) : linksQuery.isFetched ? (
              <p className="mt-2 font-semibold text-rose-600">Chưa cấu hình Google service account trên server.</p>
            ) : null}
          </div>

          {linksQuery.isLoading || storesQuery.isLoading ? (
            <p className="py-6 text-center text-xs font-semibold text-slate-500">Đang tải...</p>
          ) : linksQuery.isError || storesQuery.isError ? (
            <p className="py-6 text-center text-xs font-semibold text-rose-600">
              {((linksQuery.error || storesQuery.error) as Error).message}
            </p>
          ) : (
            stores.map((store) => {
              const linkTypes: LinkType[] = [
                ...(storeHasFbaTeam(store.team) ? (["inventory"] as const) : []),
                ...(storeHasTeam(store.team, "FBM") ? (["fbm"] as const) : []),
              ];
              return (
                <section key={store.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-extrabold text-slate-900">{store.name}</h4>
                    <span className="text-[11px] font-semibold text-slate-400">{store.team || "Chưa gán team"}</span>
                  </div>
                  {linkTypes.length === 0 ? (
                    <p className="text-[11px] text-slate-500">Store chưa có team FBA/FBM nên chưa cần link.</p>
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
                </section>
              );
            })
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
