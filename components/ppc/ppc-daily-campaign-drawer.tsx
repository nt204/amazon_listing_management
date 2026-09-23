"use client";

import { useState, useMemo } from "react";
import {
  X,
  MagnifyingGlass,
  ShoppingBag,
  CurrencyDollar,
  TrendUp,
  Percent,
  Funnel,
  Crown,
  Medal,
  CalendarBlank,
} from "@phosphor-icons/react";
import type { PpcDailyCampaignItem } from "@/lib/ppc/repository";

export interface AvailableDateItem {
  rawDate: string;
  displayDate: string;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
}

interface PpcDailyCampaignDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  availableDates: AvailableDateItem[];
  onSelectDate: (date: string) => void;
  campaigns: PpcDailyCampaignItem[];
  isLoading: boolean;
  currency?: string;
  storeName?: string;
}

export function PpcDailyCampaignDrawer({
  isOpen,
  onClose,
  selectedDate,
  availableDates,
  onSelectDate,
  campaigns,
  isLoading,
  currency = "$",
  storeName = "ALL",
}: PpcDailyCampaignDrawerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterOrdersOnly, setFilterOrdersOnly] = useState(false);
  const [filterAdType, setFilterAdType] = useState<"ALL" | "SP" | "SB">("ALL");

  // Dữ liệu chiến dịch lọc cho ngày đã chọn
  const dayCampaigns = useMemo(() => {
    return campaigns.filter((c) => c.date === selectedDate);
  }, [campaigns, selectedDate]);

  // Tìm thông tin tổng quan của ngày đang chọn
  const currentDayStats = useMemo(() => {
    const found = availableDates.find((d) => d.rawDate === selectedDate);
    if (found) return found;

    const totalOrders = dayCampaigns.reduce((acc, c) => acc + c.orders, 0);
    const totalSales = dayCampaigns.reduce((acc, c) => acc + c.sales, 0);
    const totalSpend = dayCampaigns.reduce((acc, c) => acc + c.spend, 0);
    const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : (totalSpend > 0 ? 999 : 0);
    const parts = selectedDate.split("-");
    const displayDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : selectedDate;

    return {
      rawDate: selectedDate,
      displayDate,
      orders: totalOrders,
      spend: totalSpend,
      sales: totalSales,
      acos,
    };
  }, [availableDates, selectedDate, dayCampaigns]);

  // Lọc và sắp xếp theo số đơn hàng giảm dần (từ cao xuống thấp)
  const filteredCampaigns = useMemo(() => {
    let list = [...dayCampaigns];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter((c) => c.campaignName.toLowerCase().includes(q));
    }

    if (filterOrdersOnly) {
      list = list.filter((c) => c.orders > 0);
    }

    if (filterAdType !== "ALL") {
      list = list.filter((c) => c.adType === filterAdType);
    }

    // Sắp xếp ưu tiên: Số đơn giảm dần -> Doanh thu giảm dần -> Chi tiêu giảm dần
    list.sort((a, b) => {
      if (b.orders !== a.orders) return b.orders - a.orders;
      if (b.sales !== a.sales) return b.sales - a.sales;
      return b.spend - a.spend;
    });

    return list;
  }, [dayCampaigns, searchTerm, filterOrdersOnly, filterAdType]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity cursor-pointer"
        onClick={onClose}
      />

      {/* Slide-out Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-3xl w-full bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-2xs">
              <ShoppingBag size={20} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">
                  CHI TIẾT CHIẾN DỊCH THEO NGÀY
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  {storeName !== "ALL" ? storeName : "Tất cả shop"}
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 font-medium">
                <CalendarBlank size={14} className="text-indigo-600" weight="bold" />
                Ngày: <strong className="text-slate-800">{currentDayStats.displayDate} ({selectedDate})</strong>
                <span>•</span>
                <span>Sắp xếp theo số đơn từ cao xuống thấp</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
            title="Đóng bảng"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Thanh chọn nhanh 7 Ngày (Quick Date Switcher) */}
        <div className="px-4 py-2.5 bg-white border-b border-slate-100">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            Chọn ngày trong 7 ngày gần nhất:
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {availableDates.map((item) => {
              const isSelected = item.rawDate === selectedDate;
              return (
                <button
                  key={item.rawDate}
                  type="button"
                  onClick={() => onSelectDate(item.rawDate)}
                  className={`flex flex-col items-center px-3 py-1.5 rounded-xl border text-xs transition cursor-pointer shrink-0 min-w-[76px] ${
                    isSelected
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-sm font-bold"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                  }`}
                >
                  <span className="text-[11px] font-semibold">{item.displayDate}</span>
                  <span
                    className={`text-[10px] mt-0.5 px-1.5 py-0.2 rounded-full font-black ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : item.orders > 0
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-400"
                    }`}
                  >
                    {item.orders} đơn
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4 Thẻ KPI Tóm Tắt Trong Ngày Đang Chọn */}
        <div className="grid grid-cols-4 gap-2.5 p-4 bg-slate-50/50 border-b border-slate-200">
          <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <ShoppingBag size={13} className="text-indigo-600" weight="bold" /> Tổng Đơn Hàng
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-black text-indigo-700">{currentDayStats.orders}</span>
              <span className="text-[10px] font-bold text-slate-500">đơn</span>
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <CurrencyDollar size={13} className="text-emerald-600" weight="bold" /> Doanh Thu
            </span>
            <div className="text-xl font-black text-emerald-600 mt-1">
              {currency}{Math.round(currentDayStats.sales).toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <TrendUp size={13} className="text-blue-600" weight="bold" /> Chi Tiêu
            </span>
            <div className="text-xl font-black text-blue-600 mt-1">
              {currency}{Math.round(currentDayStats.spend).toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <Percent size={13} className="text-slate-600" weight="bold" /> ACOS Ngày
            </span>
            <div className={`text-xl font-black mt-1 ${currentDayStats.acos <= 30 && currentDayStats.sales > 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {currentDayStats.sales > 0 ? `${currentDayStats.acos.toFixed(1)}%` : (currentDayStats.spend > 0 ? "N/A" : "0%")}
            </div>
          </div>
        </div>

        {/* Thanh tìm kiếm & bộ lọc chiến dịch */}
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-white">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm tên chiến dịch..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 outline-none focus:border-indigo-500 focus:bg-white text-slate-800"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterOrdersOnly((prev) => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition cursor-pointer font-bold ${
                filterOrdersOnly
                  ? "bg-indigo-50 text-indigo-700 border-indigo-300"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Funnel size={13} weight={filterOrdersOnly ? "bold" : "regular"} />
              <span>Chỉ có đơn ({dayCampaigns.filter((c) => c.orders > 0).length})</span>
            </button>

            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-bold">
              {(["ALL", "SP", "SB"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterAdType(t)}
                  className={`px-2 py-1 rounded-md transition cursor-pointer ${
                    filterAdType === t ? "bg-white text-indigo-700 shadow-2xs font-black" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {t === "ALL" ? "Tất cả" : t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Danh sách bảng Chiến dịch (Sorted by Orders DESC) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
              <p className="text-xs text-slate-500 font-medium">Đang tải dữ liệu chiến dịch ngày {currentDayStats.displayDate}...</p>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <ShoppingBag size={32} className="mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-700">Không tìm thấy chiến dịch nào</p>
              <p className="text-xs text-slate-400">Không có dữ liệu quảng cáo phát sinh cho ngày {currentDayStats.displayDate} theo điều kiện lọc.</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-black text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">#</th>
                    <th className="py-2.5 px-3">Chiến Dịch (Campaign)</th>
                    <th className="py-2.5 px-2 text-center w-14">Loại</th>
                    <th className="py-2.5 px-3 text-center w-24 bg-indigo-50/80 text-indigo-700">
                      Số Đơn ▾
                    </th>
                    <th className="py-2.5 px-3 text-right w-24">Doanh Thu</th>
                    <th className="py-2.5 px-3 text-right w-24">Chi Tiêu</th>
                    <th className="py-2.5 px-3 text-right w-20">ACOS</th>
                    <th className="py-2.5 px-3 text-right w-20">Clicks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredCampaigns.map((camp, idx) => {
                    const hasOrders = camp.orders > 0;
                    const isTop1 = idx === 0 && hasOrders;
                    const isTop2 = idx === 1 && hasOrders;
                    const isTop3 = idx === 2 && hasOrders;

                    return (
                      <tr
                        key={`${camp.date}-${camp.campaignName}-${camp.adType}`}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          hasOrders ? "bg-white font-medium" : "text-slate-500 bg-slate-50/30"
                        }`}
                      >
                        {/* Hạng Rank */}
                        <td className="py-2.5 px-3 text-center">
                          {isTop1 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-black text-xs shadow-2xs">
                              <Crown size={13} weight="fill" />
                            </span>
                          ) : isTop2 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-black text-xs">
                              <Medal size={13} weight="bold" />
                            </span>
                          ) : isTop3 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-800 font-bold text-xs">
                              3
                            </span>
                          ) : (
                            <span className="text-slate-400 font-semibold">{idx + 1}</span>
                          )}
                        </td>

                        {/* Tên Campaign */}
                        <td className="py-2.5 px-3 font-semibold text-slate-900 break-words max-w-[280px]">
                          <span className="hover:text-indigo-600 transition-colors cursor-default" title={camp.campaignName}>
                            {camp.campaignName}
                          </span>
                        </td>

                        {/* Loại SP / SB */}
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                              camp.adType === "SP"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-purple-50 text-purple-700 border border-purple-200"
                            }`}
                          >
                            {camp.adType}
                          </span>
                        </td>

                        {/* Số đơn hàng (CỘT NỔI BẬT NHẤT) */}
                        <td className="py-2.5 px-3 text-center bg-indigo-50/30">
                          {hasOrders ? (
                            <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-indigo-600 text-white font-black text-xs shadow-2xs">
                              {camp.orders} đơn
                            </span>
                          ) : (
                            <span className="text-slate-400 font-medium">0</span>
                          )}
                        </td>

                        {/* Doanh thu ($) */}
                        <td className="py-2.5 px-3 text-right font-black text-emerald-600">
                          {camp.sales > 0 ? `${currency}${camp.sales.toFixed(2)}` : "—"}
                        </td>

                        {/* Chi tiêu ($) */}
                        <td className="py-2.5 px-3 text-right font-bold text-blue-700">
                          {currency}{camp.spend.toFixed(2)}
                        </td>

                        {/* ACOS (%) */}
                        <td className="py-2.5 px-3 text-right font-black">
                          {camp.sales > 0 ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] ${
                                camp.acos <= 30
                                  ? "bg-emerald-50 text-emerald-700 font-bold"
                                  : camp.acos <= 50
                                  ? "bg-amber-50 text-amber-700 font-bold"
                                  : "bg-rose-50 text-rose-600 font-black"
                              }`}
                            >
                              {camp.acos.toFixed(1)}%
                            </span>
                          ) : camp.spend > 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-bold">
                              0 Sales
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Clicks */}
                        <td className="py-2.5 px-3 text-right text-slate-600 text-[11px]">
                          <span>{camp.clicks}</span>
                          {camp.cpc > 0 && (
                            <span className="block text-[9.5px] text-slate-400">
                              {currency}{camp.cpc.toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <div>
            Hiển thị <strong>{filteredCampaigns.length}</strong> / <strong>{dayCampaigns.length}</strong> chiến dịch ngày {currentDayStats.displayDate}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold transition cursor-pointer shadow-2xs"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
