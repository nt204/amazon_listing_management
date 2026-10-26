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
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  StorefrontIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { Store } from "@/lib/accounting/types";
import type {
  AccountingDashboardData,
  DashboardSeriesPoint,
  DashboardStoreRow,
  DashboardTotals,
} from "@/lib/accounting/dashboard-db";
import { previousMonthRange, type DashboardCompareMode } from "@/lib/accounting/dashboard-periods";
import { summarizeRange, type DashboardDay, type DashboardTotals as Totals } from "@/lib/accounting/dashboard-totals";
import { listTeams, parseStoreTeams, storeHasTeam } from "@/lib/accounting/store-teams";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";
import { getAmazonLatestAvailableDate, getThisMonthDateRange } from "./financials-date-utils";

const STORE_IDS_KEY = "acc_dashboard_store_ids";
// v3: chỉ giữ các kiểu so sánh có ý nghĩa ở mọi cấp độ ngày / tuần / tháng.
const COMPARE_KEY = "acc_dashboard_compare_v3";

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
      {up ? <ArrowUpRightIcon size={12} weight="bold" /> : <ArrowDownRightIcon size={12} weight="bold" />}
      {up ? "+" : "−"}
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useClickOutside(ref, open, close);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex cursor-pointer items-center justify-between gap-2 border border-slate-200 bg-white text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-300 ${
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
  tone: string;
  value: number;
  format: (v: number) => string;
  ratio: number | null;
  negativeRed?: boolean;
}

const TONES = {
  green: "from-emerald-50/90",
  violet: "from-violet-50/90",
  rose: "from-rose-50/90",
  blue: "from-sky-50/90",
  orange: "from-orange-50/90",
  cyan: "from-cyan-50/70",
  indigo: "from-indigo-50/80",
};

