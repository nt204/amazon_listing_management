import { runAccountingAgent } from "../lib/accounting/lark-agent-service";

async function main() {
  console.log("=== BẮT ĐẦU TEST LARK ACCOUNTING AI AGENT ===");
  console.log("Model: gemini-3.8-flash qua CheapKey");
  console.log("Email nhận thông báo test:", "ndtrince@gmail.com\n");

  const testQuestion = 
    "Báo cáo tình hình Store BOZSPACER từ ngày 2026-10-01 đến 2026-10-07: doanh thu, chi phí ads, hoàn tiền và lợi nhuận. Đồng thời kiểm tra xem có lô hàng nào của store này đang chuyển đi không?";

  console.log(`Câu hỏi test: "${testQuestion}"\n`);

  const startTime = Date.now();
  const result = await runAccountingAgent({
    message: testQuestion,
    recipientEmail: "ndtrince@gmail.com",
    sendToLark: true,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n=== KẾT QUẢ XỬ LÝ (${elapsed}s) ===`);
  console.log("Tools đã gọi:", result.toolsUsed);
  console.log("Đã gửi tin nhắn Lark:", result.larkSent ? "✅ THÀNH CÔNG" : "❌ THẤT BẠI");
  console.log("Chi tiết gửi Lark:", result.larkDetail);
  console.log("\n--- NỘI DUNG PHẢN HỒI ---");
  console.log(result.replyText);
  console.log("-------------------------\n");
}

main().catch((err) => {
  console.error("Lỗi test:", err);
  process.exit(1);
});
