# Tài liệu Module Đánh Label Kết Quả Đổi Bid (Amazon PPC)

Module đánh giá hiệu quả thay đổi bid sau các khoảng thời gian **D7 / D14 / D30** bằng phương pháp **Causal Inference (Matched Control & Contribution-based Reward)**.

---

## 1. Mục đích và Nguyên tắc cốt lõi

1. **Deterministic (Hàm thuần & xác định):** Không dùng AI để gắn nhãn, không phụ thuộc database, không có side-effects. Cùng đầu vào luôn sinh ra cùng đầu ra.
2. **Net Contribution (USD) là kim chỉ nam:** Nhãn chính chỉ dựa trên **Reward (USD)** so với ngưỡng động $T$. Các chỉ số ACoS, Doanh số, Đơn hàng chỉ đóng vai trò chẩn đoán (`reason_codes`).
3. **Thứ tự đánh giá dứt khoát:**
   $$\text{PENDING} \longrightarrow \text{NOT\_APPLICABLE} \longrightarrow \text{INCONCLUSIVE} \longrightarrow \text{CONFOUNDED / SUPERSEDED} \longrightarrow \text{VALID}$$
4. **Loại bỏ nhiễu bảo vệ tập dữ liệu học:** Bất kỳ record nào dính biến động ngoại cảnh (`PRICE_CHANGE`, `STOCKOUT`,...) hoặc thiếu dữ liệu đều bị loại khỏi `eligible_for_learning`.
5. **Vòng đời chuỗi hành động (Sequential Action Lifecycle):** Khi xuất hiện action đổi bid mới trên cùng target, hành động mới sẽ **đè vào hành động cũ**, cửa sổ quan sát sạch (`clean observation window`) của action cũ dừng lại tại ngày xuất hiện action mới (`end_clean_observation`).
   * Các cửa sổ hoàn thành trước đó (ví dụ D7) **vẫn hợp lệ** (`VALID`).
   * Các cửa sổ dài hơn chưa xong bị hành động mới đè lên (ví dụ D14, D30) được gắn nhãn **`SUPERSEDED` (BỊ GHI ĐÈ)** với lý do `SUPERSEDED_BY_NEW_ACTION` và **bị loại bỏ khỏi tập dữ liệu học AI** để tránh data poisoning.
   * Hành động mới sẽ bắt đầu một chu kỳ quan sát và baseline độc lập mới từ ngày nó được áp dụng.

---

## 2. Công thức và Định nghĩa

### 2.1. Đơn vị kinh tế (Unit Economics)
* $\text{pre\_ads\_contribution\_margin\_pct} = \frac{\text{Price} - \text{COGS} - \text{Referral Fee} - \text{FBA Fee}}{\text{Price}}$
* $\text{BE\_ACOS} = \text{pre\_ads\_contribution\_margin\_pct}$
* $\text{Contribution} = \text{Ad Sales} \times \text{pre\_ads\_contribution\_margin\_pct} - \text{Ad Spend}$

### 2.2. Baseline & Expected
* $W$: Cửa sổ đánh giá (7, 14, hoặc 30 ngày).
* $\text{Baseline\_per\_day} = \frac{\text{Contribution (30 ngày trước ngày áp dụng)}}{30}$
* $\text{Expected\_Own\_W} = \text{Baseline\_per\_day} \times W$
* $\text{Control\_Shift\_W}$: Trung vị (Median) trên các matched controls của:
  $$[\text{Actual Contribution\_W} - \text{Expected\_Own\_W (của chính control đó)}]$$
* **Expected:**
  * Nếu số matched controls $\ge n\_control\_min$ (5): $\text{Expected} = \text{Expected\_Own\_W} + \text{Control\_Shift\_W}$
  * Nếu số matched controls $< n\_control\_min$ (5): $\text{Expected} = \text{Expected\_Own\_W}$ ($\text{Control\_Shift\_W} = 0$)

### 2.3. Reward & Ngưỡng động $T$
* $\text{Actual} = \text{Contribution (W ngày sau)}$
* $\text{Reward\_USD} = \text{Actual} - \text{Expected}$
* $\text{Baseline\_Spend\_W} = \left(\frac{\text{Ad Spend 30 ngày trước}}{30}\right) \times W$
* $\text{Reward\_Norm} = \frac{\text{Reward\_USD}}{\max(\text{Baseline\_Spend\_W}, \$10)}$
* Ngưỡng dung sai nhiễu $T$:
  $$T = \max\left(T_{min},\ T_{spend\_ratio} \times \text{Baseline\_Spend\_W}\right) \times \text{quality\_multiplier}$$

### 2.4. Gắn nhãn (Labeling)
* $\text{Reward\_USD} > +T \implies \mathbf{POSITIVE}$
* $\text{Reward\_USD} < -T \implies \mathbf{NEGATIVE}$
* $|\text{Reward\_USD}| \le T \implies \mathbf{NEUTRAL}$

---

## 3. Matched Control & Chất lượng Baseline

### 3.1. Tiêu chí Matched Control
Một target đối chứng hợp lệ phải thỏa mãn đồng thời:
1. Không bị đổi bid trong toàn bộ window đánh giá (hoặc là target control ngẫu nhiên).
2. Cùng bucket phân loại: Target Type, Lifecycle, Seasonality, ACoS/BE.
3. **Cùng xu hướng 7D vs 30D:**
   $$\text{Trend\_Ratio} = \frac{\text{Daily Contribution (7D)}}{\text{Daily Contribution (30D)}}$$
   *Giúp triệt tiêu hiện tượng Regression to the Mean (RTM).*
4. Đủ dữ liệu và không bị confound.

