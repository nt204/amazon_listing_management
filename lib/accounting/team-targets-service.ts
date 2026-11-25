import "server-only";

// Nhận mục tiêu sếp giao qua Lark: tin tag bot → AI bóc ý → code đổi ra khoảng ngày (team-targets.ts) → lưu nháp
// → card xác nhận (trả lời đúng tin). Bấm "Xác nhận" mới ghi vào accounting_team_targets; báo cáo ngày đọc bảng đó.
// Bật bằng LARK_TEAM_TARGETS=1 (mặc định tắt: bot bỏ qua và trả lời như cũ).

import type { TransactionSql } from "postgres";
import { ApiError } from "@/lib/api-guard";
import { getDatabaseClient } from "@/lib/db";
import { sendLarkCardNotification, type LarkRecipient } from "@/lib/lark-notifications";
import { resolveLarkActorStoreAccess } from "@/lib/ppc/store-user-access";
import { listTeams, parseStoreTeams } from "./store-teams";
import {
  daysBetween,
  defaultTargetLabel,
  looksLikeTargetMessage,
  parseTargetListCommand,
  TARGET_KINDS,
  TARGET_METRICS,
  type TargetKind,
  type TargetMetric,
  monthWeekBlocks,
  normalizeExtraction,
  parseAiJson,
  rangeLabel,
  type ActiveTeamTarget,
  type NormalizedTargets,
  type TeamTargetItem,
} from "./team-targets";

export function teamTargetIntakeEnabled(): boolean {
  return process.env.LARK_TEAM_TARGETS?.trim() === "1";
}

const vnToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

async function loadRoster() {
  const sql = await getDatabaseClient();
  const stores = await sql<Array<{ name: string; team: string | null }>>`
    SELECT name, team FROM stores WHERE COALESCE(team, '') <> '' ORDER BY name
  `;
  const storeTeams = new Map(stores.map((s) => [s.name.trim().toUpperCase(), parseStoreTeams(s.team)]));
  return { stores, storeTeams, knownTeams: listTeams(stores) };
}

