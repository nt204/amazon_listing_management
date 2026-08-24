"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type SyntheticEvent,
} from "react";
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
  PencilIcon,
  TrashIcon,
  GearIcon,
  PlusIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  EyeIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretDownIcon,
  CopyIcon,
  CheckIcon,
  ArrowCounterClockwiseIcon,
  FloppyDiskIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { parseCardDimensions, type Dimensions3D } from "@/lib/trello";
import { downloadOriginalTrelloImage } from "@/lib/trello-image-client";
import {
  MAX_AI_MOCKUPS_PER_PRODUCT,
  limitSelectedMockupContents,
  mockupIndexFromAttachmentName,
  sortMockupAttachments,
  type MockupModel,
} from "@/lib/mockup-types";
import {
  getAllPresets,
  fetchPresetsFromServer,
  savePresetToServer,
} from "@/lib/mockup-preset-store";
import { ProductPresetModal } from "@/components/product-preset-modal";
import type { ProductCategoryPreset } from "@/types/mockup-preset";

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
    thumbnailUrl?: string;
  }>;
  parsed?: {
    sku: string;
    itemName: string;
  };
}

type TrelloCardAttachment = NonNullable<TrelloCard["attachments"]>[number];

const IMAGE_ATTACHMENT_PATTERN = /\.(png|jpe?g|webp)(?:$|[?#])/i;

function isImageAttachment(attachment: TrelloCardAttachment) {
  return Boolean(
    attachment.mimeType?.startsWith("image/") ||
      IMAGE_ATTACHMENT_PATTERN.test(attachment.name || "") ||
      IMAGE_ATTACHMENT_PATTERN.test(attachment.url || ""),
  );
}

function findOriginalDesignAttachment(card: TrelloCard) {
  const imageAttachments = (card.attachments || []).filter(isImageAttachment);
  return imageAttachments.find(
    (attachment) => mockupIndexFromAttachmentName(attachment.name) === null,
  );
}

interface AutoMockupGeneratorProps {
  boardId: string;
  sourceListId: string;
  sourceListName: string;
  targetListId: string;
  targetListName: string;
}

type GenerationStepStatus =
  | "pending"
  | "processing"
  | "uploading"
  | "success"
  | "error";

interface MockupGenerationResponse {
  success: boolean;
  sku: string;
  model: string;
  quality: "low" | "medium" | "high" | null;
  generatedMockupsCount: number;
  newlyGeneratedMockupsCount: number;
  requestedMockupsCount: number;
  providerResponseCount: number;
  providerResponses: Array<{
    provider: "openai" | "cheapkeyai";
    requestId: string | null;
    model: string;
    quality: "low" | "medium" | "high";
    size: string;
    imageCount: 1;
    inputFidelity: "low" | "high" | null;
    estimatedCostUsd: number | null;
    usage: {
      inputTokens: number;
      inputImageTokens: number;
      inputTextTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null;
  }>;
  movedToTargetList: boolean;
  attachments: Array<{
    index: number;
    status: "success" | "failed";
    previewUrl?: string;
    thumbnailUrl?: string;
    error?: string;
  }>;
}

interface MockupCompletionNotice {
  type: "success" | "warning" | "error";
  title: string;
  message: string;
}

interface MockupGenerationSummary {
  status: "success" | "partial" | "failed" | "cancelled";
  sku: string;
  completed: number;
  requested: number;
}

interface SingleMockupRegenerationJob {
  statusText: string;
}

interface MockupBackgroundJob {
  id: string;
  cardId: string;
  status: "queued" | "running" | "cancel_requested" | "cancelled";
  request?: {
    selectedSteps?: number[];
    forceRegenerate?: boolean;
  };
  progress?: {
    message?: string;
    step?: number;
  };
}

interface ImagePromptEditorState {
  original: string;
  draft: string;
  loading: boolean;
  error?: string;
}

function singleMockupRegenerationKey(cardId: string, stepId: number) {
  return `${cardId}:${stepId}`;
}

function imagePromptEditorKey(
  cardId: string,
  stepId: number,
  presetId: string,
) {
  return `${cardId}:${presetId}:${stepId}`;
}

type MockupStreamEvent =
  | {
    type: "progress";
    step: number;
    status: "processing" | "success" | "error";
    phase: "generation" | "upload";
    message: string;
    attachmentUrl?: string;
    attachmentId?: string;
    name?: string;
    previewUrl?: string;
    thumbnailUrl?: string;
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
    label: "Mockup 5: Pine Branch & Bokeh (Treo Cành Thông & Đèn Bokeh)",
    icon: "🎄",
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
  {
    id: 8,
    label: "Mockup 8: Sunlit Glass Refraction (Thủy Tinh Chiếu Ánh Sáng Sunburst)",
    icon: "☀️",
  },
  {
    id: 9,
    label: "Mockup 9: Glass Edge Thickness Callout (Cận Cảnh Độ Dày Cạnh & Nền Lụa)",
    icon: "📐",
  },
  {
    id: 10,
    label: "Mockup 10: Wood Flat-Lay with Pine (Mặt Bàn Gỗ & Nhánh Thông)",
    icon: "🪵",
  },
];

const DEFAULT_MOCKUP_MODEL = "gpt-image-2-cheapkey";
const DEFAULT_MOCKUP_QUALITY = "low" as const;

export interface MockupContentItem {
  id: number;
  label: string;
  checked: boolean;
  promptKey?: string;
  customPrompt?: string;
}

const MOCKUP_CATEGORY_STORAGE_KEY = "listing_desk_mockup_category_v2";
const MOCKUP_CONTENTS_STORAGE_KEY = "listing_desk_mockup_contents_v7";

function fallBackToMasterImage(
  event: SyntheticEvent<HTMLImageElement>,
  masterUrl: string,
) {
  const image = event.currentTarget;
  if (image.dataset.masterFallback === "true") return;
  image.dataset.masterFallback = "true";
  image.src = masterUrl;
}

export function AutoMockupGenerator({
  boardId,
  sourceListId: designListId,
  sourceListName,
  targetListId: mockupListId,
  targetListName,
}: AutoMockupGeneratorProps) {
  const [designCards, setDesignCards] = useState<TrelloCard[]>([]);
  const [mockupCards, setMockupCards] = useState<TrelloCard[]>([]);

  const [selectedModel, setSelectedModel] = useState<MockupModel>(
    DEFAULT_MOCKUP_MODEL as MockupModel,
  );
  const [selectedQuality, setSelectedQuality] = useState<
    "low" | "medium" | "high"
  >(DEFAULT_MOCKUP_QUALITY);

  const [allPresets, setAllPresets] = useState<ProductCategoryPreset[]>(() => getAllPresets());
  const [selectedCategory, setSelectedCategory] = useState<string>(() => getAllPresets()[0]?.id || "");
  const [mockupContents, setMockupContents] = useState<MockupContentItem[]>(() => {
    const loaded = getAllPresets();
    return limitSelectedMockupContents(loaded[0]?.contents || []);
  });

  const [showAddContentModal, setShowAddContentModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showProductPresetModal, setShowProductPresetModal] = useState(false);
  const [newContentLabel, setNewContentLabel] = useState("");
  const [contentNoticeMsg, setContentNoticeMsg] = useState<string>("");
  const allPresetsRef = useRef(allPresets);
  const selectedCategoryRef = useRef(selectedCategory);

  useEffect(() => {
    allPresetsRef.current = allPresets;
  }, [allPresets]);

  useEffect(() => {
    selectedCategoryRef.current = selectedCategory;
  }, [selectedCategory]);

  const selectedAiMockupCount = mockupContents.filter(
    (content) => content.checked && content.id >= 2,
  ).length;

  useEffect(() => {
    for (const retiredId of ["universal_standard", "bullet_tumbler", "slate_plate"]) {
      localStorage.removeItem(`${MOCKUP_CONTENTS_STORAGE_KEY}_${retiredId}`);
    }
    const savedCategory = localStorage.getItem(MOCKUP_CATEGORY_STORAGE_KEY) || "";
    if (["universal_standard", "bullet_tumbler", "slate_plate"].includes(savedCategory)) {
      localStorage.removeItem(MOCKUP_CATEGORY_STORAGE_KEY);
      localStorage.removeItem(MOCKUP_CONTENTS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    // Fast Refresh preserves old React state. Reset once on mount so a page that
    // previously held GPT Image 2/high cannot silently keep the expensive pair.
    const resetId = window.setTimeout(() => {
      setSelectedModel(DEFAULT_MOCKUP_MODEL);
      setSelectedQuality(DEFAULT_MOCKUP_QUALITY);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshSharedPresets = async (applyActivePreset: boolean) => {
      const loaded = await fetchPresetsFromServer();
      if (disposed) return;
      const activeId =
        localStorage.getItem(MOCKUP_CATEGORY_STORAGE_KEY) ||
        selectedCategoryRef.current;
      const active = loaded.find((preset) => preset.id === activeId) || loaded[0];
      const previousActive = allPresetsRef.current.find(
        (preset) => preset.id === active?.id,
      );
      allPresetsRef.current = loaded;
      setAllPresets(loaded);
      if (
        active &&
        (applyActivePreset || previousActive?.revision !== active.revision)
      ) {
        setSelectedCategory(active.id);
        setMockupContents((current) =>
          limitSelectedMockupContents(
            active.contents.map((content) => ({
              ...content,
              checked:
                current.find((item) => item.id === content.id)?.checked ??
                content.checked,
            })),
          ),
        );
      } else if (!active) {
        setSelectedCategory("");
        setMockupContents([]);
        localStorage.removeItem(MOCKUP_CATEGORY_STORAGE_KEY);
        localStorage.removeItem(MOCKUP_CONTENTS_STORAGE_KEY);
      }
    };

    void refreshSharedPresets(true);
    const interval = window.setInterval(
      () => void refreshSharedPresets(false),
      10_000,
    );
    const refreshOnFocus = () => void refreshSharedPresets(false);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const saveContentsState = (
    updated: MockupContentItem[],
  ) => {
    if (!selectedCategory) return;
    const limited = limitSelectedMockupContents(updated);
    setMockupContents(limited);
    try {
      localStorage.setItem(MOCKUP_CATEGORY_STORAGE_KEY, selectedCategory);
      localStorage.setItem(`${MOCKUP_CONTENTS_STORAGE_KEY}_${selectedCategory}`, JSON.stringify(limited));
      localStorage.setItem(MOCKUP_CONTENTS_STORAGE_KEY, JSON.stringify(limited));
    } catch {
      // Ignore storage errors
    }
  };

  const handleSelectCategory = (catKey: string) => {
    setSelectedCategory(catKey);
    const found = allPresets.find((p) => p.id === catKey);
    const updated = limitSelectedMockupContents(
      found?.contents || [],
    );
    setMockupContents(updated);
    try {
      localStorage.setItem(MOCKUP_CATEGORY_STORAGE_KEY, catKey);
    } catch {
      // Ignore storage errors
    }
    if (found) {
      setContentNoticeMsg(`Đã chuyển sang mục "${found.label}" (${updated.length} Content mẫu).`);
    }
  };

  const toggleContentCheck = (id: number) => {
    // Content 1 is mandatory
    if (id === 1) {
      setContentNoticeMsg("Content 1 (Full Design gốc) là bắt buộc, không thể bỏ chọn.");
      return;
    }

    const currentItem = mockupContents.find((c) => c.id === id);
    const checkedAiCount = mockupContents.filter((c) => c.checked && c.id >= 2).length;

    if (
      currentItem &&
      !currentItem.checked &&
      checkedAiCount >= MAX_AI_MOCKUPS_PER_PRODUCT
    ) {
      setContentNoticeMsg(
        `Tối đa chỉ được chọn ${MAX_AI_MOCKUPS_PER_PRODUCT} option AI (tổng 7 Content gồm Content 1). Vui lòng bỏ chọn 1 option AI khác để chọn option này.`,
      );
      return;
    }

    setContentNoticeMsg("");
    const updated = mockupContents.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item,
    );
    saveContentsState(updated);
  };

  const resetToDefaultContents = () => {
    setContentNoticeMsg("");
    const active = allPresets.find((p) => p.id === selectedCategory) || allPresets[0];
    const defaultContents = active?.contents || [];
    saveContentsState(defaultContents);
  };

  const deselectAllAiContents = () => {
    setContentNoticeMsg("");
    const updated = mockupContents.map((item) => ({
      ...item,
      checked: item.id === 1,
    }));
    saveContentsState(updated);
  };

  const handleAddCustomContent = () => {
    if (!selectedCategory || !newContentLabel.trim()) return;
    const nextId =
      mockupContents.length > 0
        ? Math.max(...mockupContents.map((c) => c.id)) + 1
        : 1;
    const checkedAiCount = mockupContents.filter((c) => c.checked && c.id >= 2).length;
    const shouldCheck = checkedAiCount < MAX_AI_MOCKUPS_PER_PRODUCT;
    const updated = [
      ...mockupContents,
      {
        id: nextId,
        label: newContentLabel.trim().startsWith("Content")
          ? newContentLabel.trim()
          : `Content ${nextId}: ${newContentLabel.trim()}`,
        checked: shouldCheck,
      },
    ];
    saveContentsState(updated);
    setNewContentLabel("");
    setShowAddContentModal(false);
    setContentNoticeMsg(
      shouldCheck
        ? ""
        : `Đã thêm Content mới (chưa bật chọn do đã chọn tối đa ${MAX_AI_MOCKUPS_PER_PRODUCT}/${MAX_AI_MOCKUPS_PER_PRODUCT} option AI).`,
    );
  };

  const handleDeleteContent = (id: number) => {
    if (id === 1) {
      setContentNoticeMsg("Content 1 (Full Design gốc) là bắt buộc, không thể xóa.");
      return;
    }
    const updated = mockupContents.filter((item) => item.id !== id);
    saveContentsState(updated);
    setContentNoticeMsg("");
  };

  const handleResetToSystemDefaults = () => {
    const active = allPresets.find((p) => p.id === selectedCategory) || allPresets[0];
    const defaultContents = active?.contents || [];
    saveContentsState(defaultContents);
    setContentNoticeMsg(`Đã khôi phục danh sách Content của mục "${active?.label || selectedCategory}" về mặc định.`);
  };

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
  const [completionNotice, setCompletionNotice] = useState<MockupCompletionNotice | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<MockupBackgroundJob[]>([]);
  const [cancellingJobIds, setCancellingJobIds] = useState<Set<string>>(new Set());
  const previousBackgroundJobIdsRef = useRef<Set<string>>(new Set());

  const prepareBrowserNotification = useCallback(() => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "default"
    ) return;
    void Notification.requestPermission().catch(() => undefined);
  }, []);

  const showCompletionNotice = useCallback((notice: MockupCompletionNotice) => {
    setCompletionNotice(notice);

    if (
      typeof document !== "undefined" &&
      document.hidden &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      const notification = new Notification(notice.title, {
        body: notice.message,
        tag: "mockup-generation-complete",
      });
      window.setTimeout(() => notification.close(), 10_000);
    }
  }, []);

  useEffect(() => {
    if (!completionNotice) return;
    const timeoutId = window.setTimeout(() => setCompletionNotice(null), 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [completionNotice]);

  // Studio Lightbox & Side-by-Side Refinement Modal State
  const [studioModal, setStudioModal] = useState<{
    cardId: string;
    attachmentIndex: number;
    stepId?: number;
    attachmentId?: string;
  } | null>(null);
  const [regenPromptNote, setRegenPromptNote] = useState<string>("");
  const [regenModel, setRegenModel] = useState<MockupModel>(
    DEFAULT_MOCKUP_MODEL as MockupModel,
  );
  const [singleMockupRegenerationJobs, setSingleMockupRegenerationJobs] = useState<
    Record<string, SingleMockupRegenerationJob>
  >({});
  const [expandedImagePromptKey, setExpandedImagePromptKey] = useState<
    string | null
  >(null);
  const [imagePromptEditors, setImagePromptEditors] = useState<
    Record<string, ImagePromptEditorState>
  >({});
  const [copiedImagePromptKey, setCopiedImagePromptKey] = useState<
    string | null
  >(null);
  const [savingImagePromptKey, setSavingImagePromptKey] = useState<
    string | null
  >(null);
  const [downloadingImage, setDownloadingImage] = useState(false);

  // Approval status tracking: map of `${cardId}_${attachmentId}` => "approved" | "rejected" | "pending"
  const [approvalMap, setApprovalMap] = useState<
    Record<string, "approved" | "rejected" | "pending">
  >({});

  const allBoardCards = [...designCards, ...mockupCards];
  const backgroundJobCardIds = new Set(backgroundJobs.map((job) => job.cardId));
  const backgroundRegenerationKeys = new Set(
    backgroundJobs.flatMap((job) =>
      job.request?.forceRegenerate
        ? (job.request.selectedSteps || []).map((stepId) =>
            singleMockupRegenerationKey(job.cardId, stepId),
          )
        : [],
    ),
  );
  const activeStudioCard = allBoardCards.find((c) => c.id === studioModal?.cardId);
  const activeCardIndex = allBoardCards.findIndex((c) => c.id === studioModal?.cardId);

  // Keyboard navigation for Studio Modal (Left / Right Arrow) with Input Focus Guard
  useEffect(() => {
    if (!studioModal || !activeStudioCard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Do NOT trigger keyboard navigation if focus is inside an input, textarea, or select element
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const cardAtts = activeStudioCard.attachments || [];

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStudioModal((prev) => {
          if (!prev) return null;
          if (cardAtts.length > 1) {
            const nextIndex = (prev.attachmentIndex - 1 + cardAtts.length) % cardAtts.length;
            const nextAtt = cardAtts[nextIndex];
            const nextStep = nextAtt ? (mockupIndexFromAttachmentName(nextAtt.name) || (nextIndex === 0 ? 1 : undefined)) : undefined;
            return {
              cardId: prev.cardId,
              attachmentIndex: nextIndex,
              stepId: nextStep,
              attachmentId: nextAtt?.id,
            };
          }
          if (allBoardCards.length > 1) {
            const prevCardIdx = (activeCardIndex - 1 + allBoardCards.length) % allBoardCards.length;
            const firstAtt = allBoardCards[prevCardIdx].attachments?.[0];
            const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
            return { cardId: allBoardCards[prevCardIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id };
          }
          return prev;
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setStudioModal((prev) => {
          if (!prev) return null;
          if (cardAtts.length > 1) {
            const nextIndex = (prev.attachmentIndex + 1) % cardAtts.length;
            const nextAtt = cardAtts[nextIndex];
            const nextStep = nextAtt ? (mockupIndexFromAttachmentName(nextAtt.name) || (nextIndex === 0 ? 1 : undefined)) : undefined;
            return {
              cardId: prev.cardId,
              attachmentIndex: nextIndex,
              stepId: nextStep,
              attachmentId: nextAtt?.id,
            };
          }
          if (allBoardCards.length > 1) {
            const nextCardIdx = (activeCardIndex + 1) % allBoardCards.length;
            const firstAtt = allBoardCards[nextCardIdx].attachments?.[0];
            const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
            return { cardId: allBoardCards[nextCardIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id };
          }
          return prev;
        });
      } else if (e.key === "Escape") {
        setStudioModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [studioModal, activeStudioCard, activeCardIndex, allBoardCards]);

  const toggleApprovalStatus = (
    cardId: string,
    attachmentId: string,
    targetStatus: "approved" | "rejected",
  ) => {
    const key = `${cardId}_${attachmentId}`;
    setApprovalMap((prev) => ({
      ...prev,
      [key]: prev[key] === targetStatus ? "pending" : targetStatus,
    }));
  };

  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [draggedFromColumn, setDraggedFromColumn] = useState<"design" | "mockup" | null>(null);

  const moveCardToList = async (
    cardId: string,
    targetListId: string,
    pos: "top" | "bottom" = "top",
  ) => {
    // Optimistic UI update
    if (targetListId === mockupListId) {
      const movedCard = designCards.find((c) => c.id === cardId);
      if (movedCard) {
        setDesignCards((prev) => prev.filter((c) => c.id !== cardId));
        setMockupCards((prev) => [
          { ...movedCard, idList: targetListId },
          ...prev.filter((c) => c.id !== cardId),
        ]);
      }
    } else if (targetListId === designListId) {
      const movedCard = mockupCards.find((c) => c.id === cardId);
      if (movedCard) {
        setMockupCards((prev) => prev.filter((c) => c.id !== cardId));
        setDesignCards((prev) => [
          { ...movedCard, idList: targetListId },
          ...prev.filter((c) => c.id !== cardId),
        ]);
      }
    }

    try {
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move-card",
          cardId,
          idList: targetListId,
          pos,
        }),
      });
      if (res.ok) {
        void syncAllColumns();
      }
    } catch (err) {
      console.error("Lỗi chuyển thẻ Trello:", err);
    }
  };

  // Sync / Reload Cards from both DESIGN and MOCKUP columns on Trello
  const syncAllColumns = useCallback(async () => {
    if (!boardId || !designListId || !mockupListId) {
      setDesignCards([]);
      setMockupCards([]);
      return;
    }
    setLoadingCards(true);
    setErrorMsg("");
    try {
      const [designResult, mockupResult] = await Promise.all([
        designListId
          ? fetch(
              `/api/trello/config?action=get-cards&listId=${encodeURIComponent(designListId)}`,
            ).then(async (response) =>
              response.ok ? response.json() : null,
            )
          : null,
        mockupListId
          ? fetch(
              `/api/trello/config?action=get-cards&listId=${encodeURIComponent(mockupListId)}`,
            ).then(async (response) =>
              response.ok ? response.json() : null,
            )
          : null,
      ]);

      if (designResult) setDesignCards(designResult.cards || []);
      if (mockupResult) setMockupCards(mockupResult.cards || []);

      setSelectedCardIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Không thể làm mới đồng bộ Trello: ${msg}`);
    } finally {
      setLoadingCards(false);
    }
  }, [boardId, designListId, mockupListId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void syncAllColumns();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [syncAllColumns]);

  useEffect(() => {
    let disposed = false;
    const refreshBackgroundJobs = async () => {
      try {
        const response = await fetch(
          "/api/trello/mockup-jobs?status=active&limit=30",
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          jobs?: MockupBackgroundJob[];
        };
        if (disposed) return;
        const jobs = payload.jobs || [];
        const nextIds = new Set(jobs.map((job) => job.id));
        const hadCompletedJob = Array.from(
          previousBackgroundJobIdsRef.current,
        ).some((jobId) => !nextIds.has(jobId));
        previousBackgroundJobIdsRef.current = nextIds;
        setBackgroundJobs(jobs);
        if (hadCompletedJob) void syncAllColumns();
      } catch {
        // The board stays usable if queue status is briefly unavailable.
      }
    };

    void refreshBackgroundJobs();
    const interval = window.setInterval(
      () => void refreshBackgroundJobs(),
      3_000,
    );
    const refreshOnFocus = () => void refreshBackgroundJobs();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
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
  const activeGenerationJobIdRef = useRef<string | null>(null);
  const isAbortingRef = useRef<boolean>(false);
  const generationInFlightRef = useRef<boolean>(false);

  const cancelGeneration = async (requestedJobId?: string) => {
    const jobId = requestedJobId || activeGenerationJobIdRef.current;
    if (!jobId) {
      setErrorMsg("Chưa xác định được tác vụ Mockup cần dừng. Hãy tải lại trang rồi thử lại.");
      return;
    }

    const isForegroundJob = activeGenerationJobIdRef.current === jobId;
    setCancellingJobIds((current) => new Set(current).add(jobId));
    setErrorMsg("");
    setGenerationStatusText("Đang gửi yêu cầu dừng tác vụ Mockup...");

    try {
      const response = await fetch(
        `/api/trello/mockup-jobs/${encodeURIComponent(jobId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        job?: MockupBackgroundJob;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Không thể gửi yêu cầu dừng tác vụ Mockup.");
      }

      setBackgroundJobs((current) =>
        current.map((job) =>
          job.id === jobId
            ? {
                ...job,
                status: payload.job?.status || "cancel_requested",
                progress: {
                  ...job.progress,
                  message:
                    payload.job?.status === "cancelled"
                      ? "Đã dừng tác vụ Mockup."
                      : "Đã gửi yêu cầu dừng; worker đang ngắt kết nối tạo ảnh...",
                },
              }
            : job,
        ),
      );

      if (isForegroundJob) {
        isAbortingRef.current = true;
        abortControllerRef.current?.abort();
        setBatchProcessing(false);
        setActiveGeneratingCardId(null);
      }
      setGenerationStatusText(
        payload.job?.status === "cancelled"
          ? "Đã dừng tạo mockup. Các ảnh đã đính kèm trước đó vẫn được giữ trên Trello."
          : "Đã yêu cầu dừng tạo mockup. Worker đang ngắt tác vụ; các ảnh đã upload vẫn được giữ lại.",
      );
      await syncAllColumns();
    } catch (error) {
      if (isForegroundJob) isAbortingRef.current = false;
      setErrorMsg(error instanceof Error ? error.message : "Không thể dừng tác vụ Mockup.");
      setGenerationStatusText("Tác vụ Mockup vẫn đang chạy.");
    } finally {
      setCancellingJobIds((current) => {
        const next = new Set(current);
        next.delete(jobId);
        return next;
      });
    }
  };

  const handleGenerateMockupsSingle = async (
    card: TrelloCard,
    options: { notify?: boolean } = {},
  ): Promise<MockupGenerationSummary | undefined> => {
    const shouldNotify = options.notify !== false;
    if (shouldNotify) prepareBrowserNotification();
    if (generationInFlightRef.current) {
      setErrorMsg(
        "Đang có một lượt tạo mockup chạy. Request bấm trùng đã được chặn để không phát sinh thêm chi phí.",
      );
      return undefined;
    }

    const selectedAiSteps = mockupContents
      .filter((content) => content.checked && content.id >= 2)
      .map((content) => content.id);
    if (selectedAiSteps.length === 0) {
      setErrorMsg("Hãy chọn ít nhất một concept mockup từ Content 2 trở đi.");
      return undefined;
    }
    if (selectedAiSteps.length > MAX_AI_MOCKUPS_PER_PRODUCT) {
      setErrorMsg(
        `Mỗi sản phẩm chỉ được tạo tối đa ${MAX_AI_MOCKUPS_PER_PRODUCT} Content AI ngoài ảnh gốc.`,
      );
      return undefined;
    }
    generationInFlightRef.current = true;
    isAbortingRef.current = false;
    setActiveGeneratingCardId(card.id);
    setGenerationResult(null);
    setErrorMsg("");
    setGenerationStatusText("Đang chuẩn bị ảnh thiết kế...");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const initialProgress: Record<number, GenerationStepStatus> = {};
    MOCKUP_STEPS.forEach((step) => {
      initialProgress[step.id] = "pending";
    });
    setGenerationProgress(initialProgress);

    try {
      const res = await fetch("/api/trello/mockup-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          cardId: card.id,
          model: selectedModel,
          quality: selectedQuality,
          selectedSteps: selectedAiSteps,
          forceRegenerate: false,
          customContents: mockupContents.map((content) => ({
            id: content.id,
            label: content.label,
            promptKey: content.promptKey,
            customPrompt: content.customPrompt,
          })),
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Lỗi HTTP ${res.status}`);
      }

      activeGenerationJobIdRef.current = res.headers.get("x-mockup-job-id");

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
            [event.step]:
              event.status === "success" && event.phase === "generation"
                ? "uploading"
                : event.status,
          }));

          // When an image is ready & attached on Trello, display it on screen real-time!
          if (event.status === "success" && (event.attachmentUrl || event.previewUrl)) {
            const updateCardAttachments = (prev: TrelloCard[]) =>
              prev.map((c) => {
                if (c.id !== card.id) return c;
                const existingAtts = c.attachments || [];
                const prevAtt = existingAtts.find((a) => {
                  if (event.attachmentId && a.id === event.attachmentId) return true;
                  const step = mockupIndexFromAttachmentName(a.name);
                  return step !== null && step > 0 && step === event.step;
                });
                const newAtt = {
                  id: event.attachmentId || prevAtt?.id || String(Date.now()),
                  name:
                    event.name ||
                    prevAtt?.name ||
                    `Mockup${event.step}_Generated`,
                  url: event.attachmentUrl || prevAtt?.url || "",
                  mimeType: event.previewUrl?.startsWith("data:image/webp")
                    ? "image/webp"
                    : "image/png",
                  previewUrl: event.previewUrl || prevAtt?.previewUrl,
                  thumbnailUrl: event.thumbnailUrl || prevAtt?.thumbnailUrl,
                };
                const filteredAtts = existingAtts.filter((a) => {
                  if (a.id === newAtt.id || (a.url && a.url === newAtt.url)) return false;
                  const step = mockupIndexFromAttachmentName(a.name);
                  if (step !== null && step > 0 && step === event.step) return false;
                  return true;
                });
                return {
                  ...c,
                  attachments: sortMockupAttachments([
                    ...filteredAtts,
                    newAtt,
                  ]),
                };
              });

            setDesignCards(updateCardAttachments);
            setMockupCards(updateCardAttachments);
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
        return {
          status: "cancelled",
          sku: card.parsed?.sku || card.name,
          completed: 0,
          requested: selectedAiSteps.length,
        };
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
        const wasRequested =
          step.id === 1 || selectedAiSteps.includes(step.id);
        finalProgress[step.id] = !wasRequested
          ? "pending"
          : attachment?.status === "success"
            ? "success"
            : "error";
      });
      setGenerationProgress(finalProgress);

      const failedUploads = data.attachments.filter(
        (attachment) => attachment.status === "failed",
      );
      if (failedUploads.length > 0) {
        const completedCount = Math.max(0, data.requestedMockupsCount - failedUploads.length);
        setGenerationStatusText(
          `Hoàn tất tạo ảnh nhưng ${failedUploads.length} ảnh upload thất bại.`,
        );
        setErrorMsg(
          `Đã tạo xong nhưng ${failedUploads.length}/${data.requestedMockupsCount} concept đã chọn không tải được lên Trello. Thẻ vẫn ở cột ${sourceListName} để bạn thử lại.`,
        );
        if (shouldNotify) {
          showCompletionNotice({
            type: "warning",
            title: `Bộ mockup ${data.sku} chưa hoàn tất`,
            message: `Đã hoàn tất ${completedCount}/${data.requestedMockupsCount} ảnh AI. ${failedUploads.length} ảnh cần thử lại.`,
          });
        }
        return {
          status: "partial",
          sku: data.sku,
          completed: completedCount,
          requested: data.requestedMockupsCount,
        };
      } else {
        const providerAudit = (data.providerResponses || [])
          .map((response) => {
            const requestId = response.requestId || "không có request ID";
            const usage = response.usage
              ? ` · ${response.usage.totalTokens} token`
              : "";
            const estimatedCost =
              response.estimatedCostUsd === null
                ? ""
                : response.provider === "cheapkeyai"
                  ? ` · giá cố định $${response.estimatedCostUsd.toFixed(3)}`
                  : ` · ước tính $${response.estimatedCostUsd.toFixed(4)}`;
            return `${requestId}${usage}${estimatedCost}`;
          })
          .join("; ");
        const locationText = data.movedToTargetList
          ? ` — rồi chuyển thẻ sang cột ${targetListName}`
          : ` — thẻ vẫn ở cột ${sourceListName} để bạn tạo các concept còn lại`;
        setGenerationStatusText(
          `Đã tạo ${data.newlyGeneratedMockupsCount} ảnh mới bằng ${data.model}/${data.quality || "auto"}.`,
        );
        setGenerationResult(
          `🎉 Đã tạo ${data.newlyGeneratedMockupsCount} mockup mới cho SKU "${data.sku}" bằng ${data.model}/${data.quality || "auto"}${providerAudit ? ` — ${data.providerResponseCount} phản hồi provider: ${providerAudit}` : ""}${locationText}.`,
        );
        if (shouldNotify) {
          showCompletionNotice({
            type: "success",
            title: `Đã tạo xong mockup ${data.sku}`,
            message: `${data.requestedMockupsCount}/${data.requestedMockupsCount} ảnh AI đã hoàn tất${data.movedToTargetList ? `, file đã lên Trello và thẻ đã chuyển sang cột ${targetListName}` : ", ảnh đã được lưu trên Trello"}.`,
          });
        }
        return {
          status: "success",
          sku: data.sku,
          completed: data.requestedMockupsCount,
          requested: data.requestedMockupsCount,
        };
      }
    } catch (err: unknown) {
      if (isAbortingRef.current || (err instanceof Error && err.name === "AbortError")) {
        await syncAllColumns();
        setGenerationStatusText("Đã dừng tạo mockup. Các ảnh đã tạo thành công trước đó được lưu giữ đầy đủ.");
        setErrorMsg("");
        return {
          status: "cancelled",
          sku: card.parsed?.sku || card.name,
          completed: 0,
          requested: selectedAiSteps.length,
        };
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
      if (shouldNotify) {
        showCompletionNotice({
          type: "error",
          title: `Không thể tạo mockup ${card.parsed?.sku || card.name}`,
          message: msg,
        });
      }
      return {
        status: "failed",
        sku: card.parsed?.sku || card.name,
        completed: 0,
        requested: selectedAiSteps.length,
      };
    } finally {
      generationInFlightRef.current = false;
      setActiveGeneratingCardId(null);
      abortControllerRef.current = null;
      activeGenerationJobIdRef.current = null;
      void syncAllColumns();
    }
  };

  const handleBatchGenerateMockups = async () => {
    if (selectedCardIds.size === 0) return;
    prepareBrowserNotification();
    setBatchProcessing(true);
    isAbortingRef.current = false;
    const selectedCards = designCards.filter((c) => selectedCardIds.has(c.id));
    setBatchProgress({ current: 0, total: selectedCards.length });
    const summaries: MockupGenerationSummary[] = [];

    for (let index = 0; index < selectedCards.length; index++) {
      if (isAbortingRef.current) break;
      const card = selectedCards[index];
      setBatchProgress({ current: index + 1, total: selectedCards.length });
      const summary = await handleGenerateMockupsSingle(card, { notify: false });
      if (summary) summaries.push(summary);
    }

    setBatchProcessing(false);
    setSelectedCardIds(new Set());
    await syncAllColumns();

    if (!isAbortingRef.current) {
      const successful = summaries.filter((summary) => summary.status === "success").length;
      const partial = summaries.filter((summary) => summary.status === "partial").length;
      const failed = summaries.filter((summary) => summary.status === "failed").length;
      const completedImages = summaries.reduce((total, summary) => total + summary.completed, 0);
      const requestedImages = summaries.reduce((total, summary) => total + summary.requested, 0);
      showCompletionNotice({
        type: partial > 0 || failed > 0 ? "warning" : "success",
        title: partial > 0 || failed > 0
          ? `Batch mockup hoàn tất ${successful}/${selectedCards.length} thẻ`
          : `Đã tạo xong batch ${successful} thẻ`,
        message: partial > 0 || failed > 0
          ? `${completedImages}/${requestedImages} ảnh AI hoàn tất. ${partial + failed} thẻ cần kiểm tra lại.`
          : `${completedImages}/${requestedImages} ảnh AI đã hoàn tất và được lưu trên Trello.`,
      });
    }
  };

  return (
    <div className="space-y-6 text-slate-800 font-sans">
      {backgroundJobs.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
          <div className="mb-2 flex items-center gap-3">
            <SpinnerIcon className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
            <p className="min-w-0 flex-1 text-sm font-extrabold text-sky-950">
              {backgroundJobs.length} tác vụ mockup đang chạy nền
            </p>
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
              {backgroundJobs.filter((job) => job.status === "running").length} đang chạy
            </span>
          </div>
          <div className="space-y-2">
            {backgroundJobs.map((job) => {
              const cancelling =
                cancellingJobIds.has(job.id) || job.status === "cancel_requested";
              return (
                <div
                  key={job.id}
                  className="flex items-center gap-3 rounded-xl border border-sky-200 bg-white/80 px-3 py-2"
                >
                  <p className="min-w-0 flex-1 truncate text-xs font-medium text-sky-700">
                    {job.progress?.message ||
                      "Đang chờ worker xử lý. Có thể tải lại hoặc đóng trang mà không mất tác vụ."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void cancelGeneration(job.id)}
                    disabled={cancelling || job.status === "cancelled"}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {cancelling ? (
                      <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <StopIcon className="h-3.5 w-3.5 fill-current" />
                    )}
                    <span>{cancelling ? "Đang dừng..." : "Dừng"}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {completionNotice && (
        <div
          className={`fixed right-5 top-5 z-[70] w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border bg-white p-4 shadow-2xl ${
            completionNotice.type === "success"
              ? "border-emerald-200"
              : completionNotice.type === "warning"
                ? "border-amber-200"
                : "border-rose-200"
          }`}
          role={completionNotice.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                completionNotice.type === "success"
                  ? "bg-emerald-50 text-emerald-600"
                  : completionNotice.type === "warning"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-rose-50 text-rose-600"
              }`}
            >
              {completionNotice.type === "success" ? (
                <CheckCircleIcon className="h-5 w-5" weight="fill" />
              ) : (
                <WarningCircleIcon className="h-5 w-5" weight="fill" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-slate-900">{completionNotice.title}</p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">
                {completionNotice.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompletionNotice(null)}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Đóng thông báo"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Studio Lightbox & Image Refinement Side-by-Side Modal */}
      {studioModal && activeStudioCard && activeStudioCard.attachments && activeStudioCard.attachments.length > 0 && (() => {
        const card = activeStudioCard;
        const attachments = card.attachments || [];

        let safeIndex = Math.min(Math.max(0, studioModal.attachmentIndex), attachments.length - 1);
        if (studioModal.stepId) {
          const foundIdx = attachments.findIndex((a) => {
            const step = mockupIndexFromAttachmentName(a.name);
            return step !== null && step > 0 && step === studioModal.stepId;
          });
          if (foundIdx >= 0) safeIndex = foundIdx;
        } else if (studioModal.attachmentId) {
          const foundIdx = attachments.findIndex((a) => a.id === studioModal.attachmentId);
          if (foundIdx >= 0) safeIndex = foundIdx;
        }

        const currentAtt = attachments[safeIndex];
        const stepId = mockupIndexFromAttachmentName(currentAtt.name) || (safeIndex === 0 ? 1 : undefined);
        const statusKey = `${card.id}_${currentAtt.id}`;
        const currentStatus = approvalMap[statusKey];
        const currentRegenerationKey = stepId
          ? singleMockupRegenerationKey(card.id, stepId)
          : null;
        const currentRegenerationJob = currentRegenerationKey
          ? singleMockupRegenerationJobs[currentRegenerationKey]
          : undefined;
        const currentBackgroundRegenerationJob = currentRegenerationKey
          ? backgroundJobs.find(
              (job) =>
                job.request?.forceRegenerate &&
                job.cardId === card.id &&
                typeof stepId === "number" &&
                job.request.selectedSteps?.includes(stepId),
            )
          : undefined;
        const isCurrentImageRegenerating = Boolean(
          currentRegenerationJob || currentBackgroundRegenerationJob,
        );
        const currentContent = stepId
          ? mockupContents.find((content) => content.id === stepId)
          : undefined;
        const activePreset = allPresets.find(
          (preset) => preset.id === selectedCategory,
        );
        const promptEditorKey = stepId && stepId > 1
          ? imagePromptEditorKey(card.id, stepId, selectedCategory)
          : null;
        const promptEditor = promptEditorKey
          ? imagePromptEditors[promptEditorKey]
          : undefined;
        const isPromptExpanded = Boolean(
          promptEditorKey && expandedImagePromptKey === promptEditorKey,
        );
        const promptHasChanges = Boolean(
          promptEditor && promptEditor.draft !== promptEditor.original,
        );
        const promptBlocksRegeneration = Boolean(
          promptEditor?.loading ||
            (promptEditor &&
              !promptEditor.error &&
              !promptEditor.draft.trim()),
        );

        const loadCurrentImagePrompt = async (force = false) => {
          if (!promptEditorKey || (promptEditor && !force)) return;

          const savedPrompt = currentContent?.customPrompt?.trim();
          if (savedPrompt) {
            setImagePromptEditors((previous) => ({
              ...previous,
              [promptEditorKey]: {
                original: savedPrompt,
                draft: savedPrompt,
                loading: false,
              },
            }));
            return;
          }

          setImagePromptEditors((previous) => ({
            ...previous,
            [promptEditorKey]: {
              original: "",
              draft: "",
              loading: true,
            },
          }));

          try {
            const response = await fetch("/api/trello/mockup-prompt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                promptKey:
                  currentContent?.promptKey ||
                  `custom:${currentContent?.label || currentAtt.name}`,
                dimensions: {
                  length: "{{length}}",
                  width: "{{width}}",
                  thickness: "{{thickness}}",
                  formatted: "{{formatted}}",
                  capacity: "{{capacity}}",
                },
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.error || `Lỗi HTTP ${response.status}`);
            }
            const prompt = String(payload.prompt || "").trim();
            if (!prompt) throw new Error("Prompt của ảnh đang trống.");

            setImagePromptEditors((previous) => ({
              ...previous,
              [promptEditorKey]: {
                original: prompt,
                draft: prompt,
                loading: false,
              },
            }));
          } catch (error) {
            setImagePromptEditors((previous) => ({
              ...previous,
              [promptEditorKey]: {
                original: "",
                draft: "",
                loading: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Không thể tải prompt của ảnh.",
              },
            }));
          }
        };

        const toggleCurrentImagePrompt = () => {
          if (!promptEditorKey) return;
          if (isPromptExpanded) {
            setExpandedImagePromptKey(null);
            return;
          }
          setExpandedImagePromptKey(promptEditorKey);
          void loadCurrentImagePrompt();
        };

        const copyCurrentImagePrompt = async () => {
          if (!promptEditorKey || !promptEditor?.draft.trim()) return;
          try {
            await navigator.clipboard.writeText(promptEditor.draft);
            setCopiedImagePromptKey(promptEditorKey);
            window.setTimeout(() => {
              setCopiedImagePromptKey((current) =>
                current === promptEditorKey ? null : current,
              );
            }, 1_500);
          } catch {
            showCompletionNotice({
              type: "error",
              title: "Không thể copy prompt",
              message: "Trình duyệt không cho phép sao chép vào clipboard.",
            });
          }
        };

        const saveSharedPromptToPreset = async () => {
          if (
            !promptEditorKey ||
            !stepId ||
            !currentContent ||
            !promptEditor?.draft.trim()
          ) return;

          if (!activePreset) {
            showCompletionNotice({
              type: "error",
              title: "Không tìm thấy phôi đang dùng",
              message: "Hãy tải lại danh sách phôi rồi thử lại.",
            });
            return;
          }

          const confirmed = window.confirm(
            `Lưu prompt mới cho Content ${stepId} vào phôi "${activePreset.label}"? Thay đổi này sẽ áp dụng cho cả team.`,
          );
          if (!confirmed) return;

          setSavingImagePromptKey(promptEditorKey);
          try {
            const prompt = promptEditor.draft.trim();
            const syncedPresets = await savePresetToServer({
              ...activePreset,
              contents: activePreset.contents.map((content) =>
                content.id === stepId
                  ? { ...content, customPrompt: prompt }
                  : content,
              ),
            });
            setAllPresets(syncedPresets);
            setMockupContents((current) =>
              current.map((content) =>
                content.id === stepId
                  ? { ...content, customPrompt: prompt }
                  : content,
              ),
            );
            setImagePromptEditors((previous) => ({
              ...previous,
              [promptEditorKey]: {
                ...previous[promptEditorKey],
                original: prompt,
                draft: prompt,
                error: undefined,
              },
            }));
            showCompletionNotice({
              type: "success",
              title: "Đã lưu prompt vào phôi",
              message: `Content ${stepId} của phôi "${activePreset.label}" đã được cập nhật cho team.`,
            });
          } catch (error) {
            showCompletionNotice({
              type: "error",
              title: "Chưa thể lưu prompt",
              message:
                error instanceof Error
                  ? error.message
                  : "Không thể đồng bộ phôi cho team.",
            });
          } finally {
            setSavingImagePromptKey((current) =>
              current === promptEditorKey ? null : current,
            );
          }
        };

        const handlePrev = () => {
          if (attachments.length > 1) {
            const prevIndex = (safeIndex - 1 + attachments.length) % attachments.length;
            const nextAtt = attachments[prevIndex];
            const nextStep = nextAtt ? (mockupIndexFromAttachmentName(nextAtt.name) || (prevIndex === 0 ? 1 : undefined)) : undefined;
            setStudioModal({
              cardId: card.id,
              attachmentIndex: prevIndex,
              stepId: nextStep,
              attachmentId: nextAtt?.id,
            });
          } else if (allBoardCards.length > 1) {
            const prevIdx = (activeCardIndex - 1 + allBoardCards.length) % allBoardCards.length;
            const firstAtt = allBoardCards[prevIdx].attachments?.[0];
            const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
            setStudioModal({ cardId: allBoardCards[prevIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id });
          }
        };

        const handleNext = () => {
          if (attachments.length > 1) {
            const nextIndex = (safeIndex + 1) % attachments.length;
            const nextAtt = attachments[nextIndex];
            const nextStep = nextAtt ? (mockupIndexFromAttachmentName(nextAtt.name) || (nextIndex === 0 ? 1 : undefined)) : undefined;
            setStudioModal({
              cardId: card.id,
              attachmentIndex: nextIndex,
              stepId: nextStep,
              attachmentId: nextAtt?.id,
            });
          } else if (allBoardCards.length > 1) {
            const nextIdx = (activeCardIndex + 1) % allBoardCards.length;
            const firstAtt = allBoardCards[nextIdx].attachments?.[0];
            const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
            setStudioModal({ cardId: allBoardCards[nextIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id });
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-5 backdrop-blur-md">
            <div className="relative flex h-[94vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200/80">

              {/* Top Header Bar */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-5 py-3 gap-4 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-extrabold text-sm text-slate-900 truncate">
                    {currentAtt.name}
                  </span>
                  <span className="rounded-lg bg-indigo-100 px-2.5 py-0.5 text-xs font-black text-indigo-800 font-mono shrink-0 border border-indigo-200">
                    SKU: {card.parsed?.sku || "SKU"}
                  </span>
                  <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-extrabold text-slate-700 shrink-0">
                    Ảnh {safeIndex + 1} / {attachments.length}
                  </span>
                  {allBoardCards.length > 1 && (
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-0.5 text-xs font-bold text-slate-600 shadow-2xs shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const prevIdx = (activeCardIndex - 1 + allBoardCards.length) % allBoardCards.length;
                          const firstAtt = allBoardCards[prevIdx].attachments?.[0];
                          const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
                          setStudioModal({ cardId: allBoardCards[prevIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id });
                        }}
                        className="hover:text-indigo-600 transition p-0.5"
                        title="Chuyển sang Thẻ / SKU trước"
                      >
                        <CaretLeftIcon className="h-3.5 w-3.5" />
                      </button>
                      <span>Thẻ {activeCardIndex + 1}/{allBoardCards.length}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextIdx = (activeCardIndex + 1) % allBoardCards.length;
                          const firstAtt = allBoardCards[nextIdx].attachments?.[0];
                          const firstStep = firstAtt ? (mockupIndexFromAttachmentName(firstAtt.name) || 1) : undefined;
                          setStudioModal({ cardId: allBoardCards[nextIdx].id, attachmentIndex: 0, stepId: firstStep, attachmentId: firstAtt?.id });
                        }}
                        className="hover:text-indigo-600 transition p-0.5"
                        title="Chuyển sang Thẻ / SKU tiếp theo"
                      >
                        <CaretRightIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Approval toggle */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => toggleApprovalStatus(card.id, currentAtt.id, "approved")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                        currentStatus === "approved"
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
                      }`}
                    >
                      <ThumbsUpIcon className="h-4 w-4" />
                      <span>Duyệt 💚</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleApprovalStatus(card.id, currentAtt.id, "rejected")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                        currentStatus === "rejected"
                          ? "bg-rose-600 text-white shadow-xs"
                          : "text-slate-600 hover:bg-rose-50 hover:text-rose-700"
                      }`}
                    >
                      <ThumbsDownIcon className="h-4 w-4" />
                      <span>Chưa ưng 🔴</span>
                    </button>
                  </div>

                  {/* Download */}
                  <button
                    type="button"
                    onClick={async () => {
                      setDownloadingImage(true);
                      try {
                        await downloadOriginalTrelloImage({
                          url: currentAtt.url,
                          name: currentAtt.name,
                        });
                      } catch (error) {
                        setErrorMsg(error instanceof Error ? error.message : "Không thể tải ảnh.");
                      } finally {
                        setDownloadingImage(false);
                      }
                    }}
                    disabled={downloadingImage}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 transition"
                  >
                    {downloadingImage ? (
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <DownloadSimpleIcon className="h-4 w-4" />
                    )}
                    <span>Tải ảnh gốc</span>
                  </button>

                  {/* Close */}
                  <button
                    type="button"
                    onClick={() => setStudioModal(null)}
                    className="rounded-xl bg-slate-200 p-2 text-slate-600 hover:bg-slate-300 transition"
                  >
                    <XIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Main Body: 2 Columns Side-by-Side */}
              <div className="flex flex-1 flex-col md:flex-row overflow-hidden">

                {/* COLUMN 1 (LEFT): Large Image Display with Next/Prev Arrow Navigation */}
                <div className="relative flex flex-1 items-center justify-center bg-slate-950 p-4 select-none group min-h-[300px]">

                  {/* Left Arrow Button */}
                  {attachments.length > 1 && (
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900/80 text-white backdrop-blur-md border border-white/20 shadow-2xl hover:bg-slate-900 hover:scale-110 active:scale-95 transition"
                      title="Ảnh trước (Mũi tên Trái ◀)"
                    >
                      <CaretLeftIcon className="h-7 w-7" weight="bold" />
                    </button>
                  )}

                  {/* Large High-Res Image */}
                  <img
                    key={currentAtt.id}
                    src={currentAtt.previewUrl || currentAtt.url}
                    alt={currentAtt.name}
                    className="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl transition"
                    decoding="async"
                    fetchPriority="high"
                    onError={(event) =>
                      fallBackToMasterImage(event, currentAtt.url)
                    }
                  />
                  {currentRegenerationJob && (
                    <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300/50 bg-slate-950/80 px-4 py-2 text-xs font-extrabold text-white shadow-xl backdrop-blur-md">
                      <SpinnerIcon className="h-4 w-4 animate-spin text-amber-300" />
                      <span>{currentRegenerationJob.statusText}</span>
                    </div>
                  )}

                  {/* Right Arrow Button */}
                  {attachments.length > 1 && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900/80 text-white backdrop-blur-md border border-white/20 shadow-2xl hover:bg-slate-900 hover:scale-110 active:scale-95 transition"
                      title="Ảnh tiếp theo (Mũi tên Phải ▶)"
                    >
                      <CaretRightIcon className="h-7 w-7" weight="bold" />
                    </button>
                  )}

                  {/* Bottom Thumbnail Navigation Strip */}
                  {attachments.length > 1 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-2xl bg-slate-900/85 p-1.5 backdrop-blur-md border border-white/10 max-w-[90%] overflow-x-auto shadow-2xl">
                      {attachments.map((att, idx) => {
                        const targetStep =
                          mockupIndexFromAttachmentName(att.name) ||
                          (idx === 0 ? 1 : undefined);
                        const isRegeneratingThumbnail = targetStep
                          ? Boolean(
                              singleMockupRegenerationJobs[
                                singleMockupRegenerationKey(card.id, targetStep)
                              ] ||
                                backgroundRegenerationKeys.has(
                                  singleMockupRegenerationKey(card.id, targetStep),
                                ),
                            )
                          : false;

                        return (
                          <button
                            key={att.id}
                            type="button"
                            onClick={() => {
                              setStudioModal({ cardId: card.id, attachmentIndex: idx, stepId: targetStep, attachmentId: att.id });
                            }}
                            className={`relative h-10 w-10 overflow-hidden rounded-xl border transition shrink-0 ${
                              idx === safeIndex
                                ? "border-amber-400 ring-2 ring-amber-400/50 scale-105"
                                : "border-transparent opacity-50 hover:opacity-100"
                            }`}
                          >
                            <img
                              src={att.thumbnailUrl || att.previewUrl || att.url}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                              onError={(event) => fallBackToMasterImage(event, att.url)}
                            />
                            {isRegeneratingThumbnail && (
                              <span className="absolute inset-0 flex items-center justify-center bg-slate-950/65 text-white">
                                <SpinnerIcon className="h-5 w-5 animate-spin" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* COLUMN 2 (RIGHT): Refinement & AI Generation Form Side-by-Side */}
                <div className="w-full md:w-[350px] lg:w-[380px] shrink-0 border-t md:border-t-0 md:border-l border-slate-200 bg-white p-5 flex flex-col justify-between overflow-y-auto space-y-4">

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                      <LightningIcon className="h-5 w-5 text-amber-500 shrink-0" />
                      <h4 className="text-sm font-extrabold text-slate-900">
                        Gen Lại Ảnh Này
                      </h4>
                    </div>

                    {/* Model Select */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        AI Model:
                      </label>
                      <select
                        value={regenModel}
                        onChange={(e) => setRegenModel(e.target.value as MockupModel)}
                        className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-800 outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 shadow-2xs"
                      >
                        <option value="gpt-image-2-c">💸 GPT Image 2 C (CheapKeyAI)</option>
                        <option value="gpt-image-2-cheapkey">🤖 GPT Image 2 (CheapKeyAI)</option>
                        <option value="gpt-image-2">🔑 GPT Image 2 (OpenAI Direct)</option>
                        <option value="gpt-image-1.5">⚡ GPT Image 1.5 (OpenAI Direct)</option>
                        <option value="gemini-3-pro-image">💎 Gemini 3 Pro Image (Sắc Nét)</option>
                        <option value="gemini-3.1-flash-image">⚡ Gemini 3.1 Flash Image (Tốc Độ)</option>
                      </select>
                    </div>

                    {promptEditorKey && (
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
                        <button
                          type="button"
                          onClick={toggleCurrentImagePrompt}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-100 active:bg-slate-200/70"
                          aria-expanded={isPromptExpanded}
                        >
                          <PencilIcon className="h-4 w-4 shrink-0 text-indigo-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-extrabold text-slate-800">
                              Prompt cho ảnh đang chọn
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-500">
                              {activePreset?.label || selectedCategory}, Content {stepId}
                            </span>
                          </span>
                          {promptHasChanges && (
                            <span className="shrink-0 text-[10px] font-bold text-amber-700">
                              Prompt tạm
                            </span>
                          )}
                          <CaretDownIcon
                            className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
                              isPromptExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {isPromptExpanded && (
                          <div className="border-t border-slate-200 bg-white p-3">
                            {promptEditor?.loading ? (
                              <div
                                className="space-y-2"
                                role="status"
                                aria-label="Đang tải prompt"
                              >
                                <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                                <div className="h-3 w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                                <div className="h-3 w-3/5 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                              </div>
                            ) : promptEditor?.error ? (
                              <div className="rounded-lg bg-rose-50 p-2.5 text-[11px] font-semibold leading-relaxed text-rose-700">
                                <p>{promptEditor.error}</p>
                                <button
                                  type="button"
                                  onClick={() => void loadCurrentImagePrompt(true)}
                                  className="mt-2 font-extrabold text-rose-800 underline underline-offset-2"
                                >
                                  Thử tải lại
                                </button>
                              </div>
                            ) : promptEditor ? (
                              <>
                                <textarea
                                  value={promptEditor.draft}
                                  onChange={(event) =>
                                    setImagePromptEditors((previous) => ({
                                      ...previous,
                                      [promptEditorKey]: {
                                        ...previous[promptEditorKey],
                                        draft: event.target.value,
                                        error: undefined,
                                      },
                                    }))
                                  }
                                  rows={8}
                                  aria-label={`Prompt tạm của Content ${stepId} cho sản phẩm ${card.parsed?.sku || card.name}`}
                                  className="w-full resize-y rounded-lg border border-slate-300 bg-white p-2.5 text-[11px] font-medium leading-relaxed text-slate-800 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15"
                                />
                                <div className="mt-2 flex items-center justify-between gap-2">
                                  <span
                                    className={`text-[10px] font-semibold ${
                                      !promptEditor.draft.trim()
                                        ? "text-rose-600"
                                        : promptHasChanges
                                          ? "text-amber-700"
                                          : "text-slate-500"
                                    }`}
                                  >
                                    {!promptEditor.draft.trim()
                                      ? "Prompt không được để trống"
                                      : promptHasChanges
                                        ? "Sẽ dùng riêng cho lần gen này"
                                        : "Đang dùng prompt chung"}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setImagePromptEditors((previous) => ({
                                          ...previous,
                                          [promptEditorKey]: {
                                            ...previous[promptEditorKey],
                                            draft: previous[promptEditorKey].original,
                                            error: undefined,
                                          },
                                        }))
                                      }
                                      disabled={!promptHasChanges}
                                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                      <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" />
                                      Khôi phục
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void copyCurrentImagePrompt()}
                                      className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-extrabold text-slate-700 transition hover:bg-slate-200 active:scale-[0.98]"
                                    >
                                      {copiedImagePromptKey === promptEditorKey ? (
                                        <CheckIcon className="h-3.5 w-3.5 text-emerald-600" weight="bold" />
                                      ) : (
                                        <CopyIcon className="h-3.5 w-3.5" />
                                      )}
                                      {copiedImagePromptKey === promptEditorKey
                                        ? "Đã copy"
                                        : "Copy"}
                                    </button>
                                  </div>
                                </div>
                                {promptHasChanges && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void saveSharedPromptToPreset()
                                    }
                                    disabled={
                                      savingImagePromptKey === promptEditorKey ||
                                      !promptEditor.draft.trim()
                                    }
                                    className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-extrabold text-amber-800 transition hover:bg-amber-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {savingImagePromptKey === promptEditorKey ? (
                                      <SpinnerIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                                    ) : (
                                      <FloppyDiskIcon className="h-3.5 w-3.5" />
                                    )}
                                    {savingImagePromptKey === promptEditorKey
                                      ? "Đang lưu..."
                                      : "Lưu prompt chung"}
                                  </button>
                                )}
                                <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-medium leading-relaxed text-slate-500">
                                  Nội dung đang sửa chỉ dùng cho lần gen ảnh này.
                                  Chỉ khi bấm &quot;Lưu prompt chung&quot;, Content {stepId} của
                                  phôi {activePreset?.label || selectedCategory} mới được cập
                                  nhật cho cả team.
                                  <span className="mt-1 block">
                                    Các biến kích thước trong prompt tự lấy dữ liệu
                                    từ từng thẻ sản phẩm.
                                  </span>
                                </p>
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Prompt Refinement Textarea */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Tinh chỉnh thêm <span className="font-medium text-slate-400">(không bắt buộc)</span>
                      </label>
                      <textarea
                        value={regenPromptNote}
                        onChange={(e) => setRegenPromptNote(e.target.value)}
                        placeholder="Ví dụ: Đèn Giáng Sinh sáng hơn, bối cảnh tự nhiên hơn..."
                        rows={4}
                        className="w-full rounded-xl border border-slate-300 p-3 text-xs font-medium text-slate-800 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 placeholder:text-slate-400 shadow-2xs leading-relaxed"
                      />
                      <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-slate-500">
                        Chỉ áp dụng cho ảnh này của sản phẩm đang chọn; không thay
                        đổi prompt trong phôi dùng chung của team.
                      </p>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-3 border-t border-slate-100 shrink-0 space-y-2">
                    {promptHasChanges && (
                      <p className="rounded-lg bg-indigo-50 px-2.5 py-2 text-center text-[10px] font-bold text-indigo-800">
                        Lần gen này sẽ dùng prompt tạm. Prompt chung của team không thay đổi.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!stepId) {
                          setErrorMsg("Không xác định được vị trí mockup để gen lại.");
                          return;
                        }
                        if (stepId === 1) {
                          setErrorMsg(
                            "Content 1 là ảnh gốc mặc định nên không gọi AI để tạo lại.",
                          );
                          return;
                        }
                        const regenerationKey = singleMockupRegenerationKey(card.id, stepId);
                        if (singleMockupRegenerationJobs[regenerationKey]) return;
                        const refinementNote = regenPromptNote.trim();
                        const temporaryPrompt = promptHasChanges
                          ? promptEditor?.draft.trim()
                          : undefined;
                        prepareBrowserNotification();
                        setSingleMockupRegenerationJobs((previous) => ({
                          ...previous,
                          [regenerationKey]: { statusText: "Đang kết nối AI..." },
                        }));
                        setRegenPromptNote("");
                        setErrorMsg("");
                        try {
                          const res = await fetch("/api/trello/mockup-jobs", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              cardId: card.id,
                              model: regenModel,
                              quality: selectedQuality,
                              selectedSteps: [stepId],
                              forceRegenerate: true,
                              customContents: mockupContents.map((content) => ({
                                id: content.id,
                                label: content.label,
                                promptKey: content.promptKey,
                                customPrompt:
                                  content.id === stepId && temporaryPrompt
                                    ? temporaryPrompt
                                    : content.customPrompt,
                              })),
                              customRefinementNotes: refinementNote
                                ? { [stepId]: refinementNote }
                                : undefined,
                              stream: true,
                            }),
                          });

                          if (!res.ok) {
                            const errData = await res.json().catch(() => ({}));
                            throw new Error(errData.error || `Lỗi HTTP ${res.status}`);
                          }

                          const regenerationJobId = res.headers.get(
                            "X-Mockup-Job-Id",
                          );

                          if (!res.body) {
                            throw new Error("Server không trả về luồng tiến độ.");
                          }

                          const reader = res.body.getReader();
                          const decoder = new TextDecoder();
                          let buffered = "";
                          const regenStreamResult: { data: MockupGenerationResponse | null } = { data: null };

                          const handleRegenEvent = (event: MockupStreamEvent) => {
                            if (event.type === "error") {
                              throw new Error(event.error);
                            }
                            if (event.type === "complete") {
                              regenStreamResult.data = event.data;
                              return;
                            }
                            if (event.type === "progress") {
                              setSingleMockupRegenerationJobs((previous) => ({
                                ...previous,
                                [regenerationKey]: { statusText: event.message },
                              }));
                              if (
                                event.status === "success" &&
                                (event.attachmentUrl || event.previewUrl)
                              ) {
                                const updateCardAttachments = (prev: TrelloCard[]) =>
                                  prev.map((c) => {
                                    if (c.id !== card.id) return c;
                                    const existingAtts = c.attachments || [];
                                    const prevAtt = existingAtts.find((a) => {
                                      if (event.attachmentId && a.id === event.attachmentId)
                                        return true;
                                      const step = mockupIndexFromAttachmentName(a.name);
                                      return step !== null && step > 0 && step === event.step;
                                    });
                                    const newAtt = {
                                      id:
                                        event.attachmentId ||
                                        prevAtt?.id ||
                                        String(Date.now()),
                                      name:
                                        event.name ||
                                        prevAtt?.name ||
                                        `Mockup${event.step}_Generated`,
                                      url: event.attachmentUrl || prevAtt?.url || "",
                                      mimeType: "image/png",
                                      previewUrl: event.previewUrl || prevAtt?.previewUrl,
                                      thumbnailUrl: event.thumbnailUrl || prevAtt?.thumbnailUrl,
                                    };
                                    const filteredAtts = existingAtts.filter((a) => {
                                      if (a.id === newAtt.id || (a.url && a.url === newAtt.url))
                                        return false;
                                      const step = mockupIndexFromAttachmentName(a.name);
                                      if (step !== null && step > 0 && step === event.step)
                                        return false;
                                      return true;
                                    });
                                    return {
                                      ...c,
                                      attachments: sortMockupAttachments([
                                        ...filteredAtts,
                                        newAtt,
                                      ]),
                                    };
                                  });

                                setDesignCards(updateCardAttachments);
                                setMockupCards(updateCardAttachments);
                              }
                            }
                          };

                          while (true) {
                            const { done, value } = await reader.read();
                            buffered += decoder.decode(value, { stream: !done });
                            const lines = buffered.split("\n");
                            buffered = lines.pop() || "";

                            for (const line of lines) {
                              if (!line.trim()) continue;
                              let evt: MockupStreamEvent | null = null;
                              try {
                                evt = JSON.parse(line.trim()) as MockupStreamEvent;
                              } catch {
                                // Ignore parse error
                              }
                              if (evt) handleRegenEvent(evt);
                            }
                            if (done) break;
                          }

                          if (buffered.trim()) {
                            let evt: MockupStreamEvent | null = null;
                            try {
                              evt = JSON.parse(buffered.trim()) as MockupStreamEvent;
                            } catch {
                              // Ignore parse error
                            }
                            if (evt) handleRegenEvent(evt);
                          }

                          await syncAllColumns();
                          const regenData = regenStreamResult.data;
                          if (!regenData) {
                            throw new Error("Luồng gen lại ảnh kết thúc nhưng không có kết quả.");
                          }
                          if (regenerationJobId) {
                            setBackgroundJobs((current) =>
                              current.filter((job) => job.id !== regenerationJobId),
                            );
                          }
                          const failedRegen = regenData.attachments.some(
                            (attachment) => attachment.index === stepId && attachment.status === "failed",
                          );
                          if (!failedRegen && promptEditorKey && temporaryPrompt) {
                            setImagePromptEditors((previous) => {
                              const editor = previous[promptEditorKey];
                              if (!editor) return previous;
                              return {
                                ...previous,
                                [promptEditorKey]: {
                                  ...editor,
                                  draft: editor.original,
                                  error: undefined,
                                },
                              };
                            });
                          }
                          showCompletionNotice(failedRegen
                            ? {
                                type: "warning",
                                title: `Mockup ${stepId} chưa cập nhật`,
                                message: `Ảnh của SKU ${card.parsed?.sku || card.name} chưa tải được lên Trello. Bạn có thể thử lại.`,
                              }
                            : {
                                type: "success",
                                title: `Đã gen lại Mockup ${stepId}`,
                                message: `Ảnh của SKU ${card.parsed?.sku || card.name} đã được cập nhật trên Trello.`,
                              });
                        } catch (err) {
                          const message = err instanceof Error ? err.message : "Lỗi khi gen lại ảnh.";
                          setErrorMsg(message);
                          showCompletionNotice({
                            type: "error",
                            title: `Không thể gen lại Mockup ${stepId}`,
                            message,
                          });
                        } finally {
                          setSingleMockupRegenerationJobs((previous) => {
                            const next = { ...previous };
                            delete next[regenerationKey];
                            return next;
                          });
                        }
                      }}
                      disabled={
                        isCurrentImageRegenerating ||
                        promptBlocksRegeneration
                      }
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3 px-4 text-sm font-black text-white shadow-md hover:bg-amber-600 active:scale-[0.98] disabled:opacity-50 transition"
                    >
                      {isCurrentImageRegenerating ? (
                        <div className="flex flex-col items-center justify-center py-0.5">
                          <div className="flex items-center gap-2">
                            <SpinnerIcon className="h-5 w-5 animate-spin text-white" />
                            <span>Đang Gen Lại...</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <SparkleIcon className="h-5 w-5 text-amber-200" />
                          <span>
                            {promptHasChanges
                              ? "✨ Gen Lại Bằng Prompt Tạm"
                              : "✨ Gen Lại Tấm Ảnh Này Ngay"}
                          </span>
                        </>
                      )}
                    </button>
                    {currentRegenerationJob?.statusText && (
                      <div className="text-center text-xs font-bold text-amber-600 animate-pulse bg-amber-50 rounded-xl py-1.5 px-2 border border-amber-200">
                        {currentRegenerationJob.statusText}
                      </div>
                    )}
                  </div>

                </div>

              </div>

            </div>
          </div>
        );
      })()}

      {/* Floating Multi-Select Batch Action Bar */}
      {selectedCardIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between rounded-2xl border border-indigo-300 bg-indigo-600 px-6 py-3 text-white shadow-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-indigo-700 shadow-xs">
              {selectedCardIds.size}
            </span>
            <span className="text-xs font-bold">
              Thẻ {sourceListName} đã chọn để sinh Mockups
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
                disabled={batchProcessing || selectedAiMockupCount === 0}
                className="flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 shadow hover:bg-amber-300 transition disabled:opacity-50"
              >
                <SparkleIcon className="h-4 w-4 fill-current text-slate-900" />
                <span>
                  ⚡ Batch: {selectedAiMockupCount} mockup AI/thẻ ({selectedCardIds.size}{" "}
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
              <h3 className="text-base font-extrabold text-slate-900">
                Auto Mockup Generator
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* AI Model Selector */}
            <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 shadow-2xs">
              <SparkleIcon className="h-4 w-4 text-purple-600 shrink-0" />
              <span className="text-xs font-bold text-slate-600">Model:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as MockupModel)}
                className="bg-transparent text-xs font-extrabold text-slate-900 outline-none cursor-pointer pr-1"
              >
                <option value="gpt-image-2-c">
                  💸 GPT Image 2 C (CheapKeyAI)
                </option>
                <option value="gpt-image-2-cheapkey">
                  🤖 GPT Image 2 (CheapKeyAI)
                </option>
                <option value="gpt-image-2">
                  🔑 GPT Image 2 (OpenAI Direct)
                </option>
                <option value="gpt-image-1.5">
                  ⚡ GPT Image 1.5 (OpenAI Direct)
                </option>
                <option value="gemini-3.1-flash-image">
                  🎨 Gemini 3.1 Flash Image
                </option>
                <option value="fast-graphic">
                  ⚡ Fast Graphic Engine
                </option>
              </select>
            </div>

            {(selectedModel === "gpt-image-2" ||
              selectedModel === "gpt-image-2-c" ||
              selectedModel === "gpt-image-2-cheapkey" ||
              selectedModel === "gpt-image-1.5") && (
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
                    <option value="low">low (Nhanh / bản nháp)</option>
                    <option value="medium">medium (Cân bằng)</option>
                    <option value="high">high (Cao / bản cuối)</option>
                  </select>
                </div>
              )}

            {/* Sync / Refresh Button */}
            <button
              onClick={syncAllColumns}
              disabled={loadingCards}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition disabled:opacity-50"
            >
              <ArrowsClockwiseIcon
                className={`h-4 w-4 ${loadingCards ? "animate-spin" : ""}`}
              />
              <span>Làm Mới</span>
            </button>
          </div>
        </div>

        {/* Mockup Content Checkbox Option Section */}
        <div className="mt-4 border-t border-indigo-100/80 pt-3">
          {/* Category Selector Bar */}
          <div className="mb-3.5 pb-2.5 border-b border-indigo-100/60">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-black text-slate-700 uppercase tracking-wide flex items-center gap-1.5 shrink-0">
                <TagIcon className="h-4 w-4 text-indigo-600" />
                Mục Sản Phẩm (Product Category):
              </span>

              <button
                type="button"
                onClick={() => setShowProductPresetModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-800 shadow-2xs hover:bg-amber-100 transition cursor-pointer"
                title="Thêm, nhân bản loại sản phẩm mới & chỉnh sửa Content / Prompt AI"
              >
                <GearIcon className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>Quản Lý Mẫu SP & Content</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {allPresets.length === 0 && (
                <div className="w-full rounded-xl border border-dashed border-indigo-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
                  Chưa có mục sản phẩm. Chọn <strong>Quản Lý Mẫu SP &amp; Content</strong> để tạo mục đầu tiên.
                </div>
              )}
              {allPresets.map((cat) => {
                const isActive = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectCategory(cat.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all duration-150 cursor-pointer ${
                      isActive
                        ? "bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-600/30"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900 border border-slate-200/80"
                    }`}
                  >
                    <span>{cat.icon || "📦"}</span>
                    <span>{cat.label}</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                        isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {cat.contents.length} Content
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
                <ImageSquareIcon className="h-4 w-4 text-indigo-600" />
                MOCKUP CONTENT ({mockupContents.filter((c) => c.checked).length}/7 TỐI ĐA SELECTION):
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={resetToDefaultContents}
                disabled={!selectedCategory}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline disabled:cursor-not-allowed disabled:opacity-40"
              >
                Mặc định (7 Content)
              </button>
              <button
                type="button"
                onClick={deselectAllAiContents}
                disabled={!selectedCategory}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 underline disabled:cursor-not-allowed disabled:opacity-40"
              >
                Bỏ chọn Content AI
              </button>
              <button
                type="button"
                onClick={() => setShowManageModal(true)}
                disabled={!selectedCategory}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-2xs hover:bg-indigo-700 transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <GearIcon className="h-4 w-4" />
                <span>Quản Lý Content</span>
              </button>
            </div>
          </div>

          {contentNoticeMsg && (
            <div className="mb-2.5 rounded-xl bg-sky-50 border border-sky-200 p-2 text-xs font-extrabold text-sky-900 flex items-center gap-2">
              <span>ℹ️</span>
              <span>{contentNoticeMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {mockupContents.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-xs font-semibold text-slate-500">
                Tạo một mục sản phẩm mới để thiết lập Mockup Content.
              </div>
            )}
            {mockupContents.map((content) => {
              const isMandatory = content.id === 1;
              return (
                <label
                  key={content.id}
                  className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition-all duration-150 select-none ${
                    isMandatory
                      ? "border-sky-400 bg-sky-50/90 text-sky-950 shadow-2xs ring-1 ring-sky-400/30 cursor-not-allowed"
                      : content.checked
                      ? "border-indigo-500 bg-indigo-50/80 text-indigo-950 shadow-2xs ring-1 ring-indigo-400/20 hover:border-indigo-600 cursor-pointer"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50/50 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={content.checked}
                    disabled={isMandatory}
                    onChange={() => toggleContentCheck(content.id)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer shrink-0 disabled:opacity-80 disabled:cursor-not-allowed"
                  />
                  <span className="truncate flex items-center gap-1 min-w-0">
                    {content.label}
                    {isMandatory && (
                      <span className="text-[10px] font-extrabold text-sky-700 bg-sky-200/80 px-1 py-0.5 rounded shrink-0">
                        Bắt buộc
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Manage Mockup Contents Modal (Add / Delete / Reset) */}
      {showManageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <GearIcon className="h-5 w-5 text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900">
                  Quản Lý Danh Sách Mockup Content
                </h3>
              </div>
              <button
                onClick={() => setShowManageModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Add Content Section inside Modal */}
            <div className="flex items-center gap-2 bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-100 shrink-0">
              <input
                type="text"
                value={newContentLabel}
                onChange={(e) => setNewContentLabel(e.target.value)}
                placeholder="Thêm bối cảnh mới (VD: Garden View / Living Room Table)..."
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs font-semibold outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustomContent();
                }}
              />
              <button
                type="button"
                onClick={handleAddCustomContent}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-extrabold text-white shrink-0 hover:bg-indigo-700 transition"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                <span>Thêm Mới</span>
              </button>
            </div>

            <div className="text-xs font-semibold text-slate-500 shrink-0">
              Thêm concept bối cảnh mới hoặc xóa bối cảnh dư thừa. Content 1 là bắt buộc không thể xóa.
            </div>

            {/* List Table */}
            <div className="overflow-y-auto space-y-2 pr-1 flex-1">
              {mockupContents.map((content) => {
                const isMandatory = content.id === 1;
                return (
                  <div
                    key={content.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-xs font-black text-indigo-700 bg-indigo-100 px-2 py-1 rounded-lg shrink-0">
                        #{content.id}
                      </span>
                      <span className="text-xs font-bold text-slate-800 truncate flex items-center gap-2">
                        {content.label}
                        {isMandatory && (
                          <span className="text-[10px] font-extrabold text-sky-700 bg-sky-200/80 px-1.5 py-0.5 rounded">
                            Bắt buộc
                          </span>
                        )}
                        {content.checked && (
                          <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                            Đang chọn
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isMandatory && (
                        <button
                          type="button"
                          onClick={() => handleDeleteContent(content.id)}
                          className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          <span>Xóa</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={handleResetToSystemDefaults}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 underline"
              >
                🔄 Khôi phục danh sách mặc định (10 Content)
              </button>
              <button
                type="button"
                onClick={() => setShowManageModal(false)}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-extrabold text-white shadow-md hover:bg-indigo-700"
              >
                Hoàn Tất / Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Mockup Content Modal */}
      {showAddContentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                Thêm Mockup Content Mới
              </h3>
              <button
                onClick={() => setShowAddContentModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tên bối cảnh Mockup (VD: Living Room Table / Garden View)
              </label>
              <input
                type="text"
                value={newContentLabel}
                onChange={(e) => setNewContentLabel(e.target.value)}
                placeholder="Nhập tên content mockup mới..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs font-semibold outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddContentModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddCustomContent}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white shadow-md hover:bg-indigo-700"
              >
                Lưu Content Mới
              </button>
            </div>
          </div>
        </div>
      )}

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
          className={`flex w-full md:w-1/2 flex-col rounded-2xl border p-5 shadow-sm space-y-4 transition ${draggedFromColumn === "mockup"
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
                {sourceListName}
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
                  Không còn thẻ nào trong cột {sourceListName}!
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Tất cả thẻ thiết kế đã được xử lý và chuyển sang cột {targetListName}.
                </p>
              </div>
            ) : (
              designCards.map((card) => {
                const dims: Dimensions3D = parseCardDimensions(card.desc || "");
                const isSelected = selectedCardIds.has(card.id);
                const backgroundJob = backgroundJobs.find(
                  (job) => job.cardId === card.id,
                );
                const isGenerating =
                  activeGeneratingCardId === card.id ||
                  Boolean(backgroundJob);
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
                    className={`group rounded-2xl border p-4 transition shadow-xs hover:shadow-md cursor-grab active:cursor-grabbing ${isSelected
                        ? "border-indigo-500 bg-indigo-50/30 ring-2 ring-indigo-400/20"
                        : "border-slate-200 bg-white hover:border-indigo-300"
                      } ${isGenerating ? "opacity-90" : ""}`}
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
                        Kích thước / dung tích:{" "}
                        <strong className="text-slate-900 font-bold">
                          {dims.formatted || "Chưa có dữ liệu trong description"}
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
                          {imageAttachments.map((att, idx) => {
                            const stepId =
                              mockupIndexFromAttachmentName(att.name) ||
                              (idx === 0 ? 1 : undefined);
                            const statusKey = `${card.id}_${att.id}`;
                            const currentStatus = approvalMap[statusKey];
                            const isRegeneratingAttachment = stepId
                              ? Boolean(
                                  singleMockupRegenerationJobs[
                                    singleMockupRegenerationKey(card.id, stepId)
                                  ] ||
                                    backgroundRegenerationKeys.has(
                                      singleMockupRegenerationKey(card.id, stepId),
                                    ),
                                )
                              : false;

                            return (
                              <div
                                key={att.id}
                                className={`group relative h-16 w-16 cursor-pointer overflow-hidden rounded-xl border bg-slate-100 shadow-xs transition shrink-0 ${
                                  currentStatus === "approved"
                                    ? "border-emerald-500 ring-2 ring-emerald-500/20"
                                    : currentStatus === "rejected"
                                      ? "border-rose-500 ring-2 ring-rose-500/20"
                                      : "border-slate-200 hover:border-indigo-500"
                                }`}
                                title={att.name}
                              >
                                <img
                                  src={att.thumbnailUrl || att.previewUrl || att.url}
                                  alt={att.name}
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(event) => fallBackToMasterImage(event, att.url)}
                                  onClick={() => {
                                    const stepId = mockupIndexFromAttachmentName(att.name) || (idx === 0 ? 1 : undefined);
                                    setStudioModal({ cardId: card.id, attachmentIndex: idx, stepId, attachmentId: att.id });
                                    setRegenModel(selectedModel);
                                    setRegenPromptNote("");
                                  }}
                                />

                                {isRegeneratingAttachment && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/65 text-white">
                                    <SpinnerIcon className="h-6 w-6 animate-spin" />
                                  </span>
                                )}

                                {currentStatus === "approved" && (
                                  <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs pointer-events-none">
                                    ✓
                                  </span>
                                )}
                                {currentStatus === "rejected" && (
                                  <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs pointer-events-none">
                                    ✕
                                  </span>
                                )}
                              </div>
                            );
                          })}
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
                          onClick={() =>
                            void cancelGeneration(
                              backgroundJob?.id || undefined,
                            )
                          }
                          disabled={
                            Boolean(
                              backgroundJob &&
                                (cancellingJobIds.has(backgroundJob.id) ||
                                  backgroundJob.status === "cancel_requested"),
                            )
                          }
                          className="flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white shadow-md hover:bg-rose-700 active:scale-[0.98] transition shrink-0"
                          title="Dừng tạo mockup & lưu các ảnh đã đính kèm"
                        >
                          {backgroundJob &&
                          (cancellingJobIds.has(backgroundJob.id) ||
                            backgroundJob.status === "cancel_requested") ? (
                            <SpinnerIcon className="h-4 w-4 animate-spin" />
                          ) : (
                            <StopIcon className="h-4 w-4 fill-current" />
                          )}
                          <span>
                            {backgroundJob &&
                            (cancellingJobIds.has(backgroundJob.id) ||
                              backgroundJob.status === "cancel_requested")
                              ? "Đang dừng..."
                              : "Hủy & Lưu"}
                          </span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleGenerateMockupsSingle(card)}
                        disabled={
                          Boolean(activeGeneratingCardId) ||
                          backgroundJobCardIds.has(card.id) ||
                          batchProcessing ||
                          selectedAiMockupCount === 0
                        }
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 transition"
                      >
                        <SparkleIcon className="h-4.5 w-4.5 text-amber-300" />
                        <span>⚡ Tạo {selectedAiMockupCount} Mockup AI</span>
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
          className={`flex w-full md:w-1/2 flex-col rounded-2xl border p-5 shadow-sm space-y-4 transition ${draggedFromColumn === "design"
              ? "border-emerald-400 bg-emerald-50/20 ring-4 ring-emerald-400/20"
              : "border-slate-200 bg-white"
            }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 shadow-xs"></span>
              <h4 className="text-base font-black text-slate-900 uppercase tracking-wide">
                {targetListName}
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
                  Chưa có thẻ nào trong cột {targetListName}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Bấm nút tạo Mockup hoặc kéo thẻ từ cột {sourceListName} thả vào đây.
                </p>
              </div>
            ) : (
              mockupCards.map((card) => {
                const dims: Dimensions3D = parseCardDimensions(card.desc || "");
                const isGenerating =
                  activeGeneratingCardId === card.id ||
                  backgroundJobCardIds.has(card.id);
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
                            {imageAttachments.length >= 7
                              ? "✨ Đã đủ 7/7 Ảnh Chuẩn"
                              : `${imageAttachments.length} Ảnh Đính Kèm`}
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
                        Kích thước / dung tích:{" "}
                        <strong className="text-slate-900">
                          {dims.formatted || "Chưa có dữ liệu trong description"}
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
                        {imageAttachments.map((att, idx) => {
                          const stepId =
                            mockupIndexFromAttachmentName(att.name) ||
                            (idx === 0 ? 1 : undefined);
                          const statusKey = `${card.id}_${att.id}`;
                          const currentStatus = approvalMap[statusKey];
                          const isRegeneratingAttachment = stepId
                            ? Boolean(
                                singleMockupRegenerationJobs[
                                  singleMockupRegenerationKey(card.id, stepId)
                                ] ||
                                  backgroundRegenerationKeys.has(
                                    singleMockupRegenerationKey(card.id, stepId),
                                  ),
                              )
                            : false;

                          return (
                            <div
                              key={att.id}
                              className={`group relative h-16 w-16 cursor-pointer overflow-hidden rounded-xl border bg-white shadow-xs transition shrink-0 ${
                                currentStatus === "approved"
                                  ? "border-emerald-500 ring-2 ring-emerald-500/20"
                                  : currentStatus === "rejected"
                                    ? "border-rose-500 ring-2 ring-rose-500/20"
                                    : "border-slate-200 hover:border-emerald-500"
                              }`}
                              title={att.name}
                            >
                              <img
                                src={att.thumbnailUrl || att.previewUrl || att.url}
                                alt={att.name}
                                className="h-full w-full object-cover transition group-hover:scale-105"
                                loading="lazy"
                                decoding="async"
                                onError={(event) => fallBackToMasterImage(event, att.url)}
                                onClick={() => {
                                  const stepId = mockupIndexFromAttachmentName(att.name) || (idx === 0 ? 1 : undefined);
                                  setStudioModal({ cardId: card.id, attachmentIndex: idx, stepId, attachmentId: att.id });
                                  setRegenModel(selectedModel);
                                  setRegenPromptNote("");
                                }}
                              />
                              {isRegeneratingAttachment && (
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/65 text-white">
                                  <SpinnerIcon className="h-6 w-6 animate-spin" />
                                </span>
                              )}
                              {currentStatus === "approved" && (
                                <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs pointer-events-none">
                                  ✓
                                </span>
                              )}
                              {currentStatus === "rejected" && (
                                <span className="absolute top-1 right-1 h-3.5 w-3.5 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] font-bold shadow-xs pointer-events-none">
                                  ✕
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      onClick={() => handleGenerateMockupsSingle(card)}
                      disabled={
                        Boolean(activeGeneratingCardId) ||
                        backgroundJobCardIds.has(card.id) ||
                        selectedAiMockupCount === 0
                      }
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
                          <span>Tạo {selectedAiMockupCount} Mockup AI Đã Chọn</span>
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
              <SparkleIcon className="h-4 w-4 text-indigo-600" /> Tiến Trình:{" "}
              {selectedAiMockupCount} Mockup AI Đã Chọn
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
                  className={`flex items-center justify-between rounded-xl p-3 text-xs font-medium border ${status === "success"
                      ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
                      : status === "processing"
                        ? "border-indigo-300 bg-indigo-50/90 text-indigo-900 animate-pulse"
                        : status === "uploading"
                          ? "border-amber-300 bg-amber-50/90 text-amber-900"
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
                    {status === "uploading" && (
                      <span className="text-[10px] font-bold text-amber-700">
                        Đẩy Trello...
                      </span>
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

      {/* Product Preset Studio Modal */}
      <ProductPresetModal
        isOpen={showProductPresetModal}
        onClose={() => setShowProductPresetModal(false)}
        activeCategoryId={selectedCategory}
        onSelectCategory={(catId, contents) => {
          setSelectedCategory(catId);
          setMockupContents(limitSelectedMockupContents(contents));
        }}
        onPresetsUpdated={(updated) => {
          allPresetsRef.current = updated;
          setAllPresets(updated);
          const active = updated.find((p) => p.id === selectedCategory) || updated[0];
          if (active) {
            setSelectedCategory(active.id);
            setMockupContents(limitSelectedMockupContents(active.contents));
          } else {
            setSelectedCategory("");
            setMockupContents([]);
          }
        }}
      />
    </div>
  );
}
