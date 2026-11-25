import "server-only";

// Nhận mục tiêu sếp giao qua Lark: tin tag bot → AI bóc ý → code đổi ra khoảng ngày (team-targets.ts) → lưu nháp
// → card xác nhận (trả lời đúng tin). Bấm "Xác nhận" mới ghi vào accounting_team_targets; báo cáo ngày đọc bảng đó.
// Bật bằng LARK_TEAM_TARGETS=1 (mặc định tắt: bot bỏ qua và trả lời như cũ).

import { getDatabaseClient } from "@/lib/db";
import { sendLarkCardNotification, type LarkRecipient } from "@/lib/lark-notifications";
import { resolveLarkActorStoreAccess } from "@/lib/ppc/store-user-access";
import { listTeams, parseStoreTeams } from "./store-teams";
import {
  daysBetween,
  looksLikeTargetMessage,
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
  const elements: Array<Record<string, unknown>> = [
    { tag: "markdown", content: parsed.items.map(itemLine).join("\n") },
  ];
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
          : "Tin không nhắc store/team và nhóm này chưa gắn team: **chọn team để lưu** (bot sẽ nhớ team của nhóm này).",
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
          ? `✅ **Đã lưu cho ${state.team}** bởi ${state.by}. Báo cáo ngày sẽ hiện tiến độ các mục tiêu này.`
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
  if (!teamTargetIntakeEnabled() || !looksLikeTargetMessage(input.message)) return { handled: false };
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
  const chatTeam = (await sql<Array<{ team: string }>>`SELECT team FROM lark_chat_teams WHERE chat_id = ${input.chatId}`)[0]?.team ?? null;
  const parsed = normalizeExtraction(raw, { sentDate, knownTeams, storeTeams, chatTeam, text: input.message });
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

export async function handleTeamTargetCardAction(
  action: "TEAM_TARGET_CONFIRM" | "TEAM_TARGET_CANCEL",
  draftId: string,
  teamArg: string | undefined,
  operatorIds: string[],
): Promise<Record<string, unknown>> {
  let actor: { actorId: string | null; teamId: string | null } = { actorId: null, teamId: null };
  for (const id of operatorIds) {
    actor = await resolveLarkActorStoreAccess(id);
    if (actor.actorId) break;
  }
  if (!actor.actorId) {
    return { toast: { type: "error", content: "Tài khoản Lark của bạn chưa liên kết NCE HUB (nhắn bot: kết nối <email>)." } };
  }
  const sql = await getDatabaseClient();
  const who = (await sql<Array<{ name: string }>>`
    SELECT COALESCE(NULLIF(display_name, ''), username) AS name FROM app_users
    WHERE team_id = ${actor.teamId} AND user_id = ${actor.actorId} LIMIT 1
  `)[0]?.name ?? actor.actorId;

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
  const { chat_id: chatId, parsed } = claimed[0];

  if (action === "TEAM_TARGET_CANCEL") {
    return {
      toast: { type: "info", content: "Đã huỷ, không lưu gì." },
      card: { type: "raw", data: draftCard(draftId, parsed, knownTeams, { kind: "cancelled", by: who }) },
    };
  }

  await sql.begin(async (tx) => {
    for (const it of parsed.items) {
      // Mục tiêu cũ cùng loại + chỉ số + store, khoảng ngày chồng lên → thay bằng mục tiêu mới
      await tx`
        UPDATE accounting_team_targets SET status = 'superseded'
        WHERE status = 'active' AND team = ${team!} AND kind = ${it.kind} AND metric = ${it.metric}
          AND store_name IS NOT DISTINCT FROM ${it.storeName}
          AND start_date <= COALESCE(${it.endDate}::date, 'infinity'::date)
          AND COALESCE(end_date, 'infinity'::date) >= ${it.startDate}::date
      `;
      await tx`
        INSERT INTO accounting_team_targets
          (draft_id, team, kind, metric, store_name, start_date, end_date, value, comparator, is_estimate, label, quote, note, created_by)
        VALUES (${draftId}, ${team!}, ${it.kind}, ${it.metric}, ${it.storeName}, ${it.startDate}, ${it.endDate}, ${it.value},
          ${it.comparator}, ${it.isEstimate}, ${it.label}, ${it.quote}, ${it.note}, ${who})
      `;
    }
    // Nhớ team của nhóm chat khi chưa có (lần sau tin không nhắc store vẫn biết team)
    await tx`
      INSERT INTO lark_chat_teams (chat_id, team, updated_by) VALUES (${chatId}, ${team!}, ${who})
      ON CONFLICT (chat_id) DO NOTHING
    `;
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
