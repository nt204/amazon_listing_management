"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import { PpcOrganicRankCell, PpcSearchVolumeCell, PpcSponsoredRankCell } from "./ppc-search-volume";

// Bảng tổng phía trên tab Target / Search Term khi tìm theo SKU: mỗi keyword 1 dòng tổng (gộp mọi campaign / match type).
// Cùng 12 cột với bảng tổng: Ảnh | SKU | Keyword | Hiển thị | Clicks | CTR | Spend | Sales | Orders | CVR | CPC | ACOS.
// showSearchVolume: thêm 3 cột SV | Org Rank | Spon Rank ngay sau cột Keyword (dòng SKU tổng để trống) → 15 cột.

export type KeywordGroupRow = {
  targetKeyword?: string;
  customerSearchTerm?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
  campaignName?: string;
  reportDate?: string;
  searchVolume?: number | null;
  searchVolumeTrend?: number | null;
  estImpressionShare?: number | null;
  organicRank?: number | null;
  sponsoredRank?: number | null;
};

/** 3 ô trống SV | Org Rank | Spon Rank cho dòng SKU tổng của bảng tổng. */
export function PpcSummarySearchVolumeBlankCells() {
  return (
    <>
      <td className="px-2 py-3" />
      <td className="px-2 py-3" />
      <td className="px-2 py-3" />
    </>
  );
}

export function keywordGroupKey(group: KeywordGroupRow): string {
  return (group.targetKeyword ?? group.customerSearchTerm ?? "").trim().toLowerCase();
}

export interface KeywordGroupSelection {
  isSelected: (group: KeywordGroupRow) => boolean;
  toggle: (group: KeywordGroupRow, index: number, shiftKey: boolean) => void;
  allSelected: boolean;
  toggleAll: () => void;
}

// Chọn dòng keyword ở bảng tổng để lên camp: giữ cả dòng, Shift + click chọn cả đoạn
export function useKeywordGroupSelection() {
  const [selected, setSelected] = useState<Map<string, KeywordGroupRow>>(new Map());
  const lastIndexRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    setSelected(new Map());
    lastIndexRef.current = null;
  }, []);

  const selectionFor = (groups: KeywordGroupRow[]): KeywordGroupSelection => ({
    isSelected: (group) => selected.has(keywordGroupKey(group)),
    toggle: (group, index, shiftKey) => {
      const shouldSelect = !selected.has(keywordGroupKey(group));
      const last = lastIndexRef.current;
      const range = shiftKey && last !== null && last < groups.length
        ? groups.slice(Math.min(last, index), Math.max(last, index) + 1)
        : [group];
      const next = new Map(selected);
      for (const row of range) {
        if (shouldSelect) next.set(keywordGroupKey(row), row);
        else next.delete(keywordGroupKey(row));
      }
      lastIndexRef.current = index;
      setSelected(next);
    },
    allSelected: groups.length > 0 && groups.every((g) => selected.has(keywordGroupKey(g))),
    toggleAll: () => {
      const next = new Map(selected);
      if (groups.length > 0 && groups.every((g) => next.has(keywordGroupKey(g)))) groups.forEach((g) => next.delete(keywordGroupKey(g)));
      else groups.forEach((g) => next.set(keywordGroupKey(g), g));
      setSelected(next);
    },
  });

  return { selected, clear, selectionFor };
}

