// Phân tích số liệu cho báo cáo kinh doanh ngày qua Lark (thuần, không truy cập DB).
// Mọi con số và đánh giá đèn được tính ở đây; AI (nếu bật) chỉ diễn đạt lại.

import { summarizeDays, type DashboardDay, type DashboardTotals } from "./dashboard-totals";

export type ReportChannel = "FBA" | "FBM";
export type Light = "green" | "yellow" | "red";

export interface ChannelSeriesInput {
  label: string;
  storeName: string;
  channel: ReportChannel;
  team: string;
  /** Kênh mới mở (< 30 ngày có số): không chấm đèn, gom vào mục riêng. */
  isNew: boolean;
  /** Số liệu từng ngày, đã bao gồm khoảng lịch sử dùng để so sánh. */
  days: DashboardDay[];
  /** Chi tiết SKU / portfolio Ads để truy nguyên nhân. */
  drill?: ChannelDrill;
}

/** Units 1 SKU: ngày báo cáo và trung bình/ngày 7 ngày trước. */
export interface SkuMove {
  sku: string;
  today: number;
  avg7: number;
}

/** Chi tiêu 1 portfolio Ads: ngày báo cáo và trung bình/ngày 7 ngày trước. */
export interface PortfolioStat {
  name: string;
  todaySpend: number;
  todaySales: number;
  todayOrders: number;
  avg7Spend: number;
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
  /** Cùng thứ tuần trước (null khi ngày đó không có số). */
  lastWeek: DashboardTotals | null;
  /** Trung bình/ngày của 7 ngày trước ngày báo cáo (null khi chưa có lịch sử). */
  avg7: DashboardTotals | null;
  /** Trung bình/ngày từ đầu tháng đến hôm trước. */
  monthAvg: DashboardTotals | null;
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
  /** Hôm nay có Ads nhưng 7 ngày trước không có: mốc so sánh profit không tin được. */
  baselineAdsMissing: boolean;
  diagnosis: ChannelDiagnosis | null;
}

export interface TeamAnalysis extends PeriodComparison {
  team: string;
  light: Light;
  channels: ChannelAnalysis[];
  /** Kênh thiếu số Ads (hôm nay hoặc 7 ngày trước): profit gộp không so được với TB 7 ngày. */
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
  company: PeriodComparison & { light: Light; channelCount: number; unreliable: string[] };
  teams: TeamAnalysis[];
  newChannels: ChannelAnalysis[];
  drivers: { up: ProfitDriver[]; down: ProfitDriver[] };
  actions: ActionItem[];
}

