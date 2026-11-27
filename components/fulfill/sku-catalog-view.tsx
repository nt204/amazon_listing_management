"use client";

import { useEffect, useState } from "react";
import type { FulfillSku } from "@/lib/fulfill/sku-catalog";
import { MockupThumbnail, fmtInt, fmtMoney, ui } from "./fulfill-ui";

// Tab SKU Master: Bảng Mã (chỉ đọc), chỉ store team được phân. Sửa Bảng Mã ở Kế toán / sheet / Trello.

interface StoreOption {
  id: string;
  name: string;
}

const STATUS_STYLE: Record<string, string> = {
  "Phát triển": "bg-emerald-50 text-emerald-800",
  Test: "bg-amber-50 text-amber-800",
  "Hủy": "bg-red-50 text-red-800",
};

export function SkuCatalogView({ stores, selectedStoreId, onSelectStore }: { stores: StoreOption[]; selectedStoreId: string; onSelectStore: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ key: string; items: FulfillSku[]; total: number; error?: string } | null>(null);

  const params = new URLSearchParams();
  if (selectedStoreId) params.set("storeId", selectedStoreId);
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const key = params.toString();
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/fulfill/skus?${key}`, { signal: controller.signal })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
          if (!controller.signal.aborted) setResult({ key, items: body.items, total: body.total });
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setResult({ key, items: [], total: 0, error: e.message });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const items = current?.items ?? [];

  return (
    <div className="space-y-4">
      <div className={`${ui.heading} py-4! sm:py-5!`}>
        <div>
          <h1 className={ui.title}>SKU Master</h1>
          <p className="mt-1 text-sm text-(--ff-muted)">Bảng Mã from Accounting (read-only), with each SKU&apos;s latest order.</p>
        </div>
      </div>

      <section className={`${ui.card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SKU, ASIN, FNSKU, type"
            aria-label="Search SKU"
            className={`${ui.input} w-full sm:w-72`}
          />
          <select aria-label="Store" value={selectedStoreId} onChange={(e) => onSelectStore(e.target.value)} className={ui.select}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={ui.select}>
            <option value="">All statuses</option>
            <option value="Phát triển">Phát triển</option>
            <option value="Test">Test</option>
            <option value="Hủy">Hủy</option>
          </select>
          <span className="ml-auto text-sm text-(--ff-muted)">
            {current && !current.error ? `${fmtInt(current.total)} SKU${current.total > items.length ? ` · showing ${fmtInt(items.length)}` : ""}` : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm whitespace-nowrap">
            <thead className={ui.tableHead}>
              <tr>
                <th className={`${ui.th} pl-5`}>Image</th>
                <th className={ui.th}>SKU</th>
                <th className={ui.th}>Store</th>
                <th className={ui.th}>Type</th>
                <th className={ui.th}>Status</th>
                <th className={ui.th}>ASIN</th>
                <th className={ui.th}>FNSKU</th>
                <th className={ui.th}>Dimensions</th>
                <th className={ui.th}>Design</th>
                <th className={ui.th}>Last order</th>
                <th className={`${ui.th} text-right`}>Final Basecose</th>
                <th className={`${ui.th} pr-5 text-right`}>Ordered</th>
              </tr>
            </thead>
            <tbody>
              {current?.error ? (
                <tr><td colSpan={12} className="py-12 text-center text-(--ff-neg)">{current.error}</td></tr>
              ) : !current ? (
                <tr><td colSpan={12} className="py-12 text-center text-(--ff-muted)">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={12} className="py-12 text-center text-(--ff-muted)">No SKUs match.</td></tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="border-t border-(--ff-line) hover:bg-(--ff-raised)">
                    <td className="py-2 pr-3 pl-5"><MockupThumbnail url={s.mockup} size={44} /></td>
                    <td className="px-3 font-mono text-xs font-semibold">{s.sku}</td>
                    <td className="px-3">{s.store_name}</td>
                    <td className="px-3">{s.product_type ?? "—"}</td>
                    <td className="px-3">
                      {s.status ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status] ?? "bg-(--ff-raised) text-(--ff-text-2)"}`}>{s.status}</span>
                      ) : "—"}
                    </td>
                    <td className="px-3 font-mono text-xs">{s.asin ?? "—"}</td>
                    <td className="px-3 font-mono text-xs">{s.fnsku ?? "—"}</td>
                    <td className="px-3">{s.dimensions ?? "—"}</td>
                    <td className="max-w-48 truncate px-3" title={s.design ?? undefined}>
                      {s.design ? (
                        /^https?:\/\//i.test(s.design) ? <a href={s.design} target="_blank" rel="noreferrer" className={ui.link}>Open</a> : s.design
                      ) : "—"}
                    </td>
                    <td className="px-3 text-(--ff-text-2)">
                      {s.last_request ? `${s.last_request} · ${s.last_sup ?? "?"}${s.last_line_ship ? ` · ${s.last_line_ship}` : ""}` : "—"}
                    </td>
                    <td className="px-3 text-right tabular-nums">
                      {s.last_basecost != null ? fmtMoney(s.last_basecost) : s.basecost_tb != null ? fmtMoney(s.basecost_tb) : "—"}
                    </td>
                    <td className="py-2 pr-5 pl-3 text-right tabular-nums">
                      {s.ordered_qty ? `${fmtInt(s.ordered_qty)} · ${s.ordered_lots} ${s.ordered_lots === 1 ? "lot" : "lots"}` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
