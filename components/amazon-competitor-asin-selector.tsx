"use client";

import { useState } from "react";
import {
  MagnifyingGlass,
  Copy,
  Download,
  CheckCircle,
  WarningCircle,
  Star,
  Tag,
  Trophy,
  Target,
  Sparkle,
  ArrowSquareOut,
  Lightning,
  Funnel,
  ShieldCheck,
  Check,
  FileCsv,
  UploadSimple,
  CurrencyDollar,
  SortAscending,
  SortDescending,
  GlobeHemisphereWest,
  Calendar,
} from "@phosphor-icons/react";
import {
  type AmazonCompetitorSearchResult,
  type AmazonCompetitorCandidate,
  parseHelium10XrayCSV,
} from "@/lib/amazon-asin-crawler";

interface AmazonCompetitorAsinSelectorProps {
  initialQuery?: string;
  seedSuggestions?: string[];
  onSelectAsinsForReverse?: (asins: string[]) => void;
}

export function AmazonCompetitorAsinSelector({
  initialQuery = "Retirement Coffee Mug",
  seedSuggestions = [],
  onSelectAsinsForReverse,
}: AmazonCompetitorAsinSelectorProps) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AmazonCompetitorSearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filterTab, setFilterTab] = useState<"all" | "recommended" | "top_organic" | "best_seller" | "direct_competitor" | "outlier_cross_niche" | "excluded">("recommended");
  const [sortBy, setSortBy] = useState<"revenue" | "sales" | "bsr" | "reviews" | "rating">("revenue");
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set());
  const [copiedAsin, setCopiedAsin] = useState<string | null>(null);

  // Modal / Box for importing Helium 10 CSV
  const [importH10Open, setImportH10Open] = useState(false);
  const [rawH10Csv, setRawH10Csv] = useState("");

  const handleCrawlCompetitors = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? queryInput).trim();
    if (!q) {
      setErrorMsg("Vui lòng nhập Seed Keyword để crawl ASIN đối thủ.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSelectedAsins(new Set());

    try {
      const res = await fetch("/api/keywords/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          marketplace: "US",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể crawl dữ liệu ASIN từ Amazon.");
      }

      setResult(data);
      if (Array.isArray(data.recommendedAsins)) {
        setSelectedAsins(new Set(data.recommendedAsins));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi kết nối khi crawl Amazon.");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessH10CSV = (textToProcess?: string) => {
    const text = textToProcess ?? rawH10Csv;
    if (!text.trim()) {
      setErrorMsg("Vui lòng dán nội dung file CSV từ Helium 10 Xray.");
      return;
    }

    try {
      setErrorMsg(null);
      const parsed = parseHelium10XrayCSV(text, queryInput || "Helium 10 Xray");
      setResult(parsed);
      setSelectedAsins(new Set(parsed.recommendedAsins));
      setImportH10Open(false);
      setRawH10Csv("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi định dạng CSV Helium 10.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleProcessH10CSV(content);
      }
    };
    reader.readAsText(file);
  };

  const toggleSelectAsin = (asin: string) => {
    const next = new Set(selectedAsins);
    if (next.has(asin)) next.delete(asin);
    else next.add(asin);
    setSelectedAsins(next);
  };

  const toggleSelectAllFiltered = (list: AmazonCompetitorCandidate[]) => {
    const allSelected = list.every((item) => selectedAsins.has(item.asin));
    const next = new Set(selectedAsins);
    if (allSelected) {
      list.forEach((item) => next.delete(item.asin));
    } else {
      list.forEach((item) => next.add(item.asin));
    }
    setSelectedAsins(next);
  };

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAsin(key);
    setTimeout(() => setCopiedAsin(null), 2000);
  };

  const handleCopySelectedAsins = () => {
    const list = selectedAsins.size > 0 ? Array.from(selectedAsins) : (result?.recommendedAsins || []);
    if (list.length === 0) return;
    handleCopyText(list.join(", "), "all_asins");
  };

  const handleExportCSV = () => {
    if (!result) return;
    const header = "ASIN,Tiêu đề (Title),Brand,Giá Bán,Doanh Thu ($),Doanh Số (Units),BSR,Rating,Review Count,Quốc Gia,Ngày Tạo,Phân Nhóm,Khuyên Chọn,Lý Do Loại\n";
    const rows = result.candidates.map((c) => {
      const asin = `"${c.asin}"`;
      const title = `"${c.title.replace(/"/g, '""')}"`;
      const brand = `"${c.brand.replace(/"/g, '""')}"`;
      const price = `"${c.price}"`;
      const rev = c.revenue ? `$${c.revenue.toFixed(2)}` : "";
      const sales = c.monthlySales ?? "";
      const bsr = c.bsr ?? "";
      const rating = c.rating ?? "";
      const revCount = c.reviewCount;
      const country = `"${c.sellerCountry || ""}"`;
      const date = `"${c.creationDate || ""}"`;
      const grp = c.categoryGroup;
      const rec = c.isRecommended ? "CÓ" : "KHÔNG";
      const reason = `"${(c.exclusionReason || "").replace(/"/g, '""')}"`;
      return `${asin},${title},${brand},${price},${rev},${sales},${bsr},${rating},${revCount},${country},${date},${grp},${rec},${reason}`;
    }).join("\n");

    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amazon-competitors-${result.query.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendToReverse = () => {
    const list = selectedAsins.size > 0 ? Array.from(selectedAsins) : (result?.recommendedAsins || []);
    if (list.length > 0 && onSelectAsinsForReverse) {
      onSelectAsinsForReverse(list);
    }
  };

  // Filter & Sort candidates
  const filteredCandidates = (result?.candidates || [])
    .filter((item) => {
      if (filterTab === "all") return true;
      if (filterTab === "recommended") return item.isRecommended;
      return item.categoryGroup === filterTab;
    })
    .sort((a, b) => {
      if (sortBy === "revenue") {
        return (b.revenue || 0) - (a.revenue || 0);
      }
      if (sortBy === "sales") {
        return (b.monthlySales || 0) - (a.monthlySales || 0);
      }
      if (sortBy === "bsr") {
        return (a.bsr || 9999999) - (b.bsr || 9999999);
      }
      if (sortBy === "reviews") {
        return b.reviewCount - a.reviewCount;
      }
      if (sortBy === "rating") {
        return (b.rating || 0) - (a.rating || 0);
      }
      return 0;
    });

  const getGroupBadge = (group: AmazonCompetitorCandidate["categoryGroup"], isRec: boolean, reason?: string) => {
    switch (group) {
      case "best_seller":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
            <Trophy size={12} weight="fill" className="text-amber-600" /> Best Seller (Top Revenue)
          </span>
        );
      case "top_organic":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
            <Tag size={12} weight="fill" className="text-blue-600" /> Top Organic Trang 1
          </span>
        );
      case "direct_competitor":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-purple-50 text-purple-800 border border-purple-200 flex items-center gap-1">
            <Target size={12} weight="fill" className="text-purple-600" /> Cùng Tầm Giá &amp; Khách Hàng
          </span>
        );
      case "outlier_cross_niche":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-sky-50 text-sky-800 border border-sky-200 flex items-center gap-1">
            <Sparkle size={12} weight="fill" className="text-sky-600" /> Outlier (Cross-Niche)
          </span>
        );
      case "excluded":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1" title={reason}>
            <WarningCircle size={12} weight="fill" className="text-rose-600" /> Đã Lọc Bỏ
          </span>
        );
      default:
        return null;
    }
  };

  const getCountryFlag = (country?: string) => {
    if (!country) return null;
    const c = country.toUpperCase().trim();
    if (c === "VN") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">🇻🇳 VN</span>;
    if (c === "US") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">🇺🇸 US</span>;
    if (c === "CN") return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">🇨🇳 CN</span>;
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200">{c}</span>;
  };

  return (
    <div className="w-full space-y-5 text-slate-800">
      {/* Search Bar Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
              <Trophy size={22} weight="fill" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                Crawl &amp; Chọn 10-15 ASIN Đối Thủ (Hỗ trợ Helium 10 Xray &amp; Live Search)
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {result?.source === "helium10_xray_csv" ? "Helium 10 Enriched" : "Amazon US 🇺🇸"}
                </span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Tự động quét ASIN trang 1, phân tích Doanh thu ($), Doanh số (Units), BSR, Review và lọc chuẩn cơ cấu POD.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setImportH10Open(!importH10Open)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-xs font-bold text-amber-900 transition shadow-2xs"
          >
            <FileCsv size={16} className="text-amber-700" />
            <span>{importH10Open ? "Đóng Form Nhập H10" : "Dán / Upload File Helium 10 Xray CSV"}</span>
          </button>
        </div>

        {/* Import Helium 10 CSV Box */}
        {importH10Open && (
          <div className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
                <FileCsv size={16} /> Dán nội dung file CSV từ Helium 10 Xray (Chứa Doanh thu, BSR, Sales, Quốc gia VN/US/CN...):
              </span>
              <label className="cursor-pointer px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition inline-flex items-center gap-1">
                <UploadSimple size={13} />
                <span>Chọn file .csv</span>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            <textarea
              rows={4}
              value={rawH10Csv}
              onChange={(e) => setRawH10Csv(e.target.value)}
              placeholder="Dán toàn bộ nội dung file CSV xuất từ Helium 10 Xray vào đây (có header: Display Order, ASIN, ASIN Revenue, BSR...)..."
              className="w-full rounded-lg border border-amber-300 bg-white p-2.5 text-xs font-mono text-slate-800 placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-amber-500"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportH10Open(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => handleProcessH10CSV()}
                className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition shadow-xs"
              >
                Phân Tích File H10 &amp; Lọc 10-15 ASIN Chuẩn POD
              </button>
            </div>
          </div>
        )}

        {/* Input Form for Live Crawl */}
        <div className="pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-9 space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Nhập Seed Keyword để crawl ASIN đối thủ trên Amazon US:
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCrawlCompetitors()}
                  placeholder="Ví dụ: Retirement Coffee Mug, Funny Retirement Gifts, Acrylic Dog Ornament..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none transition"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => handleCrawlCompetitors()}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Đang Quét ASIN Trang 1...
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={16} weight="bold" /> Quét 20-30 ASIN
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Seed Chips from Step 1 */}
          {seedSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-400">Chọn nhanh từ 10-13 Seeds:</span>
              {seedSuggestions.slice(0, 8).map((seed) => (
                <button
                  key={seed}
                  type="button"
                  onClick={() => {
                    setQueryInput(seed);
                    void handleCrawlCompetitors(seed);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition ${
                    queryInput === seed
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700 font-bold"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {seed}
                </button>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
              <WarningCircle size={16} className="shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Results View */}
      {result && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Tổng ASIN Đối Thủ</span>
              <div className="text-xl font-extrabold text-slate-900 mt-0.5">{result.totalFound} ASINs</div>
              {result.stats.totalRevenue ? (
                <span className="text-[11px] font-bold text-emerald-600">
                  Tổng Rev: ${(result.stats.totalRevenue).toLocaleString()}
                </span>
              ) : null}
            </div>

            <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 shadow-2xs">
              <span className="text-[11px] font-bold text-emerald-700 uppercase">Khuyên Chọn (Đạt Chuẩn)</span>
              <div className="text-xl font-extrabold text-emerald-800 mt-0.5 flex items-center gap-1.5">
                <span>{result.totalRecommended} ASINs</span>
                <span className="text-xs font-bold text-emerald-600">(Đa dạng)</span>
              </div>
              {result.stats.avgRevenue ? (
                <span className="text-[11px] font-bold text-emerald-700">
                  Rev TB: ${(result.stats.avgRevenue).toLocaleString()}/tháng
                </span>
              ) : null}
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Rating Trung Bình</span>
              <div className="text-xl font-extrabold text-amber-600 mt-0.5 flex items-center gap-1">
                <Star size={18} weight="fill" /> {result.stats.avgRating} / 5.0
              </div>
              <span className="text-[11px] text-slate-500 font-semibold">
                {result.stats.avgReviews.toLocaleString()} reviews trung bình
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Top Brands Trong Ngách</span>
              <div className="text-xs font-extrabold text-slate-800 mt-1 truncate" title={result.stats.topBrands.join(", ")}>
                {result.stats.topBrands.slice(0, 3).join(", ") || "Diverse Sellers"}
              </div>
              <span className="text-[10.5px] text-slate-400 font-medium block mt-0.5">
                Nguồn: {result.source === "helium10_xray_csv" ? "Helium 10 Xray" : "Amazon Live Crawl"}
              </span>
            </div>
          </div>

          {/* Filter Tabs & Sort Toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterTab("recommended")}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 ${
                  filterTab === "recommended"
                    ? "bg-emerald-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <ShieldCheck size={14} weight="bold" /> Khuyên Chọn ({result.totalRecommended})
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Tất Cả ({result.totalFound})
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("best_seller")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === "best_seller"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Best Seller
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("top_organic")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === "top_organic"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Top Organic
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("direct_competitor")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === "direct_competitor"
                    ? "bg-purple-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Cùng Tầm Giá
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("excluded")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition ${
                  filterTab === "excluded"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Đã Lọc Bỏ
              </button>
            </div>

            {/* Sort & Actions */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              <div className="flex items-center gap-1 text-xs">
                <span className="font-bold text-slate-500">Sắp xếp:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="py-1 px-2 rounded-md border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="revenue">Doanh Thu ($) Cao Nhất</option>
                  <option value="sales">Doanh Số (Units) Cao Nhất</option>
                  <option value="bsr">BSR Rank Thấp Nhất</option>
                  <option value="reviews">Review Nhiều Nhất</option>
                  <option value="rating">Rating Cao Nhất</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleCopySelectedAsins}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5"
              >
                <Copy size={14} />
                {copiedAsin === "all_asins" ? "Đã Copy ASINs!" : `Copy ASIN (${selectedAsins.size || result.totalRecommended})`}
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5"
              >
                <Download size={14} /> CSV
              </button>

              {onSelectAsinsForReverse && (
                <button
                  type="button"
                  onClick={handleSendToReverse}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs"
                >
                  <Lightning size={14} weight="fill" />
                  Reverse SellerSprite ({selectedAsins.size || result.totalRecommended})
                </button>
              )}
            </div>
          </div>

          {/* Competitors List Table with Enriched H10 Columns */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedAsins.has(c.asin))}
                      onChange={() => toggleSelectAllFiltered(filteredCandidates)}
                      className="rounded border-slate-300 accent-emerald-600"
                    />
                  </th>
                  <th className="p-3 w-14 text-center">Ảnh</th>
                  <th className="p-3 w-28">ASIN &amp; Brand</th>
                  <th className="p-3">Tiêu Đề Sản Phẩm Đối Thủ</th>
                  <th className="p-3 w-24 text-right">Doanh Thu</th>
                  <th className="p-3 w-20 text-right">Doanh Số</th>
                  <th className="p-3 w-20 text-right">BSR</th>
                  <th className="p-3 w-20 text-right">Rating/Review</th>
                  <th className="p-3 w-36 text-center">Phân Nhóm</th>
                  <th className="p-3 w-14 text-center">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                      Không có sản phẩm nào trong nhóm này.
                    </td>
                  </tr>
                ) : (
                  filteredCandidates.map((item) => {
                    const isSelected = selectedAsins.has(item.asin);
                    return (
                      <tr
                        key={item.asin}
                        onClick={() => toggleSelectAsin(item.asin)}
                        className={`cursor-pointer transition hover:bg-emerald-50/30 ${
                          isSelected ? "bg-emerald-50/50" : ""
                        }`}
                      >
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectAsin(item.asin)}
                            className="rounded border-slate-300 accent-emerald-600"
                          />
                        </td>

                        <td className="p-3 text-center">
                          {item.img ? (
                            <img
                              src={item.img}
                              alt={item.title}
                              className="w-11 h-11 object-contain rounded-md border border-slate-200 bg-white p-0.5 mx-auto"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-md bg-slate-100 flex items-center justify-center text-slate-300 text-[10px] mx-auto">
                              No img
                            </div>
                          )}
                        </td>

                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-extrabold text-slate-900">{item.asin}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(item.asin, item.asin)}
                              title="Copy ASIN"
                              className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                            >
                              {copiedAsin === item.asin ? (
                                <Check size={12} className="text-emerald-600" />
                              ) : (
                                <Copy size={12} />
                              )}
                            </button>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {item.brand && (
                              <span className="text-[10.5px] text-slate-400 font-semibold truncate max-w-[100px]" title={item.brand}>
                                {item.brand}
                              </span>
                            )}
                            {getCountryFlag(item.sellerCountry)}
                          </div>
                        </td>

                        <td className="p-3">
                          <p className="font-medium text-slate-900 line-clamp-2 text-xs" title={item.title}>
                            {item.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10.5px] text-slate-400">
                            <span className="font-bold text-slate-700">{item.price}</span>
                            {item.creationDate && (
                              <span className="flex items-center gap-0.5">
                                <Calendar size={11} /> {item.creationDate}
                              </span>
                            )}
                          </div>
                          {item.exclusionReason && (
                            <p className="text-[11px] text-rose-600 font-semibold mt-1 flex items-center gap-1">
                              <WarningCircle size={13} /> {item.exclusionReason}
                            </p>
                          )}
                        </td>

                        {/* Revenue ($) */}
                        <td className="p-3 text-right">
                          {item.revenue !== undefined && item.revenue !== null ? (
                            <span className="font-extrabold text-emerald-700 font-mono">
                              ${Math.round(item.revenue).toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* Monthly Sales (Units) */}
                        <td className="p-3 text-right font-bold text-slate-800 font-mono">
                          {item.monthlySales ? item.monthlySales.toLocaleString() : "-"}
                        </td>

                        {/* BSR */}
                        <td className="p-3 text-right font-semibold text-slate-600 font-mono">
                          {item.bsr ? `#${item.bsr.toLocaleString()}` : "-"}
                        </td>

                        {/* Rating & Reviews */}
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1 font-bold text-amber-700">
                            <Star size={12} weight="fill" className="text-amber-500" />
                            <span>{item.rating ? item.rating.toFixed(1) : "-"}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {item.reviewCount > 0 ? `(${item.reviewCount.toLocaleString()})` : "-"}
                          </span>
                        </td>

                        <td className="p-3 text-center">
                          {getGroupBadge(item.categoryGroup, item.isRecommended, item.exclusionReason)}
                        </td>

                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={`https://www.amazon.com/dp/${item.asin}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Xem listing trên Amazon"
                            className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-emerald-700 transition inline-flex items-center"
                          >
                            <ArrowSquareOut size={14} />
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
