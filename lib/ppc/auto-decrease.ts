// lib/ppc/auto-decrease.ts
//
// Auto giảm bid có xác nhận qua Lark.
//   1. Mỗi sáng (mặc định 9h giờ VN) với từng store đã bật: tính đề xuất Auto Bid (dùng chung cache với tab Auto Bid),
//      cập nhật số ngày dữ liệu liên tiếp mỗi target có đề xuất GIẢM bid (ppc_auto_decrease_streaks).
//      Đề xuất biến mất / đổi hướng / có người xử lý target → đếm lại từ đầu.
//   2. Target đủ N ngày, trong phạm vi SKU, không bị hoãn, không có thay đổi đang chờ hay vừa chỉnh trong cooldown
//      → gom thành một lô (ppc_auto_decrease_batches), gửi thẻ Lark CÁ NHÂN cho từng người phụ trách store
//      (đã kết nối Lark + bật thông báo PPC + được phân quyền nhận thông báo action của store). Không gửi vào nhóm.
//   3. Người phụ trách bấm "Xác nhận" (trên Lark hoặc web) → tính lại với dữ liệu mới nhất, bỏ target đã đổi,
//      rồi duyệt vào hàng đợi + tạo file Bulk + xếp hàng Mac mini upload lên Amazon (executeConfirmBidAction).
//      Bấm "Hoãn" → không nhắc lại các target đó trong SNOOZE_DAYS ngày.
// Hệ thống KHÔNG bao giờ tự đổi bid khi chưa có người bấm xác nhận.
// Lịch chỉ chạy khi NODE_ENV=production (tắt bằng PPC_AUTO_DECREASE_SCHEDULE=off, bật ở máy dev bằng =on);
// đổi giờ bằng PPC_AUTO_DECREASE_HOUR (mặc định 9).
import "server-only";

import { getDatabaseClient, type DataScope } from "@/lib/db";
import { sendLarkCardNotification } from "@/lib/lark-notifications";
import { executeConfirmBidAction } from "@/lib/accounting/lark-ppc-bid-tools";
import type { PendingBidItem, PendingPpcAction } from "@/lib/accounting/lark-conversation-memory";
import type { PpcRecommendation } from "./types";
import { loadFullStoreRecommendations } from "./auto-bid-prewarm";
import { assertActorPpcStoreActionAccess } from "./store-user-access";
import {
  answerTelegramCallback,
  editTelegramHtml,
  editTelegramKeyboard,
  escapeHtml,
  getTelegramLink,
  isTelegramActionConfigured,
  resolveTelegramActor,
  sendTelegramHtml,
  type InlineKeyboard,
} from "@/lib/telegram-action-bot";

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const RECOMMENDATION_DAYS = 30;
const CHECK_INTERVAL_MS = 60_000;
/** Server bật lại sau giờ hẹn vẫn gửi bù, nhưng chỉ tới giờ này (không gửi thẻ lúc tối muộn). */
const LATEST_CATCH_UP_HOUR = 12;
const SNOOZE_DAYS = 3;
/** Lô quá 1 ngày thì không cho xác nhận nữa (dữ liệu đã cũ, sáng mai sẽ có lô mới). */
const BATCH_VALID_DAYS = 1;
const MAX_BATCH_ITEMS = 100;
/** Số target hiển thị chi tiết trên thẻ Lark; phần còn lại xem trên web (giới hạn kích thước thẻ). */
const CARD_MAX_TARGETS = 20;
const PUBLIC_URL = (process.env.PPC_PUBLIC_URL || "https://ncehub.net").replace(/\/+$/, "");

export const AUTO_DECREASE_CONFIRM = "AUTO_DECREASE_CONFIRM";
export const AUTO_DECREASE_SNOOZE = "AUTO_DECREASE_SNOOZE";

/* ------------------------------------------------------------------ */
/* Cài đặt                                                              */
/* ------------------------------------------------------------------ */

export interface AutoDecreaseSettings {
  storeId: string;
  actorId: string;
  enabled: boolean;
  scope: "ALL" | "SKUS";
  skus: string[];
  waitDays: number;
  minBid: number;
  cooldownDays: number;
  updatedAt: string | null;
}

export const DEFAULT_AUTO_DECREASE_SETTINGS = {
  enabled: false,
  scope: "SKUS" as const,
  skus: [] as string[],
  waitDays: 3,
  minBid: 0.1,
  cooldownDays: 7,
};

interface SettingsRow {
  store_id: string;
  actor_id: string;
  enabled: boolean;
  scope: "ALL" | "SKUS";
  skus: string[];
  wait_days: number;
  min_bid: string;
  cooldown_days: number;
  updated_at: Date | null;
}

