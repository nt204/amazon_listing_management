/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChartBarIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import { storeCanEdit, storeCanView } from "@/lib/accounting/store-teams";
import type { StoreAccessInfo } from "@/lib/accounting/types";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import { AccountingTopProgressBar } from "./accounting-skeleton";

// Tab KQKD — "BÁO CÁO KQKD SKU TESTING": Tổng quan tháng (listing / đánh giá) + SKU Testing (lifetime + ma trận tháng).

interface Store {
  id: string;
  name: string;
  team?: string;
  access?: StoreAccessInfo;
}

interface MonthCell {
  revenue: number;
  quantity: number;
  ads_fee: number;
  profit: number;
}

interface KqkdSku {
  id: string;
  sku: string;
  asin: string | null;
  product_type: string | null;
  mockup_url: string | null;
  status: string | null;
  pic_idea: string | null;
  listing_month: string;
  eval_month: string | null;
  von_hang: number;
  qty_di: number;
  unit_cost: number | null;
  revenue: number;
  quantity: number;
  ads_fee: number;
  profit: number;
  months: Record<string, MonthCell>;
}

interface KqkdData {
  year: number;
  months: { month: string; source: "closed" | "live" }[];
  skus: KqkdSku[];
  winResults: { eval_month: string; product_type: string; win_count: number; updated_by: string | null; updated_at: string }[];
  generatedAt: string;
}

type ViewMode = "overview" | "skus";
type GroupBy = "product_type" | "pic_idea";
type Metric = "revenue" | "quantity" | "ads_fee" | "profit" | "tacos" | "roi";

// Sheet: Mục tiêu SKU WIN = 40% × số SKU có thể đánh giá
const WIN_TARGET_RATE = 0.4;
const WIN_STATUS = "phát triển";
const LOSS_STATUS = "hủy";

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "quantity", label: "Quantity" },
  { key: "ads_fee", label: "Ads Fee" },
  { key: "profit", label: "Profit" },
  { key: "tacos", label: "TACoS" },
  { key: "roi", label: "ROI" },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US");

