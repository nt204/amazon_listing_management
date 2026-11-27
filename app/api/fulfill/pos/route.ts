import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { createFulfillPo, listFulfillPos } from "@/lib/fulfill/db";

export async function GET(req: Request) {
  try {
    await authorizeFulfill(req, "read");
    const { searchParams } = new URL(req.url);

    const storeId = searchParams.get("storeId") || undefined;
    const supplierId = searchParams.get("supplierId") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    const data = await listFulfillPos({ storeId, supplierId, status, search });
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách đợt hàng.");
  }
}

export async function POST(req: Request) {
  try {
    const actor = await authorizeFulfill(req, "write");
    const body = (await readJsonBody(req)) as any;

    if (!body?.po_number || !body?.store_id || !body?.supplier_id || !body?.order_date) {
      return NextResponse.json({ error: "Vui lòng nhập đủ: Mã đợt (PO#), Store, Sup và Ngày yêu cầu." }, { status: 400 });
    }

    if (!body?.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: "Đợt hàng phải có ít nhất 1 sản phẩm (SKU)." }, { status: 400 });
    }

    const poId = await createFulfillPo({
      po_number: body.po_number,
      store_id: body.store_id,
      supplier_id: body.supplier_id,
      order_date: body.order_date,
      target_date: body.target_date || null,
      notes: body.notes || null,
      created_by: actor.displayName || actor.email || actor.userId,
      lines: body.lines,
    });

    return NextResponse.json({ poId, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi tạo đợt hàng mới.");
  }
}
