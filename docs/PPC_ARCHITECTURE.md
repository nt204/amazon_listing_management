# PPC System Architecture & Data Specification

> **Golden Rule:**
> **Performance Report = Source of Truth for hiệu suất tại đúng grain; trong file-only MVP, dùng canonical performance grain đã xác minh từ Bulk.**  
> **Bulk Snapshot = Source of Truth for current advertising structure, editable settings, and execution state.**  
> **Search Term Report = Source of Truth for customer-query-level performance and discovery.**  
> *STR discovers optimization candidates; Bulk validates current structure/state, prevents conflicting or duplicate actions, and provides the destination context required for execution/export.*

---

## 1. Kiến trúc tổng thể: "2 lớp dữ liệu hiệu suất + 1 lớp hợp nhất logic"

Hệ thống xử lý 4 nhóm file cốt lõi của Amazon Ads mà không gộp tất cả thành một bảng duy nhất:

```text
               AMAZON PPC DATA
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
    BULK FILES              SEARCH TERM FILES
   ┌────────────┐             ┌────────────┐
   │  Bulk SP   │             │   STR SP   │
   │  Bulk SB   │             │   STR SB   │
   └────────────┘             └────────────┘
        │                           │
        ▼                           ▼
  STRUCTURE / STATE         QUERY PERFORMANCE
     PERFORMANCE             CUSTOMER INTENT
        │                           │
        └─────────────┬─────────────┘
                      ▼
             NORMALIZATION LAYER
                      ▼
             CANONICAL PPC MODEL
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   STATISTICS     ANALYTICS    RULE ENGINE
    Dashboard     Insights   Alerts / Actions
```

### 2 Fact Families tách biệt:
1. **Performance Facts (MVP từ Bulk SP & Bulk SB; production ưu tiên Campaign/Targeting/Placement/Advertised Product reports):**  
   `fact_campaign`, `fact_ad_group`, `fact_target`, `fact_product` (hoặc `_daily`). Phản ánh cấu trúc, giá thầu, ngân sách, trạng thái và hiệu suất thực thi tổng thể 100%.
2. **Search Term Facts (Nguồn từ STR SP & STR SB):**  
   `fact_search_term` với dimension bắt buộc `ad_type = SP | SB`.  
   *Grain:* `shop + ad_type + campaign + ad_group + target + search_term + date`.

---

## 2. Cấu trúc Dashboard & Luồng Drill-down Chuẩn

Để đáp ứng tối đa luồng tư duy phân tích của PPC Specialist và nhà bán hàng, Dashboard được tổ chức theo cấu trúc phân cấp chuẩn:

```text
SHOP / ACCOUNT
   ↓
OVERVIEW (Tổng quan tài khoản)
   ↓
CAMPAIGN (Chiến dịch)
   ↓
AD GROUP (Nhóm quảng cáo)
   ↓
TARGET / KEYWORD (Mục tiêu / Từ khóa)
   ↓
SEARCH TERM INTELLIGENCE (Truy vấn khách hàng thực tế)

PRODUCT / SKU (Sản phẩm quảng cáo)
= View phân tích riêng biệt (Parallel Dimension)
```

### 2.1 Chi tiết vai trò từng tầng:

1. **OVERVIEW (Tổng Quan):**
   - Số liệu tổng hợp toàn shop/account từ canonical Bulk performance.
   - Bóc tách SP vs SB với Combined ACOS tính từ Raw Totals: $\frac{\text{Total Spend}}{\text{Total Sales}} \times 100$.
   - Monitor tốc độ chi tiêu (Velocity), xu hướng ngày, phân bổ match type.

2. **CAMPAIGN (Chiến Dịch):**
   - Danh sách chiến dịch với trạng thái (Enabled/Paused), ngân sách ngày, loại nhắm mục tiêu (Auto/Manual).
   - Drill-down: Chọn 1 Campaign sẽ lập tức lọc danh sách Ad Groups trực thuộc.

3. **AD GROUP (Nhóm Quảng Cáo):**
   - Danh sách nhóm quảng cáo trong campaign.
   - Thống kê chi phí, doanh số, ACOS, ROAS ở cấp Ad Group.
   - Drill-down: Chọn 1 Ad Group sẽ lập tức dẫn đến danh sách Targets/Keywords trực thuộc.

