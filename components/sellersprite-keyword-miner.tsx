"use client";

import { useEffect, useState, useMemo } from "react";
import {
  MagnifyingGlass,
  Lightning,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  ArrowLeft,
  Copy,
  Download,
  FileXls,
  Funnel,
  FunnelSimple,
  Trophy,
  ArrowsClockwise,
  Check,
  ListPlus,
  Gear,
  Star,
  Sparkle,
  ShieldCheck,
  Prohibit,
  Tag,
  FolderSimple,
} from "@phosphor-icons/react";
import type {
  AmazonCompetitorCandidate,
  AmazonCompetitorSearchResult,
} from "@/lib/amazon-asin-types";
import type { UnifiedReverseKeywordItem } from "@/app/api/keywords/reverse/route";
import { SellerSpriteSettingsModal } from "./sellersprite-settings-modal";

interface SellerSpriteKeywordMinerProps {
  onImportKeywords?: (keywords: string[]) => void;
}

type Stage = 1 | 2 | 3 | 4;

export interface SemanticClassifiedKeyword {
  id: number;
  keyword: string;
  search_volume: number | null;
  organic_rank: number | null;
  cpc: number | null;
  competing_products: number | null;
  asin_count: number;
  relevance: number;
  type: "PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE" | "WRONG_PRODUCT";
  negative: boolean;
}

export interface KeywordPart {
  partNumber: number;
  name: string;
  keywords: SemanticClassifiedKeyword[];
  totalVolume: number;
}
type ScoreWeights = { relevance: number; revenue: number; sales: number; bsr: number };

const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  relevance: 0.5,
  revenue: 0.3,
  sales: 0.1,
  bsr: 0.1,
};

function decodeHtml(value: string): string {
  if (!value) return "";
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&quot;": '"',
    "&#34;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&nbsp;": " ",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&ndash;": "–",
    "&mdash;": "—",
  };
  return value
    .replace(/&(amp|quot|#34|#39|apos|lt|gt|nbsp|copy|reg|trade|ndash|mdash);/gi, (entity) => entities[entity.toLowerCase()] || entity)
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 16));
      } catch {
        return _;
      }
    });
}

