"use client";

// Dòng tiền Payout — tiền Amazon chuyển về (Disbursements), gom theo store, lọc theo khoảng ngày.
// Dữ liệu: /api/accounting/payouts (bảng accounting_payout_disbursements, status Done).

import { useEffect, useMemo, useState } from "react";
import { CaretDownIcon, CaretRightIcon, DownloadSimpleIcon, LockSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";

interface PayoutRow {
  id: string;
  store: string;
  date: string; // YYYY-MM-DD (ngày Acknowledged)
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

interface PayoutResponse {
  rows: PayoutRow[];
}

const DATE_PRESETS = ["all", "this_week", "last_week", "last_30_days", "this_month", "last_month", "ytd", "this_year", "last_year"];
const RANGE_KEY = "nce_payout_range_v3";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtUsd = (n: number) => usd.format(n);
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readRange(): DateRange {
  try {
    const saved = typeof window !== "undefined" ? JSON.parse(localStorage.getItem(RANGE_KEY) || "null") : null;
    if (saved && typeof saved.startDate === "string") return saved;
  } catch {}
  return { startDate: `${localToday().slice(0, 4)}-01-01`, endDate: localToday() };
}

function downloadCsv(filename: string, lines: (string | number)[][]) {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const blob = new Blob(["﻿" + lines.map((l) => l.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function PayoutView() {
  const [range, setRange] = useState<DateRange>(readRange);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const requestKey = `${range.startDate}|${range.endDate}`;
  const [settled, setSettled] = useState<{ key: string; data: PayoutResponse | null; error: { status: number; message: string } | null }>({
    key: "",
    data: null,
    error: null,
  });
  const loading = settled.key !== requestKey;
  const error = loading ? null : settled.error;

  useEffect(() => {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(range));
    } catch {}
  }, [range]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (range.startDate) params.set("start", range.startDate);
    if (range.endDate) params.set("end", range.endDate);
    fetch(`/api/accounting/payouts?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw { status: res.status, message: body?.error || "Không tải được dữ liệu payout." };
        setSettled({ key: requestKey, data: body as PayoutResponse, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setSettled((prev) => ({
          key: requestKey,
          data: prev.data,
          error: { status: err?.status || 0, message: err?.message || "Không tải được dữ liệu payout." },
        }));
      });
    return () => controller.abort();
  }, [range.startDate, range.endDate, requestKey]);

  // Gom theo store (A→Z) → trong mỗi store chia theo tháng, ngày tăng dần như sheet
  const groups = useMemo(() => {
    const map = new Map<string, PayoutRow[]>();
    for (const r of settled.data?.rows ?? []) map.set(r.store, [...(map.get(r.store) ?? []), r]);
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([store, rows]) => {
        rows.sort((a, b) => a.date.localeCompare(b.date));
        const months = new Map<string, PayoutRow[]>();
        for (const r of rows) months.set(r.date.slice(0, 7), [...(months.get(r.date.slice(0, 7)) ?? []), r]);
        return {
          store,
          rows,
          total: rows.reduce((s, r) => s + r.amount, 0),
          months: [...months.entries()].map(([month, list]) => ({
            month,
            rows: list,
            total: list.reduce((s, r) => s + r.amount, 0),
          })),
        };
      });
  }, [settled.data]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.store));

  const toggle = (store: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(store)) next.delete(store);
      else next.add(store);
      return next;
    });

  const exportCsv = () =>
    downloadCsv(`payout-${range.startDate || "all"}_${range.endDate || "all"}.csv`, [
      ["Brand", "Ngày Acknowledged", "Payout Amount"],
      ...groups.flatMap((g) => g.rows.map((r) => [r.store, fmtDate(r.date), r.amount.toFixed(2)])),
      ["Tổng", "", grandTotal.toFixed(2)],
    ]);

  if (error?.status === 403) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <LockSimpleIcon size={28} weight="duotone" className="mx-auto text-slate-400" />
        <p className="mt-3 text-sm text-slate-600">{error.message}</p>
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-[720px] space-y-4 px-3 pb-8 pt-4 sm:px-6 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Dòng tiền Payout</h1>
        <PpcAmazonDatePicker value={range} onChange={setRange} align="right" presets={DATE_PRESETS} anchorDate={localToday()} />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <WarningCircleIcon size={16} weight="bold" /> {error.message}
        </div>
      )}

      <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs ${loading ? "opacity-60" : ""}`}>
        {/* Tổng cả kỳ */}
        <div className="flex items-end justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-[12px] font-medium text-slate-500">Tổng tiền về</div>
            <div className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{fmtUsd(grandTotal)}</div>
            <div className="mt-0.5 text-[12px] text-slate-500">
              {groups.reduce((n, g) => n + g.rows.length, 0)} lần · {groups.length} store
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.store)))}
              className="h-8 cursor-pointer rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {allCollapsed ? "Mở hết" : "Thu gọn hết"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              <DownloadSimpleIcon size={14} weight="bold" /> CSV
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          {/* Dùng div thay <table>: tránh CSS bảng chung của Accounting ép màu / cỡ chữ / padding */}
          <div className="sticky top-0 z-20 flex justify-between border-b border-slate-200 bg-white/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
            <span>Store / Ngày Acknowledged</span>
            <span>Payout Amount</span>
          </div>
          {groups.map((g) => {
            const open = !collapsed.has(g.store);
            const share = grandTotal ? (g.total / grandTotal) * 100 : 0;
            return (
              <div key={g.store} className="border-b border-slate-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(g.store)}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-2 bg-slate-50 px-5 py-2.5 text-left hover:bg-slate-100"
                >
                  {open ? (
                    <CaretDownIcon size={12} weight="bold" className="shrink-0 text-slate-400" />
                  ) : (
                    <CaretRightIcon size={12} weight="bold" className="shrink-0 text-slate-400" />
                  )}
                  <span className="text-[14px] font-bold text-slate-900">{g.store}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                    {g.rows.length} lần · {share.toFixed(0)}%
                  </span>
                  <span className="ml-auto text-[14px] font-bold text-slate-900 tabular-nums">{fmtUsd(g.total)}</span>
                </button>
                {open && (
                  <div className="pb-2">
                    {g.months.map((m) => (
                      <div key={m.month}>
                        <div className="flex justify-between pb-1 pl-11 pr-5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          <span>
                            Tháng {Number(m.month.slice(5, 7))}/{m.month.slice(0, 4)}
                          </span>
                          <span className="tabular-nums">{fmtUsd(m.total)}</span>
                        </div>
                        {m.rows.map((r) => (
                          <div key={r.id} className="flex justify-between py-1.5 pl-11 pr-5 text-[13px] tabular-nums hover:bg-indigo-50/50">
                            <span className="text-slate-600">{fmtDate(r.date)}</span>
                            <span className="font-medium text-slate-900">{fmtUsd(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && groups.length === 0 && <p className="py-12 text-center text-sm text-slate-400">Không có payout trong khoảng ngày này</p>}
        </div>
      </section>
    </div>
  );
}
