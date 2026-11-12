import "server-only";

import { getKpi } from "@/lib/accounting/kpi-db";
import { computeTarget } from "@/lib/accounting/kpi-calc";
import { addProgressTotals, kpiWindowWeights, type KpiProgressTotals, type KpiWindow } from "@/lib/accounting/kpi-progress";

// Mục tiêu tháng của 1 store đúng như trang KPI kinh doanh: SKU WIN (phát triển) + SKU TEST, mỗi SKU tính theo công thức
// mục tiêu của store (computeTarget); nhóm chưa có mục tiêu từng SKU thì dùng mục tiêu tổng team nạp từ BÁO CÁO THÁNG.

export interface StoreKpiTargets {
  dev: KpiProgressTotals | null;
  test: KpiProgressTotals | null;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<StoreKpiTargets> }>();

async function computeMonthTargets(storeId: string, period: string): Promise<StoreKpiTargets> {
  const data = await getKpi(storeId, period);
  const out: StoreKpiTargets = { dev: null, test: null };
  for (const s of data.skus) {
    const unit = { price: s.price, basecost_unit: s.basecost_unit, amazon_fee_unit: s.amazon_fee_unit, referral_pct: s.referral_pct };
    // Như giao diện KPI: Return "theo thực tế" của mục tiêu tháng đang xem = Return thực tế tháng trước
    const t = computeTarget(s.target.cur, unit, data.targetFormula, s.actual.prev ? Math.abs(s.actual.prev.return_amount) : null);
    if (!t) continue;
    out[s.group] = addProgressTotals(out[s.group], { revenue: t.revenue, quantity: t.quantity, profit: t.profit });
  }
  for (const g of ["dev", "test"] as const) {
    const team = data.teamTargets?.cur[g];
    if (!out[g] && team) out[g] = { revenue: team.revenue ?? 0, quantity: team.quantity ?? 0, profit: team.profit ?? 0 };
  }
  return out;
}

/** Mục tiêu tháng của store (có cache 10 phút) */
export function getStoreMonthTargets(storeId: string, period: string): Promise<StoreKpiTargets> {
  const key = `${storeId}:${period}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = computeMonthTargets(storeId, period).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

const scale = (t: KpiProgressTotals | null, w: number): KpiProgressTotals | null =>
  t ? { revenue: t.revenue * w, quantity: t.quantity * w, profit: t.profit * w } : null;

/** Mục tiêu của store trong khung tuần / tháng = Σ KPI tháng × tỷ trọng số ngày */
export async function getStoreWindowTargets(storeId: string, window: KpiWindow): Promise<StoreKpiTargets> {
  const out: StoreKpiTargets = { dev: null, test: null };
  for (const [period, weight] of kpiWindowWeights(window)) {
    const m = await getStoreMonthTargets(storeId, period);
    out.dev = addProgressTotals(out.dev, scale(m.dev, weight));
    out.test = addProgressTotals(out.test, scale(m.test, weight));
  }
  return out;
}
