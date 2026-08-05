"use client";

import Image from "next/image";
import {
  FileImageIcon,
  FlaskIcon,
  MagicWandIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { Field, Select, TextArea, TextInput } from "@/components/ui";
import { resizeImage } from "@/lib/image-client";
import type { AiOptions } from "@/lib/models";
import type { BrandProfile, ListingInput } from "@/lib/types";

export interface FormIssue {
  field: string;
  message: string;
}

function splitKeywords(value: string) {
  return [...new Set(value.split(/[\n,;]+/).map((term) => term.trim()).filter(Boolean))].slice(0, 50);
}

function KeywordTextArea({
  id,
  value,
  onCommit,
  placeholder,
}: {
  id: string;
  value: string[];
  onCommit: (keywords: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value.join("\n"));
  const lastCommitted = useRef(value.join("\n"));
  useEffect(() => {
    const externalValue = value.join("\n");
    if (externalValue !== lastCommitted.current) {
      lastCommitted.current = externalValue;
      setDraft(externalValue);
    }
  }, [value]);
  return (
    <TextArea
      id={id}
      rows={4}
      value={draft}
      onChange={(event) => {
        const nextDraft = event.target.value;
        const keywords = splitKeywords(nextDraft);
        setDraft(nextDraft);
        lastCommitted.current = keywords.join("\n");
        onCommit(keywords);
      }}
      placeholder={placeholder}
    />
  );
}

interface ListingFormProps {
  value: ListingInput;
  onChange: Dispatch<SetStateAction<ListingInput>>;
  onSubmit: () => void;
  onLoadSample: () => void;
  loading: boolean;
  issues: FormIssue[];
  aiOptions: AiOptions | null;
  brands: BrandProfile[];
}

export function ListingForm({
  value,
  onChange,
  onSubmit,
  onLoadSample,
  loading,
  issues,
  aiOptions,
  brands,
}: ListingFormProps) {
  const [referenceState, setReferenceState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | {
        status: "ready";
        contentCount: number;
        resolvedCount: number;
        elapsedMs: number;
      }
  >({ status: "idle" });
  const referenceRequest = useRef(0);
  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;
  const updateResearch = (field: keyof ListingInput["research"], next: string) =>
    onChange((current) => ({
      ...current,
      research: { ...current.research, [field]: next },
    }));

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, 10 - value.images.length);
    const supported = files.filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );
    const converted = await Promise.all(supported.map(resizeImage));
    onChange((current) => ({
      ...current,
      images: [...current.images, ...converted].slice(0, 10),
    }));
    event.target.value = "";
  };

  const availableModels = [
    ...(aiOptions?.gemini_available
      ? aiOptions.gemini_models.map((model) => ({ ...model, provider: "gemini" as const }))
      : []),
    ...(aiOptions?.openai_available
      ? aiOptions.openai_models.map((model) => ({ ...model, provider: "openai" as const }))
      : []),
  ];
  const selectedModel =
    value.configuration.ai_provider === "openai"
      ? value.configuration.openai_model
      : value.configuration.ai_provider === "gemini"
        ? value.configuration.gemini_model
        : aiOptions?.gemini_available
          ? value.configuration.gemini_model
          : aiOptions?.openai_available
            ? value.configuration.openai_model
            : "";

  const selectModel = (modelId: string) => {
    const model = availableModels.find((item) => item.id === modelId);
    if (!model) return;
    onChange((current) => ({
      ...current,
      configuration: {
        ...current.configuration,
        ai_provider: model.provider,
        ...(model.provider === "gemini"
          ? { gemini_model: model.id }
          : { openai_model: model.id }),
      },
    }));
  };

  const inspectReference = async () => {
    const reference = value.research.competitor_notes.trim();
    if (!reference) {
      setReferenceState({ status: "idle" });
      return;
    }
    const requestId = referenceRequest.current + 1;
    referenceRequest.current = requestId;
    setReferenceState({ status: "loading" });
    try {
      const response = await fetch("/api/references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: reference, marketplace: value.marketplace }),
      });
      const data = (await response.json()) as {
        content_count?: number;
        resolved_count?: number;
        elapsed_ms?: number;
      };
      if (referenceRequest.current === requestId) {
        setReferenceState({
          status: "ready",
          contentCount: response.ok ? Number(data.content_count || 0) : 0,
          resolvedCount: response.ok ? Number(data.resolved_count || 0) : 0,
          elapsedMs: Number(data.elapsed_ms || 0),
        });
      }
    } catch {
      if (referenceRequest.current === requestId) {
        setReferenceState({
          status: "ready",
          contentCount: 0,
          resolvedCount: 0,
          elapsedMs: 0,
        });
      }
    }
  };

  return (
    <section className="thin-scrollbar flex min-h-0 min-w-0 flex-col border-r border-[#dfe3e6] bg-white lg:max-h-[calc(100dvh-64px)]">
      <div className="flex items-start justify-between gap-4 border-b border-[#e5e8ea] px-5 py-4">
        <div>
          <h1 className="text-base font-bold text-[#1d252c]">Tạo listing mới</h1>
        </div>
        <button
          type="button"
          onClick={onLoadSample}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#cfd5da] bg-white px-3 text-xs font-semibold text-[#39444d] hover:bg-[#f5f6f7] active:translate-y-px"
        >
          <FlaskIcon size={16} />
          Điền mẫu
        </button>
      </div>

      <div className="thin-scrollbar grid flex-1 content-start gap-5 overflow-y-auto px-5 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Thị trường" htmlFor="marketplace" required>
            <Select
              id="marketplace"
              value={value.marketplace}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  marketplace: event.target.value as ListingInput["marketplace"],
                }))
              }
            >
              <option value="US">Amazon US</option>
              <option value="UK">Amazon UK</option>
              <option value="DE">Amazon DE</option>
            </Select>
          </Field>
          <Field label="Loại sản phẩm" htmlFor="product_type" required error={issueFor("product_type")}>
            <Select
              id="product_type"
              value={value.product_type}
              aria-invalid={Boolean(issueFor("product_type"))}
              onChange={(event) =>
                onChange((current) => ({ ...current, product_type: event.target.value }))
              }
            >
              <option value="">Chọn loại</option>
              <option value="Mug">Mug / Ly sứ</option>
              <option value="T-shirt">T-shirt / Áo thun</option>
              <option value="Tumbler">Tumbler / Bình giữ nhiệt</option>
              <option value="Ornament">Ornament / Đồ trang trí</option>
              <option value="Blanket">Blanket / Chăn</option>
            </Select>
          </Field>
        </div>

        <Field label="Model AI" htmlFor="ai_model">
          <Select
            id="ai_model"
            value={selectedModel}
            disabled={!availableModels.length}
            onChange={(event) => selectModel(event.target.value)}
          >
            {!availableModels.length ? (
              <option value="">{aiOptions ? "Chưa có API key" : "Đang tải..."}</option>
            ) : null}
            {availableModels.map((model) => (
              <option key={`${model.provider}-${model.id}`} value={model.id}>
                {model.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Ảnh sản phẩm"
          htmlFor="images"
          required
          error={issueFor("images")}
        >
          <label
            htmlFor="images"
            className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#b9c1c7] bg-[#fafbfb] px-4 py-5 text-center hover:border-[#b84f1d] hover:bg-[#fff8f4]"
          >
            <UploadSimpleIcon className="mb-2 text-[#65717c]" size={24} />
            <span className="text-sm font-semibold text-[#39444d]">Tải ảnh sản phẩm</span>
            <input
              id="images"
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleImages}
            />
          </label>
        </Field>

        {value.images.length ? (
          <div className="grid grid-cols-3 gap-2">
            {value.images.map((image, index) => (
              <div
                key={`${image.name}-${index}`}
                className="group relative aspect-square overflow-hidden rounded-lg border border-[#dfe3e6] bg-[#f3f4f5]"
              >
                <Image
                  src={image.data_url}
                  alt={`Ảnh sản phẩm ${index + 1}`}
                  fill
                  unoptimized
                  className="object-cover"
                />
                <button
                  type="button"
                  aria-label={`Xóa ${image.name}`}
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      images: current.images.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                  className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-white text-[#8e3021] shadow-sm hover:bg-[#fff0ec]"
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="border-t border-[#e5e8ea] pt-5">
          <p className="text-xs font-bold text-[#222b32]">Chiến lược tìm kiếm</p>
          <p className="mt-1 text-xs leading-5 text-[#65717c]">Cho AI biết cụm từ bắt buộc và các hướng tìm kiếm cần ưu tiên.</p>
        </div>

        <Field label="Từ khóa chính" htmlFor="main_keyword" required error={issueFor("main_keyword")}>
          <TextInput
            id="main_keyword"
            value={value.main_keyword}
            aria-invalid={Boolean(issueFor("main_keyword"))}
            onChange={(event) =>
              onChange((current) => ({ ...current, main_keyword: event.target.value }))
            }
            placeholder="funny nurse mug"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Từ khóa liên quan"
            htmlFor="related_keywords"
            hint="Một cụm mỗi dòng. Dùng cho title, bullet và description."
          >
            <KeywordTextArea
              id="related_keywords"
              value={value.related_keywords}
              onCommit={(keywords) =>
                onChange((current) => ({
                  ...current,
                  related_keywords: keywords,
                }))
              }
              placeholder={"cat lover gift\npet dad coffee cup"}
            />
          </Field>
          <Field
            label="Backend ưu tiên"
            htmlFor="backend_keywords"
            hint="Từ đồng nghĩa hoặc intent chưa có trong nội dung visible."
          >
            <KeywordTextArea
              id="backend_keywords"
              value={value.backend_keywords}
              onCommit={(keywords) =>
                onChange((current) => ({
                  ...current,
                  backend_keywords: keywords,
                }))
              }
              placeholder={"feline owner\npet parent\nhusband gift"}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Đối tượng mua hoặc nhận"
            htmlFor="target_customer"
            hint="Shopping context, không được xem là product fact."
          >
            <TextInput
              id="target_customer"
              value={value.research.target_customer}
              onChange={(event) => updateResearch("target_customer", event.target.value)}
              placeholder="Cat dads, men who own cats"
            />
          </Field>
          <Field
            label="Dịp mua hoặc tặng"
            htmlFor="occasions"
            hint="Một dịp mỗi dòng; hệ thống sẽ mở rộng có kiểm soát."
          >
            <KeywordTextArea
              id="occasions"
              value={value.research.occasion}
              onCommit={(occasions) =>
                onChange((current) => ({
                  ...current,
                  research: { ...current.research, occasion: occasions },
                }))
              }
              placeholder={"Father's Day\nBirthday\nChristmas"}
            />
          </Field>
        </div>

        <Field
          label="Product facts (optional)"
          htmlFor="notes"
          hint="Chỉ nhập thông tin đã xác minh. Mỗi dòng một fact; dùng 'Do not mention...' để loại trừ."
        >
          <TextArea
            id="notes"
            rows={6}
            value={value.research.notes}
            onChange={(event) => updateResearch("notes", event.target.value)}
            placeholder={"Material: Ceramic\nCapacity: 11 oz\nDishwasher safe"}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Brand profile (optional)" htmlFor="brand_profile">
            <Select
              id="brand_profile"
              value={value.brand_profile_id || ""}
              onChange={(event) => {
                const profile = brands.find((item) => item.id === event.target.value);
                onChange((current) => ({
                  ...current,
                  brand_profile_id: profile?.id || "",
                  brand: profile?.name || (current.brand_profile_id ? "" : current.brand),
                  brand_guidelines: profile?.guidelines || "",
                }));
              }}
            >
              <option value="">Không dùng profile</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>{brand.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Brand dùng một lần" htmlFor="brand">
            <TextInput
              id="brand"
              value={value.brand}
              disabled={Boolean(value.brand_profile_id)}
              onChange={(event) =>
                onChange((current) => ({ ...current, brand: event.target.value }))
              }
              placeholder={value.brand_profile_id ? "Đang dùng brand profile" : "Limima"}
            />
          </Field>
        </div>

        <Field
          label="Listing đối thủ (optional)"
          htmlFor="competitor_notes"
          hint={
            referenceState.status === "loading"
              ? "Đang đọc reference ở nền..."
              : referenceState.status === "ready" && referenceState.contentCount > 0
                ? `Đã đọc ${referenceState.contentCount}/${referenceState.resolvedCount} reference (${(referenceState.elapsedMs / 1000).toFixed(1)}s).`
              : referenceState.status === "ready"
                  ? referenceState.resolvedCount > 0
                    ? `Đã nhận ${referenceState.resolvedCount} reference nhưng Amazon không trả nội dung; generate vẫn tiếp tục.`
                    : "Không nhận diện được Amazon URL / ASIN."
                  : "Tối đa 3 URL hoặc ASIN. Hệ thống chỉ lấy intent và vocabulary, không sao chép copy hay product claim."
          }
        >
            <TextArea
              id="competitor_notes"
              rows={3}
              value={value.research.competitor_notes}
              onChange={(event) => {
                referenceRequest.current += 1;
                updateResearch("competitor_notes", event.target.value);
                setReferenceState({ status: "idle" });
              }}
              onBlur={() => void inspectReference()}
              placeholder={"Mỗi dòng một Amazon URL / ASIN\nTối đa 3 reference"}
            />
        </Field>
      </div>

      <div className="border-t border-[#dfe3e6] bg-white p-4">
        <button
          type="button"
          disabled={loading}
          onClick={onSubmit}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c5c9cc]"
        >
          {loading ? <FileImageIcon size={19} /> : <MagicWandIcon size={19} weight="bold" />}
          {loading ? "Đang đọc ảnh và viết listing..." : "Tạo listing"}
        </button>
      </div>
    </section>
  );
}
