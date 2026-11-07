// Card Lark (schema 2.0) báo cáo kinh doanh hằng ngày — chỉ liệt kê chỉ số, không phân tích nguyên nhân.
// 3 cấp, cùng 1 bộ cột: Tổng quan (công ty + từng team) → mỗi team 1 bảng các store / kênh → ghi chú thiếu dữ liệu.
// Không gộp thành 1 bảng: bảng Lark tối đa 10 dòng / trang, quá thì bị phân trang.
// Cột xếp theo logic quy mô → kết quả → hiệu quả: Revenue, Units → Profit → Margin → ACoS, TACoS.
// Nguyên nhân + action: nhắn bot "phân tích <store>" (xem daily-report-diagnosis.ts).
//
// Phạm vi so sánh: chỉ các kênh có số hợp lệ ở cả hôm nay và hôm qua (xem comparableRows).

import { sumSeries, usd, type ChannelSeriesInput, type DailyReportAnalysis } from "./daily-report-analysis";
import { displayDate, teamLabel, type DailyReportCardOptions } from "./daily-report-card";
import { comparableRows } from "./daily-report-diagnosis";
import { buildRow, type Row } from "./daily-report-image";

export const ANALYSIS_COMMAND = "phân tích";

export interface DailyReportBriefOptions extends DailyReportCardOptions {
  /** Store ngừng cập nhật (không có trong `inputs`), cảnh báo ở đầu báo cáo. */
  staleStores?: Array<{ name: string; lastDate: string }>;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const arrow = (v: number) => (v >= 0 ? "▲" : "▼");
const grey = (text: string) => `<font color='grey'>${text}</font>`;

function colored(text: string, good: boolean | null): string {
  return `<font color='${good === null ? "grey" : good ? "green" : "red"}'>${text}</font>`;
}

/** Δ % so với hôm qua (Revenue). Mốc < $50 thì bỏ trống. */
function deltaPct(now: number, before: number | undefined): string {
  if (before == null || before < 50) return "";
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return colored("±0%", null);
  return colored(`${arrow(change)}${Math.abs(change * 100).toFixed(0)}%`, Math.abs(change) < 0.02 ? null : change > 0);
}

/** Δ $ so với hôm qua (Profit). */
function deltaUsd(now: number, before: number | undefined): string {
  if (before == null) return "";
  const d = now - before;
  if (Math.abs(d) < 5) return colored("±$0", null);
  return colored(`${arrow(d)}${usd(Math.abs(d))}`, d > 0);
}

const COLUMNS = [
  { name: "name", display_name: "", align: "left" },
  { name: "revenue", display_name: "Revenue", align: "right" },
  { name: "units", display_name: "Units", align: "right" },
  { name: "profit", display_name: "Profit", align: "right" },
  { name: "margin", display_name: "Margin", align: "right" },
  { name: "acos", display_name: "ACoS", align: "right" },
  { name: "tacos", display_name: "TACoS", align: "right" },
] as const;

/** Profit giảm mạnh: giảm ≥ 30% so với hôm qua và ≥ $50. */
const PROFIT_DROP_RATIO = 0.3;
const PROFIT_DROP_MIN_USD = 50;

function profitWarning(now: number, before: number | undefined): boolean {
  if (now < 0) return true;
  if (before == null || before <= 0) return false;
  const drop = before - now;
  return drop >= PROFIT_DROP_MIN_USD && drop >= before * PROFIT_DROP_RATIO;
}

/** 1 dòng bảng: giá trị, Δ so với hôm qua đặt ngay sau giá trị (Revenue %, Profit $). */
function tableRow(name: string, row: Row, bold = false): Record<string, string> {
  const t = row.today;
  const y = row.yesterday ?? undefined;
  const b = (s: string) => (bold ? `**${s}**` : s);
  // Profit đỏ = lỗ hoặc giảm mạnh so với hôm qua — cảnh báo duy nhất, không thêm biểu tượng.
  const profit = profitWarning(t.profit, y?.profit) ? colored(b(usd(t.profit)), false) : b(usd(t.profit));
  const hasRev = t.revenue > 0;
  return {
    name: b(name),
    revenue: `${b(usd(t.revenue))} ${deltaPct(t.revenue, y?.revenue)}`.trim(),
    units: b(Math.round(t.quantity).toLocaleString("en-US")),
    profit: `${profit} ${deltaUsd(t.profit, y?.profit)}`.trim(),
    margin: hasRev ? pct(t.margin) : "—",
    acos: t.revenueAds > 0 ? pct(t.acos) : "—",
    tacos: hasRev ? pct(t.tacos) : "—",
  };
}

function table(firstColumn: string, rows: Array<Record<string, string>>): Record<string, unknown> {
  return {
    tag: "table",
    page_size: Math.min(Math.max(rows.length, 1), 10),
    row_height: "low",
    freeze_first_column: true,
    header_style: { text_align: "right", text_size: "normal", background_style: "grey", bold: true, lines: 1 },
    columns: COLUMNS.map((c) => ({
      name: c.name,
      display_name: c.name === "name" ? firstColumn : c.display_name,
      data_type: "lark_md",
      horizontal_align: c.align,
      width: "auto",
    })),
    rows,
  };
}

/** Báo cáo kinh doanh hằng ngày (gửi tự động). */
export function buildDailyReportBrief(
  a: DailyReportAnalysis,
  inputs: ChannelSeriesInput[],
  options: DailyReportBriefOptions = {},
): Record<string, unknown> {
  const date = a.date;
  const { comparable, excluded } = comparableRows(inputs, date);
  const stale = options.staleStores ?? [];
  const elements: Array<Record<string, unknown>> = [];

  const missing = [...stale.map((s) => `${s.name} (chưa cập nhật từ ${displayDate(s.lastDate)})`), ...excluded];

  const teams = a.teams
    .map((team) => ({ team, members: comparable.filter((r) => r.input.team === team.team) }))
    .filter((t) => t.members.length);

  // Cấp 1–2: tổng công ty + từng team
  const company = buildRow("Tổng", false, sumSeries(comparable.map((r) => r.input.days)), date);
  elements.push({ tag: "markdown", content: "**🏢 Tổng quan**" });
  elements.push(table("Team", [
    ...teams.map(({ team, members }) =>
      tableRow(teamLabel(team.team, options.teamLeads), buildRow(team.team, false, sumSeries(members.map((r) => r.input.days)), date))),
    tableRow("Total", company, true),
  ]));

  // Cấp 3: mỗi team 1 bảng store / kênh, Revenue lớn trước
  for (const { team, members } of teams) {
    elements.push({ tag: "markdown", content: `**👥 ${teamLabel(team.team, options.teamLeads)}**` });
    elements.push(table("Store", [...members]
      .sort((p, q) => q.row.today.revenue - p.row.today.revenue)
      .map((r) => tableRow(`${r.input.label}${r.input.isNew ? " 🌱" : ""}`, r.row))));
  }

  // Ghi chú thiếu dữ liệu (cuối báo cáo; tiêu đề phụ đã báo "thiếu dữ liệu")
  if (missing.length) {
    elements.push({ tag: "markdown", content: `⚠️ **Thiếu dữ liệu, không tính vào tổng:** ${missing.join(" · ")}` });
  }

  elements.push({
    tag: "markdown",
    content: grey(`▲▼ = so với hôm qua (Revenue theo %, Profit theo $) · Profit đỏ = lỗ hoặc giảm ≥30% so với hôm qua · Margin = Profit / Revenue · ACoS = Ads / Ads Sales · TACoS = Ads / Revenue · Nhắn bot "${ANALYSIS_COMMAND} <tên store>" để xem nguyên nhân`),
    text_size: "notation",
  });

  const scopeStores = new Set(comparable.map((r) => r.input.storeName)).size;
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `📊 Báo cáo kinh doanh · ${displayDate(date)}` },
      subtitle: { tag: "plain_text", content: `${scopeStores} store · ${comparable.length} kênh · so với hôm qua${missing.length ? " · thiếu dữ liệu" : ""}` },
    },
    body: { elements },
  };
}
