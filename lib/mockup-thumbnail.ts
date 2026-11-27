import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { detectRasterImageMimeType } from "@/lib/image-processing";
import { assertTrelloAttachmentUrl, downloadTrelloAttachment } from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

// Ảnh mockup thu nhỏ (WebP) cho bảng: dùng chung cho mockup-proxy nội bộ và trang xưởng /sup.
// Gọi hàm này SAU khi route đã kiểm tra quyền và (với trang xưởng) URL thuộc dòng xưởng được xem.

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

// Chỉ tải ảnh từ các nguồn mockup đã biết (chặn dùng proxy để gọi URL tuỳ ý / mạng nội bộ của máy chủ — SSRF).
const ALLOWED_IMAGE_HOSTS = [
  "media-amazon.com",
  "images-amazon.com",
  "ssl-images-amazon.com",
  "drive.google.com",
  "googleusercontent.com",
  "ncehub.net",
  "r2.dev",
  "r2.cloudflarestorage.com",
  "dropboxusercontent.com",
];

export function isAllowedImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** fetch có kiểm tra tên miền ở mọi lần chuyển hướng (tối đa 3). */
async function fetchAllowedImage(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedImageUrl(current)) throw new UpstreamError("Image source is not allowed", 400);
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    current = new URL(location, current).toString();
  }
  throw new UpstreamError("Too many redirects", 400);
}

export function thumbnailWidth(widthParam: string | null) {
  const parsed = widthParam ? parseInt(widthParam, 10) : NaN;
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(24, parsed)) : 64;
}

/** Trả ảnh thu nhỏ (cache đĩa + gộp request trùng). Lỗi nguồn ảnh ném UpstreamError. */
export async function mockupThumbnailResponse(url: string, targetWidth: number) {
  const trimmedUrl = url.trim();
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
}

export class UpstreamError extends Error {
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

      const upstreamRes = await fetchAllowedImage(fetchUrl);

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