/** Ngưỡng chấm đèn — in ra cuối báo cáo để người đọc biết quy tắc. */
export const LIGHT_RULES = {
  /** Profit dưới tỉ lệ này so với TB 7 ngày = đỏ. */
  redProfitRatio: 0.6,
  /** Profit dưới tỉ lệ này so với TB 7 ngày = vàng. */
  yellowProfitRatio: 0.85,
  /** TACoS tăng từ mức này (điểm %) so với TB 7 ngày = vàng. */
  yellowTacosRise: 0.05,
  /** Chỉ so profit khi TB 7 ngày đủ lớn để có ý nghĩa. */
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
  const lastWeekDays = inRange(shiftIsoDate(date, -7), shiftIsoDate(date, -7));
  const monthStart = `${date.slice(0, 8)}01`;
  return {
    today: summarizeDays(inRange(date, date)),
    lastWeek: lastWeekDays.length ? summarizeDays(lastWeekDays) : null,
    avg7: averagePerDay(inRange(shiftIsoDate(date, -7), shiftIsoDate(date, -1))),
    monthAvg: monthStart < date ? averagePerDay(inRange(monthStart, shiftIsoDate(date, -1))) : null,
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

export function isBaselineAdsMissing(cmp: PeriodComparison): boolean {
  return Boolean(cmp.avg7 && cmp.avg7.adsFee < 1 && cmp.today.adsFee >= 20);
}

export function lightOf(cmp: PeriodComparison): Light {
  const { today, avg7 } = cmp;
  if (today.profit < 0) return "red";
  if (!avg7) return "green";
  if (isBaselineAdsMissing(cmp)) return "yellow";
  const baselineOk = avg7.profit >= LIGHT_RULES.minBaselineProfit;
  if (baselineOk && today.profit < avg7.profit * LIGHT_RULES.redProfitRatio) return "red";
  if (isAdsMissing(cmp)) return "yellow";
  if (baselineOk && today.profit < avg7.profit * LIGHT_RULES.yellowProfitRatio) return "yellow";
  if (today.adsFee >= 20 && avg7.adsFee >= 20 && today.tacos - avg7.tacos >= LIGHT_RULES.yellowTacosRise) return "yellow";
  return "green";
}

const usdAbs = (value: number) => `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
const usdSigned = (value: number) => `${value >= 0 ? "+" : "-"}${usdAbs(value)}`;
const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);
const units = (value: number) => (value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, ""));

/** SKU tụt units mạnh nhất so với TB 7 ngày. */
function skuDrops(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.avg7 >= 1 && s.today <= s.avg7 * 0.6)
    .sort((a, b) => b.avg7 - b.today - (a.avg7 - a.today))
    .slice(0, 2);
}

function skuGains(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.today >= 2 && s.today >= s.avg7 * 1.5)
    .sort((a, b) => b.today - b.avg7 - (a.today - a.avg7))
    .slice(0, 2);
}

const skuText = (list: SkuMove[]) => list.map((s) => `${shortName(s.sku)} ${units(s.today)}/${units(s.avg7)}`).join(", ");

/** Bằng chứng + việc cần làm cho phần chi phí Ads. */
function adsEvidence(drill: ChannelDrill | undefined, checks: string[]): string {
  const burning = (drill?.portfolios ?? [])
    .filter((p) => p.todaySpend >= 15 && p.todayOrders === 0)
    .sort((a, b) => b.todaySpend - a.todaySpend)
    .slice(0, 2);
  if (burning.length) {
    checks.push(`Giảm bid / tắt ${burning.map((p) => `${shortName(p.name)} (${usdAbs(p.todaySpend)}, 0 đơn)`).join(", ")}`);
    return `${burning.length} portfolio tiêu tiền không ra đơn`;
  }
  const spike = (drill?.portfolios ?? [])
    .filter((p) => p.todaySpend - p.avg7Spend >= 15)
    .sort((a, b) => b.todaySpend - b.avg7Spend - (a.todaySpend - a.avg7Spend))[0];
  if (spike) {
    const acos = spike.todaySales > 0 ? ` ACoS ${Math.round((spike.todaySpend / spike.todaySales) * 100)}%` : "";
    checks.push(`Rà search term ${shortName(spike.name)}: Ads ${usdAbs(spike.todaySpend)} (TB ${usdAbs(spike.avg7Spend)})${acos}`);
    return `${shortName(spike.name)} tăng chi ${usdSigned(spike.todaySpend - spike.avg7Spend)}`;
  }
  checks.push("Rà search term ACoS cao, thêm negative keyword");
  return "";
}

/** Tên phần tách Δ Profit theo chiều tác động: [kéo giảm, kéo tăng]. */
const PART_LABELS: Record<string, [string, string]> = {
  volume: ["doanh số giảm", "doanh số tăng"],
  rate: ["biên giảm", "biên tăng"],
  ads: ["Ads tăng", "Ads giảm"],
};

/**
 * Rà soát 1 kênh. Δ Profit so với TB 7 ngày được tách đúng bằng 3 phần:
 *   doanh số   = ΔRevenue × biên trước Ads của TB 7 ngày
 *   biên       = Revenue hôm nay × Δ biên trước Ads (giá, phí, refund, giá vốn)
 *   chi phí Ads = −ΔAds
 * Phần nào kéo giảm thì truy bằng chứng (SKU, portfolio, khoản phí) và đề xuất việc kiểm tra.
 */
export function diagnoseChannel(ch: Omit<ChannelAnalysis, "diagnosis">, drill?: ChannelDrill): ChannelDiagnosis | null {
  const { today: t, avg7: b } = ch;
  const checks: string[] = [];

  if (ch.adsMissing && b) {
    return { cause: `chưa có số Ads (TB ${usdAbs(b.adsFee)}/ngày), Profit đang cao ảo`, checks: ["Nạp file Ads ngày này"], isIssue: true, impact: b.adsFee };
  }

  if (t.revenue <= 0 && t.adsFee > 0) {
    const lost = skuDrops(drill);
    checks.push("Dừng Ads ngay");
    checks.push(`Kiểm tra listing bị ẩn / hết hàng${lost.length ? `: ${lost.map((s) => shortName(s.sku)).join(", ")}` : ""}`);
    return {
      cause: `$0 doanh thu nhưng tiêu ${usdAbs(t.adsFee)} Ads${b ? ` (TB ${usdAbs(b.revenue)} doanh thu/ngày)` : ""}`,
      checks,
      isIssue: true,
      impact: t.adsFee + (b?.profit ?? 0),
    };
  }

  if (!b) {
    if (t.profit >= 0) return null;
    const evidence = adsEvidence(drill, checks);
    return { cause: `lỗ ${usdAbs(t.profit)}${evidence ? ` · ${evidence}` : ""}`, checks: checks.slice(0, 2), isIssue: true, impact: Math.abs(t.profit) };
  }

  if (ch.baselineAdsMissing) {
    // Mốc profit không tin được: chỉ so doanh số
    checks.push("Nạp bù file Ads 7 ngày trước");
    const drop = b.revenue > 0 ? (t.revenue - b.revenue) / b.revenue : 0;
    const lost = drop <= -0.3 ? skuDrops(drill) : [];
    if (lost.length) checks.push(`Kiểm tra tồn kho, Buy Box: ${lost.map((s) => shortName(s.sku)).join(", ")}`);
    return {
      cause: `7 ngày trước thiếu số Ads, chưa so được Profit · Revenue ${drop >= 0 ? "+" : ""}${Math.round(drop * 100)}%${lost.length ? ` (${skuText(lost)} units)` : ""}`,
      checks,
      isIssue: true,
      impact: t.adsFee + Math.max(0, b.revenue - t.revenue) * 0.2,
    };
  }

  const dProfit = t.profit - b.profit;
  if (Math.abs(dProfit) < 30 && t.profit >= 0 && ch.light === "green") return null;

  const baseRate = b.revenue > 0 ? (b.profit + b.adsFee) / b.revenue : 0;
  const todayRate = t.revenue > 0 ? (t.profit + t.adsFee) / t.revenue : baseRate;
  const parts = [
    { key: "volume", value: (t.revenue - b.revenue) * baseRate },
    { key: "rate", value: t.revenue * (todayRate - baseRate) },
    { key: "ads", value: -(t.adsFee - b.adsFee) },
  ]
    .map((p) => ({ ...p, label: PART_LABELS[p.key][p.value >= 0 ? 1 : 0] }))
    .filter((p) => Math.abs(p.value) >= 15)
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));

  const isIssue = dProfit < 0 || t.profit < 0 || ch.light !== "green";
  const evidence: string[] = [];
  // Kênh có vấn đề: truy các phần kéo giảm; kênh tốt: ghi nhận phần kéo lên
  for (const part of parts.filter((p) => (isIssue ? p.value < 0 : p.value > 0)).slice(0, 2)) {
    if (part.key === "volume") {
      if (isIssue) {
        const lost = skuDrops(drill);
        if (lost.length) {
          evidence.push(`${skuText(lost)} units`);
          const outOfStock = lost.every((s) => s.today === 0);
          checks.push(`${outOfStock ? "Kiểm tra tồn kho, listing" : "Kiểm tra Buy Box, giá, traffic"}: ${lost.map((s) => shortName(s.sku)).join(", ")}`);
        }
        if (b.revenueAds > 0) {
          const organic = t.revenue - t.revenueAds - (b.revenue - b.revenueAds);
          const adSales = t.revenueAds - b.revenueAds;
          if (organic < 0 && Math.abs(organic) > Math.abs(adSales)) {
            evidence.push(`organic ${usdSigned(organic)}`);
            checks.push("Organic giảm: kiểm tra rank keyword chính, review mới");
          } else if (adSales < 0) {
            evidence.push(`sales Ads ${usdSigned(adSales)}`);
          }
        }
        if (!lost.length && !evidence.length) checks.push("Kiểm tra tồn kho, Buy Box, listing");
      } else {
        const gains = skuGains(drill);
        if (gains.length) evidence.push(`${skuText(gains)} units`);
      }
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
        evidence.push(`${rateUp.label} ${Math.round((rateUp.cost(t) / t.revenue) * 100)}% doanh thu (TB ${Math.round((rateUp.cost(b) / b.revenue) * 100)}%)`);
        checks.push(rateUp.check);
      }
    } else if (part.key === "ads" && isIssue) {
      const found = adsEvidence(drill, checks);
      if (found) evidence.push(found);
    }
  }

  const head = t.profit < 0 ? `lỗ ${usdAbs(t.profit)}, ` : "";
  const bridge = parts.length ? `: ${parts.slice(0, 2).map((p) => `${p.label} ${usdSigned(p.value)}`).join(", ")}` : "";
  return {
    cause: `${head}Profit ${usdSigned(dProfit)}${bridge}${evidence.length ? ` · ${evidence.slice(0, 2).join(" · ")}` : ""}`,
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
      baselineAdsMissing: isBaselineAdsMissing(cmp),
      diagnosis: null,
    };
  });
  for (const ch of channels) {
    ch.diagnosis = diagnoseChannel(ch, inputs.find((i) => i.label === ch.label)?.drill);
  }

  const teamNames = [...new Set(inputs.map((i) => i.team))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const unreliableOf = (list: ChannelAnalysis[]) =>
    list.filter((c) => c.adsMissing || c.baselineAdsMissing).map((c) => c.label);
  const LIGHT_RANK: Record<Light, number> = { green: 0, yellow: 1, red: 2 };
  const worstLight = (list: ChannelAnalysis[], fallback: Light): Light =>
    list.filter((c) => !c.isNew).reduce<Light>((worst, c) => (LIGHT_RANK[c.light] > LIGHT_RANK[worst] ? c.light : worst), fallback);

  const teams: TeamAnalysis[] = teamNames.map((team) => {
    const members = inputs.filter((i) => i.team === team);
    const cmp = compareSeries(sumSeries(members.map((m) => m.days)), date);
    const teamChannels = channels.filter((c) => c.team === team);
    const unreliable = unreliableOf(teamChannels);
    return {
      team,
      ...cmp,
      unreliable,
      // Profit gộp không so được thì lấy đèn xấu nhất của các kênh
      light: unreliable.length ? worstLight(teamChannels, cmp.today.profit < 0 ? "red" : "green") : lightOf(cmp),
      channels: channels
        .filter((c) => c.team === team)
        .sort((a, b) => Number(a.isNew) - Number(b.isNew) || b.today.revenue - a.today.revenue),
    };
  });

  const companyCmp = compareSeries(sumSeries(inputs.map((i) => i.days)), date);

  // Profit hôm nay lệch TB 7 ngày bao nhiêu, phân rã theo kênh
  const deltas = channels
    .filter((c) => c.avg7 && !c.adsMissing && !c.baselineAdsMissing)
    .map((c) => ({ label: c.label, delta: c.today.profit - (c.avg7?.profit ?? 0) }))
    .filter((d) => Math.abs(d.delta) >= 30);

  return {
    date,
    company: {
      ...companyCmp,
      light: unreliableOf(channels).length
        ? worstLight(channels, companyCmp.today.profit < 0 ? "red" : "green")
        : lightOf(companyCmp),
      channelCount: channels.length,
      unreliable: unreliableOf(channels),
    },
    teams,
    newChannels: channels.filter((c) => c.isNew),
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
