// Trạng thái hiện tại của target (bid, trạng thái, hiệu suất 30 ngày gần nhất, SV, rank)
// để đặt cạnh lịch sử Auto Bid khi quyết định hành động.
import type { Sql } from "postgres";
import { attachSearchVolumes } from "@/lib/ppc/search-volume";

export interface TargetCurrentState {
  asOf: string | null;
  bid: number | null;
  state: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number | null;
  searchVolume: number | null;
  organicRank: number | null;
  sponsoredRank: number | null;
}

export interface TargetRef {
  store_id: string;
  target_id: string;
  target_keyword: string;
}

export const currentStateKey = (storeId: string, targetId: string) => `${storeId}:${targetId}`;

export async function loadTargetCurrentStates(sql: Sql, targets: TargetRef[]): Promise<Map<string, TargetCurrentState>> {
  const unique = new Map<string, TargetRef>();
  for (const t of targets) {
    if (t.store_id && t.target_id) unique.set(currentStateKey(t.store_id, t.target_id), t);
  }
  if (unique.size === 0) return new Map();

  const storeIds = Array.from(new Set(Array.from(unique.values()).map((t) => t.store_id)));
  const targetIds = Array.from(new Set(Array.from(unique.values()).map((t) => t.target_id)));

  // Báo cáo 30 ngày mới nhất của từng target.
  const rows = await sql<Array<{
    store_id: string;
    target_id: string;
    report_end_date: string;
    bid: string | null;
    state: string | null;
    asin: string | null;
    impressions: string | number;
    clicks: string | number;
    spend: string | number;
    sales: string | number;
    orders: string | number;
  }>>`
    SELECT DISTINCT ON (store_id, target_id)
      store_id::text, target_id, report_end_date::text, bid, state, asin, impressions, clicks, spend, sales, orders
    FROM ppc_performance_facts
    WHERE grain = 'TARGET'
      AND store_id = ANY(${storeIds})
      AND target_id = ANY(${targetIds})
      AND (report_end_date - report_start_date) >= 25
    ORDER BY store_id, target_id, snapshot_date DESC, report_end_date DESC
  `;
  const factByKey = new Map(rows.map((row) => [currentStateKey(row.store_id, row.target_id), row]));

  const refs = Array.from(unique.entries()).map(([key, ref]) => ({
    key,
    keyword: ref.target_keyword,
    impressions: 0,
    asin: factByKey.get(key)?.asin ?? null,
  }));
  let enriched: Array<(typeof refs)[number] & { searchVolume: number | null; organicRank: number | null; sponsoredRank: number | null }> =
    refs.map((ref) => ({ ...ref, searchVolume: null, organicRank: null, sponsoredRank: null }));
  try {
    enriched = await attachSearchVolumes(sql, refs, {
      keywordOf: (ref) => ref.keyword,
      coverageDaysOf: () => 30,
      shareApplies: () => false,
    });
  } catch (error) {
    console.warn("[target-current-state] attach search volume failed", error);
  }

  const result = new Map<string, TargetCurrentState>();
  for (const ref of enriched) {
    const fact = factByKey.get(ref.key);
    const spend = Number(fact?.spend || 0);
    const sales = Number(fact?.sales || 0);
    result.set(ref.key, {
      asOf: fact?.report_end_date ?? null,
      bid: fact?.bid == null ? null : Number(fact.bid),
      state: fact?.state ?? null,
      impressions: Number(fact?.impressions || 0),
      clicks: Number(fact?.clicks || 0),
      spend,
      sales,
      orders: Number(fact?.orders || 0),
      acos: sales > 0 ? (spend / sales) * 100 : null,
      searchVolume: ref.searchVolume,
      organicRank: ref.organicRank,
      sponsoredRank: ref.sponsoredRank,
    });
  }
  return result;
}
