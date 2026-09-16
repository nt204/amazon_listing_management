**Kết quả audit**

Hiện tại hệ thống **chưa tối ưu hoàn toàn**. Những vấn đề đáng ưu tiên:

1. **P1 – PDF riêng tư đang được cache công khai.** Route kiểm tra đăng nhập nhưng trả `Cache-Control: public`, nên proxy/CDN dùng chung có thể lưu và phục vụ tài liệu mà không gọi lại bước xác thực. Đổi thành `private` và bổ sung `ETag` hoặc `no-store` tùy yêu cầu.  
[app/api/guides/[id]/route.ts:12](/Users/macbook/Desktop/Amazon%20Listing%20Management/app/api/guides/%5Bid%5D/route.ts:12)  
[app/api/guides/[id]/route.ts:26](/Users/macbook/Desktop/Amazon%20Listing%20Management/app/api/guides/%5Bid%5D/route.ts:26)

2. **P1 – PPC có nguy cơ tăng RAM rất mạnh.** Upload cho phép 150 MB, `request.formData()` giữ file trong bộ nhớ, sau đó tạo `ArrayBuffer`, `Buffer`, giải nén workbook và giữ toàn bộ rows. Đồng bộ R2 cũng đọc toàn bộ file và giữ kết quả của nhiều file trước khi ghi DB. Nên stream upload xuống file tạm/object storage, parse theo dòng/chunk và ghi DB từng batch.  
[app/api/ppc/upload/route.ts:6](/Users/macbook/Desktop/Amazon%20Listing%20Management/app/api/ppc/upload/route.ts:6)  
[app/api/ppc/upload/route.ts:12](/Users/macbook/Desktop/Amazon%20Listing%20Management/app/api/ppc/upload/route.ts:12)  
[lib/ppc/service.ts:411](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/service.ts:411)

3. **P1 – API dashboard PPC tải toàn bộ dataset.** Hai truy vấn không có `LIMIT`, server tính toán trên toàn bộ rows rồi gửi cả `searchTerms`, campaign, ad group và tối đa 20.000 targets về browser. Pagination hiện chỉ ở client nên không giảm SQL, RAM, JSON hay network. Cần aggregate và paginate phía server theo từng tab.  
[lib/ppc/repository.ts:227](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/repository.ts:227)  
[lib/ppc/repository.ts:287](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/repository.ts:287)  
[lib/ppc/service.ts:228](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/service.ts:228)

4. **P2 – Bundle trang chính còn nặng.** Build cho thấy riêng các chunk gắn với `/` khoảng **140 KB gzip**, chưa tính framework/shared vendor. Trello, SellerSprite và PPC đều import tĩnh dù chỉ một view được render. Nên chuyển các view sang `next/dynamic`; đặc biệt `TrelloBoardView` và `PpcDashboard` lần lượt khoảng 2.876 và 3.760 dòng.  
[components/listing-workspace.tsx:13](/Users/macbook/Desktop/Amazon%20Listing%20Management/components/listing-workspace.tsx:13)  
[components/listing-workspace.tsx:312](/Users/macbook/Desktop/Amazon%20Listing%20Management/components/listing-workspace.tsx:312)

5. **P2 – Ảnh Trello ngoài viewport vẫn tải ngay.** Các gallery dùng `<img>` không có `loading="lazy"`/`decoding="async"`. Với board nhiều card, số request và dữ liệu tải ban đầu tăng nhanh.  
[components/trello-board-view.tsx:1951](/Users/macbook/Desktop/Amazon%20Listing%20Management/components/trello-board-view.tsx:1951)  
[components/trello-board-view.tsx:2051](/Users/macbook/Desktop/Amazon%20Listing%20Management/components/trello-board-view.tsx:2051)

6. **P2 – Redis invalidation có thể block server.** Runtime vẫn dùng `KEYS` + `DEL` và cache miss không có single-flight. Repo đã có `SCAN` + `UNLINK` và helper single-flight kèm test, nhưng chưa được nối vào `redis.ts`.  
[lib/redis.ts:74](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/redis.ts:74)  
[lib/redis.ts:108](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/redis.ts:108)  
[lib/redis-core.ts:12](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/redis-core.ts:12)

7. **P2 – Font production bị CSP chặn.** Layout tải Google Fonts nhưng CSP chỉ cho stylesheet/font từ chính domain. Trình duyệt sẽ dùng fallback font và vẫn tốn kết nối thất bại. Nên dùng `next/font` self-hosted hoặc mở CSP đầy đủ.  
[next.config.ts:11](/Users/macbook/Desktop/Amazon%20Listing%20Management/next.config.ts:11)  
[app/layout.tsx:18](/Users/macbook/Desktop/Amazon%20Listing%20Management/app/layout.tsx:18)

8. **P3 – R2 vẫn mặc định lưu thêm bản sao trong PostgreSQL.** `OBJECT_STORAGE_RETAIN_DATABASE_BYTES` mặc định là `true`, khiến ảnh nằm cả R2 lẫn `BYTEA`. Hợp lý khi migration, nhưng sau khi xác nhận R2 ổn định nên chuyển sang `false` và chạy maintenance để giảm DB size, backup time và RAM query.  
[lib/object-storage-core.ts:83](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/object-storage-core.ts:83)  
[lib/db.ts:551](/Users/macbook/Desktop/Amazon%20Listing%20Management/lib/db.ts:551)

Điểm tốt: ảnh listing/Trello đã có derivative giới hạn kích thước, content-addressed key, `ETag`, cache immutable và giới hạn concurrency. Download client cũng thu hồi object URL đúng cách.

Xác minh: production build thành công; 13/13 test cache, object storage và image processing đều pass. Audit không sửa code hay các thay đổi PPC đang có trong working tree.