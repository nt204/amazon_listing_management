// Dựng lịch sử hội thoại đưa cho model — hàm thuần, không I/O, không gọi AI (rẻ, test được).
// Thay cho cách cũ "6 lượt gần nhất, nguyên văn":
//   • giữ tới `maxTurns` lượt (luôn gồm câu đầu tiên — thường là chủ đề chính); `fullTurns` lượt gần nhất giữ
//     nguyên văn, lượt cũ hơn rút còn phần **Kết luận**;
//   • "đã tra gì" (tool + phạm vi) của từng lượt gom thành GHI CHÚ RIÊNG đặt trước câu hỏi mới — KHÔNG chèn vào
//     câu trả lời cũ: model bắt chước định dạng tin nhắn assistant, chèn vào đó thì nó tự viết "đã tra" giả và
//     bịa số mà không gọi tool (đã gặp khi thử thật);
//   • khối bối cảnh màn hình chỉ giữ khi khác lượt trước;
//   • có ngân sách ký tự: vượt thì bỏ lượt cũ nhất trước.

import type { AgentStepLog, ChatTurn } from "@/lib/agent-core/types";

export interface HistoryRow {
  input: string;
  answer: string;
  steps: AgentStepLog[] | null;
}

export interface HistoryOptions {
  maxTurns?: number;
  fullTurns?: number;
  maxChars?: number;
  summaryChars?: number;
}

export interface BuiltHistory {
  turns: ChatTurn[];
  /** Ghi chú "các lượt trước đã tra gì" — ghép trước câu hỏi mới (xem withHistoryNotes), không lưu vào lịch sử. */
  notes: string | null;
}

const CONTEXT_BLOCK = /^(\[BỐI CẢNH[^\]]*\][\s\S]*?\[\/BỐI CẢNH\])\s*/;
const STEP_FIELDS = ["metric", "by", "compareWith", "compareStartDate", "compareEndDate", "storeNames", "storeName", "team", "channel", "sku", "checks"];
const NOTES_OPEN = "[GHI CHÚ HỆ THỐNG — các lượt trước đã tra]";
const NOTES_CLOSE = "[/GHI CHÚ HỆ THỐNG]";

/** Phần **Kết luận** của câu trả lời (hoặc đoạn đầu nếu không có), tối đa `max` ký tự. */
export function summarizeAnswer(answer: string, max: number): string {
  const conclusion = answer.match(/\*\*Kết luận:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[^*\n]{2,60}:\*\*|$)/);
  const text = (conclusion ? conclusion[1] : answer).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "explain_metric(metric=profit, 2026-11-01→2026-11-18)" cho các tool đã chạy thành công (bỏ trùng). */
export function describeSteps(steps: AgentStepLog[] | null): string | null {
  if (!steps?.length) return null;
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.ok) continue;
    const input = (step.input ?? {}) as Record<string, unknown>;
    const parts = STEP_FIELDS.flatMap((key) => {
      const v = input[key];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return [];
      return [`${key}=${Array.isArray(v) ? v.join("|") : String(v)}`];
    });
    if (input.startDate && input.endDate) parts.push(`${input.startDate}→${input.endDate}`);
    seen.add(`${step.tool}(${parts.join(", ")})`);
  }
  return seen.size ? [...seen].join("; ") : null;
}

/** Bỏ mọi khối / dòng ghi chú hệ thống nếu model lỡ chép vào câu trả lời. */
export function stripHistoryMarkers(answer: string): string {
  return answer
    .replace(/\[GHI CHÚ HỆ THỐNG[\s\S]*?\[\/GHI CHÚ HỆ THỐNG\]/g, "")
    .replace(/^.*\[Ghi chú hệ thống[^\]]*\].*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Ghép ghi chú lịch sử trước câu hỏi mới (chỉ gửi model, không lưu). */
export function withHistoryNotes(message: string, notes: string | null): string {
  return notes ? `${NOTES_OPEN}\n${notes}\nĐây là ghi chú để hiểu câu hỏi nối tiếp — KHÔNG chép vào câu trả lời; cần số thì gọi tool lại.\n${NOTES_CLOSE}\n\n${message}` : message;
}

export function buildHistoryTurns(rows: HistoryRow[], options: HistoryOptions = {}): BuiltHistory {
  const maxTurns = options.maxTurns ?? 12;
  const fullTurns = options.fullTurns ?? 3;
  const maxChars = options.maxChars ?? 24_000;
  const summaryChars = options.summaryChars ?? 400;
  // Dài hơn maxTurns: giữ câu đầu tiên (thường là chủ đề chính) + các lượt gần nhất
  const recent = rows.length > maxTurns ? [rows[0], ...rows.slice(-(maxTurns - 1))] : rows;

  let previousContext: string | null = null;
  const turns = recent.map((row, i) => {
    const full = i >= recent.length - fullTurns;
    // Khối bối cảnh: giữ khi khác lượt trước, không thì thay bằng 1 dòng ngắn
    const match = row.input.match(CONTEXT_BLOCK);
    const contextBlock = match?.[1] ?? null;
    const question = match ? row.input.slice(match[0].length) : row.input;
    const user =
      contextBlock && contextBlock !== previousContext
        ? `${contextBlock}\n\n${question}`
        : contextBlock
          ? `(cùng bối cảnh màn hình với câu trước)\n${question}`
          : question;
    if (contextBlock) previousContext = contextBlock;
    const answer = stripHistoryMarkers(row.answer);
    return {
      user,
      assistant: full ? answer : summarizeAnswer(answer, summaryChars),
      question: question.replace(/\s+/g, " ").trim().slice(0, 80),
      tools: describeSteps(row.steps),
    };
  });

  // Ngân sách ký tự: bỏ lượt cũ nhất trước (luôn giữ ít nhất lượt gần nhất)
  let total = turns.reduce((s, t) => s + t.user.length + t.assistant.length, 0);
  while (turns.length > 1 && total > maxChars) {
    const dropped = turns.shift()!;
    total -= dropped.user.length + dropped.assistant.length;
  }

  const noteLines = turns.map((t, i) => `- Lượt ${i + 1} ("${t.question}"): ${t.tools ?? "không gọi tool"}`);
  return {
    turns: turns.flatMap((t) => [
      { role: "user" as const, content: t.user },
      { role: "assistant" as const, content: t.assistant },
    ]),
    notes: turns.length ? noteLines.join("\n") : null,
  };
}
