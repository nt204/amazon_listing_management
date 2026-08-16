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
} from "@phosphor-icons/react";
import { GLASS_ORNAMENT_TEMPLATES } from "@/lib/template-mockup-types";

export interface GlassOrnamentTrelloSource {
  cardId: string;
  cardName: string;
  sku?: string;
  attachmentId: string;
  attachmentName: string;
  attachmentUrl: string;
}

interface GlassOrnamentTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  trelloSource?: GlassOrnamentTrelloSource;
  trelloApiKey?: string;
  trelloToken?: string;
  automaticSourceNotice?: string;
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

export function GlassOrnamentTemplateModal({
  isOpen,
  onClose,
  trelloSource,
  trelloApiKey,
  trelloToken,
  automaticSourceNotice,
}: GlassOrnamentTemplateModalProps) {
  const [designDataUrl, setDesignDataUrl] = useState<string>("");
  const [designSourceKind, setDesignSourceKind] = useState<
    "trello" | "manual" | null
  >(null);
  const [designSourceLabel, setDesignSourceLabel] = useState<string>("");
  const [sourceLoadingKind, setSourceLoadingKind] = useState<
    "trello" | "manual" | null
  >(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const firstTemplate = GLASS_ORNAMENT_TEMPLATES[0];
    return firstTemplate ? [firstTemplate.id] : [];
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedMockupResult[]>([]);
  const [previewImage, setPreviewImage] = useState<GeneratedMockupResult | null>(null);
  const designSourceVersionRef = useRef(0);
  const generationVersionRef = useRef(0);
  const sourceCardId = trelloSource?.cardId;
  const sourceCardName = trelloSource?.cardName;
  const sourceSku = trelloSource?.sku;
  const sourceAttachmentId = trelloSource?.attachmentId;
  const sourceAttachmentName = trelloSource?.attachmentName;
  const sourceAttachmentUrl = trelloSource?.attachmentUrl;
  const sourceLoading = sourceLoadingKind !== null;

  const resetGeneratedResults = () => {
    generationVersionRef.current += 1;
    setLoading(false);
    setResults([]);
    setPreviewImage(null);
  };

  const generateMockups = async (targetDesignUrl?: string, targetTemplateIds?: string[]) => {
    const urlToUse = targetDesignUrl || designDataUrl;
    const idsToUse = targetTemplateIds || selectedIds;

    if (!urlToUse) {
      setError("Vui lòng chọn hoặc tải lên file ảnh thiết kế.");
      return;
    }
    if (idsToUse.length === 0) {
      setError("Vui lòng chọn ít nhất 1 mẫu template.");
      return;
    }

    setLoading(true);
    setError(null);
    const generationVersion = generationVersionRef.current + 1;
    generationVersionRef.current = generationVersion;

    try {
      const res = await fetch("/api/template-mockup/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designDataUrl: urlToUse,
          selectedTemplateIds: idsToUse,
          mode: "ai",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tạo mockup từ template.");
      }

      if (generationVersion === generationVersionRef.current) {
        setResults(data.mockups || []);
      }
    } catch (err) {
      if (generationVersion === generationVersionRef.current) {
        setError(err instanceof Error ? err.message : "Đã xảy ra lỗi.");
      }
    } finally {
      if (generationVersion === generationVersionRef.current) {
        setLoading(false);
      }
    }
  };

  const toggleSelectTemplate = (id: string) => {
    if (loading) return;
    resetGeneratedResults();
    setError(null);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAllTemplates = () => {
    if (loading) return;
    resetGeneratedResults();
    setError(null);
    setSelectedIds(GLASS_ORNAMENT_TEMPLATES.map((t) => t.id));
  };

  const deselectAllTemplates = () => {
    if (loading) return;
    resetGeneratedResults();
    setError(null);
    setSelectedIds([]);
  };

  const handleFileUpload = async (file: File) => {
    if (loading) {
      setSourceError("Vui lòng chờ mockup AI hiện tại hoàn tất trước khi đổi ảnh nguồn.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setSourceError("Vui lòng chọn file ảnh định dạng PNG, JPG hoặc WebP.");
      return;
    }

    designSourceVersionRef.current += 1;
    const sourceVersion = designSourceVersionRef.current;
    resetGeneratedResults();
    setDesignDataUrl("");
    setDesignSourceKind(null);
    setDesignSourceLabel("");
    setError(null);
    setSourceError(null);
    setSourceLoadingKind("manual");

    try {
      const dataUrl = await readBlobAsDataUrl(file);
      if (sourceVersion === designSourceVersionRef.current) {
        setDesignDataUrl(dataUrl);
        setDesignSourceKind("manual");
        setDesignSourceLabel(`Upload thủ công · ${file.name}`);
      }
    } catch (uploadError) {
      if (sourceVersion === designSourceVersionRef.current) {
        setDesignDataUrl("");
        setDesignSourceKind(null);
        setDesignSourceLabel("");
        setSourceError(
          uploadError instanceof Error
            ? uploadError.message
            : "Không thể đọc file ảnh đã chọn.",
        );
      }
    } finally {
      if (sourceVersion === designSourceVersionRef.current) {
        setSourceLoadingKind(null);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    designSourceVersionRef.current += 1;
    generationVersionRef.current += 1;
    const sourceVersion = designSourceVersionRef.current;
    const controller = new AbortController();
    let cancelled = false;

    const loadOriginalTrelloImage = async () => {
      try {
        const response = await fetch("/api/trello/download-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: sourceAttachmentUrl,
            name: sourceAttachmentName,
            apiKey: trelloApiKey,
            token: trelloToken,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Không thể tải ảnh gốc từ Trello.");
        }

        const dataUrl = await readBlobAsDataUrl(await response.blob());
        if (cancelled || sourceVersion !== designSourceVersionRef.current) return;

        setDesignDataUrl(dataUrl);
        setDesignSourceKind("trello");
        setDesignSourceLabel(
          `Trello DESIGN · ${sourceSku ? `SKU ${sourceSku}` : sourceCardName || sourceCardId} · ${sourceAttachmentName}`,
        );
      } catch (loadError) {
        if (
          cancelled ||
          controller.signal.aborted ||
          sourceVersion !== designSourceVersionRef.current
        ) {
          return;
        }
        setSourceError(
          `${loadError instanceof Error ? loadError.message : "Không thể tải ảnh gốc từ Trello."} Bạn vẫn có thể upload ảnh thủ công bên dưới.`,
        );
      } finally {
        if (!cancelled && sourceVersion === designSourceVersionRef.current) {
          setSourceLoadingKind(null);
        }
      }
    };

    const initializeSourceTimeout = window.setTimeout(() => {
      if (cancelled) return;

      setDesignDataUrl("");
      setDesignSourceKind(null);
      setDesignSourceLabel("");
      setSourceError(null);
      setSourceLoadingKind(sourceAttachmentUrl ? "trello" : null);
      setLoading(false);
      setError(null);
      setResults([]);
      setPreviewImage(null);

      if (sourceAttachmentUrl && sourceAttachmentName) {
        void loadOriginalTrelloImage();
      }
    }, 0);

    return () => {
      cancelled = true;
      generationVersionRef.current += 1;
      window.clearTimeout(initializeSourceTimeout);
      controller.abort();
    };
  }, [
    isOpen,
    sourceAttachmentId,
    sourceAttachmentName,
    sourceAttachmentUrl,
    sourceCardId,
    sourceCardName,
    sourceSku,
    trelloApiKey,
    trelloToken,
  ]);

  if (!isOpen) return null;

  const handleGenerate = () => generateMockups();

  const downloadImage = (mockup: GeneratedMockupResult) => {
    const a = document.createElement("a");
    a.href = mockup.dataUrl;
    a.download = `Glass_Ornament_${mockup.templateId}_${mockup.width}x${mockup.height}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/20">
              <SparkleIcon size={22} weight="fill" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-800">
                Tạo Mockup Glass Ornament bằng AI
              </h2>
              <p className="text-xs font-medium text-slate-500">
                AI lấy thiết kế từ ảnh nguồn, đưa vào ornament và giữ bối cảnh của template đã chọn.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <XIcon size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 thin-scrollbar">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
              {error}
            </div>
          ) : null}

          {/* Section 1: Product photo source */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5">
            <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <ImageSquareIcon size={18} className="text-blue-600" />
              1. Ảnh Sản Phẩm Nguồn
            </h3>

            {automaticSourceNotice && !sourceLoading && !designDataUrl ? (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] font-semibold leading-relaxed text-amber-800">
                <WarningCircleIcon size={17} className="mt-0.5 shrink-0" weight="fill" />
                <span>{automaticSourceNotice}</span>
              </div>
            ) : null}

            {sourceError ? (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[11px] font-semibold leading-relaxed text-rose-700">
                <WarningCircleIcon size={17} className="mt-0.5 shrink-0" weight="fill" />
                <span>{sourceError}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)] gap-4 items-center">
              {sourceLoading ? (
                <div className="flex h-32 w-32 flex-col items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-center shadow-xs">
                  <SpinnerIcon size={28} className="animate-spin text-blue-600" />
                  <span className="mt-2 px-2 text-[10px] font-bold text-blue-700">
                    {sourceLoadingKind === "trello"
                      ? "Đang tải ảnh gốc từ Trello..."
                      : "Đang đọc file ảnh..."}
                  </span>
                </div>
              ) : designDataUrl ? (
                <div className="relative group h-32 w-32 overflow-hidden rounded-2xl border border-slate-300 bg-slate-900 p-2 shadow-xs">
                  <img
                    src={designDataUrl}
                    alt="Ảnh sản phẩm nguồn"
                    className="h-full w-full object-contain"
                  />
                  <label
                    className="absolute inset-0 flex cursor-pointer items-center justify-center bg-slate-950/65 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100"
                  >
                    Đổi ảnh khác
                    <input
                      type="file"
                      disabled={loading}
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void handleFileUpload(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-32 rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer transition p-4 text-center">
                  <UploadSimpleIcon size={28} className="text-slate-400 mb-1" />
                  <span className="text-xs font-bold text-slate-700">Click để chọn ảnh thủ công</span>
                  <span className="text-[10px] text-slate-400">Ảnh sản phẩm PNG/JPG/WebP</span>
                  <input
                    type="file"
                    disabled={loading}
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void handleFileUpload(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
              <div className="space-y-2 text-xs text-slate-600">
                {designSourceLabel ? (
                  <div
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-bold ${
                      designSourceKind === "trello"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                    }`}
                  >
                    <CheckCircleIcon size={17} className="mt-0.5 shrink-0" weight="fill" />
                    <span className="min-w-0 break-words">Nguồn: {designSourceLabel}</span>
                  </div>
                ) : sourceLoadingKind === "trello" && sourceAttachmentName ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] font-bold text-blue-800">
                    Nguồn Trello: {sourceSku ? `SKU ${sourceSku}` : sourceCardName || sourceCardId} · {sourceAttachmentName}
                  </div>
                ) : null}

                <p className="font-bold text-slate-800">Ảnh tham chiếu cho AI:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] leading-relaxed text-slate-500">
                  <li>AI nhận diện thiết kế đang có trên mặt ornament trong ảnh nguồn.</li>
                  <li>Kích thước ảnh kết quả sẽ được hiển thị theo dữ liệu trả về sau khi AI hoàn tất.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 2: Choose Template */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <SparkleIcon size={18} className="text-amber-500" />
                2. Chọn Mẫu Template ({selectedIds.length}/{GLASS_ORNAMENT_TEMPLATES.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={selectAllTemplates}
                  className="text-[11px] font-bold text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-50 transition"
                >
                  Chọn tất cả ({GLASS_ORNAMENT_TEMPLATES.length})
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  disabled={loading || selectedIds.length === 0}
                  onClick={deselectAllTemplates}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50 transition"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {GLASS_ORNAMENT_TEMPLATES.map((tmpl) => {
                const isSelected = selectedIds.includes(tmpl.id);
                const thumbnailSrc = tmpl.templateAssetPath.startsWith("public")
                  ? tmpl.templateAssetPath.replace(/^public/, "")
                  : tmpl.templateAssetPath;

                return (
                  <button
                    type="button"
                    key={tmpl.id}
                    disabled={loading}
                    onClick={() => toggleSelectTemplate(tmpl.id)}
                    aria-pressed={isSelected}
                    aria-label={`Chọn template ${tmpl.name}`}
                    className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 transition aspect-square bg-slate-900 disabled:cursor-not-allowed ${
                      isSelected
                        ? "border-amber-500 shadow-md ring-2 ring-amber-500/30"
                        : "border-slate-200 opacity-70 hover:opacity-100 hover:border-slate-300"
                    }`}
                  >
                    <img
                      src={thumbnailSrc}
                      alt={tmpl.name}
                      className="h-full w-full object-cover transition transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-transparent" />
                    <div className="absolute top-2 right-2">
                      <div
                        className={`h-6 w-6 rounded-full flex items-center justify-center shadow-md transition ${
                          isSelected
                            ? "bg-amber-500 text-white scale-110"
                            : "bg-slate-950/40 text-white/70 backdrop-blur-xs border border-white/30"
                        }`}
                      >
                        {isSelected ? <CheckCircleIcon size={18} weight="fill" /> : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: AI-only render mode */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <SparkleIcon size={18} className="text-amber-500" weight="fill" />
              3. AI Image Edit
            </h3>
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 ring-2 ring-amber-500/10">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-extrabold text-slate-800">
                  <SparkleIcon size={17} className="shrink-0 text-amber-500" weight="fill" />
                  GPT Image 2 · CheapKeyAI
                </span>
                <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  CheapKeyAI
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
                CheapKeyAI nhận đồng thời ảnh nguồn và template bằng model gpt-image-2, thay thiết kế trên mặt ornament đồng thời cố gắng giữ nguyên nền, bố cục, phụ kiện và ánh sáng của template. Không dùng canvas hoặc thư viện ghép ảnh thủ công.
              </p>
            </div>
          </div>

          {/* Render Results Section */}
          {results.length > 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-2">
                  <CheckCircleIcon size={20} className="text-emerald-600" weight="fill" />
                  Đã Tạo Xong Mockup AI ({results.length})
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {results.map((mockup) => (
                  <div key={mockup.templateId} className="group relative rounded-xl border border-emerald-200 bg-white p-2 shadow-2xs">
                    <img
                      src={mockup.dataUrl}
                      alt={mockup.name}
                      className="h-36 w-full rounded-lg object-contain bg-slate-900"
                    />
                    <div className="mt-2 text-center">
                      <p className="truncate text-[10px] font-bold text-slate-800" title={mockup.name}>{mockup.name}</p>
                      <p className="text-[9px] font-medium text-emerald-600">{mockup.width} x {mockup.height} px</p>
                    </div>
                    <div className="absolute inset-2 flex items-center justify-center gap-2 rounded-lg bg-slate-950/70 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={() => setPreviewImage(mockup)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white hover:bg-white/40"
                        title="Xem trước"
                      >
                        <EyeIcon size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadImage(mockup)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 shadow-xs"
                        title="Tải về"
                      >
                        <DownloadSimpleIcon size={16} weight="bold" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <div className="text-xs text-slate-500">
            {selectedIds.length === 0
              ? "Chưa chọn template"
              : `Đã chọn ${selectedIds.length}/${GLASS_ORNAMENT_TEMPLATES.length} mẫu template`}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={loading || sourceLoading || !designDataUrl || selectedIds.length === 0}
              onClick={handleGenerate}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-extrabold text-white hover:bg-amber-600 active:scale-95 disabled:opacity-50 transition shadow-md shadow-amber-500/20"
            >
              {loading ? (
                <>
                  <SpinnerIcon size={16} className="animate-spin" />
                  AI đang tạo {selectedIds.length} mockup...
                </>
              ) : (
                <>
                  <SparkleIcon size={16} weight="fill" />
                  {selectedIds.length > 1
                    ? `Tạo ${selectedIds.length} Mockup AI`
                    : "Tạo Mockup bằng AI"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewImage ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-3xl bg-slate-900 p-4 shadow-2xl">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-white hover:bg-slate-700 transition"
            >
              <XIcon size={20} />
            </button>
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="max-h-[75vh] w-auto rounded-2xl object-contain mx-auto"
            />
            <div className="mt-4 flex items-center justify-between text-white px-2">
              <div>
                <p className="text-sm font-bold">{previewImage.name}</p>
                <p className="text-xs text-slate-400">{previewImage.width} x {previewImage.height} px • {previewImage.providerUsed}</p>
              </div>
              <button
                type="button"
                onClick={() => downloadImage(previewImage)}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 transition"
              >
                <DownloadSimpleIcon size={16} weight="bold" /> Tải về ảnh này
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
