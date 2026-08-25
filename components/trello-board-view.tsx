"use client";

import {
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  CopyIcon,
  DotsThreeIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  FileXlsIcon,
  FunnelIcon,
  GearIcon,
  KanbanIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  RowsIcon,
  SparkleIcon,
  SpinnerIcon,
  SquareIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  WarningCircleIcon,
  XIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrandProfile, ListingTemplateSummary, StoredListing } from "@/lib/types";
import { extractTrelloBoardId } from "@/lib/trello";
import { AutoMockupGenerator } from "@/components/auto-mockup-generator";
import { downloadOriginalTrelloImage } from "@/lib/trello-image-client";
import { readNdjsonStream } from "@/lib/read-ndjson-stream";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { isTemplateReady, templateMatchesBrand, templatesForBrandCatalog } from "@/lib/amazon-template-catalog";
import {
  formatStageDuration,
  TRELLO_LISTING_STAGE_LABELS,
  type TrelloListingStage,
  type TrelloListingStreamEvent,
} from "@/lib/trello-listing-progress";

interface TrelloBoardViewProps {
  brands: BrandProfile[];
  activeTab?: "listing" | "mockups";
  onListingCreated?: (listing: StoredListing) => void;
  showConfigModal?: boolean;
  onCloseConfigModal?: () => void;
}

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  previewUrl?: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  dateLastActivity?: string;
  attachments?: TrelloAttachment[];
  parsed?: {
    sku: string;
    itemName: string;
  };
}

function formatCardDate(isoString?: string) {
  if (!isoString) {
    const now = new Date();
    const dateStr = now.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${dateStr} ${timeStr}`;
  }
  try {
    const d = new Date(isoString);
    const dateStr = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${dateStr} ${timeStr}`;
  } catch {
    return isoString;
  }
}

interface CardProcessProgress {
  message: string;
  progress: number;
  status: "running" | "listing_ready" | "complete" | "warning" | "error" | "cancelled";
  timings: Record<string, number>;
}

