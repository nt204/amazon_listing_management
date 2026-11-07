// Báo cáo kinh doanh ngày dạng ảnh (PNG) để gửi qua Lark: dựng HTML từ phân tích rồi chụp bằng Chrome headless.
//
// Mỗi chỉ số so với 2 mốc: hôm qua (Δ) và TB 7 ngày trước (giống bản card).
// Màu chỉ mang nghĩa tốt / xấu: ACoS, TACoS giảm là tốt. Không dùng emoji (VPS thường thiếu font emoji).

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

import { summarizeDays, type DashboardDay, type DashboardTotals } from "./dashboard-totals";
import {
  shiftIsoDate,
  sumSeries,
  usd,
  type ChannelAnalysis,
  type ChannelSeriesInput,
  type DailyReportAnalysis,
} from "./daily-report-analysis";
import { displayDate, teamLabel, type DailyReportCardOptions } from "./daily-report-card";

/** Mẫu số tối thiểu ($) để % thay đổi có ý nghĩa. */
const MIN_BASE = 50;
const WIDTH = 1080;

export type Tone = "good" | "bad" | "flat";

export interface Row {
  label: string;
  isNew: boolean;
  /** Kênh chưa có số ngày báo cáo (ngày gần nhất có số). */
  missingSince: string | null;
  today: DashboardTotals;
  yesterday: DashboardTotals | null;
  avg7: DashboardTotals | null;
  /** Profit 8 ngày (7 ngày trước + ngày báo cáo) để vẽ sparkline. */
  trend: number[];
  /** Số ngày Profit giảm liên tiếp tính đến ngày báo cáo. */
  fallingDays: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money2 = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

function toneOf(diff: number, higherIsBetter: boolean, flatBelow: number): Tone {
  if (Math.abs(diff) < flatBelow) return "flat";
  return diff > 0 === higherIsBetter ? "good" : "bad";
}

const chip = (text: string, tone: Tone) => `<span class="d ${tone}">${text}</span>`;
const arrow = (diff: number) => (diff >= 0 ? "▲" : "▼");

/** Δ % (revenue, units). Mốc nhỏ thì bỏ trống để tránh kiểu +900%. */
function dPct(cur: number, base: number | undefined, minBase = MIN_BASE): string {
  if (base == null || base < minBase) return "";
  const change = (cur - base) / base;
  return chip(`${arrow(change)} ${Math.abs(change * 100).toFixed(1)}%`, toneOf(change, true, 0.02));
}

function dUsd(cur: number, base: number | undefined): string {
  if (base == null) return "";
  const diff = cur - base;
  return chip(`${arrow(diff)} ${usd(Math.abs(diff))}`, toneOf(diff, true, 5));
}

/** Δ điểm % (margin, ACoS, TACoS). */
function dPts(cur: number, base: number | undefined, higherIsBetter: boolean): string {
  if (base == null) return "";
  const diff = (cur - base) * 100;
  return chip(`${arrow(diff)} ${Math.abs(diff).toFixed(1)}đ`, toneOf(diff, higherIsBetter, 0.5));
}

function sparkline(values: number[]): string {
  if (values.length < 2) return "";
  const w = 84;
  const h = 30;
  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1);
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - ((v - min) / (max - min)) * (h - 4);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  const color = last >= prev ? "var(--good)" : "var(--bad)";
  const zero = min < 0 ? `<line x1="0" x2="${w}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 2"/>` : "";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${zero}<polyline points="${points}" fill="none" stroke="var(--muted)" stroke-width="1.5"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" fill="${color}"/></svg>`;
}

