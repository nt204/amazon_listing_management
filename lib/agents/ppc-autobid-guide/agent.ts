import "server-only";

import { z } from "zod";
import { getDatabaseClient } from "@/lib/db";
import type { AgentDefinition, AgentTool } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { getRuleVersions } from "@/lib/ppc/sku-architecture-service";
import type { PpcRuleDefinition } from "@/lib/ppc/sku-architecture-types";
import { PPC_AUTOBID_TOURS } from "@/lib/guide/ppc-autobid-tours";
import { extractTourIds, hasTourDecision } from "@/lib/guide/types";
import { PPC_AUTOBID_KNOWLEDGE } from "@/lib/agents/ppc-autobid-guide/knowledge";

// Trợ lý hướng dẫn sử dụng tab PPC "Đề xuất & Auto Bid" (THỬ NGHIỆM). Không đọc / đổi dữ liệu kinh doanh:
// chỉ trả lời cách dùng + logic, gắn kịch bản [[tour:<id>]] để giao diện làm mẫu trên màn hình.
// Model: dùng lại key Gemini của chat Lark kế toán (LARK_AGENT_KEY / LARK_AGENT_MODEL), đổi riêng bằng AGENT_PPC_GUIDE_*.

const AGENT_NAME = "ppc-autobid-guide";
const TOUR_IDS = new Set(PPC_AUTOBID_TOURS.map((t) => t.id));

type GuideScope = Record<string, never>;

const pct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

function rangeText(min: number, max: number, unit: string, minRef?: string, maxRef?: string) {
  const lo = minRef ? "BE ACoS" : `${min}${unit}`;
  const hi = maxRef === "min_40_break_even_acos_pct" ? "min(40%, BE ACoS)" : maxRef ? "BE ACoS" : max >= 999 ? "" : `${max}${unit}`;
  return hi ? `${lo} – ${hi}` : `≥ ${lo}`;
}

function actionText(action: string, p: number, base: string) {
  if (action === "HOLD") return "Giữ (không đề xuất)";
  if (action === "PAUSE_TARGET") return "Pause target";
  const from = base === "AVG_CPC" ? "CPC trung bình" : "bid hiện tại";
  return `${action === "BID_INCREASE" ? "Tăng" : "Giảm"} ${pct(p)} từ ${from}`;
}

/** Luật đang áp dụng (PUBLISHED) viết thành chữ — đúng thứ engine đọc (lib/ppc/sku-architecture-service.ts). */
export function describeRule(type: string, rule: PpcRuleDefinition) {
  const factor = rule.limits.maxBidFactor ?? (type === "SB01" || type === "SB05" ? 0.8 : 1);
  return {
    campaignType: type,
    tran: `Trần bid = ${Math.round(factor * 100)}% Max Bid của SKU`,
    coDon_theoAcosTarget: rule.hasOrder.map(
      (t) =>
        `${rangeText(t.minAcos, t.maxAcos, "%", t.minRef, t.maxRef)}: ${actionText(t.action, t.pct, t.base)}${t.activeWhen ? " (chỉ khi BE ACoS > 40%)" : ""}`,
    ),
    chuaCoDon_theoClick: rule.noOrder.map(
      (t) => `${rangeText(t.minClicks, t.maxClicks, " click", undefined, undefined)}: ${actionText(t.action, t.pct, t.base)}`,
    ),
  };
}

const getBidRules: AgentTool<GuideScope, { campaignType?: "SP03" | "SB05" | "SB01" }> = {
  name: "get_bid_rules",
  label: "Đang đọc luật chỉnh bid đang áp dụng",
  description:
    "Ngưỡng luật chỉnh bid ĐANG ÁP DỤNG (bảng ppc_rule_versions, admin có thể sửa): vùng ACoS khi target có đơn, vùng click khi chưa có đơn, % tăng/giảm, Pause, hệ số trần. Gọi khi cần nêu bất kỳ con số ngưỡng / % nào.",
  permission: "read",
  input: z.object({
    campaignType: z.enum(["SP03", "SB05", "SB01"]).optional().describe("Bỏ trống = cả 3 dạng chạy"),
  }),
  async run(input) {
    const versions = await getRuleVersions();
    const out: ReturnType<typeof describeRule>[] = [];
    for (const type of ["SP03", "SB05", "SB01"] as const) {
      if (input.campaignType && input.campaignType !== type) continue;
      const published = versions.find((v) => v.campaignType === type && v.status === "PUBLISHED");
      if (published) out.push({ ...describeRule(type, published.ruleJson), version: published.version } as never);
    }
    return {
      rules: out,
      ghiChu:
        "Mỗi target phải khớp đúng 1 vùng; giá trị đúng mép 2 vùng → không đề xuất. Ngưỡng click không đổi theo kỳ 7D/30D. Kết quả kẹp tại trần, không ép sàn.",
    };
  },
};

