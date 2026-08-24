import { after, NextResponse } from "next/server";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listTrelloImageDerivativeReferences } from "@/lib/db";
import { syncMissingTrelloImageDerivatives } from "@/lib/trello-image-sync";
import { fetchTrelloCards, fetchTrelloLists, withStoredTrelloImagePreviews } from "@/lib/trello";
import { getUserTrelloServerConfig } from "@/lib/trello-server-config";

import { getCachedOrFetch } from "@/lib/redis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const {
      apiKey,
      token,
      boardId,
      listingSourceListId,
      listingTargetListId,
    } = await getUserTrelloServerConfig(scope);

    if (!boardId) {
      return NextResponse.json(
        { error: "Vui lòng chọn hoặc cấu hình Trello Board ID." },
        { status: 400 },
      );
    }
    if (!listingSourceListId || !listingTargetListId) {
      return NextResponse.json(
        { error: "Vui lòng chọn cột đầu và cột đích cho chức năng Listing." },
        { status: 400 },
      );
    }

    const cacheKey = `trello:listing:${boardId}:${listingSourceListId}:${listingTargetListId}:${scope.teamId}:${scope.actorId}`;

    const payload = await getCachedOrFetch(cacheKey, 30, async () => {
      const lists = await fetchTrelloLists(boardId, apiKey, token);
      const internalReviewList = lists.find((list) => list.id === listingSourceListId);
      const listingList = lists.find((list) => list.id === listingTargetListId);
      if (!internalReviewList || !listingList) {
        throw new Error("Cột Listing đã lưu không còn tồn tại trên Trello Board.");
      }

      const [reviewCards, listingCards] = await Promise.all([
        fetchTrelloCards(internalReviewList.id, apiKey, token),
        fetchTrelloCards(listingList.id, apiKey, token),
      ]);

      const allCards = [...reviewCards, ...listingCards];
      const references = await listTrelloImageDerivativeReferences(
        scope,
        allCards.map((card) => card.id),
      );
      const storedPreviewCards = withStoredTrelloImagePreviews(
        allCards,
        references,
      );
      const storedPreviewMap = new Map(
        storedPreviewCards.map((card) => [card.id, card]),
      );

      return {
        lists,
        internalReviewList,
        listingList,
        reviewCards: reviewCards.map((c) => storedPreviewMap.get(c.id) || c),
        listingCards: listingCards.map((c) => storedPreviewMap.get(c.id) || c),
      };
    });

    after(async () => {
      const cards = [...payload.reviewCards, ...payload.listingCards];
      const result = await syncMissingTrelloImageDerivatives({
        scope,
        cards,
        apiKey,
        token,
      }).catch((error) => {
        console.warn(
          "[Trello preview sync] Không thể quét ảnh Listing:",
          error instanceof Error ? error.message : String(error),
        );
        return null;
      });
      if (result?.requested) {
        console.info(
          `[Trello preview sync] Listing: ${result.succeeded}/${result.requested} ảnh đã lưu, ${result.failed} lỗi.`,
        );
      }
    });

    return NextResponse.json(payload);
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách thẻ từ Trello.");
  }
}
