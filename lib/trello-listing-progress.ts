import type { StoredListing } from "@/lib/types";

export type TrelloListingStage =
  | "card"
  | "image_download"
  | "template"
  | "image_prepare"
  | "keyword_research"
  | "competitor_research"
  | "ocr"
  | "ai_writer"
  | "validation"
  | "database"
  | "listing_ready"
  | "excel"
  | "trello_upload"
  | "trello_move"
  | "complete";

export interface TrelloListingProgressEvent {
  type: "progress";
  card_id: string;
  stage: TrelloListingStage;
  status: "started" | "completed";
  message: string;
  progress: number;
  duration_ms?: number;
  timings_ms: Record<string, number>;
}

export interface TrelloListingReadyEvent {
  type: "listing_ready";
  card_id: string;
  sku: string;
  item_name: string;
  listing: StoredListing;
  message: string;
  progress: number;
  timings_ms: Record<string, number>;
}

export interface TrelloListingWarningEvent {
  type: "warning";
  card_id: string;
  stage: TrelloListingStage;
  message: string;
  timings_ms: Record<string, number>;
}

export interface TrelloListingCompleteEvent {
  type: "complete";
  card_id: string;
  sku: string;
  attachment?: { id: string; name: string; url: string } | null;
  message: string;
  progress: 100;
  timings_ms: Record<string, number>;
}

export interface TrelloListingErrorEvent {
  type: "error";
  card_id: string;
  message: string;
}

export type TrelloListingStreamEvent =
  | TrelloListingProgressEvent
  | TrelloListingReadyEvent
  | TrelloListingWarningEvent
  | TrelloListingCompleteEvent
  | TrelloListingErrorEvent;

export const TRELLO_LISTING_STAGE_UI: Record<
  TrelloListingStage,
  { started: string; completed: string; started_progress: number; progress: number }
> = {
  card: { started: "Đang đọc thẻ Trello...", completed: "Đã đọc thẻ Trello.", started_progress: 1, progress: 6 },
  image_download: { started: "Đang tải ảnh thiết kế...", completed: "Đã tải ảnh thiết kế.", started_progress: 6, progress: 13 },
  template: { started: "Đang chọn template Excel...", completed: "Đã chọn template Excel.", started_progress: 13, progress: 18 },
  image_prepare: { started: "Đang tối ưu ảnh...", completed: "Ảnh đã sẵn sàng.", started_progress: 18, progress: 23 },
  keyword_research: { started: "Đang nghiên cứu từ khóa...", completed: "Đã xử lý từ khóa.", started_progress: 23, progress: 29 },
  competitor_research: { started: "Đang đọc dữ liệu đối thủ...", completed: "Đã xử lý dữ liệu đối thủ.", started_progress: 29, progress: 35 },
  ocr: { started: "Đang đọc chữ trên ảnh...", completed: "Đã đọc chữ trên ảnh.", started_progress: 35, progress: 43 },
  ai_writer: { started: "AI đang viết listing...", completed: "AI đã viết xong listing.", started_progress: 43, progress: 70 },
  validation: { started: "Đang kiểm tra nội dung...", completed: "Đã kiểm tra nội dung.", started_progress: 70, progress: 76 },
  database: { started: "Đang lưu listing...", completed: "Đã lưu listing.", started_progress: 76, progress: 81 },
  listing_ready: { started: "Listing đã sẵn sàng.", completed: "Listing đã sẵn sàng.", started_progress: 81, progress: 84 },
  excel: { started: "Đang tạo file Excel nền...", completed: "Đã tạo file Excel.", started_progress: 84, progress: 90 },
  trello_upload: { started: "Đang đính kèm Excel lên Trello...", completed: "Đã đính kèm Excel.", started_progress: 90, progress: 96 },
  trello_move: { started: "Đang chuyển thẻ sang cột Listing...", completed: "Đã chuyển thẻ.", started_progress: 96, progress: 99 },
  complete: { started: "Đang hoàn tất...", completed: "Đã hoàn tất.", started_progress: 99, progress: 100 },
};

export const TRELLO_LISTING_STAGE_LABELS: Record<TrelloListingStage, string> = {
  card: "Đọc thẻ",
  image_download: "Tải ảnh",
  template: "Template",
  image_prepare: "Tối ưu ảnh",
  keyword_research: "Từ khóa",
  competitor_research: "Đối thủ",
  ocr: "OCR",
  ai_writer: "AI writer",
  validation: "Kiểm tra",
  database: "Lưu DB",
  listing_ready: "Listing",
  excel: "Excel",
  trello_upload: "Upload",
  trello_move: "Chuyển cột",
  complete: "Hoàn tất",
};

export function formatStageDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} giây`;
}
