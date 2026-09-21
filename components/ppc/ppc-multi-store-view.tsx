"use client";

import React, { useMemo, useState } from "react";
import {
  Storefront,
  ArrowRight,
  ChartLineUp,
  SquaresFour,
  Table as TableIcon,
  Plus,
  Lightning,
} from "@phosphor-icons/react";
import type {
  PpcStoreSummary,
  PpcSummaryMetrics,
  PpcDailyTrendPoint,
  PpcAdTypeBreakdown,
  PpcSearchTermRow,
} from "@/lib/ppc/types";
import dynamic from "next/dynamic";
import { PpcAddStoreModal } from "./ppc-add-store-modal";
import { PpcStoreManagerModal } from "./ppc-store-manager-modal";
import { PpcRemoteCrawlerModal } from "./ppc-remote-crawler-modal";

const PpcTimeSeriesChart = dynamic(
  () => import("./ppc-time-series-chart").then((module) => module.PpcTimeSeriesChart),
  { loading: () => <div className="h-[360px] animate-pulse rounded-xl bg-slate-100" /> }
);

interface PpcMultiStoreViewProps {
  storeSummaries: PpcStoreSummary[];
  summary: PpcSummaryMetrics | null;
  dailyTrends: PpcDailyTrendPoint[];
  adTypeBreakdown?: PpcAdTypeBreakdown[];
  searchTerms?: PpcSearchTermRow[];
  selectedDays?: number;
  onDaysChange?: (days: number) => void;
  isCustomDate?: boolean;
  startDate?: string;
  endDate?: string;
  onCustomDateChange?: (start: string, end: string) => void;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  onSelectStore: (storeName: string) => void;
  onRefreshStores?: () => void;
  currency?: string;
}

