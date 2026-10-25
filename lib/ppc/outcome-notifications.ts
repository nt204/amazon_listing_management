import "server-only";

import { getDatabaseClient } from "@/lib/db";
import { notifyLarkEventBestEffort } from "@/lib/lark-notifications";
import { getReadyRedisClient } from "@/lib/redis";

const NOTIFIED_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_LINES_PER_STORE = 10;

interface NegativeOutcomeRow {
  outcome_id: string;
  window_days: number;
  team_id: string;
  store_name: string;
  sku: string | null;
  target_keyword: string;
  action_type: string;
  old_value: string | number | null;
  final_value: string | number | null;
  baseline_acos: string | null;
  observed_acos: string | null;
  reward_usd: string | null;
}

/**
 * Báo lên Lark (kênh PPC) các lần chỉnh bid vừa bị đánh giá XẤU ở cửa sổ 7 hoặc 30 ngày.
 * Mỗi kết quả chỉ báo một lần (đánh dấu trong Redis); không có Redis thì bỏ qua để tránh spam.
 */
export async function notifyNegativeBidOutcomes(): Promise<{ notified: number }> {
  // Tắt mặc định; chỉ gửi khi bật rõ ràng PPC_NEGATIVE_OUTCOME_ALERTS=1.
  if (process.env.PPC_NEGATIVE_OUTCOME_ALERTS !== "1") return { notified: 0 };

  const redis = await getReadyRedisClient();
  if (!redis) return { notified: 0 };

  const sql = await getDatabaseClient();
  const rows = await sql<NegativeOutcomeRow[]>`
    SELECT o.id AS outcome_id, o.window_days, s.team_id, s.name AS store_name,
           a.sku, a.target_keyword, a.action_type, a.old_value, a.final_value,
           o.baseline->>'acos' AS baseline_acos, o.observed->>'acos' AS observed_acos,
           o.comparison->>'reward_usd' AS reward_usd
    FROM ppc_action_outcomes o
    JOIN ppc_actions a ON a.id = o.action_id
    JOIN ppc_stores s ON s.id = a.store_id
    WHERE o.outcome_label = 'NEGATIVE'
      AND o.window_days IN (7, 30)
      AND a.action_type IN ('UPDATE_BID', 'PAUSE_TARGET')
      AND o.evaluated_at >= NOW() - INTERVAL '1 day'
    ORDER BY s.name, o.window_days DESC
  `;

  const fresh: NegativeOutcomeRow[] = [];
  for (const row of rows) {
    const marked = await redis.set(`ppc:outcome-notified:${row.outcome_id}`, "1", "EX", NOTIFIED_TTL_SECONDS, "NX");
    if (marked !== null) fresh.push(row);
  }
  if (fresh.length === 0) return { notified: 0 };

  const byStore = new Map<string, NegativeOutcomeRow[]>();
  for (const row of fresh) {
    const key = `${row.team_id}\0${row.store_name}`;
    byStore.set(key, [...(byStore.get(key) || []), row]);
  }

  const acos = (value: string | null) => {
    const n = Number(value);
    return value != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : "N/A";
  };

  for (const [key, items] of byStore) {
    const [teamId, storeName] = key.split("\0");
    const lines = items.slice(0, MAX_LINES_PER_STORE).map((row, idx) => {
      const change = row.action_type === "PAUSE_TARGET"
        ? "Tạm dừng"
        : `$${Number(row.old_value || 0).toFixed(2)} → $${Number(row.final_value || 0).toFixed(2)}`;
      const reward = Number(row.reward_usd);
      const rewardText = row.reward_usd != null && Number.isFinite(reward) ? ` • ${reward >= 0 ? "+" : ""}$${reward.toFixed(2)}` : "";
      return `${idx + 1}. ${row.target_keyword} (SKU: ${row.sku || "N/A"}) • ${change} • ACOS ${acos(row.baseline_acos)} → ${acos(row.observed_acos)} (${row.window_days} ngày)${rewardText}`;
    });
    const more = items.length > MAX_LINES_PER_STORE ? `... và ${items.length - MAX_LINES_PER_STORE} lần chỉnh khác.` : "";

    await notifyLarkEventBestEffort({ teamId, actorId: "system" }, "ppc", [
      `🔴 **Auto Bid: ${items.length} lần chỉnh bid cho kết quả XẤU**`,
      `• Store: ${storeName}`,
      ...lines,
      more,
      "Xem chi tiết: https://ncehub.net/?view=ppc&section=auto_bid",
    ]);
  }

  return { notified: fresh.length };
}
