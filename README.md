# Listing Desk

Workflow nội bộ để tạo, review và export Amazon Listing.

## Chạy local

```bash
npm install
python3 -m pip install -r requirements.txt
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

## Tạo mockup bằng AI Image

Tab **Auto Mockup Generator** mặc định dùng `gpt-image-1.5` với chất lượng `low`; có thể đổi model hoặc chất lượng ngay trên giao diện. Mỗi bộ gồm **1 ảnh thiết kế gốc + 6 ảnh mockup do AI tạo = tổng 7 ảnh**. Ảnh thiết kế gốc trên thẻ Trello được gửi làm reference cho cả 6 lần tạo để giữ artwork, logo, chữ và màu sắc. Tùy chọn chất lượng `low`, `medium` hoặc `high` áp dụng cho OpenAI và gateway CheapKeyAI.

```env
MOCKUP_IMAGE_MODEL=gpt-image-1.5
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_TIMEOUT_MS=120000
GEMINI_IMAGE_TIMEOUT_MS=90000
GEMINI_IMAGE_RETRY_ATTEMPTS=2
GEMINI_IMAGE_CONCURRENCY=1
IMAGE_GENERATION_CONCURRENCY=3
```

Model và API key chỉ được gọi trong Route Handler phía server. Mỗi lần tạo một bộ mockup có thể phát sinh chi phí của provider cho 6 ảnh AI được sinh.

Để dùng lựa chọn **GPT Image 2 C (CheapKeyAI)**:

1. Đăng ký hoặc đăng nhập CheapKeyAI và nạp ví.
2. Kiểm tra dashboard/key group có quyền dùng model ID `gpt-image-2`. Tên
   `gpt-image-2-c` chỉ là nhãn cục bộ để phân biệt provider trong ứng dụng.
3. Mở [`cheapkeyai.shop/keys`](https://cheapkeyai.shop/keys), tạo một API key
   riêng cho ứng dụng và sao chép key.
4. Dán key vào `.env.local` ở thư mục gốc của project:

```env
CHEAPKEYAI_API_KEY=sk-your-cheapkeyai-key
CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1
```

5. Khởi động lại dev server rồi chọn **GPT Image 2 C (CheapKeyAI)** trong Auto
   Mockup Generator.

`gpt-image-2-c` là tên lựa chọn cục bộ; ứng dụng gửi model ID `gpt-image-2` tới
endpoint tương thích OpenAI của CheapKeyAI. Giá được ghi nhận cố định
**$0.005/ảnh AI**, không phụ thuộc token hoặc quality; 6 mockup AI là **$0.03**.
Request không gửi trường `response_format`; gateway trả base64 mặc định và ứng
dụng đọc dữ liệu từ `b64_json`. Không dùng định dạng URL. Ứng dụng gửi
`input_fidelity=high` để giữ màu sắc, chữ và chi tiết artwork gốc; output vẫn là
quality đã chọn (kể cả `low`) và giá ghi nhận vẫn là $0.005/ảnh.

Key này không thay thế `OPENAI_API_KEY`. Gói CheapKeyAI của bạn phải hỗ trợ image
edit/reference images; nếu không, gateway sẽ trả lỗi model hoặc endpoint không
khả dụng. Không đặt key trong biến `NEXT_PUBLIC_*`, trình duyệt, chat hoặc source
code; nên dùng key riêng có thể thu hồi. Khi chọn provider này, ảnh thiết kế tham
chiếu sẽ được gửi qua máy chủ CheapKeyAI.

Smoke test một ảnh thật (có thể tính **$0.005**, không fallback):

```bash
CHEAPKEYAI_LIVE_TEST=1 npm run mockup:cheapkeyai:smoke
```

Test chỉ thành công khi response giải mã được thành ảnh và provider trace là
`cheapkeyai`; ảnh kiểm tra được lưu trong `output/cheapkeyai-gpt-image-2-live.*`.
Nếu lỗi `get_channel_failed`, key đang ở group không có channel ảnh hoạt động;
đổi group của key trong dashboard hoặc gửi request ID cho CheapKeyAI support.

## Pipeline sinh listing

1. Đọc dữ liệu operator đã điền.
2. Nếu Helium 10 được cấu hình, lấy Search Volume và chọn KW lõi 1/2 cùng các keyword Event, người nhận và người tặng có liên quan.
3. Chạy Tesseract OCR cục bộ và đưa nguyên văn các dòng đọc được cho AI.
4. Đọc tối đa 3 ASIN để lấy title, cách gọi sản phẩm và các thuộc tính đối thủ. Đây chỉ là bối cảnh tham khảo, không phải fact của sản phẩm.
5. Gọi một AI writer duy nhất với input, OCR, ảnh nguồn, keyword research và tóm tắt reference để sinh SEO title, đúng 5 bullet points, description và Generic Keywords.
6. Title theo thứ tự `Brand + Core Product Type, Theme/Design + Primary Search Intent for Recipient, Key Attribute/Use + Feature, Size/Count`. Main Keyword phải xuất hiện nguyên cụm trong title. Mục tiêu 150-190 ký tự, tối đa 200 ký tự.
7. Bullet dùng format `BENEFIT-LED HEADER IN CAPS: Feature + customer benefit + use case`, mục tiêu 180-260 ký tự mỗi bullet. Description mục tiêu 1.000-1.200 ký tự. Generic Keywords được làm sạch riêng trước khi xuất.
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
- Batch Excel được chia thành chunk nhỏ; API có request limit, rate limit, timeout và idempotency.
- Ảnh được lưu riêng trong `listing_images`; `input_json` chỉ giữ metadata và hash.
- Mỗi mutation có revision và audit event; truy vấn được scope theo workspace/team.
- Batch Excel tự điền template Amazon đã chọn, giữ nguyên cấu trúc parent + child và các thuộc tính category để tiếp tục kiểm tra hoặc upload Seller Central.

## Tự động hóa Excel theo SKU

Mở **Batch**, chọn template đã lưu rồi tải file input `.xlsx` hoặc `.xlsm`. Hệ thống tự nhận diện bốn cột sau, không phụ thuộc thứ tự cột:

- `SKU`
- `Link ảnh (Trello)` — nhiều URL có thể ngăn cách bằng xuống dòng, `|` hoặc `;`
- `Tên sản phẩm (Main Keyword)`
- `Generic Keywords`

Brand được chọn ngay trong modal Batch từ Brand profile đã lưu hoặc nhập thủ công. Brand nhập thủ công có thể lưu ngay tại đây để tái sử dụng cho các batch sau. Hệ thống tải ảnh Trello, nén ảnh cho AI, tạo listing theo prompt/rule hiện tại, sau đó tải về category workbook đã có parent, child, variation và các thuộc tính tĩnh từ template.

Trong modal Batch, upload template Amazon một lần và đặt tên dễ chọn như `Hanging Ornament` hoặc `Glass Ornament`. Hệ thống lưu workbook theo workspace, tự dò dòng technical headers và ghi nhớ vị trí thực tế của Title, Description, Bullet Points, Generic Keywords và ảnh. Các lần sau chỉ cần chọn template đã lưu rồi upload file input SKU.

Nút **Tải file đầu vào mẫu** tạo sẵn workbook bốn cột. Không có tọa độ cột content nào được cấu hình cố định; cùng một trường `generic_keyword[...]` có thể nằm ở AP, CG hoặc cột khác tùy template.

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
- `GET|POST /api/import/sku-workbook`
- `GET /api/import/trello-image`
- `POST /api/import/amazon-template`
- `GET|POST /api/templates`
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
