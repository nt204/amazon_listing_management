import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { channelParam, requireStoreAccess } from "@/lib/accounting/access";
import { getSkuUnitTrends } from "@/lib/accounting/sku-trend-db";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Units theo ngày của các SKU đang hiển thị (cột Trend của SKU Win / SKU Test / FBM cố định). */
export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const startDate = searchParams.get("start_date") || "";
    const endDate = searchParams.get("end_date") || "";
    if (!storeId || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return Response.json({ error: "store_id, start_date, end_date là bắt buộc" }, { status: 400 });
    }
    const channel = channelParam(searchParams.get("channel"));
    await requireStoreAccess(actor, storeId, channel);
    const skus = (searchParams.get("skus") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
    return Response.json(
      await getSkuUnitTrends(storeId, channel === "FBM" ? "fbm" : "fba", startDate, endDate, skus),
    );
  } catch (error) {
    return routeErrorResponse(error, "Không tải được trend SKU.", 500);
  }
}
