import { generateChatGPTWebImage, parseChatGPTCookies } from "../lib/chatgpt-web-automation";

async function runTest() {
  console.log("🔍 Đang đọc cấu hình từ .env...");
  const rawCookies = process.env.CHATGPT_WEB_COOKIES;
  const rawToken = process.env.CHATGPT_SESSION_TOKEN;

  console.log(`📌 CHATGPT_WEB_COOKIES dài: ${rawCookies?.length || 0} ký tự`);
  console.log(`📌 CHATGPT_SESSION_TOKEN dài: ${rawToken?.length || 0} ký tự`);

  const cookies = parseChatGPTCookies();
  console.log(`🍪 Số lượng cookies được bóc tách: ${cookies.length}`);
  cookies.forEach((c, idx) => {
    console.log(`  - Cookie [${idx + 1}]: name="${c.name}", value dài=${c.value.length} ký tự, domain="${c.domain}"`);
  });

  if (cookies.length === 0) {
    console.error("❌ Không tìm thấy cookie hợp lệ trong .env!");
    process.exit(1);
  }

  console.log("\n🚀 Đang chạy Playwright truy cập chatgpt.com và thử tạo ảnh...");
  const testPrompt = "Generate a luxury Christmas ornament hanging on a pine tree";

  try {
    const buffer = await generateChatGPTWebImage(testPrompt, {
      headless: true,
      timeoutMs: 90000,
    });
    console.log(`\n🎉 THÀNH CÔNG! Đã tự động tạo ảnh và nhận Buffer thành công: ${buffer.length} bytes PNG!`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Kết quả kiểm tra: ${msg}`);
  }
}

runTest();
