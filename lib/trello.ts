export interface TrelloConfig {
  apiKey: string;
  token: string;
  boardId?: string;
  internalReviewListName?: string;
  listingListName?: string;
}

export interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  bytes: number;
  isUpload: boolean;
  date?: string;
}

const IMAGE_ATTACHMENT_PATTERN = /\.(png|jpe?g|webp)$/i;

export function isTrelloImageAttachment(attachment: TrelloAttachment) {
  return Boolean(
    attachment.mimeType?.startsWith("image/") ||
      IMAGE_ATTACHMENT_PATTERN.test(attachment.name || "") ||
      IMAGE_ATTACHMENT_PATTERN.test(attachment.url || ""),
  );
}

function attachmentBelongsToCard(attachment: TrelloAttachment, cardId: string) {
  try {
    const url = new URL(attachment.url);
    const cardMatch = url.pathname.match(/\/cards\/([^/]+)\/attachments\//i);
    return !cardMatch || cardMatch[1] === cardId;
  } catch {
    return false;
  }
}

export function selectTrelloImageAttachments(card: Pick<TrelloCard, "id" | "attachments">) {
  return (card.attachments || []).filter(
    (attachment) =>
      attachment.isUpload === true &&
      isTrelloImageAttachment(attachment) &&
      attachmentBelongsToCard(attachment, card.id),
  );
}

const WORKBOOK_ATTACHMENT_PATTERN = /\.(xlsx|xlsm|csv)$/i;

export function selectLatestTrelloWorkbookAttachment(attachments: TrelloAttachment[]) {
  return attachments.reduce<TrelloAttachment | null>((latest, attachment) => {
    if (!WORKBOOK_ATTACHMENT_PATTERN.test(attachment.name || "")) return latest;
    if (!latest) return attachment;
    const latestTime = Date.parse(latest.date || "");
    const attachmentTime = Date.parse(attachment.date || "");
    if (Number.isFinite(latestTime) && Number.isFinite(attachmentTime)) {
      return attachmentTime >= latestTime ? attachment : latest;
    }
    return attachment;
  }, null);
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function filterPublicTrelloImageAttachments(
  attachments: TrelloAttachment[],
  fetchImpl: FetchLike = fetch,
) {
  const checks = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const response = await fetchImpl(attachment.url, {
          method: "GET",
          redirect: "follow",
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        const contentType = response.headers.get("content-type") || "";
        const valid = response.ok && contentType.toLowerCase().startsWith("image/");
        await response.body?.cancel().catch(() => undefined);
        return valid;
      } catch {
        return false;
      }
    }),
  );

  return attachments.filter((_, index) => checks[index]);
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  url: string;
  badges: {
    attachments: number;
  };
  attachments?: TrelloAttachment[];
  parsed?: {
    sku: string;
    itemName: string;
  };
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
}

export function parseTrelloCardTitle(title: string): { sku: string; itemName: string } {
  const trimmed = (title || "").trim();
  if (!trimmed) {
    return { sku: "SKU-UNKNOWN", itemName: "Untitled Product" };
  }

  // Common pattern in product cards: SKU_Item Name or SKU - Item Name
  // e.g. "3CVT0708COW01_Cowgirl 3D Card" -> SKU: "3CVT0708COW01", Item Name: "Cowgirl 3D Card"
  if (trimmed.includes("_")) {
    const parts = trimmed.split("_");
    const sku = parts[0].trim().toUpperCase();
    const itemName = parts.slice(1).join("_").trim() || sku;
    return { sku, itemName };
  }

  if (trimmed.includes(" - ")) {
    const parts = trimmed.split(" - ");
    const sku = parts[0].trim().toUpperCase();
    const itemName = parts.slice(1).join(" - ").trim() || sku;
    return { sku, itemName };
  }

  const matchHyphen = trimmed.match(/^([A-Za-z0-9]+)-(.*)$/);
  if (matchHyphen) {
    const sku = matchHyphen[1].trim().toUpperCase();
    const itemName = matchHyphen[2].trim() || sku;
    return { sku, itemName };
  }

  // Fallback: If no delimiter present
  return {
    sku: trimmed.replace(/[^A-Za-z0-9]/g, "").slice(0, 20).toUpperCase() || "SKU-ITEM",
    itemName: trimmed,
  };
}

export function extractTrelloBoardId(input: string): string {
  const trimmed = (input || "").trim();
  if (!trimmed) return "";

  // If user pasted a full Trello board URL like https://trello.com/b/UaCRcUxZ/test-project or https://trello.com/b/UaCRcUxZ
  const boardUrlMatch = trimmed.match(/trello\.com\/b\/([a-zA-Z0-9]+)/i);
  if (boardUrlMatch) {
    return boardUrlMatch[1];
  }

  // Remove trailing slashes or path parts if any
  return trimmed.split("/").filter(Boolean).pop() || trimmed;
}

