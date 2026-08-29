import { sortMockupAttachments } from "./mockup-types";

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
  previewUrl?: string;
  thumbnailUrl?: string;
  previews?: Array<{
    url: string;
    width: number;
    height: number;
    bytes?: number;
    scaled?: boolean;
  }>;
}

export function isTrelloRequestTimeoutError(error: unknown) {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    name === "timeouterror" ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("aborted due to timeout")
  );
}

/**
 * An upload can reach Trello even when the client times out before receiving
 * the response. Match only a newly-created attachment with the exact filename
 * and byte size so an older mockup is never mistaken for that upload.
 */
export function findRecentlyUploadedTrelloAttachment(
  attachments: readonly TrelloAttachment[],
  expected: { name: string; bytes: number; startedAt: number },
) {
  const earliestAcceptedDate = expected.startedAt - 5_000;
  return attachments
    .filter((attachment) => {
      if (!attachment.isUpload || attachment.name !== expected.name) return false;
      if (attachment.bytes > 0 && attachment.bytes !== expected.bytes) return false;
      const createdAt = Date.parse(attachment.date || "");
      return Number.isFinite(createdAt) && createdAt >= earliestAcceptedDate;
    })
    .sort(
      (first, second) =>
        Date.parse(second.date || "") - Date.parse(first.date || ""),
    )[0];
}

export interface StoredTrelloImageDerivativeReference {
  cardId: string;
  attachmentId: string;
  variant: "preview" | "thumbnail";
  sha256: string;
}

export interface MissingTrelloImageDerivative {
  card: TrelloCard;
  attachment: TrelloAttachment;
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
  return sortMockupAttachments(
    (card.attachments || []).filter(
      (attachment) =>
        isTrelloImageAttachment(attachment) &&
        attachmentBelongsToCard(attachment, card.id),
    ),
  );
}

export function prioritizeTrelloCoverAttachment<T extends { id: string }>(
  attachments: readonly T[],
  idAttachmentCover?: string | null,
): T[] {
  if (!idAttachmentCover) return [...attachments];
  const coverIndex = attachments.findIndex(
    (attachment) => attachment.id === idAttachmentCover,
  );
  if (coverIndex <= 0) return [...attachments];
  return [
    attachments[coverIndex],
    ...attachments.slice(0, coverIndex),
    ...attachments.slice(coverIndex + 1),
  ];
}

/**
 * Listing workbooks accept only explicitly numbered mockup files as secondary
 * images. Keep this separate from the mockup-generation parser so legacy MK
 * files are not treated as generated jobs or deleted during regeneration.
 */
