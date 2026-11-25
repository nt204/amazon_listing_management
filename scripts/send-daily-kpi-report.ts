import { getDatabaseClient } from "@/lib/db";
import { loadChannelSeries, latestCompleteDate } from "@/lib/accounting/daily-business-reporter";
import type { ChannelSeriesInput } from "@/lib/accounting/daily-report-analysis";
import type { DashboardDay } from "@/lib/accounting/dashboard-totals";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";
import { listSkuWin, type SkuWinItem } from "@/lib/accounting/sku-win-db";
import { listFbmSkuFixed } from "@/lib/accounting/fbm-financials-db";
import { listActiveTeamTargets } from "@/lib/accounting/team-targets-service";
import {
  isWeekUnitsTarget,
  weekTargetCells,
  type ActiveTeamTarget,
  type TeamTotalsFn,
} from "@/lib/accounting/team-targets";

interface MetricSet {
  revenue: number;
  quantity: number;
  profit: number;
  adsFee: number;
  revenueAds: number;
  returnCost: number;
  basecost: number;
  margin: number;
  acos: number;
  tacos: number;
  roi: number;
}

function emptyMetrics(): MetricSet {
  return {
    revenue: 0,
    quantity: 0,
    profit: 0,
    adsFee: 0,
    revenueAds: 0,
    returnCost: 0,
    basecost: 0,
    margin: 0,
    acos: 0,
    tacos: 0,
    roi: 0,
  };
}

function extractMetrics(day?: DashboardDay): MetricSet {
  if (!day) return emptyMetrics();
  const revenue = day.revenue || 0;
  const quantity = day.quantity || 0;
  const profit = day.profit || 0;
  const adsFee = day.adsFee || 0;
  const revenueAds = day.revenueAds || 0;
  const returnCost = day.returnCost || 0;
  const basecost = day.basecost || 0;
  return {
    revenue,
    quantity,
    profit,
    adsFee,
    revenueAds,
    returnCost,
    basecost,
    margin: revenue > 0 ? (profit / revenue) * 100 : 0,
    acos: revenueAds > 0 ? (adsFee / revenueAds) * 100 : 0,
    tacos: revenue > 0 ? (adsFee / revenue) * 100 : 0,
    roi: basecost > 0 ? (profit / basecost) * 100 : 0,
  };
}

function sumMetrics(list: MetricSet[]): MetricSet {
  const res = emptyMetrics();
  for (const m of list) {
    res.revenue += m.revenue;
    res.quantity += m.quantity;
    res.profit += m.profit;
    res.adsFee += m.adsFee;
    res.revenueAds += m.revenueAds;
    res.returnCost += m.returnCost;
    res.basecost += m.basecost;
  }
  res.margin = res.revenue > 0 ? (res.profit / res.revenue) * 100 : 0;
  res.acos = res.revenueAds > 0 ? (res.adsFee / res.revenueAds) * 100 : 0;
  res.tacos = res.revenue > 0 ? (res.adsFee / res.revenue) * 100 : 0;
  res.roi = res.basecost > 0 ? (res.profit / res.basecost) * 100 : 0;
  return res;
}

