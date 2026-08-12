import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, routeErrorResponse } from "@/lib/api-guard";
import { fetchTrelloBoards, fetchTrelloLists } from "@/lib/trello";

export const runtime = "nodejs";

const verifySchema = z.object({
  apiKey: z.string().min(1, "API Key là bắt buộc"),
  token: z.string().min(1, "Token là bắt buộc"),
  boardId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    authorize(request, "read");
    const apiKey = process.env.TRELLO_API_KEY || "";
    const token = process.env.TRELLO_TOKEN || "";
    const boardId = process.env.TRELLO_BOARD_ID || "";
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
    return routeErrorResponse(error, "Không thể lấy cấu hình Trello.");
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, "read");
    const body = await request.json();
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
