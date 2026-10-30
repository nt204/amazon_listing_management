// Dựng card Lark (schema 2.0) + bản text dự phòng cho báo cáo kinh doanh ngày (thuần).
// Nguyên tắc trình bày: số trước chữ, mỗi phần tối đa vài dòng, chi tiết nằm trong khung thu gọn.

import type { ChannelAnalysis, DailyReportAnalysis, Light, TeamAnalysis } from "./daily-report-analysis";

export interface DailyReportCardOptions {
  /** Tên trưởng team theo mã team ("FBA 1" -> "Quỳnh"). */
  teamLeads?: Record<string, string>;
  /** Nhận xét 1 câu cho từng team (AI viết); team nào thiếu thì dùng bản do code soạn. */
  teamComments?: Record<string, string>;
}

const LIGHT_EMOJI: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const LIGHT_TEMPLATE: Record<Light, string> = { green: "green", yellow: "orange", red: "red" };
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
/** Mẫu số tối thiểu ($) để tỉ lệ (margin, TACoS) và % thay đổi có ý nghĩa. */
const MIN_RATIO_BASE = 50;

export function formatUsd(value: number): string {
  const rounded = Math.round(value);
  const text = `$${Math.abs(rounded).toLocaleString("en-US")}`;
  return rounded < 0 ? `-${text}` : text;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function colored(text: string, good: boolean | null): string {
  return `<font color='${good === null ? "grey" : good ? "green" : "red"}'>${text}</font>`;
}

/** % thay đổi; ẩn khi mốc quá nhỏ hoặc âm (tránh kiểu -417%). */
function deltaPct(current: number, base: number | undefined, higherIsBetter = true): string {
  if (base == null || base < MIN_RATIO_BASE) return "";
  const change = (current - base) / base;
  const text = `${change >= 0 ? "+" : ""}${Math.round(change * 100)}%`;
  return colored(text, Math.abs(change) < 0.02 ? null : change > 0 === higherIsBetter);
}

function deltaUsd(current: number, base: number | undefined): string {
  if (base == null) return "";
  const diff = current - base;
  const text = `${diff >= 0 ? "+" : "-"}$${Math.abs(Math.round(diff)).toLocaleString("en-US")}`;
  return colored(text, Math.abs(diff) < 5 ? null : diff > 0);
}

/** Chênh lệch điểm %; bỏ qua khi mẫu số hôm nay hoặc mốc quá nhỏ. */
function deltaPts(current: number, base: number | undefined, higherIsBetter: boolean, denominators: [number, number | undefined]): string {
  if (base == null || denominators[0] < MIN_RATIO_BASE || (denominators[1] ?? 0) < MIN_RATIO_BASE) return "";
  const diff = (current - base) * 100;
  const text = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}đ`;
  return colored(text, Math.abs(diff) < 0.5 ? null : diff > 0 === higherIsBetter);
}

const NA = colored("n/a", null);

export function teamLabel(team: string, leads?: Record<string, string>): string {
  const lead = leads?.[team]?.trim();
  return lead ? `${team} · ${lead}` : team;
}

export function displayDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${d}/${m}/${y}`;
}

/** Thẻ KPI tổng công ty: giá trị + Δ so với TB 7 ngày. */
function kpis(a: DailyReportAnalysis): Array<{ name: string; value: string; delta: string }> {
  const { today: t, avg7: b, unreliable } = a.company;
  const adsOk = !unreliable.length;
  return [
    { name: "Revenue", value: formatUsd(t.revenue), delta: deltaPct(t.revenue, b?.revenue) },
    { name: "Profit", value: formatUsd(t.profit), delta: adsOk ? deltaUsd(t.profit, b?.profit) : NA },
    { name: "Margin", value: t.revenue > 0 ? pct(t.margin) : "—", delta: adsOk ? deltaPts(t.margin, b?.margin, true, [t.revenue, b?.revenue]) : NA },
    { name: "TACoS", value: t.revenue > 0 ? pct(t.tacos) : "—", delta: adsOk ? deltaPts(t.tacos, b?.tacos, false, [t.revenue, b?.revenue]) : NA },
  ];
}

function kpiGrid(a: DailyReportAnalysis): Record<string, unknown> {
  return {
    tag: "column_set",
    flex_mode: "bisect",
    horizontal_spacing: "8px",
    columns: kpis(a).map((k) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      background_style: "grey",
      padding: "8px 8px 8px 8px",
      elements: [
        {
          tag: "markdown",
          text_align: "center",
          content: `<font color='grey'>${k.name}</font>\n**${k.value}** ${k.delta}`.trim(),
        },
      ],
    })),
  };
}

