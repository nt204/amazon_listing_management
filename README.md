# Listing Desk

Workflow & Quality Control nội bộ cho Amazon Listing. AI draft chỉ là một service trong quy trình evidence, review, approve và export cho cả sản phẩm đơn lẻ lẫn batch.

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

## Workflow MVP

- Luồng chuẩn: `Product facts + Images + Keywords -> AI draft -> Fact/Policy check -> Review -> Approve -> Export`.
- Form đơn lẻ chỉ cần marketplace, product type, ảnh và main keyword.
- Một ô tự do cho các thông tin AI không thể xác định chắc chắn từ ảnh.
- Brand profile dùng chung tên brand và writing guidelines cho cả team.
- Reference listing nhận URL hoặc ASIN Amazon và được crawl best-effort. Amazon và reader chạy song song trong một hard timeout, kết quả được cache theo URL/ASIN và giới hạn evidence để không làm chậm AI prompt.
- Upload 1-10 ảnh JPG, PNG hoặc WEBP; ảnh được resize ở trình duyệt.
- Evidence-first pipeline: AI đọc ảnh thành product brief có nguồn dữ liệu, sau đó writer mới tạo listing.
- Generate bằng Gemini, validation-aware retry và OpenAI fallback.
- Rule validator cho title, 5 bullet, description, search terms, keyword placement, fact coverage và prohibited claims.
- Retry dùng lỗi của draft hiện tại làm feedback động; prompt nền không tích lũy lịch sử sửa lỗi.
- Một ô reviewer command sửa toàn bộ listing bằng ngôn ngữ tự do; revision vẫn chạy lại fact và policy check.
- So sánh before/after, instruction và quality snapshot theo từng revision.
- Trạng thái `Draft -> Review -> Approved -> Exported`; chỉ listing Approved mới được export.
- Quality queue lọc listing chờ review, còn thiếu fact hoặc đã approved.
- Batch CSV tối đa 10 sản phẩm, ghép ảnh theo filename và xử lý tối đa 2 listing cùng lúc.
- Seller Central CSV cho một hoặc nhiều listing. Template là draft chung vì flat-file chính thức thay đổi theo category và marketplace.
- Lưu input, evidence, output, metadata, trạng thái và revision history trong PostgreSQL.
- Mock mode để demo và phát triển không cần API key.

CSV mở và lưu được bằng Excel. Native XLSX chưa được bật trong MVP để tránh đưa dependency có security advisory vào bundle; adapter này có thể bổ sung riêng sau.

## API

- `GET /api/listings`
- `POST /api/listings/generate`
- `POST /api/listings/batch`
- `POST /api/listings/export`
- `GET /api/listings/:id`
- `PUT /api/listings/:id`
- `POST /api/listings/:id/revise`
- `POST /api/listings/:id/workflow`
- `POST /api/listings/:id/approve`
- `POST /api/listings/:id/export`
- `GET /api/brands`
- `POST /api/brands`
- `POST /api/references`

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Nếu môi trường sandbox không cho Turbopack mở process nội bộ để xử lý CSS, dùng `npx next build --webpack` để kiểm tra production build.

Kết nối PostgreSQL được cấu hình qua `DATABASE_URL` trong `.env`. App tự tạo bảng và index ở lần gọi API đầu tiên.

PostgreSQL local trong `compose.yaml` dùng:

```env
DATABASE_URL=postgresql://listing_desk:listing_desk@localhost:5432/listing_desk
```

Dùng `npm run db:start` hoặc `npm run db:stop` để điều khiển PostgreSQL riêng. Dữ liệu được giữ trong volume `listing_desk_postgres`.