export function listingMockupIndexFromAttachmentName(name: string): number | null {
  const match = name.trim().match(/^(?:MK|Mockup)\s*(\d+)(?=[\s_.-]|$)/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 1 && index <= 20 ? index : null;
}

/**
 * Amazon listing images are one main image plus at most six generated
 * mockups. Ignore extra source/reference images so they cannot displace a
 * numbered mockup in the workbook.
 */
export function selectTrelloListingImageAttachments(
  card: Pick<TrelloCard, "id" | "idAttachmentCover" | "attachments">,
) {
  const images = selectTrelloImageAttachments(card);
  const coverFirstImages = prioritizeTrelloCoverAttachment(
    images,
    card.idAttachmentCover,
  );
  const preferredSourcePattern =
    /(?:full[\s_.-]*design|(?:^|[\s_.-])(?:source|artwork)(?:[\s_.-]|$))/i;
  const mainImage =
    (coverFirstImages[0]?.id === card.idAttachmentCover
      ? coverFirstImages[0]
      : undefined) ||
    images.find(
      (attachment) =>
        listingMockupIndexFromAttachmentName(attachment.name) === null &&
        preferredSourcePattern.test(attachment.name),
    ) ||
    images.find(
      (attachment) => listingMockupIndexFromAttachmentName(attachment.name) === 1,
    ) ||
    images.find(
      (attachment) => listingMockupIndexFromAttachmentName(attachment.name) === null,
    ) ||
    images[0];

  if (!mainImage) return [];

  const mockupsByIndex = new Map<number, TrelloAttachment>();
  for (const attachment of images) {
    if (attachment.id === mainImage.id) continue;
    const index = listingMockupIndexFromAttachmentName(attachment.name);
    if (index === null) continue;

    const existing = mockupsByIndex.get(index);
    const attachmentDate = Date.parse(attachment.date || "");
    const existingDate = Date.parse(existing?.date || "");
    if (
      !existing ||
      (Number.isFinite(attachmentDate) &&
        (!Number.isFinite(existingDate) || attachmentDate >= existingDate))
    ) {
      mockupsByIndex.set(index, attachment);
    }
  }

  const mockups = [...mockupsByIndex.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .slice(0, 6)
    .map(([, attachment]) => attachment);

  return [mainImage, ...mockups];
}

function sortedAttachmentPreviews(attachment: TrelloAttachment) {
  return (attachment.previews || [])
    .filter((preview) => preview.url && preview.width > 0)
    .sort((first, second) => first.width - second.width);
}

export function preferredAttachmentPreview(attachment: TrelloAttachment) {
  const previews = sortedAttachmentPreviews(attachment);
  return (
    previews.find((preview) => preview.width >= 960) ||
    previews[previews.length - 1]
  )?.url;
}

export function preferredAttachmentThumbnail(attachment: TrelloAttachment) {
  const previews = sortedAttachmentPreviews(attachment);
  return (
    previews.find((preview) => preview.width >= 160) ||
    previews[previews.length - 1]
  )?.url;
}

function withAttachmentPreview(card: TrelloCard): TrelloCard {
  return {
    ...card,
    attachments: card.attachments
      ? sortMockupAttachments(
          card.attachments.map((attachment) => ({
            ...attachment,
            previewUrl: preferredAttachmentPreview(attachment),
            thumbnailUrl: preferredAttachmentThumbnail(attachment),
          })),
        )
      : undefined,
  };
}

export function withStoredTrelloImagePreviews(
  cards: readonly TrelloCard[],
  references: readonly StoredTrelloImageDerivativeReference[],
): TrelloCard[] {
  const urls = new Map(
    references.map((reference) => {
      const baseUrl = `/api/trello/cards/${encodeURIComponent(reference.cardId)}/attachments/${encodeURIComponent(reference.attachmentId)}`;
      return [
        `${reference.cardId}:${reference.attachmentId}:${reference.variant}`,
        `${baseUrl}/${reference.variant}?v=${reference.sha256.slice(0, 16)}`,
      ] as const;
    }),
  );

  return cards.map((card) => ({
    ...card,
    attachments: card.attachments?.map((attachment) => {
      if (!isTrelloImageAttachment(attachment)) return attachment;
      const baseUrl = `/api/trello/cards/${encodeURIComponent(card.id)}/attachments/${encodeURIComponent(attachment.id)}`;
      return {
        ...attachment,
        previewUrl:
          urls.get(`${card.id}:${attachment.id}:preview`) ||
          `${baseUrl}/preview`,
        thumbnailUrl:
          urls.get(`${card.id}:${attachment.id}:thumbnail`) ||
          `${baseUrl}/thumbnail`,
      };
    }),
  }));
}

export function selectMissingTrelloImageDerivatives(
  cards: readonly TrelloCard[],
  references: readonly StoredTrelloImageDerivativeReference[],
): MissingTrelloImageDerivative[] {
  const variants = new Set(
    references.map(
      (reference) =>
        `${reference.cardId}:${reference.attachmentId}:${reference.variant}`,
    ),
  );

  return cards.flatMap((card) =>
    selectTrelloImageAttachments(card).flatMap((attachment) => {
      const hasPreview = variants.has(`${card.id}:${attachment.id}:preview`);
      const hasThumbnail = variants.has(`${card.id}:${attachment.id}:thumbnail`);
      return hasPreview && hasThumbnail ? [] : [{ card, attachment }];
    }),
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
  idBoard?: string;
  idAttachmentCover?: string | null;
  url: string;
  dateLastActivity?: string;
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

const trelloListMarkerPattern = /^(?:(?:[-*+•◦▪‣⁃]\s*(?:\[[ xX]\]\s*)?)|(?:\d{1,3}[.)]\s+))/u;

function stripTrelloListMarker(value: string) {
  let line = value.trim();
  while (trelloListMarkerPattern.test(line)) {
    line = line.replace(trelloListMarkerPattern, "").trimStart();
  }
  return line;
}

const genericKeywordLabelPattern = String.raw`(?:generic|backend)\s*(?:keywords?|search\s*terms?)|search\s*(?:terms?|keywords?)|từ\s*(?:khóa|khoá)(?:\s*(?:chung|tìm\s*kiếm))?|tu\s*khoa(?:\s*(?:chung|tim\s*kiem))?`;
const sizeLabelPattern = String.raw`(?:(?:product|item)?\s*(?:size|dimensions?|measurements?)|kích\s*(?:thước(?:\s*(?:3\s*chiều|sản\s*phẩm))?|cỡ)|kich\s*(?:thuoc(?:\s*(?:3\s*chieu|san\s*pham))?|co)|số\s*đo|so\s*do|dung\s*tích|dung\s*tich|capacity|volume)(?:\s*\([^\r\n)]{1,50}\))?`;
const materialLabelPattern = String.raw`materials?|material\s*types?|material\s*composition|outer\s*materials?|construction\s*materials?|fabric\s*materials?|chất\s*liệu|chat\s*lieu|vật\s*liệu|vat\s*lieu|thành\s*phần\s*chất\s*liệu|thanh\s*phan\s*chat\s*lieu`;

function isTrelloDescriptionLabel(value: string) {
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s_()/&+.\-]{1,79}(?:\s*[:=]|\s+-\s+)/u.test(value);
}

function matchTrelloLabeledLine(value: string, labels: string) {
  return value.match(
    new RegExp(String.raw`^(?:${labels})(?:\s*[:=]\s*|\s+-\s+)(.*)$`, "iu"),
  );
}

function trimFollowingInlineField(value: string) {
  return value
    .split(
      /\s*[;|]\s*(?=[\p{L}\p{M}][\p{L}\p{M}\p{N}\s_()/&+.\-]{1,79}(?:\s*[:=]|\s+-\s+))/u,
    )[0]
    .trim();
}

function containsDigitalMeasurement(value: string) {
  return /\b(?:px|pixels?|dpi)\b/i.test(value);
}

function labeledDescriptionValue(rawDesc: string, labels: string) {
  const lines = (rawDesc || "")
    .split(/\r?\n/)
    .map(stripTrelloListMarker);

  for (let index = 0; index < lines.length; index += 1) {
    const match = matchTrelloLabeledLine(lines[index], labels);
    if (!match) continue;

    const sameLineValue = trimFollowingInlineField(match[1]);
    if (sameLineValue) return sameLineValue.slice(0, 500);

    const nextLine = lines[index + 1] || "";
    if (nextLine && !isTrelloDescriptionLabel(nextLine)) {
      return trimFollowingInlineField(nextLine).slice(0, 500);
    }
    return "";
  }

  return "";
}

function materialDescriptionValue(rawDesc: string) {
  const labeled = labeledDescriptionValue(rawDesc, materialLabelPattern);
  if (labeled) return labeled;

  const lines = (rawDesc || "")
    .split(/\r?\n/)
    .map(stripTrelloListMarker);
  for (const line of lines) {
    const match = line.match(/^made\s+(?:of|from)(?:\s*[:=]\s*|\s+-\s+|\s+)(.+)$/iu);
    if (match) return trimFollowingInlineField(match[1]).slice(0, 500);
  }
  return "";
}

function looksLikeGenericKeywordContinuation(value: string) {
  if (!value || isTrelloDescriptionLabel(value) || value.length > 300) return false;
  if (/[.!?](?:\s|$)/u.test(value)) return false;
  if (/^(?:this|these|those|the\s+product|product\s+details?|description|note|notes?|mô\s*tả|mo\s*ta)\b/iu.test(value)) {
    return false;
  }
  return value.split(/\s+/).filter(Boolean).length <= 20;
}

function trelloGenericKeywordText(rawDesc: string): string {
  const lines = (rawDesc || "")
    .split(/\r?\n/)
    .map(stripTrelloListMarker);
  const startIndex = lines.findIndex((line) => Boolean(
    matchTrelloLabeledLine(line, genericKeywordLabelPattern),
  ));
  if (startIndex === -1) return "";

  const startMatch = matchTrelloLabeledLine(
    lines[startIndex],
    genericKeywordLabelPattern,
  );
  const values = [startMatch?.[1] || ""];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!looksLikeGenericKeywordContinuation(line)) break;
    values.push(line);
  }

  return values.join("\n").trim();
}

