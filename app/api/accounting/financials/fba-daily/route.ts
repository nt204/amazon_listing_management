import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { channelParam, requireStoreAccess } from "@/lib/accounting/access";
import { listFbaDaily } from "@/lib/accounting/fba-daily-db";
import { listFbmDaily } from "@/lib/accounting/fbm-financials-db";
import { getMonthlyServiceFees } from "@/lib/accounting/service-fees-db";
import { getStoreById } from "@/lib/accounting/accounting-db";

/** Kỳ phân bổ phí dịch vụ như file kế toán: 1/7 → 31/12 (184 ngày), cùng mẫu số với FBA (fba-daily-db) */
const FBM_SERVICE_DAYS = 184;

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, channelParam(searchParams.get("channel")));

    const startDate = searchParams.get("start_date") || undefined;
    const endDate = searchParams.get("end_date") || undefined;
    const search = searchParams.get("search") || undefined;
    const sortField = searchParams.get("sort_field") || "date";
    const sortDirection = (searchParams.get("sort_dir") as "asc" | "desc") || "asc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    // channel=fbm: tab FBM theo ngày (sheet "FBM" của file kế toán FBM)
    const isFbm = searchParams.get("channel") === "fbm";
    const list = isFbm ? listFbmDaily : listFbaDaily;
    const result = await list(storeId, {
      startDate,
      endDate,
      search,
      sortField,
      sortDirection,
      page,
      limit,
    });

    // FBA: Service Fees từng tháng có trong bảng → dòng "Service Fees" + khối Chi phí khác Amazon (FBM không có)
    const months = [...new Set(result.items.map((i) => i.date.slice(0, 7)))];
    const serviceFees = isFbm ? [] : await getMonthlyServiceFees(storeId, months);

    // FBM: Net Profit = Profit − phí dịch vụ FBM của store ÷ 184 ngày (sheet: K − 35000/(31/12 − 1/7 + 1));
    // store chưa khai phí thì để trống như sheet
    if (isFbm) {
      const store = await getStoreById(storeId);
      const cost = store?.fbm_service_cost;
      if (cost != null) {
        const daily = cost / FBM_SERVICE_DAYS;
        const items = result.items.map((i) => ({ ...i, net_profit: i.profit - daily }));
        const totalNetProfit = items.reduce((sum, i) => sum + i.net_profit, 0);
        return Response.json({ ...result, items, stats: { ...result.stats, totalNetProfit }, serviceFees });
      }
    }

    return Response.json({ ...result, serviceFees });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load FBA Daily data.", 500);
  }
}
