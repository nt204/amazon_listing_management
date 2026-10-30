// Phân tích số liệu cho báo cáo kinh doanh ngày qua Lark (thuần, không truy cập DB).
// Mọi con số và đánh giá đèn được tính ở đây; AI (nếu bật) chỉ diễn đạt lại.
//
// Hai mốc so sánh, mỗi mốc một vai trò:
//   - Δ (biến động) = so với HÔM QUA: hôm nay khác hôm qua bao nhiêu, vì sao.
//   - Đèn (sức khỏe) = Profit so với TB/ngày của THÁNG (đầu tháng chưa đủ ngày thì dùng TB 7 ngày).

import { summarizeDays, type DashboardDay, type DashboardTotals } from "./dashboard-totals";

export type ReportChannel = "FBA" | "FBM";
export type Light = "green" | "yellow" | "red";

export interface ChannelSeriesInput {
  label: string;
  storeName: string;
  channel: ReportChannel;
  team: string;
  /** Kênh mới mở (< 30 ngày): không chấm đèn, không đưa vào ưu tiên. */
  isNew: boolean;
  /** Số liệu từng ngày, đã bao gồm khoảng lịch sử dùng để so sánh. */
  days: DashboardDay[];
  /** Chi tiết SKU / portfolio Ads để truy nguyên nhân. */
  drill?: ChannelDrill;
}

/** Units 1 SKU: ngày báo cáo và hôm qua. */
export interface SkuMove {
  sku: string;
  today: number;
  prev: number;
  avg7?: number;
}

/** Chi tiêu 1 portfolio Ads: ngày báo cáo và hôm qua. */
export interface PortfolioStat {
  name: string;
  todaySpend: number;
  todaySales: number;
  todayOrders: number;
  prevSpend: number;
  avg7Spend?: number;
}

export interface ChannelDrill {
  skus: SkuMove[];
  portfolios: PortfolioStat[];
}

/** Rà soát 1 kênh: nguyên nhân (kèm bằng chứng) và việc cần kiểm tra. */
export interface ChannelDiagnosis {
  cause: string;
  checks: string[];
  /** true = kênh có vấn đề cần xử lý; false = biến động tốt, chỉ ghi nhận. */
  isIssue: boolean;
  impact: number;
}

export interface PeriodComparison {
  today: DashboardTotals;
  /** Hôm qua (null khi hôm qua không có số). */
  prev: DashboardTotals | null;
  /** Trung bình/ngày của 7 ngày trước ngày báo cáo. */
  avg7: DashboardTotals | null;
  /** Trung bình/ngày từ đầu tháng đến hôm qua. */
  monthAvg: DashboardTotals | null;
  /** Mốc chấm đèn: TB tháng nếu đủ 3 ngày, không thì TB 7 ngày. */
  health: DashboardTotals | null;
}

export interface ChannelAnalysis extends PeriodComparison {
  label: string;
  storeName: string;
  channel: ReportChannel;
  team: string;
  isNew: boolean;
  light: Light;
  /** Ads = 0 trong khi các ngày trước có chạy: nhiều khả năng file Ads chưa nạp. */
  adsMissing: boolean;
  /** Hôm nay có Ads nhưng hôm qua không có: Δ Profit so với hôm qua không tin được. */
  prevAdsMissing: boolean;
  /** Alias cho prevAdsMissing */
  baselineAdsMissing: boolean;
  diagnosis: ChannelDiagnosis | null;
}

export interface TeamAnalysis extends PeriodComparison {
  team: string;
  light: Light;
  channels: ChannelAnalysis[];
  /** Kênh thiếu số Ads: Δ Profit gộp không tin được. */
  unreliable: string[];
}

export interface ProfitDriver {
  label: string;
  delta: number;
}

export interface ActionItem {
  team: string;
  label: string;
  /** Việc cần làm đầu tiên của kênh. */
  title: string;
  /** Nguyên nhân kèm con số. */
  reason: string;
  /** Ước tính $ ảnh hưởng, dùng để xếp hạng. */
  impact: number;
}

