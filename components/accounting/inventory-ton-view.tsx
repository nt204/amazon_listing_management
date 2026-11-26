"use client";

import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CaretDownIcon, CaretUpIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { InventoryTonResult } from "@/lib/accounting/inventory-ton-db";
import type { InventoryRangeResult, SnapshotPick } from "@/lib/accounting/inventory-range-db";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import { PaginationBar } from "./pagination-bar";

// Tab TỒN KHO dựa trên tab "TỒN" trong file <STORE> INVENTORY 2026.
// Công thức: lib/accounting/inventory-ton-db.ts.

export interface InventoryTonViewRef {
  reload: () => void;
}

interface Props {
  storeId: string;
  tableZoom?: number;
}

type Fmt = "text" | "int" | "dec" | "money";
type Key = string;
/** Dòng chung của 2 chế độ (Theo năm: InventoryTonRow, Theo ngày: InventoryRangeRow) */
type Row = {
  id: string;
  brand: string | null;
  product_type: string | null;
  mockup_url: string | null;
  sku: string;
  asin: string | null;
  status: string | null;
} & Record<string, unknown>;
type Mode = "year" | "range";

interface Col {
  key: Key;
  label: string;
  width: number;
  fmt: Fmt;
  head: string;
  /** Màu nền ô dữ liệu cố định / chỉ khi > 0 (định dạng có điều kiện của sheet) */
  cellBg?: string;
  bgWhenPositive?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  hint?: string;
}

const ORANGE = "#ff9900";
const YELLOW = "#ffff00";
const PEACH = "#fce5cd";
const CREAM = "#fff2cc";
const GREEN = "#b7e1cd";
const FROZEN = 4;
const ROW_HEIGHT = 52;
const TOTAL_COLUMNS: Key[] = [
  "ton_dau_nam", "gtri_dau_nam", "sl_di_hang", "tien_hang", "luong_ban", "ton",
  "fba_total", "awd_total", "total_amazon", "gtri_ton",
];
const RANGE_TOTAL_COLUMNS: Key[] = [
  "open_fba", "open_awd", "open_total", "received", "sold", "close_fba", "close_awd", "close_total", "close_inbound", "diff",
];
// Nền header là class Tailwind (không chỉ style) — luật .acc-black-grid trong globals.css tô trắng mọi th không có class bg-*.
const HEAD_BG: Record<string, string> = {
  [ORANGE]: "bg-[#ff9900]",
  [YELLOW]: "bg-[#ffff00]",
  [PEACH]: "bg-[#fce5cd]",
};

/** Cột chế độ "Theo ngày": tồn đầu kỳ → hàng về → bán → tồn cuối kỳ → chênh lệch (lib/accounting/inventory-range-db.ts) */
function buildRangeColumns(): Col[] {
  return [
    { key: "product_type", label: "Product Type", width: 130, fmt: "text", head: ORANGE, align: "center" },
    { key: "mockup_url", label: "Mockup", width: 72, fmt: "text", head: ORANGE, align: "center" },
    { key: "sku", label: "SKU", width: 160, fmt: "text", head: ORANGE, bold: true, align: "left" },
    { key: "asin", label: "ASIN", width: 112, fmt: "text", head: ORANGE, align: "left" },
    { key: "open_fba", label: "Đầu kỳ FBA", width: 90, fmt: "int", head: ORANGE, align: "right",
      hint: "Tồn FBA cuối ngày trước ngày bắt đầu (Available + Reserved; ảnh Inventory Ledger: hàng SELLABLE)" },
    { key: "open_awd", label: "Đầu kỳ AWD", width: 90, fmt: "int", head: ORANGE, align: "right", hint: "Tồn AWD cuối ngày trước ngày bắt đầu" },
    { key: "open_total", label: "Tồn đầu kỳ", width: 92, fmt: "int", head: ORANGE, cellBg: CREAM, bold: true, align: "right", hint: "= Đầu kỳ FBA + AWD" },
    { key: "received", label: "Hàng về", width: 84, fmt: "int", head: ORANGE, bgWhenPositive: GREEN, align: "right",
      hint: "Amazon Received (chưa có thì Quantity) các dòng Chi tiết đi hàng có Ngày đến trong kỳ" },
    { key: "sold", label: "Bán", width: 80, fmt: "int", head: ORANGE, align: "right", hint: "Units đơn FBA trong kỳ (không tính đơn huỷ)" },
    { key: "close_fba", label: "Cuối kỳ FBA", width: 90, fmt: "int", head: YELLOW, align: "right", hint: "Tồn FBA cuối ngày kết thúc" },
    { key: "close_awd", label: "Cuối kỳ AWD", width: 90, fmt: "int", head: YELLOW, align: "right", hint: "Tồn AWD cuối ngày kết thúc" },
    { key: "close_total", label: "Tồn cuối kỳ", width: 92, fmt: "int", head: YELLOW, cellBg: YELLOW, bold: true, align: "right", hint: "= Cuối kỳ FBA + AWD" },
    { key: "close_inbound", label: "Đang về", width: 80, fmt: "int", head: YELLOW, align: "right",
      hint: "Inbound FBA + AWD tại ảnh chụp cuối kỳ (chỉ có khi ảnh cuối kỳ là ảnh tồn từng ngày)" },
    { key: "diff", label: "Chênh lệch", width: 90, fmt: "int", head: YELLOW, align: "right",
      hint: "= Tồn đầu kỳ + Hàng về − Bán − Tồn cuối kỳ. Khác 0: hàng mất / hỏng / trả về / điều chỉnh của Amazon, hoặc hàng về chưa ghi Ngày đến" },
  ];
}

