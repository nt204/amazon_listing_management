import "server-only";

import { z } from "zod";
import { getDatabaseClient } from "@/lib/db";
import type { AgentDefinition, AgentTool } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { PPC_MANUAL_BID_TOURS } from "@/lib/guide/ppc-manual-bid-tours";
import { extractTourIds, hasTourDecision } from "@/lib/guide/types";
import { PPC_MANUAL_BID_KNOWLEDGE } from "@/lib/agents/ppc-manualbid-guide/knowledge";

// Trợ lý hướng dẫn sử dụng tab PPC "Chỉnh Bid Tay" (Manual Bid). Không sửa đổi dữ liệu:
// chỉ trả lời cách dùng + logic, gắn kịch bản [[tour:<id>]] để giao diện làm mẫu trên màn hình.

const AGENT_NAME = "ppc-manualbid-guide";
const TOUR_IDS = new Set(PPC_MANUAL_BID_TOURS.map((t) => t.id));

type GuideScope = Record<string, never>;

/** Trí nhớ theo tài khoản: các câu người này đã hỏi + hướng dẫn đã được gợi ý. */
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
  PPC_MANUAL_BID_TOURS.map((t) => `- ${t.id} — "${t.title}": ${t.summary} Dùng khi: ${t.whenToUse}`).join("\n");

