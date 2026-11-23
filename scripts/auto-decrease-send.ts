// Chạy thử "Auto giảm Bid" cho 1 store (lib/ppc/auto-decrease.ts).
//
//   node --conditions=react-server --env-file-if-exists=.env --import tsx scripts/auto-decrease-send.ts \
//     --store HSOSTORE [--actor admin-ndtrince] [--ignore-wait] [--replace] [--dry-run]
//
//   --actor        chỉ gửi thẻ cho user này (vẫn phải đủ điều kiện nhận: phân quyền store + kết nối Lark + bật PPC)
//   --ignore-wait  bỏ qua điều kiện N ngày (để test ngay; vẫn giữ mọi guardrail khác)
//   --replace      xoá lô PENDING hôm nay của store trước khi tạo lô mới
//   --dry-run      chỉ cập nhật bộ đếm + in danh sách target đủ điều kiện, không tạo lô, không gửi Lark
import { getDatabaseClient } from "@/lib/db";
import {
  getAutoDecreaseSettings,
  listAutoDecreaseRecipients,
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
  if (!storeName) throw new Error("Thiếu --store");
  const sql = await getDatabaseClient();
  const stores = await sql<Array<{ id: string; name: string; team_id: string }>>`
    SELECT id::text AS id, name, team_id FROM ppc_stores WHERE LOWER(name) = LOWER(${storeName}) LIMIT 1
  `;
  const store = stores[0];
  if (!store) throw new Error(`Không thấy store ${storeName}`);
  const settings = await getAutoDecreaseSettings(store.id);
  console.log("Cài đặt:", settings);

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
    const recipients = await listAutoDecreaseRecipients(store.team_id, store.id);
    console.log(`Snapshot ${snapshotDate}: ${recs.length} đề xuất, ${tracked.tracked} giảm bid đang theo dõi, ${items.length} đủ điều kiện.`);
    console.log("Người nhận:", recipients.map((r) => `${r.display_name} (${r.actor_id}, ${r.receive_id_type})`).join(", ") || "—");
    console.table(items.slice(0, 20).map((i) => ({
      sku: i.sku, keyword: i.keyword.slice(0, 40), bid: `${i.currentBid} → ${i.finalBid} (${i.changePct}%)`,
      rule: i.recommendedBid, spend: i.spend, days: i.seenDays,
    })));
    return;
  }

  const result = await runAutoDecreaseForStore(store, {
    ignoreWaitDays: flag("ignore-wait"),
    replaceToday: flag("replace"),
    onlyActorId: arg("actor"),
  });
  console.log(result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
