import { getStoredObject } from "@/lib/object-storage";
import { verifyPublicListingImageToken } from "@/lib/amazon-listing-image-publisher";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const objectKey = verifyPublicListingImageToken(token);
  if (!objectKey) return new Response("Not found", { status: 404 });

  const customR2PublicUrl = process.env.R2_PUBLIC_URL?.trim() || process.env.R2_PUBLIC_DEV_URL?.trim();
  if (customR2PublicUrl) {
    return Response.redirect(`${customR2PublicUrl.replace(/\/+$/, "")}/${objectKey}`, 302);
  }

  const stored = await getStoredObject(objectKey);
  if (!stored) return new Response("Not found", { status: 404 });
  const etag = stored.etag || `"${stored.metadata.sha256 || token.slice(-24)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  return new Response(new Uint8Array(stored.bytes), {
    headers: {
      "Content-Type": stored.contentType || "application/octet-stream",
      "Content-Length": String(stored.contentLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    },
  });
}
