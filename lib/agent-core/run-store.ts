import "server-only";

import { getDatabaseClient } from "@/lib/db";
import type { AgentActor, AgentRunResult } from "@/lib/agent-core/types";
import type { HistoryRow } from "@/lib/agent-core/history";

// Bảng agent_runs (migration 163, 164): nhật ký từng lượt chạy, đồng thời là lịch sử hội thoại.
// Xóa 1 cuộc chat chỉ đặt cleared_at: ẩn khỏi lịch sử + ngữ cảnh model, dòng vẫn giữ để chấm điểm.
// Mọi truy vấn đọc / sửa đều lọc theo team_id + actor_id: mỗi tài khoản chỉ thấy lịch sử chat của chính mình.

/** Khối bối cảnh màn hình ghép trước câu hỏi (formatContext của từng agent) — bỏ đi khi hiển thị. */
const CONTEXT_BLOCK = /^\[BỐI CẢNH[^\]]*\][\s\S]*?\[\/BỐI CẢNH\]\s*/;

export async function startAgentRun(input: {
  id: string;
  agent: string;
  sessionId: string;
  actor: AgentActor;
  channel: string;
  /** Tin nhắn gửi model (đã ghép khối bối cảnh màn hình). */
  message: string;
  /** Câu người dùng gõ — hiển thị lại trong khung chat. */
  userMessage: string;
  context: unknown;
}) {
  const sql = await getDatabaseClient();
  await sql`
    INSERT INTO agent_runs (id, agent, session_id, team_id, actor_id, channel, input, user_message, context)
    VALUES (
      ${input.id}, ${input.agent}, ${input.sessionId}, ${input.actor.teamId}, ${input.actor.userId},
      ${input.channel}, ${input.message}, ${input.userMessage},
      ${input.context == null ? null : sql.json(input.context as never)}
    )
  `;
}

