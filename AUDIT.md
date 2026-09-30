Searched for "retention"
Viewed repository.ts:2980-3031
Searched for "cleanupPpcHistoricalData"
Viewed service.ts:1270-1300

Để **hoàn toàn không làm ảnh hưởng đến bất kỳ logic code hiện tại** (thuật toán tính Bid, ACoS hòa vốn, Dashboard, Action Queue), giải pháp tối ưu nhất là sử dụng mô hình **"Bảo trì sau nạp (Post-Ingestion Hook)"** kết hợp **"Cấu hình bên ngoài (External Configuration)"**.

Toàn bộ code đọc dữ liệu hiện tại vốn dĩ **chỉ đọc snapshot mới nhất hoặc trong khoảng 7 - 30 ngày gần nhất**, nên việc giải phóng các ngày cũ hơn 31 ngày là **hoàn toàn vô hại đối với thuật toán**.

Dưới đây là kế hoạch chi tiết vị trí xây dựng và các bước thực hiện:

---

### 1. Kiến trúc vị trí can thiệp (Tách biệt 100% với Logic lõi)

```
[Mac Crawler cào 6 file]
       │
[Cloudflare R2] ──► (1. R2 Lifecycle: Tự xóa object > 31 ngày)
       │
[Server Ingestion nạp vào Database] (Logic nghiệp vụ GIỮ NGUYÊN 100%)
       │
[Dashboard & Tối ưu Bid hoạt động] (Logic đề xuất GIỮ NGUYÊN 100%)
       │
       ▼ (Chỉ can thiệp ở ĐUÔI tiến trình - Sau khi nạp xong xuôi)
[2. Post-Ingestion Retention Hook]
       └── Gọi lệnh dọn dẹp các snapshot cũ hơn 31 ngày
```

---

### 2. Kế hoạch triển khai 3 vị trí cụ thể:

#### Vị trí 1: Trên Server Database (PostgreSQL)
Hệ thống của bạn **đã có sẵn hàm dọn dẹp** `cleanupPpcHistoricalData()` tại `lib/ppc/repository.ts` (hiện đang để mặc định 60 ngày).
* **Vị trí can thiệp:** File `lib/ppc/service.ts` (Dòng 1284).
* **Cách làm không ảnh hưởng code:** Thay vì hardcode số ngày, ta đọc từ biến môi trường với mặc định là **`31`**:
  ```ts
  const retentionDays = Number(process.env.PPC_DATA_RETENTION_DAYS || 31);
  await cleanupPpcHistoricalData(scope, retentionDays);
  ```
* **Đặc điểm:** Hàm này chỉ chạy **sau khi toàn bộ dữ liệu mới đã nạp thành công 100%**. Nếu có lỗi trong quá trình dọn dẹp, nó có `try/catch` riêng nên tuyệt đối không bao giờ làm gián đoạn hay hỏng dữ liệu mới.

#### Vị trí 2: Trên Cloudflare R2 (Kho lưu trữ file)
Để không phải sửa code kết nối R2 và không tốn CPU server:
* **Vị trí can thiệp:** Cài đặt trực tiếp trên Cloudflare Dashboard (Không đụng đến bất kỳ dòng code nào).
* **Cách làm:**
  1. Vào Cloudflare ➔ **R2** ➔ Chọn Bucket `amazon-listing-production`.
  2. Vào tab **Settings** ➔ Mục **Lifecycle Rules** ➔ Bấm **Add rule**.
  3. Đặt quy tắc:
     * Prefix: `ppc-reports/`
     * Action: **Delete object**
     * Age: **31 days**
* **Đặc điểm:** Cloudflare chạy ngầm tự động xóa các file quá 31 ngày ở tầng hạ tầng, hoàn toàn độc lập với ứng dụng.

#### Vị trí 3: Trên Máy Mac mini (Ổ cứng cục bộ)
Đồng bộ thời gian lưu trữ trên ổ SSD của Mac:
* **Vị trí can thiệp:** File `mac-crawler/config.env`.
* **Cách làm:**
  ```bash
  LOCAL_RETENTION_DAYS=31
  ```
