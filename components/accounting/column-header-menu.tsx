"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

// Menu khi bấm vào tên cột ở các bảng Financials (theo ngày, Lọc SKU Win/Test, SKU Monthly):
// sắp xếp + tuỳ chọn cột (thu nhỏ / setting / khoá / ẩn) + lọc theo giá trị kiểu Excel — gom về một chỗ,
// để tiêu đề cột không còn nút nhỏ dễ bấm nhầm khi kéo dãn cột.

export type ValueFilters = Record<string, Set<string>>;
export const BLANK_VALUE = "(Trống)";

const PCT_IDS = new Set(["roi", "tacos", "acos", "margin", "margin_pre_ads", "return_rate"]);

/** Chữ hiển thị của một ô để lọc theo giá trị (số tiền 2 chữ số lẻ, % một chữ số lẻ, số nguyên giữ nguyên) */
export function cellFilterLabel(colId: string, v: unknown): string {
  if (v == null || v === "") return BLANK_VALUE;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return BLANK_VALUE;
    if (PCT_IDS.has(colId) || colId.includes("pct")) return `${(v * 100).toFixed(1)}%`;
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const s = String(v).trim();
  return s || BLANK_VALUE;
}

/** Dòng có qua hết bộ lọc giá trị không (bỏ qua cột `except` — để tính danh sách giá trị của chính cột đó) */
export function passesValueFilters<T>(row: T, filters: ValueFilters, getValue: (row: T, colId: string) => unknown, except?: string) {
  for (const k in filters) {
    if (k !== except && !filters[k].has(cellFilterLabel(k, getValue(row, k)))) return false;
  }
  return true;
}

export function filterOptionsFor<T>(rows: T[], colId: string, filters: ValueFilters, getValue: (row: T, colId: string) => unknown) {
  const counts = new Map<string, { count: number; sort: number | string }>();
  for (const r of rows) {
    if (!passesValueFilters(r, filters, getValue, colId)) continue;
    const raw = getValue(r, colId);
    const label = cellFilterLabel(colId, raw);
    const cur = counts.get(label);
    if (cur) cur.count += 1;
    else counts.set(label, { count: 1, sort: typeof raw === "number" ? raw : label });
  }
  return Array.from(counts.entries())
    .map(([label, v]) => ({ label, count: v.count, sort: v.sort }))
    .sort((a, b) => {
      if (a.label === BLANK_VALUE) return 1;
      if (b.label === BLANK_VALUE) return -1;
      if (typeof a.sort === "number" && typeof b.sort === "number") return a.sort - b.sort;
      return String(a.sort).localeCompare(String(b.sort), "vi", { numeric: true });
    });
}

