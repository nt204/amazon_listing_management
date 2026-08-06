"use client";

import {
  DownloadSimpleIcon,
  FileCsvIcon,
  ImagesIcon,
  PlayIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { buildBatchTemplateCsv, parseBatchCsv, type BatchImportRow } from "@/lib/csv";
import { resizeImage } from "@/lib/image-client";
import type { ListingInput, StoredListing } from "@/lib/types";

interface BatchImportProps {
  open: boolean;
  baseInput: ListingInput;
  onClose: () => void;
  onComplete: (listings: StoredListing[]) => void;
}

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not process the batch.");
  return body;
}

function blankInput(base: ListingInput, row: BatchImportRow): ListingInput {
  return {
    marketplace: (row.marketplace.toUpperCase() || "US") as ListingInput["marketplace"],
    product_type: row.product_type,
    internal_name: row.internal_name || row.main_keyword,
    brand: row.brand,
    brand_profile_id: "",
    brand_guidelines: "",
    product_information: {
      material: "",
      size_capacity: "",
      color: "",
      package_contents: "",
      features: [],
      personalization: "",
      care_instructions: "",
      country_of_origin: "",
    },
    main_keyword: row.main_keyword,
    related_keywords: [],
    backend_keywords: [],
    research: {
      target_customer: "",
      occasion: [],
      customer_insight: "",
      usp: "",
      competitor_asins: [],
      competitor_notes: row.reference_listing,
      notes: row.product_details,
    },
    images: [],
    configuration: { ...base.configuration },
  };
}

