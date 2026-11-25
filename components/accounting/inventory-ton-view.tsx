"use client";

import { forwardRef, useImperativeHandle, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretDownIcon, CaretUpIcon, InfoIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { InventoryTonResult, InventoryTonRow } from "@/lib/accounting/inventory-ton-db";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";

// Tab TỒN — dựng giống tab "TỒN" file <STORE> INVENTORY 2026 (màu header, màu ô, định dạng số, khoá 4 cột đầu,
// nhóm cột G–H thu gọn được, cột BASECOST ẩn sẵn như sheet). Công thức: lib/accounting/inventory-ton-db.ts.

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
  group?: "opening";
  hiddenByDefault?: boolean;
  hint?: string;
}

const ORANGE = "#ff9900";
const YELLOW = "#ffff00";
const PEACH = "#fce5cd";
const CREAM = "#fff2cc";
const GREEN = "#b7e1cd";
const FROZEN = 4;
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
    { key: "sku", label: "SKU", width: 160, fmt: "text", head: ORANGE, align: "left" },
    { key: "asin", label: "ASIN", width: 112, fmt: "text", head: ORANGE, bold: true, align: "left" },
    { key: "ton_dau_nam", label: `Hàng tồn 1/1/${year}`, width: 86, fmt: "int", head: ORANGE, cellBg: CREAM, align: "center",
      hint: `Tồn đầu kỳ tháng 1/${year} của Basecost Tháng (nạp từ tab TỒN của sheet)` },
    { key: "gtri_dau_nam", label: "Tổng giá trị tồn đầu năm", width: 104, fmt: "money", head: ORANGE, align: "right", group: "opening",
      hint: "= Hàng tồn 1/1 × Trung bình giá 1/1" },
    { key: "sl_di_hang", label: "SL ĐI HÀNG /NĂM", width: 86, fmt: "int", head: ORANGE, align: "right",
      hint: "= Tổng Quantity của SKU ở Chi Tiết Đi Hàng" },
    { key: "tien_hang", label: "TIỀN HÀNG/NĂM", width: 112, fmt: "money", head: ORANGE, bgWhenPositive: GREEN, align: "center",
      hint: "= Tổng Total Basecost của SKU ở Chi Tiết Đi Hàng" },
    { key: "basecost", label: "BASECOST", width: 86, fmt: "money", head: ORANGE, bgWhenPositive: GREEN, align: "center", hiddenByDefault: true,
      hint: "Số nhập tay trên sheet (đồng bộ từ tab TỒN hằng ngày)" },
    { key: "luong_ban", label: "LƯỢNG BÁN /NĂM", width: 80, fmt: "int", head: ORANGE, align: "right",
      hint: "= Tổng hàng ra kho các tháng trong năm (SL bán − Return + Adjustment + Removal, từ file thô Amazon)" },
    { key: "ton", label: "TỒN", width: 76, fmt: "int", head: ORANGE, align: "right", hint: "= Hàng tồn 1/1 + SL đi hàng − Lượng bán" },
    { key: "fba_total", label: "Inventory (FBA)", width: 96, fmt: "int", head: YELLOW, align: "right",
      hint: "Tồn kho FBA = available + inbound-quantity + Total Reserved — báo cáo FBA Inventory mới nhất, cộng theo ASIN" },
    { key: "awd_total", label: "AWD", width: 86, fmt: "int", head: YELLOW, align: "right",
      hint: "Tồn kho AWD = Available + Inbound + Reserved in AWD — AWD inventory report mới nhất, cộng theo ASIN" },
    { key: "total_amazon", label: "Total (AMAZON)", width: 96, fmt: "int", head: YELLOW, cellBg: YELLOW, align: "right",
      hint: "= Inventory (FBA) + AWD" },
    { key: "gtri_ton", label: "Tổng giá trị tồn", width: 104, fmt: "money", head: YELLOW, align: "right", hint: "= Total (AMAZON) × Basecost TB/năm (Tiền hàng ÷ SL đi hàng; chưa đi hàng thì lấy giá 1/1)" },
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

/** "2026-11-24" → "24/11/2026"; nhãn khác giữ nguyên */
function formatAmazonLabel(label: string | null): string | null {
  if (!label) return null;
  const m = label.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : label;
}