/** Trí nhớ theo tài khoản: các câu người này đã hỏi + hướng dẫn đã được gợi ý (mọi cuộc chat với trợ lý này). */
async function loadUserMemory(teamId: string, userId: string) {
  const sql = await getDatabaseClient();
  const rows = await sql<{ user_message: string | null; answer: string | null }[]>`
    SELECT user_message, answer FROM agent_runs
    WHERE team_id = ${teamId} AND actor_id = ${userId} AND agent = ${AGENT_NAME} AND status = 'done' AND cleared_at IS NULL
    ORDER BY created_at DESC
    LIMIT 15
  `;
  const questions = [...new Set(rows.map((r) => (r.user_message ?? "").replace(/\s+/g, " ").trim().slice(0, 100)).filter(Boolean))].slice(0, 10);
  const tours = [...new Set(rows.flatMap((r) => extractTourIds(r.answer ?? "")))];
  return { questions, tours };
}

const tourCatalog = () =>
  PPC_AUTOBID_TOURS.map((t) => `- ${t.id} — "${t.title}": ${t.summary} Dùng khi: ${t.whenToUse}`).join("\n");

const definition: AgentDefinition<GuideScope> = {
  name: AGENT_NAME,
  title: "Trợ lý hướng dẫn Auto Bid",
  envPrefix: "AGENT_PPC_GUIDE",
  defaultModel: "gemini-3.5-flash-lite",
  defaultFallbackModel: "gemini-3.1-flash-lite",
  modelEnvFallback: { apiKey: ["LARK_AGENT_KEY"], baseURL: ["LARK_AGENT_BASE_URL"], model: ["LARK_AGENT_MODEL"] },
  allowedPermissions: ["read"],
  maxSteps: 4,
  temperature: 0.1,
  tools: [getBidRules as AgentTool<GuideScope>],
  verifyAnswer(answer, toolsUsed) {
    const unknown = extractTourIds(answer).filter((id) => !TOUR_IDS.has(id));
    if (unknown.length) {
      return `Mã hướng dẫn ${unknown.map((id) => `[[tour:${id}]]`).join(", ")} không tồn tại. Chỉ dùng đúng id trong DANH MỤC HƯỚNG DẪN, hoặc bỏ mã nếu không có hướng dẫn phù hợp. Viết lại câu trả lời.`;
    }
    if (!hasTourDecision(answer)) {
      return "Thiếu dòng cuối bắt buộc. Viết lại NGUYÊN câu trả lời và kết thúc bằng 1 dòng riêng: [[tour:<id>]] nếu có hướng dẫn trong danh mục giúp người dùng thấy chỗ cần bấm / xem (câu 'làm sao', 'ở đâu', 'vì sao không có đề xuất', 'cài thế nào'… gần như luôn có), hoặc [[tour:none]] nếu thật sự không có.";
    }
    // Nêu ngưỡng luật (khoảng % / số click) mà chưa đọc luật thật → bắt gọi get_bid_rules
    const quotesThresholds = /\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*(?:%|click)|(?:≥|>=|>|từ)\s*\d+\s*click/i.test(answer);
    if (quotesThresholds && !toolsUsed.includes("get_bid_rules")) {
      return "Câu trả lời nêu ngưỡng luật (khoảng ACoS / số click) nhưng chưa gọi get_bid_rules. Ngưỡng thật nằm trong DB và có thể đã đổi: gọi get_bid_rules rồi trả lời lại theo đúng số tool trả về.";
    }
    return null;
  },
  async instructions(ctx) {
    const memory = await loadUserMemory(ctx.actor.teamId, ctx.actor.userId).catch(() => ({ questions: [], tours: [] }));
    const memoryBlock = memory.questions.length
      ? `\nTRÍ NHỚ VỀ NGƯỜI DÙNG NÀY (các lần hỏi trước, mới nhất trước — để biết họ đã biết gì, tránh lặp lại dài dòng; KHÔNG nhắc lại danh sách này):\n${memory.questions.map((q) => `- ${q}`).join("\n")}${
          memory.tours.length ? `\nHướng dẫn trên màn hình đã từng gợi ý: ${memory.tours.join(", ")}` : ""
        }\n`
      : "\nNgười dùng này lần đầu hỏi trợ lý — có thể gợi ý hướng dẫn tong-quan nếu câu hỏi chung chung.\n";
    return `Bạn là "Trợ lý hướng dẫn Auto Bid" của NCE HUB (công cụ quản lý quảng cáo Amazon). Bạn hướng dẫn nhân viên PPC dùng tab "Đề xuất & Auto Bid" và giải thích logic của nó. Người hỏi: ${ctx.actor.displayName}.
${memoryBlock}
NGUYÊN TẮC
1. Chỉ trả lời dựa trên KIẾN THỨC dưới đây và kết quả tool. Không có trong kiến thức thì nói thẳng "Mình chưa có thông tin về phần này" và gợi ý hỏi admin / team PPC — KHÔNG đoán, không bịa tên nút, menu, con số.
2. Mọi ngưỡng luật (vùng ACoS, số click, % tăng/giảm) PHẢI lấy từ tool get_bid_rules trong chính lượt đó. Các số cố định khác (CR 10%, thuế 3%, trần SB 80%, Auto giảm Bid 3 ngày / $0.10 / 7 ngày, 9h sáng…) lấy từ kiến thức.
3. Bạn KHÔNG xem được số liệu SKU / target cụ thể của người dùng. Hỏi "vì sao SKU X bị giảm" → giải thích luật chung + chỉ cách tự xem: mở Chi tiết SKU → bấm dòng target xem Lý do → nút Giải thích / AI phản biện, hoặc bấm tên SKU để chat AI về SKU đó. LUÔN gắn [[tour:ly-do-de-xuat]].
4. Câu hỏi về duyệt / chỉnh bid luôn nói tới ĐẦU RA: Duyệt chỉ vào Action Queue; bid chỉ đổi trên Amazon sau khi Xuất Bulk File rồi tự upload, hoặc Auto Upload AdsPower. Câu hỏi về bước này gắn action-queue / xuat-bulk-file / auto-upload.
5. Bạn không tự duyệt / lưu / đổi bid. Nói rõ: thao tác Duyệt, Lưu, Xác nhận là người dùng tự bấm.
6. Nói về nút "Duyệt N SKU" (duyệt hàng loạt ngoài bảng) thì LUÔN cảnh báo: nút này duyệt TẤT CẢ đề xuất của các SKU đã chọn theo bid đề xuất, không xem / sửa từng target — muốn sửa Final Bid thì vào Chi tiết từng SKU.
7. Câu hỏi ngoài phạm vi tab này (kế toán, listing, tab PPC khác…) → nói ngắn là trợ lý thử nghiệm này chỉ hướng dẫn tab Đề xuất & Auto Bid.

HƯỚNG DẪN TRÊN MÀN HÌNH — DÒNG CUỐI BẮT BUỘC
- MỌI câu trả lời kết thúc bằng 1 dòng riêng: [[tour:<id>]] (tối đa 2 mã, mỗi mã 1 dòng) hoặc [[tour:none]]. Giao diện đổi mã thành nút "Xem mình làm".
- Gắn hướng dẫn khi câu hỏi là "làm thế nào / ở đâu / nút nào / cài đặt / vì sao không có đề xuất / có tự … không", hoặc người dùng muốn "chỉ cho xem". Chọn kịch bản khớp "Dùng khi" nhất.
- [[tour:none]] chỉ khi câu hỏi thuần khái niệm không gắn với chỗ nào trên màn hình, hoặc ngoài phạm vi.
- Chỉ dùng id trong danh mục; không viết "[[tour" ở chỗ khác, không giải thích mã.
DANH MỤC HƯỚNG DẪN:
${tourCatalog()}

CÁCH TRẢ LỜI
- Tiếng Việt, xưng "mình", gọi "bạn". Ngắn, đúng trọng tâm: câu đầu trả lời thẳng; sau đó các bước đánh số (1., 2., …) hoặc gạch đầu dòng "- ", mỗi ý 1 dòng. Thường 3–8 dòng; giải thích logic có thể dài hơn nhưng không lan man.
- Gọi tên nút / chip / cột đúng như trên màn hình, in đậm: **Duyệt**, **Chi tiết**, **Giảm Bid**…
- Không dùng bảng markdown, không "---", không tên bảng database / tên biến code.
- Câu nối tiếp ("còn SB thì sao?") hiểu theo câu trước; không lặp lại phần đã nói.

KIẾN THỨC (đúng theo code hệ thống)
${PPC_AUTOBID_KNOWLEDGE}`;
  },
};

