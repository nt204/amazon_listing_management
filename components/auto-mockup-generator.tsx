"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  SparkleIcon,
  SpinnerIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  ImageSquareIcon,
  RulerIcon,
  KanbanIcon,
  ArrowSquareOutIcon,
  CheckSquareIcon,
  SquareIcon,
  XIcon,
  LightningIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  StopIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { parseCardDimensions, type Dimensions3D } from "@/lib/trello";
import { downloadOriginalTrelloImage } from "@/lib/trello-image-client";

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    mimeType: string;
    previewUrl?: string;
  }>;
  parsed?: {
    sku: string;
    itemName: string;
  };
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface AutoMockupGeneratorProps {
  apiKey: string;
  token: string;
  boardId: string;
}

type GenerationStepStatus = "pending" | "processing" | "success" | "error";

interface MockupGenerationResponse {
  success: boolean;
  sku: string;
  model: string;
  generatedMockupsCount: number;
  movedToTargetList: boolean;
  attachments: Array<{
    index: number;
    status: "success" | "failed";
    error?: string;
  }>;
}

type MockupStreamEvent =
  | {
      type: "progress";
      step: number;
      status: "processing" | "success" | "error";
      message: string;
      attachmentUrl?: string;
      attachmentId?: string;
      name?: string;
    }
  | { type: "complete"; data: MockupGenerationResponse }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

const MOCKUP_STEPS = [
  { id: 1, label: "Mockup 1: Full Design (Ảnh Gốc Đầu Vào)", icon: "🖼️" },
  { id: 2, label: "Mockup 2: Dimension Infographic (Đo 3 chiều)", icon: "📐" },
  { id: 3, label: "Mockup 3: Luxury Gift Box (Nằm Trên Hộp Quà)", icon: "🎁" },
  {
    id: 4,
    label: "Mockup 4: Christmas Tree View 1 (Treo Cây Thông 1)",
    icon: "🎄",
  },
  {
    id: 5,
    label: "Mockup 5: Christmas Tree View 2 (Treo Cây Thông 2)",
    icon: "❄️",
  },
  {
    id: 6,
    label: "Mockup 6: Gifting Handshake (Đưa Tay Tặng Quà)",
    icon: "🤝",
  },
  {
    id: 7,
    label: "Mockup 7: Car Rearview Mirror (Treo Kính Ô Tô)",
    icon: "🚗",
  },
];

