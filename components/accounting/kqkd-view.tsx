/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  StorefrontIcon,
  XIcon,
} from "@phosphor-icons/react";
import { storeCanEdit, storeCanView } from "@/lib/accounting/store-teams";
import type { StoreAccessInfo } from "@/lib/accounting/types";
import { getOptimizedThumbnailUrl } from "@/lib/image-client";
import { AccountingTopProgressBar } from "./accounting-skeleton";

// Tab KQKD — tham khảo file "BÁO CÁO KQKD SKU TESTING" (tab Tổng quan tháng + SKU TESTING).

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
type Metric = "revenue" | "quantity" | "ads_fee" | "tacos" | "profit" | "roi";

// Sheet: Mục tiêu SKU WIN = 40% × số SKU đánh giá
const WIN_TARGET_RATE = 0.4;
// Trạng thái Bảng mã của SKU đã WIN — dùng để gợi ý số WIN cho team
const WIN_STATUS = "phát triển";
const LOSS_STATUS = "hủy";

const MONTHS_12 = Array.from({ length: 12 }, (_, i) => i + 1);

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "quantity", label: "Quantity" },
  { key: "ads_fee", label: "Ads Fee" },
  { key: "tacos", label: "TAcos" },
  { key: "profit", label: "Profit" },
  { key: "roi", label: "ROI" },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US");
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtUsd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return usd.format(v);
}
function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return `${(v * 100).toFixed(1)}%`;
}
function fmtInt(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return int.format(v);
}
function fmtTarget(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function ratio(num: number, den: number) {
  return den ? num / den : null;
}
function monthNum(period: string) {
  return Number(period.slice(5, 7));
}
function monthLabel(period: string) {
  return `T${monthNum(period)}/${period.slice(0, 4)}`;
}
function statusKind(status: string | null) {
  const s = (status || "").trim().toLowerCase();
  return s === WIN_STATUS ? "win" : s === LOSS_STATUS ? "loss" : "test";
}
function signClass(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005) return "";
  return v > 0 ? "" : "!text-red-600";
}

// Basecost = giá vốn lô × đã bán · ROI = Profit / Basecost · Hoàn vốn = Basecost + Profit (tiền vốn đã thu về)
function derive(s: KqkdSku) {
  const basecost = s.unit_cost != null ? s.unit_cost * s.quantity : 0;
  const hoanVon = basecost + s.profit;
  return {
    basecost,
    tacos: ratio(-s.ads_fee, s.revenue),
    roi: ratio(s.profit, basecost),
    hoanVon,
    hoanVonPct: ratio(hoanVon, s.von_hang),
    ton: s.qty_di - s.quantity,
  };
}

function cellMetric(c: MonthCell | undefined, metric: Metric, unitCost: number | null): number | null {
  if (!c) return null;
  switch (metric) {
    case "revenue":
      return c.revenue;
    case "quantity":
      return c.quantity;
    case "ads_fee":
      return c.ads_fee;
    case "profit":
      return c.profit;
    case "tacos":
      return ratio(-c.ads_fee, c.revenue);
    case "roi":
      return unitCost ? ratio(c.profit, c.quantity * unitCost) : null;
  }
}
function fmtMetric(v: number | null, metric: Metric) {
  if (v == null) return "";
  if (metric === "quantity") return fmtInt(v);
  if (metric === "tacos" || metric === "roi") return fmtPct(v);
  return fmtUsd(v);
}