const contextSchema = z
  .object({
    page: z.string().max(80).optional(),
    store: z.string().max(100).optional(),
    windowDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

type ScreenContext = z.infer<typeof contextSchema>;

function formatContext(ctx: ScreenContext) {
  const lines = [
    `Trang: ${ctx.page ?? "PPC · Đề xuất & Auto Bid"}`,
    ctx.store && `Store đang chọn: ${ctx.store === "ALL" ? "Tất cả store (tab này cần chọn 1 store)" : ctx.store}`,
    ctx.windowDays && `Kỳ dữ liệu: ${ctx.windowDays}D`,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

function followUps(_ctx: ScreenContext | null, toolsUsed: string[]) {
  const out = ["Làm sao duyệt đề xuất cho 1 SKU?", "Vì sao SKU không có đề xuất?", "Auto giảm Bid hoạt động thế nào?"];
  if (!toolsUsed.includes("get_bid_rules")) out.unshift("Luật tăng / giảm bid SP03 hiện tại là gì?");
  return out.slice(0, 3);
}

export const ppcAutobidGuideAgent: AgentModule<GuideScope, ScreenContext> = {
  definition,
  feature: "ppc",
  rateLimitPerMinute: 20,
  contextSchema,
  formatContext,
  // Không đặt describeContext: tên cuộc chat trong Lịch sử giữ nguyên câu hỏi đầu tiên (dễ tìm lại hơn "HSOSTORE · 30D").
  followUps,
  async createScope() {
    return {};
  },
};
