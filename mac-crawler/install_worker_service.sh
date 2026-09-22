#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.ppc.worker.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

mkdir -p "$TARGET_DIR"

echo "============================================================"
echo "CÀI ĐẶT DỊCH VỤ REMOTE WORKER CHẠY NỀN TRÊN MAC MINI"
echo "============================================================"

chmod +x "$SCRIPT_DIR/start_worker.sh"

if launchctl list | grep -q "com.amazon.ppc.worker"; then
  echo "[1/3] Gỡ bỏ worker cũ..."
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

echo "[2/3] Tạo file dịch vụ tại $TARGET_PLIST..."
cat <<EOF > "$TARGET_PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.amazon.ppc.worker</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/start_worker.sh</string>
    </array>

    <!-- Giữ worker luôn chạy nền (tốn ~20MB RAM, CPU 0%) -->
    <key>KeepAlive</key>
    <true/>

    <!-- Tự động chạy khi Mac khởi động -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Chế độ Standard: Không bị macOS App Nap đóng băng khi màn hình tắt -->
    <key>ProcessType</key>
    <string>Standard</string>

    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/mac-crawler-worker.log</string>

    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/mac-crawler-worker.log</string>

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

echo "[3/3] Kích hoạt dịch vụ..."
launchctl load -w "$TARGET_PLIST"

echo ""
echo "=> ĐÃ CÀI ĐẶT THÀNH CÔNG!"
echo "Worker hiện đang chạy ngầm sẵn sàng nhận lệnh từ Web App."
echo "Xem log: tail -f ~/Library/Logs/mac-crawler-worker.log"
echo "============================================================"
