// Dựng card Lark (schema 2.0) + bản text dự phòng cho báo cáo kinh doanh ngày (thuần).
//
// 2 tầng:
// - Bản tóm tắt (gửi tự động mỗi sáng, đọc ~30 giây): cảnh báo dữ liệu → KPI → tối đa 5 ưu tiên
//   → Profit theo team → tăng trưởng nổi bật.
// - Bản chi tiết (khi nhắn bot "báo cáo chi tiết"): đủ mọi kênh với dữ kiện SKU / Organic / Ads.
// Mọi Δ đều so với TB 7 ngày trước; emoji 🔴 🟡 🟢 chỉ dùng cho mức ưu tiên.

import {
  usd,
  usdSigned,
  type ChannelAnalysis,
  type DailyReportAnalysis,
  type GroupAnalysis,
  type Severity,
  type TeamAnalysis,
} from "./daily-report-analysis";

export interface DailyReportCardOptions {
  /** Tên trưởng team theo mã team ("FBA 1" -> "Quỳnh"). */
  teamLeads?: Record<string, string>;
}

const SEVERITY_EMOJI: Record<Severity, string> = { high: "🔴", medium: "🟡", good: "🟢" };
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
/** Mẫu số tối thiểu ($) để % thay đổi và tỉ lệ có ý nghĩa. */
const MIN_BASE = 50;
const BASELINE = "So với TB 7 ngày";
export const DETAIL_COMMAND = "báo cáo chi tiết";

export const formatUsd = usd;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function colored(text: string, good: boolean | null): string {
  return `<font color='${good === null ? "grey" : good ? "green" : "red"}'>${text}</font>`;
}

/** % thay đổi; ẩn khi mốc quá nhỏ hoặc âm (tránh kiểu -417%). */
function deltaPct(current: number, base: number | undefined): string {
  if (base == null || base < MIN_BASE) return "";
  const change = (current - base) / base;
  return colored(`${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`, Math.abs(change) < 0.02 ? null : change > 0);
}

function deltaUsd(diff: number | null | undefined): string {
  if (diff == null) return "";
  return colored(usdSigned(diff), Math.abs(diff) < 5 ? null : diff > 0);
}

/** Chênh lệch điểm % (margin, TACoS). */
function deltaPts(current: number, base: number, higherIsBetter: boolean): string {
  const diff = (current - base) * 100;
  return colored(`${diff >= 0 ? "+" : ""}${diff.toFixed(1)} điểm`, Math.abs(diff) < 0.5 ? null : diff > 0 === higherIsBetter);
}

export function teamLabel(team: string, leads?: Record<string, string>): string {
  const lead = leads?.[team]?.trim();
  return lead ? `${team} · ${lead}` : team;
}

