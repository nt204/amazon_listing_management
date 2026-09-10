"use client";

import { useEffect, useRef, useState } from "react";
import {
  XIcon,
  SparkleIcon,
  DownloadSimpleIcon,
  SpinnerIcon,
  CheckCircleIcon,
  UploadSimpleIcon,
  EyeIcon,
  ImageSquareIcon,
  WarningCircleIcon,
  PlusIcon,
  TrashIcon,
  GearIcon,
  CheckSquareIcon,
  SquareIcon,
  TagIcon,
  ArrowRightIcon,
  FloppyDiskIcon,
} from "@phosphor-icons/react";
import {
  ALL_BUILTIN_TEMPLATES,
  BOX_MOCKUP_TEMPLATES,
  type ProductTemplateSpec,
} from "@/lib/template-mockup-types";

export interface BoxMockupTrelloSource {
  cardId: string;
  cardName: string;
  sku?: string;
  attachmentId: string;
  attachmentName: string;
  attachmentUrl: string;
}

interface BoxMockupTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  trelloSource?: BoxMockupTrelloSource;
  automaticSourceNotice?: string;
  onAttachmentUploaded?: () => void;
  initialTab?: "generate" | "manage";
}

export interface GeneratedMockupResult {
  templateId: string;
  name: string;
  badge: string;
  width: number;
  height: number;
  dataUrl: string;
  providerUsed: string;
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Không thể đọc dữ liệu ảnh."));
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Không thể đọc dữ liệu ảnh."));
    reader.readAsDataURL(blob);
  });
}

