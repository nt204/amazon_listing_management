"use client";

import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CaretDownIcon, CaretUpIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { InventoryTonResult, InventoryTonRow } from "@/lib/accounting/inventory-ton-db";
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
type Key = keyof InventoryTonRow;

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
// Nền header là class Tailwind (không chỉ style) — luật .acc-black-grid trong globals.css tô trắng mọi th không có class bg-*.
const HEAD_BG: Record<string, string> = {
  [ORANGE]: "bg-[#ff9900]",
  [YELLOW]: "bg-[#ffff00]",
  [PEACH]: "bg-[#fce5cd]",
};

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
      hint: "Tồn FBA ngày đang xem = Available + Inbound + Reserved (báo cáo FBA Inventory), cộng theo ASIN" },
    { key: "awd_total", label: "AWD", width: 86, fmt: "int", head: YELLOW, align: "right",
      hint: "Tồn AWD ngày đang xem = Available + Inbound + Reserved (AWD inventory report), cộng theo ASIN" },
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
  const [pagination, setPagination] = useState<{ rows: InventoryTonRow[]; page: number } | null>(null);
  const deferredSearch = useDeferredValue(search);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);
  // Ngày xem tồn Amazon (cột Inventory FBA / AWD / Total); "" = mới nhất
  const [stockOn, setStockOn] = useState("");

  const query = useQuery({
    queryKey: ["accounting-inventory-ton", storeId, stockOn],
    enabled: !!storeId,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<InventoryTonResult> => {
      const params = new URLSearchParams({ store_id: storeId });
      if (stockOn) params.set("date", stockOn);
      const res = await fetch(`/api/accounting/inventory/ton?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Không tải được tab TỒN");
      return data;
    },
  });

  useImperativeHandle(ref, () => ({ reload: () => void query.refetch() }), [query]);

  const year = query.data?.year ?? new Date().getFullYear();
  const columns = useMemo(() => buildColumns(year), [year]);

  const statuses = useMemo(
    () => [...new Set((query.data?.rows ?? []).map((r) => r.status?.trim()).filter(Boolean) as string[])].sort(),
    [query.data],
  );

  const rows = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();
    let list = (query.data?.rows ?? []).filter((r) => {
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
  }, [query.data, deferredSearch, statusFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = pagination?.rows === rows ? Math.min(pagination.page, totalPages) : 1;
  const pageRows = rows.slice((page - 1) * limit, page * limit);
  const totals = useMemo(() => {
    const sums: Partial<Record<Key, number>> = {};
    for (const key of TOTAL_COLUMNS) {
      sums[key] = rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
    }
    return sums;
  }, [rows]);

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
  }, [storeId, deferredSearch, statusFilter, sort, page, limit, stockOn]);

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
        {/* Ngày xem tồn Amazon: mặc định mới nhất */}
        <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span>Tồn ngày</span>
          <input
            type="date"
            value={stockOn || query.data?.stockDate || ""}
            max={new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)}
            onChange={(e) => setStockOn(e.target.value)}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 shadow-2xs focus:border-indigo-500 focus:outline-hidden"
          />
          {stockOn && (
            <button
              type="button"
              onClick={() => setStockOn("")}
              className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              title="Về tồn mới nhất"
            >
              <XIcon size={14} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {query.isError ? (
        <div className="p-6 text-sm font-semibold text-rose-600">{(query.error as Error).message}</div>
      ) : query.isLoading ? (
        <div className="p-6 text-sm text-slate-500">Đang tải tab TỒN...</div>
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
        {query.isSuccess && (
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
        {query.data?.stockDate && (
          <time dateTime={query.data.stockDate} className="block bg-slate-50 px-3 pb-1.5 text-right text-[11px] text-slate-500">
            {(() => {
              const [y, m, d] = query.data.stockDate.split("-");
              const day = `${d}/${m}/${y}`;
              if (!query.data.hasFbaStock) return "Chưa có số tồn Amazon cho ngày này — cột Inventory (FBA) / AWD để trống";
              const req = query.data.requestedDate;
              if (req && req !== query.data.stockDate) {
                return `Tồn Amazon cuối ngày ${day} (chưa có số ngày ${req.split("-").reverse().join("/")})`;
              }
              return `Tồn Amazon cuối ngày ${day}`;
            })()}
          </time>
        )}
      </div>
    </div>
  );
});
