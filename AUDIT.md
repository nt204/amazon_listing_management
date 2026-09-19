Bản audit của bạn hoàn toàn chính xác và đi thẳng vào đúng các "điểm nghẽn" lớn nhất gây lag, tải chậm và hao tốn tài nguyên hệ thống hiện nay. 

Theo yêu cầu **chưa sửa code trong lượt này**, tôi đã rà soát chi tiết codebase theo các điểm bạn nêu và tổng hợp phân tích kỹ thuật cùng phương án giải quyết tối ưu cho từng hạng mục như sau:

---

### 1. Xác nhận các điểm nghẽn kỹ thuật trong mã nguồn

| STT | Vấn đề | Vị trí trong Codebase | Hiện trạng & Nguyên nhân |
| :--- | :--- | :--- | :--- |
| **1** | **3 API thừa khi khởi động** | [`ppc-dashboard.tsx:419-425`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/components/ppc/ppc-dashboard.tsx#L419-L425) | `loadData()` tự động bắn `fetch("/api/ppc/cost-master")`, `fetch("/api/ppc/rules")`, `fetch("/api/ppc/bulk-export")`. Trong khi giao diện chính hoàn toàn không render `costMasters` hay `ruleVersions`; còn `bulkHistory` chỉ xuất hiện khi người dùng mở drawer Action Queue. |
| **2** | **Quét 20.000 Search Terms ở mọi tab** | [`lib/ppc/service.ts:127-140`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/service.ts#L127-L140) | Hàm `getPpcAnalyticsData` luôn chạy `listPpcSearchTerms(..., { limit: 20_000 })` bất kể `requestedSection` là `CAMPAIGNS`, `TARGETS`, hay `SKUS`. Sau đó hàm còn lặp tính alerts, breakdown, daily trends của Search Terms rồi vứt bỏ, gây lãng phí RAM và nghẽn CPU server. |
| **3** | **Xung đột 2 request metrics song song** | [`ppc-dashboard.tsx:470-490`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/components/ppc/ppc-dashboard.tsx#L470-L490) | Khi đổi Store / SKU / Days: một effect gọi `loadData()` (tải overview), cùng lúc effect khác gọi `loadSection(activeTab)` (tải tab chi tiết). Hai luồng chạy đua (race condition), vừa nhân đôi tải DB, vừa có nguy cơ overview trả về sau và ghi đè danh sách rút gọn lên tab chi tiết. |
| **4** | **Tab Đề Xuất quét 1.5M dòng Target mỗi lần click** | [`recommendations/grouped/route.ts`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/app/api/ppc/recommendations/grouped/route.ts#L1) & [`sku-architecture-service.ts:460`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/sku-architecture-service.ts#L460) | Bảng `ppc_performance_facts` hiện có **1.856.464 dòng** (Target chiếm **1.518.192 dòng**). API gom nhóm đề xuất chạy toàn bộ Rule Engine cho 25.000 Target mà không có cache. Mỗi lần chuyển tab rồi bấm lại là server phải parse và chạy tính toán lại từ đầu. |
| **5** | **Action Queue quét lặp toàn bộ lịch sử snapshot** | [`sku-architecture-service.ts:1170-1190`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/sku-architecture-service.ts#L1170-L1190) | Trang chủ tải `/api/ppc/actions` ngay từ đầu chỉ để lấy số lượng hiển thị trên nút Badge. Bên dưới, `getActionQueue` lại chạy `GROUP BY sku` trên toàn bộ bảng lịch sử `grain = 'PRODUCT'` mà không lọc theo snapshot mới nhất (`snapshot_date = latest`), làm tổng spend bị cộng dồn sai lệch qua các ngày và quét qua hàng trăm nghìn dòng không cần thiết. |
| **6** | **N+1 Query khi duyệt hàng loạt đề xuất** | [`sku-architecture-service.ts:1020-1110`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/lib/ppc/sku-architecture-service.ts#L1020-L1110) | Vòng lặp `for (const rec of recommendations)` thực hiện từng query `SELECT`, sau đó `UPDATE` và `INSERT` riêng lẻ cho từng target. Khi duyệt 100 đề xuất sẽ phát sinh từ 200 đến 300 câu lệnh SQL đến PostgreSQL. |

---

### 2. Kế hoạch giải pháp chi tiết (sẵn sàng thực thi khi bạn yêu cầu)

#### Giai đoạn 1: Giảm tải tức thì (Quick Wins - Cắt giảm 70% số request)
1. **Dọn dẹp tải ban đầu trong [`ppc-dashboard.tsx`](file:///Users/macbook/Desktop/Amazon%20Listing%20Management/components/ppc/ppc-dashboard.tsx):**
   - Xóa bỏ 2 lệnh gọi API `/api/ppc/cost-master` và `/api/ppc/rules` khỏi `loadData()`.
   - Chuyển `/api/ppc/bulk-export` thành lazy-load (chỉ gọi khi người dùng bấm mở Action Queue drawer).
   - Tách API đếm số lượng nhẹ `/api/ppc/actions/count` (chỉ `SELECT COUNT(*) WHERE status = 'PENDING'`) để hiển thị badge, chỉ tải toàn bộ danh sách khi drawer thực sự mở.
2. **Loại bỏ xung đột gọi kép khi đổi bộ lọc:**
   - Khi đang ở tab chi tiết (`activeTab !== "overview"`), việc đổi store/sku/days chỉ kích hoạt tải đúng section hiện tại (`loadSection(activeTab)`), không kích hoạt `loadData()` overview ngầm.

#### Giai đoạn 2: Tối ưu hoá truy vấn Server (`getPpcAnalyticsData`)
1. **Lọc dữ liệu theo đúng Section yêu cầu:**
   - Nếu `section === "CAMPAIGNS"`: chỉ query bảng Campaign facts, **bỏ qua hoàn toàn** `listPpcSearchTerms`.
   - Nếu `section === "TARGETS"`: chỉ query bảng Target facts, bỏ qua Search Terms.
   - Nếu `section === "SEARCH_TERMS"`: mới gọi `listPpcSearchTerms`.
   - Chỉ tính toán alerts và breakdown tổng quan khi `section === "OVERVIEW"`.
2. **Sửa query `getActionQueue`:**
   - Thêm điều kiện `snapshot_date = (SELECT MAX(snapshot_date) FROM ppc_performance_facts WHERE store_id = ...)` khi tính spend theo SKU để triệt tiêu việc cộng dồn lặp lịch sử và tăng tốc độ query lên gấp nhiều lần.

#### Giai đoạn 3: Caching & Batching (Dành cho tập dữ liệu lớn)
1. **Cache Grouped Recommendations:**
   - Cache kết quả đề xuất theo cặp `(storeName, sku, latestSnapshotDate)` phía server (in-memory hoặc Redis/DB cache key) với thời gian sống ngắn (ví dụ: 10 phút hoặc cho đến khi có file PPC mới được nạp).
   - Phía client: lưu tạm state recommendations trong component, chuyển tab qua lại không cần gọi lại API nếu các bộ lọc chưa thay đổi.
2. **Batch Processing cho Action Queue Approval:**
   - Chuyển `approveRecommendationsToActionQueue` sang câu lệnh `INSERT INTO ppc_action_queue (...) VALUES (...)` theo lô (Batch Insert), gom `UPDATE` theo mảng IDs thay vì lặp từng dòng.

---

Khi bạn sẵn sàng triển khai, hãy thông báo để tôi bắt đầu thực hiện theo thứ tự ưu tiên trên.


Logic tổng thể đúng hướng, nhưng pipeline hiện tại chưa tối ưu và có vài rủi ro về chất lượng dữ liệu. Không nên đơn giản đổi tất cả sang `Promise.all`; cần song song có giới hạn và giữ phần ghi database theo đúng ranh giới transaction.

## Luồng hiện tại

```text
AdsPower
  → tải tuần tự 6 file
  → nạp tuần tự từng file vào PostgreSQL
  → upload tuần tự từng file lên R2
  → đóng AdsPower
  → refresh toàn bộ dashboard
```

Upload thủ công:

```text
Browser upload
  → stream file xuống thư mục tạm
  → parse
  → ghi database theo từng batch 500 dòng
  → ghi sync log
  → xóa file tạm
  → refresh dashboard
```

R2:

```text
List toàn bộ object
  → chọn batch mới nhất
  → tải và parse tuần tự từng file
  → giữ toàn bộ rows trong RAM
  → merge
  → ghi database
```

## Những phần đang làm tốt

- Upload HTTP được stream xuống file tạm, không giữ toàn bộ file 150 MB trong request memory.
- Bulk Excel lớn được parse bằng Python streaming.
- SP/SB và 7/30 ngày được phân biệt bằng `adType` và coverage, nên thứ tự nạp 30 ngày trước 7 ngày không gây ghi đè nếu metadata đúng.
- Dữ liệu được deduplicate và dùng `ON CONFLICT`.
- R2 chỉ thay snapshot sau khi file đã parse thành công.
- Lỗi backup R2 không làm mất dữ liệu đã ghi database.
- Các file trong một batch R2 được merge trước khi replace, tốt hơn việc mỗi file tự xóa snapshot của file trước.

## Các vấn đề cần ưu tiên

### 1. Ghi Bulk streaming không atomic

Trong [service.ts](</Users/macbook/Desktop/Amazon Listing Management/lib/ppc/service.ts:369>), mỗi batch 500 dòng gọi riêng `upsertPpcPerformance()`.

Batch đầu tiên:

- Xóa snapshot cũ.
- Insert 500 dòng.
- Commit transaction.

Các batch sau tiếp tục bằng transaction khác. Nếu parser lỗi ở giữa file, database còn snapshot bị thiếu một phần và snapshot cũ đã bị xóa.

Đây là vấn đề chất lượng nghiêm trọng nhất.

Nên đổi sang:

```text
stream parse
  → COPY/chunk insert vào staging table
  → validate số dòng và coverage
  → một transaction ngắn:
      xóa scope cũ
      insert từ staging
  → commit
```

Không nên chạy song song các batch ghi cùng scope.

### 2. Quá nhiều transaction nhỏ

Một file 100.000 dòng hiện tạo khoảng 200 transaction, mỗi transaction lại:

- Upsert store.
- Có thể xác định scope.
- Insert 500 dòng.
- Commit.

Chi phí round-trip và commit rất lớn. Staging table kết hợp `COPY FROM` sẽ nhanh hơn đáng kể.

### 3. AdsPower tải 6 file hoàn toàn tuần tự

[downloadAdsPowerReports](</Users/macbook/Desktop/Amazon Listing Management/lib/ppc/adspower-service.ts:878>) tải:

1. Bulk SP 30 ngày
2. Bulk SB 30 ngày
3. Bulk SP 7 ngày
4. Bulk SB 7 ngày
5. Search Term SP
6. Search Term SB

Mỗi Bulk có thể chờ Amazon tối đa 120 giây. Tổng thời gian xấu nhất vượt xa `maxDuration = 300`.

Có thể song song, nhưng chỉ nên concurrency 2:

- Một worker Bulk.
- Một worker Search Term.
- Hoặc tối đa hai report request cùng lúc.

Không nên `Promise.all` cả 6 vì:

- Cùng thao tác một Amazon Ads account.
- Cùng theo dõi thư mục download.
- Logic hiện tại nhận diện file bằng “file mới xuất hiện”, rất dễ gán nhầm file khi nhiều download cùng chạy.

Trước khi song song phải chuyển sang bắt download riêng theo page/request ID, không dựa vào snapshot chung của thư mục.

### 4. Có nguy cơ tải nhầm báo cáo Amazon

Search Term sau khi tạo report đang lấy link download đầu tiên khớp selector chung, không luôn xác nhận:

- Đúng SP hay SB.
- Đúng ngày hiện tại.
- Đúng report vừa tạo.
- Đúng trạng thái completed.

Bulk khi timeout còn fallback sang link đầu bảng, có thể là link cũ, trái với ý định “chỉ tải file mới”.

Nên nhận diện bằng tên report duy nhất, ví dụ có `syncRunId`, sau đó tìm đúng row chứa tên đó. Nếu không thấy đúng row thì báo lỗi, không fallback sang file cũ.

### 5. AdsPower nạp DB rồi mới backup R2

Sau khi tải đủ file, DB ingest và R2 backup đang chạy tuần tự. Hai tác vụ này độc lập và cùng chỉ đọc file local nên có thể chạy đồng thời:

```ts
await Promise.all([
  ingestDownloadedPpcFiles(...),
  uploadReportsToR2(...),
]);
```

Tuy nhiên:

- Ingest DB vẫn nên giữ thứ tự/transaction an toàn.
- R2 upload nên concurrency 2–3.
- Không dùng `readFileSync` cho file lớn; nên truyền read stream cho S3.

### 6. R2 sync xử lý lại file đã thành công

Đã có `hasSuccessfulPpcSync()` nhưng [syncPpcReportsFromR2](</Users/macbook/Desktop/Amazon Listing Management/lib/ppc/service.ts:446>) không dùng nó.

Vì vậy mỗi lần bấm sync:

- List lại toàn bộ bucket prefix.
- Tải lại file.
- Parse lại file.
- Upsert lại database.
- Cuối cùng sync log bị `ON CONFLICT DO NOTHING`.

Nên kiểm tra `Key + ETag + Size + LastModified` trước khi download. File đã SUCCESS và version không đổi phải được skip ngay.

Đây có thể là tối ưu lớn nhất của R2 sync.

### 7. R2 giữ quá nhiều dữ liệu trong RAM

Hiện mỗi file được tải thành `Buffer`, parse thành array, sau đó tất cả array được giữ trong:

- `parsedSearchTerms`
- `parsedPerformance`
- `mergedRows`

Với nhiều Bulk lớn, có thể tồn tại đồng thời cả buffer và hàng trăm nghìn object JavaScript.

Nên:

- Download về file tạm hoặc stream.
- Parse vào staging table.
- Không `flatMap` toàn bộ dữ liệu trong RAM.
- Xóa file tạm sau commit.

### 8. API sync là request đồng bộ dài

AdsPower sync có thể kéo dài hơn 5 phút nhưng HTTP route chờ toàn bộ quá trình. Nếu client đóng tab, proxy timeout hoặc Next process restart thì trạng thái khó xác định.

Luồng tốt hơn:

```text
POST /sync
  → tạo sync_job
  → trả jobId ngay

Worker:
  tải → validate → staging → commit → backup

UI:
  polling /api/sync-jobs/:id
```

Như vậy có progress từng file, retry và không phụ thuộc timeout HTTP.

## Cách song song an toàn

Nên áp dụng:

- Download AdsPower: concurrency 2.
- Upload R2: concurrency 2–3.
- Parse các file độc lập: concurrency 2, vì parse Excel tốn CPU/RAM.
- DB staging insert: có thể chunk tuần tự hoặc `COPY`.
- Commit/replace cùng store + coverage + adType: tuần tự và atomic.
- Ingest DB và backup R2: chạy song song sau khi download hoàn tất.
- Refresh dashboard: chỉ chạy sau khi DB commit thành công.

Không nên:

- `Promise.all` tất cả batch DB.
- Đồng thời replace hai file có cùng scope.
- Cho nhiều page AdsPower cùng theo dõi một thư mục download bằng logic “file mới nhất”.
- Refresh metrics trong khi ingest chưa commit xong.

## Thứ tự triển khai đề xuất

1. Sửa ingest Bulk thành staging + atomic replace.
2. Bỏ xử lý lại file R2 đã SUCCESS và không thay đổi.
3. Làm nhận diện report AdsPower bằng report name/run ID chính xác.
4. Chạy DB ingest và R2 backup song song.
5. Thêm bounded concurrency cho download/parse/upload.
6. Chuyển AdsPower sync thành background job có progress.
7. Sau commit chỉ invalidate/cache-refresh phần dữ liệu liên quan.

Kết luận: pipeline hiện tại ưu tiên đơn giản và tương đối an toàn khi mọi thứ thành công, nhưng chưa tốt về thời gian và chưa đảm bảo atomic khi Bulk streaming lỗi giữa chừng. Tối ưu quan trọng nhất không phải thêm `async` hàng loạt, mà là staging database, skip file không đổi và song song có giới hạn.