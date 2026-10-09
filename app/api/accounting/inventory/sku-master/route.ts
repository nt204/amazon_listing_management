import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import {
  deleteSkuMasterItem,
  listSkuMaster,
  patchSkuMasterField,
  upsertSkuMasterItem,
} from "@/lib/accounting/inventory-db";

const skuInputSchema = z.object({
  store_id: z.string().uuid("Invalid Store ID"),
  sku: z.string().trim().min(1, "SKU is required"),
  brand: z.string().trim().nullable().optional(),
  product_type: z.string().trim().nullable().optional(),
  mockup: z.string().trim().nullable().optional(),
  asin: z.string().trim().nullable().optional(),
  fnsku: z.string().trim().nullable().optional(),
  amazon_fee: z.number().nullable().optional(),
  referral_fee_pct: z.number().nullable().optional(),
  pic_mkt: z.string().trim().nullable().optional(),
  loai: z.string().trim().nullable().optional(),
  niche: z.string().trim().nullable().optional(),
  pic_idea: z.string().trim().nullable().optional(),
  status: z.string().trim().nullable().optional(),
  event: z.string().trim().nullable().optional(),
  tinh_trang: z.string().trim().nullable().optional(),
  design_pic: z.string().trim().nullable().optional(),
  mockup_url: z.string().trim().nullable().optional(),
  thang_listing: z.string().trim().nullable().optional(),
  thang_danh_gia: z.string().trim().nullable().optional(),
  event_250th: z.string().trim().nullable().optional(),
  ngay_danh_gia_sku_event: z.string().trim().nullable().optional(),
  amazon_fba_fee_thay_doi: z.number().nullable().optional(),
  basecost_tb: z.number().nullable().optional(),
  brand_entity_id: z.string().trim().nullable().optional(),
  creative_asins_video: z.string().trim().nullable().optional(),
  creative_asins_collection: z.string().trim().nullable().optional(),
  video_media_ids: z.string().trim().nullable().optional(),
  creative_headline: z.string().trim().nullable().optional(),
  brand_logo_asset_id: z.string().trim().nullable().optional(),
  landing_page_url: z.string().trim().nullable().optional(),
  custom_fields: z.record(z.string(), z.any()).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }

    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const productType = searchParams.get("product_type") || undefined;
    const cursor = searchParams.get("cursor") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const result = await listSkuMaster(storeId, { search, status, productType, cursor, page, limit });
    return Response.json(result);
  } catch (error) {
    return routeErrorResponse(error, "Failed to load SKU Master.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = await readJsonBody(request, 50_000);
    const parsed = skuInputSchema.parse(body);
    const item = await upsertSkuMasterItem(parsed.store_id, parsed, actor.email || actor.displayName || actor.userId);
    return Response.json({ item });
  } catch (error) {
    return routeErrorResponse(error, "Failed to save SKU Master item.");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 10_000)) as { id?: string; store_id?: string; field?: string; value?: any };
    if (!body?.id || !body?.store_id || !body?.field) {
      return Response.json({ error: "id, store_id, and field are required" }, { status: 400 });
    }
    const item = await patchSkuMasterField(body.store_id, body.id, body.field, body.value, actor.email || actor.displayName || actor.userId);
    return Response.json({ item });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update SKU Master field.");
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const storeId = searchParams.get("store_id");
    if (!id || !storeId) {
      return Response.json({ error: "id and store_id are required" }, { status: 400 });
    }
    const success = await deleteSkuMasterItem(id, storeId, actor.email || actor.displayName || actor.userId);
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete SKU Master item.");
  }
}
