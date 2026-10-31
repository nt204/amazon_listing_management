#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ketoan.monthly.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

mkdir -p "$TARGET_DIR"

echo "============================================================"
echo "CÀI ĐẶT LỊCH TỰ ĐỘNG TẢI BÁO CÁO THÁNG VÀO 04:00 SÁNG NGÀY MÙNG 2 HẰNG THÁNG"
echo "============================================================"

# Cấp quyền thực thi cho file script
chmod +x "$SCRIPT_DIR/run_accounting_monthly.sh"

# Gỡ bỏ cấu hình cũ nếu có
echo "[1/3] Đang gỡ bỏ cấu hình cũ (nếu có)..."
launchctl unload "$TARGET_PLIST" 2>/dev/null || true
sleep 1

# Cài đặt plist vào LaunchAgents
echo "[2/3] Cài đặt plist vào $TARGET_PLIST (Mùng 2 lúc 04:00 AM)..."

cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.ketoan.monthly</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_accounting_monthly.sh</string>
    </array>

    <!-- Chạy tự động lúc 04:00 sáng ngày mùng 2 hằng tháng (Day 2, Hour 4, Minute 0) -->
    <key>StartCalendarInterval</key>
    <dict>
        <key>Day</key>
        <integer>2</integer>
        <key>Hour</key>
        <integer>4</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-accounting-monthly.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-accounting-monthly.log</string>

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
echo "Lịch chạy: 04:00 sáng ngày mùng 2 hằng tháng"
echo "Mục đích: Tải báo cáo tổng kết tháng trước (Orders & Ads)"
echo "Log file: $HOME/Library/Logs/mac-accounting-monthly.log"
echo ""