export function BatchImport({ open, baseInput, onClose, onComplete }: BatchImportProps) {
  const [rows, setRows] = useState<BatchImportRow[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  if (!open) return null;

  const readCsv = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      const parsed = parseBatchCsv(await file.text()).slice(0, 10);
      if (!parsed.length) throw new Error("CSV không có sản phẩm nào.");
      setRows(parsed);
      setFileName(file.name);
    } catch (readError) {
      setRows([]);
      setError(readError instanceof Error ? readError.message : "Không thể đọc CSV.");
    }
  };

  const run = async () => {
    setError("");
    setLoading(true);
    try {
      const byName = new Map(imageFiles.map((file) => [file.name.toLowerCase(), file]));
      const inputs: ListingInput[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.product_type || !row.main_keyword || !row.image_files) {
          throw new Error(`Dòng ${index + 2} thiếu product_type, main_keyword hoặc image_files.`);
        }
        if (!(["US", "UK", "DE"] as string[]).includes(row.marketplace.toUpperCase())) {
          throw new Error(`Dòng ${index + 2} có marketplace không hợp lệ.`);
        }
        const requested = row.image_files.split("|").map((name) => name.trim()).filter(Boolean);
        const missing = requested.filter((name) => !byName.has(name.toLowerCase()));
        if (missing.length) throw new Error(`Dòng ${index + 2} thiếu ảnh: ${missing.join(", ")}.`);
        setProgress(`Đang chuẩn bị ảnh ${index + 1}/${rows.length}`);
        const images = await Promise.all(
          requested.slice(0, 10).map((name) => resizeImage(byName.get(name.toLowerCase())!)),
        );
        inputs.push({ ...blankInput(baseInput, row), images });
      }

      const results: Array<{ index: number; listing?: StoredListing | null; error?: string }> = [];
      const chunkSize = 4;
      for (let start = 0; start < inputs.length; start += chunkSize) {
        const chunk = inputs.slice(start, start + chunkSize);
        setProgress(`Đang tạo ${start + 1}-${Math.min(start + chunk.length, inputs.length)}/${inputs.length}`);
        const data = await responseJson<{
          results: Array<{ index: number; listing?: StoredListing | null; error?: string }>;
        }>(
          await fetch("/api/listings/batch", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({ items: chunk }),
          }),
        );
        results.push(...data.results.map((item) => ({ ...item, index: item.index + start })));
      }
      const succeeded = results.flatMap((item) => (item.listing ? [item.listing] : []));
      const failures = results.filter((item) => item.error);
      if (!succeeded.length) throw new Error(failures[0]?.error || "Không listing nào được tạo.");
      onComplete(succeeded);
      if (failures.length) {
        setError(`${succeeded.length} thành công, ${failures.length} lỗi. ${failures[0].error}`);
      } else {
        onClose();
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Không thể xử lý batch.");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <div className="fixed inset-0 z-[5] grid place-items-center bg-[#1f2931]/45 p-4" role="presentation">
      <section className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-[12px] border border-[#d8dde1] bg-white shadow-[0_24px_70px_rgba(31,41,49,0.24)]" role="dialog" aria-modal="true" aria-labelledby="batch-title">
        <header className="sticky top-0 flex items-center justify-between gap-4 border-b border-[#e1e5e8] bg-white px-5 py-4">
          <div>
            <h2 id="batch-title" className="text-sm font-bold text-[#222b32]">Batch listing</h2>
            <p className="mt-0.5 text-xs text-[#65717c]">Import tối đa 10 sản phẩm, ghép ảnh theo đúng filename.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="grid h-9 w-9 place-items-center rounded-lg text-[#65717c] hover:bg-[#f0f2f4]">
            <XIcon size={18} />
          </button>
        </header>

        <div className="grid gap-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f3f5f6] p-4">
            <div>
              <p className="text-sm font-bold text-[#303b44]">Chuẩn bị file import</p>
              <p className="mt-1 text-xs leading-5 text-[#65717c]">CSV mở được bằng Excel. Cột image_files dùng dấu | giữa nhiều ảnh.</p>
            </div>
            <button type="button" onClick={() => downloadText(buildBatchTemplateCsv(), "listing-batch-template.csv")} className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[#cfd5da] bg-white px-3 text-xs font-semibold text-[#39444d] hover:bg-[#fafafa]">
              <DownloadSimpleIcon size={16} /> Tải template
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex min-h-28 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#b9c1c7] p-4 hover:border-[#b84f1d] hover:bg-[#fff8f4]">
              <FileCsvIcon size={28} className="shrink-0 text-[#a24419]" />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[#39444d]">{fileName || "Chọn file CSV"}</span>
                <span className="mt-1 block text-xs text-[#65717c]">{rows.length ? `${rows.length} sản phẩm đã đọc` : "Theo template của hệ thống"}</span>
              </span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readCsv(event.target.files?.[0])} />
            </label>
            <label className="flex min-h-28 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#b9c1c7] p-4 hover:border-[#b84f1d] hover:bg-[#fff8f4]">
              <ImagesIcon size={28} className="shrink-0 text-[#a24419]" />
              <span>
                <span className="block text-sm font-bold text-[#39444d]">Chọn toàn bộ ảnh</span>
                <span className="mt-1 block text-xs text-[#65717c]">{imageFiles.length ? `${imageFiles.length} file đã chọn` : "JPG, PNG hoặc WEBP"}</span>
              </span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => setImageFiles(Array.from(event.target.files || []))} />
            </label>
          </div>

          {rows.length ? (
            <div className="overflow-x-auto rounded-lg border border-[#dfe3e6]">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead className="bg-[#f3f5f6] text-[#59656e]">
                  <tr><th className="px-3 py-2.5">Product</th><th className="px-3 py-2.5">Marketplace</th><th className="px-3 py-2.5">Keyword</th><th className="px-3 py-2.5">Images</th></tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.internal_name}-${index}`} className="border-t border-[#e7eaec] text-[#39444d]">
                      <td className="px-3 py-2.5 font-semibold">{row.internal_name || row.product_type}</td>
                      <td className="px-3 py-2.5">{row.marketplace}</td>
                      <td className="px-3 py-2.5">{row.main_keyword}</td>
                      <td className="max-w-56 truncate px-3 py-2.5" title={row.image_files}>{row.image_files}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? <div className="flex items-start gap-2 rounded-lg bg-[#fff3f0] p-3 text-xs leading-5 text-[#8e3021]" role="alert"><WarningCircleIcon className="mt-0.5 shrink-0" size={16} />{error}</div> : null}
          {progress ? <p className="text-xs font-semibold text-[#7d5113]" role="status">{progress}</p> : null}

          <div className="flex justify-end gap-2 border-t border-[#e1e5e8] pt-4">
            <button type="button" onClick={onClose} disabled={loading} className="h-10 whitespace-nowrap rounded-lg border border-[#cfd5da] bg-white px-4 text-sm font-semibold text-[#39444d] hover:bg-[#f5f6f7]">Hủy</button>
            <button type="button" onClick={run} disabled={loading || !rows.length || !imageFiles.length} className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c5c9cc]">
              <PlayIcon size={17} weight="fill" /> {loading ? "Đang xử lý..." : `Tạo ${rows.length || 0} listing`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
