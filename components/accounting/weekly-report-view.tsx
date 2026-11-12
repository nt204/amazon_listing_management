"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  CoinsIcon,
  CurrencyDollarIcon,
  MegaphoneIcon,
  PercentIcon,
  type Icon,
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

// BÁO CÁO TUẦN — tổng quan tuần đạt bao nhiêu % mục tiêu tuần và lũy kế tháng đạt bao nhiêu % mục tiêu tháng

const usd = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v < 0
    ? `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

const usd2 = (v: number | null | undefined) => usd(v, 2);

const int = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");

const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

const div = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(b) > 1e-9 ? a / b : null;

const wow = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur != null && prev != null && Math.abs(prev) > 1e-9 ? (cur - prev) / Math.abs(prev) : null;

/** Chênh lệch điểm % giữa 2 tỷ lệ (Biên LN, TACoS) */
const ptDiff = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);

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

function WowBadge({ value, inverse = false }: { value: number | null | undefined; inverse?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-300">—</span>;
  const isPos = value > 0;
  const isGood = inverse ? !isPos : isPos;
  const cls = Math.abs(value) < 0.001
    ? "text-slate-400"
    : isGood
    ? "text-emerald-700 font-semibold"
    : "text-rose-600 font-semibold";
  const sign = value > 0 ? "+" : "";
  return <span className={cls}>{`${sign}${(value * 100).toFixed(1)}%`}</span>;
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

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-50 font-accounting-system">
      <AccountingTopProgressBar loading={loading} variant="amber" />

      {/* TOOLBAR: Thanh điều khiển tuần & chọn store */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Tuần
          </span>

          {/* Chọn tuần */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Tuần trước"
              disabled={!week || loading}
              onClick={() => week && setDate(previousWeekSegment(week).startDate)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer transition"
            >
              <CaretLeftIcon size={14} weight="bold" />
            </button>

            <label className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-800 hover:border-slate-300">
              <CalendarBlankIcon size={14} weight="bold" className="text-amber-600" />
              <select
                aria-label="Chọn tuần"
                className="bg-transparent text-xs font-bold outline-none cursor-pointer pr-1"
                value={week?.startDate ?? ""}
                onChange={(e) => setDate(e.target.value)}
              >
                {week && !weeks.some((w) => w.startDate === week.startDate) && (
                  <option value={week.startDate}>{week.label}</option>
                )}
                {weeks.map((w) => (
                  <option key={w.startDate} value={w.startDate}>
                    {w.label} ({vnDate(w.startDate)} – {vnDate(w.endDate)})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              aria-label="Tuần sau"
              disabled={!canNext || loading}
              onClick={() => week && setDate(nextWeekSegment(week).startDate)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 cursor-pointer transition"
            >
              <CaretRightIcon size={14} weight="bold" />
            </button>
          </div>

          {/* Badge trạng thái tuần */}
          {data && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {vnDate(data.week.startDate)} – {vnDate(data.week.endDate)}
              </span>
              {isCurrentWeek ? (
                <span className="rounded-full bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                  Đang chạy · Dữ liệu đến {vnDate(data.dataThrough)} ({data.days}/{data.week.days} ngày)
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  Đã chốt sổ (đủ {data.days} ngày)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Lọc store & Refresh */}
        <div className="flex items-center gap-2">
          {data && (
            <select
              aria-label="Lọc theo Store"
              value={selectedStoreKey}
              onChange={(e) => setSelectedStoreKey(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 outline-none hover:border-slate-300 cursor-pointer"
            >
              <option value="all">Tất cả Store ({data.brands.length})</option>
              {data.brands.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition"
          >
            <ArrowClockwiseIcon size={13} className={loading ? "animate-spin" : ""} />
            Làm mới
          </button>
        </div>
      </div>

      {/* BODY CONTENT */}
      <div className={`flex-1 overflow-y-auto p-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {error.message}
          </div>
        )}
        {data && (
          <WeeklyDashboardBody
            data={data}
            selectedStoreKey={selectedStoreKey}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// % ĐẠT — 1 quy tắc cho mọi con số % trên trang (như cột F/L của sheet "BÁO CÁO TUẦN TỔNG HỢP"):
//   % đạt = đã làm được ÷ mức CẦN ĐẠT tính tới ngày có số liệu
//   Cần đạt (tuần)  = KPI tháng × số ngày đã có số liệu trong tuần ÷ số ngày tháng  (tuần đã chốt = cả tuần)
//   Cần đạt (tháng) = KPI tháng × ngày cuối có số liệu ÷ số ngày tháng
//   Màu: ≥ 100% xanh · ≥ 85% vàng · còn lại đỏ (team: THƯỞNG / ĐẠT / PHÊ BÌNH).
// KPI = mục tiêu SKU WIN trên trang KPI kinh doanh (chỉ FBA). Số thực tế để tính % chỉ cộng các dòng có KPI,
// để dòng chưa có KPI (FBM) không làm % bị thổi lên.
// ---------------------------------------------------------------------------

interface PaceContext {
  /** Số ngày trong tháng của kỳ */
  dim: number;
  /** Số ngày của kỳ tuần (tuần vắt tháng thì < 7) */
  weekDays: number;
  /** Số ngày đã có số liệu trong kỳ */
  elapsed: number;
  /** Ngày cuối có số liệu ÷ số ngày tháng */
  monthPace: number;
}

interface Achieve {
  /** Đã làm được */
  actual: number;
  /** Cần đạt tới ngày có số liệu */
  due: number;
  /** Mục tiêu cả kỳ (tuần / tháng) */
  full: number;
  /** actual ÷ due */
  ratio: number | null;
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

const achieve = (actual: number, due: number, full: number): Achieve => ({ actual, due, full, ratio: kpiRatio(actual, due) });

function progressOf(actualWeek: number, actualMtd: number, monthTarget: number, ctx: PaceContext): MetricProgress {
  const perDay = monthTarget / ctx.dim;
  return {
    week: achieve(actualWeek, perDay * ctx.elapsed, perDay * ctx.weekDays),
    month: achieve(actualMtd, monthTarget * ctx.monthPace, monthTarget),
  };
}

function summarize(rows: WeeklyBrandRow[], ctx: PaceContext): GroupSummary {
  const sum = (pick: (b: WeeklyBrandRow) => WeeklyMetrics, list = rows) => list.reduce((s, b) => add(s, pick(b)), ZERO);
  const targeted = rows.filter((b) => b.target);
  let revenue: MetricProgress | null = null;
  let profit: MetricProgress | null = null;
  if (targeted.length) {
    const tCur = sum((b) => b.current, targeted);
    const tMtd = sum((b) => b.mtd, targeted);
    revenue = progressOf(tCur.revenue, tMtd.revenue, targeted.reduce((s, b) => s + b.target!.revenue, 0), ctx);
    profit = progressOf(tCur.profit, tMtd.profit, targeted.reduce((s, b) => s + b.target!.profit, 0), ctx);
  }
  return {
    cur: sum((b) => b.current),
    prev: sum((b) => b.previous),
    mtd: sum((b) => b.mtd),
    rows: rows.length,
    targetedRows: targeted.length,
    revenue,
    profit,
  };
}

/** % WoW; hai kỳ khác số ngày (tuần vắt tháng / tuần đang chạy) thì so theo trung bình mỗi ngày */
function wowOf(cur: number, prev: number, days: number, prevDays: number): number | null {
  if (days > 0 && prevDays > 0 && days !== prevDays) return wow(cur / days, prev / prevDays);
  return wow(cur, prev);
}

/** Màu nhận diện ô chỉ số phụ */
const ACCENT = {
  violet: { tile: "bg-violet-50 text-violet-600 ring-violet-100" },
  sky: { tile: "bg-sky-50 text-sky-600 ring-sky-100" },
  emerald: { tile: "bg-emerald-50 text-emerald-600 ring-emerald-100" },
  amber: { tile: "bg-amber-50 text-amber-600 ring-amber-100" },
} as const;
type Accent = keyof typeof ACCENT;

const TONE_CLASS = {
  good: { bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 border-emerald-200", text: "text-emerald-700" },
  near: { bar: "bg-amber-500", pill: "bg-amber-50 text-amber-800 border-amber-200", text: "text-amber-700" },
  bad: { bar: "bg-rose-500", pill: "bg-rose-50 text-rose-700 border-rose-200", text: "text-rose-600" },
} as const;

const TEAM_LABEL = { good: "THƯỞNG", near: "ĐẠT", bad: "PHÊ BÌNH" } as const;

// ---------------------------------------------------------------------------
// NỘI DUNG CHÍNH
// ---------------------------------------------------------------------------

function WeeklyDashboardBody({ data, selectedStoreKey }: { data: WeeklyReport; selectedStoreKey: string }) {
  const { week, brands } = data;
  const selectedStoreId = selectedStoreKey === "all" ? null : selectedStoreKey.split("|")[0];

  const visibleBrands = useMemo(
    () => (selectedStoreKey === "all" ? brands : brands.filter((b) => b.key === selectedStoreKey)),
    [brands, selectedStoreKey],
  );
  const tests = selectedStoreId ? data.tests.filter((t) => t.storeId === selectedStoreId) : data.tests;
  const stock = selectedStoreId ? data.stock.filter((s) => s.storeId === selectedStoreId) : data.stock;

  const ctx: PaceContext = useMemo(
    () => ({
      dim: daysInMonthOf(week.startDate),
      weekDays: week.days || 7,
      elapsed: Math.max(1, data.days || 1),
      monthPace: data.monthPace,
    }),
    [week.startDate, week.days, data.days, data.monthPace],
  );

  const total = useMemo(() => summarize(visibleBrands, ctx), [visibleBrands, ctx]);
  const teams = useMemo(() => {
    const byTeam = new Map<string, WeeklyBrandRow[]>();
    for (const b of visibleBrands) byTeam.set(b.team, [...(byTeam.get(b.team) ?? []), b]);
    return Array.from(byTeam, ([team, rows]) => ({ team, brands: rows, ...summarize(rows, ctx) }));
  }, [visibleBrands, ctx]);

  const isRunning = data.dataThrough < week.endDate;
  const month = Number(week.startDate.slice(5, 7));
  const prevDays = data.previousDays;
  const untargeted = visibleBrands.filter((b) => !b.target).map((b) => b.label);

  const [showTests, setShowTests] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showPayout, setShowPayout] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4">
      {/* 1. TỔNG QUAN */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <OverviewCard
          title={`Tuần ${week.label}`}
          subtitle={isRunning ? `Tới ${vnDate(data.dataThrough)} · ${ctx.elapsed}/${ctx.weekDays} ngày` : `Đủ ${ctx.weekDays} ngày`}
          fullLabel="Cả tuần"
          items={[
            { label: "Revenue", a: total.revenue?.week ?? null },
            { label: "Profit", a: total.profit?.week ?? null },
          ]}
        />
        <OverviewCard
          title={`Tháng ${month}`}
          subtitle={`Tới ${vnDate(data.dataThrough)} · ${Number(data.dataThrough.slice(8, 10))}/${ctx.dim} ngày`}
          fullLabel="Cả tháng"
          items={[
            { label: "Revenue", a: total.revenue?.month ?? null },
            { label: "Profit", a: total.profit?.month ?? null },
          ]}
        />
      </div>

      {/* Chỉ số phụ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Revenue tuần"
          icon={CurrencyDollarIcon}
          accent="sky"
          value={usd(total.cur.revenue)}
          prevText={`Tuần trước ${usd(total.prev.revenue)}`}
          delta={wowOf(total.cur.revenue, total.prev.revenue, data.days, prevDays)}
        />
        <StatCard
          label="Profit tuần"
          icon={CoinsIcon}
          accent="emerald"
          value={usd(total.cur.profit)}
          prevText={`Tuần trước ${usd(total.prev.profit)}`}
          delta={wowOf(total.cur.profit, total.prev.profit, data.days, prevDays)}
        />
        <StatCard
          label="Biên LN"
          icon={PercentIcon}
          accent="violet"
          value={pct(div(total.cur.profit, total.cur.revenue))}
          prevText={`Tuần trước ${pct(div(total.prev.profit, total.prev.revenue))}`}
          delta={ptDiff(div(total.cur.profit, total.cur.revenue), div(total.prev.profit, total.prev.revenue))}
          deltaKind="pt"
        />
        <StatCard
          label="TACoS"
          icon={MegaphoneIcon}
          accent="amber"
          value={pct(div(total.cur.adsFee, total.cur.revenue))}
          prevText={`Tuần trước ${pct(div(total.prev.adsFee, total.prev.revenue))}`}
          delta={ptDiff(div(total.cur.adsFee, total.cur.revenue), div(total.prev.adsFee, total.prev.revenue))}
          deltaKind="pt"
          inverse
        />
      </div>

      {untargeted.length > 0 && (
        <p className="-mt-1 text-[11px] text-slate-500">Chưa có KPI: {untargeted.join(", ")}</p>
      )}

      {/* 2. P/L THEO NGƯỜI PHỤ TRÁCH — mỗi team 1 thẻ */}
      {selectedStoreKey === "all" && teams.length > 1 && (
        <section>
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-wider text-slate-500">P/L theo người phụ trách</h3>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${teams.length >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
            {teams.map((t) => (
              <TeamCard key={t.team} team={t.team} s={t} days={data.days} prevDays={prevDays} />
            ))}
          </div>
        </section>
      )}

      {/* 3. KINH DOANH THEO BRAND — gom theo team */}
      <section className="acc-grid-off overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-900">Kinh doanh theo brand (SKU WIN)</h3>
          <span className="text-xs text-slate-500">{visibleBrands.length} brand</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-[12.5px] tabular-nums">
            <thead>
              <tr className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                <th className="bg-transparent px-4 pb-1 pt-3 text-left" />
                <th colSpan={4} className="bg-transparent px-3 pb-1 pt-3 text-center">
                  <div className="border-b border-slate-200 pb-1">Tuần này</div>
                </th>
                <th colSpan={2} className="bg-transparent px-3 pb-1 pt-3 text-center">
                  <div className="border-b border-slate-200 pb-1">% đạt tuần</div>
                </th>
                <th colSpan={2} className="bg-transparent px-3 pb-1 pt-3 text-center">
                  <div className="border-b border-slate-200 pb-1">Lũy kế tháng</div>
                </th>
                <th colSpan={2} className="bg-transparent px-3 pb-1 pt-3 text-center">
                  <div className="border-b border-slate-200 pb-1">% đạt tháng</div>
                </th>
              </tr>
              <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="bg-transparent px-4 py-2 text-left">Brand</th>
                <th className="bg-transparent px-3 py-2 text-right">Revenue</th>
                <th className="bg-transparent px-3 py-2 text-right">Profit</th>
                <th className="bg-transparent px-3 py-2 text-right">Biên LN</th>
                <th className="bg-transparent px-3 py-2 text-right">TACoS</th>
                <th className="bg-transparent px-3 py-2 text-center">Revenue</th>
                <th className="bg-transparent px-3 py-2 text-center">Profit</th>
                <th className="bg-transparent px-3 py-2 text-right">Revenue</th>
                <th className="bg-transparent px-3 py-2 text-right">Profit</th>
                <th className="bg-transparent px-3 py-2 text-center">Revenue</th>
                <th className="bg-transparent px-3 py-2 text-center">Profit</th>
              </tr>
            </thead>
            {teams.map((t) => (
              <tbody key={t.team}>
                {teams.length > 1 && (
                  <tr className="bg-slate-50/80">
                    <td colSpan={11} className="px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                      {t.team}
                    </td>
                  </tr>
                )}
                {t.brands.map((b) => (
                  <BrandRow key={b.key} label={b.label} s={summarize([b], ctx)} days={data.days} prevDays={prevDays} />
                ))}
              </tbody>
            ))}
            {visibleBrands.length > 1 && (
              <tfoot>
                <BrandRow label="TỔNG" s={total} days={data.days} prevDays={prevDays} isTotal />
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* 4. CÁC MỤC BỔ TRỢ */}
      <div className="mt-1 flex flex-col gap-2">
        {tests.length > 0 && (
          <CollapsiblePanel title={`Hiệu quả SKU Test (${tests.length} store)`} open={showTests} onToggle={() => setShowTests((v) => !v)}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left font-bold">Store</th>
                  <th className="px-3 py-2 text-right font-bold">Revenue</th>
                  <th className="px-3 py-2 text-right font-semibold">Tuần trước</th>
                  <th className="px-3 py-2 text-right font-bold">Profit</th>
                  <th className="px-3 py-2 text-right font-semibold">Ads Fee</th>
                  <th className="px-3 py-2 text-right font-semibold">TACoS</th>
                  <th className="px-3 py-2 text-right font-semibold">ROI</th>
                  <th className="px-3 py-2 text-right font-semibold">% WoW</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={t.storeId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-semibold text-slate-800">{t.label}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{usd(t.current.revenue)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(t.previous.revenue)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${t.current.profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                      {usd(t.current.profit)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{usd(t.current.adsFee)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{pct(div(t.current.adsFee, t.current.revenue))}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{pct(div(t.current.profit, t.current.basecost))}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <WowBadge value={wowOf(t.current.revenue, t.previous.revenue, data.days, prevDays)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsiblePanel>
        )}

        {stock.length > 0 && (
          <CollapsiblePanel title={`Tồn kho Amazon (${stock.length} store)`} open={showStock} onToggle={() => setShowStock((v) => !v)}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left font-bold">Store</th>
                  <th className="px-3 py-2 text-right font-bold">SL tồn (Units)</th>
                  <th className="px-3 py-2 text-right font-bold">Giá trị tồn ($)</th>
                  <th className="px-3 py-2 text-right font-semibold">Bán / tuần</th>
                  <th className="px-3 py-2 text-right font-bold">Số tuần bán hết</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => {
                  const perWeek = data.days ? (s.soldInPeriod * 7) / data.days : 0;
                  const weeksLeft = perWeek > 0 ? s.units / perWeek : null;
                  return (
                    <tr key={s.storeId} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-semibold text-slate-800">{s.label}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{int(s.units)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-900">{usd2(s.value)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{int(perWeek)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {weeksLeft == null ? "—" : `${weeksLeft.toFixed(1)} tuần`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CollapsiblePanel>
        )}

        {data.payout && (
          <CollapsiblePanel
            title={`Tiền về từ Amazon / Disbursements (${usd2(data.payout.current)})`}
            open={showPayout}
            onToggle={() => setShowPayout((v) => !v)}
          >
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left font-bold">Store</th>
                  <th className="px-3 py-2 text-right font-bold">Tuần này (USD)</th>
                  <th className="px-3 py-2 text-right font-semibold">Tuần trước</th>
                  <th className="px-3 py-2 text-right font-semibold">% WoW</th>
                </tr>
              </thead>
              <tbody>
                {data.payout.byStore.map((p) => (
                  <tr key={p.storeName} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-semibold text-slate-800">{p.storeName}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{usd2(p.current)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500">{usd2(p.previous)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <WowBadge value={wow(p.current, p.previous)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsiblePanel>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

/** Thanh % đạt: đầy = đủ mức cần đạt tới hôm nay */
function AchieveBar({ ratio, height = "h-2" }: { ratio: number | null; height?: string }) {
  const tone = kpiTone(ratio);
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-100 ${height}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${tone ? TONE_CLASS[tone].bar : "bg-slate-300"}`}
        style={{ width: `${Math.min(100, Math.max(1.5, (ratio ?? 0) * 100))}%` }}
      />
    </div>
  );
}

/** Thẻ tổng quan: số to = % đạt so với mức cần đạt tới hôm nay */
function OverviewCard({
  title,
  subtitle,
  fullLabel,
  items,
}: {
  title: string;
  subtitle: string;
  fullLabel: string;
  items: { label: string; a: Achieve | null }[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-bold uppercase tracking-wider text-slate-600">{title}</span>
        <span className="text-[11px] text-slate-400">{subtitle}</span>
      </div>
      <div className="mt-3 flex flex-1 flex-col justify-around gap-5">
        {items.map(({ label, a }) =>
          !a ? (
            <div key={label} className="text-xs text-slate-400">
              {label}: chưa có KPI
            </div>
          ) : (
            <div key={label}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-500">{label}</span>
                <span className="tabular-nums text-slate-400">
                  {fullLabel}: {usd(a.full)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                <span className="text-3xl font-bold tracking-tight text-slate-900">{pct(a.ratio, 0)}</span>
                <span className="text-xs text-slate-500">
                  <b className="font-semibold text-slate-800">{usd(a.actual)}</b> / {usd(a.due)} cần đạt
                </span>
              </div>
              <div className="mt-2">
                <AchieveBar ratio={a.ratio} />
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** Ô chỉ số phụ. delta: "pct" = % thay đổi; "pt" = chênh lệch điểm % (cho Biên LN, TACoS) */
function StatCard({
  label,
  icon: StatIcon,
  accent,
  value,
  prevText,
  delta,
  deltaKind = "pct",
  inverse = false,
}: {
  label: string;
  icon: Icon;
  accent: Accent;
  value: string;
  prevText: string;
  delta: number | null;
  deltaKind?: "pct" | "pt";
  inverse?: boolean;
}) {
  const valid = delta != null && Number.isFinite(delta);
  const good = valid && (inverse ? delta! < 0 : delta! > 0);
  const flat = valid && Math.abs(delta!) < 0.0005;
  const text = !valid
    ? "—"
    : `${delta! > 0 ? "▲" : delta! < 0 ? "▼" : ""} ${(Math.abs(delta!) * 100).toFixed(1)}${deltaKind === "pt" ? " điểm" : "%"}`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${ACCENT[accent].tile}`}>
          <StatIcon size={20} weight="duotone" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[11px] tabular-nums">
        <span className="truncate text-slate-400" title={prevText}>
          {prevText}
        </span>
        <span className={`shrink-0 font-semibold ${!valid || flat ? "text-slate-400" : good ? "text-emerald-700" : "text-rose-600"}`}>
          {text}
        </span>
      </div>
    </div>
  );
}

function TeamCard({ team, s, days, prevDays }: { team: string; s: GroupSummary; days: number; prevDays: number }) {
  const m = s.profit?.month ?? null;
  const tone = kpiTone(m?.ratio ?? null);
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{team}</span>
        {tone ? (
          <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${TONE_CLASS[tone].pill}`}>{TEAM_LABEL[tone]}</span>
        ) : (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10.5px] font-semibold text-slate-400">Chưa có KPI</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
        <span>Profit lũy kế tháng</span>
        {m && <span className="tabular-nums text-slate-400">Cả tháng: {usd(m.full)}</span>}
      </div>
      <div className="flex items-baseline gap-2 tabular-nums">
        {m ? (
          <>
            <span className="text-xl font-bold text-slate-900">{pct(m.ratio, 0)}</span>
            <span className="text-xs text-slate-500">
              <b className={`font-semibold ${m.actual < 0 ? "text-rose-600" : "text-slate-800"}`}>{usd(m.actual)}</b> / {usd(m.due)} cần đạt
            </span>
          </>
        ) : (
          <span className={`text-xl font-bold ${s.mtd.profit < 0 ? "text-rose-600" : "text-slate-900"}`}>{usd(s.mtd.profit)}</span>
        )}
      </div>
      <div className="mt-2">
        <AchieveBar ratio={m?.ratio ?? null} height="h-1.5" />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-[11px] tabular-nums">
        <div>
          <div className="text-slate-400">Revenue tuần</div>
          <div className="font-semibold text-slate-800">{usd(s.cur.revenue)}</div>
          <WowBadge value={wowOf(s.cur.revenue, s.prev.revenue, days, prevDays)} />
        </div>
        <div>
          <div className="text-slate-400">Profit tuần</div>
          <div className={`font-semibold ${s.cur.profit < 0 ? "text-rose-600" : "text-slate-800"}`}>{usd(s.cur.profit)}</div>
          <WowBadge value={wowOf(s.cur.profit, s.prev.profit, days, prevDays)} />
        </div>
        <div>
          <div className="text-slate-400">% đạt tuần</div>
          <div className="mt-0.5">
            <AchievePill a={s.profit?.week ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandRow({
  label,
  s,
  days,
  prevDays,
  isTotal = false,
}: {
  label: string;
  s: GroupSummary;
  days: number;
  prevDays: number;
  isTotal?: boolean;
}) {
  const idle = !isTotal && s.cur.revenue === 0 && s.mtd.revenue === 0 && s.cur.profit === 0;
  const rowCls = isTotal
    ? "border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900"
    : `border-b border-slate-100 hover:bg-amber-50/40 ${idle ? "text-slate-400" : "text-slate-800"}`;
  const money = (v: number, strong = false) => (
    <span className={`${v < 0 ? "text-rose-600" : ""} ${strong ? "font-semibold" : ""}`}>{usd(v)}</span>
  );
  const pills = (r: Achieve | null | undefined, p: Achieve | null | undefined) =>
    r && p ? (
      <>
        <td className="px-3 py-2 text-center">
          <AchievePill a={r} />
        </td>
        <td className="px-3 py-2 text-center">
          <AchievePill a={p} />
        </td>
      </>
    ) : (
      <td colSpan={2} className="px-3 py-2 text-center text-[11px] font-normal text-slate-300">
        Chưa có KPI
      </td>
    );
  return (
    <tr className={rowCls}>
      <td className={`px-4 py-2 text-left ${isTotal ? "" : "font-semibold"}`}>{label}</td>
      <td className="px-3 py-2 text-right">
        {money(s.cur.revenue, true)}
        {!idle && (
          <div className="text-[10.5px] font-normal">
            <WowBadge value={wowOf(s.cur.revenue, s.prev.revenue, days, prevDays)} />
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">{money(s.cur.profit, true)}</td>
      <td className="px-3 py-2 text-right text-slate-500">{pct(div(s.cur.profit, s.cur.revenue))}</td>
      <td className="px-3 py-2 text-right text-slate-500">{pct(div(s.cur.adsFee, s.cur.revenue))}</td>
      {pills(s.revenue?.week, s.profit?.week)}
      <td className="px-3 py-2 text-right">{money(s.mtd.revenue)}</td>
      <td className="px-3 py-2 text-right">{money(s.mtd.profit)}</td>
      {pills(s.revenue?.month, s.profit?.month)}
    </tr>
  );
}

/** Pill % đạt (so với mức cần đạt tới hôm nay); rê chuột xem số tiền */
function AchievePill({ a }: { a: Achieve | null }) {
  if (!a || a.ratio == null || !Number.isFinite(a.ratio)) return <span className="text-slate-300">—</span>;
  const tone = kpiTone(a.ratio) ?? "bad";
  return (
    <span
      className={`inline-block min-w-[54px] rounded-full border px-2 py-0.5 text-center text-[11px] font-bold tabular-nums ${TONE_CLASS[tone].pill}`}
      title={`${usd(a.actual)} / ${usd(a.due)} cần đạt`}
    >
      {(a.ratio * 100).toFixed(0)}%
    </span>
  );
}

function CollapsiblePanel({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer select-none items-center justify-between px-4 py-2.5 text-left text-xs font-bold text-slate-700 transition hover:bg-slate-50"
      >
        <span>{title}</span>
        {open ? <CaretUpIcon size={14} weight="bold" /> : <CaretDownIcon size={14} weight="bold" />}
      </button>
      {open && <div className="overflow-x-auto border-t border-slate-200 p-2">{children}</div>}
    </div>
  );
}