/** Kênh kéo Profit lên / xuống nhiều nhất so với TB 7 ngày. */
function driversLine(a: DailyReportAnalysis): string {
  const fmt = (list: { label: string; delta: number }[]) => list.map((d) => `${d.label} ${deltaUsd(d.delta, 0)}`).join(", ");
  const parts: string[] = [];
  if (a.drivers.up.length) parts.push(`▲ ${fmt(a.drivers.up)}`);
  if (a.drivers.down.length) parts.push(`▼ ${fmt(a.drivers.down)}`);
  const lines = parts.length ? [`**Biến động Profit:** ${parts.join("　")}`] : [];
  if (a.company.unreliable.length) {
    lines.push(`<font color='orange'>⚠️ Thiếu số Ads: ${a.company.unreliable.join(", ")} — chưa so được Profit tổng</font>`);
  }
  return lines.join("\n");
}

function actionsBlock(a: DailyReportAnalysis, options: DailyReportCardOptions): string {
  if (!a.actions.length) return "**✅ Không có việc khẩn**";
  return [
    "**Ưu tiên hôm nay**",
    ...a.actions.map((x, i) => {
      const lead = options.teamLeads?.[x.team]?.trim();
      return `${i + 1}. **${x.label}**${lead ? ` · ${lead}` : ""}: ${x.title}`;
    }),
  ].join("\n");
}

/** Rà soát từng kênh của team: nguyên nhân (kèm bằng chứng) → việc cần kiểm tra. */
function reviewLines(team: TeamAnalysis): string[] {
  const reviewed = team.channels
    .filter((c) => c.diagnosis)
    .sort((x, y) => Number(y.diagnosis?.isIssue) - Number(x.diagnosis?.isIssue) || (y.diagnosis?.impact ?? 0) - (x.diagnosis?.impact ?? 0));
  return reviewed.map((c) => {
    const d = c.diagnosis!;
    const mark = c.isNew ? "🌱" : d.isIssue ? LIGHT_EMOJI[c.light] : "▲";
    const lines = [`${mark} **${c.label}**: ${d.cause}`];
    if (d.checks.length) lines.push(`　→ ${d.checks.join("; ")}`);
    return lines.join("\n");
  });
}

const issueCount = (team: TeamAnalysis) => team.channels.filter((c) => c.diagnosis?.isIssue && c.diagnosis.checks.length).length;

function channelName(ch: ChannelAnalysis): string {
  const mark = ch.isNew ? "🌱" : LIGHT_EMOJI[ch.light];
  return `${mark} ${ch.label}${ch.adsMissing || ch.baselineAdsMissing ? " ⚠️" : ""}`;
}

function channelRows(team: TeamAnalysis): Array<{ ch: string; rev: string; profit: string; tacos: string }> {
  return team.channels.map((ch) => {
    const { today: t, avg7: b } = ch;
    const adsOk = !ch.adsMissing && !ch.baselineAdsMissing;
    return {
      ch: channelName(ch),
      rev: `${formatUsd(t.revenue)} ${deltaPct(t.revenue, b?.revenue)}`.trim(),
      profit: `**${formatUsd(t.profit)}** ${adsOk ? deltaUsd(t.profit, b?.profit) : ""}`.trim(),
      tacos: t.revenue > 0
        ? `${pct(t.tacos)} ${adsOk ? deltaPts(t.tacos, b?.tacos, false, [t.revenue, b?.revenue]) : ""}`.trim()
        : "—",
    };
  });
}

/** 1 hàng của lưới kênh. Lark không cho đặt component table trong collapsible_panel nên dựng bằng column_set. */
function gridRow(cells: [string, string, string, string], header = false): Record<string, unknown> {
  const weights = [3, 2, 2, 2];
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "4px",
    ...(header ? { background_style: "grey" } : {}),
    columns: cells.map((content, i) => ({
      tag: "column",
      width: "weighted",
      weight: weights[i],
      vertical_align: "center",
      elements: [{ tag: "markdown", content, text_align: i === 0 ? "left" : "right" }],
    })),
  };
}

function channelGrid(team: TeamAnalysis): Array<Record<string, unknown>> {
  return [
    gridRow(["**Kênh**", "**Revenue**", "**Profit**", "**TACoS**"], true),
    ...channelRows(team).map((row) => gridRow([row.ch, row.rev, row.profit, row.tacos])),
  ];
}

