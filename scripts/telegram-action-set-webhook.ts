// Đăng ký / xem / gỡ webhook của bot Telegram action PPC (lib/telegram-action-bot.ts).
//
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/telegram-action-set-webhook.ts set [https://ncehub.net]
//   ... info      → xem webhook hiện tại
//   ... delete    → gỡ webhook (để máy dev dùng scripts/telegram-action-poll.ts)
import { telegramActionConfig, telegramApi } from "@/lib/telegram-action-bot";

async function main() {
  const [command = "info", baseArg] = process.argv.slice(2);
  const { secret } = telegramActionConfig();
  if (command === "set") {
    if (!secret) throw new Error("Thiếu PPC_ACTION_TELEGRAM_WEBHOOK_SECRET");
    const base = (baseArg || process.env.PPC_PUBLIC_URL || "https://ncehub.net").replace(/\/+$/, "");
    await telegramApi("setWebhook", {
      url: `${base}/api/telegram/ppc-action`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    console.log(`Đã đặt webhook: ${base}/api/telegram/ppc-action`);
  } else if (command === "delete") {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("Đã gỡ webhook.");
  }
  const info = await telegramApi<Record<string, unknown>>("getWebhookInfo", {});
  console.log(info);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
