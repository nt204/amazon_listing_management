import { getDatabaseClient } from "@/lib/db";
import { getWeeklyReport, type WeeklyBrandRow, type WeeklyReport, type WeeklyMetrics } from "@/lib/accounting/weekly-report";
import { daysInMonthOf, weekSegmentOf, previousWeekSegment, type WeekSegment } from "@/lib/accounting/weekly-report-periods";
import { kpiRatio, kpiTone } from "@/lib/accounting/kpi-progress";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";

interface PaceContext {
  dim: number;
  day: number;
  weekElapsed: number;
  weekDays: number;
}

interface Achieve {
  actual: number;
  due: number;
  full: number;
  ratio: number | null;
  fullRatio: number | null;
}

interface MetricProgress {
  week: Achieve;
  month: Achieve;
}

interface GroupSummary {
  cur: WeeklyMetrics;
  prev: WeeklyMetrics;
  mtd: WeeklyMetrics;
  rows: number;
  targetedRows: number;
  revenue: MetricProgress | null;
  profit: MetricProgress | null;
}


const ZERO: WeeklyMetrics = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };
const add = (a: WeeklyMetrics, b: WeeklyMetrics): WeeklyMetrics => ({
  revenue: a.revenue + b.revenue,
  quantity: a.quantity + b.quantity,
  adsFee: a.adsFee + b.adsFee,
  profit: a.profit + b.profit,
  basecost: a.basecost + b.basecost,
});

function periodOf(actual: number, target: number, elapsed: number, total: number): Achieve {
  const e = Math.max(1, Math.min(elapsed, total));
  const due = (target * e) / total;
  return {
    actual,
    due,
    full: target,
    ratio: kpiRatio(actual, due),
    fullRatio: kpiRatio(actual, target),
  };
}

function summarize(rows: WeeklyBrandRow[], ctx: PaceContext): GroupSummary {
  const sum = (pick: (b: WeeklyBrandRow) => WeeklyMetrics) => rows.reduce((s, b) => add(s, pick(b)), ZERO);
  const targeted = rows.filter((b) => b.target);
  const cur = sum((b) => b.current);
  const mtd = sum((b) => b.mtd);
  const progress = (k: "revenue" | "profit"): MetricProgress | null => {
    if (!targeted.length) return null;
    const monthTarget = targeted.reduce((s, b) => s + b.target![k], 0);
    return {
      week: periodOf(cur[k], (monthTarget * ctx.weekDays) / ctx.dim, ctx.weekElapsed, ctx.weekDays),
      month: periodOf(mtd[k], monthTarget, ctx.day, ctx.dim),
    };
  };
  return {
    cur,
    prev: sum((b) => b.previous),
    mtd,
    rows: rows.length,
    targetedRows: targeted.length,
    revenue: progress("revenue"),
    profit: progress("profit"),
  };
}

const sumTarget = (a: WeeklyBrandRow["target"], b: WeeklyBrandRow["target"]): WeeklyBrandRow["target"] =>
  a || b
    ? {
        revenue: (a?.revenue ?? 0) + (b?.revenue ?? 0),
        profit: (a?.profit ?? 0) + (b?.profit ?? 0),
        quantity: (a?.quantity ?? 0) + (b?.quantity ?? 0),
      }
    : null;

function brandOfGroup(b: WeeklyBrandRow, g: "all" | "win" | "test"): WeeklyBrandRow {
  if (g === "win") return b;
  const t = b.test ?? { current: ZERO, previous: ZERO, mtd: ZERO, target: null };
  if (g === "test") return { ...b, current: t.current, previous: t.previous, mtd: t.mtd, target: t.target };
  return {
    ...b,
    current: add(b.current, t.current),
    previous: add(b.previous, t.previous),
    mtd: add(b.mtd, t.mtd),
    target: sumTarget(b.target, t.target),
  };
}

// Formatters
const fmtUsd = (v: number | null | undefined, digits = 0) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 ? `-$${s}` : `$${s}`;
};

const fmtInt = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");

const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

const div = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null && Math.abs(b) > 1e-9 ? a / b : null;