4. **TARGET / KEYWORD (Mục Tiêu / Từ Khóa):**
   - Grain chính để tối ưu hóa giá thầu (Bid optimization).
   - Tách thành **2 lớp hiển thị trực quan**:
     - **LỚP 1 - TARGET PERFORMANCE:**
       - Keyword / Target Expression, Match Type, State (Enabled/Paused), Current Bid (từ Bulk, không fake từ CPC).
       - Spend, Sales, Orders, Clicks, CVR, ACOS, ROAS.
     - **LỚP 2 - SEARCH TERM BREAKDOWN (Inline Accordion/Drawer):**
       - Khi click vào một Keyword, hiển thị toàn bộ **Search Terms triggered by [Keyword]**.
       - Hiển thị truy vấn thực tế, Clicks, Spend, Orders, Sales, CVR, ACOS của từng query.
       - Cột **Recommendation** bóc tách:
         - 🟢 **Harvest candidate**: Query ra đơn tốt, ACOS thấp $\rightarrow$ Khuyến nghị tạo Exact Target.
         - 🔴 **Negative candidate**: Query đốt tiền (nhiều clicks/spend, 0 orders) $\rightarrow$ Khuyến nghị Phủ định (Negative).
         - 🟡 **Keep / monitor**: Query hiệu suất bình thường $\rightarrow$ Giữ theo dõi.

5. **SEARCH TERM INTELLIGENCE (Báo Cáo Search Terms Toàn Diện):**
   - View tổng hợp toàn bộ các truy vấn khách hàng trên toàn tài khoản hoặc theo bộ lọc.
   - Nhận diện nhanh các cụm từ bleeding xuyên suốt các chiến dịch.

6. **PRODUCT / SKU (Dimension Song Song - View Phân Tích Riêng):**
   - **Lưu ý kiến trúc quan trọng:** Trong data model Amazon Ads, SKU/ASIN **không hoàn toàn nằm cố định dưới Ad Group**. Một SKU có thể xuất hiện trong nhiều Ad Group / Campaign, và một Ad Group có thể chứa nhiều SKU.
   - Do đó, **PRODUCT / SKU được thiết kế là một Dimension song song (View phân tích riêng)**:
     ```text
     Campaign ──> Ad Group ──> Target
                     ↕
         Advertised SKU / ASIN (Parallel Dimension)
     ```
   - Dashboard cho phép chuyển view: *By Campaign*, *By Ad Group*, *By Product*, *By Target* linh hoạt.
   - Phân hạng sản phẩm: **Hero SKU** (doanh thu cao, ACOS đẹp), **Bleeding SKU** (đốt tiền, ACOS cao/0 đơn), **Potential SKU** (CVR tốt, cần scale).

---

## 3. Triết lý tích hợp Search Term & Recommendation Engine 2 Lớp

### 3.1 Vì sao Search Term phải liên kết trong Target/Keyword Context?
Một sai lầm rất phổ biến là nhìn vào Target tổng thể rồi vội vàng kết luận:

> **Ví dụ thực tế:**
> - Campaign: `Yoga Broad`
> - Ad Group: `Main`
> - Target Keyword: `"yoga ornament"` (Match Type: Broad, Bid: $0.75)
> - **Target Performance:** Spend: $120, Sales: $300, **ACOS: 40%** (Vượt Target ACOS 30%).

Nếu không có Search Term context, người quản trị hoặc AI sơ sài sẽ đưa ra quyết định:
❌ **"Giảm bid toàn bộ keyword yoga ornament từ $0.75 xuống $0.55."**

Tuy nhiên, khi mở rộng **Search Terms triggered by "yoga ornament"**, dữ liệu thực tế cho thấy:
1. `pilates christmas ornament`: Spend $20 | Sales $120 | **ACOS 16.7%** $\rightarrow$ **Cực tốt!**
2. `yoga mat`: Spend $30 | Sales $0 | **0 đơn** $\rightarrow$ **Đang đốt tiền vô ích!**
3. `yoga gift`: Spend $25 | Sales $60 | **ACOS 41.7%** $\rightarrow$ **Cần theo dõi.**
4. Các terms phân tán khác: Spend $45 | Sales $120 | **ACOS 37.5%**.

### 3.2 Logic Recommendation Engine 2 Lớp:
Hệ thống kết hợp cả 2 nguồn dữ liệu:
$$\text{Bulk / Target State} + \text{Search Term Query Data} \longrightarrow \text{Intelligent Recommendation}$$