export function TrelloBoardView({
  brands,
  activeTab = "listing",
  onListingCreated,
  showConfigModal = false,
  onCloseConfigModal,
}: TrelloBoardViewProps) {
  const [boardId, setBoardId] = useState("");
  const [boardLists, setBoardLists] = useState<TrelloList[]>([]);
  const [listingSourceListId, setListingSourceListId] = useState("");
  const [listingTargetListId, setListingTargetListId] = useState("");
  const [mockupSourceListId, setMockupSourceListId] = useState("");
  const [mockupTargetListId, setMockupTargetListId] = useState("");
  const [brandProfileId, setBrandProfileId] = useState("");
  const [shopId, setShopId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const marketplace = "US" as const;
  const [templates, setTemplates] = useState<ListingTemplateSummary[]>([]);
  const [reviewList, setReviewList] = useState<TrelloList | null>(null);
  const [listingList, setListingList] = useState<TrelloList | null>(null);

  const [reviewCards, setReviewCards] = useState<TrelloCard[]>([]);
  const [listingCards, setListingCards] = useState<TrelloCard[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [processingCardIds, setProcessingCardIds] = useState<Set<string>>(new Set());
  const [cardProcessProgress, setCardProcessProgress] = useState<Record<string, CardProcessProgress>>({});
  const listingAbortControllersRef = useRef(new Map<string, AbortController>());
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);

  // Inline Quick View Drawer for Generated Listing Details (stays 100% on Trello screen)
  const [inspectListing, setInspectListing] = useState<(StoredListing & { trelloCardId?: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const [openDropdown, setOpenDropdown] = useState<"model" | "brand" | "template" | null>(null);
  const AI_MODEL_OPTIONS = useMemo(() => [
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", tag: "Chất lượng cao", icon: "⚡" },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", tag: "Nhanh", icon: "⚡" },
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", tag: "Cân bằng", icon: "⚡" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tag: "Deep Reasoning", icon: "🧠" },
    { value: "gpt-4o", label: "GPT-4o", tag: "Chất lượng cao", icon: "🤖" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", tag: "Nhanh & Tối ưu", icon: "⚡" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", tag: "Mặc định (CheapKey AI)", icon: "💸" },
  ], []);

  const [selectedModel, setSelectedModel] = useState("gpt-5.6-luna");

  // View Layout, Sort, Search, Filter & Pagination states
  const [reviewLayout, setReviewLayout] = useState<"cards" | "compact">("compact");
  const [reviewSort, setReviewSort] = useState<"default" | "sku_asc" | "sku_desc" | "name_asc" | "name_desc">("default");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [listingSearch, setListingSearch] = useState("");
  const [listingFilter, setListingFilter] = useState<"all" | "has_attachment" | "has_excel">("all");
  const [isListingFilterOpen, setIsListingFilterOpen] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPageSize, setReviewPageSize] = useState(20);
  const [listingPage, setListingPage] = useState(1);
  const [listingPageSize, setListingPageSize] = useState(20);
  const [addedBrands, setAddedBrands] = useState<BrandProfile[]>([]);
  const [deletedBrandIds, setDeletedBrandIds] = useState<Set<string>>(new Set());
  const localBrands = useMemo(() => {
    const byId = new Map<string, BrandProfile>();
    for (const brand of [...addedBrands, ...brands]) {
      if (!deletedBrandIds.has(brand.id) && !byId.has(brand.id)) byId.set(brand.id, brand);
    }
    return [...byId.values()];
  }, [addedBrands, brands, deletedBrandIds]);
  const [showAddBrandModal, setShowAddBrandModal] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandGuidelines, setNewBrandGuidelines] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);

  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [newTemplateFile, setNewTemplateFile] = useState<File | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const selectedBrandName = localBrands.find((brand) => brand.id === brandProfileId)?.name || "";
  const selectedTemplateBrand = useMemo(() => ({
    id: brandProfileId || undefined,
    name: selectedBrandName,
  }), [brandProfileId, selectedBrandName]);
  const destinationTemplates = useMemo(
    () => selectedBrandName ? templatesForBrandCatalog(templates, selectedTemplateBrand) : [],
    [selectedBrandName, selectedTemplateBrand, templates],
  );
  const managedPhoiRows = useMemo(() => {
    if (!selectedBrandName) return [];
    const groups = new Map<string, ListingTemplateSummary[]>();
    for (const template of templates) {
      if (template.shop_is_unassigned) continue;
      const group = groups.get(template.phoi_key) || [];
      group.push(template);
      groups.set(template.phoi_key, group);
    }
    return [...groups.values()]
      .map((group) => {
        const target = group.find((template) => templateMatchesBrand(template, selectedTemplateBrand)) || null;
        const readySource = group.find((template) => isTemplateReady(template)) || null;
        return { target, source: readySource || target || group[0] };
      })
      .sort((left, right) => left.source.phoi_name.localeCompare(right.source.phoi_name));
  }, [selectedBrandName, selectedTemplateBrand, templates]);
  const selectedTemplate = templates.find((template) => template.id === templateId) || null;
  const selectedShopName = selectedTemplate?.shop_name || "shop";

  const displayReviewCards = useMemo(() => {
    const list = [...reviewCards];
    if (reviewSort === "sku_asc") {
      list.sort((a, b) => (a.parsed?.sku || a.name).localeCompare(b.parsed?.sku || b.name));
    } else if (reviewSort === "sku_desc") {
      list.sort((a, b) => (b.parsed?.sku || b.name).localeCompare(a.parsed?.sku || a.name));
    } else if (reviewSort === "name_asc") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (reviewSort === "name_desc") {
      list.sort((a, b) => b.name.localeCompare(a.name));
    }
    return list;
  }, [reviewCards, reviewSort]);

  const totalReviewPages = Math.max(1, Math.ceil(displayReviewCards.length / reviewPageSize));
  const paginatedReviewCards = useMemo(() => {
    const start = (reviewPage - 1) * reviewPageSize;
    return displayReviewCards.slice(start, start + reviewPageSize);
  }, [displayReviewCards, reviewPage, reviewPageSize]);

  const displayListingCards = useMemo(() => {
    let list = [...listingCards];
    if (listingSearch.trim()) {
      const q = listingSearch.trim().toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.parsed?.sku && c.parsed.sku.toLowerCase().includes(q)) ||
        (c.desc && c.desc.toLowerCase().includes(q))
      );
    }
    if (listingFilter === "has_attachment") {
      list = list.filter((c) => Boolean(c.attachments && c.attachments.length > 0));
    } else if (listingFilter === "has_excel") {
      list = list.filter((c) =>
        (c.attachments || []).some((a) => /\.(xlsx|csv|xls)$/i.test(a.name) || a.name.toLowerCase().includes("listing")),
      );
    }
    return list;
  }, [listingCards, listingSearch, listingFilter]);

  const totalListingPages = Math.max(1, Math.ceil(displayListingCards.length / listingPageSize));
  const paginatedListingCards = useMemo(() => {
    const start = (listingPage - 1) * listingPageSize;
    return displayListingCards.slice(start, start + listingPageSize);
  }, [displayListingCards, listingPage, listingPageSize]);

  useEffect(() => {
    if (!destinationTemplates.length) {
      if (templateId) setTemplateId("");
      return;
    }
    const current = templates.find((template) => template.id === templateId);
    const replacement = current
      ? destinationTemplates.find((template) =>
        template.phoi_key === current.phoi_key && isTemplateReady(template),
      ) || destinationTemplates.find((template) => template.phoi_key === current.phoi_key)
      : null;
    const readyFirst = destinationTemplates.find(isTemplateReady) || destinationTemplates[0];
    const next = (replacement && isTemplateReady(replacement)) ? replacement : (readyFirst || destinationTemplates[0]);
    if (next && next.id !== templateId) setTemplateId(next.id);
    if (next && next.shop_id !== shopId) setShopId(next.shop_id);
  }, [destinationTemplates, shopId, templateId, templates]);

  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    setAddingBrand(true);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBrandName.trim(), guidelines: newBrandGuidelines.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tạo thương hiệu.");
      if (data.brand) {
        setAddedBrands((current) => [data.brand, ...current.filter((brand) => brand.id !== data.brand.id)]);
        setBrandProfileId(data.brand.id);
      }
      setNewBrandName("");
      setNewBrandGuidelines("");
      setShowAddBrandModal(false);
      setSuccessMsg(`Đã thêm thương hiệu "${newBrandName.trim()}" thành công!`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi thêm thương hiệu.");
    } finally {
      setAddingBrand(false);
    }
  };

  const handleAddTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandProfileId || !selectedBrandName) {
      setError("Hãy chọn Brand trước khi tải template.");
      return;
    }
    if (!newTemplateFile) return;
    setAddingTemplate(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("template", newTemplateFile);
      if (brandProfileId) formData.append("brand_profile_id", brandProfileId);

      const res = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải lên template.");
      await fetchTemplateCatalog();
      if (data.brand) {
        setAddedBrands((current) => [data.brand, ...current.filter((b) => b.id !== data.brand.id)]);
        setBrandProfileId(data.brand.id);
      }
      if (data.template) {
        setShopId(data.template.shop_id);
        if (data.template.is_ready !== false && !data.is_blank) {
          setTemplateId(data.template.id);
        }
      }
      setNewTemplateFile(null);
      setShowAddTemplateModal(false);
      if (data.is_blank || data.template?.is_ready === false) {
        setError(`⚠️ Đã lưu file blank "${data.template?.name || newTemplateFile.name}". Lưu ý: File này CHƯA THỂ DÙNG vì chưa có dòng mẫu Parent/Child và chưa có phôi cùng loại từ shop khác để tự động map. Hãy mở file Excel điền dòng mẫu hoặc tải lên phôi đã điền của shop khác.`);
      } else {
        const mappingMessage = data.mapping
          ? ` Đã tự map ${data.mapping.mapped_values}/${data.mapping.source_values} ô từ phôi cùng loại.`
          : "";
        setSuccessMsg(`✅ Đã nhận diện Store "${data.shop?.name || data.brand?.name || "Shop"}" và kích hoạt template "${data.template?.name || newTemplateFile.name}" sẵn sàng sử dụng!${mappingMessage}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi thêm template.");
    } finally {
      setAddingTemplate(false);
    }
  };

  const fetchTemplateCatalog = useCallback(async () => {
    try {
      const templateResponse = await fetch("/api/templates");
      if (!templateResponse.ok) return;
      const templateData = await templateResponse.json();
      const loadedTemplates: ListingTemplateSummary[] = templateData.templates || [];
      setTemplates(loadedTemplates);
      setShopId((previousShopId) => {
        const nextShopId = loadedTemplates.some((template) => template.shop_id === previousShopId)
          ? previousShopId
          : loadedTemplates[0]?.shop_id || "";
        setTemplateId((previousTemplateId) => {
          const previousIsValid = loadedTemplates.some(
            (template) => template.id === previousTemplateId && template.shop_id === nextShopId,
          );
          return previousIsValid
            ? previousTemplateId
            : loadedTemplates.find((template) => template.shop_id === nextShopId)?.id || "";
        });
        return nextShopId;
      });
    } catch (err) {
      console.error(err);
    }
  }, []);

  const selectDestination = (nextTemplateId: string) => {
    if (nextTemplateId === "__ADD_NEW__") {
      openAddTemplateModal();
      return;
    }
    const nextTemplate = templates.find((template) => template.id === nextTemplateId);
    if (nextTemplate && !isTemplateReady(nextTemplate)) {
      setError(`⚠️ Template "${nextTemplate.name}" là file blank chưa thể dùng vì chưa có dòng mẫu Parent/Child. Vui lòng mở file Excel điền dữ liệu mẫu hoặc nạp template cùng phôi từ shop khác để tự động map.`);
      return;
    }
    setTemplateId(nextTemplate?.id || "");
    setShopId(nextTemplate?.shop_id || "");
  };

  const openAddTemplateModal = () => {
    if (!brandProfileId || !selectedBrandName) {
      setError("Hãy chọn hoặc thêm Brand trước khi tải template.");
      setShowAddBrandModal(true);
      return;
    }
    setShowTemplateManager(false);
    setShowAddTemplateModal(true);
  };

  const loadCards = useCallback(
    async (bId: string) => {
      if (!extractTrelloBoardId(bId)) {
        setShowConfig(true);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/trello/cards");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Không thể tải thẻ Trello.");
        setReviewList(data.internalReviewList);
        setListingList(data.listingList);
        setBoardLists(data.lists || []);
        setReviewCards(data.reviewCards || []);
        setListingCards(data.listingCards || []);
        setSelectedCardIds(new Set());
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải Trello.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/trello/config");
      const data = await res.json();
      if (res.ok) {
        const finalBoardId = extractTrelloBoardId(data.boardId || "");
        if (finalBoardId) setBoardId(finalBoardId);
        setListingSourceListId(data.listingSourceListId || "");
        setListingTargetListId(data.listingTargetListId || "");
        setMockupSourceListId(data.mockupSourceListId || "");
        setMockupTargetListId(data.mockupTargetListId || "");

        const activeFlowConfigured = activeTab === "listing"
          ? Boolean(data.listingSourceListId && data.listingTargetListId)
          : Boolean(data.mockupSourceListId && data.mockupTargetListId);

        if (finalBoardId && activeTab === "mockups") {
          const listsResponse = await fetch("/api/trello/config?action=get-lists");
          const listsPayload = await listsResponse.json();
          if (listsResponse.ok) setBoardLists(listsPayload.lists || []);
        }

        if (data.configured && finalBoardId && activeFlowConfigured) {
          setShowConfig(false);
          if (activeTab === "listing") await loadCards(finalBoardId);
        } else {
          setShowConfig(true);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [activeTab, loadCards]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const legacyKey of [
        "trello_api_key",
        "trello_token",
        "trello_board_id",
        "trello_review_list_name",
        "trello_listing_list_name",
      ]) {
        localStorage.removeItem(legacyKey);
      }
      void fetchTemplateCatalog();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchTemplateCatalog]);

  useEffect(() => {
    setError("");
    setSuccessMsg("");
    const timer = window.setTimeout(() => void fetchConfig(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchConfig]);

  useEffect(() => () => {
    batchAbortControllerRef.current?.abort();
    for (const controller of listingAbortControllersRef.current.values()) {
      controller.abort();
    }
    listingAbortControllersRef.current.clear();
  }, []);

  const inspectBoard = async () => {
    const cleanId = extractTrelloBoardId(boardId);
    if (!cleanId) {
      setError("Vui lòng nhập Board ID hoặc URL Trello Board.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect-board", boardId: cleanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể kết nối Trello.");
      setBoardId(data.boardId);
      setBoardLists(data.lists || []);
      if (activeTab === "listing") {
        setListingSourceListId("");
        setListingTargetListId("");
      } else {
        setMockupSourceListId("");
        setMockupTargetListId("");
      }
      setSuccessMsg(`Board hợp lệ. Hãy chọn hai cột cho ${activeTab === "listing" ? "Listing" : "Mockup"}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi kết nối Trello.");
    } finally {
      setLoading(false);
    }
  };

  const saveWorkflowConfig = async () => {
    const cleanId = extractTrelloBoardId(boardId);
    const sourceListId = activeTab === "listing" ? listingSourceListId : mockupSourceListId;
    const targetListId = activeTab === "listing" ? listingTargetListId : mockupTargetListId;
    if (!cleanId || !sourceListId || !targetListId) {
      setError(`Vui lòng chọn cột đầu và cột đích cho ${activeTab === "listing" ? "Listing" : "Mockup"}.`);
      return;
    }
    if (sourceListId === targetListId) {
      setError("Cột đầu và cột đích phải khác nhau.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeTab === "listing"
          ? {
            action: "save-listing-settings",
            boardId: cleanId,
            listingSourceListId,
            listingTargetListId,
          }
          : {
            action: "save-mockup-settings",
            boardId: cleanId,
            mockupSourceListId,
            mockupTargetListId,
          }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể lưu cấu hình Trello.");
      setListingSourceListId(data.listingSourceListId || "");
      setListingTargetListId(data.listingTargetListId || "");
      setMockupSourceListId(data.mockupSourceListId || "");
      setMockupTargetListId(data.mockupTargetListId || "");
      setSuccessMsg(`Đã lưu hai cột ${activeTab === "listing" ? "Listing" : "Mockup"}.`);
      setShowConfig(false);
      if (activeTab === "listing") await loadCards(data.boardId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi lưu cấu hình Trello.");
    } finally {
      setLoading(false);
    }
  };

  const cancelCardListing = useCallback((cardId: string) => {
    listingAbortControllersRef.current.get(cardId)?.abort();
  }, []);

  const runCardListing = async (card: TrelloCard, openWhenReady: boolean) => {
    if (!brandProfileId || !selectedBrandName) {
      throw new Error("Hãy chọn Brand trước khi tạo listing.");
    }
    if (!shopId || !templateId) {
      throw new Error(`Hãy tải blank template của ${selectedBrandName} trước khi tạo listing.`);
    }
    listingAbortControllersRef.current.get(card.id)?.abort();
    const abortController = new AbortController();
    listingAbortControllersRef.current.set(card.id, abortController);
    setProcessingCardIds((current) => new Set(current).add(card.id));
    setCardProcessProgress((current) => ({
      ...current,
      [card.id]: {
        message: "Đang bắt đầu xử lý thẻ...",
        progress: 1,
        status: "running",
        timings: {},
      },
    }));
    let readyListing: StoredListing | null = null;
    let completedAttachment: { id: string; name: string; url: string } | null = null;

    try {
      const res = await fetch("/api/trello/process-card", {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          cardId: card.id,
          brandProfileId: brandProfileId || undefined,
          marketplace,
          shopId,
          templateId: templateId || undefined,
          model: selectedModel,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Lỗi tạo Listing.");
      }

      await readNdjsonStream<TrelloListingStreamEvent>(res, (event) => {
        if (event.type === "error") throw new Error(event.message);

        if (event.type === "progress") {
          setCardProcessProgress((current) => ({
            ...current,
            [card.id]: {
              message: event.message,
              progress: event.progress,
              status: "running",
              timings: event.timings_ms,
            },
          }));
          return;
        }

        if (event.type === "listing_ready") {
          readyListing = event.listing;
          setCardProcessProgress((current) => ({
            ...current,
            [card.id]: {
              message: event.message,
              progress: event.progress,
              status: "listing_ready",
              timings: event.timings_ms,
            },
          }));
          onListingCreated?.(event.listing);
          if (openWhenReady) {
            setInspectListing({ ...event.listing, trelloCardId: event.card_id });
            setSuccessMsg(`Listing của SKU ${event.sku} đã sẵn sàng. Excel và Trello đang hoàn tất nền.`);
          }
          return;
        }

        if (event.type === "warning") {
          setCardProcessProgress((current) => ({
            ...current,
            [card.id]: {
              message: event.message,
              progress: current[card.id]?.progress || 84,
              status: "warning",
              timings: event.timings_ms,
            },
          }));
          return;
        }

        completedAttachment = event.attachment || null;
        setCardProcessProgress((current) => ({
          ...current,
          [card.id]: {
            message: event.message,
            progress: 100,
            status: "complete",
            timings: event.timings_ms,
          },
        }));
      });

      if (!readyListing) throw new Error("Server kết thúc nhưng chưa trả về listing.");
      return { listing: readyListing, attachment: completedAttachment };
    } catch (requestError) {
      const cancelled = abortController.signal.aborted;
      setCardProcessProgress((current) => ({
        ...current,
        [card.id]: {
          message: cancelled
            ? "Đã ngắt quá trình tạo Listing."
            : requestError instanceof Error ? requestError.message : "Không thể tạo listing.",
          progress: current[card.id]?.progress || 0,
          status: cancelled ? "cancelled" : "error",
          timings: current[card.id]?.timings || {},
        },
      }));
      throw requestError;
    } finally {
      if (listingAbortControllersRef.current.get(card.id) === abortController) {
        listingAbortControllersRef.current.delete(card.id);
      }
      setProcessingCardIds((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
    }
  };

  const processCardToListing = async (card: TrelloCard) => {
    setError("");
    setSuccessMsg("");
    try {
      const completed = await runCardListing(card, true);
      setSuccessMsg(completed.attachment
        ? `Đã tạo listing và đính kèm Excel cho SKU ${card.parsed?.sku || card.name}.`
        : `Đã tạo listing cho SKU ${card.parsed?.sku || card.name}; cần kiểm tra lại file Excel trên Trello.`);

      await loadCards(boardId);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setSuccessMsg(`Đã ngắt tạo Listing cho ${card.parsed?.sku || card.name}.`);
      } else {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo Listing từ thẻ Trello.");
      }
    }
  };

  const handleDeleteBrand = async (targetId?: string) => {
    const idToDelete = targetId || brandProfileId;
    if (!idToDelete) return;
    const brandObj = localBrands.find((b) => b.id === idToDelete);
    const brandName = brandObj ? brandObj.name : "này";
    if (!confirm(`Bạn có chắc chắn muốn xóa thương hiệu "${brandName}" không?`)) return;
    try {
      const res = await fetch(`/api/brands?id=${idToDelete}`, { method: "DELETE" });
      if (res.ok) {
        setAddedBrands((current) => current.filter((brand) => brand.id !== idToDelete));
        setDeletedBrandIds((current) => new Set(current).add(idToDelete));
        if (brandProfileId === idToDelete) setBrandProfileId("");
        setSuccessMsg(`Đã xóa thương hiệu "${brandName}" thành công.`);
        setError("");
      } else {
        setError("Không thể xóa thương hiệu.");
      }
    } catch {
      setError("Lỗi khi xóa thương hiệu.");
    }
  };

  const handleDeleteTemplate = async (target: ListingTemplateSummary) => {
    if (!confirm(`Xóa blank "${target.name}"? Sau đó ${selectedBrandName} sẽ không thể xuất phôi này cho tới khi tải blank mới.`)) return;
    try {
      const response = await fetch(`/api/templates?id=${target.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Không thể xóa template.");
      await fetchTemplateCatalog();
      setSuccessMsg(`Đã xóa template "${target.name}".`);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể xóa template.");
    }
  };

  const toggleSelectCard = (cardId: string) => {
    const next = new Set(selectedCardIds);
    if (next.has(cardId)) {
      next.delete(cardId);
    } else {
      next.add(cardId);
    }
    setSelectedCardIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedCardIds.size === reviewCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(reviewCards.map((c) => c.id)));
    }
  };

  const processBatchListings = async () => {
    if (selectedCardIds.size === 0) return;
    const cardsToProcess = reviewCards.filter((c) => selectedCardIds.has(c.id));
    const batchAbortController = new AbortController();
    batchAbortControllerRef.current?.abort();
    batchAbortControllerRef.current = batchAbortController;
    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: cardsToProcess.length });
    setError("");
    setSuccessMsg("");

    let successCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let postProcessWarningCount = 0;
    const batchErrors: string[] = [];
    await runWithConcurrency(cardsToProcess, 2, async (card) => {
      if (batchAbortController.signal.aborted) {
        cancelledCount += 1;
        completedCount += 1;
        setBatchProgress({ current: completedCount, total: cardsToProcess.length });
        return;
      }
      try {
        const completed = await runCardListing(card, false);
        successCount += 1;
        if (!completed.attachment) postProcessWarningCount += 1;
      } catch (err) {
        if ((err instanceof DOMException && err.name === "AbortError") || batchAbortController.signal.aborted) {
          cancelledCount += 1;
        } else {
          console.error(`Lỗi tạo batch cho card ${card.id}:`, err);
          batchErrors.push(`${card.parsed?.sku || card.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        completedCount += 1;
        setBatchProgress({ current: completedCount, total: cardsToProcess.length });
      }
    });

    if (batchAbortControllerRef.current === batchAbortController) {
      batchAbortControllerRef.current = null;
    }
    setBatchProcessing(false);
    if (successCount > 0) {
      setSuccessMsg(postProcessWarningCount > 0
        ? `Đã tạo ${successCount}/${cardsToProcess.length} listing; ${postProcessWarningCount} thẻ cần kiểm tra lại Excel hoặc Trello.`
        : `Đã tạo ${successCount}/${cardsToProcess.length} listing và đính kèm đầy đủ file Excel lên Trello.`);
    }
    if (batchErrors.length > 0) {
      setError(`Lỗi khi tạo Listing: ${batchErrors.join("; ")}`);
    }
    if (cancelledCount > 0) {
      setSuccessMsg(`Đã ngắt ${cancelledCount} Listing trong Batch; hoàn tất ${successCount}/${cardsToProcess.length} thẻ.`);
    }
    await loadCards(boardId);
  };

  const cancelBatchListings = () => {
    batchAbortControllerRef.current?.abort();
    for (const controller of listingAbortControllersRef.current.values()) {
      controller.abort();
    }
    setSuccessMsg("Đang ngắt các Listing trong Batch...");
  };

  const copyListingText = async (listing: StoredListing) => {
    const c = listing.current_listing;
    const text = [
      `TITLE: ${c.title}`,
      "",
      ...c.bullet_points.map((b, i) => `BULLET ${i + 1}: ${b}`),
      "",
      `DESCRIPTION:\n${c.description}`,
      "",
      `GENERIC KEYWORDS:\n${c.backend_search_terms}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeProgressCards = reviewCards
    .filter((card) => processingCardIds.has(card.id))
    .map((card) => ({ card, progress: cardProcessProgress[card.id] }))
    .filter((item): item is { card: TrelloCard; progress: CardProcessProgress } => Boolean(item.progress));

  return (
    <div className="relative flex h-full w-full flex-col bg-slate-50/60 text-slate-800 font-sans">
      {/* Prominent Header Control Cards Panel - Only for Listing tab */}
      {activeTab === "listing" && (
        <div className="flex flex-col border-b border-slate-200/80 bg-white px-6 py-4 shadow-2xs gap-4 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Title Section */}
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm shadow-indigo-500/25">
                <KanbanIcon className="h-6 w-6" weight="duotone" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900 tracking-tight">Bảng Trello Kanban</h2>
                <p className="text-xs font-semibold text-slate-400">Quản lý quy trình tạo và xuất listing</p>
              </div>
            </div>

            {/* Control Cards Row */}
            <div className="relative flex flex-wrap items-center gap-3">
              {/* Backdrop to close dropdown on outside click */}
              {openDropdown && (
                <div
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setOpenDropdown(null)}
                />
              )}

              {/* AI Model Card Dropdown */}
              <div className="relative z-40">
                <button
                  type="button"
                  onClick={() => setOpenDropdown((prev) => (prev === "model" ? null : "model"))}
                  className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-left transition-all duration-150 cursor-pointer shadow-2xs ${openDropdown === "model"
                    ? "border-purple-400 bg-white ring-2 ring-purple-100 shadow-xs"
                    : "border-slate-200/80 bg-slate-50/90 hover:border-purple-300 hover:bg-white hover:shadow-xs"
                    }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-purple-100 text-purple-700 shrink-0">
                    <SparkleIcon className="h-4 w-4" weight="fill" />
                  </div>
                  <div className="min-w-0 pr-1">
                    <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">AI MODEL</label>
                    <div className="flex items-center gap-1 text-xs font-bold text-slate-900">
                      <span className="truncate max-w-[160px]">
                        {AI_MODEL_OPTIONS.find((m) => m.value === selectedModel)?.icon}{" "}
                        {AI_MODEL_OPTIONS.find((m) => m.value === selectedModel)?.label || selectedModel}
                      </span>
                      <CaretDownIcon
                        className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${openDropdown === "model" ? "rotate-180 text-purple-600" : ""
                          }`}
                        weight="bold"
                      />
                    </div>
                  </div>
                </button>

                {openDropdown === "model" && (
                  <div className="absolute left-0 top-full mt-2 w-72 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-50">
                    <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      Chọn Model AI
                    </div>
                    <div className="mt-1 space-y-0.5 max-h-64 overflow-y-auto thin-scrollbar">
                      {AI_MODEL_OPTIONS.map((item) => {
                        const active = item.value === selectedModel;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => {
                              setSelectedModel(item.value);
                              setOpenDropdown(null);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${active
                              ? "bg-purple-50 text-purple-900 font-extrabold"
                              : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                              }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm">{item.icon}</span>
                              <div className="min-w-0">
                                <div className="truncate">{item.label}</div>
                                <span className="text-[10px] font-medium text-slate-400">{item.tag}</span>
                              </div>
                            </div>
                            {active && <CheckIcon className="h-4 w-4 text-purple-600 shrink-0" weight="bold" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Brand Card Dropdown */}
              <div className="relative z-40">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown((prev) => (prev === "brand" ? null : "brand"))}
                    className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-left transition-all duration-150 cursor-pointer shadow-2xs ${openDropdown === "brand"
                      ? "border-blue-400 bg-white ring-2 ring-blue-100 shadow-xs"
                      : "border-slate-200/80 bg-slate-50/90 hover:border-blue-300 hover:bg-white hover:shadow-xs"
                      }`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-100 text-blue-700 shrink-0">
                      <TagIcon className="h-4 w-4" weight="bold" />
                    </div>
                    <div className="min-w-0 pr-1">
                      <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-wider">THƯƠNG HIỆU</label>
                      <div className="flex items-center gap-1 text-xs font-bold text-slate-900">
                        <span className="truncate max-w-[130px]">
                          {localBrands.find((b) => b.id === brandProfileId)?.name || "Chọn Brand..."}
                        </span>
                        <CaretDownIcon
                          className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${openDropdown === "brand" ? "rotate-180 text-blue-600" : ""
                            }`}
                          weight="bold"
                        />
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAddBrandModal(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 text-sm font-black transition shrink-0 cursor-pointer shadow-2xs"
                    title="Thêm thương hiệu mới"
                  >
                    +
                  </button>
                </div>

                {openDropdown === "brand" && (
                  <div className="absolute left-0 top-full mt-2 w-64 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-50">
                    <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      Thương Hiệu
                    </div>
                    <div className="mt-1 space-y-0.5 max-h-56 overflow-y-auto thin-scrollbar">
                      <button
                        type="button"
                        onClick={() => {
                          setBrandProfileId("");
                          setOpenDropdown(null);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${!brandProfileId
                          ? "bg-blue-50 text-blue-900 font-extrabold"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                          }`}
                      >
                        <span>Không chọn brand</span>
                        {!brandProfileId && <CheckIcon className="h-4 w-4 text-blue-600" weight="bold" />}
                      </button>
                      {localBrands.map((b) => {
                        const active = b.id === brandProfileId;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              setBrandProfileId(b.id);
                              setOpenDropdown(null);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${active
                              ? "bg-blue-50 text-blue-900 font-extrabold"
                              : "text-slate-800 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                              }`}
                          >
                            <span className="truncate">{b.name}</span>
                            {active && <CheckIcon className="h-4 w-4 text-blue-600 shrink-0" weight="bold" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-1 border-t border-slate-100 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddBrandModal(true);
                          setOpenDropdown(null);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                      >
                        <span>+ Thêm thương hiệu mới...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Template Card Dropdown */}
              <div className="relative z-40">
                {(() => {
                  const readyTemplates = destinationTemplates.filter(isTemplateReady);
                  const blankTemplates = destinationTemplates.filter((t) => !isTemplateReady(t));
                  const isCurrentReady = isTemplateReady(selectedTemplate);

                  return (
                    <>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setOpenDropdown((prev) => (prev === "template" ? null : "template"))}
                          className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-left transition-all duration-150 cursor-pointer shadow-2xs ${
                            openDropdown === "template"
                              ? isCurrentReady
                                ? "border-emerald-400 bg-white ring-2 ring-emerald-100 shadow-xs"
                                : "border-amber-400 bg-white ring-2 ring-amber-100 shadow-xs"
                              : isCurrentReady
                                ? "border-emerald-200/80 bg-emerald-50/60 hover:border-emerald-400 hover:bg-emerald-50/90 hover:shadow-xs"
                                : destinationTemplates.length > 0
                                  ? "border-amber-300 bg-amber-50/80 hover:border-amber-400 hover:bg-amber-100/90 hover:shadow-xs"
                                  : "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-slate-100/90"
                          }`}
                        >
                          <div className={`flex h-7 w-7 items-center justify-center rounded-xl shrink-0 ${
                            isCurrentReady
                              ? "bg-emerald-200/80 text-emerald-800"
                              : destinationTemplates.length > 0
                                ? "bg-amber-200/80 text-amber-800"
                                : "bg-slate-200 text-slate-700"
                          }`}>
                            {isCurrentReady ? (
                              <StorefrontIcon className="h-4 w-4" weight="bold" />
                            ) : (
                              <WarningCircleIcon className="h-4 w-4 text-amber-800" weight="fill" />
                            )}
                          </div>
                          <div className="min-w-0 pr-1">
                            <div className="flex items-center gap-1.5">
                              <label className={`block text-[9px] font-extrabold uppercase tracking-wider ${
                                isCurrentReady ? "text-emerald-800" : destinationTemplates.length > 0 ? "text-amber-800" : "text-slate-600"
                              }`}>TEMPLATE</label>
                              {isCurrentReady ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] font-black bg-emerald-100 text-emerald-800">
                                  Sẵn sàng
                                </span>
                              ) : destinationTemplates.length > 0 ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[8px] font-black bg-amber-200 text-amber-900">
                                  Cần điền mẫu
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 text-xs font-bold text-slate-900">
                              <span className="truncate max-w-[170px]">
                                {selectedTemplate?.name || (destinationTemplates.length === 0 ? "Chưa có template" : "Chọn template...")}
                              </span>
                              <CaretDownIcon
                                className={`h-3 w-3 ${isCurrentReady ? "text-emerald-700" : "text-amber-700"} transition-transform duration-200 ${
                                  openDropdown === "template" ? "rotate-180" : ""
                                }`}
                                weight="bold"
                              />
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={openAddTemplateModal}
                          aria-label="Quản lý và thêm template"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 text-xs font-black text-emerald-900 transition hover:bg-emerald-200 cursor-pointer shadow-2xs"
                          title="Quản lý và thêm template"
                        >
                          +
                        </button>
                      </div>

                      {openDropdown === "template" && (
                        <div className="absolute left-0 top-full mt-2 w-80 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-50">
                          <div className="flex items-center justify-between px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                            <span>Template</span>
                            <span>{selectedBrandName || "Chưa chọn Brand"}</span>
                          </div>
                          <div className="mt-1 space-y-1 max-h-64 overflow-y-auto thin-scrollbar p-0.5">
                            {destinationTemplates.length === 0 && !managedPhoiRows.some((r) => !r.target) ? (
                              <div className="px-3 py-3 text-center text-xs text-slate-400 italic">
                                Chưa có template nào.
                              </div>
                            ) : (
                              <>
                                {/* Sẵn sàng - Đánh dấu xanh */}
                                {readyTemplates.length > 0 && (
                                  <div>
                                    <div className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-50/80 rounded-md mb-1">
                                      Sẵn sàng ({readyTemplates.length})
                                    </div>
                                    {readyTemplates.map((t) => {
                                      const active = t.id === templateId;
                                      return (
                                        <button
                                          key={t.id}
                                          type="button"
                                          onClick={() => {
                                            selectDestination(t.id);
                                            setOpenDropdown(null);
                                          }}
                                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer my-0.5 ${
                                            active
                                              ? "bg-emerald-50 text-emerald-900 font-extrabold border border-emerald-300"
                                              : "text-slate-800 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 min-w-0 pr-2">
                                            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                                            <span className="truncate">{t.name}</span>
                                          </div>
                                          {active ? (
                                            <CheckIcon className="h-4 w-4 text-emerald-600 shrink-0" weight="bold" />
                                          ) : (
                                            <span className="rounded bg-emerald-100/70 px-1.5 py-0.2 text-[8px] font-bold text-emerald-800 shrink-0">
                                              Dùng
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* File Blank chưa map - Đánh cảnh báo */}
                                {blankTemplates.length > 0 && (
                                  <div className="mt-1.5">
                                    <div className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-amber-900 bg-amber-100/80 rounded-md mb-1">
                                      Chưa điền mẫu ({blankTemplates.length})
                                    </div>
                                    {blankTemplates.map((t) => (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                          setError(`⚠️ Template "${t.name}" là file blank chưa có dòng mẫu Parent/Child. Hãy mở Excel điền mẫu hoặc nạp file cùng phôi từ shop khác.`);
                                          openAddTemplateModal();
                                          setOpenDropdown(null);
                                        }}
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs bg-amber-50/50 border border-amber-200/90 hover:bg-amber-100/50 text-slate-800 transition cursor-pointer my-1 group"
                                        title="Chưa có dòng mẫu. Bấm để xem."
                                      >
                                        <div className="min-w-0 pr-2">
                                          <div className="flex items-center gap-1.5">
                                            <WarningCircleIcon className="h-3.5 w-3.5 text-amber-600 shrink-0" weight="fill" />
                                            <p className="font-bold text-slate-900 truncate">{t.name}</p>
                                          </div>
                                          <p className="text-[10px] text-amber-800 mt-0.5">Cần điền dòng mẫu</p>
                                        </div>
                                        <span className="shrink-0 rounded-lg bg-amber-200/80 px-2 py-0.5 text-[9px] font-black text-amber-950 group-hover:bg-amber-300">
                                          Cần điền
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}

                                {/* Phôi có sẵn từ shop khác nhưng thiếu blank */}
                                {managedPhoiRows.filter((r) => !r.target).length > 0 && (
                                  <div className="mt-1.5">
                                    <div className="px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-600 bg-slate-100 rounded-md mb-1">
                                      Phôi từ shop khác
                                    </div>
                                    {managedPhoiRows.filter((r) => !r.target).map(({ source }) => (
                                      <button
                                        key={source.phoi_key}
                                        type="button"
                                        onClick={() => {
                                          openAddTemplateModal();
                                          setOpenDropdown(null);
                                        }}
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 transition cursor-pointer group"
                                        title={`Phôi ${source.phoi_name} đã có mẫu từ ${source.shop_name}. Bấm để nạp blank.`}
                                      >
                                        <div className="min-w-0 pr-2">
                                          <p className="font-bold text-slate-900 truncate">{source.phoi_name}</p>
                                          <p className="text-[10px] text-slate-500 truncate">Mẫu từ {source.shop_name}</p>
                                        </div>
                                        <span className="shrink-0 rounded-lg bg-blue-100 px-2 py-0.5 text-[9px] font-extrabold text-blue-900 group-hover:bg-blue-200">
                                          + Nạp Blank
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          <div className="mt-1 border-t border-slate-100 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                openAddTemplateModal();
                                setOpenDropdown(null);
                              }}
                              className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer"
                            >
                              <span>+ Thêm template...</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Refresh / Reload Cards Button */}
              <button
                type="button"
                onClick={() => {
                  if (boardId) loadCards(boardId);
                }}
                disabled={loading}
                className="flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:border-slate-300 transition duration-150 disabled:opacity-60 cursor-pointer"
                title="Làm mới danh sách thẻ Trello ngay lập tức"
              >
                <ArrowsClockwiseIcon className={`h-4 w-4 text-indigo-600 ${loading ? "animate-spin" : ""}`} weight="bold" />
                <span>{loading ? "Đang làm mới..." : "Làm Mới"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Bar */}
      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2.5 text-xs font-semibold text-red-700">
          <WarningCircleIcon className="h-4 w-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-6 py-2.5 text-xs font-semibold text-emerald-700">
          <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {activeProgressCards.length > 0 && (
        <section
          className="border-b border-sky-200 bg-sky-50 px-6 py-3"
          aria-label="Tiến độ tạo listing"
          aria-live="polite"
        >
          <div className="mx-auto grid max-w-6xl gap-2 md:grid-cols-2">
            {activeProgressCards.map(({ card, progress }) => {
              const completedTimings = Object.entries(progress.timings)
                .filter(([, duration]) => duration >= 0)
                .slice(-5);
              return (
                <div key={card.id} className="rounded-xl border border-sky-200 bg-white px-3.5 py-3 shadow-2xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-slate-900">
                        {card.parsed?.sku || card.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-medium text-sky-800">{progress.message}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs font-bold text-sky-700">{progress.progress}%</span>
                      <button
                        type="button"
                        onClick={() => cancelCardListing(card.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-extrabold text-red-700 hover:bg-red-100"
                      >
                        Ngắt
                      </button>
                    </div>
                  </div>
                  <progress
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full accent-sky-600"
                    max={100}
                    value={progress.progress}
                    aria-label={`Tiến độ ${card.parsed?.sku || card.name}`}
                  />
                  {completedTimings.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500">
                      {completedTimings.map(([stage, duration]) => (
                        <span key={stage}>
                          {TRELLO_LISTING_STAGE_LABELS[stage as TrelloListingStage] || stage}: {formatStageDuration(duration)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Trello Config Modal Dialog */}
      {(showConfig || showConfigModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <GearIcon className="h-5 w-5 text-indigo-600" weight="bold" />
                  <span>Cấu hình Trello Workflow</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Cấu hình Board và các cột tự động cho cả Listing & Mockup.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowConfig(false);
                  onCloseConfigModal?.();
                }}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-extrabold text-slate-700">Board ID / URL Trello Board</label>
                <input
                  type="text"
                  value={boardId}
                  onChange={(e) => {
                    setBoardId(extractTrelloBoardId(e.target.value));
                    setBoardLists([]);
                    setListingSourceListId("");
                    setListingTargetListId("");
                    setMockupSourceListId("");
                    setMockupTargetListId("");
                  }}
                  placeholder="https://trello.com/b/UaCRcUxZ/test-project hoặc UaCRcUxZ"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                />
              </div>

              {boardLists.length > 0 && (
                <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                  {[
                    ["Cột đầu — Listing", listingSourceListId, setListingSourceListId],
                    ["Cột đích — Listing", listingTargetListId, setListingTargetListId],
                    ["Cột đầu — Mockup", mockupSourceListId, setMockupSourceListId],
                    ["Cột đích — Mockup", mockupTargetListId, setMockupTargetListId],
                  ].map(([label, value, setter]) => (
                    <div key={label as string}>
                      <label className="mb-1 block text-xs font-extrabold text-slate-700">{label as string}</label>
                      <select
                        value={value as string}
                        onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-indigo-500"
                      >
                        <option value="">-- Chọn cột Trello --</option>
                        {boardLists.map((list) => (
                          <option key={list.id} value={list.id}>{list.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="md:col-span-2 text-[11px] font-medium text-slate-500">
                    Khi hoàn tất, thẻ sẽ được chuyển từ cột đầu sang cột đích của từng chức năng tương ứng.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={inspectBoard}
                disabled={loading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
              >
                {loading ? "Đang kiểm tra..." : "Kiểm Tra & Tải Danh Sách Cột"}
              </button>
              {boardLists.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await saveWorkflowConfig();
                    onCloseConfigModal?.();
                  }}
                  disabled={loading}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-5 py-2 text-xs font-extrabold text-white shadow-xs disabled:opacity-60 cursor-pointer"
                >
                  Lưu Cấu Hình
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Multi-Select Batch Action Bar */}
      {selectedCardIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-sky-300 bg-sky-600 px-6 py-3 text-white shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-sky-700">
              {selectedCardIds.size}
            </span>
            <span className="text-xs font-bold">Thẻ đã chọn để Batch Listing</span>
            {batchProcessing && (
              <span className="text-xs font-semibold text-sky-100">
                (Hoàn tất {batchProgress.current}/{batchProgress.total}, tối đa 2 thẻ cùng lúc)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCardIds(new Set())}
              disabled={batchProcessing}
              className="text-xs text-sky-100 hover:text-white underline"
            >
              Bỏ chọn tất cả
            </button>
            {batchProcessing ? (
              <button
                type="button"
                onClick={cancelBatchListings}
                className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white shadow hover:bg-red-400 transition"
              >
                <XIcon className="h-4 w-4" weight="bold" />
                <span>Ngắt Batch</span>
              </button>
            ) : (
              <button
                onClick={processBatchListings}
                disabled={!shopId || !templateId}
                title={!shopId || !templateId ? "Hãy chọn shop và blank template trước" : undefined}
                className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 shadow hover:bg-amber-300 transition"
              >
                <LightningIcon className="h-4 w-4 fill-current" />
                <span>Batch Tạo Listing Cho {selectedCardIds.size} Thẻ Đã Chọn</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Image Preview Lightbox Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl bg-white p-2 shadow-2xl">
            <button
              onClick={async () => {
                setDownloadingImage(true);
                try {
                  await downloadOriginalTrelloImage(previewImage);
                } catch (requestError) {
                  setError(requestError instanceof Error ? requestError.message : "Không thể tải ảnh gốc.");
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
              className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black"
            >
              <XIcon className="h-6 w-6" />
            </button>
            <img src={previewImage.url} alt="Mockup Preview" className="max-h-[85vh] w-auto rounded-xl object-contain" />
          </div>
        </div>
      )}

      {/* Inline Quick View Drawer for Generated Listing Details */}
      {inspectListing && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
            <div>
              <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 border border-sky-200">
                SKU: {inspectListing.input.internal_name}
              </span>
              <h3 className="mt-1 text-base font-bold text-slate-900">Chi Tiết Listing Đã Sinh</h3>
            </div>
            <div className="flex items-center gap-2">
              {shopId && templateId ? (
                <a
                  href={`/api/trello/download-card-excel?cardId=${encodeURIComponent(inspectListing.trelloCardId || "")}&listingId=${inspectListing.id}&shopId=${encodeURIComponent(shopId)}&templateId=${encodeURIComponent(templateId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow transition hover:bg-emerald-700 active:translate-y-px"
                  title={`Tạo file từ template của ${selectedShopName}`}
                >
                  <DownloadSimpleIcon className="h-4 w-4" />
                  <span>Xuất cho {selectedShopName}</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={openAddTemplateModal}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  <StorefrontIcon className="h-4 w-4" />
                  <span>Cấu hình shop</span>
                </button>
              )}
              <button
                onClick={() => copyListingText(inspectListing)}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <CopyIcon className="h-4 w-4" />}
                <span>{copied ? "Đã Copy" : "Copy Text"}</span>
              </button>
              <button
                onClick={() => setInspectListing(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {inspectListing.result.metadata.stage_timings_ms && (
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thời gian xử lý</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(inspectListing.result.metadata.stage_timings_ms).map(([stage, duration]) => (
                    <span
                      key={stage}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600"
                    >
                      {TRELLO_LISTING_STAGE_LABELS[stage as TrelloListingStage] || stage}: {formatStageDuration(duration)}
                    </span>
                  ))}
                  <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-bold text-sky-700">
                    Tổng AI: {formatStageDuration(inspectListing.result.metadata.processing_time_ms)}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Product Title</label>
              <p className="mt-1 font-semibold text-slate-900 bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                {inspectListing.current_listing.title}
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Bullet Points (5 Points)</label>
              <div className="mt-2 space-y-2">
                {inspectListing.current_listing.bullet_points.map((b, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-800">
                    <span className="font-bold text-sky-600 shrink-0">{idx + 1}.</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Product Description</label>
              <div className="mt-1 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-800 leading-relaxed">
                {inspectListing.current_listing.description}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Generic Search Terms</label>
              <p className="mt-1 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-800">
                {inspectListing.current_listing.backend_search_terms}
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Main Content Area: Mockup Generator or Kanban Board */}

      {activeTab === "mockups" ? (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100">
          <AutoMockupGenerator
            boardId={boardId}
            sourceListId={mockupSourceListId}
            sourceListName={boardLists.find((list) => list.id === mockupSourceListId)?.name || "Cột đầu Mockup"}
            targetListId={mockupTargetListId}
            targetListName={boardLists.find((list) => list.id === mockupTargetListId)?.name || "Cột đích Mockup"}
          />
        </div>
      ) : (
        /* Main Kanban Columns Container */
        <div className="flex flex-1 overflow-x-auto p-6 gap-6 bg-slate-100 min-h-0">
          {/* Configured Listing source column */}
          <div className="flex w-1/2 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            {/* Column Header */}
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <button
                  onClick={toggleSelectAll}
                  className="text-slate-400 hover:text-blue-600 transition cursor-pointer"
                  title="Chọn/Bỏ chọn tất cả"
                >
                  {selectedCardIds.size > 0 && selectedCardIds.size === reviewCards.length ? (
                    <CheckSquareIcon className="h-5 w-5 text-blue-600" weight="fill" />
                  ) : (
                    <SquareIcon className="h-5 w-5" />
                  )}
                </button>

                <span className="h-3 w-3 rounded-full bg-amber-500 shadow-2xs"></span>
                <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">
                  {reviewList ? reviewList.name : "Cột đầu Listing"}
                </h3>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
                  {displayReviewCards.length} thẻ
                </span>
              </div>

              {/* Header controls: Sort & View Toggle */}
              <div className="relative flex items-center gap-2">
                {/* Sort Dropdown Button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsSortOpen((prev) => !prev)}
                    className={`flex items-center gap-1.5 text-xs font-bold rounded-xl px-3 py-1.5 transition shadow-2xs cursor-pointer border ${reviewSort !== "default" || isSortOpen
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700 font-extrabold"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                  >
                    <ArrowsDownUpIcon className="h-3.5 w-3.5" weight="bold" />
                    <span>
                      {reviewSort === "sku_asc"
                        ? "SKU A-Z"
                        : reviewSort === "sku_desc"
                          ? "SKU Z-A"
                          : reviewSort === "name_asc"
                            ? "Tên A-Z"
                            : reviewSort === "name_desc"
                              ? "Tên Z-A"
                              : "Sắp xếp"}
                    </span>
                  </button>

                  {isSortOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setIsSortOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-40">
                        <div className="px-3 py-1 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                          Sắp xếp theo
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {[
                            { id: "default", label: "⚡ Mặc định Trello" },
                            { id: "sku_asc", label: "🔤 SKU: A → Z" },
                            { id: "sku_desc", label: "🔤 SKU: Z → A" },
                            { id: "name_asc", label: "📝 Tên SP: A → Z" },
                            { id: "name_desc", label: "📝 Tên SP: Z → A" },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setReviewSort(opt.id as any);
                                setIsSortOpen(false);
                                setReviewPage(1);
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${reviewSort === opt.id
                                ? "bg-indigo-50 text-indigo-900 font-extrabold"
                                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                                }`}
                            >
                              <span>{opt.label}</span>
                              {reviewSort === opt.id && <CheckIcon className="h-3.5 w-3.5 text-indigo-600" weight="bold" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* View Layout Toggle (Grid Cards vs Compact List) */}
                <div className="flex items-center rounded-xl border border-slate-200 p-0.5 bg-slate-100">
                  <button
                    type="button"
                    onClick={() => setReviewLayout("cards")}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${reviewLayout === "cards"
                      ? "bg-white text-indigo-700 shadow-2xs font-extrabold ring-1 ring-slate-200/60"
                      : "text-slate-400 hover:text-slate-700"
                      }`}
                    title="Hiển thị dạng thẻ đầy đủ"
                  >
                    <SquaresFourIcon className="h-4 w-4" weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewLayout("compact")}
                    className={`p-1.5 rounded-lg transition cursor-pointer ${reviewLayout === "compact"
                      ? "bg-white text-indigo-700 shadow-2xs font-extrabold ring-1 ring-slate-200/60"
                      : "text-slate-400 hover:text-slate-700"
                      }`}
                    title="Hiển thị dạng dòng thu gọn"
                  >
                    <RowsIcon className="h-4 w-4" weight="bold" />
                  </button>
                </div>
              </div>
            </div>

            {/* Cards List */}
            <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 thin-scrollbar">
              {paginatedReviewCards.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                  <p className="text-xs font-semibold text-slate-400">
                    Không có thẻ nào trong cột {reviewList?.name || "đầu Listing"}
                  </p>
                </div>
              ) : (
                paginatedReviewCards.map((card) => {
                  const isSelected = selectedCardIds.has(card.id);
                  const isProcessing = processingCardIds.has(card.id);
                  const imageAttachments = (card.attachments || []).filter(
                    (a) => a.mimeType?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(a.url),
                  );

                  const keywordsList = (() => {
                    const raw = (card.desc || "").trim();
                    const genericLine = raw.split(/\r?\n/).find((l) => /(?:generic|backend)?\s*keywords?\s*:/i.test(l));
                    if (!genericLine) return [];
                    const text = genericLine.replace(/^.*?(?:generic|backend)?\s*keywords?\s*:\s*/i, "");
                    return text
                      .split(/[,;]/)
                      .map((k) => k.trim())
                      .filter((k) => k.length > 1 && !/^#?\[?https?:\/\//i.test(k) && !k.includes("drive.google.com"))
                      .map((k) => k.replace(/^[#\s]+/, ""))
                      .slice(0, 5);
                  })();

                  if (reviewLayout === "compact") {
                    return (
                      <div
                        key={card.id}
                        draggable={!loading && !batchProcessing && !isProcessing}
                        onDragStart={(e) => {
                          setDraggedCardId(card.id);
                          e.dataTransfer.setData("text/plain", card.id);
                        }}
                        onDragEnd={() => setDraggedCardId(null)}
                        className={`group rounded-xl border p-3 transition shadow-2xs hover:shadow-xs flex items-center justify-between gap-3 cursor-grab active:cursor-grabbing ${isSelected
                          ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-400/30"
                          : "border-slate-200 bg-white hover:border-blue-300"
                          } ${isProcessing ? "opacity-75" : ""}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => toggleSelectCard(card.id)}
                            className="shrink-0 text-slate-400 hover:text-blue-600 transition cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquareIcon className="h-5 w-5 text-blue-600" weight="fill" />
                            ) : (
                              <SquareIcon className="h-5 w-5" />
                            )}
                          </button>

                          {imageAttachments[0] ? (
                            <div
                              onClick={() => setPreviewImage({ url: imageAttachments[0].url, name: imageAttachments[0].name })}
                              className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <img
                                src={imageAttachments[0].previewUrl || imageAttachments[0].url}
                                alt={card.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : null}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700 border border-blue-100 font-mono">
                                SKU: {card.parsed?.sku || "N/A"}
                              </span>
                              {imageAttachments.length > 0 && (
                                <span className="text-[10px] font-bold text-slate-400">
                                  {imageAttachments.length} ảnh
                                </span>
                              )}
                              {card.dateLastActivity && (
                                <span className="text-[10px] font-semibold text-slate-400">
                                  • {new Date(card.dateLastActivity).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                            <h4 className="text-xs font-black text-slate-900 truncate leading-tight">
                              {card.parsed?.itemName || card.name}
                            </h4>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (isProcessing) cancelCardListing(card.id);
                            else void processCardToListing(card);
                          }}
                          disabled={!isProcessing && (loading || batchProcessing || !shopId || !templateId)}
                          className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black text-white shadow-2xs transition disabled:opacity-50 cursor-pointer ${isProcessing ? "bg-red-500 hover:bg-red-600" : "bg-blue-600 hover:bg-blue-700"
                            }`}
                        >
                          {isProcessing ? <XIcon className="h-3.5 w-3.5" weight="bold" /> : <LightningIcon className="h-3.5 w-3.5" weight="fill" />}
                          <span>{isProcessing ? "Ngắt" : "Tạo Listing"}</span>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={card.id}
                      draggable={!loading && !batchProcessing && !isProcessing}
                      onDragStart={(e) => {
                        setDraggedCardId(card.id);
                        e.dataTransfer.setData("text/plain", card.id);
                      }}
                      onDragEnd={() => setDraggedCardId(null)}
                      className={`group rounded-2xl border p-4 transition shadow-2xs hover:shadow-xs cursor-grab active:cursor-grabbing ${isSelected
                        ? "border-blue-500 bg-blue-50/40 ring-2 ring-blue-400/30"
                        : "border-slate-200 bg-white hover:border-blue-300"
                        } ${isProcessing ? "opacity-75" : ""}`}
                    >
                      {/* Card Header: Checkbox | SKU Badge | Country Flag | Menu */}
                      <div className="mb-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleSelectCard(card.id)}
                            className="shrink-0 text-slate-400 hover:text-blue-600 transition cursor-pointer"
                          >
                            {isSelected ? (
                              <CheckSquareIcon className="h-5 w-5 text-blue-600" weight="fill" />
                            ) : (
                              <SquareIcon className="h-5 w-5" />
                            )}
                          </button>

                          <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700 border border-blue-100 font-mono">
                            SKU: {card.parsed?.sku || "N/A"}
                          </span>
                        </div>

                        <button className="text-slate-400 hover:text-slate-600 transition p-1 cursor-pointer">
                          <DotsThreeIcon className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Item Title */}
                      <h4 className="text-base font-extrabold text-slate-900 leading-snug mb-2.5">
                        {card.parsed?.itemName || card.name}
                      </h4>

                      {/* Image Mockups Preview Gallery */}
                      {imageAttachments.length > 0 && (
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3 thin-scrollbar">
                          {imageAttachments.map((img, idx) => (
                            <div
                              key={img.id || idx}
                              onClick={() => setPreviewImage({ url: img.url, name: img.name })}
                              className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xs group/img hover:border-blue-400 transition"
                              title="Click để phóng to ảnh mockup"
                            >
                              <img
                                src={img.previewUrl || img.url}
                                alt={img.name}
                                className="h-full w-full object-cover transition group-hover/img:scale-105"
                              />
                              <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/80 px-1 py-0.2 text-[10px] font-bold text-white">
                                #{idx + 1}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Generic Keywords Pill Tags */}
                      {keywordsList.length > 0 && (
                        <div className="mb-3.5 flex flex-wrap gap-1.5">
                          {keywordsList.map((kw, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 border border-slate-200"
                            >
                              #{kw}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action Bar */}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1">
                        <a
                          href={card.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-extrabold text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <span>Xem trên Trello</span>
                          <span className="text-xs">↗</span>
                        </a>

                        <button
                          onClick={() => {
                            if (isProcessing) cancelCardListing(card.id);
                            else void processCardToListing(card);
                          }}
                          disabled={!isProcessing && (loading || batchProcessing || !shopId || !templateId)}
                          title={!shopId || !templateId ? "Hãy chọn shop và blank template trước" : undefined}
                          className={`flex items-center gap-2 rounded-xl px-4.5 py-2.5 text-sm font-extrabold text-white shadow-xs transition disabled:opacity-50 cursor-pointer ${isProcessing
                            ? "bg-red-500 hover:bg-red-600"
                            : "bg-blue-600 hover:bg-blue-700"
                            }`}
                        >
                          {isProcessing ? (
                            <>
                              <XIcon className="h-4 w-4" weight="bold" />
                              <span>Ngắt Listing</span>
                            </>
                          ) : (
                            <>
                              <LightningIcon className="h-4 w-4 fill-current" />
                              <span>Tạo Listing & Đính Kèm</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Column Pagination Footer */}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 font-medium border-t border-slate-100 pt-3 shrink-0">
              <span>
                Hiển thị {paginatedReviewCards.length}/{displayReviewCards.length} thẻ
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
                  disabled={reviewPage <= 1}
                  className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  &lt;
                </button>
                <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-black text-xs border border-blue-200">
                  {reviewPage} / {totalReviewPages}
                </span>
                <button
                  type="button"
                  onClick={() => setReviewPage((p) => Math.min(totalReviewPages, p + 1))}
                  disabled={reviewPage >= totalReviewPages}
                  className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  &gt;
                </button>
              </div>
              <select
                value={reviewPageSize}
                onChange={(e) => {
                  setReviewPageSize(Number(e.target.value));
                  setReviewPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
            </div>
          </div>

          {/* Column 2: LISTING */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const cardId = e.dataTransfer.getData("text/plain") || draggedCardId;
              if (cardId) {
                const cardToProcess = reviewCards.find((c) => c.id === cardId);
                if (cardToProcess) {
                  processCardToListing(cardToProcess);
                }
              }
              setDraggedCardId(null);
            }}
            className={`flex w-1/2 flex-col rounded-2xl border p-5 shadow-2xs transition ${draggedCardId
              ? "border-emerald-500 bg-emerald-50/20 ring-4 ring-emerald-400/20"
              : "border-slate-200 bg-white"
              }`}
          >
            {/* Column Header */}
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 shadow-2xs"></span>
                <h3 className="text-base font-black text-slate-900 uppercase tracking-wide">
                  {listingList ? listingList.name : "Cột đích Listing"}
                </h3>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-extrabold text-emerald-700 border border-emerald-200">
                  {displayListingCards.length} thẻ
                </span>
              </div>

              {/* Search Box & Filter Button */}
              <div className="relative flex items-center gap-2">
                <div className="relative flex items-center">
                  <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 h-4 w-4" />
                  <input
                    type="text"
                    value={listingSearch}
                    onChange={(e) => {
                      setListingSearch(e.target.value);
                      setListingPage(1);
                    }}
                    placeholder="Tìm theo SKU hoặc tên..."
                    className="w-52 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs font-semibold outline-none focus:bg-white focus:border-emerald-500 transition shadow-2xs"
                  />
                  {listingSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setListingSearch("");
                        setListingPage(1);
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Popover */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsListingFilterOpen((prev) => !prev)}
                    className={`p-1.5 rounded-xl border transition shadow-2xs cursor-pointer ${listingFilter !== "all" || isListingFilterOpen
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-bold"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    title="Lọc danh sách thẻ"
                  >
                    <FunnelIcon className="h-4 w-4" weight={listingFilter !== "all" ? "fill" : "regular"} />
                  </button>

                  {isListingFilterOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setIsListingFilterOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl border border-slate-200/90 bg-white/95 backdrop-blur-md p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 z-40">
                        <div className="px-3 py-1 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                          Bộ lọc thẻ
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {[
                            { id: "all", label: "Tất cả thẻ" },
                            { id: "has_excel", label: "Có file Excel Listing" },
                            { id: "has_attachment", label: "Có file đính kèm" },
                          ].map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => {
                                setListingFilter(f.id as any);
                                setIsListingFilterOpen(false);
                                setListingPage(1);
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition cursor-pointer ${listingFilter === f.id
                                ? "bg-emerald-50 text-emerald-900 font-extrabold"
                                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-semibold"
                                }`}
                            >
                              <span>{f.label}</span>
                              {listingFilter === f.id && <CheckIcon className="h-3.5 w-3.5 text-emerald-600" weight="bold" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Cards List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 thin-scrollbar">
              {paginatedListingCards.length === 0 ? (
                <div className={`flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center transition ${draggedCardId
                  ? "border-emerald-400 bg-emerald-50/50 text-emerald-800"
                  : "border-slate-200 text-slate-400"
                  }`}>
                  <p className="text-xs font-bold">
                    {draggedCardId
                      ? "✨ Thả thẻ vào đây để tự động tạo Listing & Đính kèm Excel!"
                      : listingSearch || listingFilter !== "all"
                        ? "Không tìm thấy thẻ nào khớp với bộ lọc / tìm kiếm."
                        : `Chưa có thẻ nào trong cột ${listingList?.name || "đích Listing"}. Kéo thẻ từ cột ${reviewList?.name || "đầu Listing"} thả vào đây để xử lý.`}
                  </p>
                </div>
              ) : (
                paginatedListingCards.map((card) => {
                  const fileUrl = `/api/trello/download-card-excel?cardId=${card.id}&shopId=${encodeURIComponent(shopId)}&templateId=${encodeURIComponent(templateId)}`;
                  const fileName = `${selectedShopName}-${(card.parsed?.sku || "listing").toLowerCase()}.xlsx`;
                  const imageAttachments = (card.attachments || []).filter(
                    (a) => a.mimeType?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(a.url),
                  );
                  const excelAttachments = (card.attachments || []).filter((a) =>
                    /\.(xlsx|xls|csv)$/i.test(a.name) ||
                    Boolean(a.mimeType && (a.mimeType.includes("spreadsheet") || a.mimeType.includes("excel") || a.mimeType.includes("csv")))
                  );
                  const latestExcel = excelAttachments.length > 0 ? excelAttachments[excelAttachments.length - 1] : null;

                  return (
                    <div
                      key={card.id}
                      className="group rounded-xl border border-slate-200 bg-white p-3 shadow-2xs hover:shadow-xs hover:border-emerald-300 transition flex items-center justify-between gap-3"
                    >
                      {/* Left Side: Checkbox + Thumbnail + SKU + Timestamp + Title */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-emerald-600 shrink-0 cursor-pointer"
                        />

                        {imageAttachments[0] ? (
                          <div
                            onClick={() => setPreviewImage({ url: imageAttachments[0].url, name: imageAttachments[0].name })}
                            className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                            title="Click để xem ảnh"
                          >
                            <img
                              src={imageAttachments[0].previewUrl || imageAttachments[0].url}
                              alt={card.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : null}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700 border border-emerald-100 font-mono">
                              SKU: {card.parsed?.sku || "N/A"}
                            </span>
                            {imageAttachments.length > 0 && (
                              <span className="text-[10px] font-bold text-slate-400">
                                {imageAttachments.length} ảnh
                              </span>
                            )}
                            {card.dateLastActivity && (
                              <span className="text-[10px] font-semibold text-slate-400">
                                • {new Date(card.dateLastActivity).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-black text-slate-900 truncate leading-tight">
                            {card.parsed?.itemName || card.name}
                          </h4>
                        </div>
                      </div>

                      {/* Right Side Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        {latestExcel ? (
                          <a
                            href={latestExcel.url}
                            target="_blank"
                            rel="noreferrer"
                            download={latestExcel.name}
                            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-black text-white shadow-2xs transition duration-150 cursor-pointer"
                            title={`Tải file: ${latestExcel.name}`}
                          >
                            <DownloadSimpleIcon size={14} weight="bold" />
                            <span>Tải Excel</span>
                          </a>
                        ) : null}

                        <a
                          href={card.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex h-7.5 w-7.5 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-blue-600 hover:border-blue-300 transition shadow-2xs cursor-pointer"
                          title="Mở thẻ này trên Trello"
                        >
                          <ArrowSquareOutIcon size={14} weight="bold" />
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Column Pagination Footer */}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500 font-medium border-t border-slate-100 pt-3 shrink-0">
              <span>
                Hiển thị {paginatedListingCards.length}/{displayListingCards.length} thẻ
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setListingPage((p) => Math.max(1, p - 1))}
                  disabled={listingPage <= 1}
                  className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  &lt;
                </button>
                <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-black text-xs border border-emerald-200">
                  {listingPage} / {totalListingPages}
                </span>
                <button
                  type="button"
                  onClick={() => setListingPage((p) => Math.min(totalListingPages, p + 1))}
                  disabled={listingPage >= totalListingPages}
                  className="h-7 w-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 font-bold disabled:opacity-40 cursor-pointer"
                >
                  &gt;
                </button>
              </div>
              <select
                value={listingPageSize}
                onChange={(e) => {
                  setListingPageSize(Number(e.target.value));
                  setListingPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer"
              >
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
            </div>
          </div>
        </div>
      )}
      {/* Quick Add Brand Modal */}
      {showAddBrandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <TagIcon className="h-5 w-5 text-sky-600" />
                Thêm Thương Hiệu Mới
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBrandModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            {localBrands.length > 0 && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Thương hiệu hiện có</label>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {localBrands.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 border border-slate-200 text-xs">
                      <span className="font-semibold text-slate-800">{b.name}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteBrand(b.id)}
                        className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2 py-0.5 rounded hover:bg-rose-50 transition"
                        title="Xóa thương hiệu này"
                      >
                        <span className="flex items-center gap-1"><XIcon className="h-3 w-3" /> Xóa</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={handleAddBrand} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tên thương hiệu *</label>
                <input
                  type="text"
                  required
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder="Ví dụ: Limima Premium"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 focus:border-sky-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Hướng dẫn thương hiệu (Guidelines)</label>
                <textarea
                  rows={3}
                  value={newBrandGuidelines}
                  onChange={(e) => setNewBrandGuidelines(e.target.value)}
                  placeholder="Mô tả quy tắc viết title, tone giọng hoặc từ khóa cấm..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 focus:border-sky-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddBrandModal(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={addingBrand || !newBrandName.trim()}
                  className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-sky-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {addingBrand && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                  Tạo Thương Hiệu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add / Manage Template Modal */}
      {showAddTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <FileXlsIcon className="h-5 w-5 text-emerald-600" />
                Quản Lý & Thêm Template Amazon
              </h3>
              <button
                type="button"
                onClick={() => setShowAddTemplateModal(false)}
                aria-label="Đóng"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 text-xs leading-5 text-slate-600">
              Thương hiệu đang chọn: <span className="font-extrabold text-slate-900">{selectedBrandName || "Chưa chọn"}</span>
            </div>

            {/* Danh mục tất cả các Phôi trong hệ thống */}
            {managedPhoiRows.length > 0 && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Trạng thái các Phôi đối với {selectedBrandName}
                </label>
                <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 thin-scrollbar">
                  {managedPhoiRows.map(({ target, source }) => {
                    const isTargetReady = target ? isTemplateReady(target) : false;
                    const active = target ? target.id === templateId && isTargetReady : false;
                    return (
                      <div
                        key={source.phoi_key}
                        className={`rounded-2xl border p-3.5 bg-white transition shadow-2xs ${
                          active
                            ? "border-emerald-400 ring-2 ring-emerald-200"
                            : isTargetReady
                              ? "border-emerald-200 bg-emerald-50/20"
                              : target
                                ? "border-amber-300 bg-amber-50/40"
                                : "border-slate-200 bg-slate-50/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {isTargetReady ? (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                                  <CheckIcon className="h-3 w-3" weight="bold" />
                                </span>
                              ) : target ? (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-800 shrink-0">
                                  <WarningCircleIcon className="h-3.5 w-3.5 text-amber-700" weight="fill" />
                                </span>
                              ) : (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500 shrink-0">
                                  <StorefrontIcon className="h-3 w-3" />
                                </span>
                              )}
                              <p className="truncate text-xs font-extrabold text-slate-900">{source.phoi_name}</p>
                              {active && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-800 shrink-0">
                                  Đang kích hoạt
                                </span>
                              )}
                            </div>

                            {isTargetReady ? (
                              <p className="mt-1 text-[11px] font-semibold text-emerald-800">
                                Sẵn sàng · {target?.name}
                              </p>
                            ) : target ? (
                              <div className="mt-1.5 rounded-xl bg-amber-100/70 p-2 border border-amber-200 text-amber-950">
                                <p className="text-[10px] text-amber-900 leading-4">
                                  ⚠️ Chưa có dòng mẫu Parent/Child. Hãy mở Excel điền mẫu hoặc tải phôi đã điền.
                                </p>
                              </div>
                            ) : (
                              <p className="mt-1 text-[10px] text-slate-600">
                                Đã có mẫu từ <span className="font-bold text-slate-800">{source.shop_name}</span> · Tải file blank để auto-map
                              </p>
                            )}
                          </div>

                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                              isTargetReady
                                ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                                : target
                                  ? "bg-amber-100 text-amber-950 border border-amber-300"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {isTargetReady ? "Sẵn sàng" : target ? "Chưa điền" : "Chờ blank"}
                          </span>
                        </div>

                        {target && (
                          <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
                            {isTargetReady && !active && (
                              <button
                                type="button"
                                onClick={() => {
                                  selectDestination(target.id);
                                  setShowAddTemplateModal(false);
                                }}
                                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 transition cursor-pointer shadow-2xs"
                              >
                                Chọn dùng
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDeleteTemplate(target)}
                              className="rounded-xl bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer"
                              title="Xóa template này"
                            >
                              Xóa
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <form onSubmit={handleAddTemplate} className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs leading-5 text-emerald-900">
                Tải lên file Blank Template từ Seller Central của <strong>{selectedBrandName || "Brand"}</strong>. Hệ thống sẽ tự động quét và kế thừa (Auto-Map) toàn bộ cấu hình từ phôi mẫu cùng loại của shop khác!
              </div>
              <div>
                <label htmlFor="new-template-file" className="block text-xs font-bold text-slate-700 mb-1">Tải lên file Blank Template (.xlsx, .xlsm) *</label>
                <input
                  id="new-template-file"
                  type="file"
                  required
                  accept=".xlsx,.xlsm"
                  onChange={(e) => setNewTemplateFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-xs file:font-bold file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddTemplateModal(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={addingTemplate || !newTemplateFile}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:translate-y-px disabled:opacity-50 cursor-pointer"
                >
                  {addingTemplate && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                  Quét và Lưu Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
