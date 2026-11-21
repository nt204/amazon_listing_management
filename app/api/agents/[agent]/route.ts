import { z } from "zod";
import { ApiError, authorize, enforceRateLimit, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { getAgentModule } from "@/lib/agents/registry";
import { executeAgentTurn } from "@/lib/agents/run";
import { clearAgentSession, listAgentSessions, loadSessionMessages, setAgentRunFeedback } from "@/lib/agent-core/run-store";
import type { AgentActor, AgentEvent } from "@/lib/agent-core/types";
import type { RequestActor } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ agent: string }> };

const sessionIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

const postSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  sessionId: sessionIdSchema,
  context: z.unknown().optional(),
});

const agentActor = (actor: RequestActor): AgentActor => ({
  teamId: actor.teamId,
  userId: actor.userId,
  displayName: actor.displayName,
  role: actor.role,
});

const feedbackSchema = z.object({
  runId: z.string().uuid(),
  feedback: z.union([z.literal(1), z.literal(-1)]),
  note: z.string().max(2000).optional(),
});

async function resolveAgent(params: RouteContext["params"]) {
  const { agent } = await params;
  const agentModule = getAgentModule(agent);
  if (!agentModule) throw new ApiError(`Không có agent "${agent}".`, 404);
  return agentModule;
}

/**
 * Lịch sử chat của tài khoản đang đăng nhập (mỗi người chỉ thấy của mình):
 *   ?list=1         → danh sách cuộc chat (mới nhất trước);
 *   ?sessionId=…    → các lượt hỏi–đáp của 1 cuộc chat;
 *   (không tham số) → cuộc chat gần nhất — mở khung chat là thấy lại, kể cả sau F5 / đổi máy.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const agentModule = await resolveAgent(params);
    const actor = await authorize(request, "read", agentModule.feature);
    const query = new URL(request.url).searchParams;
    if (query.get("list") === "1") {
      const sessions = (await listAgentSessions(agentModule.definition.name, agentActor(actor))).map(({ firstContext, ...s }) => ({
        ...s,
        title: (firstContext != null && agentModule.describeContext?.(firstContext)) || s.title,
      }));
      return Response.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
    }
    const raw = query.get("sessionId");
    const sessionId = raw ? sessionIdSchema.parse(raw) : undefined;
    const history = await loadSessionMessages(agentModule.definition.name, agentActor(actor), sessionId);
    const rows = history?.messages ?? [];
    const lastDone = rows.length && rows[rows.length - 1].status === "done" ? rows.length - 1 : -1;
    const messages = rows.map(({ context, toolsUsed, ...m }, i) => ({
      ...m,
      contextLabel: context != null ? agentModule.describeContext?.(context) ?? null : null,
      followUps: i === lastDone ? agentModule.followUps?.(context ?? null, toolsUsed) ?? [] : [],
    }));
    return Response.json({ sessionId: history?.sessionId ?? null, messages }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được lịch sử hội thoại.", 500);
  }
}

/** Xóa 1 cuộc chat khỏi lịch sử của chính người dùng (ẩn đi, nhật ký vẫn giữ để chấm điểm). */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const agentModule = await resolveAgent(params);
    const actor = await authorize(request, "read", agentModule.feature);
    const sessionId = sessionIdSchema.parse(new URL(request.url).searchParams.get("sessionId") ?? "");
    const removed = await clearAgentSession(agentModule.definition.name, agentActor(actor), sessionId);
    if (!removed) throw new ApiError("Không tìm thấy cuộc chat.", 404);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không xóa được hội thoại.", 500);
  }
}

/** Hỏi agent: trả NDJSON từng sự kiện (run → status/tool… → answer | error). */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const agentModule = await resolveAgent(params);
    const actor = await authorize(request, "read", agentModule.feature);
    await enforceRateLimit(actor, `agent:${agentModule.definition.name}`, agentModule.rateLimitPerMinute, 60);
    const input = postSchema.parse(await readJsonBody(request, 60_000));

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const emit = (event: AgentEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
          }
        };
        try {
          await executeAgentTurn({
            agentModule,
            actor,
            message: input.message,
            sessionId: input.sessionId,
            context: input.context,
            signal: request.signal,
            emit,
          });
        } catch (error) {
          console.error(`[agent:${agentModule.definition.name}] Failed:`, error);
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // stream đã đóng do client ngắt
          }
        }
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không gọi được agent.", 500);
  }
}

/** 👍 / 👎 cho một câu trả lời (dùng làm bộ chấm điểm khi đổi prompt / model). */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const agentModule = await resolveAgent(params);
    const actor = await authorize(request, "read", agentModule.feature);
    const input = feedbackSchema.parse(await readJsonBody(request, 10_000));
    const ok = await setAgentRunFeedback(
      input.runId,
      agentActor(actor),
      input.feedback,
      input.note,
    );
    if (!ok) throw new ApiError("Không tìm thấy câu trả lời.", 404);
    return Response.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Không lưu được đánh giá.", 500);
  }
}

