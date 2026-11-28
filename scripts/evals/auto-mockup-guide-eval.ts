// Chạy thử trợ lý hướng dẫn Auto Mockup với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/auto-mockup-guide-eval.ts [model]
import { randomUUID } from "node:crypto";
import { executeAgentTurn } from "@/lib/agents/run";
import { getAgentModule } from "@/lib/agents/registry";
import { getDatabaseClient } from "@/lib/db";
import { extractTourIds } from "@/lib/guide/types";
import type { RequestActor } from "@/lib/auth";

if (process.argv[2]) process.env.AGENT_PPC_GUIDE_MODEL = process.argv[2];

const actor: RequestActor = {
  teamId: "default",
  userId: "eval-guide-bot",
  displayName: "Eval Bot",
  role: "editor",
  ruleProfile: "",
  allowedFeatures: ["mockups"],
};

interface Case {
  q: string[];
  tours?: string[];
  mustInclude?: RegExp[];
  mustNot?: RegExp[];
}

const ONLY = process.argv[3] ? new RegExp(process.argv[3], "i") : null;

const ALL_CASES: Case[] = [
  { q: ["Sản phẩm mới chưa có prompt thì tạo prompt ban đầu thế nào?"], tours: ["mk-tao-prompt"], mustInclude: [/ChatGPT/i, /Thêm Hàng Loạt|Quản Lý Mẫu/i] },
  { q: ["Quy trình tối ưu prompt cho đến khi ảnh đẹp là sao?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/thử|1 thẻ/i, /Lưu prompt chung/i] },
  { q: ["Tối ưu prompt xong thì lưu lại thế nào để lần sau dùng?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/Lưu prompt chung/i], mustNot: [/phải (mở|vào) Quản Lý Mẫu/i] },
  { q: ["Quy trình tạo mockup từ đầu tới cuối thế nào?"], tours: ["mk-a-to-z"], mustInclude: [/Mục sản phẩm|content/i, /Tạo|Batch/i] },
  { q: ["Muốn tạo mockup cho nhiều thẻ cùng lúc thì làm sao?"], tours: ["mk-a-to-z"], mustInclude: [/Batch/i] },
  { q: ["Tạo xong thì thẻ nằm ở đâu?"], tours: ["mk-a-to-z"], mustInclude: [/cột đích|7 ảnh/i] },
  { q: ["Ảnh mockup chưa đẹp thì sửa prompt và gen lại thế nào?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/Gen Lại|gen lại/i, /prompt/i] },
  { q: ["Thêm ảnh tham khảo khi gen lại được không?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/paste|dán|Ctrl|⌘/i] },
  { q: ["Prompt tạm khác prompt chung thế nào?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/Lưu prompt chung/i, /team/i] },
  { q: ["Sửa prompt có ảnh hưởng người khác trong team không?"], tours: ["mk-toi-uu-prompt"], mustInclude: [/Lưu prompt chung/i] },
  { q: ["Sao mình không tick thêm content được nữa?"], tours: ["mk-chon-content"], mustInclude: [/7|6/] },
  { q: ["Nên dùng model nào, chất lượng low hay high?"], tours: ["mk-model-chat-luong"], mustInclude: [/low|high/i] },
  { q: ["Nút Duyệt trong Studio có lưu lên Trello không?"], tours: ["mk-duyet-tai-anh"], mustInclude: [/phiên|tải lại|không lưu/i] },
  { q: ["Gen lại giúp mình ảnh số 3 của thẻ đầu tiên luôn đi"], mustInclude: [/không (thể|tự)|bạn (tự|cần) bấm|tự bấm/i], mustNot: [/đã gen lại|đã tạo xong/i] },
  { q: ["Chào bạn"], tours: ["none"] },
];

async function run() {
  const agentModule = getAgentModule("auto-mockup-guide");
  if (!agentModule) {
    console.error("Chưa đăng ký agent auto-mockup-guide trong registry");
    process.exit(1);
  }

  const cases = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;
  console.log(`Chạy ${cases.length} ca test Auto Mockup với model ${process.env.AGENT_PPC_GUIDE_MODEL || "mặc định"}...\n`);

  let pass = 0;
  let fail = 0;
  const sessions: string[] = [];

  for (const [idx, c] of cases.entries()) {
    const sessionId = `eval-${randomUUID()}`;
    sessions.push(sessionId);
    let last = { answer: "", toolsUsed: [] as string[], model: "", ms: 0 };

    for (const q of c.q) {
      const t = Date.now();
      const r = await executeAgentTurn({
        agentModule,
        actor,
        message: q,
        sessionId,
        emit: () => {},
        context: { page: "Mockup design · Auto Mockup Generator" },
      });
      last = { answer: r.answer, toolsUsed: r.toolsUsed, model: r.model, ms: Date.now() - t };
    }

    const tours = extractTourIds(last.answer);
    const problems: string[] = [];

    const expectedNone = c.tours?.includes("none");
    const gotNone = tours.length === 0 && /\[\[tour:none\]\]/i.test(last.answer);

    if (c.tours) {
      if (expectedNone) {
        if (!gotNone) problems.push(`mong đợi tour:none nhưng thực tế: ${JSON.stringify(tours)}`);
      } else if (!tours.some((id) => c.tours!.includes(id))) {
        problems.push(`tour ${JSON.stringify(tours)} ≠ ${c.tours.join("|")}`);
      }
    }
    for (const re of c.mustInclude ?? []) {
      if (!re.test(last.answer)) problems.push(`thiếu ${re}`);
    }
    for (const re of c.mustNot ?? []) {
      if (re.test(last.answer)) problems.push(`có ${re}`);
    }

    const ok = problems.length === 0;
    if (ok) {
      pass++;
      console.log(`✓ [${idx + 1}/${cases.length}] ${c.q[0]}`);
      console.log(`   Tour: ${tours.join(", ") || "none"} (${last.ms}ms)`);
    } else {
      fail++;
      console.log(`✗ [${idx + 1}/${cases.length}] ${c.q[0]}`);
      console.log(`   Lỗi: ${problems.join(", ")}`);
      console.log(`   Trả lời: ${last.answer.slice(0, 200)}...\n`);
    }
  }

  // Dọn dẹp bản ghi eval
  try {
    const sql = await getDatabaseClient();
    if (sessions.length) {
      await sql`DELETE FROM agent_runs WHERE session_id = ANY(${sessions})`;
    }
    await sql`DELETE FROM agent_runs WHERE actor_id = ${actor.userId}`;
  } catch {
    // ignore
  }

  console.log(`\n========================================`);
  console.log(`KẾT QUẢ: ${pass}/${cases.length} ĐẠT (${Math.round((pass / cases.length) * 100)}%)`);
  console.log(`========================================\n`);

  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