export function BoxMockupTemplateModal({
  isOpen,
  onClose,
  trelloSource,
  automaticSourceNotice,
  onAttachmentUploaded,
  initialTab = "generate",
}: BoxMockupTemplateModalProps) {
  const [activeTab, setActiveTab] = useState<"generate" | "manage">(initialTab);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const [categoryFilter, setCategoryFilter] = useState<string>("box");
  const [customTemplates, setCustomTemplates] = useState<ProductTemplateSpec[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState<boolean>(false);

  // Source design state
  const [designDataUrl, setDesignDataUrl] = useState<string>("");
  const [designSourceKind, setDesignSourceKind] = useState<"trello" | "manual" | null>(null);
  const [designSourceLabel, setDesignSourceLabel] = useState<string>("");
  const [sourceLoadingKind, setSourceLoadingKind] = useState<"trello" | "manual" | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // Selected templates for generation
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    BOX_MOCKUP_TEMPLATES.map((t) => t.id),
  );

  // Generation state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedMockupResult[]>([]);
  const [previewImage, setPreviewImage] = useState<GeneratedMockupResult | null>(null);
  const [uploadingToTrello, setUploadingToTrello] = useState<boolean>(false);
  const [trelloUploadSuccess, setTrelloUploadSuccess] = useState<string | null>(null);

  // New custom template form state
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateCategory, setNewTemplateCategory] = useState("box");
  const [newTemplateBadge, setNewTemplateBadge] = useState("Ảnh Phụ");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [newTemplatePrompt, setNewTemplatePrompt] = useState("");
  const [newTemplateAccessories, setNewTemplateAccessories] = useState<string[]>([]);
  const [accessoryInput, setAccessoryInput] = useState("");
  const [newTemplateDataUrl, setNewTemplateDataUrl] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [templateFormSuccess, setTemplateFormSuccess] = useState<string | null>(null);

  const designSourceVersionRef = useRef(0);
  const generationVersionRef = useRef(0);

  const handleAddAccessory = () => {
    const trimmed = accessoryInput.trim();
    if (trimmed && !newTemplateAccessories.includes(trimmed)) {
      setNewTemplateAccessories((prev) => [...prev, trimmed]);
      setAccessoryInput("");
    }
  };

  const handleRemoveAccessory = (index: number) => {
    setNewTemplateAccessories((prev) => prev.filter((_, i) => i !== index));
  };

  // Fetch templates from API
  const refreshTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/template-mockup/templates");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.templates)) {
          const customs = data.templates.filter((t: ProductTemplateSpec) => t.isCustom);
          setCustomTemplates(customs);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshTemplates();
    }
  }, [isOpen]);

  // Load trello source when modal opens or trelloSource changes
  useEffect(() => {
    if (!isOpen) return;
    if (!trelloSource?.attachmentUrl) {
      if (designSourceKind !== "manual") {
        setDesignDataUrl("");
        setDesignSourceKind(null);
        setDesignSourceLabel("");
      }
      return;
    }

    const currentVersion = designSourceVersionRef.current + 1;
    designSourceVersionRef.current = currentVersion;
    setSourceLoadingKind("trello");
    setSourceError(null);

    const controller = new AbortController();
    fetch(
      `/api/trello/download-image?url=${encodeURIComponent(trelloSource.attachmentUrl)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Không thể tải ảnh gốc từ Trello.");
        }
        return res.blob();
      })
      .then((blob) => readBlobAsDataUrl(blob))
      .then((dataUrl) => {
        if (currentVersion !== designSourceVersionRef.current) return;
        setDesignDataUrl(dataUrl);
        setDesignSourceKind("trello");
        setDesignSourceLabel(
          trelloSource.sku
            ? `${trelloSource.sku} • ${trelloSource.attachmentName}`
            : trelloSource.attachmentName,
        );
        setSourceLoadingKind(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (currentVersion !== designSourceVersionRef.current) return;
        setSourceError(err instanceof Error ? err.message : "Lỗi khi tải ảnh.");
        setSourceLoadingKind(null);
      });

    return () => {
      controller.abort();
    };
  }, [isOpen, trelloSource]);

  const handleManualUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSourceLoadingKind("manual");
    setSourceError(null);
    try {
      const dataUrl = await readBlobAsDataUrl(file);
      setDesignDataUrl(dataUrl);
      setDesignSourceKind("manual");
      setDesignSourceLabel(file.name);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "Không thể đọc file ảnh.");
    } finally {
      setSourceLoadingKind(null);
    }
  };

  const handleTemplateBaseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readBlobAsDataUrl(file);
      setNewTemplateDataUrl(dataUrl);
      if (!newTemplateName) {
        setNewTemplateName(file.name.replace(/\.[^/.]+$/, ""));
      }
    } catch {
      setTemplateFormError("Không thể đọc file ảnh phôi.");
    }
  };

  const handleSaveCustomTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) {
      setTemplateFormError("Vui lòng nhập tên phôi.");
      return;
    }
    if (!newTemplateDataUrl) {
      setTemplateFormError("Vui lòng tải lên ảnh phôi mẫu.");
      return;
    }

    setSavingTemplate(true);
    setTemplateFormError(null);
    setTemplateFormSuccess(null);

    try {
      const res = await fetch("/api/template-mockup/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: newTemplateCategory,
          name: newTemplateName.trim(),
          badge: newTemplateBadge.trim() || "Custom",
          description: newTemplateDescription.trim(),
          promptInstruction: newTemplatePrompt.trim(),
          accessories: newTemplateAccessories,
          imageData: newTemplateDataUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể lưu phôi template.");
      }

      setTemplateFormSuccess("Đã lưu phôi template thành công!");
      setNewTemplateName("");
      setNewTemplateDescription("");
      setNewTemplatePrompt("");
      setNewTemplateAccessories([]);
      setAccessoryInput("");
      setNewTemplateDataUrl("");
      await refreshTemplates();
    } catch (err) {
      setTemplateFormError(err instanceof Error ? err.message : "Lỗi khi lưu.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteCustomTemplate = async (id: string) => {
    if (!confirm("Bạn có chắc muốn xóa phôi template này?")) return;
    try {
      const res = await fetch(`/api/template-mockup/templates?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedIds((prev) => prev.filter((item) => item !== id));
        await refreshTemplates();
      }
    } catch {
      alert("Không thể xóa template.");
    }
  };

  const allAvailableTemplates: ProductTemplateSpec[] = [
    ...ALL_BUILTIN_TEMPLATES,
    ...customTemplates,
  ];

  const filteredTemplates = allAvailableTemplates.filter((t) => {
    if (categoryFilter === "all") return true;
    if (categoryFilter === "custom") return t.isCustom;
    return t.category === categoryFilter;
  });

  const toggleSelectTemplate = (id: string) => {
    if (loading) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAllFiltered = () => {
    if (loading) return;
    const currentIds = new Set(selectedIds);
    filteredTemplates.forEach((t) => currentIds.add(t.id));
    setSelectedIds(Array.from(currentIds));
  };

  const deselectAllFiltered = () => {
    if (loading) return;
    const toRemove = new Set(filteredTemplates.map((t) => t.id));
    setSelectedIds((prev) => prev.filter((id) => !toRemove.has(id)));
  };

  const handleGenerate = async () => {
    if (!designDataUrl) {
      setError("Vui lòng tải lên hoặc chọn ảnh thiết kế nguồn.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Vui lòng chọn ít nhất 1 góc phôi template.");
      return;
    }

    setLoading(true);
    setError(null);
    setTrelloUploadSuccess(null);
    const version = generationVersionRef.current + 1;
    generationVersionRef.current = version;

    try {
      const res = await fetch("/api/template-mockup/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designDataUrl,
          selectedTemplateIds: selectedIds,
          customTemplates,
          mode: "ai",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tạo mockup từ AI.");
      }

      if (version === generationVersionRef.current) {
        setResults(data.mockups || []);
      }
    } catch (err) {
      if (version === generationVersionRef.current) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo mockup.");
      }
    } finally {
      if (version === generationVersionRef.current) {
        setLoading(false);
      }
    }
  };

  const handleDownloadSingle = (mockup: GeneratedMockupResult) => {
    const a = document.createElement("a");
    a.href = mockup.dataUrl;
    a.download = `Mockup_${mockup.badge}_${mockup.templateId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadAll = () => {
    results.forEach((mockup, idx) => {
      setTimeout(() => {
        handleDownloadSingle(mockup);
      }, idx * 300);
    });
  };

  const handleUploadAllToTrello = async () => {
    if (!trelloSource?.cardId || results.length === 0) return;
    setUploadingToTrello(true);
    setTrelloUploadSuccess(null);

    let successCount = 0;
    try {
      for (const mockup of results) {
        const byteMatch = mockup.dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
        if (!byteMatch || !byteMatch[1]) continue;

        const res = await fetch("/api/trello/process-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload-attachment",
            cardId: trelloSource.cardId,
            filename: `Mockup_${mockup.badge}_${mockup.templateId}.png`,
            base64Data: byteMatch[1],
            mimeType: "image/png",
          }),
        });

        if (res.ok) {
          successCount++;
        }
      }

      setTrelloUploadSuccess(`Đã đẩy thành công ${successCount}/${results.length} ảnh vào thẻ Trello!`);
      if (onAttachmentUploaded) onAttachmentUploaded();
    } catch {
      alert("Lỗi khi đẩy ảnh lên Trello.");
    } finally {
      setUploadingToTrello(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <SparkleIcon size={22} weight="fill" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">
                  Tạo Mockup Hộp & Quản Lý Phôi (Multi-Image AI)
                </h2>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/30">
                  CheapKeyAI GPT-Image-2
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Gửi đồng thời ảnh phôi góc chụp + ảnh thiết kế để tạo bộ ảnh chính & ảnh phụ chuẩn nét 2000x2000
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs */}
            <div className="flex rounded-lg bg-zinc-800 p-1 border border-zinc-700">
              <button
                type="button"
                onClick={() => setActiveTab("generate")}
                className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs transition-all cursor-pointer ${activeTab === "generate"
                    ? "bg-amber-500 text-zinc-950 shadow font-extrabold"
                    : "text-zinc-300 hover:text-white font-medium hover:bg-zinc-700/50"
                  }`}
              >
                <SparkleIcon size={15} weight="bold" />
                ✨ Tạo Mockup Từ Phôi
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("manage")}
                className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs transition-all cursor-pointer ${activeTab === "manage"
                    ? "bg-amber-500 text-zinc-950 shadow font-extrabold"
                    : "text-zinc-300 hover:text-white font-medium hover:bg-zinc-700/50"
                  }`}
              >
                <PlusIcon size={15} weight="bold" />
                ➕ Thêm Phôi &amp; Quản Lý ({customTemplates.length})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <XIcon size={20} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "generate" ? (
            <>
              {/* Top Row: Design Artwork & Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Design Artwork Source */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <ImageSquareIcon size={16} className="text-amber-400" />
                      1. Ảnh Thiết Kế (Artwork)
                    </span>
                    {designSourceKind === "trello" && (
                      <span className="text-[10px] rounded bg-blue-500/20 px-1.5 py-0.5 font-medium text-blue-400 border border-blue-500/30">
                        Từ Trello Card
                      </span>
                    )}
                  </div>

                  {sourceLoadingKind ? (
                    <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50">
                      <SpinnerIcon size={24} className="animate-spin text-amber-400" />
                      <span className="text-xs text-zinc-400">Đang tải ảnh thiết kế...</span>
                    </div>
                  ) : designDataUrl ? (
                    <div className="space-y-2">
                      <div className="relative group h-36 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 flex items-center justify-center p-2">
                        <img
                          src={designDataUrl}
                          alt="Design Source"
                          className="max-h-full max-w-full object-contain rounded"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span className="truncate max-w-[180px]" title={designSourceLabel}>
                          {designSourceLabel || "Ảnh thiết kế"}
                        </span>
                        <label className="cursor-pointer font-medium text-amber-400 hover:text-amber-300">
                          Đổi ảnh khác
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleManualUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <label className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-zinc-800/50 transition-all text-center p-4">
                      <UploadSimpleIcon size={28} className="text-zinc-400" />
                      <span className="text-xs font-medium text-zinc-300">
                        Tải lên file thiết kế (PNG, JPG, WebP)
                      </span>
                      <span className="text-[11px] text-zinc-500">Hoặc kéo thả file vào đây</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleManualUpload}
                        className="hidden"
                      />
                    </label>
                  )}

                  {sourceError && (
                    <div className="text-xs text-red-400 flex items-center gap-1.5">
                      <WarningCircleIcon size={14} />
                      {sourceError}
                    </div>
                  )}
                  {automaticSourceNotice && (
                    <p className="text-[11px] text-zinc-500 italic">{automaticSourceNotice}</p>
                  )}
                </div>

                {/* 2. Generation Summary & Action Button */}
                <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <TagIcon size={16} className="text-amber-400" />
                        2. Bộ Mockup Sẽ Tạo
                      </span>
                      <span className="text-xs text-zinc-400">
                        Đã chọn <strong className="text-amber-400">{selectedIds.length}</strong> góc phôi
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      AI sẽ gửi đồng thời ảnh phôi góc chụp thực tế + ảnh thiết kế của bạn tới CheapKeyAI (GPT-Image-2). Thiết kế sẽ được bọc chính xác lên mặt nắp và thân hộp, bảo toàn trọn vẹn bóng đổ và bối cảnh.
                    </p>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400 flex items-start gap-2">
                      <WarningCircleIcon size={16} className="mt-0.5 shrink-0" />
                      <div>{error}</div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      disabled={loading || !designDataUrl || selectedIds.length === 0}
                      onClick={handleGenerate}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {loading ? (
                        <>
                          <SpinnerIcon size={18} className="animate-spin text-zinc-950" />
                          <span>Đang Tạo {selectedIds.length} Mockup Bằng AI...</span>
                        </>
                      ) : (
                        <>
                          <SparkleIcon size={18} weight="fill" />
                          <span>Tạo {selectedIds.length} Mockup Đồng Bộ Ngay</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Template Selection Grid */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-zinc-300">Danh Mục Phôi:</span>
                    <div className="flex rounded-lg bg-zinc-800/80 p-0.5 border border-zinc-700 text-xs">
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("box")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-all ${categoryFilter === "box" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                          }`}
                      >
                        📦 Hộp Quà (Box)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("custom")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-all ${categoryFilter === "custom" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                          }`}
                      >
                        ⭐ Phôi Tự Thêm ({customTemplates.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("glass-ornament")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-all ${categoryFilter === "glass-ornament" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                          }`}
                      >
                        🔮 Glass Ornament
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("all")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-all ${categoryFilter === "all" ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                          }`}
                      >
                        Tất Cả ({allAvailableTemplates.length})
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={selectAllFiltered}
                      className="text-amber-400 hover:text-amber-300 font-medium"
                    >
                      Chọn tất cả ({filteredTemplates.length})
                    </button>
                    <span className="text-zinc-600">•</span>
                    <button
                      type="button"
                      onClick={deselectAllFiltered}
                      className="text-zinc-400 hover:text-zinc-300 font-medium"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-4">
                  {filteredTemplates.map((template) => {
                    const isSelected = selectedIds.includes(template.id);
                    const imageSrc =
                      template.templateDataUrl ||
                      (template.templateAssetPath ? `/${template.templateAssetPath.replace(/^public\//, "")}` : "");

                    return (
                      <div
                        key={template.id}
                        onClick={() => toggleSelectTemplate(template.id)}
                        className={`group relative cursor-pointer rounded-xl border p-2.5 transition-all flex flex-col justify-between ${isSelected
                            ? "border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10"
                            : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/50"
                          }`}
                      >
                        {/* Checkbox Icon */}
                        <div className="absolute top-4 left-4 z-10">
                          {isSelected ? (
                            <CheckSquareIcon size={20} weight="fill" className="text-amber-400 bg-zinc-900 rounded" />
                          ) : (
                            <SquareIcon size={20} className="text-zinc-400 group-hover:text-zinc-200 bg-zinc-900/60 rounded" />
                          )}
                        </div>

                        {/* Badge */}
                        <div className="absolute top-4 right-4 z-10">
                          <span className="rounded-md bg-zinc-900/90 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30 backdrop-blur-sm">
                            {template.badge}
                          </span>
                        </div>

                        {/* Image Preview */}
                        <div className="aspect-square w-full overflow-hidden rounded-lg bg-zinc-950 flex items-center justify-center mb-2.5">
                          {imageSrc ? (
                            <img
                              src={imageSrc}
                              alt={template.name}
                              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <ImageSquareIcon size={36} className="text-zinc-600" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-white line-clamp-1 group-hover:text-amber-400 transition-colors">
                            {template.name}
                          </h4>
                          <p className="text-[11px] text-zinc-400 line-clamp-2 leading-tight">
                            {template.description || "Phôi góc chụp chuẩn cho sản phẩm."}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Results Gallery */}
              {results.length > 0 && (
                <div className="space-y-4 rounded-xl border border-amber-500/30 bg-zinc-950/70 p-5 mt-6 animate-fadeIn">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon size={20} weight="fill" className="text-emerald-400" />
                      <h3 className="text-sm font-bold text-white">
                        Kết Quả Mockup Hoàn Thành ({results.length} Ảnh 2000x2000)
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadAll}
                        className="flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-white border border-zinc-700 transition-colors"
                      >
                        <DownloadSimpleIcon size={14} />
                        Tải Tất Cả Ảnh
                      </button>

                      {trelloSource?.cardId && (
                        <button
                          type="button"
                          disabled={uploadingToTrello}
                          onClick={handleUploadAllToTrello}
                          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-bold text-white shadow-md disabled:opacity-50 transition-colors"
                        >
                          {uploadingToTrello ? (
                            <SpinnerIcon size={14} className="animate-spin" />
                          ) : (
                            <UploadSimpleIcon size={14} weight="bold" />
                          )}
                          Đẩy Tất Cả Lên Trello
                        </button>
                      )}
                    </div>
                  </div>

                  {trelloUploadSuccess && (
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400 flex items-center gap-2">
                      <CheckCircleIcon size={16} weight="fill" />
                      {trelloUploadSuccess}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {results.map((mockup, idx) => (
                      <div
                        key={idx}
                        className="group relative rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col"
                      >
                        <div className="aspect-square w-full relative overflow-hidden bg-zinc-950">
                          <img
                            src={mockup.dataUrl}
                            alt={mockup.name}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPreviewImage(mockup)}
                              className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-amber-500 hover:text-zinc-950 transition-colors shadow"
                              title="Xem chi tiết"
                            >
                              <EyeIcon size={18} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadSingle(mockup)}
                              className="rounded-lg bg-zinc-800 p-2 text-white hover:bg-amber-500 hover:text-zinc-950 transition-colors shadow"
                              title="Tải về máy"
                            >
                              <DownloadSimpleIcon size={18} />
                            </button>
                          </div>
                        </div>
                        <div className="p-2.5 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between text-xs">
                          <span className="font-bold text-amber-300 truncate">{mockup.badge}</span>
                          <span className="text-[10px] text-zinc-500">2000x2000 PNG</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Tab 2: Quản Lý Phôi Hộp */
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Form Thêm Phôi Mới */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
                  <PlusIcon size={18} className="text-amber-400 font-bold" />
                  <h3 className="text-sm font-bold text-white">Thêm Phôi Góc Chụp Mới</h3>
                </div>

                <form onSubmit={handleSaveCustomTemplate} className="space-y-3.5">
                  {/* Base Image Upload */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      Ảnh Phôi Chụp Thực Tế (Bắt buộc)
                    </label>
                    {newTemplateDataUrl ? (
                      <div className="relative group h-40 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 flex items-center justify-center p-2">
                        <img
                          src={newTemplateDataUrl}
                          alt="New Template Preview"
                          className="max-h-full max-w-full object-contain rounded"
                        />
                        <button
                          type="button"
                          onClick={() => setNewTemplateDataUrl("")}
                          className="absolute top-2 right-2 rounded-md bg-red-600/80 p-1 text-white hover:bg-red-500"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-900/40 hover:border-amber-500/50 hover:bg-zinc-800/50 transition-all text-center p-3">
                        <UploadSimpleIcon size={24} className="text-zinc-400" />
                        <span className="text-xs text-zinc-300">Tải lên ảnh chụp chiếc hộp trơn</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleTemplateBaseUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Tên Phôi / Góc Chụp
                    </label>
                    <input
                      type="text"
                      placeholder="Ví dụ: Hộp Quà Nam Châm - Mở Nắp 45°"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Danh Mục
                      </label>
                      <select
                        value={newTemplateCategory}
                        onChange={(e) => setNewTemplateCategory(e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                      >
                        <option value="box">📦 Hộp Quà (Box)</option>
                        <option value="glass-ornament">🔮 Glass Ornament</option>
                        <option value="custom">⭐ Phân loại khác</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-300 mb-1">
                        Nhãn Badge
                      </label>
                      <input
                        type="text"
                        placeholder="vd: Ảnh Chính / Mở Nắp..."
                        value={newTemplateBadge}
                        onChange={(e) => setNewTemplateBadge(e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Mô Tả Góc Chụp
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Mô tả bối cảnh góc chụp..."
                      value={newTemplateDescription}
                      onChange={(e) => setNewTemplateDescription(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Hướng Dẫn Prompt AI (Tùy chọn)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="vd: In artwork lên mặt nắp trên của hộp, giữ bóng đổ..."
                      value={newTemplatePrompt}
                      onChange={(e) => setNewTemplatePrompt(e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  {/* Quản lý Phụ kiện */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Phụ Kiện Kèm Theo Phôi (Hộp, Chân đế, Dây treo...)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="vd: Hộp nắp cam Bozspacer, Chân đế đen..."
                        value={accessoryInput}
                        onChange={(e) => setAccessoryInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddAccessory();
                          }
                        }}
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddAccessory}
                        className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-amber-400 hover:bg-zinc-700 transition-colors shrink-0"
                      >
                        + Thêm
                      </button>
                    </div>

                    {newTemplateAccessories.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {newTemplateAccessories.map((acc, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] text-amber-300 font-medium"
                          >
                            <span>📦 {acc}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveAccessory(idx)}
                              className="text-amber-400 hover:text-red-400 transition-colors ml-0.5"
                              title="Xóa phụ kiện này"
                            >
                              <XIcon size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-zinc-500">
                      Khi người dùng gen ảnh chọn phụ kiện này, hệ thống sẽ tự động ghép prompt hướng dẫn AI đồng bộ phụ kiện từ phôi thật.
                    </p>
                  </div>

                  {templateFormError && (
                    <div className="text-xs text-red-400 flex items-center gap-1.5">
                      <WarningCircleIcon size={14} />
                      {templateFormError}
                    </div>
                  )}
                  {templateFormSuccess && (
                    <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <CheckCircleIcon size={14} weight="fill" />
                      {templateFormSuccess}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingTemplate}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                  >
                    {savingTemplate ? (
                      <SpinnerIcon size={16} className="animate-spin" />
                    ) : (
                      <FloppyDiskIcon size={16} weight="bold" />
                    )}
                    Lưu Phôi Vào Hệ Thống
                  </button>
                </form>
              </div>

              {/* Danh sách Phôi Hiện Có */}
              <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 space-y-4 flex flex-col">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-sm font-bold text-white">
                    Kho Phôi Đang Có ({allAvailableTemplates.length} phôi)
                  </h3>
                  <span className="text-xs text-zinc-400">
                    {customTemplates.length} phôi do bạn tự thêm
                  </span>
                </div>

                {loadingTemplates ? (
                  <div className="flex h-64 items-center justify-center">
                    <SpinnerIcon size={24} className="animate-spin text-amber-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto max-h-[500px] pr-1">
                    {allAvailableTemplates.map((template) => {
                      const imageSrc =
                        template.templateDataUrl ||
                        (template.templateAssetPath
                          ? `/${template.templateAssetPath.replace(/^public\//, "")}`
                          : "");

                      return (
                        <div
                          key={template.id}
                          className="relative rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5 flex flex-col justify-between"
                        >
                          <div>
                            <div className="aspect-square w-full rounded-lg overflow-hidden bg-zinc-950 mb-2 relative">
                              {imageSrc ? (
                                <img
                                  src={imageSrc}
                                  alt={template.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center">
                                  <ImageSquareIcon size={32} className="text-zinc-700" />
                                </div>
                              )}

                              <span className="absolute top-2 right-2 rounded bg-zinc-900/90 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 border border-amber-500/30">
                                {template.badge}
                              </span>
                            </div>

                            <div className="space-y-1">
                              <h4 className="text-xs font-bold text-white truncate" title={template.name}>
                                {template.name}
                              </h4>
                              <p className="text-[10px] text-zinc-500 line-clamp-1">
                                {template.isCustom ? "Phôi tùy chỉnh của bạn" : "Phôi chuẩn tích hợp"}
                              </p>

                              {template.accessories && template.accessories.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {template.accessories.map((acc, idx) => (
                                    <span
                                      key={idx}
                                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 border border-zinc-700"
                                      title={acc}
                                    >
                                      📦 {acc}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {template.isCustom && (
                            <div className="mt-2 pt-2 border-t border-zinc-800 flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomTemplate(template.id)}
                                className="flex items-center gap-1 text-[11px] font-medium text-red-400 hover:text-red-300"
                              >
                                <TrashIcon size={13} />
                                Xóa
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Zoom Modal */}
        {previewImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-fadeIn"
            onClick={() => setPreviewImage(null)}
          >
            <div
              className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 p-2"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={previewImage.dataUrl}
                alt={previewImage.name}
                className="max-h-[85vh] w-auto rounded-xl object-contain"
              />
              <div className="flex items-center justify-between p-3">
                <span className="text-sm font-bold text-white">{previewImage.name} ({previewImage.badge})</span>
                <button
                  type="button"
                  onClick={() => handleDownloadSingle(previewImage)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400"
                >
                  <DownloadSimpleIcon size={14} />
                  Tải Ảnh Xuống
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
