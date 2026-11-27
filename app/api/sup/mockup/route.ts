import { NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/api-guard";
import { supLineMockup, requireSupAccount } from "@/lib/fulfill/sup-db";
import { UpstreamError, mockupThumbnailResponse, thumbnailWidth } from "@/lib/mockup-thumbnail";

export const runtime = "nodejs";

/** Ảnh mockup cho trang xưởng: chỉ theo id dòng thuộc xưởng đang đăng nhập — không nhận URL tuỳ ý. */
export async function GET(req: Request) {
  try {
    const account = await requireSupAccount(req);
    const { searchParams } = new URL(req.url);
    const url = await supLineMockup(account, searchParams.get("line") ?? "");
    if (!url) return new NextResponse("Not found", { status: 404 });
    const response = await mockupThumbnailResponse(url, thumbnailWidth(searchParams.get("w")));
    response.headers.set("Cache-Control", "private, max-age=86400");
    return response;
  } catch (error) {
    if (error instanceof UpstreamError) return new NextResponse(error.message, { status: error.status });
    return routeErrorResponse(error, "Could not load the image.", 500);
  }
}
