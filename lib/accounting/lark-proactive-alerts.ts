import "server-only";

// Cảnh báo chủ động qua Lark (TẮT SẴN — chỉ chạy khi bật biến môi trường):
//   LARK_ANOMALY_ALERTS_ENABLED=1  → sau mỗi lần nạp dữ liệu: Revenue rơi mạnh, ACOS tăng vọt / Ads không ra sales, SKU sắp hết hàng
//   LARK_WEEKLY_SUMMARY_ENABLED=1  → sáng Thứ Hai (LARK_WEEKLY_SUMMARY_HOUR, mặc định 8h giờ VN): tóm tắt tuần từng store
// Người nhận: chỉ tin nhắn riêng, cho người (1) đã liên kết Lark, (2) bật nhận thông báo "Kế toán" trong cài đặt Lark cá nhân,
// (3) được cấp quyền hỏi đáp store đó (bảng Phân quyền Store). Mỗi người chỉ thấy store của mình.
// Listing bị suppressed: hệ thống chưa có nguồn dữ liệu (chưa tải báo cáo listing từ Amazon) nên chưa cảnh báo.

import { getDatabaseClient } from "@/lib/db";
import { sendLarkCardNotification, sendLarkTextNotification } from "@/lib/lark-notifications";
import { latestCompleteDate, loadChannelSeries } from "./daily-business-reporter";
import { listStores } from "./accounting-db";
import { getKpi } from "./kpi-db";
import { listSkuWin } from "./sku-win-db";
import {
  compareWeeks,
  detectAnomalies,
  mondayOf,
  monthPace,
  shiftDate,
  summarizeKpi,
  vnDate,
  vnToday,
  vnWeekdayHour,
} from "./lark-insights-calc";
import { kpiHeadline, loadStockRows, stockThresholds, toAccountingStoreName } from "./lark-insight-tools";

export const anomalyAlertsEnabled = () => process.env.LARK_ANOMALY_ALERTS_ENABLED?.trim() === "1";
export const weeklySummaryEnabled = () => process.env.LARK_WEEKLY_SUMMARY_ENABLED?.trim() === "1";

export interface AlertRecipient {
  teamId: string;
  actorId: string;
  name: string;
  receiveId: string;
  receiveIdType: string;
  storeNames: string[];
}

/** Người nhận + đúng các store họ được cấp quyền hỏi đáp. */
export async function loadAlertRecipients(): Promise<AlertRecipient[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ team_id: string; actor_id: string; name: string; receive_id: string; receive_id_type: string; stores: string[] }>>`
    SELECT c.team_id, c.actor_id, COALESCE(u.display_name, u.username) AS name, c.receive_id, c.receive_id_type,
      ARRAY_AGG(DISTINCT s.name ORDER BY s.name) AS stores
    FROM lark_user_connections c
    JOIN app_users u ON u.team_id = c.team_id AND u.user_id = c.actor_id AND u.status = 'approved'
    JOIN lark_notification_preferences p
      ON p.team_id = c.team_id AND p.actor_id = c.actor_id AND p.category = 'accounting' AND p.personal_enabled = TRUE
    JOIN ppc_store_user_access a ON a.team_id = c.team_id AND a.actor_id = c.actor_id AND a.can_ask_lark = TRUE
    JOIN ppc_stores s ON s.id = a.store_id AND s.team_id = a.team_id
    WHERE c.enabled = TRUE AND COALESCE(TRIM(c.receive_id), '') <> ''
    GROUP BY 1, 2, 3, 4, 5
  `;
  return rows.map((r) => ({
    teamId: r.team_id,
    actorId: r.actor_id,
    name: r.name,
    receiveId: r.receive_id,
    receiveIdType: r.receive_id_type,
    // Tên store kế toán (HSOSTORE → WARMSTOREY) để khớp số liệu
    storeNames: [...new Set(r.stores.map(toAccountingStoreName))],
  }));
}

