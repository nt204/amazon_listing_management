// Dựng card Lark (schema 2.0) + bản text dự phòng cho báo cáo kinh doanh ngày (thuần).

import type { DashboardTotals } from "./dashboard-totals";
import {
  LIGHT_RULES,
  type ChannelAnalysis,
  type DailyReportAnalysis,
  type Light,
  type TeamAnalysis,
} from "./daily-report-analysis";

export interface DailyReportCardOptions {
  /** Tên trưởng team theo mã team ("FBA 1" -> "Quỳnh"). */
  teamLeads?: Record<string, string>;
  /** Nhận xét từng team (AI viết); team nào thiếu thì dùng bản do code soạn. */
  teamComments?: Record<string, string>;
}

const LIGHT_EMOJI: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const LIGHT_TEMPLATE: Record<Light, string> = { green: "green", yellow: "orange", red: "red" };
const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

export function formatUsd(value: number): string {
  const rounded = Math.round(value);
  const text = `$${Math.abs(rounded).toLocaleString("en-US")}`;
  return rounded < 0 ? `-${text}` : text;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function colored(text: string, good: boolean | null): string {
  if (good === null) return `<font color='grey'>${text}</font>`;
  return `<font color='${good ? "green" : "red"}'>${text}</font>`;
}

/** % thay đổi; ẩn khi mốc so sánh quá nhỏ hoặc âm (tránh kiểu -417%). */
function deltaPct(current: number, base: number | undefined, higherIsBetter = true, minBase = 1): string {
  if (base == null || base < minBase) return "";
  const change = (current - base) / base;
  const text = `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
  if (Math.abs(change) < 0.02) return colored(text, null);
  return colored(text, change > 0 === higherIsBetter);
}

function deltaUsd(current: number, base: number | undefined): string {
  if (base == null) return "";
  const diff = current - base;
  const text = `${diff >= 0 ? "+" : "-"}$${Math.abs(Math.round(diff)).toLocaleString("en-US")}`;
  if (Math.abs(diff) < 5) return colored(text, null);
  return colored(text, diff > 0);
}

/** Mẫu số tối thiểu ($) để tỉ lệ (margin, ACoS, TACoS) có ý nghĩa khi so sánh. */
const MIN_RATIO_BASE = 50;

/** Chênh lệch điểm % (margin, ACoS, TACoS); bỏ qua khi mẫu số hôm nay hoặc mốc quá nhỏ. */
function deltaPts(current: number, base: number | undefined, higherIsBetter: boolean, denominators?: [number, number | undefined]): string {
  if (base == null) return "";
  if (denominators && (denominators[0] < MIN_RATIO_BASE || (denominators[1] ?? 0) < MIN_RATIO_BASE)) return "";
  const diff = (current - base) * 100;
  const text = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}đ`;
  if (Math.abs(diff) < 0.5) return colored(text, null);
  return colored(text, diff > 0 === higherIsBetter);
}

export function teamLabel(team: string, leads?: Record<string, string>): string {
  const lead = leads?.[team]?.trim();
  return lead ? `${team} · ${lead}` : team;
}

export function displayDate(date: string): string {
  const [y, m, d] = date.split("-");
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${d}/${m}/${y}`;
}

type MetricRow = {
  name: string;
  /** Chỉ số phụ thuộc chi phí Ads: không so khi có kênh thiếu số Ads. */
  usesAds?: boolean;
  value: (t: DashboardTotals) => string;
  delta: (cur: DashboardTotals, base: DashboardTotals | null) => string;
};

const COMPANY_ROWS: MetricRow[] = [
  { name: "Revenue", value: (t) => formatUsd(t.revenue), delta: (c, b) => deltaPct(c.revenue, b?.revenue) },
  { name: "Profit", usesAds: true, value: (t) => formatUsd(t.profit), delta: (c, b) => (b ? `${deltaUsd(c.profit, b.profit)} ${deltaPct(c.profit, b.profit, true, 50)}`.trim() : "") },
  { name: "Margin", usesAds: true, value: (t) => pct(t.margin), delta: (c, b) => deltaPts(c.margin, b?.margin, true, [c.revenue, b?.revenue]) },
  { name: "Units", value: (t) => Math.round(t.quantity).toLocaleString("en-US"), delta: (c, b) => deltaPct(c.quantity, b?.quantity) },
  { name: "TACoS", usesAds: true, value: (t) => pct(t.tacos), delta: (c, b) => deltaPts(c.tacos, b?.tacos, false, [c.revenue, b?.revenue]) },
  { name: "ACoS", usesAds: true, value: (t) => pct(t.acos), delta: (c, b) => deltaPts(c.acos, b?.acos, false, [c.revenueAds, b?.revenueAds]) },
];

function companyDelta(a: DailyReportAnalysis, row: MetricRow, base: DashboardTotals | null): string {
  if (row.usesAds && a.company.unreliable.length) return "<font color='grey'>n/a</font>";
  return row.delta(a.company.today, base) || "—";
}

function companyTable(a: DailyReportAnalysis): Record<string, unknown> {
  const { today, lastWeek, avg7, monthAvg } = a.company;
  return {
    tag: "table",
    page_size: COMPANY_ROWS.length,
    row_height: "low",
    freeze_first_column: true,
    header_style: { text_align: "left", text_size: "normal", background_style: "grey", bold: true, lines: 1 },
    columns: [
      { name: "metric", display_name: "Chỉ số", data_type: "lark_md", horizontal_align: "left", width: "auto" },
      { name: "today", display_name: "Hôm nay", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "avg7", display_name: "vs TB 7 ngày", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "lastWeek", display_name: "vs cùng thứ tuần trước", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "month", display_name: "TB tháng/ngày", data_type: "lark_md", horizontal_align: "right", width: "auto" },
    ],
    rows: COMPANY_ROWS.map((row) => ({
      metric: `**${row.name}**`,
      today: `**${row.value(today)}**`,
      avg7: companyDelta(a, row, avg7),
      lastWeek: companyDelta(a, row, lastWeek),
      month: monthAvg ? row.value(monthAvg) : "—",
    })),
  };
}

function channelBlock(ch: ChannelAnalysis): string {
  const { today: t, avg7: b } = ch;
  const badge = ch.adsMissing
    ? " · <font color='orange'>thiếu số Ads</font>"
    : ch.baselineAdsMissing
      ? " · <font color='orange'>7 ngày trước thiếu số Ads</font>"
      : "";
  const head = `${ch.isNew ? "🌱" : LIGHT_EMOJI[ch.light]} **${ch.label}**${badge}`;
  // Mốc so sánh thiếu Ads thì profit TB 7 ngày bị thổi phồng: không so profit
  const profitBase = ch.baselineAdsMissing ? undefined : b?.profit;
  const lines = [
    `Revenue ${formatUsd(t.revenue)} ${deltaPct(t.revenue, b?.revenue)} · Units ${Math.round(t.quantity)} ${deltaPct(t.quantity, b?.quantity)}`,
    `Profit **${formatUsd(t.profit)}** ${deltaUsd(t.profit, profitBase)} · Margin ${t.revenue > 0 ? pct(t.margin) : "—"} ${deltaPts(t.margin, ch.baselineAdsMissing ? undefined : b?.margin, true, [t.revenue, b?.revenue])}`,
    `ACoS ${t.revenueAds > 0 ? pct(t.acos) : "—"} ${ch.baselineAdsMissing ? "" : deltaPts(t.acos, b?.acos, false, [t.revenueAds, b?.revenueAds])} · TACoS ${t.revenue > 0 ? pct(t.tacos) : "—"} ${ch.baselineAdsMissing ? "" : deltaPts(t.tacos, b?.tacos, false, [t.revenue, b?.revenue])}`,
  ];
  return [head, ...lines.map((line) => line.replace(/\s+/g, " ").trim())].join("\n");
}

/** Nhận xét team do code soạn — dùng khi AI tắt hoặc lỗi. */
export function defaultTeamComment(team: TeamAnalysis): string {
  const { today, avg7, monthAvg } = team;
  const parts = [`Profit ${formatUsd(today.profit)}`];
  if (avg7 && !team.unreliable.length) parts.push(`${deltaUsd(today.profit, avg7.profit)} so với TB 7 ngày`);
  if (monthAvg) parts.push(`TB tháng ${formatUsd(monthAvg.profit)}/ngày`);
  const sentences = [`${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join("; ")})` : ""}.`];

  const moves = team.channels
    .filter((c) => c.avg7 && !c.isNew && !c.adsMissing && !c.baselineAdsMissing)
    .map((c) => ({ label: c.label, delta: c.today.profit - (c.avg7?.profit ?? 0) }))
    .filter((m) => Math.abs(m.delta) >= 30);
  const down = moves.filter((m) => m.delta < 0).sort((x, y) => x.delta - y.delta);
  const up = moves.filter((m) => m.delta > 0).sort((x, y) => y.delta - x.delta);
  if (down.length) sentences.push(`Kéo giảm: ${down.map((m) => `${m.label} ${deltaUsd(m.delta, 0)}`).join(", ")}.`);
  if (up.length) sentences.push(`Điểm sáng: ${up.map((m) => `${m.label} ${deltaUsd(m.delta, 0)}`).join(", ")}.`);
  if (team.unreliable.length) sentences.push(`Thiếu số Ads ở ${team.unreliable.join(", ")} nên chưa so được Profit với TB 7 ngày.`);
  return sentences.join(" ");
}