export const InventoryTonView = forwardRef<InventoryTonViewRef, Props>(function InventoryTonView({ storeId, tableZoom = 100 }, ref) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openingCollapsed, setOpeningCollapsed] = useState(false);
  const [showBasecost, setShowBasecost] = useState(false);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);

  const query = useQuery({
    queryKey: ["accounting-inventory-ton", storeId],
    enabled: !!storeId,
    queryFn: async (): Promise<InventoryTonResult> => {
      const res = await fetch(`/api/accounting/inventory/ton?store_id=${storeId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Không tải được tab TỒN");
      return data;
    },
  });

  useImperativeHandle(ref, () => ({ reload: () => void query.refetch() }), [query]);

  const year = query.data?.year ?? new Date().getFullYear();
  const columns = useMemo(
    () =>
      buildColumns(year).filter(
        (c) => !(openingCollapsed && c.group === "opening") && !(c.hiddenByDefault && !showBasecost),
      ),
    [year, openingCollapsed, showBasecost],
  );

  const statuses = useMemo(
    () => [...new Set((query.data?.rows ?? []).map((r) => r.status?.trim()).filter(Boolean) as string[])].sort(),
    [query.data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
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
  }, [query.data, search, statusFilter, sort]);

  const totals = useMemo(() => {
    const sum = (k: Key) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      ton: sum("ton"),
      total: sum("total_amazon"),
      gtriDauNam: sum("gtri_dau_nam"),
      gtriTon: sum("gtri_ton"),
    };
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

  const amazonDate = formatAmazonLabel(query.data?.amazonLabel ?? null);
  const scale = tableZoom / 100;

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
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={!openingCollapsed} onChange={(e) => setOpeningCollapsed(!e.target.checked)} className="cursor-pointer" />
          Giá trị tồn đầu năm
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
          <input type="checkbox" checked={showBasecost} onChange={(e) => setShowBasecost(e.target.checked)} className="cursor-pointer" />
          Cột BASECOST
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-900">
            Tồn: <strong>{intFmt.format(totals.ton)}</strong> · Total Amazon: <strong>{intFmt.format(totals.total)}</strong>
          </span>
          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-900">
            Giá trị tồn: <strong className="font-mono">{formatValue(totals.gtriTon, "money")}</strong>
          </span>
          <span
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-600"
            title="Lượng bán = hàng ra kho đã chốt theo tháng (SL bán − Return + Adjustment + Removal, từ file thô Amazon). Tháng vừa xong được chốt lúc 4h30 ngày 2 tháng sau."
          >
            Lượng bán chốt đến{" "}
            <strong>
              {query.data?.salesClosedThrough
                ? `T${Number(query.data.salesClosedThrough.slice(5))}/${query.data.salesClosedThrough.slice(0, 4)}`
                : "—"}
            </strong>
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-lg border border-yellow-300 px-2.5 py-1 font-semibold text-slate-800"
            style={{ background: "#fffbcc" }}
            title={query.data?.amazonImportedAt ? `Nạp lúc ${new Date(query.data.amazonImportedAt).toLocaleString("vi-VN")}` : undefined}
          >
            <InfoIcon size={13} weight="bold" />
            {amazonDate ? `Realtime từ Amazon ngày ${amazonDate} (update 4p.m hàng ngày)` : "Chưa có báo cáo FBA Inventory"}
          </span>
        </div>
      </div>

      {query.isError ? (
        <div className="p-6 text-sm font-semibold text-rose-600">{(query.error as Error).message}</div>
      ) : query.isLoading ? (
        <div className="p-6 text-sm text-slate-500">Đang tải tab TỒN...</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table
            className="border-separate border-spacing-0 text-[13px] text-slate-900"
            style={{ zoom: scale, tableLayout: "fixed", width: columns.reduce((s, c) => s + c.width, 0) }}
          >
            <colgroup>
              {columns.map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr>
                {columns.map((c, i) => {
                  const frozen = i < FROZEN;
                  const sorted = sort?.key === c.key ? sort.dir : 0;
                  return (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      title={c.hint}
                      className={`${HEAD_BG[c.head]} h-[72px] cursor-pointer select-none border-b border-r border-slate-400 px-1.5 text-[12px] font-bold leading-tight text-black ${frozen ? "sticky z-30" : ""} ${
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
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-6 text-center text-sm text-slate-500">
                    Không có SKU nào.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="group">
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
                          className={`h-[52px] border-b border-r border-slate-200 px-1.5 group-hover:brightness-95 ${c.bold ? "font-bold" : ""} ${
                            frozen ? "sticky z-10" : ""
                          } ${i === FROZEN - 1 ? "border-r-2 border-r-slate-600" : ""} ${negative ? "text-rose-600" : ""} ${
                            c.fmt === "text" ? "truncate" : "tabular-nums"
                          }`}
                          style={{ background: bg, left: frozen ? leftOffsets[i] : undefined, textAlign: c.align }}
                          title={c.fmt === "text" && typeof raw === "string" ? raw : undefined}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        Hiển thị <strong>{rows.length}</strong> / {query.data?.rows.length ?? 0} SKU · Tổng giá trị tồn đầu năm{" "}
        <strong className="font-mono">{formatValue(totals.gtriDauNam, "money")}</strong>
      </div>
    </div>
  );
});
