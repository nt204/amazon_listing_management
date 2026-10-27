"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowClockwiseIcon, WarehouseIcon } from "@phosphor-icons/react";
import type { InventoryStockItem } from "@/lib/accounting/inventory-ledger-db";
import { type ColumnConfig, DEFAULT_INVENTORY_STOCK_COLUMNS, ColumnHeaderCell } from "./column-manager-modal";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";

// 2 cột cộng lại thành Tồn kho được tô vàng giống sheet gốc.
const YELLOW_COLUMNS = new Set(["in_transit_between_warehouses", "ending_warehouse_balance"]);

interface InventoryStockViewProps {
  /** Các dòng của trang hiện tại (đã lọc, đã phân trang ở component cha). */
  rows: InventoryStockItem[];
  startIndex: number;
  loading: boolean;
  emptyMessage: React.ReactNode;
  summary: { rows: number; skus: number; tonKho: number; inTransit: number; ending: number; snapshotDate: string | null };
  tableZoom?: number;
  columns?: ColumnConfig[];
  frozenThrough?: string;
  onResizeColumn?: (colId: string, width: number) => void;
  onAutoFitColumn?: (colId: string) => void;
  onReorderColumns?: (sourceId: string, targetId: string) => void;
  onColumnContextMenu?: (field: string, x: number, y: number) => void;
  onPreviewImage?: (url: string, title: string) => void;
}

function getColumnWidth(column?: ColumnConfig, fallback = 120): number {
  if (!column?.width) return fallback;
  if (typeof column.width === "number") return column.width;
  const match = column.width.match(/w-\[(\d+)px\]/);
  if (match) return Number(match[1]);
  const num = parseInt(column.width, 10);
  return !isNaN(num) && num > 0 ? num : fallback;
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString("en-US");
}

export function formatSnapshotDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : value;
}

