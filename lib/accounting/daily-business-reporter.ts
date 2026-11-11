import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { listFbaDaily, type FbaDailyItem } from "@/lib/accounting/fba-daily-db";
import { listFbmDaily } from "@/lib/accounting/fbm-financials-db";
import type { DashboardDay } from "@/lib/accounting/dashboard-totals";
import { parseStoreTeams, storeHasFbaTeam, storeHasTeam } from "@/lib/accounting/store-teams";
import {
  analyzeDailyReport,
  shiftIsoDate,
  type ChannelDrill,
  type ChannelSeriesInput,
  type DailyReportAnalysis,
  type ReportChannel,
} from "@/lib/accounting/daily-report-analysis";
import {
  buildDailyReportDetailCard,
  buildDailyReportDetailText,
  displayDate,
} from "@/lib/accounting/daily-report-card";
import { buildTeamReport, buildTeamReportCard, buildTeamReportText, sameDayLastMonth } from "@/lib/accounting/daily-team-report";
import { buildDailyReportHtml, renderHtmlToPng } from "@/lib/accounting/daily-report-image";
import { buildDailyReportBrief } from "@/lib/accounting/daily-report-brief";
import { comparableRows, diagnosisBlock, fallingMovers, storeAlert, toMover } from "@/lib/accounting/daily-report-diagnosis";
import { buildDailyReportStoreCard } from "@/lib/accounting/daily-report-store-card";
import {
  notifyLarkEventBestEffort,
  sendLarkCardNotification,
  sendLarkImageNotification,
  uploadLarkImage,
  type LarkRecipient,
} from "@/lib/lark-notifications";

/** Store có đơn trong N ngày gần nhất mới tính là "đang hoạt động". */
const ACTIVE_STORE_WINDOW_DAYS = 7;
/** Store tạo trong N ngày gần đây = kênh mới. */
const NEW_CHANNEL_DAYS = 30;

type ReportRecipient = { receiveId: string; receiveIdType: string };

export interface DailyReportPreview {
  card: Record<string, unknown>;
  text: string;
  analysis: DailyReportAnalysis;
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
export async function loadChannelSeries(date: string, storeNames?: string[], from?: string): Promise<ChannelSeriesInput[]> {
  const sql = await getDatabaseClient();
  const activeFrom = shiftIsoDate(date, -(ACTIVE_STORE_WINDOW_DAYS - 1));
  const last7From = shiftIsoDate(date, -7);
  const historyFrom = from && from < last7From ? from : last7From;
  const nameFilter = storeNames?.map((n) => n.trim().toUpperCase()).filter(Boolean);

  const stores = (await sql<Array<{ id: string; name: string; team: string | null; created_at: string; first_created_at: string }>>`
      SELECT id, name, team, created_at::date::text AS created_at,
        (SELECT MIN(created_at)::date::text FROM stores) AS first_created_at
      FROM stores
      WHERE EXISTS (
        SELECT 1 FROM accounting_orders o
        WHERE o.store_id = stores.id AND o.date BETWEEN ${activeFrom}::date AND ${date}::date
      )
      ORDER BY name ASC
  `).filter((s) => !nameFilter || nameFilter.includes(s.name.trim().toUpperCase()));

  // Kênh mới = store tạo sau đợt khởi tạo hệ thống và trong 30 ngày gần đây. Không dựa vào ngày
  // có đơn đầu tiên vì lịch sử đơn trong DB ngắn hơn tuổi thật của store.
  const newSince = shiftIsoDate(date, -(NEW_CHANNEL_DAYS - 1));
  const isNewStore = (store: (typeof stores)[number]) =>
    store.created_at > store.first_created_at && store.created_at >= newSince;

  const drills = await loadChannelDrills(stores.map((s) => s.id), date);

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
          drill: drills.get(`${store.id}:${channel}`),
        };
      } catch (err) {
        console.warn(`[Accounting Report] Không thể lấy dữ liệu ${store.name} ${channel}:`, err);
        return null;
      }
    });
  });

  return (await Promise.all(tasks)).filter((c): c is ChannelSeriesInput => c !== null);
}

