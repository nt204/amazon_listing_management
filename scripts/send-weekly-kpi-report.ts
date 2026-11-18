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

const fmtUsdK = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? "-" : ""}$${s}`;
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

/** Tính ngày Thứ Bảy đã trôi qua gần nhất */
export function getPreviousCompletedSaturday(fromIso?: string): string {
  const d = fromIso ? new Date(`${fromIso}T00:00:00Z`) : new Date();
  const day = d.getUTCDay(); // 0: Sun, 1: Mon, ..., 6: Sat
  // Nếu hôm nay là Thứ 2 (1) -> Thứ 7 trước đó là 2 ngày trước (-2)
  // Nếu hôm nay là CN (0) -> Thứ 7 trước đó là 1 ngày trước (-1)
  // Nếu hôm nay là Thứ 7 (6) -> Thứ 7 tuần trước là 7 ngày trước (-7)
  const daysToSubtract = day === 6 ? 7 : day + 1;
  const targetTime = d.getTime() - daysToSubtract * 86_400_000;
  const targetDate = new Date(targetTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetDate.getUTCFullYear()}-${pad(targetDate.getUTCMonth() + 1)}-${pad(targetDate.getUTCDate())}`;
}

const TABLE_HEADER = {
  background_style: "grey",
  text_align: "right",
};