function weekListText(sentDate: string): string {
  const months = [sentDate.slice(0, 7)];
  const [y, m] = sentDate.split("-").map(Number);
  months.push(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`);
  return months
    .map((month) => `${month}: ${monthWeekBlocks(month).map((b, i) => `tuần ${i + 1} ${b.startDate.slice(8)}–${b.endDate.slice(8)}`).join(", ")}`)
    .join("\n");
}

function systemPrompt(sentDate: string, roster: string, teams: string[]): string {
  return `Bạn bóc MỤC TIÊU sếp giao cho team bán hàng Amazon từ 1 tin nhắn Lark. Chỉ trả về JSON thuần, không giải thích.
Ngày gửi tin: ${sentDate}.
Các tuần của tháng (chỉ để tham khảo, KHÔNG tự tính ngày):
${weekListText(sentDate)}
Team hợp lệ: ${teams.join(", ")} ("Team 3" = "FBA 3"). Store và team:
${roster}

Quy tắc:
- KHÔNG tự tính ngày. Với mỗi mục tiêu ghi: month "YYYY-MM"; week_ref = "first" | "middle" | "last" | số thứ tự tuần (1..n) | "W50" | "this" | "next";
  weeks_in_plan = số tuần sếp nói cho tháng đó ("3 tuần tháng 12" → 3), không nói thì null.
  Chỉ điền start_date/end_date ("YYYY-MM-DD") khi tin ghi thẳng ngày (vd "từ 1/12 đến 10/12").
- kind: "week_total" (tổng 1 tuần) | "daily_rate" (mỗi ngày) | "month_total" (tổng tháng) | "margin_floor" (margin tối thiểu %, kèm store nếu có).
- "Còn thực hiện X" / "còn X" cho THÁNG HIỆN TẠI → month_total với remaining=true. "còn X cho N tuần tháng sau" → month_total remaining=false.
- metric: "units" (unit/sale/đơn), "revenue" (doanh thu, $), "profit" (lợi nhuận), "margin".
- "tối thiểu"/"ít nhất" → comparator ">="; mặc định ">=". "Dự kiến" → is_estimate=true.
- Số liệu hiện trạng ("hiện đang ~400") và lời dặn ("tham khảo để đẩy ads") đưa vào "context", KHÔNG phải mục tiêu.
- team: chỉ điền khi tin nhắc team hoặc store; không có thì null.
- Tin không giao mục tiêu nào (câu hỏi, trò chuyện) → targets = [].
Schema: {"team":string|null,"targets":[{"kind":string,"metric":string,"value":number,"month":string,"week_ref":string|number|null,"weeks_in_plan":number|null,"start_date":string|null,"end_date":string|null,"remaining":boolean,"store":string|null,"comparator":">="|"=","is_estimate":boolean,"quote":"đoạn gốc"}],"context":[string],"warnings":[string]}`;
}

async function extractWithAi(text: string, sentDate: string, roster: string, teams: string[]) {
  const apiKey = (process.env.LARK_AGENT_KEY || process.env.CHEAPKEYAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("Chưa cấu hình LARK_AGENT_KEY.");
  const baseUrl = (process.env.LARK_AGENT_BASE_URL || "https://cheapkeyai.shop/v1").replace(/\/+$/, "");
  const model = (process.env.LARK_TEAM_TARGETS_MODEL || process.env.LARK_AGENT_MODEL || "gemini-3.5-flash-lite").trim();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(sentDate, roster, teams) },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AI API lỗi (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return parseAiJson(data.choices?.[0]?.message?.content ?? "");
}

// ───────────────────────── Card ─────────────────────────

/** Mục tiêu đưa vào báo cáo ngày: tổng Units của 1 tuần. */
const isTrackedItem = (it: Pick<TeamTargetItem, "kind" | "metric">) => it.kind === "week_total" && it.metric === "units";

const fmtValue = (it: Pick<TeamTargetItem, "metric" | "value">) =>
  it.metric === "margin"
    ? `${it.value}%`
    : it.metric === "units"
      ? `${Math.round(it.value).toLocaleString("en-US")} units`
      : `$${Math.round(it.value).toLocaleString("en-US")}`;

function itemLine(it: TeamTargetItem): string {
  const range = it.endDate
    ? `${rangeLabel(it.startDate, it.endDate)}, ${daysBetween(it.startDate, it.endDate)} ngày`
    : rangeLabel(it.startDate, null) + " tới khi có mức mới";
  const per = it.kind === "daily_rate" ? "/ngày" : "";
  const est = it.isEstimate ? " _(dự kiến)_" : "";
  const note = it.note ? `\n   <font color='grey'>↳ ${it.note}</font>` : "";
  return `• **${it.label}** (${range}): **${it.comparator === ">=" ? "≥" : ""}${fmtValue(it)}${per}**${est}${note}`;
}

type CardState =
  | { kind: "pending" }
  | { kind: "confirmed"; by: string; team: string }
  | { kind: "cancelled"; by: string };

function draftCard(draftId: string, parsed: NormalizedTargets, knownTeams: string[], state: CardState): Record<string, unknown> {
  const team = state.kind === "confirmed" ? state.team : parsed.team;
  // Trước mắt báo cáo ngày chỉ theo dõi Units của từng tuần; các mục tiêu khác vẫn lưu lại (kèm tin gốc) để tham khảo
  const tracked = parsed.items.filter(isTrackedItem);
  const stored = parsed.items.filter((it) => !isTrackedItem(it));
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: tracked.length
        ? ["**📌 Theo dõi trong báo cáo ngày** (Units từng tuần)", ...tracked.map(itemLine)].join("\n")
        : "<font color='grey'>Không có mục tiêu Units theo tuần nào — báo cáo ngày không đổi.</font>",
    },
  ];
  if (stored.length) {
    elements.push({
      tag: "markdown",
      content: ["**🗂 Chỉ lưu lại** <font color='grey'>(chưa đưa vào báo cáo)</font>", ...stored.map(itemLine)].join("\n"),
    });
  }
  if (parsed.context.length) {
    elements.push({ tag: "markdown", content: `<font color='grey'>Ghi chú: ${parsed.context.join(" · ")}</font>` });
  }
  if (parsed.warnings.length) {
    elements.push({ tag: "markdown", content: parsed.warnings.map((w) => `<font color='orange'>⚠️ ${w}</font>`).join("\n") });
  }

  if (state.kind === "pending") {
    const button = (label: string, type: string, value: Record<string, string>) => ({
      tag: "button",
      text: { tag: "plain_text", content: label },
      type,
      width: "fill",
      value: { ...value, draftId },
    });
    const confirmButtons = team
      ? [button(`✅ Lưu cho ${team}`, "primary", { action: "TEAM_TARGET_CONFIRM", team })]
      : knownTeams.map((t) => button(`Lưu cho ${t}`, "primary", { action: "TEAM_TARGET_CONFIRM", team: t }));
    const all = [...confirmButtons, button("❌ Huỷ", "danger", { action: "TEAM_TARGET_CANCEL" })];
    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: team
          ? "Kiểm tra khoảng ngày rồi bấm **Lưu**. Sai thì bấm **Huỷ** và tag bot nhắn lại (có thể ghi thẳng ngày, vd \"1–12/12: 6000 units\")."
          : "Tin chưa ghi team: **chọn team để lưu**. Lần sau ghi luôn trong tin, vd \"team 3: tuần cuối tháng 11 …\".",
      },
      {
        tag: "column_set",
        flex_mode: "flow",
        background_style: "default",
        columns: all.map((b) => ({ tag: "column", width: "weighted", weight: 1, elements: [b] })),
      },
    );
  } else {
    elements.push(
      { tag: "hr" },
      {
        tag: "markdown",
        content: state.kind === "confirmed"
          ? `✅ **Đã lưu cho ${state.team}** bởi ${state.by}. Báo cáo ngày sẽ hiện Target tuần / % đạt tuần (Units).`
          : `❌ **Đã huỷ** bởi ${state.by}. Không lưu gì.`,
      },
    );
  }

  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      template: state.kind === "pending" ? "orange" : state.kind === "confirmed" ? "green" : "grey",
      title: {
        tag: "plain_text",
        content: `🎯 Mục tiêu ${team ?? "team"} — ${state.kind === "pending" ? "chờ xác nhận" : state.kind === "confirmed" ? "đã lưu" : "đã huỷ"}`,
      },
      subtitle: { tag: "plain_text", content: "Bot đọc từ tin nhắn · tuần T2 → CN, đủ 7 ngày" },
    },
    body: { elements },
  };
}

// ───────────────────────── Tin nhắn tag bot ─────────────────────────

export interface TeamTargetMessageInput {
  message: string;
  chatId: string;
  messageId?: string;
  senderOpenId?: string;
  recipient: LarkRecipient;
  sendToLark: boolean;
  sentDate?: string;
}

/**
 * Tin tag bot có giao mục tiêu → lưu nháp + trả card xác nhận, trả về true. Không phải tin giao mục tiêu
 * (hoặc tính năng tắt) → false để bot trả lời như bình thường.
 */
export async function handleTeamTargetMessage(input: TeamTargetMessageInput): Promise<{ handled: boolean; replyText?: string }> {
  if (!teamTargetIntakeEnabled()) return { handled: false };
  const listed = await handleTeamTargetListMessage(input);
  if (listed.handled) return listed;
  if (!looksLikeTargetMessage(input.message)) return { handled: false };
  const sentDate = input.sentDate ?? vnToday();
  const { stores, storeTeams, knownTeams } = await loadRoster();
  const roster = stores.map((s) => `${s.name}: ${s.team}`).join("\n");

  let raw;
  try {
    raw = await extractWithAi(input.message, sentDate, roster, knownTeams);
  } catch (err) {
    console.error("[TeamTargets] Lỗi gọi AI bóc mục tiêu:", err);
    return { handled: false };
  }
  if (!raw?.targets?.length) return { handled: false };

  const sql = await getDatabaseClient();
  const parsed = normalizeExtraction(raw, { sentDate, knownTeams, storeTeams, text: input.message });
  if (!parsed.items.length) return { handled: false };

  const messageId = input.messageId || `manual:${Date.now()}`;
  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO accounting_team_target_drafts (chat_id, message_id, sender_open_id, raw_text, sent_date, team, parsed)
    VALUES (${input.chatId}, ${messageId}, ${input.senderOpenId ?? null}, ${input.message}, ${sentDate}, ${parsed.team}, ${sql.json(JSON.parse(JSON.stringify(parsed)))})
    ON CONFLICT (message_id) DO NOTHING
    RETURNING id
  `;
  if (!rows[0]) return { handled: true, replyText: "Tin này đã được ghi nhận trước đó." };

  const card = draftCard(rows[0].id, parsed, knownTeams, { kind: "pending" });
  const replyText = [`Mục tiêu ${parsed.team ?? "(chưa rõ team)"} chờ xác nhận:`, ...parsed.items.map(itemLine), ...parsed.warnings.map((w) => `⚠️ ${w}`)].join("\n");
  if (input.sendToLark) await sendLarkCardNotification(card, input.recipient);
  return { handled: true, replyText };
}

// ───────────────────────── Nút trên card ─────────────────────────

const NOT_LINKED = { toast: { type: "error", content: "Tài khoản Lark của bạn chưa liên kết NCE HUB (nhắn bot: kết nối <email>)." } };

/** Tên người bấm nút trên card (tài khoản NCE HUB đã liên kết Lark); chưa liên kết → null. */
async function larkOperatorName(operatorIds: string[]): Promise<string | null> {
  for (const id of operatorIds) {
    const actor = await resolveLarkActorStoreAccess(id);
    if (!actor.actorId) continue;
    const sql = await getDatabaseClient();
    return (await sql<Array<{ name: string }>>`
      SELECT COALESCE(NULLIF(display_name, ''), username) AS name FROM app_users
      WHERE team_id = ${actor.teamId} AND user_id = ${actor.actorId} LIMIT 1
    `)[0]?.name ?? actor.actorId;
  }
  return null;
}

type Tx = TransactionSql<Record<string, never>>;

/** Mục tiêu cũ cùng team + loại + chỉ số + store, khoảng ngày chồng lên → 'superseded' (trừ `exceptId`). */
async function supersedeOverlaps(
  tx: Tx,
  t: { team: string; kind: string; metric: string; storeName: string | null; startDate: string; endDate: string | null },
  exceptId: string | null,
) {
  await tx`
    UPDATE accounting_team_targets SET status = 'superseded'
    WHERE status = 'active' AND team = ${t.team} AND kind = ${t.kind} AND metric = ${t.metric}
      AND store_name IS NOT DISTINCT FROM ${t.storeName}
      AND start_date <= COALESCE(${t.endDate}::date, 'infinity'::date)
      AND COALESCE(end_date, 'infinity'::date) >= ${t.startDate}::date
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
  `;
}

export async function handleTeamTargetCardAction(
  action: "TEAM_TARGET_CONFIRM" | "TEAM_TARGET_CANCEL",
  draftId: string,
  teamArg: string | undefined,
  operatorIds: string[],
): Promise<Record<string, unknown>> {
  const who = await larkOperatorName(operatorIds);
  if (!who) return NOT_LINKED;
  const sql = await getDatabaseClient();

  const { knownTeams } = await loadRoster();
  const team = action === "TEAM_TARGET_CONFIRM" ? knownTeams.find((t) => t === teamArg) : undefined;
  if (action === "TEAM_TARGET_CONFIRM" && !team) return { toast: { type: "error", content: `Team không hợp lệ: ${teamArg ?? "—"}` } };

  // Chỉ lần bấm đầu tiên được xử lý (bấm 2 lần / 2 người cùng bấm)
  const claimed = await sql<Array<{ chat_id: string; parsed: NormalizedTargets }>>`
    UPDATE accounting_team_target_drafts
    SET status = ${action === "TEAM_TARGET_CONFIRM" ? "confirmed" : "cancelled"}, team = COALESCE(${team ?? null}, team),
        decided_by = ${who}, decided_at = NOW()
    WHERE id = ${draftId} AND status = 'pending'
    RETURNING chat_id, parsed
  `;
  if (!claimed[0]) return { toast: { type: "info", content: "Mục tiêu này đã được xử lý trước đó." } };
  const { parsed } = claimed[0];

  if (action === "TEAM_TARGET_CANCEL") {
    return {
      toast: { type: "info", content: "Đã huỷ, không lưu gì." },
      card: { type: "raw", data: draftCard(draftId, parsed, knownTeams, { kind: "cancelled", by: who }) },
    };
  }

  await sql.begin(async (tx) => {
    for (const it of parsed.items) {
      // Mục tiêu cũ cùng loại + chỉ số + store, khoảng ngày chồng lên → thay bằng mục tiêu mới
      await supersedeOverlaps(tx, { ...it, team: team! }, null);
      await tx`
        INSERT INTO accounting_team_targets
          (draft_id, team, kind, metric, store_name, start_date, end_date, value, comparator, is_estimate, label, quote, note, created_by)
        VALUES (${draftId}, ${team!}, ${it.kind}, ${it.metric}, ${it.storeName}, ${it.startDate}, ${it.endDate}, ${it.value},
          ${it.comparator}, ${it.isEstimate}, ${it.label}, ${it.quote}, ${it.note}, ${who})
      `;
    }
  });

  return {
    toast: { type: "success", content: `Đã lưu ${parsed.items.length} mục tiêu cho ${team}.` },
    card: { type: "raw", data: draftCard(draftId, parsed, knownTeams, { kind: "confirmed", by: who, team: team! }) },
  };
}

// ───────────────────────── Báo cáo ngày ─────────────────────────

/** Mục tiêu đang áp dụng tại `date`, theo team. */
export async function listActiveTeamTargets(date: string): Promise<Map<string, ActiveTeamTarget[]>> {
  const sql = await getDatabaseClient();
  const rows = await sql<Array<{
    team: string; kind: ActiveTeamTarget["kind"]; metric: ActiveTeamTarget["metric"]; value: string;
    start_date: string; end_date: string | null; store_name: string | null; comparator: ">=" | "=";
    is_estimate: boolean; label: string;
  }>>`
    SELECT team, kind, metric, value::text, start_date::text, end_date::text, store_name, comparator, is_estimate, label
    FROM accounting_team_targets
    WHERE status = 'active' AND start_date <= ${date}::date AND (end_date IS NULL OR end_date >= ${date}::date)
    ORDER BY team, start_date, created_at
  `;
  const byTeam = new Map<string, ActiveTeamTarget[]>();
  for (const r of rows) {
    const list = byTeam.get(r.team) ?? [];
    list.push({
      kind: r.kind, metric: r.metric, value: Number(r.value), startDate: r.start_date, endDate: r.end_date,
      storeName: r.store_name, comparator: r.comparator, isEstimate: r.is_estimate, label: r.label,
    });
    byTeam.set(r.team, list);
  }
  return byTeam;
}

// ───────────────────────── Xem / xoá qua Lark ─────────────────────────

const KPI_TARGETS_URL = "https://ncehub.net/?view=accounting&section=kpi&kpi=targets";

interface TargetRow {
  id: string;
  team: string;
  kind: TargetKind;
  metric: TargetMetric;
  store_name: string | null;
  start_date: string;
  end_date: string | null;
  value: string;
  comparator: ">=" | "=";
  is_estimate: boolean;
  label: string;
  quote: string | null;
  note: string | null;
  status: "active" | "superseded" | "cancelled";
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

const TARGET_COLUMNS = `id, team, kind, metric, store_name, start_date::text, end_date::text, value::text, comparator,
  is_estimate, label, quote, note, status, created_by, created_at::text, updated_by, updated_at::text`;

function rowLine(r: TargetRow): string {
  const item = {
    kind: r.kind, metric: r.metric, value: Number(r.value), startDate: r.start_date, endDate: r.end_date,
    storeName: r.store_name, comparator: r.comparator, isEstimate: r.is_estimate, label: r.label, quote: null, note: null,
  } satisfies TeamTargetItem;
  return itemLine(item).replace(/^• /, "");
}

/** Card danh sách mục tiêu, mỗi dòng 1 nút Xoá. `ids` = các mục tiêu card đang liệt kê (để vẽ lại sau khi xoá). */
function listCard(rows: TargetRow[], title: string, ids: string[], footer?: string): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [];
  const byTeam = new Map<string, TargetRow[]>();
  for (const r of rows) byTeam.set(r.team, [...(byTeam.get(r.team) ?? []), r]);
  for (const [team, list] of byTeam) {
    elements.push({ tag: "markdown", content: `**${team}**` });
    for (const r of list) {
      elements.push({
        tag: "column_set",
        flex_mode: "none",
        horizontal_spacing: "small",
        columns: [
          { tag: "column", width: "weighted", weight: 5, vertical_align: "center", elements: [{ tag: "markdown", content: rowLine(r) }] },
          {
            tag: "column", width: "auto", vertical_align: "center",
            elements: [{
              tag: "button", text: { tag: "plain_text", content: "🗑 Xoá" }, type: "danger", size: "small",
              value: { action: "TEAM_TARGET_DELETE", targetId: r.id, ids: ids.join(",") },
            }],
          },
        ],
      });
    }
  }
  if (!rows.length) elements.push({ tag: "markdown", content: "Không còn mục tiêu nào đang hoặc sắp áp dụng." });
  if (footer) elements.push({ tag: "markdown", content: footer });
  elements.push(
    { tag: "hr" },
    {
      tag: "button", text: { tag: "plain_text", content: "📋 Xem / sửa trên web" }, type: "default",
      multi_url: { url: KPI_TARGETS_URL, pc_url: KPI_TARGETS_URL, android_url: KPI_TARGETS_URL, ios_url: KPI_TARGETS_URL },
    },
  );
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: { template: "blue", title: { tag: "plain_text", content: title }, subtitle: { tag: "plain_text", content: "Bấm 🗑 Xoá để bỏ mục tiêu (báo cáo ngày không còn tính)" } },
    body: { elements },
  };
}

