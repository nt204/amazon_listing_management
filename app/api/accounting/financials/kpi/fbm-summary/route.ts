import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getAccountingAccess, storeChannelsFor } from "@/lib/accounting/access";
import { getDashboardSkuGroup } from "@/lib/accounting/dashboard-db";
import { getFbmMonthTarget } from "@/lib/accounting/kpi-fbm-targets";

export const runtime = "nodejs";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${ym}-01`, endDate: `${ym}-${String(last).padStart(2, "0")}` };
};
const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Dashboard All của KPI kinh doanh — mục "Hiệu quả kinh doanh FBM": GET ?period=YYYY-MM
// Thực tế = toàn bộ FBM của store trong tháng (như BÁO CÁO TUẦN / tab FBM), mục tiêu = KPI nạp từ file FBM của store.
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const access = await getAccountingAccess(actor);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "";
    if (!PERIOD_RE.test(period)) return Response.json({ error: "Cần period (YYYY-MM)." }, { status: 400 });
    const allowedChannels = access.full ? undefined : (id: string) => storeChannelsFor(access, id);
    const [cur, prev] = await Promise.all(
      [period, prevMonth(period)].map((p) => getDashboardSkuGroup({ group: "win", team: "FBM", ...monthRange(p), allowedChannels })),
    );
    const prevById = new Map(prev.byStore.map((s) => [s.storeId, s.current]));
    const stores = await Promise.all(
      cur.byStore.map(async (s) => {
        const target = await getFbmMonthTarget(s.storeId, period).catch(() => null);
        const p = prevById.get(s.storeId);
        return {
          storeId: s.storeId,
          storeName: s.storeName,
          revenue: s.current.revenue,
          quantity: s.current.quantity,
          prevRevenue: p?.revenue ?? 0,
          prevQuantity: p?.quantity ?? 0,
          target: target ? { revenue: target.revenue, quantity: target.quantity } : null,
        };
      }),
    );
    // Store không có số và không có mục tiêu tháng này → bỏ
    const list = stores.filter((s) => s.revenue || s.quantity || s.target).sort((a, b) => b.revenue - a.revenue);
    return Response.json({ period, stores: list });
  } catch (error) {
    return routeErrorResponse(error, "Không tải được KPI FBM.", 500);
  }
}
