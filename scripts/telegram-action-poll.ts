// Máy dev: nhận cập nhật của bot Telegram action PPC bằng getUpdates (thay cho webhook production).
// Chỉ chạy được khi bot CHƯA đặt webhook (scripts/telegram-action-set-webhook.ts delete).
//
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/telegram-action-poll.ts [--once]
import { handleTelegramUpdate, telegramApi, type TelegramUpdate } from "@/lib/telegram-action-bot";

async function main() {
  const once = process.argv.includes("--once");
  const info = await telegramApi<{ url?: string }>("getWebhookInfo", {});
  if (info.url) throw new Error(`Bot đang dùng webhook ${info.url} — không poll được (tránh tranh cập nhật với production).`);
  let offset = 0;
  console.log("Đang nghe cập nhật Telegram… (Ctrl+C để dừng)");
  for (;;) {
    let updates: TelegramUpdate[];
    try {
      updates = await telegramApi<TelegramUpdate[]>("getUpdates", {
        offset, timeout: 25, allowed_updates: ["message", "callback_query"],
      });
    } catch (error) {
      console.warn("getUpdates lỗi, thử lại sau 3s:", error instanceof Error ? error.message : error);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const what = update.callback_query ? `nút ${update.callback_query.data}` : `tin "${update.message?.text?.slice(0, 40)}"`;
      console.log(new Date().toISOString(), what);
      await handleTelegramUpdate(update).catch((error) => console.error("Lỗi xử lý:", error));
    }
    if (once && updates.length) break;
  }
  // Báo cho Telegram đã nhận tới offset hiện tại.
  await telegramApi("getUpdates", { offset, timeout: 0 });
}

main().then(() => setTimeout(() => process.exit(0), 3000)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
