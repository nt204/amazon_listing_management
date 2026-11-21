import { getDatabaseClient } from "@/lib/db";
import { getWeeklyReport, type WeeklyBrandRow, type WeeklyReport, type WeeklyMetrics } from "@/lib/accounting/weekly-report";
import { daysInMonthOf, weekSegmentOf, previousWeekSegment, type WeekSegment } from "@/lib/accounting/weekly-report-periods";
import { kpiRatio, kpiTone } from "@/lib/accounting/kpi-progress";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";
import { loadChannelSkus, skuPanel, type TeamSkuRow } from "@/scripts/send-daily-kpi-report";

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

interface ServiceFeeItem {
  name: string;
  amount: number;
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
  a || b ? { revenue: (a?.revenue ?? 0) + (b?.revenue ?? 0), profit: (a?.profit ?? 0) + (b?.profit ?? 0) } : null;

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

const wow = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur != null && prev != null && Math.abs(prev) > 1e-9 ? (cur - prev) / Math.abs(prev) : null;

const green = (text: string) => `<font color='green'>${text}</font>`;
const red = (text: string) => `<font color='red'>${text}</font>`;
const orange = (text: string) => `<font color='orange'>${text}</font>`;
const grey = (text: string) => `<font color='grey'>${text}</font>`;

function fmtWow(cur: number, prev: number, isGoodWhenUp = true): string {
  const w = wow(cur, prev);
  if (w == null) return grey("—");
  const p = Math.abs(w * 100).toFixed(1);
  if (Math.abs(w) < 0.001) return grey("0.0%");
  if (w > 0) {
    return isGoodWhenUp ? green(`▲ +${p}%`) : red(`▲ +${p}%`);
  } else {
    return isGoodWhenUp ? red(`▼ -${p}%`) : green(`▼ -${p}%`);
  }
}

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

// Query khoản phí Service Fee trừ >= $1,000 trong tuần (đã loại phí ads)
async function loadLargeServiceFeesWeek(startDate: string, endDate: string): Promise<Map<string, ServiceFeeItem[]>> {
  const sql = await getDatabaseClient();
  const result = new Map<string, ServiceFeeItem[]>();
  try {
    const rows = await sql<Array<{
      store_id: string;
      product_details: string;
      total_amount: number;
    }>>`
      SELECT
        sf.store_id,
        COALESCE(NULLIF(TRIM(sf.product_details), ''), 'Service Fee') AS product_details,
        SUM(ABS(sf.total))::float AS total_amount
      FROM accounting_service_fees sf
      WHERE sf.date BETWEEN ${startDate}::date AND ${endDate}::date
        AND sf.total < 0
        AND LOWER(COALESCE(sf.product_details, '')) NOT LIKE '%advertising%'
        AND LOWER(COALESCE(sf.product_details, '')) NOT LIKE '%cost of ads%'
      GROUP BY sf.store_id, 2
      HAVING SUM(ABS(sf.total)) >= 1000
      ORDER BY total_amount DESC
    `;
    for (const r of rows) {
      if (!result.has(r.store_id)) result.set(r.store_id, []);
      result.get(r.store_id)!.push({
        name: r.product_details,
        amount: -r.total_amount,
      });
    }
  } catch (err) {
    console.error("[ServiceFee] Lỗi query service fee tuần:", err);
  }
  return result;
}

// Sinh nhận xét chi tiết cho từng store ở phạm vi tuần (GẮN VỚI KPI)
function generateWeeklyStoreComment(
  cur: WeeklyMetrics,
  prev: WeeklyMetrics,
  displayName: string,
  targetWeek: number,
  paceWeek: number | null,
  serviceFees: ServiceFeeItem[] = []
): string {
  // 0. Nếu không có dữ liệu
  if (cur.revenue === 0 && cur.quantity === 0 && cur.profit === 0) {
    return `🔹 **${displayName}:** Không có dữ liệu.`;
  }

  const dRevPct = prev.revenue > 0 ? ((cur.revenue - prev.revenue) / prev.revenue) * 100 : 0;
  const dProfitPct = prev.profit !== 0 ? ((cur.profit - prev.profit) / Math.abs(prev.profit)) * 100 : 0;
  const curTacos = cur.revenue > 0 ? (cur.adsFee / cur.revenue) * 100 : 0;
  const prevTacos = prev.revenue > 0 ? (prev.adsFee / prev.revenue) * 100 : 0;
  const dTacos = curTacos - prevTacos;
  const dAdsFeePct = prev.adsFee > 0 ? ((cur.adsFee - prev.adsFee) / prev.adsFee) * 100 : 0;
  const curMargin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;

  // Đoạn text KPI
  let kpiPrefix = "";
  if (targetWeek > 0 && paceWeek != null) {
    const paceStr = paceWeek.toFixed(1) + "%";
    const paceLabel = paceWeek >= 100 ? "vượt nhịp" : paceWeek >= 85 ? "sát nhịp" : "dưới nhịp";
    kpiPrefix = `Đạt **${paceStr} KPI tuần** (Profit ${fmtUsd(cur.profit)} / Target ${fmtUsd(targetWeek)}, ${paceLabel}). `;
  } else {
    kpiPrefix = `(Chưa có KPI) `;
  }

  let serviceFeeText = "";
  if (serviceFees.length > 0) {
    const feeLines = serviceFees.map((f) => `  ❗ **Service Fee:** ${f.name} ${fmtUsd(f.amount, 2)}`);
    serviceFeeText = `\n${feeLines.join("\n")}`;
  }

  const fullWarningText = serviceFeeText;

  // 1. Profit sụt giảm sâu (<= -20%)
  if (dProfitPct <= -20) {
    const causes: string[] = [];
    if (dTacos >= 3 || curTacos >= 25) {
      const spendClause = dAdsFeePct >= 10 ? ` do Spend +${dAdsFeePct.toFixed(0)}%` : "";
      causes.push(`TACoS tăng lên ${curTacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ)${spendClause}`);
    }
    if (dRevPct <= -15) {
      causes.push(`Units sụt giảm ${dRevPct.toFixed(1)}%`);
    }
    const revNote = Math.abs(dRevPct) < 10 ? "Revenue đi ngang" : `Revenue ${dRevPct > 0 ? "+" : ""}${dRevPct.toFixed(1)}%`;
    const causeStr = causes.length > 0 ? `, do ${causes.join(" và ")}` : "";
    return `🔹 **${displayName}:** ${kpiPrefix}Profit sụt ${dProfitPct.toFixed(1)}% (${revNote})${causeStr}.${fullWarningText}`;
  }

  // 2. Margin mỏng (<= 10%) dù revenue tăng mạnh
  if (curMargin <= 10 && dRevPct >= 20) {
    const issues: string[] = [];
    if (dTacos >= 3 || curTacos >= 25) {
      const spendClause = dAdsFeePct > 0 ? `Spend +${dAdsFeePct.toFixed(0)}% ` : "";
      issues.push(`${spendClause}kéo TACoS lên ${curTacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ so với tuần trước ${prevTacos.toFixed(1)}%)`);
    }
    const issueStr = issues.length > 0 ? ` do ${issues.join(" và ")}` : "";
    return `🔹 **${displayName}:** ${kpiPrefix}Revenue tăng +${dRevPct.toFixed(1)}% nhờ Units tăng mạnh, nhưng Margin mỏng chỉ còn ${curMargin.toFixed(1)}%${issueStr}.${fullWarningText}`;
  }

  // 3. Profit tăng mạnh (>= 20%)
  if (dProfitPct >= 20) {
    if (dTacos <= -2 && curTacos <= 20) {
      const spendNote = dAdsFeePct <= -5 ? `Spend ${dAdsFeePct.toFixed(0)}%` : "Spend giữ nguyên";
      return `🔹 **${displayName}:** ${kpiPrefix}Profit +${dProfitPct.toFixed(1)}%, Revenue +${dRevPct.toFixed(1)}% nhờ đơn Organic tăng vọt trong khi ${spendNote}, kéo TACoS giảm về ${curTacos.toFixed(1)}% (${dTacos.toFixed(1)}đ).${fullWarningText}`;
    }
    if (curTacos >= 30) {
      const spendNote = dAdsFeePct >= 5 ? `Spend +${dAdsFeePct.toFixed(0)}%` : (dAdsFeePct <= -5 ? `Spend ${dAdsFeePct.toFixed(0)}%` : "Spend đi ngang");
      const tacosNote = dTacos >= 2
        ? `TACoS tăng lên ${curTacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ) do ${spendNote}`
        : `TACoS ở mức cao ${curTacos.toFixed(1)}% (${spendNote})`;
      return `🔹 **${displayName}:** ${kpiPrefix}Profit tăng +${dProfitPct.toFixed(1)}% nhờ Units tăng mạnh (+${dRevPct.toFixed(1)}%); tuy nhiên ${tacosNote}.${fullWarningText}`;
    }
    return `🔹 **${displayName}:** ${kpiPrefix}Revenue +${dRevPct.toFixed(1)}%, Profit +${dProfitPct.toFixed(1)}% so với tuần trước nhờ Units tăng trưởng tốt.${fullWarningText}`;
  }

  // 4. Biến động TACoS riêng lẻ
  if (dTacos >= 3) {
    const spendNote = dAdsFeePct >= 5 ? ` (Spend +${dAdsFeePct.toFixed(0)}%)` : "";
    return `🔹 **${displayName}:** ${kpiPrefix}TACoS tăng lên ${curTacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ)${spendNote}.${fullWarningText}`;
  }

  return `🔹 **${displayName}:** ${kpiPrefix}Nhìn chung ổn định.${fullWarningText}`;
}

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

