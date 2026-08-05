"use client";

import { FloppyDiskIcon, TagIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Field, TextArea, TextInput } from "@/components/ui";
import type { BrandProfile } from "@/lib/types";

interface BrandManagerProps {
  open: boolean;
  brands: BrandProfile[];
  onClose: () => void;
  onSaved: (brand: BrandProfile) => void;
}
async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not save the brand profile.");
  return body;
}

export function BrandManager({ open, brands, onClose, onSaved }: BrandManagerProps) {
  const [name, setName] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await responseJson<{ brand: BrandProfile }>(
        await fetch("/api/brands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, guidelines }),
        }),
      );
      onSaved(data.brand);
      setName("");
      setGuidelines("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save brand profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[5] grid place-items-center bg-[#1f2931]/45 p-4" role="presentation">
      <section
        className="max-h-[min(760px,90dvh)] w-full max-w-2xl overflow-y-auto rounded-[12px] border border-[#d8dde1] bg-white shadow-[0_24px_70px_rgba(31,41,49,0.24)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-manager-title"
      >
        <header className="sticky top-0 flex items-center justify-between gap-4 border-b border-[#e1e5e8] bg-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <TagIcon size={19} className="text-[#a24419]" />
            <div>
              <h2 id="brand-manager-title" className="text-sm font-bold text-[#222b32]">Brand profiles</h2>
              <p className="mt-0.5 text-xs text-[#65717c]">Dùng chung tên brand và quy tắc viết cho cả team.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="grid h-9 w-9 place-items-center rounded-lg text-[#65717c] hover:bg-[#f0f2f4]">
            <XIcon size={18} />
          </button>
        </header>

        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <h3 className="mb-3 text-xs font-bold text-[#39444d]">Đã lưu ({brands.length})</h3>
            {brands.length ? (
              <div className="grid gap-2">
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => {
                      setName(brand.name);
                      setGuidelines(brand.guidelines);
                    }}
                    className="rounded-lg border border-[#dfe3e6] p-3 text-left hover:border-[#d69a7d] hover:bg-[#fff8f4]"
                  >
                    <p className="text-sm font-bold text-[#303b44]">{brand.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#65717c]">
                      {brand.guidelines || "Chưa có quy tắc brand."}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-[#f4f6f7] p-4 text-xs leading-5 text-[#65717c]">Chưa có brand profile.</p>
            )}
          </div>

          <div className="grid content-start gap-4">
            <Field label="Tên brand" htmlFor="profile_name" required>
              <TextInput id="profile_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Limima" />
            </Field>
            <Field label="Quy tắc dùng chung" htmlFor="profile_guidelines" hint="Chỉ ghi tone, cách dùng tên brand và quy tắc nội dung. Product facts vẫn nhập theo từng sản phẩm.">
              <TextArea
                id="profile_guidelines"
                rows={8}
                value={guidelines}
                onChange={(event) => setGuidelines(event.target.value)}
                placeholder={"Use Limima once at the start of the title.\nTone: factual and concise.\nAvoid exaggerated gift language."}
              />
            </Field>
            {error ? <p className="text-xs leading-5 text-[#b32921]" role="alert">{error}</p> : null}
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#b84f1d] px-4 text-sm font-bold text-white hover:bg-[#963f17] active:translate-y-px disabled:bg-[#c5c9cc]"
            >
              <FloppyDiskIcon size={17} /> {saving ? "Đang lưu..." : "Lưu profile"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
