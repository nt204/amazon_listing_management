"use client";

// Cột "Tồn" + "Giá trị tồn" real time (FBA + AWD) dùng chung cho tab Manual Bid, SKU, Đề xuất & Auto bid.
// Nguồn: /api/ppc/live-stock (accounting_live_inventory, crawler kế toán nạp lúc 16h10 mỗi ngày).
import { useEffect, useState } from "react";

export type SkuStock = { fba: number; awd: number; inbound?: number; total: number; unitCost: number | null; value: number | null };
export type StockMeta = { fbaAt: string | null; awdAt: string | null; fbaLabel: string | null; awdLabel: string | null };
export type LiveStockData = { meta: StockMeta | null; bySku: Map<string, SkuStock> };

const int = (n: number) => n.toLocaleString("en-US");
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const stockKey = (sku: string) => sku.trim().toUpperCase();

function fmtStockTime(iso: string | null): string {
  if (!iso) return "chưa có";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export function stockMetaTitle(meta: StockMeta | null | undefined): string {
  const base = "Tồn real time = kho FBA (available + inbound + reserved) + kho AWD (available + inbound + reserved).\nGiá trị tồn = Tồn × Giá TB năm (như Bảng mã).";
  if (!meta) return `${base}\nChưa có dữ liệu tồn — crawler kế toán nạp lúc 16h10 mỗi ngày.`;
  return `${base}\nNạp FBA: ${fmtStockTime(meta.fbaAt)}${meta.fbaLabel ? ` (file ${meta.fbaLabel})` : ""}\nNạp AWD: ${fmtStockTime(meta.awdAt)}${meta.awdLabel ? ` (file ${meta.awdLabel})` : ""}`;
}

const liveStockCache = new Map<string, Promise<LiveStockData>>();

async function fetchLiveStock(storeName: string): Promise<LiveStockData> {
  const res = await fetch(`/api/ppc/live-stock?storeName=${encodeURIComponent(storeName)}`, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error || "Không tải được tồn kho");
  return { meta: json.meta ?? null, bySku: new Map(Object.entries((json.items ?? {}) as Record<string, SkuStock>)) };
}

/** Tồn real time của 1 store PPC (bỏ qua khi "ALL"). Cache theo store trong phiên trang. */
export function useLiveStock(storeName: string | null | undefined): LiveStockData | null {
  const [state, setState] = useState<{ store: string; data: LiveStockData } | null>(null);
  useEffect(() => {
    if (!storeName || storeName === "ALL") return;
    let cancelled = false;
    let p = liveStockCache.get(storeName);
    if (!p) {
      p = fetchLiveStock(storeName);
      liveStockCache.set(storeName, p);
      p.catch(() => liveStockCache.delete(storeName));
    }
    p.then((data) => !cancelled && setState({ store: storeName, data })).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeName]);
  return state && state.store === storeName ? state.data : null;
}

/** 2 ô Tồn + Giá trị tồn; rê chuột vào Tồn xem từng kho + hàng đang đến. */
export function StockCells({ info, cellClassName = "px-3 py-1.5" }: { info: SkuStock | null | undefined; cellClassName?: string }) {
  if (!info) {
    return (
      <>
        <td className={`${cellClassName} text-right text-slate-300`} title="Không có trong file tồn FBA / AWD">—</td>
        <td className={`${cellClassName} text-right text-slate-300`}>—</td>
      </>
    );
  }
  const costNote = info.unitCost != null ? `Giá TB năm $${info.unitCost.toFixed(2)}` : "Chưa có giá vốn trong Bảng mã";
  const line = (label: string, value: number, cls = "text-slate-800") => (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${cls}`}>{int(value)}</span>
    </div>
  );
  return (
    <>
      <td className={`group relative ${cellClassName} text-right tabular-nums`}>
        <span className={`cursor-default font-semibold ${info.total > 0 ? "text-slate-800" : "text-rose-500"}`}>{int(info.total)}</span>
        <div className="pointer-events-none absolute right-full top-1/2 z-30 mr-1 hidden w-48 -translate-y-1/2 space-y-1 rounded-lg border border-slate-200 bg-white p-2.5 text-left text-[12px] font-normal normal-case tracking-normal shadow-xl group-hover:block">
          {line("FBA", info.fba)}
          {line("AWD", info.awd)}
          {(info.inbound ?? 0) > 0 && line("Hàng đang đến", info.inbound ?? 0, "text-sky-700")}
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1">
            <span className="font-semibold text-slate-700">Tổng</span>
            <span className="font-bold tabular-nums text-slate-900">{int(info.total)}</span>
          </div>
          {(info.inbound ?? 0) > 0 && <div className="text-[10.5px] leading-snug text-slate-400">Hàng đang đến đã tính trong FBA / AWD.</div>}
        </div>
      </td>
      <td className={`${cellClassName} text-right tabular-nums text-slate-600`} title={costNote}>
        {info.value != null ? money(info.value) : <span className="text-slate-300">—</span>}
      </td>
    </>
  );
}
