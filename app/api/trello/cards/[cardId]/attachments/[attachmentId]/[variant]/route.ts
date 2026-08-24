import { z } from "zod";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { getTrelloImageDerivative } from "@/lib/db";
import { TRELLO_PREVIEW_DERIVATIVE_VERSION } from "@/lib/image-processing";
import { ensureTrelloImageDerivatives } from "@/lib/trello-image-sync";
import { fetchTrelloCardDetail, selectTrelloImageAttachments } from "@/lib/trello";
import { getUserTrelloServerConfig } from "@/lib/trello-server-config";

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
    let derivative = await getTrelloImageDerivative(
      scope,
      cardId,
      attachmentId,
      variant,
    );
    if (!derivative) {
      const config = await getUserTrelloServerConfig(scope);
      const card = await fetchTrelloCardDetail(
        cardId,
        config.apiKey,
        config.token,
      );
      const configuredListIds = new Set(
        [
          config.listingSourceListId,
          config.listingTargetListId,
          config.mockupSourceListId,
          config.mockupTargetListId,
        ].filter((listId): listId is string => Boolean(listId)),
      );
      if (!configuredListIds.has(card.idList)) {
        throw new ApiError("Thẻ Trello không thuộc cột đã cấu hình.", 404);
      }
      const attachment = selectTrelloImageAttachments(card).find(
        (item) => item.id === attachmentId,
      );
      if (!attachment) {
        throw new ApiError("Không tìm thấy ảnh đính kèm Trello.", 404);
      }

      await ensureTrelloImageDerivatives({
        scope,
        cardId,
        attachment,
        apiKey: config.apiKey,
        token: config.token,
      });
      derivative = await getTrelloImageDerivative(
        scope,
        cardId,
        attachmentId,
        variant,
      );
      if (!derivative) {
        throw new ApiError("Không thể tạo preview ảnh Trello.", 502);
      }
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
