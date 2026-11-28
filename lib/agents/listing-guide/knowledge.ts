// Kiến thức nền cho trợ lý hướng dẫn màn "Bảng Trello Kanban & Listing".
// Viết theo logic thật trong components/trello-board-view.tsx, components/listing-workspace.tsx và app/api/trello/

export const LISTING_KNOWLEDGE = `
MÀN HÌNH BẢNG TRELLO KANBAN & LISTING (Tool Listing Amazon):
Mục đích: Lấy các thẻ sản phẩm từ Trello (chứa hình ảnh mockup/thiết kế, tên phôi, SKU, generic keywords), gọi AI tự động sinh nội dung listing chuẩn SEO Amazon và điền vào Template Excel (.xlsx), sau đó đính kèm file Excel lên thẻ Trello và chuyển thẻ sang cột đích.

1. BỐ CỤC CHÍNH VÀ CÁC THÀNH PHẦN:
- Thanh điều khiển trên cùng (Header Controls):
  + AI Model: Chọn model AI sinh nội dung (mặc định Gemini Flash nhanh và tiết kiệm).
  + Thương hiệu (Brand): Chọn brand của shop để AI dùng đúng quy chuẩn và mẫu câu thương hiệu. Có nút "+" để thêm brand mới.
  + Template: Chọn mẫu file Excel theo ngành hàng.
    * Nhãn "Sẵn sàng" (màu xanh): Template đã có đủ ánh xạ các trường bắt buộc, có thể dùng ngay.
    * Nhãn "Cần cấu hình" (màu vàng): Template còn thiếu giá trị bắt buộc, cần bấm nút "+" bên cạnh để cấu hình bổ sung.
  + Lịch Sử Batch: Xem các đợt chạy hàng loạt trước đó, tỉ lệ thành công, tải 1 file ZIP gộp tất cả file Excel của đợt chạy.
  + Làm Mới: Quét lại danh sách thẻ từ Trello theo thời gian thực.
  + Cấu hình Trello (nút bánh răng góc phải): Cài đặt Board ID và 2 cột: Cột đầu (nhận việc) và Cột đích (hoàn thành).

- Cột đầu Listing (Source Column):
  + Chứa các thẻ sản phẩm chờ xử lý lấy từ Trello.
  + Trên mỗi thẻ có: Ảnh preview, mã SKU, tên sản phẩm, các generic keywords gợi ý, link mở trực tiếp trên Trello.
  + Nút "Tạo Listing": Bấm để gọi AI xử lý riêng cho thẻ đó (hoặc người dùng có thể kéo thả thẻ từ cột đầu sang cột đích).
  + Checkbox trên từng thẻ và checkbox "Chọn tất cả" trên đầu cột để chọn nhiều thẻ chạy batch.

- Thanh Batch nổi (Floating Batch Bar):
  + Xuất hiện khi có ít nhất 1 thẻ ở cột đầu được chọn.
  + Nút "Batch Tạo Listing Cho N Thẻ": Chạy tạo listing song song (tối đa 2 thẻ cùng lúc) cho toàn bộ thẻ đã tick.
  + Nút "Bỏ chọn" và nút "Ngắt Batch" khi đang chạy.

- Cột đích Listing (Target Column):
  + Chứa các thẻ sản phẩm đã xử lý hoàn tất có đính kèm file Excel.
  + Nút "Tải Excel": Tải trực tiếp file .xlsx của sản phẩm về máy để nạp lên Seller Central.
  + Có ô tìm kiếm theo SKU/tên sản phẩm và bộ lọc.

2. CÁC ĐIỀU KIỆN ĐỂ TẠO ĐƯỢC LISTING:
- Phải chọn Thương hiệu (Brand).
- Phải chọn Template ở trạng thái "Sẵn sàng".
- Nếu chưa có Board hoặc Cột: Phải cấu hình Trello trước.

3. QUY TRÌNH RA FILE CUỐI CÙNG:
- Cách 1 (Lẻ): Chọn thẻ → Bấm "Tạo Listing" (hoặc kéo thả sang cột đích) → Đợi AI sinh nội dung và đính kèm file → Sang cột đích bấm "Tải Excel".
- Cách 2 (Hàng loạt): Tick chọn các thẻ → Bấm "Batch Tạo Listing Cho N Thẻ" → Hệ thống chạy song song 2 thẻ/lần → Vào "Lịch Sử Batch" bấm "Tải 1 File ZIP".
`;
