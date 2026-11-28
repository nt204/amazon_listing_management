// Chạy thử trợ lý hướng dẫn Chỉnh Bid Tay với bộ câu hỏi mẫu.
// Chạy bằng tài khoản GIẢ (eval-guide-bot) rồi xoá/ẩn lượt chạy.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/evals/ppc-manualbid-guide-eval.ts [model]
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
    q: ["Chỉnh bid hàng loạt cho nhiều target thế nào?"],
    tours: ["mb-sua-hang-loat"],
    mustInclude: [/Nhân|Cộng \/ trừ|Set \$|Dừng/i],
  },
  {
    q: ["Làm sao giảm bid 10% cho các target được chọn?"],
    tours: ["mb-sua-hang-loat"],
    mustInclude: [/Nhân/i, /90%|0\.9/i],
  },
  {
    q: ["Nấc 0 đơn màu tím nghĩa là gì?"],
    tours: ["mb-khoanh-vung-acos"],
    mustInclude: [/7|chưa (có |ra )?đơn|chảy máu/i],
  },
  {
    q: ["Cách gõ sửa bid trực tiếp trên ô như thế nào?"],
    tours: ["mb-sua-tung-o"],
    mustInclude: [/Enter|Tab|nhấp đúp/i],
  },
  {
    q: ["Bấm Duyệt rồi thì bid trên Amazon đã thay đổi chưa?"],
    tours: ["mb-kiem-tra-duyet", "mb-a-to-z"],
    mustInclude: [/chưa/i, /Action Queue/i, /Bulk|Auto Upload/i],
    mustNot: [/đã thay đổi ngay trên Amazon/i],
  },
  {
    q: ["Làm sao xem lại các target mình vừa sửa bid của SKU này?"],
    tours: ["mb-khoanh-vung-acos", "mb-kiem-tra-duyet"],
    mustInclude: [/Đã sửa/i],
  },
  {
    q: ["Mở xem danh sách target của 1 SKU ở đâu?"],
    tours: ["mb-tim-sku", "mb-a-to-z", "mb-khoanh-vung-acos"],
    mustInclude: [/(?:bấm|click).*(?:dòng|bảng).*SKU/i],
  },
  {
    q: ["Xuất file bulk ở đâu và tải về rồi làm gì?"],
    tours: ["mb-kiem-tra-duyet", "mb-a-to-z"],
    mustInclude: [/Action Queue/i, /upload.*Amazon|Amazon.*upload/i],
  },
  {
    q: ["Auto Upload AdsPower có an toàn cho SKU đang chạy không?"],
    tours: ["mb-kiem-tra-duyet"],
    mustInclude: [/cảnh báo|xác nhận|chưa cắn tiền/i],
  },
  {
    q: ["Lỡ duyệt nhầm target thì huỷ hoặc xoá thế nào?"],
    tours: ["mb-kiem-tra-duyet"],
    mustInclude: [/Huỷ|Xoá|xóa/i],
  },
  {
    q: ["Làm sao dừng các target đang chảy máu tiền?"],
    tours: ["mb-dung-target-lo"],
    mustInclude: [/Dừng|Pause/i],
  },
  {
    q: ["Quy trình chỉnh bid tay từ đầu đến cuối thế nào?"],
    tours: ["mb-a-to-z"],
    mustInclude: [/SKU/i, /Target|lưới/i, /Duyệt/i, /(?:Action Queue|hàng đợi)/i],
  },
  {
    q: ["Lợi nhuận tháng này của store HSOSTORE là bao nhiêu?"],
    mustNot: [/\$\d/],
    mustInclude: [/Chỉnh Bid Tay|chỉ hướng dẫn/i],
  },
  {
    q: ["Duyệt xong rồi thì làm gì tiếp?"],
    tours: ["mb-kiem-tra-duyet"],
    mustInclude: [/Action Queue/i, /Bulk|Auto Upload/i],
  },
];

const CASES = ONLY ? ALL_CASES.filter((c) => c.q.some((q) => ONLY.test(q))) : ALL_CASES;

async function main() {
  const agentModule = getAgentModule("ppc-manualbid-guide");
  if (!agentModule) {
    console.error("Không tìm thấy agent ppc-manualbid-guide");
    process.exit(1);
  }

  let pass = 0;
  const sessions: string[] = [];

  for (const c of CASES) {
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
        emit: () => { },
        context: { page: "PPC · Chỉnh Bid Tay", store: "HSOSTORE", windowDays: 30 },
      });
      last = { answer: r.answer, toolsUsed: r.toolsUsed, model: r.model, ms: Date.now() - t };
    }

    const tours = extractTourIds(last.answer);
    const problems: string[] = [];

    if (c.tours && !tours.some((id) => c.tours!.includes(id))) {
      problems.push(`tour ${JSON.stringify(tours)} ≠ ${c.tours.join("|")}`);
    }
    for (const re of c.mustInclude ?? []) {
      if (!re.test(last.answer)) problems.push(`thiếu ${re}`);
    }
    for (const re of c.mustNot ?? []) {
      if (re.test(last.answer)) problems.push(`có ${re}`);
    }

    if (!problems.length) pass++;
    console.log(
      `\n${problems.length ? "✗" : "✓"} ${c.q.join(" → ")}  [${last.model}, ${last.ms}ms]`,
    );
    if (problems.length) console.log("   VẤN ĐỀ:", problems.join("; "));
    console.log(last.answer.split("\n").map((l) => "   | " + l).join("\n"));
  }

  console.log(`\nKẾT QUẢ: ${pass}/${CASES.length}`);
  const sql = await getDatabaseClient();
  await sql`UPDATE agent_runs SET cleared_at = NOW() WHERE actor_id = 'eval-guide-bot' AND session_id = ANY(${sessions})`;
  process.exit(0);
}

void main();
