// Kịch bản hướng dẫn trên màn hình (dùng chung server + client).
// AI KHÔNG tự đoán nút: nó chỉ chọn id kịch bản trong danh mục; kịch bản do người viết sẵn, trỏ vào phần tử
// gắn thuộc tính data-tour="<key>" trong giao diện. Đổi giao diện thì giữ nguyên data-tour là kịch bản vẫn chạy.

/** Thao tác demo trên màn hình. Chỉ dùng cho thao tác XEM / LỌC / MỞ – ĐÓNG cửa sổ, không bao giờ lưu dữ liệu. */
export type GuideAction =
  /**
   * Con trỏ giả di tới phần tử rồi bấm. ifPresent: không thấy phần tử thì bỏ qua (dùng cho bước dọn dẹp).
   * undo: bấm này làm đổi trạng thái màn hình (tick, bật thẻ, mở khung) → khi tour kết thúc / bị đóng giữa chừng, engine
   *   bấm lại để trả về như cũ, CHỈ với những lần bấm đã thực sự xảy ra (theo thứ tự ngược). true = bấm lại chính phần tử đó;
   *   chuỗi = bấm phần tử có khóa đó (vd tab con trước đó).
   * ensure: "on" = chỉ bấm khi phần tử đang TẮT (ô tick, aria-pressed / aria-checked / aria-selected), đã bật thì bỏ qua
   *   và không hoàn tác — tránh tắt nhầm cái người dùng đã bật sẵn. "off" ngược lại.
   */
  | { type: "click"; target: string; ifPresent?: boolean; undo?: true | string; ensure?: "on" | "off" }
  /**
   * Gõ mẫu vào ô input / textarea (khóa trỏ vào ô hoặc phần tử bọc ô). Engine LUÔN ghi lại chữ cũ và trả lại khi tour
   * kết thúc / bị đóng. Chỉ dùng cho ô tìm kiếm / ô nhập nháp chưa lưu — không dùng cho ô mà gõ xong là lưu ngay.
   */
  | { type: "type"; target: string; value: string; ifPresent?: boolean; /** Gõ nối vào cuối chữ đang có thay vì thay hết. */ append?: boolean }
  | { type: "wait"; ms: number };

export interface GuideTourStep {
  /** Khóa data-tour của phần tử cần làm sáng (mảng = khóa dự phòng, lấy cái đầu tiên có trên màn hình).
   *  Bỏ trống = hộp thoại giữa màn hình. */
  target?: string | string[];
  title: string;
  /** Nội dung giải thích (HTML đơn giản: <b>, <br>). */
  body: string;
  side?: "top" | "bottom" | "left" | "right";
  /** Thao tác demo chạy TRƯỚC khi làm sáng bước này (vd mở chi tiết SKU). */
  before?: GuideAction[];
  /** Không thấy phần tử (store chưa có dữ liệu…) thì bỏ qua bước này, không báo. */
  optional?: boolean;
  /** Câu báo khi không thấy phần tử (bước bắt buộc). */
  missingText?: string;
}

export interface GuideTour {
  id: string;
  /** Màn hình kịch bản chạy được (khớp với nơi gắn trợ lý). */
  page: string;
  /** "main" = chức năng chính của màn (luồng ra kết quả: lên camp, phủ định, duyệt, đẩy…), hiện nổi bật đầu khung chat;
   *  "extra" = tùy chọn thêm (lọc, giải thích, đọc bảng, mẹo), hiện bên dưới. */
  kind: "main" | "extra";
  title: string;
  /** 1 câu mô tả cho người dùng (hiện trên nút). */
  summary: string;
  /** Khi nào nên dùng — đưa vào prompt để AI chọn đúng kịch bản. */
  whenToUse: string;
  steps: GuideTourStep[];
  /** Trả màn hình về như cũ khi kết thúc / đóng giữa chừng (đóng cửa sổ đã mở, bỏ bộ lọc demo). */
  cleanup?: GuideAction[];
}

/** Câu trả lời của AI gắn kịch bản bằng mã [[tour:<id>]] (giao diện đổi thành nút "Xem mình làm"). */
export const TOUR_MARKER = /\[\[tour:([a-z0-9-]+)\]\]/g;

/** Các id kịch bản trong câu trả lời ("none" = AI đã quyết định không gắn hướng dẫn nào). */
export function extractTourIds(text: string): string[] {
  return [...new Set([...text.matchAll(TOUR_MARKER)].map((m) => m[1]).filter((id) => id !== "none"))];
}

export function hasTourDecision(text: string): boolean {
  return /\[\[tour:[a-z0-9-]+\]\]/.test(text);
}

export function stripTourMarkers(text: string): string {
  return text.replace(TOUR_MARKER, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
