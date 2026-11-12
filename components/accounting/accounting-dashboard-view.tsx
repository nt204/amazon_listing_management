"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowClockwiseIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BankIcon,
  CaretDownIcon,
  ChartPieSliceIcon,
  CoinsIcon,
  CurrencyDollarIcon,
  CaretRightIcon,
  CheckIcon,
  MegaphoneIcon,
  PercentIcon,
  ShoppingBagIcon,
  StorefrontIcon,
  TargetIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { Store } from "@/lib/accounting/types";
import type {
  AccountingDashboardData,
  DashboardSeriesPoint,
  DashboardStoreRow,
  DashboardTotals,
  DashboardSkuGroup,
  DashboardSkuGroupData,
} from "@/lib/accounting/dashboard-db";
import {
  dashboardChartGranularity,
  dashboardCompareMode,
  dashboardPresetRange,
  dashboardRangeUnit,
  previousMonthRange,
  resolveDashboardPeriods,
  type DashboardChartGranularity,
  type DashboardPeriodUnit,
} from "@/lib/accounting/dashboard-periods";
import { summarizeRange, type DashboardDay, type DashboardTotals as Totals } from "@/lib/accounting/dashboard-totals";
import { listTeams, parseStoreTeams, storeCanView, storeHasTeam } from "@/lib/accounting/store-teams";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";
import { getAmazonLatestAvailableDate, getThisMonthDateRange } from "./financials-date-utils";
import { TopSellingProducts } from "./top-selling-products";

const STORE_IDS_KEY = "acc_dashboard_store_ids";
// v3: chỉ giữ các kiểu so sánh có ý nghĩa ở mọi cấp độ ngày / tuần / tháng.
// v4: lưu kiểu so sánh "prev" (kỳ trước) | "yoy" (cùng kỳ năm trước) | "none"
const COMPARE_KEY = "acc_dashboard_compare_v4";

const STORE_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6", "#6366f1"];

const SERIES = [
  { key: "revenue", label: "Revenue", color: "#3b82f6" },
  { key: "profit", label: "Profit", color: "#22c55e" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

// Chuỗi có thể âm: phần dưới $0 tô đỏ để nhận ra ngày lỗ ngay.
const SIGNED_SERIES = new Set<SeriesKey>(["profit"]);
const NEGATIVE_COLOR = "#ef4444";

/** Vị trí $0 (0–1 từ trên xuống) trong bounding box của nét và vùng tô, cho gradient tách màu. */
function zeroSplit(values: number[]) {
  const dMax = Math.max(...values);
  const dMin = Math.min(...values);
  const fMax = Math.max(dMax, 0);
  const fMin = Math.min(dMin, 0);
  return {
    flat: dMax === dMin,
    stroke: dMax <= 0 ? 0 : dMin >= 0 ? 1 : dMax / (dMax - dMin),
    fill: fMax - fMin > 0 ? fMax / (fMax - fMin) : 1,
  };
}

function signedDot(key: SeriesKey, color: string, active: boolean) {
  const DotShape = (props: { cx?: number; cy?: number; index?: number; payload?: DashboardSeriesPoint }) => {
    if (props.cx == null || props.cy == null) return <g key={props.index} />;
    const c = SIGNED_SERIES.has(key) && (props.payload?.[key] ?? 0) < 0 ? NEGATIVE_COLOR : color;
    return active ? (
      <circle key={props.index} cx={props.cx} cy={props.cy} r={5.5} fill={c} stroke="#fff" strokeWidth={2} />
    ) : (
      <circle key={props.index} cx={props.cx} cy={props.cy} r={3.5} fill="#fff" stroke={c} strokeWidth={2} />
    );
  };
  return DotShape;
}

// ---------- format ----------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function money(v: number): string {
  return usd.format(Math.round(v) || 0);
}

function compactMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** Tỷ lệ chỉ có nghĩa khi mẫu số > 0; ngược lại hiển thị "—". */
function ratioOrDash(v: number, base: number): string {
  return base > 0 ? pct(v) : "—";
}

// Định dạng ngày kiểu Việt: 1/10, 1/10/2026, T10
function shortDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}`;
}

function longDate(d: string): string {
  return `${shortDate(d)}/${d.slice(0, 4)}`;
}

function monthLabel(key: string, withYear: boolean): string {
  const [y, m] = key.split("-");
  return withYear ? `T${Number(m)}/${y}` : `T${Number(m)}`;
}

function changeRatio(cur: number, prev: number | undefined): number | null {
  if (prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

// ---------- animation ----------

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useCountUp(target: number, duration = 600): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const currentRef = useRef(0);

  useEffect(() => {
    const from = currentRef.current;
    const t0 = performance.now();
    const total = reduced ? 0 : duration;
    let raf = 0;
    const tick = (now: number) => {
      const p = total > 0 ? Math.min(1, (now - t0) / total) : 1;
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      currentRef.current = next;
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return value;
}

/** true sau frame đầu tiên — để thanh tỷ lệ chạy từ 0 và biểu đồ vẽ sau khi KPI đã hiện. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return mounted;
}

/** Độ rộng thực của phần tử (ResizeObserver) — dùng để thưa nhãn biểu đồ trên màn hẹp. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const animated = useCountUp(value);
  return <>{format(animated)}</>;
}

// ---------- small UI ----------

function Card({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <div
      className={`acc-rise rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// Quy ước màu: tăng = xanh, giảm = đỏ (kể cả chi phí)
function DeltaPill({ ratio }: { ratio: number | null }) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return <span className="text-[15px] font-medium text-slate-400">—</span>;
  }
  const up = ratio >= 0;
  const abs = Math.abs(ratio * 100).toFixed(1);
  return (
    <span
      title="vs. comparison period"
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
      }`}
    >
      {/* Mũi tên + màu đã thể hiện tăng / giảm nên không thêm dấu +/− */}
      {up ? <ArrowUpRightIcon size={12} weight="bold" /> : <ArrowDownRightIcon size={12} weight="bold" />}
      {abs}%
    </span>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handle = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", handle);
    return () => window.removeEventListener("pointerdown", handle);
  }, [ref, open, onClose]);
}

function DropdownShell({
  label,
  icon,
  open,
  setOpen,
  children,
  widthClass = "w-56",
  variant = "default",
  align = "right",
  className = "",
  active = false,
}: {
  label: string;
  icon?: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: React.ReactNode;
  widthClass?: string;
  variant?: "default" | "chip";
  align?: "left" | "right";
  className?: string;
  /** Chip đang bật (vd đang so sánh): tô tím nhạt. */
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useClickOutside(ref, open, close);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex cursor-pointer items-center justify-between gap-2 border text-[13px] font-semibold transition-colors ${
          active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"
        } ${
          variant === "chip" ? "rounded-full px-3 py-1" : "w-full min-w-0 rounded-xl px-3 py-2 shadow-2xs @min-[640px]:min-w-[150px]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <CaretDownIcon size={13} weight="bold" className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`absolute z-40 mt-1.5 rounded-xl ${align === "left" ? "left-0 origin-top-left" : "right-0 origin-top-right"} border border-slate-200 bg-white p-1 shadow-xl transition-all duration-150 ${widthClass} ${
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
        active ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {active && <CheckIcon size={13} weight="bold" className="shrink-0 text-indigo-600" />}
    </button>
  );
}

// ---------- KPI ----------

interface KpiDef {
  id: string;
  label: string;
  accent: KpiAccent;
  icon: Icon;
  value: number;
  format: (v: number) => string;
  ratio: number | null;
  negativeRed?: boolean;
}

// Mỗi chỉ số 1 màu nhấn nhẹ: chỉ tô ô icon, thẻ giữ nền trắng cho dễ đọc số.
const ACCENTS = {
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  indigo: "bg-indigo-50 text-indigo-600 ring-indigo-100",
  rose: "bg-rose-50 text-rose-600 ring-rose-100",
  sky: "bg-sky-50 text-sky-600 ring-sky-100",
  amber: "bg-amber-50 text-amber-600 ring-amber-100",
  cyan: "bg-cyan-50 text-cyan-600 ring-cyan-100",
  teal: "bg-teal-50 text-teal-600 ring-teal-100",
};
type KpiAccent = keyof typeof ACCENTS;

