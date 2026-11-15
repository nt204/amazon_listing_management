"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CurrencyDollarIcon,
  MegaphoneIcon,
  PercentIcon,
  TrendUpIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { WeeklyMetrics, WeeklyReport, WeeklyBrandRow } from "@/lib/accounting/weekly-report";
import {
  daysInMonthOf,
  nextWeekSegment,
  previousWeekSegment,
  recentWeekSegments,
} from "@/lib/accounting/weekly-report-periods";
import { kpiRatio, kpiTone } from "@/lib/accounting/kpi-progress";
import { AccountingModuleSkeleton, AccountingTopProgressBar } from "./accounting-skeleton";

// BÁO CÁO TUẦN — mỗi khối 1 nhiệm vụ:
//   1 Tổng quan (kết quả thế nào?) → 2 Tiến độ tháng (đạt mục tiêu chưa?) → 3 Team (ai đóng góp / có vấn đề?)
//   → 4 Brand (nguyên nhân ở đâu?) → 5 SKU Test → 6 Tồn kho & dòng tiền (việc vận hành cần xử lý).
// Công thức như file "BÁO CÁO TUẦN TỔNG HỢP":
//   % WoW = (này − trước) ÷ |trước| (cả Biên LN, TACoS)
//   Kế hoạch tới nay = MT kỳ × ngày đã có số liệu ÷ số ngày kỳ; Nhịp = thực đạt ÷ kế hoạch tới nay
//   ≥100% Vượt/đạt nhịp · ≥85% Sát nhịp · còn lại Dưới nhịp; team: THƯỞNG / ĐẠT / PHÊ BÌNH (theo nhịp Profit tháng)
//   Biên LN so với MT Biên LN = MT Profit ÷ MT Revenue
//   Tồn kho: file chỉ có > 30 tuần Ứ vốn, > 20 tuần Theo dõi; bổ sung Hết hàng / Không bán / Sắp hết (< 4 tuần).

const usd = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v < 0
    ? `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const usd2 = (v: number | null | undefined) => usd(v, 2);

/** $54.8k */
const usdK = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? "-" : ""}$${s}`;
};


const int = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

const div = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(b) > 1e-9 ? a / b : null;

/** % WoW như file: (này − trước) ÷ |trước| */
const wow = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur != null && prev != null && Math.abs(prev) > 1e-9 ? (cur - prev) / Math.abs(prev) : null;

const vnDate = (iso: string) => {
  if (!iso || iso.length < 10) return iso;
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
};

const ZERO: WeeklyMetrics = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };
const add = (a: WeeklyMetrics, b: WeeklyMetrics): WeeklyMetrics => ({
  revenue: a.revenue + b.revenue,
  quantity: a.quantity + b.quantity,
  adsFee: a.adsFee + b.adsFee,
  profit: a.profit + b.profit,
  basecost: a.basecost + b.basecost,
});

const ratiosOf = (m: WeeklyMetrics) => ({
  tacos: div(m.adsFee, m.revenue),
  roi: div(m.profit, m.basecost),
  margin: div(m.profit, m.revenue),
});

// Màu team cố định (theo team, không theo thứ hạng) — chỉ dùng ở chấm / chữ tên team, đủ đậm để đọc
const TEAM_COLORS = ["#1d4ed8", "#c2410c", "#047857", "#6d28d9", "#be185d", "#166534"];
function teamColor(team: string): string {
  if (team === "FBM") return TEAM_COLORS[0];
  const n = Number(team.match(/(\d+)/)?.[1]);
  return Number.isFinite(n) && n >= 1 ? TEAM_COLORS[((n - 1) % (TEAM_COLORS.length - 1)) + 1] : "#898781";
}
const NEG = "#e34948";

