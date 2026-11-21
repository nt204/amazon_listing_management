import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { runAgent, toolSpec, truncateToolResult } from "../lib/agent-core/runner";
import type { ModelClient, ModelRequest, ModelResponse } from "../lib/agent-core/model-gateway";
import type { AgentDefinition, AgentEvent, AgentTool } from "../lib/agent-core/types";

/** Model giả: trả lần lượt các phản hồi đã soạn, ghi lại request để kiểm tra. */
function scriptedModel(replies: Partial<ModelResponse>[]) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = {
    async complete(req) {
      requests.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
      const r = replies.shift() ?? { content: "hết kịch bản" };
      return { content: "", toolCalls: [], model: "fake", promptTokens: 10, completionTokens: 5, ...r };
    },
  };
  return { client, requests };
}

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

const sumTool: AgentTool<{ base: number }, { a: number; b: number }, { sum: number }> = {
  name: "sum",
  label: "Cộng",
  description: "Cộng 2 số",
  permission: "read",
  input: z.object({ a: z.number(), b: z.number() }),
  async run({ a, b }, ctx) {
    return { sum: a + b + ctx.scope.base };
  },
};

const writeTool: AgentTool<{ base: number }, Record<string, never>, string> = {
  name: "delete_everything",
  label: "Xóa",
  description: "Tool nguy hiểm",
  permission: "execute",
  input: z.object({}),
  async run() {
    throw new Error("KHÔNG ĐƯỢC CHẠY");
  },
};

function agent(overrides: Partial<AgentDefinition<{ base: number }>> = {}): AgentDefinition<{ base: number }> {
  return {
    name: "test",
    title: "Test",
    envPrefix: "AGENT_TEST",
    defaultModel: "fake",
    instructions: () => "system",
    tools: [sumTool, writeTool],
    allowedPermissions: ["read"],
    ...overrides,
  };
}

function ctx(events: AgentEvent[] = []) {
  return { actor: { teamId: "t", userId: "u", displayName: "U", role: "admin" }, scope: { base: 100 }, runId: "r", emit: (e: AgentEvent) => events.push(e) };
}

test("runner: gọi tool, đưa kết quả lại cho model rồi trả lời", async () => {
  const { client, requests } = scriptedModel([{ toolCalls: [call("1", "sum", { a: 2, b: 3 })] }, { content: "Kết quả là 105" }]);
  const events: AgentEvent[] = [];
  const res = await runAgent({ agent: agent(), ctx: ctx(events), client, history: [{ role: "user", content: "trước" }, { role: "assistant", content: "ok" }], message: "2+3?" });
  assert.equal(res.answer, "Kết quả là 105");
  assert.deepEqual(res.toolsUsed, ["sum"]);
  assert.equal(res.steps[0].ok, true);
  assert.equal(res.usage.modelCalls, 2);
  const toolMsg = requests[1].messages.find((m) => m.role === "tool") as { content: string };
  assert.deepEqual(JSON.parse(toolMsg.content), { sum: 105 });
  // lịch sử hội thoại nằm giữa system và câu hỏi mới
  assert.deepEqual(requests[0].messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.ok(events.some((e) => e.type === "tool" && e.label === "Cộng"));
});

test("runner: tool vượt quyền không được gửi cho model và bị chặn nếu model vẫn gọi", async () => {
  const { client, requests } = scriptedModel([{ toolCalls: [call("1", "delete_everything", {})] }, { content: "xong" }]);
  const res = await runAgent({ agent: agent(), ctx: ctx(), client, history: [], message: "xóa" });
  assert.deepEqual(requests[0].tools?.map((t) => t.function.name), ["sum"]);
  assert.equal(res.steps[0].ok, false);
  assert.match(res.steps[0].error ?? "", /không được phép/);
});

test("runner: tham số sai schema / JSON hỏng trả lỗi cho model tự sửa, không ném lỗi", async () => {
  const { client, requests } = scriptedModel([
    { toolCalls: [call("1", "sum", { a: "hai", b: 3 }), call("2", "sum", "{không phải json")] },
    { content: "đã sửa" },
  ]);
  const res = await runAgent({ agent: agent(), ctx: ctx(), client, history: [], message: "?" });
  assert.equal(res.answer, "đã sửa");
  assert.deepEqual(res.steps.map((s) => s.ok), [false, false]);
  const toolMsgs = requests[1].messages.filter((m) => m.role === "tool") as { content: string }[];
  assert.match(toolMsgs[0].content, /Tham số không hợp lệ/);
  assert.match(toolMsgs[1].content, /JSON/);
});

test("runner: vòng cuối không gửi tool để buộc model trả lời", async () => {
  const loop = Array.from({ length: 5 }, (_, i) => ({ toolCalls: [call(String(i), "sum", { a: 1, b: 1 })] }));
  const { client, requests } = scriptedModel([...loop.slice(0, 2), { content: "trả lời cuối" }]);
  const res = await runAgent({ agent: agent({ maxSteps: 3 }), ctx: ctx(), client, history: [], message: "?" });
  assert.equal(requests.length, 3);
  assert.equal(requests[2].tools, undefined);
  assert.equal(res.answer, "trả lời cuối");
});

test("runner: verifyAnswer bắt làm lại khi trả lời có số mà chưa gọi tool (chống bịa số)", async () => {
  const { client, requests } = scriptedModel([
    { content: "Profit là $23,257.59" },
    { toolCalls: [call("1", "sum", { a: 1, b: 2 })] },
    { content: "Profit là $103" },
  ]);
  const verify = (answer: string, tools: string[]) => (tools.length || !/\$\d/.test(answer) ? null : "Phải gọi tool.");
  const res = await runAgent({ agent: agent({ verifyAnswer: verify }), ctx: ctx(), client, history: [], message: "?" });
  assert.equal(res.answer, "Profit là $103");
  assert.deepEqual(res.toolsUsed, ["sum"]);
  const nudge = requests[1].messages[requests[1].messages.length - 1] as { role: string; content: string };
  assert.equal(nudge.role, "user");
  assert.match(nudge.content, /KIỂM TRA TỰ ĐỘNG.*Phải gọi tool/);
});

test("runner: verifyAnswer chỉ bắt làm lại 1 lần", async () => {
  const { client, requests } = scriptedModel([{ content: "$1" }, { content: "$2" }]);
  const res = await runAgent({ agent: agent({ verifyAnswer: () => "Phải gọi tool." }), ctx: ctx(), client, history: [], message: "?" });
  assert.equal(requests.length, 2);
  assert.equal(res.answer, "$2");
});

test("toolSpec: schema zod thành JSON Schema không có $schema", () => {
  const spec = toolSpec(sumTool as AgentTool<unknown>);
  assert.equal(spec.function.name, "sum");
  const params = spec.function.parameters as { $schema?: string; required?: string[] };
  assert.equal(params.$schema, undefined);
  assert.deepEqual(params.required, ["a", "b"]);
});

test("truncateToolResult cắt kết quả dài và báo cho model", () => {
  const { text, truncated } = truncateToolResult("x".repeat(50), 10);
  assert.equal(truncated, true);
  assert.match(text, /ĐÃ CẮT 40/);
});