const vnDay = (offset = 0) => {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const shiftIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const viDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
/** Chú thích ngắn 1 đầu kỳ: "Đầu kỳ: 07/11" · "Cuối kỳ: 07/11 (thiếu 08/11)" · "Đầu kỳ: chưa có" */
function describeSide(label: string, day: string, fba: SnapshotPick | null, awd: SnapshotPick | null): string {
  const dm = (iso: string) => viDate(iso).slice(0, 5);
  if (!fba) return `${label}: chưa có`;
  const main = fba.date === day ? `${label}: ${dm(day)}` : `${label}: ${dm(fba.date)} (thiếu ${dm(day)})`;
  return awd && awd.date !== fba.date ? `${main}, AWD ${dm(awd.date)}` : main;
}

function buildColumns(year: number): Col[] {
  return [
    { key: "product_type", label: "Product Type", width: 130, fmt: "text", head: ORANGE, align: "center" },
    { key: "mockup_url", label: "Mockup", width: 72, fmt: "text", head: ORANGE, align: "center" },
    { key: "sku", label: "SKU", width: 160, fmt: "text", head: ORANGE, bold: true, align: "left" },
    { key: "asin", label: "ASIN", width: 112, fmt: "text", head: ORANGE, align: "left" },
    { key: "ton_dau_nam", label: `Hàng tồn 1/1/${year}`, width: 86, fmt: "int", head: ORANGE, cellBg: CREAM, align: "center",
      hint: `Tồn đầu kỳ tháng 1/${year} của Basecost Tháng (nạp từ tab TỒN của sheet)` },
    { key: "gtri_dau_nam", label: "Tổng giá trị tồn đầu năm", width: 104, fmt: "money", head: ORANGE, align: "right",
      hint: "= Hàng tồn 1/1 × Trung bình giá 1/1" },
    { key: "sl_di_hang", label: "SL ĐI HÀNG /NĂM", width: 86, fmt: "int", head: ORANGE, align: "right",
      hint: "= Tổng Quantity của SKU ở Chi Tiết Đi Hàng" },
    { key: "tien_hang", label: "TIỀN HÀNG/NĂM", width: 112, fmt: "money", head: ORANGE, bgWhenPositive: GREEN, align: "center",
      hint: "= Tổng Total Basecost của SKU ở Chi Tiết Đi Hàng" },
    { key: "luong_ban", label: "LƯỢNG BÁN /NĂM", width: 80, fmt: "int", head: ORANGE, align: "right",
      hint: "= Tổng hàng ra kho các tháng trong năm (SL bán − Return + Adjustment + Removal, từ file thô Amazon)" },
    { key: "ton", label: "TỒN", width: 76, fmt: "int", head: ORANGE, align: "right", hint: "= Hàng tồn 1/1 + SL đi hàng − Lượng bán" },
    { key: "fba_total", label: "Inventory (FBA)", width: 96, fmt: "int", head: YELLOW, align: "right",
      hint: "Tồn FBA mới nhất = Available + Inbound + Reserved (báo cáo FBA Inventory, crawler 16h10), cộng theo ASIN" },
    { key: "awd_total", label: "AWD", width: 86, fmt: "int", head: YELLOW, align: "right",
      hint: "Tồn AWD mới nhất = Available + Inbound + Reserved (AWD inventory report), cộng theo ASIN" },
    { key: "total_amazon", label: "Total (AMAZON)", width: 96, fmt: "int", head: YELLOW, cellBg: YELLOW, align: "right",
      hint: "= Inventory (FBA) + AWD" },
    { key: "gtri_ton", label: "Tổng giá trị tồn", width: 104, fmt: "money", head: YELLOW, align: "right", hint: "= Total (AMAZON) × Basecost TB/năm (Tiền hàng ÷ SL đi hàng; chưa đi hàng thì lấy giá 1/1)" },
    { key: "stockout_date", label: "Ngày dự kiến hết hàng", width: 126, fmt: "text", head: YELLOW, align: "center",
      hint: "Tồn hiện tại (FBA bán được mới nhất − số đã bán sau ngày chụp + AWD mới nhất) ÷ tốc độ bán trung bình 1 năm gần nhất (units FBA 365 ngày ÷ số ngày; SKU bán chưa đủ năm thì ÷ số ngày từ đơn đầu tiên). \"Đã hết\" = tồn hiện tại ≤ 0 mà vẫn đang bán. Chỉ tính trong 365 ngày, chưa cộng hàng đang về." },
  ];
}

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatValue(value: unknown, fmt: Fmt): string {
  if (fmt === "text") return value == null ? "" : String(value);
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (fmt === "int") return intFmt.format(n);
  if (fmt === "dec") return decFmt.format(n);
  return `${n < 0 ? "-" : ""}$${decFmt.format(Math.abs(n))}`;
}

export const InventoryTonView = forwardRef<InventoryTonViewRef, Props>(function InventoryTonView({ storeId, tableZoom = 100 }, ref) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [pagination, setPagination] = useState<{ rows: Row[]; page: number } | null>(null);
  // Chưa chọn ngày = bảng TỒN như sheet (tồn Amazon mới nhất); chọn khoảng ngày = bảng theo ngày
  const [range, setRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const mode: Mode = range ? "range" : "year";
  const deferredSearch = useDeferredValue(search);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);

  const query = useQuery({
    queryKey: ["accounting-inventory-ton", storeId],
    enabled: !!storeId && mode === "year",
    queryFn: async (): Promise<InventoryTonResult> => {
      const res = await fetch(`/api/accounting/inventory/ton?store_id=${storeId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Không tải được tab TỒN");
      return data;
    },
  });
  const rangeQuery = useQuery({
    queryKey: ["accounting-inventory-ton-range", storeId, range?.startDate ?? "", range?.endDate ?? ""],
    enabled: !!storeId && !!range,
    queryFn: async (): Promise<InventoryRangeResult> => {
      const params = new URLSearchParams({ store_id: storeId, mode: "range" });
      if (range) {
        params.set("start", range.startDate);
        params.set("end", range.endDate || range.startDate);
      }
      const res = await fetch(`/api/accounting/inventory/ton?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Không tải được tồn theo ngày");
      return data;
    },
  });
  const active = mode === "year" ? query : rangeQuery;
  const sourceRows = useMemo<Row[]>(
    () => ((mode === "year" ? query.data?.rows : rangeQuery.data?.rows) ?? []) as unknown as Row[],
    [mode, query.data, rangeQuery.data],
  );

  useImperativeHandle(ref, () => ({ reload: () => void active.refetch() }), [active]);

  const year = query.data?.year ?? new Date().getFullYear();
  const columns = useMemo(() => (mode === "year" ? buildColumns(year) : buildRangeColumns()), [mode, year]);
  const totalColumns = mode === "year" ? TOTAL_COLUMNS : RANGE_TOTAL_COLUMNS;

  const statuses = useMemo(
    () => [...new Set(sourceRows.map((r) => r.status?.trim()).filter(Boolean) as string[])].sort(),
    [sourceRows],
  );

  const rows = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    let list = sourceRows.filter((r) => {
      if (statusFilter && (r.status?.trim() || "") !== statusFilter) return false;
      if (!term) return true;
      return [r.sku, r.asin, r.product_type, r.brand].some((v) => v?.toLowerCase().includes(term));
    });
    if (sort) {
      const { key, dir } = sort;
      list = [...list].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        if (typeof x === "number" || typeof y === "number") return (Number(x ?? 0) - Number(y ?? 0)) * dir;
        return String(x ?? "").localeCompare(String(y ?? "")) * dir;
      });
    }
    return list;
  }, [sourceRows, deferredSearch, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = pagination?.rows === rows ? Math.min(pagination.page, totalPages) : 1;
  const pageRows = rows.slice((page - 1) * limit, page * limit);
  const totals = useMemo(() => {
    const sums: Partial<Record<Key, number>> = {};
    for (const key of totalColumns) {
      sums[key] = rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
    }
    return sums;
  }, [rows, totalColumns]);

  const leftOffsets = useMemo(() => {
    const out: number[] = [];
    let x = 0;
    columns.forEach((c, i) => {
      out[i] = x;
      if (i < FROZEN) x += c.width;
    });
    return out;
  }, [columns]);

  const scale = tableZoom / 100;
  // The scroll container measures zoomed pixels, while spacer rows are inside the zoomed table.
  const virtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT * scale,
    overscan: 8,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [scale, virtualizer]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [storeId, deferredSearch, statusFilter, sort, page, limit, mode, range]);

  const visibleRows = virtualizer.getVirtualItems();
  const firstRow = visibleRows[0];
  const lastRow = visibleRows.at(-1);
  const topSpacer = (firstRow?.start ?? 0) / scale;
  const bottomSpacer = (virtualizer.getTotalSize() - (lastRow?.end ?? 0)) / scale;
  const spacer = (height: number) => height > 0 && (
    <tr aria-hidden="true">
      <td colSpan={columns.length} className="border-0! p-0!" style={{ height }} />
    </tr>
  );

  const toggleSort = (key: Key) =>
    setSort((prev) => (prev?.key === key ? (prev.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thanh công cụ của tab */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="relative w-52 focus-within:w-64 transition-all duration-200">
          <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm SKU, ASIN, Loại SP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
              title="Xoá tìm kiếm"
            >
              <XIcon size={12} weight="bold" />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-hidden cursor-pointer shadow-2xs"
        >
          <option value="">Tất cả Trạng thái</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {/* Chọn khoảng ngày (bên phải): chọn 1 ô là xem đúng ngày đó; xoá để về bảng TỒN */}
        <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span>Từ</span>
          <input
            type="date"
            value={range?.startDate ?? ""}
            max={vnDay(0)}
            onChange={(e) => {
              const start = e.target.value;
              if (!start) return setRange(null);
              const end = range?.endDate && range.endDate >= start ? range.endDate : start;
              setRange({ startDate: start, endDate: end });
              setSort(null);
              setPagination(null);
            }}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 shadow-2xs focus:border-indigo-500 focus:outline-hidden"
          />
          <span>đến</span>
          <input
            type="date"
            value={range?.endDate ?? ""}
            max={vnDay(0)}
            onChange={(e) => {
              const end = e.target.value;
              if (!end) return setRange(null);
              const start = range?.startDate && range.startDate <= end ? range.startDate : end;
              setRange({ startDate: start, endDate: end });
              setSort(null);
              setPagination(null);
            }}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 shadow-2xs focus:border-indigo-500 focus:outline-hidden"
          />
          {range && (
            <button
              type="button"
              onClick={() => {
                setRange(null);
                setSort(null);
                setPagination(null);
              }}
              className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              title="Xoá ngày — về bảng TỒN (tồn mới nhất)"
            >
              <XIcon size={14} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {active.isError ? (
        <div className="p-6 text-sm font-semibold text-rose-600">{(active.error as Error).message}</div>
      ) : active.isLoading ? (
        <div className="p-6 text-sm text-slate-500">{mode === "year" ? "Đang tải tab TỒN..." : "Đang tải tồn theo ngày..."}</div>
      ) : (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto [overflow-anchor:none]">
          <table
            aria-rowcount={pageRows.length + (pageRows.length ? 2 : 1)}
            className="acc-inventory-data-grid border-separate border-spacing-0 text-[13px] text-slate-900"
            style={{ zoom: scale, tableLayout: "fixed", width: columns.reduce((s, c) => s + c.width, 0) }}
          >
            <colgroup>
              {columns.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="acc-inventory-column-head">
                {columns.map((c, i) => {
                  const frozen = i < FROZEN;
                  const sorted = sort?.key === c.key ? sort.dir : 0;
                  return (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      title={c.hint}
                      className={`${HEAD_BG[c.head]} h-[72px] cursor-pointer select-none border-b border-r border-slate-400 px-1.5 text-[13px] font-bold leading-tight text-black ${frozen ? "sticky z-30" : ""} ${
                        i === FROZEN - 1 ? "border-r-2 border-r-slate-600" : ""
                      }`}
                      style={{ left: frozen ? leftOffsets[i] : undefined, textAlign: c.key === "sku" ? "left" : "center" }}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {c.label}
                        {sorted === 1 ? <CaretUpIcon size={10} weight="bold" /> : sorted === -1 ? <CaretDownIcon size={10} weight="bold" /> : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
              {rows.length > 0 && (
                <tr aria-label="Tổng toàn bộ kết quả lọc">
                  {columns.map((col, index) => (
                    <td
                      key={col.key}
                      className={`border-b border-r bg-[#fff2cc] px-1.5 py-1.5 font-bold tabular-nums ${index < FROZEN ? "sticky z-10" : ""}`}
                      style={{ left: index < FROZEN ? leftOffsets[index] : undefined, textAlign: col.align }}
                    >
                      {col.key === "sku" ? "Tổng" : formatValue(totals[col.key], col.fmt)}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-6 text-center text-sm text-slate-500">
                    Không có SKU nào.
                  </td>
                </tr>
              ) : (
                <>
                {spacer(topSpacer)}
                {visibleRows.map(({ index }) => {
                  const r = pageRows[index];
                  return (
                  <tr key={r.id} aria-rowindex={index + 3} className="group">
                    {columns.map((c, i) => {
                      const frozen = i < FROZEN;
                      const raw = r[c.key];
                      const positive = c.bgWhenPositive && Number(raw) > 0;
                      const bg = c.cellBg ?? (positive ? c.bgWhenPositive : "#ffffff");
                      const negative = c.fmt !== "text" && Number(raw) < 0;
                      let content: ReactNode = formatValue(raw, c.fmt);
                      if (c.key === "mockup_url") {
                        const src = r.mockup_url?.trim();
                        content = src ? (
                          <img
                            src={getOptimizedThumbnailUrl(src, 96) || src}
                            alt={r.sku}
                            loading="lazy"
                            className="mx-auto h-11 w-11 rounded object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : null;
                      }
                      return (
                        <td
                          key={c.key}
                          className={`border-b border-r border-slate-200 px-1.5 group-hover:brightness-95 ${c.bold ? "font-bold" : ""} ${
                            frozen ? "sticky z-10" : ""
                          } ${i === FROZEN - 1 ? "border-r-2 border-r-slate-600" : ""} ${negative ? "text-rose-600" : ""} ${
                            c.fmt === "text" ? "truncate" : "tabular-nums"
                          }`}
                          style={{ height: ROW_HEIGHT, background: bg, left: frozen ? leftOffsets[i] : undefined, textAlign: c.align }}
                          title={c.fmt === "text" && typeof raw === "string" ? raw : undefined}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
                {spacer(bottomSpacer)}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0">
        {active.isSuccess && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalItems={rows.length}
            limit={limit}
            onPageChange={(nextPage) => setPagination({ rows, page: nextPage })}
            onLimitChange={(nextLimit) => {
              setLimit(nextLimit);
              setPagination(null);
            }}
            label="SKU"
          />
        )}
        {mode === "range" && rangeQuery.data && (
          <p className="bg-slate-50 px-3 pb-1.5 text-right text-[11px] text-slate-500">
            {(() => {
              const r = rangeQuery.data;
              const parts = [
                describeSide("Tồn đầu kỳ", shiftIso(r.startDate, -1), r.open.fba, r.open.awd),
                describeSide("Tồn cuối kỳ", r.endDate, r.close.fba, r.close.awd),
              ];
              if (!r.exact) parts.push("Chênh lệch trống do thiếu tồn đúng ngày");
              if (!r.exact && r.dailyDates.length > 0) parts.push(`Có tồn từng ngày từ ${viDate(r.dailyDates[0]).slice(0, 5)}`);
              return parts.join(" · ");
            })()}
          </p>
        )}
        {mode === "year" && query.data?.stockDate && (
          <time dateTime={query.data.stockDate} className="block bg-slate-50 px-3 pb-1.5 text-right text-[11px] text-slate-500">
            {(() => {
              const [y, m, d] = query.data.stockDate.split("-");
              const day = `${d}/${m}/${y}`;
              if (!query.data.hasFbaStock) return "Chưa có số tồn Amazon — cột Inventory (FBA) / AWD để trống";
              return `Tồn Amazon mới nhất: cuối ngày ${day}`;
            })()}
          </time>
        )}
      </div>
    </div>
  );
});