export function InventoryStockView({
  rows,
  startIndex,
  loading,
  emptyMessage,
  summary,
  tableZoom = 90,
  columns: propColumns,
  frozenThrough = "sku",
  onResizeColumn,
  onAutoFitColumn,
  onReorderColumns,
  onColumnContextMenu,
  onPreviewImage,
}: InventoryStockViewProps) {
  const [headerDragId, setHeaderDragId] = useState<string | null>(null);
  const [headerDragOverId, setHeaderDragOverId] = useState<string | null>(null);

  const activeColumns = useMemo(() => {
    const source = propColumns && propColumns.length > 0 ? propColumns : DEFAULT_INVENTORY_STOCK_COLUMNS;
    return source.filter((c) => c.visible !== false);
  }, [propColumns]);

  const freezeMap = useMemo(() => {
    const lastFrozenIndex = activeColumns.findIndex((c) => c.id === (frozenThrough || "sku"));
    let leftSum = 0;
    const map: Record<string, { isFrozen: boolean; isBoundary: boolean; left: number; width: number }> = {};
    activeColumns.forEach((col, idx) => {
      const width = getColumnWidth(col);
      const isFrozen = lastFrozenIndex >= 0 && idx <= lastFrozenIndex;
      map[col.id] = { isFrozen, isBoundary: isFrozen && idx === lastFrozenIndex, left: isFrozen ? leftSum : 0, width };
      if (isFrozen) leftSum += width;
    });
    return map;
  }, [activeColumns, frozenThrough]);

  const getCellFreezeProps = useCallback(
    (colId: string, isHeader = false) => {
      const freeze = freezeMap[colId];
      const width = freeze?.width || 120;
      const sizing = { width, minWidth: width, maxWidth: width };
      if (!freeze?.isFrozen) return { isFrozen: false, isBoundary: false, style: sizing as React.CSSProperties, className: "" };
      return {
        isFrozen: true,
        isBoundary: freeze.isBoundary,
        style: {
          ...sizing,
          position: "sticky",
          left: freeze.left,
          zIndex: isHeader ? 40 : 20,
          ...(isHeader ? { backgroundColor: "#f59e0b" } : {}),
        } as React.CSSProperties,
        className: isHeader
          ? `bg-[#f59e0b] text-slate-950 ${freeze.isBoundary ? "border-r-2 !border-r-amber-900" : "border-r border-amber-600"}`
          : `bg-white group-even:bg-[#f8fafc] group-hover:bg-[#fef9c3] ${
              freeze.isBoundary ? "border-r-2 !border-r-slate-400" : "border-r border-slate-300"
            }`,
      };
    },
    [freezeMap],
  );

  const renderCell = (col: ColumnConfig, item: InventoryStockItem, stt: number) => {
    const f = getCellFreezeProps(col.id);
    const base = `py-1.5 px-3 text-[13px] ${f.isFrozen ? f.className : "border-r border-slate-200"}`;
    const align = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "";

    switch (col.id) {
      case "stt":
        return (
          <td key={col.id} style={f.style} className={`${base} text-center font-medium text-slate-700 tabular-nums`}>
            {stt}
          </td>
        );
      case "mockup":
        return (
          <td key={col.id} style={f.style} className={`${base} text-center !py-1`}>
            {item.mockup ? (
              <button
                type="button"
                onClick={() => onPreviewImage?.(item.mockup!, item.sku)}
                className="inline-block w-9 h-9 rounded overflow-hidden border border-slate-200 hover:scale-105 transition-transform cursor-pointer"
                title="Xem ảnh lớn"
              >
                <img
                  src={getOptimizedThumbnailUrl(item.mockup, 72) || item.mockup}
                  alt={item.sku}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => ((e.target as HTMLElement).style.display = "none")}
                />
              </button>
            ) : (
              <span className="text-slate-300">—</span>
            )}
          </td>
        );
      case "sku":
        return (
          <td key={col.id} style={f.style} className={`${base} font-bold text-slate-900 truncate`} title={item.sku}>
            {item.sku}
          </td>
        );
      case "asin":
        return (
          <td key={col.id} style={f.style} className={`${base} ${align} truncate`}>
            {item.asin ? (
              <a href={`https://www.amazon.com/dp/${item.asin}`} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                {item.asin}
              </a>
            ) : (
              "—"
            )}
          </td>
        );
      case "disposition": {
        const sellable = item.disposition === "SELLABLE";
        return (
          <td key={col.id} style={f.style} className={`${base} ${align}`}>
            {item.disposition ? (
              <span
                className={`inline-flex rounded px-2 py-0.5 text-[11px] font-bold ${
                  sellable ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                {item.disposition}
              </span>
            ) : (
              "—"
            )}
          </td>
        );
      }
      case "report_date":
        return (
          <td key={col.id} style={f.style} className={`${base} ${align} tabular-nums`}>
            {formatSnapshotDate(item.report_date)}
          </td>
        );
      case "ton_kho":
        return (
          <td key={col.id} style={f.style} className={`${base} ${align} !bg-[#fff59d] font-black text-slate-950 tabular-nums`}>
            {formatQty(item.ton_kho)}
          </td>
        );
    }

    const value = (item as unknown as Record<string, unknown>)[col.id];
    if (col.type === "number") {
      const n = Number(value ?? 0);
      return (
        <td
          key={col.id}
          style={f.style}
          className={`${base} ${align} tabular-nums ${YELLOW_COLUMNS.has(col.id) ? "!bg-[#fffde7] font-semibold" : ""} ${
            n < 0 ? "text-rose-600" : n === 0 ? "text-slate-400" : "text-slate-800"
          }`}
        >
          {formatQty(n)}
        </td>
      );
    }
    const text = value == null || value === "" ? "—" : String(value);
    return (
      <td key={col.id} style={f.style} className={`${base} ${align} truncate text-slate-800`} title={text}>
        {text}
      </td>
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs bg-slate-100/70 border-b border-slate-200/80 text-slate-600">
        <span>
          Ngày chốt sổ: <strong className="text-slate-900">{formatSnapshotDate(summary.snapshotDate)}</strong>
        </span>
        <span>•</span>
        <span>
          SKU: <strong className="text-slate-900">{formatQty(summary.skus)}</strong> ({formatQty(summary.rows)} dòng)
        </span>
        <span>•</span>
        <span>
          In Transit: <strong className="text-slate-900 tabular-nums">{formatQty(summary.inTransit)}</strong>
        </span>
        <span>+</span>
        <span>
          Ending: <strong className="text-slate-900 tabular-nums">{formatQty(summary.ending)}</strong>
        </span>
        <span>=</span>
        <span className="rounded bg-[#fff59d] px-2 py-0.5 text-slate-950">
          Tồn kho: <strong className="tabular-nums">{formatQty(summary.tonKho)}</strong> units
        </span>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[480px] scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-slate-100 [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
        <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
          <table className="min-w-max w-full table-fixed border-separate border-spacing-0 text-left text-sm">
            <colgroup>
              {activeColumns.map((c) => (
                <col key={c.id} style={{ width: getColumnWidth(c) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
              <tr className="text-xs font-semibold uppercase tracking-[0.04em]">
                {activeColumns.map((col) => {
                  const f = getCellFreezeProps(col.id, true);
                  const yellow = col.id === "ton_kho" || YELLOW_COLUMNS.has(col.id);
                  return (
                    <ColumnHeaderCell
                      key={col.id}
                      col={col}
                      style={yellow && !f.isFrozen ? { ...f.style, backgroundColor: "#ffff00" } : f.style}
                      isFrozen={f.isFrozen}
                      isBoundary={f.isBoundary}
                      draggable={!f.isFrozen}
                      isDragging={headerDragId === col.id}
                      isDragOver={headerDragOverId === col.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", col.id);
                        e.dataTransfer.effectAllowed = "move";
                        setHeaderDragId(col.id);
                      }}
                      onDragOver={(e) => {
                        if (!headerDragId || headerDragId === col.id || f.isFrozen) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (headerDragOverId !== col.id) setHeaderDragOverId(col.id);
                      }}
                      onDragLeave={() => {
                        if (headerDragOverId === col.id) setHeaderDragOverId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (f.isFrozen) return;
                        const sourceId = e.dataTransfer.getData("text/plain") || headerDragId;
                        if (sourceId && sourceId !== col.id) onReorderColumns?.(sourceId, col.id);
                        setHeaderDragId(null);
                        setHeaderDragOverId(null);
                      }}
                      onDragEnd={() => {
                        setHeaderDragId(null);
                        setHeaderDragOverId(null);
                      }}
                      className={`py-2 px-3 text-xs font-bold leading-tight text-center ${yellow ? "text-slate-950" : "bg-[#ff9900] text-slate-900"} ${f.className}`}
                      onResize={onResizeColumn}
                      onAutoFit={onAutoFitColumn}
                      onColumnClick={onColumnContextMenu ? (id, event) => onColumnContextMenu(id, event.clientX, event.clientY) : undefined}
                    >
                      <span className="line-clamp-2 break-words whitespace-normal leading-tight text-center max-w-full block" title={col.label}>
                        {col.label}
                      </span>
                    </ColumnHeaderCell>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="py-20 text-slate-500 font-bold text-base">
                    {/* Bảng rất rộng: giữ thông báo trong vùng đang nhìn thấy */}
                    <div className="sticky left-0 w-[min(100%,calc(100vw-320px))] text-center">
                      <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                      Đang tải tồn kho...
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="py-20 text-slate-500 text-sm">
                    <div className="sticky left-0 w-[min(100%,calc(100vw-320px))] text-center">
                      <WarehouseIcon size={40} className="mx-auto mb-2 text-slate-400" />
                      {emptyMessage}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((item, idx) => (
                  <tr
                    key={item.id}
                    className="group h-[34px] min-h-[34px] bg-white even:bg-[#f8fafc] hover:bg-amber-50/60 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200"
                  >
                    {activeColumns.map((col) => renderCell(col, item, startIndex + idx + 1))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
