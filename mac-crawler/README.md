# HƯỚNG DẪN SETUP HỆ THỐNG MAC CRAWLER & ĐỒNG BỘ R2 (AMAZON PPC)

Thư mục này được thiết kế **hoàn toàn độc lập (standalone)**, tối ưu cho máy **Mac mini M1** cắm chạy tự động 24/7:
1. **Nhận lệnh từ xa (Remote Worker):** Lắng nghe lệnh trực tiếp từ Web App (`https://ncehub.net`), hỗ trợ theo dõi tiến độ 6 file thời gian thực, cơ chế Lease Token chống trùng lặp, và Checkpoint khôi phục nguyên tử khi đứt đoạn.
2. **Lịch cố định:** Tự động chạy tải dữ liệu vào đúng **12:00 trưa mỗi ngày**.
3. **Tải đủ 6 báo cáo PPC Amazon:**
   - `Bulk SP 30d` & `Bulk SP 7d`
   - `Bulk SB 30d` & `Bulk SB 7d`
   - `Search Term SP 30d` & `Search Term SB 30d`
4. **Phân loại & Lưu trữ cục bộ:** Lưu tại `~/Downloads/Bulk file/{YYYY-MM-DD}/{STORE_NAME}/` chia thành 2 thư mục con `SP/` và `SB/`.
5. **Upload Cloudflare R2:** Kiểm tra SHA-256, đẩy lên R2 và tạo marker `_COMPLETE.json`.
6. **Đồng bộ Database:** Gọi API server nạp dữ liệu vào PostgreSQL an toàn và tự động.

---

> [!IMPORTANT]
> **VỊ TRÍ ĐẶT THƯ MỤC TRÊN MAC MINI:**
> macOS sandbox chặn các dịch vụ chạy nền của `launchd` truy cập thư mục Desktop (`Operation not permitted`).
> **Luôn luôn đặt thư mục tại thư mục Home người dùng: `~/mac-crawler`** (tức `/Users/ad/mac-crawler`), **KHÔNG** đặt trong `~/Desktop`.

---

## 📋 TỔNG HỢP CÁC LỆNH TERMINAL TRÊN MAC MINI

Dưới đây là danh sách đầy đủ toàn bộ các lệnh bạn cần dùng trong quá trình cài đặt, vận hành và xử lý lỗi:

### 1. Cài đặt & Chuẩn bị ban đầu (Setup)

```bash
# Di chuyển vào thư mục crawler
cd ~/mac-crawler

# Cài đặt môi trường tự động (Kiểm tra Node, Python, boto3, cấp quyền)
./setup_mac.sh
```

---

### 2. Quản lý Dịch vụ Remote Worker (Nhận lệnh từ Web)

Worker này chạy nền vĩnh viễn (tốn ~20MB RAM, CPU 0%), tự động bật cùng macOS để nhận lệnh khi bạn bấm trên Web App:

```bash
cd ~/mac-crawler

# Cài đặt và BẬT dịch vụ Worker chạy ngầm:
./install_worker_service.sh

# DỪNG và GỠ BỎ dịch vụ Worker:
./uninstall_worker_service.sh

# Kiểm tra xem Worker có đang chạy không (nếu có trả về PID là đang chạy):
launchctl list | grep com.amazon.ppc.worker

# Khởi động lại Worker (khi bạn vừa sửa file config.env hoặc code):
launchctl bootout "gui/$(id -u)/com.amazon.ppc.worker" 2>/dev/null || launchctl unload ~/Library/LaunchAgents/com.amazon.ppc.worker.plist 2>/dev/null
launchctl load -w ~/Library/LaunchAgents/com.amazon.ppc.worker.plist
```

---

### 3. Xem Log Hoạt Động (Logs)

