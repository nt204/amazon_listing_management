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
  /** Việc cần làm, bắt đầu bằng động từ ("Dừng Ads", "Giảm bid"...). */
  title: string;
  /** Lý do ngắn kèm con số. */
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

function buildActions(channels: ChannelAnalysis[]): ActionItem[] {
  const actions: ActionItem[] = [];
  const usd = (value: number) => `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  for (const ch of channels) {
    if (ch.isNew) continue;
    const { today, avg7 } = ch;
    // Mỗi kênh chỉ giữ 1 việc quan trọng nhất; tổng $ ảnh hưởng dùng để xếp hạng giữa các kênh
    const issues: Array<{ impact: number; title: string; reason: string }> = [];

    if (ch.adsMissing && avg7) {
      issues.push({ impact: avg7.adsFee, title: "Nạp file Ads", reason: `Ads đang $0 (TB ${usd(avg7.adsFee)}/ngày), Profit bị cao ảo` });
    } else {
      if (ch.baselineAdsMissing) {
        issues.push({ impact: today.adsFee, title: "Nạp bù file Ads", reason: "7 ngày trước thiếu Ads, chưa so được Profit" });
      }
      if (today.profit < 0) {
        const impact = Math.abs(today.profit) + 50;
        if (today.revenue <= 0) issues.push({ impact, title: "Dừng Ads", reason: `$0 doanh thu nhưng tiêu ${usd(today.adsFee)}` });
        else if (today.tacos >= 0.3) issues.push({ impact, title: "Giảm bid", reason: `lỗ ${usd(today.profit)}, TACoS ${pct(today.tacos)}` });
        else issues.push({ impact, title: "Soát giá vốn, phí", reason: `lỗ ${usd(today.profit)}` });
      }
      // Kênh lỗ đã có việc "Giảm bid"/"Dừng Ads" ở trên, không tính trùng
      if (avg7 && !ch.baselineAdsMissing && today.profit >= 0 && today.revenue > 0 && today.adsFee >= 30 && avg7.adsFee >= 20 && avg7.tacos > 0) {
        const excess = today.adsFee - today.revenue * avg7.tacos;
        if (today.tacos - avg7.tacos >= LIGHT_RULES.yellowTacosRise && excess >= 20) {
          issues.push({ impact: excess, title: "Rà bid", reason: `Ads vượt ~${usd(excess)}, TACoS ${pct(today.tacos)} (TB ${pct(avg7.tacos)})` });
        }
      }
      if (avg7 && avg7.revenue >= 200 && today.revenue <= avg7.revenue * 0.7) {
        const drop = avg7.revenue - today.revenue;
        issues.push({
          impact: drop * Math.max(avg7.margin, 0.1),
          title: "Kiểm tra tồn kho, Buy Box",
          reason: `Revenue -${Math.round((drop / avg7.revenue) * 100)}% (TB ${usd(avg7.revenue)})`,
        });
      }
      if (avg7 && today.returnCost >= 50 && today.returnCost >= avg7.returnCost * 2) {
        issues.push({ impact: today.returnCost - avg7.returnCost, title: "Xem lý do trả hàng", reason: `Refund ${usd(today.returnCost)} (TB ${usd(avg7.returnCost)})` });
      }
    }

    if (!issues.length) continue;
    const top = issues.reduce((best, issue) => (issue.impact > best.impact ? issue : best));
    actions.push({
      team: ch.team,
      label: ch.label,
      title: top.title,
      reason: top.reason,
      impact: issues.reduce((sum, issue) => sum + issue.impact, 0),
    });
  }
  return actions.sort((a, b) => b.impact - a.impact).slice(0, 4);
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
    };
  });

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
    actions: buildActions(channels),
  };
}