export function PpcKeywordGroupRows({ groups, total, selection, showSearchVolume = false }: { groups: KeywordGroupRow[]; total: number; selection?: KeywordGroupSelection; showSearchVolume?: boolean }) {
  return (
    <>
      {groups.map((group, index) => {
        const keyword = group.targetKeyword ?? group.customerSearchTerm ?? "";
        const noSales = group.orders === 0 || group.sales === 0;
        return (
          <tr key={keyword} className={selection?.isSelected(group) ? "bg-indigo-50/60" : "hover:bg-slate-50/70"}>
            <td className="px-3 py-2 text-center">
              {selection && (
                <input
                  type="checkbox"
                  checked={selection.isSelected(group)}
                  onChange={(e) => selection.toggle(group, index, (e.nativeEvent as MouseEvent).shiftKey)}
                  className="rounded border-slate-300 accent-indigo-600 cursor-pointer"
                />
              )}
            </td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-sm font-semibold text-slate-800 break-words">{keyword}</td>
            {showSearchVolume && (
              <>
                <PpcSearchVolumeCell
                  className="px-2 py-2"
                  searchVolume={group.searchVolume}
                  searchVolumeTrend={group.searchVolumeTrend}
                  estImpressionShare={group.estImpressionShare}
                />
                <PpcOrganicRankCell className="px-2 py-2" organicRank={group.organicRank} />
                <PpcSponsoredRankCell className="px-2 py-2" sponsoredRank={group.sponsoredRank} />
              </>
            )}
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">{Number(group.impressions || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-700">{Number(group.clicks || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-600">
              {group.impressions > 0 ? ((group.clicks / group.impressions) * 100).toFixed(2) : "0.00"}%
            </td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-900">${Number(group.spend || 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-emerald-600">${Number(group.sales || 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-900">{Number(group.orders || 0).toLocaleString("vi-VN")}</td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-600">
              {group.clicks > 0 ? ((group.orders / group.clicks) * 100).toFixed(1) : "0.0"}%
            </td>
            <td className="px-3 py-2 text-right font-mono text-sm text-slate-600">
              {group.clicks > 0 ? `$${(group.spend / group.clicks).toFixed(2)}` : "-"}
            </td>
            <td className="px-3 py-2 text-right">
              <span
                className={`inline-flex min-w-[64px] justify-center rounded-md px-2 py-0.5 font-mono text-xs font-black ${
                  noSales
                    ? group.spend > 0 ? "bg-rose-100 text-rose-700" : "text-slate-400"
                    : group.acos < 30
                      ? "bg-emerald-100 text-emerald-700"
                      : group.acos <= 50
                        ? "bg-amber-200 text-amber-900"
                        : "bg-rose-100 text-rose-700"
                }`}
              >
                {noSales ? (group.spend > 0 ? "0 sales" : "—") : `${Number(group.acos || 0).toFixed(1)}%`}
              </span>
            </td>
          </tr>
        );
      })}
      {total > groups.length && (
        <tr>
          <td colSpan={showSearchVolume ? 15 : 12} className="px-3 py-2 text-center text-[11px] text-slate-400">
            Hiển thị {groups.length.toLocaleString("vi-VN")}/{total.toLocaleString("vi-VN")} keyword có spend cao nhất
          </td>
        </tr>
      )}
    </>
  );
}

// ---- Sắp xếp bảng tổng (bấm vào tên cột). Sắp xếp phía client trên dữ liệu đã tải; SKU luôn nằm trên keyword.

export type SummarySortField =
  | "sku" | "keyword" | "sv" | "orgRank" | "sponRank"
  | "impressions" | "clicks" | "ctr" | "spend" | "sales" | "orders" | "cvr" | "cpc" | "acos";

type SummaryMetrics = {
  impressions: number; clicks: number; spend: number; sales: number; orders: number;
  searchVolume?: number | null; organicRank?: number | null; sponsoredRank?: number | null;
};

// SV / rank chưa có dữ liệu → NaN: luôn xếp cuối dù tăng hay giảm dần
const optionalMetric = (v: number | null | undefined) => (v == null || v <= 0 ? Number.NaN : Number(v));

function metricValue(m: SummaryMetrics, field: SummarySortField): number {
  const impressions = Number(m.impressions || 0);
  const clicks = Number(m.clicks || 0);
  const sales = Number(m.sales || 0);
  switch (field) {
    case "ctr":
      return impressions > 0 ? clicks / impressions : 0;
    case "cvr":
      return clicks > 0 ? Number(m.orders || 0) / clicks : 0;
    case "cpc":
      return clicks > 0 ? Number(m.spend || 0) / clicks : 0;
    // Không có sales → ACOS vô cực (luôn xếp sau khi tăng dần)
    case "acos":
      return sales > 0 ? Number(m.spend || 0) / sales : Number.POSITIVE_INFINITY;
    case "sv":
      return optionalMetric(m.searchVolume);
    case "orgRank":
      return optionalMetric(m.organicRank);
    case "sponRank":
      return optionalMetric(m.sponsoredRank);
    case "impressions":
    case "clicks":
    case "spend":
    case "sales":
    case "orders":
      return Number(m[field] || 0);
    default:
      return 0;
  }
}

function sortBy<T>(rows: T[], field: SummarySortField | null, dir: "asc" | "desc", textField: SummarySortField, getText: (row: T) => string, getMetrics: (row: T) => SummaryMetrics): T[] {
  if (!field || (field !== textField && (field === "sku" || field === "keyword"))) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === textField) return sign * getText(a).localeCompare(getText(b), "vi", { numeric: true, sensitivity: "base" });
    const va = metricValue(getMetrics(a), field);
    const vb = metricValue(getMetrics(b), field);
    if (Number.isNaN(va) || Number.isNaN(vb)) return Number.isNaN(va) ? (Number.isNaN(vb) ? 0 : 1) : -1;
    if (va === vb) return 0;
    return va > vb ? sign : -sign;
  });
}

export function usePpcSummarySort() {
  const [field, setField] = useState<SummarySortField | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const toggle = useCallback((next: SummarySortField) => {
    // Cột chữ, ACOS & thứ hạng (số nhỏ = tốt) mặc định tăng dần, còn lại giảm dần
    const defaultDir = ["sku", "keyword", "acos", "orgRank", "sponRank"].includes(next) ? "asc" : "desc";
    if (field !== next) {
      setField(next);
      setDir(defaultDir);
    } else if (dir === defaultDir) {
      setDir(defaultDir === "asc" ? "desc" : "asc");
    } else {
      // Lần bấm thứ 3: về thứ tự mặc định (spend cao nhất)
      setField(null);
    }
  }, [field, dir]);

  const sortSkuGroups = <T extends { sku: string; totalImpressions: number; totalClicks: number; totalSpend: number; totalSales: number; totalOrders: number }>(rows: T[]) =>
    sortBy(rows, field, dir, "sku", (r) => r.sku, (r) => ({
      impressions: r.totalImpressions,
      clicks: r.totalClicks,
      spend: r.totalSpend,
      sales: r.totalSales,
      orders: r.totalOrders,
    }));

  const sortKeywordGroups = (rows: KeywordGroupRow[]) =>
    sortBy(rows, field, dir, "keyword", (r) => r.targetKeyword ?? r.customerSearchTerm ?? "", (r) => r);

  return { field, dir, toggle, sortSkuGroups, sortKeywordGroups };
}

const SUMMARY_COLUMNS: { field: SummarySortField; label: string; className: string }[] = [
  { field: "sku", label: "SKU", className: "px-3 py-3" },
  { field: "keyword", label: "", className: "min-w-[240px] px-3 py-3" },
  { field: "impressions", label: "Hiển thị", className: "px-3 py-3 text-right" },
  { field: "clicks", label: "Clicks", className: "px-3 py-3 text-right" },
  { field: "ctr", label: "CTR", className: "px-3 py-3 text-right" },
  { field: "spend", label: "Spend", className: "px-3 py-3 text-right" },
  { field: "sales", label: "Sales", className: "px-3 py-3 text-right" },
  { field: "orders", label: "Orders", className: "px-3 py-3 text-right" },
  { field: "cvr", label: "CVR", className: "px-3 py-3 text-right" },
  { field: "cpc", label: "CPC", className: "px-3 py-3 text-right" },
  { field: "acos", label: "ACOS", className: "px-3 py-3 text-right" },
];

const SEARCH_VOLUME_COLUMNS: { field: SummarySortField; label: string; title: string; className: string }[] = [
  { field: "sv", label: "SV", title: "Search Volume tháng từ Helium 10", className: "px-2 py-3 text-right" },
  { field: "orgRank", label: "Org Rank", title: "Thứ hạng tự nhiên (Organic Rank) của sản phẩm", className: "px-2 py-3 text-center" },
  { field: "sponRank", label: "Spon Rank", title: "Thứ hạng quảng cáo (Sponsored Rank) của sản phẩm", className: "px-2 py-3 text-center" },
];

export function PpcSummaryTableHead({ keywordLabel, sort, selection, showSearchVolume = false }: { keywordLabel: string; sort: ReturnType<typeof usePpcSummarySort>; selection?: KeywordGroupSelection; showSearchVolume?: boolean }) {
  return (
    <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226,232,240)] border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
      <tr>
        {/* min-w: bảng thêm cột SV / rank thì cột Ảnh không bị co làm méo ảnh SKU */}
        <th className="w-16 min-w-[72px] px-3 py-3 text-center">
          {selection ? (
            <input
              type="checkbox"
              checked={selection.allSelected}
              onChange={selection.toggleAll}
              title="Chọn tất cả keyword"
              className="rounded border-slate-300 accent-indigo-600 cursor-pointer"
            />
          ) : "Ảnh"}
        </th>
        {SUMMARY_COLUMNS.map((col) => {
          const active = sort.field === col.field;
          return (
            <Fragment key={col.field}>
            <th
              className={`${col.className} cursor-pointer select-none whitespace-nowrap hover:text-indigo-600 ${active ? "text-indigo-600" : ""}`}
              onClick={() => sort.toggle(col.field)}
              title="Nhấn để sắp xếp (bấm lần 3 để về mặc định)"
            >
              {col.label || keywordLabel} {active && (sort.dir === "asc" ? "↑" : "↓")}
            </th>
            {showSearchVolume && col.field === "keyword" && SEARCH_VOLUME_COLUMNS.map((sv) => {
              const svActive = sort.field === sv.field;
              return (
                <th
                  key={sv.field}
                  className={`${sv.className} cursor-pointer select-none whitespace-nowrap hover:text-indigo-600 ${svActive ? "text-indigo-600" : ""}`}
                  onClick={() => sort.toggle(sv.field)}
                  title={`${sv.title} — nhấn để sắp xếp (bấm lần 3 để về mặc định)`}
                >
                  {sv.label} {svActive && (sort.dir === "asc" ? "↑" : "↓")}
                </th>
              );
            })}
            </Fragment>
          );
        })}
      </tr>
    </thead>
  );
}
