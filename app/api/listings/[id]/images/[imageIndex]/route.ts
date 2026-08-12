import { getListingImage } from "@/lib/db";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { IMAGE_DERIVATIVE_VERSION } from "@/lib/image-processing";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; imageIndex: string }>;
};

function contentDisposition(disposition: "inline" | "attachment", name: string) {
  const safeAscii =
    name
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 150) || "product-image";
  return `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { id, imageIndex: rawImageIndex } = await params;
    const imageIndex = Number(rawImageIndex);
    if (!Number.isInteger(imageIndex) || imageIndex < 0) {
      return Response.json({ error: "Image index is invalid." }, { status: 400 });
    }

    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "1";
    const variant = download || url.searchParams.get("variant") !== "preview"
      ? "original"
      : "preview";
    const image = await getListingImage(scope, id, imageIndex, variant);
    if (!image) return Response.json({ error: "Image not found." }, { status: 404 });

    const etag = `"${image.sha256}-${variant}-${IMAGE_DERIVATIVE_VERSION}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag },
      });
    }

    return new Response(new Uint8Array(image.image_bytes), {
      headers: {
        "Content-Type": image.mime_type,
        "Content-Length": String(image.image_bytes.byteLength),
        "Content-Disposition": contentDisposition(
          download ? "attachment" : "inline",
          image.name,
        ),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not load listing image.", 500);
  }
}
