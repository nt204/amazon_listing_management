"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  MagnifyingGlass,
  ArrowsClockwise,
  DownloadSimple,
  CaretDown,
  CircleNotch,
  Check,
  TrendUp,
  TrendDown,
  Fire,
  X,
} from "@phosphor-icons/react";
import { PpcAmazonDatePicker, type DateRange } from "./ppc-amazon-date-picker";
import { PpcCopyButton } from "./ppc-copy-button";

interface Props {
  selectedStore: string;
  selectedSku: string;
  stores?: Array<{ id: string; name: string }>;
  targetAcos?: number;
  notify?: (msg: string, type?: "info" | "success" | "error") => void;
}

type CompareType = "none" | "same_last_month" | "prev_period" | "custom";

function padZero(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function shiftDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const [, m, d] = parts;
  return `${d}/${m}`;
}

function formatDateRangeLabel(start?: string, end?: string): string {
  if (!start || !end) return "-";
  const [sY, sM, sD] = start.split("-");
  const [eY, eM, eD] = end.split("-");
  if (!sD || !eD) return `${start} – ${end}`;
  return `${sD}/${sM}/${sY} – ${eD}/${eM}/${eY}`;
}

// Tính kỳ so sánh = cùng kỳ tháng trước (an toàn số ngày trong tháng)
function getSamePeriodLastMonth(startStr?: string, endStr?: string): DateRange | null {
  if (!startStr || !endStr) return null;
  const p1 = startStr.split("-").map(Number);
  const p2 = endStr.split("-").map(Number);
  if (p1.length < 3 || p2.length < 3 || p1.some(Number.isNaN) || p2.some(Number.isNaN)) return null;
  const [y1, m1, d1] = p1;
  const [y2, m2, d2] = p2;

  // Month 1 - 1 tháng
  const prevMonthIndex1 = m1 - 2;
  const targetYear1 = y1 + Math.floor(prevMonthIndex1 / 12);
  const normMonth1 = ((prevMonthIndex1 % 12) + 12) % 12;
  const maxDay1 = new Date(targetYear1, normMonth1 + 1, 0).getDate();
  const safeDay1 = Math.min(d1, maxDay1);
  const pStart = new Date(targetYear1, normMonth1, safeDay1);

  // Month 2 - 1 tháng
  const prevMonthIndex2 = m2 - 2;
  const targetYear2 = y2 + Math.floor(prevMonthIndex2 / 12);
  const normMonth2 = ((prevMonthIndex2 % 12) + 12) % 12;
  const maxDay2 = new Date(targetYear2, normMonth2 + 1, 0).getDate();
  const isFullMonth = d1 === 1 && d2 === new Date(y2, m2, 0).getDate();
  const safeDay2 = isFullMonth ? maxDay2 : Math.min(d2, maxDay2);
  const pEnd = new Date(targetYear2, normMonth2, safeDay2);

  return { startDate: formatDate(pStart), endDate: formatDate(pEnd) };
}

// Tính kỳ so sánh = kỳ liền trước (previous period)
function getPreviousPeriod(startStr?: string, endStr?: string): DateRange | null {
  if (!startStr || !endStr) return null;
  const p1 = startStr.split("-").map(Number);
  const p2 = endStr.split("-").map(Number);
  if (p1.length < 3 || p2.length < 3 || p1.some(Number.isNaN) || p2.some(Number.isNaN)) return null;
  const [y1, m1, d1] = p1;
  const [y2, m2, d2] = p2;
  const s = new Date(y1, m1 - 1, d1);
  const e = new Date(y2, m2 - 1, d2);
  const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;

  const pEnd = new Date(s);
  pEnd.setDate(pEnd.getDate() - 1);
  const pStart = new Date(pEnd);
  pStart.setDate(pStart.getDate() - diffDays + 1);
  return { startDate: formatDate(pStart), endDate: formatDate(pEnd) };
}

class RollupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[PpcStCampaignRollupView] Lỗi hiển thị:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
          <div className="font-extrabold text-rose-800 text-sm">
            Đã có sự cố khi hiển thị dữ liệu đối soát:
          </div>
          <div className="text-xs text-rose-600 font-mono">
            {this.state.error?.message || "Lỗi không xác định"}
          </div>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
          >
            Thử tải lại bảng
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PpcStCampaignRollupView(props: Props) {
  return (
    <RollupErrorBoundary>
      <PpcStCampaignRollupViewInner {...props} />
    </RollupErrorBoundary>
  );
}

