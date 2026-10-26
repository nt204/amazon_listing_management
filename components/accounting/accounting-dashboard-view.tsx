"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
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
  ChartLineUpIcon,
  CheckIcon,
  CoinsIcon,
  MegaphoneIcon,
  PercentIcon,
  PiggyBankIcon,
  StorefrontIcon,
  TargetIcon,
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
import type { DashboardCompareMode } from "@/lib/accounting/dashboard-periods";
import { PpcAmazonDatePicker, type DateRange } from "@/components/ppc/ppc-amazon-date-picker";
import { getAmazonLatestAvailableDate, getThisMonthDateRange } from "./financials-date-utils";

const STORE_IDS_KEY = "acc_dashboard_store_ids";
const RANGE_KEY = "acc_dashboard_range";
// v2: mặc định chuyển sang "No comparison", bỏ lựa chọn cũ đã lưu
const COMPARE_KEY = "acc_dashboard_compare_v2";

const STORE_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6", "#6366f1"];

const COMPARE_OPTIONS: { value: DashboardCompareMode; label: string }[] = [
  { value: "prev", label: "vs. Previous Period" },
  { value: "week", label: "vs. Previous Week" },
  { value: "month", label: "vs. Previous Month" },
  { value: "yoy", label: "vs. Last Year" },
  { value: "none", label: "No comparison" },
];

