// Phân tích 1 kênh theo yêu cầu ("phân tích Warmstorey"): nguyên nhân Δ Profit so với hôm qua và action.
// Báo cáo ngày chỉ hiện số liệu; phần này chỉ chạy khi có người hỏi.
//
// Phạm vi so sánh: chỉ các kênh có số hợp lệ ở CẢ hôm nay và hôm qua. Kênh thiếu số Ads 1 trong 2 ngày
// (Ads = 0 trong khi TB 7 ngày có chi) bị loại — không coi Ads = 0.
//
// Phân rã Δ Profit so với hôm qua (đủ, cộng lại đúng bằng Δ Profit):
//   Profit = Revenue × biên trước Ads − Ads
//   doanh số = ΔRevenue × biên trước Ads hôm qua
//   chi Ads  = −ΔAds
//   biên     = phần còn lại = Revenue hôm nay × Δ biên trước Ads (giá vốn, phí Amazon, refund, promotion, thuế)
//
// Mỗi mục tách 3 tầng: Số liệu (sự thật, khẳng định) → Phân rã (tính toán) → Cần kiểm tra (giả thuyết) → Action.
// ACoS cao hơn BE ACoS, hay target ≥ 15 click không ra đơn, chỉ là tiêu chí đưa vào danh sách rà soát,
// không phải điều kiện tự giảm bid / negative.

import type { DashboardTotals } from "./dashboard-totals";
import { usd, type ChannelDrill, type ChannelSeriesInput, type PortfolioStat } from "./daily-report-analysis";
import { displayDate } from "./daily-report-card";
import { buildRow, type Row } from "./daily-report-image";

