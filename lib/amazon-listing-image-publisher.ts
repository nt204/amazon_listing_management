import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DataScope } from "@/lib/db";
import { detectRasterImageMimeType } from "@/lib/image-processing";
import { headStoredObject, objectStorageDriver, putStoredObject, r2KeyPrefix } from "@/lib/object-storage";
import { objectExtension } from "@/lib/object-storage-core";
import { downloadTrelloAttachment, type TrelloAttachment } from "@/lib/trello";

function signingSecret() {
  const secret = process.env.AMAZON_LISTING_IMAGE_SIGNING_SECRET?.trim()
    || process.env.LISTING_DESK_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "Cần cấu hình AMAZON_LISTING_IMAGE_SIGNING_SECRET hoặc LISTING_DESK_SESSION_SECRET tối thiểu 32 ký tự.",
    );
  }
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createPublicListingImageToken(objectKey: string) {
  const payload = Buffer.from(objectKey, "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyPublicListingImageToken(token: string) {
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const objectKey = Buffer.from(payload, "base64url").toString("utf8");
    const requiredPrefix = `${r2KeyPrefix()}/public/amazon-listing-images/`;
    return objectKey.startsWith(requiredPrefix) ? objectKey : null;
  } catch {
    return null;
  }
}

export function publicRequestOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  const protocol = forwardedProto || requestUrl.protocol.replace(":", "");
  const origin = host ? `${protocol}://${host}` : requestUrl.origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) {
    throw new Error("URL ảnh Amazon ở production bắt buộc phải dùng HTTPS.");
  }
  return origin.replace(/\/+$/, "");
}

async function publishOne(options: {
  attachment: TrelloAttachment;
  apiKey: string;
  token: string;
  publicOrigin: string;
  signal?: AbortSignal;
}) {
  if (objectStorageDriver() !== "r2") {
    throw new Error("Ảnh Amazon public yêu cầu OBJECT_STORAGE_DRIVER=r2.");
  }
  const bytes = await downloadTrelloAttachment(
    options.attachment.url,
    options.apiKey,
    options.token,
    50_000_000,
    options.signal,
  );
  const mimeType = detectRasterImageMimeType(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `${r2KeyPrefix()}/public/amazon-listing-images/${sha256.slice(0, 2)}/${sha256}.${objectExtension(mimeType)}`;

  if (!await headStoredObject(objectKey)) {
    await putStoredObject({
      key: objectKey,
      bytes,
      contentType: mimeType,
      sha256,
      metadata: { purpose: "amazon-listing-image" },
    });
  }
  const customR2PublicUrl = process.env.R2_PUBLIC_URL?.trim() || process.env.R2_PUBLIC_DEV_URL?.trim();
  if (customR2PublicUrl) {
    return `${customR2PublicUrl.replace(/\/+$/, "")}/${objectKey}`;
  }
  const publicToken = createPublicListingImageToken(objectKey);
  return `${options.publicOrigin}/api/public/listing-images/${encodeURIComponent(publicToken)}`;
}

export async function publishTrelloListingImages(options: {
  scope: DataScope;
  cardId: string;
  attachments: readonly TrelloAttachment[];
  apiKey: string;
  token: string;
  publicOrigin: string;
  signal?: AbortSignal;
}) {
  void options.scope;
  void options.cardId;
  if (options.attachments.length === 0) {
    throw new Error("Thẻ Trello chưa có ảnh hợp lệ để đưa vào file Amazon.");
  }
  return Promise.all(options.attachments.slice(0, 7).map((attachment) => publishOne({
    attachment,
    apiKey: options.apiKey,
    token: options.token,
    publicOrigin: options.publicOrigin,
    signal: options.signal,
  })));
}