export function WeeklyReportView() {
  const [date, setDate] = useState("");
  const [latestSeen, setLatestSeen] = useState("");
  const [data, setData] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedStoreKey, setSelectedStoreKey] = useState<string>("all");
  const requestKey = `${date}:${reloadKey}`;

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const q = date ? `?date=${encodeURIComponent(date)}` : "";
    fetch(`/api/accounting/financials/weekly-report${q}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Không tải được báo cáo tuần.");
        return body as WeeklyReport;
      })
      .then((body) => {
        if (ignore) return;
        setData(body);
        setError(null);
        if (body.week.endDate >= body.dataThrough) {
          setLatestSeen((prev) => (!prev || body.dataThrough > prev ? body.dataThrough : prev));
        }
      })
      .catch((e: Error) => {
        if (!ignore) setError({ key: requestKey, message: e.message });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [date, reloadKey, requestKey]);

  const weeks = useMemo(() => recentWeekSegments(latestSeen || date, 52), [latestSeen, date]);
  const week = data?.week;
  const canNext = week && latestSeen ? nextWeekSegment(week).startDate <= latestSeen : false;

  if (!data && loading) {
    return <AccountingModuleSkeleton title="Đang tải dữ liệu tuần..." cardsCount={4} />;
  }

  const isCurrentWeek = Boolean(data && data.dataThrough < data.week.endDate);
  const ctrl =
    "h-8 rounded-lg border border-slate-200 bg-white text-[13px] !text-slate-800 shadow-2xs transition hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 disabled:opacity-40";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-100/70 font-accounting-system">
      <AccountingTopProgressBar loading={loading} variant="amber" />

      {/* Header 1 hàng: tiêu đề | tuần | store | trạng thái số liệu | làm mới */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="mr-1 text-xl font-bold tracking-tight !text-slate-900">Báo cáo tuần</h1>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Tuần trước"
              disabled={!week || loading}
              onClick={() => week && setDate(previousWeekSegment(week).startDate)}
              className={`${ctrl} flex w-8 cursor-pointer items-center justify-center !text-slate-600`}
            >
              <CaretLeftIcon size={14} weight="bold" />
            </button>
            <label className={`${ctrl} flex items-center gap-1.5 px-2.5 focus-within:border-slate-500`}>
              <CalendarBlankIcon size={14} className="!text-slate-500" />
              <select
                aria-label="Chọn tuần"
                className="cursor-pointer bg-transparent pr-1 font-semibold outline-none"
                value={week?.startDate ?? ""}
                onChange={(e) => setDate(e.target.value)}
              >
                {week && !weeks.some((w) => w.startDate === week.startDate) && (
                  <option value={week.startDate}>{week.label}</option>
                )}
                {weeks.map((w) => (
                  <option key={w.startDate} value={w.startDate}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Tuần sau"
              disabled={!canNext || loading}
              onClick={() => week && setDate(nextWeekSegment(week).startDate)}
              className={`${ctrl} flex w-8 cursor-pointer items-center justify-center !text-slate-600`}
            >
              <CaretRightIcon size={14} weight="bold" />
            </button>
          </div>

          {data && (
            <select
              aria-label="Lọc theo Store"
              value={selectedStoreKey}
              onChange={(e) => setSelectedStoreKey(e.target.value)}
              className={`${ctrl} cursor-pointer px-2.5`}
            >
              <option value="all">Tất cả Store ({data.brands.length})</option>
              {data.brands.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          )}

          {data && (
            <span className="flex items-center gap-1.5 text-xs !text-slate-500">
              {data.week.days < 7 && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium !text-indigo-700" title="Tuần bị cắt ở ranh giới tháng">
                  Tuần giao tháng · {data.week.days} ngày
                </span>
              )}
              {isCurrentWeek ? (
                <span className="rounded-md bg-amber-100 px-2.5 py-1 text-[13px] font-semibold !text-amber-900">
                  Đang chạy · số liệu đến {vnDate(data.dataThrough)} ({data.days}/{data.week.days} ngày)
                </span>
              ) : (
                <span>Đã chốt</span>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className={`${ctrl} ml-auto flex cursor-pointer items-center gap-1.5 px-3 font-medium`}
          >
            <ArrowClockwiseIcon size={13} className={loading ? "animate-spin" : ""} />
            Làm mới
          </button>
        </div>
      </header>

      <div className={`flex-1 overflow-y-auto px-4 py-5 transition-opacity md:px-6 ${loading ? "opacity-60" : ""}`}>
        {error && (
          <div role="alert" className="mx-auto mb-4 max-w-[1440px] rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] !text-rose-700">
            {error.message}
          </div>
        )}
        {data &&
          (data.brands.length === 0 ? (
            <div className="mx-auto max-w-[1440px] rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm !text-slate-500">
              Tuần {data.week.label} chưa có số liệu SKU WIN.
            </div>
          ) : (
            <WeeklyDashboardBody data={data} selectedStoreKey={selectedStoreKey} />
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TÍNH TIẾN ĐỘ
// ---------------------------------------------------------------------------

interface Achieve {
  actual: number;
  /** Kế hoạch tới ngày có số liệu */
  due: number;
  /** Mục tiêu cả kỳ */
  full: number;
  /** Nhịp = actual ÷ due */
  ratio: number | null;
  /** actual ÷ full */
  fullRatio: number | null;
  elapsed: number;
  total: number;
  daysLeft: number;
  ratePerDay: number;
  needPerDay: number | null;
}

interface MetricProgress {
  week: Achieve;
  month: Achieve;
}

interface GroupSummary {
  cur: WeeklyMetrics;
  prev: WeeklyMetrics;
  mtd: WeeklyMetrics;
  rows: number;
  targetedRows: number;
  revenue: MetricProgress | null;
  profit: MetricProgress | null;
}

interface PaceContext {
  dim: number;
  day: number;
  weekElapsed: number;
  weekDays: number;
}

function periodOf(actual: number, target: number, elapsed: number, total: number): Achieve {
  const e = Math.max(1, Math.min(elapsed, total));
  const due = (target * e) / total;
  const daysLeft = Math.max(0, total - e);
  return {
    actual,
    due,
    full: target,
    ratio: kpiRatio(actual, due),
    fullRatio: kpiRatio(actual, target),
    elapsed: e,
    total,
    daysLeft,
    ratePerDay: actual / e,
    needPerDay: daysLeft > 0 ? Math.max(0, target - actual) / daysLeft : null,
  };
}

function summarize(rows: WeeklyBrandRow[], ctx: PaceContext): GroupSummary {
  const sum = (pick: (b: WeeklyBrandRow) => WeeklyMetrics) => rows.reduce((s, b) => add(s, pick(b)), ZERO);
  const targeted = rows.filter((b) => b.target);
  const cur = sum((b) => b.current);
  const mtd = sum((b) => b.mtd);
  const progress = (k: "revenue" | "profit"): MetricProgress | null => {
    if (!targeted.length) return null;
    const monthTarget = targeted.reduce((s, b) => s + b.target![k], 0);
    return {
      week: periodOf(cur[k], (monthTarget * ctx.weekDays) / ctx.dim, ctx.weekElapsed, ctx.weekDays),
      month: periodOf(mtd[k], monthTarget, ctx.day, ctx.dim),
    };
  };
  return {
    cur,
    prev: sum((b) => b.previous),
    mtd,
    rows: rows.length,
    targetedRows: targeted.length,
    revenue: progress("revenue"),
    profit: progress("profit"),
  };
}

/** Không phát sinh: tuần này không có revenue / profit và cả tháng chưa có revenue */
const isIdle = (s: GroupSummary) => s.cur.revenue === 0 && s.mtd.revenue === 0 && s.cur.profit === 0;

type Tone = "good" | "near" | "bad";
const TONE_TEXT: Record<Tone, string> = { good: "!text-emerald-700", near: "!text-amber-700", bad: "!text-rose-600" };
/** Chữ % nhịp: đạt xanh, sát nhịp đen, dưới nhịp đỏ */
const PACE_TEXT: Record<Tone, string> = { good: "!text-emerald-700", near: "!text-slate-900", bad: "!text-rose-600" };
const TONE_HEX: Record<Tone, string> = { good: "#059669", near: "#d97706", bad: "#e11d48" };
const TONE_SOLID: Record<Tone, string> = {
  good: "bg-emerald-600 !text-white",
  near: "bg-amber-500 !text-white",
  bad: "bg-rose-600 !text-white",
};
const PACE_LABEL: Record<Tone, string> = { good: "Vượt/đạt nhịp", near: "Sát nhịp", bad: "Dưới nhịp" };
const TEAM_LABEL: Record<Tone, string> = { good: "THƯỞNG", near: "ĐẠT", bad: "PHÊ BÌNH" };

// ---------------------------------------------------------------------------
// NỘI DUNG CHÍNH
// ---------------------------------------------------------------------------

type TeamGroup = { team: string; color: string; summary: GroupSummary; brands: { b: WeeklyBrandRow; s: GroupSummary }[] };

function groupTeams(rows: WeeklyBrandRow[], ctx: PaceContext): TeamGroup[] {
  const byTeam = new Map<string, WeeklyBrandRow[]>();
  for (const b of rows) byTeam.set(b.team, [...(byTeam.get(b.team) ?? []), b]);
  return Array.from(byTeam, ([team, list]) => ({
    team,
    color: teamColor(team),
    summary: summarize(list, ctx),
    brands: list.map((b) => ({ b, s: summarize([b], ctx) })),
  }));
}

type SkuGroup = "all" | "win" | "test";
const SKU_GROUP_TAG: Record<SkuGroup, string> = { all: "ALL SKU", win: "SKU WIN", test: "SKU TEST" };

const sumTarget = (a: WeeklyBrandRow["target"], b: WeeklyBrandRow["target"]): WeeklyBrandRow["target"] =>
  a || b ? { revenue: (a?.revenue ?? 0) + (b?.revenue ?? 0), profit: (a?.profit ?? 0) + (b?.profit ?? 0) } : null;

/** Dòng brand theo nhóm SKU: Win = số gốc; Test = row.test; All = Win + Test (cả mục tiêu) */
function brandOfGroup(b: WeeklyBrandRow, g: SkuGroup): WeeklyBrandRow {
  if (g === "win") return b;
  const t = b.test ?? { current: ZERO, previous: ZERO, mtd: ZERO, target: null };
  if (g === "test") return { ...b, current: t.current, previous: t.previous, mtd: t.mtd, target: t.target };
  return {
    ...b,
    current: add(b.current, t.current),
    previous: add(b.previous, t.previous),
    mtd: add(b.mtd, t.mtd),
    target: sumTarget(b.target, t.target),
  };
}

function WeeklyDashboardBody({ data, selectedStoreKey }: { data: WeeklyReport; selectedStoreKey: string }) {
  const { week, brands } = data;
  const selectedStoreId = selectedStoreKey === "all" ? null : selectedStoreKey.split("|")[0];

  const visibleBrands = useMemo(
    () => (selectedStoreKey === "all" ? brands : brands.filter((b) => b.key === selectedStoreKey)),
    [brands, selectedStoreKey],
  );
  const tests = selectedStoreId ? data.tests.filter((t) => t.storeId === selectedStoreId) : data.tests;
  const stock = selectedStoreId ? data.stock.filter((s) => s.storeId === selectedStoreId) : data.stock;
  const payout = data.payout;

  const dim = daysInMonthOf(week.startDate);
  // Mọi tiến độ dùng chung 1 mốc: ngày cuối có số liệu của tuần đang xem (tuần tháng 10 → nhịp tháng 10)
  const ctx: PaceContext = useMemo(
    () => ({
      dim,
      day: Number(data.dataThrough.slice(8, 10)),
      weekElapsed: Math.max(1, data.days || 1),
      weekDays: week.days || 7,
    }),
    [dim, data.dataThrough, data.days, week.days],
  );

  const total = useMemo(() => summarize(visibleBrands, ctx), [visibleBrands, ctx]);
  const teams: TeamGroup[] = useMemo(() => groupTeams(visibleBrands, ctx), [visibleBrands, ctx]);

  // Bảng brand: chọn All / Win / Test (Win / Test chia như trang KPI kinh doanh — server đã tách sẵn)
  const [skuGroup, setSkuGroup] = useState<SkuGroup>("win");
  const groupBrands = useMemo(() => visibleBrands.map((b) => brandOfGroup(b, skuGroup)), [visibleBrands, skuGroup]);
  const brandTotal = useMemo(() => (skuGroup === "win" ? total : summarize(groupBrands, ctx)), [skuGroup, total, groupBrands, ctx]);
  const brandTeams = useMemo(() => (skuGroup === "win" ? teams : groupTeams(groupBrands, ctx)), [skuGroup, teams, groupBrands, ctx]);

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const brandRef = useRef<HTMLElement>(null);
  const activeTeam = teamFilter && teams.some((t) => t.team === teamFilter) ? teamFilter : null;
  const pickTeam = (team: string) => {
    setTeamFilter((cur) => (cur === team ? null : team));
    brandRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Cảnh báo dữ liệu: brand có phát sinh nhưng chưa có KPI vẫn cộng vào thực đạt → % KPI có thể cao hơn thực tế
  const untargeted = teams.flatMap((t) => t.brands.filter((r) => !r.b.target && !isIdle(r.s)).map((r) => r.b.label));
  const multiTeam = selectedStoreKey === "all" && teams.length > 1;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-7">
      <Section title="Tổng quan" right={untargeted.length > 0 ? <UntargetedNote names={untargeted} /> : null}>
        <KpiTiles total={total} dataThrough={data.dataThrough} />
      </Section>

      {multiTeam && (
        <Section title="Kết quả theo team" theme="violet">
          <TeamTable teams={teams} total={total} activeTeam={activeTeam} onPick={pickTeam} />
        </Section>
      )}

      <Section title="Kinh doanh theo brand" tag={SKU_GROUP_TAG[skuGroup]} theme="blue">
        <BrandPanel
          sectionRef={brandRef}
          teams={brandTeams}
          total={brandTotal}
          skuGroup={skuGroup}
          onSkuGroup={setSkuGroup}
          totalLabel={selectedStoreKey === "all" ? "TỔNG" : "Tổng"}
          activeTeam={activeTeam}
          onClearTeam={() => setTeamFilter(null)}
        />
      </Section>

      {tests.length > 0 && (
        <Section title="Hiệu quả SKU Test" tag="SKU TEST" theme="teal">
          <TestBlock tests={tests} />
        </Section>
      )}

      {(stock.length > 0 || payout) && (
        <div className={`grid gap-7 ${stock.length > 0 && payout ? "xl:grid-cols-12" : ""}`}>
          {stock.length > 0 && (
            <div className={payout ? "xl:col-span-7" : ""}>
              <Section title="Tồn kho Amazon" theme="amber">
                <StockBlock stock={stock} days={data.days} />
              </Section>
            </div>
          )}
          {payout && (
            <div className={stock.length > 0 ? "xl:col-span-5" : ""}>
              <Section title="Dòng tiền" tag="Payment" theme="green">
                <PayoutBlock payout={payout} />
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DÙNG CHUNG
// ---------------------------------------------------------------------------

// Mỗi khu vực 1 màu nhận diện: vạch tiêu đề, viền trên thẻ, header bảng, dòng TỔNG cùng tông → nhìn là biết đang đọc bảng nào.
// Màu trạng thái (xanh đạt / cam sát / đỏ dưới) dùng riêng cho ô KPI, không trùng vai trò với màu khu vực.
type ThemeKey = "indigo" | "sky" | "violet" | "blue" | "teal" | "amber" | "green";
interface Theme {
  bar: string;
  tag: string;
  card: string;
  /** Header bảng: nền đậm, chữ trắng */
  th: string;
  /** Hàng nhóm cột phía trên header */
  thGroup: string;
  total: string;
  hover: string;
  /** Sọc dòng theo màu khu vực (dòng lẻ) */
  stripe: string;
  stripeEven: string;
}
// Cả tab Week dùng chung 1 tông indigo (sáng): header indigo-500, nhóm cột indigo-600, TỔNG indigo nhạt
const INDIGO: Theme = {
  bar: "bg-indigo-500",
  tag: "bg-indigo-100 !text-indigo-700",
  card: "border-t-[#FF8C00]",
  th: "bg-[#FF8C00] !text-black border-b-2 border-[#D97300]",
  thGroup: "bg-[#FF8C00] !text-black",
  total: "bg-[#FFE0B2] !text-black border-t-2 border-[#FF8C00]",
  hover: "hover:bg-orange-50",
  stripe: "bg-slate-50",
  stripeEven: "even:bg-slate-50",
};
const THEMES: Record<ThemeKey, Theme> = {
  indigo: INDIGO,
  sky: INDIGO,
  violet: INDIGO,
  blue: INDIGO,
  teal: INDIGO,
  amber: INDIGO,
  green: INDIGO,
};
const ThemeCtx = createContext<Theme>(THEMES.indigo);
const useTheme = () => useContext(ThemeCtx);

/** Tiêu đề section: vạch màu của khu vực, không đánh số */
function Section({
  title,
  tag,
  right,
  theme = "indigo",
  children,
}: {
  title: string;
  tag?: string;
  right?: ReactNode;
  theme?: ThemeKey;
  children: ReactNode;
}) {
  const t = THEMES[theme];
  return (
    <ThemeCtx.Provider value={t}>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold !text-slate-900">
            <span className={`h-5 w-1.5 rounded-full ${t.bar}`} />
            {title}
            {tag && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${t.tag}`}>{tag}</span>}
          </h2>
          {right}
        </div>
        {children}
      </section>
    </ThemeCtx.Provider>
  );
}