  // 1. Dữ liệu SKU WIN (để hiện Top KPI Cards & Overview Table)
  const totalWin = summarize(brands, ctx);
  const revWinCur = totalWin.cur.revenue;
  const revWinPrev = totalWin.prev.revenue;
  const revWinMtd = totalWin.mtd.revenue;
  const proWinCur = totalWin.cur.profit;
  const proWinPrev = totalWin.prev.profit;
  const proWinMtd = totalWin.mtd.profit;

  const marginWinCur = div(proWinCur, revWinCur) ?? 0;
  const marginWinPrev = div(proWinPrev, revWinPrev) ?? 0;
  const tacosWinCur = div(totalWin.cur.adsFee, revWinCur) ?? 0;
  const tacosWinPrev = div(totalWin.prev.adsFee, revWinPrev) ?? 0;

  const fullRevTarget = totalWin.revenue?.month.full ?? 0;
  const targetRevWeek = (fullRevTarget * week.days) / dim;
  const revPaceWeek = targetRevWeek > 0 ? (revWinCur / targetRevWeek) * 100 : null;
  const revPaceMonth = fullRevTarget > 0 ? (revWinMtd / fullRevTarget) * 100 : null;

  const fullProTarget = totalWin.profit?.month.full ?? 0;
  const targetProWeek = (fullProTarget * week.days) / dim;
  const proPaceWeek = targetProWeek > 0 ? (proWinCur / targetProWeek) * 100 : null;
  const proPaceMonth = fullProTarget > 0 ? (proWinMtd / fullProTarget) * 100 : null;

