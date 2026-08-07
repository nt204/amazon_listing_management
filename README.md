# Listing Desk

Workflow nội bộ để tạo, review và export Amazon Listing.

## Chạy local

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` khởi động PostgreSQL, chạy migration có checksum rồi mới chạy Next.js. Docker Desktop cần đang mở. Truy cập [http://localhost:3000](http://localhost:3000).

Mặc định `AI_MOCK_MODE=true`. Để chạy AI thật, thêm ít nhất một trong hai key:

```env
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Nếu có API key, app dùng AI thật. Mock chỉ chạy khi không có provider nào. Key chỉ được đọc ở server.

## Pipeline sinh listing

1. Đọc dữ liệu operator đã điền.
2. Nếu Helium 10 được cấu hình, lấy Search Volume và chọn KW lõi 1/2 cùng các keyword Event, người nhận và người tặng có liên quan.
3. Chạy Tesseract OCR cục bộ và đưa nguyên văn các dòng đọc được cho AI.
4. Đọc tối đa 3 ASIN để lấy title, cách gọi sản phẩm và các thuộc tính đối thủ. Đây chỉ là bối cảnh tham khảo, không phải fact của sản phẩm.
5. Gọi một AI writer duy nhất với input, OCR, ảnh nguồn, keyword research và tóm tắt reference để sinh SEO title, đúng 5 bullet points, description và backend search terms.
6. Title dùng thứ tự `Brand + KW lõi 1 + KW lõi 2 + Event + người nhận + người tặng + sản phẩm`, trong đó KW lõi 2 luôn là cụm đầu tiên của trường `Từ khóa liên quan`. Brand và tên sản phẩm dùng cách viết hoa chuẩn. Text thật trên thiết kế/OCR nếu được dùng phải viết IN HOA nhưng không đặt trong dấu ngoặc kép, ví dụ `THANK YOU VETERANS`. Độ dài lý tưởng là 120-150 ký tự, tối đa 200 ký tự và mỗi từ không quá 2 lần. `Brand + KW lõi 1` phải nằm trọn trong 70 ký tự đầu.
7. Server giữ nguyên cách AI viết title, chỉ chuẩn hóa khoảng trắng và cắt ở giới hạn ký tự; không tự chèn, xóa hay sắp xếp lại keyword. Backend terms vẫn được làm sạch riêng.
8. Nếu provider chính lỗi, hệ thống chỉ chuyển sang provider fallback đã cấu hình; không có quality retry.

Để dùng Search Volume thật, cấu hình `HELIUM10_MCP_ACCESS_TOKEN`. Nếu không có token, hệ thống vẫn sinh listing từ keyword operator đã nhập và không tự gán Search Volume giả.

## Rule profile, không hardcode theo team

Rule mặc định nằm tại [`config/listing-rules.json`](config/listing-rules.json) và có version. Profile chỉ chứa:

- product types và marketplace stop words;
- giới hạn title, bullet, description và search terms;
- stop words và các từ không cho vào backend;
- cấu hình OCR;
- vocabulary tối thiểu để đọc reference đối thủ;
- hướng dẫn ngắn khi regenerate từng field.

Chọn profile bằng `LISTING_RULE_PROFILE`; có thể cung cấp một registry đầy đủ qua `LISTING_RULES_JSON`. Model catalog có thể thay bằng `GEMINI_MODELS_JSON` và `OPENAI_MODELS_JSON`, không cần sửa source.

## Workflow MVP

- `Draft -> Review -> Approved -> Exported`; chỉ Approved mới export.
- Reviewer command gửi listing hiện tại cùng yêu cầu mới cho cùng AI writer rồi kiểm tra lại định dạng.
- Reference Amazon tối đa 3 URL/ASIN; reference chỉ là nguồn vocabulary/positioning, không phải fact của sản phẩm.
- Batch CSV được chia thành chunk nhỏ; API có request limit, rate limit, timeout và idempotency.
- Ảnh được lưu riêng trong `listing_images`; `input_json` chỉ giữ metadata và hash.
- Mỗi mutation có revision và audit event; truy vấn được scope theo workspace/team.
- File export là `Listing Desk CSV`, chưa phải category flat-file có thể upload thẳng vào Seller Central.

Auth đang để `disabled` cho MVP nội bộ theo mặc định. Ở chế độ này chỉ nên deploy sau VPN/private ingress hoặc trên máy nội bộ. Cơ chế team token/session có thể bật sau bằng `LISTING_DESK_AUTH_MODE=required`; xem `.env.example`.

## Database và release

```bash
npm run db:start
npm run db:migrate
npm run db:backfill-images   # chỉ cần cho dữ liệu cũ còn inline image
npm run db:revalidate        # chạy sau khi đổi rule/policy version
npm run ocr:eval -- <listing-id>  # xem OCR của listing; bỏ ID để dùng listing mới nhất
npm run ai:eval -- <listing-id>   # chạy pipeline thật nhưng không ghi listing mới vào DB
```

Production release phải chạy `npm run db:migrate` trước `npm run start`. Migration đã áp dụng được bảo vệ bằng checksum; không sửa file migration cũ, hãy thêm migration mới.

## API chính

- `GET /api/health`
- `GET /api/listings`
- `POST /api/listings/generate`
- `POST /api/keywords/research`
- `POST /api/listings/batch`
- `POST /api/listings/export`
- `GET|PUT /api/listings/:id`
- `POST /api/listings/:id/revise`
- `POST /api/listings/:id/workflow`
- `POST /api/listings/:id/approve`
- `POST /api/listings/:id/export`
- `GET|POST /api/brands`
- `POST /api/references`

Các mutation tốn AI yêu cầu `Idempotency-Key`. Frontend đã tự tạo key cho generate, batch và revise.

## Kiểm tra trước release

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

`npm run build` dùng Webpack production path để CI/sandbox không phụ thuộc việc Turbopack có được phép mở local worker port hay không. Có thể chạy thêm `npm run build:turbo` ở môi trường hỗ trợ đầy đủ.

Sau khi đổi rule, chạy thêm `npm run db:revalidate`. Production MVP chỉ đạt điều kiện deploy nội bộ khi migration, test, lint, build và revalidation đều thành công; auth disabled không phù hợp để public internet.
