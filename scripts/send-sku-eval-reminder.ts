// Nhắc đánh giá SKU Testing — xem trước / gửi tay.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/send-sku-eval-reminder.ts \
//     [--month 2026-12] [--store LIMIMA[,FASTPEACE]] [--send] [--webhook URL] [--json]
// Không có --send: chỉ in ra số liệu, không gửi Lark.
import {
  buildSkuEvalReminder,
  buildSkuEvalReminderCard,
  configuredReminderStores,
  reminderWebhookUrl,
  vietnamNow,
} from "@/lib/accounting/sku-eval-reminder";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const month = arg("--month") || vietnamNow().month;
  const storeArg = arg("--store");
  const stores = storeArg ? storeArg.split(",").map((s) => s.trim()).filter(Boolean) : configuredReminderStores();
  const reminder = await buildSkuEvalReminder(month, stores);
  const card = buildSkuEvalReminderCard(reminder);

  console.log(`Tháng ${month} · tháng thứ 3 = listing ${reminder.m3Listing} · tháng thứ 4 = listing ${reminder.m4Listing}`);
  for (const s of reminder.stores) {
    console.log(`  ${s.storeName} (${s.team}): ${s.total} SKU — quá hạn ${s.late.length}, tháng 4: ${s.m4.length}, tháng 3: ${s.m3.length}`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(card, null, 2));

  if (process.argv.includes("--send")) {
    const webhook = arg("--webhook") || reminderWebhookUrl();
    if (!webhook) throw new Error("Chưa có webhook Lark (--webhook hoặc LARK_ACCOUNTING_WEBHOOK_URL).");
    await sendLarkWebhookNotification(webhook, { card });
    console.log("✅ Đã gửi vào Lark.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
