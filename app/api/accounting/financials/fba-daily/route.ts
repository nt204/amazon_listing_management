import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { channelParam, requireStoreAccess } from "@/lib/accounting/access";
import { listFbaDaily } from "@/lib/accounting/fba-daily-db";
import { listFbmDaily } from "@/lib/accounting/fbm-financials-db";

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
    const list = searchParams.get("channel") === "fbm" ? listFbmDaily : listFbaDaily;
    const result = await list(storeId, {
      startDate,
      endDate,
      search,
      sortField,
      sortDirection,
      page,
      limit,
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Failed to load FBA Daily data.", 500);
  }
}
