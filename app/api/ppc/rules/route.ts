// app/api/ppc/rules/route.ts
import { ApiError, authorize, enforceRequestSize, routeErrorResponse } from "@/lib/api-guard";
import {
  getAmazonPpcCommonRuleSet,
  getRuleVersions,
  replaceAmazonPpcCommonRuleSet,
} from "@/lib/ppc/sku-architecture-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    if (new URL(request.url).searchParams.get("download") === "1") {
      const ruleSet = await getAmazonPpcCommonRuleSet();
      return new Response(`${JSON.stringify(ruleSet, null, 2)}\n`, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="amazon_ppc_common_bid_rules.json"',
        },
      });
    }
    const versions = await getRuleVersions();
    return Response.json({ success: true, data: versions });
  } catch (error) {
    return routeErrorResponse(error, "Lỗi khi lấy danh sách Rule PPC.", 500);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "write");
    enforceRequestSize(request, 2_000_000);
    const contentType = request.headers.get("content-type") || "";
    let input: unknown;
    if (contentType.includes("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) throw new ApiError("Vui lòng chọn file JSON rule.", 400);
      if (file.size > 1_000_000) throw new ApiError("File rule vượt quá 1MB.", 413);
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new ApiError("File rule không phải JSON hợp lệ.", 400);
      }
    } else {
      input = await request.json();
    }
    const versions = await replaceAmazonPpcCommonRuleSet(input);
    return Response.json({ success: true, message: "Đã đọc, kiểm tra và áp dụng rule mới.", data: versions });
  } catch (error) {
    return routeErrorResponse(error, "Không thể import rule PPC.", 400);
  }
}
