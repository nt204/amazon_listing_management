// Chạy thử "Auto giảm Bid" cho CẤU HÌNH CỦA 1 NGƯỜI ở 1 store (lib/ppc/auto-decrease.ts).
//
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/auto-decrease-send.ts \
//     --store HSOSTORE --actor admin-ndtrince [--ignore-wait] [--replace] [--dry-run]
//
//   --actor        người cấu hình (user_id). Dùng cấu hình + kênh nhận (Telegram / Lark) của chính người này.
//   --ignore-wait  bỏ qua điều kiện N ngày (để test ngay; vẫn giữ mọi guardrail khác)
//   --replace      xoá lô PENDING hôm nay của người này trước khi tạo lô mới
//   --dry-run      chỉ cập nhật bộ đếm + in danh sách target đủ điều kiện, không tạo lô, không gửi
import { getDatabaseClient } from "@/lib/db";
import {
  autoDecreaseChannels,
  getAutoDecreaseSettings,
  listAutoDecreaseRecipients,
  listTelegramRecipients,
  runAutoDecreaseForStore,
  selectAutoDecreaseCandidates,
  updateDecreaseStreaks,
} from "@/lib/ppc/auto-decrease";
import { loadFullStoreRecommendations } from "@/lib/ppc/auto-bid-prewarm";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const storeName = arg("store");
  const actorId = arg("actor");
  if (!storeName || !actorId) throw new Error("Cần --store và --actor");
  const sql = await getDatabaseClient();
  const stores = await sql<Array<{ id: string; name: string; team_id: string }>>`
    SELECT id::text AS id, name, team_id FROM ppc_stores WHERE LOWER(name) = LOWER(${storeName}) LIMIT 1
  `;
  const store = stores[0];
  if (!store) throw new Error(`Không thấy store ${storeName}`);
  const settings = await getAutoDecreaseSettings(store.id, actorId);
  console.log("Cấu hình:", settings);

  if (flag("dry-run")) {
    const snap = await sql<Array<{ report_end_date: Date }>>`
      SELECT report_end_date FROM ppc_active_snapshots WHERE store_id = ${store.id} AND coverage_days = 30
    `;
    const day = snap[0]?.report_end_date;
    const snapshotDate = day ? day.toISOString().slice(0, 10) : null; // DATE = 00:00 UTC
    if (!snapshotDate) throw new Error("Store chưa có snapshot 30 ngày");
    const recs = (await loadFullStoreRecommendations({ teamId: store.team_id, actorId: "script" }, store, 30, false)).allRecommendations;
    const tracked = await updateDecreaseStreaks(store.id, recs, snapshotDate);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    const items = await selectAutoDecreaseCandidates(store, settings, recs, today, { ignoreWaitDays: flag("ignore-wait") });
    const channels = autoDecreaseChannels();
    const lark = channels.lark ? await listAutoDecreaseRecipients(store.team_id, store.id, actorId) : [];
    const telegram = channels.telegram ? await listTelegramRecipients(store.team_id, store.id, actorId) : [];
    console.log(`Snapshot ${snapshotDate}: ${recs.length} đề xuất, ${tracked.tracked} giảm bid đang theo dõi, ${items.length} đủ điều kiện.`);
    console.log("Kênh nhận:", [lark.length ? "Lark" : "", telegram.length ? "Telegram" : ""].filter(Boolean).join(", ") || "—");
    console.table(items.slice(0, 20).map((i) => ({
      sku: i.sku, keyword: i.keyword.slice(0, 40), bid: `${i.currentBid} → ${i.finalBid} (${i.changePct}%)`,
      rule: i.recommendedBid, spend: i.spend, days: i.seenDays,
    })));
    return;
  }

  const result = await runAutoDecreaseForStore(store, [actorId], {
    ignoreWaitDays: flag("ignore-wait"),
    replaceToday: flag("replace"),
  });
  console.log(result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
