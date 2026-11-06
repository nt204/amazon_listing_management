// scripts/sync-search-volume.ts
// Đồng bộ Search Volume + Rank (Helium 10 Cerebro/Magnet) cho TẤT CẢ store PPC — chạy bằng cron trên VPS mỗi tháng
// (scripts/ppc-search-volume-monthly.sh). Tiến trình riêng, không chạy trong web app.
//
// - ASIN của mọi store cùng marketplace gộp 1 hàng đợi, xếp theo spend 60 ngày (xem loadAsinQueue).
// - Cookie Helium 10 lấy từ DB (app_settings, cập nhật ở Admin → Helium 10). Hết hạn thì ghi 1 run "failed"
//   vào lịch sử đồng bộ để thấy trên giao diện; không gửi thông báo ra ngoài.
// - Đang có lượt khác chạy / hết hạn mức tháng → bỏ qua, checkpoint giữ nguyên cho lần sau.
//
// Dùng: npm run ppc:sync-search-volume            (mọi store)
//       npm run ppc:sync-search-volume -- LIMIMA  (1 store)
import { getDatabaseClient } from "../lib/db";
import { startSearchVolumeSync, getSearchVolumeStatus } from "../lib/ppc/search-volume";

const TEAM_ID = "default";
const storeName = (process.argv[2] || "ALL").toUpperCase();
const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

async function recordFailedAttempt(message: string) {
  const sql = await getDatabaseClient();
  const [store] = storeName === "ALL"
    ? [null]
    : await sql<Array<{ id: string }>>`SELECT id FROM ppc_stores WHERE team_id = ${TEAM_ID} AND lower(name) = lower(${storeName})`;
  await sql`
    INSERT INTO ppc_search_volume_sync_runs (team_id, store_id, created_by, status, message, heartbeat_at, finished_at)
    VALUES (${TEAM_ID}, ${store?.id ?? null}, 'cron-monthly', 'failed', ${`[Lịch hằng tháng] ${message}`}, NOW(), NOW())
  `;
}

async function main() {
  log(`Bắt đầu đồng bộ Search Volume (${storeName})`);

  let started: Awaited<ReturnType<typeof startSearchVolumeSync>>;
  try {
    started = await startSearchVolumeSync({ teamId: TEAM_ID, storeName, actorId: "cron-monthly" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    // 409 = lượt khác đang chạy, 429 = hết hạn mức tháng: không phải sự cố, chỉ ghi log
    if (status === 409 || status === 429) {
      log(`Bỏ qua: ${message}`);
      return 0;
    }
    log(`Không bắt đầu được: ${message}`);
    await recordFailedAttempt(message).catch((err) => log(`Không ghi được lịch sử: ${err}`));
    return 1;
  }

  log(`Run ${started.runId} đang chạy...`);
  await started.execute();

  const status = await getSearchVolumeStatus(TEAM_ID, storeName);
  const run = status.recentRuns.find((item) => item.id === started.runId) ?? status.latestRun;
  log(`Kết thúc: ${run?.status} — ${run?.message ?? ""}`);
  log(`Hạn mức tháng: Cerebro ${status.budget.cerebroUsed}/${status.budget.cerebroLimit}, Magnet ${status.budget.magnetUsed}/${status.budget.magnetLimit}`);
  return run?.status === "completed" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log(`Lỗi nghiêm trọng: ${error instanceof Error ? error.stack : error}`);
    process.exit(1);
  });
