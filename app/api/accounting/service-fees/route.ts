import { NextRequest, NextResponse } from "next/server";
import { listServiceFees, updateServiceFeeCell, deleteServiceFee, deleteServiceFeeBatch } from "@/lib/accounting/service-fees-db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id") || searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const search = searchParams.get("search") || "";
    const dateSort = (searchParams.get("dateSort") as "asc" | "desc") || "desc";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const orderId = searchParams.get("orderId") || undefined;
    const status = searchParams.get("status") || undefined;
    const feeType = searchParams.get("feeType") || undefined;

    const filters: Record<string, string> = {};
    for (const [key, val] of searchParams.entries()) {
      if (key.startsWith("filter_") && val) {
        filters[key.replace("filter_", "")] = val;
      }
    }

    const data = await listServiceFees(storeId, {
      page,
      limit,
      search,
      dateSort,
      startDate,
      endDate,
      orderId,
      status,
      feeType,
      filters,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("GET /api/accounting/service-fees error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load service fee records" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { store_id, id, field, value } = body;
    if (!store_id || !id || !field) {
      return NextResponse.json(
        { error: "Missing store_id, id, or field" },
        { status: 400 }
      );
    }

    await updateServiceFeeCell(store_id, id, field, value);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH /api/accounting/service-fees error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update service fee cell" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const id = searchParams.get("id");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    if (id) {
      await deleteServiceFee(storeId, id);
      return NextResponse.json({ success: true });
    }

    const body = await request.json().catch(() => null);
    if (body && Array.isArray(body.ids) && body.ids.length > 0) {
      const count = await deleteServiceFeeBatch(storeId, body.ids);
      return NextResponse.json({ success: true, count });
    }

    return NextResponse.json({ error: "Missing id or ids array" }, { status: 400 });
  } catch (error: any) {
    console.error("DELETE /api/accounting/service-fees error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete service fee record" },
      { status: 500 }
    );
  }
}