  // 2. Dữ liệu SKU ALL (Win + Test)
  const allBrands = brands.map((b) => brandOfGroup(b, "all"));
  const totalAll = summarize(allBrands, ctx);

  const fullAllProTarget = allBrands.reduce((acc, b) => acc + (b.target?.profit ?? 0), 0);
  const targetAllProWeek = (fullAllProTarget * week.days) / dim;
  const allProPaceWeek = targetAllProWeek > 0 ? (totalAll.cur.profit / targetAllProWeek) * 100 : null;
  const allProPaceMonth = fullAllProTarget > 0 ? (totalAll.mtd.profit / fullAllProTarget) * 100 : null;

  // Service Fees trong tuần + số theo SKU cả tuần của từng kênh (Top 10 SKU tốt / cần chú ý của mỗi team)
  const skusByChannel = new Map<string, TeamSkuRow[]>();
  const [serviceFeesMap] = await Promise.all([
    loadLargeServiceFeesWeek(week.startDate, week.endDate),
    ...TEAMS_CONFIG.flatMap((team) =>
      team.stores.map(async (stDef) => {
        const b = allBrands.find((x) => x.storeName.toUpperCase() === stDef.name && x.channel.toUpperCase() === stDef.channel);
        if (!b) return;
        const rows = await loadChannelSkus(b.storeId, stDef.channel === "FBM", stDef.label, week.startDate, week.endDate);
        skusByChannel.set(`${stDef.name}|${stDef.channel}`, rows);
      }),
    ),
  ]);

