import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";

// Nhắc đánh giá SKU Testing — gửi Lark sáng mùng 3 hằng tháng.
// SKU chỉ được test 3–4 tháng kể từ tháng listing (cùng quy tắc cột "Thời gian đánh giá" ở tab SKU Testing,
// components/accounting/kqkd-view.tsx evalWindow/evalState): tới tháng listing+3 là đến hạn, listing+4 là hạn chót,
// sau đó là quá hạn. "Cần điền" = trạng thái Bảng mã chưa phải Phát triển / Hủy.
//
// Lịch chạy trong app (instrumentation.ts), TẮT mặc định:
//   SKU_EVAL_REMINDER_SCHEDULE=on        bật lịch
//   SKU_EVAL_REMINDER_DAY=3              ngày trong tháng (mặc định 3)
//   SKU_EVAL_REMINDER_HOUR=8             giờ VN (mặc định 8h)
//   SKU_EVAL_REMINDER_STORES=LIMIMA      chỉ báo các store này (bỏ trống = mọi store active)
//   SKU_EVAL_REMINDER_WEBHOOK_URL=...    nhóm nhận (mặc định nhóm tổng LARK_ACCOUNTING_WEBHOOK_URL)
// Gửi tay / xem trước: scripts/send-sku-eval-reminder.ts

const TIME_ZONE = "Asia/Ho_Chi_Minh";
const DONE_STATUSES = new Set(["phát triển", "hủy"]);
const REPORT_BASE_URL = process.env.ACCOUNTING_REPORT_BASE_URL?.trim() || "https://ncehub.net";

export type EvalBucket = "late" | "m4" | "m3";

export interface StoreEvalReminder {
  storeId: string;
  storeName: string;
  team: string;
  late: string[];
  m4: string[];
  m3: string[];
  /** Năm listing của từng SKU — bảng SKU Testing xem theo năm listing nên link chia theo năm */
  yearOf: Record<string, string>;
  total: number;
}

export interface SkuEvalReminder {
  /** YYYY-MM tháng đang nhắc */
  month: string;
  /** YYYY-MM tháng listing của SKU đang ở tháng thứ 3 / thứ 4 */
  m3Listing: string;
  m4Listing: string;
  stores: StoreEvalReminder[];
}

function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

const monthLabel = (ym: string) => `T${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`;

export function vietnamNow() {
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
      .map((p) => [p.type, p.value]),
  );
  return { month: `${parts.year}-${parts.month}`, day: Number(parts.day), hour: Number(parts.hour) };
}