function KpiCard({ kpi, delay, showDelta }: { kpi: KpiDef; delay: number; showDelta: boolean }) {
  return (
    <Card
      delay={delay}
      className={`@container bg-gradient-to-br ${kpi.tone} to-white p-3.5 transition-shadow duration-300 hover:shadow-lg @min-[190px]:p-4`}
    >
      {/* Thẻ hẹp (lưới 7 cột hoặc mobile nhỏ): số nhỏ lại để không bị cắt */}
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-600">{kpi.label}</div>
        <div
          className={`mt-0.5 truncate text-2xl font-bold leading-tight tracking-tight tabular-nums @min-[190px]:text-[26px] ${
            kpi.negativeRed && kpi.value < 0 ? "text-rose-600" : "text-slate-900"
          }`}
        >
          <AnimatedNumber value={kpi.value} format={kpi.format} />
        </div>
        {showDelta && (
          <div className="mt-1.5">
            <DeltaPill ratio={kpi.ratio} />
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- trend chart ----------

const GRANULARITY_LABELS: Record<ChartGranularity, string> = {
  day: "Theo ngày",
  week: "Theo tuần",
  month: "Theo tháng",
};

type ChartPoint = DashboardSeriesPoint & Partial<Record<`cmp_${SeriesKey}`, number>>;
type ChartGranularity = "day" | "week" | "month";

const GRANULARITY_UNIT: Record<ChartGranularity, string> = {
  day: "Ngày",
  week: "Tuần",
  month: "Tháng",
};

const COMPARE_PERIOD_LABELS: Record<ChartGranularity, string> = {
  day: "Kỳ trước",
  week: "Tuần trước",
  month: "Tháng trước",
};

/** Nhãn khoảng ngày của 1 ô trên biểu đồ (ngày / tuần / tháng). */
function bucketRangeLabel(start: string, end: string): string {
  return start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;
}

/** Ngày → kỳ liền trước, tuần → tuần trước, tháng → tháng trước. */
const compareModeFor = (granularity: ChartGranularity): DashboardCompareMode =>
  granularity === "week" ? "week" : granularity === "month" ? "month" : "prev";

/** Đặt trong biểu đồ nhưng điều khiển chung cho KPI, biểu đồ và P&L: bật/tắt so sánh + chọn ngày / tuần / tháng. */
function PeriodControls({
  granularity,
  onGranularityChange,
  compareOn,
  onToggleCompare,
}: {
  granularity: ChartGranularity;
  onGranularityChange: (granularity: ChartGranularity) => void;
  compareOn: boolean;
  onToggleCompare: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-pressed={compareOn}
        onClick={onToggleCompare}
        className={`inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors ${
          compareOn
            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
        }`}
      >
        <span
          className={`grid h-4 w-4 place-items-center rounded border transition-colors ${
            compareOn ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
          }`}
        >
          {compareOn && <CheckIcon size={11} weight="bold" />}
        </span>
        So sánh
      </button>
      <DropdownShell
        label={GRANULARITY_LABELS[granularity]}
        open={open}
        setOpen={setOpen}
        widthClass="w-36"
        variant="chip"
        align="right"
      >
        {(["day", "week", "month"] as const).map((item) => (
          <MenuItem
            key={item}
            active={granularity === item}
            onClick={() => {
              onGranularityChange(item);
              setOpen(false);
            }}
          >
            {GRANULARITY_LABELS[item]}
          </MenuItem>
        ))}
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

function startOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
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
 * cùng đoạn của tháng liền trước (tháng dở dang so cùng số ngày).
 */
function monthBuckets(days: DashboardDay[], trendStart: string, endDate: string, withCompare: boolean): AggregatedChartPoint[] {
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
    if (withCompare) {
      const prev = previousMonthRange(rangeStart, rangeEnd);
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
  selectedKey,
  onSelect,
  delay,
}: {
  /** Các ô ngày / tuần / tháng đã gộp sẵn (dùng chung với P&L). */
  data: AggregatedChartPoint[];
  previousPeriod: { startDate: string; endDate: string } | null;
  controls: React.ComponentProps<typeof PeriodControls>;
  /** Ô đang hiển thị trong P&L bên cạnh. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
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
  const hasCompare = data.some((p) => p.compare);
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
  const selectedBandWidth = Math.max(4, Math.min(56, (((chartWidth || 800) - 70) / Math.max(1, data.length)) * 0.7));
  // ~1 nhãn mỗi 58px chiều ngang để số không chồng nhau trên màn hẹp
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor((chartWidth || 800) / 58))));
  // Theo tháng mỗi điểm so với tháng liền trước của nó, không phải 1 khoảng cố định
  const compareRangeLabel =
    mode === "month"
      ? "Tháng trước"
      : previousPeriod
      ? `${shortDate(previousPeriod.startDate)} - ${shortDate(previousPeriod.endDate)}`
      : "";

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
              onClick={(state) => {
                if (state?.activeLabel != null) onSelect(String(state.activeLabel));
              }}
              style={{ cursor: "pointer" }}
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
              {/* Dải nền đánh dấu ô đang xem trong P&L */}
              {selectedKey && data.length > 1 && (
                <ReferenceLine x={selectedKey} stroke="#6366f1" strokeOpacity={0.08} strokeWidth={selectedBandWidth} />
              )}
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.25} />
              <Tooltip
                cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                content={({ active, label }) => {
                  const point = active && label != null ? pointMap.get(String(label)) : undefined;
                  if (!point) return null;
                  const cmp = point.compare;
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
                                    className={`w-10 text-right text-[10.5px] font-semibold ${
                                      change == null ? "text-slate-300" : good ? "text-emerald-600" : "text-rose-500"
                                    }`}
                                  >
                                    {change == null ? "—" : `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}%`}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {point.key !== selectedKey && (
                        <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs text-slate-400">Bấm để xem P&amp;L của kỳ này</p>
                      )}
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

// ---------- P&L ----------

// Cùng tên + thứ tự với các cột chi phí của tab Financials (FBA theo ngày)
const COST_ITEMS = [
  { key: "adsFee", label: "Ads Fee", color: "#8b5cf6" },
  { key: "basecost", label: "Base Cost", color: "#0d9488" },
  { key: "amazonFee", label: "AMZ Fee", color: "#fb923c" },
  { key: "tax", label: "Thuế", color: "#f472b6" },
  { key: "promotion", label: "Promotion", color: "#ca8a04" },
  { key: "returnCost", label: "Refund", color: "#06b6d4" },
] as const;
type CostKey = (typeof COST_ITEMS)[number]["key"];

function costValues(t: DashboardTotals): Record<CostKey, number> {
  return {
    adsFee: t.adsFee,
    basecost: t.basecost,
    amazonFee: t.amazonFee,
    tax: t.tax,
    promotion: t.promotion,
    returnCost: t.returnCost,
  };
}

const PNL_GRID = "grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto_3.5rem] items-center gap-3";
// Khi so sánh: tên | thanh | kỳ này | kỳ trước (mờ) | % thay đổi
const PNL_GRID_CMP = "grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto_auto_3.25rem] items-center gap-x-2.5";

/** % thay đổi dạng chữ gọn; ẩn khi đổi dấu hoặc lệch quá 999% (vô nghĩa với số nhỏ). */
function PnlDelta({ cur, prev }: { cur: number; prev: number }) {
  const change = changeRatio(cur, prev);
  if (change == null || !Number.isFinite(change) || Math.abs(change) > 9.99 || cur * prev < 0) {
    return <span className="text-right text-xs text-slate-300">—</span>;
  }
  return (
    <span className={`text-right text-xs font-semibold tabular-nums ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
      {change >= 0 ? "+" : "−"}
      {Math.abs(change * 100).toFixed(1)}%
    </span>
  );
}

function PnlCostRow({
  label,
  value,
  color,
  revenue,
  maxCost,
  title,
  grid,
  compare,
}: {
  label: string;
  value: number;
  color: string;
  revenue: number;
  maxCost: number;
  title?: string;
  grid: string;
  /** Có khi so sánh: số kỳ trước (mờ) + % thay đổi, thay cho % doanh thu. */
  compare?: React.ReactNode;
}) {
  const mounted = useMounted();
  // Thanh so với khoản chi lớn nhất để dễ so sánh; % bên phải vẫn là % doanh thu.
  const width = maxCost > 0 ? Math.min(100, Math.max(0, (value / maxCost) * 100)) : 0;
  return (
    <div className={`${grid} border-b border-slate-100 py-2.5`} title={title}>
      <span className="truncate text-sm text-slate-700">{label}</span>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100/70">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: mounted ? `${Math.max(width, value > 0 ? 2 : 0)}%` : "0%", backgroundColor: color }}
        />
      </div>
      <span className="text-right text-sm font-semibold tabular-nums text-slate-800">{money(-value)}</span>
      {compare ?? (
        <span className="text-right text-xs tabular-nums text-slate-500">({ratioOrDash(value / (revenue || 1), revenue)})</span>
      )}
    </div>
  );
}

function PnlStatement({
  current,
  previous,
  periodLabel,
  compareLabel,
  onResetLatest,
  delay,
}: {
  current: DashboardTotals;
  previous: DashboardTotals | null;
  /** Ô đang xem trên biểu đồ, vd "Tuần 6/10 – 11/10". */
  periodLabel: string;
  compareLabel: string;
  /** Có khi đang xem một ô cũ hơn ô mới nhất. */
  onResetLatest?: () => void;
  delay: number;
}) {
  const revenue = current.revenue;
  const costs = costValues(current);
  const prevCosts = previous ? costValues(previous) : null;
  const maxCost = Math.max(0, ...Object.values(costs));
  const negative = current.profit < 0;
  const grid = previous ? PNL_GRID_CMP : PNL_GRID;
  // 2 ô cuối của dòng khi so sánh: số kỳ trước mờ + % thay đổi
  // cost = khoản chi: hiển thị số âm như các dòng chi phí
  const compareCells = (cur: number, prev: number, cost = false) => (
    <>
      <span className="text-right text-xs tabular-nums text-slate-400" title={compareLabel}>
        {money(cost ? -prev : prev)}
      </span>
      <PnlDelta cur={cur} prev={prev} />
    </>
  );

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">Profit &amp; Loss</h2>
          <p key={`${periodLabel}|${compareLabel}`} className="acc-rise mt-0.5 text-[13px] font-semibold text-indigo-600">
            {periodLabel}
            {previous && <span className="font-medium text-slate-500"> · vs {compareLabel}</span>}
          </p>
        </div>
        {onResetLatest && (
          <button
            type="button"
            onClick={onResetLatest}
            className="shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
          >
            Mới nhất
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-1 flex-col justify-center">
        <div className={`${grid} border-b border-slate-200 py-2.5`}>
          <span className="text-sm font-semibold text-slate-900">Revenue</span>
          <span />
          <span className={`text-right text-sm font-bold tabular-nums ${revenue < 0 ? "text-rose-600" : "text-slate-900"}`}>
            {money(revenue)}
          </span>
          {previous ? compareCells(revenue, previous.revenue) : <span />}
        </div>
        {COST_ITEMS.map((item) => (
          <PnlCostRow
            key={item.key}
            label={item.label}
            value={costs[item.key]}
            color={item.color}
            revenue={revenue}
            maxCost={maxCost}
            grid={grid}
            compare={prevCosts ? compareCells(costs[item.key], prevCosts[item.key], true) : undefined}
          />
        ))}
      </div>
      <div
        className={`mt-3 flex items-center justify-between rounded-xl px-4 py-3 transition-colors duration-300 ${
          negative ? "bg-rose-50" : "bg-emerald-50"
        }`}
      >
        <span className="text-[15px] font-bold text-slate-900">Profit</span>
        <span className={`flex items-center gap-2 tabular-nums ${negative ? "text-rose-600" : "text-emerald-600"}`}>
          <span className="text-lg font-bold">
            <AnimatedNumber value={current.profit} format={money} />
          </span>
          {previous ? (
            <>
              <span className="text-xs text-slate-400" title={compareLabel}>
                {money(previous.profit)}
              </span>
              <PnlDelta cur={current.profit} prev={previous.profit} />
            </>
          ) : (
            <span className="text-xs font-medium">({ratioOrDash(current.margin, revenue)})</span>
          )}
        </span>
      </div>
    </Card>
  );
}

// ---------- store table ----------

type StoreSortKey = "store" | "revenue" | "profit" | "margin" | "tacos" | "acos" | "orders" | "units";

const STORE_COLUMNS: { key: StoreSortKey; label: string }[] = [
  { key: "store", label: "Store" },
  { key: "revenue", label: "Revenue" },
  { key: "margin", label: "Margin" },
  { key: "tacos", label: "TACOS" },
  { key: "acos", label: "ACOS" },
  { key: "orders", label: "Orders" },
  { key: "units", label: "Units" },
  { key: "profit", label: "Profit" },
];

/** Profit: dương xanh, âm đỏ, 0 xám. */
const profitTone = (v: number) => (v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : "text-slate-500");

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
    case "orders":
      return c.orders;
    case "units":
      return c.quantity;
  }
}

function StoresPerformance({
  data,
  colorOf,
  onFocusStore,
  delay,
}: {
  data: AccountingDashboardData;
  colorOf: (storeId: string) => string;
  onFocusStore: (storeId: string) => void;
  delay: number;
}) {
  const mounted = useMounted();
  // Mặc định store lỗ nặng nhất lên đầu
  const [sort, setSort] = useState<{ key: StoreSortKey; dir: "asc" | "desc" }>({ key: "profit", dir: "asc" });
  const rows = useMemo(() => {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...data.byStore].sort((a, b) => {
      const av = storeSortValue(a, sort.key);
      const bv = storeSortValue(b, sort.key);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      if (typeof av === "string" || typeof bv === "string") return sign * String(av).localeCompare(String(bv));
      return sign * (av - bv) || b.current.revenue - a.current.revenue;
    });
  }, [data.byStore, sort]);
  const totalRevenue = data.current.revenue;
  const total = data.current;

  const toggleSort = (key: StoreSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "store" ? "asc" : "desc" }));

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <h2 className="text-lg font-bold text-slate-900">Stores Performance</h2>
      {/* Màn hẹp: danh sách thẻ thay cho bảng để không phải cuộn ngang */}
      <div className="mt-2 divide-y divide-slate-100 @min-[600px]:hidden">
        {rows.map((row) => {
          const c = row.current;
          const suspicious = c.adsFee > 0 && c.revenue <= 0;
          return (
            <button
              key={row.storeId}
              type="button"
              onClick={() => onFocusStore(row.storeId)}
              className="flex w-full cursor-pointer items-start justify-between gap-3 py-3 text-left transition-colors active:bg-indigo-50/50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(row.storeId) }} />
                  <span className="truncate text-[15px] font-semibold text-slate-900">{row.storeName}</span>
                  {suspicious && <WarningIcon size={14} weight="fill" className="shrink-0 text-amber-500" />}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[18px] text-xs tabular-nums text-slate-500">
                  <span>Rev {money(c.revenue)}</span>
                  <span>TACOS {ratioOrDash(c.tacos, c.revenue)}</span>
                  <span>ACOS {ratioOrDash(c.acos, c.revenueAds)}</span>
                  <span>{int.format(c.orders)} orders</span>
                  <span>{int.format(c.quantity)} units</span>
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
        <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              {STORE_COLUMNS.map((col, i) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`bg-slate-50 px-3 py-2 !text-[13px] !font-medium !tracking-normal !text-slate-600 ${
                      i === 0 ? "rounded-l-lg pl-4" : "text-right"
                    } ${i === STORE_COLUMNS.length - 1 ? "rounded-r-lg pr-4" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex cursor-pointer items-center gap-1 !text-[13px] !tracking-normal transition-colors hover:!text-slate-900 ${
                        active ? "!font-semibold !text-slate-900" : "!font-medium !text-slate-600"
                      }`}
                    >
                      {col.label}
                      <CaretDownIcon
                        size={10}
                        weight="bold"
                        className={`transition-all duration-200 ${active ? "opacity-100" : "opacity-0"} ${
                          active && sort.dir === "asc" ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const c = row.current;
              const share = totalRevenue > 0 ? c.revenue / totalRevenue : 0;
              const suspicious = c.adsFee > 0 && c.revenue <= 0;
              return (
                <tr
                  key={row.storeId}
                  onClick={() => onFocusStore(row.storeId)}
                  title={`View ${row.storeName} only`}
                  className="acc-rise cursor-pointer transition-colors duration-150 hover:bg-indigo-50/40"
                  style={{ animationDelay: `${delay + idx * 25}ms` }}
                >
                  <td className="border-b border-slate-100 py-2.5 pl-4 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(row.storeId) }} />
                      <span className="truncate font-semibold text-slate-900">{row.storeName}</span>
                      {suspicious && (
                        <span title={`Ad spend ${money(c.adsFee)} with no revenue — check ads mapping`}>
                          <WarningIcon size={14} weight="fill" className="text-amber-500" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right">
                    <div className="tabular-nums">{money(c.revenue)}</div>
                    <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-100 @min-[1100px]:w-28">
                      <div
                        className="h-full rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: mounted ? `${share * 100}%` : "0%", backgroundColor: colorOf(row.storeId) }}
                      />
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right">
                    {c.revenue <= 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="tabular-nums text-slate-900">{pct(c.margin)}</span>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{ratioOrDash(c.tacos, c.revenue)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{ratioOrDash(c.acos, c.revenueAds)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{int.format(c.orders)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{int.format(c.quantity)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 pr-4 text-right tabular-nums">
                    <span className={`font-bold ${profitTone(c.profit)}`}>{money(c.profit)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
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
                <td className="px-3 py-2.5 text-right">{int.format(total.orders)}</td>
                <td className="px-3 py-2.5 text-right">{int.format(total.quantity)}</td>
                <td className="rounded-r-lg px-3 py-2.5 pr-4 text-right text-[15px] !font-bold">{money(total.profit)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

// ---------- cost breakdown ----------

const PROFIT_SEGMENT = { key: "profit", label: "Profit", color: "#22c55e" } as const;

interface CostRow {
  id: string;
  name: string;
  totals: DashboardTotals;
  isTotal?: boolean;
}

/** 1 thanh = 100% doanh thu: các khoản chi + phần còn lại là Profit. Lỗ → chi phí vượt doanh thu, có vạch mốc doanh thu. */
function CostStructureBar({ totals }: { totals: DashboardTotals }) {
  const mounted = useMounted();
  const costs = costValues(totals);
  const costSum = COST_ITEMS.reduce((sum, c) => sum + Math.max(0, costs[c.key]), 0);
  const profit = Math.max(0, totals.revenue - costSum);
  const scale = Math.max(totals.revenue, costSum);
  const segments = [
    ...COST_ITEMS.map((c) => ({ key: c.key, color: c.color, value: Math.max(0, costs[c.key]) })),
    { key: PROFIT_SEGMENT.key, color: PROFIT_SEGMENT.color, value: profit },
  ].filter((seg) => seg.value > 0);
  const revenueMark = costSum > totals.revenue && scale > 0 ? (totals.revenue / scale) * 100 : null;
  return (
    <div className="relative h-3">
      <div
        className="flex h-full gap-[2px] overflow-hidden rounded-full bg-slate-100 transition-[clip-path] duration-700 ease-out"
        style={{ clipPath: mounted ? "inset(0 0 0 0)" : "inset(0 100% 0 0)" }}
      >
        {segments.map((seg) => (
          <div key={seg.key} className="h-full" style={{ flexGrow: seg.value, flexBasis: 0, backgroundColor: seg.color }} />
        ))}
      </div>
      {revenueMark != null && (
        <span
          className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-slate-900"
          style={{ left: `calc(${revenueMark}% - 1px)` }}
          aria-hidden
        />
      )}
    </div>
  );
}

function CostBreakdown({ data, delay }: { data: AccountingDashboardData; delay: number }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const storeRows: CostRow[] = data.byStore
    .filter((r) => r.current.revenue > 0)
    .sort((a, b) => b.current.revenue - a.current.revenue)
    .map((r) => ({ id: r.storeId, name: r.storeName, totals: r.current }));
  const idleStores = data.byStore.length - storeRows.length;
  const rows: CostRow[] = [
    ...(storeRows.length > 1 ? [{ id: "__total", name: "Total", totals: data.current, isTotal: true }] : []),
    ...storeRows,
  ];
  const legend = [...COST_ITEMS, PROFIT_SEGMENT];

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <h2 className="text-lg font-bold text-slate-900">Cost Breakdown</h2>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {legend.map((l) => (
          <span key={l.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.label}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 grid flex-1 place-items-center rounded-xl border border-dashed border-slate-200 py-10 text-[13px] text-slate-400">
          No revenue in this period
        </div>
      ) : (
        <div className="mt-3 flex-1 space-y-1">
          {rows.map((row) => {
            const t = row.totals;
            const costs = costValues(t);
            const open = hovered === row.id;
            return (
              <div
                key={row.id}
                tabIndex={0}
                onMouseEnter={() => setHovered(row.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(row.id)}
                onBlur={() => setHovered(null)}
                className={`relative grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-lg px-1.5 py-2 outline-none transition-colors ${
                  open ? "bg-slate-50" : ""
                } ${row.isTotal ? "mb-1 border-b border-slate-200 pb-3" : ""}`}
              >
                <span className={`truncate text-[13px] ${row.isTotal ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>
                  {row.name}
                </span>
                <CostStructureBar totals={t} />
                <span className={`text-right text-[13px] font-bold tabular-nums ${profitTone(t.margin)}`}>{pct(t.margin)}</span>

                {/* Chi tiết khi rê chuột: số tiền + % doanh thu từng khoản */}
                {open && (
                  <div className="pointer-events-none absolute left-1/4 top-full z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg">
                    <p className="mb-1.5 flex justify-between font-semibold text-slate-900">
                      <span className="truncate">{row.name}</span>
                      <span className="tabular-nums">{money(t.revenue)}</span>
                    </p>
                    {COST_ITEMS.map((c) => (
                      <div key={c.key} className="flex items-center justify-between gap-3 py-0.5">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c.color }} />
                          {c.label}
                        </span>
                        <span className="tabular-nums text-slate-900">
                          {money(-costs[c.key])}
                          <span className="ml-2 inline-block w-11 text-right text-slate-500">
                            {pct(t.revenue > 0 ? costs[c.key] / t.revenue : 0)}
                          </span>
                        </span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-slate-100 pt-1.5 font-semibold">
                      <span className="text-slate-900">Profit</span>
                      <span className={`tabular-nums ${profitTone(t.profit)}`}>
                        {money(t.profit)}
                        <span className="ml-2 inline-block w-11 text-right">{pct(t.margin)}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {idleStores > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {idleStores} store không có doanh thu trong kỳ
        </p>
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

function readSavedCompare(): DashboardCompareMode {
  if (typeof window === "undefined") return "none";
  try {
    const saved = localStorage.getItem(COMPARE_KEY);
    // Khi tải lại trang, biểu đồ mặc định ở chế độ tháng. Chỉ cần khôi phục trạng thái bật/tắt;
    // kỳ so sánh cụ thể luôn được suy ra từ chế độ ngày / tuần / tháng.
    return saved && saved !== "none" ? "month" : "none";
  } catch {
    return "none";
  }
}

export function AccountingDashboardView() {
  const maxDate = useMemo(() => getAmazonLatestAvailableDate(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(readSavedStoreIds);
  // Mỗi lần mở Dashboard luôn bắt đầu từ "This month"
  const [dateRange, setDateRange] = useState<DateRange>(() => getThisMonthDateRange(maxDate));
  const [compare, setCompare] = useState<DashboardCompareMode>(readSavedCompare);
  // Một bộ điều khiển chung: ngày / tuần / tháng quyết định cả cách gộp biểu đồ lẫn kỳ so sánh.
  const [granularity, setGranularity] = useState<ChartGranularity>("month");
  // Ô (ngày / tuần / tháng) đang xem trong P&L; null = ô mới nhất.
  const [pickedBucket, setPickedBucket] = useState<string | null>(null);
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

  const handleSelectStore = (storeId: string, team?: string | null) => {
    updateSelection([storeId]);
    persistTeam(team || null);
    setStoreMenuOpen(false);
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
  };

  // Tổng kết theo team: gom mọi store có team này (vd FBA 2 = EVERPHANT + FASTPEACE + LIMIMA).
  const handleSelectTeam = (team: string | null) => {
    persistTeam(team);
    updateSelection([]);
    setStoreMenuOpen(false);
  };

  const handleRangeChange = (next: DateRange) => setDateRange(next);

  const handleCompareChange = (next: DashboardCompareMode) => {
    setCompare(next);
    try {
      localStorage.setItem(COMPARE_KEY, next);
    } catch {
      // ignore
    }
  };

  const handleGranularityChange = (next: ChartGranularity) => {
    setGranularity(next);
    setPickedBucket(null);
    if (compare !== "none") handleCompareChange(compareModeFor(next));
  };

  const colorOf = useCallback(
    (storeId: string) => {
      const idx = stores.findIndex((s) => s.id === storeId);
      return STORE_COLORS[(idx < 0 ? 0 : idx) % STORE_COLORS.length];
    },
    [stores],
  );

  const kpis: KpiDef[] = useMemo(() => {
    if (!data) return [];
    const c = data.current;
    const p = data.previous;
    const ppDelta = (cur: number, prev: number | undefined, base: number | undefined) =>
      prev != null && base != null && base > 0 ? cur - prev : null;
    return [
      {
        id: "revenue",
        label: "Revenue",
        tone: TONES.green,
        value: c.revenue,
        format: money,
        ratio: changeRatio(c.revenue, p?.revenue),
      },
      {
        id: "orders",
        label: "Orders",
        tone: TONES.indigo,
        value: c.orders,
        format: (v) => int.format(Math.round(v)),
        ratio: changeRatio(c.orders, p?.orders),
      },
      {
        id: "profit",
        label: "Profit",
        tone: TONES.violet,
        value: c.profit,
        format: money,
        ratio: changeRatio(c.profit, p?.profit),
        negativeRed: true,
      },
      {
        id: "margin",
        label: "Margin",
        tone: TONES.rose,
        value: c.margin,
        format: (v) => pct(v),
        ratio: ppDelta(c.margin, p?.margin, p?.revenue),
        negativeRed: true,
      },
      {
        id: "ads",
        label: "Ad Spend",
        tone: TONES.blue,
        value: c.adsFee,
        format: money,
        ratio: changeRatio(c.adsFee, p?.adsFee),
      },
      {
        id: "tacos",
        label: "TACOS",
        tone: TONES.orange,
        value: c.tacos,
        format: (v) => pct(v),
        ratio: ppDelta(c.tacos, p?.tacos, p?.revenue),
      },
      {
        id: "acos",
        label: "ACOS",
        tone: TONES.cyan,
        value: c.acos,
        format: (v) => pct(v),
        ratio: ppDelta(c.acos, p?.acos, p?.revenueAds),
      },
    ];
  }, [data]);

  const allSelected = validSelectedIds.length === 0;
  const selectedStore =
    validSelectedIds.length === 1 ? stores.find((s) => s.id === validSelectedIds[0]) : null;
  // 1 dropdown: All Stores / từng store (kèm team của store) / tổng kết theo team
  const storeLabel = allSelected
    ? selectedTeam || "All Stores"
    : selectedStore
    ? selectedTeam
      ? `${selectedStore.name} • ${selectedTeam}`
      : selectedStore.name
    : `${validSelectedIds.length} stores`;
  const teams = listTeams(stores);
  // Biểu đồ và P&L dùng chung các ô đã gộp: P&L luôn tóm tắt đúng ô đang chọn trên biểu đồ.
  const buckets = useMemo(() => {
    if (!data) return [];
    // Theo tháng: luôn từ tháng 1 của năm (không chỉ các ngày trong khoảng đã chọn)
    if (granularity === "month" && data.trendStartDate && data.period.endDate && data.days) {
      return monthBuckets(data.days, data.trendStartDate, data.period.endDate, Boolean(data.previous));
    }
    return aggregateTrend(data.daily, granularity);
  }, [data, granularity]);
  const latestBucket = buckets.at(-1) ?? null;
  const selectedBucket = buckets.find((b) => b.key === pickedBucket) ?? latestBucket;
  const bucketPnl = useMemo(() => {
    if (!data || !selectedBucket) return null;
    const days = data.days ?? [];
    const { rangeStart, rangeEnd, compareRangeStart, compareRangeEnd } = selectedBucket;
    const hasCompare = Boolean(data.previous && compareRangeStart && compareRangeEnd);
    return {
      current: summarizeRange(days, rangeStart, rangeEnd),
      previous: hasCompare ? summarizeRange(days, compareRangeStart!, compareRangeEnd!) : null,
      periodLabel: `${GRANULARITY_UNIT[granularity]} ${bucketRangeLabel(rangeStart, rangeEnd)}`,
      compareLabel: hasCompare
        ? `${COMPARE_PERIOD_LABELS[granularity]} (${bucketRangeLabel(compareRangeStart!, compareRangeEnd!)})`
        : "",
    };
  }, [data, selectedBucket, granularity]);
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
              widthClass="w-64 sm:w-72"
              align="left"
              label={storeLabel}
              icon={
                selectedTeam ? (
                  <UsersThreeIcon size={15} weight="bold" className="text-indigo-600" />
                ) : (
                  <StorefrontIcon size={15} weight="bold" className="text-slate-400" />
                )
              }
              open={storeMenuOpen}
              setOpen={setStoreMenuOpen}
            >
              <div className="p-1 text-[13px]">
                {/* TOÀN BỘ CỬA HÀNG */}
                <MenuItem active={allSelected && !selectedTeam} onClick={handleSelectAll}>
                  <span className="font-semibold text-slate-800">All Stores</span>
                  <span className="ml-auto text-[11px] font-normal text-slate-400">
                    {stores.length} stores
                  </span>
                </MenuItem>

                <div className="my-1.5 h-px bg-slate-100" />

                {stores.map((s) => {
                  const storeTeams = parseStoreTeams(s.team);
                  const isMultiTeam = storeTeams.length > 1;
                  const isStoreActive = validSelectedIds.length === 1 && validSelectedIds[0] === s.id;

                  if (isMultiTeam) {
                    return (
                      <div key={s.id} className="group relative">
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
                            className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600"
                          />
                        </div>

                        {/* Flyout Submenu khi hover / chỉ vào store có nhiều team */}
                        <div className="absolute left-[calc(100%-4px)] top-0 z-50 hidden w-52 pl-2 group-hover:block group-focus-within:block">
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
                              {/* Dòng tổng của store ở trên, các team chi tiết bên dưới */}
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s.id) }} />
                                <span className="truncate font-semibold">{s.name}</span>
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

                {/* Tổng kết theo team: gom mọi store có team đó */}
                {teams.length > 0 && <div className="my-1.5 h-px bg-slate-100" />}
                {teams.map((t) => {
                  const count = stores.filter((s) => storeHasTeam(s.team, t)).length;
                  return (
                    <MenuItem key={t} active={allSelected && selectedTeam === t} onClick={() => handleSelectTeam(t)}>
                      <UsersThreeIcon size={13} weight="bold" className="shrink-0 text-indigo-500" />
                      <span className="truncate">{t}</span>
                      <span className="ml-auto shrink-0 text-[11px] font-normal text-slate-400">
                        {count} {count === 1 ? "store" : "stores"}
                      </span>
                    </MenuItem>
                  );
                })}
              </div>
            </DropdownShell>
            <div className="order-last w-full @min-[640px]:order-none @min-[640px]:w-auto">
              <PpcAmazonDatePicker value={dateRange} onChange={handleRangeChange} maxDate={maxDate} align="right" />
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
            <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4 @min-[1100px]:grid-cols-7">
              {kpis.map((kpi, i) => (
                <KpiCard key={kpi.id} kpi={kpi} delay={i * 30} showDelta={Boolean(data.previous)} />
              ))}
            </div>

            <div className="grid gap-4 @min-[900px]:grid-cols-3">
              <div className="min-w-0 @min-[900px]:col-span-2">
                <TrendChart
                  data={buckets}
                  selectedKey={selectedBucket?.key ?? null}
                  onSelect={setPickedBucket}
                  previousPeriod={data.previousPeriod}
                  controls={{
                    granularity,
                    onGranularityChange: handleGranularityChange,
                    compareOn: compare !== "none",
                    onToggleCompare: () => handleCompareChange(compare === "none" ? compareModeFor(granularity) : "none"),
                  }}
                  delay={120}
                />
              </div>
              <PnlStatement
                current={bucketPnl?.current ?? data.current}
                previous={bucketPnl ? bucketPnl.previous : data.previous}
                periodLabel={bucketPnl?.periodLabel ?? ""}
                compareLabel={bucketPnl?.compareLabel ?? ""}
                onResetLatest={
                  selectedBucket && latestBucket && selectedBucket.key !== latestBucket.key ? () => setPickedBucket(null) : undefined
                }
                delay={150}
              />
            </div>

            <div className="grid gap-4 @min-[900px]:grid-cols-3">
              <div className="min-w-0 @min-[900px]:col-span-2">
                <StoresPerformance
                  data={data}
                  colorOf={colorOf}
                  onFocusStore={(id) => updateSelection([id])}
                  delay={180}
                />
              </div>
              <CostBreakdown data={data} delay={210} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
