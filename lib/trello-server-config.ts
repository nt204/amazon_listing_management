import "server-only";

import { ApiError } from "@/lib/api-guard";
import { getUserTrelloSettings, type DataScope } from "@/lib/db";

export function getTrelloServerCredentials() {
  const apiKey = process.env.TRELLO_API_KEY?.trim() || "";
  const token = process.env.TRELLO_TOKEN?.trim() || "";
  if (!apiKey || !token) {
    throw new ApiError(
      "Trello API Key và Token chưa được cấu hình trên server.",
      503,
    );
  }
  return { apiKey, token };
}

export async function getUserTrelloServerConfig(scope: DataScope) {
  return {
    ...getTrelloServerCredentials(),
    ...await getUserTrelloSettings(scope),
  };
}
