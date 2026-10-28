import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { listSkuWin, updateSkuWinCustomFields } from "@/lib/accounting/sku-win-db";
import { listFbmSkuFixed, updateFbmSkuCustomFields } from "@/lib/accounting/fbm-financials-db";

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
    const compareStartDate = searchParams.get("compare_start_date") || undefined;
    const compareEndDate = searchParams.get("compare_end_date") || undefined;
    const search = searchParams.get("search") || undefined;
    const productType = searchParams.get("product_type") || undefined;
    const status = searchParams.get("status") || undefined;
    const skuType = (searchParams.get("sku_type") as "all" | "win" | "loss" | "ordered") || "all";
    const sortField = searchParams.get("sort_field") || "profit";
    const sortDirection = (searchParams.get("sort_dir") as "asc" | "desc") || "desc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    // channel=fbm: tab FBM cố định (sheet "LỌC SKU CỐ ĐỊNH" của file FBM, mọi SKU trong BẢNG MÃ FBM)
    const list = searchParams.get("channel") === "fbm" ? listFbmSkuFixed : listSkuWin;
    const result = await list(storeId, {
      startDate,
      endDate,
      compareStartDate,
      compareEndDate,
      search,
      productType,
      status,
      skuType,
      sortField,
      sortDirection,
      page,
      limit,
    });

    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Failed to load SKU Win data.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    await authorize(request, "write", "accounting");
    const body = await readJsonBody(request, 10_000) as {
      store_id?: string;
      id?: string;
      channel?: string;
      price?: number | null;
      targets?: {
        revenue?: number | null;
        unit?: number | null;
        spend?: number | null;
        profit?: number | null;
      };
    };

    if (!body?.store_id || !body?.id) {
      return Response.json({ error: "store_id and id are required" }, { status: 400 });
    }

    const update = body.channel === "fbm" ? updateFbmSkuCustomFields : updateSkuWinCustomFields;
    const customFields = await update(body.store_id, body.id, {
      price: body.price,
      targets: body.targets,
    });

    return Response.json({ success: true, customFields });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update SKU Win targets / price.", 500);
  }
}
