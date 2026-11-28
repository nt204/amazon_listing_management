// Kiến thức về tab PPC "Lên Camp Sale KW" cho trợ lý hướng dẫn.
// Viết theo logic thật trong components/ppc/ppc-sale-kw-view.tsx.

export const PPC_SALE_KW_KNOWLEDGE = `
# A. TỔNG QUAN TAB LÊN CAMP SALE KW
- Mục đích: Khai thác các Customer Search Terms đã chứng minh có khả năng chuyển đổi đơn hàng tốt (Orders > 2) trong các chiến dịch cũ (Auto, Broad, Phrase), tách chúng ra thành các chiến dịch Manual độc lập nhằm dồn ngân sách và scale doanh số tối đa.
- Cơ chế gom nhóm: Hệ thống tự động gom các search terms theo từng SKU. Người dùng có thể chọn sinh ra các chiến dịch theo match type:
  • Exact: Nhắm mục tiêu chính xác từ khóa đó.
  • Phrase: Nhắm mục tiêu cụm từ.
  • Broad: Mở rộng biến thể.
- ĐẶC ĐIỂM QUAN TRỌNG VỀ ĐẦU RA: Màn Lên Camp Sale KW KHÔNG đi qua Action Queue. Mỗi thao tác tạo camp có đầu ra trực tiếp:
  • Xuất File Bulksheet (.xlsx) theo format chuẩn Amazon Bulk Operations để người dùng tự upload lên Seller Central.
  • ⚡ Auto Upload AdsPower qua máy Mac mini.
  • Sau khi xuất file hoặc upload, chiến dịch được ghi nhận vào Quản trị Registry.

# B. LỌC SEARCH TERM TIỀM NĂNG & THẺ CHỈ SỐ
- Quy tắc lọc mặc định:
  • Orders > 2 (có thể đổi toán tử sang ">=" hoặc điều chỉnh số đơn).
  • Tìm kiếm từ khóa hoặc lọc theo từng SKU cụ thể.
- Tùy chọn "Ẩn ST đã lên Camp": Mặc định BẬT để tự động tra cứu với Registry và ẩn các search terms đã được lên chiến dịch trước đó, tránh tạo trùng.
- Tùy chọn "Phủ định Exact ở Camp cũ" (MẶC ĐỊNH TẮT — người dùng phải tự tick; nên khuyên tick):
  • Khi tick: tạo chỉ thị Negative Exact cho search term đó trong chính Campaign nguồn (cũ).
  • Mục đích: Chuyển đổi lưu lượng mượt mà, ngăn chặn hai chiến dịch (cũ và mới) cùng store tự đấu thầu cạnh tranh lẫn nhau làm đẩy giá CPC lên cao.
- 6 thẻ số liệu tổng hợp:
  • ST Tiềm năng: Tổng số search terms thỏa mãn điều kiện lọc.
  • SKU đủ chuẩn: Số lượng SKU có từ khóa ra đơn.
  • Số Camp sẽ lên: Dự kiến số lượng campaign sẽ sinh ra dựa trên match type đã bật.
  • Tổng Orders & Doanh thu: Số đơn hàng và tổng sales mà các từ này đã mang lại trong kỳ.
  • CPC Trung Bình: Mức giá click trung bình thực tế.

# C. CẤU HÌNH CHIẾN DỊCH (CAMPAIGN PARAMETERS)
- Người dùng: Tên nhân sự phụ trách (ví dụ: Loan, Tri, Manh...), được tự động gắn vào cú pháp tên chiến dịch.
- Dạng chạy:
  • SP03: Sponsored Products (sản phẩm tài trợ).
  • SB01: Sponsored Brands Collection (nhãn UI "SB01 Collection").
  • SB05: Sponsored Brands Video.
- Ngày: Chuỗi 8 chữ số (ví dụ: 20260430) gắn vào đuôi tên chiến dịch để nhận biết ngày tạo.
- Budget: Ngân sách hàng ngày cho mỗi campaign mới sinh ra (mặc định $5/ngày).
- Chế độ Bid:
  • CPC TB từng term (Khuyên dùng): Lấy đúng mức CPC thực tế mà term đó đã cắn tiền trong quá khứ để nạp làm bid khởi điểm, giúp chiến dịch mới có vị trí hiển thị chuẩn xác ngay từ đầu.
  • Cố định: Đặt một mức bid chung cho toàn bộ từ khóa.

# D. LÊN CAMP SPONSORED BRANDS (SB01 & SB05)
- Tỷ lệ % Bid SB: Vì CPC quá khứ phần lớn đến từ SP, hệ thống cho phép cài đặt tỷ lệ % bid riêng cho SB (mặc định SB01 = 80%, SB05 = 90% CPC TB của term).
- Điều kiện an toàn: Để Auto Upload chiến dịch SB, store và SKU bắt buộc phải có đầy đủ thông tin Brand Entity ID, Logo URL hoặc Video URL trong BẢNG MÃ (Cost Master). Nếu thiếu, nút Auto Upload bị khoá (kèm lý do), nhưng "Xuất Bulksheet" vẫn dùng được. Thẻ SKU thiếu thông tin có khung viền đỏ.

# E. QUẢN TRỊ REGISTRY (LỊCH SỬ CHIẾN DỊCH ĐÃ LÊN)
- Tab Quản trị Camp Sale KW (Registry) lưu vết toàn bộ các campaign đã từng được xuất file hoặc Auto Upload. Cả "Xuất Bulksheet" lẫn "Auto Upload" đều ghi vào Registry NGAY khi bấm (Xuất Bulksheet xong phải nhớ tự upload file).
- Hiển thị đầy đủ: Campaign đích (Mới), Kênh FBA/FBM, Match type, SKU, Từ khóa, Campaign nguồn (Cũ), Orders, Sales, Nguồn tạo, Thời gian.
- CẢNH BÁO ĐẶC BIỆT KHI XÓA MỤC TRONG REGISTRY:
  • Nút "Xóa n mục đã chọn" CHỈ xóa dòng lưu vết trên cơ sở dữ liệu của NCE Hub (để từ khóa có thể hiện lại trong tab Lên Camp).
  • Thao tác này HOÀN TOÀN KHÔNG XÓA HOẶC TẮT CHIẾN DỊCH TRÊN AMAZON!
  • Muốn xóa hoặc tắt camp thật trên Amazon Ads, nhân sự bắt buộc phải vào Seller Central để thao tác.

# F. SO SÁNH: TÔI NÊN DÙNG MÀN NÀO TRONG PPC?
- Đề Xuất & Auto Bid: Dùng định kỳ khi muốn hệ thống tự động tính toán tăng/giảm bid cho các target dựa trên hiệu suất ACOS và thuật toán chuẩn.
- Chỉnh Bid Tay (Manual Bid): Dùng khi muốn chủ động kiểm soát hoàn toàn, xem bảng lưới phong cách Excel theo từng SKU, phân nấc ACOS (A20, A40, A60, A60P, 0 đơn) và chỉnh bid linh hoạt từng ô hoặc hàng loạt.
- Negative Keyword: Dùng để CẮT LỖ khẩn cấp các search terms tốn tiền mà không ra đơn, hoặc phủ định danh sách từ khóa rác cho cả ASIN.
- Lên Camp Sale KW: Dùng để MỞ RỘNG các search term đang ra đơn tốt (Orders > 2) thành các campaign Manual mới để tập trung ngân sách và đẩy mạnh doanh thu.
- Lên Camp SKU Mới: Dùng khi vừa launch sản phẩm hoặc tạo SKU mới, cần dựng bộ khung campaign hoàn chỉnh từ đầu (SP03, SB01, SB05, SP04 Auto).
`;