Thay vì giảm bid target cha ngay lập tức, hệ thống đề xuất chính xác theo 3 bước:
1. **Bước 1 (Harvest):** Tách query xuất sắc (`pilates christmas ornament`) thành **Exact Match Target** riêng với bid tối ưu để đẩy mạnh doanh số.
2. **Bước 2 (Negative):** Thêm query đốt tiền (`yoga mat`) vào **Negative Exact** trong Ad Group để cắt ngay $30 lãng phí.
3. **Bước 3 (Re-evaluate):** Khi loại bỏ $30 lãng phí, ACOS của target cha tự động giảm từ 40% về $(\$120 - \$30) / \$300 = \mathbf{30\%}$ (Đạt đúng mục tiêu!). Lúc này **giữ nguyên hoặc chỉ tinh chỉnh nhẹ giá thầu target cha**, không bóp nghẹt các traffic tiềm năng.

---

## 4. Phân định nguồn dữ liệu chuẩn (Source of Truth)

| Nhu cầu / Chỉ số | Source of Truth | Quy tắc kỹ thuật / Ghi chú |
| :--- | :--- | :--- |
| **Total Spend / Sales / Orders / Clicks / Impressions** | **Canonical Bulk Performance Grain** | Một grain duy nhất cho mỗi Ad Type (`SP`, `SB`); không SUM xuyên entity level |
| **CTR / CPC / CVR / ACOS / ROAS tổng** | **Derived from canonical raw totals** | Bắt buộc tính lại từ raw totals; tuyệt đối không `AVG(row ratios)` |
| **Campaign / Ad Group / Target Structure** | **Bulk Snapshot** | Cấu trúc phân cấp hiện tại (Current hierarchy) |
| **Bid / Budget / Status** | **Bulk Snapshot** | Trạng thái có thể thực thi hiện tại (Current executable state) |
| **Customer Search Term** | **Search Term Report** | Query thực tế tạo ra traffic từ người mua (bao gồm cả ASIN search term) |
| **Search-term metrics** | **Search Term Report** | Clicks, Spend, Orders, Sales... ở query level |
| **Harvest Candidate** | **STR → Bulk Validation** | Discover (từ STR) → dedupe / state / conflict validation (đối chiếu Bulk) |
| **Negative Candidate** | **STR → Bulk Validation** | Discover (từ STR) → existing-negative / conflict validation (đối chiếu Bulk) |
| **Wasted Spend Candidate** | **STR + decision rules** | Không coi mọi `orders = 0` là waste; áp dụng ngưỡng kinh tế sản phẩm |

### Lộ trình nguồn dữ liệu

| Grain | File-only MVP | Nguồn production ưu tiên | Mục đích |
| :--- | :--- | :--- | :--- |
| Account / Campaign | Bulk `Campaign` entity | Campaign Performance Report | Overview, budget, campaign health |
| Ad Group | Bulk `Ad Group` entity | Ad Group Performance Report | Ad group health, structure |
| Target | Bulk `Keyword` / `Product Targeting` entity | Targeting Report | Bid analysis, target performance |
| Placement | Bulk `Bidding Adjustment` entity nếu có metrics | Placement Report | Placement modifier |
| Product | Bulk `Product Ad` entity | Advertised Product Report | SKU / ASIN performance |
| Query | Search Term Report | Search Term Report | Harvest, negative, customer intent |
| Current state | Bulk Snapshot | Bulk Snapshot / Ads API | Bid, budget, state, bidding strategy |
| Business economics | Không có trong Amazon Ads report | Seller Central + COGS/fees | TACOS, break-even ACOS, profit |

Search Term tuyệt đối không được dùng làm fallback âm thầm cho Account, Campaign, Target hoặc Product totals. Nếu thiếu canonical grain, UI phải hiển thị trạng thái thiếu dữ liệu.

---

## 5. Các quy tắc kiến trúc cốt lõi

### Quy tắc 1: Canonical Bulk Performance Grain & Phân tích Ad Type (SP vs SB)
- **Tách biệt Schema Raw:** Raw SP (`raw_bulk_sp`, `raw_search_term_sp`) và Raw SB (`raw_bulk_sb`, `raw_search_term_sb`) giữ riêng, sau normalize mới đưa về schema chung.
- **Tổng hợp SP + SB:**  
  Tổng chi phí: $\text{Total Spend} = \text{SP Spend} + \text{SB Spend}$  
  Tổng doanh thu: $\text{Total Sales} = \text{SP Sales} + \text{SB Sales}$  
  Combined ACOS:
  $$\text{Combined ACOS} = \frac{\text{Total SP + SB Spend}}{\text{Total SP + SB Sales}} \times 100$$
  ❌ **Nghiêm cấm:** `AVG(SP ACOS, SB ACOS)`.