export interface DailyReportAnalysis {
  date: string;
  company: PeriodComparison & { light: Light; storeCount: number; channelCount: number; unreliable: string[] };
  teams: TeamAnalysis[];
  drivers: { up: ProfitDriver[]; down: ProfitDriver[] };
  actions: ActionItem[];
}

/** Ngưỡng chấm đèn (Profit hôm nay so với mốc sức khỏe) — in ra cuối báo cáo. */
export const LIGHT_RULES = {
  redProfitRatio: 0.6,
  yellowProfitRatio: 0.85,
  /** Chỉ chấm theo tỉ lệ khi mốc đủ lớn để có ý nghĩa. */
  minBaselineProfit: 50,
} as const;

const SUM_KEYS = [
  "revenue", "quantity", "orders", "adsFee", "basecost", "amazonFee", "tax",
  "promotion", "returnCost", "profit", "netProfit", "revenueAds", "clicks",
] as const;

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function averagePerDay(days: DashboardDay[]): DashboardTotals | null {
  const total = summarizeDays(days);
  if (!total.days) return null;
  const avg = { ...total };
  for (const key of SUM_KEYS) avg[key] = total[key] / total.days;
  avg.serviceCost = total.serviceCost / total.days;
  return avg;
}

export function compareSeries(days: DashboardDay[], date: string): PeriodComparison {
  const inRange = (from: string, to: string) => days.filter((d) => d.date >= from && d.date <= to);
  const yesterday = shiftIsoDate(date, -1);
  const prevDays = inRange(yesterday, yesterday);
  const monthStart = `${date.slice(0, 8)}01`;
  const avg7 = averagePerDay(inRange(shiftIsoDate(date, -7), yesterday));
  const monthAvg = monthStart < date ? averagePerDay(inRange(monthStart, yesterday)) : null;
  return {
    today: summarizeDays(inRange(date, date)),
    prev: prevDays.length ? summarizeDays(prevDays) : null,
    avg7,
    monthAvg,
    health: monthAvg && monthAvg.days >= 3 ? monthAvg : avg7,
  };
}