function toSettings(storeId: string, actorId: string, row?: SettingsRow): AutoDecreaseSettings {
  if (!row) return { storeId, actorId, ...DEFAULT_AUTO_DECREASE_SETTINGS, updatedAt: null };
  return {
    storeId,
    actorId,
    enabled: row.enabled,
    scope: row.scope,
    skus: row.skus || [],
    waitDays: row.wait_days,
    minBid: Number(row.min_bid),
    cooldownDays: row.cooldown_days,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** Cấu hình của một người cho một store (chưa cấu hình → mặc định, đang tắt). */
export async function getAutoDecreaseSettings(storeId: string, actorId: string): Promise<AutoDecreaseSettings> {
  const sql = await getDatabaseClient();
  const rows = await sql<SettingsRow[]>`
    SELECT * FROM ppc_auto_decrease_settings WHERE store_id = ${storeId} AND actor_id = ${actorId} LIMIT 1
  `;
  return toSettings(storeId, actorId, rows[0]);
}

/** Cấu hình đang bật của những người khác trong store (để báo trùng SKU). */
export async function listOtherAutoDecreaseConfigs(storeId: string, exceptActorId: string) {
  const sql = await getDatabaseClient();
  return sql<Array<{ actorId: string; name: string; scope: "ALL" | "SKUS"; skus: string[] }>>`
    SELECT s.actor_id AS "actorId", COALESCE(u.display_name, s.actor_id) AS name, s.scope, s.skus
    FROM ppc_auto_decrease_settings s
    LEFT JOIN app_users u ON u.team_id = s.team_id AND u.user_id = s.actor_id
    WHERE s.store_id = ${storeId} AND s.actor_id <> ${exceptActorId} AND s.enabled = TRUE
    ORDER BY name
  `;
}

export function normalizeSkuList(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : String(input || "").split(/[\s,;]+/);
  return Array.from(new Set(raw.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))).slice(0, 500);
}

export async function saveAutoDecreaseSettings(
  scope: DataScope,
  storeId: string,
  input: Partial<Omit<AutoDecreaseSettings, "storeId" | "actorId" | "updatedAt">>,
): Promise<AutoDecreaseSettings> {
  const current = await getAutoDecreaseSettings(storeId, scope.actorId);
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const next = {
    enabled: input.enabled ?? current.enabled,
    scope: input.scope === "ALL" || input.scope === "SKUS" ? input.scope : current.scope,
    skus: input.skus !== undefined ? normalizeSkuList(input.skus) : current.skus,
    waitDays: input.waitDays === undefined ? current.waitDays : Math.round(clamp(input.waitDays, 1, 30, current.waitDays)),
    minBid: input.minBid === undefined ? current.minBid : Math.round(clamp(input.minBid, 0.02, 50, current.minBid) * 100) / 100,
    cooldownDays: input.cooldownDays === undefined ? current.cooldownDays : Math.round(clamp(input.cooldownDays, 0, 60, current.cooldownDays)),
  };

  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO ppc_auto_decrease_settings (
      store_id, actor_id, team_id, enabled, scope, skus, wait_days, min_bid, cooldown_days, updated_at
    ) VALUES (
      ${storeId}, ${scope.actorId}, ${scope.teamId}, ${next.enabled}, ${next.scope}, ${next.skus}, ${next.waitDays},
      ${next.minBid}, ${next.cooldownDays}, NOW()
    )
    ON CONFLICT (store_id, actor_id) DO UPDATE SET
      enabled = EXCLUDED.enabled, scope = EXCLUDED.scope, skus = EXCLUDED.skus, wait_days = EXCLUDED.wait_days,
      min_bid = EXCLUDED.min_bid, cooldown_days = EXCLUDED.cooldown_days, updated_at = NOW()
  `;
  if (!next.enabled) {
    // Tắt → bỏ các lần hoãn của người này; store không còn ai bật thì bỏ luôn bộ đếm (bật lại đếm từ đầu).
    await sql`DELETE FROM ppc_auto_decrease_snoozes WHERE store_id = ${storeId} AND actor_id = ${scope.actorId}`;
    await sql`
      DELETE FROM ppc_auto_decrease_streaks
      WHERE store_id = ${storeId}
        AND NOT EXISTS (SELECT 1 FROM ppc_auto_decrease_settings WHERE store_id = ${storeId} AND enabled = TRUE)
    `;
  }
  return getAutoDecreaseSettings(storeId, scope.actorId);
}

/* ------------------------------------------------------------------ */
/* Tiện ích                                                             */
/* ------------------------------------------------------------------ */

function vietnamNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toDateString(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  // postgres.js trả cột DATE thành Date lúc 00:00 UTC → đọc theo UTC (không phụ thuộc múi giờ máy chủ).
  return value.toISOString().slice(0, 10);
}

const money = (value: number) => Math.round(value * 100) / 100;

/**
 * Bid cuối cùng = bid đề xuất của rule, nhưng không dưới minBid.
 * null = không còn giảm được (bid hiện tại đã ở sàn).
 */
export function computeAutoDecreaseBid(
  currentBid: number,
  recommendedBid: number,
  settings: Pick<AutoDecreaseSettings, "minBid">,
): number | null {
  if (!(currentBid > 0) || !(recommendedBid >= 0)) return null;
  const bid = money(Math.max(recommendedBid, settings.minBid));
  return bid < money(currentBid) ? bid : null;
}

function pctChange(from: number, to: number): number {
  return from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : 0;
}

/* ------------------------------------------------------------------ */
/* Bộ đếm ngày & chọn target                                            */
/* ------------------------------------------------------------------ */

interface StoreRow {
  id: string;
  name: string;
  team_id: string;
}

/** Thông tin cấp SKU hiển thị trên thẻ (phôi, BE ACOS, số 30 ngày của cả SKU). */
export interface SkuCardInfo {
  productType: string;
  breakEvenAcos: number | null;
  spend: number;
  sales: number;
  orders: number;
}

async function loadRecommendationData(store: StoreRow) {
  const scope: DataScope = { teamId: store.team_id, actorId: "system:auto-decrease" };
  const result = await loadFullStoreRecommendations(scope, { id: store.id, name: store.name }, RECOMMENDATION_DAYS, false);
  const skuInfo = new Map<string, SkuCardInfo>(result.groups.map((g) => [g.sku.toUpperCase(), {
    productType: g.productType || "",
    breakEvenAcos: g.breakEvenAcos > 0 ? g.breakEvenAcos : null,
    spend: g.spend || 0,
    sales: g.sales || 0,
    orders: g.orders || 0,
  }]));
  return { recs: result.allRecommendations, skuInfo };
}

async function loadRecommendations(store: StoreRow): Promise<PpcRecommendation[]> {
  return (await loadRecommendationData(store)).recs;
}

/** "[SP03] SP03_HAS_ORDER_3: ACoS 45.9% vượt ACoS hòa vốn 36% -> Giảm 5%. (Không ép sàn…)" → phần lý do dễ đọc. */
export function shortReason(reason: string): string {
  return reason
    .replace(/^\[[^\]]+\]\s*[^:]+:\s*/, "")
    .replace(/\s*\(Không ép sàn[\s\S]*$/, "")
    .replace(/\s*Kết quả tính toán được chặn[\s\S]*$/, "")
    .replace(/\s*->\s*/g, " → ")
    .replace(/\.\s*$/, "")
    .trim();
}

function campaignTypeOf(rec: PpcRecommendation): string {
  const text = `${rec.ruleProfile || ""} ${rec.campaignName || ""}`.toUpperCase();
  if (/SB05|\bVIDEO\b/.test(text)) return "SB05";
  if (/SB01/.test(text)) return "SB01";
  return "SP03";
}

async function activeSnapshotDate(storeId: string): Promise<string | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ report_end_date: Date | string }>>`
    SELECT report_end_date FROM ppc_active_snapshots
    WHERE store_id = ${storeId} AND coverage_days = ${RECOMMENDATION_DAYS}
    LIMIT 1
  `;
  return rows[0] ? toDateString(rows[0].report_end_date) : null;
}

function isDecrease(rec: PpcRecommendation): boolean {
  return rec.recType === "BID_DECREASE"
    && Boolean(rec.keywordId)
    && !rec.currentBidIsFallback
    && Number(rec.currentBid) > 0
    && Number(rec.recommendedBid) < Number(rec.currentBid);
}

/** Cập nhật bộ đếm theo ngày dữ liệu của snapshot. Chạy lại cùng snapshot không đếm thêm. */
export async function updateDecreaseStreaks(storeId: string, recs: PpcRecommendation[], snapshotDate: string) {
  const sql = await getDatabaseClient();
  const decreases = recs.filter(isDecrease).map((rec) => ({
    rec_id: rec.id,
    target_id: rec.keywordId || "",
    campaign_id: rec.campaignId || "",
    sku: (rec.sku || "").toUpperCase(),
    keyword: rec.keyword || "",
    current_bid: money(Number(rec.currentBid)),
    recommended_bid: money(Number(rec.recommendedBid)),
  }));
  const ids = decreases.map((row) => row.rec_id);

  await sql.begin(async (tx) => {
    if (decreases.length > 0) {
      await tx`
        INSERT INTO ppc_auto_decrease_streaks AS s (
          store_id, rec_id, target_id, campaign_id, sku, keyword,
          first_seen_date, last_seen_date, seen_days, current_bid, recommended_bid
        )
        SELECT ${storeId}::uuid, r.rec_id, r.target_id, r.campaign_id, r.sku, r.keyword,
               ${snapshotDate}::date, ${snapshotDate}::date, 1, r.current_bid, r.recommended_bid
        FROM jsonb_to_recordset(${tx.json(decreases)}::jsonb) AS r(
          rec_id text, target_id text, campaign_id text, sku text, keyword text,
          current_bid numeric, recommended_bid numeric
        )
        ON CONFLICT (store_id, rec_id) DO UPDATE SET
          -- Bid trong báo cáo khác hôm trước = có người đã chỉnh (kể cả sửa thẳng trên Amazon Ads, không qua
          -- NCE Hub) → đếm lại từ đầu. Cùng ngày dữ liệu thì không cộng thêm.
          seen_days = CASE
            WHEN s.current_bid IS DISTINCT FROM EXCLUDED.current_bid THEN 1
            WHEN s.last_seen_date < EXCLUDED.last_seen_date THEN s.seen_days + 1
            ELSE s.seen_days END,
          first_seen_date = CASE WHEN s.current_bid IS DISTINCT FROM EXCLUDED.current_bid
            THEN EXCLUDED.last_seen_date ELSE s.first_seen_date END,
          first_seen_at = CASE WHEN s.current_bid IS DISTINCT FROM EXCLUDED.current_bid
            THEN NOW() ELSE s.first_seen_at END,
          last_seen_date = GREATEST(s.last_seen_date, EXCLUDED.last_seen_date),
          target_id = EXCLUDED.target_id, campaign_id = EXCLUDED.campaign_id,
          sku = EXCLUDED.sku, keyword = EXCLUDED.keyword,
          current_bid = EXCLUDED.current_bid, recommended_bid = EXCLUDED.recommended_bid,
          updated_at = NOW()
      `;
    }
    // Đề xuất không còn (hoặc đổi sang tăng / tạm dừng) → đếm lại từ đầu.
    await tx`
      DELETE FROM ppc_auto_decrease_streaks
      WHERE store_id = ${storeId}
        AND NOT (rec_id IN (SELECT jsonb_array_elements_text(${tx.json(ids)}::jsonb)))
    `;
    // Có người đã xử lý target (duyệt / bỏ qua / upload ở bất kỳ màn nào) kể từ khi bắt đầu đếm → đếm lại.
    await tx`
      DELETE FROM ppc_auto_decrease_streaks s
      WHERE s.store_id = ${storeId} AND s.target_id <> ''
        AND EXISTS (
          SELECT 1 FROM ppc_actions a
          WHERE a.store_id = s.store_id AND a.target_id = s.target_id
            AND a.status <> 'SUPERSEDED'
            AND a.created_at >= s.first_seen_at
        )
    `;
    // Lần hoãn hết hiệu lực khi target đã đếm lại từ đầu sau lúc hoãn (bid đổi / hết đề xuất / có người xử lý).
    await tx`
      DELETE FROM ppc_auto_decrease_snoozes z
      WHERE z.store_id = ${storeId}
        AND NOT EXISTS (
          SELECT 1 FROM ppc_auto_decrease_streaks s
          WHERE s.store_id = z.store_id AND s.rec_id = z.rec_id AND s.first_seen_at <= z.created_at
        )
    `;
  });
  return { tracked: decreases.length };
}

/** target_id đang có thay đổi chờ upload, hoặc vừa được chỉnh trong cooldownDays ngày (hoặc sau mốc `since`). */
async function busyTargetIds(storeId: string, targetIds: string[], cooldownDays: number, since?: Date | null) {
  if (targetIds.length === 0) return new Set<string>();
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ target_id: string }>>`
    SELECT DISTINCT target_id FROM ppc_actions
    WHERE store_id = ${storeId}
      AND target_id = ANY(${targetIds})
      AND status <> 'SUPERSEDED'
      AND (
        status IN ('PENDING', 'APPROVED', 'QUEUED')
        OR created_at >= NOW() - ${cooldownDays} * INTERVAL '1 day'
        OR (${since ?? null}::timestamptz IS NOT NULL AND created_at >= ${since ?? null}::timestamptz)
      )
  `;
  return new Set(rows.map((row) => row.target_id));
}

export interface AutoDecreaseItem {
  recId: string;
  sku: string;
  keyword: string;
  matchType: string;
  campaignName: string;
  targetId: string;
  currentBid: number;
  recommendedBid: number;
  finalBid: number;
  changePct: number;
  seenDays: number;
  firstSeenDate: string;
  spend: number;
  sales: number;
  clicks: number;
  orders: number;
  acos: number | null;
  reason: string;
  // Bổ sung cho thẻ chi tiết (lô cũ có thể thiếu → hiển thị tuỳ chọn).
  campaignType?: string;
  avgCpc?: number;
  estimatedSavings?: number;
  productType?: string;
  breakEvenAcos?: number | null;
  skuSpend?: number;
  skuSales?: number;
}

function inScope(settings: AutoDecreaseSettings, sku: string | undefined): boolean {
  if (settings.scope === "ALL") return true;
  const wanted = new Set(settings.skus.map((s) => s.toUpperCase()));
  return wanted.has((sku || "").toUpperCase());
}

/** Target đủ điều kiện gửi lô hôm nay (đã qua mọi guardrail). */
export async function selectAutoDecreaseCandidates(
  store: StoreRow,
  settings: AutoDecreaseSettings,
  recs: PpcRecommendation[],
  today: string,
  options: { ignoreWaitDays?: boolean; skuInfo?: Map<string, SkuCardInfo> } = {},
): Promise<AutoDecreaseItem[]> {
  const sql = await getDatabaseClient();
  const streaks = await sql<Array<{
    rec_id: string;
    seen_days: number;
    first_seen_date: Date | string;
    snoozed_until: Date | string | null;
  }>>`
    SELECT s.rec_id, s.seen_days, s.first_seen_date, z.snoozed_until
    FROM ppc_auto_decrease_streaks s
    LEFT JOIN ppc_auto_decrease_snoozes z
      ON z.store_id = s.store_id AND z.rec_id = s.rec_id AND z.actor_id = ${settings.actorId}
    WHERE s.store_id = ${store.id}
  `;
  const streakById = new Map(streaks.map((row) => [row.rec_id, row]));

  const candidates = recs.filter((rec) => {
    if (!isDecrease(rec) || !inScope(settings, rec.sku)) return false;
    const streak = streakById.get(rec.id);
    if (!streak) return false;
    // Hoãn là của riêng người cấu hình này.
    if (streak.snoozed_until && toDateString(streak.snoozed_until) >= today) return false;
    return options.ignoreWaitDays || streak.seen_days >= settings.waitDays;
  });
  const busy = await busyTargetIds(store.id, candidates.map((rec) => rec.keywordId || ""), settings.cooldownDays);

  const items: AutoDecreaseItem[] = [];
  for (const rec of candidates) {
    if (busy.has(rec.keywordId || "")) continue;
    const currentBid = money(Number(rec.currentBid));
    const finalBid = computeAutoDecreaseBid(currentBid, Number(rec.recommendedBid), settings);
    if (finalBid === null) continue;
    const streak = streakById.get(rec.id)!;
    const spend = Number(rec.spend || 0);
    const sales = Number(rec.sales || 0);
    const sku = (rec.sku || "").toUpperCase();
    const info = options.skuInfo?.get(sku);
    items.push({
      recId: rec.id,
      sku,
      campaignType: campaignTypeOf(rec),
      avgCpc: Number(rec.cpc || 0) > 0 ? money(Number(rec.cpc)) : undefined,
      estimatedSavings: money(spend * (1 - finalBid / Math.max(currentBid, 0.01))),
      productType: info?.productType || rec.productType || "",
      breakEvenAcos: info?.breakEvenAcos ?? null,
      skuSpend: info ? money(info.spend) : undefined,
      skuSales: info ? money(info.sales) : undefined,
      keyword: rec.keyword,
      matchType: rec.matchType || "",
      campaignName: rec.campaignName || "",
      targetId: rec.keywordId || "",
      currentBid,
      recommendedBid: money(Number(rec.recommendedBid)),
      finalBid,
      changePct: pctChange(currentBid, finalBid),
      seenDays: streak.seen_days,
      firstSeenDate: toDateString(streak.first_seen_date),
      spend: money(spend),
      sales: money(sales),
      clicks: Number(rec.clicks || 0),
      orders: Number(rec.orders || 0),
      acos: sales > 0 ? Math.round((spend / sales) * 1000) / 10 : null,
      reason: shortReason(rec.reason),
    });
  }
  items.sort((a, b) => b.spend - a.spend);
  return items.slice(0, MAX_BATCH_ITEMS);
}

/* ------------------------------------------------------------------ */
/* Người nhận & thẻ Lark                                                */
/* ------------------------------------------------------------------ */

interface Recipient {
  actor_id: string;
  display_name: string;
  receive_id: string;
  receive_id_type: string;
}

/**
 * Lark của CHÍNH người đã cấu hình (người đó vẫn phải được phân quyền phụ trách store).
 * Không cần bật mục "PPC" trong cài đặt Lark: tự cấu hình Auto giảm Bid đã là đăng ký nhận.
 */
export async function listAutoDecreaseRecipients(teamId: string, storeId: string, actorId: string): Promise<Recipient[]> {
  const sql = await getDatabaseClient();
  return sql<Recipient[]>`
    SELECT connection.actor_id, app_user.display_name, connection.receive_id, connection.receive_id_type
    FROM ppc_store_user_access access
    JOIN app_users app_user
      ON app_user.team_id = access.team_id AND app_user.user_id = access.actor_id AND app_user.status = 'approved'
    JOIN lark_user_connections connection
      ON connection.team_id = access.team_id AND connection.actor_id = access.actor_id AND connection.enabled = TRUE
    WHERE access.team_id = ${teamId} AND access.store_id = ${storeId} AND access.actor_id = ${actorId}
      AND access.receive_action_notifications = TRUE
      AND connection.receive_id <> ''
  `;
}

function detailUrl(storeName: string) {
  return `${PUBLIC_URL}/?view=ppc&section=auto_bid&store=${encodeURIComponent(storeName)}&autoDecrease=1`;
}

/** Mở thẳng chi tiết 1 SKU (campaign + target) trên tab Đề xuất & Auto Bid. */
function skuUrl(storeName: string, sku: string) {
  return `${PUBLIC_URL}/?view=ppc&section=auto_bid&store=${encodeURIComponent(storeName)}&openSku=${encodeURIComponent(sku)}`;
}

function cleanText(value: string) {
  // Lark markdown hiểu < > là thẻ (<at>, <font>…) → đổi sang ký tự toàn độ rộng để vẫn đọc được "> 50%".
  return value
    .replace(/>/g, "＞").replace(/</g, "＜")
    .replace(/[*_`~[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function linkButton(label: string, url: string) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: label },
    type: "default",
    width: "fill",
    multi_url: { url, pc_url: url, android_url: url, ios_url: url },
  };
}

