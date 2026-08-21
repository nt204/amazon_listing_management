"use client";

import { useState } from "react";
import {
  MagnifyingGlass,
  Sparkle,
  Copy,
  Download,
  CheckCircle,
  WarningCircle,
  Tag,
  Users,
  Confetti,
  Star,
  ShieldCheck,
  CaretDown,
  CaretUp,
  ArrowSquareOut,
  Lightning,
  ListPlus,
  Info,
  Trophy,
} from "@phosphor-icons/react";
import type { AutocompleteSeedResult } from "@/lib/amazon-autocomplete";
import { AmazonCompetitorAsinSelector } from "./amazon-competitor-asin-selector";

interface AmazonAutocompleteSeedMinerProps {
  onSelectSeedForMining?: (seed: string) => void;
  onImportSeedsToListing?: (seeds: string[]) => void;
  onSelectAsinsForReverse?: (asins: string[]) => void;
}

const SAMPLE_QUERIES = [
  "Retirement Coffee Mug Cup",
  "Acrylic Dog Christmas Ornament",
  "Skinny Tumbler 20oz with Straw",
  "Engraved Leather Journal",
];

export function AmazonAutocompleteSeedMiner({
  onSelectSeedForMining,
  onImportSeedsToListing,
  onSelectAsinsForReverse,
}: AmazonAutocompleteSeedMinerProps) {
  const [productQuery, setProductQuery] = useState("Retirement Coffee Mug Cup");
  const [loading, setLoading] = useState(false);
  const [stepStatus, setStepStatus] = useState<string | null>(null);
  const [result, setResult] = useState<AutocompleteSeedResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [showAsinSection, setShowAsinSection] = useState(true);
  const [activeSeedForAsins, setActiveSeedForAsins] = useState<string>("Retirement Coffee Mug");

  const handleExtractSeeds = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? productQuery).trim();
    if (!q) {
      setErrorMsg("Vui lòng nhập Tên sản phẩm hoặc Keyword chính.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSelectedSeeds(new Set());
    setStepStatus("1/3: Đang quét gợi ý từ Amazon US Autocomplete...");

    try {
      setTimeout(() => {
        setStepStatus("2/3: Đang lọc tạp âm & phân tích ý định tìm kiếm...");
      }, 900);

      const res = await fetch("/api/keywords/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          marketplace: "US",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể trích xuất gợi ý từ Amazon Autocomplete.");
      }

      setStepStatus("3/3: Đã phân loại 10-13 Seeds thành 5 chiều cốt lõi!");
      setResult(data);
      // Select all by default
      if (Array.isArray(data.allSeeds)) {
        setSelectedSeeds(new Set(data.allSeeds));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi kết nối.");
    } finally {
      setLoading(false);
    }
  };

  const toggleSeed = (seed: string) => {
    const next = new Set(selectedSeeds);
    if (next.has(seed)) next.delete(seed);
    else next.add(seed);
    setSelectedSeeds(next);
  };

  const toggleDimensionSelect = (items: string[]) => {
    const allSelected = items.every((i) => selectedSeeds.has(i));
    const next = new Set(selectedSeeds);
    if (allSelected) {
      items.forEach((i) => next.delete(i));
    } else {
      items.forEach((i) => next.add(i));
    }
    setSelectedSeeds(next);
  };

  const handleCopyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyAllSelected = () => {
    const list = selectedSeeds.size > 0 ? Array.from(selectedSeeds) : (result?.allSeeds || []);
    if (list.length === 0) return;
    handleCopyText(list.join("\n"), "all");
  };

  const handleExportCSV = () => {
    if (!result) return;
    const header = "Nhóm 5 Chiều,Tên Nhóm,Từ Khóa Seed (Amazon Search Query)\n";
    const dimRows: string[] = [];

    const dims = [
      result.dimensions.coreFunctions,
      result.dimensions.targetAudience,
      result.dimensions.usageContext,
      result.dimensions.keyAttributes,
      result.dimensions.painPoints,
    ];

    dims.forEach((d) => {
      d.items.forEach((item) => {
        dimRows.push(`"${d.id}","${d.title}","${item.replace(/"/g, '""')}"`);
      });
    });

    const blob = new Blob(["\uFEFF" + header + dimRows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amazon-autocomplete-seeds-${result.query.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportToListing = () => {
    const list = selectedSeeds.size > 0 ? Array.from(selectedSeeds) : (result?.allSeeds || []);
    if (list.length > 0 && onImportSeedsToListing) {
      onImportSeedsToListing(list);
    }
  };

  const dimensionConfigs = [
    {
      data: result?.dimensions.coreFunctions,
      icon: Tag,
      color: "blue",
      border: "border-blue-200",
      bg: "bg-blue-50/60",
      badgeBg: "bg-blue-100 text-blue-800",
      iconColor: "text-blue-600",
    },
    {
      data: result?.dimensions.targetAudience,
      icon: Users,
      color: "purple",
      border: "border-purple-200",
      bg: "bg-purple-50/60",
      badgeBg: "bg-purple-100 text-purple-800",
      iconColor: "text-purple-600",
    },
    {
      data: result?.dimensions.usageContext,
      icon: Confetti,
      color: "amber",
      border: "border-amber-200",
      bg: "bg-amber-50/60",
      badgeBg: "bg-amber-100 text-amber-800",
      iconColor: "text-amber-600",
    },
    {
      data: result?.dimensions.keyAttributes,
      icon: Star,
      color: "emerald",
      border: "border-emerald-200",
      bg: "bg-emerald-50/60",
      badgeBg: "bg-emerald-100 text-emerald-800",
      iconColor: "text-emerald-600",
    },
    {
      data: result?.dimensions.painPoints,
      icon: ShieldCheck,
      color: "rose",
      border: "border-rose-200",
      bg: "bg-rose-50/60",
      badgeBg: "bg-rose-100 text-rose-800",
      iconColor: "text-rose-600",
    },
  ];

  return (
    <div className="w-full space-y-5 text-slate-800">
      {/* Input & Search Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Sparkle size={22} weight="fill" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                Trích Xuất 10-13 Seed Keywords (Amazon Autocomplete)
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Live Amazon US 🇺🇸
                </span>
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Tự động gom & phân loại 5 chiều cốt lõi (Chức năng, Đối tượng, Ngữ cảnh, Thuộc tính, Pain point) để chọn đúng đối thủ reverse.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
          >
            <Info size={15} />
            {showGuide ? "Ẩn Tiêu Chuẩn Chọn ASIN" : "Xem Tiêu Chuẩn Chọn ASIN"}
            {showGuide ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </button>
        </div>

        {/* Input Form */}
        <div className="pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-9 space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Nhập Keyword chính / Tên sản phẩm (Seed Keyword):
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExtractSeeds()}
                  placeholder="Ví dụ: Retirement Coffee Mug Cup, Acrylic Dog Ornament, Skinny Tumbler 20oz..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <button
                type="button"
                onClick={() => handleExtractSeeds()}
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Đang Trích Xuất...
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={16} weight="bold" /> Trích Xuất 10-13 Seeds
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Sample quick queries */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold text-slate-400">Mẫu thử nhanh:</span>
            {SAMPLE_QUERIES.map((sq) => (
              <button
                key={sq}
                type="button"
                onClick={() => {
                  setProductQuery(sq);
                  void handleExtractSeeds(sq);
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition ${
                  productQuery === sq
                    ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-bold"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {sq}
              </button>
            ))}
          </div>

          {/* Loading status bar */}
          {loading && stepStatus && (
            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-2 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              <span>{stepStatus}</span>
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

      {/* Guide Box (Accordion) */}
      {showGuide && (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-slate-900 to-indigo-950 p-4 text-white shadow-xs">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-indigo-900/60">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-indigo-800 text-indigo-300">
                <Info size={15} weight="bold" />
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-200">
                Chiến Lược Chọn ASIN Đối Thủ Chuẩn Để Reverse (Từ 10-13 Seeds)
              </h3>
            </div>
            <span className="text-[11px] text-indigo-300 font-medium">
              Đảm bảo Coverage % phản ánh đúng toàn ngách
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 text-[11px] leading-relaxed">
            <div className="space-y-1.5 bg-white/5 p-3 rounded-lg border border-white/10">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>1. Nguồn tìm ASIN ứng viên (20-30 ASIN)</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>Search 10-13 seeds trên Amazon US (lấy cả organic &amp; sponsored trang 1).</li>
                <li>Mở rộng thêm từ &quot;Customers also bought&quot; / Related products.</li>
                <li>Lấy Best Seller / Amazon&apos;s Choice trong Category tree.</li>
              </ul>
            </div>

            <div className="space-y-1.5 bg-white/5 p-3 rounded-lg border border-white/10">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                <span>2. Tiêu chí lọc &amp; Loại bỏ</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li><strong className="text-white">Review count:</strong> ≥ 100-500 reviews (bán ổn định).</li>
                <li><strong className="text-white">BSR:</strong> Top 1-5% category (rank càng nhỏ bán càng tốt).</li>
                <li><strong className="text-white">Loại bỏ:</strong> Brand độc quyền (Yeti, Stanley), hàng lỗi, combo/bundle lệch cấu trúc.</li>
              </ul>
            </div>

            <div className="space-y-1.5 bg-white/5 p-3 rounded-lg border border-white/10">
              <div className="font-bold text-sky-300 flex items-center gap-1.5">
                <span>3. Cơ cấu 10-15 ASIN đa dạng</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li><strong className="text-white">5-7 ASIN:</strong> Top organic ranking cho seed chính.</li>
                <li><strong className="text-white">2-3 ASIN:</strong> Bán chạy nhất category (BSR thấp).</li>
                <li><strong className="text-white">2-3 ASIN:</strong> Cùng tầm giá &amp; target customer.</li>
                <li><strong className="text-white">1-2 ASIN:</strong> Outlier phát hiện cross-niche keywords.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Results View */}
      {result && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Summary & Batch Action Toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-900">Kết quả cho:</span>
              <code className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono font-bold border border-indigo-100">
                {result.query}
              </code>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600">
                Đã phân loại <strong className="text-slate-900 font-extrabold">{result.totalSeeds}</strong> Seed Keywords (từ {result.totalRawSuggestions} gợi ý Amazon)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleCopyAllSelected}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5"
              >
                <Copy size={14} />
                {copiedKey === "all" ? "Đã Copy Tất Cả!" : `Copy Seeds (${selectedSeeds.size || result.totalSeeds})`}
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-extrabold text-emerald-800 transition flex items-center gap-1.5"
              >
                <Download size={14} className="text-emerald-600" /> Xuất CSV
              </button>

              {onImportSeedsToListing && (
                <button
                  type="button"
                  onClick={handleImportToListing}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs"
                >
                  <ListPlus size={15} weight="bold" />
                  Đưa vào Listing Input ({selectedSeeds.size || result.totalSeeds})
                </button>
              )}
            </div>
          </div>

          {/* 5 Dimensions Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dimensionConfigs.map((cfg, idx) => {
              if (!cfg.data) return null;
              const IconComp = cfg.icon;
              const isAllDimSelected = cfg.data.items.every((i) => selectedSeeds.has(i));

              return (
                <div
                  key={cfg.data.id}
                  className={`rounded-xl border ${cfg.border} bg-white p-4 shadow-2xs flex flex-col justify-between transition hover:shadow-sm`}
                >
                  <div className="space-y-3">
                    {/* Dimension Header */}
                    <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${cfg.bg} ${cfg.iconColor}`}>
                          <IconComp size={16} weight="bold" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-extrabold text-slate-900">
                              {idx + 1}. {cfg.data.title}
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${cfg.badgeBg}`}>
                              {cfg.data.items.length} seeds ({cfg.data.targetCount})
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-400 font-medium leading-tight mt-0.5">
                            {cfg.data.description}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleDimensionSelect(cfg.data!.items)}
                        title={isAllDimSelected ? "Bỏ chọn nhóm này" : "Chọn tất cả nhóm này"}
                        className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 transition"
                      >
                        {isAllDimSelected ? "Bỏ chọn" : "Chọn hết"}
                      </button>
                    </div>

                    {/* Seeds List */}
                    <div className="space-y-2">
                      {cfg.data.items.map((item) => {
                        const isSelected = selectedSeeds.has(item);
                        return (
                          <div
                            key={item}
                            className={`group flex items-center justify-between gap-2 p-2 rounded-lg border transition ${
                              isSelected
                                ? "bg-indigo-50/40 border-indigo-200 text-slate-900"
                                : "bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100/70"
                            }`}
                          >
                            <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSeed(item)}
                                className="rounded border-slate-300 accent-indigo-600 shrink-0"
                              />
                              <span className="text-xs font-mono font-bold truncate select-all" title={item}>
                                {item}
                              </span>
                            </label>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* Copy single seed */}
                              <button
                                type="button"
                                onClick={() => handleCopyText(item, item)}
                                title="Copy từ khóa này"
                                className="p-1 rounded hover:bg-white text-slate-400 hover:text-slate-700 transition"
                              >
                                {copiedKey === item ? (
                                  <CheckCircle size={13} weight="fill" className="text-emerald-600" />
                                ) : (
                                  <Copy size={13} />
                                )}
                              </button>

                              {/* Open Amazon Search */}
                              <a
                                href={`https://www.amazon.com/s?k=${encodeURIComponent(item)}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Mở tìm kiếm trên Amazon US để xem ASIN trang 1"
                                className="p-1 rounded hover:bg-white text-slate-400 hover:text-amber-600 transition"
                              >
                                <ArrowSquareOut size={13} />
                              </a>

                              {/* Quick Crawl ASINs for this seed */}
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSeedForAsins(item);
                                  setShowAsinSection(true);
                                  // Scroll to ASIN section
                                  const el = document.getElementById("competitor-asin-section");
                                  if (el) el.scrollIntoView({ behavior: "smooth" });
                                }}
                                title="Quét danh sách Top ASIN đối thủ cho từ khóa này"
                                className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-0.5 text-[10px] font-bold px-1.5"
                              >
                                <Trophy size={11} weight="fill" />
                                <span>ASINs</span>
                              </button>

                              {/* Run SellerSprite keyword search / reverse */}
                              {onSelectSeedForMining && (
                                <button
                                  type="button"
                                  onClick={() => onSelectSeedForMining(item)}
                                  title="Đào từ khóa này với SellerSprite"
                                  className="p-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white transition flex items-center gap-0.5 text-[10px] font-bold px-1.5"
                                >
                                  <Lightning size={11} weight="fill" />
                                  <span>Đào</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Embedded Competitor ASINs Section */}
          <div id="competitor-asin-section" className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs flex items-center gap-1.5">
                  <Trophy size={16} weight="fill" />
                  <span>Bước Tiếp Theo: Top ASINs Đối Thủ Từ Seed Keywords</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAsinSection(!showAsinSection)}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1"
              >
                {showAsinSection ? "Thu gọn bảng ASIN" : "Mở bảng ASIN"}
                {showAsinSection ? <CaretUp size={12} /> : <CaretDown size={12} />}
              </button>
            </div>

            {showAsinSection && (
              <AmazonCompetitorAsinSelector
                initialQuery={activeSeedForAsins || productQuery}
                seedSuggestions={result.allSeeds}
                onSelectAsinsForReverse={onSelectAsinsForReverse}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
