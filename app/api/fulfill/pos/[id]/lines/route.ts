import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfillManager } from "@/lib/fulfill/authorize";
import { addFulfillPoLine } from "@/lib/fulfill/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorizeFulfillManager(req, "write");
    const { id: poId } = await params;
    const body = (await readJsonBody(req)) as any;

    if (!body?.sku) {
      return NextResponse.json({ error: "Mã SKU là bắt buộc." }, { status: 400 });
    }

    const newLine = await addFulfillPoLine(poId, body);
    return NextResponse.json({ line: newLine, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi thêm dòng sản phẩm.");
  }
}