function col(name: string, displayName: string, align: "left" | "right" | "center" = "right") {
  return {
    name,
    display_name: displayName,
    data_type: "text",
    align,
  };
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

  // 1. Dữ liệu SKU WIN (để hiện Top KPI Cards)
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

  // Tiến độ như card Báo cáo tuần:
  // Tuần: Lũy kế đến hết tuần so với Target lũy kế (Target tháng * endDay / dim)
  // Tháng: Lũy kế đến hết tuần so với Target cả tháng
  const fullRevTarget = totalWin.revenue?.month.full ?? 0;
  const targetRevToWeek = (fullRevTarget * endDay) / dim;
  const revPaceToWeek = targetRevToWeek > 0 ? revWinMtd / targetRevToWeek : null;
  const revPaceMonth = fullRevTarget > 0 ? revWinMtd / fullRevTarget : null;

  const fullProTarget = totalWin.profit?.month.full ?? 0;
  const targetProToWeek = (fullProTarget * endDay) / dim;
  const proPaceToWeek = targetProToWeek > 0 ? proWinMtd / targetProToWeek : null;
  const proPaceMonth = fullProTarget > 0 ? proWinMtd / fullProTarget : null;

  // 2. Dữ liệu SKU ALL (Win + Test) - Bảng Kinh doanh theo Team & Brand
  const allBrands = brands.map((b) => brandOfGroup(b, "all"));
  const totalAll = summarize(allBrands, ctx);

  // Gom theo Team
  const teamOrder = ["FBM", "FBA TEAM 1", "FBA TEAM 2", "FBA TEAM 3"];
  const byTeam = new Map<string, WeeklyBrandRow[]>();
  for (const b of allBrands) {
    if (!byTeam.has(b.team)) byTeam.set(b.team, []);
    byTeam.get(b.team)!.push(b);
  }

  // Bảng Team
  const teamTableRows: any[] = [];
  for (const tName of teamOrder) {
    const list = byTeam.get(tName);
    if (!list) continue;
    const s = summarize(list, ctx);
    const rev = s.cur.revenue;
    const prevRev = s.prev.revenue;
    const profit = s.cur.profit;
    const prevProfit = s.prev.profit;
    const mtdProfit = s.mtd.profit;
    const targetProfitMonth = list.reduce((acc, b) => acc + (b.target?.profit ?? 0), 0);
    const targetProfitToDate = (targetProfitMonth * endDay) / dim;
    const paceMonth = targetProfitMonth > 0 ? mtdProfit / targetProfitMonth : null;

    teamTableRows.push({
      team: `**${tName}**`,
      revenue: fmtUsd(rev),
      wowRev: fmtWow(rev, prevRev, true),
      units: fmtInt(s.cur.quantity),
      spend: fmtUsd(s.cur.adsFee),
      profit: profit >= 0 ? fmtUsd(profit) : red(fmtUsd(profit)),
      wowProfit: fmtWow(profit, prevProfit, true),
      tacos: fmtPct(div(s.cur.adsFee, rev)),
      margin: fmtPct(div(profit, rev)),
      roi: fmtPct(div(profit, s.cur.basecost)),
      mtdProfit: mtdProfit >= 0 ? fmtUsd(mtdProfit) : red(fmtUsd(mtdProfit)),
      targetProfit: targetProfitMonth > 0 ? fmtUsd(targetProfitMonth) : "—",
      pace: paceMonth != null ? fmtPct(paceMonth) : "—",
    });
  }

  // Dòng TỔNG cho Team table
  const totRev = totalAll.cur.revenue;
  const totPrevRev = totalAll.prev.revenue;
  const totProfit = totalAll.cur.profit;
  const totPrevProfit = totalAll.prev.profit;
  const totMtdProfit = totalAll.mtd.profit;
  const totTargetProfit = allBrands.reduce((acc, b) => acc + (b.target?.profit ?? 0), 0);
  const totPaceMonth = totTargetProfit > 0 ? totMtdProfit / totTargetProfit : null;

  teamTableRows.push({
    team: `**TỔNG**`,
    revenue: `**${fmtUsd(totRev)}**`,
    wowRev: fmtWow(totRev, totPrevRev, true),
    units: `**${fmtInt(totalAll.cur.quantity)}**`,
    spend: `**${fmtUsd(totalAll.cur.adsFee)}**`,
    profit: `**${fmtUsd(totProfit)}**`,
    wowProfit: fmtWow(totProfit, totPrevProfit, true),
    tacos: `**${fmtPct(div(totalAll.cur.adsFee, totRev))}**`,
    margin: `**${fmtPct(div(totProfit, totRev))}**`,
    roi: `**${fmtPct(div(totProfit, totalAll.cur.basecost))}**`,
    mtdProfit: `**${fmtUsd(totMtdProfit)}**`,
    targetProfit: totTargetProfit > 0 ? `**${fmtUsd(totTargetProfit)}**` : "—",
    pace: totPaceMonth != null ? `**${fmtPct(totPaceMonth)}**` : "—",
  });

  // Bảng Brand chi tiết
  const brandTableRows: any[] = [];
  for (const b of allBrands) {
    const rev = b.current.revenue;
    const prevRev = b.previous.revenue;
    const profit = b.current.profit;
    const prevProfit = b.previous.profit;
    const mtdProfit = b.mtd.profit;
    const brandName = b.label.replace(/-FBA$/i, "");

    brandTableRows.push({
      brand: brandName,
      revenue: fmtUsd(rev),
      wowRev: fmtWow(rev, prevRev, true),
      units: fmtInt(b.current.quantity),
      spend: fmtUsd(b.current.adsFee),
      profit: profit >= 0 ? fmtUsd(profit) : red(fmtUsd(profit)),
      wowProfit: fmtWow(profit, prevProfit, true),
      margin: fmtPct(div(profit, rev)),
      tacos: fmtPct(div(b.current.adsFee, rev)),
      mtdProfit: fmtUsd(mtdProfit),
    });
  }

  // Tồn kho cảnh báo (> 30 tuần Ứ vốn, hoặc < 4 tuần Sắp hết)
  const stockAlerts: string[] = [];
  for (const s of report.stock) {
    const sold = s.soldInPeriod;
    const totalUnits = s.units + (s.prepaidUnits || 0);
    if (totalUnits > 0 && sold > 0) {
      const weeksLeft = totalUnits / sold;
      if (weeksLeft > 30) {
        stockAlerts.push(`• **${s.label}:** Tồn kho **${weeksLeft.toFixed(0)} tuần** (${fmtInt(totalUnits)} pcs) — <font color='red'>Ứ vốn</font>`);
      } else if (weeksLeft < 4) {
        stockAlerts.push(`• **${s.label}:** Tồn kho chỉ còn **${weeksLeft.toFixed(1)} tuần** (${fmtInt(totalUnits)} pcs) — <font color='orange'>Sắp hết hàng</font>`);
      }
    } else if (totalUnits <= 0 && sold > 0) {
      stockAlerts.push(`• **${s.label}:** <font color='red'>Hết hàng</font> (Bán ${fmtInt(sold)} pcs nhưng tồn kho 0)`);
    }
  }

  // --- DỰNG LARK CARD ---
  const elements: any[] = [];

  // 1. Thẻ KPI Tổng quan
  const revDiffPpt = ((marginWinCur - marginWinPrev) * 100).toFixed(1);
  const tacosDiffPpt = ((tacosWinCur - tacosWinPrev) * 100).toFixed(1);

  const kpiSummaryMd = [
    `💵 **Revenue (Win):** **${fmtUsd(revWinCur)}** (${fmtWow(revWinCur, revWinPrev)}) | Tuần trước: ${fmtUsd(revWinPrev)} | Lũy kế: **${fmtUsd(revWinMtd)}**`,
    `  ↳ *Tiến độ:* Tuần đạt **${revPaceToWeek ? fmtPct(revPaceToWeek, 0) : "—"}** (Target ${fmtUsd(targetRevToWeek)}) • Tháng đạt **${revPaceMonth ? fmtPct(revPaceMonth, 0) : "—"}** (Target ${fmtUsd(fullRevTarget)})`,
    `📈 **Profit (Win):** **${fmtUsd(proWinCur)}** (${fmtWow(proWinCur, proWinPrev)}) | Tuần trước: ${fmtUsd(proWinPrev)} | Lũy kế: **${fmtUsd(proWinMtd)}**`,
    `  ↳ *Tiến độ:* Tuần đạt **${proPaceToWeek ? fmtPct(proPaceToWeek, 0) : "—"}** (Target ${fmtUsd(targetProToWeek)}) • Tháng đạt **${proPaceMonth ? fmtPct(proPaceMonth, 0) : "—"}** (Target ${fmtUsd(fullProTarget)})`,
    `📊 **Biên LN:** **${fmtPct(marginWinCur)}** (${marginWinCur >= marginWinPrev ? green(`▲ +${revDiffPpt} điểm %`) : red(`▼ ${revDiffPpt} điểm %`)}, tuần trước ${fmtPct(marginWinPrev)})`,
    `🎯 **TACoS:** **${fmtPct(tacosWinCur)}** (${tacosWinCur <= tacosWinPrev ? green(`▼ ${tacosDiffPpt} điểm %`) : red(`▲ +${tacosDiffPpt} điểm %`)}, tuần trước ${fmtPct(tacosWinPrev)})`,
    `*(Tổng toàn bộ gồm cả SKU Test: Revenue **${fmtUsd(totRev)}**, Profit **${fmtUsd(totProfit)}**)*`,
  ].join("\n");

  elements.push(
    {
      tag: "markdown",
      content: `### 📌 TỔNG QUAN HIỆU QUẢ KINH DOANH\n${kpiSummaryMd}`,
    }
  );

  // 2. Thẻ Đánh giá tuần (từ kế toán/admin nếu có)
  if (report.note?.text?.trim()) {
    const updatedInfo = report.note.updatedBy ? ` *(Cập nhật bởi ${report.note.updatedBy})*` : "";
    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: `### 📝 ĐÁNH GIÁ TUẦN\n> ${report.note.text.trim()}${updatedInfo}`,
      }
    );
  }

  // 3. Bảng Kinh doanh theo Team (Bảng chính trong screenshot)
  elements.push(
    { tag: "hr" },
    {
      tag: "markdown",
      content: `### 🏢 KINH DOANH THEO TEAM (SKU ALL)`,
    },
    {
      tag: "table",
      page_size: 6,
      row_height: "low",
      header_style: TABLE_HEADER,
      columns: [
        col("team", "Team", "left"),
        col("revenue", "Revenue"),
        col("wowRev", "% WoW Rev"),
        col("units", "Units"),
        col("spend", "Spend"),
        col("profit", "Profit"),
        col("wowProfit", "% WoW Profit"),
        col("tacos", "TACoS"),
        col("margin", "Biên LN"),
        col("roi", "ROI"),
        col("mtdProfit", "Profit LK"),
        col("targetProfit", "Target Tháng"),
        col("pace", "% Đạt"),
      ],
      rows: teamTableRows,
    }
  );

  // 4. Bảng Chi tiết theo Brand/Store
  elements.push(
    { tag: "hr" },
    {
      tag: "markdown",
      content: `### 🏪 CHI TIẾT THEO STORE / BRAND`,
    },
    {
      tag: "table",
      page_size: 12,
      row_height: "low",
      header_style: TABLE_HEADER,
      columns: [
        col("brand", "Brand / Store", "left"),
        col("revenue", "Revenue"),
        col("wowRev", "WoW Rev"),
        col("units", "Units"),
        col("spend", "Spend"),
        col("profit", "Profit"),
        col("wowProfit", "WoW Profit"),
        col("tacos", "TACoS"),
        col("margin", "Biên LN"),
        col("mtdProfit", "Profit LK"),
      ],
      rows: brandTableRows,
    }
  );

  // 5. Cảnh báo Tồn kho
  if (stockAlerts.length > 0) {
    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: `### 📦 TỒN KHO CẦN LƯU Ý\n${stockAlerts.join("\n")}`,
      }
    );
  }

  const card = {
    schema: "2.0",
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

  return { card, week, report };
}

async function main() {
  const args = process.argv.slice(2);
  const isPingLark = args.includes("--ping-lark");
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];

  console.log(`Đang lập báo cáo KPI tuần (mốc: ${dateArg || "Thứ 7 gần nhất"})...`);
  const { card, week } = await generateWeeklyKpiReport(dateArg);

  if (isPingLark) {
    const webhookUrl = process.env.LARK_ACCOUNTING_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error("Lỗi: Không tìm thấy webhook URL (LARK_ACCOUNTING_WEBHOOK_URL)!");
      process.exit(1);
    }
    console.log(`Đang gửi báo cáo tuần ${week.label} vào Lark webhook...`);
    const ok = await sendLarkWebhookNotification(webhookUrl, { card });
    if (ok) {
      console.log(`✅ Đã gửi BÁO CÁO TUẦN VÀO LARK THÀNH CÔNG!`);
    } else {
      console.error(`❌ Gửi Lark thất bại!`);
      process.exit(1);
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
