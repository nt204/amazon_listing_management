// Nhắc đánh giá SKU Testing — xem trước / gửi tay.
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/send-sku-eval-reminder.ts \
//     [--month 2026-12] [--store LIMIMA[,FASTPEACE]] [--team "FBA 2"] [--send] [--webhook URL] [--json]
// --team: mã team như báo cáo KPI ngày (TEAMS[].id) — gửi 1 tin gồm mọi store của team, tiêu đề có tên team.
// Không có --send: chỉ in ra số liệu, không gửi Lark.
import {
  buildSkuEvalReminder,
  buildSkuEvalReminderCard,
  configuredReminderStores,
  reminderWebhookUrl,
  vietnamNow,
} from "@/lib/accounting/sku-eval-reminder";
import { sendLarkWebhookNotification } from "@/lib/lark-notifications";
import { TEAMS } from "@/scripts/send-daily-kpi-report";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const month = arg("--month") || vietnamNow().month;
  const storeArg = arg("--store");
  const stores = storeArg ? storeArg.split(",").map((s) => s.trim()).filter(Boolean) : configuredReminderStores();
  const teamId = arg("--team")?.trim().toUpperCase();
  const team = teamId ? TEAMS.find((t) => t.id.toUpperCase() === teamId) : undefined;
  if (teamId && !team) throw new Error(`Không có team "${teamId}". Có: ${TEAMS.map((t) => t.id).join(", ")}`);
  const reminder = await buildSkuEvalReminder(month, storeArg || !teamId ? stores : [], { teamId });
  const card = buildSkuEvalReminderCard(reminder, {
    titlePrefix: team ? `${team.name.toUpperCase()} (${team.lead.toUpperCase()})` : undefined,
  });

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
