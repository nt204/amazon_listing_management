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
} from "@phosphor-icons/react";
import type { SkuMonthlyItem, SkuMonthlyStoreSummary, AvailableMonthOption } from "@/lib/accounting/sku-monthly-db";

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
    <div className="w-full space-y-5 px-3 py-4 sm:px-6 sm:py-6 max-w-[1720px] mx-auto">
      {/* 1. Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-xs">
              <CalendarBlankIcon size={22} weight="bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  BÁO CÁO THÁNG SKU (SKU-MONTHLY)
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200/60">
                  {currentStoreName}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200/60">
                  So khớp Excel 100%
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Báo cáo P&L toàn diện theo SKU, khớp từng con số với sheet SKU-monthly trong file kế toán
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Store Selector */}
          {stores.length > 0 && (
            <select
              value={selectedStoreId}
              onChange={(e) => {
                setSelectedStoreId(e.target.value);
                localStorage.setItem("acc_selected_store_id", e.target.value);
                window.dispatchEvent(new Event("acc_store_changed"));
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500 focus:bg-white cursor-pointer shadow-2xs"
            >
              {stores.map((st) => (
                <option key={st.id} value={st.id}>
                  Store: {st.name}
                </option>
              ))}
            </select>
          )}

          {/* Month Selector */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-2xs">
            <select
              value={selectedMonth}
              onChange={(e) => {
                const val = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
                setSelectedMonth(val);
              }}
              className="bg-transparent px-2.5 py-1 text-xs font-bold text-slate-900 outline-none cursor-pointer"
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
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("standard")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                viewMode === "standard" ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Tiêu chuẩn
            </button>
            <button
              type="button"
              onClick={() => setViewMode("full")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                viewMode === "full" ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Đầy đủ 25+ cột
            </button>
          </div>

          {/* Export Button */}
          <a
            href={`/api/accounting/financials/sku-monthly/export?storeId=${selectedStoreId}&month=${selectedMonth}&year=${selectedYear}&search=${encodeURIComponent(
              search
            )}`}
            download
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-slate-800 transition cursor-pointer"
          >
            <DownloadSimpleIcon size={15} weight="bold" />
            <span>Xuất Excel/CSV</span>
          </a>

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
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100 transition cursor-pointer disabled:opacity-50"
            title="Tính toán lại P&L từ các file thô crawler tải về"
          >
            <CalculatorIcon size={15} weight="bold" className={recalculating ? "animate-spin text-indigo-600" : ""} />
            <span>{recalculating ? "Đang tính..." : "Tính từ file thô"}</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs disabled:opacity-50"
            title="Làm mới dữ liệu"
          >
            <ArrowsClockwiseIcon size={16} weight="bold" className={loading ? "animate-spin text-indigo-600" : ""} />
          </button>
        </div>
      </div>



      {/* 3. Filter and Search Tool Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlassIcon
            size={16}
            weight="bold"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo SKU, ASIN hoặc Product Type..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:bg-white transition"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-700"
            >
              ×
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* SKU Type quick filter */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
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
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                  skuType === tab.key ? "bg-white text-indigo-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
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
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none cursor-pointer"
          >
            <option value="all">Mọi Product Type ({productTypes.length})</option>
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
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none cursor-pointer"
          >
            <option value="all">Mọi Trạng Thái ({statuses.length})</option>
            {statuses.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. Main Interactive Data Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
            <ArrowsClockwiseIcon size={28} className="animate-spin text-indigo-600" />
            <p className="text-xs font-bold">Đang tải và tính toán số liệu báo cáo tháng...</p>
          </div>
        ) : error ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-rose-600">
            <WarningCircleIcon size={32} weight="bold" />
            <p className="text-sm font-bold">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <FileTextIcon size={36} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-700">Không tìm thấy dữ liệu SKU phù hợp</p>
            <p className="text-xs text-slate-400 mt-1">Thử thay đổi bộ lọc tìm kiếm hoặc chọn tháng khác</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[750px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              {/* Table Header */}
              <thead className="bg-slate-50 sticky top-0 z-20 border-b border-slate-200 shadow-2xs">
                <tr>
                  <th className="py-3 px-3 font-bold text-slate-700 whitespace-nowrap">#</th>
                  <th className="py-3 px-3 font-bold text-slate-700 whitespace-nowrap">Ảnh</th>
                  <th
                    onClick={() => handleSort("sku")}
                    className="py-3 px-3 font-bold text-slate-700 whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-1">
                      <span>SKU</span>
                      {sortField === "sku" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th className="py-3 px-3 font-bold text-slate-700 whitespace-nowrap">Product Type</th>
                  <th
                    onClick={() => handleSort("revenue")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Revenue</span>
                      {sortField === "revenue" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("quantity")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Quantity</span>
                      {sortField === "quantity" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("ads_fee")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Ads Fee</span>
                      {sortField === "ads_fee" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("basecost")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Basecost</span>
                      {sortField === "basecost" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("amazon_fee_total")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Amazon Fee</span>
                      {sortField === "amazon_fee_total" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("profit")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Profit</span>
                      {sortField === "profit" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("margin")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Margin</span>
                      {sortField === "margin" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("tacos")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>TACOS</span>
                      {sortField === "tacos" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("available_now")}
                    className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap cursor-pointer hover:bg-slate-100"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Tồn kho</span>
                      {sortField === "available_now" &&
                        (sortDirection === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />)}
                    </div>
                  </th>

                  {/* Extended columns in Full view mode */}
                  {viewMode === "full" && (
                    <>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Thuế</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Return</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Adjustment</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Lưu kho</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Placement</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Long-Term</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">FBA Return Fee</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Liquidations</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">BC Ret/Adj</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Removal</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">Revenue Ads</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">ACOS</th>
                      <th className="py-3 px-3 font-bold text-slate-700 text-right whitespace-nowrap">ROI</th>
                    </>
                  )}
                  <th className="py-3 px-3 font-bold text-slate-700 text-center whitespace-nowrap">Chi tiết</th>
                </tr>

                {/* Sticky Summary Row (Row 2 in Excel) */}
                {summary && (
                  <tr className="bg-indigo-50/80 font-black text-slate-900 border-b-2 border-indigo-200">
                    <td className="py-2.5 px-3">∑</td>
                    <td className="py-2.5 px-3"></td>
                    <td className="py-2.5 px-3">SUM =&gt;</td>
                    <td className="py-2.5 px-3 text-indigo-700 font-extrabold">{summary.active_sku_count} active</td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">
                      {fmtCurrency(summary.total_revenue)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-900">
                      {fmtInt(summary.total_quantity)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-rose-600">
                      {fmtCurrency(summary.total_ads_fee)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-slate-800">
                      {fmtCurrency(summary.total_basecost)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black text-rose-600">
                      {fmtCurrency(summary.total_amazon_fee)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-black ${
                        summary.net_profit >= 0 ? "text-emerald-700" : "text-rose-600"
                      }`}
                    >
                      {fmtCurrency(summary.net_profit)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black">{fmtPercent(summary.margin)}</td>
                    <td className="py-2.5 px-3 text-right font-black">{fmtPercent(summary.tacos)}</td>
                    <td className="py-2.5 px-3 text-right font-black">{fmtInt(summary.total_available_now)}</td>

                    {viewMode === "full" && (
                      <>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-700">
                          {fmtCurrency(summary.total_thue)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_return_amount)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-700">
                          {fmtCurrency(summary.total_adjustment)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_storage_fee)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_placement_fee)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_long_term_fee)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_fba_customer_return_fee)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                          {fmtCurrency(summary.total_liquidations)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                          {fmtCurrency(summary.total_basecost_return_adj)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-600">
                          {fmtCurrency(summary.total_removal)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                          {fmtCurrency(summary.total_revenue_ads)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">{fmtPercent(summary.acos)}</td>
                        <td className="py-2.5 px-3 text-right font-bold">{fmtPercent(summary.roi)}</td>
                      </>
                    )}
                    <td className="py-2.5 px-3"></td>
                  </tr>
                )}
              </thead>

              {/* Table Body */}
              <tbody className="divide-y divide-slate-100">
                {items.map((item, idx) => {
                  const isPositiveProfit = item.profit >= 0;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                      onClick={() => setSelectedSkuDetail(item)}
                    >
                      <td className="py-2.5 px-3 text-slate-400 font-medium">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <div className="relative h-9 w-9 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 shrink-0">
                          {item.mockup_url ? (
                            <Image
                              src={item.mockup_url}
                              alt={item.sku}
                              fill
                              sizes="36px"
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-slate-400">
                              No pic
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-slate-900 group-hover:text-indigo-600 transition">
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
                            <CopyIcon size={13} />
                          </button>
                        </div>
                        {item.asin && (
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            ASIN: {item.asin}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          {item.product_type || "Chưa phân loại"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-slate-900 whitespace-nowrap">
                        {fmtCurrency(item.revenue)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-700 whitespace-nowrap">
                        {fmtInt(item.quantity)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                        {item.ads_fee !== 0 ? fmtCurrency(item.ads_fee) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-700 whitespace-nowrap">
                        {item.basecost !== 0 ? fmtCurrency(item.basecost) : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                        {item.amazon_fee_total !== 0 ? fmtCurrency(item.amazon_fee_total) : "—"}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-black whitespace-nowrap ${
                          isPositiveProfit ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {fmtCurrency(item.profit)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold whitespace-nowrap ${
                          (item.margin || 0) >= 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {fmtPercent(item.margin)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-600 whitespace-nowrap">
                        {fmtPercent(item.tacos)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-indigo-700 whitespace-nowrap">
                        {fmtInt(item.available_now)}
                      </td>

                      {/* Extended columns in Full view mode */}
                      {viewMode === "full" && (
                        <>
                          <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                            {item.thue !== 0 ? fmtCurrency(item.thue) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.return_amount !== 0 ? fmtCurrency(item.return_amount) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap">
                            {item.adjustment !== 0 ? fmtCurrency(item.adjustment) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.storage_fee !== 0 ? fmtCurrency(item.storage_fee) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.placement_fee !== 0 ? fmtCurrency(item.placement_fee) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.long_term_fee !== 0 ? fmtCurrency(item.long_term_fee) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.fba_customer_return_fee !== 0 ? fmtCurrency(item.fba_customer_return_fee) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-700 whitespace-nowrap">
                            {item.liquidations !== 0 ? fmtCurrency(item.liquidations) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-700 whitespace-nowrap">
                            {item.basecost_return_adjustment !== 0
                              ? fmtCurrency(item.basecost_return_adjustment)
                              : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-rose-600 whitespace-nowrap">
                            {item.removal !== 0 ? fmtCurrency(item.removal) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-800 whitespace-nowrap">
                            {item.revenue_ads > 0 ? fmtCurrency(item.revenue_ads) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                            {fmtPercent(item.acos)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-700 whitespace-nowrap">
                            {fmtPercent(item.roi)}
                          </td>
                        </>
                      )}

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSkuDetail(item);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                        >
                          <EyeIcon size={13} />
                          <span>Xem</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Detailed Breakdown Modal */}
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