/** Units/ngày theo SKU và chi tiêu Ads/ngày theo portfolio: ngày báo cáo vs TB 7 ngày trước. */
async function loadChannelDrills(storeIds: string[], date: string): Promise<Map<string, ChannelDrill>> {
  const drills = new Map<string, ChannelDrill>();
  if (!storeIds.length) return drills;
  const sql = await getDatabaseClient();
  const yesterday = shiftIsoDate(date, -1);
  const from = shiftIsoDate(date, -7);
  const [skuRows, adsRows] = await Promise.all([
    sql<Array<{ store_id: string; channel: string; sku: string; today: number; avg7: number }>>`
      SELECT store_id,
        CASE WHEN fulfillment_channel = 'Merchant' THEN 'FBM' ELSE 'FBA' END AS channel,
        UPPER(TRIM(sku)) AS sku,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(quantity, 1) ELSE 0 END)::float AS today,
        (SUM(CASE WHEN date < ${date}::date THEN COALESCE(quantity, 1) ELSE 0 END) / 7.0)::float AS avg7
      FROM accounting_orders
      WHERE store_id = ANY(${storeIds}::uuid[])
        AND date BETWEEN ${from}::date AND ${date}::date
        AND COALESCE(TRIM(sku), '') <> ''
        AND LOWER(COALESCE(order_status, '')) NOT IN ('cancelled', 'canceled')
      GROUP BY 1, 2, 3
    `,
    sql<Array<{
      store_id: string; channel: string; name: string; today_spend: number; today_sales: number; today_orders: number; avg7_spend: number;
      today_impressions: number; today_clicks: number; y_spend: number; y_sales: number; y_orders: number; y_impressions: number; y_clicks: number;
    }>>`
      SELECT store_id,
        UPPER(TRIM(loai)) AS channel,
        COALESCE(NULLIF(TRIM(sku), ''), portfolio) AS name,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(spend, 0) ELSE 0 END)::float AS today_spend,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(sales, 0) ELSE 0 END)::float AS today_sales,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(orders, 0) ELSE 0 END)::float AS today_orders,
        (SUM(CASE WHEN date < ${date}::date THEN COALESCE(spend, 0) ELSE 0 END) / 7.0)::float AS avg7_spend,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(impressions, 0) ELSE 0 END)::float AS today_impressions,
        SUM(CASE WHEN date = ${date}::date THEN COALESCE(clicks, 0) ELSE 0 END)::float AS today_clicks,
        SUM(CASE WHEN date = ${yesterday}::date THEN COALESCE(spend, 0) ELSE 0 END)::float AS y_spend,
        SUM(CASE WHEN date = ${yesterday}::date THEN COALESCE(sales, 0) ELSE 0 END)::float AS y_sales,
        SUM(CASE WHEN date = ${yesterday}::date THEN COALESCE(orders, 0) ELSE 0 END)::float AS y_orders,
        SUM(CASE WHEN date = ${yesterday}::date THEN COALESCE(impressions, 0) ELSE 0 END)::float AS y_impressions,
        SUM(CASE WHEN date = ${yesterday}::date THEN COALESCE(clicks, 0) ELSE 0 END)::float AS y_clicks
      FROM accounting_ads
      WHERE store_id = ANY(${storeIds}::uuid[])
        AND date BETWEEN ${from}::date AND ${date}::date
        AND UPPER(TRIM(loai)) IN ('FBA', 'FBM')
      GROUP BY 1, 2, 3
    `,
  ]);
  const drillOf = (storeId: string, channel: string) => {
    const key = `${storeId}:${channel}`;
    let drill = drills.get(key);
    if (!drill) drills.set(key, (drill = { skus: [], portfolios: [] }));
    return drill;
  };
  for (const r of skuRows) drillOf(r.store_id, r.channel).skus.push({ sku: r.sku, today: Number(r.today), avg7: Number(r.avg7) });
  for (const r of adsRows) {
    drillOf(r.store_id, r.channel).portfolios.push({
      name: r.name,
      todaySpend: Number(r.today_spend),
      todaySales: Number(r.today_sales),
      todayOrders: Number(r.today_orders),
      avg7Spend: Number(r.avg7_spend),
      todayImpressions: Number(r.today_impressions),
      todayClicks: Number(r.today_clicks),
      yesterday: {
        spend: Number(r.y_spend),
        sales: Number(r.y_sales),
        orders: Number(r.y_orders),
        impressions: Number(r.y_impressions),
        clicks: Number(r.y_clicks),
      },
    });
  }
  return drills;
}

