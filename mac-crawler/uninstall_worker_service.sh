#!/bin/bash
set -e

PLIST_NAME="com.amazon.ppc.worker.plist"
TARGET_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "============================================================"
echo "DỪNG VÀ GỠ BỎ REMOTE WORKER TRÊN MAC MINI"
echo "============================================================"

if [ -f "$TARGET_PLIST" ]; then
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
  rm -f "$TARGET_PLIST"
  echo "=> Đã dừng và gỡ bỏ worker thành công."
else
  echo "=> Không tìm thấy service worker."
fi
