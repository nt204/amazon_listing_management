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
echo "[2/3] Cài đặt plist vào $TARGET_PLIST..."
cp "$SCRIPT_DIR/$PLIST_NAME" "$TARGET_PLIST"

# Kích hoạt lịch tự động với launchctl
echo "[3/3] Đang kích hoạt lịch chạy với launchd..."
launchctl load -w "$TARGET_PLIST"

echo ""
echo "✅ ĐÃ CÀI ĐẶT THÀNH CÔNG!"
echo "Lịch chạy: 04:00 sáng Thứ Hai hàng tuần (chốt tồn kho thứ 7 tuần trước)"
echo "Log file: $HOME/Library/Logs/mac-inventory.log"
echo ""
