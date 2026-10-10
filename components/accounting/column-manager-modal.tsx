"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  LockIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";

export interface ColumnConfig {
  id: string;
  label: string;
  defaultLabel: string;
  visible: boolean;
  isCustom?: boolean;
  isFrozen?: boolean;
  type?: "text" | "number" | "date";
  width?: string;
  align?: "left" | "center" | "right";
}

export const DEFAULT_SKU_COLUMNS: ColumnConfig[] = [
  { id: "stt", label: "STT", defaultLabel: "STT", visible: true, isFrozen: true, align: "center", width: "w-[58px]" },
  { id: "product_type", label: "Product Type", defaultLabel: "Product Type", visible: true, isFrozen: true, width: "w-[155px]" },
  { id: "mockup", label: "Mockup", defaultLabel: "Mockup", visible: true, isFrozen: true, align: "center", width: "w-[76px]" },
  { id: "sku", label: "SKU", defaultLabel: "SKU", visible: true, isFrozen: true, width: "w-[160px]" },
  { id: "brand", label: "Brand", defaultLabel: "Brand", visible: true },
  { id: "asin", label: "ASIN", defaultLabel: "ASIN", visible: true },
  { id: "fnsku", label: "FNSKU", defaultLabel: "FNSKU", visible: true },
  { id: "amazon_fee", label: "AMAZON FEE", defaultLabel: "AMAZON FEE", visible: true, align: "center" },
  { id: "referral_fee_pct", label: "% Referal", defaultLabel: "% Referal", visible: true, align: "center" },
  { id: "pic_mkt", label: "PIC MKT", defaultLabel: "PIC MKT", visible: true },
  { id: "loai", label: "Loại", defaultLabel: "Loại", visible: true },
  { id: "niche", label: "Niche", defaultLabel: "Niche", visible: true },
  { id: "pic_idea", label: "PIC Idea", defaultLabel: "PIC Idea", visible: true },
  { id: "status", label: "Trạng thái", defaultLabel: "Trạng thái", visible: true },
  { id: "event", label: "Event", defaultLabel: "Event", visible: true },
  { id: "tinh_trang", label: "Tình trạng", defaultLabel: "Tình trạng", visible: true },
  { id: "design_pic", label: "DESIGN PIC", defaultLabel: "DESIGN PIC", visible: true },
  { id: "mockup_url", label: "Mockup url", defaultLabel: "Mockup url", visible: true },
  { id: "thang_listing", label: "Tháng listing", defaultLabel: "Tháng listing", visible: true },
  { id: "thang_danh_gia", label: "Tháng đánh giá", defaultLabel: "Tháng đánh giá", visible: true },
  { id: "event_250th", label: "Event 250th", defaultLabel: "Event 250th", visible: true },
  { id: "ngay_danh_gia_sku_event", label: "Ngày đánh giá SKU Event", defaultLabel: "Ngày đánh giá SKU Event", visible: true },
  { id: "amazon_fba_fee_thay_doi", label: "Amazon FBA Fee thay đổi", defaultLabel: "Amazon FBA Fee thay đổi", visible: true, align: "right" },
  { id: "basecost_tb", label: "Basecost trung bình", defaultLabel: "Basecost trung bình", visible: true, align: "right" },
  { id: "brand_entity_id", label: "Brand Entity ID", defaultLabel: "Brand Entity ID", visible: true },
  { id: "creative_asins_video", label: "Creative ASINs (Video)", defaultLabel: "Creative ASINs (Video)", visible: true },
  { id: "creative_asins_collection", label: "Creative ASINs (Collection)", defaultLabel: "Creative ASINs (Collection)", visible: true },
  { id: "video_media_ids", label: "Video Media IDs", defaultLabel: "Video Media IDs", visible: true },
  { id: "creative_headline", label: "Creative Headline", defaultLabel: "Creative Headline", visible: true },
  { id: "brand_logo_asset_id", label: "Brand Logo Asset ID", defaultLabel: "Brand Logo Asset ID", visible: true },
  { id: "landing_page_url", label: "Landing Page URL", defaultLabel: "Landing Page URL", visible: true },
];

