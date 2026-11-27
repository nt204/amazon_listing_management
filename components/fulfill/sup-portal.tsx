"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { LOT_COLUMNS, type LotColumn } from "@/lib/fulfill/lot-columns";
import type { FulfillLot, FulfillLotLine, FulfillLotStage } from "@/lib/fulfill/types";
import { LOT_STAGE, LOT_STAGE_ORDER, LotStageLabel, fmtInt, fmtMoney, ui } from "./fulfill-ui";
import { MonthRangePicker } from "./month-range-picker";

// Trang xưởng /sup — chỉ đọc. Danh sách lô của xưởng và chi tiết từng lô đúng cột file Excel gửi xưởng.

const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthOf = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : "");
const monthLabel = (k: string) => (k ? monthName.format(new Date(`${k}-01T00:00:00Z`)) : "No date");
const dayName = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? dayName.format(new Date(`${d}T00:00:00Z`)) : d ?? "—");
const lotQuery = (lot: Pick<FulfillLot, "store_id" | "lot_name">) => new URLSearchParams({ storeId: lot.store_id, lot: lot.lot_name }).toString();

export function SupPortal({ name, email }: { name: string; email: string }) {
  const [lots, setLots] = useState<FulfillLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [store, setStore] = useState("");
  const [stage, setStage] = useState<FulfillLotStage | "">("");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [open, setOpen] = useState<FulfillLot | null>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sup/lots", { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        if (!controller.signal.aborted) setLots(body.lots);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);

  const stores = useMemo(() => [...new Set((lots ?? []).map((l) => l.store_name))].sort(), [lots]);

  // Lọc theo tìm kiếm / tháng / store trước, rồi đếm theo trạng thái để hiện trên nút Status
  const scoped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (lots ?? []).filter((l) => {
      const m = monthOf(l.first_request);
      return (
        (!needle || l.lot_name.toLowerCase().includes(needle) || l.store_name.toLowerCase().includes(needle)) &&
        (!store || l.store_name === store) &&
        (!fromMonth || (m && m >= fromMonth)) &&
        (!toMonth || (m && m <= toMonth))
      );
    });
  }, [lots, search, store, fromMonth, toMonth]);
  const stageCounts = useMemo(() => {
    const counts: Record<FulfillLotStage, number> = { waiting: 0, in_transit: 0, receiving: 0, closed: 0, cancelled: 0 };
    for (const l of scoped) counts[l.stage] += 1;
    return counts;
  }, [scoped]);
  const visible = stage ? scoped.filter((l) => l.stage === stage) : scoped;
  const active = visible.filter((l) => l.stage !== "cancelled");
  const totalQty = active.reduce((a, l) => a + l.quantity, 0);
  const totalAmount = active.reduce((a, l) => a + l.amount, 0);

  const monthTotals = useMemo(() => {
    const map = new Map<string, { lots: number; qty: number; amount: number }>();
    for (const l of visible) {
      const k = monthOf(l.first_request);
      const t = map.get(k) ?? { lots: 0, qty: 0, amount: 0 };
      t.lots += 1;
      if (l.stage !== "cancelled") {
        t.qty += l.quantity;
        t.amount += l.amount;
      }
      map.set(k, t);
    }
    return map;
  }, [visible]);

  const monthText = fromMonth && toMonth
    ? fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} – ${monthLabel(toMonth)}`
    : "All months";
  const hasFilters = Boolean(search || store || stage || fromMonth || toMonth);
  const clear = () => {
    setSearch("");
    setStore("");
    setStage("");
    setFromMonth("");
    setToMonth("");
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-(--ff-line) bg-(--ff-side) print:hidden">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <span className="font-semibold">{name}</span>
          <span className="flex min-w-0 items-center gap-4 text-sm">
            <span className="truncate text-(--ff-muted)">{email}</span>
            <a href={process.env.NODE_ENV === "production" ? "/cdn-cgi/access/logout" : "/api/sup/dev-login"} className="shrink-0 font-medium text-(--ff-accent) hover:underline">Sign out</a>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
        {open ? (
          <SupLotDetail lot={open} onBack={() => setOpen(null)} />
        ) : (
          <section className={`${ui.card} overflow-hidden`}>
            <div className="space-y-3 px-5 pt-4 pb-3">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <h1 className="text-xl font-bold">Requests</h1>
                {lots && (
                  <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
                    <div>
                      <dt className="text-xs text-(--ff-muted)">Lots</dt>
                      <dd className="text-lg font-bold tabular-nums">{fmtInt(visible.length)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-(--ff-muted)">Quantity</dt>
                      <dd className="text-lg font-bold tabular-nums">{fmtInt(totalQty)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-(--ff-muted)">Real total</dt>
                      <dd className="text-lg font-bold text-(--ff-accent) tabular-nums">{fmtMoney(totalAmount)}</dd>
                    </div>
                  </dl>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search lot"
                  aria-label="Search lot"
                  className={`${ui.input} w-full sm:w-60`}
                />
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen((v) => !v)}
                    className={`${ui.select} inline-flex items-center gap-2 whitespace-nowrap ${fromMonth || toMonth ? "border-(--ff-accent) text-(--ff-accent)" : ""}`}
                  >
                    {monthText}
                  </button>
                  {pickerOpen && (
                    <MonthRangePicker
                      from={fromMonth}
                      to={toMonth}
                      onApply={(from, to) => {
                        setFromMonth(from);
                        setToMonth(to);
                        setPickerOpen(false);
                      }}
                      onClose={closePicker}
                    />
                  )}
                </div>
                {stores.length > 1 && (
                  <select aria-label="Name" value={store} onChange={(e) => setStore(e.target.value)} className={ui.select}>
                    <option value="">All names</option>
                    {stores.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {hasFilters && (
                  <button type="button" className={ui.link} onClick={clear}>Clear</button>
                )}
              </div>

              <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
                {(["", ...LOT_STAGE_ORDER] as Array<FulfillLotStage | "">).map((s) => {
                  const on = stage === s;
                  const n = s ? stageCounts[s] : scoped.length;
                  return (
                    <button
                      key={s || "all"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStage(s)}
                      className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 text-sm focus-visible:outline-2 focus-visible:outline-(--ff-accent) ${
                        on ? "bg-(--ff-accent) font-semibold text-white" : "text-(--ff-text-2) hover:bg-(--ff-raised)"
                      }`}
                    >
                      {s ? LOT_STAGE[s].label : "All"}
                      <span className={`rounded-full px-1.5 text-xs ${on ? "bg-white/20" : "bg-(--ff-raised) text-(--ff-muted)"}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className={ui.tableHead}>
                  <tr>
                    <th className={`${ui.th} pl-5`}>Lot</th>
                    <th className={ui.th}>Name</th>
                    <th className={ui.th}>Date request</th>
                    <th className={`${ui.th} text-right`}>SKU</th>
                    <th className={`${ui.th} text-right`}>Quantity</th>
                    <th className={`${ui.th} text-right`}>Real total</th>
                    <th className={`${ui.th} pr-5`}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {error ? (
                    <tr><td colSpan={7} className="py-12 text-center text-(--ff-neg)">{error}</td></tr>
                  ) : !lots ? (
                    <tr><td colSpan={7} className="py-12 text-center text-(--ff-muted)">Loading…</td></tr>
                  ) : visible.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-(--ff-muted)">{hasFilters ? "No lots match these filters." : "No requests."}</td></tr>
                  ) : (
                    visible.map((lot, i) => {
                      const month = monthOf(lot.first_request);
                      const showMonth = i === 0 || monthOf(visible[i - 1].first_request) !== month;
                      const t = monthTotals.get(month);
                      return (
                        <Fragment key={lot.key}>
                          {showMonth && t && (
                            <tr className="border-t border-(--ff-line-strong) bg-(--ff-head)">
                              <td colSpan={4} className="px-5 py-2.5 text-sm font-bold text-(--ff-head-text)">
                                {monthLabel(month)}
                                <span className="ml-2 font-normal text-(--ff-muted)">{t.lots} {t.lots === 1 ? "lot" : "lots"}</span>
                              </td>
                              <td className="px-3 text-right font-semibold tabular-nums text-(--ff-head-text)">{fmtInt(t.qty)}</td>
                              <td className="px-3 text-right font-bold tabular-nums text-(--ff-head-text)">{fmtMoney(t.amount)}</td>
                              <td />
                            </tr>
                          )}
                          <tr onClick={() => setOpen(lot)} className="cursor-pointer border-t border-(--ff-line) hover:bg-(--ff-raised) focus-within:bg-(--ff-raised)">
                            <td className="py-3 pr-3 pl-5">
                              <button type="button" onClick={() => setOpen(lot)} className="cursor-pointer text-left font-semibold text-(--ff-accent-hover) hover:underline focus-visible:outline-2 focus-visible:outline-(--ff-accent)">
                                {lot.lot_name}
                              </button>
                            </td>
                            <td className="px-3">{lot.store_name}</td>
                            <td className="px-3 whitespace-nowrap tabular-nums">{fmtDay(lot.first_request)}</td>
                            <td className="px-3 text-right tabular-nums">{fmtInt(lot.sku_count)}</td>
                            <td className="px-3 text-right tabular-nums">{fmtInt(lot.quantity)}</td>
                            <td className="px-3 text-right font-semibold tabular-nums">{fmtMoney(lot.amount)}</td>
                            <td className="py-3 pr-5 pl-3"><LotStageLabel stage={lot.stage} /></td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function SupMockup({ lineId }: { lineId: string }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/sup/mockup?line=${lineId}&w=112`;
  return (
    <a href={`/api/sup/mockup?line=${lineId}&w=1000`} target="_blank" rel="noreferrer" className="inline-block align-middle">
      {failed ? (
        <span className="text-(--ff-muted)">—</span>
      ) : (
        <Image src={src} alt="" width={56} height={56} unoptimized onError={() => setFailed(true)} className="size-14 rounded-md border border-(--ff-line) object-contain" />
      )}
    </a>
  );
}

