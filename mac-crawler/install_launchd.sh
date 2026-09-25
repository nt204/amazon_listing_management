#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ppc.crawler.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

if [ -f "$SCRIPT_DIR/config.env" ]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

# Tham số: giờ chạy (định dạng HH:MM, ưu tiên tham số > config.env > mặc định 05:00).
# Không bao giờ lưu --force vào LaunchAgent: lịch tự động phải luôn idempotent
# theo ngày để macOS chạy bù hoặc thay đổi giờ không tạo trùng job.
TARGET_TIME="${1:-${CRAWLER_SCHEDULE_TIME:-05:00}}"
if [ "$TARGET_TIME" = "--force" ] || [ "$TARGET_TIME" = "-f" ] || [ "$TARGET_TIME" = "--test" ] || [ -n "${2:-}" ]; then
  echo "[LỖI] Không được cài --force vào lịch tự động. Dùng './schedule_daily_job.sh --force' cho một lần test thủ công." >&2
  exit 1
fi

# Tách Giờ và Phút từ chuỗi HH:MM
if [[ "$TARGET_TIME" =~ ^([0-9]{1,2}):([0-9]{1,2})$ ]]; then
  SCHED_HOUR=$((10#${BASH_REMATCH[1]}))
  SCHED_MIN=$((10#${BASH_REMATCH[2]}))
else
  echo "[LỖI] Định dạng giờ không hợp lệ: $TARGET_TIME. Vui lòng nhập định dạng HH:MM (ví dụ: 13:45 hoặc 12:00)" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"

PRINT_TIME="$(printf "%02d:%02d" "$SCHED_HOUR" "$SCHED_MIN")"

echo "============================================================"
echo "CÀI ĐẶT LỊCH TỰ ĐỘNG CRAWL VÀO $PRINT_TIME MỖI NGÀY TRÊN MAC"
echo "============================================================"

# Cấp quyền thực thi cho các file script
chmod +x "$SCRIPT_DIR/schedule_daily_job.sh"
chmod +x "$SCRIPT_DIR/run_daily.sh"
chmod +x "$SCRIPT_DIR/trigger_sync.sh"
chmod +x "$SCRIPT_DIR/upload_r2.py"
chmod +x "$SCRIPT_DIR/test_run.sh" 2>/dev/null || true

# Gỡ bỏ cấu hình lịch cũ (nếu có)
echo "[1/3] Đang gỡ bỏ cấu hình lịch cũ trong launchd..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
sleep 1

# Sinh nội dung plist động theo đúng đường dẫn thư mục và user thực tế của máy
echo "[2/3] Cài đặt plist vào $TARGET_PLIST (Giờ: $SCHED_HOUR, Phút: $SCHED_MIN)..."

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.ppc.crawler</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/schedule_daily_job.sh</string>
    </array>

    <!-- Lịch chạy hàng ngày: $PRINT_TIME -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$SCHED_HOUR</integer>
        <key>Minute</key>
        <integer>$SCHED_MIN</integer>
    </dict>

    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-crawler.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-crawler.log</string>

    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF

# Load plist vào launchd
echo "[3/3] Kích hoạt LaunchAgent..."
launchctl load -w "$TARGET_PLIST"

echo ""
echo "=> ĐÃ CÀI ĐẶT THÀNH CÔNG!"
echo "Tiến trình sẽ tự động kích hoạt vào lúc $PRINT_TIME MỖI NGÀY."
echo "File log sẽ được ghi tại: $HOME/Library/Logs/mac-crawler.log"
echo "Kiểm tra tiến trình đã nạp: launchctl list | grep com.amazon.ppc.crawler"
echo "Test thủ công một lần (không lưu vào lịch): ./schedule_daily_job.sh --force"
echo "============================================================"
