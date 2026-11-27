import { NextResponse } from "next/server";
import { authorize, readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { addFulfillPoLine } from "@/lib/fulfill/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(req, "write", "accounting");
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
