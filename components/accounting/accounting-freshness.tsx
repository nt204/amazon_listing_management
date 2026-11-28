"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AccountingFreshness as Freshness, AccountingFreshnessView } from "@/lib/accounting/freshness";

export const AccountingFreshnessTarget = createContext<HTMLElement | null>(null);

const vietnamTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const vietnamDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
});
const fullTimestamp = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  dateStyle: "medium",
  timeStyle: "short",
});

function Timestamp({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <span className="whitespace-nowrap">
      <span>{label} </span>
      {value ? (
        <time dateTime={value} title={`${fullTimestamp.format(new Date(value))} (UTC+7)`} className="font-medium text-slate-700">
          {vietnamTime.format(new Date(value))} {vietnamDate.format(new Date(value))}
        </time>
      ) : <span>{value === undefined ? "…" : "—"}</span>}
    </span>
  );
}

const stockLabels = { day: "Tồn ngày", week: "Tồn tuần", month: "Tồn tháng" };

export function AccountingFreshness({ view, storeIds, storeName, channel, team, enabled = true, refreshKey, fileUpdatedAt, showStock = true, stockThrough, stockMonths }: {
  view: AccountingFreshnessView;
  storeIds?: string[];
  storeName?: string;
  channel?: "FBA" | "FBM";
  team?: string | null;
  enabled?: boolean;
  refreshKey?: number;
  fileUpdatedAt?: string | null;
  showStock?: boolean;
  stockThrough?: string;
  stockMonths?: [from: string, to: string];
}) {
  const target = useContext(AccountingFreshnessTarget);
  const params = new URLSearchParams({ view });
  if (storeIds?.length) params.set("store_ids", [...storeIds].sort().join(","));
  if (storeName) params.set("store_name", storeName);
  if (channel) params.set("channel", channel);
  if (team) params.set("team", team);
  if (!showStock) params.set("stock", "off");
  if (showStock && stockThrough) params.set("stock_through", stockThrough);
  if (showStock && stockMonths) {
    params.set("stock_from_month", stockMonths[0]);
    params.set("stock_to_month", stockMonths[1]);
  }
  const key = params.toString();
  const [result, setResult] = useState<{ key: string; data: Freshness | null } | null>(null);

  useEffect(() => {
    if (!enabled || !target) return;
    let pending: AbortController | null = null;
    const refresh = () => {
      if (pending || document.visibilityState === "hidden") return;
      const controller = new AbortController();
      pending = controller;
      fetch(`/api/accounting/freshness?${key}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const data: Freshness = await response.json();
          if (!controller.signal.aborted) setResult({ key, data });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key, data: null });
        })
        .finally(() => { pending = null; });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("accounting-import-completed", refresh);
    return () => {
      pending?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("accounting-import-completed", refresh);
    };
  }, [enabled, key, refreshKey, target]);

  if (!enabled || !target) return null;
  const current = result?.key === key ? result : null;
  const stock = current?.data?.stock;
  return createPortal(
    <div
      className="flex flex-col items-end gap-x-2 text-[10px] leading-tight text-slate-600 tabular-nums sm:flex-row sm:items-center"
      title={current && !current.data ? "Không đọc được mốc cập nhật" : "Lần cập nhật mới nhất theo store và kênh đang xem (giờ Việt Nam)"}
    >
      <Timestamp label="Dữ liệu" value={view === "files" ? fileUpdatedAt : current ? current.data?.dataAt ?? null : undefined} />
      {stock && (
        <>
          <span aria-hidden className="hidden text-slate-400 sm:inline">·</span>
          <Timestamp label={stockLabels[stock.period]} value={stock.at} />
        </>
      )}
    </div>,
    target,
  );
}
