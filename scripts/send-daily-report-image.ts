// Dựng báo cáo kinh doanh ngày (ảnh; --card: card quản trị ngắn; --stores: card thu gọn theo store) và (tuỳ chọn) gửi qua Lark cho 1 email.
// Dùng: node --conditions=react-server --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx \
//         scripts/send-daily-report-image.ts [--date YYYY-MM-DD] [--email a@b.com] [--out report.png] [--card | --stores | --analyze "phân tích Warmstorey"]
import { writeFileSync } from "node:fs";

import { sendChannelDiagnosis, sendDailyReportImage, sendDailyReportStoreCard } from "../lib/accounting/daily-business-reporter";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const analyze = arg("analyze");
  if (analyze) {
    const result = await sendChannelDiagnosis({
      message: analyze,
      targetDate: arg("date"),
      recipient: email ? { receiveId: email, receiveIdType: "email" } : undefined,
    });
    console.log(result.matched ? result.message : "Không nhận ra store trong câu hỏi.");
    if (result.text) console.log(result.text);
    process.exit(result.success ? 0 : 1);
  }
  if (process.argv.includes("--card") || process.argv.includes("--stores")) {
    const result = await sendDailyReportStoreCard({
      targetDate: arg("date"),
      layout: process.argv.includes("--stores") ? "stores" : "brief",
      recipient: email ? { receiveId: email, receiveIdType: "email" } : undefined,
    });
    console.log(result.message);
    const out = arg("out");
    if (out && result.card) writeFileSync(out, JSON.stringify(result.card, null, 2));
    if (email && result.success) console.log(`Đã gửi card tới ${email}`);
    process.exit(result.success ? 0 : 1);
  }
  const result = await sendDailyReportImage({
    targetDate: arg("date"),
    recipient: email ? { receiveId: email, receiveIdType: "email" } : undefined,
  });
  console.log(result.message);
  const out = arg("out");
  if (out && result.png) {
    writeFileSync(out, result.png);
    if (result.html) writeFileSync(out.replace(/\.png$/, ".html"), result.html);
    console.log(`Đã lưu ${out}`);
  }
  if (email && result.success) console.log(`Đã gửi ảnh tới ${email}`);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
