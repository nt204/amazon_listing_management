"use client";

// Tab Manual Bid: tìm SKU → toàn bộ target trong mọi campaign, phân nấc ACOS, sửa bid hàng loạt → Action Queue.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PpcAction, SkuRecommendationGroup } from "@/lib/ppc/sku-architecture-types";
import type { PpcSkuDailyTrendPoint } from "@/lib/ppc/types";
import { SkuTrendSparkline } from "./ppc-sku-trend-modal";
import {
  EMPTY_SKU_FILTER,
  MANUAL_BID_TIERS,
  applyBidOp,
  SKU_METRICS,
  activeRanges,
  facetOptions,
  filterSkusExceptTier,
  searchTokens,
  type MetricRange,
  type SkuListFilter,
  type SkuMetricKey,
  manualBidTier,
  minBidFor,
  type BulkBidOp,
  type ManualBidTier,
} from "@/lib/ppc/manual-bid";

interface ManualBidRow {
  key: string;
  storeId: string;
  adType: string;
  runType: string;
  campaignId: string;
  campaignName: string;
  campaignState: string;
  adGroupState: string;
  adGroupId: string;
  adGroupName: string;
  targetId: string;
  keyword: string;
  matchType: string;
  state: string;
  bid: number;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  cpc: number;
  searchVolume: number | null;
  organicRank: number | null;
  sponsoredRank: number | null;
}

type Row = ManualBidRow & { tier: ManualBidTier; acos: number | null };

type SkuMetrics = { targets: number; clicks: number; spend: number; sales: number; orders: number };
type SkuChannel = "FBA" | "FBM" | "";
type SkuSummaryItem = { sku: string; channel?: SkuChannel; all: SkuMetrics; active: SkuMetrics };
type ChannelPage = "FBA" | "FBM" | "OTHER";
type ChannelCounts = Record<ChannelPage, { all: number; active: number }>;
type SkuSummary = { items: SkuSummaryItem[]; hasChannels: boolean; counts: ChannelCounts | null };

/** Dòng bảng SKU: số liệu cộng từ target (khớp màn target), thông tin phôi/ảnh/BE lấy từ tab Auto Bid. */
type SkuRow = SkuMetrics & {
  sku: string;
  channel: SkuChannel;
  acos: number;
  asin: string;
  productType: string;
  niche: string;
  picMkt: string;
  mockupUrl: string | null;
  breakEvenAcos: number;
};
/** factor: hệ số đã gõ ở ô × (0.95 → hiện 95%); bid gõ tay thì không có. */
type Draft = { kind: "bid"; bid: number; factor?: number } | { kind: "pause" };
type SortKey = "spend" | "clicks" | "orders" | "acos" | "bid" | "cpc" | "sales" | "keyword" | "matchType" | "campaignName"
  | "searchVolume" | "organicRank" | "sponsoredRank" | "impressions";

interface Props {
  isActive: boolean;
  selectedStore: string;
  selectedDays: number;
  actionQueue: PpcAction[];
  skuGroups: SkuRecommendationGroup[];
  skuTrends?: Map<string, PpcSkuDailyTrendPoint[]>;
  onOpenSkuTrend?: (data: { sku: string; storeName: string; mockupUrl?: string | null; dailyTrend: PpcSkuDailyTrendPoint[] }) => void;
  notify: (message: string, type?: "success" | "error") => void;
  onQueued: () => void;
}

