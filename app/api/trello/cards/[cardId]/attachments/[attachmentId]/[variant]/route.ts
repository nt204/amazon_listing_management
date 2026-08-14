import { z } from "zod";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getTrelloImageDerivative } from "@/lib/db";
import { TRELLO_PREVIEW_DERIVATIVE_VERSION } from "@/lib/image-processing";

export const runtime = "nodejs";

const paramsSchema = z.object({
  cardId: z.string().min(1),
  attachmentId: z.string().min(1),
  variant: z.enum(["preview", "thumbnail"]),
});

type RouteContext = {
  params: Promise<{
    cardId: string;
    attachmentId: string;
    variant: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { cardId, attachmentId, variant } = paramsSchema.parse(
      await context.params,
    );
    const derivative = await getTrelloImageDerivative(
      scope,
      cardId,
      attachmentId,
      variant,
    );
    if (!derivative) {
      return Response.json(
        { error: "Image preview not found." },
        { status: 404, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const etag = `"${derivative.sha256}-${TRELLO_PREVIEW_DERIVATIVE_VERSION}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }

    return new Response(new Uint8Array(derivative.image_bytes), {
      headers: {
        "Content-Type": derivative.mime_type,
        "Content-Length": String(derivative.image_bytes.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "X-Image-Width": String(derivative.width),
        "X-Image-Height": String(derivative.height),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "Could not load Trello image preview.", 500);
  }
}