export function buildRow(label: string, isNew: boolean, days: DashboardDay[], date: string): Row {
  const yDate = shiftIsoDate(date, -1);
  const prior = days.filter((d) => d.date >= shiftIsoDate(date, -7) && d.date < date);
  const priorTotal = summarizeDays(prior);
  const avg7 = priorTotal.days
    ? (Object.fromEntries(Object.entries(priorTotal).map(([k, v]) => [k, ["margin", "netMargin", "roi", "tacos", "acos", "days"].includes(k) ? v : v / priorTotal.days])) as unknown as DashboardTotals)
    : null;
  const yesterdayDays = days.filter((d) => d.date === yDate);
  const todayDays = days.filter((d) => d.date === date);
  const hasNumbers = (ds: DashboardDay[]) => ds.some((d) => d.revenue !== 0 || d.adsFee !== 0);

  const trend: number[] = [];
  for (let i = 7; i >= 0; i--) trend.push(summarizeDays(days.filter((d) => d.date === shiftIsoDate(date, -i))).profit);
  let fallingDays = 0;
  for (let i = trend.length - 1; i > 0 && trend[i] < trend[i - 1]; i--) fallingDays++;

  const latest = days.filter((d) => hasNumbers([d])).map((d) => d.date).sort().pop() ?? null;
  return {
    label,
    isNew,
    missingSince: hasNumbers(todayDays) ? null : latest,
    today: summarizeDays(todayDays),
    yesterday: hasNumbers(yesterdayDays) ? summarizeDays(yesterdayDays) : null,
    avg7,
    trend,
    fallingDays,
  };
}

/** Profit hôm nay so với TB 7 ngày, dạng %. Mốc ≤ $50 thì không so. */
export function vsAvg(r: Row): { text: string; tone: Tone; value: number | null } {
  const base = r.avg7?.profit;
  if (base == null || base < MIN_BASE) return { text: "—", tone: "flat", value: null };
  const change = (r.today.profit - base) / base;
  return { text: `${change >= 0 ? "+" : ""}${Math.round(change * 100)}%`, tone: toneOf(change, true, 0.05), value: change };
}

function metricCell(value: string, delta: string): string {
  return `<td><div class="v">${value}</div>${delta ? `<div class="sub">${delta}</div>` : ""}</td>`;
}

function rowCells(r: Row, isTotal: boolean): string {
  const t = r.today;
  const y = r.yesterday ?? undefined;
  const hasRev = t.revenue > 0;
  const vs = vsAvg(r);
  const falling = r.fallingDays >= 2 ? `<span class="tag bad">giảm ${r.fallingDays} ngày</span>` : "";
  const name = isTotal
    ? `<td class="name total">Tổng team</td>`
    : `<td class="name"><span class="dot ${vs.tone}"></span>${esc(r.label)}${r.isNew ? ' <span class="tag new">mới</span>' : ""}${falling}</td>`;
  if (r.missingSince) {
    return `<tr class="${isTotal ? "trow" : ""}">${name}<td colspan="7" class="missing">Chưa có số ngày này · số gần nhất: ${displayDate(r.missingSince)}</td></tr>`;
  }
  return `<tr class="${isTotal ? "trow" : ""}">${name}`
    + metricCell(money2(t.revenue), dPct(t.revenue, y?.revenue))
    + metricCell(Math.round(t.quantity).toLocaleString("en-US"), y ? chip(`${arrow(t.quantity - y.quantity)} ${Math.abs(Math.round(t.quantity - y.quantity))}`, toneOf(t.quantity - y.quantity, true, 1)) : "")
    + `<td><div class="v ${t.profit < 0 ? "neg" : ""}">${money2(t.profit)}</div><div class="sub">${dUsd(t.profit, y?.profit)}</div></td>`
    + metricCell(hasRev ? pct(t.margin) : "—", hasRev && y && y.revenue > 0 ? dPts(t.margin, y.margin, true) : "")
    + metricCell(t.revenueAds > 0 ? pct(t.acos) : "—", t.revenueAds > 0 && y && y.revenueAds > 0 ? dPts(t.acos, y.acos, false) : "")
    + metricCell(hasRev ? pct(t.tacos) : "—", hasRev && y && y.revenue > 0 ? dPts(t.tacos, y.tacos, false) : "")
    + `<td class="trend"><div class="spark">${sparkline(r.trend)}<span class="d ${vs.tone}">${vs.text}</span></div></td>`
    + `</tr>`;
}