export async function finishAgentRun(id: string, result: AgentRunResult, latencyMs: number) {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE agent_runs SET
      status = 'done',
      answer = ${result.answer},
      model = ${result.model},
      steps = ${sql.json(result.steps as never)},
      usage = ${sql.json(result.usage as never)},
      latency_ms = ${latencyMs},
      finished_at = NOW()
    WHERE id = ${id}
  `;
}

export async function failAgentRun(id: string, error: string, latencyMs: number) {
  const sql = await getDatabaseClient();
  await sql`
    UPDATE agent_runs SET status = 'error', error = ${error.slice(0, 4000)}, latency_ms = ${latencyMs}, finished_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * Các lượt đã xong của hội thoại (của chính người hỏi), cũ → mới, kèm các bước tool — dựng thành lịch sử cho
 * model bằng buildHistoryTurns (lib/agent-core/history.ts). Lấy câu đầu tiên + tối đa `limit` lượt gần nhất.
 */
export async function loadSessionRows(agent: string, sessionId: string, actor: AgentActor, limit = 40): Promise<HistoryRow[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<HistoryRow[]>`
    WITH done AS (
      SELECT id, input, answer, steps, created_at FROM agent_runs
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId}
        AND agent = ${agent} AND session_id = ${sessionId} AND status = 'done' AND cleared_at IS NULL
    )
    SELECT input, answer, steps FROM (
      (SELECT * FROM done ORDER BY created_at ASC LIMIT 1)
      UNION
      (SELECT * FROM done ORDER BY created_at DESC LIMIT ${limit})
    ) t ORDER BY created_at ASC
  `;
  return rows;
}

export interface SessionMessage {
  runId: string;
  userMessage: string;
  answer: string | null;
  status: "running" | "done" | "error";
  error: string | null;
  feedback: 1 | -1 | null;
  createdAt: string;
  /** Bối cảnh màn hình lúc hỏi (để agent đặt nhãn) và các tool đã dùng (để gợi ý câu hỏi tiếp). */
  context: unknown;
  toolsUsed: string[];
}

// Lượt "running" quá 10 phút coi như đã chết (server khởi động lại giữa chừng) — không bắt giao diện chờ mãi.
const STALE_RUNNING = "10 minutes";

/**
 * Hội thoại để hiển thị lại khi mở khung chat. Không truyền sessionId → lấy hội thoại gần nhất chưa xóa của
 * người dùng với agent này (mở trên máy khác / sau khi F5 vẫn thấy). Trả null nếu chưa có hội thoại nào.
 */
export async function loadSessionMessages(
  agent: string,
  actor: AgentActor,
  sessionId?: string,
  limit = 40,
): Promise<{ sessionId: string; messages: SessionMessage[] } | null> {
  const sql = await getDatabaseClient();
  let sid = sessionId;
  if (!sid) {
    const [latest] = await sql<{ session_id: string }[]>`
      SELECT session_id FROM agent_runs
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId} AND agent = ${agent} AND cleared_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!latest) return null;
    sid = latest.session_id;
  }
  const rows = await sql<
    { id: string; user_message: string | null; input: string; answer: string | null; status: SessionMessage["status"]; error: string | null; feedback: number | null; created_at: Date; context: unknown; tools: string[] | null }[]
  >`
    SELECT id, user_message, input, answer,
      CASE WHEN status = 'running' AND created_at < NOW() - ${STALE_RUNNING}::interval THEN 'error' ELSE status END AS status,
      CASE WHEN status = 'running' AND created_at < NOW() - ${STALE_RUNNING}::interval THEN 'Lượt trả lời bị gián đoạn.' ELSE error END AS error,
      feedback, created_at, context,
      (SELECT array_agg(DISTINCT s->>'tool') FROM jsonb_array_elements(steps) s) AS tools
    FROM (
      SELECT * FROM agent_runs
      WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId}
        AND agent = ${agent} AND session_id = ${sid} AND cleared_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) t
    ORDER BY created_at ASC
  `;
  return {
    sessionId: sid,
    messages: rows.map((r) => ({
      runId: r.id,
      // Lượt cũ (trước migration 164) chưa có user_message: bỏ khối bối cảnh khỏi input
      userMessage: r.user_message ?? r.input.replace(CONTEXT_BLOCK, ""),
      answer: r.answer,
      status: r.status,
      error: r.error,
      feedback: r.feedback === 1 || r.feedback === -1 ? r.feedback : null,
      createdAt: r.created_at.toISOString(),
      context: r.context,
      toolsUsed: r.tools ?? [],
    })),
  };
}

export interface AgentSessionSummary {
  sessionId: string;
  /** Câu hỏi đầu tiên của cuộc chat. */
  title: string;
  turns: number;
  startedAt: string;
  lastAt: string;
  /** Bối cảnh của câu hỏi đầu tiên — agent dùng để đặt tên ngắn cho cuộc chat. */
  firstContext: unknown;
}

/** Lịch sử chat của 1 tài khoản với 1 agent (mới nhất trước) — mỗi người chỉ thấy cuộc chat của chính mình. */
export async function listAgentSessions(agent: string, actor: AgentActor, limit = 50): Promise<AgentSessionSummary[]> {
  const sql = await getDatabaseClient();
  const rows = await sql<{ session_id: string; first_message: string; first_context: unknown; turns: number; started_at: Date; last_at: Date }[]>`
    SELECT session_id,
      (array_agg(COALESCE(user_message, input) ORDER BY created_at))[1] AS first_message,
      (array_agg(context ORDER BY created_at))[1] AS first_context,
      COUNT(*)::int AS turns, MIN(created_at) AS started_at, MAX(created_at) AS last_at
    FROM agent_runs
    WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId} AND agent = ${agent} AND cleared_at IS NULL
    GROUP BY session_id
    ORDER BY MAX(created_at) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    sessionId: r.session_id,
    title: r.first_message.replace(CONTEXT_BLOCK, "").replace(/\s+/g, " ").trim().slice(0, 120),
    turns: r.turns,
    startedAt: r.started_at.toISOString(),
    lastAt: r.last_at.toISOString(),
    firstContext: r.first_context,
  }));
}

/** Xóa 1 cuộc chat khỏi lịch sử: chỉ đặt cleared_at (ẩn khỏi lịch sử + ngữ cảnh model), dòng vẫn giữ để chấm điểm. */
export async function clearAgentSession(agent: string, actor: AgentActor, sessionId: string) {
  const sql = await getDatabaseClient();
  const rows = await sql`
    UPDATE agent_runs SET cleared_at = NOW()
    WHERE team_id = ${actor.teamId} AND actor_id = ${actor.userId}
      AND agent = ${agent} AND session_id = ${sessionId} AND cleared_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

/** 👍 / 👎 cho một câu trả lời — chỉ người hỏi được chấm. */
export async function setAgentRunFeedback(id: string, actor: AgentActor, feedback: 1 | -1, note?: string) {
  const sql = await getDatabaseClient();
  const rows = await sql`
    UPDATE agent_runs SET feedback = ${feedback}, feedback_note = ${note?.slice(0, 2000) || null}
    WHERE id = ${id} AND team_id = ${actor.teamId} AND actor_id = ${actor.userId}
    RETURNING id
  `;
  return rows.length > 0;
}