export function AutoMockupGenerator({
  apiKey,
  token,
  boardId,
}: AutoMockupGeneratorProps) {
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [designListId, setDesignListId] = useState<string>("");
  const [mockupListId, setMockupListId] = useState<string>("");

  const [designCards, setDesignCards] = useState<TrelloCard[]>([]);
  const [mockupCards, setMockupCards] = useState<TrelloCard[]>([]);

  const [selectedModel, setSelectedModel] = useState<string>("gpt-image-2");
  const [selectedQuality, setSelectedQuality] = useState<
    "low" | "medium" | "high"
  >("high");
  const [loadingLists, setLoadingLists] = useState<boolean>(false);
  const [loadingCards, setLoadingCards] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set(),
  );
  const [activeGeneratingCardId, setActiveGeneratingCardId] = useState<
    string | null
  >(null);
  const [batchProcessing, setBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });

  const [generationProgress, setGenerationProgress] = useState<
    Record<number, GenerationStepStatus>
  >({});
  const [generationStatusText, setGenerationStatusText] = useState<string>("");
  const [generationResult, setGenerationResult] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [downloadingImage, setDownloadingImage] = useState(false);

  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [draggedFromColumn, setDraggedFromColumn] = useState<"design" | "mockup" | null>(null);

  const moveCardToList = async (cardId: string, targetListId: string) => {
    try {
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move-card",
          apiKey,
          token,
          cardId,
          idList: targetListId,
        }),
      });
      if (res.ok) {
        void syncAllColumns();
      }
    } catch (err) {
      console.error("Lỗi chuyển thẻ Trello:", err);
    }
  };

  // Load Lists
  useEffect(() => {
    if (!apiKey || !token || !boardId) return;

    async function loadLists() {
      setLoadingLists(true);
      setErrorMsg("");
      try {
        const res = await fetch(
          `/api/trello/config?action=get-lists&apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&boardId=${encodeURIComponent(boardId)}`,
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const loadedLists: TrelloList[] = data.lists || [];
        setLists(loadedLists);

        // Find or default DESIGN list
        const dList = loadedLists.find(
          (l) =>
            l.name.trim().toUpperCase() === "DESIGN" ||
            l.name.toLowerCase().includes("design"),
        );
        if (dList) {
          setDesignListId(dList.id);
        } else if (loadedLists.length > 0) {
          setDesignListId(loadedLists[0].id);
        }

        // Find or default MOCKUP list (e.g. MOCKUP or TEAM DUYỆT NỘI BỘ)
        const mList = loadedLists.find(
          (l) =>
            l.name.trim().toUpperCase() === "MOCKUP" ||
            l.name.toLowerCase().includes("mockup") ||
            l.name.toLowerCase().includes("duyệt nội bộ"),
        );
        if (mList) {
          setMockupListId(mList.id);
        } else if (loadedLists.length > 1) {
          setMockupListId(loadedLists[1].id);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(`Không thể tải danh sách cột Trello: ${msg}`);
      } finally {
        setLoadingLists(false);
      }
    }

    loadLists();
  }, [apiKey, token, boardId]);

  // Sync / Reload Cards from both DESIGN and MOCKUP columns on Trello
  const syncAllColumns = useCallback(async () => {
    if (!apiKey || !token) return;
    setLoadingCards(true);
    setErrorMsg("");
    try {
      // 1. Fetch DESIGN list cards
      if (designListId) {
        const resD = await fetch(
          `/api/trello/config?action=get-cards&apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&listId=${encodeURIComponent(designListId)}`,
        );
        if (resD.ok) {
          const dataD = await resD.json();
          setDesignCards(dataD.cards || []);
        }
      }

      // 2. Fetch MOCKUP list cards
      if (mockupListId) {
        const resM = await fetch(
          `/api/trello/config?action=get-cards&apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&listId=${encodeURIComponent(mockupListId)}`,
        );
        if (resM.ok) {
          const dataM = await resM.json();
          setMockupCards(dataM.cards || []);
        }
      }

      setSelectedCardIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Không thể làm mới đồng bộ Trello: ${msg}`);
    } finally {
      setLoadingCards(false);
    }
  }, [apiKey, token, designListId, mockupListId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void syncAllColumns();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [syncAllColumns]);

  const toggleSelectCard = (cardId: string) => {
    const next = new Set(selectedCardIds);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      next.add(cardId);
    }
    setSelectedCardIds(next);
  };

  const toggleSelectAllDesign = () => {
    if (selectedCardIds.size === designCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(designCards.map((c) => c.id)));
    }
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const isAbortingRef = useRef<boolean>(false);

  const cancelGeneration = async () => {
    isAbortingRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setBatchProcessing(false);
    setActiveGeneratingCardId(null);
    setGenerationStatusText("Đã dừng tạo mockup. Tất cả ảnh đã đính kèm trước đó đều được lưu giữ trên Trello.");
    await syncAllColumns();
  };

  const handleGenerateMockupsSingle = async (card: TrelloCard) => {
    setActiveGeneratingCardId(card.id);
    setGenerationResult(null);
    setErrorMsg("");
    setGenerationStatusText("Đang chuẩn bị ảnh thiết kế...");

    // Immediately move card from DESIGN column to MOCKUP column in local UI state!
    setDesignCards((prev) => prev.filter((c) => c.id !== card.id));
    setMockupCards((prev) => {
      if (prev.some((c) => c.id === card.id)) return prev;
      return [{ ...card, idList: mockupListId }, ...prev];
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const initialProgress: Record<number, GenerationStepStatus> = {};
    MOCKUP_STEPS.forEach((step) => {
      initialProgress[step.id] = "pending";
    });
    setGenerationProgress(initialProgress);

    try {
      const res = await fetch("/api/trello/generate-mockups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          cardId: card.id,
          targetListId: mockupListId, // Automatically move card on Trello to MOCKUP list!
          apiKey,
          token,
          model: selectedModel,
          quality: selectedQuality,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Lỗi HTTP ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Server không trả về luồng tiến độ tạo ảnh.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const streamResult: { data: MockupGenerationResponse | null } = {
        data: null,
      };

      const handleEvent = (event: MockupStreamEvent) => {
        if (event.type === "progress") {
          setGenerationStatusText(event.message);
          setGenerationProgress((previous) => ({
            ...previous,
            [event.step]: event.status,
          }));

          // When an image is ready & attached on Trello, display it on the MOCKUP card real-time!
          if (event.status === "success" && event.attachmentUrl) {
            const newAtt = {
              id: event.attachmentId || String(Date.now()),
              name: event.name || `Mockup ${event.step}`,
              url: event.attachmentUrl,
              mimeType: "image/png",
            };
            setMockupCards((prev) =>
              prev.map((c) => {
                if (c.id !== card.id) return c;
                const existingAtts = c.attachments || [];
                if (existingAtts.some((a) => a.url === newAtt.url || a.id === newAtt.id)) {
                  return c;
                }
                return {
                  ...c,
                  attachments: [...existingAtts, newAtt],
                };
              }),
            );
            setPreviewImage({
              url: event.attachmentUrl,
              name: event.name || `Mockup ${event.step}`,
            });
          }
        } else if (event.type === "complete") {
          streamResult.data = event.data;
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      };

      while (true) {
        if (isAbortingRef.current) break;
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        const lines = buffered.split("\n");
        buffered = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) handleEvent(JSON.parse(line) as MockupStreamEvent);
        }
        if (done) break;
      }

      if (isAbortingRef.current) {
        await syncAllColumns();
        setGenerationStatusText("Đã dừng tạo mockup. Ảnh đã tạo thành công đều được giữ trên Trello.");
        return;
      }

      if (buffered.trim())
        handleEvent(JSON.parse(buffered) as MockupStreamEvent);
      const data = streamResult.data;
      if (!data)
        throw new Error("Luồng tạo ảnh kết thúc nhưng không có kết quả.");

      const finalProgress: Record<number, GenerationStepStatus> = {};
      MOCKUP_STEPS.forEach((step) => {
        const attachment = data?.attachments.find(
          (item) => item.index === step.id,
        );
        finalProgress[step.id] =
          attachment?.status === "success" ? "success" : "error";
      });
      setGenerationProgress(finalProgress);

      const failedUploads = data.attachments.filter(
        (attachment) => attachment.status === "failed",
      );
      if (failedUploads.length > 0) {
        setGenerationStatusText(
          `Hoàn tất tạo ảnh nhưng ${failedUploads.length} ảnh upload thất bại.`,
        );
        setErrorMsg(
          `Đã tạo đủ ảnh nhưng ${failedUploads.length}/7 ảnh không tải được lên Trello. Thẻ vẫn ở cột DESIGN để bạn thử lại.`,
        );
      } else {
        setGenerationStatusText("Đã hoàn tất 1 ảnh gốc + 6 ảnh mockup AI.");
        setGenerationResult(
          `🎉 Đã giữ 1 ảnh gốc và tạo ${data.generatedMockupsCount || 6} ảnh mockup cho SKU "${data.sku}" — tổng cộng 7 ảnh${data.movedToTargetList ? " — rồi chuyển thẻ sang cột MOCKUP" : ""}!`,
        );
      }
      await syncAllColumns();
    } catch (err: unknown) {
      if (isAbortingRef.current || (err instanceof Error && err.name === "AbortError")) {
        await syncAllColumns();
        setGenerationStatusText("Đã dừng tạo mockup. Các ảnh đã tạo thành công trước đó được lưu giữ đầy đủ.");
        setErrorMsg("");
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setGenerationProgress((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          if (next[Number(k)] === "processing") {
            next[Number(k)] = "error";
          }
        });
        return next;
      });
      await syncAllColumns();
      setErrorMsg(`Lỗi khi tạo Mockup: ${msg}`);
      setGenerationStatusText(msg);
    } finally {
      setActiveGeneratingCardId(null);
      abortControllerRef.current = null;
    }
  };

  const handleBatchGenerateMockups = async () => {
    if (selectedCardIds.size === 0) return;
    setBatchProcessing(true);
    isAbortingRef.current = false;
    const selectedCards = designCards.filter((c) => selectedCardIds.has(c.id));
    setBatchProgress({ current: 0, total: selectedCards.length });

    for (let index = 0; index < selectedCards.length; index++) {
      if (isAbortingRef.current) break;
      const card = selectedCards[index];
      setBatchProgress({ current: index + 1, total: selectedCards.length });
      await handleGenerateMockupsSingle(card);
    }

    setBatchProcessing(false);
    setSelectedCardIds(new Set());
    await syncAllColumns();
  };

  return (
    <div className="space-y-6 text-slate-800 font-sans">
      {/* Lightbox Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-xs">
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl bg-white p-2 shadow-2xl">
            <button
              onClick={async () => {
                setDownloadingImage(true);
                try {
                  await downloadOriginalTrelloImage({ ...previewImage, apiKey, token });
                } catch (error) {
                  setErrorMsg(error instanceof Error ? error.message : "Không thể tải ảnh gốc.");
                } finally {
                  setDownloadingImage(false);
                }
              }}
              disabled={downloadingImage}
              className="absolute right-16 top-4 flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              title="Tải đúng file ảnh gốc, không nén lại"
            >
              {downloadingImage ? (
                <SpinnerIcon className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadSimpleIcon className="h-4 w-4" />
              )}
              Tải ảnh gốc
            </button>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black transition"
            >
              <XIcon className="h-5 w-5" />
            </button>
            <img
              src={previewImage.url}
              alt="Mockup Preview"
              className="max-h-[85vh] w-auto rounded-xl object-contain"
            />
          </div>
        </div>
      )}

      {/* Floating Multi-Select Batch Action Bar */}
      {selectedCardIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between rounded-2xl border border-indigo-300 bg-indigo-600 px-6 py-3 text-white shadow-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-indigo-700 shadow-xs">
              {selectedCardIds.size}
            </span>
            <span className="text-xs font-bold">
              Thẻ DESIGN đã chọn để sinh Mockups
            </span>
            {batchProcessing && (
              <span className="text-xs font-semibold text-indigo-100">
                (Đang xử lý {batchProgress.current}/{batchProgress.total}{" "}
                thẻ...)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCardIds(new Set())}
              disabled={batchProcessing}
              className="text-xs text-indigo-100 hover:text-white underline disabled:opacity-50"
            >
              Bỏ chọn tất cả
            </button>
            {batchProcessing ? (
              <button
                type="button"
                onClick={() => void cancelGeneration()}
                className="flex items-center gap-1.5 rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-600 transition"
              >
                <StopIcon className="h-4 w-4 fill-current" />
                <span>Hủy Batch & Lưu Kết Quả</span>
              </button>
            ) : (
              <button
                onClick={handleBatchGenerateMockups}
                disabled={batchProcessing}
                className="flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 shadow hover:bg-amber-300 transition disabled:opacity-50"
              >
                <SparkleIcon className="h-4 w-4 fill-current text-slate-900" />
                <span>
                  ⚡ Batch: 1 ảnh gốc + 6 mockup AI ({selectedCardIds.size}{" "}
                  thẻ)
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Controls Header Bar */}
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-purple-50/60 to-pink-50/80 p-5 shadow-xs">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20 shrink-0">
              <SparkleIcon className="h-6 w-6 text-amber-300" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-slate-900">
                  Auto Mockup Generator (DESIGN ➔ MOCKUP)
                </h3>
                <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-800 border border-indigo-200">
                  2 Cột Trello Đồng Bộ
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* AI Model Selector */}
            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 shadow-2xs">
              <SparkleIcon className="h-4 w-4 text-purple-600 shrink-0" />
              <span className="text-xs font-bold text-slate-600">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-xs font-extrabold text-slate-900 outline-none cursor-pointer pr-1"
              >
                <option value="gpt-image-2">
                  🤖 GPT Image 2 (Mặc định)
                </option>
                <option value="gpt-image-1.5">
                  🤖 GPT Image 1.5 (Legacy)
                </option>
                <option value="gemini-3.1-flash-image">
                  🎨 Gemini 3.1 Flash Image
                </option>
                <option value="gemini-3-pro-image">
                  🎨 Gemini 3 Pro Image
                </option>
                <option value="fast-graphic">
                  ⚡ Fast Graphic Engine
                </option>
              </select>
            </div>

            {(selectedModel === "gpt-image-2" || selectedModel === "gpt-image-1.5") && (
              <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 shadow-2xs">
                <span className="text-xs font-bold text-slate-600">Chất lượng:</span>
                <select
                  value={selectedQuality}
                  onChange={(event) =>
                    setSelectedQuality(
                      event.target.value as "low" | "medium" | "high",
                    )
                  }
                  className="bg-transparent text-xs font-extrabold text-slate-900 outline-none cursor-pointer pr-1"
                >
                  <option value="low">Nhanh / bản nháp</option>
                  <option value="medium">Cân bằng</option>
                  <option value="high">Cao / bản cuối</option>
                </select>
              </div>
            )}

            {/* Sync / Refresh Button */}
            <button
              onClick={syncAllColumns}
              disabled={loadingCards || loadingLists}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <ArrowsClockwiseIcon
                className={`h-4 w-4 ${loadingCards ? "animate-spin" : ""}`}
              />
              <span>Làm Mới Đồng Bộ</span>
            </button>
          </div>
        </div>

        {/* Trello Lists Selectors Row */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-indigo-100/80 pt-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <KanbanIcon className="h-4 w-4 text-amber-600" /> Cột Nguồn:
            </span>
            <select
              value={designListId}
              onChange={(e) => setDesignListId(e.target.value)}
              disabled={loadingLists}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-800 outline-none cursor-pointer shadow-2xs"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <ArrowRightIcon className="h-4 w-4 text-slate-400" />

          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <KanbanIcon className="h-4 w-4 text-emerald-600" /> Cột Đích:
            </span>
            <select
              value={mockupListId}
              onChange={(e) => setMockupListId(e.target.value)}
              disabled={loadingLists}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-800 outline-none cursor-pointer shadow-2xs"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-700">
          <WarningCircleIcon className="h-4 w-4 shrink-0 text-rose-500" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 2-Column Kanban Layout */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* COLUMN 1: CỘT DESIGN (50% Width) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const cardId = e.dataTransfer.getData("text/plain") || draggedCardId;
            if (cardId && draggedFromColumn === "mockup" && designListId) {
              void moveCardToList(cardId, designListId);
            }
            setDraggedCardId(null);
            setDraggedFromColumn(null);
          }}
          className={`flex w-full md:w-1/2 flex-col rounded-2xl border p-5 shadow-sm space-y-4 transition ${
            draggedFromColumn === "mockup"
              ? "border-amber-400 bg-amber-50/20 ring-4 ring-amber-400/20"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <button
                onClick={toggleSelectAllDesign}
                className="text-slate-400 hover:text-indigo-600 transition"
                title="Chọn / Bỏ chọn tất cả"
              >
                {selectedCardIds.size > 0 &&
                selectedCardIds.size === designCards.length ? (
                  <CheckSquareIcon
                    className="h-5 w-5 text-indigo-600"
                    weight="fill"
                  />
                ) : (
                  <SquareIcon className="h-5 w-5" />
                )}
              </button>
              <span className="h-3.5 w-3.5 rounded-full bg-amber-500 shadow-xs"></span>
              <h4 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
                DESIGN
              </h4>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
                {designCards.length} thẻ
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {designCards.length === 0 && !loadingCards ? (
              <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <CheckCircleIcon className="h-10 w-10 text-emerald-400" />
                <p className="mt-2 text-xs font-bold text-slate-700">
                  Không còn thẻ nào trong cột DESIGN!
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Tất cả thẻ thiết kế đều đã được tạo Mockup và chuyển sang cột
                  MOCKUP.
                </p>
              </div>
            ) : (
              designCards.map((card) => {
                const dims: Dimensions3D = parseCardDimensions(card.desc || "");
                const isSelected = selectedCardIds.has(card.id);
                const isGenerating = activeGeneratingCardId === card.id;
                const imageAttachments = card.attachments || [];

                return (
                  <div
                    key={card.id}
                    draggable={!loadingCards && !batchProcessing && !isGenerating}
                    onDragStart={(e) => {
                      setDraggedCardId(card.id);
                      setDraggedFromColumn("design");
                      e.dataTransfer.setData("text/plain", card.id);
                    }}
                    onDragEnd={() => {
                      setDraggedCardId(null);
                      setDraggedFromColumn(null);
                    }}
                    className={`group rounded-2xl border p-4 transition shadow-xs hover:shadow-md cursor-grab active:cursor-grabbing ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-400/20"
                        : "border-slate-200 bg-white hover:border-indigo-300"
                    } ${isGenerating ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <button
                        onClick={() => toggleSelectCard(card.id)}
                        className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition"
                      >
                        {isSelected ? (
                          <CheckSquareIcon
                            className="h-5 w-5 text-indigo-600"
                            weight="fill"
                          />
                        ) : (
                          <SquareIcon className="h-5 w-5" />
                        )}
                      </button>

                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-extrabold text-amber-800 border border-amber-200 font-mono">
                            SKU: {card.parsed?.sku || "SKU DESIGN"}
                          </span>
                          <a
                            href={card.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-400 hover:text-indigo-600 transition"
                            title="Xem thẻ trên Trello"
                          >
                            <ArrowSquareOutIcon className="h-5 w-5" />
                          </a>
                        </div>
                        <h5 className="mt-1.5 text-base font-extrabold text-slate-900 line-clamp-1">
                          {card.parsed?.itemName || card.name}
                        </h5>
                      </div>
                    </div>

                    <div className="mb-3 flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 p-2.5 text-xs text-slate-700 font-mono">
                      <RulerIcon className="h-4 w-4 text-indigo-600 shrink-0" />
                      <span>
                        Kích thước 3D:{" "}
                        <strong className="text-slate-900 font-bold">
                          {dims.formatted}
                        </strong>
                      </span>
                    </div>

                    {/* Artwork Preview */}
                    <div className="mb-4 space-y-1.5">
                      <div className="text-xs font-bold text-slate-600">
                        Ảnh thiết kế gốc ({imageAttachments.length}):
                      </div>
                      {imageAttachments.length > 0 ? (
                        <div className="flex flex-wrap gap-2 overflow-x-auto py-1">
                          {imageAttachments.map((att) => (
                            <div
                              key={att.id}
                              onClick={() => setPreviewImage({ url: att.url, name: att.name })}
                              className="group relative h-16 w-16 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-xs hover:border-indigo-500 hover:shadow-md transition shrink-0"
                            >
                              <img
                                src={att.previewUrl || att.url}
                                alt={att.name}
                                className="h-full w-full object-cover transition group-hover:scale-105"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 italic bg-slate-50 p-2 rounded-lg text-center">
                          Chưa có ảnh đính kèm.
                        </div>
                      )}
                    </div>

                    {isGenerating ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white shadow-md">
                          <SpinnerIcon className="h-4 w-4 animate-spin text-white shrink-0" />
                          <span className="truncate">Đang tạo mockup...</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void cancelGeneration()}
                          className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white shadow-md hover:bg-rose-700 active:scale-[0.98] transition shrink-0"
                          title="Dừng tạo mockup & lưu các ảnh đã đính kèm"
                        >
                          <StopIcon className="h-4 w-4 fill-current" />
                          <span>Hủy & Lưu</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleGenerateMockupsSingle(card)}
                        disabled={Boolean(activeGeneratingCardId) || batchProcessing}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 transition"
                      >
                        <SparkleIcon className="h-4.5 w-4.5 text-amber-300" />
                        <span>⚡ Tạo 6 Mockups AI + 1 Ảnh Gốc</span>
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUMN 2: CỘT MOCKUP (50% Width) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const cardId = e.dataTransfer.getData("text/plain") || draggedCardId;
            if (cardId && draggedFromColumn === "design") {
              const cardToProcess = designCards.find((c) => c.id === cardId);
              if (cardToProcess) {
                void handleGenerateMockupsSingle(cardToProcess);
              }
            }
            setDraggedCardId(null);
            setDraggedFromColumn(null);
          }}
          className={`flex w-full md:w-1/2 flex-col rounded-2xl border p-5 shadow-sm space-y-4 transition ${
            draggedFromColumn === "design"
              ? "border-emerald-400 bg-emerald-50/20 ring-4 ring-emerald-400/20"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 shadow-xs"></span>
              <h4 className="text-base font-black text-slate-900 uppercase tracking-wide">
                MOCKUP
              </h4>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-extrabold text-emerald-700 border border-emerald-200">
                {mockupCards.length} thẻ
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {mockupCards.length === 0 && !loadingCards ? (
              <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <ImageSquareIcon className="h-10 w-10 text-slate-300" />
                <p className="text-xs font-bold text-slate-500 mt-2">
                  Chưa có thẻ nào trong cột MOCKUP
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Bấm nút “Tạo 6 Mockups AI + 1 Ảnh Gốc” hoặc kéo thẻ từ cột DESIGN thả vào đây.
                </p>
              </div>
            ) : (
              mockupCards.map((card) => {
                const dims: Dimensions3D = parseCardDimensions(card.desc || "");
                const isGenerating = activeGeneratingCardId === card.id;
                const imageAttachments = card.attachments || [];

                return (
                  <div
                    key={card.id}
                    draggable={!loadingCards && !batchProcessing && !isGenerating}
                    onDragStart={(e) => {
                      setDraggedCardId(card.id);
                      setDraggedFromColumn("mockup");
                      e.dataTransfer.setData("text/plain", card.id);
                    }}
                    onDragEnd={() => {
                      setDraggedCardId(null);
                      setDraggedFromColumn(null);
                    }}
                    className="group rounded-2xl border border-slate-200 bg-emerald-50/20 p-4 transition shadow-xs hover:shadow-md hover:border-emerald-300 cursor-grab active:cursor-grabbing"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-emerald-800 border border-emerald-200 font-mono">
                            SKU: {card.parsed?.sku || "SKU DESIGN"}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                            <CheckCircleIcon className="h-4 w-4 text-emerald-600" />{" "}
                            {imageAttachments.length} Ảnh Đính Kèm
                          </span>
                        </div>
                        <h5 className="mt-1.5 text-base font-extrabold text-slate-900 line-clamp-1">
                          {card.parsed?.itemName || card.name}
                        </h5>
                      </div>
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-400 hover:text-emerald-600 transition"
                        title="Xem thẻ trên Trello"
                      >
                        <ArrowSquareOutIcon className="h-5 w-5" />
                      </a>
                    </div>

                    <div className="mb-3 flex items-center gap-2 rounded-xl bg-white border border-slate-200/80 p-2.5 text-xs text-slate-700 font-mono">
                      <RulerIcon className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>
                        Kích thước 3D:{" "}
                        <strong className="text-slate-900">
                          {dims.formatted}
                        </strong>
                      </span>
                    </div>

                    {/* Seven attachments: one original design plus six AI mockups. */}
                    <div className="mb-4 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-600 flex items-center justify-between">
                        <span>
                          Bộ Ảnh Mockup Đính Kèm Trello (
                          {imageAttachments.length}):
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 overflow-x-auto py-1">
                        {imageAttachments.map((att, idx) => (
                          <div
                            key={att.id}
                            onClick={() => setPreviewImage({ url: att.url, name: att.name })}
                            className="group relative h-16 w-16 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs hover:border-emerald-500 hover:shadow-md transition shrink-0"
                            title={`Mockup ${idx + 1}: ${att.name}`}
                          >
                            <img
                              src={att.previewUrl || att.url}
                              alt={att.name}
                              className="h-full w-full object-cover transition group-hover:scale-105"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleGenerateMockupsSingle(card)}
                      disabled={isGenerating}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-slate-900 active:scale-[0.98] disabled:opacity-50 transition"
                    >
                      {isGenerating ? (
                        <>
                          <SpinnerIcon className="h-4 w-4 animate-spin text-white" />
                          Đang cập nhật...
                        </>
                      ) : (
                        <>
                          <LightningIcon className="h-4 w-4 text-amber-400" />
                          <span>Tạo Lại 6 Mockups AI + Giữ 1 Ảnh Gốc</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Realtime Progress Tracker Modal */}
      {activeGeneratingCardId && (
        <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <SparkleIcon className="h-4 w-4 text-indigo-600" /> Tiến Trình: 1
              Ảnh Gốc + 6 Mockups AI
            </h4>
            <button
              onClick={() => setActiveGeneratingCardId(null)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 transition"
            >
              Đóng
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {MOCKUP_STEPS.map((step) => {
              const status = generationProgress[step.id] || "pending";
              return (
                <div
                  key={step.id}
                  className={`flex items-center justify-between rounded-xl p-3 text-xs font-medium border ${
                    status === "success"
                      ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                      : status === "processing"
                        ? "border-indigo-300 bg-indigo-50/90 text-indigo-900 animate-pulse"
                        : status === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-slate-100 bg-slate-50 text-slate-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{step.icon}</span>
                    <span>{step.label}</span>
                  </div>

                  <div>
                    {status === "success" && (
                      <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                    )}
                    {status === "processing" && (
                      <SpinnerIcon className="h-4 w-4 animate-spin text-indigo-600" />
                    )}
                    {status === "error" && (
                      <WarningCircleIcon className="h-4 w-4 text-rose-600" />
                    )}
                    {status === "pending" && (
                      <span className="text-[10px] text-slate-400">Chờ...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {generationStatusText && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-2.5 text-xs font-semibold text-indigo-800">
              {generationStatusText}
            </div>
          )}

          {generationResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5 text-emerald-600 shrink-0" />
              <span>{generationResult}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
