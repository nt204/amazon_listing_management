/* eslint-disable @next/next/no-img-element -- ảnh mockup qua mockup-proxy, đã nén sẵn */
"use client";

// Lên camp SKU mới — giao diện giữ nguyên bố cục và thao tác của tool NCE-Campaign-Auto-Web:
// chọn SKU từ BẢNG MÃ, file keyword (upload / chọn từ kho / tạo từ list), file ASIN Crawl,
// chọn dạng chạy SP03 / SB01 / SB05 / SP04 / FL Asin rồi tải file zip bulk.
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowsClockwise, CaretDown, Check, CheckCircle, CircleNotch, CloudArrowUp, DownloadSimple, FileXls, FolderOpen, GearSix, ImageSquare, MagnifyingGlass, PencilSimple, Plus, RocketLaunch, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import type { NewCampSkuInfo, PlannedCampaign } from "@/lib/ppc/new-camp-generator";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import {
  SB_FIELDS,
  SB_FIELD_LABELS,
  SB_FIELD_PLACEHOLDERS,
  missingSbFields,
  sbFieldValue,
  isWinStatus,
  isStoppedStatus,
  BIDDING_STRATEGIES,
  DEFAULT_ADVANCED,
  NAME_FIELDS,
  NAME_FIELD_LABELS,
  buildCampaignName,
  type AdvancedOptions,
  type BiddingStrategy,
  type NameField,
  type NameOverrides,
  type SbField,
  type SbOverrides,
} from "@/lib/ppc/new-camp-fields";

type LoaiHinh = "FBM" | "FBA";
type KwMode = "none" | "upload" | "library" | "create";
type MatchKey = "sp03" | "sb01" | "sb05";
interface MatchRun { run: boolean; exact: boolean; phrase: boolean; broad: boolean; dailyBudget: string }
interface KwName { user: string; niche: string; phoi: string; set: string }
/** Phần người dùng tự sửa; ô chưa sửa (undefined) thì lấy giá trị tự điền */
type KwNameEdits = Partial<KwName>;
interface DraftPart { name: string; text: string }
interface KwPart { name: string; keywords: string[]; bids: string[] }
interface Notice { kind: "success" | "error" | "info"; text: string }

const partLabel = (i: number) => `Part ${String(i + 1).padStart(2, "0")}`;
const NEW_DRAFT: DraftPart[] = [{ name: partLabel(0), text: "" }];
const MATCH_GROUPS: Array<{ key: MatchKey; label: string; budgetLabel: string }> = [
  { key: "sp03", label: "SP03 KW", budgetLabel: "Daily Budget" },
  { key: "sb01", label: "SB01 CK KW (Collection)", budgetLabel: "Daily Budget" },
  { key: "sb05", label: "SB05 VIDEO", budgetLabel: "Daily Budget" },
];
const SKU_INFO_FIELDS: Array<{ key: keyof NewCampSkuInfo; label: string }> = [
  { key: "productType", label: "Phôi" },
  { key: "niche", label: "Ngách" },
  { key: "picMkt", label: "PIC MKT" },
  { key: "storeName", label: "Store" },
  { key: "status", label: "Trạng thái" },
  { key: "brandEntityId", label: "Brand Entity ID" },
  { key: "brand", label: "Brand Name" },
  { key: "brandLogoAssetId", label: "Brand Logo Asset ID" },
  { key: "creativeAsinsCollection", label: "Creative ASINs (Col)" },
  { key: "creativeAsinsVideo", label: "Creative ASINs (Vid)" },
  { key: "creativeHeadline", label: "Creative Headline" },
  { key: "videoMediaIds", label: "Video Media IDs" },
  { key: "landingPageUrl", label: "Landing Page URL" },
];

// Màu viền tách riêng để ô lỗi đổi được màu (2 class border-* cùng lúc thì không chắc class nào thắng).
const inputBase =
  "w-full rounded-lg border px-3 py-2 text-sm font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const inputCls = `${inputBase} border-slate-300 bg-white`;
const cellInputBase =
  "w-full rounded-md border px-2.5 py-1.5 text-sm font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const cardCls = "rounded-2xl border border-slate-200 bg-white shadow-sm";
const labelCls = "mb-1.5 block text-[13px] font-bold text-slate-700";

function todayVn(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

function normalizeKeywordList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const kw = line.trim().replace(/\s+/g, " ");
    const key = kw.toLowerCase();
    if (kw && !seen.has(key)) {
      seen.add(key);
      out.push(kw);
    }
  }
  return out;
}

function Section({ step, title, right, children, className = "", bodyClassName = "" }: { step?: number; title: string; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`${cardCls} ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="flex items-center gap-2.5 text-[15px] font-extrabold text-slate-900">
          {step !== undefined && (
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-[13px] font-black text-white shadow-sm shadow-indigo-200">{step}</span>
          )}
          {title}
        </h2>
        {right}
      </header>
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode }>;
  onChange: (v: T) => void;
  disabled?: (v: T) => boolean;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => {
        const off = disabled?.(o.value) ?? false;
        return (
          <button
            key={o.value}
            type="button"
            disabled={off}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-bold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
              value === o.value ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FilePicker({ inputRef, onPick, accept = ".xlsx", label = "Chọn file Excel (.xlsx)" }: { inputRef?: React.RefObject<HTMLInputElement | null>; onPick: (f: File | null) => void; accept?: string; label?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-indigo-400 hover:bg-indigo-50/60">
      <UploadSimple size={20} weight="bold" className="text-indigo-600" />
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
    </label>
  );
}

function NameFields({ value, edits, onChange }: { value: KwName; edits: KwNameEdits; onChange: (v: KwNameEdits) => void }) {
  const fields: Array<{ key: keyof KwName; label: string }> = [
    { key: "user", label: "Người lên camp" },
    { key: "niche", label: "Ngách" },
    { key: "phoi", label: "Phôi" },
    { key: "set", label: "Bộ keyword" },
  ];
  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <p className="mb-3 text-[13px] font-extrabold text-indigo-900">Lưu vào kho keyword</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className={labelCls}>{f.label}</span>
            <input
              className={`${inputBase} ${value[f.key].trim() ? "border-slate-300 bg-white" : "border-rose-400 bg-rose-50"}`}
              value={value[f.key]}
              onChange={(e) => onChange({ ...edits, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SelectedChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
      <span className="flex min-w-0 items-center gap-2">
        <FileXls size={20} weight="fill" className="shrink-0 text-emerald-600" />
        <span className="truncate font-bold">{label}</span>
      </span>
      <button type="button" onClick={onClear} className="shrink-0 rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100 cursor-pointer" title="Bỏ chọn file này">
        <X size={16} weight="bold" />
      </button>
    </div>
  );
}

/** Thẻ 1 dạng chạy: tắt thì thu gọn, bật thì mở phần cài đặt. */
function RunCard({ title, on, onToggle, children }: { title: string; on: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-xl border-2 transition ${on ? "border-indigo-500 shadow-sm shadow-indigo-100" : "border-slate-200 hover:border-slate-300"}`}>
      <button type="button" onClick={() => onToggle(!on)} className={`flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer ${on ? "bg-indigo-50" : "bg-white"}`}>
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"}`}>
          {on && <Check size={12} weight="bold" />}
        </span>
        <span className={`text-sm font-extrabold ${on ? "text-indigo-900" : "text-slate-800"}`}>{title}</span>
      </button>
      {on && <div className="border-t border-indigo-100 bg-white px-4 py-4">{children}</div>}
    </div>
  );
}

