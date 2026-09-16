Đo thực tế cho thấy PPC Analytics lag chủ yếu do kiến trúc tải dữ liệu, không phải do CSS:

| Hiện trạng | Số liệu |
|---|---:|
| Thời gian xử lý server | khoảng 5,7 giây |
| Payload JSON | khoảng 10,3 MB |
| Campaign gửi xuống trình duyệt | 10.754 |
| Ad group | 7.420 |
| Target | 1.755 |
| Search term | 2.771 |
| Bảng performance trong DB | 1.177.772 dòng, khoảng 1,52 GB |
| Riêng truy vấn DB | khoảng 3,9 giây |

Trình duyệt phải parse 10 MB JSON, giữ nhiều bản sao dữ liệu trong memory, tạo hàng loạt `Map`, lọc, sắp xếp và tính chart. Vì vậy máy yếu sẽ rất dễ giật.

## Hướng tối ưu phù hợp nhất

### 1. Không tải toàn bộ PPC trong lần mở đầu

Lần đầu chỉ nên tải:

- Summary
- Breakdown tổng
- 20–50 campaign đầu tiên
- Số lượng cảnh báo/recommendation
- Danh sách store/SKU

Không tải ngay:

- 7.420 ad group
- 1.755 target
- 2.771 search term
- Toàn bộ recommendation chi tiết

Khi người dùng mở từng tab mới gọi API tương ứng:

```text
/ppc/overview
/ppc/campaigns?page=1&pageSize=50
/ppc/ad-groups?campaignId=...
/ppc/targets?campaignId=...&adGroupId=...
/ppc/search-terms?targetId=...
/ppc/recommendations?page=1
```

Đây là thay đổi có hiệu quả lớn nhất. Payload mở đầu nên giảm từ 10,3 MB xuống dưới khoảng 100–300 KB.

### 2. Phân trang, lọc và sắp xếp ở database

Hiện dashboard nhận toàn bộ dữ liệu rồi mới:

- Tìm kiếm
- Lọc trạng thái
- Lọc chi tiêu
- Sắp xếp
- Phân trang

Nên chuyển tất cả xuống SQL:

```sql
ORDER BY spend DESC
LIMIT 50 OFFSET 0
```

Dashboard chỉ giữ 50 dòng đang hiển thị, thay vì giữ hơn 10.000 campaign trong RAM.

### 3. Chỉ tải cấp con khi người dùng mở

Luồng nên là:

```text
Campaign
  → mở campaign mới tải Ad Group
    → mở Ad Group mới tải Target
      → mở Target mới tải Search Term
```

Không cần tải tất cả cấp con ngay từ đầu. Cách này vừa nhẹ vừa tránh việc map search term cho hàng nghìn target không được xem.

### 4. Sửa bộ lọc SKU hiện tại

Hiện tại khi chọn SKU, server vẫn truy vấn:

```ts
listPpcSearchTerms(... sku: "ALL")
listPpcPerformance(... sku: "ALL")
```

Sau đó chỉ lọc `skuPerformance`, còn campaign, ad group, target và search term vẫn lấy toàn store.

Đây vừa là vấn đề hiệu năng vừa có thể khiến người dùng tưởng bộ lọc SKU áp dụng cho toàn dashboard. Cần truyền SKU thật xuống truy vấn SQL.

### 5. Tính tổng hợp trực tiếp bằng SQL

Không nên lấy hơn 30.000 performance rows về Node.js rồi mới tính:

- Campaign totals
- Match type breakdown
- ACOS/ROAS
- Ad type breakdown
- SKU totals

Các thống kê này nên dùng `GROUP BY` trong PostgreSQL. Node chỉ nhận vài chục dòng tổng hợp.

### 6. Tách dữ liệu hiện tại và lịch sử

Bảng `ppc_performance_facts` đang hơn 1,17 triệu dòng. Nên có hai lớp:

- `ppc_current_state`: chỉ giữ snapshot mới nhất của từng entity.
- `ppc_performance_history`: giữ lịch sử để xem biểu đồ và so sánh.

Dashboard thường ngày đọc từ `current_state`, không quét bảng lịch sử 1,5 GB.

Ngoài ra nên:

- Dọn snapshot trùng hoặc quá cũ.
- Giữ dữ liệu chi tiết theo chính sách 90–180 ngày.
- Dữ liệu cũ hơn chuyển thành bảng tổng hợp ngày/tuần.
- Thêm index theo `team_id/store_id/snapshot_date/grain`.
- Thêm partial index riêng cho campaign, target đang active.

### 7. Cache theo phiên bản dữ liệu

API hiện dùng `private, no-store`, nên mỗi lần đổi tab hoặc quay lại đều tính lại hoàn toàn.

Nên cache theo khóa:

```text
team + store + SKU + days + latestSyncVersion
```

Khi chưa có file đồng bộ mới, có thể dùng lại kết quả cũ. Cache 30–60 giây cũng đã cải thiện rõ rệt.

### 8. Làm trải nghiệm tải mượt hơn

- Giữ dữ liệu cũ trong lúc đổi bộ lọc, không xóa trắng màn hình.
- Hiển thị skeleton riêng cho bảng đang tải.
- Hủy request cũ bằng `AbortController` khi người dùng đổi filter liên tục.
- Debounce ô tìm kiếm khoảng 250–300 ms.
- Dùng `useDeferredValue` cho tìm kiếm client nhỏ.
- Chỉ import/render chart khi tab Overview được mở.
- Không render DOM cho hàng chưa nằm trong trang hiện tại.

## Thứ tự nên triển khai

1. Tách API theo tab và server-side pagination.
2. Truyền đúng SKU xuống database.
3. Chuyển summary/breakdown sang SQL aggregation.
4. Lazy-load Ad Group → Target → Search Term.
5. Thêm cache và giữ dữ liệu cũ khi refetch.
6. Cuối cùng mới tối ưu `useMemo`, chart và component render.
7. Sau đó xử lý retention và bảng lịch sử để giảm dung lượng database.

Nếu làm ba mục đầu, thời gian mở trang có thể giảm từ khoảng 5–6 giây xuống gần dưới 1 giây trong điều kiện local, đồng thời bộ nhớ trình duyệt giảm rất mạnh.