function kpiTile(name: string, value: string, vsYesterday: string, vsAvg7: string): string {
  return `<div class="kpi"><div class="kname">${name}</div><div class="kval">${value}</div>`
    + `<div class="krow"><span class="klab">vs hôm qua</span>${vsYesterday || '<span class="d flat">—</span>'}</div>`
    + `<div class="krow"><span class="klab">vs TB 7 ngày</span>${vsAvg7 || '<span class="d flat">—</span>'}</div></div>`;
}

function actionItem(ch: ChannelAnalysis, row: Row | undefined, lead: string | undefined): string {
  const r = ch.review!;
  const sev = r.severity === "high" ? "bad" : r.severity === "medium" ? "warn" : "good";
  const head = ch.profitDelta == null || ch.today.revenue <= 0
    ? "Revenue $0"
    : `Profit ${usd(ch.today.profit)} (${signedUsd(ch.profitDelta)} vs TB 7 ngày)`;
  const extra = row && row.fallingDays >= 2
    ? ` · giảm ${row.fallingDays} ngày liên tiếp (${row.trend.slice(-(row.fallingDays + 1)).map((v) => usd(v)).join(" → ")})`
    : "";
  return `<div class="act ${sev}"><div class="ahead"><b>${esc(ch.label)}</b>${lead ? ` <span class="who">${esc(lead)}</span>` : ""}<span class="aval">${head}${extra}</span></div>`
    + (r.facts.length ? `<div class="afacts">${r.facts.slice(0, 4).map(esc).join(" · ")}</div>` : "")
    + (r.actions.length ? `<div class="ado">→ ${r.actions.map(esc).join("; ")}</div>` : "")
    + `</div>`;
}

const STYLE = `
:root{--bg:#f4f6f9;--card:#fff;--ink:#17202e;--muted:#6b7686;--line:#e3e7ee;--good:#0e9f6e;--goodbg:#e6f6ef;--bad:#d93f3f;--badbg:#fdecec;--warn:#c27c0e;--warnbg:#fdf3e1;--accent:#2f5bea;}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);font-family:"Be Vietnam Pro","Inter",-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;color:var(--ink);width:${WIDTH}px;padding:24px;font-size:19px;-webkit-font-smoothing:antialiased}
.head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px}
.title{font-size:34px;font-weight:700;letter-spacing:-.3px}
.title span{color:var(--accent)}
.meta{color:var(--muted);margin-top:4px}
.legend{color:var(--muted);font-size:16px;text-align:right;line-height:1.7}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.kpi{background:var(--card);border-radius:12px;padding:14px 16px;border:1px solid var(--line)}
.kname{color:var(--muted);font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.kval{font-size:36px;font-weight:700;margin:4px 0 8px;font-variant-numeric:tabular-nums}
.krow{display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-top:3px}
.klab{color:var(--muted)}
.teams{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:12px;margin-bottom:16px}
.team{background:var(--card);border-radius:12px;padding:12px 16px;border:1px solid var(--line);border-left:5px solid var(--muted)}
.team.good{border-left-color:var(--good)}.team.bad{border-left-color:var(--bad)}.team.flat{border-left-color:#9aa5b5}
.tname{font-weight:700;font-size:20px}
.tprofit{font-size:30px;font-weight:700;margin:4px 0;font-variant-numeric:tabular-nums}
.tline{font-size:16px;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.card{background:var(--card);border-radius:12px;border:1px solid var(--line);overflow:hidden;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{background:#f8f9fb;color:var(--muted);font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.3px;padding:10px 8px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child{text-align:left}
td{padding:10px 8px;text-align:right;border-bottom:1px solid var(--line);vertical-align:middle}
td.name{text-align:left;font-weight:600;white-space:nowrap}
td.total{color:var(--muted);font-weight:700}
tr.trow td{background:#fafbfc}
tr.group td{background:#eef2fb;text-align:left;font-weight:700;font-size:18px;padding:10px 8px}
tr.group .gsub{font-weight:500;color:var(--muted);margin-left:8px}
.v{font-weight:600}.v.neg{color:var(--bad)}
.sub{margin-top:2px}
.d{font-size:15px;font-weight:600;white-space:nowrap}
.d.good{color:var(--good)}.d.bad{color:var(--bad)}.d.flat{color:var(--muted)}
.dot{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;background:#9aa5b5}
.dot.good{background:var(--good)}.dot.bad{background:var(--bad)}
.tag{display:inline-block;font-size:13px;font-weight:600;padding:1px 6px;border-radius:6px;margin-left:6px;vertical-align:1px}
.tag.new{background:#e8eefc;color:var(--accent)}.tag.bad{background:var(--badbg);color:var(--bad)}
.missing{text-align:left;color:var(--warn);font-style:italic}
.trend .spark{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.trend .spark .d{min-width:52px;text-align:right}
.cols{display:grid;grid-template-columns:1fr;gap:12px}
.box{background:var(--card);border-radius:12px;border:1px solid var(--line);padding:14px 16px}
.box h3{font-size:21px;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.box h3 .n{background:var(--badbg);color:var(--bad);border-radius:10px;padding:0 10px;font-size:16px}
.box h3 .n.g{background:var(--goodbg);color:var(--good)}
.act{border-left:4px solid var(--muted);padding:6px 0 6px 10px;margin-bottom:10px}
.act.bad{border-left-color:var(--bad)}.act.warn{border-left-color:var(--warn)}.act.good{border-left-color:var(--good)}
.ahead{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.who{font-size:15px;color:var(--muted);background:#f0f2f5;border-radius:6px;padding:0 6px}
.aval{color:var(--muted);font-size:17px;margin-left:4px}
.afacts{color:var(--muted);font-size:16px;margin-top:3px}
.ado{font-size:17px;font-weight:600;margin-top:3px}
.empty{color:var(--muted)}
.note{color:var(--muted);font-size:15px;margin-top:12px;line-height:1.6}
.note b{color:var(--warn)}
`;

