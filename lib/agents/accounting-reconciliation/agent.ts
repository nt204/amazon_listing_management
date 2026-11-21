import "server-only";

import { z } from "zod";
import type { AgentDefinition } from "@/lib/agent-core/types";
import type { AgentModule } from "@/lib/agents/types";
import { getAccountingAccess, filterAccessibleStores } from "@/lib/accounting/access";
import { getStoreLatestDates, listStores } from "@/lib/accounting/accounting-db";
import { accountingMetrics } from "@/lib/metrics/accounting/definitions";
import { accountingReconciliationTools, type AccountingRunScope } from "@/lib/agents/accounting-reconciliation/tools";

const vnToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

function metricCatalog() {
  return accountingMetrics
    .list()
    .map((m) => `- ${m.id} — ${m.label}${m.kind !== "base" ? ` = ${m.formula}` : ""} (gọi là: ${m.aliases.slice(0, 4).join(", ")})`)
    .join("\n");
}

const definition: AgentDefinition<AccountingRunScope> = {
  name: "accounting-reconciliation",
  title: "AI đối soát kế toán",
  envPrefix: "AGENT_ACCOUNTING",
  defaultModel: "claude-sonnet-4-6",
  defaultFallbackModel: "gpt-5.4-mini",
  allowedPermissions: ["read"],
  maxSteps: 8,
  temperature: 0.1,
  // Câu trả lời có số tiền / % mà lượt này chưa gọi tool nào → số lấy từ lịch sử hoặc bịa: bắt tra lại.
  verifyAnswer(answer, toolsUsed) {
    if (toolsUsed.length || !/\$\s?-?\d|-?\d[\d.,]*\s?%/.test(answer)) return null;
    return "Câu trả lời có số liệu nhưng lượt này chưa gọi tool nào. Số phải lấy từ tool trong CHÍNH lượt này (không lấy từ lịch sử). Hãy gọi tool phù hợp (vd explain_metric với đúng chỉ số / store / kỳ người hỏi muốn) rồi trả lời lại.";
  },
  tools: accountingReconciliationTools,
  async instructions(ctx) {
    const latest = await getStoreLatestDates()
      .then((m) => [...m.values()].sort().pop() ?? "")
      .catch(() => "");
    const today = vnToday();
    return `Bạn là "AI đối soát kế toán" của NCE HUB (hệ thống quản lý bán hàng Amazon FBA / FBM).
Việc của bạn: giải thích MỘT CON SỐ trên web kế toán từ đâu ra và vì sao nó như vậy — công thức, thành phần, dữ liệu gốc, dữ liệu thiếu.

Hôm nay: ${today}. Dữ liệu kế toán mới nhất: ${latest || "(không rõ)"} (không tính ngày hôm nay).
Người hỏi: ${ctx.actor.displayName}. Store được xem: ${ctx.scope.stores.map((s) => `${s.name} [team ${s.team || "-"}]`).join(", ") || "(không có)"}.
${ctx.scope.canViewPayout ? "" : "Người hỏi KHÔNG được xem Payout (tiền về).\n"}
DANH MỤC CHỈ SỐ (dùng đúng mã khi gọi tool):
${metricCatalog()}

NGUYÊN TẮC BẮT BUỘC
1. Mọi con số trong câu trả lời phải lấy từ kết quả tool. Không tự ước tính, không đoán số. Chỉ được cộng / trừ / so sánh các số tool đã trả.
2. Quy trình giải thích một con số:
   a. explain_metric → giá trị, công thức và "calculation" (từng bước tính: mỗi khoản tính thế nào, từ dữ liệu nào). LUÔN gọi khi người hỏi muốn biết số từ đâu ra / tính thế nào.
   b. Hỏi "tại sao tăng / giảm / khác kỳ trước" → compare_metric (drivers = thành phần nào gây ra, segments = store / SKU nào gây ra).
   c. Hỏi "store / SKU / ngày nào" → breakdown_metric.
   d. TRƯỚC KHI KẾT LUẬN gọi check_data_quality cho cùng phạm vi, truyền metric = chỉ số đang giải thích (chỉ chạy kiểm tra liên quan).
   e. Cần chứng minh tới dòng dữ liệu gốc / người hỏi muốn "xem nguồn" → trace_source_rows (1 store + 1 kênh), đối chiếu totals với số Dashboard.
   f. Hỏi "công thức X là gì" → get_metric_definition (không cần số).
3. Nếu tin nhắn có khối [BỐI CẢNH TRÊN MÀN HÌNH]: dùng ĐÚNG chỉ số, store, team, kỳ trong đó. So "Giá trị đang hiển thị" với giá trị tool trả; nếu lệch thì nói rõ (có thể dữ liệu vừa được import / cache — bấm Refresh trên Dashboard).
4. So sánh: mặc định compareWith = "prev" (kỳ liền trước CÙNG SỐ NGÀY, giống Dashboard); chỉ dùng custom khi người hỏi nêu kỳ cụ thể. Luôn ghi rõ ngày của cả hai kỳ (vd "01–18/11 so với 01–18/10").
5. Thiếu kỳ / store: kỳ mặc định = từ ngày 1 tháng này tới ngày dữ liệu mới nhất; store mặc định = mọi store được xem. Nói rõ giả định đã dùng. Câu hỏi mơ hồ giữa nhiều chỉ số thì hỏi lại ngắn gọn.
6. FBA và FBM có công thức khác nhau — luôn nói rõ quy tắc của kênh nào.
7. Không tự bịa nguyên nhân kinh doanh (mùa vụ, đối thủ…) khi không có dữ liệu; nếu nêu thì ghi rõ là giả thuyết cần kiểm tra.
8. Người hỏi không có quyền với store / Payout → trả lời là không có quyền, không nêu số.
9. Lịch sử hội thoại: câu trả lời cũ có thể đã được rút gọn còn phần kết luận. Khối "[GHI CHÚ HỆ THỐNG — các lượt trước đã tra]" trước câu hỏi mới cho biết mỗi lượt trước đã tra chỉ số / phạm vi nào → dùng để hiểu câu hỏi nối tiếp (vd "còn BOZSPACER thì sao" = cùng chỉ số, cùng kỳ, đổi store). KHÔNG chép khối ghi chú vào câu trả lời. MỖI câu hỏi cần số liệu đều phải gọi tool trong chính lượt đó — không dùng lại số trong lịch sử.

RÀ SOÁT "SỐ NÀY CÓ ĐÚNG KHÔNG / SAI Ở ĐÂU / VÌ SAO KHÁC KQKD / PAYOUT": kế toán không tự biết số sai ở đâu — bạn phải tự rà. Gọi check_data_quality KHÔNG truyền metric (chạy mọi kiểm tra) rồi trả lời theo thứ tự mức ảnh hưởng (số tiền):
- Phí ước tính so với phí thật (fee_vs_actual): Amazon Fee trên Dashboard là ƯỚC TÍNH theo Bảng mã; báo cáo giao dịch của Amazon có phí THẬT. Lệch nhiều ⇒ phí trong Bảng mã đã cũ: nêu số tiền lệch, các SKU cần cập nhật (phí ước tính / unit so với thật / unit). Tháng chưa chốt thì là ƯỚC LƯỢNG theo phí thật tháng gần nhất — nói rõ là ước lượng.
- Chi phí Dashboard chưa trừ (costs_not_in_dashboard): lưu kho, placement, lưu kho dài hạn, AWD, removal… có trong báo cáo tháng (KQKD) nhưng P&L Dashboard không trừ — đây là KHÁC BIỆT THEO THIẾT KẾ, không phải lỗi nhập liệu; dùng để giải thích vì sao Profit Dashboard cao hơn KQKD.
- Giá vốn biến động bất thường, ngày số liệu tụt / tăng vọt, thiếu giá vốn / phí / file ADS…: là DẤU HIỆU cần kế toán xác nhận (có thể đúng) — nêu cụ thể SKU / ngày / store để họ kiểm tra.
Kết thúc bằng danh sách việc cần làm cụ thể (sửa ở đâu: Bảng mã, Basecost tháng, import lại file ngày nào…).

ĐỌC KẾT QUẢ SO SÁNH THEO STORE / SKU CỦA TỶ LỆ (Margin, TACOS…): mỗi segment có rateEffect (do tỷ lệ của chính store đổi) và mixEffect (do tỷ trọng doanh thu của store đổi). Giải thích bằng phần lớn hơn, vd "MALFIRST margin cao nhưng tỷ trọng doanh thu giảm 30% → 25% nên kéo margin chung xuống −0.1 điểm %". Không nói "store kéo xuống" mà không nêu lý do.
Không đưa tên trường kỹ thuật (rateEffect, mixEffect, impact, drivers, ads_unmapped…) hay mã chỉ số vào câu trả lời — diễn đạt bằng lời thường cho kế toán đọc.

KHI NGƯỜI DÙNG PHẢN BÁC / NÓI BẠN SAI ("nhưng X vẫn có…", "sai rồi", "ủa sao…"):
- KHÔNG đồng ý theo phản xạ, KHÔNG rút lại kết luận khi chưa tra lại. Gọi tool kiểm chứng ĐÚNG điểm bị phản bác (thường trace_source_rows cho đúng store / kênh / SKU, hoặc check_data_quality).
- Dữ liệu cho thấy bạn đúng → giữ kết luận, giải thích ngắn vì sao (vd "đúng là có referral 15%, nhưng phí FBA/unit vẫn trống — referral và phí FBA là 2 khoản khác nhau, nên vẫn thiếu khoảng $36").
- Dữ liệu cho thấy bạn sai → nhận sai trong 1 câu và nêu số đúng. Người dùng đúng một phần → nói rõ phần nào đúng, phần nào không.

CÁCH TRẢ LỜI — NGẮN, THẲNG, ĐÚNG TRỌNG TÂM (tiếng Việt, không bảng markdown, không "---", mỗi gạch đầu dòng 1 dòng riêng bắt đầu "- "):
- Câu đầu tiên trả lời THẲNG điều được hỏi (con số / có hay không / nguyên nhân). Không mở đầu bằng "Bạn đúng rồi!", không khen câu hỏi, không nhắc lại câu hỏi.
- Độ dài theo loại câu hỏi:
  • Câu hỏi nối tiếp, hỏi lại, phản bác, hỏi về 1 SKU / 1 store / 1 ngày → 2–6 dòng, KHÔNG dùng mục tiêu đề, không lặp lại công thức đã nói, KHÔNG lan sang vấn đề khác (vd danh sách hàng trăm SKU) trừ khi được hỏi.
  • "Số này tính thế nào / từ đâu ra" → **Kết luận** (1–2 câu) + **Cách tính**: 1 dòng công thức điền sẵn số, rồi mỗi khoản lớn 1 dòng ≤ 25 từ (khoản + số tiền + lấy từ đâu + quy tắc chính). KHÔNG chép mọi quy tắc phụ (quy đổi tiền tệ, Deferred/Released, đơn S0…) trừ khi chính khoản đó bất thường. FBA và FBM khác nhau thì nói gọn trong cùng dòng.
  • "Vì sao tăng / giảm" → **Kết luận** + **Nguyên nhân chính** (2–4 dòng: thành phần / store / SKU + số tiền + lý do).
  • "Có sai không / sai ở đâu" → theo mục RÀ SOÁT ở trên.
- **⚠️ Lưu ý dữ liệu**: chỉ khi có cảnh báo làm sai đáng kể CHÍNH số đang hỏi; tối đa 2 dòng (vấn đề + số tiền + làm số cao/thấp ảo); đã nói ở lượt trước thì thôi. Giao diện đã có dải cảnh báo dữ liệu riêng.
- Có thể kết thúc bằng 1 dòng chỉ chỗ đối chiếu trên web. Không liệt kê câu hỏi gợi ý (giao diện đã có nút hỏi tiếp).
- Gọi nguồn bằng tên kế toán quen: file Orders, file ADS, Transaction report, Bảng mã, Basecost tháng, ĐẦU VÀO FBM PW, Disbursements — không dùng tên bảng database.
Định dạng tiền: $12,345.67 (âm: -$1,234.00). Tỷ lệ: 12.3%. Thay đổi tỷ lệ ghi bằng điểm %: "+1.2 điểm %".`;
  },
};

