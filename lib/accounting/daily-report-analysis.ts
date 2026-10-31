// Phân tích số liệu cho báo cáo kinh doanh ngày qua Lark (thuần, không truy cập DB).
//
// Nguyên tắc:
// - MỘT mốc so sánh duy nhất: trung bình/ngày của 7 ngày trước ngày báo cáo (TB 7 ngày).
//   Mọi Δ (tổng, team, kênh, SKU, portfolio) đều so với mốc này.
// - Tách "dữ kiện" (con số đo được) khỏi "việc cần kiểm tra" (giả thuyết như mất rank, hết hàng).
// - Thiếu dữ liệu (Ads, đơn hàng) được cảnh báo trước và không đem ra so Profit.

import { summarizeDays, type DashboardDay, type DashboardTotals } from "./dashboard-totals";

export type ReportChannel = "FBA" | "FBM";
/** Mức ưu tiên: high 🔴 / medium 🟡 là vấn đề cần xử lý; good 🟢 là biến động tốt. */
export type Severity = "high" | "medium" | "good";

export interface ChannelSeriesInput {
  label: string;
  storeName: string;
  channel: ReportChannel;
  team: string;
  /** Kênh mới mở (< 30 ngày): không đưa vào ưu tiên. */
  isNew: boolean;
  /** Số liệu từng ngày, gồm ngày báo cáo và 7 ngày trước. */
  days: DashboardDay[];
  /** Chi tiết SKU / portfolio Ads để truy nguyên nhân. */
  drill?: ChannelDrill;
}

/** Units/ngày của 1 SKU: ngày báo cáo và TB 7 ngày. */
export interface SkuMove {
  sku: string;
  today: number;
  avg7: number;
}

/** Chi tiêu Ads/ngày của 1 portfolio: ngày báo cáo và TB 7 ngày. */
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

export type DataIssue = "ads_missing" | "baseline_ads_missing";

export interface ChannelReview {
  severity: Severity;
  /** Dữ kiện có số liệu chứng minh. */
  facts: string[];
  /** Nguyên nhân cần xác minh (giả thuyết, chưa khẳng định): hết hàng, mất Buy Box, giảm rank... */
  checks: string[];
  /** Hành động cụ thể, gắn SKU / portfolio khi có (vd: kiểm tra trước SKU X, giảm bid portfolio 0 đơn). */
  actions: string[];
  /** Điểm xếp hạng ưu tiên. */
  score: number;
}

export interface ChannelAnalysis {
  label: string;
  storeName: string;
  channel: ReportChannel;
  team: string;
  isNew: boolean;
  today: DashboardTotals;
  avg7: DashboardTotals | null;
  dataIssue: DataIssue | null;
  /** Δ Profit so với TB 7 ngày (null khi không so được). */
  profitDelta: number | null;
  review: ChannelReview | null;
}

export interface GroupAnalysis {
  today: DashboardTotals;
  avg7: DashboardTotals | null;
  /** false khi có kênh thiếu dữ liệu: Δ Profit / Margin / TACoS không so được. */
  comparable: boolean;
}

export interface TeamAnalysis extends GroupAnalysis {
  team: string;
  channels: ChannelAnalysis[];
}

export interface DailyReportAnalysis {
  date: string;
  company: GroupAnalysis & { storeCount: number; channelCount: number };
  teams: TeamAnalysis[];
  /** Cảnh báo dữ liệu, hiển thị trước mọi con số. */
  warnings: string[];
  /** Vấn đề cần xử lý, đã xếp hạng (cao nhất trước). */
  priorities: ChannelAnalysis[];
  /** Cơ hội: kênh tăng Profit tốt, kèm SKU / portfolio có thể mở rộng. */
  opportunities: ChannelAnalysis[];
}

const SUM_KEYS = [
  "revenue", "quantity", "orders", "adsFee", "basecost", "amazonFee", "tax",
  "promotion", "returnCost", "profit", "netProfit", "revenueAds", "clicks",
] as const;

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const usd = (value: number) => {
  const text = `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
  return Math.round(value) < 0 ? `-${text}` : text;
};
export const usdSigned = (value: number) => `${value >= 0 ? "+" : "-"}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
const pct1 = (value: number) => `${(value * 100).toFixed(1)}%`;
const num1 = (value: number) => (Math.round(value * 10) / 10).toString();
const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);

function averagePerDay(days: DashboardDay[]): DashboardTotals | null {
  const total = summarizeDays(days);
  if (!total.days) return null;
  const avg = { ...total };
  for (const key of SUM_KEYS) avg[key] = total[key] / total.days;
  avg.serviceCost = total.serviceCost / total.days;
  return avg;
}