const SERIES = [
  { key: "revenue", label: "Revenue", color: "#3b82f6" },
  { key: "profit", label: "Profit", color: "#22c55e" },
  { key: "netProfit", label: "Net Profit", color: "#14b8a6" },
  { key: "adsFee", label: "Ad Spend", color: "#f59e0b" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

// Chuỗi có thể âm: phần dưới $0 tô đỏ để nhận ra ngày lỗ ngay.
const SIGNED_SERIES = new Set<SeriesKey>(["netProfit", "profit"]);
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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function shortDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(day)}`;
}

function longDate(d: string): string {
  return `${shortDate(d)}, ${d.slice(0, 4)}`;
}

function monthLabel(key: string, withYear: boolean): string {
  const [y, m] = key.split("-");
  return withYear ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : MONTHS[Number(m) - 1];
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

function DeltaPill({ ratio, inverse = false, points = false }: { ratio: number | null; inverse?: boolean; points?: boolean }) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return <span className="text-sm font-medium text-slate-400">—</span>;
  }
  const up = ratio >= 0;
  const good = inverse ? !up : up;
  const abs = Math.abs(ratio * 100).toFixed(1);
  return (
    <span
      title="vs. comparison period"
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
        good ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600"
      }`}
    >
      {up ? <ArrowUpRightIcon size={12} weight="bold" /> : <ArrowDownRightIcon size={12} weight="bold" />}
      {up ? "+" : "−"}
      {abs}
      {points ? " pp" : "%"}
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
        className={`flex cursor-pointer items-center justify-between gap-2 border border-slate-200 bg-white text-xs font-semibold text-slate-800 transition-colors hover:border-slate-300 ${
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
      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
        active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {active && <CheckIcon size={13} weight="bold" className="shrink-0" />}
    </button>
  );
}

// ---------- KPI ----------

interface KpiDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  tone: { from: string; tile: string; fg: string };
  value: number;
  format: (v: number) => string;
  ratio: number | null;
  points?: boolean;
  inverse?: boolean;
  negativeRed?: boolean;
}

const TONES = {
  green: { from: "from-emerald-50/90", tile: "bg-emerald-100/80", fg: "text-emerald-600" },
  violet: { from: "from-violet-50/90", tile: "bg-violet-100/80", fg: "text-violet-600" },
  rose: { from: "from-rose-50/90", tile: "bg-rose-100/80", fg: "text-rose-500" },
  blue: { from: "from-sky-50/90", tile: "bg-sky-100/80", fg: "text-sky-600" },
  orange: { from: "from-orange-50/90", tile: "bg-orange-100/80", fg: "text-orange-500" },
  cyan: { from: "from-cyan-50/70", tile: "bg-cyan-100/70", fg: "text-cyan-600" },
};

function KpiCard({ kpi, delay, showDelta }: { kpi: KpiDef; delay: number; showDelta: boolean }) {
  return (
    <Card
      delay={delay}
      className={`@container group bg-gradient-to-br ${kpi.tone.from} to-white p-3.5 transition-shadow duration-300 hover:shadow-lg @min-[190px]:p-4`}
    >
      {/* Thẻ hẹp (lưới 6 cột hoặc mobile nhỏ): icon và số nhỏ lại để không bị cắt */}
      <div className="flex items-start gap-2.5 @min-[190px]:gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${kpi.tone.tile} ${kpi.tone.fg} transition-transform duration-300 group-hover:scale-105 @min-[190px]:h-10 @min-[190px]:w-10`}
        >
          {kpi.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-600">{kpi.label}</div>
          <div
            className={`mt-0.5 truncate text-xl font-bold leading-tight tracking-tight tabular-nums @min-[190px]:text-[22px] ${
              kpi.negativeRed && kpi.value < 0 ? "text-rose-600" : "text-slate-900"
            }`}
          >
            <AnimatedNumber value={kpi.value} format={kpi.format} />
          </div>
          {showDelta && (
            <div className="mt-1.5">
              <DeltaPill ratio={kpi.ratio} inverse={kpi.inverse} points={kpi.points} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- trend chart ----------

const COMPARE_SHORT: Record<DashboardCompareMode, string> = {
  prev: "Previous Period",
  week: "Previous Week",
  month: "Previous Month",
  yoy: "Last Year",
  none: "Compare",
};

type ChartPoint = DashboardSeriesPoint & Partial<Record<`cmp_${SeriesKey}`, number>>;

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
        fontSize={10.5}
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
  daily,
  monthly,
  monthlyCompareShift,
  previousPeriod,
  compare,
  onCompareChange,
  delay,
}: {
  daily: DashboardSeriesPoint[];
  monthly: DashboardSeriesPoint[];
  monthlyCompareShift: number;
  previousPeriod: { startDate: string; endDate: string } | null;
  compare: DashboardCompareMode;
  onCompareChange: (mode: DashboardCompareMode) => void;
  delay: number;
}) {
  const mounted = useMounted();
  const [chartBoxRef, chartWidth] = useElementWidth<HTMLDivElement>();
  const [mode, setMode] = useState<"day" | "month">("day");
  const [compareOpen, setCompareOpen] = useState(false);
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    revenue: true,
    profit: true,
    netProfit: false,
    adsFee: false,
  });

  const data = mode === "day" ? daily : monthly;
  const chartData = useMemo<ChartPoint[]>(
    () =>
      data.map((p) =>
        p.compare
          ? {
              ...p,
              cmp_revenue: p.compare.revenue,
              cmp_netProfit: p.compare.netProfit,
              cmp_profit: p.compare.profit,
              cmp_adsFee: p.compare.adsFee,
            }
          : p,
      ),
    [data],
  );
  const hasCompare = data.some((p) => p.compare);
  const spansYears = new Set(monthly.map((p) => p.key.slice(0, 4))).size > 1;
  const pointMap = useMemo(() => new Map(data.map((p) => [p.key, p])), [data]);
  const splits = useMemo(
    () => ({ netProfit: zeroSplit(data.map((p) => p.netProfit)), profit: zeroSplit(data.map((p) => p.profit)) }),
    [data],
  );
  const formatTick = (key: string) => (mode === "day" ? shortDate(key) : monthLabel(key, spansYears));
  // ~1 nhãn mỗi 58px chiều ngang để số không chồng nhau trên màn hẹp
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor((chartWidth || 800) / 58))));
  const compareRangeLabel =
    mode === "day" && previousPeriod
      ? `${shortDate(previousPeriod.startDate)} – ${shortDate(previousPeriod.endDate)}`
      : monthlyCompareShift === 12
      ? "Same months last year"
      : "Previous month";

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">Revenue &amp; Profit</h2>
        <div className="flex items-center gap-2">
          <DropdownShell
            label={compare === "none" ? "Compare" : `vs. ${COMPARE_SHORT[compare]}`}
            open={compareOpen}
            setOpen={setCompareOpen}
            widthClass="w-48"
            variant="chip"
            align="left"
            icon={<span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />}
          >
            {COMPARE_OPTIONS.map((o) => (
              <MenuItem
                key={o.value}
                active={compare === o.value}
                onClick={() => {
                  onCompareChange(o.value);
                  setCompareOpen(false);
                }}
              >
                {o.label}
              </MenuItem>
            ))}
          </DropdownShell>
          <div className="relative grid grid-cols-2 rounded-full border border-slate-200 bg-white p-0.5 text-xs font-semibold">
            <span
              className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-indigo-100 ring-1 ring-indigo-200 transition-transform duration-300 ease-out"
              style={{ transform: mode === "month" ? "translateX(100%)" : "none" }}
            />
            {(["day", "month"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`relative z-10 cursor-pointer px-4 py-1 transition-colors duration-200 ${
                  mode === m ? "text-indigo-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {m === "day" ? "Daily" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">
        {SERIES.map((s) => {
          const on = visible[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
              className={`inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-opacity duration-200 ${
                on ? "text-slate-700" : "text-slate-400 opacity-60 hover:opacity-100"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: on ? s.color : "#cbd5e1" }} />
              {s.label}
            </button>
          );
        })}
        {hasCompare ? (
          <span className="acc-rise inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
            {compareRangeLabel}
          </span>
        ) : (
          mode === "month" &&
          compare !== "none" && <span className="text-xs text-slate-400">Monthly view compares by Month or Year</span>
        )}
      </div>

      <div ref={chartBoxRef} className="mt-2 h-[260px] w-full @min-[420px]:h-[300px] @min-[900px]:h-auto @min-[900px]:min-h-[300px] @min-[900px]:flex-1">
        {!mounted ? null : data.length === 0 ? (
          <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
            No data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart key={mode} data={chartData} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
              <defs>
                {SERIES.map((s) =>
                  SIGNED_SERIES.has(s.key) ? (
                    <g key={s.key}>
                      <linearGradient id={`trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor={s.color} stopOpacity={0.22} />
                        <stop offset={splits[s.key as "netProfit" | "profit"].fill} stopColor={s.color} stopOpacity={0.03} />
                        <stop offset={splits[s.key as "netProfit" | "profit"].fill} stopColor={NEGATIVE_COLOR} stopOpacity={0.03} />
                        <stop offset={1} stopColor={NEGATIVE_COLOR} stopOpacity={0.2} />
                      </linearGradient>
                      <linearGradient id={`stroke-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={splits[s.key as "netProfit" | "profit"].stroke} stopColor={s.color} />
                        <stop offset={splits[s.key as "netProfit" | "profit"].stroke} stopColor={NEGATIVE_COLOR} />
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
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
                padding={{ left: 16, right: 16 }}
                dy={6}
              />
              <YAxis
                tickFormatter={compactMoney}
                tick={{ fontSize: 11, fill: "#64748b" }}
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
                  const cmp = point.compare;
                  const tacos = point.revenue > 0 ? point.adsFee / point.revenue : 0;
                  const fmtKey = (k: string) => (mode === "day" ? longDate(k) : monthLabel(k, true));
                  return (
                    <div className="min-w-[200px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg">
                      <p className="mb-1.5 font-semibold text-slate-900">
                        {fmtKey(point.key)}
                        {cmp && <span className="font-normal text-slate-400"> vs {fmtKey(cmp.key)}</span>}
                      </p>
                      {SERIES.map((s) => {
                        const change = cmp ? changeRatio(point[s.key], cmp[s.key]) : null;
                        const good = s.key === "adsFee" ? (change ?? 0) <= 0 : (change ?? 0) >= 0;
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
                      <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-100 pt-1.5">
                        <span className="text-slate-500">TACOS</span>
                        <span className="font-semibold tabular-nums text-slate-900">{ratioOrDash(tacos, point.revenue)}</span>
                      </div>
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
                const flat = signed && splits[s.key as "netProfit" | "profit"].flat;
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

const COST_ITEMS = [
  { key: "basecost", label: "Base Cost", color: "#64748b" },
  { key: "amazonFee", label: "Amazon Fees", color: "#fb923c" },
  { key: "adsFee", label: "Ad Spend", color: "#8b5cf6" },
  { key: "taxOthers", label: "Tax & Others", color: "#f472b6" },
] as const;
type CostKey = (typeof COST_ITEMS)[number]["key"];

function costValues(t: DashboardTotals): Record<CostKey, number> {
  return {
    basecost: t.basecost,
    amazonFee: t.amazonFee,
    adsFee: t.adsFee,
    taxOthers: t.tax + t.promotion + t.returnCost,
  };
}

const PNL_GRID = "grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto_3.5rem] items-center gap-3";

function PnlCostRow({
  label,
  value,
  color,
  revenue,
  maxCost,
  title,
}: {
  label: string;
  value: number;
  color: string;
  revenue: number;
  maxCost: number;
  title?: string;
}) {
  const mounted = useMounted();
  // Thanh so với khoản chi lớn nhất để dễ so sánh; % bên phải vẫn là % doanh thu.
  const width = maxCost > 0 ? Math.min(100, Math.max(0, (value / maxCost) * 100)) : 0;
  return (
    <div className={`${PNL_GRID} border-b border-slate-100 py-2.5`} title={title}>
      <span className="truncate text-[13px] text-slate-700">{label}</span>
      <div className="h-3 overflow-hidden rounded-full bg-slate-100/70">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: mounted ? `${Math.max(width, value > 0 ? 2 : 0)}%` : "0%", backgroundColor: color }}
        />
      </div>
      <span className="text-right text-[13px] font-semibold tabular-nums text-slate-800">{money(-value)}</span>
      <span className="text-right text-[11px] tabular-nums text-slate-500">({ratioOrDash(value / (revenue || 1), revenue)})</span>
    </div>
  );
}

function PnlTotalRow({ label, value, revenue, showPct = false }: { label: string; value: number; revenue: number; showPct?: boolean }) {
  return (
    <div className={`${PNL_GRID} border-b border-slate-200 py-2.5`}>
      <span className="text-[13px] font-semibold text-slate-900">{label}</span>
      <span />
      <span className={`text-right text-[13px] font-bold tabular-nums ${value < 0 ? "text-rose-600" : "text-slate-900"}`}>
        {money(value)}
      </span>
      <span className="text-right text-[11px] tabular-nums text-slate-500">
        {showPct ? `(${ratioOrDash(value / (revenue || 1), revenue)})` : ""}
      </span>
    </div>
  );
}

function PnlStatement({ current, delay }: { current: DashboardTotals; delay: number }) {
  const revenue = current.revenue;
  const costs = costValues(current);
  const maxCost = Math.max(0, ...Object.values(costs));
  const negative = current.profit < 0;
  const row = (key: CostKey, title?: string) => {
    const item = COST_ITEMS.find((c) => c.key === key)!;
    return (
      <PnlCostRow
        label={item.label}
        value={costs[key]}
        color={item.color}
        revenue={revenue}
        maxCost={maxCost}
        title={title}
      />
    );
  };

  return (
    <Card delay={delay} className="flex h-full flex-col p-5">
      <h2 className="text-base font-bold text-slate-900">Profit &amp; Loss</h2>
      <div className="mt-2 flex flex-1 flex-col justify-center">
        <PnlTotalRow label="Revenue" value={revenue} revenue={revenue} />
        {row("basecost")}
        {row("amazonFee")}
        {row("adsFee")}
        {row(
          "taxOthers",
          `Tax ${money(current.tax)} · Promotions ${money(current.promotion)} · Returns ${money(current.returnCost)}`,
        )}
      </div>
      <div
        className={`mt-3 flex items-center justify-between rounded-xl px-4 py-3 transition-colors duration-300 ${
          negative ? "bg-rose-50" : "bg-emerald-50"
        }`}
      >
        <span className="text-sm font-bold text-slate-900">Profit</span>
        <span className={`flex items-baseline gap-2 tabular-nums ${negative ? "text-rose-600" : "text-emerald-600"}`}>
          <span className="text-base font-bold">
            <AnimatedNumber value={current.profit} format={money} />
          </span>
          <span className="text-[11px] font-medium">({ratioOrDash(current.margin, revenue)})</span>
        </span>
      </div>
      {current.serviceCost > 0 && (
        <p className="mt-2 px-1 text-right text-[11px] tabular-nums text-slate-500">
          After service fee {money(-current.serviceCost)}: {money(current.netProfit)}
        </p>
      )}
    </Card>
  );
}

// ---------- store table ----------

type StoreSortKey = "store" | "revenue" | "profit" | "margin" | "tacos" | "acos" | "units";

const STORE_COLUMNS: { key: StoreSortKey; label: string }[] = [
  { key: "store", label: "Store" },
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
  { key: "margin", label: "Margin" },
  { key: "tacos", label: "TACOS" },
  { key: "acos", label: "ACOS" },
  { key: "units", label: "Units" },
];

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
      <h2 className="text-base font-bold text-slate-900">Stores Performance</h2>
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
                  <span className="truncate text-sm font-semibold text-slate-900">{row.storeName}</span>
                  {suspicious && <WarningIcon size={14} weight="fill" className="shrink-0 text-amber-500" />}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-[18px] text-[11px] tabular-nums text-slate-500">
                  <span>Rev {money(c.revenue)}</span>
                  <span>TACOS {ratioOrDash(c.tacos, c.revenue)}</span>
                  <span>ACOS {ratioOrDash(c.acos, c.revenueAds)}</span>
                  <span>{int.format(c.quantity)} units</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`text-sm font-semibold tabular-nums ${c.profit < 0 ? "text-rose-600" : "text-slate-900"}`}>
                  {money(c.profit)}
                </div>
                <div className="mt-1 text-xs">
                  {c.revenue <= 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                        c.margin >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
                      }`}
                    >
                      {pct(c.margin)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {rows.length > 1 && (
          <div
            className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold tabular-nums ${
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
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              {STORE_COLUMNS.map((col, i) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`bg-slate-50 px-3 py-2 !text-xs !font-medium !tracking-normal !text-slate-600 ${
                      i === 0 ? "rounded-l-lg pl-4" : "text-right"
                    } ${i === STORE_COLUMNS.length - 1 ? "rounded-r-lg pr-4" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex cursor-pointer items-center gap-1 !text-xs !tracking-normal transition-colors hover:!text-slate-900 ${
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
                  <td className={`border-b border-slate-100 px-3 py-2.5 text-right tabular-nums ${c.profit < 0 ? "!font-semibold !text-rose-600" : ""}`}>
                    {money(c.profit)}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right">
                    {c.revenue <= 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                          c.margin >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
                        }`}
                      >
                        {pct(c.margin)}
                      </span>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{ratioOrDash(c.tacos, c.revenue)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-right tabular-nums">{ratioOrDash(c.acos, c.revenueAds)}</td>
                  <td className="border-b border-slate-100 px-3 py-2.5 pr-4 text-right tabular-nums">{int.format(c.quantity)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              {/* Dòng tổng nổi bật: xanh khi có lãi, đỏ khi lỗ */}
              <tr
                className={`text-xs font-semibold tabular-nums ${
                  total.profit < 0 ? "bg-rose-50 [&>td]:!text-rose-700" : "bg-emerald-50 [&>td]:!text-emerald-800"
                }`}
              >
                <td className="rounded-l-lg py-2.5 pl-4 pr-3">Total</td>
                <td className="px-3 py-2.5 text-right">{money(total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{money(total.profit)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.margin, total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.tacos, total.revenue)}</td>
                <td className="px-3 py-2.5 text-right">{ratioOrDash(total.acos, total.revenueAds)}</td>
                <td className="rounded-r-lg px-3 py-2.5 pr-4 text-right">{int.format(total.quantity)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

// ---------- cost breakdown ----------

function CostBreakdown({ current, delay }: { current: DashboardTotals; delay: number }) {
  const mounted = useMounted();
  const costs = costValues(current);
  const slices = COST_ITEMS.map((c) => ({ name: c.label, value: Math.max(0, costs[c.key]), fill: c.color })).filter(
    (s) => s.value > 0,
  );
  const totalCost = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card delay={delay} className="@container flex h-full flex-col p-5">
      <h2 className="text-base font-bold text-slate-900">Cost Breakdown</h2>
      {totalCost <= 0 ? (
        <div className="mt-3 grid flex-1 place-items-center rounded-xl border border-dashed border-slate-200 py-10 text-xs text-slate-400">
          No costs in this period
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-5 pt-3 @min-[360px]:flex-row">
          <div className="relative h-[180px] w-[180px] shrink-0">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    innerRadius="72%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={slices.length > 1 ? 1.5 : 0}
                    stroke="none"
                    isAnimationActive
                    animationDuration={650}
                    animationEasing="ease-out"
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-lg font-bold tabular-nums text-slate-900">
                  <AnimatedNumber value={totalCost} format={money} />
                </div>
                <div className="text-xs text-slate-500">Total Costs</div>
              </div>
            </div>
          </div>
          <div className="w-full flex-1 space-y-2">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.fill }} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-xs text-slate-500">{money(s.value)}</span>
                  <span className="w-12 text-right font-semibold text-slate-900">{pct(s.value / totalCost)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- skeleton ----------

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-3 @min-[1000px]:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
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

function readSavedRange(maxDate: string): DateRange {
  if (typeof window !== "undefined") {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(RANGE_KEY) || "null");
      if (parsed && typeof parsed.startDate === "string" && typeof parsed.endDate === "string") return parsed;
    } catch {
      // ignore
    }
  }
  return getThisMonthDateRange(maxDate);
}

function readSavedCompare(): DashboardCompareMode {
  if (typeof window === "undefined") return "none";
  try {
    const saved = localStorage.getItem(COMPARE_KEY);
    return COMPARE_OPTIONS.some((o) => o.value === saved) ? (saved as DashboardCompareMode) : "none";
  } catch {
    return "none";
  }
}

export function AccountingDashboardView() {
  const maxDate = useMemo(() => getAmazonLatestAvailableDate(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(readSavedStoreIds);
  const [dateRange, setDateRange] = useState<DateRange>(() => readSavedRange(maxDate));
  const [compare, setCompare] = useState<DashboardCompareMode>(readSavedCompare);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [compareMenuOpen, setCompareMenuOpen] = useState(false);
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
  const selectionKey = validSelectedIds.join(",");
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
    if (selectionKey) params.set("store_ids", selectionKey);
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

  const toggleStore = (id: string) => {
    const base = validSelectedIds;
    updateSelection(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };

  const handleRangeChange = (next: DateRange) => {
    setDateRange(next);
    try {
      sessionStorage.setItem(RANGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleCompareChange = (next: DashboardCompareMode) => {
    setCompare(next);
    setCompareMenuOpen(false);
    try {
      localStorage.setItem(COMPARE_KEY, next);
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
        icon: <CoinsIcon size={20} weight="duotone" />,
        tone: TONES.green,
        value: c.revenue,
        format: money,
        ratio: changeRatio(c.revenue, p?.revenue),
      },
      {
        id: "profit",
        label: "Profit",
        icon: <PiggyBankIcon size={20} weight="duotone" />,
        tone: TONES.violet,
        value: c.profit,
        format: money,
        ratio: changeRatio(c.profit, p?.profit),
        negativeRed: true,
      },
      {
        id: "margin",
        label: "Margin",
        icon: <ChartLineUpIcon size={20} weight="duotone" />,
        tone: TONES.rose,
        value: c.margin,
        format: (v) => pct(v),
        ratio: ppDelta(c.margin, p?.margin, p?.revenue),
        points: true,
        negativeRed: true,
      },
      {
        id: "ads",
        label: "Ad Spend",
        icon: <MegaphoneIcon size={20} weight="duotone" />,
        tone: TONES.blue,
        value: c.adsFee,
        format: money,
        ratio: changeRatio(c.adsFee, p?.adsFee),
        inverse: true,
      },
      {
        id: "tacos",
        label: "TACOS",
        icon: <PercentIcon size={20} weight="duotone" />,
        tone: TONES.orange,
        value: c.tacos,
        format: (v) => pct(v),
        ratio: ppDelta(c.tacos, p?.tacos, p?.revenue),
        points: true,
        inverse: true,
      },
      {
        id: "acos",
        label: "ACOS",
        icon: <TargetIcon size={20} weight="duotone" />,
        tone: TONES.cyan,
        value: c.acos,
        format: (v) => pct(v),
        ratio: ppDelta(c.acos, p?.acos, p?.revenueAds),
        points: true,
        inverse: true,
      },
    ];
  }, [data]);

  const allSelected = validSelectedIds.length === 0;
  const storeLabel = allSelected
    ? "All Stores"
    : validSelectedIds.length === 1
    ? stores.find((s) => s.id === validSelectedIds[0])?.name || "1 store"
    : `${validSelectedIds.length} stores`;
  const compareLabel = COMPARE_OPTIONS.find((o) => o.value === compare)?.label || "No comparison";
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
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
          {/* Hẹp: [Stores][Compare][↻] rồi khoảng ngày một hàng riêng; rộng: một hàng */}
          <div className="flex w-full flex-wrap items-center gap-2 @min-[640px]:w-auto">
            <DropdownShell
              className="min-w-0 flex-1 @min-[640px]:flex-none"
              align="left"
              label={storeLabel}
              icon={<StorefrontIcon size={15} weight="bold" className="text-slate-400" />}
              open={storeMenuOpen}
              setOpen={setStoreMenuOpen}
            >
              <MenuItem active={allSelected} onClick={() => updateSelection([])}>
                All Stores
              </MenuItem>
              <div className="my-1 h-px bg-slate-100" />
              {stores.map((s) => (
                <MenuItem key={s.id} active={validSelectedIds.includes(s.id)} onClick={() => toggleStore(s.id)}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(s.id) }} />
                  <span className="truncate">{s.name}</span>
                </MenuItem>
              ))}
            </DropdownShell>
            <div className="order-last w-full @min-[640px]:order-none @min-[640px]:w-auto">
              <PpcAmazonDatePicker value={dateRange} onChange={handleRangeChange} maxDate={maxDate} align="right" />
            </div>
            <DropdownShell
              className="min-w-0 flex-1 @min-[640px]:flex-none"
              label={compareLabel}
              open={compareMenuOpen}
              setOpen={setCompareMenuOpen}
              widthClass="w-48"
            >
              {COMPARE_OPTIONS.map((o) => (
                <MenuItem key={o.value} active={compare === o.value} onClick={() => handleCompareChange(o.value)}>
                  {o.label}
                </MenuItem>
              ))}
            </DropdownShell>
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
          <div className="acc-rise flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
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
            <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-3 @min-[1000px]:grid-cols-6">
              {kpis.map((kpi, i) => (
                <KpiCard key={kpi.id} kpi={kpi} delay={i * 30} showDelta={Boolean(data.previous)} />
              ))}
            </div>

            <div className="grid gap-4 @min-[900px]:grid-cols-3">
              <div className="min-w-0 @min-[900px]:col-span-2">
                <TrendChart
                  daily={data.daily}
                  monthly={data.monthly}
                  monthlyCompareShift={data.monthlyCompareShift ?? 0}
                  previousPeriod={data.previousPeriod}
                  compare={compare}
                  onCompareChange={handleCompareChange}
                  delay={120}
                />
              </div>
              <PnlStatement current={data.current} delay={150} />
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
              <CostBreakdown current={data.current} delay={210} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
