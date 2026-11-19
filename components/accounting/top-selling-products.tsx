"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PackageIcon } from "@phosphor-icons/react";
import type { DashboardTopProducts, TopGroupItem, TopProductItem, TopProductLists } from "@/lib/accounting/dashboard-db";

interface TopSellingProductsProps {
  startDate: string;
  endDate: string;
  storeIds: string[];
  team: string | null;
  /** Tăng khi bấm Refresh / nạp dữ liệu mới để tải lại. */
  reloadKey?: number;
  delay?: number;
  /** Thẻ cùng hàng bên phải (Cost Breakdown). */
  aside?: ReactNode;
}

type Channel = DashboardTopProducts["channels"][number];

type TopTab = "profit" | "revenue" | "loss" | "niche" | "productType";

/** Thẻ trái: Top Products theo SKU; thẻ phải: Top Ngách / Top Phôi. */
type CardKind = "products" | "groups";

/** Số dòng hiện sẵn ở mỗi tab Top (API trả tới 10, bấm "Xem thêm" để mở). */
const ROWS_COLLAPSED = 5;

/** Tab gộp nhiều SKU thành 1 dòng (ngách / phôi), xếp theo Profit. */
const isGroupTab = (tab: TopTab): tab is "niche" | "productType" => tab === "niche" || tab === "productType";

const TABS: { key: TopTab; kind: CardKind; label: string; heading: string; title: string }[] = [
  { key: "profit", kind: "products", label: "Profit", heading: "Top Products", title: "Profit" },
  { key: "revenue", kind: "products", label: "Revenue", heading: "Top Products", title: "Revenue" },
  { key: "loss", kind: "products", label: "Loss", heading: "Top Products", title: "Loss" },
  { key: "niche", kind: "groups", label: "Niche", heading: "Top Niche", title: "Profit" },
  { key: "productType", kind: "groups", label: "Product Type", heading: "Top Product Type", title: "Profit" },
];

function formatCurrency(val: number): string {
  const rounded = Math.round(val);
  const formatted = Math.abs(rounded).toLocaleString("en-US");
  return rounded < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatPercent(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex items-center justify-center" title="Hạng 1 - Huân chương Vàng">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(245,158,11,0.25)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching gold satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#goldRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#goldRibbonR)" />
          {/* Outer gold rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#goldBase)" stroke="#B45309" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#goldFace)" stroke="#FDE047" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#D97706" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 1 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#78350F"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            1
          </text>
          <defs>
            <linearGradient id="goldBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDE047" />
              <stop offset="0.5" stopColor="#F59E0B" />
              <stop offset="1" stopColor="#B45309" />
            </linearGradient>
            <linearGradient id="goldFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FEF08A" />
              <stop offset="0.5" stopColor="#FBBF24" />
              <stop offset="1" stopColor="#D97706" />
            </linearGradient>
            <linearGradient id="goldRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#D97706" />
              <stop offset="1" stopColor="#92400E" />
            </linearGradient>
            <linearGradient id="goldRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#B45309" />
              <stop offset="1" stopColor="#78350F" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (rank === 2) {
    return (
      <div className="flex items-center justify-center" title="Hạng 2 - Huân chương Bạc">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(100,116,139,0.2)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching silver satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#silverRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#silverRibbonR)" />
          {/* Outer silver rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#silverBase)" stroke="#64748B" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#silverFace)" stroke="#FFFFFF" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#94A3B8" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 2 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#334155"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            2
          </text>
          <defs>
            <linearGradient id="silverBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F8FAFC" />
              <stop offset="0.5" stopColor="#CBD5E1" />
              <stop offset="1" stopColor="#64748B" />
            </linearGradient>
            <linearGradient id="silverFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="0.5" stopColor="#E2E8F0" />
              <stop offset="1" stopColor="#94A3B8" />
            </linearGradient>
            <linearGradient id="silverRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#94A3B8" />
              <stop offset="1" stopColor="#475569" />
            </linearGradient>
            <linearGradient id="silverRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#64748B" />
              <stop offset="1" stopColor="#334155" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  if (rank === 3) {
    return (
      <div className="flex items-center justify-center" title="Hạng 3 - Huân chương Đồng">
        <svg
          className="h-7 w-7 drop-shadow-[0_2px_4px_rgba(194,65,12,0.2)] transition-transform duration-200 hover:scale-110"
          viewBox="0 0 28 32"
          fill="none"
        >
          {/* Matching bronze satin ribbons */}
          <path d="M8 17L5 30L11 27.5L15 30L13.5 17" fill="url(#bronzeRibbonL)" />
          <path d="M20 17L23 30L17 27.5L13 30L14.5 17" fill="url(#bronzeRibbonR)" />
          {/* Outer bronze rim */}
          <circle cx="14" cy="13" r="11.5" fill="url(#bronzeBase)" stroke="#9A3412" strokeWidth="0.75" />
          {/* Inner beveled ring */}
          <circle cx="14" cy="13" r="9.5" fill="url(#bronzeFace)" stroke="#FFEDD5" strokeWidth="0.75" />
          <circle cx="14" cy="13" r="8" stroke="#C2410C" strokeWidth="0.5" strokeDasharray="1.5 1.5" opacity="0.6" />
          {/* Number 3 */}
          <text
            x="14"
            y="17.2"
            textAnchor="middle"
            fontSize="12"
            fontWeight="900"
            fill="#431407"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            3
          </text>
          <defs>
            <linearGradient id="bronzeBase" x1="14" y1="1.5" x2="14" y2="24.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDBA74" />
              <stop offset="0.5" stopColor="#FB923C" />
              <stop offset="1" stopColor="#9A3412" />
            </linearGradient>
            <linearGradient id="bronzeFace" x1="14" y1="3.5" x2="14" y2="22.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFEDD5" />
              <stop offset="0.5" stopColor="#F97316" />
              <stop offset="1" stopColor="#C2410C" />
            </linearGradient>
            <linearGradient id="bronzeRibbonL" x1="5" y1="17" x2="15" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#C2410C" />
              <stop offset="1" stopColor="#7C2D12" />
            </linearGradient>
            <linearGradient id="bronzeRibbonR" x1="23" y1="17" x2="13" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#9A3412" />
              <stop offset="1" stopColor="#431407" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center">
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200/80 bg-slate-100 font-semibold text-xs text-slate-500">
        {rank}
      </span>
    </div>
  );
}