function columns(elements: Array<Record<string, unknown>>) {
  return {
    tag: "column_set",
    flex_mode: "none",
    background_style: "default",
    columns: elements.map((element) => ({ tag: "column", width: "weighted", weight: 1, elements: [element] })),
  };
}

export interface BatchCardInput {
  batchId: string;
  storeName: string;
  runDate: string;
  snapshotDate: string | null;
  items: AutoDecreaseItem[];
  settings: Pick<AutoDecreaseSettings, "waitDays" | "minBid">;
  /** Trạng thái đã xử lý: thẻ không còn nút bấm. */
  resolved?: { template: string; title: string; note: string };
}

const usd = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (value: number | null | undefined) => (value == null ? "—" : `${Math.round(value * 10) / 10}%`);
function viDate(date: string | null | undefined) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Tổng hợp một lô: dùng cho phần tóm tắt và hộp thoại xác nhận. */
export function summarizeBatch(items: AutoDecreaseItem[]) {
  const skus = new Set(items.map((i) => i.sku || "N/A"));
  const spend = money(items.reduce((s, i) => s + i.spend, 0));
  const sales = money(items.reduce((s, i) => s + i.sales, 0));
  const orders = items.reduce((s, i) => s + i.orders, 0);
  const clicks = items.reduce((s, i) => s + i.clicks, 0);
  const avgOld = items.length ? items.reduce((s, i) => s + i.currentBid, 0) / items.length : 0;
  const avgNew = items.length ? items.reduce((s, i) => s + i.finalBid, 0) / items.length : 0;
  const savings = money(items.reduce((s, i) => s + (i.estimatedSavings ?? 0), 0));
  const biggest = [...items].sort((a, b) => a.changePct - b.changePct)[0];
  const noOrder = items.filter((i) => i.orders === 0).length;
  return {
    targets: items.length, skus: skus.size, spend, sales, orders, clicks,
    acos: sales > 0 ? (spend / sales) * 100 : null,
    avgOld: money(avgOld), avgNew: money(avgNew), avgPct: pctChange(avgOld, avgNew),
    savings, biggest, noOrder,
  };
}

/** Một dòng cho mỗi target: keyword — bid cũ → mới (%) · hiệu quả 30 ngày. */
function targetLine(item: AutoDecreaseItem): string {
  const perf = item.orders > 0 ? `ACOS ${pct(item.acos)}` : `${item.clicks} click, 0 đơn`;
  return `• ${cleanText(item.keyword).slice(0, 45)} — ${usd(item.currentBid)} → **${usd(item.finalBid)}** (${item.changePct}%) · ${perf}`;
}

