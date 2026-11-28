import "server-only";

import { getTrelloServerCredentials } from "@/lib/trello-server-config";
import { TRELLO_CARD_FIELDS, TRELLO_STATUS_VALUES, type TrelloCardFieldKey } from "@/lib/trello-fba-card-template";

export interface ParsedTrelloFbaCard {
  cardId: string;
  cardName: string;
  sku: string;
  storeName: string | null;
  storeId: string | null;
  productType: string | null;
  niche: string | null;
  picMkt: string | null;
  picIdea: string | null;
  /** null khi mô tả thẻ không ghi Status (để trống, không tự gán) */
  status: string | null;
  event: string | null;
  thangListing: string | null;
  mockupUrl: string | null;
  fileDesign: string | null;
  /** Người thiết kế (cột Design PIC) — dòng "Design: …" */
  designPic: string | null;
  /** Kích thước — dòng "Size: …" */
  size: string | null;
  desc: string;
  labels: string[];
  rawDateMoved: string | null;
  validationErrors: string[];
}

export interface TrelloCardDetail {
  id: string;
  name: string;
  desc: string;
  dateLastActivity?: string;
  labels?: Array<{ id: string; name: string }>;
  attachments?: Array<{ id: string; name: string; url: string; mimeType?: string }>;
}

/** Chuẩn hóa chuỗi viết thường, bỏ dấu khoảng trắng thừa để so khớp chính xác */
export function normalizeKey(text: string | null | undefined): string {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const foldLabel = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[*_`#>]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const LABEL_TO_KEY = new Map<string, TrelloCardFieldKey>(TRELLO_CARD_FIELDS.map((f) => [foldLabel(f.label), f.key]));

/** Giá trị Status chuẩn (so khớp không dấu, không phân biệt hoa thường) */
const STATUS_BY_FOLD = new Map<string, string>(TRELLO_STATUS_VALUES.map((v) => [foldLabel(v), v]));

/** Link đầu tiên trong giá trị (Trello hay đổi link thành markdown [url](url "smartCard-inline")) */
const firstUrl = (value: string) => value.match(/https?:\/\/[^\s)\]"'<>]+/i)?.[0] ?? null;

/**
 * Đọc mô tả thẻ theo ĐÚNG mẫu (lib/trello-fba-card-template.ts):
 *   PIC MKT: / PIC Idea: / Design: / Status: / Event: / Size: / File Design:
 * Chỉ đọc các dòng có đúng nhãn này (không phân biệt hoa thường, bỏ qua in đậm markdown); dòng khác bỏ qua.
 * Dòng để trống hoặc còn chữ gợi ý trong ngoặc "(…)" → để trống. Nhãn ghi 2 lần thì lấy dòng đầu.
 */
export function parseDescriptionFields(desc: string) {
  const values: Partial<Record<TrelloCardFieldKey, string>> = {};
  const warnings: string[] = [];

  for (const rawLine of desc.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:[-*•]\s+)?([^:：]+?)\s*[:：]\s*(.*)$/);
    if (!match) continue;
    const key = LABEL_TO_KEY.get(foldLabel(match[1]));
    if (!key || key in values) continue;
    const value = match[2].replace(/^[*_\s]+|[*_\s]+$/g, "").trim();
    if (!value || /^\(.*\)$/.test(value)) continue;
    values[key] = value;
  }

  let status: string | null = null;
  if (values.status) {
    status = STATUS_BY_FOLD.get(foldLabel(values.status)) ?? null;
    if (!status) warnings.push(`Status "${values.status}" không hợp lệ (chỉ nhận ${TRELLO_STATUS_VALUES.join(" / ")}) — để trống`);
  }

  let fileDesign: string | null = null;
  if (values.fileDesign) {
    fileDesign = firstUrl(values.fileDesign);
    if (!fileDesign) warnings.push("File Design không phải link — để trống");
  }

  // "Design:" là tên người thiết kế; dán nhầm link vào đây thì bỏ qua
  const designPic = values.designPic && !firstUrl(values.designPic) ? values.designPic : null;

  return {
    picMkt: values.picMkt ?? null,
    picIdea: values.picIdea ?? null,
    designPic,
    status,
    event: values.event ?? null,
    size: values.size ?? null,
    fileDesign,
    warnings,
  };
}

/**
 * Phân tích 1 thẻ Trello thành đối tượng dữ liệu chuẩn của BẢNG MÃ
 */
export async function parseTrelloFbaCard(
  card: TrelloCardDetail,
  knownStores: Array<{ id: string; name: string }>,
  knownProductTypes: string[],
  movedDateIso?: string | null,
): Promise<ParsedTrelloFbaCard> {
  const errors: string[] = [];

  // 1. Tách SKU từ tiêu đề thẻ (phần trước dấu _ hoặc khoảng trắng)
  const title = card.name.trim();
  const titleParts = title.split(/[_\t]/);
  const rawSku = titleParts[0].trim();
  const sku = rawSku.toUpperCase();

  if (!sku) {
    errors.push("Tiêu đề thẻ không có mã SKU hợp lệ");
  }

  // 2. Chuẩn bị bảng tra cứu chuẩn hóa viết thường
  const storeMap = new Map<string, { id: string; name: string }>();
  for (const s of knownStores) {
    storeMap.set(normalizeKey(s.name), s);
  }

  const ptMap = new Map<string, string>();
  for (const pt of knownProductTypes) {
    ptMap.set(normalizeKey(pt), pt);
  }

  // 3. Quét danh sách Nhãn (Labels) không phân biệt thứ tự/màu sắc
  const labelNames = (card.labels || []).map((l) => l.name.trim()).filter(Boolean);
  let matchedStore: { id: string; name: string } | null = null;
  let matchedProductType: string | null = null;
  const nicheCandidates: string[] = [];
  let monthLabel: string | null = null;

  for (const lbl of labelNames) {
    const key = normalizeKey(lbl);

    // Kiểm tra có phải nhãn Store
    if (storeMap.has(key)) {
      matchedStore = storeMap.get(key)!;
      continue;
    }

    // Kiểm tra có phải nhãn Product Type
    if (ptMap.has(key)) {
      matchedProductType = ptMap.get(key)!;
      continue;
    }

    // Kiểm tra nhãn tháng (ví dụ 6/2026, 11/2026, 2026-11)
    const mMatch = lbl.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (mMatch) {
      monthLabel = `${mMatch[2]}-${mMatch[1].padStart(2, "0")}`;
      continue;
    }

    // Các nhãn số ngắn (ví dụ '1', '2', '1.5') thường là độ dày hoặc số lượng thì bỏ qua không gán vào Niche
    if (/^\d+(\.\d+)?$/.test(lbl)) {
      continue;
    }

    // Các nhãn còn lại coi là Niche
    nicheCandidates.push(lbl);
  }

  // 3b. Nếu nhãn không có Product Type, thử tìm trong tiêu đề (ví dụ "SPC086945_Slate Plate Circle")
  if (!matchedProductType && titleParts.length > 1) {
    const titleSuffix = titleParts.slice(1).join(" ").trim();
    const titleKey = normalizeKey(titleSuffix);
    if (ptMap.has(titleKey)) {
      matchedProductType = ptMap.get(titleKey)!;
    } else {
      // Tìm xem có knownProductType nào nằm trọn trong tiêu đề không
      for (const [k, pt] of ptMap.entries()) {
        if (titleKey.includes(k)) {
          matchedProductType = pt;
          break;
        }
      }
      // Nếu vẫn chưa có nhưng có text sau gạch dưới, lấy luôn text đó làm product type
      if (!matchedProductType && titleSuffix) {
        matchedProductType = titleSuffix;
      }
    }
  }

  // 4. Đọc các trường từ Description
  const descFields = parseDescriptionFields(card.desc || "");

  // 5. Xác định tháng listing: ưu tiên tháng khi kéo thẻ sang cột, fallback về dateLastActivity hoặc nhãn
  let thangListing: string | null = null;
  const effectiveDate = movedDateIso || card.dateLastActivity;
  if (effectiveDate) {
    const d = new Date(effectiveDate);
    if (!isNaN(d.getTime())) {
      thangListing = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
  }
  if (!thangListing && monthLabel) {
    thangListing = monthLabel;
  }

  // 6. Tìm ảnh Mockup tốt nhất: ưu tiên file có tên chứa 'mk', nếu không lấy file ảnh hợp lệ đầu tiên
  let mockupUrl: string | null = null;
  const attachments = card.attachments || [];
  const imageAttachments = attachments.filter((a) => {
    const n = a.name.toLowerCase();
    const isImg = n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp");
    return isImg || (a.mimeType && a.mimeType.startsWith("image/"));
  });

  const mkAttachment = imageAttachments.find((a) => {
    const n = a.name.toLowerCase();
    return n.includes("mk.") || n.startsWith("mk") || n.includes("mockup");
  });

  const bestAttachment = mkAttachment || imageAttachments[0];
  if (bestAttachment) {
    mockupUrl = bestAttachment.url;
  }

  // 7. Chuẩn hóa Status
  // Mô tả không ghi Status / Event thì để trống (không tự gán Test / Evergreen)
  const status = descFields.status;
  errors.push(...descFields.warnings);

  return {
    cardId: card.id,
    cardName: card.name,
    sku,
    storeName: matchedStore?.name || null,
    storeId: matchedStore?.id || null,
    productType: matchedProductType,
    niche: nicheCandidates.join(", ") || null,
    picMkt: descFields.picMkt,
    picIdea: descFields.picIdea,
    status,
    event: descFields.event,
    thangListing,
    mockupUrl,
    fileDesign: descFields.fileDesign,
    designPic: descFields.designPic,
    size: descFields.size,
    desc: card.desc,
    labels: labelNames,
    rawDateMoved: effectiveDate || null,
    validationErrors: errors,
  };
}

/**
 * Lấy toàn bộ danh sách thẻ từ cột chỉ định trên Trello
 */
export async function fetchCardsFromTrelloList(listId: string): Promise<TrelloCardDetail[]> {
  const { apiKey, token } = getTrelloServerCredentials();
  const url = `https://api.trello.com/1/lists/${listId}/cards?attachments=true&fields=id,name,desc,dateLastActivity,labels&key=${apiKey}&token=${token}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lỗi tải danh sách thẻ Trello (${res.status}): ${text}`);
  }

  return (await res.json()) as TrelloCardDetail[];
}

/**
 * Lấy thời điểm di chuyển thẻ vào cột gần nhất (nếu có)
 */
export async function getCardMoveDate(cardId: string, targetListId: string): Promise<string | null> {
  const { apiKey, token } = getTrelloServerCredentials();
  const url = `https://api.trello.com/1/cards/${cardId}/actions?filter=updateCard:idList&limit=10&key=${apiKey}&token=${token}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const actions = (await res.json()) as Array<{ date: string; data?: { listAfter?: { id: string } } }>;
    const match = actions.find((a) => a.data?.listAfter?.id === targetListId);
    return match?.date || null;
  } catch {
    return null;
  }
}

