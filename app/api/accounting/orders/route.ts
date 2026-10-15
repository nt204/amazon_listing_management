import { NextRequest, NextResponse } from "next/server";
import { listOrders, updateOrderCell, deleteOrder } from "@/lib/accounting/orders-db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    if (!storeId) {
      return NextResponse.json({ error: "Missing store_id" }, { status: 400 });
    }

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const search = searchParams.get("search") || "";
    const dateSort = (searchParams.get("dateSort") as "asc" | "desc") || "desc";

    // Collect column filters
    const filters: Record<string, string> = {};
    for (const [key, val] of searchParams.entries()) {
      if (key.startsWith("filter_") && val) {
        filters[key.replace("filter_", "")] = val;
      }
    }

    const data = await listOrders(storeId, {
      page,
      limit,
      search,
      dateSort,
      filters,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("GET /api/accounting/orders error:", error);
    return NextResponse.json({ error: error.message || "Failed to load orders" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { store_id, id, field, value } = body;
    if (!store_id || !id || !field) {
      return NextResponse.json({ error: "Missing store_id, id, or field" }, { status: 400 });
    }

    await updateOrderCell(store_id, id, field, value);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("PATCH /api/accounting/orders error:", error);
    return NextResponse.json({ error: error.message || "Failed to update order cell" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");
    const id = searchParams.get("id");
    if (!storeId || !id) {
      return NextResponse.json({ error: "Missing store_id or id" }, { status: 400 });
    }

    await deleteOrder(storeId, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/accounting/orders error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete order" }, { status: 500 });
  }
}