export function formatRawTrelloKeywords(rawDesc: string): string {
  if (!rawDesc || !rawDesc.trim()) return "";
  let text = rawDesc.trim();
  const lower = text.toLowerCase();
  if (lower.includes("generic keywords:")) {
    const idx = lower.indexOf("generic keywords:");
    text = text.slice(idx + "generic keywords:".length).trim();
  } else if (lower.includes("generic keywords")) {
    const idx = lower.indexOf("generic keywords");
    text = text.slice(idx + "generic keywords".length).trim();
  }

  // Convert commas, semicolons, newlines, quotes into clean single spaces
  const cleaned = text
    .replace(/[\r\n,;:|"\']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  // Deduplicate words case-insensitively while preserving original order
  const words = cleaned.split(" ").filter(Boolean);
  const uniqueWords: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const wLower = w.toLowerCase();
    if (!seen.has(wLower)) {
      seen.add(wLower);
      uniqueWords.push(w);
    }
  }

  const full = uniqueWords.join(" ");
  if (Buffer.from(full, "utf-8").length <= 249) return full;

  let trimmed = "";
  for (const word of uniqueWords) {
    const candidate = trimmed ? `${trimmed} ${word}` : word;
    if (Buffer.from(candidate, "utf-8").length > 249) break;
    trimmed = candidate;
  }
  return trimmed;
}

const TRELLO_BASE_URL = "https://api.trello.com/1";

function buildUrl(path: string, key: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${TRELLO_BASE_URL}${path}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function fetchTrelloBoards(apiKey: string, token: string): Promise<TrelloBoard[]> {
  const response = await fetch(buildUrl("/members/me/boards", apiKey, token, { fields: "name,url" }), {
    cache: "no-store",
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể lấy danh sách Board từ Trello (${response.status}): ${errText}`);
  }
  return (await response.json()) as TrelloBoard[];
}

export async function fetchTrelloLists(boardId: string, apiKey: string, token: string): Promise<TrelloList[]> {
  const cleanBoardId = extractTrelloBoardId(boardId);
  const response = await fetch(buildUrl(`/boards/${cleanBoardId}/lists`, apiKey, token, { fields: "name,closed" }), {
    cache: "no-store",
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể lấy danh sách Cột từ Board Trello (${response.status}): ${errText}`);
  }
  return (await response.json()) as TrelloList[];
}

export async function fetchTrelloCards(listId: string, apiKey: string, token: string): Promise<TrelloCard[]> {
  const response = await fetch(
    buildUrl(`/lists/${listId}/cards`, apiKey, token, { attachments: "true", attachment_fields: "name,url,mimeType,bytes,isUpload,date" }),
    { cache: "no-store" },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể lấy thẻ Trello trong danh sách (${response.status}): ${errText}`);
  }
  const cards = (await response.json()) as TrelloCard[];
  return cards.map((card) => ({
    ...card,
    parsed: parseTrelloCardTitle(card.name),
  }));
}

export async function fetchTrelloCardDetail(cardId: string, apiKey: string, token: string): Promise<TrelloCard> {
  const response = await fetch(
    buildUrl(`/cards/${cardId}`, apiKey, token, { attachments: "true", attachment_fields: "name,url,mimeType,bytes,isUpload,date" }),
    { cache: "no-store" },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể lấy thông tin thẻ Trello (${response.status}): ${errText}`);
  }
  const card = (await response.json()) as TrelloCard;
  return {
    ...card,
    parsed: parseTrelloCardTitle(card.name),
  };
}

export async function moveTrelloCard(
  cardId: string,
  targetListId: string,
  apiKey: string,
  token: string,
): Promise<TrelloCard> {
  const response = await fetch(buildUrl(`/cards/${cardId}`, apiKey, token), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idList: targetListId }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể chuyển thẻ Trello (${response.status}): ${errText}`);
  }

  return (await response.json()) as TrelloCard;
}

export async function attachFileToTrelloCard(
  cardId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
  token: string,
): Promise<TrelloAttachment> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("name", fileName);

  const url = buildUrl(`/cards/${cardId}/attachments`, apiKey, token);
  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể đính kèm file vào thẻ Trello (${response.status}): ${errText}`);
  }

  return (await response.json()) as TrelloAttachment;
}

export async function downloadTrelloAttachment(url: string, apiKey: string, token: string): Promise<Buffer> {
  const headers: Record<string, string> = {
    Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"`,
    "User-Agent": "Mozilla/5.0 ListingDesk/1.0",
  };

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const fallbackResponse = await fetch(url);
    if (!fallbackResponse.ok) {
      throw new Error(`Không thể tải đính kèm từ Trello HTTP ${response.status}`);
    }
    const arrayBuffer = await fallbackResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