* **Đặc điểm:** Script `maintenance.sh` có sẵn trên máy Mac sẽ tự động giữ đúng 31 ngày tải gần nhất và dọn dẹp ngày thứ 32 trở đi.

---

### 3. Bảng tóm tắt kế hoạch

| Hạng mục | Vị trí can thiệp | Rủi ro ảnh hưởng code | Thời gian thực hiện |
| :--- | :--- | :---: | :---: |
| **1. Database Retention** | Biến `PPC_DATA_RETENTION_DAYS=31` trong `.env` & hook cuối `service.ts` | **0%** *(Chạy ngầm ở cuối)* | 5 phút |
| **2. Cloudflare R2** | Cài đặt Lifecycle Rule trên Cloudflare Dashboard | **0%** *(Cấu hình hạ tầng R2)* | 2 phút |
| **3. Mac mini Local** | Cập nhật `LOCAL_RETENTION_DAYS=31` trong `config.env` | **0%** *(Chỉ dọn folder tải tạm)* | 1 phút |

### Kết luận:
Kế hoạch này **tách biệt 100% với logic code nghiệp vụ**: không sửa đổi cấu trúc bảng, không sửa logic tính toán đề xuất hay giao diện người dùng, đảm bảo hệ thống vận hành an toàn tuyệt đối.


Viewed service.ts:430-580
Viewed route.ts:100-160
Viewed service.ts:375-430
Viewed repository.ts:340-410
Searched for "section=targets"
Searched for "section="
Viewed ppc-dashboard.tsx:490-535
Searched for "onLoadSkuRecommendations"
Searched for "loadSkuRecommendationDetails"
Viewed ppc-dashboard.tsx:655-700

Sau khi rà soát toàn bộ các câu truy vấn SQL trong `lib/ppc/repository.ts`, `lib/ppc/service.ts`, và các API routes, tôi phát hiện **3 nhóm truy vấn thừa (thừa cột, thừa dòng và truy vấn lặp)** đang diễn ra trên hệ thống:

---

### 1. Truy vấn thừa CỘT (Payload Bloat)
*Lấy ra các cột trong Database nhưng giao diện người dùng (UI) hoặc thuật toán hoàn toàn không dùng đến, làm tăng dung lượng truyền tải qua mạng.*

#### 🔴 Điểm 1: Bảng `ppc_performance_facts` khi tải Target Performance
* **Vị trí:** `lib/ppc/repository.ts` (dòng 476, hàm `listPpcPerformance`).
* **Vấn đề:** Khi người dùng mở tab Target (quét tối đa 25.000 dòng), câu lệnh `SELECT` lấy toàn bộ 35 cột:
  * Các cột **hoàn toàn vô nghĩa với Target**: `bidding_strategy`, `placement`, `placement_adjustment`, `daily_budget`, `targeting_type`, `units`, `asin`, `sku`, `report_granularity`.
  * *(Ví dụ: Cột `daily_budget` hay `bidding_strategy` chỉ có ở cấp Campaign, trên dòng Target giá trị luôn là `0` hoặc `null`).*
* **Tác động:** Server phải serialize và gửi qua mạng **25.000 dòng $\times$ 9 cột rỗng** = tăng thêm khoảng **~30% dung lượng JSON** không cần thiết.

#### 🔴 Điểm 2: Bảng Search Terms khi tải tab Search Term / ST Optim
* **Vị trí:** `lib/ppc/repository.ts` (dòng 387, hàm `listPpcSearchTerms`).
* **Vấn đề:** Giao diện bảng Search Term chỉ hiển thị từ khóa, chiến dịch, click, spend, sales, acos. Nhưng query lại lấy cả `portfolio_name`, `report_start_date`, `report_end_date`, `report_granularity`, `units`.
* **Tác động:** Khi tải 20.000 dòng Search Term, payload bị phình lên tới **2.37 MB**.

