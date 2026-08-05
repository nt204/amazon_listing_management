"use client";

import {
  ArchiveTrayIcon,
  CaretLeftIcon,
  ListPlusIcon,
  PackageIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { ListingForm, type FormIssue } from "@/components/listing-form";
import { ResultPanel } from "@/components/result-panel";
import type {
  ListingContent,
  ListingInput,
  ListingSummary,
  StoredListing,
} from "@/lib/types";
import type { AiOptions } from "@/lib/models";

const tinySamplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

const emptyInput: ListingInput = {
  marketplace: "US",
  product_type: "",
  internal_name: "",
  brand: "",
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
  main_keyword: "",
  related_keywords: [],
  backend_keywords: [],
  research: {
    target_customer: "",
    occasion: [],
    customer_insight: "",
    usp: "",
    competitor_asins: [],
    competitor_notes: "",
    notes: "",
  },
  images: [],
  configuration: {
    ai_provider: "auto",
    gemini_model: "gemini-3.6-flash",
    openai_model: "gpt-5.6-terra",
    language: "English",
    tone: "Clear, factual, and natural",
    bullet_count: 5,
    title_length: 180,
    bullet_length: 250,
    generate_description: true,
    generate_search_terms: true,
  },
};

const sampleInput: ListingInput = {
  ...emptyInput,
  product_type: "Mug",
  internal_name: "Retro Nurse Appreciation Mug",
  brand: "North Pine Gifts",
  product_information: {
    ...emptyInput.product_information,
    material: "Ceramic",
    size_capacity: "11 oz",
    color: "White",
    package_contents: "1 ceramic mug",
    features: ["Original retro typography design", "Printed on both sides"],
    care_instructions: "Hand wash recommended",
  },
  main_keyword: "funny nurse mug",
  related_keywords: ["nurse coffee mug", "registered nurse gift", "nurse graduation gift", "nurse week gift"],
  backend_keywords: ["healthcare worker appreciation", "rn coworker present"],
  research: {
    target_customer: "Registered nurses and nursing students",
    occasion: ["Birthday", "Nurse Week", "Graduation"],
    customer_insight: "Customers prefer humorous, practical, and giftable designs.",
    usp: "Original retro typography design",
    competitor_asins: [],
    competitor_notes: "",
    notes: "Dishwasher safe\nGift for RN\nDo not mention microwave\nTone: Funny",
  },
  images: [{ name: "sample-product.png", type: "image/png", data_url: tinySamplePng }],
};

async function getJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

export function ListingWorkspace() {
  const [input, setInput] = useState<ListingInput>(emptyInput);
  const [history, setHistory] = useState<ListingSummary[]>([]);
  const [stored, setStored] = useState<StoredListing | null>(null);
  const [content, setContent] = useState<ListingContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [aiOptions, setAiOptions] = useState<AiOptions | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const data = await getJson<{ listings: ListingSummary[] }>(await fetch("/api/listings"));
      setHistory(data.listings);
    } catch {
      // The primary work surface remains usable if history cannot be loaded.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/listings")
      .then((response) => getJson<{ listings: ListingSummary[] }>(response))
      .then((data) => {
        if (active) setHistory(data.listings);
      })
      .catch(() => undefined);
    void fetch("/api/ai/options")
      .then((response) => getJson<AiOptions>(response))
      .then((data) => {
        if (active) setAiOptions(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2_800);
  };

  const validate = () => {
    const nextIssues: FormIssue[] = [];
    if (!input.product_type.trim()) nextIssues.push({ field: "product_type", message: "Hãy chọn loại sản phẩm." });
    if (!input.main_keyword.trim()) nextIssues.push({ field: "main_keyword", message: "Hãy nhập từ khóa chính." });
    if (!input.images.length) nextIssues.push({ field: "images", message: "Hãy tải ít nhất một ảnh sản phẩm." });
    setIssues(nextIssues);
    return nextIssues.length === 0;
  };

  const handleGenerate = async () => {
    setError(null);
    if (!validate()) return;
    setLoading(true);
    setEditing(false);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch("/api/listings/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            internal_name:
              input.internal_name.trim() || input.main_keyword.trim() || `${input.product_type} listing`,
          }),
        }),
      );
      setStored(data.listing);
      setContent(data.listing.current_listing);
      await refreshHistory();
      notify("Listing generated and saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not generate the listing.");
    } finally {
      setLoading(false);
    }
  };

  const openListing = async (id: string) => {
    setError(null);
    setAction("open");
    try {
      const data = await getJson<{ listing: StoredListing }>(await fetch(`/api/listings/${id}`));
      setStored(data.listing);
      setContent(data.listing.current_listing);
      setEditing(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not open the listing.");
    } finally {
      setAction(null);
    }
  };

  const save = async () => {
    if (!stored || !content) return;
    setAction("save");
    setError(null);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listing: content }),
        }),
      );
      setStored(data.listing);
      setContent(data.listing.current_listing);
      setEditing(false);
      await refreshHistory();
      notify("Changes saved and revalidated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save changes.");
    } finally {
      setAction(null);
    }
  };

  const regenerate = async (field: keyof ListingContent) => {
    if (!stored) return;
    setAction(field);
    setError(null);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field }),
        }),
      );
      setStored(data.listing);
      setContent(data.listing.current_listing);
      setEditing(false);
      await refreshHistory();
      notify("Field regenerated and revalidated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not regenerate this field.");
    } finally {
      setAction(null);
    }
  };

  const approve = async () => {
    if (!stored) return;
    setAction("approve");
    setError(null);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/approve`, { method: "POST" }),
      );
      setStored(data.listing);
      await refreshHistory();
      notify("Listing approved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not approve this listing.");
    } finally {
      setAction(null);
    }
  };

  const copy = async () => {
    if (!content) return;
    const formatted = [
      content.title,
      "",
      ...content.bullet_points.map((bullet, index) => `${index + 1}. ${bullet}`),
      "",
      content.description,
      "",
      `Backend search terms: ${content.backend_search_terms}`,
    ].join("\n");
    await navigator.clipboard.writeText(formatted);
    notify("Listing copied to clipboard.");
  };

  const exportListing = async () => {
    if (!stored || !content) return;
    const payload = { ...stored.result, listing: content, status: stored.status };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${stored.input.internal_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "listing"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/export`, { method: "POST" }),
      );
      setStored(data.listing);
      await refreshHistory();
    } catch {
      // The downloaded file is still valid if status tracking fails.
    }
    notify("JSON export downloaded.");
  };

  const createNew = () => {
    setInput(emptyInput);
    setStored(null);
    setContent(null);
    setIssues([]);
    setError(null);
    setEditing(false);
  };

  return (
    <main className="min-h-[100dvh] bg-[#f6f7f8]">
      <header className="flex h-16 items-center justify-between border-b border-[#d8dde1] bg-[#1f2931] px-4 text-white lg:px-5">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#b84f1d] text-white">
            <SparkleIcon size={18} weight="fill" />
          </div>
          <div>
            <p className="text-sm font-bold leading-4">Listing Desk</p>
            <p className="mt-0.5 text-[10px] text-[#b8c0c6]">Amazon content workspace</p>
          </div>
        </div>
        <button
          type="button"
          onClick={createNew}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#59636b] bg-[#2a353e] px-3 text-xs font-semibold text-white hover:bg-[#34414b] active:translate-y-px"
        >
          <ListPlusIcon size={17} /> New listing
        </button>
      </header>

      {error ? (
        <div className="fixed left-1/2 top-20 z-[3] flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-[10px] border border-[#e7b9b4] bg-[#fff5f3] p-3.5 shadow-[0_12px_34px_rgba(76,32,26,0.16)]" role="alert">
          <WarningCircleIcon className="mt-0.5 shrink-0 text-[#b32921]" size={19} weight="fill" />
          <p className="flex-1 text-sm leading-5 text-[#73271f]">{error}</p>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="text-[#73271f] hover:text-[#43130f]">
            <XIcon size={17} />
          </button>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-[3] -translate-x-1/2 rounded-lg bg-[#263139] px-4 py-2.5 text-sm font-semibold text-white shadow-lg" role="status">
          {toast}
        </div>
      ) : null}

      <div className="grid min-h-[calc(100dvh-64px)] grid-cols-[minmax(0,1fr)] lg:grid-cols-[430px_minmax(0,1fr)] xl:grid-cols-[230px_430px_minmax(0,1fr)]">
        <aside className="thin-scrollbar hidden min-h-0 flex-col border-r border-[#dfe3e6] bg-[#f0f2f4] xl:flex xl:max-h-[calc(100dvh-64px)]">
          <div className="flex items-center justify-between border-b border-[#dfe3e6] px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#39444d]">
              <ArchiveTrayIcon size={17} /> History
            </div>
            <span className="text-[11px] font-semibold text-[#7a858e]">{history.length}</span>
          </div>
          <div className="thin-scrollbar flex-1 overflow-y-auto p-2.5">
            {history.length ? (
              <div className="grid gap-1.5">
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openListing(item.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${stored?.id === item.id ? "border-[#e1a587] bg-[#fff8f4]" : "border-transparent hover:border-[#d8dde1] hover:bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <PackageIcon className="mt-0.5 shrink-0 text-[#65717c]" size={16} />
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#303b44]">{item.internal_name}</span>
                      <CaretLeftIcon className="rotate-180 text-[#9aa2a9]" size={13} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 pl-6 text-[10px] text-[#7a858e]">
                      <span>{item.marketplace} / {item.product_type}</span>
                      <span className="truncate">{item.status}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 py-6 text-center text-xs leading-5 text-[#7a858e]">Generated listings will be saved here.</p>
            )}
          </div>
        </aside>

        <ListingForm
          value={input}
          onChange={setInput}
          onSubmit={handleGenerate}
          onLoadSample={() => {
            setInput(sampleInput);
            setIssues([]);
          }}
          loading={loading}
          issues={issues}
          aiOptions={aiOptions}
        />

        <ResultPanel
          stored={stored}
          content={content}
          editing={editing}
          loading={loading}
          action={action}
          onContentChange={setContent}
          onEdit={() => setEditing(true)}
          onCancelEdit={() => {
            setContent(stored?.current_listing || null);
            setEditing(false);
          }}
          onSave={save}
          onApprove={approve}
          onExport={exportListing}
          onCopy={copy}
          onRegenerate={regenerate}
        />
      </div>
    </main>
  );
}
