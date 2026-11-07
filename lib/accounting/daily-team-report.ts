// Báo cáo kinh doanh ngày gửi tự động qua Lark (thuần, không truy cập DB).
//
// Bố cục (so với hôm qua và cùng ngày tháng trước):
//   ⚠️ store thiếu dữ liệu
//   🏢 bảng 4 chỉ số + dòng Vận hành / Quảng cáo
//   🔵 mỗi team 1 bảng, mỗi hàng 1 store team quản lý (theo cột Team ở trang Stores;
//      store không có số ghi "không có dữ liệu"). Mục team viết bằng markdown vì card Lark giới hạn số bảng.
//   📋 điểm cần chú ý (tối đa 6; store kéo giảm kèm action dựng ở daily-report-diagnosis)

import { summarizeDays, type DashboardTotals } from "./dashboard-totals";
import { shiftIsoDate, usd, type ChannelSeriesInput } from "./daily-report-analysis";
import { parseStoreTeams } from "./store-teams";

export interface TeamReportOptions {
  /** Tên trưởng team theo mã team ("FBA 1" -> "Quỳnh"). */
  teamLeads?: Record<string, string>;
  /** Cảnh báo dữ liệu (vd store chưa có số Ads), hiện nhỏ cuối card. */
  warnings?: string[];
  /** Store không có đơn tới ngày báo cáo: chưa tính vào số, báo thiếu ở đầu card. */
  missingStores?: Array<{ name: string; team: string | null; lastDate: string }>;
  /** Store kéo giảm Profit so với hôm qua (markdown, đã kèm hành động); lấy tối đa 2. */
  alerts?: StoreAlert[];
}

interface Snapshot {
  today: DashboardTotals;
  yesterday: DashboardTotals;
  lastMonth: DashboardTotals;
}

export interface StoreAlert {
  storeName: string;
  team: string;
  text: string;
}

export interface TeamReportStore {
  name: string;
  /** null: store team quản lý nhưng không có số liệu. */
  data: Snapshot | null;
}

export interface TeamReportGroup extends Snapshot {
  name: string;
  /** Số store (không trùng) có số liệu trong nhóm; store vừa FBA vừa FBM tính 1. */
  storeCount: number;
  /** Store team quản lý (có số trước, kéo Profit nhiều nhất lên đầu; không có dữ liệu ở cuối). Tổng công ty để trống. */
  stores: TeamReportStore[];
}

/** Store và team quản lý, lấy từ cột Team ở trang Stores ("FBA 2 / FBM"). */
export interface StoreRosterItem {
  name: string;
  team: string | null;
}

export interface TeamReport {
  date: string;
  yesterdayDate: string;
  lastMonthDate: string;
  company: TeamReportGroup;
  teams: TeamReportGroup[];
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const MAX_ALERTS = 5;

/** Cùng ngày của tháng trước; tháng trước ngắn hơn thì lấy ngày cuối tháng (31/03 → 28/02). */
export function sameDayLastMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDayPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const prev = new Date(Date.UTC(y, m - 2, Math.min(d, lastDayPrev)));
  return prev.toISOString().slice(0, 10);
}

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const fullDate = (date: string) =>
  `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${ddmm(date)}/${date.slice(0, 4)}`;

/** FBA 1, FBA 2, … trước, FBM sau, rồi theo tên. */
function teamOrder(a: string, b: string): number {
  const rank = (t: string) => (/^fba/i.test(t) ? 0 : /^fbm/i.test(t) ? 1 : 2);
  return rank(a) - rank(b) || a.localeCompare(b, "vi", { numeric: true });
}

function snapshot(channels: ChannelSeriesInput[], dates: [string, string, string]): Snapshot {
  const on = (date: string) => summarizeDays(channels.flatMap((c) => c.days.filter((d) => d.date === date)));
  return { today: on(dates[0]), yesterday: on(dates[1]), lastMonth: on(dates[2]) };
}

const titleCase = (name: string) => name.trim().charAt(0).toUpperCase() + name.trim().slice(1).toLowerCase();
const storeKey = (name: string) => name.trim().toUpperCase();
const channelOfTeam = (team: string) => (/^fbm/i.test(team) ? "FBM" : "FBA");