/** Ảnh mockup SKU: rê chuột để xem ảnh to (portal ra body để không bị khung cuộn cắt). */
function MockupThumb({ url, size = 36 }: { url?: string; size?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const thumb = getOptimizedThumbnailUrl(url, size * 2);
  const big = getOptimizedThumbnailUrl(url, 400);
  if (!thumb) {
    return (
      <span
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300"
      >
        <ImageSquare size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return (
    <>
      <img
        src={thumb}
        alt=""
        loading="lazy"
        style={{ width: size, height: size }}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const box = 260;
          setPos({ x: Math.min(r.right + 10, window.innerWidth - box - 8), y: Math.max(8, Math.min(window.innerHeight - box - 8, r.top + r.height / 2 - box / 2)) });
        }}
        onMouseLeave={() => setPos(null)}
        className="shrink-0 rounded-lg border border-slate-200 bg-white object-cover"
      />
      {pos &&
        createPortal(
          <span className="pointer-events-none fixed z-[1000] block h-[260px] w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl" style={{ left: pos.x, top: pos.y }}>
            <img src={big || thumb} alt="" className="h-full w-full rounded-lg object-contain" />
          </span>,
          document.body,
        )}
    </>
  );
}

/** Brand Entity ID theo store: lưu trên server, Enter / rời ô là lưu. */
function StoreEntityEditor({ onSaved }: { onSaved: (store: string, entity: string) => void }) {
  const [rows, setRows] = useState<Array<{ store: string; brandEntityId: string }>>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/ppc/new-camp/brand-entities", { cache: "no-store" }).catch(() => null);
      const json = res && res.ok ? await res.json().catch(() => ({})) : {};
      if (!cancelled) setRows(Array.isArray(json.data) ? json.data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const save = async (store: string) => {
    const value = (drafts[store] ?? "").trim().toUpperCase();
    const current = rows.find((r) => r.store === store)?.brandEntityId ?? "";
    if (drafts[store] === undefined || value === current) return;
    setStatus((p) => ({ ...p, [store]: "saving" }));
    const res = await fetch("/api/ppc/new-camp/brand-entities", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, brandEntityId: value }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setRows(json.data || rows);
      setDrafts((p) => { const n = { ...p }; delete n[store]; return n; });
      setStatus((p) => ({ ...p, [store]: "saved" }));
      onSaved(store, value);
    } else {
      setStatus((p) => ({ ...p, [store]: json.error || "Lỗi lưu" }));
    }
  };
  return (
    <div className="border-t border-slate-100 px-4 py-4">
      <p className="mb-2.5 text-[13px] font-extrabold text-slate-800">Brand Entity ID theo store</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const st = status[r.store];
          const value = drafts[r.store] ?? r.brandEntityId;
          return (
            <label key={r.store} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs font-bold text-slate-600">{r.store}</span>
              <input
                className={`${cellInputBase} font-mono ${st && st !== "saving" && st !== "saved" ? "border-rose-400 bg-rose-50" : value ? "border-slate-300 bg-white" : "border-amber-400 bg-amber-50"}`}
                placeholder="ENTITY…"
                value={value}
                onChange={(e) => setDrafts((p) => ({ ...p, [r.store]: e.target.value }))}
                onBlur={() => void save(r.store)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                title={st && st !== "saving" && st !== "saved" ? st : undefined}
              />
              <span className="w-4 shrink-0">
                {st === "saving" ? <CircleNotch size={14} className="animate-spin text-slate-400" /> : st === "saved" ? <CheckCircle size={14} weight="fill" className="text-emerald-600" /> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

type SkuRow = NewCampSkuInfo & { channel: LoaiHinh };

function ChannelBadge({ channel }: { channel: LoaiHinh }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${channel === "FBA" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>{channel}</span>
  );
}

/** Win = "Phát triển"; Hủy / OFF / Cũ hiện đỏ; còn lại Test */
function StatusBadge({ status }: { status?: string }) {
  if (isWinStatus(status)) return <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">WIN</span>;
  if (isStoppedStatus(status)) return <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">{(status || "").toUpperCase()}</span>;
  return <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600" title={status || undefined}>TEST</span>;
}

function MoneyInput({ label, value, onChange, step = "1" }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">$</span>
        <input type="number" step={step} className={`${inputCls} pl-6`} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

export function PpcNewCampView() {
  // --- Cấu hình chung ---
  // Trạng thái: "Auto" = theo Bảng mã từng SKU ("Phát triển" = Win), hoặc chọn tay Test / Win
  const [trangThai, setTrangThai] = useState<"Auto" | "Test" | "Win">("Auto");
  const [ngay, setNgay] = useState(todayVn());
  const [allSkus, setAllSkus] = useState<SkuRow[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuSearch, setSkuSearch] = useState("");
  const [bulkSkus, setBulkSkus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeSku, setActiveSku] = useState<string | null>(null);

  // --- File keyword ---
  const [kwMode, setKwMode] = useState<KwMode>("none");
  const [kwTab, setKwTab] = useState<Exclude<KwMode, "none">>("upload");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState<KwNameEdits>({});
  const [libQuery, setLibQuery] = useState("");
  const [libResults, setLibResults] = useState<{ query: string; items: Array<{ id: number; name: string }> } | null>(null);
  const [libSearching, setLibSearching] = useState(false);
  const [libFile, setLibFile] = useState<{ id: number; name: string } | null>(null);
  // Tạo mới: nhiều part, mỗi part một ô dán keyword → bảng điền bid
  const [draftParts, setDraftParts] = useState<DraftPart[]>(NEW_DRAFT);
  const [kwParts, setKwParts] = useState<KwPart[]>([]);
  const [createName, setCreateName] = useState<KwNameEdits>({});
  const [bidErrors, setBidErrors] = useState<Set<string>>(new Set());
  const [bulkBid, setBulkBid] = useState("");
  // Điền cùng 1 bid cho mọi keyword (ghi đè bid đang có)
  const applyBulkBid = () => {
    const v = bulkBid.trim();
    if (!v) return;
    setKwParts((prev) => prev.map((p) => ({ ...p, bids: p.bids.map(() => v) })));
    setBidErrors(new Set());
  };
  const kwFileRef = useRef<HTMLInputElement>(null);

  // --- File ASIN ---
  const [asinFile, setAsinFile] = useState<File | null>(null);
  const asinFileRef = useRef<HTMLInputElement>(null);

  // --- Dạng chạy ---
  const [match, setMatch] = useState<Record<MatchKey, MatchRun>>({
    sp03: { run: false, exact: false, phrase: false, broad: false, dailyBudget: "5" },
    sb01: { run: false, exact: false, phrase: false, broad: false, dailyBudget: "5" },
    sb05: { run: false, exact: false, phrase: false, broad: false, dailyBudget: "5" },
  });
  const [sp04, setSp04] = useState({ run: false, dailyBudget: "5", bidClose: "0.36", bidLoose: "0.36", bidComp: "0.36", bidSub: "0.36" });
  const [flasin, setFlasin] = useState({ run: false, dailyBudget: "5", bid: "0.21" });

  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  // Thông tin SB điền bổ sung cho SKU thiếu (theo SKU viết hoa); chỉ dùng cho file lần này.
  const [sbOverrides, setSbOverrides] = useState<SbOverrides>({});
  const [sbBulk, setSbBulk] = useState<Partial<Record<SbField, string>>>({});
  // Tên camp: đuôi tên, gộp dấu cách, sửa Phôi / Ngách / PIC theo SKU (chỉ dùng cho file lần này)
  const [naming, setNaming] = useState({ suffix: "", collapseSpaces: true });
  const [nameOverrides, setNameOverrides] = useState<NameOverrides>({});
  // Tuỳ chỉnh nâng cao: mặc định = tool cũ
  const [advanced, setAdvanced] = useState<AdvancedOptions>(DEFAULT_ADVANCED);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Danh sách camp xem trước (server ghép tên y như lúc tạo file) + tên sửa tay theo mã camp
  const [preview, setPreview] = useState<{ campaigns: PlannedCampaign[]; kwMissing: boolean; existing: Record<string, { store: string; state: string }> } | null>(null);
  // Upload thẳng lên Amazon (Mac mini + AdsPower)
  const [ppcStores, setPpcStores] = useState<Array<{ id: string; name: string; canManageActions?: boolean }>>([]);
  const [uploadStoreId, setUploadStoreId] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<{ store: string; jobs: Array<{ id: string; fileName: string; campaigns: number; status: string; progress: number; error?: string }> } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  const sbPanelRef = useRef<HTMLDivElement>(null);

  const skuByUpper = useMemo(() => new Map(allSkus.map((s) => [s.sku.toUpperCase(), s])), [allSkus]);

  // Tải Bảng mã FBA + FBM một lượt (SKU không trùng giữa 2 bảng → biết ngay SKU là FBA hay FBM).
  const [reloadKey, setReloadKey] = useState(0);
  const announceReload = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const load = async (type: LoaiHinh): Promise<SkuRow[]> => {
          const res = await fetch(`/api/ppc/new-camp/skus?type=${type}`, { cache: "no-store" });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`);
          return ((json.data || []) as NewCampSkuInfo[]).map((x) => ({ ...x, channel: type }));
        };
        const [fba, fbm] = await Promise.all([load("FBA"), load("FBM")]);
        if (cancelled) return;
        // SKU có ở cả 2 bảng (dữ liệu nhập nhầm): giữ 1 dòng, ưu tiên dòng đang chạy (không OFF / Hủy), rồi FBA
        const merged = new Map<string, SkuRow>();
        for (const row of [...fba, ...fbm]) {
          const key = row.sku.toUpperCase();
          const prev = merged.get(key);
          if (!prev || (isStoppedStatus(prev.status) && !isStoppedStatus(row.status))) merged.set(key, row);
        }
        const list = [...merged.values()].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
        setAllSkus(list);
        if (announceReload.current) setNotices([{ kind: "success", text: `Đã tải ${fba.length} SKU FBA + ${fbm.length} SKU FBM từ Bảng mã.` }]);
      } catch (error) {
        if (!cancelled) setNotices([{ kind: "error", text: `Không thể tải danh sách SKU: ${error instanceof Error ? error.message : error}` }]);
      } finally {
        announceReload.current = false;
        if (!cancelled) setSkuLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reloadSkus = (announce: boolean) => {
    announceReload.current = announce;
    setSkuLoading(true);
    setReloadKey((k) => k + 1);
  };

  // Loại hình tự theo SKU đã chọn (1 lần lên camp chỉ 1 loại hình)
  const channelOf = (sku: string) => skuByUpper.get(sku.toUpperCase())?.channel;
  const loaiHinh: LoaiHinh = (selected.length ? channelOf(selected[0]) : undefined) ?? "FBA";
  // Tự nhận Win/Test theo Bảng mã chỉ với FBA; FBM chọn tay Test / Win
  const isFbm = selected.length > 0 && loaiHinh === "FBM";
  const effectiveTrangThai = isFbm && trangThai === "Auto" ? "Test" : trangThai;
  const winCount = selected.filter((sku) => isWinStatus(skuByUpper.get(sku.toUpperCase())?.status)).length;
  const trangThaiLabel = effectiveTrangThai === "Auto" ? (selected.length ? `${winCount} Win · ${selected.length - winCount} Test` : "Tự động") : effectiveTrangThai;

  const filteredSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    const list = q ? allSkus.filter((s) => s.sku.toLowerCase().includes(q) || (s.asin || "").toLowerCase().includes(q)) : allSkus;
    return list.slice(0, 500);
  }, [allSkus, skuSearch]);

  const addSkus = (skus: string[]) => {
    const base = selected.length ? channelOf(selected[0]) : skus.length ? channelOf(skus[0]) : undefined;
    const ok = skus.filter((s) => channelOf(s) === base);
    const other = skus.filter((s) => channelOf(s) !== base);
    setSelected((prev) => {
      const next = [...prev];
      for (const s of ok) if (!next.includes(s)) next.push(s);
      return next;
    });
    if (other.length) {
      setNotices([{ kind: "error", text: `Đang chọn SKU ${base} — mỗi lần chỉ lên 1 loại hình. Bỏ qua ${other.length} SKU ${base === "FBA" ? "FBM" : "FBA"}:\n${other.slice(0, 10).join("\n")}` }]);
    }
  };

  const addBulk = () => {
    const lines = bulkSkus.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const found: string[] = [];
    const notFound: string[] = [];
    for (const line of lines) {
      const info = skuByUpper.get(line.toUpperCase());
      if (info) found.push(info.sku);
      else notFound.push(line);
    }
    addSkus(found);
    setBulkSkus("");
    if (notFound.length > 0) {
      setNotices([{ kind: "error", text: `Các SKU sau không có trong Bảng mã và đã bị bỏ qua:\n${notFound.join("\n")}` }]);
    }
  };

  // --- Keyword: 3 cách, chỉ dùng 1 cách tại một thời điểm ---
  const resetKeyword = () => {
    setKwMode("none");
    setUploadFile(null);
    setUploadName({});
    if (kwFileRef.current) kwFileRef.current.value = "";
    setLibQuery("");
    setLibResults(null);
    setLibFile(null);
    setDraftParts(NEW_DRAFT);
    setKwParts([]);
    setCreateName({});
    setBidErrors(new Set());
    setBulkBid("");
  };

  useEffect(() => {
    if (kwMode !== "none" && kwMode !== "library") return;
    const q = libQuery.trim();
    if (q.length < 2 || libFile) return;
    const timer = setTimeout(async () => {
      setLibSearching(true);
      try {
        const res = await fetch(`/api/ppc/new-camp/kw-files?query=${encodeURIComponent(q)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        setLibResults({ query: q, items: res.ok ? json.data || [] : [] });
      } finally {
        setLibSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [libQuery, libFile, kwMode]);

  const processKwList = () => {
    const parts = draftParts
      .map((d, i) => ({ name: d.name.trim() || partLabel(i), keywords: normalizeKeywordList(d.text) }))
      .filter((p) => p.keywords.length > 0)
      .map((p) => ({ ...p, bids: p.keywords.map(() => "") }));
    if (parts.length === 0) {
      setNotices([{ kind: "error", text: "Vui lòng dán danh sách keyword vào." }]);
      return;
    }
    setKwParts(parts);
    setKwMode("create");
  };
  const kwTotal = kwParts.reduce((n, p) => n + p.keywords.length, 0);

  const kwCampaignSelected = match.sp03.run || match.sb01.run || match.sb05.run;

  // 4 ô lưu kho keyword: tự điền từ Bảng mã của SKU đã chọn (giá trị gặp nhiều nhất), bộ keyword theo tên file / part
  const autoName = useMemo(() => {
    const top = (pick: (i: NewCampSkuInfo) => string) => {
      const count = new Map<string, number>();
      for (const sku of selected) {
        const v = (skuByUpper.get(sku.toUpperCase()) ? pick(skuByUpper.get(sku.toUpperCase())!) : "").trim();
        if (v) count.set(v, (count.get(v) ?? 0) + 1);
      }
      return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    };
    return {
      user: top((i) => i.picMkt),
      niche: top((i) => i.niche),
      phoi: top((i) => i.productType),
      uploadSet: uploadFile ? uploadFile.name.replace(/\.(xlsx|xls|csv)$/i, "").trim() : "",
      createSet: kwParts.map((p) => p.name).join(" + "),
    };
  }, [selected, skuByUpper, uploadFile, kwParts]);
  const uploadNameValue: KwName = {
    user: uploadName.user ?? autoName.user,
    niche: uploadName.niche ?? autoName.niche,
    phoi: uploadName.phoi ?? autoName.phoi,
    set: uploadName.set ?? autoName.uploadSet,
  };
  const createNameValue: KwName = {
    user: createName.user ?? autoName.user,
    niche: createName.niche ?? autoName.niche,
    phoi: createName.phoi ?? autoName.phoi,
    set: createName.set ?? autoName.createSet,
  };

  // --- Kiểm tra thông tin SB: ô nào Bảng mã còn trống thì hiện ô để bổ sung ---
  const sbRuns = useMemo(() => ({ sb01: match.sb01.run, sb05: match.sb05.run }), [match.sb01.run, match.sb05.run]);
  const sbActive = sbRuns.sb01 || sbRuns.sb05;
  const sbRows = useMemo(() => {
    if (!sbActive) return [];
    return selected
      .map((sku) => {
        const info = skuByUpper.get(sku.toUpperCase());
        const key = sku.toUpperCase();
        // Ô cần nhập tính theo Bảng mã (không tính phần đã bổ sung) để ô không biến mất khi đang gõ.
        const required = missingSbFields(info, undefined, sbRuns, "required");
        const optional = missingSbFields(info, undefined, sbRuns, "optional");
        const stillMissing = missingSbFields(info, sbOverrides[key], sbRuns, "required");
        return { sku, key, required, optional, needs: new Set<SbField>([...required, ...optional]), stillMissing };
      })
      .filter((r) => r.needs.size > 0);
  }, [sbActive, selected, skuByUpper, sbRuns, sbOverrides]);
  const sbColumns = useMemo(() => SB_FIELDS.filter((f) => sbRows.some((r) => r.needs.has(f))), [sbRows]);
  const sbBlocking = sbRows.filter((r) => r.stillMissing.length > 0);

  const setSbValue = (key: string, field: SbField, value: string) =>
    setSbOverrides((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const applySbBulk = (field: SbField) => {
    const value = (sbBulk[field] || "").trim();
    if (!value) return;
    setSbOverrides((prev) => {
      const next = { ...prev };
      for (const r of sbRows) {
        if (r.needs.has(field) && !(next[r.key]?.[field] || "").trim()) next[r.key] = { ...next[r.key], [field]: value };
      }
      return next;
    });
  };

  const previewDeps = JSON.stringify({
    selected, loaiHinh, trangThai: effectiveTrangThai, ngay, match, sp04: sp04.run, flasin: flasin.run, naming, nameOverrides,
    kwMode, upload: uploadFile ? `${uploadFile.name}|${uploadFile.size}|${uploadFile.lastModified}` : null, lib: libFile?.id ?? null, kwParts: kwParts.map((p) => [p.name, p.keywords]),
  });
  useEffect(() => {
    if (selected.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const fd = new FormData();
        fd.append("mode", "preview");
        fd.append("options", JSON.stringify(buildOptions(false)));
        fd.append("kwMode", kwMode);
        if (kwMode === "upload" && uploadFile) fd.append("keyword_file", uploadFile);
        if (kwMode === "library" && libFile) fd.append("kwFileId", String(libFile.id));
        if (kwMode === "create") fd.append("kwParts", JSON.stringify(kwParts));
        const res = await fetch("/api/ppc/new-camp/generate", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setPreview({ campaigns: json.campaigns || [], kwMissing: !!json.kwMissing, existing: json.existing || {} });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // buildOptions đọc state hiện tại; previewDeps gom đúng các giá trị ảnh hưởng tên camp
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDeps]);

  const campaignsBySku = useMemo(() => {
    const map = new Map<string, PlannedCampaign[]>();
    for (const c of preview?.campaigns ?? []) {
      const k = c.sku.toUpperCase();
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return map;
  }, [preview]);
  const finalName = (c: PlannedCampaign) => (nameEdits[c.key] ?? c.name).replace(/\s+/g, " ").trim() || c.name;
  // Camp đã có trên Amazon (theo tên tự động; tên đã sửa tay thì server kiểm tra lại lúc tạo)
  const existingOf = (c: PlannedCampaign) => {
    const edited = nameEdits[c.key] !== undefined && nameEdits[c.key].trim() !== c.name;
    return edited ? undefined : preview?.existing?.[c.name];
  };
  const existingCount = (preview?.campaigns ?? []).filter((c) => existingOf(c)).length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/ppc/stores", { cache: "no-store" }).catch(() => null);
      const json = res && res.ok ? await res.json().catch(() => ({})) : {};
      if (!cancelled) setPpcStores(Array.isArray(json.data) ? json.data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Store mặc định: store của SKU đã chọn trong Bảng mã
  const guessedStoreId = useMemo(() => {
    for (const sku of selected) {
      const name = skuByUpper.get(sku.toUpperCase())?.storeName?.trim().toUpperCase();
      const hit = name ? ppcStores.find((st) => st.name.trim().toUpperCase() === name) : undefined;
      if (hit) return hit.id;
    }
    return "";
  }, [selected, skuByUpper, ppcStores]);
  const effectiveStoreId = uploadStoreId || guessedStoreId;

  // Theo dõi job upload tới khi xong
  const pendingJobIds = (uploadJobs?.jobs ?? []).filter((j) => !["SUCCESS", "PARTIAL_SUCCESS", "FAILED", "RESULT_TIMEOUT", "CANCELLED"].includes(j.status)).map((j) => j.id).join(",");
  useEffect(() => {
    if (!pendingJobIds) return;
    const timer = setInterval(async () => {
      const updates = await Promise.all(pendingJobIds.split(",").map(async (id) => {
        const res = await fetch(`/api/ppc/auto-upload?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        const json = res && res.ok ? await res.json().catch(() => ({})) : {};
        const log = json?.data?.log;
        return log ? { id, status: String(log.status || ""), progress: Number(log.progressPct ?? log.progress_pct ?? 0), error: log.errorMessage ?? log.error_message ?? undefined } : null;
      }));
      setUploadJobs((prev) => prev && {
        ...prev,
        jobs: prev.jobs.map((j) => {
          const u = updates.find((x) => x?.id === j.id);
          return u ? { ...j, status: u.status || j.status, progress: u.progress, error: u.error || undefined } : j;
        }),
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [pendingJobIds]);

  // Tóm tắt trước khi upload: số camp / budget theo dạng chạy, thông tin SB, cảnh báo store & Brand Entity
  const confirmSummary = useMemo(() => {
    const camps = preview?.campaigns ?? [];
    const store = ppcStores.find((st) => st.id === effectiveStoreId);
    const budgetOf: Record<string, string> = {
      SP03: match.sp03.dailyBudget, SB01: match.sb01.dailyBudget, SB05: match.sb05.dailyBudget, SP04: sp04.dailyBudget, FL: flasin.dailyBudget,
    };
    const labelOf: Record<string, string> = { SP03: "SP03 KW", SB01: "SB01 CK KW (Collection)", SB05: "SB05 VIDEO", SP04: "SP04 Auto", FL: "FL Asin" };
    const runs = ["SP03", "SB01", "SB05", "SP04", "FL"]
      .map((r) => {
        const n = camps.filter((c) => c.key.startsWith(`${r}|`)).length;
        const budget = Number(budgetOf[r]) || 0;
        return { run: r, label: labelOf[r], campaigns: n, budget, total: n * budget };
      })
      .filter((r) => r.campaigns > 0);
    const sbSkus = sbActive
      ? selected.map((sku) => {
        const key = sku.toUpperCase();
        const info = skuByUpper.get(key);
        const v = (f: SbField) => sbFieldValue(info, sbOverrides[key], f);
        return { sku, brandEntityId: v("brandEntityId"), brand: v("brand"), video: v("videoMediaIds"), logo: v("brandLogoAssetId") };
      })
      : [];
    const otherStore = selected
      .map((sku) => ({ sku, store: skuByUpper.get(sku.toUpperCase())?.storeName?.trim() || "" }))
      .filter((x) => store && x.store && x.store.toUpperCase() !== store.name.trim().toUpperCase());
    const entities = [...new Set(sbSkus.map((x) => x.brandEntityId).filter(Boolean))];
    return {
      store,
      runs,
      totalCampaigns: camps.length,
      totalBudget: runs.reduce((n, r) => n + r.total, 0),
      sbSkus,
      otherStore,
      entities,
    };
  }, [preview, ppcStores, effectiveStoreId, match, sp04.dailyBudget, flasin.dailyBudget, sbActive, selected, skuByUpper, sbOverrides]);

  const dupNames = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const c of preview?.campaigns ?? []) {
      const n = (nameEdits[c.key] ?? c.name).replace(/\s+/g, " ").trim() || c.name;
      if (seen.has(n)) dup.add(n);
      seen.add(n);
    }
    return dup;
  }, [preview, nameEdits]);

  // Dữ liệu form gửi server (tạo file và xem trước dùng chung)
  const buildOptions = (withEdits: boolean) => ({
    loaiHinh,
    trangThai: effectiveTrangThai,
    ngay: ngay.replace(/-/g, ""),
    selectedSkus: selected,
    sp03: match.sp03,
    sb01: match.sb01,
    sb05: match.sb05,
    sp04,
    flasin,
    sbOverrides: sbActive
      ? Object.fromEntries(sbRows.map((r) => [
        r.key,
        Object.fromEntries([...r.needs].map((f) => [f, (sbOverrides[r.key]?.[f] || "").trim()]).filter(([, v]) => v)),
      ]))
      : {},
    naming,
    advanced,
    nameOverrides: Object.fromEntries(
      selected
        .map((sku) => [sku.toUpperCase(), nameOverrides[sku.toUpperCase()]] as const)
        .filter(([, o]) => o && Object.keys(o).length > 0),
    ),
    nameEdits: withEdits
      ? Object.fromEntries((preview?.campaigns ?? []).filter((c) => nameEdits[c.key] !== undefined && nameEdits[c.key].trim() !== c.name).map((c) => [c.key, nameEdits[c.key].trim()]))
      : {},
  });

  const submit = async (mode: "download" | "upload" = "download", confirmed = false) => {
    setNotices([]);
    if (selected.length === 0) return setNotices([{ kind: "error", text: "Vui lòng chọn ít nhất một SKU." }]);
    if (kwCampaignSelected && kwMode === "none") {
      return setNotices([{ kind: "error", text: "Bạn đã chọn chạy campaign Keyword (SP03, SB01, SB05) nhưng chưa chọn file Keyword." }]);
    }
    if (sbBlocking.length > 0) {
      sbPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return setNotices([{
        kind: "error",
        text: `Còn ${sbBlocking.length} SKU thiếu thông tin để lên SB — điền các ô đỏ ở mục "Thông tin SB còn thiếu":\n${sbBlocking
          .slice(0, 10)
          .map((r) => `${r.sku}: ${r.stillMissing.map((f) => SB_FIELD_LABELS[f]).join(", ")}`)
          .join("\n")}${sbBlocking.length > 10 ? "\n…" : ""}`,
      }]);
    }

    if (dupNames.size > 0) {
      return setNotices([{ kind: "error", text: `Tên camp bị trùng: ${[...dupNames].slice(0, 3).join(", ")}` }]);
    }
    if (existingCount > 0) {
      return setNotices([{ kind: "error", text: `${existingCount} camp đã có trên Amazon (ô đỏ ở bước 5). Sửa tên hoặc thêm đuôi tên rồi tạo lại.` }]);
    }
    const uploadStore = ppcStores.find((st) => st.id === effectiveStoreId);
    if (mode === "upload" && !uploadStore) return setNotices([{ kind: "error", text: "Chọn store để upload lên Amazon." }]);
    const fd = new FormData();
    if (mode === "upload") {
      fd.append("output", "upload");
      fd.append("storeId", uploadStore!.id);
    }
    fd.append("options", JSON.stringify(buildOptions(true)));
    if (asinFile) fd.append("asin_file", asinFile);
    fd.append("kwMode", kwMode);

    const nameOk = (n: KwName) => [n.user, n.niche, n.phoi, n.set].every((v) => v.trim());
    if (kwMode === "upload") {
      if (!uploadFile) return setNotices([{ kind: "error", text: 'Vui lòng chọn lại file ở mục "Upload file".' }]);
      if (!nameOk(uploadNameValue)) return setNotices([{ kind: "error", text: "Vui lòng điền đủ 4 trường thông tin file (Tên người, Ngách, Phôi, Bộ KW) cho file upload." }]);
      fd.append("keyword_file", uploadFile);
      fd.append("kwName", JSON.stringify(uploadNameValue));
    } else if (kwMode === "library") {
      if (!libFile) return setNotices([{ kind: "error", text: "Chưa chọn file keyword trong kho." }]);
      fd.append("kwFileId", String(libFile.id));
    } else if (kwMode === "create") {
      if (!nameOk(createNameValue)) return setNotices([{ kind: "error", text: "Vui lòng điền đủ 4 trường thông tin file (Tên người, Ngách, Phôi, Bộ KW) cho file tạo mới." }]);
      const bad = new Set<string>();
      kwParts.forEach((p, pi) => p.bids.forEach((b, i) => {
        const v = b.trim();
        if (!v || !(Number.parseFloat(v) >= 0.02)) bad.add(`${pi}:${i}`);
      }));
      setBidErrors(bad);
      if (bad.size > 0) return setNotices([{ kind: "error", text: "Vui lòng điền đầy đủ Bid (tối thiểu 0.02) cho tất cả các keyword." }]);
      fd.append("kwName", JSON.stringify(createNameValue));
      fd.append("kwParts", JSON.stringify(kwParts.map((p) => ({ ...p, bids: p.bids.map((b) => b.trim()) }))));
    }

    if (mode === "upload" && !confirmed) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    if (mode === "upload") setUploadBusy(true);
    else setBusy(true);
    try {
      const res = await fetch("/api/ppc/new-camp/generate", { method: "POST", body: fd });
      const uploadStatus = res.headers.get("X-Upload-Status");
      const uploadRaw = res.headers.get("X-Upload-Message");
      const uploadNotice: Notice | null = uploadStatus && uploadRaw
        ? { kind: uploadStatus === "success" ? "success" : "error", text: decodeURIComponent(uploadRaw) }
        : null;

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setNotices([{ kind: "error", text: `${mode === "upload" ? "Lỗi khi upload" : "Lỗi khi tạo file"}: ${json.error || "Lỗi không xác định từ server."}` }, ...(uploadNotice ? [uploadNotice] : [])]);
        return;
      }
      if (mode === "upload") {
        const json = (await res.json()) as { store: string; jobs: Array<{ id: string; fileName: string; campaigns: number }> };
        setUploadJobs({ store: json.store, jobs: json.jobs.map((j) => ({ ...j, status: "PENDING", progress: 25 })) });
        setNotices(uploadNotice ? [uploadNotice] : []);
        resetKeyword();
        return;
      }
      // Tải từng file Excel riêng (không nén zip)
      const json = (await res.json()) as { files?: Array<{ name: string; rows: number; data: string }> };
      const files = json.files ?? [];
      for (const [i, f] of files.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, 350)); // trình duyệt chặn khi tải nhiều file cùng lúc
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setNotices([
        { kind: "success", text: `Đã tải ${files.length} file:\n${files.map((f) => `• ${f.name} (${f.rows} dòng)`).join("\n")}` },
        ...(uploadNotice ? [uploadNotice] : []),
      ]);
      resetKeyword();
    } catch (error) {
      setNotices([{ kind: "error", text: `Lỗi kết nối khi gửi yêu cầu: ${error instanceof Error ? error.message : error}` }]);
    } finally {
      setBusy(false);
      setUploadBusy(false);
    }
  };

  const activeInfo = activeSku ? skuByUpper.get(activeSku.toUpperCase()) : undefined;
  const runLabels = [
    match.sp03.run && "SP03",
    match.sb01.run && "SB01",
    match.sb05.run && "SB05",
    sp04.run && "SP04",
    flasin.run && "FL Asin",
  ].filter(Boolean) as string[];
  const shownTab = kwMode !== "none" ? kwMode : kwTab;
  const advancedChanged = JSON.stringify(advanced) !== JSON.stringify(DEFAULT_ADVANCED);
  // Tên mẫu theo dạng chạy đầu tiên đang chọn
  const firstMatch = (m: MatchRun) => (m.exact ? "Exact" : m.phrase ? "Phrase" : m.broad ? "Broad" : "Exact");
  const previewRun = match.sp03.run
    ? { loaiChay: `SP03 KW ${firstMatch(match.sp03)}`, tail: "‹part›" }
    : match.sb01.run
      ? { loaiChay: `SB01 CK KW ${firstMatch(match.sb01)}`, tail: "‹part›" }
      : match.sb05.run
        ? { loaiChay: `SB05 VIDEO ${firstMatch(match.sb05)}`, tail: "‹part›" }
        : sp04.run
          ? { loaiChay: "SP04 Auto", tail: "(close-match)" }
          : flasin.run
            ? { loaiChay: "FL Asin", tail: "(FL ASIN)" }
            : { loaiChay: "SP03 KW Exact", tail: "‹part›" };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 pb-28">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-200"><RocketLaunch size={20} weight="fill" /></span>
        <h1 className="text-xl font-black tracking-tight text-slate-900">Lên camp SKU mới</h1>
      </div>

      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((n, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 whitespace-pre-line rounded-xl border px-4 py-3 text-sm font-medium leading-relaxed ${
                n.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : n.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {n.kind === "success" ? <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" /> : <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-rose-600" />}
              <span className="min-w-0 flex-1">{n.text}</span>
              <button type="button" onClick={() => setNotices((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 rounded-lg p-1 opacity-60 hover:bg-black/5 hover:opacity-100 cursor-pointer"><X size={16} /></button>
            </div>
          ))}
        </div>
      )}

      {uploadJobs && (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
              <CloudArrowUp size={18} weight="bold" className="text-indigo-600" /> Upload lên Amazon · {uploadJobs.store}
            </span>
            <button type="button" onClick={() => setUploadJobs(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"><X size={14} weight="bold" /></button>
          </div>
          <div className="space-y-2">
            {uploadJobs.jobs.map((j) => {
              const done = j.status === "SUCCESS";
              const warn = j.status === "PARTIAL_SUCCESS" || j.status === "RESULT_TIMEOUT";
              const fail = j.status === "FAILED" || j.status === "CANCELLED";
              const label = done ? "Thành công" : warn ? (j.status === "PARTIAL_SUCCESS" ? "Một phần lỗi" : "Chờ kết quả quá lâu") : fail ? (j.status === "CANCELLED" ? "Đã huỷ" : "Thất bại") : j.status === "RUNNING" ? "Đang upload" : "Chờ Mac mini";
              return (
                <div key={j.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-3 text-sm">
                    <FileXls size={18} weight="fill" className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{j.fileName}</span>
                    <span className="text-xs font-semibold text-slate-500">{j.campaigns} camp</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${done ? "bg-emerald-600 text-white" : warn ? "bg-amber-500 text-white" : fail ? "bg-rose-600 text-white" : "bg-indigo-100 text-indigo-800"}`}>{label}</span>
                  </div>
                  {!done && !fail && !warn && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(5, Math.min(100, j.progress))}%` }} />
                    </div>
                  )}
                  {j.error && <p className="mt-1 text-xs font-semibold text-rose-600">{j.error}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ===== Cột trái: cấu hình + SKU (khung SKU giãn cho bằng cột phải) ===== */}
        <div className="flex flex-col gap-4">
          <Section step={1} title="Cấu hình chung">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <span className={labelCls}>Loại hình</span>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1" title="Tự theo SKU đã chọn">
                  {(["FBA", "FBM"] as const).map((c) => (
                    <span
                      key={c}
                      className={`flex-1 rounded-lg py-2 text-center text-sm font-bold ${selected.length && loaiHinh === c ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400"}`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <span className={labelCls}>Trạng thái</span>
                <Segmented
                  value={effectiveTrangThai}
                  options={isFbm ? [{ value: "Test", label: "Test" }, { value: "Win", label: "Win" }] : [{ value: "Auto", label: "Tự động" }, { value: "Test", label: "Test" }, { value: "Win", label: "Win" }]}
                  onChange={setTrangThai}
                />
              </div>
              <label className="block">
                <span className={labelCls}>Ngày lên camp</span>
                <input type="date" className={`${inputCls} py-[7px]`} value={ngay} onChange={(e) => setNgay(e.target.value)} required />
              </label>
            </div>
          </Section>

          <Section
            step={2}
            title="Chọn SKU"
            className="flex flex-1 flex-col"
            bodyClassName="flex flex-1 flex-col"
            right={
              <button
                type="button"
                onClick={() => reloadSkus(true)}
                disabled={skuLoading}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                title="Tải lại danh sách SKU từ Bảng mã"
              >
                {skuLoading ? <CircleNotch size={14} className="animate-spin" /> : <ArrowsClockwise size={14} weight="bold" />}
                Tải lại
              </button>
            }
          >
            <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <span className={`${labelCls} mb-0`}>Dán danh sách SKU</span>
                <textarea className={inputCls} rows={3} placeholder="Mỗi SKU một dòng" value={bulkSkus} onChange={(e) => setBulkSkus(e.target.value)} />
                <button type="button" onClick={addBulk} className="w-full rounded-lg bg-slate-900 py-2 text-sm font-bold text-white hover:bg-slate-800 cursor-pointer">
                  Thêm vào danh sách
                </button>
                <div className="relative mt-1">
                  <MagnifyingGlass size={16} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className={`${inputCls} pl-9`} placeholder="Tìm SKU hoặc ASIN…" value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} />
                </div>
                <div className="min-h-[12rem] [flex:1_1_0px] overflow-y-auto rounded-lg border border-slate-200 thin-scrollbar">
                  {skuLoading ? (
                    <div className="flex h-full items-center justify-center text-slate-400"><CircleNotch size={20} className="animate-spin" /></div>
                  ) : filteredSkus.length === 0 ? (
                    <div className="p-4 text-sm font-medium text-slate-400">Không có SKU</div>
                  ) : (
                    filteredSkus.map((s) => {
                      const picked = selected.includes(s.sku);
                      return (
                        <button
                          key={s.sku}
                          type="button"
                          onClick={() => addSkus([s.sku])}
                          disabled={picked}
                          className="flex w-full items-center gap-3 border-b border-slate-100 px-2.5 py-1.5 text-left last:border-b-0 hover:bg-indigo-50 disabled:bg-emerald-50/60 cursor-pointer disabled:cursor-default"
                        >
                          <MockupThumb url={s.mockupUrl} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={`truncate font-mono text-[13px] font-bold ${picked ? "text-emerald-700" : "text-slate-900"}`}>{s.sku}</span>
                              <ChannelBadge channel={s.channel} />
                              {s.channel === "FBA" && <StatusBadge status={s.status} />}
                            </span>
                            <span className="block truncate text-xs font-medium text-slate-500">
                              {[s.asin, s.productType].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {picked && <Check size={16} weight="bold" className="shrink-0 text-emerald-600" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-slate-700">
                    Đã chọn <span className="ml-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-black text-white">{selected.length}</span>
                  </span>
                  {selected.length > 0 && (
                    <button type="button" onClick={() => { setSelected([]); setActiveSku(null); }} className="text-xs font-bold text-rose-600 hover:underline cursor-pointer">Xóa hết</button>
                  )}
                </div>
                <div className="min-h-[12rem] [flex:1_1_0px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2 thin-scrollbar">
                  {selected.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400">Chưa chọn SKU</div>
                  ) : (
                    <div className="space-y-1.5">
                      {selected.map((sku) => (
                        <div
                          key={sku}
                          className={`flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition ${activeSku === sku ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200 bg-white hover:border-slate-300"}`}
                        >
                          <MockupThumb url={skuByUpper.get(sku.toUpperCase())?.mockupUrl} size={32} />
                          <button type="button" onClick={() => setActiveSku(activeSku === sku ? null : sku)} className="min-w-0 flex-1 text-left cursor-pointer" title="Xem thông tin SKU">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-mono text-[13px] font-bold text-slate-900">{sku}</span>
                              {skuByUpper.get(sku.toUpperCase())?.channel === "FBA" && <StatusBadge status={skuByUpper.get(sku.toUpperCase())?.status} />}
                            </span>
                            {skuByUpper.get(sku.toUpperCase())?.asin && (
                              <span className="block truncate text-xs font-medium text-slate-500">{skuByUpper.get(sku.toUpperCase())?.asin}</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSelected((prev) => prev.filter((x) => x !== sku)); if (activeSku === sku) setActiveSku(null); }}
                            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                            title="Bỏ SKU"
                          >
                            <X size={14} weight="bold" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {activeInfo && (
              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <MockupThumb url={activeInfo.mockupUrl} size={64} />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm font-black text-indigo-900">{activeInfo.sku}</span>
                      {activeInfo.asin && <span className="block text-xs font-semibold text-slate-500">{activeInfo.asin}</span>}
                    </span>
                  </span>
                  <button type="button" onClick={() => setActiveSku(null)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 cursor-pointer"><X size={14} weight="bold" /></button>
                </div>
                <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                  {SKU_INFO_FIELDS.map((f) => {
                    const value = (activeInfo[f.key] as string) || "";
                    return (
                      <div key={f.key} className="min-w-0">
                        <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{f.label}</dt>
                        <dd className={`break-all text-sm ${value ? "font-semibold text-slate-900" : "font-medium text-rose-400"}`}>{value || "Trống"}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </Section>
        </div>

        {/* ===== Cột phải: loại chạy + file keyword ===== */}
        <div className="space-y-4">
          <Section step={3} title="Loại chạy">
            <div className="space-y-2.5">
              {MATCH_GROUPS.map((g) => {
                const m = match[g.key];
                const set = (patch: Partial<MatchRun>) => setMatch((prev) => ({ ...prev, [g.key]: { ...prev[g.key], ...patch } }));
                return (
                  <RunCard key={g.key} title={g.label} on={m.run} onToggle={(v) => set({ run: v })}>
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="w-32"><MoneyInput label="Budget / ngày" value={m.dailyBudget} onChange={(v) => set({ dailyBudget: v })} /></div>
                      <div>
                        <span className={labelCls}>Match type</span>
                        <div className="flex gap-2">
                          {(["exact", "phrase", "broad"] as const).map((mt) => (
                            <button
                              key={mt}
                              type="button"
                              onClick={() => set({ [mt]: !m[mt] } as Partial<MatchRun>)}
                              className={`flex items-center gap-1.5 rounded-lg border-2 px-3.5 py-[5px] text-sm font-bold capitalize transition cursor-pointer ${
                                m[mt] ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                              }`}
                            >
                              {m[mt] && <Check size={13} weight="bold" />}
                              {mt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </RunCard>
                );
              })}

              <RunCard title="SP04 Auto" on={sp04.run} onToggle={(v) => setSp04({ ...sp04, run: v })}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <MoneyInput label="Budget / ngày" value={sp04.dailyBudget} onChange={(v) => setSp04({ ...sp04, dailyBudget: v })} />
                  {([["bidClose", "Close"], ["bidLoose", "Loose"], ["bidComp", "Complements"], ["bidSub", "Substitutes"]] as const).map(([k, label]) => (
                    <MoneyInput key={k} label={label} step="0.01" value={sp04[k]} onChange={(v) => setSp04({ ...sp04, [k]: v })} />
                  ))}
                </div>
              </RunCard>

              <RunCard title="FL Asin" on={flasin.run} onToggle={(v) => setFlasin({ ...flasin, run: v })}>
                <div className="space-y-4">
                  <div className="grid max-w-xs grid-cols-2 gap-3">
                    <MoneyInput label="Budget / ngày" value={flasin.dailyBudget} onChange={(v) => setFlasin({ ...flasin, dailyBudget: v })} />
                    <MoneyInput label="Bid" step="0.01" value={flasin.bid} onChange={(v) => setFlasin({ ...flasin, bid: v })} />
                  </div>
                  <div>
                    <span className={labelCls}>File ASIN Crawl</span>
                    {asinFile ? (
                      <SelectedChip label={asinFile.name} onClear={() => { setAsinFile(null); if (asinFileRef.current) asinFileRef.current.value = ""; }} />
                    ) : (
                      <FilePicker inputRef={asinFileRef} onPick={setAsinFile} />
                    )}
                  </div>
                </div>
              </RunCard>

              <div className="rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <GearSix size={16} weight="bold" className="text-slate-500" />
                  Tùy chỉnh nâng cao
                  {advancedChanged && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">đã đổi</span>}
                  <CaretDown size={14} weight="bold" className={`ml-auto text-slate-400 transition ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-4 sm:grid-cols-3">
                    {([["sp03BiddingStrategy", "Bidding SP03"], ["sp04BiddingStrategy", "Bidding SP04 Auto"]] as const).map(([k, label]) => (
                      <label key={k} className="block">
                        <span className={labelCls}>{label}</span>
                        <select className={inputCls} value={advanced[k]} onChange={(e) => setAdvanced({ ...advanced, [k]: e.target.value as BiddingStrategy })}>
                          {BIDDING_STRATEGIES.map((b) => <option key={b} value={b}>{b.replace("Dynamic bids - ", "Dynamic · ")}</option>)}
                        </select>
                      </label>
                    ))}
                    <label className="block">
                      <span className={labelCls}>Default bid Ad Group</span>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">$</span>
                        <input type="number" step="0.01" placeholder="0.09" className={`${inputCls} pl-6`} value={advanced.adGroupDefaultBid} onChange={(e) => setAdvanced({ ...advanced, adGroupDefaultBid: e.target.value })} />
                      </div>
                    </label>
                    {([["phrasePct", "Bid Phrase"], ["broadPct", "Bid Broad"]] as const).map(([k, label]) => (
                      <label key={k} className="block">
                        <span className={labelCls}>{label}</span>
                        <div className="relative">
                          <input type="number" step="1" className={`${inputCls} pr-8`} value={advanced[k]} onChange={(e) => setAdvanced({ ...advanced, [k]: Number(e.target.value) })} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">% Exact</span>
                        </div>
                      </label>
                    ))}
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => setAdvanced(DEFAULT_ADVANCED)}
                        disabled={!advancedChanged}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowCounterClockwise size={14} weight="bold" /> Mặc định
                      </button>
                    </div>
                  </div>
                )}
                {showAdvanced && (
                  <StoreEntityEditor
                    onSaved={(store, entity) => {
                      if (!entity) return;
                      setAllSkus((prev) => prev.map((x) => ((x.storeName || "").trim().toUpperCase() === store ? { ...x, brandEntityId: entity } : x)));
                    }}
                  />
                )}
              </div>
            </div>
          </Section>

          {(
            <Section
              step={4}
              title="File keyword"
              className={kwCampaignSelected ? "" : "opacity-60"}
              right={kwMode !== "none" ? (
                <button type="button" onClick={resetKeyword} className="rounded-lg border border-slate-300 p-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer" title="Làm lại" aria-label="Làm lại">
                  <ArrowCounterClockwise size={16} weight="bold" />
                </button>
              ) : (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">SP03 · SB01 · SB05</span>
              )}
            >
              <Segmented
                value={shownTab}
                onChange={setKwTab}
                disabled={(v) => kwMode !== "none" && kwMode !== v}
                options={[
                  { value: "upload", label: <><UploadSimple size={16} weight="bold" /> Upload</> },
                  { value: "library", label: <><FolderOpen size={16} weight="bold" /> Từ kho</> },
                  { value: "create", label: <><PencilSimple size={16} weight="bold" /> Tạo mới</> },
                ]}
              />

              <div className="mt-4">
                {shownTab === "upload" && (
                  !uploadFile ? (
                    <div className="space-y-2">
                      <FilePicker
                        inputRef={kwFileRef}
                        accept=".xlsx,.csv"
                        label="Chọn file keyword (.xlsx, .csv)"
                        onPick={(f) => { if (f) { setUploadFile(f); setKwMode("upload"); } }}
                      />
                      <a
                        href="/api/ppc/new-camp/kw-files?template=1"
                        className="inline-flex items-center gap-1.5 rounded-lg px-1 text-[13px] font-bold text-indigo-700 hover:underline"
                      >
                        <DownloadSimple size={15} weight="bold" /> Tải file mẫu
                      </a>
                    </div>
                  ) : (
                    <>
                      <SelectedChip label={uploadFile.name} onClear={resetKeyword} />
                      <NameFields value={uploadNameValue} edits={uploadName} onChange={setUploadName} />
                    </>
                  )
                )}

                {shownTab === "library" && (
                  !libFile ? (
                    <>
                      <div className="relative">
                        <MagnifyingGlass size={16} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input className={`${inputCls} pl-9`} placeholder="Tên người, ngách, phôi…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} />
                      </div>
                      {libQuery.trim().length >= 2 && (
                        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 thin-scrollbar">
                          {libSearching ? (
                            <div className="flex items-center gap-2 p-3 text-sm font-medium text-slate-500"><CircleNotch size={16} className="animate-spin" /> Đang tìm…</div>
                          ) : libResults?.query === libQuery.trim() && libResults.items.length > 0 ? (
                            libResults.items.map((f) => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => { setLibFile(f); setKwMode("library"); }}
                                className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm font-semibold text-slate-800 last:border-b-0 hover:bg-indigo-50 cursor-pointer"
                              >
                                <FileXls size={18} weight="fill" className="shrink-0 text-emerald-600" />
                                {f.name}
                              </button>
                            ))
                          ) : libResults?.query === libQuery.trim() ? (
                            <div className="p-3 text-sm font-semibold text-rose-600">Không tìm thấy file</div>
                          ) : null}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1"><SelectedChip label={libFile.name} onClear={resetKeyword} /></div>
                      <a href={`/api/ppc/new-camp/kw-files?id=${libFile.id}`} className="rounded-xl border border-slate-300 p-2.5 text-slate-700 hover:bg-slate-50" title="Tải file keyword về"><DownloadSimple size={18} weight="bold" /></a>
                    </div>
                  )
                )}

                {shownTab === "create" && (
                  kwMode !== "create" ? (
                    <div className="space-y-3">
                      {draftParts.map((d, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <input
                              className={`${cellInputBase} max-w-[16rem] border-slate-300 bg-white font-bold`}
                              value={d.name}
                              placeholder={partLabel(i)}
                              onChange={(e) => setDraftParts((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            />
                            <span className="text-xs font-semibold text-slate-500">{normalizeKeywordList(d.text).length} keyword</span>
                            {draftParts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setDraftParts((prev) => prev.filter((_, j) => j !== i))}
                                className="ml-auto rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                title="Xóa part"
                              >
                                <X size={14} weight="bold" />
                              </button>
                            )}
                          </div>
                          <textarea
                            className={inputCls}
                            rows={4}
                            placeholder="Mỗi keyword một dòng"
                            value={d.text}
                            onChange={(e) => setDraftParts((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                          />
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setDraftParts((prev) => [...prev, { name: partLabel(prev.length), text: "" }])}
                          className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 cursor-pointer"
                        >
                          <Plus size={14} weight="bold" /> Thêm part
                        </button>
                        <button type="button" onClick={processKwList} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 cursor-pointer">
                          Tiếp tục: điền bid
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="grid grid-cols-[1fr_7.5rem] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-600">
                          <span>Keyword ({kwTotal})</span>
                          <span>Bid ($)</span>
                        </div>
                        <div className="grid grid-cols-[1fr_7.5rem] items-center gap-2 border-b border-slate-200 bg-indigo-50/60 px-3 py-2">
                          <span className="whitespace-nowrap text-right text-[13px] font-bold text-indigo-900">Bid chung</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.02"
                            placeholder="0.00"
                            value={bulkBid}
                            onChange={(e) => setBulkBid(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") applyBulkBid(); }}
                            className={`${cellInputBase} border-indigo-300 bg-white`}
                          />
                        </div>
                        <div className="max-h-80 overflow-y-auto thin-scrollbar">
                          {kwParts.map((p, pi) => (
                            <div key={pi}>
                              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-1.5">
                                <input
                                  className={`${cellInputBase} max-w-[16rem] border-transparent bg-transparent font-extrabold text-indigo-900 hover:border-slate-300 focus:bg-white`}
                                  value={p.name}
                                  onChange={(e) => setKwParts((prev) => prev.map((x, j) => (j === pi ? { ...x, name: e.target.value } : x)))}
                                  title="Tên part (đuôi tên camp)"
                                />
                                <span className="text-xs font-semibold text-slate-500">{p.keywords.length} keyword</span>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {p.keywords.map((kw, i) => (
                                  <div key={kw} className="grid grid-cols-[1fr_7.5rem] items-center gap-2 px-3 py-1.5">
                                    <span className="break-words text-sm font-semibold text-slate-800">{kw}</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.02"
                                      placeholder="0.00"
                                      value={p.bids[i] ?? ""}
                                      onChange={(e) => setKwParts((prev) => prev.map((x, j) => (j === pi ? { ...x, bids: x.bids.map((bb, k) => (k === i ? e.target.value : bb)) } : x)))}
                                      className={`${cellInputBase} ${bidErrors.has(`${pi}:${i}`) ? "border-rose-500 bg-rose-50" : "border-slate-300 bg-white"}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <NameFields value={createNameValue} edits={createName} onChange={setCreateName} />
                    </>
                  )
                )}
              </div>
            </Section>
          )}
        </div>
      </div>

      <Section
        step={5}
        title="Tên camp"
        right={
          <div className="flex items-center gap-4">
            {previewLoading && <CircleNotch size={16} className="animate-spin text-slate-400" />}
            <div className="w-40">
              <input className={inputCls} placeholder="Đuôi tên" value={naming.suffix} onChange={(e) => setNaming({ ...naming, suffix: e.target.value })} />
            </div>
          </div>
        }
      >
        {selected.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 font-mono text-[13px] font-semibold text-slate-500">
            {buildCampaignName(
              { sku: "{SKU}", loaiChay: previewRun.loaiChay, productType: "{Phôi}", niche: "{Ngách}", loaiHinh: "{FBA/FBM}", trangThai: effectiveTrangThai === "Auto" ? "{Win/Test}" : effectiveTrangThai, picMkt: "{PIC}", ngay: ngay.replace(/-/g, ""), tail: previewRun.tail },
              naming,
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {preview?.kwMissing && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">Chọn file keyword ở bước 4 để hiện camp SP03 / SB.</p>
            )}
            {selected.map((sku) => {
              const key = sku.toUpperCase();
              const info = skuByUpper.get(key);
              const value = (f: NameField) => nameOverrides[key]?.[f] ?? info?.[f] ?? "";
              const camps = campaignsBySku.get(key) ?? [];
              return (
                <div key={key} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                    <MockupThumb url={info?.mockupUrl} size={34} />
                    <span className="min-w-[9rem] font-mono text-[13px] font-black text-slate-900">{sku}</span>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {NAME_FIELDS.map((f) => {
                        const edited = nameOverrides[key]?.[f] !== undefined && nameOverrides[key]?.[f] !== (info?.[f] ?? "");
                        return (
                          <label key={f} className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-500">{NAME_FIELD_LABELS[f]}</span>
                            <input
                              className={`${cellInputBase} ${f === "picMkt" ? "w-24" : "w-40"} ${edited ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white"}`}
                              value={value(f)}
                              onChange={(e) => setNameOverrides((prev) => ({ ...prev, [key]: { ...prev[key], [f]: e.target.value } }))}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {camps.length === 0 ? (
                    <div className="px-3 py-3 text-[13px] font-semibold text-slate-400">{runLabels.length ? "—" : "Chưa chọn loại chạy"}</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {camps.map((c) => {
                        const edited = nameEdits[c.key] !== undefined && nameEdits[c.key].trim() !== c.name;
                        const dup = dupNames.has(finalName(c));
                        const exists = existingOf(c);
                        return (
                          <div key={c.key} className="flex items-center gap-3 px-3 py-1.5">
                            <span className="w-40 shrink-0 whitespace-nowrap rounded-md bg-indigo-50 px-2 py-1 text-center text-[11px] font-black text-indigo-700">{c.label}</span>
                            <input
                              className={`${cellInputBase} font-mono text-[13px] font-semibold ${dup || exists ? "border-rose-500 bg-rose-50" : edited ? "border-amber-400 bg-amber-50" : "border-transparent bg-transparent hover:border-slate-300 focus:bg-white"}`}
                              value={nameEdits[c.key] ?? c.name}
                              onChange={(e) => setNameEdits((prev) => ({ ...prev, [c.key]: e.target.value }))}
                              title="Bấm để sửa tên camp"
                            />
                            {exists && (
                              <span className="shrink-0 whitespace-nowrap rounded-md bg-rose-600 px-2 py-1 text-[11px] font-black text-white" title={`Trạng thái: ${exists.state || "?"}`}>
                                Đã có · {exists.store}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setNameEdits((prev) => { const next = { ...prev }; delete next[c.key]; return next; })}
                              className={`shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer ${edited ? "" : "invisible"}`}
                              title="Về tên tự động"
                            >
                              <ArrowCounterClockwise size={14} weight="bold" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {sbActive && selected.length > 0 && (
        <div ref={sbPanelRef}>
          <Section
            className={sbBlocking.length ? "border-rose-300" : ""}
            title="Thông tin SB còn thiếu"
            right={
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${sbBlocking.length ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"}`}>
                {sbBlocking.length ? <WarningCircle size={15} weight="fill" /> : <CheckCircle size={15} weight="fill" />}
                {sbBlocking.length ? `${sbBlocking.length}/${selected.length} SKU chưa đủ` : `Đủ cho ${selected.length} SKU`}
              </span>
            }
          >
            {sbRows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle size={18} weight="fill" /> Đủ thông tin</p>
            ) : (
              <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 thin-scrollbar">
                <table className="w-full min-w-max text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-100">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide text-slate-700">SKU</th>
                      {sbColumns.map((f) => (
                        <th key={f} className="px-3 py-2.5 text-left text-xs font-black uppercase tracking-wide text-slate-700">{SB_FIELD_LABELS[f]}</th>
                      ))}
                    </tr>
                    {sbRows.length > 1 && (
                      <tr className="border-t border-slate-200 bg-indigo-50">
                        <td className="px-3 py-2 text-[13px] font-extrabold text-indigo-900">Điền chung</td>
                        {sbColumns.map((f) => (
                          <td key={f} className="px-3 py-2">
                            <div className="flex gap-1.5">
                              <input
                                className={`${cellInputBase} min-w-[160px] border-slate-300 bg-white`}
                                placeholder={SB_FIELD_PLACEHOLDERS[f]}
                                value={sbBulk[f] || ""}
                                onChange={(e) => setSbBulk((prev) => ({ ...prev, [f]: e.target.value }))}
                              />
                              <button
                                type="button"
                                onClick={() => applySbBulk(f)}
                                className="shrink-0 rounded-md bg-indigo-600 px-2.5 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer"
                                title="Điền vào mọi ô còn trống của cột"
                              >
                                Áp dụng
                              </button>
                            </div>
                          </td>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sbRows.map((r) => (
                      <tr key={r.key} className="hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px] font-bold text-slate-900">{r.sku}</td>
                        {sbColumns.map((f) => {
                          if (!r.needs.has(f)) {
                            return <td key={f} className="px-3 py-2 text-emerald-600"><CheckCircle size={18} weight="fill" /></td>;
                          }
                          const value = sbOverrides[r.key]?.[f] || "";
                          const required = r.required.includes(f);
                          return (
                            <td key={f} className="px-3 py-2">
                              <input
                                className={`${cellInputBase} min-w-[200px] ${!value.trim() ? (required ? "border-rose-400 bg-rose-50" : "border-amber-400 bg-amber-50/60") : "border-emerald-400 bg-white"}`}
                                placeholder={SB_FIELD_PLACEHOLDERS[f]}
                                value={value}
                                onChange={(e) => setSbValue(r.key, f, e.target.value)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onMouseDown={() => setConfirmOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl thin-scrollbar" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><CloudArrowUp size={18} weight="bold" /></span>
              <h2 className="text-lg font-black text-slate-900">Xác nhận upload lên Amazon</h2>
              <button type="button" onClick={() => setConfirmOpen(false)} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"><X size={16} weight="bold" /></button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Store", confirmSummary.store?.name ?? "—"],
                  ["SKU", String(selected.length)],
                  ["Loại hình", `${loaiHinh} · ${trangThaiLabel}`],
                  ["Ngày lên camp", ngay.split("-").reverse().join("/")],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{k}</div>
                    <div className="mt-0.5 truncate text-[15px] font-black text-slate-900">{v}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr className="text-left text-xs font-black uppercase tracking-wide text-slate-700">
                      <th className="px-3 py-2">Dạng chạy</th>
                      <th className="px-3 py-2 text-right">Số camp</th>
                      <th className="px-3 py-2 text-right">Budget / camp</th>
                      <th className="px-3 py-2 text-right">Tổng / ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {confirmSummary.runs.map((r) => (
                      <tr key={r.run}>
                        <td className="px-3 py-2 font-bold text-slate-900">{r.label}</td>
                        <td className="px-3 py-2 text-right font-semibold">{r.campaigns}</td>
                        <td className="px-3 py-2 text-right font-semibold">${r.budget.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">${r.total.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50">
                      <td className="px-3 py-2 font-black text-indigo-900">Tổng</td>
                      <td className="px-3 py-2 text-right font-black text-indigo-900">{confirmSummary.totalCampaigns}</td>
                      <td />
                      <td className="px-3 py-2 text-right font-black text-indigo-900">${confirmSummary.totalBudget.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {confirmSummary.sbSkus.length > 0 && (
                <div>
                  <p className="mb-2 text-[13px] font-black text-slate-800">Thông tin Sponsored Brands</p>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100">
                        <tr className="text-left font-black uppercase tracking-wide text-slate-700">
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">Brand Entity ID</th>
                          <th className="px-3 py-2">Brand</th>
                          {match.sb05.run && <th className="px-3 py-2">Video</th>}
                          {match.sb01.run && <th className="px-3 py-2">Logo</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {confirmSummary.sbSkus.map((x) => (
                          <tr key={x.sku}>
                            <td className="px-3 py-2 font-mono font-bold text-slate-900">{x.sku}</td>
                            <td className="px-3 py-2 font-mono font-semibold">{x.brandEntityId || <span className="text-rose-600">Thiếu</span>}</td>
                            <td className="px-3 py-2 font-semibold">{x.brand || <span className="text-rose-600">Thiếu</span>}</td>
                            {match.sb05.run && <td className="px-3 py-2">{x.video ? <CheckCircle size={16} weight="fill" className="text-emerald-600" /> : <span className="font-bold text-rose-600">Thiếu</span>}</td>}
                            {match.sb01.run && <td className="px-3 py-2">{x.logo ? <CheckCircle size={16} weight="fill" className="text-emerald-600" /> : <span className="font-bold text-rose-600">Thiếu</span>}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(confirmSummary.otherStore.length > 0 || confirmSummary.entities.length > 1) && (
                <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-900">
                  <p className="flex items-center gap-1.5 font-black"><WarningCircle size={16} weight="fill" /> Kiểm tra lại</p>
                  {confirmSummary.otherStore.length > 0 && (
                    <p>
                      SKU thuộc store khác trong Bảng mã:{" "}
                      {confirmSummary.otherStore.slice(0, 6).map((x) => `${x.sku} (${x.store})`).join(", ")}
                      {confirmSummary.otherStore.length > 6 ? "…" : ""}
                    </p>
                  )}
                  {confirmSummary.entities.length > 1 && <p>Các SKU dùng {confirmSummary.entities.length} Brand Entity ID khác nhau — camp SB chỉ chạy được với brand của store đang upload.</p>}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">Huỷ</button>
              <button
                type="button"
                onClick={() => void submit("upload", true)}
                disabled={uploadBusy}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-black text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                {uploadBusy ? <CircleNotch size={16} className="animate-spin" /> : <CloudArrowUp size={16} weight="bold" />}
                Xác nhận upload {confirmSummary.totalCampaigns} camp
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_-6px_rgba(15,23,42,0.12)] backdrop-blur sm:-mx-4 md:-mx-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold text-slate-800">{selected.length} SKU</span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold text-slate-800">{loaiHinh} · {trangThaiLabel}</span>
            {runLabels.length ? (
              runLabels.map((r) => <span key={r} className="rounded-lg bg-indigo-100 px-2.5 py-1 font-bold text-indigo-800">{r}</span>)
            ) : (
              <span className="px-1 font-semibold text-slate-400">Chưa chọn loại chạy</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
          <div className="w-40">
            <select
              className={`${inputCls} py-[9px] font-bold`}
              value={effectiveStoreId}
              onChange={(e) => setUploadStoreId(e.target.value)}
              title="Store để upload lên Amazon"
            >
              <option value="">Chọn store…</option>
              {ppcStores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void submit("upload")}
            disabled={busy || uploadBusy || !effectiveStoreId}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-indigo-600 bg-white px-5 py-[10px] text-sm font-black text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
          >
            {uploadBusy ? <CircleNotch size={18} className="animate-spin" /> : <CloudArrowUp size={18} weight="bold" />}
            {uploadBusy ? "Đang gửi…" : "Upload lên Amazon"}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || uploadBusy}
            className="flex min-w-[220px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-8 py-3 text-sm font-black tracking-wide text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {busy ? <CircleNotch size={18} className="animate-spin" /> : <FileXls size={18} weight="fill" />}
            {busy ? "Đang tạo file…" : "TẠO FILE"}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
