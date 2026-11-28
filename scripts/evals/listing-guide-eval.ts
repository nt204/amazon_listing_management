// Chạy thử trợ lý hướng dẫn Listing (Trello Kanban & Listing) với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/listing-guide-eval.ts [model]
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
  allowedFeatures: ["trello", "listing"],
};

interface Case {
  q: string[];
  tours?: string[];
  mustInclude?: RegExp[];
  mustNot?: RegExp[];
}

const ONLY = process.argv[3] ? new RegExp(process.argv[3], "i") : null;

const ALL_CASES: Case[] = [
  {
    q: ["Quy trình tạo listing từ đầu tới cuối thế nào?"],
    tours: ["lst-a-to-z"],
    mustInclude: [/Brand|Thương hiệu/i, /Template/i, /Tạo Listing/i, /Excel/i],
  },
  {
    q: ["Làm sao để xuất file listing cho sản phẩm trên Trello?"],
    tours: ["lst-a-to-z"],
    mustInclude: [/Cột đích|Tải Excel|Excel/i],
  },
  {
    q: ["Sao template báo Cần cấu hình và không chạy được?"],
    tours: ["lst-chon-template"],
    mustInclude: [/bắt buộc|Sẵn sàng/i, /\+/],
  },
  {
    q: ["Làm thế nào để thêm hoặc chỉnh sửa template listing?"],
    tours: ["lst-chon-template"],
    mustInclude: [/Template/i, /trường bắt buộc|Sẵn sàng/i],
  },
  {
    q: ["Muốn chạy tạo listing cho nhiều thẻ cùng lúc thì làm sao?"],
    tours: ["lst-chay-batch"],
    mustInclude: [/Batch|chọn|tick/i],
  },
  {
    q: ["Batch listing chạy được tối đa mấy thẻ một lúc?"],
    tours: ["lst-chay-batch"],
    mustInclude: [/2 thẻ|song song/i],
  },
  {
    q: ["Tải file Excel kết quả ở đâu?"],
    tours: ["lst-tai-excel"],
    mustInclude: [/Cột đích|Tải Excel|ZIP|Lịch Sử Batch/i],
  },
  {
    q: ["Làm sao tải file ZIP của cả đợt chạy batch?"],
    tours: ["lst-tai-excel"],
    mustInclude: [/Lịch Sử Batch|ZIP/i],
  },
  {
    q: ["Cách đổi Board Trello hoặc cài lại 2 cột đầu và đích?"],
    tours: ["lst-cau-hinh-trello"],
    mustInclude: [/Cấu hình Trello|Board|Cột đầu|Cột đích/i],
  },
  {
    q: ["Tạo listing giúp mình thẻ đầu tiên luôn đi"],
    mustInclude: [/không (thể|tự)|bạn (tự|cần) bấm|tự bấm/i],
    mustNot: [/đã tạo xong|đã chạy/i],
  },
  {
    q: ["Xin chào bạn"],
    tours: ["none"],
  },
];

async function run() {
  const agentModule = getAgentModule("listing-guide");
  if (!agentModule) {
    console.error("Chưa đăng ký agent listing-guide trong registry");
    process.exit(1);
  }

  const cases = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;
  console.log(`\nChạy ${cases.length}/${ALL_CASES.length} case eval cho listing-guide (model: ${process.env.AGENT_PPC_GUIDE_MODEL || "mặc định"})\n`);

  let passed = 0;
  let failed = 0;
  const sessions: string[] = [];

  for (const [idx, c] of cases.entries()) {
    const sessionId = `eval-${randomUUID()}`;
    sessions.push(sessionId);
    let last = { answer: "", ms: 0 };

    for (const q of c.q) {
      const t = Date.now();
      const r = await executeAgentTurn({
        agentModule,
        actor,
        message: q,
        sessionId,
        emit: () => {},
        context: { page: "Bảng Trello Kanban · Tool Listing" },
      });
      last = { answer: r.answer, ms: Date.now() - t };
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
      passed++;
      console.log(`✓ [${idx + 1}/${cases.length}] ${c.q[0]}`);
      console.log(`   Tour: ${tours.join(", ") || "none"} (${last.ms}ms)`);
    } else {
      failed++;
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
  } catch (err) {
    console.warn("Không thể xoá test runs:", err);
  }

  console.log(`\nKết quả: ${passed} pass / ${failed} fail (tổng ${cases.length})\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run();
