# Listing Desk

Workflow nội bộ để tạo, review và export Amazon Listing.

## Chạy local

```bash
npm install
python3 -m pip install -r requirements.txt
cp .env.example .env
npm run dev
```

`npm run dev` khởi động PostgreSQL trên cổng `2412`, Redis trên cổng `2413`, chạy migration có checksum rồi mới chạy Next.js trên cổng `2411`. Docker Desktop cần đang mở. Truy cập [http://localhost:2411](http://localhost:2411).

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

### Hàng đợi mockup cho nhiều người dùng

Tạo mockup đi qua hàng đợi bền vững trong PostgreSQL. Redis điều phối giới hạn
provider và worker được khởi động cùng tiến trình Node.js bằng Next.js
instrumentation. Sau khi đã nhận `jobId`, tác vụ tiếp tục chạy khi người dùng tải
lại trang, đóng modal hoặc mất kết nối; giao diện tự đọc lại các job đang hoạt
động và đồng bộ ảnh từ Trello khi hoàn tất.

Với một team khoảng 10 người, dùng cấu hình khởi đầu sau:

```env
MOCKUP_JOB_WORKER_ENABLED=true
MOCKUP_JOB_WORKER_CONCURRENCY=5
MOCKUP_MAX_ACTIVE_PRODUCTS=5
MOCKUP_MAX_CHEAPKEYAI_IMAGE_REQUESTS=3
MOCKUP_MAX_GLOBAL_IMAGE_REQUESTS=6
MOCKUP_MAX_TRELLO_UPLOADS=2
MOCKUP_MAX_QUEUED_JOBS_PER_TEAM=30
MOCKUP_JOB_RATE_LIMIT_PER_MINUTE=10
```

`MOCKUP_JOB_WORKER_CONCURRENCY` là số job được worker nhận, không phải số request
AI. Giới hạn request ảnh toàn hệ thống vẫn do Redis và các biến
`MOCKUP_MAX_*_IMAGE_REQUESTS` kiểm soát. Không tăng CheapKeyAI quá 3 trước khi
provider xác nhận quota và số liệu production cho thấy tỷ lệ lỗi ổn định.

Queued worker chỉ sử dụng `TRELLO_API_KEY` và `TRELLO_TOKEN` phía server; credential
Trello từ trình duyệt không được ghi vào bảng job. Production nhiều instance phải
dùng chung `DATABASE_URL` và `REDIS_URL`. Redis trong `compose.yaml` bật AOF để
khôi phục trạng thái điều phối sau restart; PostgreSQL vẫn là nguồn dữ liệu chính
của job.

Trello API Key và Token chỉ được cấu hình trong `.env` trên server và không bao
giờ được trả về trình duyệt. Trong màn hình cấu hình, người dùng chỉ nhập Board ID
hoặc URL của Board. Board được chuẩn hóa, kiểm tra bằng credential server rồi lưu
riêng trong PostgreSQL theo cặp `team_id + actor_id`; người dùng mới luôn bắt đầu
với ô Board trống.

Sau khi kiểm tra Board, người dùng cấu hình riêng tại từng chức năng: tab Listing chỉ
hiển thị cột đầu và cột đích của Listing, còn tab Mockup chỉ hiển thị cột đầu và cột
đích của Mockup. Ứng dụng lưu List ID thay vì dò theo tên,
vì vậy có thể dùng bất kỳ tên cột Trello nào. Hai cột trong cùng một chức năng phải
khác nhau và tất cả cột phải thuộc Board đã chọn.

Luồng tạo Listing không tự dừng theo thời gian. Người dùng có thể ngắt từng Listing
đang chạy hoặc ngắt toàn bộ Batch ngay trên giao diện; thao tác hủy được truyền xuống
request AI và Trello trên server.

### Cloudflare R2 object storage

Ảnh listing, derivative Trello và workbook Amazon có thể chuyển khỏi PostgreSQL
sang bucket Cloudflare R2 private. Tích hợp hỗ trợ dual-write, backfill, verify,
cleanup có xác nhận và fallback về binary DB trong giai đoạn rollout. Xem hướng
dẫn đầy đủ tại [docs/CLOUDFLARE_R2.md](docs/CLOUDFLARE_R2.md).

Quy trình release self-hosted:

```bash
npm ci
docker compose up -d db redis
npm run db:migrate
npm run auth:bootstrap
npm run build
npm run start
```

Chỉ đưa instance vào load balancer sau khi `GET /api/health` trả HTTP 200 và có
`redis: "ready"`. Nếu triển khai ra ngoài mạng riêng/VPN, bật
`LISTING_DESK_AUTH_MODE=required`, đặt `LISTING_DESK_SESSION_SECRET` tối thiểu 32
ký tự và khai báo một admin đầu tiên trong `LISTING_DESK_TEAMS_JSON`. Chạy
`npm run auth:bootstrap` sau migration. Người dùng tự đăng ký trên màn hình đăng
nhập và ở trạng thái chờ cho đến khi admin duyệt tại `/admin`. Worker dùng chính
session secret để gọi engine nội bộ; có thể tách riêng bằng `MOCKUP_WORKER_SECRET`.

Sau lần đăng nhập admin đầu tiên, mở menu tài khoản và chọn **Đổi mật khẩu** để
thay mật khẩu bootstrap. Script bootstrap không ghi đè mật khẩu của tài khoản đã
tồn tại.

### Glass Ornament với template

Trong modal **Template Glass Ornament**, chọn một ảnh sản phẩm nguồn và đúng một
template. Server gửi template làm ảnh base và ảnh sản phẩm làm reference trong
cùng một request Image Edit tới CheapKeyAI, với upstream model được khóa cứng là
`gpt-image-2`. Kết quả được AI tạo trực tiếp; luồng này không crop, mask,
composite, resize hậu kỳ hoặc fallback sang ghép ảnh cục bộ hay OpenAI trực
tiếp. Nếu CheapKeyAI lỗi hoặc thiếu key, API trả lỗi thay vì sinh kết quả thay
thế.

```env
CHEAPKEYAI_API_KEY=sk-your-cheapkeyai-key
CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1
TEMPLATE_MOCKUP_IMAGE_SIZE=2000x2000
TEMPLATE_MOCKUP_IMAGE_QUALITY=high
TEMPLATE_MOCKUP_IMAGE_TIMEOUT_MS=600000
```

`OPENAI_API_KEY` và `TEMPLATE_MOCKUP_IMAGE_MODEL` không được dùng trong luồng
Glass Ornament Template Mockup.

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

Mỗi Brand tương ứng với một tài khoản Seller Central. Khi tải template Amazon, người dùng chỉ chọn file dưới Brand hiện tại; hệ thống đọc `contributorId`, marketplace và product type để xác minh đúng tài khoản và đặt tên `Brand - Tên phôi`. Nếu Brand chưa có phôi này, người dùng phải tải blank từ Seller Central của chính Brand đó. Hệ thống có thể map nội dung mẫu từ Brand khác vào blank, nhưng tuyệt đối giữ metadata, validation, hidden sheet và cấu trúc Amazon của Brand đích. Hệ thống không xuất workbook của Brand này cho tài khoản Brand khác.

`Tên Phôi` được gợi ý từ tên file nhưng người dùng có thể sửa trước khi lưu. Đây là khóa nhận diện biến thể độc lập với product type Amazon: `Glass Ornament` và `Suncatcher` có thể cùng thuộc `Hanging Ornament` nhưng được lưu riêng. Auto-map chỉ diễn ra giữa các shop có cùng Tên Phôi đã chuẩn hóa **và** cùng product type Amazon; tải lại cùng Tên Phôi trong cùng shop sẽ cập nhật phiên bản hiện có.

Nút **Tải file đầu vào mẫu** tạo sẵn workbook bốn cột. Không có tọa độ cột content nào được cấu hình cố định; cùng một trường `generic_keyword[...]` có thể nằm ở AP, CG hoặc cột khác tùy template.

Auth dùng tài khoản trong PostgreSQL. Mỗi tài khoản có cấu hình Trello riêng theo
`team_id + user_id`; listing, brand, template và prompt/preset vẫn dùng chung theo
`team_id`. Tài khoản mới phải được admin duyệt trước khi đăng nhập.

## Database và release

```bash
npm run db:start
npm run db:migrate
npm run auth:bootstrap        # tạo admin đầu tiên từ LISTING_DESK_TEAMS_JSON
npm run db:maintain          # dọn preview quá hạn, VACUUM/ANALYZE và kiểm tra ổ đĩa
npm run db:backfill-images   # chỉ cần cho dữ liệu cũ còn inline image
npm run db:revalidate        # chạy sau khi đổi rule/policy version
npm run ocr:eval -- <listing-id>  # xem OCR của listing; bỏ ID để dùng listing mới nhất
npm run ai:eval -- <listing-id>   # chạy pipeline thật nhưng không ghi listing mới vào DB
```

Production release phải chạy `npm run db:migrate` trước `npm run start`. Migration đã áp dụng được bảo vệ bằng checksum; không sửa file migration cũ, hãy thêm migration mới.

### Bảo trì dung lượng production

Ảnh mockup master nằm trên Trello. PostgreSQL chỉ giữ WebP preview 1280px và
thumbnail 320px. Khi một attachment cũ được thay thế, derivative tương ứng được
xóa ngay; derivative không được cập nhật trong 90 ngày cũng được dọn tự động sau
các lượt tạo mockup.

Đặt lệnh bảo trì chạy mỗi ngày lúc ít người dùng, ví dụ với cron trên VPS:

```cron
0 3 * * * cd /opt/listing-desk && /usr/bin/npm run db:maintain >> /var/log/listing-desk-maintenance.log 2>&1
```

Lệnh này dọn toàn bộ preview quá hạn theo batch rồi chạy `VACUUM (ANALYZE)` cho
hai bảng ảnh. Nó trả exit code `1` khi ổ đĩa đạt ngưỡng cảnh báo và `2` ở ngưỡng
nguy cấp để cron/monitoring gửi cảnh báo. Cấu hình mặc định:

```env
TRELLO_PREVIEW_RETENTION_DAYS=90
TRELLO_PREVIEW_SYNC_CONCURRENCY=3
TRELLO_PREVIEW_SYNC_TIMEOUT_MS=45000
TRELLO_PREVIEW_SYNC_MAX_BYTES=20000000
DISK_WARNING_PERCENT=70
DISK_CRITICAL_PERCENT=80
# Trỏ tới filesystem chứa dữ liệu trên production nếu khác thư mục ứng dụng.
DISK_MONITOR_PATH=/var/lib/listing-desk
```

Khi tải một cột Trello, ứng dụng trả URL ảnh cùng miền ngay lập tức rồi quét nền
các attachment chưa có preview. Server tải ảnh bằng Trello credential, tạo WebP
1280px/320px và lưu vào object storage. Lần hiển thị sau đọc trực tiếp từ R2 hoặc
database; giới hạn đồng thời giúp việc quét không làm nghẽn Trello.

`GET /api/health` trả thêm số byte trống/tổng và phần trăm đã dùng. Từ 70% nó
trả trạng thái `warning`; từ 80% trả `critical` với HTTP 503. Nên nối endpoint
này với uptime monitor của VPS. `VACUUM` định kỳ cho phép PostgreSQL tái sử dụng
dung lượng; nếu cần thu nhỏ file database thật sự, chỉ chạy `VACUUM FULL` trong
khung bảo trì vì thao tác đó khóa bảng.

## API chính

- `GET /api/health`
- `GET /api/listings`
- `POST /api/listings/generate`
- `POST /api/keywords/research`
- `POST /api/listings/batch`
- `GET|POST /api/import/sku-workbook`
- `GET /api/import/trello-image`
- `POST /api/import/amazon-template` - yêu cầu đúng cặp `shop_id` và `template_id`
- `GET|POST|PATCH /api/templates` - `POST` chỉ nhận file; backend tự nhận diện shop + phôi và tự chọn phôi tương thích để map khi cần
- `GET|POST|DELETE /api/shops`
- `POST /api/listings/export`
- `GET|PUT /api/listings/:id`
- `POST /api/listings/:id/revise`
- `POST /api/listings/:id/workflow`
- `POST /api/listings/:id/approve`
- `POST /api/listings/:id/export`
- `GET|POST /api/brands`
- `POST /api/references`
- `POST /api/trello/process-card` - yêu cầu `shopId` và `templateId`; trả JSON như cũ; gửi `Accept: application/x-ndjson`
  để nhận tiến độ từng công đoạn, event `listing_ready` trước khi Excel/Trello hoàn tất,
  rồi event `complete` sau hậu xử lý.

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