/** Δ Profit so với hôm qua (0 khi hôm qua không có số). */
const profitMove = (s: Snapshot) => (s.yesterday.days ? s.today.profit - s.yesterday.profit : 0);

function group(name: string, channels: ChannelSeriesInput[], dates: [string, string, string], stores: TeamReportStore[] = []): TeamReportGroup {
  return { name, storeCount: new Set(channels.map((c) => c.storeName)).size, ...snapshot(channels, dates), stores };
}

/**
 * Gom theo team. `roster` (store + team ở trang Stores) bổ sung store team quản lý nhưng không có số liệu,
 * để mục team liệt kê đủ store với dòng "không có dữ liệu".
 */
export function buildTeamReport(date: string, channels: ChannelSeriesInput[], roster: StoreRosterItem[] = []): TeamReport {
  const dates: [string, string, string] = [date, shiftIsoDate(date, -1), sameDayLastMonth(date)];
  const byTeam = new Map<string, ChannelSeriesInput[]>();
  for (const c of channels) byTeam.set(c.team, [...(byTeam.get(c.team) ?? []), c]);

  const missing = new Map<string, string[]>();
  for (const store of roster) {
    for (const team of parseStoreTeams(store.team)) {
      const has = (byTeam.get(team) ?? []).some((c) => storeKey(c.storeName) === storeKey(store.name) && c.channel === channelOfTeam(team));
      if (!has) missing.set(team, [...(missing.get(team) ?? []), titleCase(store.name)]);
    }
  }

  const teamNames = [...new Set([...byTeam.keys(), ...missing.keys()])].sort(teamOrder);
  return {
    date,
    yesterdayDate: dates[1],
    lastMonthDate: dates[2],
    company: group("Tổng", channels, dates),
    teams: teamNames.map((team) => {
      const own = byTeam.get(team) ?? [];
      const stores: TeamReportStore[] = [
        ...own
          .map((c) => ({ name: titleCase(c.storeName), data: snapshot([c], dates) }))
          .sort((x, y) => Math.abs(profitMove(y.data)) - Math.abs(profitMove(x.data))),
        ...(missing.get(team) ?? []).sort().map((name) => ({ name, data: null })),
      ];
      return group(team, own, dates, stores);
    }),
  };
}

type Kind = "usd" | "count" | "ratio";
interface Metric {
  name: string;
  kind: Kind;
  /** true: tăng là tốt; false: giảm là tốt; null: không tô màu. */
  higherIsBetter: boolean | null;
  value: (t: DashboardTotals) => number;
  /** Tỉ lệ chỉ có nghĩa khi mẫu số > 0. */
  defined?: (t: DashboardTotals) => boolean;
}

const M = {
  revenue: { name: "Revenue", kind: "usd", higherIsBetter: true, value: (t) => t.revenue },
  profit: { name: "Profit", kind: "usd", higherIsBetter: true, value: (t) => t.profit },
  margin: { name: "Margin", kind: "ratio", higherIsBetter: true, value: (t) => t.margin, defined: (t) => t.revenue > 0 },
  acos: { name: "ACoS", kind: "ratio", higherIsBetter: false, value: (t) => t.acos, defined: (t) => t.revenueAds > 0 },
  tacos: { name: "TACoS", kind: "ratio", higherIsBetter: false, value: (t) => t.tacos, defined: (t) => t.revenue > 0 },
  orders: { name: "Orders", kind: "count", higherIsBetter: true, value: (t) => t.orders },
  units: { name: "Units", kind: "count", higherIsBetter: true, value: (t) => t.quantity },
  adsSpend: { name: "Ads", kind: "usd", higherIsBetter: null, value: (t) => t.adsFee },
  adsSales: { name: "Ads Sales", kind: "usd", higherIsBetter: true, value: (t) => t.revenueAds },
  refund: { name: "Refund", kind: "usd", higherIsBetter: false, value: (t) => t.returnCost },
} satisfies Record<string, Metric>;

const MAIN: Metric[] = [M.revenue, M.profit, M.margin, M.tacos];

