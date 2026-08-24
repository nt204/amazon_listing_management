# Cấu hình Cloudflare R2 cho Listing Desk

Ứng dụng dùng R2 cho ảnh listing, ảnh AI, preview/thumbnail Trello và workbook
Amazon. PostgreSQL vẫn giữ metadata, quan hệ và trạng thái job; Redis vẫn giữ
cache, lock và giới hạn concurrency.

Tài liệu Cloudflare tham chiếu: [bắt đầu với S3 API](https://developers.cloudflare.com/r2/get-started/s3/),
[tạo và giới hạn API token](https://developers.cloudflare.com/r2/api/tokens/) và
[bảng giá R2](https://developers.cloudflare.com/r2/pricing/).

## 1. Chuẩn bị an toàn

Không sửa hoặc xóa dữ liệu `BYTEA` trước khi hoàn tất bước verify. Trên production,
tạo backup PostgreSQL trước khi bắt đầu:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=listing-desk-before-r2.dump
```

Trong suốt rollout, giữ:

```env
OBJECT_STORAGE_RETAIN_DATABASE_BYTES=true
```

Chế độ này ghi song song vào R2 và PostgreSQL, vì vậy có thể chuyển
`OBJECT_STORAGE_DRIVER=database` để rollback trước bước cleanup.

## 2. Tạo bucket R2

1. Đăng nhập Cloudflare Dashboard.
2. Chọn **Storage & databases > R2 > Overview**.
3. Chọn **Create bucket**.
4. Đặt tên, ví dụ `amazon-listing-production`.
5. Để vị trí tự động, trừ khi có yêu cầu pháp lý cụ thể về jurisdiction.
6. Không bật public `r2.dev` và không gắn public custom domain. Toàn bộ file được
   tải qua API đã xác thực của ứng dụng.

Nên dùng bucket riêng cho từng môi trường:

- Production: `amazon-listing-production`
- Staging: `amazon-listing-staging`
- Development: `amazon-listing-development`

## 3. Tạo credential tối thiểu

Trong trang R2:

1. Chọn **Manage R2 API Tokens**.
2. Chọn **Create Account API token**.
3. Permission: **Object Read & Write**.
4. Scope: **Apply to specific buckets only** và chọn đúng bucket vừa tạo.
5. Tạo token rồi sao chép ngay:
   - Access Key ID
   - Secret Access Key
   - Account ID hoặc S3 endpoint

Secret Access Key chỉ được hiển thị một lần. Không dùng Admin token và không đưa
các giá trị này vào biến `NEXT_PUBLIC_*`.

## 4. Điền `.env`

Giữ app ở chế độ database trong lúc khai báo:

```env
OBJECT_STORAGE_DRIVER=database
OBJECT_STORAGE_RETAIN_DATABASE_BYTES=true
R2_ACCOUNT_ID=cloudflare-account-id
R2_BUCKET_NAME=amazon-listing-production
R2_ACCESS_KEY_ID=r2-access-key-id
R2_SECRET_ACCESS_KEY=r2-secret-access-key
R2_KEY_PREFIX=listing-desk/production
```

`R2_ENDPOINT` không cần thiết với Cloudflare. Chỉ khai báo biến này nếu dùng một
S3-compatible endpoint khác trong môi trường local.

## 5. Áp dụng schema và kiểm tra R2

Chạy migration khi app vẫn đang ở `OBJECT_STORAGE_DRIVER=database`:

```bash
npm run db:migrate
```

Sau đó đổi:

```env
OBJECT_STORAGE_DRIVER=r2
```

Kiểm tra đầy đủ quyền list, write, read và delete:

```bash
npm run storage:check
```

Probe tạo một object nhỏ trong `<R2_KEY_PREFIX>/.health/`, tải lại để so sánh byte
rồi xóa object. Kết quả thành công phải có cả hai dòng `credentials accepted` và
`read/write/delete probe passed`.

Nếu lệnh lỗi:

- `AccessDenied`: kiểm tra token có Object Read & Write và đúng bucket.
- `InvalidAccessKeyId` hoặc signature error: tạo/copy lại Access Key và Secret.
- `ENOTFOUND`: kiểm tra `R2_ACCOUNT_ID` hoặc bỏ `R2_ENDPOINT` cấu hình sai.
- Không xóa được probe: token thiếu quyền write/delete.

## 6. Restart và kiểm tra dữ liệu mới

Restart tiến trình Next.js sau khi đổi `.env`:

```bash
npm run build
npm run start
```

Kiểm tra `GET /api/health`. Phản hồi phải chứa:

```json
{
  "object_storage": {
    "driver": "r2",
    "status": "ready"
  }
}
```

Sau đó thực hiện một vòng kiểm thử nghiệp vụ:

1. Tạo listing có ảnh và mở preview.
2. Tải ảnh gốc của listing.
3. Upload một Amazon template rồi tạo/tải workbook.
4. Tạo mockup Trello và mở preview/thumbnail.
5. Xóa hoặc thay template để kiểm tra cleanup object cũ.

Trong giai đoạn này dữ liệu mới vẫn được ghi kép vì
`OBJECT_STORAGE_RETAIN_DATABASE_BYTES=true`.

## 7. Backfill dữ liệu hiện có

Lệnh sau upload những binary cũ chưa có `object_key`. Lệnh có thể chạy lại an
toàn; các hàng đã backfill được bỏ qua:

```bash
npm run storage:migrate -- backfill
```

Sau khi hoàn tất, kiểm tra tất cả reference bằng `HEAD` và so sánh kích thước;
những object có SHA-256 trong DB còn được so sánh metadata SHA-256:

```bash
npm run storage:migrate -- verify
```

Không chạy cleanup nếu verify chưa đạt 100%.

## 8. Thời gian theo dõi và cleanup PostgreSQL

Nên giữ bản sao DB ít nhất vài ngày và kiểm tra log/backup. Khi đã xác nhận R2 ổn
định, chạy lại `backfill` và `verify` ngay trước cleanup:

```bash
npm run storage:migrate -- backfill
npm run storage:migrate -- verify
npm run storage:migrate -- cleanup --confirm-delete-database-bytes
```

Cleanup chỉ đặt các cột binary về `NULL` khi hàng đã có object key và sẽ tự chạy
verify trước. Sau đó đặt:

```env
OBJECT_STORAGE_RETAIN_DATABASE_BYTES=false
```

Restart app. Chạy bảo trì trong maintenance window để PostgreSQL tái sử dụng dung
lượng:

```bash
npm run db:maintain
```

`VACUUM` thường không làm file database trên disk nhỏ ngay. Chỉ dùng `VACUUM FULL`
khi đã có backup và chấp nhận khóa bảng trong maintenance window.

## 9. Rollback

Trước cleanup, rollback đơn giản:

```env
OBJECT_STORAGE_DRIVER=database
OBJECT_STORAGE_RETAIN_DATABASE_BYTES=true
```

Sau đó restart app. Không cần rollback migration schema.

Sau cleanup, binary chỉ còn ở R2. Muốn rollback hoàn toàn về database cần một quy
trình restore từ R2; không được chỉ đổi driver thành `database`.

## 10. Vận hành

- Giữ bucket private và rotate R2 token định kỳ.
- Dùng token riêng cho production, chỉ scope tới một bucket.
- Backup PostgreSQL vẫn bắt buộc vì R2 không chứa listing metadata/job/audit.
- Không xóa thủ công object trong R2; thao tác xóa nên đi qua ứng dụng.
- `npm run storage:check` có thể dùng làm smoke test sau mỗi lần rotate credential.
- `GET /api/health` kiểm tra quyền truy cập R2 nhưng không tạo object; probe CLI mới
  kiểm tra trọn vẹn read/write/delete.