const TIER_STYLE: Record<ManualBidTier, { dot: string; chip: string; chipOn: string; text: string }> = {
  A20: { dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50/60", chipOn: "border-emerald-600 bg-emerald-600 text-white", text: "text-emerald-700" },
  A40: { dot: "bg-sky-500", chip: "border-sky-200 bg-sky-50/60", chipOn: "border-sky-600 bg-sky-600 text-white", text: "text-sky-700" },
  A60: { dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50/60", chipOn: "border-amber-500 bg-amber-500 text-white", text: "text-amber-700" },
  A60P: { dot: "bg-rose-500", chip: "border-rose-200 bg-rose-50/60", chipOn: "border-rose-600 bg-rose-600 text-white", text: "text-rose-700" },
  NO_ORDER: { dot: "bg-fuchsia-600", chip: "border-fuchsia-200 bg-fuchsia-50/60", chipOn: "border-fuchsia-700 bg-fuchsia-700 text-white", text: "text-fuchsia-700" },
  OTHER: { dot: "bg-slate-300", chip: "border-slate-200 bg-slate-50", chipOn: "border-slate-600 bg-slate-600 text-white", text: "text-slate-500" },
};

const money = (n: number) => `$${n.toFixed(2)}`;
const int = (n: number) => n.toLocaleString("en-US");

function thumb(url: string | null | undefined, w = 64): string | null {
  if (!url) return null;
  const t = url.trim();
  if (t.includes("media-amazon.com") || t.includes("images-amazon.com")) {
    if (/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/.test(t)) return t.replace(/\._[A-Za-z0-9_,]+_\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    if (/\/images\/I\/[A-Za-z0-9%_+-]+\.([a-zA-Z]+)(?:\?.*)?$/.test(t)) return t.replace(/\.([a-zA-Z]+)(?:\?.*)?$/, `._AC_SR${w},${w}_.$1`);
    return t;
  }
  if (t.startsWith("http://") || t.startsWith("https://")) return `/api/accounting/inventory/mockup-proxy?w=${w}&url=${encodeURIComponent(t)}`;
  return t;
}

export function MockupHoverZoom({
  url,
  sku,
  size = 32,
  className = "",
}: {
  url?: string | null;
  sku?: string;
  size?: number;
  className?: string;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  if (!url) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`inline-block shrink-0 rounded border border-slate-200 bg-slate-100 ${className}`}
      />
    );
  }

  const thumbSrc = thumb(url, 64) || url;
  const zoomSrc = thumb(url, 400) || url;

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const boxW = 220;
        const boxH = 236;
        const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
        const winH = typeof window !== "undefined" ? window.innerHeight : 800;

        let left = r.right + 10;
        if (left + boxW > winW - 16) {
          left = Math.max(16, r.left - boxW - 10);
        }
        const top = Math.max(16, Math.min(r.top - 20, winH - boxH - 16));
        setPos({ top, left });
      }}
      onMouseLeave={() => setPos(null)}
    >
      <img
        src={thumbSrc}
        alt={sku || "mockup"}
        loading="lazy"
        style={{ width: size, height: size }}
        className="rounded border border-slate-200 object-cover cursor-pointer hover:ring-2 hover:ring-indigo-400 transition"
      />
      {pos && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-xl border border-slate-200 bg-white p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-100 flex flex-col items-center gap-1.5"
          style={{
            top: pos.top,
            left: pos.left,
            width: 220,
            height: 236,
          }}
        >
          <img
            src={zoomSrc}
            alt={sku || "mockup zoom"}
            className="h-[196px] w-[204px] rounded-lg object-contain bg-slate-50"
          />
          {sku && (
            <span className="max-w-[200px] truncate text-[11px] font-mono font-semibold text-slate-700">
              {sku}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const INACTIVE = new Set(["paused", "archived", "disabled"]);

type TargetScope = "active" | "all";

/** Target chạy thật: target, ad group và campaign đều không tạm dừng / lưu trữ. */
function isLive(r: ManualBidRow) {
  return !INACTIVE.has(r.state) && !INACTIVE.has(r.campaignState) && !INACTIVE.has(r.adGroupState);
}

function targetTypeOf(r: ManualBidRow): "EXACT" | "PHRASE" | "PRODUCT" {
  const m = r.matchType.toLowerCase();
  if (m.includes("exact")) return "EXACT";
  if (m.includes("phrase") || m.includes("broad")) return "PHRASE";
  return "PRODUCT";
}

type ColKey =
  | "cb"
  | "idx"
  | "target"
  | "sv"
  | "org"
  | "sp"
  | "matchType"
  | "campaign"
  | "impr"
  | "clicks"
  | "orders"
  | "spend"
  | "sales"
  | "acos"
  | "cpc"
  | "bid"
  | "newBid";

const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  cb: 34,
  idx: 38,
  target: 220,
  sv: 72,
  org: 50,
  sp: 50,
  matchType: 105,
  campaign: 380,
  impr: 75,
  clicks: 65,
  orders: 65,
  spend: 80,
  sales: 80,
  acos: 95,
  cpc: 75,
  bid: 85,
  newBid: 100,
};

const TIER_NUM_BG: Record<ManualBidTier, string> = {
  A20: "bg-emerald-300",
  A40: "bg-sky-300",
  A60: "bg-amber-300",
  A60P: "bg-rose-300",
  NO_ORDER: "bg-fuchsia-300",
  OTHER: "bg-slate-200",
};

const TIER_ROW_BG: Record<ManualBidTier, string> = {
  A20: "bg-emerald-50",
  A40: "bg-sky-50",
  A60: "bg-amber-50",
  A60P: "bg-rose-50",
  NO_ORDER: "bg-fuchsia-50",
  OTHER: "bg-white",
};

const TIER_BORDER: Record<ManualBidTier, string> = {
  A20: "border-l-4 border-l-emerald-500",
  A40: "border-l-4 border-l-sky-500",
  A60: "border-l-4 border-l-amber-500",
  A60P: "border-l-4 border-l-rose-500",
  NO_ORDER: "border-l-4 border-l-fuchsia-500",
  OTHER: "border-l-4 border-l-slate-200",
};

function ColumnFilterMenu({
  distinctItems,
  selectedSet,
  onApply,
  onSort,
  onClose,
}: {
  title: string;
  colKey: string;
  distinctItems: Array<{ key: string; label: string; count: number }>;
  selectedSet?: Set<string>;
  onApply: (selected: Set<string> | null) => void;
  onSort: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  // Chọn / bỏ là lọc ngay, không cần bấm OK. Không chọn gì = không lọc.
  const [search, setSearch] = useState("");
  const allKeys = distinctItems.map((it) => it.key);
  const checked = selectedSet && selectedSet.size > 0 ? selectedSet : new Set(allKeys);
  const isAll = checked.size === allKeys.length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? distinctItems.filter((it) => it.label.toLowerCase().includes(q)) : distinctItems;
  }, [distinctItems, search]);

  const commit = (next: Set<string>) => onApply(next.size === 0 || next.size === allKeys.length ? null : next);
  const toggle = (k: string) => {
    const next = new Set(checked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (next.size === 0) return; // luôn giữ ít nhất 1 giá trị
    commit(next);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-60 rounded-lg border border-slate-200 bg-white p-1.5 text-left text-[12px] font-normal normal-case tracking-normal text-slate-700 shadow-xl"
    >
      <div className="flex gap-1 p-0.5">
        <button
          type="button"
          onClick={() => { onSort(1); onClose(); }}
          className="h-7 flex-1 cursor-pointer rounded-md bg-slate-100 font-medium text-slate-700 hover:bg-slate-200"
        >
          ↑ Tăng
        </button>
        <button
          type="button"
          onClick={() => { onSort(-1); onClose(); }}
          className="h-7 flex-1 cursor-pointer rounded-md bg-slate-100 font-medium text-slate-700 hover:bg-slate-200"
        >
          ↓ Giảm
        </button>
      </div>

      {distinctItems.length > 0 && (
        <>
          <div className="my-1.5 h-px bg-slate-100" />
          {distinctItems.length > 8 && (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm…"
              className="mb-1 h-7 w-full rounded-md border border-slate-200 px-2 outline-none focus:border-indigo-400"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {shown.map((it) => {
              const on = checked.has(it.key);
              return (
                <div
                  key={it.key}
                  onClick={() => toggle(it.key)}
                  className="group flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-slate-50"
                >
                  <input type="checkbox" checked={on} readOnly className="pointer-events-none h-3.5 w-3.5 accent-indigo-600" />
                  <span className={`flex-1 truncate ${on ? "text-slate-800" : "text-slate-400"}`} title={it.label}>{it.label}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); commit(new Set([it.key])); }}
                    className="hidden cursor-pointer rounded px-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 group-hover:block"
                  >
                    Chỉ
                  </button>
                  <span className="tabular-nums text-slate-400 group-hover:hidden">{it.count}</span>
                </div>
              );
            })}
            {shown.length === 0 && <div className="px-2 py-2 text-slate-400">Không có giá trị</div>}
          </div>
          {!isAll && (
            <>
              <div className="my-1.5 h-px bg-slate-100" />
              <button
                type="button"
                onClick={() => onApply(null)}
                className="h-7 w-full cursor-pointer rounded-md font-medium text-indigo-600 hover:bg-indigo-50"
              >
                Bỏ lọc cột này
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function PpcManualBidView({
  isActive, selectedStore, selectedDays, actionQueue, skuGroups, skuTrends, onOpenSkuTrend, notify, onQueued,
}: Props) {
  // query = SKU người dùng bấm Xem; result.key cho biết dữ liệu đang hiển thị ứng với store/kỳ/SKU nào.
  const [query, setQuery] = useState<{ sku: string; nonce: number } | null>(null);
  const [result, setResult] = useState<{
    key: string;
    sku: string;
    items: ManualBidRow[];
    reportRange: { start: string; end: string } | null;
    error: string | null;
    /** "active" = chỉ target đang chạy; "all" = cả campaign đã tắt (bấm Tất cả mới tải). */
    scope: TargetScope;
  } | null>(null);
  const reqKey = query ? `${selectedStore}|${selectedDays}|${query.sku}|${query.nonce}` : "";
  const [activeOnly, setActiveOnly] = useState(true);
  const needScope: TargetScope = activeOnly ? "active" : "all";
  // Đã có bản "all" thì đủ cho cả Active (lọc tại chỗ); đang có bản "active" mà bấm Tất cả thì tải thêm.
  const loading = Boolean(query) && (result?.key !== reqKey || (needScope === "all" && result?.scope !== "all"));
  const refreshing = loading && Boolean(result && !result.error && query && result.sku === query.sku.toUpperCase());
  const sku = loading && !refreshing ? "" : result?.sku || "";
  const rows = useMemo(() => result?.items || [], [result]);
  const error = result?.error || null;

  const [runType, setRunType] = useState<string>("SP03");
  // Lọc nhiều nấc cùng lúc; "Đã sửa" gom các target đã chỉnh bid của cả SKU (bỏ qua dạng chạy đang chọn).
  const [tierSet, setTierSet] = useState<ManualBidTier[]>([]);
  const [editedOnly, setEditedOnly] = useState(false);
  const [keywordFilter, setKeywordFilter] = useState("");
  // Mặc định: trong mỗi nấc xếp ACOS cao → thấp (bằng nhau thì spend cao trước).
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "acos", dir: -1 });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [opValue, setOpValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const lastClickedRef = useRef<string | null>(null);

  // Bộ nhớ đệm target theo store|kỳ|SKU (5 phút): rê chuột vào SKU là tải trước, quay lại SKU / kỳ cũ hiện ngay.
  // Lưu luôn promise nên tải trước và bấm mở cùng lúc chỉ gọi API 1 lần.
  type TargetPayload = { sku: string; items: ManualBidRow[]; reportRange: { start: string; end: string } | null; scope: TargetScope };
  const targetCacheRef = useRef(new Map<string, { at: number; p: Promise<TargetPayload> }>());
  const getTargets = (code: string, scope: TargetScope): Promise<TargetPayload> => {
    const baseKey = `${selectedStore}|${selectedDays}|${code.toUpperCase()}`;
    const key = `${baseKey}|${scope}`;
    const fresh = (k: string) => {
      const h = targetCacheRef.current.get(k);
      return h && Date.now() - h.at < CACHE_MS ? h : null;
    };
    const hit = fresh(key) || (scope === "active" ? fresh(`${baseKey}|all`) : null);
    if (hit) return hit.p;
    // Gửi sẵn ASIN (đã có trong danh sách SKU) để API khỏi dò lại trong bảng facts.
    const knownAsin = skuGroups.find((g) => g.sku.toUpperCase() === code.toUpperCase())?.asin || "";
    const url = `/api/ppc/manual-bid?storeName=${encodeURIComponent(selectedStore)}&days=${selectedDays}&sku=${encodeURIComponent(code)}${knownAsin ? `&asin=${encodeURIComponent(knownAsin)}` : ""}${scope === "active" ? "&active=1" : ""}`;
    const promise = fetch(url, { cache: "no-store" }).then(async (res) => {
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || "Không tải được target.");
      return { sku: String(data.sku), items: data.items || [], reportRange: data.reportRange || null, scope };
    });
    promise.catch(() => targetCacheRef.current.delete(key));
    targetCacheRef.current.set(key, { at: Date.now(), p: promise });
    return promise;
  };
  const prefetchTargets = (code: string) => { getTargets(code, needScope).catch(() => undefined); };

  // Tải target khi mở SKU hoặc đổi số ngày báo cáo.
  useEffect(() => {
    if (!query || !isActive || !selectedStore || selectedStore === "ALL") return;
    if (result?.key === reqKey && (result.scope === "all" || needScope === "active")) return;
    // Cùng lần mở, chỉ tải thêm target đã tắt (bấm Tất cả) → giữ nguyên bid đang sửa dở và dòng đang chọn.
    const expanding = result?.key === reqKey;
    let cancelled = false;
    getTargets(query.sku, needScope)
      .then((data) => {
        if (cancelled) return;
        const sameSku = result?.sku === data.sku;
        const items = data.items;
        setResult({ key: reqKey, sku: data.sku, items, reportRange: data.reportRange, error: null, scope: data.scope });
        if (!expanding) {
          setDrafts(new Map());
          setSelected(new Set());
        }
        if (!sameSku) {
          const hasSp03 = items.some((it: ManualBidRow) => it.runType === "SP03");
          if (hasSp03) {
            setRunType("SP03");
          } else {
            const firstSp = items.find((it: ManualBidRow) => it.runType.startsWith("SP"));
            setRunType(firstSp ? firstSp.runType : (items[0]?.runType || "SP03"));
          }
          setTierSet([]);
          setEditedOnly(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setResult({ key: reqKey, sku: query.sku, items: [], reportRange: null, error: e instanceof Error ? e.message : "Không tải được target.", scope: needScope });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getTargets đọc store/kỳ/skuGroups mới nhất; chỉ chạy lại khi đổi yêu cầu
  }, [query, reqKey, isActive, selectedStore, selectedDays, result, needScope]);

  // Trang FBA / FBM / Khác (store có bảng mã FBM). Mở tab vào trang đã chọn lần trước — lưu theo tài khoản;
  // chỉ tải SKU của trang đang xem, trang khác bấm vào mới tải.
  const [channel, setChannelState] = useState<ChannelPage | null>(null);
  useEffect(() => {
    if (!isActive || channel) return;
    let cancelled = false;
    fetch("/api/settings/ui-preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const c = d?.preferences?.manualBidChannel;
        if (!cancelled) setChannelState(c === "FBM" || c === "OTHER" ? c : "FBA");
      })
      .catch(() => { if (!cancelled) setChannelState("FBA"); });
    return () => { cancelled = true; };
  }, [isActive, channel]);
  const setChannel = (c: ChannelPage) => {
    if (c === channel) return;
    setChannelState(c);
    fetch("/api/settings/ui-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualBidChannel: c }),
    }).catch(() => undefined);
  };

  // Số liệu từng SKU tính từ target (tổng và riêng target active) của trang đang xem.
  const summaryKey = `${selectedStore}|${selectedDays}|${channel ?? ""}`;
  const [summary, setSummary] = useState<({ key: string; channel: ChannelPage } & SkuSummary) | null>(null);
  const summaryCacheRef = useRef(new Map<string, { at: number; p: Promise<SkuSummary> }>());
  useEffect(() => {
    if (!isActive || !selectedStore || selectedStore === "ALL" || !channel) return;
    if (summary?.key === summaryKey) return;
    let cancelled = false;
    const hit = summaryCacheRef.current.get(summaryKey);
    let promise = hit && Date.now() - hit.at < CACHE_MS ? hit.p : null;
    if (!promise) {
      const key = summaryKey;
      promise = fetch(`/api/ppc/manual-bid?storeName=${encodeURIComponent(selectedStore)}&days=${selectedDays}&summary=1&channel=${channel}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d): SkuSummary => ({
          items: Array.isArray(d?.items) ? d.items as SkuSummaryItem[] : [],
          hasChannels: Boolean(d?.hasChannels),
          counts: d?.counts ?? null,
        }));
      promise.catch(() => summaryCacheRef.current.delete(key));
      summaryCacheRef.current.set(key, { at: Date.now(), p: promise });
    }
    promise
      .then((data) => { if (!cancelled) setSummary({ key: summaryKey, channel, ...data }); })
      .catch(() => { if (!cancelled) setSummary({ key: summaryKey, channel, items: [], hasChannels: false, counts: null }); });
    return () => { cancelled = true; };
  }, [isActive, selectedStore, selectedDays, summaryKey, summary, channel]);
  // Cùng trang mà đổi kỳ: giữ bảng cũ (mờ); chuyển sang trang khác: hiện khung tải.
  const samePage = Boolean(summary && summary.channel === channel);
  const skuRefreshing = Boolean(summary && summary.key !== summaryKey && samePage);

  const skuRows: SkuRow[] | null = useMemo(() => {
    if (!summary || !samePage) return null;
    const meta = new Map(skuGroups.map((g) => [g.sku.toUpperCase(), g]));
    return summary.items.map((it) => {
      const m = activeOnly ? it.active : it.all;
      const g = meta.get(it.sku);
      return {
        ...m,
        sku: it.sku,
        channel: (it.channel || "") as SkuChannel,
        acos: m.sales > 0 ? (m.spend / m.sales) * 100 : 0,
        asin: g?.asin || "",
        productType: g?.productType || "",
        niche: g?.niche || "",
        picMkt: g?.picMkt || "",
        mockupUrl: g?.mockupUrl || null,
        breakEvenAcos: g?.breakEvenAcos || 0,
      };
    }).filter((r) => r.targets > 0);
  }, [summary, samePage, skuGroups, activeOnly]);

  // Số SKU trên nút mỗi trang (lấy từ lần tải gần nhất, kể cả khi đang tải trang khác).
  const channelPages = useMemo(() => {
    if (!summary?.hasChannels || !summary.counts) return null;
    const k = activeOnly ? "active" : "all";
    return { FBA: summary.counts.FBA[k], FBM: summary.counts.FBM[k], OTHER: summary.counts.OTHER[k] };
  }, [summary, activeOnly]);
  const pageRows = skuRows;

  const load = (code: string) => {
    const v = code.trim().toUpperCase();
    if (v) {
      setRunType("SP03");
      setQuery({ sku: v, nonce: Date.now() });
    }
  };

  const backToList = () => {
    if (drafts.size > 0 && !window.confirm(`Bỏ ${drafts.size} thay đổi chưa đưa vào hàng đợi?`)) return;
    setDrafts(new Map());
    setSelected(new Set());
    setQuery(null);
  };

  const currentGroup = useMemo(
    () => (query ? skuRows?.find((g) => g.sku === query.sku) : undefined),
    [skuRows, query],
  );

  const skuMockupUrl = useMemo(
    () => currentGroup?.mockupUrl || skuGroups.find((g) => g.sku.toUpperCase() === (query?.sku || "").toUpperCase())?.mockupUrl || null,
    [currentGroup?.mockupUrl, skuGroups, query?.sku],
  );

  const enriched: Row[] = useMemo(() => rows.map((r) => ({
    ...r,
    tier: manualBidTier(r),
    acos: r.sales > 0 ? (r.spend / r.sales) * 100 : null,
  })), [rows]);

  // Bid đang chờ upload trong Action Queue (theo target).
  const queuedByTarget = useMemo(() => {
    const map = new Map<string, PpcAction>();
    for (const a of actionQueue) {
      if (a.targetId) map.set(`${a.campaignId}|${a.targetId}`, a);
    }
    return map;
  }, [actionQueue]);

  const scoped = useMemo(
    () => enriched.filter((r) => (!activeOnly || isLive(r))
      && (!keywordFilter || r.keyword.toLowerCase().includes(keywordFilter.toLowerCase()) || r.campaignName.toLowerCase().includes(keywordFilter.toLowerCase()))),
    [enriched, activeOnly, keywordFilter],
  );

  // Tự động chọn SP03 nếu có, hoặc dạng SP đầu tiên, hoặc dạng có dữ liệu đầu tiên
  useEffect(() => {
    if (scoped.length === 0) return;
    const hasCurrent = scoped.some((r) => r.runType === runType);
    if (!hasCurrent) {
      const sp03 = scoped.some((r) => r.runType === "SP03");
      if (sp03) {
        setRunType("SP03");
      } else {
        const sp = scoped.find((r) => r.runType.startsWith("SP"));
        setRunType(sp ? sp.runType : scoped[0].runType);
      }
    }
  }, [scoped, runType]);

  // Nhóm theo dạng SP | SB | SD; SP03 luôn đứng đầu
  const runTypeGroups = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const r of scoped) countMap.set(r.runType, (countMap.get(r.runType) || 0) + 1);

    const getFamily = (rt: string) => {
      const u = rt.toUpperCase();
      if (u.startsWith("SP")) return "SP";
      if (u.startsWith("SB")) return "SB";
      if (u.startsWith("SD")) return "SD";
      return "OTHER";
    };

    const families: Record<string, Array<[string, number]>> = { SP: [], SB: [], SD: [], OTHER: [] };
    for (const [rt, n] of countMap.entries()) {
      families[getFamily(rt)].push([rt, n]);
    }

    families.SP.sort((a, b) => {
      if (a[0] === "SP03") return -1;
      if (b[0] === "SP03") return 1;
      return a[0].localeCompare(b[0]);
    });
    families.SB.sort((a, b) => a[0].localeCompare(b[0]));
    families.SD.sort((a, b) => a[0].localeCompare(b[0]));
    families.OTHER.sort((a, b) => a[0].localeCompare(b[0]));

    const res: Array<{ family: string; items: Array<[string, number]> }> = [];
    if (families.SP.length > 0) res.push({ family: "SP", items: families.SP });
    if (families.SB.length > 0) res.push({ family: "SB", items: families.SB });
    if (families.SD.length > 0) res.push({ family: "SD", items: families.SD });
    if (families.OTHER.length > 0) res.push({ family: "OTHER", items: families.OTHER });
    return res;
  }, [scoped]);

  const byRunType = useMemo(() => {
    const list = scoped.filter((r) => r.runType === runType);
    if (list.length > 0) return list;
    if (scoped.length > 0) {
      const sp03 = scoped.find((r) => r.runType === "SP03");
      const fallback = sp03?.runType || scoped.find((r) => r.runType.startsWith("SP"))?.runType || scoped[0].runType;
      return scoped.filter((r) => r.runType === fallback);
    }
    return [];
  }, [scoped, runType]);

  const tierStats = useMemo(() => {
    const stats = new Map<ManualBidTier, { count: number; spend: number; sales: number }>();
    for (const t of MANUAL_BID_TIERS) stats.set(t.key, { count: 0, spend: 0, sales: 0 });
    // Đếm theo danh sách đang xem: bật "Đã sửa" thì chỉ đếm target đã chỉnh bid.
    const base = editedOnly ? scoped.filter((r) => drafts.has(r.key)) : byRunType;
    for (const r of base) {
      const s = stats.get(r.tier)!;
      s.count += 1;
      s.spend += r.spend;
      s.sales += r.sales;
    }
    return stats;
  }, [byRunType, scoped, drafts, editedOnly]);

  const [colFilters, setColFilters] = useState<{
    target?: Set<string>;
    matchType?: Set<string>;
    campaignName?: Set<string>;
    tier?: Set<string>;
  }>({});

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(DEFAULT_COL_WIDTHS);
  const [campaignResized, setCampaignResized] = useState(false);
  const resizingRef = useRef<{ key: ColKey; startX: number; startW: number } | null>(null);

  // Cột Campaign tự giãn theo tên dài nhất của SKU đang xem (1 dòng, không xuống dòng);
  // kéo dãn tay thì giữ độ rộng đã kéo.
  const shownColWidths = useMemo(() => {
    if (campaignResized) return colWidths;
    const longest = rows.reduce((m, r) => Math.max(m, r.campaignName.length + (isLive(r) ? 0 : 7)), 0);
    const auto = Math.min(760, Math.max(DEFAULT_COL_WIDTHS.campaign, Math.round(longest * 7 + 24)));
    return { ...colWidths, campaign: auto };
  }, [colWidths, campaignResized, rows]);

  const startResize = (key: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (key === "campaign" && !campaignResized) {
      setColWidths((prev) => ({ ...prev, campaign: shownColWidths.campaign }));
      setCampaignResized(true);
    }
    resizingRef.current = { key, startX: e.clientX, startW: shownColWidths[key] };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const minW = resizingRef.current.key === "cb" || resizingRef.current.key === "idx" ? 28 : 50;
      const nextW = Math.max(minW, resizingRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: nextW }));
    };

    const onMouseUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const [activeMenuCol, setActiveMenuCol] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!activeMenuCol) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Bấm lại nút ▾ để tự đóng/mở, không xử lý ở đây (tránh đóng rồi mở lại ngay).
      if (target.closest?.("[data-colmenu-trigger]")) return;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setActiveMenuCol(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveMenuCol(null);
      }
    };
    // Menu nằm cố định trên màn hình: cuộn trang thì đóng để không lệch khỏi cột (cuộn trong menu thì giữ).
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setActiveMenuCol(null);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [activeMenuCol]);

  const targetDistinctItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byRunType) {
      const kw = r.keyword || "—";
      counts.set(kw, (counts.get(kw) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, count]) => ({ key: k, label: k, count }));
  }, [byRunType]);

  const matchTypeDistinctItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byRunType) {
      const m = shortMatch(r.matchType);
      counts.set(m, (counts.get(m) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, count]) => ({ key: k, label: k, count }));
  }, [byRunType]);

  const campaignDistinctItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byRunType) {
      counts.set(r.campaignName, (counts.get(r.campaignName) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, count]) => ({ key: k, label: k, count }));
  }, [byRunType]);

  const acosDistinctItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byRunType) {
      counts.set(r.tier, (counts.get(r.tier) || 0) + 1);
    }
    return MANUAL_BID_TIERS.map((t) => ({
      key: t.key,
      label: t.label,
      count: counts.get(t.key) || 0,
    })).filter((x) => x.count > 0);
  }, [byRunType]);

  const visible = useMemo(() => {
    let list = editedOnly ? scoped.filter((r) => drafts.has(r.key)) : byRunType;
    if (tierSet.length > 0) list = list.filter((r) => tierSet.includes(r.tier));

    if (colFilters.target && colFilters.target.size > 0) {
      list = list.filter((r) => colFilters.target!.has(r.keyword || "—"));
    }
    if (colFilters.matchType && colFilters.matchType.size > 0) {
      list = list.filter((r) => colFilters.matchType!.has(shortMatch(r.matchType)));
    }
    if (colFilters.campaignName && colFilters.campaignName.size > 0) {
      list = list.filter((r) => colFilters.campaignName!.has(r.campaignName));
    }
    if (colFilters.tier && colFilters.tier.size > 0) {
      list = list.filter((r) => colFilters.tier!.has(r.tier));
    }

    const tierOrder = new Map(MANUAL_BID_TIERS.map((t, i) => [t.key, i]));
    return [...list].sort((a, b) => {
      if (editedOnly && a.runType !== b.runType) return a.runType.localeCompare(b.runType);
      if (a.tier !== b.tier) return tierOrder.get(a.tier)! - tierOrder.get(b.tier)!;
      if (sort.key === "keyword") return a.keyword.localeCompare(b.keyword) * sort.dir;
      if (sort.key === "matchType") return shortMatch(a.matchType).localeCompare(shortMatch(b.matchType)) * sort.dir;
      if (sort.key === "campaignName") return a.campaignName.localeCompare(b.campaignName) * sort.dir;
      if (sort.key === "searchVolume" || sort.key === "organicRank" || sort.key === "sponsoredRank") {
        // Target chưa có số liệu luôn nằm cuối, dù sắp tăng hay giảm.
        const va = a[sort.key], vb = b[sort.key];
        if (va == null || vb == null) return va == null && vb == null ? 0 : va == null ? 1 : -1;
        return (va - vb) * sort.dir;
      }
      if (sort.key === "acos") {
        // Chưa tiêu tiền (không có ACOS) luôn nằm cuối; tiêu tiền mà chưa có sales coi như ACOS cao nhất.
        const idle = (r: Row) => r.acos == null && r.spend <= 0;
        if (idle(a) !== idle(b)) return idle(a) ? 1 : -1;
      }
      const valA = sort.key === "acos" ? (a.acos ?? (a.spend > 0 ? 9999 : -1)) : a[sort.key];
      const valB = sort.key === "acos" ? (b.acos ?? (b.spend > 0 ? 9999 : -1)) : b[sort.key];
      return (valA - valB) * sort.dir || b.spend - a.spend || b.clicks - a.clicks;
    });
  }, [byRunType, scoped, drafts, editedOnly, tierSet, colFilters, sort]);

  const editedCount = useMemo(() => scoped.filter((r) => drafts.has(r.key)).length, [scoped, drafts]);

  const groups = useMemo(() => {
    const out: Array<{ tier: ManualBidTier; rows: Row[] }> = [];
    for (const r of visible) {
      const last = out[out.length - 1];
      if (last && last.tier === r.tier) last.rows.push(r);
      else out.push({ tier: r.tier, rows: [r] });
    }
    return out;
  }, [visible]);

  const visibleKeys = useMemo(() => visible.map((r) => r.key), [visible]);
  const selectedVisible = useMemo(() => visibleKeys.filter((k) => selected.has(k)), [visibleKeys, selected]);

  const toggleKeys = (keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const onRowCheck = (key: string, shift: boolean) => {
    const last = lastClickedRef.current;
    if (shift && last && last !== key) {
      const a = visibleKeys.indexOf(last);
      const b = visibleKeys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const range = visibleKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
        toggleKeys(range, !selected.has(key));
        lastClickedRef.current = key;
        return;
      }
    }
    toggleKeys([key], !selected.has(key));
    lastClickedRef.current = key;
  };

  // Chọn bằng chuột như "tô":
  // - Bấm 1 dòng: tích / bỏ tích đúng dòng đó.
  // - Nhấn giữ rồi kéo: vùng từ dòng bắt đầu tới dòng đang trỏ được tích (bắt đầu ở dòng đã tích thì là bỏ tích);
  //   kéo ngược lại thì các dòng rút khỏi vùng trở về như cũ, quay về đúng dòng bắt đầu là huỷ cả vùng.
  // - Các dòng đã chọn ngoài vùng kéo giữ nguyên.
  const dragRef = useRef<{ anchor: number; key: string; on: boolean; base: Set<string>; moved: boolean } | null>(null);
  const opInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const end = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      if (!d.moved) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(d.key)) next.delete(d.key);
          else next.add(d.key);
          return next;
        });
      }
      // Chọn xong: đưa con trỏ vào ô × để gõ hệ số rồi Enter ngay.
      requestAnimationFrame(() => opInputRef.current?.focus());
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  const startRowDrag = (idx: number, key: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.preventDefault(); // không bôi đen chữ khi kéo
    if (e.shiftKey) {
      onRowCheck(key, true);
      return;
    }
    dragRef.current = { anchor: idx, key, on: !selected.has(key), base: new Set(selected), moved: false };
    lastClickedRef.current = key;
  };

  const enterRowDrag = (idx: number) => {
    const d = dragRef.current;
    if (!d || (!d.moved && idx === d.anchor)) return;
    if (!d.moved) {
      d.moved = true;
      setOpValue(""); // bắt đầu quét cụm mới → xoá hệ số cũ
    }
    const next = new Set(d.base);
    if (idx !== d.anchor) {
      for (const k of visibleKeys.slice(Math.min(d.anchor, idx), Math.max(d.anchor, idx) + 1)) {
        if (d.on) next.add(k);
        else next.delete(k);
      }
    }
    setSelected(next);
    lastClickedRef.current = visibleKeys[idx];
  };

  const setDraft = (key: string, draft: Draft | null) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (draft) next.set(key, draft);
      else next.delete(key);
      return next;
    });
  };

  const rowByKey = useMemo(() => new Map(enriched.map((r) => [r.key, r])), [enriched]);

  const applyToSelected = (op: BulkBidOp) => {
    if (selectedVisible.length === 0) return;
    const next = new Map(drafts);
    let skipped = 0;
    for (const k of selectedVisible) {
      const r = rowByKey.get(k);
      if (!r) continue;
      const nb = applyBidOp(op, r);
      if (nb == null) { skipped += 1; continue; }
      if (Math.abs(nb - r.bid) < 0.005) next.delete(k);
      else next.set(k, { kind: "bid", bid: nb, factor: op.kind === "mul" ? op.value : undefined });
    }
    setDrafts(next);
    if (skipped > 0) notify(`${skipped} target chưa có click nên giữ nguyên bid.`, "error");
  };

  const runOp = () => {
    const v = parseFloat(opValue.replace(",", "."));
    if (!Number.isFinite(v)) return;
    applyToSelected({ kind: "mul", value: v });
    // Áp xong thì bỏ chọn: cụm tiếp theo quét lại từ đầu, không nhân thêm lần nữa lên cụm vừa sửa.
    setSelected(new Set());
  };

  const pauseSelected = () => {
    setDrafts((prev) => {
      const next = new Map(prev);
      for (const k of selectedVisible) next.set(k, { kind: "pause" });
      return next;
    });
  };

  const draftCount = drafts.size;

  const submit = async () => {
    if (draftCount === 0 || submitting) return;
    const items: unknown[] = [];
    const stamp = Date.now();
    for (const [k, d] of drafts) {
      const r = rowByKey.get(k);
      if (!r) continue;
      const recType = d.kind === "pause" ? "PAUSE_TARGET" : d.bid > r.bid ? "BID_INCREASE" : "BID_DECREASE";
      const finalBid = d.kind === "pause" ? r.bid : d.bid;
      items.push({
        recommendation: {
          id: `manual-bid:${r.targetId || r.key}:${stamp}`,
          storeId: r.storeId,
          storeName: selectedStore,
          adType: r.adType,
          recType,
          targetType: targetTypeOf(r),
          matchType: r.matchType,
          keyword: r.keyword,
          campaignName: r.campaignName,
          adGroupName: r.adGroupName,
          sku,
          campaignId: r.campaignId,
          adGroupId: r.adGroupId,
          keywordId: r.targetId,
          currentBid: r.bid,
          recommendedBid: finalBid,
          reason: "Manual bid",
          estimatedSavings: 0,
          status: "PENDING",
          ruleProfile: "manual-bid",
          clicks: r.clicks,
          spend: r.spend,
          sales: r.sales,
          orders: r.orders,
          cpc: r.cpc,
          createdAt: new Date().toISOString(),
        },
        userFinalBid: finalBid,
        decisionSource: "USER_EDIT",
      });
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ppc/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: selectedStore, storeId: rows[0]?.storeId, items }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || "Không đưa được vào hàng đợi.");
      notify(`Đã đưa ${items.length} thay đổi vào hàng đợi.`, "success");
      setDrafts(new Map());
      setSelected(new Set());
      onQueued();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Không đưa được vào hàng đợi.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Enter / ↓ / ↑ / Tab trong ô bid: nhảy dòng như bảng tính Excel.
  const focusBidInput = (index: number) => {
    if (index < 0 || index >= visible.length) return;
    const el = document.querySelector<HTMLInputElement>(`[data-mb-bid="${index}"]`);
    if (el) { el.focus(); el.select(); }
  };

  // Dán nhiều dòng từ Excel vào các ô Bid mới liên tiếp
  const handlePasteBatch = (startIndex: number, values: string[]) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      let count = 0;
      for (let i = 0; i < values.length; i++) {
        const row = visible[startIndex + i];
        if (!row) break;
        const raw = values[i].trim().replace(",", ".");
        const val = parseFloat(raw);
        if (Number.isFinite(val) && val > 0) {
          const nb = Math.round(Math.max(minBidFor(row.adType), Math.min(100, val)) * 100) / 100;
          if (Math.abs(nb - row.bid) < 0.005) {
            next.delete(row.key);
          } else {
            next.set(row.key, { kind: "bid", bid: nb });
            count++;
          }
        }
      }
      if (count > 0) {
        notify(`Đã dán ${count} giá trị bid mới.`, "success");
      }
      return next;
    });
  };

  const totals = useMemo(() => {
    let impressions = 0;
    let clicks = 0;
    let orders = 0;
    let spend = 0;
    let sales = 0;
    for (const r of visible) {
      impressions += r.impressions;
      clicks += r.clicks;
      orders += r.orders;
      spend += r.spend;
      sales += r.sales;
    }
    const acos = sales > 0 ? (spend / sales) * 100 : null;
    const cpc = clicks > 0 ? spend / clicks : 0;
    return { impressions, clicks, orders, spend, sales, acos, cpc };
  }, [visible]);

  const renderAcosBadge = (r: Row) => {
    if (r.sales > 0 && r.acos != null) {
      let colorClass = "bg-rose-100 text-rose-800 border-rose-300";
      if (r.acos <= 20) colorClass = "bg-emerald-100 text-emerald-800 border-emerald-300";
      else if (r.acos <= 40) colorClass = "bg-sky-100 text-sky-800 border-sky-300";
      else if (r.acos <= 60) colorClass = "bg-amber-100 text-amber-800 border-amber-300";
      return (
        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border ${colorClass}`}>
          {r.acos.toFixed(1)}%
        </span>
      );
    }
    if (r.orders === 0 && r.clicks > 7) {
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-300" title="Click > 7, 0 đơn">
          0 đơn ({r.clicks})
        </span>
      );
    }
    return <span className="text-slate-400 font-mono text-[11px]">—</span>;
  };

  const renderHeaderCell = ({
    colKey,
    sortKey,
    label,
    align = "left",
    hasFilter = false,
    distinctItems = [],
  }: {
    colKey: ColKey;
    sortKey?: SortKey;
    label: string;
    align?: "left" | "right" | "center";
    hasFilter?: boolean;
    distinctItems?: Array<{ key: string; label: string; count: number }>;
  }) => {
    const isSorted = sortKey && sort.key === sortKey;
    const filterKey = colKey === "matchType" ? "matchType" : colKey === "campaign" ? "campaignName" : colKey === "acos" ? "tier" : colKey === "target" ? "target" : undefined;
    const isFiltered = filterKey && Boolean(colFilters[filterKey as keyof typeof colFilters]?.size);
    const isMenuOpen = activeMenuCol === colKey;

    return (
      <th
        className={`relative select-none border-r border-slate-300 py-1.5 px-2 bg-slate-100 text-slate-700 font-semibold text-xs ${
          align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
        }`}
      >
        <div className={`inline-flex items-center gap-1 w-full ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-between"}`}>
          {sortKey ? (
            <button
              type="button"
              onClick={() => setSort((s) => (s.key === sortKey ? { key: sortKey, dir: (s.dir * -1) as 1 | -1 } : { key: sortKey, dir: -1 }))}
              className={`cursor-pointer whitespace-nowrap inline-flex items-center gap-1 truncate ${
                isSorted ? "text-slate-900 font-bold" : "text-slate-700 hover:text-slate-900"
              }`}
            >
              <span className="truncate">{label}</span>
              {isSorted && <span className="text-[10px] text-indigo-600">{sort.dir === -1 ? "▼" : "▲"}</span>}
            </button>
          ) : (
            <span className="truncate">{label}</span>
          )}

          {hasFilter && (
            <div className="relative inline-block ml-0.5">
              <button
                type="button"
                data-colmenu-trigger
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenuPos({ left: Math.min(rect.left, window.innerWidth - 256), top: rect.bottom + 4 });
                  setActiveMenuCol(isMenuOpen ? null : colKey);
                }}
                title={`Lọc & Sắp xếp ${label}`}
                className={`h-4.5 px-1 rounded cursor-pointer text-[10px] transition ${
                  isFiltered
                    ? "bg-indigo-600 text-white font-bold"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-200"
                }`}
              >
                ▾
              </button>
              {/* Đưa menu ra ngoài bảng: không bị CSS chung của tiêu đề cột (in đậm, đổi màu) và khung cuộn cắt mất. */}
              {isMenuOpen && menuPos && createPortal(
                <div ref={menuRef} className="font-accounting-system fixed z-[60]" style={{ left: menuPos.left, top: menuPos.top }}>
                  <ColumnFilterMenu
                    title={`Lọc ${label}`}
                    colKey={colKey}
                    distinctItems={distinctItems}
                    selectedSet={filterKey ? colFilters[filterKey as keyof typeof colFilters] : undefined}
                    onSort={(dir) => {
                      if (sortKey) setSort({ key: sortKey, dir });
                    }}
                    onApply={(newSet) => {
                      if (filterKey) {
                        setColFilters((prev) => ({
                          ...prev,
                          [filterKey]: newSet || undefined,
                        }));
                      }
                    }}
                    onClose={() => setActiveMenuCol(null)}
                  />
                </div>,
                document.body,
              )}
            </div>
          )}
        </div>

        {/* Kéo dãn độ rộng cột */}
        <div
          onMouseDown={(e) => startResize(colKey, e)}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500 z-10 transition-colors"
          title="Kéo để thay đổi độ rộng cột"
        />
      </th>
    );
  };

  if (!selectedStore || selectedStore === "ALL") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-6 text-center text-sm font-semibold text-amber-900">
        Chọn một store ở thanh trên để chỉnh bid.
      </div>
    );
  }

  if (!query) {
    return (
      <ManualBidSkuList
        rows={pageRows}
        channel={channel ?? "FBA"}
        channelPages={channelPages}
        onChannelChange={setChannel}
        refreshing={skuRefreshing}
        onHoverSku={prefetchTargets}
        activeOnly={activeOnly}
        onToggleActive={() => setActiveOnly((v) => !v)}
        actionQueue={actionQueue}
        selectedStore={selectedStore}
        skuTrends={skuTrends}
        onOpenSkuTrend={onOpenSkuTrend}
        onOpen={load}
      />
    );
  }

  const allVisibleChecked = visibleKeys.length > 0 && selectedVisible.length === visibleKeys.length;
  const nSel = selectedVisible.length;

  return (
    <div className="space-y-2 pb-16 text-slate-800">
      {/* Hàng 1: Nút quay lại (dấu mũi tên) + SKU + Ô tìm kiếm nhấc sang trái + Dạng chạy SP | SB | SD + Active toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={backToList}
          title="Quay lại danh sách SKU"
          className="h-7 w-7 flex items-center justify-center cursor-pointer rounded border border-slate-300 bg-white text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
        >
          ←
        </button>
        {skuMockupUrl && (
          <MockupHoverZoom url={skuMockupUrl} sku={query?.sku} size={28} />
        )}
        <span className="font-mono text-sm font-bold text-slate-900">{query?.sku}</span>

        {/* Nút tìm kiếm nhấc sang trái */}
        {sku && (
          <div className="relative">
            <input
              value={keywordFilter}
              onChange={(e) => setKeywordFilter(e.target.value)}
              placeholder="Tìm target, campaign..."
              className="h-7 w-48 rounded border border-slate-300 bg-white px-2.5 pr-6 text-xs outline-none focus:border-indigo-500 placeholder:text-slate-400"
            />
            {keywordFilter && (
              <button
                type="button"
                onClick={() => setKeywordFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Phân nhóm dạng chạy SP | SB | SD */}
        {sku && runTypeGroups.length > 0 && (
          <div className="flex items-center rounded border border-slate-300 bg-slate-100 p-0.5 text-xs">
            {runTypeGroups.map((group, gIdx) => (
              <Fragment key={group.family}>
                {gIdx > 0 && <div className="h-3.5 w-px bg-slate-300 mx-1" />}
                {group.items.map(([rt, n]) => (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => setRunType(rt)}
                    className={`cursor-pointer rounded px-2.5 py-0.5 font-medium transition ${
                      runType === rt ? "bg-white text-slate-900 font-bold shadow-xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {rt} ({n})
                  </button>
                ))}
              </Fragment>
            ))}
          </div>
        )}

        {/* Active toggle góc phải */}
        {sku && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded border border-slate-300 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveOnly(true)}
                className={`cursor-pointer rounded px-2 py-0.5 font-medium transition ${
                  activeOnly ? "bg-white text-slate-900 font-bold shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setActiveOnly(false)}
                className={`cursor-pointer rounded px-2 py-0.5 font-medium transition ${
                  !activeOnly ? "bg-white text-slate-900 font-bold shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tất cả
              </button>
            </div>
          </div>
        )}
      </div>

      {loading && !refreshing && <LoadingBlock />}

      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

      {sku && !loading && rows.length === 0 && !error && (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">Không có target trong {selectedDays} ngày.</div>
      )}

      {sku && enriched.length > 0 && (
        <>
          {/* Hàng 2: nấc ACOS + gửi */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setTierSet([]); setEditedOnly(false); }}
              className={`h-7 cursor-pointer rounded border px-2.5 text-xs font-medium transition ${
                tierSet.length === 0 && !editedOnly
                  ? "border-slate-800 bg-slate-800 text-white font-bold"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Tất cả ({byRunType.length})
            </button>
            {MANUAL_BID_TIERS.map((t) => {
              const n = tierStats.get(t.key)!.count;
              const on = tierSet.includes(t.key);
              const style = TIER_STYLE[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  disabled={n === 0 && !on}
                  title="Giữ ⌘ (Mac) / Ctrl (Windows) để chọn thêm nấc"
                  onClick={(e) => {
                    const multi = e.metaKey || e.ctrlKey;
                    setTierSet((prev) => {
                      // Bấm thường = chuyển sang nấc đó (bấm lại nấc đang xem = về Tất cả); giữ phím = thêm / bớt nấc.
                      if (multi) return on ? prev.filter((x) => x !== t.key) : [...prev, t.key];
                      return on && prev.length === 1 ? [] : [t.key];
                    });
                    if (!multi) setEditedOnly(false);
                  }}
                  className={`flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs font-semibold transition disabled:cursor-default ${
                    on ? `${style.chipOn} font-bold` : `${style.chip} ${style.text} hover:brightness-95`
                  } ${n === 0 && !on ? "opacity-40" : ""}`}
                >
                  {!on && <span className={`h-2 w-2 rounded-full ${style.dot}`} />}
                  {t.label} ({n})
                </button>
              );
            })}
            <div className="mx-0.5 h-4 w-px bg-slate-300" />
            <button
              type="button"
              disabled={editedCount === 0 && !editedOnly}
              onClick={(e) => {
                // Bấm thường = xem toàn bộ target đã sửa (bỏ lọc nấc), xếp theo ACOS; ⌘ / Ctrl = kết hợp với nấc đang chọn.
                if (e.metaKey || e.ctrlKey) {
                  setEditedOnly((v) => !v);
                  return;
                }
                if (editedOnly && tierSet.length === 0) {
                  setEditedOnly(false);
                  return;
                }
                setEditedOnly(true);
                setTierSet([]);
                setSort({ key: "acos", dir: -1 });
              }}
              title="Chỉ hiện target đã chỉnh bid của SKU này (mọi dạng chạy)"
              className={`h-7 cursor-pointer rounded border px-2.5 text-xs font-semibold transition disabled:cursor-default disabled:opacity-40 ${
                editedOnly
                  ? "border-amber-500 bg-amber-500 text-white font-bold"
                  : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
            >
              Đã sửa ({editedCount})
            </button>

            <div className="ml-auto flex items-center gap-2">
              {nSel > 0 && (
                <form
                  className="flex h-7 items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 pl-2.5 pr-1 text-xs"
                  onSubmit={(e) => { e.preventDefault(); runOp(); }}
                >
                  <span className="font-semibold tabular-nums text-indigo-900">{nSel} chọn</span>
                  <span className="pl-1 font-bold text-slate-500">×</span>
                  <input
                    ref={opInputRef}
                    value={opValue}
                    onChange={(e) => setOpValue(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    placeholder="0.95"
                    title="Gõ hệ số rồi Enter"
                    className="h-5 w-14 rounded border border-slate-300 bg-white px-1.5 text-right font-mono font-bold outline-none placeholder:font-normal placeholder:text-slate-300 focus:border-indigo-500"
                  />
                  <button type="button" onClick={pauseSelected} className="h-5 cursor-pointer rounded px-1.5 font-medium text-slate-700 hover:bg-indigo-100">
                    Dừng
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} title="Bỏ chọn" className="h-5 cursor-pointer rounded px-1.5 text-slate-400 hover:bg-indigo-100 hover:text-slate-700">
                    ✕
                  </button>
                </form>
              )}
              {draftCount > 0 && (
                <button
                  type="button"
                  onClick={() => setDrafts(new Map())}
                  className="h-7 cursor-pointer px-2 text-xs font-semibold text-rose-600 hover:underline"
                >
                  Huỷ ({draftCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={draftCount === 0 || submitting}
                className="h-7 cursor-pointer rounded bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-400"
              >
                {submitting ? "Đang gửi…" : `Đưa vào hàng đợi${draftCount > 0 ? ` (${draftCount})` : ""}`}
              </button>
            </div>
          </div>

          {/* Bảng target dạng lưới Excel với kéo dãn cột & đánh màu ACOS */}
          {refreshing && <ProgressBar />}
          <div className={`overflow-x-auto border border-slate-300 bg-white shadow-xs transition-opacity ${refreshing ? "pointer-events-none opacity-50" : ""}`}>
            <table
              className="border-collapse text-xs table-fixed w-full"
              style={{ minWidth: Object.values(shownColWidths).reduce((a, b) => a + b, 0) }}
            >
              <colgroup>
                <col style={{ width: colWidths.cb }} />
                <col style={{ width: colWidths.idx }} />
                <col style={{ width: colWidths.target }} />
                <col style={{ width: shownColWidths.campaign }} />
                <col style={{ width: colWidths.matchType }} />
                <col style={{ width: colWidths.sv }} />
                <col style={{ width: colWidths.org }} />
                <col style={{ width: colWidths.sp }} />
                <col style={{ width: colWidths.impr }} />
                <col style={{ width: colWidths.clicks }} />
                <col style={{ width: colWidths.orders }} />
                <col style={{ width: colWidths.spend }} />
                <col style={{ width: colWidths.sales }} />
                <col style={{ width: colWidths.acos }} />
                <col style={{ width: colWidths.cpc }} />
                <col style={{ width: colWidths.bid }} />
                <col style={{ width: colWidths.newBid }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-semibold border-b border-slate-300">
                <tr>
                  <th className="relative border-r border-slate-300 px-1 py-1.5 text-center bg-slate-100 select-none">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={(e) => toggleKeys(visibleKeys, e.target.checked)}
                      className="h-3.5 w-3.5 cursor-pointer accent-indigo-600"
                    />
                    <div
                      onMouseDown={(e) => startResize("cb", e)}
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500 z-10"
                    />
                  </th>
                  <th className="relative border-r border-slate-300 px-1 py-1.5 text-center text-slate-500 font-medium bg-slate-100 select-none">
                    #
                    <div
                      onMouseDown={(e) => startResize("idx", e)}
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500 z-10"
                    />
                  </th>
                  {renderHeaderCell({ colKey: "target", sortKey: "keyword", label: "Target", hasFilter: true, distinctItems: targetDistinctItems })}
                  {renderHeaderCell({ colKey: "campaign", sortKey: "campaignName", label: "Campaign", hasFilter: true, distinctItems: campaignDistinctItems })}
                  {renderHeaderCell({ colKey: "matchType", sortKey: "matchType", label: "Match Type", align: "center", hasFilter: true, distinctItems: matchTypeDistinctItems })}
                  {renderHeaderCell({ colKey: "sv", sortKey: "searchVolume", label: "SV", align: "right" })}
                  {renderHeaderCell({ colKey: "org", sortKey: "organicRank", label: "Org", align: "center" })}
                  {renderHeaderCell({ colKey: "sp", sortKey: "sponsoredRank", label: "SP", align: "center" })}
                  {renderHeaderCell({ colKey: "impr", sortKey: "impressions", label: "Impr", align: "right" })}
                  {renderHeaderCell({ colKey: "clicks", sortKey: "clicks", label: "Click", align: "right" })}
                  {renderHeaderCell({ colKey: "orders", sortKey: "orders", label: "Order", align: "right" })}
                  {renderHeaderCell({ colKey: "spend", sortKey: "spend", label: "Spend", align: "right" })}
                  {renderHeaderCell({ colKey: "sales", sortKey: "sales", label: "Sales", align: "right" })}
                  {renderHeaderCell({ colKey: "acos", sortKey: "acos", label: "ACOS", align: "right", hasFilter: true, distinctItems: acosDistinctItems })}
                  {renderHeaderCell({ colKey: "cpc", sortKey: "cpc", label: "CPC", align: "right" })}
                  {renderHeaderCell({ colKey: "bid", sortKey: "bid", label: "Bid", align: "right" })}
                  <th className="relative px-2 py-1.5 text-right bg-slate-200/70 font-bold text-slate-900 select-none">
                    Bid mới
                    <div
                      onMouseDown={(e) => startResize("newBid", e)}
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-500 z-10"
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visible.map((r, idx) => {
                  const draft = drafts.get(r.key);
                  const queued = queuedByTarget.get(`${r.campaignId}|${r.targetId}`);
                  const isSel = selected.has(r.key);
                  const live = isLive(r);
                  const newRunType = editedOnly && (idx === 0 || visible[idx - 1].runType !== r.runType);
                  return (
                    <Fragment key={r.key}>
                    {newRunType && (
                      <tr className="bg-slate-200">
                        <td colSpan={17} className="border-y border-slate-300 px-3 py-1 text-xs font-bold tracking-wide text-slate-900">
                          {r.runType}
                          <span className="ml-2 font-normal text-slate-600">
                            {visible.filter((x) => x.runType === r.runType).length} target
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr
                      className={`h-8 transition-colors ${TIER_BORDER[r.tier]} ${
                        isSel
                          ? "bg-indigo-50/80"
                          : TIER_ROW_BG[r.tier]
                      } ${live ? "" : "opacity-60"} cursor-pointer select-none hover:bg-slate-100/70`}
                      onMouseDown={(e) => startRowDrag(idx, r.key, e)}
                      onMouseEnter={() => enterRowDrag(idx)}
                    >
                      <td className="border-r border-slate-200 px-1 py-0.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSel}
                          readOnly
                          className="pointer-events-none h-3.5 w-3.5 accent-indigo-600"
                        />
                      </td>
                      <td
                        className={`border-r border-slate-200 px-1 py-0.5 text-center font-mono text-[11px] select-none ${
                          `${TIER_NUM_BG[r.tier]} ${draft ? "font-bold !text-indigo-700 shadow-[inset_4px_0_0_#4f46e5]" : "text-slate-900"}`
                        }`}
                      >
                        {idx + 1}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 font-medium text-slate-900 truncate" title={r.keyword}>
                        {r.keyword || "—"}
                      </td>
                      <td
                        className="truncate whitespace-nowrap border-r border-slate-200 px-2 py-0.5 text-slate-600"
                        title={r.adGroupName ? `${r.campaignName}\nAd group: ${r.adGroupName}` : r.campaignName}
                      >
                        <span>{r.campaignName}</span>
                        {!live && <span className="ml-1 text-[11px] text-slate-400 font-normal">(dừng)</span>}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-center font-medium text-slate-600 truncate">
                        {shortMatch(r.matchType)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-700">
                        {r.searchVolume != null ? int(r.searchVolume) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="border-r border-slate-200 px-1 py-0.5 text-center font-mono tabular-nums text-slate-700">
                        {r.organicRank != null ? r.organicRank : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="border-r border-slate-200 px-1 py-0.5 text-center font-mono tabular-nums text-slate-700">
                        {r.sponsoredRank != null ? r.sponsoredRank : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-500">
                        {int(r.impressions)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-700">
                        {int(r.clicks)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums font-semibold text-slate-800">
                        {r.orders || 0}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-700">
                        {money(r.spend)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-700">
                        {money(r.sales)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right">
                        {renderAcosBadge(r)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-600">
                        {money(r.cpc)}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-0.5 text-right font-mono tabular-nums text-slate-800">
                        <div className="flex flex-col items-end">
                          <span className={draft ? "text-slate-400 line-through decoration-slate-400" : "font-semibold"}>{money(r.bid)}</span>
                          {queued && (
                            <span className="text-[10px] text-indigo-600">
                              (chờ: {queued.actionType === "PAUSE_TARGET" ? "dừng" : money(Number(queued.finalValue || 0))})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-0 border-r-0 cursor-auto" data-no-drag>
                        <BidCell
                          index={idx}
                          row={r}
                          draft={draft}
                          onChange={(d) => setDraft(r.key, d)}
                          onNavigate={(dir) => focusBidInput(idx + dir)}
                          onPasteBatch={handlePasteBatch}
                        />
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10 bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={5} className="border-r border-slate-300 px-2 py-1.5 text-right uppercase tracking-wider text-slate-600">
                    Tổng ({visible.length} target)
                  </td>
                  <td colSpan={3} className="border-r border-slate-300" />
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {int(totals.impressions)}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {int(totals.clicks)}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {int(totals.orders)}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {money(totals.spend)}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {money(totals.sales)}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {totals.acos != null ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border ${
                        totals.acos <= 20
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : totals.acos <= 40
                          ? "bg-sky-100 text-sky-800 border-sky-300"
                          : totals.acos <= 60
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-rose-100 text-rose-800 border-rose-300"
                      }`}>
                        {totals.acos.toFixed(1)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td className="border-r border-slate-300 px-2 py-1.5 text-right font-mono tabular-nums">
                    {totals.cpc > 0 ? money(totals.cpc) : "—"}
                  </td>
                  <td colSpan={2} className="border-r-0 bg-slate-100" />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

    </div>
  );
}

const ACOS_PILL: Record<ManualBidTier, string> = {
  A20: "bg-emerald-100 text-emerald-800",
  A40: "bg-sky-100 text-sky-800",
  A60: "bg-amber-100 text-amber-800",
  A60P: "bg-rose-100 text-rose-700",
  NO_ORDER: "bg-fuchsia-100 text-fuchsia-800",
  OTHER: "text-slate-400",
};

function AcosPill({ tier, acos }: { tier: ManualBidTier; acos: number | null }) {
  return (
    <span className={`inline-block min-w-[58px] rounded-md px-1.5 py-0.5 text-right text-[12.5px] font-bold tabular-nums ${ACOS_PILL[tier]}`}>
      {acos != null ? `${acos.toFixed(1)}%` : "—"}
    </span>
  );
}

const CACHE_MS = 5 * 60 * 1000;

const LOADING_CSS = `
@keyframes mb-shimmer { 0% { background-position: -480px 0 } 100% { background-position: 480px 0 } }
@keyframes mb-bar { 0% { transform: translateX(-100%) } 100% { transform: translateX(320%) } }
.mb-shimmer { background: linear-gradient(90deg, #e9eef5 25%, #f7f9fc 40%, #e9eef5 60%); background-size: 960px 100%; animation: mb-shimmer 1.3s linear infinite; }
.mb-bar { animation: mb-bar 1.1s ease-in-out infinite; }
`;

/** Thanh chạy mảnh khi đang tải lại (bảng cũ vẫn hiện, mờ đi). */
function ProgressBar() {
  return (
    <div className="relative -mb-0.5 h-0.5 overflow-hidden rounded-full bg-indigo-100" role="progressbar" aria-label="Đang tải">
      <style>{LOADING_CSS}</style>
      <div className="mb-bar absolute inset-y-0 w-1/4 rounded-full bg-indigo-500" />
    </div>
  );
}

/** Khung chờ: thanh chạy + các dòng bảng giả lấp lánh, đúng chỗ bảng sẽ hiện; không chữ. */
function LoadingBlock({ bare = false, rows = 8 }: { bare?: boolean; rows?: number }) {
  return (
    <div className={bare ? "" : "overflow-hidden rounded border border-slate-200 bg-white"} role="status" aria-label="Đang tải">
      <style>{LOADING_CSS}</style>
      {!bare && (
        <div className="relative h-0.5 overflow-hidden bg-indigo-100">
          <div className="mb-bar absolute inset-y-0 w-1/4 bg-indigo-500" />
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-2.5" style={{ opacity: 1 - i * 0.08 }}>
            <div className="mb-shimmer h-3 w-5 rounded" />
            <div className="mb-shimmer h-3 rounded" style={{ width: `${20 - (i % 3) * 3}%` }} />
            <div className="mb-shimmer h-3 flex-1 rounded" />
            <div className="mb-shimmer h-3 w-12 rounded" />
            <div className="mb-shimmer h-3 w-12 rounded" />
            <div className="mb-shimmer h-3 w-14 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function shortMatch(m: string): string {
  const v = m.toLowerCase();
  if (v.includes("exact")) return "Exact";
  if (v.includes("phrase")) return "Phrase";
  if (v.includes("broad")) return "Broad";
  if (v.includes("auto")) return "Auto";
  return "PAT";
}

/** Bỏ mã SKU, dạng chạy, match type khỏi tên campaign cho gọn (tên đầy đủ ở tooltip). */
function shortCampaign(name: string, sku: string): string {
  let n = name;
  if (sku) n = n.replace(new RegExp(sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  n = n.replace(/\b(SP|SB|SD)\s?\d{2}\b/gi, "").replace(/\b(KW|PAT|Exact|Phrase|Broad|Auto)\b/gi, "");
  return n.replace(/\s+/g, " ").trim() || name;
}

function BidCell({ index, row, draft, onChange, onNavigate, onPasteBatch }: {
  index: number;
  row: Row;
  draft: Draft | undefined;
  onChange: (d: Draft | null) => void;
  onNavigate: (dir: 1 | -1) => void;
  onPasteBatch?: (startIndex: number, values: string[]) => void;
}) {
  const shown = draft?.kind === "bid" ? draft.bid.toFixed(2) : "";
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!focused) {
      setText(draft?.kind === "bid" ? draft.bid.toFixed(2) : "");
    }
  }, [draft, focused]);

  const commit = () => {
    if (cancelRef.current) { cancelRef.current = false; return; }
    const raw = text.trim().replace(",", ".");
    if (!raw) { if (draft?.kind === "bid") onChange(null); return; }
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    const nb = Math.round(Math.max(minBidFor(row.adType), Math.min(100, v)) * 100) / 100;
    if (Math.abs(nb - row.bid) < 0.005) onChange(null);
    else onChange({ kind: "bid", bid: nb });
  };

  if (draft?.kind === "pause") {
    return (
      <div className="flex h-full w-full items-center justify-end px-1.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          className="h-5 cursor-pointer rounded bg-slate-700 px-1.5 text-[10px] font-semibold text-white hover:bg-slate-600"
        >
          Dừng
        </button>
      </div>
    );
  }

  const isDraft = draft?.kind === "bid";
  // Đã sửa: tăng = nền xanh, giảm = nền đỏ. Sau số bid mới là hệ số đã gõ (× 0.95 → 95%).
  const up = isDraft && draft.bid > row.bid;
  const factorPct = isDraft && draft.factor ? `${Math.round(draft.factor * 1000) / 10}%` : null;

  return (
    <div className={`relative flex h-full w-full items-center ${isDraft ? (up ? "bg-emerald-100" : "bg-rose-100") : ""}`}>
      <input
        data-mb-bid={index}
        value={focused ? text : shown}
        placeholder={row.bid.toFixed(2)}
        inputMode="decimal"
        onFocus={(e) => {
          setText(shown);
          setFocused(true);
          const el = e.target;
          requestAnimationFrame(() => el.select());
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onDoubleClick={() => {
          if (!draft || draft.kind !== "bid") {
            onChange({ kind: "bid", bid: row.bid });
          }
        }}
        title="Nhấp đúp để lấy nhanh bid hiện tại"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasteText = e.clipboardData.getData("text");
          if (!pasteText) return;
          const lines = pasteText
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (lines.length > 1 && onPasteBatch) {
            e.preventDefault();
            onPasteBatch(index, lines);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            onNavigate(e.shiftKey ? -1 : 1);
          } else if (e.key === "Tab") {
            e.preventDefault();
            commit();
            onNavigate(e.shiftKey ? -1 : 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            commit();
            onNavigate(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            commit();
            onNavigate(-1);
          } else if (e.key === "Escape") {
            cancelRef.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`h-7 min-w-0 flex-1 px-2 text-right font-mono text-[12px] font-bold outline-none transition-all ${
          focused
            ? "bg-white ring-2 ring-indigo-500 ring-inset text-slate-900"
            : isDraft
            ? `bg-transparent font-bold ${up ? "text-emerald-900" : "text-rose-900"}`
            : "bg-transparent text-slate-700 placeholder:text-slate-300 placeholder:font-normal"
        }`}
      />
      {factorPct && !focused && (
        <span className={`pointer-events-none shrink-0 pr-1.5 font-mono text-[10.5px] font-semibold ${up ? "text-emerald-700" : "text-rose-700"}`}>
          {factorPct}
        </span>
      )}
    </div>
  );
}

type SkuSortKey = "sku" | "clicks" | "orders" | "spend" | "sales" | "acos";
const SKU_SORT_KEYS: SkuSortKey[] = ["sku", "clicks", "orders", "spend", "sales", "acos"];
const SKU_FILTER_STORAGE = "nce_manual_bid_sku_filter";

function readSaved(): { filter?: Partial<SkuListFilter>; sort?: { key: SkuSortKey; dir: 1 | -1 } } | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SKU_FILTER_STORAGE) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="flex h-9 rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-md px-3 text-[12px] font-bold transition ${
            value === o.value ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RangeRow({ label, unit, value, onChange }: {
  label: string;
  unit: string;
  value: MetricRange;
  onChange: (r: MetricRange) => void;
}) {
  const clean = (v: string) => v.replace(",", ".").replace(/[^0-9.]/g, "");
  const input = (k: "min" | "max") => (
    <input
      value={value[k]}
      onChange={(e) => onChange({ ...value, [k]: clean(e.target.value) })}
      inputMode="decimal"
      placeholder={unit}
      className={`h-8 w-full rounded-md border px-2 text-right text-[12px] font-bold tabular-nums text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-300 focus:border-indigo-400 ${
        value[k] ? "border-slate-800" : "border-slate-200"
      }`}
    />
  );
  return (
    <div className="grid grid-cols-[1fr_76px_10px_76px] items-center gap-1 text-[12px] font-semibold text-slate-500">
      <span>{label}</span>
      {input("min")}
      <span className="text-center text-slate-300">–</span>
      {input("max")}
    </div>
  );
}

const SKU_PAGE = 100;

// Màn đầu: tất cả SKU của store, cùng nguồn số liệu với tab Đề xuất & Auto Bid. Bấm 1 dòng để chỉnh bid.
function ManualBidSkuList({ rows, channel, channelPages, onChannelChange, refreshing, onHoverSku, activeOnly, onToggleActive, actionQueue, selectedStore, skuTrends, onOpenSkuTrend, onOpen }: {
  channel: "FBA" | "FBM" | "OTHER";
  channelPages: { FBA: number; FBM: number; OTHER: number } | null;
  onChannelChange: (c: "FBA" | "FBM" | "OTHER") => void;
  refreshing: boolean;
  onHoverSku: (sku: string) => void;
  rows: SkuRow[] | null;
  activeOnly: boolean;
  onToggleActive: () => void;
  actionQueue: PpcAction[];
  selectedStore: string;
  skuTrends?: Map<string, PpcSkuDailyTrendPoint[]>;
  onOpenSkuTrend?: Props["onOpenSkuTrend"];
  onOpen: (sku: string) => void;
}) {
  // Bộ lọc + sắp xếp nhớ theo trình duyệt (trừ ô tìm).
  const [filter, setFilterState] = useState<SkuListFilter>(() => {
    const saved = readSaved()?.filter;
    return {
      ...EMPTY_SKU_FILTER,
      phoi: saved?.phoi || "",
      niche: saved?.niche || "",
      pic: saved?.pic || "",
      ranges: saved?.ranges && typeof saved.ranges === "object" ? saved.ranges : {},
    };
  });
  const [sort, setSortState] = useState<{ key: SkuSortKey; dir: 1 | -1 }>(() => {
    const saved = readSaved()?.sort;
    return saved && SKU_SORT_KEYS.includes(saved.key) ? saved : { key: "spend", dir: -1 };
  });
  const [limit, setLimit] = useState(SKU_PAGE);
  const search = filter.search;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cuộn gần tới cuối bảng thì tự hiện thêm SKU (thay nút "Xem thêm").
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + SKU_PAGE);
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  });

  const save = (f: SkuListFilter, so: { key: SkuSortKey; dir: 1 | -1 }) => {
    try { localStorage.setItem(SKU_FILTER_STORAGE, JSON.stringify({ filter: { ...f, search: "" }, sort: so })); } catch { /* bỏ qua */ }
  };
  const setFilter = (patch: Partial<SkuListFilter>) => {
    const next = { ...filter, ...patch };
    setFilterState(next);
    setLimit(SKU_PAGE);
    save(next, sort);
  };
  const setRange = (key: SkuMetricKey, r: MetricRange) => {
    const ranges: SkuListFilter["ranges"] = {};
    for (const [k, v] of Object.entries(filter.ranges) as Array<[SkuMetricKey, MetricRange]>) {
      if (k !== key) ranges[k] = v;
    }
    if (r.min || r.max) ranges[key] = r;
    setFilter({ ranges });
  };
  const setSort = (so: { key: SkuSortKey; dir: 1 | -1 }) => {
    setSortState(so);
    setLimit(SKU_PAGE);
    save(filter, so);
  };

  // Phôi / niche / PIC lọc lẫn nhau: chọn cái nào trước thì danh sách cái kia chỉ còn giá trị khớp.
  const options = useMemo(() => {
    const list = rows || [];
    return {
      phoi: facetOptions(list, filter, "phoi"),
      niche: facetOptions(list, filter, "niche"),
      pic: facetOptions(list, filter, "pic"),
    };
  }, [rows, filter]);
  // Chỉ hiện ô chọn khi dữ liệu có từ 2 giá trị trở lên.
  const facetShown = useMemo(() => {
    const count = (pick: (g: SkuRow) => string) => new Set((rows || []).map(pick).filter(Boolean)).size;
    return { phoi: count((g) => g.productType) > 1, niche: count((g) => g.niche) > 1, pic: count((g) => g.picMkt) > 1 };
  }, [rows]);

  const queuedBySku = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actionQueue) {
      const k = (a.sku || "").toUpperCase();
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [actionQueue]);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [moreOpen]);

  // Điều kiện phụ đang bật → nhãn nhỏ, bấm để bỏ.
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (filter.phoi) chips.push({ key: "phoi", label: filter.phoi, clear: () => setFilter({ phoi: "" }) });
  if (filter.niche) chips.push({ key: "niche", label: filter.niche, clear: () => setFilter({ niche: "" }) });
  if (filter.pic) chips.push({ key: "pic", label: filter.pic, clear: () => setFilter({ pic: "" }) });
  for (const r of activeRanges(filter)) {
    const m = SKU_METRICS.find((x) => x.key === r.key)!;
    const fmt = (v: number) => (m.unit === "$" ? `$${v}` : m.unit === "%" ? `${v}%` : `${v}`);
    const label = r.min != null && r.max != null ? `${m.label} ${fmt(r.min)}–${fmt(r.max)}`
      : r.min != null ? `${m.label} ≥ ${fmt(r.min)}` : `${m.label} ≤ ${fmt(r.max!)}`;
    chips.push({ key: r.key, label, clear: () => setRange(r.key, { min: "", max: "" }) });
  }

  const baseFiltered = useMemo(() => filterSkusExceptTier(rows || [], filter), [rows, filter]);

  const filtered = useMemo(() => {
    const list = baseFiltered;
    const val = (g: SkuRow): number | string => {
      if (sort.key === "sku") return g.sku;
      if (sort.key === "acos") return g.sales > 0 ? g.acos : (g.spend > 0 ? 9999 : -1);
      return g[sort.key];
    };
    // Xếp theo ACOS: SKU có sales theo ACOS; sau đó SKU có spend mà chưa có sales (tốn nhiều trước);
    // cuối cùng SKU chưa tiêu tiền — dù xếp tăng hay giảm.
    const acosGroup = (g: SkuRow) => (g.sales > 0 ? 0 : g.spend > 0 ? 1 : 2);
    return [...list].sort((a, b) => {
      if (sort.key === "acos") {
        const ga = acosGroup(a), gb = acosGroup(b);
        if (ga !== gb) return ga - gb;
        if (ga === 0) return (a.acos - b.acos) * sort.dir || b.spend - a.spend;
        return b.spend - a.spend || b.clicks - a.clicks;
      }
      const va = val(a), vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
      return (va - vb) * sort.dir || b.spend - a.spend;
    });
  }, [baseFiltered, sort]);

  const isFiltered = JSON.stringify({ ...filter, search: "" }) !== JSON.stringify({ ...EMPTY_SKU_FILTER, search: "" }) || search.trim() !== "";

  const head = (key: SkuSortKey, label: string, align: "left" | "right" = "right") => (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort(sort.key === key ? { key, dir: (sort.dir * -1) as 1 | -1 } : { key, dir: key === "sku" ? 1 : -1 })}
        className={`cursor-pointer whitespace-nowrap ${sort.key === key ? "text-slate-900" : "hover:text-slate-700"}`}
      >
        {label}{sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-2.5 text-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="min-w-[220px] flex-1 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const tokens = searchTokens(search);
            if (tokens.length !== 1) return;
            const q = tokens[0].toUpperCase();
            const exact = filtered.find((g) => g.sku.toUpperCase() === q);
            if (exact) onOpen(exact.sku);
            else if (filtered.length === 1) onOpen(filtered[0].sku);
            else if (/^[A-Z0-9-]{6,}$/.test(q)) onOpen(q);
          }}
        >
          <input
            value={search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="Tìm SKU…"
            autoFocus
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
        </form>

        {channelPages && (
          <div className="flex h-9 rounded-lg border border-slate-200 bg-white p-0.5">
            {([["FBA", "FBA"], ["FBM", "FBM"], ["OTHER", "Khác"]] as const)
              .filter(([k]) => k !== "OTHER" || channelPages.OTHER > 0 || channel === "OTHER")
              .map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onChannelChange(k)}
                  className={`cursor-pointer rounded-md px-3.5 text-[13px] font-bold transition ${
                    channel === k ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {label} <span className={channel === k ? "font-semibold text-slate-300" : "font-semibold text-slate-400"}>{channelPages[k]}</span>
                </button>
              ))}
          </div>
        )}

        <Segmented
          value={activeOnly ? "active" : "all"}
          onChange={(v) => { if ((v === "active") !== activeOnly) onToggleActive(); }}
          options={[{ value: "active", label: "Active" }, { value: "all", label: "Tất cả" }]}
        />

        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold ${
              moreOpen || chips.length > 0 ? "border-slate-800 text-slate-900" : "border-slate-200 text-slate-600"
            } bg-white hover:bg-slate-50`}
          >
            Lọc
            {chips.length > 0 && <span className="rounded-full bg-slate-800 px-1.5 text-[10.5px] font-bold text-white">{chips.length}</span>}
            <span className="text-[9px] text-slate-400">▼</span>
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-11 z-40 w-80 space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              {(["phoi", "niche", "pic"] as const).map((k) => facetShown[k] && (
                <label key={k} className="flex items-center justify-between gap-3 text-[12px] font-semibold text-slate-500">
                  {k === "phoi" ? "Phôi" : k === "niche" ? "Niche" : "PIC"}
                  <select
                    value={filter[k]}
                    onChange={(e) => setFilter({ [k]: e.target.value })}
                    className="h-8 w-[172px] cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-800 outline-none focus:border-indigo-400"
                  >
                    <option value="">Tất cả</option>
                    {options[k].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              ))}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <div className="grid grid-cols-[1fr_76px_10px_76px] items-center gap-1 text-[10.5px] font-semibold text-slate-400">
                  <span />
                  <span className="text-center">từ</span>
                  <span />
                  <span className="text-center">đến</span>
                </div>
                {SKU_METRICS.map((m) => (
                  <RangeRow
                    key={m.key}
                    label={m.label}
                    unit={m.unit}
                    value={filter.ranges[m.key] || { min: "", max: "" }}
                    onChange={(r) => setRange(m.key, r)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.clear}
            className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-slate-100 pl-2.5 pr-2 text-[12px] font-semibold text-slate-700 hover:bg-slate-200"
          >
            {c.label}
            <span className="text-slate-400">×</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3 text-[12px] font-semibold text-slate-400">
          {isFiltered && (
            <button type="button" onClick={() => setFilter({ ...EMPTY_SKU_FILTER })} className="cursor-pointer hover:text-slate-700">
              Xoá lọc
            </button>
          )}
          {rows ? (
            <span className="tabular-nums"><b className="text-slate-700">{filtered.length}</b> SKU</span>
          ) : (
            <span className="mb-shimmer inline-block h-3 w-14 rounded" />
          )}
        </div>
      </div>

      {refreshing && <ProgressBar />}
      <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white transition-opacity ${refreshing ? "pointer-events-none opacity-50" : ""}`}>
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead className="text-[11px] font-semibold text-slate-400">
            <tr className="border-b border-slate-200">
              <th className="w-12 px-2 py-2.5" />
              {head("sku", "SKU", "left")}
              {head("clicks", "Click")}
              {head("orders", "Order")}
              {head("spend", "Spend")}
              {head("sales", "Sales")}
              {head("acos", "ACOS")}
              <th className="px-3 py-2.5 text-center">7 ngày</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <tr><td colSpan={8} className="p-0"><LoadingBlock bare /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-14 text-center text-slate-400">Không có SKU phù hợp.</td></tr>
            ) : filtered.slice(0, limit).map((g) => {
              const tier = manualBidTier(g);
              const queued = queuedBySku.get(g.sku.toUpperCase()) || 0;
              return (
                <tr
                  key={g.sku}
                  onClick={() => onOpen(g.sku)}
                  onMouseEnter={() => {
                    if (hoverTimer.current) clearTimeout(hoverTimer.current);
                    hoverTimer.current = setTimeout(() => onHoverSku(g.sku), 150);
                  }}
                  onMouseLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
                  className="cursor-pointer border-b border-slate-100 hover:bg-indigo-50/50"
                >
                  <td className="px-2 py-1.5 text-center">
                    <MockupHoverZoom url={g.mockupUrl} sku={g.sku} size={32} />
                  </td>
                  <td className="px-3 py-1.5 font-bold text-slate-900">
                    {g.sku}
                    {queued > 0 && (
                      <span className="ml-2 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10.5px] font-bold text-indigo-600" title="Thay đổi đang chờ trong hàng đợi">{queued}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{int(g.clicks)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{g.orders}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(g.spend)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{money(g.sales)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <AcosPill tier={tier} acos={g.sales > 0 ? g.acos : null} />
                  </td>
                  <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <SkuTrendSparkline
                      dailyTrend={skuTrends?.get(g.sku)}
                      sku={g.sku}
                      storeName={selectedStore}
                      mockupUrl={g.mockupUrl}
                      onOpenDetail={onOpenSkuTrend}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > limit && <div ref={loadMoreRef}><LoadingBlock bare rows={2} /></div>}
      </div>
    </div>
  );
}
