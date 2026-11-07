// Card Lark (schema 2.0) báo cáo kinh doanh ngày: KPI tổng + team ở trên, mỗi store 1 mục thu gọn
// (collapsible_panel) bấm để xem số từng kênh. Mỗi chỉ số so với hôm qua (Δ) và TB 7 ngày trước.
// Màu chỉ mang nghĩa tốt / xấu: ACoS, TACoS giảm là tốt.

import type { DashboardTotals } from "./dashboard-totals";
import { sumSeries, usd, type ChannelAnalysis, type ChannelSeriesInput, type DailyReportAnalysis } from "./daily-report-analysis";
import { displayDate, teamLabel, type DailyReportCardOptions } from "./daily-report-card";
import { buildRow, vsAvg, type Row, type Tone } from "./daily-report-image";

const MIN_BASE = 50;
const STATUS: Record<Tone, string> = { good: "🟢", bad: "🔴", flat: "🟡" };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const units = (v: number) => Math.round(v).toLocaleString("en-US");

function toneOf(diff: number, higherIsBetter: boolean, flatBelow: number): Tone {
  if (Math.abs(diff) < flatBelow) return "flat";
  return diff > 0 === higherIsBetter ? "good" : "bad";
}

function colored(text: string, tone: Tone): string {
  return `<font color='${tone === "good" ? "green" : tone === "bad" ? "red" : "grey"}'>${text}</font>`;
}

const arrow = (diff: number) => (diff >= 0 ? "▲" : "▼");

function dPct(cur: number, base: number | undefined, minBase = MIN_BASE): string {
  if (base == null || base < minBase) return "";
  const change = (cur - base) / base;
  return colored(`${arrow(change)}${Math.abs(change * 100).toFixed(1)}%`, toneOf(change, true, 0.02));
}

function dUsd(cur: number, base: number | undefined): string {
  if (base == null) return "";
  const diff = cur - base;
  return colored(`${arrow(diff)}${usd(Math.abs(diff))}`, toneOf(diff, true, 5));
}

function dUnits(cur: number, base: number | undefined): string {
  if (base == null) return "";
  const diff = Math.round(cur - base);
  return colored(`${arrow(diff)}${Math.abs(diff)}`, toneOf(diff, true, 1));
}

/** Δ điểm % (margin, ACoS, TACoS); chỉ so khi cả 2 ngày có mẫu số. */
function dPts(cur: number, base: number | undefined, higherIsBetter: boolean): string {
  if (base == null) return "";
  const diff = (cur - base) * 100;
  return colored(`${arrow(diff)}${Math.abs(diff).toFixed(1)}đ`, toneOf(diff, higherIsBetter, 0.5));
}

const withDelta = (value: string, delta: string) => (delta ? `${value} ${delta}` : value);

/** Trạng thái 1 store / kênh: lỗ hoặc Profit thấp hẳn TB 7 ngày là đỏ. */
function statusOf(r: Row): Tone {
  if (r.missingSince) return "flat";
  if (r.today.profit < 0) return "bad";
  const vs = vsAvg(r);
  return vs.value == null ? "flat" : vs.value <= -0.15 ? "bad" : vs.value >= 0.15 ? "good" : "flat";
}

/** Profit những ngày giảm liên tiếp, vd "$802 → $254 → $220". */
const fallingTrail = (r: Row) => r.trend.slice(-(r.fallingDays + 1)).map((v) => usd(v)).join(" → ");

/** Các dòng số liệu của 1 kênh (hoặc tổng). */
function metricLines(r: Row): string[] {
  if (r.missingSince) return [`<font color='orange'>Chưa có số ngày này · số gần nhất ${displayDate(r.missingSince)}</font>`];
  const t: DashboardTotals = r.today;
  const y = r.yesterday ?? undefined;
  const hasRev = t.revenue > 0;
  const vs = vsAvg(r);
  const lines = [
    `Revenue **${withDelta(usd(t.revenue), dPct(t.revenue, y?.revenue))}** · Units ${withDelta(units(t.quantity), dUnits(t.quantity, y?.quantity))}`,
    `Profit **${withDelta(usd(t.profit), dUsd(t.profit, y?.profit))}** · Margin ${hasRev ? withDelta(pct(t.margin), y && y.revenue > 0 ? dPts(t.margin, y.margin, true) : "") : "—"}`,
    `ACoS ${t.revenueAds > 0 ? withDelta(pct(t.acos), y && y.revenueAds > 0 ? dPts(t.acos, y.acos, false) : "") : "—"} · TACoS ${hasRev ? withDelta(pct(t.tacos), y && y.revenue > 0 ? dPts(t.tacos, y.tacos, false) : "") : "—"}`,
  ];
  const trend = [`Profit vs TB 7 ngày ${colored(vs.text, vs.tone)}`];
  if (r.fallingDays >= 2) trend.push(colored(`giảm ${r.fallingDays} ngày liên tiếp (${fallingTrail(r)})`, "bad"));
  lines.push(`<font color='grey'>${trend.join(" · ")}</font>`);
  return lines;
}