export function SellerSpriteKeywordMiner({ onImportKeywords }: SellerSpriteKeywordMinerProps) {
  // Input
  const [productTitle, setProductTitle] = useState("");
  const [currentStage, setCurrentStage] = useState<Stage>(1);

  // General Loading & State
  const [loading, setLoading] = useState(false);
  const [stage1LoadingStep, setStage1LoadingStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Stage 1 Data: 10 ASINs
  const [stage1Result, setStage1Result] = useState<AmazonCompetitorSearchResult | null>(null);
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set());
  const [stage1Tab, setStage1Tab] = useState<"selected" | "all" | "rejected">("selected");
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [showWeightSettings, setShowWeightSettings] = useState(false);
  const [scoreWeights, setScoreWeights] = useState<ScoreWeights>(DEFAULT_SCORE_WEIGHTS);
  const [savingWeights, setSavingWeights] = useState(false);

  useEffect(() => {
    void fetch("/api/settings/competitor-scoring")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data?.weights && setScoreWeights(data.weights))
      .catch(() => undefined);
  }, []);

  // Candidates to display: either Top 10 selected or all scored candidates
  const displayedCandidates = useMemo(() => {
    if (!stage1Result) return [];
    if (stage1Tab === "all" && stage1Result.allCandidates && stage1Result.allCandidates.length > 0) {
      return stage1Result.allCandidates;
    }
    return stage1Result.candidates;
  }, [stage1Result, stage1Tab]);

  // Stage 2 Data: Reverse ASINs & Volume Filter (SV < 20 excluded by default)
  const [selectedTool, setSelectedTool] = useState<"sellersprite" | "helium10" | "auto">("sellersprite");
  const [stage2Keywords, setStage2Keywords] = useState<UnifiedReverseKeywordItem[]>([]);
  const [stage2Warning, setStage2Warning] = useState<string | null>(null);
  const [stage2VolumeThreshold, setStage2VolumeThreshold] = useState<number>(20);
  const [stage2VolumeOperator, setStage2VolumeOperator] = useState<"<" | "<=" | ">=" | ">" | "all">(">");

  // Filtered keywords for Stage 2 based on configurable search volume (Default: SV >= 20, eliminates < 20)
  const displayedStage2Keywords = useMemo(() => {
    return stage2Keywords.filter((item) => {
      const vol = typeof item.search_volume === "number" ? item.search_volume : 0;
      if (stage2VolumeOperator === "<") return vol < stage2VolumeThreshold;
      if (stage2VolumeOperator === "<=") return vol <= stage2VolumeThreshold;
      if (stage2VolumeOperator === ">=") return vol >= stage2VolumeThreshold;
      if (stage2VolumeOperator === ">") return vol > stage2VolumeThreshold;
      return true; // "all"
    });
  }, [stage2Keywords, stage2VolumeOperator, stage2VolumeThreshold]);

  // Stage 3 Data: AI Semantic Batch Classification (1 AI Stage)
  const [classifiedKeywords, setClassifiedKeywords] = useState<SemanticClassifiedKeyword[]>([]);
  const [classifying, setClassifying] = useState(false);
  const [stage3Tab, setStage3Tab] = useState<"all" | "PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE" | "NEGATIVE">("all");
  const [stage3MinRelevance, setStage3MinRelevance] = useState<number>(60);
  const [stage3SearchText, setStage3SearchText] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());

  // Stage 4 Data: Active Part view
  const [stage4ActivePart, setStage4ActivePart] = useState<number | "negative">("negative");

  // Competitor brands collected from Stage 1 ASINs
  const competitorBrands = useMemo(() => {
    if (!stage1Result) return [];
    const brands = new Set<string>();
    stage1Result.candidates.forEach((c) => {
      if (c.brand && c.brand.trim().length > 1) {
        brands.add(c.brand.trim().toLowerCase());
      }
    });
    return Array.from(brands);
  }, [stage1Result]);

  // Stage 3 Filtered Displayed Keywords
  const displayedStage3Keywords = useMemo(() => {
    return classifiedKeywords.filter((item) => {
      // Tab filter
      if (stage3Tab === "NEGATIVE") {
        if (!item.negative && item.type !== "WRONG_PRODUCT") return false;
      } else if (stage3Tab !== "all") {
        if (item.type !== stage3Tab || item.negative) return false;
      }

      // Relevance score threshold (except negative tab)
      if (stage3Tab !== "NEGATIVE" && item.relevance < stage3MinRelevance) {
        return false;
      }

      // Text search
      if (stage3SearchText.trim()) {
        const text = stage3SearchText.toLowerCase().trim();
        if (!item.keyword.toLowerCase().includes(text)) return false;
      }

      return true;
    });
  }, [classifiedKeywords, stage3Tab, stage3MinRelevance, stage3SearchText]);

  // Stage 4: Negative Candidates list
  const negativeCandidates = useMemo(() => {
    return classifiedKeywords.filter((k) => k.negative || k.type === "WRONG_PRODUCT");
  }, [classifiedKeywords]);

  // Stage 4: Grouping into Parts (100% CODE)
  // SOP Rule: Max 10 parts/SKU · ≤ 30 KW/part · Total ≤ 200 KW · SV/part ≤ 30,000
  // Categories per SOP: Product / Gift / Event / Audience
  const keywordParts = useMemo(() => {
    const validKw = classifiedKeywords.filter((k) => {
      if (k.negative || k.type === "WRONG_PRODUCT") return false;
      if (selectedKeywords.size > 0 && !selectedKeywords.has(k.keyword)) return false;
      return k.relevance >= stage3MinRelevance;
    });

    const categoryOrder: Array<{ type: "PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE"; label: string }> = [
      { type: "PRODUCT", label: "Product" },
      { type: "GIFT", label: "Gift" },
      { type: "EVENT", label: "Event" },
      { type: "AUDIENCE", label: "Audience" },
    ];

    const parts: KeywordPart[] = [];
    let totalKwCount = 0;
    let partNum = 1;

    for (const cat of categoryOrder) {
      if (parts.length >= 10 || totalKwCount >= 200) break;

      const catKeywords = validKw
        .filter((k) => (k.type || "").toUpperCase() === cat.type)
        .sort((a, b) => {
          if (b.relevance !== a.relevance) return b.relevance - a.relevance;
          return (b.search_volume || 0) - (a.search_volume || 0);
        });

      if (catKeywords.length === 0) continue;

      let currentKw: SemanticClassifiedKeyword[] = [];
      let currentVol = 0;
      const catParts: SemanticClassifiedKeyword[][] = [];

      for (const kw of catKeywords) {
        if (totalKwCount >= 200) break;
        const vol = kw.search_volume || 0;

        if ((currentKw.length >= 30 || currentVol + vol > 30000) && currentKw.length > 0) {
          catParts.push(currentKw);
          currentKw = [];
          currentVol = 0;
        }

        currentKw.push(kw);
        currentVol += vol;
        totalKwCount++;
      }
      if (currentKw.length > 0) {
        catParts.push(currentKw);
      }

      for (let i = 0; i < catParts.length; i++) {
        if (parts.length >= 10) break;
        const kwList = catParts[i];
        const vSum = kwList.reduce((acc, k) => acc + (k.search_volume || 0), 0);
        let partLabel = cat.label;
        if (catParts.length > 1) {
          partLabel = i === 0 ? `${cat.label} (Core)` : `${cat.label} (${i + 1})`;
        }
        parts.push({
          partNumber: partNum,
          name: `Part ${partNum} - ${partLabel}`,
          keywords: kwList,
          totalVolume: vSum,
        });
        partNum++;
      }
    }

    // Leftover / uncategorized keywords
    const knownTypes = new Set(["PRODUCT", "GIFT", "EVENT", "AUDIENCE"]);
    const otherKw = validKw
      .filter((k) => !knownTypes.has((k.type || "").toUpperCase()))
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return (b.search_volume || 0) - (a.search_volume || 0);
      });

    if (otherKw.length > 0 && parts.length < 10 && totalKwCount < 200) {
      let currentKw: SemanticClassifiedKeyword[] = [];
      let currentVol = 0;
      for (const kw of otherKw) {
        if (totalKwCount >= 200 || parts.length >= 10) break;
        const vol = kw.search_volume || 0;
        if ((currentKw.length >= 30 || currentVol + vol > 30000) && currentKw.length > 0) {
          parts.push({
            partNumber: partNum,
            name: `Part ${partNum} - Mở Rộng`,
            keywords: currentKw,
            totalVolume: currentVol,
          });
          partNum++;
          currentKw = [];
          currentVol = 0;
          if (parts.length >= 10) break;
        }
        currentKw.push(kw);
        currentVol += vol;
        totalKwCount++;
      }
      if (currentKw.length > 0 && parts.length < 10) {
        parts.push({
          partNumber: partNum,
          name: `Part ${partNum} - Mở Rộng`,
          keywords: currentKw,
          totalVolume: currentVol,
        });
      }
    }

    return parts;
  }, [classifiedKeywords, selectedKeywords, stage3MinRelevance]);

  // Handlers for Stage 1: Scan 10 ASINs
  const runStage1 = async (titleOverride?: string): Promise<AmazonCompetitorSearchResult | null> => {
    const q = (titleOverride ?? productTitle).trim();
    if (!q) {
      setErrorMsg("Vui lòng nhập Tên sản phẩm hoặc Seed Keyword.");
      return null;
    }

    setLoading(true);
    setStage1LoadingStep(1);
    setErrorMsg(null);

    const t1 = setTimeout(() => setStage1LoadingStep(2), 2200);
    const t2 = setTimeout(() => setStage1LoadingStep(3), 5000);
    const t3 = setTimeout(() => setStage1LoadingStep(4), 8500);

    try {
      const res = await fetch("/api/keywords/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          marketplace: "US",
          provider: "sellersprite",
          weights: scoreWeights,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể quét ASIN đối thủ.");
      }

      setStage1Result(data);

      // Auto-pick rule: ASINs > 70 limit 10, or top 4 highest scoring if none > 70
      const candidates = data.candidates || [];
      const above70 = candidates.filter((c: AmazonCompetitorCandidate) => (c.finalScore ?? 0) > 70);
      const autoPicked = above70.length > 0 ? above70.slice(0, 10) : candidates.slice(0, 4);
      const asinsToSelect = (Array.isArray(data.recommendedAsins) && data.recommendedAsins.length > 0)
        ? data.recommendedAsins
        : autoPicked.map((c: AmazonCompetitorCandidate) => c.asin);

      setSelectedAsins(new Set(asinsToSelect));
      return data;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi quét ASINs.");
      return null;
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      setLoading(false);
      setStage1LoadingStep(0);
    }
  };

  // Handlers for Stage 2: Reverse 10 ASINs
  const runStage2 = async (asinsOverride?: string[]): Promise<UnifiedReverseKeywordItem[]> => {
    const asinsToReverse = asinsOverride ?? Array.from(selectedAsins);
    if (asinsToReverse.length === 0) {
      setErrorMsg("Chưa có ASIN nào được chọn để Reverse.");
      return [];
    }

    setLoading(true);
    setErrorMsg(null);
    setStage2Warning(null);

    try {
      const res = await fetch("/api/keywords/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asins: asinsToReverse,
          productTitle: productTitle.trim(),
          tool: selectedTool,
          marketplace: "US",
          limit: 300,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể Reverse ASINs.");
      }

      const list: UnifiedReverseKeywordItem[] = data.keywords || [];
      setStage2Keywords(list);
      setStage2Warning(data.warning || null);

      return list;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi Reverse ASINs.");
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Handlers for Stage 3: 🤖 AI Batch — 1 Single Semantic Classification Task
  const runStage3AiClassification = async (kwList?: UnifiedReverseKeywordItem[]) => {
    const list = kwList || displayedStage2Keywords;
    if (list.length === 0) {
      setErrorMsg("Chưa có từ khóa nào từ Bước 2 để phân loại AI.");
      return;
    }

    setClassifying(true);
    setErrorMsg(null);

    try {
      // Map to batch payload with unique id
      const payloadKeywords = list.slice(0, 300).map((k, idx) => ({
        id: idx + 1,
        keyword: k.keyword,
        search_volume: k.search_volume,
      }));

      const res = await fetch("/api/keywords/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productTitle: productTitle.trim(),
          keywords: payloadKeywords,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi khi phân loại từ khóa AI.");

      const classifications: Array<{
        id: number;
        keyword: string;
        relevance: number;
        type: "PRODUCT" | "GIFT" | "EVENT" | "AUDIENCE" | "WRONG_PRODUCT";
        negative: boolean;
      }> = data.classifications || [];

      const map = new Map(classifications.map((c) => [c.id, c]));

      const merged: SemanticClassifiedKeyword[] = payloadKeywords.map((item, idx) => {
        const orig = list[idx];
        const ai = map.get(item.id);
        return {
          id: item.id,
          keyword: item.keyword,
          search_volume: orig?.search_volume ?? null,
          organic_rank: orig?.organic_rank ?? null,
          cpc: orig?.cpc ?? null,
          competing_products: orig?.competing_products ?? null,
          asin_count: orig?.asin_count ?? 1,
          relevance: ai?.relevance ?? 75,
          type: ai?.type ?? "PRODUCT",
          negative: ai?.negative ?? false,
        };
      });

      setClassifiedKeywords(merged);
      // Pre-select all non-negative keywords
      const validKw = merged.filter((k) => !k.negative && k.type !== "WRONG_PRODUCT");
      setSelectedKeywords(new Set(validKw.map((k) => k.keyword)));
      return merged;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi gọi AI phân loại.");
      return [];
    } finally {
      setClassifying(false);
    }
  };

  // Auto Flow: Chạy tự động từ đầu đến cuối (A-Z)
  const [autoFlowActive, setAutoFlowActive] = useState(false);
  const [autoFlowStep, setAutoFlowStep] = useState<string | null>(null);

  const runAutoFlow = async () => {
    const q = productTitle.trim();
    if (!q) {
      setErrorMsg("Vui lòng nhập Tên sản phẩm hoặc Seed Keyword để chạy Auto Flow.");
      return;
    }

    setAutoFlowActive(true);
    setLoading(true);
    setErrorMsg(null);
    setCurrentStage(1);

    try {
      // 1. Quét đối thủ tiềm năng
      setAutoFlowStep("1/4: Đang quét đối thủ & chọn ASIN tiềm năng...");
      const stage1Data = await runStage1(q);
      if (!stage1Data) return;

      const candidates = stage1Data.candidates || [];
      const above70 = candidates.filter((c: AmazonCompetitorCandidate) => (c.finalScore ?? 0) > 70);
      const autoPicked = above70.length > 0 ? above70.slice(0, 10) : candidates.slice(0, 4);
      const asinsToSelect = (Array.isArray(stage1Data.recommendedAsins) && stage1Data.recommendedAsins.length > 0)
        ? stage1Data.recommendedAsins
        : autoPicked.map((c: AmazonCompetitorCandidate) => c.asin);

      if (asinsToSelect.length === 0) {
        throw new Error("Không tìm thấy ASIN đối thủ phù hợp.");
      }

      // 2. Reverse ASINs & lọc Search Volume > 20
      setAutoFlowStep(`2/4: Đang Reverse từ khóa (${asinsToSelect.length} ASINs)...`);
      const rawKeywords = await runStage2(asinsToSelect);
      if (rawKeywords.length === 0) {
        throw new Error("Không trích xuất được từ khóa nào từ các ASIN đã chọn.");
      }

      const filtered = rawKeywords.filter((k) => {
        const vol = typeof k.search_volume === "number" ? k.search_volume : 0;
        if (stage2VolumeOperator === "<") return vol < stage2VolumeThreshold;
        if (stage2VolumeOperator === "<=") return vol <= stage2VolumeThreshold;
        if (stage2VolumeOperator === ">=") return vol >= stage2VolumeThreshold;
        if (stage2VolumeOperator === ">") return vol > stage2VolumeThreshold;
        return true;
      });

      if (filtered.length === 0) {
        setCurrentStage(2);
        throw new Error(`Không có từ khóa nào có Search Volume ${stage2VolumeOperator} ${stage2VolumeThreshold}.`);
      }

      // 3. AI Batch Phân loại ngữ nghĩa & phát hiện Negative
      setAutoFlowStep(`3/4: Đang AI phân loại ngữ nghĩa cho ${filtered.length} từ khóa...`);
      const classified = await runStage3AiClassification(filtered);
      if (!classified || classified.length === 0) {
        throw new Error("Không nhận được kết quả từ AI phân loại.");
      }

      // 4. Hoàn tất toàn bộ quy trình, chuyển sang Bước 4
      setAutoFlowStep("4/4: Hoàn tất! Đã chia nhóm Parts và tách Negative.");
      setCurrentStage(4);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Auto Flow gặp lỗi.");
    } finally {
      setAutoFlowActive(false);
      setAutoFlowStep(null);
      setLoading(false);
    }
  };

  // Auto-select ASINs according to rule: Final Score > 70 (max 10), or top 4 if none > 70
  const autoSelectRule = () => {
    if (!stage1Result) return;
    const candidates = stage1Result.candidates || [];
    const above70 = candidates.filter((c: AmazonCompetitorCandidate) => (c.finalScore ?? 0) > 70);
    const autoPicked = above70.length > 0 ? above70.slice(0, 10) : candidates.slice(0, 4);
    const asinsToSelect = (Array.isArray(stage1Result.recommendedAsins) && stage1Result.recommendedAsins.length > 0)
      ? stage1Result.recommendedAsins
      : autoPicked.map((c: AmazonCompetitorCandidate) => c.asin);
    setSelectedAsins(new Set(asinsToSelect));
  };

  // Toggle ASIN selection in Stage 1
  const toggleAsin = (asin: string) => {
    const next = new Set(selectedAsins);
    if (next.has(asin)) next.delete(asin);
    else next.add(asin);
    setSelectedAsins(next);
  };

  const saveScoreWeights = async (weights: ScoreWeights): Promise<boolean> => {
    setSavingWeights(true);
    setErrorMsg(null);
    try {
      const response = await fetch("/api/settings/competitor-scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weights }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể lưu trọng số.");
      setScoreWeights(data.weights);
      return true;
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Không thể lưu trọng số.");
      return false;
    } finally {
      setSavingWeights(false);
    }
  };

  const updateScoreWeight = (key: keyof ScoreWeights, percent: number) => {
    setScoreWeights((current) => ({ ...current, [key]: Math.max(0, Math.min(100, percent)) / 100 }));
  };

  // Toggle Keyword selection in Stage 3
  const toggleKeyword = (kw: string) => {
    const next = new Set(selectedKeywords);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    setSelectedKeywords(next);
  };

  const toggleSelectAllFilteredKeywords = () => {
    if (displayedStage2Keywords.every((k) => selectedKeywords.has(k.keyword))) {
      const next = new Set(selectedKeywords);
      displayedStage2Keywords.forEach((k) => next.delete(k.keyword));
      setSelectedKeywords(next);
    } else {
      const next = new Set(selectedKeywords);
      displayedStage2Keywords.forEach((k) => next.add(k.keyword));
      setSelectedKeywords(next);
    }
  };

  // Stage 4 Data Categories
  const finalKeywordsList = useMemo(() => {
    return stage2Keywords.filter((k) => selectedKeywords.has(k.keyword));
  }, [stage2Keywords, selectedKeywords]);

  const highVolumeKeywords = useMemo(() => {
    return finalKeywordsList
      .filter((k) => (k.search_volume || 0) >= 1000)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
  }, [finalKeywordsList]);

  const longTailKeywords = useMemo(() => {
    return finalKeywordsList
      .filter((k) => k.keyword.split(/\s+/).length >= 3)
      .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
  }, [finalKeywordsList]);

  const backendSearchTerms = useMemo(() => {
    const words = new Set<string>();
    for (const item of finalKeywordsList) {
      item.keyword
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .forEach((w) => {
          if (w.length > 1 && !words.has(w)) words.add(w);
        });
    }
    // Limit to under 250 bytes
    let resultStr = "";
    for (const w of Array.from(words)) {
      if ((resultStr + " " + w).trim().length <= 245) {
        resultStr = (resultStr + " " + w).trim();
      } else {
        break;
      }
    }
    return resultStr;
  }, [finalKeywordsList]);

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Export CSV helper
  const handleExportCSV = () => {
    if (keywordParts.length === 0 && negativeCandidates.length === 0) return;
    const header = "Nhóm/Part,STT,Từ Khóa,Phân Loại,Relevance (%),Search Volume,Rank Organic,CPC ($)\n";
    const partRows = keywordParts.flatMap((part) =>
      part.keywords.map((k, idx) => {
        const pName = `"${part.name.replace(/"/g, '""')}"`;
        const kw = `"${k.keyword.replace(/"/g, '""')}"`;
        const vol = k.search_volume ?? "";
        const rank = k.organic_rank ? `#${k.organic_rank}` : "";
        const cpc = k.cpc ? `$${k.cpc.toFixed(2)}` : "";
        return `${pName},${idx + 1},${kw},${k.type},${k.relevance},${vol},${rank},${cpc}`;
      })
    );

    const negRows = negativeCandidates.map((k, idx) => {
      const kw = `"${k.keyword.replace(/"/g, '""')}"`;
      const vol = k.search_volume ?? "";
      const cpc = k.cpc ? `$${k.cpc.toFixed(2)}` : "";
      return `"Negative Candidates",${idx + 1},${kw},${k.type === "WRONG_PRODUCT" ? "Sai Sản Phẩm" : "AI Negative"},${k.relevance},${vol},—,${cpc}`;
    });

    const allRows = [...partRows, ...negRows].join("\n");
    const blob = new Blob(["\uFEFF" + header + allRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords-${(productTitle.trim() || "export").replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Excel (.xlsx) helper
  const [exportingExcel, setExportingExcel] = useState(false);

  const handleExportExcel = async () => {
    if (keywordParts.length === 0 && negativeCandidates.length === 0) return;
    setExportingExcel(true);
    try {
      const res = await fetch("/api/keywords/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productTitle: productTitle.trim() || "Amazon_Keywords",
          keywordParts,
          negativeCandidates,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Không thể xuất file Excel.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cleanTitle = (productTitle.trim() || "Keywords").replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, "_").slice(0, 30);
      a.download = `${cleanTitle}_Keyword_Parts_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Lỗi khi xuất file Excel.");
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="w-full space-y-4 text-slate-800 font-sans max-w-7xl mx-auto pb-10">
      {/* Top Header & Product Input Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Lightning size={18} weight="fill" />
            </span>
            <h1 className="text-base font-black text-slate-900">
              Đào Từ Khóa (4 Bước)
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
            >
              <Gear size={15} className="text-slate-500" />
              <span>Cài đặt Cookie</span>
            </button>
          </div>
        </div>

        {/* Input Bar */}
        <div className="pt-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
            <div className="md:col-span-8">
              <input
                type="text"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) {
                    void runStage1();
                  }
                }}
                placeholder="Nhập tên sản phẩm hoặc Seed Keyword (vd: Navy Veteran Tumbler)..."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition"
              />
            </div>

            <div className="md:col-span-4 flex items-center gap-2">
              <button
                type="button"
                disabled={loading || !productTitle.trim()}
                onClick={() => void runStage1()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition disabled:opacity-50 cursor-pointer shadow-2xs whitespace-nowrap"
                title="Quét danh sách ASIN đối thủ (Bước 1)"
              >
                <MagnifyingGlass size={15} weight="bold" />
                <span>Quét ASIN</span>
              </button>

              <button
                type="button"
                disabled={loading || !productTitle.trim()}
                onClick={() => void runAutoFlow()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-black shadow-2xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
                title="Tự động chạy toàn bộ quy trình: Quét ASIN -> Reverse -> Lọc SV -> AI Phân loại -> Chia Part & Negative"
              >
                <Lightning size={15} weight="fill" className={autoFlowActive ? "animate-bounce text-amber-300" : "text-amber-300"} />
                <span>{autoFlowActive ? "Đang chạy..." : "⚡ Auto Flow"}</span>
              </button>
            </div>
          </div>

          {autoFlowStep && (
            <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 border border-indigo-200 text-indigo-950 text-xs flex items-center gap-2.5 font-bold shadow-2xs">
              <ArrowsClockwise size={16} className="animate-spin text-indigo-600 shrink-0" />
              <span>{autoFlowStep}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 font-medium">
              <WarningCircle size={16} className="shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* Stepper Navigation: 4 Steps */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-200/50 p-1.5 rounded-2xl border border-slate-200 shadow-2xs">
        {/* Step 1 */}
        <button
          type="button"
          onClick={() => setCurrentStage(1)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
            currentStage === 1
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              stage1Result
                ? "bg-emerald-100 text-emerald-700"
                : currentStage === 1
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {stage1Result ? <Check size={12} weight="bold" /> : "1"}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black truncate">Bước 1: Quét 8–10 ASIN</div>
            {selectedAsins.size > 0 && (
              <div className="text-[10.5px] text-slate-400 font-semibold truncate">
                {selectedAsins.size} ASINs chọn
              </div>
            )}
          </div>
        </button>

        {/* Step 2 */}
        <button
          type="button"
          onClick={() => setCurrentStage(2)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
            currentStage === 2
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              stage2Keywords.length > 0
                ? "bg-emerald-100 text-emerald-700"
                : currentStage === 2
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {stage2Keywords.length > 0 ? <Check size={12} weight="bold" /> : "2"}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black truncate">Bước 2: Reverse (Lọc SV)</div>
            {stage2Keywords.length > 0 && (
              <div className="text-[10.5px] text-slate-400 font-semibold truncate">
                {displayedStage2Keywords.length}/{stage2Keywords.length} từ (SV ≥ 20)
              </div>
            )}
          </div>
        </button>

        {/* Step 3 */}
        <button
          type="button"
          onClick={() => setCurrentStage(3)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
            currentStage === 3
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              classifiedKeywords.length > 0
                ? "bg-emerald-100 text-emerald-700"
                : currentStage === 3
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {classifiedKeywords.length > 0 ? <Check size={12} weight="bold" /> : "3"}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black truncate">Bước 3: AI Semantic</div>
            {classifiedKeywords.length > 0 && (
              <div className="text-[10.5px] text-slate-400 font-semibold truncate">
                {classifiedKeywords.filter((k) => !k.negative && k.type !== "WRONG_PRODUCT").length} từ hợp lệ
              </div>
            )}
          </div>
        </button>

        {/* Step 4 */}
        <button
          type="button"
          onClick={() => setCurrentStage(4)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
            currentStage === 4
              ? "bg-white text-indigo-700 shadow-xs border border-indigo-100"
              : "text-slate-600 hover:bg-white/60"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
              keywordParts.length > 0
                ? "bg-emerald-100 text-emerald-700"
                : currentStage === 4
                ? "bg-indigo-600 text-white"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {keywordParts.length > 0 ? <Check size={12} weight="bold" /> : "4"}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-black truncate">Bước 4: Chia Part &amp; Negative</div>
            {keywordParts.length > 0 && (
              <div className="text-[10.5px] text-slate-400 font-semibold truncate">
                {keywordParts.length} Parts · {negativeCandidates.length} Negative
              </div>
            )}
          </div>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* BƯỚC 1: QUÉT 10 ASIN TIỀM NĂNG                                            */}
      {/* ========================================================================= */}
      {currentStage === 1 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900">
                Bước 1: Quét 10 ASIN Tiềm Năng
              </h2>
              {stage1Result && (
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Đã chọn {selectedAsins.size} ASINs
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {stage1Result && (
                <button
                  type="button"
                  onClick={autoSelectRule}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer whitespace-nowrap"
                  title="Tự động chọn ASIN theo luật: Điểm cuối > 70 (tối đa 10 ASIN), nếu không có thì lấy Top 4 cao nhất"
                >
                  <ArrowsClockwise size={13} weight="bold" />
                  <span>Chọn tự động (&gt;70 / Top 4)</span>
                </button>
              )}
              <button
                type="button"
                disabled={selectedAsins.size === 0 || loading}
                onClick={() => {
                  setCurrentStage(2);
                  if (stage2Keywords.length === 0) {
                    void runStage2();
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-2xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <span>Sang Bước 2 (Reverse)</span>
                <ArrowRight size={13} weight="bold" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-2xs">
            <div className="mr-auto">
              <div className="text-xs font-extrabold text-slate-800">Độ quan trọng khi chọn Top 10</div>
              <div className="text-[10.5px] font-medium text-slate-400">
                AI {Math.round(scoreWeights.relevance * 100)}% · Doanh thu {Math.round(scoreWeights.revenue * 100)}% · Đơn bán {Math.round(scoreWeights.sales * 100)}% · BSR {Math.round(scoreWeights.bsr * 100)}%
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowWeightSettings((current) => !current)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              {showWeightSettings ? "Ẩn" : "Điều chỉnh"}
            </button>
            {showWeightSettings && (<>
            {([
              ["relevance", "Liên quan AI"],
              ["revenue", "Doanh thu"],
              ["sales", "Đơn bán"],
              ["bsr", "BSR"],
            ] as const).map(([key, label]) => (
              <label key={key} className="space-y-1">
                <span className="block text-[10.5px] font-bold text-slate-500">{label}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(scoreWeights[key] * 100)}
                    onChange={(event) => updateScoreWeight(key, Number(event.target.value))}
                    className="w-16 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-xs font-bold text-slate-800 outline-none focus:border-indigo-400"
                  />
                  <span className="text-xs font-bold text-slate-400">%</span>
                </div>
              </label>
            ))}
            <div className="text-xs font-extrabold text-slate-700 pb-1.5">
              Tổng {Math.round(Object.values(scoreWeights).reduce((sum, value) => sum + value, 0) * 100)}%
            </div>
            <button
              type="button"
              disabled={savingWeights || Math.abs(Object.values(scoreWeights).reduce((sum, value) => sum + value, 0) - 1) > 0.001}
              onClick={() => void saveScoreWeights(scoreWeights)}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {savingWeights ? "Đang lưu..." : "Lưu"}
            </button>
            <button
              type="button"
              disabled={savingWeights}
              onClick={() => {
                setScoreWeights(DEFAULT_SCORE_WEIGHTS);
                void saveScoreWeights(DEFAULT_SCORE_WEIGHTS);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
            >
              Reset mặc định
            </button>
            </>)}
          </div>

          {/* Animated Progressive Loading Card */}
          {loading && currentStage === 1 && (
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/80 via-white to-slate-50 p-6 shadow-sm space-y-5 animate-in fade-in duration-300">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-200 shrink-0">
                    <Sparkle size={24} weight="fill" className="animate-spin" style={{ animationDuration: "3s" }} />
                    <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <span>Đang thực hiện quy trình AI Discovery 7 giai đoạn</span>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        Gemini 3.7 Flash
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Hệ thống đang quét trực tiếp thị trường Amazon &amp; tính toán đối thủ bán chạy nhất...
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono font-bold text-indigo-700 bg-white px-3 py-1.5 rounded-xl border border-indigo-100 shadow-2xs">
                  <ArrowsClockwise size={14} className="animate-spin text-indigo-600" />
                  <span>Bước {stage1LoadingStep || 1} / 4</span>
                </div>
              </div>

              {/* Smooth Progress Bar */}
              <div className="space-y-1.5">
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-indigo-600 to-emerald-500 h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width:
                        stage1LoadingStep === 1
                          ? "25%"
                          : stage1LoadingStep === 2
                          ? "50%"
                          : stage1LoadingStep === 3
                          ? "75%"
                          : stage1LoadingStep === 4
                          ? "92%"
                          : "15%",
                    }}
                  />
                </div>
              </div>

              {/* 4 Steps Indicators */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
                {[
                  { step: 1, title: "1. Quét dữ liệu thô", desc: "SellerSprite & Amazon crawler lấy 60+ ASIN" },
                  { step: 2, title: "2. Thu thập chỉ số bán", desc: "Doanh thu ước tính, đơn/tháng, BSR & rating" },
                  { step: 3, title: "3. AI chấm ngữ nghĩa", desc: "Gemini 3.7 so khớp Core Type & lọc lạc đề" },
                  { step: 4, title: "4. Tối ưu Top 10", desc: "Khử trùng Parent ASIN & đa dạng thương hiệu" },
                ].map((s) => {
                  const isCurrent = stage1LoadingStep === s.step;
                  const isDone = stage1LoadingStep > s.step;
                  return (
                    <div
                      key={s.step}
                      className={`p-3 rounded-xl border transition-all ${
                        isCurrent
                          ? "bg-white border-indigo-300 shadow-xs ring-2 ring-indigo-100"
                          : isDone
                          ? "bg-emerald-50/60 border-emerald-200 text-slate-700"
                          : "bg-slate-50/70 border-slate-200/80 text-slate-400"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {isDone ? (
                          <CheckCircle size={15} weight="fill" className="text-emerald-600 shrink-0" />
                        ) : isCurrent ? (
                          <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse shrink-0" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                        )}
                        <span
                          className={`text-xs font-bold ${
                            isCurrent ? "text-indigo-900" : isDone ? "text-emerald-900" : "text-slate-500"
                          }`}
                        >
                          {s.title}
                        </span>
                      </div>
                      <p className="text-[10.5px] leading-relaxed text-slate-500">{s.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Skeleton Placeholder Rows */}
              <div className="space-y-2 pt-2 opacity-60">
                <div className="h-10 bg-slate-100/90 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100/70 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100/50 rounded-lg animate-pulse" />
              </div>
            </div>
          )}

          {/* Quick Metrics Bar */}
          {stage1Result && !loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">ASIN Đã Chọn</span>
                <div className="text-base font-extrabold text-indigo-700 mt-0.5">
                  {selectedAsins.size} / {displayedCandidates.length}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tổng Doanh Số</span>
                <div className="text-base font-extrabold text-slate-900 mt-0.5">
                  {stage1Result.stats.totalUnits ? `${stage1Result.stats.totalUnits.toLocaleString()} units` : "—"}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tổng Doanh Thu</span>
                <div className="text-base font-extrabold text-emerald-700 mt-0.5">
                  {stage1Result.stats.totalRevenue ? `$${stage1Result.stats.totalRevenue.toLocaleString()}` : "—"}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">BSR Trung Bình</span>
                <div className="text-base font-extrabold text-slate-900 mt-0.5">
                  {stage1Result.stats.avgBsr ? `#${stage1Result.stats.avgBsr.toLocaleString()}` : "—"}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Giá Trung Bình</span>
                <div className="text-base font-extrabold text-slate-900 mt-0.5">
                  {stage1Result.stats.avgPrice ? `$${stage1Result.stats.avgPrice.toFixed(2)}` : "—"}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Đánh Giá TB</span>
                <div className="flex items-center gap-1.5 text-base font-extrabold text-amber-600 mt-0.5">
                  {stage1Result.stats.avgRating ? (
                    <>
                      <Star size={16} weight="fill" className="text-amber-500 shrink-0" />
                      <span>{stage1Result.stats.avgRating.toFixed(1)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
            </div>
          )}

          {stage1Result && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setStage1Tab("selected")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    stage1Tab === "selected"
                      ? "bg-white text-indigo-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <span>Top 10 Được Chọn</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10.5px] font-black ${
                      stage1Tab === "selected" ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {stage1Result.candidates.length}
                  </span>
                </button>

                {stage1Result.allCandidates && stage1Result.allCandidates.length > stage1Result.candidates.length && (
                  <button
                    type="button"
                    onClick={() => setStage1Tab("all")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      stage1Tab === "all"
                        ? "bg-white text-indigo-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>Tất Cả Đã Chấm Điểm</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10.5px] font-black ${
                        stage1Tab === "all" ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {stage1Result.allCandidates.length}
                    </span>
                  </button>
                )}

                {stage1Result.rejected && stage1Result.rejected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStage1Tab("rejected")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      stage1Tab === "rejected"
                        ? "bg-white text-rose-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <span>Bị Loại</span>
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10.5px] font-black ${
                        stage1Tab === "rejected" ? "bg-rose-50 text-rose-700" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {stage1Result.rejected.length}
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowScoreDetails((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                    showScoreDetails
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{showScoreDetails ? "Ẩn Chi Tiết Điểm" : "Hiện Điểm Chi Tiết (AI, Doanh Thu, BSR)"}</span>
                </button>
              </div>
            </div>
          )}

          {/* ASIN Table or Rejected Table */}
          {stage1Result && stage1Tab === "rejected" ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3 min-w-[220px]">ASIN</th>
                    <th className="p-3 w-56 text-center">LÝ DO LOẠI</th>
                    <th className="p-3 w-28 text-right">ĐIỂM AI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {stage1Result.rejected && stage1Result.rejected.length > 0 ? (
                    stage1Result.rejected.map((item, idx) => {
                      const getReasonBadge = (code: string) => {
                        switch (code) {
                          case "PRODUCT_TYPE_MISMATCH":
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Khác loại sản phẩm chính
                              </span>
                            );
                          case "LOW_RELEVANCE":
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                Điểm tương đồng AI thấp (&lt; 60)
                              </span>
                            );
                          case "SPONSORED_ONLY":
                          case "SPONSORED_RESULT":
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-orange-50 text-orange-700 border border-orange-200">
                                Chỉ có vị trí Sponsored
                              </span>
                            );
                          case "PARENT_DUPLICATE":
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                Trùng Parent ASIN
                              </span>
                            );
                          case "BRAND_LIMIT_SKIPPED":
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                Vượt quota Brand (tối đa 3)
                              </span>
                            );
                          default:
                            return (
                              <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                {code}
                              </span>
                            );
                        }
                      };
                      return (
                        <tr key={item.asin || idx} className="hover:bg-slate-50/60 transition">
                          <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">{idx + 1}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <a
                                href={`https://www.amazon.com/dp/${item.asin}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono font-bold text-xs text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 hover:bg-indigo-100"
                              >
                                {item.asin}
                              </a>
                              <button
                                type="button"
                                onClick={() => handleCopy(item.asin, `rej-asin-${item.asin}`)}
                                className="rounded border border-slate-200 bg-white p-1 text-slate-400 hover:text-indigo-600"
                                title="Copy ASIN"
                              >
                                {copiedKey === `rej-asin-${item.asin}` ? (
                                  <Check size={11} weight="bold" className="text-emerald-600" />
                                ) : (
                                  <Copy size={11} />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="p-3 text-center">{getReasonBadge(item.reasonCode)}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-700">
                            {item.relevanceScore !== undefined && item.relevanceScore !== null
                              ? `${item.relevanceScore.toFixed(0)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-400 text-xs">
                        Không có ASIN nào bị loại.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : stage1Result && displayedCandidates.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">CHỌN</th>
                    <th className="p-3 w-10 text-center">#</th>
                    <th className="p-3 w-12 text-center">ẢNH</th>
                    <th className="p-3 min-w-[220px]">SẢN PHẨM &amp; ASIN</th>
                    <th className="p-3 w-28">BRAND</th>
                    <th className="p-3 w-20 text-right">GIÁ</th>
                    <th className="p-3 w-24 text-right">ĐƠN/THÁNG</th>
                    <th className="p-3 w-28 text-right">DOANH THU</th>
                    <th className="p-3 w-20 text-right">BSR</th>
                    <th className="p-3 w-20 text-right">SCORE</th>
                    {showScoreDetails && (
                      <>
                        <th className="p-3 w-20 text-right">AI</th>
                        <th className="p-3 w-20 text-right">REV SCORE</th>
                        <th className="p-3 w-20 text-right">SALES SCORE</th>
                        <th className="p-3 w-20 text-right">BSR SCORE</th>
                      </>
                    )}
                    <th className="p-3 w-20 text-right">MARGIN</th>
                    <th className="p-3 w-28 text-right">RATING</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {displayedCandidates.map((item, idx) => {
                    const isSelected = selectedAsins.has(item.asin);
                    return (
                      <tr
                        key={item.asin}
                        onClick={() => toggleAsin(item.asin)}
                        className={`cursor-pointer transition hover:bg-indigo-50/30 ${
                          isSelected ? "bg-indigo-50/50" : ""
                        }`}
                      >
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAsin(item.asin)}
                            className="rounded border-slate-300 accent-indigo-600 cursor-pointer w-4 h-4"
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
                              className="w-10 h-10 object-contain rounded-md border border-slate-200 bg-white p-0.5 mx-auto"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center text-slate-300 text-[10px] mx-auto">
                              No img
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <a
                            href={`https://www.amazon.com/dp/${item.asin}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="font-bold text-slate-900 line-clamp-2 text-xs hover:text-indigo-700 leading-snug transition"
                            title={decodeHtml(item.title)}
                          >
                            {decodeHtml(item.title)}
                          </a>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <a
                              href={`https://www.amazon.com/dp/${item.asin}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="font-mono font-extrabold text-[10.5px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 hover:bg-indigo-100"
                              title="Mở ASIN trên Amazon"
                            >
                              {item.asin}
                            </a>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCopy(item.asin, `asin-${item.asin}`);
                              }}
                              className="rounded border border-slate-200 bg-white p-1 text-slate-400 hover:text-indigo-700 transition"
                              title="Copy ASIN"
                            >
                              {copiedKey === `asin-${item.asin}` ? (
                                <Check size={11} weight="bold" className="text-emerald-600" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                            {item.isBestSeller && (
                              <span className="text-[9.5px] font-black uppercase tracking-wider text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded">
                                Best Seller
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 font-semibold text-slate-800 truncate max-w-[130px]" title={decodeHtml(item.brand)}>
                          {decodeHtml(item.brand || "—")}
                        </td>
                        <td className="p-3 text-right font-mono font-extrabold text-slate-900">
                          {item.price || "—"}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-slate-900">
                          {item.monthlySales ? item.monthlySales.toLocaleString() : "—"}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-emerald-700">
                          {item.revenue ? `$${Math.round(item.revenue).toLocaleString()}` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-xs font-semibold text-slate-700">
                          {item.bsr ? `#${item.bsr.toLocaleString()}` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {item.finalScore !== null && item.finalScore !== undefined ? (
                            <span
                              className={`inline-flex items-center justify-center min-w-[46px] px-2.5 py-1 rounded-lg font-mono font-black text-xs shadow-xs ${
                                item.finalScore >= 80
                                  ? "bg-indigo-600 text-white shadow-indigo-100"
                                  : item.finalScore >= 65
                                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
                              }`}
                              title={`Điểm tổng hợp: ${item.finalScore.toFixed(1)} / 100\n• Độ tương đồng AI (50%): ${item.aiScore ?? 0}%\n• Doanh thu (30%)\n• Đơn bán (10%)\n• Thứ hạng BSR (10%)${item.aiReason ? `\n• Nhận định AI: ${item.aiReason}` : ""}`}
                            >
                              {item.finalScore.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono">—</span>
                          )}
                        </td>
                        {showScoreDetails && (
                          <>
                            <td className="p-3 text-right font-mono text-xs font-black text-indigo-700">
                              {item.relevanceScore?.toFixed(1) ?? "—"}
                            </td>
                            <td className="p-3 text-right font-mono text-xs text-slate-700">
                              {item.revenueScore?.toFixed(1) ?? "—"}
                            </td>
                            <td className="p-3 text-right font-mono text-xs text-slate-700">
                              {item.salesScore?.toFixed(1) ?? "—"}
                            </td>
                            <td className="p-3 text-right font-mono text-xs text-slate-700">
                              {item.bsrScore?.toFixed(1) ?? "—"}
                            </td>
                          </>
                        )}
                        <td className="p-3 text-right font-mono text-xs font-bold text-indigo-600">
                          {item.profit ? `${item.profit.toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-3 text-right">
                          {item.rating ? (
                            <div className="inline-flex items-center justify-end gap-1 font-mono text-xs leading-none">
                              <span className="font-extrabold text-amber-700 leading-none">{item.rating.toFixed(1)}</span>
                              <Star size={12} weight="fill" className="text-amber-500 shrink-0" />
                              <span className="text-slate-400 font-normal text-[11px] leading-none">
                                ({item.reviewCount ? item.reviewCount.toLocaleString() : 0})
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-300 font-mono text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2">
              <Trophy size={32} className="mx-auto text-slate-300" />
              <p className="text-xs text-slate-500 font-semibold">Chưa có dữ liệu.</p>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* BƯỚC 2: REVERSE 10 ASIN & LỌC SEARCH VOLUME (< 20 MẶC ĐỊNH)               */}
      {/* ========================================================================= */}
      {currentStage === 2 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900">
                Bước 2: Reverse ASINs &amp; Lọc Search Volume
              </h2>
              {stage2Keywords.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {displayedStage2Keywords.length}/{stage2Keywords.length} từ khóa
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCurrentStage(1)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft size={13} weight="bold" />
                <span>Quay lại</span>
              </button>

              <select
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value as "sellersprite" | "helium10" | "auto")}
                className="px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 outline-none whitespace-nowrap"
              >
                <option value="auto">Nguồn: Tự động</option>
                <option value="sellersprite">SellerSprite</option>
                <option value="helium10">Helium 10</option>
              </select>

              <button
                type="button"
                disabled={selectedAsins.size === 0 || loading}
                onClick={() => void runStage2()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap"
              >
                <ArrowsClockwise size={13} className={loading ? "animate-spin" : ""} />
                <span>{stage2Keywords.length > 0 ? "Quét lại" : "Bắt đầu Reverse"}</span>
              </button>

              <button
                type="button"
                disabled={displayedStage2Keywords.length === 0 || loading}
                onClick={() => {
                  setCurrentStage(3);
                  if (classifiedKeywords.length === 0) {
                    void runStage3AiClassification(displayedStage2Keywords);
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-2xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <span>Sang Bước 3 (AI Phân Loại)</span>
                <ArrowRight size={13} weight="bold" />
              </button>
            </div>
          </div>

          {/* Selected ASINs Tag List */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500">ASINs tiềm năng đã chọn ({selectedAsins.size}):</span>
            {Array.from(selectedAsins).map((asin) => (
              <a
                key={asin}
                href={`https://www.amazon.com/dp/${asin}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition"
                title="Mở ASIN trên Amazon"
              >
                {asin}
              </a>
            ))}
          </div>

          {/* Search Volume Filter Toolbar (Direct: Search Volume > 20) */}
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 sm:px-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FunnelSimple size={15} weight="bold" className="text-indigo-600" />
              <span className="text-xs font-bold text-slate-800">Search Volume &gt;</span>
              <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <button
                  type="button"
                  onClick={() => setStage2VolumeThreshold((v) => Math.max(0, v - 5))}
                  className="px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 font-black text-xs transition cursor-pointer"
                  title="-5"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => setStage2VolumeThreshold((v) => Math.max(0, v - 1))}
                  className="px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 font-bold text-xs transition cursor-pointer"
                  title="-1"
                >
                  -1
                </button>
                <input
                  type="number"
                  min={0}
                  value={stage2VolumeThreshold}
                  onChange={(e) => setStage2VolumeThreshold(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-14 text-center text-xs font-black text-indigo-700 py-1 outline-none border-x border-slate-200"
                />
                <button
                  type="button"
                  onClick={() => setStage2VolumeThreshold((v) => v + 1)}
                  className="px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800 font-bold text-xs transition cursor-pointer"
                  title="+1"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => setStage2VolumeThreshold((v) => v + 5)}
                  className="px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 font-black text-xs transition cursor-pointer"
                  title="+5"
                >
                  +5
                </button>
              </div>

              <span className="text-xs font-semibold text-slate-500 ml-1">
                (Khớp: <b className="text-indigo-700 font-black">{displayedStage2Keywords.length}</b> / {stage2Keywords.length} từ)
              </span>
            </div>

            {displayedStage2Keywords.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const text = displayedStage2Keywords.map((k) => k.keyword).join("\n");
                  navigator.clipboard.writeText(text);
                  setCopiedKey("stage2-keywords");
                  setTimeout(() => setCopiedKey(null), 2000);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer shrink-0"
              >
                {copiedKey === "stage2-keywords" ? (
                  <>
                    <Check size={12} weight="bold" className="text-emerald-600" />
                    <span className="text-emerald-700">Đã sao chép!</span>
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    <span>Sao chép {displayedStage2Keywords.length} từ</span>
                  </>
                )}
              </button>
            )}
          </div>

          {stage2Warning && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2 font-medium">
              <WarningCircle size={16} className="shrink-0 text-amber-600" />
              <span>{stage2Warning}</span>
            </div>
          )}

          {/* Keywords Table */}
          {displayedStage2Keywords.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3 min-w-[220px]">Từ khóa (Keyword)</th>
                    <th className="p-3 w-32 text-right font-black text-indigo-700">Search Volume</th>
                    <th className="p-3 w-24 text-right">Rank Organic</th>
                    <th className="p-3 w-24 text-right">CPC ($)</th>
                    <th className="p-3 w-28 text-right">Sản phẩm cạnh tranh</th>
                    <th className="p-3 w-28 text-center">ASIN Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {displayedStage2Keywords.map((item, idx) => {
                    const vol = typeof item.search_volume === "number" ? item.search_volume : 0;
                    const isLowVol = vol < 20;
                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition group">
                        <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{item.keyword}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.keyword, `kw-${idx}`)}
                              className="text-slate-400 hover:text-indigo-600 p-0.5 rounded transition cursor-pointer"
                              title="Sao chép từ khóa"
                            >
                              {copiedKey === `kw-${idx}` ? (
                                <Check size={11} className="text-emerald-600" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono">
                          {isLowVol ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {vol.toLocaleString()}
                            </span>
                          ) : (
                            <span className="font-black text-indigo-700">
                              {vol > 0 ? vol.toLocaleString() : "—"}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-700 font-semibold">
                          {item.organic_rank ? `#${item.organic_rank}` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-600">
                          {item.cpc ? `$${item.cpc.toFixed(2)}` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-500">
                          {item.competing_products ? item.competing_products.toLocaleString() : "—"}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-slate-100 text-slate-700">
                            {item.asin_count ? `${item.asin_count}/${selectedAsins.size} ASINs` : "1 ASIN"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : stage2Keywords.length > 0 ? (
            <div className="p-10 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <WarningCircle size={32} className="mx-auto text-amber-500" />
              <div className="space-y-1">
                <div className="text-xs font-black text-slate-800">
                  Không có từ khóa nào có Search Volume {stage2VolumeOperator} {stage2VolumeThreshold}
                </div>
                <p className="text-[11px] text-slate-500">
                  Trong tổng số {stage2Keywords.length} từ khóa thu được từ các ASIN đối thủ, không có từ khóa nào thỏa mãn điều kiện lọc hiện tại.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setStage2VolumeOperator("all")}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-2xs transition cursor-pointer"
                >
                  Xem tất cả {stage2Keywords.length} từ khóa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage2VolumeOperator("<");
                    setStage2VolumeThreshold(20);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Đặt lại về &lt; 20
                </button>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <Lightning size={32} className="mx-auto text-indigo-400" />
              <div className="space-y-1">
                <p className="text-xs font-black text-slate-800">Sẵn sàng Reverse {selectedAsins.size} ASINs đã chọn</p>
                <p className="text-[11px] text-slate-500">Bấm nút bên dưới để tiến hành lấy toàn bộ từ khóa và lọc Volume &lt; 20</p>
              </div>
              <button
                type="button"
                disabled={selectedAsins.size === 0 || loading}
                onClick={() => void runStage2()}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
              >
                <span>Bắt đầu Reverse ngay ({selectedAsins.size} ASINs)</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* BƯỚC 3: 🤖 AI BATCH — 1 NHIỆM VỤ SEMANTIC DUY NHẤT                         */}
      {/* ========================================================================= */}
      {currentStage === 3 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold shrink-0">
                <Sparkle size={18} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <span>Bước 3: AI Phân Loại Semantic</span>
                  <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                    1 AI Batch Stage
                  </span>
                </h2>
                <div className="text-[11px] text-slate-500 font-medium">
                  Đánh giá độ liên quan (0–100), phân loại Product/Gift/Event và tự động phát hiện Negative Candidates
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCurrentStage(2)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft size={13} weight="bold" />
                <span>Quay lại</span>
              </button>

              <button
                type="button"
                disabled={displayedStage2Keywords.length === 0 || classifying}
                onClick={() => void runStage3AiClassification()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer whitespace-nowrap"
              >
                <ArrowsClockwise size={13} className={classifying ? "animate-spin" : ""} />
                <span>{classifiedKeywords.length > 0 ? "Phân loại lại AI" : "Bắt đầu AI Phân Loại"}</span>
              </button>

              <button
                type="button"
                disabled={classifiedKeywords.length === 0 || classifying}
                onClick={() => setCurrentStage(4)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-2xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <span>Sang Bước 4 (Chia Part)</span>
                <ArrowRight size={13} weight="bold" />
              </button>
            </div>
          </div>

          {/* AI Semantic Controls & Category Tabs */}
          {classifiedKeywords.length > 0 && (
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
              {/* Category Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setStage3Tab("all")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                    stage3Tab === "all"
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  Tất Cả ({classifiedKeywords.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStage3Tab("PRODUCT")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                    stage3Tab === "PRODUCT"
                      ? "bg-blue-600 text-white shadow-2xs"
                      : "bg-blue-50 hover:bg-blue-100 text-blue-700"
                  }`}
                >
                  Sản Phẩm ({classifiedKeywords.filter((k) => k.type === "PRODUCT" && !k.negative).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStage3Tab("GIFT")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                    stage3Tab === "GIFT"
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                  }`}
                >
                  Quà Tặng / Gift ({classifiedKeywords.filter((k) => k.type === "GIFT" && !k.negative).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStage3Tab("EVENT")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                    stage3Tab === "EVENT"
                      ? "bg-amber-600 text-white shadow-2xs"
                      : "bg-amber-50 hover:bg-amber-100 text-amber-700"
                  }`}
                >
                  Sự Kiện / Event ({classifiedKeywords.filter((k) => k.type === "EVENT" && !k.negative).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStage3Tab("AUDIENCE")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ${
                    stage3Tab === "AUDIENCE"
                      ? "bg-purple-600 text-white shadow-2xs"
                      : "bg-purple-50 hover:bg-purple-100 text-purple-700"
                  }`}
                >
                  Đối Tượng ({classifiedKeywords.filter((k) => k.type === "AUDIENCE" && !k.negative).length})
                </button>
                <button
                  type="button"
                  onClick={() => setStage3Tab("NEGATIVE")}
                  className={`px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer ml-auto ${
                    stage3Tab === "NEGATIVE"
                      ? "bg-rose-600 text-white shadow-2xs"
                      : "bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200"
                  }`}
                >
                  <Prohibit size={13} className="inline mr-1" weight="bold" />
                  Negative Candidates ({negativeCandidates.length})
                </button>
              </div>

              {/* Filter controls row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Min Relevance Threshold */}
                {stage3Tab !== "NEGATIVE" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600">Ngưỡng Relevance:</span>
                    <div className="inline-flex items-center gap-1">
                      {[50, 60, 70, 80, 0].map((score) => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => setStage3MinRelevance(score)}
                          className={`px-2 py-0.5 rounded text-xs font-black transition cursor-pointer ${
                            stage3MinRelevance === score
                              ? "bg-indigo-600 text-white shadow-2xs"
                              : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                          }`}
                        >
                          {score === 0 ? "Tất cả" : `≥ ${score}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Text */}
                <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 min-w-[200px]">
                  <MagnifyingGlass size={13} className="text-slate-400" />
                  <input
                    type="text"
                    value={stage3SearchText}
                    onChange={(e) => setStage3SearchText(e.target.value)}
                    placeholder="Tìm kiếm từ khóa..."
                    className="w-full text-xs font-semibold text-slate-800 bg-transparent outline-none placeholder:text-slate-400"
                  />
                  {stage3SearchText && (
                    <button
                      type="button"
                      onClick={() => setStage3SearchText("")}
                      className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Classified Keywords Table */}
          {classifying ? (
            <div className="p-14 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <ArrowsClockwise size={36} className="mx-auto text-indigo-600 animate-spin" />
              <div className="space-y-1">
                <p className="text-sm font-black text-slate-900">AI đang phân loại ngữ nghĩa hàng loạt (1 Batch)...</p>
                <p className="text-xs text-slate-500 font-medium">
                  Đánh giá độ liên quan, nhận diện loại từ khóa (Product/Gift/Event) và tách Negative Candidates.
                </p>
              </div>
            </div>
          ) : classifiedKeywords.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          displayedStage3Keywords.length > 0 &&
                          displayedStage3Keywords.every((k) => selectedKeywords.has(k.keyword))
                        }
                        onChange={() => {
                          const allSelected = displayedStage3Keywords.every((k) => selectedKeywords.has(k.keyword));
                          const next = new Set(selectedKeywords);
                          if (allSelected) {
                            displayedStage3Keywords.forEach((k) => next.delete(k.keyword));
                          } else {
                            displayedStage3Keywords.forEach((k) => next.add(k.keyword));
                          }
                          setSelectedKeywords(next);
                        }}
                        className="rounded border-slate-300 accent-indigo-600 cursor-pointer"
                      />
                    </th>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3 min-w-[200px]">Từ khóa (Keyword)</th>
                    <th className="p-3 w-28 text-center">Phân loại</th>
                    <th className="p-3 w-24 text-right">Relevance</th>
                    <th className="p-3 w-28 text-center">Negative?</th>
                    <th className="p-3 w-28 text-right font-black text-indigo-700">Search Volume</th>
                    <th className="p-3 w-24 text-right">Rank Organic</th>
                    <th className="p-3 w-20 text-right">CPC ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {displayedStage3Keywords.map((item, idx) => {
                    const isSelected = selectedKeywords.has(item.keyword);
                    const isNeg = item.negative || item.type === "WRONG_PRODUCT";
                    return (
                      <tr
                        key={idx}
                        onClick={() => {
                          const next = new Set(selectedKeywords);
                          if (next.has(item.keyword)) next.delete(item.keyword);
                          else next.add(item.keyword);
                          setSelectedKeywords(next);
                        }}
                        className={`cursor-pointer transition hover:bg-slate-50 group ${
                          isNeg ? "bg-rose-50/20" : isSelected ? "bg-indigo-50/30" : ""
                        }`}
                      >
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              const next = new Set(selectedKeywords);
                              if (next.has(item.keyword)) next.delete(item.keyword);
                              else next.add(item.keyword);
                              setSelectedKeywords(next);
                            }}
                            className="rounded border-slate-300 accent-indigo-600 cursor-pointer"
                          />
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{item.keyword}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(item.keyword, `kw-s3-${idx}`);
                              }}
                              className="text-slate-400 hover:text-indigo-600 p-0.5 rounded transition cursor-pointer"
                              title="Sao chép từ khóa"
                            >
                              {copiedKey === `kw-s3-${idx}` ? (
                                <Check size={11} className="text-emerald-600" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                              item.type === "PRODUCT"
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : item.type === "GIFT"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : item.type === "EVENT"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : item.type === "AUDIENCE"
                                ? "bg-purple-50 text-purple-700 border border-purple-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            {item.type}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono">
                          <span
                            className={`font-black ${
                              item.relevance >= 80
                                ? "text-emerald-700"
                                : item.relevance >= 60
                                ? "text-indigo-700"
                                : "text-slate-400"
                            }`}
                          >
                            {item.relevance}%
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {isNeg ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold bg-rose-100 text-rose-800">
                              <Prohibit size={11} weight="bold" />
                              Negative
                            </span>
                          ) : (
                            <span className="text-[10.5px] font-medium text-emerald-700">
                              ✓ Hợp lệ
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-indigo-700">
                          {typeof item.search_volume === "number" && item.search_volume > 0
                            ? item.search_volume.toLocaleString()
                            : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-700 font-semibold">
                          {item.organic_rank ? `#${item.organic_rank}` : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-600">
                          {item.cpc ? `$${item.cpc.toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
              <Sparkle size={32} className="mx-auto text-indigo-400" />
              <div className="space-y-1">
                <p className="text-xs font-black text-slate-800">
                  Sẵn sàng phân loại ngữ nghĩa cho {displayedStage2Keywords.length} từ khóa
                </p>
                <p className="text-[11px] text-slate-500">
                  AI sẽ đánh giá relevance, phân loại Product/Gift/Event và tách Negative Candidates chỉ trong 1 batch duy nhất.
                </p>
              </div>
              <button
                type="button"
                disabled={displayedStage2Keywords.length === 0 || classifying}
                onClick={() => void runStage3AiClassification()}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-2xs transition cursor-pointer"
              >
                <span>Bắt đầu AI Phân Loại ({displayedStage2Keywords.length} từ khóa)</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* BƯỚC 4: CHIA NHÓM PART & DANH SÁCH NEGATIVE (100% CODE)                   */}
      {/* ========================================================================= */}
      {currentStage === 4 && (
        <div className="space-y-4">
          {/* Header Action Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 font-bold shrink-0">
                <FolderSimple size={18} weight="fill" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <span>Bước 4: Chia Nhóm Part &amp; Negative</span>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    100% CODE
                  </span>
                </h2>
                <div className="text-[11px] text-slate-500 font-medium">
                  Chuẩn SOP tài liệu: ≤10 Part/SKU · ≤30 KW/Part · Tổng ≤200 KW · SV/Part ≤30,000
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCurrentStage(3)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft size={13} weight="bold" />
                <span>Quay lại</span>
              </button>

              {/* Copy all parts */}
              {keywordParts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const text = keywordParts
                      .map((p) => `--- ${p.name} (${p.keywords.length} KW - SV: ${p.totalVolume.toLocaleString()}) ---\n` + p.keywords.map((k) => k.keyword).join("\n"))
                      .join("\n\n");
                    handleCopy(text, "all-parts");
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-xs font-bold text-indigo-700 transition cursor-pointer whitespace-nowrap"
                >
                  <Copy size={13} />
                  <span>{copiedKey === "all-parts" ? "Đã chép!" : "Chép Tất Cả Parts"}</span>
                </button>
              )}

              {/* Export CSV */}
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer whitespace-nowrap"
                title="Xuất file CSV"
              >
                <Download size={13} />
                <span>Xuất CSV</span>
              </button>

              {/* Export Excel (.xlsx) */}
              <button
                type="button"
                disabled={exportingExcel || (keywordParts.length === 0 && negativeCandidates.length === 0)}
                onClick={() => void handleExportExcel()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition disabled:opacity-50 cursor-pointer whitespace-nowrap shadow-2xs"
                title="Xuất file Excel (.xlsx) gồm đầy đủ các Sheet Parts và Sheet Negative"
              >
                <FileXls size={14} weight="bold" className="text-emerald-700" />
                <span>{exportingExcel ? "Đang xuất..." : "Xuất Excel (.xlsx)"}</span>
              </button>

              {/* Import to Listing */}
              {onImportKeywords && (
                <button
                  type="button"
                  onClick={() => {
                    const allKw = keywordParts.flatMap((p) => p.keywords.map((k) => k.keyword));
                    onImportKeywords(allKw);
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black shadow-2xs transition cursor-pointer whitespace-nowrap"
                >
                  <ListPlus size={14} weight="bold" />
                  <span>Dùng Cho Listing</span>
                </button>
              )}
            </div>
          </div>

          {/* Part Selection & Negative Tabs */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100 rounded-xl border border-slate-200">
            {/* Negative Tab */}
            <button
              type="button"
              onClick={() => setStage4ActivePart("negative")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                stage4ActivePart === "negative"
                  ? "bg-rose-600 text-white shadow-2xs"
                  : "bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200"
              }`}
            >
              <Prohibit size={14} weight="bold" />
              <span>Negative Candidates ({negativeCandidates.length})</span>
            </button>

            {/* Individual Parts Tabs */}
            {keywordParts.map((part) => (
              <button
                key={part.partNumber}
                type="button"
                onClick={() => setStage4ActivePart(part.partNumber)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                  stage4ActivePart === part.partNumber
                    ? "bg-white text-indigo-700 shadow-2xs border border-indigo-200 font-black"
                    : "text-slate-600 hover:bg-white/60"
                }`}
              >
                <span>{part.name}</span>
                <span className="text-[10px] text-slate-400 font-semibold">
                  ({part.keywords.length} KW · {part.totalVolume.toLocaleString()} SV)
                </span>
              </button>
            ))}
          </div>

          {/* Active Tab Content */}
          {stage4ActivePart === "negative" ? (
            <div className="space-y-3">
              <div className="bg-rose-50/70 border border-rose-200 p-3.5 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-black text-rose-900 flex items-center gap-1.5">
                    <Prohibit size={15} weight="bold" className="text-rose-600" />
                    <span>Danh Sách Negative Keywords Dự Kiến ({negativeCandidates.length} từ khóa)</span>
                  </div>
                  {negativeCandidates.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(negativeCandidates.map((k) => k.keyword).join("\n"), "neg-lines")}
                        className="px-2.5 py-1 rounded-md bg-white border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-100 transition cursor-pointer"
                      >
                        {copiedKey === "neg-lines" ? "Đã copy!" : "Copy Từng Dòng"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(negativeCandidates.map((k) => k.keyword).join(", "), "neg-comma")}
                        className="px-2.5 py-1 rounded-md bg-white border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-100 transition cursor-pointer"
                      >
                        {copiedKey === "neg-comma" ? "Đã copy!" : "Copy Dấu Phẩy"}
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-rose-700 font-medium">
                  Gồm các từ khóa sai loại sản phẩm (Blanket, Shirt, Stanley, Jacket...) hoặc không liên quan. Add vào Negative Phrase / Negative Exact trong chiến dịch PPC để tránh lãng phí ngân sách.
                </p>
              </div>

              {negativeCandidates.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                      <tr>
                        <th className="p-3 w-12 text-center">#</th>
                        <th className="p-3">Từ khóa Negative</th>
                        <th className="p-3 w-32 text-center">Lý do nhận diện</th>
                        <th className="p-3 w-28 text-right font-black text-slate-600">Search Volume</th>
                        <th className="p-3 w-24 text-right">CPC ($)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {negativeCandidates.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition">
                          <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="p-3 font-bold text-slate-900">
                            {item.keyword}
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                              {item.type === "WRONG_PRODUCT" ? "Sai Sản Phẩm" : "AI Negative Flag"}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-black text-slate-700">
                            {typeof item.search_volume === "number" && item.search_volume > 0
                              ? item.search_volume.toLocaleString()
                              : "—"}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-600">
                            {item.cpc ? `$${item.cpc.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200 shadow-2xs">
                  <p className="text-xs text-slate-500 font-medium">Không phát hiện từ khóa Negative nào.</p>
                </div>
              )}
            </div>
          ) : (
            // Part Display
            (() => {
              const currentPart = keywordParts.find((p) => p.partNumber === stage4ActivePart) || keywordParts[0];
              if (!currentPart) {
                return (
                  <div className="p-12 text-center bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2">
                    <FolderSimple size={32} className="mx-auto text-slate-300" />
                    <p className="text-xs text-slate-500 font-semibold">Chưa có Part nào được tạo.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-900">{currentPart.name}</span>
                      <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                        {currentPart.keywords.length} / 30 KW
                      </span>
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                        Tổng Volume: {currentPart.totalVolume.toLocaleString()} / 30,000 SV
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopy(currentPart.keywords.map((k) => k.keyword).join("\n"), `part-${currentPart.partNumber}-lines`)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer"
                      >
                        <Copy size={13} />
                        <span>{copiedKey === `part-${currentPart.partNumber}-lines` ? "Đã copy!" : "Copy Từng Dòng"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopy(currentPart.keywords.map((k) => k.keyword).join(", "), `part-${currentPart.partNumber}-comma`)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 transition cursor-pointer"
                      >
                        <Copy size={13} />
                        <span>{copiedKey === `part-${currentPart.partNumber}-comma` ? "Đã copy!" : "Copy Dấu Phẩy"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Part Keywords Table */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600 font-extrabold border-b-2 border-slate-200">
                        <tr>
                          <th className="p-3 w-12 text-center">#</th>
                          <th className="p-3 min-w-[200px]">Từ khóa Part</th>
                          <th className="p-3 w-28 text-center">Phân loại</th>
                          <th className="p-3 w-24 text-right">Relevance</th>
                          <th className="p-3 w-32 text-right font-black text-indigo-700">Search Volume</th>
                          <th className="p-3 w-24 text-right">Rank Organic</th>
                          <th className="p-3 w-20 text-right">CPC ($)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {currentPart.keywords.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition group">
                            <td className="p-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="p-3 font-bold text-slate-900">
                              {item.keyword}
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                  item.type === "PRODUCT"
                                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                                    : item.type === "GIFT"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : item.type === "EVENT"
                                    ? "bg-amber-50 text-amber-700 border border-amber-200"
                                    : "bg-purple-50 text-purple-700 border border-purple-200"
                                }`}
                              >
                                {item.type}
                              </span>
                            </td>
                            <td className="p-3 text-right font-mono font-black text-emerald-700">
                              {item.relevance}%
                            </td>
                            <td className="p-3 text-right font-mono font-black text-indigo-700">
                              {typeof item.search_volume === "number" && item.search_volume > 0
                                ? item.search_volume.toLocaleString()
                                : "—"}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-700 font-semibold">
                              {item.organic_rank ? `#${item.organic_rank}` : "—"}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-600">
                              {item.cpc ? `$${item.cpc.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* Settings Modal */}
      <SellerSpriteSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