/** Số click tối thiểu để đưa 1 target vào danh sách rà soát. */
const REVIEW_CLICKS = 15;
/** TB chi Ads/ngày tối thiểu để coi Ads = 0 là thiếu số chứ không phải tắt quảng cáo. */
const ADS_GAP_MIN = 20;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const signedUsd = (v: number) => `${Math.round(v) >= 0 ? "+" : "-"}${usd(Math.abs(v))}`;
export const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const signedPts = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}đ`;
const short = (name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name);
const num1 = (v: number) => (Math.round(v * 10) / 10).toString();
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const grey = (text: string) => `<font color='grey'>${text}</font>`;

/** Biên trước Ads = (Profit + Ads) / Revenue; cũng là BE ACoS (ACoS mà quảng cáo hòa vốn). */
const preAdRate = (t: DashboardTotals) => (t.revenue > 0 ? (t.profit + t.adsFee) / t.revenue : 0);

/** Ads = 0 trong khi TB 7 ngày có chi: coi là thiếu số Ads. */
const adsGap = (t: DashboardTotals, avg7: DashboardTotals | null) => Boolean(avg7 && avg7.adsFee >= ADS_GAP_MIN && t.adsFee === 0);

export interface ChannelRow {
  input: ChannelSeriesInput;
  row: Row;
}

/** Chia kênh thành: so được (đủ số cả hôm nay lẫn hôm qua) và bị loại (kèm lý do). */
export function comparableRows(inputs: ChannelSeriesInput[], date: string): { comparable: ChannelRow[]; excluded: string[] } {
  const excluded: string[] = [];
  const comparable = inputs
    .map((input) => ({ input, row: buildRow(input.label, input.isNew, input.days, date) }))
    .filter(({ input, row }) => {
      const reason = row.missingSince
        ? `chưa có số ngày này (số gần nhất ${displayDate(row.missingSince)})`
        : !row.yesterday
          ? "không có số hôm qua"
          : adsGap(row.today, row.avg7)
            ? "chưa có số Ads ngày này"
            : adsGap(row.yesterday, row.avg7)
              ? "hôm qua chưa có số Ads"
              : null;
      if (reason) excluded.push(`${input.label}: ${reason}`);
      return !reason;
    });
  return { comparable, excluded };
}

type CauseKey = "volume" | "rate" | "ads";
type Decomposition = Record<CauseKey, number>;

/** Phân rã Δ Profit, làm tròn sao cho 3 phần cộng lại đúng bằng Δ Profit đã làm tròn. */
function decompose(t: DashboardTotals, y: DashboardTotals): Decomposition {
  const volume = Math.round((t.revenue - y.revenue) * preAdRate(y));
  const ads = Math.round(-(t.adsFee - y.adsFee));
  return { volume, ads, rate: Math.round(t.profit - y.profit) - volume - ads };
}

export interface Mover {
  label: string;
  storeName: string;
  team: string;
  isNew: boolean;
  row: Row;
  today: DashboardTotals;
  yesterday: DashboardTotals;
  /** Δ Profit so với hôm qua. */
  delta: number;
  parts: Decomposition;
  drill?: ChannelDrill;
}

export function toMover({ input, row }: ChannelRow): Mover {
  return {
    label: input.label,
    storeName: input.storeName,
    team: input.team,
    isNew: input.isNew,
    row,
    today: row.today,
    yesterday: row.yesterday!,
    delta: row.today.profit - row.yesterday!.profit,
    parts: decompose(row.today, row.yesterday!),
    drill: input.drill,
  };
}

/** Δ Profit đủ lớn để nêu: ≥ $30 và ≥ 15% Profit hôm qua. */
export const significant = (m: Mover) => Math.abs(m.delta) >= Math.max(30, 0.15 * Math.abs(m.yesterday.profit));

const COSTS = [
  { label: "Giá vốn", cost: (x: DashboardTotals) => x.basecost, check: "giá bán giảm / bán nhiều SKU biên thấp", action: "Kiểm tra giá bán và cơ cấu SKU" },
  { label: "Phí Amazon", cost: (x: DashboardTotals) => x.amazonFee, check: "đổi size tier / phí lưu kho", action: "Đối soát phí FBA" },
  { label: "Refund", cost: (x: DashboardTotals) => x.returnCost, check: "lỗi sản phẩm / mô tả sai", action: "Xem lý do trả hàng theo SKU" },
  { label: "Promotion", cost: (x: DashboardTotals) => x.promotion, check: "coupon / promotion chồng nhau", action: "Rà coupon / promotion đang chạy" },
];

/** Khoản chi phí thay đổi tỉ trọng doanh thu nhiều nhất theo chiều `sign` (+1 tăng, −1 giảm). */
function costShift(t: DashboardTotals, y: DashboardTotals, sign: 1 | -1) {
  if (t.revenue <= 0 || y.revenue <= 0) return null;
  const top = COSTS
    .map((c) => ({ ...c, from: c.cost(y) / y.revenue, to: c.cost(t) / t.revenue }))
    .sort((p, q) => sign * (q.to - q.from) - sign * (p.to - p.from))[0];
  return top && sign * (top.to - top.from) >= 0.02 ? top : null;
}

/** Phần chiếm tỉ trọng lớn nhất theo cùng chiều với Δ Profit. */
function mainCause(m: Mover): CauseKey | null {
  const sign = Math.sign(m.delta) || -1;
  const keys = (["volume", "rate", "ads"] as const).filter((k) => sign * m.parts[k] >= 15);
  return keys.sort((p, q) => sign * m.parts[q] - sign * m.parts[p])[0] ?? null;
}

const adsSalesDrop = (p: PortfolioStat) => (p.yesterday?.sales ?? 0) - p.todaySales;
const rate = (num: number, den: number) => (den > 0 ? num / den : 0);

/** Phễu quảng cáo của 1 portfolio hôm qua → hôm nay; khâu tụt mạnh nhất quyết định giả thuyết. */
function funnel(p: PortfolioStat) {
  const y = p.yesterday!;
  const ti = p.todayImpressions ?? 0;
  const tc = p.todayClicks ?? 0;
  const fact = `${short(p.name)}: Ads Sales ${usd(y.sales)} → ${usd(p.todaySales)} · impressions ${int(y.impressions)} → ${int(ti)}`
    + ` · clicks ${int(y.clicks)} → ${int(tc)} · CVR ${pct(rate(y.orders, y.clicks))} → ${pct(rate(p.todayOrders, tc))}`;
  const ratio = (now: number, before: number) => (before > 0 ? now / before : 1);
  const stage = [
    { name: `impressions ${int(y.impressions)} → ${int(ti)}`, ratio: ratio(ti, y.impressions), check: "ngân sách hết sớm, bid bị hạ, mất vị trí hiển thị" },
    { name: `CTR ${pct(rate(y.clicks, y.impressions))} → ${pct(rate(tc, ti))}`, ratio: ratio(rate(tc, ti), rate(y.clicks, y.impressions)), check: "giá, ảnh chính, rating, đối thủ" },
    { name: `CVR ${pct(rate(y.orders, y.clicks))} → ${pct(rate(p.todayOrders, tc))}`, ratio: ratio(rate(p.todayOrders, tc), rate(y.orders, y.clicks)), check: "Buy Box, giá, listing, tồn kho" },
  ].sort((a, b) => a.ratio - b.ratio)[0];
  return stage.ratio < 0.85
    ? { fact, check: `(${stage.name}) ${stage.check}`, targets: stage.check }
    : { fact, check: "ngân sách, bid, Buy Box, giá", targets: "Buy Box, giá, listing" };
}

interface Finding {
  facts: string[];
  checks: string[];
  action: string;
  kind?: string;
}

/** Số liệu → giả thuyết → action cho kênh giảm Profit, theo phần kéo giảm lớn nhất. */
function riskFinding(m: Mover): Finding {
  const t = m.today;
  const y = m.yesterday;
  const portfolios = (m.drill?.portfolios ?? []).filter((p) => p.yesterday);
  const cause = mainCause(m) ?? "ads";

  if (cause === "volume") {
    const organic = t.revenue - t.revenueAds - (y.revenue - y.revenueAds);
    const adSales = t.revenueAds - y.revenueAds;
    const facts = [`Organic ${signedUsd(organic)} · Ads Sales ${signedUsd(adSales)}`];
    if (Math.abs(adSales) > Math.abs(organic)) {
      const p = portfolios.filter((x) => adsSalesDrop(x) >= 20).sort((a, b) => adsSalesDrop(b) - adsSalesDrop(a))[0];
      if (!p) {
        return {
          facts,
          checks: ["ngân sách", "bid", "Buy Box", "giá"],
          action: "Kiểm tra impressions, clicks, CVR của các campaign giảm Ads Sales mạnh nhất; sau đó kiểm tra Buy Box, giá, listing nếu có dấu hiệu",
        };
      }
      const f = funnel(p);
      return {
        facts: [...facts, f.fact],
        checks: [f.check],
        action: `Kiểm tra impressions, clicks, CVR của portfolio ${short(p.name)} (giảm Ads Sales mạnh nhất); sau đó kiểm tra ${f.targets} nếu có dấu hiệu`,
      };
    }
    const sku = (m.drill?.skus ?? [])
      .filter((s) => s.avg7 >= 1.5 && s.today <= s.avg7 * 0.5)
      .sort((a, b) => b.avg7 - b.today - (a.avg7 - a.today))[0];
    if (sku) facts.push(`SKU ${short(sku.sku)} ${num1(sku.avg7)} → ${num1(sku.today)} units/ngày (so TB 7 ngày)`);
    return {
      facts,
      checks: sku?.today === 0 ? ["hết hàng", "listing bị ẩn", "mất Buy Box"] : ["mất Buy Box", "giảm rank organic", "đối thủ giảm giá"],
      action: `Kiểm tra ${sku ? `SKU ${short(sku.sku)}` : "các SKU chủ lực"}: tồn kho, Buy Box, rank organic; xử lý vấn đề listing / tồn kho trước khi chỉnh Ads`,
    };
  }

  if (cause === "rate") {
    const rise = costShift(t, y, 1);
    return rise
      ? { facts: [`${rise.label} ${pct(rise.from)} → ${pct(rise.to)} doanh thu`], checks: [rise.check], action: rise.action }
      : { facts: [`Biên trước Ads ${pct(preAdRate(y))} → ${pct(preAdRate(t))}`], checks: ["giá bán", "phí", "refund"], action: "Đối chiếu giá bán, phí và refund theo SKU trong ngày" };
  }

  // Chi Ads tăng
  const spendUp = (x: PortfolioStat) => x.todaySpend - (x.yesterday?.spend ?? 0);
  const p = portfolios.filter((x) => spendUp(x) >= 10).sort((a, b) => spendUp(b) - spendUp(a))[0];
  const facts = [`Ads ${usd(y.adsFee)} → ${usd(t.adsFee)}`];
  if (p) facts.push(`${short(p.name)}: spend ${usd(p.yesterday!.spend)} → ${usd(p.todaySpend)} · clicks ${int(p.todayClicks ?? 0)} · ${int(p.todayOrders)} đơn`);
  return {
    facts,
    checks: ["bid / ngân sách vừa tăng", "search term không liên quan"],
    action: `Rà search term ${p ? `portfolio ${short(p.name)}` : "các campaign tăng chi mạnh nhất"}: đưa target ≥ ${REVIEW_CLICKS} click không ra đơn vào danh sách rà soát; quyết định bid / negative sau khi xem xu hướng 3–7 ngày`,
  };
}

/** Kênh tăng Profit: phân biệt tăng trưởng doanh số với tiết kiệm chi phí / cải thiện biên. */
function positiveFinding(m: Mover): Finding {
  const t = m.today;
  const y = m.yesterday;
  const cause = mainCause(m) ?? "volume";
  if (cause === "volume") {
    const sku = (m.drill?.skus ?? [])
      .filter((s) => s.today >= 3 && s.today >= s.avg7 * 1.5)
      .sort((a, b) => b.today - b.avg7 - (a.today - a.avg7))[0];
    const facts = [`Orders ${int(y.orders)} → ${int(t.orders)}`];
    if (sku) facts.push(`SKU ${short(sku.sku)} ${num1(sku.avg7)} → ${num1(sku.today)} units/ngày (so TB 7 ngày)`);
    const roomForAds = t.revenueAds > 0 && t.acos < preAdRate(t);
    return {
      kind: "tăng trưởng",
      facts,
      checks: [],
      action: `${sku ? `Đảm bảo tồn kho SKU ${short(sku.sku)}` : "Kiểm tra tồn kho SKU bán chạy"} để duy trì đà tăng${roomForAds ? `; ACoS ${pct(t.acos)} dưới BE ${pct(preAdRate(t))} nên có dư địa mở rộng Ads` : ""}`,
    };
  }
  if (cause === "ads") {
    return {
      kind: "tiết kiệm chi phí",
      facts: [`Ads ${usd(y.adsFee)} → ${usd(t.adsFee)} · Orders ${int(y.orders)} → ${int(t.orders)}`],
      checks: [],
      action: "Theo dõi Revenue, Orders, Profit 2–3 ngày để xác nhận giảm chi Ads giữ được lợi nhuận mà không làm giảm doanh số thêm",
    };
  }
  const drop = costShift(t, y, -1);
  return {
    kind: "cải thiện biên",
    facts: [drop ? `${drop.label} ${pct(drop.from)} → ${pct(drop.to)} doanh thu` : `Biên trước Ads ${pct(preAdRate(y))} → ${pct(preAdRate(t))}`],
    checks: [],
    action: "Xác nhận nguyên nhân (giá bán / phí / refund theo ngày ghi nhận) trước khi coi là cải thiện bền vững",
  };
}

const PART_LABEL: Record<CauseKey, string> = { volume: "doanh số", rate: "biên", ads: "chi Ads" };

/** Khối phân tích 1 kênh (markdown Lark). */
export function diagnosisBlock(m: Mover, lead?: string): string {
  const t = m.today;
  const y = m.yesterday;
  const f = m.delta < 0 || t.profit < 0 ? riskFinding(m) : positiveFinding(m);
  const status = [`Profit ${usd(y.profit)} → ${usd(t.profit)}`];
  if (m.row.fallingDays >= 2) {
    status.push(`giảm ${m.row.fallingDays} ngày liên tiếp (${m.row.trend.slice(-(m.row.fallingDays + 1)).map((v) => usd(v)).join(" → ")})`);
  }
  if (y.revenue >= 50) status.push(`Revenue ${signedPct((t.revenue - y.revenue) / y.revenue)}`);
  if (t.revenue > 0 && y.revenue > 0) status.push(`TACoS ${signedPts(t.tacos - y.tacos)}`);
  if (t.revenueAds > 0) status.push(`ACoS ${pct(t.acos)} (BE ${pct(preAdRate(t))})`);
  const parts = (["volume", "rate", "ads"] as const)
    .filter((k) => m.parts[k] !== 0)
    .sort((p, q) => Math.abs(m.parts[q]) - Math.abs(m.parts[p]))
    .map((k) => `${PART_LABEL[k]} ${signedUsd(m.parts[k])}`);
  return [
    `**${m.label}**${lead ? ` · ${lead}` : ""}${m.isNew ? " 🌱" : ""}${f.kind ? ` ${grey(`(${f.kind})`)}` : ""}  **Δ Profit ${signedUsd(m.delta)}**`,
    `**Số liệu:** ${status.join(" · ")}`,
    ...f.facts.map((x) => grey(x)),
    `**Phân rã:** ${parts.join(" · ")} = Δ ${signedUsd(m.delta)}`,
    ...(f.checks.length ? [`**Cần kiểm tra:** ${f.checks.join(", ")}`] : []),
    `→ ${f.action}`,
  ].join("\n");
}

/** 1 dòng cảnh báo cho báo cáo ngày: store kéo giảm Profit so với hôm qua, phần kéo chính và action. */
export function storeAlert(m: Mover, lead?: string): string {
  const f = riskFinding(m);
  const cause = mainCause(m);
  const emoji = m.today.profit < 0 ? "🔴" : "🟠";
  return `${emoji} **${m.label}** (${m.team}${lead ? ` · ${lead}` : ""}): Profit ${usd(m.yesterday.profit)} → ${usd(m.today.profit)} (${signedUsd(m.delta)})`
    + `${cause ? `, chủ yếu do ${PART_LABEL[cause]} ${signedUsd(m.parts[cause])}` : ""} → ${f.action}.`;
}

/** Store giảm Profit đáng kể so với hôm qua (hoặc đang lỗ), giảm mạnh nhất trước. */
export function fallingMovers(inputs: ChannelSeriesInput[], date: string): Mover[] {
  return comparableRows(inputs, date).comparable
    .map(toMover)
    .filter((m) => (m.delta < 0 && significant(m)) || m.today.profit < 0)
    .sort((a, b) => a.delta - b.delta);
}
