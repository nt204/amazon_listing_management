# Listing Desk

MVP nội bộ để tạo, kiểm tra, chỉnh sửa và duyệt Amazon Listing từ thông tin sản phẩm, hình ảnh, research và keyword.

## Chạy local

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` tự khởi động PostgreSQL trước khi chạy Next.js. Docker Desktop cần đang mở.

Mở [http://localhost:3000](http://localhost:3000). Mặc định `AI_MOCK_MODE=true`, vì vậy có thể bấm **Sample** rồi **Generate listing** để thử toàn bộ luồng mà không tốn API.

## Bật AI thật

Cập nhật `.env`:

```env
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
```

Chỉ cần cấu hình một trong hai key. Nếu có key, app luôn dùng AI thật dù `AI_MOCK_MODE=true`; mock chỉ chạy khi không có key nào. Form cho phép chọn model từ các provider đang có key; provider được đổi tự động theo model.

API key chỉ được đọc trong server routes. Frontend chỉ nhận trạng thái provider đã được cấu hình hay chưa.

## Chức năng MVP

- Luồng nhanh chỉ cần marketplace, product type, ảnh và main keyword.
- Một ô tự do cho các thông tin AI không thể xác định chắc chắn từ ảnh.
- Brand và competitor là tùy chọn; URL hoặc ASIN Amazon được crawl tự động theo kiểu best-effort. Khi Amazon chặn request trực tiếp, app dùng reader được cấu hình qua `COMPETITOR_READER_URL`.
- Upload 1-10 ảnh JPG, PNG hoặc WEBP; ảnh được resize ở trình duyệt.
- Evidence-first pipeline: AI đọc ảnh thành product brief có nguồn dữ liệu, sau đó writer mới tạo listing.
- Generate bằng Gemini, validation-aware retry và OpenAI fallback.
- Rule validator cho title, 5 bullet, description, search terms, keyword placement, fact coverage và prohibited claims.
- Retry dùng lỗi của draft hiện tại làm feedback động; prompt nền không tích lũy lịch sử sửa lỗi.
- Edit, regenerate từng field, approve, copy và export JSON.
- Lưu input, output, metadata, trạng thái và revision history trong PostgreSQL.
- Mock mode để demo và phát triển không cần API key.

## API

- `GET /api/listings`
- `POST /api/listings/generate`
- `GET /api/listings/:id`
- `PUT /api/listings/:id`
- `POST /api/listings/:id/regenerate`
- `POST /api/listings/:id/approve`
- `POST /api/listings/:id/export`

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Kết nối PostgreSQL được cấu hình qua `DATABASE_URL` trong `.env`. App tự tạo bảng và index ở lần gọi API đầu tiên.

PostgreSQL local trong `compose.yaml` dùng:

```env
DATABASE_URL=postgresql://listing_desk:listing_desk@localhost:5432/listing_desk
```

Dùng `npm run db:start` hoặc `npm run db:stop` để điều khiển PostgreSQL riêng. Dữ liệu được giữ trong volume `listing_desk_postgres`.
