import { z } from "zod";
import {
  ApiError,
  authorize,
  dataScope,
  routeErrorResponse,
} from "@/lib/api-guard";
import { deleteTrelloImageDerivatives } from "@/lib/db";
import { mockupIndexFromAttachmentName } from "@/lib/mockup-types";
import {
  deleteTrelloCardAttachment,
  fetchTrelloCardDetail,
  selectTrelloImageAttachments,
} from "@/lib/trello";
import { getUserTrelloServerConfig } from "@/lib/trello-server-config";

export const runtime = "nodejs";

const paramsSchema = z.object({
  cardId: z.string().trim().min(1).max(200),
  attachmentId: z.string().trim().min(1).max(200),
});

export async function DELETE(
  request: Request,
  context: { params: Promise<{ cardId: string; attachmentId: string }> },
) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const { cardId, attachmentId } = paramsSchema.parse(await context.params);
    const config = await getUserTrelloServerConfig(scope);
    const card = await fetchTrelloCardDetail(cardId, config.apiKey, config.token);
    const configuredListIds = new Set(
      [config.mockupSourceListId, config.mockupTargetListId].filter(
        (listId): listId is string => Boolean(listId),
      ),
    );
    if (!configuredListIds.has(card.idList)) {
      throw new ApiError("Thẻ Trello không thuộc cột Mockup đã cấu hình.", 404);
    }
    const attachment = selectTrelloImageAttachments(card).find(
      (item) => item.id === attachmentId,
    );
    if (!attachment) {
      throw new ApiError("Không tìm thấy ảnh đính kèm Trello.", 404);
    }
    const mockupIndex = mockupIndexFromAttachmentName(attachment.name);
    if (!mockupIndex || mockupIndex === 1) {
      throw new ApiError(
        "Không thể xóa ảnh thiết kế gốc. Chỉ các mockup do AI tạo mới được xóa tại đây.",
        400,
      );
    }

    await deleteTrelloCardAttachment(
      cardId,
      attachmentId,
      config.apiKey,
      config.token,
    );
    await deleteTrelloImageDerivatives(scope, cardId, [attachmentId]);
    return Response.json({ success: true, attachmentId, mockupIndex });
  } catch (error) {
    return routeErrorResponse(error, "Không thể xóa ảnh mockup khỏi Trello.");
  }
}
