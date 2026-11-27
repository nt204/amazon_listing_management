import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { deleteFulfillPo, getFulfillPoById, patchFulfillPo } from "@/lib/fulfill/db";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorizeFulfill(req, "read");
    const { id } = await params;

    const data = await getFulfillPoById(id);
    if (!data) {
      return NextResponse.json({ error: "Không tìm thấy đợt hàng." }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải chi tiết đợt hàng.");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorizeFulfill(req, "write");
    const { id } = await params;
    const body = (await readJsonBody(req)) as any;

    await patchFulfillPo(id, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật đợt hàng.");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorizeFulfill(req, "write");
    const { id } = await params;

    await deleteFulfillPo(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa đợt hàng.");
  }
}
