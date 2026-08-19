"use client";

import { useState, useEffect, useRef, type ChangeEvent } from "react";
import type { MockupContentItem, ProductCategoryPreset } from "../types/mockup-preset";
import {
  getAllPresets,
  fetchPresetsFromServer,
  syncPresetsToServer,
  saveStoredCustomPresets,
  createNewPreset,
  clonePreset,
  exportPresetsPayload,
  importPresetsPayload,
  parseChatGPTBatchInput,
  CHATGPT_PROMPT_TEMPLATE,
  MATERIAL_STARTERS,
  SYSTEM_PRESETS,
} from "../lib/mockup-preset-store";
import {
  XIcon,
  PlusIcon,
  CopyIcon,
  TrashIcon,
  PencilIcon,
  DownloadSimpleIcon,
  UploadSimpleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  SparkleIcon,
  LightningIcon,
} from "@phosphor-icons/react";

interface ProductPresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCategoryId: string;
  onSelectCategory: (categoryId: string, contents: MockupContentItem[]) => void;
  onPresetsUpdated: () => void;
}

export function ProductPresetModal({
  isOpen,
  onClose,
  activeCategoryId,
  onSelectCategory,
  onPresetsUpdated,
}: ProductPresetModalProps) {
  const [presets, setPresets] = useState<ProductCategoryPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string>(activeCategoryId);
  const [notice, setNotice] = useState<string>("");
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [batchInputText, setBatchInputText] = useState<string>("");

  // Edit category modal state
  const [editingCategory, setEditingCategory] = useState<ProductCategoryPreset | null>(null);
  const [editLabel, setEditLabel] = useState<string>("");
  const [editIcon, setEditIcon] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      void fetchPresetsFromServer().then((loaded) => {
        setPresets(loaded);
        const exists = loaded.some((p) => p.id === activeCategoryId);
        setSelectedId(exists ? activeCategoryId : loaded[0]?.id || "universal_standard");
        setNotice("");
      });
    }
  }, [isOpen, activeCategoryId]);

  if (!isOpen) return null;

  const currentPreset = presets.find((p) => p.id === selectedId) || presets[0];

  const handleSaveAll = (updatedPresets: ProductCategoryPreset[]) => {
    setPresets(updatedPresets);
    void syncPresetsToServer(updatedPresets).then((synced) => {
      setPresets(synced);
      onPresetsUpdated();
    });
  };

  const handleSelectPreset = (p: ProductCategoryPreset) => {
    setSelectedId(p.id);
    onSelectCategory(p.id, p.contents);
    setNotice(`Đã chuyển sang xem mẫu "${p.label}".`);
  };

  const handleCreateNewCategory = () => {
    const newP = createNewPreset("Sản phẩm mới", "📦");
    const updated = [...presets, newP];
    handleSaveAll(updated);
    setSelectedId(newP.id);
    onSelectCategory(newP.id, newP.contents);
    setNotice("🎉 Đã tạo mẫu sản phẩm mới. Dán nội dung từ ChatGPT vào mục '⚡ Thêm Hàng Loạt' để tự động nạp!");
  };

  const handleCloneCategory = (p: ProductCategoryPreset) => {
    const cloned = clonePreset(p);
    const updated = [...presets, cloned];
    handleSaveAll(updated);
    setSelectedId(cloned.id);
    onSelectCategory(cloned.id, cloned.contents);
    setNotice(`📋 Đã nhân bản từ "${p.label}" thành "${cloned.label}".`);
  };

  const handleDeleteCategory = (p: ProductCategoryPreset) => {
    if (p.isSystem) {
      setNotice("Mẫu mặc định hệ thống không thể xóa.");
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn xóa mẫu sản phẩm "${p.label}"?`)) return;
    const updated = presets.filter((item) => item.id !== p.id);
    handleSaveAll(updated);
    const nextId = updated[0]?.id || "universal_standard";
    setSelectedId(nextId);
    const nextP = updated[0] || presets[0];
    if (nextP) onSelectCategory(nextP.id, nextP.contents);
    setNotice(`🗑️ Đã xóa mẫu "${p.label}".`);
  };

  const handleStartEditCategory = (p: ProductCategoryPreset) => {
    setEditingCategory(p);
    setEditLabel(p.label);
    setEditIcon(p.icon || "📦");
  };

  const handleSaveCategoryMeta = () => {
    if (!editingCategory || !editLabel.trim()) return;
    const updated = presets.map((p) =>
      p.id === editingCategory.id
        ? { ...p, label: editLabel.trim(), icon: editIcon.trim() || "📦" }
        : p,
    );
    handleSaveAll(updated);
    setEditingCategory(null);
    setNotice("Đã cập nhật tên & icon loại sản phẩm.");
  };

  // Content manipulation handlers for active currentPreset
  const updateCurrentPresetContents = (newContents: MockupContentItem[]) => {
    if (!currentPreset) return;
    const updated = presets.map((p) =>
      p.id === currentPreset.id ? { ...p, contents: newContents } : p,
    );
    handleSaveAll(updated);
    onSelectCategory(currentPreset.id, newContents);
  };

  const handleToggleCheck = (id: number) => {
    if (id === 1) return;
    const updated = currentPreset.contents.map((c) =>
      c.id === id ? { ...c, checked: !c.checked } : c,
    );
    updateCurrentPresetContents(updated);
  };

  const handleUpdateContentLabel = (id: number, label: string) => {
    const updated = currentPreset.contents.map((c) => (c.id === id ? { ...c, label } : c));
    updateCurrentPresetContents(updated);
  };

  const handleUpdateCustomPrompt = (id: number, customPrompt: string) => {
    const updated = currentPreset.contents.map((c) =>
      c.id === id ? { ...c, customPrompt } : c,
    );
    updateCurrentPresetContents(updated);
  };

  const handleAddSingleContent = () => {
    const nextId =
      currentPreset.contents.length > 0
        ? Math.max(...currentPreset.contents.map((c) => c.id)) + 1
        : 1;
    const newContent: MockupContentItem = {
      id: nextId,
      label: `Content ${nextId}: Tên bối cảnh mới`,
      checked: true,
    };
    const updated = [...currentPreset.contents, newContent];
    updateCurrentPresetContents(updated);
    setNotice("Đã thêm 1 Content mới.");
  };

  const handleBatchAddContents = () => {
    if (!batchInputText.trim()) return;

    const parsed = parseChatGPTBatchInput(batchInputText, 1);

    if (parsed.items.length === 0) return;

    if (parsed.categoryMeta?.label && !currentPreset.isSystem) {
      const updatedMetaPresets = presets.map((p) =>
        p.id === currentPreset.id
          ? {
              ...p,
              label: parsed.categoryMeta?.label || p.label,
              icon: parsed.categoryMeta?.icon || p.icon,
            }
          : p,
      );
      setPresets(updatedMetaPresets);
    }

    const isFullSet = parsed.items.some((item) => item.id === 1) || Boolean(parsed.categoryMeta?.label);

    const updated = isFullSet
      ? parsed.items
      : [...currentPreset.contents, ...parsed.items];

    updateCurrentPresetContents(updated);
    setBatchInputText("");
    setBatchModalOpen(false);
    setNotice(
      isFullSet
        ? `⚡ Đã cập nhật lại trọn bộ ${parsed.items.length} Content mới từ ChatGPT!`
        : `⚡ Đã tự động phân tích và thêm ${parsed.items.length} Content mới từ ChatGPT!`,
    );
  };

  const handleCopyChatGPTTemplate = () => {
    void navigator.clipboard.writeText(CHATGPT_PROMPT_TEMPLATE);
    setNotice("📋 Đã sao chép Prompt mẫu gửi ChatGPT vào bộ nhớ tạm (Clipboard)!");
  };

  const handleDeleteContent = (id: number) => {
    if (id === 1) {
      setNotice("Content 1 (Full Design) là bắt buộc, không thể xóa.");
      return;
    }
    const updated = currentPreset.contents.filter((c) => c.id !== id);
    updateCurrentPresetContents(updated);
    setNotice("Đã xóa Content.");
  };

  const handleMoveContent = (id: number, direction: "up" | "down") => {
    const index = currentPreset.contents.findIndex((c) => c.id === id);
    if (index < 0) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === currentPreset.contents.length - 1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const updated = [...currentPreset.contents];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    updateCurrentPresetContents(updated);
  };

  const handleResetCurrentPreset = () => {
    const sys = SYSTEM_PRESETS.find((s) => s.id === currentPreset.id);
    if (sys) {
      updateCurrentPresetContents(sys.contents);
      setNotice(`Đã khôi phục Content mặc định cho "${sys.label}".`);
    } else {
      setNotice("Sản phẩm tự thêm không có mẫu gốc hệ thống để reset.");
    }
  };

  // Export & Import JSON
  const handleExportJSON = () => {
    const payload = exportPresetsPayload(presets);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Product_Presets_ListingDesk_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("📥 Đã xuất trọn bộ file JSON Mẫu Sản Phẩm & Content.");
  };

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonText = event.target?.result as string;
        const imported = importPresetsPayload(jsonText);
        handleSaveAll(imported);
        if (imported.length > 0) {
          setSelectedId(imported[0].id);
          onSelectCategory(imported[0].id, imported[0].contents);
        }
        setNotice(`📤 Đã nhập thành công ${imported.length} mẫu sản phẩm từ file JSON.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setNotice(`❌ Lỗi nhập file JSON: ${msg}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleApplyAndClose = () => {
    if (currentPreset) {
      onSelectCategory(currentPreset.id, currentPreset.contents);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 sm:p-5 backdrop-blur-sm font-sans">
      <div className="relative flex h-[92vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 shadow-2xs border border-amber-200">
              <SparkleIcon className="h-5 w-5" weight="fill" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                Product Preset Studio — Quản Lý Loại Sản Phẩm & Content
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Tạo loại sản phẩm mới, chỉnh sửa Content & Prompt AI, nhân bản hoặc Export/Import file JSON dùng chung cho cả team Designer.
              </p>
            </div>
          </div>
          <button
            onClick={handleApplyAndClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition shadow-2xs"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Notice Bar */}
        {notice && (
          <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-2 text-xs font-extrabold text-emerald-800 flex items-center justify-between animate-fade-in shrink-0">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="text-emerald-600 hover:text-emerald-900">
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main 2-Column Studio Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT SIDEBAR: Categories List & Preset Actions */}
          <div className="w-80 shrink-0 border-r border-slate-100 bg-slate-50/50 flex flex-col justify-between p-4 overflow-y-auto space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Loại Sản Phẩm ({presets.length})
                </span>
                <button
                  onClick={handleCreateNewCategory}
                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white shadow-2xs hover:bg-indigo-700 transition"
                  title="Thêm loại sản phẩm mới"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  <span>Tạo Mới</span>
                </button>
              </div>

              {/* Presets List */}
              <div className="space-y-2">
                {presets.map((p) => {
                  const isSelected = p.id === selectedId;
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleSelectPreset(p)}
                      className={`group relative flex items-center justify-between rounded-2xl p-3 border transition cursor-pointer ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50/70 shadow-xs ring-2 ring-indigo-400/20"
                          : "border-slate-200/80 bg-white hover:border-indigo-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl shrink-0">{p.icon || "📦"}</span>
                        <div className="min-w-0">
                          <h4 className="text-xs font-extrabold text-slate-900 truncate">
                            {p.label}
                          </h4>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {p.contents.length} Content • {p.isSystem ? "Hệ thống" : "Tự tạo"}
                          </span>
                        </div>
                      </div>

                      {/* Item Quick Actions */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEditCategory(p);
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-800 transition"
                          title="Sửa tên / Icon"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloneCategory(p);
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-indigo-600 transition"
                          title="Nhân bản mẫu này"
                        >
                          <CopyIcon className="h-3.5 w-3.5" />
                        </button>
                        {!p.isSystem && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategory(p);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:bg-red-100 hover:text-red-600 transition"
                            title="Xóa mẫu này"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Export / Import Bar */}
            <div className="pt-3 border-t border-slate-200/80 space-y-2 shrink-0">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Chia sẻ cho Team Designer
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <DownloadSimpleIcon className="h-4 w-4 text-indigo-600" />
                  <span>Xuất JSON</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-100 transition"
                >
                  <UploadSimpleIcon className="h-4 w-4 text-emerald-600" />
                  <span>Nhập JSON</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFileChange}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* RIGHT PANEL: Active Category Content List Editor */}
          {currentPreset && (
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              {/* Active Category Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3.5 bg-slate-50/30 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-2xl">{currentPreset.icon}</span>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 truncate">
                      {currentPreset.label}
                    </h3>
                    <span className="text-xs text-slate-500 font-semibold">
                      Chỉnh sửa danh sách Content ({currentPreset.contents.length} mục)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBatchAddContents}
                    onClickCapture={() => setBatchModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-extrabold text-amber-800 shadow-2xs hover:bg-amber-100 transition"
                  >
                    <LightningIcon className="h-4 w-4 text-amber-600" weight="fill" />
                    <span>Thêm Hàng Loạt</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAddSingleContent}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-2xs hover:bg-indigo-700 transition"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span>Thêm 1 Content</span>
                  </button>

                  {currentPreset.isSystem && (
                    <button
                      type="button"
                      onClick={handleResetCurrentPreset}
                      className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                      title="Khôi phục Content mặc định hệ thống"
                    >
                      <ArrowsClockwiseIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Content List Table / Editor */}
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                {currentPreset.contents.map((item, index) => {
                  const isFirst = item.id === 1;
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col gap-2 rounded-2xl border p-4 shadow-2xs transition ${
                        item.checked
                          ? "border-slate-200 bg-white"
                          : "border-slate-200/60 bg-slate-50/50 opacity-65"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={item.checked}
                            disabled={isFirst}
                            onChange={() => handleToggleCheck(item.id)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                          />

                          {/* ID Badge */}
                          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-mono font-bold text-slate-700 shrink-0">
                            #{item.id}
                          </span>

                          {/* Content Label Input */}
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) => handleUpdateContentLabel(item.id, e.target.value)}
                            placeholder="Nhập tên Content hiển thị..."
                            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500 focus:bg-white transition"
                          />
                        </div>

                        {/* Order & Delete Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveContent(item.id, "up")}
                            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 transition"
                            title="Lên trên"
                          >
                            <ArrowUpIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === currentPreset.contents.length - 1}
                            onClick={() => handleMoveContent(item.id, "down")}
                            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 transition"
                            title="Xuống dưới"
                          >
                            <ArrowDownIcon className="h-4 w-4" />
                          </button>
                          {!isFirst && (
                            <button
                              type="button"
                              onClick={() => handleDeleteContent(item.id)}
                              className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                              title="Xóa Content"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Custom Prompt Override Textarea */}
                      <div className="pl-11 pr-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 flex items-center gap-1">
                            <span>🤖 Mô tả Bối Cảnh AI (Click để sửa Prompt):</span>
                          </span>
                          {item.customPrompt && (
                            <span className="text-[10px] font-medium text-slate-400">
                              {item.customPrompt.length} ký tự
                            </span>
                          )}
                        </div>
                        <textarea
                          rows={item.customPrompt && item.customPrompt.length > 80 ? 3 : 2}
                          value={item.customPrompt || ""}
                          onChange={(e) => handleUpdateCustomPrompt(item.id, e.target.value)}
                          placeholder="Nhập mô tả bối cảnh AI tùy chỉnh (Ví dụ: Hero main product photography on pure white background #FFFFFF...)"
                          className="w-full rounded-xl border border-indigo-200/80 bg-indigo-50/30 px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 transition placeholder:text-slate-400 placeholder:font-sans leading-relaxed resize-y"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Apply & Save Notice */}
              <div className="border-t border-slate-100 px-6 py-3 bg-slate-50/50 flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-slate-500">
                  Tất cả thay đổi được tự động lưu và đồng bộ cho cả team.
                </span>
                <button
                  type="button"
                  onClick={handleApplyAndClose}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition cursor-pointer"
                >
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>Hoàn Tất & Áp Dụng</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Category Meta Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <h4 className="text-sm font-black text-slate-900">
              Đổi Tên & Icon Loại Sản Phẩm
            </h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Biểu Tượng Emoji Icon
                </label>
                <input
                  type="text"
                  value={editIcon}
                  onChange={(e) => setEditIcon(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base outline-none focus:border-indigo-500"
                  placeholder="📦"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Tên Loại Sản Phẩm
                </label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
                  placeholder="Nhập tên sản phẩm..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingCategory(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveCategoryMeta}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
              >
                Lưu Thay Đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Add Contents Modal */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900">
                Thêm Hàng Loạt Content Cho "{currentPreset?.label}"
              </h4>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-b border-slate-100 pb-3">
              <p className="text-xs text-slate-500 font-medium">
                Dán kết quả phân tích từ ChatGPT hoặc gõ danh sách Content (mỗi Content 1 dòng).
              </p>
              <button
                type="button"
                onClick={handleCopyChatGPTTemplate}
                className="flex items-center gap-1.5 shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-2xs hover:bg-indigo-100 transition"
                title="Sao chép Prompt mẫu câu lệnh để gửi cho ChatGPT soi sản phẩm"
              >
                <CopyIcon className="h-4 w-4 text-indigo-600" />
                <span>Copy Prompt ChatGPT</span>
              </button>
            </div>

            <textarea
              rows={8}
              value={batchInputText}
              onChange={(e) => setBatchInputText(e.target.value)}
              placeholder={`Loại Sản Phẩm: 🍺 Beer Mug\nContent 1 | Ảnh 1: Nền Trắng CTR | Hero product photography on white background\nContent 2 | Ảnh 2: Quán Pub Gia Đình | Cozy indoor wood pub table with warm ambient lights\nContent 3 | Ảnh 3: Kích Thước 16oz | 16oz capacity 3D size infographic`}
              className="w-full rounded-xl border border-slate-200 p-3 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleBatchAddContents}
                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 shadow-2xs"
              >
                Tự Động Phân Tích & Thêm Ngay
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