const green = (text: string) => `<font color='green'>${text}</font>`;
const red = (text: string) => `<font color='red'>${text}</font>`;
const orange = (text: string) => `<font color='orange'>${text}</font>`;
const grey = (text: string) => `<font color='grey'>${text}</font>`;

function fmtPaceTone(pace: number | null): string {
  if (pace == null || !Number.isFinite(pace)) return grey("—");
  const s = `${pace.toFixed(1)}%`;
  if (pace >= 100) return green(s);
  if (pace >= 85) return orange(s);
  return red(s);
}

/** Tính ngày Thứ Bảy đã trôi qua gần nhất */
export function getPreviousCompletedSaturday(fromIso?: string): string {
  const d = fromIso ? new Date(`${fromIso}T00:00:00Z`) : new Date();
  const day = d.getUTCDay(); // 0: Sun, 1: Mon, ..., 6: Sat
  const daysToSubtract = day === 6 ? 7 : day + 1;
  const targetTime = d.getTime() - daysToSubtract * 86_400_000;
  const targetDate = new Date(targetTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetDate.getUTCFullYear()}-${pad(targetDate.getUTCMonth() + 1)}-${pad(targetDate.getUTCDate())}`;
}

const TABLE_HEADER = {
  background_style: "grey",
  bold: true,
  lines: 1,
};

function col(name: string, displayName: string, align: "left" | "right" = "right") {
  return {
    name,
    display_name: displayName,
    data_type: "lark_md",
    horizontal_align: align,
    width: "auto",
  };
}

// Cấu hình Teams & Store khớp chuẩn hệ thống
const TEAMS_CONFIG = [
  {
    id: "FBA 1", // khoá webhook nhóm team ở app_settings daily_report_team_webhooks
    name: "Team 1",
    teamTag: "FBA TEAM 1",
    lead: "Quỳnh",
    stores: [
      { name: "BOZSPACER", label: "Bozspacer", channel: "FBA" },
      { name: "WARMSTOREY", label: "Warmstorey", channel: "FBA" },
    ],
  },
  {
    id: "FBA 2", // khoá webhook nhóm team ở app_settings daily_report_team_webhooks
    name: "Team 2",
    teamTag: "FBA TEAM 2",
    lead: "Trường",
    stores: [
      { name: "LIMIMA", label: "Limima", channel: "FBA" },
      { name: "FASTPEACE", label: "Fastpeace-FBA", channel: "FBA" },
      { name: "EVERPHANT", label: "Everphant-FBA", channel: "FBA" },
    ],
  },
  {
    id: "FBA 3", // khoá webhook nhóm team ở app_settings daily_report_team_webhooks
    name: "Team 3",
    teamTag: "FBA TEAM 3",
    lead: "Loan",
    stores: [
      { name: "MALFIRST", label: "Malfirst", channel: "FBA" },
      { name: "EKASPEEK", label: "Ekaspeek-FBA", channel: "FBA" },
    ],
  },
  {
    id: "FBM", // khoá webhook nhóm team ở app_settings daily_report_team_webhooks
    name: "Team FBM",
    teamTag: "FBM",
    lead: "Đức",
    stores: [
      { name: "FASTPEACE", label: "Fastpeace-FBM", channel: "FBM" },
      { name: "EVERPHANT", label: "Everphant-FBM", channel: "FBM" },
      { name: "EKASPEEK", label: "Ekaspeek-FBM", channel: "FBM" },
    ],
  },
];

export async function generateWeeklyKpiReport(targetDate?: string) {
  const date = targetDate || getPreviousCompletedSaturday();
  const report = await getWeeklyReport({
    date,
    canViewPayout: true,
    canEditPrepaid: true,
  });

  const { week, brands } = report;
  const dim = daysInMonthOf(week.startDate);
  const endDay = Number(report.dataThrough.slice(8, 10));

  const ctx: PaceContext = {
    dim,
    day: endDay,
    weekElapsed: Math.max(1, report.days || 1),
    weekDays: week.days || 7,
  };

  // Dữ liệu SKU ALL (Win + Test)
  const allBrands = brands.map((b) => brandOfGroup(b, "all"));

  // --- DỰNG LARK CARD ---
  const elements: any[] = [];

  // 1. BẢNG TỔNG QUAN + tiến độ dùng chung cho bảng team:
  //  - Target Tuần / % Đạt Tuần (bảng team) = lũy kế 1→hết tuần ÷ (Target tháng × ngày ÷ số ngày tháng)
  //  - % Đạt Tháng = lũy kế ÷ Target cả tháng
  const fullPct = (mtd: number, monthTarget: number) => (monthTarget > 0 ? (mtd / monthTarget) * 100 : null);

  // Bảng Tổng quan (Win + Test, như bảng Team/Brand chế độ All trên Web): Tuần này | Lũy kế tuần (1→hết tuần) | Mục tiêu tháng |
  // % đạt tháng (lũy kế ÷ mục tiêu cả tháng) | Còn lại tháng (mục tiêu − lũy kế, giá trị).
  const totalAll = summarize(allBrands, ctx);
  const allRevTarget = totalAll.revenue?.month.full ?? 0;
  const allProTarget = totalAll.profit?.month.full ?? 0;
  const allQtyTarget = allBrands.reduce((acc, b) => acc + (b.target?.quantity ?? 0), 0);
  const cur = totalAll.cur;
  const mtdW = totalAll.mtd;
  const remain = (target: number, mtd: number, fmt: (v: number) => string) => {
    if (target <= 0) return "—";
    const left = target - mtd;
    return left > 0 ? fmt(left) : green(`Đã vượt ${fmt(-left)}`);
  };
  const usd0 = (v: number) => fmtUsd(v);
  // Tiến độ KPI của card team: Revenue / Units / Profit, lũy kế 1 → hết tuần so với Target cả tháng
  type KpiMetric = "revenue" | "quantity" | "profit";
  const KPI_METRICS: { key: KpiMetric; label: string; fmt: (v: number) => string }[] = [
    { key: "revenue", label: "Rev", fmt: usd0 },
    { key: "quantity", label: "Units", fmt: (v) => fmtInt(v) },
    { key: "profit", label: "Profit", fmt: usd0 },
  ];
  /** 1 dòng bảng Tiến độ KPI: mỗi chỉ số "lũy kế / Target tháng" + "% đạt tháng" (store không có target → "—") */
  const kpiRow = (name: string, mtd: Record<KpiMetric, number>, target: Partial<Record<KpiMetric, number>> | null, bold = false) => {
    const b = (t: string) => (bold && t !== "—" ? `**${t}**` : t);
    const row: Record<string, string> = { channel: b(name) };
    for (const m of KPI_METRICS) {
      const v = mtd[m.key];
      const t = target?.[m.key] ?? 0;
      const actual = v >= 0 ? m.fmt(v) : red(m.fmt(v));
      row[`${m.key}Mtd`] = b(t > 0 ? `${actual} / ${m.fmt(t)}` : actual);
      row[`${m.key}Pace`] = t > 0 ? b(fmtPaceTone(fullPct(v, t))) : "—";
    }
    return row;
  };
  const targetMargin = div(allProTarget, allRevTarget);
  const overviewRows = [
    {
      metric: "**Revenue**",
      week: `**${fmtUsd(cur.revenue)}**`,
      mtd: fmtUsd(mtdW.revenue),
      target: allRevTarget > 0 ? fmtUsd(allRevTarget) : "—",
      pace: fmtPaceTone(fullPct(mtdW.revenue, allRevTarget)),
      remain: remain(allRevTarget, mtdW.revenue, usd0),
    },
    {
      metric: "**Profit**",
      week: `**${fmtUsd(cur.profit)}**`,
      mtd: fmtUsd(mtdW.profit),
      target: allProTarget > 0 ? fmtUsd(allProTarget) : "—",
      pace: fmtPaceTone(fullPct(mtdW.profit, allProTarget)),
      remain: remain(allProTarget, mtdW.profit, usd0),
    },
    {
      metric: "**Units**",
      week: `**${fmtInt(cur.quantity)}**`,
      mtd: fmtInt(mtdW.quantity),
      target: allQtyTarget > 0 ? fmtInt(allQtyTarget) : "—",
      pace: fmtPaceTone(fullPct(mtdW.quantity, allQtyTarget)),
      remain: remain(allQtyTarget, mtdW.quantity, (v) => fmtInt(v)),
    },
    {
      metric: "**Margin**",
      week: fmtPct(div(cur.profit, cur.revenue)),
      mtd: fmtPct(div(mtdW.profit, mtdW.revenue)),
      target: fmtPct(targetMargin),
      pace: "—",
      remain: "—",
    },
    {
      metric: "**TACoS**",
      week: fmtPct(div(cur.adsFee, cur.revenue)),
      mtd: fmtPct(div(mtdW.adsFee, mtdW.revenue)),
      target: "—",
      pace: "—",
      remain: "—",
    },
  ];

  elements.push(
    {
      tag: "markdown",
      content: `### 📌 TỔNG QUAN HIỆU QUẢ KINH DOANH TUẦN (Win + Test)`,
    },
    {
      tag: "table",
      page_size: 5,
      row_height: "low",
      header_style: TABLE_HEADER,
      columns: [
        col("metric", "Chỉ số", "left"),
        col("week", "Tuần này"),
        col("mtd", "Lũy kế tuần"),
        col("target", "Mục tiêu tháng"),
        col("pace", "% Đạt tháng"),
        col("remain", "Còn lại tháng"),
      ],
      rows: overviewRows,
    }
  );

  // 2. Thẻ Đánh giá tuần (ĐÃ BỎ chú thích Cập nhật bởi Admin)
  if (report.note?.text?.trim()) {
    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: `### 📝 ĐÁNH GIÁ TUẦN\n> ${report.note.text.trim()}`,
      }
    );
  }

  // 3. TÁCH RIÊNG TỪNG TEAM & STORE (GẮN CHẶT VỚI KPI)
  // Mỗi team còn có 1 card riêng (teamCards) để gửi vào nhóm Lark của team
  const teamCards: Array<{ teamId: string; teamName: string; card: Record<string, any> }> = [];
  for (const team of TEAMS_CONFIG) {
    const teamStoreRows: any[] = [];
    // Bảng 2 — Tiến độ KPI: 1 bảng, mỗi store 1 dòng, mỗi chỉ số (Revenue / Units / Profit) 1 cặp cột
    const kpiRows: any[] = [];
    let teamCurTotal = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };
    let teamMtd = { ...ZERO };
    const teamTarget: Record<KpiMetric, number> = { revenue: 0, quantity: 0, profit: 0 };

    for (const stDef of team.stores) {
      const b = allBrands.find(
        (x) => x.storeName.toUpperCase() === stDef.name && x.channel.toUpperCase() === stDef.channel
      );
      const cur = b?.current || ZERO;
      const mtd = b?.mtd || ZERO;

      teamCurTotal = add(teamCurTotal, cur);
      teamMtd = add(teamMtd, mtd);

      const hasData = cur.revenue > 0 || cur.quantity > 0 || cur.profit !== 0;
      const margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
      const tacos = cur.revenue > 0 ? (cur.adsFee / cur.revenue) * 100 : 0;

      const displayName = stDef.label;

      // Bảng 1 — Hiệu suất kinh doanh tuần
      teamStoreRows.push({
        channel: hasData ? displayName : `${displayName} (—)`,
        revenue: hasData ? fmtUsd(cur.revenue) : "—",
        profit: hasData ? (cur.profit >= 0 ? fmtUsd(cur.profit) : red(fmtUsd(cur.profit))) : "—",
        units: hasData ? fmtInt(cur.quantity) : "—",
        spend: hasData ? fmtUsd(cur.adsFee) : "—",
        margin: hasData ? fmtPct(margin / 100) : "—",
        tacos: hasData ? fmtPct(tacos / 100) : "—",
      });
      // Bảng 2 — Tiến độ KPI (lũy kế từ đầu tháng tới hết tuần so với Target cả tháng)
      for (const m of KPI_METRICS) teamTarget[m.key] += b?.target?.[m.key] ?? 0;
      kpiRows.push(kpiRow(displayName, mtd, b?.target ?? null));

    }

    // Thêm dòng TỔNG của Team vào cuối bảng team
    const teamMargin = teamCurTotal.revenue > 0 ? (teamCurTotal.profit / teamCurTotal.revenue) * 100 : 0;
    const teamTacos = teamCurTotal.revenue > 0 ? (teamCurTotal.adsFee / teamCurTotal.revenue) * 100 : 0;

    teamStoreRows.push({
      channel: `**Tổng ${team.name}**`,
      revenue: `**${fmtUsd(teamCurTotal.revenue)}**`,
      profit: `**${fmtUsd(teamCurTotal.profit)}**`,
      units: `**${fmtInt(teamCurTotal.quantity)}**`,
      spend: `**${fmtUsd(teamCurTotal.adsFee)}**`,
      margin: `**${fmtPct(teamMargin / 100)}**`,
      tacos: `**${fmtPct(teamTacos / 100)}**`,
    });
    kpiRows.push(kpiRow(`Tổng ${team.name}`, teamMtd, teamTarget, true));

    const teamTable = {
        tag: "table",
        page_size: Math.min(teamStoreRows.length, 10),
        row_height: "low",
        header_style: TABLE_HEADER,
        columns: [
          col("channel", "Store", "left"),
          col("revenue", "Revenue"),
          col("profit", "Profit"),
          col("units", "Units"),
          col("spend", "Spend"),
          col("margin", "Margin"),
          col("tacos", "TACoS"),
        ],
        rows: teamStoreRows,
      };
    const teamKpiTable = {
      tag: "table",
      page_size: Math.min(kpiRows.length, 10),
      row_height: "low",
      header_style: TABLE_HEADER,
      columns: [
        col("channel", "Store", "left"),
        ...KPI_METRICS.flatMap((m) => [col(`${m.key}Mtd`, `${m.label} lũy kế / Target`), col(`${m.key}Pace`, `% ${m.label}`)]),
      ],
      rows: kpiRows,
    };


    // Card tổng chỉ gồm tổng quan + đánh giá; mỗi team 1 card riêng (Lark giới hạn số bảng trong 1 card)
    teamCards.push({
      teamId: team.id,
      teamName: team.name,
      card: {
        schema: "2.0",
        config: { width_mode: "fill" },
        header: {
          template: "orange",
          title: { tag: "plain_text", content: `📊 ${team.name.toUpperCase()} (${team.lead.toUpperCase()}) — BÁO CÁO ${week.label.toUpperCase()}` },
          subtitle: { tag: "plain_text", content: `Kỳ ${week.startDate} đến ${week.endDate} • Đã chốt số liệu` },
        },
        body: {
          elements: [
            { tag: "markdown", content: "**📈 1. Hiệu suất kinh doanh tuần**" },
            teamTable,
            { tag: "markdown", content: "**🎯 2. Tiến độ KPI tháng (lũy kế đến hết tuần / Target tháng)**" },
            teamKpiTable,
          ],
        },
      },
    });
  }

  const card = {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "orange",
      title: {
        tag: "plain_text",
        content: `📊 BÁO CÁO TUẦN KINH DOANH — ${week.label.toUpperCase()}`,
      },
      subtitle: {
        tag: "plain_text",
        content: `Kỳ ${week.startDate} đến ${week.endDate} • Đã chốt số liệu`,
      },
    },
    body: {
      elements,
    },
  };

  return { card, teamCards, week, report };
}

