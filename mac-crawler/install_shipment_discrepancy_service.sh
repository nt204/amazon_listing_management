#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.amazon.shipment.discrepancy.plist"
SRC_PLIST="$SCRIPT_DIR/$PLIST_NAME"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$PLIST_NAME"

echo "=== CÀI ĐẶT DỊCH VỤ TỰ ĐỘNG QUÉT SHIPMENT DISCREPANCY (02:00 HÀNG NGÀY) ==="

mkdir -p "$TARGET_DIR"

if launchctl list | grep -q "com.amazon.shipment.discrepancy"; then
  echo "Đang gỡ dịch vụ cũ..."
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

chmod +x "$SCRIPT_DIR/run_shipment_discrepancy_daily.sh"
chmod +x "$SCRIPT_DIR/get_discrepancy_shipments.py"

cp "$SRC_PLIST" "$TARGET_PLIST"
launchctl load -w "$TARGET_PLIST"

echo "✅ Đã cài đặt dịch vụ thành công!"
echo "   Lịch chạy: Mỗi ngày lúc 02:00 sáng"
echo "   File log: $HOME/Library/Logs/mac-shipment-discrepancy.log"
launchctl list | grep "com.amazon.shipment.discrepancy" || true