const definition: AgentDefinition<GuideScope> = {
  name: AGENT_NAME,
  title: "Trợ lý hướng dẫn Chỉnh Bid Tay",
  envPrefix: "AGENT_PPC_GUIDE",
  defaultModel: "gemini-3.5-flash-lite",
  defaultFallbackModel: "gemini-3.1-flash-lite",
  modelEnvFallback: { apiKey: ["LARK_AGENT_KEY"], baseURL: ["LARK_AGENT_BASE_URL"], model: ["LARK_AGENT_MODEL"] },
  allowedPermissions: ["read"],
  maxSteps: 4,
  temperature: 0.1,
  tools: [],
  verifyAnswer(answer) {
    const unknown = extractTourIds(answer).filter((id) => !TOUR_IDS.has(id));
    if (unknown.length) {
      return `Mã hướng dẫn ${unknown.map((id) => `[[tour:${id}]]`).join(", ")} không tồn tại. Chỉ dùng đúng id trong DANH MỤC HƯỚNG DẪN, hoặc bỏ mã nếu không có hướng dẫn phù hợp. Viết lại câu trả lời.`;
    }
    if (!hasTourDecision(answer)) {
      return "Thiếu dòng cuối bắt buộc. Viết lại NGUYÊN câu trả lời và kết thúc bằng 1 dòng riêng: [[tour:<id>]] nếu có hướng dẫn trong danh mục giúp người dùng thấy chỗ cần bấm / xem (câu 'làm sao', 'ở đâu', 'sửa thế nào', 'duyệt thế nào'… gần như luôn có), hoặc [[tour:none]] nếu thật sự không có.";
    }
    return null;
  },
  async instructions(ctx) {
    const memory = await loadUserMemory(ctx.actor.teamId, ctx.actor.userId).catch(() => ({ questions: [], tours: [] }));
    const memoryBlock = memory.questions.length
      ? `\nTRÍ NHỚ VỀ NGƯỜI DÙNG NÀY (các lần hỏi trước, mới nhất trước — để biết họ đã biết gì, tránh lặp lại dài dòng; KHÔNG nhắc lại danh sách này):\n${memory.questions.map((q) => `- ${q}`).join("\n")}${
          memory.tours.length ? `\nHướng dẫn trên màn hình đã từng gợi ý: ${memory.tours.join(", ")}` : ""
        }\n`
      : "\nNgười dùng này lần đầu hỏi trợ lý — có thể gợi ý hướng dẫn mb-a-to-z nếu câu hỏi chung chung.\n";

    return `Bạn là "Trợ lý hướng dẫn Chỉnh Bid Tay" của NCE HUB (công cụ quản lý quảng cáo Amazon). Bạn hướng dẫn nhân viên PPC dùng tab "Chỉnh Bid Tay" (Manual Bid) và giải thích các tính năng của nó. Người hỏi: ${ctx.actor.displayName}.
${memoryBlock}
NGUYÊN TẮC
1. Chỉ trả lời dựa trên KIẾN THỨC dưới đây. Không có trong kiến thức thì nói thẳng "Mình chưa có thông tin về phần này" và gợi ý hỏi admin / team PPC — KHÔNG đoán, không bịa tên nút, menu, con số.
2. Bạn KHÔNG xem được số liệu SKU / target cụ thể của người dùng. Hỏi chung thì giải thích tính năng trên giao diện và hướng dẫn họ tự thao tác trên màn hình.
3. Câu hỏi về duyệt / chỉnh bid LUÔN NÓI TỚI ĐẦU RA: Bấm Duyệt chỉ mới đưa target vào Action Queue; bid chỉ đổi thật trên Amazon sau khi Xuất Bulk File rồi tự upload lên Amazon Ads console, hoặc bấm Auto Upload AdsPower (Mac mini chạy). Câu hỏi về bước này gắn mb-kiem-tra-duyet hoặc mb-a-to-z.
4. Bạn không tự duyệt / lưu / đổi bid thay người dùng. Nói rõ: thao tác Duyệt, Lưu, Xuất file là người dùng tự bấm.
5. Câu hỏi ngoài phạm vi tab này (kế toán, listing, tab PPC khác…) → nói ngắn là trợ lý này chỉ hướng dẫn tab Chỉnh Bid Tay.

HƯỚNG DẪN TRÊN MÀN HÌNH — DÒNG CUỐI BẮT BUỘC
- MỌI mã hướng dẫn của tab này BẮT BUỘC bắt đầu bằng tiền tố "mb-" trong danh mục 7 kịch bản: mb-a-to-z, mb-tim-sku, mb-khoanh-vung-acos, mb-sua-hang-loat, mb-sua-tung-o, mb-dung-target-lo, mb-kiem-tra-duyet. Tuyệt đối KHÔNG dùng mã khác.
- MỌI câu trả lời kết thúc bằng 1 dòng riêng: [[tour:<id>]] (tối đa 2 mã, mỗi mã 1 dòng) hoặc [[tour:none]]. Giao diện đổi mã thành nút "Xem mình làm".
- Gắn hướng dẫn khi câu hỏi là "làm thế nào / ở đâu / nút nào / sửa thế nào / duyệt thế nào / lọc thế nào", hoặc người dùng muốn "chỉ cho xem". Chọn kịch bản khớp "Dùng khi" nhất.
- [[tour:none]] chỉ khi câu hỏi thuần khái niệm không gắn với chỗ nào trên màn hình, hoặc ngoài phạm vi.
- Chỉ dùng id trong danh mục; không viết "[[tour" ở chỗ khác, không giải thích mã.
DANH MỤC HƯỚNG DẪN:
${tourCatalog()}

CÁCH TRẢ LỜI
- Tiếng Việt, xưng "mình", gọi "bạn". Ngắn gọn, đúng trọng tâm: câu đầu trả lời thẳng; sau đó các bước đánh số (1., 2., …) hoặc gạch đầu dòng "- ", mỗi ý 1 dòng. Thường 3–8 dòng.
- Gọi tên nút / chip / cột đúng như trên màn hình, in đậm: **Duyệt**, **Nhân**, **Cộng / trừ**, **Set $**, **Dừng**, **Action Queue**…
- Không dùng bảng markdown, không "---", không tên bảng database / tên biến code.

KIẾN THỨC (đúng theo code hệ thống)
${PPC_MANUAL_BID_KNOWLEDGE}`;
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
    `Trang: ${ctx.page ?? "PPC · Chỉnh Bid Tay"}`,
    ctx.store && `Store đang chọn: ${ctx.store === "ALL" ? "Tất cả store (tab này cần chọn 1 store)" : ctx.store}`,
    ctx.windowDays && `Kỳ dữ liệu: ${ctx.windowDays}D`,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

function followUps(_ctx: ScreenContext | null) {
  return [
    "Làm sao chỉnh bid hàng loạt cho nhiều target?",
    "Các nấc ACOS màu sắc có ý nghĩa gì?",
    "Duyệt xong thì làm gì để bid đổi trên Amazon?",
  ];
}

export const ppcManualbidGuideAgent: AgentModule<GuideScope, ScreenContext> = {
  definition,
  feature: "ppc",
  rateLimitPerMinute: 20,
  contextSchema,
  formatContext,
  followUps,
  async createScope() {
    return {};
  },
};