/** Cộng nhiều chuỗi theo ngày (gộp kênh thành team / công ty). */
export function sumSeries(series: DashboardDay[][]): DashboardDay[] {
  const map = new Map<string, DashboardDay>();
  for (const day of series.flat()) {
    const existing = map.get(day.date);
    if (!existing) {
      map.set(day.date, { ...day });
      continue;
    }
    for (const key of SUM_KEYS) existing[key] += day[key] ?? 0;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function isAdsMissing(cmp: PeriodComparison): boolean {
  return cmp.today.adsFee === 0 && (cmp.avg7?.adsFee ?? 0) >= 20;
}

export function isPrevAdsMissing(cmp: PeriodComparison): boolean {
  return Boolean(cmp.prev && cmp.prev.adsFee < 1 && cmp.today.adsFee >= 20);
}

export function lightOf(cmp: PeriodComparison): Light {
  const { today, health } = cmp;
  if (today.profit < 0) return "red";
  if (isAdsMissing(cmp)) return "yellow";
  if (!health || health.profit < LIGHT_RULES.minBaselineProfit) return "green";
  // Mốc không có số Ads thì profit mốc bị thổi phồng: không chấm theo tỉ lệ
  if (health.adsFee < 1 && today.adsFee >= 20) return "yellow";
  if (today.profit < health.profit * LIGHT_RULES.redProfitRatio) return "red";
  if (today.profit < health.profit * LIGHT_RULES.yellowProfitRatio) return "yellow";
  return "green";
}

const usdAbs = (value: number) => `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
const usdSigned = (value: number) => `${value >= 0 ? "+" : "-"}${usdAbs(value)}`;
const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);

/** SKU tụt units mạnh nhất so với hôm qua (bỏ SKU bán lẻ tẻ để tránh nhiễu). */
function skuDrops(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.prev >= 3 && s.today <= s.prev * 0.5)
    .sort((a, b) => b.prev - b.today - (a.prev - a.today))
    .slice(0, 2);
}

function skuGains(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.today >= 3 && s.today >= s.prev * 1.5)
    .sort((a, b) => b.today - b.prev - (a.today - a.prev))
    .slice(0, 2);
}

const skuText = (list: SkuMove[]) => list.map((s) => `${shortName(s.sku)} ${s.prev}→${s.today}`).join(", ");

/** Bằng chứng + việc cần làm cho phần chi phí Ads. */
function adsEvidence(drill: ChannelDrill | undefined, checks: string[]): string {
  const burning = (drill?.portfolios ?? [])
    .filter((p) => p.todaySpend >= 15 && p.todayOrders === 0)
    .sort((a, b) => b.todaySpend - a.todaySpend)
    .slice(0, 2);
  if (burning.length) {
    checks.push(`Giảm bid / tắt ${burning.map((p) => `${shortName(p.name)} (${usdAbs(p.todaySpend)}, 0 đơn)`).join(", ")}`);
    return `${burning.length} portfolio tiêu tiền 0 đơn`;
  }
  const spike = (drill?.portfolios ?? [])
    .filter((p) => p.todaySpend - p.prevSpend >= 15)
    .sort((a, b) => b.todaySpend - b.prevSpend - (a.todaySpend - a.prevSpend))[0];
  if (spike) {
    const acos = spike.todaySales > 0 ? `, ACoS ${Math.round((spike.todaySpend / spike.todaySales) * 100)}%` : "";
    checks.push(`Rà search term ${shortName(spike.name)}`);
    return `${shortName(spike.name)} ${usdAbs(spike.prevSpend)}→${usdAbs(spike.todaySpend)}${acos}`;
  }
  checks.push("Rà search term ACoS cao, thêm negative keyword");
  return "";
}

/** Cách nói từng phần tách Δ Profit: [kéo giảm, kéo tăng]. */
const PART_TEXT: Record<string, [(v: string) => string, (v: string) => string]> = {
  volume: [(v) => `doanh số giảm, mất ${v}`, (v) => `doanh số tăng, thêm ${v}`],
  rate: [(v) => `biên giảm, mất ${v}`, (v) => `biên tăng, thêm ${v}`],
  ads: [(v) => `Ads tốn thêm ${v}`, (v) => `Ads giảm, tiết kiệm ${v}`],
};

/**
 * Rà soát 1 kênh. Δ Profit so với hôm qua được tách đúng bằng 3 phần:
 *   doanh số = ΔRevenue × biên trước Ads của hôm qua
 *   biên     = Revenue hôm nay × Δ biên trước Ads (giá, phí, refund, giá vốn)
 *   Ads      = −ΔAds
 * Phần nào kéo giảm thì truy bằng chứng (SKU, portfolio, khoản phí) và đề xuất việc kiểm tra.
 */
export function diagnoseChannel(ch: Omit<ChannelAnalysis, "diagnosis">, drill?: ChannelDrill): ChannelDiagnosis | null {
  const { today: t, prev: b, avg7 } = ch;
  const checks: string[] = [];

  if (ch.adsMissing && avg7) {
    return { cause: `chưa có số Ads (TB ${usdAbs(avg7.adsFee)}/ngày), Profit đang cao ảo`, checks: ["Nạp file Ads ngày này"], isIssue: true, impact: avg7.adsFee };
  }

  if (t.revenue <= 0 && t.adsFee > 0) {
    const lost = skuDrops(drill);
    return {
      cause: `không có doanh thu nhưng vẫn tiêu ${usdAbs(t.adsFee)} Ads`,
      checks: ["Dừng Ads ngay", `Kiểm tra listing bị ẩn / hết hàng${lost.length ? `: ${lost.map((s) => shortName(s.sku)).join(", ")}` : ""}`],
      isIssue: true,
      impact: t.adsFee + Math.max(0, b?.profit ?? 0),
    };
  }

  if (ch.prevAdsMissing) {
    return { cause: "hôm qua thiếu số Ads, chưa so được Profit", checks: ["Nạp bù file Ads hôm qua"], isIssue: true, impact: t.adsFee };
  }

  if (!b) {
    if (t.profit >= 0) return null;
    const evidence = adsEvidence(drill, checks);
    return { cause: evidence || `lỗ ${usdAbs(t.profit)}`, checks: checks.slice(0, 2), isIssue: true, impact: Math.abs(t.profit) };
  }

  const dProfit = t.profit - b.profit;
  const isIssue = t.profit < 0 || ch.light !== "green" || dProfit <= -30;
  if (!isIssue && dProfit < 30) return null;

  const baseRate = b.revenue > 0 ? (b.profit + b.adsFee) / b.revenue : 0;
  const todayRate = t.revenue > 0 ? (t.profit + t.adsFee) / t.revenue : baseRate;
  const parts = [
    { key: "volume", value: (t.revenue - b.revenue) * baseRate },
    { key: "rate", value: t.revenue * (todayRate - baseRate) },
    { key: "ads", value: -(t.adsFee - b.adsFee) },
  ]
    .filter((p) => Math.abs(p.value) >= 15)
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const describe = (p: { key: string; value: number }) => PART_TEXT[p.key][p.value >= 0 ? 1 : 0](usdAbs(p.value));

  // Kênh có vấn đề: nêu phần kéo giảm, phần kéo tăng ghi là "bù"; kênh tốt: nêu phần kéo tăng
  const main = parts.filter((p) => (isIssue ? p.value < 0 : p.value > 0)).slice(0, 2);
  const offset = isIssue ? parts.filter((p) => p.value > 0).slice(0, 1) : [];

  const evidence: string[] = [];
  for (const part of main) {
    if (part.key === "volume") {
      if (!isIssue) {
        const gains = skuGains(drill);
        if (gains.length) evidence.push(`${skuText(gains)} units`);
        continue;
      }
      const lost = skuDrops(drill);
      if (lost.length) {
        evidence.push(`${skuText(lost)} units`);
        checks.push(`${lost.every((s) => s.today === 0) ? "Kiểm tra tồn kho, listing" : "Kiểm tra Buy Box, giá, traffic"}: ${lost.map((s) => shortName(s.sku)).join(", ")}`);
      }
      if (b.revenueAds > 0) {
        const organic = t.revenue - t.revenueAds - (b.revenue - b.revenueAds);
        const adSales = t.revenueAds - b.revenueAds;
        if (organic < 0 && Math.abs(organic) > Math.abs(adSales)) {
          evidence.push(`organic ${usdSigned(organic)}`);
          checks.push("Organic giảm: kiểm tra rank keyword chính, review mới");
        } else if (adSales < 0) {
          evidence.push(`sales từ Ads ${usdSigned(adSales)}`);
        }
      }
      if (!lost.length) checks.push("Kiểm tra tồn kho, Buy Box, listing");
    } else if (part.key === "rate" && isIssue && t.revenue > 0 && b.revenue > 0) {
      const rateUp = [
        { label: "Refund", cost: (x: DashboardTotals) => x.returnCost, check: "Xem lý do trả hàng của SKU bị trả" },
        { label: "Phí AMZ", cost: (x: DashboardTotals) => x.amazonFee, check: "Kiểm tra phí FBA / size tier / phí lưu kho" },
        { label: "Promotion", cost: (x: DashboardTotals) => x.promotion, check: "Rà coupon / promotion đang chạy" },
        { label: "Giá vốn", cost: (x: DashboardTotals) => x.basecost, check: "Kiểm tra giá bán bị giảm hoặc mix SKU biên thấp" },
      ]
        .map((c) => ({ ...c, rise: c.cost(t) / t.revenue - c.cost(b) / b.revenue }))
        .sort((x, y) => y.rise - x.rise)[0];
      if (rateUp && rateUp.rise >= 0.02) {
        const share = (x: DashboardTotals) => `${Math.round((rateUp.cost(x) / x.revenue) * 100)}%`;
        evidence.push(`${rateUp.label} ${share(b)}→${share(t)} doanh thu`);
        checks.push(rateUp.check);
      }
    } else if (part.key === "ads" && isIssue) {
      const found = adsEvidence(drill, checks);
      if (found) evidence.push(found);
    }
  }

  if (isIssue && !main.length && t.profit < 0) {
    const found = adsEvidence(drill, checks);
    if (found) evidence.push(found);
  }

  const causeParts = [
    main.map(describe).join(", "),
    offset.length ? `(bù: ${offset.map(describe).join(", ")})` : "",
  ].filter(Boolean);
  const cause = [causeParts.join(" "), ...evidence.slice(0, 2)].filter(Boolean).join(" · ");
  return {
    cause: cause || (t.profit < 0 ? `lỗ ${usdAbs(t.profit)}` : "biến động nhỏ"),
    checks: [...new Set(checks)].slice(0, 2),
    isIssue,
    impact: Math.max(0, -dProfit) + Math.max(0, -t.profit),
  };
}

export function analyzeDailyReport(date: string, inputs: ChannelSeriesInput[]): DailyReportAnalysis {
  const channels: ChannelAnalysis[] = inputs.map((input) => {
    const cmp = compareSeries(input.days, date);
    return {
      label: input.label,
      storeName: input.storeName,
      channel: input.channel,
      team: input.team,
      isNew: input.isNew,
      ...cmp,
      light: lightOf(cmp),
      adsMissing: isAdsMissing(cmp),
      prevAdsMissing: isPrevAdsMissing(cmp),
      baselineAdsMissing: isPrevAdsMissing(cmp),
      diagnosis: null,
    };
  });
  for (const ch of channels) {
    ch.diagnosis = diagnoseChannel(ch, inputs.find((i) => i.label === ch.label)?.drill);
  }

  const unreliableOf = (list: ChannelAnalysis[]) =>
    list.filter((c) => c.adsMissing || c.prevAdsMissing).map((c) => c.label);
  const LIGHT_RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 };
  const worstLight = (list: ChannelAnalysis[], fallback: Light): Light =>
    list.filter((c) => !c.isNew).reduce<Light>((worst, c) => (LIGHT_RANK[c.light] > LIGHT_RANK[worst] ? c.light : worst), fallback);
  const groupLight = (cmp: PeriodComparison, members: ChannelAnalysis[]) =>
    unreliableOf(members).length ? worstLight(members, cmp.today.profit < 0 ? "red" : "green") : lightOf(cmp);

  const teamNames = [...new Set(inputs.map((i) => i.team))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const teams: TeamAnalysis[] = teamNames.map((team) => {
    const cmp = compareSeries(sumSeries(inputs.filter((i) => i.team === team).map((m) => m.days)), date);
    const members = channels
      .filter((c) => c.team === team)
      .sort((a, b) => Number(a.isNew) - Number(b.isNew) || b.today.revenue - a.today.revenue);
    return { team, ...cmp, light: groupLight(cmp, members), channels: members, unreliable: unreliableOf(members) };
  });

  const companyCmp = compareSeries(sumSeries(inputs.map((i) => i.days)), date);

  // Δ Profit so với hôm qua, phân rã theo kênh (bỏ kênh thiếu số Ads)
  const deltas = channels
    .filter((c) => c.prev && !c.adsMissing && !c.prevAdsMissing)
    .map((c) => ({ label: c.label, delta: c.today.profit - (c.prev?.profit ?? 0) }))
    .filter((d) => Math.abs(d.delta) >= 30);

  return {
    date,
    company: {
      ...companyCmp,
      light: groupLight(companyCmp, channels),
      storeCount: new Set(inputs.map((i) => i.storeName)).size,
      channelCount: channels.length,
      unreliable: unreliableOf(channels),
    },
    teams,
    drivers: {
      up: deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3),
      down: deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3),
    },
    // Ưu tiên toàn công ty = các kênh có vấn đề, xếp theo $ ảnh hưởng (cùng nguồn với phần rà soát từng team)
    actions: channels
      .filter((c) => !c.isNew && c.diagnosis?.isIssue && c.diagnosis.checks.length)
      .sort((x, y) => (y.diagnosis?.impact ?? 0) - (x.diagnosis?.impact ?? 0))
      .slice(0, 3)
      .map((c) => ({
        team: c.team,
        label: c.label,
        title: c.diagnosis?.checks[0] ?? "",
        reason: c.diagnosis?.cause ?? "",
        impact: c.diagnosis?.impact ?? 0,
      })),
  };
}