/** Số liệu ngày báo cáo và TB/ngày của 7 ngày trước. */
export function compareSeries(days: DashboardDay[], date: string): { today: DashboardTotals; avg7: DashboardTotals | null } {
  return {
    today: summarizeDays(days.filter((d) => d.date === date)),
    avg7: averagePerDay(days.filter((d) => d.date >= shiftIsoDate(date, -7) && d.date < date)),
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

export function dataIssueOf(today: DashboardTotals, avg7: DashboardTotals | null): DataIssue | null {
  if (!avg7) return null;
  if (today.adsFee === 0 && avg7.adsFee >= 20) return "ads_missing";
  if (avg7.adsFee < 1 && today.adsFee >= 20) return "baseline_ads_missing";
  return null;
}

/** SKU tụt units/ngày mạnh nhất (bỏ SKU bán lẻ tẻ để tránh nhiễu). */
function skuDrops(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.avg7 >= 1.5 && s.today <= s.avg7 * 0.5)
    .sort((a, b) => b.avg7 - b.today - (a.avg7 - a.today))
    .slice(0, 2);
}

function skuGains(drill?: ChannelDrill): SkuMove[] {
  return (drill?.skus ?? [])
    .filter((s) => s.today >= 3 && s.today >= s.avg7 * 1.5)
    .sort((a, b) => b.today - b.avg7 - (a.today - a.avg7))
    .slice(0, 2);
}

const skuFact = (s: SkuMove) => `SKU ${shortName(s.sku)} ${num1(s.avg7)} → ${num1(s.today)} units/ngày`;

/**
 * Rà soát 1 kênh so với TB 7 ngày. Δ Profit được tách thành 3 phần để biết phần nào kéo:
 *   doanh số = ΔRevenue × biên trước Ads của TB 7 ngày
 *   biên     = Revenue hôm nay × Δ biên trước Ads (giá, phí, refund, giá vốn)
 *   Ads      = −ΔAds
 * Rồi với mỗi phần kéo, lấy dữ kiện (organic/Ads sales, SKU, portfolio, tỉ lệ phí) và việc cần kiểm tra.
 */
export function reviewChannel(ch: Omit<ChannelAnalysis, "review">, drill?: ChannelDrill): ChannelReview | null {
  const { today: t, avg7: b } = ch;
  if (!b || ch.dataIssue) return null;

  // Không có doanh thu nhưng vẫn tiêu Ads: có thể chưa nạp file đơn hàng hoặc listing ngừng bán
  if (t.revenue <= 0 && b.revenue >= 100) {
    return {
      severity: "high",
      facts: [`Revenue $0 (TB ${usd(b.revenue)}/ngày)`, ...(t.adsFee > 0 ? [`Ads vẫn tiêu ${usd(t.adsFee)}`] : [])],
      checks: ["chưa nạp file đơn hàng", "listing bị ẩn", "hết hàng"],
      actions: ["Xác nhận file đơn hàng đã nạp", ...(t.adsFee > 0 ? ["tạm dừng Ads nếu listing ngừng bán"] : [])],
      score: (Math.max(0, b.profit) + t.adsFee) * 1.5,
    };
  }

  const dProfit = t.profit - b.profit;
  const scale = Math.max(Math.abs(b.profit), 50);
  let severity: Severity | null = null;
  if ((t.profit < 0 && !ch.isNew) || dProfit <= -Math.max(100, 0.4 * scale)) severity = "high";
  else if (dProfit <= -Math.max(50, 0.2 * scale)) severity = "medium";
  else if (dProfit >= Math.max(50, 0.2 * scale)) severity = "good";
  if (!severity) return null;
  const isIssue = severity !== "good";

  const baseRate = b.revenue > 0 ? (b.profit + b.adsFee) / b.revenue : 0;
  const todayRate = t.revenue > 0 ? (t.profit + t.adsFee) / t.revenue : baseRate;
  const parts = [
    { key: "volume", value: (t.revenue - b.revenue) * baseRate },
    { key: "rate", value: t.revenue * (todayRate - baseRate) },
    { key: "ads", value: -(t.adsFee - b.adsFee) },
  ]
    .filter((p) => (isIssue ? p.value <= -15 : p.value >= 15))
    .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
    .slice(0, 2);

  // Dữ kiện gom theo từng phần, rồi xếp xen kẽ để phần nào cũng có mặt khi bị cắt bớt
  const factGroups: string[][] = [];
  const checks: string[] = [];
  const actions: string[] = [];
  let concrete = false;

  for (const part of parts) {
    const facts: string[] = [];
    factGroups.push(facts);
    if (part.key === "volume") {
      const organic = t.revenue - t.revenueAds - (b.revenue - b.revenueAds);
      const adSales = t.revenueAds - b.revenueAds;
      const organicLed = Math.abs(organic) >= Math.abs(adSales);
      const skus = isIssue ? skuDrops(drill) : skuGains(drill);
      if (b.revenueAds > 0) {
        const lead = organicLed ? `Organic ${usdSigned(organic)}` : `Ads Sales ${usdSigned(adSales)}`;
        facts.push(lead);
      } else {
        facts.push(`Revenue ${usdSigned(t.revenue - b.revenue)}`);
      }
      facts.push(...skus.map(skuFact));
      if (!isIssue) {
        if (skus.length) actions.push(`Đảm bảo tồn kho ${skus.map((s) => `SKU ${shortName(s.sku)}`).join(", ")}`);
        continue;
      }
      concrete ||= skus.length > 0;
      if (skus.length) actions.push(`Kiểm tra trước ${skus.map((s) => `SKU ${shortName(s.sku)}`).join(", ")}`);
      // Không có SKU nào tụt hẳn: doanh số giảm rải rác, kiểm tra theo nguồn bị giảm
      else actions.push(organicLed ? "Kiểm tra rank và Buy Box của các SKU chủ lực" : "Kiểm tra ngân sách / bid các campaign chính");
      if (skus.some((s) => s.today === 0)) checks.push("hết hàng", "vấn đề listing");
      checks.push(...(organicLed ? ["mất Buy Box", "giảm rank"] : ["mất Buy Box", "bid / ngân sách quá thấp"]));
    } else if (part.key === "rate") {
      if (!isIssue || t.revenue <= 0 || b.revenue <= 0) continue;
      const rise = [
        { label: "Refund", cost: (x: DashboardTotals) => x.returnCost, suspect: "lỗi sản phẩm / mô tả sai", action: "Xem lý do trả hàng" },
        { label: "Phí AMZ", cost: (x: DashboardTotals) => x.amazonFee, suspect: "đổi size tier / phí lưu kho", action: "Đối soát phí FBA" },
        { label: "Promotion", cost: (x: DashboardTotals) => x.promotion, suspect: "coupon / promotion chồng nhau", action: "Rà coupon / promotion đang chạy" },
        { label: "Giá vốn", cost: (x: DashboardTotals) => x.basecost, suspect: "giảm giá bán / bán nhiều SKU biên thấp", action: "Kiểm tra giá bán" },
      ]
        .map((c) => ({ ...c, from: c.cost(b) / b.revenue, to: c.cost(t) / t.revenue }))
        .sort((x, y) => y.to - y.from - (x.to - x.from))[0];
      if (rise && rise.to - rise.from >= 0.02) {
        facts.push(`${rise.label} ${pct1(rise.from)} → ${pct1(rise.to)} doanh thu`);
        checks.push(rise.suspect);
        actions.push(rise.action);
      }
    } else if (part.key === "ads") {
      facts.push(`Ads ${usd(b.adsFee)} → ${usd(t.adsFee)}/ngày`);
      if (t.revenue > 0 && b.revenue > 0) facts.push(`TACoS ${pct1(b.tacos)} → ${pct1(t.tacos)}`);
      const portfolios = drill?.portfolios ?? [];
      if (!isIssue) {
        // Cơ hội: portfolio ra đơn đều với ACoS thấp hơn hẳn mức chung của kênh
        const channelAcos = t.revenueAds > 0 ? t.adsFee / t.revenueAds : 0;
        const efficient = portfolios
          .filter((p) => p.todayOrders >= 3 && p.todaySpend >= 10 && p.todaySales > 0 && channelAcos > 0 && p.todaySpend / p.todaySales <= channelAcos * 0.7)
          .sort((x, y) => y.todayOrders - x.todayOrders)[0];
        if (efficient) {
          actions.push(`Cân nhắc tăng ngân sách ${shortName(efficient.name)} (ACoS ${Math.round((efficient.todaySpend / efficient.todaySales) * 100)}%, ${efficient.todayOrders} đơn)`);
        } else if (t.revenue >= b.revenue * 0.9) {
          // Giảm chi Ads mà doanh số gần như giữ nguyên: mức chi mới đang hiệu quả hơn
          actions.push("Giữ mức chi Ads hiện tại, theo dõi doanh số 2–3 ngày");
        }
        continue;
      }
      const burning = portfolios
        .filter((p) => p.todaySpend >= 15 && p.todayOrders === 0)
        .sort((x, y) => y.todaySpend - x.todaySpend)
        .slice(0, 2);
      checks.push("bid quá cao", "search term không liên quan");
      if (burning.length) {
        concrete = true;
        facts.push(`${burning.length} portfolio tiêu tiền 0 đơn`);
        actions.push(`Giảm bid / tắt ${burning.map((p) => `${shortName(p.name)} (${usd(p.todaySpend)}, 0 đơn)`).join(", ")}`);
      } else {
        const spike = portfolios
          .filter((p) => p.todaySpend - p.avg7Spend >= 15)
          .sort((x, y) => y.todaySpend - y.avg7Spend - (x.todaySpend - x.avg7Spend))[0];
        if (spike) {
          concrete = true;
          facts.push(`${shortName(spike.name)} ${usd(spike.avg7Spend)} → ${usd(spike.todaySpend)}/ngày`);
          actions.push(`Rà search term ${shortName(spike.name)}`);
        } else {
          actions.push("Rà search term ACoS cao");
        }
      }
    }
  }

  const facts: string[] = [];
  for (let i = 0; factGroups.some((g) => g[i]); i++) for (const group of factGroups) if (group[i]) facts.push(group[i]);

  // Ưu tiên = $ Profit bị ảnh hưởng × mức bất thường × khả năng can thiệp (có SKU/portfolio cụ thể)
  const impact = Math.max(0, -dProfit) + Math.max(0, -t.profit);
  const anomaly = Math.min(2, Math.abs(dProfit) / scale);
  return {
    severity,
    facts: [...new Set(facts)],
    checks: [...new Set(checks)].slice(0, 4),
    actions: [...new Set(actions)].slice(0, 2),
    score: isIssue ? impact * (0.5 + anomaly / 2) * (concrete ? 1 : 0.7) : dProfit,
  };
}

function groupOf(inputs: ChannelSeriesInput[], channels: ChannelAnalysis[], date: string): GroupAnalysis {
  return {
    ...compareSeries(sumSeries(inputs.map((i) => i.days)), date),
    comparable: channels.every((c) => !c.dataIssue),
  };
}

const DATA_WARNING: Record<DataIssue, (c: ChannelAnalysis) => string> = {
  ads_missing: (c) => `${c.label}: chưa có số Ads ngày này (TB ${usd(c.avg7?.adsFee ?? 0)}/ngày) — Profit, TACoS chưa chính xác`,
  baseline_ads_missing: (c) => `${c.label}: 7 ngày trước chưa có số Ads — chưa so được Profit`,
};

/** Số vấn đề tối đa ở bản gửi tự động (luôn hiện hết vấn đề 🔴, tối đa 5). */
const MAX_PRIORITIES = 5;
const MIN_PRIORITIES = 3;

export function analyzeDailyReport(date: string, inputs: ChannelSeriesInput[]): DailyReportAnalysis {
  const channels: ChannelAnalysis[] = inputs.map((input) => {
    const { today, avg7 } = compareSeries(input.days, date);
    const dataIssue = dataIssueOf(today, avg7);
    const ch: ChannelAnalysis = {
      label: input.label,
      storeName: input.storeName,
      channel: input.channel,
      team: input.team,
      isNew: input.isNew,
      today,
      avg7,
      dataIssue,
      profitDelta: avg7 && !dataIssue ? today.profit - avg7.profit : null,
      review: null,
    };
    ch.review = reviewChannel(ch, input.drill);
    return ch;
  });

  const teamNames = [...new Set(inputs.map((i) => i.team))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const teams: TeamAnalysis[] = teamNames.map((team) => {
    const members = channels
      .filter((c) => c.team === team)
      .sort((a, b) => Number(a.isNew) - Number(b.isNew) || b.today.revenue - a.today.revenue);
    return { team, ...groupOf(inputs.filter((i) => i.team === team), members, date), channels: members };
  });

  const issues = channels
    .filter((c) => !c.isNew && c.review && c.review.severity !== "good")
    .sort((x, y) => (y.review?.score ?? 0) - (x.review?.score ?? 0));
  const highCount = issues.filter((c) => c.review?.severity === "high").length;
  const priorities = issues.slice(0, Math.min(MAX_PRIORITIES, Math.max(MIN_PRIORITIES, highCount)));

  return {
    date,
    company: {
      ...groupOf(inputs, channels, date),
      storeCount: new Set(inputs.map((i) => i.storeName)).size,
      channelCount: channels.length,
    },
    teams,
    warnings: channels.filter((c) => c.dataIssue).map((c) => DATA_WARNING[c.dataIssue as DataIssue](c)),
    priorities,
    opportunities: channels
      .filter((c) => c.review?.severity === "good")
      .sort((x, y) => (y.profitDelta ?? 0) - (x.profitDelta ?? 0))
      .slice(0, 3),
  };
}