### 3.2. Bảng phân tầng chất lượng
| Số lượng Matched Controls | `expected_source` | `baseline_quality` | `quality_multiplier` của $T$ |
|---|---|---|---|
| $\ge 10$ (`n_control_high`) | `control_group` | **HIGH** | 1.00 |
| $5 - 9$ (`n_control_min` đến $n\_high - 1$) | `control_group` | **LOW** | 1.25 |
| $< 5$ (dưới `n_control_min`) | `own_30d_avg` | **LOW** | 1.25 |

---

## 4. Reason Codes Reference

* **Nhóm Lợi nhuận:**
  * `CONTRIBUTION_ABOVE_EXPECTED` (Reward $> +T$)
  * `CONTRIBUTION_BELOW_EXPECTED` (Reward $< -T$)
  * `WITHIN_NOISE` ($|\text{Reward}| \le T$)
* **Nhóm ACoS:**
  * `ACOS_IMPROVED` (ACoS sau $<$ ACoS baseline)
  * `ACOS_WORSENED` (ACoS sau $>$ ACoS baseline)
  * `ACOS_ABOVE_BE` (ACoS sau $>$ BE_ACOS)
* **Nhóm Doanh thu / Đơn hàng:**
  * `SALES_PRESERVED` / `SALES_DROPPED` (Ngưỡng duy trì $\ge 90\%$)
  * `ORDERS_PRESERVED` / `ORDERS_DROPPED` (Ngưỡng duy trì $\ge 90\%$)
* **Nhóm Thiếu dữ liệu / Tín hiệu nhỏ:**
  * `BID_CHANGE_TOO_SMALL` ($|\Delta \text{Bid}| < 3\%$)
  * `LOW_CLICKS`, `LOW_ORDERS` (Clicks $< \text{min}[W]$ VÀ Orders $< 5$)
  * `THIN_BASELINE` (Clicks baseline $< 30$ HOẶC số ngày baseline $< 25$)
  * `MISSING_DATA` (Tỷ lệ ngày có dữ liệu cửa sổ sau $< 90\%$)
* **Nhóm Nhiễu & Ghi Đè (Confounded & Superseded):**
  * `SUPERSEDED_BY_NEW_ACTION` / `INTERRUPTED_BY_NEW_ACTION`: Xuất hiện action đổi bid mới trên cùng target trước khi hoàn tất window đánh giá ($W$).
  * `OVERLAPPING_ACTION`: Có action bid khác trên cùng target trong khoảng thời gian quan sát.
  * Các loại event ngoại cảnh: `PRICE_CHANGE`, `LISTING_CHANGE`, `COUPON_OR_DEAL`, `BUDGET_CHANGE`, `PLACEMENT_CHANGE`, `STOCKOUT`, `SPECIAL_EVENT`, `TRACKING_ISSUE`.

### 4.1. Cơ chế Reset Observation Window & Tránh Ô Nhiễm Dữ Liệu (Bị Ghi Đè)
```text
Action A:
Day 0: $0.80 → $0.73 (start = Day 0)
↓
Day 3: không đổi (tiếp tục theo dõi A)
↓
Day 7: Đạt mốc D7 → ✅ VẪN ĐÁNH GIÁ (VALID)
↓
Day 9: Action B: $0.73 → $0.68 (end_clean_observation của Action A = Day 9)
↓
Day 14 (của A): Bị Action B đè lên → 🟠 Gắn nhãn BỊ GHI ĐÈ (SUPERSEDED) (Loại khỏi AI training)
Day 30 (của A): Bị Action B đè lên → 🟠 Gắn nhãn BỊ GHI ĐÈ (SUPERSEDED) (Loại khỏi AI training)

Action B (Hành động mới đè vào):
Bắt đầu baseline mới từ Day 9 (start = Day 9)
↓
D7 mới (Day 16)
↓
D14 mới (Day 23)
↓
D30 mới (Day 39)
```
Tức là: **Mỗi action mới sẽ đè lên và reset observation window cho target đó**. Clean observation của action cũ dừng lại tại ngày action mới phát sinh (`end_clean_observation`). Mọi window ngắn hơn kết thúc trước thời điểm này vẫn được giữ nguyên tính hợp lệ; mọi window dài hơn bị action mới đè lên sẽ được gắn nhãn **`SUPERSEDED` (BỊ GHI ĐÈ)** để bảo vệ bộ dữ liệu học AI.

---

## 5. Hướng dẫn Cấu hình & Gắn nhãn lại Lịch sử (Re-labeling)

### 5.1. Cấu hình mặc định (`DEFAULT_CONFIG`)
```typescript
import { createConfig, getDefaultConfig } from "@/lib/ppc/bid-evaluator";

const config = createConfig({
  t_min: 5.0,              // Tăng ngưỡng min từ $3 lên $5
  label_version: 2,        // Đánh dấu phiên bản nhãn mới
  learning_windows: [30],  // Chỉ lấy D30 cho AI model
});
```

### 5.2. Chạy Re-labeling lịch sử
Khi đổi config, sử dụng hàm `batchRelabelBidDecisions`:
```typescript
import { batchRelabelBidDecisions, createConfig } from "@/lib/ppc/bid-evaluator";

const updatedConfig = createConfig({
  t_min: 5.0,
  label_version: 2,
});

const newResults = batchRelabelBidDecisions(historicalInputs, {
  newConfig: updatedConfig,
});
// Kết quả cũ được giữ nguyên, kết quả mới có label_version = 2
```

---

## 6. Chạy Thử Demo & Test Suite

### Chạy Demo Ví dụ Chuẩn (JSON Output)
```bash
npx tsx scripts/demo-bid-evaluator.ts
```

### Chạy Toàn Bộ 20 Acceptance Test Cases
```bash
npx tsx --test tests/bid-evaluator.test.ts
```
