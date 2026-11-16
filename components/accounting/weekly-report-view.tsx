"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { computeCashflow, type CashflowField, type CashflowValues, type WeeklyCashflow } from "@/lib/accounting/weekly-cashflow";
import {
  daysInMonthOf,
  nextWeekSegment,
  previousWeekSegment,
  recentWeekSegments,
} from "@/lib/accounting/weekly-report-periods";
import { kpiRatio, kpiTone } from "@/lib/accounting/kpi-progress";
import { AccountingModuleSkeleton, AccountingTopProgressBar } from "./accounting-skeleton";

// BÁO CÁO TUẦN — mỗi khối 1 nhiệm vụ:
//   1 Tổng quan (kết quả thế nào?, tiến độ tháng)
//   → 4 Brand (nguyên nhân ở đâu?, chọn All / Win / Test) → 6 Tồn kho & dòng tiền (việc vận hành cần xử lý).
// Công thức như file "BÁO CÁO TUẦN TỔNG HỢP":
//   % WoW = (này − trước) ÷ |trước| (cả Biên LN, TACoS)
//   Kế hoạch tới nay = MT kỳ × ngày đã có số liệu ÷ số ngày kỳ; Nhịp = thực đạt ÷ kế hoạch tới nay
//   ≥100% Vượt/đạt nhịp · ≥85% Sát nhịp · còn lại Dưới nhịp (màu xanh / cam / đỏ)
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
const TONE_HEX: Record<Tone, string> = { good: "#059669", near: "#d97706", bad: "#e11d48" };
const TONE_SOLID: Record<Tone, string> = {
  good: "bg-emerald-600 !text-white",
  near: "bg-amber-500 !text-white",
  bad: "bg-rose-600 !text-white",
};
const PACE_LABEL: Record<Tone, string> = { good: "Vượt/đạt nhịp", near: "Sát nhịp", bad: "Dưới nhịp" };

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

  // Bảng brand: chọn All / Win / Test (Win / Test theo trạng thái Bảng mã như sheet — server đã tách sẵn)
  const [skuGroup, setSkuGroup] = useState<SkuGroup>("win");
  const groupBrands = useMemo(() => visibleBrands.map((b) => brandOfGroup(b, skuGroup)), [visibleBrands, skuGroup]);
  const brandTotal = useMemo(() => (skuGroup === "win" ? total : summarize(groupBrands, ctx)), [skuGroup, total, groupBrands, ctx]);
  const brandTeams = useMemo(() => (skuGroup === "win" ? teams : groupTeams(groupBrands, ctx)), [skuGroup, teams, groupBrands, ctx]);

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const brandRef = useRef<HTMLElement>(null);
  const activeTeam = teamFilter && teams.some((t) => t.team === teamFilter) ? teamFilter : null;

  // Cảnh báo dữ liệu: brand có phát sinh nhưng chưa có KPI vẫn cộng vào thực đạt → % KPI có thể cao hơn thực tế
  const untargeted = teams.flatMap((t) => t.brands.filter((r) => !r.b.target && !isIdle(r.s)).map((r) => r.b.label));

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-7">
      <Section title="Tổng quan" right={untargeted.length > 0 ? <UntargetedNote names={untargeted} /> : null}>
        <KpiTiles total={total} dataThrough={data.dataThrough} weekEnd={week.endDate} />
      </Section>

      <Section title="Kinh doanh theo Team/Brand" theme="blue">
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

      {stock.length > 0 && (
        <Section title="Tồn kho" theme="amber">
          <StockBlock
            stock={stock}
            days={data.days}
            weekStart={week.startDate}
            canEdit={data.canEditPrepaid}
            teamOfStore={new Map(brands.filter((b) => b.channel === "FBA").map((b) => [b.storeId, b.team]))}
          />
        </Section>
      )}
      {/* Tài chính & dòng tiền: chỉ admin / kế toán (server chỉ trả payout cho 2 vai trò này), mặc định thu gọn */}
      {payout && <MoneySection payout={payout} payoutMonth={data.payoutMonth} cashflow={data.cashflow} canEdit={data.canEditPrepaid} />}
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
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2.5 !text-[20px] font-bold !tracking-tight !text-slate-950">
            <span className={`h-6 w-1.5 rounded-full ${t.bar}`} />
            {title}
            {tag && <span className={`rounded-md px-2 py-0.5 !text-[12px] font-bold ${t.tag}`}>{tag}</span>}
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
      <span className={`tabular-nums ${strong ? `font-bold ${good ? "!text-emerald-700" : "!text-rose-600"}` : "!text-slate-950"}`}>
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

