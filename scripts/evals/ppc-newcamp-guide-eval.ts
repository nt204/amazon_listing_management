// Chạy thử trợ lý hướng dẫn Lên Camp SKU Mới với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/ppc-newcamp-guide-eval.ts [model]
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
    q: ["Quy trình lên camp SKU mới từ đầu tới cuối thế nào?"],
    tours: ["newcamp-a-to-z"],
    mustInclude: [/5 bước|Bảng Mã|SP03|TẠO FILE|Upload/i],
  },
  {
    q: ["5 bước lên camp SKU mới gồm những gì?"],
    tours: ["newcamp-a-to-z"],
    mustInclude: [/Bước 1|Bước 2|Bước 3|Bước 4|Bước 5/i],
  },
  {
    q: ["Chọn loại chạy nào cho SKU mới?"],
    tours: ["newcamp-loai-chay"],
    mustInclude: [/SP03|SB01|SB05|SP04|FL Asin/i],
  },
  {
    q: ["Chiến dịch SP04 Auto và FL Asin là gì?"],
    tours: ["newcamp-loai-chay"],
    mustInclude: [/tự động|đối thủ|ASIN/i],
  },
  {
    q: ["3 cách nạp file keyword hoạt động ra sao?"],
    tours: ["newcamp-file-keyword"],
    mustInclude: [/Upload|Từ kho|Tạo mới|0\.02/i],
  },
  {
    q: ["Bốn ô định danh lưu kho là gì và bid tối thiểu bao nhiêu?"],
    tours: ["newcamp-file-keyword"],
    mustInclude: [/Người lên camp|Ngách|Phôi|Bộ keyword|0\.02/i],
  },
  {
    q: ["Lỗi thiếu thông tin Sponsored Brands sửa thế nào?"],
    tours: ["newcamp-thong-tin-sb"],
    mustInclude: [/BẢNG MÃ|Brand Entity ID|Logo|Video|Điền chung/i],
  },
  {
    q: ["Bị báo lỗi còn thiếu không tạo được file thì làm sao?"],
    tours: ["newcamp-sua-loi"],
    mustInclude: [/Đi tới|Đuôi tên|trùng/i],
  },
  {
    q: ["Nút TẠO FILE tải về file gì?"],
    tours: ["newcamp-dau-ra"],
    mustInclude: [/zip|Bulksheet|Excel|Seller Central/i],
  },
  {
    q: ["Upload thẳng lên Amazon qua AdsPower thế nào?"],
    tours: ["newcamp-dau-ra"],
    mustInclude: [/Mac mini|AdsPower|Đang chạy|KHÔNG CÓ NÚT HOÀN TÁC|Enabled/i],
  },
  {
    q: ["Upload camp xong có nút hoàn tác không?"],
    tours: ["newcamp-dau-ra"],
    mustInclude: [/KHÔNG|hoàn tác|Đang chạy|Seller Central/i],
  },
  {
    q: ["Chào bạn, hôm nay thế nào?"],
    tours: ["none"],
    mustInclude: [/SKU Mới|chào|giúp gì/i],
  },
];

async function run() {
  const agentModule = getAgentModule("ppc-newcamp-guide");
  if (!agentModule) {
    console.error("Chưa đăng ký agent ppc-newcamp-guide trong registry");
    process.exit(1);
  }

  const cases = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;
  console.log(`Chạy ${cases.length} ca test SKU Mới với model ${process.env.AGENT_PPC_GUIDE_MODEL || "mặc định"}...\n`);

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
        context: { page: "PPC · Lên Camp SKU Mới", store: "HSOSTORE" },
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