function teamHeadline(team: TeamAnalysis, options: DailyReportCardOptions): string {
  const delta = team.avg7 && !team.unreliable.length ? ` ${deltaUsd(team.today.profit, team.avg7.profit)}` : "";
  const issues = issueCount(team);
  return `${LIGHT_EMOJI[team.light]} **${teamLabel(team.team, options.teamLeads)}**　Profit **${formatUsd(team.today.profit)}**${delta}${
    issues ? `　<font color='grey'>${issues} việc</font>` : ""
  }`;
}

/** Chẩn đoán 1 câu do code soạn — dùng khi AI tắt hoặc lỗi. */
export function defaultTeamComment(team: TeamAnalysis): string {
  const moves = team.channels
    .filter((c) => c.avg7 && !c.isNew && !c.adsMissing && !c.baselineAdsMissing)
    .map((c) => ({ label: c.label, delta: c.today.profit - (c.avg7?.profit ?? 0) }))
    .filter((m) => Math.abs(m.delta) >= 30)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  if (!moves.length) {
    return team.unreliable.length ? `Thiếu số Ads (${team.unreliable.join(", ")}), chưa so được.` : "Ổn định so với TB 7 ngày.";
  }
  return `Biến động chính: ${moves.slice(0, 2).map((m) => `${m.label} ${deltaUsd(m.delta, 0)}`).join(", ")}.`;
}

function teamPanel(team: TeamAnalysis, options: DailyReportCardOptions): Record<string, unknown> {
  const comment = options.teamComments?.[team.team]?.trim() || defaultTeamComment(team);
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: {
      title: { tag: "markdown", content: teamHeadline(team, options) },
      icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "6px" },
    vertical_spacing: "6px",
    padding: "6px 8px 6px 8px",
    elements: [
      { tag: "markdown", content: `<font color='grey'>${comment}</font>` },
      ...channelGrid(team),
      ...(reviewLines(team).length
        ? [{ tag: "markdown", content: `**Rà soát**\n${reviewLines(team).join("\n")}` }]
        : []),
    ],
  };
}

const FOOTNOTE = "Δ = so với TB 7 ngày trước · 🌱 kênh mới (không chấm đèn) · ⚠️ thiếu số Ads";

export function buildDailyReportCard(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [kpiGrid(a)];
  const drivers = driversLine(a);
  if (drivers) elements.push({ tag: "markdown", content: drivers });
  elements.push({ tag: "markdown", content: actionsBlock(a, options) });
  elements.push({ tag: "hr" });
  for (const team of a.teams) elements.push(teamPanel(team, options));
  elements.push({ tag: "markdown", content: `<font color='grey'>${FOOTNOTE}</font>`, text_size: "notation" });

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: LIGHT_TEMPLATE[a.company.light],
      title: { tag: "plain_text", content: `Báo cáo kinh doanh ${displayDate(a.date)}` },
      subtitle: { tag: "plain_text", content: `${a.company.channelCount} kênh · ${a.teams.length} team` },
    },
    body: { elements },
  };
}

const stripTags = (text: string) => text.replace(/<\/?font[^>]*>/g, "").replace(/\*\*/g, "").replace(/　/g, "  ");

/** Bản text thuần (gửi khi card lỗi, và để xem trước trong terminal). */
export function buildDailyReportText(a: DailyReportAnalysis, options: DailyReportCardOptions = {}): string {
  const lines = [
    `📊 Báo cáo kinh doanh ${displayDate(a.date)} ${LIGHT_EMOJI[a.company.light]}`,
    kpis(a).map((k) => `${k.name} ${k.value} ${stripTags(k.delta)}`.trim()).join(" | "),
  ];
  const drivers = driversLine(a);
  if (drivers) lines.push(stripTags(drivers));
  lines.push("", stripTags(actionsBlock(a, options)));
  for (const team of a.teams) {
    lines.push("", stripTags(teamHeadline(team, options)));
    lines.push(`  ${stripTags(options.teamComments?.[team.team]?.trim() || defaultTeamComment(team))}`);
    for (const row of channelRows(team)) {
      lines.push(`  ${stripTags(row.ch)} | ${stripTags(row.rev)} | Profit ${stripTags(row.profit)} | TACoS ${stripTags(row.tacos)}`);
    }
    for (const review of reviewLines(team)) lines.push(...stripTags(review).split("\n").map((l) => `  ${l}`));
  }
  lines.push("", FOOTNOTE);
  return lines.join("\n");
}