export function buildAutoDecreaseCard(input: BatchCardInput) {
  const bySku = new Map<string, AutoDecreaseItem[]>();
  for (const item of input.items) bySku.set(item.sku || "N/A", [...(bySku.get(item.sku || "N/A") || []), item]);
  const skuGroups = [...bySku.entries()].sort(
    (a, b) => b[1].reduce((s, i) => s + i.spend, 0) - a[1].reduce((s, i) => s + i.spend, 0),
  );
  const sum = summarizeBatch(input.items);

  const header = input.resolved
    ? { template: input.resolved.template, title: input.resolved.title }
    : { template: "orange", title: `🔻 Đề xuất giảm Bid — ${input.storeName}` };

  const summary = [
    `**${sum.targets} target · ${sum.skus} SKU**${input.resolved ? "" : ` chờ ≥ ${input.settings.waitDays} ngày chưa xử lý`}`,
    `Bid TB ${usd(sum.avgOld)} → **${usd(sum.avgNew)}** (${sum.avgPct}%) · Spend 30N ${usd(sum.spend)} · ACOS ${pct(sum.acos)}`,
  ].join("\n");

  const elements: Array<Record<string, unknown>> = [{ tag: "markdown", content: summary }, { tag: "hr" }];

  // Mỗi SKU: tên SKU là link mở thẳng chi tiết SKU trên tab Auto Bid, bên dưới mỗi target một dòng.
  const blocks: string[] = [];
  let shown = 0;
  for (const [sku, items] of skuGroups) {
    if (shown >= CARD_MAX_TARGETS) break;
    const first = items[0];
    const meta = [first.productType && cleanText(first.productType), first.breakEvenAcos && `BE ${pct(first.breakEvenAcos)}`]
      .filter(Boolean).join(" · ");
    const lines = [`📦 [${cleanText(sku)}](${skuUrl(input.storeName, sku)})${meta ? ` · ${meta}` : ""}`];
    for (const item of items) {
      if (shown >= CARD_MAX_TARGETS) break;
      lines.push(targetLine(item));
      shown++;
    }
    blocks.push(lines.join("\n"));
  }
  const hidden = input.items.length - shown;
  if (hidden > 0) blocks.push(`… và ${hidden} target khác → [xem đủ trên web](${detailUrl(input.storeName)})`);
  elements.push({ tag: "markdown", content: blocks.join("\n\n") });
  elements.push({ tag: "hr" });

  if (input.resolved) {
    elements.push({ tag: "markdown", content: input.resolved.note });
    elements.push(columns([linkButton("🔍 Xem chi tiết", detailUrl(input.storeName))]));
  } else {
    elements.push({
      tag: "markdown",
      content: "Xác nhận → kiểm tra lại rồi đẩy Bulk lên Amazon · Không bấm → bid giữ nguyên",
    });
    const biggest = sum.biggest;
    elements.push(
      columns([
        {
          tag: "button",
          text: { tag: "plain_text", content: "✅ Xác nhận giảm" },
          type: "primary",
          width: "fill",
          value: { action: AUTO_DECREASE_CONFIRM, batchId: input.batchId },
          confirm: {
            title: { tag: "plain_text", content: `Giảm bid ${sum.targets} target — ${input.storeName}?` },
            text: {
              tag: "plain_text",
              content: [
                `${sum.targets} target · ${sum.skus} SKU · bid TB ${usd(sum.avgOld)} → ${usd(sum.avgNew)} (${sum.avgPct}%).`,
                biggest ? `Giảm nhiều nhất: ${cleanText(biggest.keyword).slice(0, 40)} ${usd(biggest.currentBid)} → ${usd(biggest.finalBid)} (${biggest.changePct}%).` : "",
                "Sau khi xác nhận, file Bulk sẽ được đẩy lên Amazon Ads. Target có dữ liệu thay đổi sẽ tự bỏ qua.",
              ].filter(Boolean).join("\n"),
            },
          },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: `⏸️ Hoãn ${SNOOZE_DAYS} ngày` },
          type: "default",
          width: "fill",
          value: { action: AUTO_DECREASE_SNOOZE, batchId: input.batchId },
        },
        linkButton("🔍 Xem chi tiết", detailUrl(input.storeName)),
      ]),
    );
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      template: header.template,
      title: { tag: "plain_text", content: header.title },
      subtitle: { tag: "plain_text", content: `${viDate(input.runDate)} · Auto giảm Bid` },
    },
    body: { elements },
  };
}

/* ------------------------------------------------------------------ */
/* Chạy theo lịch                                                       */
/* ------------------------------------------------------------------ */

interface BatchRow {
  id: string;
  team_id: string;
  store_id: string;
  /** Người cấu hình — chủ lô, người duy nhất được duyệt / hoãn. */
  actor_id: string;
  run_date: Date | string;
  status: string;
  item_count: number;
  items: AutoDecreaseItem[];
  recipients: Array<{ actorId: string; name: string; channel?: "lark" | "telegram"; sent: boolean; error?: string }>;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  result: Record<string, unknown> | null;
  created_at: Date;
}

export interface StoreRunResult {
  store: string;
  /** Người cấu hình của lô (mỗi người một lô). */
  actor?: string;
  status: "SENT" | "SEND_FAILED" | "NO_ITEMS" | "NO_RECIPIENTS" | "ALREADY_SENT" | "NO_SNAPSHOT" | "ERROR";
  items?: number;
  recipients?: number;
  sent?: number;
  batchId?: string;
  error?: string;
}

/**
 * Một store: cập nhật bộ đếm (dùng chung) một lần, rồi tạo lô + gửi thông báo riêng cho từng người cấu hình.
 * actorIds = những người cần chạy (lịch 9h: mọi người đang bật; script thử: 1 người).
 */