/** Chiếm khóa gửi 1 lần (chống gửi trùng khi nhiều lần import / nhiều worker). */
async function claimOnce(key: string): Promise<boolean> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ key: string }>>`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${sql.json({ at: new Date().toISOString() })}, NOW())
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `;
  return rows.length > 0;
}

const card = (title: string, template: string, markdown: string) => ({
  schema: "2.0",
  config: { width_mode: "fill" },
  header: { template, title: { tag: "plain_text", content: title } },
  body: { elements: [{ tag: "markdown", content: markdown }, { tag: "hr" }, { tag: "markdown", content: "AI Agent | Cảnh báo tự động · tắt/bật trong Cài đặt thông báo Lark (mục Kế toán)" }] },
});

async function deliver(r: AlertRecipient, title: string, template: string, markdown: string) {
  const recipient = { receiveId: r.receiveId, receiveIdType: r.receiveIdType };
  try {
    await sendLarkCardNotification(card(title, template, markdown), recipient);
  } catch {
    await sendLarkTextNotification(`${title}\n\n${markdown}`, recipient);
  }
}

const usd = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`);
const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const signedPct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "🔺+" : "🔻"}${(v * 100).toFixed(1)}%`);

// ───────────── 9. Cảnh báo bất thường ─────────────

const STOCK_ALERT_DAYS = 7;

/** Nội dung cảnh báo từng store (chung cho mọi người nhận, rồi lọc theo quyền). */
export async function buildAnomalyContent(date: string, storeNames: string[]): Promise<Map<string, string[]>> {
  const byStore = new Map<string, string[]>();
  const push = (store: string, line: string) => {
    const key = store.toUpperCase();
    byStore.set(key, [...(byStore.get(key) ?? []), line]);
  };

  const channels = await loadChannelSeries(date, storeNames);
  for (const ch of channels) {
    if (ch.isNew) continue;
    for (const a of detectAnomalies(ch.days, date)) {
      const icon = a.kind === "revenue_drop" ? "🔻" : "📢";
      push(ch.storeName, `${icon} ${ch.channel}: ${a.text}`);
    }
  }

  // SKU sắp hết hàng (FBA): còn bán ≤ 7 ngày, chỉ SKU bán ≥ 1 unit/ngày
  const stores = await listStores();
  const wanted = new Set(storeNames.map((s) => s.toUpperCase()));
  const th = stockThresholds({ lowDays: STOCK_ALERT_DAYS });
  for (const store of stores.filter((s) => wanted.has(s.name.toUpperCase()))) {
    try {
      const { items, snapshot } = await loadStockRows(store.id, th);
      if (!snapshot) continue; // chưa có Inventory Ledger: không đoán
      const urgent = items
        .filter((x) => x.unitsPerDay >= 1 && (x.level === "het_hang" || x.level === "sap_het"))
        .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0))
        .slice(0, 5);
      for (const x of urgent) {
        const coming = x.inTransit + x.inboundPending;
        push(
          store.name,
          `📦 ${x.sku}: ${x.level === "het_hang" ? "HẾT hàng sẵn bán" : `còn ${x.sellable} (≈${x.daysOfCover} ngày)`}, bán ${x.unitsPerDay}/ngày` +
            (coming ? `, đang về ${coming}${x.nextArrival ? ` (dự kiến ${vnDate(x.nextArrival)})` : ""}` : ", không có hàng đang về"),
        );
      }
    } catch (err) {
      console.warn(`[Lark Alerts] Không đọc được tồn kho ${store.name}:`, err);
    }
  }
  return byStore;
}

