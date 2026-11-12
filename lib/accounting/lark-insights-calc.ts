// Phần tính toán thuần (không truy cập DB) cho các tool mới của bot Lark:
// KPI so với kế hoạch, tồn kho / số ngày còn bán, cảnh báo bất thường, tóm tắt tuần, lệnh /help.
// Tách riêng để test được và để mọi con số bot báo ra đều đi qua đúng một công thức.

import {
  addMetrics,
  buildMonthReport,
  computeTarget,
  emptyMetrics,
  type KpiMetrics,
  type KpiTargetFormula,
  type KpiTargetInput,
  type MonthReport,
} from "./kpi-calc";

// ───────────── Ngày giờ (giờ Việt Nam) ─────────────

export function vnToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Thứ (0 = CN … 6 = T7) và giờ hiện tại theo giờ Việt Nam. */
export function vnWeekdayHour(now = new Date()): { weekday: number; hour: number } {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  return { weekday: vn.getUTCDay(), hour: vn.getUTCHours() };
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Thứ Hai của tuần chứa ngày date (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 6) % 7));
}

export function daysInMonth(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const vnDate = (date: string) => {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
};

/**
 * Nhịp tháng: phần tháng đã có dữ liệu. Tháng đã qua = 1, tháng chưa tới = 0,
 * tháng đang chạy = số ngày đã có dữ liệu ÷ số ngày của tháng.
 */
export function monthPace(period: string, dataThrough: string): { elapsedDays: number; daysInMonth: number; pace: number } {
  const total = daysInMonth(period);
  const dataPeriod = dataThrough.slice(0, 7);
  if (dataPeriod > period) return { elapsedDays: total, daysInMonth: total, pace: 1 };
  if (dataPeriod < period) return { elapsedDays: 0, daysInMonth: total, pace: 0 };
  const elapsed = Number(dataThrough.slice(8, 10));
  return { elapsedDays: elapsed, daysInMonth: total, pace: elapsed / total };
}

// ───────────── KPI so với kế hoạch (giống trang KPI kinh doanh) ─────────────

export interface KpiSkuLike {
  sku: string;
  group: "dev" | "test";
  price: number | null;
  basecost_unit: number | null;
  amazon_fee_unit: number | null;
  referral_pct: number | null;
  actual: { prev: KpiMetrics | null; cur: KpiMetrics | null; ly: KpiMetrics | null; lyNext: KpiMetrics | null };
  target: { cur: KpiTargetInput | null; next: KpiTargetInput | null };
}

export interface KpiSummaryInput {
  skus: KpiSkuLike[];
  teamTargets: Record<"cur" | "next", Partial<Record<"dev" | "test", KpiMetrics>>>;
  targetFormula: KpiTargetFormula;
  storeFees: Record<"prev" | "cur" | "ly" | "lyNext", number | null>;
  sources: Record<"prev" | "cur" | "ly" | "lyNext", string>;
}

/** Mục tiêu 1 SKU, đúng như targetOf() của trang KPI. */
export function skuTarget(s: KpiSkuLike, slot: "cur" | "next", formula: KpiTargetFormula): KpiMetrics | null {
  const base = slot === "next" ? s.actual.cur : s.actual.prev;
  return computeTarget(
    s.target[slot],
    { price: s.price, basecost_unit: s.basecost_unit, amazon_fee_unit: s.amazon_fee_unit, referral_pct: s.referral_pct },
    formula,
    base ? Math.abs(base.return_amount) : null,
  );
}

/**
 * Cộng SKU theo nhóm (phát triển / test) rồi dựng bảng BÁO CÁO THÁNG — cùng cách trang KPI kinh doanh làm,
 * để "% đạt KPI" bot báo trùng với số trên web.
 */
export function summarizeKpi(input: KpiSummaryInput): { report: MonthReport; hasTargetCur: boolean; devCur: KpiMetrics; testCur: KpiMetrics } {
  const blank = () => ({
    prev: emptyMetrics(), cur: emptyMetrics(), ly: emptyMetrics(), lyNext: emptyMetrics(),
    tCur: emptyMetrics(), tNext: emptyMetrics(), hasTCur: false, hasTNext: false,
  });
  const by = { dev: blank(), test: blank() };
  for (const s of input.skus) {
    const g = by[s.group];
    g.prev = addMetrics(g.prev, s.actual.prev);
    g.cur = addMetrics(g.cur, s.actual.cur);
    g.ly = addMetrics(g.ly, s.actual.ly);
    g.lyNext = addMetrics(g.lyNext, s.actual.lyNext);
    const tc = skuTarget(s, "cur", input.targetFormula);
    const tn = skuTarget(s, "next", input.targetFormula);
    if (tc) g.hasTCur = true;
    if (tn) g.hasTNext = true;
    g.tCur = addMetrics(g.tCur, tc);
    g.tNext = addMetrics(g.tNext, tn);
  }
  for (const k of ["dev", "test"] as const) {
    if (!by[k].hasTCur && input.teamTargets?.cur?.[k]) Object.assign(by[k], { tCur: input.teamTargets.cur[k], hasTCur: true });
    if (!by[k].hasTNext && input.teamTargets?.next?.[k]) Object.assign(by[k], { tNext: input.teamTargets.next[k], hasTNext: true });
  }
  const a = by.dev;
  const t = by.test;
  const lyOk = input.sources.ly !== "none";
  const lyNextOk = input.sources.lyNext !== "none";
  const report = buildMonthReport({
    dev: { prev: a.prev, cur: a.cur, ly: lyOk ? a.ly : null, lyNext: lyNextOk ? a.lyNext : null, tCur: a.hasTCur ? a.tCur : null, tNext: a.hasTNext ? a.tNext : null },
    test: { prev: t.prev, cur: t.cur, ly: lyOk ? t.ly : null, lyNext: lyNextOk ? t.lyNext : null, tNext: t.hasTNext ? t.tNext : null },
    storeFeeCur: input.storeFees?.cur ?? null,
  });
  return { report, hasTargetCur: a.hasTCur, devCur: a.cur, testCur: t.cur };
}

// ───────────── Tồn kho & số ngày còn bán ─────────────

export interface StockInput {
  sku: string;
  status: string | null;
  sellable: number;
  unsellable: number;
  inTransit: number;
  inboundPending: number;
  nextArrival: string | null;
  unitsSold: number;
  /** false = SKU không có dòng trong Inventory Ledger: chưa biết tồn, KHÔNG coi là hết hàng */
  hasBalance?: boolean;
}

export interface StockThresholds {
  /** Số ngày bán dùng để tính tốc độ bán. */
  velocityDays: number;
  /** Còn bán dưới N ngày (chỉ tính hàng sẵn bán) → sắp hết. */
  lowDays: number;
  /** Tính cả hàng đang về mà vẫn dưới N ngày → cần nhập thêm. */
  reorderDays: number;
}

export type StockLevel = "het_hang" | "sap_het" | "can_nhap" | "du_hang" | "khong_ban" | "chua_co_ton";

export function classifyStock(row: StockInput, th: StockThresholds) {
  const unitsPerDay = row.unitsSold / th.velocityDays;
  const coming = row.inTransit + row.inboundPending;
  const daysOfCover = unitsPerDay > 0 ? row.sellable / unitsPerDay : null;
  const daysWithInbound = unitsPerDay > 0 ? (row.sellable + coming) / unitsPerDay : null;
  let level: StockLevel;
  if (row.hasBalance === false) level = "chua_co_ton";
  else if (unitsPerDay <= 0) level = "khong_ban";
  else if (row.sellable <= 0) level = "het_hang";
  else if ((daysOfCover ?? Infinity) < th.lowDays) level = "sap_het";
  else if ((daysWithInbound ?? Infinity) < th.reorderDays) level = "can_nhap";
  else level = "du_hang";
  // Gợi ý số lượng nhập để đủ bán reorderDays ngày theo tốc độ hiện tại (đã trừ hàng sẵn bán + đang về)
  const suggestUnits = unitsPerDay > 0 && level !== "chua_co_ton" ? Math.max(0, Math.ceil(unitsPerDay * th.reorderDays - row.sellable - coming)) : 0;
  return {
    level,
    unitsPerDay: Math.round(unitsPerDay * 100) / 100,
    daysOfCover: daysOfCover == null ? null : Math.round(daysOfCover),
    daysWithInbound: daysWithInbound == null ? null : Math.round(daysWithInbound),
    suggestUnits,
  };
}

// ───────────── Cảnh báo bất thường (theo kênh store) ─────────────

export interface DayLike {
  date: string;
  revenue: number;
  adsFee: number;
  revenueAds: number;
  profit: number;
  quantity: number;
}

export interface AnomalyThresholds {
  /** Revenue ngày giảm ≥ X (0.4 = 40%) so với TB 7 ngày trước */
  revenueDropPct: number;
  /** Chỉ xét khi TB 7 ngày có Revenue ≥ $X/ngày (tránh báo store nhỏ) */
  minAvgRevenue: number;
  /** ACOS tăng ≥ X lần so với TB 7 ngày … */
  acosRatio: number;
  /** … và tăng ít nhất X điểm % */
  acosMinPoints: number;
  /** Chỉ xét ACOS khi Ads ngày ≥ $X */
  minAdsSpend: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  revenueDropPct: 0.4,
  minAvgRevenue: 200,
  acosRatio: 1.5,
  acosMinPoints: 10,
  minAdsSpend: 30,
};

export interface Anomaly {
  kind: "revenue_drop" | "acos_spike" | "ads_no_sales";
  text: string;
}

function sumDays(days: DayLike[]) {
  return days.reduce(
    (acc, d) => ({
      revenue: acc.revenue + d.revenue,
      adsFee: acc.adsFee + d.adsFee,
      revenueAds: acc.revenueAds + d.revenueAds,
      profit: acc.profit + d.profit,
      quantity: acc.quantity + d.quantity,
    }),
    { revenue: 0, adsFee: 0, revenueAds: 0, profit: 0, quantity: 0 },
  );
}

const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** So ngày `date` với TB/ngày của 7 ngày trước đó. Thiếu ngày nền thì không báo. */
export function detectAnomalies(days: DayLike[], date: string, th: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS): Anomaly[] {
  const today = days.filter((d) => d.date === date);
  const base = days.filter((d) => d.date >= shiftDate(date, -7) && d.date < date);
  if (!today.length || base.length < 5) return [];
  const t = sumDays(today);
  const b = sumDays(base);
  const n = base.length;
  const avgRevenue = b.revenue / n;
  const out: Anomaly[] = [];

  if (avgRevenue >= th.minAvgRevenue && t.revenue <= avgRevenue * (1 - th.revenueDropPct)) {
    const drop = 1 - t.revenue / avgRevenue;
    out.push({ kind: "revenue_drop", text: `Revenue ${usd(t.revenue)}, giảm ${pct(drop)} so với TB 7 ngày (${usd(avgRevenue)}/ngày)` });
  }

  const baseAcos = b.revenueAds > 0 ? b.adsFee / b.revenueAds : null;
  if (t.adsFee >= th.minAdsSpend) {
    if (t.revenueAds <= 0) {
      if (b.revenueAds > 0) out.push({ kind: "ads_no_sales", text: `Ads chi ${usd(t.adsFee)} nhưng không có sales từ Ads` });
    } else if (baseAcos != null) {
      const acos = t.adsFee / t.revenueAds;
      if (acos >= baseAcos * th.acosRatio && acos - baseAcos >= th.acosMinPoints / 100) {
        out.push({ kind: "acos_spike", text: `ACOS ${pct(acos)}, tăng từ ${pct(baseAcos)} (TB 7 ngày), Ads chi ${usd(t.adsFee)}` });
      }
    }
  }
  return out;
}

/** Tổng 2 tuần (tuần này vs tuần trước) cho tóm tắt tuần. */
export function compareWeeks(days: DayLike[], weekStart: string, weekEnd: string) {
  const cur = days.filter((d) => d.date >= weekStart && d.date <= weekEnd);
  const span = Math.round((Date.parse(`${weekEnd}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86400_000) + 1;
  const prevStart = shiftDate(weekStart, -7);
  const prevEnd = shiftDate(prevStart, span - 1);
  const prev = days.filter((d) => d.date >= prevStart && d.date <= prevEnd);
  const c = sumDays(cur);
  const p = sumDays(prev);
  const tacos = (x: ReturnType<typeof sumDays>) => (x.revenue > 0 ? x.adsFee / x.revenue : null);
  const change = (a: number, b: number) => (Math.abs(b) >= 1 ? a / b - 1 : null);
  return {
    cur: { ...c, tacos: tacos(c), days: cur.length },
    prev: { ...p, tacos: tacos(p), days: prev.length, start: prevStart, end: prevEnd },
    revenueChange: change(c.revenue, p.revenue),
    profitChange: p.profit > 0 ? change(c.profit, p.profit) : null,
  };
}

// ───────────── Lệnh /help ─────────────

const HELP_RE = /^\s*(?:\/(?:help|h|trogiup|huongdan|menu)|help|menu|tr[ợơ]\s*gi[úu]p|h[ưu][ớo]ng\s*d[ẫa]n|bot\s+l[àa]m\s+(?:đ|d)[ưu][ợo]c\s+g[ìi]\??)\s*[.!?]*\s*$/i;

export function isHelpCommand(message: string): boolean {
  return HELP_RE.test(message.normalize("NFC"));
}

/** Nội dung /help: câu hỏi mẫu điền sẵn store của chính người hỏi. */
export function buildHelpSections(storeNames: string[]): Array<{ title: string; lines: string[] }> {
  const s = storeNames[0] || "<tên store>";
  return [
    {
      title: "📊 Kinh doanh & lợi nhuận",
      lines: [
        "Hôm qua kinh doanh thế nào? Store nào cần chú ý?",
        `Revenue ${s} tháng này`,
        `So sánh ${s} tháng này với tháng trước`,
        "Store nào Profit cao nhất tháng này?",
        "chi tiết báo cáo · phân tích " + s,
      ],
    },
    {
      title: "🎯 KPI so với kế hoạch",
      lines: [`${s} tháng này đạt bao nhiêu % KPI?`, `KPI ${s} tháng 10 · SKU nào chậm KPI?`],
    },
    {
      title: "💵 Lãi theo SKU & Base Cost",
      lines: [`SKU nào lỗ tuần này ở ${s}?`, `Top SKU lãi nhất ${s} tháng này`, `SKU X ở ${s} thế nào?`],
    },
    {
      title: "📦 Tồn kho & hàng đang về",
      lines: [
        `${s} SKU nào sắp hết hàng?`,
        `Gợi ý nhập hàng ${s} cho Black Friday / Giáng sinh`,
        `Lô hàng đang về của ${s}`,
      ],
    },
    {
      title: "📢 PPC",
      lines: [
        `Từ khóa cần phủ định ${s}`,
        `Sale KW cần lên camp ${s}`,
        `Đề xuất bid ${s} · duyệt số 1, 2`,
        `Chỉnh bid có hiệu quả không ${s}?`,
      ],
    },
    {
      title: "🧩 Listing & Mockup",
      lines: ["Batch Trello hôm nay xong chưa?", "Mockup của tôi hôm nay có job nào lỗi không?"],
    },
  ];
}

export function buildHelpText(storeNames: string[]): string {
  const head = storeNames.length
    ? `🤖 **Bot trả lời dữ liệu các store bạn được cấp quyền:** ${storeNames.join(", ")}`
    : "🤖 **Bot trả lời dữ liệu các store bạn được cấp quyền.**";
  const body = buildHelpSections(storeNames)
    .map((sec) => `**${sec.title}**\n${sec.lines.map((l) => `- ${l}`).join("\n")}`)
    .join("\n\n");
  return `${head}\n\nTag bot rồi hỏi tự nhiên, ví dụ:\n\n${body}\n\n💡 Hỏi nhiều store thì nêu tên store. Gõ /help để xem lại danh sách này.`;
}

export function buildHelpCard(storeNames: string[]): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: { template: "blue", title: { tag: "plain_text", content: "🤖 AI Agent làm được gì?" } },
    body: { elements: [{ tag: "markdown", content: buildHelpText(storeNames) }] },
  };
}

// ───────────── Gợi ý nhập hàng (dự báo theo mùa) ─────────────
// Khung chuẩn (SS/ROP): điểm đặt hàng = nhu cầu trong thời gian chờ hàng + tồn an toàn,
// tồn an toàn = Z × σ(bán/ngày) × √(thời gian chờ). Mùa vụ = chỉ số cùng kỳ năm trước,
// SKU thiếu lịch sử thì mượn chỉ số của nhóm sản phẩm, rồi của cả store.

export interface RestockSettings {
  /** Thời gian từ lúc đặt hàng tới lúc hàng nhập kho Amazon (ngày) */
  leadTimeDays: number;
  /** Lô mới cần đủ bán thêm N ngày sau khi về */
  coverDays: number;
  /** Hệ số mức phục vụ (1.65 ≈ 95% không hết hàng) */
  z: number;
}

export interface MonthUnits {
  /** "YYYY-MM" → units cả tháng */
  [period: string]: number;
}

export interface SeasonSource {
  sku: MonthUnits;
  productType: MonthUnits | null;
  store: MonthUnits;
}

/** Mốc mua sắm lớn ở Mỹ (Amazon US) theo năm. */
export function retailEvents(year: number): Array<{ date: string; name: string }> {
  const nthWeekday = (month: number, weekday: number, n: number) => {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  const thanksgiving = nthWeekday(11, 4, 4);
  return [
    { date: `${year}-02-14`, name: "Valentine" },
    { date: nthWeekday(5, 0, 2), name: "Mother's Day" },
    { date: nthWeekday(6, 0, 3), name: "Father's Day" },
    { date: `${year}-07-15`, name: "Prime Day (khoảng giữa tháng 7)" },
    { date: `${year}-10-08`, name: "Prime Big Deal Days (khoảng đầu tháng 10)" },
    { date: `${year}-10-31`, name: "Halloween" },
    { date: shiftDate(thanksgiving, 1), name: "Black Friday" },
    { date: shiftDate(thanksgiving, 4), name: "Cyber Monday" },
    { date: `${year}-12-25`, name: "Giáng sinh (khách đặt trước ~15/12)" },
  ];
}

export function upcomingEvents(from: string, to: string) {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  return [...years].flatMap(retailEvents).filter((e) => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

const prevYear = (period: string) => `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;

/** Tỉ trọng từng tháng trong 28 ngày tính tốc độ nền (VD 11/10 → 2026-09: 0.39, 2026-10: 0.61). */
export function baseWindowWeights(today: string, days = 28): Record<string, number> {
  const w: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const p = shiftDate(today, -i).slice(0, 7);
    w[p] = (w[p] ?? 0) + 1 / days;
  }
  return w;
}

/**
 * Hệ số mùa của tháng `target` so với "bây giờ", đo bằng năm trước, theo units TRUNG BÌNH MỖI NGÀY:
 *   units/ngày(target năm trước) ÷ units/ngày(các tháng của 28 ngày gần nhất, năm trước, theo tỉ trọng).
 * Lấy theo SKU nếu đủ mẫu, không thì nhóm sản phẩm, không thì cả store. Kẹp trong [0.3, 5].
 */
export function seasonalFactor(source: SeasonSource, baseWeights: Record<string, number>, target: string) {
  const perDay = (m: MonthUnits, period: string) => {
    const ly = prevYear(period);
    return m[ly] == null ? null : m[ly] / daysInMonth(ly);
  };
  const tryLevel = (m: MonthUnits | null, minMonthly: number) => {
    if (!m) return null;
    let base = 0;
    for (const [p, w] of Object.entries(baseWeights)) {
      const v = perDay(m, p);
      if (v == null) return null;
      base += w * v;
    }
    const t = perDay(m, target);
    if (t == null || base * 30 < minMonthly) return null;
    return t / base;
  };
  // Kẹp 0.3–5: mùa quà tặng có thể gấp 4–5 lần tháng thường; ngoài khoảng này thường là nhiễu mẫu nhỏ
  const clamp = (raw: number) => ({ factor: Math.min(SEASON_MAX, Math.max(SEASON_MIN, raw)), clamped: raw > SEASON_MAX || raw < SEASON_MIN });
  const sku = tryLevel(source.sku, 20);
  if (sku != null) return { ...clamp(sku), level: "sku" as const };
  const pt = tryLevel(source.productType, 50);
  if (pt != null) return { ...clamp(pt), level: "product_type" as const };
  const st = tryLevel(source.store, 100);
  if (st != null) return { ...clamp(st), level: "store" as const };
  return { factor: 1, clamped: false, level: "none" as const };
}

const SEASON_MIN = 0.3;
const SEASON_MAX = 5;

export interface RestockInput {
  sku: string;
  status: string | null;
  productType: string | null;
  /** Units bán từng ngày, 56 ngày gần nhất, ngày cũ trước (thiếu ngày = 0) */
  daily: number[];
  sellable: number;
  inTransit: number;
  inboundPending: number;
  nextArrival: string | null;
  season: SeasonSource;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const std = (xs: number[]) => {
  const m = avg(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : 0;
};

/**
 * Kế hoạch nhập 1 SKU. `today` = ngày có dữ liệu bán mới nhất.
 * Tốc độ nền = 40% TB 14 ngày + 40% TB 28 ngày + 20% TB 56 ngày (bớt nhiễu, vẫn nhạy xu hướng).
 */
export function planRestock(input: RestockInput, today: string, s: RestockSettings) {
  const d = input.daily;
  const r14 = avg(d.slice(-14));
  const r28 = avg(d.slice(-28));
  const r56 = avg(d.slice(-56));
  const base = 0.4 * r14 + 0.4 * r28 + 0.2 * r56;
  const prev28 = avg(d.slice(-56, -28));
  const trend = prev28 > 0 ? r28 / prev28 - 1 : null;
  const sigma = std(d.slice(-56));
  const salesDays = d.filter((x) => x > 0).length;

  // Dự báo từng ngày tới hết (thời gian chờ + số ngày cần đủ bán), nhân hệ số mùa của tháng
  const horizon = s.leadTimeDays + s.coverDays;
  const baseWeights = baseWindowWeights(today);
  const factors = new Map<string, ReturnType<typeof seasonalFactor>>();
  const daily: number[] = [];
  for (let i = 1; i <= horizon; i++) {
    const p = shiftDate(today, i).slice(0, 7);
    if (!factors.has(p)) factors.set(p, seasonalFactor(input.season, baseWeights, p));
    daily.push(base * factors.get(p)!.factor);
  }
  const sum = (from: number, to: number) => daily.slice(from, to).reduce((a, x) => a + x, 0);
  const demandLead = sum(0, s.leadTimeDays);
  const demandTotal = sum(0, horizon);
  const leadFactor = s.leadTimeDays ? demandLead / (base * s.leadTimeDays || 1) : 1;
  const safety = s.z * sigma * Math.sqrt(s.leadTimeDays) * (base > 0 ? leadFactor : 1);
  const onHand = input.sellable;
  const coming = input.inTransit + input.inboundPending;
  const suggest = Math.max(0, Math.ceil(demandTotal + safety - onHand - coming));

  // Ngày hết hàng sẵn bán (chưa tính hàng đang về) và hạn chót đặt hàng để lô mới về kịp
  let stockoutDay: number | null = null;
  let left = onHand;
  for (let i = 0; i < daily.length; i++) {
    left -= daily[i];
    if (left <= 0) { stockoutDay = i + 1; break; }
  }
  // Hết cả hàng sẵn + hàng đang về (giả định hàng đang về kịp nhập kho)
  let coverAllDay: number | null = null;
  let all = onHand + coming;
  for (let i = 0; i < daily.length; i++) {
    all -= daily[i];
    if (all <= safety) { coverAllDay = i + 1; break; }
  }
  const orderBy = coverAllDay == null ? null : shiftDate(today, coverAllDay - s.leadTimeDays);

  const levels = [...factors.values()].map((f) => f.level);
  const seasonLevel = levels.includes("none") ? "none" : levels.includes("store") ? "store" : levels.includes("product_type") ? "product_type" : "sku";
  const confidence =
    salesDays < 10 ? "thấp" : seasonLevel === "sku" && salesDays >= 28 ? "cao" : seasonLevel === "none" ? "thấp" : "trung bình";

  return {
    sku: input.sku,
    status: input.status,
    productType: input.productType,
    baseUnitsPerDay: Math.round(base * 100) / 100,
    last14PerDay: Math.round(r14 * 100) / 100,
    last56PerDay: Math.round(r56 * 100) / 100,
    trend28Pct: trend == null ? null : Math.round(trend * 1000) / 10,
    seasonByMonth: [...factors.entries()].map(([period, f]) => ({ period, factor: Math.round(f.factor * 100) / 100, level: f.level, clamped: f.clamped })),
    demandLeadTime: Math.round(demandLead),
    demandTotal: Math.round(demandTotal),
    safetyStock: Math.round(safety),
    sellable: onHand,
    coming,
    nextArrival: input.nextArrival,
    stockoutDate: stockoutDay == null ? null : shiftDate(today, stockoutDay),
    orderByDate: orderBy,
    orderNow: orderBy != null && orderBy <= today,
    suggestUnits: suggest,
    confidence,
    salesDays56: salesDays,
  };
}
