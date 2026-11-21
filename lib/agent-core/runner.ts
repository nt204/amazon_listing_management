// Vòng lặp agent dùng chung: gọi model → chạy tool (kiểm tra schema + quyền) → đưa kết quả lại cho model
// cho tới khi model trả lời. Không đụng DB / HTTP: lưu nhật ký và stream do lớp gọi (API route) lo.

import { z } from "zod";
import type { ModelClient, ModelMessage, ModelToolCall, ModelToolSpec } from "@/lib/agent-core/model-gateway";
import type {
  AgentContext,
  AgentDefinition,
  AgentRunResult,
  AgentStepLog,
  AgentTool,
  ChatTurn,
} from "@/lib/agent-core/types";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 14_000;

/** Schema zod → JSON Schema cho tham số tool (bỏ khóa $schema mà một số nhà cung cấp từ chối). */
export function toolSpec(tool: AgentTool<unknown>): ModelToolSpec {
  const parameters = { ...(z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>) };
  delete parameters.$schema;
  return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
}

export function truncateToolResult(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n…[ĐÃ CẮT ${text.length - maxChars} ký tự: kết quả quá dài, hãy gọi lại tool với phạm vi hẹp hơn / top nhỏ hơn]`,
    truncated: true,
  };
}

async function runToolCall<Scope>(
  agent: AgentDefinition<Scope>,
  call: ModelToolCall,
  ctx: AgentContext<Scope>,
): Promise<{ content: string; log: AgentStepLog }> {
  const started = Date.now();
  const maxChars = agent.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;
  const tool = agent.tools.find((t) => t.name === call.function.name);
  const fail = (error: string, input: unknown = call.function.arguments) => ({
    content: JSON.stringify({ error }),
    log: { tool: call.function.name, input, ok: false, ms: Date.now() - started, outputChars: 0, error },
  });

  if (!tool) return fail(`Không có tool "${call.function.name}".`);
  // Chặn ở runner, không tin vào prompt: agent chỉ được dùng tool trong mức quyền đã khai báo.
  if (!agent.allowedPermissions.includes(tool.permission)) {
    return fail(`Agent không được phép dùng tool mức quyền "${tool.permission}".`);
  }

  let rawArgs: unknown;
  try {
    rawArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return fail("Tham số tool không phải JSON hợp lệ.");
  }
  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ");
    return fail(`Tham số không hợp lệ — ${issues}`, rawArgs);
  }

  try {
    ctx.emit({ type: "tool", name: tool.name, label: tool.label });
    const output = await tool.run(parsed.data, ctx);
    const { text, truncated } = truncateToolResult(JSON.stringify(output ?? null), maxChars);
    return {
      content: text,
      log: { tool: tool.name, input: parsed.data, ok: true, ms: Date.now() - started, outputChars: text.length, truncated },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi chạy tool.";
    return fail(message, parsed.data);
  }
}

export async function runAgent<Scope>(options: {
  agent: AgentDefinition<Scope>;
  ctx: AgentContext<Scope>;
  client: ModelClient;
  history: ChatTurn[];
  message: string;
}): Promise<AgentRunResult> {
  const { agent, ctx, client } = options;
  const tools = agent.tools.filter((t) => agent.allowedPermissions.includes(t.permission));
  const specs = tools.map((t) => toolSpec(t as AgentTool<unknown>));
  const readOnly = new Set(tools.filter((t) => t.permission === "read").map((t) => t.name));

  const messages: ModelMessage[] = [
    { role: "system", content: await agent.instructions(ctx) },
    ...options.history.map((turn) => ({ role: turn.role, content: turn.content }) as ModelMessage),
    { role: "user", content: options.message },
  ];

  const steps: AgentStepLog[] = [];
  const usage = { promptTokens: 0, completionTokens: 0, modelCalls: 0 };
  const maxSteps = agent.maxSteps ?? DEFAULT_MAX_STEPS;
  let model = "";
  let answer = "";
  let verifyRetries = 1;

  for (let step = 0; step < maxSteps; step++) {
    if (ctx.signal?.aborted) throw new Error("Đã dừng.");
    const allowTools = step < maxSteps - 1;
    ctx.emit({ type: "status", text: step === 0 ? "Đang đọc câu hỏi…" : "Đang phân tích kết quả…" });
    const res = await client.complete({
      messages,
      tools: allowTools ? specs : undefined,
      temperature: agent.temperature,
      signal: ctx.signal,
      onText: (text) => ctx.emit({ type: "delta", text }),
    });
    usage.modelCalls += 1;
    usage.promptTokens += res.promptTokens;
    usage.completionTokens += res.completionTokens;
    model = res.model;

    if (!res.toolCalls.length) {
      answer = res.content.trim();
      const nudge = agent.verifyAnswer?.(answer, [...new Set(steps.map((s) => s.tool))]) ?? null;
      // Còn ít nhất 1 vòng có tool sau vòng này thì mới bắt làm lại (vòng cuối không gửi tool)
      if (nudge && verifyRetries > 0 && step + 1 < maxSteps - 1) {
        verifyRetries -= 1;
        messages.push({ role: "assistant", content: answer });
        messages.push({ role: "user", content: `[KIỂM TRA TỰ ĐỘNG] ${nudge}` });
        answer = "";
        continue;
      }
      break;
    }
    messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });

    // Tool chỉ đọc chạy song song; có tool đổi trạng thái thì chạy tuần tự đúng thứ tự model gọi.
    const parallel = res.toolCalls.every((c) => readOnly.has(c.function.name));
    const results = parallel
      ? await Promise.all(res.toolCalls.map((c) => runToolCall(agent, c, ctx)))
      : await res.toolCalls.reduce<Promise<Awaited<ReturnType<typeof runToolCall>>[]>>(
          async (acc, c) => [...(await acc), await runToolCall(agent, c, ctx)],
          Promise.resolve([]),
        );
    res.toolCalls.forEach((call, i) => {
      steps.push(results[i].log);
      messages.push({ role: "tool", tool_call_id: call.id, content: results[i].content });
    });
  }

  return {
    answer: answer || "Xin lỗi, tôi chưa đưa ra được câu trả lời. Bạn thử hỏi cụ thể hơn (store, kỳ, chỉ số) nhé.",
    model,
    toolsUsed: [...new Set(steps.map((s) => s.tool))],
    steps,
    usage,
  };
}