export async function sendAnomalyAlerts(options: { date?: string; dryRun?: boolean; force?: boolean } = {}) {
  if (!options.dryRun && !options.force && !anomalyAlertsEnabled()) return { sent: 0, skipped: "disabled" as const };
  const date = options.date || (await latestCompleteDate());
  if (!date) return { sent: 0, skipped: "no_data" as const };
  const recipients = await loadAlertRecipients();
  if (!recipients.length) return { sent: 0, skipped: "no_recipients" as const, date };
  if (!options.dryRun && !options.force && !(await claimOnce(`lark_anomaly_alerts:${date}`))) {
    return { sent: 0, skipped: "already_sent" as const, date };
  }

  const allStores = [...new Set(recipients.flatMap((r) => r.storeNames))];
  const content = await buildAnomalyContent(date, allStores);
  const previews: Array<{ to: string; markdown: string }> = [];
  let sent = 0;
  for (const r of recipients) {
    const blocks = r.storeNames
      .map((s) => ({ s, lines: content.get(s.toUpperCase()) ?? [] }))
      .filter((b) => b.lines.length);
    if (!blocks.length) continue;
    const markdown =
      `Số liệu ngày **${vnDate(date)}** so với TB 7 ngày trước:\n\n` +
      blocks.map((b) => `**${b.s}**\n${b.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n") +
      `\n\n💡 Hỏi bot "phân tích ${blocks[0].s}" hoặc "${blocks[0].s} SKU nào sắp hết hàng?" để xem chi tiết.`;
    previews.push({ to: r.name, markdown });
    if (!options.dryRun) {
      try {
        await deliver(r, `⚠️ Cảnh báo kinh doanh ${vnDate(date)}`, "red", markdown);
        sent += 1;
      } catch (err) {
        console.warn(`[Lark Alerts] Gửi cho ${r.name} lỗi:`, err);
      }
    }
  }
  return { sent, date, previews };
}

// ───────────── 10. Tóm tắt tuần ─────────────

export async function buildWeeklyStoreSummary(storeName: string, weekStart: string, weekEnd: string, dataThrough: string) {
  const lines: string[] = [];
  const channels = await loadChannelSeries(weekEnd, [storeName], shiftDate(weekStart, -7));
  const days = channels.flatMap((c) => c.days);
  if (!days.length) return null;
  const w = compareWeeks(days, weekStart, weekEnd);
  lines.push(
    `💰 Revenue ${usd(w.cur.revenue)} (${signedPct(w.revenueChange)} vs tuần trước) · 💵 Profit ${usd(w.cur.profit)} (tuần trước ${usd(w.prev.profit)})`,
    `📢 Ads ${usd(w.cur.adsFee)} · TACoS ${pctTxt(w.cur.tacos)} (tuần trước ${pctTxt(w.prev.tacos)}) · 📦 ${Math.round(w.cur.quantity)} units`,
  );

  const store = (await listStores()).find((s) => s.name.trim().toUpperCase() === storeName.trim().toUpperCase());
  if (store) {
    try {
      const period = dataThrough.slice(0, 7);
      const kpi = await getKpi(store.id, period);
      const { report, hasTargetCur } = summarizeKpi(kpi);
      if (hasTargetCur) {
        const h = kpiHeadline(report);
        const pace = monthPace(period, dataThrough);
        lines.push(
          `🎯 KPI T${Number(period.slice(5))}: Revenue đạt ${h.revenuePct ?? "—"}%, Gross Profit đạt ${h.grossPct ?? "—"}% mục tiêu tháng (nhịp cần đạt ${Math.round(pace.pace * 100)}%)`,
        );
      }
    } catch (err) {
      console.warn(`[Lark Weekly] KPI ${storeName} lỗi:`, err);
    }
    try {
      const { items } = await listSkuWin(store.id, { status: "all", startDate: weekStart, endDate: weekEnd, limit: 100_000, includeAllTime: false });
      const losers = items.filter((it) => it.profit < -1).sort((a, b) => a.profit - b.profit).slice(0, 3);
      if (losers.length) lines.push(`🔴 SKU lỗ nhất tuần: ${losers.map((it) => `${it.sku} (${usd(it.profit)})`).join(", ")}`);
    } catch (err) {
      console.warn(`[Lark Weekly] SKU ${storeName} lỗi:`, err);
    }
    try {
      const { items, snapshot } = await loadStockRows(store.id, stockThresholds());
      // Chưa có Inventory Ledger thì bỏ dòng tồn kho, không đoán
      const out = items.filter((x) => x.level === "het_hang").length;
      const low = items.filter((x) => x.level === "sap_het").length;
      const reorder = items.filter((x) => x.level === "can_nhap").length;
      if (snapshot && (out || low || reorder)) lines.push(`📦 Tồn kho: ${out} SKU hết hàng, ${low} sắp hết, ${reorder} cần nhập thêm`);
    } catch (err) {
      console.warn(`[Lark Weekly] Tồn kho ${storeName} lỗi:`, err);
    }
  }
  return lines;
}

/** Tuần cần tóm tắt: Thứ Hai → Chủ Nhật tuần trước, cắt tại ngày có dữ liệu mới nhất. */
export function lastWeekRange(today: string, dataThrough: string) {
  const weekStart = shiftDate(mondayOf(today), -7);
  const fullEnd = shiftDate(weekStart, 6);
  const weekEnd = dataThrough < fullEnd ? dataThrough : fullEnd;
  return { weekStart, weekEnd, complete: weekEnd === fullEnd };
}

export async function sendWeeklySummaries(options: { dryRun?: boolean; force?: boolean; today?: string } = {}) {
  if (!options.dryRun && !options.force && !weeklySummaryEnabled()) return { sent: 0, skipped: "disabled" as const };
  const today = options.today || vnToday();
  const dataThrough = await latestCompleteDate();
  if (!dataThrough) return { sent: 0, skipped: "no_data" as const };
  const { weekStart, weekEnd, complete } = lastWeekRange(today, dataThrough);
  if (weekEnd < weekStart) return { sent: 0, skipped: "no_data" as const };
  const recipients = await loadAlertRecipients();
  if (!recipients.length) return { sent: 0, skipped: "no_recipients" as const };
  if (!options.dryRun && !options.force && !(await claimOnce(`lark_weekly_summary:${weekStart}`))) {
    return { sent: 0, skipped: "already_sent" as const, weekStart };
  }

  const summaries = new Map<string, string[] | null>();
  for (const s of new Set(recipients.flatMap((r) => r.storeNames))) {
    try {
      summaries.set(s, await buildWeeklyStoreSummary(s, weekStart, weekEnd, dataThrough));
    } catch (err) {
      console.warn(`[Lark Weekly] ${s} lỗi:`, err);
      summaries.set(s, null);
    }
  }

  const head =
    `Tuần **${vnDate(weekStart)} – ${vnDate(weekEnd)}** so với cùng số ngày tuần trước` +
    (complete ? "" : ` (dữ liệu mới tới ${vnDate(weekEnd)}, chưa đủ tuần)`) +
    ".";
  const previews: Array<{ to: string; markdown: string }> = [];
  let sent = 0;
  for (const r of recipients) {
    const blocks = r.storeNames
      .map((s) => ({ s, lines: summaries.get(s) }))
      .filter((b): b is { s: string; lines: string[] } => Array.isArray(b.lines) && b.lines.length > 0);
    if (!blocks.length) continue;
    const markdown = `${head}\n\n${blocks.map((b) => `**${b.s}**\n${b.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n")}`;
    previews.push({ to: r.name, markdown });
    if (!options.dryRun) {
      try {
        await deliver(r, `📅 Tóm tắt tuần ${vnDate(weekStart)} – ${vnDate(weekEnd)}`, "blue", markdown);
        sent += 1;
      } catch (err) {
        console.warn(`[Lark Weekly] Gửi cho ${r.name} lỗi:`, err);
      }
    }
  }
  return { sent, weekStart, weekEnd, previews };
}

/** Gọi định kỳ (worker): gửi tóm tắt tuần khi tới giờ sáng Thứ Hai. */
export async function maybeSendWeeklySummary(now = new Date()) {
  if (!weeklySummaryEnabled()) return null;
  const hour = Number(process.env.LARK_WEEKLY_SUMMARY_HOUR || 8);
  const { weekday, hour: h } = vnWeekdayHour(now);
  if (weekday !== 1 || h < hour) return null;
  return sendWeeklySummaries({ today: vnToday(now) });
}