function reviewLines(ch: ChannelAnalysis | undefined): string[] {
  const r = ch?.review;
  if (!r) return [];
  const lines: string[] = [];
  if (r.facts.length) lines.push(`<font color='grey'>Yếu tố: ${r.facts.slice(0, 4).join(" · ")}</font>`);
  if (r.actions.length) lines.push(`→ **${r.actions.join("; ")}**`);
  return lines;
}

function kpiColumn(name: string, value: string, vsYesterday: string, vsAvg7: string): Record<string, unknown> {
  return {
    tag: "column",
    width: "weighted",
    weight: 1,
    background_style: "grey",
    padding: "8px 10px 8px 10px",
    vertical_spacing: "2px",
    elements: [
      { tag: "markdown", content: `<font color='grey'>${name}</font>`, text_size: "notation" },
      { tag: "markdown", content: `**${value}**`, text_size: "heading" },
      { tag: "markdown", content: `<font color='grey'>hôm qua</font> ${vsYesterday || "—"}\n<font color='grey'>TB 7 ngày</font> ${vsAvg7 || "—"}`, text_size: "notation" },
    ],
  };
}

const kpiRow = (columns: Array<Record<string, unknown>>) => ({ tag: "column_set", flex_mode: "bisect", horizontal_spacing: "8px", columns });

function storeStatusFromChannels(row: Row, channels: ChannelAnalysis[]): Tone {
  if (channels.some((c) => !c.isNew && c.review?.severity === "high")) return "bad";
  return statusOf(row);
}

