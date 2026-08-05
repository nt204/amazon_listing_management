"use client";

import Image from "next/image";
import {
  FileImageIcon,
  FlaskIcon,
  MagicWandIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Field, Select, TextArea, TextInput } from "@/components/ui";
import type { AiOptions } from "@/lib/models";
import type { ListingInput } from "@/lib/types";

export interface FormIssue {
  field: string;
  message: string;
}

interface ListingFormProps {
  value: ListingInput;
  onChange: Dispatch<SetStateAction<ListingInput>>;
  onSubmit: () => void;
  onLoadSample: () => void;
  loading: boolean;
  issues: FormIssue[];
  aiOptions: AiOptions | null;
}

async function resizeImage(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Could not process ${file.name}.`));
    element.src = dataUrl;
  });
  const max = 1_600;
  const ratio = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) return { name: file.name, type: file.type, data_url: dataUrl };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  return {
    name: file.name,
    type: outputType,
    data_url: canvas.toDataURL(outputType, 0.82),
  };
}

export function ListingForm({
  value,
  onChange,
  onSubmit,
  onLoadSample,
  loading,
  issues,
  aiOptions,
}: ListingFormProps) {
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

        <Field label="Product Details (optional)" htmlFor="notes">
          <TextArea
            id="notes"
            rows={6}
            value={value.research.notes}
            onChange={(event) => updateResearch("notes", event.target.value)}
            placeholder={"Material: Ceramic\nCapacity: 11 oz\nDishwasher safe"}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Brand (optional)" htmlFor="brand">
            <TextInput
              id="brand"
              value={value.brand}
              onChange={(event) =>
                onChange((current) => ({ ...current, brand: event.target.value }))
              }
              placeholder="ABC"
            />
          </Field>
          <Field label="Reference Listings (optional)" htmlFor="competitor_notes">
            <TextInput
              id="competitor_notes"
              value={value.research.competitor_notes}
              onChange={(event) => updateResearch("competitor_notes", event.target.value)}
              placeholder="Amazon URL / ASIN"
            />
          </Field>
        </div>
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
