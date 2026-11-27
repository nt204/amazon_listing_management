import { NextResponse } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { UpstreamError, mockupThumbnailResponse, thumbnailWidth } from "@/lib/mockup-thumbnail";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");
    if (!rawUrl || !rawUrl.trim()) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }
    return await mockupThumbnailResponse(rawUrl, thumbnailWidth(searchParams.get("w")));
  } catch (error) {
    if (error instanceof UpstreamError) {
      return new NextResponse(error.message, { status: error.status });
    }
    return routeErrorResponse(error, "Không thể tải ảnh mockup.", 500);
  }
}