function KpiTiles({ total, dataThrough, weekEnd }: { total: GroupSummary; dataThrough: string; weekEnd: string }) {
  const cur = ratiosOf(total.cur);
  const prev = ratiosOf(total.prev);
  const revM = total.revenue?.month ?? null;
  const proM = total.profit?.month ?? null;
  const until = vnDate(dataThrough);

  // Tuần — như KPI card sheet BÁO CÁO TUẦN: lũy kế từ mùng 1 đến hết tuần ÷ "Mục tiêu tháng (lũy kế đến nay)"
  //   = MT tháng × ngày cuối tuần ÷ số ngày tháng (mốc DAY($K$1) của sheet = ngày cuối tuần).
  // Tháng: lũy kế ÷ MT cả tháng.
  const endDay = Number(weekEnd.slice(8, 10));
  const dim = daysInMonthOf(weekEnd);
  const weekRow = (a: Achieve | null): TileRowData => {
    if (!a) return { ratio: null, tone: null, value: "—", hint: "Chưa có KPI" };
    const mtToWeek = (a.full * endDay) / dim;
    const r = mtToWeek > 0 ? a.actual / mtToWeek : null;
    return {
      ratio: r,
      tone: kpiTone(r),
      value: pct(r, 0),
      hint: `Lũy kế 1–${endDay}/${Number(weekEnd.slice(5, 7))}: ${usd(a.actual)} / Target lũy kế đến hết tuần ${usd(mtToWeek)} (Target tháng × ${endDay}/${dim})`,
      actual: a.actual,
      full: mtToWeek,
    };
  };
  const monthRow = (a: Achieve | null): TileRowData =>
    a
      ? {
          ratio: a.fullRatio,
          tone: kpiTone(a.ratio),
          value: pct(a.fullRatio, 0),
          hint: `Lũy kế đến ${until}: Đã đạt ${usd(a.actual)} / Target tháng ${usd(a.full)} · cần đạt tới hôm nay ${usd(a.due)} (nhịp ${pct(a.ratio, 0)})`,
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
      week: weekRow(revM),
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
      week: weekRow(proM),
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
          <span className="mt-1.5 text-[13px] tabular-nums !text-slate-950">Tuần trước {t.prev}</span>
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
  const title = d.hint
    ? d.hint
    : d.actual != null && d.full
      ? `Đến ${until} đã đạt ${usd(d.actual)} / Target ${label.toLowerCase()} ${usd(d.full)}${
          d.due ? ` · cần đạt tới nay ${usd(d.due)} → nhịp ${pct(d.actual / d.due, 0)}` : ""
        }`
      : d.hint;
  return (
    <div className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3" title={title}>
      <span className="text-[13px] font-semibold !text-slate-600">{label}</span>
      {d.plain ? <span /> : <ProgressBar ratio={d.ratio == null ? null : Math.min(1, d.ratio)} tone={d.tone} height="h-2.5" />}
      <span className="flex min-w-[72px] flex-col items-end leading-tight">
        <span className={`text-[12px] font-semibold tabular-nums ${d.tone ? TONE_TEXT[d.tone] : "!text-slate-800"}`}>{done}</span>
        {d.full != null && <span className="text-[11.5px] font-semibold tabular-nums !text-slate-950">Target {usd(d.full)}</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. BRAND — 1 bảng (SKU All / Win / Test, gom theo team)
// ---------------------------------------------------------------------------

type SortKey = "revenue" | "dRevenue" | "profit" | "dProfit" | "margin" | "tacos" | "pace";
const SORT_VALUE: Record<SortKey, (s: GroupSummary) => number | null> = {
  revenue: (s) => s.cur.revenue,
  dRevenue: (s) => wow(s.cur.revenue, s.prev.revenue),
  profit: (s) => s.cur.profit,
  dProfit: (s) => wow(s.cur.profit, s.prev.profit),
  margin: (s) => div(s.cur.profit, s.cur.revenue),
  tacos: (s) => div(s.cur.adsFee, s.cur.revenue),
  pace: (s) => s.profit?.month.ratio ?? null,
};


interface Col {
  key: string;
  label: string;
  sort?: SortKey;
  title?: string;
  /** Cột nhấn mạnh (Profit, Biên LN) */
  strong?: boolean;
  /** Thuộc nhóm "Tiến độ tháng" (lũy kế) — tách khỏi nhóm "Kết quả tuần" bằng nền + vạch */
  month?: boolean;
  render: (s: GroupSummary, total: boolean) => ReactNode;
}

const money = (v: number, cls = "") => <span className={`${v < 0 ? "!text-rose-600" : ""} ${cls}`}>{usd(v)}</span>;

// Ô Profit như tab Day (fba-daily-view): lãi nền xanh, lỗ nền đỏ — áp cho cột Profit tuần và Profit lũy kế
const SHEET_GREEN = "#83C75D";
const SHEET_RED = "#FF0000";
const profitCellStyle = (v: number) => ({ backgroundColor: v < 0 ? SHEET_RED : SHEET_GREEN });
const PROFIT_COLS = new Set(["profit", "mtd"]);
const profitColValue = (key: string, s: GroupSummary) => (key === "profit" ? s.cur.profit : key === "mtd" ? s.mtd.profit : null);

/** Pha màu team với trắng theo tỷ lệ a (0–1) → màu đặc rgb() */
const teamTint = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * a);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
};

// Ngưỡng cảnh báo đỏ ở bảng brand: TACoS > 30%, Biên LN < 15%
const BAD_TACOS = 0.3;
const BAD_MARGIN = 0.15;
const BAD = "font-semibold !text-rose-600";

// Kết quả tuần: Revenue · % WoW Revenue · Quantity · Ads Fee · Profit · % WoW Profit · TACoS · Biên LN; Tiến độ tháng: 4 cột
const BRAND_COLS: Col[] = [
  { key: "rev", label: "Revenue\ntuần này", sort: "revenue", render: (s) => <span className="font-semibold">{money(s.cur.revenue)}</span> },
  {
    key: "wow",
    label: "% WoW\nRevenue",
    sort: "dRevenue",
    render: (s, total) => (!total && isIdle(s) ? "—" : <WowPill value={wow(s.cur.revenue, s.prev.revenue)} size="sm" quiet />),
  },
  { key: "qty", label: "Quantity", render: (s) => int(s.cur.quantity) },
  { key: "ads", label: "Ads Fee", render: (s) => usd(s.cur.adsFee) },
  {
    key: "profit",
    label: "Profit",
    sort: "profit",
    strong: true,
    // Nền ô xanh / đỏ như cột Profit tab Day (profitCellStyle) → chữ đen cho dễ đọc
    render: (s) => <span className="font-bold !text-black">{usd(s.cur.profit)}</span>,
  },
  {
    key: "wowProfit",
    label: "% WoW\nProfit",
    sort: "dProfit",
    title: "Profit tuần này so với tuần trước: (này − trước) ÷ |trước|",
    render: (s, total) =>
      !total && isIdle(s) ? "—" : (
        <span title={`Tuần trước ${usd(s.prev.profit)}`}>
          <WowPill value={wow(s.cur.profit, s.prev.profit)} size="sm" quiet />
        </span>
      ),
  },
  {
    key: "tacos",
    label: "TACoS",
    sort: "tacos",
    render: (s) => {
      const v = ratiosOf(s.cur).tacos;
      return <span className={v != null && v > BAD_TACOS ? BAD : ""}>{pct(v)}</span>;
    },
  },
  {
    key: "margin",
    label: "Biên LN",
    sort: "margin",
    strong: true,
    render: (s) => {
      const v = ratiosOf(s.cur).margin;
      return <span className={`font-semibold ${v != null && v < BAD_MARGIN ? "!text-rose-600" : ""}`}>{pct(v)}</span>;
    },
  },
  {
    key: "mtd",
    label: "Profit\nlũy kế",
    month: true,
    title: "Profit cộng dồn từ ngày 1 đến ngày có số liệu",
    // Nền xanh / đỏ như cột Profit tuần (profitCellStyle) → chữ đen
    render: (s) => <span className="font-bold !text-black">{usd(s.mtd.profit)}</span>,
  },
  {
    key: "target",
    label: "Target Profit\ntháng",
    month: true,
    render: (s) => (s.profit ? <span className="font-semibold">{usd(s.profit.month.full)}</span> : ""),
  },
  {
    key: "pace",
    label: "% đạt Target\n(lũy kế)",
    month: true,
    sort: "pace",
    title: "Profit lũy kế ÷ Target tới ngày báo cáo (Target tháng × ngày ÷ số ngày tháng)",
    render: (s) => {
      const m = s.profit?.month;
      if (!m) return "";
      const tone = kpiTone(m.ratio);
      return <span className={`font-bold ${tone ? TONE_TEXT[tone] : ""}`}>{pct(m.ratio, 1)}</span>;
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
  const [sort, setSort] = useState<{ key: SortKey; dir: "desc" | "asc" } | null>(null);
  // TEAM: mỗi team 1 dòng tổng (mặc định) · BRAND: chi tiết từng brand trong team
  const [level, setLevel] = useState<"team" | "brand">("team");

  const cols = BRAND_COLS;
  const grouped = teams.length > 1;
  // Chỉ 1 team (lọc 1 store) thì luôn hiện brand, không có dòng team
  const showBrands = !grouped || level === "brand";
  const shownTeams = activeTeam ? teams.filter((t) => t.team === activeTeam) : teams;

  const order = (rows: { b: WeeklyBrandRow; s: GroupSummary }[]) => {
    // Brand không phát sinh luôn ẩn
    const list = rows.filter((r) => !isIdle(r.s));
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
    <section ref={sectionRef} aria-label="Kinh doanh theo Team/Brand" className={`${tableCard(theme)} scroll-mt-4`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2" title="Chia SKU như sheet: Win = Bảng mã trạng thái Phát triển, Test = trạng thái Test; FBM tính hết vào Win">
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
        {grouped && (
          <Segmented
            label="Mức xem"
            value={level}
            onChange={setLevel}
            options={[
              { value: "team", label: "TEAM" },
              { value: "brand", label: "BRAND" },
            ]}
          />
        )}
      </div>

      <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[1240px]`}>
            <thead>
              <tr className="text-[11.5px] font-bold uppercase tracking-wide">
                <th rowSpan={2} className={`${th} sticky left-0 z-[2] shadow-[inset_-2px_0_0_#000,6px_0_8px_-6px_rgba(0,0,0,0.25)] pl-4 !text-left !align-middle normal-case tracking-normal`}>
                  {showBrands ? "Brand" : "Team"}
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
                    PROFIT_COLS.has(c.key) ? "!bg-[#83C75D] !text-black !font-extrabold [&_*]:!font-extrabold" : ""
                  } ${
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

            {shownTeams.map((t, ti) => {
              const rows = order(t.brands);
              // Team không còn brand nào để hiện (đều không phát sinh) → bỏ cả dòng nhóm
              if (!rows.length) return null;
              return (
                <tbody key={t.team}>
                  {showBrands && rows.map(({ b, s }, ri) => {
                      const idle = isIdle(s);
                      const odd = ri % 2 === 1;
                      const bg = odd ? theme.stripe : "bg-white";
                      const neg = s.cur.profit < 0;
                      return (
                        <tr key={b.key} className={`group border-b border-slate-200/70 ${bg} ${idle ? "!text-slate-950" : "!text-slate-950"}`}>
                          {/* Cột Brand cố định khi cuộn ngang; brand lỗ có vạch đỏ bên trái */}
                          <td
                            className={`sticky left-0 z-[1] shadow-[inset_-2px_0_0_#000,6px_0_8px_-6px_rgba(0,0,0,0.25)] py-2.5 pr-3 text-left font-semibold ${bg} group-hover:bg-orange-50 ${grouped ? "pl-8" : "pl-4"} ${
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
                              style={PROFIT_COLS.has(c.key) ? profitCellStyle(profitColValue(c.key, s) ?? 0) : undefined}
                              className={`px-3 py-2.5 text-right font-medium ${PROFIT_COLS.has(c.key) ? "" : "group-hover:bg-orange-50"} ${cellGroup(c, i, odd)} ${
                                i === cols.length - 1 ? "pr-4" : ""
                              }`}
                            >
                              {c.render(s, false)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  {/* Dòng tổng của team nằm dưới các brand (tên team, luôn mở) */}
                  {grouped && (
                    // Dòng tổng team: nền xám đồng nhất cho mọi team, chữ đen đậm, kẻ đậm phía trên → tách rõ khỏi dòng brand
                    <tr className="border-t-2 border-t-slate-700" style={{ backgroundColor: teamTint(t.color, 0.22) }}>
                      <td
                        className="sticky left-0 z-[1] shadow-[inset_-2px_0_0_#000,6px_0_8px_-6px_rgba(0,0,0,0.25)] border-l-[6px] py-3 pr-3 pl-3 text-left !text-[14.5px] font-bold uppercase !tracking-wide !text-black"
                        style={{ borderLeftColor: t.color, backgroundColor: teamTint(t.color, 0.22) }}
                      >
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.team}
                        </span>
                      </td>
                      {cols.map((c, i) => (
                        <td
                          key={c.key}
                          style={PROFIT_COLS.has(c.key) ? profitCellStyle(profitColValue(c.key, t.summary) ?? 0) : { backgroundColor: teamTint(t.color, 0.22) }}
                          className={`px-3 py-3 text-right !text-[14.5px] font-bold !text-black ${i === firstMonth ? "border-l-2 border-[#FFB366]" : ""} ${
                            i === cols.length - 1 ? "pr-4" : ""
                          }`}
                        >
                          {c.render(t.summary, true)}
                        </td>
                      ))}
                    </tr>
                  )}
                  {/* Khoảng trống ngăn cách với team kế tiếp (không kẻ ô, cùng màu nền trang) */}
                  {grouped && showBrands && ti < shownTeams.length - 1 && (
                    <tr aria-hidden className="weekly-team-gap">
                      <td colSpan={cols.length + 1} />
                    </tr>
                  )}
                </tbody>
              );
            })}

            <tfoot>
              <tr className={`${theme.total} font-bold`}>
                <td className="sticky left-0 z-[1] shadow-[inset_-2px_0_0_#000,6px_0_8px_-6px_rgba(0,0,0,0.25)] bg-[#FFE0B2] py-3 pr-3 pl-4 text-left">{totalLabel}</td>
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    style={PROFIT_COLS.has(c.key) ? profitCellStyle(profitColValue(c.key, total) ?? 0) : undefined}
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
    </section>
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

type Prepaid = { units: number | null; value: number | null };

/**
 * Ô nhập trả trước cho SUP (cột hồng như sheet). Lưu khi rời ô / Enter; Esc để huỷ.
 */
function PrepaidInput({
  value,
  integer,
  label,
  onSave,
  width = "w-[96px]",
  placeholder = "",
  allowNegative = false,
  tone = "rose",
}: {
  value: number | null;
  integer: boolean;
  label: string;
  onSave: (v: number | null) => Promise<void>;
  width?: string;
  placeholder?: string;
  allowNegative?: boolean;
  tone?: "rose" | "orange";
}) {
  // Khi không gõ: hiện có dấu phẩy ngăn nghìn cho dễ đọc
  const shown = value == null ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const commit = async () => {
    if (draft == null) return;
    let raw = draft.replace(/[,$\s]/g, "");
    // Kiểu Việt "26.000" / "7.809.700" = dấu chấm ngăn nghìn
    if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
    const next = raw === "" ? null : Number(raw);
    if (next != null && (!Number.isFinite(next) || (!allowNegative && next < 0) || (integer && !Number.isInteger(next)))) {
      setStatus("error");
      setError(allowNegative ? "Nhập một số" : integer ? "Nhập số nguyên ≥ 0" : "Nhập số ≥ 0");
      return;
    }
    if (next === value) {
      setDraft(null);
      return;
    }
    setStatus("saving");
    try {
      await onSave(next);
      setDraft(null);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Không lưu được");
    }
  };
  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      aria-label={label}
      value={draft ?? shown}
      placeholder={placeholder}
      disabled={status === "saving"}
      title={status === "error" ? error : "Kế toán nhập · Enter hoặc bấm ra ngoài để lưu, Esc để huỷ"}
      onFocus={(e) => {
        // Bấm vào ô: hiện số gốc (không dấu phẩy) và chọn hết → gõ là thay số cũ, không bị nối thêm
        if (draft == null) setDraft(value == null ? "" : String(value));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (status === "error") setStatus("idle");
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          setStatus("idle");
        }
      }}
      className={`${width} rounded-md border bg-white px-2.5 py-1.5 text-right font-semibold tabular-nums !text-slate-950 outline-none placeholder:font-normal placeholder:!text-slate-400 ${
        tone === "orange" ? "focus:border-orange-400 focus:ring-2 focus:ring-orange-200" : "focus:ring-2 focus:ring-rose-300"
      } ${status === "error" ? "border-rose-500 !text-rose-700" : tone === "orange" ? "border-orange-200 hover:border-orange-300" : "border-rose-200"} ${
        status === "saving" ? "opacity-60" : ""
      }`}
    />
  );
}

// Cột hồng = kế toán nhập (như sheet); cột cam nhạt = tồn Amazon tự lấy; Tổng = AMZ + trả trước
const PREPAID_TH = "!bg-[#F4CCCC]";
const PREPAID_TD = "bg-rose-50";

function StockBlock({
  stock,
  days,
  weekStart,
  canEdit,
  teamOfStore,
}: {
  stock: WeeklyReport["stock"];
  days: number;
  weekStart: string;
  canEdit: boolean;
  /** storeId → team (FBA TEAM 1…) — gom store theo team như bảng brand */
  teamOfStore: Map<string, string>;
}) {
  // Mặc định đóng hết các team; bấm dòng team để mở danh sách store
  const [openTeams, setOpenTeams] = useState<Set<string>>(() => new Set());
  const toggleTeam = (team: string) =>
    setOpenTeams((cur) => {
      const next = new Set(cur);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  // Số đã lưu trong phiên (không phải tải lại cả báo cáo)
  const [saved, setSaved] = useState<Record<string, Prepaid>>({});
  const prepaidOf = (s: WeeklyReport["stock"][number]): Prepaid =>
    saved[`${weekStart}|${s.storeId}`] ?? { units: s.prepaidUnits ?? null, value: s.prepaidValue ?? null };
  const save = async (s: WeeklyReport["stock"][number], patch: Partial<Prepaid>) => {
    const next = { ...prepaidOf(s), ...patch };
    const res = await fetch("/api/accounting/financials/weekly-report/prepaid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_id: s.storeId, week_start: weekStart, units: next.units, value: next.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || "Không lưu được");
    setSaved((cur) => ({ ...cur, [`${weekStart}|${s.storeId}`]: next }));
  };

  const perWeekOf = (sold: number) => (days ? (sold * 7) / days : 0);
  const rows = stock
    .map((s) => {
      const p = prepaidOf(s);
      const units = s.units + (p.units ?? 0);
      const value = s.value + (p.value ?? 0);
      const perWeek = perWeekOf(s.soldInPeriod);
      const weeksLeft = perWeek > 0 && units > 0 ? units / perWeek : null;
      return { s, p, units, value, perWeek, weeksLeft, state: stockState(units, perWeek, weeksLeft) };
    })
    .sort((a, b) => a.state.rank - b.state.rank || b.value - a.value);
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const totalValue = sum((r) => r.value);
  const totalPerWeek = sum((r) => r.perWeek);
  // Số tuần bán hết cấp tổng: chỉ tính brand vừa có tồn vừa có bán
  const valid = rows.filter((r) => r.weeksLeft != null);
  const validUnits = valid.reduce((n, r) => n + r.units, 0);
  const validPerWeek = valid.reduce((n, r) => n + r.perWeek, 0);
  const totalWeeks = validPerWeek > 0 ? validUnits / validPerWeek : null;
  const excluded = rows.length - valid.length;
  // Gom theo team (FBA TEAM 1, 2, 3…); store chưa gán team → "Khác"
  type StockRow = (typeof rows)[number];
  const byTeam = new Map<string, StockRow[]>();
  for (const r of rows) {
    const team = teamOfStore.get(r.s.storeId) ?? "Khác";
    byTeam.set(team, [...(byTeam.get(team) ?? []), r]);
  }
  const teamGroups = [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }));
  const theme = useTheme();
  const th = thCls(theme);
  const ncol = 11;
  return (
    <div className={`${tableCard(theme)} h-full`}>
      <div className="overflow-x-auto">
        <table className={`${TABLE} min-w-[1100px]`}>
          <thead>
            <tr>
              <th className={`${th} pl-4 !text-left`}>Brand</th>
              <th className={th}>{"SL tồn\nAMZ"}</th>
              <th className={th}>{"Giá trị tồn\nAMZ ($)"}</th>
              <th className={`${th} ${PREPAID_TH}`}>{"SL trả trước\ncho SUP"}</th>
              <th className={`${th} ${PREPAID_TH}`}>{"Giá trị\ntrả trước ($)"}</th>
              <th className={th}>{"Tổng\nSL tồn"}</th>
              <th className={th}>{"Tổng\ntồn kho ($)"}</th>
              <th className={th}>% tổng tồn</th>
              <th className={th}>Bán / tuần</th>
              <th className={th}>{"Số tuần\nbán hết"}</th>
              <th className={`${th} pr-4 !text-center`}>Trạng thái</th>
            </tr>
          </thead>
          {teamGroups.map(([team, list], gi) => {
            const open = openTeams.has(team);
            const color = teamColor(team);
            const g = (pick: (r: StockRow) => number) => list.reduce((n, r) => n + pick(r), 0);
            const gValid = list.filter((r) => r.weeksLeft != null);
            const gPerWeekValid = gValid.reduce((n, r) => n + r.perWeek, 0);
            const gWeeks = gPerWeekValid > 0 ? gValid.reduce((n, r) => n + r.units, 0) / gPerWeekValid : null;
            const gShare = div(g((r) => r.value), totalValue);
            const alert = list.filter((r) => r.state.tone === "bad").length;
            const bg = teamTint(color, 0.22);
            return (
              <tbody key={team}>
                {open &&
                  list.map(({ s, p, units, value, perWeek, weeksLeft, state }) => {
                    const share = div(value, totalValue);
                    return (
                      <tr key={s.storeId} className={rowCls(theme)}>
                        <td className="py-2.5 pr-3 pl-9 font-semibold !text-slate-900">{s.label}</td>
                        <td className="px-3 py-2 text-right font-medium">{int(s.units)}</td>
                        <td className="px-3 py-2 text-right font-medium">{usd(s.value)}</td>
                        <td className={`px-3 py-1.5 text-right ${PREPAID_TD}`}>
                          {canEdit ? (
                            <PrepaidInput value={p.units} integer label={`SL trả trước cho SUP — ${s.label}`} onSave={(v) => save(s, { units: v })} />
                          ) : (
                            <span className="font-medium">{p.units == null ? "" : int(p.units)}</span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 text-right ${PREPAID_TD}`}>
                          {canEdit ? (
                            <PrepaidInput value={p.value} integer={false} label={`Giá trị trả trước — ${s.label}`} onSave={(v) => save(s, { value: v })} />
                          ) : (
                            <span className="font-medium">{p.value == null ? "" : usd(p.value)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold !text-slate-950">{int(units)}</td>
                        <td className="px-3 py-2 text-right font-bold !text-slate-950">{usd(value)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="ml-auto flex w-[96px] items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-orange-400" style={{ width: `${(share ?? 0) * 100}%` }} />
                            </div>
                            <span className="w-10 text-right font-medium !text-slate-800">{pct(share, 0)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{int(perWeek)}</td>
                        <td className="px-3 py-2 text-right font-bold">{weeksLeft == null ? "" : weeksLeft.toFixed(1)}</td>
                        <td className="px-3 py-2 pr-4 text-center">
                          {state.tone ? (
                            <StatusChip tone={state.tone} label={state.label} title={state.title} />
                          ) : (
                            <span className="!text-[12px] !text-slate-950">{state.label}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {/* Dòng team: tổng các store trong team, bấm để mở / đóng */}
                <tr className="cursor-pointer border-t-2 border-t-slate-700" style={{ backgroundColor: bg }} onClick={() => toggleTeam(team)}>
                  <td
                    className="border-l-[6px] py-3 pr-3 pl-3 text-left !text-[14.5px] font-bold uppercase !tracking-wide !text-black"
                    style={{ borderLeftColor: color, backgroundColor: bg }}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTeam(team);
                      }}
                      title={open ? "Đóng danh sách store" : "Mở danh sách store"}
                      className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded font-bold uppercase !text-black focus-visible:outline-2 focus-visible:outline-slate-900"
                    >
                      {open ? <CaretDownIcon size={12} weight="bold" /> : <CaretRightIcon size={12} weight="bold" />}
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      {team}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{int(g((r) => r.s.units))}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{usd(g((r) => r.s.value))}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{g((r) => r.p.units ?? 0) ? int(g((r) => r.p.units ?? 0)) : ""}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{g((r) => r.p.value ?? 0) ? usd(g((r) => r.p.value ?? 0)) : ""}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{int(g((r) => r.units))}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{usd(g((r) => r.value))}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{pct(gShare, 0)}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{int(g((r) => r.perWeek))}</td>
                  <td className="px-3 py-3 text-right !text-[14px] font-bold !text-black" style={{ backgroundColor: bg }}>{gWeeks == null ? "" : gWeeks.toFixed(1)}</td>
                  <td className="px-3 py-3 pr-4 text-center !text-[12.5px] font-semibold" style={{ backgroundColor: bg }}>
                    {alert ? <span className="font-bold !text-rose-700">{alert} store cần xử lý</span> : ""}
                  </td>
                </tr>
                {gi < teamGroups.length - 1 && (
                  <tr aria-hidden className="weekly-team-gap">
                    <td colSpan={ncol} />
                  </tr>
                )}
              </tbody>
            );
          })}
          <tfoot>
            <tr className={`${theme.total} font-bold`}>
              <td className="py-2.5 pr-3 pl-4">TỔNG</td>
              <td className="px-3 py-2.5 text-right">{int(sum((r) => r.s.units))}</td>
              <td className="px-3 py-2.5 text-right">{usd(sum((r) => r.s.value))}</td>
              <td className="px-3 py-2.5 text-right">{int(sum((r) => r.p.units ?? 0))}</td>
              <td className="px-3 py-2.5 text-right">{usd(sum((r) => r.p.value ?? 0))}</td>
              <td className="px-3 py-2.5 text-right">{int(sum((r) => r.units))}</td>
              <td className="px-3 py-2.5 text-right">{usd(totalValue)}</td>
              <td className="px-3 py-2.5 text-right">100%</td>
              <td className="px-3 py-2.5 text-right">{int(totalPerWeek)}</td>
              <td
                className="px-3 py-2.5 text-right"
                title={`Tổng SL tồn ÷ tổng bán/tuần của ${valid.length} brand vừa có tồn vừa có bán${excluded ? ` (bỏ ${excluded} brand hết tồn hoặc không bán)` : ""}`}
              >
                {totalWeeks == null ? "—" : totalWeeks.toFixed(1)}
                {excluded > 0 && totalWeeks != null && <span className="ml-0.5 align-super text-[10px] !text-slate-950">*</span>}
              </td>
              <td className="px-3 py-2.5 pr-4" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Mục tiền (thu gọn): bấm tiêu đề để mở bảng dòng tiền + Payment theo store */
function MoneySection({
  payout,
  payoutMonth,
  cashflow,
  canEdit,
}: {
  payout: NonNullable<WeeklyReport["payout"]>;
  payoutMonth: WeeklyReport["payoutMonth"];
  cashflow: WeeklyCashflow | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-orange-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
      >
        <span className="flex items-center gap-2.5 !text-[20px] font-bold !tracking-tight !text-slate-950">
          <span className="h-6 w-1.5 rounded-full bg-orange-500" />
          Tài chính & dòng tiền
          <span className="rounded-md bg-orange-100 px-2 py-0.5 !text-[12px] font-bold !text-orange-800">Admin / Kế toán</span>
        </span>
        <span className="flex items-center gap-2 text-[13px] font-semibold !text-slate-950">
          {open ? "Thu gọn" : "Mở"}
          <CaretDownIcon size={14} weight="bold" className={`transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-3 grid gap-5 xl:grid-cols-12">
          {cashflow && (
            <div className="xl:col-span-8">
              <CashflowBlock key={cashflow.weekStart} cashflow={cashflow} payment={payout.current} canEdit={canEdit} />
            </div>
          )}
          {payoutMonth && (
            <div className={cashflow ? "xl:col-span-4" : "xl:col-span-6"}>
              <PayoutBlock payout={payoutMonth} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * VI. Tài chính & dòng tiền — đúng các dòng của sheet. Payment lấy từ hệ thống (payout); ô có khung = admin / kế toán
 * nhập theo tuần; còn lại web tính. Ô trống để trắng.
 */
function CashflowBlock({ cashflow, payment, canEdit }: { cashflow: WeeklyCashflow; payment: number; canEdit: boolean }) {
  const [values, setValues] = useState<CashflowValues>(cashflow.values);
  const c = computeCashflow({ ...cashflow, values }, payment);
  const save = (f: CashflowField) => async (v: number | null) => {
    const res = await fetch("/api/accounting/financials/weekly-report/cashflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_start: cashflow.weekStart, values: { [f]: v } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || "Không lưu được");
    setValues(body.values ?? {});
  };
  const num = (v: number | null | undefined, digits = 0) =>
    v == null || v === 0 ? "" : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const edit = (f: CashflowField, label: string, opts: { placeholder?: string; allowNegative?: boolean; digits?: number } = {}) =>
    canEdit ? (
      <PrepaidInput
        value={values[f] ?? null}
        integer={false}
        label={label}
        onSave={save(f)}
        width="w-[170px]"
        placeholder={opts.placeholder}
        allowNegative={opts.allowNegative}
        tone="orange"
      />
    ) : (
      num(values[f], opts.digits)
    );

  type Line =
    | { kind: "head"; label: string }
    | { kind: "row"; label: string; value: ReactNode; total?: boolean; negative?: boolean; hint?: string };
  // Đúng các dòng của sheet: ô có khung = kế toán điền; còn lại lấy từ hệ thống / tự tính
  const lines: Line[] = [
    { kind: "head", label: "1. Dòng tiền KINH DOANH" },
    { kind: "row", label: "Payment (USD)", value: num(c.payment, 2), hint: "Lấy từ hệ thống: Amazon giải ngân (payout Done) trong tuần" },
    { kind: "row", label: "Chi mua hàng (USD + quy đổi VND)", value: edit("purchase", "Chi mua hàng (USD + quy đổi VND)", { digits: 2 }) },
    { kind: "row", label: "Dòng tiền kinh doanh ròng", value: num(c.net, 2), total: true, negative: c.net < 0, hint: "Payment − Chi mua hàng" },
    { kind: "head", label: "2. Dòng tiền VẬN HÀNH (CPVH)" },
    { kind: "row", label: "CPVH chung (VND)", value: edit("cpvhCommon", "CPVH chung") },
    { kind: "row", label: "CPVH Tiktok/khác (VND)", value: edit("tiktok", "CPVH Tiktok/khác") },
    { kind: "row", label: "TỔNG CPVH", value: num(c.cpvh), total: true, hint: "CPVH chung + CPVH Tiktok/khác" },
    { kind: "head", label: "3. VỐN & SINH HOẠT" },
    { kind: "row", label: "Topup vốn trong tuần (VND)", value: edit("topup", "Topup vốn trong tuần") },
    { kind: "head", label: "SỐ DƯ QUỸ TIỀN VIỆT" },
    {
      kind: "row",
      label: "Số dư quỹ đầu tuần",
      hint: cashflow.carriedOpening == null ? "Tuần đầu tiên: nhập số dư" : "Tự lấy số dư cuối tuần trước; nhập để đặt lại",
      value: canEdit ? (
        <PrepaidInput
          value={values.openingBalance ?? null}
          integer={false}
          label="Số dư quỹ đầu tuần"
          onSave={save("openingBalance")}
          width="w-[170px]"
          placeholder={num(cashflow.carriedOpening)}
          allowNegative
          tone="orange"
        />
      ) : (
        num(c.opening)
      ),
    },
    { kind: "row", label: "Tổng thu trong tuần", value: num(c.income), hint: "= Topup vốn trong tuần" },
    { kind: "row", label: "Tổng chi trong tuần", value: edit("totalSpend", "Tổng chi trong tuần") },
    { kind: "row", label: "Số dư quỹ cuối tuần", value: c.closing == null ? "" : num(c.closing) || "0", total: true, negative: (c.closing ?? 0) < 0, hint: "Đầu tuần + Tổng thu − Tổng chi" },
  ];
  type Row = Extract<Line, { kind: "row" }>;
  const groups: { title: string; rows: Row[] }[] = [];
  for (const l of lines) {
    if (l.kind === "head") groups.push({ title: l.label, rows: [] });
    else groups[groups.length - 1]?.rows.push(l);
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      {groups.map((g) => (
        <div key={g.title} className="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm">
          <div className="bg-[#FF8C00] px-4 py-2.5 text-[14px] font-bold !text-black">{g.title}</div>
          <table className="w-full border-collapse tabular-nums">
            <tbody>
              {g.rows.map((l) => (
                <tr key={l.label} className={`border-b border-orange-100 last:border-b-0 ${l.total ? "bg-orange-100" : ""}`}>
                  <td className={`py-2 pr-3 pl-4 font-bold !text-slate-950 ${l.total ? "!text-[14.5px]" : "!text-[13.5px]"}`} title={l.hint}>
                    {l.label}
                  </td>
                  <td
                    className={`px-4 py-1.5 text-right font-bold ${l.total ? "!text-[15px]" : "!text-[14px]"} ${l.negative ? "!text-rose-600" : "!text-slate-950"}`}
                  >
                    {l.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** Payment theo tháng: lũy kế tháng này (mùng 1 → cuối tuần) so với cùng kỳ tháng trước; kèm cả tháng trước */
function PayoutBlock({ payout }: { payout: NonNullable<WeeklyReport["payoutMonth"]> }) {
  const max = Math.max(1, ...payout.byStore.map((p) => Math.max(p.current, p.previous)));
  const rows = [...payout.byStore].filter((p) => p.current || p.previous || p.previousFull).sort((a, b) => b.current - a.current);
  const theme = useTheme();
  const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  const r = payout.range;
  const cur = `${dm(r.start)}–${dm(r.end)}`;
  const prev = `${dm(r.prevStart)}–${dm(r.prevEnd)}`;
  return (
    <div className={`${tableCard(theme)} h-full`}>
      <div className="flex items-end justify-between gap-3 border-b border-[#D97300] bg-[#FF8C00] px-5 py-4 !text-black">
        <div>
          <div className="text-sm font-bold !text-black">Payment tháng {Number(r.end.slice(5, 7))} — Amazon đã giải ngân ({cur})</div>
          <div className="text-[28px] font-bold leading-tight tabular-nums !text-black">{usd2(payout.current)}</div>
          <div
            className="text-[13px] !text-black/80"
            title="Tổng Disbursement trạng thái Done có ngày nhận (Acknowledged) trong khoảng ngày; không phải doanh thu hay lợi nhuận"
          >
            Cùng kỳ tháng trước ({prev}) {usd2(payout.previous)} · cả tháng {Number(r.prevStart.slice(5, 7))} {usd2(payout.previousFull)}
          </div>
        </div>
        <WowPill value={wow(payout.current, payout.previous)} />
      </div>
      <ul className="divide-y divide-orange-100 px-5 py-1">
        {rows.map((p) => (
          <li key={p.storeName} className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 py-2 text-[13px]">
            <span className="truncate font-semibold !text-slate-950" title={p.storeName}>
              {p.storeName}
            </span>
            <div
              className="flex flex-col gap-1"
              title={`Tháng này (${cur}) ${usd2(p.current)} · cùng kỳ tháng trước (${prev}) ${usd2(p.previous)} · cả tháng trước ${usd2(p.previousFull)}`}
            >
              <div className="h-2 rounded-full bg-orange-500" style={{ width: `${Math.max(1, (p.current / max) * 100)}%` }} />
              <div className="h-1 rounded-full bg-slate-300" style={{ width: `${Math.max(1, (p.previous / max) * 100)}%` }} />
            </div>
            <span className="flex items-center gap-2 tabular-nums">
              <b className="font-semibold !text-slate-950">{usdK(p.current)}</b>
              <WowPill value={wow(p.current, p.previous)} quiet />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