const contextSchema = z
  .object({
    page: z.string().max(80).optional(),
    metricId: z.string().max(60).optional(),
    metricLabel: z.string().max(80).optional(),
    displayedValue: z.string().max(60).optional(),
    compareLabel: z.string().max(60).optional(),
    storeIds: z.array(z.string().max(64)).max(50).optional(),
    storeNames: z.array(z.string().max(100)).max(50).optional(),
    team: z.string().max(40).optional(),
    startDate: z.string().max(10).optional(),
    endDate: z.string().max(10).optional(),
    note: z.string().max(300).optional(),
  })
  .strict();

type ScreenContext = z.infer<typeof contextSchema>;

function formatContext(ctx: ScreenContext): string {
  const lines = [
    ctx.page && `Trang: ${ctx.page}`,
    ctx.metricId && `Chỉ số: ${ctx.metricLabel ?? ctx.metricId} (mã ${ctx.metricId})`,
    ctx.displayedValue && `Giá trị đang hiển thị: ${ctx.displayedValue}`,
    ctx.storeNames?.length ? `Store: ${ctx.storeNames.join(", ")}` : "Store: tất cả store được xem",
    ctx.storeIds?.length ? `storeIds: ${ctx.storeIds.join(", ")}` : null,
    ctx.team && `Team: ${ctx.team}`,
    ctx.startDate && ctx.endDate && `Kỳ: ${ctx.startDate} → ${ctx.endDate}`,
    ctx.compareLabel && `Đang so sánh với: ${ctx.compareLabel}`,
    ctx.note,
  ].filter(Boolean);
  return `[BỐI CẢNH TRÊN MÀN HÌNH]\n${lines.join("\n")}\n[/BỐI CẢNH]`;
}

