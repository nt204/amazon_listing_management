"use client";

import {
  ArchiveTrayIcon,
  CaretRightIcon,
  CheckSquareIcon,
  ListPlusIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  SquaresFourIcon,
  StackIcon,
  TagIcon,
  KanbanIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { generateUUID } from "@/lib/uuid-client";
import { BatchImport } from "@/components/batch-import";
import { BrandManager } from "@/components/brand-manager";
import { ListingForm, type FormIssue } from "@/components/listing-form";
import { ResultPanel } from "@/components/result-panel";
import { TrelloBoardView } from "@/components/trello-board-view";
import { TrelloWorkspace } from "@/components/trello-workspace";
import { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL, type AiOptions } from "@/lib/models";
import type {
  BrandProfile,
  ListingContent,
  ListingInput,
  ListingSummary,
  StoredListing,
  WorkflowMetrics,
} from "@/lib/types";

const tinySamplePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJkAAAAASUVORK5CYII=";

const emptyInput: ListingInput = {
  marketplace: "US",
  product_type: "",
  internal_name: "",
  brand: "",
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
  main_keyword: "",
  related_keywords: [],
  backend_keywords: [],
  research: {
    target_customer: "",
    gift_giver: "",
    occasion: [],
    customer_insight: "",
    usp: "",
    competitor_asins: [],
    competitor_notes: "",
    notes: "",
  },
  images: [],
  configuration: {
    rule_profile: "",
    ai_provider: "auto",
    gemini_model: DEFAULT_GEMINI_MODEL,
    openai_model: DEFAULT_OPENAI_MODEL,
    language: "English",
    tone: "Persuasive, benefit-led, natural, and evidence-grounded",
    bullet_count: 5,
    title_length: 200,
    bullet_length: 300,
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
    gift_giver: "Coworkers, friends, and family",
    occasion: ["Birthday", "Nurse Week", "Graduation"],
    customer_insight: "Customers prefer humorous, practical, and giftable designs.",
    usp: "Original retro typography design",
    competitor_asins: [],
    competitor_notes: "",
    notes: "Dishwasher safe\nGift for RN\nDo not mention microwave\nTone: Funny",
  },
  images: [{ name: "sample-product.png", type: "image/png", data_url: tinySamplePng }],
};

const emptyMetrics: WorkflowMetrics = {
  total: 0,
  draft: 0,
  review: 0,
  approved: 0,
  exported: 0,
  with_errors: 0,
  missing_facts: 0,
};

async function getJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type QueueFilter = "all" | "review" | "missing" | "approved";

interface QueuePanelProps {
  className: string;
  history: ListingSummary[];
  metrics: WorkflowMetrics;
  filter: QueueFilter;
  onFilterChange: (filter: QueueFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  activeId?: string;
  action: string | null;
  onOpenListing: (id: string) => void;
  onExportSelected: () => void;
  onClose?: () => void;
}

function QueuePanel({
  className,
  history,
  metrics,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  selectedIds,
  onSelectedIdsChange,
  activeId,
  action,
  onOpenListing,
  onExportSelected,
  onClose,
}: QueuePanelProps) {
  return (
    <aside className={className} aria-label="Hàng đợi listing">
      <div className="border-b border-[#dfe3e6] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#39444d]"><SquaresFourIcon size={17} /> Hàng đợi chất lượng</div>
          {onClose ? <button type="button" onClick={onClose} aria-label="Đóng hàng đợi" className="grid h-8 w-8 place-items-center rounded-lg text-[#65717c] hover:bg-white"><XIcon size={17} /></button> : null}
        </div>
        <div className="relative mb-3">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a858e]" size={15} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="field-control min-h-9 py-2 pl-9 text-xs" placeholder="Tìm theo tên, keyword, loại..." aria-label="Tìm listing" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={filter === "review"} onClick={() => onFilterChange("review")} className={`rounded-lg p-2.5 text-left ${filter === "review" ? "bg-[#fff8f4] ring-1 ring-[#d99a7a]" : "bg-white"}`}><span className="block text-lg font-bold text-[#303b44]">{metrics.review}</span><span className="text-[10px] text-[#65717c]">Chờ review</span></button>
          <button type="button" aria-pressed={filter === "missing"} onClick={() => onFilterChange("missing")} className={`rounded-lg p-2.5 text-left ${filter === "missing" ? "bg-[#fff8f4] ring-1 ring-[#d99a7a]" : "bg-white"}`}><span className="block text-lg font-bold text-[#303b44]">{metrics.missing_facts}</span><span className="text-[10px] text-[#65717c]">Thiếu fact</span></button>
          <button type="button" aria-pressed={filter === "approved"} onClick={() => onFilterChange("approved")} className={`rounded-lg p-2.5 text-left ${filter === "approved" ? "bg-[#fff8f4] ring-1 ring-[#d99a7a]" : "bg-white"}`}><span className="block text-lg font-bold text-[#303b44]">{metrics.approved}</span><span className="text-[10px] text-[#65717c]">Đã duyệt</span></button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => onFilterChange("all")} className={`rounded-lg p-2.5 text-left ${filter === "all" ? "bg-[#fff8f4] ring-1 ring-[#d99a7a]" : "bg-white"}`}><span className="block text-lg font-bold text-[#303b44]">{metrics.total}</span><span className="text-[10px] text-[#65717c]">Tất cả</span></button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-[#dfe3e6] px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[#59656e]"><ArchiveTrayIcon size={16} /> {history.length} listings</div>
        {selectedIds.length ? <button type="button" onClick={onExportSelected} disabled={action === "batch-export"} className="text-[10px] font-bold text-[#983f18] hover:text-[#6f2c10]">Export {selectedIds.length}</button> : null}
      </div>
      <div className="thin-scrollbar flex-1 overflow-y-auto p-2.5">
        {history.length ? (
          <div className="grid gap-1.5">
            {history.map((item) => (
              <div key={item.id} className={`grid grid-cols-[24px_minmax(0,1fr)] rounded-lg border p-2.5 ${activeId === item.id ? "border-[#e1a587] bg-[#fff8f4]" : "border-transparent hover:border-[#d8dde1] hover:bg-white"}`}>
                <label className="pt-0.5" title={item.status === "Approved" ? "Chọn để export" : "Chỉ listing Approved mới export được"}>
                  <input type="checkbox" className="h-4 w-4 accent-[#b84f1d]" disabled={item.status !== "Approved"} checked={selectedIds.includes(item.id)} onChange={(event) => onSelectedIdsChange(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id))} />
                </label>
                <button type="button" onClick={() => onOpenListing(item.id)} className="min-w-0 text-left">
                  <div className="flex items-start gap-2"><PackageIcon className="mt-0.5 shrink-0 text-[#65717c]" size={15} /><span className="min-w-0 flex-1 truncate text-xs font-bold text-[#303b44]">{item.internal_name}</span><CaretRightIcon className="shrink-0 text-[#9aa2a9]" size={13} /></div>
                  {item.main_keyword && item.main_keyword.trim().toLowerCase() !== item.internal_name.trim().toLowerCase() ? <p className="mt-1 truncate pl-6 text-[10px] font-medium text-[#8a5b43]" title={item.main_keyword}>{item.main_keyword}</p> : null}
                  <div className="mt-2 flex items-center justify-between gap-2 pl-6 text-[10px] text-[#7a858e]"><span>{item.marketplace} / {item.product_type}</span><span>{item.status}</span></div>
                  {item.error_count || item.missing_fact_count ? <div className="mt-1.5 pl-6 text-[10px] text-[#96511f]">{item.error_count ? `${item.error_count} lỗi` : ""}{item.error_count && item.missing_fact_count ? ", " : ""}{item.missing_fact_count ? `${item.missing_fact_count} fact chưa dùng` : ""}</div> : null}
                </button>
              </div>
            ))}
          </div>
        ) : <p className="px-2 py-6 text-center text-xs leading-5 text-[#7a858e]">Không tìm thấy listing phù hợp.</p>}
      </div>
    </aside>
  );
}

export function ListingWorkspace() {
  const [input, setInput] = useState<ListingInput>(emptyInput);
  const [history, setHistory] = useState<ListingSummary[]>([]);
  const [metrics, setMetrics] = useState<WorkflowMetrics>(emptyMetrics);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [stored, setStored] = useState<StoredListing | null>(null);
  const [content, setContent] = useState<ListingContent | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [aiOptions, setAiOptions] = useState<AiOptions | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [queueQuery, setQueueQuery] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [brandManagerOpen, setBrandManagerOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [trelloOpen, setTrelloOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"trello" | "workspace">("trello");

  const refreshHistory = useCallback(async () => {
    try {
      const data = await getJson<{ listings: ListingSummary[]; metrics: WorkflowMetrics }>(
        await fetch("/api/listings"),
      );
      setHistory(data.listings);
      setMetrics(data.metrics);
    } catch {
      // The main work surface remains usable when the queue is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/listings")
      .then((response) => getJson<{ listings: ListingSummary[]; metrics: WorkflowMetrics }>(response))
      .then((data) => {
        if (active) {
          setHistory(data.listings);
          setMetrics(data.metrics);
        }
      })
      .catch(() => undefined);
    void fetch("/api/ai/options")
      .then((response) => getJson<AiOptions>(response))
      .then((data) => {
        if (active) {
          setAiOptions(data);
          setInput((current) => ({
            ...current,
            configuration: {
              ...current.configuration,
              rule_profile: data.listing_defaults.rule_profile,
              gemini_model: data.listing_defaults.gemini_model,
              openai_model: data.listing_defaults.openai_model,
              title_length: data.listing_defaults.title_length,
              bullet_length: data.listing_defaults.bullet_length,
              bullet_count: data.listing_defaults.bullet_count,
            },
          }));
        }
      })
      .catch(() => undefined);
    void fetch("/api/brands")
      .then((response) => getJson<{ brands: BrandProfile[] }>(response))
      .then((data) => {
        if (active) setBrands(data.brands);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const filteredHistory = useMemo(
    () =>
      history.filter((item) => {
        if (filter === "review") return item.status === "Review" || item.error_count > 0;
        if (filter === "missing") return item.missing_fact_count > 0;
        if (filter === "approved") return item.status === "Approved";
        return true;
      }).filter((item) => {
        const term = queueQuery.trim().toLowerCase();
        if (!term) return true;
        return [item.internal_name, item.main_keyword, item.product_type, item.marketplace, item.status]
          .join(" ")
          .toLowerCase()
          .includes(term);
      }),
    [filter, history, queueQuery],
  );

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
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": generateUUID(),
          },
          body: JSON.stringify({
            ...input,
            internal_name: input.internal_name.trim() || input.main_keyword.trim() || `${input.product_type} listing`,
          }),
        }),
      );
      setStored(data.listing);
      setContent(data.listing.current_listing);
      await refreshHistory();
      notify("Draft đã được tạo và kiểm tra.");
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
      notify("Đã lưu revision và kiểm tra lại định dạng.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save changes.");
    } finally {
      setAction(null);
    }
  };

  const revise = async (instruction: string) => {
    if (!stored) return false;
    setAction("revise");
    setError(null);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/revise`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": generateUUID(),
          },
          body: JSON.stringify({ instruction }),
        }),
      );
      setStored(data.listing);
      setContent(data.listing.current_listing);
      setEditing(false);
      await refreshHistory();
      notify("AI revision đã được lưu và kiểm tra lại.");
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not revise the listing.");
      return false;
    } finally {
      setAction(null);
    }
  };

  const submitReview = async () => {
    if (!stored) return;
    setAction("review");
    setError(null);
    try {
      const data = await getJson<{ listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/workflow`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Review" }),
        }),
      );
      setStored(data.listing);
      await refreshHistory();
      notify("Listing đã chuyển sang review.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update workflow status.");
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
      notify("Listing đã được duyệt.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not approve this listing.");
    } finally {
      setAction(null);
    }
  };

  const copy = async () => {
    if (!content) return;
    const formatted = [content.title, "", ...content.bullet_points.map((bullet, index) => `${index + 1}. ${bullet}`), "", content.description, "", `Generic keywords: ${content.backend_search_terms}`].join("\n");
    await navigator.clipboard.writeText(formatted);
    notify("Đã copy listing.");
  };

  const exportListing = async () => {
    if (!stored) return;
    setAction("export");
    setError(null);
    try {
      const data = await getJson<{ csv: string; filename: string; listing: StoredListing }>(
        await fetch(`/api/listings/${stored.id}/export`, { method: "POST" }),
      );
      downloadCsv(data.csv, data.filename);
      setStored(data.listing);
      await refreshHistory();
      notify("Đã xuất Listing Desk CSV.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not export this listing.");
    } finally {
      setAction(null);
    }
  };

  const exportSelected = async () => {
    if (!selectedIds.length) return;
    setAction("batch-export");
    setError(null);
    try {
      const data = await getJson<{ csv: string; filename: string }>(
        await fetch("/api/listings/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds }),
        }),
      );
      downloadCsv(data.csv, data.filename);
      setSelectedIds([]);
      await refreshHistory();
      notify("Đã xuất batch Listing Desk CSV.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not export selected listings.");
    } finally {
      setAction(null);
    }
  };

  const createNew = () => {
    setInput({ ...emptyInput, product_information: { ...emptyInput.product_information }, research: { ...emptyInput.research }, images: [], configuration: { ...emptyInput.configuration } });
    setStored(null);
    setContent(null);
    setIssues([]);
    setError(null);
    setEditing(false);
  };

  return (
    <main className="min-h-[100dvh] bg-[#f6f7f8]">
      <header className="flex h-16 items-center justify-between border-b border-[#d8dde1] bg-[#1f2931] px-4 text-white lg:px-5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#b84f1d] text-white"><CheckSquareIcon size={18} weight="fill" /></div>
            <div><p className="text-sm font-bold leading-4">Listing Desk</p><p className="mt-0.5 hidden text-[10px] text-[#b8c0c6] sm:block">Workflow & Trello Automation</p></div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-[#141c22] p-1 border border-[#3b4852]">
            <button
              type="button"
              onClick={() => setViewMode("trello")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                viewMode === "trello"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-[#b8c0c6] hover:bg-[#253039] hover:text-white"
              }`}
            >
              <KanbanIcon size={15} />
              <span>📌 Bảng Trello Kanban</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("workspace")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
                viewMode === "workspace"
                  ? "bg-[#b84f1d] text-white shadow-sm"
                  : "text-[#b8c0c6] hover:bg-[#253039] hover:text-white"
              }`}
            >
              <ListPlusIcon size={15} />
              <span>📝 Soạn Listing Thủ Công</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setQueueOpen(true)} className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[#59636b] bg-[#2a353e] px-3 text-xs font-semibold text-white hover:bg-[#34414b] xl:hidden"><ArchiveTrayIcon size={16} /><span className="hidden sm:inline">Listings</span><span className="rounded bg-[#3b4852] px-1.5 py-0.5 text-[10px]">{metrics.total}</span></button>
          <button type="button" onClick={() => setBrandManagerOpen(true)} className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[#59636b] bg-[#2a353e] px-3 text-xs font-semibold text-white hover:bg-[#34414b] sm:inline-flex"><TagIcon size={16} /> Brands</button>
          <button type="button" onClick={() => setBatchOpen(true)} aria-label="Batch import" className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-[#59636b] bg-[#2a353e] px-3 text-xs font-semibold text-white hover:bg-[#34414b] sm:inline-flex"><StackIcon size={16} /> Batch</button>
          <button type="button" onClick={createNew} aria-label="Tạo listing mới" className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-[#b84f1d] px-2.5 text-xs font-bold text-white hover:bg-[#963f17] active:translate-y-px sm:px-3"><ListPlusIcon size={17} /><span className="hidden sm:inline">New</span></button>
        </div>
      </header>

      {error ? <div className="fixed left-1/2 top-20 z-[3] flex w-[min(92vw,620px)] -translate-x-1/2 items-start gap-3 rounded-[10px] border border-[#e7b9b4] bg-[#fff5f3] p-3.5 shadow-[0_12px_34px_rgba(76,32,26,0.16)]" role="alert"><WarningCircleIcon className="mt-0.5 shrink-0 text-[#b32921]" size={19} weight="fill" /><p className="flex-1 text-sm leading-5 text-[#73271f]">{error}</p><button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="text-[#73271f] hover:text-[#43130f]"><XIcon size={17} /></button></div> : null}
      {toast ? <div className="fixed bottom-5 left-1/2 z-[3] -translate-x-1/2 rounded-lg bg-[#263139] px-4 py-2.5 text-sm font-semibold text-white shadow-lg" role="status">{toast}</div> : null}

      {queueOpen ? (
        <div className="fixed inset-0 z-[4] xl:hidden">
          <button type="button" className="absolute inset-0 bg-[#172028]/45" onClick={() => setQueueOpen(false)} aria-label="Đóng hàng đợi listing" />
          <QueuePanel
            className="thin-scrollbar relative flex h-full w-[min(88vw,340px)] flex-col bg-[#f0f2f4] shadow-[18px_0_48px_rgba(24,31,36,0.2)]"
            history={filteredHistory}
            metrics={metrics}
            filter={filter}
            onFilterChange={setFilter}
            query={queueQuery}
            onQueryChange={setQueueQuery}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            activeId={stored?.id}
            action={action}
            onOpenListing={(id) => { setQueueOpen(false); void openListing(id); setViewMode("workspace"); }}
            onExportSelected={() => void exportSelected()}
            onClose={() => setQueueOpen(false)}
          />
        </div>
      ) : null}

      {viewMode === "trello" ? (
        <div className="h-[calc(100dvh-64px)] w-full">
          <TrelloBoardView
            brands={brands}
            onListingCreated={(listing) => {
              setStored(listing);
              setContent(listing.current_listing);
              void refreshHistory();
              notify(`Listing cho SKU ${listing.input.internal_name} đã được tạo.`);
            }}
            onSelectListing={(listing) => {
              setStored(listing);
              setContent(listing.current_listing);
            }}
          />
        </div>
      ) : (
        <div className="grid min-h-[calc(100dvh-64px)] grid-cols-[minmax(0,1fr)] lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[286px_400px_minmax(0,1fr)]">
          <QueuePanel
            className="thin-scrollbar hidden min-h-0 flex-col border-r border-[#dfe3e6] bg-[#f0f2f4] xl:flex xl:max-h-[calc(100dvh-64px)]"
            history={filteredHistory}
            metrics={metrics}
            filter={filter}
            onFilterChange={setFilter}
            query={queueQuery}
            onQueryChange={setQueueQuery}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            activeId={stored?.id}
            action={action}
            onOpenListing={(id) => { void openListing(id); setViewMode("workspace"); }}
            onExportSelected={() => void exportSelected()}
          />

          <div className={stored ? "hidden lg:contents" : "contents"}>
            <ListingForm value={input} onChange={setInput} onSubmit={handleGenerate} onLoadSample={() => { setInput(sampleInput); setIssues([]); }} loading={loading} issues={issues} aiOptions={aiOptions} brands={brands} />
          </div>

          <ResultPanel key={stored?.id || "empty"} stored={stored} content={content} editing={editing} loading={loading} action={action} onContentChange={setContent} onEdit={() => setEditing(true)} onCancelEdit={() => { setContent(stored?.current_listing || null); setEditing(false); }} onSave={save} onSubmitReview={submitReview} onApprove={approve} onExport={exportListing} onCopy={copy} onRevise={revise} />
        </div>
      )}

      <BrandManager open={brandManagerOpen} brands={brands} onClose={() => setBrandManagerOpen(false)} onSaved={(brand) => { setBrands((current) => [...current.filter((item) => item.id !== brand.id), brand].sort((a, b) => a.name.localeCompare(b.name))); notify("Brand profile đã được lưu."); }} />
      {batchOpen ? <BatchImport open baseInput={input} brands={brands} onBrandSaved={(brand) => { setBrands((current) => [...current.filter((item) => item.id !== brand.id), brand].sort((a, b) => a.name.localeCompare(b.name))); notify(`Đã lưu Brand ${brand.name}.`); }} onClose={() => setBatchOpen(false)} onComplete={(listings) => { const first = listings[0]; setStored(first); setContent(first.current_listing); void refreshHistory(); notify(`${listings.length} listing đã được tạo.`); }} /> : null}
      <TrelloWorkspace open={trelloOpen} brands={brands} onClose={() => setTrelloOpen(false)} onListingCreated={(listing) => { setStored(listing); setContent(listing.current_listing); void refreshHistory(); notify(`Listing cho SKU ${listing.input.internal_name} đã được tạo.`); }} />
    </main>
  );
}