function cellValue(line: FulfillLotLine, column: LotColumn) {
  const value = line[column.key];
  if (column.kind === "image") return line.mockup ? <SupMockup lineId={line.id} /> : <span className="text-(--ff-muted)">—</span>;
  if (value === null || value === undefined || value === "") return <span className="text-(--ff-muted)">—</span>;
  if (column.kind === "money") return fmtMoney(Number(value));
  if (column.kind === "int") return fmtInt(Number(value));
  if (column.kind === "link") {
    return (
      <a href={String(value)} target="_blank" rel="noreferrer" className={ui.link}>
        Open
      </a>
    );
  }
  return String(value);
}

function SupLotDetail({ lot, onBack }: { lot: FulfillLot; onBack: () => void }) {
  const [data, setData] = useState<{ lot: FulfillLot; lines: FulfillLotLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = lotQuery(lot);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sup/lots/detail?${query}`, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
        if (!controller.signal.aborted) setData(body);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query]);

  const lines = data?.lines ?? [];
  const active = lines.filter((l) => l.stage !== "cancelled");
  const totalQty = active.reduce((a, l) => a + l.quantity, 0);
  const totalAmount = active.reduce((a, l) => a + l.real_total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={onBack} className={ui.btnGhost}>← Requests</button>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className={ui.btnSecondary} disabled={!data}>Print</button>
          <a href={`/api/sup/lots/export?${query}`} download className={ui.btnPrimary}>Download Excel</a>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="text-xl font-semibold">{lot.lot_name}</h1>
        <span className="text-sm text-(--ff-text-2)">
          {lot.store_name} · {fmtInt(lot.sku_count)} SKU · {fmtInt(lot.quantity)} pcs · <strong>{fmtMoney(lot.amount)}</strong>
        </span>
      </div>

      <section className={`${ui.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap print:text-[9px]">
            <thead className={ui.tableHead}>
              <tr className="border-b border-(--ff-line)">
                <th className={`${ui.th} pl-4 text-right`}>#</th>
                {LOT_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`${ui.th} ${c.kind === "money" || c.kind === "int" ? "text-right" : ""}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--ff-line)">
              {error ? (
                <tr><td colSpan={LOT_COLUMNS.length + 1} className="py-12 text-center text-(--ff-neg)">{error}</td></tr>
              ) : !data ? (
                <tr><td colSpan={LOT_COLUMNS.length + 1} className="py-12 text-center text-(--ff-muted)">Loading…</td></tr>
              ) : (
                lines.map((line, index) => (
                  <tr key={line.id} className={`hover:bg-neutral-50 ${line.stage === "cancelled" ? "text-(--ff-muted) line-through" : ""}`}>
                    <td className="py-2 pr-2 pl-4 text-right text-xs text-(--ff-muted)">{index + 1}</td>
                    {LOT_COLUMNS.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${c.kind === "money" || c.kind === "int" ? "text-right tabular-nums" : ""} ${c.key === "sku" ? "font-mono text-xs" : ""} ${c.key === "note" ? "max-w-64 truncate" : ""}`}
                        title={c.key === "note" && line.note ? line.note : undefined}
                      >
                        {cellValue(line, c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {data && lines.length > 0 && (
              <tfoot>
                <tr className={`border-t border-(--ff-line-strong) ${ui.tableTotal}`}>
                  <th colSpan={2} scope="row" className="px-4 text-left">Total</th>
                  {LOT_COLUMNS.slice(1).map((c) => (
                    <td key={c.key} className={`px-3 py-3 ${c.kind === "money" || c.kind === "int" ? "text-right tabular-nums" : ""}`}>
                      {c.key === "quantity" ? fmtInt(totalQty) : c.key === "real_total" ? fmtMoney(totalAmount) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
