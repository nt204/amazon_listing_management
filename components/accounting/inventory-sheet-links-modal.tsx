"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { SheetLink, SheetSyncResult, SheetType } from "@/lib/accounting/inventory-sheet-sync";
import { storeHasTeam } from "@/lib/accounting/store-teams";

export const SHEET_LINKS_QUERY_KEY = ["inventory-sheet-links"];

const SHEET_LABELS: Record<SheetType, string> = {
  sku: "Bảng Mã FBA",
  inbound: "Chi Tiết Đi Hàng",
  sku_fbm: "Bảng Mã FBM",
};

const SHEET_HINTS: Record<SheetType, string> = {
  sku: "File INVENTORY của store (tab BẢNG MÃ)",
  inbound: "File INVENTORY của store (tab CHI TIẾT ĐI HÀNG)",
  sku_fbm: "File BẢNG MÃ FBM riêng (tab FBM_<Store>)",
};

export interface SheetLinksResponse {
  links: SheetLink[];
  service_account_email: string | null;
  schedule: { enabled: boolean; running: boolean; hour: number };
}

export type SheetSyncOutcome =
  | { ok: true; result: SheetSyncResult }
  | { ok: false; error: string; skipped?: boolean };

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

/** "Thêm 3 · Sửa 5 · Xóa 1" — tóm tắt 1 lần đồng bộ. */
export function describeSyncResult(result: SheetSyncResult): string {
  const parts = [
    result.inserted && `thêm ${result.inserted}`,
    result.updated && `sửa ${result.updated}`,
    result.restored && `khôi phục ${result.restored}`,
    result.deleted && `xóa ${result.deleted}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "không có thay đổi";
}

function formatTime(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** Lưu link (PUT) hoặc đồng bộ ngay (POST sync); trả về kết quả hoặc lỗi để hiển thị. */
export async function requestSheetSync(
  action: "save" | "sync",
  body: { store_id: string; sheet_type: SheetType; sheet_url?: string; trigger?: "manual" | "reload" },
): Promise<SheetSyncOutcome> {
  const res = await fetch(
    action === "save" ? "/api/accounting/inventory/sheet-links" : "/api/accounting/inventory/sheet-links/sync",
    { method: action === "save" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const data = await res.json().catch(() => ({}));
  if (data && typeof data.ok === "boolean") return data as SheetSyncOutcome;
  return { ok: false, error: data?.error || "Không kết nối được máy chủ." };
}

function LinkRow({
  store,
  type,
  link,
  onChanged,
}: {
  store: Store;
  type: SheetType;
  link: SheetLink | undefined;
  onChanged: (type: SheetType, outcome?: SheetSyncOutcome) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "sync" | "delete" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const value = draft ?? link?.sheet_url ?? "";
  const dirty = value.trim() !== (link?.sheet_url ?? "");

  const run = async (action: "save" | "sync") => {
    setBusy(action);
    setMessage(null);
    const outcome = await requestSheetSync(action, {
      store_id: store.id,
      sheet_type: type,
      ...(action === "save" ? { sheet_url: value.trim() } : { trigger: "manual" as const }),
    });
    setBusy(null);
    if (outcome.ok) {
      setDraft(null);
      setMessage({ tone: "ok", text: `Đã đồng bộ: ${describeSyncResult(outcome.result)}` });
    } else {
      setMessage({ tone: "error", text: outcome.error });
    }
    onChanged(type, outcome);
  };

  const remove = async () => {
    if (!confirm(`Xóa link ${SHEET_LABELS[type]} của ${store.name}? Dữ liệu đã đồng bộ vẫn giữ nguyên.`)) return;
    setBusy("delete");
    await fetch(`/api/accounting/inventory/sheet-links?store_id=${store.id}&sheet_type=${type}`, { method: "DELETE" });
    setBusy(null);
    setDraft(null);
    setMessage(null);
    onChanged(type);
  };

  const status = message
    ? message
    : link?.last_status === "error"
    ? { tone: "error" as const, text: `${formatTime(link.last_synced_at)} · ${link.last_error}` }
    : link?.last_status === "success" && link.last_result
    ? {
        tone: "ok" as const,
        text: `${formatTime(link.last_synced_at)} · ${link.tab_title ?? ""} · ${describeSyncResult(link.last_result)}${
          link.last_result.warnings.length ? ` · ${link.last_result.warnings.join(" ")}` : ""
        }`,
      }
    : null;

  return (
    <div className="grid gap-1.5 sm:grid-cols-[130px_1fr] sm:items-start">
      <span className="pt-2 text-xs font-bold text-slate-700">{SHEET_LABELS[type]}</span>
      <div className="min-w-0 space-y-1">
        <div className="flex gap-1.5">
          <input
            type="url"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && value.trim()) run("save");
            }}
            placeholder={SHEET_HINTS[type]}
            disabled={busy !== null}
            className="field-control min-w-0 flex-1"
          />
          {dirty && value.trim() ? (
            <button
              type="button"
              onClick={() => run("save")}
              disabled={busy !== null}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              title="Lưu link và đồng bộ ngay"
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
                title="Đồng bộ ngay"
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
        ) : status ? (
          <p className={`flex items-start gap-1 text-[11px] ${status.tone === "error" ? "font-semibold text-rose-600" : "text-slate-500"}`}>
            {status.tone === "error" ? (
              <WarningCircleIcon size={13} weight="bold" className="mt-px shrink-0" />
            ) : (
              <CheckCircleIcon size={13} weight="bold" className="mt-px shrink-0 text-emerald-600" />
            )}
            <span className="min-w-0 break-words">{status.text}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function InventorySheetLinksModal({
  isOpen,
  onClose,
  stores,
  onSynced,
}: {
  isOpen: boolean;
  onClose: () => void;
  stores: Store[];
  /** Gọi sau mỗi lần lưu / đồng bộ / xóa để tab đang mở tải lại dữ liệu. */
  onSynced: (storeId: string, type: SheetType) => void;
}) {
  const queryClient = useQueryClient();
  const linksQuery = useSheetLinks(isOpen);
  if (!isOpen) return null;

  const email = linksQuery.data?.service_account_email;
  const linkFor = (storeId: string, type: SheetType) =>
    linksQuery.data?.links.find((link) => link.store_id === storeId && link.sheet_type === type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">Link Google Sheet</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {linksQuery.data?.schedule && !linksQuery.data.schedule.running ? (
                <span className="font-semibold text-rose-600">Lịch tự đồng bộ đang tắt. </span>
              ) : (
                <span className="font-semibold text-emerald-700">
                  Tự đồng bộ mỗi sáng {linksQuery.data?.schedule.hour ?? 9}:00.{" "}
                </span>
              )}
              Bấm nút tải lại ở tab để đồng bộ ngay. Import file vẫn dùng như cũ.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
            <XIcon size={20} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4 thin-scrollbar">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
            <p>
              Chia sẻ sheet quyền <strong>Người xem</strong> cho email bên dưới. Sheet là bản gốc: ô có giá trị sẽ ghi đè web,
              ô trống không xóa dữ liệu đang có. Chi tiết đi hàng không còn trên sheet sẽ bị xóa (khôi phục được ở Lịch sử).
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

          {linksQuery.isLoading ? (
            <p className="py-6 text-center text-xs font-semibold text-slate-500">Đang tải...</p>
          ) : linksQuery.isError ? (
            <p className="py-6 text-center text-xs font-semibold text-rose-600">{(linksQuery.error as Error).message}</p>
          ) : (
            stores.map((store) => {
              const types: SheetType[] = storeHasTeam(store.team, "FBM") ? ["sku", "inbound", "sku_fbm"] : ["sku", "inbound"];
              return (
                <section key={store.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <h4 className="text-sm font-extrabold text-slate-900">{store.name}</h4>
                  {types.map((type) => (
                    <LinkRow
                      key={`${store.id}-${type}-${linkFor(store.id, type)?.updated_at ?? "new"}`}
                      store={store}
                      type={type}
                      link={linkFor(store.id, type)}
                      onChanged={(changedType) => {
                        queryClient.invalidateQueries({ queryKey: SHEET_LINKS_QUERY_KEY });
                        onSynced(store.id, changedType);
                      }}
                    />
                  ))}
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