/** Nút nhỏ "N brand chưa có KPI" — bấm mới hiện danh sách */
function UntargetedNote({ names }: { names: string[] }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[13px] font-semibold !text-amber-900 hover:bg-amber-100 [&::-webkit-details-marker]:hidden">
        <WarningIcon size={14} weight="bold" />
        {names.length} brand chưa có KPI
        <CaretDownIcon size={11} weight="bold" className="transition group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-3 text-[13px] !text-slate-700 shadow-lg">
        <p className="mb-2 !text-slate-600">Vẫn được cộng vào thực đạt, nên % đạt KPI tổng có thể cao hơn thực tế.</p>
        <ul className="space-y-1">
          {names.map((n) => (
            <li key={n} className="font-semibold !text-slate-900">
              {n}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const CARD = "rounded-xl border border-slate-200 bg-white";
/** Thẻ chứa bảng: viền trên 4px theo màu khu vực */
const tableCard = (t: Theme) => `${CARD} border-t-4 ${t.card} overflow-hidden shadow-sm`;
/** Header bảng theo màu khu vực */
const thCls = (t: Theme) => `${t.th} px-3 py-2.5 text-right text-[12.5px] font-bold leading-tight whitespace-pre-line align-bottom`;
// Cấu hình như bảng SKU Testing: kẻ ô đen đầy đủ (mọi ô có viền), đầu bảng cam chữ đen
const TABLE =
  "w-full border-collapse tabular-nums [&_td]:border [&_th]:border [&_td]:!border-black [&_th]:!border-black [&_td]:!text-[13.5px] [&_th]:!text-[12.5px] [&_th_*]:!text-[12.5px] [&_th]:!tracking-normal [&_th_*]:!tracking-normal";
/** Dòng dữ liệu: sọc xen kẽ + hover theo màu khu vực */
const rowCls = (t: Theme) => `border-b border-slate-200 ${t.stripeEven} transition-colors ${t.hover}`;
const tint = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

// Ô % KPI: nền nhạt + chữ đậm theo trạng thái → quét mắt dọc cột là thấy brand/team nào đạt, sát hay dưới
const TONE_SOFT: Record<Tone, string> = {
  good: "bg-emerald-100 !text-emerald-800",
  near: "bg-amber-100 !text-amber-900",
  bad: "bg-rose-100 !text-rose-800",
};
function KpiCell({ ratio, digits = 0, title }: { ratio: number | null | undefined; digits?: number; title?: string }) {
  const tone = kpiTone(ratio ?? null);
  if (ratio == null || !tone) return <span className="!text-slate-400">—</span>;
  return (
    <span className={`inline-block min-w-[52px] rounded-md px-2 py-0.5 text-right font-bold tabular-nums ${TONE_SOFT[tone]}`} title={title}>
      {pct(ratio, digits)}
    </span>
  );
}

/**
 * % WoW. quiet (dùng trong bảng): không nền; chỉ tô màu khi biến động bất thường (|WoW| ≥ 20%), còn lại chữ thường.
 */
function WowPill({
  value,
  goodWhen = "up",
  size = "md",
  quiet = false,
}: {
  value: number | null | undefined;
  goodWhen?: "up" | "down";
  size?: "sm" | "md";
  quiet?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) return <span className="!text-slate-400">—</span>;
  const flat = Math.abs(value) < 0.0005;
  const good = goodWhen === "up" ? value > 0 : value < 0;
  const arrow = flat ? "" : value > 0 ? "▲" : "▼";
  const text = `${(Math.abs(value) * 100).toFixed(1)}%`;
  if (quiet) {
    const strong = Math.abs(value) >= 0.2 && !flat;
    return (
      <span className={`tabular-nums ${strong ? `font-bold ${good ? "!text-emerald-700" : "!text-rose-600"}` : "!text-slate-700"}`}>
        <span className="text-[0.75em]">{arrow}</span>
        {text}
      </span>
    );
  }
  const cls = flat ? "bg-slate-200 !text-slate-700" : good ? "bg-emerald-100 !text-emerald-800" : "bg-rose-100 !text-rose-800";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-bold tabular-nums ${cls} ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-[13px]"
      }`}
    >
      <span className="text-[0.75em]">{arrow}</span>
      {text}
    </span>
  );
}

function StatusChip({ tone, label, title }: { tone: Tone | null; label?: string; title?: string }) {
  if (!tone)
    return (
      <span className="inline-flex whitespace-nowrap rounded-md bg-slate-200 px-2.5 py-1 text-[12.5px] font-semibold !text-slate-700" title={title}>
        {label ?? "Chưa có KPI"}
      </span>
    );
  // Nền đậm chữ trắng — đọc rõ, chỉ dùng cho trạng thái quan trọng
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] font-bold ${TONE_SOLID[tone]}`} title={title}>
      {label ?? PACE_LABEL[tone]}
    </span>
  );
}

function ProgressBar({
  ratio,
  marker,
  tone,
  height = "h-2",
  color,
  track = "bg-slate-200",
}: {
  ratio: number | null;
  marker?: number | null;
  tone?: Tone | null;
  height?: string;
  color?: string;
  track?: string;
}) {
  const fill = Math.min(100, Math.max(ratio && ratio > 0 ? 1.5 : 0, (ratio ?? 0) * 100));
  return (
    <div className={`relative ${height} rounded-full ${track}`}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${fill}%`, backgroundColor: color ?? (tone ? TONE_HEX[tone] : "#cbd5e1") }}
      />
      {marker != null && marker > 0 && marker < 1 && (
        <div
          className="absolute -top-1.5 -bottom-1.5 w-[3px] -translate-x-1/2 rounded-full bg-slate-900 ring-2 ring-white"
          style={{ left: `${marker * 100}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded-md px-3 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 ${
              on ? "bg-white !text-indigo-700 shadow-sm" : "!text-slate-600 hover:text-slate-900"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. TỔNG QUAN — kết quả (to nhất) → mức đạt KPI tuần → biến động so tuần trước
// ---------------------------------------------------------------------------

function KpiTiles({ total, dataThrough }: { total: GroupSummary; dataThrough: string }) {
  const cur = ratiosOf(total.cur);
  const prev = ratiosOf(total.prev);
  const revW = total.revenue?.week ?? null;
  const proW = total.profit?.week ?? null;
  const revM = total.revenue?.month ?? null;
  const proM = total.profit?.month ?? null;
  const until = vnDate(dataThrough);

  // Tuần: % đạt KPI tuần (thực đạt ÷ kế hoạch). Tháng: % đạt MT cả tháng, màu theo nhịp.
  const weekRow = (a: Achieve | null): TileRowData =>
    a
      ? {
          // Thanh = thực đạt ÷ MT cả tuần; màu theo nhịp (thực đạt ÷ cần đạt tới hôm nay)
          ratio: a.fullRatio,
          tone: kpiTone(a.ratio),
          value: pct(a.ratio, 0),
          hint: `Tuần: Đã đạt ${usd(a.actual)} / MT cả tuần ${usd(a.full)} · cần đạt tới hôm nay ${usd(a.due)}`,
          actual: a.actual,
          due: a.due,
          full: a.full,
        }
      : { ratio: null, tone: null, value: "—", hint: "Chưa có KPI" };
  const monthRow = (a: Achieve | null): TileRowData =>
    a
      ? {
          ratio: a.fullRatio,
          tone: kpiTone(a.ratio),
          value: pct(a.fullRatio, 0),
          hint: `Lũy kế đến ${until}: Đã đạt ${usd(a.actual)} / MT tháng ${usd(a.full)} · cần đạt tới hôm nay ${usd(a.due)} (nhịp ${pct(a.ratio, 0)})`,
          actual: a.actual,
          due: a.due,
          full: a.full,
        }
      : { ratio: null, tone: null, value: "—", hint: "Chưa có KPI tháng" };
  const tiles: { label: string; icon: ReactNode; color: string; value: string; negative?: boolean; wow: ReactNode; prev: string; week?: TileRowData; month?: TileRowData }[] = [
    {
      label: "Revenue",
      icon: <CurrencyDollarIcon size={16} weight="bold" />,
      color: "#4338ca",
      value: usd(total.cur.revenue),
      negative: total.cur.revenue < 0,
      wow: <WowPill value={wow(total.cur.revenue, total.prev.revenue)} size="sm" />,
      prev: usd(total.prev.revenue),
      week: weekRow(revW),
      month: monthRow(revM),
    },
    {
      label: "Profit",
      icon: <TrendUpIcon size={16} weight="bold" />,
      color: "#4f46e5",
      value: usd(total.cur.profit),
      negative: total.cur.profit < 0,
      wow: <WowPill value={wow(total.cur.profit, total.prev.profit)} size="sm" />,
      prev: usd(total.prev.profit),
      week: weekRow(proW),
      month: monthRow(proM),
    },
    {
      label: "Biên LN",
      icon: <PercentIcon size={16} weight="bold" />,
      color: "#6366f1",
      value: pct(cur.margin),
      negative: (cur.margin ?? 0) < 0,
      wow: <WowPill value={wow(cur.margin, prev.margin)} size="sm" />,
      prev: pct(prev.margin),
    },
    {
      label: "TACoS",
      icon: <MegaphoneIcon size={16} weight="bold" />,
      color: "#818cf8",
      value: pct(cur.tacos),
      wow: <WowPill value={wow(cur.tacos, prev.tacos)} goodWhen="down" size="sm" />,
      prev: pct(prev.tacos),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`${CARD} flex min-w-0 flex-col border-t-4 px-5 pt-4 pb-4 shadow-sm`}
          style={{ borderTopColor: t.color }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-bold" style={{ color: t.color }}>
              <span className="grid h-8 w-8 place-items-center rounded-lg !text-white" style={{ backgroundColor: t.color }}>
                {t.icon}
              </span>
              {t.label}
            </span>
          </div>
          {/* Số tuần + % WoW đứng cạnh nhau */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={`text-[30px] font-bold leading-none tracking-tight ${t.negative ? "!text-rose-600" : "!text-slate-900"}`}>{t.value}</span>
            {t.wow}
          </div>
          <span className="mt-1.5 text-[13px] tabular-nums !text-slate-500">Tuần trước {t.prev}</span>
          {/* Chỉ Revenue / Profit có tiến độ KPI tuần / tháng */}
          {t.week && t.month && (
            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-3">
              <TileRow label={t.week.label ?? "Tuần"} d={t.week} until={until} />
              <TileRow label="Tháng" d={t.month} until={until} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

type TileRowData = {
  ratio: number | null;
  tone: Tone | null;
  value: string;
  hint: string;
  plain?: boolean;
  label?: string;
  /** Đã đạt / cần đạt tới ngày có số liệu / mục tiêu cả kỳ */
  actual?: number;
  due?: number;
  full?: number;
};

/**
 * 1 dòng: nhãn ngắn · thanh = đã đạt ÷ MT cả kỳ (màu theo nhịp) · bên phải "Đạt X%" + MT.
 * Không vẽ vạch: nhịp (so với mức cần đạt tới nay) thể hiện bằng màu thanh + tooltip.
 */
function TileRow({ label, d, until }: { label: string; d: TileRowData; until: string }) {
  const r = d.actual != null && d.full ? d.actual / d.full : null;
  const done = r == null ? d.value : r > 1 ? `Vượt ${pct(r - 1, 0)}` : `Đạt ${pct(r, 0)}`;
  const title =
    d.actual != null && d.full
      ? `Đến ${until} đã đạt ${usd(d.actual)} / MT ${label.toLowerCase()} ${usd(d.full)}${
          d.due ? ` · cần đạt tới nay ${usd(d.due)} → nhịp ${pct(d.actual / d.due, 0)}` : ""
        }`
      : d.hint;
  return (
    <div className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3" title={title}>
      <span className="text-[13px] font-semibold !text-slate-600">{label}</span>
      {d.plain ? <span /> : <ProgressBar ratio={d.ratio == null ? null : Math.min(1, d.ratio)} tone={d.tone} height="h-2.5" />}
      <span className="flex min-w-[72px] flex-col items-end leading-tight">
        <span className={`text-[14px] font-bold tabular-nums ${d.tone ? TONE_TEXT[d.tone] : "!text-slate-800"}`}>{done}</span>
        {d.full != null && <span className="text-[11.5px] font-semibold tabular-nums !text-slate-400">MT {usd(d.full)}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. TEAM — bảng gọn; bấm 1 team để lọc bảng brand
// ---------------------------------------------------------------------------

function TeamTable({
  teams,
  total,
  activeTeam,
  onPick,
}: {
  teams: TeamGroup[];
  total: GroupSummary;
  activeTeam: string | null;
  onPick: (team: string) => void;
}) {
  // Cột như "P/L THEO NGƯỜI PHỤ TRÁCH" trong sheet, đọc trái → phải:
  //   DOANH THU TUẦN: Revenue tuần này · Tuần trước · % WoW
  //   PROFIT THÁNG:   Profit lũy kế · Mục tiêu tháng · Nhịp đạt MT (thanh + vạch cần đạt tới nay) → Đánh giá
  const rows = [...teams].sort((a, b) => Number(isIdle(a.summary)) - Number(isIdle(b.summary)));
  const TH = "px-4 py-3 text-right !text-black font-bold whitespace-nowrap";
  const TH_W = `${TH} bg-[#FF8C00]`;
  const TH_M = `${TH} bg-[#FFB366]`;
  const GROUP = "px-4 pt-2.5 pb-0.5 text-center !text-[11px] font-bold uppercase !tracking-[0.12em] !text-black";
  const EDGE = "border-l-[3px] border-[#D97300]";
  const cells = (s: GroupSummary, isTotal: boolean) => {
    const m = s.profit?.month ?? null;
    const tone = kpiTone(m?.ratio ?? null);
    const monthBg = isTotal ? "bg-orange-300" : "bg-orange-50";
    const quiet = !isTotal && s.cur.revenue === 0 ? "!text-slate-400" : "";
    return (
      <>
        {/* Doanh thu tuần */}
        <td className={`px-4 py-3.5 text-right !text-[14.5px] font-bold ${quiet}`}>{usd(s.cur.revenue)}</td>
        <td className="px-4 py-3.5 text-right !text-slate-500">{usd(s.prev.revenue)}</td>
        <td className="px-4 py-3.5 text-right">
          <WowPill value={wow(s.cur.revenue, s.prev.revenue)} quiet />
        </td>
        {/* Profit tháng → đánh giá */}
        <td className={`px-4 py-3 ${EDGE} ${monthBg}`}>
          <ProfitTargetBar actual={s.mtd.profit} target={m?.full ?? null} due={m?.due ?? null} tone={tone} />
        </td>
        <td className={`px-4 py-3.5 text-right ${monthBg}`}>
          {m ? (
            <span
              className={`!text-[16px] font-semibold tabular-nums ${tone ? PACE_TEXT[tone] : "!text-slate-900"}`}
              title={`Profit lũy kế ${usd(m.actual)} ÷ cần đạt tới nay ${usd(m.due)} (MT tháng × ngày ÷ số ngày tháng)`}
            >
              {pct(m.ratio, 1)}
            </span>
          ) : null}
        </td>
        <td className={`px-4 py-3.5 pr-5 text-center ${monthBg}`}>{tone ? <SoftChip tone={tone} label={TEAM_LABEL[tone]} /> : null}</td>
      </>
    );
  };
  return (
    <div className={`${CARD} overflow-hidden shadow-sm`}>
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[1000px]`}>
          <thead>
            <tr>
              <th className={`${GROUP} bg-[#FF8C00]`} />
              <th colSpan={3} className={`${GROUP} bg-[#FF8C00]`}>
                Doanh thu tuần
              </th>
              <th colSpan={3} className={`${GROUP} ${EDGE} bg-[#FFB366]`}>
                Profit tháng (lũy kế) → Đánh giá
              </th>
            </tr>
            <tr>
              <th className={`${TH_W} pl-5 !text-left`}>Team</th>
              <th className={TH_W}>Tuần này</th>
              <th className={TH_W}>Tuần trước</th>
              <th className={TH_W}>% WoW</th>
              <th className={`${TH_M} ${EDGE} !text-left`}>Profit lũy kế / KPI tháng</th>
              <th className={TH_M} title="Profit lũy kế ÷ (MT tháng × ngày ÷ số ngày tháng)">
                Nhịp MT
              </th>
              <th className={`${TH_M} pr-5 !text-center`}>Đánh giá</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, color, summary: s }) => {
              const idle = isIdle(s);
              const active = activeTeam === team;
              return (
                <tr
                  key={team}
                  onClick={() => onPick(team)}
                  className={`cursor-pointer border-b border-slate-200 transition-colors hover:bg-orange-50 ${active ? "bg-orange-100" : "bg-white"}`}
                >
                  <td className="py-3.5 pr-3 pl-5 text-left">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(team);
                      }}
                      className={`inline-flex cursor-pointer items-center gap-2.5 rounded font-bold whitespace-nowrap hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                        idle ? "!text-slate-400" : "!text-slate-900"
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: idle ? "#cbd5e1" : color }} />
                      {team}
                      {active && <span className="rounded bg-orange-600 px-1.5 py-px !text-[11px] font-bold !text-white">Đang lọc</span>}
                    </button>
                  </td>
                  {idle ? (
                    <td colSpan={6} className="px-4 py-3 text-center !text-slate-400 italic">
                      Không phát sinh trong tháng
                    </td>
                  ) : (
                    cells(s, false)
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-orange-500 bg-orange-200 font-bold">
              <td className="py-3.5 pr-3 pl-5 text-left !text-black">TỔNG</td>
              {cells(total, true)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/**
 * Profit lũy kế so với KPI tháng: dòng trên = số lũy kế (trái) · MT tháng (phải);
 * dòng dưới = thanh đã đạt ÷ MT tháng, màu theo nhịp (lũy kế ÷ cần đạt tới nay).
 */
function ProfitTargetBar({
  actual,
  target,
  due,
  tone,
}: {
  actual: number;
  target: number | null;
  due: number | null;
  tone: Tone | null;
}) {
  const ratio = target != null && target > 0 ? Math.min(1, Math.max(0, actual / target)) : 0;
  const fill = actual < 0 ? "#e11d48" : tone ? TONE_HEX[tone] : "#94a3b8";
  return (
    <div
      className="min-w-[280px]"
      title={
        target != null
          ? `Lũy kế ${usd(actual)} / MT tháng ${usd(target)} (đạt ${pct(target ? actual / target : null, 1)})${due != null ? ` · cần đạt tới nay ${usd(due)}` : ""}`
          : `Lũy kế ${usd(actual)} · chưa có KPI`
      }
    >
      <div className="flex items-baseline justify-between gap-2 !text-[13px] leading-none tabular-nums">
        <span className={`font-semibold ${actual < 0 ? "!text-rose-600" : "!text-slate-900"}`}>{usd(actual)}</span>
        <span className="!text-slate-500">{target != null ? `MT ${usd(target)}` : "Chưa có KPI"}</span>
      </div>
      <div className="mt-2 h-2.5 rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${ratio * 100}%`, backgroundColor: fill }} />
      </div>
    </div>
  );
}

/** Nhãn đánh giá nền nhạt, chữ màu (cột Đánh giá bảng team) */
function SoftChip({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-semibold ${TONE_SOFT[tone]}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// 4. BRAND — 1 bảng chính (Cơ bản / Chi tiết); biểu đồ Profit là tùy chọn
// ---------------------------------------------------------------------------

type SortKey = "revenue" | "dRevenue" | "profit" | "margin" | "tacos" | "pace";
const SORT_VALUE: Record<SortKey, (s: GroupSummary) => number | null> = {
  revenue: (s) => s.cur.revenue,
  dRevenue: (s) => wow(s.cur.revenue, s.prev.revenue),
  profit: (s) => s.cur.profit,
  margin: (s) => div(s.cur.profit, s.cur.revenue),
  tacos: (s) => div(s.cur.adsFee, s.cur.revenue),
  pace: (s) => s.profit?.month.ratio ?? null,
};


interface Col {
  key: string;
  label: string;
  basic: boolean;
  sort?: SortKey;
  title?: string;
  /** Cột nhấn mạnh (Profit, Biên LN) */
  strong?: boolean;
  /** Thuộc nhóm "Tiến độ tháng" (lũy kế) — tách khỏi nhóm "Kết quả tuần" bằng nền + vạch */
  month?: boolean;
  render: (s: GroupSummary, total: boolean) => ReactNode;
}

const money = (v: number, cls = "") => <span className={`${v < 0 ? "!text-rose-600" : ""} ${cls}`}>{usd(v)}</span>;

// Thứ tự cột như file; "basic" = chế độ Cơ bản
const BRAND_COLS: Col[] = [
  { key: "rev", label: "Revenue\ntuần này", basic: true, sort: "revenue", render: (s) => <span className="font-semibold">{money(s.cur.revenue)}</span> },
  { key: "revPrev", label: "Revenue\ntuần trước", basic: false, render: (s) => <span className="!text-slate-600">{usd(s.prev.revenue)}</span> },
  {
    key: "wow",
    label: "% WoW",
    basic: true,
    sort: "dRevenue",
    render: (s, total) => (!total && isIdle(s) ? "—" : <WowPill value={wow(s.cur.revenue, s.prev.revenue)} size="sm" quiet />),
  },
  { key: "qty", label: "Quantity", basic: false, render: (s) => int(s.cur.quantity) },
  { key: "ads", label: "Ads Fee", basic: false, render: (s) => <span className="!text-slate-600">{usd(s.cur.adsFee)}</span> },
  {
    key: "profit",
    label: "Profit",
    basic: true,
    sort: "profit",
    strong: true,
    render: (s) => <span className="font-bold">{money(s.cur.profit)}</span>,
  },
  {
    key: "tacos",
    label: "TACoS",
    basic: true,
    sort: "tacos",
    render: (s) => {
      const v = ratiosOf(s.cur).tacos;
      return <>{pct(v)}</>;
    },
  },
  { key: "roi", label: "ROI", basic: false, render: (s) => pct(ratiosOf(s.cur).roi) },
  {
    key: "margin",
    label: "Biên LN",
    basic: true,
    sort: "margin",
    strong: true,
    render: (s) => {
      const v = ratiosOf(s.cur).margin;
      return <span className={`font-semibold ${v != null && v < 0 ? "!text-rose-600" : ""}`}>{pct(v)}</span>;
    },
  },
  { key: "mtd", label: "Profit\nlũy kế tháng", basic: false, month: true, render: (s) => <span className="font-semibold">{money(s.mtd.profit)}</span> },
  {
    key: "pace",
    label: "% đạt kế hoạch Profit\ntháng (tới nay)",
    basic: true,
    month: true,
    sort: "pace",
    title: "Profit lũy kế ÷ kế hoạch Profit tháng tới ngày báo cáo (MT tháng × ngày ÷ số ngày tháng)",
    render: (s) => <KpiCell ratio={s.profit?.month.ratio} title={s.profit ? undefined : "Chưa có KPI"} />,
  },
  { key: "target", label: "MT Profit\ntháng", basic: false, month: true, render: (s) => <span className="!text-slate-600">{s.profit ? usd(s.profit.month.full) : "—"}</span> },
  {
    key: "full",
    label: "% đạt MT Profit\ncả tháng",
    title: "Profit lũy kế ÷ Mục tiêu Profit cả tháng",
    basic: false,
    month: true,
    render: (s) => {
      const m = s.profit?.month;
      if (!m) return "—";
      return (
        <div className="ml-auto flex w-[110px] items-center gap-2">
          <div className="flex-1">
            <ProgressBar ratio={m.fullRatio} tone={kpiTone(m.ratio)} height="h-2" />
          </div>
          <span className="w-10 text-right font-semibold">{pct(m.fullRatio, 0)}</span>
        </div>
      );
    },
  },
];

function BrandPanel({
  sectionRef,
  teams,
  total,
  totalLabel,
  activeTeam,
  onClearTeam,
  skuGroup,
  onSkuGroup,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  teams: TeamGroup[];
  total: GroupSummary;
  skuGroup: SkuGroup;
  onSkuGroup: (g: SkuGroup) => void;
  totalLabel: string;
  activeTeam: string | null;
  onClearTeam: () => void;
}) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [mode, setMode] = useState<"basic" | "detail">("basic");
  const [showIdle, setShowIdle] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "desc" | "asc" } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const cols = mode === "basic" ? BRAND_COLS.filter((c) => c.basic) : BRAND_COLS;
  const grouped = teams.length > 1;
  const idleCount = teams.reduce((n, t) => n + t.brands.filter((r) => isIdle(r.s)).length, 0);
  const shownTeams = activeTeam ? teams.filter((t) => t.team === activeTeam) : teams;

  const order = (rows: { b: WeeklyBrandRow; s: GroupSummary }[]) => {
    const list = showIdle ? rows : rows.filter((r) => !isIdle(r.s));
    if (!sort) return list;
    const val = SORT_VALUE[sort.key];
    return [...list].sort((x, y) => {
      const a = val(x.s);
      const b = val(y.s);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return sort.dir === "desc" ? b - a : a - b;
    });
  };
  const toggleSort = (key: SortKey) =>
    setSort((cur) => (cur?.key !== key ? { key, dir: "desc" } : cur.dir === "desc" ? { key, dir: "asc" } : null));
  const toggleTeam = (team: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });

  const theme = useTheme();
  const th = thCls(theme);
  // Nhóm cột: "Kết quả tuần" (màu khu vực) | "Tiến độ tháng" (xanh trời — cùng màu khối Tiến độ tháng)
  const weekCols = cols.filter((c) => !c.month).length;
  const monthCols = cols.length - weekCols;
  const firstMonth = cols.findIndex((c) => c.month);
  const MONTH_TH = "bg-[#FFB366] !text-black border-b-2 border-[#D97300]";
  const cellGroup = (c: Col, i: number, odd: boolean) =>
    c.month ? `${odd ? "bg-orange-100/70" : "bg-orange-50"} ${i === firstMonth ? "border-l-2 border-[#FFB366]" : ""}` : "";

  return (
    <section ref={sectionRef} aria-label="Kinh doanh theo brand" className={`${tableCard(theme)} scroll-mt-4`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium !text-slate-600">Xem</span>
            <Segmented
              label="Kiểu xem"
              value={view}
              onChange={setView}
              options={[
                { value: "table", label: "Bảng" },
                { value: "chart", label: "Biểu đồ Profit" },
              ]}
            />
          </div>
          {view === "table" && (
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
              <span className="text-[13px] font-medium !text-slate-600">Cột</span>
              <Segmented
                label="Mức chi tiết"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "basic", label: "Cơ bản" },
                  { value: "detail", label: "Chi tiết" },
                ]}
              />
            </div>
          )}
          {activeTeam && (
            <button
              type="button"
              onClick={onClearTeam}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-semibold !text-white hover:opacity-90"
              style={{ backgroundColor: teamColor(activeTeam) }}
            >
              Đang lọc: {activeTeam}
              <XIcon size={12} weight="bold" aria-label="Bỏ lọc team" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {idleCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px] !text-slate-700">
              <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              Hiện brand không phát sinh ({idleCount})
            </label>
          )}
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4" title="Chia SKU như trang KPI kinh doanh: Win = Bảng mã Phát triển (đã qua Tháng đánh giá), Test = trạng thái Test + SKU chưa tới Tháng đánh giá; FBM tính hết vào Win">
            <span className="text-[13px] font-medium !text-slate-600">SKU</span>
            <Segmented
              label="Nhóm SKU"
              value={skuGroup}
              onChange={onSkuGroup}
              options={[
                { value: "all", label: "All" },
                { value: "win", label: "Win" },
                { value: "test", label: "Test" },
              ]}
            />
          </div>
        </div>
      </div>

      {view === "chart" ? (
        <ProfitChart teams={shownTeams} showIdle={showIdle} />
      ) : (
        <div className="overflow-x-auto">
          <table className={`${TABLE} ${mode === "detail" ? "min-w-[1380px]" : "min-w-[860px]"}`}>
            <thead>
              <tr className="text-[11.5px] font-bold uppercase tracking-wide">
                <th rowSpan={2} className={`${th} sticky left-0 z-[2] pl-4 !text-left !align-middle normal-case tracking-normal`}>
                  Brand
                </th>
                <th colSpan={weekCols} className={`${theme.thGroup} px-3 py-1.5 text-center`}>
                  Kết quả tuần
                </th>
                {monthCols > 0 && (
                  <th colSpan={monthCols} className="border-l-2 border-white bg-[#FFB366] px-3 py-1.5 text-center !text-black">
                    Tiến độ tháng (lũy kế)
                  </th>
                )}
              </tr>
              <tr>
                {cols.map((c, i) => {
                  const cls = `${c.month ? `${MONTH_TH} px-3 py-2.5 text-right text-[12.5px] font-bold leading-tight whitespace-pre-line align-bottom` : th} ${
                    i === firstMonth ? "border-l-2 border-white" : ""
                  } ${i === cols.length - 1 ? "pr-4" : ""}`;
                  if (!c.sort)
                    return (
                      <th key={c.key} className={cls} title={c.title}>
                        {c.label}
                      </th>
                    );
                  const active = sort?.key === c.sort;
                  return (
                    <th key={c.key} className={cls} title={c.title} aria-sort={active ? (sort!.dir === "desc" ? "descending" : "ascending") : "none"}>
                      <button
                        type="button"
                        onClick={() => toggleSort(c.sort!)}
                        className={`inline-flex cursor-pointer items-end gap-1 whitespace-pre-line rounded text-right hover:underline focus-visible:outline-2 focus-visible:outline-slate-900 ${
                          active ? "underline decoration-2 underline-offset-4" : ""
                        }`}
                      >
                        <span>{c.label}</span>
                        {active ? (
                          sort!.dir === "desc" ? <CaretDownIcon size={11} weight="bold" className="mb-0.5 shrink-0" /> : <CaretUpIcon size={11} weight="bold" className="mb-0.5 shrink-0" />
                        ) : (
                          <CaretDownIcon size={11} className="mb-0.5 shrink-0 opacity-40" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {shownTeams.map((t) => {
              const rows = order(t.brands);
              const isCollapsed = collapsed.has(t.team);
              // Team không còn brand nào để hiện (đều không phát sinh) → bỏ cả dòng nhóm
              if (!rows.length) return null;
              return (
                <tbody key={t.team}>
                  {grouped && (
                    // Dòng nhóm team: dải màu của team (nền nhạt + vạch trái đậm) → tách rõ từng team
                    <tr className="border-y border-slate-300" style={{ backgroundColor: tint(t.color, 0.16) }}>
                      <td colSpan={cols.length + 1} className="border-l-4 px-3 py-2" style={{ borderLeftColor: t.color }}>
                        <button
                          type="button"
                          aria-expanded={!isCollapsed}
                          onClick={() => toggleTeam(t.team)}
                          className="inline-flex cursor-pointer items-center gap-2 rounded text-[13.5px] font-bold focus-visible:outline-2 focus-visible:outline-slate-900"
                          style={{ color: t.color }}
                        >
                          {isCollapsed ? <CaretRightIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />}
                          {t.team}
                          <span className="font-semibold !text-slate-700">
                            · {rows.length} brand · Profit {usd(t.summary.cur.profit)}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )}
                  {!isCollapsed &&
                    rows.map(({ b, s }, ri) => {
                      const idle = isIdle(s);
                      const odd = ri % 2 === 1;
                      const bg = odd ? theme.stripe : "bg-white";
                      const neg = s.cur.profit < 0;
                      return (
                        <tr key={b.key} className={`group border-b border-slate-200/70 ${bg} ${idle ? "!text-slate-500" : "!text-slate-800"}`}>
                          {/* Cột Brand cố định khi cuộn ngang; brand lỗ có vạch đỏ bên trái */}
                          <td
                            className={`sticky left-0 z-[1] py-2.5 pr-3 text-left font-semibold ${bg} group-hover:bg-orange-50 ${grouped ? "pl-8" : "pl-4"} ${
                              neg ? "border-l-4 border-l-rose-500" : ""
                            }`}
                          >
                            <span className="block max-w-[220px] truncate" title={b.label}>
                              {b.label}
                            </span>
                          </td>
                          {cols.map((c, i) => (
                            <td
                              key={c.key}
                              className={`px-3 py-2.5 text-right group-hover:bg-orange-50 ${cellGroup(c, i, odd)} ${
                                c.key === "profit" && neg ? "!bg-rose-50" : ""
                              } ${i === cols.length - 1 ? "pr-4" : ""}`}
                            >
                              {c.render(s, false)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}

            <tfoot>
              <tr className={`${theme.total} font-bold`}>
                <td className="sticky left-0 z-[1] bg-[#FFE0B2] py-3 pr-3 pl-4 text-left">{totalLabel}</td>
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    className={`px-3 py-3 text-right ${c.month ? "bg-[#FFD199]" : ""} ${i === firstMonth ? "border-l-2 border-[#FFB366]" : ""} ${
                      i === cols.length - 1 ? "pr-4" : ""
                    }`}
                  >
                    {c.render(total, true)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

type ProfitDatum = { label: string; color: string; profit: number; margin: number | null; revenue: number; growth: number | null };

function ProfitChart({ teams, showIdle }: { teams: TeamGroup[]; showIdle: boolean }) {
  const rows: ProfitDatum[] = teams
    .flatMap((t) =>
      t.brands
        .filter((r) => showIdle || !isIdle(r.s))
        .map((r) => ({
          label: r.b.label,
          color: t.color,
          profit: r.s.cur.profit,
          margin: div(r.s.cur.profit, r.s.cur.revenue),
          revenue: r.s.cur.revenue,
          growth: wow(r.s.cur.profit, r.s.prev.profit),
        })),
    )
    .sort((a, b) => b.profit - a.profit);
  if (!rows.length) return <div className="px-5 py-10 text-center text-[13px] !text-slate-400">Không có brand phát sinh.</div>;
  return (
    <div className="px-4 pt-4 pb-2">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs !text-slate-600">
        {teams.map((t) => (
          <span key={t.team} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: t.color }} />
            {t.team}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NEG }} />
          Lỗ
        </span>
        <span className="ml-auto !text-slate-400">Nhãn: Profit · Biên LN</span>
      </div>
      <div style={{ height: Math.max(160, rows.length * 34 + 16) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 0 }} barCategoryGap="30%">
            <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), "auto"]} />
            <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} interval={0} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ProfitDatum | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
                    <p className="mb-1 font-semibold !text-slate-900">{p.label}</p>
                    <TipRow k="Profit" v={usd(p.profit)} />
                    <TipRow k="% WoW" v={<WowPill value={p.growth} size="sm" />} />
                    <TipRow k="Revenue" v={usd(p.revenue)} />
                    <TipRow k="Biên LN" v={pct(p.margin)} />
                  </div>
                );
              }}
            />
            <Bar dataKey="profit" radius={4} isAnimationActive={false}>
              {rows.map((d) => (
                <Cell key={d.label} fill={d.profit < 0 ? NEG : d.color} />
              ))}
              <LabelList
                dataKey="profit"
                content={(props) => {
                  const { x, y, width, height, index } = props as { x: number; y: number; width: number; height: number; index: number };
                  const d = rows[index];
                  if (!d) return null;
                  const end = Math.max(Number(x), Number(x) + Number(width));
                  return (
                    <text x={end + 6} y={Number(y) + Number(height) / 2} dominantBaseline="central" fontSize={11}>
                      <tspan fill={d.profit < 0 ? NEG : "#0f172a"} fontWeight={600}>
                        {usdK(d.profit)}
                      </tspan>
                      <tspan fill="#94a3b8"> · {pct(d.margin, 0)}</tspan>
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TipRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="!text-slate-500">{k}</span>
      <span className="font-semibold tabular-nums !text-slate-900">{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. SKU TEST — mặc định chỉ brand có phát sinh
// ---------------------------------------------------------------------------

function TestBlock({ tests }: { tests: WeeklyReport["tests"] }) {
  const [showAll, setShowAll] = useState(false);
  const cur = tests.reduce((s, t) => add(s, t.current), ZERO);
  const prev = tests.reduce((s, t) => add(s, t.previous), ZERO);
  const rc = ratiosOf(cur);
  const rp = ratiosOf(prev);
  const activeRows = tests.filter((t) => t.current.revenue !== 0 || t.current.profit !== 0 || t.previous.revenue !== 0);
  const rows = (showAll ? tests : activeRows).slice().sort((a, b) => b.current.revenue - a.current.revenue);
  const hidden = tests.length - activeRows.length;
  const stats = [
    { label: "Revenue", value: usd(cur.revenue), delta: <WowPill value={wow(cur.revenue, prev.revenue)} size="sm" /> },
    { label: "Profit", value: usd(cur.profit), delta: <WowPill value={wow(cur.profit, prev.profit)} size="sm" /> },
    { label: "TACoS", value: pct(rc.tacos), delta: <WowPill value={wow(rc.tacos, rp.tacos)} goodWhen="down" size="sm" /> },
    { label: "Biên LN", value: pct(rc.margin), delta: <WowPill value={wow(rc.margin, rp.margin)} size="sm" /> },
    { label: "Quantity", value: int(cur.quantity), delta: <WowPill value={wow(cur.quantity, prev.quantity)} size="sm" /> },
  ];
  const max = Math.max(1, ...rows.map((t) => t.current.revenue));
  const theme = useTheme();
  const th = thCls(theme);
  return (
    <div className={tableCard(theme)}>
      <div className="grid grid-cols-2 divide-x divide-y divide-orange-100 border-b border-orange-200 bg-orange-50 md:grid-cols-5 md:divide-y-0">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 px-4 py-3">
            <span className="text-[13px] font-semibold !text-orange-800">{s.label}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tabular-nums !text-slate-900">{s.value}</span>
              {s.delta}
            </span>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[880px]`}>
            <thead>
              <tr>
                <th className={`${th} pl-4 !text-left`}>Brand</th>
                <th className={th}>Revenue</th>
                <th className={th}>% WoW</th>
                <th className={th}>Quantity</th>
                <th className={`${th} !text-slate-900`}>Profit</th>
                <th className={th}>TACoS</th>
                <th className={th}>ROI</th>
                <th className={`${th} pr-4 !text-slate-900`}>Biên LN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const r = ratiosOf(t.current);
                return (
                  <tr key={t.storeId} className={rowCls(theme)}>
                    <td className="py-2.5 pr-3 pl-4 font-semibold !text-slate-800">{t.label}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="ml-auto flex w-[160px] items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max(0, (t.current.revenue / max) * 100)}%` }} />
                        </div>
                        <span className="w-[66px] text-right font-semibold !text-slate-900">{usd(t.current.revenue)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <WowPill value={wow(t.current.revenue, t.previous.revenue)} quiet />
                    </td>
                    <td className="px-3 py-2.5 text-right">{int(t.current.quantity)}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${t.current.profit < 0 ? "!text-rose-600" : "!text-slate-900"}`}>{usd(t.current.profit)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {pct(r.tacos)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{pct(r.roi)}</td>
                    <td className={`px-3 py-2.5 pr-4 text-right font-semibold ${r.margin != null && r.margin < 0 ? "!text-rose-600" : ""}`}>{pct(r.margin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full cursor-pointer border-t border-slate-200 py-2 text-[13px] font-semibold !text-indigo-700 hover:bg-slate-50"
        >
          {showAll ? "Chỉ hiện brand có phát sinh" : `Hiện cả ${hidden} brand không phát sinh`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. TỒN KHO & DÒNG TIỀN — trạng thái cần xử lý lên đầu
// ---------------------------------------------------------------------------

type StockState = { tone: Tone | null; label: string; title: string; rank: number };

/**
 * File: > 30 tuần Ứ vốn, > 20 tuần Theo dõi. Bổ sung các trường hợp file đang báo nhầm "OK":
 *   tồn 0 mà vẫn bán → Hết hàng (hoặc thiếu dữ liệu tồn); có tồn mà không bán → Không bán; < 4 tuần → Sắp hết.
 */
function stockState(units: number, perWeek: number, weeksLeft: number | null): StockState {
  if (units <= 0 && perWeek > 0)
    return { tone: "bad", label: "Hết hàng", title: "Không có tồn FBA/AWD tại ngày cuối tuần nhưng vẫn có bán — hết hàng hoặc chưa có báo cáo tồn", rank: 0 };
  if (units <= 0) return { tone: null, label: "Chưa có dữ liệu", title: "Không có tồn và không bán trong tuần", rank: 5 };
  if (perWeek <= 0) return { tone: "bad", label: "Không bán", title: "Có tồn nhưng tuần này không bán được đơn nào", rank: 1 };
  if (weeksLeft != null && weeksLeft > 30) return { tone: "bad", label: "Ứ vốn", title: "Trên 30 tuần mới bán hết — dừng/giảm nhập", rank: 2 };
  if (weeksLeft != null && weeksLeft < 4) return { tone: "near", label: "Sắp hết", title: "Dưới 4 tuần bán — cần nhập thêm", rank: 3 };
  if (weeksLeft != null && weeksLeft > 20) return { tone: "near", label: "Theo dõi", title: "20–30 tuần mới bán hết", rank: 4 };
  return { tone: "good", label: "Đủ tồn", title: "4–20 tuần bán", rank: 6 };
}

function StockBlock({ stock, days }: { stock: WeeklyReport["stock"]; days: number }) {
  const totalValue = stock.reduce((s, r) => s + r.value, 0);
  const totalUnits = stock.reduce((s, r) => s + r.units, 0);
  const perWeekOf = (sold: number) => (days ? (sold * 7) / days : 0);
  const rows = stock
    .map((s) => {
      const perWeek = perWeekOf(s.soldInPeriod);
      const weeksLeft = perWeek > 0 && s.units > 0 ? s.units / perWeek : null;
      return { s, perWeek, weeksLeft, state: stockState(s.units, perWeek, weeksLeft) };
    })
    .sort((a, b) => a.state.rank - b.state.rank || b.s.value - a.s.value);
  const totalPerWeek = rows.reduce((n, r) => n + r.perWeek, 0);
  // Số tuần bán hết cấp tổng: chỉ tính brand vừa có tồn vừa có bán (không cộng tồn của brand không bán / bán của brand hết tồn)
  const valid = rows.filter((r) => r.weeksLeft != null);
  const validUnits = valid.reduce((n, r) => n + r.s.units, 0);
  const validPerWeek = valid.reduce((n, r) => n + r.perWeek, 0);
  const totalWeeks = validPerWeek > 0 ? validUnits / validPerWeek : null;
  const excluded = rows.length - valid.length;
  const noData = rows.filter((r) => r.state.tone == null).map((r) => r.s.label);
  const theme = useTheme();
  const th = thCls(theme);
  return (
    <div className={`${tableCard(theme)} h-full`}>
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[660px]`}>
          <thead>
            <tr>
              <th className={`${th} pl-4 !text-left`}>Brand</th>
              <th className={th}>SL tồn</th>
              <th className={th}>Giá trị tồn</th>
              <th className={th}>% tổng tồn</th>
              <th className={th}>Bán / tuần</th>
              <th className={th}>Số tuần bán hết</th>
              <th className={`${th} pr-4 !text-center`}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.state.tone != null).map(({ s, perWeek, weeksLeft, state }) => {
              const share = div(s.value, totalValue);
              return (
                <tr key={s.storeId} className={rowCls(theme)}>
                  <td className="py-2.5 pr-3 pl-4 font-semibold !text-slate-800">{s.label}</td>
                  <td className="px-3 py-2 text-right">{int(s.units)}</td>
                  <td className="px-3 py-2 text-right font-semibold !text-slate-900">{usd(s.value)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="ml-auto flex w-[96px] items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-orange-400" style={{ width: `${(share ?? 0) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right !text-slate-700">{pct(share, 0)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{int(perWeek)}</td>
                  <td className="px-3 py-2 text-right font-bold">{weeksLeft == null ? "—" : weeksLeft.toFixed(1)}</td>
                  <td className="px-3 py-2 pr-4 text-center">
                    <StatusChip tone={state.tone} label={state.label} title={state.title} />
                  </td>
                </tr>
              );
            })}
            {/* Store không tồn, không bán: gộp 1 dòng thay vì nhiều dòng toàn số 0 */}
            {noData.length > 0 && (
              <tr className="border-b border-slate-200/70 bg-slate-50 !text-slate-600">
                <td colSpan={7} className="px-4 py-2.5 text-[13px]" title={noData.join(", ")}>
                  <span className="font-semibold !text-slate-700">{noData.length} store chưa có dữ liệu tồn:</span> {noData.join(", ")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className={`${theme.total} font-bold`}>
              <td className="py-2.5 pr-3 pl-4">TỔNG</td>
              <td className="px-3 py-2.5 text-right">{int(totalUnits)}</td>
              <td className="px-3 py-2.5 text-right">{usd(totalValue)}</td>
              <td className="px-3 py-2.5 text-right">100%</td>
              <td className="px-3 py-2.5 text-right">{int(totalPerWeek)}</td>
              <td
                className="px-3 py-2.5 text-right"
                title={`Tổng tồn ÷ tổng bán/tuần của ${valid.length} brand vừa có tồn vừa có bán${excluded ? ` (bỏ ${excluded} brand hết tồn hoặc không bán)` : ""}`}
              >
                {totalWeeks == null ? "—" : totalWeeks.toFixed(1)}
                {excluded > 0 && totalWeeks != null && <span className="ml-0.5 align-super text-[10px] !text-slate-500">*</span>}
              </td>
              <td className="px-3 py-2.5 pr-4" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PayoutBlock({ payout }: { payout: NonNullable<WeeklyReport["payout"]> }) {
  const max = Math.max(1, ...payout.byStore.map((p) => Math.max(p.current, p.previous)));
  const rows = [...payout.byStore].sort((a, b) => b.current - a.current);
  const theme = useTheme();
  return (
    <div className={`${tableCard(theme)} h-full`}>
      <div className="flex items-end justify-between gap-3 border-b border-[#D97300] bg-[#FF8C00] px-5 py-4 !text-black">
        <div>
          <div className="text-sm font-bold !text-black">Payment — Amazon đã giải ngân</div>
          <div className="text-[28px] font-bold leading-tight tabular-nums !text-black">{usd2(payout.current)}</div>
          <div className="text-[13px] !text-black/80" title="Tổng Disbursement trạng thái Done có ngày nhận (Acknowledged) trong tuần; không phải doanh thu hay lợi nhuận của tuần">
            Tiền về trong tuần · tuần trước {usd2(payout.previous)}
          </div>
        </div>
        <WowPill value={wow(payout.current, payout.previous)} />
      </div>
      <ul className="divide-y divide-orange-100 px-5 py-1">
        {rows.map((p) => (
          <li key={p.storeName} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 py-2 text-[13px]">
            <span className="truncate font-semibold !text-slate-800" title={p.storeName}>
              {p.storeName}
            </span>
            <div className="flex flex-col gap-1" title={`Tuần này ${usd2(p.current)} · tuần trước ${usd2(p.previous)}`}>
              <div className="h-2 rounded-full bg-orange-500" style={{ width: `${Math.max(1, (p.current / max) * 100)}%` }} />
              <div className="h-1 rounded-full bg-slate-300" style={{ width: `${Math.max(1, (p.previous / max) * 100)}%` }} />
            </div>
            <span className="flex items-center gap-2 tabular-nums">
              <b className="font-semibold !text-slate-900">{usdK(p.current)}</b>
              <WowPill value={wow(p.current, p.previous)} quiet />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
