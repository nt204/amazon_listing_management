"use client";

import {
  DownloadSimpleIcon,
  FileXlsIcon,
  FloppyDiskIcon,
  PlayIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  buildExcelListingInput,
  toAmazonTemplateItem,
  type AmazonTemplateItem,
  type ExcelImportResult,
  type ExcelSkuRow,
} from "@/lib/excel-batch";
import { resizeImage } from "@/lib/image-client";
import type { BrandProfile, ListingInput, ListingTemplateSummary, StoredListing } from "@/lib/types";
import { generateUUID } from "@/lib/uuid-client";

interface BatchImportProps {
  open: boolean;
  baseInput: ListingInput;
  brands: BrandProfile[];
  onBrandSaved: (brand: BrandProfile) => void;
  onClose: () => void;
  onComplete: (listings: StoredListing[]) => void;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Không thể xử lý batch.");
  return body;
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") || "";
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

function imageExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function loadTrelloImage(url: string, sku: string, index: number) {
  const response = await fetch(`/api/import/trello-image?url=${encodeURIComponent(url)}`);
  if (!response.ok) {
    throw new Error(await responseError(response, `Không tải được ảnh ${index + 1} của ${sku}.`));
  }
  const blob = await response.blob();
  const file = new File([blob], `${sku}-${index + 1}.${imageExtension(blob.type)}`, { type: blob.type });
  return resizeImage(file);
}

export function BatchImport({ open, baseInput, brands, onBrandSaved, onClose, onComplete }: BatchImportProps) {
  const initialBrandProfileId = brands.some((brand) => brand.id === baseInput.brand_profile_id)
    ? baseInput.brand_profile_id || ""
    : "";
  const [templates, setTemplates] = useState<ListingTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [brandProfileId, setBrandProfileId] = useState(initialBrandProfileId);
  const [manualBrand, setManualBrand] = useState(initialBrandProfileId ? "" : baseInput.brand);
  const [templateName, setTemplateName] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [rows, setRows] = useState<ExcelSkuRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) || null,
    [templateId, templates],
  );
  const selectedBrand = useMemo(
    () => brands.find((brand) => brand.id === brandProfileId) || null,
    [brandProfileId, brands],
  );
  const batchBrand = selectedBrand?.name || manualBrand.trim();

  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch("/api/templates")
      .then((response) => responseJson<{ templates: ListingTemplateSummary[] }>(response))
      .then((data) => {
        if (!active) return;
        setTemplates(data.templates);
        setTemplateId((current) => current || data.templates[0]?.id || "");
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Không thể tải template.");
      });
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  const saveTemplate = async () => {
    if (!templateFile || !templateName.trim()) return;
    setSavingTemplate(true);
    setError("");
    setProgress("Đang đọc và lưu technical headers của template...");
    try {
      const formData = new FormData();
      formData.set("name", templateName.trim());
      formData.set("template", templateFile);
      const data = await responseJson<{ template: ListingTemplateSummary }>(
        await fetch("/api/templates", { method: "POST", body: formData }),
      );
      setTemplates((current) => [
        ...current.filter((template) => template.id !== data.template.id && template.name !== data.template.name),
        data.template,
      ].sort((first, second) => first.name.localeCompare(second.name)));
      setTemplateId(data.template.id);
      setTemplateName("");
      setTemplateFile(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không thể lưu template.");
    } finally {
      setSavingTemplate(false);
      setProgress("");
    }
  };

  const saveBrand = async () => {
    const name = manualBrand.trim();
    if (!name) return;
    setSavingBrand(true);
    setError("");
    try {
      const data = await responseJson<{ brand: BrandProfile }>(
        await fetch("/api/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, guidelines: "" }),
        }),
      );
      onBrandSaved(data.brand);
      setBrandProfileId(data.brand.id);
      setManualBrand("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không thể lưu Brand.");
    } finally {
      setSavingBrand(false);
    }
  };

  const readWorkbook = async (file?: File) => {
    if (!file) return;
    setError("");
    setWarnings([]);
    setRows([]);
    setFileName(file.name);
    setProgress("Đang đọc file Excel...");
    try {
      const formData = new FormData();
      formData.set("workbook", file);
      const parsed = await responseJson<ExcelImportResult>(
        await fetch("/api/import/sku-workbook", { method: "POST", body: formData }),
      );
      setRows(parsed.rows);
      setWarnings(parsed.warnings);
    } catch (readError) {
      setFileName("");
      setError(readError instanceof Error ? readError.message : "Không thể đọc file Excel.");
    } finally {
      setProgress("");
    }
  };

  const exportWorkbook = async (items: AmazonTemplateItem[]) => {
    if (!selectedTemplate) throw new Error("Hãy chọn template đầu ra.");
    setProgress(`Đang điền ${items.length} listing vào template Amazon...`);
    const response = await fetch("/api/import/amazon-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: selectedTemplate.id, items }),
    });
    if (!response.ok) throw new Error(await responseError(response, "Không thể xuất template Amazon."));
    downloadBlob(await response.blob(), responseFilename(response, "amazon-listing.xlsx"));
  };

  const run = async () => {
    setError("");
    setLoading(true);
    const succeeded: Array<{ row: ExcelSkuRow; listing: StoredListing }> = [];
    const failures: string[] = [];
    try {
      if (!batchBrand) throw new Error("Hãy chọn hoặc nhập Brand cho batch.");
      if (!selectedTemplate) throw new Error("Hãy chọn template Amazon trước khi chạy batch.");
      const batchBaseInput: ListingInput = {
        ...baseInput,
        brand: batchBrand,
        brand_profile_id: selectedBrand?.id || "",
        brand_guidelines: selectedBrand?.guidelines || "",
      };
      const chunkSize = 4;
      for (let start = 0; start < rows.length; start += chunkSize) {
        const currentRows = rows.slice(start, start + chunkSize);
        const prepared: Array<{ row: ExcelSkuRow; input: ListingInput }> = [];
        for (let offset = 0; offset < currentRows.length; offset += 1) {
          const row = currentRows[offset];
          const position = start + offset + 1;
          try {
            setProgress(`Đang tải và tối ưu ảnh ${position}/${rows.length}: ${row.sku}`);
            const images = await Promise.all(
              row.image_urls.map((url, imageIndex) => loadTrelloImage(url, row.sku, imageIndex)),
            );
            prepared.push({ row, input: buildExcelListingInput(batchBaseInput, row, images, selectedTemplate) });
          } catch (imageError) {
            failures.push(`${row.sku}: ${imageError instanceof Error ? imageError.message : "Lỗi ảnh."}`);
          }
        }
        if (!prepared.length) continue;

        setProgress(
          `Đang tạo listing ${start + 1}-${Math.min(start + currentRows.length, rows.length)}/${rows.length}`,
        );
        try {
          const data = await responseJson<{
            results: Array<{ index: number; listing?: StoredListing | null; error?: string }>;
          }>(
            await fetch("/api/listings/batch", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": generateUUID(),
              },
              body: JSON.stringify({ items: prepared.map((item) => item.input) }),
            }),
          );
          for (const result of data.results) {
            const source = prepared[result.index];
            if (!source) continue;
            if (result.listing) succeeded.push({ row: source.row, listing: result.listing });
            else failures.push(`${source.row.sku}: ${result.error || "Không tạo được listing."}`);
          }
        } catch (batchError) {
          const message = batchError instanceof Error ? batchError.message : "Không tạo được listing.";
          failures.push(...prepared.map(({ row }) => `${row.sku}: ${message}`));
        }
      }

      if (!succeeded.length) throw new Error(failures[0] || "Không listing nào được tạo.");
      await exportWorkbook(succeeded.map(({ row, listing }) => toAmazonTemplateItem(row, listing)));
      onComplete(succeeded.map(({ listing }) => listing));
      if (failures.length) {
        setError(`${succeeded.length} SKU thành công, ${failures.length} SKU lỗi. ${failures[0]}`);
      } else {
        onClose();
      }
    } catch (runError) {
      if (succeeded.length) onComplete(succeeded.map(({ listing }) => listing));
      setError(runError instanceof Error ? runError.message : "Không thể xử lý batch.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <div className="fixed inset-0 z-[5] grid place-items-center bg-[#1f2931]/45 p-4" role="presentation">
      <section className="max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-[12px] border border-[#d8dde1] bg-white shadow-[0_24px_70px_rgba(31,41,49,0.24)]" role="dialog" aria-modal="true" aria-labelledby="batch-title">
        <header className="sticky top-0 z-[1] flex items-center justify-between gap-4 border-b border-[#e1e5e8] bg-white px-5 py-4">
          <div>
            <h2 id="batch-title" className="text-sm font-bold text-[#222b32]">Tạo listing từ Excel</h2>
            <p className="mt-0.5 text-xs text-[#65717c]">Đọc SKU và ảnh Trello, tạo nội dung rồi tự điền template Amazon.</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading || savingBrand || savingTemplate} aria-label="Đóng" className="grid h-9 w-9 place-items-center rounded-lg text-[#65717c] hover:bg-[#f0f2f4] disabled:opacity-50">
            <XIcon size={18} />
          </button>
        </header>

        <div className="grid gap-5 p-5">
          <div className="grid gap-4 rounded-lg bg-[#f3f5f6] p-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="excel-template" className="text-xs font-bold text-[#39444d]">Template đầu ra đã lưu</label>
              <select id="excel-template" value={templateId} disabled={loading || savingTemplate} onChange={(event) => setTemplateId(event.target.value)} className="field-control text-sm">
                <option value="">Chọn template...</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              {selectedTemplate ? (
                <p className="text-xs leading-5 text-[#65717c]">
                  {selectedTemplate.original_filename} · {selectedTemplate.metadata.column_count} cột A–{selectedTemplate.metadata.last_column} · Title {selectedTemplate.metadata.content_columns.title} · Generic Keywords {selectedTemplate.metadata.content_columns.generic_keywords}
                </p>
              ) : <p className="text-xs leading-5 text-[#65717c]">Chưa có template? Upload và đặt tên ở bên phải.</p>}
            </div>
            <div className="grid gap-2 border-t border-[#dfe3e6] pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0">
              <label htmlFor="template-name" className="text-xs font-bold text-[#39444d]">Thêm hoặc cập nhật template</label>
              <input id="template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} disabled={savingTemplate || loading} className="field-control text-sm" placeholder="Ví dụ: Glass Ornament" />
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#b9c1c7] bg-white px-3 text-xs text-[#59656e] hover:border-[#b84f1d]">
                <FileXlsIcon size={17} className="text-[#a24419]" />
                <span className="min-w-0 flex-1 truncate">{templateFile?.name || "Chọn template .xlsx hoặc .xlsm"}</span>
                <input type="file" accept=".xlsx,.xlsm" disabled={savingTemplate || loading} className="sr-only" onChange={(event) => setTemplateFile(event.target.files?.[0] || null)} />
              </label>
              <button type="button" onClick={() => void saveTemplate()} disabled={savingTemplate || loading || !templateName.trim() || !templateFile} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#39444d] px-3 text-xs font-bold text-white hover:bg-[#263139] disabled:bg-[#bfc4c8]">
                <UploadSimpleIcon size={16} /> {savingTemplate ? "Đang đọc template..." : "Lưu template"}
              </button>
            </div>
            <div className="grid gap-2 border-t border-[#dfe3e6] pt-4 md:col-span-2 md:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="batch-brand-profile" className="text-xs font-bold text-[#39444d]">Brand cho batch</label>
                <select
                  id="batch-brand-profile"
                  value={brandProfileId}
                  disabled={loading || savingTemplate || savingBrand}
                  onChange={(event) => setBrandProfileId(event.target.value)}
                  className="field-control text-sm"
                >
                  <option value="">Nhập Brand thủ công</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </div>
              <div className="grid gap-2">
                <label htmlFor="batch-brand-name" className="text-xs font-bold text-[#39444d]">Tên Brand</label>
                <div className="flex gap-2">
                  <input
                    id="batch-brand-name"
                    value={selectedBrand?.name || manualBrand}
                    disabled={Boolean(selectedBrand) || loading || savingTemplate || savingBrand}
                    onChange={(event) => setManualBrand(event.target.value)}
                    className="field-control min-w-0 flex-1 text-sm"
                    placeholder="Ví dụ: Celsorix"
                  />
                  <button
                    type="button"
                    onClick={() => void saveBrand()}
                    disabled={Boolean(selectedBrand) || !manualBrand.trim() || loading || savingTemplate || savingBrand}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#39444d] px-3 text-xs font-bold text-white hover:bg-[#263139] disabled:bg-[#bfc4c8]"
                  >
                    <FloppyDiskIcon size={15} /> {savingBrand ? "Đang lưu..." : "Lưu dùng lại"}
                  </button>
                </div>
              </div>
              <p className="text-xs leading-5 text-[#65717c] md:col-span-2">
                Category/Product Type Amazon được đọc từ template đã chọn. Tên template được dùng làm gợi ý loại sản phẩm dễ hiểu cho AI.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
              <p className="text-xs leading-5 text-[#65717c]">Input chỉ cần SKU, link ảnh Trello, Main Keyword và Generic Keywords. Brand đã chọn: <strong>{batchBrand || "chưa chọn"}</strong>.</p>
              <a href="/api/import/sku-workbook" download className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#cfd5da] bg-white px-3 text-xs font-semibold text-[#39444d] hover:bg-[#fafafa]">
                <DownloadSimpleIcon size={16} /> Tải file input mẫu
              </a>
            </div>
          </div>

          <label className="flex min-h-28 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#b9c1c7] p-4 hover:border-[#b84f1d] hover:bg-[#fff8f4]">
            <FileXlsIcon size={32} className="shrink-0 text-[#a24419]" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-[#39444d]">{fileName || "Chọn file Excel SKU"}</span>
              <span className="mt-1 block text-xs text-[#65717c]">{rows.length ? `${rows.length} SKU hợp lệ` : ".xlsx hoặc .xlsm, tối đa 10 MB"}</span>
            </span>
            <input type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" disabled={loading} className="sr-only" onChange={(event) => void readWorkbook(event.target.files?.[0])} />
          </label>

          {rows.length ? (
            <div className="overflow-x-auto rounded-lg border border-[#dfe3e6]">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead className="bg-[#f3f5f6] text-[#59656e]">
                  <tr><th className="px-3 py-2.5">SKU</th><th className="px-3 py-2.5">Main Keyword</th><th className="px-3 py-2.5">Generic Keywords</th><th className="px-3 py-2.5 text-center">Ảnh</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.source_row}-${row.sku}`} className="border-t border-[#e7eaec] text-[#39444d]">
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{row.sku}</td>
                      <td className="max-w-72 truncate px-3 py-2.5" title={row.main_keyword}>{row.main_keyword}</td>
                      <td className="max-w-72 truncate px-3 py-2.5" title={row.generic_keywords}>{row.generic_keywords || "—"}</td>
                      <td className="px-3 py-2.5 text-center">{row.image_urls.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {warnings.length ? <div className="flex items-start gap-2 rounded-lg bg-[#fff8e8] p-3 text-xs leading-5 text-[#7d5113]"><WarningCircleIcon className="mt-0.5 shrink-0" size={16} /><span>{warnings.join(" ")}</span></div> : null}
          {error ? <div className="flex items-start gap-2 rounded-lg bg-[#fff3f0] p-3 text-xs leading-5 text-[#8e3021]" role="alert"><WarningCircleIcon className="mt-0.5 shrink-0" size={16} /><span>{error}</span></div> : null}
          {progress ? <p className="text-xs font-semibold text-[#7d5113]" role="status">{progress}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e5e8] pt-4">
            <p className="text-xs text-[#65717c]">Kết quả sẽ tự tải xuống dưới dạng file Amazon Excel có parent + child.</p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={loading} className="h-10 whitespace-nowrap rounded-lg border border-[#cfd5da] bg-white px-4 text-sm font-semibold text-[#39444d] hover:bg-[#f5f6f7] disabled:opacity-50">Hủy</button>
              <button type="button" onClick={run} disabled={loading || savingTemplate || savingBrand || !rows.length || !selectedTemplate} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c5c9cc]">
                <PlayIcon size={17} weight="fill" /> {loading ? "Đang xử lý..." : `Tạo và xuất ${rows.length || 0} SKU`}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