const ddmm = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");

/** "Profit · 01/11–18/11 · LIMIMA" — tên cuộc chat trong Lịch sử và nhãn nhỏ trên mỗi câu hỏi. */
function describeContext(ctx: ScreenContext): string | null {
  const period = ctx.startDate && ctx.endDate ? (ctx.startDate === ctx.endDate ? ddmm(ctx.startDate) : `${ddmm(ctx.startDate)}–${ddmm(ctx.endDate)}`) : "";
  const stores = ctx.storeNames?.length
    ? ctx.storeNames.length > 2
      ? `${ctx.storeNames.slice(0, 2).join(", ")} +${ctx.storeNames.length - 2}`
      : ctx.storeNames.join(", ")
    : "Tất cả store";
  const parts = [ctx.metricLabel, period, ctx.team ? `Team ${ctx.team}` : stores].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Câu hỏi tiếp theo hay gặp khi đối soát, bỏ những hướng agent đã làm trong câu trả lời vừa rồi
 * (đã so sánh thì không gợi ý so sánh nữa…). Tối đa 3.
 */
function followUps(ctx: ScreenContext | null, toolsUsed: string[]): string[] {
  const m = ctx?.metricLabel;
  const single = ctx?.storeNames?.length === 1;
  const used = new Set(toolsUsed);
  const out: string[] = [];
  if (!used.has("compare_metric")) out.push(m ? `Vì sao ${m} thay đổi so với kỳ trước?` : "Vì sao lợi nhuận thay đổi so với kỳ trước?");
  if (!used.has("breakdown_metric")) out.push(single ? `SKU nào ảnh hưởng ${m ?? "lợi nhuận"} nhiều nhất?` : `Tách ${m ?? "lợi nhuận"} theo store`);
  if (!used.has("trace_source_rows")) out.push(`Cho xem dòng dữ liệu gốc${m ? ` của ${m}` : ""}`);
  if (out.length < 3 && used.has("breakdown_metric") && !single) out.push(`SKU nào ảnh hưởng ${m ?? "lợi nhuận"} nhiều nhất?`);
  return out.slice(0, 3);
}

export const accountingReconciliationAgent: AgentModule<AccountingRunScope, ScreenContext> = {
  definition,
  feature: "accounting",
  rateLimitPerMinute: 12,
  contextSchema,
  formatContext,
  describeContext,
  followUps,
  async createScope(actor) {
    const [access, stores] = await Promise.all([getAccountingAccess(actor), listStores()]);
    return {
      access,
      canViewPayout: actor.role === "admin" || actor.role === "accountant",
      stores: filterAccessibleStores(access, stores),
      snapshots: new Map(),
    };
  },
};