export async function runAutoDecreaseForStore(
  store: StoreRow,
  actorIds: string[],
  options: { ignoreWaitDays?: boolean; replaceToday?: boolean } = {},
): Promise<StoreRunResult[]> {
  const today = vietnamNow().date;
  const snapshotDate = await activeSnapshotDate(store.id);
  if (!snapshotDate) return [{ store: store.name, status: "NO_SNAPSHOT" }];

  const { recs, skuInfo } = await loadRecommendationData(store);
  await updateDecreaseStreaks(store.id, recs, snapshotDate);

  const results: StoreRunResult[] = [];
  for (const actorId of actorIds) {
    try {
      results.push(await runForActor(store, actorId, { recs, skuInfo, snapshotDate, today }, options));
    } catch (error) {
      console.error(`[auto-decrease] ${store.name} / ${actorId} lỗi:`, error);
      results.push({ store: store.name, actor: actorId, status: "ERROR", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function runForActor(
  store: StoreRow,
  actorId: string,
  data: { recs: PpcRecommendation[]; skuInfo: Map<string, SkuCardInfo>; snapshotDate: string; today: string },
  options: { ignoreWaitDays?: boolean; replaceToday?: boolean },
): Promise<StoreRunResult> {
  const { recs, skuInfo, snapshotDate, today } = data;
  const sql = await getDatabaseClient();
  const settings = await getAutoDecreaseSettings(store.id, actorId);
  const base = { store: store.name, actor: actorId };

  // Người cấu hình phải còn quyền phụ trách store (bị gỡ quyền → không tạo lô, không gửi).
  try {
    await assertActorPpcStoreActionAccess(store.team_id, actorId, store.id);
  } catch {
    return { ...base, status: "NO_RECIPIENTS", error: "Không còn quyền phụ trách store" };
  }

  const items = await selectAutoDecreaseCandidates(store, settings, recs, today, { ignoreWaitDays: options.ignoreWaitDays, skuInfo });
  if (items.length === 0) return { ...base, status: "NO_ITEMS" };

  const channels = autoDecreaseChannels();
  const larkRecipients = channels.lark ? await listAutoDecreaseRecipients(store.team_id, store.id, actorId) : [];
  const telegramRecipients = channels.telegram ? await listTelegramRecipients(store.team_id, store.id, actorId) : [];
  const recipientCount = larkRecipients.length + telegramRecipients.length;

  if (options.replaceToday) {
    await sql`
      DELETE FROM ppc_auto_decrease_batches
      WHERE store_id = ${store.id} AND actor_id = ${actorId} AND run_date = ${today}::date AND status IN ('PENDING', 'EXPIRED')
    `;
  }
  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO ppc_auto_decrease_batches (team_id, store_id, actor_id, run_date, item_count, items)
    VALUES (${store.team_id}, ${store.id}, ${actorId}, ${today}::date, ${items.length}, ${sql.json(items as never)})
    ON CONFLICT (store_id, actor_id, run_date) DO NOTHING
    RETURNING id
  `;
  if (!inserted[0]) return { ...base, status: "ALREADY_SENT", items: items.length };
  const batchId = inserted[0].id;

  const cardInput: BatchCardInput = { batchId, storeName: store.name, runDate: today, snapshotDate, items, settings };
  const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
  const recipientLog: BatchRow["recipients"] = [];

  if (larkRecipients.length) {
    const card = buildAutoDecreaseCard(cardInput);
    const sends = await Promise.allSettled(
      larkRecipients.map((r) => sendLarkCardNotification(card, { receiveId: r.receive_id, receiveIdType: r.receive_id_type })),
    );
    larkRecipients.forEach((r, idx) => {
      const res = sends[idx];
      const sent = res.status === "fulfilled" && res.value.sent;
      const error = res.status === "rejected" ? errorText(res.reason) : sent ? undefined : "Lark chưa cấu hình";
      recipientLog.push({ actorId: r.actor_id, name: r.display_name, channel: "lark", sent, ...(error ? { error } : {}) });
    });
  }
  if (telegramRecipients.length) {
    const message = buildTelegramBatchMessage(cardInput);
    for (const r of telegramRecipients) {
      try {
        const messageId = await sendTelegramHtml(r.chat_id, message.html, message.keyboard);
        await sql`
          INSERT INTO ppc_auto_decrease_telegram_messages (batch_id, chat_id, message_id, actor_id)
          VALUES (${batchId}, ${r.chat_id}, ${messageId}, ${r.actor_id})
          ON CONFLICT (batch_id, chat_id) DO UPDATE SET message_id = EXCLUDED.message_id
        `;
        recipientLog.push({ actorId: r.actor_id, name: r.display_name, channel: "telegram", sent: true });
      } catch (error) {
        recipientLog.push({ actorId: r.actor_id, name: r.display_name, channel: "telegram", sent: false, error: errorText(error) });
      }
    }
  }

  await sql`
    UPDATE ppc_auto_decrease_batches SET recipients = ${sql.json(recipientLog)}, updated_at = NOW()
    WHERE id = ${batchId}
  `;
  const sentCount = recipientLog.filter((r) => r.sent).length;
  for (const r of recipientLog) {
    if (r.error) console.warn(`[auto-decrease] Gửi ${r.channel} cho ${r.name} lỗi: ${r.error}`);
  }
  if (sentCount === 0) {
    // Chưa gửi được (Lark lỗi / chưa kết nối Telegram…) → vẫn giữ lô để người đó duyệt trên web.
    return {
      ...base, status: recipientCount ? "SEND_FAILED" : "NO_RECIPIENTS", items: items.length,
      recipients: recipientCount, sent: 0, batchId,
      error: recipientLog.map((r) => `${r.channel}: ${r.error}`).join("; ") || "Chưa kết nối Telegram / Lark",
    };
  }
  return { ...base, status: "SENT", items: items.length, recipients: recipientCount, sent: sentCount, batchId };
}

export async function runAutoDecreaseDaily(): Promise<StoreRunResult[]> {
  const sql = await getDatabaseClient();
  const configs = await sql<Array<StoreRow & { actor_id: string }>>`
    SELECT s.id::text AS id, s.name, s.team_id, settings.actor_id
    FROM ppc_auto_decrease_settings settings
    JOIN ppc_stores s ON s.id = settings.store_id AND s.team_id = settings.team_id
    WHERE settings.enabled = TRUE
    ORDER BY s.name, settings.actor_id
  `;
  // Tiến trình chết giữa lúc tạo file (deploy / restart) → lô kẹt CONFIRMING: đánh dấu lỗi để người dùng biết.
  await sql`
    UPDATE ppc_auto_decrease_batches
    SET status = 'FAILED', updated_at = NOW(),
        result = jsonb_build_object('uploaded', false, 'error', 'Bị gián đoạn khi đang tạo file Bulk (server khởi động lại) — xem Hàng đợi / Lịch sử Auto Upload.')
    WHERE status = 'CONFIRMING' AND decided_at < NOW() - INTERVAL '30 minutes'
  `;
  // Sáng nay có lượt mới → mọi lô cũ chưa ai bấm hết hạn, không để 2 lô cùng chờ duyệt.
  await sql`
    UPDATE ppc_auto_decrease_batches SET status = 'EXPIRED', updated_at = NOW()
    WHERE status = 'PENDING' AND run_date < ${vietnamNow().date}::date
  `;
  const byStore = new Map<string, { store: StoreRow; actors: string[] }>();
  for (const row of configs) {
    const entry = byStore.get(row.id) ?? { store: { id: row.id, name: row.name, team_id: row.team_id }, actors: [] };
    entry.actors.push(row.actor_id);
    byStore.set(row.id, entry);
  }
  const results: StoreRunResult[] = [];
  for (const { store, actors } of byStore.values()) {
    try {
      results.push(...await runAutoDecreaseForStore(store, actors));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[auto-decrease] ${store.name} lỗi:`, error);
      results.push({ store: store.name, status: "ERROR", error: message });
    }
  }
  return results;
}

export function autoDecreaseHour(): number {
  const hour = Number(process.env.PPC_AUTO_DECREASE_HOUR ?? 9);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9;
}

export function isAutoDecreaseScheduleEnabled(): boolean {
  const mode = process.env.PPC_AUTO_DECREASE_SCHEDULE;
  return mode !== "off" && (mode === "on" || process.env.NODE_ENV === "production");
}

async function runIfDue() {
  const now = vietnamNow();
  const hour = autoDecreaseHour();
  if (now.hour < hour || now.hour > Math.max(hour, LATEST_CATCH_UP_HOUR)) return;
  const sql = await getDatabaseClient();
  const runKey = `daily:${now.date}`;
  const claimed = await sql<Array<{ run_key: string }>>`
    INSERT INTO ppc_auto_decrease_runs (run_key) VALUES (${runKey})
    ON CONFLICT (run_key) DO NOTHING RETURNING run_key
  `;
  if (!claimed.length) return;
  console.log(`[auto-decrease] Bắt đầu lượt ${runKey}`);
  const summary = await runAutoDecreaseDaily();
  await sql`
    UPDATE ppc_auto_decrease_runs SET finished_at = NOW(), summary = ${sql.json(summary as never)}
    WHERE run_key = ${runKey}
  `;
  console.log(`[auto-decrease] Xong ${runKey}:`, summary.map((s) => `${s.store}=${s.status}${s.items ? `(${s.items})` : ""}`).join(", "));
}

const MODULE_ID = Symbol("auto-decrease-scheduler");
const globalForScheduler = globalThis as typeof globalThis & {
  autoDecreaseScheduler?: NodeJS.Timeout;
  autoDecreaseSchedulerOwner?: symbol;
};

export function startAutoDecreaseScheduler() {
  // DB local là bản sao production (có kết nối Lark thật) → máy dev không tự gửi thẻ, trừ khi bật rõ "on".
  if (!isAutoDecreaseScheduleEnabled()) return;
  if (globalForScheduler.autoDecreaseScheduler) {
    if (globalForScheduler.autoDecreaseSchedulerOwner === MODULE_ID) return;
    clearInterval(globalForScheduler.autoDecreaseScheduler);
  }
  globalForScheduler.autoDecreaseSchedulerOwner = MODULE_ID;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runIfDue()
      .catch((error) => console.error("[auto-decrease] Lỗi lịch:", error))
      .finally(() => {
        running = false;
      });
  };
  globalForScheduler.autoDecreaseScheduler = setInterval(tick, CHECK_INTERVAL_MS);
  globalForScheduler.autoDecreaseScheduler.unref?.();
}

/* ------------------------------------------------------------------ */
/* Xem lô, xác nhận, hoãn                                               */
/* ------------------------------------------------------------------ */

export interface AutoDecreaseBatchView {
  id: string;
  runDate: string;
  status: string;
  itemCount: number;
  items: AutoDecreaseItem[];
  recipients: BatchRow["recipients"];
  decidedByName: string | null;
  decidedAt: string | null;
  result: Record<string, unknown> | null;
  canConfirm: boolean;
}

function batchIsFresh(runDate: string) {
  return runDate >= addDays(vietnamNow().date, -BATCH_VALID_DAYS);
}

function toBatchView(row: BatchRow): AutoDecreaseBatchView {
  const runDate = toDateString(row.run_date);
  return {
    id: row.id,
    runDate,
    status: row.status,
    itemCount: row.item_count,
    items: row.items || [],
    recipients: row.recipients || [],
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    result: row.result,
    canConfirm: row.status === "PENDING" && batchIsFresh(runDate),
  };
}

/** Lô của chính một người (mỗi người chỉ thấy và duyệt lô của mình). */
export async function listAutoDecreaseBatches(storeId: string, actorId: string, limit = 7): Promise<AutoDecreaseBatchView[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<BatchRow[]>`
    SELECT * FROM ppc_auto_decrease_batches
    WHERE store_id = ${storeId} AND actor_id = ${actorId}
    ORDER BY run_date DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(toBatchView);
}

/** Bộ đếm của store (chung) + số target người này đang hoãn. */
export async function getAutoDecreaseStreakSummary(storeId: string, actorId: string, waitDays: number) {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ tracked: number; ready: number; snoozed: number }>>`
    SELECT COUNT(*)::int AS tracked,
           COUNT(*) FILTER (WHERE s.seen_days >= ${waitDays})::int AS ready,
           COUNT(z.rec_id) FILTER (WHERE z.snoozed_until >= ${vietnamNow().date}::date)::int AS snoozed
    FROM ppc_auto_decrease_streaks s
    LEFT JOIN ppc_auto_decrease_snoozes z
      ON z.store_id = s.store_id AND z.rec_id = s.rec_id AND z.actor_id = ${actorId}
    WHERE s.store_id = ${storeId}
  `;
  return rows[0] || { tracked: 0, ready: 0, snoozed: 0 };
}

export interface DecisionActor {
  teamId: string;
  actorId: string;
  displayName: string;
}

async function loadBatch(batchId: string): Promise<BatchRow | null> {
  const sql = await getDatabaseClient();
  const rows = await sql<BatchRow[]>`SELECT * FROM ppc_auto_decrease_batches WHERE id = ${batchId} LIMIT 1`;
  return rows[0] || null;
}

function alreadyDecidedMessage(batch: BatchRow): string {
  const who = batch.decided_by_name ? ` bởi ${batch.decided_by_name}` : "";
  switch (batch.status) {
    case "CONFIRMING": return `Lô này đang được xử lý${who}.`;
    case "DONE": return `Lô này đã được xác nhận${who}.`;
    case "FAILED": return `Lô này đã được xác nhận${who} nhưng upload lỗi — xem trên web.`;
    case "SNOOZED": return `Lô này đã được hoãn${who}.`;
    case "EXPIRED": return "Lô này đã hết hạn. Sáng mai sẽ có lô mới nếu đề xuất vẫn còn.";
    default: return "Lô này không còn chờ xác nhận.";
  }
}

export type DecisionOutcome =
  | { ok: true; batch: BatchRow; storeName: string }
  | { ok: false; message: string; status: 400 | 403 | 404 | 409 };

/** Giữ chỗ quyết định (một người duy nhất), kiểm tra quyền của người bấm với store. */
async function claimBatch(
  batchId: string,
  actor: DecisionActor,
  nextStatus: "CONFIRMING" | "SNOOZED",
  via: DecisionVia,
): Promise<DecisionOutcome> {
  const batch = await loadBatch(batchId);
  if (!batch || batch.team_id !== actor.teamId) return { ok: false, message: "Không tìm thấy lô giảm bid.", status: 404 };
  // Lô là của người đã cấu hình: chỉ người đó được duyệt / hoãn.
  if (batch.actor_id !== actor.actorId) {
    return { ok: false, message: "Lô này thuộc cấu hình của người khác, bạn không duyệt được.", status: 403 };
  }
  try {
    await assertActorPpcStoreActionAccess(batch.team_id, actor.actorId, batch.store_id);
  } catch {
    return { ok: false, message: "Bạn không được phân quyền phụ trách store này.", status: 403 };
  }
  if (batch.status !== "PENDING") return { ok: false, message: alreadyDecidedMessage(batch), status: 409 };
  if (!batchIsFresh(toDateString(batch.run_date))) {
    return { ok: false, message: alreadyDecidedMessage({ ...batch, status: "EXPIRED" }), status: 409 };
  }
  const sql = await getDatabaseClient();
  const claimed = await sql<BatchRow[]>`
    UPDATE ppc_auto_decrease_batches
    SET status = ${nextStatus}, decided_by = ${actor.actorId}, decided_by_name = ${actor.displayName},
        decided_at = NOW(), decided_via = ${via}, updated_at = NOW()
    WHERE id = ${batchId} AND status = 'PENDING'
    RETURNING *
  `;
  if (!claimed[0]) {
    const latest = await loadBatch(batchId);
    return { ok: false, message: latest ? alreadyDecidedMessage(latest) : "Lô không còn tồn tại.", status: 409 };
  }
  const stores = await sql<Array<{ name: string }>>`SELECT name FROM ppc_stores WHERE id = ${batch.store_id} LIMIT 1`;
  const storeName = stores[0]?.name || "";
  if (nextStatus === "CONFIRMING") {
    syncTelegramInBackground(claimed[0], storeName, `⏳ Đang giảm bid — ${storeName}`,
      `Xác nhận bởi <b>${escapeHtml(actor.displayName)}</b> (${VIA_LABEL[via]}). Đang kiểm tra lại và tạo file Bulk…`);
  }
  return { ok: true, batch: claimed[0], storeName };
}

export type DecisionVia = "lark" | "web" | "telegram";
const VIA_LABEL: Record<DecisionVia, string> = { lark: "Lark", web: "web", telegram: "Telegram" };

export async function snoozeAutoDecreaseBatch(batchId: string, actor: DecisionActor, via: DecisionVia) {
  const claim = await claimBatch(batchId, actor, "SNOOZED", via);
  if (!claim.ok) return claim;
  const until = addDays(vietnamNow().date, SNOOZE_DAYS - 1);
  const sql = await getDatabaseClient();
  const snoozes = (claim.batch.items || []).map((item) => ({ rec_id: item.recId }));
  // Hoãn chỉ có hiệu lực với người bấm (người khác cấu hình cùng SKU vẫn nhận bình thường).
  await sql`
    INSERT INTO ppc_auto_decrease_snoozes (store_id, actor_id, rec_id, snoozed_until)
    SELECT ${claim.batch.store_id}::uuid, ${actor.actorId}, r.rec_id, ${until}::date
    FROM jsonb_to_recordset(${sql.json(snoozes)}::jsonb) AS r(rec_id text)
    ON CONFLICT (store_id, actor_id, rec_id) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until, created_at = NOW()
  `;
  await sql`
    UPDATE ppc_auto_decrease_batches SET result = ${sql.json({ snoozedUntil: until })}, updated_at = NOW()
    WHERE id = ${batchId}
  `;
  syncTelegramInBackground(claim.batch, claim.storeName, `⏸️ Đã hoãn — ${claim.storeName}`,
    `Hoãn bởi <b>${escapeHtml(actor.displayName)}</b> (${VIA_LABEL[via]}) tới hết ngày ${viDate(until)}. Không có bid nào bị thay đổi.`);
  return { ...claim, snoozedUntil: until };
}

export interface ConfirmResult {
  uploaded: boolean;
  actionCount: number;
  skipped: Array<{ recId: string; keyword: string; reason: string }>;
  /** Các thay đổi đã duyệt (đúng số trên thẻ). */
  applied?: Array<{ sku: string; keyword: string; from: number; to: number; changePct: number }>;
  fileName: string;
  jobId: string | null;
  error: string | null;
}

/**
 * Xác nhận: tính lại với dữ liệu mới nhất rồi duyệt + upload. Chỉ gửi đi các target còn đúng như lúc gửi thẻ.
 * selectedRecIds (từ web) = chỉ duyệt các target được tích.
 */
export async function confirmAutoDecreaseBatch(
  batchId: string,
  actor: DecisionActor,
  via: DecisionVia,
  selectedRecIds?: string[],
): Promise<DecisionOutcome | { ok: true; batch: BatchRow; storeName: string; result: ConfirmResult }> {
  const claim = await claimBatch(batchId, actor, "CONFIRMING", via);
  if (!claim.ok) return claim;
  return runClaimedBatch(claim.batch, claim.storeName, actor, selectedRecIds);
}

/** Chạy lô đã giữ chỗ CONFIRMING: tính lại, duyệt, tạo Bulk; ghi kết quả DONE / FAILED. */
async function runClaimedBatch(
  batch: BatchRow,
  storeName: string,
  actor: DecisionActor,
  selectedRecIds?: string[],
): Promise<{ ok: true; batch: BatchRow; storeName: string; result: ConfirmResult }> {
  const batchId = batch.id;
  const sql = await getDatabaseClient();
  const finish = (result: ConfirmResult) => {
    const who = `bởi <b>${escapeHtml(actor.displayName)}</b>`;
    syncTelegramInBackground(batch, storeName,
      result.uploaded ? `✅ Đã giảm bid — ${storeName}` : `🔴 Giảm bid lỗi — ${storeName}`,
      result.uploaded
        ? `Xác nhận ${who}: ${result.actionCount} target đã xếp hàng upload lên Amazon${result.skipped.length ? `, bỏ qua ${result.skipped.length} target do dữ liệu đổi` : ""}.`
        : `Xác nhận ${who} nhưng chưa upload được: ${escapeHtml(result.error || "lỗi không xác định")}`);
  };

  try {
    const result = await executeBatch(batch, storeName, actor, selectedRecIds);
    const status = result.uploaded ? "DONE" : "FAILED";
    await sql`
      UPDATE ppc_auto_decrease_batches
      SET status = ${status}, result = ${sql.json(result as never)}, updated_at = NOW()
      WHERE id = ${batchId}
    `;
    finish(result);
    return { ok: true, batch: { ...batch, status }, storeName, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: ConfirmResult = { uploaded: false, actionCount: 0, skipped: [], fileName: "", jobId: null, error: message };
    await sql`
      UPDATE ppc_auto_decrease_batches
      SET status = 'FAILED', result = ${sql.json(result as never)}, updated_at = NOW()
      WHERE id = ${batchId}
    `;
    finish(result);
    return { ok: true, batch: { ...batch, status: "FAILED" }, storeName, result };
  }
}

async function executeBatch(
  batch: BatchRow,
  storeName: string,
  actor: DecisionActor,
  selectedRecIds?: string[],
): Promise<ConfirmResult> {
  const settings = await getAutoDecreaseSettings(batch.store_id, batch.actor_id);
  const store: StoreRow = { id: batch.store_id, name: storeName, team_id: batch.team_id };
  const recs = await loadRecommendations(store);
  const recById = new Map(recs.map((rec) => [rec.id, rec]));
  const selected = selectedRecIds ? new Set(selectedRecIds) : null;
  const items = (batch.items || []).filter((item) => !selected || selected.has(item.recId));

  // Có ai chỉnh target từ lúc gửi thẻ (hoặc đang có thay đổi chờ upload) → bỏ qua.
  const busy = await busyTargetIds(batch.store_id, items.map((item) => item.targetId), 0, batch.created_at);
  const skipped: ConfirmResult["skipped"] = [];
  const bidItems: PendingBidItem[] = [];
  for (const item of items) {
    const rec = recById.get(item.recId);
    const skip = (reason: string) => skipped.push({ recId: item.recId, keyword: item.keyword, reason });
    if (!rec || !isDecrease(rec)) { skip("Đề xuất giảm bid không còn theo dữ liệu mới nhất"); continue; }
    if (Math.abs(Number(rec.currentBid) - item.currentBid) > 0.005) {
      skip(`Bid hiện tại đã đổi ($${item.currentBid.toFixed(2)} → $${Number(rec.currentBid).toFixed(2)})`);
      continue;
    }
    if (busy.has(item.targetId)) { skip("Target vừa được chỉnh hoặc đang chờ upload"); continue; }
    const finalBid = computeAutoDecreaseBid(Number(rec.currentBid), Number(rec.recommendedBid), settings);
    if (finalBid === null) { skip("Bid đã ở mức sàn"); continue; }
    // Người duyệt đã thấy bid mới trên thẻ: tính lại ra số khác thì không tự áp số chưa ai thấy.
    if (Math.abs(finalBid - item.finalBid) > 0.005) {
      skip(`Bid đề xuất đã đổi ($${item.finalBid.toFixed(2)} → $${finalBid.toFixed(2)}), chờ lô sau`);
      continue;
    }
    bidItems.push({ recommendation: rec, finalBid: item.finalBid, bidSource: "RULE_ENGINE" });
  }

  if (bidItems.length === 0) {
    return { uploaded: false, actionCount: 0, skipped, fileName: "", jobId: null, error: "Không còn target nào hợp lệ để giảm bid." };
  }

  const pending: PendingPpcAction = {
    action: "AUTO_BID",
    storeId: batch.store_id,
    storeName,
    bidItems,
    createdAt: Date.now(),
  };
  const upload = await executeConfirmBidAction(pending, {
    approver: `Auto giảm bid (${actor.displayName})`,
    createdBy: actor.actorId,
  });
  return {
    uploaded: upload.uploaded,
    actionCount: upload.actionCount,
    skipped,
    applied: bidItems.map((b) => {
      const from = money(Number(b.recommendation.currentBid));
      const to = b.finalBid ?? 0;
      return { sku: (b.recommendation.sku || "").toUpperCase(), keyword: b.recommendation.keyword, from, to, changePct: pctChange(from, to) };
    }),
    fileName: upload.fileName,
    jobId: upload.jobId,
    error: upload.error,
  };
}

/** Thẻ thay thế sau khi đã xử lý (không còn nút bấm). */
export function resolvedCard(
  batch: BatchRow,
  storeName: string,
  resolved: BatchCardInput["resolved"],
) {
  return buildAutoDecreaseCard({
    batchId: batch.id,
    storeName,
    runDate: toDateString(batch.run_date),
    snapshotDate: null,
    items: batch.items || [],
    settings: { waitDays: 0, minBid: 0 }, // thẻ đã xử lý không hiển thị dòng cài đặt
    resolved,
  });
}

/* ------------------------------------------------------------------ */
/* Nút bấm trên Lark                                                    */
/* ------------------------------------------------------------------ */

/** open_id / user_id người bấm → user trong hệ thống (qua kết nối Lark cá nhân). */
export async function resolveActorFromLark(operatorIds: string[], teamId: string): Promise<DecisionActor | null> {
  const ids = operatorIds.filter(Boolean);
  if (ids.length === 0) return null;
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ actor_id: string; display_name: string }>>`
    SELECT connection.actor_id, app_user.display_name
    FROM lark_user_connections connection
    JOIN app_users app_user
      ON app_user.team_id = connection.team_id AND app_user.user_id = connection.actor_id
    WHERE connection.team_id = ${teamId}
      AND connection.enabled = TRUE AND app_user.status = 'approved'
      AND connection.receive_id_type IN ('open_id', 'user_id')
      AND connection.receive_id = ANY(${ids})
    LIMIT 2
  `;
  // Một open_id gắn với 2 tài khoản trong cùng team → không đoán, từ chối.
  if (rows.length !== 1) return null;
  return { teamId, actorId: rows[0].actor_id, displayName: rows[0].display_name };
}

async function sendToActor(actorId: string, card: Record<string, unknown>) {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ receive_id: string; receive_id_type: string }>>`
    SELECT receive_id, receive_id_type FROM lark_user_connections
    WHERE actor_id = ${actorId} AND enabled = TRUE AND receive_id <> '' LIMIT 1
  `;
  if (!rows[0]) return;
  await sendLarkCardNotification(card, { receiveId: rows[0].receive_id, receiveIdType: rows[0].receive_id_type });
}

function resultCard(storeName: string, actor: DecisionActor, result: ConfirmResult) {
  const skippedLines = result.skipped.slice(0, 10).map((s) => `• ${cleanText(s.keyword).slice(0, 60)}: ${s.reason}`);
  const more = result.skipped.length > 10 ? [`… và ${result.skipped.length - 10} target khác.`] : [];
  const applied = result.applied || [];
  const appliedLines = applied.slice(0, 20).map(
    (a, i) => `${i + 1}. ${cleanText(a.keyword).slice(0, 60)} (${cleanText(a.sku)}) · ${usd(a.from)} → **${usd(a.to)}** (${a.changePct}%)`,
  );
  if (applied.length > 20) appliedLines.push(`… và ${applied.length - 20} target khác.`);
  const content = result.uploaded
    ? [
      `**${result.actionCount} target** của **${storeName}** đã được duyệt giảm bid (xác nhận bởi ${actor.displayName}).`,
      `File Bulk: ${result.fileName || "—"}. Mac mini đang đẩy lên Amazon Ads; kết quả upload sẽ báo lại trên Lark.`,
      ...(appliedLines.length ? ["", "**Thay đổi đã duyệt:**", ...appliedLines] : []),
    ]
    : [
      `Chưa upload được: ${result.error || "lỗi không xác định"}.`,
      result.actionCount ? `${result.actionCount} thay đổi đã nằm trong Hàng đợi Auto Bid trên web, có thể upload lại ở đó.` : "",
    ].filter(Boolean);
  if (result.skipped.length) content.push("", `**Bỏ qua ${result.skipped.length} target** (dữ liệu đã thay đổi):`, ...skippedLines, ...more);
  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: result.uploaded ? "green" : "red",
      title: { tag: "plain_text", content: result.uploaded ? `🟢 Đã xếp hàng giảm bid — ${storeName}` : `🔴 Giảm bid chưa thực hiện được — ${storeName}` },
    },
    body: {
      elements: [
        { tag: "markdown", content: content.join("\n") },
        columns([linkButton("🔍 Xem chi tiết", detailUrl(storeName))]),
      ],
    },
  };
}

export type LarkAutoDecreaseResponse = { toast: { type: string; content: string }; card?: { type: "raw"; data: unknown } };

/**
 * Xử lý nút bấm trên thẻ Lark. Phải trả lời trong 3 giây → giữ chỗ ngay, phần tạo file / upload chạy nền,
 * xong thì gửi thẻ kết quả riêng cho người bấm.
 */
export async function handleAutoDecreaseCardAction(
  actionType: string,
  batchId: string,
  operatorIds: string[],
): Promise<LarkAutoDecreaseResponse> {
  const target = await loadBatch(batchId);
  if (!target) return { toast: { type: "error", content: "Không tìm thấy lô giảm bid." } };
  const actor = await resolveActorFromLark(operatorIds, target.team_id);
  if (!actor) {
    return { toast: { type: "error", content: "Tài khoản Lark của bạn chưa được liên kết (open_id) với hệ thống." } };
  }

  if (actionType === AUTO_DECREASE_SNOOZE) {
    const outcome = await snoozeAutoDecreaseBatch(batchId, actor, "lark");
    if (!outcome.ok) return { toast: { type: outcome.status === 403 ? "error" : "info", content: outcome.message } };
    const card = resolvedCard(outcome.batch, outcome.storeName, {
      template: "grey",
      title: `⏸️ Đã hoãn — ${outcome.storeName}`,
      note: `Hoãn bởi **${actor.displayName}** tới hết ngày ${outcome.snoozedUntil}. Không có bid nào bị thay đổi.`,
    });
    return { toast: { type: "success", content: `Đã hoãn ${SNOOZE_DAYS} ngày.` }, card: { type: "raw", data: card } };
  }

  // Xác nhận: giữ chỗ ngay (chỉ 1 người thắng), phần tạo file / upload chạy nền.
  const claim = await claimBatch(batchId, actor, "CONFIRMING", "lark");
  if (!claim.ok) return { toast: { type: claim.status === 403 ? "error" : "info", content: claim.message } };
  const { batch, storeName } = claim;

  void runClaimedBatch(batch, storeName, actor)
    .then((outcome) => sendToActor(actor.actorId, resultCard(outcome.storeName, actor, outcome.result)))
    .catch((error) => console.error(`[auto-decrease] Xác nhận lô ${batchId} lỗi:`, error));

  const card = resolvedCard(batch, storeName, {
    template: "blue",
    title: `⏳ Đang giảm bid — ${storeName}`,
    note: `Xác nhận bởi **${actor.displayName}**. Đang tính lại theo dữ liệu mới nhất và tạo file Bulk; kết quả sẽ gửi riêng cho bạn.`,
  });
  return { toast: { type: "success", content: "Đã nhận xác nhận, đang tạo file Bulk…" }, card: { type: "raw", data: card } };
}

/* ------------------------------------------------------------------ */
/* Telegram (@nce_ppc_action_bot) — kênh tạm khi Lark hết quota          */
/* ------------------------------------------------------------------ */

/**
 * PPC_AUTO_DECREASE_CHANNEL = lark | telegram | both | none. Mặc định: both nếu đã cấu hình bot Telegram, không thì lark.
 * none = tạo lô bình thường nhưng không gửi tin cho ai (chạy thử / test; lô vẫn duyệt được trên web).
 */
export function autoDecreaseChannels(): { lark: boolean; telegram: boolean } {
  const raw = (process.env.PPC_AUTO_DECREASE_CHANNEL || "").trim().toLowerCase();
  const telegramReady = isTelegramActionConfigured();
  if (raw === "none") return { lark: false, telegram: false };
  if (raw === "lark") return { lark: true, telegram: false };
  if (raw === "telegram") return { lark: false, telegram: telegramReady };
  return { lark: true, telegram: telegramReady };
}

interface TelegramRecipient {
  actor_id: string;
  display_name: string;
  chat_id: string;
}

/** Telegram (bot action) của CHÍNH người đã cấu hình; người đó vẫn phải được phân quyền phụ trách store. */
export async function listTelegramRecipients(teamId: string, storeId: string, actorId: string): Promise<TelegramRecipient[]> {
  const sql = await getDatabaseClient();
  return sql<TelegramRecipient[]>`
    SELECT link.actor_id, app_user.display_name, link.chat_id
    FROM ppc_store_user_access access
    JOIN app_users app_user
      ON app_user.team_id = access.team_id AND app_user.user_id = access.actor_id AND app_user.status = 'approved'
    JOIN ppc_telegram_links link
      ON link.team_id = access.team_id AND link.actor_id = access.actor_id AND link.enabled = TRUE
    WHERE access.team_id = ${teamId} AND access.store_id = ${storeId} AND access.actor_id = ${actorId}
      AND access.receive_action_notifications = TRUE
  `;
}

const TG_CONFIRM = "adc"; // bấm "Xác nhận giảm" → hỏi lại
const TG_CONFIRM_SURE = "adk"; // "Chắc chắn" → chạy
const TG_BACK = "adb"; // "Quay lại"
const TG_SNOOZE = "ads"; // "Hoãn"
const TELEGRAM_TEXT_LIMIT = 3900; // Telegram tối đa 4096 ký tự

function telegramMainKeyboard(batchId: string, storeName: string): InlineKeyboard {
  return [
    [{ text: "✅ Xác nhận giảm", callback_data: `${TG_CONFIRM}:${batchId}` }],
    [
      { text: `⏸️ Hoãn ${SNOOZE_DAYS} ngày`, callback_data: `${TG_SNOOZE}:${batchId}` },
      { text: "🔍 Xem chi tiết", url: detailUrl(storeName) },
    ],
  ];
}

/** Tin nhắn Telegram (HTML): giống thẻ Lark bản gọn — mỗi target 1 dòng, tên SKU là link. */
export function buildTelegramBatchMessage(input: BatchCardInput, resolved?: { title: string; note: string }) {
  const sum = summarizeBatch(input.items);
  const bySku = new Map<string, AutoDecreaseItem[]>();
  for (const item of input.items) bySku.set(item.sku || "N/A", [...(bySku.get(item.sku || "N/A") || []), item]);
  const skuGroups = [...bySku.entries()].sort(
    (a, b) => b[1].reduce((s, i) => s + i.spend, 0) - a[1].reduce((s, i) => s + i.spend, 0),
  );
  const e = escapeHtml;
  const head = [
    `<b>${e(resolved?.title || `🔻 Đề xuất giảm Bid — ${input.storeName}`)}</b>`,
    `<i>${viDate(input.runDate)} · Auto giảm Bid</i>`,
    "",
    `<b>${sum.targets} target · ${sum.skus} SKU</b>${resolved ? "" : ` chờ ≥ ${input.settings.waitDays} ngày chưa xử lý`}`,
    `Bid TB ${usd(sum.avgOld)} → <b>${usd(sum.avgNew)}</b> (${sum.avgPct}%) · Spend 30N ${usd(sum.spend)} · ACOS ${pct(sum.acos)}`,
  ].join("\n");
  const foot = resolved
    ? `\n${resolved.note}`
    : "\nXác nhận → kiểm tra lại rồi đẩy Bulk lên Amazon · Không bấm → bid giữ nguyên";

  const blocks: string[] = [];
  let shown = 0;
  let length = head.length + foot.length + 200;
  outer: for (const [sku, items] of skuGroups) {
    const first = items[0];
    const meta = [first.productType, first.breakEvenAcos ? `BE ${pct(first.breakEvenAcos)}` : ""].filter(Boolean).join(" · ");
    const lines = [`📦 <a href="${e(skuUrl(input.storeName, sku))}">${e(sku)}</a>${meta ? ` · ${e(meta)}` : ""}`];
    for (const item of items) {
      if (shown >= CARD_MAX_TARGETS) break outer;
      const perf = item.orders > 0 ? `ACOS ${pct(item.acos)}` : `${item.clicks} click, 0 đơn`;
      const line = `• ${e(item.keyword.slice(0, 45))} — ${usd(item.currentBid)} → <b>${usd(item.finalBid)}</b> (${item.changePct}%) · ${perf}`;
      if (length + line.length + lines.join("\n").length > TELEGRAM_TEXT_LIMIT) break outer;
      lines.push(line);
      shown++;
    }
    if (lines.length > 1) {
      blocks.push(lines.join("\n"));
      length += lines.join("\n").length + 2;
    }
  }
  const hidden = input.items.length - shown;
  if (hidden > 0) blocks.push(`… và ${hidden} target khác → <a href="${e(detailUrl(input.storeName))}">xem đủ trên web</a>`);

  return {
    html: `${head}\n\n${blocks.join("\n\n")}\n${foot}`,
    keyboard: resolved ? [[{ text: "🔍 Xem chi tiết", url: detailUrl(input.storeName) }]] : telegramMainKeyboard(input.batchId, input.storeName),
  };
}

/** Sửa tin Telegram của mọi người nhận lô này sang trạng thái mới (không còn nút bấm). */
async function syncTelegramMessages(batch: BatchRow, storeName: string, title: string, note: string) {
  if (!isTelegramActionConfigured()) return;
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{ chat_id: string; message_id: string }>>`
    SELECT chat_id, message_id FROM ppc_auto_decrease_telegram_messages WHERE batch_id = ${batch.id}
  `;
  if (!rows.length) return;
  const message = buildTelegramBatchMessage({
    batchId: batch.id, storeName, runDate: toDateString(batch.run_date), snapshotDate: null,
    items: batch.items || [], settings: { waitDays: 0, minBid: 0 },
  }, { title, note });
  await Promise.allSettled(rows.map((row) => editTelegramHtml(row.chat_id, Number(row.message_id), message.html, message.keyboard)));
}

function syncTelegramInBackground(batch: BatchRow, storeName: string, title: string, note: string) {
  void syncTelegramMessages(batch, storeName, title, note)
    .catch((error) => console.warn("[auto-decrease] Sửa tin Telegram lỗi:", error instanceof Error ? error.message : error));
}

function telegramResultHtml(storeName: string, actor: DecisionActor, result: ConfirmResult) {
  const e = escapeHtml;
  const applied = result.applied || [];
  const lines = result.uploaded
    ? [
      `🟢 <b>Đã xếp hàng giảm bid — ${e(storeName)}</b>`,
      `${result.actionCount} target · xác nhận bởi ${e(actor.displayName)}`,
      `File Bulk: <code>${e(result.fileName || "—")}</code>. Mac mini đang đẩy lên Amazon Ads.`,
      ...(applied.length ? ["", "<b>Thay đổi đã duyệt:</b>", ...applied.slice(0, 25).map(
        (a, i) => `${i + 1}. ${e(a.keyword.slice(0, 50))} (${e(a.sku)}) · ${usd(a.from)} → <b>${usd(a.to)}</b> (${a.changePct}%)`,
      )] : []),
      applied.length > 25 ? `… và ${applied.length - 25} target khác.` : "",
    ]
    : [
      `🔴 <b>Giảm bid chưa thực hiện được — ${e(storeName)}</b>`,
      e(result.error || "Lỗi không xác định"),
      result.actionCount ? `${result.actionCount} thay đổi đã nằm trong Hàng đợi Auto Bid trên web, có thể upload lại ở đó.` : "",
    ];
  if (result.skipped.length) {
    lines.push("", `<b>Bỏ qua ${result.skipped.length} target</b> (dữ liệu đã thay đổi):`,
      ...result.skipped.slice(0, 10).map((s) => `• ${e(s.keyword.slice(0, 50))}: ${e(s.reason)}`));
  }
  return lines.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Lượt bấm nút trên tin Telegram của bot action. */
export async function handleAutoDecreaseTelegramCallback(input: {
  callbackId: string;
  data: string;
  chatId: string;
  fromId: string;
  messageId: number;
}) {
  const [kind, batchId] = input.data.split(":");
  if (![TG_CONFIRM, TG_CONFIRM_SURE, TG_BACK, TG_SNOOZE].includes(kind) || !/^[0-9a-f-]{36}$/i.test(batchId || "")) {
    await answerTelegramCallback(input.callbackId, "Nút không hợp lệ.");
    return;
  }
  // Chat riêng: chat_id = id người bấm. Khác nhau = tin bị chuyển tiếp / lạ → từ chối.
  if (input.chatId !== input.fromId) {
    await answerTelegramCallback(input.callbackId, "Chỉ người nhận tin mới được thao tác.", true);
    return;
  }
  const linked = await resolveTelegramActor(input.chatId);
  if (!linked) {
    await answerTelegramCallback(input.callbackId, "Telegram này chưa liên kết tài khoản NCE Hub.", true);
    return;
  }
  const actor: DecisionActor = linked;
  const batch = await loadBatch(batchId);
  if (!batch || batch.team_id !== actor.teamId) {
    await answerTelegramCallback(input.callbackId, "Không tìm thấy lô giảm bid.", true);
    return;
  }
  const stores = await (await getDatabaseClient())<Array<{ name: string }>>`SELECT name FROM ppc_stores WHERE id = ${batch.store_id} LIMIT 1`;
  const storeName = stores[0]?.name || "";

  if (kind === TG_CONFIRM || kind === TG_BACK) {
    if (batch.status !== "PENDING") {
      await answerTelegramCallback(input.callbackId, alreadyDecidedMessage(batch), true);
      return;
    }
    if (kind === TG_BACK) {
      await editTelegramKeyboard(input.chatId, input.messageId, telegramMainKeyboard(batch.id, storeName));
      await answerTelegramCallback(input.callbackId, "Đã huỷ, bid chưa đổi.");
      return;
    }
    const sum = summarizeBatch(batch.items || []);
    await editTelegramKeyboard(input.chatId, input.messageId, [
      [{ text: `✅ Chắc chắn giảm ${sum.targets} target`, callback_data: `${TG_CONFIRM_SURE}:${batch.id}` }],
      [{ text: "↩️ Quay lại", callback_data: `${TG_BACK}:${batch.id}` }],
    ]);
    const biggest = sum.biggest;
    await answerTelegramCallback(
      input.callbackId,
      `Giảm bid ${sum.targets} target (${sum.skus} SKU), TB ${usd(sum.avgOld)} → ${usd(sum.avgNew)}`
        + (biggest ? `. Nhiều nhất: ${biggest.keyword.slice(0, 30)} ${biggest.changePct}%` : "")
        + ". Bấm “Chắc chắn” để đẩy lên Amazon.",
      true,
    );
    return;
  }

  if (kind === TG_SNOOZE) {
    const outcome = await snoozeAutoDecreaseBatch(batchId, actor, "telegram");
    await answerTelegramCallback(input.callbackId, outcome.ok ? `Đã hoãn ${SNOOZE_DAYS} ngày.` : outcome.message, !outcome.ok);
    return;
  }

  // TG_CONFIRM_SURE
  const claim = await claimBatch(batchId, actor, "CONFIRMING", "telegram");
  if (!claim.ok) {
    await answerTelegramCallback(input.callbackId, claim.message, true);
    return;
  }
  await answerTelegramCallback(input.callbackId, "Đã nhận xác nhận, đang tạo file Bulk…");
  void runClaimedBatch(claim.batch, claim.storeName, actor)
    .then((outcome) => sendTelegramHtml(input.chatId, telegramResultHtml(outcome.storeName, actor, outcome.result)))
    .catch((error) => console.error(`[auto-decrease] Xác nhận lô ${batchId} (Telegram) lỗi:`, error));
}

/** Tin thử để người dùng kiểm tra đã liên kết đúng. */
export async function sendTelegramTestMessage(teamId: string, actorId: string) {
  const link = await getTelegramLink(teamId, actorId);
  if (!link?.enabled) throw new Error("Bạn chưa kết nối Telegram.");
  await sendTelegramHtml(link.chatId, "🔔 <b>Tin thử</b> từ NCE Hub — Auto giảm Bid.\nĐã kết nối đúng, sáng 9h bạn sẽ nhận đề xuất giảm bid ở đây.");
}

/** Mac mini báo kết quả upload: nếu job thuộc một lô Auto giảm Bid thì gửi thêm qua Telegram cho người xác nhận. */
export async function notifyAutoDecreaseUploadTelegram(jobId: string, teamId: string, actorId: string, lines: string[]) {
  if (!autoDecreaseChannels().telegram) return;
  const sql = await getDatabaseClient();
  const batches = await sql<Array<{ id: string }>>`
    SELECT id FROM ppc_auto_decrease_batches
    WHERE team_id = ${teamId} AND result->>'jobId' = ${jobId} LIMIT 1
  `;
  if (!batches[0]) return;
  const link = await getTelegramLink(teamId, actorId);
  if (!link?.enabled) return;
  const html = lines
    .map((line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"))
    .join("\n");
  await sendTelegramHtml(link.chatId, html);
}