function KpiCard({
  kpi,
  delay,
  showDelta,
  compareLabel,
}: {
  kpi: KpiDef;
  delay: number;
  showDelta: boolean;
  compareLabel: string;
}) {
  const KpiIcon = kpi.icon;
  const formatted = kpi.format(kpi.value);
  // Tự động thu nhỏ cỡ chữ linh hoạt khi số dài (hàng triệu, trăm nghìn) để không bị che số / cắt '...'
  const isLargeNumber = formatted.length >= 10;
  const isMediumNumber = formatted.length >= 8;
  const sizeClasses = isLargeNumber
    ? "text-[16px] @min-[160px]:text-[18px] @min-[200px]:text-[21px]"
    : isMediumNumber
    ? "text-[18px] @min-[160px]:text-[20px] @min-[200px]:text-[23px]"
    : "text-[21px] @min-[160px]:text-[23px] @min-[190px]:text-[25px]";

  return (
    <Card
      delay={delay}
      className="@container group p-3 transition-[box-shadow,border-color] duration-300 hover:border-slate-300/80 hover:shadow-md @min-[190px]:p-3.5"
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span
            title={kpi.label}
            className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 @min-[180px]:text-[11.5px]"
          >
            {kpi.label}
          </span>
          <span
            className={`hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset @min-[140px]:flex @min-[180px]:h-7 @min-[180px]:w-7 ${ACCENTS[kpi.accent]}`}
          >
            <KpiIcon size={14} weight="bold" />
          </span>
        </div>
        <div
          title={formatted}
          className={`mt-1.5 truncate font-bold leading-tight tracking-tight tabular-nums ${sizeClasses} ${
            kpi.negativeRed && kpi.value < 0 ? "text-rose-600" : "text-slate-900"
          }`}
        >
          <AnimatedNumber value={kpi.value} format={kpi.format} />
        </div>
        {showDelta && (
          <div className="mt-2 flex min-w-0 items-center gap-1.5">
            <DeltaPill ratio={kpi.ratio} />
            {compareLabel && <span className="truncate text-[11px] text-slate-400">{compareLabel}</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- trend chart ----------

type ChartPoint = DashboardSeriesPoint & Partial<Record<`cmp_${SeriesKey}`, number>>;
type ChartGranularity = DashboardChartGranularity;

/** So sánh với: kỳ trước hoặc cùng kỳ năm trước; null = không so sánh. */
type CompareBase = "prev" | "yoy";

/** Đơn vị của khoảng ngày đã chọn: quyết định kỳ so sánh. */
type PeriodUnit = DashboardPeriodUnit;

const PREV_PERIOD_LABELS: Record<PeriodUnit, string> = {
  day: "Hôm qua",
  week: "Tuần trước",
  month: "Tháng trước",
  year: "Năm trước",
};

/** Tên kỳ so sánh: kỳ liền trước theo đơn vị (Hôm qua / Tuần trước / Tháng trước / Năm trước) hoặc Năm trước. */
function compareLabel(base: CompareBase, unit: PeriodUnit): string {
  return base === "yoy" ? "Năm trước" : PREV_PERIOD_LABELS[unit];
}

const compareModeFor = dashboardCompareMode;

/** Đặt trong biểu đồ nhưng điều khiển chung cho KPI, biểu đồ và P&L: so với kỳ nào. */
function PeriodControls({
  compareUnit,
  compareBase,
  onCompareBaseChange,
  comparePreview = {},
}: {
  /** Cách gộp biểu đồ (tự suy ra từ khoảng ngày, không có nút chọn). */
  granularity: ChartGranularity;
  /** Đơn vị của khoảng ngày đã chọn → tên kỳ so sánh (Tuần trước / Tháng trước…). */
  compareUnit: PeriodUnit;
  compareBase: CompareBase | null;
  onCompareBaseChange: (base: CompareBase | null) => void;
  /** Khoảng ngày cụ thể của từng lựa chọn so sánh, vd { prev: "1/9 – 25/9", yoy: "1/10 – 25/10/2025" }. */
  comparePreview?: Partial<Record<CompareBase, string>>;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <DropdownShell
        label={compareBase ? `vs ${compareLabel(compareBase, compareUnit)}` : "So sánh"}
        open={compareOpen}
        setOpen={setCompareOpen}
        widthClass="w-60"
        variant="chip"
        align="right"
        active={Boolean(compareBase)}
      >
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-slate-400">So sánh với</div>
        {/* Chọn năm: kỳ liền trước chính là năm trước → chỉ 1 lựa chọn */}
        {(compareUnit === "year" ? (["prev"] as const) : (["prev", "yoy"] as const)).map((base) => {
          const selected = compareBase === base || (compareUnit === "year" && compareBase === "yoy");
          return (
          <MenuItem
            key={base}
            active={selected}
            onClick={() => {
              // Bấm lại lựa chọn đang tích = bỏ so sánh
              onCompareBaseChange(selected ? null : base);
              setCompareOpen(false);
            }}
          >
            <span className="flex-1 whitespace-nowrap">{compareLabel(base, compareUnit)}</span>
            {comparePreview[base] && (
              <span className="whitespace-nowrap text-xs font-normal tabular-nums text-slate-400">{comparePreview[base]}</span>
            )}
          </MenuItem>
          );
        })}
      </DropdownShell>
    </div>
  );
}
type AggregatedChartPoint = DashboardSeriesPoint & {
  rangeStart: string;
  rangeEnd: string;
  compareRangeStart?: string;
  compareRangeEnd?: string;
};

/** Tuần Chủ nhật → Thứ 7, khớp bộ chọn ngày (This week / Last week) và lịch Amazon. */
function startOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}

const seriesOf = (key: string, t: Totals): DashboardSeriesPoint => ({
  key,
  revenue: t.revenue,
  profit: t.profit,
  netProfit: t.netProfit,
  adsFee: t.adsFee,
  quantity: t.quantity,
});

/**
 * Theo tháng: mọi tháng từ trendStart (1/1 của năm) đến ngày cuối kỳ; khi so sánh, mỗi tháng so với
 * cùng đoạn lùi monthsBack tháng (1 = tháng trước, 12 = cùng tháng năm trước; 0 = không so sánh).
 */
function monthBuckets(days: DashboardDay[], trendStart: string, endDate: string, monthsBack: number): AggregatedChartPoint[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const points: AggregatedChartPoint[] = [];
  let [y, m] = trendStart.split("-").map(Number);
  const [endY, endM] = endDate.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${pad(m)}`;
    const monthLast = `${key}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    const rangeStart = `${key}-01` < trendStart ? trendStart : `${key}-01`;
    const rangeEnd = monthLast > endDate ? endDate : monthLast;
    const point: AggregatedChartPoint = {
      ...seriesOf(key, summarizeRange(days, rangeStart, rangeEnd)),
      rangeStart,
      rangeEnd,
      compare: null,
    };
    if (monthsBack > 0) {
      const prev = previousMonthRange(rangeStart, rangeEnd, monthsBack);
      point.compare = seriesOf(prev.startDate.slice(0, 7), summarizeRange(days, prev.startDate, prev.endDate));
      point.compareRangeStart = prev.startDate;
      point.compareRangeEnd = prev.endDate;
    }
    points.push(point);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return points;
}

function aggregateTrend(points: DashboardSeriesPoint[], granularity: ChartGranularity): AggregatedChartPoint[] {
  const groups = new Map<string, AggregatedChartPoint>();
  for (const point of points) {
    const groupKey =
      granularity === "day" ? point.key : granularity === "week" ? startOfWeek(point.key) : point.key.slice(0, 7);
    const existing = groups.get(groupKey);
    const compare = point.compare;
    if (!existing) {
      groups.set(groupKey, {
        key: groupKey,
        rangeStart: point.key,
        rangeEnd: point.key,
        revenue: point.revenue,
        profit: point.profit,
        netProfit: point.netProfit,
        adsFee: point.adsFee,
        quantity: point.quantity,
        compare: compare
          ? {
              key: compare.key,
              revenue: compare.revenue,
              profit: compare.profit,
              netProfit: compare.netProfit,
              adsFee: compare.adsFee,
              quantity: compare.quantity,
            }
          : null,
        compareRangeStart: compare?.key,
        compareRangeEnd: compare?.key,
      });
      continue;
    }

    existing.rangeEnd = point.key;
    existing.revenue += point.revenue;
    existing.profit += point.profit;
    existing.netProfit += point.netProfit;
    existing.adsFee += point.adsFee;
    existing.quantity += point.quantity;
    if (compare) {
      existing.compareRangeEnd = compare.key;
      if (!existing.compare) {
        existing.compare = { ...compare };
        existing.compareRangeStart = compare.key;
      } else {
        existing.compare.revenue += compare.revenue;
        existing.compare.profit += compare.profit;
        existing.compare.netProfit += compare.netProfit;
        existing.compare.adsFee += compare.adsFee;
        existing.compare.quantity += compare.quantity;
      }
    }
  }
  return Array.from(groups.values());
}

/** Nhãn giá trị trên điểm: số dương phía trên, số âm phía dưới (màu đỏ); thưa bớt khi nhiều điểm. */
function valueLabel(key: SeriesKey, color: string, every: number, lastIndex: number) {
  const ValueLabel = (props: { x?: number | string; y?: number | string; value?: unknown; index?: number }) => {
    const index = props.index ?? 0;
    if (props.x == null || props.y == null || typeof props.value !== "number") return null;
    if (index % every !== 0 && index !== lastIndex) return null;
    const negative = props.value < 0;
    return (
      <text
        x={Number(props.x)}
        y={Number(props.y) + (negative ? 17 : -10)}
        textAnchor="middle"
        fontSize={11.5}
        fontWeight={600}
        fill={negative && SIGNED_SERIES.has(key) ? NEGATIVE_COLOR : color}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {compactMoney(props.value)}
      </text>
    );
  };
  return ValueLabel;
}

function TrendChart({
  data,
  previousPeriod,
  controls,
  compareEmpty = false,
  delay,
}: {
  /** Các ô ngày / tuần / tháng đã gộp sẵn. */
  data: AggregatedChartPoint[];
  previousPeriod: { startDate: string; endDate: string } | null;
  controls: React.ComponentProps<typeof PeriodControls>;
  /** Kỳ so sánh hoàn toàn chưa có dữ liệu: không vẽ đường so sánh (tránh hiểu nhầm là $0). */
  compareEmpty?: boolean;
  delay: number;
}) {
  const mode = controls.granularity;
  const mounted = useMounted();
  const [chartBoxRef, chartWidth] = useElementWidth<HTMLDivElement>();
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    revenue: true,
    profit: true,
  });

  const chartData = useMemo<ChartPoint[]>(
    () =>
      data.map((p) =>
        p.compare
          ? {
              ...p,
              cmp_revenue: p.compare.revenue,
              cmp_profit: p.compare.profit,
            }
          : p,
      ),
    [data],
  );
  const hasCompare = !compareEmpty && data.some((p) => p.compare);
  const spansYears = new Set(data.map((p) => p.rangeStart.slice(0, 4))).size > 1;
  const pointMap = useMemo(() => new Map(data.map((p) => [p.key, p])), [data]);
  const splits = useMemo(
    () => ({ profit: zeroSplit(data.map((p) => p.profit)) }),
    [data],
  );
  const formatTick = (key: string) => {
    const point = data.find((item) => item.key === key);
    if (!point) return key;
    if (mode === "day") return shortDate(point.rangeStart);
    if (mode === "month") return monthLabel(point.rangeStart.slice(0, 7), spansYears);
    return point.rangeStart === point.rangeEnd
      ? shortDate(point.rangeStart)
      : `${shortDate(point.rangeStart)} - ${shortDate(point.rangeEnd)}`;
  };
  // ~1 nhãn mỗi 58px chiều ngang để số không chồng nhau trên màn hẹp
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor((chartWidth || 800) / 58))));
  // Theo tháng mỗi điểm có kỳ so sánh riêng nên chỉ ghi tên; ngày / tuần ghi kèm khoảng ngày của kỳ so sánh
  const compareName = controls.compareBase
    ? compareLabel(controls.compareBase, controls.compareUnit)
    : "";
  const compareRangeLabel =
    mode !== "month" && previousPeriod
      ? `${compareName} (${shortDate(previousPeriod.startDate)} – ${shortDate(previousPeriod.endDate)})`
      : compareName;
  const compareEmptyLabel = previousPeriod
    ? `${compareName} (${shortDate(previousPeriod.startDate)} – ${longDate(previousPeriod.endDate)})`
    : compareName;

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Revenue &amp; Profit</h2>
        <PeriodControls {...controls} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">
        {SERIES.map((s) => {
          const on = visible[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
              className={`inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-medium transition-opacity duration-200 ${
                on ? "text-slate-700" : "text-slate-400 opacity-60 hover:opacity-100"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? s.color : "#cbd5e1" }} />
              {s.label}
            </button>
          );
        })}
        {hasCompare ? (
          <span className="acc-rise inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
            <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
            {compareRangeLabel}
          </span>
        ) : compareEmpty ? (
          <span className="acc-rise inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
            <WarningCircleIcon size={13} weight="bold" />
            Chưa có dữ liệu {compareEmptyLabel}
          </span>
        ) : null}
      </div>

      <div ref={chartBoxRef} className="mt-2 h-[260px] w-full @min-[420px]:h-[300px] @min-[900px]:h-auto @min-[900px]:min-h-[300px] @min-[900px]:flex-1">
        {!mounted ? null : data.length === 0 ? (
          <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-200 text-[13px] text-slate-400">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              key={mode}
              data={chartData}
              margin={{ top: 20, right: 12, bottom: 0, left: 0 }}
            >
              <defs>
                {SERIES.map((s) =>
                  SIGNED_SERIES.has(s.key) ? (
                    <g key={s.key}>
                      <linearGradient id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor={s.color} stopOpacity={0.22} />
                        <stop offset={splits.profit.fill} stopColor={s.color} stopOpacity={0.03} />
                        <stop offset={splits.profit.fill} stopColor={NEGATIVE_COLOR} stopOpacity={0.03} />
                        <stop offset={1} stopColor={NEGATIVE_COLOR} stopOpacity={0.2} />
                      </linearGradient>
                      <linearGradient id={`stroke-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={splits.profit.stroke} stopColor={s.color} />
                        <stop offset={splits.profit.stroke} stopColor={NEGATIVE_COLOR} />
                      </linearGradient>
                    </g>
                  ) : (
                    <linearGradient key={s.key} id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.24} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                    </linearGradient>
                  ),
                )}
              </defs>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis
                dataKey="key"
                tickFormatter={formatTick}
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                padding={{ left: 16, right: 16 }}
                dy={6}
              />
              <YAxis
                tickFormatter={compactMoney}
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={chartWidth > 0 && chartWidth < 420 ? 44 : 52}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.25} />
              <Tooltip
                cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                content={({ active, label }) => {
                  const point = active && label != null ? pointMap.get(String(label)) : undefined;
                  if (!point) return null;
                  const cmp = hasCompare ? point.compare : null;
                  const formatRange = (start: string, end: string) => {
                    if (mode === "day" || start === end) return longDate(start);
                    if (mode === "month") return monthLabel(start.slice(0, 7), true);
                    return `${shortDate(start)} - ${longDate(end)}`;
                  };
                  return (
                    <div className="min-w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] shadow-lg">
                      <p className="mb-1.5 font-semibold text-slate-900">
                        {formatRange(point.rangeStart, point.rangeEnd)}
                        {cmp && point.compareRangeStart && point.compareRangeEnd && (
                          <span className="font-normal text-slate-400">
                            {" "}vs {formatRange(point.compareRangeStart, point.compareRangeEnd)}
                          </span>
                        )}
                      </p>
                      {SERIES.map((s) => {
                        const change = cmp ? changeRatio(point[s.key], cmp[s.key]) : null;
                        const good = (change ?? 0) >= 0;
                        return (
                          <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
                            <span className="flex items-center gap-1.5 text-slate-500">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                              {s.label}
                            </span>
                            <span className="flex items-baseline gap-2 tabular-nums">
                              <span className={`font-semibold ${point[s.key] < 0 ? "text-rose-600" : "text-slate-900"}`}>
                                {money(point[s.key])}
                              </span>
                              {cmp && (
                                <>
                                  <span className="text-slate-400">{money(cmp[s.key])}</span>
                                  <span
                                    className={`w-12 text-right text-[10.5px] font-semibold ${
                                      change == null ? "text-slate-300" : good ? "text-emerald-600" : "text-rose-500"
                                    }`}
                                  >
                                    {change == null ? "—" : `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}%`}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {hasCompare &&
                SERIES.filter((s) => visible[s.key]).map((s) => (
                  <Line
                    key={`cmp-${s.key}`}
                    type="monotone"
                    dataKey={`cmp_${s.key}`}
                    stroke={s.color}
                    strokeOpacity={0.5}
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={{ r: 3.5, fill: s.color, stroke: "#fff", strokeWidth: 1.5 }}
                    isAnimationActive
                    animationDuration={650}
                    animationEasing="ease-out"
                  />
                ))}
              {SERIES.filter((s) => visible[s.key]).map((s) => {
                const signed = SIGNED_SERIES.has(s.key);
                // Gradient objectBoundingBox không vẽ được nét phẳng tuyệt đối → dùng màu đơn.
                const flat = signed && splits.profit.flat;
                const stroke = signed && !flat ? `url(#stroke-${s.key})` : flat && data[0]?.[s.key] < 0 ? NEGATIVE_COLOR : s.color;
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={stroke}
                    strokeWidth={2.5}
                    fill={`url(#trend-${s.key})`}
                    dot={data.length <= 31 ? signedDot(s.key, s.color, false) : false}
                    activeDot={signedDot(s.key, s.color, true)}
                    isAnimationActive
                    animationDuration={650}
                    animationEasing="ease-out"
                  >
                    <LabelList dataKey={s.key} content={valueLabel(s.key, s.color, labelEvery, data.length - 1)} />
                  </Area>
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

// ---------- store table ----------

type StoreSortKey = "store" | "revenue" | "profit" | "margin" | "tacos" | "acos" | "units" | "stockUnits" | "stock";

const STORE_COLUMNS: { key: StoreSortKey; label: string }[] = [
  { key: "store", label: "Store" },
  { key: "revenue", label: "Revenue" },
  { key: "margin", label: "Margin" },
  { key: "tacos", label: "TACOS" },
  { key: "acos", label: "ACOS" },
  { key: "units", label: "Units" },
  { key: "profit", label: "Profit" },
  { key: "stockUnits", label: "Tồn" },
  { key: "stock", label: "Giá trị tồn" },
];

/** Profit: dương xanh, âm đỏ, 0 xám. */
const profitTone = (v: number) => (v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : "text-slate-500");

/** Dòng bảng Stores Performance: 1 store, hoặc 1 kênh của store chạy cả FBA và FBM. */
type StorePerfRow = DashboardStoreRow & { rowKey: string };

/** Giá trị sắp xếp; null (tỷ lệ không có mẫu số) luôn nằm cuối. */
function storeSortValue(row: DashboardStoreRow, key: StoreSortKey): number | string | null {
  const c = row.current;
  switch (key) {
    case "store":
      return row.storeName.toLowerCase();
    case "revenue":
      return c.revenue;
    case "profit":
      return c.profit;
    case "margin":
      return c.revenue > 0 ? c.margin : null;
    case "tacos":
      return c.revenue > 0 ? c.tacos : null;
    case "acos":
      return c.revenueAds > 0 ? c.acos : null;
    case "units":
      return c.quantity;
    case "stockUnits":
      return row.stockUnits ?? null;
    case "stock":
      return row.stockValue ?? null;
  }
}

type StoreChannel = DashboardStoreRow["channels"][number];

const CHANNEL_BADGE: Record<StoreChannel, string> = {
  FBA: "bg-sky-50 text-sky-600",
  FBM: "bg-violet-50 text-violet-600",
};

function ChannelBadge({ channel, label = channel }: { channel: StoreChannel; label?: string }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded px-1.5 py-px text-[10px] font-bold ${CHANNEL_BADGE[channel]}`}>
      {label}
    </span>
  );
}

/** Tên kênh theo Team của store như ở Store Management: "FBA 3" thay vì "FBA". */
type ChannelLabelOf = (storeId: string, channel: StoreChannel) => string;

/** Các ô số liệu (Revenue → Profit) dùng chung cho dòng store và dòng kênh FBA / FBM. */
function StoreMetricCells({
  t,
  sub = false,
  hideRatios = false,
  stockValue,
  stockUnits,
}: {
  t: DashboardTotals;
  sub?: boolean;
  /** Bỏ 3 cột Margin / TACOS / ACOS (bảng Team Performance). */
  hideRatios?: boolean;
  /** Có thì thêm cột Tồn + Giá trị tồn sau Profit (null = kênh FBM không có tồn → "—"). */
  stockValue?: number | null;
  /** Tồn (FBA + AWD) tại ngày cuối kỳ */
  stockUnits?: number | null;
}) {
  const cell = `border-b border-slate-100 px-3 text-right tabular-nums ${sub ? "py-1.5 text-[13px] text-slate-600" : "py-2.5"}`;
  return (
    <>
      <td className={cell}>{money(t.revenue)}</td>
      {!hideRatios && (
        <>
          <td className={cell}>
            {t.revenue <= 0 ? <span className="text-slate-400">—</span> : <span className={sub ? "" : "text-slate-900"}>{pct(t.margin)}</span>}
          </td>
          <td className={cell}>{ratioOrDash(t.tacos, t.revenue)}</td>
          <td className={cell}>{ratioOrDash(t.acos, t.revenueAds)}</td>
        </>
      )}
      <td className={cell}>{int.format(t.quantity)}</td>
      <td className={`${cell} pr-4`}>
        <span className={`${sub ? "font-semibold" : "font-bold"} ${profitTone(t.profit)}`}>{money(t.profit)}</span>
      </td>
      {stockValue !== undefined && (
        <>
          <td className={cell}>{stockUnits == null ? <span className="text-slate-400">—</span> : int.format(stockUnits)}</td>
          <td className={`${cell} pr-4`}>{stockValue == null ? <span className="text-slate-400">—</span> : money(stockValue)}</td>
        </>
      )}
    </>
  );
}

type SkuGroupFilter = "all" | DashboardSkuGroup;
const NO_STORE_ROWS: DashboardStoreRow[] = [];
const SKU_GROUP_OPTIONS: { key: SkuGroupFilter; label: string; title: string }[] = [
  { key: "all", label: "All", title: "Toàn bộ store" },
  { key: "win", label: "Win", title: "FBA: SKU trạng thái Phát triển trong Bảng mã · FBM: toàn bộ FBM" },
  { key: "test", label: "Test", title: "FBA: SKU trạng thái Test trong Bảng mã (không tính FBM)" },
];

/** Số liệu Stores Performance của nhóm SKU Win / Test (tải riêng, chỉ khi chọn nhóm). */
function useSkuGroupData(
  group: SkuGroupFilter,
  query: { startDate: string; endDate: string; storeIds: string[]; team: string; reloadKey: number },
) {
  const [cache, setCache] = useState<Record<string, DashboardSkuGroupData>>({});
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const params = new URLSearchParams();
  if (group !== "all") params.set("group", group);
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  if (query.storeIds.length) params.set("store_ids", query.storeIds.join(","));
  if (query.team) params.set("team", query.team);
  const queryKey = params.toString();
  const requestKey = `${queryKey}#${query.reloadKey}`;
  useEffect(() => {
    if (group === "all") return;
    const controller = new AbortController();
    fetch(`/api/accounting/dashboard/sku-group?${queryKey}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Failed to load data (${res.status})`);
        setCache((prev) => ({ ...prev, [queryKey]: payload as DashboardSkuGroupData }));
        setSettled({ key: requestKey, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ key: requestKey, error: err instanceof Error ? err.message : "Failed to load data" });
      });
    return () => controller.abort();
    // group / queryKey nằm trong requestKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  if (group === "all") return { data: null, loading: false, error: null };
  const done = settled?.key === requestKey;
  return { data: cache[queryKey] ?? null, loading: !done, error: done ? settled.error : null };
}

function StoresPerformance({
  data,
  colorOf,
  channelLabel,
  onFocusStore,
  onShowAll,
  query,
  delay,
}: {
  data: AccountingDashboardData;
  colorOf: (storeId: string) => string;
  channelLabel: ChannelLabelOf;
  onFocusStore: (storeId: string) => void;
  /** Bấm tiêu đề "Store": bỏ lọc store / team, về All. */
  onShowAll: () => void;
  /** Bộ lọc đang chọn của Dashboard, để tải số liệu nhóm SKU Win / Test. */
  query: { startDate: string; endDate: string; storeIds: string[]; team: string; reloadKey: number };
  delay: number;
}) {
  // All = số liệu store như cũ; Win / Test = chỉ cộng SKU thuộc nhóm trong Bảng mã (chỉ đổi bảng này).
  const [group, setGroup] = useState<SkuGroupFilter>("all");
  const groupData = useSkuGroupData(group, query);
  const byStore = group === "all" ? data.byStore : groupData.data?.byStore ?? NO_STORE_ROWS;
  // Mặc định gom theo team (FBA 1, FBA 2…, FBM), trong team xếp theo tên store
  const [sort, setSort] = useState<{ key: StoreSortKey; dir: "asc" | "desc" }>({ key: "store", dir: "asc" });
  // Store chạy cả FBA và FBM: tách thành 2 dòng độc lập, mỗi dòng 1 tag kênh, không có dòng gộp.
  const rows = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    const flat: StorePerfRow[] = byStore.flatMap((r): StorePerfRow[] =>
      r.byChannel
        ? r.byChannel.map((c) => ({
            ...r,
            rowKey: `${r.storeId}:${c.channel}`,
            current: c.current,
            previous: c.previous,
            stockValue: c.stockValue ?? null,
            stockUnits: c.stockUnits ?? null,
            stockDate: c.stockDate ?? r.stockDate ?? null,
            channels: [c.channel],
            byChannel: undefined,
          }))
        : [{ ...r, rowKey: r.storeId }],
    );
    // Bấm cột Store: gom theo team (FBA 1, FBA 2…, FBM), trong team xếp theo tên store
    const teamOf = (r: StorePerfRow) => channelLabel(r.storeId, r.channels[0] ?? "FBA");
    return flat.sort((a, b) => {
      if (sort.key === "store") {
        const t = teamOf(a).localeCompare(teamOf(b), undefined, { numeric: true });
        if (t) return sign * t;
      }
      const av = storeSortValue(a, sort.key);
      const bv = storeSortValue(b, sort.key);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      if (typeof av === "string" || typeof bv === "string") return sign * String(av).localeCompare(String(bv));
      return sign * (av - bv) || b.current.revenue - a.current.revenue;
    });
  }, [byStore, sort, channelLabel]);
  // Khi gom theo team: dòng đầu mỗi team (trừ team đầu tiên) có vạch kẻ phân cách
  const teamStart = (idx: number) =>
    sort.key === "store" &&
    idx > 0 &&
    channelLabel(rows[idx].storeId, rows[idx].channels[0] ?? "FBA") !==
      channelLabel(rows[idx - 1].storeId, rows[idx - 1].channels[0] ?? "FBA");
  const total = group === "all" ? data.current : groupData.data?.current ?? data.current;

  const totalStock = rows.some((r) => r.stockValue != null) ? rows.reduce((sum, r) => sum + (r.stockValue ?? 0), 0) : null;
  const totalStockUnits = rows.some((r) => r.stockUnits != null) ? rows.reduce((sum, r) => sum + (r.stockUnits ?? 0), 0) : null;
  // Tồn lấy theo ảnh chụp Inventory Ledger mới nhất không quá ngày cuối khoảng (crawler chạy theo tuần)
  const stockDates = Array.from(new Set(rows.map((r) => r.stockDate).filter((d): d is string => Boolean(d)))).sort();
  const stockTitle = stockDates.length
    ? `Tồn FBA + AWD theo ảnh chụp kho Amazon ngày ${stockDates.map((d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`).join(", ")} (mới nhất không quá ngày cuối khoảng đang xem)`
    : "Chưa có ảnh chụp tồn kho tới ngày cuối khoảng đang xem";

  // Bấm "Store": về All store (bỏ lọc store / team) và xếp mặc định gom theo team FBA 1 → FBA 2 → … → FBM.
  const toggleSort = (key: StoreSortKey) => {
    if (key === "store") onShowAll();
    setSort((s) =>
      key === "store"
        ? { key: "store", dir: "asc" }
        : s.key === key
          ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "desc" },
    );
  };

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Stores Performance</h2>
        <div className="flex items-center gap-2">
          {groupData.loading && <ArrowClockwiseIcon size={13} weight="bold" className="animate-spin text-indigo-500" />}
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="Nhóm SKU">
            {SKU_GROUP_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="tab"
                aria-selected={group === o.key}
                title={o.title}
                onClick={() => setGroup(o.key)}
                className={`cursor-pointer rounded-md px-3 py-1 text-[13px] font-semibold transition-colors ${
                  group === o.key ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {groupData.error && <p className="mt-2 text-[13px] font-medium text-rose-600">{groupData.error}</p>}
      {group !== "all" && !groupData.data && !groupData.error && (
        <p className="mt-3 text-[13px] text-slate-400">Đang tải số liệu SKU {group === "win" ? "Win" : "Test"}…</p>
      )}
      <div className={`transition-opacity duration-200 ${groupData.loading && groupData.data ? "opacity-60" : ""}`}>
      {/* Màn hẹp: danh sách thẻ thay cho bảng để không phải cuộn ngang */}
      <div className="mt-2 divide-y divide-slate-100 @min-[600px]:hidden">
        {rows.map((row, idx) => {
          const c = row.current;
          const suspicious = c.adsFee > 0 && c.revenue <= 0;
          return (
            <div key={row.rowKey} className={`py-1 ${teamStart(idx) ? "!border-t-slate-300" : ""}`}>
              <button
                type="button"
                onClick={() => onFocusStore(row.storeId)}
                className="flex w-full cursor-pointer items-start justify-between gap-3 py-2 text-left transition-colors active:bg-indigo-50/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(row.storeId) }} />
                    <span className="truncate text-[15px] font-semibold text-slate-900">{row.storeName}</span>
                    {row.channels?.map((ch) => <ChannelBadge key={ch} channel={ch} label={channelLabel(row.storeId, ch)} />)}
                    {suspicious && <WarningIcon size={14} weight="fill" className="shrink-0 text-amber-500" />}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[18px] text-xs tabular-nums text-slate-500">
                    <span>Rev {money(c.revenue)}</span>
                    <span>TACOS {ratioOrDash(c.tacos, c.revenue)}</span>
                    <span>ACOS {ratioOrDash(c.acos, c.revenueAds)}</span>
                    <span>{int.format(c.quantity)} units</span>
                    {row.stockUnits != null && <span>Tồn {int.format(row.stockUnits)}</span>}
                    {row.stockValue != null && <span>Giá trị tồn {money(row.stockValue)}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[15px] font-bold tabular-nums ${profitTone(c.profit)}`}>
                    {money(c.profit)}
                  </div>
                  <div className="mt-1 text-[13px]">
                    {c.revenue <= 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="tabular-nums text-slate-900">{pct(c.margin)}</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
        {rows.length > 1 && (
          <div
            className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold tabular-nums ${
              total.profit < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
            }`}
          >
            <span>Total · {money(total.revenue)}</span>
            <span>
              {money(total.profit)} ({ratioOrDash(total.margin, total.revenue)})
            </span>
          </div>
        )}
      </div>
      <div className="mt-3 hidden overflow-x-auto @min-[600px]:block">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              {STORE_COLUMNS.map((col, i) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`bg-slate-50 px-3 py-2 !text-[13px] !font-bold !tracking-normal !text-slate-700 ${
                      i === 0 ? "rounded-l-lg pl-4" : "text-right"
                    } ${i === STORE_COLUMNS.length - 1 ? "rounded-r-lg pr-4" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      title={col.key === "store" ? "Xem tất cả store (All)" : col.key === "stockUnits" || col.key === "stock" ? stockTitle : undefined}
                      className={`inline-flex cursor-pointer items-center gap-1 !text-[13px] !tracking-normal transition-colors hover:!text-slate-900 ${
                        active ? "!font-bold !text-slate-900" : "!font-bold !text-slate-700"
                      }`}
                    >
                      {col.label}
                      {/* Cột Store không có mũi tên: bấm vào chỉ để về mặc định gom theo team */}
                      <CaretDownIcon
                        size={10}
                        weight="bold"
                        className={`transition-all duration-200 ${active && col.key !== "store" ? "opacity-100" : "opacity-0"} ${
                          active && sort.dir === "asc" ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          {rows.map((row, idx) => {
            const c = row.current;
            const suspicious = c.adsFee > 0 && c.revenue <= 0;
            return (
              <tbody key={row.rowKey} className="acc-rise" style={{ animationDelay: `${delay + idx * 25}ms` }}>
                <tr
                  onClick={() => onFocusStore(row.storeId)}
                  title={`View ${row.storeName} only`}
                  className={`cursor-pointer transition-colors duration-150 hover:bg-indigo-50/40 ${
                    teamStart(idx) ? "[&>td]:border-t [&>td]:border-t-slate-300" : ""
                  }`}
                >
                  <td className="border-b border-slate-100 py-2.5 pl-4 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(row.storeId) }} />
                      <span className="truncate font-semibold text-slate-900">{row.storeName}</span>
                      {row.channels?.map((ch) => <ChannelBadge key={ch} channel={ch} label={channelLabel(row.storeId, ch)} />)}
                      {suspicious && (
                        <span title={`Ad spend ${money(c.adsFee)} with no revenue — check ads mapping`}>
                          <WarningIcon size={14} weight="fill" className="text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <StoreMetricCells t={c} stockValue={row.stockValue ?? null} stockUnits={row.stockUnits ?? null} />
                </tr>
              </tbody>
            );
          })}
          {rows.length > 1 && (
            <tfoot>
              {/* Dòng tổng nổi bật: xanh khi có lãi, đỏ khi lỗ */}
              <tr
                className={`text-[13px] font-semibold tabular-nums ${
                  total.profit < 0 ? "bg-rose-50 [&>td]:!text-rose-700" : "bg-emerald-50 [&>td]:!text-emerald-800"
                }`}
              >
                <td className="rounded-l-lg py-2.5 pl-4 pr-3">Total</td>
                <td className="px-3 py-2.5 text-right">{money(total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.margin, total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.tacos, total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.acos, total.revenueAds)}</td>
                <td className="px-3 py-2.5 text-right">{int.format(total.quantity)}</td>
                <td className="px-3 py-2.5 pr-4 text-right text-[15px] !font-bold">{money(total.profit)}</td>
                <td className="px-3 py-2.5 text-right">{totalStockUnits == null ? "—" : int.format(totalStockUnits)}</td>
                <td className="rounded-r-lg px-3 py-2.5 pr-4 text-right">{totalStock == null ? "—" : money(totalStock)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </div>
    </Card>
  );
}

// ---------- team performance ----------

const TEAM_SUM_KEYS = [
  "revenue",
  "quantity",
  "orders",
  "adsFee",
  "basecost",
  "amazonFee",
  "tax",
  "promotion",
  "returnCost",
  "serviceCost",
  "profit",
  "netProfit",
  "revenueAds",
  "clicks",
] as const;

/** Cộng số liệu nhiều store / kênh; tỷ lệ tính lại từ tổng (cùng công thức summarizeDays). */
function sumTotals(list: DashboardTotals[]): DashboardTotals {
  const t = Object.fromEntries(TEAM_SUM_KEYS.map((k) => [k, 0])) as Record<(typeof TEAM_SUM_KEYS)[number], number>;
  let days = 0;
  for (const x of list) {
    for (const k of TEAM_SUM_KEYS) t[k] += x[k] ?? 0;
    days = Math.max(days, x.days);
  }
  return {
    ...t,
    days,
    margin: t.revenue > 0 ? t.profit / t.revenue : 0,
    netMargin: t.revenue > 0 ? t.netProfit / t.revenue : 0,
    roi: t.basecost > 0 ? t.profit / t.basecost : 0,
    tacos: t.revenue > 0 ? t.adsFee / t.revenue : 0,
    acos: t.revenueAds > 0 ? t.adsFee / t.revenueAds : 0,
  };
}

interface TeamRow {
  team: string;
  channel: StoreChannel;
  stores: string[];
  totals: DashboardTotals;
}

/** Hiệu quả theo team (FBA 1, FBA 2…, FBM): gom từng kênh của store vào team của kênh đó (như Store Management). */
function TeamPerformance({
  data,
  channelLabel,
  teams,
  onFocusTeam,
  delay,
}: {
  data: AccountingDashboardData;
  channelLabel: ChannelLabelOf;
  teams: string[];
  onFocusTeam: (team: string) => void;
  delay: number;
}) {
  const rows = useMemo(() => {
    const map = new Map<string, { channel: StoreChannel; stores: Set<string>; parts: DashboardTotals[] }>();
    for (const r of data.byStore) {
      const parts = r.byChannel
        ? r.byChannel.map((c) => ({ channel: c.channel, totals: c.current }))
        : [{ channel: (r.channels[0] ?? "FBA") as StoreChannel, totals: r.current }];
      for (const part of parts) {
        const team = channelLabel(r.storeId, part.channel);
        const g = map.get(team) ?? { channel: part.channel, stores: new Set<string>(), parts: [] };
        g.stores.add(r.storeName);
        g.parts.push(part.totals);
        map.set(team, g);
      }
    }
    return Array.from(map.entries())
      .map(([team, g]): TeamRow => ({ team, channel: g.channel, stores: Array.from(g.stores).sort(), totals: sumTotals(g.parts) }))
      .sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }));
  }, [data.byStore, channelLabel]);
  const total = data.current;
  const canFocus = (team: string) => teams.includes(team);
  const th = "bg-slate-50 px-3 py-2 text-right !text-[13px] !font-bold !tracking-normal !text-slate-700";

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <h2 className="text-lg font-bold text-slate-900">Team Performance</h2>
      {rows.length === 0 ? (
        <div className="mt-3 grid flex-1 place-items-center rounded-xl border border-dashed border-slate-200 py-10 text-[13px] text-slate-400">
          No data in this period
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className={`${th} rounded-l-lg pl-4 !text-left`}>Team</th>
                <th className={th}>Revenue</th>
                <th className={th}>Units</th>
                <th className={`${th} rounded-r-lg pr-4`}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const focusable = canFocus(row.team);
                return (
                  <tr
                    key={row.team}
                    onClick={focusable ? () => onFocusTeam(row.team) : undefined}
                    title={focusable ? `Xem riêng team ${row.team}` : undefined}
                    className={`transition-colors duration-150 ${focusable ? "cursor-pointer hover:bg-indigo-50/40" : ""}`}
                  >
                    <td className="border-b border-slate-100 py-2.5 pl-4 pr-3">
                      <ChannelBadge channel={row.channel} label={row.team} />
                    </td>
                    <StoreMetricCells t={row.totals} hideRatios />
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr
                  className={`text-[13px] font-semibold tabular-nums ${
                    total.profit < 0 ? "bg-rose-50 [&>td]:!text-rose-700" : "bg-emerald-50 [&>td]:!text-emerald-800"
                  }`}
                >
                  <td className="rounded-l-lg py-2.5 pl-4 pr-3">Total</td>
                  <td className="px-3 py-2.5 text-right">{money(total.revenue)}</td>
                  <td className="px-3 py-2.5 text-right">{int.format(total.quantity)}</td>
                  <td className="rounded-r-lg px-3 py-2.5 pr-4 text-right text-[15px] !font-bold">{money(total.profit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- skeleton ----------

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4 @min-[1100px]:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
        ))}
      </div>
      <div className="grid gap-4 @min-[900px]:grid-cols-3">
        <div className="h-[380px] animate-pulse rounded-2xl border border-slate-200/70 bg-white @min-[900px]:col-span-2" />
        <div className="h-[380px] animate-pulse rounded-2xl border border-slate-200/70 bg-white" />
      </div>
    </div>
  );
}

// ---------- main ----------

function readSavedStoreIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_IDS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function readSavedCompareBase(): CompareBase | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(COMPARE_KEY);
    return saved === "prev" || saved === "yoy" ? saved : null;
  } catch {
    return null;
  }
}

/** Bộ lọc ngày của Overview: bỏ Last 7 / 30 days, Year to date; thêm This year / Last year. */
const OVERVIEW_DATE_PRESETS = ["all", "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year"];

export function AccountingDashboardView() {
  const maxDate = useMemo(() => getAmazonLatestAvailableDate(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(readSavedStoreIds);
  // Mỗi lần mở Dashboard luôn bắt đầu từ "This month"
  const [dateRange, setDateRange] = useState<DateRange>(() => getThisMonthDateRange(maxDate));
  // Preset vừa bấm (this_month, last_week…) → đơn vị kỳ chính xác; null = khoảng tự chọn trên lịch.
  const [datePreset, setDatePreset] = useState<string | null>("this_month");
  const [compareBase, setCompareBase] = useState<CompareBase | null>(readSavedCompareBase);
  // Một bộ điều khiển chung: ngày / tuần / tháng quyết định cả cách gộp biểu đồ lẫn kỳ so sánh.
  // Cách gộp biểu đồ tự suy ra từ khoảng ngày (không có nút chọn), tách khỏi kỳ so sánh (theo đơn vị của khoảng ngày).
  const periodUnit = dashboardRangeUnit(dateRange.startDate, dateRange.endDate, datePreset);
  const granularity = dashboardChartGranularity(periodUnit, dateRange.startDate, dateRange.endDate);
  const compare = compareModeFor(periodUnit, compareBase);
  // Ô (ngày / tuần / tháng) đang xem trong P&L; null = ô mới nhất.
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("acc_dashboard_selected_team") || null;
      } catch {
        return null;
      }
    }
    return null;
  });
  // Cache phản hồi theo bộ lọc: quay lại lựa chọn cũ hiển thị ngay, rồi làm mới ngầm.
  const [responses, setResponses] = useState<Record<string, AccountingDashboardData>>({});
  const [lastKey, setLastKey] = useState<string | null>(null);
  const freshRef = useRef(false);
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetch("/api/accounting/stores")
      .then((res) => (res.ok ? res.json() : { stores: [] }))
      .then((payload) => {
        if (!ignore) setStores(payload.stores || []);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  // Bỏ các store đã bị xóa khỏi lựa chọn đã lưu
  const validSelectedIds = useMemo(
    () => (stores.length ? selectedIds.filter((id) => stores.some((s) => s.id === id)) : selectedIds),
    [selectedIds, stores],
  );
  const selectionKey = `${validSelectedIds.join(",")}:${selectedTeam || ""}`;
  const queryKey = `${dateRange.startDate}|${dateRange.endDate}|${selectionKey}|${compare}`;
  const requestKey = `${queryKey}|${reloadKey}`;
  const data = responses[queryKey] ?? (lastKey ? responses[lastKey] : undefined) ?? null;
  const loading = settled?.key !== requestKey;
  const error = loading ? null : settled.error;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (dateRange.startDate) params.set("start_date", dateRange.startDate);
    if (dateRange.endDate) params.set("end_date", dateRange.endDate);
    if (validSelectedIds.length) params.set("store_ids", validSelectedIds.join(","));
    if (selectedTeam) params.set("team", selectedTeam);
    params.set("compare", compare);
    if (freshRef.current) {
      params.set("fresh", "1");
      freshRef.current = false;
    }

    fetch(`/api/accounting/dashboard?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Failed to load data (${res.status})`);
        setResponses((prev) => ({ ...prev, [queryKey]: payload as AccountingDashboardData }));
        setLastKey(queryKey);
        setSettled({ key: requestKey, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({ key: requestKey, error: err instanceof Error ? err.message : "Failed to load data" });
      });
    return () => controller.abort();
  }, [dateRange.startDate, dateRange.endDate, selectionKey, compare, queryKey, requestKey]);

  // Tải sẵn các preset hay dùng (cùng store / team / kiểu so sánh) sau khi màn hình hiện xong: bấm chuyển preset
  // là có ngay, đồng thời làm nóng cache server (cả Top sản phẩm). Lần lượt từng preset, dừng khi đổi bộ lọc.
  const prefetchedRef = useRef(new Set<string>());
  useEffect(() => {
    if (loading || !data || !maxDate) return;
    const controller = new AbortController();
    const run = async () => {
      for (const presetId of OVERVIEW_DATE_PRESETS) {
        const range = dashboardPresetRange(presetId, maxDate);
        if (!range) continue;
        const mode = dashboardCompareMode(dashboardRangeUnit(range.startDate, range.endDate, presetId), compareBase);
        const key = `${range.startDate}|${range.endDate}|${selectionKey}|${mode}`;
        if (prefetchedRef.current.has(`${key}|${reloadKey}`)) continue;
        prefetchedRef.current.add(`${key}|${reloadKey}`);
        const params = new URLSearchParams({ start_date: range.startDate, end_date: range.endDate, compare: mode });
        if (validSelectedIds.length) params.set("store_ids", validSelectedIds.join(","));
        if (selectedTeam) params.set("team", selectedTeam);
        try {
          const res = await fetch(`/api/accounting/dashboard?${params.toString()}`, { cache: "no-store", signal: controller.signal });
          if (!res.ok) continue;
          const payload = (await res.json()) as AccountingDashboardData;
          setResponses((prev) => (prev[key] ? prev : { ...prev, [key]: payload }));
          // Top sản phẩm: chỉ gọi để server tính sẵn (bảng Top có cache riêng ở client)
          params.delete("compare");
          void fetch(`/api/accounting/dashboard/top-products?${params.toString()}`, { cache: "no-store", signal: controller.signal }).catch(() => {});
        } catch {
          // Bị huỷ giữa chừng (đổi bộ lọc) → lần sau tải lại preset này
          prefetchedRef.current.delete(`${key}|${reloadKey}`);
          if (controller.signal.aborted) return;
        }
      }
    };
    // Chờ màn hình hiện xong rồi mới tải sẵn
    const timer = setTimeout(() => void run(), 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // validSelectedIds / selectedTeam nằm trong selectionKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, Boolean(data), maxDate, selectionKey, compareBase, reloadKey]);

  const refresh = useCallback(() => {
    freshRef.current = true;
    setReloadKey((k) => k + 1);
  }, []);

  // Tự làm mới khi job nạp file kế toán hoàn tất
  useEffect(() => {
    window.addEventListener("accounting-import-completed", refresh);
    return () => window.removeEventListener("accounting-import-completed", refresh);
  }, [refresh]);

  const updateSelection = useCallback(
    (next: string[]) => {
      const normalized = stores.length && next.length >= stores.length ? [] : next;
      setSelectedIds(normalized);
      try {
        localStorage.setItem(STORE_IDS_KEY, JSON.stringify(normalized));
      } catch {
        // ignore
      }
    },
    [stores.length],
  );

  const [activeFlyout, setActiveFlyout] = useState<"store" | "team" | null>(null);

  const handleSelectStore = (storeId: string, team?: string | null) => {
    updateSelection([storeId]);
    persistTeam(team || null);
    setStoreMenuOpen(false);
    setActiveFlyout(null);
  };

  const persistTeam = (team: string | null) => {
    setSelectedTeam(team);
    try {
      if (team) localStorage.setItem("acc_dashboard_selected_team", team);
      else localStorage.removeItem("acc_dashboard_selected_team");
    } catch {
      // ignore
    }
  };

  const handleSelectAll = () => {
    updateSelection([]);
    persistTeam(null);
    setStoreMenuOpen(false);
    setActiveFlyout(null);
  };

  // Tổng kết theo team: gom mọi store có team này (vd FBA 2 = EVERPHANT + FASTPEACE + LIMIMA).
  const handleSelectTeam = (team: string | null) => {
    persistTeam(team);
    updateSelection([]);
    setStoreMenuOpen(false);
    setActiveFlyout(null);
  };

  // Chọn khoảng ngày → biểu đồ tự đổi cách gộp (tuần → từng ngày, tháng → từng tuần).
  const handleRangeChange = (next: DateRange, presetId?: string) => {
    setDateRange(next);
    setDatePreset(presetId ?? null);
  };

  const handleCompareBaseChange = (next: CompareBase | null) => {
    setCompareBase(next);
    try {
      localStorage.setItem(COMPARE_KEY, next ?? "none");
    } catch {
      // ignore
    }
  };

  const colorOf = useCallback(
    (storeId: string) => {
      const idx = stores.findIndex((s) => s.id === storeId);
      return STORE_COLORS[(idx < 0 ? 0 : idx) % STORE_COLORS.length];
    },
    [stores],
  );

  const channelLabel = useCallback<ChannelLabelOf>(
    (storeId, channel) => {
      if (channel === "FBM") return "FBM";
      const fbaTeams = parseStoreTeams(stores.find((s) => s.id === storeId)?.team).filter((t) => /^fba\b/i.test(t));
      return fbaTeams.length ? fbaTeams.join(" / ") : "FBA";
    },
    [stores],
  );

  const kpis: KpiDef[] = useMemo(() => {
    if (!data) return [];
    const c = data.current;
    const p = data.previous;
    const ppDelta = (cur: number, prev: number | undefined, base: number | undefined) =>
      prev != null && base != null && base > 0 ? cur - prev : null;
    const cards: KpiDef[] = [
      {
        id: "revenue",
        label: "Revenue",
        accent: "emerald",
        icon: CurrencyDollarIcon,
        value: c.revenue,
        format: money,
        ratio: changeRatio(c.revenue, p?.revenue),
      },
      {
        id: "orders",
        label: "Orders",
        accent: "indigo",
        icon: ShoppingBagIcon,
        value: c.orders,
        format: (v: number) => int.format(Math.round(v)),
        ratio: changeRatio(c.orders, p?.orders),
      },
      {
        id: "profit",
        label: "Profit",
        accent: "emerald",
        icon: CoinsIcon,
        value: c.profit,
        format: money,
        ratio: changeRatio(c.profit, p?.profit),
        negativeRed: true,
      },
      {
        id: "margin",
        label: "Margin",
        accent: "rose",
        icon: PercentIcon,
        value: c.margin,
        format: (v: number) => pct(v),
        ratio: ppDelta(c.margin, p?.margin, p?.revenue),
        negativeRed: true,
      },
      {
        id: "ads",
        label: "Ad Spend",
        accent: "sky",
        icon: MegaphoneIcon,
        value: c.adsFee,
        format: money,
        ratio: changeRatio(c.adsFee, p?.adsFee),
      },
      {
        id: "tacos",
        label: "TACOS",
        accent: "amber",
        icon: ChartPieSliceIcon,
        value: c.tacos,
        format: (v: number) => pct(v),
        ratio: ppDelta(c.tacos, p?.tacos, p?.revenue),
      },
      {
        id: "acos",
        label: "ACOS",
        accent: "cyan",
        icon: TargetIcon,
        value: c.acos,
        format: (v: number) => pct(v),
        ratio: ppDelta(c.acos, p?.acos, p?.revenueAds),
      },
    ];

    if (data.payout) {
      cards.push({
        id: "payout",
        label: "Payout",
        accent: "teal",
        icon: BankIcon,
        value: data.payout.current,
        format: money,
        ratio: changeRatio(data.payout.current, data.payout.previous ?? undefined),
      });
    }

    return cards;
  }, [data]);

  const allSelected = validSelectedIds.length === 0;
  const selectedStore =
    validSelectedIds.length === 1 ? stores.find((s) => s.id === validSelectedIds[0]) : null;
  // 1 dropdown: All / từng store (kèm team của store) / tổng kết theo team
  const storeLabel = allSelected
    ? selectedTeam || "All"
    : selectedStore
    ? selectedTeam
      ? `${selectedStore.name} • ${selectedTeam}`
      : selectedStore.name
    : `${validSelectedIds.length} stores`;
  // Phân quyền kế toán: chỉ team có kênh người dùng được xem (team FBM ↔ kênh FBM, team khác ↔ FBA)
  const teams = listTeams(stores).filter((team) =>
    stores.some((s) => storeHasTeam(s.team, team) && storeCanView(s, /^fbm$/i.test(team) ? "FBM" : "FBA")),
  );
  // Biểu đồ và P&L dùng chung các ô đã gộp: chưa chọn ô thì P&L tóm tắt cả khoảng ngày đã chọn (khớp KPI),
  // bấm vào một ô trên biểu đồ thì P&L tóm tắt riêng ô đó.
  const buckets = useMemo(() => {
    if (!data) return [];
    // Theo tháng: luôn từ tháng 1 của năm (không chỉ các ngày trong khoảng đã chọn)
    if (granularity === "month" && data.trendStartDate && data.period.endDate && data.days) {
      const monthsBack = !data.previous ? 0 : compareBase === "yoy" || periodUnit === "year" ? 12 : 1;
      return monthBuckets(data.days, data.trendStartDate, data.period.endDate, monthsBack);
    }
    return aggregateTrend(data.daily, granularity);
  }, [data, granularity, periodUnit, compareBase]);
  const comparePreview = useMemo(() => {
    const period = data?.period;
    if (!period?.startDate || !period.endDate) return {};
    const thisYear = period.endDate.slice(0, 4);
    const label = (base: CompareBase) => {
      const prev = resolveDashboardPeriods(period.startDate, period.endDate, period.endDate, compareModeFor(periodUnit, base)).previous;
      if (!prev) return "";
      // Ghi năm khi khác năm hiện tại
      const end = prev.endDate.slice(0, 4) === thisYear ? shortDate(prev.endDate) : longDate(prev.endDate);
      return prev.startDate === prev.endDate ? end : `${shortDate(prev.startDate)} – ${end}`;
    };
    return { prev: label("prev"), yoy: label("yoy") };
  }, [data?.period, periodUnit]);
  // Cả kỳ so sánh không có ngày nào có dữ liệu (vd chưa nhập dữ liệu năm trước) → ẩn phần so sánh.
  const compareEmpty = Boolean(data?.previous && data.previous.days === 0);
  const dataClamped = Boolean(data?.period.endDate && dateRange.endDate && data.period.endDate < dateRange.endDate);

  return (
    // Lưu ý: html font-size = 13px nên mốc container theo rem bị co lại; các mốc bố cục chính dùng px.
    <div className="relative h-full overflow-y-auto bg-slate-50">
      {/* Thanh tiến trình mảnh khi đang tải lại */}
      <div className={`sticky top-0 z-30 h-0.5 overflow-hidden transition-opacity duration-300 ${loading && data ? "opacity-100" : "opacity-0"}`}>
        <div className="acc-progress h-full w-1/3 rounded-full bg-indigo-500" />
      </div>

      <div className="@container mx-auto max-w-[1480px] space-y-4 px-3 pb-8 pt-3 sm:px-6 sm:pt-5">
        {/* HEADER */}
        <div className="acc-rise relative z-20 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">Finance Overview</h1>
            {data?.period.startDate && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                <span>
                  Showing {shortDate(data.period.startDate)} – {longDate(data.period.endDate)}
                </span>
                {dataClamped && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-amber-200">
                    Latest data: {shortDate(data.latestDate)}
                  </span>
                )}
              </p>
            )}
          </div>
          {/* Hẹp: [Stores][↻] rồi khoảng ngày một hàng riêng; rộng: một hàng */}
          <div className="flex w-full flex-wrap items-center gap-2 @min-[640px]:w-auto">
            <DropdownShell
              className="min-w-0 flex-1 @min-[640px]:flex-none"
              widthClass="w-60 sm:w-64"
              align="left"
              label={storeLabel}
              icon={
                selectedTeam ? (
                  <UsersThreeIcon size={15} weight="bold" className="text-indigo-600" />
                ) : (
                  <StorefrontIcon
                    size={15}
                    weight="bold"
                    className={validSelectedIds.length > 0 ? "text-indigo-600" : "text-slate-500"}
                  />
                )
              }
              open={storeMenuOpen}
              setOpen={(open) => {
                setStoreMenuOpen(open);
                if (!open) setActiveFlyout(null);
              }}
            >
              <div
                className="relative p-1 text-[13px]"
                onMouseLeave={() => setActiveFlyout(null)}
              >
                {/* MỤC ALL */}
                <MenuItem
                  active={allSelected && !selectedTeam}
                  onClick={handleSelectAll}
                >
                  <StorefrontIcon size={14} weight="bold" className="shrink-0 text-slate-500" />
                  <span className="font-semibold text-slate-800">All</span>
                  <span className="ml-auto text-[11px] font-normal text-slate-400">
                    {stores.length} stores
                  </span>
                </MenuItem>

                <div className="my-1.5 h-px bg-slate-100" />

                {/* 3. CẤP STORE */}
                <div
                  className="group/store relative"
                  onMouseEnter={() => setActiveFlyout("store")}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFlyout(activeFlyout === "store" ? null : "store")}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                      validSelectedIds.length > 0 || activeFlyout === "store"
                        ? "bg-slate-100 text-slate-900 font-semibold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <StorefrontIcon
                        size={14}
                        weight="bold"
                        className={validSelectedIds.length > 0 ? "text-indigo-600" : "text-slate-500"}
                      />
                      <span>Store</span>
                      {validSelectedIds.length > 0 && selectedStore ? (
                        <span className="ml-auto truncate max-w-[90px] rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                          {selectedStore.name}
                        </span>
                      ) : (
                        <span className="ml-auto text-[11px] font-normal text-slate-400">
                          {stores.length} stores
                        </span>
                      )}
                    </span>
                    <CaretRightIcon
                      size={12}
                      weight="bold"
                      className="shrink-0 text-slate-400 transition-colors group-hover/store:text-indigo-600"
                    />
                  </button>

                  {/* Flyout Submenu cho Cấp Store */}
                  <div
                    className={`absolute left-[calc(100%-4px)] top-0 z-50 w-64 pl-2 ${
                      activeFlyout === "store" ? "block" : "hidden group-hover/store:block"
                    }`}
                  >
                    <div className="max-h-[380px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 animate-in fade-in duration-150">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Stores ({stores.length})
                      </div>
                      {stores.map((s) => {
                        const storeTeams = parseStoreTeams(s.team);
                        const isMultiTeam = storeTeams.length > 1;
                        const isStoreActive = validSelectedIds.length === 1 && validSelectedIds[0] === s.id;

                        if (isMultiTeam) {
                          return (
                            <div key={s.id} className="group/sub relative">
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSelectStore(s.id, null)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleSelectStore(s.id, null);
                                  }
                                }}
                                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                                  isStoreActive
                                    ? "bg-indigo-50 font-semibold text-indigo-700"
                                    : "text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: colorOf(s.id) }}
                                  />
                                  <span className="truncate">{s.name}</span>
                                  <span className="ml-auto shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                                    {storeTeams.length} teams
                                  </span>
                                </span>
                                <CaretRightIcon
                                  size={12}
                                  weight="bold"
                                  className="shrink-0 text-slate-400 transition-colors group-hover/sub:text-indigo-600"
                                />
                              </div>

                              {/* Submenu cho store có nhiều team */}
                              <div className="absolute left-[calc(100%-4px)] top-0 z-50 hidden w-52 pl-2 group-hover/sub:block group-focus-within/sub:block">
                                <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 animate-in fade-in duration-150">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSelectStore(s.id, null);
                                    }}
                                    className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${
                                      isStoreActive && !selectedTeam
                                        ? "bg-indigo-50 font-semibold text-indigo-700"
                                        : "text-slate-700 hover:bg-slate-50"
                                    }`}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s.id) }} />
                                      <span className="truncate font-semibold">{s.name} (Tất cả)</span>
                                    </span>
                                    {isStoreActive && !selectedTeam && (
                                      <CheckIcon size={12} weight="bold" className="shrink-0 text-indigo-600" />
                                    )}
                                  </button>
                                  <div className="my-1 h-px bg-slate-100" />
                                  {storeTeams.map((t) => {
                                    const isThisTeamActive = isStoreActive && selectedTeam === t;
                                    return (
                                      <button
                                        key={t}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelectStore(s.id, t);
                                        }}
                                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${
                                          isThisTeamActive
                                            ? "bg-indigo-50 font-semibold text-indigo-700"
                                            : "text-slate-700 hover:bg-slate-50"
                                        }`}
                                      >
                                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                                          <UsersThreeIcon size={13} weight="bold" className="shrink-0 text-indigo-500" />
                                          <span>Team {t}</span>
                                        </span>
                                        {isThisTeamActive && (
                                          <CheckIcon size={12} weight="bold" className="shrink-0 text-indigo-600" />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <MenuItem
                            key={s.id}
                            active={isStoreActive && !selectedTeam}
                            onClick={() => handleSelectStore(s.id, null)}
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s.id) }} />
                            <span className="truncate">{s.name}</span>
                            {s.team && (
                              <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                {s.team}
                              </span>
                            )}
                          </MenuItem>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 4. CẤP TEAM */}
                <div
                  className="group/team relative"
                  onMouseEnter={() => setActiveFlyout("team")}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFlyout(activeFlyout === "team" ? null : "team")}
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors ${
                      (allSelected && selectedTeam) || activeFlyout === "team"
                        ? "bg-slate-100 text-slate-900 font-semibold"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <UsersThreeIcon
                        size={14}
                        weight="bold"
                        className={allSelected && selectedTeam ? "text-indigo-600" : "text-indigo-500"}
                      />
                      <span>Team</span>
                      {allSelected && selectedTeam ? (
                        <span className="ml-auto truncate max-w-[90px] rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                          {selectedTeam}
                        </span>
                      ) : (
                        <span className="ml-auto text-[11px] font-normal text-slate-400">
                          {teams.length} teams
                        </span>
                      )}
                    </span>
                    <CaretRightIcon
                      size={12}
                      weight="bold"
                      className="shrink-0 text-slate-400 transition-colors group-hover/team:text-indigo-600"
                    />
                  </button>

                  {/* Flyout Submenu cho Cấp Team */}
                  <div
                    className={`absolute left-[calc(100%-4px)] top-0 z-50 w-56 pl-2 ${
                      activeFlyout === "team" ? "block" : "hidden group-hover/team:block"
                    }`}
                  >
                    <div className="max-h-[380px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 animate-in fade-in duration-150">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Teams ({teams.length})
                      </div>
                      {teams.map((t) => {
                        const count = stores.filter((s) => storeHasTeam(s.team, t)).length;
                        const isThisTeamActive = allSelected && selectedTeam === t;
                        return (
                          <MenuItem
                            key={t}
                            active={isThisTeamActive}
                            onClick={() => handleSelectTeam(t)}
                          >
                            <UsersThreeIcon size={13} weight="bold" className="shrink-0 text-indigo-500" />
                            <span className="truncate">{t}</span>
                            <span className="ml-auto shrink-0 text-[11px] font-normal text-slate-400">
                              {count} {count === 1 ? "store" : "stores"}
                            </span>
                          </MenuItem>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </DropdownShell>
            <div className="order-last w-full @min-[640px]:order-none @min-[640px]:w-auto">
              <PpcAmazonDatePicker value={dateRange} onChange={handleRangeChange} maxDate={maxDate} align="right" presets={OVERVIEW_DATE_PRESETS} />
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:border-slate-300 disabled:cursor-default"
            >
              <ArrowClockwiseIcon size={15} weight="bold" className={loading ? "animate-spin text-indigo-600" : ""} />
            </button>
          </div>
        </div>

        {error && (
          <div className="acc-rise flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
            <span className="flex items-center gap-2 font-semibold">
              <WarningCircleIcon size={16} weight="bold" />
              {error}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="cursor-pointer rounded-md bg-white px-2.5 py-1 font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        )}

        {!data && loading ? (
          <DashboardSkeleton />
        ) : data ? (
          <div className={`space-y-4 transition-opacity duration-300 ${loading ? "opacity-70" : "opacity-100"}`}>
            <div
              className={`grid grid-cols-2 gap-2.5 sm:gap-3 @min-[560px]:grid-cols-4 ${
                kpis.length >= 8 ? "@min-[1240px]:grid-cols-8" : "@min-[1100px]:grid-cols-7"
              }`}
            >
              {kpis.map((kpi, i) => (
                <KpiCard
                  key={kpi.id}
                  kpi={kpi}
                  delay={i * 30}
                  showDelta={Boolean(data.previous) && !compareEmpty}
                  compareLabel={compareBase ? compareLabel(compareBase, periodUnit) : ""}
                />
              ))}
            </div>

            {/* Row 2: biểu đồ Revenue & Profit (2 cột) + Team Performance (1 cột) */}
            <div className="grid gap-4 @min-[900px]:grid-cols-3">
              <div className="min-w-0 @min-[900px]:col-span-2">
                <TrendChart
                  data={buckets}
                  compareEmpty={compareEmpty}
                  previousPeriod={data.previousPeriod}
                  controls={{
                    granularity,
                    compareUnit: periodUnit,
                    compareBase,
                    onCompareBaseChange: handleCompareBaseChange,
                    comparePreview,
                  }}
                  delay={120}
                />
              </div>
              <div className="min-w-0">
                <TeamPerformance
                  data={data}
                  channelLabel={channelLabel}
                  teams={teams}
                  onFocusTeam={handleSelectTeam}
                  delay={150}
                />
              </div>
            </div>

            {/* Row 3: Stores Performance (cả hàng), lọc All / Win / Test chỉ đổi bảng này */}
            <StoresPerformance
              data={data}
              colorOf={colorOf}
              channelLabel={channelLabel}
              onFocusStore={(id) => updateSelection([id])}
              onShowAll={handleSelectAll}
              query={{
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                storeIds: validSelectedIds,
                team: selectedTeam ?? "",
                reloadKey,
              }}
              delay={160}
            />

            {/* Row 4: Top Products FBA | FBM (chỉ kênh có trong bộ lọc), chia đôi hàng để đủ cột chỉ số */}
            <TopSellingProducts
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
              storeIds={validSelectedIds}
              team={selectedTeam}
              reloadKey={reloadKey}
              delay={210}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
