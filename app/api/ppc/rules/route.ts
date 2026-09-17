// app/api/ppc/rules/route.ts
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { getRuleVersions } from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const versions = await getRuleVersions();
    return Response.json({ success: true, data: versions });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Rule PPC.", 500);
  }
}