function format(m: Metric, t: DashboardTotals): string {
  if (m.defined && !m.defined(t)) return "—";
  const v = m.value(t);
  if (m.kind === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (m.kind === "count") return Math.round(v).toLocaleString("en-US");
  return usd(v);
}

/** Δ so với mốc, dạng mũi tên: % cho số tiền/số lượng (Profit và mốc ≤ 0 dùng $), chênh lệch tỉ lệ (ghi bằng %) cho Margin/TACoS/ACoS. */
function delta(m: Metric, t: DashboardTotals, base: DashboardTotals): { text: string; tone: boolean | null } | null {
  if (base.days === 0) return null;
  if (m.defined && (!m.defined(t) || !m.defined(base))) return null;
  const cur = m.value(t);
  const prev = m.value(base);
  const arrow = (diff: number) => (diff > 0 ? "▲" : diff < 0 ? "▼" : "");
  const tone = (diff: number, noise: boolean) =>
    noise || m.higherIsBetter === null ? null : diff > 0 === m.higherIsBetter;
  if (m.kind === "ratio") {
    const pts = Math.round((cur - prev) * 1000) / 10;
    return { text: `${arrow(pts)}${Math.abs(pts).toFixed(1)}%`, tone: tone(pts, Math.abs(pts) < 0.5) };
  }
  if (m === M.profit || prev <= 0) {
    const diff = cur - prev;
    const abs = m.kind === "count" ? Math.round(Math.abs(diff)).toLocaleString("en-US") : usd(Math.abs(diff));
    return { text: `${arrow(diff)}${abs}`, tone: tone(diff, Math.abs(diff) < 1) };
  }
  const change = (cur - prev) / prev;
  const p = Math.abs(change * 100);
  return { text: `${arrow(change)}${p >= 10 ? Math.round(p) : p.toFixed(1)}%`, tone: tone(change, Math.abs(change) < 0.02) };
}

const font = (text: string, tone: boolean | null) =>
  `<font color='${tone === null ? "grey" : tone ? "green" : "red"}'>${text}</font>`;
const grey = (text: string) => font(text, null);

/** Δ so với 1 mốc, đã tô màu; "thiếu số" khi mốc không có dữ liệu. */
function deltaCell(m: Metric, t: DashboardTotals, base: DashboardTotals): string {
  if (base.days === 0) return grey("không có dữ liệu");
  const d = delta(m, t, base);
  return d ? font(d.text, d.tone) : grey("—");
}

function teamTitle(g: TeamReportGroup, leads?: Record<string, string>, upper = false): string {
  const lead = leads?.[g.name]?.trim();
  return `${upper ? g.name.toUpperCase() : g.name}${lead ? ` · ${lead}` : ""}`;
}

/** Ô giá trị Profit tô xanh dương cho dễ nhìn; ô Δ vẫn giữ xanh lá / đỏ / xám (tốt / xấu / ít đổi). */
const valueCell = (m: Metric, t: DashboardTotals, bold = false) => {
  const text = bold ? `**${format(m, t)}**` : format(m, t);
  return m === M.profit ? `<font color='blue'>**${format(m, t)}**</font>` : text;
};

const TABLE_HEADER = { text_align: "left", text_size: "normal", background_style: "grey", bold: true, lines: 1 };
const col = (name: string, display: string, align: "left" | "right" = "right") =>
  ({ name, display_name: display, data_type: "lark_md", horizontal_align: align, width: "auto" });

/** Bảng so sánh: Chỉ số | ngày báo cáo | So với hôm qua | So với cùng ngày tháng trước. */
function compareTable(r: TeamReport, g: TeamReportGroup): Record<string, unknown> {
  return {
    tag: "table",
    page_size: MAIN.length,
    row_height: "low",
    header_style: TABLE_HEADER,
    columns: [col("metric", "Chỉ số", "left"), col("value", ddmm(r.date)), col("hq", "So với hôm qua"), col("tt", `So với ${ddmm(r.lastMonthDate)}`)],
    rows: MAIN.map((m) => ({
      metric: m === M.profit ? `<font color='blue'>**${m.name}**</font>` : m.name,
      value: valueCell(m, g.today, true),
      hq: deltaCell(m, g.today, g.yesterday),
      tt: deltaCell(m, g.today, g.lastMonth),
    })),
  };
}

const count = (v: number) => Math.round(v).toLocaleString("en-US");

/** 2 dòng phụ, nhãn tiếng Anh như tên cột: Orders / Units / Refund và Ads Spend / Ads Sales / ACoS. */
function opsLines(t: DashboardTotals): string {
  return [
    `**Orders** ${count(t.orders)} · **Units** ${count(t.quantity)} · **Refund** ${usd(t.returnCost)}`,
    `**Ads Spend** ${usd(t.adsFee)} · **Ads Sales** ${usd(t.revenueAds)} · **ACoS** ${format(M.acos, t)}`,
  ].join("\n");
}

const NO_DATA = grey("không có dữ liệu");

const profitValue = (m: Metric, t: DashboardTotals) =>
  m === M.profit ? `<font color='blue'>**${format(m, t)}**</font>` : `**${format(m, t)}**`;

/** 1 dòng chỉ số: "Revenue $5,734 — hôm qua ▲33% · tháng trước ▲40%". */
function metricLine(m: Metric, x: Snapshot): string {
  return `${m.name} ${profitValue(m, x.today)} ${grey("— hôm qua")} ${deltaCell(m, x.today, x.yesterday)} ${grey("· tháng trước")} ${deltaCell(m, x.today, x.lastMonth)}`;
}

/** Đủ chỉ số của 1 store: 4 chỉ số kèm so sánh, đơn hàng, quảng cáo. */
function storeBlock(st: TeamReportStore): string {
  if (!st.data || !st.data.today.days) return `▸ **${st.name}**: ${NO_DATA}`;
  return [`▸ **${st.name}**`, ...MAIN.map((m) => metricLine(m, st.data!)), opsLines(st.data.today)].join("\n");
}

/** Mục 1 team: tên team, rồi mổ xẻ từng store team quản lý (không có số liệu cấp team). */
function teamSection(g: TeamReportGroup, options: TeamReportOptions): Record<string, unknown> {
  const head = `🔵 **${teamTitle(g, options.teamLeads, true)}** ${grey(`· ${g.stores.length} store`)}`;
  return { tag: "markdown", content: [head, ...g.stores.map(storeBlock)].join("\n\n") };
}

/** Card Lark giới hạn số bảng (thử thực tế: 4 bảng gửi được, 6 bảng bị từ chối "card table number over limit"). */
const MAX_TABLES = 5;

/** Cột của bảng store: chỉ số chính + đơn hàng + chi Ads. */
const STORE_COLUMNS: Metric[] = [M.revenue, M.profit, M.margin, M.tacos, M.orders, M.adsSpend];

/** Ô bảng store: giá trị, dòng dưới là Δ hôm qua · Δ tháng trước. */
function storeCell(m: Metric, x: Snapshot): string {
  return `${profitValue(m, x.today)}\n${deltaCell(m, x.today, x.yesterday)} ${grey("·")} ${deltaCell(m, x.today, x.lastMonth)}`;
}

/** Bảng 1 team: mỗi hàng 1 store team quản lý; store không có số ghi "không có dữ liệu". */
function teamTable(g: TeamReportGroup): Record<string, unknown> {
  const label = (m: Metric) => (m === M.adsSpend ? "Ads Spend" : m.name);
  return {
    tag: "table",
    page_size: Math.min(Math.max(g.stores.length, 1), 10),
    row_height: "auto",
    header_style: TABLE_HEADER,
    columns: [col("store", "Store", "left"), ...STORE_COLUMNS.map((m) => col(m.name, label(m)))],
    rows: g.stores.map((st) => {
      const has = st.data && st.data.today.days;
      return {
        store: `**${st.name}**`,
        ...Object.fromEntries(STORE_COLUMNS.map((m, i) => [m.name, has ? storeCell(m, st.data!) : i === 0 ? NO_DATA : grey("—")])),
      };
    }),
  };
}

/** Đánh giá ngắn 1 nhóm theo Δ hôm qua. */
function verdict(g: Snapshot): { emoji: string; text: string } | null {
  const { today: t, yesterday: y } = g;
  if (!y.days) return null;
  const dp = t.profit - y.profit;
  const both = t.revenue > 0 && y.revenue > 0;
  const dTacos = both ? (t.tacos - y.tacos) * 100 : 0;
  const dMargin = both ? (t.margin - y.margin) * 100 : 0;
  const pts = (v: number) => `${Math.abs(v).toFixed(1)}%`;
  const parts = [`Profit ${dp >= 0 ? "tăng" : "giảm"} ${usd(Math.abs(dp))} so với hôm qua`];
  if (Math.abs(dMargin) >= 0.5) parts.push(`Margin ${dMargin > 0 ? "tăng" : "giảm"} ${pts(dMargin)}`);
  if (Math.abs(dTacos) >= 0.5) parts.push(`TACoS ${dTacos > 0 ? "tăng" : "giảm"} ${pts(dTacos)}`);
  if (dp >= 0) {
    const note = dTacos <= -0.5 ? " → Hiệu quả cải thiện" : dTacos >= 0.5 ? " → Chi Ads tăng nhanh hơn doanh thu, theo dõi TACoS" : "";
    return { emoji: "🟢", text: `${parts.join(", ")}${note}.` };
  }
  return { emoji: t.profit < 0 ? "🔴" : "🟠", text: `${parts.join(", ")}.` };
}

const MAX_POINTS = 6;

/** Refund đáng kể: ≥ $100 và tăng ≥ 50% so với mốc. */
function refundPoint(g: Snapshot): string | null {
  const t = g.today;
  const spike = (base: DashboardTotals) => base.days > 0 && t.returnCost >= 100 && t.returnCost >= base.returnCost * 1.5;
  const cmp = spike(g.lastMonth) ? { base: g.lastMonth, label: "cùng ngày tháng trước" } : spike(g.yesterday) ? { base: g.yesterday, label: "hôm qua" } : null;
  if (!cmp) return null;
  const change = cmp.base.returnCost > 0 ? `tăng ${Math.round((t.returnCost / cmp.base.returnCost - 1) * 100)}%` : `từ ${usd(0)}`;
  return `🟠 **Refund:** ${usd(t.returnCost)}, ${change} so với ${cmp.label} → Cần kiểm tra nguyên nhân (lý do trả hàng theo SKU).`;
}

/**
 * Điểm cần chú ý (tối đa 6), hiển thị: tổng công ty → store biến động mạnh → store kéo giảm (có action) → refund → thiếu dữ liệu.
 * Tổng công ty, store kéo giảm, refund, thiếu dữ liệu luôn có chỗ; store biến động lấp phần còn lại theo |Δ Profit|.
 */
function attentionPoints(r: TeamReport, options: TeamReportOptions): string[] {
  const company = verdict(r.company);
  const missing = options.missingStores ?? [];
  const refund = refundPoint(r.company);
  const alerts = (options.alerts ?? []).slice(0, 2);
  const fixed = (company ? 1 : 0) + alerts.length + (refund ? 1 : 0) + (missing.length ? 1 : 0);
  const alerted = new Set(alerts.map((a) => `${a.team}|${storeKey(a.storeName)}`));
  const movers = r.teams
    .flatMap((g) => g.stores.map((st) => ({ team: g.name, st })))
    .filter(({ team, st }) => st.data && verdict(st.data) && !alerted.has(`${team}|${storeKey(st.name)}`))
    .sort((a, b) => Math.abs(profitMove(b.st.data!)) - Math.abs(profitMove(a.st.data!)))
    .slice(0, Math.max(0, MAX_POINTS - fixed))
    .map(({ team, st }) => {
      const v = verdict(st.data!)!;
      return `${v.emoji} **${st.name}** (${team}): ${v.text}`;
    });
  return [
    ...(company ? [`${company.emoji} **Tổng công ty:** ${company.text}`] : []),
    ...movers,
    ...alerts.map((a) => a.text),
    ...(refund ? [refund] : []),
    ...(missing.length
      ? [`⚠️ **${missing.map((s) => s.name).join(" & ")}:** Thiếu dữ liệu từ ${ddmm(shiftIsoDate(missing[0].lastDate, 1))} → Cần cập nhật trước khi đánh giá toàn công ty.`]
      : []),
  ];
}

function missingLine(options: TeamReportOptions): string {
  const missing = options.missingStores ?? [];
  if (!missing.length) return "";
  const lastDates = [...new Set(missing.map((s) => ddmm(s.lastDate)))].join(", ");
  return `⚠️ **Thiếu dữ liệu ${missing.length} store:** ${missing.map((s) => s.name).join(", ")} (dữ liệu cuối ${lastDates}). Không tính vào tổng.`;
}

const LEGEND = [
  "▲ tăng · ▼ giảm. Revenue, Orders, Ads Spend: % thay đổi · Profit: chênh lệch $ · Margin, TACoS: chênh lệch tỉ lệ (21.0% → 21.6% ghi ▲0.6%).",
  "Xanh lá = tốt · đỏ = xấu · xám = gần như không đổi.",
  "Margin = Profit / Revenue · TACoS = chi Ads / tổng Revenue · ACoS = chi Ads / doanh thu từ Ads.",
].join("\n");

export function buildTeamReportCard(r: TeamReport, options: TeamReportOptions = {}): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  const missing = missingLine(options);
  if (missing) elements.push({ tag: "markdown", content: font(missing, false) });

  elements.push(
    { tag: "markdown", content: "🏢 **TỔNG CÔNG TY**" },
    compareTable(r, r.company),
    { tag: "markdown", content: opsLines(r.company.today) },
  );
  // Mỗi team 1 bảng (hàng = store); vượt giới hạn bảng của Lark thì các team còn lại viết dạng chữ
  r.teams.forEach((team, i) => {
    if (1 + i < MAX_TABLES) {
      elements.push(
        { tag: "hr" },
        { tag: "markdown", content: `🔵 **${teamTitle(team, options.teamLeads, true)}** ${grey(`· ${team.stores.length} store · mỗi ô: giá trị, dòng dưới so với hôm qua · so với tháng trước`)}` },
        teamTable(team),
      );
    } else {
      elements.push({ tag: "hr" }, teamSection(team, options));
    }
  });

  const points = attentionPoints(r, options);
  if (points.length) elements.push({ tag: "hr" }, { tag: "markdown", content: ["📋 **ĐIỂM CẦN CHÚ Ý**", ...points].join("\n\n") });

  const notes = [...(options.warnings ?? []).map((w) => `⚠️ ${w}`), LEGEND];
  elements.push({ tag: "hr" }, { tag: "markdown", text_size: "notation", content: grey(notes.join("\n")) });
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `📊 BÁO CÁO KINH DOANH · ${ddmm(r.date)}/${r.date.slice(0, 4)}` },
      subtitle: {
        tag: "plain_text",
        content: `${r.company.storeCount} store · ${r.teams.length} team · so với hôm qua ${ddmm(r.yesterdayDate)} và cùng ngày tháng trước ${ddmm(r.lastMonthDate)}`,
      },
    },
    body: { elements },
  };
}

