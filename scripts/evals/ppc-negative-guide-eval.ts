// Chạy thử trợ lý hướng dẫn Negative Keyword với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/ppc-negative-guide-eval.ts [model]
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
    q: ["Quy trình phủ định search term từ đầu đến cuối thế nào?"],
    tours: ["neg-a-to-z"],
    mustInclude: [/Orders = 0|Clicks|lãng phí|Auto Upload|Xuất/i],
  },
  {
    q: ["Làm sao cắt lỗ các search term tốn tiền?"],
    tours: ["neg-a-to-z"],
    mustInclude: [/Orders = 0|Clicks|tiết kiệm/i],
  },
  {
    q: ["Cách đổi ngưỡng lọc clicks ở đâu?"],
    tours: ["neg-chinh-nguong"],
    mustInclude: [/Clicks|20|toán tử/i],
  },
  {
    q: ["Tính năng ẩn từ khóa đã phủ định hoạt động ra sao?"],
    tours: ["neg-chinh-nguong"],
    mustInclude: [/Negative Hub|trùng/i],
  },
  {
    q: ["Phủ định có ảnh hưởng đến các campaign khác không?"],
    tours: ["neg-vi-sao-an-toan"],
    mustInclude: [/Source Campaign|Negative Exact|an toàn/i],
  },
  {
    q: ["Vì sao nói cơ chế phủ định ở đây an toàn?"],
    tours: ["neg-vi-sao-an-toan"],
    mustInclude: [/Source Campaign|Negative Exact|chiến dịch nguồn/i],
  },
  {
    q: ["Cách phủ định list từ khóa từ Google Sheet cho cả ASIN thế nào?"],
    tours: ["neg-negative-list"],
    mustInclude: [/Negative List|ASIN|Negative Phrase/i],
  },
  {
    q: ["Vì sao chiến dịch SD lại bị khóa không cho phủ định?"],
    tours: ["neg-negative-list"],
    mustInclude: [/Sponsored Display|SD|không hỗ trợ/i],
  },
  {
    q: ["Xuất file Bulksheet xong có cần làm gì tiếp không?"],
    tours: ["neg-xac-nhan-lo"],
    mustInclude: [/Đã upload|Lô chờ|Seller Central/i],
  },
  {
    q: ["Nút 'Đã upload' trong lô chờ xác nhận có tác dụng gì?"],
    tours: ["neg-xac-nhan-lo"],
    mustInclude: [/Negative Hub|lưu vết|xác nhận/i],
  },
  {
    q: ["Negative Hub là gì?"],
    tours: ["neg-theo-doi-hub"],
    mustInclude: [/lưu trữ|lịch sử|đã chặn/i],
  },
  {
    q: ["Xoá lô trong Negative Hub có gỡ từ khóa trên Amazon không?"],
    tours: ["neg-theo-doi-hub"],
    mustInclude: [/KHÔNG|chỉ xoá lưu vết|Seller Central/i],
  },
  {
    q: ["Chào bạn, hôm nay thế nào?"],
    tours: ["none"],
    mustInclude: [/Negative|chào|giúp gì/i],
  },
];

async function run() {
  const agentModule = getAgentModule("ppc-negative-guide");
  if (!agentModule) {
    console.error("Chưa đăng ký agent ppc-negative-guide trong registry");
    process.exit(1);
  }

  const cases = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;
  console.log(`Chạy ${cases.length} ca test với model ${process.env.AGENT_PPC_GUIDE_MODEL || "mặc định"}...\n`);

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
        context: { page: "PPC · Negative Keyword", store: "HSOSTORE", windowDays: 30 },
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