export const DEFAULT_INBOUND_COLUMNS: ColumnConfig[] = [
  { id: "stt", label: "STT", defaultLabel: "STT", visible: true, isFrozen: true, align: "center", width: "w-[58px]" },
  { id: "product_type", label: "Product Type", defaultLabel: "Product Type", visible: true, isFrozen: true, width: "w-[155px]" },
  { id: "mockup", label: "Mockup", defaultLabel: "Mockup", visible: true, isFrozen: true, align: "center", width: "w-[76px]" },
  { id: "sku", label: "SKU", defaultLabel: "SKU", visible: true, isFrozen: true, width: "w-[160px]" },
  { id: "brand", label: "BRAND", defaultLabel: "BRAND", visible: true },
  { id: "sup", label: "SUP", defaultLabel: "SUP", visible: true },
  { id: "ngay_request", label: "Ngày request", defaultLabel: "Ngày request", visible: true },
  { id: "quantity", label: "Quantity", defaultLabel: "Quantity", visible: true, align: "right" },
  { id: "line_ship", label: "Line ship", defaultLabel: "Line ship", visible: true, align: "center" },
  { id: "base_cost_per_unit", label: "Base Cost /Unit", defaultLabel: "Base Cost /Unit", visible: true, align: "right" },
  { id: "card", label: "Card", defaultLabel: "Card", visible: true, align: "right" },
  { id: "tag", label: "Tag", defaultLabel: "Tag", visible: true, align: "right" },
  { id: "shipping_fee", label: "Shipping fee", defaultLabel: "Shipping fee", visible: true, align: "right" },
  { id: "hop_tui", label: "Hộp/túi", defaultLabel: "Hộp/túi", visible: true, align: "right" },
  { id: "final_basecost", label: "Final Basecost", defaultLabel: "Final Basecost", visible: true, align: "right" },
  { id: "total_basecost", label: "Total Basecost", defaultLabel: "Total Basecost", visible: true, align: "right" },
  { id: "ngay_thanh_toan", label: "Ngày thanh toán", defaultLabel: "Ngày thanh toán", visible: true },
  { id: "ten_lo_hang", label: "Tên lô hàng", defaultLabel: "Tên lô hàng", visible: true },
  { id: "shipment_id", label: "Shipment ID", defaultLabel: "Shipment ID", visible: true },
  { id: "ngay_di", label: "Ngày đi", defaultLabel: "Ngày đi", visible: true },
  { id: "ngay_den", label: "Ngày đến", defaultLabel: "Ngày đến", visible: true },
  { id: "amazon_received", label: "Amazon Received", defaultLabel: "Amazon Received", visible: true, align: "right" },
  { id: "tinh_trang_hang_den_kho", label: "Tình trạng hàng đến kho", defaultLabel: "Tình trạng hàng đến kho", visible: true },
  { id: "status", label: "Status", defaultLabel: "Status", visible: true },
  { id: "so_luong_amazon_nhan", label: "Số lượng Amazon nhận", defaultLabel: "Số lượng Amazon nhận", visible: true, align: "right" },
  { id: "discrepancy", label: "Discrepancy", defaultLabel: "Discrepancy", visible: true, align: "center" },
  { id: "note", label: "Note", defaultLabel: "Note", visible: true },
  { id: "trang_thai", label: "Trạng thái", defaultLabel: "Trạng thái", visible: true },
];

