#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ppc.crawler.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

mkdir -p "$TARGET_DIR"

echo "============================================================"
echo "CÀI ĐẶT LỊCH TỰ ĐỘNG CRAWL VÀO 12:00 TRƯA MỖI NGÀY TRÊN MAC"
echo "============================================================"

# Cấp quyền thực thi cho các file script
chmod +x "$SCRIPT_DIR/schedule_daily_job.sh"
chmod +x "$SCRIPT_DIR/run_daily.sh"
chmod +x "$SCRIPT_DIR/trigger_sync.sh"
chmod +x "$SCRIPT_DIR/upload_r2.py"
chmod +x "$SCRIPT_DIR/test_run.sh" 2>/dev/null || true

# Unload nếu đã có sẵn
if launchctl list | grep -q "com.amazon.ppc.crawler"; then
  echo "[1/3] Đang gỡ bỏ cấu hình lịch cũ..."
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

# Sinh nội dung plist động theo đúng đường dẫn thư mục và user thực tế của máy
echo "[2/3] Cài đặt plist vào $TARGET_PLIST..."
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

    <!-- Lịch chạy: Đúng 12 giờ 00 phút trưa mỗi ngày -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>12</integer>
        <key>Minute</key>
        <integer>0</integer>
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
echo "Tiến trình sẽ tự động kích hoạt vào lúc 12:00 TRƯA MỖI NGÀY."
echo "File log sẽ được ghi tại: $HOME/Library/Logs/mac-crawler.log"
echo "Để kiểm tra trạng thái: launchctl list | grep com.amazon.ppc.crawler"
echo "============================================================"
