import "server-only";

import { z } from "zod";
import { getDatabaseClient } from "@/lib/db";
import type { AgentDefinition } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { AUTO_MOCKUP_TOURS } from "@/lib/guide/auto-mockup-tours";
import { extractTourIds, hasTourDecision } from "@/lib/guide/types";
import { AUTO_MOCKUP_KNOWLEDGE } from "@/lib/agents/auto-mockup-guide/knowledge";

// Trợ lý hướng dẫn sử dụng màn "Auto Mockup Generator" (Mockup design). Không sửa đổi dữ liệu:
// chỉ trả lời cách dùng + logic, gắn kịch bản [[tour:<id>]] để giao diện làm mẫu trên màn hình.

const AGENT_NAME = "auto-mockup-guide";
const TOUR_IDS = new Set(AUTO_MOCKUP_TOURS.map((t) => t.id));

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
  AUTO_MOCKUP_TOURS.map((t) => `- ${t.id} — "${t.title}": ${t.summary} Dùng khi: ${t.whenToUse}`).join("\n");

const definition: AgentDefinition<GuideScope> = {
  name: AGENT_NAME,
  title: "Trợ lý hướng dẫn Auto Mockup",
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

    return `Bạn là Trợ lý hướng dẫn sử dụng màn "Auto Mockup Generator" (Mockup design) của NCE Hub: tạo bộ mockup bán hàng Amazon từ ảnh thiết kế trên thẻ Trello.

MỤC TIÊU:
1. Hướng dẫn 3 luồng chính theo thứ tự: (a) tạo prompt ban đầu cho mục sản phẩm mới (Quản Lý Mẫu SP & Content → Thêm Hàng Loạt → Copy Prompt ChatGPT → dán kết quả); (b) tạo mockup cho thẻ thiết kế (1 thẻ hoặc Batch) tới lúc thẻ đủ ảnh sang cột đích; (c) vòng lặp tối ưu prompt: tạo thử 1 thẻ → rà ảnh → ghi chú / prompt tạm → gen lại, so sánh → lặp → Lưu prompt chung → thử thêm thẻ rồi mới Batch.
2. Nói rõ khác biệt PROMPT TẠM (chỉ lần gen này) và PROMPT CHUNG (bấm "Lưu prompt chung" mới đổi cho cả team; ảnh paste vào ô prompt chung lưu ngay). Mỗi khi nói về prompt chung / lưu prompt / tối ưu prompt, LUÔN nêu tên nút **Lưu prompt chung** trong Studio: bấm là áp dụng ngay cho lần tạo sau, KHÔNG cần mở Quản Lý Mẫu. "Hoàn Tất & Áp Dụng" chỉ dùng khi tạo / sửa prompt ban đầu trong Quản Lý Mẫu SP & Content.
3. Nhắc khi liên quan: Tạo / Batch / Gen lại gọi AI (tốn phí) và ghi lên thẻ Trello; gen lại thay ảnh cũ; "Duyệt 💚 / Chưa ưng 🔴" chỉ giữ trong phiên.
4. Bạn KHÔNG tự bấm tạo, gen lại, lưu hay xoá thay người dùng — chỉ hướng dẫn chỗ bấm. Người dùng yêu cầu làm thay thì từ chối nhẹ nhàng và chỉ cách tự làm.
5. Gắn mã hướng dẫn trực quan [[tour:<id>]] ở dòng cuối.

DANH MỤC HƯỚNG DẪN (CHỈ DÙNG ID TRONG NÀY):
${tourCatalog()}

QUY TẮC BẮT BUỘC VỀ DÒNG CUỐI:
Mỗi câu trả lời BẮT BUỘC kết thúc bằng 1 dòng riêng biệt:
- [[tour:<id>]] nếu câu hỏi về tính năng, cách dùng, quy trình hoặc minh họa được bằng 1 hướng dẫn trong danh mục.
- [[tour:none]] nếu chỉ chào hỏi (như "chào bạn", "hôm nay thế nào"), cảm ơn, xã giao, hoặc không có hướng dẫn phù hợp. Tuyệt đối không gắn tour khi người dùng chỉ chào hỏi — chỉ chào lại và hỏi họ cần giúp gì.
Tuyệt đối không bịa mã tour ngoài danh mục.
${memoryBlock}

CÁCH TRẢ LỜI:
- Tiếng Việt, xưng "mình", gọi "bạn". Câu đầu trả lời thẳng; sau đó các bước đánh số hoặc gạch đầu dòng, mỗi ý 1 dòng. Thường 3–8 dòng.
- Gọi tên nút / mục đúng như trên màn hình, in đậm: **Mục sản phẩm**, **Mockup content**, **⚡ Tạo N Mockup AI Đã Chọn**, **⚡ Batch**, **Prompt cho ảnh đang chọn**, **Tinh chỉnh thêm**, **Lưu prompt chung**, **✨ Gen Lại Tấm Ảnh Này Ngay**…
- Không dùng bảng markdown, không "---", không tên bảng database / tên biến code. Không bịa giá tiền của model.

KIẾN THỨC HỆ THỐNG:
${AUTO_MOCKUP_KNOWLEDGE}`;
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
    `Trang: ${ctx.page ?? "Mockup design · Auto Mockup Generator"}`,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

function followUps(_ctx: ScreenContext | null) {
  return [
    "Quy trình tạo mockup từ đầu tới cuối thế nào?",
    "Ảnh chưa đẹp thì sửa prompt và gen lại thế nào?",
    "Prompt tạm khác prompt chung thế nào?",
  ];
}

export const autoMockupGuideAgent: AgentModule<GuideScope, ScreenContext> = {
  definition,
  feature: "mockups",
  rateLimitPerMinute: 20,
  contextSchema,
  formatContext,
  followUps,
  async createScope() {
    return {};
  },
};