function teamPanel(team: TeamAnalysis, options: DailyReportCardOptions): Record<string, unknown> {
  const { today, avg7 } = team;
  const title = `${LIGHT_EMOJI[team.light]} **${teamLabel(team.team, options.teamLeads)}** · Profit ${formatUsd(today.profit)} ${
    avg7 && !team.unreliable.length ? `(${deltaUsd(today.profit, avg7.profit)} vs TB 7 ngày)` : ""
  }`.trim();
  const comment = options.teamComments?.[team.team]?.trim() || defaultTeamComment(team);
  return {
    tag: "collapsible_panel",
    expanded: team.light === "red",
    header: {
      title: { tag: "markdown", content: title },
      icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "6px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [
      { tag: "markdown", content: `💬 ${comment}` },
      ...team.channels.map((ch) => ({ tag: "markdown", content: channelBlock(ch) })),
    ],
  };
}

function driversText(a: DailyReportAnalysis): string {
  const { today, avg7, unreliable } = a.company;
  if (!avg7) return "";
  const fmt = (list: { label: string; delta: number }[]) =>
    list.map((d) => `${d.label} ${deltaUsd(d.delta, 0)}`).join(", ");
  const lines = unreliable.length
    ? [
        `**📈 Biến động Profit theo kênh** (so với TB 7 ngày)`,
        `<font color='orange'>⚠️ Thiếu số Ads ở ${unreliable.join(", ")} — chưa so được Profit/Margin/ACoS tổng (n/a), các kênh này không tính bên dưới.</font>`,
      ]
    : [`**📈 Profit ${deltaUsd(today.profit, avg7.profit)} so với TB 7 ngày (${formatUsd(avg7.profit)}/ngày)**`];
  if (a.drivers.up.length) lines.push(`Kéo lên: ${fmt(a.drivers.up)}`);
  if (a.drivers.down.length) lines.push(`Kéo xuống: ${fmt(a.drivers.down)}`);
  return lines.join("\n");
}

