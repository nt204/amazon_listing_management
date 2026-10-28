#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.inventory.crawler.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

mkdir -p "$TARGET_DIR"

echo "============================================================"
echo "CÀI ĐẶT LỊCH TỰ ĐỘNG CRAWL TỒN KHO VÀO 04:00 SÁNG THỨ HAI HÀNG TUẦN"
echo "============================================================"

# Cấp quyền thực thi cho các file script
chmod +x "$SCRIPT_DIR/run_inventory_weekly.sh"

# Gỡ bỏ cấu hình cũ nếu có
echo "[1/3] Đang gỡ bỏ cấu hình cũ (nếu có)..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
sleep 1

# Cài đặt plist vào LaunchAgents
echo "[2/3] Cài đặt plist vào $TARGET_PLIST (Thứ 2 lúc 04:00 AM)..."

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.inventory.crawler</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_inventory_weekly.sh</string>
    </array>

    <!-- Chạy tự động lúc 04:00 sáng Thứ Hai hàng tuần (Weekday 1: Thứ 2 trong launchd)
         và 04:00 sáng mùng 1 hằng tháng (chốt tồn kho ngày cuối tháng trước) -->
    <key>StartCalendarInterval</key>
    <array>
        <dict>
            <key>Weekday</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>4</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <dict>
            <key>Day</key>
            <integer>1</integer>
            <key>Hour</key>
            <integer>4</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
    </array>

    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-inventory.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-inventory.log</string>

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

# Kích hoạt lịch tự động với launchctl
echo "[3/3] Đang kích hoạt lịch chạy với launchd..."
launchctl load -w "$TARGET_PLIST"

echo ""
echo "✅ ĐÃ CÀI ĐẶT THÀNH CÔNG!"
echo "Lịch chạy: 04:00 sáng Thứ Hai hàng tuần (chốt tồn kho thứ 7 tuần trước)"
echo "Log file: $HOME/Library/Logs/mac-inventory.log"
echo ""
