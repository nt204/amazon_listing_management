#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.disbursements.crawler.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

mkdir -p "$TARGET_DIR"

echo "============================================================"
echo "CÀI ĐẶT LỊCH TỰ ĐỘNG QUÉT TIỀN VỀ VÀO 04:30 SÁNG THỨ HAI HÀNG TUẦN"
echo "============================================================"

# Cấp quyền thực thi cho các file script
chmod +x "$SCRIPT_DIR/run_disbursements_weekly.sh"

# Gỡ bỏ cấu hình cũ nếu có
echo "[1/3] Đang gỡ bỏ cấu hình cũ (nếu có)..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
sleep 1

# Cài đặt plist vào LaunchAgents
echo "[2/3] Cài đặt plist vào $TARGET_PLIST (Thứ 2 lúc 04:30 AM)..."

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.disbursements.crawler</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_disbursements_weekly.sh</string>
    </array>

    <!-- Chạy tự động lúc 04:30 sáng Thứ Hai hàng tuần (Weekday 1: Thứ 2 trong launchd) -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>4</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>

    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-disbursements.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-disbursements.log</string>

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

echo "[3/3] Đang kích hoạt lịch chạy với launchd..."
launchctl load "$TARGET_PLIST"

echo "============================================================"
echo "✅ CÀI ĐẶT THÀNH CÔNG!"
echo "• Lịch chạy: 04:30 sáng Thứ Hai hàng tuần"
echo "• File log:  $HOME/Library/Logs/mac-disbursements.log"
echo "• File script: $SCRIPT_DIR/run_disbursements_weekly.sh"
echo "• Kiểm tra trạng thái: launchctl list | grep disbursements"
echo "• Chạy thử ngay: $SCRIPT_DIR/run_disbursements_weekly.sh --force"
echo "============================================================"