export function PpcMultiStoreView({
  storeSummaries,
  summary,
  dailyTrends,
  adTypeBreakdown = [],
  searchTerms = [],
  selectedDays = 30,
  onDaysChange,
  isCustomDate,
  startDate,
  endDate,
  onCustomDateChange,
  dateRangeStart,
  dateRangeEnd,
  onSelectStore,
  onRefreshStores,
  currency = "$",
}: PpcMultiStoreViewProps) {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [isAddStoreModalOpen, setIsAddStoreModalOpen] = useState(false);
  const [isStoreManagerOpen, setIsStoreManagerOpen] = useState(false);
  const [isRemoteCrawlerModalOpen, setIsRemoteCrawlerModalOpen] = useState(false);

  // Tổng các chỉ số của tất cả Store
  const totals = useMemo(() => {
    if (summary) {
      return {
        spend: summary.totalSpend,
        sales: summary.totalSales,
        orders: summary.totalOrders,
        clicks: summary.totalClicks,
        impressions: summary.totalImpressions,
        acos: summary.blendedAcos,
        roas: summary.blendedRoas,
        cpc: summary.avgCpc,
        cvr: summary.overallCvr * 100,
        ctr: summary.overallCtr * 100,
      };
    }
    const spend = storeSummaries.reduce((sum, s) => sum + s.spend, 0);
    const sales = storeSummaries.reduce((sum, s) => sum + s.sales, 0);
    const orders = storeSummaries.reduce((sum, s) => sum + s.orders, 0);
    const clicks = storeSummaries.reduce((sum, s) => sum + s.clicks, 0);
    const impressions = storeSummaries.reduce((sum, s) => sum + s.impressions, 0);
    const acos = sales > 0 ? (spend / sales) * 100 : 0;
    const roas = spend > 0 ? sales / spend : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    return { spend, sales, orders, clicks, impressions, acos, roas, cpc, cvr, ctr };
  }, [summary, storeSummaries]);

  // Sắp xếp các store theo spend giảm dần
  const sortedStores = useMemo(() => {
    return [...storeSummaries].sort((a, b) => b.spend - a.spend);
  }, [storeSummaries]);

  return (
    <div className="space-y-4">
      {/* 1. 4 THÔNG SỐ TỔNG QUAN: SPEND, SALES, ORDERS, ACOS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* SPEND */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block">
            SPEND
          </span>
          <div className="text-2xl font-black text-rose-600 mt-1 truncate">
            {currency}{totals.spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* SALES */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block">
            SALES
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-1 truncate">
            {currency}{totals.sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* ORDERS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block">
            ORDERS
          </span>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {totals.orders.toLocaleString()}
          </div>
        </div>

        {/* ACOS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block">
            ACOS
          </span>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {totals.acos.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 2. MỤC THỐNG KÊ */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <ChartLineUp size={16} className="text-indigo-600" weight="bold" />
            <span>THỐNG KÊ</span>
          </h4>

          <div className="flex items-center gap-2">
            {/* Nút Điều Khiển Crawl Từ Xa */}
            <button
              type="button"
              onClick={() => setIsRemoteCrawlerModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer border border-indigo-200/80 shadow-2xs active:scale-98"
              title="Kích hoạt Mac mini tải báo cáo và nạp dữ liệu"
            >
              <Lightning size={14} weight="fill" className="text-amber-500" />
              <span>Crawl Từ Xa (Mac)</span>
            </button>

            {/* View Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200/80">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`p-1 rounded flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
                  viewMode === "table"
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Dạng bảng"
              >
                <TableIcon size={14} weight="bold" />
                <span className="hidden sm:inline text-[11px]">Bảng</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`p-1 rounded flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="Dạng thẻ"
              >
                <SquaresFour size={14} weight="bold" />
                <span className="hidden sm:inline text-[11px]">Thẻ</span>
              </button>
            </div>
          </div>
        </div>

        {viewMode === "table" ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3.5">Store</th>
                  <th className="py-2.5 px-3 text-right">Spend</th>
                  <th className="py-2.5 px-3 text-right font-black text-emerald-700">Sales</th>
                  <th className="py-2.5 px-3 text-right">Orders</th>
                  <th className="py-2.5 px-3 text-right">ACOS</th>
                  <th className="py-2.5 px-3.5 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {sortedStores.map((store) => {
                  const isGood = store.sales > 0 && store.acos <= store.targetAcos;
                  const isBleeding = store.sales > 0 && store.acos > store.targetAcos * 1.3;

                  return (
                    <tr
                      key={store.id}
                      onClick={() => onSelectStore(store.name)}
                      className="hover:bg-indigo-50/40 transition cursor-pointer"
                    >
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <Storefront size={16} className="text-indigo-600" weight="bold" />
                          <span>{store.name}</span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600">
                            {store.marketplace || "US"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {currency}{store.spend.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-600">
                        {currency}{store.sales.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                        {store.orders}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold">
                        {store.sales === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-black ${
                              isGood
                                ? "bg-emerald-50 text-emerald-700"
                                : isBleeding
                                ? "bg-rose-50 text-rose-700"
                                : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {store.acos.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectStore(store.name);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer"
                        >
                          <span>Vào shop</span>
                          <ArrowRight size={12} weight="bold" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-1">
            {sortedStores.map((store) => {
              const isGoodAcos = store.sales > 0 && store.acos <= store.targetAcos;
              const isHighAcos = store.sales > 0 && store.acos > store.targetAcos * 1.25;

              return (
                <div
                  key={store.id}
                  onClick={() => onSelectStore(store.name)}
                  className="group relative rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:shadow-md hover:border-indigo-300 transition cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs border border-indigo-100 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <Storefront size={16} weight="bold" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-black text-slate-900 group-hover:text-indigo-600 transition-colors">
                            {store.name}
                          </h4>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600">
                            {store.marketplace || "US"}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                          isGoodAcos
                            ? "bg-emerald-50 text-emerald-700"
                            : isHighAcos
                            ? "bg-rose-50 text-rose-700"
                            : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        ACOS: {store.sales > 0 ? `${store.acos.toFixed(1)}%` : "—"}
                      </span>
                    </div>

                    {/* Metrics Grid: spend, sales, orders */}
                    <div className="grid grid-cols-3 gap-2 py-3 text-center">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Spend</span>
                        <div className="text-xs font-black text-slate-900 mt-0.5">
                          {currency}{store.spend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Sales</span>
                        <div className="text-xs font-black text-emerald-600 mt-0.5">
                          {currency}{store.sales.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Orders</span>
                        <div className="text-xs font-black text-slate-800 mt-0.5">
                          {store.orders}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end text-xs font-bold text-indigo-600 group-hover:translate-x-1 transition-transform">
                    <span>Vào shop</span>
                    <ArrowRight size={12} weight="bold" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. BIỂU ĐỒ XU HƯỚNG GỘP (TIME SERIES CHART) - ĐÃ ẨN MINI CARDS TRÙNG LẶP */}
      {dailyTrends.length > 0 && summary && (
        <PpcTimeSeriesChart
          summary={summary}
          dailyTrends={dailyTrends}
          selectedDays={selectedDays}
          onDaysChange={onDaysChange}
          isCustomDate={isCustomDate}
          startDate={startDate}
          endDate={endDate}
          onCustomDateChange={onCustomDateChange}
          dateRangeStart={dateRangeStart}
          dateRangeEnd={dateRangeEnd}
          adTypeBreakdown={adTypeBreakdown || []}
          searchTerms={searchTerms || []}
          targetAcos={30}
          currency={currency}
          hideSummaryCards={true}
        />
      )}

      {/* Modal: Thêm Store Mới */}
      <PpcAddStoreModal
        isOpen={isAddStoreModalOpen}
        onClose={() => setIsAddStoreModalOpen(false)}
        onStoreCreated={(newStore) => {
          onRefreshStores?.();
          onSelectStore(newStore.name);
        }}
      />

      {/* Modal: Quản Lý Store (Sửa / Xóa / Trạng Thái) */}
      <PpcStoreManagerModal
        isOpen={isStoreManagerOpen}
        onClose={() => setIsStoreManagerOpen(false)}
        onStoreSelected={(name) => {
          onRefreshStores?.();
          onSelectStore(name);
        }}
        onNavigateToCostMaster={(name) => {
          onRefreshStores?.();
          onSelectStore(name);
        }}
      />

      {/* Modal: Điều Khiển Crawl Từ Xa (Mac mini) */}
      <PpcRemoteCrawlerModal
        isOpen={isRemoteCrawlerModalOpen}
        onClose={() => setIsRemoteCrawlerModalOpen(false)}
        stores={storeSummaries.map((s) => s.name)}
        onSyncComplete={() => {
          onRefreshStores?.();
        }}
      />
    </div>
  );
}
