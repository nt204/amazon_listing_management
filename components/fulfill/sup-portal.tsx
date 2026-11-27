"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { LOT_COLUMNS, type LotColumn } from "@/lib/fulfill/lot-columns";
import type { FulfillLot, FulfillLotLine } from "@/lib/fulfill/types";
import { LotStageLabel, fmtInt, fmtMoney, ui } from "./fulfill-ui";

// Trang xưởng /sup — chỉ đọc. Danh sách lô của xưởng và chi tiết từng lô đúng cột file Excel gửi xưởng.

const monthName = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthOf = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : "");
const monthLabel = (k: string) => (k ? monthName.format(new Date(`${k}-01T00:00:00Z`)) : "No date");
const lotQuery = (lot: Pick<FulfillLot, "store_id" | "lot_name">) => new URLSearchParams({ storeId: lot.store_id, lot: lot.lot_name }).toString();

export function SupPortal({ name, email }: { name: string; email: string }) {
  const [lots, setLots] = useState<FulfillLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FulfillLot | null>(null);

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

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (lots ?? []).filter((l) => !needle || l.lot_name.toLowerCase().includes(needle) || l.store_name.toLowerCase().includes(needle));
  }, [lots, search]);

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
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
              <h1 className="text-xl font-bold">Requests</h1>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search lot"
                aria-label="Search lot"
                className={`${ui.input} w-full sm:w-64`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className={ui.tableHead}>
                  <tr className="border-b border-(--ff-line)">
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
                    <tr><td colSpan={7} className="py-12 text-center text-(--ff-muted)">No requests.</td></tr>
                  ) : (
                    visible.map((lot, i) => {
                      const month = monthOf(lot.first_request);
                      const showMonth = i === 0 || monthOf(visible[i - 1].first_request) !== month;
                      return (
                        <Fragment key={lot.key}>
                          {showMonth && (
                            <tr className="border-t border-(--ff-line-strong) bg-white">
                              <td colSpan={7} className="px-5 py-2.5 text-sm font-bold text-(--ff-head-text)">{monthLabel(month)}</td>
                            </tr>
                          )}
                          <tr onClick={() => setOpen(lot)} className="cursor-pointer border-t border-(--ff-line) hover:bg-neutral-50 focus-within:bg-neutral-50">
                            <td className="py-3 pr-3 pl-5">
                              <button type="button" onClick={() => setOpen(lot)} className="cursor-pointer text-left font-semibold text-(--ff-accent-hover) hover:underline focus-visible:outline-2 focus-visible:outline-(--ff-accent)">
                                {lot.lot_name}
                              </button>
                            </td>
                            <td className="px-3">{lot.store_name}</td>
                            <td className="px-3 tabular-nums">{lot.first_request ?? "—"}</td>
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
