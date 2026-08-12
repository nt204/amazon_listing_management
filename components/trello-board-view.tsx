"use client";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  CopyIcon,
  FileCsvIcon,
  FileXlsIcon,
  GearIcon,
  GlobeIcon,
  ImageSquareIcon,
  LightningIcon,
  ListNumbersIcon,
  MapPinIcon,
  PathIcon,
  SparkleIcon,
  SpinnerIcon,
  SquareIcon,
  TagIcon,
  KanbanIcon,
  WarningCircleIcon,
  XIcon,
  EyeIcon,
  CheckIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { BrandProfile, ListingTemplateSummary, StoredListing } from "@/lib/types";
import { extractTrelloBoardId } from "@/lib/trello";

interface TrelloBoardViewProps {
  brands: BrandProfile[];
  onListingCreated?: (listing: StoredListing) => void;
  onSelectListing?: (listing: StoredListing) => void;
}

interface TrelloBoard {
  id: string;
  name: string;
  url: string;
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
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  attachments?: TrelloAttachment[];
  parsed?: {
    sku: string;
    itemName: string;
  };
}

function getTemplateDisplayName(template: ListingTemplateSummary) {
  const name = template.name.trim();
  const separatorIndex = name.indexOf(":");

  if (separatorIndex === -1) return name;

  const prefix = name.slice(0, separatorIndex).trim();
  const isSkuPrefix =
    /^[A-Z0-9]{5,20}$/i.test(prefix) && /[A-Z]/i.test(prefix) && /\d/.test(prefix);

  return isSkuPrefix ? name.slice(separatorIndex + 1).trim() || name : name;
}

