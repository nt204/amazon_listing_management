import { NextResponse } from "next/server";
import { readJsonBody, routeErrorResponse } from "@/lib/api-guard";
import { authorizeFulfill } from "@/lib/fulfill/authorize";
import { listFulfillSuppliers, upsertFulfillSupplier } from "@/lib/fulfill/db";

export async function GET(req: Request) {
  try {
    await authorizeFulfill(req, "read");
    const suppliers = await listFulfillSuppliers();
    return NextResponse.json({ suppliers });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách xưởng.");
  }
}

export async function POST(req: Request) {
  try {
    await authorizeFulfill(req, "write");
    const body = (await readJsonBody(req)) as any;
    if (!body?.code || !body?.name) {
      return NextResponse.json({ error: "Mã xưởng và tên xưởng là bắt buộc." }, { status: 400 });
    }

    const supplier = await upsertFulfillSupplier(body);
    return NextResponse.json({ supplier, success: true });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lưu thông tin xưởng.");
  }
}
