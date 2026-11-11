// Xem trước cảnh báo bất thường + tóm tắt tuần sẽ gửi cho từng người (KHÔNG gửi Lark).
//   npm run lark:alerts-preview                → cả hai, ngày dữ liệu mới nhất
//   npm run lark:alerts-preview -- 2026-10-25 2026-10-19  → cảnh báo ngày 25/10, tóm tắt tuần như thể hôm nay là 19/10
import { sendAnomalyAlerts, sendWeeklySummaries, loadAlertRecipients } from "../lib/accounting/lark-proactive-alerts";

async function main() {
  const date = process.argv[2];
  const recipients = await loadAlertRecipients();
  console.log(`Người nhận (đã liên kết Lark + bật "Kế toán" + có quyền store): ${recipients.length}`);
  for (const r of recipients) console.log(`  - ${r.name}: ${r.storeNames.join(", ")}`);

  const anomaly = await sendAnomalyAlerts({ dryRun: true, date });
  console.log("\n===== CẢNH BÁO BẤT THƯỜNG =====", "date" in anomaly ? anomaly.date : "", "skipped" in anomaly ? anomaly.skipped : "");
  for (const p of ("previews" in anomaly && anomaly.previews) || []) console.log(`\n--- gửi ${p.to} ---\n${p.markdown}`);

  const weekly = await sendWeeklySummaries({ dryRun: true, today: process.argv[3] });
  console.log("\n===== TÓM TẮT TUẦN =====", "skipped" in weekly ? weekly.skipped : "");
  for (const p of ("previews" in weekly && weekly.previews) || []) console.log(`\n--- gửi ${p.to} ---\n${p.markdown}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
