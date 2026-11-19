#!/bin/bash
TARGET_PLIST="$HOME/Library/LaunchAgents/com.amazon.shipment.discrepancy.plist"

echo "=== GỠ BỎ DỊCH VỤ QUÉT SHIPMENT DISCREPANCY ==="
if [ -f "$TARGET_PLIST" ]; then
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
  rm -f "$TARGET_PLIST"
  echo "✅ Đã gỡ bỏ dịch vụ launchd com.amazon.shipment.discrepancy."
else
  echo "Dịch vụ chưa được cài đặt."
fi
