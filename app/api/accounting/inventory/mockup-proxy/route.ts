import { NextResponse } from "next/server";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { detectRasterImageMimeType } from "@/lib/image-processing";
import {
  assertTrelloAttachmentUrl,
  downloadTrelloAttachment,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

import sharp from "sharp";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");
    const widthParam = searchParams.get("w");
    const targetWidth = widthParam ? Math.min(1000, Math.max(24, parseInt(widthParam, 10))) : 64;

    if (!rawUrl || !rawUrl.trim()) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    const trimmedUrl = rawUrl.trim();
    let originalBuffer: Buffer | null = null;
    let mimeType = "image/jpeg";

    // 1. Trello Attachments (require server credentials to bypass 403)
    if (trimmedUrl.includes("trello.com")) {
      const trustedUrl = assertTrelloAttachmentUrl(trimmedUrl);
      const { apiKey, token } = getTrelloServerCredentials();
      const bytes = await downloadTrelloAttachment(trustedUrl, apiKey, token, 35_000_000);
      originalBuffer = Buffer.from(bytes);
      mimeType = detectRasterImageMimeType(bytes);
    } else {
      // 2. Google Drive Images & other external URLs (R2, S3, CDN...)
      let fetchUrl = trimmedUrl;
      const driveMatch = trimmedUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
      const driveIdMatch = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      const driveId = driveMatch?.[1] || (trimmedUrl.includes("drive.google.com") ? driveIdMatch?.[1] : null);

      if (driveId) {
        fetchUrl = `https://drive.google.com/thumbnail?id=${driveId}&sz=w${targetWidth * 2}`;
      }

      const upstreamRes = await fetch(fetchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!upstreamRes.ok) {
        return new NextResponse(`Upstream failed: ${upstreamRes.status}`, { status: upstreamRes.status });
      }

      mimeType = upstreamRes.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await upstreamRes.arrayBuffer();
      originalBuffer = Buffer.from(arrayBuffer);
    }

    if (!originalBuffer || originalBuffer.length === 0) {
      return new NextResponse("Empty image buffer", { status: 404 });
    }

    // Ultra-lightweight WebP thumbnail: ~1-3KB per image for 0ms network impact
    let outputBuffer: Buffer;
    let outputMime = "image/webp";

    try {
      outputBuffer = await sharp(originalBuffer)
        .resize({ width: targetWidth, height: targetWidth, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 55, effort: 2 })
        .toBuffer();
    } catch {
      // Fallback if format is not supported by Sharp
      outputBuffer = originalBuffer;
      outputMime = mimeType;
    }

    return new Response(new Uint8Array(outputBuffer), {
      headers: {
        "Content-Type": outputMime,
        "Content-Length": String(outputBuffer.length),
        "Cache-Control": "public, max-age=31536000, immutable", // Cache 1 year
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải ảnh mockup.", 500);
  }
}