function trelloGenericKeywordPhrases(rawDesc: string): string[] {
  return trelloGenericKeywordText(rawDesc)
    .split(/[,;|\n]+/)
    .map((value) => stripTrelloListMarker(value).replace(/^[#\s]+/, "").trim())
    .filter((value) => value.length > 1 && !/https?:\/\//i.test(value))
    .slice(0, 50);
}

export function parseTrelloListingDescription(rawDesc: string) {
  const dimensions = parseCardDimensions(rawDesc);
  const rawExplicitSize = labeledDescriptionValue(rawDesc, sizeLabelPattern);
  const explicitSize = containsDigitalMeasurement(rawExplicitSize)
    ? ""
    : rawExplicitSize;
  const genericKeywords = trelloGenericKeywordPhrases(rawDesc);
  return {
    material: materialDescriptionValue(rawDesc),
    sizeCapacity: dimensions.formatted || explicitSize,
    genericKeywords,
    formattedGenericKeywords: formatRawTrelloKeywords(rawDesc),
  };
}

/**
 * Product facts sent to the Trello listing writer come only from the card.
 * Amazon template defaults belong to the exported workbook and must not be
 * treated as evidence about the current product.
 */
export function buildTrelloAiProductInformation(
  description: ReturnType<typeof parseTrelloListingDescription>,
) {
  return {
    material: description.material,
    size_capacity: description.sizeCapacity,
    color: "",
    package_contents: "",
    features: [],
    personalization: "",
    care_instructions: "",
    country_of_origin: "",
  };
}

export function formatRawTrelloKeywords(rawDesc: string): string {
  const keywords = trelloGenericKeywordPhrases(rawDesc)
    .map((keyword) => keyword.toLocaleLowerCase());
  return keywords.length ? `${keywords.join("; ")};` : "";
}

const TRELLO_BASE_URL = "https://api.trello.com/1";
const TRELLO_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function buildUrl(path: string, key: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${TRELLO_BASE_URL}${path}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function trelloTimeoutMs() {
  const parsed = Number(process.env.TRELLO_REQUEST_TIMEOUT_MS || 120_000);
  return Number.isFinite(parsed)
    ? Math.min(120_000, Math.max(10_000, Math.round(parsed)))
    : 120_000;
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason || new DOMException("Tác vụ Trello đã bị hủy.", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason || new DOMException("Tác vụ Trello đã bị hủy.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const DEFAULT_TRELLO_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

function formatTrelloErrorMessage(status: number, errText: string, defaultAction: string): string {
  if (errText.includes("Human Verification") || errText.includes("CaptchaScript") || errText.includes("AwsWafIntegration")) {
    return `${defaultAction} (${status}): Tường lửa AWS WAF của Trello đang yêu cầu xác minh bảo mật hoặc IP bị chặn. Hãy thử đổi IP/mạng hoặc kiểm tra lại Board ID.`;
  }
  const cleanText = errText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return `${defaultAction} (${status})${cleanText ? `: ${cleanText}` : ""}`;
}

async function fetchTrelloWithRetry(
  input: string | URL,
  init: RequestInit,
  signal?: AbortSignal,
  options: { attempts?: number; retryNetworkErrors?: boolean } = {},
) {
  const attempts = Math.min(4, Math.max(1, options.attempts || 3));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason || new DOMException("Tác vụ Trello đã bị hủy.", "AbortError");
    }
    try {
      const timeoutSignal = AbortSignal.timeout(trelloTimeoutMs());
      const response = await fetch(input, {
        ...init,
        headers: {
          ...DEFAULT_TRELLO_HEADERS,
          ...(init.headers || {}),
        },
        signal: signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal,
      });
      if (!TRELLO_RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
        return response;
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
      await response.body?.cancel().catch(() => undefined);
      const backoffMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : 500 * 2 ** (attempt - 1) + Math.round(Math.random() * 250);
      await abortableDelay(Math.min(10_000, backoffMs), signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      lastError = error;
      if (!options.retryNetworkErrors || attempt === attempts) throw error;
      await abortableDelay(
        500 * 2 ** (attempt - 1) + Math.round(Math.random() * 250),
        signal,
      );
    }
  }

  throw lastError || new Error("Không thể kết nối Trello.");
}

export async function fetchTrelloBoards(apiKey: string, token: string): Promise<TrelloBoard[]> {
  const response = await fetchTrelloWithRetry(
    buildUrl("/members/me/boards", apiKey, token, { fields: "name,url" }),
    { cache: "no-store" },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(formatTrelloErrorMessage(response.status, errText, "Không thể lấy danh sách Board từ Trello"));
  }
  return (await response.json()) as TrelloBoard[];
}

export async function fetchTrelloLists(boardId: string, apiKey: string, token: string): Promise<TrelloList[]> {
  const cleanBoardId = extractTrelloBoardId(boardId);
  if (!cleanBoardId) {
    throw new Error("Mã Board Trello không hợp lệ hoặc đang để trống.");
  }
  const response = await fetchTrelloWithRetry(
    buildUrl(`/boards/${cleanBoardId}/lists`, apiKey, token, { fields: "name,closed" }),
    { cache: "no-store" },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(formatTrelloErrorMessage(response.status, errText, "Không thể lấy danh sách Cột từ Board Trello"));
  }
  return (await response.json()) as TrelloList[];
}

export async function fetchTrelloCards(listId: string, apiKey: string, token: string): Promise<TrelloCard[]> {
  const response = await fetchTrelloWithRetry(
    buildUrl(`/lists/${listId}/cards`, apiKey, token, {
      fields: "all",
      attachments: "true",
      attachment_fields: "name,url,mimeType,bytes,isUpload,date,previews",
    }),
    { cache: "no-store" },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(formatTrelloErrorMessage(response.status, errText, "Không thể lấy thẻ Trello trong danh sách"));
  }
  const cards = (await response.json()) as TrelloCard[];
  return cards.map((sourceCard) => ({
    ...withAttachmentPreview(sourceCard),
    parsed: parseTrelloCardTitle(sourceCard.name),
  }));
}

export async function fetchTrelloCardDetail(
  cardId: string,
  apiKey: string,
  token: string,
  signal?: AbortSignal,
): Promise<TrelloCard> {
  const response = await fetchTrelloWithRetry(
    buildUrl(`/cards/${cardId}`, apiKey, token, {
      fields: "all",
      attachments: "true",
      attachment_fields: "name,url,mimeType,bytes,isUpload,date,previews",
    }),
    { cache: "no-store" },
    signal,
    { retryNetworkErrors: true },
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể lấy thông tin thẻ Trello (${response.status}): ${errText}`);
  }
  const card = (await response.json()) as TrelloCard;
  return {
    ...withAttachmentPreview(card),
    parsed: parseTrelloCardTitle(card.name),
  };
}

export async function moveTrelloCard(
  cardId: string,
  targetListId: string,
  apiKey: string,
  token: string,
  pos: "top" | "bottom" | number = "top",
  signal?: AbortSignal,
): Promise<TrelloCard> {
  const response = await fetchTrelloWithRetry(buildUrl(`/cards/${cardId}`, apiKey, token), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idList: targetListId, pos }),
  }, signal, { retryNetworkErrors: true });

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
  signal?: AbortSignal,
): Promise<TrelloAttachment> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("name", fileName);

  const url = buildUrl(`/cards/${cardId}/attachments`, apiKey, token);
  const response = await fetchTrelloWithRetry(url, {
    method: "POST",
    body: formData,
  }, signal, { retryNetworkErrors: false });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể đính kèm file vào thẻ Trello (${response.status}): ${errText}`);
  }

  return (await response.json()) as TrelloAttachment;
}

export async function deleteTrelloCardAttachment(
  cardId: string,
  attachmentId: string,
  apiKey: string,
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = buildUrl(
    `/cards/${encodeURIComponent(cardId)}/attachments/${encodeURIComponent(attachmentId)}`,
    apiKey,
    token,
  );
  const response = await fetchTrelloWithRetry(url, {
    method: "DELETE",
  }, signal, { retryNetworkErrors: true });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.warn(
      `[Trello] Không thể xóa file đính kèm ${attachmentId} trên thẻ ${cardId} (${response.status}): ${errText}`,
    );
  }
}

export function assertTrelloAttachmentUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Link đính kèm Trello không hợp lệ.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    !(hostname === "trello.com" || hostname.endsWith(".trello.com"))
  ) {
    throw new Error("Chỉ chấp nhận link đính kèm HTTPS thuộc Trello.");
  }
  return url.toString();
}

async function responseBuffer(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Đính kèm Trello vượt quá ${Math.round(maxBytes / 1_000_000)} MB.`);
  }
  const result = Buffer.from(await response.arrayBuffer());
  if (result.byteLength > maxBytes) {
    throw new Error(`Đính kèm Trello vượt quá ${Math.round(maxBytes / 1_000_000)} MB.`);
  }
  return result;
}

export async function downloadTrelloAttachment(
  url: string,
  apiKey: string,
  token: string,
  maxBytes = 50_000_000,
  signal?: AbortSignal,
): Promise<Buffer> {
  const trustedUrl = assertTrelloAttachmentUrl(url);
  const headers: Record<string, string> = {
    Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"`,
    "User-Agent": "Mozilla/5.0 ListingDesk/1.0",
  };

  const response = await fetchTrelloWithRetry(
    trustedUrl,
    { headers },
    signal,
    { retryNetworkErrors: true },
  );
  if (!response.ok) {
    const fallbackResponse = await fetchTrelloWithRetry(
      trustedUrl,
      {},
      signal,
      { retryNetworkErrors: true },
    );
    if (!fallbackResponse.ok) {
      throw new Error(`Không thể tải đính kèm từ Trello HTTP ${response.status}`);
    }
    return responseBuffer(fallbackResponse, maxBytes);
  }
  return responseBuffer(response, maxBytes);
}

export async function createTrelloList(
  boardId: string,
  name: string,
  apiKey: string,
  token: string,
): Promise<TrelloList> {
  const cleanBoardId = extractTrelloBoardId(boardId);
  const response = await fetch(buildUrl("/lists", apiKey, token, { name, idBoard: cleanBoardId, pos: "bottom" }), {
    method: "POST",
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể tạo danh sách Trello mới (${response.status}): ${errText}`);
  }
  return (await response.json()) as TrelloList;
}

export async function createTrelloCard(
  listId: string,
  name: string,
  desc: string,
  apiKey: string,
  token: string,
): Promise<TrelloCard> {
  const response = await fetch(buildUrl("/cards", apiKey, token, { idList: listId, name, desc, pos: "bottom" }), {
    method: "POST",
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Không thể tạo thẻ Trello mới (${response.status}): ${errText}`);
  }
  const card = (await response.json()) as TrelloCard;
  return {
    ...card,
    parsed: parseTrelloCardTitle(card.name),
  };
}

export interface Dimensions3D {
  length: string;
  width: string;
  thickness: string;
  formatted: string;
  capacity?: string;
}

interface ParsedMeasurement {
  value: string;
  unit: string;
}

const measurementValuePattern = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)`;
const measurementUnitPattern = String.raw`(?:fl\s*oz|inches?|in\.?|cm|mm|ft|feet|foot|oz|ml|l|m|["'])`;
const measurementPattern = String.raw`(${measurementValuePattern})\s*(${measurementUnitPattern})?`;
const dimensionsPattern = new RegExp(
  String.raw`${measurementPattern}\s*x\s*${measurementPattern}(?:\s*x\s*${measurementPattern})?`,
  "i",
);
const exactDimensionsPattern = new RegExp(
  String.raw`^\s*${dimensionsPattern.source}\s*(?:\([^)]{1,80}\))?\s*$`,
  "i",
);

function normalizeDimensionText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[×✕✖]/g, "x")
    .replace(/\s*\*\s*/g, " x ")
    .replace(/(\d),(\d)/g, "$1.$2");
}

function normalizeMeasurement(value = "", unit = ""): ParsedMeasurement {
  const normalizedValue = value.replace(/\s*\/\s*/g, "/").replace(/,/g, ".").trim();
  const normalizedUnit = unit.toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ").trim();

  if (!normalizedUnit) return { value: normalizedValue, unit: "" };
  if (normalizedUnit === '"' || /^in(?:ch(?:es)?)?$/.test(normalizedUnit)) {
    return { value: normalizedValue, unit: '"' };
  }
  if (normalizedUnit === "'" || /^(?:ft|feet|foot)$/.test(normalizedUnit)) {
    return { value: normalizedValue, unit: "'" };
  }
  return { value: normalizedValue, unit: normalizedUnit };
}

function isCapacityUnit(unit: string) {
  return /^(?:fl oz|oz|ml|l)$/.test(unit);
}

function formatMeasurement(measurement: ParsedMeasurement, inheritedUnit = "") {
  const unit = measurement.unit || inheritedUnit;
  if (!unit) return measurement.value;
  if (unit === '"' || unit === "'") return `${measurement.value}${unit}`;
  if (!isCapacityUnit(unit)) return `${measurement.value}${unit}`;
  return `${measurement.value} ${unit}`;
}

function normalizedDescriptionLines(desc: string) {
  return (desc || "")
    .split(/\r?\n/)
    .map((line) => normalizeDimensionText(stripTrelloListMarker(line)));
}

function dimensionDescriptionLines(desc: string) {
  const result: string[] = [];
  let insideGenericKeywords = false;

  for (const line of normalizedDescriptionLines(desc)) {
    if (matchTrelloLabeledLine(line, genericKeywordLabelPattern)) {
      insideGenericKeywords = true;
      continue;
    }
    if (insideGenericKeywords && looksLikeGenericKeywordContinuation(line)) continue;
    insideGenericKeywords = false;
    result.push(line);
  }

  return result;
}

function findLabeledMeasurement(desc: string, labels: string) {
  const searchable = dimensionDescriptionLines(desc).join("\n");
  const match = searchable.match(
    new RegExp(
      String.raw`(?:^|[\n;|])\s*(?:${labels})(?:\s*[:=\-]\s*|\s+)${measurementPattern}`,
      "iu",
    ),
  );
  return match ? normalizeMeasurement(match[1], match[2]) : null;
}

function findCompoundDimensions(desc: string) {
  for (const line of dimensionDescriptionLines(desc)) {
    const labeledMatch = matchTrelloLabeledLine(line, sizeLabelPattern);
    const naturalLabelMatch = line.match(
      new RegExp(String.raw`^(?:${sizeLabelPattern})\s+(?:is|are|là|la)\s+(.+)$`, "iu"),
    );
    const labeledValue = labeledMatch?.[1] || naturalLabelMatch?.[1] || "";
    if (labeledValue && !containsDigitalMeasurement(labeledValue)) {
      const match = labeledValue.replace(/\bby\b/gi, "x").match(dimensionsPattern);
      if (match) return match;
    }

    const exactMatch = line.replace(/\bby\b/gi, "x").match(exactDimensionsPattern);
    if (
      exactMatch &&
      [exactMatch[2], exactMatch[4], exactMatch[6]]
        .filter(Boolean)
        .some((unit) => !isCapacityUnit(normalizeMeasurement("", unit).unit))
    ) {
      return exactMatch;
    }
  }
  return null;
}

export function parseCardDimensions(desc: string): Dimensions3D {
  const dimMatch = findCompoundDimensions(desc);
  const capacityMeasurement = findLabeledMeasurement(
    desc,
    String.raw`dung\s*tích|dung\s*tich|capacity|volume`,
  );
  const labeledCapacity = capacityMeasurement && isCapacityUnit(capacityMeasurement.unit)
    ? formatMeasurement(capacityMeasurement)
    : "";
  if (dimMatch) {
    const firstMeasurement = normalizeMeasurement(dimMatch[1], dimMatch[2]);
    const secondMeasurement = normalizeMeasurement(dimMatch[3], dimMatch[4]);
    const thirdMeasurement = dimMatch[5]
      ? normalizeMeasurement(dimMatch[5], dimMatch[6])
      : null;
    const measurements = [
      firstMeasurement,
      secondMeasurement,
      thirdMeasurement,
    ];
    const inheritedDimensionUnit = [...measurements]
      .reverse()
      .find((measurement) => measurement?.unit && !isCapacityUnit(measurement.unit))?.unit || "";
    const length = formatMeasurement(firstMeasurement, inheritedDimensionUnit);
    const width = formatMeasurement(secondMeasurement, inheritedDimensionUnit);
    const third = thirdMeasurement;
    const compoundCapacity = third && isCapacityUnit(third.unit)
      ? formatMeasurement(third)
      : "";
    const capacity = compoundCapacity || labeledCapacity;
    const thickness = third && !compoundCapacity
      ? formatMeasurement(third, inheritedDimensionUnit)
      : "";
    const formattedDimensions = [length, width, thickness].filter(Boolean).join(" x ");

    return {
      length,
      width,
      thickness,
      formatted: capacity
        ? `${formattedDimensions} • ${capacity}`
        : formattedDimensions,
      ...(capacity ? { capacity } : {}),
    };
  }

  const lengthMeasurement = findLabeledMeasurement(
    desc,
    String.raw`chiều\s*dài|chieu\s*dai|dài|dai|chiều\s*cao|chieu\s*cao|cao|(?:product|item)\s*(?:length|height)|length|height`,
  );
  const widthMeasurement = findLabeledMeasurement(
    desc,
    String.raw`chiều\s*rộng|chieu\s*rong|rộng|rong|(?:product|item)\s*width|width`,
  );
  const diameterMeasurement = findLabeledMeasurement(
    desc,
    String.raw`đường\s*kính|duong\s*kinh|(?:product|item)\s*diameter|diameter`,
  );
  const thicknessMeasurement = findLabeledMeasurement(
    desc,
    String.raw`độ\s*dày|do\s*day|dày|day|(?:product|item)\s*(?:thickness|depth)|thickness|depth`,
  );

  const dimensionMeasurements = [
    lengthMeasurement || diameterMeasurement,
    widthMeasurement || diameterMeasurement,
    thicknessMeasurement,
  ];
  const inheritedDimensionUnit = [...dimensionMeasurements]
    .reverse()
    .find((measurement) => measurement?.unit && !isCapacityUnit(measurement.unit))?.unit || "";
  const length = dimensionMeasurements[0]
    ? formatMeasurement(dimensionMeasurements[0], inheritedDimensionUnit)
    : "";
  const width = dimensionMeasurements[1]
    ? formatMeasurement(dimensionMeasurements[1], inheritedDimensionUnit)
    : "";
  const thickness = dimensionMeasurements[2]
    ? formatMeasurement(dimensionMeasurements[2], inheritedDimensionUnit)
    : "";
  const capacity = labeledCapacity;
  const formattedDimensions = [length, width, thickness].filter(Boolean).join(" x ");

  return {
    length,
    width,
    thickness,
    formatted: capacity && formattedDimensions
      ? `${formattedDimensions} • ${capacity}`
      : capacity || formattedDimensions,
    ...(capacity ? { capacity } : {}),
  };
}
