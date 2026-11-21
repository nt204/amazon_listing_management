import test from "node:test";
import assert from "node:assert/strict";

import { buildHistoryTurns, describeSteps, stripHistoryMarkers, summarizeAnswer, withHistoryNotes, type HistoryRow } from "../lib/agent-core/history";
import type { AgentStepLog } from "../lib/agent-core/types";

const ctx = (metric: string, period = "Kỳ: 2026-11-01 → 2026-11-18") =>
  `[BỐI CẢNH TRÊN MÀN HÌNH]\nChỉ số: ${metric}\n${period}\n[/BỐI CẢNH]\n\n`;
const step = (tool: string, input: Record<string, unknown>, ok = true): AgentStepLog => ({ tool, input, ok, ms: 1, outputChars: 1 });
const answer = (n: number) =>
  `**Kết luận:** Câu trả lời số ${n} có kết luận ngắn.\n\n**Cách tính:**\n${"- chi tiết dài dòng\n".repeat(40)}\n**Đối chiếu:** xem tab FBA.`;

function rows(count: number): HistoryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    input: `${ctx("Profit")}câu hỏi ${i + 1}`,
    answer: answer(i + 1),
    steps: [step("explain_metric", { metric: "profit", startDate: "2026-11-01", endDate: "2026-11-18", storeNames: ["LIMIMA"] })],
  }));
}

test("summarizeAnswer lấy đúng phần Kết luận, cắt theo độ dài", () => {
  assert.equal(summarizeAnswer(answer(3), 400), "Câu trả lời số 3 có kết luận ngắn.");
  assert.equal(summarizeAnswer("Không có tiêu đề nào cả, chỉ là đoạn văn rất dài", 10), "Không có …");
});

test("describeSteps ghi tool + phạm vi, bỏ bước lỗi và bước trùng", () => {
  const text = describeSteps([
    step("explain_metric", { metric: "margin", startDate: "2026-11-01", endDate: "2026-11-18", storeNames: ["LIMIMA", "BOZSPACER"] }),
    step("explain_metric", { metric: "margin", startDate: "2026-11-01", endDate: "2026-11-18", storeNames: ["LIMIMA", "BOZSPACER"] }),
    step("trace_source_rows", { metric: "revenue" }, false),
  ]);
  assert.equal(text, "explain_metric(metric=margin, storeNames=LIMIMA|BOZSPACER, 2026-11-01→2026-11-18)");
  assert.equal(describeSteps(null), null);
});

test("3 lượt gần nhất giữ nguyên văn, lượt cũ hơn chỉ còn Kết luận; câu trả lời cũ KHÔNG chứa ghi chú hệ thống", () => {
  const { turns, notes } = buildHistoryTurns(rows(5));
  const answers = turns.filter((t) => t.role === "assistant").map((t) => t.content);
  assert.equal(answers.length, 5);
  assert.equal(answers[0], "Câu trả lời số 1 có kết luận ngắn.");
  assert.match(answers[4], /chi tiết dài dòng/);
  // Chèn ghi chú vào tin nhắn assistant làm model bắt chước, tự viết "đã tra" giả và bịa số
  for (const a of answers) assert.doesNotMatch(a, /Ghi chú hệ thống|GHI CHÚ HỆ THỐNG/i);
  assert.match(notes ?? "", /- Lượt 1 \("câu hỏi 1"\): explain_metric\(metric=profit, storeNames=LIMIMA, 2026-11-01→2026-11-18\)/);
  assert.equal(notes?.split("\n").length, 5);
});

test("withHistoryNotes ghép ghi chú trước câu hỏi; stripHistoryMarkers xóa ghi chú model lỡ chép vào câu trả lời", () => {
  assert.equal(withHistoryNotes("hỏi", null), "hỏi");
  const msg = withHistoryNotes("còn BOZSPACER thì sao?", "- Lượt 1: explain_metric(metric=profit)");
  assert.match(msg, /^\[GHI CHÚ HỆ THỐNG — các lượt trước đã tra\]/);
  assert.match(msg, /còn BOZSPACER thì sao\?$/);
  const leaked = "**Kết luận:** Profit là $1.\n\n[Ghi chú hệ thống — đã tra: explain_metric(metric=profit)]\n\n[GHI CHÚ HỆ THỐNG — x]\nabc\n[/GHI CHÚ HỆ THỐNG]";
  assert.equal(stripHistoryMarkers(leaked), "**Kết luận:** Profit là $1.");
});

test("cuộc chat dài: luôn giữ câu hỏi đầu tiên + các lượt gần nhất", () => {
  const { turns } = buildHistoryTurns(rows(20), { maxTurns: 12 });
  const questions = turns.filter((t) => t.role === "user").map((t) => t.content);
  assert.equal(questions.length, 12);
  assert.match(questions[0], /câu hỏi 1$/);
  assert.match(questions[1], /câu hỏi 10$/);
  assert.match(questions[11], /câu hỏi 20$/);
});

test("khối bối cảnh chỉ giữ khi đổi so với lượt trước", () => {
  const { turns } = buildHistoryTurns([
    { input: `${ctx("Profit")}a`, answer: "x", steps: null },
    { input: `${ctx("Profit")}b`, answer: "y", steps: null },
    { input: `${ctx("TACOS")}c`, answer: "z", steps: null },
  ]);
  const q = turns.filter((t) => t.role === "user").map((t) => t.content);
  assert.match(q[0], /^\[BỐI CẢNH TRÊN MÀN HÌNH\]/);
  assert.equal(q[1], "(cùng bối cảnh màn hình với câu trước)\nb");
  assert.match(q[2], /Chỉ số: TACOS/);
});

test("vượt ngân sách ký tự thì bỏ lượt cũ nhất, luôn giữ lượt gần nhất", () => {
  const { turns } = buildHistoryTurns(rows(6), { maxChars: 2_000 });
  const questions = turns.filter((t) => t.role === "user").map((t) => t.content);
  assert.ok(questions.length >= 1 && questions.length < 6);
  assert.match(questions[questions.length - 1], /câu hỏi 6$/);
});
