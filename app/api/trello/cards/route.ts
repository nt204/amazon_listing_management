import { NextResponse } from "next/server";
import { authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import { listTrelloImageDerivativeReferences } from "@/lib/db";
import { fetchTrelloCards, fetchTrelloLists, withStoredTrelloImagePreviews, type TrelloCard, type TrelloList } from "@/lib/trello";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const apiKey = searchParams.get("apiKey") || process.env.TRELLO_API_KEY || "";
    const token = searchParams.get("token") || process.env.TRELLO_TOKEN || "";
    const boardId = searchParams.get("boardId") || process.env.TRELLO_BOARD_ID || "";
    const reviewNameQuery = (searchParams.get("internalReviewListName") || process.env.TRELLO_INTERNAL_REVIEW_LIST || "TEAM DUYỆT NỘI BỘ").trim().toLowerCase();
    const listingNameQuery = (searchParams.get("listingListName") || process.env.TRELLO_LISTING_LIST || "Listing").trim().toLowerCase();

    if (!apiKey || !token) {
      return NextResponse.json(
        { error: "Vui lòng cấu hình Trello API Key và Token trước." },
        { status: 400 },
      );
    }

    if (!boardId) {
      return NextResponse.json(
        { error: "Vui lòng chọn hoặc cấu hình Trello Board ID." },
        { status: 400 },
      );
    }

    const lists: TrelloList[] = await fetchTrelloLists(boardId, apiKey, token);
    
    // Find list matching reviewNameQuery (e.g. "TEAM DUYỆT NỘI BỘ")
    let internalReviewList = lists.find(
      (l) => l.name.trim().toLowerCase() === reviewNameQuery || l.name.toLowerCase().includes("duyệt nội bộ"),
    );
    if (!internalReviewList && lists.length > 0) {
      internalReviewList = lists.find((l) => l.name.toLowerCase().includes("to-do") || l.name.toLowerCase().includes("getting started")) || lists[0];
    }

    // Find list matching listingNameQuery (e.g. "Listing")
    let listingList = lists.find(
      (l) => l.name.trim().toLowerCase() === listingNameQuery || l.name.toLowerCase().includes("listing"),
    );
    if (!listingList && lists.length > 1) {
      listingList = lists.find((l) => l.name.toLowerCase().includes("done")) || lists[lists.length - 1];
    }

    let reviewCards: TrelloCard[] = [];
    let listingCards: TrelloCard[] = [];

    if (internalReviewList) {
      reviewCards = await fetchTrelloCards(internalReviewList.id, apiKey, token);
    }

    if (listingList) {
      listingCards = await fetchTrelloCards(listingList.id, apiKey, token);
    }

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
    reviewCards = reviewCards.map((card) => storedPreviewMap.get(card.id) || card);
    listingCards = listingCards.map((card) => storedPreviewMap.get(card.id) || card);

    return NextResponse.json({
      boardId,
      lists,
      internalReviewList: internalReviewList || null,
      listingList: listingList || null,
      reviewCards,
      listingCards,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể tải danh sách thẻ từ Trello.");
  }
}