const strip = (text: string) => text.replace(/<\/?font[^>]*>/g, "").replace(/\*\*/g, "");

/** Bản text thuần (gửi khi card lỗi, và để xem trước). */
export function buildTeamReportText(r: TeamReport, options: TeamReportOptions = {}): string {
  const lines = [
    `📊 BÁO CÁO KINH DOANH · ${fullDate(r.date)}`,
    `${r.company.storeCount} store · ${r.teams.length} team · so với hôm qua ${ddmm(r.yesterdayDate)} và cùng ngày tháng trước ${ddmm(r.lastMonthDate)}`,
  ];
  const missing = missingLine(options);
  if (missing) lines.push("", strip(missing));
  lines.push("", "🏢 TỔNG CÔNG TY", ...MAIN.map((m) => `  ${strip(metricLine(m, r.company))}`));
  lines.push(...strip(opsLines(r.company.today)).split("\n").map((l) => `  ${l}`));
  for (const g of r.teams) lines.push("", ...strip(String(teamSection(g, options).content)).split("\n"));
  const points = attentionPoints(r, options);
  if (points.length) lines.push("", "📋 ĐIỂM CẦN CHÚ Ý", ...points.map((p) => `  ${strip(p)}`));
  if (options.warnings?.length) lines.push("", ...options.warnings.map((w) => `⚠️ ${w}`));
  return lines.join("\n");
}
