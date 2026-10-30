import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { listFbmDaily } from "@/lib/accounting/fbm-financials-db";
import type { DashboardDay } from "@/lib/accounting/dashboard-totals";
import { parseStoreTeams, storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";
import {
  analyzeDailyReport,
  shiftIsoDate,
  type ChannelSeriesInput,
  type DailyReportAnalysis,
  type ReportChannel,
} from "@/lib/accounting/daily-report-analysis";
import {
  buildDailyReportCard,
  buildDailyReportText,
  displayDate,
  formatUsd,
  teamLabel,
} from "@/lib/accounting/daily-report-card";
import { notifyLarkEventBestEffort, sendLarkCardNotification } from "@/lib/lark-notifications";

/** Store có đơn trong N ngày gần nhất mới tính là "đang hoạt động". */
const ACTIVE_STORE_WINDOW_DAYS = 7;
/** Kênh có số liệu đầu tiên trong N ngày gần đây = kênh mới. */
const NEW_CHANNEL_DAYS = 30;
const AI_COMMENTARY_TIMEOUT_MS = 30_000;

type ReportRecipient = { receiveId: string; receiveIdType: string };

export interface DailyReportPreview {
  card: Record<string, unknown>;
  text: string;
  analysis: DailyReportAnalysis;
  teamComments: Record<string, string> | null;
}

function toDay(it: FbaDailyItem): DashboardDay {
  return {
    date: it.date,
    revenue: it.revenue,
    quantity: it.quantity,
    orders: it.orders ?? 0,
    adsFee: it.ads_fee,
    basecost: it.basecost,
    amazonFee: it.amazon_fee,
    tax: it.thue,
    promotion: it.promotion,
    returnCost: it.return_cost,
    profit: it.profit,
    netProfit: it.net_profit,
    revenueAds: it.revenue_ads,
    clicks: it.clicks,
  };
}

const titleCase = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

/**
 * Chuỗi số liệu từng kênh (store × FBA/FBM) đúng công thức Dashboard: FBA theo listFbaDaily,
 * FBM theo listFbmDaily; kênh và team lấy theo cột Team của store.
 */
async function loadChannelSeries(date: string): Promise<ChannelSeriesInput[]> {
  const sql = await getDatabaseClient();
  const activeFrom = shiftIsoDate(date, -(ACTIVE_STORE_WINDOW_DAYS - 1));
  const historyFrom = [shiftIsoDate(date, -7), `${date.slice(0, 8)}01`].sort()[0];

  const stores = await sql<Array<{ id: string; name: string; team: string | null; created_at: string; first_created_at: string }>>`
      SELECT id, name, team, created_at::date::text AS created_at,
        (SELECT MIN(created_at)::date::text FROM stores) AS first_created_at
      FROM stores
      WHERE EXISTS (
        SELECT 1 FROM accounting_orders o
        WHERE o.store_id = stores.id AND o.date BETWEEN ${activeFrom}::date AND ${date}::date
      )
      ORDER BY name ASC
  `;

  // Kênh mới = store tạo sau đợt khởi tạo hệ thống và trong 30 ngày gần đây. Không dựa vào ngày
  // có đơn đầu tiên vì lịch sử đơn trong DB ngắn hơn tuổi thật của store.
  const newSince = shiftIsoDate(date, -(NEW_CHANNEL_DAYS - 1));
  const isNewStore = (store: (typeof stores)[number]) =>
    store.created_at > store.first_created_at && store.created_at >= newSince;

  const tasks = stores.flatMap((store) => {
    const channels: ReportChannel[] = [];
    if (storeHasFbaTeam(store.team) || !storeHasTeam(store.team, "FBM")) channels.push("FBA");
    if (storeHasTeam(store.team, "FBM")) channels.push("FBM");
    const fbaTeam = parseStoreTeams(store.team).find((t) => /^fba\b/i.test(t)) ?? "FBA";

    return channels.map(async (channel): Promise<ChannelSeriesInput | null> => {
      const options = { startDate: historyFrom, endDate: date, sortField: "date", sortDirection: "asc" as const, limit: 1000 };
      try {
        const { items } = channel === "FBM"
          ? await listFbmDaily(store.id, options)
          : await listFbaDaily(store.id, { ...options, channel: "Amazon" });
        const days = items.map(toDay);
        const active = days.some((d) => d.date >= activeFrom && (d.revenue !== 0 || d.adsFee !== 0));
        if (!active) return null;
        return {
          label: channels.length > 1 ? `${titleCase(store.name)}-${channel}` : titleCase(store.name),
          storeName: store.name,
          channel,
          team: channel === "FBM" ? "FBM" : fbaTeam,
          isNew: isNewStore(store),
          days,
        };
      } catch (err) {
        console.warn(`[Accounting Report] Không thể lấy dữ liệu ${store.name} ${channel}:`, err);
        return null;
      }
    });
  });

  return (await Promise.all(tasks)).filter((c): c is ChannelSeriesInput => c !== null);
}

/** Tên trưởng team, lưu ở app_settings dạng {"FBA 1": "Quỳnh", ...}. */
async function loadTeamLeads(teamId: string): Promise<Record<string, string>> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ value: string }>>`
    SELECT value FROM app_settings WHERE key = ${`daily_report_team_leads:${teamId}`} LIMIT 1
  `;
  try {
    const parsed = rows[0]?.value ? JSON.parse(rows[0].value) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const AI_COMMENTARY_SYSTEM_PROMPT = `Bạn là chuyên viên phân tích kinh doanh Amazon, viết nhận xét ngắn cho từng team trong báo cáo ngày gửi qua Lark.
Đầu vào là JSON số liệu đã tính sẵn (so với trung bình 7 ngày trước = "TB7").
Quy tắc:
- Mỗi team 1–2 câu, tối đa 45 chữ, tiếng Việt, giọng chuyên nghiệp, thẳng vào việc.
- Câu đầu: kết quả của team và kênh nào gây ra (nêu số $ hoặc điểm %). Câu sau (nếu cần): một việc cụ thể nên làm.
- Kết quả tốt thì chỉ ghi nhận bằng số, KHÔNG thêm "cần kiểm tra" và không động viên chung chung ("tiếp tục phát huy", "cả nhà chú ý"...).
- Chỉ dùng con số có trong dữ liệu, không tự tính số mới, không dự báo.
- Kênh "thieu_ads": true thì không nhận xét Profit/ACoS của kênh đó, chỉ nhắc nạp file Ads.
- Kênh "tb7_thieu_ads": true thì 7 ngày trước thiếu số Ads: KHÔNG so Profit với TB7, nhắc nạp bù file Ads.
- Trường nào là null nghĩa là không so được — không tự suy ra hay tự tính số thay thế.
- Kênh "kenh_moi": true là kênh đang đầu tư, không đánh giá nặng.
- Không dùng markdown, không in đậm, không xuống dòng.
Trả về DUY NHẤT một JSON object: {"<mã team>": "<nhận xét>", ...}.`;

async function generateTeamComments(
  analysis: DailyReportAnalysis,
  teamLeads: Record<string, string>,
): Promise<Record<string, string> | null> {
  const apiKey = (process.env.LARK_AGENT_KEY || process.env.CHEAPKEYAI_API_KEY || "").trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.LARK_AGENT_BASE_URL || "https://cheapkeyai.shop/v1").replace(/\/+$/, "");
  const model = (process.env.LARK_AGENT_MODEL || "gemini-3.5-flash-lite").trim();

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const pts = (cur: number, base?: number) => (base == null ? null : `${((cur - base) * 100).toFixed(1)}đ`);
  const change = (cur: number, base?: number) => (base == null || base <= 0 ? null : `${(((cur - base) / base) * 100).toFixed(1)}%`);
  const data = analysis.teams.map((team) => ({
    team: team.team,
    ten_team: teamLabel(team.team, teamLeads),
    den: team.light,
    profit: formatUsd(team.today.profit),
    // Mốc thiếu số Ads thì không đưa số so sánh profit, tránh AI kết luận sai
    profit_tb7: team.avg7 && !team.unreliable.length ? formatUsd(team.avg7.profit) : null,
    kenh_thieu_so_ads: team.unreliable,
    profit_tb_thang: team.monthAvg ? formatUsd(team.monthAvg.profit) : null,
    kenh: team.channels.map((c) => ({
      kenh: c.label,
      den: c.isNew ? "moi" : c.light,
      kenh_moi: c.isNew,
      thieu_ads: c.adsMissing,
      tb7_thieu_ads: c.baselineAdsMissing,
      revenue: formatUsd(c.today.revenue),
      revenue_vs_tb7: change(c.today.revenue, c.avg7?.revenue),
      profit: formatUsd(c.today.profit),
      profit_chenh_tb7: c.avg7 && !c.adsMissing && !c.baselineAdsMissing ? formatUsd(c.today.profit - c.avg7.profit) : null,
      margin: pct(c.today.margin),
      acos: c.today.revenueAds > 0 ? pct(c.today.acos) : null,
      acos_vs_tb7: c.today.revenueAds > 0 && !c.baselineAdsMissing ? pts(c.today.acos, c.avg7?.acos) : null,
      tacos: c.today.revenue > 0 ? pct(c.today.tacos) : null,
      tacos_vs_tb7: c.today.revenue > 0 && !c.baselineAdsMissing ? pts(c.today.tacos, c.avg7?.tacos) : null,
    })),
    viec_can_lam: analysis.actions.filter((a) => a.team === team.team).map((a) => `${a.label}: ${a.text}`),
  }));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: AI_COMMENTARY_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(data) },
        ],
      }),
      signal: AbortSignal.timeout(AI_COMMENTARY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`AI API lỗi (${response.status})`);
    const body = await response.json();
    const text = String(body?.choices?.[0]?.message?.content || "");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error("AI không trả về JSON");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const comments: Record<string, string> = {};
    for (const team of analysis.teams) {
      const value = parsed[team.team];
      if (typeof value === "string" && value.trim()) comments[team.team] = value.trim().slice(0, 400);
    }
    return Object.keys(comments).length ? comments : null;
  } catch (err) {
    console.warn("[Accounting Report] Không tạo được nhận xét AI, dùng nhận xét do code soạn:", err);
    return null;
  }
}

function aiCommentaryEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  return process.env.DAILY_REPORT_AI_COMMENTARY?.trim().toLowerCase() === "true";
}

export async function reportDailyBusinessData(
  scope: DataScope,
  options: {
    force?: boolean;
    targetDate?: string;
    recipient?: ReportRecipient;
    /** Ghi đè cờ DAILY_REPORT_AI_COMMENTARY. */
    aiCommentary?: boolean;
    /** Ghi đè tên trưởng team trong app_settings. */
    teamLeads?: Record<string, string>;
    /** Chỉ dựng nội dung để xem trước: không gửi, không ghi app_settings. */
    dryRun?: boolean;
  } = {},
): Promise<{ success: boolean; reportedDate: string | null; message: string; preview?: DailyReportPreview }> {
  const sql = await getDatabaseClient();
  const isAutomatic = !options.force && !options.recipient && !options.dryRun;

  let latestDate = options.targetDate?.trim();

  // 1. Không chỉ định ngày: lấy ngày mới nhất (< hôm nay) mà mọi store ĐANG HOẠT ĐỘNG
  //    (có đơn trong 7 ngày gần nhất) đều đã có đơn. Store ngừng nạp dữ liệu không chặn báo cáo.
  if (!latestDate) {
    const completeDateRows = await sql<Array<{ latest_date: string }>>`
      WITH active AS (
        SELECT DISTINCT store_id FROM accounting_orders
        WHERE date IS NOT NULL AND date < CURRENT_DATE
          AND date > (SELECT MAX(date) FROM accounting_orders WHERE date < CURRENT_DATE) - ${ACTIVE_STORE_WINDOW_DAYS}::int
      )
      SELECT o.date::text AS latest_date
      FROM accounting_orders o
      JOIN active a ON a.store_id = o.store_id
      WHERE o.date < CURRENT_DATE
        AND LOWER(COALESCE(o.order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY o.date
      HAVING COUNT(DISTINCT o.store_id) = (SELECT COUNT(*) FROM active)
      ORDER BY o.date DESC
      LIMIT 1
    `;
    latestDate = completeDateRows[0]?.latest_date;
  }

  if (!latestDate) {
    return {
      success: false,
      reportedDate: null,
      message: "Chưa có ngày nào hoàn tất đầy đủ dữ liệu cho tất cả các Store đang hoạt động.",
    };
  }

  // 2. Kiểm tra nhanh đã báo cáo ngày này (hoặc ngày mới hơn) chưa
  const settingKey = `lark_accounting_last_reported_date:${scope.teamId}`;
  if (isAutomatic) {
    const settingRows = await sql<Array<{ value: string }>>`
      SELECT value FROM app_settings
      WHERE key = ${settingKey}
      LIMIT 1
    `;
    const rawVal = settingRows[0]?.value;
    let lastReportedDate = "";
    try {
      lastReportedDate = rawVal ? JSON.parse(rawVal)?.date : "";
    } catch {
      lastReportedDate = rawVal || "";
    }
    if (lastReportedDate && lastReportedDate >= latestDate) {
      return {
        success: true,
        reportedDate: latestDate,
        message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.`,
      };
    }
  }

  // 3. Số liệu từng kênh + so sánh, chấm đèn, việc cần làm (tính bằng code)
  const channels = await loadChannelSeries(latestDate);
  if (!channels.length) {
    return { success: false, reportedDate: latestDate, message: `Không có kênh nào có số liệu trong 7 ngày tính đến ${latestDate}.` };
  }
  const analysis = analyzeDailyReport(latestDate, channels);

  // 4. Nhận xét team: AI (nếu bật) diễn đạt từ số đã tính; lỗi thì dùng bản do code soạn
  const teamLeads = options.teamLeads ?? (await loadTeamLeads(scope.teamId));
  const teamComments = aiCommentaryEnabled(options.aiCommentary)
    ? await generateTeamComments(analysis, teamLeads)
    : null;
  const cardOptions = { teamLeads, teamComments: teamComments ?? undefined };
  const card = buildDailyReportCard(analysis, cardOptions);
  const text = buildDailyReportText(analysis, cardOptions);

  if (options.dryRun) {
    return {
      success: true,
      reportedDate: latestDate,
      message: `Xem trước báo cáo ngày ${displayDate(latestDate)} cho ${channels.length} kênh (chưa gửi).`,
      preview: { card, text, analysis, teamComments },
    };
  }

  // 5. Chống gửi trùng khi nhiều lần import kết thúc cùng lúc: chiếm ngày báo cáo trước khi gửi
  if (isAutomatic) {
    const claimed = await sql<Array<{ key: string }>>`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${settingKey}, ${JSON.stringify({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      WHERE COALESCE(
        CASE WHEN app_settings.value ~ '^\\s*\\{' THEN app_settings.value::jsonb ->> 'date' ELSE app_settings.value END,
        ''
      ) < ${latestDate}
      RETURNING key
    `;
    if (!claimed.length) {
      return { success: true, reportedDate: latestDate, message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.` };
    }
  }

  // 6. Gửi card Lark (card lỗi thì notifyLarkEventBestEffort gửi bản text)
  if (options.recipient) {
    await sendLarkCardNotification(card, options.recipient);
  } else {
    await notifyLarkEventBestEffort(
      { teamId: scope.teamId, actorId: "system" },
      "accounting",
      { card, fallbackText: text },
    );
  }

  if (options.force && !options.recipient) {
    // Gửi ép (force) không đi qua bước chiếm ngày ở trên nên ghi lại ngày đã báo cáo ở đây
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${settingKey}, ${JSON.stringify({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value, updated_at = NOW()
    `;
  }

  return {
    success: true,
    reportedDate: latestDate,
    message: `Đã gửi báo cáo kinh doanh ngày ${displayDate(latestDate)} cho ${channels.length} kênh qua Lark bot.`,
  };
}

/**
 * Tự động kích hoạt kiểm tra và gửi báo cáo kinh doanh ngày qua Lark sau mỗi lần nạp file đơn hàng / dữ liệu.
 * Chạy bất đồng bộ an toàn (best-effort), không làm chậm hoặc lỗi luồng nạp file chính.
 */
export async function triggerDailyReportCheckAfterImport(teamId: string = "default"): Promise<void> {
  try {
    const scope: DataScope = { teamId, actorId: "system" };
    const result = await reportDailyBusinessData(scope);
    if (result.success && result.reportedDate) {
      console.log(`[Auto Daily Report] Đã tự động gửi báo cáo ngày ${result.reportedDate} qua Lark: ${result.message}`);
    } else {
      console.log(`[Auto Daily Report] Kiểm tra sau import: ${result.message}`);
    }
  } catch (err) {
    console.warn("[Auto Daily Report] Lỗi khi tự động kích hoạt báo cáo kế toán:", err);
  }
}
