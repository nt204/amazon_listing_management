import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { listFbaDaily } from "@/lib/accounting/fba-daily-db";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    const startDate = searchParams.get("start_date") || undefined;
    const endDate = searchParams.get("end_date") || undefined;
    const search = searchParams.get("search") || undefined;
    const sortField = searchParams.get("sort_field") || "date";
    const sortDirection = (searchParams.get("sort_dir") as "asc" | "desc") || "asc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const result = await listFbaDaily(storeId, {
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