function actionsText(a: DailyReportAnalysis, options: DailyReportCardOptions): string {
  if (!a.actions.length) return "**✅ Cần action hôm nay**\nKhông có việc khẩn — các kênh đều trong ngưỡng bình thường.";
  return [
    "**⚠️ Cần action hôm nay** (xếp theo $ ảnh hưởng)",
    ...a.actions.map((x, i) => `${i + 1}. **${x.label}** (${teamLabel(x.team, options.teamLeads)}): ${x.text}`),
  ].join("\n");
}

const RULES_NOTE =
  `Δ so với TB 7 ngày trước. Xanh = tốt, đỏ = xấu (ACoS/TACoS giảm là tốt), đ = điểm %. ` +
  `🌱 kênh mới (< 30 ngày) không chấm đèn. 🔴 lỗ hoặc Profit < ${LIGHT_RULES.redProfitRatio * 100}% TB 7 ngày · ` +
  `🟡 Profit < ${LIGHT_RULES.yellowProfitRatio * 100}% TB 7 ngày, TACoS tăng ≥ ${LIGHT_RULES.yellowTacosRise * 100}đ hoặc thiếu số Ads · 🟢 còn lại. ` +
  `Tỉ lệ (margin, ACoS, TACoS) chỉ so khi doanh số ≥ $${MIN_RATIO_BASE}.`;

