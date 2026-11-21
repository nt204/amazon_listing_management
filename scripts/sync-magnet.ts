// scripts/sync-magnet.ts
// Chạy Magnet độc lập cho các keyword PPC (target + search term) đốt spend cao nhất mà chưa có Search Volume.
// Dùng khi Cerebro đã hết quota nhưng tài khoản còn lượt Magnet.
//
// Dùng chung logic với lượt đồng bộ chính (lib/ppc/search-volume.ts, mode "magnet"):
// - Keyword tra đúng marketplace của store, lọc target không phải keyword giống hệt giao diện.
// - Từ Magnet đã tra trong tháng mà H10 không có số (miss) không bị tra lại → không đốt lượt lặp lại.
// - Tính vào hạn mức Magnet tháng, không chạy song song với lượt đồng bộ khác.
//
// Dùng: npm run ppc:sync-magnet -- [số_lượt_magnet] [STORE|ALL]
import { startSearchVolumeSync, getSearchVolumeStatus } from "../lib/ppc/search-volume";

const TEAM_ID = "default";
const DEFAULT_LIMIT = 20;

async function main() {
  const limit = Math.max(1, Number(process.argv[2]) || DEFAULT_LIMIT);
  const storeName = (process.argv[3] || "ALL").toUpperCase();
  console.log(`[Magnet] Tối đa ${limit} lượt Magnet cho keyword thiếu volume (${storeName})...`);

  const started = await startSearchVolumeSync({
    teamId: TEAM_ID,
    storeName,
    actorId: "manual-magnet",
    mode: "magnet",
    magnetLimit: limit,
  });
  await started.execute();

  const status = await getSearchVolumeStatus(TEAM_ID, storeName);
  const run = status.recentRuns.find((item) => item.id === started.runId) ?? status.latestRun;
  console.log(`[Magnet] Kết thúc: ${run?.status} — ${run?.message ?? ""}`);
  console.log(`[Magnet] Hạn mức tháng: Magnet ${status.budget.magnetUsed}/${status.budget.magnetLimit}`);
  return run?.status === "completed" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[Magnet] Lỗi:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
