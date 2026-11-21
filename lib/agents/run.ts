import "server-only";

import { randomUUID } from "node:crypto";
import type { RequestActor } from "@/lib/auth";
import { createModelClient, resolveModelConfig, type ModelClient } from "@/lib/agent-core/model-gateway";
import { runAgent } from "@/lib/agent-core/runner";
import { failAgentRun, finishAgentRun, loadSessionRows, startAgentRun } from "@/lib/agent-core/run-store";
import { buildHistoryTurns, stripHistoryMarkers, withHistoryNotes } from "@/lib/agent-core/history";
import type { AgentActor, AgentEvent } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";

/**
 * Chạy 1 lượt của 1 agent cho 1 người dùng: dựng phạm vi theo phân quyền, ghép bối cảnh màn hình,
 * nạp lịch sử hội thoại, gọi runner, ghi nhật ký agent_runs. Kênh nào (web, Lark, lịch chạy) cũng gọi hàm này.
 */
export async function executeAgentTurn(options: {
  agentModule: AgentModule<unknown, unknown>;
  actor: RequestActor;
  message: string;
  sessionId: string;
  context?: unknown;
  channel?: string;
  signal?: AbortSignal;
  emit: (event: AgentEvent) => void;
  /** Test / eval truyền model giả. */
  client?: ModelClient;
}) {
  const { agentModule, actor } = options;
  const agent = agentModule.definition;
  const agentActor: AgentActor = { teamId: actor.teamId, userId: actor.userId, displayName: actor.displayName, role: actor.role };

  let context: unknown = undefined;
  let message = options.message.trim();
  if (options.context != null && agentModule.contextSchema) {
    context = agentModule.contextSchema.parse(options.context);
    if (agentModule.formatContext) message = `${agentModule.formatContext(context)}\n\n${message}`;
  }

  const runId = randomUUID();
  const started = Date.now();
  await startAgentRun({
    id: runId,
    agent: agent.name,
    sessionId: options.sessionId,
    actor: agentActor,
    channel: options.channel ?? "web",
    message,
    userMessage: options.message.trim(),
    context,
  });
  options.emit({ type: "run", runId, contextLabel: context != null ? agentModule.describeContext?.(context) ?? null : null });

  try {
    const [scope, historyRows] = await Promise.all([
      agentModule.createScope(actor),
      loadSessionRows(agent.name, options.sessionId, agentActor),
    ]);
    const history = buildHistoryTurns(historyRows);
    const client =
      options.client ??
      createModelClient(resolveModelConfig(agent.envPrefix, { model: agent.defaultModel, fallbackModel: agent.defaultFallbackModel }));
    const result = await runAgent({
      agent,
      client,
      history: history.turns,
      // Ghi chú "các lượt trước đã tra gì" chỉ gửi model, không lưu vào agent_runs.input
      message: withHistoryNotes(message, history.notes),
      ctx: { actor: agentActor, scope, runId, signal: options.signal, emit: options.emit },
    });
    result.answer = stripHistoryMarkers(result.answer);
    await finishAgentRun(runId, result, Date.now() - started);
    options.emit({
      type: "answer",
      runId,
      text: result.answer,
      toolsUsed: result.toolsUsed,
      model: result.model,
      followUps: agentModule.followUps?.(context ?? null, result.toolsUsed) ?? [],
    });
    return { runId, ...result };
  } catch (error) {
    const text = error instanceof Error ? error.message : "Lỗi chạy agent.";
    await failAgentRun(runId, text, Date.now() - started).catch(() => undefined);
    options.emit({ type: "error", runId, error: text });
    throw error;
  }
}
