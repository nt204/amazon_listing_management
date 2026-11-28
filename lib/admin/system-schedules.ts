import "server-only";

import { getInventorySheetSchedulerStatus } from "@/lib/accounting/inventory-sheet-scheduler";
import { getSkuEvalReminderSchedule } from "@/lib/accounting/sku-eval-reminder";
import { autoDecreaseHour, isAutoDecreaseScheduleEnabled } from "@/lib/ppc/auto-decrease";

export type SystemSchedule = {
  name: string;
  kind: "Crawl" | "Đồng bộ" | "Thông báo" | "Bảo trì";
  source: "Mac mini" | "VPS" | "Web app";
  time: string;
  detail?: string;
  enabled?: boolean;
};

const maintenance: SystemSchedule[] = [
  { name: "Bảo trì PostgreSQL", kind: "Bảo trì", source: "VPS", time: "03:00 Chủ nhật" },
  { name: "Bảo trì máy chạy crawler", kind: "Bảo trì", source: "Mac mini", time: "Mỗi 4 giờ" },
];

// Cron, LaunchAgent và cấu hình worker ngoài web được đối chiếu trực tiếp trên VPS và Mac mini.
const externalSchedulesCheckedAt = "28/11/2026";

function hour(value: number) {
  return `${String(value).padStart(2, "0")}:00`;
}

export function getSystemSchedules() {
  const inventorySheet = getInventorySheetSchedulerStatus();
  const skuReminder = getSkuEvalReminderSchedule();

  const ppc: SystemSchedule[] = [
    { name: "Crawl báo cáo quảng cáo Amazon", kind: "Crawl", source: "Mac mini", time: "05:00 mỗi ngày", detail: "Xếp hàng theo store để tải báo cáo và nạp dữ liệu PPC." },
    { name: "Xếp hàng crawl PPC dự phòng", kind: "Crawl", source: "VPS", time: "05:05 mỗi ngày" },
    { name: "Đồng bộ Search Volume và thứ hạng", kind: "Đồng bộ", source: "VPS", time: "03:00 ngày 3 hằng tháng", detail: "Đồng bộ dữ liệu Helium 10 cho các store PPC." },
    { name: "Tính sẵn dữ liệu Manual Bid", kind: "Đồng bộ", source: "Web app", time: "Kiểm tra mỗi 5 phút", detail: "Tính lại khi có snapshot mới.", enabled: process.env.PPC_MANUAL_BID_PREWARM !== "off" },
    { name: "Nhắc xác nhận đề xuất giảm bid", kind: "Thông báo", source: "Web app", time: `${hour(autoDecreaseHour())} mỗi ngày`, detail: "Gửi Lark cho người phụ trách các store đã bật tính năng.", enabled: isAutoDecreaseScheduleEnabled() },
    { name: "Bảo trì dữ liệu PPC trong worker nạp báo cáo", kind: "Bảo trì", source: "VPS", time: "03:00–05:00 mỗi ngày", detail: "Chạy một lượt trong khung giờ này khi worker rảnh." },
    { name: "Dọn báo cáo PPC cũ trên R2", kind: "Bảo trì", source: "Mac mini", time: "06:30 mỗi ngày" },
    { name: "Dọn dữ liệu PPC hằng ngày", kind: "Bảo trì", source: "VPS", time: "19:00 mỗi ngày" },
    { name: "Bảo trì dung lượng lưu trữ PPC", kind: "Bảo trì", source: "VPS", time: "19:15 mỗi ngày" },
    ...maintenance,
  ];

  const accounting: SystemSchedule[] = [
    { name: "Crawl báo cáo kế toán hằng ngày", kind: "Crawl", source: "Mac mini", time: "16:10 mỗi ngày", detail: "Tải báo cáo Seller Central rồi đồng bộ dữ liệu. Có thể bắt đầu trễ vài phút." },
    { name: "Crawl bù báo cáo kế toán", kind: "Crawl", source: "Mac mini", time: "17:20 và 18:05 mỗi ngày", detail: "Chạy lại các store còn thiếu đơn hàng hoặc chi phí quảng cáo." },
    { name: "Crawl và nạp báo cáo kế toán tháng", kind: "Crawl", source: "Mac mini", time: "04:30 ngày 2 hằng tháng" },
    { name: "Crawl tồn kho FBA", kind: "Crawl", source: "Mac mini", time: "04:00 thứ Hai và ngày 4 hằng tháng" },
    { name: "Crawl tồn kho AWD", kind: "Crawl", source: "Mac mini", time: "04:00 thứ Tư và ngày 4 hằng tháng" },
    { name: "Crawl báo cáo tiền về", kind: "Crawl", source: "Mac mini", time: "04:30 thứ Hai hằng tuần" },
    { name: "Quét chênh lệch shipment", kind: "Crawl", source: "Mac mini", time: "02:00, khoảng 3 ngày một lần", detail: "Kiểm tra lịch mỗi ngày, quét vào ngày thứ tự trong năm chia hết cho 3 và gửi tổng hợp qua Telegram." },
    { name: "Đồng bộ Google Sheets vào Inventory", kind: "Đồng bộ", source: "Web app", time: `${inventorySheet.hours.map(hour).join(", ")} mỗi ngày`, enabled: inventorySheet.enabled },
    { name: "Tính sẵn Dashboard kế toán", kind: "Đồng bộ", source: "VPS", time: "Kiểm tra mỗi phút", detail: "Worker tính lại khi phiên bản dữ liệu thay đổi." },
    { name: "Báo cáo KPI ngày qua Lark", kind: "Thông báo", source: "VPS", time: "15:00–18:45 mỗi ngày", detail: "Kiểm tra mỗi 15 phút và gửi khi đủ dữ liệu." },
    { name: "Báo cáo KPI tuần qua Lark", kind: "Thông báo", source: "VPS", time: "14:00 thứ Hai hằng tuần" },
    { name: "Tóm tắt tuần qua Lark cá nhân", kind: "Thông báo", source: "VPS", time: "08:00 thứ Hai hằng tuần", detail: "Lịch tùy chọn của Lark worker.", enabled: false },
    { name: "Nhắc đánh giá SKU qua Lark", kind: "Thông báo", source: "Web app", time: `${hour(skuReminder.hour)} ngày ${skuReminder.day} hằng tháng`, enabled: skuReminder.enabled },
    ...maintenance,
  ];

  return { ppc, accounting, externalSchedulesCheckedAt };
}

export type SystemSchedules = ReturnType<typeof getSystemSchedules>;