/** Tên trưởng team, lưu ở app_settings dạng {"FBA 1": "Quỳnh", ...}. */
async function loadTeamLeads(teamId: string): Promise<Record<string, string>> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ value: unknown }>>`
    SELECT value FROM app_settings WHERE key = ${`daily_report_team_leads:${teamId}`} LIMIT 1
  `;
  const raw = rows[0]?.value;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Ngày mới nhất (< hôm nay) mà mọi store ĐANG HOẠT ĐỘNG (có đơn trong 7 ngày gần nhất) đều đã có đơn. */
export async function latestCompleteDate(): Promise<string | undefined> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ latest_date: string }>>`
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
  return rows[0]?.latest_date;
}

export async function reportDailyBusinessData(
  scope: DataScope,
  options: {
    force?: boolean;
    targetDate?: string;
    recipient?: ReportRecipient;
    /** Ghi đè tên trưởng team trong app_settings. */
    teamLeads?: Record<string, string>;
    /** Chỉ dựng nội dung để xem trước: không gửi, không ghi app_settings. */
    dryRun?: boolean;
  } = {},
): Promise<{ success: boolean; reportedDate: string | null; message: string; preview?: DailyReportPreview }> {
  const sql = await getDatabaseClient();
  const isAutomatic = !options.force && !options.recipient && !options.dryRun;

  // 1. Không chỉ định ngày: ngày mới nhất mà mọi store đang hoạt động đã có đơn.
  //    Store ngừng nạp dữ liệu không chặn báo cáo.
  const latestDate = options.targetDate?.trim() || (await latestCompleteDate());
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
    const lastReportedDate = await lastReportedDateOf(settingKey);
    if (lastReportedDate && lastReportedDate >= latestDate) {
      return {
        success: true,
        reportedDate: latestDate,
        message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.`,
      };
    }
  }

  // 3. Số liệu từng kênh → chỉ số theo team, so với hôm qua và cùng ngày tháng trước
  const channels = await loadChannelSeries(latestDate, undefined, sameDayLastMonth(latestDate));
  if (!channels.length) {
    return { success: false, reportedDate: latestDate, message: `Không có kênh nào có số liệu trong 7 ngày tính đến ${latestDate}.` };
  }
  const analysis = analyzeDailyReport(latestDate, channels);
  const teamLeads = options.teamLeads ?? (await loadTeamLeads(scope.teamId));
  const cardOptions = {
    teamLeads,
    warnings: analysis.warnings,
    alerts: fallingMovers(channels, latestDate).slice(0, 2).map((m) => ({
      storeName: m.storeName,
      team: m.team,
      text: storeAlert(m, teamLeads[m.team]?.trim() || undefined),
    })),
    missingStores: await loadStaleStores(latestDate, channels.map((c) => c.storeName)),
  };
  const roster = await sql<Array<{ name: string; team: string | null }>>`SELECT name, team FROM stores ORDER BY name`;
  const teamReport = buildTeamReport(latestDate, channels, roster);
  const card = buildTeamReportCard(teamReport, cardOptions);
  const text = buildTeamReportText(teamReport, cardOptions);

  if (options.dryRun) {
    return {
      success: true,
      reportedDate: latestDate,
      message: `Xem trước báo cáo ngày ${displayDate(latestDate)} cho ${new Set(channels.map((c) => c.storeName)).size} store (chưa gửi).`,
      preview: { card, text, analysis },
    };
  }

  // 4. Chống gửi trùng khi nhiều lần import kết thúc cùng lúc: chiếm ngày báo cáo trước khi gửi
  if (isAutomatic) {
    const claimed = await sql<Array<{ key: string }>>`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${settingKey}, ${sql.json({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      WHERE COALESCE(
        CASE
          WHEN jsonb_typeof(app_settings.value) = 'object' THEN app_settings.value ->> 'date'
          WHEN jsonb_typeof(app_settings.value) = 'string' AND (app_settings.value #>> '{}') ~ '^\\s*\\{'
            THEN (app_settings.value #>> '{}')::jsonb ->> 'date'
          WHEN jsonb_typeof(app_settings.value) = 'string' THEN app_settings.value #>> '{}'
          ELSE ''
        END,
        ''
      ) < ${latestDate}
      RETURNING key
    `;
    if (!claimed.length) {
      return { success: true, reportedDate: latestDate, message: `Dữ liệu ngày ${latestDate} đã được gửi báo cáo trước đó.` };
    }
  }

  // 5. Gửi card Lark (card lỗi thì notifyLarkEventBestEffort gửi bản text)
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
      VALUES (${settingKey}, ${sql.json({ date: latestDate })}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value, updated_at = NOW()
    `;
  }

  return {
    success: true,
    reportedDate: latestDate,
    message: `Đã gửi báo cáo kinh doanh ngày ${displayDate(latestDate)} cho ${new Set(channels.map((c) => c.storeName)).size} store qua Lark bot.`,
  };
}

async function lastReportedDateOf(settingKey: string): Promise<string> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ value: unknown }>>`
    SELECT value FROM app_settings
    WHERE key = ${settingKey}
    LIMIT 1
  `;
  const rawVal = rows[0]?.value;
  if (typeof rawVal === "string") {
    try {
      const parsed = JSON.parse(rawVal);
      return typeof parsed === "object" && parsed ? (parsed as { date?: string }).date || "" : String(parsed || "");
    } catch {
      return rawVal;
    }
  }
  if (typeof rawVal === "object" && rawVal !== null) return (rawVal as { date?: string }).date || "";
  return "";
}

/**
 * Bản chi tiết (tầng 2), gửi khi có người nhắn bot "báo cáo chi tiết [dd/mm]".
 * Không chỉ định ngày thì lấy ngày đã gửi báo cáo gần nhất. `storeNames` giới hạn theo store người hỏi được xem.
 */
export async function sendDailyReportDetail(options: {
  teamId?: string;
  targetDate?: string;
  storeNames?: string[];
  recipient: LarkRecipient;
  dryRun?: boolean;
}): Promise<{ success: boolean; message: string; text?: string; card?: Record<string, unknown> }> {
  const teamId = options.teamId || "default";
  const date = options.targetDate?.trim()
    || (await lastReportedDateOf(`lark_accounting_last_reported_date:${teamId}`))
    || (await latestCompleteDate());
  if (!date) return { success: false, message: "Chưa có ngày nào đủ dữ liệu để lập báo cáo." };

  const channels = await loadChannelSeries(date, options.storeNames);
  if (!channels.length) return { success: false, message: `Không có kênh nào bạn được xem có số liệu ngày ${displayDate(date)}.` };

  const analysis = analyzeDailyReport(date, channels);
  const cardOptions = { teamLeads: await loadTeamLeads(teamId) };
  const card = buildDailyReportDetailCard(analysis, cardOptions);
  const text = buildDailyReportDetailText(analysis, cardOptions);
  if (!options.dryRun) await sendLarkCardNotification(card, options.recipient);
  return { success: true, message: `Đã gửi báo cáo chi tiết ngày ${displayDate(date)}.`, text, card };
}

/**
 * Báo cáo ngày dạng ảnh PNG (cùng phân tích với card, thêm so với hôm qua + xu hướng 8 ngày).
 * Có `recipient` thì upload ảnh lên Lark và gửi; không thì chỉ trả ảnh để xem trước.
 */
export async function sendDailyReportImage(options: {
  teamId?: string;
  targetDate?: string;
  recipient?: LarkRecipient;
}): Promise<{ success: boolean; message: string; reportedDate?: string; png?: Buffer; html?: string }> {
  const teamId = options.teamId || "default";
  const date = options.targetDate?.trim() || (await latestCompleteDate());
  if (!date) return { success: false, message: "Chưa có ngày nào đủ dữ liệu để lập báo cáo." };

  const channels = await loadChannelSeries(date);
  if (!channels.length) return { success: false, message: `Không có kênh nào có số liệu ngày ${displayDate(date)}.` };

  const analysis = analyzeDailyReport(date, channels);
  const html = buildDailyReportHtml(analysis, channels, { teamLeads: await loadTeamLeads(teamId) });
  const png = await renderHtmlToPng(html);
  if (options.recipient) {
    const imageKey = await uploadLarkImage(png, `bao-cao-${date}.png`);
    await sendLarkImageNotification(imageKey, options.recipient);
  }
  return { success: true, reportedDate: date, message: `Đã dựng ảnh báo cáo ngày ${displayDate(date)} (${channels.length} kênh).`, png, html };
}

/**
 * Báo cáo ngày dạng card text (so với hôm qua + TB 7 ngày). `layout`:
 * - "brief": thiếu dữ liệu → 4 KPI → Team / Store (mỗi kênh 1 dòng) → biến động nổi bật.
 * - "stores": tổng + team ở trên, mỗi store 1 mục thu gọn.
 * Có `recipient` thì gửi qua Lark; không thì chỉ trả card để xem trước.
 */
export async function sendDailyReportStoreCard(options: {
  teamId?: string;
  targetDate?: string;
  recipient?: LarkRecipient;
  layout?: "brief" | "stores";
}): Promise<{ success: boolean; message: string; reportedDate?: string; card?: Record<string, unknown> }> {
  const teamId = options.teamId || "default";
  const date = options.targetDate?.trim() || (await latestCompleteDate());
  if (!date) return { success: false, message: "Chưa có ngày nào đủ dữ liệu để lập báo cáo." };

  const channels = await loadChannelSeries(date);
  if (!channels.length) return { success: false, message: `Không có kênh nào có số liệu ngày ${displayDate(date)}.` };

  const analysis = analyzeDailyReport(date, channels);
  const cardOptions = { teamLeads: await loadTeamLeads(teamId) };
  if (options.layout === "stores") {
    const card = buildDailyReportStoreCard(analysis, channels, cardOptions);
    if (options.recipient) await sendLarkCardNotification(card, options.recipient);
    return { success: true, reportedDate: date, message: `Đã dựng card báo cáo ngày ${displayDate(date)} (${channels.length} kênh).`, card };
  }

  const card = buildDailyReportBrief(analysis, channels, {
    ...cardOptions,
    staleStores: await loadStaleStores(date, channels.map((c) => c.storeName)),
  });
  if (options.recipient) await sendLarkCardNotification(card, options.recipient);
  return { success: true, reportedDate: date, message: `Đã dựng card báo cáo ngày ${displayDate(date)} (${channels.length} kênh).`, card };
}

/**
 * Rà soát kinh doanh 1 ngày cho AI Agent (tool getBusinessReview): cùng phân tích với báo cáo ngày,
 * trả về dữ liệu gọn để AI diễn đạt — rủi ro, cơ hội đã xếp hạng sẵn, không để AI tự tính.
 */
export async function getDailyBusinessReview(options: { targetDate?: string; storeNames?: string[] } = {}) {
  const date = options.targetDate?.trim() || (await latestCompleteDate());
  if (!date) return { error: "Chưa có ngày nào đủ dữ liệu để rà soát." };
  const channels = await loadChannelSeries(date, options.storeNames);
  if (!channels.length) return { error: `Không có kênh nào được xem có số liệu ngày ${displayDate(date)}.` };
  const a = analyzeDailyReport(date, channels);
  const item = (ch: DailyReportAnalysis["priorities"][number]) => ({
    kenh: ch.label,
    team: ch.team,
    muc_do: ch.review?.severity === "high" ? "cao" : ch.review?.severity === "medium" ? "theo dõi" : "tốt",
    hien_tuong: ch.profitDelta != null ? `Profit ${ch.profitDelta >= 0 ? "tăng" : "giảm"} $${Math.abs(Math.round(ch.profitDelta))} so với TB 7 ngày` : "Revenue $0",
    yeu_to_dong_gop: ch.review?.facts ?? [],
    nguyen_nhan_can_xac_minh: ch.review?.checks ?? [],
    hanh_dong: ch.review?.actions ?? [],
  });
  const t = a.company.today;
  const b = a.company.avg7;
  return {
    ngay: date,
    moc_so_sanh: "TB 7 ngày trước",
    canh_bao_du_lieu: a.warnings,
    ket_qua: {
      revenue: Math.round(t.revenue),
      profit: Math.round(t.profit),
      margin_pct: Number((t.margin * 100).toFixed(1)),
      tacos_pct: Number((t.tacos * 100).toFixed(1)),
      profit_tb7: b && a.company.comparable ? Math.round(b.profit) : null,
      revenue_tb7: b ? Math.round(b.revenue) : null,
    },
    theo_team: a.teams.map((team) => ({
      team: team.team,
      profit: Math.round(team.today.profit),
      profit_vs_tb7: team.avg7 && team.comparable ? Math.round(team.today.profit - team.avg7.profit) : null,
    })),
    rui_ro: a.priorities.map(item),
    co_hoi: a.opportunities.map(item),
  };
}

/** Nhận diện tin nhắn xin bản chi tiết: "báo cáo chi tiết", "chi tiết báo cáo 28/10"... Trả về ngày (YYYY-MM-DD) nếu có. */
export function parseDailyReportDetailRequest(message: string, today = new Date()): { date?: string } | null {
  const text = message.normalize("NFC").toLowerCase();
  const asksDetail = /chi\s*ti[eế]t/.test(text) && /(b[aá]o\s*c[aá]o|report)/.test(text);
  if (!asksDetail) return null;
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (!match) return {};
  const year = match[3] ? Number(match[3]) : today.getFullYear();
  const date = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ? {} : { date };
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
  // Cảnh báo bất thường: tắt sẵn, chỉ chạy khi LARK_ANOMALY_ALERTS_ENABLED=1 (mỗi ngày dữ liệu gửi 1 lần)
  if (process.env.LARK_ANOMALY_ALERTS_ENABLED?.trim() === "1") {
    try {
      const { sendAnomalyAlerts } = await import("./lark-proactive-alerts");
      const result = await sendAnomalyAlerts();
      console.log(`[Lark Alerts] Sau import: ${JSON.stringify({ ...result, previews: undefined })}`);
    } catch (err) {
      console.warn("[Lark Alerts] Lỗi khi gửi cảnh báo bất thường:", err);
    }
  }
}

/**
 * Store đã ngừng cập nhật (không có đơn trong 7 ngày tới ngày báo cáo nhưng có số trong 60 ngày trước):
 * loadChannelSeries bỏ qua các store này, nên phải cảnh báo riêng để số tổng không trông như đủ.
 */
async function loadStaleStores(date: string, reportedStores: string[]): Promise<Array<{ name: string; team: string | null; lastDate: string }>> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ name: string; team: string | null; last_date: string }>>`
    SELECT s.name, MAX(s.team) AS team, MAX(o.date)::text AS last_date
    FROM stores s
    JOIN accounting_orders o ON o.store_id = s.id
    WHERE o.date BETWEEN ${shiftIsoDate(date, -60)}::date AND ${date}::date
    GROUP BY s.name
    HAVING MAX(o.date) < ${date}::date
    ORDER BY s.name
  `;
  const reported = new Set(reportedStores);
  return rows.filter((r) => !reported.has(r.name)).map((r) => ({ name: titleCase(r.name), team: r.team, lastDate: r.last_date }));
}

/** Nhận diện "phân tích Warmstorey", "phan tich fastpeace fba 03/11"... Trả về ngày (YYYY-MM-DD) nếu có. */
export function parseChannelDiagnosisRequest(message: string, today = new Date()): { date?: string } | null {
  const text = message.normalize("NFC").toLowerCase();
  if (!/^\s*(?:@\S+\s+)?ph[aâ]n\s*t[ií]ch\b/.test(text)) return null;
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (!match) return {};
  const year = match[3] ? Number(match[3]) : today.getFullYear();
  const date = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()) ? {} : { date };
}

/**
 * Phân tích nguyên nhân Δ Profit so với hôm qua cho store được nhắc trong tin nhắn (theo yêu cầu, không qua AI).
 * Không nhận ra store nào thì `matched: false` để AI trả lời như câu hỏi thường.
 */
export async function sendChannelDiagnosis(options: {
  message: string;
  teamId?: string;
  targetDate?: string;
  storeNames?: string[];
  recipient?: LarkRecipient;
  dryRun?: boolean;
}): Promise<{ matched: boolean; success: boolean; message: string; text?: string; card?: Record<string, unknown> }> {
  const teamId = options.teamId || "default";
  const date = options.targetDate?.trim()
    || (await lastReportedDateOf(`lark_accounting_last_reported_date:${teamId}`))
    || (await latestCompleteDate());
  if (!date) return { matched: true, success: false, message: "Chưa có ngày nào đủ dữ liệu để phân tích." };

  const channels = await loadChannelSeries(date, options.storeNames);
  const text = options.message.toLowerCase();
  const wantsChannel = /\bfbm\b/.test(text) ? "FBM" : /\bfba\b/.test(text) ? "FBA" : null;
  const picked = channels.filter((c) => text.includes(c.storeName.toLowerCase()) && (!wantsChannel || c.channel === wantsChannel));
  if (!picked.length) return { matched: false, success: false, message: "" };

  const teamLeads = await loadTeamLeads(teamId);
  const { comparable, excluded } = comparableRows(picked, date);
  const blocks = [
    ...comparable.map((r) => diagnosisBlock(toMover(r), teamLeads[r.input.team]?.trim() || undefined)),
    ...excluded.map((reason) => `⚠️ ${reason} — chưa phân tích được`),
  ];
  const card = {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: `🔎 Phân tích ${titleCase(picked[0].storeName)} · ${displayDate(date)}` },
      subtitle: { tag: "plain_text", content: "So với hôm qua · Số liệu → Phân rã → Cần kiểm tra (giả thuyết) → Action" },
    },
    body: {
      elements: [
        ...blocks.flatMap((content, i) => [...(i ? [{ tag: "hr" }] : []), { tag: "markdown", content }]),
        {
          tag: "markdown",
          text_size: "notation",
          content: "<font color='grey'>Phân rã: doanh số = ΔRevenue × biên trước Ads hôm qua · chi Ads = −ΔAds · biên = phần còn lại (giá vốn, phí, refund, promotion). BE ACoS = mức ACoS quảng cáo hòa vốn. \"Cần kiểm tra\" là giả thuyết, chưa phải kết luận.</font>",
        },
      ],
    },
  };
  if (options.recipient && !options.dryRun) await sendLarkCardNotification(card, options.recipient);
  return {
    matched: true,
    success: true,
    message: `Đã phân tích ${picked.map((c) => c.label).join(", ")} ngày ${displayDate(date)}.`,
    text: blocks.join("\n\n").replace(/<\/?font[^>]*>/g, "").replace(/\*\*/g, ""),
    card,
  };
}
