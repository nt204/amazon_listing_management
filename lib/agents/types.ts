import type { z } from "zod";
import type { RequestActor, SystemFeature } from "@/lib/auth";
import type { AgentDefinition } from "@/lib/agent-core/types";

/**
 * Một agent "cắm" vào hệ thống: định nghĩa (prompt + tool) + cách dựng phạm vi dữ liệu từ phân quyền
 * + quyền tính năng cần có + bối cảnh màn hình nhận từ giao diện. Đăng ký ở lib/agents/registry.ts là
 * dùng được ngay qua /api/agents/<name> và khung chat chung (components/agents/agent-chat-panel.tsx).
 */
export interface AgentModule<Scope, Context = unknown> {
  definition: AgentDefinition<Scope>;
  /** Tính năng người dùng phải được cấp (lib/auth.ts). */
  feature: SystemFeature;
  rateLimitPerMinute: number;
  /** Dựng phạm vi dữ liệu MỖI LƯỢT từ phân quyền hiện tại của người hỏi (không cache quyền). */
  createScope(actor: RequestActor): Promise<Scope>;
  contextSchema?: z.ZodType<Context>;
  formatContext?(context: Context): string;
  /** Nhãn ngắn của bối cảnh (vd "Profit · 01/11–18/11 · Tất cả store"): tên cuộc chat + nhãn trên câu hỏi. */
  describeContext?(context: Context): string | null;
  /** Gợi ý câu hỏi tiếp theo dưới câu trả lời (theo bối cảnh + tool agent đã dùng). */
  followUps?(context: Context | null, toolsUsed: string[]): string[];
}
