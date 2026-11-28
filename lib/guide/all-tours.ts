import type { GuideTour } from "@/lib/guide/types";
import { PPC_AUTOBID_GUIDE_PAGE, PPC_AUTOBID_TOURS } from "@/lib/guide/ppc-autobid-tours";
import { PPC_MANUAL_BID_GUIDE_PAGE, PPC_MANUAL_BID_TOURS } from "@/lib/guide/ppc-manual-bid-tours";
import { PPC_NEGATIVE_GUIDE_PAGE, PPC_NEGATIVE_TOURS } from "@/lib/guide/ppc-negative-tours";
import { PPC_SALE_KW_GUIDE_PAGE, PPC_SALE_KW_TOURS } from "@/lib/guide/ppc-sale-kw-tours";
import { PPC_NEW_CAMP_GUIDE_PAGE, PPC_NEW_CAMP_TOURS } from "@/lib/guide/ppc-new-camp-tours";
import { AUTO_MOCKUP_GUIDE_PAGE, AUTO_MOCKUP_TOURS } from "@/lib/guide/auto-mockup-tours";
import { LISTING_GUIDE_PAGE, LISTING_TOURS } from "@/lib/guide/listing-tours";

// Danh sách MỌI bộ kịch bản hướng dẫn. Thêm màn mới: tạo lib/guide/<màn>-tours.ts rồi thêm 1 dòng ở đây,
// để tests/guide-tours-lint.test.ts và scripts/lint-guide-tours.ts kiểm tra luôn bộ đó.
export const GUIDE_TOUR_SETS: { page: string; file: string; tours: GuideTour[] }[] = [
  { page: PPC_AUTOBID_GUIDE_PAGE, file: "lib/guide/ppc-autobid-tours.ts", tours: PPC_AUTOBID_TOURS },
  { page: PPC_MANUAL_BID_GUIDE_PAGE, file: "lib/guide/ppc-manual-bid-tours.ts", tours: PPC_MANUAL_BID_TOURS },
  { page: PPC_NEGATIVE_GUIDE_PAGE, file: "lib/guide/ppc-negative-tours.ts", tours: PPC_NEGATIVE_TOURS },
  { page: PPC_SALE_KW_GUIDE_PAGE, file: "lib/guide/ppc-sale-kw-tours.ts", tours: PPC_SALE_KW_TOURS },
  { page: PPC_NEW_CAMP_GUIDE_PAGE, file: "lib/guide/ppc-new-camp-tours.ts", tours: PPC_NEW_CAMP_TOURS },
  { page: AUTO_MOCKUP_GUIDE_PAGE, file: "lib/guide/auto-mockup-tours.ts", tours: AUTO_MOCKUP_TOURS },
  { page: LISTING_GUIDE_PAGE, file: "lib/guide/listing-tours.ts", tours: LISTING_TOURS },
];

/**
 * Khóa data-tour của nút THAY ĐỔI DỮ LIỆU THẬT (đẩy lên Amazon, lưu, xoá, duyệt, bật tắt…): kịch bản chỉ được làm sáng,
 * không bao giờ được bấm (`before` / `cleanup`). Nhận theo từ trong khóa; khóa kết thúc bằng -cancel / -close là nút đóng.
 */
export const DANGER_KEY_WORDS = [
  "approve", "apply", "confirm", "create", "delete", "download", "enable", "export", "push",
  "save", "start", "submit", "upload",
] as const;

/**
 * Nút trùng chữ với nút nguy hiểm nhưng CHỈ MỞ hộp xác nhận / hộp kiểm tra (chưa đổi gì). Thêm vào đây chỉ sau khi đọc
 * onClick của nút, và gắn luôn `data-tour-safe` trên nút đó để engine không chặn.
 */
export const SAFE_OPENER_KEYS = new Set<string>([
  "aq-export-btn", // mở hộp kiểm tra trước khi xuất (có data-tour-safe)
  "aq-auto-upload-btn", // handleOpenAutoUploadModal: chỉ mở hộp chọn phạm vi
  "neg-auto-upload-btn", // handleOpenAutoUploadModal: chỉ mở modal xác nhận an toàn
  "sale-btn-auto-upload", // handleOpenAutoUploadModal: kiểm tra rồi chỉ mở modal xác nhận (có data-tour-safe)
  "neg-nl-auto-upload-btn", // openConfirm: kiểm tra keyword / campaign rồi chỉ mở modal xác nhận (có data-tour-safe)
  "lst-btn-batch-history", // chỉ mở modal xem lịch sử batch (có data-tour-safe)
  "lst-btn-add-template", // chỉ mở modal quản lý/thêm template (có data-tour-safe)
  "lst-btn-add-brand", // chỉ mở modal thêm brand (có data-tour-safe)
  "lst-btn-trello-config", // chỉ mở modal cấu hình board/cột trello (có data-tour-safe)
]);

export function isDangerKey(key: string): boolean {
  if (SAFE_OPENER_KEYS.has(key)) return false;
  const parts = key.split("-");
  if (["cancel", "close"].includes(parts[parts.length - 1])) return false;
  return parts.some((p) => (DANGER_KEY_WORDS as readonly string[]).includes(p));
}