export function ColumnHeaderCell({
  col,
  children,
  className = "",
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onQuickHide,
  onQuickRename,
}: {
  col?: ColumnConfig;
  children: React.ReactNode;
  className?: string;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLTableCellElement>) => void;
  onQuickHide?: (id: string) => void;
  onQuickRename?: (id: string, currentLabel: string) => void;
}) {
  const isMovable = !!(col && !col.isFrozen && draggable);

  return (
    <th
      draggable={isMovable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={isMovable ? "Kéo thả tiêu đề cột này để đổi vị trí trực tiếp trên bảng" : undefined}
      className={`group/th relative select-none transition-all ${
        isMovable ? "cursor-grab active:cursor-grabbing hover:brightness-105" : ""
      } ${
        isDragging
          ? "opacity-30 bg-amber-700/80 !border-dashed !border-amber-900"
          : isDragOver
          ? "bg-amber-300 ring-2 ring-indigo-600 shadow-md !border-l-4 !border-l-indigo-600 scale-[1.01]"
          : ""
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-1 w-full">
        {isMovable && (
          <span
            className="opacity-0 group-hover/th:opacity-60 text-slate-900/70 mr-1 text-[11px] font-mono shrink-0 select-none cursor-grab"
            title="Kéo cột"
          >
            ⠿
          </span>
        )}
        <div className="flex-1 min-w-0">{children}</div>
        {col && (
          <div className="hidden group-hover/th:flex items-center gap-0.5 ml-1 shrink-0">
            {onQuickRename && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickRename(col.id, col.label);
                }}
                className="p-0.5 rounded text-slate-900/60 hover:text-slate-950 hover:bg-black/10 transition cursor-pointer"
                title="Đổi tên cột"
              >
                <PencilSimpleIcon size={12} weight="bold" />
              </button>
            )}
            {!col.isFrozen && onQuickHide && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickHide(col.id);
                }}
                className="p-0.5 rounded text-slate-900/60 hover:text-red-900 hover:bg-black/10 transition cursor-pointer"
                title="Ẩn cột này khỏi bảng"
              >
                <EyeSlashIcon size={12} weight="bold" />
              </button>
            )}
          </div>
        )}
      </div>
    </th>
  );
}

interface ColumnManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  columns: ColumnConfig[];
  onSave: (columns: ColumnConfig[]) => void;
  onReset: () => void;
}

export function ColumnManagerModal({
  isOpen,
  onClose,
  title,
  columns,
  onSave,
  onReset,
}: ColumnManagerModalProps) {
  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(() => [...columns]);
  const [search, setSearch] = useState("");
  const [newColName, setNewColName] = useState("");
  const [newColType, setNewColType] = useState<"text" | "number" | "date">("text");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Keep in sync when modal opens or columns prop changes
  useEffect(() => {
    if (isOpen) {
      setLocalColumns([...columns]);
      setSearch("");
      setNewColName("");
      setEditingId(null);
      setDraggedId(null);
      setDragOverId(null);
    }
  }, [isOpen, columns]);

  const visibleCount = useMemo(
    () => localColumns.filter((c) => c.visible).length,
    [localColumns]
  );

  const movableCols = useMemo(
    () => localColumns.filter((c) => !c.isFrozen),
    [localColumns]
  );

  const filteredColumns = useMemo(() => {
    if (!search.trim()) return localColumns;
    const q = search.toLowerCase().trim();
    return localColumns.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.defaultLabel.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [localColumns, search]);

  if (!isOpen) return null;

  // Toggle visibility of a column
  const handleToggleVisible = (id: string) => {
    setLocalColumns((prev) =>
      prev.map((col) => {
        if (col.id === id) {
          if (col.isFrozen) return col; // Frozen columns shouldn't be hidden
          return { ...col, visible: !col.visible };
        }
        return col;
      })
    );
  };

  // Reorder movable columns via drag & drop
  const handleReorder = (fromId: string, toId: string) => {
    setLocalColumns((prev) => {
      const fromIndex = prev.findIndex((c) => c.id === fromId);
      const toIndex = prev.findIndex((c) => c.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      if (prev[fromIndex].isFrozen || prev[toIndex].isFrozen) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  // Move a column one slot up (before)
  const handleMoveUp = (id: string) => {
    setLocalColumns((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx <= 0 || prev[idx].isFrozen) return prev;
      if (prev[idx - 1].isFrozen) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(idx - 1, 0, moved);
      return next;
    });
  };

  // Move a column one slot down (after)
  const handleMoveDown = (id: string) => {
    setLocalColumns((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1 || idx >= prev.length - 1 || prev[idx].isFrozen) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(idx + 1, 0, moved);
      return next;
    });
  };

  // Show all columns
  const handleShowAll = () => {
    setLocalColumns((prev) => prev.map((c) => ({ ...c, visible: true })));
  };

  // Hide all non-frozen non-essential columns
  const handleShowEssential = () => {
    const essentials = [
      "stt", "product_type", "mockup", "sku", "brand", "asin", "fnsku",
      "quantity", "line_ship", "final_basecost", "status", "shipment_id"
    ];
    setLocalColumns((prev) =>
      prev.map((c) => ({
        ...c,
        visible: c.isFrozen || essentials.includes(c.id),
      }))
    );
  };

  // Reset to original defaults
  const handleResetToDefault = () => {
    if (confirm("Khôi phục toàn bộ cột, thứ tự và tên hiển thị về mặc định ban đầu?")) {
      onReset();
      onClose();
    }
  };

  // Start editing a column label
  const handleStartEdit = (col: ColumnConfig) => {
    setEditingId(col.id);
    setEditingLabel(col.label);
  };

  // Save renamed label
  const handleSaveEdit = (id: string) => {
    const trimmed = editingLabel.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    setLocalColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, label: trimmed } : c))
    );
    setEditingId(null);
  };

  // Restore column label to its original default
  const handleRestoreLabel = (id: string) => {
    setLocalColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, label: c.defaultLabel } : c))
    );
  };

  // Add new custom column
  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newColName.trim();
    if (!name) return;

    const newKey = `custom_${Date.now()}`;
    const newCol: ColumnConfig = {
      id: newKey,
      label: name,
      defaultLabel: name,
      visible: true,
      isCustom: true,
      type: newColType,
      align: newColType === "number" ? "right" : "left",
    };

    setLocalColumns((prev) => [...prev, newCol]);
    setNewColName("");
  };

  // Delete a custom column permanently
  const handleDeleteColumn = (id: string) => {
    if (confirm("Bạn có chắc chắn muốn xóa cột tùy chỉnh này khỏi bảng?")) {
      setLocalColumns((prev) => prev.filter((c) => c.id !== id));
    }
  };

  // Apply changes and close
  const handleApply = () => {
    onSave(localColumns);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="px-6 py-4 border-b border-slate-200 bg-linear-to-r from-amber-500 via-amber-600 to-orange-600 text-slate-950 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-slate-950 font-black shadow-inner">
              <SlidersHorizontalIcon size={22} weight="bold" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950 tracking-tight uppercase">
                {title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-900/70 hover:text-slate-950 hover:bg-white/20 transition cursor-pointer"
          >
            <XIcon size={20} weight="bold" />
          </button>
        </div>

        {/* TOP TOOLBAR: COUNTER & PRESETS */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Đang hiển thị:</span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
              {visibleCount} / {localColumns.length} cột
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={handleShowAll}
              className="px-2.5 py-1.5 rounded-lg font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition cursor-pointer"
            >
              Hiện tất cả
            </button>
            <button
              type="button"
              onClick={handleShowEssential}
              className="px-2.5 py-1.5 rounded-lg font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 transition cursor-pointer"
            >
              Thu gọn cơ bản
            </button>
            <button
              type="button"
              onClick={handleResetToDefault}
              className="px-2.5 py-1.5 rounded-lg font-bold bg-white hover:bg-red-50 text-red-700 border border-red-200 transition flex items-center gap-1 cursor-pointer"
              title="Khôi phục thứ tự và tên cột về trạng thái ban đầu của hệ thống"
            >
              <ArrowCounterClockwiseIcon size={14} weight="bold" />
              Khôi phục gốc
            </button>
          </div>
        </div>

        {/* SEARCH BAR & ADD NEW COLUMN FORM */}
        <div className="p-6 pb-2 space-y-3">
          {/* SEARCH INPUT */}
          <div className="relative">
            <MagnifyingGlassIcon
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm cột cần ẩn/hiện hoặc chỉnh sửa..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition"
            />
          </div>

          {/* ADD COLUMN FORM */}
          <form
            onSubmit={handleAddColumn}
            className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/80 flex flex-wrap items-center gap-2.5"
          >
            <span className="text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-1">
              <PlusIcon size={14} weight="bold" /> Thêm cột mới:
            </span>
            <input
              type="text"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="Nhập tên cột (vd: Link Canva, Ghi chú kho...)"
              className="flex-1 min-w-[200px] text-xs px-3 py-1.5 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
            />
            <select
              value={newColType}
              onChange={(e) => setNewColType(e.target.value as any)}
              className="text-xs px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-slate-700 outline-none"
            >
              <option value="text">Dạng chữ (Text)</option>
              <option value="number">Dạng số (Number)</option>
              <option value="date">Ngày tháng (Date)</option>
            </select>
            <button
              type="submit"
              disabled={!newColName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white transition cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <PlusIcon size={14} weight="bold" /> Thêm cột
            </button>
          </form>

          {/* DRAG-AND-DROP TIP */}
          <div className="flex items-center justify-between text-xs text-slate-600 bg-amber-50/80 border border-amber-200/80 px-3.5 py-2 rounded-xl">
            <div className="flex items-center gap-2">
              <DotsSixVerticalIcon size={16} weight="bold" className="text-amber-700 shrink-0" />
              <span className="font-semibold text-amber-950">
                Kéo thả biểu tượng <span className="font-mono bg-white px-1 py-0.5 rounded border border-amber-300">⠿</span> hoặc dùng nút <span className="font-bold">▲ ▼</span> để đổi thứ tự cột
              </span>
            </div>
            <span className="text-[11px] text-amber-800 font-medium">
              (4 cột đầu luôn cố định ở đầu bảng)
            </span>
          </div>

          {search.trim() && (
            <div className="text-[11px] text-slate-500 italic">
              * Đang tìm kiếm: Vui lòng xóa ô tìm kiếm nếu bạn muốn kéo thả sắp xếp thứ tự cột.
            </div>
          )}
        </div>

        {/* COLUMNS LIST (SCROLLABLE & REORDERABLE) */}
        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-2 max-h-[460px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredColumns.map((col) => {
              const isEditing = editingId === col.id;
              const isRenamed = col.label !== col.defaultLabel;
              const isBeingDragged = draggedId === col.id;
              const isDragTarget = dragOverId === col.id;

              const movableIndex = col.isFrozen
                ? -1
                : movableCols.findIndex((c) => c.id === col.id);
              const isFirstMovable = movableIndex === 0;
              const isLastMovable = movableIndex === movableCols.length - 1;

              return (
                <div
                  key={col.id}
                  draggable={!col.isFrozen && !isEditing && !search.trim()}
                  onDragStart={(e) => {
                    if (col.isFrozen || isEditing || search.trim()) return;
                    e.dataTransfer.setData("text/plain", col.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggedId(col.id);
                  }}
                  onDragOver={(e) => {
                    if (col.isFrozen || !draggedId || draggedId === col.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverId !== col.id) {
                      setDragOverId(col.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverId === col.id) {
                      setDragOverId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (col.isFrozen) return;
                    const sourceId = e.dataTransfer.getData("text/plain") || draggedId;
                    if (sourceId && sourceId !== col.id) {
                      handleReorder(sourceId, col.id);
                    }
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedId(null);
                    setDragOverId(null);
                  }}
                  className={`group/card flex items-center justify-between p-2.5 rounded-xl border transition-all select-none ${
                    isBeingDragged
                      ? "opacity-30 border-dashed border-amber-500 bg-amber-50 scale-[0.98]"
                      : isDragTarget
                      ? "border-2 border-amber-500 bg-amber-100/70 shadow-lg ring-2 ring-amber-400 scale-[1.02]"
                      : col.visible
                      ? "bg-white border-slate-200 hover:border-amber-400 hover:shadow-xs"
                      : "bg-slate-100/70 border-dashed border-slate-300 opacity-60 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    {/* DRAG HANDLE OR LOCK ICON */}
                    {col.isFrozen ? (
                      <div
                        className="p-1 text-slate-400 shrink-0 cursor-default"
                        title="Cột cố định - Luôn nằm ở đầu bảng"
                      >
                        <LockIcon size={14} weight="bold" />
                      </div>
                    ) : (
                      <div
                        className="p-1 text-slate-400 hover:text-amber-800 cursor-grab active:cursor-grabbing rounded hover:bg-amber-100 transition shrink-0"
                        title="Kéo thả để sắp xếp thứ tự cột"
                      >
                        <DotsSixVerticalIcon size={16} weight="bold" />
                      </div>
                    )}

                    {/* CHECKBOX / VISIBILITY TOGGLE */}
                    <input
                      type="checkbox"
                      id={`col-${col.id}`}
                      checked={col.visible}
                      disabled={col.isFrozen}
                      onChange={() => handleToggleVisible(col.id)}
                      className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer disabled:opacity-50 shrink-0"
                    />

                    {/* LABEL OR INLINE EDIT INPUT */}
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(col.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="flex-1 text-xs px-2 py-1 bg-amber-50 border border-amber-400 rounded outline-none font-bold text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(col.id)}
                          className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                          title="Lưu tên"
                        >
                          <CheckIcon size={12} weight="bold" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer"
                          title="Hủy"
                        >
                          <XIcon size={12} weight="bold" />
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor={`col-${col.id}`}
                        className={`text-xs font-semibold truncate cursor-pointer flex-1 select-none ${
                          col.visible ? "text-slate-800" : "text-slate-500 line-through"
                        }`}
                        title={col.label}
                      >
                        {col.label}
                        {isRenamed && (
                          <span className="ml-1 text-[10px] text-amber-700 font-normal italic">
                            (Gốc: {col.defaultLabel})
                          </span>
                        )}
                      </label>
                    )}

                    {/* BADGES */}
                    {col.isFrozen ? (
                      <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-bold rounded bg-slate-200 text-slate-700">
                        Cố định
                      </span>
                    ) : (
                      <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono font-bold rounded bg-amber-100 text-amber-900 border border-amber-200">
                        #{movableIndex + 1}
                      </span>
                    )}

                    {col.isCustom && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-black rounded bg-purple-100 text-purple-800 border border-purple-200">
                        Tùy chỉnh
                      </span>
                    )}
                  </div>

                  {/* ACTION BUTTONS: UP/DOWN, EDIT NAME, RESTORE NAME, HIDE, DELETE */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* QUICK MOVE UP / DOWN BUTTONS */}
                    {!col.isFrozen && (
                      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 mr-0.5">
                        <button
                          type="button"
                          disabled={isFirstMovable || !!search.trim()}
                          onClick={() => handleMoveUp(col.id)}
                          className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 disabled:opacity-25 transition cursor-pointer disabled:cursor-not-allowed"
                          title="Chuyển lên trước"
                        >
                          <CaretUpIcon size={12} weight="bold" />
                        </button>
                        <button
                          type="button"
                          disabled={isLastMovable || !!search.trim()}
                          onClick={() => handleMoveDown(col.id)}
                          className="p-1 rounded hover:bg-white text-slate-600 hover:text-slate-900 disabled:opacity-25 transition cursor-pointer disabled:cursor-not-allowed"
                          title="Chuyển xuống sau"
                        >
                          <CaretDownIcon size={12} weight="bold" />
                        </button>
                      </div>
                    )}

                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(col)}
                        className="p-1 rounded text-slate-400 hover:text-amber-800 hover:bg-amber-100 transition cursor-pointer"
                        title="Đổi tên hiển thị cột này"
                      >
                        <PencilSimpleIcon size={14} weight="bold" />
                      </button>
                    )}

                    {isRenamed && !isEditing && (
                      <button
                        type="button"
                        onClick={() => handleRestoreLabel(col.id)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                        title="Khôi phục tên gốc của cột"
                      >
                        <ArrowCounterClockwiseIcon size={12} weight="bold" />
                      </button>
                    )}

                    {!col.isFrozen && (
                      <button
                        type="button"
                        onClick={() => handleToggleVisible(col.id)}
                        className={`p-1 rounded transition cursor-pointer ${
                          col.visible
                            ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                            : "text-amber-600 hover:bg-amber-100"
                        }`}
                        title={col.visible ? "Ẩn cột này khỏi bảng" : "Hiện lại cột này"}
                      >
                        {col.visible ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />}
                      </button>
                    )}

                    {col.isCustom && (
                      <button
                        type="button"
                        onClick={() => handleDeleteColumn(col.id)}
                        className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-100 transition cursor-pointer"
                        title="Xóa vĩnh viễn cột tùy chỉnh này"
                      >
                        <TrashIcon size={14} weight="bold" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredColumns.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-400 font-medium">
              Không tìm thấy cột nào khớp với từ khóa &ldquo;{search}&rdquo;
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Cấu hình cột áp dụng đồng bộ cho tất cả các Store.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-200 transition cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition cursor-pointer shadow-sm flex items-center gap-1.5 font-black"
            >
              <CheckIcon size={16} weight="bold" /> Áp dụng cấu hình
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
