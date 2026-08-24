import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, authorize, dataScope, routeErrorResponse } from "@/lib/api-guard";
import {
  getUserTrelloSettings,
  listTrelloImageDerivativeReferences,
  saveUserTrelloSettings,
} from "@/lib/db";
import {
  extractTrelloBoardId,
  fetchTrelloCards,
  fetchTrelloLists,
  moveTrelloCard,
  withStoredTrelloImagePreviews,
} from "@/lib/trello";
import { getTrelloServerCredentials } from "@/lib/trello-server-config";

export const runtime = "nodejs";

const inspectBoardSchema = z.object({
  action: z.literal("inspect-board"),
  boardId: z.string().trim().min(1, "Board ID hoặc URL Trello Board là bắt buộc"),
}).strict();

const saveListingSettingsSchema = z.object({
  action: z.literal("save-listing-settings"),
  boardId: z.string().trim().min(1),
  listingSourceListId: z.string().trim().min(1),
  listingTargetListId: z.string().trim().min(1),
}).strict();

const saveMockupSettingsSchema = z.object({
  action: z.literal("save-mockup-settings"),
  boardId: z.string().trim().min(1),
  mockupSourceListId: z.string().trim().min(1),
  mockupTargetListId: z.string().trim().min(1),
}).strict();

const moveCardSchema = z.object({
  action: z.literal("move-card"),
  cardId: z.string().trim().min(1),
  idList: z.string().trim().min(1),
  pos: z.union([z.literal("top"), z.literal("bottom"), z.number()]).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const scope = dataScope(authorize(request, "read"));
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const settings = await getUserTrelloSettings(scope);
    const { boardId } = settings;
    const credentialsConfigured = Boolean(
      process.env.TRELLO_API_KEY?.trim() && process.env.TRELLO_TOKEN?.trim(),
    );

    if (!action) {
      return NextResponse.json({
        configured: credentialsConfigured,
        ...settings,
      });
    }

    const { apiKey, token } = getTrelloServerCredentials();
    if (!boardId) {
      throw new ApiError("Vui lòng lưu Board ID hoặc URL Trello Board trước.", 400);
    }
    const lists = await fetchTrelloLists(boardId, apiKey, token);

    if (action === "get-lists") return NextResponse.json({ lists });

    if (action === "get-cards") {
      const listId = searchParams.get("listId")?.trim() || "";
      if (!listId || !lists.some((list) => list.id === listId)) {
        throw new ApiError("List ID không thuộc Trello Board đã lưu.", 400);
      }
      const cards = await fetchTrelloCards(listId, apiKey, token);
      const references = await listTrelloImageDerivativeReferences(
        scope,
        cards.map((card) => card.id),
      );
      return NextResponse.json({ cards: withStoredTrelloImagePreviews(cards, references) });
    }

    throw new ApiError("Thao tác Trello không hợp lệ.", 400);
  } catch (error) {
    return routeErrorResponse(error, "Không thể lấy thông tin Trello.");
  }
}

export async function POST(request: Request) {
  try {
    const scope = dataScope(authorize(request, "write"));
    const body = await request.json();
    const { apiKey, token } = getTrelloServerCredentials();

    if (body?.action === "move-card") {
      const input = moveCardSchema.parse(body);
      const { boardId } = await getUserTrelloSettings(scope);
      if (!boardId) throw new ApiError("Vui lòng lưu Trello Board trước.", 400);
      const lists = await fetchTrelloLists(boardId, apiKey, token);
      if (!lists.some((list) => list.id === input.idList)) {
        throw new ApiError("Cột đích không thuộc Trello Board đã lưu.", 400);
      }
      const updatedCard = await moveTrelloCard(
        input.cardId,
        input.idList,
        apiKey,
        token,
        input.pos || "top",
      );
      return NextResponse.json({ success: true, card: updatedCard });
    }

    if (body?.action === "inspect-board") {
      const input = inspectBoardSchema.parse(body);
      const boardId = extractTrelloBoardId(input.boardId);
      if (!boardId) throw new ApiError("Board ID hoặc URL Trello Board không hợp lệ.", 400);
      const lists = await fetchTrelloLists(boardId, apiKey, token);
      return NextResponse.json({ success: true, boardId, lists });
    }

    let boardIdInput = "";
    let sourceListId = "";
    let targetListId = "";
    let workflow: "listing" | "mockup";

    if (body?.action === "save-listing-settings") {
      const input = saveListingSettingsSchema.parse(body);
      boardIdInput = input.boardId;
      sourceListId = input.listingSourceListId;
      targetListId = input.listingTargetListId;
      workflow = "listing";
    } else if (body?.action === "save-mockup-settings") {
      const input = saveMockupSettingsSchema.parse(body);
      boardIdInput = input.boardId;
      sourceListId = input.mockupSourceListId;
      targetListId = input.mockupTargetListId;
      workflow = "mockup";
    } else {
      throw new ApiError("Thao tác Trello không hợp lệ.", 400);
    }

    const boardId = extractTrelloBoardId(boardIdInput);
    if (!boardId) throw new ApiError("Board ID hoặc URL Trello Board không hợp lệ.", 400);
    const lists = await fetchTrelloLists(boardId, apiKey, token);
    const boardListIds = new Set(lists.map((list) => list.id));
    const selectedListIds = [sourceListId, targetListId];
    if (selectedListIds[0] === selectedListIds[1]) {
      throw new ApiError("Cột đầu và cột đích phải khác nhau.", 400);
    }
    if (!selectedListIds.every((listId) => boardListIds.has(listId))) {
      throw new ApiError("Một hoặc nhiều cột đã chọn không thuộc Trello Board này.", 400);
    }
    const existing = await getUserTrelloSettings(scope);
    const baseSettings = existing.boardId && existing.boardId !== boardId
      ? {
          boardId,
          listingSourceListId: "",
          listingTargetListId: "",
          mockupSourceListId: "",
          mockupTargetListId: "",
        }
      : { ...existing, boardId };
    const settings = {
      ...baseSettings,
      ...(workflow === "listing"
        ? {
            listingSourceListId: sourceListId,
            listingTargetListId: targetListId,
          }
        : {
            mockupSourceListId: sourceListId,
            mockupTargetListId: targetListId,
          }),
    };
    await saveUserTrelloSettings(scope, settings);
    return NextResponse.json({ success: true, ...settings, lists });
  } catch (error) {
    return routeErrorResponse(error, "Không thể kiểm tra hoặc lưu Trello Board.");
  }
}