/**
 * HTML 1 trang: KPI tổng → Profit theo team → bảng mọi kênh theo team → cần action / điểm sáng.
 * `inputs` là chuỗi ngày gốc của từng kênh (cần để so với hôm qua và vẽ xu hướng).
 */
export function buildDailyReportHtml(
  a: DailyReportAnalysis,
  inputs: ChannelSeriesInput[],
  options: DailyReportCardOptions = {},
): string {
  const date = a.date;
  const rowsByLabel = new Map(inputs.map((i) => [i.label, buildRow(i.label, i.isNew, i.days, date)]));
  const company = buildRow("Tổng", false, sumSeries(inputs.map((i) => i.days)), date);
  const c = company.today;
  const cy = company.yesterday ?? undefined;
  const cb = company.avg7 ?? undefined;

  const kpis = [
    kpiTile("Revenue", money2(c.revenue), dPct(c.revenue, cy?.revenue), dPct(c.revenue, cb?.revenue)),
    kpiTile("Profit", money2(c.profit), dUsd(c.profit, cy?.profit), dUsd(c.profit, cb?.profit)),
    kpiTile("Margin", pct(c.margin), cy ? dPts(c.margin, cy.margin, true) : "", cb ? dPts(c.margin, cb.margin, true) : ""),
    kpiTile("ACoS", c.revenueAds > 0 ? pct(c.acos) : "—", cy && cy.revenueAds > 0 ? dPts(c.acos, cy.acos, false) : "", cb && cb.revenueAds > 0 ? dPts(c.acos, cb.acos, false) : ""),
    kpiTile("TACoS", pct(c.tacos), cy ? dPts(c.tacos, cy.tacos, false) : "", cb ? dPts(c.tacos, cb.tacos, false) : ""),
    kpiTile("Units", Math.round(c.quantity).toLocaleString("en-US"), dPct(c.quantity, cy?.quantity, 5), dPct(c.quantity, cb?.quantity, 5)),
  ].join("");

  const teamRows = a.teams.map((team) => {
    const row = buildRow(team.team, false, sumSeries(inputs.filter((i) => i.team === team.team).map((i) => i.days)), date);
    return { team, row, vs: vsAvg(row) };
  });

  const teamCards = teamRows.map(({ team, row, vs }) => {
    const y = row.yesterday ?? undefined;
    return `<div class="team ${vs.tone}"><div class="tname">${esc(teamLabel(team.team, options.teamLeads))}</div>`
      + `<div class="tprofit">${money2(row.today.profit)}</div>`
      + `<div class="tline">hôm qua ${dUsd(row.today.profit, y?.profit) || "—"}</div>`
      + `<div class="tline">TB 7 ngày <span class="d ${vs.tone}">${vs.text}</span> · margin ${row.today.revenue > 0 ? pct(row.today.margin) : "—"}</div></div>`;
  }).join("");

  const tableBody = teamRows.map(({ team, row }) => {
    const channelRows = team.channels.map((ch) => rowsByLabel.get(ch.label)).filter((r): r is Row => Boolean(r));
    const missing = channelRows.filter((r) => r.missingSince).length;
    return `<tr class="group"><td colspan="8">${esc(teamLabel(team.team, options.teamLeads))}<span class="gsub">${team.channels.length} kênh${missing ? ` · ${missing} chưa có số` : ""}</span></td></tr>`
      + channelRows.map((r) => rowCells(r, false)).join("")
      + (channelRows.length > 1 ? rowCells(row, true) : "");
  }).join("");

  const lead = (team: string) => options.teamLeads?.[team]?.trim();
  const priorities = a.priorities.length
    ? a.priorities.map((ch) => actionItem(ch, rowsByLabel.get(ch.label), lead(ch.team))).join("")
    : `<div class="empty">Không có vấn đề cần xử lý.</div>`;
  const opportunities = a.opportunities.length
    ? a.opportunities.map((ch) => actionItem(ch, rowsByLabel.get(ch.label), lead(ch.team))).join("")
    : `<div class="empty">Chưa có kênh tăng nổi bật.</div>`;

  const missingNew = [...rowsByLabel.values()].filter((r) => r.missingSince);
  const notes = [
    ...a.warnings.map((w) => `<b>Dữ liệu:</b> ${esc(w)}`),
    ...(missingNew.length
      ? [`<b>Chưa có số ngày ${displayDate(date)}:</b> ${missingNew.map((r) => `${esc(r.label)} (số gần nhất ${displayDate(r.missingSince!)})`).join(", ")}.`]
      : []),
    "Xu hướng = Profit 8 ngày gần nhất, chấm cuối xanh/đỏ = tăng/giảm so hôm qua, % = Profit so TB 7 ngày. Kênh mới (&lt; 30 ngày) không đưa vào mục cần action.",
  ];

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<div class="head"><div><div class="title">Báo cáo kinh doanh · <span>${displayDate(date)}</span></div>
<div class="meta">${a.company.storeCount} store · ${a.company.channelCount} kênh · ${a.teams.length} team · so với hôm qua và TB 7 ngày trước</div></div>
<div class="legend"><span class="d good">xanh = tốt</span> · <span class="d bad">đỏ = xấu</span> · ACoS / TACoS giảm là tốt<br>đ = điểm %</div></div>
<div class="kpis">${kpis}</div>
<div class="teams" style="--n:${Math.max(teamRows.length, 1)}">${teamCards}</div>
<div class="card"><table><thead><tr><th>Kênh</th><th>Revenue</th><th>Units</th><th>Profit</th><th>Margin</th><th>ACoS</th><th>TACoS</th><th>8 ngày · vs TB7</th></tr></thead>
<tbody>${tableBody}</tbody></table></div>
<div class="cols"><div class="box"><h3>Cần action hôm nay <span class="n">${a.priorities.length}</span></h3>${priorities}</div>
<div class="box"><h3>Điểm sáng <span class="n g">${a.opportunities.length}</span></h3>${opportunities}</div></div>
<div class="note">${notes.join("<br>")}</div>
</body></html>`;
}

function chromiumPath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  return candidates.find((p): p is string => Boolean(p && existsSync(p)));
}

/** Chụp HTML thành PNG (2x cho nét trên điện thoại). */
export async function renderHtmlToPng(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 }, deviceScaleFactor: 2 });
    // Font web tải chậm / lỗi mạng thì vẫn chụp bằng font hệ thống
    await page.setContent(html, { waitUntil: "networkidle", timeout: 15_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    return await page.screenshot({ fullPage: true, type: "png" });
  } finally {
    await browser.close();
  }
}