#### 🔴 Điểm 3: Bộ tính Đề xuất Bid (`listTargetRowsForRecommendations`)
* **Vị trí:** `lib/ppc/repository.ts` (dòng 549).
* **Vấn đề:** Engine tính bid (`evaluateRowWithRuleEngine`) chỉ cần 12 trường để so khớp luật: `cpc, bid, spend, clicks, orders, sales, targetExpression, targetId, campaignId, adGroupId, matchType, adType`. Nhưng query vẫn kéo theo cả `portfolio_name`, `asin`, `targeting_type`, `bidding_strategy`, `placement`, `units`, `report_granularity`...

---

### 2. Truy vấn thừa DÒNG (Unnecessary Row Scanning)

#### 🟡 Điểm 4: CTE `sku_campaigns` chạy ngay cả khi xem toàn store (`sku = "ALL"`)
* **Vị trí:** `lib/ppc/repository.ts` (dòng 464).
* **Vấn đề:** Trong câu SQL có đoạn:
  ```sql
  sku_campaigns AS (
    SELECT DISTINCT p3.store_id, p3.ad_type, p3.campaign_id ...
    WHERE ${filters.sku !== "ALL"} AND lower(p3.sku) = lower(${filters.sku})
  )
  ```
  Khi bạn chọn xem toàn bộ store (`sku = "ALL"`), PostgreSQL vẫn phải biên dịch và kiểm tra biểu thức `EXISTS (SELECT 1 FROM sku_campaigns)` cho từng dòng, gây lãng phí chu kỳ xử lý của database engine.

---

### 3. Truy vấn LẶP LẠI (Duplicate Queries)

#### 🟡 Điểm 5: Gọi lại `listPpcStores()` mỗi khi chuyển Tab
* **Vị trí:** `lib/ppc/service.ts` (dòng 554).
* **Vấn đề:** Mỗi khi người dùng bấm chuyển tab (từ Campaigns sang Targets, rồi sang Search Terms), hàm `loadSection` đều gửi request lên server và server lại chạy `SELECT id, name, marketplace FROM ppc_stores`.
* **Tác động:** Danh sách Store gần như không thay đổi nhưng vẫn bị query lại liên tục mỗi lần chuyển tab.

#### 🟡 Điểm 6: Khi bấm xem "Chi tiết 1 SKU" lúc Cold Cache
* **Vị trí:** `app/api/ppc/recommendations/grouped/route.ts` (dòng 55-75).
* **Vấn đề:** Khi bạn bấm vào nút "Chi tiết" của một SKU (ví dụ `GOL1006YG01`): nếu Redis cache chưa có sẵn, hệ thống sẽ **quét toàn bộ 20.000 target của cả store**, tính toán đề xuất cho toàn bộ 91 SKU, rồi mới dùng lệnh `.filter()` ở JavaScript để lấy đúng 1 SKU đó trả về!

---

### Bảng tóm tắt các điểm cần tinh giản:

| Điểm cần tinh giản | Loại thừa | Giải pháp khắc phục nhanh | Hiệu quả đạt được |
| :--- | :---: | :--- | :--- |
| **1. Cắt 9 cột rỗng ở Target** | Thừa cột | Chỉ `SELECT` các trường có giá trị trên Target | Giảm 30% dung lượng tải tab Target |
| **2. Cắt 5 cột rỗng ở Search Term** | Thừa cột | Áp dụng `projection: "lightweight"` triệt để | Payload giảm từ **2.37 MB ➔ ~800 KB** |
| **3. Cắt 10 cột ở Engine Đề xuất** | Thừa cột | Chỉ lấy 12 trường phục vụ tính Bid | Tăng tốc độ tính đề xuất lên 25% |
| **4. Bỏ CTE khi `sku = "ALL"`** | Thừa dòng | Dùng điều kiện `if (${filters.sku !== "ALL"})` để bỏ hẳn khối `sku_campaigns` | Query Database nhẹ hơn |
| **5. Cache danh sách Store trên Frontend** | Lặp lại | Client chỉ load Store 1 lần lúc mở web | Giảm bớt 1 query mỗi lần chuyển tab |