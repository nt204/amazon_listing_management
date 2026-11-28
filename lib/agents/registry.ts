import "server-only";

import type { AgentModule } from "@/lib/agents/types";
import { accountingReconciliationAgent } from "@/lib/agents/accounting-reconciliation/agent";
import { ppcAutobidGuideAgent } from "@/lib/agents/ppc-autobid-guide/agent";
import { ppcManualbidGuideAgent } from "@/lib/agents/ppc-manualbid-guide/agent";
import { ppcNegativeGuideAgent } from "@/lib/agents/ppc-negative-guide/agent";
import { ppcSaleKwGuideAgent } from "@/lib/agents/ppc-salekw-guide/agent";
import { ppcNewCampGuideAgent } from "@/lib/agents/ppc-newcamp-guide/agent";
import { autoMockupGuideAgent } from "@/lib/agents/auto-mockup-guide/agent";
import { listingGuideAgent } from "@/lib/agents/listing-guide/agent";

// Danh sách agent của hệ thống. Thêm agent mới (PPC, tồn kho, listing…): tạo thư mục lib/agents/<tên>/
// gồm tools.ts + agent.ts rồi đăng ký ở đây. Agent tổng sau này cũng đọc danh sách này để giao việc.
export type AnyAgentModule = AgentModule<unknown, unknown>;

export const AGENT_MODULES: Record<string, AnyAgentModule> = {
  [accountingReconciliationAgent.definition.name]: accountingReconciliationAgent,
  [ppcAutobidGuideAgent.definition.name]: ppcAutobidGuideAgent as AnyAgentModule,
  [ppcManualbidGuideAgent.definition.name]: ppcManualbidGuideAgent as AnyAgentModule,
  [ppcNegativeGuideAgent.definition.name]: ppcNegativeGuideAgent as AnyAgentModule,
  [ppcSaleKwGuideAgent.definition.name]: ppcSaleKwGuideAgent as AnyAgentModule,
  [ppcNewCampGuideAgent.definition.name]: ppcNewCampGuideAgent as AnyAgentModule,
  [autoMockupGuideAgent.definition.name]: autoMockupGuideAgent as AnyAgentModule,
  [listingGuideAgent.definition.name]: listingGuideAgent as AnyAgentModule,
};

export function getAgentModule(name: string): AnyAgentModule | null {
  return Object.prototype.hasOwnProperty.call(AGENT_MODULES, name) ? AGENT_MODULES[name] : null;
}
