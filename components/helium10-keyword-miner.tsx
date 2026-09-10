"use client";

import { useState } from "react";
import {
  MagnifyingGlass,
  Gear,
  Copy,
  Download,
  CheckCircle,
  WarningCircle,
  Lightning,
  Funnel,
  Sparkle,
  Trophy,
} from "@phosphor-icons/react";
import { Helium10SettingsModal } from "./helium10-settings-modal";
import { AmazonAutocompleteSeedMiner } from "./amazon-autocomplete-seed-miner";
import { AmazonCompetitorAsinSelector } from "./amazon-competitor-asin-selector";
import type { Helium10KeywordItem, Helium10MiningResult } from "@/lib/helium10-playwright";

interface Helium10KeywordMinerProps {
  onImportKeywords?: (keywords: string[]) => void;
}

export function Helium10KeywordMiner({ onImportKeywords }: Helium10KeywordMinerProps) {
  const [activeSection, setActiveSection] = useState<"autocomplete_seeds" | "competitor_asins" | "helium10_miner">("autocomplete_seeds");
  const [queryInput, setQueryInput] = useState("");
  const [searchType, setSearchType] = useState<"keyword" | "asin">("keyword");
  const [extractedSeeds, setExtractedSeeds] = useState<string[]>([]);
  const limit = 500;

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Helium10MiningResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [filterText, setFilterText] = useState("");
  const [minVolume, setMinVolume] = useState<number>(0);
  const [minIqScore, setMinIqScore] = useState<number>(0);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const handleSelectSeedForMining = (seed: string) => {
    setQueryInput(seed);
    setSearchType("keyword");
    setActiveSection("helium10_miner");
    setTimeout(() => {
      void runHelium10Search(seed, "keyword");
    }, 50);
  };

  const handleSelectAsinsForReverse = (asins: string[]) => {
    if (asins.length === 0) return;
    const targetQuery = asins[0]; // Helium 10 Cerebro primary target ASIN
    setQueryInput(targetQuery);
    setSearchType("asin");
    setActiveSection("helium10_miner");
    setTimeout(() => {
      void runHelium10Search(targetQuery, "asin");
    }, 50);
  };

  const runHelium10Search = async (overrideQuery?: string, overrideType?: "keyword" | "asin") => {
    const q = (overrideQuery ?? queryInput).trim();
    const type = overrideType ?? searchType;

    if (!q) {
      setErrorMsg("Vui lòng nhập ASIN hoặc Keyword để tra cứu trên Helium 10.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSelectedKeywords(new Set());

    try {
      const isAsin = type === "asin" || /^B[A-Z0-9]{9}$/i.test(q);

      const res = await fetch("/api/keywords/helium10", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: isAsin ? q : undefined,
          keyword: !isAsin ? q : undefined,
          marketplace: "US", // Explicitly locked to Amazon US only
          limit,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tải dữ liệu từ Helium 10.");
      }

      setResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi kết nối.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => runHelium10Search();

  const toggleSelectKeyword = (kw: string) => {
    const next = new Set(selectedKeywords);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    setSelectedKeywords(next);
  };

  const toggleSelectAll = (filteredList: Helium10KeywordItem[]) => {
    if (selectedKeywords.size === filteredList.length) {
      setSelectedKeywords(new Set());
    } else {
      setSelectedKeywords(new Set(filteredList.map((item) => item.keyword)));
    }
  };

  const filteredKeywords = (result?.keywords || []).filter((item) => {
    const matchesText = item.keyword.toLowerCase().includes(filterText.toLowerCase());
    const matchesVol = minVolume <= 0 || (item.search_volume || 0) >= minVolume;
    const matchesIq = minIqScore <= 0 || (item.iq_score || 0) >= minIqScore;
    return matchesText && matchesVol && matchesIq;
  });

  const handleCopyKeywords = () => {
    const listToCopy = selectedKeywords.size > 0 
      ? Array.from(selectedKeywords)
      : filteredKeywords.map(k => k.keyword);
    
    if (listToCopy.length === 0) return;
    navigator.clipboard.writeText(listToCopy.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCSV = () => {
    if (!result || filteredKeywords.length === 0) return;
    const header = "STT,Từ Khóa (Keyword),Search Volume,Helium 10 IQ Score,CPC ($),Organic Rank,Sponsored Rank,CPR (Giveaways),Title Density,Sản phẩm Đối thủ\n";
    const rows = filteredKeywords.map((k, idx) => {
      const kw = `"${k.keyword.replace(/"/g, '""')}"`;
      const vol = k.search_volume ?? "";
      const iq = k.iq_score ?? "";
      const cpc = k.cpc ? `$${k.cpc.toFixed(2)}` : "";
      const orgRank = k.organic_rank ? `#${k.organic_rank}` : "";
      const sponRank = k.sponsored_rank ? `#${k.sponsored_rank}` : "";
      const cpr = k.cpr ?? "";
      const density = k.title_density ?? "";
      const comp = k.competing_products ?? "";
      return `${idx + 1},${kw},${vol},${iq},${cpc},${orgRank},${sponRank},${cpr},${density},${comp}`;
    }).join("\n");

    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helium10-${queryInput.trim() || "keywords"}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportToListing = () => {
    const listToImport = selectedKeywords.size > 0 
      ? Array.from(selectedKeywords)
      : filteredKeywords.map(k => k.keyword);
    
    if (listToImport.length > 0 && onImportKeywords) {
      onImportKeywords(listToImport);
    }
  };

  return (
    <div className="w-full space-y-5 text-slate-800">
      {/* Navigation Sub-Tabs & Persistent Cookie Config Button */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 bg-slate-200/60 rounded-xl border border-slate-200/80 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSection("autocomplete_seeds")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
              activeSection === "autocomplete_seeds"
                ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Sparkle size={16} weight={activeSection === "autocomplete_seeds" ? "fill" : "bold"} className={activeSection === "autocomplete_seeds" ? "text-indigo-600" : "text-slate-400"} />
            <span>1. Trích Xuất Seeds (Amazon Autocomplete)</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              5 Chiều
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection("competitor_asins")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
              activeSection === "competitor_asins"
                ? "bg-white text-emerald-700 shadow-xs border border-emerald-100/50"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Trophy size={16} weight={activeSection === "competitor_asins" ? "fill" : "bold"} className={activeSection === "competitor_asins" ? "text-emerald-600" : "text-slate-400"} />
            <span>2. Helium 10 Xray (Soi BSR, Doanh Thu, ASINs)</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60">
              H10 Native
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection("helium10_miner")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer ${
              activeSection === "helium10_miner"
                ? "bg-white text-sky-700 shadow-xs border border-sky-100/50"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Lightning size={16} weight={activeSection === "helium10_miner" ? "fill" : "bold"} className={activeSection === "helium10_miner" ? "text-sky-600" : "text-slate-400"} />
            <span>3. Đào Chi Tiết Helium 10 (Cerebro &amp; Magnet)</span>
            {result && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200/60">
                {result.totalResults} kw
              </span>
            )}
          </button>
        </div>

        {/* Global Cookie Config Button */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-xs font-extrabold text-sky-800 shadow-2xs transition cursor-pointer ml-auto"
          title="Mở bảng cài đặt Cookie đăng nhập Helium 10"
        >
          <Gear size={16} className="text-sky-600" weight="bold" />
          <span>Cấu hình Cookie H10</span>
        </button>
      </div>

      {activeSection === "autocomplete_seeds" ? (
        <AmazonAutocompleteSeedMiner
          onSelectSeedForMining={(seed) => {
            setQueryInput(seed);
            setActiveSection("competitor_asins");
          }}
          onImportSeedsToListing={(seeds) => {
            setExtractedSeeds(seeds);
            if (onImportKeywords) onImportKeywords(seeds);
          }}
          onSelectAsinsForReverse={handleSelectAsinsForReverse}
        />
      ) : activeSection === "competitor_asins" ? (
        <AmazonCompetitorAsinSelector
          initialQuery={queryInput || "Retirement Coffee Mug"}
          seedSuggestions={extractedSeeds}
          onSelectAsinsForReverse={handleSelectAsinsForReverse}
        />
      ) : (
        <div className="space-y-5">
          {/* Search Header Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
                  <Lightning size={22} weight="fill" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Đào Keyword Helium 10 (Cerebro &amp; Magnet)
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-50 text-sky-700 border border-sky-200">
                      Amazon US 🇺🇸
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium">Trích xuất từ khóa chuyên sâu từ Helium 10 Cerebro (Reverse ASIN) và Magnet (Keyword Search)</p>
                </div>
              </div>

              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer"
              >
                <Gear size={15} /> Cấu hình Cookie H10
              </button>
            </div>

            {/* Input Control Row */}
            <div className="pt-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-xs font-bold text-slate-600">Công cụ tra cứu H10:</label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setSearchType("keyword")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                      searchType === "keyword" ? "bg-white text-sky-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Magnet (Keyword)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchType("asin")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                      searchType === "asin" ? "bg-white text-sky-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Cerebro (Reverse ASIN)
                  </button>
                </div>
              </div>

              <div className="sm:col-span-6 space-y-1">
                <label className="block text-xs font-bold text-slate-600">
                  {searchType === "asin" ? "Nhập ASIN đối thủ (ví dụ: B081W4DR6G):" : "Nhập Seed Keyword (ví dụ: acrylic ornament):"}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={searchType === "asin" ? "Ví dụ: B081W4DR6G, B0GTQQMFVM..." : "Ví dụ: acrylic ornament, retirement mug..."}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-600 focus:ring-1 focus:ring-sky-600 outline-none transition"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={loading}
                  className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Đang Đào...
                    </>
                  ) : (
                    <>
                      <MagnifyingGlass size={16} weight="bold" /> Đào H10 (US)
                    </>
                  )}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="mt-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-medium">
                <div className="flex items-center gap-2">
                  <WarningCircle size={18} weight="fill" className="shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition cursor-pointer shadow-xs"
                  >
                    ⚙️ Cập nhật Cookie H10
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Result Metrics & Table */}
          {result && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Status Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">Kết quả Helium 10 cho:</span>
                  <code className="px-2 py-0.5 rounded bg-sky-50 text-sky-700 font-mono font-bold border border-sky-100">{result.query}</code>
                  <span className="text-slate-300">•</span>
                  <span className="font-semibold">Tìm thấy <strong className="text-slate-900">{result.totalResults}</strong> từ khóa ({result.type === "asin" ? "Cerebro" : "Magnet"})</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                    <CheckCircle size={13} weight="fill" />
                    Live Helium 10 (Amazon US)
                  </span>
                </div>
              </div>

              {/* ASIN Product Info Card if available */}
              {result.asinMetadata && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-sky-50/80 via-white to-indigo-50/50 border border-sky-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-2xs">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-sky-600 text-white">
                        {result.asinMetadata.brand || "Sản phẩm đối thủ"}
                      </span>
                      <span className="text-xs font-bold text-slate-800 font-mono">ASIN: {result.query}</span>
                    </div>
                    {result.asinMetadata.title && (
                      <p className="text-xs font-bold text-slate-900 truncate" title={result.asinMetadata.title}>
                        {result.asinMetadata.title}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs font-semibold shrink-0">
                    {result.asinMetadata.sales !== undefined && (
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Doanh Số Tháng</div>
                        <div className="text-xs font-black text-sky-700">~{result.asinMetadata.sales.toLocaleString()} units</div>
                      </div>
                    )}
                    {result.asinMetadata.bsr && (
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase">BSR Category</div>
                        <div className="text-xs font-black text-indigo-700">#{result.asinMetadata.bsr.toLocaleString()}</div>
                      </div>
                    )}
                    {result.asinMetadata.price && (
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase">Giá Bán</div>
                        <div className="text-xs font-black text-emerald-700">${result.asinMetadata.price.toFixed(2)}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-56">
                    <Funnel size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      placeholder="Lọc từ khóa..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-sky-600 outline-none"
                    />
                  </div>

                  <select
                    value={minVolume}
                    onChange={(e) => setMinVolume(Number(e.target.value))}
                    className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value={0}>Tất cả Volume</option>
                    <option value={500}>Vol &gt; 500</option>
                    <option value={1000}>Vol &gt; 1,000</option>
                    <option value={5000}>Vol &gt; 5,000</option>
                  </select>

                  <select
                    value={minIqScore}
                    onChange={(e) => setMinIqScore(Number(e.target.value))}
                    className="py-1.5 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                  >
                    <option value={0}>Tất cả IQ Score</option>
                    <option value={500}>IQ &gt; 500</option>
                    <option value={1000}>IQ &gt; 1,000</option>
                    <option value={2000}>IQ &gt; 2,000</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleCopyKeywords}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy size={14} />
                    {copied ? "Đã Copy!" : selectedKeywords.size > 0 ? `Copy (${selectedKeywords.size})` : "Copy Tất Cả"}
                  </button>

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="px-3.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-extrabold text-emerald-800 transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Download size={15} className="text-emerald-600" /> Xuất File CSV
                  </button>

                  {onImportKeywords && (
                    <button
                      type="button"
                      onClick={handleImportToListing}
                      className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Sparkle size={14} weight="fill" />
                      Đưa vào Listing ({selectedKeywords.size || filteredKeywords.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Keywords Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-extrabold border-b border-slate-200">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedKeywords.size > 0 && selectedKeywords.size === filteredKeywords.length}
                          onChange={() => toggleSelectAll(filteredKeywords)}
                          className="rounded border-slate-300 accent-sky-600"
                        />
                      </th>
                      <th className="p-3 w-12 text-center font-extrabold text-slate-500">#</th>
                      <th className="p-3 font-extrabold text-slate-800">Từ Khóa (Keyword)</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Search Volume</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">H10 IQ Score</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">CPC ($)</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Organic Rank</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Sponsored Rank</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">CPR (8-Day)</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Title Density</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Đối Thủ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKeywords.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="p-8 text-center text-slate-400 font-medium">
                          Không tìm thấy từ khóa nào phù hợp bộ lọc.
                        </td>
                      </tr>
                    ) : (
                      filteredKeywords.map((item, idx) => {
                        const isSelected = selectedKeywords.has(item.keyword);
                        return (
                          <tr
                            key={idx}
                            onClick={() => toggleSelectKeyword(item.keyword)}
                            className={`cursor-pointer transition hover:bg-sky-50/40 ${
                              isSelected ? "bg-sky-50/70" : ""
                            }`}
                          >
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectKeyword(item.keyword)}
                                className="rounded border-slate-300 accent-sky-600"
                              />
                            </td>
                            <td className="p-3 text-center font-bold text-slate-400 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="p-3 font-bold text-slate-900 font-mono">
                              {item.keyword}
                            </td>
                            <td className="p-3 text-right font-extrabold text-sky-700">
                              {item.search_volume ? item.search_volume.toLocaleString() : "-"}
                            </td>
                            <td className="p-3 text-right font-semibold text-indigo-700">
                              {item.iq_score ? item.iq_score.toLocaleString() : "-"}
                            </td>
                            <td className="p-3 text-right font-semibold text-emerald-700 font-mono">
                              {item.cpc ? `$${item.cpc.toFixed(2)}` : "-"}
                            </td>
                            <td className="p-3 text-right font-medium text-slate-700">
                              {item.organic_rank ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                                  #{item.organic_rank}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="p-3 text-right font-medium text-slate-700">
                              {item.sponsored_rank ? (
                                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-bold border border-amber-200">
                                  #{item.sponsored_rank}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="p-3 text-right font-semibold text-slate-600">
                              {item.cpr ? item.cpr.toLocaleString() : "-"}
                            </td>
                            <td className="p-3 text-right font-medium text-slate-600">
                              {item.title_density !== null && item.title_density !== undefined ? `${item.title_density}/30` : "-"}
                            </td>
                            <td className="p-3 text-right font-medium text-slate-500">
                              {item.competing_products ? item.competing_products.toLocaleString() : "-"}
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
      )}

      {/* Modal Settings */}
      <Helium10SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setSettingsOpen(false);
          if (queryInput) handleSearch();
        }}
      />
    </div>
  );
}
