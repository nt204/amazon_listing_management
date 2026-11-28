// Kiến thức về tab PPC "Chỉnh Bid Tay" (Manual Bid) cho trợ lý hướng dẫn.
// Viết theo logic thật trong components/ppc/ppc-manual-bid-view.tsx, lib/ppc/manual-bid.ts,
// ppc-floating-action-queue.tsx, ppc-action-queue-drawer.tsx.

export const PPC_MANUAL_BID_KNOWLEDGE = `
# A. TỔNG QUAN TAB CHỈNH BID TAY (MANUAL BID)
- Mục đích: Khác với tab "Đề xuất & Auto Bid" (hệ thống tự động chấm theo luật cài sẵn), tab "Chỉnh Bid Tay" trao toàn quyền kiểm soát cho nhân sự PPC:
  • Xem toàn bộ target trong mọi campaign (SP03, SB05, SB01, SD) của từng SKU dưới dạng bảng lưới phong cách Excel.
  • Tự động phân nấc ACOS trực quan để phát hiện ngay các target đang hiệu quả hoặc đang chảy máu tiền.
  • Chỉnh sửa mức bid trực tiếp trên từng ô hoặc dùng bộ công cụ tính toán hàng loạt (Nhân %, Cộng/trừ, Set mức, Pause).
  • Đưa các target đã chỉnh sửa vào Action Queue chung của store để kiểm tra lần cuối trước khi đẩy lên Amazon.
- Kỳ dữ liệu: Nút chọn kỳ 7D / 14D / 30D / 60D ở thanh điều hướng trên cùng (mặc định 30D). Toàn bộ số liệu Spend, Sales, ACOS, Click, Order... của SKU và từng target đều tính theo kỳ này.
- Store: Phải chọn đúng 1 store cụ thể. Chọn "Tất cả store" thì màn hình sẽ yêu cầu chọn store.

# B. BẢNG SKU & TỒN KHO
- Ô tìm SKU: Tìm nhanh theo mã SKU hoặc ASIN. Nếu gõ đúng mã SKU khớp duy nhất 1 sản phẩm thì Enter sẽ tự động mở thẳng lưới target của SKU đó.
- Lọc SKU:
  • Trạng thái SKU: Active, Discontinued, Out of Stock...
  • Phôi, Niche, PIC Marketing: Lọc theo loại sản phẩm, thị trường ngách, và nhân sự phụ trách marketing (đồng bộ từ Cost Master / Bảng Mã của store).
  • Nút "Lọc": Lọc theo khoảng số Spend, Sales, ACOS, Tồn kho, Click, Order.
  • "Gồm paused": Mặc định chỉ lấy target và campaign đang chạy. Tích chọn để xem cả các SKU / campaign đã tạm dừng.
- Cột bảng SKU:
  • Mockup: Rê chuột vào ảnh thumbnail để phóng to xem nhanh thiết kế.
  • Mã SKU & Trạng thái: Cạnh mã SKU có badge trạng thái và số hành động đang chờ trong Action Queue (nếu có).
  • Các chỉ số: Impression, Click, Order, Spend, Sales, ACOS (bọc pill màu theo nấc).
  • Tồn kho & Giá trị tồn: Tồn real-time FBA + AWD (available + inbound + reserved) từ crawler kế toán; Giá trị tồn = Tồn × Giá vốn TB năm.
  • Cột 7 ngày (Sparkline): Biểu đồ mini xu hướng Spend và Sales trong tuần, bấm vào để mở phân tích chi tiết.

# C. CHI TIẾT TARGET CỦA SKU & DẠNG CHẠY
- Mở chi tiết: Bấm vào bất kỳ dòng SKU nào trong bảng để mở lưới target.
- Nút quay lại (←): Nút mũi tên góc trái trên cùng để đóng chi tiết và quay lại danh sách SKU.
- Tìm kiếm target: Ô "Tìm target, campaign..." tìm nhanh từ khoá hoặc tên campaign trong SKU.
- Lọc khoảng số target: Nút "Lọc" lọc riêng các target trong SKU theo khoảng Spend, Sales, ACOS, Click, CVR, SV...
- Phân nhóm dạng chạy: Hệ thống tự động gom target theo dạng campaign đọc từ tên chiến dịch:
  • SP03: Sponsored Products (luôn ưu tiên xếp đầu và tự động chọn nếu có).
  • SB05: Sponsored Brands Video.
  • SB01: Sponsored Brands.
  • SD: Sponsored Display.

# D. PHÂN NẤC ACOS (TIERS) & CHIP ĐÃ SỬA
- Dải chip phân nấc tự động cho mọi target:
  • A20 (ACOS ≤ 20%): Màu xanh lá — nhóm target hiệu quả cao, chuyển đổi tốt, có thể cân nhắc tăng bid để đẩy volume.
  • A40 (ACOS 20–40%): Màu xanh lam — nhóm ổn định, ACOS kiểm soát tốt.
  • A60 (ACOS 40–60%): Màu vàng cam — nhóm ACOS hơi cao, cần theo dõi hoặc hạ nhẹ bid.
  • A60P (ACOS > 60%): Màu đỏ hồng — nhóm vượt ACOS mục tiêu, nguy cơ lỗ sau quảng cáo, cần giảm bid.
  • NO_ORDER (0 Đơn): Màu tím — target có clicks > 7 nhưng chưa ra đơn hàng nào trong kỳ. Đây là nhóm "chảy máu tiền", cần giảm bid mạnh hoặc Dừng.
  • OTHER: Màu xám — target có ít click, chưa đủ dữ liệu đánh giá.
- Thao tác nấc: Bấm 1 nấc để xem riêng nấc đó; bấm lại nấc đang xem để quay về Tất cả. Giữ ⌘ (Mac) hoặc Ctrl (Windows) khi bấm để chọn kết hợp nhiều nấc.
- Chip "Đã sửa": Gom toàn bộ target bạn đã chỉnh bid của SKU này (xuyên suốt mọi dạng chạy SP/SB/SD). Bấm thường = lọc chỉ target đã sửa; giữ ⌘/Ctrl = kết hợp với nấc.

# E. BẢNG TARGET (LƯỚI EXCEL)
- Giao diện bảng tính Excel:
  • 4 cột cố định bên trái khi cuộn ngang: Checkbox chọn dòng, STT # (đổi màu theo nấc ACOS), Target (từ khoá/ASIN), Campaign Name (kèm tooltip ad group).
  • Các cột chỉ số: Match Type, SV (Search Volume Helium), Org Rank, SP Rank, Impression, Click, Order, Spend, Sales, ACOS badge, CPC.
  • Cột Bid hiện tại: Mức bid đang áp dụng trên Amazon. Nếu target đang có thay đổi chờ trong Action Queue sẽ hiện dòng tím "(chờ: $...)".
  • Cột Bid mới: Ô nhập mức bid mới do bạn chỉnh sửa.
  • Dòng Tổng: Dính cố định ngay dưới tiêu đề cột, tổng hợp toàn bộ Impression, Click, Order, Spend, Sales, ACOS và CPC của các target đang xem.
  • Tùy chỉnh cột: Kéo vạch ngăn giữa 2 tiêu đề cột để thay đổi độ rộng; bấm nút ▾ ở tiêu đề cột để sắp xếp hoặc lọc giá trị.

# F. CHỈNH SỬA BID TỪNG TARGET
- Nhập trực tiếp: Click vào ô Bid mới của dòng cần sửa, gõ số bid mong muốn.
- Phím tắt như Excel:
  • Enter, Tab hoặc phím Mũi tên xuống (↓): Lưu ô hiện tại và tự động chuyển con trỏ sang ô Bid mới của dòng tiếp theo.
  • Phím Mũi tên lên (↑) hoặc Shift+Tab: Chuyển con trỏ lên dòng trước.
- Mẹo thao tác nhanh:
  • Nhấp đúp chuột vào ô Bid mới: Tự động copy mức bid hiện tại sang để bạn chỉ việc gia giảm nhẹ.
  • Dán (paste) nhiều dòng từ Excel: Copy một cột số từ file Excel rồi bấm Ctrl+V vào ô đầu tiên, hệ thống sẽ tự động dán lần lượt vào các ô Bid mới phía dưới.
- Màu sắc trực quan: Ô Bid mới tự đổi sang nền xanh lá nếu bạn tăng bid, hoặc nền đỏ hồng nếu bạn giảm bid.
- Nút "Huỷ (N)": Xuất hiện khi có nháp chưa duyệt; bấm vào để xoá toàn bộ các mức bid nháp đang gõ dở.

# G. CHỈNH BID HÀNG LOẠT (BATCH BID OPERATIONS)
- Chọn nhiều dòng:
  • Tích ô checkbox ở tiêu đề để chọn tất cả target đang hiển thị.
  • Tích từng ô checkbox của dòng.
  • "Tô" vùng chọn bằng chuột: Nhấn giữ chuột trái ở một dòng rồi kéo dọc xuống để chọn liên tiếp cả một cụm target như trên Excel.
- Thanh công cụ hàng loạt (hiện khi có ≥ 1 dòng được chọn):
  • Cụm "Nhân": Gõ hệ số hoặc phần trăm rồi Enter. Ví dụ: gõ "95%" hoặc "0.95" để giảm 5% bid; gõ "110%" hoặc "1.1" để tăng 10% bid.
  • Cụm "Cộng / trừ": Gõ số tiền kèm dấu rồi Enter. Ví dụ: gõ "+0.1" để cộng thêm $0.10; gõ "-0.25" để giảm $0.25 vào bid hiện tại.
  • Cụm "Set $": Gõ mức bid cố định rồi Enter. Ví dụ: gõ "0.75" thì toàn bộ target được chọn sẽ nhận mức bid $0.75.
  • Nút "Dừng": Chuyển toàn bộ target được chọn sang trạng thái Pause (dừng target).

# H. DUYỆT VÀ ĐẦU RA (ACTION QUEUE → BULK / AUTO UPLOAD)
- Nút "Duyệt (N)": Nút màu tím ở góc phải; hiển thị số target bạn đã chỉnh sửa. Bấm Duyệt sẽ gom toàn bộ các thay đổi vào Action Queue chung của store.
- BẤM DUYỆT ĐÃ ĐỔI GÌ TRÊN AMAZON CHƯA?
  • CHƯA! Duyệt chỉ mới chuyển các thay đổi vào Action Queue của hệ thống để gom chung. Dữ liệu trên Amazon Ads hoàn toàn chưa đổi.
  • Muốn áp dụng lên Amazon, bạn BẮT BUỘC phải thực hiện một trong hai đầu ra từ Action Queue.
- Action Queue (Nút nổi màu xanh ở góc màn hình):
  • Mở drawer xem toàn bộ hành động gom theo SKU: Target, Chiến dịch, Loại hành động (Update Bid / Pause), Old Bid → New Bid.
  • Trong Action Queue bạn vẫn có thể nhấp vào New Bid để gõ sửa lại số tiền, hoặc bấm Xoá từng hành động nếu duyệt nhầm.
- ĐẦU RA 1: "Xuất Bulk File"
  • Bấm nút "Xuất Bulk File" trong Action Queue.
  • Hộp thoại kiểm tra hợp lệ: Kiểm tra ID chiến dịch, mức bid hợp lệ, trần bid.
  • Bấm "Tải Amazon Bulk File (.xlsx)" để tải file bảng tính về máy tính.
  • BƯỚC BẮT BUỘC: Bạn phải tự đăng nhập vào Amazon Advertising console → Sponsored ads → Bulk operations để upload file này lên. Nếu không upload, Amazon sẽ không đổi bid!
- ĐẦU RA 2: "Auto Upload AdsPower"
  • Bấm nút "Auto Upload AdsPower" trong Action Queue.
  • Chế độ an toàn: Với SKU chưa cắn tiền, hệ thống cho phép upload ngay. Với SKU đang cắn tiền, hệ thống hiện khung cảnh báo màu vàng yêu cầu bạn kiểm tra kỹ và tích xác nhận.
  • Chọn phạm vi: Tất cả SKU hoặc chỉ một số SKU cụ thể.
  • Bấm "⚡ Bắt Đầu Auto Upload": Hệ thống sẽ chuyển file sang máy server Mac mini chuyên dụng. Trình duyệt AdsPower sẽ tự động mở profile store tương ứng và tải file lên Amazon.
  • Theo dõi trạng thái trong mục "Kết quả thực thi": Đang chờ upload → Đang thực thi → Áp dụng thành công / Thất bại. Nếu thất bại có nút "Upload lại".
`;
