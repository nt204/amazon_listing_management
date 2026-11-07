import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

// Ảnh đã thu nhỏ lưu trên đĩa theo URL + chiều rộng: trước đây mỗi lần trình duyệt chưa có cache là tải lại nguyên
// ảnh gốc (Trello tới 35 MB) rồi sharp lại — một bảng vài chục SKU = vài chục lượt tải ảnh gốc cùng lúc.
const CACHE_DIR = process.env.MOCKUP_THUMB_CACHE_DIR || path.join(os.tmpdir(), "mockup-thumb-cache");
const inFlight = new Map<string, Promise<{ body: Buffer; mime: string }>>();

function cachePaths(url: string, width: number) {
  const hash = createHash("sha256").update(`${width}|${url}`).digest("hex");
  const dir = path.join(CACHE_DIR, hash.slice(0, 2));
  return { dir, file: path.join(dir, `${hash}.webp`) };
}

function imageResponse(body: Buffer, mime: string, cacheStatus: string) {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable", // Cache 1 year
      "X-Content-Type-Options": "nosniff",
      "X-Thumb-Cache": cacheStatus,
    },
  });
}

export async function GET(request: Request) {
  try {
    await authorize(request, "read", "accounting");
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");
    const widthParam = searchParams.get("w");
    const parsedWidth = widthParam ? parseInt(widthParam, 10) : NaN;
    const targetWidth = Number.isFinite(parsedWidth) ? Math.min(1000, Math.max(24, parsedWidth)) : 64;

    if (!rawUrl || !rawUrl.trim()) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    const trimmedUrl = rawUrl.trim();
    const { dir, file } = cachePaths(trimmedUrl, targetWidth);
    const cached = await readFile(file).catch(() => null);
    if (cached) return imageResponse(cached, "image/webp", "HIT");

    const key = file;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = buildThumbnail(trimmedUrl, targetWidth, dir, file).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const { body, mime } = await pending;
    return imageResponse(body, mime, "MISS");
  } catch (error) {
    if (error instanceof UpstreamError) {
      return new NextResponse(error.message, { status: error.status });
    }
    return routeErrorResponse(error, "Không thể tải ảnh mockup.", 500);
  }
}

class UpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function buildThumbnail(
  trimmedUrl: string,
  targetWidth: number,
  dir: string,
  file: string,
): Promise<{ body: Buffer; mime: string }> {
  {
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
        throw new UpstreamError(`Upstream failed: ${upstreamRes.status}`, upstreamRes.status);
      }

      mimeType = upstreamRes.headers.get("content-type") || "image/jpeg";
      const arrayBuffer = await upstreamRes.arrayBuffer();
      originalBuffer = Buffer.from(arrayBuffer);
    }

    if (!originalBuffer || originalBuffer.length === 0) {
      throw new UpstreamError("Empty image buffer", 404);
    }

    // Ultra-lightweight WebP thumbnail: ~1-3KB per image for 0ms network impact
    let outputBuffer: Buffer;
    const outputMime = "image/webp";

    try {
      outputBuffer = await sharp(originalBuffer)
        .resize({ width: targetWidth, height: targetWidth, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 55, effort: 2 })
        .toBuffer();
    } catch {
      // Fallback if format is not supported by Sharp — không lưu cache (ảnh gốc, có thể rất lớn)
      return { body: originalBuffer, mime: mimeType };
    }

    // Ghi file tạm rồi rename: request khác không đọc phải file đang ghi dở. Lỗi ghi cache không làm hỏng ảnh trả về.
    try {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, outputBuffer);
      await rename(tmp, file);
    } catch {
      // bỏ qua
    }
    return { body: outputBuffer, mime: outputMime };
  }
}
