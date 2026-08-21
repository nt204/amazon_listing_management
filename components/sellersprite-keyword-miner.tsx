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
import { SellerSpriteSettingsModal } from "./sellersprite-settings-modal";
import { AmazonAutocompleteSeedMiner } from "./amazon-autocomplete-seed-miner";
import { AmazonCompetitorAsinSelector } from "./amazon-competitor-asin-selector";
import type { SellerSpriteKeywordItem, SellerSpriteMiningResult } from "@/lib/sellersprite";

interface SellerSpriteKeywordMinerProps {
  onImportKeywords?: (keywords: string[]) => void;
}

export function SellerSpriteKeywordMiner({ onImportKeywords }: SellerSpriteKeywordMinerProps) {
  const [activeSection, setActiveSection] = useState<"autocomplete_seeds" | "competitor_asins" | "sellersprite_miner">("autocomplete_seeds");
  const [queryInput, setQueryInput] = useState("");
  const [searchType, setSearchType] = useState<"keyword" | "asin">("keyword");
  const [extractedSeeds, setExtractedSeeds] = useState<string[]>([]);
  const limit = 500;

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SellerSpriteMiningResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [filterText, setFilterText] = useState("");
  const [minVolume, setMinVolume] = useState<number>(0);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const handleSelectSeedForMining = (seed: string) => {
    setQueryInput(seed);
    setSearchType("keyword");
    setActiveSection("sellersprite_miner");
    setTimeout(() => {
      void runSellerSpriteSearch(seed, "keyword");
    }, 50);
  };

  const handleSelectAsinsForReverse = (asins: string[]) => {
    if (asins.length === 0) return;
    const targetQuery = asins[0]; // SellerSprite takes primary ASIN or query
    setQueryInput(targetQuery);
    setSearchType("asin");
    setActiveSection("sellersprite_miner");
    setTimeout(() => {
      void runSellerSpriteSearch(targetQuery, "asin");
    }, 50);
  };

  const runSellerSpriteSearch = async (overrideQuery?: string, overrideType?: "keyword" | "asin") => {
    const q = (overrideQuery ?? queryInput).trim();
    const type = overrideType ?? searchType;

    if (!q) {
      setErrorMsg("Vui lòng nhập ASIN hoặc Keyword để tra cứu.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSelectedKeywords(new Set());

    try {
      const isAsin = type === "asin" || /^B[A-Z0-9]{9}$/i.test(q);

      const res = await fetch("/api/keywords/sellersprite", {
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
        throw new Error(data.error || "Không thể tải dữ liệu từ SellerSprite.");
      }

      setResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi kết nối.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => runSellerSpriteSearch();

  const toggleSelectKeyword = (kw: string) => {
    const next = new Set(selectedKeywords);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    setSelectedKeywords(next);
  };

  const toggleSelectAll = (filteredList: SellerSpriteKeywordItem[]) => {
    if (selectedKeywords.size === filteredList.length) {
      setSelectedKeywords(new Set());
    } else {
      setSelectedKeywords(new Set(filteredList.map((item) => item.keyword)));
    }
  };

  const filteredKeywords = (result?.keywords || []).filter((item) => {
    const matchesText = item.keyword.toLowerCase().includes(filterText.toLowerCase());
    const matchesVol = minVolume <= 0 || (item.search_volume || 0) >= minVolume;
    return matchesText && matchesVol;
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
    const header = "STT,Từ Khóa (Keyword),Search Volume,ABA Rank,CPC ($),Tỷ lệ Mua (%),Sản phẩm Đối thủ\n";
    const rows = filteredKeywords.map((k, idx) => {
      const kw = `"${k.keyword.replace(/"/g, '""')}"`;
      const vol = k.search_volume ?? "";
      const aba = k.aba_rank ? `#${k.aba_rank}` : "";
      const cpc = k.cpc ? `$${k.cpc.toFixed(2)}` : "";
      const rate = k.purchase_rate ? `${(k.purchase_rate * 100).toFixed(1)}%` : "";
      const comp = k.competing_products ?? "";
      return `${idx + 1},${kw},${vol},${aba},${cpc},${rate},${comp}`;
    }).join("\n");

    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sellersprite-${queryInput.trim() || "keywords"}-${new Date().toISOString().slice(0, 10)}.csv`;
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
      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-200/60 rounded-xl border border-slate-200/80 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveSection("autocomplete_seeds")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition ${
            activeSection === "autocomplete_seeds"
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Sparkle size={16} weight={activeSection === "autocomplete_seeds" ? "fill" : "bold"} className={activeSection === "autocomplete_seeds" ? "text-indigo-600" : "text-slate-400"} />
          <span>1. Trích Xuất 10-13 Seeds (Amazon Autocomplete)</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
            5 Chiều
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("competitor_asins")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition ${
            activeSection === "competitor_asins"
              ? "bg-white text-emerald-700 shadow-xs border border-emerald-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Trophy size={16} weight={activeSection === "competitor_asins" ? "fill" : "bold"} className={activeSection === "competitor_asins" ? "text-emerald-600" : "text-slate-400"} />
          <span>2. Crawl &amp; Lọc 10-15 ASIN (Amazon Search)</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            Đa Dạng BSR
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("sellersprite_miner")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-extrabold transition ${
            activeSection === "sellersprite_miner"
              ? "bg-white text-blue-700 shadow-xs border border-blue-100/50"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Lightning size={16} weight={activeSection === "sellersprite_miner" ? "fill" : "bold"} className={activeSection === "sellersprite_miner" ? "text-blue-600" : "text-slate-400"} />
          <span>3. Đào Chi Tiết SellerSprite (Reverse ASIN / Keyword)</span>
          {result && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
              {result.totalResults} kw
            </span>
          )}
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
          {/* Search Header Card (Clean Light Theme) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                  <Lightning size={22} weight="fill" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Đào Keyword SellerSprite
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">
                      Amazon US 🇺🇸
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 font-medium">Trích xuất từ khóa chất lượng cao từ ASIN đối thủ hoặc Seed Keyword</p>
                </div>
              </div>

              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition"
              >
                <Gear size={15} /> Cấu hình Cookie
              </button>
            </div>

            {/* Input Control Row */}
            <div className="pt-4 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-3 space-y-1">
                <label className="block text-xs font-bold text-slate-600">Phương thức tra cứu:</label>
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setSearchType("keyword")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${
                      searchType === "keyword" ? "bg-white text-blue-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Seed Keyword
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchType("asin")}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition ${
                      searchType === "asin" ? "bg-white text-blue-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Reverse ASIN
                  </button>
                </div>
              </div>

              <div className="sm:col-span-6 space-y-1">
                <label className="block text-xs font-bold text-slate-600">
                  {searchType === "asin" ? "Nhập ASIN đối thủ (ví dụ: B081W4DR6G):" : "Nhập Seed Keyword (ví dụ: retirement coffee mug):"}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder={searchType === "asin" ? "Ví dụ: B081W4DR6G, B0DRF8NKXW..." : "Ví dụ: retirement coffee mug, christmas gift..."}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition"
                  />
                </div>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={loading}
                  className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Đang Đào...
                    </>
                  ) : (
                    <>
                      <MagnifyingGlass size={16} weight="bold" /> Đào Keyword (US)
                    </>
                  )}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
                <WarningCircle size={16} className="shrink-0 text-rose-600" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Result Metrics & Table */}
          {result && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Status Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">Kết quả cho:</span>
                  <code className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold border border-blue-100">{result.query}</code>
                  <span className="text-slate-300">•</span>
                  <span className="font-semibold">Tìm thấy <strong className="text-slate-900">{result.totalResults}</strong> keywords</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                    <CheckCircle size={13} weight="fill" /> Live SellerSprite (Amazon US)
                  </span>
                </div>
              </div>

              {/* Action & Filter Toolbar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Funnel size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      placeholder="Lọc từ khóa..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 outline-none"
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
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleCopyKeywords}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition flex items-center gap-1.5"
                  >
                    <Copy size={14} />
                    {copied ? "Đã Copy!" : selectedKeywords.size > 0 ? `Copy (${selectedKeywords.size})` : "Copy Tất Cả"}
                  </button>

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="px-3.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-extrabold text-emerald-800 transition flex items-center gap-1.5 shadow-2xs"
                  >
                    <Download size={15} className="text-emerald-600" /> Xuất File Excel
                  </button>

                  {onImportKeywords && (
                    <button
                      type="button"
                      onClick={handleImportToListing}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition flex items-center gap-1.5 shadow-xs"
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
                          className="rounded border-slate-300 accent-blue-600"
                        />
                      </th>
                      <th className="p-3 w-12 text-center font-extrabold text-slate-500">#</th>
                      <th className="p-3 font-extrabold text-slate-800">Từ Khóa (Keyword)</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Search Volume</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">ABA Rank</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">CPC ($)</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Tỷ lệ Mua</th>
                      <th className="p-3 font-extrabold text-slate-800 text-right">Sản phẩm Đối thủ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKeywords.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
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
                            className={`cursor-pointer transition hover:bg-blue-50/40 ${
                              isSelected ? "bg-blue-50/70" : ""
                            }`}
                          >
                            <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectKeyword(item.keyword)}
                                className="rounded border-slate-300 accent-blue-600"
                              />
                            </td>
                            <td className="p-3 text-center font-bold text-slate-400 font-mono text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="p-3 font-bold text-slate-900 font-mono">
                              {item.keyword}
                            </td>
                            <td className="p-3 text-right font-extrabold text-blue-700">
                              {item.search_volume ? item.search_volume.toLocaleString() : "-"}
                            </td>
                            <td className="p-3 text-right font-semibold text-slate-600">
                              {item.aba_rank ? `#${item.aba_rank.toLocaleString()}` : "-"}
                            </td>
                            <td className="p-3 text-right font-semibold text-emerald-700 font-mono">
                              {item.cpc ? `$${item.cpc.toFixed(2)}` : "-"}
                            </td>
                            <td className="p-3 text-right font-medium text-slate-600">
                              {item.purchase_rate ? `${(item.purchase_rate * 100).toFixed(1)}%` : "-"}
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
      <SellerSpriteSettingsModal
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
