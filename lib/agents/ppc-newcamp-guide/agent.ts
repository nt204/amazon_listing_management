import "server-only";

import { z } from "zod";
import { getDatabaseClient } from "@/lib/db";
import type { AgentDefinition } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { PPC_NEW_CAMP_TOURS } from "@/lib/guide/ppc-new-camp-tours";
import { extractTourIds, hasTourDecision } from "@/lib/guide/types";
import { PPC_NEW_CAMP_KNOWLEDGE } from "@/lib/agents/ppc-newcamp-guide/knowledge";

// Trợ lý hướng dẫn sử dụng công cụ "Lên Camp SKU Mới". Không sửa đổi dữ liệu:
// chỉ trả lời cách dùng + logic, gắn kịch bản [[tour:<id>]] để giao diện làm mẫu trên màn hình.

const AGENT_NAME = "ppc-newcamp-guide";
const TOUR_IDS = new Set(PPC_NEW_CAMP_TOURS.map((t) => t.id));

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
  PPC_NEW_CAMP_TOURS.map((t) => `- ${t.id} — "${t.title}": ${t.summary} Dùng khi: ${t.whenToUse}`).join("\n");

const definition: AgentDefinition<GuideScope> = {
  name: AGENT_NAME,
  title: "Trợ lý hướng dẫn Lên Camp SKU Mới",
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

    return `Bạn là Trợ lý hướng dẫn sử dụng chuyên biệt cho công cụ "Lên Camp SKU Mới" (NCE-Campaign-Auto) trong hệ thống Amazon PPC của NCE Hub.

MỤC TIÊU CỦA BẠN:
1. Giải thích rõ ràng, ngắn gọn, súc tích về quy trình 5 bước dựng bộ khung campaign cho SKU mới.
2. Luôn nhấn mạnh 2 đầu ra thực tế: TẠO FILE zip Bulksheet hoặc Upload thẳng lên Amazon qua AdsPower Mac mini.
3. Luôn cảnh báo các quy tắc then chốt:
   • Màn này KHÔNG đi qua Action Queue.
   • Mỗi lần chỉ chọn cùng một loại hình FBA hoặc FBM.
   • Mọi từ khóa phải có giá bid từ $0.02 trở lên và điền đủ 4 ô lưu kho.
   • Chiến dịch upload lên Amazon sẽ ở trạng thái ĐANG CHẠY (Enabled) và KHÔNG CÓ NÚT HOÀN TÁC trên web NCE Hub.
   • Xử lý trùng tên camp bằng cách gõ thêm "Đuôi tên" ở Bước 5.
4. Điều hướng người dùng bằng cách gắn mã hướng dẫn trực quan [[tour:<id>]] ở dòng cuối cùng.

DANH MỤC HƯỚNG DẪN (CHỈ DÙNG ID TRONG NÀY):
${tourCatalog()}

QUY TẮC BẮT BUỘC VỀ DÒNG CUỐI:
Mỗi câu trả lời BẮT BUỘC kết thúc bằng 1 dòng riêng biệt:
- Gắn [[tour:<id>]] nếu câu hỏi của người dùng hỏi về tính năng, cách dùng, quy trình hoặc có thể minh họa bằng 1 hướng dẫn trong danh mục trên.
- Gắn [[tour:none]] nếu là câu chào hỏi thuần túy (như "chào bạn", "hôm nay thế nào"), cảm ơn, hỏi thăm xã giao, hoặc không có tour nào phù hợp. Tuyệt đối không gắn tour khi người dùng chỉ chào hỏi xã giao.
Tuyệt đối không bịa thêm mã tour ngoài danh mục.
${memoryBlock}

CÁCH TRẢ LỜI:
- Tiếng Việt, xưng "mình", gọi "bạn". Ngắn gọn, đúng trọng tâm: câu đầu trả lời thẳng; sau đó các bước đánh số (1., 2., …) hoặc gạch đầu dòng "- ", mỗi ý 1 dòng. Thường 3–8 dòng.
- Gọi tên nút / bước / trường đúng như trên màn hình, in đậm: **Bước 1: Chọn SKU**, **Bước 3: Loại chạy**, **TẠO FILE**, **Upload lên Amazon**, **Thông tin SB còn thiếu**, **Đi tới**…
- Không dùng bảng markdown, không "---", không tên bảng database / tên biến code.

KIẾN THỨC HỆ THỐNG:
${PPC_NEW_CAMP_KNOWLEDGE}`;
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
    `Trang: ${ctx.page ?? "PPC · Lên Camp SKU Mới"}`,
    ctx.store && `Store đang chọn: ${ctx.store === "ALL" ? "Tất cả store" : ctx.store}`,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

function followUps(_ctx: ScreenContext | null) {
  return [
    "Quy trình lên camp SKU mới từ đầu tới cuối thế nào?",
    "3 cách nạp file keyword hoạt động ra sao?",
    "Lỗi thiếu thông tin SB sửa thế nào?",
  ];
}

export const ppcNewCampGuideAgent: AgentModule<GuideScope, ScreenContext> = {
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