export function ColumnHeaderMenu({
  anchor,
  title,
  sortDir,
  textSort = false,
  onSort,
  actions,
  options,
  selected,
  onApply,
  onClose,
}: {
  anchor: { x: number; y: number };
  title: string;
  /** null = cột không sắp xếp được (ẩn mục sắp xếp) */
  sortDir?: "asc" | "desc" | null;
  textSort?: boolean;
  onSort?: (dir: "asc" | "desc") => void;
  /** Các nút tuỳ chọn cột (Thu nhỏ / Setting / Khoá / Ẩn) */
  actions?: ReactNode;
  /** undefined = cột không lọc được (ẩn phần lọc) */
  options?: { label: string; count: number }[];
  selected?: Set<string>;
  onApply?: (next: Set<string> | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set((options || []).filter((o) => !selected || selected.has(o.label)).map((o) => o.label)),
  );
  const ref = useRef<HTMLDivElement>(null);

  // Đóng khi bấm ra ngoài, Esc, cuộn trang/bảng hoặc đổi cỡ cửa sổ (hộp đặt theo vị trí tiêu đề lúc mở)
  useEffect(() => {
    const inside = (t: EventTarget | null) => !!ref.current && t instanceof Node && ref.current.contains(t);
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const visible = useMemo(
    () => (options ? (term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options) : []),
    [options, term],
  );
  const checkedVisible = visible.filter((o) => draft.has(o.label)).length;

  const setMany = (labels: string[], on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev);
      for (const l of labels) {
        if (on) next.add(l);
        else next.delete(l);
      }
      return next;
    });

  // Đang tìm: chỉ giữ các giá trị khớp từ khoá và được tích (như Excel). Tích đủ mọi giá trị = bỏ lọc cột.
  const apply = () => {
    if (!options || !onApply) return;
    const next = term ? new Set(visible.filter((o) => draft.has(o.label)).map((o) => o.label)) : draft;
    onApply(options.every((o) => next.has(o.label)) ? null : next);
    onClose();
  };
  const canApply = (term ? checkedVisible : draft.size) > 0;

  const W = 290;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(anchor.x, vw - W - 8));
  const top = Math.max(8, Math.min(anchor.y + 4, vh - 260));

  const sortBtn = (dir: "asc" | "desc", label: string) => (
    <button
      type="button"
      onClick={() => {
        onSort?.(dir);
        onClose();
      }}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-100 ${sortDir === dir ? "font-semibold text-blue-700" : "text-slate-800"}`}
    >
      {dir === "asc" ? <ArrowUpIcon size={13} weight="bold" /> : <ArrowDownIcon size={13} weight="bold" />}
      {label}
      {sortDir === dir && <CheckIcon size={13} weight="bold" className="ml-auto" />}
    </button>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Tuỳ chọn cột ${title}`}
      style={{ left, top, width: W, maxHeight: vh - top - 8 }}
      className="animate-in fade-in zoom-in-95 fixed z-[200] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-2 font-sans shadow-xl duration-100"
    >
      <div className="truncate px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400" title={title}>
        {title}
      </div>
      {onSort && sortDir !== undefined && (
        <>
          {sortBtn("asc", textSort ? "Sắp xếp A → Z" : "Sắp xếp nhỏ → lớn")}
          {sortBtn("desc", textSort ? "Sắp xếp Z → A" : "Sắp xếp lớn → nhỏ")}
          <div className="my-1.5 h-px shrink-0 bg-slate-200" />
        </>
      )}
      {actions && (
        <>
          <div className="space-y-0.5" onClickCapture={() => setTimeout(onClose, 0)}>
            {actions}
          </div>
          {options && <div className="my-1.5 h-px shrink-0 bg-slate-200" />}
        </>
      )}
      {options && onApply && (
        <div className="flex min-h-0 flex-col">
          {selected && (
            <button
              type="button"
              onClick={() => {
                onApply(null);
                onClose();
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-800 hover:bg-slate-100"
            >
              <XIcon size={13} weight="bold" className="text-rose-600" />
              Xoá bộ lọc cột này
            </button>
          )}
          <div className="px-2.5 pb-1 pt-1 text-[13px] font-semibold text-slate-800">Lọc theo giá trị</div>
          <div className="flex items-center justify-between px-2.5 pb-1.5 text-xs">
            <span>
              <button type="button" onClick={() => setMany(visible.map((o) => o.label), true)} className="cursor-pointer text-blue-700 underline-offset-2 hover:underline">
                Chọn tất cả {visible.length}
              </button>
              <span className="text-slate-400"> - </span>
              <button type="button" onClick={() => setMany(visible.map((o) => o.label), false)} className="cursor-pointer text-blue-700 underline-offset-2 hover:underline">
                Xóa
              </button>
            </span>
            <span className="text-slate-500">Đang hiển thị {visible.length}</span>
          </div>
          <div className="relative mx-1 mb-1.5">
            <MagnifyingGlassIcon size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canApply) apply();
              }}
              placeholder="Tìm giá trị..."
              className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-2.5 pr-7 text-xs text-slate-800 outline-hidden focus:border-blue-500"
            />
          </div>
          <div className="mx-1 min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 py-1 scrollbar-thin" style={{ maxHeight: 220 }}>
            {visible.length === 0 && <div className="px-3 py-3 text-center text-xs text-slate-400">Không có giá trị khớp</div>}
            {visible.map((o) => {
              const on = draft.has(o.label);
              return (
                <label key={o.label} className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[13px] text-slate-800 hover:bg-slate-50">
                  <input type="checkbox" checked={on} onChange={() => setMany([o.label], !on)} className="h-3.5 w-3.5 cursor-pointer accent-emerald-700" />
                  <span className={`min-w-0 flex-1 truncate ${o.label === BLANK_VALUE ? "italic text-slate-500" : ""}`} title={o.label}>
                    {o.label}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{o.count}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex shrink-0 justify-end gap-2 px-1">
            <button type="button" onClick={onClose} className="h-8 cursor-pointer rounded-lg border border-slate-300 px-4 text-xs font-semibold text-emerald-800 hover:bg-slate-50">
              Hủy
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={apply}
              className="h-8 cursor-pointer rounded-lg bg-emerald-800 px-5 text-xs font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
