import { z } from "zod";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { requireStoreAccess } from "@/lib/accounting/access";
import {
  applyMonthlyBaseCostToSkuMaster,
  deleteMonthlyBaseCostItem,
  getYearlyBaseCostMatrix,
  listMonthlyBaseCostPeriods,
  listMonthlyBaseCosts,
  syncMonthlyBaseCostFromInbound,
  syncYearlyBaseCostFromInbound,
  updateMonthlyBaseCostField,
  updateYearlyInitialValues,
  updateYearlyMonthBaseCost,
  updateYearlyMonthSlTon,
  upsertMonthlyBaseCostItem,
} from "@/lib/accounting/inventory-db";

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  store_id: z.string().uuid("Invalid Store ID"),
  period: z.string().trim().min(7, "Period YYYY-MM is required"),
  sku: z.string().trim().min(1, "SKU is required"),
  sku_id: z.string().uuid().nullable().optional(),
  brand: z.string().trim().nullable().optional(),
  product_type: z.string().trim().nullable().optional(),
  sl_ton_dau_ky: z.coerce.number().min(0).default(0),
  basecost_dau_ky: z.coerce.number().min(0).default(0),
  sl_nhap: z.coerce.number().min(0).default(0),
  gtri_nhap: z.coerce.number().min(0).default(0),
  basecost_thang: z.coerce.number().min(0).optional(),
  is_overridden: z.boolean().optional(),
  note: z.string().trim().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return Response.json({ error: "store_id is required" }, { status: 400 });
    }
    await requireStoreAccess(actor, storeId, "FBA");

    const action = searchParams.get("action");
    if (action === "periods") {
      const periods = await listMonthlyBaseCostPeriods(storeId);
      return Response.json({ periods });
    }

    const yearParam = searchParams.get("year");
    const search = searchParams.get("search") || undefined;

    // Chế độ xem ma trận 12 tháng theo năm (Bố cục như file Excel / Google Sheets)
    if (yearParam || searchParams.get("mode") === "yearly") {
      const year = Number(yearParam) || new Date().getFullYear();
      const matrix = await getYearlyBaseCostMatrix(storeId, year, search);
      return Response.json({
        mode: "yearly",
        year,
        rows: matrix.rows,
        count: matrix.rows.length,
      });
    }

    let period = searchParams.get("period");
    if (!period) {
      const periods = await listMonthlyBaseCostPeriods(storeId);
      period = periods[0] || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    }

    const items = await listMonthlyBaseCosts(storeId, period, search);
    const periods = await listMonthlyBaseCostPeriods(storeId);

    return Response.json({
      period,
      periods,
      items,
      count: items.length,
    });
  } catch (error) {
    return routeErrorResponse(error, "Failed to load Monthly Base Cost.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 50_000)) as any;
    const actorName = actor.email || actor.displayName || actor.userId || "system";

    if (body?.store_id) await requireStoreAccess(actor, body.store_id, "FBA", "write");
    if (body?.action === "sync_year") {
      if (!body?.store_id) {
        return Response.json({ error: "store_id is required" }, { status: 400 });
      }
      const year = Number(body.year) || new Date().getFullYear();
      const res = await syncYearlyBaseCostFromInbound(body.store_id, year, actorName);
      return Response.json({ success: true, ...res });
    }

    if (body?.action === "update_yearly_initial") {
      if (!body?.store_id || !body?.sku) {
        return Response.json({ error: "store_id and sku are required" }, { status: 400 });
      }
      const year = Number(body.year) || new Date().getFullYear();
      await updateYearlyInitialValues(
        body.store_id,
        year,
        body.sku,
        { hang_ton: body.hang_ton, gia_von: body.gia_von },
        actorName,
      );
      return Response.json({ success: true });
    }

    if (body?.action === "update_yearly_month_cost") {
      if (!body?.store_id || !body?.sku || body?.month == null) {
        return Response.json({ error: "store_id, sku, month are required" }, { status: 400 });
      }
      const year = Number(body.year) || new Date().getFullYear();
      await updateYearlyMonthBaseCost(
        body.store_id,
        year,
        Number(body.month),
        body.sku,
        Number(body.basecost) || 0,
        actorName,
      );
      return Response.json({ success: true });
    }

    if (body?.action === "update_monthly_sl_ton") {
      if (!body?.store_id || !body?.sku || body?.month == null) {
        return Response.json({ error: "store_id, sku, month are required" }, { status: 400 });
      }
      const year = Number(body.year) || new Date().getFullYear();
      await updateYearlyMonthSlTon(
        body.store_id,
        year,
        Number(body.month),
        body.sku,
        Math.max(0, Number(body.sl_ton) || 0),
        actorName,
      );
      return Response.json({ success: true });
    }

    if (body?.action === "sync_inbound") {
      if (!body?.store_id || !body?.period) {
        return Response.json({ error: "store_id and period are required for sync" }, { status: 400 });
      }
      const res = await syncMonthlyBaseCostFromInbound(body.store_id, body.period, actorName);
      return Response.json({ success: true, ...res });
    }

    if (body?.action === "apply_to_sku_master") {
      if (!body?.store_id || !body?.period) {
        return Response.json({ error: "store_id and period are required" }, { status: 400 });
      }
      const res = await applyMonthlyBaseCostToSkuMaster(body.store_id, body.period, actorName);
      return Response.json({ success: true, ...res });
    }

    const parsed = upsertSchema.parse(body);
    const saved = await upsertMonthlyBaseCostItem(parsed.store_id, parsed, actorName);
    return Response.json({ success: true, item: saved });
  } catch (error) {
    return routeErrorResponse(error, "Failed to process Monthly Base Cost.", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const body = (await readJsonBody(request, 10_000)) as any;
    const actorName = actor.email || actor.displayName || actor.userId || "system";

    if (!body?.store_id || !body?.id || !body?.field) {
      return Response.json({ error: "store_id, id, and field are required" }, { status: 400 });
    }

    await requireStoreAccess(actor, body.store_id, "FBA", "write");
    const updated = await updateMonthlyBaseCostField(
      body.store_id,
      body.id,
      body.field,
      body.value,
      actorName,
    );
    return Response.json({ success: true, item: updated });
  } catch (error) {
    return routeErrorResponse(error, "Failed to update field.", 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authorize(request, "write", "accounting");
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const id = searchParams.get("id");
    const actorName = actor.email || actor.displayName || actor.userId || "system";

    if (!storeId || !id) {
      return Response.json({ error: "store_id and id are required" }, { status: 400 });
    }

    await requireStoreAccess(actor, storeId, "FBA", "write");
    const success = await deleteMonthlyBaseCostItem(storeId, id, actorName);
    return Response.json({ success });
  } catch (error) {
    return routeErrorResponse(error, "Failed to delete item.", 500);
  }
}