/** "xoá mục tiêu" / "bỏ target tuần 2" / "xem mục tiêu" → card danh sách mục tiêu đang và sắp áp dụng, có nút Xoá. */
async function handleTeamTargetListMessage(input: TeamTargetMessageInput): Promise<{ handled: boolean; replyText?: string }> {
  const today = input.sentDate ?? vnToday();
  const { knownTeams } = await loadRoster();
  const cmd = parseTargetListCommand(input.message, today, knownTeams);
  if (!cmd) return { handled: false };
  const sql = await getDatabaseClient();
  // Không ghi team thì liệt kê mọi team (không đoán theo nhóm chat)
  const team = cmd.team;
  let rows: TargetRow[] = await sql.unsafe<TargetRow[]>(
    `SELECT ${TARGET_COLUMNS} FROM accounting_team_targets
     WHERE status = 'active' AND (end_date IS NULL OR end_date >= $1::date) AND ($2::text IS NULL OR team = $2)
     ORDER BY team, start_date, kind LIMIT 30`,
    [today, team],
  );
  let footer: string | undefined;
  if (cmd.range) {
    const r = cmd.range;
    const inWeek = rows.filter((x) => x.start_date <= r.endDate && (x.end_date ?? "9999-12-31") >= r.startDate && x.kind !== "margin_floor" && x.kind !== "month_total");
    if (inWeek.length) rows = inWeek;
    else footer = `<font color='grey'>Không có mục tiêu tuần ${rangeLabel(r.startDate, r.endDate)} — đang liệt kê tất cả.</font>`;
  }
  const title = `🎯 Mục tiêu ${team ?? "các team"}${cmd.range ? ` · ${cmd.range.label} (${rangeLabel(cmd.range.startDate, cmd.range.endDate)})` : ""}`;
  const card = listCard(rows, title, rows.map((r) => r.id), footer);
  if (input.sendToLark) await sendLarkCardNotification(card, input.recipient);
  return { handled: true, replyText: [title, ...rows.map((r) => `• [${r.team}] ${rowLine(r)}`)].join("\n") };
}

