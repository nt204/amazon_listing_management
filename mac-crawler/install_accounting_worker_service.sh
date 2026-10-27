#!/bin/bash
# Cài worker nhận lệnh crawler kế toán từ web thành dịch vụ chạy nền (tự bật lại khi Mac khởi động).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.amazon.accounting.worker"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"

mkdir -p "$TARGET_DIR" "$HOME/Library/Logs"
chmod +x "$SCRIPT_DIR/start_accounting_worker.sh" "$SCRIPT_DIR"/run_*.sh 2>/dev/null || true

echo "============================================================"
echo "CÀI ĐẶT ACCOUNTING JOB WORKER (Crawler kế toán chạy thủ công từ web)"
echo "============================================================"

echo "[1/3] Gỡ bỏ worker cũ (nếu có)..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$TARGET_PLIST" 2>/dev/null || true
sleep 1

echo "[2/3] Tạo file dịch vụ tại $TARGET_PLIST..."
cat <<PLIST > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/start_accounting_worker.sh</string>
    </array>

    <!-- Luôn chạy nền để nhận lệnh từ web; tự bật lại nếu bị tắt -->
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-accounting-worker.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-accounting-worker.log</string>

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
PLIST

echo "[3/3] Kích hoạt dịch vụ..."
launchctl load -w "$TARGET_PLIST"

echo ""
echo "=> ĐÃ CÀI ĐẶT THÀNH CÔNG! Worker đang chạy nền, sẵn sàng nhận lệnh từ System Admin → Crawler."
echo "Xem log: tail -f ~/Library/Logs/mac-accounting-worker.log"
echo "============================================================"
