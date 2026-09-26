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

  // Tổng các chỉ số của tất cả Store (ưu tiên tổng thực tế từ storeSummaries nếu summary trống)
  const totals = useMemo(() => {
    const sumSpend = storeSummaries.reduce((sum, s) => sum + s.spend, 0);
    const sumSales = storeSummaries.reduce((sum, s) => sum + s.sales, 0);
    if (summary && (summary.totalSpend > 0 || summary.totalSales > 0 || sumSpend === 0)) {
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
    const orders = storeSummaries.reduce((sum, s) => sum + s.orders, 0);
    const clicks = storeSummaries.reduce((sum, s) => sum + s.clicks, 0);
    const impressions = storeSummaries.reduce((sum, s) => sum + s.impressions, 0);
    const acos = sumSales > 0 ? (sumSpend / sumSales) * 100 : 0;
    const roas = sumSpend > 0 ? sumSales / sumSpend : 0;
    const cpc = clicks > 0 ? sumSpend / clicks : 0;
    const cvr = clicks > 0 ? (orders / clicks) * 100 : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    return { spend: sumSpend, sales: sumSales, orders, clicks, impressions, acos, roas, cpc, cvr, ctr };
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
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            SPEND
          </span>
          <div className="text-xl font-bold text-rose-600 mt-0.5 truncate">
            {currency}{totals.spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* SALES */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            SALES
          </span>
          <div className="text-xl font-bold text-emerald-600 mt-0.5 truncate">
            {currency}{totals.sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        {/* ORDERS */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            ORDERS
          </span>
          <div className="text-xl font-bold text-slate-900 mt-0.5">
            {totals.orders.toLocaleString()}
          </div>
        </div>

        {/* ACOS */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            ACOS
          </span>
          <div className="text-xl font-bold text-amber-600 mt-0.5">
            {totals.acos.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 2. MỤC THỐNG KÊ GIAN HÀNG */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center shadow-xs">
              <ChartLineUp size={20} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
                  THỐNG KÊ TỪNG GIAN HÀNG
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-black border border-indigo-200/60">
                  {sortedStores.length} Stores
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                So sánh chi tiêu, doanh thu và hiệu quả quảng cáo giữa các shop
              </p>
            </div>
          </div>

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
                className={`p-1.5 rounded flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
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
                className={`p-1.5 rounded flex items-center gap-1 text-xs font-bold transition cursor-pointer ${
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
          <div className="overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-slate-100/90 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3.5 px-5 min-w-[200px] text-slate-700">STORE</th>
                  <th className="py-3.5 px-4 text-right min-w-[140px] text-rose-700">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                      SPEND
                    </span>
                  </th>
                  <th className="py-3.5 px-4 text-right min-w-[145px] text-emerald-700">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      SALES
                    </span>
                  </th>
                  <th className="py-3.5 px-4 text-right min-w-[105px] text-indigo-700">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                      ORDERS
                    </span>
                  </th>
                  <th className="py-3.5 px-4 text-right min-w-[110px] text-amber-700">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                      ACOS
                    </span>
                  </th>
                  <th className="py-3.5 px-5 text-center min-w-[120px] text-slate-700">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 font-medium">
                {sortedStores.map((store, index) => {
                  const isGood = store.sales > 0 && store.acos <= store.targetAcos;
                  const isBleeding = store.sales > 0 && store.acos > store.targetAcos * 1.3;
                  const isEven = index % 2 === 0;

                  return (
                    <tr
                      key={store.id}
                      onClick={() => onSelectStore(store.name)}
                      className={`group transition-all cursor-pointer ${
                        isEven ? "bg-white" : "bg-slate-100/60"
                      } hover:bg-indigo-50/70`}
                    >
                      {/* Cột Store */}
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3.5">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black shrink-0 bg-indigo-50 text-indigo-600 border border-indigo-200/80 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-2xs group-hover:scale-105">
                            <Storefront size={18} weight="bold" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                                {store.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-slate-900 text-white shadow-2xs">
                                {store.marketplace || "US"}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-semibold mt-0.5 flex items-center gap-1.5">
                              {store.totalCampaigns > 0 ? (
                                <span className="text-slate-700 font-bold">{store.totalCampaigns.toLocaleString()} camps</span>
                              ) : (
                                <span className="text-slate-400">0 camp</span>
                              )}
                              <span>·</span>
                              <span>Target: <strong className="text-slate-800">{store.targetAcos}%</strong></span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Cột Spend */}
                      <td className="py-3.5 px-4 text-right">
                        {store.spend > 0 ? (
                          <>
                            <div className="font-mono text-base font-bold text-rose-600 tracking-tight leading-tight">
                              {currency}{store.spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="text-[11px] text-rose-900/70 font-semibold mt-0.5">
                              {store.clicks.toLocaleString()} clicks · ${store.cpc.toFixed(2)}/cpc
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-mono text-sm font-semibold text-slate-300">
                              {currency}0.00
                            </div>
                            <div className="text-[11px] text-slate-300 font-medium mt-0.5">—</div>
                          </>
                        )}
                      </td>

                      {/* Cột Sales */}
                      <td className="py-3.5 px-4 text-right">
                        {store.sales > 0 ? (
                          <>
                            <div className="font-mono text-base font-bold text-emerald-600 tracking-tight leading-tight">
                              {currency}{store.sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className="inline-block text-[11px] text-emerald-700 font-bold mt-0.5 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/70">
                              CVR {store.cvr.toFixed(1)}%
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-mono text-sm font-semibold text-slate-300">
                              {currency}0.00
                            </div>
                            <div className="text-[11px] text-slate-300 font-medium mt-0.5">—</div>
                          </>
                        )}
                      </td>

                      {/* Cột Orders */}
                      <td className="py-3.5 px-4 text-right font-mono">
                        {store.orders > 0 ? (
                          <>
                            <div className="text-base font-bold text-indigo-700 tracking-tight leading-tight">
                              {store.orders.toLocaleString()}
                            </div>
                            <div className="text-[11px] text-slate-500 font-semibold mt-0.5">
                              ${(store.sales / store.orders).toFixed(1)}/order
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-semibold text-slate-300">
                              0
                            </div>
                            <div className="text-[11px] text-slate-300 font-medium mt-0.5">—</div>
                          </>
                        )}
                      </td>

                      {/* Cột ACOS */}
                      <td className="py-3.5 px-4 text-right">
                        {store.sales === 0 ? (
                          <span className="text-slate-300 font-mono text-sm font-semibold">—</span>
                        ) : (
                          <span
                            className={`inline-block px-2.5 py-1 rounded-md text-xs font-bold font-mono shadow-2xs ${
                              isGood
                                ? "bg-emerald-500 text-white"
                                : isBleeding
                                ? "bg-rose-500 text-white"
                                : "bg-amber-500 text-white"
                            }`}
                          >
                            {store.acos.toFixed(1)}%
                          </span>
                        )}
                      </td>

                      {/* Cột Thao tác */}
                      <td className="py-4 px-5 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectStore(store.name);
                          }}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs hover:shadow-md active:scale-95 group-hover:scale-105"
                        >
                          <span>Vào shop</span>
                          <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
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
                  className="group relative rounded-xl border border-slate-200 bg-white p-4 transition-all cursor-pointer flex flex-col justify-between hover:border-indigo-300 hover:shadow-xs"
                >
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs bg-slate-100 text-slate-500 border border-slate-200 group-hover:bg-indigo-50 group-hover:text-indigo-600 group-hover:border-indigo-200 transition-colors">
                          <Storefront size={16} weight="bold" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                              {store.name}
                            </h4>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                              {store.marketplace || "US"}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                            {store.totalCampaigns > 0 ? `${store.totalCampaigns.toLocaleString()} campaigns` : "Chưa có camp"}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                          store.sales === 0
                            ? "bg-slate-100 text-slate-400"
                            : isGoodAcos
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isHighAcos
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {store.sales > 0 ? `${store.acos.toFixed(1)}%` : "—"}
                      </span>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-2 py-3 text-center">
                      <div className="p-2 rounded-lg bg-rose-50/50 border border-rose-100/70">
                        <span className="text-[10px] font-black text-rose-700 uppercase block tracking-wider">Spend</span>
                        <div className={`text-sm font-black font-mono mt-0.5 ${store.spend > 0 ? "text-rose-600" : "text-slate-300 font-semibold"}`}>
                          {currency}{store.spend.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-100/70">
                        <span className="text-[10px] font-black text-emerald-700 uppercase block tracking-wider">Sales</span>
                        <div className={`text-sm font-black font-mono mt-0.5 ${store.sales > 0 ? "text-emerald-600" : "text-slate-300 font-semibold"}`}>
                          {currency}{store.sales.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-indigo-50/50 border border-indigo-100/70">
                        <span className="text-[10px] font-black text-indigo-700 uppercase block tracking-wider">Orders</span>
                        <div className={`text-sm font-black font-mono mt-0.5 ${store.orders > 0 ? "text-indigo-700" : "text-slate-300 font-semibold"}`}>
                          {store.orders}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Button */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">
                      Target: <strong className="text-slate-600">{store.targetAcos}%</strong>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectStore(store.name);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-slate-700 hover:text-indigo-600 hover:bg-indigo-50/60 border border-slate-200 transition-colors"
                    >
                      <span>Vào shop</span>
                      <ArrowRight size={12} weight="bold" />
                    </button>
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