  // --- DỰNG LARK CARD ---
  const elements: any[] = [];

  // 1. BẢNG TỔNG QUAN HIỆU QUẢ KINH DOANH (Thay cho dạng text dài, bám vào tuần & KPI)
  const revDiffPpt = ((marginWinCur - marginWinPrev) * 100).toFixed(1);
  const tacosDiffPpt = ((tacosWinCur - tacosWinPrev) * 100).toFixed(1);

  const overviewRows = [
    {
      metric: "**Revenue (Win)**",
      cur: `**${fmtUsd(revWinCur)}**`,
      prev: fmtUsd(revWinPrev),
      wow: fmtWow(revWinCur, revWinPrev, true),
      targetWeek: fmtUsd(targetRevWeek),
      paceWeek: fmtPaceTone(revPaceWeek),
      paceMonth: fmtPaceTone(revPaceMonth),
    },
    {
      metric: "**Profit (Win)**",
      cur: `**${fmtUsd(proWinCur)}**`,
      prev: fmtUsd(proWinPrev),
      wow: fmtWow(proWinCur, proWinPrev, true),
      targetWeek: fmtUsd(targetProWeek),
      paceWeek: fmtPaceTone(proPaceWeek),
      paceMonth: fmtPaceTone(proPaceMonth),
    },
    {
      metric: "**Biên LN**",
      cur: fmtPct(marginWinCur),
      prev: fmtPct(marginWinPrev),
      wow: marginWinCur >= marginWinPrev ? green(`▲ +${revDiffPpt}đ`) : red(`▼ ${revDiffPpt}đ`),
      targetWeek: "—",
      paceWeek: "—",
      paceMonth: "—",
    },
    {
      metric: "**TACoS**",
      cur: fmtPct(tacosWinCur),
      prev: fmtPct(tacosWinPrev),
      wow: tacosWinCur <= tacosWinPrev ? green(`▼ ${tacosDiffPpt}đ`) : red(`▲ +${tacosDiffPpt}đ`),
      targetWeek: "—",
      paceWeek: "—",
      paceMonth: "—",
    },
    {
      metric: "**Tổng All Rev**",
      cur: `**${fmtUsd(totalAll.cur.revenue)}**`,
      prev: fmtUsd(totalAll.prev.revenue),
      wow: fmtWow(totalAll.cur.revenue, totalAll.prev.revenue, true),
      targetWeek: "—",
      paceWeek: "—",
      paceMonth: "—",
    },
    {
      metric: "**Tổng All Profit**",
      cur: `**${fmtUsd(totalAll.cur.profit)}**`,
      prev: fmtUsd(totalAll.prev.profit),
      wow: fmtWow(totalAll.cur.profit, totalAll.prev.profit, true),
      targetWeek: fmtUsd(targetAllProWeek),
      paceWeek: fmtPaceTone(allProPaceWeek),
      paceMonth: fmtPaceTone(allProPaceMonth),
    },
  ];

