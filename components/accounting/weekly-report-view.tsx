"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowClockwiseIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
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

// BÁO CÁO TUẦN — thứ tự đọc: 4 chỉ số tuần → tiến độ KPI → team → brand → báo cáo phụ.

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

/** % WoW như file: (này − trước) ÷ |trước| */
const wow = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur != null && prev != null && Math.abs(prev) > 1e-9 ? (cur - prev) / Math.abs(prev) : null;

/** Chênh lệch điểm % giữa 2 tỷ lệ (Margin, TACoS) */
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

const ratiosOf = (m: WeeklyMetrics) => ({
  tacos: div(m.adsFee, m.revenue),
  roi: div(m.profit, m.basecost),
  margin: div(m.profit, m.revenue),
});

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
    "h-8 rounded-md border border-slate-300 bg-white text-[13px] text-slate-800 transition hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 disabled:opacity-40";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-50 font-accounting-system">
      <AccountingTopProgressBar loading={loading} variant="amber" />

      {/* A. HEADER — tiêu đề + bộ lọc trên 1 hàng, khoảng ngày & trạng thái số liệu ở dòng dưới */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="mr-2 text-xl font-semibold tracking-tight text-slate-900">Báo cáo tuần</h1>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Tuần trước"
              disabled={!week || loading}
              onClick={() => week && setDate(previousWeekSegment(week).startDate)}
              className={`${ctrl} flex w-8 cursor-pointer items-center justify-center text-slate-600`}
            >
              <CaretLeftIcon size={14} weight="bold" />
            </button>
            <label className={`${ctrl} flex items-center gap-1.5 px-2.5 focus-within:border-slate-500`}>
              <CalendarBlankIcon size={14} className="text-slate-500" />
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
              className={`${ctrl} flex w-8 cursor-pointer items-center justify-center text-slate-600`}
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

        {data && (
          <p className="mt-1.5 text-xs text-slate-500">
            {vnDate(data.week.startDate)} – {vnDate(data.week.endDate)}/{data.week.endDate.slice(0, 4)}
            <span className="mx-1.5 text-slate-300">·</span>
            {isCurrentWeek ? (
              <span className="text-amber-700">
                Đang chạy · số liệu đến {vnDate(data.dataThrough)} ({data.days}/{data.week.days} ngày)
              </span>
            ) : (
              <span>Đã chốt · đủ {data.days} ngày</span>
            )}
          </p>
        )}
      </header>

      <div className={`flex-1 overflow-y-auto px-6 py-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {error && (
          <div role="alert" className="mx-auto mb-4 max-w-[1440px] rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {error.message}
          </div>
        )}
        {data &&
          (data.brands.length === 0 ? (
            <div className="mx-auto max-w-[1440px] rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
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
// % — chỉ dùng đúng các % của file "BÁO CÁO TUẦN TỔNG HỢP":
//   % WoW = (tuần này − tuần trước) ÷ |tuần trước|  (cột D)
//   % đạt mục tiêu tháng (lũy kế) / Nhịp đạt MT = lũy kế đến nay ÷ (Mục tiêu tháng × ngày ÷ số ngày tháng)  (cột F, L)
//   % đạt mục tiêu tháng (Profit) = lũy kế đến nay ÷ Mục tiêu tháng  (cột N)
//   Đánh giá: ≥ 100% THƯỞNG · ≥ 85% ĐẠT · còn lại PHÊ BÌNH (theo nhịp).
//   Thêm theo yêu cầu: nhịp tuần (cùng cách tính, mục tiêu tuần = MT tháng × ngày tuần ÷ ngày tháng) và dự báo cuối kỳ.
// Như file: tử số cộng mọi brand trong nhóm (kể cả brand chưa có mục tiêu), mẫu số = tổng mục tiêu.
// Margin / TACoS: thẻ tổng quan hiện chênh lệch theo điểm % (TACoS kèm % tương đối) — chỉ là cách hiển thị.
// ---------------------------------------------------------------------------

// Tiến độ 1 kỳ (tuần / tháng) so với mục tiêu chia đều theo ngày:
//   Cần tới nay = mục tiêu kỳ × ngày đã có số liệu ÷ số ngày kỳ;  Nhịp = đã làm ÷ cần tới nay
//   Mục tiêu tuần = mục tiêu tháng × số ngày tuần ÷ số ngày tháng
//   Dự báo cuối kỳ (giữ tốc độ hiện tại) = đã làm ÷ ngày đã qua × số ngày kỳ
//   Cần mỗi ngày còn lại = (mục tiêu kỳ − đã làm) ÷ số ngày còn lại
interface Achieve {
  /** Đã làm được tới ngày có số liệu */
  actual: number;
  /** Cần đạt tới ngày có số liệu */
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
  /** Tốc độ hiện tại / ngày */
  ratePerDay: number;
  /** Giữ tốc độ hiện tại thì cuối kỳ được bao nhiêu */
  projected: number;
  /** Cần mỗi ngày còn lại để đủ mục tiêu kỳ (0 = đã đủ; null = kỳ đã hết) */
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
  /** Số ngày tháng */
  dim: number;
  /** Ngày cuối có số liệu (trong tháng) */
  day: number;
  /** Số ngày tuần đã có số liệu */
  weekElapsed: number;
  /** Số ngày của kỳ tuần (tuần vắt tháng thì < 7) */
  weekDays: number;
}

function periodOf(actual: number, target: number, elapsed: number, total: number): Achieve {
  const e = Math.max(1, Math.min(elapsed, total));
  const due = (target * e) / total;
  const daysLeft = Math.max(0, total - e);
  const ratePerDay = actual / e;
  return {
    actual,
    due,
    full: target,
    ratio: kpiRatio(actual, due),
    fullRatio: kpiRatio(actual, target),
    elapsed: e,
    total,
    daysLeft,
    ratePerDay,
    projected: ratePerDay * total,
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

/** Brand không phát sinh: tuần này không có revenue / profit và cả tháng chưa có revenue */
const isIdle = (s: GroupSummary) => s.cur.revenue === 0 && s.mtd.revenue === 0 && s.cur.profit === 0;

type Tone = "good" | "near" | "bad";
const TONE_TEXT: Record<Tone, string> = { good: "text-emerald-700", near: "text-amber-700", bad: "text-rose-600" };
const TONE_BAR: Record<Tone, string> = { good: "bg-emerald-500", near: "bg-amber-400", bad: "bg-rose-500" };
const TEAM_LABEL: Record<Tone, string> = { good: "THƯỞNG", near: "ĐẠT", bad: "PHÊ BÌNH" };
const toneText = (ratio: number | null) => {
  const t = kpiTone(ratio);
  return t ? TONE_TEXT[t] : "text-slate-400";
};

/** Kết luận dự báo: giữ tốc độ hiện tại thì cuối kỳ có đạt mục tiêu không */
function verdictOf(a: Achieve): { text: string; tone: Tone } {
  if (a.actual >= a.full) return { text: "Đã đạt", tone: "good" };
  if (a.daysLeft === 0) return { text: "Không đạt", tone: "bad" };
  const t = kpiTone(a.ratio) ?? "bad";
  return { text: t === "good" ? "Kịp" : t === "near" ? "Sát" : "Khó đạt", tone: t };
}

// ---------------------------------------------------------------------------
// NỘI DUNG CHÍNH
// ---------------------------------------------------------------------------

type SortKey = "revenue" | "profit" | "margin" | "dRevenue" | "dProfit";
const SORT_VALUE: Record<SortKey, (s: GroupSummary) => number | null> = {
  revenue: (s) => s.cur.revenue,
  profit: (s) => s.cur.profit,
  margin: (s) => div(s.cur.profit, s.cur.revenue),
  dRevenue: (s) => wow(s.cur.revenue, s.prev.revenue),
  dProfit: (s) => wow(s.cur.profit, s.prev.profit),
};

function WeeklyDashboardBody({ data, selectedStoreKey }: { data: WeeklyReport; selectedStoreKey: string }) {
  const { week, brands } = data;
  const selectedStoreId = selectedStoreKey === "all" ? null : selectedStoreKey.split("|")[0];

  const visibleBrands = useMemo(
    () => (selectedStoreKey === "all" ? brands : brands.filter((b) => b.key === selectedStoreKey)),
    [brands, selectedStoreKey],
  );
  const tests = selectedStoreId ? data.tests.filter((t) => t.storeId === selectedStoreId) : data.tests;
  const stock = selectedStoreId ? data.stock.filter((s) => s.storeId === selectedStoreId) : data.stock;

  const dim = daysInMonthOf(week.startDate);
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
  const teams = useMemo(() => {
    const byTeam = new Map<string, WeeklyBrandRow[]>();
    for (const b of visibleBrands) byTeam.set(b.team, [...(byTeam.get(b.team) ?? []), b]);
    return Array.from(byTeam, ([team, rows]) => ({
      team,
      summary: summarize(rows, ctx),
      brands: rows.map((b) => ({ b, s: summarize([b], ctx) })),
    }));
  }, [visibleBrands, ctx]);

  const month = Number(week.startDate.slice(5, 7));
  const untargeted = visibleBrands.filter((b) => !b.target).map((b) => b.label);

  // Trạng thái xem (giữ nguyên khi đổi tuần / store)
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const brandTableRef = useRef<HTMLElement>(null);
  const activeTeam = teamFilter && teams.some((t) => t.team === teamFilter) ? teamFilter : null;
  const pickTeam = (team: string) => {
    setTeamFilter((cur) => (cur === team ? null : team));
    brandTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [showTests, setShowTests] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showPayout, setShowPayout] = useState(false);

  const testTotals = tests.reduce((s, t) => add(s, t.current), ZERO);
  const stockUnits = stock.reduce((s, r) => s + r.units, 0);
  const stockValue = stock.reduce((s, r) => s + r.value, 0);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      {/* B. 4 CHỈ SỐ CHÍNH */}
      <KpiOverview total={total} days={data.days} previousDays={data.previousDays} weekDays={week.days} />

      {/* C. TIẾN ĐỘ KPI */}
      <KpiProgressPanel weekLabel={week.label} month={month} total={total} untargeted={untargeted} />

      {/* D. KẾT QUẢ THEO TEAM */}
      {selectedStoreKey === "all" && teams.length > 1 && (
        <TeamTable teams={teams} activeTeam={activeTeam} onPick={pickTeam} />
      )}

      {/* E. KINH DOANH THEO BRAND */}
      <BrandTable
        sectionRef={brandTableRef}
        teams={teams}
        total={total}
        totalLabel={selectedStoreKey === "all" ? "Tổng công ty" : "Tổng"}
        activeTeam={activeTeam}
        onClearTeam={() => setTeamFilter(null)}
      />

      {/* F. BÁO CÁO BỔ SUNG — mặc định thu gọn */}
      <div className="flex flex-col gap-2">
        {tests.length > 0 && (
          <CollapsiblePanel
            title="Hiệu quả SKU Testing"
            summary={`${tests.length} store · Revenue ${usd(testTotals.revenue)} · Profit ${usd(testTotals.profit)}`}
            open={showTests}
            onToggle={() => setShowTests((v) => !v)}
          >
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
                      <Delta value={wow(t.current.revenue, t.previous.revenue)} arrow={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CollapsiblePanel>
        )}

        {stock.length > 0 && (
          <CollapsiblePanel
            title="Tồn kho Amazon"
            summary={`${stock.length} store · ${int(stockUnits)} units · ${usd(stockValue)}`}
            open={showStock}
            onToggle={() => setShowStock((v) => !v)}
          >
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
            title="Tiền về Amazon / Disbursements"
            summary={`${usd2(data.payout.current)} · tuần trước ${usd2(data.payout.previous)}`}
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
                      <Delta value={wow(p.current, p.previous)} arrow={false} />
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

/**
 * Biến động có ý nghĩa tốt/xấu: goodWhen="up" (Revenue, Profit, Margin) hoặc "down" (TACoS).
 * unit "rel" = % tương đối (WoW); "pts" = điểm % (chênh lệch giữa 2 tỷ lệ).
 */
function Delta({
  value,
  unit = "rel",
  goodWhen = "up",
  arrow = true,
  className = "",
}: {
  value: number | null | undefined;
  unit?: "rel" | "pts";
  goodWhen?: "up" | "down";
  arrow?: boolean;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={`text-slate-400 ${className}`}>—</span>;
  const flat = Math.abs(value) < 0.0005;
  const good = goodWhen === "up" ? value > 0 : value < 0;
  const cls = flat ? "text-slate-500" : good ? "text-emerald-700" : "text-rose-600";
  const n = (Math.abs(value) * 100).toFixed(1);
  const sign = arrow ? (value > 0 ? "▲ " : value < 0 ? "▼ " : "") : value > 0 ? "+" : value < 0 ? "-" : "";
  return (
    <span className={`tabular-nums ${cls} ${className}`}>
      {sign}
      {n}
      {unit === "pts" ? " điểm %" : "%"}
    </span>
  );
}

/** B. Revenue · Profit · Margin · TACoS của tuần, so tuần trước */
function KpiOverview({
  total,
  days,
  previousDays,
  weekDays,
}: {
  total: GroupSummary;
  days: number;
  previousDays: number;
  weekDays: number;
}) {
  const cur = ratiosOf(total.cur);
  const prev = ratiosOf(total.prev);
  const items: { label: string; value: string; prev: string; delta: ReactNode; extra?: ReactNode; negative?: boolean }[] = [
    {
      label: "Revenue",
      value: usd(total.cur.revenue),
      prev: usd(total.prev.revenue),
      delta: <Delta value={wow(total.cur.revenue, total.prev.revenue)} />,
      negative: total.cur.revenue < 0,
    },
    {
      label: "Profit",
      value: usd(total.cur.profit),
      prev: usd(total.prev.profit),
      delta: <Delta value={wow(total.cur.profit, total.prev.profit)} />,
      negative: total.cur.profit < 0,
    },
    {
      label: "Margin",
      value: pct(cur.margin),
      prev: pct(prev.margin),
      delta: <Delta value={ptDiff(cur.margin, prev.margin)} unit="pts" />,
    },
    {
      label: "TACoS",
      value: pct(cur.tacos),
      prev: pct(prev.tacos),
      delta: <Delta value={ptDiff(cur.tacos, prev.tacos)} unit="pts" goodWhen="down" />,
      extra: (() => {
        const rel = wow(cur.tacos, prev.tacos);
        return rel == null ? null : (
          <span className="text-slate-400">
            ({rel > 0 ? "+" : ""}
            {(rel * 100).toFixed(1)}% tương đối)
          </span>
        );
      })(),
    },
  ];
  const partial = days < weekDays;
  return (
    <section aria-labelledby="wr-overview">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wr-overview" className="text-[15px] font-semibold text-slate-900">
          Tổng quan tuần
        </h2>
        {partial && (
          <span className="text-xs text-slate-500">
            So tổng {days} ngày tuần này với {previousDays} ngày tuần trước
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white lg:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.label}
            className={`flex min-w-0 flex-col gap-1 px-5 py-4 ${i > 0 ? "border-l border-slate-200" : ""} ${
              i === 2 ? "max-lg:border-l-0 max-lg:border-t" : i === 3 ? "max-lg:border-t" : ""
            }`}
          >
            <span className="text-[13px] font-medium text-slate-500">{it.label}</span>
            <span className={`text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${it.negative ? "text-rose-600" : "text-slate-900"}`}>
              {it.value}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] font-medium">
              {it.delta}
              {it.extra && <span className="text-xs font-normal">{it.extra}</span>}
            </span>
            <span className="text-xs tabular-nums text-slate-400">Tuần trước {it.prev}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** C. Tiến độ KPI — 1 khu vực, chuyển Tuần / Tháng */
function KpiProgressPanel({
  weekLabel,
  month,
  total,
  untargeted,
}: {
  weekLabel: string;
  month: number;
  total: GroupSummary;
  untargeted: string[];
}) {
  const [period, setPeriod] = useState<"week" | "month">("month");
  const rows = [
    { label: "Revenue", p: total.revenue?.[period] ?? null },
    { label: "Profit", p: total.profit?.[period] ?? null },
  ];
  const any = rows.find((r) => r.p)?.p ?? null;
  return (
    <section aria-labelledby="wr-kpi" className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 id="wr-kpi" className="text-[15px] font-semibold text-slate-900">
            Tiến độ KPI
          </h2>
          {any && (
            <span className="text-xs text-slate-500">
              Ngày {any.elapsed}/{any.total}
              {any.daysLeft > 0 ? ` · còn ${any.daysLeft} ngày` : " · đã hết kỳ"}
            </span>
          )}
        </div>
        <Segmented
          label="Kỳ KPI"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "week", label: `Tuần ${weekLabel.split(" ")[0]}` },
            { value: "month", label: `Tháng ${month}` },
          ]}
        />
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map(({ label, p }) => (
          <KpiProgressRow key={label} label={label} a={p} />
        ))}
      </div>

      {untargeted.length > 0 && (
        <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
          Chưa có KPI: {untargeted.join(", ")} — vẫn được cộng vào thực đạt.
        </p>
      )}
    </section>
  );
}

function KpiProgressRow({ label, a }: { label: string; a: Achieve | null }) {
  if (!a) {
    return (
      <div className="grid grid-cols-[80px_1fr] items-center gap-4 px-5 py-4">
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        <span className="text-[13px] text-slate-400">Chưa có KPI</span>
      </div>
    );
  }
  const done = a.fullRatio ?? 0;
  const over = a.actual >= a.full && a.full > 0;
  const tone = kpiTone(a.ratio);
  const fill = Math.min(100, Math.max(a.actual > 0 ? 1 : 0, done * 100));
  const marker = Math.min(100, (a.elapsed / a.total) * 100);
  const gap = a.full - a.actual;
  const v = verdictOf(a);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[80px_minmax(220px,auto)_1fr_160px] md:items-center">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>

      <div className="flex items-baseline gap-2 tabular-nums">
        <span className={`text-lg font-semibold ${a.actual < 0 ? "text-rose-600" : "text-slate-900"}`}>{usd(a.actual)}</span>
        <span className="text-[13px] text-slate-500">/ {usd(a.full)}</span>
        <span className={`ml-1 text-[15px] font-semibold ${over ? "text-emerald-700" : "text-slate-900"}`}>{pct(a.fullRatio, 0)}</span>
      </div>

      <div className="min-w-0">
        <div
          className="relative h-2 rounded-full bg-slate-100"
          role="img"
          aria-label={`${label}: đạt ${pct(a.fullRatio, 0)} mục tiêu kỳ, vạch đứng là mức cần đạt tới hôm nay`}
        >
          <div className={`h-full rounded-full ${over ? TONE_BAR.good : tone ? TONE_BAR[tone] : "bg-slate-300"}`} style={{ width: `${fill}%` }} />
          {a.daysLeft > 0 && (
            <div className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded bg-slate-700" style={{ left: `${marker}%` }} />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-slate-500">
          <span>
            Nhịp <b className={`font-semibold ${toneText(a.ratio)}`}>{pct(a.ratio, 0)}</b> · cần tới nay {usd(a.due)}
          </span>
          {a.needPerDay != null && a.needPerDay > 0 && (
            <span>
              Đang {usd(a.ratePerDay)}/ngày · cần {usd(a.needPerDay)}/ngày
            </span>
          )}
          {a.daysLeft > 0 && (
            <span>
              Giữ tốc độ: ≈ {usd(a.projected)} <span className={`font-medium ${TONE_TEXT[v.tone]}`}>({v.text})</span>
            </span>
          )}
        </div>
      </div>

      <div className="text-[13px] tabular-nums md:text-right">
        {over ? (
          <span className="font-medium text-emerald-700">Vượt {usd(-gap)}</span>
        ) : (
          <span className="text-slate-700">
            Còn thiếu <b className="font-semibold">{usd(gap)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

/** D. Kết quả theo team — bảng gọn; bấm 1 team để lọc bảng brand */
function TeamTable({
  teams,
  activeTeam,
  onPick,
}: {
  teams: { team: string; summary: GroupSummary }[];
  activeTeam: string | null;
  onPick: (team: string) => void;
}) {
  return (
    <section aria-labelledby="wr-team" className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 id="wr-team" className="text-[15px] font-semibold text-slate-900">
          Kết quả theo team
        </h2>
        <span className="text-xs text-slate-500">Bấm vào team để xem các brand</span>
      </div>
      <div className="acc-grid-off overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="text-slate-500">
              <th className="bg-transparent px-5 py-2 text-left font-medium">Team</th>
              <th className="bg-transparent px-4 py-2 text-right font-medium">Revenue tuần</th>
              <th className="bg-transparent px-4 py-2 text-right font-medium">Profit tuần</th>
              <th className="bg-transparent px-4 py-2 text-right font-medium">Profit so tuần trước</th>
              <th className="bg-transparent px-4 py-2 text-right font-medium">Nhịp Profit tháng</th>
              <th className="bg-transparent px-5 py-2 text-right font-medium">Đánh giá</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(({ team, summary: s }) => {
              const m = s.profit?.month ?? null;
              const tone = kpiTone(m?.ratio ?? null);
              const quiet = s.cur.revenue === 0 && s.cur.profit === 0;
              const active = activeTeam === team;
              return (
                <tr
                  key={team}
                  onClick={() => onPick(team)}
                  className={`cursor-pointer border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50 ${
                    active ? "bg-sky-50/70" : ""
                  } ${quiet ? "text-slate-400" : "text-slate-800"}`}
                >
                  <td className="px-5 py-2.5 text-left">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(team);
                      }}
                      className="cursor-pointer rounded font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      {team}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">{usd(s.cur.revenue)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${s.cur.profit < 0 ? "text-rose-600" : ""}`}>{usd(s.cur.profit)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {quiet ? <span className="text-slate-400">—</span> : <Delta value={wow(s.cur.profit, s.prev.profit)} />}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {m ? (
                      <span className={`font-semibold ${toneText(m.ratio)}`} title={`Lũy kế ${usd(m.actual)} / cần tới nay ${usd(m.due)}`}>
                        {pct(m.ratio, 0)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {tone ? (
                      <span className={`text-xs font-semibold ${TONE_TEXT[tone]}`}>{TEAM_LABEL[tone]}</span>
                    ) : (
                      <span className="text-xs text-slate-400">Chưa có KPI</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** E. Kinh doanh theo brand — nhóm theo team, Cơ bản / Chi tiết, sắp xếp, ẩn brand không phát sinh */
function BrandTable({
  sectionRef,
  teams,
  total,
  totalLabel,
  activeTeam,
  onClearTeam,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  teams: { team: string; summary: GroupSummary; brands: { b: WeeklyBrandRow; s: GroupSummary }[] }[];
  total: GroupSummary;
  totalLabel: string;
  activeTeam: string | null;
  onClearTeam: () => void;
}) {
  const [mode, setMode] = useState<"basic" | "detail">("basic");
  const [showIdle, setShowIdle] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "desc" | "asc" } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const detail = mode === "detail";
  const grouped = teams.length > 1;
  const idleCount = teams.reduce((n, t) => n + t.brands.filter((r) => isIdle(r.s)).length, 0);
  const shownTeams = activeTeam ? teams.filter((t) => t.team === activeTeam) : teams;
  const colCount = detail ? 12 : 6;

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

  const th = "sticky top-0 z-[1] bg-[#f8fafc] px-3 py-2 font-medium";
  const sortTh = (k: SortKey, label: ReactNode, className = "") => {
    const active = sort?.key === k;
    return (
      <th className={`${th} text-right ${className}`} aria-sort={active ? (sort!.dir === "desc" ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => toggleSort(k)}
          className={`inline-flex cursor-pointer items-center gap-1 rounded text-right hover:underline focus-visible:outline-2 focus-visible:outline-slate-900 ${
            active ? "font-semibold" : ""
          }`}
        >
          {label}
          {active && (sort!.dir === "desc" ? <CaretDownIcon size={10} weight="bold" /> : <CaretUpIcon size={10} weight="bold" />)}
        </button>
      </th>
    );
  };
  const vsPrev = (metric: string) => (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-normal">So tuần trước</span>
      <span>{metric}</span>
    </span>
  );

  return (
    <section ref={sectionRef} aria-labelledby="wr-brand" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="wr-brand" className="text-[15px] font-semibold text-slate-900">
            Kinh doanh theo brand (SKU WIN)
          </h2>
          {activeTeam && (
            <button
              type="button"
              onClick={onClearTeam}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
            >
              {activeTeam}
              <XIcon size={11} weight="bold" aria-label="Bỏ lọc team" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {idleCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} className="h-3.5 w-3.5 accent-slate-700" />
              Hiện brand không phát sinh ({idleCount})
            </label>
          )}
          <Segmented
            label="Chế độ bảng"
            value={mode}
            onChange={setMode}
            options={[
              { value: "basic", label: "Cơ bản" },
              { value: "detail", label: "Chi tiết" },
            ]}
          />
        </div>
      </div>

      <div className="acc-grid-off max-h-[70vh] overflow-auto">
        <table className={`w-full border-collapse text-[13px] tabular-nums ${detail ? "min-w-[1080px]" : "min-w-[760px]"}`}>
          <thead>
            <tr className="text-slate-500">
              <th className={`${th} pl-5 text-left`}>Brand</th>
              {sortTh("revenue", "Revenue")}
              {sortTh("profit", "Profit")}
              {sortTh("margin", "Margin")}
              {sortTh("dRevenue", vsPrev("Revenue"), "border-l border-slate-200")}
              {sortTh("dProfit", vsPrev("Profit"), detail ? "" : "pr-5")}
              {detail && (
                <>
                  <th className={`${th} border-l border-slate-200 text-right`}>TACoS</th>
                  <th className={`${th} text-right`}>ROI</th>
                  <th className={`${th} border-l border-slate-200 text-right`}>Lũy kế Profit</th>
                  <th className={`${th} text-right`}>Nhịp tuần</th>
                  <th className={`${th} text-right`}>Nhịp tháng</th>
                  <th className={`${th} pr-5 text-right`}>% MT tháng</th>
                </>
              )}
            </tr>
          </thead>

          {/* Tổng luôn ở đầu bảng — tính trên mọi brand đang xem, không đổi theo bộ lọc ẩn dòng / lọc team */}
          <tbody>
            <BrandRow label={totalLabel} s={total} detail={detail} variant="total" />
          </tbody>

          {shownTeams.map((t) => {
            const rows = order(t.brands);
            const isCollapsed = collapsed.has(t.team);
            const hidden = t.brands.length - rows.length;
            return (
              <tbody key={t.team}>
                {grouped && (
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <td colSpan={colCount} className="px-5 py-1.5">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleTeam(t.team)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900"
                      >
                        {isCollapsed ? <CaretRightIcon size={11} weight="bold" /> : <CaretDownIcon size={11} weight="bold" />}
                        {t.team}
                        <span className="font-normal normal-case tracking-normal text-slate-400">
                          {rows.length} brand{hidden > 0 ? ` · ẩn ${hidden} không phát sinh` : ""}
                        </span>
                      </button>
                    </td>
                  </tr>
                )}
                {!isCollapsed &&
                  (rows.length ? (
                    rows.map(({ b, s }) => <BrandRow key={b.key} label={b.label} s={s} detail={detail} indent={grouped} />)
                  ) : (
                    <tr>
                      <td colSpan={colCount} className="px-5 py-2 text-xs text-slate-400">
                        Không có brand phát sinh trong tuần.
                      </td>
                    </tr>
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </section>
  );
}

function BrandRow({
  label,
  s,
  detail,
  variant = "brand",
  indent = false,
}: {
  label: string;
  s: GroupSummary;
  detail: boolean;
  variant?: "brand" | "total";
  indent?: boolean;
}) {
  const isTotal = variant === "total";
  const idle = !isTotal && isIdle(s);
  const r = ratiosOf(s.cur);
  const money = (v: number, strong = false) => (
    <span className={`${v < 0 ? "text-rose-600" : ""} ${strong ? "font-semibold" : ""}`}>{usd(v)}</span>
  );
  const w = s.profit?.week ?? null;
  const m = s.profit?.month ?? null;
  const rowCls = isTotal
    ? "border-b-2 border-slate-300 bg-[#f8fafc] font-semibold text-slate-900"
    : `border-b border-slate-100 transition-colors hover:bg-slate-50 ${idle ? "text-slate-400" : "text-slate-800"}`;
  return (
    <tr className={rowCls}>
      <td className={`py-2 pr-3 text-left ${indent ? "pl-9" : "pl-5"} ${isTotal ? "" : "font-medium"}`}>
        <span className="block max-w-[260px] truncate" title={label}>
          {label}
        </span>
      </td>
      <td className="px-3 py-2 text-right">{money(s.cur.revenue)}</td>
      <td className="px-3 py-2 text-right">{money(s.cur.profit, true)}</td>
      <td className={`px-3 py-2 text-right ${r.margin != null && r.margin < 0 ? "text-rose-600" : ""}`}>{pct(r.margin)}</td>
      <td className="border-l border-slate-100 px-3 py-2 text-right">
        {idle ? "—" : <Delta value={wow(s.cur.revenue, s.prev.revenue)} arrow={false} />}
      </td>
      <td className={`px-3 py-2 text-right ${detail ? "" : "pr-5"}`}>
        {idle ? "—" : <Delta value={wow(s.cur.profit, s.prev.profit)} arrow={false} />}
      </td>
      {detail && (
        <>
          <td className="border-l border-slate-100 px-3 py-2 text-right">{pct(r.tacos)}</td>
          <td className="px-3 py-2 text-right">{pct(r.roi)}</td>
          <td className="border-l border-slate-100 px-3 py-2 text-right">{money(s.mtd.profit)}</td>
          {m && w ? (
            <>
              <td className="px-3 py-2 text-right" title={`Tuần: ${usd(w.actual)} / cần tới nay ${usd(w.due)}`}>
                <span className={`font-medium ${toneText(w.ratio)}`}>{pct(w.ratio, 0)}</span>
              </td>
              <td className="px-3 py-2 text-right" title={`Tháng: ${usd(m.actual)} / cần tới nay ${usd(m.due)}`}>
                <span className={`font-medium ${toneText(m.ratio)}`}>{pct(m.ratio, 0)}</span>
              </td>
              <td className="px-3 py-2 pr-5 text-right" title={`${usd(m.actual)} / mục tiêu tháng ${usd(m.full)}`}>
                {pct(m.fullRatio, 0)}
              </td>
            </>
          ) : (
            <td colSpan={3} className="px-3 py-2 pr-5 text-center text-xs font-normal">
              <span className="text-slate-400">Chưa có KPI</span>
            </td>
          )}
        </>
      )}
    </tr>
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
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 ${
              on ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CollapsiblePanel({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer select-none items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span className="text-[14px] font-semibold text-slate-800">{title}</span>
          {summary && <span className="text-xs tabular-nums text-slate-500">{summary}</span>}
        </span>
        {open ? <CaretUpIcon size={14} weight="bold" className="shrink-0 text-slate-500" /> : <CaretDownIcon size={14} weight="bold" className="shrink-0 text-slate-500" />}
      </button>
      {open && <div className="overflow-x-auto border-t border-slate-200 p-2">{children}</div>}
    </div>
  );
}