// Ô "SKU WIN thực tế" (team điền): lưu khi rời ô / Enter; trống = chưa điền. Placeholder = số SKU "Phát triển" trong Bảng mã.
function WinInput({
  value,
  max,
  suggest,
  disabled,
  saving,
  onCommit,
}: {
  value: number | null;
  max: number;
  suggest: number;
  disabled: boolean;
  saving: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const reset = () => setDraft(value == null ? "" : String(value));
  const commit = () => {
    const t = draft.trim();
    const next = t === "" ? null : Number.parseInt(t, 10);
    if (next != null && (!Number.isFinite(next) || next < 0 || next > max)) return reset();
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      value={draft}
      placeholder={disabled ? "" : String(suggest)}
      disabled={disabled || saving}
      aria-label="SKU WIN thực tế"
      title={disabled ? undefined : `Tối đa ${max}. Gợi ý ${suggest} = số SKU trạng thái Phát triển`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          reset();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-14 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs outline-hidden placeholder:italic placeholder:text-slate-400 focus:border-sky-500 focus:bg-white disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent ${
        saving ? "opacity-60" : ""
      }`}
    />
  );
}

const C_TARGET = "#bfdbfe";
const C_WIN = "#2563eb";
const C_GOOD = "#16a34a";
const C_TEST = "#f59e0b";

// Kết quả SKU WIN theo tháng đánh giá: cột Mục tiêu cạnh cột WIN thực tế (một trục = số SKU), % WIN ghi trên cột.
function WinChart({
  items,
}: {
  items: { month: number; target: number | null; win: number | null; rate: number | null; note?: string; tip: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.target ?? 0, i.win ?? 0)));
  const h = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-slate-800">SKU WIN theo tháng</span>
        <span className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C_TARGET }} /> Mục tiêu
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C_WIN }} /> WIN thực tế
          </span>
        </span>
      </figcaption>
      <div className="relative mt-6 h-28 border-b border-slate-200">
        <div className="absolute inset-0 flex">
          {items.map((it) => (
            <div key={it.month} title={it.tip} className="relative flex h-full flex-1 items-end justify-center gap-[3px] hover:bg-slate-50">
              {(it.rate != null || it.note) && (
                <span
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10.5px] ${it.rate != null ? "font-semibold text-slate-800" : "text-slate-400"}`}
                  style={{ bottom: `calc(${h(Math.max(it.target ?? 0, it.win ?? 0))} + 4px)` }}
                >
                  {it.rate != null ? fmtPct(it.rate) : it.note}
                </span>
              )}
              {it.target != null && <div className="w-[40%] max-w-7 rounded-t-[3px]" style={{ height: h(it.target), background: C_TARGET }} />}
              {it.target != null && (
                <div className="w-[40%] max-w-7 rounded-t-[3px]" style={{ height: it.win ? h(it.win) : "0", background: C_WIN }} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex pt-1">
        {items.map((it) => (
          <span key={it.month} className="flex-1 text-center text-[11px] text-slate-500">
            T{it.month}
          </span>
        ))}
      </div>
    </figure>
  );
}

// Trạng thái SKU (Bảng mã): WIN = Phát triển · Đang test · Dừng = Hủy
function StatusDonut({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  const segs = parts.map((p, i) => {
    const len = total ? (p.n / total) * C : 0;
    const offset = parts.slice(0, i).reduce((a, q) => a + (total ? (q.n / total) * C : 0), 0);
    return { ...p, len, offset };
  });
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <figcaption className="text-[13px] font-bold text-slate-800">Trạng thái SKU ({total})</figcaption>
      <div className="mt-2 flex items-center gap-6">
        <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label="Trạng thái SKU">
          <circle cx={55} cy={55} r={R} fill="none" stroke="#f1f5f9" strokeWidth={16} />
          {segs.map((p) => (
            <circle key={p.label} cx={55} cy={55} r={R} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${Math.max(0, p.len - 1.5)} ${C}`} strokeDashoffset={-p.offset}>
              <title>{`${p.label}: ${p.n}`}</title>
            </circle>
          ))}
          <text x={55} y={52} textAnchor="middle" transform="rotate(90 55 55)" fontSize={20} fontWeight={700} fill="#0f172a">
            {total}
          </text>
          <text x={55} y={68} textAnchor="middle" transform="rotate(90 55 55)" fontSize={10} fill="#64748b">
            SKU
          </text>
        </svg>
        <ul className="space-y-2.5 text-[13px]">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="w-20 text-slate-700">{p.label}</span>
              <span className="w-8 text-right font-mono font-semibold tabular-nums text-slate-900">{p.n}</span>
              <span className="w-14 text-right font-mono tabular-nums text-slate-500">{fmtPct(ratio(p.n, total))}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

// Sparkline Profit từng tháng: cột lên = lãi, xuống = lỗ
function ProfitSpark({ values }: { values: { label: string; v: number | null }[] }) {
  const W = 84;
  const H = 22;
  const mid = H / 2;
  const max = Math.max(1, ...values.map((x) => Math.abs(x.v ?? 0)));
  const slot = W / Math.max(values.length, 1);
  const bw = Math.max(2, Math.min(5, slot - 1.5));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="#e2e8f0" strokeWidth={1} />
      {values.map((x, i) => {
        if (x.v == null || x.v === 0) return null;
        const h = Math.max(1, (Math.abs(x.v) / max) * (mid - 1));
        return (
          <rect key={x.label} x={slot * i + (slot - bw) / 2} y={x.v > 0 ? mid - h : mid} width={bw} height={h} rx={1} fill={x.v > 0 ? "#64748b" : "#dc2626"}>
            <title>{`${x.label}: ${usd.format(x.v)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// Lưới kẻ mảnh mọi ô; vạch dọc đậm hơn (SEP) ở đầu mỗi nhóm cột.
// Màu chữ trên td/th phải dùng "!" vì CSS chung của Accounting đặt màu cho table td/th.
const TH_BASE = "border border-slate-300 px-3 py-2 text-[11px] font-semibold whitespace-nowrap";
const TH = `${TH_BASE} bg-slate-100 !text-slate-700`;
const TD = "border border-slate-200 px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap";
const TDL = "border border-slate-200 px-3 py-1.5 text-left whitespace-nowrap";
const SEP = "border-l-2 border-l-slate-300";
const MONTH_ROW = "bg-slate-50";
// Ô không áp dụng: gạch ngang nhạt để khỏi lẫn với ô trống
const DASH = <span className="text-slate-300">—</span>;
const TOTAL_ROW = "bg-slate-100 [&>td]:border-t-2 [&>td]:border-t-slate-300";

// % hoàn vốn: chỉ số; âm = đỏ
function PctBar({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  return <span className={v < 0 ? "text-red-600" : ""}>{fmtPct(v)}</span>;
}

// Tỉ lệ WIN so với mục tiêu: nhãn màu
function RatePill({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  const ok = v >= WIN_TARGET_RATE;
  return (
    <span
      title={ok ? "Đạt mục tiêu" : "Chưa đạt mục tiêu"}
      className={`inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
    >
      {fmtPct(v)}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  return <span className={statusKind(status) === "loss" ? "text-slate-400" : ""}>{status}</span>;
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border px-4 py-3 ${highlight ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold leading-tight tabular-nums ${highlight ? "text-emerald-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// Mục "KQKD SKU" riêng trên sidebar: hai trang Tổng quan tháng / SKU Testing chuyển bằng nút trên thanh công cụ.
export function KqkdView() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
  const handleMode = (m: ViewMode) => {
    setMode(m);
    try {
      window.sessionStorage.setItem("acc_kqkd_mode", m);
    } catch {
      // bỏ qua: trình duyệt chặn storage
    }
  };
  const [data, setData] = useState<KqkdData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWin, setSavingWin] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [metric, setMetric] = useState<Metric | "all">("profit");
  const [fPhoi, setFPhoi] = useState("");
  // Tháng đang mở xem chi tiết phôi (mặc định thu gọn: mỗi tháng một dòng "Tất cả")
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const toggleMonth = (m: string) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

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
      setSavingWin(`${evalMonth}|${productType}`);
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

  const allSkus = useMemo(() => data?.skus || [], [data]);
  // Tổng quan: lọc theo Tên Phôi (= Product Type) — KPI, biểu đồ, bảng cùng cập nhật
  const phoiOptions = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.product_type || "(trống)"))).sort((a, b) => a.localeCompare(b)),
    [allSkus]
  );
  const baseSkus = useMemo(() => (fPhoi ? allSkus.filter((s) => (s.product_type || "(trống)") === fPhoi) : allSkus), [allSkus, fPhoi]);
  const statuses = useMemo(
    () => Array.from(new Set(allSkus.map((s) => s.status).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [allSkus]
  );

  const skus = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSkus.filter(
      (s) =>
        (!fStatus || s.status === fStatus) &&
        (!q || s.sku.toLowerCase().includes(q) || (s.asin || "").toLowerCase().includes(q) || (s.product_type || "").toLowerCase().includes(q))
    );
  }, [allSkus, search, fStatus]);

  const months = useMemo(() => data?.months || [], [data]);

  // ===== TỔNG QUAN: listing theo tháng (tháng listing) =====
  const lastMonth = year < currentYear ? 12 : year > currentYear ? 0 : now.getMonth() + 1;

  const listing = useMemo(() => {
    const byMonth = new Map<string, Map<string, { n: number; von: number; hoanVon: number }>>();
    for (const s of baseSkus) {
      if (!s.listing_month.startsWith(String(year))) continue;
      const g = byMonth.get(s.listing_month) || new Map();
      const phoi = s.product_type || "(trống)";
      const cur = g.get(phoi) || { n: 0, von: 0, hoanVon: 0 };
      cur.n += 1;
      cur.von += s.von_hang;
      cur.hoanVon += derive(s).hoanVon;
      g.set(phoi, cur);
      byMonth.set(s.listing_month, g);
    }
    const maxM = Math.max(lastMonth, ...Array.from(byMonth.keys()).map(monthNum));
    const out: { month: string; n: number; von: number; hoanVon: number; rows: { phoi: string; n: number; von: number; hoanVon: number }[] }[] = [];
    for (let m = 1; m <= maxM; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const rows = Array.from((byMonth.get(key) || new Map()).entries())
        .map(([phoi, v]) => ({ phoi, ...v }))
        .sort((a, b) => b.von - a.von);
      out.push({
        month: key,
        rows,
        n: rows.reduce((a, r) => a + r.n, 0),
        von: rows.reduce((a, r) => a + r.von, 0),
        hoanVon: rows.reduce((a, r) => a + r.hoanVon, 0),
      });
    }
    return out;
  }, [baseSkus, year, lastMonth]);

  // ===== TỔNG QUAN: đánh giá theo tháng đánh giá =====
  const winMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of data?.winResults || []) map.set(`${w.eval_month}|${w.product_type}`, w.win_count);
    return map;
  }, [data]);

  const evals = useMemo(() => {
    const byMonth = new Map<string, Map<string, { n: number; suggest: number }>>();
    for (const s of baseSkus) {
      if (!s.eval_month || !s.eval_month.startsWith(String(year))) continue;
      const g = byMonth.get(s.eval_month) || new Map();
      const phoi = s.product_type || "(trống)";
      const cur = g.get(phoi) || { n: 0, suggest: 0 };
      cur.n += 1;
      if (statusKind(s.status) === "win") cur.suggest += 1;
      g.set(phoi, cur);
      byMonth.set(s.eval_month, g);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, g]) => {
        const rows = Array.from(g.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([phoi, v]) => ({ phoi, ...v, win: winMap.has(`${month}|${phoi}`) ? winMap.get(`${month}|${phoi}`)! : null }));
        // Tỉ lệ chỉ tính trên các phôi team đã điền — phôi chưa điền không kéo tỉ lệ xuống
        const done = rows.filter((r) => r.win != null);
        return {
          month,
          due: month <= currentMonth,
          rows,
          n: rows.reduce((a, r) => a + r.n, 0),
          suggest: rows.reduce((a, r) => a + r.suggest, 0),
          doneN: done.reduce((a, r) => a + r.n, 0),
          win: done.length ? done.reduce((a, r) => a + (r.win || 0), 0) : null,
        };
      });
  }, [baseSkus, year, winMap, currentMonth]);

  const noEvalCount = useMemo(() => baseSkus.filter((s) => !s.eval_month).length, [baseSkus]);

  // Kỳ đánh giá = các tháng đánh giá đã đến hạn. Tháng chưa đến hạn không vào mục tiêu lẫn mẫu số.
  // n = SKU đến hạn · doneN = SKU đã có kết quả (team đã điền) · pendingN = đến hạn nhưng chưa điền (khác với "không WIN")
  const evalYear = useMemo(() => {
    const due = evals.filter((e) => e.due);
    const n = due.reduce((a, b) => a + b.n, 0);
    const doneN = due.reduce((a, b) => a + b.doneN, 0);
    const win = due.reduce((a, b) => a + (b.win || 0), 0);
    const notDueN = evals.filter((e) => !e.due).reduce((a, b) => a + b.n, 0);
    return { n, doneN, win, pendingN: n - doneN, notDueN };
  }, [evals]);

  // Một bảng chung theo tháng: phần Listing (SKU listing tháng đó) + phần Đánh giá (SKU đến hạn đánh giá tháng đó).
  // Dòng phôi = hợp các phôi của hai phần; phần nào không có phôi đó thì để trống. Tháng trống liền nhau gộp một dòng.
  const mergedRows = useMemo(() => {
    type L = (typeof listing)[number];
    type E = (typeof evals)[number];
    type Row = { kind: "month"; month: string; l?: L; e?: E; phoi: string[] } | { kind: "empty"; from: number; to: number };
    const maxM = Math.max(lastMonth, ...listing.map((b) => monthNum(b.month)), ...evals.map((e) => monthNum(e.month)));
    const out: Row[] = [];
    for (let m = 1; m <= maxM; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const l = listing.find((b) => b.month === key && b.n);
      const e = evals.find((x) => x.month === key);
      const last = out[out.length - 1];
      if (!l && !e) {
        if (last?.kind === "empty" && last.to === m - 1) last.to = m;
        else out.push({ kind: "empty", from: m, to: m });
        continue;
      }
      const phoi = Array.from(new Set([...(l?.rows.map((r) => r.phoi) || []), ...(e?.rows.map((r) => r.phoi) || [])]));
      out.push({ kind: "month", month: key, l, e, phoi });
    }
    return out;
  }, [listing, evals, lastMonth, year]);

  const statusParts = useMemo(() => {
    const c = { win: 0, test: 0, loss: 0 };
    for (const s of baseSkus) c[statusKind(s.status)] += 1;
    return [
      { label: "WIN", n: c.win, color: C_GOOD },
      { label: "Đang test", n: c.test, color: C_TEST },
      { label: "Dừng", n: c.loss, color: "#cbd5e1" },
    ];
  }, [baseSkus]);

  const listingYear = useMemo(
    () => ({
      n: listing.reduce((a, b) => a + b.n, 0),
      von: listing.reduce((a, b) => a + b.von, 0),
      hoanVon: listing.reduce((a, b) => a + b.hoanVon, 0),
    }),
    [listing]
  );

  // ===== SKU TESTING: dòng tổng =====
  const totals = useMemo(() => {
    let von = 0, revenue = 0, quantity = 0, basecost = 0, ads = 0, profit = 0, hoanVon = 0, qtyDi = 0;
    for (const s of skus) {
      const d = derive(s);
      von += s.von_hang;
      revenue += s.revenue;
      quantity += s.quantity;
      basecost += d.basecost;
      ads += s.ads_fee;
      profit += s.profit;
      hoanVon += d.hoanVon;
      qtyDi += s.qty_di;
    }
    const byMonth = new Map<string, { cell: MonthCell; cost: number }>();
    for (const { month } of months) {
      const cell = { revenue: 0, quantity: 0, ads_fee: 0, profit: 0 };
      let cost = 0;
      for (const s of skus) {
        const c = s.months[month];
        if (!c) continue;
        cell.revenue += c.revenue;
        cell.quantity += c.quantity;
        cell.ads_fee += c.ads_fee;
        cell.profit += c.profit;
        cost += c.quantity * (s.unit_cost || 0);
      }
      byMonth.set(month, { cell, cost });
    }
    return { von, revenue, quantity, basecost, ads, profit, hoanVon, qtyDi, byMonth };
  }, [skus, months]);

  const monthMetrics = metric === "all" ? METRICS : METRICS.filter((m) => m.key === metric);
  const totalMetric = (month: string, mt: Metric) => {
    const t = totals.byMonth.get(month);
    if (!t) return null;
    if (mt === "roi") return ratio(t.cell.profit, t.cost);
    return cellMetric(t.cell, mt, null);
  };

  const years = useMemo(() => {
    const list = [];
    for (let y = currentYear; y >= 2024; y--) list.push(y);
    return list;
  }, [currentYear]);

  const selectCls = "h-8 cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:outline-hidden";

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-auto p-2 font-sans">
      {/* TOOLBAR */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <div className="flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs">
          <StorefrontIcon size={15} weight="bold" className="mr-1.5 shrink-0 text-slate-500" />
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

        <select id="kqkd-year-select" aria-label="Năm listing" value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectCls}>
          {years.map((y) => (
            <option key={y} value={y}>
              Listing {y}
            </option>
          ))}
        </select>

        <div className="flex h-8 overflow-hidden rounded-lg border border-slate-300 bg-white">
          {(
            [
              { key: "overview", label: "Tổng quan tháng" },
              { key: "skus", label: "SKU Testing" },
            ] as const
          ).map((o, i) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={mode === o.key}
              onClick={() => handleMode(o.key)}
              className={`cursor-pointer px-3 text-xs font-semibold transition-colors ${i > 0 ? "border-l border-slate-300" : ""} ${
                mode === o.key ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {mode === "overview" && allSkus.length > 0 && (
          <select id="kqkd-phoi" aria-label="Tên Phôi" value={fPhoi} onChange={(e) => setFPhoi(e.target.value)} className={selectCls}>
            <option value="">Tất cả phôi</option>
            {phoiOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        {mode === "skus" && allSkus.length > 0 && (
          <>
            <div className="relative w-44 transition-all duration-200 focus-within:w-56">
              <MagnifyingGlassIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="kqkd-search"
                type="text"
                placeholder="Tìm SKU, ASIN, phôi..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-hidden focus:border-blue-500"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Xoá tìm kiếm">
                  <XIcon size={10} />
                </button>
              )}
            </div>
            <select id="kqkd-status" aria-label="Trạng thái" value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
              <option value="">Mọi trạng thái</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select id="kqkd-metric" aria-label="Chỉ số theo tháng" value={metric} onChange={(e) => setMetric(e.target.value as Metric | "all")} className={selectCls}>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  Theo tháng: {m.label}
                </option>
              ))}
              <option value="all">Theo tháng: tất cả chỉ số</option>
            </select>
          </>
        )}

        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading || !selectedStoreId}
          className="ml-auto flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowClockwiseIcon size={14} className={loading ? "animate-spin text-amber-600" : "text-slate-600"} />
          <span>Làm mới</span>
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}

      <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xs">
        <AccountingTopProgressBar loading={loading} variant="indigo" />

        {!loading && data && allSkus.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-10 text-sm text-slate-500">Không có SKU listing năm {year}</div>
        )}

        {/* TỔNG QUAN THÁNG */}
        {mode === "overview" && allSkus.length > 0 && (
          <div className="flex-1 overflow-auto bg-slate-50/60">
            <div className="grid grid-cols-2 gap-3 p-3 pb-0 md:grid-cols-3 xl:grid-cols-5">
              <Kpi label="Số lượng SKU" value={fmtInt(listingYear.n)} sub={`Listing ${year}`} />
              <Kpi
                label="Tổng vốn test"
                value={usd0.format(listingYear.von)}
                sub={`Hoàn vốn ${fmtPct(ratio(listingYear.hoanVon, listingYear.von)) || "0%"}`}
              />
              <Kpi
                label="Mục tiêu SKU WIN"
                value={evalYear.n ? `${Math.ceil(evalYear.n * WIN_TARGET_RATE - 1e-9)} SKU` : "—"}
                sub={`≥${Math.round(WIN_TARGET_RATE * 100)}% trên ${evalYear.n} SKU`}
              />
              <Kpi
                label="SKU WIN (KQ thực tế)"
                value={evalYear.doneN ? `${fmtInt(evalYear.win)}/${fmtInt(evalYear.doneN)}` : "—"}
                sub={evalYear.pendingN ? `${evalYear.pendingN} SKU chưa điền` : "Đã đánh giá"}
              />
              {(() => {
                const r = ratio(evalYear.win, evalYear.doneN);
                const diff = r != null ? (r - WIN_TARGET_RATE) * 100 : null;
                return (
                  <Kpi
                    label="Tỉ lệ WIN"
                    value={r != null ? fmtPct(r) : "—"}
                    sub={
                      diff != null
                        ? `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} điểm % so với mục tiêu`
                        : undefined
                    }
                    highlight={r != null && r >= WIN_TARGET_RATE}
                  />
                );
              })()}
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[2fr_1fr]">
              <WinChart
                items={MONTHS_12.map((m) => {
                  const e = evals.find((x) => monthNum(x.month) === m);
                  if (!e) return { month: m, target: null, win: null, rate: null, tip: `Tháng ${m}: không có SKU đánh giá` };
                  if (!e.due) return { month: m, target: null, win: null, rate: null, note: "chưa đến hạn", tip: `Tháng ${m}: ${e.n} SKU, chưa đến hạn đánh giá` };
                  const target = e.n * WIN_TARGET_RATE;
                  if (e.win != null) {
                    const r = ratio(e.win, e.doneN);
                    return {
                      month: m,
                      target,
                      win: e.win,
                      rate: r,
                      tip: `Tháng ${m}: ${e.win}/${e.doneN} SKU WIN / SKU đã đánh giá = ${fmtPct(r)} · mục tiêu ${fmtTarget(target)} (${Math.round(WIN_TARGET_RATE * 100)}% × ${e.n})${e.doneN < e.n ? ` · ${e.n - e.doneN} SKU chưa điền` : ""}`,
                    };
                  }
                  return {
                    month: m,
                    target,
                    win: null,
                    rate: null,
                    note: undefined,
                    tip: `Tháng ${m}: ${e.n} SKU đến hạn, chưa điền kết quả · mục tiêu ${fmtTarget(target)}`,
                  };
                })}
              />
              <StatusDonut parts={statusParts} />
            </div>

            <section className="mx-3 mb-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between px-3 py-2">
                <h3 className="text-[13px] font-bold text-slate-800">Theo tháng</h3>
                <button
                  type="button"
                  onClick={() =>
                    setOpenMonths((prev) =>
                      prev.size ? new Set() : new Set(mergedRows.flatMap((r) => (r.kind === "month" ? [r.month] : [])))
                    )
                  }
                  className="cursor-pointer rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {openMonths.size ? "Thu gọn" : "Xem theo phôi"}
                </button>
              </div>
              <table className="w-full border-collapse text-[13px] [&_td]:py-2.5 [&_td]:!text-[13px]">
                <thead>
                  <tr>
                    <th rowSpan={2} className={`${TH} text-left align-bottom !text-slate-700`}>Tháng</th>
                    <th rowSpan={2} className={`${TH} text-left align-bottom !text-slate-700`}>Tên Phôi</th>
                    <th colSpan={3} className={`${TH_BASE} ${SEP} text-center bg-blue-100 !text-blue-800`}>R&amp;D Testing</th>
                    <th colSpan={4} className={`${TH_BASE} ${SEP} text-center bg-emerald-100 !text-emerald-800`}>Đánh giá SKU WIN</th>
                  </tr>
                  <tr>
                    <th className={`${TH_BASE} ${SEP} text-right bg-blue-50 !text-blue-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>Vốn test</th>
                    <th className={`${TH_BASE} text-right bg-blue-50 !text-blue-900`}>% Hoàn vốn</th>
                    <th className={`${TH_BASE} ${SEP} text-right bg-emerald-50 !text-emerald-900`}>Số SKU</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>Mục tiêu</th>
                    <th className={`${TH_BASE} text-right bg-emerald-50 !text-emerald-900`}>WIN thực tế</th>
                    <th className={`${TH_BASE} text-center bg-emerald-50 !text-emerald-900`}>Tỉ lệ WIN</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-emerald-50/70 [&>td]:font-bold">
                    <td className={`${TDL} font-semibold`}>Tổng</td>
                    <td className={TDL} />
                    <td className={`${TD} ${SEP} font-semibold`}>{listingYear.n}</td>
                    <td className={`${TD} font-semibold`}>{fmtUsd(listingYear.von)}</td>
                    <td className={`${TD} font-semibold`}>
                      <PctBar v={ratio(listingYear.hoanVon, listingYear.von)} />
                    </td>
                    <td className={`${TD} ${SEP} font-semibold`} title="SKU thuộc các tháng đánh giá đã đến hạn">
                      {evalYear.n || ""}
                    </td>
                    <td className={`${TD} font-semibold`}>{evalYear.n ? fmtTarget(evalYear.n * WIN_TARGET_RATE) : ""}</td>
                    <td className={`${TD} font-semibold`} title="SKU WIN / SKU đã đánh giá">
                      {evalYear.doneN ? `${evalYear.win}/${evalYear.doneN}` : ""}
                    </td>
                    <td className={`${TD} text-center font-semibold`}>
                      <RatePill v={ratio(evalYear.win, evalYear.doneN)} />
                    </td>
                  </tr>
                  {mergedRows.map((row) => {
                    if (row.kind === "empty")
                      return (
                        <tr key={`e${row.from}`}>
                          <td className={`${TDL} pl-8 !text-slate-500`}>T{row.from === row.to ? row.from : `${row.from}–T${row.to}`}</td>
                          <td colSpan={8} className={`${TDL} italic !text-slate-500`}>
                            —
                          </td>
                        </tr>
                      );
                    const { l, e } = row;
                    const rate = e && e.win != null ? ratio(e.win, e.doneN) : null;
                    const open = openMonths.has(row.month);
                    return (
                      <Fragment key={row.month}>
                        <tr className={`cursor-pointer hover:bg-slate-50 ${open ? MONTH_ROW : ""}`} onClick={() => toggleMonth(row.month)}>
                          <td className={`${TDL} font-semibold`}>
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <CaretDownIcon size={12} className="text-slate-500" /> : <CaretRightIcon size={12} className="text-slate-400" />}
                              T{monthNum(row.month)}
                            </span>
                          </td>
                          <td className={`${TDL} !text-slate-700`}>
                            Tất cả
                          </td>
                          <td className={`${TD} ${SEP}`}>{l ? l.n : DASH}</td>
                          <td className={TD}>{l ? fmtUsd(l.von) : DASH}</td>
                          <td className={TD}>{l ? <PctBar v={ratio(l.hoanVon, l.von)} /> : DASH}</td>
                          <td className={`${TD} ${SEP} ${e && !e.due ? "!text-slate-400" : ""}`}>{e ? e.n : DASH}</td>
                          <td className={`${TD} ${e && !e.due ? "!text-slate-400" : ""}`}>{e ? fmtTarget(e.n * WIN_TARGET_RATE) : DASH}</td>
                          <td className={TD} title={e && e.win != null ? "SKU WIN / SKU đã đánh giá" : undefined}>
                            {!e ? DASH : !e.due ? (
                              <span className="text-[11px] text-slate-400">chưa đến hạn</span>
                            ) : e.win != null ? (
                              <>
                                {e.win}/{e.doneN}
                              </>
                            ) : (
                              <span className="text-[11px] font-semibold text-amber-700">chưa điền</span>
                            )}
                          </td>
                          <td className={`${TD} text-center`}>
                            {rate != null ? <RatePill v={rate} /> : e ? "" : DASH}
                          </td>
                        </tr>
                        {open &&
                          row.phoi.map((phoi) => {
                            const lr = l?.rows.find((r) => r.phoi === phoi);
                            const er = e?.rows.find((r) => r.phoi === phoi);
                            return (
                              <tr key={phoi} className="bg-slate-50/40">
                                <td className={TDL} />
                                <td className={`${TDL} !text-slate-700`}>{phoi}</td>
                                <td className={`${TD} ${SEP}`}>{lr ? lr.n : DASH}</td>
                                <td className={TD}>{lr ? fmtUsd(lr.von) : DASH}</td>
                                <td className={TD}>{lr ? <PctBar v={ratio(lr.hoanVon, lr.von)} /> : DASH}</td>
                                <td className={`${TD} ${SEP}`}>{er ? er.n : DASH}</td>
                                <td className={TD}>{er ? fmtTarget(er.n * WIN_TARGET_RATE) : DASH}</td>
                                <td className={`${TD} py-1`}>
                                  {!er && DASH}
                                  {er && e && (
                                    <WinInput
                                      key={`${e.month}|${phoi}|${er.win ?? ""}`}
                                      value={er.win}
                                      max={er.n}
                                      suggest={er.suggest}
                                      disabled={!canEdit || !e.due}
                                      saving={savingWin === `${e.month}|${phoi}`}
                                      onCommit={(v) => saveWin(e.month, phoi, v)}
                                    />
                                  )}
                                </td>
                                <td className={`${TD} text-center`}>
                                  {er ? <RatePill v={er.win != null ? ratio(er.win, er.n) : null} /> : DASH}
                                </td>
                              </tr>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {noEvalCount > 0 && <p className="px-3 py-2 text-[11px] text-slate-600">{noEvalCount} SKU chưa có tháng đánh giá</p>}
            </section>
          </div>
        )}

        {/* SKU TESTING */}
        {mode === "skus" && allSkus.length > 0 && (
          <div className="flex-1 overflow-auto scrollbar-thin">
            <table className="min-w-max border-collapse text-xs">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th colSpan={7} className={`${TH} text-left !text-slate-700`}>Thông tin cơ bản</th>
                  <th colSpan={12} className={`${TH} ${SEP} text-left !text-slate-700`}>Life time</th>
                  {months.map((m) => (
                    <th
                      key={m.month}
                      colSpan={monthMetrics.length}
                      className={`${TH} ${SEP} text-left !text-slate-700`}
                      title={m.source === "closed" ? "Số đã chốt sổ tháng" : "Tính từ dữ liệu ngày (chưa chốt sổ)"}
                    >
                      {monthLabel(m.month)}
                      {m.month >= currentMonth && <span className="ml-1 font-normal text-slate-400">tạm tính</span>}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className={`${TH} sticky left-0 z-30 text-left`}>SKU</th>
                  <th className={`${TH} text-left`}>Profit theo tháng</th>
                  <th className={`${TH} text-left`}>Product Type</th>
                  <th className={`${TH} text-left`}>Trạng thái</th>
                  <th className={`${TH} text-left`}>PIC Idea</th>
                  <th className={`${TH} text-right`}>Tháng listing</th>
                  <th className={`${TH} text-right`}>Tháng đánh giá</th>
                  <th className={`${TH} ${SEP} text-right`}>Tổng vốn hàng</th>
                  <th className={`${TH} text-right`}>Revenue</th>
                  <th className={`${TH} text-right`}>Quantity</th>
                  <th className={`${TH} text-right`}>Basecost</th>
                  <th className={`${TH} text-right`}>Ads Fee</th>
                  <th className={`${TH} text-right`}>TAcos</th>
                  <th className={`${TH} text-right !text-slate-800`}>Profit</th>
                  <th className={`${TH} text-right`}>ROI</th>
                  <th className={`${TH} text-right`}>Hoàn vốn</th>
                  <th className={`${TH} text-right`}>% Hoàn vốn</th>
                  <th className={`${TH} text-right`}>Số lượng đi hàng</th>
                  <th className={`${TH} text-right`}>Tồn</th>
                  {months.map((m) =>
                    monthMetrics.map((mt, j) => (
                      <th key={`${m.month}-${mt.key}`} className={`${TH} text-right ${j === 0 ? SEP : ""} `}>
                        {mt.label}
                      </th>
                    ))
                  )}
                </tr>
                <tr className={TOTAL_ROW}>
                  <td className={`${TDL} font-semibold sticky left-0 z-30 bg-slate-100`}>Tổng {skus.length} SKU</td>
                  <td className={`${TDL} font-semibold`}>
                    <ProfitSpark values={months.map((m) => ({ label: monthLabel(m.month), v: totals.byMonth.get(m.month)?.cell.profit ?? null }))} />
                  </td>
                  <td colSpan={5} className={`${TDL} font-semibold`} />
                  <td className={`${TD} ${SEP} font-semibold`}>{fmtUsd(totals.von)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.revenue)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.quantity)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.basecost)}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.ads)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(-totals.ads, totals.revenue))}</td>
                  <td className={`${TD} font-semibold ${signClass(totals.profit)}`}>{fmtUsd(totals.profit)}</td>
                  <td className={`${TD} font-semibold`}>{fmtPct(ratio(totals.profit, totals.basecost))}</td>
                  <td className={`${TD} font-semibold`}>{fmtUsd(totals.hoanVon)}</td>
                  <td className={`${TD} font-semibold`}><PctBar v={ratio(totals.hoanVon, totals.von)} /></td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.qtyDi)}</td>
                  <td className={`${TD} font-semibold`}>{fmtInt(totals.qtyDi - totals.quantity)}</td>
                  {months.map((m) =>
                    monthMetrics.map((mt, j) => {
                      const v = totalMetric(m.month, mt.key);
                      return (
                        <td key={`${m.month}-${mt.key}`} className={`${TD} ${j === 0 ? SEP : ""} font-semibold ${mt.key === "profit" ? signClass(v) : ""}`}>
                          {fmtMetric(v, mt.key)}
                        </td>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {skus.map((s) => {
                  const d = derive(s);
                  const thumb = getOptimizedThumbnailUrl(s.mockup_url, 64);
                  return (
                    <tr key={s.sku} className="group hover:bg-slate-50">
                      <td className={`${TDL} sticky left-0 z-10 bg-white shadow-[1px_0_0_#e2e8f0] group-hover:bg-slate-50`}>
                        <span className="flex items-center gap-2">
                          {thumb ? (
                            <img src={thumb} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded border border-slate-200 object-cover" />
                          ) : (
                            <span className="h-7 w-7 shrink-0 rounded border border-dashed border-slate-200" />
                          )}
                          <span className="font-mono text-[11.5px] font-bold text-slate-900">{s.sku}</span>
                        </span>
                      </td>
                      <td className={TDL}>
                        <ProfitSpark values={months.map((m) => ({ label: monthLabel(m.month), v: s.months[m.month]?.profit ?? null }))} />
                      </td>
                      <td className={`${TDL} max-w-[170px] truncate`} title={s.product_type || ""}>
                        {s.product_type}
                      </td>
                      <td className={TDL}>
                        <StatusPill status={s.status} />
                      </td>
                      <td className={TDL}>{s.pic_idea}</td>
                      <td className={TD}>{monthLabel(s.listing_month)}</td>
                      <td className={TD}>{s.eval_month ? monthLabel(s.eval_month) : ""}</td>
                      <td className={`${TD} ${SEP}`}>{fmtUsd(s.von_hang)}</td>
                      <td className={TD}>{fmtUsd(s.revenue)}</td>
                      <td className={TD}>{fmtInt(s.quantity)}</td>
                      <td className={TD}>{fmtUsd(d.basecost)}</td>
                      <td className={TD}>{fmtUsd(s.ads_fee)}</td>
                      <td className={TD}>{fmtPct(d.tacos)}</td>
                      <td className={`${TD} font-semibold ${signClass(s.profit)}`}>{fmtUsd(s.profit)}</td>
                      <td className={TD}>{fmtPct(d.roi)}</td>
                      <td className={TD}>{fmtUsd(d.hoanVon)}</td>
                      <td className={TD}>
                        <PctBar v={d.hoanVonPct} />
                      </td>
                      <td className={TD}>{fmtInt(s.qty_di)}</td>
                      <td
                        className={`${TD} ${d.ton < 0 ? "!text-red-600" : ""}`}
                        title={d.ton < 0 ? "Bán nhiều hơn số đi hàng — thiếu lô đi hàng trong Bảng nhập?" : undefined}
                      >
                        {fmtInt(d.ton)}
                      </td>
                      {months.map((m) => {
                        const before = m.month < s.listing_month;
                        return monthMetrics.map((mt, j) => {
                          const v = cellMetric(s.months[m.month], mt.key, s.unit_cost);
                          return (
                            <td
                              key={`${m.month}-${mt.key}`}
                              className={`${TD} ${j === 0 ? SEP : ""} ${before ? "bg-slate-50" : ""} ${mt.key === "profit" ? signClass(v) : ""}`}
                            >
                              {fmtMetric(v, mt.key)}
                            </td>
                          );
                        });
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