  elements.push(
    {
      tag: "markdown",
      content: `### 📌 TỔNG QUAN HIỆU QUẢ KINH DOANH TUẦN`,
    },
    {
      tag: "table",
      page_size: 6,
      row_height: "low",
      header_style: TABLE_HEADER,
      columns: [
        col("metric", "Chỉ số", "left"),
        col("cur", "Tuần này"),
        col("prev", "Tuần trước"),
        col("wow", "Δ WoW"),
        col("targetWeek", "Target Tuần"),
        col("paceWeek", "% Đạt Tuần"),
        col("paceMonth", "% Đạt Tháng"),
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
    const teamComments: string[] = [];
    let teamCurTotal = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };
    let teamPrevTotal = { revenue: 0, quantity: 0, adsFee: 0, profit: 0, basecost: 0 };
    let teamMtdProfit = 0;
    let teamTargetProMonth = 0;

    for (const stDef of team.stores) {
      const b = allBrands.find(
        (x) => x.storeName.toUpperCase() === stDef.name && x.channel.toUpperCase() === stDef.channel
      );
      const cur = b?.current || ZERO;
      const prev = b?.previous || ZERO;
      const mtd = b?.mtd || ZERO;

      teamCurTotal = add(teamCurTotal, cur);
      teamPrevTotal = add(teamPrevTotal, prev);
      teamMtdProfit += mtd.profit;

      const storeMonthProTarget = b?.target?.profit ?? 0;
      teamTargetProMonth += storeMonthProTarget;
      const storeWeekProTarget = (storeMonthProTarget * week.days) / dim;
      const storePaceWeek = storeWeekProTarget > 0 ? (cur.profit / storeWeekProTarget) * 100 : null;
      const storePaceMonth = storeMonthProTarget > 0 ? (mtd.profit / storeMonthProTarget) * 100 : null;

      const hasData = cur.revenue > 0 || cur.quantity > 0 || cur.profit !== 0;
      const margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
      const tacos = cur.revenue > 0 ? (cur.adsFee / cur.revenue) * 100 : 0;

      const displayName = stDef.label;

      teamStoreRows.push({
        channel: hasData ? displayName : `${displayName} (—)`,
        revenue: hasData ? fmtUsd(cur.revenue) : "—",
        units: hasData ? fmtInt(cur.quantity) : "—",
        spend: hasData ? fmtUsd(cur.adsFee) : "—",
        profit: hasData ? (cur.profit >= 0 ? fmtUsd(cur.profit) : red(fmtUsd(cur.profit))) : "—",
        targetWeek: storeWeekProTarget > 0 ? fmtUsd(storeWeekProTarget) : "—",
        paceWeek: storePaceWeek != null ? fmtPaceTone(storePaceWeek) : "—",
        margin: hasData ? fmtPct(margin / 100) : "—",
        tacos: hasData ? fmtPct(tacos / 100) : "—",
        paceMonth: storePaceMonth != null ? fmtPaceTone(storePaceMonth) : "—",
      });

      // Nhận xét store (GẮN VỚI KPI)
      const rawStoreFees = b ? serviceFeesMap.get(b.storeId) || [] : [];
      const storeFees = rawStoreFees.filter((f) => {
        const isFbaFee = f.name.toLowerCase().includes("fba") || f.name.toLowerCase().includes("storage");
        if (stDef.channel.toLowerCase() === "fbm") return !isFbaFee;
        return true;
      });
      const comment = generateWeeklyStoreComment(
        cur,
        prev,
        displayName,
        storeWeekProTarget,
        storePaceWeek,
        storeFees
      );
      if (comment) teamComments.push(comment);
    }

    // Tính KPI tổng của Team
    const teamTargetProWeek = (teamTargetProMonth * week.days) / dim;
    const teamPaceWeek = teamTargetProWeek > 0 ? (teamCurTotal.profit / teamTargetProWeek) * 100 : null;
    const teamPaceMonth = teamTargetProMonth > 0 ? (teamMtdProfit / teamTargetProMonth) * 100 : null;

    // Thêm dòng TỔNG của Team vào cuối bảng team
    const teamMargin = teamCurTotal.revenue > 0 ? (teamCurTotal.profit / teamCurTotal.revenue) * 100 : 0;
    const teamTacos = teamCurTotal.revenue > 0 ? (teamCurTotal.adsFee / teamCurTotal.revenue) * 100 : 0;

    teamStoreRows.push({
      channel: `**Tổng ${team.name}**`,
      revenue: `**${fmtUsd(teamCurTotal.revenue)}**`,
      units: `**${fmtInt(teamCurTotal.quantity)}**`,
      spend: `**${fmtUsd(teamCurTotal.adsFee)}**`,
      profit: `**${fmtUsd(teamCurTotal.profit)}**`,
      targetWeek: teamTargetProWeek > 0 ? `**${fmtUsd(teamTargetProWeek)}**` : "—",
      paceWeek: teamPaceWeek != null ? `**${fmtPaceTone(teamPaceWeek)}**` : "—",
      margin: `**${fmtPct(teamMargin / 100)}**`,
      tacos: `**${fmtPct(teamTacos / 100)}**`,
      paceMonth: teamPaceMonth != null ? `**${fmtPaceTone(teamPaceMonth)}**` : "—",
    });

    // Dòng nhận xét Team GẮN CHẶT VỚI KPI
    const teamRevDiffPct = teamPrevTotal.revenue > 0 ? ((teamCurTotal.revenue - teamPrevTotal.revenue) / teamPrevTotal.revenue) * 100 : 0;
    const teamProDiffPct = teamPrevTotal.profit !== 0 ? ((teamCurTotal.profit - teamPrevTotal.profit) / Math.abs(teamPrevTotal.profit)) * 100 : 0;
    const teamRevStr = teamRevDiffPct >= 0 ? `+${teamRevDiffPct.toFixed(1)}%` : `${teamRevDiffPct.toFixed(1)}%`;
    const teamProStr = teamProDiffPct >= 0 ? `+${teamProDiffPct.toFixed(1)}%` : `${teamProDiffPct.toFixed(1)}%`;

    let kpiTeamText = "";
    if (teamTargetProWeek > 0 && teamPaceWeek != null) {
      const paceLabel = teamPaceWeek >= 100 ? "vượt nhịp" : teamPaceWeek >= 85 ? "sát nhịp" : "dưới nhịp";
      const mtdText = teamPaceMonth != null ? ` Lũy kế tháng đạt **${teamPaceMonth.toFixed(1)}%**.` : "";
      kpiTeamText = `Đạt **${teamPaceWeek.toFixed(1)}% KPI tuần** (Profit ${fmtUsd(teamCurTotal.profit)} / Target ${fmtUsd(teamTargetProWeek)}, ${paceLabel}). Revenue ${teamRevStr}, Profit ${teamProStr} so với tuần trước.${mtdText}`;
    } else {
      kpiTeamText = `Revenue ${teamRevStr}, Profit ${teamProStr} so với tuần trước.`;
    }

    const teamSummaryLine = `📌 **Nhận xét ${team.name}:** ${kpiTeamText}`;
    const commentBlockContent = teamComments.length > 0 ? `${teamSummaryLine}\n${teamComments.join("\n")}` : teamSummaryLine;

    const teamTable = {
        tag: "table",
        page_size: Math.min(teamStoreRows.length, 10),
        row_height: "low",
        header_style: TABLE_HEADER,
        columns: [
          col("channel", "Kênh", "left"),
          col("revenue", "Revenue"),
          col("units", "Units"),
          col("spend", "Spend"),
          col("profit", "Profit"),
          col("targetWeek", "Target Tuần"),
          col("paceWeek", "% Đạt Tuần"),
          col("margin", "Margin"),
          col("tacos", "TACoS"),
          col("paceMonth", "% Đạt Tháng"),
        ],
        rows: teamStoreRows,
      };
    const teamComment = { tag: "markdown", content: commentBlockContent };

    // Top 10 SKU Profit cao nhất (tốt) và thấp nhất (cần chú ý) của cả team trong tuần — khung bấm để xem như báo cáo ngày
    const teamSkus = team.stores.flatMap((st) => skusByChannel.get(`${st.name}|${st.channel}`) || []);
    const topGood = [...teamSkus].sort((x, y) => y.profit - x.profit).slice(0, 10);
    const goodSet = new Set(topGood);
    const topBad = teamSkus.filter((r) => !goodSet.has(r)).sort((x, y) => x.profit - y.profit).slice(0, 10);
    const skuPanels = [skuPanel("🏆 **Top 10 SKU tốt**", topGood, "Không có SKU phát sinh trong tuần.")];
    if (topBad.length) skuPanels.push(skuPanel("🚨 **Top 10 SKU cần chú ý**", topBad));

    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: `**${team.name.toUpperCase()} (${team.lead.toUpperCase()})**`,
      },
      teamTable,
      teamComment,
      ...skuPanels,
    );

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
        body: { elements: [teamTable, teamComment, ...skuPanels] },
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
    console.log(`Đang gửi báo cáo tuần ${week.label} vào Lark webhook...`);
    const res = await sendLarkWebhookNotification(webhookUrl, { card });
    if (res.sent) {
      console.log(`✅ Đã gửi BÁO CÁO TUẦN VÀO LARK THÀNH CÔNG!`);
    } else {
      console.error(`❌ Gửi Lark thất bại:`, res.reason);
      process.exit(1);
    }
    // Nhóm Lark riêng của từng team: chỉ nhận card của team đó. Team lỗi không chặn team khác; lỗi báo vào nhóm tổng.
    const teamWebhooks = await loadTeamWebhooks();
    const failures: string[] = [];
    for (const t of teamCards) {
      const url = teamWebhooks[t.teamId];
      if (!url) continue;
      try {
        await sendLarkWebhookNotification(url, { card: t.card });
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