export function displayDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`;
}

const NA = colored("n/a", null);

/** KPI tổng: giá trị + Δ so với TB 7 ngày. Có kênh thiếu dữ liệu thì không so các chỉ số phụ thuộc Ads. */
function kpis(g: GroupAnalysis): Array<{ name: string; value: string; delta: string }> {
  const { today: t, avg7: b, comparable } = g;
  const ratioOk = Boolean(b && t.revenue >= MIN_BASE && b.revenue >= MIN_BASE);
  return [
    { name: "Revenue", value: usd(t.revenue), delta: deltaPct(t.revenue, b?.revenue) },
    { name: "Profit", value: usd(t.profit), delta: !b ? "" : comparable ? deltaUsd(t.profit - b.profit) : NA },
    { name: "Margin", value: t.revenue > 0 ? pct(t.margin) : "—", delta: !ratioOk ? "" : comparable ? deltaPts(t.margin, b!.margin, true) : NA },
    { name: "TACoS", value: t.revenue > 0 ? pct(t.tacos) : "—", delta: !ratioOk ? "" : comparable ? deltaPts(t.tacos, b!.tacos, false) : NA },
  ];
}

function kpiGrid(a: DailyReportAnalysis): Record<string, unknown> {
  return {
    tag: "column_set",
    flex_mode: "bisect",
    horizontal_spacing: "8px",
    columns: kpis(a.company).map((k) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      background_style: "grey",
      padding: "8px 8px 8px 8px",
      elements: [{ tag: "markdown", text_align: "center", content: `<font color='grey'>${k.name}</font>\n**${k.value}**\n${k.delta || "—"}` }],
    })),
  };
}

function warningsBlock(a: DailyReportAnalysis): string {
  if (!a.warnings.length) return "";
  return [`⚠️ **Cảnh báo dữ liệu** — các kênh dưới đây không được so Profit`, ...a.warnings.map((w) => `- ${w}`)].join("\n");
}

/** Hiện tượng của 1 kênh: Δ Profit so với TB 7 ngày (hoặc doanh thu $0). */
function phenomenon(ch: ChannelAnalysis): string {
  if (ch.profitDelta == null || ch.today.revenue <= 0) return "Revenue $0";
  return `Profit ${usdSigned(ch.profitDelta)}${ch.today.profit < 0 ? ` (lỗ ${usd(-ch.today.profit)})` : ""}`;
}

/** Các dòng phân tích: Yếu tố đóng góp → Cần xác minh → Hành động. */
function analysisLines(ch: ChannelAnalysis, maxFacts?: number): string[] {
  const r = ch.review;
  if (!r) return [];
  const lines: string[] = [];
  const facts = maxFacts ? r.facts.slice(0, maxFacts) : r.facts;
  if (facts.length) lines.push(`<font color='grey'>Yếu tố: ${facts.join(" · ")}</font>`);
  if (r.checks.length) lines.push(`<font color='grey'>Cần xác minh: ${r.checks.join(", ")}</font>`);
  if (r.actions.length) lines.push(`→ **${r.actions.join("; ")}**`);
  return lines;
}

/** 1 mục ưu tiên / cơ hội: Hiện tượng (tiêu đề) → Yếu tố → Cần xác minh → Hành động. */
function priorityItem(ch: ChannelAnalysis, options: DailyReportCardOptions, maxFacts = 3): string {
  const lead = options.teamLeads?.[ch.team]?.trim();
  const head = `${SEVERITY_EMOJI[ch.review!.severity]} **${ch.label}**${lead ? ` (${lead})` : ""} · ${phenomenon(ch)}`;
  return [head, ...analysisLines(ch, maxFacts)].join("\n");
}

function prioritiesBlock(a: DailyReportAnalysis, options: DailyReportCardOptions): string {
  if (!a.priorities.length) return "✅ **Không có vấn đề cần xử lý**";
  return [`**Rủi ro — ưu tiên xử lý**`, ...a.priorities.map((ch) => priorityItem(ch, options))].join("\n\n");
}

function teamDelta(team: GroupAnalysis): string {
  if (!team.avg7) return "—";
  return team.comparable ? deltaUsd(team.today.profit - team.avg7.profit) : NA;
}

function teamTable(a: DailyReportAnalysis, options: DailyReportCardOptions): Record<string, unknown> {
  return {
    tag: "table",
    page_size: Math.max(a.teams.length, 1),
    row_height: "low",
    header_style: { text_align: "left", text_size: "normal", background_style: "grey", bold: true, lines: 1 },
    columns: [
      { name: "team", display_name: "Team", data_type: "lark_md", horizontal_align: "left", width: "auto" },
      { name: "profit", display_name: "Profit", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "delta", display_name: "Δ TB 7 ngày", data_type: "lark_md", horizontal_align: "right", width: "auto" },
    ],
    rows: a.teams.map((team) => ({
      team: teamLabel(team.team, options.teamLeads),
      profit: `**${usd(team.today.profit)}**`,
      delta: teamDelta(team),
    })),
  };
}

function opportunitiesBlock(a: DailyReportAnalysis, options: DailyReportCardOptions): string {
  if (!a.opportunities.length) return "";
  return [`**Cơ hội**`, ...a.opportunities.map((ch) => priorityItem(ch, options, 2))].join("\n\n");
}

function cardHeader(title: string, subtitle: string): Record<string, unknown> {
  return {
    template: "blue",
    title: { tag: "plain_text", content: title },
    subtitle: { tag: "plain_text", content: subtitle },
  };
}

const footnote = (text: string) => ({ tag: "markdown", content: `<font color='grey'>${text}</font>`, text_size: "notation" });

/** Bản tóm tắt gửi tự động. */
export function buildDailyReportCard(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  const warnings = warningsBlock(a);
  if (warnings) elements.push({ tag: "markdown", content: warnings });
  // Luồng đọc: Kết quả (KPI, team) → Rủi ro cần xử lý → Cơ hội
  elements.push(kpiGrid(a));
  elements.push(teamTable(a, options));
  elements.push({ tag: "hr" });
  elements.push({ tag: "markdown", content: prioritiesBlock(a, options) });
  const opportunities = opportunitiesBlock(a, options);
  if (opportunities) elements.push({ tag: "markdown", content: opportunities });
  elements.push(footnote(`Δ = so với TB 7 ngày trước · 🔴 ưu tiên cao · 🟡 theo dõi · Nhắn bot "${DETAIL_COMMAND}" để xem đủ ${a.company.channelCount} kênh, SKU, Organic/Ads`));

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: cardHeader(
      `Báo cáo kinh doanh · ${displayDate(a.date)}`,
      `${a.company.channelCount} kênh · ${a.teams.length} team · ${BASELINE} · ${a.priorities.length} ưu tiên`,
    ),
    body: { elements },
  };
}

/** Dòng số liệu 1 kênh cho bản chi tiết. */
function channelLine(ch: ChannelAnalysis): string {
  const { today: t, avg7: b } = ch;
  const mark = ch.review ? SEVERITY_EMOJI[ch.review.severity] : "▫️";
  const numbers = [
    `Rev ${usd(t.revenue)} ${deltaPct(t.revenue, b?.revenue)}`.trim(),
    `Profit **${usd(t.profit)}** ${deltaUsd(ch.profitDelta)}`.trim(),
    t.revenue > 0 ? `TACoS ${pct(t.tacos)}` : "",
  ].filter(Boolean);
  const lines = [`${mark} **${ch.label}**${ch.isNew ? " 🌱" : ""} · ${numbers.join(" · ")}`];
  if (ch.dataIssue) lines.push(`<font color='orange'>⚠️ ${ch.dataIssue === "ads_missing" ? "Chưa có số Ads ngày này" : "7 ngày trước chưa có số Ads"} — không so Profit</font>`);
  lines.push(...analysisLines(ch));
  return lines.join("\n");
}

function teamSection(team: TeamAnalysis, options: DailyReportCardOptions): Record<string, unknown> {
  return {
    tag: "collapsible_panel",
    expanded: true,
    header: {
      title: { tag: "markdown", content: `**${teamLabel(team.team, options.teamLeads)}** · Profit **${usd(team.today.profit)}** ${teamDelta(team)}` },
      icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "6px" },
    vertical_spacing: "8px",
    padding: "6px 8px 6px 8px",
    elements: team.channels.map((ch) => ({ tag: "markdown", content: channelLine(ch) })),
  };
}

/** Bản chi tiết gửi khi có yêu cầu (lọc theo store người hỏi được xem). */
export function buildDailyReportDetailCard(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  const warnings = warningsBlock(a);
  if (warnings) elements.push({ tag: "markdown", content: warnings });
  for (const team of a.teams) elements.push(teamSection(team, options));
  elements.push(footnote("Δ = so với TB 7 ngày trước · 🔴 ưu tiên cao · 🟡 theo dõi · 🟢 tăng tốt · ▫️ trong ngưỡng · 🌱 kênh mới · units/ngày = TB 7 ngày → ngày báo cáo"));
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: cardHeader(`Báo cáo chi tiết · ${displayDate(a.date)}`, `${a.company.channelCount} kênh · ${BASELINE}`),
    body: { elements },
  };
}

const stripTags = (text: string) => text.replace(/<\/?font[^>]*>/g, "").replace(/\*\*/g, "");

/** Bản text thuần của bản tóm tắt (gửi khi card lỗi, và để xem trước). */
export function buildDailyReportText(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): string {
  const lines = [
    `📊 Báo cáo kinh doanh · ${displayDate(a.date)}`,
    `${a.company.channelCount} kênh · ${a.teams.length} team · ${BASELINE} · ${a.priorities.length} ưu tiên`,
  ];
  const warnings = warningsBlock(a);
  if (warnings) lines.push("", stripTags(warnings));
  lines.push("", kpis(a.company).map((k) => `${k.name} ${k.value} ${stripTags(k.delta)}`.trim()).join(" | "));
  lines.push("", "Theo team");
  for (const team of a.teams) lines.push(`  ${teamLabel(team.team, options.teamLeads)}: ${usd(team.today.profit)} ${stripTags(teamDelta(team))}`);
  lines.push("", stripTags(prioritiesBlock(a, options)));
  const opportunities = opportunitiesBlock(a, options);
  if (opportunities) lines.push("", stripTags(opportunities));
  return lines.join("\n");
}

/** Bản text thuần của bản chi tiết. */
export function buildDailyReportDetailText(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): string {
  const lines = [`📋 Báo cáo chi tiết · ${displayDate(a.date)} · ${BASELINE}`];
  const warnings = warningsBlock(a);
  if (warnings) lines.push("", stripTags(warnings));
  for (const team of a.teams) {
    lines.push("", stripTags(`${teamLabel(team.team, options.teamLeads)} · Profit ${usd(team.today.profit)} ${teamDelta(team)}`));
    for (const ch of team.channels) lines.push(...stripTags(channelLine(ch)).split("\n").map((l, i) => (i ? `     ${l}` : `  ${l}`)));
  }
  return lines.join("\n");
}