export function buildDailyReportCard(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [
    { tag: "markdown", content: `**🏢 Tổng công ty** ${LIGHT_EMOJI[a.company.light]} · ${a.company.channelCount} kênh · ${a.teams.length} team` },
    companyTable(a),
  ];
  const drivers = driversText(a);
  if (drivers) elements.push({ tag: "markdown", content: drivers });
  elements.push({ tag: "markdown", content: actionsText(a, options) });
  elements.push({ tag: "hr" });
  for (const team of a.teams) elements.push(teamPanel(team, options));
  elements.push({ tag: "markdown", content: `<font color='grey'>${RULES_NOTE}</font>`, text_size: "notation" });

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: LIGHT_TEMPLATE[a.company.light],
      title: { tag: "plain_text", content: `📊 Báo cáo kinh doanh — ${displayDate(a.date)}` },
    },
    body: { elements },
  };
}

const stripTags = (text: string) => text.replace(/<\/?font[^>]*>/g, "").replace(/\*\*/g, "");

/** Bản text thuần (gửi khi card lỗi, và để xem trước trong terminal). */
export function buildDailyReportText(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): string {
  const { today, avg7, lastWeek, monthAvg } = a.company;
  const lines = [
    `📊 Báo cáo kinh doanh — ${displayDate(a.date)}`,
    `🏢 Tổng công ty ${LIGHT_EMOJI[a.company.light]} · ${a.company.channelCount} kênh · ${a.teams.length} team`,
    ...COMPANY_ROWS.map((row) => {
      const vs7 = stripTags(companyDelta(a, row, avg7));
      const vsWeek = stripTags(companyDelta(a, row, lastWeek));
      return `  ${row.name}: ${row.value(today)} | vs TB7 ${vs7} | vs tuần trước ${vsWeek} | TB tháng ${monthAvg ? row.value(monthAvg) : "—"}`;
    }),
    "",
    stripTags(driversText(a)),
    "",
    stripTags(actionsText(a, options)),
  ];
  for (const team of a.teams) {
    lines.push("", stripTags(`${LIGHT_EMOJI[team.light]} ${teamLabel(team.team, options.teamLeads)} · Profit ${formatUsd(team.today.profit)} ${team.avg7 && !team.unreliable.length ? `(${deltaUsd(team.today.profit, team.avg7.profit)} vs TB 7 ngày)` : ""}`).trimEnd());
    lines.push(`  💬 ${stripTags(options.teamComments?.[team.team]?.trim() || defaultTeamComment(team))}`);
    for (const ch of team.channels) lines.push(...stripTags(channelBlock(ch)).split("\n").map((l, i) => (i ? `     ${l}` : `  ${l}`)));
  }
  lines.push("", RULES_NOTE);
  return lines.join("\n");
}