function fmtUsd(v: number | null | undefined, compact = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  return (compact ? usd0 : usd).format(v);
}
function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function signClass(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return "text-slate-500";
  return v > 0 ? "text-emerald-700" : "text-rose-700";
}
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `T${Number(m)}/${y.slice(2)}`;
}
function fmtTarget(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function ratio(num: number, den: number) {
  return den ? num / den : null;
}
function statusKind(status: string | null): "win" | "loss" | "pending" {
  const s = (status || "").trim().toLowerCase();
  if (s === WIN_STATUS) return "win";
  if (s === LOSS_STATUS) return "loss";
  return "pending";
}

// Chỉ số dẫn xuất của 1 SKU — cùng công thức sheet SKU TESTING
function derive(s: KqkdSku) {
  const basecostSold = s.unit_cost != null ? s.unit_cost * s.quantity : 0;
  const hoanVon = basecostSold + s.profit;
  return {
    basecostSold,
    tacos: ratio(-s.ads_fee, s.revenue),
    roi: ratio(s.profit, basecostSold),
    hoanVon,
    hoanVonPct: ratio(hoanVon, s.von_hang),
    ton: s.qty_di - s.quantity,
  };
}

function cellMetric(cell: MonthCell | undefined, metric: Metric, unitCost: number | null): number | null {
  if (!cell) return null;
  switch (metric) {
    case "revenue":
      return cell.revenue;
    case "quantity":
      return cell.quantity;
    case "ads_fee":
      return cell.ads_fee;
    case "profit":
      return cell.profit;
    case "tacos":
      return ratio(-cell.ads_fee, cell.revenue);
    case "roi":
      return unitCost ? ratio(cell.profit, cell.quantity * unitCost) : null;
  }
}

function fmtMetric(v: number | null, metric: Metric) {
  if (v == null) return "—";
  if (metric === "quantity") return int.format(v);
  if (metric === "tacos" || metric === "roi") return fmtPct(v);
  return fmtUsd(v, true);
}

function StatusPill({ status }: { status: string | null }) {
  const kind = statusKind(status);
  const cls =
    kind === "win"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : kind === "loss"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-amber-50 text-amber-800 border-amber-200";
  return (
    <span className={`inline-flex rounded-full border px-2 py-px text-[11px] font-bold whitespace-nowrap ${cls}`}>
      {status || "—"}
    </span>
  );
}

// Ô nhập "WIN thực tế": lưu khi rời ô / Enter; để trống = chưa điền
function WinInput({
  value,
  max,
  disabled,
  saving,
  onCommit,
}: {
  value: number | null;
  max: number;
  disabled: boolean;
  saving: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const commit = () => {
    const t = draft.trim();
    const next = t === "" ? null : Number.parseInt(t, 10);
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  const over = draft.trim() !== "" && Number(draft) > max;
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={draft}
      disabled={disabled || saving}
      placeholder="—"
      aria-label="Số SKU WIN thực tế"
      title={over ? `Lớn hơn số SKU đến hạn (${max})` : "Nhập số SKU WIN thực tế, Enter để lưu"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value == null ? "" : String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-16 rounded-md border px-1.5 py-0.5 text-right font-mono text-xs outline-hidden transition-colors focus:border-sky-500 focus:ring-1 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-50 ${
        over ? "border-amber-400 bg-amber-50" : "border-slate-300 bg-white"
      } ${saving ? "opacity-60" : ""}`}
    />
  );
}

function Kpi({ label, value, sub, meter }: { label: string; value: string; sub?: string; meter?: number | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-white px-3.5 py-2.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-mono text-lg font-bold tabular-nums text-slate-900">{value}</span>
      {sub && <span className="truncate text-[11px] text-slate-500">{sub}</span>}
      {meter != null && Number.isFinite(meter) && (
        <span className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
          <span
            className={`block h-full rounded-full ${meter >= 1 ? "bg-emerald-500" : "bg-sky-500"}`}
            style={{ width: `${Math.max(0, Math.min(100, meter * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xs">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`cursor-pointer px-2.5 py-1 text-xs font-semibold transition-colors ${i > 0 ? "border-l border-slate-300" : ""} ${
            value === o.key ? "bg-sky-600 text-white" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs shadow-2xs">
      <span className="text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[160px] cursor-pointer bg-transparent font-semibold text-slate-800 focus:outline-hidden"
      >
        <option value="">Tất cả</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function KqkdView() {
  const currentYear = new Date().getFullYear();
  const [stores, setStores] = useState<Store[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "overview";
    try {
      return window.sessionStorage.getItem("acc_kqkd_mode") === "skus" ? "skus" : "overview";
    } catch {
      return "overview";
    }
  });
  const [data, setData] = useState<KqkdData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<GroupBy>("product_type");
  const [openListing, setOpenListing] = useState<Set<string>>(new Set());
  const [savingWin, setSavingWin] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("profit");
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [fullLife, setFullLife] = useState(false);

  const [search, setSearch] = useState("");
  const [fProductType, setFProductType] = useState("");
  const [fPic, setFPic] = useState("");
  const [fStatus, setFStatus] = useState("");

  // 1. Store list (FBA)
  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((json: { stores?: Store[] }) => {
        if (ignore) return;
        const list = (json.stores || []).filter((s) => storeCanView(s, "FBA"));
        setStores(list);
        const saved = window.localStorage.getItem("acc_selected_store_id") || "";
        const target = list.find((s) => s.id === saved) || list[0];
        if (target) setSelectedStoreId(target.id);
      })
      .catch(() => {
        if (!ignore) setStores([]);
      })
      .finally(() => {
        if (!ignore) setLoadingStores(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Đồng bộ store với các tab khác
  useEffect(() => {
    const sync = (e: Event) => {
      const id = (e as CustomEvent<string>).detail || window.localStorage.getItem("acc_selected_store_id") || "";
      if (id && stores.some((s) => s.id === id)) setSelectedStoreId(id);
    };
    window.addEventListener("acc_store_changed", sync);
    return () => window.removeEventListener("acc_store_changed", sync);
  }, [stores]);

  const handleStoreSelect = (id: string) => {
    setSelectedStoreId(id);
    window.localStorage.setItem("acc_selected_store_id", id);
    window.dispatchEvent(new CustomEvent("acc_store_changed", { detail: id }));
  };

  const handleMode = (m: ViewMode) => {
    setMode(m);
    try {
      window.sessionStorage.setItem("acc_kqkd_mode", m);
    } catch {
      // bỏ qua: trình duyệt chặn storage
    }
  };

  // 2. Data
  const load = useCallback(
    async (refresh = false) => {
      if (!selectedStoreId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ store_id: selectedStoreId, year: String(year) });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/accounting/financials/kqkd?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Không tải được dữ liệu");
        setData(json as KqkdData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu");
      } finally {
        setLoading(false);
      }
    },
    [selectedStoreId, year]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canEdit = storeCanEdit(stores.find((s) => s.id === selectedStoreId), "FBA");

  const saveWin = useCallback(
    async (evalMonth: string, productType: string, winCount: number | null) => {
      if (!selectedStoreId) return;
      const key = `${evalMonth}|${productType}`;
      setSavingWin(key);
      setError(null);
      try {
        const res = await fetch("/api/accounting/financials/kqkd", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_id: selectedStoreId, eval_month: evalMonth, product_type: productType, win_count: winCount }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Không lưu được số SKU WIN");
        setData((prev) => {
          if (!prev) return prev;
          const rest = prev.winResults.filter((w) => !(w.eval_month === evalMonth && w.product_type === productType));
          return {
            ...prev,
            winResults:
              winCount == null
                ? rest
                : [...rest, { eval_month: evalMonth, product_type: productType, win_count: winCount, updated_by: null, updated_at: new Date().toISOString() }],
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không lưu được số SKU WIN");
      } finally {
        setSavingWin(null);
      }
    },
    [selectedStoreId]
  );

  // 3. Lọc
  const filterOptions = useMemo(() => {
    const skus = data?.skus || [];
    const uniq = (arr: (string | null)[]) => Array.from(new Set(arr.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    return {
      productTypes: uniq(skus.map((s) => s.product_type)),
      pics: uniq(skus.map((s) => s.pic_idea)),
      statuses: uniq(skus.map((s) => s.status)),
    };
  }, [data]);

  const skus = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.skus || []).filter(
      (s) =>
        (!fProductType || s.product_type === fProductType) &&
        (!fPic || s.pic_idea === fPic) &&
        (!fStatus || s.status === fStatus) &&
        (!q || s.sku.toLowerCase().includes(q) || (s.asin || "").toLowerCase().includes(q) || (s.product_type || "").toLowerCase().includes(q))
    );
  }, [data, search, fProductType, fPic, fStatus]);

  const months = useMemo(() => data?.months || [], [data]);
  const liveCount = months.filter((m) => m.source === "live").length;

  // 4. Tổng
  const totals = useMemo(() => {
    let von = 0, qtyDi = 0, revenue = 0, quantity = 0, ads = 0, profit = 0, basecostSold = 0;
    for (const s of skus) {
      const d = derive(s);
      von += s.von_hang;
      qtyDi += s.qty_di;
      revenue += s.revenue;
      quantity += s.quantity;
      ads += s.ads_fee;
      profit += s.profit;
      basecostSold += d.basecostSold;
    }
    const hoanVon = basecostSold + profit;
    return { von, qtyDi, revenue, quantity, ads, profit, basecostSold, hoanVon };
  }, [skus]);


  // 5. Tổng quan: listing theo tháng
  const listingBlocks = useMemo(() => {
    const byMonth = new Map<string, KqkdSku[]>();
    for (const s of skus) {
      if (!byMonth.has(s.listing_month)) byMonth.set(s.listing_month, []);
      byMonth.get(s.listing_month)!.push(s);
    }
    const lastMonth = year < currentYear ? 12 : year > currentYear ? 0 : new Date().getMonth() + 1;
    const blocks = [];
    for (let m = 1; m <= Math.max(lastMonth, ...Array.from(byMonth.keys()).map((k) => Number(k.slice(5, 7)))); m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const list = byMonth.get(key) || [];
      const groups = new Map<string, { n: number; von: number; revenue: number; profit: number }>();
      for (const s of list) {
        const g = (groupBy === "product_type" ? s.product_type : s.pic_idea) || "(trống)";
        const cur = groups.get(g) || { n: 0, von: 0, revenue: 0, profit: 0 };
        cur.n += 1;
        cur.von += s.von_hang;
        cur.revenue += s.revenue;
        cur.profit += s.profit;
        groups.set(g, cur);
      }
      blocks.push({
        month: key,
        n: list.length,
        von: list.reduce((a, s) => a + s.von_hang, 0),
        revenue: list.reduce((a, s) => a + s.revenue, 0),
        profit: list.reduce((a, s) => a + s.profit, 0),
        groups: Array.from(groups.entries()).sort((a, b) => b[1].von - a[1].von),
      });
    }
    return blocks;
  }, [skus, groupBy, year, currentYear]);

  // 6. Tổng quan: đánh giá theo tháng — luôn theo Phôi như sheet; WIN thực tế = số team nhập
  const winMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of data?.winResults || []) map.set(`${w.eval_month}|${w.product_type}`, w.win_count);
    return map;
  }, [data]);

  const evalBlocks = useMemo(() => {
    const byMonth = new Map<string, Map<string, number>>();
    for (const s of skus) {
      if (!s.eval_month || !s.eval_month.startsWith(String(year))) continue;
      const phoi = s.product_type || "(trống)";
      if (!byMonth.has(s.eval_month)) byMonth.set(s.eval_month, new Map());
      const m = byMonth.get(s.eval_month)!;
      m.set(phoi, (m.get(phoi) || 0) + 1);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, phois]) => {
        const groups = Array.from(phois.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([phoi, n]) => ({ phoi, n, win: winMap.has(`${month}|${phoi}`) ? winMap.get(`${month}|${phoi}`)! : null }));
        const n = groups.reduce((a, g) => a + g.n, 0);
        // Sheet: Tổng WIN = SUM các ô đã điền; chưa điền ô nào thì để trống
        const entered = groups.filter((g) => g.win != null);
        const win = entered.length ? entered.reduce((a, g) => a + (g.win || 0), 0) : null;
        return { month, n, win, groups };
      });
  }, [skus, year, winMap]);

  // KPI Tỉ lệ WIN: các phôi đã có số team nhập
  const evalStats = useMemo(() => {
    let n = 0;
    let win = 0;
    for (const b of evalBlocks)
      for (const g of b.groups)
        if (g.win != null) {
          n += g.n;
          win += g.win;
        }
    return { evaluated: n, win };
  }, [evalBlocks]);

  const noEvalCount = skus.filter((s) => !s.eval_month).length;

  // Ma trận tháng: thang màu theo giá trị lớn nhất
  const heatMax = useMemo(() => {
    let max = 0;
    for (const s of skus)
      for (const m of months) {
        const v = cellMetric(s.months[m.month], metric, s.unit_cost);
        if (v != null && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
      }
    return max || 1;
  }, [skus, months, metric]);

  const heatStyle = (v: number | null): React.CSSProperties | undefined => {
    if (v == null || !Number.isFinite(v) || v === 0) return undefined;
    if (metric === "tacos") return undefined;
    const a = Math.min(1, Math.abs(v) / heatMax);
    const positiveGood = metric !== "ads_fee";
    const good = positiveGood ? v > 0 : false;
    const color = good ? "16,185,129" : metric === "revenue" || metric === "quantity" ? "14,165,233" : "244,63,94";
    return { backgroundColor: `rgba(${color},${(0.06 + a * 0.32).toFixed(3)})` };
  };

  const years = useMemo(() => {
    const list = [];
    for (let y = currentYear; y >= 2024; y--) list.push(y);
    return list;
  }, [currentYear]);

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const hasFilter = Boolean(search || fProductType || fPic || fStatus);

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-2 font-sans">
      {/* TOOLBAR */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300 bg-slate-200/70 p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs shadow-2xs">
            <StorefrontIcon size={15} weight="bold" className="mr-1.5 shrink-0 text-amber-600" />
            <select
              id="kqkd-store-select"
              value={selectedStoreId}
              onChange={(e) => handleStoreSelect(e.target.value)}
              disabled={loadingStores || stores.length === 0}
              className="cursor-pointer bg-transparent font-bold text-slate-800 focus:outline-hidden"
            >
              {loadingStores ? (
                <option value="">Đang tải store...</option>
              ) : stores.length === 0 ? (
                <option value="">Không có store</option>
              ) : (
                stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs shadow-2xs">
            <CalendarBlankIcon size={14} weight="bold" className="mr-1.5 text-sky-600" />
            <span className="mr-1 text-slate-500">Năm listing</span>
            <select
              id="kqkd-year-select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="cursor-pointer bg-transparent font-bold text-slate-800 focus:outline-hidden"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <Segmented<ViewMode>
            value={mode}
            onChange={handleMode}
            options={[
              { key: "overview", label: "Tổng quan tháng" },
              { key: "skus", label: "SKU Testing" },
            ]}
          />
        </div>

        <div className="flex items-center gap-2">
          {liveCount > 0 && (
            <span
              className="hidden items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 md:inline-flex"
              title="Tháng hiện tại = Lọc SKU Test (chỉ SKU trạng thái Test), giống tab INPUT KQ Tháng hiện tại. Tháng đã qua chưa chốt SKU Monthly được tạm tính theo công thức Lọc SKU Win — Profit chưa gồm phí lưu kho, phí cuối tháng nên sẽ khác tab Tháng N."
            >
              <InfoIcon size={13} weight="bold" />
              {liveCount} tháng tạm tính
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || !selectedStoreId}
            className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <ArrowClockwiseIcon size={14} className={loading ? "animate-spin text-amber-600" : "text-slate-600"} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative w-44 transition-all duration-200 focus-within:w-56">
          <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="kqkd-search"
            type="text"
            placeholder="Tìm SKU, ASIN, phôi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-1 pl-7 pr-5 text-xs font-medium text-slate-800 placeholder-slate-400 shadow-2xs outline-hidden focus:border-sky-500"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Xoá tìm kiếm">
              <XIcon size={10} />
            </button>
          )}
        </div>
        <FilterSelect label="Phôi" value={fProductType} options={filterOptions.productTypes} onChange={setFProductType} />
        <FilterSelect label="PIC Idea" value={fPic} options={filterOptions.pics} onChange={setFPic} />
        <FilterSelect label="Trạng thái" value={fStatus} options={filterOptions.statuses} onChange={setFStatus} />
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setFProductType("");
              setFPic("");
              setFStatus("");
            }}
            className="cursor-pointer text-[11px] font-bold text-rose-600 hover:underline"
          >
            Xoá lọc
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
      )}

      {/* KPI */}
      <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-300 bg-slate-300 shadow-2xs sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label={`SKU test ${year}`} value={int.format(skus.length)} sub={`${int.format(totals.qtyDi)} sp đi hàng · tồn ${int.format(totals.qtyDi - totals.quantity)}`} />
        <Kpi label="Vốn test" value={fmtUsd(totals.von)} sub="Tổng Basecost các lô đi hàng" />
        <Kpi label="Revenue lifetime" value={fmtUsd(totals.revenue)} sub={`TACoS ${fmtPct(ratio(-totals.ads, totals.revenue))} · ${int.format(totals.quantity)} sp`} />
        <Kpi label="Profit lifetime" value={fmtUsd(totals.profit)} sub={`ROI ${fmtPct(ratio(totals.profit, totals.basecostSold))}`} />
        <Kpi label="Đã hoàn vốn" value={fmtUsd(totals.hoanVon)} sub={`${fmtPct(ratio(totals.hoanVon, totals.von))} vốn test`} meter={ratio(totals.hoanVon, totals.von)} />
        <Kpi
          label="Tỉ lệ WIN"
          value={evalStats.evaluated ? fmtPct(evalStats.win / evalStats.evaluated) : "—"}
          sub={`${evalStats.win}/${evalStats.evaluated} SKU đã nhập kết quả · mục tiêu ${Math.round(WIN_TARGET_RATE * 100)}%`}
          meter={evalStats.evaluated ? evalStats.win / evalStats.evaluated / WIN_TARGET_RATE : null}
        />
      </div>

      {/* CONTENT */}
      <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xs">
        <AccountingTopProgressBar loading={loading} variant="indigo" />

        {!loading && data && skus.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-sm text-slate-500">
            <ChartBarIcon size={32} className="text-slate-300" />
            <p className="font-semibold text-slate-700">Không có SKU listing trong năm {year}</p>
            <p className="max-w-md text-xs">
              Tab này lấy các SKU có “Tháng listing” thuộc năm {year} trong Bảng mã. Điền cột Tháng listing / Tháng đánh giá ở Bảng mã để SKU xuất hiện.
            </p>
          </div>
        )}

        {mode === "overview" && skus.length > 0 && (
          <div className="flex flex-1 flex-col overflow-auto">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold text-slate-500">Nhóm theo</span>
              <Segmented<GroupBy>
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { key: "product_type", label: "Phôi" },
                  { key: "pic_idea", label: "PIC Idea" },
                ]}
              />
              <span className="ml-auto text-[11px] text-slate-500">Bấm một tháng để xem chi tiết</span>
            </div>
            <div className="grid flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              {/* Listing */}
              <div className="min-w-0 border-slate-200 xl:border-r">
                <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  R&amp;D Testing · listing trong tháng
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-left text-[11px] font-bold text-slate-600">
                        <th className="border-b border-slate-200 px-3 py-2">Tháng listing</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Số SKU</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Vốn test</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Revenue</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Profit</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Hoàn vốn</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {listingBlocks.map((b) => {
                        const open = openListing.has(b.month);
                        const monthSkus = skus.filter((s) => s.listing_month === b.month);
                        const hv = monthSkus.reduce((a, s) => a + derive(s).hoanVon, 0);
                        return (
                          <Fragment key={b.month}>
                            <tr
                              className={`font-sans ${b.n ? "cursor-pointer hover:bg-sky-50/60" : ""} bg-white`}
                              onClick={() => b.n && toggle(openListing, b.month, setOpenListing)}
                            >
                              <td className="border-b border-slate-100 px-3 py-1.5 font-semibold text-slate-800">
                                <span className="inline-flex items-center gap-1">
                                  {b.n ? (open ? <CaretDownIcon size={11} weight="bold" /> : <CaretRightIcon size={11} weight="bold" />) : <span className="inline-block w-[11px]" />}
                                  Tháng {Number(b.month.slice(5, 7))}
                                </span>
                              </td>
                              <td className={`border-b border-slate-100 px-3 py-1.5 text-right font-mono ${b.n ? "text-slate-900" : "text-slate-300"}`}>{b.n}</td>
                              <td className="border-b border-slate-100 px-3 py-1.5 text-right font-mono">{b.n ? fmtUsd(b.von) : <span className="text-slate-300">—</span>}</td>
                              <td className="border-b border-slate-100 px-3 py-1.5 text-right font-mono">{b.n ? fmtUsd(b.revenue) : ""}</td>
                              <td className={`border-b border-slate-100 px-3 py-1.5 text-right font-mono ${signClass(b.profit)}`}>{b.n ? fmtUsd(b.profit) : ""}</td>
                              <td className="border-b border-slate-100 px-3 py-1.5 text-right font-mono">{b.n ? fmtPct(ratio(hv, b.von)) : ""}</td>
                            </tr>
                            {open &&
                              b.groups.map(([g, v]) => (
                                <tr key={g} className="bg-slate-50/70">
                                  <td className="border-b border-slate-100 py-1.5 pl-8 pr-3 font-sans text-slate-700">{g}</td>
                                  <td className="border-b border-slate-100 px-3 py-1.5 text-right">{v.n}</td>
                                  <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtUsd(v.von)}</td>
                                  <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtUsd(v.revenue)}</td>
                                  <td className={`border-b border-slate-100 px-3 py-1.5 text-right ${signClass(v.profit)}`}>{fmtUsd(v.profit)}</td>
                                  <td className="border-b border-slate-100 px-3 py-1.5 text-right" />
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                      <tr className="bg-slate-100 font-bold">
                        <td className="border-t-2 border-slate-300 px-3 py-2 font-sans">Cả năm</td>
                        <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{skus.length}</td>
                        <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.von)}</td>
                        <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.revenue)}</td>
                        <td className={`border-t-2 border-slate-300 px-3 py-2 text-right ${signClass(totals.profit)}`}>{fmtUsd(totals.profit)}</td>
                        <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtPct(ratio(totals.hoanVon, totals.von))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Evaluation — giống khối "Tên Phôi cần đánh giá … Tỉ lệ WIN" (Team điền) của sheet */}
              <div className="min-w-0 border-t border-slate-200 xl:border-t-0">
                <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Đánh giá trong tháng · mục tiêu WIN {Math.round(WIN_TARGET_RATE * 100)}%
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-left text-[11px] font-bold text-slate-600">
                        <th className="border-b border-slate-200 px-3 py-2">Tháng / Phôi cần đánh giá</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Số SKU</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Mục tiêu WIN</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">WIN thực tế</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right">Tỉ lệ WIN</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {evalBlocks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center font-sans text-slate-500">
                            Chưa có SKU nào có Tháng đánh giá trong năm {year}.
                          </td>
                        </tr>
                      )}
                      {evalBlocks.map((b) => {
                        const rate = b.win != null && b.n ? b.win / b.n : null;
                        return (
                          <Fragment key={b.month}>
                            <tr className="bg-slate-100/70 font-sans font-semibold text-slate-800">
                              <td className="border-b border-slate-200 px-3 py-1.5">Tháng {Number(b.month.slice(5, 7))}</td>
                              <td className="border-b border-slate-200 px-3 py-1.5 text-right font-mono">{b.n}</td>
                              <td className="border-b border-slate-200 px-3 py-1.5 text-right font-mono">{fmtTarget(b.n * WIN_TARGET_RATE)}</td>
                              <td className="border-b border-slate-200 px-3 py-1.5 text-right font-mono">{b.win ?? "—"}</td>
                              <td className="border-b border-slate-200 px-3 py-1.5 text-right">
                                {rate == null ? (
                                  <span className="text-slate-400">—</span>
                                ) : (
                                  <span
                                    className={`rounded-full border px-2 py-px font-mono text-[11px] font-bold ${
                                      rate >= WIN_TARGET_RATE
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-rose-200 bg-rose-50 text-rose-700"
                                    }`}
                                  >
                                    {fmtPct(rate)}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {b.groups.map((g) => (
                              <tr key={g.phoi} className="bg-white">
                                <td className="border-b border-slate-100 py-1.5 pl-6 pr-3 font-sans text-slate-700">{g.phoi}</td>
                                <td className="border-b border-slate-100 px-3 py-1.5 text-right">{g.n}</td>
                                <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtTarget(g.n * WIN_TARGET_RATE)}</td>
                                <td className="border-b border-slate-100 px-2 py-1 text-right">
                                  <WinInput
                                    key={`${b.month}|${g.phoi}|${g.win ?? ""}`}
                                    value={g.win}
                                    max={g.n}
                                    disabled={!canEdit}
                                    saving={savingWin === `${b.month}|${g.phoi}`}
                                    onCommit={(v) => saveWin(b.month, g.phoi, v)}
                                  />
                                </td>
                                <td className="border-b border-slate-100 px-3 py-1.5 text-right">{g.win == null ? "—" : fmtPct(g.n ? g.win / g.n : null)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
                  <p>
                    <b className="text-slate-700">WIN thực tế</b> do team nhập tay cho từng phôi, giống ô “Team điền” trong file Excel. Mục tiêu = {Math.round(WIN_TARGET_RATE * 100)}% × số SKU, tỉ lệ = WIN ÷ số SKU.
                    {!canEdit && " Bạn chỉ có quyền xem store này."}
                  </p>
                  {noEvalCount > 0 && <p>{noEvalCount} SKU chưa có Tháng đánh giá trong Bảng mã nên chưa vào bảng này.</p>}
                  {hasFilter && <p className="text-amber-700">Đang lọc: số SKU theo bộ lọc, WIN thực tế là số team nhập cho cả phôi.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === "skus" && skus.length > 0 && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold text-slate-500">Ma trận tháng</span>
              <Segmented<Metric> value={metric} onChange={setMetric} options={METRICS} />
              <span className="ml-2 text-xs font-semibold text-slate-500">Lifetime</span>
              <Segmented<"compact" | "full">
                value={fullLife ? "full" : "compact"}
                onChange={(v) => setFullLife(v === "full")}
                options={[
                  { key: "compact", label: "Gọn" },
                  { key: "full", label: "Đầy đủ" },
                ]}
              />
              <span className="ml-auto text-[11px] text-slate-500">Bấm một dòng để xem đủ chỉ số từng tháng</span>
            </div>
            <div className="flex-1 overflow-auto scrollbar-thin">
              <table className="min-w-max border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="sticky left-0 z-30 bg-slate-100 px-3 pt-1.5" />
                    <th colSpan={5} className="px-3 pt-1.5 text-left">Thông tin</th>
                    <th colSpan={fullLife ? 11 : 4} className="border-l-2 border-slate-300 px-3 pt-1.5 text-left">Lifetime</th>
                    <th colSpan={Math.max(1, months.length)} className="border-l-2 border-slate-300 px-3 pt-1.5 text-left">
                      {METRICS.find((m) => m.key === metric)?.label} theo tháng
                    </th>
                  </tr>
                  <tr className="bg-slate-100 text-left text-[11px] font-bold text-slate-700">
                    <th className="sticky left-0 z-30 border-b border-slate-300 bg-slate-100 px-3 py-2 shadow-[1px_0_0_#e2e8f0]">SKU</th>
                    <th className="border-b border-slate-300 px-3 py-2">Phôi</th>
                    <th className="border-b border-slate-300 px-3 py-2">Trạng thái</th>
                    <th className="border-b border-slate-300 px-3 py-2">PIC</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Listing</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Đánh giá</th>
                    <th className="border-b border-l-2 border-slate-300 px-3 py-2 text-right">Vốn hàng</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Revenue</th>
                    {fullLife && (<>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Qty</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Basecost</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Ads Fee</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">TACoS</th>
                    </>)}
                    <th className="border-b border-slate-300 bg-orange-100 px-3 py-2 text-right">Profit</th>
                    {fullLife && (<>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">ROI</th>
                    <th className="border-b border-slate-300 px-3 py-2 text-right">Hoàn vốn</th>
                    </>)}
                    <th className="border-b border-slate-300 px-3 py-2 text-right">% hoàn vốn</th>
                    {fullLife && (<>
                    <th className="border-b border-slate-300 px-3 py-2 text-right" title="Số lượng đi hàng / còn lại">Đi / Tồn</th>
                    </>)}
                    {months.map((m, i) => (
                      <th
                        key={m.month}
                        className={`border-b border-slate-300 px-3 py-2 text-right ${i === 0 ? "border-l-2" : ""}`}
                        title={m.source === "live" ? "Tạm tính từ đơn hàng / ads / return (chưa chốt SKU Monthly)" : "Số chốt SKU Monthly"}
                      >
                        <span className="inline-flex items-center gap-1">
                          {monthLabel(m.month)}
                          {m.source === "live" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="tạm tính" />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {skus.map((s) => {
                    const d = derive(s);
                    const thumb = getOptimizedThumbnailUrl(s.mockup_url, 64);
                    const expanded = expandedSku === s.sku;
                    return (
                      <Fragment key={s.sku}>
                        <tr className="group cursor-pointer bg-white hover:bg-sky-50/50" onClick={() => setExpandedSku(expanded ? null : s.sku)}>
                          <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 font-sans shadow-[1px_0_0_#e2e8f0] group-hover:bg-sky-50">
                            <span className="flex items-center gap-2">
                              {thumb ? (
                                <img src={thumb} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded border border-slate-200 object-cover" />
                              ) : (
                                <span className="h-7 w-7 shrink-0 rounded border border-slate-200 bg-slate-100" />
                              )}
                              <span className="flex flex-col leading-tight">
                                <span className="font-mono text-[11.5px] font-bold text-slate-900">{s.sku}</span>
                                {s.asin && <span className="font-mono text-[10px] text-slate-400">{s.asin}</span>}
                              </span>
                            </span>
                          </td>
                          <td className="max-w-[170px] truncate border-b border-slate-100 px-3 py-1.5 font-sans text-slate-700" title={s.product_type || ""}>{s.product_type || "—"}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 font-sans"><StatusPill status={s.status} /></td>
                          <td className="border-b border-slate-100 px-3 py-1.5 font-sans text-slate-700">{s.pic_idea || "—"}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{monthLabel(s.listing_month)}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{s.eval_month ? monthLabel(s.eval_month) : <span className="text-slate-300">—</span>}</td>
                          <td className="border-b border-l-2 border-slate-100 border-l-slate-200 px-3 py-1.5 text-right">{fmtUsd(s.von_hang)}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtUsd(s.revenue)}</td>
                          {fullLife && (<>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{int.format(s.quantity)}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtUsd(d.basecostSold)}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right text-rose-700">{fmtUsd(s.ads_fee)}</td>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right">{fmtPct(d.tacos)}</td>
                          </>)}
                          <td className={`border-b border-slate-100 bg-orange-50 px-3 py-1.5 text-right font-bold ${signClass(s.profit)}`}>{fmtUsd(s.profit)}</td>
                          {fullLife && (<>
                          <td className={`border-b border-slate-100 px-3 py-1.5 text-right ${signClass(d.roi)}`}>{fmtPct(d.roi)}</td>
                          <td className={`border-b border-slate-100 px-3 py-1.5 text-right ${signClass(d.hoanVon)}`}>{fmtUsd(d.hoanVon)}</td>
                          </>)}
                          <td className={`border-b border-slate-100 px-3 py-1.5 text-right ${d.hoanVonPct != null && d.hoanVonPct >= 1 ? "font-bold text-emerald-700" : ""}`}>{fmtPct(d.hoanVonPct)}</td>
                          {fullLife && (<>
                          <td className="border-b border-slate-100 px-3 py-1.5 text-right text-slate-600">
                            {int.format(s.qty_di)} / {int.format(d.ton)}
                          </td>
                          </>)}
                          {months.map((m, i) => {
                            const v = cellMetric(s.months[m.month], metric, s.unit_cost);
                            const before = m.month < s.listing_month && !s.months[m.month];
                            return (
                              <td
                                key={m.month}
                                className={`min-w-[72px] border-b border-slate-100 px-3 py-1.5 text-right ${i === 0 ? "border-l-2 border-l-slate-200" : ""} ${
                                  before ? "bg-slate-50 text-slate-300" : metric === "profit" || metric === "roi" ? signClass(v) : v ? "text-slate-800" : "text-slate-300"
                                }`}
                                style={before ? undefined : heatStyle(v)}
                              >
                                {before ? "·" : fmtMetric(v, metric)}
                              </td>
                            );
                          })}
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={(fullLife ? 17 : 10) + months.length} className="border-b border-slate-200 px-3 py-2">
                              <div className="sticky left-3 inline-block max-w-[calc(100vw-80px)] overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="border-separate border-spacing-0 text-[11px]">
                                  <thead>
                                    <tr className="bg-slate-100 text-slate-600">
                                      <th className="px-2.5 py-1.5 text-left font-sans">{s.sku}</th>
                                      {months
                                        .filter((m) => m.month >= s.listing_month || s.months[m.month])
                                        .map((m) => (
                                          <th key={m.month} className="px-2.5 py-1.5 text-right font-sans">
                                            {monthLabel(m.month)}
                                            {m.source === "live" ? "*" : ""}
                                          </th>
                                        ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {METRICS.map((mt) => (
                                      <tr key={mt.key}>
                                        <td className="border-t border-slate-100 px-2.5 py-1 font-sans font-semibold text-slate-600">{mt.label}</td>
                                        {months
                                          .filter((m) => m.month >= s.listing_month || s.months[m.month])
                                          .map((m) => {
                                            const v = cellMetric(s.months[m.month], mt.key, s.unit_cost);
                                            return (
                                              <td
                                                key={m.month}
                                                className={`border-t border-slate-100 px-2.5 py-1 text-right ${mt.key === "profit" || mt.key === "roi" ? signClass(v) : "text-slate-800"}`}
                                              >
                                                {fmtMetric(v, mt.key)}
                                              </td>
                                            );
                                          })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p className="mt-1.5 font-sans text-[11px] text-slate-500">
                                Giá vốn / sp {fmtUsd(s.unit_cost)} (vốn lô ÷ số đi hàng). * = tháng tạm tính. — = không có số (tháng hiện tại chỉ có SKU trạng thái Test, giống tab INPUT KQ).
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-20 font-mono tabular-nums">
                  <tr className="bg-slate-100 font-bold text-slate-900">
                    <td className="sticky left-0 z-30 border-t-2 border-slate-300 bg-slate-100 px-3 py-2 font-sans">Tổng {skus.length} SKU</td>
                    <td colSpan={5} className="border-t-2 border-slate-300" />
                    <td className="border-l-2 border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.von)}</td>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.revenue)}</td>
                    {fullLife && (<>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{int.format(totals.quantity)}</td>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.basecostSold)}</td>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right text-rose-700">{fmtUsd(totals.ads)}</td>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtPct(ratio(-totals.ads, totals.revenue))}</td>
                    </>)}
                    <td className={`border-t-2 border-slate-300 bg-orange-100 px-3 py-2 text-right ${signClass(totals.profit)}`}>{fmtUsd(totals.profit)}</td>
                    {fullLife && (<>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtPct(ratio(totals.profit, totals.basecostSold))}</td>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtUsd(totals.hoanVon)}</td>
                    </>)}
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">{fmtPct(ratio(totals.hoanVon, totals.von))}</td>
                    {fullLife && (<>
                    <td className="border-t-2 border-slate-300 px-3 py-2 text-right">
                      {int.format(totals.qtyDi)} / {int.format(totals.qtyDi - totals.quantity)}
                    </td>
                    </>)}
                    {months.map((m, i) => {
                      let rev = 0, qty = 0, ads = 0, profit = 0, cost = 0;
                      for (const s of skus) {
                        const c = s.months[m.month];
                        if (!c) continue;
                        rev += c.revenue;
                        qty += c.quantity;
                        ads += c.ads_fee;
                        profit += c.profit;
                        cost += c.quantity * (s.unit_cost || 0);
                      }
                      const v = cellMetric({ revenue: rev, quantity: qty, ads_fee: ads, profit }, metric, null);
                      const shown = metric === "roi" ? ratio(profit, cost) : v;
                      return (
                        <td key={m.month} className={`border-t-2 border-slate-300 px-3 py-2 text-right ${i === 0 ? "border-l-2" : ""} ${metric === "profit" || metric === "roi" ? signClass(shown) : ""}`}>
                          {fmtMetric(shown, metric)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Tháng tạm tính (tháng hiện tại hoặc chưa chốt SKU Monthly)
              </span>
              <span>· = trước tháng listing</span>
              <span>Basecost = giá vốn lô × số đã bán · Hoàn vốn = Basecost + Profit</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
