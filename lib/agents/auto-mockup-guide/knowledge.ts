// Kiến thức về màn "Auto Mockup Generator" (Mockup design) cho trợ lý hướng dẫn.
// Viết theo logic thật trong components/auto-mockup-generator.tsx, app/api/trello/generate-mockups/route.ts,
// lib/mockup-job-worker.ts, lib/mockup-types.ts. Sửa logic thì sửa lời ở đây.

export const AUTO_MOCKUP_KNOWLEDGE = `
# A. MÀN NÀY LÀM GÌ
- Tự tạo bộ mockup bán hàng Amazon (tối đa 7 ảnh) từ 1 ảnh thiết kế gốc đính kèm trên thẻ Trello.
- Hai cột: "Cột đầu mockup" = thẻ thiết kế chờ tạo mockup; "Cột đích mockup" = thẻ đã có mockup. Tên cột lấy theo cấu hình Trello (nút "Cấu hình Trello" ở góc trên).
- Kết quả cuối: ảnh mockup được đính kèm lên thẻ Trello; khi thẻ đủ 7 ảnh, hệ thống tự chuyển thẻ sang cột đích trên Trello.

# A2. LUỒNG CHÍNH 0 — TẠO PROMPT BAN ĐẦU (mục sản phẩm / phôi mới)
- Prompt = mô tả bối cảnh tiếng Anh của từng content ("🤖 Mô tả Bối Cảnh AI"). Prompt nằm trong mục sản phẩm, dùng chung cả team.
1. Bấm "Quản Lý Mẫu SP & Content" (góc phải khu Mục sản phẩm).
2. "Tạo Mới" để thêm mục (tên + icon), hoặc "Nhân bản mẫu này" ở một mục gần giống rồi sửa.
3. "Thêm Hàng Loạt" → "Copy Prompt ChatGPT" (chép câu lệnh mẫu) → dán vào ChatGPT KÈM ẢNH PHÔI sản phẩm → ChatGPT trả về dòng "Loại Sản Phẩm: …" và 7 dòng "Content N | Ảnh N: Tên | Mô tả tiếng Anh".
4. Dán nguyên kết quả vào ô → "Tự Động Phân Tích & Thêm Ngay". Có dòng Content 1 = thay TRỌN BỘ content cũ của mục; không có = thêm nối vào.
5. Sửa từng content: tên + ô "🤖 Mô tả Bối Cảnh AI". Xong bấm "Hoàn Tất & Áp Dụng" để đóng hộp và dùng mục đó. Để trống ô này: 7 content chuẩn dùng prompt mặc định của hệ thống; content thêm mới mà để trống thì chỉ dựa vào tên (ảnh kém).
6. Biến kích thước trong prompt: {{length}}, {{width}}, {{thickness}}, {{capacity}}, {{formatted}} — tự thay bằng số đo trong description của từng thẻ.
7. Mọi thay đổi trong hộp này TỰ LƯU cho cả team (không có nút lưu riêng). Nút X / "Hoàn Tất & Áp Dụng" đóng hộp và chọn mục đang xem (danh sách content về mẫu của mục).
- Khác: "Thêm 1 Content", lên / xuống / xoá content (Content 1 không xoá được), "Xuất JSON" / "Nhập JSON" để sao lưu, chia sẻ mẫu.

# B. LUỒNG CHÍNH 1 — TẠO MOCKUP
1. Chọn "Mục sản phẩm" (Mouse Pad, Mug 11oz, Tumbler 20oz…): mỗi mục có bộ content + prompt riêng. Bấm mục khác thì danh sách content đặt lại về mẫu của mục đó.
2. Chọn "Mockup content": Content 1 (Ảnh chính sản phẩm, full design gốc) BẮT BUỘC; chọn thêm tối đa 6 content AI (tổng 7). Tick quá 6 sẽ bị báo. Nút "Mặc định (7 Content)" đưa về mẫu; "Bỏ chọn Content AI" bỏ hết content AI.
3. Chọn "Model" và "Chất lượng" ở thanh trên (áp dụng cho mọi lần tạo).
4. Thẻ ở cột đầu hiển thị SKU, tên, "Kích thước / dung tích" (đọc từ description thẻ Trello — thiếu thì ảnh kích thước dễ sai) và "Bộ Ảnh Thiết Kế".
5. Tạo cho 1 thẻ: bấm "⚡ Tạo N Mockup AI Đã Chọn" trên thẻ, hoặc kéo thẻ từ cột đầu thả sang cột đích (cũng là tạo mockup).
6. Tạo nhiều thẻ: bấm ô chọn tất cả ở đầu cột đầu → thanh tím hiện "⚡ Batch: N mockup AI/thẻ (M thẻ)" → bấm để tạo lần lượt. Đang chạy có "Hủy Batch & Lưu Kết Quả".
7. Đang tạo: thẻ hiện "Đang tạo mockup..." và nút dừng (dừng vẫn giữ các ảnh đã đính kèm). Khung "Tiến Trình" hiện từng content. Job chạy nền, đóng trang vẫn chạy tiếp.
- Tạo / Batch / Gen lại đều gọi AI (tốn phí) và ghi lên Trello — trợ lý KHÔNG tự bấm, chỉ hướng dẫn.
- Kéo thẻ từ cột đích về cột đầu = chuyển thẻ Trello về cột thiết kế (không xoá ảnh).

# C. LUỒNG CHÍNH 2 — TỐI ƯU PROMPT & GEN LẠI 1 ẢNH (STUDIO)
- Bấm vào ảnh nhỏ trên thẻ để mở Studio: ảnh lớn, mũi tên trái/phải (hoặc phím mũi tên) để chuyển ảnh, nút chuyển thẻ trước/sau.
- Khung "Gen Lại Ảnh Này" bên phải:
  • "AI Model": model riêng cho lần gen lại này (không đổi model chung ở thanh trên).
  • "Prompt cho ảnh đang chọn": prompt CHUNG của content đó trong mục sản phẩm đó, cả team dùng chung. Sửa chữ trong ô = PROMPT TẠM, chỉ dùng cho lần gen này (hiện nhãn "Prompt tạm", nút gen đổi thành "✨ Gen Lại Bằng Prompt Tạm"). "Khôi phục" trả về prompt chung; "Copy" chép prompt.
  • "Lưu prompt chung" (chỉ hiện khi đã sửa): cập nhật phần chữ prompt của content đó cho CẢ TEAM từ lần tạo sau.
  • Ảnh paste (Ctrl/⌘+V) vào ô prompt chung được LƯU CHUNG NGAY khi tải xong.
  • "Tinh chỉnh thêm (không bắt buộc)": ghi chú thêm (VD "Đèn Giáng Sinh sáng hơn, bối cảnh tự nhiên hơn"), có thể paste ảnh tham khảo — chỉ dùng cho lần gen này, không lưu.
  • Các biến kích thước trong prompt tự lấy theo từng thẻ sản phẩm.
  • Thêm ảnh tham khảo CHỈ bằng cách copy ảnh rồi paste (Ctrl+V / ⌘+V) vào ô "Tinh chỉnh thêm" hoặc ô prompt — KHÔNG có nút tải lên / chọn file. Luôn nói "paste (Ctrl/⌘+V)".
- "✨ Gen Lại Tấm Ảnh Này Ngay": tạo lại riêng ảnh đó (gọi AI, tốn phí), xoá ảnh cũ trên thẻ Trello và đính kèm ảnh mới; tiến độ hiện dưới nút.
- Mẹo tối ưu: thử ghi chú tinh chỉnh trước (không ảnh hưởng ai); thấy ổn nhiều lần mới sửa prompt và "Lưu prompt chung"; ảnh khó thì đổi model.

# C2. VÒNG LẶP TỐI ƯU PROMPT (cách làm khuyên dùng)
1. Tạo thử cho ĐÚNG 1 thẻ (chưa Batch) — prompt mới chưa chắc đẹp, Batch ngay dễ tốn phí vô ích.
2. Mở Studio, rà từng ảnh; đánh dấu "Chưa ưng 🔴" để nhớ. Lỗi lặp lại ở nhiều thẻ = do prompt; lỗi lẻ = do thiết kế / thẻ đó.
3. Lỗi nhỏ (ánh sáng, đạo cụ, màu nền): ghi "Tinh chỉnh thêm" hoặc paste ảnh tham khảo → gen lại.
4. Lỗi nặng (sai bố cục, sai kích thước, sai góc): mở "Prompt cho ảnh đang chọn", sửa prompt tạm → gen lại.
5. So ảnh mới với ảnh cũ; chưa ưng thì lặp bước 3–4. Mỗi lần chỉ đổi MỘT chỗ để biết thay đổi nào có tác dụng.
6. Ưng rồi: bấm "Lưu prompt chung" ngay trong Studio (hiện khi đã sửa prompt; có hộp xác nhận). Hệ thống ghi bản đã tối ưu vào ô "🤖 Mô tả Bối Cảnh AI" của đúng content trong mục, đồng bộ cho cả team và báo "Đã lưu prompt vào phôi". Biến {{length}}… được giữ nguyên.
7. Áp dụng NGAY từ lần tạo sau (kể cả Batch) — KHÔNG cần mở Quản Lý Mẫu hay bấm "Hoàn Tất & Áp Dụng". Ô prompt trở về trạng thái "Đang dùng prompt chung".
8. Tạo thử thêm 1–2 thẻ thiết kế khác để chắc prompt hợp nhiều mẫu in; ổn rồi mới chọn các thẻ còn lại và "⚡ Batch".
- Tóm tắt vòng đời prompt: tạo prompt ban đầu (ChatGPT, trong Quản Lý Mẫu → Hoàn Tất & Áp Dụng) → tạo thử → tối ưu bằng prompt tạm trong Studio → Lưu prompt chung (Studio) → Batch → lặp lại khi gặp lỗi mới.

# D. DUYỆT / TẢI / XOÁ (STUDIO)
- "Duyệt 💚" / "Chưa ưng 🔴": chỉ tô viền ảnh để rà nhanh TRONG PHIÊN, không lưu lên Trello, tải lại trang là mất.
- "Tải ảnh gốc": tải ảnh độ phân giải gốc về máy.
- Nút thùng rác: xoá ảnh mockup khỏi thẻ Trello (chỉ ảnh từ Content 2 trở đi; Content 1 là ảnh gốc).

# E. MODEL & CHẤT LƯỢNG
- Model: GPT Image 2 C (CheapKeyAI — tối ưu chi phí), GPT Image 2 (CheapKeyAI), GPT Image 2 (OpenAI Direct — chuẩn), GPT Image 1.5 (OpenAI Direct — nhanh), Gemini 3.1 Flash Image (Google AI), Fast Graphic Engine (tốc độ cao). Trong Studio còn có Gemini 3 Pro Image (sắc nét).
- Chất lượng (chỉ model GPT): low = nhanh / bản nháp, medium = cân bằng, high = bản xuất bản.
- Không có số giá cụ thể trong hệ thống — không bịa giá.

# F. QUẢN LÝ MẪU
- "Quản Lý Mẫu SP & Content": thêm, nhân bản mục sản phẩm, sửa content và prompt AI. Mẫu dùng chung cho cả team.
`;