export async function handleTeamTargetDeleteAction(targetId: string, ids: string[], operatorIds: string[]): Promise<Record<string, unknown>> {
  const who = await larkOperatorName(operatorIds);
  if (!who) return NOT_LINKED;
  const sql = await getDatabaseClient();
  const deleted = await sql<Array<{ label: string; team: string }>>`
    UPDATE accounting_team_targets SET status = 'cancelled', updated_by = ${who}, updated_at = NOW()
    WHERE id = ${targetId} AND status = 'active'
    RETURNING label, team
  `;
  const validIds = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const rows: TargetRow[] = validIds.length
    ? await sql.unsafe<TargetRow[]>(
        `SELECT ${TARGET_COLUMNS} FROM accounting_team_targets WHERE status = 'active' AND id = ANY($1::uuid[]) ORDER BY team, start_date, kind`,
        [validIds],
      )
    : [];
  const footer = deleted[0]
    ? `<font color='green'>✅ Đã xoá **${deleted[0].label}** (${deleted[0].team}) — bởi ${who}</font>`
    : "<font color='grey'>Mục tiêu này đã được xoá hoặc thay trước đó.</font>";
  return {
    toast: deleted[0] ? { type: "success", content: `Đã xoá ${deleted[0].label}` } : { type: "info", content: "Mục tiêu đã được xử lý trước đó." },
    card: { type: "raw", data: listCard(rows, "🎯 Mục tiêu team", validIds, footer) },
  };
}