function PpcStCampaignRollupViewInner({
  selectedStore,
  selectedSku,
  targetAcos = 30,
  notify,
}: Props) {
  // Khoảng ngày chính (Kỳ hiện tại)
  const [primaryPeriod, setPrimaryPeriod] = useState<DateRange>({
    startDate: "2026-09-07",
    endDate: "2026-10-06",
  });

  // Loại so sánh: "none" | "same_last_month" | "prev_period" | "custom"
  const [compareType, setCompareType] = useState<CompareType>("same_last_month");

  // Dải ngày so sánh tùy chỉnh (chỉ dùng khi compareType === "custom")
  const [customComparePeriod, setCustomComparePeriod] = useState<DateRange>({
    startDate: "2026-08-07",
    endDate: "2026-09-06",
  });

  // Dropdown mở menu chọn loại so sánh
  const [isCompareMenuOpen, setIsCompareMenuOpen] = useState(false);
  const compareMenuRef = useRef<HTMLDivElement>(null);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // State dữ liệu
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [availableRange, setAvailableRange] = useState<DateRange | null>(null);
  const requestIdRef = useRef(0);

  // Drilldown Map<campaignName, boolean>
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});
  const [campaignDetails, setCampaignDetails] = useState<Record<string, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<Record<string, boolean>>({});
  const [detailFilterTab, setDetailFilterTab] = useState<Record<string, string>>({});

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (compareMenuRef.current && !compareMenuRef.current.contains(e.target as Node)) {
        setIsCompareMenuOpen(false);
      }
    }
    if (isCompareMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isCompareMenuOpen]);

  // Kỳ so sánh hiệu dụng được tự động tính toán
  const effectiveComparePeriod = useMemo<DateRange | null>(() => {
    if (compareType === "none") return null;
    if (compareType === "same_last_month") {
      const r = getSamePeriodLastMonth(primaryPeriod?.startDate, primaryPeriod?.endDate);
      return r?.startDate && r?.endDate ? r : null;
    }
    if (compareType === "prev_period") {
      const r = getPreviousPeriod(primaryPeriod?.startDate, primaryPeriod?.endDate);
      return r?.startDate && r?.endDate ? r : null;
    }
    return customComparePeriod?.startDate && customComparePeriod?.endDate ? customComparePeriod : null;
  }, [compareType, primaryPeriod, customComparePeriod]);

  const compareLabel = useMemo(() => {
    if (compareType === "none") return "Không so sánh";
    if (compareType === "same_last_month") return "Cùng kỳ tháng trước";
    if (compareType === "prev_period") return "Kỳ trước";
    return "Tùy chỉnh";
  }, [compareType]);

  const compareContextText = useMemo(() => {
    if (compareType === "same_last_month") return "vs tháng trước";
    if (compareType === "prev_period") return "vs kỳ trước";
    return "vs kỳ so sánh";
  }, [compareType]);

  // Nạp dữ liệu
  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        storeName: selectedStore,
        sku: selectedSku,
        startDate: primaryPeriod.startDate,
        endDate: primaryPeriod.endDate,
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });

      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      if (effectiveComparePeriod) {
        params.set("compareStartDate", effectiveComparePeriod.startDate);
        params.set("compareEndDate", effectiveComparePeriod.endDate);
      }

      const res = await fetch(`/api/ppc/search-terms/campaign-rollup?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể tải dữ liệu`);
      const json = await res.json();
      if (json.success) {
        if (requestId !== requestIdRef.current) return;
        const available = json.data?.availableRange;
        if (available?.startDate && available?.endDate) {
          setAvailableRange({ startDate: available.startDate, endDate: available.endDate });
          if (primaryPeriod.startDate < available.startDate || primaryPeriod.endDate > available.endDate) {
            const nextEnd = available.endDate;
            const nextStart = shiftDate(nextEnd, -29) < available.startDate ? available.startDate : shiftDate(nextEnd, -29);
            setPrimaryPeriod({ startDate: nextStart, endDate: nextEnd });
            return;
          }
        }
        setData(json.data);
      } else {
        throw new Error(json.error || "Lỗi tải dữ liệu");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi khi tải bảng chiến dịch từ Search Terms";
      notify?.(msg, "error");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [selectedStore, selectedSku, primaryPeriod, effectiveComparePeriod, page, pageSize, sortBy, sortDir, searchQuery, notify]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Drill-down search terms của campaign
  const toggleExpandCampaign = async (campaignName: string) => {
    const detailKey = [selectedStore, selectedSku, primaryPeriod.startDate, primaryPeriod.endDate,
      effectiveComparePeriod?.startDate || "", effectiveComparePeriod?.endDate || "", campaignName].join("::");
    const isCurrentlyExpanded = Boolean(expandedCampaigns[campaignName]);
    const nextState = !isCurrentlyExpanded;

    setExpandedCampaigns((prev) => ({
      ...prev,
      [campaignName]: nextState,
    }));

    if (nextState && !campaignDetails[detailKey]) {
      setLoadingDetail((prev) => ({ ...prev, [detailKey]: true }));
      try {
        const params = new URLSearchParams({
          storeName: selectedStore,
          sku: selectedSku,
          startDate: primaryPeriod.startDate,
          endDate: primaryPeriod.endDate,
          detailCampaign: campaignName,
        });

        if (effectiveComparePeriod) {
          params.set("compareStartDate", effectiveComparePeriod.startDate);
          params.set("compareEndDate", effectiveComparePeriod.endDate);
        }

        const res = await fetch(`/api/ppc/search-terms/campaign-rollup?${params.toString()}`);
        if (!res.ok) throw new Error("Không thể tải chi tiết từ khóa");
        const json = await res.json();
        if (json.success) {
          setCampaignDetails((prev) => ({
            ...prev,
            [detailKey]: json.data,
          }));
        }
      } catch (err) {
        notify?.("Lỗi tải chi tiết Search Terms của campaign", "error");
      } finally {
        setLoadingDetail((prev) => ({ ...prev, [detailKey]: false }));
      }
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!data?.items || data.items.length === 0) return;
    let csvContent = "";
    if (compareType === "none") {
      csvContent = "Campaign Name,Search Terms,Spend,Sales,Orders,Clicks,Impressions,CTR (%),CPC ($),CVR (%),ACOS (%)\n";
      data.items.forEach((it: any) => {
        csvContent += `"${it.campaignName.replace(/"/g, '""')}",${it.totalTerms},${it.spend},${it.sales},${it.orders},${it.clicks},${it.impressions},${it.ctr},${it.cpc},${it.cvr},${it.sales > 0 ? it.acos : ""}\n`;
      });
    } else {
      csvContent = "Campaign Name,Search Terms,Spend,Spend Change (%),Sales,Sales Change (%),Orders,Orders Change,CPC,ACOS,ACOS Change (%),CVR,CVR Change (%)\n";
      data.items.forEach((it: any) => {
        csvContent += `"${it.campaignName.replace(/"/g, '""')}",${it.totalTerms},${it.spend},${it.deltaSpendPct}%,${it.sales},${it.deltaSalesPct}%,${it.orders},${it.deltaOrders},${it.cpc},${it.sales > 0 ? `${it.acos}%` : ""},${it.sales > 0 && it.p2?.sales > 0 ? `${it.deltaAcosPp}%` : ""},${it.cvr}%,${it.deltaCvrPp}%\n`;
      });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ppc-campaigns-by-st-${compareType}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const isCompare = compareType !== "none" && Boolean(effectiveComparePeriod);
  const summary = data?.summary;
  const items = data?.items || [];
  const totalCount = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const incompleteCoverage = Boolean(
    isCompare
      ? data?.coverage?.p1 && data?.coverage?.p2 && (!data.coverage.p1.complete || !data.coverage.p2.complete)
      : data?.coverage?.dataDays !== undefined && !data.coverage.p1 && !data.coverage.complete
  );

  // Lấy giá trị chính và delta cho KPI card
  const curSpend = isCompare ? Number(summary?.p1?.spend ?? 0) : Number(summary?.spend ?? 0);
  const curSales = isCompare ? Number(summary?.p1?.sales ?? 0) : Number(summary?.sales ?? 0);
  const curOrders = isCompare ? Number(summary?.p1?.orders ?? 0) : Number(summary?.orders ?? 0);
  const curAcos = isCompare ? Number(summary?.p1?.acos ?? 0) : Number(summary?.acos ?? 0);
  const curCpc = isCompare ? Number(summary?.p1?.cpc ?? 0) : Number(summary?.cpc ?? 0);
  const curCvr = isCompare ? Number(summary?.p1?.cvr ?? 0) : Number(summary?.cvr ?? 0);
  const curTerms = isCompare ? Number(summary?.p1?.terms ?? 0) : Number(summary?.totalTerms ?? 0);

  const prevSpend = Number(summary?.p2?.spend ?? 0);
  const prevSales = Number(summary?.p2?.sales ?? 0);
  const prevOrders = Number(summary?.p2?.orders ?? 0);
  const prevAcos = Number(summary?.p2?.acos ?? 0);
  const prevCpc = Number(summary?.p2?.cpc ?? 0);
  const prevCvr = Number(summary?.p2?.cvr ?? 0);
  const prevTerms = Number(summary?.p2?.terms ?? 0);

  const deltaSpendPct = Number(summary?.delta?.spendPct ?? 0);
  const deltaSalesPct = Number(summary?.delta?.salesPct ?? 0);
  const deltaOrders = Number(summary?.delta?.orders ?? 0);
  const deltaAcosPp = Number(summary?.delta?.acos ?? 0);
  const deltaCpcPct = Number(summary?.delta?.cpcPct ?? 0);
  const deltaCvrPp = Number(summary?.delta?.cvr ?? 0);
  const deltaTermsPct = Number(summary?.delta?.termsPct ?? 0);

  return (
    <div className="space-y-4 text-slate-800">
      {/* 1. HEADER BANNER & ACTION BAR */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-black uppercase tracking-wider">
              Search Term Roll-up View
            </span>
            <h2 className="text-base font-black text-slate-900 tracking-tight">
              Báo Cáo Chiến Dịch Từ Search Terms
            </h2>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer shadow-2xs disabled:opacity-50"
            title="Xuất file CSV báo cáo"
          >
            <DownloadSimple size={14} weight="bold" />
            <span className="hidden sm:inline">Xuất CSV</span>
          </button>
        </div>

        {/* 2. DẢI BỘ LỌC TỐI GIẢN: TÌM KIẾM BÊN TRÁI | 1 RANGE CHÍNH + SO SÁNH DROPDOWN BÊN PHẢI */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Ô Tìm Kiếm Campaign */}
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <MagnifyingGlass size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo tên Campaign..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:bg-white focus:border-indigo-600 transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setPage(1);
                }}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </div>

          {/* Cụm Bộ Lọc Ngày & So Sánh (Bên Phải) */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <span className="text-xs font-bold text-slate-600 shrink-0">Khoảng thời gian:</span>

            {/* 1 Date Range chính (Amazon Style) */}
            <PpcAmazonDatePicker
              value={primaryPeriod}
              minDate={availableRange?.startDate}
              maxDate={availableRange?.endDate}
              anchorDate={availableRange?.endDate}
              onChange={(range) => {
                setPrimaryPeriod(range);
                setPage(1);
              }}
              align="right"
            />

            {/* Dropdown So Sánh */}
            <div className="relative" ref={compareMenuRef}>
              <button
                type="button"
                onClick={() => setIsCompareMenuOpen((v) => !v)}
                className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-2xs ${
                  compareType !== "none"
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                    : "bg-white border-slate-300 hover:border-slate-400 text-slate-700 hover:bg-slate-50"
                }`}
                title="Chọn chu kỳ so sánh đối soát"
              >
                <span>{compareType === "none" ? "So sánh" : <>So sánh: <strong className="font-extrabold">{compareLabel}</strong></>}</span>
                <CaretDown size={11} weight="bold" className={`transition-transform ${isCompareMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {isCompareMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-40 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 w-56 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Chế độ so sánh
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCompareType("none");
                      setIsCompareMenuOpen(false);
                      setPage(1);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between cursor-pointer ${
                      compareType === "none" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>Không so sánh</span>
                    {compareType === "none" && <Check size={13} weight="bold" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCompareType("same_last_month");
                      setIsCompareMenuOpen(false);
                      setPage(1);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between cursor-pointer ${
                      compareType === "same_last_month" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>Cùng kỳ tháng trước</span>
                    {compareType === "same_last_month" && <Check size={13} weight="bold" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCompareType("prev_period");
                      setIsCompareMenuOpen(false);
                      setPage(1);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between cursor-pointer ${
                      compareType === "prev_period" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>Kỳ trước</span>
                    {compareType === "prev_period" && <Check size={13} weight="bold" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCompareType("custom");
                      setIsCompareMenuOpen(false);
                      setPage(1);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold flex items-center justify-between cursor-pointer ${
                      compareType === "custom" ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>Tùy chỉnh</span>
                    {compareType === "custom" && <Check size={13} weight="bold" />}
                  </button>
                </div>
              )}
            </div>

            {/* Nếu chọn Tùy chỉnh: hiện thêm bộ chọn ngày thứ hai */}
            {compareType === "custom" && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-bold text-xs">vs</span>
                <PpcAmazonDatePicker
                  value={customComparePeriod}
                  minDate={availableRange?.startDate}
                  maxDate={availableRange?.endDate}
                  anchorDate={availableRange?.endDate}
                  onChange={(range) => {
                    setCustomComparePeriod(range);
                    setPage(1);
                  }}
                  label="Kỳ đối chiếu"
                  align="right"
                />
              </div>
            )}

            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition cursor-pointer shadow-2xs"
              title="Tải lại dữ liệu"
            >
              <ArrowsClockwise size={14} className={loading ? "animate-spin text-indigo-600" : ""} weight="bold" />
            </button>
          </div>
        </div>

        {/* Dòng hiển thị khi BẬT COMPARE: ● Kỳ hiện tại   07/09 – 06/10      ○ Kỳ so sánh   07/08 – 06/09 */}
        {isCompare && effectiveComparePeriod && (
          <div className="flex flex-wrap items-center gap-6 text-xs font-medium pt-2 border-t border-slate-100 text-slate-600">
            <div className="flex items-center gap-2">
              <span className="text-slate-900 text-sm leading-none select-none">●</span>
              <span>
                Kỳ hiện tại:{" "}
                <strong className="text-slate-900 font-mono font-bold">
                  {formatShortDate(primaryPeriod.startDate)} &ndash; {formatShortDate(primaryPeriod.endDate)}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm leading-none select-none">○</span>
              <span>
                Kỳ so sánh:{" "}
                <strong className="text-slate-900 font-mono font-bold">
                  {formatShortDate(effectiveComparePeriod.startDate)} &ndash; {formatShortDate(effectiveComparePeriod.endDate)}
                </strong>
                {compareType === "custom" && (
                  <span className="text-[11px] text-slate-400 font-medium ml-1">({compareLabel})</span>
                )}
              </span>
            </div>
          </div>
        )}

        {incompleteCoverage && data?.coverage && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">
            <Fire size={14} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              Dữ liệu chưa phủ đủ khoảng đã chọn. {isCompare && data.coverage.p1 && data.coverage.p2
                ? `Kỳ hiện tại có ${data.coverage.p1.dataDays ?? 0}/${data.coverage.p1.expectedDays ?? 0} ngày; kỳ so sánh có ${data.coverage.p2.dataDays ?? 0}/${data.coverage.p2.expectedDays ?? 0} ngày.`
                : `Hiện có ${data.coverage.dataDays ?? 0}/${data.coverage.expectedDays ?? 0} ngày.`} Các tỷ lệ vẫn được tính đúng trên dữ liệu hiện có, nhưng không nên kết luận xu hướng cho đến khi đủ ngày.
            </span>
          </div>
        )}
      </div>

      {/* 2. 6 KPI CARDS (ĐÃ CẬP NHẬT THEO ĐÚNG ĐỀ XUẤT) */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* CARD 1: SPEND */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Spend</div>
              <div className="text-base font-black text-slate-900 mt-0.5">
                ${curSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            {isCompare ? (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaSpendPct > 0 ? "text-amber-600" : deltaSpendPct < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                  <span>{deltaSpendPct > 0 ? "▲" : deltaSpendPct < 0 ? "▼" : "="}</span>
                  <span>{deltaSpendPct !== 0 ? `${Math.abs(deltaSpendPct)}%` : "0%"} {compareContextText}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">
                  Kỳ trước: ${prevSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 font-semibold mt-0.5">{summary.totalCampaigns ?? 0} camps</div>
            )}
          </div>

          {/* CARD 2: SALES */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sales</div>
              <div className="text-base font-black text-emerald-600 mt-0.5">
                ${curSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            {isCompare ? (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaSalesPct > 0 ? "text-emerald-600" : deltaSalesPct < 0 ? "text-rose-600" : "text-slate-500"}`}>
                  <span>{deltaSalesPct > 0 ? "▲" : deltaSalesPct < 0 ? "▼" : "="}</span>
                  <span>{deltaSalesPct !== 0 ? `${Math.abs(deltaSalesPct)}%` : "0%"} {compareContextText}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">
                  Kỳ trước: ${prevSales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 font-semibold mt-0.5">{curOrders} orders</div>
            )}
          </div>

          {/* CARD 3: ACOS */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ACOS</div>
              <div className={`text-base font-black mt-0.5 ${curAcos <= targetAcos ? "text-emerald-600" : "text-amber-600"}`}>
                {curSales > 0 ? `${curAcos}%` : "—"}
              </div>
            </div>
            {isCompare && curSales > 0 && prevSales > 0 && (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaAcosPp < 0 ? "text-emerald-600" : deltaAcosPp > 0 ? "text-rose-600" : "text-slate-500"}`}>
                  <span>{deltaAcosPp < 0 ? "▼" : deltaAcosPp > 0 ? "▲" : "="}</span>
                  <span>{deltaAcosPp !== 0 ? `${Math.abs(deltaAcosPp)}%` : "0%"}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">Kỳ trước: {prevAcos}%</div>
              </div>
            )}
          </div>

          {/* CARD 4: CPC */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">CPC</div>
              <div className="text-base font-black text-slate-800 mt-0.5">${curCpc.toFixed(2)}</div>
            </div>
            {isCompare ? (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaCpcPct < 0 ? "text-emerald-600" : deltaCpcPct > 0 ? "text-rose-600" : "text-slate-500"}`}>
                  <span>{deltaCpcPct < 0 ? "▼" : deltaCpcPct > 0 ? "▲" : "="}</span>
                  <span>{deltaCpcPct !== 0 ? `${Math.abs(deltaCpcPct)}%` : "0%"}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">Kỳ trước: ${prevCpc.toFixed(2)}</div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 font-semibold mt-0.5">Chi phí / Click</div>
            )}
          </div>

          {/* CARD 5: CVR */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">CVR</div>
              <div className="text-base font-black text-indigo-600 mt-0.5">{curCvr}%</div>
            </div>
            {isCompare ? (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaCvrPp > 0 ? "text-emerald-600" : deltaCvrPp < 0 ? "text-rose-600" : "text-slate-500"}`}>
                  <span>{deltaCvrPp > 0 ? "▲" : deltaCvrPp < 0 ? "▼" : "="}</span>
                  <span>{deltaCvrPp !== 0 ? `${Math.abs(deltaCvrPp)}%` : "0%"}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">Kỳ trước: {prevCvr}%</div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 font-semibold mt-0.5">Tỷ lệ chuyển đổi</div>
            )}
          </div>

          {/* CARD 6: SEARCH TERMS */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Search Terms</div>
              <div className="text-base font-black text-slate-900 mt-0.5">{curTerms.toLocaleString()}</div>
            </div>
            {isCompare && (
              <div className="mt-1 pt-1.5 border-t border-slate-100 text-[11px] space-y-0.5">
                <div className={`font-bold flex items-center gap-1 ${deltaTermsPct >= 0 ? "text-indigo-600" : "text-slate-500"}`}>
                  <span>{deltaTermsPct > 0 ? "▲" : deltaTermsPct < 0 ? "▼" : "="}</span>
                  <span>{deltaTermsPct !== 0 ? `${Math.abs(deltaTermsPct)}%` : "0%"}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-medium">Kỳ trước: {prevTerms.toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. BẢNG CAMPAIGN: GIỮ NGUYÊN CỘT, HIỆN DELTA NGAY DƯỚI GIÁ TRỊ (KHÔNG PHÌNH BẢNG) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto relative">
          {loading && items.length > 0 && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-600 animate-pulse z-20" />
          )}
          <table className="w-full text-left text-xs text-slate-700 border-collapse">
            {/* THEAD */}
            {isCompare ? (
              /* KHI BẬT SO SÁNH: Gom lại thành Cột 1 (Kỳ hiện tại) và Cột 2 (Kỳ so sánh) */
              <thead>
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600 font-extrabold border-b border-slate-200">
                  <th rowSpan={2} className="py-2.5 px-3 w-8 text-center align-bottom">#</th>
                  <th
                    rowSpan={2}
                    className="py-2.5 px-3 cursor-pointer hover:text-indigo-600 min-w-[260px] align-bottom"
                    onClick={() => handleSort("name")}
                  >
                    Tên Campaign {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th rowSpan={2} className="py-2.5 px-3 text-center align-bottom w-24">Search Terms</th>

                  {/* Cột 1: Ngày A đến Ngày B */}
                  <th colSpan={4} className="py-2 px-3 text-center border-l border-slate-200 bg-indigo-50/70 text-indigo-950 font-black tracking-normal normal-case text-xs">
                    {formatDateRangeLabel(primaryPeriod.startDate, primaryPeriod.endDate)}
                  </th>

                  {/* Cột 2: Ngày C đến Ngày D */}
                  <th colSpan={4} className="py-2 px-3 text-center border-l border-slate-200 bg-slate-50 text-slate-700 font-black tracking-normal normal-case text-xs">
                    {formatDateRangeLabel(effectiveComparePeriod?.startDate, effectiveComparePeriod?.endDate)}
                  </th>

                  {/* Cột biến động Spend */}
                  <th
                    rowSpan={2}
                    className="py-2.5 px-3 text-right align-bottom border-l border-slate-200 w-28 cursor-pointer hover:text-indigo-600 whitespace-nowrap"
                    onClick={() => handleSort("delta_spend")}
                  >
                    Spend (Δ) {sortBy === "delta_spend" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>

                <tr className="bg-slate-50/90 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                  {/* Subheaders Kỳ 1 */}
                  <th
                    className="py-1.5 px-2.5 text-right border-l border-slate-200 cursor-pointer hover:text-indigo-600 w-24"
                    onClick={() => handleSort("spend")}
                  >
                    Spend {sortBy === "spend" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-1.5 px-2.5 text-right cursor-pointer hover:text-indigo-600 w-24"
                    onClick={() => handleSort("sales")}
                  >
                    Sales {sortBy === "sales" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-1.5 px-2.5 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("orders")}
                  >
                    Orders {sortBy === "orders" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-1.5 px-2.5 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("acos")}
                  >
                    ACOS {sortBy === "acos" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>

                  {/* Subheaders Kỳ 2 */}
                  <th className="py-1.5 px-2.5 text-right border-l border-slate-200 w-24">Spend</th>
                  <th className="py-1.5 px-2.5 text-right w-24">Sales</th>
                  <th className="py-1.5 px-2.5 text-right w-20">Orders</th>
                  <th className="py-1.5 px-2.5 text-right w-20">ACOS</th>
                </tr>
              </thead>
            ) : (
              /* KHI KHÔNG SO SÁNH: Giữ nguyên giao diện 10 cột truyền thống */
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th
                    className="py-3 px-3 cursor-pointer hover:text-indigo-600 min-w-[260px]"
                    onClick={() => handleSort("name")}
                  >
                    Tên Campaign {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-center w-24">Search Terms</th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-24"
                    onClick={() => handleSort("spend")}
                  >
                    Spend ($) {sortBy === "spend" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-24"
                    onClick={() => handleSort("sales")}
                  >
                    Sales ($) {sortBy === "sales" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("orders")}
                  >
                    Orders {sortBy === "orders" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("clicks")}
                  >
                    Clicks {sortBy === "clicks" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("cpc")}
                  >
                    CPC ($) {sortBy === "cpc" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-indigo-600 w-20"
                    onClick={() => handleSort("acos")}
                  >
                    ACOS (%) {sortBy === "acos" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="py-3 px-3 text-right w-20">CVR (%)</th>
                </tr>
              </thead>
            )}

            <tbody className={`divide-y divide-slate-100 font-mono text-[11px] transition-opacity duration-150 ${loading && items.length > 0 ? "opacity-60 pointer-events-none" : "opacity-100"}`}>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={isCompare ? 12 : 10} className="p-12 text-center text-xs text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <CircleNotch size={24} className="animate-spin text-indigo-600" />
                      <span className="font-bold text-slate-700">Đang tổng hợp dữ liệu Search Terms...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={isCompare ? 12 : 10} className="p-10 text-center text-slate-400 font-sans font-medium">
                    Không có chiến dịch nào phát sinh Search Term trong khoảng thời gian này.
                  </td>
                </tr>
              ) : (
                items.map((row: any, idx: number) => {
                  const detailKey = [selectedStore, selectedSku, primaryPeriod.startDate, primaryPeriod.endDate,
                    effectiveComparePeriod?.startDate || "", effectiveComparePeriod?.endDate || "", row.campaignName].join("::");
                  const isExpanded = Boolean(expandedCampaigns[row.campaignName]);
                  const detail = campaignDetails[detailKey];
                  const isDetailLoading = Boolean(loadingDetail[detailKey]);

                  return (
                    <React.Fragment key={row.campaignName}>
                      {isCompare ? (
                        /* HÀNG CAMPAIGN SO SÁNH: Gom nhóm Cột 1 vs Cột 2 */
                        <tr
                          onClick={() => toggleExpandCampaign(row.campaignName)}
                          className={`hover:bg-slate-50/80 transition cursor-pointer ${isExpanded ? "bg-indigo-50/40" : ""}`}
                        >
                          <td className="p-3 text-center text-slate-400 font-mono text-[10px]">
                            {(page - 1) * pageSize + idx + 1}
                          </td>

                          {/* 1. Campaign Name */}
                          <td className="py-2.5 px-3 font-sans font-bold text-slate-900">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="break-words select-text">{row.campaignName}</span>
                              <PpcCopyButton value={row.campaignName} label="tên campaign" />
                            </div>
                          </td>

                          {/* 2. Search Terms count & toggle */}
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandCampaign(row.campaignName);
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono font-bold text-xs transition cursor-pointer border ${
                                isExpanded
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                  : "bg-slate-100 hover:bg-indigo-50 text-slate-800 hover:text-indigo-700 border-slate-200 hover:border-indigo-200"
                              }`}
                              title="Bấm để bung danh sách Search Terms chi tiết"
                            >
                              <span>{row.totalTerms}</span>
                              <CaretDown
                                size={11}
                                weight="bold"
                                className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                          </td>

                          {/* KỲ 1 (HIỆN TẠI): Spend | Sales | Orders | ACOS */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 border-l border-slate-100 tabular-nums">
                            ${(row.p1?.spend ?? row.spend ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                            ${(row.p1?.sales ?? row.sales ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800 tabular-nums">
                            {row.p1?.orders ?? row.orders ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <span
                              className={`px-1.5 py-0.5 rounded font-extrabold text-[10px] ${
                                (row.p1?.sales ?? row.sales ?? 0) === 0
                                  ? "bg-slate-100 text-slate-500"
                                  : (row.p1?.acos ?? row.acos ?? 0) <= targetAcos
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {(row.p1?.sales ?? row.sales ?? 0) > 0 ? `${row.p1?.acos ?? row.acos}%` : "—"}
                            </span>
                          </td>

                          {/* KỲ 2 (SO SÁNH): Spend | Sales | Orders | ACOS */}
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700 border-l border-slate-100 tabular-nums">
                            ${(row.p2?.spend ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-600 tabular-nums">
                            ${(row.p2?.sales ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-600 tabular-nums">
                            {row.p2?.orders ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            <span
                              className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                                (row.p2?.sales ?? 0) === 0
                                  ? "bg-slate-100 text-slate-400"
                                  : (row.p2?.acos ?? 0) <= targetAcos
                                  ? "bg-emerald-50/60 text-emerald-700"
                                  : "bg-rose-50/60 text-rose-700"
                              }`}
                            >
                              {(row.p2?.sales ?? 0) > 0 ? `${row.p2?.acos}%` : "—"}
                            </span>
                          </td>

                          {/* BIẾN ĐỘNG SPEND */}
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-xs whitespace-nowrap border-l border-slate-100 tabular-nums">
                            {(row.deltaSpend ?? 0) > 0 ? (
                              <span className="text-amber-600">▲ +${row.deltaSpend.toFixed(2)}</span>
                            ) : (row.deltaSpend ?? 0) < 0 ? (
                              <span className="text-emerald-600">▼ -${Math.abs(row.deltaSpend).toFixed(2)}</span>
                            ) : (
                              <span className="text-slate-400">= $0.00</span>
                            )}
                          </td>
                        </tr>
                      ) : (
                        /* HÀNG CAMPAIGN KHÔNG SO SÁNH: 10 cột truyền thống */
                        <tr
                          onClick={() => toggleExpandCampaign(row.campaignName)}
                          className={`hover:bg-slate-50/80 transition cursor-pointer ${isExpanded ? "bg-indigo-50/40" : ""}`}
                        >
                          <td className="p-3 text-center text-slate-400 font-mono text-[10px]">
                            {(page - 1) * pageSize + idx + 1}
                          </td>

                          {/* 1. Campaign Name */}
                          <td className="py-2.5 px-3 font-sans font-bold text-slate-900">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="break-words select-text">{row.campaignName}</span>
                              <PpcCopyButton value={row.campaignName} label="tên campaign" />
                            </div>
                          </td>

                          {/* 2. Search Terms */}
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandCampaign(row.campaignName);
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono font-bold text-xs transition cursor-pointer border ${
                                isExpanded
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                  : "bg-slate-100 hover:bg-indigo-50 text-slate-800 hover:text-indigo-700 border-slate-200 hover:border-indigo-200"
                              }`}
                              title="Bấm để bung danh sách Search Terms chi tiết"
                            >
                              <span>{row.totalTerms}</span>
                              <CaretDown
                                size={11}
                                weight="bold"
                                className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                          </td>

                          {/* 3. Spend */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="font-bold text-slate-900">${row.spend?.toFixed(2)}</div>
                          </td>

                          {/* 4. Sales */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="font-bold text-emerald-600">${row.sales?.toFixed(2)}</div>
                          </td>

                          {/* 5. Orders */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="font-bold text-slate-800">{row.orders}</div>
                          </td>

                          {/* 6. Clicks */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="text-slate-600">{row.clicks}</div>
                          </td>

                          {/* 7. CPC */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="text-slate-700 font-bold">${row.cpc?.toFixed(2)}</div>
                          </td>

                          {/* 8. ACOS */}
                          <td className="py-2.5 px-3 text-right">
                            <span
                              className={`px-1.5 py-0.5 rounded font-extrabold text-[10px] ${
                                row.sales === 0
                                  ? "bg-slate-100 text-slate-500"
                                  : row.acos <= targetAcos
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {row.sales > 0 ? `${row.acos}%` : "—"}
                            </span>
                          </td>

                          {/* 9. CVR */}
                          <td className="py-2.5 px-3 text-right">
                            <div className="text-slate-700 font-bold">{row.cvr}%</div>
                          </td>
                        </tr>
                      )}

                      {/* 4. DRILL-DOWN: BẢNG SEARCH TERMS BUNG RA BÊN DƯỚI */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={isCompare ? 12 : 10} className="p-0 bg-slate-50/70 border-y border-slate-200">
                            <div className="p-4 space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-indigo-600" />
                                  <h4 className="text-xs font-black text-slate-900 uppercase">
                                    Search Terms: <span className="text-indigo-700 font-bold font-mono normal-case">{row.campaignName}</span>
                                  </h4>
                                </div>
                                <div className="text-[11px] font-semibold text-slate-500">
                                  {isDetailLoading
                                    ? "Đang tải dữ liệu từ khóa..."
                                    : `Tìm thấy ${detail?.items?.length || 0} Customer Search Terms`}
                                </div>
                              </div>

                              {isDetailLoading ? (
                                <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                                  <CircleNotch size={18} className="animate-spin text-indigo-600" />
                                  <span>Đang bóc tách search terms...</span>
                                </div>
                              ) : !detail?.items || detail.items.length === 0 ? (
                                <div className="py-6 text-center text-xs text-slate-400 font-sans">
                                  Không có dữ liệu từ khóa chi tiết.
                                </div>
                              ) : !isCompare ? (
                                /* Không so sánh: Bảng Search Terms đơn */
                                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-100 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                      <tr>
                                        <th className="py-2 px-3">Customer Search Term</th>
                                        <th className="py-2 px-3">Target Keyword</th>
                                        <th className="py-2 px-3">Match Type</th>
                                        <th className="py-2 px-3 text-right">Spend</th>
                                        <th className="py-2 px-3 text-right">Sales</th>
                                        <th className="py-2 px-3 text-right">Orders</th>
                                        <th className="py-2 px-3 text-right">Clicks</th>
                                        <th className="py-2 px-3 text-right">CPC</th>
                                        <th className="py-2 px-3 text-right">ACOS</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                                      {detail.items.map((t: any, tidx: number) => (
                                        <tr key={tidx} className="hover:bg-slate-50">
                                          <td className="py-2 px-3 font-sans font-bold text-slate-800">{t.searchTerm}</td>
                                          <td className="py-2 px-3 text-slate-500 text-[10px]">{t.targetKeyword || "-"}</td>
                                          <td className="py-2 px-3 text-slate-500 text-[10px]">{t.matchType}</td>
                                          <td className="py-2 px-3 text-right font-bold text-slate-900">${t.spend?.toFixed(2)}</td>
                                          <td className="py-2 px-3 text-right text-emerald-600 font-bold">${t.sales?.toFixed(2)}</td>
                                          <td className="py-2 px-3 text-right font-bold">{t.orders}</td>
                                          <td className="py-2 px-3 text-right">{t.clicks}</td>
                                          <td className="py-2 px-3 text-right">${t.cpc?.toFixed(2)}</td>
                                          <td className="py-2 px-3 text-right">{t.sales > 0 ? `${t.acos}%` : "-"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                /* Có so sánh: Bảng Customer Search Terms so sánh 2 kỳ */
                                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                                  <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-slate-100 text-[10px] uppercase font-bold text-slate-600 border-b border-slate-200">
                                        <th rowSpan={2} className="py-2 px-3 align-bottom">Search Term</th>
                                        <th rowSpan={2} className="py-2 px-2 text-center align-bottom w-16">Match</th>
                                        <th colSpan={4} className="py-1.5 px-3 text-center border-l border-slate-200 bg-indigo-50/70 text-indigo-950 font-black tracking-normal normal-case text-xs">
                                          {formatDateRangeLabel(primaryPeriod.startDate, primaryPeriod.endDate)}
                                        </th>
                                        <th colSpan={4} className="py-1.5 px-3 text-center border-l border-slate-200 bg-slate-50 text-slate-700 font-black tracking-normal normal-case text-xs">
                                          {formatDateRangeLabel(effectiveComparePeriod?.startDate, effectiveComparePeriod?.endDate)}
                                        </th>
                                        <th rowSpan={2} className="py-2 px-3 text-right align-bottom border-l border-slate-200 w-28">Spend</th>
                                      </tr>
                                      <tr className="bg-slate-50/80 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                                        <th className="py-1.5 px-3 text-right border-l border-slate-200">Spend</th>
                                        <th className="py-1.5 px-3 text-right">Sales</th>
                                        <th className="py-1.5 px-3 text-right">Orders</th>
                                        <th className="py-1.5 px-3 text-right">ACOS</th>
                                        <th className="py-1.5 px-3 text-right border-l border-slate-200">Spend</th>
                                        <th className="py-1.5 px-3 text-right">Sales</th>
                                        <th className="py-1.5 px-3 text-right">Orders</th>
                                        <th className="py-1.5 px-3 text-right">ACOS</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                                      {detail.items.map((t: any, tidx: number) => (
                                        <tr key={tidx} className="hover:bg-slate-50/80 transition-colors">
                                          <td className="py-2 px-3 font-sans font-bold text-slate-800 max-w-xs truncate" title={t.searchTerm}>
                                            {t.searchTerm}
                                          </td>
                                          <td className="py-2 px-2 text-center text-slate-500 text-[10px] uppercase font-semibold">
                                            {t.matchType}
                                          </td>

                                          {/* Kỳ Hiện Tại */}
                                          <td className="py-2 px-3 text-right font-bold text-slate-900 border-l border-slate-100 tabular-nums">
                                            ${(t.p1?.spend ?? 0).toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-bold text-emerald-600 tabular-nums">
                                            ${(t.p1?.sales ?? 0).toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-bold text-emerald-700 tabular-nums">
                                            {t.p1?.orders ?? 0} orders
                                          </td>
                                          <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                                            {(t.p1?.sales ?? 0) > 0 ? `${t.p1?.acos}%` : "-"}
                                          </td>

                                          {/* Kỳ So Sánh */}
                                          <td className="py-2 px-3 text-right font-semibold text-slate-700 border-l border-slate-100 tabular-nums">
                                            ${(t.p2?.spend ?? 0).toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-medium text-slate-600 tabular-nums">
                                            ${(t.p2?.sales ?? 0).toFixed(2)}
                                          </td>
                                          <td className="py-2 px-3 text-right font-medium text-slate-600 tabular-nums">
                                            {t.p2?.orders ?? 0} orders
                                          </td>
                                          <td className="py-2 px-3 text-right text-slate-500 tabular-nums">
                                            {(t.p2?.sales ?? 0) > 0 ? `${t.p2?.acos}%` : "-"}
                                          </td>

                                          {/* Spend delta */}
                                          <td className="py-2 px-3 text-right font-bold text-xs whitespace-nowrap border-l border-slate-100 tabular-nums">
                                            {(t.deltaSpend ?? 0) > 0 ? (
                                              <span className="text-amber-600">▲ +${t.deltaSpend.toFixed(2)}</span>
                                            ) : (t.deltaSpend ?? 0) < 0 ? (
                                              <span className="text-emerald-600">▼ -${Math.abs(t.deltaSpend).toFixed(2)}</span>
                                            ) : (
                                              <span className="text-slate-400">= $0.00</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 5. PHÂN TRANG */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50/70 border-t border-slate-200 text-xs">
          <div className="text-slate-500 font-medium">
            Hiển thị <span className="font-bold text-slate-800">{items.length}</span> / <span className="font-bold text-slate-800">{totalCount}</span> chiến dịch
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">Dòng / trang:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 text-xs outline-none cursor-pointer"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>

            <div className="flex items-center gap-1 ml-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 disabled:opacity-40 transition cursor-pointer"
              >
                Trang trước
              </button>
              <span className="px-2 font-bold text-slate-800">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 disabled:opacity-40 transition cursor-pointer"
              >
                Trang sau
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
