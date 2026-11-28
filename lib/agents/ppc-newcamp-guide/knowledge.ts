// Kiến thức về tab PPC "Lên Camp SKU Mới" cho trợ lý hướng dẫn.
// Viết theo logic thật trong components/ppc/ppc-new-camp-view.tsx,
// lib/ppc/new-camp-generator.ts.

export const PPC_NEW_CAMP_KNOWLEDGE = `
# A. TỔNG QUAN CÔNG CỤ LÊN CAMP SKU MỚI
- Mục đích: Dựng bộ khung chiến dịch quảng cáo hoàn chỉnh từ ban đầu cho các SKU mới ra mắt (launch sản phẩm mới), đồng bộ chuẩn hóa tên gọi, ngân sách, cấu trúc ad group và chiến lược đấu thầu theo quy chuẩn công ty.
- 5 bước đánh số tuần tự:
  • Bước 1: Chọn SKU từ Bảng Mã FBA / FBM.
  • Bước 2: Cấu hình chung (Loại hình FBA/FBM tự theo SKU, Trạng thái Test / Win, Ngày lên camp). "Người lên camp" KHÔNG ở bước 2 mà là 1 trong 4 ô lưu kho keyword ở bước 4.
  • Bước 3: Chọn loại chạy & Ngân sách (SP03, SB01, SB05, SP04 Auto, FL Asin).
  • Bước 4: Chuẩn bị file Keyword (Upload / Từ kho / Tạo mới).
  • Bước 5: Xem lại tên chiến dịch & Xử lý trùng lặp.
- ĐẶC ĐIỂM QUAN TRỌNG VỀ ĐẦU RA: Màn Lên Camp SKU Mới KHÔNG đi qua Action Queue. Hai đầu ra thực thi là:
  • TẠO FILE: Tải về một file nén (.zip) chứa từng file Excel Bulksheet format chuẩn của Amazon để tự upload ở Bulk operations của Amazon Ads.
  • Upload lên Amazon: Xếp hàng đẩy qua Mac mini để AdsPower tự động nạp lên Amazon Campaign Manager.
  • CẢNH BÁO SỐNG CÒN: Khi chiến dịch được upload thành công lên Amazon, chúng sẽ ở trạng thái **ĐANG CHẠY (Enabled)** và **HOÀN TOÀN KHÔNG CÓ NÚT HOÀN TÁC TRÊN NCE HUB**.

# B. BƯỚC 1: CHỌN SKU TỪ BẢNG MÃ
- Nguồn SKU: Đọc đồng bộ từ BẢNG MÃ FBA và FBM của hệ thống kế toán / vận hành.
- Phân loại:
  • Kênh: FBA (Fulfillment by Amazon) hoặc FBM (Fulfillment by Merchant). Mỗi lần tạo camp chỉ được chọn các SKU cùng 1 loại hình (chọn FBA thì các SKU FBM sẽ bị mờ và ngược lại).
  • Trạng thái: WIN (sản phẩm chủ lực) hoặc TEST (sản phẩm đang thử nghiệm).
- Thao tác: Gõ tìm kiếm từng SKU, hoặc bấm "Dán danh sách" để paste hàng loạt mã SKU từ bảng kế hoạch.

# C. BƯỚC 2: CẤU HÌNH CHUNG
- Người lên camp: Tên nhân sự phụ trách (ví dụ: Loan, Tri, Manh...). Tên này được ghép cố định vào tên campaign theo quy tắc chuẩn.
- Ngày lên camp: Ngày bắt đầu chạy quảng cáo (mặc định lấy ngày hôm nay, định dạng YYYY-MM-DD).

# D. BƯỚC 3: CHỌN LOẠI CHẠY (CAMPAIGN TYPES) & BUDGET
- 5 loại chiến dịch hỗ trợ:
  1. SP03 (Sponsored Products Keyword): Chiến dịch từ khóa thủ công (cần có file keyword ở Bước 4).
  2. SB01 (Sponsored Brands Product Collection): Bộ sưu tập sản phẩm thương hiệu (cần keyword + thông tin Brand/Logo).
  3. SB05 (Sponsored Brands Video): Video quảng cáo thương hiệu (cần keyword + thông tin Video URL).
  4. SP04 Auto: Chiến dịch Sponsored Products tự động (Auto Targeting gồm 4 nhóm: Close-match, Loose-match, Substitutes, Complements). Không cần file keyword, chỉ cần cài đặt budget và bid cho 4 nhóm.
  5. FL Asin: Chiến dịch định vị sản phẩm đối thủ (Product Targeting). Cần tải lên file ASIN Crawl và nhập mức bid.
- Match Type cho SP03 và SB:
  • Exact: Nhắm mục tiêu từ khóa chính xác.
  • Phrase: Nhắm mục tiêu cụm từ.
  • Broad: Mở rộng.
  • Mỗi match type được tích chọn sẽ sinh ra 1 campaign độc lập tương ứng.
- Ngân sách ngày: Mặc định $5/ngày cho mỗi campaign mới.
- Tùy chọn nâng cao:
  • Tỷ lệ bid Phrase: mặc định = 90% bid Exact.
  • Tỷ lệ bid Broad: mặc định = 80% bid Exact.
  • Bidding strategy: Dynamic bids - down only (mặc định), Dynamic bids - up and down, hoặc Fixed bids.

# E. BƯỚC 4: CHUẨN BỊ FILE KEYWORD & KHO DÙNG CHUNG
- Bắt buộc đối với SP03, SB01, SB05. Ba chế độ nạp:
  1. Upload file: Chọn file Excel (.xlsx) từ máy tính.
  2. Từ kho keyword: Chọn bộ từ khóa đã được lưu sẵn trong kho dùng chung của team.
  3. Tạo mới: Dán danh sách keyword trực tiếp vào ô văn bản, gõ mức bid chung cho toàn bộ từ khóa.
- Bốn trường bắt buộc lưu kho:
  • Dù upload file hay tạo mới, người dùng bắt buộc phải điền đủ 4 ô: **Người lên camp**, **Ngách**, **Phôi**, và **Bộ keyword**.
  • Mục đích: File sẽ được tự động lưu trữ vào Kho Keyword dùng chung của công ty để các nhân sự khác có thể tái sử dụng cho các đợt chạy sau.
- Quy tắc giá Bid: Mọi từ khóa phải có giá bid hợp lệ tối thiểu từ **$0.02 trở lên**.

# F. THÔNG TIN SPONSORED BRANDS (SB01 & SB05)
- Khi bật SB01 hoặc SB05, panel "Thông tin SB còn thiếu" sẽ xuất hiện nếu SKU hoặc Store chưa có đủ dữ liệu trong BẢNG MÃ.
- Các trường cần bổ sung: Brand Entity ID, Brand Name, Logo URL (đối với SB01) và Video URL (đối với SB05).
- Có thể dùng ô "Điền chung" ở trên cùng để áp dụng nhanh thông tin cho toàn bộ các SKU đang chọn.

# G. SỬA LỖI KHI BẤM TẠO (DANH SÁCH THIẾU & TRÙNG TÊN)
- Panel cảnh báo màu đỏ xuất hiện ở chân trang nếu người dùng bấm "TẠO FILE" hoặc "Upload lên Amazon" khi chưa hoàn tất mọi điều kiện.
- Mỗi lỗi có nút **"Đi tới"**: bấm vào sẽ tự động cuộn màn hình đến chính xác bước đang bị thiếu để người dùng bổ sung ngay lập tức.
- Xử lý camp đã có trên Amazon: Nếu Bước 5 xuất hiện ô màu đỏ báo "camp đã có trên Amazon", người dùng cần nhập thêm **"Đuôi tên"** (ví dụ: v2, 0526...) để tên chiến dịch không bị trùng lặp với các campaign cũ đang chạy.

# H. SO SÁNH: TÔI NÊN DÙNG MÀN NÀO TRONG PPC?
- Đề Xuất & Auto Bid: Dùng định kỳ khi muốn hệ thống tự động tính toán tăng/giảm bid cho các target dựa trên hiệu suất ACOS và thuật toán chuẩn.
- Chỉnh Bid Tay (Manual Bid): Dùng khi muốn chủ động kiểm soát hoàn toàn, xem bảng lưới phong cách Excel theo từng SKU, phân nấc ACOS (A20, A40, A60, A60P, 0 đơn) và chỉnh bid linh hoạt từng ô hoặc hàng loạt.
- Negative Keyword: Dùng để CẮT LỖ khẩn cấp các search terms tốn tiền mà không ra đơn, hoặc phủ định danh sách từ khóa rác cho cả ASIN.
- Lên Camp Sale KW: Dùng để MỞ RỘNG các search term đang ra đơn tốt (Orders > 2) thành các campaign Manual mới để tập trung ngân sách và đẩy mạnh doanh thu.
- Lên Camp SKU Mới: Dùng khi vừa launch sản phẩm hoặc tạo SKU mới, cần dựng bộ khung campaign hoàn chỉnh từ đầu (SP03, SB01, SB05, SP04 Auto).
`;