/** Card báo cáo ngày: tổng → team → cần action → mỗi store 1 mục thu gọn. */
export function buildDailyReportStoreCard(
  a: DailyReportAnalysis,
  inputs: ChannelSeriesInput[],
  options: DailyReportCardOptions = {},
): Record<string, unknown> {
  const date = a.date;
  const leads = options.teamLeads;
  const company = buildRow("Tổng", false, sumSeries(inputs.map((i) => i.days)), date);
  const c = company.today;
  const cy = company.yesterday ?? undefined;
  const cb = company.avg7 ?? undefined;
  const channelByLabel = new Map(a.teams.flatMap((t) => t.channels).map((ch) => [ch.label, ch]));

  const elements: Array<Record<string, unknown>> = [];
  if (a.warnings.length) {
    elements.push({ tag: "markdown", content: [`⚠️ **Cảnh báo dữ liệu**`, ...a.warnings.map((w) => `- ${w}`)].join("\n") });
  }

  elements.push(kpiRow([
    kpiColumn("Revenue", usd(c.revenue), dPct(c.revenue, cy?.revenue), dPct(c.revenue, cb?.revenue)),
    kpiColumn("Profit", usd(c.profit), dUsd(c.profit, cy?.profit), dUsd(c.profit, cb?.profit)),
    kpiColumn("Margin", pct(c.margin), cy ? dPts(c.margin, cy.margin, true) : "", cb ? dPts(c.margin, cb.margin, true) : ""),
  ]));
  elements.push(kpiRow([
    kpiColumn("ACoS", c.revenueAds > 0 ? pct(c.acos) : "—", cy && cy.revenueAds > 0 ? dPts(c.acos, cy.acos, false) : "", cb && cb.revenueAds > 0 ? dPts(c.acos, cb.acos, false) : ""),
    kpiColumn("TACoS", pct(c.tacos), cy ? dPts(c.tacos, cy.tacos, false) : "", cb ? dPts(c.tacos, cb.tacos, false) : ""),
    kpiColumn("Units", units(c.quantity), dPct(c.quantity, cy?.quantity, 5), dPct(c.quantity, cb?.quantity, 5)),
  ]));

  // Profit theo team
  const teamRows = a.teams.map((team) => {
    const row = buildRow(team.team, false, sumSeries(inputs.filter((i) => i.team === team.team).map((i) => i.days)), date);
    const vs = vsAvg(row);
    return {
      team: `${STATUS[statusOf(row)]} ${teamLabel(team.team, leads)}`,
      profit: `**${usd(row.today.profit)}**`,
      yesterday: dUsd(row.today.profit, row.yesterday?.profit) || "—",
      avg7: colored(vs.text, vs.tone),
    };
  });
  elements.push({
    tag: "table",
    page_size: Math.max(teamRows.length, 1),
    row_height: "low",
    header_style: { text_align: "left", text_size: "normal", background_style: "grey", bold: true, lines: 1 },
    columns: [
      { name: "team", display_name: "Team", data_type: "lark_md", horizontal_align: "left", width: "auto" },
      { name: "profit", display_name: "Profit", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "yesterday", display_name: "vs hôm qua", data_type: "lark_md", horizontal_align: "right", width: "auto" },
      { name: "avg7", display_name: "vs TB 7 ngày", data_type: "lark_md", horizontal_align: "right", width: "auto" },
    ],
    rows: teamRows,
  });

  // Cần action: vấn đề đã xếp hạng + kênh giảm Profit nhiều ngày liên tiếp
  const rowByLabel = new Map(inputs.map((i) => [i.label, buildRow(i.label, i.isNew, i.days, date)]));
  const actions = a.priorities.map((ch) => {
    const r = rowByLabel.get(ch.label);
    const lead = leads?.[ch.team]?.trim();
    const head = `${ch.review?.severity === "high" ? "🔴" : "🟡"} **${ch.label}**${lead ? ` (${lead})` : ""} · Profit ${usd(ch.today.profit)}`
      + (r && r.fallingDays >= 2 ? ` · giảm ${r.fallingDays} ngày (${fallingTrail(r)})` : "");
    return [head, ...reviewLines(ch)].join("\n");
  });
  elements.push({ tag: "hr" });
  elements.push({
    tag: "markdown",
    content: actions.length ? [`**⚠️ Cần action hôm nay**`, ...actions].join("\n\n") : "✅ **Không có vấn đề cần xử lý**",
  });

  // Mỗi store 1 mục thu gọn, xếp theo Profit giảm dần
  elements.push({ tag: "hr" });
  elements.push({ tag: "markdown", content: `**Chi tiết từng store** <font color='grey'>(bấm để mở)</font>` });
  const storeNames = [...new Set(inputs.map((i) => i.storeName))];
  const stores = storeNames.map((name) => {
    const members = inputs.filter((i) => i.storeName === name);
    const row = buildRow(name, false, sumSeries(members.map((i) => i.days)), date);
    return { name, members, row };
  }).sort((x, y) => y.row.today.profit - x.row.today.profit);

  for (const { name, members, row } of stores) {
    const channels = members.map((m) => channelByLabel.get(m.label)).filter((ch): ch is ChannelAnalysis => Boolean(ch));
    const isNew = members.every((m) => m.isNew);
    const title = `${STATUS[storeStatusFromChannels(row, channels)]} **${name.charAt(0) + name.slice(1).toLowerCase()}**${isNew ? " 🌱" : ""}`
      + ` · ${usd(row.today.profit)} ${dUsd(row.today.profit, row.yesterday?.profit)}`
      + ` <font color='grey'>· ${members.length} kênh</font>`;
    const body: string[] = [];
    for (const m of members) {
      const r = rowByLabel.get(m.label)!;
      const ch = channelByLabel.get(m.label);
      const lead = leads?.[m.team]?.trim();
      body.push([
        `**${m.label}** <font color='grey'>${m.team}${lead ? ` · ${lead}` : ""}</font>${m.isNew ? " 🌱" : ""}`,
        ...metricLines(r),
        ...reviewLines(ch),
      ].join("\n"));
    }
    elements.push({
      tag: "collapsible_panel",
      expanded: false,
      header: {
        title: { tag: "markdown", content: title },
        icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
        icon_position: "right",
        icon_expanded_angle: -180,
      },
      border: { color: "grey", corner_radius: "6px" },
      vertical_spacing: "8px",
      padding: "4px 8px 4px 8px",
      elements: body.map((content) => ({ tag: "markdown", content })),
    });
  }

  const missing = [...rowByLabel.values()].filter((r) => r.missingSince);
  const notes = [
    "▲▼ = so với hôm qua · xanh tốt / đỏ xấu (ACoS, TACoS giảm là tốt) · đ = điểm % · 🌱 kênh mới",
    ...(missing.length ? [`Chưa có số ngày ${displayDate(date)}: ${missing.map((r) => r.label).join(", ")}`] : []),
  ];
  elements.push({ tag: "markdown", content: `<font color='grey'>${notes.join("\n")}</font>`, text_size: "notation" });

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `📊 Báo cáo kinh doanh · ${displayDate(date)}` },
      subtitle: { tag: "plain_text", content: `${a.company.storeCount} store · ${a.company.channelCount} kênh · so với hôm qua và TB 7 ngày` },
    },
    body: { elements },
  };
}
