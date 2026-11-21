// Lõi agent dùng chung cho mọi agent (đối soát kế toán, PPC, tồn kho…, agent tổng sau này).
// Không phụ thuộc framework: một agent = instructions + danh sách tool có schema zod + quyền.
// Sau này muốn chạy trên Mastra / MCP chỉ cần viết adapter đọc các định nghĩa này, không viết lại tool.

import type { z } from "zod";

/**
 * Mức quyền của tool:
 *   read    – chỉ đọc dữ liệu;
 *   propose – tạo đề xuất chờ người duyệt (không đổi dữ liệu thật);
 *   execute – thay đổi dữ liệu / hệ thống bên ngoài.
 * Agent khai báo mức tối đa được dùng (allowedPermissions); runner chặn tool vượt quyền.
 */
export type ToolPermission = "read" | "propose" | "execute";

export interface AgentActor {
  teamId: string;
  userId: string;
  displayName: string;
  role: string;
}

export interface AgentContext<Scope> {
  actor: AgentActor;
  /** Phạm vi dữ liệu người hỏi được xem (store / kênh…), do module agent dựng từ phân quyền. */
  scope: Scope;
  runId: string;
  signal?: AbortSignal;
  emit: (event: AgentEvent) => void;
}

export interface AgentTool<Scope, Input = unknown, Output = unknown> {
  name: string;
  /** Mô tả cho model: dùng khi nào, trả về gì. */
  description: string;
  /** Nhãn tiếng Việt hiện trên giao diện khi tool đang chạy. */
  label: string;
  permission: ToolPermission;
  input: z.ZodType<Input>;
  // Cú pháp method (không phải thuộc tính hàm) để danh sách tool khác kiểu tham số gán được vào AgentTool<Scope>[].
  run(input: Input, ctx: AgentContext<Scope>): Promise<Output>;
}

export interface AgentDefinition<Scope> {
  /** Khóa duy nhất (vd "accounting-reconciliation"), dùng trong URL API và bảng agent_runs. */
  name: string;
  title: string;
  /** Tiền tố biến môi trường cấu hình model riêng cho agent (vd "AGENT_ACCOUNTING" → AGENT_ACCOUNTING_MODEL). */
  envPrefix: string;
  defaultModel: string;
  defaultFallbackModel?: string;
  instructions(ctx: AgentContext<Scope>): Promise<string> | string;
  tools: AgentTool<Scope>[];
  allowedPermissions: ToolPermission[];
  /** Số vòng gọi model tối đa; vòng cuối không gửi tool để model buộc phải trả lời. */
  maxSteps?: number;
  /** Cắt kết quả tool quá dài trước khi đưa lại cho model. */
  maxToolResultChars?: number;
  temperature?: number;
  /**
   * Kiểm tra câu trả lời trước khi nhận (chống bịa): trả về lời nhắc nếu không đạt (vd có số liệu mà lượt này chưa
   * gọi tool nào) → runner bắt model làm lại 1 lần với lời nhắc đó; null = đạt.
   */
  verifyAnswer?(answer: string, toolsUsedThisTurn: string[]): string | null;
}

export type AgentEvent =
  | { type: "run"; runId: string; contextLabel?: string | null }
  | { type: "status"; text: string }
  | { type: "tool"; name: string; label: string }
  /** Mảnh chữ model đang viết; nếu sau đó model gọi tool thì giao diện bỏ phần chữ dở này. */
  | { type: "delta"; text: string }
  | { type: "answer"; runId: string; text: string; toolsUsed: string[]; model: string; followUps?: string[] }
  | { type: "error"; runId?: string; error: string };

export interface AgentStepLog {
  tool: string;
  input: unknown;
  ok: boolean;
  ms: number;
  outputChars: number;
  truncated?: boolean;
  error?: string;
}

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  modelCalls: number;
}

export interface AgentRunResult {
  answer: string;
  model: string;
  toolsUsed: string[];
  steps: AgentStepLog[];
  usage: AgentUsage;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