/** Title sản phẩm trên đơn, bỏ tên brand ở đầu (brand = tên store, vd "Fastpeace Daughter Gifts…" → "Daughter Gifts…"). */
function stripBrand(title: string, storeName: string): string {
  const brand = storeName.trim();
  if (!brand) return title;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title.replace(new RegExp(`^\\s*${escaped}\\b[\\s:,|-]*`, "i"), "").trim();
  return stripped || title;
}

const thumbClass = "h-11 w-11 @max-[560px]:h-9 @max-[560px]:w-9 shrink-0 rounded-lg border border-slate-200/80";

/**
 * Ảnh mockup: di chuột vào hiện ảnh lớn nổi bên cạnh, bấm vào mở ảnh phóng to giữa màn hình (bấm nền / Esc để đóng).
 * Ảnh nổi và ảnh phóng to vẽ qua portal để không bị khung cuộn của bảng cắt mất.
 */
function ProductThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [error, setError] = useState(false);
  const [hoverAt, setHoverAt] = useState<{ top: number; left: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 ${thumbClass}`}>
        <PackageIcon size={22} weight="duotone" />
      </div>
    );
  }

  const PREVIEW = 260;
  const showPreview = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Ưu tiên bên phải ảnh nhỏ; sát mép phải màn hình thì đặt bên trái
    const left = r.right + 12 + PREVIEW > window.innerWidth ? r.left - 12 - PREVIEW : r.right + 12;
    const top = Math.min(Math.max(8, r.top + r.height / 2 - PREVIEW / 2), window.innerHeight - PREVIEW - 8);
    setHoverAt({ top, left });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={showPreview}
        onMouseLeave={() => setHoverAt(null)}
        onClick={() => {
          setHoverAt(null);
          setZoomed(true);
        }}
        title="Bấm để phóng to mockup"
        className="shrink-0 cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onError={() => setError(true)}
          loading="lazy"
          className={`${thumbClass} bg-white object-contain p-0.5 shadow-2xs transition-transform duration-200 hover:scale-105`}
        />
      </button>
      {hoverAt &&
        !zoomed &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60] rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150"
            style={{ top: hoverAt.top, left: hoverAt.left, width: PREVIEW, height: PREVIEW }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="h-full w-full rounded-lg object-contain" />
          </div>,
          document.body,
        )}
      {zoomed &&
        createPortal(
          <div
            role="dialog"
            aria-label={alt}
            onClick={() => setZoomed(false)}
            className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm animate-in fade-in duration-150"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="max-h-[85vh] max-w-[90vw] rounded-2xl bg-white object-contain p-2 shadow-2xl"
            />
          </div>,
          document.body,
        )}
    </>
  );
}

const hasProducts = (lists: TopProductLists) => lists.profit.length + lists.revenue.length + lists.loss.length > 0;

/** Kênh có sản phẩm trong kỳ; không kênh nào có thì giữ các kênh của bộ lọc để hiện trạng thái trống. */
function visibleChannels(data: DashboardTopProducts): Channel[] {
  const withData = data.channels.filter((c) => hasProducts(data[c]));
  return withData.length ? withData : data.channels;
}

export function TopSellingProducts({
  startDate,
  endDate,
  storeIds,
  team,
  reloadKey = 0,
  delay = 160,
  aside,
}: TopSellingProductsProps) {
  // Cache phản hồi theo bộ lọc như Dashboard: quay lại lựa chọn cũ hiển thị ngay.
  const [responses, setResponses] = useState<Record<string, DashboardTopProducts>>({});
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  // Giữ bố cục kênh của lần tải trước trong lúc chờ để hàng không nhảy.
  const [lastChannels, setLastChannels] = useState<Channel[]>(["FBA", "FBM"]);

  const queryKey = `${startDate}|${endDate}|${storeIds.join(",")}|${team || ""}`;
  const requestKey = `${queryKey}|${reloadKey}`;
  const data = responses[queryKey];
  const loading = settled?.key !== requestKey;
  const error = loading ? null : settled.error;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    if (storeIds.length) params.set("store_ids", storeIds.join(","));
    if (team) params.set("team", team);
    fetch(`/api/accounting/dashboard/top-products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Failed to load data (${res.status})`);
        const result = payload as DashboardTopProducts;
        setResponses((prev) => ({ ...prev, [queryKey]: result }));
        const shown = visibleChannels(result);
        if (shown.length) setLastChannels(shown);
        setSettled({ key: requestKey, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ key: requestKey, error: err instanceof Error ? err.message : "Failed to load data" });
      });
    return () => controller.abort();
    // startDate / endDate / storeIds / team đều nằm trong requestKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // Thẻ trái: Top Products (Profit / Revenue / Loss theo SKU), mặc định FBA. Thẻ phải: Top Ngách / Top Phôi, mặc định FBM.
  // Lọc có cả 2 kênh thì bấm nhãn FBA / FBM trên mỗi thẻ để đổi kênh; chỉ 1 kênh thì cả 2 thẻ cùng kênh đó.
  const shown = data ? visibleChannels(data) : [];
  const channels: Channel[] = shown.length ? shown : lastChannels;
  const multiStore = storeIds.length !== 1;
  const cards: { kind: CardKind; defaultChannel: Channel }[] = [
    { kind: "products", defaultChannel: channels.includes("FBA") ? "FBA" : channels[0] },
    { kind: "groups", defaultChannel: channels.includes("FBM") ? "FBM" : channels[0] },
  ];

  return (
    <div className={`grid gap-4 ${aside ? "@min-[900px]:grid-cols-3" : "@min-[900px]:grid-cols-2"}`}>
      {cards.map(({ kind, defaultChannel }, i) => (
        <div key={kind} className="min-w-0">
          <ChannelTopCard
            kind={kind}
            channels={channels}
            defaultChannel={defaultChannel}
            data={data}
            loading={loading}
            error={error}
            multiStore={multiStore}
            delay={delay + i * 30}
          />
        </div>
      ))}
      {aside}
    </div>
  );
}

function ChannelTopCard({
  kind,
  channels,
  defaultChannel,
  data,
  loading,
  error,
  multiStore,
  delay,
}: {
  kind: CardKind;
  channels: Channel[];
  defaultChannel: Channel;
  data: DashboardTopProducts | undefined;
  loading: boolean;
  error: string | null;
  multiStore: boolean;
  delay: number;
}) {
  const tabs = TABS.filter((t) => t.kind === kind);
  const [tab, setTab] = useState<TopTab>(tabs[0].key);
  // Kênh người dùng bấm chọn; bộ lọc không còn kênh đó thì quay về kênh mặc định của thẻ.
  const [pickedChannel, setPickedChannel] = useState<Channel | null>(null);
  const channel: Channel = pickedChannel && channels.includes(pickedChannel) ? pickedChannel : defaultChannel;
  const lists: TopProductLists | undefined = data?.[channel];
  const grouped = isGroupTab(tab);
  // Mỗi tab mặc định 5 dòng, bấm "Xem thêm" mở tới 10 (giữ trạng thái khi đổi tab / kênh)
  const [expanded, setExpanded] = useState(false);
  const allProducts: TopProductItem[] = grouped ? [] : (lists?.[tab] ?? []);
  const allGroups: TopGroupItem[] = grouped ? (lists?.[tab] ?? []) : [];
  const products = expanded ? allProducts : allProducts.slice(0, ROWS_COLLAPSED);
  const groups = expanded ? allGroups : allGroups.slice(0, ROWS_COLLAPSED);
  const totalRows = grouped ? allGroups.length : allProducts.length;
  const rowCount = totalRows;
  const itemLabel = grouped ? (tab === "niche" ? "niche" : "product type") : "sản phẩm";
  const activeTab = TABS.find((t) => t.key === tab)!;
  const groupLabel = tab === "niche" ? "niche" : "product type";

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className="acc-rise @container flex h-full flex-col rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
          {channels.length > 1 ? (
            <span className="inline-flex rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="Kênh">
              {channels.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={channel === c}
                  onClick={() => setPickedChannel(c)}
                  className={`cursor-pointer rounded px-1.5 py-0.5 text-[12px] font-bold transition-colors ${
                    channel === c
                      ? c === "FBM"
                        ? "bg-violet-50 text-violet-600 shadow-2xs"
                        : "bg-sky-50 text-sky-600 shadow-2xs"
                      : "text-slate-400 hover:text-slate-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </span>
          ) : (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[12px] font-bold ${
                channel === "FBM" ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"
              }`}
            >
              {channel}
            </span>
          )}
          <span>
            {activeTab.heading} (by{" "}
            <span className={`font-extrabold ${tab === "loss" ? "text-rose-600" : "text-emerald-600"}`}>{activeTab.title}</span>)
          </span>
        </h2>
        <div role="tablist" className="flex rounded-lg bg-slate-100 p-0.5 text-[12.5px] font-semibold">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
                tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table content */}
      {!lists && loading ? (
        <div className="flex flex-col gap-2 py-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : !lists && error ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <p className="text-sm font-semibold text-rose-600">Không tải được Top sản phẩm</p>
          <p className="mt-1 text-xs text-slate-400">{error}</p>
        </div>
      ) : rowCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <PackageIcon size={24} weight="duotone" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            {grouped ? `Chưa có dữ liệu theo ${groupLabel}` : tab === "loss" ? "Không có sản phẩm lỗ" : "Chưa có dữ liệu sản phẩm"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {grouped
              ? `Không có SKU ${channel} nào được khai báo ${groupLabel} trong Bảng mã có số liệu trong khoảng thời gian hoặc bộ lọc đã chọn.`
              : tab === "loss"
                ? `Không có SKU ${channel} nào có profit âm trong khoảng thời gian hoặc bộ lọc đã chọn.`
                : `Không tìm thấy đơn ${channel} nào trong khoảng thời gian hoặc bộ lọc đã chọn.`}
          </p>
        </div>
      ) : (
        <div className={`mt-1 overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Luôn hiện đủ cột chỉ số; tên phôi + SKU co lại (cắt "…") theo độ rộng thẻ, thẻ hẹp thì thu nhỏ ảnh/khoảng cách; màn quá hẹp mới cuộn ngang */}
          <table className="w-full min-w-[440px] text-left">
            <thead>
              <tr className="bg-slate-50/90 text-[12px] font-semibold text-slate-500">
                <th className="rounded-l-lg py-2.5 pl-2 pr-1 text-center w-10">#</th>
                <th className="py-2.5 px-2">{tab === "niche" ? "Niche" : tab === "productType" ? "Product Type" : "Product / SKU"}</th>
                <th className="py-2.5 px-2 @max-[560px]:px-1.5 text-right">Units</th>
                <th className={`py-2.5 px-2 @max-[560px]:px-1.5 text-right ${tab === "revenue" ? "font-bold text-slate-800" : ""}`}>Revenue</th>
                <th
                  className={`py-2.5 px-2 @max-[560px]:px-1.5 text-right ${
                    tab === "revenue" ? "" : tab === "loss" ? "font-bold text-rose-600" : "font-bold text-emerald-600"
                  }`}
                >
                  Profit
                </th>
                <th className="py-2.5 px-2 @max-[560px]:px-1.5 text-right" title="Margin = Profit / Revenue">Margin</th>
                <th className="py-2.5 pl-2 pr-3 text-right">TACOS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[13px]">
              {groups.map((g, index) => (
                <tr key={g.name} className="group transition-colors hover:bg-slate-50/60">
                  <td className="py-3 pl-2 pr-1 text-center align-middle">
                    <RankBadge rank={index + 1} />
                  </td>
                  <td className="w-full max-w-0 py-3 px-2 @max-[560px]:px-1.5 align-middle">
                    <div className="flex items-center gap-3 @max-[560px]:gap-2">
                      <ProductThumbnail src={g.imageUrl} alt={g.name} />
                      <div className="min-w-0">
                        <p title={g.name} className="truncate text-[13px] font-semibold text-slate-800 transition-colors group-hover:text-blue-600">
                          {g.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11.5px] font-medium text-slate-500" title={g.storeNames.join(", ")}>
                          {g.skuCount.toLocaleString("en-US")} SKU
                          {multiStore && g.storeNames.length > 0 && (
                            <span className="text-slate-400">
                              {" "}· {g.storeNames.length === 1 ? g.storeNames[0] : `${g.storeNames.length} store`}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                    {g.units.toLocaleString("en-US")}
                  </td>
                  <td className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                    {formatCurrency(g.revenue)}
                  </td>
                  <td
                    className="py-3 px-2 @max-[560px]:px-1.5 text-right font-bold align-middle tabular-nums text-sm"
                    style={{ color: g.profit >= 0 ? "#16a34a" : "#e11d48" }}
                  >
                    {formatCurrency(g.profit)}
                  </td>
                  <td
                    className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm"
                    style={g.margin < 0 ? { color: "#e11d48" } : undefined}
                  >
                    {g.revenue > 0 ? formatPercent(g.margin) : "—"}
                  </td>
                  <td className="py-3 pl-2 pr-3 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                    {g.tacos > 0 ? formatPercent(g.tacos) : "—"}
                  </td>
                </tr>
              ))}
              {products.map((p, index) => {
                const rank = index + 1;
                return (
                  <tr key={`${p.storeId}-${p.sku}-${p.asin ?? ""}`} className="group transition-colors hover:bg-slate-50/60">
                    {/* Huy chương cho top 3 Profit / Revenue; Top Loss chỉ đánh số */}
                    <td className="py-3 pl-2 pr-1 text-center align-middle">
                      {tab === "loss" ? (
                        <div className="flex items-center justify-center">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-rose-200 bg-rose-50 font-semibold text-xs text-rose-600">
                            {rank}
                          </span>
                        </div>
                      ) : (
                        <RankBadge rank={rank} />
                      )}
                    </td>

                    {/* Product image, name, SKU, store; max-w-0 + w-full để tên co theo độ rộng thẻ */}
                    <td className="w-full max-w-0 py-3 px-2 @max-[560px]:px-1.5 align-middle">
                      <div className="flex items-center gap-3 @max-[560px]:gap-2">
                        <ProductThumbnail src={p.imageUrl} alt={p.productName} />
                        <div className="min-w-0">
                          {/* Title sản phẩm trên đơn (bỏ brand), cắt "…" theo độ rộng; di chuột xem đủ title */}
                          <p
                            title={p.productName}
                            className="truncate text-[13px] font-semibold text-slate-800 transition-colors group-hover:text-blue-600"
                          >
                            {stripBrand(p.productName, p.storeName)}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[11.5px] font-medium text-slate-500">
                            {p.sku}
                            {multiStore && <span className="font-sans text-slate-400"> · {p.storeName}</span>}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Chỉ Profit in đậm; các chỉ số khác chữ thường */}
                    <td className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                      {p.units.toLocaleString("en-US")}
                    </td>
                    <td className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                      {formatCurrency(p.revenue)}
                    </td>
                    {/* Profit: dương xanh, âm đỏ (inline như bản cũ để không bị style bảng đè) */}
                    <td
                      className="py-3 px-2 @max-[560px]:px-1.5 text-right font-bold align-middle tabular-nums text-sm"
                      style={{ color: p.profit >= 0 ? "#16a34a" : "#e11d48" }}
                    >
                      {formatCurrency(p.profit)}
                    </td>
                    {/* Margin = Profit / Revenue; âm thì đỏ */}
                    <td
                      className="py-3 px-2 @max-[560px]:px-1.5 text-right font-normal text-slate-700 align-middle tabular-nums text-sm"
                      style={p.margin < 0 ? { color: "#e11d48" } : undefined}
                    >
                      {p.revenue > 0 ? formatPercent(p.margin) : "—"}
                    </td>
                    <td className="py-3 pl-2 pr-3 text-right font-normal text-slate-700 align-middle tabular-nums text-sm">
                      {p.tacos > 0 ? formatPercent(p.tacos) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalRows > ROWS_COLLAPSED && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 w-full cursor-pointer rounded-lg py-2 text-[12.5px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              {expanded ? "Thu gọn" : `Xem thêm ${totalRows - ROWS_COLLAPSED} ${itemLabel}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
