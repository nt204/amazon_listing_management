import "server-only";

import { z } from "zod";
import { getDatabaseClient } from "@/lib/db";
import type { AgentDefinition } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { LISTING_TOURS } from "@/lib/guide/listing-tours";
import { extractTourIds, hasTourDecision } from "@/lib/guide/types";
import { LISTING_KNOWLEDGE } from "@/lib/agents/listing-guide/knowledge";

// Trợ lý hướng dẫn sử dụng màn "Bảng Trello Kanban & Listing" (Tool Listing).
// Không sửa đổi dữ liệu: chỉ trả lời cách dùng + logic, gắn kịch bản [[tour:<id>]] để giao diện làm mẫu trên màn hình.

const AGENT_NAME = "listing-guide";
const TOUR_IDS = new Set(LISTING_TOURS.map((t) => t.id));

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
  LISTING_TOURS.map((t) => `- ${t.id} — "${t.title}": ${t.summary} Dùng khi: ${t.whenToUse}`).join("\n");

const definition: AgentDefinition<GuideScope> = {
  name: AGENT_NAME,
  title: "Trợ lý hướng dẫn Listing",
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
      return "Thiếu dòng cuối bắt buộc. Viết lại NGUYÊN câu trả lời và kết thúc bằng 1 dòng riêng: [[tour:<id>]] nếu có hướng dẫn trong danh mục giúp người dùng thấy chỗ cần bấm / xem, hoặc [[tour:none]] nếu thật sự không có.";
    }
    return null;
  },
  async instructions(ctx) {
    const memory = await loadUserMemory(ctx.actor.teamId, ctx.actor.userId).catch(() => ({ questions: [], tours: [] }));
    const memoryBlock = memory.questions.length
      ? `\nTRÍ NHỚ VỀ NGƯỜI DÙNG NÀY (các lần hỏi trước, mới nhất trước):\n${memory.questions.map((q) => `- ${q}`).join("\n")}${
          memory.tours.length ? `\nHướng dẫn họ đã được gợi ý: ${memory.tours.join(", ")}` : ""
        }\n`
      : "";

    return `Bạn là Trợ lý hướng dẫn sử dụng màn "Bảng Trello Kanban & Listing" (Tool Listing Amazon) của NCE Hub: lấy thẻ sản phẩm từ Trello, gọi AI tạo nội dung chuẩn và điền vào template file Excel, đính kèm lại lên Trello và xuất file tải về.

MỤC TIÊU:
1. Hướng dẫn các quy trình chính: (a) quy trình tạo listing từ đầu tới cuối (Chọn Model/Brand/Template → Chọn thẻ → Tạo Listing lẻ hoặc Batch → Cột đích & Tải file Excel); (b) kiểm tra và xử lý template ("Sẵn sàng" vs "Cần cấu hình"); (c) chạy hàng loạt Batch nhiều thẻ cùng lúc (tối đa 2 thẻ song song) và tải file ZIP từ Lịch Sử Batch; (d) cấu hình Board ID và các cột Trello.
2. Bạn KHÔNG tự bấm tạo listing, batch, tải file hay lưu cấu hình thay người dùng — chỉ hướng dẫn chỗ bấm. Khi người dùng yêu cầu làm thay (ví dụ: "Tạo listing giúp mình...", "Bấm tạo hộ..."), phải nói rõ bạn không tự bấm thay được và bạn (người dùng) tự bấm nút tương ứng trên màn hình.
3. Gắn mã hướng dẫn trực quan [[tour:<id>]] ở dòng cuối.

DANH MỤC HƯỚNG DẪN (CHỈ DÙNG CÁC ID NÀY):
${tourCatalog()}
${memoryBlock}
QUY TẮC BẮT BUỘC VỀ DÒNG CUỐI:
Mỗi câu trả lời BẮT BUỘC kết thúc bằng 1 dòng riêng biệt:
- [[tour:<id>]] nếu câu hỏi về tính năng, cách dùng, quy trình hoặc minh họa được bằng 1 hướng dẫn trong danh mục.
- [[tour:none]] nếu chỉ chào hỏi (như "xin chào", "chào bạn", "hello"), cảm ơn, xã giao, hoặc không có hướng dẫn phù hợp. Tuyệt đối không gắn tour khi người dùng chỉ chào hỏi — chỉ chào lại và hỏi họ cần giúp gì.
Tuyệt đối không bịa mã tour ngoài danh mục.

CÁCH TRẢ LỜI:
- Tiếng Việt, xưng "mình", gọi "bạn". Câu đầu trả lời thẳng; sau đó các bước đánh số hoặc gạch đầu dòng ngắn gọn.
- Gọi tên nút / mục đúng như trên màn hình, in đậm: **AI MODEL**, **THƯƠNG HIỆU**, **TEMPLATE**, **Tạo Listing**, **Batch Tạo Listing Cho N Thẻ**, **Cột đầu Listing**, **Cột đích Listing**, **Tải Excel**, **Lịch Sử Batch**...
- Luôn chỉ rõ kết quả cuối cùng người dùng nhận được (File Excel .xlsx hoặc File ZIP).

KIẾN THỨC HỆ THỐNG:
${LISTING_KNOWLEDGE}`;
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
    `Trang: ${ctx.page ?? "Bảng Trello Kanban · Tool Listing"}`,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

function followUps(_ctx: ScreenContext | null) {
  return [
    "Quy trình tạo listing từ đầu tới cuối thế nào?",
    "Làm sao để chạy batch tạo listing nhiều thẻ?",
    "Template cần cấu hình là gì và sửa thế nào?",
    "Tải file Excel listing ở đâu?",
  ];
}

export const listingGuideAgent: AgentModule<GuideScope, ScreenContext> = {
  definition,
  feature: "listing",
  rateLimitPerMinute: 20,
  contextSchema,
  formatContext,
  followUps,
  async createScope() {
    return {};
  },
};
