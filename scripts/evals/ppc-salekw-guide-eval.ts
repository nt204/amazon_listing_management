// Chạy thử trợ lý hướng dẫn Lên Camp Sale KW với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/ppc-salekw-guide-eval.ts [model]
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
  allowedFeatures: ["ppc"],
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
    q: ["Quy trình lên camp sale kw từ đầu tới cuối thế nào?"],
    tours: ["sale-a-to-z"],
    mustInclude: [/Orders|SKU|Match Type|Auto Upload|Xuất/i],
  },
  {
    q: ["Làm sao tách search term ra đơn thành camp riêng?"],
    tours: ["sale-a-to-z"],
    mustInclude: [/Manual|SKU|tiềm năng/i],
  },
  {
    q: ["Cách lọc search term tiềm năng ở đâu?"],
    tours: ["sale-loc-tiem-nang"],
    mustInclude: [/Orders|ngưỡng|Ẩn ST/i],
  },
  {
    q: ["Tính năng ẩn ST đã lên Camp hoạt động thế nào?"],
    tours: ["sale-loc-tiem-nang"],
    mustInclude: [/Registry|trùng/i],
  },
  {
    q: ["Cấu hình tên người dùng và budget cho camp mới ở đâu?"],
    tours: ["sale-cau-hinh-camp"],
    mustInclude: [/Người dùng|Budget|SP03/i],
  },
  {
    q: ["Giá bid của camp mới được tính thế nào?"],
    tours: ["sale-tinh-bid"],
    mustInclude: [/CPC TB|trung bình|Bid nạp/i],
  },
  {
    q: ["Vì sao giá bid lại lấy theo CPC trung bình của term?"],
    tours: ["sale-tinh-bid"],
    mustInclude: [/CPC|thực tế|vị trí/i],
  },
  {
    q: ["Phủ định ở camp cũ để làm gì?"],
    tours: ["sale-phu-dinh-camp-cu"],
    mustInclude: [/Negative Exact|cạnh tranh|đấu thầu/i],
  },
  {
    q: ["Lên camp Sponsored Brands SB01 SB05 cần điều kiện gì?"],
    tours: ["sale-sb-setup"],
    mustInclude: [/BẢNG MÃ|Brand Entity ID|Logo|Video/i],
  },
  {
    q: ["Quản trị Registry là gì?"],
    tours: ["sale-theo-doi-registry"],
    mustInclude: [/lưu vết|lịch sử|chiến dịch/i],
  },
  {
    q: ["Xóa mục trong Registry có xóa camp trên Amazon không?"],
    tours: ["sale-theo-doi-registry"],
    mustInclude: [/KHÔNG|chỉ xóa lưu vết|Seller Central/i],
  },
  {
    q: ["Chào bạn, hôm nay thế nào?"],
    tours: ["none"],
    mustInclude: [/Sale KW|chào|giúp gì/i],
  },
];

async function run() {
  const agentModule = getAgentModule("ppc-salekw-guide");
  if (!agentModule) {
    console.error("Chưa đăng ký agent ppc-salekw-guide trong registry");
    process.exit(1);
  }

  const cases = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;
  console.log(`Chạy ${cases.length} ca test Sale KW với model ${process.env.AGENT_PPC_GUIDE_MODEL || "mặc định"}...\n`);

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
        context: { page: "PPC · Lên Camp Sale KW", store: "HSOSTORE", windowDays: 30 },
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