export function configuredReminderStores(): string[] {
  return (process.env.SKU_EVAL_REMINDER_STORES || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * SKU cần điền trạng thái đánh giá tính tới tháng `month` (YYYY-MM). storeNames rỗng = mọi store active.
 * teamId (vd "FBA 2") = các store có cột team bắt đầu bằng mã đó ("FBA 2 / FBM" vẫn thuộc FBA 2).
 */
export async function buildSkuEvalReminder(
  month: string,
  storeNames: string[] = [],
  options: { teamId?: string } = {},
): Promise<SkuEvalReminder> {
  const teamId = options.teamId?.trim().toUpperCase() || "";
  const sql = await getDatabaseClient();
  const m3Listing = addMonths(month, -3);
  const m4Listing = addMonths(month, -4);
  const names = storeNames.map((s) => s.toUpperCase());

  const rows = await sql<{ store_id: string; store_name: string; team: string; sku: string; status: string | null; listing_month: string }[]>`
    WITH m AS (
      SELECT DISTINCT ON (store_id, sku) store_id, sku, status, left(thang_listing, 7) AS listing_month
      FROM accounting_sku_master
      WHERE deleted_at IS NULL AND thang_listing ~ '^[0-9]{4}-[0-9]{2}'
      ORDER BY store_id, sku, row_order NULLS LAST, updated_at DESC
    )
    SELECT s.id::text AS store_id, s.name AS store_name, s.team, m.sku, m.status, m.listing_month
    FROM m JOIN stores s ON s.id = m.store_id
    WHERE s.status = 'active'
      AND m.listing_month <= ${m3Listing}
      AND (${names.length === 0} OR upper(s.name) = ANY(${names}))
      AND (${teamId === ""} OR upper(trim(split_part(s.team, '/', 1))) = ${teamId})
    ORDER BY s.name, m.listing_month, m.sku
  `;

  const byStore = new Map<string, StoreEvalReminder>();
  for (const r of rows) {
    if (DONE_STATUSES.has((r.status || "").normalize("NFC").trim().toLowerCase())) continue;
    const cur =
      byStore.get(r.store_id) ||
      { storeId: r.store_id, storeName: r.store_name, team: r.team, late: [], m4: [], m3: [], yearOf: {}, total: 0 };
    const bucket: EvalBucket = r.listing_month === m3Listing ? "m3" : r.listing_month === m4Listing ? "m4" : "late";
    cur[bucket].push(r.sku);
    cur.yearOf[r.sku] = r.listing_month.slice(0, 4);
    cur.total += 1;
    byStore.set(r.store_id, cur);
  }
  return { month, m3Listing, m4Listing, stores: [...byStore.values()] };
}

/** Link mở SKU Testing đúng store + năm listing, lọc đúng các SKU (components/accounting/kqkd-view.tsx readUrlJump). */
function skuListUrl(s: StoreEvalReminder, year: string, skus: string[], label: string) {
  const params = new URLSearchParams({
    view: "accounting",
    section: "kqkd",
    kqkd_store: s.storeId,
    kqkd_year: year,
    kqkd_label: label,
    kqkd_skus: skus.join(","),
  });
  return `${REPORT_BASE_URL}/?${params.toString()}`;
}

/** Card Lark: mỗi store 3 dòng đếm (quá hạn / tháng thứ 4 / tháng thứ 3) + link mở bảng SKU Testing đã lọc sẵn. */
export function buildSkuEvalReminderCard(r: SkuEvalReminder, options: { titlePrefix?: string } = {}): Record<string, unknown> {
  const total = r.stores.reduce((sum, s) => sum + s.total, 0);
  const elements: Record<string, unknown>[] = [];

  if (!r.stores.length) {
    elements.push({ tag: "markdown", content: "✅ Không có SKU nào cần điền trạng thái đánh giá." });
  }

  for (const [i, s] of r.stores.entries()) {
    if (i > 0) elements.push({ tag: "hr" });
    // SKU listing năm khác nằm ở bảng năm khác → mỗi năm một link
    const byYear = new Map<string, string[]>();
    for (const sku of [...s.late, ...s.m4, ...s.m3]) {
      const y = s.yearOf[sku];
      byYear.set(y, [...(byYear.get(y) || []), sku]);
    }
    const years = [...byYear.keys()].sort().reverse();
    const label = `SKU cần đánh giá ${monthLabel(r.month)}`;
    const links =
      years.length === 1
        ? `[Xem danh sách SKU](${skuListUrl(s, years[0], byYear.get(years[0])!, label)})`
        : "Xem danh sách SKU: " +
          years.map((y) => `[listing ${y} (${byYear.get(y)!.length})](${skuListUrl(s, y, byYear.get(y)!, label)})`).join(" · ");
    elements.push({
      tag: "markdown",
      content: [
        `**${s.storeName}** — **${s.total} SKU** cần điền`,
        `🔴 Quá hạn (listing ${monthLabel(addMonths(r.m4Listing, -1))} trở về trước): **${s.late.length}** SKU`,
        `🟠 Tháng thứ 4 — hạn chót tháng này (listing ${monthLabel(r.m4Listing)}): **${s.m4.length}** SKU`,
        `🟡 Tháng thứ 3 — bắt đầu đánh giá (listing ${monthLabel(r.m3Listing)}): **${s.m3.length}** SKU`,
        `▸ ${links}`,
      ].join("\n"),
    });
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      template: total ? "orange" : "green",
      title: { tag: "plain_text", content: `⏰ ${options.titlePrefix ? `${options.titlePrefix} · ` : ""}SKU CẦN ĐÁNH GIÁ · ${monthLabel(r.month)} — ${total} SKU` },
    },
    body: { elements },
  };
}

export function reminderWebhookUrl() {
  return (
    process.env.SKU_EVAL_REMINDER_WEBHOOK_URL?.trim() ||
    process.env.LARK_ACCOUNTING_WEBHOOK_URL?.trim() ||
    process.env.LARK_WEBHOOK_URL?.trim() ||
    ""
  );
}

export async function sendSkuEvalReminder(month: string, storeNames: string[], webhookUrl = reminderWebhookUrl()) {
  if (!webhookUrl) throw new Error("Chưa cấu hình webhook Lark (SKU_EVAL_REMINDER_WEBHOOK_URL / LARK_ACCOUNTING_WEBHOOK_URL).");
  const reminder = await buildSkuEvalReminder(month, storeNames);
  await sendLarkWebhookNotification(webhookUrl, { card: buildSkuEvalReminderCard(reminder) });
  return reminder;
}

// ===== Lịch trong app =====

const CHECK_INTERVAL_MS = 10 * 60_000;
const MODULE_ID = Symbol("sku-eval-reminder");
const g = globalThis as typeof globalThis & { skuEvalReminderTimer?: NodeJS.Timeout; skuEvalReminderOwner?: symbol };

function scheduleDay() {
  const d = Number(process.env.SKU_EVAL_REMINDER_DAY || 3);
  return Number.isInteger(d) && d >= 1 && d <= 28 ? d : 3;
}
function scheduleHour() {
  const h = Number(process.env.SKU_EVAL_REMINDER_HOUR || 8);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8;
}

async function runIfDue() {
  const now = vietnamNow();
  // Chỉ chạy đúng ngày hẹn, từ giờ hẹn trở đi (server bật muộn trong ngày vẫn gửi bù)
  if (now.day !== scheduleDay() || now.hour < scheduleHour()) return;
  const sql = await getDatabaseClient();
  const key = `sku_eval_reminder_run:${now.month}`;
  const claimed = await sql<{ key: string }[]>`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${sql.json({ startedAt: new Date().toISOString() })})
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `;
  if (!claimed.length) return;
  const stores = configuredReminderStores();
  try {
    const r = await sendSkuEvalReminder(now.month, stores);
    const total = r.stores.reduce((sum, s) => sum + s.total, 0);
    await sql`UPDATE app_settings SET value = value || ${sql.json({ sentAt: new Date().toISOString(), total })}, updated_at = NOW() WHERE key = ${key}`;
    console.log(`[SkuEvalReminder] Đã gửi nhắc đánh giá ${now.month}: ${total} SKU, ${r.stores.length} store.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`UPDATE app_settings SET value = value || ${sql.json({ error: message })}, updated_at = NOW() WHERE key = ${key}`;
    throw error;
  }
}

export function startSkuEvalReminderScheduler() {
  if (process.env.SKU_EVAL_REMINDER_SCHEDULE !== "on") return;
  if (g.skuEvalReminderTimer) {
    if (g.skuEvalReminderOwner === MODULE_ID) return;
    clearInterval(g.skuEvalReminderTimer);
  }
  g.skuEvalReminderOwner = MODULE_ID;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runIfDue()
      .catch((error) => console.error("[SkuEvalReminder] Lỗi gửi nhắc đánh giá:", error))
      .finally(() => {
        running = false;
      });
  };
  g.skuEvalReminderTimer = setInterval(tick, CHECK_INTERVAL_MS);
  g.skuEvalReminderTimer.unref?.();
  tick();
}