const fmtUsd = (n: number) => {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtCount = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const green = (text: string) => `<font color='green'>${text}</font>`;
const red = (text: string) => `<font color='red'>${text}</font>`;
const blue = (text: string) => `<font color='blue'>${text}</font>`;
const grey = (text: string) => `<font color='grey'>${text}</font>`;

// Quy ước: △ ▽ = tốt · ▲ ▼ = xấu (ACoS/TACoS giảm là tốt)
function deltaPctVsAvg(cur: number, avg: number): string {
  if (avg <= 0 && cur <= 0) return grey("—");
  if (avg <= 0) return green("△ +100%");
  const diff = ((cur - avg) / avg) * 100;
  if (Math.abs(diff) < 0.05) return grey("0.0%");
  return diff > 0 ? green(`△ +${diff.toFixed(1)}%`) : red(`▼ -${Math.abs(diff).toFixed(1)}%`);
}

function deltaUsdVsAvg(cur: number, avg: number): string {
  const diff = cur - avg;
  const pct = avg > 0 ? Math.abs((diff / avg) * 100).toFixed(1) : "0.0";
  if (Math.abs(diff) < 0.5) return grey("$0 (0.0%)");
  return diff > 0
    ? green(`△ +${fmtUsd(diff)} (+${pct}%)`)
    : red(`▼ -${fmtUsd(Math.abs(diff))} (-${pct}%)`);
}

function deltaPointVsAvg(cur: number, avg: number): string {
  const diff = cur - avg;
  if (Math.abs(diff) < 0.05) return grey("0.0đ");
  return diff > 0 ? green(`△ +${diff.toFixed(1)}đ`) : red(`▼ -${Math.abs(diff).toFixed(1)}đ`);
}

// Spend: chỉ là mức chi, không tốt/xấu → màu xám, mũi tên đặc
function deltaSpendVsAvg(cur: number, avg: number): string {
  if (avg <= 0) return grey("—");
  const diff = ((cur - avg) / avg) * 100;
  if (Math.abs(diff) < 0.05) return grey("0.0%");
  return grey(diff > 0 ? `▲ +${diff.toFixed(1)}%` : `▼ -${Math.abs(diff).toFixed(1)}%`);
}

// Cho TACoS: giảm là tốt (▽ xanh), tăng là xấu (▲ đỏ)
function deltaPointInvertedVsAvg(cur: number, avg: number): string {
  const diff = cur - avg;
  if (Math.abs(diff) < 0.05) return grey("0.0đ");
  return diff < 0 ? green(`▽ -${Math.abs(diff).toFixed(1)}đ`) : red(`▲ +${diff.toFixed(1)}đ`);
}

export interface TeamDefinition {
  id: string;
  name: string;
  lead: string;
  channels: Array<{ label: string; displayName: string }>;
}

export const TEAMS: TeamDefinition[] = [
  {
    id: "FBA 1",
    name: "Team 1",
    lead: "Quỳnh",
    channels: [
      { label: "Bozspacer", displayName: "Bozspacer" },
      { label: "Warmstorey", displayName: "Warmstorey" },
    ],
  },
  {
    id: "FBA 2",
    name: "Team 2",
    lead: "Trường",
    channels: [
      { label: "Limima", displayName: "Limima" },
      { label: "Fastpeace-FBA", displayName: "Fastpeace-FBA" },
      { label: "Everphant-FBA", displayName: "Everphant-FBA" },
    ],
  },
  {
    id: "FBA 3",
    name: "Team 3",
    lead: "Loan",
    channels: [
      { label: "Malfirst", displayName: "Malfirst" },
      { label: "Ekaspeek-FBA", displayName: "Ekaspeek-FBA" },
    ],
  },
  {
    id: "FBM",
    name: "Team FBM",
    lead: "Đức",
    channels: [
      { label: "Fastpeace-FBM", displayName: "Fastpeace-FBM" },
      { label: "Ekaspeek-FBM", displayName: "Ekaspeek-FBM" },
      { label: "Everphant-FBM", displayName: "Everphant-FBM" },
    ],
  },
];

const TABLE_HEADER = {
  text_align: "left",
  text_size: "normal",
  background_style: "grey",
  bold: true,
  lines: 1,
};

const col = (name: string, display: string, align: "left" | "right" = "right") => ({
  name,
  display_name: display,
  data_type: "lark_md",
  horizontal_align: align,
  width: "auto",
});

interface LargeServiceFee {
  storeId: string;
  storeName: string;
  productDetails: string;
  amount: number;
}

interface ChannelDetail {
  teamDef: TeamDefinition;
  displayName: string;
  storeId?: string;
  isFbm: boolean;
  hasDataToday: boolean;
  today: MetricSet;
  yesterday: MetricSet;
  priorAvg: MetricSet;
  priorDaysCount: number;
  serviceFees: LargeServiceFee[];
}

// Lấy danh sách phí dịch vụ (Service Fees) bị trừ >= $1,000 trong ngày (không tính phí Ads vì đã có Spend)
async function loadLargeServiceFees(targetDate: string): Promise<Map<string, LargeServiceFee[]>> {
  const sql = await getDatabaseClient();
  const result = new Map<string, LargeServiceFee[]>();

  try {
    const rows = await sql<Array<{
      store_id: string;
      store_name: string;
      product_details: string;
      total: number;
    }>>`
      SELECT
        sf.store_id,
        COALESCE(NULLIF(sf.store_name, ''), s.name) AS store_name,
        COALESCE(NULLIF(sf.product_details, ''), 'Phí dịch vụ') AS product_details,
        SUM(ABS(sf.total))::float AS total
      FROM accounting_service_fees sf
      LEFT JOIN stores s ON s.id = sf.store_id
      WHERE sf.date = ${targetDate}::date
        AND sf.total < 0
        AND LOWER(COALESCE(sf.product_details, '')) NOT LIKE '%advertising%'
        AND LOWER(COALESCE(sf.product_details, '')) NOT LIKE '%cost of ads%'
      GROUP BY sf.store_id, 2, 3
      HAVING SUM(ABS(sf.total)) >= 1000
      ORDER BY total DESC;
    `;

    for (const r of rows) {
      const list = result.get(r.store_id) || [];
      list.push({
        storeId: r.store_id,
        storeName: r.store_name.toUpperCase(),
        productDetails: r.product_details,
        amount: Number(r.total),
      });
      result.set(r.store_id, list);
    }
  } catch (err) {
    console.warn("[Service Fees] Không thể truy vấn:", err);
  }

  return result;
}

export interface TeamSkuRow {
  sku: string;
  store: string;
  revenue: number;
  quantity: number;
  profit: number;
  margin: number;
  tacos: number;
}

// Số theo SKU của 1 kênh trong khoảng ngày (mặc định 1 ngày) — cùng nguồn với tab "Lọc SKU Win" (FBA) / "FBM Cố định" (FBM)
export async function loadChannelSkus(
  storeId: string,
  isFbm: boolean,
  displayName: string,
  targetDate: string,
  endDate: string = targetDate,
): Promise<TeamSkuRow[]> {
  const list = isFbm ? listFbmSkuFixed : listSkuWin;
  try {
    const { items } = await list(storeId, {
      startDate: targetDate,
      endDate,
      status: "all",
      skuType: "all",
      sortField: "profit",
      sortDirection: "desc",
      limit: 100000,
      includeAllTime: false,
    });
    return items
      .filter((i: SkuWinItem) => i.revenue > 0 || i.quantity > 0 || i.ads_fee > 0)
      .map((i: SkuWinItem) => ({
        sku: i.sku,
        store: displayName,
        revenue: i.revenue,
        quantity: i.quantity,
        profit: i.profit,
        margin: i.revenue > 0 ? (i.profit / i.revenue) * 100 : 0,
        tacos: i.revenue > 0 ? (i.ads_fee / i.revenue) * 100 : 0,
      }));
  } catch (err) {
    console.warn(`[Top SKU] Không thể tải SKU ${displayName}:`, err);
    return [];
  }
}

// Top SKU nằm trong khung thu gọn (bấm mới mở). Table của Lark không đặt được trong collapsible_panel,
// nên dùng bảng markdown (card JSON 2.0): ô tự xuống dòng, SKU hiện đủ tên; > 5 dòng Lark tự chia trang.
export function skuPanel(title: string, rows: TeamSkuRow[], emptyText = "Không có SKU phát sinh trong ngày."): Record<string, any> {
  const header = "| SKU | Store | Revenue | Profit | Qty | Margin | TACoS |\n| :-- | :-- | --: | --: | --: | --: | --: |";
  const lines = rows.map((r) =>
    [
      r.sku,
      r.store,
      fmtUsd(r.revenue),
      r.profit < 0 ? red(fmtUsd(r.profit)) : blue(fmtUsd(r.profit)),
      fmtCount(r.quantity),
      r.revenue > 0 ? fmtPct(r.margin) : "—",
      r.revenue > 0 ? fmtPct(r.tacos) : "—",
    ].join(" | "),
  );
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: {
      title: { tag: "markdown", content: title },
      icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "4px 8px 4px 8px",
    elements: [
      {
        tag: "markdown",
        content: rows.length
          ? `${header}\n${lines.map((l) => `| ${l} |`).join("\n")}`
          : grey(emptyText),
      },
    ],
  };
}

// Nhận xét từng store: đọc chỉ số thực tế (TACoS), giải thích nguyên nhân, kèm Service Fee lớn nếu có
function generateStoreComment(ch: ChannelDetail): string | null {
  if (!ch.hasDataToday || (ch.today.revenue === 0 && ch.today.quantity === 0)) return null;
  const t = ch.today;
  const avg = ch.priorAvg;
  if (!ch.priorDaysCount || avg.revenue <= 0) return null;

  const dProfit = t.profit - avg.profit;
  const dProfitPct = avg.profit !== 0 ? (dProfit / Math.abs(avg.profit)) * 100 : 0;
  const dRev = t.revenue - avg.revenue;
  const dRevPct = avg.revenue > 0 ? (dRev / avg.revenue) * 100 : 0;
  const dQty = t.quantity - avg.quantity;
  const dQtyPct = avg.quantity > 0 ? (dQty / avg.quantity) * 100 : 0;
  const dTacos = t.tacos - avg.tacos;
  const dReturn = t.returnCost - avg.returnCost;
  const dAdsFeePct = avg.adsFee > 0 ? ((t.adsFee - avg.adsFee) / avg.adsFee) * 100 : 0;
  const refundMultiplier = avg.returnCost > 0 ? t.returnCost / avg.returnCost : 1;

  const isProfitBig = Math.abs(dProfitPct) >= 20 && Math.abs(dProfit) >= 40;
  const isRevBig = Math.abs(dRevPct) >= 20 && Math.abs(dRev) >= 150;
  const isTacosBig = Math.abs(dTacos) >= 3 || t.tacos >= 30;
  const isRefundSpike = t.returnCost >= 40 && dReturn >= 25 && refundMultiplier >= 1.4;

  // Xây dựng chuỗi cảnh báo nếu store bị trừ Service Fee >= $1,000
  let serviceFeeText = "";
  if (ch.serviceFees && ch.serviceFees.length > 0) {
    const feeLines = ch.serviceFees.map((f) => {
      return `  ❗ **Service Fee:** ${f.productDetails} -$${f.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    });
    serviceFeeText = `\n${feeLines.join("\n")}`;
  }

  const fullWarningText = serviceFeeText;

  // Nếu không có biến động lớn về tổng thể store
  if (!isProfitBig && !isRevBig && !isTacosBig && !isRefundSpike) {
    // Nếu store bình thường nhưng bị trừ Service Fee lớn thì cảnh báo
    if (fullWarningText) {
      return `🔹 **${ch.displayName}:** Nhìn chung ổn định.${fullWarningText}`;
    }
    return null;
  }

  // 1. Profit sụt giảm sâu (<= -20%)
  if (dProfitPct <= -20 && dProfit <= -40) {
    const causes: string[] = [];
    if (isRefundSpike) {
      const multStr = refundMultiplier >= 1.8 ? `gấp ${refundMultiplier.toFixed(1)} lần ` : "";
      causes.push(`chi phí Refund tăng ${multStr}lên ${fmtUsd(t.returnCost)} (TB ${fmtUsd(avg.returnCost)})`);
    }
    if (dTacos >= 3 || t.tacos >= 25) {
      const spendClause = dAdsFeePct >= 10 ? ` do Spend +${dAdsFeePct.toFixed(0)}%` : "";
      causes.push(`TACoS tăng lên ${t.tacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ)${spendClause}`);
    }
    if (dRevPct <= -15) {
      causes.push(`Units sụt giảm ${dRevPct.toFixed(1)}%`);
    }
    const revNote = Math.abs(dRevPct) < 10 ? "Revenue đi ngang" : `Revenue ${dRevPct > 0 ? "+" : ""}${dRevPct.toFixed(1)}%`;
    return `🔹 **${ch.displayName}:** Profit sụt ${dProfitPct.toFixed(1)}% (${revNote}), do ${causes.join(" và ")}.${fullWarningText}`;
  }

  // 2. Margin mỏng (<= 10%) dù revenue tăng mạnh
  if (t.margin <= 10 && dRevPct >= 20) {
    const issues: string[] = [];
    if (dTacos >= 3 || t.tacos >= 25) {
      const spendClause = dAdsFeePct > 0 ? `Spend +${dAdsFeePct.toFixed(0)}% ` : "";
      issues.push(`${spendClause}kéo TACoS lên ${t.tacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ so với TB ${avg.tacos.toFixed(1)}%)`);
    }
    if (isRefundSpike) {
      issues.push(`Refund tăng lên ${fmtUsd(t.returnCost)} (TB ${fmtUsd(avg.returnCost)})`);
    }
    return `🔹 **${ch.displayName}:** Revenue tăng +${dRevPct.toFixed(1)}% nhờ Units tăng mạnh, nhưng Margin mỏng chỉ còn ${t.margin.toFixed(1)}% do ${issues.join(" và ")}.${fullWarningText}`;
  }

  // 3. Profit tăng mạnh (>= 20%)
  if (dProfitPct >= 20 && dProfit >= 40) {
    // 3a. Tăng trưởng organic sạch (Spend giữ nguyên/giảm, TACoS giảm)
    if (dTacos <= -2 && t.tacos <= 20) {
      const spendNote = dAdsFeePct <= -5 ? `Spend ${dAdsFeePct.toFixed(0)}%` : "Spend giữ nguyên";
      return `🔹 **${ch.displayName}:** Profit +${dProfitPct.toFixed(1)}%, Revenue +${dRevPct.toFixed(1)}% nhờ đơn Organic tăng vọt trong khi ${spendNote}, kéo TACoS giảm sâu về ${t.tacos.toFixed(1)}% (${dTacos.toFixed(1)}đ).${fullWarningText}`;
    }

    // 3b. TACoS tăng do hiệu quả Ads kém nhưng organic kéo lại
    if (dTacos >= 3 && dRevPct < 25) {
      const spendNote = dAdsFeePct >= 10 ? ` (Spend +${dAdsFeePct.toFixed(0)}%)` : "";
      return `🔹 **${ch.displayName}:** TACoS tăng lên ${t.tacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ so với TB ${avg.tacos.toFixed(1)}%)${spendNote} do hiệu quả Ads kém; bù lại đơn Organic tăng mạnh giúp Profit vẫn tăng +${dProfitPct.toFixed(1)}% so với TB.${fullWarningText}`;
    }

    // 3c. Scale mạnh đơn hàng nhưng TACoS cao
    if (t.tacos >= 30) {
      const spendNote = dAdsFeePct >= 5 ? `Spend +${dAdsFeePct.toFixed(0)}%` : (dAdsFeePct <= -5 ? `Spend ${dAdsFeePct.toFixed(0)}%` : "Spend đi ngang");
      const tacosNote = dTacos >= 2
        ? `TACoS tăng lên ${t.tacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ) do ${spendNote}`
        : `TACoS ở mức cao ${t.tacos.toFixed(1)}% (${spendNote})`;
      return `🔹 **${ch.displayName}:** Profit tăng +${dProfitPct.toFixed(1)}% nhờ Units tăng mạnh (+${dQtyPct.toFixed(1)}%); tuy nhiên ${tacosNote}.${fullWarningText}`;
    }

    // 3d. Tăng trưởng tốt nói chung
    return `🔹 **${ch.displayName}:** Revenue +${dRevPct.toFixed(1)}%, Profit +${dProfitPct.toFixed(1)}% so với TB ngày nhờ Units tăng trưởng tốt.${fullWarningText}`;
  }

  // 4. Các trường hợp TACoS hoặc Refund biến động riêng lẻ
  const issues: string[] = [];
  if (dTacos >= 3) {
    const spendNote = dAdsFeePct >= 5 ? ` (Spend +${dAdsFeePct.toFixed(0)}%)` : "";
    issues.push(`TACoS tăng lên ${t.tacos.toFixed(1)}% (+${dTacos.toFixed(1)}đ)${spendNote}`);
  } else if (t.tacos >= 30) {
    const spendNote = dAdsFeePct >= 5 ? ` (Spend +${dAdsFeePct.toFixed(0)}%)` : "";
    issues.push(`TACoS ở mức cao ${t.tacos.toFixed(1)}%${spendNote}`);
  }
  if (isRefundSpike) issues.push(`Refund tăng lên ${fmtUsd(t.returnCost)} (TB ${fmtUsd(avg.returnCost)})`);
  if (isRevBig) issues.push(`Revenue ${dRevPct > 0 ? "+" : ""}${dRevPct.toFixed(1)}%`);

  if (issues.length === 0) {
    return fullWarningText ? `🔹 **${ch.displayName}:** Nhìn chung ổn định.${fullWarningText}` : null;
  }

  return `🔹 **${ch.displayName}:** Biến động so với TB ngày: ${issues.join(", ")}.${fullWarningText}`;
}

// Link "Báo cáo ngày" trên web mở đúng store (tab FBA hoặc FBM theo ngày)
const REPORT_BASE_URL = process.env.ACCOUNTING_REPORT_BASE_URL?.trim() || "https://ncehub.net";

export function dailyReportStoreUrl(storeName: string, channel: "FBA" | "FBM"): string {
  const params = new URLSearchParams({
    view: "accounting",
    store: storeName.toUpperCase(),
    section: "financials",
    subtab: channel === "FBM" ? "fbm" : "day",
  });
  return `${REPORT_BASE_URL}/?${params.toString()}`;
}

export interface DailyKpiReport {
  /** Tin tổng công ty (giữ cho chỗ cũ chỉ đọc 1 card) */
  card: Record<string, any>;
  /** Mỗi tin 1 card: [tổng công ty, team 1, team 2, ...] — gửi lần lượt */
  cards: Array<Record<string, any>>;
  /** Tin của từng team kèm mã team (TEAMS[].id: "FBA 1", "FBM"...) để gửi vào nhóm Lark riêng của team */
  teamCards: Array<{ teamId: string; teamName: string; card: Record<string, any> }>;
  success: boolean;
  date: string;
}

export async function generateDailyKpiReport(targetDate: string): Promise<DailyKpiReport> {
  const [y, m, d] = targetDate.split("-").map(Number);
  const targetD = new Date(Date.UTC(y, m - 1, d));
  const yesterdayD = new Date(targetD.getTime() - 86400000);
  const yesterdayDate = yesterdayD.toISOString().slice(0, 10);
  const monthStart = `${targetDate.slice(0, 7)}-01`;

  const sql = await getDatabaseClient();
  // Mục tiêu sếp giao (tag bot trên Lark / nhập trên web) đang áp dụng. Trước mắt chỉ theo dõi Units từng tuần
  // (T2 → CN, tuần đầu tháng có thể bắt đầu từ tháng trước) → nạp số liệu từ ngày bắt đầu sớm nhất.
  const teamTargets = await listActiveTeamTargets(targetDate)
    .then((byTeam) => new Map([...byTeam].map(([team, list]) => [team, list.filter(isWeekUnitsTarget)] as const)))
    .catch((err) => {
      console.error("[DailyKpiReport] Không đọc được mục tiêu team:", err);
      return new Map<string, ActiveTeamTarget[]>();
    });
  const seriesFrom = [...teamTargets.values()].flat().reduce((min, t) => (t.startDate < min ? t.startDate : min), monthStart);
  const [channels, storeList, serviceFeesMap] = await Promise.all([
    loadChannelSeries(targetDate, undefined, seriesFrom),
    sql<Array<{ id: string; name: string }>>`SELECT id, name FROM stores`,
    loadLargeServiceFees(targetDate),
  ]);

  const storeMap = new Map(storeList.map((s) => [s.name.toUpperCase(), s.id]));

  const findCh = (list: ChannelSeriesInput[], key: string) => {
    const k = key.trim().toUpperCase();
    return list.find((c) => {
      const label = c.label.trim().toUpperCase();
      const store = c.storeName.trim().toUpperCase();
      return label === k || store === k || label.startsWith(`${k}-`) || `${store}-${c.channel}` === k;
    });
  };

  const allChannelDetails: ChannelDetail[] = [];

  for (const team of TEAMS) {
    for (const chDef of team.channels) {
      const ch = findCh(channels, chDef.label);
      const todayDay = ch?.days.find((x) => x.date === targetDate);
      const yestDay = ch?.days.find((x) => x.date === yesterdayDate);

      const todayM = extractMetrics(todayDay);
      const yestM = extractMetrics(yestDay);
      const hasData = Boolean(todayDay && (todayM.revenue > 0 || todayM.profit !== 0 || todayM.quantity > 0));

      const priorDays = (ch?.days || []).filter(
        (x) => x.date >= monthStart && x.date < targetDate && (x.revenue > 0 || x.profit !== 0 || x.quantity > 0)
      );
      const priorCount = priorDays.length || 1;
      const priorAvg: MetricSet = {
        revenue: priorDays.reduce((s, x) => s + (x.revenue || 0), 0) / priorCount,
        quantity: priorDays.reduce((s, x) => s + (x.quantity || 0), 0) / priorCount,
        profit: priorDays.reduce((s, x) => s + (x.profit || 0), 0) / priorCount,
        adsFee: priorDays.reduce((s, x) => s + (x.adsFee || 0), 0) / priorCount,
        revenueAds: priorDays.reduce((s, x) => s + (x.revenueAds || 0), 0) / priorCount,
        returnCost: priorDays.reduce((s, x) => s + (x.returnCost || 0), 0) / priorCount,
        basecost: priorDays.reduce((s, x) => s + (x.basecost || 0), 0) / priorCount,
        margin: 0,
        acos: 0,
        tacos: 0,
        roi: 0,
      };
      priorAvg.margin = priorAvg.revenue > 0 ? (priorAvg.profit / priorAvg.revenue) * 100 : 0;
      priorAvg.acos = priorAvg.revenueAds > 0 ? (priorAvg.adsFee / priorAvg.revenueAds) * 100 : 0;
      priorAvg.tacos = priorAvg.revenue > 0 ? (priorAvg.adsFee / priorAvg.revenue) * 100 : 0;
      priorAvg.roi = priorAvg.basecost > 0 ? (priorAvg.profit / priorAvg.basecost) * 100 : 0;

      const isFbm = chDef.displayName.includes("FBM");
      const baseName = chDef.label.replace(/-FBA|-FBM/i, "").toUpperCase();
      const storeId = storeMap.get(baseName);

      // Phí dịch vụ (Service Fees) >= $1,000 của store
      const storeServiceFees = storeId ? (serviceFeesMap.get(storeId) || []) : [];
      const channelServiceFees = storeServiceFees.filter((fee) => {
        const isFbaStorage = fee.productDetails.toLowerCase().includes("fba") || fee.productDetails.toLowerCase().includes("storage");
        if (isFbaStorage) return !isFbm; // Gán phí lưu kho FBA cho kênh FBA
        if (baseName === "FASTPEACE") return isFbm; // Fastpeace gán phí Ads cho FBM (nơi chạy Ads chính)
        return true;
      });

      allChannelDetails.push({
        teamDef: team,
        displayName: chDef.displayName,
        storeId,
        isFbm,
        hasDataToday: hasData,
        today: todayM,
        yesterday: yestM,
        priorAvg,
        priorDaysCount: priorDays.length,
        serviceFees: channelServiceFees,
      });
    }
  }

  // Số liệu Tổng công ty: Hôm nay, Hôm qua, TB các ngày trước đó
  const companyToday = sumMetrics(allChannelDetails.map((c) => c.today));
  const companyYesterday = sumMetrics(allChannelDetails.map((c) => c.yesterday));

  const priorDayDates: string[] = [];
  const curD = new Date(Date.UTC(y, m - 1, 1));
  while (curD < targetD) {
    priorDayDates.push(curD.toISOString().slice(0, 10));
    curD.setUTCDate(curD.getUTCDate() + 1);
  }

  const companyDailyTotals: MetricSet[] = [];
  for (const dateStr of priorDayDates) {
    let rev = 0, prof = 0, qty = 0, ads = 0, revAds = 0, ret = 0, bc = 0;
    for (const ch of channels) {
      const dRecord = ch.days.find((x) => x.date === dateStr);
      if (dRecord) {
        rev += dRecord.revenue || 0;
        prof += dRecord.profit || 0;
        qty += dRecord.quantity || 0;
        ads += dRecord.adsFee || 0;
        revAds += dRecord.revenueAds || 0;
        ret += dRecord.returnCost || 0;
        bc += dRecord.basecost || 0;
      }
    }
    if (rev > 0 || prof !== 0 || qty > 0) {
      companyDailyTotals.push({
        revenue: rev,
        profit: prof,
        quantity: qty,
        adsFee: ads,
        revenueAds: revAds,
        returnCost: ret,
        basecost: bc,
        margin: rev > 0 ? (prof / rev) * 100 : 0,
        acos: revAds > 0 ? (ads / revAds) * 100 : 0,
        tacos: rev > 0 ? (ads / rev) * 100 : 0,
        roi: bc > 0 ? (prof / bc) * 100 : 0,
      });
    }
  }

  const companyPriorCount = companyDailyTotals.length || 1;
  const companyPriorAvg: MetricSet = {
    revenue: companyDailyTotals.reduce((s, x) => s + x.revenue, 0) / companyPriorCount,
    profit: companyDailyTotals.reduce((s, x) => s + x.profit, 0) / companyPriorCount,
    quantity: companyDailyTotals.reduce((s, x) => s + x.quantity, 0) / companyPriorCount,
    adsFee: companyDailyTotals.reduce((s, x) => s + x.adsFee, 0) / companyPriorCount,
    revenueAds: companyDailyTotals.reduce((s, x) => s + x.revenueAds, 0) / companyPriorCount,
    returnCost: companyDailyTotals.reduce((s, x) => s + x.returnCost, 0) / companyPriorCount,
    basecost: companyDailyTotals.reduce((s, x) => s + x.basecost, 0) / companyPriorCount,
    margin: 0,
    acos: 0,
    tacos: 0,
    roi: 0,
  };
  companyPriorAvg.margin = companyPriorAvg.revenue > 0 ? (companyPriorAvg.profit / companyPriorAvg.revenue) * 100 : 0;
  companyPriorAvg.acos = companyPriorAvg.revenueAds > 0 ? (companyPriorAvg.adsFee / companyPriorAvg.revenueAds) * 100 : 0;
  companyPriorAvg.tacos = companyPriorAvg.revenue > 0 ? (companyPriorAvg.adsFee / companyPriorAvg.revenue) * 100 : 0;
  companyPriorAvg.roi = companyPriorAvg.basecost > 0 ? (companyPriorAvg.profit / companyPriorAvg.basecost) * 100 : 0;

  const targetDdMm = `${targetDate.slice(8, 10)}/${targetDate.slice(5, 7)}`;
  const yestDdMm = `${yesterdayDate.slice(8, 10)}/${yesterdayDate.slice(5, 7)}`;
  const priorPeriodLabel = priorDayDates.length > 0 ? `TB trước đó` : `TB tháng`;

  // 1. BẢNG TỔNG CÔNG TY: Thay Units bằng TACoS, Thêm cột Hôm qua
  const companyTable = {
    tag: "table",
    page_size: 10,
    row_height: "low",
    header_style: TABLE_HEADER,
    columns: [
      col("metric", "Chỉ số", "left"),
      col("today", targetDdMm),
      col("yesterday", yestDdMm),
      col("priorAvg", priorPeriodLabel),
      col("delta", "Δ so với TB"),
    ],
    rows: [
      {
        metric: "**Revenue**",
        today: `**${fmtUsd(companyToday.revenue)}**`,
        yesterday: fmtUsd(companyYesterday.revenue),
        priorAvg: fmtUsd(companyPriorAvg.revenue),
        delta: deltaPctVsAvg(companyToday.revenue, companyPriorAvg.revenue),
      },
      {
        metric: "**Profit**",
        today: blue(`**${fmtUsd(companyToday.profit)}**`),
        yesterday: fmtUsd(companyYesterday.profit),
        priorAvg: fmtUsd(companyPriorAvg.profit),
        delta: deltaUsdVsAvg(companyToday.profit, companyPriorAvg.profit),
      },
      {
        metric: "**Units**",
        today: `**${fmtCount(companyToday.quantity)}**`,
        yesterday: fmtCount(companyYesterday.quantity),
        priorAvg: fmtCount(companyPriorAvg.quantity),
        delta: deltaPctVsAvg(companyToday.quantity, companyPriorAvg.quantity),
      },
      {
        metric: "**Spend**",
        today: `**${fmtUsd(companyToday.adsFee)}**`,
        yesterday: fmtUsd(companyYesterday.adsFee),
        priorAvg: fmtUsd(companyPriorAvg.adsFee),
        delta: deltaSpendVsAvg(companyToday.adsFee, companyPriorAvg.adsFee),
      },
      {
        metric: "**Margin**",
        today: `**${fmtPct(companyToday.margin)}**`,
        yesterday: fmtPct(companyYesterday.margin),
        priorAvg: fmtPct(companyPriorAvg.margin),
        delta: deltaPointVsAvg(companyToday.margin, companyPriorAvg.margin),
      },
      {
        metric: "**TACoS**",
        today: `**${fmtPct(companyToday.tacos)}**`,
        yesterday: fmtPct(companyYesterday.tacos),
        priorAvg: fmtPct(companyPriorAvg.tacos),
        delta: deltaPointInvertedVsAvg(companyToday.tacos, companyPriorAvg.tacos),
      },
      {
        metric: "**ROI**",
        today: `**${fmtPct(companyToday.roi)}**`,
        yesterday: fmtPct(companyYesterday.roi),
        priorAvg: fmtPct(companyPriorAvg.roi),
        delta: deltaPointVsAvg(companyToday.roi, companyPriorAvg.roi),
      },
    ],
  };

  const startDayStr = priorDayDates.length > 0 ? priorDayDates[0].slice(8, 10) : "01";
  const endDayStr = priorDayDates.length > 0 ? priorDayDates[priorDayDates.length - 1].slice(8, 10) : targetDate.slice(8, 10);
  const monthStr = targetDate.slice(5, 7);
  const headerSubtitle = `So sánh với Hôm qua (${yestDdMm}) & TB các ngày trước (${startDayStr}/${monthStr} - ${endDayStr}/${monthStr})`;

  // 2. BẢNG TỪNG TEAM & STORE (mỗi team 1 tin riêng): Kênh | Revenue | Profit | Units | Spend | Margin | TACoS | ACoS
  // Bên dưới mỗi team là "Nhận xét" (Toàn team thay bằng Team + số, chỉ nhận xét store biến động)
  const teamCards: Array<{ teamId: string; teamName: string; card: Record<string, any> }> = [];
  // Số theo SKU trong ngày của mọi kênh (để lấy Top 10 Profit cao / thấp nhất của từng team)
  const skusByChannel = new Map<ChannelDetail, TeamSkuRow[]>();
  await Promise.all(
    allChannelDetails.map(async (ch) => {
      skusByChannel.set(ch, ch.storeId ? await loadChannelSkus(ch.storeId, ch.isFbm, ch.displayName, targetDate) : []);
    }),
  );

  for (const team of TEAMS) {
    const teamChannels = allChannelDetails.filter((c) => c.teamDef.id === team.id);
    // Tổng team gồm cả kênh không có đơn (Spend / phí của kênh đó vẫn trừ vào Profit), khớp tổng công ty
    const teamToday = sumMetrics(teamChannels.map((c) => c.today));
    const teamPriorAvg = sumMetrics(teamChannels.map((c) => c.priorAvg));

    const teamRevDiffPct = teamPriorAvg.revenue > 0 ? ((teamToday.revenue - teamPriorAvg.revenue) / teamPriorAvg.revenue) * 100 : 0;
    const teamProfitDiffPct = Math.abs(teamPriorAvg.profit) > 0 ? ((teamToday.profit - teamPriorAvg.profit) / Math.abs(teamPriorAvg.profit)) * 100 : 0;

    const revSign = teamRevDiffPct >= 0 ? `+${teamRevDiffPct.toFixed(1)}%` : `${teamRevDiffPct.toFixed(1)}%`;
    const profSign = teamProfitDiffPct >= 0 ? `+${teamProfitDiffPct.toFixed(1)}%` : `${teamProfitDiffPct.toFixed(1)}%`;

    const teamSummaryLine = `📌 **Nhận xét ${team.name}:** Revenue ${revSign}, Profit ${profSign} so với TB ngày.`;

    // Tiến độ mục tiêu sếp giao: cộng số các kênh của team (cùng kênh với bảng trên), lọc 1 store khi mục tiêu theo store
    const teamSeries = team.channels
      .map((chDef) => findCh(channels, chDef.label))
      .filter((c): c is ChannelSeriesInput => Boolean(c));
    const teamTotals: TeamTotalsFn = (from, to, storeName) => {
      const acc = { quantity: 0, revenue: 0, profit: 0 };
      for (const c of teamSeries) {
        if (storeName && c.storeName.trim().toUpperCase() !== storeName) continue;
        for (const d of c.days) {
          if (d.date < from || d.date > to) continue;
          acc.quantity += d.quantity || 0;
          acc.revenue += d.revenue || 0;
          acc.profit += d.profit || 0;
        }
      }
      return acc;
    };
    const activeTargets = teamTargets.get(team.id) ?? [];
    // Có target tuần (Units) đang chạy → thêm cột "Lũy kế tuần" / "Target tuần" / "% đạt" ngay sau Units (chỉ số,
    // không nhận xét); không có thì bảng như cũ
    const weekCols = Boolean(weekTargetCells(activeTargets, targetDate, teamTotals, null));
    const weekCells = (storeName: string | null): Record<string, string> => {
      const c = weekCols ? weekTargetCells(activeTargets, targetDate, teamTotals, storeName) : null;
      if (!c) return {};
      const dash = (v: string) => (v === "—" ? grey("—") : v);
      return { weekCum: c.cum, weekTarget: dash(c.target), weekPct: dash(c.pct) };
    };

    const teamTableRows: Array<Record<string, string>> = [];

    // Hàng tổng team
    teamTableRows.push({
      channel: `**Tổng ${team.name}**`,
      revenue: `**${fmtUsd(teamToday.revenue)}**`,
      units: `**${fmtCount(teamToday.quantity)}**`,
      ...weekCells(null),
      spend: `**${fmtUsd(teamToday.adsFee)}**`,
      profit: blue(`**${fmtUsd(teamToday.profit)}**`),
      margin: `**${teamToday.revenue > 0 ? fmtPct(teamToday.margin) : "—"}**`,
      tacos: `**${teamToday.revenue > 0 ? fmtPct(teamToday.tacos) : "—"}**`,
      acos: `**${teamToday.revenueAds > 0 ? fmtPct(teamToday.acos) : "—"}**`,
    });

    const storeComments: string[] = [];

    for (const ch of teamChannels) {
      // Không có đơn vẫn hiện số như mọi kênh (Revenue $0, Units 0, Spend, Profit); tỷ lệ % thì "—"
      const hasRevenue = ch.today.revenue > 0;
      teamTableRows.push({
        channel: ch.displayName,
        revenue: fmtUsd(ch.today.revenue),
        units: fmtCount(ch.today.quantity),
        ...weekCells(ch.displayName.replace(/-FBA|-FBM/i, "").toUpperCase()),
        spend: fmtUsd(ch.today.adsFee),
        profit: blue(`**${fmtUsd(ch.today.profit)}**`),
        margin: hasRevenue ? fmtPct(ch.today.margin) : grey("—"),
        tacos: hasRevenue ? fmtPct(ch.today.tacos) : grey("—"),
        acos: ch.today.revenueAds > 0 ? fmtPct(ch.today.acos) : grey("—"),
      });
      if (!hasRevenue && ch.today.quantity === 0 && ch.serviceFees && ch.serviceFees.length > 0) {
        const feeLines = ch.serviceFees.map(
          (f) =>
            `  ❗ **Service Fee:** ${f.productDetails} -$${f.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
        storeComments.push(`🔹 **${ch.displayName}:**\n${feeLines.join("\n")}`);
      }

      // Tạo nhận xét cho store (đổi nhận xét ACoS sang TACoS, kèm 1-2 SKU cảnh báo)
      const comment = generateStoreComment(ch);
      if (comment) storeComments.push(comment);
    }

    // Nhận xét team ở trên, rồi tới các store cần chú ý
    const commentBlockContent = storeComments.length > 0
      ? `${teamSummaryLine}\n\n⚠️ **Store cần chú ý:**\n${storeComments.join("\n")}`
      : teamSummaryLine;

    // Top 10 SKU Profit cao nhất (tốt) và 10 SKU Profit thấp nhất (cần chú ý) của cả team
    const teamSkus = teamChannels.flatMap((c) => skusByChannel.get(c) || []);
    const topGood = [...teamSkus].sort((a, b) => b.profit - a.profit).slice(0, 10);
    const goodSet = new Set(topGood);
    const topBad = teamSkus.filter((r) => !goodSet.has(r)).sort((a, b) => a.profit - b.profit).slice(0, 10);
    const skuElements: Array<Record<string, any>> = [
      skuPanel("🏆 **Top 10 SKU tốt**", topGood),
    ];
    if (topBad.length) {
      skuElements.push(skuPanel("🚨 **Top 10 SKU cần chú ý**", topBad));
    }

    // Link Báo cáo ngày trên web cho từng kênh của team (FBA → tab FBA theo ngày, FBM → tab FBM theo ngày)
    const reportLinks = team.channels.map((chDef) => {
      const isFbm = /-FBM$/i.test(chDef.label);
      const storeName = chDef.label.replace(/-FBA|-FBM/i, "");
      return `[${chDef.displayName}](${dailyReportStoreUrl(storeName, isFbm ? "FBM" : "FBA")})`;
    });

    const teamElements: Array<Record<string, any>> = [
      {
        tag: "table",
        page_size: Math.min(teamTableRows.length, 10),
        row_height: "low",
        header_style: TABLE_HEADER,
        columns: [
          col("channel", "Kênh", "left"),
          col("revenue", "Revenue"),
          col("profit", "Profit"),
          col("units", "Units"),
          ...(weekCols ? [col("weekCum", "Lũy kế tuần"), col("weekTarget", "Target tuần"), col("weekPct", "% đạt")] : []),
          col("spend", "Spend"),
          col("margin", "Margin"),
          col("tacos", "TACoS"),
          col("acos", "ACoS"),
        ],
        rows: teamTableRows,
      },
      {
        tag: "markdown",
        content: commentBlockContent,
      },
      { tag: "hr" },
      ...skuElements,
      { tag: "hr" },
      {
        tag: "markdown",
        content: `🔗 **Báo cáo ngày:** ${reportLinks.join(" · ")}`,
      },
    ];

    teamCards.push({ teamId: team.id, teamName: team.name, card: {
      schema: "2.0",
      config: { width_mode: "fill" },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: `${team.name.toUpperCase()} (${team.lead.toUpperCase()}) · NGÀY ${targetDdMm}` },
        subtitle: { tag: "plain_text", content: headerSubtitle },
      },
      body: { elements: teamElements },
    } });
  }

  const card = {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `BÁO CÁO KINH DOANH NGÀY ${targetDdMm}` },
      subtitle: { tag: "plain_text", content: headerSubtitle },
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**TỔNG CÔNG TY**`,
        },
        companyTable,
      ],
    },
  };

  return {
    card,
    cards: [card, ...teamCards.map((t) => t.card)],
    teamCards,
    success: true,
    date: targetDate,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf("--date");
  const targetDate = dateIdx >= 0 ? args[dateIdx + 1] : (await latestCompleteDate()) || "2026-11-16";
  const shouldPing = args.includes("--ping-lark");
  const webhookIdx = args.indexOf("--webhook");
  const webhookUrl = webhookIdx >= 0 ? args[webhookIdx + 1] : (process.env.LARK_ACCOUNTING_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL || "");

  console.log(`Đang lập báo cáo KPI ngày ${targetDate}...`);
  const report = await generateDailyKpiReport(targetDate);

  if (shouldPing) {
    if (!webhookUrl) {
      console.error("Lỗi: Không tìm thấy webhook URL để gửi Lark!");
      process.exit(1);
    }
    // --team "Team 2": chỉ gửi tin của team đó (xem thử)
    const teamIdx = args.indexOf("--team");
    const teamFilter = teamIdx >= 0 ? args[teamIdx + 1]?.trim().toUpperCase() : "";
    const toSend = teamFilter
      ? report.cards.filter((c) => String(c.header?.title?.content || "").toUpperCase().startsWith(`${teamFilter} `))
      : report.cards;
    if (!toSend.length) {
      console.error(`Không tìm thấy tin của team "${teamFilter}".`);
      process.exit(1);
    }
    console.log(`Đang gửi ${toSend.length} tin báo cáo vào Lark webhook...`);
    for (const [i, card] of toSend.entries()) {
      const res = await sendLarkWebhookNotification(webhookUrl, { card });
      if (!res.sent) {
        console.error(`❌ Gửi Lark thất bại ở tin ${i + 1}/${toSend.length}:`, res.reason);
        process.exit(1);
      }
    }
    console.log("✅ Đã gửi BÁO CÁO VÀO LARK THÀNH CÔNG!");
  } else {
    if (args.includes("--json")) console.log(JSON.stringify(report.cards, null, 2));
    console.log("Số tin:", report.cards.length, "· elements:", report.cards.map((c) => c.body.elements.length).join(", "));
  }
  process.exit(0);
}

if (process.argv[1]?.endsWith("send-daily-kpi-report.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
