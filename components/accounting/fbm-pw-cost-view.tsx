"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowClockwiseIcon, CalculatorIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { FbmPwCostRow, FbmPwMonth } from "@/lib/accounting/fbm-pw-db";
import { PaginationBar } from "./pagination-bar";

// BASECOST THÁNG FBM: dữ liệu thô tab "ĐẦU VÀO FBM PW" của file Kế Toán Tổng Hợp FBM (đồng bộ qua link Google Sheet),
// thêm Ngày đặt / SKU / Số lượng nối từ Orders theo Order ID để lọc theo tháng.

export interface FbmPwCostViewRef {
  reload: () => void;
  /** Bộ lọc hiện tại để nút Xuất Excel xuất đúng phần đang xem. */
  exportQuery: () => string;
}

interface FbmPwCostViewProps {
  storeId: string;
  storeName?: string;
  tableZoom?: number;
  onOpenImport?: () => void;
}

interface FbmPwResponse {
  rows: FbmPwCostRow[];
  total: number;
  totalNetPrice: number;
  months: FbmPwMonth[];
}

const money = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthLabel(month: string | null) {
  if (!month) return "Chưa khớp đơn";
  const [y, m] = month.split("-");
  return `Tháng ${Number(m)}/${y}`;
}

export const FbmPwCostView = forwardRef<FbmPwCostViewRef, FbmPwCostViewProps>(function FbmPwCostView(
  { storeId, storeName, tableZoom = 100, onOpenImport },
  ref,
) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Đổi store / bộ lọc thì quay về trang 1
  useEffect(() => setPage(1), [storeId, debouncedSearch, month, limit]);
  useEffect(() => setMonth(""), [storeId]);

  const params = new URLSearchParams({ store_id: storeId });
  if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
  if (month) params.set("month", month);

  const query = useQuery({
    queryKey: ["fbm-pw-costs", storeId, debouncedSearch, month, page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/inventory/fbm-pw-costs?${params}&page=${page}&limit=${limit}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tải được Basecost Tháng FBM.");
      return data as FbmPwResponse;
    },
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  });

  useImperativeHandle(ref, () => ({
    reload: () => void query.refetch(),
    exportQuery: () => params.toString(),
  }));

  const data = query.data;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const loading = query.isLoading || (query.isFetching && !data);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="relative w-52 focus-within:w-64 transition-all duration-200">
          <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm Order ID, PWOrderId, SKU..."
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
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-hidden shadow-2xs cursor-pointer"
          title="Lọc theo tháng đặt hàng (nối từ Orders theo Order ID)"
        >
          <option value="">Tất cả tháng</option>
          {(data?.months ?? []).map((m) => (
            <option key={m.month ?? "none"} value={m.month ?? "none"}>
              {monthLabel(m.month)} · {m.rows.toLocaleString()} dòng · ${money(m.net_price)}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-600">
          {query.isFetching && data && <ArrowClockwiseIcon size={14} className="animate-spin text-indigo-600" />}
          <span className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5">
            {total.toLocaleString()} dòng
          </span>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-amber-900">
            Tổng NetPrice: <strong className="font-black">${money(data?.totalNetPrice ?? 0)}</strong>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[480px] flex-1 scrollbar-thin [scrollbar-color:#94a3b8_#f1f5f9]">
        <div style={{ zoom: `${tableZoom}%` }} className="min-w-full">
          <table className="min-w-max w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-30 bg-[#ff9900] text-slate-950 border-b-2 border-amber-600 shadow-xs">
              <tr className="text-xs font-semibold uppercase tracking-[0.04em] [&>th]:py-2.5 [&>th]:px-3 [&>th]:whitespace-nowrap [&>th]:border-r [&>th]:border-amber-600/30">
                <th className="w-14 text-center">STT</th>
                <th>Order ID</th>
                <th>PWOrderId</th>
                <th>OrderName</th>
                <th className="text-right">NetPrice</th>
                <th>Ngày đặt</th>
                <th>SKU</th>
                <th className="text-right">Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-slate-500 font-bold text-base">
                    <ArrowClockwiseIcon size={28} className="mx-auto mb-2 animate-spin text-indigo-600" />
                    Đang tải Basecost Tháng FBM của Store {storeName}...
                  </td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-rose-600 text-sm font-semibold">
                    {(query.error as Error).message}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center text-slate-500 text-sm">
                    <CalculatorIcon size={40} className="mx-auto mb-2 text-slate-400" />
                    {debouncedSearch || month ? (
                      "Không có dòng nào khớp bộ lọc."
                    ) : (
                      <>
                        Chưa có dữ liệu ĐẦU VÀO FBM PW của Store {storeName}.{" "}
                        {onOpenImport ? (
                          <button type="button" onClick={onOpenImport} className="font-bold text-indigo-700 hover:underline cursor-pointer">
                            Dán link Kế Toán Tổng Hợp FBM
                          </button>
                        ) : (
                          "Dán link Kế Toán Tổng Hợp FBM"
                        )}{" "}
                        để nạp dữ liệu.
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.row_no}
                    className="group h-[34px] bg-white even:bg-[#f8fafc] hover:bg-amber-50/60 transition-colors whitespace-nowrap [&>td]:border-b [&>td]:border-slate-200 [&>td]:py-1.5 [&>td]:px-3 text-[13px] text-slate-800"
                  >
                    <td className="text-center font-medium text-slate-500 tabular-nums">{row.row_no}</td>
                    <td className="font-mono text-[12px]">{row.order_id ?? ""}</td>
                    <td className="font-mono text-[12px]">{row.pw_order_id ?? ""}</td>
                    <td className="max-w-[320px] truncate" title={row.order_name ?? ""}>{row.order_name ?? ""}</td>
                    <td className="text-right font-semibold tabular-nums">{row.net_price == null ? "" : money(row.net_price)}</td>
                    <td className="tabular-nums text-slate-600">{row.order_date ?? ""}</td>
                    <td className="font-semibold max-w-[260px] truncate" title={row.skus ?? ""}>{row.skus ?? ""}</td>
                    <td className="text-right tabular-nums">{row.quantity ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        totalItems={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={setLimit}
        label="dòng"
      />
    </>
  );
});
