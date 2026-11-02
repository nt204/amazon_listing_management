"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  CalendarBlankIcon,
  DownloadSimpleIcon,
  ArrowsClockwiseIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  CaretUpIcon,
  CaretDownIcon,
  CurrencyDollarIcon,
  ShoppingBagIcon,
  MegaphoneIcon,
  PackageIcon,
  TagIcon,
  TrendUpIcon,
  PercentIcon,
  ScalesIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  CopyIcon,
  EyeIcon,
  FileTextIcon,
  CalculatorIcon,
  StorefrontIcon,
} from "@phosphor-icons/react";
import type { SkuMonthlyItem, SkuMonthlyStoreSummary, AvailableMonthOption } from "@/lib/accounting/sku-monthly-db";
import { AccountingTopProgressBar, AccountingTableSkeletonRows } from "./accounting-skeleton";

interface SkuMonthlyViewProps {
  storeId?: string;
}

export function SkuMonthlyView({ storeId: propStoreId }: SkuMonthlyViewProps) {
  // Store management sync
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (propStoreId) return propStoreId;
    if (typeof window !== "undefined") {
      return localStorage.getItem("acc_selected_store_id") || "4acb9a51-eb3e-4096-b510-4d3e98100283";
    }
    return "4acb9a51-eb3e-4096-b510-4d3e98100283";
  });

  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<number | "all">(9); // Default to month 9
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [availableMonths, setAvailableMonths] = useState<AvailableMonthOption[]>([]);

  // Filters & Sorting
  const [search, setSearch] = useState("");
  const [productType, setProductType] = useState("all");
  const [status, setStatus] = useState("all");
  const [skuType, setSkuType] = useState<"all" | "active" | "win" | "loss">("all");
  const [sortField, setSortField] = useState<string>("revenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Data & UI states
  const [items, setItems] = useState<SkuMonthlyItem[]>([]);
  const [summary, setSummary] = useState<SkuMonthlyStoreSummary | null>(null);
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const [selectedSkuDetail, setSelectedSkuDetail] = useState<SkuMonthlyItem | null>(null);
  const [viewMode, setViewMode] = useState<"standard" | "full">("standard");

  // Recalculate raw data state
  const [recalculating, setRecalculating] = useState<boolean>(false);
  const [showRecalcModal, setShowRecalcModal] = useState<boolean>(false);
  const [recalcFeedback, setRecalcFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Debounce search input to avoid hitting backend on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load stores once on mount
  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((data) => {
        if (!ignore && data.stores) setStores(data.stores);
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
  }, []);

  // Sync store change from global events
  useEffect(() => {
    const handleStoreChange = () => {
      const stored = localStorage.getItem("acc_selected_store_id");
      if (stored && stored !== selectedStoreId) {
        setSelectedStoreId(stored);
      }
    };
    window.addEventListener("acc_store_changed", handleStoreChange);
    window.addEventListener("storage", handleStoreChange);

    return () => {
      window.removeEventListener("acc_store_changed", handleStoreChange);
      window.removeEventListener("storage", handleStoreChange);
    };
  }, [selectedStoreId]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!selectedStoreId) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        storeId: selectedStoreId,
        year: String(selectedYear),
        month: String(selectedMonth),
        search: debouncedSearch,
        productType,
        status,
        skuType,
        sortField,
        sortDirection,
      });

      const res = await fetch(`/api/accounting/financials/sku-monthly?${params.toString()}`);
      if (!res.ok) throw new Error(`Lỗi tải dữ liệu (${res.status})`);

      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || null);
      setProductTypes(data.productTypes || []);
      setStatuses(data.statuses || []);
      if (data.availableMonths && data.availableMonths.length > 0) {
        setAvailableMonths(data.availableMonths);
      }
    } catch (err: any) {
      console.error("[SkuMonthlyView] Error:", err);
      setError(err.message || "Không thể tải báo cáo tháng");
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, selectedYear, selectedMonth, debouncedSearch, productType, status, skuType, sortField, sortDirection]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Recalculate handler
  const handleRecalculate = async () => {
    if (selectedMonth === "all") return;
    setRecalculating(true);
    setShowRecalcModal(false);
    setRecalcFeedback(null);
    try {
      const res = await fetch("/api/accounting/financials/sku-monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          year: selectedYear,
          month: selectedMonth,
          force: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Có lỗi xảy ra khi tính toán lại");
      }
      setRecalcFeedback({
        success: true,
        message: data.message || `Đã hoàn tất tính toán kỳ ${selectedMonth}/${selectedYear} từ raw data!`,
      });
      await fetchData();
    } catch (err: any) {
      setRecalcFeedback({
        success: false,
        message: err.message || "Lỗi khi tính toán lại từ raw data",
      });
    } finally {
      setRecalculating(false);
    }
  };

  // Handle column sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSku(text);
    setTimeout(() => setCopiedSku(null), 1500);
  };

  const currentStoreName = useMemo(() => {
    const s = stores.find((st) => st.id === selectedStoreId);
    return s ? s.name : "WARMSTOREY";
  }, [stores, selectedStoreId]);

  // Format helpers
  const fmtCurrency = (val: number | null | undefined, forceSign = false) => {
    if (val === null || val === undefined || isNaN(val)) return "$0.00";
    const num = Number(val);
    const absStr = Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (num < 0) return `-$${absStr}`;
    if (forceSign && num > 0) return `+$${absStr}`;
    return `$${absStr}`;
  };

  const fmtPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return "—";
    return `${(Number(val) * 100).toFixed(1)}%`;
  };

  const fmtInt = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "0";
    return Number(val).toLocaleString("en-US");
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 overflow-hidden font-accounting-system">
      {/* 1. TOP TOOLBAR: Store, Month, Mode, Actions */}
      <div className="bg-slate-200/80 px-3 py-1.5 border-b border-slate-300 flex items-center justify-between gap-2 flex-wrap shadow-2xs shrink-0 select-none">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Store Selector */}
          {stores.length > 0 && (
            <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs">
              <StorefrontIcon size={14} weight="bold" className="text-indigo-600 mr-1.5 shrink-0" />
              <select
                value={selectedStoreId}
                onChange={(e) => {
                  setSelectedStoreId(e.target.value);
                  localStorage.setItem("acc_selected_store_id", e.target.value);
                  window.dispatchEvent(new Event("acc_store_changed"));
                }}
                className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
              >
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    Store: {st.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Month Selector */}
          <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs shadow-2xs">
            <CalendarBlankIcon size={14} weight="bold" className="text-indigo-600 mr-1.5 shrink-0" />
            <select
              value={selectedMonth}
              onChange={(e) => {
                const val = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
                setSelectedMonth(val);
              }}
              className="font-bold text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
            >
              {availableMonths.length > 0 ? (
                availableMonths.map((m) => (
                  <option key={m.month} value={m.month}>
                    {m.label} ({m.activeSkus} SKUs)
                  </option>
                ))
              ) : (
                <>
                  <option value={9}>Tháng 9/2026</option>
                  <option value={8}>Tháng 8/2026</option>
                  <option value={7}>Tháng 7/2026</option>
                  <option value={6}>Tháng 6/2026</option>
                  <option value={5}>Tháng 5/2026</option>
                  <option value={4}>Tháng 4/2026</option>
                  <option value={3}>Tháng 3/2026</option>
                  <option value={2}>Tháng 2/2026</option>
                  <option value={1}>Tháng 1/2026</option>
                </>
              )}
              <option value="all">Tất cả các tháng (YTD)</option>
            </select>
          </div>

          {/* View mode toggle */}
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode("standard")}
              className={`rounded px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                viewMode === "standard"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Tiêu chuẩn (14 cột)
            </button>
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={`rounded px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                viewMode === "full"
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Đầy đủ (27 cột)
            </button>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Recalculate Button */}
          <button
            type="button"
            onClick={() => {
              if (selectedMonth === "all") {
                alert("Vui lòng chọn một tháng cụ thể để tính toán lại từ file thô.");
                return;
              }
              setShowRecalcModal(true);
            }}
            disabled={recalculating || selectedMonth === "all"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100 transition cursor-pointer disabled:opacity-50"
            title="Tính toán lại P&L từ các file thô crawler tải về"
          >
            <CalculatorIcon
              size={14}
              weight="bold"
              className={recalculating ? "animate-spin text-indigo-600" : ""}
            />
            <span>{recalculating ? "Đang tính..." : "Tính từ file thô"}</span>
          </button>

          {/* Export Button */}
          <a
            href={`/api/accounting/financials/sku-monthly/export?storeId=${selectedStoreId}&month=${selectedMonth}&year=${selectedYear}&search=${encodeURIComponent(
              search
            )}`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-2xs hover:bg-emerald-700 transition cursor-pointer"
          >
            <DownloadSimpleIcon size={14} weight="bold" />
            <span>Xuất Excel</span>
          </a>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs disabled:opacity-50"
            title="Làm mới dữ liệu"
          >
            <ArrowsClockwiseIcon
              size={15}
              weight="bold"
              className={loading ? "animate-spin text-indigo-600" : ""}
            />
          </button>
        </div>
      </div>

      {/* 2. SEARCH & FILTER BAR */}
      <div className="bg-white px-3 py-1.5 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap shrink-0 text-xs select-none">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex items-center">
            <MagnifyingGlassIcon
              size={14}
              weight="bold"
              className="absolute left-2.5 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm SKU, ASIN, Product Type..."
              className="w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-6 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden shadow-2xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
              >
                ×
              </button>
            )}
          </div>

          {/* SKU Type quick filter tabs */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {[
              { key: "all", label: "Tất cả" },
              { key: "active", label: "Có phát sinh" },
              { key: "win", label: "SKU Lời" },
              { key: "loss", label: "SKU Lỗ" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSkuType(tab.key as any)}
                className={`rounded px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  skuType === tab.key
                    ? "bg-white text-indigo-700 shadow-2xs border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Product Type dropdown */}
          <select
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none cursor-pointer shadow-2xs"
          >
            <option value="all">Mọi Loại SP ({productTypes.length})</option>
            {productTypes.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
              </option>
            ))}
          </select>

          {/* Status dropdown */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none cursor-pointer shadow-2xs"
          >
            <option value="all">Mọi Trạng Thái ({statuses.length})</option>
            {statuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {/* Reset filter button if any active filter */}
          {(search || productType !== "all" || status !== "all" || skuType !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setProductType("all");
                setStatus("all");
                setSkuType("all");
              }}
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline cursor-pointer"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>

        {/* Right count info */}
        <div className="flex items-center gap-2 text-slate-500 font-medium">
          <span>
            Hiển thị <strong className="text-slate-900 font-bold">{items.length}</strong> SKU
          </span>
        </div>
      </div>

      {/* 3. KEY METRICS SUMMARY RIBBON */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 px-3 py-1.5 bg-slate-100/70 border-b border-slate-200 shrink-0 select-none">
          {/* 1. Doanh thu */}
          <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Doanh Thu</span>
              <CurrencyDollarIcon size={14} className="text-indigo-600" />
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
              {fmtCurrency(summary.total_revenue)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Đã bán: <b className="text-slate-800 font-mono">{fmtInt(summary.total_quantity)}</b> items
            </div>
          </div>

          {/* 2. Lợi nhuận ròng */}
          <div
            className={`rounded-lg px-3 py-1.5 border shadow-2xs ${
              summary.net_profit >= 0 ? "bg-emerald-50/60 border-emerald-200" : "bg-rose-50/60 border-rose-200"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>Lợi Nhuận Ròng</span>
              <TrendUpIcon size={14} className={summary.net_profit >= 0 ? "text-emerald-600" : "text-rose-600"} />
            </div>
            <div
              className={`text-sm font-bold mt-0.5 tabular-nums ${
                summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600"
              }`}
            >
              {fmtCurrency(summary.net_profit)}
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">
              Biên LN: <b className="font-mono">{fmtPercent(summary.margin)}</b>
            </div>
          </div>

          {/* 3. Chi phí Ads */}
          <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Chi Phí Ads</span>
              <MegaphoneIcon size={14} className="text-rose-500" />
            </div>
            <div className="text-sm font-bold text-rose-600 mt-0.5 tabular-nums">
              {fmtCurrency(summary.total_ads_fee)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              T-ACOS: <b className="text-slate-800 font-mono">{fmtPercent(summary.tacos)}</b>
            </div>
          </div>

          {/* 4. Phí sàn Amazon */}
          <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Phí Sàn Amazon</span>
              <ShoppingBagIcon size={14} className="text-amber-500" />
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
              {fmtCurrency(summary.total_amazon_fee)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              FBA, Ref, Storage...
            </div>
          </div>

          {/* 5. Giá vốn hàng bán */}
          <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Giá Vốn (Basecost)</span>
              <PackageIcon size={14} className="text-slate-500" />
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
              {fmtCurrency(summary.total_basecost)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Giá vốn xuất bán
            </div>
          </div>

          {/* 6. Tồn kho & Hoạt động */}
          <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Tồn Kho Hiện Tại</span>
              <PackageIcon size={14} className="text-indigo-500" />
            </div>
            <div className="text-sm font-bold text-indigo-700 mt-0.5 tabular-nums">
              {fmtInt(summary.total_available_now)} <span className="text-xs font-normal text-slate-500">pcs</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              <b className="text-emerald-700">{summary.active_sku_count}</b> SKU phát sinh
            </div>
          </div>
        </div>
      )}

      {/* 4. MAIN INTERACTIVE DATA TABLE */}
      <div className="flex-1 min-h-0 overflow-auto bg-white relative">
        <AccountingTopProgressBar loading={loading} variant="indigo" />

        {error ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-rose-600">
            <WarningCircleIcon size={32} weight="bold" />
            <p className="text-sm font-bold">{error}</p>
          </div>
        ) : (
          <table className="acc-financial-table w-full border-separate border-spacing-0 text-left border-b border-slate-200">
            {/* Table Header */}
            <thead className="sticky top-0 z-20 select-none">
              <tr className="bg-slate-100 text-slate-800 text-[11.5px] font-bold border-b border-slate-300 shadow-2xs">
                <th className="py-2 px-2.5 whitespace-nowrap text-center w-10 border-r border-slate-200 bg-slate-100">#</th>
                <th className="py-2 px-2 whitespace-nowrap text-center w-12 border-r border-slate-200 bg-slate-100">Ảnh</th>
                <th
                  onClick={() => handleSort("sku")}
                  className="py-2 px-2.5 whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center gap-1">
                    <span>SKU</span>
                    {sortField === "sku" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th className="py-2 px-2.5 whitespace-nowrap border-r border-slate-200 bg-slate-100">Product Type</th>
                <th
                  onClick={() => handleSort("revenue")}
                  className="py-2 px-2.5 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Doanh Thu</span>
                    {sortField === "revenue" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("quantity")}
                  className="py-2 px-2 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Số Lượng</span>
                    {sortField === "quantity" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("ads_fee")}
                  className="py-2 px-2.5 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Phí Ads</span>
                    {sortField === "ads_fee" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("basecost")}
                  className="py-2 px-2.5 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Giá Vốn</span>
                    {sortField === "basecost" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("amazon_fee_total")}
                  className="py-2 px-2.5 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Phí Amazon</span>
                    {sortField === "amazon_fee_total" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("profit")}
                  className="py-2 px-2.5 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Lợi Nhuận</span>
                    {sortField === "profit" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("margin")}
                  className="py-2 px-2 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Margin</span>
                    {sortField === "margin" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("tacos")}
                  className="py-2 px-2 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>TACOS</span>
                    {sortField === "tacos" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("available_now")}
                  className="py-2 px-2 text-right whitespace-nowrap cursor-pointer hover:bg-slate-200/70 border-r border-slate-200 bg-slate-100"
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>Tồn Kho</span>
                    {sortField === "available_now" &&
                      (sortDirection === "asc" ? <CaretUpIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />)}
                  </div>
                </th>

                {/* Extended columns in Full view mode */}
                {viewMode === "full" && (
                  <>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Thuế</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Return</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Adjustment</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Lưu kho</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Placement</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Long-Term</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">FBA Return</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Liquidations</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">BC Ret/Adj</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Removal</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">Rev Ads</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">ACOS</th>
                    <th className="py-2 px-2 text-right whitespace-nowrap border-r border-slate-200 bg-slate-100">ROI</th>
                  </>
                )}
                <th className="py-2 px-2 text-center whitespace-nowrap w-16 bg-slate-100">Chi Tiết</th>
              </tr>

              {/* Sticky Summary Row */}
              {summary && (
                <tr className="bg-amber-50/90 text-slate-900 border-b border-amber-300 font-bold text-xs select-none shadow-2xs">
                  <td className="py-1.5 px-2.5 text-center font-black text-amber-800 border-r border-amber-200/80 bg-amber-50">∑</td>
                  <td className="py-1.5 px-2 border-r border-amber-200/80 bg-amber-50"></td>
                  <td className="py-1.5 px-2.5 font-bold text-slate-900 border-r border-amber-200/80 bg-amber-50">TỔNG KỲ</td>
                  <td className="py-1.5 px-2.5 text-indigo-700 font-bold border-r border-amber-200/80 bg-amber-50">
                    {summary.active_sku_count} active
                  </td>
                  <td className="py-1.5 px-2.5 text-right font-bold text-slate-900 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtCurrency(summary.total_revenue)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-slate-900 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtInt(summary.total_quantity)}
                  </td>
                  <td className="py-1.5 px-2.5 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtCurrency(summary.total_ads_fee)}
                  </td>
                  <td className="py-1.5 px-2.5 text-right font-bold text-slate-800 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtCurrency(summary.total_basecost)}
                  </td>
                  <td className="py-1.5 px-2.5 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtCurrency(summary.total_amazon_fee)}
                  </td>
                  <td
                    className={`py-1.5 px-2.5 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50 ${
                      summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600"
                    }`}
                  >
                    {fmtCurrency(summary.net_profit)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtPercent(summary.margin)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtPercent(summary.tacos)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-bold text-indigo-800 tabular-nums border-r border-amber-200/80 bg-amber-50">
                    {fmtInt(summary.total_available_now)}
                  </td>

                  {viewMode === "full" && (
                    <>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_thue)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_return_amount)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_adjustment)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_storage_fee)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_placement_fee)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_long_term_fee)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_fba_customer_return_fee)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-emerald-700 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_liquidations)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-emerald-700 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_basecost_return_adj)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold text-rose-600 tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_removal)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtCurrency(summary.total_revenue_ads)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtPercent(summary.acos)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-bold tabular-nums border-r border-amber-200/80 bg-amber-50">
                        {fmtPercent(summary.roi)}
                      </td>
                    </>
                  )}
                  <td className="py-1.5 px-2 bg-amber-50"></td>
                </tr>
              )}
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-slate-100">
              {loading && items.length === 0 ? (
                <AccountingTableSkeletonRows
                  rows={10}
                  colSpan={viewMode === "full" ? 27 : 14}
                  rowHeightClass="h-[38px]"
                />
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={viewMode === "full" ? 27 : 14}
                    className="py-16 text-center text-slate-500"
                  >
                    <FileTextIcon size={36} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-bold text-slate-700">Không tìm thấy dữ liệu SKU phù hợp</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Thử thay đổi bộ lọc tìm kiếm hoặc chọn tháng khác
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => {
                  const isPositiveProfit = item.profit >= 0;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-indigo-50/30 transition-colors group cursor-pointer text-xs"
                      onClick={() => setSelectedSkuDetail(item)}
                    >
                      <td className="py-2 px-2.5 text-center text-slate-400 font-medium border-r border-slate-100">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-2 border-r border-slate-100 text-center">
                        <div className="relative mx-auto h-7 w-7 rounded bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                          {item.mockup_url ? (
                            <Image
                              src={item.mockup_url}
                              alt={item.sku}
                              fill
                              sizes="28px"
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[9px] font-bold text-slate-400">
                              —
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 whitespace-nowrap border-r border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 group-hover:text-indigo-600 transition">
                            {item.sku}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item.sku);
                            }}
                            className="text-slate-400 hover:text-slate-700 transition"
                            title="Copy SKU"
                          >
                            <CopyIcon size={12} />
                          </button>
                        </div>
                        {item.asin && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            ASIN: {item.asin}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap border-r border-slate-100">
                        <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {item.product_type || "Chưa phân loại"}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 text-right font-bold text-slate-900 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {fmtCurrency(item.revenue)}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-slate-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {fmtInt(item.quantity)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-medium text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {item.ads_fee !== 0 ? fmtCurrency(item.ads_fee) : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="py-2 px-2.5 text-right font-medium text-slate-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {item.basecost !== 0 ? fmtCurrency(item.basecost) : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td className="py-2 px-2.5 text-right font-medium text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {item.amazon_fee_total !== 0 ? fmtCurrency(item.amazon_fee_total) : <span className="text-slate-300 font-normal">—</span>}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-bold whitespace-nowrap tabular-nums border-r border-slate-100 ${
                          isPositiveProfit ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {fmtCurrency(item.profit)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-semibold whitespace-nowrap tabular-nums border-r border-slate-100 ${
                          (item.margin || 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {fmtPercent(item.margin)}
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-slate-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {fmtPercent(item.tacos)}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-indigo-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                        {fmtInt(item.available_now)}
                      </td>

                      {/* Extended columns in Full view mode */}
                      {viewMode === "full" && (
                        <>
                          <td className="py-2 px-2 text-right text-slate-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.thue !== 0 ? fmtCurrency(item.thue) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.return_amount !== 0 ? fmtCurrency(item.return_amount) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.adjustment !== 0 ? fmtCurrency(item.adjustment) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.storage_fee !== 0 ? fmtCurrency(item.storage_fee) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.placement_fee !== 0 ? fmtCurrency(item.placement_fee) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.long_term_fee !== 0 ? fmtCurrency(item.long_term_fee) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.fba_customer_return_fee !== 0 ? fmtCurrency(item.fba_customer_return_fee) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-emerald-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.liquidations !== 0 ? fmtCurrency(item.liquidations) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-emerald-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.basecost_return_adjustment !== 0
                              ? fmtCurrency(item.basecost_return_adjustment)
                              : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.removal !== 0 ? fmtCurrency(item.removal) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right font-medium text-slate-800 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {item.revenue_ads > 0 ? fmtCurrency(item.revenue_ads) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-600 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {fmtPercent(item.acos)}
                          </td>
                          <td className="py-2 px-2 text-right font-medium text-slate-700 whitespace-nowrap tabular-nums border-r border-slate-100">
                            {fmtPercent(item.roi)}
                          </td>
                        </>
                      )}

                      <td className="py-1.5 px-2 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSkuDetail(item);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition cursor-pointer"
                        >
                          <EyeIcon size={12} />
                          <span>Xem</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 5. BOTTOM STATUS BAR */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 font-medium shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span>
            Hiển thị <strong className="text-slate-900 font-bold">{items.length}</strong> SKU
            {summary && (
              <>
                {" "}— trong đó <strong className="text-emerald-700 font-bold">{summary.active_sku_count}</strong> SKU phát sinh giao dịch
              </>
            )}
          </span>
        </div>
        <div className="text-[11px] text-slate-400">
          Nhấp vào hàng hoặc nút <EyeIcon size={12} className="inline mx-0.5 text-slate-500" /> để xem chi tiết P&L
        </div>
      </div>

      {/* 6. Detailed Breakdown Modal */}
      {selectedSkuDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => setSelectedSkuDetail(null)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 rounded-xl bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                  {selectedSkuDetail.mockup_url ? (
                    <Image
                      src={selectedSkuDetail.mockup_url}
                      alt={selectedSkuDetail.sku}
                      fill
                      sizes="56px"
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-400">
                      No pic
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-slate-900">{selectedSkuDetail.sku}</h2>
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200/50">
                      {selectedSkuDetail.product_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                    <span>ASIN: <b className="font-mono text-slate-800">{selectedSkuDetail.asin || "—"}</b></span>
                    <span>FNSKU: <b className="font-mono text-slate-800">{selectedSkuDetail.fnsku || "—"}</b></span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Modal Breakdown Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Doanh Thu</span>
                <div className="text-base font-black text-slate-900 mt-1">{fmtCurrency(selectedSkuDetail.revenue)}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Số lượng: <b>{selectedSkuDetail.quantity}</b> items</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Chi Phí Ads</span>
                <div className="text-base font-black text-rose-600 mt-1">{fmtCurrency(selectedSkuDetail.ads_fee)}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">T-ACOS: <b>{fmtPercent(selectedSkuDetail.tacos)}</b></div>
              </div>

              <div className={`rounded-xl border p-3 ${selectedSkuDetail.profit >= 0 ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"}`}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Lợi Nhuận Ròng</span>
                <div className={`text-base font-black mt-1 ${selectedSkuDetail.profit >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                  {fmtCurrency(selectedSkuDetail.profit)}
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">Biên: <b>{fmtPercent(selectedSkuDetail.margin)}</b></div>
              </div>
            </div>

            {/* Chi tiết phụ phí sàn & hoàn tất */}
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Chi tiết các khoản phí</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Giá vốn hàng bán (Basecost):</span>
                  <span className="font-bold text-slate-900">{fmtCurrency(selectedSkuDetail.basecost)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Phí sàn Amazon (Trans Rp + Unrec):</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.amazon_fee_total)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Phí lưu kho (Storage Fee):</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.storage_fee)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Phí Placement Inbound:</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.placement_fee)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Phí Long-Term Storage:</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.long_term_fee)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Thuế (Tax Ads + Order):</span>
                  <span className="font-bold text-slate-900">{fmtCurrency(selectedSkuDetail.thue)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Khách hoàn tiền (Refund / Return):</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.return_amount)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Điều chỉnh (Adjustment):</span>
                  <span className="font-bold text-slate-900">{fmtCurrency(selectedSkuDetail.adjustment)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">FBA Customer Return Fee:</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.fba_customer_return_fee)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50/50">
                  <span className="text-slate-600">Thu hồi hàng (Removal):</span>
                  <span className="font-bold text-rose-600">{fmtCurrency(selectedSkuDetail.removal)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedSkuDetail(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recalculate Confirmation Modal */}
      {showRecalcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                <CalculatorIcon size={22} weight="bold" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Tính toán lại từ Raw Data</h3>
                <p className="text-xs text-slate-500">
                  Tháng {selectedMonth}/{selectedYear} - Store: {stores.find((s) => s.id === selectedStoreId)?.name || "Store hiện tại"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5">
                <WarningCircleIcon size={16} weight="bold" className="text-amber-600 shrink-0" />
                Lưu ý quan trọng:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 text-[11px]">
                <li>Hệ thống sẽ chạy parser đọc trực tiếp từ các file báo cáo thô trong thư mục crawler tải về.</li>
                <li>Dữ liệu tháng {selectedMonth}/{selectedYear} trong cơ sở dữ liệu sẽ được cập nhật lại theo các file mới nhất.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowRecalcModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleRecalculate}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white hover:bg-indigo-700 shadow-2xs transition cursor-pointer"
              >
                Xác nhận tính lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recalculate Feedback Notification */}
      {recalcFeedback && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md rounded-2xl bg-white p-4 shadow-xl border border-slate-200 space-y-2 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-start gap-3">
            {recalcFeedback.success ? (
              <CheckCircleIcon size={22} weight="fill" className="text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <WarningCircleIcon size={22} weight="fill" className="text-rose-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900">
                {recalcFeedback.success ? "Tính toán thành công!" : "Tính toán thất bại"}
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">{recalcFeedback.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setRecalcFeedback(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold ml-2 cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