/** Webhook nhóm Lark của từng team — dùng chung cấu hình với Báo cáo KPI ngày. */
async function loadTeamWebhooks(): Promise<Record<string, string>> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ value: unknown }>>`
    SELECT value FROM app_settings WHERE key = 'daily_report_team_webhooks:default' LIMIT 1
  `;
  const raw = rows[0]?.value;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isPingLark = args.includes("--ping-lark");
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];

  console.log(`Đang lập báo cáo KPI tuần (mốc: ${dateArg || "Thứ 7 gần nhất"})...`);
  const { card, teamCards, week } = await generateWeeklyKpiReport(dateArg);

  if (isPingLark) {
    const webhookUrl = process.env.LARK_ACCOUNTING_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("Lỗi: Không tìm thấy webhook URL (LARK_ACCOUNTING_WEBHOOK_URL)!");
      process.exit(1);
    }
    // --team=<id hoặc tên> (vd --team="FBA 2" hoặc --team="Team 2"): chỉ gửi card của team đó vào nhóm tổng (xem thử)
    const teamArg = args.find((a) => a.startsWith("--team="))?.slice("--team=".length).trim().toLowerCase();
    if (teamArg) {
      const picked = teamCards.filter((t) => t.teamId.toLowerCase() === teamArg || t.teamName.toLowerCase() === teamArg);
      if (!picked.length) {
        console.error(`Không tìm thấy team "${teamArg}". Có: ${teamCards.map((t) => `${t.teamId} / ${t.teamName}`).join(", ")}`);
        process.exit(1);
      }
      for (const t of picked) {
        const res = await sendLarkWebhookNotification(webhookUrl, { card: t.card });
        console.log(res.sent ? `✅ Đã gửi card ${t.teamName} vào nhóm tổng` : `❌ Gửi ${t.teamName} lỗi: ${res.reason}`);
      }
      process.exit(0);
    }
    // --chi-tong-quan: chỉ gửi card Tổng quan vào nhóm tổng (không gửi card team, không gửi nhóm team)
    if (args.includes("--chi-tong-quan")) {
      const res = await sendLarkWebhookNotification(webhookUrl, { card });
      if (!res.sent) {
        console.error(`❌ Gửi Lark thất bại:`, res.reason);
        process.exit(1);
      }
      console.log(`✅ Đã gửi card Tổng quan tuần ${week.label} vào nhóm tổng`);
      process.exit(0);
    }
    // --chi-nhom-team: bỏ qua nhóm tổng, chỉ gửi vào nhóm từng team (gửi bù)
    if (!args.includes("--chi-nhom-team")) {
      console.log(`Đang gửi báo cáo tuần ${week.label} vào Lark webhook...`);
      const res = await sendLarkWebhookNotification(webhookUrl, { card });
      if (res.sent) {
        console.log(`✅ Đã gửi BÁO CÁO TUẦN VÀO LARK THÀNH CÔNG!`);
      } else {
        console.error(`❌ Gửi Lark thất bại:`, res.reason);
        process.exit(1);
      }
      // Nhóm tổng chỉ nhận card Tổng quan; card từng team chỉ gửi vào nhóm Lark của team đó (bên dưới)
    }
    // Nhóm Lark riêng của từng team: chỉ nhận card của team đó. Team lỗi không chặn team khác; lỗi báo vào nhóm tổng.
    // --chi-nhom-tong: chỉ gửi card Tổng quan vào nhóm tổng, không gửi nhóm team (xem thử)
    const teamWebhooks = args.includes("--chi-nhom-tong") ? {} : await loadTeamWebhooks();
    const failures: string[] = [];
    for (const t of teamCards) {
      const url = teamWebhooks[t.teamId];
      if (!url) {
        if (!args.includes("--chi-nhom-tong")) {
          console.warn(`⚠️ ${t.teamName} chưa có webhook nhóm team — không gửi card team`);
          failures.push(`${t.teamName}: chưa cấu hình webhook nhóm team`);
        }
        continue;
      }
      try {
        const res = await sendLarkWebhookNotification(url, { card: t.card });
        if (!res.sent) throw new Error(res.reason || "Lark từ chối");
        console.log(`✅ Đã gửi báo cáo tuần ${t.teamName} vào nhóm team`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`❌ Gửi báo cáo tuần ${t.teamName} vào nhóm team lỗi:`, reason);
        failures.push(`${t.teamName}: ${reason}`);
      }
    }
    if (failures.length) {
      await sendLarkWebhookNotification(webhookUrl, {
        text: `⚠️ Báo cáo tuần ${week.label}: gửi vào nhóm team lỗi — ${failures.join("; ")}`,
      }).catch(() => {});
    }
  } else {
    console.log("Xem trước Card tuần:");
    console.dir(card, { depth: 4 });
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Lỗi chạy script:", err);
    process.exit(1);
  });
}
