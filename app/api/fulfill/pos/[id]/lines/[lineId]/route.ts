import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfillManager } from "@/lib/fulfill/authorize";
import { deleteFulfillPoLine, patchFulfillPoLine } from "@/lib/fulfill/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    await authorizeFulfillManager(req, "write");
    const { lineId } = await params;
    const body = (await readJsonBody(req)) as any;

    if (!body?.field) {
      return NextResponse.json({ error: "Thiếu tên trường cần cập nhật (field)." }, { status: 400 });
    }

    await patchFulfillPoLine(lineId, body.field, body.value);
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi cập nhật ô dữ liệu.");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    await authorizeFulfillManager(req, "write");
    const { lineId } = await params;

    await deleteFulfillPoLine(lineId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi xóa dòng sản phẩm.");
  }
}