export function TrelloBoardView({ brands, onListingCreated, onSelectListing }: TrelloBoardViewProps) {
  const [apiKey, setApiKey] = useState("");
  const [token, setToken] = useState("");
  const [boardId, setBoardId] = useState("");
  const [reviewListName, setReviewListName] = useState("TEAM DUYỆT NỘI BỘ");
  const [listingListName, setListingListName] = useState("Listing");
  const [brandProfileId, setBrandProfileId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [marketplace, setMarketplace] = useState<"US" | "UK" | "DE">("US");

  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [templates, setTemplates] = useState<ListingTemplateSummary[]>([]);
  const [reviewList, setReviewList] = useState<TrelloList | null>(null);
  const [listingList, setListingList] = useState<TrelloList | null>(null);

  const [reviewCards, setReviewCards] = useState<TrelloCard[]>([]);
  const [listingCards, setListingCards] = useState<TrelloCard[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [processingCardId, setProcessingCardId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [processedCardsMap, setProcessedCardsMap] = useState<Record<string, { attachmentUrl?: string; name?: string }>>({});

  // Inline Quick View Drawer for Generated Listing Details (stays 100% on Trello screen)
  const [inspectListing, setInspectListing] = useState<StoredListing | null>(null);
  const [copied, setCopied] = useState(false);

  const [selectedModel, setSelectedModel] = useState("gemini-3.6-flash");
  const [localBrands, setLocalBrands] = useState<BrandProfile[]>(brands);
  const [showAddBrandModal, setShowAddBrandModal] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [newBrandGuidelines, setNewBrandGuidelines] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);

  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateFile, setNewTemplateFile] = useState<File | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);

  useEffect(() => {
    setLocalBrands(brands);
  }, [brands]);

  useEffect(() => {
    fetchConfig();
    fetchTemplates();
  }, []);

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
        setLocalBrands((prev) => [data.brand, ...prev]);
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
    if (!newTemplateName.trim() || !newTemplateFile) return;
    setAddingTemplate(true);
    try {
      const formData = new FormData();
      formData.append("name", newTemplateName.trim());
      formData.append("template", newTemplateFile);

      const res = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể tải lên template.");
      await fetchTemplates();
      if (data.template) {
        setTemplateId(data.template.id);
      }
      setNewTemplateName("");
      setNewTemplateFile(null);
      setShowAddTemplateModal(false);
      setSuccessMsg(`Đã thêm Amazon template "${newTemplateName.trim()}" thành công!`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi thêm template.");
    } finally {
      setAddingTemplate(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveLocalConfig = (key: string, tok: string, bId: string, rName: string, lName: string) => {
    try {
      const cleanId = extractTrelloBoardId(bId);
      if (typeof window !== "undefined") {
        if (key) localStorage.setItem("trello_api_key", key);
        if (tok) localStorage.setItem("trello_token", tok);
        if (cleanId) localStorage.setItem("trello_board_id", cleanId);
        if (rName) localStorage.setItem("trello_review_list_name", rName);
        if (lName) localStorage.setItem("trello_listing_list_name", lName);
      }
    } catch (e) {
      console.error("Failed to save to localStorage", e);
    }
  };

  const fetchConfig = async () => {
    try {
      setError("");
      const localApiKey = typeof window !== "undefined" ? localStorage.getItem("trello_api_key") : null;
      const localToken = typeof window !== "undefined" ? localStorage.getItem("trello_token") : null;
      const localBoardId = typeof window !== "undefined" ? localStorage.getItem("trello_board_id") : null;
      const localReviewName = typeof window !== "undefined" ? localStorage.getItem("trello_review_list_name") : null;
      const localListingName = typeof window !== "undefined" ? localStorage.getItem("trello_listing_list_name") : null;

      const res = await fetch("/api/trello/config");
      const data = await res.json();
      if (res.ok) {
        const finalApiKey = localApiKey || data.rawApiKey || "";
        const finalToken = localToken || data.rawToken || "";
        const rawBoardId = localBoardId || data.boardId || "";
        const finalBoardId = extractTrelloBoardId(rawBoardId);
        const finalReviewName = localReviewName || data.internalReviewListName || "TEAM DUYỆT NỘI BỘ";
        const finalListingName = localListingName || data.listingListName || "Listing";

        if (finalApiKey) setApiKey(finalApiKey);
        if (finalToken) setToken(finalToken);
        if (finalBoardId) setBoardId(finalBoardId);
        if (finalReviewName) setReviewListName(finalReviewName);
        if (finalListingName) setListingListName(finalListingName);

        if (finalApiKey && finalToken && finalBoardId) {
          loadCards(finalApiKey, finalToken, finalBoardId, finalReviewName, finalListingName);
        } else {
          setShowConfig(true);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadCards = useCallback(
    async (key = apiKey, tok = token, bId = boardId, rName = reviewListName, lName = listingListName) => {
      const cleanId = extractTrelloBoardId(bId);
      if (!key || !tok || !cleanId) {
        setShowConfig(true);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({
          apiKey: key,
          token: tok,
          boardId: cleanId,
          internalReviewListName: rName,
          listingListName: lName,
        });
        const res = await fetch(`/api/trello/cards?${query.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Không thể tải thẻ Trello.");
        }
        setLists(data.lists || []);
        setReviewList(data.internalReviewList);
        setListingList(data.listingList);
        setReviewCards(data.reviewCards || []);
        setListingCards(data.listingCards || []);
        setSelectedCardIds(new Set());
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tải Trello.");
      } finally {
        setLoading(false);
      }
    },
    [apiKey, token, boardId, reviewListName, listingListName],
  );

  const testAndFetchBoards = async () => {
    if (!apiKey || !token) {
      setError("Vui lòng nhập API Key và Token Trello.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cleanId = extractTrelloBoardId(boardId);
      const res = await fetch("/api/trello/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, token, boardId: cleanId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể kết nối Trello.");
      setBoards(data.boards || []);
      if (data.lists) setLists(data.lists);
      setSuccessMsg("Kết nối Trello thành công!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi kết nối Trello.");
    } finally {
      setLoading(false);
    }
  };

  const processCardToListing = async (card: TrelloCard) => {
    setProcessingCardId(card.id);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/trello/process-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId: card.id,
          targetListId: listingList?.id,
          apiKey: apiKey.trim() || undefined,
          token: token.trim() || undefined,
          brandProfileId: brandProfileId || undefined,
          marketplace,
          templateId: templateId || undefined,
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tạo Listing.");

      if (data.trelloAttachment) {
        setProcessedCardsMap((prev) => ({
          ...prev,
          [card.id]: { attachmentUrl: data.trelloAttachment.url, name: data.trelloAttachment.name },
        }));
      }

      setSuccessMsg(`Tạo Listing Excel thành công cho SKU: ${data.sku}! Đã đính kèm file Excel vào thẻ Trello.`);

      if (data.listing) {
        if (onListingCreated) onListingCreated(data.listing);
        setInspectListing(data.listing);
      }

      await loadCards();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo Listing từ thẻ Trello.");
    } finally {
      setProcessingCardId(null);
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
        setLocalBrands((prev) => prev.filter((b) => b.id !== idToDelete));
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

  const handleDeleteTemplate = async (targetId?: string) => {
    const idToDelete = targetId || templateId;
    if (!idToDelete) return;
    const tmplObj = templates.find((t) => t.id === idToDelete);
    const tmplName = tmplObj ? tmplObj.name : "này";
    if (!confirm(`Bạn có chắc chắn muốn xóa template "${tmplName}" không?`)) return;
    try {
      const res = await fetch(`/api/templates?id=${idToDelete}`, { method: "DELETE" });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== idToDelete));
        if (templateId === idToDelete) setTemplateId("");
        setSuccessMsg(`Đã xóa template "${tmplName}" thành công.`);
        setError("");
      } else {
        setError("Không thể xóa template.");
      }
    } catch {
      setError("Lỗi khi xóa template.");
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
    setBatchProcessing(true);
    setBatchProgress({ current: 0, total: cardsToProcess.length });
    setError("");
    setSuccessMsg("");

    let successCount = 0;
    const batchErrors: string[] = [];
    for (let i = 0; i < cardsToProcess.length; i += 1) {
      const card = cardsToProcess[i];
      setBatchProgress({ current: i + 1, total: cardsToProcess.length });
      setProcessingCardId(card.id);
      try {
        const res = await fetch("/api/trello/process-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cardId: card.id,
            targetListId: listingList?.id,
            apiKey: apiKey.trim() || undefined,
            token: token.trim() || undefined,
            brandProfileId: brandProfileId || undefined,
            marketplace,
            templateId: templateId || undefined,
            model: selectedModel,
          }),
        });
        const data = await res.json();
        if (res.ok && data.listing) {
          successCount += 1;
          if (onListingCreated) onListingCreated(data.listing);
        } else {
          batchErrors.push(`${card.parsed?.sku || card.name}: ${data.error || "Không thể tạo listing"}`);
        }
      } catch (err) {
        console.error(`Lỗi tạo batch cho card ${card.id}:`, err);
        batchErrors.push(`${card.parsed?.sku || card.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setBatchProcessing(false);
    setProcessingCardId(null);
    if (successCount > 0) {
      setSuccessMsg(`Đã hoàn thành Batch tạo Listing cho ${successCount}/${cardsToProcess.length} thẻ đã chọn! Các file Excel đã được đính kèm vào thẻ Trello.`);
    }
    if (batchErrors.length > 0) {
      setError(`Lỗi khi tạo Listing: ${batchErrors.join("; ")}`);
    }
    await loadCards();
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

  return (
    <div className="relative flex h-full w-full flex-col bg-slate-100 text-slate-800 font-sans">
      {/* Prominent Ocean Blue Toolbar & Configuration */}
      <div className="flex flex-wrap items-center justify-between border-b border-sky-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-md shadow-sky-500/20">
            <KanbanIcon className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-extrabold text-slate-900">Bảng Trello Kanban</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800 border border-sky-200 shadow-xs">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
                Board: Tri Test
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700 border border-slate-200">
                Thị trường: US 🇺🇸 (Mặc định)
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Tự động lấy SKU, Ảnh Mockup, Keywords ➔ Điền trực tiếp vào Amazon Excel Template đính kèm Trello
            </p>
          </div>
        </div>

        {/* Large Prominent Control Panel */}
        <div className="flex flex-wrap items-center gap-3">
          {/* AI Model Selector */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 shadow-xs hover:border-purple-400 transition">
            <SparkleIcon className="h-5 w-5 text-purple-600 shrink-0" />
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">AI Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-900 outline-none cursor-pointer"
              >
                <option value="gemini-3.6-flash">Gemini 3.6 Flash (Mặc định)</option>
                <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (Fast)</option>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Deep Reasoning)</option>
                <option value="gpt-4o">GPT-4o (Chất lượng cao)</option>
                <option value="gpt-4o-mini">GPT-4o Mini (Nhanh & Tối ưu)</option>
                <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
                <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
                <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
              </select>
            </div>
          </div>

          {/* Brand Profile Selector */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 shadow-xs hover:border-sky-400 transition">
            <TagIcon className="h-5 w-5 text-sky-600 shrink-0" />
            <div className="flex items-center gap-1.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Thương hiệu</label>
                <select
                  value={brandProfileId}
                  onChange={(e) => {
                    if (e.target.value === "__ADD_NEW__") {
                      setShowAddBrandModal(true);
                    } else {
                      setBrandProfileId(e.target.value);
                    }
                  }}
                  className="bg-transparent text-xs font-bold text-slate-900 outline-none cursor-pointer"
                >
                  <option value="">Limima (Mặc định)</option>
                  {localBrands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                  <option value="__ADD_NEW__" className="font-semibold text-sky-600">+ Thêm mới...</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBrandModal(true)}
                title="Thêm thương hiệu mới"
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200 text-xs font-bold transition shrink-0"
              >
                +
              </button>
              {brandProfileId && (
                <button
                  type="button"
                  onClick={() => handleDeleteBrand()}
                  title="Xóa thương hiệu đang chọn"
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-100 text-rose-600 hover:bg-rose-200 text-xs font-bold transition shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Excel Template Selector */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 shadow-xs hover:border-emerald-400 transition">
            <FileXlsIcon className="h-5 w-5 text-emerald-600 shrink-0" />
            <div className="flex items-center gap-1.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amazon Excel Template</label>
                <select
                  value={templateId}
                  onChange={(e) => {
                    if (e.target.value === "__ADD_NEW__") {
                      setShowAddTemplateModal(true);
                    } else {
                      setTemplateId(e.target.value);
                    }
                  }}
                  className="bg-transparent text-xs font-bold text-slate-900 outline-none cursor-pointer"
                >
                  <option value="">Amazon Flat File Mẫu (Tương Ứng Ngành Hàng)</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {getTemplateDisplayName(t)}
                    </option>
                  ))}
                  <option value="__ADD_NEW__" className="font-semibold text-emerald-600">+ Thêm mới...</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowAddTemplateModal(true)}
                title="Thêm Amazon Excel Template mới"
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-xs font-bold transition shrink-0"
              >
                +
              </button>
              {templateId && (
                <button
                  type="button"
                  onClick={() => handleDeleteTemplate()}
                  title="Xóa Amazon Excel Template đang chọn"
                  className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-100 text-rose-600 hover:bg-rose-200 text-xs font-bold transition shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Config Key Button */}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-400 transition"
          >
            <GearIcon className="h-5 w-5 text-slate-600" />
            <span>Cấu Hình Trello API</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => loadCards()}
            disabled={loading || batchProcessing}
            className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-sky-600/20 hover:bg-sky-700 transition disabled:opacity-50"
          >
            {loading ? <SpinnerIcon className="h-5 w-5 animate-spin" /> : "Làm Mới Bảng Trello"}
          </button>
        </div>
      </div>

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

      {/* Large Prominent Config Panel */}
      {showConfig && (
        <div className="border-b border-slate-200 bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Cấu hình Thông Tin Kết Nối Trello API</h3>
              <p className="text-xs text-slate-500">Nhập API Key và Token với quyền Read/Write từ Trello Developer Portal</p>
            </div>
            <a
              href="https://trello.com/app-key"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-sky-600 hover:underline"
            >
              Lấy API Key trên Trello ↗
            </a>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Trello API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Ví dụ: 59fbd..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-sky-500 outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Trello Token (Read/Write Scope)</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Ví dụ: ATTA..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-sky-500 outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Board ID / URL Trello Board</label>
              <input
                type="text"
                value={boardId}
                onChange={(e) => setBoardId(extractTrelloBoardId(e.target.value))}
                placeholder="https://trello.com/b/UaCRcUxZ/test-project hoặc UaCRcUxZ"
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs font-mono text-slate-900 focus:bg-white focus:border-sky-500 outline-none"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              onClick={testAndFetchBoards}
              disabled={loading}
              className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
            >
              Kiểm Tra Kết Nối
            </button>
            <button
              onClick={() => {
                saveLocalConfig(apiKey, token, boardId, reviewListName, listingListName);
                loadCards(apiKey, token, boardId, reviewListName, listingListName);
                setShowConfig(false);
              }}
              disabled={loading}
              className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-sky-700"
            >
              Lưu Cấu Hình
            </button>
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
                (Đang xử lý {batchProgress.current}/{batchProgress.total} thẻ...)
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
            <button
              onClick={processBatchListings}
              disabled={batchProcessing}
              className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 shadow hover:bg-amber-300 transition disabled:opacity-50"
            >
              {batchProcessing ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  <span>Đang xử lý Batch...</span>
                </>
              ) : (
                <>
                  <LightningIcon className="h-4 w-4 fill-current" />
                  <span>⚡ Batch Tạo Listing Cho {selectedCardIds.size} Thẻ Đã Chọn</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl bg-white p-2 shadow-2xl">
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black"
            >
              <XIcon className="h-6 w-6" />
            </button>
            <img src={previewImageUrl} alt="Mockup Preview" className="max-h-[85vh] w-auto rounded-xl object-contain" />
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
              <a
                href={`/api/trello/download-card-excel?cardId=${inspectListing.id}&apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&templateId=${encodeURIComponent(templateId)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-700 transition"
              >
                <DownloadSimpleIcon className="h-4 w-4" />
                <span>Tải File Excel (.xlsx)</span>
              </a>
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

      {/* Main Kanban Columns Container */}
      <div className="flex flex-1 overflow-x-auto p-6 gap-6 bg-slate-100">
        {/* Column 1: TEAM DUYỆT NỘI BỘ */}
        <div className="flex w-1/2 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* Column Header */}
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <button
                onClick={toggleSelectAll}
                className="text-slate-400 hover:text-sky-600"
                title="Chọn/Bỏ chọn tất cả"
              >
                {selectedCardIds.size > 0 && selectedCardIds.size === reviewCards.length ? (
                  <CheckSquareIcon className="h-5 w-5 text-sky-600" weight="fill" />
                ) : (
                  <SquareIcon className="h-5 w-5" />
                )}
              </button>

              <span className="h-3.5 w-3.5 rounded-full bg-amber-500 shadow-sm"></span>
              <h3 className="text-base font-bold text-slate-900">
                {reviewList ? reviewList.name : reviewListName}
              </h3>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
                {reviewCards.length} thẻ
              </span>
            </div>
            <span className="text-xs font-medium text-slate-400">Cột Chờ Tạo Listing</span>
          </div>

          {/* Cards List */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 thin-scrollbar">
            {reviewCards.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-6 text-center">
                <p className="text-xs text-slate-400">Không có thẻ nào trong danh sách duyệt nội bộ</p>
              </div>
            ) : (
              reviewCards.map((card) => {
                const isSelected = selectedCardIds.has(card.id);
                const isProcessing = processingCardId === card.id;
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

                return (
                  <div
                    key={card.id}
                    draggable={!loading && !batchProcessing && !isProcessing}
                    onDragStart={(e) => {
                      setDraggedCardId(card.id);
                      e.dataTransfer.setData("text/plain", card.id);
                    }}
                    onDragEnd={() => setDraggedCardId(null)}
                    className={`group rounded-xl border p-4 transition shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing ${
                      isSelected
                        ? "border-sky-500 bg-sky-50/40 ring-2 ring-sky-400/30"
                        : "border-slate-200 bg-white hover:border-sky-300"
                    } ${isProcessing ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    {/* Card Header & Checkbox */}
                    <div className="mb-3 flex items-start gap-3">
                      <button
                        onClick={() => toggleSelectCard(card.id)}
                        className="mt-0.5 shrink-0 text-slate-400 hover:text-sky-600"
                      >
                        {isSelected ? (
                          <CheckSquareIcon className="h-5 w-5 text-sky-600" weight="fill" />
                        ) : (
                          <SquareIcon className="h-5 w-5" />
                        )}
                      </button>

                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {/* SKU Tag Badge */}
                          <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-800 border border-sky-200">
                            SKU: {card.parsed?.sku || "N/A"}
                          </span>

                          {/* Marketplace Tag */}
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                            {marketplace} 🇺🇸
                          </span>
                        </div>

                        <h4 className="mt-1.5 text-sm font-bold text-slate-900 leading-snug">
                          {card.parsed?.itemName || card.name}
                        </h4>
                      </div>
                    </div>

                    {/* Image Mockups Preview Gallery */}
                    {imageAttachments.length > 0 && (
                      <div className="mb-3">
                        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                          <span className="flex items-center gap-1">
                            <ImageSquareIcon className="h-3.5 w-3.5 text-sky-600" />
                            Ảnh Mockups đính kèm ({imageAttachments.length} ảnh)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 thin-scrollbar">
                          {imageAttachments.map((img, idx) => (
                            <div
                              key={img.id || idx}
                              onClick={() => setPreviewImageUrl(img.url)}
                              className="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-inner group/img hover:border-sky-400"
                              title="Click để phóng to ảnh mockup"
                            >
                              <img
                                src={img.url}
                                alt={img.name}
                                className="h-full w-full object-cover transition group-hover/img:scale-105"
                              />
                              <span className="absolute bottom-0.5 right-0.5 rounded bg-slate-900/80 px-1 py-0.2 text-[9px] font-bold text-white">
                                #{idx + 1}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generic Keywords Pill Tags */}
                    {keywordsList.length > 0 && (
                      <div className="mb-3.5 flex flex-wrap gap-1">
                        {keywordsList.map((kw, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200"
                          >
                            #{kw}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-slate-400 hover:text-sky-600 hover:underline"
                      >
                        Xem trên Trello ↗
                      </a>

                      <button
                        onClick={() => processCardToListing(card)}
                        disabled={isProcessing || loading || batchProcessing}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-sky-700 transition disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <>
                            <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                            <span>Đang xử lý...</span>
                          </>
                        ) : (
                          <>
                            <LightningIcon className="h-3.5 w-3.5 fill-current" />
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
          className={`flex w-1/2 flex-col rounded-2xl border p-5 shadow-sm transition ${
            draggedCardId
              ? "border-emerald-500 bg-emerald-50/20 ring-4 ring-emerald-400/20"
              : "border-slate-200 bg-white"
          }`}
        >
          {/* Column Header */}
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded-full bg-emerald-500 shadow-sm"></span>
              <h3 className="text-base font-bold text-slate-900">
                {listingList ? listingList.name : listingListName}
              </h3>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                {listingCards.length} thẻ
              </span>
            </div>
            <span className="text-xs font-medium text-slate-400">Đã Tạo Listing & Đính Kèm CSV</span>
          </div>

          {/* Cards List */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 thin-scrollbar">
            {listingCards.length === 0 ? (
              <div className={`flex h-48 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition ${
                draggedCardId
                  ? "border-emerald-400 bg-emerald-50/50 text-emerald-800"
                  : "border-slate-200 text-slate-400"
              }`}>
                <p className="text-xs font-bold">
                  {draggedCardId
                    ? "✨ Thả thẻ vào đây để tự động tạo Listing & Đính kèm Excel!"
                    : "Chưa có thẻ nào trong cột Listing (Kéo thẻ từ cột Duyệt Nội Bộ thả vào đây để tự động xử lý)"}
                </p>
              </div>
            ) : (
              listingCards.map((card) => {
                const csvAttachment = (card.attachments || []).find(
                  (a) => a.name.endsWith(".csv") || a.name.endsWith(".xlsx") || a.mimeType === "text/csv",
                );
                const localAttachment = processedCardsMap[card.id];
                const fileUrl =
                  csvAttachment?.url ||
                  localAttachment?.attachmentUrl ||
                  `/api/trello/download-card-excel?cardId=${card.id}&apiKey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}&templateId=${encodeURIComponent(templateId)}`;
                const fileName =
                  csvAttachment?.name ||
                  localAttachment?.name ||
                  `${(card.parsed?.sku || "listing").toLowerCase()}-amazon-listing.xlsx`;

                return (
                  <div
                    key={card.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block rounded-md bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200">
                          SKU: {card.parsed?.sku || "N/A"}
                        </span>
                        <h4 className="mt-1.5 text-sm font-bold text-slate-900 leading-snug">
                          {card.parsed?.itemName || card.name}
                        </h4>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3 border border-emerald-200 text-xs font-medium text-emerald-900">
                      <div className="flex items-center gap-2.5 truncate">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0 shadow-sm">
                          <FileXlsIcon className="h-5 w-5" />
                        </div>
                        <div className="truncate">
                          <p className="truncate font-bold text-slate-900">{fileName}</p>
                          <p className="text-[11px] font-bold text-emerald-700">Đầu Ra Amazon Flat File Excel (.xlsx)</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-md transition"
                        >
                          <DownloadSimpleIcon className="h-4 w-4" />
                          <span>Tải File Excel</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
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
                        ✕ Xóa
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

      {/* Quick Add Template Modal */}
      {showAddTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <FileXlsIcon className="h-5 w-5 text-emerald-600" />
                Quản Lý & Thêm Amazon Excel Template
              </h3>
              <button
                type="button"
                onClick={() => setShowAddTemplateModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            {templates.length > 0 && (
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Template hiện có</label>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 border border-slate-200 text-xs">
                      <span className="font-semibold text-slate-800 truncate max-w-[240px]">{getTemplateDisplayName(t)}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(t.id)}
                        className="text-rose-500 hover:text-rose-700 text-xs font-bold px-2 py-0.5 rounded hover:bg-rose-50 transition shrink-0"
                        title="Xóa template này"
                      >
                        ✕ Xóa
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={handleAddTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tên Template *</label>
                <input
                  type="text"
                  required
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Ví dụ: Glass Ornament Template 2026"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">File Amazon Template (.xlsx hoặc .xlsm) *</label>
                <input
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
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={addingTemplate || !newTemplateName.trim() || !newTemplateFile}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {addingTemplate && <SpinnerIcon className="h-4 w-4 animate-spin" />}
                  Tải Up Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
