import { NextResponse } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { detectRasterImageMimeType } from "@/lib/image-processing";
import {
  assertTrelloAttachmentUrl,
  downloadTrelloAttachment,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");

    if (!rawUrl || !rawUrl.trim()) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    const trimmedUrl = rawUrl.trim();

    // 1. Trello Attachments (require server credentials to bypass 403)
    if (trimmedUrl.includes("trello.com")) {
      const trustedUrl = assertTrelloAttachmentUrl(trimmedUrl);
      const { apiKey, token } = getTrelloServerCredentials();
      const bytes = await downloadTrelloAttachment(trustedUrl, apiKey, token, 35_000_000);
      const mimeType = detectRasterImageMimeType(bytes);

      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "public, max-age=604800, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // 2. Google Drive Images
    let fetchUrl = trimmedUrl;
    const driveMatch = trimmedUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    const driveIdMatch = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const driveId = driveMatch?.[1] || (trimmedUrl.includes("drive.google.com") ? driveIdMatch?.[1] : null);

    if (driveId) {
      fetchUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
    }

    // 3. Other external image URLs
    const upstreamRes = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!upstreamRes.ok) {
      return new NextResponse(`Upstream failed: ${upstreamRes.status}`, { status: upstreamRes.status });
    }

    const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await upstreamRes.arrayBuffer();

    return new Response(new Uint8Array(arrayBuffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải ảnh mockup.", 500);
  }
}