```bash
# 1. Xem LOG TRỰC TIẾP theo thời gian thực (Live Stream - Bấm Ctrl + C để thoát):
tail -f ~/Library/Logs/mac-crawler-worker.log

# 2. Xem 50 dòng log gần nhất:
tail -n 50 ~/Library/Logs/mac-crawler-worker.log

# 3. Xem 100 dòng log gần nhất:
tail -n 100 ~/Library/Logs/mac-crawler-worker.log

# 4. Xóa sạch file log cũ (nếu log bị đầy hoặc muốn dọn dẹp):
> ~/Library/Logs/mac-crawler-worker.log

# 5. Xem log của Lịch chạy 12h trưa tự động (nếu có bật):
tail -f ~/Library/Logs/mac-crawler.log
```

---

### 4. Quản lý Lịch Chạy Tự Động 12:00 Trưa (Daily LaunchAgent)

Nếu bạn muốn Mac mini tự động kích hoạt crawl đúng 12:00 trưa mỗi ngày mà không cần ai bấm web:

```bash
cd ~/mac-crawler

# Cài đặt lịch 12:00 trưa:
./install_launchd.sh

# Kiểm tra xem lịch đã đăng ký chưa:
launchctl list | grep com.amazon.ppc.crawler

# Gỡ bỏ lịch tự động 12:00 trưa:
./uninstall_launchd.sh
```

---

### 5. Chạy Thử Thủ Công Ngay Lập Tức (Test Run)

Nếu muốn test ngay trên Mac mini mà không cần qua Web và không cần chờ đến 12h:

```bash
cd ~/mac-crawler

# Chạy test toàn bộ quy trình: Bật AdsPower -> Tải 6 file -> Up R2 -> Báo Web
./test_run.sh
```

---

### 6. Xử Lý Sự Cố Thường Gặp (Troubleshooting)

#### Lỗi: `Operation not permitted`
- **Nguyên nhân:** Thư mục `mac-crawler` đang nằm trong `Desktop` hoặc `Downloads`, bị macOS TCC chặn quyền chạy ngầm.
- **Cách khắc phục:**
  ```bash
  # 1. Dừng service cũ
  launchctl bootout "gui/$(id -u)/com.amazon.ppc.worker" 2>/dev/null || true
  
  # 2. Chuyển thư mục ra ngoài Home
  mv ~/Desktop/mac-crawler ~/mac-crawler
  
  # 3. Cài lại service tại vị trí mới
  cd ~/mac-crawler
  ./install_worker_service.sh
  ```

#### Lỗi: `Không thể kết nối AdsPower API`
- **Nguyên nhân:** Ứng dụng AdsPower chưa mở hoặc chưa bật Local API.
- **Cách khắc phục:**
  1. Mở app **AdsPower**.
  2. Vào **Settings** $\to$ **Local API** $\to$ Bật công tắc on (port mặc định `50325`).

#### Lỗi: `Không tìm thấy checkpoint hoặc muốn crawl lại từ đầu`
- Các file checkpoint được lưu tại:
  `~/Library/Application Support/AmazonPpcCrawler/jobs/`
- Nếu muốn xóa toàn bộ checkpoint cũ để crawl lại mới tinh:
  ```bash
  rm -rf ~/Library/Application\ Support/AmazonPpcCrawler/jobs/*
  ```

---

## 📦 LỆNH ĐÓNG GÓI TRÊN MÁY CHÍNH ĐỂ GỬI SANG MAC MINI

Khi bạn chỉnh sửa code trên máy MacBook làm việc và muốn đóng gói gửi sang Mac mini:

```bash
cd "/Users/macbook/Desktop/Amazon Listing Management"

# Đóng gói zip nhẹ (~65KB, tự loại bỏ node_modules và file rác):
zip -r ~/Desktop/mac-crawler.zip mac-crawler \
  -x "mac-crawler/node_modules/*" \
  -x "mac-crawler/__pycache__/*" \
  -x "mac-crawler/.*"
```

Sau khi copy file `mac-crawler.zip` sang Mac mini, mở Terminal Mac mini giải nén vào thư mục Home:
```bash
unzip ~/Downloads/mac-crawler.zip -d ~/
cd ~/mac-crawler
./setup_mac.sh
./install_worker_service.sh
```
