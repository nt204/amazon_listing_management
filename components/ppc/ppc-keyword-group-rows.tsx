"use client";

import { useCallback, useState } from "react";

// Bảng tổng phía trên tab Target / Search Term khi tìm theo SKU: mỗi keyword 1 dòng tổng (gộp mọi campaign / match type).
// Cùng 12 cột với bảng tổng: Ảnh | SKU | Keyword | Hiển thị | Clicks | CTR | Spend | Sales | Orders | CVR | CPC | ACOS.

export type KeywordGroupRow = {
  targetKeyword?: string;
  customerSearchTerm?: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number;
};

export function PpcKeywordGroupRows({ groups, total }: { groups: KeywordGroupRow[]; total: number }) {
  return (
    <>
      {groups.map((group) => {
        const keyword = group.targetKeyword ?? group.customerSearchTerm ?? "";
        const noSales = group.orders === 0 || group.sales === 0;
        return (
          <tr key={keyword} className="hover:bg-slate-50/70">
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-sm font-semibold text-slate-800 break-words">{keyword}</td>
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
          <td colSpan={12} className="px-3 py-2 text-center text-[11px] text-slate-400">
            Hiển thị {groups.length.toLocaleString("vi-VN")}/{total.toLocaleString("vi-VN")} keyword có spend cao nhất
          </td>
        </tr>
      )}
    </>
  );
}

// ---- Sắp xếp bảng tổng (bấm vào tên cột). Sắp xếp phía client trên dữ liệu đã tải; SKU luôn nằm trên keyword.

export type SummarySortField = "sku" | "keyword" | "impressions" | "clicks" | "ctr" | "spend" | "sales" | "orders" | "cvr" | "cpc" | "acos";

type SummaryMetrics = { impressions: number; clicks: number; spend: number; sales: number; orders: number };

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
    if (va === vb) return 0;
    return va > vb ? sign : -sign;
  });
}

export function usePpcSummarySort() {
  const [field, setField] = useState<SummarySortField | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const toggle = useCallback((next: SummarySortField) => {
    // Cột chữ & ACOS mặc định tăng dần, còn lại giảm dần
    const defaultDir = next === "sku" || next === "keyword" || next === "acos" ? "asc" : "desc";
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

export function PpcSummaryTableHead({ keywordLabel, sort }: { keywordLabel: string; sort: ReturnType<typeof usePpcSummarySort> }) {
  return (
    <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226,232,240)] border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
      <tr>
        <th className="w-16 px-3 py-3 text-center">Ảnh</th>
        {SUMMARY_COLUMNS.map((col) => {
          const active = sort.field === col.field;
          return (
            <th
              key={col.field}
              className={`${col.className} cursor-pointer select-none whitespace-nowrap hover:text-indigo-600 ${active ? "text-indigo-600" : ""}`}
              onClick={() => sort.toggle(col.field)}
              title="Nhấn để sắp xếp (bấm lần 3 để về mặc định)"
            >
              {col.label || keywordLabel} {active && (sort.dir === "asc" ? "↑" : "↓")}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
