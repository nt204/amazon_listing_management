import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { fetchTrelloBoards, fetchTrelloLists, fetchTrelloCards, moveTrelloCard } from "@/lib/trello";

export const runtime = "nodejs";

const verifySchema = z.object({
  apiKey: z.string().min(1, "API Key là bắt buộc"),
  token: z.string().min(1, "Token là bắt buộc"),
  boardId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    const apiKey = searchParams.get("apiKey") || process.env.TRELLO_API_KEY || "";
    const token = searchParams.get("token") || process.env.TRELLO_TOKEN || "";
    const boardId = searchParams.get("boardId") || process.env.TRELLO_BOARD_ID || "";
    const listId = searchParams.get("listId") || "";

    if (action === "get-lists") {
      if (!apiKey || !token || !boardId) {
        return NextResponse.json(
          { error: "Vui lòng cung cấp Trello API Key, Token và Board ID" },
          { status: 400 },
        );
      }
      const lists = await fetchTrelloLists(boardId, apiKey, token);
      return NextResponse.json({ lists });
    }

    if (action === "get-cards") {
      if (!apiKey || !token || !listId) {
        return NextResponse.json(
          { error: "Vui lòng cung cấp Trello API Key, Token và List ID" },
          { status: 400 },
        );
      }
      const cards = await fetchTrelloCards(listId, apiKey, token);
      return NextResponse.json({ cards });
    }

    const internalReviewListName = process.env.TRELLO_INTERNAL_REVIEW_LIST || "TEAM DUYỆT NỘI BỘ";
    const listingListName = process.env.TRELLO_LISTING_LIST || "Listing";

    return NextResponse.json({
      configured: Boolean(apiKey && token),
      apiKey: apiKey ? `${apiKey.slice(0, 6)}...` : "",
      token: token ? `${token.slice(0, 6)}...` : "",
      rawApiKey: apiKey,
      rawToken: token,
      boardId,
      internalReviewListName,
      listingListName,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể lấy thông tin Trello.");
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "read");
    const body = await request.json();

    if (body.action === "move-card") {
      const { cardId, idList, apiKey, token } = body;
      if (!cardId || !idList || !apiKey || !token) {
        return NextResponse.json(
          { error: "Thiếu thông tin cardId, idList, apiKey hoặc token" },
          { status: 400 },
        );
      }
      const updatedCard = await moveTrelloCard(cardId, idList, apiKey, token);
      return NextResponse.json({ success: true, card: updatedCard });
    }

    const { apiKey, token, boardId } = verifySchema.parse(body);

    const boards = await fetchTrelloBoards(apiKey, token);
    let lists: Array<{ id: string; name: string; closed: boolean }> = [];
    if (boardId) {
      lists = await fetchTrelloLists(boardId, apiKey, token);
    }

    return NextResponse.json({
      success: true,
      boards,
      lists,
    });
  } catch (error) {
    return routeErrorResponse(error, "Không thể kiểm tra hoặc lấy dữ liệu Trello.");
  }
}
