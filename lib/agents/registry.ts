import "server-only";

import type { AgentModule } from "@/lib/agents/types";
import { accountingReconciliationAgent } from "@/lib/agents/accounting-reconciliation/agent";
import { ppcAutobidGuideAgent } from "@/lib/agents/ppc-autobid-guide/agent";

// Danh sách agent của hệ thống. Thêm agent mới (PPC, tồn kho, listing…): tạo thư mục lib/agents/<tên>/
// gồm tools.ts + agent.ts rồi đăng ký ở đây. Agent tổng sau này cũng đọc danh sách này để giao việc.
export type AnyAgentModule = AgentModule<unknown, unknown>;

export const AGENT_MODULES: Record<string, AnyAgentModule> = {
  [accountingReconciliationAgent.definition.name]: accountingReconciliationAgent,
  [ppcAutobidGuideAgent.definition.name]: ppcAutobidGuideAgent as AnyAgentModule,
};

export function getAgentModule(name: string): AnyAgentModule | null {
  return Object.prototype.hasOwnProperty.call(AGENT_MODULES, name) ? AGENT_MODULES[name] : null;
}