// ───────────────────────── Trang web (KPI kinh doanh → Mục tiêu tuần) ─────────────────────────

export interface TeamTargetDto {
  id: string;
  team: string;
  kind: TargetKind;
  metric: TargetMetric;
  storeName: string | null;
  startDate: string;
  endDate: string | null;
  value: number;
  comparator: ">=" | "=";
  isEstimate: boolean;
  label: string;
  quote: string | null;
  status: TargetRow["status"];
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const toDto = (r: TargetRow): TeamTargetDto => ({
  id: r.id, team: r.team, kind: r.kind, metric: r.metric, storeName: r.store_name, startDate: r.start_date,
  endDate: r.end_date, value: Number(r.value), comparator: r.comparator, isEstimate: r.is_estimate, label: r.label,
  quote: r.quote, status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
});

/** Mục tiêu đang + sắp áp dụng (kèm đã qua trong `pastDays` ngày) của mọi team, và danh sách team / store để chọn. */
export async function listTeamTargetsForWeb(pastDays = 35) {
  const sql = await getDatabaseClient();
  const today = vnToday();
  const rows = await sql.unsafe<TargetRow[]>(
    `SELECT ${TARGET_COLUMNS} FROM accounting_team_targets
     WHERE status = 'active' AND (end_date IS NULL OR end_date >= ($1::date - $2::int))
     ORDER BY start_date DESC, team, kind`,
    [today, pastDays],
  );
  const { stores, knownTeams } = await loadRoster();
  return {
    today,
    teams: knownTeams,
    stores: stores.map((s) => ({ name: s.name.trim().toUpperCase(), teams: parseStoreTeams(s.team) })),
    targets: rows.map(toDto),
  };
}

export interface TeamTargetInput {
  team: string;
  kind: TargetKind;
  metric: TargetMetric;
  storeName: string | null;
  startDate: string;
  endDate: string | null;
  value: number;
  isEstimate?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Kiểm tra dữ liệu nhập từ web; lỗi → ném Error với lời nhắn tiếng Việt. */
async function validateInput(raw: Partial<TeamTargetInput>): Promise<TeamTargetInput> {
  const { knownTeams, storeTeams } = await loadRoster();
  const team = knownTeams.find((t) => t === raw.team);
  if (!team) throw new ApiError("Chọn team.", 400);
  const kind = TARGET_KINDS.find((k) => k === raw.kind);
  if (!kind) throw new ApiError("Chọn loại mục tiêu.", 400);
  const metric = kind === "margin_floor" ? "margin" : TARGET_METRICS.find((m) => m === raw.metric && m !== "margin");
  if (!metric) throw new ApiError("Chọn chỉ số (Units / Revenue / Profit).", 400);
  const value = Number(raw.value);
  if (!Number.isFinite(value) || value <= 0) throw new ApiError("Mục tiêu phải là số lớn hơn 0.", 400);
  if (!raw.startDate || !ISO_DATE.test(raw.startDate)) throw new ApiError("Chọn ngày bắt đầu.", 400);
  const endDate = kind === "margin_floor" && !raw.endDate ? null : raw.endDate ?? null;
  if (kind !== "margin_floor" && !endDate) throw new ApiError("Chọn ngày kết thúc.", 400);
  if (endDate && (!ISO_DATE.test(endDate) || endDate < raw.startDate)) throw new ApiError("Ngày kết thúc phải sau ngày bắt đầu.", 400);
  const storeName = raw.storeName?.trim() ? raw.storeName.trim().toUpperCase() : null;
  if (storeName && !(storeTeams.get(storeName) ?? []).includes(team)) throw new ApiError(`Store ${storeName} không thuộc ${team}.`, 400);
  return { team, kind, metric, storeName, startDate: raw.startDate, endDate, value, isEstimate: Boolean(raw.isEstimate) };
}

export async function createTeamTarget(raw: Partial<TeamTargetInput>, actor: string): Promise<TeamTargetDto> {
  const t = await validateInput(raw);
  const sql = await getDatabaseClient();
  const label = defaultTargetLabel(t.kind, t.startDate, t.endDate, t.storeName);
  const rows = await sql.begin(async (tx) => {
    await supersedeOverlaps(tx, t, null);
    return tx.unsafe<TargetRow[]>(
      `INSERT INTO accounting_team_targets (team, kind, metric, store_name, start_date, end_date, value, is_estimate, label, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nhập trên web', $10) RETURNING ${TARGET_COLUMNS}`,
      [t.team, t.kind, t.metric, t.storeName, t.startDate, t.endDate, t.value, Boolean(t.isEstimate), label, actor],
    );
  });
  return toDto(rows[0]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateTeamTarget(id: string, raw: Partial<TeamTargetInput>, actor: string): Promise<TeamTargetDto> {
  if (!UUID.test(id)) throw new ApiError("Không tìm thấy mục tiêu.", 404);
  const sql = await getDatabaseClient();
  const cur = (await sql.unsafe<TargetRow[]>(`SELECT ${TARGET_COLUMNS} FROM accounting_team_targets WHERE id = $1 AND status = 'active'`, [id]))[0];
  if (!cur) throw new ApiError("Không tìm thấy mục tiêu (có thể đã bị xoá hoặc thay).", 400);
  const t = await validateInput({
    team: raw.team ?? cur.team, kind: raw.kind ?? cur.kind, metric: raw.metric ?? cur.metric,
    storeName: raw.storeName !== undefined ? raw.storeName : cur.store_name,
    startDate: raw.startDate ?? cur.start_date, endDate: raw.endDate !== undefined ? raw.endDate : cur.end_date,
    value: raw.value ?? Number(cur.value), isEstimate: raw.isEstimate ?? cur.is_estimate,
  });
  // Đổi ngày / store thì đặt lại tên theo khoảng ngày mới; chỉ đổi con số thì giữ tên
  const rangeChanged = t.startDate !== cur.start_date || t.endDate !== cur.end_date || t.storeName !== cur.store_name || t.kind !== cur.kind;
  const label = rangeChanged ? defaultTargetLabel(t.kind, t.startDate, t.endDate, t.storeName) : cur.label;
  const rows = await sql.begin(async (tx) => {
    await supersedeOverlaps(tx, t, id);
    return tx.unsafe<TargetRow[]>(
      `UPDATE accounting_team_targets
       SET team = $2, kind = $3, metric = $4, store_name = $5, start_date = $6, end_date = $7, value = $8, is_estimate = $9,
           label = $10, updated_by = $11, updated_at = NOW()
       WHERE id = $1 AND status = 'active' RETURNING ${TARGET_COLUMNS}`,
      [id, t.team, t.kind, t.metric, t.storeName, t.startDate, t.endDate, t.value, Boolean(t.isEstimate), label, actor],
    );
  });
  if (!rows[0]) throw new ApiError("Không tìm thấy mục tiêu (có thể đã bị xoá hoặc thay).", 400);
  return toDto(rows[0]);
}

export async function deleteTeamTarget(id: string, actor: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const sql = await getDatabaseClient();
  const rows = await sql`
    UPDATE accounting_team_targets SET status = 'cancelled', updated_by = ${actor}, updated_at = NOW()
    WHERE id = ${id} AND status = 'active' RETURNING id
  `;
  return rows.length > 0;
}
