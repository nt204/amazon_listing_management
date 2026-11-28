// Kiến thức về tab PPC "Đề xuất & Auto Bid" cho trợ lý hướng dẫn. Viết theo code thật (ngày 2026-11-28):
//   lib/ppc/sku-architecture-service.ts (rule engine, BE ACoS, Max Bid, duyệt), lib/ppc/auto-decrease.ts,
//   lib/ppc/action-outcome-evaluator.ts + lib/ppc/bid-evaluator/*, components/ppc/ppc-sku-recommendation-group.tsx.
// Ngưỡng luật (ACoS / click / %) KHÔNG ghi ở đây: lưu trong bảng ppc_rule_versions, admin sửa được → tool get_bid_rules.
// Sửa logic ở các file trên thì sửa lại đoạn tương ứng ở đây.

export const PPC_AUTOBID_KNOWLEDGE = `
# A. LUỒNG CHUNG
- Đề xuất tính RIÊNG từng store; chọn "Tất cả store" thì tab không hiện đề xuất ("Vui lòng chọn một Store cụ thể").
- Kỳ dữ liệu = nút 7D / 14D / 30D / 60D góc trên phải (không dùng ngày tuỳ chọn). 30D (không gồm paused) được tính sẵn mỗi ngày nên mở nhanh; kỳ khác tính khi mở. Store không có báo cáo đúng độ dài kỳ (±3 ngày) thì có thể trống.
- Kết quả được lưu đệm tới 24h; tự tính lại khi có báo cáo mới, hoặc khi ai đó sửa giá vốn / Max Bid / luật.
- Quy trình: xem đề xuất → (sửa Final Bid) → Duyệt vào Action Queue → Xuất Bulk File hoặc Auto Upload → Amazon áp dụng → theo dõi ở Kết quả Auto Bid.

# B. TARGET NÀO ĐƯỢC CHẤM
- Chỉ target (keyword / ASIN) đang bật, không phải negative, ad group bật, campaign đang chạy (tích "Gồm paused" thì xét thêm target trong campaign đang paused — bản thân target vẫn phải đang bật).
- Dạng chạy đọc từ TÊN campaign: chứa "SB05" hoặc "VIDEO" → SB05 (Sponsored Brands Video); "SB01" → SB01 (Sponsored Brands); "SP03" → SP03 (Sponsored Products). Campaign tên SP01 / SP02 / SP04 KHÔNG được chấm.
- SKU của target lấy từ cột SKU, hoặc chữ đầu tên campaign.
- SKU không có đề xuất nếu: Lỗi Prefix, thiếu dữ liệu kinh tế, Max Bid = 0 hoặc BE ACoS = 0.

# C. CÁCH RA ĐỀ XUẤT (luật — ngưỡng cụ thể gọi get_bid_rules)
- Target CÓ đơn trong kỳ → so ACoS của chính target (Spend/Sales) với các vùng ACoS của luật. CHƯA có đơn → so số click.
- Mỗi vùng có hành động: Tăng x%, Giảm x%, Hold (giữ — không hiện đề xuất), Pause.
- Target phải khớp ĐÚNG 1 vùng; khớp 0 hoặc 2 vùng (giá trị nằm đúng mép giữa 2 vùng) thì không có đề xuất.
- Ngưỡng click KHÔNG đổi theo kỳ: kỳ 7D ít click hơn 30D nên ít giảm / pause hơn.
- Bid mới:
  • Tăng = bid hiện tại × (1 + %).
  • Giảm = CPC trung bình (Spend/Clicks) × (1 − %). Vì tính từ CPC trung bình nên đôi khi kết quả lại CAO hơn bid hiện tại → hệ thống ghi lại là "Tăng Bid" theo đúng hướng thay đổi.
  • Pause = tắt target (bid đề xuất hiển thị "Pause").
  • Kết quả kẹp tại TRẦN, làm tròn 2 số lẻ, KHÔNG ép sàn tối thiểu. Bị kẹp thì lý do ghi "Kết quả tính toán được chặn tại trần hiệu lực $X".
  • Bid hiện tại đã CAO HƠN trần → không đề xuất tăng / giảm (chỉ còn có thể Pause).
  • Bid mới = bid hiện tại → không có đề xuất.
  • Báo cáo không có bid → dùng CPC trung bình (hoặc bid tối thiểu của luật) làm "bid hiện tại".
- Đề xuất giảm 15% trở lên / pause được ưu tiên cao (P0).

# D. BE ACoS, MAX BID, TRẦN
- Lãi trước quảng cáo = Giá bán − phí Amazon − Basecost − Giá × thuế (mặc định 3%).
- BE ACoS (ACoS hòa vốn) = Lãi trước QC ÷ Giá bán × 100. ACoS > BE ACoS = bán lỗ sau quảng cáo.
- Giá bán dùng theo thứ tự: nhập tay → giá thực tế từ đơn quảng cáo → Cost Master → đơn kế toán.
- Max Bid (trần của SKU) = CR × Lãi trước QC; CR mặc định 10%; tối thiểu $0.05.
- Trần thực tế theo dạng chạy: SP03 = 100% Max Bid; SB01 / SB05 = 80% Max Bid (hệ số trong luật — get_bid_rules trả maxBidFactor).
- Sửa Max Bid: trong chi tiết SKU, biểu tượng bút cạnh "Max Bid" → nhập > $0 và ≤ $100 → Enter. Hiện "Sửa tay · tự tính $X", nút "Bỏ" quay về số tự tính. SKU Lỗi Prefix (tự tính = 0) không sửa được.

# E. PHÔI / NICHE / PIC / LỖI PREFIX
- Phôi = loại sản phẩm. Xác định theo: ánh xạ tay → Cost Master (theo prefix SKU) → loại trong Bảng Mã của store. Không ra → "Lỗi Prefix".
- Thiếu giá bán, Basecost hoặc phí Amazon cũng thành Lỗi Prefix (Max Bid = 0, không có đề xuất). Cách sửa: khai báo phôi / giá / phí ở mục "Quản lý Phôi" (Cost Master) trên menu PPC, hoặc bổ sung Bảng Mã / Basecost của store bên Kế toán.
- Niche, PIC (người phụ trách MKT), trạng thái SKU (WIN/TEST/FAIL…), ảnh mockup lấy từ Bảng Mã của CÙNG store.

# F. THANH LỌC & CHIP
- Ô tìm: SKU, ASIN, Niche. "Tất cả trạng thái": lọc theo trạng thái SKU. FBA / FBM / Khác: trang theo kênh (nếu store có).
- Phôi / Niche / PIC: lọc theo Bảng Mã. Nút "Lọc": lọc theo khoảng Spend, Sales, ACoS, Click, Order, CPC, CVR.
- "Gồm paused": mặc định tắt (chỉ campaign đang chạy).
- Nút "Cột": ẩn / hiện cột. "Đặt lại": xoá mọi bộ lọc (chỉ hiện khi đang lọc).
- Chip (đếm số SKU): Tăng Bid / Giảm Bid / Pause = SKU có ≥1 target loại đó. Lỗ ACoS = có Spend và ACoS tổng SKU > BE ACoS. ACoS Tốt = có Sales và ACoS ≤ BE ACoS. Chưa cắn tiền = Spend $0. Chưa ra đơn = có Spend, Sales $0 (không tính vào Lỗ ACoS). Lỗi Prefix = chưa xác định phôi / thiếu dữ liệu. SP03 / SB05 / SB01 = SKU có ≥1 đề xuất của dạng chạy đó.
- Lưu ý: ACoS ở bảng SKU là số TỔNG của SKU, khác ACoS từng target dùng để ra đề xuất. Số Spend/Sales SKU lấy từ báo cáo sản phẩm Sponsored Products (có thể chưa gồm SB).
- SKU không có quảng cáo SP trong kỳ thì không xuất hiện trong bảng.

# G. CỘT BẢNG
- Spend, Sales, ACoS (đỏ > BE ACoS, xanh ≤ BE ACoS), BE ACoS, Tồn (FBA + AWD: available + inbound + reserved, cập nhật ~16h10 hằng ngày), Giá trị tồn (Tồn × giá vốn TB năm; store chưa nối kế toán thì trống), Đề xuất (tổng), Tăng / Giảm / Pause (bấm số để mở SKU lọc sẵn loại đó), Chi tiết, Trend (7D) (7 ngày gần nhất, bấm mở biểu đồ). Bấm tiêu đề cột để sắp xếp.
- "Helium · dd/MM HH:mm" trên đầu trang = lần cập nhật Search Volume / thứ hạng từ Helium 10 (vàng khi cũ hơn 7 ngày). KHÔNG phải giờ cập nhật Spend/Sales.

# H. CHI TIẾT SKU
- Bấm dòng SKU / "Chi tiết". Trên cùng: Sales, Spend, Orders, ACoS, BE ACoS, Max Bid; giá, lãi trước QC, CR.
- Thanh lọc: campaign / dạng chạy, tìm keyword, Tất cả / Tăng / Giảm / Pause.
- Đề xuất gom theo campaign (bấm thẻ để mở). Cột: SV (search volume Helium), Org / SP (thứ hạng organic / sponsored), Impressions, Clicks, Orders, Spend, Sales, ACoS của kỳ, Current (bid hiện tại), Suggested (bid đề xuất), Final Bid (số sẽ duyệt — sửa được), nút Duyệt.
- Bấm 1 dòng target → hiện Lý do (dạng chạy, luật khớp, ACoS vs BE ACoS hoặc số click), CPC, CVR, ROAS; nút "Giải thích" (điều kiện luật + phép tính + trần) và "AI phản biện".
- Bấm tên SKU (biểu tượng ✦) → chat AI riêng về số liệu SKU đó.
- "Target giữ nguyên" = target không có đề xuất. "Campaign có chi tiêu nhưng không có đề xuất đổi bid" liệt kê campaign tốn tiền mà không có đề xuất.
- Sửa bid: gõ vào Final Bid; chọn nhiều target → "Sửa Bid (N)"; bút ở tiêu đề campaign = đặt nhanh Final Bid cho cả campaign.

# I. DUYỆT & ACTION QUEUE
- "Duyệt" (1 target), "Duyệt N mục đã chọn" (trong SKU), "Duyệt N SKU" (ngoài bảng — duyệt TẤT CẢ đề xuất của các SKU đã chọn theo bid đề xuất, không xem từng target).
- Duyệt chỉ ghi vào Action Queue (trạng thái APPROVED). CHƯA gửi gì lên Amazon.
- Target đã có hành động đang chờ thì hành động mới thay thế cái cũ (cũ thành SUPERSEDED); riêng Pause đang chờ không bị thay bằng đổi bid.
- Chặn duyệt nếu đề xuất thuộc store khác store đang xem.
- Duyệt xong, nút Duyệt của target đổi thành nút xanh "⚡ Action"; trong SKU nút "Duyệt N mục đã chọn" thành "⚡ Action (N)" — bấm là mở Action Queue.
- Nút Action Queue (nổi góc dưới, màu xanh, kéo được, kéo sang phải để thu gọn; chỉ hiện khi chọn 1 store) hiện số hành động đang chờ CỦA BẠN.

# I2. ACTION QUEUE → ĐẦU RA (file Bulk hoặc Auto Upload) — đây là bước cuối, bắt buộc để bid đổi trên Amazon
- Bảng gom theo SKU: campaign / target, hành động (Update Bid / Pause), Old → New (Bid). Bấm số New Bid để sửa, Enter để lưu ($0.02–$100). Cột Xóa = bỏ khỏi hàng đợi.
- "Lọc theo SKU", tích chọn nhiều dòng → "Xóa đã chọn" / "Đổi bid" hàng loạt. Nhãn "⚡ N action SKU chưa cắn tiền".
- ĐẦU RA 1 — "Xuất Bulk File (N)": không chọn = cả hàng đợi; đang lọc SKU = SKU đó; đang tích chọn = "Xuất đã chọn (N)". Mở hộp EXPORT AMAZON BULK: tổng Update Bid / Pause; kiểm tra hợp lệ (đủ Campaign / Ad Group / Target ID, bid trong giới hạn, khử trùng lặp: cùng target có Pause thì bỏ Update Bid); lỗi thì báo "Phát hiện dữ liệu thiếu ID hoặc bid không hợp lệ!" và khoá nút. Bấm "Tải Amazon Bulk File (.xlsx)" → hành động thành ĐÃ XUẤT → người dùng TỰ upload file lên Amazon Ads (Bulk operations). Hệ thống không biết đã upload chưa; quên upload thì Kết quả Auto Bid báo "Amazon chưa áp dụng".
- ĐẦU RA 2 — "Auto Upload AdsPower": hộp AUTO UPLOAD ADSPOWER. Chỉ SKU chưa cắn tiền → "Chế độ an toàn". Có SKU đang cắn tiền → khung đỏ "Cảnh báo quan trọng", phải tích "Tôi đã kiểm tra kỹ các đề xuất và xác nhận…" mới bấm được. "Chọn SKU thực thi": Tất cả SKU / Chỉ SKU chưa cắn tiền / 1 SKU; hiện số actions và Store / Profile AdsPower. "⚡ Bắt Đầu Auto Upload (N)": tạo file Bulk → đẩy lên kho file → xếp hàng cho Mac mini (AdsPower) upload. Không chạy được khi đang chọn "Tất cả Store" hoặc hành động thuộc nhiều store.
- "Kết quả thực thi" (cuối Action Queue): Đang chờ upload (còn "Hủy" được) → Đang thực thi → Áp dụng thành công / Thành công một phần / Thất bại / Không xác nhận được / Đã hủy; "Đang chờ thử lại". "Chi tiết" xem từng hành động + phản hồi Amazon; "Upload lại" cho lượt thất bại mà file chưa tới Amazon; tải file .xlsx của lượt (nếu còn). Mac mini báo thành công → hành động ĐÃ ÁP DỤNG.
- Hoàn tác: CHƯA xuất → xoá khỏi hàng đợi hoặc sửa bid ($0.02–$100). Job Auto Upload chỉ huỷ được khi còn chờ. ĐÃ lên Amazon → không tự hoàn tác; phải tạo hành động mới (vd "Cần hoàn bid" trong Kết quả Auto Bid).
- Sau khi duyệt, đề xuất không biến mất mà target được đánh dấu đã duyệt (nút "Action" màu xanh).

# J. AUTO GIẢM BID
- Cài riêng cho TỪNG NGƯỜI, TỪNG STORE (nút "Auto giảm Bid").
- Mặc định tắt. Phạm vi: SKU được chọn (tối đa 500) hoặc tất cả SKU store. Chờ chưa action: 3 ngày (1–30). Bid tối thiểu: $0.10 ($0.02–$50). Bỏ qua nếu vừa chỉnh: 7 ngày (0–60).
- Luôn dùng kỳ 30D, không gồm paused; chỉ lấy đề xuất GIẢM BID (không Pause / Tăng); tối đa 100 target / lô, ưu tiên spend cao.
- Đếm ngày dữ liệu liên tiếp còn đề xuất giảm (ngày crawler không chạy không tính). Bộ đếm về 0 khi: đề xuất mất / đổi hướng, bid trong báo cáo thay đổi (kể cả sửa trực tiếp trên Amazon), hoặc ai đó duyệt / bỏ qua target đó.
- 9h sáng (giờ VN, chạy bù tới 12h) gửi thẻ Lark (hoặc Telegram) CÁ NHÂN cho người cài; người đó phải được phân công store và bật "nhận thông báo action". Không gửi vào nhóm.
- KHÔNG đổi bid cho tới khi bấm "Xác nhận giảm". Khi xác nhận, hệ thống tính lại và bỏ qua target nếu: đề xuất không còn, bid đã đổi, vừa chỉnh / đang chờ upload, đã ở sàn, hoặc bid đề xuất đổi so với thẻ ("chờ lô sau"). Phần còn lại → Action Queue → file Bulk → Mac mini upload.
- "Hoãn 3 ngày": không nhắc các target đó 3 ngày (chỉ với bạn). Lô hết hạn sau 1 ngày; sáng hôm sau có lô mới nếu đề xuất vẫn còn.
- Lark lỗi thì lô vẫn ở "Lô thông báo gần đây" để duyệt trên web (bỏ chọn được từng target). Chỉ chủ lô duyệt được lô của mình.
- Trạng thái lô: Chờ xác nhận / Đang xử lý / Đã giảm / Lỗi / Đã hoãn / Hết hạn.

# K. KẾT QUẢ AUTO BID
- Chỉ theo dõi hành động ĐÃ XUẤT file hoặc ĐÃ ÁP DỤNG. Mốc 3 / 7 / 14 / 30 ngày sau ngày chỉnh (ngày xuất Bulk đầu tiên), so với cùng số ngày TRƯỚC khi chỉnh (thiếu thì quy đổi từ trung bình 30 ngày, có cảnh báo ⚠).
- Chờ thêm để Amazon ghi nhận đủ đơn: SP ~7 ngày, SB ~14 ngày.
- Thước đo: lãi đóng góp = Sales QC × biên lãi − Spend QC; so với mức kỳ vọng (trung bình 30 ngày của chính target, điều chỉnh theo nhóm target đối chứng khi đủ). Ngưỡng nhiễu = lớn nhất của $3, 10% spend, 10% kỳ vọng.
- Win: tốt hơn kỳ vọng quá ngưỡng. Loss: kém hơn quá ngưỡng, hoặc có click mà 0 đơn và lãi giảm. Còn lại: Bình thường. "Bị ngắt": target bị chỉnh tiếp trong lúc đo. "Chưa đủ dữ liệu". "độ tin cậy thấp" khi ít dữ liệu.
- Trạng thái target: Cần hoàn bid (Loss từ mốc 7 ngày → gợi ý quay về bid tốt nhất / bid trước), Amazon chưa áp dụng (báo cáo sau ngày chỉnh vẫn ra bid cũ), Theo dõi sát (xấu chỉ ở 3 ngày đầu), Thiếu báo cáo, Đang hiệu quả, Giữ nguyên, Đang chờ kết quả.
- Nút Duyệt trong cửa sổ này cũng đưa bid vào Action Queue. "Cập nhật kết quả" = chấm lại với số mới nhất.

# L. QUYỀN
- Xem: tài khoản được cấp tính năng PPC.
- Duyệt / sửa / xoá hàng đợi / xuất Bulk / Auto Upload / Auto giảm Bid: phải được PHÂN CÔNG store và bật "nhận thông báo action". Lỗi gặp: "Bạn không được phân quyền phụ trách store này để thực hiện hành động PPC…". Cửa sổ Auto giảm Bid hiện "Chỉ xem — bạn chưa được phân quyền phụ trách store này." → nhờ admin phân công store cho bạn và bật nhận thông báo action.

# M. LỖI HAY GẶP (nguyên văn)
- "Không tìm thấy SKU nào phù hợp với bộ lọc hiện tại." → bỏ bớt bộ lọc / Đặt lại.
- "Đề xuất này thuộc Store …, không khớp với Store … hiện tại. Đã chặn duyệt để tránh nhầm Store!" → đóng, chọn lại đúng store rồi mở lại.
- "Các SKU đã chọn không còn đề xuất nào để duyệt."
- "Max Bid phải lớn hơn 0 và không quá $100."
- "Vui lòng nhập số tiền hợp lệ (> 0)." (sửa Final Bid)
- "Không có đề xuất nào cho SKU này trong kỳ dữ liệu đã chọn."
- "Không còn target nào có chi tiêu trong file (target đã xoá/archive hoặc chi từ placement)."
- Auto giảm Bid: "Chọn ít nhất 1 SKU, hoặc chuyển phạm vi sang Tất cả SKU.", "Lô này đã hết hạn. Sáng mai sẽ có lô mới nếu đề xuất vẫn còn.", "Lô này thuộc cấu hình của người khác, bạn không duyệt được."

# N. VÌ SAO SKU / TARGET KHÔNG CÓ ĐỀ XUẤT (kiểm tra lần lượt)
1. Đang chọn "Tất cả store" / store không có báo cáo kỳ đó.
2. Campaign là SP01 / SP02 / SP04, hoặc tên không chứa SP03 / SB05 / SB01 / VIDEO.
3. Target / campaign đang paused (campaign paused → tích "Gồm paused").
4. SKU Lỗi Prefix / thiếu giá, Basecost, phí.
5. Rơi vào vùng Hold (giữ), hoặc đúng mép giữa 2 vùng.
6. Bid hiện tại đã cao hơn trần (chỉ còn Pause), hoặc bid mới tính ra bằng bid hiện tại.
7. Dữ liệu đang lưu đệm (tối đa 24h, tự làm mới khi có báo cáo mới / sửa giá vốn, Max Bid, luật).
`;
