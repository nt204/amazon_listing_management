"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatCircleDotsIcon, CopyIcon } from "@phosphor-icons/react";

export type UrgencyLevel = "low" | "medium" | "high" | "urgent";
export type CardStatus = "todo" | "in_progress" | "done";

export interface KanbanCardItem {
  id: string;
  title: string;
  description: string;
  urgency: UrgencyLevel;
  status: CardStatus;
  featureName: string;
  images: string[];
  authorName: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface KanbanCommentItem {
  id: string;
  cardId: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureOption {
  id: string;
  label: string;
  badgeClass: string;
}

export const KANBAN_FEATURES: FeatureOption[] = [
  {
    id: "Listing",
    label: "Listing",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200 font-bold",
  },
  {
    id: "Mockup design",
    label: "Mockup design",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200 font-bold",
  },
  {
    id: "Đào Keyword",
    label: "Đào Keyword",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 font-bold",
  },
  {
    id: "PPC Analytics",
    label: "PPC Analytics",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 font-bold",
  },
  {
    id: "Kế toán Amazon",
    label: "Kế toán Amazon",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 font-bold",
  },
  {
    id: "Chung / Khác",
    label: "Chung / Khác",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-300 font-bold",
  },
];

export function getFeatureBadgeClass(featureName?: string): string {
  if (!featureName) return "bg-slate-100 text-slate-600 border-slate-200 font-medium";
  const found = KANBAN_FEATURES.find(
    (f) => f.id.toLowerCase() === featureName.toLowerCase() || f.label.toLowerCase() === featureName.toLowerCase()
  );
  return found?.badgeClass || "bg-indigo-50 text-indigo-700 border-indigo-200 font-bold";
}

interface KanbanBoardProps {
  currentUser?: {
    displayName?: string;
    email?: string;
  };
}

const COLUMNS: { id: CardStatus; title: string; hintBadgeClass: string }[] = [
  {
    id: "todo",
    title: "Ý kiến",
    hintBadgeClass: "bg-slate-100 text-slate-700 border-slate-200",
  },
  {
    id: "in_progress",
    title: "Đang sửa",
    hintBadgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    id: "done",
    title: "Đã sửa",
    hintBadgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
];

const URGENCY_CONFIG: Record<UrgencyLevel, { label: string; badgeClass: string; borderClass: string }> = {
  urgent: {
    label: "Khẩn cấp",
    badgeClass: "bg-red-50 text-red-700 border-red-200 font-bold",
    borderClass: "border-l-4 border-l-red-500",
  },
  high: {
    label: "Cao",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 font-semibold",
    borderClass: "border-l-4 border-l-amber-500",
  },
  medium: {
    label: "Trung bình",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200 font-medium",
    borderClass: "border-l-4 border-l-sky-500",
  },
  low: {
    label: "Thấp",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200 font-medium",
    borderClass: "border-l-4 border-l-slate-400",
  },
};

// Helper: compress image file to Base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return reject(new Error("Không thể đọc file"));

      // If file is image, compress using canvas to keep payload reasonable
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1600;
        const maxHeight = 1600;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return resolve(result);
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", 0.82);
        resolve(compressed);
      };
      img.onerror = () => resolve(result);
      img.src = result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDate(iso: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const COMMENT_BUBBLE_COLORS = [
  "border-indigo-100 bg-indigo-50/70",
  "border-sky-100 bg-sky-50/70",
  "border-emerald-100 bg-emerald-50/70",
  "border-amber-100 bg-amber-50/70",
  "border-rose-100 bg-rose-50/70",
  "border-violet-100 bg-violet-50/70",
];

function commentBubbleColor(authorName: string) {
  const value = authorName.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return COMMENT_BUBBLE_COLORS[hash % COMMENT_BUBBLE_COLORS.length];
}

export function KanbanBoard({ currentUser }: KanbanBoardProps) {
  const [cards, setCards] = useState<KanbanCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyLevel | "all">("all");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  const [mobileColumn, setMobileColumn] = useState<CardStatus>("todo");

  // Drag and Drop state
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<CardStatus | null>(null);

  // Modal create/edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<KanbanCardItem | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFeature, setFormFeature] = useState<string>("PPC Analytics");
  const [formUrgency, setFormUrgency] = useState<UrgencyLevel>("medium");
  const [formStatus, setFormStatus] = useState<CardStatus>("todo");
  const [formAuthor, setFormAuthor] = useState("");
  const [formImages, setFormImages] = useState<string[]>([]);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Detail & Preview image modals
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedCardForDetail, setSelectedCardForDetail] = useState<KanbanCardItem | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [comments, setComments] = useState<KanbanCommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load cards from API
  const fetchCards = useCallback(async () => {
    try {
      const res = await fetch("/api/kanban", { cache: "no-store" });
      if (!res.ok) throw new Error("Lỗi khi tải dữ liệu");
      const data = (await res.json()) as { cards?: KanbanCardItem[] };
      setCards(data.cards || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCards();
  }, [fetchCards]);

  // Báo cho Sidebar cập nhật số lượng badge đỏ ngay khi thẻ thay đổi
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kanban-count-updated"));
    }
  }, [cards]);

  // Open modal for creating new note
  const handleOpenCreateModal = (defaultStatus: CardStatus = "todo") => {
    setEditingCard(null);
    setFormTitle("");
    setFormDescription("");
    setFormFeature(featureFilter !== "all" ? featureFilter : "PPC Analytics");
    setFormUrgency("medium");
    setFormStatus(defaultStatus);
    setFormAuthor(currentUser?.displayName || "");
    setFormImages([]);
    setFormError(null);
    setIsModalOpen(true);
  };

  // Open modal for editing card
  const handleOpenEditModal = (card: KanbanCardItem) => {
    setEditingCard(card);
    setFormTitle(card.title);
    setFormDescription(card.description);
    setFormFeature(card.featureName || "PPC Analytics");
    setFormUrgency(card.urgency);
    setFormStatus(card.status);
    setFormAuthor(card.authorName);
    setFormImages(card.images || []);
    setFormError(null);
    setIsModalOpen(true);
    if (selectedCardForDetail?.id === card.id) {
      setSelectedCardForDetail(null);
    }
  };

  // Handle image upload from file selector
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const newImages: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith("image/")) {
          const b64 = await fileToBase64(file);
          newImages.push(b64);
        }
      }
      setFormImages((prev) => [...prev, ...newImages]);
    } catch {
      setFormError("Không thể tải lên ảnh này. Vui lòng thử lại.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Handle paste image from clipboard in form
  const handleFormPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          try {
            const b64 = await fileToBase64(file);
            setFormImages((prev) => [...prev, b64]);
          } catch {
            // ignore
          }
        }
      }
    }
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setFormImages((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const copyDetailDescription = async (description: string) => {
    if (!description.trim()) return;

    try {
      await navigator.clipboard.writeText(description);
      setCopyFeedback("Đã sao chép mô tả.");
    } catch {
      setCopyFeedback("Không thể sao chép mô tả. Vui lòng thử lại.");
    }
  };

  const copyAttachedImage = async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Không thể tải ảnh");

      const imageBlob = await response.blob();
      if (!imageBlob.type.startsWith("image/") || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Trình duyệt không hỗ trợ sao chép ảnh");
      }

      await navigator.clipboard.write([new ClipboardItem({ [imageBlob.type]: imageBlob })]);
      setCopyFeedback("Đã sao chép ảnh. Bạn có thể dán vào chat hoặc tài liệu.");
    } catch {
      try {
        await navigator.clipboard.writeText(imageUrl);
        setCopyFeedback("Không thể sao chép tệp ảnh, đã sao chép liên kết ảnh.");
      } catch {
        setCopyFeedback("Không thể sao chép ảnh. Vui lòng thử lại.");
      }
    }
  };

  // Save card (Create or Update)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError("Vui lòng nhập tên lỗi.");
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      if (editingCard) {
        // Update
        const res = await fetch(`/api/kanban/${editingCard.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle.trim(),
            description: formDescription.trim(),
            featureName: formFeature.trim(),
            urgency: formUrgency,
            status: formStatus,
            authorName: formAuthor.trim(),
            images: formImages,
          }),
        });
        if (!res.ok) throw new Error("Không thể cập nhật thẻ");
        const data = (await res.json()) as { card: KanbanCardItem };
        setCards((prev) => prev.map((c) => (c.id === data.card.id ? data.card : c)));
      } else {
        // Create
        const res = await fetch("/api/kanban", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: formTitle.trim(),
            description: formDescription.trim(),
            featureName: formFeature.trim(),
            urgency: formUrgency,
            status: formStatus,
            authorName: formAuthor.trim(),
            images: formImages,
          }),
        });
        if (!res.ok) throw new Error("Không thể tạo thẻ mới");
        const data = (await res.json()) as { card: KanbanCardItem };
        setCards((prev) => [data.card, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Đã xảy ra lỗi.");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Delete card
  const handleDeleteCard = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa thẻ này?")) return;
    try {
      const res = await fetch(`/api/kanban/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Không thể xóa thẻ");
      setCards((prev) => prev.filter((c) => c.id !== id));
      if (selectedCardForDetail?.id === id) {
        setSelectedCardForDetail(null);
      }
    } catch {
      alert("Lỗi khi xóa thẻ.");
    }
  };

  // Move card status (API + Optimistic Update)
  const moveCardToStatus = async (cardId: string, newStatus: CardStatus) => {
    const cardToMove = cards.find((c) => c.id === cardId);
    if (!cardToMove || cardToMove.status === newStatus) return;

    // Optimistic UI update
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, status: newStatus } : c)),
    );

    try {
      const res = await fetch(`/api/kanban/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Không thể di chuyển");
    } catch {
      // Revert if error
      void fetchCards();
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    setDraggedCardId(cardId);
    e.dataTransfer.setData("text/plain", cardId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverColumn = (e: React.DragEvent, columnId: CardStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverColumn !== columnId) {
      setDragOverColumn(columnId);
    }
  };

  const handleDragLeaveColumn = (e: React.DragEvent, columnId: CardStatus) => {
    // Only reset if leaving the column itself
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverColumn === columnId) {
      setDragOverColumn(null);
    }
  };

  const handleDropOnColumn = (e: React.DragEvent, targetColumnId: CardStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const cardId = draggedCardId || e.dataTransfer.getData("text/plain");
    if (!cardId) return;

    setDraggedCardId(null);
    void moveCardToStatus(cardId, targetColumnId);
  };

  const handleDragEnd = () => {
    setDraggedCardId(null);
    setDragOverColumn(null);
  };

  const handleOpenCardDetail = (card: KanbanCardItem) => {
    setCopyFeedback(null);
    setCommentText("");
    setComments([]);
    setSelectedCardForDetail(card);
    setCommentsLoading(true);
    void fetch(`/api/kanban/${card.id}/comments`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải comment");
        return response.json() as Promise<{ comments?: KanbanCommentItem[] }>;
      })
      .then((data) => setComments(data.comments || []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  };

  const handleSubmitComment = async () => {
    const card = selectedCardForDetail;
    const body = commentText.trim();
    if (!card || !body || commentSubmitting) return;

    setCommentSubmitting(true);
    try {
      const response = await fetch(`/api/kanban/${card.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await response.json()) as { comment?: KanbanCommentItem; error?: string };
      if (!response.ok || !data.comment) throw new Error(data.error || "Không thể thêm comment.");
      setComments((current) => [...current, data.comment!]);
      setCommentText("");
    } catch (error) {
      setCopyFeedback(error instanceof Error ? error.message : "Không thể thêm comment.");
    } finally {
      setCommentSubmitting(false);
    }
  };

  // Filtered cards
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (featureFilter !== "all" && (card.featureName || "") !== featureFilter) {
        return false;
      }
      if (urgencyFilter !== "all" && card.urgency !== urgencyFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const inTitle = card.title.toLowerCase().includes(query);
        const inDesc = card.description.toLowerCase().includes(query);
        const inAuthor = card.authorName.toLowerCase().includes(query);
        const inFeature = (card.featureName || "").toLowerCase().includes(query);
        if (!inTitle && !inDesc && !inAuthor && !inFeature) return false;
      }
      return true;
    });
  }, [cards, featureFilter, urgencyFilter, searchQuery]);

  return (
    <div className="font-accounting-system flex h-full w-full flex-col bg-slate-50 text-slate-900 overflow-hidden select-none">
      {/* TOP CONTROLS BAR */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 sm:px-4 md:px-6 py-3 md:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm sm:text-base font-black tracking-tight text-slate-900">
              Bảng Kanban Góp Ý &amp; Báo Lỗi
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
              {cards.length} thẻ
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
            {/* Search Box */}
            <input
              type="text"
              placeholder="Tìm theo tên lỗi, mô tả, chức năng..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full sm:w-56 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
            />

            {/* Filter by Feature */}
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <span className="text-xs font-bold text-slate-500 shrink-0">Chức năng:</span>
              <select
                value={featureFilter}
                onChange={(e) => setFeatureFilter(e.target.value)}
                className="h-9 flex-1 sm:flex-initial rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 focus:border-indigo-500 focus:outline-hidden cursor-pointer"
              >
                <option value="all">Tất cả chức năng</option>
                {KANBAN_FEATURES.map((feat) => (
                  <option key={feat.id} value={feat.id}>
                    {feat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter by Urgency */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold overflow-x-auto max-w-full thin-scrollbar py-0.5">
              <button
                type="button"
                onClick={() => setUrgencyFilter("all")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer shrink-0 ${
                  urgencyFilter === "all"
                    ? "bg-white text-slate-900 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => setUrgencyFilter("urgent")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer shrink-0 ${
                  urgencyFilter === "urgent"
                    ? "bg-red-500 text-white font-bold"
                    : "text-red-700 hover:bg-red-50"
                }`}
              >
                Khẩn cấp
              </button>
              <button
                type="button"
                onClick={() => setUrgencyFilter("high")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer shrink-0 ${
                  urgencyFilter === "high"
                    ? "bg-amber-500 text-white font-bold"
                    : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                Cao
              </button>
              <button
                type="button"
                onClick={() => setUrgencyFilter("medium")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer shrink-0 ${
                  urgencyFilter === "medium"
                    ? "bg-sky-500 text-white font-bold"
                    : "text-sky-700 hover:bg-sky-50"
                }`}
              >
                Trung bình
              </button>
              <button
                type="button"
                onClick={() => setUrgencyFilter("low")}
                className={`rounded-md px-2.5 py-1 transition cursor-pointer shrink-0 ${
                  urgencyFilter === "low"
                    ? "bg-slate-500 text-white font-bold"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                Thấp
              </button>
            </div>

            {/* Create Card Button */}
            <button
              type="button"
              onClick={() => handleOpenCreateModal("todo")}
              className="h-9 w-full sm:w-auto rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer flex items-center justify-center gap-1 shrink-0"
            >
              + Thêm ý kiến
            </button>
          </div>
        </div>
      </div>

      {/* KANBAN BOARD COLUMNS AREA */}
      <div className="flex-1 overflow-x-auto p-3 sm:p-4 md:p-6 flex flex-col min-h-0">
        {/* Mobile Segmented Column Tabs (< lg) */}
        <div className="flex lg:hidden items-center bg-slate-200/80 p-1 rounded-xl mb-3 gap-1 shrink-0">
          {COLUMNS.map((col) => {
            const count = filteredCards.filter((c) => c.status === col.id).length;
            const isActive = mobileColumn === col.id;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => setMobileColumn(col.id)}
                className={`flex-1 py-2 px-2 text-xs font-bold rounded-lg text-center transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  isActive ? "bg-white text-indigo-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>{col.title}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${isActive ? "bg-indigo-100 text-indigo-800" : "bg-slate-300 text-slate-700"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-5 flex-1 min-h-0">
          {COLUMNS.map((column) => {
            const columnCards = filteredCards.filter((c) => c.status === column.id);
            const isTarget = dragOverColumn === column.id;
            const isVisibleOnMobile = mobileColumn === column.id;

            return (
              <div
                key={column.id}
                onDragOver={(e) => handleDragOverColumn(e, column.id)}
                onDragLeave={(e) => handleDragLeaveColumn(e, column.id)}
                onDrop={(e) => handleDropOnColumn(e, column.id)}
                className={`flex h-full flex-col rounded-xl border bg-slate-100/90 transition-all duration-150 ${
                  isVisibleOnMobile ? "flex" : "hidden lg:flex"
                } ${
                  isTarget
                    ? "border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-300"
                    : "border-slate-200/80"
                }`}
              >
                {/* COLUMN HEADER */}
                <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 bg-white/70 rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-extrabold text-slate-800">
                      {column.title}
                    </h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-bold ${column.hintBadgeClass}`}
                    >
                      {columnCards.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenCreateModal(column.id)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    + Thêm
                  </button>
                </div>

                {/* CARDS LIST CONTAINER */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 thin-scrollbar">
                  {loading ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      Đang tải dữ liệu...
                    </div>
                  ) : columnCards.length === 0 ? (
                    <div className="flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                      {isTarget ? "Thả thẻ vào đây" : "Chưa có thẻ nào"}
                    </div>
                  ) : (
                    columnCards.map((card) => {
                      const urgencyInfo = URGENCY_CONFIG[card.urgency];
                      const isDragging = draggedCardId === card.id;

                      return (
                        <div
                          key={card.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, card.id)}
                          onDragEnd={handleDragEnd}
                          onClick={() => handleOpenCardDetail(card)}
                          className={`group cursor-grab active:cursor-grabbing rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs transition-all hover:border-slate-300 hover:shadow-xs ${
                            urgencyInfo.borderClass
                          } ${isDragging ? "opacity-40 scale-95" : "opacity-100"}`}
                        >
                          {/* CARD TOP: Feature Badge + Urgency Badge + Date */}
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              {card.featureName ? (
                                <span
                                  className={`rounded border px-2 py-0.5 text-[11px] ${getFeatureBadgeClass(
                                    card.featureName
                                  )}`}
                                >
                                  {card.featureName}
                                </span>
                              ) : null}
                              <span
                                className={`rounded border px-2 py-0.5 text-[11px] ${urgencyInfo.badgeClass}`}
                              >
                                {urgencyInfo.label}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono shrink-0">
                              {formatDate(card.createdAt)}
                            </span>
                          </div>

                          {/* CARD TITLE */}
                          <h4 className="text-xs font-bold text-slate-900 leading-snug">
                            {card.title}
                          </h4>

                          {/* CARD DESCRIPTION */}
                          {card.description && (
                            <p className="mt-1 text-[11px] text-slate-600 line-clamp-3 leading-relaxed whitespace-pre-line">
                              {card.description}
                            </p>
                          )}

                          {/* IMAGE THUMBNAILS (if any) */}
                          {card.images && card.images.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {card.images.slice(0, 3).map((imgUrl, imgIdx) => (
                                <button
                                  key={imgIdx}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewImage(imgUrl);
                                  }}
                                  className="relative h-12 w-12 overflow-hidden rounded border border-slate-200 bg-slate-100 hover:opacity-90 cursor-zoom-in"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={imgUrl}
                                    alt="Ảnh đính kèm"
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              ))}
                              {card.images.length > 3 && (
                                <div className="flex h-12 w-12 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                  +{card.images.length - 3}
                                </div>
                              )}
                            </div>
                          )}

                          {/* CARD FOOTER: Author + Column Shift Actions */}
                          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
                            <span className="text-slate-500 font-medium truncate max-w-[110px]">
                              {card.authorName || "Ẩn danh"}
                            </span>

                            {/* Quick column mover buttons */}
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Xem và thêm comment"
                                aria-label="Xem và thêm comment"
                                onClick={() => handleOpenCardDetail(card)}
                                className="flex h-6 w-6 items-center justify-center rounded border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-800 cursor-pointer"
                              >
                                <ChatCircleDotsIcon size={14} weight="bold" />
                              </button>
                              {column.id !== "todo" && (
                                <button
                                  type="button"
                                  title="Chuyển về Ý kiến"
                                  onClick={() => moveCardToStatus(card.id, "todo")}
                                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                                >
                                  ← Ý kiến
                                </button>
                              )}
                              {column.id !== "in_progress" && (
                                <button
                                  type="button"
                                  title="Chuyển sang Đang sửa"
                                  onClick={() => moveCardToStatus(card.id, "in_progress")}
                                  className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer"
                                >
                                  Đang sửa
                                </button>
                              )}
                              {column.id !== "done" && (
                                <button
                                  type="button"
                                  title="Chuyển sang Đã sửa"
                                  onClick={() => moveCardToStatus(card.id, "done")}
                                  className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                                >
                                  Đã sửa →
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-3 sm:p-4">
          <div
            className="w-full max-w-lg max-h-[92vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
            onPaste={handleFormPaste}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5 bg-slate-50/50 rounded-t-xl">
              <h3 className="text-sm font-extrabold text-slate-900">
                {editingCard ? "Chỉnh sửa thẻ" : "Thêm ý kiến / Báo lỗi mới"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                Đóng
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-4 sm:p-5 space-y-4 flex-1 overflow-y-auto">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {formError}
                </div>
              )}

              {/* Tên lỗi */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tên lỗi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Lỗi không lưu được từ khóa, Hiển thị sai giá..."
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Chức năng liên quan */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Chức năng liên quan <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
                  {KANBAN_FEATURES.map((feat) => {
                    const isSelected = formFeature === feat.id;
                    return (
                      <button
                        key={feat.id}
                        type="button"
                        onClick={() => setFormFeature(feat.id)}
                        className={`rounded-lg border py-2 px-2 text-xs font-bold text-center transition cursor-pointer flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300 shadow-2xs"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <span>{feat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mức độ cấp thiết */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mức độ cấp thiết
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
                  {(
                    [
                      { id: "urgent", label: "Khẩn cấp", activeClass: "bg-red-500 text-white border-red-600 font-bold" },
                      { id: "high", label: "Cao", activeClass: "bg-amber-500 text-white border-amber-600 font-bold" },
                      { id: "medium", label: "Trung bình", activeClass: "bg-sky-500 text-white border-sky-600 font-bold" },
                      { id: "low", label: "Thấp", activeClass: "bg-slate-600 text-white border-slate-700 font-bold" },
                    ] as const
                  ).map((lvl) => (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => setFormUrgency(lvl.id)}
                      className={`rounded-lg border py-2 text-xs text-center transition cursor-pointer ${
                        formUrgency === lvl.id
                          ? lvl.activeClass
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cột trạng thái */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Trạng thái
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {COLUMNS.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setFormStatus(col.id)}
                      className={`rounded-lg border py-1.5 text-xs text-center transition cursor-pointer ${
                        formStatus === col.id
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {col.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mô tả chi tiết */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mô tả chi tiết
                </label>
                <textarea
                  rows={4}
                  placeholder="Mô tả cụ thể các bước gây lỗi, nội dung mong muốn sửa đổi..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Kèm ảnh */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Ảnh đính kèm
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Có thể dán (Ctrl+V) ảnh chụp màn hình trực tiếp
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                  >
                    + Chọn file ảnh từ máy
                  </button>

                  {formImages.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      className="group relative h-14 w-14 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt="Đính kèm"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute top-0 right-0 rounded-bl bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white hover:bg-red-700 cursor-pointer"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tên người note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Người ghi chú
                </label>
                <input
                  type="text"
                  placeholder="Tên của bạn..."
                  value={formAuthor}
                  onChange={(e) => setFormAuthor(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* FOOTER BUTTONS */}
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer disabled:opacity-50"
                >
                  {formSubmitting ? "Đang lưu..." : editingCard ? "Lưu thay đổi" : "Tạo thẻ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CARD DETAIL VIEW MODAL */}
      {selectedCardForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-3 sm:p-4">
          <div className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5 bg-slate-50/50 rounded-t-xl">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedCardForDetail.featureName && (
                  <span
                    className={`rounded border px-2 py-0.5 text-xs ${getFeatureBadgeClass(
                      selectedCardForDetail.featureName
                    )}`}
                  >
                    {selectedCardForDetail.featureName}
                  </span>
                )}
                <span
                  className={`rounded border px-2 py-0.5 text-xs ${
                    URGENCY_CONFIG[selectedCardForDetail.urgency].badgeClass
                  }`}
                >
                  {URGENCY_CONFIG[selectedCardForDetail.urgency].label}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {formatDate(selectedCardForDetail.createdAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCardForDetail(null)}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                Đóng
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 flex-1 overflow-y-auto">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {selectedCardForDetail.title}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Người tạo:{" "}
                  <span className="font-semibold text-slate-700">
                    {selectedCardForDetail.authorName || "Ẩn danh"}
                  </span>
                </p>
              </div>

              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-xs font-bold text-slate-700">Mô tả chi tiết</h4>
                  <button
                    type="button"
                    onClick={() => void copyDetailDescription(selectedCardForDetail.description)}
                    disabled={!selectedCardForDetail.description.trim()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Sao chép mô tả"
                    aria-label="Sao chép mô tả"
                  >
                    <CopyIcon size={14} weight="bold" />
                  </button>
                </div>
                <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                  {selectedCardForDetail.description || "Không có mô tả chi tiết."}
                </p>
              </div>

              {selectedCardForDetail.images && selectedCardForDetail.images.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2">Ảnh đính kèm</h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {selectedCardForDetail.images.map((imgUrl, idx) => (
                      <div
                        key={idx}
                        className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewImage(imgUrl)}
                          className="block w-full cursor-zoom-in hover:opacity-90"
                          aria-label={`Phóng to ảnh đính kèm ${idx + 1}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgUrl}
                            alt={`Ảnh đính kèm ${idx + 1}`}
                            className="h-28 w-full object-cover"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyAttachedImage(imgUrl)}
                          className="flex h-8 w-full items-center justify-center border-t border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                          title={`Sao chép ảnh đính kèm ${idx + 1}`}
                          aria-label={`Sao chép ảnh đính kèm ${idx + 1}`}
                        >
                          <CopyIcon size={14} weight="bold" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <section className="border-t border-slate-100 pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h4 className="text-xs font-bold text-slate-700">Comment</h4>
                  {!commentsLoading && comments.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {comments.length}
                    </span>
                  )}
                </div>

                <div className="max-h-52 space-y-2 overflow-y-auto pr-1 thin-scrollbar">
                  {commentsLoading ? (
                    <p className="py-3 text-center text-xs text-slate-400">Đang tải comment...</p>
                  ) : comments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                      Chưa có comment. Hãy thêm trao đổi đầu tiên.
                    </p>
                  ) : (
                    comments.map((comment) => (
                      <article
                        key={comment.id}
                        className={`rounded-xl border px-3 py-2.5 ${commentBubbleColor(comment.authorName)}`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-[10px]">
                          <span className="truncate font-bold text-slate-700">{comment.authorName}</span>
                          <time className="shrink-0 text-slate-400">{formatDate(comment.createdAt)}</time>
                        </div>
                        <p className="whitespace-pre-line text-xs leading-relaxed text-slate-700">{comment.body}</p>
                      </article>
                    ))
                  )}
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <textarea
                    rows={2}
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        void handleSubmitComment();
                      }
                    }}
                    placeholder="Viết comment..."
                    className="min-h-16 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSubmitComment()}
                    disabled={!commentText.trim() || commentSubmitting}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {commentSubmitting ? "Đang gửi" : "Gửi"}
                  </button>
                </div>
              </section>

              {copyFeedback && (
                <p className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] font-medium text-indigo-800" role="status">
                  {copyFeedback}
                </p>
              )}

              {/* Status switcher in modal */}
              <div className="border-t border-slate-100 pt-4">
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Trạng thái hiện tại
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {COLUMNS.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => {
                        void moveCardToStatus(selectedCardForDetail.id, col.id);
                        setSelectedCardForDetail((prev) =>
                          prev ? { ...prev, status: col.id } : null,
                        );
                      }}
                      className={`rounded-lg border py-2 text-xs text-center transition cursor-pointer ${
                        selectedCardForDetail.status === col.id
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {col.title}
                    </button>
                  ))}
                </div>
              </div>

              {/* ACTIONS */}
              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => handleDeleteCard(selectedCardForDetail.id)}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 cursor-pointer"
                >
                  Xóa thẻ
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenEditModal(selectedCardForDetail)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Chỉnh sửa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL IMAGE PREVIEW MODAL */}
      {previewImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-1 mb-1">
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-bold text-white hover:bg-slate-700 cursor-pointer"
              >
                Đóng ảnh
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage}
              alt="Phóng to ảnh"
              className="max-h-[80vh] max-w-full rounded object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
