// Kiến thức về tab PPC "Negative Keyword" (ST Optimization) cho trợ lý hướng dẫn.
// Viết theo logic thật trong components/ppc/ppc-st-optimization-view.tsx,
// ppc-negative-list-view.tsx, ppc-negative-hub-view.tsx.

export const PPC_NEGATIVE_KNOWLEDGE = `
# A. TỔNG QUAN TAB NEGATIVE KEYWORD (ST OPTIMIZATION)
- Mục đích: Cắt lỗ chi tiêu quảng cáo bằng cách phát hiện các Customer Search Terms tiêu tốn ngân sách nhưng không mang lại đơn hàng nào, hoặc phủ định chủ động danh sách từ khóa rác cho toàn bộ chiến dịch của ASIN.
- 3 tab con chính:
  1. Đề Xuất Phủ Định ST: Hệ thống tự động quét và lọc search terms vi phạm luật lãng phí (Orders = 0, Clicks > 20).
  2. Negative List: Người dùng tự dán danh sách keyword (từ Google Sheet hoặc file research) để phủ định đồng loạt cho mọi campaign của 1 ASIN.
  3. Negative Hub (Danh Sách Đã Phủ Định): Nơi lưu trữ tập trung lịch sử mọi đợt phủ định đã thực thi thành công lên Amazon, theo dõi số tiền lãng phí đã chặn.
- ĐẶC ĐIỂM QUAN TRỌNG VỀ ĐẦU RA: Màn Negative Keyword KHÔNG đi qua Action Queue. Mỗi thao tác có đầu ra trực tiếp:
  • Xuất File Bulksheet (.xlsx) để tự tải lên Amazon Campaign Manager.
  • Auto Upload AdsPower qua máy Mac mini.
  • Phủ định đã lên Amazon thì KHÔNG có nút gỡ tự động trên web NCE Hub.

# B. TAB CON 1: ĐỀ XUẤT PHỦ ĐỊNH ST
- Quy tắc phát hiện lãng phí:
  • Mặc định: Orders = 0 VÀ Clicks > 20.
  • Có ô điều chỉnh ngưỡng Clicks: có thể chọn toán tử ">" hoặc ">=" và nhập số click mong muốn (ví dụ: 10, 15).
  • Tìm kiếm & Lọc: Có ô lọc nhanh theo Source Campaign và ô tìm kiếm từ khóa.
- 4 thẻ thống kê số tiền lãng phí:
  • Search Terms vi phạm: Tổng số từ thỏa mãn điều kiện lọc.
  • Tổng Clicks lãng phí: 100% click không tạo ra chuyển đổi.
  • Tiền lãng phí (Cắt lỗ): Tổng số tiền Spend đã tiêu tốn cho các từ này (đây chính là số tiền tiết kiệm được sau khi phủ định).
  • Source Campaign: Số lượng chiến dịch nguồn có chứa các từ lãng phí này.
- Tùy chọn "Ẩn từ khóa đã phủ định": Mặc định BẬT để tự động tra cứu với Negative Hub và ẩn các từ đã được phủ định trước đó, tránh làm trùng.
- Cơ chế an toàn (Source Campaign Isolation):
  • Toàn bộ search terms ở tab này được phủ định dưới dạng **Negative Exact** ở cấp **Campaign/Ad Group nguồn**.
  • Hệ thống tra đúng Campaign ID và Ad Group ID sinh ra từ đó, hoàn toàn KHÔNG phủ định sang các campaign khác (nếu từ này hiệu quả ở campaign khác thì vẫn chạy bình thường).
- Chọn phạm vi thực thi:
  • Có thể tick chọn từng dòng, hoặc tick checkbox ở tiêu đề để chọn cả trang.
  • LƯU Ý ĐẶC BIỆT: Nếu KHÔNG TICK DÒNG NÀO, khi bấm Xuất Bulksheet hoặc Auto Upload, hệ thống sẽ tự động áp dụng cho TẤT CẢ các từ đang hiển thị trong bộ lọc!
- Hai đầu ra:
  • Xuất Bulksheet: Tải file Excel format chuẩn Amazon Bulk Operations. Ngay khi tải file, các từ được ghi thẳng vào Negative Hub (không qua "Lô chờ xác nhận", không cần bấm "Đã upload") — vì vậy phải nhắc người dùng nhớ tự upload file lên Amazon. "Lô chờ xác nhận" + nút "Đã upload" CHỈ có ở tab con Negative List.
  • ⚡ Auto Upload AdsPower: Mở modal xem trước và xác nhận. Bấm "Xác Nhận & Đẩy Lên Amazon" sẽ tạo job đẩy sang Mac mini để AdsPower tự động nạp lên Amazon Campaign Manager.

# C. TAB CON 2: NEGATIVE LIST
- Mục đích: Phủ định chủ động theo danh sách nghiên cứu sẵn cho 1 ASIN/SKU cụ thể.
- Bước 1 - Tìm ASIN/SKU: Gõ mã ASIN hoặc SKU vào ô tìm kiếm, chọn sản phẩm từ dropdown. Hệ thống sẽ tự động tải danh sách toàn bộ các chiến dịch đang chạy quảng cáo của ASIN đó.
- Bước 2 - Chọn Match Type:
  • Negative Phrase: Phủ định cụm từ (thường dùng để loại bỏ danh sách từ khóa rác).
  • Negative Exact: Phủ định chính xác từng từ.
- Bước 3 - Dán danh sách keyword: Copy cột keyword từ Google Sheet dán vào khung text (mỗi dòng 1 từ). Hệ thống tự động chuẩn hóa, bỏ từ trùng lặp và loại bỏ các dòng tiêu đề như "negative phrase kw", "keyword"...
- Bước 4 - Chọn Campaign áp dụng:
  • Danh sách gom theo SKU / ASIN, hiển thị loại chiến dịch (SP, SB, SD), số click, spend, order.
  • LƯU Ý QUAN TRỌNG: Chiến dịch Sponsored Display (SD) KHÔNG hỗ trợ Negative Keyword trên Amazon, hệ thống sẽ tự động khóa checkbox của các campaign SD.
- Hai đầu ra của Negative List:
  • ⚡ Auto Upload phủ định: Đẩy job lên Mac mini, tự động chạy và tự chuyển sang Negative Hub khi hoàn tất.
  • Xuất File: Tạo file Bulksheet tải về máy. Lô này sẽ được đưa vào mục "Lô chờ xác nhận (Pending Batches)".
- Mục "Lô chờ xác nhận":
  • Khi người dùng chọn "Xuất File", lô nằm ở bảng này và CHƯA được tính là đã phủ định.
  • Sau khi người dùng tự upload file lên Amazon Ads thành công, phải bấm nút **"Đã upload"** để hệ thống xác nhận và chuyển lô sang Negative Hub. Nút này chạy ngay lập tức.
  • Tại mỗi lô chờ, có thể bấm "Huỷ lô" hoặc bấm "Auto Upload" nếu đổi ý muốn Mac mini upload hộ.

# D. TAB CON 3: NEGATIVE HUB (DANH SÁCH ĐÃ PHỦ ĐỊNH)
- Nơi lưu trữ tập trung toàn bộ các đợt phủ định đã thực thi thành công lên Amazon (cả từ Auto Upload và từ lô Xuất File đã xác nhận).
- Bốn thẻ tổng quan: Tổng dòng phủ định, Tổng chi phí lãng phí đã chặn ($), Số chiến dịch được bảo vệ, Tổng số lô (job).
- Bảng lịch sử các lô:
  • Xem rõ: Phương thức đưa lên (Auto Upload / Xuất File), Nguồn, Match type, Store, Tên file, Thời gian, Người thực hiện, Số keyword, Số campaign, Số dòng và Tiền đã chặn.
  • Bấm vào mũi tên đầu dòng để mở rộng xem chi tiết danh sách từng keyword và từng campaign được áp dụng.
- CẢNH BÁO SỐNG CÒN KHI BẤM "XOÁ LÔ":
  • Nút thùng rác ở cuối mỗi dòng chỉ xóa bản ghi lưu vết trên hệ thống NCE Hub.
  • Thao tác này HOÀN TOÀN KHÔNG GỠ PHỦ ĐỊNH TRÊN AMAZON!
  • Muốn gỡ phủ định một từ khóa đã lên Amazon, nhân sự bắt buộc phải đăng nhập Seller Central để gỡ bằng tay.

# E. CÂU HỎI CHUNG: TÔI NÊN DÙNG MÀN NÀO TRONG PPC?
- Đề Xuất & Auto Bid: Dùng định kỳ khi muốn hệ thống tự động tính toán tăng/giảm bid cho các target dựa trên hiệu suất ACOS và thuật toán chuẩn.
- Chỉnh Bid Tay (Manual Bid): Dùng khi muốn chủ động kiểm soát hoàn toàn, xem bảng lưới phong cách Excel theo từng SKU, phân nấc ACOS (A20, A40, A60, A60P, 0 đơn) và chỉnh bid linh hoạt từng ô hoặc hàng loạt.
- Negative Keyword: Dùng để CẮT LỖ khẩn cấp các search terms tốn tiền mà không ra đơn, hoặc phủ định danh sách từ khóa rác cho cả ASIN.
- Lên Camp Sale KW: Dùng để MỞ RỘNG các search term đang ra đơn tốt (Orders > 2) thành các campaign Manual mới để tập trung ngân sách và đẩy mạnh doanh thu.
- Lên Camp SKU Mới: Dùng khi vừa launch sản phẩm hoặc tạo SKU mới, cần dựng bộ khung campaign hoàn chỉnh từ đầu (SP03, SB01, SB05, SP04 Auto).
`;