- **Đặc thù của Sponsored Brands (SB):** SB có vai trò Brand Discovery & New-to-brand (NTB), do đó không nên kết luận vội vã SB kém hơn SP chỉ dựa vào ACOS/ROAS ngắn hạn.

---

### Quy tắc 2: Quan hệ giữa Bulk và Search Term (1 Target $\rightarrow$ N Search Terms)
- Bulk Target là thực thể kích hoạt, Search Term là phản xạ thực tế của người dùng:
  ```text
  Bulk Target (Keyword / Product Target / Auto)
        │
        └── [1 : N] ──> Customer Search Terms (Queries / ASINs)
  ```
- **Context Linking trên Dashboard:**  
  Khi hiển thị một Search Term (ví dụ `pilates christmas ornament`), hệ thống đối chiếu và hiển thị Target cha tương ứng trong Bulk (`pilates ornament | Broad | $0.71 | Enabled`).

---

### Quy tắc 3: Tuyệt đối KHÔNG JOIN bằng `campaign_name`
- Campaign Name có thể bị đổi tên, bị trùng lặp giữa các shop/marketplace hoặc chứa ký tự đặc biệt.
- **Thứ tự ưu tiên khóa liên kết:**
  1. `profile_id + campaign_id + ad_group_id + target_id` (Identifier ổn định)
  2. Fallback: Normalized Composite Key (`[store_id, campaign_id, ad_group_id, target_expression, match_type]`).

---

### Quy tắc 4: Định nghĩa Wasted Spend Candidate theo ngưỡng kinh tế (Product Economics)
- **Sai lầm cần tránh:** Coi mọi search term có `clicks > 0 AND orders = 0` là lãng phí.
- **Định nghĩa chuẩn:**
  ```text
  Observed Wasted Spend Candidate:
  orders = 0 AND (clicks >= min_click_threshold OR spend >= max_acceptable_spend_without_order)
  ```
- Ngưỡng được xác định từ: Target ACOS, Break-even CPA, Expected CVR.

---

### Quy tắc 5: Harvest Scoring Engine đa chiều
- **Mô hình tính điểm:**
  $$\text{HARVEST\_SCORE} = \text{Performance} + \text{Conversion Evidence} + \text{Volume} + \text{Relevance} + \text{Confidence}$$
- Candidate sau đó phải được đối chiếu Bulk để kiểm tra: đã tồn tại Exact Target chưa, match type nào, campaign đích có đang `enabled` hay không.

---

### Quy tắc 6: Metric tỷ lệ tổng phải phái sinh từ Raw Totals
Nghiêm cấm `AVG(row ratios)`. Bắt buộc tính lại từ tổng gốc:
$$\text{CTR} = \frac{\text{Total Clicks}}{\text{Total Impressions}} \qquad \text{CPC} = \frac{\text{Total Spend}}{\text{Total Clicks}} \qquad \text{CVR} = \frac{\text{Total Orders}}{\text{Total Clicks}}$$
$$\text{ACOS} = \frac{\text{Total Spend}}{\text{Total Sales}} \times 100 \qquad \text{ROAS} = \frac{\text{Total Sales}}{\text{Total Spend}}$$
$$\text{CPA} = \frac{\text{Total Spend}}{\text{Total Orders}} \qquad \text{AOV} = \frac{\text{Total Sales}}{\text{Total Orders}}$$

---

## 6. Workflow 8 bước (PPC Automation Loop)

```text
[1. Ingest & Snapshot (Bulk SP/SB, STR SP/SB)]
                    ↓
[2. Normalize & Canonicalize (ad_type = SP | SB)]
                    ↓
[3. Analytics & Candidate Discovery]
                    ↓
[4. Cross-Validation / Conflict Detection]
                    ↓
[5. Recommendation Scoring (Rule Profiles: SP vs SB)]
                    ↓
[6. Human Approval]
                    ↓
[7. Bulk Action Export]
                    ↓
[8. Post-Execution Verification]
```

---

## 7. Data model triển khai

```text
ppc_performance_facts
  grain = CAMPAIGN | AD_GROUP | TARGET | PRODUCT | PLACEMENT
  ad_type = SP | SB | SD | UNKNOWN

ppc_search_terms
  grain = shop + ad_type + coverage + campaign + ad_group + target + query

ppc_recommendations
ppc_executed_actions
ppc_verification_results
```

Mỗi API response phải kèm `dataHealth`, gồm số row theo grain, source đang dùng, ad types đã tải và warnings. Dashboard khóa hoặc để trống metric khi thiếu source; không tự thay thế bằng grain khác.
