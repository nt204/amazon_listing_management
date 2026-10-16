#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ketoan.crawler.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"

mkdir -p "$TARGET_DIR" "$LOG_DIR"

SCHEDULE_TIME="${1:-15:00}"

if [[ ! "$SCHEDULE_TIME" =~ ^[0-9]{1,2}:[0-9]{2}$ ]]; then
  echo "Lỗi: Giờ chạy không hợp lệ '$SCHEDULE_TIME'. Định dạng chuẩn là HH:MM (ví dụ 15:00)." >&2
  exit 1
fi

SCHEDULE_HOUR=$(echo "$SCHEDULE_TIME" | cut -d: -f1)
SCHEDULE_MINUTE=$(echo "$SCHEDULE_TIME" | cut -d: -f2)
SCHEDULE_HOUR=$((10#$SCHEDULE_HOUR))
SCHEDULE_MINUTE=$((10#$SCHEDULE_MINUTE))

echo "============================================================"
echo "CÀI ĐẶT LỊCH CHẠY TỰ ĐỘNG TẢI FILE KẾ TOÁN TRÊN MAC MINI"
echo "Giờ chạy: $(printf "%02d:%02d" "$SCHEDULE_HOUR" "$SCHEDULE_MINUTE") mỗi ngày"
echo "============================================================"

# Gỡ bỏ service cũ nếu đang chạy
if launchctl list | grep -q "com.amazon.ketoan.crawler"; then
  echo "[1/4] Gỡ bỏ lịch chạy cũ..."
  launchctl bootout "gui/$(id -u)/com.amazon.ketoan.crawler" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.ketoan.crawler</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_accounting_daily.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$SCHEDULE_HOUR</integer>
        <key>Minute</key>
        <integer>$SCHEDULE_MINUTE</integer>
    </dict>

    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/mac-accounting.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/mac-accounting.log</string>

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

chmod 644 "$TARGET_PLIST"
cp "$TARGET_PLIST" "$SCRIPT_DIR/$PLIST_NAME"
echo "[2/4] Đã cấu hình: $TARGET_PLIST"

# Đăng ký lại service vào launchd
echo "[3/4] Đăng ký LaunchAgent với hệ điều hành..."
launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST" 2>/dev/null || launchctl load -w "$TARGET_PLIST"

echo "[4/4] Kiểm tra trạng thái service..."
if launchctl list | grep -q "com.amazon.ketoan.crawler"; then
  echo "✅ THÀNH CÔNG: Lịch chạy tải file kế toán đã sẵn sàng lúc $(printf "%02d:%02d" "$SCHEDULE_HOUR" "$SCHEDULE_MINUTE") hàng ngày!"
  echo "Xem log hoạt động tại: tail -f ~/Library/Logs/mac-accounting.log"
else
  echo "⚠️ Cảnh báo: Service chưa hiển thị trong launchctl list."
fi
