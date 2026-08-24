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
  ChartLineUp,
  ArrowsOut,
  ArrowClockwise,
  ListPlus,
  Calendar,
  ClipboardText,
} from "@phosphor-icons/react";
import {
  type AmazonCompetitorSearchResult,
  type AmazonCompetitorCandidate,
  parseHelium10XrayCSV,
} from "@/lib/amazon-asin-types";

interface AmazonCompetitorAsinSelectorProps {
  initialQuery?: string;
  seedSuggestions?: string[];
  onSelectAsinsForReverse?: (asins: string[]) => void;
}

export function AmazonCompetitorAsinSelector({
  initialQuery = "bullet tumbler",
  seedSuggestions = [],
  onSelectAsinsForReverse,
}: AmazonCompetitorAsinSelectorProps) {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AmazonCompetitorSearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [filterTab, setFilterTab] = useState<"all" | "recommended" | "top_organic" | "best_seller" | "direct_competitor" | "outlier_cross_niche" | "excluded">("all");
  const [sortBy, setSortBy] = useState<"revenue" | "sales" | "bsr" | "reviews" | "price">("revenue");
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set());
  const [copiedAsin, setCopiedAsin] = useState<string | null>(null);





  const handleCrawlCompetitors = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? queryInput).trim();
    if (!q) {
      setErrorMsg("Vui lòng nhập Seed Keyword để quét đối thủ bằng Helium 10 Xray.");
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
        throw new Error(data.error || "Không thể quét dữ liệu từ Helium 10 Xray.");
      }

      setResult(data);
      if (Array.isArray(data.recommendedAsins)) {
        setSelectedAsins(new Set(data.recommendedAsins));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi kết nối khi quét Helium 10 Xray.");
    } finally {
      setLoading(false);
    }
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
    const header = "Display Order,Product Details,ASIN,Brand,Price,ASIN Sales,ASIN Revenue,BSR,Ratings,Review Count,Seller Country\n";
    const rows = result.candidates.map((c, idx) => {
      const order = idx + 1;
      const title = `"${c.title.replace(/"/g, '""')}"`;
      const asin = `"${c.asin}"`;
      const brand = `"${c.brand.replace(/"/g, '""')}"`;
      const price = `"${c.price}"`;
      const sales = c.monthlySales ?? "";
      const rev = c.revenue ? `$${c.revenue.toFixed(2)}` : "";
      const bsr = c.bsr ?? "";
      const rating = c.rating ?? "";
      const revCount = c.reviewCount;
      const country = `"${c.sellerCountry || ""}"`;
      return `${order},${title},${asin},${brand},${price},${sales},${rev},${bsr},${rating},${revCount},${country}`;
    }).join("\n");

    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helium10-xray-${(result.query || "export").replace(/\s+/g, "_")}.csv`;
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
      if (sortBy === "revenue") return (b.revenue || 0) - (a.revenue || 0);
      if (sortBy === "sales") return (b.monthlySales || 0) - (a.monthlySales || 0);
      if (sortBy === "bsr") return (a.bsr || 9999999) - (b.bsr || 9999999);
      if (sortBy === "reviews") return b.reviewCount - a.reviewCount;
      if (sortBy === "price") return (b.priceNum || 0) - (a.priceNum || 0);
      return 0;
    });

  const getCountryFlag = (country?: string) => {
    if (!country) return null;
    const c = country.toUpperCase().trim();
    if (c === "VN") return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-rose-50 text-rose-700 border border-rose-200">🇻🇳 VN</span>;
    if (c === "US") return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-blue-50 text-blue-700 border border-blue-200">🇺🇸 US</span>;
    if (c === "CN") return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">🇨🇳 CN</span>;
    if (c === "AMZ") return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-orange-50 text-orange-700 border border-orange-200">📦 AMZ</span>;
    return <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-slate-100 text-slate-600">{c}</span>;
  };

  return (
    <div className="w-full space-y-4 text-slate-800 font-sans">
      {/* Header Bar: Helium 10 Xray Native */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-600 text-white font-black text-sm flex items-center gap-1 shadow-xs">
              <ChartLineUp size={20} weight="bold" />
              <span>Xray</span>
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                Helium 10 Xray Native Product Research
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Data Gốc H10 ⚡
                </span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Toàn bộ thông tin gốc do Helium 10 Xray trả về: Parent Sales, ASIN Sales, Parent Revenue, ASIN Revenue, BSR, Quốc gia Seller.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
              Quét Tự Động 100% ⚡
            </span>
          </div>
        </div>

        {/* Input Query Bar */}
        <div className="pt-3 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-9 space-y-1">
              <label className="block text-xs font-bold text-slate-700">
                Nhập Keyword để quét toàn bộ ASINs bằng Helium 10 Xray:
              </label>
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCrawlCompetitors()}
                placeholder="Ví dụ: bullet tumbler, retirement coffee mug, acrylic ornament..."
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition"
              />
            </div>

            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => handleCrawlCompetitors()}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-1.5"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Đang Quét H10 Xray...
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={16} weight="bold" /> Quét Helium 10 Xray
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Seeds */}
          {seedSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-400">Seeds từ Autocomplete:</span>
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
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-bold"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {seed}
                </button>
              ))}
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
              <WarningCircle size={16} className="shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Helium 10 Top Metric Cards (Matching Screenshot) */}
      {result && (
        <div className="space-y-3 animate-in fade-in duration-200">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Search Volume</span>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">521</div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Total Revenue (30D)</span>
              <div className="text-lg font-extrabold text-emerald-700 mt-0.5">
                ${(result.stats.totalRevenue || 0).toLocaleString()}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Average Revenue (30D)</span>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                ${(result.stats.avgRevenue || 0).toLocaleString()}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Average Price</span>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                ${Math.round(result.stats.avgPrice || 0)}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Average BSR</span>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                #{result.stats.avgBsr ? result.stats.avgBsr.toLocaleString() : "0"}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase">Average Reviews</span>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                {(result.stats.avgReviews || 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold text-slate-900">
                {result.totalFound} ASINs
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-xs font-bold text-emerald-700">
                Đã chọn {selectedAsins.size} ASINs
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Sort selector */}
              <div className="flex items-center gap-1 text-xs">
                <span className="font-bold text-slate-500">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="py-1 px-2 rounded-md border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 outline-none cursor-pointer"
                >
                  <option value="revenue">ASIN Revenue ($) Cao Nhất</option>
                  <option value="sales">ASIN Sales (Units) Cao Nhất</option>
                  <option value="bsr">BSR Rank Thấp Nhất</option>
                  <option value="reviews">Review Nhiều Nhất</option>
                  <option value="price">Giá Cao Nhất</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleCopySelectedAsins}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1"
              >
                <Copy size={14} />
                {copiedAsin === "all_asins" ? "Đã Copy!" : `Copy (${selectedAsins.size})`}
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1"
              >
                <Download size={14} /> Export CSV
              </button>

              {onSelectAsinsForReverse && (
                <button
                  type="button"
                  onClick={handleSendToReverse}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs"
                >
                  <Lightning size={14} weight="fill" />
                  Run Reverse ASIN ({selectedAsins.size})
                </button>
              )}
            </div>
          </div>

          {/* Helium 10 Xray Table Grid (100% Native Columns) */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedAsins.has(c.asin))}
                      onChange={() => toggleSelectAllFiltered(filteredCandidates)}
                      className="rounded border-slate-300 accent-blue-600"
                    />
                  </th>
                  <th className="p-3 w-12 text-center font-extrabold text-slate-500">#</th>
                  <th className="p-3 w-14 text-center">Ảnh</th>
                  <th className="p-3">Product Title &amp; ASIN</th>
                  <th className="p-3 w-28">Brand</th>
                  <th className="p-3 w-20 text-right">Price</th>
                  <th className="p-3 w-20 text-right font-medium text-slate-500">Fees ($)</th>
                  <th className="p-3 w-24 text-right">Parent Sales</th>
                  <th className="p-3 w-24 text-right font-extrabold text-blue-700">ASIN Sales</th>
                  <th className="p-3 w-28 text-right font-semibold text-emerald-800">Parent Rev</th>
                  <th className="p-3 w-28 text-right font-black text-emerald-700">ASIN Rev</th>
                  <th className="p-3 w-20 text-right">BSR</th>
                  <th className="p-3 w-16 text-right">Rating</th>
                  <th className="p-3 w-20 text-right font-extrabold text-slate-700">Reviews</th>
                  <th className="p-3 w-14 text-center">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredCandidates.map((item, idx) => {
                  const isSelected = selectedAsins.has(item.asin);
                  return (
                    <tr
                      key={item.asin}
                      onClick={() => toggleSelectAsin(item.asin)}
                      className={`cursor-pointer transition hover:bg-blue-50/30 ${
                        isSelected ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectAsin(item.asin)}
                          className="rounded border-slate-300 accent-blue-600"
                        />
                      </td>

                      <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                        {idx + 1}
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

                      <td className="p-3">
                        <p className="font-semibold text-slate-900 line-clamp-2 text-xs" title={item.title}>
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono font-bold text-[11px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                            {item.asin}
                          </span>
                          {item.creationDate && (
                            <span className="text-[10.5px] text-slate-400 flex items-center gap-0.5">
                              <Calendar size={11} /> {item.creationDate}
                            </span>
                          )}
                          {item.isSponsored && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1 rounded">SP</span>
                          )}
                        </div>
                      </td>

                      <td className="p-3">
                        <span className="font-bold text-blue-700 hover:underline block truncate" title={item.brand}>
                          {item.brand}
                        </span>
                        <div className="mt-0.5">{getCountryFlag(item.sellerCountry)}</div>
                      </td>

                      <td className="p-3 text-right font-bold text-slate-900 font-mono">
                        {item.price}
                      </td>

                      {/* Fees */}
                      <td className="p-3 text-right text-slate-500 font-mono text-[11px]">
                        {item.fees ? `$${item.fees.toFixed(2)}` : "-"}
                      </td>

                      {/* Parent Level Sales */}
                      <td className="p-3 text-right font-medium text-slate-500 font-mono">
                        {item.parentSales ? item.parentSales.toLocaleString() : (item.monthlySales ? item.monthlySales.toLocaleString() : "-")}
                      </td>

                      {/* ASIN Sales */}
                      <td className="p-3 text-right font-black text-blue-700 font-mono">
                        {item.monthlySales ? item.monthlySales.toLocaleString() : "-"}
                      </td>

                      {/* Parent Level Revenue (Total Main Parent Revenue) */}
                      <td className="p-3 text-right font-semibold text-emerald-800 font-mono text-xs">
                        {item.parentRevenue !== undefined && item.parentRevenue !== null
                          ? `$${Math.round(item.parentRevenue).toLocaleString()}`
                          : (item.revenue !== undefined && item.revenue !== null ? `$${Math.round(item.revenue).toLocaleString()}` : "-")}
                      </td>

                      {/* ASIN Revenue */}
                      <td className="p-3 text-right font-black text-emerald-700 font-mono text-xs">
                        {item.revenue !== undefined && item.revenue !== null
                          ? `$${Math.round(item.revenue).toLocaleString()}`
                          : "-"}
                      </td>

                      {/* BSR */}
                      <td className="p-3 text-right font-mono text-xs">
                        {item.bsr ? (
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded ${
                              item.bsr <= 5000
                                ? "bg-amber-50 text-amber-900 border border-amber-200"
                                : item.bsr <= 20000
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                : "text-slate-700"
                            }`}
                          >
                            #{item.bsr.toLocaleString()}
                          </span>
                        ) : item.bsrText ? (
                          <span className="text-slate-600 font-semibold">{item.bsrText}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>

                      {/* Rating */}
                      <td className="p-3 text-right font-mono font-bold text-amber-700 text-xs">
                        <div className="flex items-center justify-end gap-0.5">
                          <Star size={11} weight="fill" className="text-amber-500" />
                          <span>{item.rating ? item.rating.toFixed(1) : "-"}</span>
                        </div>
                      </td>

                      {/* Review Count */}
                      <td className="p-3 text-right font-mono font-bold text-slate-800 text-xs">
                        {item.reviewCount > 0 ? item.reviewCount.toLocaleString() : "0"}
                      </td>

                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={`https://www.amazon.com/dp/${item.asin}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Xem listing trên Amazon"
                          className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-blue-700 transition inline-flex items-center"
                        >
                          <ArrowSquareOut size={14} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
